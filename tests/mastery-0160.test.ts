import test from 'node:test';
import assert from 'node:assert/strict';
import {initialProfile,parseProfile,parseAction,transact,advance,masteryOf,masteryView,masteryChapters,MASTERY_IDS,PET_GEAR_IDS,towerView,parseEnvelope,type Profile,type GameAction,type Recipe,type PriceTier} from '../packages/solo-core';
import {parseCommand} from '../packages/protocol';
const act=(p:Profile,action:GameAction)=>transact(p,{sequence:p.sequence+1,requestId:'mastery-test-'+(p.sequence+1),action});
const ticks=(p:Profile,n:number)=>advance(p,p.wallAt+n*100);
const ready=()=>{const p=initialProfile(1000);p.job='keeper';p.coins=2000;p.bag.gel=40;p.bag.ration=30;p.bag.crystal=20;p.leisure.materials.ore=100;p.leisure.materials.herb=100;return p;};
const start=(p=ready())=>act(p,{type:'mastery-start'});
const status=(p:Profile,id:string)=>masteryView(p).find(v=>v.id===id)!.status;
const sale=(p:Profile,recipe:Recipe,tier:PriceTier,count=1)=>{p=act(p,{type:'price-shelf',recipe,tier});p=act(p,{type:'stock-shelf',recipe,count});if(!p.retail)p=act(p,{type:'retail',enabled:true});return ticks(p,p.business.shelves[recipe].due-p.tick);};
const gear=(p:Profile,accessory:'blue-pendant'|'leaf-brooch'='blue-pendant')=>{for(const id of ['trail-hood','trail-coat','trail-gloves','trail-boots','trail-sword',accessory] as const){p=act(p,{type:'equipment-craft',id});p=act(p,{type:'equipment-equip',id});}return p;};
const basic=(p:Profile)=>act(p,{type:'start-run',region:0,budget:1,auto:false});
const enhanced=(p:Profile,mode:'survey'|'forage'='forage',region=0,crew='none',meal:'none'|'soup'='none')=>act(p,{type:'expedition-depart',region,budget:3,auto:false,mode,crew,meal});
const fight=(p:Profile)=>ticks(p,p.run!.due-p.tick);
const combo=(p:Profile)=>{const runId=p.run!.id,wave=p.run!.wave;p=act(p,{type:'skill',skill:'frost',runId,wave});return act(p,{type:'skill',skill:'shatter',runId,wave});};
const back=(p:Profile)=>p.run?act(p,{type:'retreat'}):p;
const wealth=(p:Profile)=>({coins:p.coins,xp:p.xp,bag:p.bag,materials:p.leisure.materials,totals:p.totals,gear:p.equipment,pets:p.pets,tower:p.tower});

test('explicit start only, pure views preserve absent extension and full old20 raw data',()=>{
 let p=ready();p.totals={crafted:100,sold:100,earned:1000,wins:100};const view=towerView(p);p.tower={version:1,claimed:0,progress:view.floors.map(f=>f.required)};p.tower.claimed=20;const old=structuredClone(p.tower),before=JSON.stringify(p);masteryOf(p);masteryView(p);masteryChapters(p);assert.equal(JSON.stringify(p),before);assert.equal(parseProfile(p).mastery,undefined);p=ticks(p,2);assert.equal(p.mastery,undefined);p=start(p);assert.deepEqual(p.tower,old);assert.equal(p.mastery!.startedTick,p.tick);assert.equal(p.mastery!.startedSequence,p.sequence);assert.ok(masteryView(p).every(v=>v.status==='active'&&v.progress===0));assert.throws(()=>start(p),/已经开启/);assert.deepEqual(parseProfile(JSON.parse(JSON.stringify(p))),p);
});

