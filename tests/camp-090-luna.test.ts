import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advance, initialProfile, parseProfile, transact,
  type GameAction, type Profile,
} from '../packages/solo-core';
import {
  BUDDY_QUESTS, CAMP_LEVELS, COOK_TICKS, campLevel, campOf, campWork,
  foodTicks, jobPower,
} from '../packages/solo-core/camp-life';
import {CROPS, FOODS, type Food} from '../packages/solo-core/leisure';
import {initialBonds, bondsOf, type Buddy} from '../packages/solo-core/bonds';
import {initialAtelier, type Atelier} from '../packages/solo-core/atelier';
import {initialExpedition} from '../packages/solo-core/expedition';
import {initialCamp} from '../packages/solo-core/camp-life';
import {recipes} from '../packages/solo-core/catalog';

let serial = 0;
function act(p: Profile, action: GameAction): Profile {
  return transact(p, {
    sequence: p.sequence + 1,
    requestId: 'camp090-' + String(++serial).padStart(8, '0'),
    action,
  });
}
function ticks(p: Profile, count: number): Profile {
  return advance(p, p.wallAt + count * 100);
}
function clone<T>(value: T): T { return structuredClone(value); }
function assertRejectedUnchanged(p: Profile, action: GameAction, reason?: RegExp): void {
  const before = clone(p);
  if (reason) assert.throws(() => act(p, action), reason);
  else assert.throws(() => act(p, action));
  assert.deepEqual(p, before, 'a rejected intent must leave its source profile unchanged');
}
function fixture(now = 900_001, xp = 0): Profile {
  const p = initialProfile(now);
  p.job = 'keeper';
  p.coins = 100_000;
  p.xp = xp;
  p.bag.flour = 10_000;
  p.bag.gel = 100;
  p.leisure.materials = {
    herb: 1_000, berry: 1_000, mushroom: 1_000, ore: 1_000,
    tea: 0, biscuit: 0, soup: 0, pumpkin: 1_000,
    snowflower: 1_000, pie: 0, snowtea: 0,
  };
  p.leisure.journal.dust = 1_000;
  p.leisure.clears = [1, 1, 1, 1, 1];
  p.leisure.companions = {
    slime: 0, guide: 0, guard: 0, fox: 0, deer: 0,
    otter: 0, owl: 0, bear: 0, bird: 0,
  };
  p.leisure.bonds = initialBonds();
  p.atelier = initialAtelier();
  p.camp = initialCamp();
  return parseProfile(p);
}
function atelier(p: Profile): Atelier {
  assert.ok(p.atelier);
  return p.atelier;
}
function prepareQuest(p: Profile, id: Buddy): void {
  const l = p.leisure;
  const progress = bondsOf(l).progress[id];
  switch (id) {
    case 'slime': progress.voyages = 2; l.cooked = 10; break;
    case 'guide': progress.voyages = 8; l.clears = [1, 0, 0, 0, 0]; break;
    case 'guard': progress.voyages = 8; l.journal.buildings.lodge = 1; break;
    case 'fox': progress.voyages = 3; atelier(p).orders.supply[0].revision = 4; break;
    case 'deer': progress.voyages = 3; l.harvests = 14; break;
    case 'otter': progress.voyages = 8; l.gardenLevel = 1; break;
    case 'owl': progress.voyages = 7; atelier(p).made.ink = 20; break;
    case 'bear': progress.voyages = 2; l.cooked = 50; break;
    case 'bird': progress.voyages = 8; bondsOf(l).secretClears[4] = 2; break;
  }
}
function finishQuestGate(p: Profile, id: Buddy): void {
  const l = p.leisure;
  const progress = bondsOf(l).progress[id];
  switch (id) {
    case 'slime': progress.voyages = 3; break;
    case 'guide': l.clears = [1, 1, 0, 0, 0]; break;
    case 'guard': l.journal.buildings.lodge = 2; break;
    case 'fox': atelier(p).orders.supply[0].revision = 5; break;
    case 'deer': l.harvests = 15; break;
    case 'otter': l.gardenLevel = 2; break;
    case 'owl': progress.voyages = 8; atelier(p).made.ink = 20; break;
    case 'bear': progress.voyages = 3; l.cooked = 50; break;
    case 'bird': bondsOf(l).secretClears[4] = 3; break;
  }
}

