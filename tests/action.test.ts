import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTION_LEVELS,
  ACTION_UPGRADES,
  ACTION_HEIGHT,
  ACTION_WIDTH,
  actionInput,
  addActionPlayer,
  createActionRun,
  parseActionInput,
  parseActionState,
  removeActionPlayer,
  setActionPlayerWeapon,
  stepAction,
  type ActionState,
  type Weapon,
} from '../packages/action-core/index.js';

function stepFor(state: ActionState, durationMs: number): void {
  const steps = Math.ceil(durationMs / 50);
  for (let i = 0; i < steps; i++) stepAction(state, 50);
}

function expectRejected(fn: () => unknown): void {
  assert.throws(fn);
}

function pointSegmentDistance(point: { x: number; y: number }, from: { x: number; y: number }, to: { x: number; y: number }): number {
  const dx = to.x - from.x, dy = to.y - from.y, lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - from.x, point.y - from.y);
  const t = Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (from.x + dx * t), point.y - (from.y + dy * t));
}

function warningAttackAxis(state: ActionState, player: ActionState['players'][number], warning: ActionState['telegraphs'][number]): { x: number; y: number } | undefined {
  const enemy = state.enemies.find(candidate => warning.id === `telegraph-${candidate.id}`);
  if (!enemy) return undefined;
  const from = { x: enemy.x, y: enemy.y }, target = { x: warning.targetX, y: warning.targetY };
  if (warning.kind === 'charge' || enemy.bossPattern === 'charge') {
    const dx = target.x - from.x, dy = target.y - from.y, length = Math.hypot(dx, dy) || 1;
    const travel = Math.min(enemy.kind === 'boss' ? 230 : 190, length + 28);
    const to = {
      x: Math.max(enemy.radius, Math.min(ACTION_WIDTH - enemy.radius, from.x + dx / length * travel)),
      y: Math.max(enemy.radius, Math.min(ACTION_HEIGHT - enemy.radius, from.y + dy / length * travel)),
    };
    const impactRadius = enemy.kind === 'boss' ? 24 : 18;
    return pointSegmentDistance(player, from, to) <= impactRadius + 10 ? { x: to.x - from.x, y: to.y - from.y } : undefined;
  }

  const baseAngle = Math.atan2(target.y - from.y, target.x - from.x);
  const angles = enemy.bossPattern === 'fan'
    ? Array.from({ length: 7 }, (_, index) => baseAngle + (index - 3) * 0.2)
    : enemy.bossPattern === 'barrage'
      ? Array.from({ length: 12 }, (_, index) => index * Math.PI / 6 + baseAngle * 0.08)
      : [];
  for (const angle of angles) {
    const dx = Math.cos(angle), dy = Math.sin(angle), limits: number[] = [];
    if (dx > 0) limits.push((ACTION_WIDTH - from.x) / dx);
    if (dx < 0) limits.push((0 - from.x) / dx);
    if (dy > 0) limits.push((ACTION_HEIGHT - from.y) / dy);
    if (dy < 0) limits.push((0 - from.y) / dy);
    const length = Math.min(...limits.filter(value => value >= 0));
    if (!Number.isFinite(length)) continue;
    const to = { x: from.x + dx * length, y: from.y + dy * length };
    if (pointSegmentDistance(player, from, to) <= 17) return { x: dx, y: dy };
  }
  return undefined;
}

function dodgePoint(player: { x: number; y: number }, axis: { x: number; y: number }): { x: number; y: number } {
  const length = Math.hypot(axis.x, axis.y) || 1;
  const perpendicular = { x: -axis.y / length, y: axis.x / length };
  const candidates = [1, -1].map(sign => ({
    x: Math.max(12, Math.min(ACTION_WIDTH - 12, player.x + perpendicular.x * 160 * sign)),
    y: Math.max(12, Math.min(ACTION_HEIGHT - 12, player.y + perpendicular.y * 160 * sign)),
  }));
  const margin = (point: { x: number; y: number }) => Math.min(point.x - 12, ACTION_WIDTH - 12 - point.x, point.y - 12, ACTION_HEIGHT - 12 - point.y);
  return margin(candidates[0]) >= margin(candidates[1]) ? candidates[0] : candidates[1];
}

