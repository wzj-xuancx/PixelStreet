import type {PersonalPartyRequest,PersonalPartyReply,PrivateGameState,Profile} from '../../packages/solo-core';
import {Worker} from 'node:worker_threads';
import path from 'node:path';
import {app} from 'electron';
import type {InventoryPreview} from './inventory-session';
import type {InventoryActionRequest} from '../../packages/solo-core/inventory-actions';
import type {GameEnvelope,GameState} from '../../packages/solo-core';
type Operation='personal-party'|'profile-read'|'inventory-preview'|'inventory-confirm'|'inventory-cancel'|'command'|'flush'|'advance'|'action-reward'|'party-context'|'presentation-context'|'import-profile';
export class GameRuntime {
  state:GameState={status:'loading',profile:null,partySize:1,error:'',warnings:[]};readonly ready:Promise<void>;
  private worker:Worker;private next=0;private pending=new Map<number,{resolve:(s:any)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();private closing=false;private disposed=false;private presentationActive:boolean|undefined;
  private finishReady=()=>{};private closingTask?:Promise<void>;private terminating?:Promise<void>;
  constructor(folder:string,onUpdate:()=>void,testMode=false){
    const file=app.isPackaged?path.join(process.resourcesPath,'game-worker.cjs'):path.join(__dirname,'game-worker.cjs');
    this.worker=new Worker(file,{workerData:{folder,testMode}});this.ready=new Promise(r=>this.finishReady=r);
    const failed=(e:unknown)=>{this.finishReady();if(this.closing){this.rejectPending(Error('应用已关闭：'+String(e)));return;}this.state={...this.state,status:'blocked',profile:null,partySize:this.state.partySize,error:'单机进程已暂停：'+String(e),warnings:[]};this.rejectPending(Error(this.state.error));onUpdate();};
    this.worker.on('error',failed);this.worker.on('exit',code=>{if(this.closing)this.rejectPending(Error('应用已关闭'));else failed(`Worker退出 ${code}`);});
    this.worker.on('message',m=>{
      if(this.disposed)return;
      if(m.type==='state'){if(this.closing)return;this.state=m.state;this.finishReady();onUpdate();}
      else if(m.type==='reply'){const q=this.pending.get(m.id);if(!q)return;clearTimeout(q.timer);this.pending.delete(m.id);if(m.error)q.reject(Error(m.error));else{if(!this.closing)this.state=m.state;q.resolve(m.result??m.state);}}
    });
  }
  private rejectPending(error:Error):void{for(const q of this.pending.values()){clearTimeout(q.timer);q.reject(error);}this.pending.clear();}
  private terminate():Promise<void>{return this.terminating??=this.worker.terminate().then(()=>undefined);}
  private send<T=GameState>(type:Operation,extra:Record<string,unknown>,closingFlush=false):Promise<T>{
    if(this.disposed||this.closing&&!closingFlush)return Promise.reject(Error('应用已关闭'));
    if(this.state.status==='blocked'&&type!=='personal-party'&&type!=='profile-read')return Promise.reject(Error(this.state.error));
    return new Promise((resolve,reject)=>{const id=++this.next,timer=setTimeout(()=>{this.pending.delete(id);reject(Error('单机进程响应超时，请关闭面板后重试。'));},15000);this.pending.set(id,{resolve,reject,timer});try{this.worker.postMessage({type,id,...extra});}catch(e){clearTimeout(timer);this.pending.delete(id);reject(e);}});
  }
  request<T=GameState>(type:Operation,extra:Record<string,unknown>={}):Promise<T>{return this.send<T>(type,extra);}
  /** Main-only fresh Worker read: no timer advancement, commit or renderer IPC. */
  async authoritativeProfile():Promise<Profile>{const state=await this.request<PrivateGameState>('profile-read');if(!state.profile)throw Error('当前进度未就绪');return state.profile;}
  personalParty(personal:PersonalPartyRequest):Promise<PersonalPartyReply>{return this.request<PersonalPartyReply>('personal-party',{personal});}
  /** Main-only scheduling hint. Never exposed as a GameAction or renderer IPC. */
  async setPresentationContext(active:boolean):Promise<void>{if(typeof active!=='boolean')throw Error('呈现状态无效');if(this.presentationActive===active)return;const previous=this.presentationActive;this.presentationActive=active;try{await this.request('presentation-context',{active});}catch(e){if(this.presentationActive===active)this.presentationActive=previous;throw e;}}
  command(envelope:GameEnvelope):Promise<GameState>{return this.request('command',{envelope});}
  inventoryPreview(generation:number,request:InventoryActionRequest):Promise<InventoryPreview>{return this.request<InventoryPreview>('inventory-preview',{generation,request});}
  inventoryConfirm(generation:number,token:string):Promise<GameState>{return this.request('inventory-confirm',{generation,token});}
  inventoryCancel(token?:string):void{void this.request('inventory-cancel',{token}).catch(()=>undefined);}
  close():Promise<void>{
    if(this.closingTask)return this.closingTask;
    if(this.disposed)return this.terminate();
    this.closing=true;this.finishReady();
    // The private flush reply must still settle while all public state publication is stopped.
    return this.closingTask=(async()=>{try{await this.send('flush',{},true);}finally{this.disposed=true;this.rejectPending(Error('应用已关闭'));await this.terminate();}})();
  }
  dispose():void{if(this.disposed)return;this.closing=true;this.disposed=true;this.finishReady();this.rejectPending(Error('应用已关闭'));void this.terminate().catch(()=>undefined);}
}
