import {legacyFieldAction} from './field-v1-fixture';
import test from 'node:test';
import assert from 'node:assert/strict';
import {initialProfile,transact,advance,parseProfile,parseAction,fieldOf,FIELD_FLOORS,type Profile,type GameAction} from '../packages/solo-core';
const action=legacyFieldAction;
const fresh=()=>{const p=initialProfile(0);p.job='keeper';p.bag.ration=9;return action(p,{type:'field-enter',budget:9});};
const go=(p:Profile,ms:number)=>advance(p,p.wallAt+ms);
test('explicit saved-v1 attachment fixture preserves original run and old profiles stay old',()=>{
 let p=initialProfile(0);p.job='keeper';p.bag.ration=9;p=action(p,{type:'start-run',region:0,budget:9,auto:false});p=go(p,1300);const before=structuredClone(p.run!);
 assert.equal(fieldOf(parseProfile(p)),null);p=action(p,{type:'field-enter',budget:9});for(const k of ['id','hp','remaining','spent','loot','frostReady','shatterReady','wave','phase','due','nextAttack','enemyAttack','markedUntil','region','budget','auto'] as const)assert.equal(p.run![k],before[k]);assert.equal(p.run!.enemyHP,p.run!.field!.floors[0].encounters[0].monsters.reduce((s,m)=>s+m.hp,0));
 assert.throws(()=>action(p,{type:'skill',skill:'frost',runId:p.run!.id,wave:p.run!.wave}),/横向/);
});
test('strict intents reject unknown fields, nonfinite targets and stale floor/run',()=>{
 assert.throws(()=>parseAction({type:'field-enter',budget:9,ore:5}));assert.throws(()=>parseAction({type:'field-target',runId:'run-1',floor:0,target:{kind:'ground',x:NaN}}));
 const p=fresh();assert.throws(()=>action(p,{type:'field-target',runId:'run-999',floor:0,target:{kind:'ground',x:100}}));assert.throws(()=>action(p,{type:'field-target',runId:p.run!.id,floor:1,target:{kind:'exit'}}));
});
test('walking, cancellation, mining atomic budget and ore cap',()=>{
 let p=fresh();const id=p.run!.id;p=action(p,{type:'field-target',runId:id,floor:0,target:{kind:'ground',x:200}});p=go(p,500);assert.ok(fieldOf(p)!.x>40);p=action(p,{type:'field-target',runId:id,floor:0,target:{kind:'ore',id:FIELD_FLOORS[0].ore.id}});p=go(p,4000);assert.equal(p.leisure.materials.ore,1);assert.equal(p.run!.spent,1);assert.equal(fieldOf(p)!.target,null);p=go(p,40000);assert.equal(p.leisure.materials.ore,1);
 const capped=fresh();capped.leisure.materials.ore=9999;let c=action(capped,{type:'field-target',runId:capped.run!.id,floor:0,target:{kind:'ore',id:FIELD_FLOORS[0].ore.id}});c=go(c,6000);assert.equal(c.run!.spent,0);assert.equal(c.leisure.materials.ore,9999);
});
test('mode changes preserve progress and farm repeats the selected ore',()=>{
 let p=fresh();p=action(p,{type:'field-target',runId:p.run!.id,floor:0,target:{kind:'ore',id:FIELD_FLOORS[0].ore.id}});p=go(p,1800);const b=structuredClone(p.run!);p=action(p,{type:'field-mode',runId:b.id,mode:'farm'});for(const k of ['id','hp','remaining','spent','loot','frostReady'] as const)assert.equal(p.run![k],b[k]);assert.equal(fieldOf(p)!.miningDue,b.field!.miningDue);p=go(p,38000);assert.equal(p.leisure.materials.ore,2);assert.equal(p.run!.spent,2);
});
test('push crosses two gated floors, 100/500ms elapsed partitions agree',()=>{
 let p=fresh();assert.throws(()=>action(p,{type:'field-target',runId:p.run!.id,floor:0,target:{kind:'exit'}}),/清除/);p.upgraded=true;p.run!.hp=80;p=action(p,{type:'field-mode',runId:p.run!.id,mode:'push'});
 let a=p,b=p;for(let i=0;i<2000;i++)a=go(a,100);for(let i=0;i<400;i++)b=go(b,500);assert.deepEqual(a,b);assert.equal(a.run,null);assert.equal(a.totals.wins,6);assert.ok(a.lastTrip.includes('两关'));
});
test('manual cancel stops mining; no-target farm does not choose a resource',()=>{
 let p=fresh();assert.throws(()=>action(p,{type:'field-mode',runId:p.run!.id,mode:'farm'}),/先点选/);
 p=action(p,{type:'field-target',runId:p.run!.id,floor:0,target:{kind:'ore',id:'f0-ore'}});p=go(p,2500);assert.ok(fieldOf(p)!.miningDue>p.tick);p=action(p,{type:'field-target',runId:p.run!.id,floor:0,target:{kind:'ground',x:40}});p=go(p,10000);assert.equal(p.leisure.materials.ore,0);assert.equal(p.run!.spent,0);assert.equal(fieldOf(p)!.target,null);
});
test('defeat returns without safe point; after a victory it recovers at that point and farms',()=>{
 let p=fresh();p.run!.hp=1;p=action(p,{type:'field-mode',runId:p.run!.id,mode:'push'});p=go(p,12000);assert.equal(p.run,null);assert.ok(p.lastTrip.includes('失利'));
 p=fresh();p=action(p,{type:'field-mode',runId:p.run!.id,mode:'push'});while(p.totals.wins<1)p=go(p,100);const loot=p.run!.loot,coins=p.coins;p.run!.hp=1;
 while(p.run&&p.run.phase!=='recover')p=go(p,100);assert.ok(p.run);assert.equal(fieldOf(p)!.mode,'farm');assert.deepEqual(fieldOf(p)!.safe,{floor:0,encounter:0});assert.equal(p.run!.loot,loot);assert.equal(p.coins,coins);assert.equal(p.run!.hp,0);p=go(p,8000);assert.equal(p.run!.hp,35);assert.equal(p.run!.phase,'travel');
});
test('farm monster waits and rewards each paid group once; depleted ore run returns',()=>{
 let p=fresh();p=action(p,{type:'field-target',runId:p.run!.id,floor:0,target:{kind:'monster',id:'f0-e0-m0'}});p=action(p,{type:'field-mode',runId:p.run!.id,mode:'farm'});p=go(p,15000);assert.equal(p.totals.wins,1);assert.equal(p.run!.spent,1);p=go(p,30000);assert.equal(p.totals.wins,2);assert.equal(p.run!.spent,2);
 let q=initialProfile(0);q.job='keeper';q.bag.ration=1;q=action(q,{type:'field-enter',budget:1});const e={sequence:q.sequence+1,requestId:'field-ore-retry',action:{type:'field-target',runId:q.run!.id,floor:0,target:{kind:'ore',id:'f0-ore'}}};q=transact(q,e);q=go(q,5000);assert.equal(q.run,null);assert.equal(q.leisure.materials.ore,1);assert.deepEqual(transact(q,e),q);assert.equal(q.bag.ration,0);
});
test('summary tampering, hidden targets, cap rewards and old no-field simulation are checked',()=>{
 let p=fresh();p=action(p,{type:'field-mode',runId:p.run!.id,mode:'push'});p=go(p,3000);assert.equal(p.run!.phase,'fight');const bad=structuredClone(p);bad.run!.enemyHP--;assert.throws(()=>parseProfile(bad),/汇总/);
 const hidden=fresh();assert.throws(()=>action(hidden,{type:'field-target',runId:hidden.run!.id,floor:0,target:{kind:'monster',id:'f0-e2-m0'}}),/发现/);
 const capped=fresh();capped.coins=1e9;const after=go(action(capped,{type:'field-mode',runId:capped.run!.id,mode:'push'}),10000);assert.equal(after.run,null);assert.equal(after.totals.wins,0);assert.equal(after.bag.ration,9);
 let old=initialProfile(0);old.job='keeper';old.bag.ration=3;old=action(old,{type:'start-run',region:0,budget:3,auto:true});const original=structuredClone(old);assert.deepEqual(parseProfile(old),original);assert.equal(Object.hasOwn(old.run!,'field'),false);old=go(old,30000);assert.ok(old.totals.wins>0);assert.equal(old.run?.field,undefined);
});
test('all three enemy threats execute their actual distinct telegraphs and attacks',()=>{
 let p=fresh();p=action(p,{type:'field-mode',runId:p.run!.id,mode:'push'});const windups=new Set<string>(),projectiles=new Set<string>(),charged=new Set<string>(),hurts=new Set<string>();
 for(let i=0;i<1600&&p.run;i++){
  const previous=p.run.field!,active=previous.active,kind=active===null?null:FIELD_FLOORS[previous.floor].encounters[active].kind,hp=p.run.hp;p=go(p,100);const f=fieldOf(p);if(!f)break;
  if(kind&&p.run!.hp<hp)hurts.add(kind);
  f.floors[f.floor].encounters.forEach((e,ei)=>e.monsters.forEach((m,mi)=>{if(m.stage==='windup')windups.add(m.kind);if(m.stage==='projectile')projectiles.add(m.kind);if(m.kind==='charge'&&m.x!==FIELD_FLOORS[f.floor].encounters[ei].x+mi*36)charged.add(m.kind);}));
 }
 assert.deepEqual([...windups].sort(),['charge','melee','ranged']);assert.ok(projectiles.has('ranged'));assert.ok(charged.has('charge'));assert.deepEqual([...hurts].sort(),['charge','melee','ranged']);assert.equal(p.totals.wins,6);
});
test('mid-fight mode switches conserve enemy HP and all cooldowns, no inter-group free healing',()=>{
 let p=fresh();p=action(p,{type:'field-mode',runId:p.run!.id,mode:'push'});p=go(p,4000);const before=structuredClone(p.run!);p=action(p,{type:'field-mode',runId:p.run!.id,mode:'farm'});for(const k of ['hp','enemyHP','enemyMax','remaining','spent','loot','nextAttack','enemyAttack','frostReady','shatterReady'] as const)assert.equal(p.run![k],before[k]);assert.deepEqual(p.run!.field!.floors,before.field!.floors);
 while(p.run!.phase==='fight')p=go(p,100);const hp=p.run!.hp;p=action(p,{type:'field-mode',runId:p.run!.id,mode:'push'});while(p.run&&p.run.phase!=='fight')p=go(p,100);assert.equal(p.run!.hp,hp);
});
test('legacy recovery attaches without resetting its HP, phase, due or existing cooldowns',()=>{
 let p=initialProfile(0);p.job='keeper';p.cleared=[0];p.bag.ration=9;p=action(p,{type:'start-run',region:1,budget:9,auto:false});p=go(p,1000);p.run!.hp=1;p=go(p,2000);assert.equal(p.run!.phase,'recover');const before=structuredClone(p.run!);p=action(p,{type:'field-enter',budget:9});for(const k of ['id','hp','phase','due','nextAttack','enemyAttack','frostReady','shatterReady','remaining','spent','loot'] as const)assert.equal(p.run![k],before[k]);assert.equal(fieldOf(p)!.recoverUntil,before.due);p=go(p,8000);assert.equal(p.run!.hp,35);assert.equal(fieldOf(p)!.target,null);
});
test('a floor-two failure falls back to floor-one victory with floor-one rewards',()=>{
 let p=fresh();p=action(p,{type:'field-mode',runId:p.run!.id,mode:'push'});while(fieldOf(p)!.floor===0)p=go(p,100);assert.equal(p.run!.region,1);const loot=p.run!.loot;p.run!.hp=1;while(p.run&&p.run.phase!=='recover')p=go(p,100);assert.ok(p.run);assert.equal(fieldOf(p)!.floor,0);assert.equal(p.run!.region,0);assert.equal(p.run!.loot,loot);assert.deepEqual(fieldOf(p)!.safe,{floor:0,encounter:2});
});
test('mined ore makes boots that shorten authoritative travel while bare/old field behavior stays deterministic',()=>{
 let camp=fresh();camp=action(camp,{type:'field-target',runId:camp.run!.id,floor:0,target:{kind:'ore',id:'f0-ore'}});camp=action(camp,{type:'field-mode',runId:camp.run!.id,mode:'farm'});camp=go(camp,137000);assert.equal(camp.leisure.materials.ore,5);camp=action(camp,{type:'field-return',runId:camp.run!.id});camp=action(camp,{type:'equipment-craft',id:'trail-boots'});
 const bareStart=action(camp,{type:'field-enter',budget:1});let equippedCamp=action(camp,{type:'equipment-equip',id:'trail-boots'});let bootsStart=action(equippedCamp,{type:'field-enter',budget:1});assert.equal(bootsStart.equipment!.active!.slots.feet,'trail-boots');
 const target=(p:Profile)=>action(p,{type:'field-target',runId:p.run!.id,floor:0,target:{kind:'ground',x:260}});const bare=target(bareStart),boots=target(bootsStart);const b=go(bare,1000),s=go(boots,1000);assert.equal(fieldOf(b)!.x,120);assert.ok(fieldOf(s)!.x>fieldOf(b)!.x,`boots ${fieldOf(s)!.x} must exceed bare ${fieldOf(b)!.x}`);
 let ticksBare=0,ticksBoots=0,p=bare,q=boots;while(fieldOf(p)!.target&&ticksBare<50){p=go(p,100);ticksBare++;}while(fieldOf(q)!.target&&ticksBoots<50){q=go(q,100);ticksBoots++;}assert.ok(ticksBoots<ticksBare);assert.equal(ticksBare,25);assert.equal(ticksBoots,24);assert.equal(fieldOf(p)!.x,260);assert.equal(fieldOf(q)!.x,260);
 let a=boots,z=boots;for(let i=0;i<10;i++)a=go(a,100);for(let i=0;i<2;i++)z=go(z,500);assert.deepEqual(a,z);
 const remainder=fieldOf(a)!.moveRemainder;assert.ok(remainder!>0);const before=structuredClone(a.run!);let switched=action(a,{type:'field-mode',runId:a.run!.id,mode:'push'});switched=action(switched,{type:'field-mode',runId:switched.run!.id,mode:'manual'});assert.deepEqual(switched.run,before);assert.equal(fieldOf(go(switched,100))!.x,fieldOf(go(a,100))!.x);
 const old=structuredClone(bare);delete old.run!.field!.moveRemainder;assert.deepEqual(parseProfile(old),old);assert.equal(fieldOf(go(old,1000))!.x,120);const bad=structuredClone(a);bad.run!.field!.moveRemainder=100;assert.throws(()=>parseProfile(bad));
});

test('saved-v1 target validator keeps its original two-monster identity bound',()=>{const p=fresh();p.run!.field!.target={kind:'monster',id:'f0-e0-m2'};assert.throws(()=>parseProfile(p),/标识/);});