test('seeded runs and fixed steps are deterministic and JSON round-trip safely', () => {
  const first = createActionRun(0x1a2b3c4d, 'wand');
  const second = createActionRun(0x1a2b3c4d, 'wand');
  for (let i = 0; i < 180; i++) {
    if (i === 8) {
      actionInput(first, 'player-1', { type: 'move', x: 265, y: 270 });
      actionInput(second, 'player-1', { type: 'move', x: 265, y: 270 });
    }
    stepAction(first, 50);
    stepAction(second, 50);
  }
  assert.deepEqual(first, second);
  const restored = parseActionState(JSON.parse(JSON.stringify(first)) as unknown);
  assert.deepEqual(restored, first);
  assert.equal(restored.elapsedMs, restored.tick * 50);
});

test('pause freezes combat time and never banks elapsed time for resume', () => {
  const state = createActionRun(51, 'bow');
  stepFor(state, 350);
  const before = structuredClone(state);
  actionInput(state, 'player-1', { type: 'pause', paused: true });
  stepFor(state, 30_000);
  assert.equal(state.tick, before.tick);
  assert.deepEqual(state.enemies, before.enemies);
  actionInput(state, 'player-1', { type: 'pause', paused: false });
  stepAction(state, 50);
  assert.equal(state.tick, before.tick + 1);
});

test('active-player context validates membership, freezes an empty party, and resumes without offline time', () => {
  const state = createActionRun(52, 'bow', ['host', 'friend']);
  state.carryMs = 25;
  const before = structuredClone(state);
  stepAction(state, 12_000, []);
  assert.deepEqual(state, before, 'an empty active set must freeze state and fractional carry exactly');
  expectRejected(() => stepAction(state, 50, ['host', 'host']));
  expectRejected(() => stepAction(state, 50, ['not-in-this-run']));

  stepAction(state, 25, ['host']);
  assert.equal(state.tick, before.tick + 1);
  assert.equal(state.elapsedMs, before.elapsedMs + 50, 'time while everyone was away must not accumulate');
  assert.equal(state.carryMs, 0);
});

test('temporarily absent players do not move, shoot, become enemy targets, or take projectile damage', () => {
  const state = createActionRun(53, 'wand', ['host', 'away']);
  const [host, away] = state.players;
  const enemy = state.enemies[0];
  state.enemies = [enemy];
  enemy.kind = 'chaser'; enemy.x = 250; enemy.y = 270; enemy.hp = 500; enemy.maxHp = 500;
  enemy.speed = 0; enemy.attackReady = 0; enemy.path = [];

  host.x = 78; host.y = 270; host.attackReady = 100_000;
  away.x = 250; away.y = 270; away.targetX = 500; away.targetY = 270; away.path = [{ x: 500, y: 270 }]; away.attackReady = 0;
  state.projectiles = [
    { id: 'shot-991', x: 250, y: 270, vx: 0, vy: 0, owner: away.id, faction: 'players', damage: 100, radius: 4, ttl: 10, style: 'arrow' },
    { id: 'shot-992', x: 250, y: 270, vx: 0, vy: 0, owner: enemy.id, faction: 'enemies', damage: 11, radius: 6, ttl: 10, style: 'enemy' },
  ];
  const awayBefore = { x: away.x, y: away.y, hp: away.hp, path: structuredClone(away.path) };

  stepAction(state, 50, [host.id]);

  assert.deepEqual({ x: away.x, y: away.y, hp: away.hp, path: away.path }, awayBefore);
  assert.equal(enemy.hp, 500, 'an absent player’s already-fired shot must not continue damaging enemies');
  assert.equal(enemy.targetX, host.x, 'enemies must select a present player rather than a nearby absent one');
  assert.equal(state.projectiles.some(shot => shot.faction === 'players' && shot.owner === away.id), false);
  assert.equal(away.hp, 140, 'enemy projectiles must pass through absent players');
  assert.equal(state.projectiles.some(shot => shot.id === 'shot-992'), true, 'the enemy projectile should remain available to hit an active player later');

  enemy.kind = 'charger'; enemy.windupUntil = state.tick + 1;
  enemy.chargeTargetX = away.x + 190; enemy.chargeTargetY = away.y; enemy.chargeTargetId = away.id;
  stepAction(state, 50, [host.id]);
  assert.equal(away.hp, 140, 'a charge whose saved path crosses an absent player must not hurt them');

  enemy.kind = 'shooter'; enemy.x = 900; enemy.y = 500; enemy.windupUntil = 0; enemy.attackReady = 100_000; enemy.path = [];
  state.projectiles = [];
  const returnX = away.x;
  stepAction(state, 50, [host.id, away.id]);
  assert.ok(away.x > returnX, 'the player’s saved click route should resume when they become active again');
  assert.deepEqual(parseActionState(JSON.parse(JSON.stringify(state)) as unknown), state);
});

