import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../packages/dungeon-core';
import type { DungeonRun, Enemy, EnemyKind } from '../packages/dungeon-core';

type RoleUnderTest = EnemyKind | 'guard' | 'priest';
function actor(kind: RoleUnderTest, x: number, y: number, id: string): Enemy {
  return { id, kind: kind as unknown as EnemyKind, bossPhase: 0, pattern: 'none', x, y, hp: 100, maxHp: 100, radius: 12, state: 'idle', stateUntil: 0, attackReady: 0, aimX: 1, aimY: 0, burnUntil: 0, frost: 0, frozenUntil: 0 };
}
function fixture(kind: RoleUnderTest, player: { x: number; y: number }, enemy: { x: number; y: number } = { x: 300, y: 300 }): { run: DungeonRun; room: ReturnType<typeof core.currentRoom>; enemy: Enemy } {
  const run = core.createEncounter(509), room = core.currentRoom(run), e = actor(kind, enemy.x, enemy.y, `${kind}-probe`);
  room.enemies = [e]; room.obstacles = []; room.traps = []; room.locked = true; room.wave = 1; room.totalWaves = 2;
  run.combat.enemyRuntime = [];
  run.player.x = player.x; run.player.y = player.y; run.player.shield = 40; run.player.maxShield = 40; run.player.moveX = 0; run.player.moveY = 0;
  return { run, room, enemy: e };
}
function addShot(run: DungeonRun, id: string, x: number, y: number, vx: number, vy: number, damage=10): void {
  run.projectiles.push({ id, kind: 'frost',weaponId:null,sourceKind:'projectile',generation:0, owner: 'player', x, y, vx, vy, radius: 2, damage, expiresAt: run.elapsedMs + 2000, bornAt: run.elapsedMs, leg: 'out', hitIds: [], charge: 0, nextHitAt: 0, bounces: 0 });
}
function advance(run: DungeonRun, ms: number): void { while (ms > 0) { const step = Math.min(100, ms); core.stepDungeon(run, step); ms -= step; } }

test('050 chaser attacks lock a short directional arc with a real windup; sideways movement escapes it', () => {
  const front = fixture('chaser', { x: 340, y: 300 }), targetCenter = core.hurtShape(front.run.player, 'player', front.run.combat.profile).center;
  front.enemy.aimX = 1; front.enemy.aimY = 0; front.enemy.state = 'windup'; front.enemy.stateUntil = 100;
  core.stepDungeon(front.run, 100);
  assert.equal(String(front.enemy.state), 'attack');
  assert.ok(front.run.player.shield < 40, 'a player in the locked front arc should be hit');
  assert.ok(core.hurtShape(front.enemy, 'chaser', front.run.combat.profile).center.x < targetCenter.x);

  const dodged = fixture('chaser', { x: 340, y: 300 });
  dodged.enemy.aimX = 1; dodged.enemy.aimY = 0; dodged.enemy.state = 'windup'; dodged.enemy.stateUntil = 100;
  dodged.run.player.y = 220;
  core.stepDungeon(dodged.run, 100);
  assert.equal(String(dodged.enemy.state), 'attack');
  assert.equal(dodged.run.player.shield, 40, 'a side step during the warning should leave the locked short arc');
  assert.deepEqual({ x: dodged.enemy.aimX, y: dodged.enemy.aimY }, { x: 1, y: 0 });
});

test('050 idle ordinary enemies do not deal full-circle contact damage', () => {
  const { run, enemy } = fixture('chaser', { x: 300, y: 300 }, { x: 305, y: 300 });
  enemy.attackReady = 1e9;
  core.stepDungeon(run, 100);
  assert.equal(run.player.shield, 40);
});

test('050 attack sector tests the full torso capsule at its radial side and outer edge', () => {
  const intersects = (a: { x: number; y: number }, b: { x: number; y: number }, radius: number) => (core as any).enemyAttackArcIntersects({ x: 0, y: 0 }, { x: 1, y: 0 }, { kind: 'capsule', a, b, center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, radius }, 48, Math.PI * .27);
  assert.equal(intersects({ x: 30, y: 39 }, { x: 30, y: 51 }, 8), true, 'capsule radius must graze the sector edge');
  assert.equal(intersects({ x: 30, y: 55 }, { x: 30, y: 67 }, 8), false, 'a farther side target must miss');
  assert.equal(intersects({ x: 0, y: -20 }, { x: 0, y: 20 }, 0), true, 'a torso spine crossing the attack sector must hit');
  assert.equal(intersects({ x: 55, y: -5 }, { x: 55, y: 5 }, 4), false, 'capsule past the attack reach must miss');
});

