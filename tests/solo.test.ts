import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {initialProfile,transact,advance,parseProfile,parseEnvelope,type GameAction,type Profile} from '../packages/solo-core';
import {GameStore} from '../apps/desktop/game-store';
const command=(p:Profile,action:GameAction,partySize=1)=>transact(p,{sequence:p.sequence+1,requestId:`test-req-${p.sequence+1}`,action},partySize);
test('F1 apprenticeship, six-second craft and one-time trial reward survive reload',t=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'pixelstreet-solo-test-'));t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));const store=new GameStore(folder,1000);let p=command(store.value,{type:'apply-job'});assert.equal(p.bag.flour,4);assert.equal(p.job,'apprentice');
 const e={sequence:p.sequence,requestId:p.receipt!.requestId,action:{type:'apply-job'}};assert.deepEqual(transact(p,e),p);assert.throws(()=>transact(p,{...e,action:{type:'deliver-trial'}}));
 p=command(p,{type:'craft',recipe:'ration',count:1});assert.equal(p.bag.flour,2);assert.equal(p.queue?.due,60);assert.throws(()=>command(p,{type:'craft',recipe:'ration',count:1}));p=advance(p,6999);assert.equal(p.bag.ration,0);p=advance(p,7000);assert.equal(p.bag.ration,1);p=command(p,{type:'deliver-trial'});assert.equal(p.coins,50);assert.equal(p.job,'keeper');assert.equal(p.bag.ration,0);assert.throws(()=>command(p,{type:'deliver-trial'}));store.save(p);assert.deepEqual(new GameStore(folder).value,p);
});
test('invalid economic envelopes and corrupted state are rejected, with no input mutation',()=>{const p=initialProfile(1000),before=structuredClone(p);for(const raw of [{sequence:1,requestId:'test-req-1',action:{type:'apply-job',coins:9}},{sequence:0,requestId:'test-req-1',action:{type:'apply-job'}},{sequence:1,requestId:'a',action:{type:'apply-job'}},{sequence:1,requestId:'test-req-1',action:{type:'craft',recipe:'ration',count:'1'}}])assert.throws(()=>parseEnvelope(raw));assert.throws(()=>command(p,{type:'deliver-trial'}));assert.deepEqual(p,before);for(const raw of [{...p,coins:-1},{...p,version:99},{...p,bag:{...p.bag,ration:Infinity}},{...p,token:'x'},{...p,sequence:1}])assert.throws(()=>parseProfile(raw));});
test('clock reversal awards nothing, offline cap is consumed once',()=>{let p=initialProfile(1000);p=advance(p,0);assert.equal(p.tick,0);assert.equal(p.wallAt,1000);p=advance(p,1000+12*3600*1000);assert.equal(p.tick,8*3600*10);const q=advance(p,p.wallAt);assert.deepEqual(q,p);});
test('invalid main uses valid backup and preserves exact damaged bytes; both corrupt never reset',t=>{const folder=fs.mkdtempSync(path.join(os.tmpdir(),'pixelstreet-solo-corrupt-'));t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));const store=new GameStore(folder,1000);store.save(command(store.value,{type:'apply-job'}));fs.writeFileSync(store.file,'{damaged');const recovered=new GameStore(folder);assert.equal(recovered.value.job,'visitor');assert.equal(fs.readFileSync(store.file,'utf8'),'{damaged');recovered.save(recovered.value);const kept=fs.readdirSync(folder).find(f=>f.includes('.corrupt-'));assert.ok(kept);assert.equal(fs.readFileSync(path.join(folder,kept),'utf8'),'{damaged');fs.writeFileSync(store.file,'bad-main');fs.writeFileSync(store.file+'.bak','bad-backup');assert.throws(()=>new GameStore(folder),/不会清空/);assert.equal(fs.readFileSync(store.file,'utf8'),'bad-main');assert.equal(fs.readFileSync(store.file+'.bak','utf8'),'bad-backup');});
test('failed disk write never publishes a tentative economic transaction',t=>{const folder=fs.mkdtempSync(path.join(os.tmpdir(),'pixelstreet-solo-write-'));t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));const store=new GameStore(folder,1000),before=structuredClone(store.value),next=command(before,{type:'apply-job'});fs.unlinkSync(store.file);fs.mkdirSync(store.file);assert.throws(()=>store.save(next));assert.deepEqual(store.value,before);});
test('enums are primitives, never array-to-string coercions',()=>{for(const action of [{type:['apply-job']},{type:'craft',recipe:['ration'],count:1}])assert.throws(()=>parseEnvelope({sequence:1,requestId:'test-req-1',action}));assert.throws(()=>parseProfile({...initialProfile(1000),job:['visitor']}));});
function keeper(now=1000){let p=command(initialProfile(now),{type:'apply-job'});p=command(p,{type:'craft',recipe:'ration',count:1});return command(advance(p,now+6000),{type:'deliver-trial'});}
test('F2 single queue precharges all materials, yields each unit once, rejects overspend',()=>{let p=keeper();p=command(p,{type:'buy-flour'});assert.equal(p.coins,40);assert.equal(p.bag.flour,12);p=command(p,{type:'craft',recipe:'ration',count:3});assert.equal(p.bag.flour,6);const start=p.wallAt;p=advance(p,start+5999);assert.equal(p.bag.ration,0);p=advance(p,start+6000);assert.equal(p.bag.ration,1);assert.equal(p.queue?.remaining,2);p=advance(p,start+18000);assert.equal(p.bag.ration,3);assert.equal(p.queue,null);assert.equal(p.totals.crafted,4);assert.throws(()=>command({...p,coins:9},{type:'buy-flour'}));assert.throws(()=>command(p,{type:'craft',recipe:'crystal',count:1}));});
test('F2 NPC sales reserve 2 rations, crystal recipe connects field material to income',()=>{let p=keeper();p.bag.flour=10;p.bag.gel=6;p=command(p,{type:'craft',recipe:'crystal',count:3});assert.equal(p.bag.gel,0);assert.equal(p.bag.flour,7);p=advance(p,p.wallAt+30000);assert.equal(p.bag.crystal,3);p.bag.ration=5;p=command(p,{type:'retail',enabled:true});p=advance(p,p.wallAt+60000);assert.equal(p.bag.crystal,0);assert.equal(p.bag.ration,2);assert.equal(p.totals.sold,6);assert.equal(p.coins,50+42+15);const coins=p.coins;p=advance(p,p.wallAt+60000);assert.equal(p.coins,coins);p=command(p,{type:'retail',enabled:false});p.bag.crystal=1;p=advance(p,p.wallAt+60000);assert.equal(p.bag.crystal,1);});
test('F2 upgrade is all-or-nothing, consumes once and apprentice cannot use keeper actions',()=>{let p=keeper();assert.throws(()=>command(p,{type:'upgrade'}));assert.equal(p.coins,50);p.bag.gel=5;p=command(p,{type:'upgrade'});assert.equal(p.coins,30);assert.equal(p.bag.gel,0);assert.equal(p.upgraded,true);assert.throws(()=>command(p,{type:'upgrade'}));const a=command(initialProfile(1000),{type:'apply-job'});for(const action of [{type:'buy-flour'},{type:'retail',enabled:true},{type:'upgrade'},{type:'craft',recipe:'crystal',count:1},{type:'craft',recipe:'ration',count:3}]as GameAction[])assert.throws(()=>command(a,action));});
function adventurer(){const p=keeper();p.bag.ration=9;return p;}
test('F3 idle expedition reserves finite food, awards solo gold and XP, stops without purchases',()=>{let p=adventurer();const coins=p.coins,xp=p.xp;p=command(p,{type:'start-run',region:0,budget:3,auto:true});assert.equal(p.bag.ration,6);const id=p.run!.id;p=advance(p,p.wallAt+120000);assert.equal(p.run,null);assert.equal(p.totals.wins,3);assert.ok(p.bag.gel>=3&&p.bag.gel<=6);assert.equal(p.bag.ration,6);assert.equal(p.coins,coins+12);assert.equal(p.xp,xp+18);assert.deepEqual(p.cleared,[0]);assert.match(p.lastTrip,/补给耗尽/);assert.ok(id.startsWith('run-'));});
test('F3 defeat falls back in the same run and budget, keeps loot, continues farming',()=>{let p=adventurer();p.cleared=[0,1];p=command(p,{type:'start-run',region:2,budget:6,auto:false});const id=p.run!.id;p=advance(p,p.wallAt+10000);assert.equal(p.run!.region,1);assert.equal(p.run!.phase,'recover');assert.equal(p.run!.remaining,5);assert.equal(p.run!.spent,1);assert.equal(p.run!.id,id);assert.deepEqual(p.run!.defeated,[2]);p.run!.loot=3;const oldWins=p.totals.wins;p=advance(p,p.wallAt+30000);assert.ok(p.totals.wins>oldWins);assert.equal(p.run?.region,1);assert.ok((p.run?.loot??p.bag.gel)>=3);});
test('F3 consecutive defeat steps down, no lower cleared region stops safely',()=>{let p=adventurer();p.cleared=[0,1];p=command(p,{type:'start-run',region:2,budget:6,auto:false});p=advance(p,p.wallAt+1000);p.run!.hp=1;p.run!.enemyAttack=p.tick+1;p=advance(p,p.wallAt+100);assert.equal(p.run!.region,1);p=advance(p,p.wallAt+8000);p.run!.hp=1;p.run!.enemyAttack=p.tick+1;p=advance(p,p.wallAt+100);assert.equal(p.run!.region,0);assert.deepEqual(p.run!.defeated,[2,1]);p=advance(p,p.wallAt+8000);p.run!.hp=1;p.run!.enemyAttack=p.tick+1;p=advance(p,p.wallAt+100);assert.equal(p.run,null);assert.match(p.lastTrip,/没有可退守/);assert.equal(p.bag.ration,6);});
test('F3 manual combo shares cooldown and validates exact live target',()=>{let p=command(adventurer(),{type:'start-run',region:0,budget:3,auto:false});p=advance(p,p.wallAt+1000);const r=p.run!,before=structuredClone(p);assert.throws(()=>command(p,{type:'skill',skill:'frost',runId:'run-999',wave:r.wave}));assert.deepEqual(p,before);p=command(p,{type:'skill',skill:'frost',runId:r.id,wave:r.wave});assert.equal(p.run!.enemyHP,16);assert.equal(p.run!.frostReady,p.tick+80);assert.throws(()=>command(p,{type:'skill',skill:'frost',runId:r.id,wave:r.wave}));p=command(p,{type:'skill',skill:'shatter',runId:r.id,wave:r.wave});assert.equal(p.totals.wins,1);const frost=p.run!.frostReady;p=advance(p,p.wallAt+2000);assert.equal(p.run!.wave,2);assert.equal(p.run!.frostReady,frost);assert.throws(()=>command(p,{type:'skill',skill:'shatter',runId:r.id,wave:1}));});
test('F3 retreat refunds unused reserved food, backpack stops before dropping rewards',()=>{let p=command(adventurer(),{type:'start-run',region:0,budget:9,auto:true});p=command(p,{type:'retreat'});assert.equal(p.bag.ration,9);assert.equal(p.run,null);p.bag.gel=98;p=command(p,{type:'start-run',region:0,budget:9,auto:true});p=advance(p,p.wallAt+120000);assert.equal(p.run,null);assert.ok(p.bag.gel>=99&&p.bag.gel<=100);assert.equal(p.bag.ration,8);assert.match(p.lastTrip,/背包/);assert.throws(()=>command(p,{type:'start-run',region:0,budget:1,auto:true}));});
test('F3 gel capacity reserves the solo maximum while respecting current party carry',()=>{
 let solo=adventurer();solo.bag.gel=98;
 solo=command(solo,{type:'start-run',region:0,budget:1,auto:false},1);
 solo=advance(solo,solo.wallAt+1000,1);
 assert.equal(solo.run?.phase,'fight');assert.equal(solo.bag.gel,98);

 let party=adventurer();party.bag.gel=98;party.rewardRemainders.gel=70;
 assert.throws(()=>command(party,{type:'start-run',region:0,budget:1,auto:false},4),/凝胶背包空间不足/);
});
test('F3 party growth before a fight rechecks capacity without spending ration',()=>{
 let p=adventurer();p.bag.gel=98;p.rewardRemainders.gel=70;
 p=command(p,{type:'start-run',region:0,budget:1,auto:false},1);
 p=advance(p,p.wallAt+1000,4);
 assert.equal(p.run,null);assert.equal(p.bag.gel,98);assert.equal(p.bag.ration,9);assert.equal(p.totals.wins,0);
 assert.match(p.lastTrip,/凝胶背包即将满/);
});
test('F3 party growth during a fight that would overflow settles nothing and refunds that ration',()=>{
 let p=adventurer();p.bag.gel=98;p.rewardRemainders.gel=70;
 p=command(p,{type:'start-run',region:0,budget:2,auto:false},1);
 p=advance(p,p.wallAt+1000,1);
 assert.equal(p.run?.phase,'fight');
 p.rng=1;const coins=p.coins,xp=p.xp,wins=p.totals.wins,remainders=structuredClone(p.rewardRemainders),rng=p.rng;
 p.run!.enemyHP=1;p.run!.nextAttack=p.tick+1;p.run!.enemyAttack=p.tick+100;
 p=advance(p,p.wallAt+100,4);
 assert.equal(p.run,null);assert.equal(p.bag.gel,98);assert.equal(p.bag.ration,9);
 assert.equal(p.coins,coins);assert.equal(p.xp,xp);assert.equal(p.totals.wins,wins);assert.deepEqual(p.rewardRemainders,remainders);assert.equal(p.rng,rng);
 assert.match(p.lastTrip,/本场未计奖励并退还口粮/);
});
test('F3 after-win reservation uses party size and updated gel remainder for the next fight',()=>{
 let p=adventurer();p.bag.gel=97;
 p=command(p,{type:'start-run',region:0,budget:2,auto:false},1);
 p=advance(p,p.wallAt+1000,1);
 p.rng=2;p.run!.enemyHP=1;p.run!.nextAttack=p.tick+1;p.run!.enemyAttack=p.tick+100;
 p=advance(p,p.wallAt+100,1);
 assert.equal(p.bag.gel,97);assert.equal(p.run?.loot,1);assert.equal(p.rewardRemainders.gel,0);assert.equal(p.run?.phase,'travel');
 p=advance(p,p.wallAt+2000,1);
 assert.equal(p.run?.phase,'fight');assert.equal(p.run?.remaining,0);assert.equal(p.run?.loot,1);
});
test('F3 target mark never transfers to the next monster, cooldowns do persist',()=>{let p=command(adventurer(),{type:'start-run',region:0,budget:3,auto:false});p=advance(p,p.wallAt+1000);p.run!.enemyHP=8;const r=p.run!;p=command(p,{type:'skill',skill:'frost',runId:r.id,wave:r.wave});assert.equal(p.totals.wins,1);const ready=p.run!.frostReady;p=advance(p,p.wallAt+2000);assert.equal(p.run!.markedUntil,0);assert.equal(p.run!.frostReady,ready);p=command(p,{type:'skill',skill:'shatter',runId:r.id,wave:2});assert.equal(p.run!.enemyHP,10);});
