import type {Profile} from './index';
import {hasExpeditionCargo} from './expedition';
import {pendingOutput} from './business';

/** Facts are written only by authoritative operations. Chapter lights never pay rewards. */
export interface Chapter {
 version:1;skipped:boolean;startedTick:number;prepared:boolean;
 eligibleRunId:string|null;wonRunId:string|null;returned:boolean;sold:boolean;collected:boolean;
}
export type ChapterAction={type:'chapter-start'|'chapter-skip'|'chapter-resume'};
export type ChapterStep='demo'|'apply'|'trial-craft'|'trial-wait'|'trial-deliver'|'coat-material'|'coat-craft'|'coat-wear'|'ration-material'|'ration-craft'|'ration-wait'|'depart'|'running'|'cargo'|'crystal-craft'|'crystal-wait'|'crystal-stock'|'open'|'sale-wait'|'collect'|'complete';
export type ChapterNodeId='prepare'|'win'|'return'|'sale';
export interface ChapterView {
 enrolled:boolean;skipped:boolean;step:ChapterStep;
 nodes:Array<{id:ChapterNodeId;title:string;done:boolean}>;
 target:'demo'|'shop'|'equipment'|'expedition'|'tower';reason:string;
}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
function shape(v:unknown,keys:string):asserts v is Record<string,unknown>{if(!object(v)||Object.keys(v).sort().join(' ')!==keys.split(' ').sort().join(' '))throw Error('引导章节字段无效');}
const runId=(v:unknown):v is string=>typeof v==='string'&&/^run-[0-9]{1,16}$/.test(v);
export function parseChapterAction(raw:Record<string,unknown>):ChapterAction|null {
 if(typeof raw.type!=='string'||!['chapter-start','chapter-skip','chapter-resume'].includes(raw.type))return null;
 shape(raw,'type');return raw as ChapterAction;
}
export function validateChapter(raw:unknown,p:Profile):asserts raw is Chapter {
 shape(raw,'version skipped startedTick prepared eligibleRunId wonRunId returned sold collected');
 if(raw.version!==1||typeof raw.skipped!=='boolean'||!Number.isSafeInteger(raw.startedTick)||Number(raw.startedTick)<0||Number(raw.startedTick)>p.tick||['prepared','returned','sold','collected'].some(k=>typeof raw[k]!=='boolean'))throw Error('引导章节状态无效');
 if(raw.eligibleRunId!==null&&(!runId(raw.eligibleRunId)||p.run?.id!==raw.eligibleRunId))throw Error('引导远征游标无效');
 if(raw.wonRunId!==null&&(!runId(raw.wonRunId)||!Number.isSafeInteger(Number(raw.wonRunId.slice(4)))||Number(raw.wonRunId.slice(4))<1||Number(raw.wonRunId.slice(4))>p.sequence))throw Error('引导初胜凭据无效');
 if(raw.prepared&&!p.equipment?.ownedIDs.includes('trail-coat'))throw Error('引导整备凭据无效');
 if(raw.wonRunId!==null&&!raw.prepared||raw.returned&&raw.wonRunId===null||raw.sold&&!raw.returned||raw.collected&&!raw.sold)throw Error('引导章节事实顺序无效');
 if(raw.wonRunId!==null&&!raw.returned&&(p.run?.id!==raw.wonRunId||raw.eligibleRunId!==raw.wonRunId))throw Error('引导回营凭据无效');
 if(raw.returned&&raw.eligibleRunId!==null)throw Error('引导回营游标未清理');
}
const coatWorn=(p:Profile)=>p.equipment?.slots.body==='trail-coat';
const initialChapter=(p:Profile):Chapter=>({version:1,skipped:false,startedTick:p.tick,prepared:coatWorn(p),eligibleRunId:null,wonRunId:null,returned:false,sold:false,collected:false});
export function applyChapter(p:Profile,a:ChapterAction):void {
 const c=p.chapter??=initialChapter(p);
 if(a.type==='chapter-skip')c.skipped=true;
 if(a.type==='chapter-resume')c.skipped=false;
 // Starting again is harmless and does not undo an explicit skip or rewrite facts.
}
export function recordChapterWear(p:Profile):void{if(p.chapter&&coatWorn(p))p.chapter.prepared=true;}
export function recordChapterDepart(p:Profile):void {
 const c=p.chapter;if(!c||c.returned||c.wonRunId!==null)return;
 c.eligibleRunId=p.run&&p.equipment?.active?.runId===p.run.id&&p.equipment.active.slots.body==='trail-coat'?p.run.id:null;
 if(c.eligibleRunId)c.prepared=true;
}
export function recordChapterWin(p:Profile):void {
 const c=p.chapter,r=p.run;if(!c||!r||c.wonRunId!==null||c.eligibleRunId!==r.id)return;
 if(p.equipment?.active?.runId===r.id&&p.equipment.active.slots.body==='trail-coat'){c.prepared=true;c.wonRunId=r.id;}
}
export function recordChapterReturn(p:Profile):void {
 const c=p.chapter,r=p.run;if(!c||!r)return;
 if(c.wonRunId===r.id&&c.eligibleRunId===r.id)c.returned=true;
 c.eligibleRunId=null;
}
export function recordChapterSale(p:Profile,recipe:string):void{if(p.chapter?.returned&&recipe==='crystal')p.chapter.sold=true;}
export function recordChapterCollect(p:Profile):void{if(p.chapter?.sold)p.chapter.collected=true;}
/** Existing saves require deliberate enrollment; inspecting them cannot install an extension. */
export function isFreshChapterCandidate(p:Profile):boolean {
 return !p.chapter&&p.sequence===0&&!p.tower&&!p.mastery&&!p.pets&&!p.camp&&!p.village&&!p.atelier&&p.leisure.rooms===0&&p.leisure.harvests===0&&p.leisure.cooked===0&&p.leisure.claimed.length===0&&p.leisure.clears.every(n=>n===0)&&Object.values(p.bag).every(n=>n===0)&&p.job==='visitor'&&!p.run&&!p.leisure.run&&p.totals.crafted===0&&p.totals.sold===0&&p.totals.earned===0&&p.totals.wins===0&&p.xp===0&&p.actionClaim===0&&!p.equipment?.ownedIDs.length&&!p.expedition?.trips&&!p.business.completed;
}
export function chapterView(p:Profile):ChapterView {
 const c=p.chapter;
 const nodes:ChapterView['nodes']=[{id:'prepare',title:'整备',done:c?.prepared??false},{id:'win',title:'初胜',done:c?.wonRunId!=null},{id:'return',title:'回礼',done:c?.returned??false},{id:'sale',title:'开张',done:c?.collected??false}];
 const view=(step:ChapterStep,target:ChapterView['target'],reason:string):ChapterView=>({enrolled:!!c,skipped:c?.skipped??false,step,nodes,target,reason});
 if(!c)return view('demo','demo','可体验短演示，或直接开始整备。');
 if(c.collected)return view('complete','tower','开张与初行已完成，可在塔中回看。');
 if(p.run)return view('running','expedition',c.eligibleRunId===p.run.id?'本趟穿戴快照已生效，按实际战况结算。':'当前远征照常进行；回营后穿好外套再出发。');
 if(!c.returned){
  if(p.job==='visitor')return view('apply','shop','应聘获赠面粉，试做后赚取工钱。');
  if(p.job==='apprentice'){
   if(p.bag.ration>0)return view('trial-deliver','shop','交付一份试餐，按原规则任职并领取30金币。');
   if(pendingOutput(p,'ration')>0)return view('trial-wait','shop','试餐正在制作，完成后交付。');
   return view('trial-craft','shop','用2面粉制作一份试餐，耗时6秒。');
  }
  if(!p.equipment?.ownedIDs.includes('trail-coat'))return p.bag.gel<2||p.coins<8?view('coat-material','shop','准备2凝胶与8金币；采购需要主动确认。'):view('coat-craft','equipment','制作旅途外套，消耗8金币与2凝胶。');
  if(!coatWorn(p))return view('coat-wear','equipment','主动穿戴旅途外套，下趟挂机受到的伤害降低1。');
  if(hasExpeditionCargo(p))return view('cargo','expedition','先整理上趟货箱，才可安排新的勘探。');
  if(p.bag.ration<3){
   if(pendingOutput(p,'ration')>0)return view('ration-wait','shop','等待口粮完成，备好3份再出发。');
   return p.bag.flour<6?view('ration-material','shop','先采购面粉，3份口粮共需6面粉。'):view('ration-craft','shop','制作3份旅行口粮，共需18秒。');
  }
  return view('depart','expedition','穿好外套、备3口粮，独行勘探；首趟默认关闭自动技能。');
 }
 if(hasExpeditionCargo(p))return view('cargo','expedition','金币经验已结算，凝胶已带回；货箱材料另行入库。');
 if(c.sold)return view('collect','shop','真实成交已记入钱箱，主动收取货款。');
 if(p.business.shelves.crystal.stock>0)return p.retail?view('sale-wait','shop','等待顾客真实购买魔晶餐，货款进入钱箱。'):view('open','shop','魔晶餐已上架，主动确认开店。');
 if(p.bag.crystal>0)return view('crystal-stock','shop','将一份魔晶餐上架，原价每份14金币。');
 if(pendingOutput(p,'crystal')>0)return view('crystal-wait','shop','魔晶餐正在制作，每份10秒。');
 return view('crystal-craft','shop',p.bag.gel<2||p.bag.flour<1?'准备1面粉与2凝胶，再制作一份魔晶餐。':'用1面粉与2凝胶制作一份魔晶餐，耗时10秒。');
}
