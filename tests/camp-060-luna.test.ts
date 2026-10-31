import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  advance, initialProfile, parseProfile, transact, leisureReason, depthReason,
  DESTINATIONS, CROPS, FOODS, DEPTHS, LANDMARKS, RELICS, BUILDINGS, CONTRACTS,
  COLLECTIONS, contractAt, foodPrice, masteryLevel, masteryNext, leisureGelCapacity, type GameAction, type Profile,
} from '../packages/solo-core';
import {GameStore} from '../apps/desktop/game-store';

let requestSerial=0;
function act(p:Profile,action:GameAction):Profile {
  return transact(p,{sequence:p.sequence+1,requestId:`luna060-${String(++requestSerial).padStart(8,'0')}`,action});
}
function ticks(p:Profile,n:number):Profile { return advance(p,p.wallAt+n*100); }
function finishStroll(p:Profile):Profile {
  const run=p.leisure.run!;
  return advance(p,p.wallAt+run.total*6*run.duration*100);
}
function temp(t:{after:(fn:()=>void)=>void},prefix:string):string {
  const root='/private/tmp';fs.mkdirSync(root,{recursive:true});
  const folder=fs.mkdtempSync(path.join(root,prefix));
  t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
  return folder;
}
function oldV6(source:Profile):Record<string,unknown> {
  const raw=structuredClone(source) as unknown as Record<string,any>;
  raw.version=6;
  delete raw.camp;
  const l=raw.leisure;
  delete l.journal;
  l.materials={herb:l.materials.herb,berry:l.materials.berry,mushroom:l.materials.mushroom,ore:l.materials.ore,tea:l.materials.tea,biscuit:l.materials.biscuit,soup:l.materials.soup};
  l.clears=l.clears.slice(0,3);
  if(l.run){delete l.run.depth;delete l.run.coinBonus;delete l.run.oreBonus;delete l.run.dustBonus;}
  return raw;
}

test('schema v6 migrates the complete profile and an in-flight stroll losslessly; GameStore preserves original bytes',t=>{
  let source=initialProfile(300_000);
  source.leisure.clears=[1,1,1,0,0];source.leisure.companions.slime=4;
  source.leisure.materials={herb:7,berry:8,mushroom:9,ore:13,tea:2,biscuit:3,soup:4,pumpkin:0,snowflower:0,pie:0,snowtea:0};
  source.leisure.plots[1]={crop:'berry',due:source.tick+3600};
  source=act(source,{type:'stroll-start',zone:2,route:'treasure',trips:3});
  source=ticks(source,source.leisure.run!.duration);
  source.leisure.cargo={coins:17+source.leisure.cargo.coins,xp:9+source.leisure.cargo.xp,gel:3+source.leisure.cargo.gel,ore:5+source.leisure.cargo.ore};
  assert.equal(source.leisure.run?.room,1,'fixture contains a settled encounter in an active multi-trip run');
  assert.ok(source.leisure.cargo.coins>17);
  const raw=oldV6(source),before=structuredClone(raw),bytes=JSON.stringify(raw,null,2)+'\n';
  const migrated=parseProfile(raw);
  assert.deepEqual(raw,before,'migration must not mutate the v6 object');
  for(const key of Object.keys(raw))if(key!=='version'&&key!=='leisure')assert.deepEqual((migrated as unknown as Record<string,unknown>)[key],raw[key],`root field ${key} survives`);
  assert.equal(migrated.version,8);
  assert.deepEqual(migrated.leisure.materials,{herb:7,berry:8,mushroom:9,ore:13,tea:2,biscuit:3,soup:4,pumpkin:0,snowflower:0,pie:0,snowtea:0});
  assert.deepEqual(migrated.leisure.clears,[1,1,1,0,0]);
  assert.deepEqual(migrated.leisure.journal,{buildings:{lodge:0,workshop:0,archive:0},relics:Array(15).fill(0),dust:0,contracts:[0,0,0],deliveries:0});
  assert.deepEqual(migrated.leisure.run,{...source.leisure.run,depth:0,coinBonus:0,oreBonus:0,dustBonus:0});
  assert.deepEqual(migrated.leisure.cargo,source.leisure.cargo);
  assert.deepEqual(migrated.leisure.plots,source.leisure.plots);
  assert.deepEqual(parseProfile(migrated),migrated,'migrated state is accepted as a canonical v7 profile');

  const folder=temp(t,'pixelstreet-camp060-luna-v6-');
  fs.writeFileSync(path.join(folder,'profile.json'),bytes);
  const store=new GameStore(folder,source.wallAt);
  assert.deepEqual(store.value,migrated);
  assert.ok(store.warnings.some(w=>w.includes('v6')&&w.includes('无损升级')));
  store.save(store.value);
  assert.equal(fs.readFileSync(path.join(folder,'profile.v6-before-migration.json'),'utf8'),bytes,'exact v6 bytes remain available beside the migrated save');
  assert.equal(JSON.parse(fs.readFileSync(path.join(folder,'profile.json'),'utf8')).version,8);
  assert.deepEqual(new GameStore(folder).value,migrated,'the saved v7 profile reopens unchanged');
});

