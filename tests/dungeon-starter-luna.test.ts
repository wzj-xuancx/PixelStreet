import {legacyDungeonFixture,legacyCompatibleFixture} from './dungeon-legacy-fixture';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activeWeapon,
  createDungeon,
  createEncounter,
  currentRoom,
  dungeonInput,
  nearbyInteractions,
  parseDungeonRun,
  roomDoors,
  stepDungeon,
  type DungeonRun,
  type WeaponKind,
} from '../packages/dungeon-core';

function step(r: DungeonRun, n = 1): void {
  for (let i = 0; i < n; i++) stepDungeon(r);
}

function openEntranceChest(r: DungeonRun): void {
  const chest = nearbyInteractions(r).find(v => v.kind === 'chest');
  assert.ok(chest, 'the entrance chest is available nearby');
  dungeonInput(r, { type: 'interact', id: chest.id });
}

function pickUp(r: DungeonRun, id = currentRoom(r).ground[0]?.id): void {
  assert.ok(id, 'a ground weapon exists');
  dungeonInput(r, { type: 'interact', id });
}

function enter(r: DungeonRun, target: string): void {
  const source = currentRoom(r);
  const door = roomDoors(r).find(v => v.to === target);
  assert.ok(door, `door to ${target} exists`);
  const moveX = door.side === 'W' ? -1 : door.side === 'E' ? 1 : 0;
  const moveY = door.side === 'N' ? -1 : door.side === 'S' ? 1 : 0;
  r.player.x = door.side === 'W' ? 35 : door.side === 'E' ? source.width - 35 : source.width / 2;
  r.player.y = door.side === 'N' ? 35 : door.side === 'S' ? source.height - 35 : source.height / 2;
  dungeonInput(r, { type: 'control', moveX, moveY, aimX: r.player.x, aimY: r.player.y, firing: false });
  step(r);
  assert.equal(r.currentRoom, target);
}

test('production starts with two real empty slots and empty hands cannot attack or damage', () => {
  const production = createDungeon(4101);
  assert.deepEqual(production.player.weaponSlots, [null, null]);
  assert.equal(activeWeapon(production), null);
  assert.equal(currentRoom(production).ground.length, 0);

  const r = createEncounter(4101);
  r.player.weaponSlots = [null, null];
  r.player.x = 100;
  r.player.y = 100;
  const room = currentRoom(r);
  room.obstacles = [];
  room.traps = [];
  const target = room.enemies[0];
  room.enemies = [target];
  target.x = 145;
  target.y = 100;
  target.state = 'recover';
  target.stateUntil = 1e6;
  target.attackReady = 1e6;
  const hp = target.hp;

  dungeonInput(r, { type: 'control', moveX: 0, moveY: 0, aimX: target.x, aimY: target.y, firing: true });
  step(r, 90);
  dungeonInput(r, { type: 'control', moveX: 0, moveY: 0, aimX: target.x, aimY: target.y, firing: false });
  dungeonInput(r, { type: 'skill', skill: 'burst' });

  assert.equal(target.hp, hp);
  assert.equal(r.player.chargeStarted, null);
  assert.equal(r.player.attackReady, 0);
  assert.equal(r.player.skillReady, 0);
  assert.deepEqual(r.projectiles, []);
  assert.deepEqual(r.zones, []);
  assert.equal(r.effects.some(v => ['slash', 'lightning', 'burst'].includes(v.kind)), false);
  assert.ok(parseDungeonRun(production));
  assert.ok(parseDungeonRun(r));
});

test('starter chest draws all twelve weapon kinds reproducibly across 512 seeds', () => {
  const counts = new Map<WeaponKind, number>();
  for (let seed = 0; seed < 512; seed++) {
    const a = createDungeon(seed);
    const b = createDungeon(seed);
    openEntranceChest(a);
    openEntranceChest(b);
    assert.deepEqual(currentRoom(a).ground, currentRoom(b).ground, `seed ${seed} repeats exactly`);
    const item = currentRoom(a).ground[0];
    assert.ok(item, `seed ${seed} creates a physical ground item`);
    assert.equal(item.weapon.level, 1);
    assert.equal(item.weapon.evolved, false);
    counts.set(item.weapon.kind, (counts.get(item.weapon.kind) ?? 0) + 1);
    assert.ok(parseDungeonRun(a));
  }
  assert.deepEqual([...counts.keys()].sort(), ['boomerang','chain','dual','fire','fists','frost','greatsword','hammer','lightning','scythe','spear','sword']);
  for (const [kind, count] of counts) assert.ok(count >= 20, `${kind} appeared only ${count} times`);
});

