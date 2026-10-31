import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { GameStore } from '../apps/desktop/game-store';
import { advance, initialProfile, parseEnvelope, transact, type GameState, type Profile } from '../packages/solo-core';

type WorkerMessage = { type: string; id?: number; state?: GameState; error?: string };
const workerFile = path.resolve(__dirname,'../game-worker.cjs');
const workRoot = path.resolve('work/party-review-cases');
const hostA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

class ReviewWorker {
  readonly worker: Worker;
  state?: GameState;
  private nextId = 0;
  private closed = false;
  private pending = new Map<number, { resolve: (message: WorkerMessage) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private readyResolve!: (state: GameState) => void;
  private readyReject!: (error: Error) => void;
  private readyPromise: Promise<GameState>;

  constructor(folder: string) {
    this.readyPromise = new Promise((resolve, reject) => { this.readyResolve = resolve; this.readyReject = reject; });
    this.worker = new Worker(workerFile, { workerData: { folder } });
    this.worker.on('message', (message: WorkerMessage) => {
      if (message.type === 'state' && message.state) {
        this.state = message.state;
        this.readyResolve(message.state);
      } else if (message.type === 'reply' && typeof message.id === 'number') {
        const entry = this.pending.get(message.id);
        if (!entry) return;
        clearTimeout(entry.timer);
        this.pending.delete(message.id);
        if (message.state) this.state = message.state;
        entry.resolve(message);
      }
    });
    this.worker.on('error', error => {
      this.readyReject(error);
      for (const [id, entry] of this.pending) {
        clearTimeout(entry.timer);
        entry.reject(error);
        this.pending.delete(id);
      }
    });
    this.worker.on('exit', code => {
      if (this.closed || code === 0) return;
      const error = new Error(`GameWorker exited with code ${code}`);
      this.readyReject(error);
      for (const [id, entry] of this.pending) {
        clearTimeout(entry.timer);
        entry.reject(error);
        this.pending.delete(id);
      }
    });
  }

  async ready(): Promise<GameState> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.readyPromise,
        new Promise<GameState>((_, reject) => { timer = setTimeout(() => reject(new Error('GameWorker readiness timed out')), 5000); }),
      ]);
    } finally { if (timer) clearTimeout(timer); }
  }

  request(type: string, extra: Record<string, unknown> = {}): Promise<WorkerMessage> {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`GameWorker reply timed out for ${type}`)); }, 5000);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ type, id, ...extra });
    });
  }

  async terminate(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error('GameWorker terminated'));
      this.pending.delete(id);
    }
    await this.worker.terminate();
  }
}

