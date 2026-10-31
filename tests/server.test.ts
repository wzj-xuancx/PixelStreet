import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { startHealthServer } from '../apps/server/server';
test('separate health server binds only loopback and implements no gameplay', async t => {
  const server = startHealthServer(); await once(server, 'listening'); t.after(() => server.close());
  const address = server.address(); assert.ok(address && typeof address === 'object'); assert.equal(address.address, '127.0.0.1');
  const response = await fetch(`http://127.0.0.1:${address.port}/health`); assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { name: 'PixelStreet', phase: 'S1', version: '0.1.0-s1', gameplay: false });
  const unknown = await fetch(`http://127.0.0.1:${address.port}/wallet`); assert.equal(unknown.status, 404);
});
