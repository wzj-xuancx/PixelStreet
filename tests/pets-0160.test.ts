import test from 'node:test';
import assert from 'node:assert/strict';
import {initialProfile,parseProfile,parseAction,transact,advance,petsOf,petIdentity,petOwnedEntries,petRecipeEntries,petEffects,activePetEffects,initialPets,PET_GEAR_IDS,PET_GEAR_CATALOG,PET_SLOTS,streetPetPresence,hasRoomForExpeditionWin,type Profile,type GameAction,type PetGearId} from '../packages/solo-core';
import {inventoryEntries} from '../packages/solo-core/inventory-view';
import {inventoryAction,inventoryCapabilities,parseInventoryActionRequest,type InventoryActionKind} from '../packages/solo-core/inventory-actions';
import {InventoryActionSession} from '../apps/desktop/inventory-session';
const ready=()=>{const p=initialProfile(1000);p.job='keeper';p.coins=1000;p.bag.gel=30;p.bag.ration=30;p.leisure.materials.ore=100;p.leisure.materials.herb=100;p.totals.wins=1;return p;};
const act=(p:Profile,action:GameAction,party=1)=>transact(p,{sequence:p.sequence+1,requestId:'pets-test-'+(p.sequence+1),action},party);
const request=(id:PetGearId,kind:InventoryActionKind,count=1)=>({itemId:'petgear:'+id,kind,count});
const role=(p:Profile,value:'leisure'|'expedition'='expedition')=>act(p,{type:'pet-role',petId:'slime',role:value});
const outfit=()=>{let p=role(ready());for(const id of PET_GEAR_IDS){p=act(p,{type:'petgear-craft',id});p=act(p,{type:'petgear-equip',id});}return p;};
const start=(p:Profile,crew='slime',party=1)=>act(p,{type:'expedition-depart',region:0,budget:3,auto:false,mode:'survey',crew,meal:'none'},party);
const ticks=(p:Profile,n:number,party=1)=>advance(p,p.wallAt+n*100,party);
const win=(p:Profile,party=1)=>{p=ticks(p,p.run!.due-p.tick,party);p=act(p,{type:'skill',skill:'frost',runId:p.run!.id,wave:p.run!.wave},party);return act(p,{type:'skill',skill:'shatter',runId:p.run!.id,wave:p.run!.wave},party);};
test('old absent/job/live profiles read and advance without installing pets; initial identity is actual slime XP',()=>{
 const p=initialProfile(1000),before=JSON.stringify(p);petsOf(p);petIdentity(p);petOwnedEntries(p);petRecipeEntries(p);inventoryEntries(p);inventoryCapabilities(p,'pet:slime');inventoryAction(p,{itemId:'pet:slime',kind:'pet-expedition',count:1});inventoryAction(p,request('moss-collar','craft'));assert.equal(JSON.stringify(p),before);assert.equal(Object.hasOwn(parseProfile(p),'pets'),false);assert.equal(Object.hasOwn(ticks(p,10),'pets'),false);
 for(const job of ['visitor','apprentice','keeper'] as const){const q=ready();q.job=job;assert.deepEqual(parseProfile(q),q);}
 for(const q of [start(ready()),act(ready(),{type:'stroll-start',zone:0,route:'balanced',trips:1}),act(ready(),{type:'start-run',region:0,budget:1,auto:false})]){assert.deepEqual(parseProfile(q),q);assert.equal(Object.hasOwn(ticks(q,20),'pets'),false);}
 let grown=ready();grown.leisure.materials.biscuit=1;grown=act(grown,{type:'companion-feed',companion:'slime'});grown=role(grown);assert.equal(petIdentity(grown).xp,1);assert.equal(grown.leisure.companions.slime,1);assert.equal(petIdentity(grown).name,'苔团子');assert.equal(petIdentity(grown).source,'初始伙伴·已结识');assert.deepEqual(Object.keys(grown.pets!).sort(),['active','ownedGearIDs','petId','role','slots','version']);
});
test('exact three recipes first-win lock, charges once, no free gifts and unique ownership',()=>{
 let locked=ready();locked.totals.wins=0;assert.ok(petRecipeEntries(locked).every(r=>!r.unlocked&&r.requiredWins===1));for(const id of PET_GEAR_IDS){assert.match(inventoryAction(locked,request(id,'craft')).quote.reason,/首次挂机胜利/);assert.throws(()=>act(locked,{type:'petgear-craft',id}),/首次挂机胜利/);}assert.equal(locked.pets,undefined);
 const expected={'moss-collar':[6,2,0,0],'leaf-guard':[8,2,2,0],'sun-charm':[8,0,1,2]};let p=ready();for(const id of PET_GEAR_IDS){const before=structuredClone(p),s=new InventoryActionSession(),v=s.prepare(p,1,request(id,'craft'),0),d=PET_GEAR_CATALOG[id];assert.deepEqual([d.coins,d.gel,d.ore,d.herb],expected[id]);assert.deepEqual(v.quote.costs!.map(c=>[c.itemId,c.count]),[['coins',d.coins],['bag:gel',d.gel],['materials:ore',d.ore],['materials:herb',d.herb]].filter(c=>c[1]));assert.deepEqual(p,before);p=s.confirm(p,1,v.token,1,1);assert.deepEqual([before.coins-p.coins,before.bag.gel-p.bag.gel,before.leisure.materials.ore-p.leisure.materials.ore,before.leisure.materials.herb-p.leisure.materials.herb],expected[id]);assert.throws(()=>act(p,{type:'petgear-craft',id}),/已持有/);assert.deepEqual(parseProfile(p),p);}
 assert.equal(inventoryEntries(p).filter(e=>e.source==='petgear').length,3);const poor=ready();poor.coins=0;assert.throws(()=>act(poor,{type:'petgear-craft',id:'moss-collar'}),/不足/);assert.equal(poor.pets,undefined);
 // The unlock is obtained from a real ticked basic victory as well as historical totals.
 let earned=ready();earned.totals.wins=0;earned=act(earned,{type:'start-run',region:0,budget:1,auto:false});earned=win(earned);earned=act(earned,{type:'retreat'});assert.equal(earned.totals.wins,1);assert.equal(petRecipeEntries(earned)[0].unlocked,true);
});
test('three distinct slots retain owned gear, bag excludes equipped and unequip returns same ID',()=>{
 let p=outfit();assert.equal(PET_SLOTS.filter(s=>p.pets!.slots[s]).length,3);assert.equal(inventoryEntries(p).filter(e=>e.source==='petgear').length,0);assert.equal(petOwnedEntries(p).filter(e=>e.equipped).length,3);assert.deepEqual(petEffects(p.pets!.slots),{attack:1,defence:1,gather:1});
 p=act(p,inventoryAction(p,request('moss-collar','unequip')).action);assert.equal(p.pets!.slots.collar,null);assert.deepEqual(inventoryEntries(p).filter(e=>e.source==='petgear').map(e=>e.id),['petgear:moss-collar']);assert.equal(p.pets!.ownedGearIDs.length,3);assert.throws(()=>act(p,{type:'petgear-unequip',id:'moss-collar'}),/尚未穿戴/);assert.throws(()=>act(ready(),{type:'petgear-equip',id:'moss-collar'}),/尚未持有/);
});
test('strict unknown saves/actions, illegal/unowned/duplicate slots and counts reject',()=>{
 for(const change of [(p:Profile)=>{(p.pets as any).xp=1;},(p:Profile)=>{(p.pets as any).petId='fox';},(p:Profile)=>{(p.pets as any).role='active';},(p:Profile)=>{p.pets!.ownedGearIDs.push('moss-collar');},(p:Profile)=>{(p.pets!.ownedGearIDs as any).push('unknown');},(p:Profile)=>{p.pets!.slots.collar='leaf-guard';},(p:Profile)=>{p.pets!.ownedGearIDs=[];},(p:Profile)=>{p.pets!.ownedGearIDs=Array(1);},(p:Profile)=>{(p.pets!.slots as any).extra=null;},(p:Profile)=>{p.pets!.active={runId:'run-999',petId:'slime',slots:{...p.pets!.slots}};}]){const p=outfit();change(p);assert.throws(()=>parseProfile(p));}
 for(const raw of [{type:'pet-role',petId:'fox',role:'expedition'},{type:'pet-role',petId:'slime',role:'combat'},{type:'pet-role',petId:'slime',role:'expedition',xp:0},{type:'petgear-craft',id:'unknown'},{type:['petgear-unequip'],id:'moss-collar'},{type:'petgear-equip',id:'moss-collar',slot:'guard'}])assert.throws(()=>parseAction(raw));
 for(const count of [0,-1,1.5,2,NaN,Infinity]){assert.throws(()=>inventoryAction(ready(),request('moss-collar','craft',count)));assert.throws(()=>inventoryAction(ready(),{itemId:'pet:slime',kind:'pet-expedition',count}));}
 for(const itemId of ['pet:fox','petgear:unknown','petgear:moss-collar','pet:slime'])for(const kind of ['use','sell'] as const)assert.throws(()=>inventoryAction(ready(),{itemId,kind,count:1}));assert.throws(()=>parseInventoryActionRequest({itemId:'pet:slime',kind:'pet-combat',count:1}));
});
test('role changes retain one identity and enforce camp job, explicit leisure and stroll lead conflicts',()=>{
 let p=ready();p.xp=1000;p.leisure.companions.guide=0;p=act(p,{type:'companion-equip',companion:'guide'});p=act(p,{type:'camp-job',job:'counter',companion:'slime'});assert.throws(()=>role(p),/岗位/);assert.equal(p.pets,undefined);assert.deepEqual(parseProfile(p),p);
 p=act(p,{type:'camp-job',job:'counter',companion:null});p=role(p);assert.throws(()=>act(p,{type:'camp-job',job:'counter',companion:'slime'}),/挂机职责/);p=act(p,{type:'companion-equip',companion:'slime'});assert.throws(()=>act(p,{type:'stroll-start',zone:0,route:'balanced',trips:1}),/挂机职责/);
 p=role(p,'leisure');assert.throws(()=>start(p),/宠物页/);assert.equal(p.leisure.active,'slime');assert.equal(p.pets!.petId,'slime');assert.equal(p.pets!.active,null);assert.ok(act(p,{type:'stroll-start',zone:0,route:'balanced',trips:1}).leisure.run);
 // Explicitly selecting the default role is a successful opt in; pure reads are not.
 const explicit=role(ready(),'leisure');assert.equal(explicit.pets!.role,'leisure');assert.throws(()=>start(explicit),/休闲职责/);
});
test('all role and gear changes lock during either live run, no implicit job removal or retreat',()=>{
 for(const p of [start(outfit()),act(role(ready(),'leisure'),{type:'stroll-start',zone:0,route:'balanced',trips:1})])for(const action of [{type:'pet-role',petId:'slime',role:'leisure'},{type:'pet-role',petId:'slime',role:'expedition'},{type:'petgear-craft',id:'moss-collar'},{type:'petgear-equip',id:'moss-collar'},{type:'petgear-unequip',id:'moss-collar'}] as GameAction[]){const before=structuredClone(p);assert.throws(()=>act(p,action),/回营/);assert.deepEqual(p,before);}
});
test('P2b session exact role mapping, stale inputs, cancellation, expiry, generation and replay',()=>{
 for(const kind of ['pet-leisure','pet-expedition'] as const){const p=ready(),v=inventoryAction(p,{itemId:'pet:slime',kind,count:1});assert.deepEqual(v.action,{type:'pet-role',petId:'slime',role:kind==='pet-leisure'?'leisure':'expedition'});assert.equal(v.quote.proceeds,0);}
 for(const change of [(p:Profile)=>p.coins--,(p:Profile)=>p.bag.gel--,(p:Profile)=>p.leisure.materials.ore--,(p:Profile)=>p.leisure.materials.herb--,(p:Profile)=>p.totals.wins++,(p:Profile)=>p.sequence++,(p:Profile)=>p.leisure.companions.slime=(p.leisure.companions.slime??0)+1,(p:Profile)=>{p.pets=initialPets();}]){const p=ready(),s=new InventoryActionSession(),v=s.prepare(p,1,request('moss-collar','craft'),0);change(p);assert.throws(()=>s.confirm(p,1,v.token,1,1),/变化/);assert.throws(()=>s.confirm(p,1,v.token,1,2),/过期/);}
 for(const mode of ['cancel','expiry','generation','replace']){const p=ready(),s=new InventoryActionSession(),v=s.prepare(p,1,{itemId:'pet:slime',kind:'pet-expedition',count:1},0);if(mode==='cancel')s.cancel(v.token);if(mode==='replace')s.prepare(p,1,request('sun-charm','craft'),0);assert.throws(()=>s.confirm(p,mode==='generation'?2:1,v.token,1,mode==='expiry'?60000:1),/过期/);assert.equal(p.pets,undefined);}
 const p=ready(),s=new InventoryActionSession(),v=s.prepare(p,1,{itemId:'pet:slime',kind:'pet-expedition',count:1},0),next=s.confirm(p,1,v.token,1,1);assert.equal(next.pets!.role,'expedition');assert.throws(()=>s.confirm(next,1,v.token,1,2),/过期/);
});
test('enhanced slime freezes same pet IDs once; actual attack and defence tick once and persist',()=>{
 let p=start(outfit());assert.deepEqual(p.pets!.active,{runId:p.run!.id,petId:'slime',slots:p.pets!.slots});assert.notEqual(p.pets!.active!.slots,p.pets!.slots);p=parseProfile(JSON.parse(JSON.stringify(p)));p.run!.hp=30;p=ticks(p,600);assert.equal(p.run!.hp,60);p=ticks(p,10);assert.equal(p.run!.enemyHP,17);p=ticks(p,10);assert.equal(p.run!.hp,58); // attack6+collar1, damage3-guard1
 assert.equal(p.expedition!.active!.gel,1);assert.equal(p.expedition!.active!.attack,0);assert.equal(p.expedition!.active!.defence,0);
 const corrupt=structuredClone(p);corrupt.pets!.active!.slots.collar=null;assert.throws(()=>parseProfile(corrupt),/快照/);const wrong=structuredClone(p);wrong.pets!.active!.petId='fox' as any;assert.throws(()=>parseProfile(wrong));
 p=act(p,{type:'retreat'});assert.equal(p.pets!.active,null);assert.equal(p.pets!.role,'expedition');assert.deepEqual(parseProfile(JSON.parse(JSON.stringify(p))),p);
});
test('player and pet attack/defence stack once, injury floors at one',()=>{
 let p=outfit();for(const id of ['trail-gloves','trail-coat'] as const){p=act(p,{type:'equipment-craft',id});p=act(p,{type:'equipment-equip',id});}p.leisure.materials.soup=1;p=act(p,{type:'expedition-depart',region:0,budget:3,auto:false,mode:'survey',crew:'slime',meal:'soup'});p=ticks(p,600);p=ticks(p,10);assert.equal(p.run!.enemyHP,16);p=ticks(p,10);assert.equal(p.run!.hp,69); // attack6+glove1+collar1; 3-soup2-coat1-guard1 =>1
});
test('other crew/basic/legacy/leisure get no pet equipment effect or snapshot',()=>{
 for(const mode of ['other','basic','legacy','leisure'] as const){let p=outfit();if(mode==='other')p=start(p,'none');if(mode==='basic')p=act(p,{type:'start-run',region:0,budget:3,auto:false});if(mode==='legacy'){p=start(p);delete p.pets;}if(mode==='leisure'){p=role(p,'leisure');p=act(p,{type:'stroll-start',zone:0,route:'balanced',trips:1});}assert.deepEqual(activePetEffects(p),{attack:0,defence:0,gather:0});assert.equal(p.pets?.active??null,null);if(p.run){p=ticks(p,p.run.due-p.tick);p=ticks(p,10);assert.equal(p.run!.enemyHP,18);}}
});
test('charm + player brooch use identical exact capacity, remainder and real settlement formula',()=>{
 let p=outfit();p=act(p,{type:'equipment-craft',id:'leaf-brooch'});p=act(p,{type:'equipment-equip',id:'leaf-brooch'});p=start(p,'slime',4);p.expedition!.carry.ore=95;p.expedition!.carry.herb=95;assert.equal(hasRoomForExpeditionWin(p,4),true);p=win(p,4);assert.deepEqual([p.expedition!.cargo.ore,p.expedition!.cargo.herb,p.expedition!.carry.ore,p.expedition!.carry.herb],[4,4,40,40]);assert.equal(p.expedition!.active!.gather,0);assert.equal(p.expedition!.active!.won,1);assert.equal(p.run!.loot,win(start(ready(),'slime',4),4).run!.loot);assert.equal(p.totals.wins,2);const gel=p.run!.loot;
 p=act(p,{type:'retreat'},4);assert.equal(p.pets!.active,null);assert.equal(p.bag.gel,30-4+gel);p=act(p,{type:'expedition-claim'},4);assert.equal(p.leisure.materials.ore,96+4);assert.equal(p.leisure.materials.herb,96+4);
 const cap=start(outfit(),'slime',4);cap.expedition!.cargo.ore=999999;cap.expedition!.carry.ore=99;assert.equal(hasRoomForExpeditionWin(cap,4),false);const stopped=ticks(cap,600,4);assert.equal(stopped.run,null);assert.equal(stopped.pets!.active,null);assert.equal(stopped.bag.ration,cap.bag.ration+3);assert.equal(stopped.expedition!.cargo.ore,999999);
 let exact=start(outfit());exact.expedition!.cargo.ore=999998;exact.expedition!.cargo.herb=999998;assert.equal(hasRoomForExpeditionWin(exact),true);exact=win(exact);assert.equal(exact.expedition!.cargo.ore,1000000);assert.equal(exact.expedition!.cargo.herb,1000000);
});
test('natural supply finish clears snapshot while keeping role, and location uses one slime ID',()=>{
 let p=start(outfit());assert.deepEqual(streetPetPresence(p,'camp'),{petId:'slime',role:'expedition',location:'field',visible:false});assert.equal(streetPetPresence(p,'field').visible,true);p=ticks(p,3000);assert.equal(p.run,null);assert.equal(p.pets!.active,null);assert.equal(p.pets!.role,'expedition');assert.equal(streetPetPresence(p,'camp').visible,true);assert.equal(streetPetPresence(p,'field').visible,false);assert.deepEqual(parseProfile(p),p);
 const stroll=act(ready(),{type:'stroll-start',zone:0,route:'balanced',trips:1});assert.equal(streetPetPresence(stroll,'camp').location,'away');assert.equal(streetPetPresence(stroll,'camp').visible,false);
});