test('world catalogs contain five six-stop destinations, three depths, fifteen relics and three capped buildings',()=>{
  assert.equal(DESTINATIONS.length,5);assert.equal(LANDMARKS.length,5);
  assert.deepEqual(LANDMARKS.map(x=>x.length),[6,6,6,6,6]);
  assert.equal(DEPTHS.length,3);assert.deepEqual(DEPTHS.map(x=>x.reward),[1,2,3]);
  assert.equal(RELICS.length,15);assert.deepEqual(Object.keys(BUILDINGS).sort(),['archive','lodge','workshop']);
  assert.equal(COLLECTIONS.length,14);
  for(const building of Object.values(BUILDINGS))assert.deepEqual(building.coins.length,3);
  assert.deepEqual(DESTINATIONS.map(d=>d.ticks),[200,400,600,500,700]);
  assert.deepEqual(DESTINATIONS.map(d=>d.ticks*100/1000),[20,40,60,50,70],'destination ticks are 100ms units');
});

test('region and depth gates require the documented building, prior clear, and mastery milestones; six trips require Lodge Lv3',()=>{
  let p=initialProfile(310_000);p.coins=20_000;p.leisure.materials.ore=999;
  assert.match(leisureReason(p,{type:'stroll-start',zone:1,route:'balanced',trips:1}),/前一个地点/);
  assert.match(leisureReason(p,{type:'stroll-start',zone:0,route:'balanced',trips:1,depth:1}),/旅人小屋.*Lv1/);
  p.leisure.clears[0]=1;p=act(p,{type:'camp-build',building:'lodge'});
  assert.equal(p.leisure.journal.buildings.lodge,1);
  assert.match(depthReason(p,0,1),/熟悉度.*Lv2/);
  assert.equal(masteryLevel(2),1);assert.equal(masteryLevel(3),2);assert.equal(masteryLevel(9),2);assert.equal(masteryLevel(10),3);
  assert.equal(masteryNext(2),3);assert.equal(masteryNext(3),10);assert.equal(masteryNext(50),null);
  p.leisure.clears[0]=3;assert.equal(depthReason(p,0,1),'');
  assert.match(depthReason(p,0,2),/旅人小屋.*Lv2/);
  p.leisure.clears=[10,1,1,1,0];p=act(p,{type:'camp-build',building:'lodge'});
  assert.equal(p.leisure.journal.buildings.lodge,2);assert.equal(depthReason(p,0,2),'');
  assert.match(leisureReason(p,{type:'stroll-start',zone:0,route:'balanced',trips:6,depth:2}),/Lv3/);
  p.leisure.clears[4]=1;p=act(p,{type:'camp-build',building:'lodge'});
  assert.equal(p.leisure.journal.buildings.lodge,3);
  assert.equal(leisureReason(p,{type:'stroll-start',zone:0,route:'balanced',trips:6,depth:2}), '');
  assert.equal(leisureReason(p,{type:'stroll-start',zone:4,route:'balanced',trips:1}), '');
  assert.match(leisureReason(p,{type:'stroll-start',zone:4,route:'balanced',trips:1,depth:2}),/熟悉度.*Lv3/);
  p.leisure.clears[4]=10;assert.equal(leisureReason(p,{type:'stroll-start',zone:4,route:'balanced',trips:1,depth:2}), '');
});

