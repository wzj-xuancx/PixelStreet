import type {Profile} from './index';
import {COMPANIONS,FOODS,type Companion,type Food} from './leisure';
import {buddyXP} from './bonds';
import {campOf,foodTicks,cookingPending} from './camp-life';
import {FORMULAS,GOOD_IDS,changeReagent,initialAtelier,atelierOf,formulaReason,atelierTicks,atelierShelfLimit,reagentCount,reagentSpace,refundReserve,queuedGood,QUOTES,type Good,type Reagent} from './atelier';

export type ProjectId='teahouse'|'greenhouse'|'market';
export type RegularId='miner'|'herbalist'|'merchant';
export type CareActivity='tea'|'garden'|'read';
export type PlanStation='kitchen'|'supply'|'alchemy';
export type PlanItem=Food|Good;
export const PROJECTS={teahouse:{name:'林间茶座',stages:['木台初搭','暖茶长桌','萤灯茶庭'],benefit:'每阶使常客回礼增加2金币'},greenhouse:{name:'萤光温室',stages:['育苗棚架','萤光花房','四季温室'],benefit:'每阶使常客回礼增加1月纹石'},market:{name:'旅人集市',stages:['旅人货摊','林间小街','星灯集市'],benefit:'每阶使常客回礼增加3金币'}} as const;
export const PROJECT_IDS=Object.keys(PROJECTS) as ProjectId[];
export const REGULARS={miner:{name:'阿砾',role:'矿工',stories:['在洞口歇脚时，总想念一口热汤。','我替茶座找了几块平整的石板。','这里的灯亮着，回家的路就不远。'],gifts:['矿灯石牌','月纹茶垫','归途灯盏']},herbalist:{name:'露芽',role:'采药人',stories:['我想看看营地里会开出什么花。','新温室的窗边，适合放一束晨露草。','每次回营，都像回到自己照料的花园。'],gifts:['晨露书签','萤光花瓶','四季花环']},merchant:{name:'米洛',role:'旅行商人',stories:['下一站之前，先在这里坐一会儿。','我把这条热闹的小街记在了地图上。','走过许多地方，还是惦记这张茶桌。'],gifts:['旅人铜铃','手绘街图','星灯商旗']}} as const;
export const REGULAR_IDS=Object.keys(REGULARS) as RegularId[];
export const CARE_ACTIVITIES={tea:'一起喝茶',garden:'照看花草',read:'翻阅游记'} as const;
export const CARE_RESPONSES:Record<Companion,Record<CareActivity,string>>={
 slime:{tea:'苔团子贴着温暖的杯壁，晃出了一个小泡泡。',garden:'苔团子蹭了蹭泥土，认真护着新芽。',read:'苔团子趴在地图边，给去过的地方留了一点苔印。'},
 guide:{tea:'提灯旅人把灯放在桌边，说起路上遇见的晚霞。',garden:'提灯旅人替细弱的花茎搭好一根支架。',read:'提灯旅人圈出一条小径：下次我们一起去。'},
 guard:{tea:'林地守卫终于卸下戒备，慢慢喝完一杯热茶。',garden:'林地守卫替花圃修好篱笆，点点头说很结实。',read:'林地守卫指着古堡插画，讲起一次守望。'},
 fox:{tea:'灯尾狐转了转茶杯，夸这里比商道上的茶香。',garden:'灯尾狐悄悄把最好看的花留在了窗边。',read:'灯尾狐数着地图上的集市，讲了一桩有趣生意。'},
 deer:{tea:'月角鹿望着茶中倒影，角尖轻轻亮了起来。',garden:'月角鹿听了听叶片的声音，找到了最合适的阳光。',read:'月角鹿翻到植物图鉴，把熟悉的草药指给你看。'},
 otter:{tea:'泡泡水獭吹着茶面，差点吹出一串水泡。',garden:'泡泡水獭搬来一小桶清水，给花圃浇得刚刚好。',read:'泡泡水獭找遍河流插画，说最喜欢有桥的那页。'},
 owl:{tea:'星页鸮闭眼闻了闻茶香，羽毛终于放松下来。',garden:'星页鸮为每株小苗写了整齐的小木牌。',read:'星页鸮展开书页，与你读了一段失落的古老故事。'},
 bear:{tea:'蜜糖熊端出一点甜香，问你茶里要不要加一勺。',garden:'蜜糖熊小心扶起幼苗，生怕宽大的手掌碰坏叶子。',read:'蜜糖熊停在点心插画那页，认真记住了做法。'},
 bird:{tea:'霜羽雀站在杯沿，清脆地唱了一小段雪境旋律。',garden:'霜羽雀替花圃衔走一根枯枝，又带回细软的绒草。',read:'霜羽雀看见极光那页，兴奋地扑了扑翅膀。'},
};
export const CARE_COOLDOWN=6000;
export const RELATION_THRESHOLDS=[3,7,12] as const;
export const PLAN_STATIONS:PlanStation[]=['kitchen','supply','alchemy'];
export interface VillagePlan {id:number;item:PlanItem;count:10|20|30;remaining:number;produced:number;reserve:0|5|10;sell:boolean;due:number}
export interface Village {version:1;projects:Record<ProjectId,number>;regulars:Record<RegularId,{served:number;nextAt:number;gifts:number}>;life:Record<Companion,{visits:number;nextAt:number}>;plans:Record<PlanStation,VillagePlan|null>}
export type VillageAction={type:'village-build';project:ProjectId;stage:number}|{type:'village-serve';regular:RegularId;revision:number}|{type:'village-gift';regular:RegularId;tier:number}|{type:'village-care';companion:Companion;activity:CareActivity;visits:number}|{type:'village-plan';station:PlanStation;item:PlanItem;count:10|20|30;reserve:0|5|10;sell:boolean}|{type:'village-plan-stop';station:PlanStation;id:number};
export const initialVillage=():Village=>({version:1,projects:{teahouse:0,greenhouse:0,market:0},regulars:{miner:{served:0,nextAt:0,gifts:0},herbalist:{served:0,nextAt:0,gifts:0},merchant:{served:0,nextAt:0,gifts:0}},life:Object.fromEntries(Object.keys(COMPANIONS).map(id=>[id,{visits:0,nextAt:0}])) as Village['life'],plans:{kitchen:null,supply:null,alchemy:null}});
export const villageOf=(p:Profile):Village=>p.village??initialVillage();
const ensure=(p:Profile)=>p.village??(p.village=initialVillage());
export const villagePlanActive=(p:Profile,s:PlanStation)=>!!p.village?.plans[s]?.remaining;
const earned=(p:Profile,n:number)=>{p.coins+=n;p.totals.earned=Math.min(1e12,p.totals.earned+n);};
const foodCost=(id:Food):Partial<Record<Reagent,number>>=>({...FOODS[id].materials,...(FOODS[id].flour?{flour:FOODS[id].flour}:{}),...(FOODS[id].gel?{gel:FOODS[id].gel}:{})});
const costs=(s:PlanStation,id:PlanItem)=>s==='kitchen'?foodCost(id as Food):FORMULAS[id as Good].cost;
export function villageRefundReserve(p:Profile,r:Reagent):number{return p.village?PLAN_STATIONS.reduce((n,s)=>{const q=p.village!.plans[s];return n+(q&&q.due?(costs(s,q.item)[r]??0):0);},0):0;}
export function villageShelfReserve(p:Profile):number{return p.village?(['supply','alchemy'] as const).reduce((n,s)=>{const q=p.village!.plans[s];return n+(q&&q.due&&q.sell&&q.produced>=q.reserve?1:0);},0):0;}
export function villageOutputReserve(p:Profile,r:Reagent):number{const q=p.village?.plans.kitchen;return q&&q.due&&q.item===r?1:0;}
const craftTotal=(p:Profile)=>p.totals.crafted+p.leisure.cooked+Object.values(atelierOf(p).made).reduce((a,b)=>a+b,0);
const servedTotal=(p:Profile)=>Object.values(villageOf(p).regulars).reduce((n,r)=>n+r.served,0);
const careTotal=(p:Profile)=>Object.values(villageOf(p).life).reduce((n,r)=>n+r.visits,0);
export function projectView(p:Profile,id:ProjectId){const v=villageOf(p),stage=v.projects[id],i=PROJECT_IDS.indexOf(id),complete=stage===3,unlocked=i===0||v.projects[PROJECT_IDS[i-1]]===3;
 const coins=complete?0:([20,60,140][stage]*(i+1));
 const cost:Partial<Record<Reagent,number>>=complete?{}:{ore:[2,6,12][stage]*(i+1),...(id==='teahouse'?{herb:[2,6,12][stage]}:id==='greenhouse'?{berry:[3,8,15][stage]}:{flour:[5,12,25][stage]})};
 const requirements=complete?[]:[{label:'累计探索房间',have:p.leisure.rooms,need:([0,6,18][stage]*(i+1))},{label:'累计收获',have:p.leisure.harvests,need:[0,2,5][stage]+i*2},{label:'累计制作',have:craftTotal(p),need:[0,3,8][stage]+i*4},{label:'接待常客',have:servedTotal(p),need:[0,2,5][stage]+i*3},{label:'伙伴陪伴',have:careTotal(p),need:[0,2,5][stage]+i*3}];
 let reason=complete?'建设已完成。':!unlocked?'先完成上一处建设。':p.job!=='keeper'?'先完成补给店任职试餐。':p.coins<coins?'建设金币不足。':Object.entries(cost).some(([r,n])=>reagentCount(p,r as Reagent)<n!)?'建设材料不足。':requirements.some(r=>r.have<r.need)?'还需完成托盘列出的营地经历。':'';
 return{id,name:PROJECTS[id].name,stage,stageName:complete?PROJECTS[id].stages[2]:PROJECTS[id].stages[stage],complete,unlocked,coins,cost,requirements,benefit:PROJECTS[id].benefit,reason};}
