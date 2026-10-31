import {chapterView} from '../../../packages/solo-core';
import {chapterIntent,presentationActive,type ShellState} from '../../../packages/protocol';
import {ChapterController,ensureChapterStyle} from './chapter-controller';
import {ChapterFeedbackConsumer} from './chapter-feedback';
import {chapterCard,type ChapterResource} from './chapter-card';
import {GameButton} from './game-button';
import {inventoryArt} from './inventory-art';
const escape=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const cardMarkup=`<div class="popover-content"><header class="panel-drag"><h1 id="chapterHeader"></h1><button id="chapterClose" type="button" aria-label="收起面板">×</button></header>
 <main id="chapterBody"><div class="ch-item"><div id="chapterArt" class="ch-art"></div><div><h2 id="chapterGoal"></h2><p id="chapterDetail"></p></div></div>
 <div id="chapterResources" class="ch-resources"></div><p id="chapterPlan"></p><p id="chapterReason" class="ch-missing" role="status"></p>
 <div id="chapterQuote" class="ch-quote" hidden><strong>确认本次采购</strong><p id="chapterQuoteText"></p><button id="chapterCancel" type="button" class="ch-link">取消</button></div>
 <button id="chapterPrimary" type="button" class="ch-primary"></button><p id="chapterError" class="ch-missing" role="alert"></p>
 <footer class="ch-footer"><span id="chapterActivity" role="status"></span><button id="chapterMenu" type="button" class="ch-link" aria-expanded="false">更多 ⋯</button></footer>
 <nav id="chapterMenuItems" class="ch-menu" hidden><button id="chapterMore" type="button">完整界面 →</button><button id="chapterSkip" type="button">跳过引导</button></nav></main></div>`;
function resourceMarkup(r:ChapterResource):string {
 const art=r.id==='coins'?'<span aria-hidden="true">◈</span>':inventoryArt('bag:'+r.id);
 return `<span class="${r.owned<r.needed?'ch-missing':''}">${art}${r.name} ${r.owned} / ${r.needed}</span>`;
}
export function bindChapterPanel(get:()=>ShellState,apply:(s:ShellState)=>void):{update:()=>void;dispose:()=>void} {
 ensureChapterStyle();const root=document.createElement('section');root.className='popover-shell chapter-shell';root.innerHTML=cardMarkup;
 document.getElementById('root')!.replaceChildren(root);
 const $=<T extends HTMLElement=HTMLElement>(id:string)=>root.querySelector<T>('#'+id)!;
 const put=(id:string,text:string)=>{const el=$(id);if(el.textContent!==text)el.textContent=text;el.hidden=!text;};
 const markup=(id:string,html:string)=>{const el=$(id);if(el.dataset.content!==html){el.dataset.content=html;el.innerHTML=html;}el.hidden=!html;};
 const controller=new ChapterController(get,apply,update),consumer=new ChapterFeedbackConsumer();
 let pointer=false,blurred=false,feedActive=false,disposed=false;
 const active=()=>{const s=get();return !blurred&&presentationActive(s.presentation?.popup,{pointer,documentVisible:!document.hidden,blocked:!!s.workingElsewhere||s.mode==='hidden'||!s.settings.interactionEnabled||!!s.popup?.suspended});};
 const isDemo=()=>get().chapter?.location==='demo';
 function feedback():void {
  const feed=get().game.feedback;
  if(!active()||!feed){consumer.suspend();feedActive=false;put('chapterActivity','');return;}
  if(!feedActive){consumer.resume(feed);feedActive=true;return;}
  consumer.accept(feed);
  for(const event of consumer.drain())if(event.kind==='sale')put('chapterActivity',`真实成交 ＋${event.amount}金`);
 }
 function update():void {
  if(disposed)return;const state=get(),p=state.game.profile;if(!p)return;
  const demo=isDemo(),card=chapterCard(p,demo),intent=chapterIntent(p,state.game.partySize),quote=state.chapter?.quote;
  const navigate=!demo&&state.chapter?.location!==intent.location;
  if(state.workingElsewhere||state.mode==='hidden'){pointer=false;blurred=true;}
  root.dataset.step=demo?'demo':chapterView(p).step;root.dataset.motion=active()?'active':'paused';root.dataset.busy=String(controller.busy);
  put('chapterHeader',card.header);put('chapterGoal',card.title);put('chapterDetail',card.description);
  markup('chapterArt',card.map?'<img src="assets/expedition-071/glow-trail.webp" alt="萤石荒径地图" draggable="false">':inventoryArt(card.art));
  $('chapterArt').classList.toggle('ch-map',card.map);
  markup('chapterResources',card.resources.map(resourceMarkup).join(''));
  markup('chapterPlan',escape(card.note)+(card.worn?`<span class="ch-worn">${inventoryArt('equipment:trail-coat')}已穿戴</span>`:''));
  put('chapterReason',navigate||demo?'':intent.reason);
  $('chapterQuote').hidden=!quote;put('chapterQuoteText',quote?`${quote.label} · 合计${quote.coins}金币`:'');
  let label=card.primary;
  if(navigate)label=`前往${intent.location==='equipment'?'装备台':intent.location==='expedition'?'远征之门':intent.location==='tower'?'成就之塔':'补给店'} →`;
  if(quote)label='确认采购';if(controller.busy)label='正在提交…';
  const primary=$<HTMLButtonElement>('chapterPrimary');if(primary.textContent!==label)primary.textContent=label;
  primary.disabled=controller.busy||(!demo&&!navigate&&!quote&&(!!intent.reason||(!intent.action&&!['running','complete'].includes(chapterView(p).step))));
  $('chapterMore').hidden=demo;$<HTMLButtonElement>('chapterSkip').disabled=controller.busy;put('chapterError',controller.error);
  feedback();for(const button of Array.from(root.querySelectorAll<HTMLButtonElement>('button')))GameButton.enhance(button);
 }
 async function primary():Promise<void>{
  const s=get(),p=s.game.profile;if(!p)return;
  if(s.chapter?.quote)await controller.send('perform',s.chapter.quote.token);
  else if(isDemo())await controller.send(p.chapter?'resume':'start');
  else {const intent=chapterIntent(p);await controller.send(intent.purchase&&s.chapter?.location===intent.location?'preview':'perform');}
 }
 $('chapterPrimary').addEventListener('click',()=>{void primary();});
 $('chapterClose').addEventListener('click',()=>{const generation=get().popup?.generation;if(!generation)return;void window.street.command({type:'close-popup',generation}).catch(e=>{controller.error=String(e);update();});});
 $('chapterMenu').addEventListener('click',()=>{const menu=$('chapterMenuItems');menu.hidden=!menu.hidden;$('chapterMenu').setAttribute('aria-expanded',String(!menu.hidden));});
 $('chapterMore').addEventListener('click',()=>{void controller.send('more');});
 $('chapterSkip').addEventListener('click',()=>{void controller.send('skip');});
 $('chapterCancel').addEventListener('click',()=>{void controller.send('cancel');});
 const enter=(event:PointerEvent)=>{if(event.isTrusted){pointer=true;blurred=false;update();}};
 const leave=()=>{pointer=false;update();},blur=()=>{blurred=true;pointer=false;update();},focus=()=>{blurred=false;update();};
 root.addEventListener('pointerenter',enter);root.addEventListener('pointerleave',leave);window.addEventListener('blur',blur);window.addEventListener('focus',focus);document.addEventListener('visibilitychange',update);
 update();return {update,dispose:()=>{disposed=true;controller.dispose();consumer.suspend();window.removeEventListener('blur',blur);window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',update);}};
}