test('legacy v7 reads and unrelated time advancement do not materialize camp; cooking preserves old queues and order state', () => {
  const raw = initialProfile(900_010);
  raw.job = 'keeper';
  raw.bag.flour = 100;
  raw.bag.gel = 20;
  raw.leisure.materials.herb = 20;
  const before = JSON.stringify(raw);
  const parsed = parseProfile(raw);
  assert.equal(Object.hasOwn(parsed, 'camp'), false);
  assert.equal(JSON.stringify(parsed), before);
  assert.equal(Object.hasOwn(campOf(parsed), 'version'), true, 'read helper supplies a detached v1 default');
  assert.equal(Object.hasOwn(parsed, 'camp'), false, 'reading default remains lazy');
  assert.equal(Object.hasOwn(advance(parsed, parsed.wallAt + 500), 'camp'), false, 'no idle camp extension is written by time advancement');

  let p = fixture(900_011);
  delete p.camp;
  p.atelier = initialAtelier();
  p.atelier.orders.supply[0].accepted = true;
  p = parseProfile(p);
  p = act(p, {type: 'craft', recipe: 'ration', count: 1});
  p = act(p, {type: 'queue-craft', recipe: 'crystal', count: 2});
  p = act(p, {type: 'order-accept', slot: 0, revision: p.business.orders[0].revision});
  delete p.camp;
  p = parseProfile(p);
  const legacyQueue = clone(p.queue);
  const legacyPending = clone(p.business.pending);
  const legacyOrders = clone(p.business.orders);
  const atelierOrders = clone(atelier(p).orders);
  p = act(p, {type: 'camp-cook', food: 'tea', count: 1});
  assert.deepEqual(p.queue, legacyQueue);
  assert.deepEqual(p.business.pending, legacyPending);
  assert.deepEqual(p.business.orders, legacyOrders);
  assert.deepEqual(atelier(p).orders, atelierOrders);
  assert.equal(campOf(p).cooking.length, 1);
});

test('five camp recipes prepay materials and produce only at their per-serving timer', () => {
  for (const food of Object.keys(FOODS) as Food[]) {
    let p = fixture(900_100 + Object.keys(FOODS).indexOf(food));
    const costs = {...FOODS[food].materials, ...(FOODS[food].flour ? {flour: FOODS[food].flour} : {}), ...(FOODS[food].gel ? {gel: FOODS[food].gel} : {})};
    const inputBefore = new Map<string, number>();
    for (const r of Object.keys(costs)) inputBefore.set(r, r === 'flour' || r === 'gel' ? p.bag[r] : p.leisure.materials[r as keyof typeof p.leisure.materials]);
    p = act(p, {type: 'camp-cook', food, count: 1});
    const due = p.tick + COOK_TICKS[food];
    assert.equal(campOf(p).cooking[0].due, due, `${food} base timer`);
    assert.equal(campOf(p).cooking[0].remaining, 1);
    for (const [r, n] of Object.entries(costs)) {
      const after = r === 'flour' || r === 'gel' ? p.bag[r] : p.leisure.materials[r as keyof typeof p.leisure.materials];
      assert.equal(after, inputBefore.get(r)! - n!, `${food} prepays ${r}`);
    }
    assert.equal(p.leisure.materials[food], 0, `${food} is not granted at enqueue`);
    assertRejectedUnchanged(p, {type: 'camp-sell', food, all: true});
    p = ticks(p, COOK_TICKS[food] - 1);
    assert.equal(p.leisure.materials[food], 0, `${food} is not granted before its timer`);
    assert.equal(campOf(p).cooking[0].remaining, 1);
    p = ticks(p, 1);
    assert.equal(p.leisure.materials[food], 1, `${food} is granted at its timer`);
    assert.equal(p.leisure.cooked, 1);
    assert.equal(campOf(p).cooking.length, 0);
  }
});

