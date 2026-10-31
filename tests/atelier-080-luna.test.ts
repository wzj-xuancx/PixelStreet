import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advance, initialProfile, parseAction, parseProfile, transact,
  type GameAction, type Profile,
} from '../packages/solo-core';
import {
  atelierBatchLimit, atelierOf, atelierPrice, atelierReason, atelierShelfLimit,
  atelierTicks, atelierWork, facilityCost, FORMULAS, GOOD_IDS as ALL_GOOD_IDS, initialAtelier,
  MASTERY, MARKET, QUOTES, stableAtelierOrder, type Atelier, type Good,
  type Station,
} from '../packages/solo-core/atelier';

const GOOD_IDS:Good[]=ALL_GOOD_IDS.filter(g=>g!=='herbal-bandage'&&g!=='mining-tonic');
let serial = 0;
function act(p: Profile, action: GameAction): Profile {
  return transact(p, {
    sequence: p.sequence + 1,
    requestId: 'atelier080-' + String(++serial).padStart(8, '0'),
    action,
  });
}
function ticks(p: Profile, n: number): Profile {
  return advance(p, p.wallAt + n * 100);
}
function clone<T>(value: T): T { return structuredClone(value); }
function a(p: Profile): Atelier {
  assert.ok(p.atelier, 'atelier has been explicitly initialized');
  return p.atelier;
}
function fixture(now = 800_001): Profile {
  const p = initialProfile(now);
  p.job = 'keeper';
  p.coins = 100_000;
  p.bag.flour = 500;
  p.bag.gel = 100;
  p.leisure.materials = {
    herb: 1000, berry: 1000, mushroom: 1000, ore: 1000, tea: 0,
    biscuit: 0, soup: 0, pumpkin: 1000, snowflower: 1000,
    pie: 0, snowtea: 0,
  };
  p.leisure.journal.dust = 500;
  p.atelier = initialAtelier();
  return parseProfile(p);
}
function allUnlocked(now = 800_002): Profile {
  const p = fixture(now);
  p.leisure.clears = [1, 1, 1, 1, 1];
  p.atelier!.facilities = { kitchen: 3, still: 3, counter: 3 };
  return parseProfile(p);
}
function assertRejectedUnchanged(p: Profile, action: GameAction, reason: RegExp): void {
  const before = clone(p);
  assert.throws(() => act(p, action), reason);
  assert.deepEqual(p, before, 'a rejected action leaves the source profile unchanged');
}
function legacyRun(loot: number, tick: number): NonNullable<Profile['run']> {
  return {
    id: 'run-1', wave: 0, region: 0, budget: 1, remaining: 1, spent: 0,
    loot, defeated: [], phase: 'travel', due: tick + 10, hp: 70,
    enemyHP: 0, enemyMax: 0, nextAttack: 0, enemyAttack: 0,
    frostReady: tick, shatterReady: tick, markedUntil: 0, auto: false,
    log: 'test fixture',
  };
}

test('formula catalogue, purchase prices, quote intervals, facilities and mastery thresholds match the 0.8.0 contract', () => {
  assert.equal(ALL_GOOD_IDS.length,11);
  assert.deepEqual(Object.fromEntries(GOOD_IDS.map(g=>[g,FORMULAS[g]])), {
    picnic: { name: '旅人野餐篮', station: 'supply', level: 0, ticks: 300, price: 32, cost: { flour: 4, berry: 2, gel: 1 }, use: '打开获得3口粮、1莓果饼', gives: { ration: 3, biscuit: 1 } },
    stew: { name: '菌香补给盒', station: 'supply', level: 1, ticks: 400, price: 38, cost: { flour: 2, mushroom: 2, herb: 2 }, use: '打开获得2口粮、1菌菇汤', gives: { ration: 2, soup: 1 } },
    gift: { name: '星糖礼盒', station: 'supply', level: 2, zone: 3, ticks: 600, price: 60, cost: { flour: 3, berry: 3, pumpkin: 1 }, use: '打开获得2莓果饼、1南瓜派', gives: { biscuit: 2, pie: 1 } },
    dew: { name: '萤露药剂', station: 'alchemy', level: 0, ticks: 200, price: 18, cost: { herb: 2, gel: 1 }, use: '第一块生长中的花圃缩短30秒' },
    ink: { name: '星尘墨', station: 'alchemy', level: 0, ticks: 300, price: 24, cost: { berry: 2, ore: 2 }, use: '使用获得2星尘', gives: { dust: 2 } },
    ingot: { name: '精炼晶', station: 'alchemy', level: 0, ticks: 450, price: 36, cost: { ore: 4, gel: 1 }, use: '用于二、三级设施研修' },
    nectar: { name: '伙伴蜜酿', station: 'alchemy', level: 1, ticks: 400, price: 30, cost: { berry: 3, herb: 1 }, use: '使用获得2莓果饼', gives: { biscuit: 2 } },
    incense: { name: '古木香氛', station: 'alchemy', level: 2, ticks: 500, price: 42, cost: { mushroom: 2, herb: 2, gel: 1 }, use: '使用获得1花草茶、1菌菇汤', gives: { tea: 1, soup: 1 } },
    frost: { name: '霜花晶瓶', station: 'alchemy', level: 3, zone: 4, ticks: 600, price: 80, cost: { snowflower: 2, dust: 1 }, use: '使用获得2雪绒暖茶', gives: { snowtea: 2 } },
  });
  assert.equal(GOOD_IDS.length, 9);
  assert.deepEqual(MARKET, { herb: 3, berry: 4, mushroom: 6, ore: 5, pumpkin: 9, snowflower: 12 });
  assert.deepEqual(QUOTES, { quick: { name: '快卖', percent: 80, ticks: 600 }, normal: { name: '原价', percent: 100, ticks: 900 }, premium: { name: '精品', percent: 140, ticks: 1500 } });
  const p = fixture();
  assert.deepEqual(facilityCost(a(p), 'kitchen'), { coins: 60, ore: 8, ingot: 0 });
  assert.deepEqual(facilityCost(a(p), 'still'), { coins: 60, ore: 8, ingot: 0 });
  assert.deepEqual(facilityCost(a(p), 'counter'), { coins: 60, ore: 8, ingot: 0 });
  assert.deepEqual(MASTERY, [10, 50, 150]);
  assert.equal(atelierPrice('picnic', 'quick'), 25);
  assert.equal(atelierPrice('picnic', 'premium'), 44);
  assert.equal(atelierShelfLimit(a(p)), 30);
  assert.equal(atelierBatchLimit(a(p), 'supply'), 10);
  assert.equal(atelierBatchLimit(a(p), 'alchemy'), 10);
  const high = allUnlocked();
  assert.equal(atelierShelfLimit(a(high)), 75);
  assert.equal(atelierBatchLimit(a(high), 'supply'), 30);
  assert.equal(atelierBatchLimit(a(high), 'alchemy'), 30);
});

