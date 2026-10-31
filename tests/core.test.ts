import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defaults, parseCommand, parseSettings, readSettings } from '../packages/protocol';
import { bottomBounds, chooseDisplay, pixelScale, snapDIP, popoverBounds } from '../packages/protocol/geometry';
import { composerKey, validLocalText } from '../packages/protocol/input';
import { SettingsStore } from '../apps/desktop/settings-store';
import { normalizeBag, normalizeCompanion } from '../packages/economy-core/legacy';
const display = { id: 7, label: 'fixture', scaleFactor: 1.25, workArea: { x: -1920, y: -400, width: 1920, height: 1040 } };
test('negative-origin monitor and small workArea never lose bottom window', () => {
  assert.deepEqual(bottomBounds(display, 'street', 192), { x: -1920, y: 448, width: 1920, height: 192 });
  assert.deepEqual(bottomBounds({ ...display, workArea: { x: 0, y: 25, width: 640, height: 180 } }, 'interior', 192), { x: 0, y: 25, width: 640, height: 180 });
  assert.equal(bottomBounds(display, 'street', 48).height, 48);
  assert.equal(bottomBounds(display, 'street', 112, 'top').y, -400);
  assert.throws(() => bottomBounds({ ...display, workArea: { ...display.workArea, width: 0 } }, 'street', 192));
});
test('100/125/150/200 percent fixtures use integer physical pixels', () => {
  for (const scale of [1, 1.25, 1.5, 2]) {
    const result = pixelScale(scale); assert.equal(result.physical, Math.floor(2 * scale));
    assert.equal(result.dip * scale, result.physical); assert.equal(snapDIP(12.7, scale) * scale, Math.round(12.7 * scale));
  }
  assert.throws(() => pixelScale(0));
});
test('removed preferred monitor falls back to live primary', () => {
  const primary = { ...display, id: 8 };
  assert.equal(chooseDisplay([display, primary], 99, 8).id, 8);
  assert.equal(chooseDisplay([display, primary], 7, 8).id, 7);
  assert.throws(() => chooseDisplay([], null, 8));
});
test('strict settings reject unknown fields, assets, prototypes and invalid combinations', () => {
  for (const value of [{ ...defaults, coins: 9 }, { ...defaults, token: 'x' }, { ...defaults, height: Infinity }, { ...defaults, version: 5 }, { ...defaults, dock: 'left' }, { ...defaults, mode: [] }, { ...defaults, volume: NaN }, { ...defaults, displayId: '7' }, { ...defaults, hideShortcut: 'CommandOrControl+Alt+H' }]) assert.throws(() => parseSettings(value));
  assert.throws(() => parseSettings(Object.assign(Object.create({ evil: true }), defaults)));
  assert.deepEqual(parseSettings({ ...defaults }), defaults);
  assert.throws(() => parseSettings({ ...defaults, mode: ['quiet'] }));
  assert.throws(() => parseSettings({ ...defaults, dock: ['top'] }));
});
test('v1/v2/v3 strictly migrate to v4 presets and remove old shortcut fields', () => {
  const { cameraX: _camera, ...v3 } = defaults;
  const { dock: _dock, alwaysOnTop: _level, ...old } = v3;
  const keys = { interactShortcut: 'CommandOrControl+Alt+G', hideShortcut: 'CommandOrControl+Alt+H' };
  const legacy = { ...old, ...keys, version: 1, height: 320 };
  assert.deepEqual(readSettings(legacy), { ...defaults, height: 208 });
  assert.deepEqual(readSettings({ ...v3, ...keys, version: 2 }), defaults);
  assert.deepEqual(readSettings({...v3,version:3,height:129}),{...defaults,height:112});
  assert.equal('hideShortcut' in readSettings(legacy), false);
  assert.throws(() => readSettings({ ...legacy, coins: 1 }));
  assert.throws(() => readSettings({ ...legacy, height: 10 }));
});
test('command allowlist rejects method and parameter injection', () => {
  assert.deepEqual(parseCommand({ type: 'view', value: 'interior' }), { type: 'view', value: 'interior' });
  for (const value of [{ type: 'exec', value: 'x' }, { type: 'enter', url: 'file:///etc/passwd' }, { type: 'pointer', capture: 1 }, { type: 'view', value: 'fullscreen' }]) assert.throws(() => parseCommand(value));
  assert.throws(() => parseCommand({ type: 'view', value: ['input'] }));
});
test('composition confirmation cannot become local send; newline and length boundaries', () => {
  assert.equal(composerKey('Enter', false, true), 'none'); assert.equal(composerKey('Enter', false, false, 229), 'none');
  assert.equal(composerKey('Enter', false, false, 13, 0), 'none'); assert.equal(composerKey('Enter', false, false, 13, 120), 'send');
  assert.equal(composerKey('Enter', true, false), 'none'); assert.equal(composerKey('Escape', false, true), 'none'); assert.equal(composerKey('Escape', false, false), 'release');
  assert.equal(validLocalText('中'.repeat(120)), true); assert.equal(validLocalText('中'.repeat(121)), false); assert.equal(validLocalText('  '), false);
  assert.equal(validLocalText('😀'.repeat(120)), true);
});
test('atomic settings persist with a valid fallback and leave corrupt input intact on load', t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'pixelstreet-settings-')); t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const store = new SettingsStore(folder); store.save({ ...defaults, height: 160 }); store.save({ ...defaults, height: 208 });
  assert.equal(new SettingsStore(folder).value.height, 208);
  fs.writeFileSync(store.file, '{broken'); const recovered = new SettingsStore(folder);
  assert.equal(recovered.value.height, 160); assert.equal(fs.readFileSync(store.file, 'utf8'), '{broken'); assert.ok(recovered.warnings.length > 0);
  const exported = recovered.export(); assert.equal(exported.includes('token'), false); assert.equal(exported.includes('coins'), false);
  assert.throws(() => recovered.import(JSON.stringify({ schema: 'pixel-street-settings', version: 1, settings: { ...defaults, token: 'bad' } })));
  assert.throws(() => recovered.import('x'.repeat(32769)));
  recovered.import(exported); assert.equal(new SettingsStore(folder).value.height, 160);
});
test('companion and bag adapters enforce owned follow and global item uniqueness', () => {
  assert.deepEqual(normalizeCompanion(['slime', 'slime', 'cat', 7], 'unknown', ['slime']), { owned: ['slime'], follow: null });
  assert.deepEqual(normalizeCompanion(['slime'], 'slime', ['slime']), { owned: ['slime'], follow: 'slime' });
  const bag = normalizeBag({ bread: ['a', 'a', 'missing'], potion: ['a', 'b'], '../bad': ['c'] }, new Set(['a', 'b', 'c']));
  assert.deepEqual({ ...bag }, { bread: ['a'], potion: ['b'] });
});
test('popover clamps to negative-origin and tiny work areas with an in-bounds pointer',()=>{
  for(const work of [display.workArea,{x:0,y:31,width:2048,height:1063},{x:-12,y:5,width:60,height:42}])for(const dock of ['top','bottom'] as const){
    const street=bottomBounds({...display,workArea:work},'street',112,dock);
    for(const x of [0,street.width/2,street.width-29]){const {bounds:b,tail}=popoverBounds(work,street,{x,y:6,width:29,height:29},{width:368,height:532},dock);assert.ok(b.x>=work.x&&b.x+b.width<=work.x+work.width);assert.ok(b.y>=work.y&&b.y+b.height<=work.y+work.height);assert.ok(tail>=0&&tail<=b.width);}
  }
  const work={x:0,y:31,width:2048,height:1063};
  assert.equal(popoverBounds(work,bottomBounds({...display,workArea:work},'street',112),{x:1980,y:80,width:29,height:29},{width:368,height:532},'bottom').side,'bottom');
  assert.equal(popoverBounds(work,bottomBounds({...display,workArea:work},'street',112,'top'),{x:1980,y:6,width:29,height:29},{width:368,height:532},'top').side,'top');
});
test('current popover commands need strict generation, text and bounded anchors/camera',()=>{
  const anchor={x:3,y:4,width:44,height:57};assert.deepEqual(parseCommand({type:'actor',anchor}),{type:'actor',anchor});assert.deepEqual(parseCommand({type:'local-text',text:'你好',generation:1}),{type:'local-text',text:'你好',generation:1});
  for(const value of [{type:'talk'},{type:'talk',generation:0},{type:'local-text',generation:1,text:' '},{type:'camera',generation:1,value:321},{type:'camera',value:3},{type:'popup-ready',generation:NaN},{type:'actor',anchor:{...anchor,width:0}},{type:'settings',anchor:{...anchor,x:Infinity}},{type:'actor',anchor:{...anchor,token:'x'}},{type:'view',value:'input'},{type:'view',value:'mini'}])assert.throws(()=>parseCommand(value));
  for(const height of [48,80,112,160,208])assert.equal(parseSettings({...defaults,height}).height,height);
  for(const value of [{...defaults,height:129},{...defaults,cameraX:3.2},{...defaults,cameraX:321}])assert.throws(()=>parseSettings(value));
});

test('shop cutaways preserve height and coordinates for every explicit height/dock',()=>{for(const height of [48,80,112,160,208])for(const dock of ['top','bottom'] as const)assert.deepEqual(bottomBounds(display,'interior',height,dock),bottomBounds(display,'street',height,dock));assert.deepEqual(parseCommand({type:'visit',shop:'shop-bakery'}),{type:'visit',shop:'shop-bakery'});for(const c of [{type:'visit'},{type:'visit',shop:'remote'},{type:'visit',shop:['shop-bakery']}])assert.throws(()=>parseCommand(c));});
