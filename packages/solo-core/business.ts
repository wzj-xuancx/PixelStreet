import {partyRationReserve} from './party-state';
import {recordChapterSale,recordChapterCollect} from './chapter';
import type {GameplayObserver} from './gameplay-feedback';
import {recordMasterySale,recordMasteryOrder} from './mastery';
import {jobPower} from './camp-life';
import type {Profile} from './index';
import {recipes,ITEMS,type Recipe,type ItemId} from './catalog';

export type PriceTier='quick'|'normal'|'premium';
export type ShopUpgrade='oven'|'shelves'|'workbench';
export interface CraftBatch {recipe:Recipe;remaining:number}
export interface ShopOrder {revision:number;recipe:Recipe;count:number;accepted:boolean}
export interface Business {
  seed:number; pending:CraftBatch[]; managed:boolean;
  shelves:Record<Recipe,{stock:number;tier:PriceTier;due:number}>;
  till:number; reputation:number; completed:number;
  upgrades:Record<ShopUpgrade,number>; orders:ShopOrder[];
}
export type BusinessAction =
  | {type:'queue-craft';recipe:Recipe;count:number}
  | {type:'cancel-craft';position:number}
  | {type:'trade';item:ItemId;side:'buy'|'sell';count:number}
  | {type:'stock-shelf'|'unstock-shelf';recipe:Recipe;count:number}
  | {type:'price-shelf';recipe:Recipe;tier:PriceTier}
  | {type:'collect-till'}
  | {type:'shop-upgrade';upgrade:ShopUpgrade}
  | {type:'order-accept'|'order-deliver'|'order-cancel';slot:number;revision:number};
