import test from 'node:test';
import assert from 'node:assert/strict';
import {
  actionInput,
  createActionRun,
  parseActionState,
  setActionPlayerWeapon,
  stepAction,
  type Weapon,
} from '../packages/action-core/index.js';

test('active roster validation rejects malformed, duplicate, and foreign IDs before mutating state', () => {
  const state = createActionRun(0x31a7, 'bow', ['host', 'friend']);
  state.carryMs = 17;
  const cases: unknown[] = [
    ['host', 'host'],
    ['host', 'stranger'],
    ['host', 'not a valid id'],
    null,
    'host',
  ];

  for (const invalid of cases) {
    const before = structuredClone(state);
    assert.throws(() => stepAction(state, 600, invalid as readonly string[] | undefined));
    assert.deepEqual(state, before, `invalid roster ${JSON.stringify(invalid)} must be rejected transactionally`);
  }
});

test('an all-away interval freezes all state and fractional carry, then resumes with only new elapsed time', () => {
  const state = createActionRun(0x31a8, 'wand', ['host', 'away']);
  const [host, away] = state.players;
  const enemy = state.enemies[0];
  state.enemies = [enemy];
  enemy.kind = 'shooter'; enemy.x = 900; enemy.y = 500; enemy.speed = 0; enemy.attackReady = 100_000; enemy.path = [];
  host.x = 100; host.y = 270; host.attackReady = 100_000; host.path = [];
  away.x = 250; away.y = 270; away.hp = 93; away.targetX = 430; away.targetY = 270;
  away.path = [{ x: 430, y: 270 }]; away.attackReady = 0; away.shield = 12; away.shieldUntil = 500;
  state.carryMs = 17;
  const beforeAway = { ...structuredClone(away) };
  const before = structuredClone(state);

  stepAction(state, 60_000, []);
  assert.deepEqual(state, before, 'an empty active list must not advance the world or bank wall time');

  stepAction(state, 33, [host.id]);
  assert.equal(state.tick, before.tick + 1);
  assert.equal(state.elapsedMs, before.elapsedMs + 50);
  assert.equal(state.carryMs, 0);
  assert.deepEqual(away, beforeAway, 'an away player keeps position, path, attack and defense timers unchanged');
  assert.deepEqual(parseActionState(JSON.parse(JSON.stringify(state)) as unknown), state);
});

test('away players are excluded independently from melee, saved charges, incoming shots, and outgoing shot credit', () => {
  const melee = createActionRun(0x31a9, 'bow', ['host', 'away']);
  const [host, away] = melee.players;
  const chaser = melee.enemies[0];
  melee.enemies = [chaser];
  chaser.kind = 'chaser'; chaser.x = 250; chaser.y = 270; chaser.speed = 0; chaser.damage = 17; chaser.attackReady = 0; chaser.path = [];
  host.x = 274; host.y = 270; host.attackReady = 100_000;
  away.x = 250; away.y = 270; away.hp = 140;

  stepAction(melee, 50, [host.id]);
  assert.equal(host.hp, 123, 'the chaser attacks the nearby active player');
  assert.equal(away.hp, 140, 'an away player inside the same melee radius is not a target');

  const charge = createActionRun(0x31aa, 'wand', ['host', 'away']);
  const [active, absent] = charge.players;
  const charger = charge.enemies[0];
  charge.enemies = [charger];
  active.x = 650; active.y = 270; active.attackReady = 100_000;
  absent.x = 250; absent.y = 270; absent.hp = 140;
  charger.kind = 'charger'; charger.x = 250; charger.y = 270; charger.damage = 19;
  charger.windupUntil = charge.tick + 1; charger.chargeTargetX = 440; charger.chargeTargetY = 270;
  charger.chargeTargetId = absent.id; charger.path = [];

  stepAction(charge, 50, [active.id]);
  assert.equal(absent.hp, 140, 'a saved charge line crossing an away teammate causes no damage');

  const shots = createActionRun(0x31ab, 'bow', ['host', 'away']);
  const [present, awayShooter] = shots.players;
  const target = shots.enemies[0];
  shots.enemies = [target];
  target.kind = 'shooter'; target.x = 900; target.y = 500; target.speed = 0; target.attackReady = 100_000; target.path = [];
  present.x = 650; present.y = 270; present.attackReady = 100_000;
  awayShooter.x = 250; awayShooter.y = 270; awayShooter.hp = 140;
  shots.projectiles = [
    { id: 'shot-8101', x: awayShooter.x, y: awayShooter.y, vx: 0, vy: 0, owner: target.id, faction: 'enemies', damage: 11, radius: 6, ttl: 10, style: 'enemy' },
    { id: 'shot-8102', x: target.x - 20, y: target.y, vx: 400, vy: 0, owner: awayShooter.id, faction: 'players', damage: 100, radius: 4, ttl: 10, style: 'arrow' },
  ];

  stepAction(shots, 50, [present.id]);
  assert.equal(awayShooter.hp, 140, 'enemy shots pass through away players');
  assert.equal(target.hp, target.maxHp, 'a projectile already fired by an away owner cannot earn later damage');
  assert.equal(shots.kills, 0);
  assert.equal(shots.projectiles.some(shot => shot.id === 'shot-8102'), false);
  assert.equal(shots.projectiles.some(shot => shot.id === 'shot-8101'), true);

  const hostileShot = shots.projectiles.find(shot => shot.id === 'shot-8101')!;
  hostileShot.x = present.x; hostileShot.y = present.y;
  stepAction(shots, 50, [present.id]);
  assert.equal(present.hp, 129, 'the same enemy projectile remains dangerous to an active player');
  assert.deepEqual(parseActionState(JSON.parse(JSON.stringify(shots)) as unknown), shots);
});