test('legacy v7 profiles remain lazy and byte-shaped until a successful explicit atelier action', () => {
  let p = initialProfile(800_010);
  const before = JSON.stringify(p);
  const parsed = parseProfile(p);
  assert.equal(parsed.version, 8);
  assert.equal(JSON.stringify(parsed), before);
  assert.equal(Object.hasOwn(parsed, 'atelier'), false);

  p = act(p, { type: 'apply-job' });
  assert.equal(Object.hasOwn(p, 'atelier'), false, 'old actions do not opt into the extension');
  const visitor = initialProfile(800_011);
  assertRejectedUnchanged(visitor, { type: 'atelier-craft', good: 'picnic', count: 1 }, /任职/);
  assert.equal(Object.hasOwn(visitor, 'atelier'), false, 'rejected intent does not write defaults');

  const keeper = fixture(800_012);
  delete keeper.atelier;
  const next = act(keeper, { type: 'atelier-open', station: 'supply', open: true });
  assert.equal(Object.hasOwn(keeper, 'atelier'), false, 'transact clones before adding version-1 defaults');
  assert.equal(next.version, 8);
  assert.equal(next.atelier?.version, 1);
  assert.equal(next.atelier?.open.supply, true);
  assert.equal(next.atelier?.open.alchemy, false);
});

test('all nine goods can be prepaid, produced at their station timer, and recorded in independent stock/mastery totals', () => {
  for (const good of GOOD_IDS) {
    const p = allUnlocked(801_000 + GOOD_IDS.indexOf(good));
    const f = FORMULAS[good];
    const before = clone(p);
    const due = p.tick + Math.ceil(f.ticks * 0.7);
    const queued = act(p, { type: 'atelier-craft', good, count: 1 });
    assert.equal(a(queued).queues[f.station].length, 1, `${good} uses its proper station queue`);
    assert.deepEqual(a(queued).queues[f.station][0], { id: before.sequence + 1, good, remaining: 1, due });
    for (const [reagent, count] of Object.entries(f.cost)) {
      const read = reagent === 'flour' || reagent === 'gel' ? queued.bag[reagent] : reagent === 'dust' ? queued.leisure.journal.dust : queued.leisure.materials[reagent as keyof Profile['leisure']['materials']];
      const old = reagent === 'flour' || reagent === 'gel' ? before.bag[reagent] : reagent === 'dust' ? before.leisure.journal.dust : before.leisure.materials[reagent as keyof Profile['leisure']['materials']];
      assert.equal(read, old - count!, `${good} prepays ${reagent}`);
    }
    const made = ticks(queued, due - queued.tick);
    assert.equal(made.atelier?.stock[good], 1);
    assert.equal(made.atelier?.made[good], 1);
    assert.equal(made.atelier?.queues[f.station].length, 0);
    assert.equal(made.atelier?.queues[f.station === 'supply' ? 'alchemy' : 'supply'].length, 0);
  }
});

test('facility and region locks block the correct recipes without charging or initializing legacy profiles', () => {
  const p = fixture(802_000);
  assertRejectedUnchanged(p, { type: 'atelier-craft', good: 'stew', count: 1 }, /野炊炉Lv1/);
  assertRejectedUnchanged(p, { type: 'atelier-craft', good: 'gift', count: 1 }, /野炊炉Lv2/);
  assertRejectedUnchanged(p, { type: 'atelier-craft', good: 'nectar', count: 1 }, /蒸馏台Lv1/);
  assertRejectedUnchanged(p, { type: 'atelier-craft', good: 'incense', count: 1 }, /蒸馏台Lv2/);
  assertRejectedUnchanged(p, { type: 'atelier-craft', good: 'frost', count: 1 }, /蒸馏台Lv3/);

  const lvl2 = clone(p);
  lvl2.atelier!.facilities.kitchen = 2;
  lvl2.leisure.clears = [1, 1, 1, 0, 0];
  const p2 = parseProfile(lvl2);
  assertRejectedUnchanged(p2, { type: 'atelier-craft', good: 'gift', count: 1 }, /风铃麦田/);
  const lvl3 = clone(p2);
  lvl3.atelier!.facilities.still = 3;
  const p3 = parseProfile(lvl3);
  assertRejectedUnchanged(p3, { type: 'atelier-craft', good: 'frost', count: 1 }, /霜灯雪境/);

  let unlocked = clone(p3);
  unlocked.leisure.clears = [1, 1, 1, 1, 1];
  unlocked = parseProfile(unlocked);
  assert.equal(atelierReason(unlocked, { type: 'atelier-craft', good: 'gift', count: 1 }), '');
  assert.equal(atelierReason(unlocked, { type: 'atelier-craft', good: 'frost', count: 1 }), '');
});

