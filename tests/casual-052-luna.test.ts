import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  advance, initialProfile, initialLeisure, parseAction, parseEnvelope, parseProfile, transact,
  leisureWork, companionLevel, type GameAction, type Profile,
} from '../packages/solo-core';
import {GameStore} from '../apps/desktop/game-store';

let requestSerial=0;
function act(p:Profile,action:GameAction):Profile {
  return transact(p,{sequence:p.sequence+1,requestId:`luna052-${String(++requestSerial).padStart(8,'0')}`,action});
}
function ticks(p:Profile,n:number):Profile { return advance(p,p.wallAt+n*100); }
function temp(t:{after:(fn:()=>void)=>void},prefix:string):string {
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),prefix));
  t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
  return folder;
}
function prepareLegacyVersions(source:Profile):Record<number,Record<string,unknown>> {
  const v5:Record<string,unknown>={...structuredClone(source),version:5};delete v5.leisure;
  const v4:Record<string,unknown>={...v5,version:4};delete v4.business;
  const v3:Record<string,unknown>={...v4,version:3};delete v3.rewardRemainders;
  const v2:Record<string,unknown>={...v3,version:2};delete v2.roomClaims;
  const v1:Record<string,unknown>={...v2,version:1};delete v1.xp;delete v1.actionClaim;
  return {1:v1,2:v2,3:v3,4:v4,5:v5};
}

test('schema v1–v5 migrate to v7 without mutating or losing saved fields; GameStore preserves exact source bytes',t=>{
  const source=initialProfile(41_000);
  source.coins=711;source.xp=42;source.actionClaim=17;source.bag.flour=31;source.bag.gel=6;
  source.job='keeper';source.cleared=[0];source.rng=0x12345678;
  source.rewardRemainders={coins:17,xp:29,gel:70};
  source.roomClaims=[{hostId:'a'.repeat(32),sequence:9}];
  const versions=prepareLegacyVersions(source);
  for(const version of [1,2,3,4,5]){
    const raw=versions[version],before=structuredClone(raw);
    const migrated=parseProfile(raw);
    assert.equal(migrated.version,8,`v${version}`);
    assert.deepEqual(migrated.leisure,initialLeisure(),`v${version} initializes only the new leisure state`);
    assert.deepEqual(raw,before,`v${version} parser does not mutate the saved object`);
    assert.equal(migrated.coins,711);assert.equal(migrated.bag.flour,31);assert.equal(migrated.job,'keeper');
    assert.equal(migrated.xp,version>=2?42:0);
    assert.equal(migrated.actionClaim,version>=2?17:0);
    assert.deepEqual(migrated.roomClaims,version>=3?source.roomClaims:[]);
    assert.deepEqual(migrated.rewardRemainders,version>=4?source.rewardRemainders:{coins:0,xp:0,gel:0});
    if(version===5)assert.deepEqual(migrated.business,source.business);
    const folder=temp(t,`pixelstreet-casual-052-migrate-v${version}-`),file=path.join(folder,'profile.json');
    const bytes=JSON.stringify(raw,null,2)+'\n';fs.writeFileSync(file,bytes);
    const store=new GameStore(folder,source.wallAt);
    assert.deepEqual(store.value,migrated,`GameStore reads v${version} into the parser's v7 state`);
    assert.ok(store.warnings.some(w=>w.includes(`v${version}`)),`v${version} migration is disclosed`);
    store.save(store.value);
    assert.equal(fs.readFileSync(path.join(folder,`profile.v${version}-before-migration.json`),'utf8'),bytes,`v${version} original bytes`);
    assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).version,8);
    assert.deepEqual(new GameStore(folder).value,migrated);
  }
});

test('schema v7 save and reopen preserves in-progress strolls, crops, companion progress, and cargo',t=>{
  const now=45_000,folder=temp(t,'pixelstreet-casual-052-v7-reopen-');
  const store=new GameStore(folder,now);let p=store.value;
  p=act(p,{type:'garden-plant',plot:1,crop:'berry'});
  p=act(p,{type:'stroll-start',zone:0,route:'treasure',trips:3});
  p.leisure.companions.slime=5;p.leisure.materials.biscuit=3;
  p=advance(p,p.wallAt+200*100);
  assert.equal(p.leisure.run?.room,1);assert.equal(p.leisure.cargo.coins,10);
  store.save(p);
  const reopened=new GameStore(folder,p.wallAt+5_000);
  assert.deepEqual(reopened.value.leisure,p.leisure,'JSON save/reopen retains the full v7 leisure subtree');
  const progressed=advance(reopened.value,p.wallAt+5_000);
  assert.ok(progressed.tick>p.tick,'offline world time advances after reopening');
  assert.ok(progressed.leisure.run,'finite stroll remains in progress when the saved timestamp is still within its duration');
  assert.equal(progressed.leisure.plots[1]?.crop,'berry','growing plot persists across restart');
  assert.deepEqual(progressed.leisure.cargo,p.leisure.cargo,'only already-settled cargo is retained until the next encounter resolves');
});

