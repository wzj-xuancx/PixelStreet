import type {Profile} from './index';
import {companionLevel} from './leisure';
import {reagentSpace,refundReserve,type Reagent} from './atelier';

export type TowerTarget='supply'|'alchemy'|'dungeon'|'garden'|'companions'|'ledger'|'supply-job'|'supply-craft'|'supply-trade'|'supply-manage'|'supply-orders'|'alchemy-craft'|'alchemy-trade'|'kitchen'|'camp-growth'|'collection'|'village-projects';
export type TowerRewardItem='coins'|'flour'|'ore'|'biscuit';
export type TowerReward=Partial<Record<TowerRewardItem,number>>;
export interface Tower {version:1;claimed:number;progress:number[]}
export type TowerAction={type:'tower-claim';floor:number};
export type TowerStatus='locked'|'active'|'ready'|'claimed';
export interface TowerFloor {id:number;title:string;goal:string;detail:string;target:TowerTarget;metric:string;required:number;reward:TowerReward}
export const towerFloors:readonly TowerFloor[]=[
 {id:1,title:'街角第一步',goal:'成为补给店学徒',detail:'走进补给店，点击店员应聘。免费获赠的面粉足够完成试餐。',target:'supply-job',metric:'job',required:1,reward:{coins:3,flour:2}},
 {id:2,title:'第一炉香气',goal:'累计制作1份基础餐点',detail:'在补给店制作1份旅行口粮，等待炉火完成。',target:'supply-craft',metric:'crafted',required:1,reward:{coins:3}},
 {id:3,title:'挂上小围裙',goal:'正式任职补给店',detail:'把做好的1份旅行口粮交给店员完成试餐。',target:'supply-job',metric:'keeper',required:1,reward:{coins:4,flour:2}},
 {id:4,title:'第一位顾客',goal:'累计售出1件物品',detail:'把做好的餐点放上普通货架并开店，等待实际成交。旅商收购不计入本层。',target:'supply-manage',metric:'sold',required:1,reward:{coins:5}},
 {id:5,title:'林间脚印',goal:'伙伴累计探索1个遭遇',detail:'地牢之门内选择苔光庭院，开始悠闲漫游。关掉面板也会继续。',target:'dungeon',metric:'rooms',required:1,reward:{coins:5}},
 {id:6,title:'装进旅行袋',goal:'营地累计获得5点经验',detail:'探索后点击领取战利品，把经验收入营地。成就塔不发放经验。',target:'dungeon',metric:'xp',required:5,reward:{coins:5,ore:1}},
 {id:7,title:'庭院纪念',goal:'完成1趟苔光庭院',detail:'让伙伴走完整趟六个遭遇，找到古树守护者。',target:'dungeon',metric:'firstClear',required:1,reward:{coins:8,biscuit:2}},
 {id:8,title:'一起长大',goal:'任一伙伴达到Lv2',detail:'赠送两份莓果饼，或在伙伴生活里完成两次陪伴，即可从Lv1升至Lv2。',target:'companions',metric:'buddyLevel',required:2,reward:{coins:8}},
 {id:9,title:'泥土的回礼',goal:'累计收获1次作物',detail:'花圃种一份晨露草，成熟后点击收获；作物不会枯萎。',target:'garden',metric:'harvests',required:1,reward:{coins:8}},
 {id:10,title:'篝火小厨',goal:'累计制作1份营地料理',detail:'用2份晨露草安排一份花草茶，等料理完成。',target:'kitchen',metric:'cooked',required:1,reward:{coins:8}},
 {id:11,title:'工坊新手',goal:'累计完成1件特色调配品',detail:'补给特色餐盒或炼金调配任选其一，完成1份即可。',target:'alchemy-craft',metric:'atelierMade',required:1,reward:{coins:10,ore:1}},
 {id:12,title:'守信的小店',goal:'完成1份经营委托',detail:'补给店或特色工坊接取并交付一份委托。先看清材料与回报。',target:'supply-orders',metric:'orders',required:1,reward:{coins:10}},
 {id:13,title:'新朋友的灯',goal:'邀请第2位伙伴',detail:'完成庭院后，用积攒的金币与月纹石邀请提灯旅人，或其他伙伴。',target:'companions',metric:'recruits',required:1,reward:{coins:10,ore:1}},
 {id:14,title:'月泉来客',goal:'完成1趟月泉矿洞',detail:'前往第二个地区完成一趟普通探索，不需要选择更深难度。',target:'dungeon',metric:'secondClear',required:1,reward:{coins:12}},
 {id:15,title:'让篝火更暖',goal:'完成1级营地建筑',detail:'在营地选择旅人小屋、篝火厨房或观星收藏室，完成一级建设。',target:'camp-growth',metric:'buildings',required:1,reward:{coins:12,ore:1}},
 {id:16,title:'同行专长',goal:'任一伙伴完成一阶培养',detail:'伙伴同行3趟并达到Lv2后，选一条培养路线，备好所列材料再培养。',target:'companions',metric:'training',required:1,reward:{coins:12,biscuit:1}},
 {id:17,title:'收藏家的抽屉',goal:'发现3件不同永久遗物',detail:'普通探索每地前三趟各发现一件永久遗物，无需装备。前往第三地区也会补充收藏。',target:'collection',metric:'relics',required:3,reward:{coins:15,ore:1}},
 {id:18,title:'星光更远处',goal:'完成1趟星落遗迹',detail:'星落遗迹普通探索1趟；首次完成也会发现该地区永久遗物，计入第17层收藏。',target:'dungeon',metric:'thirdClear',required:1,reward:{coins:15}},
 {id:19,title:'自己的小生意',goal:'累计获得100金币',detail:'经营收款、探索与原有赠礼均计入。花掉金币不会倒退，塔奖励不计入。',target:'ledger',metric:'earned',required:100,reward:{coins:15}},
 {id:20,title:'村落灯火',goal:'完成1阶段村落建设',detail:'经营手账中为林间茶座搭好第一段木台，让营地留下自己的变化。',target:'village-projects',metric:'projects',required:1,reward:{coins:20,ore:1}},
];
export interface TowerFloorView extends TowerFloor {status:TowerStatus;progress:number;claimReason:string}
export interface TowerView {floors:TowerFloorView[];next:number|null;claimed:number;total:number}
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const int=(v:unknown,max:number):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0&&v<=max;
const sum=(values:number[])=>values.reduce((a,b)=>a+b,0);
// All sources describe permanent history, never current inventory, wallet, equipped crew or a toggle.
function observed(p:Profile):number[]{const l=p.leisure;return [p.job==='visitor'?0:1,p.totals.crafted,p.job==='keeper'?1:0,p.totals.sold,l.rooms,p.xp,l.clears[0],companionLevel(Math.max(0,...Object.values(l.companions).filter((v):v is number=>typeof v==='number'))),l.harvests,l.cooked,sum(Object.values(p.atelier?.made??{})),p.business.completed+sum(Object.values(p.atelier?.orders??{}).flat().map(o=>o.revision)),Math.max(0,Object.values(l.companions).filter(v=>typeof v==='number').length-1),l.clears[1],sum(Object.values(l.journal.buildings)),Math.max(0,...Object.values(l.bonds?.progress??{}).map(v=>v.rank)),l.journal.relics.filter(v=>v>0).length,l.clears[2],p.totals.earned,sum(Object.values(p.village?.projects??{}))];}
function progressOf(p:Profile):number[]{return observed(p).map((n,i)=>Math.min(towerFloors[i].required,Math.max(n,p.tower?.progress[i]??0)));}
export const towerOf=(p:Profile):Tower=>p.tower??{version:1,claimed:0,progress:progressOf(p)};
// Called after worker actions and settled simulation time. Pure reads and parse never create the extension.
export function observeTower(p:Profile):void {if(p.tower)p.tower.progress=progressOf(p);}
export function validateTower(v:unknown):asserts v is Tower {if(!record(v)||Object.keys(v).sort().join(' ')!=='claimed progress version'||v.version!==1||!int(v.claimed,towerFloors.length)||!Array.isArray(v.progress)||v.progress.length!==towerFloors.length)throw Error('成就之塔档案无效');for(let i=0;i<towerFloors.length;i++)if(!int(v.progress[i],towerFloors[i].required)||i<v.claimed&&v.progress[i]<towerFloors[i].required)throw Error('成就之塔进度无效');}
export function parseTowerAction(v:Record<string,unknown>):TowerAction|null {if(v.type!=='tower-claim')return null;if(Object.keys(v).sort().join(' ')!=='floor type'||!int(v.floor,towerFloors.length)||v.floor<1)throw Error('成就楼层无效');return {type:'tower-claim',floor:v.floor};}
export function towerClaimReason(p:Profile,floor:number):string {if(!int(floor,towerFloors.length)||floor<1)return '成就楼层无效。';const claimed=p.tower?.claimed??0;if(floor<=claimed)return '本层奖励已领取。';if(floor!==claimed+1)return '先领取前一层奖励。';const f=towerFloors[floor-1];if(progressOf(p)[floor-1]<f.required)return '尚未完成本层目标。';if(p.coins+(f.reward.coins??0)>1e9)return '金币空间不足，奖励保留。';for(const [item,n]of Object.entries(f.reward))if(item!=='coins'&&reagentSpace(p,item as Reagent)<n+refundReserve(p,item as Reagent))return '材料空间不足，奖励保留。';return '';}
export function towerView(p:Profile):TowerView {const progress=progressOf(p),claimed=p.tower?.claimed??0;return {claimed,total:towerFloors.length,next:claimed<towerFloors.length?claimed+1:null,floors:towerFloors.map((f,i)=>({...f,progress:progress[i],status:i<claimed?'claimed':i>claimed?'locked':progress[i]>=f.required?'ready':'active',claimReason:towerClaimReason(p,f.id)}))};}
export function towerNext(p:Profile):TowerFloorView|null {const v=towerView(p);return v.next===null?null:v.floors[v.next-1];}
export function applyTower(p:Profile,a:TowerAction):void {const reason=towerClaimReason(p,a.floor);if(reason)throw Error(reason);const f=towerFloors[a.floor-1];p.tower??={version:1,claimed:0,progress:progressOf(p)};observeTower(p);const t=p.tower;for(const [item,n]of Object.entries(f.reward)){if(item==='coins')p.coins+=n;else if(item==='flour')p.bag.flour+=n;else p.leisure.materials[item as 'ore'|'biscuit']+=n;}t.claimed++;p.notice=`成就之塔 · 第${f.id}层奖励已收下。`;}

