import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advance,
  expeditionOrder,
  initialExpedition,
  initialProfile,
  parseAction,
  parseProfile,
  transact,
  type GameAction,
  type Profile,
} from '../packages/solo-core';

const action = (p: Profile, value: unknown, partySize = 1): Profile => transact(p, {
  sequence: p.sequence + 1,
  requestId: `expedition071-${p.sequence + 1}`,
  action: value as GameAction,
}, partySize);

function keeper(now = 1_000): Profile {
  let p = action(initialProfile(now), {type: 'apply-job'});
  p = action(p, {type: 'craft', recipe: 'ration', count: 1});
  p = advance(p, now + 6_000);
  return action(p, {type: 'deliver-trial'});
}

function ready(p = keeper()): Profile {
  p.bag.ration = 9;
  p.expedition ??= initialExpedition();
  return p;
}

function depart(p: Profile, overrides: Partial<Extract<GameAction, {type: 'expedition-depart'}>> = {}): Profile {
  return action(p, {
    type: 'expedition-depart', region: 0, budget: 9, auto: false,
    mode: 'survey', crew: 'none', meal: 'none', ...overrides,
  });
}

function reachFight(p: Profile, partySize = 1): Profile {
  const r = p.run;
  assert.ok(r, 'expected a live idle run');
  if (r.phase !== 'fight') p = advance(p, p.wallAt + Math.max(100, (r.due - p.tick) * 100), partySize);
  assert.equal(p.run?.phase, 'fight');
  return p;
}

function winNext(p: Profile, partySize = 1): Profile {
  p = reachFight(p, partySize);
  assert.ok(p.run);
  p.run.enemyHP = 1;
  p.run.nextAttack = p.tick + 1;
  p.run.enemyAttack = p.tick + 1_000;
  return advance(p, p.wallAt + 100, partySize);
}

function loseNext(p: Profile): Profile {
  p = reachFight(p);
  assert.ok(p.run);
  p.run.hp = 1;
  p.run.nextAttack = p.tick + 100;
  p.run.enemyAttack = p.tick + 1;
  return advance(p, p.wallAt + 100);
}

function nextRng(seed: number): number {
  let value = seed | 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return value >>> 0;
}

test('legacy schema-7 profiles stay optional; expedition departure round-trips as one persisted run', () => {
  const old = keeper();
  assert.equal(Object.hasOwn(old, 'expedition'), false);
  const reopenedOld = parseProfile(JSON.parse(JSON.stringify(old)));
  assert.equal(Object.hasOwn(reopenedOld, 'expedition'), false);

  let p = ready(old);
  p.leisure.materials.tea = 1;
  p = depart(p, {budget: 3, meal: 'tea', mode: 'caravan'});
  assert.equal(p.version, 8);
  assert.equal(p.bag.ration, 6);
  assert.equal(p.leisure.materials.tea, 0);
  assert.equal(p.expedition?.active?.runId, p.run?.id);
  assert.equal(p.expedition?.active?.mode, 'caravan');
  assert.equal(p.expedition?.active?.gold, 4);
  assert.deepEqual(parseProfile(JSON.parse(JSON.stringify(p))), p);
});

