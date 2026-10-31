import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  advance, initialProfile, parseProfile, transact,
  type GameAction, type Profile,
} from '../packages/solo-core';
import {GameStore} from '../apps/desktop/game-store';
import {
  IMPORT_MAX_BYTES, IMPORT_TTL_MS, ProfileImportSession,
  importIdleReason, prepareImportedProfile,
} from '../apps/desktop/profile-import';

let requestSerial = 0;
function act(p: Profile, action: GameAction): Profile {
  return transact(p, {
    sequence: p.sequence + 1,
    requestId: `camp090import-${String(++requestSerial).padStart(8, '0')}`,
    action,
  });
}
function clone<T>(value: T): T { return structuredClone(value); }
function isolatedDir(t: {after(fn: () => void): void}, label: string): string {
  const root = '/private/tmp';
  assert.ok(fs.statSync(root).isDirectory(), 'the independent test root is available');
  const dir = fs.mkdtempSync(path.join(root, `pixelstreet-camp090-${label}-`));
  fs.chmodSync(dir, 0o700);
  fs.writeFileSync(path.join(dir, 'ISOLATED-TEST-ONLY.json'), JSON.stringify({purpose: 'camp-090-import-luna', realProfiles: false}), {mode: 0o600});
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  return dir;
}
function profile(now = 2_000_000, coins = 73): Profile {
  const p = initialProfile(now);
  p.job = 'keeper';
  p.coins = coins;
  p.xp = 321;
  p.bag.flour = 12;
  p.leisure.materials.herb = 12;
  p.actionClaim = 4;
  p.roomClaims = [{hostId: 'a'.repeat(32), sequence: 8}];
  return parseProfile(p);
}
function legacyVersions(source: Profile): Record<number, Record<string, unknown>> {
  const v7 = clone(source) as unknown as Record<string, any>;
  v7.version=7;
  delete v7.camp;
  delete v7.atelier;
  delete v7.expedition;
  const v6 = clone(v7);
  v6.version = 6;
  const oldLeisure = v6.leisure as Record<string, any>;
  delete oldLeisure.journal;
  delete oldLeisure.bonds;
  oldLeisure.materials = Object.fromEntries(['herb', 'berry', 'mushroom', 'ore', 'tea', 'biscuit', 'soup'].map(k => [k, oldLeisure.materials[k]]));
  oldLeisure.clears = oldLeisure.clears.slice(0, 3);
  if (oldLeisure.run) {
    delete oldLeisure.run.depth;
    delete oldLeisure.run.coinBonus;
    delete oldLeisure.run.oreBonus;
    delete oldLeisure.run.dustBonus;
    delete oldLeisure.run.bonds;
  }
  const v5 = clone(v7); v5.version = 5; delete v5.leisure;
  const v4 = clone(v5); v4.version = 4; delete v4.business;
  const v3 = clone(v4); v3.version = 3; delete v3.rewardRemainders;
  const v2 = clone(v3); v2.version = 2; delete v2.roomClaims;
  const v1 = clone(v2); v1.version = 1; delete v1.xp; delete v1.actionClaim;
  return {1: v1, 2: v2, 3: v3, 4: v4, 5: v5, 6: v6, 7: v7};
}
function writeJson(file: string, value: unknown): Buffer {
  const bytes = Buffer.from(JSON.stringify(value));
  fs.writeFileSync(file, bytes, {mode: 0o600, flag: 'wx'});
  return bytes;
}
function setSequence(p: Profile, sequence: number): Profile {
  const next = clone(p);
  next.sequence = sequence;
  next.receipt = sequence ? {sequence, requestId: `camp090-seq-${String(sequence).padStart(8, '0')}`, fingerprint: '{"type":"test-sequence"}'} : null;
  return parseProfile(next);
}

test('preview and consume migrate schema v1–v7, report only parsed progress, and leave source bytes untouched', t => {
  const root = isolatedDir(t, 'versions');
  const source = profile();
  const versions = legacyVersions(source);
  for (const version of [1, 2, 3, 4, 5, 6, 7]) {
    const raw = versions[version]!;
    const before = clone(raw);
    const file = path.join(root, `legacy-v${version}.json`);
    const bytes = writeJson(file, raw);
    let now = 10_000 + version;
    const session = new ProfileImportSession(() => now);
    const preview = session.stage(file, 19, 41);
    assert.equal(preview.fileName, `legacy-v${version}.json`);
    assert.equal(preview.sourceVersion, version);
    assert.equal(preview.coins, source.coins);
    assert.equal(preview.xp, version === 1 ? 0 : source.xp);
    assert.equal(preview.companions, 1);
    assert.equal(preview.buildings, 0);
    assert.equal(preview.expiresAt, now + IMPORT_TTL_MS);
    const imported = session.consume(preview.token, 19, 41);
    assert.equal(imported.version, 8);
    assert.equal(imported.coins, source.coins);
    assert.equal(imported.xp, version === 1 ? 0 : source.xp);
    assert.deepEqual(raw, before, `v${version} parsing does not mutate the staged object`);
    assert.deepEqual(fs.readFileSync(file), bytes, `v${version} source bytes are untouched`);
    assert.throws(() => session.consume(preview.token, 19, 41), /预览已失效/);
    now++;
  }
});