test('a non-empty party with no living active member loses even if an absent teammate is alive', () => {
  const lethal = createActionRun(54, 'bow', ['active', 'away']);
  const [active, away] = lethal.players;
  active.hp = 1;
  const enemy = lethal.enemies[0];
  lethal.enemies = [enemy];
  enemy.kind = 'shooter'; enemy.x = 900; enemy.y = 500; enemy.speed = 0; enemy.attackReady = 100_000;
  lethal.projectiles = [{ id: 'shot-993', x: active.x, y: active.y, vx: 0, vy: 0, owner: enemy.id, faction: 'enemies', damage: 2, radius: 6, ttl: 10, style: 'enemy' }];
  stepAction(lethal, 50, [active.id]);
  assert.equal(active.alive, false);
  assert.equal(away.alive, true);
  assert.equal(lethal.phase, 'lost');
  assert.equal(lethal.tick, 1, 'the run should end on the lethal active-player tick');
  assert.equal(lethal.enemies.length, 0);

  const alreadyDown = createActionRun(55, 'wand', ['down', 'away']);
  alreadyDown.players[0].hp = 0; alreadyDown.players[0].alive = false;
  stepAction(alreadyDown, 50, ['down']);
  assert.equal(alreadyDown.phase, 'lost');
  assert.equal(alreadyDown.tick, 0, 'a dead active roster should end before advancing simulation time');
  assert.equal(parseActionState(JSON.parse(JSON.stringify(alreadyDown)) as unknown).phase, 'lost');

  const nobodyPresent = createActionRun(58, 'wand', ['down', 'away']);
  nobodyPresent.players[0].hp = 0; nobodyPresent.players[0].alive = false;
  const frozen = structuredClone(nobodyPresent);
  stepAction(nobodyPresent, 10_000, []);
  assert.deepEqual(nobodyPresent, frozen, 'the empty-active-set freeze takes precedence over defeat checks');
});

test('each current player can choose a distinct weapon only before the first tick', () => {
  const state = createActionRun(56, 'wand', ['host', 'friend']);
  const keysBefore = Object.keys(state).sort();
  setActionPlayerWeapon(state, 'host', 'bow');
  setActionPlayerWeapon(state, 'friend', 'scatter');
  assert.deepEqual(state.players.map(player => player.weapon), ['bow', 'scatter']);
  assert.deepEqual(state.players.map(player => player.damage), [24, 8]);
  assert.deepEqual(Object.keys(state).sort(), keysBefore, 'weapon selection must not add serialized fields');
  assert.deepEqual(parseActionState(JSON.parse(JSON.stringify(state)) as unknown), state);
  expectRejected(() => setActionPlayerWeapon(state, 'missing', 'wand'));
  expectRejected(() => setActionPlayerWeapon(state, 'host', 'sword' as unknown as Weapon));
  const friend = state.players[1];
  friend.path = [{ x: 200, y: friend.y }]; friend.targetX = 200;
  stepAction(state, 50);
  assert.ok(friend.x > 78, 'omitting activePlayerIds preserves legacy all-players-active behavior');
  expectRejected(() => setActionPlayerWeapon(state, 'host', 'wand'));
});