test('opening and collecting are separate nearby confirmations with no automatic reward', () => {
  const r = createDungeon(4102);
  const room = currentRoom(r);
  const chest = nearbyInteractions(r).find(v => v.kind === 'chest');
  assert.ok(chest);

  r.player.x = 35;
  r.player.y = 35;
  dungeonInput(r, { type: 'interact', id: chest.id });
  step(r, 120);
  assert.equal(room.chestOpened, false);
  assert.equal(room.ground.length, 0);

  r.player.x = room.width / 2;
  r.player.y = room.height / 2;
  openEntranceChest(r);
  const dropped = room.ground[0];
  assert.ok(dropped);
  assert.equal(room.chestOpened, true);
  assert.deepEqual(r.player.weaponSlots, [null, null]);
  assert.deepEqual({ x: dropped.x, y: dropped.y }, { x: room.width / 2, y: room.height / 2 + 24 });

  r.player.x = 35;
  r.player.y = 35;
  pickUp(r, dropped.id);
  step(r, 120);
  assert.equal(room.ground.length, 1);
  assert.deepEqual(r.player.weaponSlots, [null, null]);

  r.player.x = dropped.x;
  r.player.y = dropped.y;
  pickUp(r, dropped.id);
  assert.deepEqual(r.player.weaponSlots, [dropped.weapon, null]);
  assert.equal(activeWeapon(r)?.id, dropped.weapon.id);
  assert.equal(room.ground.length, 0);
  assert.ok(parseDungeonRun(r));
});

test('a full-slot replacement drops the old active weapon and it can be collected again', () => {
  const r = createDungeon(4103);
  openEntranceChest(r);
  pickUp(r);
  const first = activeWeapon(r)!;
  first.level = 4;

  const room = currentRoom(r);
  room.ground.push({ id: 'fixture-second-drop', x: r.player.x, y: r.player.y, weapon: { id: 'fixture-second', kind: 'fire', level: 2, evolved:false,form:'base' as const } });
  pickUp(r, 'fixture-second-drop');
  assert.equal(r.player.weaponSlots[1]?.id, 'fixture-second');
  dungeonInput(r, { type: 'switch' });
  const displaced = activeWeapon(r)!;

  room.ground.push({ id: 'fixture-third-drop', x: r.player.x, y: r.player.y, weapon: { id: 'fixture-third', kind: 'frost', level: 3, evolved:false,form:'base' as const } });
  pickUp(r, 'fixture-third-drop');
  assert.equal(activeWeapon(r)?.id, 'fixture-third');
  assert.deepEqual(r.player.weaponSlots[0], first);
  const dropped = room.ground.find(v => v.weapon.id === displaced.id);
  assert.ok(dropped, 'the replaced weapon remains on the ground');
  assert.deepEqual(dropped.weapon, displaced, 'the old weapon keeps its level and identity');

  pickUp(r, dropped.id);
  assert.equal(activeWeapon(r)?.id, displaced.id);
  assert.equal(activeWeapon(r)?.level, displaced.level);
  assert.ok(room.ground.some(v => v.weapon.id === 'fixture-third'), 'the weapon displaced by recovery also remains available');
  const weaponIds = [
    ...r.player.weaponSlots.filter((v): v is NonNullable<typeof v> => v !== null).map(v => v.id),
    ...room.ground.map(v => v.weapon.id),
  ];
  assert.equal(new Set(weaponIds).size, weaponIds.length);
  assert.ok(parseDungeonRun(r));
});

