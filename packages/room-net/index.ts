import * as net from "node:net";
import {SecureFrames,ROOM_PROTOCOL_VERSION,ROOM_CAPABILITIES} from "./secure-frame";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { networkInterfaces } from "node:os";
import { performance } from "node:perf_hooks";
import { TextDecoder } from "node:util";

export interface Peer {
  peerId: string;
  name: string;
  remoteAddress: string;
}

export interface HostOptions {
  peerId: string;
  name: string;
  bind: string;
  port?: number;
  key?: string;
}

export const ROOM_INTENTIONAL_LEAVE="intentional leave";
export interface HostHandlers {
  /** Main-only admission after proof verification, before reserving a credential. */
  admit?(peer:Peer,pendingPeerIds:readonly string[]):string|undefined;
  peerJoined(peer: Peer): void;
  peerLeft(peer: Peer, reason: string, departure:'left'|'disconnected'): void|Promise<void>;
  message(peer: Peer, payload: Record<string, unknown>): void;
  error(message: string): void;
}

export interface RoomHost {
  readonly roomId: string;
  readonly hostId: string;
  readonly address: string;
  readonly key: string;
  readonly peers: readonly Peer[];
  send(peerId: string, payload: Record<string, unknown>): boolean;
  disconnect(peerId: string, reason?: string): void;
  close(): Promise<void>;
}

export interface ResumeCredential {
  roomId: string;
  token: string;
}

export interface ClientOptions {
  peerId: string;
  name: string;
  address: string;
  key: string;
  resume?: ResumeCredential;
}

export interface ClientHandlers {
  message(payload: Record<string, unknown>): void;
  closed(reason: string): void;
  // Main-process only: retain an authenticated credential before finish/ready can be interrupted.
  credential?(resume: ResumeCredential): void;
}

export interface RoomClient {
  /** Authenticated deliberate leave; resolves after host releases this connection identity. */
  leave():Promise<void>;
  readonly resume: ResumeCredential;
  readonly roomId: string;
  readonly hostId: string;
  send(payload: Record<string, unknown>): boolean;
  close(): Promise<void>;
}

const VERSION = ROOM_PROTOCOL_VERSION;
export const ROOM_VERSION_MISMATCH = "房间版本不一致，请双方使用0.19.0。";
const MAX_GUESTS = 3;
const MAX_UNAUTHENTICATED = 8;
const HANDSHAKE_TIMEOUT_MS = 5_000;
const MAX_FRAME_BYTES = 360 * 1024;
const MAX_AUTH_FRAME_BYTES = 4 * 1024;
const MAX_AUTH_BYTES = 16 * 1024;
const MAX_QUEUED_BYTES = 512 * 1024;
const HEARTBEAT_INTERVAL_MS = 2_000;
const HEARTBEAT_TIMEOUT_MS = 8_000;
const RATE_PER_SECOND = 60;
const RATE_BURST = 60;
const FAILURE_WINDOW_MS = 10_000;
const FAILURE_LIMIT = 5;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const PEER_ID_PATTERN = /^[a-f0-9]{32}$/;

type JsonRecord = Record<string, unknown>;
type Packet = JsonRecord & { type: string; version?: number };

function isCanonicalIpv4(value: string): boolean {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) return false;
  const parts = value.split(".");
  return parts.every((part) => {
    const number = Number(part);
    return Number.isInteger(number) && number >= 0 && number <= 255 && String(number) === part;
  });
}

function isAllowedIpv4(value: string): boolean {
  if (!isCanonicalIpv4(value) || !net.isIPv4(value)) return false;
  const [a, b] = value.split(".").map(Number);
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

export function localRoomAddresses(): string[] {
  const addresses = new Set<string>();
  const interfaces = networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && isAllowedIpv4(entry.address)) {
        addresses.add(entry.address);
      }
    }
  }
  addresses.add("127.0.0.1");
  const sorted = [...addresses].filter((address) => address !== "127.0.0.1").sort();
  return [...sorted, "127.0.0.1"];
}

export function parseRoomAddress(value: unknown): { host: string; port: number } {
  if (typeof value !== "string") throw new Error("Invalid room address");
  const match = /^(\d{1,3}(?:\.\d{1,3}){3}):([1-9]\d{0,4})$/.exec(value);
  if (!match || !isAllowedIpv4(match[1])) throw new Error("Invalid room address");
  const port = Number(match[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("Invalid room address");
  return { host: match[1], port };
}

export function validRoomName(value: unknown): value is string {
  if (typeof value !== "string" || value.trim() !== value || value.normalize("NFC") !== value) return false;
  const characters = Array.from(value);
  if (characters.length < 1 || characters.length > 20) return false;
  if (/[\u0000-\u001f\u007f-\u009f]/u.test(value)) return false;
  if (Buffer.byteLength(value, "utf8") > 80) return false;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(value, "utf8")) === value;
  } catch {
    return false;
  }
}

function isPeerId(value: unknown): value is string {
  return typeof value === "string" && PEER_ID_PATTERN.test(value);
}

function decodeSecret(value: unknown): Buffer | null {
  if (typeof value !== "string" || !TOKEN_PATTERN.test(value)) return null;
  const bytes = Buffer.from(value, "base64url");
  return bytes.length === 16 && bytes.toString("base64url") === value ? bytes : null;
}

function randomSecret(): string {
  return randomBytes(16).toString("base64url");
}

function isPlainRecord(value: unknown): value is JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  try {
    return Object.getPrototypeOf(value) === Object.prototype;
  } catch {
    return false;
  }
}

