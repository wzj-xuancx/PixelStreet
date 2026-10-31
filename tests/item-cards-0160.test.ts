import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {workerFixture} from './p7-worker-fixture';
import {initialProfile,ensureFieldProgress,initialEquipment,initialPets,EQUIPMENT_IDS,PET_GEAR_IDS,type Profile} from '../packages/solo-core';
import {ITEM_CARD_CATALOG,itemCardDefinition,ownedItemCard,validItemCardQuantity} from '../packages/solo-core/item-cards';
import {parseCommand} from '../packages/protocol';
import {emptyRoom,parseClientRoomMessage,parseHostRoomMessage,roomShareReason} from '../packages/protocol/room';
const host='a'.repeat(32),guest='b'.repeat(32);
const client={type:'item-card',itemId:'bag:flour',quantity:3,nonce:'valid-nonce-123456'};
const broadcast={type:'item-card',id:1,senderId:guest,itemId:'bag:flour',quantity:3};

test('46 canonical local definitions and all owned stacks/equipped unique pieces are read only',()=>{
 const p=initialProfile(1000);p.equipment=initialEquipment();p.equipment.ownedIDs=[...EQUIPMENT_IDS];p.equipment.slots.head='trail-hood';p.pets=initialPets();p.pets.ownedGearIDs=[...PET_GEAR_IDS];p.pets.slots.collar='moss-collar';
 for(const item of ITEM_CARD_CATALOG.filter(i=>!['equipment','petgear'].includes(i.category))){const key=item.id.split(':')[1];let stock:any=item.source==='field'?ensureFieldProgress(p).materials:item.source==='bag'?p.bag:item.source==='materials'?p.leisure.materials:item.source==='journal'?p.leisure.journal:(p.atelier??={stock:{}} as any).stock;stock[key]=17;}
 assert.equal(ITEM_CARD_CATALOG.length,46);assert.equal(new Set(ITEM_CARD_CATALOG.map(i=>i.id)).size,46);const before=JSON.stringify(p);
 for(const item of ITEM_CARD_CATALOG){const owned=ownedItemCard(p,item.id)!;assert.equal(owned.name,item.name);assert.equal(owned.iconId,item.iconId);assert.equal(owned.quantity,['equipment','petgear'].includes(item.category)?1:17);}
 assert.equal(ownedItemCard(p,'equipment:trail-hood')!.quantity,1);assert.equal(ownedItemCard(p,'petgear:moss-collar')!.quantity,1);assert.equal(JSON.stringify(p),before);
});

test('empty/absent/malformed ownership never initializes optional extensions or accepts unknown IDs',()=>{
 const p=initialProfile(1000),before=JSON.stringify(p);for(const id of ['equipment:trail-hood','petgear:moss-collar','pet:slime','bag:__proto__','bag:flour:extra','https://x','constructor',null,{},['bag:flour']])assert.equal(ownedItemCard(p,id),undefined);
 for(const amount of [0,-1,1.1,1e6+1,NaN,Infinity]){p.bag.flour=amount;assert.equal(ownedItemCard(p,'bag:flour'),undefined);}p.bag.flour=initialProfile(1000).bag.flour;
 assert.equal(JSON.stringify(p),before);assert.equal(p.equipment,undefined);assert.equal(p.pets,undefined);assert.equal(p.atelier,undefined);
});

test('strict fixed client/host card shapes reject remote metadata, spoof sender and numeric abuse',()=>{
 assert.deepEqual(parseClientRoomMessage(client),client);assert.deepEqual(parseHostRoomMessage(broadcast),{...broadcast,badge:null});
 for(const quantity of [0,-1,1.2,NaN,Infinity,1e6+1,'3',null]){assert.throws(()=>parseClientRoomMessage({...client,quantity}));assert.throws(()=>parseHostRoomMessage({...broadcast,quantity}));}
 for(const itemId of ['',undefined,'bag:missing','equipment:missing','petgear:missing','constructor','bag:flour\u0000']){assert.throws(()=>parseClientRoomMessage({...client,itemId}));assert.throws(()=>parseHostRoomMessage({...broadcast,itemId}));}
 for(const itemId of ['equipment:trail-hood','petgear:moss-collar']){assert.ok(validItemCardQuantity(itemId,1));assert.throws(()=>parseClientRoomMessage({...client,itemId,quantity:2}));}
 for(const extra of [{senderId:host},{name:'evil'},{url:'https://x'},{html:'<script>'},{css:'x'},{action:{type:'buy-flour'}}]){assert.throws(()=>parseClientRoomMessage({...client,...extra}));if(!Object.keys(extra).every(key=>Object.hasOwn(broadcast,key)))assert.throws(()=>parseHostRoomMessage({...broadcast,...extra}));}
 for(const nonce of ['',15,'a'.repeat(15),'a'.repeat(65),'a'.repeat(16)+'\n','a'.repeat(16)+'<'])assert.throws(()=>parseClientRoomMessage({...client,nonce}));
 for(const id of [0,-1,1.5,1e12+1,'1'])assert.throws(()=>parseHostRoomMessage({...broadcast,id}));
 for(const senderId of [host+'a',host+'\n','g'.repeat(32),''])assert.throws(()=>parseHostRoomMessage({...broadcast,senderId}));
 assert.throws(()=>parseClientRoomMessage({...client,type:'item-card-v99'}));assert.throws(()=>parseHostRoomMessage({...broadcast,type:'item-card-v99'}));
});

