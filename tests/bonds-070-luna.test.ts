import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advance, initialProfile, parseProfile, transact, leisureReason,
  companionLevel, companionNext, type GameAction, type Profile,
} from '../packages/solo-core';
import {
  BUDDY_LORE, BUDDY_ORDER, NEW_COMPANIONS, PATHS, RARITIES, SETS,
  TRAINING, SECRET_SITES, initialBonds, bondsOf, buddyXP, bondSnapshot,
  bondDuration, secretReason, type Buddy,
} from '../packages/solo-core/bonds';
import { roomTitle, type LeisureAction } from '../packages/solo-core/leisure';

let serial = 0;
function act(p: Profile, action: GameAction): Profile {
  return transact(p, {
    sequence: p.sequence + 1,
    requestId: 'bond070-' + String(++serial).padStart(8, '0'),
    action,
  });
}
function advanceTicks(p: Profile, count: number): Profile {
  return advance(p, p.wallAt + count * 100);
}
function finishStroll(p: Profile): Profile {
  const r = p.leisure.run;
  assert.ok(r, 'fixture has a running stroll');
  const rooms = 6 - r.room + (r.remaining - 1) * 6;
  return advanceTicks(p, rooms * r.duration);
}
function finishOneTrip(p: Profile): Profile {
  const r = p.leisure.run;
  assert.ok(r, 'fixture has a running stroll');
  return advanceTicks(p, (6 - r.room) * r.duration);
}
function withBonds(p: Profile): Profile {
  p.leisure.bonds = initialBonds();
  return p;
}
function own(p: Profile, id: Buddy, xp = 0): Profile {
  p.leisure.companions[id] = xp;
  return p;
}
function clone<T>(value: T): T {
  return structuredClone(value);
}
function assertUnchangedAfterRejectedAction(p: Profile, action: GameAction, pattern: RegExp): void {
  const before = clone(p);
  assert.throws(() => act(p, action), pattern);
  assert.deepEqual(p, before, 'a rejected intent must leave the source profile unchanged');
}
function enabledProfile(zone = 0): Profile {
  const p = withBonds(initialProfile(700_000 + zone));
  p.leisure.clears = Array(5).fill(0);
  for (let i = 0; i < zone; i++) p.leisure.clears[i] = 1;
  return parseProfile(p);
}

test('the extension catalog keeps the original three companions and has six new companions, three paths, 27 stories and five secret sites', () => {
  assert.deepEqual(BUDDY_ORDER.slice(0, 3), ['slime', 'guide', 'guard']);
  assert.equal(BUDDY_ORDER.length, 9);
  assert.equal(Object.keys(NEW_COMPANIONS).length, 6);
  assert.deepEqual(Object.keys(PATHS).sort(), ['gatherer', 'scout', 'seeker']);
  assert.deepEqual(TRAINING, { voyages: [3, 8, 20], xp: [2, 5, 14], coins: [60, 180, 450], ore: [10, 30, 80], food: [1, 3, 5] });
  assert.deepEqual(Object.keys(BUDDY_LORE).sort(), [...BUDDY_ORDER].sort());
  assert.equal(Object.values(BUDDY_LORE).flat().length, 27);
  assert.equal(new Set(Object.values(BUDDY_LORE).flat()).size, 27);
  assert.equal(RARITIES.length, 15);
  assert.equal(SETS.length, 5);
  assert.equal(SECRET_SITES.length, 5);
  assert.deepEqual(SECRET_SITES.map(site => site.stops.length), [6, 6, 6, 6, 6]);
});

test('legacy v7 reads remain byte-shaped and ordinary old strolls do not initialize the extension', () => {
  let p = initialProfile(701_001);
  const oldBytes = JSON.stringify(p);
  const parsed = parseProfile(p);
  assert.equal(JSON.stringify(parsed), oldBytes);
  assert.equal(Object.hasOwn(parsed.leisure, 'bonds'), false);
  for (const id of Object.keys(NEW_COMPANIONS) as Buddy[]) assert.equal(buddyXP(parsed.leisure, id), null);

  p = act(p, { type: 'stroll-start', zone: 0, route: 'balanced', trips: 1 });
  assert.equal(p.leisure.run?.duration, 200);
  assert.equal(p.leisure.run?.bonds, undefined);
  assert.equal(Object.hasOwn(p.leisure, 'bonds'), false);
  p = finishStroll(p);
  assert.equal(p.leisure.run, null);
  assert.equal(Object.hasOwn(p.leisure, 'bonds'), false);
  assert.equal(p.leisure.clears[0], 1);
  assert.equal(bondsOf(p.leisure).letters.length, 0, 'a legacy run must not acquire new letters');
});

test('a rejected new intent does not write defaults, while an explicit secret:false start opts into version-1 bonds', () => {
  let legacy = initialProfile(701_002);
  const before = clone(legacy);
  assertUnchangedAfterRejectedAction(legacy, { type: 'buddy-train', companion: 'fox' }, /邀请/);
  assert.deepEqual(legacy, before);
  assert.equal(Object.hasOwn(legacy.leisure, 'bonds'), false);

  const source = initialProfile(701_003);
  const opted = act(source, { type: 'stroll-start', zone: 0, route: 'balanced', trips: 1, secret: false });
  assert.equal(Object.hasOwn(source.leisure, 'bonds'), false, 'transact clones before writing');
  assert.equal(opted.leisure.bonds?.version, 1);
  assert.equal(opted.leisure.run?.bonds?.secret, false);
  assert.deepEqual(opted.leisure.run?.bonds?.support, null);
  assert.equal(opted.leisure.run?.duration, 200);
});

