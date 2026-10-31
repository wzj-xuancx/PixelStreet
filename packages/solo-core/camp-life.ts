import {villagePlanActive,villageShelfReserve} from './village';
import type {GameAction, Profile} from './index';
import {FOODS, leisureReason, type Food} from './leisure';
import {COMPANIONS, type Companion} from './leisure';
import {bondsOf, buddyXP, ensureBonds} from './bonds';
import {FORMULAS, GOOD_IDS, changeReagent, atelierOf, atelierBatchLimit, atelierShelfLimit, atelierReason, reagentCount, reagentSpace, type Good, type Station, type Reagent} from './atelier';
import {recipes, type Recipe} from './catalog';
import {businessReason, batchLimit} from './business';

export const CAMP_LEVELS = [
  {xp:0,name:'篝火初亮',unlock:'料理排产与经营总览',coins:20,ore:2},
  {xp:100,name:'旅人小站',unlock:'柜台岗位与第一套队伍搭配',coins:50,ore:5},
  {xp:350,name:'林间集市',unlock:'工坊岗位与有限上架计划',coins:100,ore:10},
  {xp:900,name:'工坊聚落',unlock:'花圃岗位与三套队伍搭配',coins:180,ore:15},
  {xp:2000,name:'秘境驿站',unlock:'已完成纪念的伙伴发挥岗位专长',coins:300,ore:20},
  {xp:4500,name:'星辉营地',unlock:'星辉纪念陈列',coins:450,ore:30},
  {xp:9000,name:'群岛之家',unlock:'群岛之家纪念陈列',coins:700,ore:50},
] as const;
export const COOK_TICKS:Record<Food,number> = {tea:200,biscuit:350,soup:450,pie:600,snowtea:750};
export const JOBS = {counter:{name:'柜台',level:2},workshop:{name:'工坊',level:3},garden:{name:'花圃',level:4}} as const;
export type CampJob=keyof typeof JOBS;
export type ProductionStation='basic'|'supply'|'alchemy'|'kitchen';
export interface CookBatch {id:number;food:Food;remaining:number;due:number}
export interface CrewPreset {leader:Companion;support:Companion|null;relics:number[]}
export interface StockPlan {good:Good;remaining:number;reserve:number}
export interface CampLife {
  version:1; cooking:CookBatch[]; claimed:number; jobs:Record<CampJob,Companion|null>;
  quests:Companion[]; last:Partial<Record<ProductionStation,{id:string;count:number}>>;
  presets:Array<CrewPreset|null>; lastJourney:{zone:number;route:'balanced'|'gather'|'treasure';trips:1|3|6;depth:number;secret:boolean}|null;
  stockPlans:Record<Station,StockPlan|null>;
}
export type CampAction =
 |{type:'camp-cancel-food';id:number;position:number}
 |{type:'camp-level-claim'|'camp-collect'|'camp-redepart'}
 |{type:'camp-job';job:CampJob;companion:Companion|null}
 |{type:'camp-buddy-quest';companion:Companion}
 |{type:'camp-prepare';station:ProductionStation;mode:'repeat'|'available'}
 |{type:'camp-preset';slot:number;operation:'save'|'load'}
 |{type:'camp-stock-plan';station:Station;good:Good;count:5|10|30;reserve:0|5|10}
 |{type:'camp-stock-stop';station:Station};
