import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {DungeonStore,parseDungeonSave} from '../apps/desktop/dungeon-store';
import {GameplayGate} from '../apps/desktop/gameplay-gate';
import {legacyDungeonFixture} from './dungeon-legacy-fixture';
import {createDungeon,parseDungeonRun} from '../packages/dungeon-core';
import {initialProfile,grantActionReward} from '../packages/solo-core';

type WorkerReply<T>={type:'reply';id:number;state:T;error?:string};
type StateMessage<T>={type:'state';state:T};
let nextId=0;
const workerFile=(name:string):string=>{
 const configured=process.env[`PIXELSTREET_${name.toUpperCase().replaceAll('-','_')}_WORKER`];
 if(configured)return configured;
 return path.resolve(__dirname,`../${name}-worker.cjs`);
};
const tempFolder=(prefix:string):string=>fs.mkdtempSync(path.join(os.tmpdir(),`pixelstreet-${prefix}-`));
const cleanup=(folder:string):void=>fs.rmSync(folder,{recursive:true,force:true});
const sha=(file:string):string=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function ready<T>(worker:Worker,timeoutMs=5000):Promise<T>{return new Promise((resolve,reject)=>{
 const timer=setTimeout(()=>{worker.off('message',onMessage);reject(Error('worker initial state timeout'));},timeoutMs);
 const onMessage=(message:unknown)=>{const m=message as StateMessage<T>;if(m?.type==='state'&&m.state){clearTimeout(timer);worker.off('message',onMessage);resolve(m.state);}};
 worker.on('message',onMessage);
});}
function request<T>(worker:Worker,type:string,extra:Record<string,unknown>={},timeoutMs=5000):Promise<T>{return new Promise((resolve,reject)=>{
 const id=++nextId;
 const timer=setTimeout(()=>{worker.off('message',onMessage);reject(Error(`${type} worker request timeout`));},timeoutMs);
 const onMessage=(message:unknown)=>{const m=message as WorkerReply<T>;if(m?.type!=='reply'||m.id!==id)return;clearTimeout(timer);worker.off('message',onMessage);if(m.error)reject(Error(m.error));else resolve(m.state);};
 worker.on('message',onMessage);worker.postMessage({type,id,...extra});
});}
function untilState<T>(worker:Worker,predicate:(state:T)=>boolean,timeoutMs=5000):Promise<T>{return new Promise((resolve,reject)=>{
 const timer=setTimeout(()=>{worker.off('message',onMessage);reject(Error('worker state predicate timeout'));},timeoutMs);
 const onMessage=(message:unknown)=>{const m=message as StateMessage<T>;if(m?.type==='state'&&predicate(m.state)){clearTimeout(timer);worker.off('message',onMessage);resolve(m.state);}};
 worker.on('message',onMessage);
});}
async function startWorker(file:string,folder:string):Promise<{worker:Worker;state:Record<string,any>}>{
 const worker=new Worker(file,{workerData:{folder}});
 return{worker,state:await ready<Record<string,any>>(worker)};
}
async function stop(...workers:Worker[]):Promise<void>{await Promise.all(workers.map(w=>w.terminate()));}

test('dungeon persistence is isolated, strict, fail-closed and backup-recoverable',()=>{
 const root=tempFolder('dungeon-store-r2');
 try{
  const legacy=path.join(root,'action-run.json');fs.writeFileSync(legacy,'legacy sentinel\n',{mode:0o600});
  const store=new DungeonStore(root);
  assert.equal(fs.readFileSync(legacy,'utf8'),'legacy sentinel\n');
  assert.equal(fs.statSync(store.file).mode&0o777,0o600);
  const originalRun=createDungeon(17);originalRun.paused=false;originalRun.player.moveX=1;originalRun.player.firing=true;
  store.save({...store.value,claim:1,settled:false,run:originalRun});
  assert.equal(originalRun.paused,false);assert.equal(originalRun.player.moveX,1);assert.equal(originalRun.player.firing,true,'save sanitizes a cloned snapshot, not the live caller run');
  assert.equal(store.value.run?.paused,true);assert.equal(store.value.run?.player.moveX,0);assert.equal(store.value.run?.player.firing,false);
  assert.throws(()=>parseDungeonSave({...store.value,settled:true}),/结算游标或阶段无效/);
  const old={...store.value} as Record<string,unknown>;delete old.receipt;
  assert.equal(parseDungeonSave(old).receipt,null,'pre-receipt v1 saves remain readable');

  store.save({...store.value,claim:2,settled:false,run:createDungeon(18)});
  fs.writeFileSync(store.file,'corrupt main\n');
  const recovered=new DungeonStore(root);
  assert.equal(recovered.value.claim,1,'the immediately preceding valid checkpoint is restored');
  assert.equal(fs.readFileSync(recovered.file,'utf8'),'corrupt main\n','corrupt primary remains available for diagnosis');
  assert.ok(recovered.warnings.some(x=>x.includes('备份')));

  const broken=path.join(root,'broken');fs.mkdirSync(broken);
  const main=path.join(broken,'dungeon-run.json');fs.writeFileSync(main,'bad main');fs.writeFileSync(main+'.bak','bad backup');
  assert.throws(()=>new DungeonStore(broken),/已停止，不会清空/);
  assert.equal(fs.readFileSync(main,'utf8'),'bad main');assert.equal(fs.readFileSync(main+'.bak','utf8'),'bad backup');
 }finally{cleanup(root);}
});

