import fs from 'node:fs';import path from 'node:path';import {spawn} from 'node:child_process';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),project=path.resolve(import.meta.dirname,'..');
/** Fresh marked endpoints only; no personal clipboard. Caller owns cleanup after all children exit. */
export async function startRoomHarness(count=2,options={}){
 if(![1,2,4].includes(count)||count===1&&options.preset!=='pending-claim')throw Error('One pending-preset endpoint or two/four owned room endpoints required');if(options.preset!==undefined&&options.preset!=='pending-claim')throw Error('Unknown owned fixture preset');const peers=[];
 const cleanup=async()=>{for(const p of peers)if(p.child.exitCode===null){try{await p.call('close');}catch{p.child.kill('SIGTERM');}await new Promise(r=>p.child.exitCode!==null?r():p.child.once('exit',r));}for(const p of peers)fs.rmSync(p.folder,{recursive:true,force:true});};
 const launch=async(index,folder)=>{
  const child=spawn(require('electron'),['tests/native-room-0190-bootstrap.cjs'],{cwd:project,env:{...process.env,PIXELSTREET_TEST_DATA:folder,PIXELSTREET_ROOM0190_GO:'1',PIXELSTREET_ROOM0190_INDEX:String(index),PIXELSTREET_ROOM0190_PRESET:options.preset??''},stdio:['ignore','pipe','pipe','ipc']});
  let sequence=0,stderr='',stdout='';const pending=new Map();child.stderr.on('data',b=>{stderr=(stderr+b).slice(-3000);});child.stdout.on('data',b=>{stdout=(stdout+b).slice(-1000);});
  const ready=new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Hidden endpoint startup timeout '+stderr)),30000);child.on('message',m=>{if(m.ready){clearTimeout(timeout);resolve(m);}if(m.fatal)reject(Error(m.fatal));});child.once('exit',code=>{clearTimeout(timeout);for(const p of pending.values())p.reject(Error('Endpoint exited '+code+' '+stderr));pending.clear();if(code)reject(Error('Endpoint exited '+code+' '+stderr));});});
  child.on('message',m=>{const p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error)):p.resolve(m.result);});
  const call=(op,extra={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('Fixture RPC timed out '+op+' '+stderr));},15000);pending.set(id,{resolve,reject,timer});child.send({id,op,...extra});});
  const peer={index,folder,child,call,eval:(script,target='overlay')=>call('eval',{script,target}),expression:(expression,target='overlay')=>call('eval-expression',{expression,target}),logs:()=>({stdout,stderr}),restart:async()=>{if(peer.child.exitCode===null)throw Error('Close or crash this owned endpoint before restarting');const next=await launch(index,folder);Object.assign(peer,next);return peer;}};try{await ready;}catch(error){if(child.exitCode===null)child.kill('SIGTERM');await new Promise(r=>child.exitCode!==null?r():child.once('exit',r));throw error;}return peer;
 };
 try{for(let index=0;index<count;index++){const folder=fs.mkdtempSync('/private/tmp/pixelstreet-room-0190-');fs.writeFileSync(path.join(folder,'.pixelstreet-isolated-profile.json'),JSON.stringify({product:'PixelStreet',kind:'isolated-playtest',version:1})+'\n',{mode:0o600});peers.push(await launch(index,folder));}
 }catch(e){await cleanup();throw e;}
 return {peers,close:cleanup};
}
