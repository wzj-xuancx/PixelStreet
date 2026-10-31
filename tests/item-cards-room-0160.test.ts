import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {RoomService} from '../apps/desktop/room-service';
import {emptyRoom} from '../packages/protocol/room';
import {initialProfile,initialEquipment,initialPets} from '../packages/solo-core';
import {workerFixture} from './p7-worker-fixture';
const hostId='a'.repeat(32),guestId='b'.repeat(32),outsider='c'.repeat(32);
const member=(id:string)=>({id,name:id===hostId?'Host':'Guest',online:true,inRun:false,active:false,available:false,returned:false,weapon:'wand' as const});
const action=()=>({ready:Promise.resolve(),state:{status:'ready',settled:true,source:null,run:null},pause:async()=>{throw Error('unexpected action mutation');}} as any);
const wait=async(predicate:()=>boolean,label:string)=>{const start=Date.now();while(!predicate()){if(Date.now()-start>4000)throw Error('timeout: '+label);await new Promise(r=>setTimeout(r,10));}};
function fixture(){
 const p=initialProfile(1000);p.bag.flour=5;const sent:any[]=[];const s:any=Object.create(RoomService.prototype);
 Object.assign(s,{state:{...emptyRoom([],hostId),status:'hosting',role:'host',hostId,members:[member(hostId),member(guestId)]},game:{state:{status:'ready',profile:p},authoritativeProfile:async()=>structuredClone(p)},action:action(),host:{send:(peer:string,message:any)=>{sent.push([peer,message]);return true;}},serial:Promise.resolve(),epoch:1,shareEpoch:0,lastShare:undefined,chatAt:new Map(),presenceAt:new Map(),peerShareAt:new Map(),peerNonces:new Map(),cardSequence:0,lastCardId:0,disposed:false,onUpdate(){}});return {s,p,sent};
}

test('local serial submission re-reads authority, rejects no ownership, rate limits and checks send failures',async()=>{
 const {s,p,sent}=fixture();s.game.state.profile={...p,bag:{...p.bag,flour:999}};p.bag.flour=2;await s.shareItem('bag:flour');assert.equal(sent[0][1].quantity,2);assert.equal(sent[0][1].senderId,hostId);
 await assert.rejects(s.shareItem('bag:flour'),/2秒/);assert.equal(s.state.cards.length,1);s.lastShare=Date.now()-2000;p.bag.flour=0;await assert.rejects(s.shareItem('bag:flour'),/不再持有/);assert.equal(s.state.cards.length,1);
 p.bag.flour=3;s.host.send=()=>false;await assert.rejects(s.shareItem('bag:flour'),/部分连接/);assert.match(s.state.error,/未向所有/);
 const guest=fixture().s;guest.state={...guest.state,role:'guest',status:'joined'};guest.host=undefined;guest.client={send:()=>false};await assert.rejects(guest.shareItem('bag:flour'),/未发送/);assert.equal(guest.lastShare,undefined);assert.equal(guest.state.cards.length,0);
});

test('queued room leave, generation/visibility guard change and disconnect during read reject before sending',async()=>{
 for(const kind of ['leave','guard','disconnect','exhausted'] as const){
  const {s,p,sent}=fixture();let resolve!:(p:any)=>void,started=false,valid=true;s.game.authoritativeProfile=()=>{started=true;return new Promise(r=>resolve=r);};
  const task=s.shareItem('bag:flour',()=>{if(!valid)throw Error('expired inventory generation/visibility');});await wait(()=>started,'read started');
  if(kind==='leave')s.invalidateShares();else if(kind==='guard')valid=false;else if(kind==='disconnect')s.state.status='disconnected';else p.bag.flour=0;resolve(p);await assert.rejects(task);assert.equal(sent.length,0);assert.equal(s.state.cards.length,0);
 }
 const {s,sent}=fixture();s.serial=new Promise(resolve=>setTimeout(resolve,10));const queued=s.shareItem('bag:flour');s.invalidateShares();await assert.rejects(queued,/变化/);assert.equal(sent.length,0);
});

test('host binds authenticated peer, enforces peer nonce/rate and rejects spoofed/unknown shape',async()=>{
 const {s,sent}=fixture(),message={type:'item-card',itemId:'bag:flour',quantity:4,nonce:'nonce-123456789012'};
 await s.clientMessage({peerId:outsider},message);assert.equal(s.state.cards.length,0);
 await s.clientMessage({peerId:guestId},message);assert.equal(s.state.cards[0].senderId,guestId);
 const before=s.state.cards.length;await s.clientMessage({peerId:guestId},message);assert.equal(s.state.cards.length,before);assert.match(sent.at(-1)[1].message,/重复/);
 await s.clientMessage({peerId:guestId},{...message,nonce:'other-123456789012'});assert.match(sent.at(-1)[1].message,/2秒/);assert.equal(s.state.cards.length,before);
 for(const extra of [{senderId:hostId},{quantity:0},{itemId:'bad'},{html:'<img>'}]){await s.clientMessage({peerId:guestId},{...message,...extra});assert.equal(s.state.cards.length,before);}
 s.state.members[1].online=false;await s.clientMessage({peerId:guestId},{...message,nonce:'offline-1234567890'});assert.equal(s.state.cards.length,before);
});