test('exactly 512KiB is accepted and 512KiB plus one byte is rejected', t => {
  const root = isolatedDir(t, 'size-boundary');
  const base = Buffer.from(JSON.stringify(profile()));
  assert.ok(base.length < IMPORT_MAX_BYTES);
  const exact = Buffer.concat([base, Buffer.alloc(IMPORT_MAX_BYTES - base.length, 0x20)]);
  const exactFile = path.join(root, 'exact-524288.json');
  fs.writeFileSync(exactFile, exact, {mode: 0o600, flag: 'wx'});
  assert.equal(fs.statSync(exactFile).size, 524_288);
  const session = new ProfileImportSession(() => 50_000);
  const preview = session.stage(exactFile, 1, 1);
  assert.equal(session.consume(preview.token, 1, 1).coins, 73);

  const over = Buffer.concat([base, Buffer.alloc(IMPORT_MAX_BYTES + 1 - base.length, 0x20)]);
  const overFile = path.join(root, 'over-524288.json');
  fs.writeFileSync(overFile, over, {mode: 0o600, flag: 'wx'});
  assert.equal(fs.statSync(overFile).size, 524_289);
  assert.throws(() => session.stage(overFile, 1, 1), /超过512KiB/);
});

test('preview token binds generation and sequence, expires at ten minutes, and wrong tokens do not consume it', t => {
  const root = isolatedDir(t, 'token');
  const file = path.join(root, 'source.json');
  writeJson(file, profile());
  let now = 100_000;
  const session = new ProfileImportSession(() => now);
  const preview = session.stage(file, 7, 12);
  assert.throws(() => session.consume('wrong-token', 7, 12), /预览已失效/);
  assert.equal(session.consume(preview.token, 7, 12).coins, 73, 'a rejected token does not invalidate the valid preview');

  const generationMismatch = session.stage(file, 7, 12);
  assert.throws(() => session.consume(generationMismatch.token, 8, 12), /进度已变化/);
  assert.throws(() => session.consume(generationMismatch.token, 7, 12), /预览已失效/);
  const sequenceMismatch = session.stage(file, 7, 12);
  assert.throws(() => session.consume(sequenceMismatch.token, 7, 13), /进度已变化/);
  const expires = session.stage(file, 7, 12);
  now += IMPORT_TTL_MS;
  assert.equal(expires.expiresAt, now);
  assert.throws(() => session.consume(expires.token, 7, 12), /进度已变化/);
});

test('staging accepts only regular explicitly selected files and rejects malformed JSON/profile data', t => {
  const root = isolatedDir(t, 'file-types');
  const valid = path.join(root, 'valid.json');
  writeJson(valid, profile());
  const session = new ProfileImportSession(() => 1);
  assert.throws(() => session.stage(root, 1, 1), /普通存档文件/);
  const brokenJson = path.join(root, 'broken-json.json');
  fs.writeFileSync(brokenJson, '{broken', {mode: 0o600, flag: 'wx'});
  assert.throws(() => session.stage(brokenJson, 1, 1), /有效的JSON/);
  const brokenProfile = path.join(root, 'broken-profile.json');
  writeJson(brokenProfile, {version: 7, coins: 999_999_999});
  assert.throws(() => session.stage(brokenProfile, 1, 1));
  const link = path.join(root, 'source-link.json');
  fs.symlinkSync(valid, link);
  assert.throws(() => session.stage(link, 1, 1), /普通存档文件/);
});

test('staging rejects both ordinary and dungeon runs; prepareImportedProfile checks current and source runs', t => {
  const root = isolatedDir(t, 'runs');
  const session = new ProfileImportSession(() => 90_000);
  let idle = profile();
  idle.bag.ration = 3;
  idle.bag.gel = 0;
  idle = parseProfile(idle);
  const ordinaryRun = act(idle, {type: 'start-run', region: 0, budget: 3, auto: false});
  const ordinaryFile = path.join(root, 'ordinary-run.json');
  writeJson(ordinaryFile, ordinaryRun);
  assert.match(importIdleReason(ordinaryRun), /冒险队伍回营/);
  assert.throws(() => session.stage(ordinaryFile, 1, 0), /冒险队伍回营/);

  const dungeonRun = act(profile(), {type: 'stroll-start', zone: 0, route: 'balanced', trips: 1});
  const dungeonFile = path.join(root, 'dungeon-run.json');
  writeJson(dungeonFile, dungeonRun);
  assert.match(importIdleReason(dungeonRun), /冒险队伍回营/);
  assert.throws(() => session.stage(dungeonFile, 1, 0), /冒险队伍回营/);
  assert.throws(() => prepareImportedProfile(idle, ordinaryRun, 90_100), /冒险队伍回营/);
  assert.throws(() => prepareImportedProfile(dungeonRun, idle, 90_100), /冒险队伍回营/);
});