const requests:Record<RegularId,Array<[Reagent,number]>>={miner:[['tea',1],['biscuit',1],['soup',1]],herbalist:[['herb',3],['tea',1],['berry',3]],merchant:[['biscuit',1],['flour',4],['tea',1]]};
export function regularOffer(p:Profile,id:RegularId){const v=villageOf(p),r=v.regulars[id],[item,count]=requests[id][r.served%3],coins=[16,12,20][REGULAR_IDS.indexOf(id)]+v.projects.teahouse*2+v.projects.market*3,ore=1+v.projects.greenhouse,wait=Math.max(0,Math.ceil((r.nextAt-p.tick)/10));
 const reason=p.job!=='keeper'?'先完成补给店任职试餐。':wait?`常客还在旅途中，约${wait}秒后回来。`:r.served>=1e9?'接待记录已满。':reagentCount(p,item)<count?'准备好客人托盘中的物品。':p.coins+coins>1e9||reagentSpace(p,'ore')<ore+refundReserve(p,'ore')?'回礼空间不足，订单保留。':'';
 return{id,name:REGULARS[id].name,role:REGULARS[id].role,revision:r.served,item,count,coins,ore,served:r.served,nextAt:r.nextAt,wait,story:REGULARS[id].stories[r.served>=12?2:r.served>=3?1:0],gifts:r.gifts,reason};}