test('each station has its own three prepaid batches, while ingredients and the 9999 reservation cap are checked together', () => {
  let p = fixture(803_000);
  p.bag.gel = 100;
  p = parseProfile(p);
  p = act(p, { type: 'atelier-craft', good: 'picnic', count: 10 });
  p = act(p, { type: 'atelier-craft', good: 'picnic', count: 10 });
  p = act(p, { type: 'atelier-craft', good: 'picnic', count: 10 });
  assert.equal(a(p).queues.supply.length, 3);
  assert.deepEqual(a(p).queues.supply.map(q => q.due), [300, 0, 0]);
  assertRejectedUnchanged(p, { type: 'atelier-craft', good: 'picnic', count: 1 }, /3批排产已满/);
  p = act(p, { type: 'atelier-craft', good: 'dew', count: 10 });
  assert.equal(a(p).queues.alchemy.length, 1);
  assert.equal(p.bag.flour, 380);
  assert.equal(p.leisure.materials.berry, 940);
  assert.equal(p.bag.gel, 60);
  assert.equal(p.leisure.materials.herb, 980);

  const cap = fixture(803_001);
  cap.atelier!.stock.picnic = 9997;
  let c = parseProfile(cap);
  c = act(c, { type: 'atelier-craft', good: 'picnic', count: 2 });
  assert.equal(c.atelier!.stock.picnic + c.atelier!.shelves.picnic.stock + c.atelier!.queues.supply[0].remaining, 9999);
  assertRejectedUnchanged(c, { type: 'atelier-craft', good: 'picnic', count: 1 }, /成品与在制库存已满/);
  const invalid = clone(c);
  invalid.atelier!.stock.picnic = 9998;
  assert.throws(() => parseProfile(invalid), /工坊成品预留超限/);
});

test('batch maximums are 10/20/30 by facility level and the third level changes only future portions of a running batch', () => {
  let p = fixture(804_000);
  assert.equal(atelierBatchLimit(a(p), 'supply'), 10);
  assertRejectedUnchanged(p, { type: 'atelier-craft', good: 'picnic', count: 11 }, /每批最多10份/);
  p = act(p, { type: 'atelier-craft', good: 'picnic', count: 2 });
  const originalDue = a(p).queues.supply[0].due;
  p = act(p, { type: 'atelier-upgrade', facility: 'kitchen' });
  assert.equal(a(p).facilities.kitchen, 1);
  assert.equal(a(p).queues.supply[0].due, originalDue, 'upgrades do not rewrite the current due time');
  assert.equal(atelierBatchLimit(a(p), 'supply'), 10);
  p = ticks(p, originalDue - p.tick);
  assert.equal(a(p).stock.picnic, 1);
  assert.equal(a(p).queues.supply[0].remaining, 1);
  assert.equal(a(p).queues.supply[0].due, p.tick + 270, 'next unit uses the upgraded 10% faster timer');

  const maxed = allUnlocked(804_001);
  assert.equal(atelierBatchLimit(a(maxed), 'supply'), 30);
  assert.equal(atelierBatchLimit(a(maxed), 'alchemy'), 30);
  assert.equal(atelierTicks(a(maxed), 'picnic'), 210);
  assert.equal(atelierTicks(a(maxed), 'dew'), 140);
  assertRejectedUnchanged(maxed, { type: 'atelier-craft', good: 'picnic', count: 31 }, /工坊数值无效/);
});

test('cancelling a partially completed batch refunds only the unmade shares and pending cancellation refunds exactly once', () => {
  let p = fixture(805_000);
  p = act(p, { type: 'atelier-craft', good: 'picnic', count: 3 });
  const firstDue = a(p).queues.supply[0].due;
  p = ticks(p, firstDue - p.tick);
  assert.equal(a(p).stock.picnic, 1);
  assert.equal(a(p).made.picnic, 1);
  assert.equal(a(p).queues.supply[0].remaining, 2);
  const beforeCancel = clone(p);
  p = act(p, { type: 'atelier-cancel', station: 'supply', position: 0, id: a(p).queues.supply[0].id });
  assert.equal(p.bag.flour, beforeCancel.bag.flour + 8);
  assert.equal(p.leisure.materials.berry, beforeCancel.leisure.materials.berry + 4);
  assert.equal(p.bag.gel, beforeCancel.bag.gel + 2);
  assert.equal(a(p).stock.picnic, 1, 'already completed output is not refunded');
  assert.equal(a(p).made.picnic, 1, 'mastery counts only finished pieces');
  assert.equal(a(p).queues.supply.length, 0);
  assertRejectedUnchanged(p, { type: 'atelier-cancel', station: 'supply', position: 0, id: 1 }, /已经完成或队列已变化/);

  let pending = fixture(805_001);
  pending.atelier!.facilities.kitchen = 1;
  pending = parseProfile(pending);
  pending = act(pending, { type: 'atelier-craft', good: 'picnic', count: 3 });
  pending = act(pending, { type: 'atelier-craft', good: 'stew', count: 2 });
  const pendingBefore = clone(pending);
  pending = act(pending, { type: 'atelier-cancel', station: 'supply', position: 1, id: a(pending).queues.supply[1].id });
  assert.equal(pending.bag.flour, pendingBefore.bag.flour + 4);
  assert.equal(pending.leisure.materials.mushroom, pendingBefore.leisure.materials.mushroom + 4);
  assert.equal(pending.leisure.materials.herb, pendingBefore.leisure.materials.herb + 4);
  assert.equal(a(pending).queues.supply.length, 1);
});