test('inventory-share IPC accepts only a current-shaped generation and fixed ID with no quantity/token/targets',()=>{
 const value={type:'inventory-share',generation:4,itemId:'equipment:trail-hood'};assert.deepEqual(parseCommand(value),value);
 for(const extra of [{quantity:7},{token:'x'},{senderId:host},{target:'127.0.0.1'}])assert.throws(()=>parseCommand({...value,...extra}));
 for(const generation of [0,-1,1.2,'4',null])assert.throws(()=>parseCommand({...value,generation}));
 assert.throws(()=>parseCommand({...value,itemId:'equipment:unknown'}));assert.throws(()=>parseCommand({type:'profile-read'}));
 assert.deepEqual(parseCommand({type:'room-read',generation:2}),{type:'room-read',generation:2});assert.throws(()=>parseCommand({type:'room-read',generation:2,ids:[1]}));
});

test('preview reasons distinguish idle, pending, disconnected and missing roster without mutation',()=>{
 const room=emptyRoom([],host),before=JSON.stringify(room);assert.match(roomShareReason(room),/先在设置/);assert.equal(JSON.stringify(room),before);
 room.status='joining';assert.match(roomShareReason(room),/正在连接/);room.status='reconnecting';assert.match(roomShareReason(room),/中断/);room.status='hosting';room.role='host';room.hostId=host;assert.match(roomShareReason(room),/成员/);
 room.members=[{id:host,name:'房主',online:true,inRun:false,active:false,available:false,returned:false,weapon:'wand'}];assert.equal(roomShareReason(room),'');
});


test('actual Worker profile-read is fresh after a real transaction and never advances/commits/persists',async()=>{
 const folder=fs.mkdtempSync('/private/tmp/pixelstreet-p7-worker-');const seeded=initialProfile(Date.now());seeded.job='keeper';fs.writeFileSync(path.join(folder,'profile.json'),JSON.stringify(seeded));const f=workerFixture(folder);
 try{
  await f.game.ready;const before=await f.game.authoritativeProfile(),bytes=fs.readFileSync(path.join(folder,'profile.json'),'utf8');
  await new Promise(r=>setTimeout(r,25));const again=await f.game.authoritativeProfile();assert.deepEqual(again,before);assert.equal(fs.readFileSync(path.join(folder,'profile.json'),'utf8'),bytes);
  await f.game.request('command',{envelope:{sequence:before.sequence+1,requestId:'p7-worker-real-buy-0001',action:{type:'buy-flour'}}});const changed=await f.game.authoritativeProfile();assert.equal(changed.sequence,before.sequence+1);assert.ok(changed.bag.flour>before.bag.flour);
  const currentBytes=fs.readFileSync(path.join(folder,'profile.json'),'utf8');assert.deepEqual(await f.game.authoritativeProfile(),changed);assert.equal(fs.readFileSync(path.join(folder,'profile.json'),'utf8'),currentBytes);
 }finally{await f.close();fs.rmSync(folder,{recursive:true,force:true});}
});

test('blocked actual Worker rejects profile-read and preserves invalid original data',async()=>{
 const folder=fs.mkdtempSync('/private/tmp/pixelstreet-p7-blocked-');fs.writeFileSync(path.join(folder,'profile.json'),'invalid original');const f=workerFixture(folder);
 try{await f.game.ready;assert.equal(f.game.state.status,'blocked');await assert.rejects(f.game.authoritativeProfile());assert.equal(fs.readFileSync(path.join(folder,'profile.json'),'utf8'),'invalid original');}finally{await f.close();fs.rmSync(folder,{recursive:true,force:true});}
});