test('continuous controls do not save per frame; pause checkpoints neutral controls',async()=>{
 const root=tempFolder('dungeon-controls-r2');const folder=path.join(root,'solo');fs.mkdirSync(folder);
 let worker:Worker|undefined;
 try{
  const started=await startWorker(workerFile('dungeon'),folder);worker=started.worker;
  assert.equal(started.state.status,'ready');
  const run=await request<Record<string,any>>(worker,'start',{seed:54321,minClaim:0});assert.equal(run.claim,1);
  const active=await request<Record<string,any>>(worker,'input',{input:{type:'pause',paused:false}});
  const file=path.join(folder,'dungeon-run.json'),before=sha(file),tick=active.run.tick,startX=active.run.player.x;
  const movedPromise=untilState<Record<string,any>>(worker,s=>s.run?.tick>=tick+2);
  const input={type:'control',moveX:1,moveY:0,aimX:500,aimY:264,firing:true};
  for(let i=0;i<8;i++)worker.postMessage({type:'control',input});
  const moved=await movedPromise;await new Promise(r=>setTimeout(r,100));
  assert.ok(moved.run.tick>=tick+2);assert.ok(moved.run.player.x>startX);
  assert.equal(sha(file),before,'control messages leave the persisted checkpoint byte-identical');
  const paused=await request<Record<string,any>>(worker,'pause');
  assert.equal(paused.run.paused,true);assert.equal(paused.run.player.moveX,0);assert.equal(paused.run.player.firing,false);
  assert.notEqual(sha(file),before,'pause persists the latest neutral state');
 }finally{if(worker)await stop(worker);cleanup(root);}
});

test('terminal dungeon writes a receipt, preserves it into the next run, and replays reward idempotently after profile backup rollback',async()=>{
 const root=tempFolder('dungeon-receipt-r2'),dungeonFolder=path.join(root,'dungeon'),gameFolder=path.join(root,'solo');fs.mkdirSync(dungeonFolder);fs.mkdirSync(gameFolder);
 let dungeonWorker:Worker|undefined,gameWorker:Worker|undefined,recoveredWorker:Worker|undefined;
 try{
  const ds=new DungeonStore(dungeonFolder),run=parseDungeonRun({...legacyDungeonFixture(createDungeon(993)),phase:'lost',reward:{coins:21,xp:5}})!;
  ds.save({...ds.value,claim:2,settled:false,run,receipt:null});
  const d=await startWorker(workerFile('dungeon'),dungeonFolder);dungeonWorker=d.worker;
  const settled=await request<Record<string,any>>(dungeonWorker,'settled',{claim:2});
  assert.deepEqual(settled.receipt,{claim:2,coins:10,xp:2});
  const next=await request<Record<string,any>>(dungeonWorker,'start',{seed:994,minClaim:2});
  assert.equal(next.claim,3);assert.deepEqual(next.receipt,settled.receipt);
  await stop(dungeonWorker);dungeonWorker=undefined;
  const persisted=parseDungeonSave(JSON.parse(fs.readFileSync(ds.file,'utf8')));
  assert.deepEqual(persisted.receipt,settled.receipt,'receipt survives process restart and later run creation');

  const baseline=grantActionReward(initialProfile(1000),1,0,0);
  fs.writeFileSync(path.join(gameFolder,'profile.json'),JSON.stringify(baseline)+'\n',{mode:0o600});
  const g=await startWorker(workerFile('game'),gameFolder);gameWorker=g.worker;
  const first=await request<Record<string,any>>(gameWorker,'action-reward',settled.receipt);
  assert.equal(first.profile.actionClaim,2);assert.equal(first.profile.coins,baseline.coins+10);assert.equal(first.profile.xp,baseline.xp+2);
  assert.equal(JSON.parse(fs.readFileSync(path.join(gameFolder,'profile.json.bak'),'utf8')).actionClaim,1);
  await stop(gameWorker);gameWorker=undefined;
  fs.writeFileSync(path.join(gameFolder,'profile.json'),'corrupt primary\n');
  const restored=await startWorker(workerFile('game'),gameFolder);recoveredWorker=restored.worker;
  assert.equal(restored.state.profile.actionClaim,1,'GameStore falls back to the prior valid high-water mark');
  assert.ok(restored.state.warnings.some((x:string)=>x.includes('备份')));
  const replay=await request<Record<string,any>>(recoveredWorker,'action-reward',settled.receipt);
  const duplicate=await request<Record<string,any>>(recoveredWorker,'action-reward',settled.receipt);
  assert.equal(replay.profile.actionClaim,2);assert.equal(replay.profile.coins,baseline.coins+10);assert.equal(replay.profile.xp,baseline.xp+2);
  assert.equal(duplicate.profile.coins,replay.profile.coins);assert.equal(duplicate.profile.xp,replay.profile.xp);
 }finally{await stop(...[dungeonWorker,gameWorker,recoveredWorker].filter(Boolean) as Worker[]);cleanup(root);}
});

