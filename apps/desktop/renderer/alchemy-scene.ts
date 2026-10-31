import {atelierOf, atelierReason, campOf, campLevel, COMPANIONS, FORMULAS, GOOD_IDS, type Good, type GameAction, stableAtelierOrder} from '../../../packages/solo-core';
import type {ShellState} from '../../../packages/protocol';
import {inventoryArt} from './inventory-art';
import {icon} from './icons';
import {bindLivingMotion} from './living-motion';

/** Targets are handled by popover's existing atelier/management workspace. */
export type AlchemyTarget='counter'|'supplies'|'craft'|'shelf'|'orders'|'specials'|'study'|'overview';
export interface AlchemySceneHooks {
 state:()=>ShellState; busy:()=>boolean;
 open:(target:string,slot?:number)=>void; dispatch:(action:GameAction)=>void;
}
const goods:Good[]=GOOD_IDS.filter(g=>FORMULAS[g].station==='alchemy');
const names=['观星学徒','药草商人','遗物修复师'];
const gSupply=(g:Good)=>g==='herbal-bandage'||g==='mining-tonic';
const art=(good:Good)=>`<span class="al-good" data-good="${good}" aria-hidden="true">${gSupply(good)?inventoryArt("atelier:"+good):""}</span>`;
const tag=(label:string,id?:string)=>`<span class="ls-tag"><strong>${label}</strong>${id?`<span id="${id}"></span>`:''}</span>`;
const obj=(id:string,label:string,content:string,extra:string)=>`<button type="button" id="${id}" class="game-button ls-object ${extra}" aria-label="${label}" data-tooltip="${label}">${content}</button>`;

export function alchemySceneMarkup():string {
 return `<section id="alchemyScene" class="living-scene alchemy-scene" data-room="alchemy" data-motion="paused" data-working="false" aria-label="水晶炼金工坊互动场景">
 <div class="ls-topline"><span class="ls-gold">${icon('gold')}<strong id="alCoins">—</strong></span><span id="alLevel"></span><button type="button" id="alOpen" class="game-button ls-sign" aria-label="切换炼金货台营业" data-tooltip="切换炼金货台营业">歇业中</button></div>
 <div class="ls-stage al-stage"><div class="ls-room al-room" aria-hidden="true"></div><div class="ls-light" aria-hidden="true"></div>
 <div class="al-bubbles" aria-hidden="true"><i></i><i></i><i></i></div>
 ${obj('alCounter','与炼金师交谈',`<span class="ls-person ls-clerk" data-person="2" aria-hidden="true"></span>${tag('炼金师','alRole')}`,'al-counter')}
 ${obj('alSupplies','采购炼金原料',`<span class="ls-item-art" data-item="gel" aria-hidden="true"></span>${tag('原料柜')}`,'al-supplies')}
 ${obj('alStill','查看炼金调配与排产',`${tag('调配台','alProduction')}`,'al-still')}
 ${obj('alShelf','查看炼金货架与定价',`<span class="al-shelf-goods" aria-hidden="true">${goods.map(g=>`<span class="al-shelf-unit" data-shelf-good="${g}" hidden>${art(g)}</span>`).join('')}</span>${tag('货架','alShelfCount')}`,'al-shelf')}
 ${obj('alStudy','查看设施研修和配方手记',`<span class="ls-item-art" data-item="ledger" aria-hidden="true"></span>${tag('研修手记','alFacility')}`,'al-study')}
 ${obj('alCollect','收取特色共用钱箱',`<span class="ls-item-art" data-item="cashbox" aria-hidden="true"></span>${tag('钱箱','alTill')}`,'al-cashbox')}
 <button type="button" id="alBuddy" class="game-button ls-buddy-target al-buddy" aria-label="查看工坊伙伴岗位" data-tooltip="查看工坊伙伴岗位" hidden><span id="alBuddyArt" class="ls-buddy" data-buddy="slime" aria-hidden="true"></span><span id="alBuddyName"></span></button>
 ${names.map((name,i)=>obj('alGuest'+i,`查看${name}的委托`,`<span class="ls-guest-body"><span class="ls-person" data-person="${i}" aria-hidden="true"></span></span><span class="ls-guest-request" id="alGuestNeed${i}"></span><span class="ls-guest-name">${name}</span>`,'ls-guest ls-guest-'+i+' al-guest-'+i)).join('')}
 <div id="alFeedback" class="ls-feedback" role="status" aria-live="polite"></div></div>
 <div class="ls-bottom"><p id="alGreeting"></p><div class="ls-shortcuts"><button type="button" id="alRecipes" class="game-button" data-tooltip="查看全部炼金调配配方">调配配方</button><button type="button" id="alOrders" class="game-button" data-tooltip="查看三位旅人的真实委托">委托册</button><button type="button" id="alOverview" class="game-button" data-tooltip="营地与经营总览">经营总览</button></div></div></section>`;
}