test('v6 migration preserves a legal in-flight ordinary trip and does not invent bond state', () => {
  let p = initialProfile(701_004);
  p.leisure.clears = [1, 1, 1, 0, 0];
  p.leisure.materials.herb = 7;
  p.leisure.materials.berry = 8;
  p.leisure.materials.mushroom = 9;
  p.leisure.companions.slime = 4;
  p = act(p, { type: 'stroll-start', zone: 2, route: 'treasure', trips: 3 });
  p = advanceTicks(p, p.leisure.run!.duration);
  assert.equal(p.leisure.run?.room, 1);
  const raw = clone(p) as unknown as Record<string, any>;
  raw.version = 6;
  delete raw.camp;
  delete raw.leisure.journal;
  raw.leisure.materials = {
    herb: 7, berry: 8, mushroom: 9, ore: p.leisure.materials.ore,
    tea: p.leisure.materials.tea, biscuit: p.leisure.materials.biscuit,
    soup: p.leisure.materials.soup,
  };
  raw.leisure.clears = raw.leisure.clears.slice(0, 3);
  if (raw.leisure.run) {
    delete raw.leisure.run.depth;
    delete raw.leisure.run.coinBonus;
    delete raw.leisure.run.oreBonus;
    delete raw.leisure.run.dustBonus;
  }
  const before = clone(raw);
  const migrated = parseProfile(raw);
  assert.deepEqual(raw, before, 'migration must not mutate the v6 object');
  assert.equal(migrated.version, 8);
  assert.equal(migrated.leisure.run?.room, 1);
  assert.equal(migrated.leisure.run?.remaining, 3);
  assert.equal(migrated.leisure.run?.bonds, undefined);
  assert.equal(Object.hasOwn(migrated.leisure, 'bonds'), false);
  assert.deepEqual(migrated.leisure.clears, [1, 1, 1, 0, 0]);
  assert.equal(migrated.leisure.journal.relics.length, 15);
});

test('six recruits honor their region gates, exact catalog costs, missing-as-unowned defaults, and duplicate rejection', () => {
  let p = initialProfile(701_005);
  p.coins = 20_000;
  p.leisure.materials.ore = 999;
  for (const [id, data] of Object.entries(NEW_COMPANIONS) as [Buddy, typeof NEW_COMPANIONS[keyof typeof NEW_COMPANIONS]][]) {
    assert.equal(buddyXP(p.leisure, id), null);
    const locked = clone(p);
    locked.leisure.clears = [0, 0, 0, 0, 0];
    assert.match(leisureReason(locked, { type: 'companion-recruit', companion: id }), /完成对应地点/);
    for (let i = 0; i <= data.unlock; i++) p.leisure.clears[i] = 1;
    const coins = p.coins;
    const ore = p.leisure.materials.ore;
    p = act(p, { type: 'companion-recruit', companion: id });
    assert.equal(p.leisure.companions[id], 0);
    assert.equal(p.coins, coins - data.coins);
    assert.equal(p.leisure.materials.ore, ore - data.ore);
    assert.ok(p.leisure.bonds, 'first new recruit initializes the extension exactly once');
    assertUnchangedAfterRejectedAction(p, { type: 'companion-recruit', companion: id }, /已经加入/);
  }
  assert.equal(Object.keys(p.leisure.companions).length, 9);
});

test('leader and support must be distinct owned companions; promoting a support clears the support slot', () => {
  let p = enabledProfile();
  own(p, 'fox');
  own(p, 'deer');
  assertUnchangedAfterRejectedAction(p, { type: 'buddy-support', companion: 'slime' }, /领队不能同时担任支援/);
  assertUnchangedAfterRejectedAction(p, { type: 'buddy-support', companion: 'owl' }, /先邀请/);

  p = act(p, { type: 'buddy-support', companion: 'fox' });
  assert.equal(p.leisure.bonds?.support, 'fox');
  assertUnchangedAfterRejectedAction(p, { type: 'buddy-support', companion: 'fox' }, /已经在支援/);
  p = act(p, { type: 'companion-equip', companion: 'fox' });
  assert.equal(p.leisure.active, 'fox');
  assert.equal(p.leisure.bonds?.support, null);
  assertUnchangedAfterRejectedAction(p, { type: 'companion-equip', companion: 'fox' }, /已经在带队/);

  p = act(p, { type: 'buddy-support', companion: 'deer' });
  p = act(p, { type: 'stroll-start', zone: 0, route: 'balanced', trips: 1, secret: false });
  assertUnchangedAfterRejectedAction(p, { type: 'buddy-support', companion: null }, /回营后/);
  assertUnchangedAfterRejectedAction(p, { type: 'buddy-path', companion: 'fox', path: 'scout' }, /回营后/);
});