test('depth reward scales are 1/2/3 for coins, XP and ore while gel is unchanged',()=>{
  for(const depth of [0,1,2] as const){
    let p=initialProfile(315_000+depth);p.leisure.clears[0]=10;p.leisure.journal.buildings.lodge=2;
    p=act(p,{type:'stroll-start',zone:0,route:'balanced',trips:1,depth});
    const factor=[1,1.5,2][depth];assert.equal(p.leisure.run!.duration,Math.ceil(200*factor));
    p=finishStroll(p);const reward=[1,2,3][depth];
    assert.deepEqual(p.leisure.cargo,{coins:28*reward,xp:35*reward,gel:14,ore:7*reward});
  }
});

test('all three buildings charge each level once and their effects match food pricing and the trip snapshot',()=>{
  let p=initialProfile(320_000);p.coins=20_000;p.leisure.materials.ore=999;
  p.leisure.clears=[1,1,1,1,1];
  const expectedSpend={coins:0,ore:0};
  for(const building of ['lodge','workshop','archive'] as const){
    for(let level=0;level<3;level++){
      expectedSpend.coins+=BUILDINGS[building].coins[level];expectedSpend.ore+=BUILDINGS[building].ore[level];
      p=act(p,{type:'camp-build',building});assert.equal(p.leisure.journal.buildings[building],level+1);
    }
    const full=structuredClone(p);assert.throws(()=>act(p,{type:'camp-build',building}),/满级/);assert.deepEqual(p,full);
  }
  assert.equal(p.coins,20_000-expectedSpend.coins);assert.equal(p.leisure.materials.ore,999-expectedSpend.ore);
  assert.deepEqual(p.leisure.journal.buildings,{lodge:3,workshop:3,archive:3});
  assert.equal(foodPrice(p,FOODS.tea.price),18);p.leisure.materials.tea=1;
  p=act(p,{type:'camp-sell',food:'tea',all:false});assert.equal(p.coins,20_000-expectedSpend.coins+18);
  p=act(p,{type:'stroll-start',zone:0,route:'balanced',trips:1});assert.equal(p.leisure.run?.dustBonus,3);
});

test('workshop and archive levels wait for their matching region clears',()=>{
  let p=initialProfile(321_000);p.coins=10_000;p.leisure.materials.ore=500;
  for(const building of ['workshop','archive'] as const)assert.match(leisureReason(p,{type:'camp-build',building}),/对应地区/);
  p.leisure.clears[0]=1;p=act(p,{type:'camp-build',building:'workshop'});
  assert.match(leisureReason(p,{type:'camp-build',building:'workshop'}),/对应地区/);
  p.leisure.clears[1]=1;p=act(p,{type:'camp-build',building:'workshop'});assert.equal(p.leisure.journal.buildings.workshop,2);
  p=act(p,{type:'camp-build',building:'archive'});assert.equal(p.leisure.journal.buildings.archive,1);
  assert.match(leisureReason(p,{type:'camp-build',building:'archive'}),/对应地区/);
  p.leisure.clears[2]=1;p.leisure.clears[3]=1;p=act(p,{type:'camp-build',building:'workshop'});assert.equal(p.leisure.journal.buildings.workshop,3);
  p.leisure.clears[2]=1;p=act(p,{type:'camp-build',building:'archive'});assert.equal(p.leisure.journal.buildings.archive,2);
  p.leisure.clears[4]=1;p=act(p,{type:'camp-build',building:'archive'});assert.equal(p.leisure.journal.buildings.archive,3);
});