test('departure snapshots camp, workshop, route, companion and meal benefits until the trip ends', () => {
  let p = ready();
  p.leisure.materials.tea = 1;
  p.leisure.companions.owl = 14;
  p.leisure.journal.buildings.archive = 2;
  p.leisure.journal.buildings.lodge = 1;
  p.leisure.journal.buildings.workshop = 2;
  p.business.upgrades.workbench = 2;
  p.expedition!.upgrades.charts = 1;
  p.expedition!.upgrades.tents = 2;
  p.expedition!.upgrades.wagon = 1;
  const rationBefore = p.bag.ration;
  p = depart(p, {budget: 6, mode: 'survey', crew: 'owl', meal: 'tea'});

  const snapshot = p.expedition!.active!;
  assert.equal(p.bag.ration, rationBefore - 6);
  assert.equal(snapshot.crewName, '星页鸮');
  assert.equal(snapshot.level, 5);
  assert.equal(snapshot.travel, 552); // chart room and lodge reduce the 600-tick route.
  assert.equal(snapshot.heal, 12); // tents and lodge are captured for this departure.
  assert.equal(snapshot.spell, 5); // kitchen level contributes to the tea bonus.
  assert.equal(snapshot.cooldown, 14);
  assert.equal(snapshot.notes, 5); // survey + archive + owl.
  assert.equal(snapshot.gather, 2); // workbench contributes one beyond the route base.
  assert.equal(p.run?.due, p.tick + snapshot.travel);
  assert.equal(p.expedition?.cargo.ore, 0);

  const frozen = structuredClone(snapshot);
  p.leisure.companions.owl = 0;
  p.leisure.journal.buildings.archive = 0;
  p.business.upgrades.workbench = 0;
  assert.deepEqual(p.expedition?.active, frozen);
  assert.equal(p.expedition?.active?.notes, 5);
  assert.equal(p.expedition?.active?.gather, 2);
});

test('all nine existing companions contribute the documented expedition snapshot effects', () => {
  const expected: Record<string, {gold?: number; gel?: number; attack?: number; defence?: number; heal?: number; gather?: number; notes?: number; travel?: number}> = {
    slime: {gel: 1}, guide: {gold: 3}, guard: {attack: 1, defence: 1}, fox: {gold: 2},
    deer: {heal: 5}, otter: {gather: 4}, owl: {notes: 4}, bear: {defence: 1, heal: 4},
    bird: {gather: 3, travel: 570},
  };
  for (const [crew, bonus] of Object.entries(expected)) {
    let p = ready();
    p.leisure.companions[crew as keyof typeof p.leisure.companions] = 0;
    p = depart(p, {crew, mode: crew === 'owl' ? 'survey' : 'forage'});
    const a = p.expedition!.active!;
    for (const [key, value] of Object.entries(bonus)) assert.equal(a[key as keyof typeof a], value, `${crew}.${key}`);
    assert.equal(a.level, 1);
  }
});

test('the three regions add one, one-and-a-half, and two minutes to each subsequent trip', () => {
  for (const [region, ticks] of [600, 900, 1_200].entries()) {
    let p = ready();
    p.cleared = Array.from({length: region}, (_, index) => index);
    p = depart(p, {region, budget: 3});
    assert.equal(p.expedition!.active!.travel, ticks);
    assert.equal(p.run!.due, p.tick + ticks);
  }
});

test('all three meal snapshots consume one existing camp food and reject departure when it is missing', () => {
  let p = ready();
  const before = structuredClone(p);
  assert.throws(() => depart(p, {meal: 'soup'}), /需要1份菌菇汤/);
  assert.deepEqual(p, before);

  p.leisure.materials.soup = 1;
  p.leisure.journal.buildings.workshop = 2;
  p.leisure.companions.deer = 5;
  p.expedition!.upgrades.tents = 1;
  p = depart(p, {meal: 'soup', crew: 'deer'});
  assert.equal(p.leisure.materials.soup, 0);
  assert.equal(p.expedition!.active!.defence, 2);
  assert.equal(p.expedition!.active!.heal, 4 + 6 + 2 + 7);

  p = action(p, {type: 'retreat'});
  p.leisure.materials.biscuit = 1;
  p.leisure.journal.buildings.workshop = 2;
  p.leisure.companions.guard = 9;
  p = depart(p, {meal: 'biscuit', crew: 'guard'});
  assert.equal(p.leisure.materials.biscuit, 0);
  assert.equal(p.expedition!.active!.attack, 1 + 3);
  assert.equal(p.expedition!.active!.defence, 2);
});

