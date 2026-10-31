import test from 'node:test';
import assert from 'node:assert/strict';
import {initialProfile,parseProfile,parseAction,transact,advance,EQUIPMENT_IDS as ALL_EQUIPMENT_IDS,EQUIPMENT_CATALOG,EQUIPMENT_SLOTS,equipmentOf,equipmentOwnedEntries,equipmentRecipeEntries,equipmentEffects,initialEquipment,initialExpedition,hasRoomForExpeditionWin,type Profile,type GameAction,type EquipmentId} from '../packages/solo-core';
import {inventoryEntries} from '../packages/solo-core/inventory-view';
import {inventoryAction,inventoryCapabilities,parseInventoryActionRequest,type InventoryActionKind} from '../packages/solo-core/inventory-actions';
import {InventoryActionSession} from '../apps/desktop/inventory-session';
import {parseEquipmentAction} from '../packages/solo-core/equipment';
const EQUIPMENT_IDS=ALL_EQUIPMENT_IDS.filter(id=>!["breaker-hammer","resonant-staff","rock-gloves","echo-mirror","moss-mantle","graft-charm"].includes(id)) as ("trail-hood"|"trail-coat"|"trail-gloves"|"trail-boots"|"trail-sword"|"blue-pendant"|"leaf-brooch")[];
const ready=()=>{const p=initialProfile(1000);p.job='keeper';p.coins=1000;p.bag.gel=30;p.bag.ration=30;p.leisure.materials.ore=100;p.leisure.materials.herb=100;return p;};
const act=(p:Profile,action:GameAction,party=1)=>transact(p,{sequence:p.sequence+1,requestId:'equipment-test-'+(p.sequence+1),action},party);
const request=(id:EquipmentId,kind:InventoryActionKind,count=1)=>({itemId:'equipment:'+id,kind,count});
const equip=(p:Profile,id:EquipmentId)=>act(act(p,{type:'equipment-craft',id}),{type:'equipment-equip',id});
const outfit=(accessory:EquipmentId='blue-pendant')=>{let p=ready();for(const id of ['trail-hood','trail-coat','trail-gloves','trail-boots','trail-sword',accessory] as EquipmentId[])p=equip(p,id);return p;};
const start=(p:Profile,enhanced=false,party=1)=>act(p,enhanced?{type:'expedition-depart',region:0,budget:3,auto:false,mode:'survey',crew:'none',meal:'none'}:{type:'start-run',region:0,budget:3,auto:false},party);
const ticks=(p:Profile,n:number,party=1)=>advance(p,p.wallAt+n*100,party);
test('optional read helpers and old live job/run leave schema7 JSON unchanged',()=>{
 const p=initialProfile(1000),raw=JSON.stringify(p);equipmentOf(p);equipmentOwnedEntries(p);equipmentRecipeEntries(p);inventoryEntries(p);inventoryCapabilities(p,'equipment:trail-hood');inventoryAction(p,request('trail-hood','craft'));assert.equal(JSON.stringify(p),raw);assert.equal(Object.hasOwn(parseProfile(p),'equipment'),false);assert.equal(Object.hasOwn(ticks(p,10),'equipment'),false);
 for(const job of ['visitor','apprentice','keeper'] as const){const q=ready();q.job=job;assert.deepEqual(parseProfile(q),q);}
 const old=start(ready());assert.equal(Object.hasOwn(parseProfile(old),'equipment'),false);assert.equal(Object.hasOwn(ticks(old,30),'equipment'),false);
});
test('seven exact recipes charge once and unique ownership cannot be recrafted',()=>{
 const expected={ 'trail-hood':[6,0,0,2],'trail-coat':[8,2,0,0],'trail-gloves':[6,2,0,0],'trail-boots':[6,0,2,0],'trail-sword':[10,3,3,0],'blue-pendant':[8,2,1,0],'leaf-brooch':[8,0,1,2]};
 let p=ready();for(const id of EQUIPMENT_IDS){const before=structuredClone(p),session=new InventoryActionSession(),preview=session.prepare(p,1,request(id,'craft'),0);assert.deepEqual(p,before);assert.equal(preview.quote.quantity,0);assert.equal(inventoryCapabilities(p,'equipment:'+id)[0].kind,'craft');assert.deepEqual([EQUIPMENT_CATALOG[id].coins,EQUIPMENT_CATALOG[id].gel,EQUIPMENT_CATALOG[id].ore,EQUIPMENT_CATALOG[id].herb],expected[id]);p=session.confirm(p,1,preview.token,1,1);const [coins,gel,ore,herb]=expected[id];assert.deepEqual([before.coins-p.coins,before.bag.gel-p.bag.gel,before.leisure.materials.ore-p.leisure.materials.ore,before.leisure.materials.herb-p.leisure.materials.herb],[coins,gel,ore,herb]);assert.equal(p.equipment!.ownedIDs.filter(v=>v===id).length,1);assert.throws(()=>act(p,{type:'equipment-craft',id}),/已持有/);assert.deepEqual(parseProfile(p),p);}
 assert.equal(inventoryEntries(p).filter(e=>e.source==='equipment').length,7);
 const poor=initialProfile(0),session=new InventoryActionSession(),pre=session.prepare(poor,1,request('trail-hood','craft'),0);assert.match(pre.quote.reason,/不足/);assert.throws(()=>session.confirm(poor,1,pre.token,1,1),/不足/);assert.equal(Object.hasOwn(poor,'equipment'),false);
});
test('six slots, replacement ownership, bag projection and unequip have exact identities',()=>{
 let p=outfit();assert.equal(EQUIPMENT_SLOTS.filter(s=>p.equipment!.slots[s]).length,6);assert.equal(inventoryEntries(p).filter(e=>e.source==='equipment').length,0);assert.equal(equipmentOwnedEntries(p).filter(e=>e.equipped).length,6);
 p=act(p,{type:'equipment-craft',id:'leaf-brooch'});const q=inventoryAction(p,request('leaf-brooch','equip'));assert.deepEqual(q.quote.comparison,{removed:'底部冒险技能伤害+2',added:'远征每场采集材料+1'});p=act(p,q.action);assert.equal(p.equipment!.slots.accessory,'leaf-brooch');assert.deepEqual(inventoryEntries(p).filter(e=>e.source==='equipment').map(e=>e.id),['equipment:blue-pendant']);assert.equal(equipmentEffects(p.equipment!.slots).spell,0);
 p=act(p,inventoryAction(p,request('leaf-brooch','unequip')).action);assert.equal(p.equipment!.slots.accessory,null);assert.equal(inventoryEntries(p).filter(e=>e.source==='equipment').length,2);assert.throws(()=>act(ready(),{type:'equipment-equip',id:'trail-hood'}),/尚未持有/);assert.throws(()=>act(p,{type:'equipment-unequip',id:'leaf-brooch'}),/尚未穿戴/);
});
test('strict saves/actions reject forged fields, slots, duplicate and unowned IDs',()=>{
 const p=outfit();for(const change of [(q:Profile)=>{(q.equipment as any).unknown=1;},(q:Profile)=>{q.equipment!.ownedIDs.push('trail-hood');},(q:Profile)=>{q.equipment!.slots.head='trail-sword';},(q:Profile)=>{q.equipment!.ownedIDs=q.equipment!.ownedIDs.filter(id=>id!=='trail-hood');},(q:Profile)=>{(q.equipment!.slots as any).other=null;},(q:Profile)=>{(q.equipment!.ownedIDs as any).push('unknown');},(q:Profile)=>{q.equipment!.active={runId:'run-0',slots:{...q.equipment!.slots}};}]){const q=structuredClone(p);change(q);assert.throws(()=>parseProfile(q));}
 for(const raw of [{type:'equipment-equip',id:'unknown'},{type:'equipment-equip',id:'trail-hood',slot:'body'},{type:'equipment-craft',id:'trail-hood',coins:0}])assert.throws(()=>parseAction(raw));
 for(const kind of ['craft','equip','unequip'] as const)for(const count of [0,-1,1.5,2,NaN,Infinity]){assert.throws(()=>inventoryAction(p,request('trail-hood',kind,count)));if(count!==2)assert.throws(()=>parseInventoryActionRequest(request('trail-hood',kind,count)));}
 for(const kind of ['sell','use'] as const)assert.throws(()=>inventoryAction(p,request('trail-hood',kind)));
});
test('all equipment mutations lock for idle and leisure runs without implicit retreat',()=>{
 let base=outfit();base=act(base,{type:'equipment-craft',id:'leaf-brooch'});for(const p of [start(base),act(base,{type:'stroll-start',zone:0,route:'balanced',trips:1})])for(const [id,kind]of [['leaf-brooch','equip'],['trail-hood','unequip'],['leaf-brooch','craft']] as const){const before=structuredClone(p);assert.match(inventoryAction(p,request(id,kind)).quote.reason,/回营/);assert.throws(()=>act(p,{type:('equipment-'+kind) as 'equipment-equip',id}),/回营/);assert.deepEqual(p,before);}
});
test('equipment previews cancel, expire, replay and reject changed authoritative inputs',()=>{
 for(const mode of ['cancel','expiry','generation','replace']){const p=ready(),s=new InventoryActionSession(),v=s.prepare(p,1,request('trail-hood','craft'),0);if(mode==='cancel')s.cancel(v.token);if(mode==='replace')s.prepare(p,1,request('trail-coat','craft'),0);assert.throws(()=>s.confirm(p,mode==='generation'?2:1,v.token,1,mode==='expiry'?60000:1),/过期/);assert.equal(Object.hasOwn(p,'equipment'),false);}
 for(const change of [(p:Profile)=>p.coins--,(p:Profile)=>p.bag.gel--,(p:Profile)=>p.leisure.materials.ore--,(p:Profile)=>p.leisure.materials.herb--,(p:Profile)=>p.sequence++,(p:Profile)=>{p.equipment=initialEquipment();p.equipment.ownedIDs.push('trail-coat');}]){const p=ready(),s=new InventoryActionSession(),v=s.prepare(p,1,request('trail-hood','craft'),0);change(p);const before=structuredClone(p);assert.throws(()=>s.confirm(p,1,v.token,1,1),/变化/);assert.deepEqual(p,before);assert.throws(()=>s.confirm(p,1,v.token,1,2),/过期/);}
 const p=ready(),s=new InventoryActionSession(),v=s.prepare(p,1,request('trail-hood','craft'),0),next=s.confirm(p,1,v.token,1,1);assert.throws(()=>s.confirm(next,1,v.token,1,2),/过期/);
});
test('both departures freeze legal IDs once, actual attacks, damage, spell, healing and travel apply',()=>{
 for(const enhanced of [false,true]){
  let p=start(outfit(),enhanced);const frozen=structuredClone(p.equipment!.active);assert.equal(p.equipment!.active!.runId,p.run!.id);assert.notEqual(p.equipment!.active!.slots,p.equipment!.slots);assert.equal(p.run!.due,enhanced?570:10);p=parseProfile(JSON.parse(JSON.stringify(p)));assert.deepEqual(p.equipment!.active,frozen);
  p.run!.hp=30;p=ticks(p,p.run!.due-p.tick);assert.equal(p.run!.hp,62);assert.equal(p.run!.enemyHP,24);p=ticks(p,10);assert.equal(p.run!.enemyHP,16);const damage=ticks(p,10);assert.equal(damage.run!.hp,60); // coat reduces attack 3 to 2
  p=act(p,{type:'skill',skill:'frost',runId:p.run!.id,wave:p.run!.wave});assert.equal(p.run!.enemyHP,6); // frost 8 + pendant 2
  p=ticks(p,10);assert.equal(p.run!.phase,'travel');assert.equal(p.run!.due-p.tick,enhanced?570:19);assert.equal(p.equipment!.active!.runId,p.run!.id);
  p=act(p,{type:'retreat'});assert.equal(p.run,null);assert.equal(p.equipment!.active,null);assert.deepEqual(parseProfile(JSON.parse(JSON.stringify(p))),p);
 }
});
test('separate equipment bonuses preserve enhanced base maxima and damage floor',()=>{
 let p=outfit();p.upgraded=true;p.cleared=[0,1];p.leisure.materials.soup=1;p=act(p,{type:'expedition-depart',region:0,budget:3,auto:false,mode:'survey',crew:'none',meal:'soup'});assert.equal(p.expedition!.active!.defence,2);p=ticks(p,570);p=ticks(p,20);assert.equal(p.run!.hp,79); // 3 - soup2 - coat1 floors at1
 assert.equal(p.expedition!.active!.attack,0);assert.equal(p.expedition!.active!.heal,6);assert.deepEqual(parseProfile(p),p);
});
test('old live runs without active equipment snapshot receive no retroactive bonuses',()=>{
 let p=start(ready());const gear=outfit().equipment!;gear.active=null;p.equipment=gear;p=parseProfile(p);p.run!.hp=30;p=ticks(p,10);assert.equal(p.run!.hp,60);p=ticks(p,10);assert.equal(p.run!.enemyHP,18);p=ticks(p,10);assert.equal(p.run!.hp,57);p=act(p,{type:'skill',skill:'frost',runId:p.run!.id,wave:p.run!.wave});assert.equal(p.run!.enemyHP,4); // two attacks 12 + frost8
});
test('leaf brooch enhances only expedition gather, exact party remainder/capacity and end clear',()=>{
 let p=start(outfit('leaf-brooch'),true,4);p.expedition!.carry.ore=95;p.expedition!.carry.herb=95;assert.ok(hasRoomForExpeditionWin(p,4));p=ticks(p,570,4);p=act(p,{type:'skill',skill:'shatter',runId:p.run!.id,wave:p.run!.wave},4);p=act(p,{type:'skill',skill:'frost',runId:p.run!.id,wave:p.run!.wave},4);p=ticks(p,10,4);assert.deepEqual([p.expedition!.cargo.ore,p.expedition!.cargo.herb,p.expedition!.carry.ore,p.expedition!.carry.herb],[3,3,25,25]);assert.equal(p.expedition!.cargo.marks,2);assert.equal(p.expedition!.active!.gather,0);
 const cap=start(outfit('leaf-brooch'),true,4);cap.expedition!.cargo.ore=999999;cap.expedition!.carry.ore=99;assert.equal(hasRoomForExpeditionWin(cap,4),false);const end=ticks(cap,570,4);assert.equal(end.run,null);assert.equal(end.equipment!.active,null);assert.equal(end.bag.ration,cap.bag.ration+3);assert.equal(end.expedition!.cargo.ore,999999);
 const exact=start(outfit('leaf-brooch'),true);exact.expedition!.cargo.ore=999998;exact.expedition!.cargo.herb=999998;assert.equal(hasRoomForExpeditionWin(exact),true);let done=ticks(exact,570);done=act(done,{type:'skill',skill:'shatter',runId:done.run!.id,wave:done.run!.wave});done=act(done,{type:'skill',skill:'frost',runId:done.run!.id,wave:done.run!.wave});done=ticks(done,10);assert.equal(done.expedition!.cargo.ore,1000000);assert.equal(done.expedition!.cargo.herb,1000000);
 let basic=start(outfit('leaf-brooch'));basic=ticks(basic,10);basic=act(basic,{type:'skill',skill:'shatter',runId:basic.run!.id,wave:basic.run!.wave});basic=act(basic,{type:'skill',skill:'frost',runId:basic.run!.id,wave:basic.run!.wave});basic=ticks(basic,10);assert.equal(basic.expedition,undefined);
 let last=start(outfit());last=act(last,{type:'retreat'});last.bag.ration=1;last=act(last,{type:'start-run',region:0,budget:1,auto:true});last=ticks(last,20);assert.equal(last.run,null);assert.equal(last.equipment!.active,null);
});


