import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {initialProfile,transact,advance,parseProfile,parseEnvelope,orderReward,queueLimit,batchLimit,salePrice,tradeQuote,hasBusinessWork,type GameAction,type Profile} from '../packages/solo-core';
import {GameStore} from '../apps/desktop/game-store';
const cmd=(p:Profile,action:GameAction)=>transact(p,{sequence:p.sequence+1,requestId:`business-request-${p.sequence+1}`,action});
function trained():Profile{let p=cmd(initialProfile(1000),{type:'apply-job'});p=cmd(p,{type:'craft',recipe:'ration',count:1});p=advance(p,7000);return cmd(p,{type:'deliver-trial'});}
function stocked():Profile{const p=trained();p.coins=1000;p.bag={flour:300,gel:90,ration:20,crystal:20};return parseProfile(p);}
const units=(p:Profile)=>({flour:p.bag.flour+((p.queue?.recipe==='ration'?2:1)*(p.queue?.remaining??0))+p.business.pending.reduce((n,q)=>n+(q.recipe==='ration'?2:1)*q.remaining,0),gel:p.bag.gel+(p.queue?.recipe==='crystal'?2*p.queue.remaining:0)+p.business.pending.reduce((n,q)=>n+(q.recipe==='crystal'?2*q.remaining:0),0)});

