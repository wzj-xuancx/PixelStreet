import test from 'node:test';
import assert from 'node:assert/strict';
import { actionInput, clearActionControls, createActionRun, parseActionInput, parseActionState, stepAction } from '../packages/action-core/index.js';

function quietTarget(state: ReturnType<typeof createActionRun>, x: number, y: number) {
  const enemy = state.enemies[0];
  state.enemies = [enemy];
  enemy.kind = 'shooter';
  enemy.x = x; enemy.y = y; enemy.hp = 50_000; enemy.maxHp = 50_000;
  enemy.speed = 0; enemy.attackReady = 1_000_000; enemy.path = [];
  return enemy;
}

test('new runs remain idle until explicit movement and held mouse fire are sent', () => {
  const state = createActionRun(0x7610, 'wand');
  const player = state.players[0];
  const target = quietTarget(state, 300, 270);
  const start = { x: player.x, y: player.y };

  for (let i = 0; i < 35; i++) stepAction(state, 50);
  assert.deepEqual({ x: player.x, y: player.y }, start, 'no key or pointer input must not move the player');
  assert.equal(state.projectiles.some(shot => shot.faction === 'players'), false, 'new runs must not auto-fire');
  assert.equal(target.hp, 50_000);

  actionInput(state, player.id, { type: 'control', moveX: 0, moveY: 0, aimX: target.x, aimY: target.y, firing: true });
  for (let i = 0; i < 40; i++) stepAction(state, 50);
  assert.ok(target.hp < 50_000, 'held fire aimed through the cursor should damage the target');
  assert.deepEqual({ x: player.x, y: player.y }, start, 'shooting without movement input must keep the player in place');
});

test('WASD axes move at normalized speed, stop on release, and do not auto-attack', () => {
  const state = createActionRun(0x7611, 'bow');
  const player = state.players[0];
  const target = quietTarget(state, 900, 500);
  const start = { x: player.x, y: player.y };
  actionInput(state, player.id, { type: 'control', moveX: 1, moveY: 1, aimX: target.x, aimY: target.y, firing: false });
  for (let i = 0; i < 20; i++) stepAction(state, 50);
  const dx = player.x - start.x, dy = player.y - start.y;
  assert.ok(dx > 80 && dy > 80, 'diagonal movement should advance along both axes');
  assert.ok(Math.abs(dx - dy) < 0.1, 'diagonal movement should not be faster on either axis');
  assert.ok(Math.abs(Math.hypot(dx, dy) - player.speed) < 0.2, 'one second of diagonal input should travel one second of base speed');
  assert.equal(target.hp, 50_000, 'aim position alone must not fire without the left button held');

  actionInput(state, player.id, { type: 'control', moveX: 0, moveY: 0, aimX: target.x, aimY: target.y, firing: false });
  const stopped = { x: player.x, y: player.y };
  for (let i = 0; i < 20; i++) stepAction(state, 50);
  assert.deepEqual({ x: player.x, y: player.y }, stopped, 'releasing WASD should stop immediately at the current position');
});

test('aimed fire follows the cursor ray instead of targeting the nearest enemy', () => {
  const state = createActionRun(0x7612, 'bow');
  const target = quietTarget(state, 320, 270);
  const decoy = { ...target, id: 'enemy-999', x: 90, y: 340, hp: 50_000, maxHp: 50_000 };
  state.enemies = [decoy, target];
  const player = state.players[0];
  const start = { x: player.x, y: player.y };
  actionInput(state, player.id, { type: 'control', moveX: 0, moveY: 0, aimX: target.x, aimY: target.y, firing: true });
  for (let i = 0; i < 60; i++) stepAction(state, 50);
  assert.ok(target.hp < 50_000, 'shots should hit the enemy along the cursor ray');
  assert.equal(decoy.hp, 50_000, 'a closer enemy off the cursor ray must not be auto-targeted');
  assert.deepEqual({ x: player.x, y: player.y }, start, 'manual shooting must not pursue the target');
});

