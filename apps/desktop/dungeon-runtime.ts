import {Worker} from 'node:worker_threads';
import path from 'node:path';
import {app} from 'electron';
import type {DungeonInput} from '../../packages/dungeon-core';
import {bankedDungeonReward,emptyDungeon,type DungeonSession} from '../../packages/protocol/dungeon';
import type {GameRuntime} from './game-runtime';
export class DungeonRuntime {
 state=emptyDungeon();readonly ready:Promise<void>;private worker:Worker;private next=0;private closing=false;private settling?:Promise<DungeonSession>;
 private pending=new Map<number,{resolve:(s:DungeonSession)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
 constructor(folder:string,private game:GameRuntime,onUpdate:()=>void){
  const file=app.isPackaged?path.join(process.resourcesPath,'dungeon-worker.cjs'):path.join(__dirname,'dungeon-worker.cjs');this.worker=new Worker(file,{workerData:{folder}});
  let ready!:()=>void;this.ready=new Promise(r=>ready=r);
  const fail=(e:unknown)=>{if(this.closing)return;this.state={...this.state,status:'blocked',error:'地牢进程暂停：'+String(e)};ready();for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error(this.state.error));}this.pending.clear();onUpdate();};
  this.worker.on('error',fail);this.worker.on('exit',c=>{if(!this.closing)fail(`Worker退出${c}`);});
  this.worker.on('message',m=>{if(m.type==='state'){this.state=m.state;ready();onUpdate();}else if(m.type==='reply'){const p=this.pending.get(m.id);if(!p)return;clearTimeout(p.timer);this.pending.delete(m.id);if(m.error)p.reject(Error(m.error));else{this.state=m.state;p.resolve(this.state);}}});
 }
 request(type:'start'|'input'|'pause'|'finish'|'settled'|'flush',extra:Record<string,unknown>={}):Promise<DungeonSession>{
  if(this.closing||this.state.status==='blocked')return Promise.reject(Error(this.state.error||'地牢已关闭'));
  return new Promise((resolve,reject)=>{const id=++this.next,timer=setTimeout(()=>{this.pending.delete(id);reject(Error('地牢响应超时'));},15000);this.pending.set(id,{resolve,reject,timer});this.worker.postMessage({type,id,...extra});});
 }
 async reconcile():Promise<void>{await Promise.all([this.ready,this.game.ready]);const q=this.state.receipt;if(q&&this.game.state.profile&&this.game.state.profile.actionClaim<q.claim)await this.game.request('action-reward',q);}
 async start(seed:number,minClaim:number):Promise<DungeonSession>{await this.reconcile();if(this.game.state.status!=='ready'||!this.game.state.profile)throw Error('营地档案尚未就绪');if(this.game.state.profile.run)throw Error('请先结算挂机远征');return this.request('start',{seed,minClaim:Math.max(minClaim,this.game.state.profile.actionClaim)});}
 control(input:Extract<DungeonInput,{type:'control'|'cancel-controls'}>):void{if(!this.closing&&this.state.status==='ready')this.worker.postMessage({type:'control',input});}
 input(input:DungeonInput):Promise<DungeonSession>{return this.request('input',{input});}
 pause():Promise<DungeonSession>{return this.request('pause');}
 settle():Promise<DungeonSession>{if(this.settling)return this.settling;this.settling=(async()=>{await this.reconcile();await this.request('finish');if(this.state.settled||!this.state.run)return this.state;const reward=bankedDungeonReward(this.state);await this.game.request('action-reward',{claim:this.state.claim,...reward});return this.request('settled',{claim:this.state.claim});})().finally(()=>{this.settling=undefined;});return this.settling;}
 async close():Promise<void>{try{await this.pause();}finally{this.closing=true;await this.worker.terminate();}}
 dispose():void{this.closing=true;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('应用已关闭'));}this.pending.clear();void this.worker.terminate();}
}
