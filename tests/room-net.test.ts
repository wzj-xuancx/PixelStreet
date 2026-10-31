import test from "node:test";
import assert from "node:assert/strict";
import * as net from "node:net";
import { createHmac, randomBytes } from "node:crypto";
import {
  hostRoom,
  joinRoom,
  localRoomAddresses,
  parseRoomAddress,
  validRoomName,
  type HostHandlers,
  type RoomHost,
} from "../packages/room-net/index";

import {SecureFrames,ROOM_PROTOCOL_VERSION,ROOM_CAPABILITIES} from '../packages/room-net/secure-frame';
const VERSION = ROOM_PROTOCOL_VERSION;
const mac = (key: Buffer, domain: string, transcript: string, ...extra: string[]): string => {
  const digest = createHmac("sha256", key).update(`pixelstreet/room-${domain}/v1\n`).update(transcript);
  for (const value of extra) digest.update("\n").update(value);
  return digest.digest("base64url");
};
const secret = (): string => randomBytes(16).toString("base64url");
const transcriptFor = (roomId: string, hostId: string, peerId: string, name: string, serverNonce: string, clientNonce: string): string =>
  JSON.stringify({ protocolVersion: VERSION, roomId, hostId, peerId, capabilities:ROOM_CAPABILITIES, serverNonce, clientNonce });
const packetFrame = (packet: Record<string, unknown>): Buffer => {
  const body = Buffer.from(JSON.stringify(packet), "utf8");
  const frame = Buffer.alloc(body.length + 4);
  frame.writeUInt32BE(body.length, 0);
  body.copy(frame, 4);
  return frame;
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

class RawFrames {
  secure?:SecureFrames;
  private bytes = Buffer.alloc(0);
  private frames: Record<string, unknown>[] = [];
  private waiters: Array<{ resolve(value: Record<string, unknown>): void; reject(error: Error): void }> = [];
  private failure: Error | null = null;

  constructor(private readonly socket: net.Socket) {
    socket.on("data", (chunk) => {
      this.bytes = Buffer.concat([this.bytes, chunk]);
      this.pump();
    });
    socket.on("close", () => this.fail(new Error("raw socket closed")));
    socket.on("error", () => this.fail(new Error("raw socket error")));
  }

  next(timeoutMs = 2_000): Promise<Record<string, unknown>> {
    const ready = this.frames.shift();
    if (ready) return Promise.resolve(this.secure?this.secure.open(ready):ready);
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject };
      this.waiters.push(waiter);
      const timeout = setTimeout(() => {
        this.waiters = this.waiters.filter((item) => item !== waiter);
        reject(new Error("raw frame timed out"));
      }, timeoutMs);
      timeout.unref();
      const originalResolve = waiter.resolve;
      waiter.resolve = (value) => { clearTimeout(timeout);try{originalResolve(this.secure?this.secure.open(value as Record<string,unknown>):value);}catch(e){reject(e);} };
      const originalReject = waiter.reject;
      waiter.reject = (error) => { clearTimeout(timeout); originalReject(error); };
    });
  }

  private pump(): void {
    while (this.bytes.length >= 4) {
      const length = this.bytes.readUInt32BE(0);
      if (length < 1 || length > 360 * 1024) return this.fail(new Error("invalid test frame"));
      if (this.bytes.length < length + 4) return;
      const body = this.bytes.subarray(4, length + 4);
      this.bytes = this.bytes.subarray(length + 4);
      try {
        const packet: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
        if (!packet || typeof packet !== "object" || Array.isArray(packet)) throw new Error("invalid test packet");
        const record = packet as Record<string, unknown>;
        const waiter = this.waiters.shift();
        if (waiter) waiter.resolve(record);
        else this.frames.push(record);
      } catch {
        this.fail(new Error("invalid server packet"));
        return;
      }
    }
  }

  private fail(error: Error): void {
    if (this.failure) return;
    this.failure = error;
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
  }
}

