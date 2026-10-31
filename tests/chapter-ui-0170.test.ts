import test from 'node:test';
import assert from 'node:assert/strict';
import {initialProfile,transact,advance,chapterView,createFeedbackFeed,appendFeedback,type Profile} from '../packages/solo-core';
import {parseCommand} from '../packages/protocol';
import {chapterIntent,chapterFingerprint,chapterGenerationAllowed} from '../packages/protocol/chapter';
import {ChapterActionSession} from '../apps/desktop/chapter-session';
import {initialOpening,openingReduce} from '../apps/desktop/renderer/chapter-opening';
import {ChapterFeedbackConsumer} from '../apps/desktop/renderer/chapter-feedback';
const action=(p:Profile)=>{const intent=chapterIntent(p);assert.equal(intent.reason,'');assert.ok(intent.action);return transact(p,{sequence:p.sequence+1,requestId:'ui-test-'+(p.sequence+1),action:intent.action});};
const enroll=(p=initialProfile(1000))=>transact(p,{sequence:p.sequence+1,requestId:'ui-enroll-001',action:{type:'chapter-start'}});
const purchase=()=>{let p=enroll();p=action(p);p=action(p);p=advance(p,p.wallAt+6000);p=action(p);return p;};
test('opening is pure, skippable, suspended and time based; no Profile fields or RNG change',()=>{
 const p=initialProfile(1000),before=structuredClone(p);let s=openingReduce(initialOpening(),{type:'start'});s=openingReduce(s,{type:'suspend'});assert.equal(openingReduce(s,{type:'advance',ms:200}),s);s=openingReduce(s,{type:'resume'});for(let n=0;n<25;n++)s=openingReduce(s,{type:'advance',ms:200});assert.equal(s.phase,'defeated');assert.equal(s.hp,0);assert.equal(openingReduce(s,{type:'skip'}).phase,'done');assert.equal(openingReduce(initialOpening(),{type:'skip'}).phase,'done');assert.deepEqual(p,before);
});
test('consumer baselines retained events, deduplicates, resets epochs and drops suspended catchup',()=>{
 const f=createFeedbackFeed('ui-test'),c=new ChapterFeedbackConsumer();appendFeedback(f,[{tick:1,runId:'run-1',wave:1,kind:'hurt',amount:2}]);c.resume(f);assert.equal(c.pending.length,0);appendFeedback(f,[{tick:2,runId:'run-1',wave:1,kind:'attack',amount:6}]);c.accept(f);c.accept(f);assert.equal(c.pending.length,1);assert.equal(c.drain()[0].amount,6);c.suspend();appendFeedback(f,[{tick:3,runId:'run-1',wave:1,kind:'win',amount:4}]);c.resume(f);assert.equal(c.pending.length,0);const changed=createFeedbackFeed('changed');appendFeedback(changed,[{tick:4,runId:null,wave:0,kind:'sale',amount:14}]);c.accept(changed);assert.equal(c.pending.length,0);
});
test('canonical chapter path uses apprentice craft1, separate coat wear, exact purchases and guided survey',()=>{
 let p=enroll();assert.equal(chapterView(p).step,'apply');p=action(p);assert.deepEqual(chapterIntent(p).action,{type:'craft',recipe:'ration',count:1});p=action(p);assert.equal(chapterIntent(p).action,undefined);p=advance(p,p.wallAt+6000);p=action(p);assert.deepEqual(chapterIntent(p).action,{type:'trade',item:'gel',side:'buy',count:2});p=action(p);assert.equal(p.coins,40);p=action(p);assert.equal(p.equipment?.slots.body,null);assert.deepEqual(chapterIntent(p).action,{type:'equipment-equip',id:'trail-coat'});p=action(p);assert.equal(p.coins,32);assert.deepEqual(chapterIntent(p).action,{type:'trade',item:'flour',side:'buy',count:10});p=action(p);p=action(p);p=advance(p,p.wallAt+18000);assert.deepEqual(chapterIntent(p).action,{type:'expedition-depart',region:0,mode:'survey',budget:3,crew:'none',meal:'none',auto:false});p=action(p);assert.equal(p.run?.auto,false);p=advance(p,p.wallAt+200000);const coins=p.coins,gel=p.bag.gel,xp=p.xp;p=action(p);assert.equal(p.coins,coins);assert.equal(p.bag.gel,gel);assert.equal(p.xp,xp);for(let n=0;n<8&&chapterView(p).step!=='complete';n++){if(chapterIntent(p).action)p=action(p);else p=advance(p,p.wallAt+30000);}assert.equal(chapterView(p).step,'complete');assert.equal(p.tower,undefined);assert.equal(p.mastery,undefined);
});
test('real quote cancellation is pure; token, generation, expiry, sequence, price-related state are checked',()=>{
 const p=purchase(),before=structuredClone(p),session=new ChapterActionSession(),q=session.prepare(p,8,1000);assert.equal(q.coins,10);session.cancel();assert.throws(()=>session.confirm(p,8,q.token,1100));assert.deepEqual(p,before);
 for(const scenario of ['generation','expiry','sequence','coins','gel','step'] as const){const s=new ChapterActionSession(),v=s.prepare(p,8,1000),changed=structuredClone(p);if(scenario==='sequence')changed.sequence++;if(scenario==='coins')changed.coins--;if(scenario==='gel')changed.bag.gel++;if(scenario==='step')changed.bag.gel=2;assert.throws(()=>s.confirm(changed,scenario==='generation'?9:8,v.token,scenario==='expiry'?61000:1100));}
 const s=new ChapterActionSession(),v=s.prepare(p,8,1000);assert.deepEqual(s.confirm(p,8,v.token,1100),{type:'trade',item:'gel',side:'buy',count:2});assert.throws(()=>s.confirm(p,8,v.token,1200));
});
test('quote survives pure clock and unrelated work changes, but current relevant quantity changes invalidate',()=>{
 const p=purchase(),s=new ChapterActionSession(),q=s.prepare(p,5,1000),changed=structuredClone(p);changed.tick+=5;changed.wallAt+=500;changed.bag.crystal++;changed.queue={recipe:'ration',remaining:1,due:changed.tick+60};assert.equal(chapterFingerprint(changed),chapterFingerprint(p));assert.deepEqual(s.confirm(changed,5,q.token,1200),{type:'trade',item:'gel',side:'buy',count:2});
});
test('strict UI commands reject arbitrary action/reward/target and stale owner/generation',()=>{
 assert.deepEqual(parseCommand({type:'chapter',generation:3,op:'perform'}),{type:'chapter',generation:3,op:'perform'});for(const raw of [{type:'chapter',generation:3,op:'perform',action:{type:'equipment-craft',id:'moon-ring'}},{type:'chapter',generation:3,op:'perform',reward:99},{type:'chapter',generation:3,op:'open',target:'dungeon'},{type:'chapter',generation:0,op:'open'},{type:'chapter',generation:3,op:['perform']}])assert.throws(()=>parseCommand(raw));
 const popup={kind:'chapter',generation:8,suspended:false};assert.equal(chapterGenerationAllowed('popup',8,1,popup),true);assert.equal(chapterGenerationAllowed('popup',7,1,popup),false);assert.equal(chapterGenerationAllowed('popup',8,1,{...popup,suspended:true}),false);assert.equal(chapterGenerationAllowed('inventory',8,1,popup),false);assert.equal(chapterGenerationAllowed('overlay',2,1,popup),true);assert.equal(chapterGenerationAllowed('overlay',1,1,popup),false);
});
test('old save is opt in, wait actions never duplicate, missing funds remain read-only',()=>{
 const p=initialProfile(1000);p.sequence=9;p.job='keeper';p.coins=3;const before=structuredClone(p);assert.equal(chapterView(p).enrolled,false);assert.equal(chapterIntent(p).action,undefined);assert.deepEqual(p,before);const started=enroll(p);assert.match(chapterIntent(started).reason,/金币|不足/);assert.equal(chapterIntent(started).purchase,true);assert.throws(()=>new ChapterActionSession().prepare(started,1));const gelReady=structuredClone(started);gelReady.bag.gel=2;assert.equal(chapterIntent(gelReady).action,undefined);assert.match(chapterIntent(gelReady).reason,/8金币/);assert.deepEqual(p,before);
});