test('kitchen has a global three-batch limit, 1/5 portions only, and cancel ids reject stale replacements', () => {
  let p = fixture(900_200);
  p = act(p, {type: 'camp-cook', food: 'tea', count: 1});
  p = act(p, {type: 'camp-cook', food: 'biscuit', count: 1});
  p = act(p, {type: 'camp-cook', food: 'soup', count: 1});
  assertRejectedUnchanged(p, {type: 'camp-cook', food: 'pie', count: 1});
  const staleId = campOf(p).cooking[0].id;
  const nextId = campOf(p).cooking[1].id;
  p = act(p, {type: 'camp-cancel-food', id: staleId, position: 0});
  assert.equal(campOf(p).cooking[0].id, nextId);
  assert.equal(campOf(p).cooking[0].due, p.tick + foodTicks(p, 'biscuit'), 'new head receives a fresh due time');
  assertRejectedUnchanged(p, {type: 'camp-cancel-food', id: staleId, position: 0});
  assert.throws(() => transact(p, {sequence: p.sequence + 1, requestId: 'camp090-bad-count', action: {type: 'camp-cook', food: 'pie', count: 3} as unknown as GameAction}));
});

test('a timed five-piece batch advances one portion at a time and recalculates the next portion after a job change', () => {
  let p = fixture(900_300, 350);
  p = act(p, {type: 'camp-cook', food: 'biscuit', count: 5});
  const initialDue = campOf(p).cooking[0].due;
  assert.equal(p.bag.flour, 9_995);
  assert.equal(p.leisure.materials.berry, 990);
  p = act(p, {type: 'camp-job', job: 'workshop', companion: 'owl'});
  assert.equal(campOf(p).cooking[0].due, initialDue, 'current portion keeps its start-time due snapshot');
  p = ticks(p, COOK_TICKS.biscuit - 1);
  assert.equal(p.leisure.materials.biscuit, 0);
  p = ticks(p, 1);
  assert.equal(p.leisure.materials.biscuit, 1);
  assert.equal(campOf(p).cooking[0].remaining, 4);
  const nextTicks = Math.ceil(COOK_TICKS.biscuit * 0.95);
  assert.equal(campOf(p).cooking[0].due, p.tick + nextTicks, 'next single portion uses the new 5% job bonus rounded up to a tick');
  p = ticks(p, nextTicks - 1);
  assert.equal(p.leisure.materials.biscuit, 1);
  p = ticks(p, 1);
  assert.equal(p.leisure.materials.biscuit, 2);
  assert.equal(foodTicks(p, 'biscuit'), nextTicks);
});

test('full kitchen inventory stalls a due portion without losing it and resumes one tick after space opens', () => {
  let p = fixture(900_400);
  p.leisure.materials.tea = 9_994;
  atelier(p).stock.incense = 5;
  p = parseProfile(p);
  p = act(p, {type: 'camp-cook', food: 'tea', count: 5});
  for (let i = 0; i < 5; i++) p = act(p, {type: 'atelier-use', good: 'incense'});
  assert.equal(p.leisure.materials.tea, 9_999);
  p = ticks(p, COOK_TICKS.tea);
  assert.equal(p.leisure.materials.tea, 9_999);
  assert.equal(campOf(p).cooking[0].remaining, 5);
  assert.equal(campWork(p), false, 'a blocked full-inventory batch does not keep an idle worker awake');
  p = act(p, {type: 'camp-sell', food: 'tea', all: true});
  assert.equal(campOf(p).cooking[0].remaining, 5);
  p = ticks(p, 1);
  assert.equal(p.leisure.materials.tea, 1);
  assert.equal(campOf(p).cooking[0].remaining, 4, 'only one portion is released after the first tick with space');
  assert.equal(campOf(p).cooking[0].due, p.tick + COOK_TICKS.tea);
  p = ticks(p, COOK_TICKS.tea - 1);
  assert.equal(p.leisure.materials.tea, 1);
  p = ticks(p, 1);
  assert.equal(p.leisure.materials.tea, 2, 'the next portion waits for its own timer');
});

test('cancel returns only unpaid servings, refuses atomically when return space is full, and succeeds after space opens', () => {
  let p = fixture(900_500);
  p.bag.flour = 1_000_000 - 5;
  p = parseProfile(p);
  p = act(p, {type: 'camp-cook', food: 'biscuit', count: 5});
  const id = campOf(p).cooking[0].id;
  assert.equal(p.bag.flour, 999_990);
  p = act(p, {type: 'camp-supplies', trade: 'flour'});
  assert.equal(p.bag.flour, 1_000_000);
  assertRejectedUnchanged(p, {type: 'camp-cancel-food', id, position: 0}, /退款材料空间不足/);
  p = act(p, {type: 'trade', item: 'flour', side: 'sell', count: 5});
  p = act(p, {type: 'camp-cancel-food', id, position: 0});
  assert.equal(p.bag.flour, 1_000_000, 'refund is exactly the five prepaid flour units');
  assert.equal(p.leisure.materials.berry, 1_000);
  assert.equal(campOf(p).cooking.length, 0);
});