export const initialCamp=():CampLife=>({version:1,cooking:[],claimed:0,jobs:{counter:null,workshop:null,garden:null},quests:[],last:{},presets:[null,null,null],lastJourney:null,stockPlans:{supply:null,alchemy:null}});
export const campOf=(p:Profile):CampLife=>p.camp??initialCamp();
export const ensureCamp=(p:Profile):CampLife=>p.camp??(p.camp=initialCamp());
export const campLevel=(p:Profile):number=>CAMP_LEVELS.filter(l=>p.xp>=l.xp).length;
export const buddyJob=(p:Profile,id:Companion):CampJob|null=>(Object.keys(JOBS) as CampJob[]).find(j=>campOf(p).jobs[j]===id)??null;
const preferred:Record<CampJob,Companion[]>={counter:['slime','guard','bird','fox','guide'],workshop:['slime','guard','bird','owl','bear'],garden:['slime','guard','bird','deer','otter']};
export function jobPower(p:Profile,job:CampJob):number {
  const c=campOf(p),id=c.jobs[job];return id?campLevel(p)>=5&&c.quests.includes(id)&&preferred[job].includes(id)?2:1:0;
}
export const foodTicks=(p:Profile,food:Food)=>Math.ceil(COOK_TICKS[food]*(100-jobPower(p,'workshop')*5)/100);
export const cookingPending=(p:Profile,food:Food)=>campOf(p).cooking.reduce((n,q)=>n+(q.food===food?q.remaining:0),0);
export function foodRefundReserve(p:Profile,r:Reagent):number {
  return campOf(p).cooking.reduce((n,q)=>{const f=FOODS[q.food];return n+(r==='flour'?f.flour:r==='gel'?f.gel:(f.materials as Partial<Record<Reagent,number>>)[r]??0)*q.remaining;},0);
}
const foodCosts=(food:Food):Partial<Record<Reagent,number>>=>{const f=FOODS[food];return {...f.materials,...(f.flour?{flour:f.flour}:{}),...(f.gel?{gel:f.gel}:{})};};

export function foodQueueReason(p:Profile,food:Food,count:number):string {
  if(villagePlanActive(p,'kitchen'))return '料理已有有限经营安排，先停止安排。';
  if(campOf(p).cooking.length>=3)return '料理排产已满，最多三批。';
  if(p.leisure.materials[food]+cookingPending(p,food)+count>9999)return '料理与在制数量已满。';
  if(Object.entries(foodCosts(food)).some(([r,n])=>reagentCount(p,r as Reagent)<n!*count))return '制作材料不足。';
  return '';
}
export function queueFood(p:Profile,food:Food,count:1|5):void {
  const reason=foodQueueReason(p,food,count);if(reason)throw Error(reason);const c=ensureCamp(p);
  for(const [r,n] of Object.entries(foodCosts(food)))changeReagent(p,r as Reagent,-n!*count);
  c.cooking.push({id:p.sequence+1,food,remaining:count,due:c.cooking.length?0:p.tick+foodTicks(p,food)});
  c.last.kitchen={id:food,count};p.notice=`已安排${count}份${FOODS[food].name}，每份约${Math.ceil(foodTicks(p,food)/10)}秒。`;
}