test('relic discovery cycles through three regional pieces, duplicates produce depth dust, and all three repair stars obey cost/archive gates',()=>{
  let p=initialProfile(330_000);
  p=finishStroll(act(p,{type:'stroll-start',zone:0,route:'balanced',trips:1}));
  assert.equal(p.leisure.journal.relics[0],1);assert.equal(p.leisure.journal.dust,0);
  p=act(p,{type:'stroll-claim'});p.leisure.materials.ore=100;p.coins=2000;p.leisure.clears=[1,1,1,1,1];
  p=act(p,{type:'camp-build',building:'archive'});
  p.leisure.journal.dust=4;
  p=act(p,{type:'relic-upgrade',relic:0});assert.equal(p.leisure.journal.relics[0],2);assert.equal(p.leisure.journal.dust,0);assert.equal(p.leisure.materials.ore,65);
  assert.match(leisureReason(p,{type:'relic-upgrade',relic:0}),/观星收藏室.*Lv2/);
  p=act(p,{type:'camp-build',building:'archive'});p.leisure.journal.dust=10;p.leisure.materials.ore=40;
  p=act(p,{type:'relic-upgrade',relic:0});assert.equal(p.leisure.journal.relics[0],3);assert.equal(p.leisure.journal.dust,0);assert.equal(p.leisure.materials.ore,0);
  const full=structuredClone(p);assert.throws(()=>act(p,{type:'relic-upgrade',relic:0}),/三星/);assert.deepEqual(p,full);

  let q=initialProfile(331_000);q.leisure.clears[0]=1;q.leisure.journal.relics[0]=1;q=finishStroll(act(q,{type:'stroll-start',zone:0,route:'balanced',trips:1}));
  assert.equal(q.leisure.clears[0],2);assert.equal(q.leisure.journal.relics[0],1);assert.equal(q.leisure.journal.relics[1],1);
  assert.equal(q.leisure.journal.dust,0,'first discovery of the next regional relic grants no duplicate dust');
  q=act(q,{type:'stroll-claim'});q=finishStroll(act(q,{type:'stroll-start',zone:0,route:'balanced',trips:1}));
  assert.deepEqual(q.leisure.journal.relics.slice(0,3),[1,1,1],'the third clear discovers the third regional relic naturally');
  q=act(q,{type:'stroll-claim'});q.leisure.journal.buildings.lodge=1;
  q=act(q,{type:'stroll-start',zone:0,route:'balanced',trips:1,depth:1});q=finishStroll(q);
  assert.equal(q.leisure.journal.dust,2,'a duplicate at depth 1 yields 1 + depth dust');
});

test('relic and archive repairs during an active trip apply only to the next departure snapshot',()=>{
  let p=initialProfile(340_000);p.coins=5000;p.leisure.materials.ore=500;p.leisure.clears=[1,1,1,1,1];
  p.leisure.journal.relics[0]=1;p.leisure.journal.relics[2]=1;p.leisure.journal.relics[1]=1;p.leisure.journal.dust=100;
  p=act(p,{type:'camp-build',building:'archive'});
  p=act(p,{type:'stroll-start',zone:0,route:'balanced',trips:1});
  const run=p.leisure.run!;assert.deepEqual({duration:run.duration,coin:run.coinBonus,ore:run.oreBonus,dust:run.dustBonus},{duration:198,coin:1,ore:1,dust:1});
  p=act(p,{type:'relic-upgrade',relic:0});p=act(p,{type:'relic-upgrade',relic:2});
  p=act(p,{type:'camp-build',building:'archive'});
  assert.deepEqual({duration:p.leisure.run!.duration,coin:p.leisure.run!.coinBonus,ore:p.leisure.run!.oreBonus,dust:p.leisure.run!.dustBonus},{duration:198,coin:1,ore:1,dust:1});
  p=finishStroll(p);
  assert.equal(p.leisure.cargo.coins,35,'current trip uses the one-star coin snapshot');
  assert.equal(p.leisure.cargo.ore,8,'one-star ore snapshot adds only to the boss room');
  assert.equal(p.leisure.journal.dust,94,'two repairs cost 8 dust; current run uses archive Lv1 snapshot plus one duplicate find');
  p=act(p,{type:'stroll-claim'});p=act(p,{type:'stroll-start',zone:0,route:'balanced',trips:1});
  assert.deepEqual({duration:p.leisure.run!.duration,coin:p.leisure.run!.coinBonus,ore:p.leisure.run!.oreBonus,dust:p.leisure.run!.dustBonus},{duration:196,coin:2,ore:1,dust:2});
});