test('only completed trips increase leader and support voyages; an early return does not count', () => {
  let p = enabledProfile();
  own(p, 'fox');
  own(p, 'guide');
  p.leisure.active = 'fox';
  p.leisure.bonds!.support = 'guide';
  p = act(p, { type: 'stroll-start', zone: 0, route: 'balanced', trips: 3, secret: false });
  p = finishOneTrip(p);
  assert.equal(p.leisure.run?.remaining, 2);
  assert.equal(p.leisure.bonds?.progress.fox.voyages, 1);
  assert.equal(p.leisure.bonds?.progress.guide.voyages, 1);
  p = advanceTicks(p, 2 * p.leisure.run!.duration);
  assert.equal(p.leisure.run?.room, 2);
  p = act(p, { type: 'stroll-return' });
  assert.equal(p.leisure.bonds?.progress.fox.voyages, 1);
  assert.equal(p.leisure.bonds?.progress.guide.voyages, 1);
  assert.ok(p.leisure.cargo.coins > 0, 'settled encounters are preserved on return');
  p = act(p, { type: 'stroll-claim' });
  p = act(p, { type: 'stroll-start', zone: 0, route: 'balanced', trips: 1, secret: false });
  p = finishStroll(p);
  assert.equal(p.leisure.bonds?.progress.fox.voyages, 2);
  assert.equal(p.leisure.bonds?.progress.guide.voyages, 2);
});

test('all three training ranks require the correct companion level, completed voyage threshold, food and costs; path switches preserve rank', () => {
  let p = enabledProfile();
  own(p, 'fox', 1);
  p.coins = 5_000;
  p.leisure.materials.ore = 500;
  p.leisure.materials.tea = 20;
  p.leisure.materials.soup = 20;
  p.leisure.materials.biscuit = 20;
  p = act(p, { type: 'buddy-path', companion: 'fox', path: 'scout' });
  assert.equal(p.leisure.bonds?.progress.fox.rank, 0);
  assert.equal(leisureReason(p, { type: 'buddy-train', companion: 'fox' }), '伙伴先达到Lv2。');
  const before = clone(p);
  assertUnchangedAfterRejectedAction(p, { type: 'buddy-train', companion: 'fox' }, /Lv2/);
  assert.deepEqual(p, before);

  p.leisure.companions.fox = 2;
  p.leisure.bonds!.progress.fox.voyages = 2;
  assert.match(leisureReason(p, { type: 'buddy-train', companion: 'fox' }), /累计完成3趟/);
  p.leisure.bonds!.progress.fox.voyages = 3;
  let coins = p.coins, ore = p.leisure.materials.ore, tea = p.leisure.materials.tea;
  p = act(p, { type: 'buddy-train', companion: 'fox' });
  assert.deepEqual(p.leisure.bonds?.progress.fox, { path: 'scout', rank: 1, voyages: 3, stories: 0 });
  assert.equal(p.coins, coins - 60);
  assert.equal(p.leisure.materials.ore, ore - 10);
  assert.equal(p.leisure.materials.tea, tea - 1);

  p = act(p, { type: 'buddy-path', companion: 'fox', path: 'gatherer' });
  assert.deepEqual(p.leisure.bonds?.progress.fox, { path: 'gatherer', rank: 1, voyages: 3, stories: 0 });
  p.leisure.companions.fox = 5;
  p.leisure.bonds!.progress.fox.voyages = 7;
  assert.match(leisureReason(p, { type: 'buddy-train', companion: 'fox' }), /累计完成8趟/);
  p.leisure.bonds!.progress.fox.voyages = 8;
  coins = p.coins; ore = p.leisure.materials.ore;
  const soup = p.leisure.materials.soup;
  p = act(p, { type: 'buddy-train', companion: 'fox' });
  assert.equal(p.leisure.bonds?.progress.fox.rank, 2);
  assert.equal(p.coins, coins - 180);
  assert.equal(p.leisure.materials.ore, ore - 30);
  assert.equal(p.leisure.materials.soup, soup - 3);

  p.leisure.companions.fox = 14;
  p.leisure.bonds!.progress.fox.voyages = 19;
  assert.match(leisureReason(p, { type: 'buddy-train', companion: 'fox' }), /累计完成20趟/);
  p.leisure.bonds!.progress.fox.voyages = 20;
  coins = p.coins; ore = p.leisure.materials.ore;
  const soupBefore = p.leisure.materials.soup;
  p = act(p, { type: 'buddy-train', companion: 'fox' });
  assert.equal(p.leisure.bonds?.progress.fox.rank, 3);
  assert.equal(p.coins, coins - 450);
  assert.equal(p.leisure.materials.ore, ore - 80);
  assert.equal(p.leisure.materials.soup, soupBefore - 5);
  assert.equal(companionLevel(14), 5);
  assert.equal(companionNext(14), null);
  assertUnchangedAfterRejectedAction(p, { type: 'buddy-train', companion: 'fox' }, /三阶/);
});