test('pause clears held keys and fire before resume', () => {
  const state = createActionRun(0x7613, 'wand');
  const player = state.players[0];
  const target = quietTarget(state, 300, 270);
  actionInput(state, player.id, { type: 'control', moveX: 1, moveY: 0, aimX: target.x, aimY: target.y, firing: true });
  for (let i = 0; i < 6; i++) stepAction(state, 50);
  actionInput(state, player.id, { type: 'pause', paused: true });
  assert.deepEqual([player.moveX, player.moveY, player.firing], [0, 0, false]);
  const position = { x: player.x, y: player.y };
  const projectileSequence = state.projectileSequence;
  stepAction(state, 5000);
  actionInput(state, player.id, { type: 'pause', paused: false });
  for (let i = 0; i < 20; i++) stepAction(state, 50);
  assert.deepEqual({ x: player.x, y: player.y }, position, 'movement must not resume from a stale key state');
  assert.equal(state.projectileSequence, projectileSequence, 'fire must not resume from a stale mouse-button state');
});

test('worker-facing clearActionControls clears axes, firing, and legacy paths for every player', () => {
  const state = createActionRun(0x7615, 'wand');
  const first = state.players[0];
  const second = { ...first, id: 'player-2', path: [{ x: first.x + 20, y: first.y + 20 }] };
  state.players.push(second);
  for (const player of state.players) {
    player.moveX = 1;
    player.moveY = -1;
    player.firing = true;
    player.lockedEnemy = state.enemies[0].id;
    player.path = [{ x: player.x + 20, y: player.y + 20 }];
    player.targetX = player.x + 20;
    player.targetY = player.y + 20;
  }

  clearActionControls(state);

  for (const player of state.players) {
    assert.deepEqual([player.moveX, player.moveY, player.firing], [0, 0, false]);
    assert.deepEqual(player.path, []);
    assert.deepEqual([player.targetX, player.targetY], [player.x, player.y]);
    assert.equal(player.lockedEnemy, null);
  }
});

test('control parser bounds axes and aim; old v1 player snapshots migrate to neutral controls', () => {
  assert.deepEqual(parseActionInput({ type: 'control', moveX: -1, moveY: 1, aimX: 960, aimY: 540, firing: true }), {
    type: 'control', moveX: -1, moveY: 1, aimX: 960, aimY: 540, firing: true,
  });
  assert.throws(() => parseActionInput({ type: 'control', moveX: 1.01, moveY: 0, aimX: 0, aimY: 0, firing: false }));
  assert.throws(() => parseActionInput({ type: 'control', moveX: 0, moveY: 0, aimX: 961, aimY: 0, firing: false }));
  assert.throws(() => parseActionInput({ type: 'control', moveX: 0, moveY: 0, aimX: 10, aimY: 10, firing: 1 }));

  const run = createActionRun(0x7614, 'bow');
  const raw = JSON.parse(JSON.stringify(run)) as Record<string, any>;
  const savedPlayer = raw.players[0];
  for (const key of ['moveX', 'moveY', 'aimX', 'aimY', 'firing']) delete savedPlayer[key];
  savedPlayer.path = [{ x: 250, y: savedPlayer.y }];
  savedPlayer.targetX = 250;
  savedPlayer.lockedEnemy = run.enemies[0].id;
  const restored = parseActionState(raw);
  const player = restored.players[0];
  assert.deepEqual([player.moveX, player.moveY, player.firing], [0, 0, false]);
  assert.deepEqual(player.path, [], 'migration must not replay an old click-to-move route');
  assert.equal(player.lockedEnemy, null);
  assert.deepEqual([player.targetX, player.targetY], [player.x, player.y]);
  assert.deepEqual(parseActionState(JSON.parse(JSON.stringify(restored)) as unknown), restored);
});