export const BUDDY_QUESTS:Record<Companion,{name:string;detail:string;ready:(p:Profile)=>boolean}>= {
  slime:{name:'最初的营火',detail:'苔团子同行3趟，完成10份料理',ready:p=>bondsOf(p.leisure).progress.slime.voyages>=3&&p.leisure.cooked>=10},
  guide:{name:'熟悉的路灯',detail:'提灯旅人同行8趟，探索过月泉矿洞',ready:p=>bondsOf(p.leisure).progress.guide.voyages>=8&&p.leisure.clears[1]>0},
  guard:{name:'守望的庭院',detail:'林地守卫同行8趟，小屋达到Lv2',ready:p=>bondsOf(p.leisure).progress.guard.voyages>=8&&p.leisure.journal.buildings.lodge>=2},
  fox:{name:'狐狸的第一单',detail:'灯尾狐同行3趟，完成5份特色委托',ready:p=>bondsOf(p.leisure).progress.fox.voyages>=3&&Object.values(atelierOf(p).orders).flat().reduce((n,o)=>n+o.revision,0)>=5},
  deer:{name:'窗边的草药',detail:'月角鹿同行3趟，累计收获15次花圃',ready:p=>bondsOf(p.leisure).progress.deer.voyages>=3&&p.leisure.harvests>=15},
  otter:{name:'一片丰收',detail:'泡泡水獭同行8趟，花圃达到Lv2',ready:p=>bondsOf(p.leisure).progress.otter.voyages>=8&&p.leisure.gardenLevel>=2},
  owl:{name:'星页的墨香',detail:'星页鸮同行8趟，累计调配20份星尘墨',ready:p=>bondsOf(p.leisure).progress.owl.voyages>=8&&atelierOf(p).made.ink>=20},
  bear:{name:'给朋友的点心',detail:'蜜糖熊同行3趟，累计完成50份料理',ready:p=>bondsOf(p.leisure).progress.bear.voyages>=3&&p.leisure.cooked>=50},
  bird:{name:'雪境的回信',detail:'霜羽雀同行8趟，探访极光巢庭3趟',ready:p=>bondsOf(p.leisure).progress.bird.voyages>=8&&bondsOf(p.leisure).secretClears[4]>=3},
};
export function repeatAction(p:Profile,station:ProductionStation,mode:'repeat'|'available'):GameAction|null {
  const last=campOf(p).last[station];if(!last)return null;
  let count=last.count;
  if(mode==='available'){
    const cost=station==='kitchen'?foodCosts(last.id as Food):station==='basic'?{flour:recipes[last.id as Recipe].flour,gel:recipes[last.id as Recipe].gel}:FORMULAS[last.id as Good].cost;
    const limit=station==='kitchen'?5:station==='basic'?batchLimit(p.business):atelierBatchLimit(atelierOf(p),station);
    count=Math.min(limit,...Object.entries(cost).filter(([,n])=>n!>0).map(([r,n])=>Math.floor(reagentCount(p,r as Reagent)/n!)));
    if(station==='kitchen')count=count>=5?5:count>=1?1:0;
  }
  if(count<1)return null;
  return station==='kitchen'?{type:'camp-cook',food:last.id as Food,count:count as 1|5}:station==='basic'?{type:'queue-craft',recipe:last.id as Recipe,count}:{type:'atelier-craft',good:last.id as Good,count};
}
const reasonFor=(p:Profile,a:GameAction)=>a.type==='camp-cook'?foodQueueReason(p,a.food,a.count):a.type==='queue-craft'?businessReason(p,a):atelierReason(p,a as Extract<GameAction,{type:'atelier-craft'}>);
const travelling=(p:Profile)=>!!p.run||!!p.leisure.run;
export function campReason(p:Profile,a:CampAction):string {
  const c=campOf(p);
  if(a.type==='camp-cancel-food'){
    const q=c.cooking[a.position];if(!q||q.id!==a.id)return '这批已经完成或队列已变化。';
    if(Object.entries(foodCosts(q.food)).some(([r,n])=>reagentSpace(p,r as Reagent)<n!*q.remaining))return '退款材料空间不足，先整理背包；排产保留。';
  }else if(a.type==='camp-level-claim'){
    const gift=CAMP_LEVELS[c.claimed];if(!gift)return '所有营地赠礼已领取。';if(p.xp<gift.xp)return '达到下一营地等级后领取。';
    if(p.coins+gift.coins>1e9||p.leisure.materials.ore+gift.ore>9999)return '奖励空间不足，赠礼保留。';
  }else if(a.type==='camp-collect'){
    const total=p.business.till+atelierOf(p).till;if(!total)return '暂无待收货款。';if(p.coins+total>1e9)return '金币空间不足，全部货款保留。';
  }else if(a.type==='camp-job'){
    if(campLevel(p)<JOBS[a.job].level)return `营地Lv${JOBS[a.job].level}后开放。`;
    if(c.jobs[a.job]===a.companion)return '已经这样安排。';
    if(a.companion){if(a.companion==='slime'&&p.pets?.role==='expedition')return '苔团子已选择挂机职责，请先在宠物页切回休闲职责再上岗。';if(buddyXP(p.leisure,a.companion)===null)return '先邀请这位伙伴。';
      if(p.leisure.active===a.companion||bondsOf(p.leisure).support===a.companion||p.expedition?.active?.crew===a.companion)return '领队、支援或远征伙伴不能同时在岗。';
      if(buddyJob(p,a.companion))return '这位伙伴已在其他岗位，先撤岗。';}
  }else if(a.type==='camp-buddy-quest'){
    if(buddyXP(p.leisure,a.companion)===null)return '先邀请这位伙伴。';if(c.quests.includes(a.companion))return '这份伙伴纪念已珍藏。';
    if(!BUDDY_QUESTS[a.companion].ready(p))return BUDDY_QUESTS[a.companion].detail+'。';
    if(p.coins+100>1e9||p.leisure.materials.ore+10>9999)return '纪念奖励空间不足，礼物保留。';
  }else if(a.type==='camp-prepare'){
    const next=repeatAction(p,a.station,a.mode);if(!next)return c.last[a.station]?'现有材料不足。':'先在对应工坊安排一次制作。';return reasonFor(p,next);
  }else if(a.type==='camp-preset'){
    if(campLevel(p)<(a.slot?4:2))return `营地Lv${a.slot?4:2}后开放。`;if(travelling(p))return '回营后再保存或装载搭配。';
    if(a.operation==='load'){const preset=c.presets[a.slot];if(!preset)return '还没有保存这套搭配。';
      if([preset.leader,preset.support].some(id=>id&&buddyJob(p,id)))return '搭配中的伙伴正在工作，先撤岗。';
      if(preset.relics.some(i=>!bondsOf(p.leisure).relics[i]))return '搭配中的奇珍尚未持有。';}
  }else if(a.type==='camp-redepart'){
    if(!c.lastJourney)return '先完成一次探索安排。';return leisureReason(p,{type:'stroll-start',...c.lastJourney});
  }else if(a.type==='camp-stock-plan'){
    if(villagePlanActive(p,a.station))return '本站已有有限经营安排，先停止安排。';
    if(campLevel(p)<3)return '营地Lv3后开放有限上架计划。';if(FORMULAS[a.good].station!==a.station)return '商品不属于这个工坊。';
    if(c.stockPlans[a.station])return '本站已有计划，先停止原计划。';
  }else if(a.type==='camp-stock-stop'&&!c.stockPlans[a.station])return '本站没有上架计划。';
  return '';
}
export function applyCamp(p:Profile,a:CampAction,dispatch:(a:GameAction)=>void):void {
  const reason=campReason(p,a);if(reason)throw Error(reason);
  if(a.type==='camp-prepare'){dispatch(repeatAction(p,a.station,a.mode)!);return;}
  if(a.type==='camp-redepart'){dispatch({type:'stroll-start',...campOf(p).lastJourney!});return;}
  const c=ensureCamp(p);
  if(a.type==='camp-cancel-food'){
    const q=c.cooking[a.position];for(const [r,n]of Object.entries(foodCosts(q.food)))changeReagent(p,r as Reagent,n!*q.remaining);
    c.cooking.splice(a.position,1);if(a.position===0&&c.cooking[0])c.cooking[0].due=p.tick+foodTicks(p,c.cooking[0].food);p.notice='剩余料理材料已退回。';
  }else if(a.type==='camp-level-claim'){
    const gift=CAMP_LEVELS[c.claimed++];p.coins+=gift.coins;p.totals.earned=Math.min(1e12,p.totals.earned+gift.coins);p.leisure.materials.ore+=gift.ore;p.notice=`收下了“${gift.name}”的营地赠礼。`;
  }else if(a.type==='camp-collect'){
    const sum=p.business.till+(p.atelier?.till??0);p.business.till=0;if(p.atelier)p.atelier.till=0;p.coins+=sum;p.totals.earned=Math.min(1e12,p.totals.earned+sum);p.notice=`两只钱箱共收款${sum}金币。`;
  }else if(a.type==='camp-job'){c.jobs[a.job]=a.companion;p.notice=a.companion?`${COMPANIONS[a.companion].name}在${JOBS[a.job].name}帮忙。`:'伙伴回到小院休息。';
  }else if(a.type==='camp-buddy-quest'){c.quests.push(a.companion);p.coins+=100;p.totals.earned=Math.min(1e12,p.totals.earned+100);p.leisure.materials.ore+=10;p.notice=`珍藏了“${BUDDY_QUESTS[a.companion].name}”；营地Lv5后发挥岗位专长。`;
  }else if(a.type==='camp-preset'){
    if(a.operation==='save')c.presets[a.slot]={leader:p.leisure.active,support:bondsOf(p.leisure).support,relics:[...bondsOf(p.leisure).loadout]};
    else {const preset=c.presets[a.slot]!;p.leisure.active=preset.leader;const bonds=ensureBonds(p.leisure);bonds.support=preset.support;bonds.loadout=[...preset.relics];}
    p.notice=a.operation==='save'?'当前队伍与奇珍搭配已保存。':'队伍与奇珍搭配已装载。';
  }else if(a.type==='camp-stock-plan'){c.stockPlans[a.station]={good:a.good,remaining:a.count,reserve:a.reserve};p.notice='已安排有限上架；不自动开业、采购或制作。';
  }else if(a.type==='camp-stock-stop'){c.stockPlans[a.station]=null;p.notice='上架计划已停止，已上架商品保留。';}
}
export function rememberProduction(p:Profile,a:GameAction):void {
  if(a.type==='queue-craft'||a.type==='craft')ensureCamp(p).last.basic={id:a.recipe,count:a.count};
  if(a.type==='atelier-craft')ensureCamp(p).last[FORMULAS[a.good].station]={id:a.good,count:a.count};
  if(a.type==='stroll-start')ensureCamp(p).lastJourney={zone:a.zone,route:a.route,trips:a.trips,depth:a.depth??0,secret:a.secret??false};
}
export function stepCamp(p:Profile):void {
  const c=p.camp;if(!c)return;const q=c.cooking[0];
  if(q&&q.due<=p.tick&&p.leisure.materials[q.food]<9999){
    p.leisure.materials[q.food]++;p.leisure.cooked=Math.min(1e12,p.leisure.cooked+1);q.remaining--;
    p.notice=`${FOODS[q.food].name}做好了，已放入背包。`;
    if(!q.remaining)c.cooking.shift();if(c.cooking[0])c.cooking[0].due=p.tick+foodTicks(p,c.cooking[0].food);
  }
  if(p.atelier)for(const station of ['supply','alchemy'] as const){const plan=c.stockPlans[station];if(!plan)continue;
    const free=atelierShelfLimit(p.atelier)-Object.values(p.atelier.shelves).reduce((n,s)=>n+s.stock,0)-villageShelfReserve(p);
    const n=Math.min(plan.remaining,Math.max(0,p.atelier.stock[plan.good]-plan.reserve),free);if(n<1)continue;
    const shelf=p.atelier.shelves[plan.good];p.atelier.stock[plan.good]-=n;if(!shelf.stock)shelf.due=0;shelf.stock+=n;plan.remaining-=n;
    if(p.atelier.open[station]&&shelf.due===0){const intervals={quick:600,normal:900,premium:1500};shelf.due=p.tick+intervals[shelf.quote];}
    if(!plan.remaining)c.stockPlans[station]=null;
  }
}
export function campWork(p:Profile):boolean {
  const c=p.camp;if(!c)return false;const q=c.cooking[0];if(q&&p.leisure.materials[q.food]<9999)return true;
  const a=p.atelier;if(!a||Object.values(a.shelves).reduce((n,s)=>n+s.stock,0)+villageShelfReserve(p)>=atelierShelfLimit(a))return false;
  return Object.values(c.stockPlans).some(plan=>plan&&a.stock[plan.good]>plan.reserve);
}
export function nextCampGoal(p:Profile):string {
  const level=campLevel(p),l=p.leisure;
  if(!l.clears[0])return '去苔光庭院完成第一趟探索，带回建设材料。';
  if((buddyXP(l,l.active)??0)<2)return '给领队喂两份莓果饼，达到Lv2。';
  if(l.clears[0]<3)return '再探访苔光庭院，累计三趟后开放秘境。';
  if(!bondsOf(l).secretClears[0])return '探访古树心室，寻找第一件可搭配奇珍。';
  if(level<7)return `积累至${CAMP_LEVELS[level].xp}经验，开放${CAMP_LEVELS[level].unlock}。`;
  const missing=(Object.keys(BUDDY_QUESTS) as Companion[]).find(id=>!campOf(p).quests.includes(id));
  return missing?`伙伴纪念：${BUDDY_QUESTS[missing].detail}。`:'群岛之家已点亮，试试新的队伍和奇珍搭配。';
}
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
function shape(v:unknown,keys:string):asserts v is Record<string,unknown>{if(!record(v)||Object.keys(v).sort().join(' ')!==keys.split(' ').sort().join(' '))throw Error('营地成长字段不匹配');};
const int=(v:unknown,max:number,min=0)=>{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<min||v>max)throw Error('营地成长数值无效');};
const buddy=(v:unknown):v is Companion=>typeof v==='string'&&Object.hasOwn(COMPANIONS,v);
export function parseCampAction(v:Record<string,unknown>):CampAction|null {
  if(typeof v.type!=='string')return null;
  if(v.type==='camp-cancel-food'){shape(v,'type id position');int(v.id,1e12,1);int(v.position,2);}
  else if(['camp-level-claim','camp-collect','camp-redepart'].includes(String(v.type)))shape(v,'type');
  else if(v.type==='camp-job'){shape(v,'type job companion');if(typeof v.job!=='string'||!Object.hasOwn(JOBS,v.job)||v.companion!==null&&!buddy(v.companion))throw Error('岗位无效');}
  else if(v.type==='camp-buddy-quest'){shape(v,'type companion');if(!buddy(v.companion))throw Error('伙伴无效');}
  else if(v.type==='camp-prepare'){shape(v,'type station mode');if(typeof v.station!=='string'||typeof v.mode!=='string'||!['basic','supply','alchemy','kitchen'].includes(v.station)||!['repeat','available'].includes(v.mode))throw Error('排产安排无效');}
  else if(v.type==='camp-preset'){shape(v,'type slot operation');int(v.slot,2);if(v.operation!=='save'&&v.operation!=='load')throw Error('搭配操作无效');}
  else if(v.type==='camp-stock-plan'){shape(v,'type station good count reserve');if(typeof v.station!=='string'||!['supply','alchemy'].includes(v.station)||!GOOD_IDS.includes(v.good as Good)||![5,10,30].includes(v.count as number)||![0,5,10].includes(v.reserve as number))throw Error('有限上架计划无效');}
  else if(v.type==='camp-stock-stop'){shape(v,'type station');if(v.station!=='supply'&&v.station!=='alchemy')throw Error('上架站点无效');}
  else return null;
  return v as CampAction;
}
export function validateCamp(raw:unknown,p:Profile):asserts raw is CampLife {
  shape(raw,'version cooking claimed jobs quests last presets lastJourney stockPlans');if(raw.version!==1)throw Error('营地成长版本无效');
  int(raw.claimed,7);if(raw.claimed&&p.xp<CAMP_LEVELS[(raw.claimed as number)-1].xp)throw Error('营地等级赠礼未解锁');
  if(!Array.isArray(raw.cooking)||raw.cooking.length>3)throw Error('料理队列无效');const ids=new Set<number>();
  for(const [i,q]of raw.cooking.entries()){shape(q,'id food remaining due');int(q.id,p.sequence,1);if(ids.has(q.id as number))throw Error('料理批次ID重复');ids.add(q.id as number);if(typeof q.food!=='string'||!Object.hasOwn(FOODS,q.food))throw Error('料理配方无效');int(q.remaining,5,1);int(q.due,1e15);if(i>0&&q.due!==0||i===0&&Number(q.due)<1)throw Error('料理时钟无效');}
  shape(raw.jobs,'counter workshop garden');const seen=new Set<string>();for(const job of Object.keys(JOBS) as CampJob[]){const id=raw.jobs[job];if(id!==null){if(!buddy(id)||buddyXP(p.leisure,id)===null||seen.has(id)||p.leisure.active===id||bondsOf(p.leisure).support===id||p.expedition?.active?.crew===id||campLevel(p)<JOBS[job].level)throw Error('在岗伙伴无效');seen.add(id);}}
  if(!Array.isArray(raw.quests)||raw.quests.length>9||new Set(raw.quests).size!==raw.quests.length||raw.quests.some(id=>!buddy(id)||buddyXP(p.leisure,id)===null||!BUDDY_QUESTS[id].ready(p)))throw Error('伙伴纪念无效');
  if(!record(raw.last)||Object.keys(raw.last).some(k=>!['basic','supply','alchemy','kitchen'].includes(k)))throw Error('上次制作记录无效');
  for(const [station,last]of Object.entries(raw.last)){shape(last,'id count');int(last.count,99,1);if(typeof last.id!=='string'||station==='basic'&&!Object.hasOwn(recipes,last.id)||station==='kitchen'&&(!Object.hasOwn(FOODS,last.id)||last.count!==1&&last.count!==5)||['supply','alchemy'].includes(station)&&(!GOOD_IDS.includes(last.id as Good)||FORMULAS[last.id as Good].station!==station||Number(last.count)>30))throw Error('上次配方无效');}
  if(!Array.isArray(raw.presets)||raw.presets.length!==3)throw Error('队伍预设无效');for(const [slot,preset] of raw.presets.entries()){if(preset===null)continue;if(campLevel(p)<(slot?4:2))throw Error('预设槽位未开放');shape(preset,'leader support relics');if(!buddy(preset.leader)||buddyXP(p.leisure,preset.leader)===null||preset.support!==null&&(!buddy(preset.support)||preset.support===preset.leader||buddyXP(p.leisure,preset.support)===null)||!Array.isArray(preset.relics)||preset.relics.length>3||new Set(preset.relics).size!==preset.relics.length)throw Error('预设伙伴无效');for(const r of preset.relics){int(r,14);if(!bondsOf(p.leisure).relics[r])throw Error('预设奇珍未持有');}}
  if(raw.lastJourney!==null){shape(raw.lastJourney,'zone route trips depth secret');int(raw.lastJourney.zone,4);int(raw.lastJourney.depth,2);if(typeof raw.lastJourney.route!=='string'||!['balanced','gather','treasure'].includes(raw.lastJourney.route)||![1,3,6].includes(raw.lastJourney.trips as number)||typeof raw.lastJourney.secret!=='boolean')throw Error('上次旅程无效');}
  shape(raw.stockPlans,'supply alchemy');for(const station of ['supply','alchemy'] as const){const plan=raw.stockPlans[station];if(plan===null)continue;shape(plan,'good remaining reserve');if(!GOOD_IDS.includes(plan.good as Good)||FORMULAS[plan.good as Good].station!==station||campLevel(p)<3)throw Error('上架计划配方无效');int(plan.remaining,30,1);if(![0,5,10].includes(plan.reserve as number))throw Error('上架保留量无效');}
}