test('exact expedition upgrade costs apply once and their benefits start on the next departure', () => {
  let p = ready();
  p.coins = 5_000;
  p.leisure.materials.ore = 1_000;
  p.expedition!.marks = 1_000;
  p = depart(p, {budget: 3});
  const first = structuredClone(p.expedition!.active);
  const costs = {
    charts: [[60, 8, 5], [180, 20, 18], [480, 45, 40]],
    tents: [[70, 10, 6], [200, 24, 20], [500, 50, 45]],
    wagon: [[80, 12, 8], [220, 28, 24], [550, 60, 50]],
  } as const;

  for (const upgrade of ['charts', 'tents', 'wagon'] as const) {
    for (const [coins, ore, marks] of costs[upgrade]) {
      const before = {coins: p.coins, ore: p.leisure.materials.ore, marks: p.expedition!.marks};
      p = action(p, {type: 'expedition-upgrade', upgrade});
      assert.equal(p.coins, before.coins - coins);
      assert.equal(p.leisure.materials.ore, before.ore - ore);
      assert.equal(p.expedition!.marks, before.marks - marks);
    }
    assert.equal(p.expedition!.upgrades[upgrade], 3);
    assert.throws(() => action(p, {type: 'expedition-upgrade', upgrade}), /满级/);
  }
  assert.deepEqual(p.expedition!.active, first);
  p = action(p, {type: 'retreat'});
  assert.equal(p.run, null);
  assert.equal(p.expedition!.active, null);
  p = depart(p, {budget: 3});
  assert.ok(p.expedition!.active!.travel < first!.travel);
  assert.ok(p.expedition!.active!.heal > first!.heal);
  assert.ok(p.expedition!.active!.gather > first!.gather);
});

test('same departure envelope is idempotent and save/reopen preserves the live expedition cursor', () => {
  let p = ready();
  p.leisure.materials.biscuit = 1;
  const envelope = {
    sequence: p.sequence + 1,
    requestId: 'expedition071-retry',
    action: {type: 'expedition-depart', region: 0, budget: 6, auto: false, mode: 'forage', crew: 'none', meal: 'biscuit'},
  };
  const started = transact(p, envelope);
  assert.deepEqual(transact(started, envelope), started);
  assert.equal(started.bag.ration, p.bag.ration - 6);
  assert.equal(started.leisure.materials.biscuit, 0);
  p = parseProfile(JSON.parse(JSON.stringify(started)));
  assert.equal(p.run?.id, p.expedition?.active?.runId);
  assert.equal(p.expedition?.active?.attack, 2);
  assert.throws(() => parseProfile({...p, expedition: {...p.expedition!, active: {...p.expedition!.active!, runId: 'run-999'}}}), /游标/);
});

test('party rewards and new forage materials accumulate low fractional remainders across wins', () => {
  let p = ready();
  p.expedition!.upgrades.wagon = 1;
  p.business.upgrades.workbench = 2;
  p.leisure.companions.otter = 0;
  p.rewardRemainders = {coins: 50, xp: 50, gel: 25};
  const coinsBefore = p.coins;
  const xpBefore = p.xp;
  const rng1 = nextRng(p.rng);
  const gelRaw1 = 1 + (rng1 % 2);
  const gelHundredths1 = gelRaw1 * 115 + 25;
  p = depart(p, {budget: 9, mode: 'forage', crew: 'otter'});

  p = winNext(p, 4);
  assert.equal(p.coins - coinsBefore, 7); // wagon adds 2; (4 base + 2) × 1.15 plus the carried 0.50.
  assert.equal(p.xp - xpBefore, 7); // 6 base XP × 1.15 plus the carried 0.50.
  assert.deepEqual(p.rewardRemainders, {coins: 40, xp: 40, gel: p.rewardRemainders.gel});
  assert.equal(p.expedition!.cargo.ore, 8);
  assert.equal(p.expedition!.cargo.herb, 8);
  assert.equal(p.expedition!.carry.ore, 5);
  assert.equal(p.expedition!.carry.herb, 5);
  assert.equal(p.rng, rng1);
  assert.equal(p.expedition!.active!.loot, Math.floor(gelHundredths1 / 100));
  assert.equal(p.rewardRemainders.gel, gelHundredths1 % 100);

  const rng2 = nextRng(rng1);
  const gelHundredths2 = (1 + (rng2 % 2)) * 115 + gelHundredths1 % 100;
  p = winNext(p, 4);
  assert.equal(p.coins - coinsBefore, 14);
  assert.equal(p.xp - xpBefore, 14);
  assert.equal(p.rewardRemainders.coins, 30);
  assert.equal(p.rewardRemainders.xp, 30);
  assert.equal(p.expedition!.cargo.ore, 16);
  assert.equal(p.expedition!.cargo.herb, 16);
  assert.equal(p.expedition!.carry.ore, 10);
  assert.equal(p.expedition!.carry.herb, 10);
  assert.equal(p.rng, rng2);
  assert.equal(p.expedition!.active!.loot, Math.floor(gelHundredths1 / 100) + Math.floor(gelHundredths2 / 100));
  assert.equal(p.rewardRemainders.gel, gelHundredths2 % 100);
});

