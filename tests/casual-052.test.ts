import test from 'node:test';
import assert from 'node:assert/strict';
import {initialProfile,parseProfile,transact,advance,leisureReason,leisureWork,CROPS,companionLevel,type Profile,type GameAction} from '../packages/solo-core';
const act=(p:Profile,action:GameAction)=>transact(p,{sequence:p.sequence+1,requestId:'casual-test-'+(p.sequence+1),action});
test('zero-stock single food sales are disabled before transaction and never mutate balances',()=>{
 const p=initialProfile(0),before=structuredClone(p);for(const food of ['tea','biscuit','soup'] as const){const action={type:'camp-sell' as const,food,all:false};assert.equal(leisureReason(p,action),'没有可出售的食品。');assert.throws(()=>act(p,action),/没有可出售/);assert.deepEqual(p,before);}
});
test('zero-input stroll completes six rooms and banks rewards; claim is exactly once',()=>{
 let p=act(initialProfile(0),{type:'stroll-start',zone:0,route:'balanced',trips:1});p=advance(p,120000);
 assert.equal(p.leisure.run,null);assert.equal(p.leisure.rooms,6);assert.deepEqual(p.leisure.clears,[1,0,0,0,0]);assert.equal(p.coins,20);assert.deepEqual(p.leisure.cargo,{coins:28,xp:35,gel:14,ore:7});
 p=act(p,{type:'stroll-claim'});assert.equal(p.coins,48);assert.equal(p.bag.gel,14);assert.equal(p.xp,35);assert.equal(p.leisure.materials.ore,7);assert.throws(()=>act(p,{type:'stroll-claim'}));
});
test('finite three-trip offline route completes and stops, without any food cost',()=>{
 let p=initialProfile(0);p.bag.ration=4;p=act(p,{type:'stroll-start',zone:0,route:'gather',trips:3});p=advance(p,24*3600000);assert.equal(p.tick,288000);assert.equal(p.leisure.rooms,18);assert.equal(p.leisure.clears[0],3);assert.equal(p.leisure.run,null);assert.equal(p.bag.ration,4);assert.equal(p.leisure.cargo.gel,63);assert.equal(p.leisure.cargo.ore,42);
});
test('assist obeys cooldown and binds both room and trip; return retains only banked loot',()=>{
 let p=act(initialProfile(0),{type:'stroll-start',zone:0,route:'treasure',trips:3});const r=p.leisure.run!;const target={type:'stroll-assist' as const,runId:r.id,room:r.room,remaining:r.remaining};p=act(p,target);assert.equal(p.leisure.run!.due,170);assert.throws(()=>act(p,target));p=advance(p,17000);assert.equal(p.leisure.rooms,1);assert.throws(()=>act(p,target));p=act(p,{type:'stroll-return'});assert.equal(p.leisure.run,null);assert.equal(p.leisure.cargo.coins,10);assert.equal(p.leisure.clears[0],0);
});
test('claim capacity failure preserves entire cargo and includes old expedition reserved gel',()=>{
 let p=act(initialProfile(0),{type:'stroll-start',zone:0,route:'balanced',trips:1});p=advance(p,120000);p.bag.gel=90;const snapshot=structuredClone(p);assert.throws(()=>act(p,{type:'stroll-claim'}));assert.deepEqual(p,snapshot);p.bag.gel=86;p=act(p,{type:'stroll-claim'});assert.equal(p.bag.gel,100);
});
test('all crops mature without wilting; harvest once; growing crops keep economy scheduled',()=>{
 let p=initialProfile(0);for(const [plot,crop]of (['herb','berry','mushroom'] as const).entries())p=act(p,{type:'garden-plant',plot,crop});assert.equal(p.coins,8);assert.equal(leisureWork(p),true);p=advance(p,600000);assert.equal(leisureWork(p),false);p=advance(p,1000000);for(let plot=0;plot<3;plot++)p=act(p,{type:'garden-harvest',plot});assert.equal(p.leisure.harvests,3);for(const crop of ['herb','berry','mushroom'] as const)assert.equal(p.leisure.materials[crop],CROPS[crop].yield);assert.throws(()=>act(p,{type:'garden-harvest',plot:0}));
});
test('garden expansion spends exact resources and applies yield once',()=>{
 let p=initialProfile(0);p.coins=200;p.leisure.materials.ore=17;p=act(p,{type:'garden-upgrade'});p=act(p,{type:'garden-upgrade'});assert.equal(p.coins,40);assert.equal(p.leisure.materials.ore,0);assert.throws(()=>act(p,{type:'garden-upgrade'}));p=act(p,{type:'garden-plant',plot:0,crop:'herb'});p=advance(p,180000);p=act(p,{type:'garden-harvest',plot:0});assert.equal(p.leisure.materials.herb,5);
});
test('new food crafting spends old and new ingredients, sells exact quantity and feeds companions',()=>{
 let p=initialProfile(0);p.bag.flour=5;p.bag.gel=2;p.leisure.materials.berry=10;p.leisure.materials.herb=4;p.leisure.materials.mushroom=2;p=act(p,{type:'camp-cook',food:'biscuit',count:5});assert.equal(p.bag.flour,0);assert.equal(p.leisure.materials.berry,0);assert.equal(p.leisure.materials.biscuit,0);p=advance(p,p.wallAt+175_000);assert.equal(p.leisure.materials.biscuit,5);for(let i=0;i<2;i++)p=act(p,{type:'companion-feed',companion:'slime'});assert.equal(companionLevel(p.leisure.companions.slime!),2);p=act(p,{type:'camp-sell',food:'biscuit',all:true});assert.equal(p.coins,68);assert.equal(p.leisure.materials.biscuit,0);assert.throws(()=>act(p,{type:'camp-sell',food:'biscuit',all:true}));p=act(p,{type:'camp-cook',food:'soup',count:1});assert.equal(p.bag.gel,1);assert.equal(p.leisure.materials.mushroom,1);assert.equal(p.leisure.materials.soup,0);p=advance(p,p.wallAt+45_000);assert.equal(p.leisure.materials.soup,1);
});
test('companion unlocks and level snapshot cannot change a running trip',()=>{
 let p=initialProfile(0);p.coins=300;p.leisure.materials.ore=50;assert.ok(leisureReason(p,{type:'companion-recruit',companion:'guide'}));p.leisure.clears=[1,1,0,0,0];p=act(p,{type:'companion-recruit',companion:'guide'});p=act(p,{type:'companion-equip',companion:'guide'});p=act(p,{type:'stroll-start',zone:1,route:'balanced',trips:1});const duration=p.leisure.run!.duration;p.leisure.materials.biscuit=2;for(let i=0;i<2;i++)p=act(p,{type:'companion-feed',companion:'guide'});assert.equal(p.leisure.run!.duration,duration);assert.equal(p.leisure.run!.level,1);assert.throws(()=>act(p,{type:'companion-equip',companion:'slime'}));
});
test('schema 5 migrates without mutating input and parser rejects extra fields and invalid intents',()=>{
 const {leisure,...rest}=initialProfile(0),old={...rest,version:5};const before=structuredClone(old),migrated=parseProfile(old);assert.equal(migrated.version,8);assert.deepEqual(old,before);assert.equal(migrated.leisure.active,'slime');assert.throws(()=>parseProfile({...migrated,leisure:{...migrated.leisure,coins:99}}));assert.throws(()=>act(migrated,{type:'stroll-start',zone:0,route:'gather',trips:99} as any));assert.throws(()=>act(migrated,{type:'garden-plant',plot:3,crop:'herb'}));
});
test('collections pay once, repeated envelopes are idempotent, clocks never rewind',()=>{
 let p=initialProfile(0);p.leisure.clears[0]=1;const envelope={sequence:1,requestId:'collection-test',action:{type:'collection-claim' as const,id:'first-trip'}};p=transact(p,envelope);assert.equal(p.coins,50);assert.deepEqual(transact(p,envelope),p);assert.throws(()=>act(p,{type:'collection-claim',id:'first-trip'}));p=advance(p,10000);assert.deepEqual(advance(p,0),p);
});