test('guest accepts only authenticated host path/current online sender and monotonic IDs, unread is capped/readable',async()=>{
 const {s}=fixture();s.state={...s.state,role:'guest',status:'joined',localPlayerId:guestId};s.host=undefined;s.client={hostId,send:()=>true};
 for(let id=1;id<=8;id++)await s.hostMessage({type:'item-card',id,senderId:hostId,itemId:'bag:flour',quantity:id});
 assert.equal(s.state.cards.length,6);assert.deepEqual(s.state.cards.map((c:any)=>c.id),[3,4,5,6,7,8]);assert.equal(s.state.unreadCards,6);
 await s.hostMessage({type:'item-card',id:8,senderId:hostId,itemId:'bag:flour',quantity:99});assert.equal(s.state.cards.at(-1).quantity,8);
 await s.hostMessage({type:'item-card',id:9,senderId:outsider,itemId:'bag:flour',quantity:1});assert.equal(s.lastCardId,8);assert.match(s.state.error,/不在当前/);
 s.state.members[0].online=false;await s.hostMessage({type:'item-card',id:9,senderId:hostId,itemId:'bag:flour',quantity:1});assert.equal(s.lastCardId,8);
 s.markCardsRead();assert.equal(s.state.unreadCards,0);s.clearCards();assert.deepEqual(s.state.cards,[]);assert.equal(s.lastCardId,0);
});

test('bounded replay state retains 64 nonces per authenticated sender, while recent cards retain six',async()=>{
 const {s}=fixture();for(let i=0;i<70;i++){s.peerShareAt.set(guestId,Date.now()-2000);await s.clientMessage({peerId:guestId},{type:'item-card',itemId:'bag:flour',quantity:1,nonce:'bounded-nonce-'+String(i).padStart(16,'0')});}
 assert.equal(s.peerNonces.size,1);assert.equal(s.peerNonces.get(guestId).length,64);assert.equal(s.state.cards.length,6);assert.equal(s.cardSequence,70);
});

test('actual roster eviction removes only expired peer card maps; reserved identity keeps replay/rate',async()=>{
 const {s}=fixture();s.offlineAt=new Map();s.party=async()=>{};s.host.disconnect=()=>{throw Error('unexpected reservation rejection');};
 for(let i=0;i<12;i++){
  const id=(i+100).toString(16).padStart(32,'0');
  while(s.state.members.length<4){const old=(1000+s.state.members.length+i*10).toString(16).padStart(32,'0');s.state.members.push({...member(old),online:false});s.offlineAt.set(old,Date.now()-31000);s.peerShareAt.set(old,Date.now()-10);s.peerNonces.set(old,['kept-nonce-123456']);}
  const expired=s.state.members.find((m:any)=>!m.online)!.id;await s.joinedPeer({peerId:id,name:'New',remoteAddress:'127.0.0.1'});
  assert.equal(s.state.members.length,3);assert.equal(s.peerShareAt.has(expired),false);assert.equal(s.peerNonces.has(expired),false);assert.equal(s.offlineAt.has(expired),false);
  const newest=s.state.members.find((m:any)=>m.id===id);newest.online=false;s.offlineAt.set(id,Date.now()-31000);s.peerShareAt.set(id,Date.now());s.peerNonces.set(id,['bounded-nonce-123456']);
  assert.ok(s.peerShareAt.size<=3);assert.ok(s.peerNonces.size<=3);
 }
 const reserved=s.state.members.find((m:any)=>!m.online)!.id;s.offlineAt.set(reserved,Date.now());s.peerShareAt.set(reserved,Date.now());s.peerNonces.set(reserved,['reserved-nonce-123456']);
 await s.joinedPeer({peerId:reserved,name:'Resume',remoteAddress:'127.0.0.1'});assert.equal(s.peerShareAt.has(reserved),true);assert.deepEqual(s.peerNonces.get(reserved),['reserved-nonce-123456']);
});