test('nonprimitive equipment discriminators cannot reverse equip or mutate a worn item',()=>{
 const p=equip(ready(),'trail-hood'),before=structuredClone(p);
 for(const type of [['equipment-craft'],['equipment-equip'],['equipment-unequip'],new String('equipment-equip'),null,1,{toString:()=>{throw Error('must not coerce');}}]){
  const action={type,id:'trail-hood'};assert.equal(parseEquipmentAction(action),null);assert.throws(()=>parseAction(action));
  assert.throws(()=>transact(p,{sequence:p.sequence+1,requestId:'equipment-invalid-type',action}));assert.deepEqual(p,before);assert.equal(p.equipment!.slots.head,'trail-hood');
 }
 assert.deepEqual(parseAction({type:'equipment-unequip',id:'trail-hood'}),{type:'equipment-unequip',id:'trail-hood'});
});

test('direct sparse equipment ownership rejects before owned-item projection; dense valid sets persist',()=>{
 const p=ready();p.equipment=initialEquipment();assert.deepEqual(parseProfile(p),p);
 for(const ownedIDs of [Array(1),Object.assign(Array(2),{1:'trail-hood'}),[undefined],['trail-hood',undefined]]){
  const q=structuredClone(p);q.equipment!.ownedIDs=ownedIDs as EquipmentId[];assert.throws(()=>parseProfile(q),/拥有集/);assert.throws(()=>parseProfile(JSON.parse(JSON.stringify(q))),/拥有集/);
 }
 p.equipment.ownedIDs=['trail-hood'];assert.deepEqual(parseProfile(p),p);assert.equal(equipmentOwnedEntries(p)[0].id,'equipment:trail-hood');
});