test('a cancellation intent tied to an old queue row cannot cancel the next batch after that row completes', () => {
  let p = fixture(805_002);
  p.atelier!.facilities.kitchen = 1;
  p = parseProfile(p);
  p = act(p, { type: 'atelier-craft', good: 'picnic', count: 1 });
  p = act(p, { type: 'atelier-craft', good: 'stew', count: 2 });
  const oldRowIntent = { type: 'atelier-cancel', station: 'supply', position: 0, id: a(p).queues.supply[0].id } as const;
  p = ticks(p, a(p).queues.supply[0].due - p.tick);
  assert.equal(a(p).stock.picnic, 1);
  assert.equal(a(p).queues.supply[0].good, 'stew', 'the pending batch now occupies the former first-row position');
  assert.notEqual(a(p).queues.supply[0].id, oldRowIntent.id);
  assertRejectedUnchanged(p, oldRowIntent, /已经完成或队列已变化/);
});

test('cancellation rechecks old bag and expedition-reserved gel space and keeps the full batch when refunds cannot fit', () => {
  let p = fixture(806_000);
  p = act(p, { type: 'atelier-craft', good: 'picnic', count: 1 });
  const fullFlour = clone(p);
  fullFlour.bag.flour = 1_000_000;
  p = parseProfile(fullFlour);
  assertRejectedUnchanged(p, { type: 'atelier-cancel', station: 'supply', position: 0, id: a(p).queues.supply[0].id }, /退款材料空间不足/);
  p.bag.flour -= 4;
  p = parseProfile(p);
  const preRefund = p.bag.flour;
  p = act(p, { type: 'atelier-cancel', station: 'supply', position: 0, id: a(p).queues.supply[0].id });
  assert.equal(p.bag.flour, preRefund + 4);

  let gel = fixture(806_001);
  gel = act(gel, { type: 'atelier-craft', good: 'picnic', count: 1 });
  gel.run = legacyRun(1, gel.tick);
  gel = parseProfile(gel);
  assert.equal(gel.bag.gel + gel.run!.loot, 100);
  assertRejectedUnchanged(gel, { type: 'atelier-cancel', station: 'supply', position: 0, id: a(gel).queues.supply[0].id }, /退款材料空间不足/);
});

test('market purchases use the fixed 1/10 pack sizes, zone locks, 9999 stack limit and all queued refund reservations', () => {
  let p = fixture(807_000);
  p.coins = 10_000;
  p = parseProfile(p);
  const startCoins = p.coins;
  p = act(p, { type: 'atelier-buy', item: 'herb', count: 10 });
  assert.equal(p.coins, startCoins - 30);
  assert.equal(p.leisure.materials.herb, 1010);
  assertRejectedUnchanged(p, { type: 'atelier-buy', item: 'herb', count: 5 } as unknown as GameAction, /采购内容无效/);

  const locked = fixture(807_001);
  assertRejectedUnchanged(locked, { type: 'atelier-buy', item: 'pumpkin', count: 1 }, /对应地区/);
  assertRejectedUnchanged(locked, { type: 'atelier-buy', item: 'snowflower', count: 10 }, /对应地区/);
  const late = clone(locked);
  late.leisure.clears = [1, 1, 1, 1, 1];
  late.leisure.materials.snowflower = 9990;
  let opened = parseProfile(late);
  assertRejectedUnchanged(opened, { type: 'atelier-buy', item: 'snowflower', count: 10 }, /材料空间不足/);
  late.leisure.materials.snowflower = 9989;
  opened = parseProfile(late);
  opened = act(opened, { type: 'atelier-buy', item: 'snowflower', count: 10 });
  assert.equal(opened.leisure.materials.snowflower, 9999);
});

test('materials needed for a future cancellation remain reserved against purchases and item-use outputs', () => {
  let p = fixture(808_000);
  p.leisure.materials.berry = 9999;
  p = parseProfile(p);
  p = act(p, { type: 'atelier-craft', good: 'picnic', count: 1 });
  assert.equal(p.leisure.materials.berry, 9997);
  assertRejectedUnchanged(p, { type: 'atelier-buy', item: 'berry', count: 1 }, /材料空间不足（含待产退款预留）/);

  let dust = allUnlocked(808_001);
  dust.leisure.journal.dust = 9999;
  dust.atelier!.stock.ink = 1;
  dust = parseProfile(dust);
  dust = act(dust, { type: 'atelier-craft', good: 'frost', count: 1 });
  assert.equal(dust.leisure.journal.dust, 9998);
  assertRejectedUnchanged(dust, { type: 'atelier-use', good: 'ink' }, /补给空间不足（含待产退款预留）/);
  assert.equal(dust.atelier!.stock.ink, 1);
});