export const PRICE_TIERS:Record<PriceTier,{name:string;percent:number;ticks:number}>={
  quick:{name:'快卖',percent:80,ticks:180},normal:{name:'原价',percent:100,ticks:300},premium:{name:'高价',percent:140,ticks:600},
};
const MAX=1e9;
const hash=(seed:number,text:string):number=>{let n=seed>>>0;for(const c of text)n=Math.imul(n^c.charCodeAt(0),16777619)>>>0;return n;};
export function makeOrder(seed:number,slot:number,revision:number):ShopOrder {
  const n=hash(seed,`${slot}:${revision}`),recipe:Recipe=slot===0?'ration':slot===1?'crystal':n%2?'ration':'crystal';
  return{revision,recipe,count:(recipe==='ration'?3:2)+n%4,accepted:false};
}
export function initialBusiness(seed:number):Business {
  return{seed,pending:[],managed:false,shelves:{ration:{stock:0,tier:'normal',due:0},crystal:{stock:0,tier:'normal',due:0}},till:0,reputation:0,completed:0,upgrades:{oven:0,shelves:0,workbench:0},orders:[0,1,2].map(i=>makeOrder(seed,i,0))};
}
export const queueLimit=(b:Business)=>[3,4,6,8][b.upgrades.workbench];
export const batchLimit=(b:Business)=>[30,50,70,99][b.upgrades.workbench];
export const shelfLimit=(b:Business)=>20+b.upgrades.shelves*20;
export const craftTicks=(recipe:Recipe,b:Business)=>Math.ceil(recipes[recipe].ticks*(100-10*b.upgrades.oven)/100);
export const salePrice=(recipe:Recipe,tier:PriceTier)=>Math.max(1,Math.floor(recipes[recipe].price*PRICE_TIERS[tier].percent/100));
export const orderReward=(o:ShopOrder)=>Math.ceil(recipes[o.recipe].price*o.count*1.25);
export const tradeQuote=(item:ItemId,side:'buy'|'sell',count:number)=>Math.floor(ITEMS[item][side]*count+1e-8);
export function upgradeInfo(b:Business,upgrade:ShopUpgrade):{name:string;level:number;cost:number;reputation:number;effect:string;next:string} {
  const level=b.upgrades[upgrade],names={oven:'炉火',shelves:'货架',workbench:'工作台'},costs={oven:[60,160,360],shelves:[80,200,450],workbench:[50,140,300]},effects=(n:number)=>upgrade==='oven'?`制作耗时 −${n*10}%`:upgrade==='shelves'?`货架容量 ${20+n*20}`:`${[3,4,6,8][n]}批 · 每批${[30,50,70,99][n]}份`;
  return{name:names[upgrade],level,cost:costs[upgrade][level]??0,reputation:[0,3,8][level]??0,effect:effects(level),next:level<3?effects(level+1):'已满级'};
}
export function pendingOutput(p:Profile,recipe:Recipe):number {
  return(p.queue?.recipe===recipe?p.queue.remaining:0)+p.business.pending.reduce((sum,q)=>sum+(q.recipe===recipe?q.remaining:0),0);
}
function capacity(p:Profile,item:ItemId):number {
  return item==='gel'?100-(p.run?.loot??0):1e6-(item==='ration'?(p.run?.remaining??0)+partyRationReserve(p):0)-(item==='ration'||item==='crystal'?pendingOutput(p,item)+p.business.shelves[item].stock:0);
}
export function businessReason(p:Profile,a:BusinessAction):string {
  if(p.job!=='keeper')return '正式任职后才能经营。';
  const b=p.business;
  if(a.type==='queue-craft'){
    const r=recipes[a.recipe];
    if((p.queue?1:0)+b.pending.length>=queueLimit(b))return '排产已满，请等待或取消一批。';
    if(a.count>batchLimit(b))return `每批最多${batchLimit(b)}份。`;
    if(p.bag.flour<r.flour*a.count||p.bag.gel<r.gel*a.count)return '制作材料不足。';
    if(p.bag[a.recipe]+a.count>capacity(p,a.recipe))return '成品与待产数量已达库存上限。';
  }else if(a.type==='cancel-craft'){
    const q=a.position===0?p.queue:b.pending[a.position-1];if(!q)return '这批制作已完成或不存在。';
    const r=recipes[q.recipe];if(r.flour>0&&p.bag.flour+r.flour*q.remaining>capacity(p,'flour')||r.gel>0&&p.bag.gel+r.gel*q.remaining>capacity(p,'gel'))return '材料空间不足，腾出空间后再取消。';
  }else if(a.type==='trade'){
    const price=tradeQuote(a.item,a.side,a.count);
    if(!price||a.side==='buy'&&!ITEMS[a.item].buy)return '商人不出售这件商品。';
    if(a.side==='buy'){if(p.coins<price)return '金币不足。';if(p.bag[a.item]+a.count>capacity(p,a.item))return '背包空间不足。';}
    else{if(p.bag[a.item]<a.count)return '背包库存不足。';if(p.coins+price>MAX)return '金币已满。';}
  }else if(a.type==='stock-shelf'){
    if(p.bag[a.recipe]<a.count)return '背包成品不足。';
    if(b.shelves.ration.stock+b.shelves.crystal.stock+a.count>shelfLimit(b))return '货架空间不足。';
  }else if(a.type==='unstock-shelf'){
    if(b.shelves[a.recipe].stock<a.count)return '货架数量不足。';
    // Returning shelf stock does not change the total reserved inventory.
    if(p.bag[a.recipe]+a.count>capacity(p,a.recipe)+b.shelves[a.recipe].stock)return '背包空间不足。';
  }else if(a.type==='collect-till'){
    if(!b.till)return '钱箱暂无货款。';if(p.coins+b.till>MAX)return '钱包空间不足，请先花费金币。';
  }else if(a.type==='shop-upgrade'){
    const u=upgradeInfo(b,a.upgrade);if(u.level===3)return '已满级。';if(b.reputation<u.reputation)return `需要${u.reputation}点订单声望。`;if(p.coins<u.cost)return `需要${u.cost}金币。`;
  }else if(a.type.startsWith('order-')){
    const orderAction=a as Extract<BusinessAction,{slot:number}>,o=b.orders[orderAction.slot];if(!o||o.revision!==orderAction.revision)return '订单已变化，请重试。';
    if(a.type==='order-accept'&&o.accepted)return '已经接取此订单。';
    if(a.type!=='order-accept'&&!o.accepted)return '请先接单。';
    if(a.type==='order-deliver'){if(p.bag[o.recipe]<o.count)return '背包成品不足；货架商品请先下架。';if(p.coins+orderReward(o)>MAX)return '金币已满。';if(o.revision>=1e9||b.completed>=1e9)return '订单记录已满。';}
  }
  return '';
}
export function applyBusiness(p:Profile,a:BusinessAction):void {
  const reason=businessReason(p,a);if(reason)throw Error(reason);const b=p.business;
  if(a.type==='queue-craft'){
    const r=recipes[a.recipe];p.bag.flour-=r.flour*a.count;p.bag.gel-=r.gel*a.count;
    if(!p.queue)p.queue={recipe:a.recipe,remaining:a.count,due:p.tick+craftTicks(a.recipe,b)};else b.pending.push({recipe:a.recipe,remaining:a.count});p.notice=`已排产${a.count}份${r.name}。`;
  }else if(a.type==='cancel-craft'){
    const q=a.position===0?p.queue!:b.pending.splice(a.position-1,1)[0],r=recipes[q.recipe];p.bag.flour+=r.flour*q.remaining;p.bag.gel+=r.gel*q.remaining;
    if(a.position===0){const next=b.pending.shift();p.queue=next?{...next,due:p.tick+craftTicks(next.recipe,b)}:null;}p.notice=`取消剩余${q.remaining}份，未消耗材料已退还。`;
  }else if(a.type==='trade'){
    const price=tradeQuote(a.item,a.side,a.count);p.bag[a.item]+=a.side==='buy'?a.count:-a.count;p.coins+=a.side==='buy'?-price:price;
    if(a.side==='sell')p.totals.earned=Math.min(1e12,p.totals.earned+price);p.notice=`${a.side==='buy'?'采购':'出售'}${a.count}份${ITEMS[a.item].name} · ${price}金币。`;
  }else if(a.type==='stock-shelf'){
    const shelf=b.shelves[a.recipe];p.bag[a.recipe]-=a.count;shelf.stock+=a.count;if(!b.managed||shelf.stock===a.count)shelf.due=p.tick+PRICE_TIERS[shelf.tier].ticks;b.managed=true;p.notice=`${recipes[a.recipe].name}上架${a.count}份${p.retail?'。':'，开店后自动成交。'}`;
  }else if(a.type==='unstock-shelf'){b.shelves[a.recipe].stock-=a.count;p.bag[a.recipe]+=a.count;p.notice='商品已退回背包。';
  }else if(a.type==='price-shelf'){const s=b.shelves[a.recipe];if(s.tier!==a.tier){s.tier=a.tier;s.due=p.tick+PRICE_TIERS[a.tier].ticks;}p.notice=`${recipes[a.recipe].name} · ${PRICE_TIERS[a.tier].name} · 每份${salePrice(a.recipe,a.tier)}金币。`;
  }else if(a.type==='collect-till'){const coins=b.till;recordChapterCollect(p);p.coins+=coins;b.till=0;p.totals.earned=Math.min(1e12,p.totals.earned+coins);p.notice=`收取货款${coins}金币。`;
  }else if(a.type==='shop-upgrade'){const u=upgradeInfo(b,a.upgrade);p.coins-=u.cost;b.upgrades[a.upgrade]++;p.notice=`${u.name}已升级 · ${upgradeInfo(b,a.upgrade).effect}。`;
  }else{const x=a as Extract<BusinessAction,{slot:number}>,o=b.orders[x.slot];if(a.type==='order-accept'){o.accepted=true;p.notice='已接单，不限时；准备好后交货。';}else if(a.type==='order-cancel'){o.accepted=false;p.notice='订单已取消，未扣物品。';}else if(a.type==='order-deliver'){const coins=orderReward(o);p.bag[o.recipe]-=o.count;p.coins+=coins;p.totals.earned=Math.min(1e12,p.totals.earned+coins);recordMasteryOrder(p,o.recipe);b.completed++;b.reputation++;b.orders[x.slot]=makeOrder(b.seed,x.slot,o.revision+1);p.notice=`订单完成 · ${coins}金币 · 声望+1。`;}}
}
export function stepBusiness(p:Profile,observe?:GameplayObserver):void {
  const b=p.business;if(!p.retail||!b.managed||p.job!=='keeper')return;
  const bothStocked=b.shelves.ration.stock>0&&b.shelves.crystal.stock>0;
  for(const recipe of ['ration','crystal'] as const){const shelf=b.shelves[recipe];if(!shelf.stock||p.tick<shelf.due)continue;const price=salePrice(recipe,shelf.tier)+jobPower(p,'counter');if(b.till+price>MAX)continue;recordMasterySale(p,recipe,shelf.tier,bothStocked);recordChapterSale(p,recipe);observe?.({tick:p.tick,runId:null,wave:0,kind:'sale',amount:price,recipe});shelf.stock--;b.till+=price;shelf.due=p.tick+PRICE_TIERS[shelf.tier].ticks;p.totals.sold++;}
}
export function hasBusinessWork(p:Profile):boolean{return p.retail&&p.business.managed&&(['ration','crystal'] as const).some(r=>p.business.shelves[r].stock>0&&p.business.till+salePrice(r,p.business.shelves[r].tier)+jobPower(p,'counter')<=MAX);}

