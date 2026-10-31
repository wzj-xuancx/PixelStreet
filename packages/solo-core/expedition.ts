import {capturePets,activePetEffects} from './pets';
import {activeEquipmentEffects,equipmentTravel} from './equipment';
import {buddyJob} from './camp-life';
import type {Profile} from './index';
import {COMPANIONS,companionLevel} from './leisure';

export const EXPEDITION_MODES={survey:{name:'遗迹勘探',detail:'每场更多勘探手记，适合推进远征成长'},forage:{name:'野外采集',detail:'每场多带回草药、果实与月纹石'},caravan:{name:'商队护送',detail:'每场获得额外金币，收集商会交付凭证'}} as const;
export type ExpeditionMode=keyof typeof EXPEDITION_MODES;
export const EXPEDITION_BIOMES=[{name:'萤石荒径',scene:'glow-trail',detail:'萤火、石桥和林间补给车',travel:600},{name:'裂晶洞口',scene:'crystal-ravine',detail:'沿矿道与吊桥寻找闪光矿脉',travel:900},{name:'遗迹深廊',scene:'old-sanctuary',detail:'穿过古老拱门，带回失落的记录',travel:1200}] as const;
export const EXPEDITION_MATERIALS={ore:'月纹石',herb:'晨露草',berry:'甜莓',mushroom:'萤光菇',marks:'勘探手记'} as const;
export type ExpeditionMaterial=keyof typeof EXPEDITION_MATERIALS;
export const EXPEDITION_MEALS={none:{name:'不携料理',effect:'不消耗额外食品'},tea:{name:'花草茶',effect:'技能伤害+4，冷却缩短1秒'},biscuit:{name:'莓果饼',effect:'普通攻击+2'},soup:{name:'菌菇汤',effect:'受到伤害−2，整备额外恢复6生命'}} as const;
export type ExpeditionMeal=keyof typeof EXPEDITION_MEALS;
export const TRAIL_UPGRADES={charts:{name:'测绘室',effect:'每级行程耗时减少5%',coins:[60,180,480],ore:[8,20,45],marks:[5,18,40]},tents:{name:'行军营帐',effect:'每级整备额外恢复4生命',coins:[70,200,500],ore:[10,24,50],marks:[6,20,45]},wagon:{name:'货运车架',effect:'每级每场金币+2，采集材料+1',coins:[80,220,550],ore:[12,28,60],marks:[8,24,50]}} as const;
export type TrailUpgrade=keyof typeof TRAIL_UPGRADES;
export interface ExpeditionEvent {id:string;kind:'cache'|'caravan';region:number}
export interface ExpeditionActive {runId:string;region:number;mode:ExpeditionMode;budget:number;crew:string;crewName:string;level:number;meal:ExpeditionMeal;travel:number;attack:number;defence:number;heal:number;spell:number;cooldown:number;gold:number;gel:number;gather:number;notes:number;won:number;coins:number;xp:number;loot:number}
export interface ExpeditionReport {region:number;mode:ExpeditionMode;crew:string;won:number;spent:number;coins:number;xp:number;gel:number;reason:string}
export interface Expedition {version:1;marks:number;upgrades:Record<TrailUpgrade,number>;credits:number[];wins:number[];orders:number[];trips:number;resolved:number;carry:Record<Exclude<ExpeditionMaterial,'marks'>,number>;cargo:Record<ExpeditionMaterial,number>;events:ExpeditionEvent[];active:ExpeditionActive|null;last:ExpeditionReport|null}
export type ExpeditionAction=
 |{type:'expedition-depart';region:number;budget:3|6|9;auto:boolean;mode:ExpeditionMode;crew:string;meal:ExpeditionMeal}
 |{type:'expedition-claim'|'expedition-sell-cargo'|'expedition-exchange'}
 |{type:'expedition-upgrade';upgrade:TrailUpgrade}
 |{type:'expedition-event';id:string;choice:'study'|'gather'|'barter'}
 |{type:'expedition-deliver';slot:number;revision:number};