test('actual paired sale captures both shelves before decrement; full till, no stock and prestart do not count',()=>{
 let p=ready();p=act(p,{type:'stock-shelf',recipe:'ration',count:1});p=act(p,{type:'stock-shelf',recipe:'crystal',count:1});p=act(p,{type:'retail',enabled:true});p=ticks(p,300);assert.equal(p.mastery,undefined);p=start(p);assert.equal(status(p,'paired-shelves'),'active');p=act(p,{type:'stock-shelf',recipe:'ration',count:1});p=act(p,{type:'stock-shelf',recipe:'crystal',count:1});p.business.till=1e9;p=ticks(p,300);assert.equal(p.mastery!.shelves,0);p.business.till=0;p=ticks(p,1);assert.equal(p.mastery!.shelves,3);assert.equal(p.business.shelves.ration.stock,0);assert.equal(p.business.shelves.crystal.stock,0);assert.equal(status(p,'paired-shelves'),'ready');
 let alone=start();alone=sale(alone,'ration','quick');assert.equal(alone.mastery!.shelves,0);
});

test('price choice requires actual quick and premium sales of SAME recipe; changing price is insufficient',()=>{
 let p=start();p=act(p,{type:'price-shelf',recipe:'ration',tier:'quick'});p=act(p,{type:'price-shelf',recipe:'ration',tier:'premium'});assert.equal(p.mastery!.quick,0);p=sale(p,'ration','quick');p=sale(p,'crystal','premium');assert.equal(status(p,'price-choice'),'active');assert.equal(masteryView(p).find(v=>v.id==='price-choice')!.progress,1);p=sale(p,'ration','premium');assert.equal(status(p,'price-choice'),'ready');assert.equal(p.mastery!.quick,1);assert.equal(p.mastery!.premium,3);
});

test('two actual order recipes; accepting, cancelling, repeated ration and failed delivery never invent history',()=>{
 let p=start();const deliver=(p:Profile,slot:number)=>{const revision=p.business.orders[slot].revision;p=act(p,{type:'order-accept',slot,revision});return act(p,{type:'order-deliver',slot,revision});};assert.equal(p.business.orders[0].recipe,'ration');assert.equal(p.business.orders[1].recipe,'crystal');p=act(p,{type:'order-accept',slot:1,revision:0});p=act(p,{type:'order-cancel',slot:1,revision:0});assert.equal(p.mastery!.orders,0);p=deliver(p,0);p=deliver(p,0);assert.equal(p.mastery!.orders,1);const fail=structuredClone(p);fail.bag.crystal=0;const accepted=act(fail,{type:'order-accept',slot:1,revision:0});assert.throws(()=>act(accepted,{type:'order-deliver',slot:1,revision:0}),/不足/);assert.equal(accepted.mastery!.orders,1);p=deliver(p,1);assert.equal(status(p,'two-recipes'),'ready');
});

test('six frozen slots + marked blue combo only on actual won encounter, old wins and bare ownership do not count',()=>{
 let p=gear(start());assert.equal(status(p,'ready-six'),'active');p=basic(p);assert.equal(p.equipment!.active!.runId,p.run!.id);p=fight(p);p=combo(p);assert.equal(status(p,'ready-six'),'ready');assert.equal(p.mastery!.proofs.length,2);assert.equal(p.mastery!.proofs.find(v=>v.kind==='blue')!.combo,true);assert.equal(p.mastery!.comboRun,null);assert.equal(status(p,'two-builds'),'active');
 let bare=start();bare=act(bare,{type:'equipment-craft',id:'blue-pendant'});bare=combo(fight(basic(bare)));assert.ok(!bare.mastery!.proofs.some(v=>v.kind==='blue'));assert.equal(status(bare,'ready-six'),'active');
 let pre=gear(ready());pre=combo(fight(basic(pre)));pre=start(pre);assert.equal(status(pre,'ready-six'),'active');assert.equal(pre.mastery!.proofs.length,0);
 let unmarked=start();unmarked=act(unmarked,{type:'equipment-craft',id:'blue-pendant'});unmarked=act(unmarked,{type:'equipment-equip',id:'blue-pendant'});unmarked=fight(basic(unmarked));unmarked=act(unmarked,{type:'skill',skill:'shatter',runId:unmarked.run!.id,wave:unmarked.run!.wave});unmarked=ticks(unmarked,30);assert.equal(unmarked.totals.wins,1);assert.ok(!unmarked.mastery!.proofs.some(v=>v.kind==='blue'));
});

