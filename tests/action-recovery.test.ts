import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Worker } from 'node:worker_threads';
import {
  actionInput,
  createActionRun,
  parseActionState,
  stepAction,
  type ActionState,
} from '../packages/action-core';
import { parseCommand } from '../packages/protocol';
import { initialProfile as initialGameProfile, parseEnvelope, transact, type Profile } from '../packages/solo-core';

type WorkerMessage = { type: string; id?: number; state?: any; error?: string };

class WorkerHarness {
  readonly worker: Worker;
  state: any;
  private nextId = 0;
  private pending = new Map<number, { resolve: (message: WorkerMessage) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private readyResolve?: () => void;
  private readyReject?: (error: Error) => void;
  private readyDone = false;
  private terminating = false;

  constructor(file: string, folder: string, extra: Record<string, unknown> = {}) {
    this.worker = new Worker(file, { workerData: { folder, ...extra } });
    this.worker.on('message', (message: WorkerMessage) => {
      if (message.type === 'state') {
        this.state = message.state;
        if (!this.readyDone) {
          this.readyDone = true;
          this.readyResolve?.();
        }
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
      for (const [id, item] of this.pending) {
        clearTimeout(item.timer);
        item.reject(error);
        this.pending.delete(id);
      }
    });
    this.worker.on('exit', code => {
      if (this.terminating || code === 0) return;
      const error = new Error(`Worker exited with code ${code}`);
      this.readyReject?.(error);
      for (const [id, item] of this.pending) {
        clearTimeout(item.timer);
        item.reject(error);
        this.pending.delete(id);
      }
    });
  }

  ready(): Promise<void> {
    if (this.readyDone) return Promise.resolve();
    return new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
      const timer = setTimeout(() => reject(new Error('worker readiness timed out')), 5000);
      timer.unref();
    });
  }

  request(type: string, extra: Record<string, unknown> = {}): Promise<WorkerMessage> {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`worker reply timed out for ${type}`));
      }, 5000);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ type, id, ...extra });
    });
  }

  async terminate(): Promise<void> {
    this.terminating = true;
    await this.worker.terminate();
  }
}

const workRoot = path.resolve('work/action-recovery-cases');
const actionWorkerFile = path.resolve('dist/action-worker.cjs');
const gameWorkerFile = path.resolve('dist/game-worker.cjs');