const emptyCargo=():Expedition['cargo']=>({ore:0,herb:0,berry:0,mushroom:0,marks:0});
export const initialExpedition=():Expedition=>({version:1,marks:0,upgrades:{charts:0,tents:0,wagon:0},credits:[0,0,0],wins:[0,0,0],orders:[0,0,0],trips:0,resolved:0,carry:{ore:0,herb:0,berry:0,mushroom:0},cargo:emptyCargo(),events:[],active:null,last:null});
export const readExpedition=(p:Profile):Expedition=>p.expedition??initialExpedition();
export const hasExpeditionCargo=(p:Profile)=>Object.values(readExpedition(p).cargo).some(n=>n>0);
export const expeditionCargoPrice=(p:Profile)=>Object.entries(readExpedition(p).cargo).reduce((sum,[k,n])=>sum+n*({ore:2,herb:2,berry:3,mushroom:4,marks:0}[k as ExpeditionMaterial]),0);
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
function shape(v:unknown,keys:string):asserts v is Record<string,unknown>{if(!object(v)||Object.keys(v).sort().join(' ')!==keys.split(' ').sort().join(' '))throw Error('远征档案字段不匹配');}
function int(v:unknown,max=1e12,min=0):asserts v is number{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<min||v>max)throw Error('远征档案数值无效');}
function member<T extends string>(v:unknown,values:Record<T,unknown>):v is T{return typeof v==='string'&&Object.hasOwn(values,v);}
function text(v:unknown,max=180):asserts v is string{if(typeof v!=='string'||!v.length||v.length>max)throw Error('远征文字无效');}
export function validateExpedition(raw:unknown,p:Profile):asserts raw is Expedition {
 shape(raw,'version marks upgrades credits wins orders trips resolved carry cargo events active last');if(raw.version!==1)throw Error('远征扩展版本无效');int(raw.marks,1e6);int(raw.trips);int(raw.resolved);shape(raw.upgrades,'charts tents wagon');for(const n of Object.values(raw.upgrades))int(n,3);
 for(const key of ['credits','wins','orders'] as const){const a=raw[key];if(!Array.isArray(a)||a.length!==3)throw Error('远征记录无效');for(const n of a)int(n,1e9);}
 for(let i=0;i<3;i++)if((raw.credits as number[])[i]>(raw.wins as number[])[i])throw Error('交付凭证超过战绩');
 shape(raw.carry,'ore herb berry mushroom');for(const n of Object.values(raw.carry))int(n,99);
 shape(raw.cargo,'ore herb berry mushroom marks');for(const n of Object.values(raw.cargo))int(n,1e6);
 if(!Array.isArray(raw.events)||raw.events.length>3)throw Error('旅途记录数量无效');const ids=new Set<string>();for(const event of raw.events){shape(event,'id kind region');text(event.id,80);if(!/^expedition-[0-9]+-[0-9]+$/.test(event.id)||ids.has(event.id)||!['cache','caravan'].includes(String(event.kind)))throw Error('旅途事件无效');ids.add(event.id);int(event.region,2);}
 if(raw.active!==null){const a=raw.active;shape(a,'runId region mode budget crew crewName level meal travel attack defence heal spell cooldown gold gel gather notes won coins xp loot');text(a.runId,40);if(!/^run-[0-9]+$/.test(a.runId)||p.run?.id!==a.runId||!member(a.mode,EXPEDITION_MODES)||!member(a.meal,EXPEDITION_MEALS))throw Error('远征队伍游标无效');int(a.region,2);if(a.budget!==3&&a.budget!==6&&a.budget!==9)throw Error('远征补给无效');if(p.run.budget!==a.budget)throw Error('远征补给游标不一致');text(a.crew,32);text(a.crewName,32);if(a.crew!=='none'&&!Object.hasOwn(COMPANIONS,a.crew))throw Error('远征伙伴无效');int(a.level,5);int(a.travel,1200,300);int(a.attack,6);int(a.defence,5);int(a.heal,50);int(a.spell,6);int(a.cooldown,20);int(a.gold,30);int(a.gel,1);int(a.gather,8);int(a.notes,8);int(a.won,a.budget);int(a.coins,10000);int(a.xp,10000);int(a.loot,100);}
 if(raw.last!==null){const r=raw.last;shape(r,'region mode crew won spent coins xp gel reason');int(r.region,2);if(!member(r.mode,EXPEDITION_MODES))throw Error('远征报告路线无效');text(r.crew,32);int(r.won,9);int(r.spent,9);if(r.won>r.spent)throw Error('远征报告战绩无效');int(r.coins,10000);int(r.xp,10000);int(r.gel,100);text(r.reason);}
}
export function parseExpeditionAction(v:Record<string,unknown>):ExpeditionAction|null {
 if(v.type==='expedition-depart'){shape(v,'type region budget auto mode crew meal');int(v.region,2);if(![3,6,9].includes(Number(v.budget))||typeof v.budget!=='number'||typeof v.auto!=='boolean'||!member(v.mode,EXPEDITION_MODES)||!member(v.meal,EXPEDITION_MEALS))throw Error('远征计划无效');text(v.crew,32);if(v.crew!=='none'&&!Object.hasOwn(COMPANIONS,v.crew))throw Error('远征伙伴无效');return v as ExpeditionAction;}
 if(['expedition-claim','expedition-sell-cargo','expedition-exchange'].includes(String(v.type))){shape(v,'type');return v as ExpeditionAction;}
 if(v.type==='expedition-upgrade'){shape(v,'type upgrade');if(!member(v.upgrade,TRAIL_UPGRADES))throw Error('远征设施无效');return v as ExpeditionAction;}
 if(v.type==='expedition-event'){shape(v,'type id choice');text(v.id,80);if(!/^expedition-[0-9]+-[0-9]+$/.test(v.id)||!['study','gather','barter'].includes(String(v.choice)))throw Error('旅途选项无效');return v as ExpeditionAction;}
 if(v.type==='expedition-deliver'){shape(v,'type slot revision');int(v.slot,2);int(v.revision,1e9);return v as ExpeditionAction;}
 return null;
}
export const expeditionCrewLevel=(p:Profile,crew:string):number=>crew==='none'?0:companionLevel((p.leisure.companions as Record<string,number|null|undefined>)[crew]??0);
export function expeditionCrewEffect(crew:string,level:number):string {
 if(crew==='none')return '独自远行，不占用伙伴';if(crew==='slime')return '每场凝胶+1';if(crew==='guide')return `每场金币+${2+level}`;if(crew==='guard')return `攻击+1，减伤+${level>=3?2:1}`;if(crew==='fox')return `每场金币+${1+level}`;if(crew==='deer')return `整备恢复+${4+level}`;if(crew==='otter')return '每场采集材料+2';if(crew==='owl')return '每场勘探手记+2';if(crew==='bear')return '减伤+1，整备恢复+4';if(crew==='bird')return '行程耗时−5%，采集材料+1';return '每场勘探手记+1';
}
export function expeditionSnapshot(p:Profile,a:Extract<ExpeditionAction,{type:'expedition-depart'}>):ExpeditionActive {
 const e=readExpedition(p),j=p.leisure.journal,level=expeditionCrewLevel(p,a.crew),kitchen=j.buildings.workshop,record=COMPANIONS as Record<string,{name:string}>;
 return {runId:'run-'+(p.sequence+1),region:a.region,mode:a.mode,budget:a.budget,crew:a.crew,crewName:a.crew==='none'?'独自远行':record[a.crew].name,level,meal:a.meal,travel:Math.ceil(EXPEDITION_BIOMES[a.region].travel*(100-e.upgrades.charts*5-j.buildings.lodge*3-(a.crew==='bird'?5:0))/100),attack:(a.meal==='biscuit'?2+Math.floor(kitchen/2):0)+(a.crew==='guard'?1:0),defence:(a.meal==='soup'?2:0)+(a.crew==='guard'?(level>=3?2:1):a.crew==='bear'?1:0),heal:e.upgrades.tents*4+j.buildings.lodge*4+(a.meal==='soup'?6+kitchen:0)+(a.crew==='deer'?4+level:a.crew==='bear'?4:0),spell:a.meal==='tea'?4+Math.floor(kitchen/2):0,cooldown:a.meal==='tea'?10+kitchen*2:0,gold:(a.mode==='caravan'?4*(a.region+1):0)+(a.crew==='guide'?2+level:a.crew==='fox'?1+level:0)+e.upgrades.wagon*2,gel:a.crew==='slime'?1:0,gather:(a.mode==='forage'?2:0)+e.upgrades.wagon+Math.floor(p.business.upgrades.workbench/2)+(a.crew==='otter'?2:a.crew==='bird'?1:0),notes:(a.mode==='survey'?2:1)+Math.floor(j.buildings.archive/2)+(a.crew==='owl'?2:!['none','slime','guide','guard','fox','deer','otter','bear','bird'].includes(a.crew)?1:0),won:0,coins:0,xp:0,loot:0};
}
export function expeditionOrder(p:Profile,slot:number):{name:string;region:number;wins:number;items:Record<string,number>;coins:number;ore:number;marks:number;reputation:number;revision:number} {
 const revision=readExpedition(p).orders[slot],tier=1+Math.min(2,Math.floor(revision/3)),names=['草径补给委托','矿道商队委托','遗迹调查委托'],base=[{ration:2},{crystal:1,tea:1},{crystal:2,soup:2}];
 const items:Record<string,number>={};for(const [id,n]of Object.entries(base[slot]))if(n)items[id]=n*tier;
 if(revision%3===1)items.herb=3*tier;if(revision%3===2)items.biscuit=2*tier;
 return{name:names[slot],region:slot,wins:(slot===2?2:2)*tier,items,coins:[60,110,180][slot]*tier,ore:[6,10,14][slot]*tier,marks:[2,4,6][slot]*tier,reputation:1,revision};
}
export const expeditionItemCount=(p:Profile,item:string)=>Object.hasOwn(p.bag,item)?p.bag[item as keyof Profile['bag']]:p.leisure.materials[item as keyof typeof p.leisure.materials]??0;
function cargoReason(p:Profile,selling=false):string {
 const e=readExpedition(p);if(!hasExpeditionCargo(p))return '远征物资箱还是空的。';if(e.marks+e.cargo.marks>1e6)return '勘探手记已满，可先兑换或升级设施。';
 if(selling){if(!expeditionCargoPrice(p))return '物资箱里没有可收购的材料，请直接领取手记。';if(p.coins+expeditionCargoPrice(p)>1e9)return '金币已满，整箱物资保留。';}
 else for(const m of ['ore','herb','berry','mushroom'] as const)if(p.leisure.materials[m]+e.cargo[m]>9999)return `${EXPEDITION_MATERIALS[m]}空间不足，可整箱交给收购商。`;
 return '';
}
export function expeditionReason(p:Profile,a:ExpeditionAction,partySize=1):string {
 const e=readExpedition(p);
 switch(a.type){
  case 'expedition-depart':if(a.crew==='slime'&&p.pets?.role==='leisure')return '苔团子正在休闲职责，请在宠物页切换为挂机职责再同行。';if(a.crew!=='none'&&buddyJob(p,a.crew as import('./leisure').Companion))return '这位伙伴正在岗位帮忙，先撤岗。';if(p.job!=='keeper')return '先在补给商店完成任职试餐。';if(p.run)return '队伍正在远征。';if(p.leisure.run)return '先等地牢之门的队伍回营。';if(a.region>0&&!p.cleared.includes(a.region-1))return '先通过前一个远征区域。';if(p.bag.ration<a.budget)return `需要${a.budget}份旅行口粮。`;if(100-p.bag.gel<Math.floor(((2+(a.crew==='slime'?1:0))*(100+5*(partySize-1))+p.rewardRemainders.gel)/100))return '凝胶空间不足，请先整理背包。';if(hasExpeditionCargo(p))return '先领取或出售上趟远征物资。';if(a.crew!=='none'&&(p.leisure.companions as Record<string,unknown>)[a.crew]==null)return '先在地牢之门邀请这位伙伴。';if(a.meal!=='none'&&p.leisure.materials[a.meal]<1)return `需要1份${EXPEDITION_MEALS[a.meal].name}。`;break;
  case 'expedition-claim':return cargoReason(p);
  case 'expedition-sell-cargo':return cargoReason(p,true);
  case 'expedition-exchange':if(e.marks<10)return '需要10份勘探手记。';if(p.coins>1e9-20)return '金币已满。';break;
  case 'expedition-upgrade':{const n=e.upgrades[a.upgrade],u=TRAIL_UPGRADES[a.upgrade];if(n===3)return '设施已满级。';if(p.coins<u.coins[n]||p.leisure.materials.ore<u.ore[n]||e.marks<u.marks[n])return `需要${u.coins[n]}金币、${u.ore[n]}月纹石、${u.marks[n]}手记。`;break;}
  case 'expedition-event':{const event=e.events.find(item=>item.id===a.id);if(!event)return '这段旅途记录已处理。';if(a.choice==='barter'&&p.coins<15)return '友好交易需要15金币。';if(Object.values(e.cargo).some(n=>n>1e6-10))return '先整理物资箱再处理记录。';break;}
  case 'expedition-deliver':{const o=expeditionOrder(p,a.slot);if(o.revision!==a.revision)return '委托已经更新。';if(e.orders[a.slot]===1e9)return '本栏委托已达上限。';if(e.credits[o.region]<o.wins)return `还需${o.wins-e.credits[o.region]}份对应地区的胜利凭证。`;if(Object.entries(o.items).some(([id,n])=>expeditionItemCount(p,id)<n))return '商会委托所需物品不足。';if(p.coins+o.coins>1e9||p.leisure.materials.ore+o.ore>9999||e.marks+o.marks>1e6||p.business.reputation+o.reputation>1e9||p.business.completed+1>1e9)return '奖励空间不足，凭证和货物均保留。';break;}
 }
 return '';
}
export function applyExpedition(p:Profile,a:ExpeditionAction,start:(region:number,budget:number,auto:boolean)=>void,partySize=1):void {
 const reason=expeditionReason(p,a,partySize);if(reason)throw Error(reason);
 if(a.type==='expedition-depart'){
  const active=expeditionSnapshot(p,a);start(a.region,a.budget,a.auto);const e=p.expedition??=initialExpedition();if(a.meal!=='none')p.leisure.materials[a.meal]--;e.active=active;capturePets(p);p.run!.due=p.tick+equipmentTravel(p,active.travel);p.notice='队伍已出发；口粮用完自动回营，途中不会自动采购。';return;
 }
 const e=p.expedition??=initialExpedition();
 if(a.type==='expedition-claim'||a.type==='expedition-sell-cargo'){
  if(a.type==='expedition-sell-cargo'){const n=expeditionCargoPrice(p);p.coins+=n;p.totals.earned=Math.min(1e12,p.totals.earned+n);}else for(const m of ['ore','herb','berry','mushroom'] as const)p.leisure.materials[m]+=e.cargo[m];
  e.marks+=e.cargo.marks;e.cargo=emptyCargo();p.notice=a.type==='expedition-claim'?'远征物资与手记已入库。':'收购商接收了材料，勘探手记仍为你保留。';
 }else if(a.type==='expedition-exchange'){e.marks-=10;p.coins+=20;p.totals.earned=Math.min(1e12,p.totals.earned+20);p.notice='将10份手记抄本交给旅商，换得20金币。';}
 else if(a.type==='expedition-upgrade'){const n=e.upgrades[a.upgrade],u=TRAIL_UPGRADES[a.upgrade];p.coins-=u.coins[n];p.leisure.materials.ore-=u.ore[n];e.marks-=u.marks[n];e.upgrades[a.upgrade]++;p.notice=`${u.name}升至Lv${n+1}；下趟远征生效。`;}
 else if(a.type==='expedition-event'){
  const event=e.events.find(item=>item.id===a.id)!;
  if(a.choice==='study'){e.cargo.marks+=2;e.cargo.ore+=1;}
  else if(a.choice==='gather'){const crop=(['herb','berry','mushroom'] as const)[event.region];e.cargo[crop]+=3;e.cargo.marks++;}
  else{p.coins-=15;e.cargo.ore+=6;e.cargo.marks+=2;}
  e.events=e.events.filter(item=>item.id!==a.id);e.resolved=Math.min(1e12,e.resolved+1);p.notice='旅途记录已处理，收获放入远征物资箱。';
 }else if(a.type==='expedition-deliver'){
  const o=expeditionOrder(p,a.slot);for(const [id,n]of Object.entries(o.items)){if(Object.hasOwn(p.bag,id))p.bag[id as keyof Profile['bag']]-=n;else p.leisure.materials[id as keyof typeof p.leisure.materials]-=n;}
  e.credits[o.region]-=o.wins;e.orders[a.slot]++;p.coins+=o.coins;p.totals.earned=Math.min(1e12,p.totals.earned+o.coins);p.leisure.materials.ore+=o.ore;e.marks+=o.marks;p.business.reputation+=o.reputation;p.business.completed++;p.notice=`完成${o.name}，补给店声望+${o.reputation}。`;
 }
}
export const activeExpedition=(p:Profile)=>p.expedition?.active?.runId===p.run?.id?p.expedition?.active:null;
export const expeditionGelBonus=(p:Profile)=>activeExpedition(p)?.gel??0;
export const expeditionGoldBonus=(p:Profile)=>activeExpedition(p)?.gold??0;
export const expeditionAttackBonus=(p:Profile)=>activeExpedition(p)?.attack??0;
export const expeditionDefence=(p:Profile)=>activeExpedition(p)?.defence??0;
export const expeditionHealing=(p:Profile)=>activeExpedition(p)?.heal??0;
export const expeditionSpell=(p:Profile)=>activeExpedition(p)?.spell??0;
export const expeditionCooldown=(p:Profile)=>activeExpedition(p)?.cooldown??0;
export function hasRoomForExpeditionWin(p:Profile,partySize=1):boolean {
 const a=activeExpedition(p),r=p.run;if(!a||!r)return true;const e=p.expedition!,crop=(['herb','berry','mushroom'] as const)[r.region];
 if(e.cargo.marks+a.notes>1e6)return false;
 return ([['ore',r.region+1+a.gather+activeEquipmentEffects(p).gather+activePetEffects(p).gather],[crop,1+a.gather+activeEquipmentEffects(p).gather+activePetEffects(p).gather]] as const).every(([id,n])=>e.cargo[id]+Math.floor((n*(100+5*(partySize-1))+e.carry[id])/100)<=1e6);
}
export function recordExpeditionWin(p:Profile,coins:number,xp:number,gel:number,partySize=1):void {
 const a=activeExpedition(p),r=p.run;if(!a||!r)return;const e=p.expedition!;
 a.won++;a.coins+=coins;a.xp+=xp;a.loot+=gel;e.wins[r.region]=Math.min(1e9,e.wins[r.region]+1);e.credits[r.region]=Math.min(1e9,e.credits[r.region]+1);
 e.cargo.marks+=a.notes;const crop=(['herb','berry','mushroom'] as const)[r.region];for(const [id,n]of [['ore',r.region+1+a.gather+activeEquipmentEffects(p).gather+activePetEffects(p).gather],[crop,1+a.gather+activeEquipmentEffects(p).gather+activePetEffects(p).gather]] as const){const value=n*(100+5*(partySize-1))+e.carry[id];e.cargo[id]+=Math.floor(value/100);e.carry[id]=value%100;}
 if(a.won%2===0&&e.events.length<3)e.events.push({id:`expedition-${r.id.slice(4)}-${a.won}`,kind:a.won%4===0?'caravan':'cache',region:r.region});
}
export function finishExpedition(p:Profile,reason:string):void {
 const a=activeExpedition(p),r=p.run;if(!a||!r)return;const e=p.expedition!;e.last={region:a.region,mode:a.mode,crew:a.crewName,won:a.won,spent:r.spent,coins:a.coins,xp:a.xp,gel:a.loot,reason:reason+(r.defeated.length?' · 途中退区'+r.defeated.length+'次':'')};e.trips=Math.min(1e12,e.trips+1);e.active=null;
}
export function expeditionNextTravel(p:Profile):number{return equipmentTravel(p,activeExpedition(p)?.travel??20);}