test('050 shooter direction is locked at the torso-to-torso windup and its projectile never retargets', () => {
  const { run, enemy } = fixture('shooter', { x: 500, y: 300 }, { x: 300, y: 300 });
  enemy.attackReady = 0;
  core.stepDungeon(run, 100);
  assert.equal(enemy.state, 'windup');
  const origin = core.hurtShape(enemy, 'shooter', run.combat.profile, enemy.radius).center;
  const initialTarget = core.hurtShape(run.player, 'player', run.combat.profile).center;
  const locked = { x: enemy.aimX, y: enemy.aimY };
  run.player.y = 180;
  let attempts = 0;
  while (!run.projectiles.length && attempts++ < 20) core.stepDungeon(run, 100);
  const shot = run.projectiles.find(value => value.owner === 'enemy');
  assert.ok(shot);
  const expected = core.hurtShape(run.player, 'player', run.combat.profile).center;
  const targetDx = initialTarget.x - origin.x, targetDy = initialTarget.y - origin.y;
  assert.ok(Math.abs(targetDx * shot.vy - targetDy * shot.vx) / Math.hypot(shot.vx, shot.vy) < 1e-5);
  assert.deepEqual({ x: enemy.aimX, y: enemy.aimY }, locked);
  const velocity = { x: shot.vx, y: shot.vy };
  run.player.x = 100; run.player.y = 420; core.stepDungeon(run, 100);
  assert.deepEqual({ x: shot.vx, y: shot.vy }, velocity);
  assert.notDeepEqual(expected, initialTarget);
});

test('050 same-tick enemy intents receive staggered attack permits', () => {
  const { run, room } = fixture('shooter', { x: 360, y: 300 });
  room.enemies = [actor('shooter', 540, 300, 'shooter-one'), actor('shooter', 180, 300, 'shooter-two'), actor('shooter', 360, 100, 'shooter-three')];
  advance(run, 500);
  const started = room.enemies.filter(enemy => enemy.state === 'windup').map(enemy => enemy.stateUntil - 600);
  assert.equal(started.length, 3);
  assert.ok(new Set(started).size === 3, `attack starts were not staggered: ${started.join(',')}`);
});

test('050 charger follows its locked vector then enters a readable recovery window', () => {
  const { run, enemy } = fixture('charger', { x: 500, y: 300 }, { x: 300, y: 300 });
  enemy.attackReady = 0;
  core.stepDungeon(run, 100);
  assert.equal(enemy.state, 'windup');
  const locked = { x: enemy.aimX, y: enemy.aimY }, start = { x: enemy.x, y: enemy.y };
  run.player.y = 180;
  let guard = 0;
  while (String(enemy.state) !== 'attack' && guard++ < 20) core.stepDungeon(run, 100);
  core.stepDungeon(run, 100);
  assert.ok(enemy.x > start.x);
  assert.ok(Math.abs(enemy.y - start.y) < 1e-8);
  assert.deepEqual({ x: enemy.aimX, y: enemy.aimY }, locked);
  guard = 0;
  while (String(enemy.state) !== 'recover' && guard++ < 20) core.stepDungeon(run, 100);
  assert.equal(String(enemy.state), 'recover');
});

test('050 shield guard blocks only its facing arc, exposes the rear and opens fully during recovery', () => {
  const makeGuard = (facing: { x: number; y: number }, from: 'front' | 'rear', recovering = false) => {
    const { run, room, enemy } = fixture('guard', { x: 500, y: 300 }, { x: 350, y: 300 });
    enemy.state = recovering ? 'recover' : 'idle'; enemy.stateUntil = 1000;
    run.combat.enemyRuntime = [{ enemyId: enemy.id, staggerUntil: 0, knockbackReadyAt: 0, attackPermitAt: 0, spawnReadyAt: 0, shieldFacing: facing, buffSourceId: null, buffTargetIds: [] }];
    const center = core.hurtShape(enemy, 'guard', run.combat.profile, enemy.radius).center;
    const x = from === 'front' ? center.x + 60 : center.x - 60;
    addShot(run, 'guard-probe-shot', x, center.y, from === 'front' ? -600 : 600, 0);
    core.stepDungeon(run, 100);
    assert.ok(core.parseDungeonRun(run));
    return { run, enemy };
  };
  const front = makeGuard({ x: 1, y: 0 }, 'front');
  assert.equal(front.enemy.hp, 100);
  assert.ok(front.run.combat.feedback.some(value => value.kind === 'block'));
  const sideways = makeGuard({ x: 0, y: 1 }, 'front');
  assert.equal(sideways.enemy.hp, 90);
  const rear = makeGuard({ x: 1, y: 0 }, 'rear');
  assert.equal(rear.enemy.hp, 90);
  const recovery = makeGuard({ x: 1, y: 0 }, 'front', true);
  assert.equal(recovery.enemy.hp, 90);

  const meleeGuard=(facing:{x:number;y:number})=>{
    const {run,room,enemy}=fixture('guard',{x:395,y:300},{x:350,y:300});enemy.state='idle';
    run.combat.enemyRuntime=[{enemyId:enemy.id,staggerUntil:0,knockbackReadyAt:0,attackPermitAt:0,spawnReadyAt:0,shieldFacing:facing,buffSourceId:null,buffTargetIds:[]}];
    run.player.weaponSlots=[{id:'guard-melee-sword',kind:'sword',level:1,evolved:false,form:'base' as const},null];run.player.firing=true;run.player.aimX=enemy.x;run.player.aimY=enemy.y;
    core.dungeonInput(run,{type:'control',moveX:0,moveY:0,aimX:enemy.x,aimY:core.hurtShape(enemy,'guard',run.combat.profile).center.y,firing:true});core.stepDungeon(run,100);return{run,room,enemy};
  };
  const meleeFront=meleeGuard({x:1,y:0});assert.equal(meleeFront.enemy.hp,100);
  const meleeSide=meleeGuard({x:0,y:1});assert.ok(meleeSide.enemy.hp<100);
});