test('the three stories unlock in order, pay once, and respect coin and bounded-currency caps', () => {
  let p = enabledProfile();
  own(p, 'fox');
  p.coins = 1_000;
  p.leisure.bonds!.progress.fox.voyages = 2;
  assert.match(leisureReason(p, { type: 'buddy-story', companion: 'fox' }), /同行达到3趟/);
  p.leisure.bonds!.progress.fox.voyages = 3;
  p = act(p, { type: 'buddy-story', companion: 'fox' });
  assert.equal(p.coins, 1_040);
  assert.equal(p.leisure.bonds?.tokens, 2);
  assert.equal(p.leisure.journal.dust, 1);
  assert.equal(p.leisure.bonds?.progress.fox.stories, 1);
  assertUnchangedAfterRejectedAction(p, { type: 'buddy-story', companion: 'fox' }, /同行达到8趟/);
  p.leisure.bonds!.progress.fox.voyages = 8;
  p = act(p, { type: 'buddy-story', companion: 'fox' });
  assert.equal(p.coins, 1_140);
  assert.equal(p.leisure.bonds?.tokens, 6);
  assert.equal(p.leisure.journal.dust, 4);
  p.leisure.bonds!.progress.fox.voyages = 20;
  p = act(p, { type: 'buddy-story', companion: 'fox' });
  assert.equal(p.coins, 1_390);
  assert.equal(p.leisure.bonds?.tokens, 14);
  assert.equal(p.leisure.journal.dust, 10);
  assert.equal(p.leisure.bonds?.progress.fox.stories, 3);
  assertUnchangedAfterRejectedAction(p, { type: 'buddy-story', companion: 'fox' }, /三篇/);

  let capped = enabledProfile();
  own(capped, 'fox');
  capped.coins = 1_000_000_000 - 39;
  capped.leisure.bonds!.progress.fox.voyages = 3;
  assertUnchangedAfterRejectedAction(capped, { type: 'buddy-story', companion: 'fox' }, /金币空间不足/);
  capped.coins = 1_000_000_000 - 40;
  capped.leisure.bonds!.tokens = 9_998;
  capped.leisure.journal.dust = 9_998;
  capped = act(capped, { type: 'buddy-story', companion: 'fox' });
  assert.equal(capped.coins, 1_000_000_000);
  assert.equal(capped.leisure.bonds?.tokens, 9_999);
  assert.equal(capped.leisure.journal.dust, 9_999);
});

test('all leader and support perks use their documented fields and the bird has different lead/support speed', () => {
  const expected: Record<string, Record<string, number>> = {
    fox: { treasureCoins: 8 }, deer: { herb: 2 }, otter: { treasureOre: 4, tokens: 1 },
    owl: { dust: 1 }, bear: { biscuit: 1 }, bird: { speed: 4 },
  };
  for (const id of Object.keys(NEW_COMPANIONS) as Buddy[]) {
    const lead = enabledProfile();
    own(lead, id);
    lead.leisure.active = id;
    const leadSnap = bondSnapshot(lead, 'balanced', true) as unknown as Record<string, number>;
    for (const [key, value] of Object.entries(expected[id])) assert.equal(leadSnap[key], value, id + ' lead ' + key);

    const support = enabledProfile();
    own(support, id);
    support.leisure.bonds!.support = id;
    const supportSnap = bondSnapshot(support, 'balanced', true) as unknown as Record<string, number>;
    for (const [key, value] of Object.entries(expected[id])) {
      const adjusted = id === 'bird' ? 2 : value;
      assert.equal(supportSnap[key], adjusted, id + ' support ' + key);
    }
  }
  const oldSupportCases: Array<[Buddy, string, number]> = [
    ['slime', 'gel', 1], ['guide', 'coins', 1], ['guard', 'ore', 1],
  ];
  for (const [id, key, value] of oldSupportCases) {
    const p = enabledProfile();
    p.leisure.companions.guard = 0;
    p.leisure.active = id === 'guard' ? 'slime' : 'guard';
    p.leisure.bonds!.support = id;
    const snap = bondSnapshot(p, 'balanced', false) as unknown as Record<string, number>;
    assert.equal(snap[key], value, id + ' legacy support effect');
  }
});

test('each training path changes only its matching snapshot bonuses and the scout reduction feeds trip duration', () => {
  const cases = [
    { path: 'scout' as const, expected: { speed: 6, tokens: 3 }, duration: 188 },
    { path: 'gatherer' as const, expected: { ore: 3, regional: 3 }, duration: 200 },
    { path: 'seeker' as const, expected: { treasureCoins: 18, dust: 3 }, duration: 200 },
  ];
  for (const item of cases) {
    const p = enabledProfile();
    p.leisure.bonds!.progress.slime = { path: item.path, rank: 3, voyages: 20, stories: 3 };
    const snap = bondSnapshot(p, 'gather', false) as unknown as Record<string, number>;
    for (const [key, value] of Object.entries(item.expected)) assert.equal(snap[key], value, item.path + ' ' + key);
    assert.equal(bondDuration(p, 200, 1, 0, false), item.duration, item.path + ' duration');
  }
});