test('a non-empty active list with every listed player down cannot be held open by an away survivor', () => {
  const state = createActionRun(0x31ac, 'wand', ['down', 'away']);
  const [down, away] = state.players;
  down.hp = 0; down.alive = false;
  away.hp = 140; away.alive = true;
  const beforeTick = state.tick;

  stepAction(state, 50, [down.id]);

  assert.equal(state.phase, 'lost');
  assert.equal(state.tick, beforeTick);
  assert.equal(down.alive, false);
  assert.equal(away.alive, true);
  assert.equal(parseActionState(JSON.parse(JSON.stringify(state)) as unknown).phase, 'lost');
});

test('tick-zero loadouts remain per-player, serializable, and immutable after the first tick', () => {
  const state = createActionRun(0x31ad, 'wand', ['host', 'friend']);
  setActionPlayerWeapon(state, 'host', 'bow');
  setActionPlayerWeapon(state, 'friend', 'scatter');
  assert.deepEqual(state.players.map(player => [player.weapon, player.damage]), [['bow', 24], ['scatter', 8]]);
  assert.deepEqual(parseActionState(JSON.parse(JSON.stringify(state)) as unknown), state);

  const beforeBadSelection = structuredClone(state);
  assert.throws(() => setActionPlayerWeapon(state, 'host', 'invalid' as Weapon));
  assert.deepEqual(state, beforeBadSelection, 'a rejected loadout must leave the state unchanged');
  stepAction(state, 50);
  const afterFirstTick = structuredClone(state);
  assert.throws(() => setActionPlayerWeapon(state, 'host', 'wand'));
  assert.deepEqual(state, afterFirstTick, 'weapon selection closes exactly when simulation begins');
});

test('heartwood increases a fallen teammate cap, then revives at exactly half on the next stage', () => {
  const state = createActionRun(0x31ae, 'wand', ['host', 'fallen']);
  state.phase = 'upgrade'; state.stage = 0; state.wave = 3;
  state.enemies = []; state.projectiles = []; state.telegraphs = [];
  state.upgradeChoices = ['heartwood', 'sharp-edge', 'nimble'];
  const [host, fallen] = state.players;
  host.hp = 100;
  fallen.maxHp = 174; fallen.hp = 0; fallen.alive = false; fallen.shield = 20; fallen.shieldUntil = 100;

  actionInput(state, host.id, { type: 'upgrade', choice: 'heartwood' });

  assert.equal(state.stage, 1);
  assert.equal(state.wave, 1);
  assert.equal(host.maxHp, 162);
  assert.equal(host.hp, 140, 'the living teammate receives the upgrade heal and intermission heal');
  assert.equal(fallen.maxHp, 196);
  assert.equal(fallen.hp, 98, 'the fallen teammate receives no +18 heal after the 50% revive');
  assert.equal(fallen.alive, true);
  assert.equal(fallen.shield, 0);
  assert.equal(fallen.shieldUntil, 0);
  assert.deepEqual(parseActionState(JSON.parse(JSON.stringify(state)) as unknown), state);
});