test('save/load and repeated room entry preserve an opened chest without granting another weapon', () => {
  let r = createDungeon(4104);
  openEntranceChest(r);
  const originalDrop = structuredClone(currentRoom(r).ground[0]);
  r = parseDungeonRun(JSON.parse(JSON.stringify(r)))!;
  assert.ok(r);

  for (let i = 0; i < 2; i++) {
    enter(r, 'crossroads');
    r = parseDungeonRun(JSON.parse(JSON.stringify(r)))!;
    assert.ok(r);
    enter(r, 'entrance');
    const room = currentRoom(r);
    assert.equal(room.chestOpened, true);
    assert.deepEqual(room.ground, [originalDrop]);
    r.player.x = room.width / 2;
    r.player.y = room.height / 2;
    dungeonInput(r, { type: 'interact', id: 'chest-entrance' });
    assert.deepEqual(room.ground, [originalDrop]);
  }

  r.player.x = originalDrop.x;
  r.player.y = originalDrop.y;
  pickUp(r, originalDrop.id);
  assert.deepEqual(currentRoom(r).ground, []);
  assert.equal(activeWeapon(r)?.id, originalDrop.weapon.id);
  r = parseDungeonRun(JSON.parse(JSON.stringify(r)))!;
  assert.ok(r);

  for (let i = 0; i < 2; i++) {
    enter(r, 'crossroads');
    r = parseDungeonRun(JSON.parse(JSON.stringify(r)))!;
    assert.ok(r);
    enter(r, 'entrance');
    const room = currentRoom(r);
    assert.equal(room.chestOpened, true);
    assert.deepEqual(room.ground, []);
    r.player.x = room.width / 2;
    r.player.y = room.height / 2;
    dungeonInput(r, { type: 'interact', id: 'chest-entrance' });
    assert.deepEqual(room.ground, []);
    assert.equal(activeWeapon(r)?.id, originalDrop.weapon.id);
  }
  assert.ok(parseDungeonRun(r));
});

test('v2 migration preserves progress, closes the starter chest, and rejects malformed saves', () => {
  const source = legacyCompatibleFixture(createDungeon(4105));
  source.player.weaponSlots = [
    { id: 'legacy-sword', kind: 'sword', level: 4, evolved:false,form:'base' as const },
    { id: 'legacy-frost', kind: 'frost', level: 2, evolved:false,form:'base' as const },
  ];
  source.player.activeSlot = 1;
  source.player.hp = 66;
  source.player.shield = 8;
  source.player.traits = ['deep-freeze', 'shatter'];source.combat.traitRanks=source.player.traits.map(id=>({id,rank:1 as const}));
  source.player.damageRank = 2;
  source.reward = { coins: 57, xp: 72 };
  source.level = 5;
  source.elapsedMs = 1234;
  source.tick = 74;
  const legacy = legacyDungeonFixture(source,2);
  const before = structuredClone(legacy);

  const migrated = parseDungeonRun(legacy);
  assert.ok(migrated);
  assert.deepEqual(legacy, before, 'migration does not mutate its v2 input');
  assert.equal(migrated.version, 4);
  assert.equal(migrated.runId, source.runId);
  assert.equal(migrated.seed, source.seed);
  assert.deepEqual(migrated.player.weaponSlots, source.player.weaponSlots);
  assert.equal(migrated.player.activeSlot, 1);
  assert.equal(migrated.player.hp, 66);
  assert.equal(migrated.player.shield, 8);
  assert.deepEqual(migrated.player.traits, ['deep-freeze', 'shatter']);
  assert.equal(migrated.player.damageRank, 2);
  assert.deepEqual(migrated.reward, { coins: 57, xp: 72 });
  assert.equal(migrated.level, 5);
  assert.equal(migrated.elapsedMs, 1234);
  assert.equal(migrated.tick, 74);
  const migratedEntrance = migrated.rooms.find(v => v.kind === 'entrance')!;
  assert.equal(migratedEntrance.chestOpened, true);
  assert.deepEqual(migratedEntrance.ground, []);

  migrated.currentRoom = 'entrance';
  const chest = nearbyInteractions(migrated).find(v => v.kind === 'chest');
  assert.equal(chest, undefined);
  dungeonInput(migrated, { type: 'interact', id: 'chest-entrance' });
  assert.deepEqual(currentRoom(migrated).ground, []);
  assert.deepEqual(migrated.player.weaponSlots, source.player.weaponSlots);
  assert.ok(parseDungeonRun(migrated));

  const emptyV2 = structuredClone(legacy);
  emptyV2.player.weaponSlots = [null, null];
  assert.equal(parseDungeonRun(emptyV2), null, 'a v2 save with no legacy weapon is rejected');
  const badActiveSlot = structuredClone(legacy);
  Reflect.set(badActiveSlot.player, 'activeSlot', 2);
  assert.equal(parseDungeonRun(badActiveSlot), null, 'a v2 save with an invalid active slot is rejected');
  const badV3 = structuredClone(source);
  badV3.player.activeSlot = 0;
  badV3.player.weaponSlots[0] = null;
  assert.equal(parseDungeonRun(badV3), null, 'a v3 save selecting an empty hand is rejected');
});