test('NPC starter route earns order revenue and upgrades without fixture grants or active dungeon',()=>{
 let p=trained();p=cmd(p,{type:'buy-flour'});const o=p.business.orders[0];p=cmd(p,{type:'order-accept',slot:0,revision:o.revision});p=cmd(p,{type:'queue-craft',recipe:'ration',count:o.count});p=advance(p,p.wallAt+o.count*6000);const coins=p.coins;p=cmd(p,{type:'order-deliver',slot:0,revision:0});assert.equal(p.coins,coins+orderReward(o));assert.equal(p.business.reputation,1);assert.equal(p.business.completed,1);assert.equal(p.business.orders[0].revision,1);assert.equal(p.bag.ration,0);assert.throws(()=>cmd(p,{type:'order-deliver',slot:0,revision:0}));
 while(p.coins<50){p=cmd(p,{type:'buy-flour'});const order=p.business.orders[0];p=cmd(p,{type:'order-accept',slot:0,revision:order.revision});p=cmd(p,{type:'queue-craft',recipe:'ration',count:order.count});p=advance(p,p.wallAt+order.count*6000);p=cmd(p,{type:'order-deliver',slot:0,revision:order.revision});}
 p=cmd(p,{type:'shop-upgrade',upgrade:'workbench'});assert.equal(queueLimit(p.business),4);assert.equal(batchLimit(p.business),50);
});
test('batch pipeline prepays inputs, counts current job toward cap, produces each unit once',()=>{
 let p=stocked();p=cmd(p,{type:'queue-craft',recipe:'ration',count:30});p=cmd(p,{type:'queue-craft',recipe:'crystal',count:30});p=cmd(p,{type:'queue-craft',recipe:'ration',count:10});assert.equal(p.bag.flour,190);assert.equal(p.bag.gel,30);assert.throws(()=>cmd(p,{type:'queue-craft',recipe:'ration',count:1}),/排产/);const end=p.wallAt+540000;p=advance(p,end);assert.equal(p.bag.ration,60);assert.equal(p.bag.crystal,50);assert.equal(p.queue,null);assert.deepEqual(p.business.pending,[]);assert.equal(p.totals.crafted,71);assert.deepEqual(advance(p,end),p);
});
test('three 30-meal batches are reachable with bulk purchases and fit a fifteen-minute unattended session',()=>{
 let p=trained();p.coins=1200;
 for(let i=0;i<2;i++)p=cmd(p,{type:'trade',item:'flour',side:'buy',count:50});
 for(let i=0;i<2;i++)p=cmd(p,{type:'trade',item:'gel',side:'buy',count:50});
 for(let i=0;i<3;i++){if(i)p=cmd(p,{type:'trade',item:'gel',side:'buy',count:50});p=cmd(p,{type:'queue-craft',recipe:'crystal',count:30});}
 assert.equal(p.bag.gel,20);assert.equal(p.coins,100);assert.equal(p.business.pending.length,2);
 p=advance(p,p.wallAt+15*60000);assert.equal(p.bag.crystal,90);assert.equal(p.bag.flour,12);assert.equal(p.queue,null);assert.equal(p.business.pending.length,0);
});
test('cancel pending and partly completed current batch refunds only unused prepaid ingredients',()=>{
 let p=stocked();const before=units(p);p=cmd(p,{type:'queue-craft',recipe:'ration',count:10});p=cmd(p,{type:'queue-craft',recipe:'crystal',count:10});assert.deepEqual(units(p),before);p=cmd(p,{type:'cancel-craft',position:1});assert.deepEqual(units(p),before);p=advance(p,p.wallAt+12000);assert.equal(p.queue?.remaining,8);p=cmd(p,{type:'cancel-craft',position:0});assert.equal(p.bag.flour,before.flour-4);assert.equal(p.bag.gel,before.gel);assert.equal(p.bag.ration,22);assert.equal(p.queue,null);assert.throws(()=>cmd(p,{type:'cancel-craft',position:0}));
});
test('cancel cannot lose refund to full material inventory and does not mutate rejected source',()=>{
 let p=stocked();p=cmd(p,{type:'queue-craft',recipe:'crystal',count:10});p.bag.gel=100;const before=structuredClone(p);assert.throws(()=>cmd(p,{type:'cancel-craft',position:0}),/空间/);assert.deepEqual(p,before);
});
test('legal migrated v4 surplus gel does not block a ration cancellation that refunds zero gel',()=>{
 const source=stocked();source.bag.gel=101;const {leisure,business,...legacy}=source;
 delete (legacy as unknown as Record<string,unknown>).camp;
 let p=parseProfile({...legacy,version:4});const flour=p.bag.flour;p=cmd(p,{type:'queue-craft',recipe:'ration',count:1});p=cmd(p,{type:'cancel-craft',position:0});assert.equal(p.bag.flour,flour);assert.equal(p.bag.gel,101);assert.equal(p.queue,null);
});
test('shelf reserves inventory, sale goes only to till, explicit collection is idempotent',()=>{
 let p=stocked(),coins=p.coins;p=cmd(p,{type:'stock-shelf',recipe:'ration',count:5});assert.equal(p.bag.ration,15);assert.equal(p.business.shelves.ration.stock,5);p=advance(p,p.wallAt+60000);assert.equal(p.business.till,0);p=cmd(p,{type:'retail',enabled:true});p=advance(p,p.wallAt+60000);assert.equal(p.coins,coins);assert.equal(p.business.till,10);assert.equal(p.business.shelves.ration.stock,3);assert.equal(p.bag.crystal,20);const envelope={sequence:p.sequence+1,requestId:'collect-business-once',action:{type:'collect-till'} as const};p=transact(p,envelope);assert.equal(p.coins,coins+10);assert.equal(p.business.till,0);assert.deepEqual(transact(p,envelope),p);assert.throws(()=>cmd(p,{type:'collect-till'}));
});
test('pricing resets sale clock, same price does not, closed store cannot retroactively sell',()=>{
 let p=cmd(cmd(stocked(),{type:'stock-shelf',recipe:'crystal',count:5}),{type:'retail',enabled:true});p=advance(p,p.wallAt+29000);p=cmd(p,{type:'price-shelf',recipe:'crystal',tier:'premium'});const due=p.business.shelves.crystal.due;p=cmd(p,{type:'price-shelf',recipe:'crystal',tier:'premium'});assert.equal(p.business.shelves.crystal.due,due);p=advance(p,p.wallAt+59000);assert.equal(p.business.till,0);p=advance(p,p.wallAt+1000);assert.equal(p.business.till,salePrice('crystal','premium'));p=cmd(p,{type:'retail',enabled:false});p=advance(p,p.wallAt+3600000);assert.equal(p.business.shelves.crystal.stock,4);p=cmd(p,{type:'retail',enabled:true});p=advance(p,p.wallAt+100);assert.equal(p.business.shelves.crystal.stock,4);
});
test('full till and full wallet never consume stock before successful settlement',()=>{
 let p=cmd(cmd(stocked(),{type:'stock-shelf',recipe:'ration',count:5}),{type:'retail',enabled:true});p.business.till=1e9;p=advance(p,p.wallAt+60000);assert.equal(p.business.shelves.ration.stock,5);assert.equal(hasBusinessWork(p),false);assert.throws(()=>cmd(p,{type:'collect-till'}),/空间/);p.business.till=100;p.coins=1e9-99;assert.throws(()=>cmd(p,{type:'collect-till'}));assert.equal(p.business.till,100);
});
test('unlisting conserves items and stock limit includes both products',()=>{
 let p=stocked();p=cmd(p,{type:'stock-shelf',recipe:'ration',count:15});p=cmd(p,{type:'stock-shelf',recipe:'crystal',count:5});assert.throws(()=>cmd(p,{type:'stock-shelf',recipe:'crystal',count:1}),/货架/);p=cmd(p,{type:'unstock-shelf',recipe:'ration',count:15});p=cmd(p,{type:'unstock-shelf',recipe:'crystal',count:5});assert.equal(p.bag.ration,20);assert.equal(p.bag.crystal,20);assert.equal(p.business.managed,true);
});
test('orders do not expire while offline; accept and cancel do not grant assets',()=>{
 let p=stocked();const before=p.coins,bag=structuredClone(p.bag);p=cmd(p,{type:'order-accept',slot:1,revision:0});p=advance(p,p.wallAt+24*3600000);assert.equal(p.business.orders[1].accepted,true);p=cmd(p,{type:'order-cancel',slot:1,revision:0});assert.equal(p.coins,before);assert.deepEqual(p.bag,bag);assert.throws(()=>cmd(p,{type:'order-deliver',slot:1,revision:0}),/接单/);
});
test('merchant prices cannot produce buy/sell arbitrage and capacity protects expedition loot',()=>{
 for(const item of ['flour','gel'] as const)for(const n of [1,5,10,100])assert.ok(tradeQuote(item,'sell',n)<tradeQuote(item,'buy',n));
 let p=stocked();p=cmd(p,{type:'trade',item:'gel',side:'buy',count:5});p=cmd(p,{type:'trade',item:'gel',side:'sell',count:5});assert.equal(p.coins,985);assert.equal(p.bag.gel,90);p=cmd(p,{type:'trade',item:'flour',side:'sell',count:5});assert.equal(p.coins,988);assert.throws(()=>cmd(p,{type:'trade',item:'ration',side:'buy',count:1}));assert.throws(()=>cmd(p,{type:'trade',item:'gel',side:'buy',count:11}));
});
test('upgrade costs and reputation gates apply atomically; oven changes future item deadlines',()=>{
 let p=stocked();p=cmd(p,{type:'queue-craft',recipe:'ration',count:3});const firstDue=p.queue!.due;p=cmd(p,{type:'shop-upgrade',upgrade:'oven'});assert.equal(p.coins,940);assert.equal(p.queue!.due,firstDue);assert.throws(()=>cmd(p,{type:'shop-upgrade',upgrade:'oven'}),/声望/);p=advance(p,p.wallAt+6000);assert.equal(p.queue?.due,firstDue+54);p=cmd(p,{type:'shop-upgrade',upgrade:'shelves'});assert.equal(p.business.upgrades.shelves,1);p=cmd(p,{type:'stock-shelf',recipe:'ration',count:20});p=cmd(p,{type:'stock-shelf',recipe:'crystal',count:20});assert.equal(p.business.shelves.crystal.stock,20);
});
test('whole and chunked offline settlement agree, replay/backwards time gives no double output',()=>{
 let p=stocked();p=cmd(p,{type:'queue-craft',recipe:'ration',count:30});p=cmd(p,{type:'queue-craft',recipe:'crystal',count:30});p=cmd(p,{type:'stock-shelf',recipe:'crystal',count:20});p=cmd(p,{type:'retail',enabled:true});const end=p.wallAt+900000,once=advance(p,end);let chunks=p;for(let at=p.wallAt+137;at<end;at+=137)chunks=advance(JSON.parse(JSON.stringify(chunks)),at);chunks=advance(chunks,end);assert.deepEqual(chunks,once);assert.deepEqual(advance(once,end),once);assert.deepEqual(advance(once,end-500000),once);assert.equal(once.business.till,280);
});
test('v4 migration preserves legacy retail, receipts and exact original bytes, with current business saved durably',t=>{
 const p=stocked(),{leisure,business,...rest}=p,old={...rest,version:4};delete (old as unknown as Record<string,unknown>).camp;const before=structuredClone(old),bytes=JSON.stringify(old,null,2)+'\n';const parsed=parseProfile(old);assert.equal(parsed.version,8);assert.equal(parsed.business.managed,false);assert.deepEqual(old,before);const folder=fs.mkdtempSync(path.join(os.tmpdir(),'pixelstreet-business-migration-'));t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));fs.writeFileSync(path.join(folder,'profile.json'),bytes);const store=new GameStore(folder);store.save(store.value);assert.equal(fs.readFileSync(path.join(folder,'profile.v4-before-migration.json'),'utf8'),bytes);assert.deepEqual(new GameStore(folder).value,parsed);
});
test('strict economic input/parser rejects forged rewards, unknown fields, holes and impossible order ledger',()=>{
 for(const action of [{type:'collect-till',coins:500},{type:'trade',item:'gel',side:'buy',count:-1},{type:'trade',item:['gel'],side:'buy',count:5},{type:'order-deliver',slot:0,revision:0,reward:99},{type:'queue-craft',recipe:'ration',count:1.5},{type:'shop-upgrade',upgrade:'oops'}])assert.throws(()=>parseEnvelope({sequence:1,requestId:'invalid-business',action}));
 for(const mutate of [(p:Profile)=>{p.business.till=-1;},(p:Profile)=>{p.business.orders[0].count++;},(p:Profile)=>{p.business.orders[0].revision++;},(p:Profile)=>{p.business.pending=new Array(2);},(p:Profile)=>{p.business.shelves.ration.stock=21;},(p:Profile)=>{p.business.orders=new Array(3);},(p:Profile)=>{p.business.upgrades.oven=4;}]){const p=stocked();mutate(p);assert.throws(()=>parseProfile(p));}
});
