import {FieldChallengePanel} from './field-challenge-panel';
import type {FieldChallengeAction} from '../../../packages/solo-core/field-progress';
import {chapterView} from '../../../packages/solo-core';
import {chapterIntent} from '../../../packages/protocol/chapter';
import {ensureChapterStyle} from './chapter-controller';
import {MasteryPanel} from './mastery-panel';
import {masteryView,type MasteryAction} from '../../../packages/solo-core/mastery';
import {towerFloors,towerView,towerDestination,campTowerTargets,towerRoomReason,trainingGuidance,type TowerRouteChoice,type Profile,type TowerFloorView,type TowerTarget} from '../../../packages/solo-core';
import type {Command,ShellState} from '../../../packages/protocol';
import {APP_NAME} from '../identity';
import {GameButton} from './game-button';
import {artMarkup,ensureInnerArt} from './inner-art';
import {icon} from './icons';
import {bindLivingMotion} from './living-motion';
import {bindActionFeedback} from './action-feedback';
import {commandErrorText} from './command-error';

const chapters=['街角','炉火','日常','同行','灯火'];
const esc=(value:string|number)=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const button=(id:string,label:string,contents:string,cls='')=>`<button type="button" id="${id}" class="game-button ${cls}" aria-label="${esc(label)}" data-tooltip="${esc(label)}">${contents}</button>`;
const $=<T extends HTMLElement=HTMLElement>(id:string)=>{const node=document.getElementById(id);if(!node)throw Error('塔内界面缺少 '+id);return node as T;};
const put=(id:string,text:string)=>{const node=$(id);if(node.textContent!==text)node.textContent=text;};
const statusNames={locked:'待前层领奖',active:'正在点亮',ready:'可以领奖',claimed:'星灯已点亮'};
const targetNames:Record<TowerTarget,string>={supply:'前往补给店',alchemy:'前往炼金工坊',dungeon:'前往地牢营地',garden:'前往花圃',companions:'前往伙伴小屋',ledger:'前往经营手账',kitchen:'前往旅人厨房','camp-growth':'前往营地修缮',collection:'前往收藏馆','village-projects':'前往村落建设','supply-job':'前往店员处','supply-craft':'前往补给料理台','supply-trade':'前往补给货台','supply-manage':'前往补给经营台','supply-orders':'前往补给委托台','alchemy-craft':'前往炼金调配台','alchemy-trade':'前往炼金货台'};

/** Presentation follows the core metadata; it never grants progress or rewards. */
function picture(floor:TowerFloorView):[string,string|number] {
 if(floor.metric==='cooked')return ['object','pot'];
 if(floor.metric==='buildings')return ['building','lodge'];
 if(floor.metric==='projects')return ['object','book'];
 if(floor.metric==='relics')return ['relic',0];
 if(floor.target==='garden')return ['crop','herb'];
 if(floor.target==='companions')return ['companion',floor.metric==='recruits'?1:0];
 if(floor.target==='ledger')return ['object','ledger'];
 if(floor.target.startsWith('alchemy'))return ['good','dew'];
 if(floor.target.startsWith('supply'))return floor.metric==='job'||floor.metric==='keeper'?['npc','merchant']:['material','ration'];
 return ['companion',0];
}

