import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {Worker} from 'node:worker_threads';
import {createActionRun,parseActionState} from '../packages/action-core';
import {ActionStore,parseActionSave} from '../apps/desktop/action-store';
import {installationId} from '../apps/desktop/identity-store';
import {parseCommand} from '../packages/protocol';
import {parseClientRoomMessage,parseHostRoomMessage,parseRoomCommand} from '../packages/protocol/room';
import type {ActionSession} from '../packages/protocol/action';
const host='1'.repeat(32),guest='2'.repeat(32);
const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms));
function folder(t:any){const f=fs.mkdtempSync(path.join(os.tmpdir(),'pixelstreet-action-room-'));t.after(()=>fs.rmSync(f,{recursive:true,force:true}));return f;}
function worker(f:string,t:any){
 const w=new Worker(path.resolve(__dirname,'../action-worker.cjs'),{workerData:{folder:f}});let state:ActionSession;let next=0;const pending=new Map<number,{resolve:(x:ActionSession)=>void;reject:(e:Error)=>void}>();
 const ready=new Promise<void>(resolve=>{w.on('message',m=>{if(m.type==='state'){state=m.state;resolve();}else if(m.type==='reply'){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error)):p.resolve(m.state);}}});});
 w.on('error',e=>{for(const p of pending.values())p.reject(e);pending.clear();});t.after(()=>w.terminate());
 return {ready,get state(){return state;},async request(type:string,extra:Record<string,unknown>={}){await ready;return new Promise<ActionSession>((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});w.postMessage({type,id,...extra});});}};
}
test('action v1 migration preserves raw bytes, while cold room saves are claimable and never resume offline',t=>{
 const f=folder(t),run=createActionRun(25,'bow',[host,guest]);const raw=JSON.stringify({version:1,claim:1,settled:false,run});fs.writeFileSync(path.join(f,'action-run.json'),raw);
 const store=new ActionStore(f);assert.equal(store.value.version,2);assert.equal(store.value.source,null);assert.equal(fs.readFileSync(path.join(f,'action-run.v1-before-migration.json'),'utf8'),raw);
 run.paused=false;store.save({version:2,claim:2,settled:false,run,source:{hostId:host,sequence:2,role:'host',playerId:host}});assert.equal(run.paused,false);
 const cold=new ActionStore(f).value;assert.equal(cold.run!.phase,'lost');assert.equal(cold.run!.paused,true);assert.deepEqual(cold.run!.reward,run.reward);assert.equal(cold.source!.sequence,2);
 assert.throws(()=>parseActionSave({...cold,source:{...cold.source,playerId:'3'.repeat(32)}}));assert.throws(()=>parseActionSave({...cold,source:{...cold.source,sequence:3}}));
});
test('room Worker applies individual weapons and activity, rejects away input and freezes only with no active member',async t=>{
 const w=worker(folder(t),t);await w.ready;
 await w.request('room-start',{hostId:host,minClaim:0,players:[{id:host,weapon:'wand'},{id:guest,weapon:'bow'}]});
 assert.deepEqual(w.state.run!.players.map(p=>p.weapon),['wand','bow']);assert.equal(w.state.source!.role,'host');assert.equal(w.state.run!.paused,true);
 await w.request('room-active',{ids:[host]});await delay(160);assert.ok(w.state.run!.tick>=2);const away=structuredClone(w.state.run!.players[1]);
 for(const input of [{type:'move',x:400,y:400},{type:'skill',skill:'nova'},{type:'skill',skill:'ward'},{type:'dash',x:500,y:400},{type:'lock',enemyId:'enemy-1'}])await assert.rejects(w.request('host-input',{playerId:guest,input}),/不在活跃战斗中/);
 await delay(100);assert.deepEqual(w.state.run!.players[1],away);assert.equal(w.state.run!.reward.coins,0);assert.equal(w.state.run!.reward.xp,0);
 await w.request('room-active',{ids:[]});const tick=w.state.run!.tick;await delay(150);assert.equal(w.state.run!.tick,tick);assert.equal(w.state.run!.paused,true);
 await assert.rejects(w.request('room-active',{ids:[host,host]}));assert.equal(w.state.run!.tick,tick);
 await w.request('room-active',{ids:[guest]});await delay(100);assert.ok(w.state.run!.tick>tick);assert.equal(w.state.localPlayerId,host);assert.doesNotThrow(()=>parseActionState(w.state.run));
});
test('guest Worker never steps snapshots locally and cannot overwrite an unsettled or settled reward source',async t=>{
 const w=worker(folder(t),t);await w.ready;const run=createActionRun(77,'wand',[host,guest]);const source={hostId:host,sequence:30,role:'guest',playerId:guest};
 await w.request('mirror',{source,run,minClaim:4});assert.equal(w.state.claim,5);const tick=w.state.run!.tick;await delay(180);assert.equal(w.state.run!.tick,tick);
 await assert.rejects(w.request('input',{input:{type:'pause',paused:false}}));await assert.rejects(w.request('mirror',{source:{...source,sequence:31},run,minClaim:4}));assert.equal(w.state.source!.sequence,30);
 await w.request('finish');await w.request('settled',{claim:5});const settled=structuredClone(w.state);
 run.tick=10;run.elapsedMs=500;await w.request('mirror',{source,run,minClaim:5});assert.deepEqual(w.state,settled);
 await w.request('mirror',{source:{...source,sequence:31},run,minClaim:5});assert.equal(w.state.claim,6);assert.equal(w.state.settled,false);
});
test('durable installation identity recovers only an existing valid identity and fails closed if both files are bad',t=>{
 const f=folder(t),id=installationId(f);assert.match(id,/^[a-f0-9]{32}$/);assert.equal(installationId(f),id);const file=path.join(f,'installation.json');fs.writeFileSync(file,'damaged');assert.equal(installationId(f),id);assert.equal(fs.readFileSync(file,'utf8'),'damaged');fs.writeFileSync(file+'.bak','bad-backup');assert.throws(()=>installationId(f),/不会生成新身份/);assert.equal(fs.readFileSync(file,'utf8'),'damaged');
});
test('room renderer/network boundaries reject forged actor/reward, Unicode controls, extra fields and guest global controls',()=>{
 assert.throws(()=>parseCommand({type:'room-host',generation:1,name:'x',bind:'127.0.0.1',key:'injection'}));assert.throws(()=>parseRoomCommand({type:'room-join',generation:1,name:'x\u0085',invitation:'x'}));
 assert.throws(()=>parseClientRoomMessage({type:'intent',key:{hostId:host,sequence:1},input:{type:'move',x:1,y:2},playerId:host}));
 for(const input of [{type:'pause',paused:false},{type:'upgrade',choice:'heartwood'}])assert.throws(()=>parseClientRoomMessage({type:'intent',key:{hostId:host,sequence:1},input}));
 assert.throws(()=>parseClientRoomMessage({type:'reward',coins:99,xp:99}));assert.throws(()=>parseHostRoomMessage({type:'snapshot',key:{hostId:host,sequence:1},run:createActionRun(1,'bow',[host]),participants:[host,guest]}));
});