test('prepared import applies finite offline time, keeps current local claim ledgers, advances sequence, and does not mutate either input', () => {
  const source = profile(200_000, 500);
  source.leisure.materials.herb = 2;
  let imported = act(source, {type: 'camp-cook', food: 'tea', count: 1});
  imported = setSequence(imported, 5);
  const current0 = setSequence(profile(300_000, 91), 12);
  const current = clone(current0);
  current.actionClaim = 27;
  current.roomClaims = [
    {hostId: 'b'.repeat(32), sequence: 19},
    {hostId: 'c'.repeat(32), sequence: 4},
  ];
  const validCurrent = parseProfile(current);
  const sourceBefore = clone(imported), currentBefore = clone(validCurrent);
  const importedAt = imported.wallAt + 24 * 60 * 60 * 1_000;
  const next = prepareImportedProfile(imported, validCurrent, importedAt);
  assert.equal(next.version, 8);
  assert.equal(next.coins, 500);
  assert.equal(next.actionClaim, 27);
  assert.deepEqual(next.roomClaims, validCurrent.roomClaims);
  assert.equal(next.sequence, Math.max(validCurrent.sequence, imported.sequence) + 1);
  assert.equal(next.receipt?.sequence, next.sequence);
  assert.equal(next.receipt?.requestId.length, 36);
  assert.equal(next.notice.includes('旧版营地进度已导入'), true);
  assert.equal(next.wallAt, importedAt);
  assert.equal(next.tick, imported.tick + 8 * 60 * 60 * 10, 'imported offline progress is capped by the same eight-hour rule');
  assert.equal(next.leisure.materials.tea, 1, 'an imported kitchen batch advances under the current time');
  assert.equal(Object.hasOwn(next, 'camp'), true);
  assert.deepEqual(imported, sourceBefore, 'source profile remains unchanged');
  assert.deepEqual(validCurrent, currentBefore, 'current local ledgers remain unchanged');

  const legacyV7 = profile(400_000, 33);
  const noExtension = prepareImportedProfile(legacyV7, validCurrent, 400_000);
  assert.equal(Object.hasOwn(noExtension, 'camp'), false, 'an old v7 source does not gain lazy camp defaults during import');
});

test('GameStore import saves an exact pre-import backup before switching the stored profile', t => {
  const root = isolatedDir(t, 'store-success');
  const folder = path.join(root, 'PixelStreetCamp-test');
  const store = new GameStore(folder, 500_000);
  store.value.coins = 999;
  store.value.xp = 21;
  store.save(store.value);
  const beforeBytes = fs.readFileSync(store.file);
  const beforeProfile = parseProfile(JSON.parse(beforeBytes.toString('utf8')));
  const imported = profile(500_100, 3_333);
  const importedBefore = clone(imported);
  const backup = store.importProgress(imported);
  assert.equal(fs.readFileSync(backup).compare(beforeBytes), 0, 'the before-import file is a byte-exact copy');
  assert.deepEqual(store.value, imported);
  assert.deepEqual(parseProfile(JSON.parse(fs.readFileSync(store.file, 'utf8'))), imported);
  assert.equal(store.warnings.some(w => w.includes(path.basename(backup))), true);
  assert.equal(fs.statSync(folder).mode & 0o777, 0o700);
  assert.equal(fs.statSync(store.file).mode & 0o777, 0o600);
  assert.deepEqual(beforeProfile, parseProfile(JSON.parse(beforeBytes.toString('utf8'))));
  assert.deepEqual(imported, importedBefore);
});

test('GameStore write failure preserves the active value and original main file while retaining its pre-import backup', t => {
  const root = isolatedDir(t, 'store-failure');
  const folder = path.join(root, 'PixelStreetCamp-test');
  const store = new GameStore(folder, 600_000);
  store.value.coins = 321;
  store.save(store.value);
  const beforeBytes = fs.readFileSync(store.file);
  const beforeProfile = clone(store.value);
  fs.rmSync(store.file + '.bak', {force: true});
  fs.mkdirSync(store.file + '.bak');
  assert.throws(() => store.importProgress(profile(600_100, 4_444)));
  assert.deepEqual(store.value, beforeProfile, 'the in-memory profile is not swapped after a failed save');
  assert.equal(fs.readFileSync(store.file).compare(beforeBytes), 0, 'the main profile remains byte-identical');
  const backups = fs.readdirSync(folder).filter(name => name.startsWith('profile.before-import-'));
  assert.equal(backups.length, 1, 'the protective backup is created before the attempted replacement');
  assert.equal(fs.readFileSync(path.join(folder, backups[0]!)).compare(beforeBytes), 0);
  assert.equal(fs.readdirSync(folder).some(name => name.startsWith('profile.json.bak.tmp-')), false, 'failed atomic backup leaves no temporary file');
});