export function careView(p:Profile,id:Companion,activity:CareActivity='tea'){const r=villageOf(p).life[id],xp=buddyXP(p.leisure,id),wait=Math.max(0,Math.ceil((r.nextAt-p.tick)/10)),run=p.leisure.run,away=run&&(run.companion===id||run.bonds?.support===id)||p.expedition?.active?.crew===id;
 const response=CARE_RESPONSES[id][activity];
 return{companion:id,name:COMPANIONS[id].name,activity,visits:r.visits,nextAt:r.nextAt,wait,xp,response,reason:xp===null?'先邀请这位伙伴。':away?'伙伴正在远行，回营后再相聚。':wait?`伙伴正在休息，约${wait}秒后再来。`:r.visits>=1e9?'陪伴记录已满。':''};}
const itemValid=(s:PlanStation,item:unknown):item is PlanItem=>typeof item==='string'&&(s==='kitchen'?Object.hasOwn(FOODS,item):GOOD_IDS.includes(item as Good)&&FORMULAS[item as Good].station===s);
function planBlock(p:Profile,s:PlanStation,q:VillagePlan):string {if(!q.remaining)return '';
 if(s==='kitchen'){if(p.leisure.materials[q.item as Food]+cookingPending(p,q.item as Food)>=9999)return '料理背包已满，安排等待整理。';}
 else {const a=atelierOf(p),g=q.item as Good;if(a.stock[g]+a.shelves[g].stock+queuedGood(a,g)>=9999)return '成品库存已满，安排等待整理。';if(q.sell&&q.produced>=q.reserve&&Object.values(a.shelves).reduce((n,v)=>n+v.stock,0)+(q.due?0:villageShelfReserve(p))>=atelierShelfLimit(a))return '特色货台已满，安排等待空位。';}
 if(!q.due&&Object.entries(costs(s,q.item)).some(([r,n])=>reagentCount(p,r as Reagent)<n!))return '材料不足，安排等待补充，不会自动采购。';
 return '';}