test('two builds require blue marked win plus independent leaf FORAGE win; survey or current gear cannot substitute',()=>{
 let p=start();for(const id of ['blue-pendant','leaf-brooch'] as const)p=act(p,{type:'equipment-craft',id});p=act(p,{type:'equipment-equip',id:'blue-pendant'});p=back(combo(fight(basic(p))));assert.equal(status(p,'two-builds'),'active');p=act(p,{type:'equipment-equip',id:'leaf-brooch'});p=back(combo(fight(enhanced(p,'survey'))));assert.equal(status(p,'two-builds'),'active');p=act(p,{type:'expedition-claim'});p=back(combo(fight(enhanced(p,'forage'))));assert.equal(status(p,'two-builds'),'ready');const blue=p.mastery!.proofs.find(v=>v.kind==='blue')!,leaf=p.mastery!.proofs.find(v=>v.kind==='leaf')!;assert.notEqual(blue.runId,leaf.runId);assert.equal(blue.gear.accessory,'blue-pendant');assert.equal(leaf.gear.accessory,'leaf-brooch');assert.equal(leaf.mode,'forage');assert.equal(p.mastery!.proofs.length,2);assert.deepEqual(parseProfile(JSON.parse(JSON.stringify(p))),p);
});

test('moss guardian requires same frozen three pet slots, soup, enhanced slime crew and deep actual win',()=>{
 let p=start();p.totals.wins=1;p.cleared=[0];p.leisure.materials.soup=4;p=act(p,{type:'pet-role',petId:'slime',role:'expedition'});for(const id of PET_GEAR_IDS){p=act(p,{type:'petgear-craft',id});p=act(p,{type:'petgear-equip',id});}
 for(const [crew,meal,region] of [['none','soup',1],['slime','none',1],['slime','soup',0]] as const){let q=fight(enhanced(p,'survey',region,crew,meal));q=combo(q);if(q.run?.phase==='fight')q=ticks(q,40);assert.ok(q.totals.wins>p.totals.wins);assert.equal(status(q,'moss-guardian'),'active');}
 p=fight(enhanced(p,'survey',1,'slime','soup'));assert.equal(status(p,'moss-guardian'),'active');p=combo(p);if(p.run?.phase==='fight')p=ticks(p,40);assert.equal(status(p,'moss-guardian'),'ready');const proof=p.mastery!.proofs.find(v=>v.kind==='moss')!;assert.equal(proof.crew,'slime');assert.deepEqual(Object.values(proof.pet).sort(),PET_GEAR_IDS.slice().sort());assert.equal(proof.region,1);assert.equal(proof.meal,'soup');p=back(p);assert.equal(p.pets!.active,null);assert.deepEqual(parseProfile(JSON.parse(JSON.stringify(p))),p);
});

test('capacity-rejected win creates no proof and clears live combo; successful evidence never grows beyond four',()=>{
 let p=fight(basic(gear(start())));p=act(p,{type:'skill',skill:'frost',runId:p.run!.id,wave:p.run!.wave});p.coins=1e9;p=act(p,{type:'skill',skill:'shatter',runId:p.run!.id,wave:p.run!.wave});assert.equal(p.totals.wins,0);assert.equal(p.mastery!.proofs.length,0);assert.equal(p.mastery!.comboRun,null);assert.equal(p.run,null);assert.equal(p.bag.ration,30);
 let q=fight(enhanced(gear(start())));q=act(q,{type:'skill',skill:'frost',runId:q.run!.id,wave:q.run!.wave});q.expedition!.cargo.ore=1e6;q=act(q,{type:'skill',skill:'shatter',runId:q.run!.id,wave:q.run!.wave});assert.equal(q.mastery!.proofs.length,0);assert.equal(q.totals.wins,0);
});

