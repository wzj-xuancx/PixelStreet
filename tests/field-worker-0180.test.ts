import {enterLegacyField} from './field-v1-fixture';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Worker} from 'node:worker_threads';
import {initialProfile,type GameState,type Profile,type GameAction} from '../packages/solo-core';
const marker={product:'PixelStreet',kind:'isolated-playtest',version:1};
function folder(budget=9){fs.mkdirSync('work',{recursive:true});const dir=fs.mkdtempSync(path.resolve('work/field0180-'));fs.writeFileSync(path.join(dir,'.pixelstreet-playtest.json'),JSON.stringify(marker));const p=initialProfile(1000000);p.job='keeper';p.bag.ration=budget;fs.writeFileSync(path.join(dir,'profile.json'),JSON.stringify(enterLegacyField(p,budget)));return dir;}
function remove(dir:string){assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,'.pixelstreet-playtest.json'),'utf8')),marker);assert.ok(path.basename(dir).startsWith('field0180-'));fs.rmSync(dir,{recursive:true,force:true});}
async function boot(dir:string){
 const saved:Profile=JSON.parse(fs.readFileSync(path.join(dir,'profile.json'),'utf8'));const clock=new BigInt64Array(new SharedArrayBuffer(8));clock[0]=BigInt(saved.wallAt);
 const worker=new Worker("const {workerData}=require('node:worker_threads');const clock=new BigInt64Array(workerData.clock);Date.now=()=>Number(Atomics.load(clock,0));require(workerData.entry);",{eval:true,workerData:{folder:dir,testMode:true,clock:clock.buffer,entry:path.resolve('dist/game-worker.cjs')}});
 let latest!:GameState,states=0,id=0;const pending=new Map<number,{resolve:(v:GameState)=>void;reject:(e:Error)=>void}>();let first!:(v:void)=>void;const ready=new Promise<void>(r=>first=r);
 worker.on('message',m=>{if(m.type==='state'){latest=m.state;states++;first();}else if(m.type==='reply'){const q=pending.get(m.id);if(q){pending.delete(m.id);m.error?q.reject(Error(m.error)):q.resolve(m.state);}}});
 worker.on('error',e=>{for(const q of pending.values())q.reject(e);});await ready;
 const request=(type:string,extra:Record<string,unknown>={})=>new Promise<GameState>((resolve,reject)=>{const next=++id;pending.set(next,{resolve,reject});worker.postMessage({type,id:next,...extra});});
 const command=(a:GameAction)=>request('command',{envelope:{sequence:latest.profile!.sequence+1,requestId:`worker-field-${latest.profile!.sequence+1}`,action:a}});
 return {worker,request,command,jump:(ms:number)=>Atomics.add(clock,0,BigInt(ms)),state:()=>latest,states:()=>states,close:()=>worker.terminate()};
}
test('actual Worker preserves mid-mine state, receipts, ore and depleted final return across reload',async()=>{
 const dir=folder(2);let w=await boot(dir);try{
  /* Booted an explicit saved-v1 run. */const runId=w.state().profile!.run!.id;await w.command({type:'field-target',runId,floor:0,target:{kind:'ore',id:'f0-ore'}});await w.request('advance',{ms:2500});const before=structuredClone(w.state().profile!.run!);assert.ok(before.field!.miningDue>0);
  const mode={sequence:w.state().profile!.sequence+1,requestId:'worker-mode-retry',action:{type:'field-mode',runId,mode:'farm'}};await w.request('command',{envelope:mode});assert.equal(w.state().profile!.run!.field!.miningDue,before.field!.miningDue);await w.request('advance',{ms:2000});assert.equal(w.state().profile!.leisure.materials.ore,1);const after=structuredClone(w.state().profile);await w.request('command',{envelope:mode});assert.deepEqual(w.state().profile,after);
  await w.request('flush');await w.close();w=await boot(dir);assert.equal(w.state().profile!.leisure.materials.ore,1);assert.equal(w.state().profile!.run!.id,runId);await w.request('advance',{ms:35000});assert.equal(w.state().profile!.leisure.materials.ore,2);assert.equal(w.state().profile!.run,null);await w.close();w=await boot(dir);assert.equal(w.state().profile!.leisure.materials.ore,2);assert.equal(w.state().profile!.run,null);
 }finally{await w.close();remove(dir);}
});
test('actual Worker blocks failed critical mining save before publishing ore',async()=>{
 const dir=folder();const w=await boot(dir);try{
  /* Booted an explicit saved-v1 run. */await w.command({type:'field-target',runId:w.state().profile!.run!.id,floor:0,target:{kind:'ore',id:'f0-ore'}});await w.request('advance',{ms:3000});
  fs.mkdirSync(path.join(dir,`profile.json.bak.tmp-${process.pid}`));
  const blocked=new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('critical timer did not block')),2000);const listen=(m:any)=>{if(m.type==='state'&&m.state.status==='blocked'){clearTimeout(timer);w.worker.off('message',listen);resolve();}};w.worker.on('message',listen);});w.jump(1500);await blocked;assert.equal(w.state().status,'blocked');assert.equal(w.state().profile!.leisure.materials.ore,0);assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'profile.json'),'utf8')).leisure.materials.ore,0);assert.equal(w.state().profile!.run!.spent,0);
 }finally{await w.close();remove(dir);}
});
test('actual Worker presentation hints switch active cadence and leave clocks unchanged',async t=>{
 const dir=folder();const w=await boot(dir);try{
  /* Booted an explicit saved-v1 run. */await w.command({type:'field-target',runId:w.state().profile!.run!.id,floor:0,target:{kind:'ground',x:200}});const before=structuredClone(w.state().profile);await w.request('presentation-context',{active:true});let n=w.states();await new Promise(r=>setTimeout(r,360));const visible=w.states()-n;assert.ok(visible>=2,`active publications ${visible}`);await w.request('presentation-context',{active:false});n=w.states();await new Promise(r=>setTimeout(r,360));const hidden=w.states()-n;assert.equal(hidden,0);assert.deepEqual(w.state().profile,before);t.diagnostic(JSON.stringify({active360ms:visible,hidden360ms:hidden,clockChanged:false}));
  await assert.rejects(w.request('presentation-context',{active:1}),/呈现状态/);
 }finally{await w.close();remove(dir);}
});
test('actual Workers with visible 100ms and hidden 500ms elapsed partitions settle identically',async()=>{
 const aDir=folder(),bDir=folder();const a=await boot(aDir),b=await boot(bDir);try{
  for(const w of [a,b]){/* Booted an explicit saved-v1 run. */await w.command({type:'field-mode',runId:w.state().profile!.run!.id,mode:'push'});}
  await a.request('presentation-context',{active:true});await b.request('presentation-context',{active:false});
  for(let i=0;i<100;i++)await a.request('advance',{ms:100});for(let i=0;i<20;i++)await b.request('advance',{ms:500});assert.deepEqual(a.state().profile,b.state().profile);assert.ok(a.state().profile!.totals.wins>=1);
 }finally{await a.close();await b.close();remove(aDir);remove(bDir);}
});
test('actual Worker mines/crafts/equips boots and sword then freezes faster travel on a new run',async t=>{
 const dir=folder();let w=await boot(dir);try{
  /* Booted an explicit saved-v1 run. */await w.command({type:'field-target',runId:w.state().profile!.run!.id,floor:0,target:{kind:'ore',id:'f0-ore'}});await w.command({type:'field-mode',runId:w.state().profile!.run!.id,mode:'farm'});await w.request('advance',{ms:137000});assert.equal(w.state().profile!.leisure.materials.ore,5);
  await w.command({type:'field-target',runId:w.state().profile!.run!.id,floor:0,target:{kind:'monster',id:'f0-e0-m0'}});await w.request('advance',{ms:42000});assert.ok(w.state().profile!.run!.loot>=3);await w.command({type:'field-return',runId:w.state().profile!.run!.id});
  for(const id of ['trail-boots','trail-sword'] as const)await w.command({type:'equipment-craft',id});assert.equal(w.state().profile!.leisure.materials.ore,0);{const preset=enterLegacyField(w.state().profile!,1);await w.close();fs.writeFileSync(path.join(dir,'profile.json'),JSON.stringify(preset));w=await boot(dir);}await w.command({type:'field-target',runId:w.state().profile!.run!.id,floor:0,target:{kind:'ground',x:260}});await w.request('advance',{ms:1000});const bareX=w.state().profile!.run!.field!.x;assert.equal(bareX,120);let bareTicks=10;while(w.state().profile!.run!.field!.target&&bareTicks<50){await w.request('advance',{ms:100});bareTicks++;}assert.equal(w.state().profile!.run!.field!.x,260);await w.command({type:'field-return',runId:w.state().profile!.run!.id});
  for(const id of ['trail-boots','trail-sword'] as const)await w.command({type:'equipment-equip',id});{const preset=enterLegacyField(w.state().profile!,1);await w.close();fs.writeFileSync(path.join(dir,'profile.json'),JSON.stringify(preset));w=await boot(dir);}const snapshot=w.state().profile!.equipment!.active!;assert.equal(snapshot.slots.feet,'trail-boots');assert.equal(snapshot.slots.mainhand,'trail-sword');assert.equal(snapshot.runId,w.state().profile!.run!.id);await w.command({type:'field-target',runId:w.state().profile!.run!.id,floor:0,target:{kind:'ground',x:260}});const splitDir=folder();let split:Awaited<ReturnType<typeof boot>>|undefined;try{
   fs.writeFileSync(path.join(splitDir,'profile.json'),JSON.stringify(w.state().profile));split=await boot(splitDir);for(let i=0;i<10;i++)await w.request('advance',{ms:100});for(let i=0;i<2;i++)await split.request('advance',{ms:500});assert.deepEqual(w.state().profile,split.state().profile);
  }finally{if(split)await split.close();remove(splitDir);}
  const bootsX=w.state().profile!.run!.field!.x;assert.ok(bootsX>bareX,`boots ${bootsX} must exceed bare ${bareX}`);const runBeforeMode=structuredClone(w.state().profile!.run!);assert.ok(runBeforeMode.field!.moveRemainder!>0);await w.command({type:'field-mode',runId:runBeforeMode.id,mode:'push'});await w.command({type:'field-mode',runId:runBeforeMode.id,mode:'manual'});assert.deepEqual(w.state().profile!.run,runBeforeMode);
  await w.request('flush');const before=structuredClone(w.state().profile);await w.close();w=await boot(dir);assert.deepEqual(w.state().profile,before);
  let bootsTicks=10;while(w.state().profile!.run!.field!.target&&bootsTicks<50){await w.request('advance',{ms:100});bootsTicks++;}assert.equal(w.state().profile!.run!.field!.x,260);assert.equal(bareTicks,25);assert.equal(bootsTicks,24);assert.ok(bootsTicks<bareTicks);t.diagnostic(JSON.stringify({oreMined:5,bareX,bootsX,bareTicks,bootsTicks,split100vs500:true,midMoveReload:true,snapshot}));
 }finally{await w.close();remove(dir);}
});