test('new visitor can run three fully automatic six-room trips without HP, tickets, food, or a job',()=>{
  let p=initialProfile(10_000);const starting={coins:p.coins,bag:structuredClone(p.bag),job:p.job};
  p=act(p,{type:'stroll-start',zone:0,route:'balanced',trips:3});
  assert.equal(p.leisure.run?.total,3);assert.equal(p.leisure.run?.remaining,3);
  assert.equal(p.leisure.run?.duration,200);assert.equal(p.coins,starting.coins);assert.deepEqual(p.bag,starting.bag);assert.equal(p.job,starting.job);
  assert.equal('hp' in p.leisure.run!,false);assert.equal('ticket' in p.leisure.run!,false);
  assert.equal(leisureWork(p),true);
  p=ticks(p,3*6*200);
  assert.equal(p.leisure.run,null);assert.equal(p.leisure.rooms,18);assert.deepEqual(p.leisure.clears,[3,0,0,0,0]);
  assert.deepEqual(p.leisure.cargo,{coins:84,xp:105,gel:42,ore:21});
  assert.equal(p.coins,starting.coins);assert.deepEqual(p.bag,starting.bag);assert.equal(leisureWork(p),false);
  const claim={sequence:p.sequence+1,requestId:'luna052-cargo-claim-001',action:{type:'stroll-claim'} as const};
  p=transact(p,claim);
  assert.equal(p.coins,104);assert.equal(p.xp,105);assert.equal(p.bag.gel,42);assert.equal(p.leisure.materials.ore,21);
  assert.deepEqual(p.leisure.cargo,{coins:0,xp:0,gel:0,ore:0});
  assert.deepEqual(transact(p,claim),p,'retrying the same claim cannot duplicate any reward');
  assert.throws(()=>transact(p,{...claim,action:{type:'stroll-return'}}),/过期/);
});

test('assistance shortens only the current encounter, enforces a 15-second cooldown, and rejects stale encounter tokens',()=>{
  let p=act(initialProfile(20_000),{type:'stroll-start',zone:0,route:'gather',trips:1});
  const first={runId:p.leisure.run!.id,room:0,remaining:1};
  p=ticks(p,10);const due=p.leisure.run!.due;
  p=act(p,{type:'stroll-assist',...first});
  assert.equal(p.leisure.run!.due,due-30);assert.equal(p.leisure.run!.assistReady,p.tick+150);
  const afterFirst=structuredClone(p);
  assert.throws(()=>act(p,{type:'stroll-assist',...first}),/还需/);assert.deepEqual(p,afterFirst);
  p=ticks(p,150);p=act(p,{type:'stroll-assist',...first});
  assert.equal(p.leisure.run!.due,p.tick+1);
  p=ticks(p,1);assert.equal(p.leisure.run!.room,1);
  const afterEncounter=structuredClone(p);
  assert.throws(()=>act(p,{type:'stroll-assist',...first}),/遭遇已经变化/);assert.deepEqual(p,afterEncounter);
  assert.throws(()=>act(p,{type:'stroll-assist',runId:first.runId,room:1,remaining:1}),/还需/);
});

test('returning mid-trip stops future encounters while preserving settled cargo until explicit claim',()=>{
  let p=act(initialProfile(30_000),{type:'stroll-start',zone:0,route:'balanced',trips:1});
  p=ticks(p,200);assert.equal(p.leisure.run!.room,1);assert.deepEqual(p.leisure.cargo,{coins:4,xp:5,gel:2,ore:1});
  p=act(p,{type:'stroll-return'});assert.equal(p.leisure.run,null);assert.deepEqual(p.leisure.cargo,{coins:4,xp:5,gel:2,ore:1});
  const before=structuredClone(p);assert.throws(()=>act(p,{type:'stroll-start',zone:0,route:'balanced',trips:1}),/领取上趟战利品/);assert.deepEqual(p,before);
  p=act(p,{type:'stroll-claim'});assert.equal(p.coins,24);assert.equal(p.bag.gel,2);assert.equal(p.leisure.materials.ore,1);
  p=act(p,{type:'stroll-start',zone:0,route:'balanced',trips:1});assert.ok(p.leisure.run);
});