interface Snapshot {tick:number;sequence:number;notice:string;made:number;stock:number;shelf:number;sold:number;till:number;coins:number;revisions:number[]}
export function bindAlchemyScene(h:AlchemySceneHooks):{reflect:()=>void;dispose:()=>void} {
 const root=document.getElementById('alchemyScene');if(!root)throw Error('炼金场景尚未挂载');
 const $=<T extends HTMLElement=HTMLElement>(id:string)=>root.querySelector<T>('#'+id)!;
 const put=(id:string,text:string)=>{const e=$(id);if(e.textContent!==text)e.textContent=text;};
 const controller=new AbortController(),signal=controller.signal;
 let disposed=false,previous:Snapshot|undefined,effect:Animation|undefined;
 const motion=bindLivingMotion(root,()=>{const state=h.state();return !!state.workingElsewhere||!!state.popup?.suspended||state.mode==='hidden';},()=>{effect?.cancel();effect=undefined;});
 const on=(id:string,fn:()=>void)=>$(id).addEventListener('click',()=>{if(!h.busy())fn();},{signal});
 for(const [id,target]of [['alCounter','counter'],['alSupplies','supplies'],['alStill','craft'],['alShelf','shelf'],['alStudy','study'],['alRecipes','specials'],['alOrders','orders'],['alOverview','overview'],['alBuddy','overview']] as const)on(id,()=>h.open(target));
 for(let i=0;i<3;i++)on('alGuest'+i,()=>h.open('orders',i));
 on('alOpen',()=>{const p=h.state().game.profile;if(p)h.dispatch({type:'atelier-open',station:'alchemy',open:!atelierOf(p).open.alchemy});});
 on('alCollect',()=>h.dispatch({type:'atelier-collect'}));
 const pulse=(message:string)=>{
  put('alFeedback',message);if(root.dataset.motion!=='running')return;
  effect?.cancel();effect=$('alFeedback').animate([{opacity:0,transform:'translateY(6px)'},{opacity:1,transform:'translateY(0)',offset:.12},{opacity:1,offset:.83},{opacity:0,transform:'translateY(-5px)'}],{duration:2800,easing:'ease-out'});
 };
 function reflect():void {
  if(disposed)return;
  const state=h.state(),p=state.game.profile,busy=h.busy();motion.sync();root!.setAttribute('aria-busy',String(busy));
  for(const button of Array.from(root!.querySelectorAll<HTMLButtonElement>('button')))button.disabled=busy||!p;
  if(!p){put('alGreeting',state.game.error||'正在打开工坊…');return;}
  const a=atelierOf(p),camp=campOf(p),q=a.queues.alchemy[0],openAction:GameAction={type:'atelier-open',station:'alchemy',open:!a.open.alchemy};
  const collectAction={type:'atelier-collect'} as const,openReason=atelierReason(p,openAction),collectReason=atelierReason(p,collectAction);
  const shelf=goods.reduce((sum,g)=>sum+a.shelves[g].stock,0),made=goods.reduce((sum,g)=>sum+a.made[g],0),stock=goods.reduce((sum,g)=>sum+a.stock[g],0),pending=a.queues.alchemy.reduce((sum,batch)=>sum+batch.remaining,0);
  put('alCoins',String(p.coins));put('alLevel',`营地 Lv${campLevel(p)}`);
  put('alOpen',a.open.alchemy?'营业中 · 关店':'歇业中 · 开店');$('alOpen').setAttribute('aria-pressed',String(a.open.alchemy));
  $<HTMLButtonElement>('alOpen').disabled=busy||!!openReason;$('alOpen').dataset.tooltip=busy?'操作提交中。':openReason||'切换炼金货台营业';
  root!.dataset.working=String(!!q);root!.dataset.trading=String(a.open.alchemy&&shelf>0);root!.dataset.stocked=String(shelf>0);
  put('alProduction',q?`${pending}份 · 下一份${Math.max(0,Math.ceil((q.due-p.tick)/10))}秒`:'等待调配');
  $('alStill').dataset.tooltip=q?`${FORMULAS[q.good].name}，${a.queues.alchemy.length}/3批排产，点击安排或取消`:'选择配方并安排炼金调配';
  put('alShelfCount',shelf?`${shelf}份在架`:'空架待上新');
  for(const g of goods){const e=root!.querySelector<HTMLElement>(`[data-shelf-good="${g}"]`)!;e.hidden=a.shelves[g].stock===0;e.dataset.count=String(a.shelves[g].stock);}
  $('alShelf').dataset.tooltip=shelf?goods.filter(g=>a.shelves[g].stock>0).map(g=>`${FORMULAS[g].name} ${a.shelves[g].stock}份`).join(' · ')+'，点击上架与定价':'炼金货架暂无商品，点击选择成品上架';
  put('alTill',`${a.till}金币`);$<HTMLButtonElement>('alCollect').disabled=busy||!!collectReason;
  $('alCollect').dataset.tooltip=busy?'操作提交中。':collectReason||'收取补给特色与炼金共用钱箱';
  put('alFacility',`蒸馏台 Lv${a.facilities.still}`);put('alRole',p.job==='keeper'?'调配与原料':'先去补给店任职');
  put('alGreeting',p.job!=='keeper'?'先在补给店完成任职试餐，再来调配。':q?`${FORMULAS[q.good].name}正在调配。旅人带来了新的委托。`:shelf?(a.open.alchemy?'药瓶已经摆好，等一位路过的旅人。':'药瓶已经摆好，记得翻开营业牌。'):'月光照着空货架。点调配台，做今天的第一瓶药剂。');
  const buddy=camp.jobs.workshop;$('alBuddy').hidden=!buddy;if(buddy){$('alBuddyArt').dataset.buddy=buddy;put('alBuddyName',`${COMPANIONS[buddy].name} · 工坊`);}
  for(let i=0;i<3;i++){
   const order=stableAtelierOrder(p,'alchemy',i),guest=$('alGuest'+i),text=`${FORMULAS[order.good].name} ×${order.count}`;
   const deliverReason=order.accepted?atelierReason(p,{type:'atelier-deliver',station:'alchemy',slot:i,revision:order.revision}):'',ready=order.accepted&&!deliverReason;
   guest.hidden=p.job!=='keeper';
   guest.dataset.accepted=String(order.accepted);guest.dataset.ready=String(ready);
   put('alGuestNeed'+i,text+(order.accepted?(ready?' · 可交付':' · 已接'):''));
   guest.dataset.tooltip=`${names[i]}：${text}，${order.accepted?(deliverReason||'可交付'):'待接取'}，点击查看`;
   guest.setAttribute('aria-label',guest.dataset.tooltip);
  }
  const next:Snapshot={tick:p.tick,sequence:p.sequence,notice:p.notice,made,stock,shelf,sold:p.totals.sold,till:a.till,coins:p.coins,revisions:a.orders.alchemy.map(o=>o.revision)};
  if(previous&&root!.dataset.motion==='running'){
   if(next.revisions.some((r,i)=>r>previous!.revisions[i]))pulse('委托交付了，旅人送来了下一份订单。');
   else if(next.sequence!==previous.sequence&&next.notice!==previous.notice)pulse(next.notice);
   else if(next.made>previous.made)pulse(`调配完成 · ${next.made-previous.made}份已进背包`);
   else if(next.sequence===previous.sequence&&next.sold>previous.sold&&next.shelf<previous.shelf&&next.till>previous.till)pulse('旅人买下了药剂，货款已存入钱箱。');
   else if(next.till<previous.till&&next.coins>previous.coins&&next.notice==='特色货款已收入钱包。')pulse(`特色货款入袋 +${previous.till-next.till}金币`);
  }
  previous=next;
 }
 reflect();return {reflect,dispose:()=>{if(disposed)return;disposed=true;controller.abort();motion.dispose();}};
}