test('each of the fifteen curios and each regional two/three-piece set contributes only its stated snapshot bonuses', () => {
  const expected: Array<Record<string, number>> = [
    { coins: 2 }, { regional: 1 }, { bossOre: 2 }, { speed: 2 }, { dust: 1 },
    { treasureCoins: 8 }, { tokens: 2 }, { xp: 3 }, { ore: 1 }, { biscuit: 1 },
    { regional: 2 }, { coins: 2 }, { speed: 1, bossOre: 1 }, { tokens: 2, dust: 1 }, { bossCoins: 10 },
  ];
  for (let i = 0; i < 15; i++) {
    const p = enabledProfile();
    p.leisure.bonds!.relics[i] = 1;
    p.leisure.bonds!.loadout = [i];
    const snap = bondSnapshot(p, 'gather', true) as unknown as Record<string, number>;
    for (const [key, value] of Object.entries(expected[i])) assert.equal(snap[key], value, 'curio ' + i + ' ' + key);
    if (i === 6 || i === 13) {
      const ordinary = bondSnapshot(p, 'gather', false);
      assert.equal(ordinary.tokens, 0, 'secret-only token effects do not apply to normal regions');
    }
  }

  const twoPieceExpected = [
    { herb: 1, coins: 2, regional: 1 }, { speed: 2, dust: 2 },
    { tokens: 3, xp: 3 }, { biscuit: 2, regional: 2 },
    { speed: 3, tokens: 2, dust: 1 },
  ];
  const threePieceExpected = [
    { herb: 1, coins: 2, regional: 1, bossOre: 4 },
    { speed: 5, dust: 2, treasureCoins: 8 },
    { xp: 9, tokens: 3, ore: 1 },
    { biscuit: 2, regional: 2, coins: 6 },
    { speed: 3, tokens: 5, dust: 1, bossCoins: 10 },
  ];
  for (let zone = 0; zone < 5; zone++) {
    const two = enabledProfile();
    two.leisure.bonds!.relics.fill(1);
    two.leisure.bonds!.loadout = [zone * 3, zone * 3 + 1];
    const twoSnap = bondSnapshot(two, 'gather', true) as unknown as Record<string, number>;
    for (const [key, value] of Object.entries(twoPieceExpected[zone])) assert.equal(twoSnap[key], value, 'set ' + zone + ' two ' + key);

    const three = enabledProfile();
    three.leisure.bonds!.relics.fill(1);
    three.leisure.bonds!.loadout = [zone * 3, zone * 3 + 1, zone * 3 + 2];
    const threeSnap = bondSnapshot(three, 'gather', true) as unknown as Record<string, number>;
    for (const [key, value] of Object.entries(threePieceExpected[zone])) assert.equal(threeSnap[key], value, 'set ' + zone + ' three ' + key);
  }
});

test('rarity upgrades charge the two repair tiers exactly and three slots toggle idempotently while locked in a run', () => {
  let p = enabledProfile();
  p.leisure.bonds!.relics[0] = 1;
  p.leisure.bonds!.relics[1] = 1;
  p.leisure.bonds!.relics[2] = 1;
  p.leisure.bonds!.relics[3] = 1;
  p.leisure.materials.ore = 100;
  p.leisure.journal.dust = 100;
  p.leisure.bonds!.tokens = 100;
  p = act(p, { type: 'rarity-toggle', relic: 0 });
  p = act(p, { type: 'rarity-toggle', relic: 1 });
  p = act(p, { type: 'rarity-toggle', relic: 2 });
  assert.deepEqual(p.leisure.bonds?.loadout, [0, 1, 2]);
  assertUnchangedAfterRejectedAction(p, { type: 'rarity-toggle', relic: 3 }, /最多携带3件/);
  p = act(p, { type: 'rarity-toggle', relic: 2 });
  assert.deepEqual(p.leisure.bonds?.loadout, [0, 1], 'toggling an equipped curio removes it');
  p = act(p, { type: 'rarity-toggle', relic: 2 });
  assert.deepEqual(p.leisure.bonds?.loadout, [0, 1, 2], 'the freed slot can be equipped again exactly once');
  p = act(p, { type: 'stroll-start', zone: 0, route: 'balanced', trips: 1, secret: false });
  assertUnchangedAfterRejectedAction(p, { type: 'rarity-toggle', relic: 2 }, /回营后/);
  const snapshot = clone(p.leisure.run!.bonds);
  const dust = p.leisure.journal.dust, ore = p.leisure.materials.ore, tokens = p.leisure.bonds!.tokens;
  p = act(p, { type: 'rarity-upgrade', relic: 0 });
  assert.equal(p.leisure.bonds?.relics[0], 2);
  assert.equal(p.leisure.bonds?.tokens, tokens - 8);
  assert.equal(p.leisure.journal.dust, dust - 6);
  assert.equal(p.leisure.materials.ore, ore - 20);
  assert.deepEqual(p.leisure.run?.bonds, snapshot, 'repairing a curio mid-trip does not rewrite the departure snapshot');
  const tokens2 = p.leisure.bonds!.tokens, dust2 = p.leisure.journal.dust, ore2 = p.leisure.materials.ore;
  p = act(p, { type: 'rarity-upgrade', relic: 0 });
  assert.equal(p.leisure.bonds?.relics[0], 3);
  assert.equal(p.leisure.bonds?.tokens, tokens2 - 18);
  assert.equal(p.leisure.journal.dust, dust2 - 12);
  assert.equal(p.leisure.materials.ore, ore2 - 50);
  assert.deepEqual(p.leisure.run?.bonds, snapshot, 'the second repair tier also leaves the current trip frozen');
  assertUnchangedAfterRejectedAction(p, { type: 'rarity-upgrade', relic: 0 }, /三星/);
});