export async function towerPage():Promise<void> {
 ensureInnerArt();ensureChapterStyle();document.body.classList.add('tower');document.title=APP_NAME+' · 成就之塔';
 for(const name of ['tower.css','mastery-panel.css','action-feedback.css']){if(document.querySelector(`link[data-tower-style="${name}"]`))continue;const style=document.createElement('link');style.rel='stylesheet';style.href=new URL(name,document.baseURI).href;style.dataset.towerStyle=name;document.head.append(style);}
 $('root').innerHTML=`<main class="t-shell" id="towerUi" data-motion="paused" data-status="loading" aria-label="成就之塔">
 <header class="t-header"><div class="t-brand"><span class="t-brand-mark" aria-hidden="true">✦</span><h1>成就之塔</h1></div><div class="t-summary"><strong id="towerClaimed">0</strong><span>/ 20 盏星灯</span></div><div class="t-window-actions">${button('towerContinue','查看下一盏星灯',icon('target'))}${button('towerMinimize','最小化成就之塔','−')}${button('towerClose','关闭成就之塔','×')}</div></header>
 <nav class="t-page-tabs" aria-label="塔内展示"><button id="towerFieldTab" type="button" aria-pressed="false">野外挑战</button><button id="towerGuideTab" type="button" aria-pressed="true">开张与初行</button><button id="towerLegacyTab" type="button" aria-pressed="true">星灯之路</button><button id="towerMasteryTab" type="button" aria-pressed="false">精通纪念<span id="masteryReadyBadge"></span></button></nav><section id="towerGuidePanel" class="ch-tower"><h2>一家店，一次远行</h2><div id="towerGuideNodes" class="ch-nodes"></div><h3 id="towerGuideTitle"></h3><p id="towerGuideDetail"></p><button id="towerGuideGo" type="button"></button><p class="ch-next">下一步：继续整备与经营，查看现有装备。</p><div class="ch-secondary"><button id="towerGuideReplay" type="button">回看战斗演示</button><button id="towerGuideSkip" type="button">跳过引导</button></div><p>本章四灯记录真实进展，不另发奖励。</p></section><div class="t-layout" id="towerLegacyPanel"><section class="t-ascent" aria-label="楼层星灯"><nav class="t-chapters" aria-label="成就之塔章节">${chapters.map((name,i)=>button('towerChapter'+i,`第${i+1}章 ${name}`,`<b aria-hidden="true">${['Ⅰ','Ⅱ','Ⅲ','Ⅳ','Ⅴ'][i]}</b><span>${name}</span>`,'t-chapter').replace('<button ',`<button data-chapter="${i}" aria-pressed="${i===0}" `)).join('')}</nav><div class="t-scene"><img class="t-interior" src="assets/tower-0130/tower-interior.webp" alt="暖灯照亮的奇幻藏书塔，木梯与书架通向上方的星光" draggable="false"><div class="t-scene-plaque"><strong id="towerChapterName">第一章 · 街角</strong><span id="towerChapterProgress">0 / 4 盏灯</span></div><div class="t-floor-path" role="group" aria-label="选择本章楼层">${towerFloors.map(f=>button('towerFloor'+f.id,`第${f.id}层 ${f.title}`,`<span class="t-lamp" aria-hidden="true">✧</span><span class="t-floor-copy"><strong>${esc(f.title)}</strong><span id="towerFloorState${f.id}">正在读取</span></span><span class="t-floor-index">${String(f.id).padStart(2,'0')}</span>`,'t-floor').replace('<button ',`<button data-floor="${f.id}" data-status="locked" aria-pressed="false" `)).join('')}</div></div></section>
 <article class="t-detail" id="towerDetail" aria-labelledby="towerFloorTitle"><div class="t-tableau"><div class="t-object-stage"><span id="towerHeroArt" class="inner-art t-hero-art" data-kind="object" data-art="book" aria-hidden="true"></span></div><div class="t-tableau-copy"><span class="t-kicker" id="towerFloorNumber">第 1 层</span><h2 id="towerFloorTitle">街角第一步</h2><span class="t-stamp" id="towerFloorStatus" data-status="active">正在点亮</span></div></div>
 <div class="t-goal-space"><p class="t-guide" id="towerInstruction">正在打开营地档案…</p><div class="t-goals"><div class="t-goal" id="towerGoal" data-complete="false"><strong id="towerGoalText"></strong><b id="towerGoalCount"></b><progress id="towerGoalProgress" max="1" value="0" aria-label="本层成就进度"></progress></div></div><p class="t-inline-note" id="towerClaimReason"></p>
 <p id="towerRouteReason" class="t-inline-note" role="status" hidden></p><details id="towerTrainingDetails" hidden><summary id="towerTrainingSummary">查看培养缺项</summary><ul id="towerTrainingNeeds"></ul></details></div><div class="t-bottom"><div class="t-rewards" aria-label="本层一次奖励"><strong>本层赠礼</strong><span class="t-reward" id="towerReward-coins">${icon('gold')}<span id="towerRewardCount-coins"></span></span><span class="t-reward" id="towerReward-flour">${artMarkup('material','flour')}<span id="towerRewardCount-flour"></span></span><span class="t-reward" id="towerReward-ore">${artMarkup('material','ore')}<span id="towerRewardCount-ore"></span></span><span class="t-reward" id="towerReward-biscuit">${artMarkup('food','biscuit')}<span id="towerRewardCount-biscuit"></span></span></div><div class="t-commands">${button('towerGo','前往目标地点',icon('home')+'<span id="towerGoLabel">前往</span>','t-go')}${button('towerChoiceA','选择第一条路线','<span id="towerChoiceALabel"></span>','t-go')}${button('towerChoiceB','选择第二条路线','<span id="towerChoiceBLabel"></span>','t-go')}${button('towerClaim','领取本层一次奖励',artMarkup('object','cashbox')+'<span id="towerClaimLabel">收下赠礼</span>','t-claim')}${button('towerNext','查看下一层目标',icon('target')+'<span id="towerNextLabel">查看下一层</span>','t-claim')}</div></div></article></div>
 <footer class="t-footer"><span class="t-footer-dot" aria-hidden="true"></span><span id="towerNotice" role="status" aria-live="polite">正在打开营地档案…</span></footer>
 <div class="t-state" id="towerState"><section class="t-state-card" role="status">${artMarkup('object','book')}<h2 id="towerStateTitle">正在打开成就之塔</h2><p id="towerStateText">等待营地档案就绪。</p>${button('towerRetry','重新读取营地档案','重新读取')}</section></div></main>`;
 const challenge=new FieldChallengePanel(a=>{void masterySend(a);});$('towerLegacyPanel').after(challenge.element);
 const mastery=new MasteryPanel(a=>{void masterySend(a);});$('towerLegacyPanel').after(mastery.element);
 const root=$('towerUi'),controller=new AbortController(),signal=controller.signal;
 let state:ShellState|undefined,profile:Profile|undefined,selected=1,chapter=0,initialized=false,tab:'chapter'|'legacy'|'mastery'|'field'='chapter',busy=false,error='',disposed=false,unsubscribe:(()=>void)|undefined;
 const motion=bindLivingMotion(root,()=>!!state?.workingElsewhere||state?.mode==='hidden'||!!state?.tower?.suspended,()=>{});
 const feedback=bindActionFeedback({host:root,state:()=>state});
 const on=(id:string,fn:()=>void)=>$(id).addEventListener('click',fn,{signal});
 const choose=(id:number)=>{if(!towerFloors.some(f=>f.id===id))return;tab='legacy';selected=id;chapter=Math.floor((id-1)/4);reflect();};
 const setButton=(id:string,disabled:boolean,tip:string)=>{const b=$<HTMLButtonElement>(id);b.disabled=disabled;b.dataset.tooltip=tip;b.setAttribute('aria-label',tip);GameButton.enhance(b);};

 function reflect():void {
  challenge.element.hidden=tab!=='field';$('towerFieldTab').setAttribute('aria-pressed',String(tab==='field'));if(profile)challenge.update(profile,busy);
  $('towerGuidePanel').hidden=tab!=='chapter';$('towerGuideTab').setAttribute('aria-pressed',String(tab==='chapter'));
  if(profile){const v=chapterView(profile),i=chapterIntent(profile);const html=v.nodes.map(n=>`<span class="${n.done?'ch-done':''}"><i>${n.done?'✦':'◇'}</i>${n.title}</span>`).join('');if($('towerGuideNodes').innerHTML!==html)$('towerGuideNodes').innerHTML=html;put('towerGuideTitle',v.enrolled?i.label:'从一家店开始');put('towerGuideDetail',v.enrolled?v.reason:'按自己的节奏体验开张与初行；原有星灯和精通随时可看。');put('towerGuideGo',v.step==='complete'?'查看下一件装备':v.enrolled?(v.skipped?'恢复当前引导':'前往当前目标'):'开始整备');setButton('towerGuideGo',busy,'前往当前章节目标');}
  $('towerLegacyPanel').hidden=tab!=='legacy';mastery.element.hidden=tab!=='mastery';$('towerLegacyTab').setAttribute('aria-pressed',String(tab==='legacy'));$('towerMasteryTab').setAttribute('aria-pressed',String(tab==='mastery'));
  motion.sync();feedback.sync();root.setAttribute('aria-busy',String(busy));root.dataset.busy=String(busy);root.dataset.status=state?.game.status??'loading';
  const blocked=state?.game.status==='blocked',ready=!!profile&&state?.game.status==='ready';
  $('towerState').hidden=ready;
  put('towerStateTitle',blocked?'营地档案暂不可用':'正在打开成就之塔');
  put('towerStateText',blocked?(state?.game.error||'档案尚未就绪，请稍后重新读取。'):error||'等待营地档案就绪。');
  setButton('towerRetry',busy,'重新读取营地档案');
  if(!ready||!profile){
   for(const b of Array.from(root.querySelectorAll<HTMLButtonElement>('.t-layout button,.mastery-panel button')))b.disabled=true;
   setButton('towerContinue',true,'营地档案尚未就绪');put('towerNotice',error||state?.game.error||'正在打开营地档案…');return;
  }
  mastery.update(profile,busy);const masteryReady=masteryView(profile).filter(v=>v.status==='ready').length;put('masteryReadyBadge',masteryReady?` · ${masteryReady}可领`:'');
  const view=towerView(profile),floor=view.floors.find(f=>f.id===selected)??view.floors[0];
  selected=floor.id;put('towerClaimed',String(view.claimed));
  for(let i=0;i<chapters.length;i++){
   const floors=view.floors.slice(i*4,i*4+4),node=$('towerChapter'+i);
   node.setAttribute('aria-pressed',String(chapter===i));node.dataset.ready=String(floors.some(f=>f.status==='ready'));
   setButton(node.id,false,`第${i+1}章 ${chapters[i]}，已点亮${floors.filter(f=>f.status==='claimed').length}盏星灯`);
  }
  put('towerChapterName',`第${['一','二','三','四','五'][chapter]}章 · ${chapters[chapter]}`);
  put('towerChapterProgress',`${view.floors.slice(chapter*4,chapter*4+4).filter(f=>f.status==='claimed').length} / 4 盏灯`);
  for(const f of view.floors){
   const node=$('towerFloor'+f.id);node.hidden=Math.floor((f.id-1)/4)!==chapter;node.dataset.status=f.status;node.setAttribute('aria-pressed',String(f.id===selected));
   put('towerFloorState'+f.id,statusNames[f.status]);setButton(node.id,false,`第${f.id}层 ${f.title}，${statusNames[f.status]}`);
   const lamp=node.querySelector<HTMLElement>('.t-lamp')!;if(lamp.textContent!==(f.status==='claimed'?'✦':'✧'))lamp.textContent=f.status==='claimed'?'✦':'✧';
  }
  $('towerDetail').dataset.floor=String(floor.id);$('towerDetail').dataset.status=floor.status;
  put('towerFloorNumber',`第 ${floor.id} 层`);put('towerFloorTitle',floor.title);put('towerFloorStatus',statusNames[floor.status]);$('towerFloorStatus').dataset.status=floor.status;
  const [kind,art]=picture(floor),hero=$('towerHeroArt');hero.dataset.kind=kind;hero.dataset.art=String(art);
  put('towerInstruction',floor.detail);put('towerGoalText',floor.goal);put('towerGoalCount',`${floor.progress} / ${floor.required}`);
  const progress=$<HTMLProgressElement>('towerGoalProgress');progress.max=floor.required;progress.value=floor.progress;progress.setAttribute('aria-label',`${floor.goal}，${floor.progress} / ${floor.required}`);$('towerGoal').dataset.complete=String(floor.progress>=floor.required);
  const why=busy?'操作提交中…':floor.claimReason;
  put('towerClaimReason',floor.status==='claimed'?'本层赠礼已收入背包。':why||'目标已完成，收下这一层的赠礼。');
  const names={coins:'金币',flour:'面粉',ore:'月纹石',biscuit:'莓果饼'};
  for(const key of ['coins','flour','ore','biscuit'] as const){const n=floor.reward[key]??0;$('towerReward-'+key).hidden=!n;put('towerRewardCount-'+key,`${n} ${names[key]}`);}
  const route=towerDestination(profile,floor.id),roomBlocked=campTowerTargets.includes(route.target)&&state?.room.role!=='none';
  const routeReason=roomBlocked?towerRoomReason:route.reason;
  put('towerRouteReason',routeReason);$('towerRouteReason').hidden=!routeReason;
  const goLabel=targetNames[route.target]??'前往目标地点';put('towerGoLabel',goLabel);setButton('towerGo',busy||!!routeReason,routeReason||goLabel);
  const split=floor.id===11||floor.id===12;$('towerGo').hidden=split;
  for(const [suffix,label]of [['A',floor.id===11?'补给特色餐盒':'补给普通委托'],['B',floor.id===11?'炼金调配':'炼金特色委托']] as const){$('towerChoice'+suffix).hidden=!split;put('towerChoice'+suffix+'Label',label);setButton('towerChoice'+suffix,busy,label);}
  $('towerTrainingDetails').hidden=floor.id!==16;
  if(floor.id===16){const training=trainingGuidance(profile);put('towerInstruction',floor.progress>=1?'一阶培养目标已完成。':`${training.name} · ${training.missing.length?training.reason||'备齐条件后学习一阶专长。':'培养条件已齐，可前往学习专长。'}`);put('towerTrainingSummary',`${training.name} · 查看实际培养条件`);const text=training.requirements.join('\n');if($('towerTrainingNeeds').dataset.content!==text){$('towerTrainingNeeds').dataset.content=text;$('towerTrainingNeeds').replaceChildren(...training.requirements.map(value=>{const li=document.createElement('li');li.textContent=value;return li;}));}}
  put('towerClaimLabel',floor.status==='claimed'?'已收下赠礼':busy?'正在收取…':'收下赠礼');$('towerClaim').dataset.claimed=String(floor.status==='claimed');
  setButton('towerClaim',busy||!!floor.claimReason,why||`领取第${floor.id}层一次赠礼`);
  $('towerClaim').hidden=floor.status==='claimed';$('towerNext').hidden=floor.status!=='claimed';
  put('towerNextLabel',view.next===null?'星灯全部点亮':'查看下一层');
  setButton('towerNext',busy||view.next===null,view.next===null?'20盏星灯已全部点亮':`查看第${view.next}层目标`);
  setButton('towerContinue',view.next===null,view.next===null?'全部星灯已点亮':`查看第${view.next}层，下一盏星灯`);
  put('towerNotice',error||profile.notice||'点击星灯，查看下一步。');
 }

 function update(next:ShellState):void {
  state=next;profile=next.game.profile??undefined;
  if(!initialized&&profile){const view=towerView(profile);selected=view.next??towerFloors.length;chapter=Math.floor((selected-1)/4);initialized=true;}
  reflect();document.body.dataset.towerReady='true';
 }
 async function read():Promise<void> {if(busy||disposed)return;busy=true;error='';reflect();try{update(await window.street.state());}catch(e){error=commandErrorText(e);}finally{busy=false;reflect();document.body.dataset.towerReady='true';}}
 async function command(value:Command):Promise<void> {if(busy||disposed)return;busy=true;error='';reflect();try{update(await window.street.command(value));}catch(e){error=commandErrorText(e);}finally{busy=false;reflect();}}
 async function claim():Promise<void> {
  if(busy||!profile)return;const floor=towerView(profile).floors.find(f=>f.id===selected);if(!floor||floor.claimReason)return;
  const token=feedback.begin(),envelope={sequence:profile.sequence+1,requestId:crypto.randomUUID(),action:{type:'tower-claim' as const,floor:selected}};
  busy=true;error='';reflect();
  try{const next=await window.street.command({type:'tower-action',envelope});update(next);feedback.finish(token,true,next.game.profile?.notice??'');}
  catch(e){error=commandErrorText(e);feedback.finish(token,false,error);try{update(await window.street.state());}catch{}}
  finally{busy=false;reflect();}
 }
 async function masterySend(action:MasteryAction|FieldChallengeAction):Promise<void>{if(busy||!profile)return;const token=feedback.begin();const envelope={sequence:profile.sequence+1,requestId:crypto.randomUUID(),action};busy=true;error='';reflect();try{const next=await window.street.command({type:'tower-action',envelope});update(next);feedback.finish(token,true,next.game.profile?.notice??'');}catch(e){error=commandErrorText(e);feedback.finish(token,false,error);try{update(await window.street.state());}catch{}}finally{busy=false;reflect();}}
 on('towerGuideTab',()=>{tab='chapter';reflect();});on('towerGuideGo',()=>{if(state&&profile)void command({type:'chapter',generation:state.epoch+1,op:chapterView(profile).step==='complete'?'open':profile.chapter?'resume':'start'});});on('towerGuideReplay',()=>{if(state)void command({type:'chapter',generation:state.epoch+1,op:'replay'});});on('towerGuideSkip',()=>{if(state)void command({type:'chapter',generation:state.epoch+1,op:'skip'});});
 on('towerFieldTab',()=>{tab='field';reflect();});on('towerLegacyTab',()=>{tab='legacy';reflect();});on('towerMasteryTab',()=>{tab='mastery';reflect();});
 for(const f of towerFloors)on('towerFloor'+f.id,()=>choose(f.id));
 for(let i=0;i<chapters.length;i++)on('towerChapter'+i,()=>{chapter=i;if(Math.floor((selected-1)/4)!==i){const view=profile&&towerView(profile),available=view?.floors.slice(i*4,i*4+4).find(f=>f.status==='active'||f.status==='ready');selected=available?.id??i*4+1;}reflect();});
 on('towerContinue',()=>{const next=profile&&towerView(profile).next;if(next)choose(next);});
 on('towerNext',()=>{const next=profile&&towerView(profile).next;if(next)choose(next);});
 on('towerGo',()=>{const floor=profile&&towerView(profile).floors.find(f=>f.id===selected);if(floor)void command({type:'tower-route',floor:floor.id});});
 const routeChoice=(second:boolean)=>{if(selected!==11&&selected!==12)return;const choice:TowerRouteChoice=selected===11?(second?'alchemy-craft':'supply-specials'):(second?'atelier-orders':'ordinary-orders');void command({type:'tower-route',floor:selected,choice});};
 on('towerChoiceA',()=>routeChoice(false));on('towerChoiceB',()=>routeChoice(true));
 on('towerClaim',()=>{void claim();});on('towerRetry',()=>{void read();});
 on('towerClose',()=>{void window.street.command({type:'tower-close'}).catch(e=>{error=commandErrorText(e);reflect();});});
 on('towerMinimize',()=>{void window.street.command({type:'tower-minimize'}).catch(e=>{error=commandErrorText(e);reflect();});});
 for(const b of Array.from(root.querySelectorAll<HTMLButtonElement>('button')))GameButton.enhance(b);
 const dispose=()=>{if(disposed)return;disposed=true;unsubscribe?.();controller.abort();motion.dispose();feedback.dispose();};
 window.addEventListener('pagehide',dispose,{once:true});window.addEventListener('beforeunload',dispose,{once:true});
 unsubscribe=window.street.subscribe(next=>{if(!disposed)update(next);});
 reflect();await read();
}