test('mouse movement routes around solid obstacles and stays in the walkable area', () => {
  const state = createActionRun(91, 'wand');
  actionInput(state, 'player-1', { type: 'move', x: 780, y: 132 });
  const route = state.players[0].path;
  assert.ok(route.length > 2, 'a click through the rock wall should produce a detour');
  const obstacle = ACTION_LEVELS[0].obstacles[0];
  for (const point of route) {
    const overlapsExpandedRock = point.x >= obstacle.x - 10 && point.x <= obstacle.x + obstacle.width + 10 && point.y >= obstacle.y - 10 && point.y <= obstacle.y + obstacle.height + 10;
    assert.equal(overlapsExpandedRock, false, 'waypoints must leave room for the player radius');
  }
  stepFor(state, 12_000);
  const player = state.players[0];
  assert.ok(player.x > obstacle.x + obstacle.width, `player should reach the far side, x=${player.x}`);
  assert.equal(player.x >= obstacle.x - 10 && player.x <= obstacle.x + obstacle.width + 10 && player.y >= obstacle.y - 10 && player.y <= obstacle.y + obstacle.height + 10, false);
});

test('legacy ground routes stop without automatic fire; explicit mouse aim shoots without pursuit', () => {
  const state = createActionRun(93, 'bow');
  const target = state.enemies[0];
  state.enemies = [target];
  target.kind = 'shooter'; target.x = 900; target.y = 500; target.hp = 5000; target.maxHp = 5000;
  target.speed = 0; target.attackReady = 100_000;
  const player = state.players[0];
  actionInput(state, player.id, { type: 'move', x: 450, y: 240 });
  for (let i = 0; i < 160; i++) stepAction(state, 50);
  assert.ok(Math.hypot(player.x - 450, player.y - 240) < 2, `player should stop at the clicked point, got (${player.x}, ${player.y})`);
  assert.equal(player.lockedEnemy, null);
  assert.equal(target.hp, 5000, 'out-of-range enemies must not trigger firing or pursuit');

  target.x = 800; target.y = 240;
  for (let i = 0; i < 60; i++) stepAction(state, 50);
  assert.equal(target.hp, 5000, 'an unlocked nearby enemy must not trigger automatic fire');
  actionInput(state, player.id, { type: 'control', moveX: 0, moveY: 0, aimX: target.x, aimY: target.y, firing: true });
  for (let i = 0; i < 60; i++) stepAction(state, 50);
  assert.ok(target.hp < 5000, 'held manual fire should shoot toward the cursor');
  assert.ok(Math.hypot(player.x - 450, player.y - 240) < 2, 'aiming must not move the player off the ground-route destination');
});

test('explicit enemy lock routes around projectile-blocking cover and reaches a firing angle', () => {
  const state = createActionRun(94, 'bow');
  state.stage = 1;
  state.obstacles = ACTION_LEVELS[1].obstacles.map(rect => ({ ...rect }));
  const target = state.enemies[0];
  state.enemies = [target];
  target.kind = 'shooter'; target.x = 141; target.y = 99; target.hp = 300; target.maxHp = 300;
  target.speed = 0; target.attackReady = 100_000;
  const player = state.players[0];
  player.x = 350; player.y = 13; player.targetX = player.x; player.targetY = player.y;
  player.path = [];
  actionInput(state, player.id, { type: 'lock', enemyId: target.id });
  assert.equal(player.lockedEnemy, target.id);
  assert.ok(player.path.length > 0, 'locking through cover should compute a route to a firing point');
  for (let i = 0; i < 140; i++) stepAction(state, 50);
  assert.ok(target.hp < 300, 'explicit lock should continue pursuit until a radius-clear shot reaches the enemy');
  assert.notDeepEqual({ x: player.x, y: player.y }, { x: 350, y: 13 });
});

test('dash respects walls and grants a brief invulnerability window with a cooldown', () => {
  const state = createActionRun(92, 'bow');
  const player = state.players[0];
  actionInput(state, player.id, { type: 'dash', x: 700, y: 132 });
  assert.ok(player.x > 100);
  assert.ok(player.x < ACTION_LEVELS[0].obstacles[0].x - 10, 'dash must stop before the blocking rock');
  assert.equal(player.invulnerableUntil, state.tick + 9);
  expectRejected(() => actionInput(state, player.id, { type: 'dash', x: 100, y: 270 }));
  const hp = player.hp;
  state.projectiles.push({ id: 'shot-999', x: player.x, y: player.y, vx: 0, vy: 0, owner: 'enemy-999', faction: 'enemies', damage: 30, radius: 6, ttl: 3, style: 'enemy' });
  stepAction(state, 50);
  assert.equal(player.hp, hp);
});