test('secret unlock gates and 1.5x duration are enforced; the six-journey gel cap is exactly 126 and fits Lodge Lv3', () => {
  let p = enabledProfile();
  own(p, 'slime', 1);
  p.leisure.clears[0] = 2;
  assert.match(secretReason(p, 0), /3趟普通探索/);
  p.leisure.clears[0] = 3;
  assert.match(secretReason(p, 0), /达到Lv2/);
  p.leisure.companions.slime = 2;
  assert.equal(secretReason(p, 0), '');
  assert.equal(bondDuration(p, 200, 2, 0, false), 190);
  assert.equal(bondDuration(p, 200, 2, 0, true), 285);
  p = act(p, { type: 'stroll-start', zone: 0, route: 'balanced', trips: 1, secret: true });
  assert.equal(p.leisure.run?.duration, 285);
  assert.equal(roomTitle(p.leisure.run!), SECRET_SITES[0].stops[0]);

  let six = initialProfile(701_007);
  six.leisure.journal.buildings.lodge = 3;
  six.leisure.active = 'slime';
  six = act(six, { type: 'stroll-start', zone: 0, route: 'gather', trips: 6, secret: false });
  assert.equal(six.leisure.run?.duration, 200);
  six = finishStroll(six);
  assert.equal(six.leisure.run, null);
  assert.equal(six.leisure.cargo.gel, 126, 'slime plus gathering route yields 21 gel per trip');
  assert.equal(leisureReason(six, { type: 'stroll-claim' }), '');
  six = act(six, { type: 'stroll-claim' });
  assert.equal(six.bag.gel, 126);
});

test('all five secret maps open only at their own clear and level gates and award their own regional supply', () => {
  const crops = ['herb', 'mushroom', 'berry', 'pumpkin', 'snowflower'] as const;
  for (let zone = 0; zone < 5; zone++) {
    let p = enabledProfile(zone);
    p.leisure.clears[zone] = 3;
    p.leisure.companions.slime = 2;
    assert.equal(secretReason(p, zone), '');
    p = act(p, { type: 'stroll-start', zone, route: 'balanced', trips: 1, secret: true });
    assert.equal(p.leisure.run?.zone, zone);
    assert.equal(roomTitle(p.leisure.run!), SECRET_SITES[zone].stops[0]);
    p = finishStroll(p);
    assert.equal(p.leisure.bonds?.secretClears[zone], 1);
    assert.equal(p.leisure.bonds?.satchel[crops[zone]], 2);
  }
});

test('combined companion, path, old relic and three equipped curio speed reductions never exceed fifty percent', () => {
  const p = enabledProfile();
  own(p, 'bird', 14);
  p.leisure.active = 'bird';
  p.leisure.bonds!.progress.bird = { path: 'scout', rank: 3, voyages: 20, stories: 3 };
  p.leisure.journal.relics[2] = 3;
  p.leisure.journal.relics[5] = 3;
  p.leisure.journal.relics[8] = 3;
  p.leisure.journal.relics[11] = 3;
  p.leisure.journal.relics[14] = 3;
  p.leisure.bonds!.relics[3] = 3;
  p.leisure.bonds!.relics[4] = 3;
  p.leisure.bonds!.relics[12] = 3;
  p.leisure.bonds!.loadout = [3, 4, 12];
  assert.doesNotThrow(() => parseProfile(p));
  assert.equal(bondSnapshot(p, 'balanced', false).speed, 19);
  assert.equal(bondDuration(p, 200, 5, 2, false), 200, '200 × 2 depth scale × 50% minimum duration');
  assert.equal(bondDuration(p, 200, 5, 2, true), 300, 'secret scale is applied before the same 50% reduction cap');
});

test('the first three secret clears discover distinct local curios and each pays the 2-token secret base reward', () => {
  let p = enabledProfile();
  p.leisure.clears[0] = 3;
  p.leisure.companions.slime = 2;
  for (let i = 0; i < 3; i++) {
    p = act(p, { type: 'stroll-start', zone: 0, route: 'balanced', trips: 1, secret: true });
    p = finishStroll(p);
    assert.equal(p.leisure.bonds?.secretClears[0], i + 1);
    assert.deepEqual(p.leisure.bonds?.relics.slice(0, 3), [0, 1, 2].map(index => index <= i ? 1 : 0));
    assert.equal(p.leisure.bonds?.satchel.tokens, 2, 'each secret trip pays its base 2 tokens even on a first discovery');
    if (i < 2) p = act(p, { type: 'stroll-claim' });
  }
  assert.deepEqual(p.leisure.bonds?.relics.slice(0, 3), [1, 1, 1]);
  assert.equal(p.leisure.bonds?.tokens, 4, 'the first two claims collect their two-token base rewards');
  assert.equal(p.leisure.bonds?.satchel.tokens, 2, 'the third base reward remains in the unclaimed satchel');
});