test('exact-fit field cargo is accepted, then a full crate returns before the next battle', () => {
  let p = ready();
  p = depart(p, {budget: 3, mode: 'forage'});
  p = reachFight(p, 4);
  p.expedition!.cargo.ore = 999_997;
  p.run!.enemyHP = 1;
  p.run!.nextAttack = p.tick + 1;
  p.run!.enemyAttack = p.tick + 1_000;
  const coinsBefore = p.coins;
  const xpBefore = p.xp;
  const first = advance(p, p.wallAt + 100, 4);
  assert.equal(first.expedition!.cargo.ore, 1_000_000);
  assert.equal(first.expedition!.carry.ore, 45);
  assert.equal(first.expedition!.active!.won, 1);

  const beforeNextBattle = structuredClone(first);
  assert.doesNotThrow(() => advance(first, first.wallAt + 60_000, 4));
  const stopped = advance(first, first.wallAt + 60_000, 4);
  assert.equal(stopped.run, null, 'the team returns before starting a battle whose payout cannot fit');
  assert.equal(stopped.expedition!.active, null);
  assert.equal(stopped.expedition!.last!.won, 1);
  assert.equal(stopped.expedition!.last!.spent, 1);
  assert.equal(stopped.expedition!.cargo.ore, 1_000_000);
  assert.equal(stopped.expedition!.carry.ore, beforeNextBattle.expedition!.carry.ore);
  assert.equal(stopped.coins, coinsBefore + 4);
  assert.equal(stopped.xp, xpBefore + 6);
  assert.equal(stopped.rng, beforeNextBattle.rng);
  assert.equal(stopped.bag.ration, beforeNextBattle.bag.ration + beforeNextBattle.run!.remaining);
});

test('all five cargo fields refuse an over-cap payout as one atomic win', () => {
  const edgeCases = [
    {region: 0, mode: 'forage' as const, field: 'ore' as const},
    {region: 0, mode: 'forage' as const, field: 'herb' as const},
    {region: 1, mode: 'forage' as const, field: 'berry' as const},
    {region: 2, mode: 'forage' as const, field: 'mushroom' as const},
    {region: 0, mode: 'survey' as const, field: 'marks' as const},
  ];
  for (const edge of edgeCases) {
    let p = ready();
    p.cleared = Array.from({length: edge.region}, (_, index) => index);
    p = depart(p, {region: edge.region, budget: 3, mode: edge.mode});
    p = reachFight(p);
    p.expedition!.cargo[edge.field] = 999_999;
    p.run!.enemyHP = 1;
    p.run!.nextAttack = p.tick + 1;
    p.run!.enemyAttack = p.tick + 1_000;
    const before = structuredClone(p);
    assert.doesNotThrow(() => advance(p, p.wallAt + 100), edge.field);
    const settled = advance(p, p.wallAt + 100);
    assert.equal(settled.run, null, `${edge.field} should end the run before an unstoreable payout`);
    assert.equal(settled.expedition!.last!.won, 0);
    assert.equal(settled.expedition!.last!.spent, 0);
    assert.equal(settled.expedition!.active, null);
    assert.equal(settled.expedition!.cargo[edge.field], 999_999);
    assert.deepEqual(settled.rewardRemainders, before.rewardRemainders);
    assert.equal(settled.rng, before.rng);
    assert.equal(settled.totals.wins, before.totals.wins);
    assert.equal(settled.expedition!.wins[edge.region], before.expedition!.wins[edge.region]);
    assert.equal(settled.expedition!.credits[edge.region], before.expedition!.credits[edge.region]);
    assert.equal(settled.expedition!.last!.gel, before.expedition!.active!.loot);
    assert.equal(settled.coins, before.coins);
    assert.equal(settled.xp, before.xp);
    assert.equal(settled.bag.ration, 9, 'the refused battle and remaining prepaid food are returned');
  }
});

