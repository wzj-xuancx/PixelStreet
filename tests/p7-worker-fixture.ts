import fs from 'node:fs';
import path from 'node:path';
import {Worker} from 'node:worker_threads';
export function workerFixture(folder:string){
 fs.mkdirSync(folder,{recursive:true,mode:0o700});fs.writeFileSync(path.join(folder,'P7-ISOLATED-TEST'),String(process.pid));
 const worker=new Worker(path.resolve(__dirname,'../game-worker.cjs'),{workerData:{folder,testMode:true}});let id=0;const pending=new Map<number,{resolve:(s:any)=>void;reject:(e:Error)=>void}>();
 let first!:(v:unknown)=>void;const ready=new Promise(r=>first=r);const game:any={state:{status:'loading',profile:null},ready,request:(type:string,extra:any={})=>new Promise((resolve,reject)=>{const next=++id;pending.set(next,{resolve,reject});worker.postMessage({id:next,type,...extra});}),authoritativeProfile:async()=>{const state:any=await game.request('profile-read');if(state.status!=='ready'||!state.profile)throw Error('not ready');return state.profile;}};
 worker.on('message',m=>{if(m.type==='state'){game.state=m.state;first(m.state);}else if(m.type==='reply'){const p=pending.get(m.id);if(!p)return;pending.delete(m.id);if(m.error)p.reject(Error(m.error));else{game.state=m.state;p.resolve(m.result??m.state);}}});
 worker.on('error',error=>{for(const p of pending.values())p.reject(error);pending.clear();});
 return {game,worker,close:async()=>{await worker.terminate();}};
}