test('claim once, owned cosmetic only, wear/unwear persistence and old tower/raw wealth do not change',()=>{
 let p=start();p=sale(p,'ration','quick');p=sale(p,'ration','premium');assert.throws(()=>act(p,{type:'mastery-wear',id:'price-choice'}),/先领取/);assert.throws(()=>act(p,{type:'mastery-claim',id:'moss-guardian'}),/尚未完成/);const before=structuredClone(wealth(p));p=act(p,{type:'mastery-claim',id:'price-choice'});assert.deepEqual(wealth(p),before);assert.throws(()=>act(p,{type:'mastery-claim',id:'price-choice'}),/已领取/);p=act(p,{type:'mastery-wear',id:'price-choice'});assert.deepEqual(wealth(p),before);assert.equal(parseProfile(JSON.parse(JSON.stringify(p))).mastery!.worn,'price-choice');p=act(p,{type:'mastery-unwear'});assert.equal(p.mastery!.worn,null);assert.deepEqual(wealth(p),before);assert.throws(()=>act(p,{type:'mastery-unwear'}),/尚未佩戴/);assert.deepEqual(masteryChapters(p),{business:false,idle:false});
});

test('strict keys, bounded bits, sparse arrays, invalid proofs/IDs and narrow tower action protocol',()=>{
 for(const change of [(p:Profile)=>{(p.mastery as any).coins=3;},(p:Profile)=>{p.mastery!.shelves=4;},(p:Profile)=>{p.mastery!.startedTick=p.tick+1;},(p:Profile)=>{p.mastery!.claimed=Array(1);},(p:Profile)=>{p.mastery!.proofs=Array(1);},(p:Profile)=>{p.mastery!.claimed=['unknown' as any];},(p:Profile)=>{p.mastery!.worn='price-choice';},(p:Profile)=>{p.mastery!.comboRun='run-999';},(p:Profile)=>{p.mastery!.claimed=['ready-six'];}]){const p=start();change(p);assert.throws(()=>parseProfile(p));}
 let p=combo(fight(basic(gear(start()))));for(const change of [(p:Profile)=>{(p.mastery!.proofs[0] as any).extra=1;},(p:Profile)=>{p.mastery!.proofs[0].gear.head='unknown' as any;},(p:Profile)=>{p.mastery!.proofs[0].gear.head=null;},(p:Profile)=>{p.mastery!.proofs.push(structuredClone(p.mastery!.proofs[0]));},(p:Profile)=>{p.mastery!.proofs[1].combo=false;}]){const q=structuredClone(p);change(q);assert.throws(()=>parseProfile(q));}
 for(const action of [{type:'mastery-start',id:'price-choice'},{type:'mastery-claim',id:'unknown'},{type:'mastery-wear',id:'ready-six',css:'red'},{type:'mastery-unwear',all:true}])assert.throws(()=>parseAction(action));
 for(const action of [{type:'mastery-start'},{type:'mastery-claim',id:'ready-six'},{type:'mastery-wear',id:'ready-six'},{type:'mastery-unwear'},{type:'tower-claim',floor:1}]){const envelope={sequence:1,requestId:'mastery-protocol',action};assert.deepEqual(parseCommand({type:'tower-action',envelope}),{type:'tower-action',envelope:parseEnvelope(envelope)});}
 assert.throws(()=>parseCommand({type:'tower-action',envelope:{sequence:1,requestId:'mastery-protocol',action:{type:'buy-flour'}}}));assert.equal(MASTERY_IDS.length,6);
});

