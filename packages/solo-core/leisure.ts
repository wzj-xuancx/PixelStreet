import {foodQueueReason,queueFood,buddyJob,jobPower} from './camp-life';
import type {Profile} from './index';
import {ITEMS} from './catalog';
import {initialJournal,validateJournal,parseWorldAction,worldReason,applyWorld,depthReason,strollDuration,relicBonuses,discoverRelic,DEPTHS,foodPrice,LANDMARKS,leisureGelCapacity,type Journal,type WorldAction} from './camp-world';
export * from './camp-world';
import {NEW_COMPANIONS,type NewCompanion} from './companions';
import {bondsOf,ensureBonds,buddyXP,hasBondCargo,validateBonds,validateBondSnapshot,parseBondAction,bondReason,applyBond,secretReason,bondSnapshot,bondDuration,settleBondRoom,settleBondTrip,bondClaimReason,claimBonds,SECRET_SITES,type Bonds,type BondSnapshot,type BondAction} from './bonds';
export * from './bonds';

export const MATERIALS={herb:'晨露草',berry:'甜莓',mushroom:'萤光菇',ore:'月纹石',tea:'花草茶',biscuit:'莓果饼',soup:'菌菇汤',pumpkin:'蜜糖南瓜',snowflower:'雪绒花',pie:'南瓜派',snowtea:'雪绒暖茶'} as const;
export type Material=keyof typeof MATERIALS;
export const CROPS={herb:{name:'晨露草',ticks:1800,seed:2,yield:3,unlock:-1},berry:{name:'甜莓',ticks:3600,seed:4,yield:4,unlock:-1},mushroom:{name:'萤光菇',ticks:6000,seed:6,yield:2,unlock:-1},pumpkin:{name:'蜜糖南瓜',ticks:7200,seed:10,yield:3,unlock:3},snowflower:{name:'雪绒花',ticks:9000,seed:12,yield:3,unlock:4}} as const;
export type Crop=keyof typeof CROPS;
export const FOODS={tea:{name:'花草茶',price:12,materials:{herb:2},flour:0,gel:0},biscuit:{name:'莓果饼',price:16,materials:{berry:2},flour:1,gel:0},soup:{name:'菌菇汤',price:24,materials:{mushroom:1},flour:0,gel:1},pie:{name:'南瓜派',price:46,materials:{pumpkin:2},flour:2,gel:0},snowtea:{name:'雪绒暖茶',price:52,materials:{snowflower:2,herb:1},flour:0,gel:0}} as const;
export type Food=keyof typeof FOODS;
export const COMPANIONS={slime:{name:'苔团子',effect:'每个遭遇多带回1凝胶',coins:0,ore:0,unlock:-1,frame:'companion-moss'},guide:{name:'提灯旅人',effect:'每个遭遇多带回3金币',coins:30,ore:5,unlock:0,frame:'merchant-0'},guard:{name:'林地守卫',effect:'每个遭遇多带回1月纹石',coins:80,ore:12,unlock:1,frame:'enemy-orc-idle-0'},...NEW_COMPANIONS} as const;
export type Companion=keyof typeof COMPANIONS;
export const DESTINATIONS=[{name:'苔光庭院',subtitle:'沿着萤火找一份小惊喜',ticks:200,enemy:'enemy-imp-idle-0',boss:'enemy-orc-idle-0'},{name:'月泉矿洞',subtitle:'收集岩壁间闪光的月纹石',ticks:400,enemy:'enemy-skeleton-idle-0',boss:'enemy-priest-idle-0'},{name:'星落遗迹',subtitle:'带上老朋友，看看更远的风景',ticks:600,enemy:'enemy-shaman-idle-0',boss:'boss-idle-0'},{name:'风铃麦田',subtitle:'麦浪与风车之间，藏着丰收的纪念',ticks:500,enemy:'enemy-orc-idle-0',boss:'enemy-priest-idle-0'},{name:'霜灯雪境',subtitle:'穿过雪松与冰湖，听一声云顶钟鸣',ticks:700,enemy:'enemy-skeleton-idle-0',boss:'boss-idle-0'}] as const;
export const ROUTES={balanced:{name:'悠闲漫游',effect:'每个遭遇经验+2'},gather:{name:'采集小径',effect:'每个遭遇凝胶、月纹石各+1'},treasure:{name:'寻宝小径',effect:'每个遭遇金币+6'}} as const;
export type Route=keyof typeof ROUTES;
export interface Stroll {id:string;zone:number;route:Route;room:number;remaining:number;total:number;due:number;duration:number;assistReady:number;companion:Companion;level:number;depth:number;coinBonus:number;oreBonus:number;dustBonus:number;bonds?:BondSnapshot}
export interface Leisure {
 bonds?:Bonds;journal:Journal;materials:Record<Material,number>;plots:Array<{crop:Crop;due:number}|null>;gardenLevel:number;
 companions:Record<'slime'|'guide'|'guard',number|null>&Partial<Record<NewCompanion,number|null>>;active:Companion;run:Stroll|null;
 cargo:{coins:number;xp:number;gel:number;ore:number};clears:number[];rooms:number;harvests:number;cooked:number;claimed:string[];
}
export type LeisureAction= WorldAction | BondAction
 |{type:'stroll-start';zone:number;route:Route;trips:1|3|6;depth?:number;secret?:boolean}
 |{type:'stroll-assist';runId:string;room:number;remaining:number}
 |{type:'stroll-return'|'stroll-claim'|'garden-upgrade'}
 |{type:'garden-plant';plot:number;crop:Crop}|{type:'garden-harvest';plot:number}
 |{type:'camp-cook';food:Food;count:1|5}|{type:'camp-sell';food:Food;all:boolean}
 |{type:'camp-supplies';trade:'flour'|'gel'|'gel-all'|'ore'}
 |{type:'companion-recruit'|'companion-equip'|'companion-feed';companion:Companion}
 |{type:'collection-claim';id:string};