function fixtureFolder(t: TestContext): string {
  fs.mkdirSync(workRoot, { recursive: true });
  const folder = fs.mkdtempSync(path.join(workRoot, 'review-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  return folder;
}

function attach(t: TestContext, folder: string): ReviewWorker {
  const game = new ReviewWorker(folder);
  t.after(async () => game.terminate());
  return game;
}

function seed(folder: string, profile: Profile): void {
  const store = new GameStore(folder, profile.wallAt);
  store.save(profile);
}

function readProfile(folder: string): Profile {
  return JSON.parse(fs.readFileSync(path.join(folder, 'profile.json'), 'utf8')) as Profile;
}

function richLegacyProfile(now: number): Profile {
  const p = initialProfile(now);
  p.tick = 23;
  p.wallAt = now;
  p.carryMs = 37;
  p.sequence = 7;
  p.receipt = { sequence: 7, requestId: 'legacy-req-07', fingerprint: 'legacy action fingerprint' };
  p.job = 'keeper';
  p.coins = 4321;
  p.xp = 73;
  p.actionClaim = 9;
  p.roomClaims = [{ hostId: hostA, sequence: 5 }];
  p.bag = { flour: 12, ration: 6, crystal: 4, gel: 7 };
  p.queue = { recipe: 'crystal', remaining: 1, due: 43 };
  p.retail = true;
  p.nextSale = 82;
  p.upgraded = true;
  p.totals = { crafted: 31, sold: 12, earned: 2468, wins: 17 };
  p.cleared = [0];
  p.run = {
    id: 'run-7', wave: 3, region: 0, budget: 5, remaining: 3, spent: 2, loot: 2, defeated: [],
    phase: 'fight', due: 32, hp: 60, enemyHP: 22, enemyMax: 40, nextAttack: 25, enemyAttack: 38,
    frostReady: 30, shatterReady: 35, markedUntil: 28, auto: true, log: 'pre-migration encounter',
  };
  p.rng = 0x12345678;
  p.lastTrip = 'legacy trip';
  p.notice = 'legacy notice';
  return p;
}

test('actual GameWorker migrates v1, v2 and v3 while preserving every old field and exact raw bytes', async t => {
  const future = Date.now() + 3_600_000;
  for (const version of [1, 2, 3] as const) {
    const folder = fixtureFolder(t);
    const current = richLegacyProfile(future);
    const { leisure: _leisure, business: _business, rewardRemainders: _remainders, ...withoutRemainders } = current;
    const { roomClaims: _roomClaims, ...withoutRoomClaims } = withoutRemainders;
    let legacy: Record<string, unknown>;
    if (version === 1) {
      const { xp: _xp, actionClaim: _actionClaim, ...v1 } = withoutRoomClaims;
      legacy = { ...v1, version: 1 };
    } else if (version === 2) legacy = { ...withoutRoomClaims, version: 2 };
    else legacy = { ...withoutRemainders, version: 3 };
    const original = Buffer.from(`${JSON.stringify(legacy, null, 2)}\n`, 'utf8');
    fs.writeFileSync(path.join(folder, 'profile.json'), original);

    const game = attach(t, folder);
    const ready = await game.ready();
    assert.equal(ready.status, 'ready');
    assert.equal(ready.profile?.version, 8);
    for (const [key, value] of Object.entries(legacy)) {
      if (key !== 'version') assert.deepEqual((ready.profile as unknown as Record<string, unknown>)[key], value, `v${version} field ${key}`);
    }
    assert.deepEqual(ready.profile?.rewardRemainders, { coins: 0, xp: 0, gel: 0 });
    assert.deepEqual(ready.profile?.roomClaims, version === 3 ? current.roomClaims : []);
    assert.equal(ready.profile?.xp, version === 1 ? 0 : 73);
    assert.equal(ready.profile?.actionClaim, version === 1 ? 0 : 9);
    assert.deepEqual(fs.readFileSync(path.join(folder, `profile.v${version}-before-migration.json`)), original);
    assert.equal(readProfile(folder).version, 8);
    await game.terminate();
  }
});

test('a remote reward stays pending at a full host ledger and pays once after a slot is freed', async t => {
  const folder = fixtureFolder(t);
  const profile = initialProfile(Date.now() + 3_600_000);
  profile.roomClaims = Array.from({ length: 256 }, (_, index) => ({ hostId: index.toString(16).padStart(32, '0'), sequence: 4 }));
  seed(folder, profile);

  let game = attach(t, folder);
  await game.ready();
  const before = fs.readFileSync(path.join(folder, 'profile.json'));
  const rejected = await game.request('action-reward', { claim: 1, coins: 17, xp: 29, remote: { hostId: hostA, sequence: 8 } });
  assert.match(rejected.error ?? '', /记录已满/);
  assert.deepEqual(fs.readFileSync(path.join(folder, 'profile.json')), before);
  assert.equal(game.state?.profile?.actionClaim, 0);
  assert.equal(game.state?.profile?.roomClaims.length, 256);
  await game.terminate();

  const freed = readProfile(folder);
  freed.roomClaims.pop();
  fs.writeFileSync(path.join(folder, 'profile.json'), JSON.stringify(freed));
  game = attach(t, folder);
  await game.ready();
  const paid = await game.request('action-reward', { claim: 1, coins: 17, xp: 29, remote: { hostId: hostA, sequence: 8 } });
  assert.equal(paid.error, undefined);
  assert.equal(paid.state?.profile?.coins, 37);
  assert.equal(paid.state?.profile?.xp, 29);
  assert.equal(paid.state?.profile?.actionClaim, 1);
  assert.deepEqual(paid.state?.profile?.roomClaims.find(item => item.hostId === hostA), { hostId: hostA, sequence: 8 });
  assert.deepEqual(readProfile(folder), paid.state?.profile, 'wallet, local cursor, and remote high-water are persisted together');

  const duplicate = await game.request('action-reward', { claim: 2, coins: 900, xp: 900, remote: { hostId: hostA, sequence: 8 } });
  assert.equal(duplicate.error, undefined);
  assert.equal(duplicate.state?.profile?.coins, 37);
  assert.equal(duplicate.state?.profile?.xp, 29);
  assert.equal(duplicate.state?.profile?.actionClaim, 2);
  assert.deepEqual(readProfile(folder), duplicate.state?.profile);
});

test('a remote reward stays pending at currency caps and retries after capacity returns', async t => {
  const folder = fixtureFolder(t);
  const profile = initialProfile(Date.now() + 3_600_000);
  profile.coins = 1_000_000_000;
  profile.xp = 1_000_000_000_000;
  seed(folder, profile);

  let game = attach(t, folder);
  await game.ready();
  const before = fs.readFileSync(path.join(folder, 'profile.json'));
  const rejected = await game.request('action-reward', { claim: 1, coins: 1, xp: 1, remote: { hostId: hostA, sequence: 2 } });
  assert.match(rejected.error ?? '', /奖励保留待领取/);
  assert.deepEqual(fs.readFileSync(path.join(folder, 'profile.json')), before);
  assert.equal(game.state?.profile?.actionClaim, 0);
  await game.terminate();

  const room = readProfile(folder);
  room.coins--;
  room.xp--;
  fs.writeFileSync(path.join(folder, 'profile.json'), JSON.stringify(room));
  game = attach(t, folder);
  await game.ready();
  const paid = await game.request('action-reward', { claim: 1, coins: 1, xp: 1, remote: { hostId: hostA, sequence: 2 } });
  assert.equal(paid.error, undefined);
  assert.equal(paid.state?.profile?.coins, 1_000_000_000);
  assert.equal(paid.state?.profile?.xp, 1_000_000_000_000);
  assert.equal(paid.state?.profile?.actionClaim, 1);
  assert.deepEqual(paid.state?.profile?.roomClaims, [{ hostId: hostA, sequence: 2 }]);
  assert.deepEqual(readProfile(folder), paid.state?.profile);
});

test('idle victory rewards accumulate exact hundredth carries by region for all four trusted party sizes', () => {
  for (let region = 0; region < 3; region++) {
    let baselineGel = 0;
    for (let partySize = 1; partySize <= 4; partySize++) {
      let p = initialProfile(1000);
      p.job = 'keeper';
      p.bag.ration = 9;
      p.cleared = Array.from({ length: region }, (_, index) => index);
      p = transact(p, { sequence: 1, requestId: `review-run-${region}`, action: { type: 'start-run', region, budget: 9, auto: false } });
      p = advance(p, p.wallAt + 1000, partySize);
      for (let win = 0; win < 9; win++) {
        if (win > 0) p = advance(p, p.wallAt + 2000, partySize);
        assert.equal(p.run?.phase, 'fight');
        p.run!.enemyHP=1;p.run!.nextAttack=p.tick+1;p.run!.enemyAttack=p.tick+10_000;p.run!.auto=false;
        p = advance(p,p.wallAt+100,partySize);
      }
      const factor=100+5*(partySize-1),level=region+1;
      assert.deepEqual([p.coins-20,p.xp],[Math.floor(4*level*9*factor/100),Math.floor(6*level*9*factor/100)]);
      assert.deepEqual([p.rewardRemainders.coins,p.rewardRemainders.xp],[(4*level*9*factor)%100,(6*level*9*factor)%100]);
      assert.equal(p.totals.wins,9);
      assert.equal(p.run,null);
      if(partySize===1)baselineGel=p.bag.gel;else assert.equal(p.bag.gel,Math.floor(baselineGel*factor/100));
      assert.equal(p.rewardRemainders.gel,(baselineGel*factor)%100);
    }
  }
});

test('a stale local claim never grants a remote reward, and renderer-shaped actions cannot select payout context', async t => {
  const folder = fixtureFolder(t);
  const profile = initialProfile(Date.now() + 3_600_000);
  profile.actionClaim = 5;
  profile.coins = 101;
  profile.xp = 202;
  seed(folder, profile);
  const game = attach(t, folder);
  await game.ready();

  const stale = await game.request('action-reward', { claim: 4, coins: 900, xp: 900, remote: { hostId: hostA, sequence: 8 } });
  assert.equal(stale.error, undefined);
  assert.equal(stale.state?.profile?.actionClaim, 5);
  assert.equal(stale.state?.profile?.coins, 101);
  assert.equal(stale.state?.profile?.xp, 202);
  assert.equal(stale.state?.profile?.roomClaims.find(item => item.hostId === hostA)?.sequence, 8);

  assert.throws(() => parseEnvelope({ sequence: 1, requestId: 'forged-payout-01', action: { type: 'action-reward', claim: 99, coins: 999, xp: 999, remote: { hostId: hostA, sequence: 1 } } }));
  assert.throws(() => parseEnvelope({ sequence: 1, requestId: 'forged-context-1', action: { type: 'skill', skill: 'shatter', runId: 'run-1', wave: 1, partySize: 4, remote: { hostId: hostA, sequence: 1 } } }));
});

test('a manual skill kill through GameWorker uses the trusted four-person reward context', async t => {
  const folder = fixtureFolder(t);
  const profile = initialProfile(Date.now() + 3_600_000);
  profile.job = 'keeper';
  profile.bag.ration = 9;
  const started = transact(profile, { sequence: 1, requestId: 'manual-start-01', action: { type: 'start-run', region: 0, budget: 3, auto: false } });
  started.run!.phase = 'fight';
  started.run!.wave = 1;
  started.run!.remaining = 2;
  started.run!.spent = 1;
  started.run!.enemyHP = 14;
  started.run!.enemyMax = 40;
  started.run!.nextAttack = 1_000_000;
  started.run!.enemyAttack = 1_000_000;
  started.run!.auto = false;
  started.rewardRemainders = { coins: 60, xp: 90, gel: 70 };
  seed(folder, started);

  const game = attach(t, folder);
  await game.ready();
  assert.equal((await game.request('party-context', { partySize: 4 })).error, undefined);
  const result = await game.request('command', { envelope: { sequence: 2, requestId: 'manual-kill-02', action: { type: 'skill', skill: 'shatter', runId: 'run-1', wave: 1 } } });
  assert.equal(result.error, undefined);
  assert.equal(result.state?.partySize, 4);
  assert.equal(result.state?.profile?.coins, 25);
  assert.equal(result.state?.profile?.xp, 7);
  assert.equal(result.state?.profile?.rewardRemainders.coins, 20);
  assert.equal(result.state?.profile?.rewardRemainders.xp, 80);
  assert.equal(result.state?.profile?.totals.wins, 1);
  assert.deepEqual(readProfile(folder), result.state?.profile);
  const carries = structuredClone(result.state?.profile?.rewardRemainders);
  await game.terminate();
  const reloaded = attach(t, folder);
  const restored = await reloaded.ready();
  assert.deepEqual(restored.profile?.rewardRemainders, carries, 'GameStore and a new Worker retain fractional payout state');
});

test('a profile write failure blocks GameWorker and leaves the last durable wallet and cursors in backup', async t => {
  const folder = fixtureFolder(t);
  const profile = initialProfile(Date.now() + 3_600_000);
  seed(folder, profile);
  const game = attach(t, folder);
  await game.ready();
  const durableBefore = readProfile(folder);

  const main = path.join(folder, 'profile.json');
  fs.renameSync(main, `${main}.held-for-write-failure`);
  fs.mkdirSync(main);
  const failed = await game.request('action-reward', { claim: 1, coins: 17, xp: 29, remote: { hostId: hostA, sequence: 1 } });
  assert.match(failed.error ?? '', /保存失败/);
  assert.equal(game.state?.status, 'blocked');
  assert.equal(game.state?.profile?.coins, durableBefore.coins);
  assert.equal(game.state?.profile?.actionClaim, durableBefore.actionClaim);
  assert.equal(game.state?.profile?.roomClaims.length, durableBefore.roomClaims.length);
  assert.deepEqual(JSON.parse(fs.readFileSync(`${main}.bak`, 'utf8')), durableBefore);
});
