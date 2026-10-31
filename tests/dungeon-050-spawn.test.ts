import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../packages/dungeon-core';
import type { DungeonRun } from '../packages/dungeon-core';

function enter(run: DungeonRun, destination: string): void {
  const source = core.currentRoom(run), door = core.roomDoors(run).find(value => value.to === destination);
  assert.ok(door);
  run.player.x = door.side === 'W' ? 35 : door.side === 'E' ? source.width - 35 : source.width / 2;
  run.player.y = door.side === 'N' ? 35 : door.side === 'S' ? source.height - 35 : source.height / 2;
  core.dungeonInput(run, { type: 'control', moveX: door.side === 'W' ? -1 : door.side === 'E' ? 1 : 0, moveY: door.side === 'N' ? -1 : door.side === 'S' ? 1 : 0, aimX: run.player.x, aimY: run.player.y, firing: false });
  core.stepDungeon(run);
  assert.equal(run.currentRoom, destination);
  core.dungeonInput(run, { type: 'control', moveX: 0, moveY: 0, aimX: run.player.x, aimY: run.player.y, firing: false });
}
function enterFirstBattle(seed: number): DungeonRun {
  const run = core.createDungeon(seed);
  enter(run, 'crossroads');
  enter(run, 'battle-a');
  return run;
}
function advance(run: DungeonRun, ms: number): void { while (ms > 0) { const step = Math.min(100, ms); core.stepDungeon(run, step); ms -= step; } }

test('050 production rooms lock a persistent warning queue before any enemy exists; reload preserves its deadlines', () => {
  const run = enterFirstBattle(305), room = core.currentRoom(run);
  assert.equal(room.wave, 1);
  assert.equal(room.locked, true);
  assert.equal(room.enemies.length, 0);
  assert.equal(room.spawns.phase, 'warning');
  assert.ok(room.spawns.plan.length > 0);
  assert.ok(room.spawns.pending.length > 0);
  const deadline = structuredClone(room.spawns.pending);
  const reloaded = core.parseDungeonRun(JSON.parse(JSON.stringify(run)));
  assert.ok(reloaded);
  assert.deepEqual(core.currentRoom(reloaded).spawns.pending, deadline);
  const pausedAt=reloaded.elapsedMs;core.dungeonInput(reloaded,{type:'pause',paused:true});advance(reloaded,1000);
  assert.equal(reloaded.elapsedMs,pausedAt);
  assert.deepEqual(core.currentRoom(reloaded).spawns.pending,deadline);
  core.dungeonInput(reloaded,{type:'pause',paused:false});
  const warningEndsAt = Math.min(...deadline.map(ticket => ticket.materializeAt));
  advance(reloaded, warningEndsAt - reloaded.elapsedMs - 1);
  assert.equal(core.currentRoom(reloaded).enemies.length, 0);
  assert.ok(core.parseDungeonRun(reloaded));
  advance(reloaded, 2);
  assert.ok(core.currentRoom(reloaded).enemies.length > 0);
  assert.equal(core.currentRoom(reloaded).spawns.phase, 'settling');
  assert.ok(core.currentRoom(reloaded).spawns.pending.length > 0);
  const newlyMaterialized=core.currentRoom(reloaded).enemies.find(enemy=>enemy.kind==='chaser');
  assert.ok(newlyMaterialized);
  newlyMaterialized.attackReady=0;reloaded.player.x=newlyMaterialized.x+40;reloaded.player.y=newlyMaterialized.y;const shield=reloaded.player.shield;
  core.stepDungeon(reloaded,100);
  assert.equal(newlyMaterialized.state,'idle','new bodies must finish the 300ms settling window before AI starts');
  assert.equal(reloaded.player.shield,shield);
  assert.ok(core.parseDungeonRun(reloaded));
});

test('050 an occupied locked spawn point is rewarned from a legal point and eventually materializes', () => {
  const run = enterFirstBattle(406), room = core.currentRoom(run), ticket = room.spawns.pending[0];
  assert.ok(ticket);
  const original = structuredClone(ticket);
  run.player.x = ticket.point.x; run.player.y = ticket.point.y;
  assert.ok(core.parseDungeonRun(run));
  advance(run, ticket.materializeAt - run.elapsedMs + 1);
  const rewarmed = room.spawns.pending.find(value => value.enemyId === original.enemyId)!;
  assert.ok(rewarmed);
  assert.ok(rewarmed.warningAt > original.warningAt);
  assert.ok(rewarmed.materializeAt - run.elapsedMs >= 1099);
  assert.ok(room.enemies.every(enemy => enemy.id !== original.enemyId));
  run.player.x = room.width / 2; run.player.y = room.height / 2;
  let attempts = 0;
  while (!room.enemies.some(enemy => enemy.id === original.enemyId) && attempts++ < 60) advance(run, 100);
  assert.ok(room.enemies.some(enemy => enemy.id === original.enemyId), 'a legal spawn did not emerge after the player left the marker');
  assert.ok(core.parseDungeonRun(run));
});

test('050 pending tickets, settling time and unstarted batches prevent early room clear', () => {
  const run = enterFirstBattle(507), room = core.currentRoom(run), firstTicket = room.spawns.pending[0];
  assert.ok(firstTicket);
  room.enemies.forEach(enemy => enemy.hp = 0);
  core.stepDungeon(run, 100);
  assert.equal(room.cleared, false);
  assert.equal(room.locked, true);
  assert.ok(room.spawns.pending.length > 0);
  advance(run, Math.max(0, firstTicket.materializeAt - run.elapsedMs + 1));
  room.enemies.forEach(enemy => enemy.hp = 0);
  assert.equal(room.spawns.phase, 'settling');
  assert.ok(room.spawns.pending.length > 0);
  core.stepDungeon(run, 100);
  assert.equal(room.cleared, false);
  assert.equal(room.locked, true);
  let attempts = 0;
  while (room.wave < 2 && attempts++ < 80) {
    room.enemies.forEach(enemy => enemy.hp = 0);
    advance(run, 100);
  }
  assert.equal(room.wave, 2);
  assert.equal(room.cleared, false);
  assert.equal(room.locked, true);
  assert.ok(room.spawns.pending.length > 0 || room.spawns.batchIndex < room.spawns.plan[room.spawns.waveIndex].batches.length);
  assert.ok(core.parseDungeonRun(run));
});

test('050 modern schema permits new roles while frozen v3 validation still rejects them', () => {
  const run = core.createEncounter(508), room = core.currentRoom(run);
  Object.assign(room.enemies[0], { kind: 'priest' });
  assert.ok(core.parseDungeonRun(run));
  const legacy: any = structuredClone(run);
  legacy.version = 3;
  delete legacy.combat;
  for (const item of legacy.rooms) delete item.spawns;
  assert.equal(core.parseDungeonRun(legacy), null);
});