test('nova and ward serve different purposes and have independent cooldowns', () => {
  const state = createActionRun(8, 'scatter');
  const player = state.players[0];
  actionInput(state, player.id, { type: 'skill', skill: 'ward' });
  assert.equal(player.shield, 46);
  assert.equal(player.shieldUntil, state.tick + 80);
  assert.equal(player.shieldReady, state.tick + 220);
  const hp = player.hp;
  state.projectiles.push({ id: 'shot-999', x: player.x, y: player.y, vx: 0, vy: 0, owner: 'enemy-999', faction: 'enemies', damage: 12, radius: 6, ttl: 3, style: 'enemy' });
  stepAction(state, 50);
  assert.equal(player.hp, hp);
  assert.equal(player.shield, 34);
  actionInput(state, player.id, { type: 'skill', skill: 'nova' });
  assert.ok(player.skillReady > state.tick);
  expectRejected(() => actionInput(state, player.id, { type: 'skill', skill: 'nova' }));
  expectRejected(() => actionInput(state, player.id, { type: 'skill', skill: 'ward' }));
});

test('the three weapons emit distinct attack profiles and solid cover stops shots', () => {
  const profiles = (['wand', 'bow', 'scatter'] as const).map(weapon => {
    const state = createActionRun(17, weapon);
    const target = state.enemies[0];
    state.enemies = [target];
    target.x = 320; target.y = 270; target.hp = 500; target.maxHp = 500;
    const player = state.players[0];
    player.x = 250; player.y = 270; player.targetX = 250; player.targetY = 270;
    actionInput(state, player.id, { type: 'control', moveX: 0, moveY: 0, aimX: target.x, aimY: target.y, firing: true });
    stepAction(state, 50);
    return state.projectiles.filter(shot => shot.faction === 'players');
  });
  assert.deepEqual(profiles.map(shots => shots.length), [1, 1, 3]);
  assert.deepEqual(profiles.map(shots => shots[0].style), ['wand', 'arrow', 'pellet']);
  assert.deepEqual(profiles.map(shots => shots[0].damage), [16, 24, 8]);

  const state = createActionRun(18, 'wand');
  const target = state.enemies[0];
  state.enemies = [target]; target.x = 470; target.y = 132; target.hp = 100; target.maxHp = 100;
  const player = state.players[0];
  player.x = 250; player.y = 132; player.attackReady = 100_000;
  state.projectiles.push({ id: 'shot-999', x: 340, y: 132, vx: 300, vy: 0, owner: player.id, faction: 'players', damage: 50, radius: 5, ttl: 20, style: 'wand' });
  stepAction(state, 50);
  assert.equal(target.hp, 100, 'the projectile must hit the rock before the enemy behind it');
  assert.equal(state.projectiles.length, 0);
});

test('input and save parsers reject extra fields, impossible values, and oversized collections', () => {
  expectRejected(() => parseActionInput({ type: 'move', x: 12, y: 12, hp: 999 }));
  expectRejected(() => parseActionInput({ type: 'control', moveX: 2, moveY: 0, aimX: 12, aimY: 12, firing: true }));
  expectRejected(() => parseActionInput({ type: 'control', moveX: 0, moveY: 0, aimX: 12, aimY: 12, firing: 'yes' }));
  expectRejected(() => parseActionInput({ type: 'dash', x: Number.NaN, y: 12 }));
  expectRejected(() => parseActionInput({ type: 'lock', enemyId: '../enemy-1' }));
  expectRejected(() => parseActionInput({ type: 'pause', paused: 'false' }));
  const state = createActionRun(100, 'bow');
  expectRejected(() => parseActionState({ ...state, width: 9_999 }));
  expectRejected(() => parseActionState({ ...state, rng: 0 }));
  expectRejected(() => parseActionState({ ...state, extra: true }));
  expectRejected(() => parseActionState({ ...state, players: Array(5).fill(state.players[0]) }));
  expectRejected(() => parseActionState({ ...state, carryMs: 50 }));
  expectRejected(() => parseActionState({ ...state, obstacles: [] }));
});