function exactKeys(value: JsonRecord, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

const strictUtf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function parseJsonRecord(bytes: Buffer): JsonRecord | null {
  try {
    const parsed: unknown = JSON.parse(strictUtf8.decode(bytes));
    return isPlainRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function canonicalTranscript(
  roomId: string,
  hostId: string,
  peerId: string,
  name: string,
  serverNonce: string,
  clientNonce: string,
): string {
  return JSON.stringify({
    protocolVersion: VERSION,
    roomId,
    hostId,
    peerId,
    capabilities: ROOM_CAPABILITIES,
    serverNonce,
    clientNonce,
  });
}

function hmac(key: Buffer, domain: string, transcript: string, ...extra: string[]): string {
  const digest = createHmac("sha256", key)
    .update(`pixelstreet/room-${domain}/v1\n`, "utf8")
    .update(transcript, "utf8");
  for (const item of extra) digest.update("\n", "utf8").update(item, "utf8");
  return digest.digest("base64url");
}

function equalMac(actual: unknown, expected: string): boolean {
  if (typeof actual !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(actual)) return false;
  const a = Buffer.from(actual, "base64url");
  const b = Buffer.from(expected, "base64url");
  return a.length === 32 && b.length === 32 && a.toString("base64url") === actual && timingSafeEqual(a, b);
}

function equalSecret(actual: string, expected: string): boolean {
  const a = decodeSecret(actual);
  const b = decodeSecret(expected);
  return !!a && !!b && timingSafeEqual(a, b);
}

function frameBytes(packet: JsonRecord, maxFrameBytes: number): Buffer | null {
  let body: string;
  try {
    body = JSON.stringify(packet);
  } catch {
    return null;
  }
  if (!body) return null;
  const encoded = Buffer.from(body, "utf8");
  if (encoded.length < 1 || encoded.length > maxFrameBytes) return null;
  const frame = Buffer.allocUnsafe(encoded.length + 4);
  frame.writeUInt32BE(encoded.length, 0);
  encoded.copy(frame, 4);
  return frame;
}

function sendPacket(
  socket: net.Socket,
  packet: JsonRecord,
  maxFrameBytes: number,
  authenticated: boolean,
  recordAuthBytes: (bytes: number) => boolean,
): boolean {
  const frame = frameBytes(packet, maxFrameBytes);
  if (!frame || socket.destroyed || !socket.writable) return false;
  if (socket.writableLength + frame.length > MAX_QUEUED_BYTES) {
    socket.destroy();
    return false;
  }
  if (!authenticated && !recordAuthBytes(frame.length)) {
    socket.destroy();
    return false;
  }
  try {
    // Node reports false when its writable queue is full, but has accepted the frame.
    socket.write(frame);
    return !socket.destroyed;
  } catch {
    socket.destroy();
    return false;
  }
}

class FrameReader {
  private header = Buffer.alloc(4);
  private headerUsed = 0;
  private body: Buffer | null = null;
  private bodyUsed = 0;
  private stopped = false;

  constructor(
    private readonly maxFrameBytes: () => number,
    private readonly recordAuthBytes: (bytes: number) => boolean,
    private readonly onFrame: (body: Buffer) => void,
    private readonly onError: (reason: string) => void,
  ) {}

  push(chunk: Buffer): void {
    if (this.stopped) return;
    let offset = 0;
    while (offset < chunk.length && !this.stopped) {
      if (!this.body) {
        const take = Math.min(4 - this.headerUsed, chunk.length - offset);
        chunk.copy(this.header, this.headerUsed, offset, offset + take);
        this.headerUsed += take;
        offset += take;
        if (!this.recordAuthBytes(take)) return this.fail("authentication limit exceeded");
        if (this.headerUsed < 4) continue;
        const length = this.header.readUInt32BE(0);
        const max = this.maxFrameBytes();
        if (length === 0 || length > max) return this.fail("invalid frame length");
        this.body = Buffer.alloc(length);
        this.bodyUsed = 0;
      }

      const take = Math.min(this.body.length - this.bodyUsed, chunk.length - offset);
      chunk.copy(this.body, this.bodyUsed, offset, offset + take);
      this.bodyUsed += take;
      offset += take;
      if (!this.recordAuthBytes(take)) return this.fail("authentication limit exceeded");
      if (this.bodyUsed === this.body.length) {
        const complete = this.body;
        this.body = null;
        this.bodyUsed = 0;
        this.headerUsed = 0;
        this.onFrame(complete);
      }
    }
  }

  stop(): void {
    this.stopped = true;
    this.body = null;
    this.bodyUsed = 0;
    this.headerUsed = 0;
  }

  private fail(reason: string): void {
    if (this.stopped) return;
    this.stopped = true;
    this.body = null;
    this.onError(reason);
  }
}

class RateGate {
  private tokens = RATE_BURST;
  private updatedAt = performance.now();

  take(now = performance.now()): boolean {
    const elapsed = Math.max(0, now - this.updatedAt);
    this.tokens = Math.min(RATE_BURST, this.tokens + (elapsed * RATE_PER_SECOND) / 1_000);
    this.updatedAt = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

function normalizeRemoteAddress(value: string | undefined): string {
  if (!value) return "unknown";
  const normalized = value.toLowerCase().startsWith("::ffff:") ? value.slice(7) : value;
  return isCanonicalIpv4(normalized) ? normalized : "unknown";
}

interface FailureRecord {
  count: number;
  since: number;
}

function pruneFailures(failures: Map<string, FailureRecord>, now: number): void {
  for (const [address, record] of failures) {
    if (now - record.since >= FAILURE_WINDOW_MS) failures.delete(address);
  }
  while (failures.size > 64) {
    const oldest = failures.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    failures.delete(oldest);
  }
}

interface HostConnection {
  socket: net.Socket;
  secure: SecureFrames | null;
  remoteAddress: string;
  peerId: string | null;
  name: string | null;
  state: "challenge" | "finish" | "ready" | "closed";
  established: boolean;
  finalized: boolean;
  explicitDisconnect: boolean;
  closeReason: string;
  authBytes: number;
  serverNonce: string;
  clientNonce: string | null;
  transcript: string | null;
  resumeToken: string | null;
  sendSequence: number;
  receiveSequence: number;
  nextPingId: number;
  lastRemotePingId: number;
  outstandingPing: number | null;
  lastMatchedPongAt: number;
  appRate: RateGate;
  handshakeTimer: NodeJS.Timeout | null;
  heartbeatTimer: NodeJS.Timeout | null;
  reader: FrameReader;
}

function reportHostError(handlers: HostHandlers, message: string): void {
  try {
    handlers.error(message);
  } catch {
    // User handlers must not break transport cleanup.
  }
}

export async function hostRoom(options: HostOptions, handlers: HostHandlers): Promise<RoomHost> {
  if (!isPeerId(options.peerId) || !validRoomName(options.name)) throw new Error("Invalid host identity");
  const localAddresses = localRoomAddresses();
  if (!isAllowedIpv4(options.bind) || !localAddresses.includes(options.bind)) {
    throw new Error("Bind address must be a local private IPv4 address");
  }
  if (options.port !== undefined && (!Number.isInteger(options.port) || options.port < 1 || options.port > 65_535)) {
    throw new Error("Invalid room port");
  }
  const key = options.key ?? randomSecret();
  const inviteKey = decodeSecret(key);
  if (!inviteKey) throw new Error("Invalid room key");

  const roomId = randomSecret();
  const hostId = options.peerId;
  const server = net.createServer({ allowHalfOpen: false });
  const connections = new Set<HostConnection>();
  const pendingByAddress = new Map<string, number>();
  const activeByPeer = new Map<string, HostConnection>();
  const resumeTokens = new Map<string, string>();
  const pendingResume = new Map<string, number>();
  const failures = new Map<string, FailureRecord>();
  let listening = false;
  let closed = false;
  let actualAddress = "";

  const finalize = async (connection: HostConnection, reason: string): Promise<void> => {
    if (connection.finalized) return;
    connection.finalized = true;
    connection.state = "closed";
    connection.reader.stop();
    if (connection.handshakeTimer) clearTimeout(connection.handshakeTimer);
    if (connection.heartbeatTimer) clearInterval(connection.heartbeatTimer);
    connections.delete(connection);
    if (!connection.established) {
      const pending = pendingByAddress.get(connection.remoteAddress) ?? 0;
      if (pending <= 1) pendingByAddress.delete(connection.remoteAddress);
      else pendingByAddress.set(connection.remoteAddress, pending - 1);
    }
    if (connection.peerId && activeByPeer.get(connection.peerId) === connection) {
      activeByPeer.delete(connection.peerId);
      if(!closed&&!connection.explicitDisconnect)pendingResume.set(connection.peerId,performance.now()+30_000);
    }
    if (connection.established && connection.peerId && connection.name) {
      const peer = { peerId: connection.peerId, name: connection.name, remoteAddress: connection.remoteAddress };
      try {
        await handlers.peerLeft(peer, reason,connection.explicitDisconnect?'left':'disconnected');
      } catch {
        // Cleanup has already completed.
      }
    }
  };

  const terminate = (connection: HostConnection, reason: string, countFailure = false): void => {
    if (connection.finalized) return;
    connection.closeReason = reason;
    if (countFailure) {
      const now = performance.now();
      pruneFailures(failures, now);
      const existing = failures.get(connection.remoteAddress);
      if (!existing || now - existing.since >= FAILURE_WINDOW_MS) {
        failures.set(connection.remoteAddress, { count: 1, since: now });
      } else {
        existing.count += 1;
      }
    }
    connection.socket.destroy();
    finalize(connection, reason);
  };

  const allowAppPacket = (connection: HostConnection): boolean => connection.appRate.take();

  const sendControl = (connection: HostConnection, packet: JsonRecord): boolean =>
    sendPacket(connection.socket, connection.secure ? connection.secure.seal(packet) : packet, MAX_AUTH_FRAME_BYTES, connection.established, (bytes) => {
      connection.authBytes += bytes;
      return connection.authBytes <= MAX_AUTH_BYTES;
    });

  const startHeartbeat = (connection: HostConnection): void => {
    connection.lastMatchedPongAt = performance.now();
    connection.heartbeatTimer = setInterval(() => {
      if (connection.finalized || !connection.established) return;
      const now = performance.now();
      if (now - connection.lastMatchedPongAt >= HEARTBEAT_TIMEOUT_MS) {
        terminate(connection, "heartbeat timeout");
        return;
      }
      if (connection.outstandingPing !== null) return;
      const id = ++connection.nextPingId;
      if (!sendControl(connection, { type: "ping", version: VERSION, id })) {
        if (!connection.socket.destroyed) terminate(connection, "heartbeat write failed");
        return;
      }
      connection.outstandingPing = id;
    }, HEARTBEAT_INTERVAL_MS);
    connection.heartbeatTimer.unref();
  };

  const onAuthenticatedPacket = (connection: HostConnection, packet: JsonRecord): void => {
    if (!exactKeys(packet, ["type", "version", "seq", "payload"]) || packet.type !== "data" ||
        packet.version !== VERSION || !Number.isSafeInteger(packet.seq) || !isPlainRecord(packet.payload)) {
      return terminate(connection, "invalid application frame");
    }
    const seq = packet.seq as number;
    if (seq !== connection.receiveSequence + 1) return terminate(connection, "invalid sequence");
    if (!allowAppPacket(connection)) return terminate(connection, "application rate exceeded");
    connection.receiveSequence = seq;
    if (!connection.peerId || !connection.name) return terminate(connection, "invalid peer state");
    try {
      handlers.message(
        { peerId: connection.peerId, name: connection.name, remoteAddress: connection.remoteAddress },
        packet.payload,
      );
    } catch {
      // Application handlers are isolated from the socket state machine.
      reportHostError(handlers, "room message handler failed");
    }
  };

  const onControlPacket = (connection: HostConnection, packet: JsonRecord): boolean => {
    if(packet.type==='leave'){
      if(!exactKeys(packet,['type','version'])||packet.version!==VERSION||!connection.peerId)return false;
      // Identity comes only from this authenticated stream; no claimed peerId is accepted.
      connection.explicitDisconnect=true;resumeTokens.delete(connection.peerId);pendingResume.delete(connection.peerId);
      connection.closeReason=ROOM_INTENTIONAL_LEAVE;
      void finalize(connection,ROOM_INTENTIONAL_LEAVE).then(()=>{if(!sendControl(connection,{type:'left',version:VERSION}))connection.socket.destroy();else connection.socket.end();});return true;
    }
    if (!exactKeys(packet, ["type", "version", "id"]) || packet.version !== VERSION ||
        !Number.isSafeInteger(packet.id) || (packet.id as number) < 1) return false;
    const id = packet.id as number;
    if (packet.type === "ping") {
      if (id !== connection.lastRemotePingId + 1) return false;
      connection.lastRemotePingId = id;
      return sendControl(connection, { type: "pong", version: VERSION, id });
    }
    if (packet.type === "pong") {
      if (connection.outstandingPing !== id) return false;
      connection.outstandingPing = null;
      connection.lastMatchedPongAt = performance.now();
      return true;
    }
    return false;
  };

  const processFrame = (connection: HostConnection, packet: JsonRecord): void => {
    if (typeof packet.type !== "string") return terminate(connection, "invalid packet", !connection.established);

    if (connection.state === "challenge") {
      if (packet.type === "auth" && (packet.version !== VERSION || packet.capabilities !== ROOM_CAPABILITIES)) {reportHostError(handlers, ROOM_VERSION_MISMATCH);return terminate(connection, "room version mismatch", true);}
      const baseKeys = ["type", "version", "peerId", "identity", "clientNonce", "proof", "capabilities"];
      const hasResume = Object.prototype.hasOwnProperty.call(packet, "resumeProof");
      if (!exactKeys(packet, hasResume ? [...baseKeys, "resumeProof"] : baseKeys) || packet.type !== "auth" ||
          packet.version !== VERSION || packet.capabilities !== ROOM_CAPABILITIES || !isPeerId(packet.peerId) || !isPlainRecord(packet.identity) ||
          typeof packet.clientNonce !== "string" || !decodeSecret(packet.clientNonce) ||
          typeof packet.proof !== "string") {
        return terminate(connection, "authentication failed", true);
      }
      const peerId = packet.peerId;
      if(peerId===hostId)return terminate(connection,"duplicate host identity",true);
      const transcript = canonicalTranscript(roomId, hostId, peerId, "", connection.serverNonce, packet.clientNonce);
      if (!equalMac(packet.proof, hmac(inviteKey, "client-proof", transcript))) {
        return terminate(connection, "authentication failed", true);
      }
      connection.secure = new SecureFrames(inviteKey, transcript, "host");
      let identity:JsonRecord;try{identity=connection.secure.open(packet.identity as JsonRecord);}catch{return terminate(connection,"authentication failed",true);}
      if(!exactKeys(identity,["name"])||!validRoomName(identity.name))return terminate(connection,"invalid identity",true);
      const name=identity.name;
      const authNow = performance.now();
      for (const [reservedId, expires] of pendingResume) if (expires <= authNow) {
        pendingResume.delete(reservedId);
        resumeTokens.delete(reservedId);
      }
      const existingToken = resumeTokens.get(peerId);
      if (activeByPeer.has(peerId)) return terminate(connection, "duplicate peer identity", true);
      if (existingToken) {
        if (!hasResume || typeof packet.resumeProof !== "string" ||
            !equalMac(packet.resumeProof, hmac(decodeSecret(existingToken)!, "resume-proof", transcript))) {
          return terminate(connection, "resume proof required", true);
        }
      } else if (hasResume) {
        return terminate(connection, "unknown resume identity", true);
      }
      const rejection=activeByPeer.size>=MAX_GUESTS?'房间席位已满（4人），请等好友离房后再加入。':handlers.admit?.({peerId,name,remoteAddress:connection.remoteAddress},[...connections].flatMap(c=>c!==connection&&!c.finalized&&c.state==='finish'&&c.peerId?[c.peerId]:[]));
      if(rejection){sendControl(connection,{type:'rejected',version:VERSION,message:sanitizeReason(rejection)});connection.closeReason='admission rejected';finalize(connection,connection.closeReason);connection.socket.end();return;}
      if (!existingToken && pendingResume.size >= MAX_UNAUTHENTICATED) return terminate(connection, "pending identities are full");

      const resumeToken = existingToken ?? randomSecret();
      if (!existingToken) {
        resumeTokens.set(peerId, resumeToken);
        pendingResume.set(peerId, authNow + 30_000);
      }
      const serverProof = hmac(inviteKey, "server-proof", transcript, resumeToken);
      connection.peerId = peerId;
      connection.name = name;
      connection.clientNonce = packet.clientNonce;
      connection.transcript = transcript;
      connection.resumeToken = resumeToken;
      connection.state = "finish";
      if (!sendControl(connection, {
        type: "welcome",
        version: VERSION,
        roomId,
        hostId,
        resumeToken,
        proof: serverProof,
      })) terminate(connection, "handshake write failed");
      return;
    }

    if (connection.state === "finish") {
      if (!exactKeys(packet, ["type", "version", "roomId", "peerId", "proof"]) || packet.type !== "finish" ||
          packet.version !== VERSION || packet.roomId !== roomId || packet.peerId !== connection.peerId ||
          !connection.transcript || !connection.resumeToken ||
          !equalMac(packet.proof, hmac(inviteKey, "client-finish", connection.transcript, connection.resumeToken,
            hmac(inviteKey, "server-proof", connection.transcript, connection.resumeToken)))) {
        return terminate(connection, "finish authentication failed", true);
      }
      if (!connection.peerId || !connection.name || !connection.resumeToken) return terminate(connection, "invalid peer state");
      const peerId = connection.peerId;
      if (activeByPeer.has(peerId)) return terminate(connection, "duplicate peer identity", true);
      if (activeByPeer.size >= MAX_GUESTS) return terminate(connection, "room is full");
      const pending = pendingByAddress.get(connection.remoteAddress) ?? 0;
      if (pending <= 1) pendingByAddress.delete(connection.remoteAddress);
      else pendingByAddress.set(connection.remoteAddress, pending - 1);
      resumeTokens.set(peerId, connection.resumeToken);
      pendingResume.delete(peerId);
      connection.established = true;
      connection.state = "ready";
      connection.receiveSequence = 0;
      connection.sendSequence = 0;
      activeByPeer.set(peerId, connection);
      if (connection.handshakeTimer) clearTimeout(connection.handshakeTimer);
      connection.handshakeTimer = null;
      const readySent = sendControl(connection, { type: "ready", version: VERSION, roomId, hostId });
      if (!readySent) return terminate(connection, "handshake write failed");
      try {
        handlers.peerJoined({ peerId, name: connection.name, remoteAddress: connection.remoteAddress });
      } catch {
        reportHostError(handlers, "room peer handler failed");
      }
      startHeartbeat(connection);
      return;
    }

    if (!connection.established) return terminate(connection, "data before authentication");
    if (packet.type === "data") return onAuthenticatedPacket(connection, packet);
    if (!onControlPacket(connection, packet)) return terminate(connection, "invalid control frame");
  };

  server.on("connection", (socket) => {
    if (closed) return socket.destroy();
    socket.setNoDelay(true);
    const remoteAddress = normalizeRemoteAddress(socket.remoteAddress);
    const now = performance.now();
    pruneFailures(failures, now);
    const failureRecord = failures.get(remoteAddress);
    if (failureRecord && now - failureRecord.since < FAILURE_WINDOW_MS && failureRecord.count >= FAILURE_LIMIT) {
      socket.destroy();
      return;
    }
    const pending = pendingByAddress.get(remoteAddress) ?? 0;
    if ([...connections].filter((connection) => !connection.established && !connection.finalized).length >= MAX_UNAUTHENTICATED ||
        pending >= MAX_UNAUTHENTICATED) {
      socket.destroy();
      return;
    }
    pendingByAddress.set(remoteAddress, pending + 1);

    const connection: HostConnection = {
      socket,
      secure: null,
      remoteAddress,
      peerId: null,
      name: null,
      state: "challenge",
      established: false,
      finalized: false,
      explicitDisconnect: false,
      closeReason: "connection closed",
      authBytes: 0,
      serverNonce: randomSecret(),
      clientNonce: null,
      transcript: null,
      resumeToken: null,
      sendSequence: 0,
      receiveSequence: 0,
      nextPingId: 0,
      lastRemotePingId: 0,
      outstandingPing: null,
      lastMatchedPongAt: performance.now(),
      appRate: new RateGate(),
      handshakeTimer: null,
      heartbeatTimer: null,
      reader: null as unknown as FrameReader,
    };
    connection.reader = new FrameReader(
      () => connection.established ? MAX_FRAME_BYTES : MAX_AUTH_FRAME_BYTES,
      (bytes) => {
        if (connection.established) return true;
        connection.authBytes += bytes;
        return connection.authBytes <= MAX_AUTH_BYTES;
      },
      (frame) => {
        let packet = parseJsonRecord(frame);
        if (!packet) return terminate(connection, "invalid packet", !connection.established);
        if(connection.secure){try{packet=connection.secure.open(packet);}catch(e){return terminate(connection,e instanceof Error?e.message:"invalid secure frame",!connection.established);}}
        processFrame(connection, packet);
      },
      (reason) => terminate(connection, reason, !connection.established),
    );
    connections.add(connection);
    connection.handshakeTimer = setTimeout(() => terminate(connection, "handshake timeout", true), HANDSHAKE_TIMEOUT_MS);
    connection.handshakeTimer.unref();
    socket.on("data", (chunk) => connection.reader.push(chunk));
    socket.on("error", () => {
      if (!connection.finalized) {
        connection.closeReason = "connection error";
        finalize(connection, connection.closeReason);
      }
    });
    socket.on("close", () => finalize(connection, connection.closeReason));
    if (!sendControl(connection, {
      type: "challenge",
      version: VERSION,
      roomId,
      hostId,
      serverNonce: connection.serverNonce,
      capabilities: ROOM_CAPABILITIES,
    })) terminate(connection, "challenge write failed");
  });

  server.on("error", () => reportHostError(handlers, "room host socket error"));

  await new Promise<void>((resolve, reject) => {
    const onError = (): void => {
      server.off("listening", onListening);
      reject(new Error("Could not start room host"));
    };
    const onListening = (): void => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen({ host: options.bind, port: options.port ?? 0, exclusive: true });
  });
  listening = true;
  const bound = server.address();
  if (!bound || typeof bound === "string" || !net.isIPv4(bound.address)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error("Could not read room host address");
  }
  actualAddress = `${options.bind}:${bound.port}`;

  const host: RoomHost = {
    roomId,
    hostId,
    address: actualAddress,
    key,
    get peers() {
      return [...activeByPeer.values()].flatMap((connection) => connection.peerId && connection.name
        ? [{ peerId: connection.peerId, name: connection.name, remoteAddress: connection.remoteAddress }]
        : []);
    },
    send(peerId, payload) {
      const connection = activeByPeer.get(peerId);
      if (!connection || connection.finalized || !connection.established || !isPlainRecord(payload)) return false;
      if (!allowAppPacket(connection)) return false;
      const sequence = connection.sendSequence + 1;
      let encrypted:JsonRecord;try{encrypted=connection.secure!.seal({
        type: "data",
        version: VERSION,
        seq: sequence,
        payload,
      });}catch{return false;}
      const accepted = sendPacket(connection.socket, encrypted, MAX_FRAME_BYTES, true, () => true);
      if (accepted) connection.sendSequence = sequence;
      return accepted;
    },
    disconnect(peerId, reason = "disconnected") {
      const connection = activeByPeer.get(peerId);
      if (connection) terminate(connection, sanitizeReason(reason));
    },
    async close() {
      if (closed) return;
      closed = true;
      for (const connection of [...connections]) terminate(connection, "room closed");
      if (listening) await new Promise<void>((resolve) => server.close(() => resolve()));
      resumeTokens.clear();
      pendingResume.clear();
      failures.clear();
      pendingByAddress.clear();
    },
  };
  return host;
}

function sanitizeReason(value: string): string {
  if (typeof value !== "string") return "disconnected";
  const cleaned = value.replace(/[\u0000-\u001f\u007f-\u009f]/gu, " ").trim().slice(0, 80);
  return cleaned || "disconnected";
}

interface ClientConnection {
  socket: net.Socket;
  established: boolean;
  explicitClose: boolean;
  finalized: boolean;
  closeReason: string;
  authBytes: number;
  sendSequence: number;
  receiveSequence: number;
  nextPingId: number;
  lastRemotePingId: number;
  outstandingPing: number | null;
  lastMatchedPongAt: number;
  appRate: RateGate;
  heartbeatTimer: NodeJS.Timeout | null;
  reader: FrameReader;
}

export async function joinRoom(options: ClientOptions, handlers: ClientHandlers): Promise<RoomClient> {
  if (!isPeerId(options.peerId) || !validRoomName(options.name)) throw new Error("Invalid client identity");
  const address = parseRoomAddress(options.address);
  const inviteKey = decodeSecret(options.key);
  if (!inviteKey) throw new Error("Invalid room key");
  if (options.resume && (!decodeSecret(options.resume.roomId) || !decodeSecret(options.resume.token))) {
    throw new Error("Invalid resume credential");
  }

  const socket = net.createConnection({ host: address.host, port: address.port });
  socket.setNoDelay(true);
  let settled = false;
  let clientConnection: ClientConnection | null = null;
  let readerRef: FrameReader | null = null;
  let authBytes = 0;
  let expectedRoomId = "";
  let expectedHostId = "";
  let serverNonce = "";
  let clientNonce = "";
  let transcript = "";
  let secure:SecureFrames|null=null;
  let resumeCredential: ResumeCredential | null = null;
  let leavePromise:Promise<void>|undefined,acknowledgeLeave:(()=>void)|undefined,rejectLeave:((error:Error)=>void)|undefined;
  let state: "challenge" | "welcome" | "ready" | "connected" = "challenge";
  let handshakeTimer: NodeJS.Timeout;
  let resolveJoin!: (client: RoomClient) => void;
  let rejectJoin!: (error: Error) => void;
  const joined = new Promise<RoomClient>((resolve, reject) => {
    resolveJoin = resolve;
    rejectJoin = reject;
  });

  const recordAuthBytes = (bytes: number): boolean => {
    if (clientConnection?.established) return true;
    authBytes += bytes;
    if (clientConnection) clientConnection.authBytes = authBytes;
    return authBytes <= MAX_AUTH_BYTES;
  };

  const failJoin = (message: string): void => {
    if (settled) return;
    settled = true;
    clearTimeout(handshakeTimer);
    readerRef?.stop();
    socket.destroy();
    rejectJoin(new Error(message));
  };

  const finalizeClient = (reason: string): void => {
    if (!clientConnection || clientConnection.finalized) return;
    const connection = clientConnection;
    connection.finalized = true;
    connection.reader.stop();
    rejectLeave?.(new Error("离房确认未收到，房主可能暂留断线席位30秒。"));rejectLeave=undefined;acknowledgeLeave=undefined;
    if (connection.heartbeatTimer) clearInterval(connection.heartbeatTimer);
    if (!connection.explicitClose) {
      try {
        handlers.closed(reason);
      } catch {
        // User handlers must not break transport cleanup.
      }
    }
  };

  const sendClientControl = (packet: JsonRecord): boolean => sendPacket(socket, secure ? secure.seal(packet) : packet, MAX_AUTH_FRAME_BYTES,
    clientConnection?.established ?? false, recordAuthBytes);

  const startClientHeartbeat = (connection: ClientConnection): void => {
    connection.lastMatchedPongAt = performance.now();
    connection.heartbeatTimer = setInterval(() => {
      if (connection.finalized || !connection.established) return;
      const now = performance.now();
      if (now - connection.lastMatchedPongAt >= HEARTBEAT_TIMEOUT_MS) {
        connection.closeReason = "heartbeat timeout";
        socket.destroy();
        finalizeClient(connection.closeReason);
        return;
      }
      if (connection.outstandingPing !== null) return;
      const id = ++connection.nextPingId;
      if (!sendClientControl({ type: "ping", version: VERSION, id })) {
        if (!socket.destroyed) socket.destroy();
        connection.closeReason = "heartbeat write failed";
        finalizeClient(connection.closeReason);
        return;
      }
      connection.outstandingPing = id;
    }, HEARTBEAT_INTERVAL_MS);
    connection.heartbeatTimer.unref();
  };

  const onClientData = (packet: JsonRecord, connection: ClientConnection): void => {
    if (!exactKeys(packet, ["type", "version", "seq", "payload"]) || packet.type !== "data" ||
        packet.version !== VERSION || !Number.isSafeInteger(packet.seq) || !isPlainRecord(packet.payload)) {
      connection.closeReason = "invalid application frame";
      socket.destroy();
      finalizeClient(connection.closeReason);
      return;
    }
    const seq = packet.seq as number;
    if (seq !== connection.receiveSequence + 1) {
      connection.closeReason = "invalid sequence";
      socket.destroy();
      finalizeClient(connection.closeReason);
      return;
    }
    if (!connection.appRate.take()) {
      connection.closeReason = "application rate exceeded";
      socket.destroy();
      finalizeClient(connection.closeReason);
      return;
    }
    connection.receiveSequence = seq;
    try {
      handlers.message(packet.payload);
    } catch {
      // Application handlers are isolated from transport cleanup.
    }
  };

  const onClientControl = (packet: JsonRecord, connection: ClientConnection): boolean => {
    if(packet.type==='left'){
      if(!exactKeys(packet,['type','version'])||packet.version!==VERSION||!acknowledgeLeave)return false;
      const done=acknowledgeLeave;acknowledgeLeave=undefined;rejectLeave=undefined;done();return true;
    }
    if (!exactKeys(packet, ["type", "version", "id"]) || packet.version !== VERSION ||
        !Number.isSafeInteger(packet.id) || (packet.id as number) < 1) return false;
    const id = packet.id as number;
    if (packet.type === "ping") {
      if (id !== connection.lastRemotePingId + 1) return false;
      connection.lastRemotePingId = id;
      return sendClientControl({ type: "pong", version: VERSION, id });
    }
    if (packet.type === "pong") {
      if (connection.outstandingPing !== id) return false;
      connection.outstandingPing = null;
      connection.lastMatchedPongAt = performance.now();
      return true;
    }
    return false;
  };

  const reader = new FrameReader(
    () => clientConnection?.established ? MAX_FRAME_BYTES : MAX_AUTH_FRAME_BYTES,
    recordAuthBytes,
    (frame) => {
      let packet = parseJsonRecord(frame);
      if (!packet || typeof packet.type !== "string") {
        if (clientConnection) {
          clientConnection.closeReason = "invalid packet";
          socket.destroy();
          finalizeClient(clientConnection.closeReason);
        } else failJoin("Room authentication failed");
        return;
      }
      if(secure){try{packet=secure.open(packet);}catch{if(clientConnection){clientConnection.closeReason="invalid secure frame";socket.destroy();finalizeClient(clientConnection.closeReason);}else failJoin("Room authentication failed");return;}}
      if (state === "challenge") {
        if (packet.type === "challenge" && (packet.version !== VERSION || packet.capabilities !== ROOM_CAPABILITIES)) return failJoin(ROOM_VERSION_MISMATCH);
        if (!exactKeys(packet, ["type", "version", "roomId", "hostId", "serverNonce", "capabilities"]) ||
            packet.type !== "challenge" || packet.version !== VERSION || packet.capabilities !== ROOM_CAPABILITIES || typeof packet.roomId !== "string" ||
            !decodeSecret(packet.roomId) || !isPeerId(packet.hostId) || typeof packet.serverNonce !== "string" ||
            !decodeSecret(packet.serverNonce) ||
            (options.resume && options.resume.roomId !== packet.roomId)) return failJoin("Room authentication failed");
        expectedRoomId = packet.roomId;
        expectedHostId = packet.hostId;
        serverNonce = packet.serverNonce;
        clientNonce = randomSecret();
        transcript = canonicalTranscript(expectedRoomId, expectedHostId, options.peerId, options.name, serverNonce, clientNonce);
        const stream=new SecureFrames(inviteKey,transcript,"client");
        const auth: JsonRecord = {
          type: "auth",
          version: VERSION,
          peerId: options.peerId,
          capabilities: ROOM_CAPABILITIES,
          identity: stream.seal({name:options.name}),
          clientNonce,
          proof: hmac(inviteKey, "client-proof", transcript),
        };
        if (options.resume) auth.resumeProof = hmac(decodeSecret(options.resume.token)!, "resume-proof", transcript);
        state = "welcome";
        if (!sendPacket(socket,auth,MAX_AUTH_FRAME_BYTES,false,recordAuthBytes)) return failJoin("Room authentication failed");
        secure=stream;
        return;
      }
      if (state === "welcome") {
        if(packet.type==='rejected'&&exactKeys(packet,['type','version','message'])&&packet.version===VERSION&&typeof packet.message==='string'&&packet.message.startsWith('房间席位')&&packet.message.length<=80)return failJoin(packet.message);
        if (!exactKeys(packet, ["type", "version", "roomId", "hostId", "resumeToken", "proof"]) ||
            packet.type !== "welcome" || packet.version !== VERSION || packet.roomId !== expectedRoomId ||
            packet.hostId !== expectedHostId || typeof packet.resumeToken !== "string" || !decodeSecret(packet.resumeToken) ||
            !equalMac(packet.proof, hmac(inviteKey, "server-proof", transcript, packet.resumeToken))) {
          return failJoin("Room authentication failed");
        }
        resumeCredential = { roomId: expectedRoomId, token: packet.resumeToken as string };
        try {
          handlers.credential?.({ ...resumeCredential });
        } catch {
          return failJoin("Could not retain room credential");
        }
        const serverProof = packet.proof as string;
        const finishProof = hmac(inviteKey, "client-finish", transcript, resumeCredential.token, serverProof);
        state = "ready";
        if (!sendClientControl({
          type: "finish",
          version: VERSION,
          roomId: expectedRoomId,
          peerId: options.peerId,
          proof: finishProof,
        })) failJoin("Room authentication failed");
        return;
      }
      if (state === "ready") {
        if (!exactKeys(packet, ["type", "version", "roomId", "hostId"]) || packet.type !== "ready" ||
            packet.version !== VERSION || packet.roomId !== expectedRoomId || packet.hostId !== expectedHostId ||
            !resumeCredential) return failJoin("Room authentication failed");
        state = "connected";
        settled = true;
        clearTimeout(handshakeTimer);
        const connection: ClientConnection = {
          socket,
          established: true,
          explicitClose: false,
          finalized: false,
          closeReason: "connection closed",
          authBytes,
          sendSequence: 0,
          receiveSequence: 0,
          nextPingId: 0,
          lastRemotePingId: 0,
          outstandingPing: null,
          lastMatchedPongAt: performance.now(),
          appRate: new RateGate(),
          heartbeatTimer: null,
          reader,
        };
        clientConnection = connection;
        const client: RoomClient = {
          resume: resumeCredential,
          roomId: expectedRoomId,
          hostId: expectedHostId,
          send(payload) {
            if (connection.finalized || connection.explicitClose || !connection.established || !isPlainRecord(payload)) return false;
            if (!connection.appRate.take()) return false;
            const sequence = connection.sendSequence + 1;
            let encrypted:JsonRecord;try{encrypted=secure!.seal({
              type: "data",
              version: VERSION,
              seq: sequence,
              payload,
            });}catch{return false;}
            const accepted = sendPacket(socket, encrypted, MAX_FRAME_BYTES, true, recordAuthBytes);
            if (accepted) connection.sendSequence = sequence;
            return accepted;
          },
          async leave(){
            if(leavePromise)return leavePromise;
            if(connection.finalized){leavePromise=Promise.reject(new Error('离房确认未收到，房主可能暂留断线席位30秒。'));return leavePromise;}
            connection.explicitClose=true;
            leavePromise=(async()=>{
              try{await new Promise<void>((resolve,reject)=>{
                const timer=setTimeout(()=>{acknowledgeLeave=undefined;rejectLeave=undefined;reject(new Error('离房确认未收到，房主可能暂留断线席位30秒。'));},1000);timer.unref();
                acknowledgeLeave=()=>{clearTimeout(timer);resolve();};rejectLeave=error=>{clearTimeout(timer);reject(error);};
                if(!sendClientControl({type:'leave',version:VERSION})){clearTimeout(timer);acknowledgeLeave=undefined;rejectLeave=undefined;reject(new Error('离房连接已中断，房主可能暂留席位30秒。'));}
              });}finally{await client.close();}
            })();return leavePromise;
          },
          async close() {
            if (connection.finalized) return;
            connection.explicitClose = true;
            connection.closeReason = "client closed";
            connection.reader.stop();
            if (connection.heartbeatTimer) clearInterval(connection.heartbeatTimer);
            connection.finalized = true;
            connection.established = false;
            await new Promise<void>((resolve) => {
              if (socket.destroyed) return resolve();
              const forceClose = setTimeout(() => socket.destroy(), 1_000);
              forceClose.unref();
              socket.once("close", () => {
                clearTimeout(forceClose);
                resolve();
              });
              socket.end();
            });
          },
        };
        startClientHeartbeat(connection);
        resolveJoin(client);
        return;
      }

      const connection = clientConnection;
      if (!connection || !connection.established) return failJoin("Room authentication failed");
      if (packet.type === "data") return onClientData(packet, connection);
      if (!onClientControl(packet, connection)) {
        connection.closeReason = "invalid control frame";
        socket.destroy();
        finalizeClient(connection.closeReason);
      }
    },
    (reason) => {
      if (clientConnection) {
        clientConnection.closeReason = reason;
        socket.destroy();
        finalizeClient(reason);
      } else failJoin("Room authentication failed");
    },
  );
  readerRef = reader;

  // Keep the reader available to the authenticated connection without exposing it publicly.
  socket.on("data", (chunk) => reader.push(chunk));
  socket.on("error", () => {
    if (!settled) failJoin("Could not connect to room");
    else if (clientConnection) {
      clientConnection.closeReason = "connection error";
      finalizeClient(clientConnection.closeReason);
    }
  });
  socket.on("close", () => {
    if (!settled) failJoin("Room authentication failed");
    else if (clientConnection) finalizeClient(clientConnection.closeReason);
  });
  handshakeTimer = setTimeout(() => failJoin("Room handshake timed out"), HANDSHAKE_TIMEOUT_MS);
  handshakeTimer.unref();
  return joined;
}