async function openRaw(address: string): Promise<{ socket: net.Socket; frames: RawFrames }> {
  const parsed = parseRoomAddress(address);
  const socket = net.createConnection(parsed);
  socket.setNoDelay(true);
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  return { socket, frames: new RawFrames(socket) };
}

async function rawHandshake(
  frames: RawFrames,
  socket: net.Socket,
  keyText: string,
  peerId: string,
  name: string,
  fragmentAuth = false,
): Promise<Buffer> {
  const challenge = await frames.next();
  assert.equal(challenge.type, "challenge");
  const roomId = challenge.roomId as string;
  const hostId = challenge.hostId as string;
  const serverNonce = challenge.serverNonce as string;
  const clientNonce = secret();
  const transcript = transcriptFor(roomId, hostId, peerId, name, serverNonce, clientNonce);
  const key = Buffer.from(keyText, "base64url");
  const auth = packetFrame({
    type: "auth",
    version: VERSION,
    peerId,
    capabilities:ROOM_CAPABILITIES,
    identity:(frames.secure=new SecureFrames(key,transcript,"client")).seal({name}),
    clientNonce,
    proof: mac(key, "client-proof", transcript),
  });
  if (fragmentAuth) {
    socket.write(auth.subarray(0, 2));
    await new Promise((resolve) => setTimeout(resolve, 10));
    socket.write(auth.subarray(2, 5));
    await new Promise((resolve) => setTimeout(resolve, 10));
    socket.write(auth.subarray(5));
  } else socket.write(auth);
  const welcome = await frames.next();
  assert.equal(welcome.type, "welcome");
  const token = welcome.resumeToken as string;
  const proof = welcome.proof as string;
  return packetFrame(frames.secure!.seal({
    type: "finish",
    version: VERSION,
    roomId,
    peerId,
    proof: mac(key, "client-finish", transcript, token, proof),
  }));
}

function hostHandlers(overrides: Partial<HostHandlers> = {}): HostHandlers {
  return {
    peerJoined() {},
    peerLeft() {},
    message() {},
    error() {},
    ...overrides,
  };
}

async function makeHost(handlers: Partial<HostHandlers> = {}): Promise<RoomHost> {
  return hostRoom({ peerId: "a".repeat(32), name: "Host", bind: "127.0.0.1" }, hostHandlers(handlers));
}

function clientOptions(host: RoomHost, peerId: string, name = "Guest", key = host.key) {
  return { peerId, name, address: host.address, key };
}

test("private IPv4 helpers reject DNS and public addresses; names are bounded Unicode", () => {
  assert.deepEqual(localRoomAddresses().at(-1), "127.0.0.1");
  assert.deepEqual(parseRoomAddress("192.168.1.4:1234"), { host: "192.168.1.4", port: 1234 });
  for (const value of ["example.test:1234", "8.8.8.8:1234", "192.168.1.4:0", "192.168.1.4:65536"]) {
    assert.throws(() => parseRoomAddress(value));
  }
  assert.equal(validRoomName("阿青🙂"), true);
  assert.equal(validRoomName("  guest"), false);
  assert.equal(validRoomName("guest\u0085"), false);
  assert.equal(validRoomName("e\u0301"), false);
});

test("authenticated local peers exchange bounded application records and explicit close is quiet", async (t) => {
  const incoming = deferred<Record<string, unknown>>();
  const clientIncoming = deferred<Record<string, unknown>>();
  const left = deferred<string>();
  let explicitClosedCallbacks = 0;
  const host = await makeHost({
    peerLeft(_peer, reason) { left.resolve(reason); },
    message(peer, payload) {
      assert.equal(peer.peerId, "b".repeat(32));
      incoming.resolve(payload);
    },
  });
  t.after(() => host.close());
  const client = await joinRoom(clientOptions(host, "b".repeat(32)), {
    message: (payload) => clientIncoming.resolve(payload),
    closed: () => { explicitClosedCallbacks += 1; },
  });
  assert.equal(host.peers.length, 1);
  assert.equal(client.send({ action: "hello", nested: { count: 2 } }), true);
  assert.deepEqual(await incoming.promise, { action: "hello", nested: { count: 2 } });
  assert.equal(host.send("b".repeat(32), { action: "ack" }), true);
  assert.deepEqual(await clientIncoming.promise, { action: "ack" });
  await client.close();
  await left.promise;
  assert.equal(explicitClosedCallbacks, 0);
  assert.equal(host.send("b".repeat(32), { action: "after-close" }), false);
});