test('a fourth depth-1 secret clear pays 3 base tokens plus 3 duplicate-conversion tokens', () => {
  let p = enabledProfile();
  p.leisure.clears[0] = 3;
  p.leisure.companions.slime = 2;
  p.leisure.journal.buildings.lodge = 1;
  p.leisure.bonds!.secretClears[0] = 3;
  p.leisure.bonds!.relics[0] = 1;
  p.leisure.bonds!.relics[1] = 1;
  p.leisure.bonds!.relics[2] = 1;
  p = act(p, { type: 'stroll-start', zone: 0, route: 'balanced', trips: 1, depth: 1, secret: true });
  p = finishStroll(p);
  assert.equal(p.leisure.bonds?.secretClears[0], 4);
  assert.equal(p.leisure.bonds?.satchel.tokens, 6);
});

test('three travel letters do not stop a six-trip run; each choice is one-time and full targets leave the letter selectable', () => {
  let p = enabledProfile();
  p.leisure.journal.buildings.lodge = 3;
  p = act(p, { type: 'stroll-start', zone: 0, route: 'balanced', trips: 6, secret: false });
  p = finishStroll(p);
  assert.equal(p.leisure.run, null);
  assert.deepEqual(p.leisure.bonds?.letters, [{ id: 1, zone: 0 }, { id: 2, zone: 0 }, { id: 3, zone: 0 }]);
  assert.equal(p.leisure.bonds?.letterSequence, 3);
  const id = p.leisure.bonds!.letters[0].id;
  p = act(p, { type: 'travel-letter', id, choice: 'supplies' });
  assert.equal(p.leisure.materials.herb, 2);
  assert.equal(p.leisure.bonds?.letters.length, 2);
  assertUnchangedAfterRejectedAction(p, { type: 'travel-letter', id, choice: 'supplies' }, /已经处理/);

  const remainingId = p.leisure.bonds!.letters[0].id;
  p.leisure.bonds!.tokens = 9_999;
  assertUnchangedAfterRejectedAction(p, { type: 'travel-letter', id: remainingId, choice: 'tokens' }, /徽记已满/);
  const dustBeforeLetter = p.leisure.journal.dust;
  p = act(p, { type: 'travel-letter', id: remainingId, choice: 'notes' });
  assert.equal(p.leisure.journal.dust, dustBeforeLetter + 2);
  assert.equal(p.leisure.bonds?.letters.length, 1);
});

test('the new satchel and legacy cargo are one atomic claim; any full ingredient keeps every reward in place', () => {
  let p = enabledProfile();
  p.leisure.materials.herb = 9_998;
  p.leisure.bonds!.satchel.herb = 2;
  p.leisure.bonds!.satchel.dust = 6;
  p.leisure.bonds!.satchel.tokens = 8;
  p.leisure.cargo = { coins: 21, xp: 7, gel: 3, ore: 4 };
  assertUnchangedAfterRejectedAction(p, { type: 'stroll-claim' }, /伙伴补给空间不足/);
  assert.equal(p.leisure.cargo.coins, 21);
  assert.equal(p.leisure.bonds?.satchel.tokens, 8);

  p.leisure.materials.herb = 9_997;
  p.leisure.journal.dust = 9_998;
  p.leisure.bonds!.tokens = 9_998;
  p = act(p, { type: 'stroll-claim' });
  assert.equal(p.leisure.materials.herb, 9_999);
  assert.equal(p.leisure.journal.dust, 9_999);
  assert.equal(p.leisure.bonds?.tokens, 9_999);
  assert.equal(p.leisure.bonds?.satchel.herb, 0);
  assert.deepEqual(p.leisure.cargo, { coins: 0, xp: 0, gel: 0, ore: 0 });
  assert.equal(p.coins, 41);
  assert.equal(p.bag.gel, 3);
  assert.equal(p.leisure.materials.ore, 4);
});

test('coin, XP, gel, and ore capacity failures all preserve the complete combined claim', () => {
  const cases: Array<[string, (p: Profile) => void, RegExp]> = [
    ['coins', p => { p.coins = 1_000_000_000; p.leisure.cargo.coins = 1; }, /金币或经验已满/],
    ['XP', p => { p.xp = 1_000_000_000_000; p.leisure.cargo.xp = 1; }, /金币或经验已满/],
    ['gel', p => { p.leisure.journal.buildings.lodge = 3; p.bag.gel = 250; p.leisure.cargo.gel = 1; }, /凝胶空间不足/],
    ['ore', p => { p.leisure.materials.ore = 9_999; p.leisure.cargo.ore = 1; }, /月纹石空间不足/],
  ];
  for (const [name, mutate, reason] of cases) {
    const p = enabledProfile();
    p.leisure.bonds!.satchel.tokens = 7;
    mutate(p);
    assertUnchangedAfterRejectedAction(p, { type: 'stroll-claim' }, reason);
    assert.equal(p.leisure.bonds?.satchel.tokens, 7, name + ' failure also retains satchel cargo');
  }
});

