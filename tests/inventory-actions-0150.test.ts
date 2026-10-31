import test from 'node:test';
import assert from 'node:assert/strict';
import {initialProfile,transact,initialFieldProgress,type Profile} from '../packages/solo-core';
import {initialAtelier,GOOD_IDS,FORMULAS} from '../packages/solo-core/atelier';
import {MATERIALS,FOODS} from '../packages/solo-core/leisure';
import {inventoryAction,inventoryCapabilities,parseInventoryActionRequest,type InventoryActionRequest} from '../packages/solo-core/inventory-actions';
import {InventoryActionSession} from '../apps/desktop/inventory-session';
import {INVENTORY_CATALOG} from '../packages/content/inventory-catalog';
import {inventoryTargets,parseCommand,towerTargets} from '../packages/protocol';
import {towerNavigator} from '../apps/desktop/renderer/tower-navigation';
const filled=():Profile=>{const p=initialProfile(100);p.job='keeper';p.coins=100;p.fieldProgress=initialFieldProgress();for(const key of ['bone','curseCrystal','toughHide'] as const)p.fieldProgress.materials[key]=20;p.atelier=initialAtelier();for(const key of Object.keys(p.bag) as (keyof Profile['bag'])[])p.bag[key]=20;for(const key of Object.keys(MATERIALS) as (keyof typeof MATERIALS)[])p.leisure.materials[key]=20;for(const good of GOOD_IDS)p.atelier.stock[good]=20;p.leisure.journal.dust=20;p.leisure.plots[0]={crop:'herb',due:1000};return p;};
const request=(itemId:string,kind:'use'|'sell',count:number):InventoryActionRequest=>({itemId,kind,count});
test('all 30 identities enumerate legacy abilities plus the three explicit material sales',()=>{
 const p=filled();assert.equal(INVENTORY_CATALOG.length,30);
 for(const item of INVENTORY_CATALOG){const [source,key]=item.id.split(':');const expected=source==='field'?['sell']:source==='bag'?['sell']:source==='atelier'&&!['ingot','herbal-bandage','mining-tonic'].includes(key)?['use']:source==='materials'&&(key==='ore'||Object.hasOwn(FOODS,key))?['sell']:[];assert.deepEqual(inventoryCapabilities(p,item.id).map(c=>c.kind),expected,item.id);}
 assert.deepEqual(INVENTORY_CATALOG.find(i=>i.id==='materials:biscuit')!.links.map(l=>l.target),['kitchen','companions']);
});
test('preview is read only, uses exact existing source command and preserves shelves/cargo',()=>{
 const p=filled(),before=structuredClone(p);p.business.managed=true;p.business.shelves.ration.stock=3;const snapshot=structuredClone(p),session=new InventoryActionSession(),r=request('bag:ration','sell',7),preview=session.prepare(p,9,r,1000);assert.deepEqual(p,snapshot);assert.equal(preview.quote.proceeds,28);
 const {action}=inventoryAction(p,r),actual=session.confirm(p,9,preview.token,1,1001),expected=transact(p,{sequence:1,requestId:preview.token,action});assert.deepEqual(actual,expected);assert.equal(actual.bag.ration,13);assert.equal(actual.business.shelves.ration.stock,3);assert.equal(actual.leisure.cargo.ore,before.leisure.cargo.ore);assert.deepEqual(p,snapshot);
 assert.throws(()=>session.confirm(actual,9,preview.token,1,1002),/过期/);
});
test('all 8 single-use goods preserve exact old effects, consuming one only',()=>{
 for(const good of GOOD_IDS.filter(g=>!['ingot','herbal-bandage','mining-tonic'].includes(g))){const p=filled(),session=new InventoryActionSession(),preview=session.prepare(p,1,request('atelier:'+good,'use',1),100);const next=session.confirm(p,1,preview.token,1,101);assert.equal(next.atelier!.stock[good],19,good);if(good==='dew')assert.equal(next.leisure.plots[0]!.due,700);else for(const [key,count]of Object.entries(FORMULAS[good].gives!)){const source=key==='dust'?next.leisure.journal:key in next.bag?next.bag:next.leisure.materials,old=key==='dust'?p.leisure.journal:key in p.bag?p.bag:p.leisure.materials;assert.equal((source as any)[key],(old as any)[key]+count!);}}
});
test('real sale quotes preserve flour rounding, food workshop bonus and ore exact 10-for-20',()=>{
 const p=filled();assert.equal(inventoryAction(p,request('bag:flour','sell',5)).quote.proceeds,3);assert.match(inventoryAction(p,request('bag:flour','sell',1)).quote.reason,/至少2/);
 p.leisure.journal.buildings.workshop=2;
 for(const [food,f]of Object.entries(FOODS)){const q=inventoryAction(p,request('materials:'+food,'sell',20));assert.equal(q.quote.proceeds,(f.price+4)*20);assert.deepEqual(q.action,{type:'camp-sell',food,all:true});assert.throws(()=>inventoryAction(p,request('materials:'+food,'sell',3)));}
 const session=new InventoryActionSession(),preview=session.prepare(p,1,request('materials:ore','sell',10));const next=session.confirm(p,1,preview.token);assert.equal(next.coins,120);assert.equal(next.leisure.materials.ore,10);assert.throws(()=>inventoryAction(p,request('materials:ore','sell',20)));
});
test('bad counts, forged shapes, unsupported uses and arbitrary commands are rejected',()=>{
 const p=filled();for(const count of [NaN,Infinity,1.5,0,-1,101])assert.throws(()=>inventoryAction(p,request('bag:gel','sell',count)));
 for(const r of [request('atelier:ingot','use',1),request('materials:biscuit','use',1),request('materials:herb','sell',1),request('atelier:ink','use',2),request('bag:gel','use',1)])assert.throws(()=>inventoryAction(p,r));
 for(const raw of [{...request('bag:gel','sell',1),action:{type:'trade'}},{itemId:'bag:gel',kind:'sell',count:'1'},null,[]])assert.throws(()=>parseInventoryActionRequest(raw));
 for(const type of ['inventory-confirm','inventory-cancel'] as const){assert.equal(parseCommand({type,generation:1,token:'12345678-1234-1234-1234-123456789012'}).type,type);for(const extra of [{generation:0},{token:'wrong'},{action:'trade'}])assert.throws(()=>parseCommand({type,generation:1,token:'12345678-1234-1234-1234-123456789012',...extra}));}
});
test('latest inventory, sequence, dynamic quote and dew target changes invalidate a token atomically',()=>{
 for(const [r,mutate]of [
  [request('bag:ration','sell',1),(p:Profile)=>p.bag.ration--],
  [request('materials:tea','sell',20),(p:Profile)=>p.sequence++],
  [request('materials:tea','sell',20),(p:Profile)=>p.leisure.journal.buildings.workshop++],
 ] as const){const p=filled(),session=new InventoryActionSession(),preview=session.prepare(p,1,r,0);mutate(p);const before=structuredClone(p);assert.throws(()=>session.confirm(p,1,preview.token,1,1),/变化/);assert.deepEqual(p,before);}
 const p=filled(),session=new InventoryActionSession(),preview=session.prepare(p,1,request('atelier:dew','use',1),0);p.leisure.plots[0]!.due=900;assert.throws(()=>session.confirm(p,1,preview.token,1,1),/变化/);
});
test('unrelated economic time and notices do not expire ordinary or still-growing dew previews',()=>{
 for(const r of [request('bag:gel','sell',2),request('atelier:dew','use',1)]){const p=filled(),session=new InventoryActionSession(),preview=session.prepare(p,1,r,0);p.tick=30;p.notice='无关经营反馈';const next=session.confirm(p,1,preview.token,1,1000);assert.equal(next.sequence,1);}
});
test('expiry, wrong generation, cancellation, replacement and rejection consume one-shot tokens',()=>{
 const p=filled();for(const mode of ['expiry','generation','cancel','replace']){const session=new InventoryActionSession(),preview=session.prepare(p,1,request('bag:gel','sell',1),0);if(mode==='cancel')session.cancel(preview.token);if(mode==='replace')session.prepare(p,1,request('bag:gel','sell',2),0);assert.throws(()=>session.confirm(p,mode==='generation'?2:1,preview.token,1,mode==='expiry'?60000:1),/过期/);assert.throws(()=>session.confirm(p,1,preview.token,1,2),/过期/);}
});
test('existing job, growing plot, wallet and output/refund capacity restrictions remain authoritative',()=>{
 const p=filled();p.job='visitor';assert.ok(inventoryAction(p,request('atelier:ink','use',1)).quote.reason);assert.ok(inventoryAction(p,request('bag:gel','sell',1)).quote.reason);p.job='keeper';p.leisure.plots=[null,null,null];assert.match(inventoryAction(p,request('atelier:dew','use',1)).quote.reason,/生长/);
 p.leisure.journal.dust=9998;assert.match(inventoryAction(p,request('atelier:ink','use',1)).quote.reason,/空间/);p.leisure.journal.dust=9996;p.atelier!.queues.alchemy=[{id:1,good:'frost',remaining:2,due:1000}];assert.match(inventoryAction(p,request('atelier:ink','use',1)).quote.reason,/预留/);
 p.coins=1e9;assert.match(inventoryAction(p,request('materials:tea','sell',1)).quote.reason,/金币/);p.leisure.materials.ore=9;assert.match(inventoryAction(p,request('materials:ore','sell',10)).quote.reason,/10/);
});
test('companions navigation keeps old tower targets and reaches existing friends tab without economic dispatch',()=>{
 assert.ok(inventoryTargets.includes('companions'));assert.equal(towerTargets.length,17);
 const clicked:string[]=[],elements:Record<string,any>={cCampHome:{hidden:false},cCampWorkspace:{hidden:true},'cTab-friends':{click(){clicked.push('friends');}}};const oldDocument=globalThis.document;
 (globalThis as any).document={getElementById:(id:string)=>elements[id],body:{dataset:{}}};try{towerNavigator('casual')({inventoryNavigation:{id:1,target:'companions'}} as any);assert.deepEqual(clicked,['friends']);assert.equal(elements.cCampHome.hidden,true);assert.equal(elements.cCampWorkspace.hidden,false);}finally{(globalThis as any).document=oldDocument;}
});