test('cargo claim is all-or-nothing when the old expedition has reserved gel capacity',()=>{
  let p=initialProfile(40_000);p.job='keeper';p.bag.ration=1;
  p=act(p,{type:'start-run',region:0,budget:1,auto:true});
  p.run!.loot=99;p.leisure.cargo={coins:10,xp:2,gel:2,ore:1};
  assert.doesNotThrow(()=>parseProfile(p));
  const before=structuredClone(p);
  assert.throws(()=>act(p,{type:'stroll-claim'}),/凝胶空间不足/);
  assert.deepEqual(p,before,'blocked claim retains coins, XP, gel and ore as a single cargo bundle');
});

test('three open plots charge seeds, mature on exact timers, never auto-harvest, and retain mature crops',()=>{
  let p=initialProfile(50_000);const coins=p.coins;
  p=act(p,{type:'garden-plant',plot:0,crop:'herb'});
  p=act(p,{type:'garden-plant',plot:1,crop:'berry'});
  p=act(p,{type:'garden-plant',plot:2,crop:'mushroom'});
  assert.equal(p.coins,coins-12);assert.deepEqual(p.leisure.plots.map(x=>x?.crop),['herb','berry','mushroom']);
  assert.deepEqual(p.leisure.plots.map(x=>x?.due),[1800,3600,6000]);assert.equal(leisureWork(p),true);
  p=ticks(p,1799);assert.equal(p.leisure.materials.herb,0);
  const beforeEarly=structuredClone(p);assert.throws(()=>act(p,{type:'garden-harvest',plot:0}),/还在生长/);assert.deepEqual(p,beforeEarly);
  p=ticks(p,4201);assert.deepEqual(p.leisure.plots.map(Boolean),[true,true,true]);
  assert.deepEqual(p.leisure.materials,{herb:0,berry:0,mushroom:0,ore:0,tea:0,biscuit:0,soup:0,pumpkin:0,snowflower:0,pie:0,snowtea:0});
  assert.equal(leisureWork(p),false,'mature, unharvested plots need no continuous worker timer');
  p=act(p,{type:'garden-harvest',plot:0});assert.equal(p.leisure.materials.herb,3);assert.equal(p.leisure.plots[0],null);
  const after=structuredClone(p);assert.throws(()=>act(p,{type:'garden-harvest',plot:0}),/尚未种植/);assert.deepEqual(p,after);
  p=act(p,{type:'garden-harvest',plot:1});p=act(p,{type:'garden-harvest',plot:2});
  assert.equal(p.leisure.materials.berry,4);assert.equal(p.leisure.materials.mushroom,2);assert.equal(p.leisure.harvests,3);
});

test('garden upgrades atomically consume coin and ore and increase future yield by one per level',()=>{
  let p=initialProfile(60_000);p.coins=200;p.leisure.materials.ore=17;
  p=act(p,{type:'garden-plant',plot:0,crop:'herb'});p=ticks(p,1800);
  p=act(p,{type:'garden-upgrade'});assert.equal(p.coins,158);assert.equal(p.leisure.materials.ore,12);assert.equal(p.leisure.gardenLevel,1);
  p=act(p,{type:'garden-upgrade'});assert.equal(p.coins,38);assert.equal(p.leisure.materials.ore,0);assert.equal(p.leisure.gardenLevel,2);
  p=act(p,{type:'garden-harvest',plot:0});assert.equal(p.leisure.materials.herb,5);
  const full=structuredClone(p);assert.throws(()=>act(p,{type:'garden-upgrade'}),/满级/);assert.deepEqual(p,full);
});

