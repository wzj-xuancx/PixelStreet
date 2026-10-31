import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {initialProfile,parseProfile,type Profile} from '../packages/solo-core';
import {MASTERY_IDS,roomDisplayBadge} from '../packages/solo-core/mastery';
import {parseRoomMember,parseClientRoomMessage,parseHostRoomMessage} from '../packages/protocol/room';
import {RoomService} from '../apps/desktop/room-service';
import {workerFixture} from './p7-worker-fixture';
import {masterySmallArt,masteryBadgeText} from '../apps/desktop/renderer/mastery-art';
const hostId='a'.repeat(32),guestId='b'.repeat(32);
const member={id:guestId,name:'Private guest',online:true,inRun:false,active:false,available:false,returned:false,weapon:'wand'};
const advert={type:'member',key:null,weapon:'wand',available:false,active:false,settledSequence:0};
const card={type:'item-card',id:1,senderId:guestId,itemId:'bag:flour',quantity:2};
export function badgeProfile(now=Date.now()):Profile{const p=initialProfile(now);p.bag.flour=9;p.mastery={version:1,startedTick:0,startedSequence:0,shelves:3,quick:1,premium:1,orders:3,proofs:[],comboRun:null,claimed:['paired-shelves','price-choice','two-recipes'],worn:'paired-shelves'};return parseProfile(p);}
const wait=async(fn:()=>boolean,label:string)=>{for(let i=0;i<500;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('timeout '+label);};
const action=()=>({ready:Promise.resolve(),state:{status:'ready',settled:true,source:null,run:null},pause:async()=>{throw Error('unexpected action mutation');}} as any);
const frame=(v:unknown)=>{const json=Buffer.from(JSON.stringify(v)),head=Buffer.alloc(4);head.writeUInt32BE(json.length);return Buffer.concat([head,json]);};
test('six IDs/null and deliberate legacy absence; every other field/type/URI/spoof fails closed',()=>{
 for(const badge of [...MASTERY_IDS,null]){assert.equal(parseRoomMember({...member,badge}).badge,badge);assert.equal((parseClientRoomMessage({...advert,badge}) as any).badge,badge);assert.equal((parseHostRoomMessage({...card,badge}) as any).badge,badge);}
 for(const [f,v] of [[parseRoomMember,member],[parseClientRoomMessage,advert],[parseHostRoomMessage,card]] as const){assert.equal((f(v) as any).badge,null);for(const badge of [undefined,0,true,[],['paired-shelves'],{},'unknown','https://x.test/a.svg','<img src=x>'])assert.throws(()=>f({...v,badge}));assert.throws(()=>f({...v,badge:null,html:'<b>'}));}
 assert.throws(()=>parseClientRoomMessage({...advert,badge:'price-choice',senderId:hostId}));assert.throws(()=>parseClientRoomMessage({type:'item-card',itemId:'bag:flour',quantity:1,nonce:'nonce-123456789012',badge:'price-choice'}));
 const p=initialProfile(1000),bytes=JSON.stringify(p);assert.equal(roomDisplayBadge(p),null);assert.equal(JSON.stringify(p),bytes);p.mastery=badgeProfile(1000).mastery;assert.equal(roomDisplayBadge(p),'paired-shelves');p.mastery!.claimed=[];assert.equal(roomDisplayBadge(p),null);
 for(const id of MASTERY_IDS){assert.match(masterySmallArt(id,20),new RegExp('badge-small-'+id+'\\.svg'));assert.match(masteryBadgeText(id),/：/);}assert.equal(masterySmallArt('https://x.test' as any,20),'');
});
test('actual private RoomServices + Workers: authority, accepted sender, history, import, reconnect, bounded cards and immutable social reads',async()=>{
 const root=fs.mkdtempSync('/private/tmp/pixelstreet-badges-0170-'),workers:any[]=[],rooms:RoomService[]=[];
 fs.chmodSync(root,0o700);fs.writeFileSync(path.join(root,'.pixelstreet-isolated-profile.json'),JSON.stringify({product:'PixelStreet',kind:'isolated-playtest',version:1})+'\n');
 try{
  for(const [name,id] of [['host',hostId],['guest',guestId]]){const folder=path.join(root,name);fs.mkdirSync(folder,{mode:0o700});fs.writeFileSync(path.join(folder,'.pixelstreet-isolated-profile.json'),'private test only\n');fs.writeFileSync(path.join(folder,'profile.json'),JSON.stringify(badgeProfile()));fs.writeFileSync(path.join(folder,'installation.json'),JSON.stringify({version:1,id}));const w=workerFixture(folder);workers.push(w);rooms.push(new RoomService(folder,w.game,action(),()=>{}));}
  const [host,guest]=rooms,h:any=host,g:any=guest;await Promise.all(rooms.map(s=>s.ready));await host.hostRoom('Private host','127.0.0.1');await guest.joinRoom('Private guest',host.invitation());await wait(()=>host.state.members.find(m=>m.id===guestId)?.badge==='paired-shelves'&&guest.state.members.find(m=>m.id===hostId)?.badge==='paired-shelves','initial badge');assert.equal(workers[0].game.state.partySize,2);
  const raw=net.createConnection({host:'127.0.0.1',port:Number(host.state.address.split(':')[1])});raw.on('error',()=>{});const closed=new Promise<void>(r=>raw.once('close',()=>r()));raw.once('data',()=>raw.write(frame({type:'auth',version:1})));await closed;await wait(()=>host.state.error.includes('房间版本不一致'),'old auth mismatch');assert.equal(host.state.members.length,2);assert.equal(guest.state.status,'joined');
  let count=0;const send=g.client.send.bind(g.client);g.client.send=(p:any)=>{count++;return send(p);};
  const immutable=await Promise.all(workers.map(w=>w.game.authoritativeProfile())),bytes=workers.map((_:any,i:number)=>fs.readFileSync(path.join(root,i?'guest':'host','profile.json'),'utf8'));
  for(let n=0;n<15;n++)guest.gameUpdated();await wait(()=>!g.badgeRefreshPending,'coalesced read');await new Promise(r=>setTimeout(r,80));assert.equal(count,0,'unchanged authority has no packet loop');
  await guest.shareItem('bag:flour');await wait(()=>host.state.cards.length===1,'card');assert.equal(host.state.cards[0].badge,'paired-shelves');assert.equal(host.state.cards[0].senderId,guestId);
  for(let i=0;i<2;i++){assert.deepEqual(await workers[i].game.authoritativeProfile(),immutable[i]);assert.equal(fs.readFileSync(path.join(root,i?'guest':'host','profile.json'),'utf8'),bytes[i]);}
  const set=async(i:number,action:any)=>{const p=await workers[i].game.authoritativeProfile();await workers[i].game.request('command',{envelope:{sequence:p.sequence+1,requestId:'badge-'+Date.now()+'-'+i,action}});rooms[i].gameUpdated();};
  await set(1,{type:'mastery-wear',id:'price-choice'});await wait(()=>host.state.members.find(m=>m.id===guestId)?.badge==='price-choice','wear');assert.equal(host.state.cards[0].badge,'paired-shelves');
  await set(1,{type:'mastery-unwear'});await wait(()=>host.state.members.find(m=>m.id===guestId)?.badge===null,'unwear');assert.equal(host.state.cards[0].badge,'paired-shelves');
  // Host derives the card badge from its accepted authenticated member, never client card fields.
  send({...advert,badge:'two-recipes'});await wait(()=>host.state.members.find(m=>m.id===guestId)?.badge==='two-recipes','accepted peer display claim');h.peerShareAt.set(guestId,Date.now()-2000);send({type:'item-card',itemId:'bag:flour',quantity:2,nonce:'accepted-snapshot-12345'});await wait(()=>host.state.cards.length===2,'snapshot');assert.equal(host.state.cards[1].badge,'two-recipes');
  send({...advert,badge:'price-choice',senderId:hostId});await wait(()=>guest.state.error.includes('字段'),'spoof refused');assert.equal(host.state.members.find(m=>m.id===hostId)?.badge,'paired-shelves');assert.equal(host.state.members.find(m=>m.id===guestId)?.badge,'two-recipes');
  send({...advert,badge:'https://x.test'});await wait(()=>guest.state.error.includes('徽章'),'URI refused');
  const p=await workers[1].game.authoritativeProfile(),source=badgeProfile();source.mastery!.worn='price-choice';await workers[1].game.request('import-profile',{profile:source,expectedSequence:p.sequence});guest.gameUpdated();await wait(()=>host.state.members.find(m=>m.id===guestId)?.badge==='price-choice','import refresh');
  const beforeDrop=host.state.cards.length;h.host.disconnect(guestId,'private badge reconnect');await wait(()=>guest.state.status==='reconnecting','drop');assert.equal(host.state.members.find(m=>m.id===guestId)?.badge,null);await wait(()=>guest.state.status==='joined'&&host.state.members.find(m=>m.id===guestId)?.badge==='price-choice','resume fresh authority');assert.equal(host.state.cards.length,beforeDrop);
  for(let i=0;i<7;i++){h.lastShare=Date.now()-2000;await host.shareItem('bag:flour');}await wait(()=>guest.state.cards.at(-1)?.id===host.state.cards.at(-1)?.id,'bounded sync');assert.equal(host.state.cards.length,6);assert.equal(guest.state.cards.length,6);
  const stable=await Promise.all(workers.map(w=>w.game.authoritativeProfile()));for(let i=0;i<20;i++)rooms.forEach(s=>s.gameUpdated());await new Promise(r=>setTimeout(r,100));for(let i=0;i<2;i++)assert.deepEqual(await workers[i].game.authoritativeProfile(),stable[i]);
  await guest.leave();await wait(()=>!host.state.members.some(m=>m.id===guestId),'leave');assert.equal(host.state.members.some(m=>m.id===guestId),false);assert.equal(guest.state.cards.length,0);await wait(()=>workers[0].game.state.partySize===1,'party1 after leave');assert.equal(host.state.cards.length,6,'host keeps historical snapshots');
  // Replace only this owned fake installation identity after a full leave.
  await set(1,{type:'mastery-unwear'});guest.state.localPlayerId='c'.repeat(32);await guest.joinRoom('Private replacement',host.invitation());await wait(()=>host.state.members.find(m=>m.id==='c'.repeat(32))?.online===true,'replacement joins');await wait(()=>host.state.members.find(m=>m.id==='c'.repeat(32))?.badge===null,'replacement fresh null');assert.equal(host.state.members.some(m=>m.id===guestId),false);assert.equal(guest.state.cards.length,0);await guest.leave();
  await host.leave();assert.equal(host.state.cards.length,0);
 }finally{for(const s of rooms)await s.close();for(const w of workers)await w.close();fs.rmSync(root,{recursive:true,force:true});assert.equal(fs.existsSync(root),false);}
});
test('explicit version1 challenge reports both peers need0.19.0 and leaves no half-joined state',async()=>{
 const root=fs.mkdtempSync('/private/tmp/pixelstreet-badges-0170-version-');fs.writeFileSync(path.join(root,'P7-ISOLATED-TEST'),'private version fixture');const w=workerFixture(root),s=new RoomService(root,w.game,action(),()=>{});
 const server=net.createServer(socket=>{socket.on('error',()=>{});socket.end(frame({type:'challenge',version:1,roomId:'x'.repeat(22),hostId,serverNonce:'y'.repeat(22)}));});
 try{await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});await s.ready;await assert.rejects(s.joinRoom('Private',`PS3@127.0.0.1:${(server.address() as net.AddressInfo).port}#${Buffer.alloc(16,7).toString('base64url')}`),/房间版本不一致.*0.19.0/);assert.equal(s.state.role,'none');assert.equal(s.state.status,'idle');}finally{await s.close();await w.close();if(server.listening)await new Promise<void>(r=>server.close(()=>r()));fs.rmSync(root,{recursive:true,force:true});}
});
