import {atelierOf, campOf, campLevel, campReason, COMPANIONS, FORMULAS, stableAtelierOrder, type GameAction, type Profile, type Station} from '../../../packages/solo-core';
import type {ShellState} from '../../../packages/protocol';
import {icon} from './icons';
import {bindLivingMotion} from './living-motion';

export type RoomTarget='counter'|'supplies'|'craft'|'shelf'|'orders'|'specials'|'study'|'overview';
export const itemPicture=(item:string,extra='')=>`<span class="ls-item-art ${extra}" data-item="${item}" aria-hidden="true"></span>`;
function supplyWork(p:Profile):{target:'craft'|'specials';due:number}|undefined {
 const ordinary=p.queue,special=atelierOf(p).queues.supply[0];
 return special&&(!ordinary||special.due<ordinary.due)?{target:'specials',due:special.due}:ordinary?{target:'craft',due:ordinary.due}:undefined;
}
const button=(id:string,label:string,body:string,extra='')=>`<button type="button" id="${id}" class="game-button ls-object ${extra}" aria-label="${label}" data-tooltip="${label}">${body}</button>`;
const tag=(title:string,id?:string)=>`<span class="ls-tag"><strong>${title}</strong>${id?`<span id="${id}"></span>`:''}</span>`;
export function livingShopMarkup(station:Station):string {
 const supply=station==='supply';
 return `<section id="livingScene" class="living-scene" data-room="${station}" data-motion="paused" data-working="false" aria-label="${supply?'炉边补给店':'水晶炼金工坊'}的互动场景">
 <div class="ls-topline"><span class="ls-gold">${icon('gold')}<strong id="lsCoins">—</strong></span><span id="lsLevel"></span><button type="button" id="lsOpen" class="game-button ls-sign" data-tooltip="管理本站营业">歇业中</button></div>
 <div class="ls-stage" id="lsStage"><div class="ls-room" aria-hidden="true"></div><div class="ls-light" aria-hidden="true"></div><div class="ls-fire" aria-hidden="true"><i></i><i></i><i></i></div>
 ${button('lsCounter','与店员交谈',`<span class="ls-person ls-clerk" data-person="0" aria-hidden="true"></span>${tag('店员','lsRole')}`,'ls-counter')}
 ${button('lsSupplies','打开原料交易',`${itemPicture('flour')}${tag('原料柜')}`,'ls-supplies')}
 ${button('lsOven',supply?'查看炉灶制作':'查看炼金调配',`<span class="ls-object-ring" aria-hidden="true"></span>${tag(supply?'炉灶':'炼金台','lsProduction')}`,'ls-oven')}
 ${button('lsShelf','查看货架与定价',`<span class="ls-shelf-items" aria-hidden="true">${itemPicture('ration')}${itemPicture('crystal')}</span>${tag('货架','lsShelfCount')}`,'ls-shelf')}
 ${button('lsLedger','打开营地经营总览',`${itemPicture('ledger')}${tag('经营手账')}`,'ls-ledger')}
 ${button('lsCollect','集中收取两只实际钱箱',`${itemPicture('cashbox')}${tag('钱箱','lsTill')}`,'ls-cashbox')}
 <button type="button" id="lsBuddy" class="game-button ls-buddy-target" data-tooltip="查看店内伙伴岗位" aria-label="查看店内伙伴岗位" hidden><span id="lsBuddyArt" class="ls-buddy" data-buddy="slime" aria-hidden="true"></span><span id="lsBuddyName"></span></button>
 ${[0,1,2].map(i=>button('lsGuest'+i,'查看顾客委托',`<span class="ls-guest-body"><span class="ls-person" data-person="${i}" aria-hidden="true"></span></span><span class="ls-guest-request" id="lsGuestNeed${i}"></span><span class="ls-guest-name" id="lsGuestName${i}"></span>`,'ls-guest ls-guest-'+i)).join('')}
 <div id="lsFeedback" class="ls-feedback" role="status" aria-live="polite"></div><span id="lsSpark" class="ls-spark" aria-hidden="true">✦</span></div>
 <div class="ls-bottom"><p id="lsGreeting"></p><div class="ls-shortcuts"><button type="button" id="lsRecipes" class="game-button" data-tooltip="查看全部配方">${supply?'特色餐盒':'调配配方'}<span id="lsSpecialCount" class="ls-count" hidden></span></button><button type="button" id="lsStudy" class="game-button" data-tooltip="设施研修与配方手记">研修</button><button type="button" id="lsOrders" class="game-button" data-tooltip="查看全部委托">委托册</button></div></div></section>`;
}
interface Hooks {station:Station;state:()=>ShellState;busy:()=>boolean;open:(target:RoomTarget,slot?:number)=>void;dispatch:(a:GameAction)=>void}
export function bindLivingShop(h:Hooks):{reflect:()=>void;dispose:()=>void} {
 const root=document.getElementById('livingScene')!;
 const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
 const put=(id:string,text:string)=>{const e=$(id);if(e.textContent!==text)e.textContent=text;};
 const controller=new AbortController();
 const listen=(id:string,fn:()=>void)=>$(id).addEventListener('click',fn,{signal:controller.signal});
 let previous:Profile|undefined,effect:Animation|undefined;
 const motion=bindLivingMotion(root,()=>{const state=h.state();return !!state.workingElsewhere||!!state.popup?.suspended||state.mode==='hidden';},()=>effect?.cancel());
 const pulse=(message:string)=>{put('lsFeedback',message);if(root.dataset.motion!=='running')return;effect?.cancel();effect=$('lsFeedback').animate([{opacity:0,transform:'translateY(7px)'},{opacity:1,transform:'translateY(0)',offset:.15},{opacity:1,offset:.8},{opacity:0,transform:'translateY(-8px)'}],{duration:2600,fill:'none',easing:'ease-out'});};
 for(const [id,target]of [['lsCounter','counter'],['lsSupplies','supplies'],['lsShelf','shelf'],['lsLedger','overview'],['lsRecipes','specials'],['lsStudy','study'],['lsOrders','orders'],['lsBuddy','overview']] as const)listen(id,()=>h.open(target));
 listen('lsOven',()=>{const p=h.state().game.profile;h.open(h.station==='supply'&&p?supplyWork(p)?.target??'craft':'craft');});
 for(let i=0;i<3;i++)listen('lsGuest'+i,()=>h.open('orders',i));
 listen('lsCollect',()=>h.dispatch({type:'camp-collect'}));
 listen('lsOpen',()=>{const p=h.state().game.profile;if(!p)return;h.dispatch(h.station==='supply'?{type:'retail',enabled:!p.retail}:{type:'atelier-open',station:'alchemy',open:!atelierOf(p).open.alchemy});});
 function reflect():void {
  const state=h.state(),p=state.game.profile,busy=h.busy();motion.sync();root.setAttribute('aria-busy',String(busy));
  if(!p){put('lsGreeting',state.game.error||'正在打开店门…');for(const b of Array.from(root.querySelectorAll<HTMLButtonElement>('button')))b.disabled=true;return;}
  for(const b of Array.from(root.querySelectorAll<HTMLButtonElement>('button')))b.disabled=false;
  const a=atelierOf(p),camp=campOf(p),supply=h.station==='supply',open=supply?p.retail:a.open.alchemy;
  put('lsCoins',String(p.coins));put('lsLevel',`营地 Lv${campLevel(p)}`);put('lsOpen',open?'营业中 · 关店':'歇业中 · 开店');$('lsOpen').setAttribute('aria-pressed',String(open));$('lsOpen').dataset.tooltip=supply?'切换口粮货架营业；特色餐盒在特色货台单独开业':'切换炼金货台营业';
  $<HTMLButtonElement>('lsOpen').disabled=busy||supply&&p.job!=='keeper';if(supply&&p.job!=='keeper')$('lsOpen').dataset.tooltip='先与店员交谈，完成任职。';
  const batch=supply?supplyWork(p):a.queues.alchemy[0];const pending=supply?(p.queue?p.queue.remaining:0)+p.business.pending.reduce((n,q)=>n+q.remaining,0)+a.queues.supply.reduce((n,q)=>n+q.remaining,0):a.queues.alchemy.reduce((n,q)=>n+q.remaining,0);
  root.dataset.working=String(!!batch);root.dataset.trading=String(open&&(supply?(p.business.managed?p.business.shelves.ration.stock+p.business.shelves.crystal.stock>0:p.bag.crystal>0||p.bag.ration>2):Object.entries(a.shelves).some(([g,s])=>FORMULAS[g as keyof typeof FORMULAS].station==='alchemy'&&s.stock>0)));
  put('lsProduction',batch?`${pending}份 · ${Math.max(0,Math.ceil((batch.due-p.tick)/10))}秒`:'等你安排');
  const ordinaryStock={ration:p.business.managed?p.business.shelves.ration.stock:Math.max(0,p.bag.ration-2),crystal:p.business.managed?p.business.shelves.crystal.stock:p.bag.crystal};
  const shelves=supply?ordinaryStock.ration+ordinaryStock.crystal:Object.entries(a.shelves).reduce((n,[g,s])=>n+(FORMULAS[g as keyof typeof FORMULAS].station==='alchemy'?s.stock:0),0);
  const specialShelf=Object.entries(a.shelves).reduce((n,[g,s])=>n+(FORMULAS[g as keyof typeof FORMULAS].station==='supply'?s.stock:0),0);
  put('lsShelfCount',supply&&!p.business.managed?`背包可售 ${shelves}份`:`${shelves}份在架`);root.dataset.stocked=String(shelves>0);put('lsTill',`${p.business.till+a.till}金币`);
  put('lsSpecialCount',String(specialShelf));$('lsSpecialCount').hidden=specialShelf===0;$('lsRecipes').dataset.tooltip=`特色餐盒货台 ${specialShelf}份 · ${a.open.supply?'营业中':'歇业中'}，点击制作、上架与经营`;
  $('lsShelf').dataset.tooltip=supply&&!p.business.managed?'当前从背包自动出售，口粮保留2份；点击管理或改用实体货架。':'查看实际货架商品、上架与定价';
  for(const r of ['ration','crystal'] as const){const e=root.querySelector<HTMLElement>(`.ls-shelf-items [data-item="${r}"]`);if(e)e.hidden=supply&&ordinaryStock[r]===0;}
  const reason=campReason(p,{type:'camp-collect'});$<HTMLButtonElement>('lsCollect').disabled=busy||!!reason;$('lsCollect').dataset.tooltip=busy?'操作提交中。':reason||'收取补给旧钱箱与补给/炼金共用钱箱，不重复计算';
  put('lsRole',supply?(p.job==='visitor'?'来聊聊吧':p.job==='apprentice'?'试餐等你':'采购与任职'):'调配与原料');
  put('lsGreeting',supply?(p.job==='visitor'?'炉火还没点起。和店员聊聊，从一份试餐开始。':p.job==='apprentice'?'今天的第一份口粮，交给你来做。':batch?'炉子正忙着。顾客在等补给，别忘了看看货架。':shelves?'商品已摆好。可以去听听旅人的委托。':'挑些原料，烤点口粮，再摆上自己的货架。'):'药瓶与草叶已经备好。点炼金台，开始今天的调配。');
  const buddy=camp.jobs.counter; $('lsBuddy').hidden=!buddy;if(buddy){$('lsBuddyArt').dataset.buddy=buddy;put('lsBuddyName',COMPANIONS[buddy].name+' · 柜台');}
  for(let i=0;i<3;i++){
   const guest=$('lsGuest'+i);guest.hidden=supply&&p.job!=='keeper';
   if(supply){const o=p.business.orders[i];put('lsGuestName'+i,['巡路队','营地医师','旅商车队'][i]);put('lsGuestNeed'+i,`${o.recipe==='ration'?'口粮':'魔晶餐'} ×${o.count}${o.accepted?' · 已接':''}`);guest.dataset.accepted=String(o.accepted);guest.dataset.tooltip=`${['巡路队','营地医师','旅商车队'][i]}的真实订单：${o.count}份${o.recipe==='ration'?'旅行口粮':'魔晶餐'}，点击查看`;
   }else{const o=stableAtelierOrder(p,'alchemy',i);put('lsGuestName'+i,['观星学徒','药草商人','遗物修复师'][i]);put('lsGuestNeed'+i,`${FORMULAS[o.good].name} ×${o.count}`);guest.dataset.accepted=String(o.accepted);guest.dataset.tooltip=`查看${FORMULAS[o.good].name} ×${o.count}的委托`;}
  }
  const last=previous;
  if(last&&root.dataset.motion==='running'){
   if(p.coins>last.coins&&p.business.till+a.till<last.business.till+atelierOf(last).till)pulse(`货款入袋  +${p.coins-last.coins} 金币`);
   else if(p.sequence!==last.sequence&&p.notice!==last.notice)pulse(p.notice);
   else if(p.business.till>last.business.till||!p.business.managed&&p.totals.sold>last.totals.sold&&p.coins>last.coins&&p.bag.ration+p.bag.crystal<last.bag.ration+last.bag.crystal)pulse('旅人挑走了店里的补给');
   else if(p.totals.crafted>last.totals.crafted)pulse('新的补给已经制作完成');
   else if(['picnic','stew','gift'].some(g=>a.made[g as keyof typeof a.made]>atelierOf(last).made[g as keyof typeof a.made]))pulse('新的特色餐盒已经入库');
   else if(a.till>atelierOf(last).till&&['picnic','stew','gift'].some(g=>a.shelves[g as keyof typeof a.shelves].stock<atelierOf(last).shelves[g as keyof typeof a.shelves].stock))pulse('特色餐盒售出，货款已存入钱箱');
  }
  previous=p;
 }
 reflect();
 return {reflect,dispose:()=>{controller.abort();motion.dispose();effect?.cancel();}};
}