test('native presentation starts false and remains independent from authority visibility; hover is sufficient',async()=>{
 const {NativePresentation}=await import('../apps/desktop/native-presentation');const {presentationActive}=await import('../packages/protocol/presentation');
 const p=new NativePresentation(),options={pointer:true,documentVisible:true,blocked:false};assert.equal(presentationActive(p.snapshot().overlay,options),false);
 p.event('overlay','show');assert.equal(presentationActive(p.snapshot().overlay,options),true);assert.equal(presentationActive(p.snapshot().overlay,{...options,pointer:false}),false);
 p.event('overlay','focus');assert.equal(presentationActive(p.snapshot().overlay,{...options,pointer:false}),true);
 for(const event of ['hide','minimize','closed'] as const){p.event('overlay','show');p.event('overlay',event);assert.equal(presentationActive(p.snapshot().overlay,options),false);}
 p.event('overlay','show');assert.equal(presentationActive(p.snapshot().overlay,{...options,blocked:true}),false);assert.equal(presentationActive(p.snapshot().overlay,{...options,documentVisible:false}),false);
});
test('step cards show only current mutation costs, use a map and actual ration count at departure',async()=>{
 const {chapterCard}=await import('../apps/desktop/renderer/chapter-card');let p=purchase();p=action(p);p=action(p);const wear=chapterCard(p);assert.equal(chapterView(p).step,'coat-wear');assert.equal(wear.title,'旅途外套');assert.equal(wear.primary,'穿戴');assert.equal(wear.resources.length,0);assert.match(wear.note,/已制作/);assert.match(wear.description,/受击 −1/);
 p=action(p);p=action(p);p=action(p);p=advance(p,p.wallAt+18000);const depart=chapterCard(p);assert.equal(depart.map,true);assert.equal(depart.art,'');assert.equal(depart.worn,true);assert.deepEqual(depart.resources,[{id:'ration',name:'口粮',owned:3,needed:3}]);assert.equal(depart.primary,'出发 →');
 assert.equal(chapterCard(p,true).title,'旅途外套');
 assert.throws(()=>parseCommand({type:'chapter-demo-end',generation:1,session:1,outcome:'defeated',reward:14}));
 assert.deepEqual(parseCommand({type:'chapter-demo-end',generation:1,session:1,outcome:'skip'}),{type:'chapter-demo-end',generation:1,session:1,outcome:'skip'});
});