test('camp levels use legacy XP thresholds and seven gifts are ordered, one-time, and all-or-nothing at caps', () => {
  assert.deepEqual(CAMP_LEVELS.map(x => x.xp), [0, 100, 350, 900, 2_000, 4_500, 9_000]);
  assert.deepEqual(CAMP_LEVELS.map(x => x.name), ['篝火初亮', '旅人小站', '林间集市', '工坊聚落', '秘境驿站', '星辉营地', '群岛之家']);
  for (let i = 0; i < CAMP_LEVELS.length; i++) {
    const threshold = CAMP_LEVELS[i].xp;
    assert.equal(campLevel(fixture(900_600 + i, threshold)), i + 1);
    if (i > 0) assert.equal(campLevel(fixture(900_700 + i, threshold - 1)), i);
  }
  let p = fixture(900_800, 9_000);
  delete p.camp;
  assert.equal(campLevel(parseProfile(p)), 7, 'existing XP immediately grants the derived level without writing defaults');
  p = parseProfile(p);
  p.coins = 1_000_000_000 - 19;
  assertRejectedUnchanged(p, {type: 'camp-level-claim'}, /奖励空间不足/);
  p.coins = 100;
  p.leisure.materials.ore = 9_999 - 1;
  assertRejectedUnchanged(p, {type: 'camp-level-claim'}, /奖励空间不足/);
  p.leisure.materials.ore = 0;
  p = parseProfile(p);
  const expected = [[20, 2], [50, 5], [100, 10], [180, 15], [300, 20], [450, 30], [700, 50]];
  for (const [coins, ore] of expected) {
    const beforeCoins = p.coins;
    const beforeOre = p.leisure.materials.ore;
    p = act(p, {type: 'camp-level-claim'});
    assert.equal(p.coins, beforeCoins + coins!);
    assert.equal(p.leisure.materials.ore, beforeOre + ore!);
  }
  assert.equal(campOf(p).claimed, 7);
  assertRejectedUnchanged(p, {type: 'camp-level-claim'}, /所有营地赠礼已领取/);
});

test('job gates and roster collisions reject leader, support, expedition crew, and duplicate assignments', () => {
  let p = fixture(900_900, 899);
  assertRejectedUnchanged(p, {type: 'camp-job', job: 'garden', companion: 'fox'}, /Lv4/);
  p.xp = 900;
  p = parseProfile(p);
  p = act(p, {type: 'camp-job', job: 'counter', companion: 'fox'});
  assertRejectedUnchanged(p, {type: 'camp-job', job: 'workshop', companion: 'fox'}, /其他岗位/);
  p = act(p, {type: 'camp-job', job: 'counter', companion: null});
  p.leisure.bonds = bondsOf(p.leisure);
  p.leisure.bonds.support = 'guide';
  p = parseProfile(p);
  assertRejectedUnchanged(p, {type: 'camp-job', job: 'counter', companion: 'guide'}, /领队、支援或远征伙伴/);
  assertRejectedUnchanged(p, {type: 'camp-job', job: 'counter', companion: 'slime'}, /领队、支援或远征伙伴/);

  bondsOf(p.leisure).support = null;
  p.bag.ration = 3;
  p.bag.gel = 0;
  p.expedition = initialExpedition();
  p = parseProfile(p);
  p = act(p, {type: 'expedition-depart', region: 0, budget: 3, auto: false, mode: 'survey', crew: 'bear', meal: 'none'});
  assertRejectedUnchanged(p, {type: 'camp-job', job: 'counter', companion: 'bear'}, /领队、支援或远征伙伴/);
});