test('an expedition can fail, retain settled cargo, retreat by region, and stop only without a lower safe region', () => {
  let p = ready();
  p.cleared = [0, 1];
  const rationBefore = p.bag.ration;
  p = depart(p, {region: 2, budget: 6, mode: 'forage'});
  const runId = p.run!.id;
  p = winNext(p);
  const settledCoins = p.coins;
  const settledMarks = p.expedition!.cargo.marks;
  assert.equal(p.expedition!.wins[2], 1);

  p = loseNext(p);
  assert.equal(p.run?.id, runId);
  assert.equal(p.run?.region, 1);
  assert.equal(p.run?.phase, 'recover');
  assert.equal(p.run?.spent, 2);
  assert.equal(p.coins, settledCoins);
  assert.equal(p.expedition!.cargo.marks, settledMarks);
  assert.ok(p.expedition!.active);

  p = loseNext(p);
  assert.equal(p.run?.id, runId);
  assert.equal(p.run?.region, 0);
  assert.equal(p.run?.phase, 'recover');
  assert.equal(p.expedition!.cargo.marks, settledMarks);
  assert.ok(p.expedition!.active);

  p = loseNext(p);
  assert.equal(p.run, null);
  assert.equal(p.expedition!.active, null);
  assert.equal(p.expedition!.last?.won, 1);
  assert.equal(p.expedition!.last?.spent, 4);
  assert.match(p.expedition!.last?.reason ?? '', /没有可退守/);
  assert.equal(p.bag.ration, rationBefore - 6 + 2);
  assert.ok(p.bag.gel > 0, 'the already settled battle loot reaches the backpack');
  assert.equal(p.expedition!.cargo.marks, settledMarks);
});

test('automatic low-region combat keeps running until prepaid rations run out, then refunds unused rations', () => {
  let p = ready();
  p = depart(p, {budget: 3, auto: true});
  const rationAfterDeparture = p.bag.ration;
  p = advance(p, p.wallAt + 240_000);
  assert.equal(p.run, null);
  assert.equal(p.expedition?.active, null);
  assert.equal(p.expedition?.last?.spent, 3);
  assert.equal(p.expedition?.last?.won, 3);
  assert.equal(p.expedition?.trips, 1);
  assert.equal(p.bag.ration, rationAfterDeparture);
  assert.ok(p.expedition!.cargo.marks > 0);
  assert.throws(() => depart(p, {budget: 3}), /领取或出售/);
});

