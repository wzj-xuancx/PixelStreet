import {parentPort,workerData} from 'node:worker_threads';
import {FixedClock,STEP_MS} from '../../packages/dungeon-core/foundation';
import {createDungeon,dungeonInput,stepDungeon,clearDungeonControls,parseDungeonInput} from '../../packages/dungeon-core';
import {bankedDungeonReward,type DungeonSession} from '../../packages/protocol/dungeon';
import {DungeonStore,type DungeonSave} from './dungeon-store';
const port=parentPort!;const clock=new FixedClock();let store:DungeonStore;
let data:DungeonSave={version:1,claim:0,settled:true,catalog:[],run:null,receipt:null},blocked='',savedAt=0;
let timer:ReturnType<typeof setTimeout>|undefined,nextAt=0,lastAt=0,meterAt=0,meterTicks=0,logicHz=0;
const state=():DungeonSession=>({status:blocked?'blocked':'ready',...data,error:blocked,warnings:store?.warnings??[],logicHz,droppedMs:clock.droppedMs});
const publish=()=>port.postMessage({type:'state',state:state()});
function save():void {try{store.save(data);savedAt=Date.now();}catch(e){blocked='地牢写入失败，已暂停并保留原档：'+String(e);pause();throw Error(blocked);}}
function pause():void {clearTimeout(timer);timer=undefined;clock.reset();lastAt=0;if(data.run){data.run.paused=true;clearDungeonControls(data.run);}}
function active():boolean{return !blocked&&!!data.run&&!data.settled&&!data.run.paused&&data.run.phase==='exploring';}
function schedule():void {if(!active()){clearTimeout(timer);timer=undefined;clock.reset();lastAt=0;return;}if(timer)return;const now=performance.now();if(!lastAt){lastAt=now;nextAt=now+STEP_MS;clock.reset(now);meterAt=now;meterTicks=0;}timer=setTimeout(tick,Math.max(1,Math.ceil(nextAt-now)));}
function tick():void {
 timer=undefined;if(!active())return;const now=performance.now();
 try{
  if(now-lastAt>250){data.run!.notice='检测到长时间停顿，地牢已暂停；点击继续。';pause();save();publish();return;}
  lastAt=now;const oldPhase=data.run!.phase,oldTick=data.run!.tick;
  clock.advance(now,dt=>{stepDungeon(data.run!,dt);meterTicks++;});
  if(now-meterAt>=1000){logicHz=meterTicks*1000/(now-meterAt);meterAt=now;meterTicks=0;}
  if(oldPhase!==data.run!.phase||Date.now()-savedAt>5000)save();
  // One authoritative 60Hz snapshot; render interpolates independently at display cadence.
  if(data.run!.tick!==oldTick)publish();nextAt+=STEP_MS;if(nextAt<now-STEP_MS)nextAt=now+STEP_MS;
 }catch(e){blocked='地牢模拟已暂停：'+String(e);pause();publish();}
 schedule();
}
try{store=new DungeonStore(workerData.folder);data=structuredClone(store.value);}catch(e){blocked=String(e);}publish();
port.on('message',(m:any)=>{
 // Continuous latest-state controls have no state reply, no disk I/O and no render-frequency round trip.
 if(m.type==='control'){
  const input=parseDungeonInput(m.input);if(!blocked&&data.run&&(input?.type==='cancel-controls'||active()&&input?.type==='control'))dungeonInput(data.run,input);return;
 }
 try{
  if(blocked)throw Error(blocked);
  if(m.type==='start'){
   if(data.run&&!data.settled)throw Error('请先结算当前地牢。');
   if(!Number.isSafeInteger(m.seed)||m.seed<1||m.seed>0xffffffff||!Number.isSafeInteger(m.minClaim)||m.minClaim<0||m.minClaim>=1e12-1||data.claim>=1e12-1)throw Error('地牢种子或结算游标无效');
   pause();const run=createDungeon(m.seed);run.paused=true;data={...data,claim:Math.max(data.claim,m.minClaim)+1,settled:false,run};save();
  }else if(m.type==='input'){
   if(!data.run||data.settled)throw Error('没有进行中的地牢。');const input=parseDungeonInput(m.input);if(!input)throw Error('地牢输入无效');
   dungeonInput(data.run,input);if(data.run.paused){clearTimeout(timer);timer=undefined;clock.reset();lastAt=0;}if(input.type!=='control')save();
  }else if(m.type==='pause'){pause();if(data.run)save();}
  else if(m.type==='finish'){
   pause();if(data.run){if(['exploring','upgrade'].includes(data.run.phase)){data.run.phase='lost';data.run.notice='已撤回营地，带回一半已收集奖励。';}save();}
  }else if(m.type==='settled'){
   if(m.claim!==data.claim||!data.run||!['won','lost'].includes(data.run.phase))throw Error('结算游标或地牢阶段不符');
   data.receipt={claim:data.claim,...bankedDungeonReward(data)};data.settled=true;const seen=[...data.run.player.weaponSlots,...data.run.rooms.filter(r=>r.visited).flatMap(r=>r.ground.map(g=>g.weapon))];for(const w of seen)if(w&&!data.catalog.includes(w.kind))data.catalog.push(w.kind);save();
  }else if(m.type==='flush')save();else throw Error('未知地牢操作');
  publish();port.postMessage({type:'reply',id:m.id,state:state()});
 }catch(e){publish();port.postMessage({type:'reply',id:m.id,error:String(e)});}
 finally{schedule();}
});
port.on('close',()=>clearTimeout(timer));