export const planView=(p:Profile,station:PlanStation)=>{const plan=villageOf(p).plans[station];return{station,plan,reason:plan?planBlock(p,station,plan):''};};
export function villageReason(p:Profile,a:VillageAction):string{
 if(a.type==='village-build'){if(villageOf(p).projects[a.project]!==a.stage)return '建设阶段已变化，请重新查看。';return projectView(p,a.project).reason;}
 if(a.type==='village-serve'){if(villageOf(p).regulars[a.regular].served!==a.revision)return '客人的请求已经变化。';return regularOffer(p,a.regular).reason;}
 if(a.type==='village-gift'){const r=villageOf(p).regulars[a.regular];if(r.gifts!==a.tier)return '这份纪念物已领取或尚未轮到。';if(r.served<RELATION_THRESHOLDS[a.tier])return `接待${RELATION_THRESHOLDS[a.tier]}次后收到。`;if(p.coins+30*(a.tier+1)>1e9||reagentSpace(p,'dust')<a.tier+1+refundReserve(p,'dust'))return '赠礼空间不足，纪念物保留。';return '';}
 if(a.type==='village-care'){if(villageOf(p).life[a.companion].visits!==a.visits)return '这次相聚已经记录，请重新查看。';return careView(p,a.companion,a.activity).reason;}
 if(a.type==='village-plan-stop'){const q=villageOf(p).plans[a.station];if(!q||q.id!==a.id)return '这份安排已变化。';if(q.due&&Object.entries(costs(a.station,q.item)).some(([r,n])=>reagentSpace(p,r as Reagent)<n!))return '退款材料空间不足，安排完整保留。';return '';}
 if(p.job!=='keeper')return '先完成补给店任职试餐。';if(villagePlanActive(p,a.station))return '本站已有安排，先停止原安排。';if(!itemValid(a.station,a.item))return '配方与工位不匹配。';if(a.station==='kitchen'){if(a.sell)return '营地料理只制作，不自动出售。';if(campOf(p).cooking.length)return '请先完成或取消原料理队列。';}
 else {const why=formulaReason(p,a.item as Good);if(why)return why;if(atelierOf(p).queues[a.station].length)return '请先完成或取消本站原队列。';if(campOf(p).stockPlans[a.station])return '请先停止本站原上架计划。';}
 return '';}
