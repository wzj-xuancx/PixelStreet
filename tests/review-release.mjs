#!/usr/bin/env node

// Read-only P4 release verification. Run only after a versioned package is ready.
// It never launches the app or touches user settings/progress.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const asar = require('@electron/asar');
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultSourceRoot = path.resolve(scriptDir, '..');
const OLD_020_ASAR_SHA256 = '0a4864a0c2a7492e704a6f19587a6c8b8e60ac46df07cda3707523123d16a1c1';
const args = process.argv.slice(2);

function usage() {
  console.log(`Usage: node tests/review-release.mjs \\
  --app <versioned-arm64-app> \\
  --desktop-app <versioned-desktop-app> \\
  --launcher <desktop-launcher.command> \\
  --source-zip <versioned-source.zip> \\
  --source-manifest <source-hashes.json> \\
  --old-asar <preserved-0.2-app.asar> \\
  [--source-root <project-root>] [--dist <project-dist>] \\
  [--performance-json <after-render-cap/performance.json>] \\
  [--performance-terminal-log <captured-runner-output>] \\
  [--report-json <release-final-luna.json>]

The performance terminal log must contain the runner's literal 'PASS resource probe' marker.
This check does not start, stop, or resume any application or performance run.`);
}

function parseArgs(values) {
  const out = {};
  for (let i = 0; i < values.length; i++) {
    const item = values[i];
    if (item === '--help' || item === '-h') { out.help = true; continue; }
    if (!item.startsWith('--')) throw new Error(`Unexpected argument: ${item}`);
    const key = item.slice(2);
    const value = values[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${item}`);
    if (out[key] !== undefined) throw new Error(`Duplicate option: ${item}`);
    out[key] = value;
  }
  return out;
}

function shaBuffer(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }
async function shaFile(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

function command(name, argv) {
  return execFileSync(name, argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function plistValue(plist, key) {
  return command('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', plist]);
}

async function treeManifest(root) {
  const result = {};
  async function walk(dir, rel = '') {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      const stat = await fsp.lstat(abs);
      if (stat.isSymbolicLink()) result[child] = `symlink:${await fsp.readlink(abs)}`;
      else if (stat.isDirectory()) await walk(abs, child);
      else if (stat.isFile()) result[child] = await shaFile(abs);
      else throw new Error(`Unsupported bundle entry: ${child}`);
    }
  }
  await walk(root);
  return result;
}

function parseSourceManifest(value) {
  const entries = Array.isArray(value.files)
    ? value.files.map(item => [item.path, item.sha256])
    : value.files && typeof value.files === 'object'
      ? Object.entries(value.files).map(([name, hash]) => [name, typeof hash === 'string' ? hash : hash?.sha256])
      : value.sha256 && typeof value.sha256 === 'object'
        ? Object.entries(value.sha256)
        : [];
  if (!entries.length) throw new Error('Source manifest has no supported files/hash entries');
  const result = new Map();
  for (const [file, hash] of entries) {
    if (typeof file !== 'string' || typeof hash !== 'string' || !/^[a-f0-9]{64}$/i.test(hash)) {
      throw new Error(`Invalid source manifest entry: ${String(file)}`);
    }
    const normalized = file.replaceAll('\\', '/').replace(/^\.\//, '');
    if (normalized.startsWith('/') || normalized.split('/').includes('..')) throw new Error(`Unsafe manifest path: ${file}`);
    if (result.has(normalized)) throw new Error(`Duplicate manifest path: ${normalized}`);
    result.set(normalized, hash.toLowerCase());
  }
  return result;
}

function sameMap(left, right) {
  const a = Object.keys(left).sort();
  const b = Object.keys(right).sort();
  if (a.length !== b.length || a.some((key, index) => key !== b[index])) return false;
  return a.every(key => left[key] === right[key]);
}

async function extractedFileMap(root) {
  const result = {};
  async function walk(dir, rel = '') {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      const stat = await fsp.lstat(abs);
      if (stat.isSymbolicLink()) result[child] = `symlink:${await fsp.readlink(abs)}`;
      else if (stat.isDirectory()) await walk(abs, child);
      else if (stat.isFile()) result[child] = await shaFile(abs);
      else throw new Error(`Unsupported extracted entry: ${child}`);
    }
  }
  await walk(root);
  return result;
}

function findManifestRoot(extraction, manifestPaths) {
  const candidates = [];
  function walk(dir, rel = '') {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(abs, child);
      else if (entry.isFile() && entry.name === 'package.json') candidates.push(path.dirname(abs));
    }
  }
  walk(extraction);
  const matches = candidates.filter(candidate => manifestPaths.every(file => fs.existsSync(path.join(candidate, ...file.split('/')))));
  if (matches.length !== 1) throw new Error(`Could not identify one source archive root from package.json; matching roots=${matches.length}`);
  return matches[0];
}

function semverCore(version) {
  const match = /^(\d+\.\d+\.\d+)/.exec(version);
  if (!match) throw new Error(`Unrecognized app version: ${version}`);
  return match[1];
}

function requiredOptions(options) {
  const required = ['app', 'desktop-app', 'launcher', 'source-zip', 'source-manifest', 'old-asar'];
  const missing = required.filter(name => !options[name]);
  if (missing.length) throw new Error(`Missing options: ${missing.map(name => `--${name}`).join(', ')}`);
}

const options = parseArgs(args);
if (options.help) { usage(); process.exit(0); }
try { requiredOptions(options); }
catch (error) { usage(); console.error(error.message); process.exit(64); }

const sourceRoot = path.resolve(options['source-root'] ?? defaultSourceRoot);
const distRoot = path.resolve(options.dist ?? path.join(sourceRoot, 'dist'));
const appPath = path.resolve(options.app);
const desktopAppPath = path.resolve(options['desktop-app']);
const launcherPath = path.resolve(options.launcher);
const sourceZipPath = path.resolve(options['source-zip']);
const sourceManifestPath = path.resolve(options['source-manifest']);
const oldAsarPath = path.resolve(options['old-asar']);
const performancePath = path.resolve(options['performance-json'] ?? path.join(sourceRoot, 'docs/evidence/action-loop/performance/after-render-cap/performance.json'));
const reportPath = path.resolve(options['report-json'] ?? path.join(sourceRoot, 'docs/evidence/action-loop/release-final-luna.json'));
const terminalLogPath = options['performance-terminal-log'] ? path.resolve(options['performance-terminal-log']) : null;
const checks = [];
const runMeta = { sourceRoot, distRoot, appPath, desktopAppPath, launcherPath, sourceZipPath, sourceManifestPath, oldAsarPath, performancePath, terminalLogPath };

async function check(name, fn) {
  try {
    const evidence = await fn();
    checks.push({ name, area: 'release', status: 'PASS', evidence });
  } catch (error) {
    checks.push({ name, area: 'release', status: 'FAIL', error: String(error), stack: error?.stack });
  }
}

await check('Source version and final dist inputs exist', async () => {
  const pkg = JSON.parse(await fsp.readFile(path.join(sourceRoot, 'package.json'), 'utf8'));
  const version = pkg.version;
  if (version === '0.2.0-solo.1') throw new Error('Source package version was not advanced from preserved 0.2.0-solo.1');
  const files = ['main.cjs', 'preload.cjs', 'game-worker.cjs', 'action-worker.cjs', 'renderer/main.js'];
  for (const rel of files) await fsp.access(path.join(distRoot, rel));
  return { version, productName: pkg.productName, appId: pkg.build?.appId, distFiles: files };
});

let packageVersion = null;
let appAsar = null;
await check('Versioned app Info.plist and arm64 executable', async () => {
  const pkg = JSON.parse(await fsp.readFile(path.join(sourceRoot, 'package.json'), 'utf8'));
  packageVersion = pkg.version;
  const plist = path.join(appPath, 'Contents/Info.plist');
  const executable = path.join(appPath, 'Contents/MacOS', plistValue(plist, 'CFBundleExecutable'));
  const info = {
    shortVersion: plistValue(plist, 'CFBundleShortVersionString'),
    bundleVersion: plistValue(plist, 'CFBundleVersion'),
    bundleIdentifier: plistValue(plist, 'CFBundleIdentifier'),
    displayName: plistValue(plist, 'CFBundleDisplayName'),
    executableName: path.basename(executable),
    appVersion: packageVersion,
  };
  if (info.bundleIdentifier !== pkg.build?.appId) throw new Error(`Bundle identifier mismatch: ${info.bundleIdentifier} vs ${pkg.build?.appId}`);
  if (info.displayName !== pkg.productName) throw new Error(`Display name mismatch: ${info.displayName} vs ${pkg.productName}`);
  const core = semverCore(packageVersion);
  if (![core, packageVersion].includes(info.shortVersion)) throw new Error(`CFBundleShortVersionString ${info.shortVersion} does not match ${packageVersion}`);
  if (![core, packageVersion].includes(info.bundleVersion)) throw new Error(`CFBundleVersion ${info.bundleVersion} does not match ${packageVersion}`);
  const archs = command('/usr/bin/lipo', ['-archs', executable]).split(/\s+/).filter(Boolean).sort();
  if (!archs.includes('arm64') || archs.some(arch => !['arm64'].includes(arch))) throw new Error(`Expected arm64-only app executable, found: ${archs.join(', ')}`);
  if (!path.basename(appPath).includes(packageVersion)) throw new Error(`App bundle is not versioned with ${packageVersion}: ${path.basename(appPath)}`);
  appAsar = path.join(appPath, 'Contents/Resources/app.asar');
  await fsp.access(appAsar);
  return { ...info, archs, appAsar };
});

await check('ASAR version and main/preload/complete renderer parity against final dist', async () => {
  if (!appAsar) throw new Error('ASAR path unavailable because app metadata check failed');
  const innerPackage = JSON.parse(asar.extractFile(appAsar, 'package.json').toString('utf8'));
  if (innerPackage.version !== packageVersion) throw new Error(`ASAR package version ${innerPackage.version} does not match source ${packageVersion}`);
  const pairs = ['dist/main.cjs', 'dist/preload.cjs'];
  const rendererRoot = path.join(distRoot, 'renderer');
  const rendererMap = await treeManifest(rendererRoot);
  pairs.push(...Object.keys(rendererMap).map(rel => `dist/renderer/${rel}`));
  const actualAsarRenderer = asar.listPackage(appAsar)
    .map(name => String(name).replace(/^[/\\]+/, ''))
    .filter(name => name.startsWith('dist/renderer/'))
    .filter(name => !('files' in asar.statFile(appAsar, name, false)))
    .sort();
  const expectedAsarRenderer = pairs.filter(name => name.startsWith('dist/renderer/')).sort();
  if (actualAsarRenderer.length !== expectedAsarRenderer.length || actualAsarRenderer.some((name, i) => name !== expectedAsarRenderer[i])) {
    throw new Error(`Renderer ASAR file set differs from final dist; expected ${expectedAsarRenderer.length}, found ${actualAsarRenderer.length}`);
  }
  const fileHashes = {};
  for (const entry of pairs) {
    const expected = await shaFile(path.join(distRoot, entry.slice('dist/'.length)));
    const actual = shaBuffer(asar.extractFile(appAsar, entry));
    fileHashes[entry] = { expected, actual, match: expected === actual };
    if (expected !== actual) throw new Error(`Packaged ASAR entry differs from final dist: ${entry}`);
  }
  const asarHash = await shaFile(appAsar);
  const oldHash = await shaFile(oldAsarPath);
  if (asarHash === oldHash) throw new Error('New app.asar is byte-identical to preserved 0.2 app.asar');
  return { version: innerPackage.version, asarSha256: asarHash, previous02AsarSha256: oldHash, comparedFileCount: pairs.length, fileHashes };
});

await check('Both external workers match final dist', async () => {
  const resources = path.join(appPath, 'Contents/Resources');
  const result = {};
  for (const name of ['game-worker.cjs', 'action-worker.cjs']) {
    const expected = await shaFile(path.join(distRoot, name));
    const actual = await shaFile(path.join(resources, name));
    result[name] = { expected, actual, match: expected === actual };
    if (expected !== actual) throw new Error(`${name} external resource differs from final dist`);
  }
  return result;
});

await check('codesign verification (read-only)', async () => {
  const output = command('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath]);
  return { command: 'codesign --verify --deep --strict --verbose=2', output };
});

await check('Desktop versioned app tree is byte-identical to packaged app', async () => {
  if (path.basename(appPath) !== path.basename(desktopAppPath)) throw new Error('Packaged and Desktop app bundle names differ');
  const [packaged, desktop] = await Promise.all([treeManifest(appPath), treeManifest(desktopAppPath)]);
  if (!sameMap(packaged, desktop)) {
    const left = new Set(Object.keys(packaged));
    const right = new Set(Object.keys(desktop));
    throw new Error(`Desktop app tree mismatch; missing=${[...left].filter(x => !right.has(x)).slice(0, 12).join(',')}; extra=${[...right].filter(x => !left.has(x)).slice(0, 12).join(',')}; changed=${[...left].filter(x => right.has(x) && packaged[x] !== desktop[x]).slice(0, 12).join(',')}`);
  }
  return { relativeEntries: Object.keys(packaged).length, appAsarSha256: packaged['Contents/Resources/app.asar'] };
});

await check('Desktop launcher targets the versioned Desktop app', async () => {
  const text = await fsp.readFile(launcherPath, 'utf8');
  const appName = path.basename(desktopAppPath);
  if (!text.includes(appName)) throw new Error(`Launcher does not reference ${appName}`);
  if (text.includes('release/mac-arm64/PixelStreet.app') || text.includes('previous-0.2.0-solo.1')) throw new Error('Launcher still references the old unversioned or preserved 0.2 target');
  if (!/\bopen\b/.test(text)) throw new Error('Launcher contains no macOS open command');
  const baseVars = new Map([['pixelstreet_dir', path.dirname(launcherPath)]]);
  for (const match of text.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)=["']\$\{0:A:h\}["']/g)) baseVars.set(match[1], path.dirname(launcherPath));
  const quotedRefs = [...text.matchAll(/(["'])([^"'\n]*\.app)\1/g)].map(match => match[2]);
  const targetRefs = quotedRefs.filter(reference => reference.endsWith(appName));
  const resolvedTargets = targetRefs.map(reference => {
    let expanded = reference.replaceAll('${0:A:h}', path.dirname(launcherPath));
    for (const [variable, base] of baseVars) expanded = expanded.replaceAll(`$${variable}`, base);
    return path.resolve(path.isAbsolute(expanded) ? expanded : path.join(path.dirname(launcherPath), expanded));
  });
  if (!resolvedTargets.includes(desktopAppPath)) throw new Error(`Launcher versioned target does not resolve to Desktop app ${desktopAppPath}: ${resolvedTargets.join(', ') || 'no resolvable .app reference'}`);
  return { launcher: launcherPath, targetAppName: appName, resolvedTargets };
});

await check('Source ZIP CRC and extracted-file manifest parity', async () => {
  command('/usr/bin/unzip', ['-tq', sourceZipPath]);
  const manifest = JSON.parse(await fsp.readFile(sourceManifestPath, 'utf8'));
  const expected = parseSourceManifest(manifest);
  const extraction = await fsp.mkdtemp(path.join(os.tmpdir(), 'pixelstreet-release-zip-'));
  try {
    command('/usr/bin/unzip', ['-q', sourceZipPath, '-d', extraction]);
    const sourceTop = findManifestRoot(extraction, [...expected.keys()]);
    const actual = await extractedFileMap(sourceTop);
    const expectedMap = Object.fromEntries(expected);
    if (!sameMap(actual, expectedMap)) {
      const expectedNames = new Set(Object.keys(expectedMap));
      const actualNames = new Set(Object.keys(actual));
      throw new Error(`Extracted source ZIP differs from manifest; missing=${[...expectedNames].filter(x => !actualNames.has(x)).slice(0, 12).join(',')}; extra=${[...actualNames].filter(x => !expectedNames.has(x)).slice(0, 12).join(',')}; changed=${[...expectedNames].filter(x => actualNames.has(x) && expectedMap[x] !== actual[x]).slice(0, 12).join(',')}`);
    }
    const archivedPackage = JSON.parse(await fsp.readFile(path.join(sourceTop, 'package.json'), 'utf8'));
    if (archivedPackage.version !== packageVersion) throw new Error(`Source ZIP package version ${archivedPackage.version} does not match current source ${packageVersion}`);
    const currentSourceMismatches = [];
    for (const [file, expectedHash] of expected) {
      const current = await shaFile(path.join(sourceRoot, ...file.split('/')));
      if (current !== expectedHash) currentSourceMismatches.push(file);
    }
    if (currentSourceMismatches.length) throw new Error(`Current source differs from release manifest: ${currentSourceMismatches.slice(0, 12).join(', ')}`);
    return { sourceZipSha256: await shaFile(sourceZipPath), manifestFiles: expected.size, extractedRoot: path.relative(extraction, sourceTop) || '.', archivedPackageVersion: archivedPackage.version, currentSourceMismatches: [], crc: 'PASS', manifestParity: 'PASS' };
  } finally {
    await fsp.rm(extraction, { recursive: true, force: true });
  }
});

await check('Preserved 0.2 app.asar retains its reviewed SHA-256', async () => {
  const actual = await shaFile(oldAsarPath);
  if (actual !== OLD_020_ASAR_SHA256) throw new Error(`Preserved 0.2 app.asar changed: expected ${OLD_020_ASAR_SHA256}, found ${actual}`);
  return { file: oldAsarPath, sha256: actual, preserved: true };
});

let performanceSummary = { status: 'PENDING', terminalPassObserved: false };
try {
  const performance = JSON.parse(await fsp.readFile(performancePath, 'utf8'));
  const samples = Array.isArray(performance.samples) ? performance.samples : [];
  const timestamps = samples.map(sample => Number(sample.at));
  const sampleTimestampsValid = timestamps.length === samples.length && timestamps.every((stamp, index) => Number.isFinite(stamp) && (index === 0 || stamp > timestamps[index - 1]));
  const completedMs = Date.parse(performance.completedAt ?? '');
  const startedMs = Date.parse(performance.startedAt ?? '');
  const durationMs = Number.isFinite(completedMs) && Number.isFinite(startedMs) ? completedMs - startedMs : null;
  const gaps = timestamps.slice(1).map((stamp, i) => stamp - timestamps[i]);
  const maxSampleGapMs = gaps.length ? Math.max(...gaps) : null;
  const sampleSpanMs = timestamps.length > 1 ? timestamps.at(-1) - timestamps[0] : null;
  let terminalPassObserved = false;
  if (terminalLogPath) {
    const terminal = await fsp.readFile(terminalLogPath, 'utf8');
    terminalPassObserved = /PASS resource probe/.test(terminal);
  }
  const checksForPerformance = {
    status: performance.status,
    residencyMs: performance.residencyMs,
    completedAt: performance.completedAt ?? null,
    startedAt: performance.startedAt ?? null,
    durationMs,
    sampleCount: samples.length,
    sampleSpanMs,
    sampleTimestampsValid,
    maxSampleGapMs,
    errorCount: Array.isArray(performance.errors) ? performance.errors.length : null,
    terminalPassObserved,
    methodLimits: [
      'Residency samples store point RSS/frame/tick snapshots once per minute; they do not calculate long-duration CPU deltas or RSS high-water marks.',
      'Every fifth minute the harness hides and restores the camp, then leaves it visible; this is two-hour residency with periodic hide/restore, not two-hour hidden residency.',
      'Before/after comparison has one short run per build; concurrent Mac workloads and process-set churn can affect ps/app.getAppMetrics deltas.',
    ],
  };
  const complete = performance.status === 'PASS'
    && Number(performance.residencyMs) === 7_200_000
    && durationMs !== null && durationMs >= 7_200_000
    && samples.length >= 120
    && sampleTimestampsValid
    && sampleSpanMs !== null && sampleSpanMs >= 7_080_000
    && maxSampleGapMs !== null && maxSampleGapMs <= 90_000
    && Array.isArray(performance.errors) && performance.errors.length === 0
    && terminalPassObserved;
  performanceSummary = { ...checksForPerformance, status: complete ? 'PASS' : performance.status === 'FAIL' ? 'FAIL' : 'PENDING' };
  checks.push({
    name: 'Two-hour residency evidence and terminal PASS marker',
    area: 'performance',
    status: complete ? 'PASS' : performance.status === 'FAIL' ? 'FAIL' : 'PENDING',
    evidence: checksForPerformance,
    ...(complete ? {} : { note: 'Do not mark the two-hour performance item complete until all duration/sample checks pass and the literal terminal marker is captured.' }),
  });
} catch (error) {
  performanceSummary = { status: 'PENDING', terminalPassObserved: false, error: String(error) };
  checks.push({ name: 'Two-hour residency evidence and terminal PASS marker', area: 'performance', status: 'PENDING', error: String(error) });
}

const releaseChecks = checks.filter(item => item.area === 'release');
const releaseFailed = releaseChecks.some(item => item.status === 'FAIL');
const performanceFailed = performanceSummary.status === 'FAIL';
const performancePassed = performanceSummary.status === 'PASS';
const overallStatus = releaseFailed ? 'FAIL_RELEASE' : performanceFailed ? 'FAIL_PERFORMANCE' : performancePassed ? 'PASS_WITH_LIMITS' : 'PACKAGE_PASS_PERFORMANCE_PENDING';
const report = {
  schema: 'pixelstreet.release-final-luna.v1',
  at: new Date().toISOString(),
  reviewer: 'gpt-6-luna + max',
  status: overallStatus,
  packageStatus: releaseFailed ? 'FAIL' : releaseChecks.every(item => item.status === 'PASS') ? 'PASS' : 'INCOMPLETE',
  performanceStatus: performanceSummary.status,
  method: 'Read-only release verification of package metadata, ASAR and worker hashes, codesign, Desktop-copy parity, launcher target, source ZIP extraction, and preserved 0.2 ASAR. No app launch or real-profile access.',
  inputs: runMeta,
  checks,
  performanceSummary,
  limits: [
    'This script does not launch the versioned production app or access the real profile; packaged first launch remains a separate manual check.',
    'A package PASS does not imply two-hour performance PASS. The performance item is complete only with the full sample/duration evidence and captured terminal PASS marker.',
    'The private ad-hoc app bundle is not notarization or public-release evidence.',
  ],
};
await fsp.mkdir(path.dirname(reportPath), { recursive: true });
await fsp.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`${overallStatus}: ${releaseChecks.filter(item => item.status === 'PASS').length}/${releaseChecks.length} package checks passed; performance=${performanceSummary.status}; report=${reportPath}`);
if (releaseFailed || performanceFailed) process.exitCode = 1;
else if (!performancePassed) process.exitCode = 2;