test('the eight looping contracts rotate independently in each slot and delivery rewards conserve inputs',()=>{
  for(let slot=0;slot<3;slot++){
    let p=initialProfile(350_000+slot);p.leisure.clears=[1,1,1,1,1];
    const firstCoins=p.coins;
    for(let n=0;n<8;n++){
      const expected=CONTRACTS[(slot+n*3)%CONTRACTS.length];assert.equal(contractAt(p,slot).name,expected.name);
      for(const [item,count]of Object.entries(expected.items))p.leisure.materials[item as keyof typeof p.leisure.materials]=count;
      p.leisure.materials.ore=0;p.leisure.journal.dust=0;
      const prev=p.coins,ore=p.leisure.materials.ore;
      p=act(p,{type:'camp-deliver',slot});
      assert.equal(p.coins,prev+expected.coins);assert.equal(p.leisure.materials.ore,ore+expected.ore);
      assert.equal(p.leisure.journal.dust,expected.dust);assert.equal(p.leisure.journal.deliveries,n+1);
      for(const item of Object.keys(expected.items))assert.equal(p.leisure.materials[item as keyof typeof p.leisure.materials],0,`${item} input is consumed`);
    }
    assert.equal(p.leisure.journal.contracts[slot],8);assert.equal(p.leisure.journal.deliveries,8);
    assert.ok(p.coins>firstCoins);
  }
});

test('delivery checks region unlocks and reward capacity atomically without consuming materials',()=>{
  let p=initialProfile(360_000);p.leisure.materials.tea=2;
  const before=structuredClone(p);
  assert.throws(()=>act(p,{type:'camp-deliver',slot:2}),/委托对应地区/);assert.deepEqual(p,before);
  p.leisure.clears[0]=1;p.coins=1_000_000_000;const capped=structuredClone(p);
  assert.throws(()=>act(p,{type:'camp-deliver',slot:0}),/奖励空间不足/);assert.deepEqual(p,capped);
  p=initialProfile(361_000);p.leisure.clears=[1,1,1,1,1];p.leisure.materials.tea=2;p.leisure.materials.ore=9998;
  const oreFull=structuredClone(p);assert.throws(()=>act(p,{type:'camp-deliver',slot:0}),/奖励空间不足/);assert.deepEqual(p,oreFull);
  p.leisure.materials.ore=9997;p=act(p,{type:'camp-deliver',slot:0});assert.equal(p.leisure.materials.ore,9999,'exactly-full ore reward is accepted');
  p=initialProfile(362_000);p.leisure.clears=[1,1,1,1,1];p.leisure.materials.soup=2;p.leisure.journal.dust=9999;
  const dustFull=structuredClone(p);assert.throws(()=>act(p,{type:'camp-deliver',slot:2}),/奖励空间不足/);assert.deepEqual(p,dustFull);
});