test('camp recipes conserve all ingredients, merchant trades are explicit, and food sales update wallet and totals',()=>{
  let p=initialProfile(70_000);p.coins=100;
  p.leisure.materials.herb=4;p.leisure.materials.berry=10;p.leisure.materials.mushroom=5;
  p.bag.gel=5;
  p=act(p,{type:'camp-supplies',trade:'flour'});assert.equal(p.coins,90);assert.equal(p.bag.flour,10);
  p=act(p,{type:'camp-cook',food:'tea',count:1});assert.equal(p.leisure.materials.herb,2);assert.equal(p.leisure.materials.tea,0);
  p=advance(p,p.wallAt+20_000);assert.equal(p.leisure.materials.tea,1,'tea completes after 200 ticks');
  p=act(p,{type:'camp-cook',food:'biscuit',count:5});assert.equal(p.leisure.materials.berry,0);assert.equal(p.bag.flour,5);assert.equal(p.leisure.materials.biscuit,0);
  p=advance(p,p.wallAt+175_000);assert.equal(p.leisure.materials.biscuit,5,'five biscuits complete sequentially at 350 ticks each');
  p=act(p,{type:'camp-cook',food:'soup',count:5});assert.equal(p.leisure.materials.mushroom,0);assert.equal(p.bag.gel,0);assert.equal(p.leisure.materials.soup,0);
  p=advance(p,p.wallAt+225_000);assert.equal(p.leisure.materials.soup,5,'five soups complete sequentially at 450 ticks each');
  const before=structuredClone(p);assert.throws(()=>act(p,{type:'camp-cook',food:'biscuit',count:1}),/材料不足/);assert.deepEqual(p,before);
  p=act(p,{type:'camp-sell',food:'tea',all:false});assert.equal(p.coins,102);assert.equal(p.leisure.materials.tea,0);
  p=act(p,{type:'camp-sell',food:'biscuit',all:false});assert.equal(p.coins,118);assert.equal(p.leisure.materials.biscuit,4);
  p=act(p,{type:'camp-sell',food:'soup',all:true});assert.equal(p.coins,238);assert.equal(p.leisure.materials.soup,0);
  assert.equal(p.totals.sold,7);assert.equal(p.totals.earned,148);assert.equal(p.leisure.cooked,11);
  p.bag.gel=5;p=act(p,{type:'camp-supplies',trade:'gel'});assert.equal(p.bag.gel,0);assert.equal(p.coins,248);assert.equal(p.totals.earned,158);
});

test('selling one food from a zero stock is rejected without changing wallet, inventory, or totals',()=>{
  for(const food of ['tea','biscuit','soup'] as const){
    const p=initialProfile(72_000),before=structuredClone(p);
    assert.equal(p.leisure.materials[food],0);
    assert.throws(()=>act(p,{type:'camp-sell',food,all:false}),/没有可出售的食品/,`${food} single-sale reason`);
    assert.deepEqual(p,before,`${food} zero-stock sale must be atomic`);
  }
});

test('camp merchant can empty the gel stack and exchange ore without partial loss at wallet caps',()=>{
  let p=initialProfile(75_000);p.coins=150;p.bag.gel=100;p.leisure.materials.ore=10;
  p=act(p,{type:'camp-supplies',trade:'gel-all'});assert.equal(p.bag.gel,0);assert.equal(p.coins,350);assert.equal(p.totals.earned,200);
  p=act(p,{type:'camp-supplies',trade:'ore'});assert.equal(p.leisure.materials.ore,0);assert.equal(p.coins,370);assert.equal(p.totals.earned,220);
  const empty=structuredClone(p);assert.throws(()=>act(p,{type:'camp-supplies',trade:'gel-all'}),/凝胶/);assert.deepEqual(p,empty);
  p.leisure.materials.ore=9;const shortOre=structuredClone(p);assert.throws(()=>act(p,{type:'camp-supplies',trade:'ore'}),/10份月纹石/);assert.deepEqual(p,shortOre);
  p=initialProfile(76_000);p.coins=1e9;p.bag.gel=100;p.leisure.materials.ore=10;const capped=structuredClone(p);
  assert.throws(()=>act(p,{type:'camp-supplies',trade:'gel-all'}),/金币已满/);assert.deepEqual(p,capped);
  assert.throws(()=>act(p,{type:'camp-supplies',trade:'ore'}),/金币已满/);assert.deepEqual(p,capped);
});

