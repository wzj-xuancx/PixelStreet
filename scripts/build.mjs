import { build } from 'esbuild';
import {constants} from 'node:fs';
import { mkdir, cp, readdir, access, rm, readFile } from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root = new URL('../', import.meta.url);
process.chdir(fileURLToPath(root));
const iconFragments=JSON.parse(await readFile('vendor/ant-design-icons/icons.json','utf8'));
for(const [name,fragment]of Object.entries(iconFragments))if(typeof fragment!=='string'||/<\/?svg\b|<\?xml|<!DOCTYPE/i.test(fragment))throw Error(`Invalid icon fragment ${name}; run node scripts/index-icons.mjs before building.`);
await rm('dist/renderer', { recursive: true, force: true }); // Generated assets only, in this versioned working tree.
await mkdir('dist/renderer', { recursive: true });
const entries = { 'native-room-0190':'tests/native-room-0190.ts', 'native-field-0190-teardown':'tests/native-field-0190-teardown.ts', 'native-field-0190':'tests/native-field-0190.ts', 'native-portals-0181':'tests/native-portals-0181.ts', 'native-field-0180':'tests/native-field-0180.ts', main: 'apps/desktop/main.ts', preload: 'apps/desktop/preload.ts', server: 'apps/server/main.ts', 'party-field-worker':'apps/desktop/party-field-worker.ts','game-worker':'apps/desktop/game-worker.ts','action-worker':'apps/desktop/action-worker.ts','dungeon-worker':'apps/desktop/dungeon-worker.ts','native-shop':'tests/native-shop.ts','native-adventure':'tests/native-adventure.ts','native-loop':'tests/native-loop.ts' };
try { await access('tests/native-solo.ts'); entries['native-solo'] = 'tests/native-solo.ts'; } catch {}
try { await access('tests/native-smoke.ts'); entries['native-smoke'] = 'tests/native-smoke.ts'; } catch {}
try { await cp('tests/native-fixture.html', 'dist/native-fixture.html'); } catch {}
await build({ entryPoints: entries, outdir: 'dist', outExtension: { '.js': '.cjs' }, bundle: true, platform: 'node', target: 'node22', format: 'cjs', external: ['electron'], logLevel: 'warning' });
await build({ entryPoints: ['apps/desktop/renderer/main.ts', 'apps/desktop/renderer/foundation-probe.ts'], outdir: 'dist/renderer', entryNames: '[name]', chunkNames: 'chunks/[name]-[hash]', splitting: true, bundle: true, platform: 'browser', target: 'chrome138', format: 'esm', logLevel: 'warning' });
for (const name of ['field.css', 'badge-small.css', 'chapter.css', 'index.html', 'style.css', 'game-button.css', 'inventory.css', 'item-card.css', 'equipment-panel.css', 'pet-panel.css', 'shop.css', 'atelier.css', 'camp-life.css', 'inner-art.css', 'trade-workspace.css', 'camp-workspace.css', 'bonds-workspace.css', 'inner-shell.css', 'village-ui.css', 'village-integration.css', 'picture-interiors.css', 'room-polish.css', 'village-polish.css','compact-rooms.css','compact-camp.css','compact-field.css', 'action-feedback.css', 'tower.css', 'mastery-panel.css', 'living-scene.css', 'camp-scene.css', 'alchemy-scene.css', 'expedition.css', 'casual.css', 'arena.css', 'dungeon.css', 'foundation-probe.html', 'foundation-probe.css']) await cp(`apps/desktop/renderer/${name}`, `dist/renderer/${name}`);
await cp('assets', 'dist/renderer/assets', { recursive: true, mode:constants.COPYFILE_FICLONE });
const tests = (await readdir('tests')).filter(n => n.endsWith('.test.ts')).map(n => `tests/${n}`);
if (tests.length) await build({ entryPoints: tests, outdir: 'dist/tests', outExtension: { '.js': '.cjs' }, bundle: true, platform: 'node', target: 'node22', format: 'cjs', external: ['electron'], logLevel: 'warning' });
console.log('Built desktop, preload, renderer, independent loopback server and tests.');