test('generated travel events have unique ids, resolve once, and preserve choice-specific cargo', () => {
  let p = ready();
  p = depart(p, {budget: 9, mode: 'survey'});
  p = winNext(p);
  assert.equal(p.expedition!.events.length, 0);
  p = winNext(p);
  assert.equal(p.expedition!.events.length, 1);
  const event = p.expedition!.events[0];
  assert.equal(event.region, 0);
  const before = structuredClone(p);
  p = action(p, {type: 'expedition-event', id: event.id, choice: 'gather'});
  assert.equal(p.expedition!.events.length, 0);
  assert.equal(p.expedition!.resolved, 1);
  assert.equal(p.expedition!.cargo.herb - before.expedition!.cargo.herb, 3);
  assert.equal(p.expedition!.cargo.marks - before.expedition!.cargo.marks, 1);
  const after = structuredClone(p);
  assert.throws(() => action(p, {type: 'expedition-event', id: event.id, choice: 'gather'}), /已处理/);
  assert.deepEqual(p, after);

  p.expedition!.events = [
    {id: 'expedition-800-4', kind: 'cache', region: 0},
    {id: 'expedition-800-6', kind: 'caravan', region: 1},
  ];
  const beforeStudy = structuredClone(p.expedition!.cargo);
  p = action(p, {type: 'expedition-event', id: 'expedition-800-4', choice: 'study'});
  assert.equal(p.expedition!.cargo.ore, beforeStudy.ore + 1);
  assert.equal(p.expedition!.cargo.marks, beforeStudy.marks + 2);
  const coinsBeforeBarter = p.coins;
  const beforeBarter = structuredClone(p.expedition!.cargo);
  p = action(p, {type: 'expedition-event', id: 'expedition-800-6', choice: 'barter'});
  assert.equal(p.coins, coinsBeforeBarter - 15);
  assert.equal(p.expedition!.cargo.ore, beforeBarter.ore + 6);
  assert.equal(p.expedition!.cargo.marks, beforeBarter.marks + 2);

  p.expedition!.events = [
    {id: 'expedition-801-2', kind: 'cache', region: 0},
    {id: 'expedition-801-4', kind: 'cache', region: 0},
    {id: 'expedition-801-6', kind: 'caravan', region: 0},
  ];
  const fullEvents = structuredClone(p.expedition!.events);
  p = winNext(p);
  p = winNext(p);
  assert.deepEqual(p.expedition!.events, fullEvents, 'the event queue never exceeds three pending records');
});

test('cargo claim capacity is atomic; selling transfers materials as one lot and keeps the notes', () => {
  let p = ready();
  p.expedition!.cargo = {ore: 2, herb: 3, berry: 4, mushroom: 5, marks: 6};
  p.leisure.materials.ore = 9_998;
  const before = structuredClone(p);
  assert.throws(() => action(p, {type: 'expedition-claim'}), /空间不足/);
  assert.deepEqual(p, before);

  const coinsBefore = p.coins;
  p = action(p, {type: 'expedition-sell-cargo'});
  assert.equal(p.coins - coinsBefore, 2 * 2 + 3 * 2 + 4 * 3 + 5 * 4);
  assert.equal(p.leisure.materials.ore, 9_998);
  assert.deepEqual(p.expedition!.cargo, {ore: 0, herb: 0, berry: 0, mushroom: 0, marks: 0});
  assert.equal(p.expedition!.marks, 6);
});

