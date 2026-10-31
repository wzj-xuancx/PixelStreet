import test from 'node:test';
import assert from 'node:assert/strict';
import {initialProfile,transact,advance,parseProfile,createFeedbackFeed,appendFeedback,type Profile,type GameAction,type GameplayFeedback,type GameplayObserver} from '../packages/solo-core';
const ready=()=>{const p=initialProfile(1000);p.job='keeper';p.coins=100;p.bag.gel=4;p.bag.ration=9;return p;};
const act=(p:Profile,action:GameAction,observe?:GameplayObserver)=>transact(p,{sequence:p.sequence+1,requestId:'feedback-test-'+(p.sequence+1),action},1,observe);
const tick=(p:Profile,n:number,observe?:GameplayObserver)=>advance(p,p.wallAt+n*100,1,observe);
test('real attacks and coat damage show 3 to 2 and observer leaves serialized profile identical',()=>{
 for(const coated of [false,true]){let p=ready();if(coated)p=act(act(p,{type:'equipment-craft',id:'trail-coat'}),{type:'equipment-equip',id:'trail-coat'});const e:Omit<GameplayFeedback,'id'>[]=[];p=act(p,{type:'start-run',region:0,budget:3,auto:false},v=>e.push(v));const plain=tick(p,30),observed=tick(p,30,v=>e.push(v));assert.deepEqual(observed,plain);assert.equal(e.find(v=>v.kind==='hurt')!.amount,coated?2:3);assert.equal(e.find(v=>v.kind==='attack')!.amount,6);assert.equal(e[0].kind,'depart');assert.equal(Object.hasOwn(parseProfile(observed),'feedback'),false);}
});
test('frost/shatter actual hit amounts, win/return order and no repeated read/receipt feedback',()=>{
 const e:Omit<GameplayFeedback,'id'>[]=[];let p=act(ready(),{type:'start-run',region:0,budget:1,auto:false},v=>e.push(v));p=tick(p,10,v=>e.push(v));p=act(p,{type:'skill',skill:'frost',runId:p.run!.id,wave:1},v=>e.push(v));const envelope={sequence:p.sequence+1,requestId:'feedback-shatter',action:{type:'skill',skill:'shatter',runId:p.run!.id,wave:1}};p=transact(p,envelope,1,v=>e.push(v));assert.deepEqual(e.map(v=>v.kind),['depart','frost','shatter','win','return']);assert.equal(e[1].amount,8);assert.equal(e[2].amount,16);const n=e.length;transact(p,envelope,1,v=>e.push(v));tick(p,0,v=>e.push(v));parseProfile(p);assert.equal(e.length,n);
});
test('shelf sale carries actual recipe/price and failed transactions discard buffered events',()=>{
 const e:Omit<GameplayFeedback,'id'>[]=[];let p=ready();p.bag.crystal=1;p=act(p,{type:'stock-shelf',recipe:'crystal',count:1});p=act(p,{type:'retail',enabled:true});p=tick(p,300,v=>e.push(v));assert.deepEqual(e.map(v=>[v.kind,v.recipe,v.amount]),[['sale','crystal',14]]);
 p=act(p,{type:'start-run',region:0,budget:1,auto:false});p=tick(p,10);p=act(p,{type:'skill',skill:'frost',runId:p.run!.id,wave:1});const bad=structuredClone(p);(bad as any).extra=true;assert.throws(()=>act(bad,{type:'skill',skill:'shatter',runId:p.run!.id,wave:1},v=>e.push(v)));assert.equal(e.length,1);
});
test('bounded runtime feed stays at most32 across8h, IDs monotonic, frozen events cannot alter combat',()=>{
 const feed=createFeedbackFeed('test-epoch');let p=ready();p.bag.ration=9;p=act(p,{type:'start-run',region:0,budget:9,auto:false});const noObserver=tick(p,288000);p=tick(p,288000,v=>{assert.equal(Object.isFrozen(v),true);appendFeedback(feed,[v]);});assert.deepEqual(p,noObserver);assert.equal(feed.events.length,32);assert.equal(feed.cursor,32);assert.equal(feed.events.at(-1)!.id,feed.cursor);assert.ok(feed.events.every((v,i)=>i===0||v.id>feed.events[i-1].id));assert.equal(Object.hasOwn(p,'feedback'),false);
 for(let n=0;n<40;n++)appendFeedback(feed,[{tick:n,runId:null,wave:0,kind:'sale',amount:14,recipe:'crystal'}]);assert.equal(feed.events.length,32);assert.equal(feed.cursor,72);assert.equal(createFeedbackFeed('reset').cursor,0);
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Worker} from 'node:worker_threads';
import type {GameState} from '../packages/solo-core';
import {GameStore} from '../apps/desktop/game-store';
test('isolated GameWorker publishes after saves, suppresses receipts/read, resets import epoch and discards failed save events',async t=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'pixelstreet-private-task1-feedback-'));fs.writeFileSync(path.join(folder,'PRIVATE_TEST_PROFILE'),'Task1 test only; no production profile.');
 const seed=ready();seed.wallAt=Date.now();new GameStore(folder,seed.wallAt).save(seed);
 const worker=new Worker(path.resolve('dist/game-worker.cjs'),{workerData:{folder,testMode:true}});let latest:GameState;let id=0;
 t.after(async()=>{await worker.terminate();fs.rmSync(folder,{recursive:true,force:true});});
 await new Promise<void>((resolve,reject)=>{worker.once('error',reject);worker.on('message',m=>{if(m.type==='state'){latest=m.state;resolve();}});});
 const request=(type:string,extra:Record<string,unknown>={})=>new Promise<GameState>((resolve,reject)=>{const current=++id;const timer=setTimeout(()=>{worker.off('message',listener);reject(Error('private Worker timeout'));},10000);const listener=(m:any)=>{if(m.type!=='reply'||m.id!==current)return;clearTimeout(timer);worker.off('message',listener);m.error?reject(Error(m.error)):resolve(m.state);};worker.on('message',listener);worker.postMessage({id:current,type,...extra});});
 const envelope={sequence:1,requestId:'worker-feedback-depart',action:{type:'start-run',region:0,budget:3,auto:false}};
 const departed=await request('command',{envelope});assert.equal(departed.feedback!.cursor,1);assert.equal(departed.feedback!.events[0].kind,'depart');assert.equal((await request('command',{envelope})).feedback!.cursor,1);assert.equal((await request('profile-read')).feedback!.cursor,1);
 await assert.rejects(request('command',{envelope:{sequence:2,requestId:'worker-feedback-invalid',action:{type:'skill',skill:'frost',runId:'run-1',wave:99}}}));assert.equal((await request('profile-read')).feedback!.cursor,1);
 const advanced=await request('advance',{ms:3000});assert.ok(advanced.feedback!.events.some(v=>v.kind==='hurt'&&v.amount===3));assert.equal(Object.hasOwn(JSON.parse(fs.readFileSync(path.join(folder,'profile.json'),'utf8')),'feedback'),false);
 const returned=await request('command',{envelope:{sequence:2,requestId:'worker-feedback-retreat',action:{type:'retreat'}}});const epoch=returned.feedback!.epoch;
 const imported=await request('import-profile',{expectedSequence:2,profile:seed});assert.notEqual(imported.feedback!.epoch,epoch);assert.equal(imported.feedback!.cursor,0);assert.deepEqual(imported.feedback!.events,[]);
 fs.unlinkSync(path.join(folder,'profile.json'));fs.mkdirSync(path.join(folder,'profile.json'));
 await assert.rejects(request('command',{envelope:{sequence:imported.profile!.sequence+1,requestId:'worker-feedback-failed-save',action:{type:'start-run',region:0,budget:3,auto:false}}}),/保存失败/);assert.equal(latest!.status,'blocked');assert.equal(latest!.feedback!.cursor,0);assert.equal(latest!.profile!.run,null);
});

