import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { createFieldWorld, defaultLoadout, stepFieldWorld, type FieldWorld } from '../packages/field-world';
function qualified() { let world = createFieldWorld({ sessionId: 'pair', seed: 1, actors: ['a', 'b'].map(id => ({ id, loadout: { ...defaultLoadout(), maxHP: 1000, attack: 1000 } })) }); for (const a of world.actors) {
    a.x = 300;
    a.mode = 'push';
} const r = stepFieldWorld(world, [], 100); return stepFieldWorld(r.world, [], 0, r.effects.filter(e => e.type === 'consume-needed').map(e => ({ eventId: e.id, actorId: (e as any).actorId, accepted: true }))).world; }
test('locked co-op qualifier retains reward when briefly down or disconnected, next groups exclude offline actors', () => { for (const down of [true, false]) {
    let world = qualified();
    const b = world.actors[1];
    if (down)
        b.hp = 0;
    else
        b.online = false;
    let result = stepFieldWorld(world, [], 2000);
    assert.ok(result.effects.some(e => e.type === 'reward-candidate' && e.actorId === 'b'));
    assert.equal(result.world.actors[1].returned, false);
    assert.equal(result.world.floors[0].encounters[0].participants.length, 2);
    if (!down) {
        const rewards = result.effects.filter(e => e.type === 'reward-candidate');
        result = stepFieldWorld(result.world, [], 10000, rewards.map(e => ({ eventId: e.id, actorId: (e as any).actorId, accepted: true })));
        assert.ok(!result.effects.some(e => e.type === 'consume-needed' && e.actorId === 'b'));
    }
} });
test('Guest ground override does not switch Host strategy or rewrite locked HP', () => { const world = qualified(), hp = world.floors[0].encounters[0].monsters.map(m => m.max); const r = stepFieldWorld(world, [{ actorId: 'b', kind: 'target', target: { kind: 'ground', x: 100 } }], 0); assert.equal(r.world.actors[0].mode, 'push'); assert.equal(r.world.actors[1].mode, 'manual'); assert.deepEqual(r.world.floors[0].encounters[0].monsters.map(m => m.max), hp); });
test('real independent Host Worker rejects Guest strategy and follows fixed rules without Profile/p.run', async () => { const w = new Worker(path.resolve('dist/party-field-worker.cjs')); let world: FieldWorld | undefined; const errors: string[] = []; let id = 0; const pending = new Map<number, (v: any) => void>(); w.on('message', m => { if (m.type === 'snapshot')
    world = m.world; if (m.type === 'error')
    errors.push(m.error); if (m.type === 'reply') {
    pending.get(m.id)?.(m.world);
    pending.delete(m.id);
} }); const read = () => new Promise<FieldWorld>(r => { const n = ++id; pending.set(n, r); w.postMessage({ type: 'read', id: n }); }); try {
    w.postMessage({ type: 'start', options: { sessionId: 'worker-pair', seed: 1, actors: ['host', 'guest'].map(id => ({ id, loadout: defaultLoadout() })) } });
    w.postMessage({ type: 'input', actorId: 'guest', hostId: 'host', intent: { kind: 'mode', mode: 'push' } });
    await read();
    assert.match(errors[0], /只有房主/);
    assert.ok((await read()).actors.every(a => a.mode === 'manual'));
    w.postMessage({ type: 'input', actorId: 'host', hostId: 'host', intent: { kind: 'mode', mode: 'push' } });
    const after = await read();
    assert.ok(after.actors.every(a => a.mode === 'push'));
    assert.equal((after as any).profile, undefined);
    assert.equal((after as any).run, undefined);
    assert.equal(after.actors.length, 2);
}
finally {
    await w.terminate();
} });