test('three trade orders consume bag goods and camp foods, debit regional credits, and preserve reputation equality', () => {
  let p = ready();
  p.coins = 500;
  p.expedition!.credits = [2, 2, 2];
  p.expedition!.wins = [2, 2, 2];
  p.bag.ration = 0;
  p = action(p, {type: 'garden-plant', plot: 0, crop: 'herb'});
  p = action(p, {type: 'garden-plant', plot: 1, crop: 'mushroom'});
  p = advance(p, p.wallAt + 600_000);
  p = action(p, {type: 'garden-harvest', plot: 0});
  p = action(p, {type: 'garden-harvest', plot: 1});
  p = action(p, {type: 'camp-cook', food: 'tea', count: 1});

  p = action(p, {type: 'trade', item: 'flour', side: 'buy', count: 10});
  p = action(p, {type: 'trade', item: 'gel', side: 'buy', count: 20});
  p = action(p, {type: 'craft', recipe: 'ration', count: 3});
  p = advance(p, p.wallAt + 18_000);
  assert.equal(p.bag.ration, 3);
  assert.equal(p.leisure.materials.tea, 0, 'tea is still in its 20-second cooking batch');
  p = advance(p, p.wallAt + 2_000);
  assert.equal(p.leisure.materials.tea, 1, 'tea finishes after its remaining cooking time');
  const first = expeditionOrder(p, 0);
  const beforeFirst = {coins: p.coins, ore: p.leisure.materials.ore, marks: p.expedition!.marks};
  p = action(p, {type: 'expedition-deliver', slot: 0, revision: first.revision});
  assert.equal(p.bag.ration, 1);
  assert.equal(p.expedition!.credits[0], 0);
  assert.equal(p.expedition!.orders[0], 1);
  assert.equal(p.coins, beforeFirst.coins + first.coins);
  assert.equal(p.leisure.materials.ore, beforeFirst.ore + first.ore);
  assert.equal(p.expedition!.marks, beforeFirst.marks + first.marks);
  assert.equal(p.business.reputation, 1);
  assert.equal(p.business.reputation, p.business.completed);

  p = action(p, {type: 'craft', recipe: 'crystal', count: 1});
  p = advance(p, p.wallAt + 10_000);
  assert.equal(p.leisure.materials.tea, 1);
  const second = expeditionOrder(p, 1);
  p = action(p, {type: 'expedition-deliver', slot: 1, revision: second.revision});
  assert.equal(p.bag.crystal, 0);
  assert.equal(p.leisure.materials.tea, 0);
  assert.equal(p.expedition!.credits[1], 0);

  for (let i = 0; i < 2; i++) {
    p = action(p, {type: 'craft', recipe: 'crystal', count: 1});
    p = advance(p, p.wallAt + 10_000);
  }
  for (let i = 0; i < 2; i++) p = action(p, {type: 'camp-cook', food: 'soup', count: 1});
  assert.equal(p.leisure.materials.soup, 0, 'soup output waits for the cooking queue');
  p = advance(p, p.wallAt + 90_000);
  assert.equal(p.bag.crystal, 2);
  assert.equal(p.leisure.materials.soup, 2);
  const third = expeditionOrder(p, 2);
  p = action(p, {type: 'expedition-deliver', slot: 2, revision: third.revision});
  assert.equal(p.bag.crystal, 0);
  assert.equal(p.leisure.materials.soup, 0);
  assert.equal(p.expedition!.credits[2], 0);
  assert.equal(p.business.reputation, 3);
  assert.equal(p.business.completed, 3);
  assert.equal(p.business.reputation, p.business.completed);
  assert.throws(() => action(p, {type: 'expedition-deliver', slot: 2, revision: third.revision}), /委托已经更新/);
});

test('each merchant slot grows its credential and item requirements as its revision advances', () => {
  let p = ready();
  const expected = [
    {revision: 0, wins: 2, ration: 2, herb: 0, biscuit: 0, coins: 60},
    {revision: 1, wins: 2, ration: 2, herb: 3, biscuit: 0, coins: 60},
    {revision: 2, wins: 2, ration: 2, herb: 0, biscuit: 2, coins: 60},
    {revision: 3, wins: 4, ration: 4, herb: 0, biscuit: 0, coins: 120},
  ];
  for (const row of expected) {
    const order = expeditionOrder(p, 0);
    assert.equal(order.revision, row.revision);
    assert.equal(order.wins, row.wins);
    assert.equal(order.items.ration, row.ration);
    assert.equal(order.items.herb ?? 0, row.herb);
    assert.equal(order.items.biscuit ?? 0, row.biscuit);
    assert.equal(order.coins, row.coins);
    p.expedition!.wins[0] += order.wins;
    p.expedition!.credits[0] += order.wins;
    for (const [item, count] of Object.entries(order.items)) {
      if (Object.hasOwn(p.bag, item)) p.bag[item as keyof Profile['bag']] = count;
      else p.leisure.materials[item as keyof Profile['leisure']['materials']] = count;
    }
    p = action(p, {type: 'expedition-deliver', slot: 0, revision: order.revision});
  }
  assert.equal(p.expedition!.orders[0], 4);
  assert.equal(p.expedition!.wins[0], 10);
  assert.equal(p.expedition!.credits[0], 0);
  assert.equal(p.business.completed, 4);
  assert.equal(p.business.reputation, 4);
  assert.equal(p.business.reputation, p.business.completed);
});