test('stable fight publishes prompt runtime attacks/hurt before five-second checkpoint; explicit flush persists',async t=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'pixelstreet-private-task1-cadence-'));fs.writeFileSync(path.join(folder,'PRIVATE_TEST_PROFILE'),'Task1 deterministic checkpoint test only; no production profile.');
 let seed=ready();seed.wallAt=1000000;seed=act(seed,{type:'start-run',region:0,budget:3,auto:false});seed=tick(seed,10);assert.equal(seed.run!.phase,'fight');new GameStore(folder,seed.wallAt).save(seed);
 // This bootstrap controls only the private test Worker's Date.now. The real
 // 500ms scheduler, progress(), validation, feedback and GameStore all run intact.
 const clock=new BigInt64Array(new SharedArrayBuffer(8));Atomics.store(clock,0,BigInt(seed.wallAt));
 const worker=new Worker("const {workerData}=require('node:worker_threads');const clock=new BigInt64Array(workerData.clock);Date.now=()=>Number(Atomics.load(clock,0));require(workerData.entry);",{eval:true,workerData:{folder,testMode:true,clock:clock.buffer,entry:path.resolve('dist/game-worker.cjs')}});
 t.after(async()=>{await worker.terminate();fs.rmSync(folder,{recursive:true,force:true});});
 const checkpoint=await new Promise<GameState>((resolve,reject)=>{worker.once('error',reject);worker.once('message',m=>resolve(m.state));});assert.equal(checkpoint.status,'ready');assert.equal(checkpoint.feedback!.cursor,0);
 const file=path.join(folder,'profile.json'),bytes=fs.readFileSync(file,'utf8'),backup=fs.readFileSync(file+'.bak','utf8'),inode=fs.statSync(file).ino;
 const runtimePromise=new Promise<GameState>((resolve,reject)=>{const timer=setTimeout(()=>{worker.off('message',listener);reject(Error('private cadence Worker feedback timeout'));},10000);const listener=(m:any)=>{if(m.type!=='state'||m.state.feedback?.cursor<3)return;clearTimeout(timer);worker.off('message',listener);resolve(m.state);};worker.on('message',listener);});
 Atomics.store(clock,0,BigInt(seed.wallAt+2000));const runtime=await runtimePromise;
 assert.equal(runtime.profile!.tick,seed.tick+20);assert.equal(runtime.profile!.run!.phase,'fight');assert.equal(runtime.profile!.totals.wins,seed.totals.wins);assert.deepEqual(runtime.feedback!.events.map(v=>[v.kind,v.amount]),[['attack',6],['attack',6],['hurt',3]]);assert.equal(runtime.feedback!.cursor,3);
 assert.equal(fs.readFileSync(file,'utf8')===bytes,true,'prompt combat feedback must not force a durable profile replacement before the5s checkpoint');assert.equal(fs.readFileSync(file+'.bak','utf8')===backup,true);assert.equal(fs.statSync(file).ino,inode);
 const flushed=await new Promise<GameState>((resolve,reject)=>{const timer=setTimeout(()=>{worker.off('message',listener);reject(Error('private cadence Worker flush timeout'));},10000);const listener=(m:any)=>{if(m.type!=='reply'||m.id!==1)return;clearTimeout(timer);worker.off('message',listener);m.error?reject(Error(m.error)):resolve(m.state);};worker.on('message',listener);worker.postMessage({id:1,type:'flush'});});
 assert.equal(flushed.feedback!.cursor,3);const persisted=JSON.parse(fs.readFileSync(file,'utf8')) as Profile;assert.equal(persisted.tick,runtime.profile!.tick);assert.equal(persisted.run!.enemyHP,runtime.profile!.run!.enemyHP);assert.equal(persisted.run!.hp,runtime.profile!.run!.hp);assert.notEqual(fs.readFileSync(file,'utf8'),bytes);assert.equal(Object.hasOwn(persisted,'feedback'),false);
 // A later actual win requires a durable save. If that save fails, only its
 // current pending batch is discarded; the earlier accepted hit feed remains.
 fs.unlinkSync(file);fs.mkdirSync(file);
 const blockedPromise=new Promise<GameState>((resolve,reject)=>{const timer=setTimeout(()=>{worker.off('message',listener);reject(Error('private cadence Worker save-failure timeout'));},10000);const listener=(m:any)=>{if(m.type!=='state'||m.state.status!=='blocked')return;clearTimeout(timer);worker.off('message',listener);resolve(m.state);};worker.on('message',listener);});
 Atomics.store(clock,0,BigInt(seed.wallAt+4000));const blocked=await blockedPromise;assert.equal(blocked.feedback!.cursor,3);assert.equal(blocked.profile!.tick,runtime.profile!.tick);assert.equal(blocked.profile!.totals.wins,seed.totals.wins);assert.equal(blocked.profile!.run!.enemyHP,runtime.profile!.run!.enemyHP);
});