test("wrong keys, duplicate peer IDs, and resume impersonation are rejected", async (t) => {
  const host = await makeHost();
  t.after(() => host.close());
  const first = await joinRoom(clientOptions(host, "c".repeat(32)), { message() {}, closed() {} });
  await assert.rejects(joinRoom(clientOptions(host, "d".repeat(32), "Wrong key", secret()), {
    message() {}, closed() {},
  }));
  await assert.rejects(joinRoom(clientOptions(host, "c".repeat(32)), { message() {}, closed() {} }));
  const resume = first.resume;
  await first.close();
  await assert.rejects(joinRoom({
    ...clientOptions(host, "c".repeat(32)),
    resume: { roomId: resume.roomId, token: secret() },
  }, { message() {}, closed() {} }));
  await assert.rejects(joinRoom(clientOptions(host, "c".repeat(32)), { message() {}, closed() {} }));
  const resumed = await joinRoom({ ...clientOptions(host, "c".repeat(32)), resume }, { message() {}, closed() {} });
  assert.equal(resumed.resume.token === resume.token, true);
  await resumed.close();
});

test("the host admits three guests and rejects a fourth", async (t) => {
  const host = await makeHost();
  const clients: Array<Awaited<ReturnType<typeof joinRoom>>> = [];
  t.after(async () => {
    await Promise.all(clients.map((client) => client.close()));
    await host.close();
  });
  for (const digit of ["1", "2", "3"]) {
    clients.push(await joinRoom(clientOptions(host, digit.repeat(32), `Guest ${digit}`), { message() {}, closed() {} }));
  }
  assert.equal(host.peers.length, 3);
  await assert.rejects(joinRoom(clientOptions(host, "4".repeat(32), "Guest 4"), { message() {}, closed() {} }));
  assert.equal(host.peers.length, 3);
});

test("raw TCP parser accepts fragmented authentication and coalesced finish plus data", async (t) => {
  const joined = deferred<void>();
  const received = deferred<Record<string, unknown>>();
  const left = deferred<string>();
  const host = await makeHost({
    peerJoined() { joined.resolve(); },
    peerLeft(_peer, reason) { left.resolve(reason); },
    message(_peer, payload) { received.resolve(payload); },
  });
  t.after(() => host.close());
  const raw = await openRaw(host.address);
  t.after(() => raw.socket.destroy());
  const finish = await rawHandshake(raw.frames, raw.socket, host.key, "e".repeat(32), "Raw", true);
  const data = packetFrame(raw.frames.secure!.seal({ type: "data", version: VERSION, seq: 1, payload: { fragment: true } }));
  raw.socket.write(Buffer.concat([finish, data]));
  const ready = await raw.frames.next();
  assert.equal(ready.type, "ready");
  await joined.promise;
  assert.deepEqual(await received.promise, { fragment: true });
  raw.socket.write(data);
  assert.equal(await left.promise, "invalid sequence");
});