const plain=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const shape=(x:unknown,keys:string):x is Record<string,unknown>=>plain(x)&&Object.keys(x).sort().join(' ' )===keys.split(' ').sort().join(' ');
const int=(x:unknown,max=MAX,min=0):x is number=>Number.isSafeInteger(x)&&Number(x)>=min&&Number(x)<=max;
export function parseBusinessAction(x:unknown):BusinessAction|null {
  if(!plain(x))return null;
  const recipe=(v:unknown)=>v==='ration'||v==='crystal';
  let valid=false;
  switch(x.type){
    case 'queue-craft':case 'stock-shelf':case 'unstock-shelf':valid=shape(x,'type recipe count')&&recipe(x.recipe)&&int(x.count,99,1);break;
    case 'cancel-craft':valid=shape(x,'type position')&&int(x.position,7);break;
    case 'trade':valid=shape(x,'type item side count')&&['flour','gel','ration','crystal'].includes(String(x.item))&&typeof x.item==='string'&&(x.side==='buy'||x.side==='sell')&&int(x.count,100,1);break;
    case 'price-shelf':valid=shape(x,'type recipe tier')&&recipe(x.recipe)&&['quick','normal','premium'].includes(String(x.tier))&&typeof x.tier==='string';break;
    case 'collect-till':valid=shape(x,'type');break;
    case 'shop-upgrade':valid=shape(x,'type upgrade')&&(x.upgrade==='oven'||x.upgrade==='shelves'||x.upgrade==='workbench');break;
    case 'order-accept':case 'order-deliver':case 'order-cancel':valid=shape(x,'type slot revision')&&int(x.slot,2)&&int(x.revision);break;
    default:return null;
  }
  if(!valid)throw Error('经营操作字段无效');return x as BusinessAction;
}
export function validateBusiness(x:unknown,externalCompleted=0):asserts x is Business {
  if(!shape(x,'seed pending managed shelves till reputation completed upgrades orders')||!int(x.seed,0xffffffff,1)||typeof x.managed!=='boolean'||!int(x.till)||!int(x.completed)||x.reputation!==x.completed||!shape(x.upgrades,'oven shelves workbench')||Object.values(x.upgrades).some(n=>!int(n,3)))throw Error('经营档案无效');
  const b=x as unknown as Business;
  if(!Array.isArray(x.pending)||x.pending.length>=queueLimit(b)||Array.from(x.pending).some(q=>!shape(q,'recipe remaining')||!['ration','crystal'].includes(String(q.recipe))||typeof q.recipe!=='string'||!int(q.remaining,batchLimit(b),1)))throw Error('排产档案无效');
  if(!shape(x.shelves,'ration crystal'))throw Error('货架档案无效');
  for(const s of Object.values(x.shelves))if(!shape(s,'stock tier due')||!int(s.stock,shelfLimit(b))||!['quick','normal','premium'].includes(String(s.tier))||typeof s.tier!=='string'||!int(s.due,1e15))throw Error('货架商品无效');
  if(b.shelves.ration.stock+b.shelves.crystal.stock>shelfLimit(b)||!b.managed&&(b.till||b.shelves.ration.stock||b.shelves.crystal.stock))throw Error('货架数量或模式无效');
  if(!Array.isArray(x.orders)||x.orders.length!==3||Array.from(x.orders).some((o,i)=>{if(!shape(o,'revision recipe count accepted')||!int(o.revision)||typeof o.accepted!=='boolean')return true;const expected=makeOrder(b.seed,i,o.revision);return o.recipe!==expected.recipe||o.count!==expected.count;}))throw Error('订单档案无效');
  if(!int(externalCompleted)||b.orders.reduce((sum,o)=>sum+o.revision,0)+externalCompleted!==b.completed)throw Error('订单序号无效');
}