test('order refusal for missing credentials or output capacity leaves all resources untouched', () => {
  let p = ready();
  p.bag.ration = 2;
  const before = structuredClone(p);
  assert.throws(() => action(p, {type: 'expedition-deliver', slot: 0, revision: 0}), /胜利凭证/);
  assert.deepEqual(p, before);

  p.expedition!.wins[0] = 2;
  p.expedition!.credits[0] = 2;
  p.coins = 1_000_000_000 - 59;
  const fullBefore = structuredClone(p);
  assert.throws(() => action(p, {type: 'expedition-deliver', slot: 0, revision: 0}), /空间不足/);
  assert.deepEqual(p, fullBefore);
});

test('ten notes exchange for twenty coins, while nine notes and a full wallet are rejected atomically', () => {
  let p = ready();
  p.expedition!.marks = 9;
  const before = structuredClone(p);
  assert.throws(() => action(p, {type: 'expedition-exchange'}), /需要10份/);
  assert.deepEqual(p, before);
  p.expedition!.marks = 10;
  const coins = p.coins;
  p = action(p, {type: 'expedition-exchange'});
  assert.equal(p.coins, coins + 20);
  assert.equal(p.expedition!.marks, 0);
  p.expedition!.marks = 10;
  p.coins = 1_000_000_000;
  const full = structuredClone(p);
  assert.throws(() => action(p, {type: 'expedition-exchange'}), /金币已满/);
  assert.deepEqual(p, full);
});

test('legacy start-run retains its original 20-tick travel and reward behavior without expedition state', () => {
  let p = keeper();
  p.bag.ration = 3;
  p = action(p, {type: 'start-run', region: 0, budget: 3, auto: false});
  assert.equal(Object.hasOwn(p, 'expedition'), false);
  assert.equal(p.run?.due, p.tick + 10);
  p = winNext(p);
  assert.equal(Object.hasOwn(p, 'expedition'), false);
  assert.equal(p.expedition, undefined);
  assert.equal(p.totals.wins, 1);
  assert.equal(p.coins, 54);
  assert.equal(p.xp, 6);
  assert.equal(p.run?.phase, 'travel');
  assert.equal(p.run?.due, p.tick + 20);
  assert.equal(Object.hasOwn(parseProfile(JSON.parse(JSON.stringify(p))), 'expedition'), false);
});

test('malformed expedition actions and inconsistent active/run cursors are rejected without mutating state', () => {
  for (const raw of [
    {type: 'expedition-depart', region: -1, budget: 3, auto: false, mode: 'survey', crew: 'none', meal: 'none'},
    {type: 'expedition-depart', region: 0, budget: 2, auto: false, mode: 'survey', crew: 'none', meal: 'none'},
    {type: 'expedition-depart', region: 0, budget: 3, auto: false, mode: 'other', crew: 'none', meal: 'none'},
    {type: 'expedition-depart', region: 0, budget: 3, auto: false, mode: 'survey', crew: 'missing', meal: 'none'},
    {type: 'expedition-event', id: 'expedition-1-1', choice: 'unknown'},
    {type: 'expedition-deliver', slot: 3, revision: 0},
    {type: 'expedition-upgrade', upgrade: 'castle'},
    {type: 'expedition-claim', extra: 1},
  ]) assert.throws(() => parseAction(raw));

  let p = ready();
  p = depart(p, {budget: 3});
  const before = structuredClone(p);
  assert.throws(() => action(p, {type: 'expedition-event', id: 'expedition-999-2', choice: 'study'}), /已处理/);
  assert.deepEqual(p, before);
  assert.throws(() => parseProfile({...p, expedition: {...p.expedition!, active: {...p.expedition!.active!, runId: 'run-999'}}}));
});