test('all nine memorial gates require their documented prerequisites and grants cannot be repeated', () => {
  const ids = Object.keys(BUDDY_QUESTS) as Buddy[];
  assert.deepEqual(ids, ['slime', 'guide', 'guard', 'fox', 'deer', 'otter', 'owl', 'bear', 'bird']);
  for (const [i, id] of ids.entries()) {
    let p = fixture(901_000 + i, 2_000);
    prepareQuest(p, id);
    p = parseProfile(p);
    assert.equal(BUDDY_QUESTS[id].ready(p), false, `${id} fixture leaves at least one documented requirement unmet`);
    const quest: GameAction = {type: 'camp-buddy-quest', companion: id};
    assertRejectedUnchanged(p, quest);
    finishQuestGate(p, id);
    p = parseProfile(p);
    const coins = p.coins, ore = p.leisure.materials.ore;
    p = act(p, quest);
    assert.ok(campOf(p).quests.includes(id));
    assert.equal(p.coins, coins + 100);
    assert.equal(p.leisure.materials.ore, ore + 10);
    assertRejectedUnchanged(p, quest, /已珍藏/);
  }
});

test('camp parser rejects a forged memorial without its documented prerequisite', () => {
  const p = fixture(901_050, 2_000);
  p.camp!.quests = ['fox'];
  const before = clone(p);
  assert.throws(() => parseProfile(p));
  assert.deepEqual(p, before, 'failed profile validation does not mutate the source');
});

test('camp parser rejects saved presets before each slot unlocks', () => {
  const cases = [
    {xp: 0, slot: 0},
    {xp: 350, slot: 1},
    {xp: 350, slot: 2},
  ];
  for (const [i, c] of cases.entries()) {
    const p = fixture(901_060 + i, c.xp);
    p.camp!.presets[c.slot] = {leader: 'slime', support: null, relics: []};
    assert.throws(() => parseProfile(p), `locked slot ${c.slot} at XP ${c.xp}`);
  }
});

test('level-five memorial specialties replace, rather than stack on, the ordinary job effect', () => {
  const p = fixture(901_100, 2_000);
  const quests: Buddy[] = ['slime', 'guard', 'bird', 'fox', 'guide', 'owl', 'bear', 'deer', 'otter'];
  for (const job of ['counter', 'workshop', 'garden'] as const) {
    for (const id of quests) {
      const probe = clone(p);
      probe.leisure.active = id === 'slime' ? 'guide' : 'slime';
      bondsOf(probe.leisure).support = null;
      prepareQuest(probe, id);
      finishQuestGate(probe, id);
      probe.camp!.jobs[job] = id;
      probe.camp!.quests = [id];
      const expected = job === 'counter' ? ['slime', 'guard', 'bird', 'fox', 'guide'].includes(id)
        : job === 'workshop' ? ['slime', 'guard', 'bird', 'owl', 'bear'].includes(id)
        : ['slime', 'guard', 'bird', 'deer', 'otter'].includes(id);
      assert.equal(jobPower(parseProfile(probe), job), expected ? 2 : 1, `${id} at ${job}`);
    }
  }
  let noQuest = fixture(901_101, 2_000);
  noQuest.camp!.jobs.counter = 'fox';
  noQuest = parseProfile(noQuest);
  assert.equal(jobPower(noQuest, 'counter'), 1, 'ordinary assigned companion contributes +1');
  let quested = fixture(901_102, 2_000);
  prepareQuest(quested, 'fox');
  finishQuestGate(quested, 'fox');
  quested.camp!.jobs.counter = 'fox';
  quested.camp!.quests = ['fox'];
  quested.business.managed = true;
  quested.business.shelves.ration.stock = 1;
  quested.business.shelves.ration.due = quested.tick + 1;
  quested.retail = true;
  quested.atelier!.open.alchemy = true;
  quested.atelier!.shelves.dew.stock = 1;
  quested.atelier!.shelves.dew.due = quested.tick + 1;
  quested = parseProfile(quested);
  quested = ticks(quested, 1);
  assert.equal(quested.business.till, recipes.ration.price + 2, 'legacy shelf sale uses exactly +2, not +3');
  assert.equal(atelier(quested).till, 18 + 2, 'new specialty shelf sale uses the same +2 exactly once');
});