test('same slime support obeys explicit duties, actual away location and absent-pets legacy compatibility',()=>{
 let p=ready();p.leisure.companions.guide=0;p=act(p,{type:'companion-equip',companion:'guide'});p=act(p,{type:'buddy-support',companion:'slime'});p=role(p);
 const before=structuredClone(p);assert.throws(()=>act(p,{type:'stroll-start',zone:0,route:'balanced',trips:1}),/挂机职责/);assert.deepEqual(p,before);assert.equal(p.leisure.bonds!.support,'slime');
 p=role(p,'leisure');p=act(p,{type:'stroll-start',zone:0,route:'balanced',trips:1});assert.equal(p.leisure.run!.companion,'guide');assert.equal(p.leisure.run!.bonds!.support,'slime');
 for(const view of ['camp','field'] as const)assert.deepEqual(streetPetPresence(p,view),{petId:'slime',role:'leisure',location:'away',visible:false});
 assert.deepEqual(parseProfile(JSON.parse(JSON.stringify(p))),p);const forged=structuredClone(p);forged.pets!.role='expedition';assert.throws(()=>parseProfile(forged),/悠游冲突/);
 const legacy=structuredClone(p);delete legacy.pets;const legacyBefore=structuredClone(legacy);assert.deepEqual(parseProfile(legacy),legacy);const later=ticks(legacy,1);assert.equal(later.pets,undefined);assert.equal(later.leisure.run!.companion,'guide');assert.equal(later.leisure.run!.bonds!.support,'slime');assert.equal(streetPetPresence(later,'camp').visible,false);assert.deepEqual(legacy,legacyBefore);
});