test('using each usable good applies only its listed output; ingot cannot be consumed and dew shortens the first growing plot', () => {
  const outputs: Partial<Record<Good, Partial<Record<string, number>>>> = {
    picnic: { ration: 3, biscuit: 1 }, stew: { ration: 2, soup: 1 },
    gift: { biscuit: 2, pie: 1 }, ink: { dust: 2 }, nectar: { biscuit: 2 },
    incense: { tea: 1, soup: 1 }, frost: { snowtea: 2 },
  };
  for (const [good, gives] of Object.entries(outputs) as [Good, Partial<Record<string, number>>][]) {
    const p = allUnlocked(809_000 + GOOD_IDS.indexOf(good));
    p.atelier!.stock[good] = 1;
    const ready = parseProfile(p);
    const used = act(ready, { type: 'atelier-use', good });
    assert.equal(used.atelier!.stock[good], 0);
    for (const [resource, count] of Object.entries(gives)) {
      const actual = resource === 'ration' ? used.bag.ration : resource === 'dust' ? used.leisure.journal.dust : used.leisure.materials[resource as keyof Profile['leisure']['materials']];
      const before = resource === 'ration' ? ready.bag.ration : resource === 'dust' ? ready.leisure.journal.dust : ready.leisure.materials[resource as keyof Profile['leisure']['materials']];
      assert.equal(actual, before + count!, `${good} gives only its documented ${resource}`);
    }
  }

  let dew = allUnlocked(809_010);
  dew.atelier!.stock.dew = 1;
  dew.leisure.plots[0] = { crop: 'herb', due: dew.tick + 500 };
  dew.leisure.plots[1] = { crop: 'berry', due: dew.tick + 100 };
  dew = parseProfile(dew);
  dew = act(dew, { type: 'atelier-use', good: 'dew' });
  assert.equal(dew.leisure.plots[0]!.due, dew.tick + 200, 'the first growing plot is accelerated');
  assert.equal(dew.leisure.plots[1]!.due, dew.tick + 100, 'later plots stay unchanged');

  const noPlot = allUnlocked(809_011);
  noPlot.atelier!.stock.dew = 1;
  assertRejectedUnchanged(parseProfile(noPlot), { type: 'atelier-use', good: 'dew' }, /需要一块正在生长的花圃/);
  const ingot = allUnlocked(809_012);
  ingot.atelier!.stock.ingot = 1;
  assertRejectedUnchanged(parseProfile(ingot), { type: 'atelier-use', good: 'ingot' }, /用于设施研修/);
});

test('using a good fails atomically when its outputs exceed bag or reserved capacity', () => {
  const p = allUnlocked(810_000);
  p.atelier!.stock.picnic = 1;
  p.bag.ration = 1_000_000 - 2;
  assertRejectedUnchanged(parseProfile(p), { type: 'atelier-use', good: 'picnic' }, /补给空间不足/);
  let queued = allUnlocked(810_001);
  queued.atelier!.stock.ink = 1;
  queued = act(queued, { type: 'atelier-craft', good: 'frost', count: 1 });
  queued.leisure.journal.dust = 9998;
  const valid = parseProfile(queued);
  assertRejectedUnchanged(valid, { type: 'atelier-use', good: 'ink' }, /补给空间不足/);
});

test('facility upgrades spend exact coins, ore and ingots, unlock levels and reject caps atomically', () => {
  let p = fixture(811_000);
  p.atelier!.stock.ingot = 8;
  p = parseProfile(p);
  const start = clone(p);
  p = act(p, { type: 'atelier-upgrade', facility: 'still' });
  assert.equal(p.coins, start.coins - 60);
  assert.equal(p.leisure.materials.ore, start.leisure.materials.ore - 8);
  assert.equal(p.atelier!.facilities.still, 1);
  assert.equal(p.atelier!.stock.ingot, 8);
  p.atelier!.stock.ingot = 2;
  p = parseProfile(p);
  const before2 = clone(p);
  p = act(p, { type: 'atelier-upgrade', facility: 'still' });
  assert.equal(p.coins, before2.coins - 180);
  assert.equal(p.leisure.materials.ore, before2.leisure.materials.ore - 20);
  assert.equal(p.atelier!.facilities.still, 2);
  assert.equal(p.atelier!.stock.ingot, 0);
  assertRejectedUnchanged(p, { type: 'atelier-upgrade', facility: 'still' }, /研修需要/);

  const capped = allUnlocked(811_001);
  assertRejectedUnchanged(capped, { type: 'atelier-upgrade', facility: 'kitchen' }, /设施已满级/);
});

test('all stations use separate opening switches and the shared product shelf cap; price changes reset only their sale clock', () => {
  let p = fixture(812_000);
  p.atelier!.stock.picnic = 4;
  p.atelier!.stock.ink = 4;
  p.atelier!.shelves.picnic.quote = 'quick';
  p.atelier!.shelves.ink.quote = 'quick';
  p = parseProfile(p);
  p = act(p, { type: 'atelier-stock', good: 'picnic', count: 3 });
  p = act(p, { type: 'atelier-stock', good: 'ink', count: 3 });
  assert.equal(a(p).stock.picnic, 1);
  assert.equal(a(p).stock.ink, 1);
  assert.equal(a(p).shelves.picnic.stock, 3);
  assert.equal(a(p).shelves.ink.stock, 3);
  assert.equal(Object.values(a(p).shelves).reduce((n,s)=>n+s.stock,0), 6);
  p = act(p, { type: 'atelier-open', station: 'supply', open: true });
  assert.equal(a(p).open.supply, true);
  assert.equal(a(p).open.alchemy, false);
  assertRejectedUnchanged(p, { type: 'atelier-open', station: 'supply', open: true }, /已经开业/);
  p = ticks(p, 600);
  assert.equal(a(p).shelves.picnic.stock, 2);
  assert.equal(a(p).shelves.ink.stock, 3, 'closed alchemy goods do not sell');
  assert.equal(a(p).till, 25);
  p = act(p, { type: 'atelier-price', good: 'picnic', quote: 'premium' });
  const priceDue = a(p).shelves.picnic.due;
  assert.equal(priceDue, p.tick + 1500);
  p = ticks(p, 1499);
  assert.equal(a(p).shelves.picnic.stock, 2);
  p = ticks(p, 1);
  assert.equal(a(p).shelves.picnic.stock, 1);
  assert.equal(a(p).till, 69, 'premium quote is 44 gold and previous till remains 25');
  p = act(p, { type: 'atelier-open', station: 'supply', open: false });
  const stopped = clone(p);
  p = ticks(p, 3000);
  assert.equal(a(p).shelves.picnic.stock, stopped.atelier!.shelves.picnic.stock);
  assert.equal(a(p).till, stopped.atelier!.till);
  assert.equal(a(p).stock.picnic, 1, 'sales never auto-restock from the private stock');
});