test('action and profile parsers reject array-shaped pseudo-scalars', () => {
  const p = fixture(901_180, 350);
  const before = clone(p);
  const malformed = [
    {type: ['camp-prepare'], station: 'basic', mode: 'repeat'},
    {type: 'camp-prepare', station: ['basic'], mode: 'repeat'},
    {type: 'camp-prepare', station: 'basic', mode: ['repeat']},
    {type: 'camp-stock-plan', station: ['supply'], good: 'picnic', count: 5, reserve: 0},
  ];
  for (const [i, action] of malformed.entries()) {
    assert.throws(() => transact(p, {
      sequence: p.sequence + 1,
      requestId: `camp090-malformed-${String(i).padStart(4, '0')}`,
      action,
    }));
    assert.deepEqual(p, before, 'rejected action never advances or mutates the source profile');
  }
  const invalidJourney = fixture(901_182, 350);
  (invalidJourney.camp!.lastJourney as unknown as Record<string, unknown>) = {
    zone: 0, route: ['balanced'], trips: 1, depth: 0, secret: false,
  };
  assert.throws(() => parseProfile(invalidJourney));
});

test('workshop/garden effects use ceil-per-portion and per-plot harvest amounts', () => {
  let p = fixture(901_200, 2_000);
  prepareQuest(p, 'owl');
  finishQuestGate(p, 'owl');
  prepareQuest(p, 'deer');
  finishQuestGate(p, 'deer');
  p.camp!.jobs.workshop = 'owl';
  p.camp!.quests = ['owl'];
  p.camp!.jobs.garden = 'deer';
  p.camp!.quests.push('deer');
  p.leisure.plots[0] = {crop: 'herb', due: p.tick + 1};
  p = parseProfile(p);
  assert.equal(foodTicks(p, 'tea'), Math.ceil(COOK_TICKS.tea * 0.9));
  assert.equal(jobPower(p, 'workshop'), 2);
  const harvestsBefore = p.leisure.harvests;
  p = ticks(p, 1);
  const before = p.leisure.materials.herb;
  p = act(p, {type: 'garden-harvest', plot: 0});
  assert.equal(p.leisure.materials.herb, before + CROPS.herb.yield + 2, 'specialty yields +2 over the normal three-herb plot yield');
  assert.equal(p.leisure.harvests, harvestsBefore + 1);

  let ordinary = fixture(901_201, 900);
  ordinary.camp!.jobs.garden = 'deer';
  ordinary.leisure.plots[0] = {crop: 'herb', due: ordinary.tick + 1};
  ordinary = parseProfile(ordinary);
  ordinary = ticks(ordinary, 1);
  const ordinaryBefore = ordinary.leisure.materials.herb;
  ordinary = act(ordinary, {type: 'garden-harvest', plot: 0});
  assert.equal(ordinary.leisure.materials.herb, ordinaryBefore + CROPS.herb.yield + 1, 'ordinary garden staff adds one per plot');
});

test('ordinary counter job adds exactly one coin per legacy and new shelf sale', () => {
  let p = fixture(901_250, 900);
  p.camp!.jobs.counter = 'fox';
  p.business.managed = true;
  p.business.shelves.ration.stock = 1;
  p.business.shelves.ration.due = p.tick + 1;
  p.retail = true;
  atelier(p).open.alchemy = true;
  atelier(p).shelves.dew.stock = 1;
  atelier(p).shelves.dew.due = p.tick + 1;
  p = parseProfile(p);
  p = ticks(p, 1);
  assert.equal(p.business.till, recipes.ration.price + 1);
  assert.equal(atelier(p).till, 18 + 1);
});

test('central collection merges exactly the two actual cashboxes and rejects overflow without partial clearing', () => {
  let p = fixture(901_300);
  p.business.managed = true;
  p.business.till = 30;
  atelier(p).till = 20;
  p.coins = 1_000_000_000 - 49;
  p = parseProfile(p);
  assertRejectedUnchanged(p, {type: 'camp-collect'}, /金币空间不足/);
  p.coins--;
  p = parseProfile(p);
  p = act(p, {type: 'camp-collect'});
  assert.equal(p.coins, 1_000_000_000);
  assert.equal(p.business.till, 0);
  assert.equal(atelier(p).till, 0);
  assertRejectedUnchanged(p, {type: 'camp-collect'}, /暂无待收货款/);
});