test('companions unlock after clears, rewards and speed use the departure snapshot, and feeding caps at level five',()=>{
  let p=initialProfile(80_000);p.coins=200;p.leisure.materials.ore=100;
  const locked=structuredClone(p);assert.throws(()=>act(p,{type:'companion-recruit',companion:'guide'}),/完成对应地点/);assert.deepEqual(p,locked);
  p.leisure.clears=[1,1,0,0,0];
  p=act(p,{type:'companion-recruit',companion:'guide'});p=act(p,{type:'companion-recruit',companion:'guard'});
  assert.equal(p.coins,90);assert.equal(p.leisure.materials.ore,83);
  p=act(p,{type:'companion-equip',companion:'guard'});
  p=act(p,{type:'stroll-start',zone:1,route:'gather',trips:1});
  assert.deepEqual({companion:p.leisure.run!.companion,level:p.leisure.run!.level,duration:p.leisure.run!.duration},{companion:'guard',level:1,duration:400});
  const beforeEquip=structuredClone(p);assert.throws(()=>act(p,{type:'companion-equip',companion:'guide'}),/这趟结束/);assert.deepEqual(p,beforeEquip);
  p=ticks(p,6*400);assert.deepEqual(p.leisure.cargo,{coins:56,xp:42,gel:14,ore:28});

  let q=initialProfile(90_000);q.leisure.materials.biscuit=15;
  q=act(q,{type:'stroll-start',zone:0,route:'balanced',trips:1});
  const departure={...q.leisure.run!};
  q=act(q,{type:'companion-feed',companion:'slime'});q=act(q,{type:'companion-feed',companion:'slime'});
  assert.equal(companionLevel(q.leisure.companions.slime!),2);assert.equal(q.leisure.run!.level,departure.level);
  assert.equal(q.leisure.run!.duration,departure.duration);assert.equal(q.leisure.run!.due,departure.due,'in-progress trip timing is not retroactively changed');
  q=ticks(q,6*departure.duration);q=act(q,{type:'stroll-claim'});
  q=act(q,{type:'stroll-start',zone:0,route:'balanced',trips:1});assert.equal(q.leisure.run!.level,2);assert.equal(q.leisure.run!.duration,190);
  for(let i=0;i<12;i++)q=act(q,{type:'companion-feed',companion:'slime'});
  assert.equal(q.leisure.companions.slime,14);assert.equal(companionLevel(q.leisure.companions.slime!),5);
  const capped=structuredClone(q);assert.throws(()=>act(q,{type:'companion-feed',companion:'slime'}),/Lv5/);assert.deepEqual(q,capped);
});

test('six collection milestones pay once and stay claimable after their requirements are met',()=>{
  let p=initialProfile(100_000);p.leisure.clears=[1,1,1,0,0];p.leisure.harvests=3;p.leisure.cooked=5;p.leisure.companions.slime=2;
  assert.equal(p.coins,20);assert.deepEqual(p.leisure.claimed,[]);
  const ids=['first-trip','green-fingers','camp-chef','good-friend','moon-path','star-path'];
  for(const id of ids)p=act(p,{type:'collection-claim',id});
  assert.equal(p.coins,380);assert.equal(p.leisure.materials.ore,27);assert.deepEqual(p.leisure.claimed,ids);
  const after=structuredClone(p);assert.throws(()=>act(p,{type:'collection-claim',id:'star-path'}),/已领取/);assert.deepEqual(p,after);
});

test('offline cap advances a finite stroll and crops once, then remains idempotent under repeated or backwards time',()=>{
  let p=initialProfile(110_000);
  p=act(p,{type:'garden-plant',plot:0,crop:'herb'});
  p=act(p,{type:'stroll-start',zone:0,route:'balanced',trips:3});
  const end=p.wallAt+12*60*60*1000;
  p=advance(p,end);
  assert.equal(p.tick,8*60*60*10);assert.equal(p.leisure.run,null);assert.equal(p.leisure.rooms,18);
  assert.ok(p.leisure.cargo.coins>0);assert.equal(p.leisure.materials.herb,0);assert.notEqual(p.leisure.plots[0],null);
  assert.equal(leisureWork(p),false,'mature unharvested crop does not keep an idle Worker spinning');
  const settled=structuredClone(p);assert.deepEqual(advance(p,end),settled);assert.deepEqual(advance(p,end-6*60*60*1000),settled);
});