test('old expedition rewards remain claimable alongside the old parallel stroll cargo without corrupting either run', () => {
  let p = initialProfile(701_008);
  p.job = 'keeper';
  p.bag.ration = 3;
  p = act(p, { type: 'start-run', region: 0, budget: 3, auto: false });
  assert.ok(p.run);
  p.run!.loot = 20;
  p.bag.gel = 50;
  p.leisure.cargo = { coins: 10, xp: 4, gel: 30, ore: 2 };
  p = withBonds(p);
  p.leisure.bonds!.satchel.tokens = 2;
  p = parseProfile(p);
  const runBefore = clone(p.run);
  assert.equal(leisureReason(p, { type: 'stroll-start', zone: 0, route: 'balanced', trips: 1, secret: false }), '请先结算远征之门的挂机任务。');
  assert.equal(leisureReason(p, { type: 'stroll-claim' }), '');
  p = act(p, { type: 'stroll-claim' });
  assert.equal(p.bag.gel, 80);
  assert.equal(p.leisure.bonds?.tokens, 2);
  assert.equal(p.leisure.materials.ore, 2);
  assert.deepEqual(p.run, runBefore, 'claiming the old expedition must not change its provisional loot or timers');

  let tooMuch = initialProfile(701_009);
  tooMuch.job = 'keeper';
  tooMuch.bag.ration = 3;
  tooMuch = act(tooMuch, { type: 'start-run', region: 0, budget: 3, auto: false });
  tooMuch.run!.loot = 20;
  tooMuch.bag.gel = 50;
  tooMuch.leisure.cargo.gel = 31;
  tooMuch = parseProfile(tooMuch);
  assertUnchangedAfterRejectedAction(tooMuch, { type: 'stroll-claim' }, /凝胶空间不足/);
});

test('profile parsing rejects malformed bond state, but also checks the impossible same-leader/support departure snapshot', () => {
  const p = enabledProfile();
  const invalid: Array<[string, (x: Profile) => void]> = [
    ['internal version', x => { x.leisure.bonds!.version = 2 as 1; }],
    ['negative token balance', x => { x.leisure.bonds!.tokens = -1; }],
    ['duplicate loadout', x => { x.leisure.bonds!.relics[0] = 1; x.leisure.bonds!.loadout = [0, 0]; }],
    ['unowned loadout', x => { x.leisure.bonds!.loadout = [0]; }],
    ['overfull loadout', x => { x.leisure.bonds!.relics.fill(1); x.leisure.bonds!.loadout = [0, 1, 2, 3]; }],
    ['overfull letters', x => { x.leisure.bonds!.letters = [{ id: 1, zone: 0 }, { id: 2, zone: 0 }, { id: 3, zone: 0 }, { id: 4, zone: 0 }]; x.leisure.bonds!.letterSequence = 4; }],
    ['satchel cap', x => { x.leisure.bonds!.satchel.herb = 1_000_001; }],
    ['rank without path', x => { x.leisure.bonds!.progress.slime.rank = 1; }],
  ];
  for (const [name, mutate] of invalid) {
    const candidate = clone(p);
    mutate(candidate);
    assert.throws(() => parseProfile(candidate), Error, name);
  }

  let running = enabledProfile();
  running = act(running, { type: 'stroll-start', zone: 0, route: 'balanced', trips: 1, secret: false });
  running.leisure.bonds!.support = null;
  running.leisure.run!.bonds!.support = 'slime';
  assert.throws(
    () => parseProfile(running),
    /伙伴探索快照无效|支援伙伴无效|探索队伍快照与营地配置不一致/,
    'same partner cannot be snapshotted as both lead and support',
  );
});

test('action parsing is strict and an identical request retry is idempotent', () => {
  let p = initialProfile(701_010);
  const envelope = {
    sequence: p.sequence + 1,
    requestId: 'bond070-retry-0001',
    action: { type: 'stroll-start', zone: 0, route: 'balanced', trips: 1, secret: false },
  };
  const once = transact(p, envelope);
  const retry = transact(p, envelope);
  assert.deepEqual(retry, once);
  assert.equal(once.sequence, 1);
  assert.equal(once.leisure.run?.bonds?.secret, false);
  assert.deepEqual(transact(once, envelope), once, 'retrying the exact saved receipt is idempotent');
  assert.throws(() => transact(once, { ...envelope, requestId: 'bond070-retry-0002' }), /过期/);
  assert.throws(() => act(once, { type: 'stroll-start', zone: 0, route: 'balanced', trips: 1, secret: 'false' } as unknown as GameAction), /探索模式无效/);
  assert.throws(() => act(once, { type: 'buddy-path', companion: 'fox', path: 'escape' } as unknown as GameAction), /培养路线无效/);
  assert.throws(() => act(once, { type: 'travel-letter', id: 1, choice: 'coins' } as unknown as GameAction), /来信选择无效/);
});

test('an impossible run snapshot with support different from current configuration is rejected as a parser invariant', () => {
  let p = enabledProfile();
  own(p, 'fox');
  p = act(p, { type: 'buddy-support', companion: 'fox' });
  p = act(p, { type: 'stroll-start', zone: 0, route: 'balanced', trips: 1, secret: false });
  p.leisure.bonds!.support = null;
  assert.throws(
    () => parseProfile(p),
    /伙伴探索快照无效|支援伙伴无效|探索队伍快照与营地配置不一致/,
    'the immutable snapshot should agree with the trip configuration that cannot be changed while in flight',
  );
});
