import {parentPort,workerData} from 'node:worker_threads';
import {createActionRun,actionInput,clearActionControls,parseActionInput,parseActionState,setActionPlayerWeapon,stepAction,type Weapon} from '../../packages/action-core';
import {parseActionSource,type ActionSession} from '../../packages/protocol/action';
import {ActionStore,type ActionSave} from './action-store';

const port=parentPort!;
let store:ActionStore,data:ActionSave={version:2,claim:0,settled:true,run:null,source:null},blocked='',savedAt=0;
let activeIds:string[]=[];
const state=():ActionSession=>({status:blocked?'blocked':'ready',run:data.run,claim:data.claim,settled:data.settled,source:data.source,localPlayerId:data.source?.playerId??'local',error:blocked,warnings:store?.warnings??[]});
const publish=()=>port.postMessage({type:'state',state:state()});
const validId=(x:unknown):x is string=>typeof x==='string'&&/^[a-f0-9]{32}$/.test(x);
const validWeapon=(x:unknown):x is Weapon=>typeof x==='string'&&['wand','bow','scatter'].includes(x);
function claimAfter(min:unknown):number {
 if(typeof min!=='number'||!Number.isSafeInteger(min)||min<0||min>=1e12||data.claim>=1e12)throw Error('冒险结算游标无效');
 return Math.max(data.claim,min)+1;
}
function save():void {
 try{store.save(data);savedAt=Date.now();}
 catch(e){blocked='主动冒险保存失败，已暂停：'+String(e);if(data.run){data.run.paused=true;data.run.carryMs=0;clearActionControls(data.run);}throw Error(blocked);}
}
function requireEmpty():void{if(data.run&&!data.settled)throw Error('请先结算当前冒险，再开始下一次。');}
try{store=new ActionStore(workerData.folder);data=structuredClone(store.value);}catch(e){blocked=String(e);}publish();
let timer:ReturnType<typeof setTimeout>|undefined;
const shouldTick=()=>!blocked&&!!data.run&&!data.run.paused&&data.run.phase==='playing'&&data.source?.role!=='guest';
function schedule():void {
 if(!shouldTick()){clearTimeout(timer);timer=undefined;return;}
 if(!timer)timer=setTimeout(tick,50);
}
function tick():void {
 timer=undefined;
 if(!shouldTick())return;
 try{
  const phase=data.run!.phase;stepAction(data.run!,50,data.source?.role==='host'?activeIds:undefined);
  if(data.run!.phase!==phase||Date.now()-savedAt>5000)save();publish();
 }catch(e){blocked='主动战斗已暂停：'+String(e);if(data.run){data.run.paused=true;data.run.carryMs=0;clearActionControls(data.run);}publish();}
 schedule();
}
schedule();
port.on('message',(m:any)=>{
 try{
  if(blocked)throw Error(blocked);
  if(m.type==='start'){
   if(!validWeapon(m.weapon))throw Error('冒险武器无效');requireEmpty();
   const claim=claimAfter(m.minClaim),run=createActionRun((Date.now()>>>0)||1,m.weapon,['local']);run.paused=true;
   activeIds=[];data={version:2,claim,settled:false,run,source:null};save();
  }else if(m.type==='room-start'){
   requireEmpty();
   if(!validId(m.hostId)||!Array.isArray(m.players)||!m.players.length||m.players.length>4||m.players.some((p:any)=>!p||!validId(p.id)||!validWeapon(p.weapon)||Object.keys(p).sort().join(',')!=='id,weapon')||new Set(m.players.map((p:any)=>p.id)).size!==m.players.length||!m.players.some((p:any)=>p.id===m.hostId))throw Error('房间参与成员无效');
   const claim=claimAfter(m.minClaim),run=createActionRun((Date.now()>>>0)||1,m.players[0].weapon,m.players.map((p:any)=>p.id));
   for(const p of m.players)setActionPlayerWeapon(run,p.id,p.weapon);run.paused=true;activeIds=[];
   data={version:2,claim,settled:false,run,source:{hostId:m.hostId,sequence:claim,role:'host',playerId:m.hostId}};save();
  }else if(m.type==='room-active'){
   if(data.source?.role!=='host'||!data.run||data.settled)throw Error('没有房主战斗');
   if(!Array.isArray(m.ids)||m.ids.length>4||new Set(m.ids).size!==m.ids.length||m.ids.some((id:unknown)=>!validId(id)||!data.run!.players.some(p=>p.id===id)))throw Error('活跃成员无效');
   const next=m.ids as string[];
   for(const p of data.run.players)if(!next.includes(p.id)){p.path=[];p.lockedEnemy=null;p.targetX=p.x;p.targetY=p.y;p.moveX=0;p.moveY=0;p.firing=false;}
   data.run.projectiles=data.run.projectiles.filter(p=>!data.run!.players.some(x=>x.id===p.owner)||next.includes(p.owner));
   activeIds=[...next];data.run.paused=activeIds.length===0;data.run.carryMs=0;if(!activeIds.length)clearActionControls(data.run);save();
  }else if(m.type==='host-input'){
   if(data.source?.role!=='host'||!data.run||data.settled||!validId(m.playerId)||!activeIds.includes(m.playerId))throw Error('该成员不在活跃战斗中');
   const input=parseActionInput(m.input);
   if(input.type==='pause'||input.type==='upgrade'&&m.playerId!==data.source.playerId)throw Error('只有房主可选择关间强化，暂离使用房间状态');
   actionInput(data.run,m.playerId,input);if(input.type==='upgrade')save();
  }else if(m.type==='mirror'){
   const source=parseActionSource(m.source),run=parseActionState(m.run);
   if(source.role!=='guest'||!run.players.some(p=>p.id===source.playerId))throw Error('客机镜像身份无效');
   const same=data.source?.role==='guest'&&data.source.hostId===source.hostId&&data.source.sequence===source.sequence&&data.source.playerId===source.playerId;
   if(same){
    if(!data.settled){
     if(!data.run||run.runId!==data.run.runId||run.seed!==data.run.seed||run.players.map(p=>p.id).sort().join(',')!==data.run.players.map(p=>p.id).sort().join(',')||run.tick<data.run.tick||run.kills<data.run.kills||run.reward.coins<data.run.reward.coins||run.reward.xp<data.run.reward.xp||['won','lost'].includes(data.run.phase)&&run.phase!==data.run.phase)throw Error('房主快照发生倒退或更换了本局身份');
     const shouldSave=run.phase!==data.run.phase||run.reward.coins!==data.run.reward.coins||run.reward.xp!==data.run.reward.xp||Date.now()-savedAt>5000;
     data.run=run;if(shouldSave)save();
    }
   }else{
    requireEmpty();const claim=claimAfter(m.minClaim);data={version:2,claim,settled:false,source,run};save();
   }
  }else if(m.type==='input'){
   if(!data.run||data.settled||data.source)throw Error('请从当前房间或进行中的单机冒险操作');
   const input=parseActionInput(m.input);actionInput(data.run,'local',input);if(input.type==='pause'||input.type==='upgrade')save();
  }else if(m.type==='finish'){
   if(data.run){activeIds=[];data.run.paused=true;data.run.carryMs=0;clearActionControls(data.run);if(data.run.phase==='playing'||data.run.phase==='upgrade'){data.run.phase='lost';data.run.notice='已主动回营，保留已获得的战利品。';}save();}
  }else if(m.type==='settled'){
   if(m.claim!==data.claim)throw Error('结算号已过期');data.settled=true;save();
  }else if(m.type==='pause'){
   if(data.run){activeIds=[];data.run.paused=true;data.run.carryMs=0;clearActionControls(data.run);save();}
  }else if(m.type==='flush')save();else throw Error('未知主动Worker操作');
  publish();port.postMessage({type:'reply',id:m.id,state:state()});
 }catch(e){publish();port.postMessage({type:'reply',id:m.id,error:String(e)});}
 finally{schedule();}
});
port.on('close',()=>clearTimeout(timer));