test('the shared shelf limit rises by 15 per counter level and excludes any unsold private stock', () => {
  let p = fixture(813_000);
  p.atelier!.stock.picnic = 30;
  p = parseProfile(p);
  p = act(p, { type: 'atelier-stock', good: 'picnic', count: 30 });
  assert.equal(atelierShelfLimit(a(p)), 30);
  assert.equal(a(p).stock.picnic, 0);
  p.atelier!.stock.picnic = 1;
  p = parseProfile(p);
  assertRejectedUnchanged(p, { type: 'atelier-stock', good: 'picnic', count: 1 }, /特色货台已满/);

  let large = allUnlocked(813_001);
  large.atelier!.stock.picnic = 75;
  large = parseProfile(large);
  large = act(large, { type: 'atelier-stock', good: 'picnic', count: 75 });
  assert.equal(atelierShelfLimit(a(large)), 75);
  assert.equal(a(large).shelves.picnic.stock, 75);
  assert.equal(a(large).stock.picnic, 0);
  const over = clone(large);
  over.atelier!.shelves.ink.stock = 1;
  over.atelier!.stock.ink = 0;
  assert.throws(() => parseProfile(over), /特色货台容量无效/);
});

test('three commission slots are deterministic, station-specific, region-independent and do not mutate old business counters', () => {
  let p = fixture(814_000);
  const oldCounters = { completed: p.business.completed, reputation: p.business.reputation, orders: clone(p.business.orders) };
  for (const station of ['supply', 'alchemy'] as const) {
    for (let revision = 0; revision < 8; revision++) {
      for (let slot = 0; slot < 3; slot++) {
        p.atelier!.orders[station][slot].revision = revision;
        const one = parseProfile(p);
        const commission = stableAtelierOrder(one, station, slot);
        const repeated = stableAtelierOrder(one, station, slot);
        assert.deepEqual(commission, repeated);
        assert.equal(FORMULAS[commission.good].station, station);
        assert.equal(FORMULAS[commission.good].zone, undefined, 'region-locked formulas stay out of the order pool');
        assert.ok(FORMULAS[commission.good].level <= Math.min(revision, 2));
        assert.ok(commission.count >= 2 && commission.count <= 5);
        assert.equal(commission.coins, Math.ceil(FORMULAS[commission.good].price * commission.count * 1.25));
      }
    }
  }
  p.atelier!.orders.supply[0] = { revision: 0, accepted: false };
  p = parseProfile(p);
  const seed = stableAtelierOrder(p, 'supply', 0);
  p = act(p, { type: 'atelier-accept', station: 'supply', slot: 0, revision: 0 });
  p.leisure.clears = [1, 1, 1, 1, 1];
  p.atelier!.facilities.kitchen = 3;
  p = parseProfile(p);
  assert.deepEqual(stableAtelierOrder(p, 'supply', 0), { ...seed, accepted: true }, 'unlock changes do not rewrite an accepted request');
  const order = stableAtelierOrder(p, 'supply', 0);
  p.atelier!.stock[order.good] = order.count;
  p = parseProfile(p);
  const beforeDeliver = clone(p);
  p = act(p, { type: 'atelier-deliver', station: 'supply', slot: 0, revision: 0 });
  assert.equal(p.coins, beforeDeliver.coins + order.coins);
  assert.equal(p.leisure.journal.dust, beforeDeliver.leisure.journal.dust + 1);
  assert.equal(p.atelier!.stock[order.good], beforeDeliver.atelier!.stock[order.good] - order.count);
  assert.deepEqual(p.business.completed, oldCounters.completed);
  assert.deepEqual(p.business.reputation, oldCounters.reputation);
  assert.deepEqual(p.business.orders, oldCounters.orders);
  assert.equal(p.atelier!.orders.supply[0].revision, 1);
  assert.equal(p.atelier!.orders.supply[0].accepted, false);
});

test('commission abandon is free and stale, unaccepted, understocked and capped deliveries are atomic', () => {
  let p = fixture(815_000);
  const o = stableAtelierOrder(p, 'alchemy', 1);
  p = act(p, { type: 'atelier-accept', station: 'alchemy', slot: 1, revision: 0 });
  p = act(p, { type: 'atelier-abandon', station: 'alchemy', slot: 1, revision: 0 });
  assert.equal(a(p).orders.alchemy[1].revision, 0);
  assert.equal(a(p).orders.alchemy[1].accepted, false);
  assertRejectedUnchanged(p, { type: 'atelier-deliver', station: 'alchemy', slot: 1, revision: 0 }, /先接取/);
  assertRejectedUnchanged(p, { type: 'atelier-accept', station: 'alchemy', slot: 1, revision: 1 }, /委托已变化/);

  p = act(p, { type: 'atelier-accept', station: 'alchemy', slot: 1, revision: 0 });
  assertRejectedUnchanged(p, { type: 'atelier-deliver', station: 'alchemy', slot: 1, revision: 0 }, /背包成品不足/);
  const shortageBefore = clone(p);
  assert.equal(a(shortageBefore).stock[o.good], 0);

  const rich = clone(p);
  rich.atelier!.stock[o.good] = o.count;
  rich.coins = 1_000_000_000 - o.coins + 1;
  const cappedCoins = parseProfile(rich);
  assertRejectedUnchanged(cappedCoins, { type: 'atelier-deliver', station: 'alchemy', slot: 1, revision: 0 }, /奖励空间不足/);

  const dustCap = clone(p);
  dustCap.atelier!.stock[o.good] = o.count;
  dustCap.leisure.journal.dust = 9999;
  const cappedDust = parseProfile(dustCap);
  assertRejectedUnchanged(cappedDust, { type: 'atelier-deliver', station: 'alchemy', slot: 1, revision: 0 }, /奖励空间不足/);
});

