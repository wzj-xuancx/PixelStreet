import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PanelLayoutStore,clampPanel} from '../apps/desktop/panel-layout-store';

test('shop and inventory positions persist independently and clamp to the display containing each panel',t=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'pixelstreet-panel-layout-'));
  t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
  const displays=[{x:0,y:0,width:1000,height:800},{x:1000,y:0,width:1200,height:900}];

  const first=new PanelLayoutStore(folder);
  first.save('shop',{x:1500,y:100,width:600,height:500});
  first.save('inventory',{x:-500,y:760,width:400,height:330});

  const afterRestart=new PanelLayoutStore(folder);
  assert.deepEqual(afterRestart.place('shop',{x:0,y:0,width:600,height:500},displays),
    {x:1500,y:100,width:600,height:500});
  assert.deepEqual(afterRestart.place('inventory',{x:0,y:0,width:400,height:330},displays),
    {x:0,y:470,width:400,height:330});
  assert.equal(afterRestart.has('shop'),true);
  assert.equal(afterRestart.has('inventory'),true);
});

test('panel bounds cannot escape a smaller work area',()=>{
  assert.deepEqual(clampPanel({x:-300,y:2400,width:1600,height:1200},{x:40,y:25,width:800,height:600}),
    {x:40,y:25,width:800,height:600});
});

test('malformed or oversized layout state falls back without blocking panel placement',t=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'pixelstreet-panel-layout-invalid-'));
  t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
  const file=path.join(folder,'panel-layout.json');
  fs.writeFileSync(file,'{bad json');
  const malformed=new PanelLayoutStore(folder);
  assert.equal(malformed.has('shop'),false);
  assert.deepEqual(malformed.place('shop',{x:-50,y:700,width:600,height:500},[{x:0,y:0,width:1000,height:800}]),
    {x:0,y:300,width:600,height:500});

  fs.writeFileSync(file,'x'.repeat(2049));
  const oversized=new PanelLayoutStore(folder);
  assert.equal(oversized.has('inventory'),false);
});