test('new crop timers, seed prices, unlocks, recipes and output limits remain exact',()=>{
  assert.deepEqual({pumpkin:CROPS.pumpkin,snowflower:CROPS.snowflower},{pumpkin:{name:'蜜糖南瓜',ticks:7200,seed:10,yield:3,unlock:3},snowflower:{name:'雪绒花',ticks:9000,seed:12,yield:3,unlock:4}});
  assert.deepEqual({pie:FOODS.pie,snowtea:FOODS.snowtea},{pie:{name:'南瓜派',price:46,materials:{pumpkin:2},flour:2,gel:0},snowtea:{name:'雪绒暖茶',price:52,materials:{snowflower:2,herb:1},flour:0,gel:0}});
  let p=initialProfile(370_000);p.coins=100;p.leisure.clears=[1,1,1,0,0];
  assert.match(leisureReason(p,{type:'garden-plant',plot:0,crop:'pumpkin'}),/对应地区/);
  p.leisure.clears[3]=1;p.leisure.clears[4]=1;
  p=act(p,{type:'garden-plant',plot:0,crop:'pumpkin'});p=act(p,{type:'garden-plant',plot:1,crop:'snowflower'});
  assert.equal(p.coins,78);assert.deepEqual(p.leisure.plots.map(x=>x?.due),[7200,9000,undefined]);
  const early=structuredClone(p);assert.throws(()=>act(p,{type:'garden-harvest',plot:0}),/还在生长/);assert.deepEqual(p,early);
  p=ticks(p,9000);p=act(p,{type:'garden-harvest',plot:0});p=act(p,{type:'garden-harvest',plot:1});
  assert.equal(p.leisure.materials.pumpkin,3);assert.equal(p.leisure.materials.snowflower,3);
  p.bag.flour=10;p=act(p,{type:'camp-cook',food:'pie',count:1});
  assert.equal(p.leisure.materials.pumpkin,1);assert.equal(p.bag.flour,8);assert.equal(p.leisure.materials.pie,0,'queueing reserves ingredients but does not finish a dish instantly');
  p=ticks(p,600);assert.equal(p.leisure.materials.pie,1,'one pumpkin pie completes at its 600-tick timer');
  p.leisure.materials.herb=1;p=act(p,{type:'camp-cook',food:'snowtea',count:1});
  assert.equal(p.leisure.materials.snowflower,1);assert.equal(p.leisure.materials.herb,0);assert.equal(p.leisure.materials.snowtea,0);
  p=ticks(p,750);assert.equal(p.leisure.materials.snowtea,1,'one snowflower tea completes at its 750-tick timer');
  p.leisure.materials.pumpkin=9997;p.leisure.gardenLevel=0;p=act(p,{type:'garden-plant',plot:0,crop:'pumpkin'});p=ticks(p,7200);
  const full=structuredClone(p);assert.throws(()=>act(p,{type:'garden-harvest',plot:0}),/背包已满/);assert.deepEqual(p,full);
});

test('claim capacity is all-or-nothing and reserves gel against an in-flight legacy expedition',()=>{
  let p=initialProfile(380_000);p.leisure.cargo={coins:20,xp:30,gel:1,ore:1};p.bag.gel=99;p.leisure.materials.ore=9999;
  const before=structuredClone(p);assert.throws(()=>act(p,{type:'stroll-claim'}),/月纹石空间不足/);assert.deepEqual(p,before);
  p.leisure.materials.ore=9998;p=act(p,{type:'stroll-claim'});assert.equal(p.coins,40);assert.equal(p.xp,30);assert.equal(p.bag.gel,100);assert.equal(p.leisure.materials.ore,9999);
  p=initialProfile(381_000);p.job='keeper';p.cleared=[0];p.bag.ration=1;p=act(p,{type:'start-run',region:0,budget:1,auto:true});
  p.run!.loot=99;p.leisure.cargo={coins:20,xp:30,gel:2,ore:0};const reserved=structuredClone(p);
  assert.throws(()=>act(p,{type:'stroll-claim'}),/凝胶空间不足/);assert.deepEqual(p,reserved);
});