test('all six real goals complete in parallel, four bounded proofs, six claims light two chapters',()=>{
 let p=start();const revisions=[0,0];for(const slot of [0,1]){p=act(p,{type:'order-accept',slot,revision:revisions[slot]});p=act(p,{type:'order-deliver',slot,revision:revisions[slot]});}
 for(const recipe of ['ration','crystal'] as const){p=act(p,{type:'price-shelf',recipe,tier:'quick'});p=act(p,{type:'stock-shelf',recipe,count:1});}p=act(p,{type:'retail',enabled:true});p=ticks(p,180);p=sale(p,'ration','premium');p=act(p,{type:'retail',enabled:false});p=gear(p);p=back(combo(fight(basic(p))));p=act(p,{type:'equipment-craft',id:'leaf-brooch'});p=act(p,{type:'equipment-equip',id:'leaf-brooch'});p=back(combo(fight(enhanced(p,'forage'))));p=act(p,{type:'expedition-claim'});p.cleared=[0];p.leisure.materials.soup=2;p=act(p,{type:'pet-role',petId:'slime',role:'expedition'});for(const id of PET_GEAR_IDS){p=act(p,{type:'petgear-craft',id});p=act(p,{type:'petgear-equip',id});}p=fight(enhanced(p,'forage',1,'slime','soup'));p=combo(p);if(p.run?.phase==='fight')p=ticks(p,40);p=back(p);assert.ok(masteryView(p).every(v=>v.status==='ready'));assert.equal(p.mastery!.proofs.length,4);const proofs=structuredClone(p.mastery!.proofs);p=act(p,{type:'expedition-claim'});p=back(combo(fight(basic(p))));assert.deepEqual(p.mastery!.proofs,proofs);const before=structuredClone(wealth(p));for(const id of MASTERY_IDS)p=act(p,{type:'mastery-claim',id});assert.deepEqual(wealth(p),before);assert.deepEqual(masteryChapters(p),{business:true,idle:true});assert.equal(p.mastery!.claimed.length,6);assert.deepEqual(parseProfile(JSON.parse(JSON.stringify(p))),p);for(const id of MASTERY_IDS)assert.throws(()=>act(p,{type:'mastery-claim',id}),/已领取/);
});

test('current gear cannot replace missing frozen snapshot; incomplete pet snapshot cannot earn moss',()=>{
 let p=fight(basic(gear(start())));p.equipment!.active=null;p=combo(p);assert.equal(status(p,'ready-six'),'active');assert.ok(!p.mastery!.proofs.some(v=>v.kind==='blue'));
 let q=start();q.totals.wins=1;q.cleared=[0];q.leisure.materials.soup=1;q=act(q,{type:'pet-role',petId:'slime',role:'expedition'});for(const id of PET_GEAR_IDS){q=act(q,{type:'petgear-craft',id});if(id!=='sun-charm')q=act(q,{type:'petgear-equip',id});}q=fight(enhanced(q,'survey',1,'slime','soup'));q=combo(q);if(q.run?.phase==='fight')q=ticks(q,40);assert.ok(q.totals.wins>=2);assert.equal(status(q,'moss-guardian'),'active');
});


test('proof enum primitives reject JSON arrays and coercible objects before granting moss readiness',()=>{
 const p=start();p.mastery!.proofs=[{kind:'moss',runId:'run-1',region:1,mode:'survey',meal:'soup',crew:'slime',gear:{head:null,body:null,hands:null,mainhand:null,accessory:null,feet:null},pet:{collar:'moss-collar',guard:'leaf-guard',charm:'sun-charm'},combo:false}];
 assert.equal(status(parseProfile(p),'moss-guardian'),'ready');
 for(const field of ['kind','mode','meal'] as const)for(const value of [[p.mastery!.proofs[0][field]],new String(p.mastery!.proofs[0][field]),{toString:()=>p.mastery!.proofs[0][field]},null,1]){
  const q=structuredClone(p);(q.mastery!.proofs[0] as any)[field]=value;assert.throws(()=>parseProfile(q),/证据身份/);
  if(Array.isArray(value))assert.throws(()=>parseProfile(JSON.parse(JSON.stringify(q))),/证据身份/);
 }
 for(const mode of [['basic'],'basic']){const q=structuredClone(p);(q.mastery!.proofs[0] as any).mode=mode;assert.throws(()=>parseProfile(JSON.parse(JSON.stringify(q))));}
 assert.equal(p.mastery!.claimed.length,0);assert.equal(p.mastery!.proofs[0].mode,'survey');
});
