import { parentPort } from 'node:worker_threads';
import { createFieldWorld, stepFieldWorld, parseFieldWorld, type FieldWorld, type FieldIntent, type FieldConfirmation } from '../../packages/field-world';
const port = parentPort!;
let world: FieldWorld | null = null, last = Date.now(), active = false, frozen = false, lastBroadcast = 0;
const queue: FieldIntent[] = [];
function step(ms: number, confirmations: FieldConfirmation[] = []) { if (!world)
    return; const result = stepFieldWorld(world, queue.splice(0), ms, confirmations); world = result.world; if (result.effects.length)
    port.postMessage({ type: 'effects', effects: result.effects }); const now = Date.now(); if (result.effects.length || now - lastBroadcast >= (active ? 90 : 500)) {
    lastBroadcast = now;
    port.postMessage({ type: 'snapshot', world });
} }
let timer: ReturnType<typeof setTimeout>;
function schedule() { clearTimeout(timer); timer = setTimeout(() => { const now = Date.now(), ms = Math.max(0, Math.min(1000, now - last)); last = now; if (!frozen)
    try {
        step(ms);
    }
    catch (e) {
        frozen = true;
        port.postMessage({ type: 'error', error: String(e) });
    } schedule(); }, active ? 100 : 500); timer.unref(); }
schedule();
port.on('message', m => { try {
    if (m.type === 'start') {
        world = createFieldWorld(m.options);
        last = Date.now();
        frozen = false;
        port.postMessage({ type: 'snapshot', world });
    }
    else if (m.type === 'confirm') {
        step(0, m.confirmations);
    }
    else if (m.type === 'input') {
        if (!world || frozen)
            return;
        const actor = world.actors.find(a => a.id === m.actorId);
        if (!actor || actor.returned)
            return;
        const i = m.intent;
        if (i.kind === 'mode') {
            if (m.actorId !== m.hostId)
                throw Error('只有房主可切换策略');
            for (const a of world.actors)
                if (!a.returned) {
                    if (i.mode === 'farm' && !a.farmTarget)
                        continue;
                    queue.push({ actorId: a.id, kind: 'mode', mode: i.mode });
                }
        }
        else {
            queue.push({ ...i, actorId: m.actorId }); /* A guest's target changes only their own mode. */
        }
        step(0);
    }
    else if (m.type === 'presence') {
        if (!world)
            return;
        const a = world.actors.find(a => a.id === m.actorId);
        if (a)
            a.online = !!m.online;
    }
    else if (m.type === 'retire') {
        if (!world)
            return;
        const a = world.actors.find(a => a.id === m.actorId);
        if (a) {
            a.online = true;
            step(0, []);
            const result = stepFieldWorld(world, [{ actorId: a.id, kind: 'return' }], 0);
            world = result.world;
            port.postMessage({ type: 'effects', effects: result.effects });
            port.postMessage({ type: 'snapshot', world });
        }
    }
    else if (m.type === 'presentation') {
        active = !!m.active;
        schedule();
    }
    else if (m.type === 'freeze') {
        frozen = !!m.frozen;
        last = Date.now();
    }
    else if (m.type === 'read') {
        port.postMessage({ type: 'reply', id: m.id, world: world ? parseFieldWorld(world) : null });
    }
    else if (m.type === 'stop') {
        world = null;
        queue.length = 0;
    }
}
catch (e) {
    port.postMessage({ type: 'error', error: String(e) });
} });
port.on('close', () => clearTimeout(timer));
