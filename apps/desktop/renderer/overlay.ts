import {FieldHud} from './field-hud';
import {ChapterDemo} from './chapter-demo';
import {chapterView,isFreshChapterCandidate} from '../../../packages/solo-core';
import {chapterIntent} from '../../../packages/protocol/chapter';
import {ensureChapterStyle} from './chapter-controller';
import {masteryChapters,masteryView} from '../../../packages/solo-core/mastery';
import {envelope} from './solo-panels';
import {towerNext} from '../../../packages/solo-core/tower';
import {regions} from '../../../packages/solo-core';
import type { Rect, ShellState, ShopId, StreetAPI } from '../../../packages/protocol';
import { PixelScene } from './scene';
import { sampleShops } from '../../../packages/content/sample';
import { iconButton, icon } from './icons';
import {clearPressedGameButtons,showInteractionHint} from './game-button';
import {fieldTargetHint,foregroundHit} from './scene-interaction';
declare global {interface Window{street:StreetAPI}}
const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const report=(error:unknown)=>{const el=document.getElementById('sceneError');if(el)el.textContent=String(error);};
const run=(p:Promise<unknown>)=>{void p.catch(report);};
export async function overlayPage():Promise<void>{
  ensureChapterStyle();
  $('root').innerHTML=`<div id="stage"></div><button id="chapterChip" class="ch-chip" data-hit hidden></button><div id="sceneError" class="error"></div><div id="shopSigns"><button class="shop-sign shop-target" data-shop="shop-bakery" aria-label="进入炉边面包房"><span>补给<br>商店</span></button><button class="shop-sign shop-target" data-shop="shop-alchemy" aria-label="进入薄荷炼金铺"><span>炼金<br>工坊</span></button></div><div id="placeSigns"><button id="dungeonSign" class="shop-sign" data-place="dungeon-portal" aria-label="地牢之门 · 悠游营地"><span>地牢<br>之门</span></button><button id="portalSign" class="shop-sign" data-place="adventure-portal" aria-label="远征之门"><span>远征<br>之门</span></button></div><div id="fieldInfo" role="status" hidden></div><button id="towerEntrance" class="tower-entrance" data-place="tower" aria-label="成就之塔 · 一步步熟悉营地"><img src="assets/tower-0130/tower-building.webp" alt="" draggable="false"><span>成就之塔</span><i aria-hidden="true">下一步</i><b class="tower-chapter-mark tower-chapter-business" aria-hidden="true" hidden></b><b class="tower-chapter-mark tower-chapter-idle" aria-hidden="true" hidden></b></button><div id="gameError" class="error"></div><div id="interiorBadge" hidden></div><div id="hud" data-hit><div id="primaryBar" class="toolbar">${iconButton('openInventory','bag','打开或收起背包')}${iconButton('openSettings','settings','打开或收起设置')}${iconButton('displayHide','hide','隐藏并留下恢复箭头','danger')}</div></div><div id="hoverMarker" class="road-marker ghost" aria-hidden="true" hidden><span class="target-ring"></span>${icon('target')}</div><div id="moveMarker" class="road-marker" aria-hidden="true" hidden><span class="target-ring"></span>${icon('target')}</div><div id="bubble" class="bubble" hidden></div>`;
  const scene=new PixelScene();await scene.init($('stage'));let state:ShellState,captured=false,intent=0,lastMessage=0,epoch=-1,pointer:{x:number;y:number}|undefined;
  const fieldHud=new FieldHud(send,()=>run(send({type:'visit',shop:'shop-bakery'})));
  const demo=new ChapterDemo(scene,()=>state,apply);
  Object.defineProperty(window,'fieldSceneProbe',{get:()=>({scene:scene.fieldProbe(),frames:scene.frames,tickerStarted:scene.app.ticker.started,systemTickerStarted:scene.systemTickerStarted})});
  Object.defineProperty(window,'streetFrameProbe',{get:()=>({summary:scene.frameStats.summary(),raw:scene.frameStats.raw(),frames:scene.frames,tickerStarted:scene.app.ticker.started,systemTickerStarted:scene.systemTickerStarted,actorPose:scene.actorPoseProbe(),targetFps:Number(document.body.dataset.targetFps??0)})});
  let timer:ReturnType<typeof setTimeout>|undefined,audio:AudioContext|undefined;
  function bubble():void{
    const m=state.localMessage;if(!m||m.id===lastMessage)return;lastMessage=m.id;document.body.dataset.localSends=String(lastMessage);
    if(state.settings.bubbles){$('bubble').textContent=m.text;$('bubble').hidden=false;clearTimeout(timer);timer=setTimeout(()=>{$('bubble').hidden=true;},6000);}
    if(state.settings.soundEnabled&&state.settings.mode==='friends'&&state.mode!=='hidden'){
      audio??=new AudioContext();const ctx=audio,own=state.epoch;void ctx.resume().then(()=>{if(state.mode==='hidden'||state.epoch!==own||state.settings.mode==='quiet'||!state.settings.soundEnabled){void ctx.suspend();return;}const osc=ctx.createOscillator(),gain=ctx.createGain();gain.gain.value=state.settings.volume*.035;osc.frequency.value=520;osc.connect(gain).connect(ctx.destination);osc.start();gain.gain.exponentialRampToValueAtTime(.0001,ctx.currentTime+.12);osc.stop(ctx.currentTime+.13);document.body.dataset.audio=ctx.state;});
    }
  }
  function apply(next:ShellState):void{
    const lostInteraction=next.workingElsewhere&&!state?.workingElsewhere;
    if(state&&next.revision<state.revision)return;if(state&&(state.epoch!==next.epoch||(next.popup&&state.popup?.generation!==next.popup.generation)))intent++;
    state=next;Object.assign(document.body.dataset,{mode:next.mode,view:next.view,epoch:String(next.epoch),dock:next.settings.dock,revision:String(next.revision),popup:next.popup?.kind??''});
    $('openSettings').setAttribute('aria-expanded',String(next.popup?.kind==='settings'));$('hud').classList.toggle('open',next.popup?.kind==='settings');
    for(const button of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-shop],[data-place]'))){button.disabled=!next.settings.interactionEnabled;button.setAttribute('aria-disabled',String(button.disabled));}
    for(const sign of Array.from(document.querySelectorAll<HTMLElement>('[data-shop]'))){const isInside=next.view==='interior'&&next.activeShop===sign.dataset.shop;if(sign.dataset.inside===String(isInside))continue;sign.dataset.inside=String(isInside);sign.innerHTML=isInside?`<span>${sign.dataset.shop==='shop-bakery'?'补给商店':'炼金工坊'}<br><i>${icon('left')}离开</i></span>`:`<span>${sign.dataset.shop==='shop-bakery'?'补给<br>商店':'炼金<br>工坊'}</span>`;sign.setAttribute('aria-label',isInside?`离开${sign.dataset.shop==='shop-bakery'?'补给商店':'炼金工坊'}`:`进入${sign.dataset.shop==='shop-bakery'?'补给商店':'炼金工坊'}`);}
    const portal=$('portalSign'),returning=next.view==='field',portalText=returning?'回营<br>结算':next.game.profile?.run?'远征<br>进行中':'远征<br>之门';if(portal.dataset.label!==portalText){portal.dataset.label=portalText;portal.innerHTML=`<span>${portalText}</span>`;}portal.dataset.place=returning?'return-portal':'adventure-portal';portal.setAttribute('aria-label',returning?'回营并结算战利品':'打开远征之门');
    const tower=$('towerEntrance'),step=next.game.profile?towerNext(next.game.profile):null;tower.hidden=next.view==='field';tower.dataset.rewardReady=String(step?.status==='ready');const badge=tower.querySelector('i')!;badge.textContent=step?.status==='ready'?'可领奖':step?'下一步':'已登顶';tower.title=step?.status==='ready'?'成就之塔 · 可领奖':step?'成就之塔 · 下一步':'成就之塔 · 已登顶';tower.querySelector('span')!.textContent='成就之塔';const mp=next.game.profile,mc=mp?masteryChapters(mp):{business:false,idle:false},mr=mp?masteryView(mp).some(v=>v.status==='ready'):false;for(const line of ['business','idle'] as const)(tower.querySelector('.tower-chapter-'+line) as HTMLElement).hidden=!mc[line];if(mr){tower.dataset.rewardReady='true';badge.textContent='精通可领';tower.title='成就之塔 · 精通纪念可领取';}else if(!step){badge.textContent='精通挑战';tower.title='成就之塔 · 精通挑战';}
    const cp=next.game.profile,cv=cp&&chapterView(cp),chip=$<HTMLButtonElement>('chapterChip');chip.hidden=!!next.partyField?.view||!!cp?.run?.field&&next.view==='field'||!cp||!!cv?.skipped||(!cv?.enrolled&&!isFreshChapterCandidate(cp));if(cp&&!chip.hidden){chip.textContent=!cv?.enrolled?'短战斗演示 · 开始':cv?.step==='complete'?'开张与初行 · 四灯点亮':chapterIntent(cp).label;chip.disabled=!next.settings.interactionEnabled;}
    const r=next.game.profile?.run;$('fieldInfo').hidden=next.view!=='field'||!!r?.field||!!next.partyField?.view;$('fieldInfo').textContent=r?`自动战斗 · ${regions[r.region].name} · 剩余口粮${r.remaining} · 凝胶${r.loot}`:'远征已结束 · 回营结算';$('gameError').textContent=next.game.status==='blocked'?next.game.error:next.partyField?.phase==='frozen'?'与房主连接中断 · 共斗暂停':'';
    $('interiorBadge').hidden=next.view!=='interior';$('interiorBadge').textContent=next.view==='interior'?`${sampleShops[next.activeShop??'shop-bakery'].title}${' · 点击店员'}`:'';
    if(epoch!==next.epoch||!next.settings.bubbles){clearTimeout(timer);$('bubble').hidden=true;}epoch=next.epoch;
    if(next.mode==='hidden'||lostInteraction){pointer=undefined;captured=false;clearPressedGameButtons();showInteractionHint('',0,0);scene.hover();scene.setPointerActive(false);scene.stop();setCursor(false);}
    if(next.mode==='hidden'||next.settings.mode==='quiet'||!next.settings.soundEnabled){void audio?.suspend();document.body.dataset.audio='suspended';}
    scene.apply(next);fieldHud.apply(next);oreHint();demo.update();if(pointer)hoverAtPointer();bubble();
  }
  apply(await window.street.state());window.street.subscribe(apply);scene.app.render();await window.street.command({type:'scene-ready'});
  async function send(command:Parameters<StreetAPI['command']>[0]):Promise<void>{apply(await window.street.command(command));}
  function anchor(el:HTMLElement):Rect{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};}
  $('chapterChip').addEventListener('click',()=>{fieldHud.clearIssue();run(send({type:'chapter',generation:state.epoch+1,op:'open'}));});
  $('openSettings').addEventListener('click',()=>{fieldHud.clearIssue();intent++;scene.stop();run(send({type:'settings',anchor:anchor($('openSettings'))}));});
  $('openInventory').addEventListener('click',()=>{fieldHud.clearIssue();intent++;run(send({type:'inventory-toggle'}));});
  $('displayHide').addEventListener('click',()=>{fieldHud.clearIssue();intent++;run(send({type:'hide'}));});
  document.addEventListener('click',event=>{
    if(event.target instanceof Element&&event.target.closest('[data-hit]'))return;if(!state.settings.interactionEnabled||state.mode==='hidden')return;
    if(state.chapter?.opening?.phase==='playing')return;
    const fieldHit=scene.fieldHit(event.clientX,event.clientY);if(fieldHit){run(fieldHud.intent(fieldHit.target==='return'?{kind:'return'}:{kind:'target',target:fieldHit.target}));return;}
    const place=event.target instanceof Element?event.target.closest<HTMLElement>('[data-place]'):null;
    const sign=event.target instanceof Element?event.target.closest<HTMLElement>('[data-shop]'):null;
    const pixelHit=scene.pick(event.clientX,event.clientY),picked=place?.dataset.place==='tower'?'tower':foregroundHit(pixelHit)?pixelHit:place?.dataset.place??sign?.dataset.shop??pixelHit;
    if(sign&&state.view==='interior'&&sign.dataset.shop===state.activeShop&&scene.onShopBoard(sign.dataset.shop!,event.clientX,event.clientY)&&!foregroundHit(pixelHit)){intent++;scene.stop();run(send({type:'view',value:'street'}));return;}
    if(!picked)return;if(picked!=='ground')fieldHud.clearIssue();const own=++intent,ownEpoch=state.epoch;scene.stop();
    if(picked!=='dungeon-portal'&&picked!=='adventure-portal'&&state.game.profile&&isFreshChapterCandidate(state.game.profile)&&!state.popup){run(send({type:'chapter',generation:state.epoch+1,op:'open'}));return;}
    if(picked==='return-portal'){run(send({type:'return-camp',envelope:envelope(state,{type:'retreat'})}));}
    else if(picked==='tower'){run(send({type:'tower-open'}));}
    else if(picked==='dungeon-portal'){run(send({type:'dungeon-portal'}));}
    else if(picked==='adventure-portal'||picked==='enemy'||(state.view==='field'&&picked.startsWith('player-'))){const a=scene.anchorFor('portal');if(a)run(send({type:'adventure-panel',anchor:a}));}
    else if(picked==='keeper'){const a=scene.anchorFor('keeper');if(a)run(send({type:state.activeShop==='shop-alchemy'?'alchemy-panel':'shop-panel',anchor:a}));}
    else if(picked.startsWith('player-')){const a=scene.actorAnchor();if(a)run(send({type:'actor',anchor:a}));}
    else if(picked.startsWith('slime-')){scene.pet();run(send({type:'pet-toggle'}));}
    else if((picked==='shop-bakery'||picked==='shop-alchemy')&&state.view==='interior'&&state.activeShop===picked){const a=scene.anchorFor('keeper');if(a)run(send({type:state.activeShop==='shop-alchemy'?'alchemy-panel':'shop-panel',anchor:a}));}
    else if(picked==='shop-bakery'||picked==='shop-alchemy')run(send({type:'visit',shop:picked as ShopId}));
    else if(picked==='ground'){
      // An existing panel is raised in place; a second destination click can move after it is closed.
      run(send({type:'play'}).then(()=>{if(own===intent&&ownEpoch===state.epoch&&state.mode==='interaction'&&!state.popup)scene.walkTo(event.clientX);}));
    }
  });
  function setCursor(hit:boolean):void{const cursor=hit?'pointer':'default';document.documentElement.style.cursor=cursor;document.body.style.cursor=cursor;$('root').style.cursor=cursor;scene.app.canvas.style.cursor=cursor;document.body.dataset.pointerCursor=cursor;}
  function hoverAtPointer():void{
    if(!state||state.mode==='hidden'||!pointer)return;
    const el=document.elementFromPoint(pointer.x,pointer.y),ui=!!el?.closest('[data-hit]'),sign=el?.closest<HTMLElement>('[data-shop]'),place=el?.closest<HTMLElement>('[data-place]');
    const picked=ui||!state.settings.interactionEnabled?(scene.hover(),undefined):scene.hover(pointer.x,pointer.y,place?.dataset.place??sign?.dataset.shop);
    oreHint(picked);
    const hit=ui||!!picked;setCursor(hit);scene.setPointerActive(hit);const peerName=scene.peerHoverName(pointer.x,pointer.y);const hint=peerName?`${peerName} · 同街好友`:fieldTargetHint(picked,state.game.profile?.run?.field?.floor)||(picked==='shop-bakery'||picked==='shop-alchemy'?`${sampleShops[picked].title} · 点击房屋或立牌进入`:picked==='tower'?'成就之塔 · 一步步熟悉营地':picked==='dungeon-portal'?'地牢之门 · 悠游营地、伙伴与培养':picked==='adventure-portal'?'远征之门 · 远行整备、路线与物资':picked==='return-portal'?'返回营地并结算战利品':picked==='enemy'?'点击查看远征与技能':picked==='keeper'?'与店员交谈 · 任职与经营':picked?.startsWith('player-')?'点击冒险者，选择对话':picked?.startsWith('slime-')?'苔团子 · 点击查看宠物':picked==='ground'||picked==='field-ground'?'点击这里走过去':'');if(!ui&&!sign&&!place)showInteractionHint(hint,pointer.x,pointer.y,picked);else if(!ui&&!picked)showInteractionHint('',0,0);
    if(hit!==captured){captured=hit;run(window.street.command({type:'pointer',capture:hit}));}
  }
  function oreHint(hovered?:string):void{const f=state?.game.profile?.run?.field,probe=scene.fieldProbe(),ore=probe?.objects.find(o=>o.id===`f${f?.floor}-ore`);fieldHud.oreHint(!!ore&&(hovered===ore.id||f?.target?.kind==='ore'),ore?.bounds);}
  const rememberPointer=(event:MouseEvent)=>{pointer={x:event.clientX,y:event.clientY};hoverAtPointer();};
  document.addEventListener('mousemove',rememberPointer);
  document.addEventListener('mouseenter',rememberPointer);
  document.addEventListener('mouseover',rememberPointer);
  window.addEventListener('resize',hoverAtPointer);
  document.addEventListener('mouseleave',()=>{pointer=undefined;clearPressedGameButtons();scene.hover();scene.setPointerActive(false);setCursor(false);showInteractionHint('',0,0);if(captured){captured=false;run(window.street.command({type:'pointer',capture:false}));}});
}