test('shared GameplayGate serializes real Action and Dungeon Worker starts and a rejected entrant does not poison the queue',async()=>{
 const root=tempFolder('gameplay-gate-r2'),actionFolder=path.join(root,'action'),dungeonFolder=path.join(root,'dungeon'),gameFolder=path.join(root,'solo');
 for(const folder of [actionFolder,dungeonFolder,gameFolder])fs.mkdirSync(folder);
 let actionWorker:Worker|undefined,dungeonWorker:Worker|undefined,gameWorker:Worker|undefined;
 try{
  const [a,d,g]=await Promise.all([startWorker(workerFile('action'),actionFolder),startWorker(workerFile('dungeon'),dungeonFolder),startWorker(workerFile('game'),gameFolder)]);
  actionWorker=a.worker;dungeonWorker=d.worker;gameWorker=g.worker;
  let action=a.state,dungeon=d.state,game=g.state;
  const gate=new GameplayGate(),arenaVisible=true,arenaFocused=true,notInRoom=true;
  const actionStart=()=>gate.run(async()=>{
   if(dungeon.run&&!dungeon.settled)throw Error('请先结算地牢');
   if(!notInRoom||!arenaVisible)throw Error('主动冒险当前不可用');
   action=await request<Record<string,any>>(actionWorker!,'start',{weapon:'wand',minClaim:game.profile.actionClaim});
   if(arenaFocused)action=await request<Record<string,any>>(actionWorker!,'input',{input:{type:'pause',paused:false}});
   return action;
  });
  const dungeonStart=()=>gate.run(async()=>{
   if(action.run&&!action.settled)throw Error('请先结算旧版主动冒险');
   if(!notInRoom||!arenaVisible||!arenaFocused)throw Error('请先点击地牢窗口');
   dungeon=await request<Record<string,any>>(dungeonWorker!,'start',{seed:98765,minClaim:action.claim});
   if(arenaFocused)dungeon=await request<Record<string,any>>(dungeonWorker!,'input',{input:{type:'pause',paused:false}});
   return dungeon;
  });

  const simultaneous=await Promise.allSettled([actionStart(),dungeonStart()]);
  assert.equal(simultaneous[0].status,'fulfilled');assert.equal(simultaneous[1].status,'rejected');
  assert.equal(action.claim,1);assert.equal(dungeon.claim,0);assert.equal(action.settled,false);

  action=await request<Record<string,any>>(actionWorker,'finish');
  game=await request<Record<string,any>>(gameWorker,'action-reward',{claim:action.claim,coins:action.run.reward.coins,xp:action.run.reward.xp});
  action=await request<Record<string,any>>(actionWorker,'settled',{claim:action.claim});
  const dungeonResult=await dungeonStart();assert.equal(dungeonResult.claim,2);assert.equal(dungeonResult.settled,false);
  const competingAction=await Promise.allSettled([actionStart()]);assert.equal(competingAction[0].status,'rejected');
  assert.equal(action.claim,1);assert.equal(dungeon.claim,2);
  dungeon=await gate.run(()=>request<Record<string,any>>(dungeonWorker!,'pause'));
  assert.equal(dungeon.run.paused,true,'the gate continues after an expected command rejection');
 }finally{await stop(...[actionWorker,dungeonWorker,gameWorker].filter(Boolean) as Worker[]);cleanup(root);}
});