test('manual stock, unstock and collection preserve item totals and keep cash separate until collection', () => {
  let p = fixture(816_000);
  p.atelier!.stock.picnic = 5;
  p = parseProfile(p);
  p = act(p, { type: 'atelier-stock', good: 'picnic', count: 3 });
  assert.equal(a(p).stock.picnic + a(p).shelves.picnic.stock, 5);
  p = act(p, { type: 'atelier-unstock', good: 'picnic', count: 1 });
  assert.equal(a(p).stock.picnic, 3);
  assert.equal(a(p).shelves.picnic.stock, 2);
  assertRejectedUnchanged(p, { type: 'atelier-unstock', good: 'picnic', count: 3 }, /货台数量不足/);

  p.atelier!.till = 100;
  p = parseProfile(p);
  const coins = p.coins;
  p = act(p, { type: 'atelier-collect' });
  assert.equal(p.coins, coins + 100);
  assert.equal(a(p).till, 0);
  const full = clone(p);
  full.atelier!.till = 99;
  full.coins = 1_000_000_000;
  const capped = parseProfile(full);
  assertRejectedUnchanged(capped, { type: 'atelier-collect' }, /金币已满/);
});

test('mastery gifts trigger only at 10/50/150 completed units, are sequential and preserve caps', () => {
  let p = fixture(817_000);
  p.atelier!.made.picnic = 9;
  p = parseProfile(p);
  assertRejectedUnchanged(p, { type: 'atelier-mastery', good: 'picnic' }, /累计制作10份/);
  p.atelier!.made.picnic = 10;
  p = parseProfile(p);
  const startCoins = p.coins, startDust = p.leisure.journal.dust;
  p = act(p, { type: 'atelier-mastery', good: 'picnic' });
  assert.equal(p.coins, startCoins + 15);
  assert.equal(p.leisure.journal.dust, startDust + 1);
  assert.equal(a(p).claimed.picnic, 1);
  assertRejectedUnchanged(p, { type: 'atelier-mastery', good: 'picnic' }, /累计制作50份/);
  p.atelier!.made.picnic = 50;
  p = parseProfile(p);
  p = act(p, { type: 'atelier-mastery', good: 'picnic' });
  assert.equal(p.coins, startCoins + 60);
  assert.equal(p.leisure.journal.dust, startDust + 3);
  p.atelier!.made.picnic = 150;
  p = parseProfile(p);
  p = act(p, { type: 'atelier-mastery', good: 'picnic' });
  assert.equal(p.coins, startCoins + 180);
  assert.equal(p.leisure.journal.dust, startDust + 7);
  assert.equal(a(p).claimed.picnic, 3);
  assertRejectedUnchanged(p, { type: 'atelier-mastery', good: 'picnic' }, /三份配方手记已珍藏/);
});

test('8-hour offline cap advances only capped ticks while queued output and open shops continue in the worker clock', () => {
  let p = fixture(818_000);
  p = act(p, { type: 'atelier-craft', good: 'picnic', count: 10 });
  p.atelier!.stock.ink = 1;
  p.atelier!.shelves.ink.stock = 1;
  p.atelier!.shelves.ink.quote = 'quick';
  p.atelier!.open.alchemy = true;
  p.atelier!.shelves.ink.due = p.tick + 600;
  p = parseProfile(p);
  assert.equal(atelierWork(p), true);
  const now = p.wallAt + 9 * 60 * 60 * 1000;
  const advanced = advance(p, now);
  assert.equal(advanced.tick - p.tick, 8 * 60 * 60 * 10, 'only eight hours are simulated in 100ms ticks');
  assert.equal(advanced.wallAt, now, 'time beyond the offline cap is not queued as hidden debt');
  assert.equal(advanced.atelier!.stock.picnic, 10);
  assert.equal(advanced.atelier!.made.picnic, 10);
  assert.equal(advanced.atelier!.shelves.ink.stock, 0, 'an open shelf continues trading during offline catch-up');
  assert.ok(advanced.atelier!.till > 0);
  assert.equal(atelierWork(advanced), false, 'no queue or eligible open stock remains');
  assert.equal(atelierWork(initialProfile(818_001)), false, 'an uninitialized extension has no background work');
});