export const initialLeisure=():Leisure=>({journal:initialJournal(),materials:{herb:0,berry:0,mushroom:0,ore:0,tea:0,biscuit:0,soup:0,pumpkin:0,snowflower:0,pie:0,snowtea:0},plots:[null,null,null],gardenLevel:0,companions:{slime:0,guide:null,guard:null},active:'slime',run:null,cargo:{coins:0,xp:0,gel:0,ore:0},clears:[0,0,0,0,0],rooms:0,harvests:0,cooked:0,claimed:[]});
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
function shape(v:unknown,keys:string):asserts v is Record<string,unknown>{if(!record(v)||Object.keys(v).sort().join(' ')!==keys.split(' ').sort().join(' '))throw Error('悠游营地字段不匹配');}
function int(v:unknown,max=1e12,min=0):asserts v is number{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<min||v>max)throw Error('悠游营地数值无效');}
function member<T extends string>(v:unknown,values:Record<T,unknown>):v is T{return typeof v==='string'&&Object.hasOwn(values,v);}
export const companionLevel=(xp:number)=>1+[2,5,9,14].filter(n=>xp>=n).length;
export const companionNext=(xp:number)=>[2,5,9,14].find(n=>n>xp)??null;
export const hasCargo=(l:Leisure)=>Object.values(l.cargo).some(n=>n>0)||hasBondCargo(l);
export const leisureWork=(p:Profile)=>!!p.leisure.run||p.leisure.plots.some(plot=>plot!==null&&plot.due>p.tick);
export const roomTitle=(r:Stroll)=>r.bonds?.secret?SECRET_SITES[r.zone].stops[r.room]:LANDMARKS[r.zone][r.room];
export const COLLECTIONS=[
 {id:'first-trip',name:'初次远足',detail:'完成1趟冒险',coins:30,ore:2,ready:(l:Leisure)=>l.clears.some(n=>n>0)},
 {id:'green-fingers',name:'园艺小能手',detail:'收获3块成熟作物',coins:40,ore:2,ready:(l:Leisure)=>l.harvests>=3},
 {id:'camp-chef',name:'营地小厨',detail:'制作5份新食品',coins:50,ore:3,ready:(l:Leisure)=>l.cooked>=5},
 {id:'good-friend',name:'形影不离',detail:'培养一只Lv2伙伴',coins:60,ore:5,ready:(l:Leisure)=>Object.values(l.companions).some(n=>typeof n==='number'&&n>=2)},
 {id:'moon-path',name:'月泉来信',detail:'完成月泉矿洞',coins:80,ore:5,ready:(l:Leisure)=>l.clears[1]>0},
 {id:'star-path',name:'星光纪念',detail:'完成星落遗迹',coins:100,ore:10,ready:(l:Leisure)=>l.clears[2]>0},
 {id:'wind-path',name:'风送麦香',detail:'完成风铃麦田',coins:180,ore:15,ready:(l:Leisure)=>l.clears[3]>0},
 {id:'snow-path',name:'云顶钟鸣',detail:'完成霜灯雪境',coins:240,ore:20,ready:(l:Leisure)=>l.clears[4]>0},
 {id:'relic-hunter',name:'小小收藏家',detail:'找到5件不同遗物',coins:150,ore:12,ready:(l:Leisure)=>l.journal.relics.filter(n=>n>0).length>=5},
 {id:'relic-master',name:'星光满架',detail:'集齐15件遗物',coins:500,ore:35,ready:(l:Leisure)=>l.journal.relics.every(n=>n>0)},
 {id:'camp-builder',name:'篝火渐暖',detail:'完成3次营地建设',coins:180,ore:15,ready:(l:Leisure)=>Object.values(l.journal.buildings).reduce((a,b)=>a+b,0)>=3},
 {id:'camp-home',name:'远行者的家',detail:'三座营地建筑都达到Lv3',coins:1000,ore:80,ready:(l:Leisure)=>Object.values(l.journal.buildings).every(n=>n===3)},
 {id:'helping-hand',name:'旅人的好邻居',detail:'完成10份旅商委托',coins:250,ore:20,ready:(l:Leisure)=>l.journal.deliveries>=10},
 {id:'old-friend',name:'故地重游',detail:'任一地区完成25趟探索',coins:350,ore:25,ready:(l:Leisure)=>l.clears.some(n=>n>=25)},
] as const;
export function validateLeisure(raw:unknown,tick:number):asserts raw is Leisure {
 shape(raw,(record(raw)&&Object.hasOwn(raw,'bonds')?'bonds ':'')+'journal materials plots gardenLevel companions active run cargo clears rooms harvests cooked claimed');
 validateJournal(raw.journal);
 shape(raw.materials,Object.keys(MATERIALS).join(' '));for(const n of Object.values(raw.materials))int(n,9999);
 shape(raw.cargo,'coins xp gel ore');for(const n of Object.values(raw.cargo))int(n,1e6);
 int(raw.gardenLevel,2);int(raw.rooms);int(raw.harvests);int(raw.cooked);
 if(!Array.isArray(raw.clears)||raw.clears.length!==5)throw Error('冒险通关记录无效');for(const n of raw.clears)int(n);
 if(raw.clears.some((n,i)=>i>0&&n>0&&(raw.clears as number[])[i-1]===0))throw Error('冒险地点解锁无效');
 if(!Array.isArray(raw.plots)||raw.plots.length!==3)throw Error('花圃数量无效');for(const plot of raw.plots){if(plot===null)continue;shape(plot,'crop due');if(!member(plot.crop,CROPS))throw Error('作物无效');int(plot.due,1e15,1);}
 if(!record(raw.companions)||!['slime','guide','guard'].every(id=>Object.hasOwn(raw.companions as object,id))||Object.keys(raw.companions).some(id=>!member(id,COMPANIONS)))throw Error('伙伴记录无效');for(const n of Object.values(raw.companions))if(n!==null)int(n,14);
 if(raw.companions.slime===null||!member(raw.active,COMPANIONS)||typeof raw.companions[raw.active]!=='number')throw Error('带队伙伴无效');
 if(!Array.isArray(raw.claimed)||new Set(raw.claimed).size!==raw.claimed.length||raw.claimed.some(id=>!COLLECTIONS.some(c=>c.id===id)))throw Error('收藏奖励记录无效');
 if(raw.run!==null){const r=raw.run;shape(r,'id zone route room remaining total due duration assistReady companion level depth coinBonus oreBonus dustBonus'+(record(r)&&Object.hasOwn(r,'bonds')?' bonds':''));if(Object.hasOwn(r,'bonds')){validateBondSnapshot(r.bonds,raw as unknown as Leisure);const snapshot=r.bonds as BondSnapshot;if(!record(raw.bonds)||snapshot.support===r.companion||snapshot.support!==raw.bonds.support||r.companion!==raw.active)throw Error('探索队伍快照与营地配置不一致');}
  if(typeof r.id!=='string'||!/^stroll-[0-9]+$/.test(r.id)||!member(r.route,ROUTES)||!member(r.companion,COMPANIONS)||typeof raw.companions[r.companion]!=='number')throw Error('悠游队伍无效');
  int(r.zone,4);int(r.room,5);int(r.remaining,6,1);if(r.total!==1&&r.total!==3&&r.total!==6)throw Error('冒险趟数无效');if(r.remaining>r.total)throw Error('冒险剩余趟数无效');
  int(r.due,1e15,tick+1);int(r.assistReady,1e15);int(r.duration,(r.bonds as BondSnapshot|undefined)?.secret?2100:1400,100);int(r.depth,2);int(r.coinBonus,15);int(r.oreBonus,15);int(r.dustBonus,3);int(r.level,5,1);
  if(r.zone>0&&raw.clears[r.zone-1]===0)throw Error('冒险地点尚未解锁');
 }
 if(Object.hasOwn(raw,'bonds'))validateBonds(raw.bonds,raw as unknown as Leisure);
}
export function parseLeisureAction(v:Record<string,unknown>):LeisureAction|null{
 if(typeof v.type!=='string')return null;const bond=parseBondAction(v);if(bond)return bond;const world=parseWorldAction(v);if(world)return world;
 if(['stroll-return','stroll-claim','garden-upgrade'].includes(v.type)){shape(v,'type');return v as LeisureAction;}
 if(v.type==='stroll-start'){shape(v,'type zone route trips'+(Object.hasOwn(v,'depth')?' depth':'')+(Object.hasOwn(v,'secret')?' secret':''));if(Object.hasOwn(v,'secret')&&typeof v.secret!=='boolean')throw Error('探索模式无效');int(v.zone,4);if(v.depth!==undefined)int(v.depth,2);if(!member(v.route,ROUTES)||(v.trips!==1&&v.trips!==3&&v.trips!==6))throw Error('路线或趟数无效');return v as LeisureAction;}
 if(v.type==='stroll-assist'){shape(v,'type runId room remaining');if(typeof v.runId!=='string'||!/^stroll-[0-9]+$/.test(v.runId))throw Error('助阵目标无效');int(v.room,5);int(v.remaining,6,1);return v as LeisureAction;}
 if(v.type==='garden-plant'){shape(v,'type plot crop');int(v.plot,2);if(!member(v.crop,CROPS))throw Error('种子无效');return v as LeisureAction;}
 if(v.type==='garden-harvest'){shape(v,'type plot');int(v.plot,2);return v as LeisureAction;}
 if(v.type==='camp-cook'){shape(v,'type food count');if(!member(v.food,FOODS)||(v.count!==1&&v.count!==5))throw Error('配方或数量无效');return v as LeisureAction;}
 if(v.type==='camp-sell'){shape(v,'type food all');if(!member(v.food,FOODS)||typeof v.all!=='boolean')throw Error('交易物品无效');return v as LeisureAction;}
 if(v.type==='camp-supplies'){shape(v,'type trade');if(!['flour','gel','gel-all','ore'].includes(String(v.trade))||typeof v.trade!=='string')throw Error('旅商补给无效');return v as LeisureAction;}
 if(['companion-recruit','companion-equip','companion-feed'].includes(v.type)){shape(v,'type companion');if(!member(v.companion,COMPANIONS))throw Error('伙伴无效');return v as LeisureAction;}
 if(v.type==='collection-claim'){shape(v,'type id');if(typeof v.id!=='string'||!COLLECTIONS.some(c=>c.id===v.id))throw Error('收藏目标无效');return v as LeisureAction;}
 return null;
}
function checkCoins(p:Profile,coins:number):string{return p.coins+coins>1e9?'金币已满，请先消费。':'';}
export function leisureReason(p:Profile,a:LeisureAction):string{
 const l=p.leisure;const bond=parseBondAction(a);if(bond)return bondReason(p,bond);if(a.type==='camp-build'||a.type==='relic-upgrade'||a.type==='camp-deliver')return worldReason(p,a);
 switch(a.type){
  case 'stroll-start':if((l.active==='slime'||l.bonds?.support==='slime')&&p.pets?.role==='expedition')return '苔团子已选择挂机职责，请在宠物页切回休闲职责再参与悠游。';if(buddyJob(p,l.active))return '领队正在岗位帮忙，先撤岗。';if(l.run)return '伙伴正在冒险。';if(p.run)return '请先结算远征之门的挂机任务。';if(hasCargo(l))return '先领取上趟战利品。';if(a.zone>0&&!l.clears[a.zone-1])return '先完成前一个地点。';if(a.trips===6&&l.journal.buildings.lodge<3)return '旅人小屋Lv3后可连走六趟。';if(a.secret){const reason=secretReason(p,a.zone);if(reason)return reason;}return depthReason(p,a.zone,a.depth??0);
  case 'stroll-assist':if(!l.run||l.run.id!==a.runId||l.run.room!==a.room||l.run.remaining!==a.remaining)return '遭遇已经变化。';if(p.tick<l.run.assistReady)return `还需${Math.ceil((l.run.assistReady-p.tick)/10)}秒。`;break;
  case 'stroll-return':if(!l.run)return '没有进行中的冒险。';break;
  case 'stroll-claim':if(!hasCargo(l))return '战利品箱还是空的。';if(bondClaimReason(l))return bondClaimReason(l);if(checkCoins(p,l.cargo.coins)||p.xp+l.cargo.xp>1e12)return '金币或经验已满，战利品保留。';if(l.cargo.gel>0&&p.bag.gel+(p.run?.loot??0)+l.cargo.gel>(p.run?100:leisureGelCapacity(p)))return '凝胶空间不足，先制作或出售；战利品保留。';if(l.materials.ore+l.cargo.ore>9999)return '月纹石空间不足，先扩建、招募或出售。';break;
  case 'garden-plant':if(CROPS[a.crop].unlock>=0&&!l.clears[CROPS[a.crop].unlock])return '探索对应地区后获得种子。';if(l.plots[a.plot])return '这块地已有作物。';if(p.coins<CROPS[a.crop].seed)return '购买种子的金币不足。';break;
  case 'garden-harvest':{const plot=l.plots[a.plot];if(!plot)return '这块地尚未种植。';if(p.tick<plot.due)return '作物还在生长。';if(l.materials[plot.crop]+CROPS[plot.crop].yield+l.gardenLevel+jobPower(p,'garden')>9999)return '作物背包已满，请先制作食品。';break;}
  case 'garden-upgrade':{if(l.gardenLevel===2)return '花圃已满级。';const n=l.gardenLevel;if(p.coins<[40,120][n]||l.materials.ore<[5,12][n])return `需要${[40,120][n]}金币、${[5,12][n]}月纹石。`;break;}
  case 'camp-cook':return foodQueueReason(p,a.food,a.count);
  case 'camp-sell':{const n=a.all?l.materials[a.food]:1;if(!n||l.materials[a.food]<n)return '没有可出售的食品。';return checkCoins(p,foodPrice(p,FOODS[a.food].price)*n);}
  case 'camp-supplies':if(a.trade==='flour'){if(p.coins<10*ITEMS.flour.buy)return '金币不足。';if(p.bag.flour>1e6-10)return '面粉空间不足。';}else if(a.trade==='ore'){if(l.materials.ore<10)return '需要10份月纹石。';return checkCoins(p,20);}else{const n=a.trade==='gel-all'?p.bag.gel:5;if(n<1||p.bag.gel<n)return '没有足够的凝胶。';return checkCoins(p,n*ITEMS.gel.sell);}break;
  case 'companion-recruit':{const c=COMPANIONS[a.companion];if(buddyXP(l,a.companion)!==null)return '伙伴已经加入。';if(c.unlock>=0&&!l.clears[c.unlock])return '先完成对应地点。';if(p.coins<c.coins||l.materials.ore<c.ore)return `需要${c.coins}金币、${c.ore}月纹石。`;break;}
  case 'companion-equip':if(buddyJob(p,a.companion))return '这位伙伴正在岗位帮忙，先撤岗。';if(buddyXP(l,a.companion)===null)return '先邀请这位伙伴。';if(l.run)return '这趟结束后再换带队伙伴。';if(l.active===a.companion)return '这位伙伴已经在带队。';break;
  case 'companion-feed':if(buddyXP(l,a.companion)===null)return '先邀请这位伙伴。';if(buddyXP(l,a.companion)===14)return '伙伴已到Lv5。';if(l.materials.biscuit<1)return '需要1份莓果饼。';break;
  case 'collection-claim':{const c=COLLECTIONS.find(c=>c.id===a.id)!;if(l.claimed.includes(a.id))return '纪念奖励已领取。';if(!c.ready(l))return c.detail;if(l.materials.ore+c.ore>9999)return '月纹石空间不足。';return checkCoins(p,c.coins);}
 }
 return '';
}
const earn=(p:Profile,n:number)=>{p.coins+=n;p.totals.earned=Math.min(1e12,p.totals.earned+n);};
export function applyLeisure(p:Profile,a:LeisureAction):void{
 const reason=leisureReason(p,a);if(reason)throw Error(reason);const l=p.leisure;const bond=parseBondAction(a);if(bond){applyBond(p,bond);return;}if(a.type==='camp-build'||a.type==='relic-upgrade'||a.type==='camp-deliver'){applyWorld(p,a);return;}
 switch(a.type){
  case 'stroll-start':{const level=companionLevel(buddyXP(l,l.active)!),depth=a.depth??0,enabled=Object.hasOwn(a,'secret')||!!l.bonds,duration=enabled?bondDuration(p,DESTINATIONS[a.zone].ticks,level,depth,!!a.secret):strollDuration(p,DESTINATIONS[a.zone].ticks,level,depth),bonus=relicBonuses(p);l.run={id:'stroll-'+(p.sequence+1),zone:a.zone,route:a.route,room:0,remaining:a.trips,total:a.trips,due:p.tick+duration,duration,assistReady:p.tick,companion:l.active,level,depth,coinBonus:bonus.coins,oreBonus:bonus.ore,dustBonus:l.journal.buildings.archive,...(enabled?{bonds:bondSnapshot(p,a.route,!!a.secret)}:{})};if(enabled)ensureBonds(l);p.notice='伙伴出发了，关闭窗口也会自动探索。';break;}
  case 'stroll-assist':l.run!.due=Math.max(p.tick+1,l.run!.due-30);l.run!.assistReady=p.tick+150;p.notice='鼓劲成功，伙伴加快了脚步。';break;
  case 'stroll-return':l.run=null;p.notice='伙伴已回营，已获得的战利品保留在箱中。';break;
  case 'stroll-claim':claimBonds(l);earn(p,l.cargo.coins);p.xp+=l.cargo.xp;p.bag.gel+=l.cargo.gel;l.materials.ore+=l.cargo.ore;l.cargo={coins:0,xp:0,gel:0,ore:0};p.notice='战利品已收入背包。';break;
  case 'garden-plant':p.coins-=CROPS[a.crop].seed;l.plots[a.plot]={crop:a.crop,due:p.tick+CROPS[a.crop].ticks};p.notice=`种下${CROPS[a.crop].name}。`;break;
  case 'garden-harvest':{const plot=l.plots[a.plot]!;l.materials[plot.crop]+=CROPS[plot.crop].yield+l.gardenLevel+jobPower(p,'garden');l.plots[a.plot]=null;l.harvests=Math.min(1e12,l.harvests+1);p.notice='收获完成，成熟作物不会枯萎。';break;}
  case 'garden-upgrade':{const n=l.gardenLevel;p.coins-=[40,120][n];l.materials.ore-=[5,12][n];l.gardenLevel++;p.notice='花圃扩建完成，每块地产量增加1份。';break;}
  case 'camp-cook':queueFood(p,a.food,a.count);break;
  case 'camp-sell':{const n=a.all?l.materials[a.food]:1;l.materials[a.food]-=n;earn(p,n*foodPrice(p,FOODS[a.food].price));p.totals.sold=Math.min(1e12,p.totals.sold+n);p.notice=`旅商买走${n}份${FOODS[a.food].name}。`;break;}
  case 'camp-supplies':if(a.trade==='flour'){p.coins-=10*ITEMS.flour.buy;p.bag.flour+=10;p.notice='向旅商购入10份面粉。';}else if(a.trade==='ore'){l.materials.ore-=10;earn(p,20);p.notice='向旅商出售10份月纹石。';}else{const n=a.trade==='gel-all'?p.bag.gel:5;p.bag.gel-=n;earn(p,n*ITEMS.gel.sell);p.notice=`向旅商出售${n}份凝胶。`;}break;
  case 'companion-recruit':{const c=COMPANIONS[a.companion];p.coins-=c.coins;l.materials.ore-=c.ore;l.companions[a.companion]=0;if(Object.hasOwn(NEW_COMPANIONS,a.companion))ensureBonds(l);p.notice=`${c.name}加入营地。`;break;}
  case 'companion-equip':if(l.bonds?.support===a.companion)l.bonds.support=null;l.active=a.companion;p.notice=`下趟由${COMPANIONS[a.companion].name}带队。`;break;
  case 'companion-feed':l.materials.biscuit--;l.companions[a.companion]=(buddyXP(l,a.companion)??0)+1;p.notice=`${COMPANIONS[a.companion].name}很喜欢莓果饼；成长会在下趟冒险生效。`;break;
  case 'collection-claim':{const c=COLLECTIONS.find(c=>c.id===a.id)!;l.claimed.push(a.id);earn(p,c.coins);l.materials.ore+=c.ore;p.notice=`收下了“${c.name}”的纪念奖励。`;break;}
 }
}
export function stepLeisure(p:Profile):void{
 const l=p.leisure,r=l.run;if(!r||p.tick<r.due)return;
 const boss=r.room===5?2:1,z=r.zone+1,mult=DEPTHS[r.depth].reward;
 l.cargo.coins+=(4*z+(r.route==='treasure'?6:0)+(r.companion==='guide'?3:0)+r.coinBonus)*boss*mult;
 l.cargo.xp+=(3*z+(r.route==='balanced'?2:0))*boss*mult;
 l.cargo.gel+=(1+(r.route==='gather'?1:0)+(r.companion==='slime'?1:0))*boss;
 l.cargo.ore+=(z+(r.route==='gather'?1:0)+(r.companion==='guard'?1:0))*boss*mult+(r.room===5?r.oreBonus:0);
 settleBondRoom(p,r);
 l.rooms=Math.min(1e12,l.rooms+1);
 if(r.room===5){l.clears[r.zone]=Math.min(1e12,l.clears[r.zone]+1);discoverRelic(p,r.zone,r.depth);settleBondTrip(p,r);l.journal.dust=Math.min(9999,l.journal.dust+r.dustBonus);r.remaining--;if(!r.remaining){l.run=null;p.notice='伙伴带着战利品和探索纪念回来了。';return;}r.room=0;}else r.room++;
 r.due=p.tick+r.duration;
}

// Schema 6 is the frozen 0.5.2 subtree. Validate its shape before adding new defaults.
export function migrateLeisureV6(raw:unknown,tick:number):Leisure {
 shape(raw,'materials plots gardenLevel companions active run cargo clears rooms harvests cooked claimed');
 shape(raw.materials,'herb berry mushroom ore tea biscuit soup');
 if(!Array.isArray(raw.clears)||raw.clears.length!==3)throw Error('旧版冒险记录无效');
 let run=raw.run;if(run!==null){shape(run,'id zone route room remaining total due duration assistReady companion level');int(run.zone,2);int(run.duration,600,160);if(run.total!==1&&run.total!==3)throw Error('旧版趟数无效');run={...run,depth:0,coinBonus:0,oreBonus:0,dustBonus:0};}
 const l={...structuredClone(raw),journal:initialJournal(),materials:{...structuredClone(raw.materials),pumpkin:0,snowflower:0,pie:0,snowtea:0},clears:[...raw.clears,0,0],run};
 validateLeisure(l,tick);return l;
}
