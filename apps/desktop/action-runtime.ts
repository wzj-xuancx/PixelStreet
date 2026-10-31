import {Worker} from 'node:worker_threads';
import path from 'node:path';
import {app} from 'electron';
import type {ActionInput,ActionState,Weapon} from '../../packages/action-core';
import type {ActionSession,ActionSource} from '../../packages/protocol/action';
import type {GameRuntime} from './game-runtime';

type Operation='start'|'input'|'pause'|'finish'|'settled'|'flush'|'room-start'|'room-active'|'host-input'|'mirror';
export class ActionRuntime {
 state:ActionSession={status:'loading',run:null,claim:0,settled:true,source:null,localPlayerId:'local',error:'',warnings:[]};
 readonly ready:Promise<void>;
 private worker:Worker;
 private next=0;
 private closing=false;
 private settling?:Promise<ActionSession>;
 private pending=new Map<number,{resolve:(v:ActionSession)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
 constructor(folder:string,private game:GameRuntime,private onUpdate:()=>void){
  const file=app.isPackaged?path.join(process.resourcesPath,'action-worker.cjs'):path.join(__dirname,'action-worker.cjs');
  this.worker=new Worker(file,{workerData:{folder}});let ready!:()=>void;this.ready=new Promise(r=>ready=r);
  const fail=(e:unknown)=>{
   if(this.closing)return;this.state={...this.state,status:'blocked',error:'主动冒险进程暂停：'+String(e)};ready();
   for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error(this.state.error));}this.pending.clear();onUpdate();
  };
  this.worker.on('error',fail);this.worker.on('exit',c=>{if(!this.closing)fail(`Worker退出${c}`);});
  this.worker.on('message',m=>{
   if(m.type==='state'){this.state=m.state;ready();onUpdate();}
   else if(m.type==='reply'){
    const p=this.pending.get(m.id);if(!p)return;clearTimeout(p.timer);this.pending.delete(m.id);
    if(m.error)p.reject(Error(m.error));else{this.state=m.state;p.resolve(this.state);}
   }
  });
 }
 request(type:Operation,extra:Record<string,unknown>={}):Promise<ActionSession>{
  if(this.state.status==='blocked')return Promise.reject(Error(this.state.error));
  if(this.closing)return Promise.reject(Error('主动冒险已关闭'));
  return new Promise((resolve,reject)=>{
   const id=++this.next,timer=setTimeout(()=>{this.pending.delete(id);reject(Error('主动冒险响应超时'));},15000);
   this.pending.set(id,{resolve,reject,timer});this.worker.postMessage({type,id,...extra});
  });
 }
 private canStart():void {
  if(this.game.state.status!=='ready'||!this.game.state.profile)throw Error('请先恢复营地存档');
  if(this.game.state.profile.run)throw Error('请先回营结算挂机远征，再进入主动冒险。');
 }
 start(weapon:Weapon):Promise<ActionSession>{this.canStart();return this.request('start',{weapon,minClaim:this.game.state.profile!.actionClaim});}
 startRoom(hostId:string,players:{id:string;weapon:Weapon}[]):Promise<ActionSession>{this.canStart();return this.request('room-start',{hostId,players,minClaim:this.game.state.profile!.actionClaim});}
 input(input:ActionInput):Promise<ActionSession>{return this.request('input',{input});}
 hostInput(playerId:string,input:ActionInput):Promise<ActionSession>{return this.request('host-input',{playerId,input});}
 active(ids:readonly string[]):Promise<ActionSession>{return this.request('room-active',{ids:[...ids]});}
 pause():Promise<ActionSession>{return this.request('pause');}
 async mirror(source:ActionSource,run:ActionState):Promise<ActionSession>{
  const old=this.state.source;
  if(old?.role==='guest'&&old.hostId===source.hostId&&old.sequence!==source.sequence&&!this.state.settled)await this.settle();
  if(this.game.state.status!=='ready'||!this.game.state.profile)throw Error('营地档案尚未就绪，已保留房间状态。');
  return this.request('mirror',{source,run,minClaim:this.game.state.profile.actionClaim});
 }
 settle():Promise<ActionSession>{
  if(this.settling)return this.settling;
  this.settling=(async()=>{
   await this.request('finish');const s=this.state;if(!s.run||s.settled)return s;
   const remote=s.source?{hostId:s.source.hostId,sequence:s.source.sequence}:undefined;
   await this.game.request('action-reward',{claim:s.claim,coins:s.run.reward.coins,xp:s.run.reward.xp,...(remote?{remote}:{})});
   return this.request('settled',{claim:s.claim});
  })().finally(()=>{this.settling=undefined;});return this.settling;
 }
 async close():Promise<void>{try{await this.request('pause');}finally{this.closing=true;await this.worker.terminate();}}
 dispose():void{this.closing=true;for(const q of this.pending.values()){clearTimeout(q.timer);q.reject(Error('应用已关闭'));}this.pending.clear();void this.worker.terminate();}
}