test('repeat/available dispatches only the four stations’ existing batches and materials without purchasing', () => {
  const makeLast = () => {
    const p = fixture(901_400);
    p.camp!.last = {
      basic: {id: 'ration', count: 3},
      supply: {id: 'picnic', count: 5},
      alchemy: {id: 'ink', count: 5},
      kitchen: {id: 'tea', count: 5},
    };
    return parseProfile(p);
  };
  const cases: Array<{station: 'basic'|'supply'|'alchemy'|'kitchen'; set: (p: Profile) => void; expectedCount: number; expectedAction: (p: Profile) => unknown}> = [
    {station: 'basic', set: p => {p.bag.flour = 5; p.bag.gel = 0;}, expectedCount: 2, expectedAction: p => p.business.pending[0] ?? p.queue},
    {station: 'supply', set: p => {p.bag.flour = 4; p.bag.gel = 1; p.leisure.materials.berry = 2;}, expectedCount: 1, expectedAction: p => atelier(p).queues.supply[0]},
    {station: 'alchemy', set: p => {p.leisure.materials.berry = 6; p.leisure.materials.ore = 6;}, expectedCount: 3, expectedAction: p => atelier(p).queues.alchemy[0]},
    {station: 'kitchen', set: p => {p.leisure.materials.herb = 2;}, expectedCount: 1, expectedAction: p => campOf(p).cooking[0]},
  ];
  for (const c of cases) {
    let p = makeLast();
    c.set(p);
    p = parseProfile(p);
    const coins = p.coins;
    p = act(p, {type: 'camp-prepare', station: c.station, mode: 'available'});
    const queue = c.expectedAction(p) as {remaining?: number; count?: number};
    assert.equal(queue.remaining ?? queue.count, c.expectedCount, `${c.station} available quantity`);
    assert.equal(p.coins, coins, 'quick arrangement never purchases materials');
  }
  let poor = makeLast();
  poor.leisure.materials.herb = 1;
  poor = parseProfile(poor);
  assertRejectedUnchanged(poor, {type: 'camp-prepare', station: 'kitchen', mode: 'repeat'}, /材料不足/);
  assert.equal(poor.camp!.last.kitchen!.count, 5, 'failed repeat preserves its remembered recipe and amount');
});

test('three presets obey level and return-to-camp gates, preserve loadouts, and never start infinite travel', () => {
  let p = fixture(901_500, 100);
  p.leisure.bonds!.support = 'guide';
  p.leisure.bonds!.relics[0] = 1;
  p.leisure.bonds!.loadout = [0];
  p = parseProfile(p);
  p = act(p, {type: 'camp-preset', slot: 0, operation: 'save'});
  p.leisure.active = 'guard';
  p.leisure.bonds!.support = 'fox';
  p.leisure.bonds!.loadout = [];
  p = parseProfile(p);
  p = act(p, {type: 'camp-preset', slot: 0, operation: 'load'});
  assert.equal(p.leisure.active, 'slime');
  assert.equal(bondsOf(p.leisure).support, 'guide');
  assert.deepEqual(bondsOf(p.leisure).loadout, [0]);
  assertRejectedUnchanged(p, {type: 'camp-preset', slot: 1, operation: 'save'}, /Lv4/);
  p.xp = 900;
  p = parseProfile(p);
  p = act(p, {type: 'camp-preset', slot: 1, operation: 'save'});
  assert.ok(campOf(p).presets[1]);

  p.leisure.active = 'slime';
  p.leisure.bonds!.support = 'guide';
  p.camp!.presets[0] = {leader: 'owl', support: null, relics: []};
  p.camp!.jobs.counter = 'owl';
  p = parseProfile(p);
  assertRejectedUnchanged(p, {type: 'camp-preset', slot: 0, operation: 'load'}, /正在工作/);

  p.camp!.jobs.counter = null;
  p.camp!.lastJourney = {zone: 0, route: 'gather', trips: 3, depth: 0, secret: false};
  p = parseProfile(p);
  p = act(p, {type: 'camp-redepart'});
  assert.equal(p.leisure.run?.total, 3);
  assert.equal(p.leisure.run?.zone, 0);
  assertRejectedUnchanged(p, {type: 'camp-preset', slot: 0, operation: 'save'}, /回营/);

  let cargo = fixture(901_501, 900);
  cargo.camp!.lastJourney = {zone: 0, route: 'balanced', trips: 1, depth: 0, secret: false};
  cargo.leisure.cargo.coins = 1;
  cargo = parseProfile(cargo);
  assertRejectedUnchanged(cargo, {type: 'camp-redepart'}, /领取/);
});