test("raw TCP rejects invalid UTF-8 and oversized declared frames before authentication", async (t) => {
  const host = await makeHost();
  t.after(() => host.close());
  const invalidUtf8 = await openRaw(host.address);
  t.after(() => invalidUtf8.socket.destroy());
  await invalidUtf8.frames.next();
  invalidUtf8.socket.write(Buffer.from([0, 0, 0, 1, 0xff]));
  await new Promise<void>((resolve) => invalidUtf8.socket.once("close", () => resolve()));

  const oversized = await openRaw(host.address);
  t.after(() => oversized.socket.destroy());
  oversized.socket.write(Buffer.from([0, 4, 0, 1]));
  await new Promise<void>((resolve) => oversized.socket.once("close", () => resolve()));

  const empty = await openRaw(host.address);
  t.after(() => empty.socket.destroy());
  empty.socket.write(Buffer.alloc(4));
  await new Promise<void>((resolve) => empty.socket.once("close", () => resolve()));
  assert.equal(host.peers.length, 0);
});

test("client rejects a host that cannot prove the invitation key", async (t) => {
  const key = secret();
  const roomId = secret();
  const hostId = "7".repeat(32);
  const serverNonce = secret();
  const server = net.createServer((socket) => {
    const frames = new RawFrames(socket);
    socket.write(packetFrame({ type: "challenge", version: VERSION, roomId, hostId, serverNonce, capabilities:ROOM_CAPABILITIES }));
    void frames.next().then(() => socket.write(packetFrame({
      type: "welcome",
      version: VERSION,
      roomId,
      hostId,
      resumeToken: secret(),
      proof: randomBytes(32).toString("base64url"),
    }))).catch(() => socket.destroy());
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, resolve);
  });
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const bound = server.address();
  assert.ok(bound && typeof bound !== "string");
  await assert.rejects(joinRoom({
    peerId: "8".repeat(32),
    name: "Guest",
    address: `127.0.0.1:${bound.port}`,
    key,
  }, { message() {}, closed() {} }));
});

test("raw peer that does not answer heartbeats is removed", { timeout: 15_000 }, async (t) => {
  const left = deferred<string>();
  const host = await makeHost({ peerLeft(_peer, reason) { left.resolve(reason); } });
  t.after(() => host.close());
  const raw = await openRaw(host.address);
  t.after(() => raw.socket.destroy());
  const finish = await rawHandshake(raw.frames, raw.socket, host.key, "f".repeat(32), "Silent");
  raw.socket.write(finish);
  assert.equal((await raw.frames.next()).type, "ready");
  assert.equal(await left.promise, "heartbeat timeout");
});

test("paused raw TCP peer is disconnected when the bounded output queue fills", async (t) => {
  const left = deferred<string>();
  const host = await makeHost({ peerLeft(_peer, reason) { left.resolve(reason); } });
  t.after(() => host.close());
  const raw = await openRaw(host.address);
  t.after(() => raw.socket.destroy());
  const peerId = "9".repeat(32);
  const finish = await rawHandshake(raw.frames, raw.socket, host.key, peerId, "Paused");
  raw.socket.write(finish);
  assert.equal((await raw.frames.next()).type, "ready");
  raw.socket.pause();
  const payload = { blob: "x".repeat(220_000) };
  let rejected = false;
  for (let i = 0; i < 60; i += 1) {
    if (!host.send(peerId, payload)) {
      rejected = true;
      break;
    }
  }
  assert.equal(rejected, true, "the paused localhost peer should fill Node's bounded output queue");
  await left.promise;
  assert.equal(host.peers.some((peer) => peer.peerId === peerId), false);
});


test("0190 actual authenticated socket rejects old plaintext application envelopes",async(t)=>{
 const left=deferred<string>(),host=await makeHost({peerLeft(_peer,reason){left.resolve(reason);}});t.after(()=>host.close());const raw=await openRaw(host.address);t.after(()=>raw.socket.destroy());const finish=await rawHandshake(raw.frames,raw.socket,host.key,"6".repeat(32),"No fallback");raw.socket.write(finish);assert.equal((await raw.frames.next()).type,"ready");raw.socket.write(packetFrame({type:"data",version:VERSION,seq:1,payload:{type:"chat",text:"plaintext forbidden"}}));assert.equal(await left.promise,"invalid secure frame");
});