test('new intents are strict exact-shape actions and optional atelier profiles reject malformed stores and reservations', () => {
  const valid = [
    { type: 'atelier-craft', good: 'picnic', count: 1 },
    { type: 'atelier-cancel', station: 'supply', position: 0, id: 1 },
    { type: 'atelier-buy', item: 'herb', count: 10 },
    { type: 'atelier-use', good: 'ink' },
    { type: 'atelier-mastery', good: 'ink' },
    { type: 'atelier-stock', good: 'picnic', count: 1 },
    { type: 'atelier-unstock', good: 'picnic', count: 1 },
    { type: 'atelier-price', good: 'picnic', quote: 'quick' },
    { type: 'atelier-open', station: 'alchemy', open: true },
    { type: 'atelier-collect' },
    { type: 'atelier-upgrade', facility: 'still' },
    { type: 'atelier-accept', station: 'supply', slot: 0, revision: 0 },
    { type: 'atelier-deliver', station: 'supply', slot: 0, revision: 0 },
    { type: 'atelier-abandon', station: 'supply', slot: 0, revision: 0 },
  ];
  for (const action of valid) assert.deepEqual(parseAction(action), action);
  const invalid = [
    { type: 'atelier-craft', good: 'unknown', count: 1 },
    { type: 'atelier-craft', good: 'picnic', count: 0 },
    { type: 'atelier-craft', good: 'picnic', count: 1.5 },
    { type: 'atelier-craft', good: 'picnic', count: 31 },
    { type: 'atelier-craft', good: 'picnic', count: 1, coins: 0 },
    { type: 'atelier-cancel', station: 'shop', position: 0, id: 1 },
    { type: 'atelier-cancel', station: 'supply', position: -1, id: 1 },
    { type: 'atelier-cancel', station: 'supply', position: 0 },
    { type: 'atelier-buy', item: 'herb', count: 5 },
    { type: 'atelier-buy', item: 'ore', count: 10.5 },
    { type: 'atelier-price', good: 'picnic', quote: 'free' },
    { type: 'atelier-open', station: 'supply', open: 1 },
    { type: 'atelier-collect', extra: true },
    { type: 'atelier-upgrade', facility: 'alchemy' },
    { type: 'atelier-deliver', station: 'supply', slot: 3, revision: 0 },
    { type: 'atelier-made-up', good: 'picnic' },
  ];
  for (const action of invalid) assert.throws(() => parseAction(action), /工坊|字段|数值|商品|采购|售价|开业|设施|委托|工作站|未知/);

  const base = fixture(819_000);
  const badVersion = clone(base);
  badVersion.atelier!.version = 2 as 1;
  assert.throws(() => parseProfile(badVersion), /工坊版本/);
  const wrongStation = clone(base);
  wrongStation.sequence = 1;
  wrongStation.atelier!.queues.alchemy = [{ id: 1, good: 'picnic', remaining: 1, due: wrongStation.tick + 10 }];
  assert.throws(() => parseProfile(wrongStation), /工作站不匹配/);
  const futureId = clone(base);
  futureId.atelier!.queues.supply = [{ id: futureId.sequence + 1, good: 'picnic', remaining: 1, due: futureId.tick + 10 }];
  assert.throws(() => parseProfile(futureId), /工坊数值无效/);
  const duplicateIds = clone(base);
  duplicateIds.sequence = 2;
  duplicateIds.atelier!.queues.supply = [{ id: 1, good: 'picnic', remaining: 1, due: duplicateIds.tick + 10 }];
  duplicateIds.atelier!.queues.alchemy = [{ id: 1, good: 'dew', remaining: 1, due: duplicateIds.tick + 10 }];
  assert.throws(() => parseProfile(duplicateIds), /批次身份重复/);
  const lockedBatch = clone(base);
  lockedBatch.sequence = 1;
  lockedBatch.atelier!.queues.supply = [{ id: 1, good: 'stew', remaining: 1, due: lockedBatch.tick + 10 }];
  assert.throws(() => parseProfile(lockedBatch), /未解锁配方不能排产/);
  const nonkeeperAtelier = clone(base);
  nonkeeperAtelier.job = 'visitor';
  assert.throws(() => parseProfile(nonkeeperAtelier), /工坊档案需要正式任职/);
  const overflow = clone(base);
  overflow.atelier!.stock.picnic = 9999;
  overflow.atelier!.shelves.picnic.stock = 1;
  assert.throws(() => parseProfile(overflow), /工坊成品预留超限/);
  const shelfOverflow = clone(base);
  shelfOverflow.atelier!.shelves.picnic.stock = 31;
  assert.throws(() => parseProfile(shelfOverflow), /特色货台容量无效/);
  const invalidClaim = clone(base);
  invalidClaim.atelier!.claimed.ink = 1;
  assert.throws(() => parseProfile(invalidClaim), /配方手记进度无效/);
  const extra = clone(base) as Profile & { atelierDebug?: boolean };
  extra.atelierDebug = true;
  assert.throws(() => parseProfile(extra), /字段不匹配/);
});

test('successful atelier transactions are idempotent and failed transactions preserve sequence, receipt and all ledgers', () => {
  let p = fixture(820_000);
  p.coins = 0;
  p = parseProfile(p);
  assertRejectedUnchanged(p, { type: 'atelier-buy', item: 'herb', count: 10 }, /金币不足/);
  const sourceSeed = initialProfile(820_001);
  sourceSeed.job = 'keeper';
  sourceSeed.coins = 100;
  sourceSeed.leisure.materials.berry = 1000;
  const source = parseProfile(sourceSeed);
  const envelope = { sequence: 1, requestId: 'atelier080-replay0001', action: { type: 'atelier-buy', item: 'herb', count: 10 } };
  const first = transact(source, envelope);
  assert.equal(first.sequence, 1);
  assert.equal(first.receipt?.fingerprint, JSON.stringify({ type: 'atelier-buy', item: 'herb', count: 10 }));
  const replay = transact(first, envelope);
  assert.deepEqual(replay, first, 'same request identity and fingerprint cannot double-buy');
  assert.equal(source.sequence, 0);
  assert.equal(source.atelier, undefined);
  const collision = { ...envelope, action: { type: 'atelier-buy', item: 'berry', count: 10 } };
  assert.throws(() => transact(first, collision), /操作已过期/);
  assert.equal(first.leisure.materials.berry, 1000);
});
