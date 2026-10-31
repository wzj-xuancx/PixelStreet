import test from 'node:test';
import assert from 'node:assert/strict';
import {initialProfile,parseProfile,parseAction,transact,advance,chapterView,isFreshChapterCandidate,type Profile,type GameAction} from '../packages/solo-core';
const act=(p:Profile,action:GameAction)=>transact(p,{sequence:p.sequence+1,requestId:'chapter-test-'+(p.sequence+1),action});
const ticks=(p:Profile,n:number)=>advance(p,p.wallAt+n*100);
const ready=()=>{const p=initialProfile(1000);p.job='keeper';p.coins=100;p.bag.gel=4;p.bag.ration=9;p.bag.flour=10;return p;};
const wear=(p:Profile)=>act(act(p,{type:'equipment-craft',id:'trail-coat'}),{type:'equipment-equip',id:'trail-coat'});
const depart=(p:Profile)=>act(p,{type:'start-run',region:0,budget:3,auto:false});
const won=(p:Profile)=>ticks(p,50);
const sale=(p:Profile)=>ticks(act(act(p,{type:'stock-shelf',recipe:'crystal',count:1}),{type:'retail',enabled:true}),300);
test('old absence roundtrip and pure view never installs a chapter; fresh candidate is read only',()=>{
 const p=initialProfile(1000),raw=JSON.stringify(p);assert.equal(chapterView(p).enrolled,false);assert.equal(chapterView(p).step,'demo');assert.equal(isFreshChapterCandidate(p),true);assert.equal(JSON.stringify(p),raw);assert.equal(Object.hasOwn(parseProfile(p),'chapter'),false);assert.equal(Object.hasOwn(ticks(p,20),'chapter'),false);assert.equal(isFreshChapterCandidate(ready()),false);
});
test('chapter intent keys and optional save extension are strict',()=>{
 for(const raw of [{type:'chapter-start',won:true},{type:'chapter-skip',runId:'run-1'},{type:'chapter-resume',coins:100},{type:'chapter-reward'},{type:['chapter-start']},{type:['chapter-skip']},{type:['chapter-resume']}])assert.throws(()=>parseAction(raw));
 const p=act(initialProfile(1000),{type:'chapter-start'});for(const raw of [[],null,{...p.chapter,unknown:1},{...p.chapter,returned:true},{...p.chapter,eligibleRunId:'run-999'}])assert.throws(()=>parseProfile({...p,chapter:raw}));
 assert.equal(p.coins,20);assert.equal(chapterView(p).step,'apply');assert.deepEqual(parseProfile(JSON.parse(JSON.stringify(p))),p);
});
test('start and receipt retry are idempotent; skip/resume preserves every actual fact',()=>{
 const envelope={sequence:1,requestId:'chapter-retry-01',action:{type:'chapter-start'}};const p=transact(initialProfile(1000),envelope);assert.deepEqual(transact(p,envelope),p);const q=act(p,{type:'chapter-start'});assert.deepEqual(q.chapter,p.chapter);
 let r=act(wear(ready()),{type:'chapter-start'});r=won(depart(r));const facts=structuredClone(r.chapter);r=act(r,{type:'chapter-skip'});assert.equal(chapterView(r).skipped,true);r=act(r,{type:'chapter-resume'});assert.deepEqual(r.chapter,facts);assert.equal(chapterView(r).nodes.find(n=>n.id==='win')!.done,true);
});
test('unarmored and preenrollment runs, current-only outfit, leisure history and unsolicited sale cannot create proof',()=>{
 let p=act(ready(),{type:'chapter-start'});p=won(depart(p));assert.equal(p.chapter!.wonRunId,null);p=act(p,{type:'retreat'});p.bag.crystal=1;p=sale(p);assert.equal(p.chapter!.sold,false);
 let q=depart(wear(ready()));q=act(q,{type:'chapter-start'});q=won(q);assert.equal(q.chapter!.wonRunId,null);
 let r=depart(act(wear(ready()),{type:'chapter-start'}));r.equipment!.active=null;r=won(r);assert.equal(r.chapter!.wonRunId,null);
 const s=act(ready(),{type:'chapter-start'});s.leisure.clears=[100,100,100,100,100];assert.equal(chapterView(s).nodes.find(n=>n.id==='win')!.done,false);
});
test('real coated win/return then real shelf crystal sale and collection complete without new rewards',()=>{
 let p=act(wear(ready()),{type:'chapter-start'});const before=p.coins;p=won(depart(p));assert.ok(p.chapter!.wonRunId);assert.equal(p.chapter!.returned,false);assert.equal(p.coins,before+4);p=act(p,{type:'retreat'});assert.equal(p.chapter!.returned,true);assert.equal(chapterView(p).nodes.find(n=>n.id==='return')!.done,true);
 p=act(p,{type:'craft',recipe:'crystal',count:1});p=ticks(p,100);p=sale(p);assert.equal(p.chapter!.sold,true);assert.equal(p.chapter!.collected,false);assert.equal(chapterView(p).step,'collect');const coins=p.coins;p=act(p,{type:'collect-till'});assert.equal(p.coins,coins+14);assert.equal(chapterView(p).step,'complete');assert.equal(chapterView(p).nodes.every(n=>n.done),true);assert.throws(()=>act(p,{type:'collect-till'}));assert.equal(p.tower,undefined);assert.equal(p.mastery,undefined);
});
test('loss and early retreat keep partial facts; stale earlier run cannot complete return',()=>{
 let p=depart(act(wear(ready()),{type:'chapter-start'}));p=act(p,{type:'retreat'});assert.equal(p.chapter!.returned,false);assert.equal(p.chapter!.eligibleRunId,null);assert.equal(p.chapter!.prepared,true);
 p=depart(p);p.cleared=[0,1];p.run!.region=2;p.run!.hp=1;p=ticks(p,60);assert.ok(!p.run||p.run.defeated.includes(2));assert.equal(p.chapter!.wonRunId,null);assert.equal(p.chapter!.returned,false);
 let q=won(depart(act(wear(ready()),{type:'chapter-start'})));q.run!.hp=1;q.run!.region=2;q.cleared=[0,1,2];q=ticks(q,70);q=act(q,{type:'retreat'});assert.equal(q.chapter!.returned,true);assert.ok(q.chapter!.wonRunId);
});
test('preexisting keeper/coat can resume next preparation step without inventing prior wins',()=>{
 let p=wear(ready());p.totals.wins=99;p=act(p,{type:'chapter-start'});assert.equal(chapterView(p).step,'depart');assert.equal(p.chapter!.wonRunId,null);p=act(p,{type:'chapter-skip'});assert.equal(chapterView(p).skipped,true);assert.equal(chapterView(p).enrolled,true);
});
test('fresh guided economic route uses original permissions/costs and enhanced cargo separately',()=>{
 let p=act(initialProfile(1000),{type:'chapter-start'});assert.equal(chapterView(p).step,'apply');
 p=act(p,{type:'apply-job'});assert.equal(chapterView(p).step,'trial-craft');p=act(p,{type:'craft',recipe:'ration',count:1});assert.equal(chapterView(p).step,'trial-wait');p=ticks(p,60);assert.equal(chapterView(p).step,'trial-deliver');p=act(p,{type:'deliver-trial'});assert.equal(p.coins,50);assert.equal(chapterView(p).step,'coat-material');
 p=act(p,{type:'trade',item:'gel',side:'buy',count:2});assert.equal(p.coins,40);assert.equal(chapterView(p).step,'coat-craft');p=act(p,{type:'equipment-craft',id:'trail-coat'});assert.equal(p.coins,32);assert.equal(chapterView(p).step,'coat-wear');p=act(p,{type:'equipment-equip',id:'trail-coat'});assert.equal(chapterView(p).step,'ration-material');
 p=act(p,{type:'trade',item:'flour',side:'buy',count:10});assert.equal(p.coins,22);assert.equal(chapterView(p).step,'ration-craft');p=act(p,{type:'queue-craft',recipe:'ration',count:3});assert.equal(chapterView(p).step,'ration-wait');p=ticks(p,180);assert.equal(chapterView(p).step,'depart');
 p=act(p,{type:'expedition-depart',region:0,budget:3,auto:false,mode:'survey',crew:'none',meal:'none'});assert.equal(p.run!.auto,false);p=ticks(p,2000);assert.equal(p.run,null);assert.equal(p.totals.wins,3);assert.equal(p.coins,34);assert.equal(p.xp,18);assert.equal(p.chapter!.returned,true);assert.equal(chapterView(p).step,'cargo');const gel=p.bag.gel;p=act(p,{type:'expedition-claim'});assert.equal(p.bag.gel,gel);assert.equal(chapterView(p).step,'crystal-craft');
 p=act(p,{type:'craft',recipe:'crystal',count:1});assert.equal(chapterView(p).step,'crystal-wait');p=ticks(p,100);assert.equal(chapterView(p).step,'crystal-stock');p=act(p,{type:'stock-shelf',recipe:'crystal',count:1});assert.equal(chapterView(p).step,'open');p=act(p,{type:'retail',enabled:true});assert.equal(chapterView(p).step,'sale-wait');p=ticks(p,300);assert.equal(chapterView(p).step,'collect');p=act(p,{type:'collect-till'});assert.equal(chapterView(p).step,'complete');assert.equal(p.coins,48);
});