test('legacy expedition still steps down through cleared regions, keeps settled loot, then stops safely',()=>{
  let p=initialProfile(120_000);p.job='keeper';p.cleared=[0,1];p.bag.ration=6;
  p=act(p,{type:'start-run',region:2,budget:6,auto:false});
  p=ticks(p,10);assert.equal(p.run!.phase,'fight');
  p.run!.enemyHP=1;p.run!.nextAttack=p.tick+1;p.run!.enemyAttack=p.tick+100;
  p=ticks(p,1);assert.equal(p.totals.wins,1);const alreadySettledLoot=p.run!.loot;assert.ok(alreadySettledLoot>0);
  p=ticks(p,20);assert.equal(p.run!.phase,'fight');
  p.run!.hp=1;p.run!.nextAttack=p.tick+100;p.run!.enemyAttack=p.tick+1;
  p=ticks(p,1);assert.equal(p.run!.region,1);assert.equal(p.run!.phase,'recover');
  p=ticks(p,80);assert.equal(p.run!.region,1);assert.equal(p.run!.phase,'fight');
  p.run!.hp=1;p.run!.nextAttack=p.tick+100;p.run!.enemyAttack=p.tick+1;
  p=ticks(p,1);assert.equal(p.run!.region,0);assert.equal(p.run!.phase,'recover');
  p=ticks(p,80);assert.equal(p.run!.region,0);assert.equal(p.run!.phase,'fight');
  p.run!.hp=1;p.run!.nextAttack=p.tick+100;p.run!.enemyAttack=p.tick+1;
  p=ticks(p,1);assert.equal(p.run,null);assert.equal(p.bag.ration,2);assert.ok(p.bag.gel>=alreadySettledLoot);
  assert.deepEqual(p.leisure,initialLeisure(),'new leisure state remains isolated from legacy retreat logic');
});

test('v7 parser rejects forged leisure actions and impossible inventory without mutating inputs',()=>{
  const p=initialProfile(130_000),before=structuredClone(p);
  for(const action of [
    {type:'stroll-start',zone:5,route:'balanced',trips:1},
    {type:'stroll-start',zone:0,route:'balanced',trips:2},
    {type:'stroll-assist',runId:'stroll-1',room:0,remaining:1,duration:0},
    {type:'garden-plant',plot:0,crop:['herb']},
    {type:'camp-cook',food:'tea',count:5,coins:100},
    {type:'companion-feed',companion:'unknown'},
    {type:'camp-supplies',trade:'buy-gel'},
    {type:'collection-claim',id:'invented'},
  ])assert.throws(()=>parseEnvelope({sequence:1,requestId:'luna052-invalid-001',action}));
  for(const mutate of [
    (q:Profile)=>{q.leisure.materials.herb=-1;},
    (q:Profile)=>{q.leisure.materials.ore=10_000;},
    (q:Profile)=>{q.leisure.plots=[null,null];},
    (q:Profile)=>{q.leisure.gardenLevel=3;},
    (q:Profile)=>{q.leisure.companions.slime=null;},
    (q:Profile)=>{(q.leisure as any).unexpected=true;},
  ]){const q=structuredClone(p);mutate(q);assert.throws(()=>parseProfile(q));}
  assert.throws(()=>act(p,{type:'garden-harvest',plot:0}));assert.deepEqual(p,before);
  assert.throws(()=>parseAction({type:'stroll-start',zone:0,route:'balanced',trips:1,freeRewards:true}));
});

test('full wallet, XP, material and crop inventories keep the entire reward or action uncommitted',()=>{
  let p=initialProfile(140_000);p.leisure.cargo={coins:1,xp:0,gel:0,ore:0};p.coins=1e9;
  const cap=structuredClone(p);assert.throws(()=>act(p,{type:'stroll-claim'}),/金币或经验已满/);assert.deepEqual(p,cap);
  p=initialProfile(150_000);p.leisure.cargo={coins:0,xp:1,gel:0,ore:0};p.xp=1e12;
  const xpCap=structuredClone(p);assert.throws(()=>act(p,{type:'stroll-claim'}),/金币或经验已满/);assert.deepEqual(p,xpCap);
  p=initialProfile(160_000);p.leisure.materials.ore=9999;p.leisure.clears=[1,0,0,0,0];p.leisure.cargo={coins:0,xp:0,gel:0,ore:1};
  const oreCap=structuredClone(p);assert.throws(()=>act(p,{type:'stroll-claim'}),/月纹石空间不足/);assert.deepEqual(p,oreCap);
  p=initialProfile(170_000);p.leisure.materials.herb=9997;p.leisure.plots[0]={crop:'herb',due:p.tick+1};
  p=ticks(p,1);assert.equal(p.leisure.plots[0]?.crop,'herb');
  const cropCap=structuredClone(p);assert.throws(()=>act(p,{type:'garden-harvest',plot:0}),/作物背包已满/);assert.deepEqual(p,cropCap);
});