test('three-stage expedition progresses through real kills and upgrades to a terminal result', () => {
  const state = createActionRun(0x00c0ffee, 'bow');
  const maxTicks = 36_000;
  for (let i = 0; i < maxTicks && state.phase !== 'won' && state.phase !== 'lost'; i++) {
    if (state.phase === 'upgrade') actionInput(state, state.players[0].id, { type: 'upgrade', choice: state.upgradeChoices[0] });
    if (state.phase === 'playing' && state.players[0].alive && state.tick >= state.players[0].dashReady) {
      const threat = state.telegraphs.map(warning => warningAttackAxis(state, state.players[0], warning)).find(axis => axis !== undefined);
      if (threat) {
        const destination = dodgePoint(state.players[0], threat);
        actionInput(state, state.players[0].id, { type: 'dash', x: destination.x, y: destination.y });
      }
    }
    if (state.phase === 'playing' && state.players[0].alive && !state.players[0].lockedEnemy && state.enemies.length) {
      const enemy = state.enemies.reduce((best, candidate) => Math.hypot(candidate.x - state.players[0].x, candidate.y - state.players[0].y) < Math.hypot(best.x - state.players[0].x, best.y - state.players[0].y) ? candidate : best);
      actionInput(state, state.players[0].id, { type: 'lock', enemyId: enemy.id });
    }
    if (state.phase === 'playing' && state.players[0].alive && state.tick >= state.players[0].skillReady && state.enemies.length >= 3) actionInput(state, state.players[0].id, { type: 'skill', skill: 'nova' });
    if (state.phase === 'playing' && state.players[0].alive && state.tick >= state.players[0].shieldReady && state.players[0].hp < 80) actionInput(state, state.players[0].id, { type: 'skill', skill: 'ward' });
    stepAction(state, 50);
  }
  assert.equal(state.phase, 'won', `expected a solo clear, ended ${state.phase} at stage ${state.stage}, wave ${state.wave}, tick ${state.tick}, HP ${state.players[0]?.hp}`);
  assert.equal(state.stage, 2);
  assert.equal(state.kills, 30);
  assert.ok(state.reward.coins > 0 && state.reward.xp > 0);
  assert.equal(state.enemies.length, 0);
  assert.equal(parseActionState(JSON.parse(JSON.stringify(state)) as unknown).phase, 'won');
});

test('threat-aware lock-on policy clears the seed-1 and seed-9991 long-run stalls', () => {
  for (const [weapon, seed] of [['wand', 1], ['bow', 9991]] as const) {
    const state = createActionRun(seed, weapon, ['local']);
    let dashCount = 0;
    for (let n = 0; n < 18_000 && state.phase !== 'won' && state.phase !== 'lost'; n++) {
      const player = state.players[0];
      if (state.phase === 'upgrade') actionInput(state, player.id, { type: 'upgrade', choice: state.upgradeChoices[0] });
      if (state.phase === 'playing' && n % 4 === 0) {
        let dashed = false;
        if (state.tick >= player.dashReady) {
          const threat = state.telegraphs.map(warning => warningAttackAxis(state, player, warning)).find(axis => axis !== undefined);
          if (threat) {
            const destination = dodgePoint(player, threat);
            actionInput(state, player.id, { type: 'dash', x: destination.x, y: destination.y });
            dashed = true; dashCount++;
          }
        }
        if ((!player.lockedEnemy || dashed) && state.enemies.length) {
          const boss = state.enemies.find(enemy => enemy.kind === 'boss');
          const nearest = boss ?? state.enemies.reduce((best, enemy) => Math.hypot(enemy.x - player.x, enemy.y - player.y) < Math.hypot(best.x - player.x, best.y - player.y) ? enemy : best);
          actionInput(state, player.id, { type: 'lock', enemyId: nearest.id });
        }
        if (state.tick >= player.skillReady && state.enemies.some(enemy => Math.hypot(enemy.x - player.x, enemy.y - player.y) < 130)) actionInput(state, player.id, { type: 'skill', skill: 'nova' });
        if (state.tick >= player.shieldReady && player.hp < 80) actionInput(state, player.id, { type: 'skill', skill: 'ward' });
      }
      stepAction(state, 50);
      if (n % 20 === 0) parseActionState(state);
    }
    assert.notEqual(state.phase, 'playing', `${weapon}/${seed} stalled at stage ${state.stage}, wave ${state.wave}, kills ${state.kills}, HP ${state.players[0]?.hp}, tick ${state.tick}`);
    assert.ok(state.kills >= 15, `${weapon}/${seed} should make substantial progress before a possible ordinary defeat`);
    assert.ok(state.elapsedMs < 900_000, `${weapon}/${seed} must not consume the full 900-second stall window`);
    assert.ok(dashCount > 0, `${weapon}/${seed} should exercise a dodge against an actual predicted hazard`);
  }
});

