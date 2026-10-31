import {partySupplyReserve,partyRationReserve} from './party-state';
import {isFieldMaterial,fieldMaterialCount,changeFieldMaterial,type FieldMaterial} from './field-progress';
import {villagePlanActive,villageRefundReserve,villageShelfReserve,villageOutputReserve} from './village';
import {foodRefundReserve,jobPower} from './camp-life';
import type {Profile} from './index';
import {pendingOutput} from './business';
export type Station='supply'|'alchemy';
export type Reagent=FieldMaterial|'flour'|'gel'|'ration'|'crystal'|'herb'|'berry'|'mushroom'|'ore'|'pumpkin'|'snowflower'|'biscuit'|'soup'|'tea'|'pie'|'snowtea'|'dust';
export type Good='picnic'|'stew'|'gift'|'dew'|'ink'|'ingot'|'nectar'|'incense'|'frost'|'herbal-bandage'|'mining-tonic';
interface Formula {name:string;station:Station;level:number;zone?:number;ticks:number;price:number;cost:Partial<Record<Reagent,number>>;use:string;gives?:Partial<Record<Reagent,number>>}
export const FORMULAS:Record<Good,Formula>={

 picnic:{name:'旅人野餐篮',station:'supply',level:0,ticks:300,price:32,cost:{flour:4,berry:2,gel:1},use:'打开获得3口粮、1莓果饼',gives:{ration:3,biscuit:1}},
 stew:{name:'菌香补给盒',station:'supply',level:1,ticks:400,price:38,cost:{flour:2,mushroom:2,herb:2},use:'打开获得2口粮、1菌菇汤',gives:{ration:2,soup:1}},
 gift:{name:'星糖礼盒',station:'supply',level:2,zone:3,ticks:600,price:60,cost:{flour:3,berry:3,pumpkin:1},use:'打开获得2莓果饼、1南瓜派',gives:{biscuit:2,pie:1}},
 dew:{name:'萤露药剂',station:'alchemy',level:0,ticks:200,price:18,cost:{herb:2,gel:1},use:'第一块生长中的花圃缩短30秒'},
 ink:{name:'星尘墨',station:'alchemy',level:0,ticks:300,price:24,cost:{berry:2,ore:2},use:'使用获得2星尘',gives:{dust:2}},
 ingot:{name:'精炼晶',station:'alchemy',level:0,ticks:450,price:36,cost:{ore:4,gel:1},use:'用于二、三级设施研修'},
 nectar:{name:'伙伴蜜酿',station:'alchemy',level:1,ticks:400,price:30,cost:{berry:3,herb:1},use:'使用获得2莓果饼',gives:{biscuit:2}},
 incense:{name:'古木香氛',station:'alchemy',level:2,ticks:500,price:42,cost:{mushroom:2,herb:2,gel:1},use:'使用获得1花草茶、1菌菇汤',gives:{tea:1,soup:1}},
 frost:{name:'霜花晶瓶',station:'alchemy',level:3,zone:4,ticks:600,price:80,cost:{snowflower:2,dust:1},use:'使用获得2雪绒暖茶',gives:{snowtea:2}},
 'herbal-bandage':{name:'药草绷带',station:'alchemy',level:0,ticks:60,price:5,cost:{toughHide:1,herb:2},use:'下趟底部野外选择携带，低血量时自动使用一次'},
 'mining-tonic':{name:'采矿药剂',station:'alchemy',level:0,ticks:80,price:6,cost:{curseCrystal:1,herb:2},use:'下趟底部野外选择携带，前几次采矿增加个人产量'},
};
export const GOOD_IDS=Object.keys(FORMULAS) as Good[];
export const REAGENT_NAMES:Record<Reagent,string>={bone:'硬骨片',curseCrystal:'咒晶碎片',toughHide:'韧皮',flour:'面粉',gel:'凝胶',ration:'旅行口粮',crystal:'魔晶餐',herb:'晨露草',berry:'甜莓',mushroom:'萤光菇',ore:'月纹石',pumpkin:'蜜糖南瓜',snowflower:'雪绒花',biscuit:'莓果饼',soup:'菌菇汤',tea:'花草茶',pie:'南瓜派',snowtea:'雪绒暖茶',dust:'星尘'};
export const MARKET={herb:3,berry:4,mushroom:6,ore:5,pumpkin:9,snowflower:12} as const;
export type MarketItem=keyof typeof MARKET;
export const STATIONS:Station[]=['supply','alchemy'];
export const QUOTES={quick:{name:'快卖',percent:80,ticks:600},normal:{name:'原价',percent:100,ticks:900},premium:{name:'精品',percent:140,ticks:1500}} as const;
export type Quote=keyof typeof QUOTES;
export type Facility='kitchen'|'still'|'counter';
export const FACILITIES={kitchen:'野炊炉',still:'蒸馏台',counter:'陈列台'} as const;
export const MASTERY=[10,50,150] as const;
export interface AtelierBatch {id:number;good:Good;remaining:number;due:number}
export interface Atelier {version:1;stock:Record<Good,number>;queues:Record<Station,AtelierBatch[]>;shelves:Record<Good,{stock:number;quote:Quote;due:number}>;open:Record<Station,boolean>;till:number;facilities:Record<Facility,number>;made:Record<Good,number>;claimed:Record<Good,number>;orders:Record<Station,Array<{revision:number;accepted:boolean}>>}
export type AtelierAction={type:'atelier-craft';good:Good;count:number}|{type:'atelier-cancel';station:Station;position:number;id:number}|{type:'atelier-buy';item:MarketItem;count:1|10}|{type:'atelier-use'|'atelier-mastery';good:Good}|{type:'atelier-stock'|'atelier-unstock';good:Good;count:number}|{type:'atelier-price';good:Good;quote:Quote}|{type:'atelier-open';station:Station;open:boolean}|{type:'atelier-collect'}|{type:'atelier-upgrade';facility:Facility}|{type:'atelier-accept'|'atelier-deliver'|'atelier-abandon';station:Station;slot:number;revision:number};
export const initialAtelier=():Atelier=>({version:1,stock:Object.fromEntries(GOOD_IDS.map(g=>[g,0])) as Record<Good,number>,queues:{supply:[],alchemy:[]},shelves:Object.fromEntries(GOOD_IDS.map(g=>[g,{stock:0,quote:'normal',due:0}])) as Atelier['shelves'],open:{supply:false,alchemy:false},till:0,facilities:{kitchen:0,still:0,counter:0},made:Object.fromEntries(GOOD_IDS.map(g=>[g,0])) as Record<Good,number>,claimed:Object.fromEntries(GOOD_IDS.map(g=>[g,0])) as Record<Good,number>,orders:{supply:[0,1,2].map(()=>({revision:0,accepted:false})),alchemy:[0,1,2].map(()=>({revision:0,accepted:false}))}});
export const atelierOf=(p:Profile)=>p.atelier??initialAtelier();
const ensure=(p:Profile)=>p.atelier??(p.atelier=initialAtelier());
export const stationFacility=(s:Station):Facility=>s==='supply'?'kitchen':'still';
export const atelierBatchLimit=(a:Atelier,s:Station)=>10+10*Math.max(0,a.facilities[stationFacility(s)]-1);
export const atelierTicks=(a:Atelier,g:Good,p?:Profile)=>Math.ceil(FORMULAS[g].ticks*(100-10*a.facilities[stationFacility(FORMULAS[g].station)])*(100-(p?jobPower(p,'workshop')*5:0))/10000);
export const atelierShelfLimit=(a:Atelier)=>30+15*a.facilities.counter;
export const atelierPrice=(g:Good,q:Quote)=>Math.floor(FORMULAS[g].price*QUOTES[q].percent/100);
export const reagentCount=(p:Profile,r:Reagent):number=>isFieldMaterial(r)?fieldMaterialCount(p,r):r==='dust'?p.leisure.journal.dust:['flour','gel','ration','crystal'].includes(r)?p.bag[r as keyof Profile['bag']]:p.leisure.materials[r as keyof Profile['leisure']['materials']];
export function changeReagent(p:Profile,r:Reagent,n:number){if(isFieldMaterial(r))changeFieldMaterial(p,r,n);else if(r==='dust')p.leisure.journal.dust+=n;else if(['flour','gel','ration','crystal'].includes(r))p.bag[r as keyof Profile['bag']]+=n;else p.leisure.materials[r as keyof Profile['leisure']['materials']]+=n;}
export function fieldSupplyReserved(p:Profile,g:string):number{const a=p.run?.field?.version===2?p.run.field.world?.actors[0]:null;return Number(a?.loadout.supply===g&&!a?.supplyUsed)+partySupplyReserve(p,g);}
export function refundReserve(p:Profile,r:Reagent):number{return villageRefundReserve(p,r)+foodRefundReserve(p,r)+(p.atelier?Object.values(p.atelier.queues).flat().reduce((n,q)=>n+(FORMULAS[q.good].cost[r]??0)*q.remaining,0):0);}
export function reagentSpace(p:Profile,r:Reagent):number {if(r==='gel')return 100-(p.run?.loot??0)-reagentCount(p,r);if(r==='ration'||r==='crystal')return 1e6-p.bag[r]-pendingOutput(p,r)-p.business.shelves[r].stock-(r==='ration'?(p.run?.remaining??0)+partyRationReserve(p):0);return (r==='flour'?1e6:9999)-reagentCount(p,r)-villageOutputReserve(p,r);}
export const queuedGood=(a:Atelier,g:Good)=>Object.values(a.queues).flat().reduce((n,q)=>n+(q.good===g?q.remaining:0),0);
export function formulaReason(p:Profile,g:Good):string {const f=FORMULAS[g];if(atelierOf(p).facilities[stationFacility(f.station)]<f.level)return `${FACILITIES[stationFacility(f.station)]}Lv${f.level}后解锁。`;if(f.zone!==undefined&&!p.leisure.clears[f.zone])return `先完成${f.zone===3?'风铃麦田':'霜灯雪境'}。`;return '';}
// Order goods do not depend on changing facilities. Region unlocks are monotonic but may change the pool;
// bind each revision to its fixed catalogue and keep late regional ingredients out of commissions.
export function stableAtelierOrder(p:Profile,s:Station,slot:number){const a=atelierOf(p),r=a.orders[s][slot].revision,list=GOOD_IDS.filter(g=>g!=='herbal-bandage'&&g!=='mining-tonic'&&FORMULAS[g].station===s&&FORMULAS[g].level<=Math.min(r,2)&&FORMULAS[g].zone===undefined),n=((p.business.seed^Math.imul(r+1,2654435761)^Math.imul(slot+1,2246822519))>>>0),good=list[n%list.length],count=2+n%4;return{good,count,coins:Math.ceil(FORMULAS[good].price*count*1.25),revision:r,accepted:a.orders[s][slot].accepted};}
export const facilityCost=(a:Atelier,f:Facility)=>{const n=a.facilities[f];return{coins:[60,180,420][n]??0,ore:[8,20,50][n]??0,ingot:[0,2,6][n]??0};};
export function atelierReason(p:Profile,x:AtelierAction):string {
 if(p.job!=='keeper')return '先在补给商店完成任职试餐。';const a=atelierOf(p);
 if(x.type==='atelier-craft'){if(villagePlanActive(p,FORMULAS[x.good].station))return '本站已有有限经营安排，先停止安排。';const f=FORMULAS[x.good],reason=formulaReason(p,x.good);if(reason)return reason;if(a.queues[f.station].length>=3)return '本站3批排产已满。';if(x.count>atelierBatchLimit(a,f.station))return `本站每批最多${atelierBatchLimit(a,f.station)}份。`;if(a.stock[x.good]+a.shelves[x.good].stock+queuedGood(a,x.good)+fieldSupplyReserved(p,x.good)+x.count>9999)return '成品与在制库存已满。';if(Object.entries(f.cost).some(([r,n])=>reagentCount(p,r as Reagent)<n!*x.count))return '配方材料不足。';}
 else if(x.type==='atelier-cancel'){const q=a.queues[x.station][x.position];if(!q||q.id!==x.id)return '这批已经完成或队列已变化。';if(Object.entries(FORMULAS[q.good].cost).some(([r,n])=>reagentSpace(p,r as Reagent)<n!*q.remaining))return '退款材料空间不足，先整理背包；排产保留。';}
 else if(x.type==='atelier-buy'){if(x.item==='pumpkin'&&!p.leisure.clears[3]||x.item==='snowflower'&&!p.leisure.clears[4])return '先完成对应地区后开放采购。';if(p.coins<MARKET[x.item]*x.count)return '金币不足。';if(reagentSpace(p,x.item)<x.count+refundReserve(p,x.item))return '材料空间不足（含待产退款预留）。';}
 else if(x.type==='atelier-use'){const f=FORMULAS[x.good];if(!a.stock[x.good])return '背包中没有这件成品。';if(x.good==='herbal-bandage'||x.good==='mining-tonic')return '下趟底部野外选择携带，不在背包立即使用。';if(x.good==='ingot')return '精炼晶用于设施研修。';if(x.good==='dew'&&!p.leisure.plots.some(v=>v&&v.due>p.tick))return '需要一块正在生长的花圃。';if(f.gives&&Object.entries(f.gives).some(([r,n])=>reagentSpace(p,r as Reagent)<n!+refundReserve(p,r as Reagent)))return '补给空间不足（含待产退款预留）。';}
 else if(x.type==='atelier-stock'){if(a.stock[x.good]<x.count)return '背包成品不足。';if(Object.values(a.shelves).reduce((n,v)=>n+v.stock,0)+x.count+villageShelfReserve(p)>atelierShelfLimit(a))return '特色货台已满。';}
 else if(x.type==='atelier-unstock'){if(a.shelves[x.good].stock<x.count)return '货台数量不足。';}
 else if(x.type==='atelier-price'){if(a.shelves[x.good].quote===x.quote)return '已选择这个售价。';}
 else if(x.type==='atelier-open'){if(a.open[x.station]===x.open)return x.open?'已经开业。':'已经歇业。';}
 else if(x.type==='atelier-collect'){if(!a.till)return '特色钱箱暂无货款。';if(p.coins+a.till>1e9)return '金币已满，货款保留。';}
 else if(x.type==='atelier-upgrade'){if(a.facilities[x.facility]===3)return '设施已满级。';const c=facilityCost(a,x.facility);if(p.coins<c.coins||p.leisure.materials.ore<c.ore||a.stock.ingot<c.ingot)return '研修需要列出的金币、月纹石与精炼晶。';}
 else if(x.type==='atelier-mastery'){const n=a.claimed[x.good];if(n===3)return '三份配方手记已珍藏。';if(a.made[x.good]<MASTERY[n])return `累计制作${MASTERY[n]}份后可领取。`;if(p.coins+[15,45,120][n]>1e9||reagentSpace(p,'dust')<[1,2,4][n]+refundReserve(p,'dust'))return '金币或星尘空间不足，赠礼保留。';}
 else if('slot'in x){const o=stableAtelierOrder(p,x.station,x.slot);if(o.revision!==x.revision)return '委托已变化，请重试。';if(x.type==='atelier-accept'&&o.accepted)return '已经接取委托。';if(x.type!=='atelier-accept'&&!o.accepted)return '先接取这份委托。';if(x.type==='atelier-deliver'){if(a.stock[o.good]<o.count)return '背包成品不足，货台商品请先下架。';if(p.coins+o.coins>1e9||reagentSpace(p,'dust')<1+refundReserve(p,'dust'))return '奖励空间不足，委托保留。';if(o.revision===1e9)return '委托记录已满。';}}
 return '';
}
const earn=(p:Profile,n:number)=>{p.coins+=n;p.totals.earned=Math.min(1e12,p.totals.earned+n);};
export function applyAtelier(p:Profile,x:AtelierAction){const why=atelierReason(p,x);if(why)throw Error(why);const a=ensure(p);
 if(x.type==='atelier-craft'){const f=FORMULAS[x.good];for(const[r,n]of Object.entries(f.cost))changeReagent(p,r as Reagent,-n!*x.count);const q=a.queues[f.station];q.push({id:p.sequence+1,good:x.good,remaining:x.count,due:q.length?0:p.tick+atelierTicks(a,x.good,p)});p.notice=`已安排${x.count}份${f.name}，完成后进入背包。`;}
 else if(x.type==='atelier-cancel'){const q=a.queues[x.station].splice(x.position,1)[0];for(const[r,n]of Object.entries(FORMULAS[q.good].cost))changeReagent(p,r as Reagent,n!*q.remaining);if(x.position===0&&a.queues[x.station][0])a.queues[x.station][0].due=p.tick+atelierTicks(a,a.queues[x.station][0].good,p);p.notice='已取消剩余份数，材料退回背包。';}
 else if(x.type==='atelier-buy'){p.coins-=MARKET[x.item]*x.count;changeReagent(p,x.item,x.count);p.notice=`购入${x.count}份${REAGENT_NAMES[x.item]}。`;}
 else if(x.type==='atelier-use'){a.stock[x.good]--;if(x.good==='dew'){const plot=p.leisure.plots.find(v=>v&&v.due>p.tick)!;plot.due=Math.max(p.tick,plot.due-300);}else for(const[r,n]of Object.entries(FORMULAS[x.good].gives!))changeReagent(p,r as Reagent,n!);p.notice=FORMULAS[x.good].use+'。';}
 else if(x.type==='atelier-stock'){a.stock[x.good]-=x.count;const shelf=a.shelves[x.good];shelf.stock+=x.count;if(shelf.stock===x.count)shelf.due=p.tick+QUOTES[shelf.quote].ticks;p.notice='商品已摆上特色货台，本站开业后自动成交。';}
 else if(x.type==='atelier-unstock'){a.shelves[x.good].stock-=x.count;a.stock[x.good]+=x.count;p.notice='商品已退回背包。';}
 else if(x.type==='atelier-price'){const s=a.shelves[x.good];s.quote=x.quote;s.due=p.tick+QUOTES[x.quote].ticks;p.notice='售价已调整，下一次成交重新计时。';}
 else if(x.type==='atelier-open'){a.open[x.station]=x.open;for(const g of GOOD_IDS.filter(g=>FORMULAS[g].station===x.station))a.shelves[g].due=p.tick+QUOTES[a.shelves[g].quote].ticks;p.notice=x.open?'本站特色货台已开业。':'本站特色货台已歇业。';}
 else if(x.type==='atelier-collect'){earn(p,a.till);a.till=0;p.notice='特色货款已收入钱包。';}
 else if(x.type==='atelier-upgrade'){const c=facilityCost(a,x.facility);p.coins-=c.coins;p.leisure.materials.ore-=c.ore;a.stock.ingot-=c.ingot;a.facilities[x.facility]++;p.notice=FACILITIES[x.facility]+'研修完成，下份制作生效。';}
 else if(x.type==='atelier-mastery'){const n=a.claimed[x.good]++;earn(p,[15,45,120][n]);changeReagent(p,'dust',[1,2,4][n]);p.notice='配方手记赠礼已收入背包。';}
 else if('slot'in x){const o=a.orders[x.station][x.slot];if(x.type==='atelier-accept')o.accepted=true;else if(x.type==='atelier-abandon')o.accepted=false;else{const need=stableAtelierOrder(p,x.station,x.slot);a.stock[need.good]-=need.count;earn(p,need.coins);changeReagent(p,'dust',1);o.revision++;o.accepted=false;}p.notice=x.type==='atelier-deliver'?'委托完成，新顾客送来了下一份订单。':x.type==='atelier-accept'?'已接取委托，不限时。':'已取消委托，未扣商品。';}
}
export function stepAtelier(p:Profile){const a=p.atelier;if(!a)return;for(const s of STATIONS){const q=a.queues[s][0];if(q&&p.tick>=q.due){a.stock[q.good]++;a.made[q.good]=Math.min(1e9,a.made[q.good]+1);q.remaining--;if(q.remaining)q.due=p.tick+atelierTicks(a,q.good,p);else{a.queues[s].shift();const next=a.queues[s][0];if(next)next.due=p.tick+atelierTicks(a,next.good,p);}}if(!a.open[s])continue;for(const g of GOOD_IDS.filter(g=>FORMULAS[g].station===s)){const f=a.shelves[g],price=atelierPrice(g,f.quote)+jobPower(p,'counter');if(f.stock&&p.tick>=f.due&&a.till+price<=1e9){f.stock--;a.till+=price;f.due=p.tick+QUOTES[f.quote].ticks;p.totals.sold=Math.min(1e12,p.totals.sold+1);}}}}
export const atelierWork=(p:Profile)=>!!p.atelier&&(STATIONS.some(s=>p.atelier!.queues[s].length>0)||GOOD_IDS.some(g=>p.atelier!.open[FORMULAS[g].station]&&p.atelier!.shelves[g].stock>0&&p.atelier!.till+atelierPrice(g,p.atelier!.shelves[g].quote)+jobPower(p,'counter')<=1e9));
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
function shape(v:unknown,keys:string):asserts v is Record<string,unknown>{if(!obj(v)||Object.keys(v).sort().join(' ')!==keys.split(' ').sort().join(' '))throw Error('工坊字段不匹配');}
function num(v:unknown,max:number,min=0):asserts v is number{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<min||v>max)throw Error('工坊数值无效');}
const good=(v:unknown):v is Good=>typeof v==='string'&&Object.hasOwn(FORMULAS,v);
const station=(v:unknown):v is Station=>v==='supply'||v==='alchemy';
export function parseAtelierAction(v:Record<string,unknown>):AtelierAction|null{if(typeof v.type!=='string'||!v.type.startsWith('atelier-'))return null;
 if(v.type==='atelier-craft'||v.type==='atelier-stock'||v.type==='atelier-unstock'){shape(v,'type good count');if(!good(v.good))throw Error('商品无效');num(v.count,v.type==='atelier-craft'?30:9999,1);}
 else if(v.type==='atelier-use'||v.type==='atelier-mastery'){shape(v,'type good');if(!good(v.good))throw Error('商品无效');}
 else if(v.type==='atelier-cancel'){shape(v,'type station position id');num(v.id,1e12,1);if(!station(v.station))throw Error('工作站无效');num(v.position,2);}
 else if(v.type==='atelier-buy'){shape(v,'type item count');if(typeof v.item!=='string'||!Object.hasOwn(MARKET,v.item)||v.count!==1&&v.count!==10)throw Error('采购内容无效');}
 else if(v.type==='atelier-price'){shape(v,'type good quote');if(!good(v.good)||typeof v.quote!=='string'||!Object.hasOwn(QUOTES,v.quote))throw Error('售价无效');}
 else if(v.type==='atelier-open'){shape(v,'type station open');if(!station(v.station)||typeof v.open!=='boolean')throw Error('开业状态无效');}
 else if(v.type==='atelier-collect')shape(v,'type');
 else if(v.type==='atelier-upgrade'){shape(v,'type facility');if(typeof v.facility!=='string'||!Object.hasOwn(FACILITIES,v.facility))throw Error('设施无效');}
 else if(['atelier-accept','atelier-deliver','atelier-abandon'].includes(v.type)){shape(v,'type station slot revision');if(!station(v.station))throw Error('工作站无效');num(v.slot,2);num(v.revision,1e9);}
 else throw Error('未知工坊操作');return v as unknown as AtelierAction;
}
export function validateAtelier(v:unknown,p:Profile):asserts v is Atelier{shape(v,'version stock queues shelves open till facilities made claimed orders');if(p.job!=='keeper')throw Error('工坊档案需要正式任职');if(v.version!==1)throw Error('工坊版本无效');for(const k of ['stock','shelves','made','claimed'])shape(v[k],GOOD_IDS.join(' '));shape(v.facilities,'kitchen still counter');for(const n of Object.values(v.facilities))num(n,3);const a=v as unknown as Atelier;num(a.till,1e9);shape(v.queues,'supply alchemy');shape(v.open,'supply alchemy');shape(v.orders,'supply alchemy');const ids=new Set<number>();for(const s of STATIONS){if(typeof a.open[s]!=='boolean')throw Error('营业状态无效');const qs=a.queues[s];if(!Array.isArray(qs)||qs.length>3)throw Error('工坊排产无效');for(let i=0;i<qs.length;i++){const q=qs[i];shape(q,'id good remaining due');num(q.id,p.sequence,1);if(ids.has(q.id))throw Error('批次身份重复');ids.add(q.id);if(!good(q.good)||FORMULAS[q.good].station!==s)throw Error('排产工作站不匹配');if(FORMULAS[q.good].level>a.facilities[stationFacility(s)]||FORMULAS[q.good].zone!==undefined&&!p.leisure.clears[FORMULAS[q.good].zone!])throw Error('未解锁配方不能排产');num(q.remaining,atelierBatchLimit(a,s),1);num(q.due,1e15);if(i===0?q.due<=p.tick:q.due!==0)throw Error('工坊排产时钟无效');}if(!Array.isArray(a.orders[s])||a.orders[s].length!==3)throw Error('委托数量无效');for(const o of a.orders[s]){shape(o,'revision accepted');num(o.revision,1e9);if(typeof o.accepted!=='boolean')throw Error('委托状态无效');}}
 for(const g of GOOD_IDS){num(a.stock[g],9999);num(a.made[g],1e9);num(a.claimed[g],3);if(a.claimed[g]&&a.made[g]<MASTERY[a.claimed[g]-1])throw Error('配方手记进度无效');const f=a.shelves[g];shape(f,'stock quote due');num(f.stock,9999);num(f.due,1e15);if(typeof f.quote!=='string'||!Object.hasOwn(QUOTES,f.quote))throw Error('货台售价无效');if(a.stock[g]+f.stock+queuedGood(a,g)+fieldSupplyReserved(p,g)>9999)throw Error('工坊成品预留超限');}if(Object.values(a.shelves).reduce((n,s)=>n+s.stock,0)>atelierShelfLimit(a))throw Error('特色货台容量无效');}
export function atelierActionStation(x:AtelierAction):Station|null {if('good'in x)return FORMULAS[x.good].station;if('station'in x)return x.station;if(x.type==='atelier-upgrade')return x.facility==='kitchen'?'supply':x.facility==='still'?'alchemy':null;return null;}
