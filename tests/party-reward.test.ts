import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Worker } from 'node:worker_threads';
import { advance, grantActionReward, initialProfile, parseEnvelope, parseProfile, transact, type GameState, type Profile } from '../packages/solo-core';
import { GameStore } from '../apps/desktop/game-store';

type WorkerMessage = { type: string; id?: number; state?: GameState; error?: string };
const workerFile = process.env.PARTY_GAME_WORKER_PATH ?? path.resolve('dist/game-worker.cjs');
const workRoot = path.resolve('work/party-reward-cases');
const hostA = '0123456789abcdef0123456789abcdef';
const hostB = 'fedcba9876543210fedcba9876543210';

class GameWorkerHarness {
  readonly worker: Worker;
  state?: GameState;
  private nextId = 0;
  private pending = new Map<number, { resolve: (message: WorkerMessage) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private readyResolve?: () => void;
  private readyReject?: (error: Error) => void;
  private readyDone = false;
  private terminating = false;

  constructor(folder: string, testMode = false) {
    this.worker = new Worker(workerFile, { workerData: { folder, testMode } });
    this.worker.on('message', (message: WorkerMessage) => {
      if (message.type === 'state') {
        this.state = message.state;
        if (!this.readyDone) { this.readyDone = true; this.readyResolve?.(); }
      } else if (message.type === 'reply' && typeof message.id === 'number') {
        const item = this.pending.get(message.id);
        if (!item) return;
        clearTimeout(item.timer);
        this.pending.delete(message.id);
        if (message.state) this.state = message.state;
        item.resolve(message);
      }
    });
    this.worker.on('error', error => {
      this.readyReject?.(error);
      for (const [id, item] of this.pending) { clearTimeout(item.timer); item.reject(error); this.pending.delete(id); }
    });
    this.worker.on('exit', code => {
      if (this.terminating || code === 0) return;
      const error = new Error(`GameWorker exited with code ${code}`);
      this.readyReject?.(error);
      for (const [id, item] of this.pending) { clearTimeout(item.timer); item.reject(error); this.pending.delete(id); }
    });
  }

  ready(): Promise<GameState> {
    if (this.readyDone && this.state) return Promise.resolve(this.state);
    return new Promise((resolve, reject) => {
      this.readyResolve = () => this.state ? resolve(this.state) : reject(new Error('GameWorker did not publish ready state'));
      this.readyReject = reject;
      const timer = setTimeout(() => reject(new Error('GameWorker readiness timed out')), 5000);
      timer.unref();
    });
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
    if (this.terminating) return;
    this.terminating = true;
    await this.worker.terminate();
  }
}

function fixtureFolder(t: TestContext): string {
  fs.mkdirSync(workRoot, { recursive: true });
  const folder = fs.mkdtempSync(path.join(workRoot, 'case-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  return folder;
}

function attachWorker(t: TestContext, folder: string, testMode = false): GameWorkerHarness {
  const harness = new GameWorkerHarness(folder, testMode);
  t.after(async () => harness.terminate());
  return harness;
}

function readJson(file: string): any { return JSON.parse(fs.readFileSync(file, 'utf8')); }

function trained(now = 1000): Profile {
  const p = initialProfile(now);
  p.job = 'keeper';
  p.bag.ration = 9;
  return p;
}

function startRun(p: Profile, budget = 3): Profile {
  return transact(p, { sequence: p.sequence + 1, requestId: `party-start-${p.sequence + 1}`, action: { type: 'start-run', region: 0, budget, auto: false } });
}

function waitingAtNextWin(now = 1000): Profile {
  let p = startRun(trained(now));
  p = advance(p, p.wallAt + 1000);
  assert.equal(p.run?.phase, 'fight');
  p.run!.enemyHP = 1;
  p.run!.nextAttack = p.tick + 1;
  p.run!.enemyAttack = p.tick + 10_000;
  p.run!.auto = false;
  return p;
}

test('v1, v2 and v3 profiles migrate losslessly to strict v6 and preserve exact source bytes without replacement', t => {
  const base = initialProfile(1000);
  base.job = 'keeper'; base.coins = 73; base.xp = 17; base.actionClaim = 4;
  base.bag = { flour: 8, ration: 5, crystal: 2, gel: 7 };
  base.roomClaims = [{ hostId: hostA, sequence: 8 }];
  const { leisure: _leisure, business: _business, rewardRemainders: _remainders, ...withoutRemainders } = base;
  const { roomClaims: _claims, ...v2Base } = withoutRemainders;
  const v2 = { ...v2Base, version: 2 };
  const v3 = { ...withoutRemainders, version: 3 };
  const { xp: _xp, actionClaim: _actionClaim, ...v1Base } = v2;
  const v1 = { ...v1Base, version: 1 };
  const versions = [v1, v2, v3] as const;
  for (const [index, legacy] of versions.entries()) {
    const version = index + 1;
    const migrated = parseProfile(legacy);
    assert.equal(migrated.version, 8);
    assert.deepEqual(migrated.rewardRemainders, { coins: 0, xp: 0, gel: 0 });
    for (const [key, value] of Object.entries(legacy)) {
      if (key === 'version') continue;
      if (version === 1 && (key === 'xp' || key === 'actionClaim')) continue;
      assert.deepEqual((migrated as unknown as Record<string, unknown>)[key], value, `v${version} field ${key}`);
    }
    assert.equal(migrated.xp, version === 1 ? 0 : base.xp);
    assert.equal(migrated.actionClaim, version === 1 ? 0 : base.actionClaim);
    assert.deepEqual(migrated.roomClaims, version === 3 ? base.roomClaims : []);
    const folder = fixtureFolder(t);
    const original = JSON.stringify(legacy, null, 2) + '\n';
    fs.writeFileSync(path.join(folder, 'profile.json'), original);
    const store = new GameStore(folder);
    store.save(store.value);
    assert.equal(fs.readFileSync(path.join(folder, `profile.v${version}-before-migration.json`), 'utf8'), original);
    assert.equal(readJson(path.join(folder, 'profile.json')).version, 8);
  }
  assert.throws(() => parseProfile({ ...v3, unexpected: 1 }));

  const backupFolder = fixtureFolder(t);
  const invalidMain = Buffer.from('keep this damaged primary\n');
  const v2Text = JSON.stringify(v2, null, 2) + '\n';
  fs.writeFileSync(path.join(backupFolder, 'profile.json'), invalidMain);
  fs.writeFileSync(path.join(backupFolder, 'profile.json.bak'), v2Text);
  fs.writeFileSync(path.join(backupFolder, 'profile.v2-before-migration.json'), 'earlier preserved source');
  assert.throws(()=>new GameStore(backupFolder),/原件备份/);
  assert.equal(fs.readFileSync(path.join(backupFolder, 'profile.v2-before-migration.json'), 'utf8'), 'earlier preserved source');
  assert.deepEqual(fs.readFileSync(path.join(backupFolder,'profile.json')),invalidMain);
  assert.equal(fs.readFileSync(path.join(backupFolder,'profile.json.bak'),'utf8'),v2Text);

  const v3BackupFolder=fixtureFolder(t),priorV3=Buffer.from('preserve this earlier v3 source');
  const v3Text=JSON.stringify(v3,null,2)+'\n';
  fs.writeFileSync(path.join(v3BackupFolder,'profile.json'),invalidMain);
  fs.writeFileSync(path.join(v3BackupFolder,'profile.json.bak'),v3Text);
  fs.writeFileSync(path.join(v3BackupFolder,'profile.v3-before-migration.json'),priorV3);
  assert.throws(()=>new GameStore(v3BackupFolder),/原件备份/);
  assert.deepEqual(fs.readFileSync(path.join(v3BackupFolder,'profile.v3-before-migration.json')),priorV3);
  assert.deepEqual(fs.readFileSync(path.join(v3BackupFolder,'profile.json')),invalidMain);
  assert.equal(fs.readFileSync(path.join(v3BackupFolder,'profile.json.bak'),'utf8'),v3Text);
});

test('party victory rewards retain hundredth carries across nine wins, including material, without boosting food', () => {
  const expected = [[36, 54], [37, 56], [39, 59], [41, 62]];
  let baselineGel = 0;
  for (let size = 1; size <= 4; size++) {
    let p = startRun(trained(), 9);
    p = advance(p, p.wallAt + 1000, size);
    for (let win = 0; win < 9; win++) {
      if (win > 0) p = advance(p, p.wallAt + 2000, size);
      assert.equal(p.run?.phase, 'fight');
      p.run!.enemyHP = 1;p.run!.nextAttack=p.tick+1;p.run!.enemyAttack=p.tick+10_000;p.run!.auto=false;
      p = advance(p, p.wallAt + 100, size);
    }
    assert.equal(p.coins, 20 + expected[size - 1][0]);
    assert.equal(p.xp, expected[size - 1][1]);
    assert.equal(p.totals.wins, 9);
    assert.equal(p.run, null);
    assert.equal(p.bag.ration, 0);
    assert.equal(parseProfile(p).version, 8);
    if (size === 1) baselineGel = p.bag.gel;
    else assert.equal(p.bag.gel, Math.floor(baselineGel * (100 + 5 * (size - 1)) / 100));
  }
  const p = initialProfile(1000);
  for (const size of [0, 1.5, 5, NaN]) assert.throws(() => advance(p, 1000, size));
});

test('a renderer-shaped skill envelope cannot choose party size, while trusted core context affects its kill reward', () => {
  const waiting = waitingAtNextWin();
  const run = waiting.run!;
  const after = transact(waiting, {
    sequence: waiting.sequence + 1,
    requestId: 'party-skill-02',
    action: { type: 'skill', skill: 'frost', runId: run.id, wave: run.wave },
  }, 4);
  assert.equal(after.coins, 24);
  assert.equal(after.xp, 6);
  assert.throws(() => parseEnvelope({
    sequence: waiting.sequence + 1,
    requestId: 'party-skill-02',
    partySize: 4,
    action: { type: 'skill', skill: 'frost', runId: run.id, wave: run.wave },
  }));
});

test('room reward high-water is per host, duplicate and stale runs advance local claim without paying twice', () => {
  const p = initialProfile(1000);
  const first = grantActionReward(p, 1, 25, 80, { hostId: hostA, sequence: 8 });
  assert.equal(first.coins, 45);
  assert.equal(first.xp, 80);
  assert.equal(first.actionClaim, 1);
  assert.deepEqual(first.roomClaims, [{ hostId: hostA, sequence: 8 }]);

  const duplicate = grantActionReward(first, 2, 999, 999, { hostId: hostA, sequence: 8 });
  assert.equal(duplicate.actionClaim, 2);
  assert.equal(duplicate.coins, first.coins);
  assert.equal(duplicate.xp, first.xp);
  const stale = grantActionReward(duplicate, 3, 999, 999, { hostId: hostA, sequence: 7 });
  assert.equal(stale.actionClaim, 3);
  assert.equal(stale.coins, first.coins);
  const otherHost = grantActionReward(stale, 4, 11, 13, { hostId: hostB, sequence: 1 });
  assert.equal(otherHost.coins, 56);
  assert.equal(otherHost.xp, 93);
  assert.deepEqual(otherHost.roomClaims, [{ hostId: hostA, sequence: 8 }, { hostId: hostB, sequence: 1 }]);
  assert.equal(grantActionReward(otherHost, 4, 500, 500, { hostId: hostB, sequence: 1 }).coins, otherHost.coins);
  assert.equal(grantActionReward(otherHost, 1, 500, 500, { hostId: hostA, sequence: 9 }).coins, otherHost.coins);

  const sameLocalClaim = grantActionReward({ ...p, actionClaim: 5 }, 5, 10, 10, { hostId: hostA, sequence: 2 });
  assert.equal(sameLocalClaim.coins, p.coins);
  assert.deepEqual(sameLocalClaim.roomClaims, [{ hostId: hostA, sequence: 2 }]);
  assert.throws(() => grantActionReward(p, 1, 10, 10, { hostId: hostA.toUpperCase(), sequence: 1 }));
  assert.throws(() => grantActionReward(p, 1, 10, 10, { hostId: hostA, sequence: 1, extra: true } as any));
  assert.throws(() => parseEnvelope({ sequence: 1, requestId: 'party-reward-1', action: { type: 'action-reward', claim: 1, coins: 10, xp: 10, remote: { hostId: hostA, sequence: 1 } } }));
});

test('currency overflow and full room ledger retain all pending claims without mutating source', () => {
  const fullWallet = { ...initialProfile(1000), coins: 1e9 - 1, actionClaim: 0 };
  const beforeWallet = structuredClone(fullWallet);
  assert.throws(() => grantActionReward(fullWallet, 1, 2, 1, { hostId: hostA, sequence: 1 }), /奖励保留待领取/);
  assert.deepEqual(fullWallet, beforeWallet);

  const fullLedger = { ...initialProfile(1000), roomClaims: Array.from({ length: 256 }, (_, index) => ({ hostId: index.toString(16).padStart(32, '0'), sequence: 1 })) };
  const beforeLedger = structuredClone(fullLedger);
  assert.throws(() => grantActionReward(fullLedger, 1, 10, 10, { hostId: hostA, sequence: 1 }), /记录已满/);
  assert.deepEqual(fullLedger, beforeLedger);
  assert.throws(() => parseProfile({ ...initialProfile(1000), roomClaims: [{ hostId: hostA, sequence: 1 }, { hostId: hostA, sequence: 2 }] }));
  assert.throws(() => parseProfile({ ...initialProfile(1000), roomClaims: [{ hostId: hostA, sequence: 0 }] }));
  assert.throws(() => parseProfile({ ...initialProfile(1000), roomClaims: [{ hostId: hostA, sequence: 1, extra: 1 }] }));
  assert.throws(() => parseProfile({ ...initialProfile(1000), roomClaims: Array.from({ length: 257 }, (_, index) => ({ hostId: index.toString(16).padStart(32, '0'), sequence: 1 })) }));
});

test('full idle wallet returns before consuming the next ration, and a reward that reaches cap returns safely', () => {
  let p = startRun(trained(1000), 3);
  p.coins = 1e9;
  p = advance(p, p.wallAt + 1000);
  assert.equal(p.run, null);
  assert.equal(p.totals.wins, 0);
  assert.equal(p.bag.ration, 9);
  assert.match(p.lastTrip, /金币或经验已满/);

  p = waitingAtNextWin();
  p.coins = 1e9 - 4;
  p.xp = 1e12 - 6;
  p = advance(p, p.wallAt + 100);
  assert.equal(p.coins, 1e9);
  assert.equal(p.xp, 1e12);
  assert.equal(p.run, null);
  assert.equal(p.totals.wins, 1);
  assert.equal(p.bag.ration, 8);

  p = waitingAtNextWin();
  p.coins = 1e9 - 3;
  p = advance(p, p.wallAt + 100);
  assert.equal(p.coins, 1e9 - 3);
  assert.equal(p.xp, 0);
  assert.equal(p.run, null);
  assert.equal(p.totals.wins, 0);
  assert.equal(p.bag.ration, 9, 'a fight whose reward no longer fits returns its spent ration before stopping');
});

test('a carried party gel fraction cannot overflow a nearly full bag or spend a ration without reward',()=>{
 let p=waitingAtNextWin();p.bag.gel=99;p.rewardRemainders={coins:40,xp:70,gel:99};
 const rng=p.rng,coins=p.coins,xp=p.xp,carries={...p.rewardRemainders};
 p=advance(p,p.wallAt+100,4);
 assert.equal(p.run,null);
 assert.equal(p.bag.gel,99);
 assert.equal(p.bag.ration,9);
 assert.equal(p.totals.wins,0);
 assert.equal(p.coins,coins);assert.equal(p.xp,xp);assert.equal(p.rng,rng);
 assert.deepEqual(p.rewardRemainders,carries);
 assert.match(p.lastTrip,/本场未计奖励并退还口粮/);
});

test('GameWorker starts solo, settles old party context before switching, and resets party size on cold start', async t => {
  const folder = fixtureFolder(t);
  const store = new GameStore(folder, Date.now());
  store.save(trained(Date.now()));
  let game = attachWorker(t, folder, true);
  await game.ready();
  assert.equal(game.state?.partySize, 1);
  const started = await game.request('command', { envelope: { sequence: 1, requestId: 'party-start-1', action: { type: 'start-run', region: 0, budget: 9, auto: true } } });
  assert.equal(started.error, undefined);
  const soloAdvance = await game.request('advance', { ms: 10_000 });
  assert.equal(soloAdvance.error, undefined);
  assert.equal(soloAdvance.state?.partySize, 1);
  assert.equal(soloAdvance.state?.profile?.totals.wins, 2);
  assert.equal(soloAdvance.state?.profile?.coins, 28);
  assert.equal(soloAdvance.state?.profile?.xp, 12);

  const changed = await game.request('party-context', { partySize: 4 });
  assert.equal(changed.error, undefined);
  assert.equal(changed.state?.partySize, 4);
  const groupedAdvance = await game.request('advance', { ms: 2500 });
  assert.equal(groupedAdvance.error, undefined);
  assert.equal(groupedAdvance.state?.profile?.totals.wins, 3);
  assert.equal(groupedAdvance.state?.profile?.coins, 32);
  assert.equal(groupedAdvance.state?.profile?.xp, 18);
  assert.equal(groupedAdvance.state?.profile?.rewardRemainders.coins, 60);
  assert.equal(groupedAdvance.state?.profile?.rewardRemainders.xp, 90);
  const invalid = await game.request('party-context', { partySize: 5 });
  assert.match(invalid.error ?? '', /1到4/);
  assert.equal(game.state?.partySize, 4);

  await game.terminate();
  game = attachWorker(t, folder, true);
  await game.ready();
  assert.equal(game.state?.partySize, 1, 'party context is ephemeral and cold start defaults to solo');
});

test('remote reward and local claim cursor commit atomically across GameWorker reloads', async t => {
  const folder = fixtureFolder(t);
  let game = attachWorker(t, folder);
  await game.ready();
  const first = await game.request('action-reward', { claim: 1, coins: 25, xp: 80, remote: { hostId: hostA, sequence: 4 } });
  assert.equal(first.error, undefined);
  assert.equal(first.state?.profile?.actionClaim, 1);
  assert.equal(first.state?.profile?.coins, 45);
  assert.deepEqual(first.state?.profile?.roomClaims, [{ hostId: hostA, sequence: 4 }]);
  assert.deepEqual(readJson(path.join(folder, 'profile.json')), first.state?.profile, 'wallet, local cursor and remote high-water are one durable profile write');
  await game.terminate();

  game = attachWorker(t, folder);
  await game.ready();
  const duplicate = await game.request('action-reward', { claim: 2, coins: 999, xp: 999, remote: { hostId: hostA, sequence: 4 } });
  assert.equal(duplicate.error, undefined);
  assert.equal(duplicate.state?.profile?.actionClaim, 2);
  assert.equal(duplicate.state?.profile?.coins, 45);
  assert.equal(duplicate.state?.profile?.xp, 80);
  assert.equal(readJson(path.join(folder, 'profile.json')).actionClaim, 2);
  await game.terminate();

  game = attachWorker(t, folder);
  await game.ready();
  const stale = await game.request('action-reward', { claim: 3, coins: 999, xp: 999, remote: { hostId: hostA, sequence: 3 } });
  assert.equal(stale.error, undefined);
  assert.equal(stale.state?.profile?.actionClaim, 3);
  assert.equal(stale.state?.profile?.coins, 45);
  assert.deepEqual(stale.state?.profile?.roomClaims, [{ hostId: hostA, sequence: 4 }]);
  const independent = await game.request('action-reward', { claim: 4, coins: 11, xp: 13, remote: { hostId: hostB, sequence: 1 } });
  assert.equal(independent.error, undefined);
  assert.equal(independent.state?.profile?.coins, 56);
  assert.equal(independent.state?.profile?.xp, 93);
  assert.deepEqual(readJson(path.join(folder, 'profile.json')), independent.state?.profile);
});

test('bad room claim profile fails closed and keeps original bytes', t => {
  const folder = fixtureFolder(t);
  const bytes = Buffer.from(JSON.stringify({ ...initialProfile(1000), roomClaims: [{ hostId: hostA.toUpperCase(), sequence: 1 }] }));
  fs.writeFileSync(path.join(folder, 'profile.json'), bytes);
  assert.throws(() => new GameStore(folder), /不会清空/);
  assert.deepEqual(fs.readFileSync(path.join(folder, 'profile.json')), bytes);
});