test('heartwood keeps a fallen ally at zero HP, then revives them at half maximum without the 18 HP bonus', () => {
  const state = createActionRun(57, 'bow', ['host', 'fallen']);
  state.phase = 'upgrade'; state.stage = 0; state.wave = 3; state.enemies = []; state.projectiles = []; state.telegraphs = [];
  state.upgradeChoices = ['heartwood', 'sharp-edge', 'nimble'];
  const fallen = state.players[1];
  fallen.hp = 0; fallen.alive = false; fallen.shield = 14; fallen.shieldUntil = 100;

  actionInput(state, 'host', { type: 'upgrade', choice: 'heartwood' });

  assert.equal(fallen.maxHp, 162);
  assert.equal(fallen.hp, 81, 'the freshly revived player should receive 50% max HP, not another +18 intermission heal');
  assert.equal(fallen.alive, true);
  assert.equal(fallen.shield, 0);
  assert.equal(fallen.shieldUntil, 0);
  assert.match(ACTION_UPGRADES.heartwood.detail, /50%.*复活/);
  assert.deepEqual(parseActionState(JSON.parse(JSON.stringify(state)) as unknown), state);
});

test('lethal damage ends the run while preserving only the already-earned reward ledger', () => {
  const state = createActionRun(83, 'wand');
  const player = state.players[0];
  player.hp = 1;
  player.alive = true;
  state.reward = { coins: 3, xp: 4 };
  state.kills = 1;
  state.projectiles.push({ id: 'shot-999', x: player.x, y: player.y, vx: 0, vy: 0, owner: 'enemy-999', faction: 'enemies', damage: 3, radius: 6, ttl: 3, style: 'enemy' });
  stepAction(state, 50);
  assert.equal(state.phase, 'lost');
  assert.equal(state.players[0].hp, 0);
  assert.equal(state.reward.coins, 3);
  assert.equal(state.reward.xp, 4);
  assert.equal(parseActionState(JSON.parse(JSON.stringify(state)) as unknown).phase, 'lost');
});

test('a retreat is a terminal but still valid saved state even when survivors and the combat snapshot remain', () => {
  const state = createActionRun(84, 'bow');
  state.phase = 'lost';
  assert.equal(parseActionState(JSON.parse(JSON.stringify(state)) as unknown).phase, 'lost');
});

test('player membership is bounded and removing the last real player ends the run', () => {
  const state = createActionRun(72, 'wand', ['host']);
  addActionPlayer(state, 'friend');
  assert.equal(state.players.length, 2);
  expectRejected(() => addActionPlayer(state, 'friend'));
  addActionPlayer(state, 'friend_2');
  addActionPlayer(state, 'friend-3');
  expectRejected(() => addActionPlayer(state, 'fifth'));
  removeActionPlayer(state, 'friend');
  removeActionPlayer(state, 'friend_2');
  removeActionPlayer(state, 'friend-3');
  removeActionPlayer(state, 'host');
  assert.equal(state.phase, 'lost');
  assert.equal(state.players.length, 0);
});