function startOne(p:Profile,s:PlanStation,q:VillagePlan){if(!q.remaining||q.due||planBlock(p,s,q))return;for(const[r,n]of Object.entries(costs(s,q.item)))changeReagent(p,r as Reagent,-n!);q.due=p.tick+(s==='kitchen'?foodTicks(p,q.item as Food):atelierTicks(atelierOf(p),q.item as Good,p));}
export function applyVillage(p:Profile,a:VillageAction){const why=villageReason(p,a);if(why)throw Error(why);const v=ensure(p);
 if(a.type==='village-build'){const x=projectView(p,a.project);p.coins-=x.coins;for(const[r,n]of Object.entries(x.cost))changeReagent(p,r as Reagent,-n!);v.projects[a.project]++;p.notice=`${PROJECTS[a.project].name} · ${PROJECTS[a.project].stages[a.stage]}建成了。`;}
 else if(a.type==='village-serve'){const x=regularOffer(p,a.regular);changeReagent(p,x.item,-x.count);earned(p,x.coins);changeReagent(p,'ore',x.ore);v.regulars[a.regular].served++;v.regulars[a.regular].nextAt=p.tick+CARE_COOLDOWN;p.notice=`${x.name}收下了物品，留下${x.coins}金币与${x.ore}月纹石。`;}
 else if(a.type==='village-gift'){v.regulars[a.regular].gifts++;earned(p,30*(a.tier+1));changeReagent(p,'dust',a.tier+1);p.notice=`珍藏了${REGULARS[a.regular].name}送来的“${REGULARS[a.regular].gifts[a.tier]}”。`;}
 else if(a.type==='village-care'){const r=v.life[a.companion];r.visits++;r.nextAt=p.tick+CARE_COOLDOWN;p.leisure.companions[a.companion]=Math.min(14,buddyXP(p.leisure,a.companion)!+1);p.notice=careView(p,a.companion,a.activity).response;}
 else if(a.type==='village-plan-stop'){const q=v.plans[a.station]!;if(q.due)for(const[r,n]of Object.entries(costs(a.station,q.item)))changeReagent(p,r as Reagent,n!);v.plans[a.station]=null;p.notice='安排已停止，未完成这一份的材料退回，已完成与已售商品保留。';}
 else {if(a.station!=='kitchen'&&!p.atelier)p.atelier=initialAtelier();const q:VillagePlan={id:p.sequence+1,item:a.item,count:a.count,remaining:a.count,produced:0,reserve:a.reserve,sell:a.sell,due:0};v.plans[a.station]=q;if(a.sell&&a.station!=='kitchen'&&!p.atelier!.open[a.station]){p.atelier!.open[a.station]=true;for(const g of GOOD_IDS.filter(g=>FORMULAS[g].station===a.station))p.atelier!.shelves[g].due=p.tick+QUOTES[p.atelier!.shelves[g].quote].ticks;}startOne(p,a.station,q);p.notice='有限经营已安排；仅消耗现有材料，完成后停止。';}
}
export function stepVillage(p:Profile){const v=p.village;if(!v)return;for(const s of PLAN_STATIONS){const q=v.plans[s];if(!q||!q.remaining)continue;if(q.due&&p.tick>=q.due&&!planBlock(p,s,q)){if(s==='kitchen'){p.leisure.materials[q.item as Food]++;p.leisure.cooked=Math.min(1e12,p.leisure.cooked+1);}else{const a=p.atelier!,g=q.item as Good;if(q.sell&&q.produced>=q.reserve){const shelf=a.shelves[g];if(!shelf.stock)shelf.due=p.tick+QUOTES[shelf.quote].ticks;shelf.stock++;}else a.stock[g]++;a.made[g]=Math.min(1e9,a.made[g]+1);}q.remaining--;q.produced++;q.due=0;p.notice=q.remaining?'经营安排完成一份，继续下一份。':'有限经营安排已全部完成。';}startOne(p,s,q);}}
export function villageWork(p:Profile){return !!p.village&&PLAN_STATIONS.some(s=>{const q=p.village!.plans[s];return !!q&&q.remaining>0&&!planBlock(p,s,q);});}
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
function shape(v:unknown,keys:string):asserts v is Record<string,unknown>{if(!obj(v)||Object.keys(v).sort().join(' ')!==keys.split(' ').sort().join(' '))throw Error('营地生活字段不匹配');}
function num(v:unknown,max:number,min=0):asserts v is number{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<min||v>max)throw Error('营地生活数值无效');}
const has=(v:unknown,o:object)=>typeof v==='string'&&Object.hasOwn(o,v);
export function parseVillageAction(v:Record<string,unknown>):VillageAction|null{if(typeof v.type!=='string'||!v.type.startsWith('village-'))return null;
 if(v.type==='village-build'){shape(v,'type project stage');if(!has(v.project,PROJECTS))throw Error('建设地点无效');num(v.stage,2);}
 else if(v.type==='village-serve'){shape(v,'type regular revision');if(!has(v.regular,REGULARS))throw Error('常客无效');num(v.revision,1e9);}
 else if(v.type==='village-gift'){shape(v,'type regular tier');if(!has(v.regular,REGULARS))throw Error('常客无效');num(v.tier,2);}
 else if(v.type==='village-care'){shape(v,'type companion activity visits');if(!has(v.companion,COMPANIONS)||!has(v.activity,CARE_ACTIVITIES))throw Error('伙伴生活活动无效');num(v.visits,1e9);}
 else if(v.type==='village-plan'){shape(v,'type station item count reserve sell');if(!PLAN_STATIONS.includes(v.station as PlanStation)||!itemValid(v.station as PlanStation,v.item)||![10,20,30].includes(v.count as number)||![0,5,10].includes(v.reserve as number)||typeof v.sell!=='boolean'||v.station==='kitchen'&&v.sell)throw Error('经营安排无效');}
 else if(v.type==='village-plan-stop'){shape(v,'type station id');if(!PLAN_STATIONS.includes(v.station as PlanStation))throw Error('经营工位无效');num(v.id,1e12,1);}
 else throw Error('未知营地生活操作');return v as VillageAction;
}
export function validateVillage(raw:unknown,p:Profile):asserts raw is Village{shape(raw,'version projects regulars life plans');if(raw.version!==1)throw Error('营地生活版本无效');shape(raw.projects,PROJECT_IDS.join(' '));for(const id of PROJECT_IDS){num(raw.projects[id],3);if(raw.projects[id]&&PROJECT_IDS.indexOf(id)>0&&raw.projects[PROJECT_IDS[PROJECT_IDS.indexOf(id)-1]]!==3)throw Error('建设顺序无效');}
 shape(raw.regulars,REGULAR_IDS.join(' '));for(const id of REGULAR_IDS){const r=raw.regulars[id];shape(r,'served nextAt gifts');num(r.served,1e9);num(r.nextAt,1e15);num(r.gifts,3);if(r.gifts&&r.served<RELATION_THRESHOLDS[r.gifts-1])throw Error('常客纪念未解锁');if(!r.served&&r.nextAt!==0)throw Error('常客时钟无效');}
 shape(raw.life,Object.keys(COMPANIONS).join(' '));for(const id of Object.keys(COMPANIONS) as Companion[]){const l=raw.life[id];shape(l,'visits nextAt');num(l.visits,1e9);num(l.nextAt,1e15);if(l.visits&&(buddyXP(p.leisure,id)===null)||!l.visits&&l.nextAt!==0)throw Error('伙伴生活记录无效');}
 shape(raw.plans,PLAN_STATIONS.join(' '));const ids=new Set<number>();for(const s of PLAN_STATIONS){const q=raw.plans[s];if(q===null)continue;shape(q,'id item count remaining produced reserve sell due');num(q.id,p.sequence,1);if(ids.has(q.id))throw Error('经营安排身份重复');ids.add(q.id);if(!itemValid(s,q.item)||![10,20,30].includes(q.count as number)||![0,5,10].includes(q.reserve as number)||typeof q.sell!=='boolean'||s==='kitchen'&&q.sell)throw Error('经营安排配方无效');num(q.remaining,30);num(q.produced,30);num(q.due,1e15);if(Number(q.remaining)+Number(q.produced)!==q.count||!q.remaining&&q.due!==0)throw Error('经营安排数量无效');if(p.job!=='keeper')throw Error('经营安排需正式任职');if(s==='kitchen'){if(q.remaining&&campOf(p).cooking.length)throw Error('料理生产冲突');}else{if(!p.atelier||formulaReason(p,q.item as Good))throw Error('经营配方尚未开放');if(q.remaining&&(p.atelier.queues[s].length||campOf(p).stockPlans[s]))throw Error('工坊生产冲突');}}
}
