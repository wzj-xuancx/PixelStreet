import test from "node:test";
import assert from "node:assert/strict";
import * as net from "node:net";
import {
  hostRoom,
  joinRoom,
  localRoomAddresses,
  parseRoomAddress,
  validRoomName,
  type ResumeCredential,
} from "../packages/room-net/index";

type DropTarget = { direction: "client-to-host" | "host-to-client"; type: string };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function startDropProxy(targetAddress: string, drop: DropTarget) {
  const separator = targetAddress.lastIndexOf(":");
  const targetHost = targetAddress.slice(0, separator);
  const targetPort = Number(targetAddress.slice(separator + 1));
  const dropped = deferred<void>();
  const sockets = new Set<net.Socket>();
  const server = net.createServer((client) => {
    sockets.add(client);
    client.setNoDelay(true);
    const upstream = net.createConnection({ host: targetHost, port: targetPort });
    sockets.add(upstream);
    upstream.setNoDelay(true);
    let clientBytes = Buffer.alloc(0);
    let hostBytes = Buffer.alloc(0);
    let ended = false;
    const stop = (): void => {
      if (ended) return;
      ended = true;
      client.destroy();
      upstream.destroy();
    };
    client.on("error", stop);
    upstream.on("error", stop);
    client.on("close", () => { sockets.delete(client); sockets.delete(upstream); });
    upstream.on("close", () => { sockets.delete(client); sockets.delete(upstream); });

    const forwardFrames = (from: net.Socket, to: net.Socket, direction: DropTarget["direction"]): void => {
      from.on("data", (chunk) => {
        if (ended) return;
        if (direction === "client-to-host") clientBytes = Buffer.concat([clientBytes, chunk]);
        else hostBytes = Buffer.concat([hostBytes, chunk]);
        let buffered = direction === "client-to-host" ? clientBytes : hostBytes;
        while (buffered.length >= 4) {
          const length = buffered.readUInt32BE(0);
          if (length < 1 || length > 360 * 1024) return stop();
          if (buffered.length < length + 4) break;
          const frame = buffered.subarray(0, length + 4);
          buffered = buffered.subarray(length + 4);
          if (direction === "client-to-host") clientBytes = buffered;
          else hostBytes = buffered;
          let type: unknown;
          try { const packet=JSON.parse(frame.subarray(4).toString("utf8"));type=packet.type;
            // Protocol3 deliberately hides message types. Drop the exact encrypted handshake boundary by direction/sequence.
            if(packet.type==='sealed')type=direction==='host-to-client'?(packet.seq==='1'?'welcome':packet.seq==='2'?'ready':'sealed'):(packet.seq==='2'?'finish':'sealed'); } catch { /* pass malformed frames through */ }
          if (direction === drop.direction && type === drop.type) {
            dropped.resolve();
            return stop();
          }
          to.write(frame);
        }
        if (direction === "client-to-host") clientBytes = buffered;
        else hostBytes = buffered;
      });
    };
    forwardFrames(client, upstream, "client-to-host");
    forwardFrames(upstream, client, "host-to-client");
    client.on("end", () => upstream.end());
    upstream.on("end", () => client.end());
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const bound = server.address();
  assert.ok(bound && typeof bound !== "string");
  return {
    address: `127.0.0.1:${bound.port}`,
    dropped: dropped.promise,
    async close() {
      for (const socket of sockets) socket.destroy();
      if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

async function until(predicate: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function makeHost(counts: { joined: number; left: number }) {
  return hostRoom({ peerId: "a".repeat(32), name: "Host", bind: "127.0.0.1" }, {
    peerJoined() { counts.joined += 1; },
    peerLeft() { counts.left += 1; },
    message() {},
    error() {},
  });
}

async function availableLoopbackPort(): Promise<number> {
  const probe = net.createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once("error", reject);
    probe.listen({ host: "127.0.0.1", port: 0, exclusive: true }, () => resolve());
  });
  const bound = probe.address();
  assert.ok(bound && typeof bound !== "string");
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return bound.port;
}

test("private IPv4, bind ownership, and Unicode bounds reject malformed inputs", async () => {
  const addresses = localRoomAddresses();
  assert.equal(addresses.at(-1), "127.0.0.1");
  assert.equal(new Set(addresses).size, addresses.length);
  assert.deepEqual(parseRoomAddress("100.64.0.1:1234"), { host: "100.64.0.1", port: 1234 });
  for (const address of [
    "8.8.8.8:1234", "example.test:1234", "[::1]:1234", "127.1:1234", "0x7f000001:1234",
    "192.168.001.1:1234", "192.168.1.256:1234", "100.63.0.1:1234", "192.168.1.1:65536",
  ]) assert.throws(() => parseRoomAddress(address));

  assert.equal(validRoomName("🙂".repeat(20)), true);
  assert.equal(validRoomName("🙂".repeat(21)), false);
  assert.equal(validRoomName(" guest"), false);
  assert.equal(validRoomName("guest\u0085"), false);
  const nonLocalPrivate = ["10.254.254.254", "172.31.254.254", "192.168.254.254"]
    .find((address) => !addresses.includes(address));
  assert.ok(nonLocalPrivate);
  await assert.rejects(hostRoom({ peerId: "a".repeat(32), name: "Host", bind: nonLocalPrivate }, {
    peerJoined() {}, peerLeft() {}, message() {}, error() {},
  }));
});

test("dropping ready preserves a private credential and allows exactly one resume lifecycle", async (t) => {
  const counts = { joined: 0, left: 0 };
  const host = await makeHost(counts);
  t.after(() => host.close());
  const proxy = await startDropProxy(host.address, { direction: "host-to-client", type: "ready" });
  t.after(() => proxy.close());

  let credential: ResumeCredential | undefined;
  let credentialCallbacks = 0;
  const peerId = "b".repeat(32);
  await assert.rejects(joinRoom({ peerId, name: "Guest", address: proxy.address, key: host.key }, {
    message() {},
    closed() {},
    credential(value) { credential = value; credentialCallbacks += 1; },
  }));
  await proxy.dropped;
  await until(() => counts.joined === 1 && counts.left === 1, "dropped ready lifecycle");
  assert.equal(typeof credential?.token, "string");
  assert.equal(credential?.roomId === host.roomId, true);

  const recovered = await joinRoom({ peerId, name: "Guest", address: host.address, key: host.key, resume: credential }, {
    message() {}, closed() {},
    credential(value) { credential = value; credentialCallbacks += 1; },
  });
  await until(() => counts.joined === 2, "resumed join");
  await recovered.close();
  await until(() => counts.left === 2, "resumed leave");
  assert.equal(credentialCallbacks, 2);
  assert.equal(counts.joined, 2);
  assert.equal(counts.left, 2);
});

test("dropping finish retains its reservation for the credential callback to resume", async (t) => {
  const counts = { joined: 0, left: 0 };
  const host = await makeHost(counts);
  t.after(() => host.close());
  const proxy = await startDropProxy(host.address, { direction: "client-to-host", type: "finish" });
  t.after(() => proxy.close());

  let credential: ResumeCredential | undefined;
  let credentialCallbacks = 0;
  const peerId = "c".repeat(32);
  await assert.rejects(joinRoom({ peerId, name: "Guest", address: proxy.address, key: host.key }, {
    message() {}, closed() {},
    credential(value) { credential = value; credentialCallbacks += 1; },
  }));
  await proxy.dropped;
  assert.equal(typeof credential?.token, "string");
  assert.equal(counts.joined, 0);
  assert.equal(counts.left, 0);
  assert.equal(host.peers.length, 0);

  const recovered = await joinRoom({ peerId, name: "Guest", address: host.address, key: host.key, resume: credential }, {
    message() {}, closed() {},
    credential(value) { credential = value; credentialCallbacks += 1; },
  });
  await until(() => counts.joined === 1, "reserved identity join");
  assert.equal(credentialCallbacks, 2);
  await recovered.close();
  await until(() => counts.left === 1, "reserved identity leave");
  assert.equal(counts.joined, 1);
  assert.equal(counts.left, 1);

  const racing = await Promise.allSettled([0, 1].map(() => joinRoom({
    peerId, name: "Guest", address: host.address, key: host.key, resume: credential,
  }, { message() {}, closed() {}, credential() {} })));
  const winners = racing.filter((result) => result.status === "fulfilled");
  assert.equal(winners.length, 1);
  assert.equal(host.peers.length, 1);
  await until(() => counts.joined === 2, "single winning concurrent resume");
  assert.equal(counts.joined, 2);
  assert.equal(counts.left, 1);
  if (winners[0]?.status === "fulfilled") await winners[0].value.close();
  await until(() => counts.left === 2, "single winning resume leave");
  assert.equal(counts.left, 2);
});

test("an unreachable welcome reservation expires and permits a fresh invitation join", { timeout: 40_000 }, async (t) => {
  const counts = { joined: 0, left: 0 };
  const host = await makeHost(counts);
  t.after(() => host.close());
  const proxy = await startDropProxy(host.address, { direction: "host-to-client", type: "welcome" });
  t.after(() => proxy.close());

  const peerId = "d".repeat(32);
  await assert.rejects(joinRoom({ peerId, name: "Guest", address: proxy.address, key: host.key }, {
    message() {}, closed() {},
  }));
  await proxy.dropped;
  assert.equal(counts.joined, 0);
  await new Promise((resolve) => setTimeout(resolve, 30_100));

  const fresh = await joinRoom({ peerId, name: "Guest", address: host.address, key: host.key }, {
    message() {}, closed() {}, credential() {},
  });
  await until(() => counts.joined === 1, "fresh invitation join after reservation expiry");
  await fresh.close();
  await until(() => counts.left === 1, "fresh invitation leave");
  assert.equal(counts.joined, 1);
  assert.equal(counts.left, 1);
});

test("host close releases its port and settles an active peer once", async (t) => {
  const port = await availableLoopbackPort();
  const counts = { joined: 0, left: 0 };
  let clientClosed = 0;
  const host = await hostRoom({ peerId: "a".repeat(32), name: "Host", bind: "127.0.0.1", port }, {
    peerJoined() { counts.joined += 1; },
    peerLeft() { counts.left += 1; },
    message() {}, error() {},
  });
  t.after(() => host.close());
  const client = await joinRoom({ peerId: "e".repeat(32), name: "Guest", address: host.address, key: host.key }, {
    message() {}, closed() { clientClosed += 1; },
  });
  await host.close();
  await host.close();
  await until(() => counts.left === 1 && clientClosed === 1, "host close lifecycle");
  await client.close();
  assert.equal(counts.joined, 1);
  assert.equal(counts.left, 1);
  assert.equal(clientClosed, 1);

  const replacement = await hostRoom({ peerId: "f".repeat(32), name: "Next Host", bind: "127.0.0.1", port }, {
    peerJoined() {}, peerLeft() {}, message() {}, error() {},
  });
  await replacement.close();
});