// A floor resolves to one of these fixed UI selections. Renderers cannot request selectors or actions.
export const towerRouteChoices=['supply-specials','alchemy-craft','ordinary-orders','atelier-orders'] as const;
export type TowerRouteChoice=typeof towerRouteChoices[number];
export type TowerRouteContext={kind:'journey';zone:0|1|2;trips:1}|{kind:'atelier';station:'supply'|'alchemy';panel:'craft'|'sales'}|{kind:'training';buddy:import('./companions').Buddy};
export interface TowerDestination {target:TowerTarget;context?:TowerRouteContext;reason:string}
export const campTowerTargets:readonly TowerTarget[]=['dungeon','garden','companions','kitchen','camp-growth','collection','village-projects'];
export const towerRoomReason='请先离开好友房间，再前往地牢营地。';
export function towerDestination(p:Profile,floor:number,choice?:TowerRouteChoice):TowerDestination {
 if(!Number.isSafeInteger(floor)||floor<1||floor>20)throw Error('成就楼层无效。');
 if(choice!==undefined&&!(floor===11&&['supply-specials','alchemy-craft'].includes(choice)||floor===12&&['ordinary-orders','atelier-orders'].includes(choice)))throw Error('本层路线选项无效。');
 const target=towerFloors[floor-1].target;
 if([5,6,7,14,18].includes(floor)){
  const zone:0|1|2=floor===14?1:floor===18?2:0;
  return {target,context:{kind:'journey',zone,trips:1},reason:zone>0&&!p.leisure.clears[zone-1]?`完成${['苔光庭院','月泉矿洞'][zone-1]}后开放。`:''};
 }
 if(floor===11)return choice==='supply-specials'?{target:'supply',context:{kind:'atelier',station:'supply',panel:'craft'},reason:''}:{target:'alchemy-craft',context:{kind:'atelier',station:'alchemy',panel:'craft'},reason:''};
 if(floor===12&&choice==='atelier-orders')return {target:'alchemy',context:{kind:'atelier',station:'alchemy',panel:'sales'},reason:''};
 if(floor===16)return {target,context:{kind:'training',buddy:p.leisure.active},reason:''};
 return {target,reason:''};
}
/** Apply only while idle; a refused intent must never leave an old region armed for departure. */
export function towerJourneySelection(p:Profile,context:Extract<TowerRouteContext,{kind:'journey'}>):{selection?:{zone:0|1|2;trips:1;depth:0;secret:false};reason:string} {
 if(context.zone>0&&!p.leisure.clears[context.zone-1])return {reason:`完成${['苔光庭院','月泉矿洞'][context.zone-1]}后开放。`};
 if(p.leisure.run)return {reason:'当前探索进行中；回营后再选择目标地区的一趟普通探索。'};
 return {selection:{zone:context.zone,trips:1,depth:0,secret:false},reason:''};
}