test('two actual loopback RoomServices + two actual isolated Workers share both directions without changing either profile',async()=>{
 const root=fs.mkdtempSync('/private/tmp/pixelstreet-p7-peers-'),workers:any[]=[],services:RoomService[]=[];
 try{
  for(const [role,id] of [['host',hostId],['guest',guestId]]){const folder=path.join(root,role);fs.mkdirSync(folder,{recursive:true,mode:0o700});const p=initialProfile(Date.now());p.bag.flour=9;p.equipment=initialEquipment();p.equipment.ownedIDs=['trail-hood'];p.equipment.slots.head='trail-hood';p.pets=initialPets();p.pets.ownedGearIDs=['moss-collar'];p.pets.slots.collar='moss-collar';fs.writeFileSync(path.join(folder,'profile.json'),JSON.stringify(p));fs.writeFileSync(path.join(folder,'installation.json'),JSON.stringify({version:1,id}));const f=workerFixture(folder);workers.push(f);services.push(new RoomService(folder,f.game,action(),()=>{}));}
  const [host,guest]=services;await Promise.all(services.map(s=>s.ready));await host.hostRoom('Host','127.0.0.1');assert.match(host.state.address,/^127\.0\.0\.1:/);await guest.joinRoom('Guest',host.invitation());await wait(()=>services.every(s=>s.state.members.filter(m=>m.online).length===2)&&workers.every(f=>f.game.state.partySize===2),'connected party2');
  const before=await Promise.all(workers.map(f=>f.game.authoritativeProfile())),bytes=workers.map((_,i)=>fs.readFileSync(path.join(root,i?'guest':'host','profile.json'),'utf8'));
  await host.shareItem('bag:flour');await wait(()=>guest.state.cards.length===1,'host→guest');assert.equal(guest.state.cards[0].senderId,hostId);assert.equal(guest.state.unreadCards,1);
  await guest.shareItem('equipment:trail-hood');await wait(()=>host.state.cards.length===2&&guest.state.cards.length===2,'guest→host');assert.equal(host.state.cards[1].senderId,guestId);assert.equal(host.state.cards[1].quantity,1);
  await assert.rejects(guest.shareItem('bag:flour'),/2秒/);
  // Malicious payloads traverse the actual authenticated connection, not direct calls.
  const g:any=guest,h:any=host;g.client.send({type:'item-card',itemId:'bag:flour',quantity:1,nonce:'bad-spoof-12345678',senderId:hostId});await wait(()=>guest.state.error.includes('字段'),'spoof rejection');assert.equal(host.state.cards.length,2);
  const replay={type:'item-card',itemId:'bag:flour',quantity:1,nonce:'replay-real-12345678'};h.peerShareAt.set(guestId,Date.now()-2000);g.client.send(replay);await wait(()=>host.state.cards.length===3,'valid raw authenticated card');g.client.send(replay);await wait(()=>guest.state.error.includes('重复'),'nonce replay rejected');assert.equal(host.state.cards.length,3);
  for(let i=0;i<7;i++){h.lastShare=Date.now()-2000;await host.shareItem('petgear:moss-collar');}await wait(()=>guest.state.cards.at(-1)?.id===host.state.cards.at(-1)?.id,'recent cap');assert.equal(host.state.cards.length,6);assert.equal(guest.state.cards.length,6);
  for(let i=0;i<2;i++){assert.deepEqual(await workers[i].game.authoritativeProfile(),before[i]);assert.equal(fs.readFileSync(path.join(root,i?'guest':'host','profile.json'),'utf8'),bytes[i]);}
  const count=host.state.cards.length;h.host.send(guestId,{type:'item-card',id:10000,senderId:outsider,itemId:'bag:flour',quantity:1});await wait(()=>guest.state.error.includes('不在当前'),'unlisted authenticated host payload');assert.equal(guest.state.cards.length,count);
  // Physical transport interruption disables sending; reconnect does not replay old cards.
  const last=host.state.cards.at(-1)!.id;h.host.disconnect(guestId,'P7 owned loopback transport interruption');await wait(()=>guest.state.status==='reconnecting','disconnect');await assert.rejects(guest.shareItem('bag:flour'),/中断/);await wait(()=>guest.state.status==='joined'&&host.state.members.some(m=>m.id===guestId&&m.online),'resume');await new Promise(r=>setTimeout(r,40));assert.equal(host.state.cards.at(-1)!.id,last);
  await guest.leave();assert.deepEqual(guest.state.cards,[]);assert.equal(guest.state.unreadCards,0);await host.leave();assert.deepEqual(host.state.cards,[]);
  await host.hostRoom('Host','127.0.0.1');await guest.joinRoom('Guest',host.invitation());await wait(()=>guest.state.members.length===2,'new room');assert.deepEqual(guest.state.cards,[]);assert.equal((host as any).cardSequence,0);await host.shareItem('bag:flour');await wait(()=>guest.state.cards[0]?.id===1,'new room id1');
 }finally{for(const s of services)await s.close();for(const f of workers)await f.close();fs.rmSync(root,{recursive:true,force:true});}
});
