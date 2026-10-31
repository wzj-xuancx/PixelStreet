import {chapterView,transact,type ChapterStep,type GameAction,type Profile} from '../solo-core';
import {craftTicks,tradeQuote} from '../solo-core/business';
export type ChapterLocation='demo'|'shop'|'equipment'|'expedition'|'tower';
export type ChapterOperation='open'|'start'|'skip'|'resume'|'replay'|'perform'|'preview'|'cancel'|'more';
export type ChapterCommand={type:'chapter-demo-end';generation:number;session:number;outcome:'skip'|'defeated'}|{type:'chapter';generation:number;op:ChapterOperation}|{type:'chapter-confirm';generation:number;token:string};
export interface ChapterQuote {token:string;expiresAt:number;step:ChapterStep;label:string;coins:number;sequence:number}
export interface ChapterPresentation {location:ChapterLocation;replay:boolean;quote?:ChapterQuote;opening?:{session:number;phase:'playing'|'finished';outcome?:'skip'|'defeated'}}
export interface ChapterIntent {action?:GameAction;label:string;detail:string;purchase:boolean;reason:string;location:ChapterLocation}
/** The renderer never supplies an action, count, destination or price. */
export function chapterIntent(p:Profile,partySize=1):ChapterIntent {
 const v=chapterView(p),step=v.step;let action:GameAction|undefined,label='查看当前进度',detail=v.reason;
 switch(step){
 case 'apply':action={type:'apply-job'};label='应聘 · 领取4面粉';break;
 case 'trial-craft':action={type:'craft',recipe:'ration',count:1};label='制作1份试餐';break;
 case 'trial-deliver':action={type:'deliver-trial'};label='交付试餐 · 工钱30金';break;
 case 'coat-material':if(p.bag.gel<2){action={type:'trade',item:'gel',side:'buy',count:2};label=`购买2凝胶 · ${tradeQuote('gel','buy',2)}金`;}else label='准备8金币';break;
 case 'coat-craft':action={type:'equipment-craft',id:'trail-coat'};label='制作旅途外套';break;
 case 'coat-wear':action={type:'equipment-equip',id:'trail-coat'};label='穿戴旅途外套';break;
 case 'ration-material':action={type:'trade',item:'flour',side:'buy',count:10};label=`购买10面粉 · ${tradeQuote('flour','buy',10)}金`;break;
 case 'ration-craft':action={type:'queue-craft',recipe:'ration',count:3};label='制作3份旅行口粮';detail=`消耗6面粉 · ${craftTicks('ration',p.business)*3/10}秒`;break;
 case 'depart':action={type:'expedition-depart',region:0,mode:'survey',budget:3,crew:'none',meal:'none',auto:false};label='携3口粮 · 出发';break;
 case 'cargo':action={type:'expedition-claim'};label='货箱材料入库';break;
 case 'crystal-craft':action={type:'queue-craft',recipe:'crystal',count:1};label='制作1份魔晶餐';detail=`消耗1面粉＋2凝胶 · ${craftTicks('crystal',p.business)/10}秒`;break;
 case 'crystal-stock':action={type:'stock-shelf',recipe:'crystal',count:1};label='上架1份魔晶餐';break;
 case 'open':action={type:'retail',enabled:true};label='开店迎客';break;
 case 'collect':action={type:'collect-till'};label=`收取钱箱 · ${p.business.till}金`;break;
 case 'running':label='挂机中 · 查看战况';break;
 case 'complete':label='查看下一件装备';break;
 case 'trial-wait':case 'ration-wait':case 'crystal-wait':case 'sale-wait':label='等待实际完成';break;
 }
 let reason=step==='coat-material'&&p.bag.gel>=2?'制作外套需要8金币；可从更多界面继续经营补给。':'';if(action){try{transact(p,{sequence:p.sequence+1,requestId:'chapter-preview-validation',action},partySize);}catch(e){reason=e instanceof Error?e.message:String(e);}}
 return{action,label,detail,purchase:action?.type==='trade',reason,location:v.target};
}
export function chapterFingerprint(p:Profile):string {const i=chapterIntent(p),a=i.action;return JSON.stringify([p.sequence,chapterView(p).step,a,p.coins,p.job,a?.type==='trade'?p.bag[a.item]:null,a?.type==='trade'&&a.item==='gel'?p.run?.loot??0:null]);}
export function chapterGenerationAllowed(owner:string,generation:number,epoch:number,popup?:{kind:string;generation:number;suspended:boolean}|null):boolean {return owner==='popup'?!!popup&&!popup.suspended&&generation===popup.generation:['overlay','tower'].includes(owner)&&generation===epoch+1;}