test('finite stock plans are level-gated, preserve reserves, share shelf capacity, and never buy/open/produce', () => {
  let locked = fixture(901_600, 349);
  assertRejectedUnchanged(locked, {type: 'camp-stock-plan', station: 'supply', good: 'picnic', count: 5, reserve: 0}, /Lv3/);

  let p = fixture(901_601, 350);
  atelier(p).stock.picnic = 7;
  p = parseProfile(p);
  const coins = p.coins, flour = p.bag.flour, queueBefore = clone(atelier(p).queues);
  p = act(p, {type: 'camp-stock-plan', station: 'supply', good: 'picnic', count: 5, reserve: 5});
  assert.equal(campWork(p), true);
  p = ticks(p, 1);
  assert.equal(atelier(p).stock.picnic, 5);
  assert.equal(atelier(p).shelves.picnic.stock, 2);
  assert.equal(campOf(p).stockPlans.supply?.remaining, 3);
  assert.equal(atelier(p).open.supply, false);
  assert.deepEqual(atelier(p).queues, queueBefore, 'a plan only moves finished goods');
  assert.equal(p.coins, coins);
  assert.equal(p.bag.flour, flour);
  assert.equal(campWork(p), false, 'at the reserve threshold there is no movable work');
  p = act(p, {type: 'atelier-craft', good: 'picnic', count: 1});
  p = ticks(p, 300);
  assert.equal(atelier(p).stock.picnic, 5);
  assert.equal(atelier(p).shelves.picnic.stock, 3);
  assert.equal(campOf(p).stockPlans.supply?.remaining, 2);
  p = act(p, {type: 'camp-stock-stop', station: 'supply'});
  assert.equal(campOf(p).stockPlans.supply, null);
  assert.equal(atelier(p).shelves.picnic.stock, 3, 'stopping a plan leaves already shelved stock in place');
  assert.equal(atelier(p).open.supply, false);

  let full = fixture(901_602, 350);
  atelier(full).shelves.picnic.stock = 30;
  atelier(full).stock.ink = 5;
  full = parseProfile(full);
  full = act(full, {type: 'camp-stock-plan', station: 'alchemy', good: 'ink', count: 5, reserve: 0});
  assert.equal(campWork(full), false, 'shared shelf capacity blocks auto-stocking work');
  full = ticks(full, 1_000);
  assert.equal(atelier(full).stock.ink, 5);
  assert.equal(campOf(full).stockPlans.alchemy?.remaining, 5);
  full = act(full, {type: 'atelier-unstock', good: 'picnic', count: 1});
  assert.equal(campWork(full), true);
  full = ticks(full, 1);
  assert.equal(atelier(full).shelves.ink.stock, 1);
  assert.equal(atelier(full).stock.ink, 4);
  assert.equal(atelier(full).shelves.picnic.stock, 29);

  let completed = fixture(901_603, 350);
  atelier(completed).stock.picnic = 5;
  completed = parseProfile(completed);
  completed = act(completed, {type: 'camp-stock-plan', station: 'supply', good: 'picnic', count: 5, reserve: 0});
  completed = ticks(completed, 1);
  assert.equal(atelier(completed).shelves.picnic.stock, 5);
  assert.equal(atelier(completed).stock.picnic, 0);
  assert.equal(campOf(completed).stockPlans.supply, null, 'plan ends after moving its selected quantity');
  assert.equal(campWork(completed), false, 'finished plan leaves no background worker awake');
});

test('offline camp advancement is capped at eight hours and preserves 100ms carry', () => {
  let p = fixture(901_700);
  p = act(p, {type: 'camp-cook', food: 'tea', count: 5});
  const initialTick = p.tick;
  const firstNow = p.wallAt + 99;
  p = advance(p, firstNow);
  assert.equal(p.tick, initialTick);
  assert.equal(p.carryMs, 99);
  p = advance(p, firstNow + 1);
  assert.equal(p.tick, initialTick + 1);
  assert.equal(p.carryMs, 0);
  const offlineNow = p.wallAt + 24 * 60 * 60 * 1_000;
  p = advance(p, offlineNow);
  assert.equal(p.tick, initialTick + 1 + 8 * 60 * 60 * 10, 'elapsed offline time advances at most eight hours');
  assert.equal(p.wallAt, offlineNow);
  assert.equal(p.leisure.materials.tea, 5);
  assert.equal(campOf(p).cooking.length, 0);
});