test('Lodge level sets leisure gel capacity to 100/150/200/250 and enabled claims remain parseable beside the old expedition',()=>{
  for(let level=0;level<=3;level++){
    let p=initialProfile(382_000+level);p.leisure.journal.buildings.lodge=level;p.bag.gel=99+50*level;
    p.leisure.cargo={coins:1,xp:1,gel:1,ore:0};
    const cap=leisureGelCapacity(p);assert.equal(cap,100+50*level);
    p=act(p,{type:'stroll-claim'});assert.equal(p.bag.gel,cap);
    p=initialProfile(383_000+level);p.leisure.journal.buildings.lodge=level;p.bag.gel=99+50*level;
    p.leisure.cargo={coins:1,xp:1,gel:2,ore:0};
    const full=structuredClone(p);assert.match(leisureReason(p,{type:'stroll-claim'}),/凝胶空间不足/);
    assert.throws(()=>act(p,{type:'stroll-claim'}),/凝胶空间不足/);assert.deepEqual(p,full);
  }

  let p=initialProfile(384_000);p.leisure.clears[0]=1;
  p=finishStroll(act(p,{type:'stroll-start',zone:0,route:'balanced',trips:1}));
  p.leisure.journal.buildings.lodge=1;p.job='keeper';p.cleared=[0];p.bag.ration=1;p.bag.gel=90;
  p=act(p,{type:'start-run',region:0,budget:1,auto:true});
  const claim={sequence:p.sequence+1,requestId:'luna060-claim-mixed-001',action:{type:'stroll-claim' as const}};
  const reason=leisureReason(p,claim.action);
  if(reason)assert.throws(()=>transact(p,claim),new RegExp(reason));
  else assert.doesNotThrow(()=>transact(p,claim),'a claim enabled by leisureReason must survive the v7 parser with an old expedition in flight');
});

test('replayed delivery receipt is idempotent, while stale or altered instructions cannot pay twice',()=>{
  let p=initialProfile(390_000);p.leisure.clears[0]=1;p.leisure.materials.tea=2;
  const envelope={sequence:p.sequence+1,requestId:'luna060-delivery-001',action:{type:'camp-deliver' as const,slot:0}};
  const once=transact(p,envelope);assert.equal(once.coins,p.coins+CONTRACTS[0].coins);assert.equal(once.leisure.journal.deliveries,1);
  assert.deepEqual(transact(once,envelope),once,'same sequence, request id and fingerprint returns the saved result without paying twice');
  assert.throws(()=>transact(once,{...envelope,requestId:'luna060-delivery-002'}),/过期/);
  assert.throws(()=>transact(once,{...envelope,action:{type:'camp-deliver',slot:1}}),/过期/);
  assert.equal(once.leisure.journal.deliveries,1);
});

test('maximum depth and six-trip duration/reward values are bounded and finite',()=>{
  let p=initialProfile(400_000);p.leisure.clears=[50,1,1,1,50];p.leisure.journal.buildings.lodge=3;
  p.leisure.companions.slime=14;p.leisure.journal.relics.fill(0);for(let i=2;i<15;i+=3)p.leisure.journal.relics[i]=3;
  p=act(p,{type:'stroll-start',zone:4,route:'gather',trips:6,depth:2});
  assert.equal(p.leisure.run!.duration,910,'Lv5 plus all five speed relics reduce 1400 ticks by 35%');
  assert.equal(p.leisure.run!.total,6);
  const started=p.wallAt;p=finishStroll(p);
  assert.equal(p.leisure.run,null);assert.equal(p.leisure.rooms,36);assert.equal(p.leisure.clears[4],56);
  assert.equal(p.wallAt-started,6*6*910*100);
  assert.deepEqual(p.leisure.cargo,{coins:2520,xp:1890,gel:126,ore:756});
  p=act(p,{type:'stroll-claim'});assert.equal(p.bag.gel,126,'six maximum gather trips fit inside the Level 3 capacity of 250');
});