function fixtureFolder(t: TestContext): string {
  fs.mkdirSync(workRoot, { recursive: true });
  const folder = fs.mkdtempSync(path.join(workRoot, 'case-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  return folder;
}

function attachWorker(t: TestContext, file: string, folder: string, extra: Record<string, unknown> = {}): WorkerHarness {
  const harness = new WorkerHarness(file, folder, extra);
  t.after(async () => harness.terminate());
  return harness;
}

function readJson(file: string): any {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function legacyV1(profile: Profile): Record<string, unknown> {
  const { leisure: _leisure, business: _business, xp: _xp, actionClaim: _claim, roomClaims: _roomClaims, rewardRemainders: _remainders, ...old } = profile;
  return { ...old, version: 1 };
}

function activeRunWithRealKill(): ActionState {
  const run = createActionRun(0x00c0ffee, 'bow', ['local']);
  for (let index = 0; index < 36_000 && run.kills < 1 && run.phase === 'playing'; index++) {
    const player = run.players[0];
    if (player?.alive && !player.lockedEnemy && run.enemies.length) {
      const enemy = run.enemies.reduce((best, candidate) =>
        Math.hypot(candidate.x - player.x, candidate.y - player.y) < Math.hypot(best.x - player.x, best.y - player.y) ? candidate : best,
      );
      actionInput(run, player.id, { type: 'lock', enemyId: enemy.id });
    }
    if (player?.alive && run.phase === 'playing' && run.tick >= player.skillReady && run.enemies.length >= 3) {
      actionInput(run, player.id, { type: 'skill', skill: 'nova' });
    }
    if (player?.alive && run.phase === 'playing' && run.tick >= player.shieldReady && player.hp < player.maxHp) {
      actionInput(run, player.id, { type: 'skill', skill: 'ward' });
    }
    stepAction(run, 50);
  }
  assert.ok(run.kills >= 1, `fixture did not earn a kill (phase=${run.phase}, tick=${run.tick})`);
  assert.ok(run.reward.coins > 0 && run.reward.xp > 0, 'fixture reward must come from the action-core kill ledger');
  return parseActionState(JSON.parse(JSON.stringify(run)) as unknown);
}

test('game worker migrates a complete v1 profile without losing the original bytes', async t => {
  const folder = fixtureFolder(t);
  const profileFile = path.join(folder, 'profile.json');
  const seed = initialGameProfile(Date.now() + 60_000);
  seed.tick = 137;
  seed.job = 'keeper';
  seed.coins = 731;
  seed.bag = { flour: 23, ration: 8, crystal: 3, gel: 7 };
  seed.cleared = [0];
  seed.upgraded = true;
  seed.retail = true;
  seed.nextSale = seed.tick + 900;
  seed.totals = { crafted: 17, sold: 9, earned: 411, wins: 5 };
  seed.lastTrip = '迁移夹具：已有战利品与进度。';
  seed.notice = '迁移夹具：保留当前提示。';
  const withRun = transact(seed, {
    sequence: 1,
    requestId: 'legacy-run-01',
    action: { type: 'start-run', region: 1, budget: 3, auto: true },
  });
  withRun.queue = { recipe: 'crystal', remaining: 2, due: withRun.tick + 700 };
  const old = legacyV1(withRun);
  const originalBytes = JSON.stringify(old);
  fs.writeFileSync(profileFile, originalBytes);

  const game = attachWorker(t, gameWorkerFile, folder);
  await game.ready();
  assert.equal(game.state.status, 'ready');
  assert.equal(game.state.profile.version, 8);
  assert.equal(game.state.profile.xp, 0);
  assert.equal(game.state.profile.actionClaim, 0);
  assert.deepEqual(legacyV1(game.state.profile), old);
  assert.deepEqual(readJson(path.join(folder, 'profile.v1-before-migration.json')), old);
  assert.equal(fs.readFileSync(path.join(folder, 'profile.v1-before-migration.json'), 'utf8'), originalBytes);
  assert.deepEqual(game.state.profile.rewardRemainders, { coins: 0, xp: 0, gel: 0 });
  assert.deepEqual(readJson(profileFile), game.state.profile, 'the migrated main file must be a real v5 disk save');
});

test('action worker cold start pauses a saved active run and does not advance it offline', async t => {
  const folder = fixtureFolder(t);
  const run = createActionRun(831, 'bow', ['local']);
  stepAction(run, 600);
  run.paused = false;
  const file = path.join(folder, 'action-run.json');
  fs.writeFileSync(file, JSON.stringify({ version: 1, claim: 4, settled: false, run }));

  const action = attachWorker(t, actionWorkerFile, folder);
  await action.ready();
  assert.equal(action.state.status, 'ready');
  assert.equal(action.state.run.paused, true);
  const tickAtLoad = action.state.run.tick;
  await sleep(240);
  const flush = await action.request('flush');
  assert.equal(flush.error, undefined);
  assert.equal(flush.state.run.tick, tickAtLoad, 'no paused or offline time may be added after cold start');
  assert.equal(flush.state.run.paused, true);
  assert.equal(readJson(file).run.tick, tickAtLoad, 'the on-disk action run must remain frozen');
});

test('action worker recovers a valid backup, preserves corrupt bytes, and fails closed when both files are corrupt', async t => {
  const recoverFolder = fixtureFolder(t);
  const main = path.join(recoverFolder, 'action-run.json');
  const invalidMain = Buffer.from('interrupted-main-bytes\n');
  const validRun = createActionRun(22, 'wand', ['local']);
  stepAction(validRun, 300);
  const backup = JSON.stringify({ version: 1, claim: 8, settled: false, run: validRun });
  fs.writeFileSync(main, invalidMain);
  fs.writeFileSync(main + '.bak', backup);
  const recovered = attachWorker(t, actionWorkerFile, recoverFolder);
  await recovered.ready();
  assert.equal(recovered.state.status, 'ready');
  assert.equal(recovered.state.claim, 8);
  assert.equal(recovered.state.run.paused, true);
  assert.match(recovered.state.warnings.join(' '), /有效备份恢复/);
  assert.deepEqual(fs.readFileSync(main), invalidMain, 'recovery must leave the invalid main bytes untouched until a later save');
  const recoveryFlush = await recovered.request('flush');
  assert.equal(recoveryFlush.error, undefined);
  const preservedCorrupt = fs.readdirSync(recoverFolder).find(name => name.startsWith('action-run.json.corrupt-'));
  assert.ok(preservedCorrupt, 'the first save after recovery should preserve the corrupt main file');
  assert.deepEqual(fs.readFileSync(path.join(recoverFolder, preservedCorrupt)), invalidMain);

  const corruptFolder = fixtureFolder(t);
  const badMain = Buffer.from('broken-primary');
  const badBackup = Buffer.from('broken-backup');
  fs.writeFileSync(path.join(corruptFolder, 'action-run.json'), badMain);
  fs.writeFileSync(path.join(corruptFolder, 'action-run.json.bak'), badBackup);
  const blocked = attachWorker(t, actionWorkerFile, corruptFolder);
  await blocked.ready();
  assert.equal(blocked.state.status, 'blocked');
  assert.match(blocked.state.error, /不会清空进度/);
  assert.deepEqual(fs.readFileSync(path.join(corruptFolder, 'action-run.json')), badMain);
  assert.deepEqual(fs.readFileSync(path.join(corruptFolder, 'action-run.json.bak')), badBackup);
});

test('action worker fails closed on an interrupted save and keeps the last good backup', async t => {
  const folder = fixtureFolder(t);
  const action = attachWorker(t, actionWorkerFile, folder);
  await action.ready();
  const main = path.join(folder, 'action-run.json');
  const before = fs.readFileSync(main);
  fs.unlinkSync(main);
  fs.mkdirSync(main);

  const result = await action.request('start', { weapon: 'wand', minClaim: 0 });
  assert.match(result.error ?? '', /保存失败/);
  assert.equal(action.state.status, 'blocked');
  assert.deepEqual(fs.readFileSync(path.join(folder, 'action-run.json.bak')), before, 'the worker must retain its last good save after the primary write fails');
  assert.equal(fs.statSync(main).isDirectory(), true);
});

test('game worker restores a valid profile backup and fails closed when both profile files are corrupt', async t => {
  const recoverFolder = fixtureFolder(t);
  const main = path.join(recoverFolder, 'profile.json');
  const invalidMain = Buffer.from('interrupted-profile-main\n');
  const saved = initialGameProfile(Date.now() + 60_000);
  saved.job = 'keeper';
  saved.coins = 804;
  saved.bag = { flour: 12, ration: 4, crystal: 2, gel: 5 };
  const validBackup = JSON.stringify(saved);
  fs.writeFileSync(main, invalidMain);
  fs.writeFileSync(main + '.bak', validBackup);

  const recovered = attachWorker(t, gameWorkerFile, recoverFolder);
  await recovered.ready();
  assert.equal(recovered.state.status, 'ready');
  assert.equal(recovered.state.profile.coins, 804);
  assert.deepEqual(recovered.state.profile.bag, saved.bag);
  assert.match(recovered.state.warnings.join(' '), /有效备份恢复/);
  const preserved = fs.readdirSync(recoverFolder).find(name => name.startsWith('profile.json.corrupt-'));
  assert.ok(preserved, 'a later game save must preserve the invalid main profile');
  assert.deepEqual(fs.readFileSync(path.join(recoverFolder, preserved)), invalidMain);
  assert.deepEqual(readJson(main), recovered.state.profile);

  const corruptFolder = fixtureFolder(t);
  const badMain = Buffer.from('broken-profile-primary');
  const badBackup = Buffer.from('broken-profile-backup');
  fs.writeFileSync(path.join(corruptFolder, 'profile.json'), badMain);
  fs.writeFileSync(path.join(corruptFolder, 'profile.json.bak'), badBackup);
  const blocked = attachWorker(t, gameWorkerFile, corruptFolder);
  await blocked.ready();
  assert.equal(blocked.state.status, 'blocked');
  assert.match(blocked.state.error, /不会清空进度/);
  assert.deepEqual(fs.readFileSync(path.join(corruptFolder, 'profile.json')), badMain);
  assert.deepEqual(fs.readFileSync(path.join(corruptFolder, 'profile.json.bak')), badBackup);
});

test('game worker blocks after an interrupted profile save while keeping the last good backup', async t => {
  const folder = fixtureFolder(t);
  const game = attachWorker(t, gameWorkerFile, folder);
  await game.ready();
  const main = path.join(folder, 'profile.json');
  const before = fs.readFileSync(main);
  fs.unlinkSync(main);
  fs.mkdirSync(main);

  const result = await game.request('flush');
  assert.match(result.error ?? '', /保存失败/);
  assert.equal(game.state.status, 'blocked');
  assert.deepEqual(fs.readFileSync(path.join(folder, 'profile.json.bak')), before, 'the worker must retain its last good profile save');
  assert.equal(fs.statSync(main).isDirectory(), true);
});

test('private game-worker reward write is idempotent across a crash before action settled is saved', async t => {
  const folder = fixtureFolder(t);
  const run = activeRunWithRealKill();
  const actionFile = path.join(folder, 'action-run.json');
  fs.writeFileSync(actionFile, JSON.stringify({ version: 1, claim: 1, settled: false, run }));
  const game = attachWorker(t, gameWorkerFile, folder);
  await game.ready();
  const action = attachWorker(t, actionWorkerFile, folder);
  await action.ready();
  assert.equal(action.state.settled, false);
  assert.ok(action.state.run.kills >= 1);

  const finished = await action.request('finish');
  assert.equal(finished.error, undefined);
  const earned = finished.state.run.reward;
  assert.ok(earned.coins > 0 && earned.xp > 0);
  assert.equal(finished.state.run.phase, 'lost');
  assert.equal(readJson(actionFile).settled, false);

  const firstGrant = await game.request('action-reward', { claim: 1, coins: earned.coins, xp: earned.xp });
  assert.equal(firstGrant.error, undefined);
  assert.equal(firstGrant.state.profile.actionClaim, 1);
  assert.equal(firstGrant.state.profile.coins, 20 + earned.coins);
  assert.equal(firstGrant.state.profile.xp, earned.xp);
  const firstDisk = readJson(path.join(folder, 'profile.json'));
  assert.deepEqual(firstDisk, firstGrant.state.profile, 'reward must be persisted before the action claim is marked settled');

  await action.terminate(); // crash after the game profile is durable, before the action save records settled=true
  const retry = attachWorker(t, actionWorkerFile, folder);
  await retry.ready();
  assert.equal(retry.state.settled, false);
  const retryFinish = await retry.request('finish');
  assert.deepEqual(retryFinish.state.run.reward, earned);
  const retryGrant = await game.request('action-reward', { claim: retry.state.claim, coins: earned.coins, xp: earned.xp });
  assert.equal(retryGrant.error, undefined);
  assert.equal(retryGrant.state.profile.coins, firstGrant.state.profile.coins);
  assert.equal(retryGrant.state.profile.xp, firstGrant.state.profile.xp);
  assert.equal(retryGrant.state.profile.actionClaim, 1);
  const retryDisk = readJson(path.join(folder, 'profile.json'));
  assert.equal(retryDisk.coins, firstDisk.coins, 'the duplicate claim must not add coins to the actual profile file');
  assert.equal(retryDisk.xp, firstDisk.xp, 'the duplicate claim must not add experience to the actual profile file');
  assert.equal(retryDisk.actionClaim, firstDisk.actionClaim, 'the durable claim cursor must remain unchanged');
  const marked = await retry.request('settled', { claim: 1 });
  assert.equal(marked.error, undefined);
  assert.equal(readJson(actionFile).settled, true);

  const nextStart = await retry.request('start', { weapon: 'bow', minClaim: 1 });
  assert.equal(nextStart.error, undefined);
  assert.equal(nextStart.state.claim, 2);
  const nextFinish = await retry.request('finish');
  assert.equal(nextFinish.error, undefined);
  const advanceCursor = await game.request('action-reward', { claim: 2, coins: 0, xp: 0 });
  assert.equal(advanceCursor.error, undefined);
  assert.equal(advanceCursor.state.profile.actionClaim, 2);
  await retry.request('settled', { claim: 2 });
  const beforeExpired = readJson(path.join(folder, 'profile.json'));
  const expired = await game.request('action-reward', { claim: 1, coins: 10_000, xp: 100_000 });
  assert.equal(expired.error, undefined);
  assert.equal(expired.state.profile.actionClaim, 2);
  assert.equal(expired.state.profile.coins, beforeExpired.coins);
  assert.equal(expired.state.profile.xp, beforeExpired.xp);
  const afterExpired = readJson(path.join(folder, 'profile.json'));
  assert.equal(afterExpired.actionClaim, 2);
  assert.equal(afterExpired.coins, beforeExpired.coins);
  assert.equal(afterExpired.xp, beforeExpired.xp);
});

test('renderer command parsers cannot submit arbitrary coins, xp, or action claim data', () => {
  const forged = [
    { type: 'action-claim', claim: 99, coins: 1_000_000, xp: 1_000_000 },
    { type: 'action-start', weapon: 'wand', coins: 1_000_000, xp: 1_000_000 },
    { type: 'action-input', input: { type: 'pause', paused: true, actionClaim: 99 } },
    {
      type: 'game', generation: 7,
      envelope: { sequence: 1, requestId: 'spoof-award-01', action: { type: 'action-reward', claim: 99, coins: 1_000_000, xp: 1_000_000 } },
    },
  ];
  for (const command of forged) assert.throws(() => parseCommand(command), `parseCommand accepted ${JSON.stringify(command)}`);
  assert.throws(() => parseEnvelope({ sequence: 1, requestId: 'spoof-award-01', action: { type: 'action-reward', claim: 99, coins: 1_000_000, xp: 1_000_000 } }));
  assert.throws(() => parseEnvelope({ sequence: 1, requestId: 'spoof-xp-0001', action: { type: 'add-xp', xp: 1_000_000 } }));
});

test('pausing the action worker leaves it frozen while the independent idle game worker keeps saving', async t => {
  const folder = fixtureFolder(t);
  const game = attachWorker(t, gameWorkerFile, folder);
  await game.ready();
  // There must be real background work. An empty visitor profile now sleeps until a command.
  for (const [index, command] of [{type:'apply-job'}, {type:'craft',recipe:'ration',count:1}].entries()) {
    const reply = await game.request('command', { envelope: {sequence:index+1,requestId:`pause-idle-${index+1}`,action:command} });
    assert.equal(reply.error, undefined);
  }
  assert.ok(game.state.profile.queue, 'a real six-second production queue must be active');
  const action = attachWorker(t, actionWorkerFile, folder);
  await action.ready();
  const started = await action.request('start', { weapon: 'wand', minClaim: 0 });
  assert.equal(started.error, undefined);
  const resumed = await action.request('input', { input: { type: 'pause', paused: false } });
  assert.equal(resumed.error, undefined);
  await sleep(220);
  assert.ok(action.state.run.tick > 0, 'the active run must move while explicitly resumed');

  const paused = await action.request('pause');
  assert.equal(paused.error, undefined);
  assert.equal(paused.state.run.paused, true);
  const frozenTick = paused.state.run.tick;
  const profileFile = path.join(folder, 'profile.json');
  const beforeIdleDisk = readJson(profileFile).tick;
  await sleep(5_600);
  await action.request('flush');
  assert.equal(action.state.run.tick, frozenTick);
  const actionDisk = readJson(path.join(folder, 'action-run.json'));
  assert.equal(actionDisk.run.tick, frozenTick);
  assert.equal(actionDisk.run.paused, true);
  const afterIdleDisk = readJson(profileFile);
  assert.ok(afterIdleDisk.tick > beforeIdleDisk, `idle game profile must advance on disk (${beforeIdleDisk} -> ${afterIdleDisk.tick})`);
  assert.equal(game.state.status, 'ready');
});