test('050 priest buffs at most two living non-priests and death immediately clears both directions', () => {
  const { run, room, enemy: priest } = fixture('priest', { x: 360, y: 300 }, { x: 330, y: 300 });
  room.enemies.push(actor('chaser', 340, 320, 'buff-target-one'), actor('guard', 350, 340, 'buff-target-two'), actor('priest', 360, 360, 'z-other-priest'));
  core.stepDungeon(run, 100);
  const source = run.combat.enemyRuntime.find(value => value.enemyId === priest.id);
  assert.ok(source);
  assert.ok(source.buffTargetIds.length <= 2);
  assert.ok(!source.buffTargetIds.includes('z-other-priest'));
  assert.ok(source.buffTargetIds.length > 0, JSON.stringify(run.combat.enemyRuntime));
  priest.hp = 0;
  core.stepDungeon(run, 100);
  assert.equal(run.combat.enemyRuntime.some(value => value.enemyId === priest.id), false);
  assert.ok(run.combat.enemyRuntime.every(value => value.buffSourceId !== priest.id));
  assert.ok(core.parseDungeonRun(run));
});

test('050 same-tick projectile deaths immediately unlink priest and buff-target relationships',()=>{
  const kill=(victimKind:'priest'|'target')=>{
    const {run,room,enemy:priest}=fixture('priest',{x:80,y:80},{x:420,y:280});
    const target=actor('chaser',350,340,'same-tick-buff-target');room.enemies=[priest,target];
    for(const enemy of room.enemies){enemy.state='recover';enemy.stateUntil=1e9;enemy.attackReady=1e9;}
    core.stepDungeon(run,50);
    const source=run.combat.enemyRuntime.find(value=>value.enemyId===priest.id)!,targetRuntime=run.combat.enemyRuntime.find(value=>value.enemyId===target.id)!;
    assert.deepEqual(source.buffTargetIds,[target.id]);assert.equal(targetRuntime.buffSourceId,priest.id);
    assert.ok(core.parseDungeonRun(run),`valid buff fixture before kill ${victimKind}`);
    const victim=victimKind==='priest'?priest:target,center=core.hurtShape(victim,victim.kind,run.combat.profile,victim.radius).center;
    victim.hp=1;addShot(run,`lethal-${victimKind}`,center.x-70,center.y,1000,0,100);core.stepDungeon(run,100);
    assert.equal(victim.hp,0);assert.ok(core.parseDungeonRun(run),`${victimKind} death must leave a strict-parseable same-tick state: ${JSON.stringify({enemyRuntime:run.combat.enemyRuntime,enemies:room.enemies.map(value=>({id:value.id,kind:value.kind,hp:value.hp})),pending:room.spawns.pending,phase:room.spawns.phase,roomWave:room.wave,runPhase:run.phase})}`);
    const remainingSource=run.combat.enemyRuntime.find(value=>value.enemyId===priest.id),remainingTarget=run.combat.enemyRuntime.find(value=>value.enemyId===target.id);
    if(victimKind==='priest'){assert.equal(remainingSource,undefined);assert.equal(remainingTarget?.buffSourceId,null);}
    else {assert.equal(remainingTarget,undefined);assert.ok(!remainingSource?.buffTargetIds.includes(target.id));}
  };
  kill('target');kill('priest');
});

test('050 shield regenerates slowly only after a safe stationary, nonattacking opening; pause freezes the clock', () => {
  const safe = fixture('chaser', { x: 120, y: 250 });
  safe.room.enemies = []; safe.run.player.shield = 0; safe.run.player.shieldDelayUntil = 0;
  advance(safe.run, 1000);
  const recovered = safe.run.player.shield;
  assert.ok(recovered > 0 && recovered <= 4.1, `recovery was not slow: ${recovered}`);
  safe.run.player.moveX = 1; advance(safe.run, 1000);
  assert.equal(safe.run.player.shield, recovered);
  safe.run.player.moveX = 0; safe.run.player.firing = true; advance(safe.run, 1000);
  assert.equal(safe.run.player.shield, recovered);
  safe.run.player.firing = false; safe.run.paused = true;
  const before = structuredClone(safe.run); core.stepDungeon(safe.run, 100);
  assert.deepEqual(safe.run, before);
  safe.run.paused = false;
  safe.room.enemies = [actor('chaser', 170, 250, 'nearby-threat')];
  advance(safe.run, 100);
  assert.equal(safe.run.player.shield, recovered);
});
