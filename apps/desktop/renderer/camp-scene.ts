import {artMarkup} from './inner-art';
import {PROJECT_IDS,PROJECTS,REGULAR_IDS,REGULARS,villageOf,regularOffer,villageReason,REAGENT_NAMES} from '../../../packages/solo-core';
import {CAMP_LEVELS, COMPANIONS, CROPS, DESTINATIONS, FOODS, JOBS, MATERIALS, SECRET_SITES, bondsOf, campLevel, campOf, contractAt, hasCargo, jobPower, leisureReason, nextCampGoal, roomTitle, type Companion, type GameAction, type LeisureAction, type Material, type Profile} from '../../../packages/solo-core';
import type {ShellState} from '../../../packages/protocol';
import {icon} from './icons';
import {bindLivingMotion} from './living-motion';

export type CampSceneTarget='adventure'|'garden'|'kitchen'|'friends'|'camp'|'collection'|'jobs'|'crew'|'production'|'orders'|'letters'|'projects'|'regulars'|'life'|'plans';
export interface CampSceneContext {buddy?:Companion;plot?:number;slot?:number;regular?:string;station?:string}
export interface CampSceneHooks {state:()=>ShellState|undefined;busy:()=>boolean;open:(target:CampSceneTarget,context?:CampSceneContext)=>void;dispatch:(action:GameAction)=>void}
const button=(id:string,label:string,body:string,extra='')=>`<button type="button" id="${id}" class="game-button cs-object ${extra}" aria-label="${label}" data-tooltip="${label}">${body}</button>`;
const sign=(title:string,id:string)=>`<span class="cs-sign"><strong>${title}</strong><span id="${id}"></span></span>`;
const buddy=(role:string)=>`<span id="csArt-${role}" class="cs-buddy-art" data-buddy="slime" aria-hidden="true"></span><span class="cs-buddy-label" id="csName-${role}"></span><span class="cs-bubble" id="csBubble-${role}" aria-hidden="true"></span>`;
const roles=['leader','support','counter','workshop','garden'] as const;
type Role=typeof roles[number];
export function campSceneMarkup():string {
 return `<section id="campScene" class="camp-scene" data-motion="paused" data-running="false" data-cargo="false" aria-label="悠游营地互动场景">
 <div class="cs-topline"><span>${icon('home')}<strong id="csLevel">营地</strong></span><span id="csSeason">伙伴们在等你</span><button type="button" id="csPlans" class="game-button cs-plan-link" data-tooltip="选择工位和商品，安排有限制作">${artMarkup('object','ledger')}<span>经营安排</span></button></div>
 <div class="cs-scroll"><div class="cs-stage" id="csStage"><div class="cs-landscape" aria-hidden="true"></div><div class="cs-shade" aria-hidden="true"></div>
 ${button('csLodge','查看连续营地建设目标',sign('营地建设','csLodgeLevel'),'cs-lodge')}
 ${button('csKitchen','打开料理工坊',sign('旅人工坊','csKitchenStatus'),'cs-kitchen')}
 ${button('csArchive','查看奇珍与收藏',sign('星光收藏室','csArchiveLevel'),'cs-archive')}
 ${button('csTent','培养伙伴',sign('伙伴帐篷','csRoster'),'cs-tent')}
 <span class="cs-campfire" aria-hidden="true"><i></i><i></i><i></i></span>
 ${button('csFire','在营地安排队伍',`${icon('dungeon')}<span class="cs-sign"><strong>队伍安排</strong></span>`,'cs-fire')}
 ${button('csMap','打开探索地图与冒险安排',`<span class="cs-map-art" aria-hidden="true"></span><span class="cs-sign"><strong>探索地图</strong></span>`,'cs-map')}
 ${button('csPack','查看随身奇珍',`${icon('bag')}<span class="cs-sign"><strong>随身行囊</strong></span>`,'cs-pack')}
 ${[0,1,2].map(i=>button('csPlot'+i,'查看花圃'+(i+1),`<span class="cs-crop-layer" aria-hidden="true"><span id="csCrop${i}" class="cs-crop-art" data-crop="sprout" hidden></span><span class="cs-ready-glint">✦</span></span><span class="cs-plot-tag"><strong id="csPlotName${i}">空花圃</strong><span id="csPlotState${i}"></span></span>`,'cs-plot cs-plot-'+i)).join('')}
 ${roles.map(role=>button('csBuddy-'+role,'查看伙伴',buddy(role),'cs-buddy cs-buddy-'+role)).join('')}
 ${[0,1,2].map(i=>button('csVisitor'+i,'查看旅人委托',`<span class="cs-visitor-figure" aria-hidden="true"><span class="cs-person" data-person="${i}"></span></span><span class="cs-request" id="csRequest${i}"></span><span class="cs-visitor-label" id="csVisitorName${i}"></span>`,'cs-visitor cs-visitor-'+i)).join('')}
 <span class="cs-feedback" id="csFeedback" role="status" aria-live="polite"></span>
 </div></div>
 <div class="cs-dock"><button type="button" id="csJourney" class="game-button cs-journey" data-tooltip="查看当前探索或安排下一次出发"><span class="cs-dock-icon">${icon('target')}</span><span><strong id="csJourneyTitle">挑个地方，出去走走</strong><span id="csJourneyDetail">探索地图</span></span><span class="cs-arrow" aria-hidden="true">›</span></button><div class="cs-loot"><button type="button" id="csLootDetails" class="game-button cs-loot-details" data-tooltip="查看实际战利品"><span class="cs-chest" aria-hidden="true"></span><span><strong id="csCargoTitle">战利品箱</strong><span id="csCargoSummary">空箱子</span></span></button><button type="button" id="csClaim" class="game-button c-primary" aria-label="收入全部战利品" data-tooltip="收入全部战利品">收取</button></div></div>
 <div class="cs-footer"><span id="csGoal"></span><button type="button" id="csJobs" class="game-button" data-tooltip="查看伙伴岗位和经营总览">伙伴岗位</button><button type="button" id="csLetters" class="game-button" data-tooltip="查看真实旅行来信" hidden>旅行来信</button></div></section>`;
}
const time=(ticks:number)=>{const s=Math.max(0,Math.ceil(ticks/10));return s>=60?`${Math.floor(s/60)}分${s%60?`${s%60}秒`:''}`:`${s}秒`;};
export function bindCampScene(h:CampSceneHooks):{reflect:()=>void;dispose:()=>void} {
 const root=document.getElementById('campScene');if(!root)throw Error('campSceneMarkup must be mounted before binding');
 const el=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
 const put=(id:string,value:string)=>{const e=el(id);if(e.textContent!==value)e.textContent=value;};
 const listeners:Array<()=>void>=[];let previous:Profile|undefined,pulse:Animation|undefined;
 const watch=(target:EventTarget,event:string,fn:EventListener)=>{target.addEventListener(event,fn);listeners.push(()=>target.removeEventListener(event,fn));};
 const on=(id:string,fn:()=>void)=>watch(el(id),'click',fn);
 const motion=bindLivingMotion(root,()=>{const state=h.state();return !state||!!state.workingElsewhere||state.mode==='hidden';},()=>pulse?.cancel());
 const mutator=(id:string,action:LeisureAction,label:string)=>{const p=h.state()?.game.profile,busy=h.busy(),reason=p?leisureReason(p,action):'档案尚未就绪。';const b=el<HTMLButtonElement>(id);b.disabled=busy||!!reason;b.dataset.tooltip=busy?'操作提交中。':reason||label;b.setAttribute('aria-label',label+(reason?'：'+reason:''));};
 const safeDispatch=(action:LeisureAction)=>{const p=h.state()?.game.profile;if(!p||h.busy()||leisureReason(p,action))return;h.dispatch(action);};
 for(const [id,target] of [['csLodge','projects'],['csKitchen','kitchen'],['csArchive','collection'],['csTent','friends'],['csFire','crew'],['csMap','adventure'],['csPack','collection'],['csJourney','adventure'],['csLootDetails','adventure'],['csJobs','jobs'],['csLetters','letters'],['csPlans','plans']] as const)on(id,()=>h.open(target));
 on('csClaim',()=>safeDispatch({type:'stroll-claim'}));
 for(let i=0;i<3;i++){
  on('csPlot'+i,()=>{const p=h.state()?.game.profile,plot=p?.leisure.plots[i];if(p&&plot&&p.tick>=plot.due)safeDispatch({type:'garden-harvest',plot:i});else h.open('garden',{plot:i});});
  on('csVisitor'+i,()=>h.open('regulars',{regular:REGULAR_IDS[i]}));
 }
 const companionFor=(p:Profile,role:Role):Companion|null=>role==='leader'?(p.leisure.run?.companion??p.leisure.active):role==='support'?(p.leisure.run?.bonds?.support??(!p.leisure.run?bondsOf(p.leisure).support:null)):campOf(p).jobs[role];
 for(const role of roles)on('csBuddy-'+role,()=>{const p=h.state()?.game.profile,id=p&&companionFor(p,role);if(id)h.open('life',{buddy:id});});
 const feedback=(message:string)=>{put('csFeedback',message);if(root.dataset.motion!=='running')return;pulse?.cancel();pulse=el('csFeedback').animate([{opacity:0,transform:'translateY(5px)'},{opacity:1,transform:'translateY(0)',offset:.12},{opacity:1,offset:.85},{opacity:0}],{duration:2600,easing:'ease-out'});};
 function reflect():void {
  const state=h.state(),p=state?.game.profile,busy=h.busy();motion.sync();root!.setAttribute('aria-busy',String(busy));
  if(!p){put('csSeason',state?.game.error||'正在打开营地…');for(const b of Array.from(root!.querySelectorAll<HTMLButtonElement>('button')))b.disabled=true;return;}
  for(const b of Array.from(root!.querySelectorAll<HTMLButtonElement>('button')))b.disabled=busy;
  const l=p.leisure,b=bondsOf(l),c=campOf(p),r=l.run,level=campLevel(p),cargo=hasCargo(l),readyPlots=l.plots.filter(plot=>plot&&plot.due<=p.tick).length;
  root!.dataset.running=String(!!r);root!.dataset.cargo=String(cargo);root!.dataset.level=String(level);
  put('csLevel',`营地 Lv${level} · ${CAMP_LEVELS[level-1].name}`);put('csSeason',readyPlots?`${readyPlots}块花圃可收获`:r?'远行的脚步没有停下':'此刻，适合慢慢生活');const village=villageOf(p),project=PROJECT_IDS.find(id=>village.projects[id]<3);put('csGoal',project?PROJECTS[project].name+' · '+PROJECTS[project].stages[village.projects[project]]:nextCampGoal(p));
  put('csLodgeLevel',`${Object.values(village.projects).reduce((a,b)=>a+b,0)}/9 阶段`);put('csArchiveLevel',`${b.relics.filter(n=>n>0).length+l.journal.relics.filter(n=>n>0).length}件收藏`);
  const cooking=c.cooking[0];put('csKitchenStatus',cooking?`${FOODS[cooking.food].name} · ${l.materials[cooking.food]>=9999?'满仓等待':time(cooking.due-p.tick)}`:'料理与委托');
  const owned=Object.values(l.companions).filter(x=>x!==null&&x!==undefined).length;put('csRoster',`${owned}位伙伴`);
  el('csLetters').hidden=!b.letters.length;put('csLetters',`来信 ${b.letters.length}`);
  put('csJourneyTitle',r?`${r.bonds?.secret?SECRET_SITES[r.zone].name:DESTINATIONS[r.zone].name} · 第${r.total-r.remaining+1}/${r.total}趟`:cargo?'伙伴带着战利品回来了':'挑个地方，出去走走');
  put('csJourneyDetail',r?`${roomTitle(r)} · ${time(r.due-p.tick)}后前进`:cargo?'收下战利品，再安排下一程':'地图 · 路线 · 探索深度');
  const extras=Object.entries(b.satchel).filter(([,n])=>n>0).map(([m,n])=>`${m==='dust'?'星尘':m==='tokens'?'徽记':MATERIALS[m as Material]}${n}`);
  const loot=[l.cargo.coins?`${l.cargo.coins}金币`:'',l.cargo.xp?`${l.cargo.xp}经验`:'',l.cargo.gel?`${l.cargo.gel}凝胶`:'',l.cargo.ore?`${l.cargo.ore}月纹石`:'',...extras].filter(Boolean);
  put('csCargoTitle',cargo?'战利品等你收下':'战利品箱');put('csCargoSummary',cargo?loot.slice(0,3).join(' · ')+(loot.length>3?` · 另${loot.length-3}种`:''):'还没有战利品');
  el('csLootDetails').dataset.tooltip=cargo?loot.join(' · '):'探索所得会进入这只箱子';mutator('csClaim',{type:'stroll-claim'},'收入全部战利品');
  for(let i=0;i<3;i++){
   const plot=l.plots[i],ready=!!plot&&p.tick>=plot.due,e=el<HTMLButtonElement>('csPlot'+i),art=el('csCrop'+i);
   e.dataset.state=plot?(ready?'ready':'growing'):'empty';art.hidden=!plot;art.dataset.crop=plot?(ready||plot.due-p.tick<CROPS[plot.crop].ticks*.45?plot.crop:'sprout'):'sprout';
   put('csPlotName'+i,plot?CROPS[plot.crop].name:`花圃 ${i+1}`);put('csPlotState'+i,plot?ready?`收获 ×${CROPS[plot.crop].yield+l.gardenLevel+jobPower(p,'garden')}`:time(plot.due-p.tick):'种点什么');
   if(ready)mutator('csPlot'+i,{type:'garden-harvest',plot:i},`收获花圃${i+1}的${CROPS[plot!.crop].name}`);else {e.dataset.tooltip=plot?`${CROPS[plot.crop].name}生长中，点击查看花圃`:`选择种子种入花圃${i+1}`;e.setAttribute('aria-label',e.dataset.tooltip);}
  }
  for(const role of roles){const id=companionFor(p,role),e=el('csBuddy-'+role);e.hidden=!id;if(!id)continue;const away=!!r&&(role==='leader'||role==='support');e.dataset.away=String(away);el('csArt-'+role).dataset.buddy=id;put('csName-'+role,COMPANIONS[id].name);put('csBubble-'+role,away?'远行中':role==='leader'?'领队':role==='support'?'支援':JOBS[role].name+'帮忙');e.dataset.tooltip=`${COMPANIONS[id].name} · ${away?'正在探索':role==='leader'?'领队培养':role==='support'?'支援培养':JOBS[role].name+'岗位'}，点击查看`;e.setAttribute('aria-label',e.dataset.tooltip);}
  for(let i=0;i<3;i++){const offer=regularOffer(p,REGULAR_IDS[i]),reason=villageReason(p,{type:'village-serve',regular:REGULAR_IDS[i],revision:offer.revision}),e=el('csVisitor'+i);e.dataset.ready=String(!reason);put('csVisitorName'+i,REGULARS[REGULAR_IDS[i]].name);put('csRequest'+i,offer.wait?'稍后再来':!reason?'可以接待':REAGENT_NAMES[offer.item]+' ×'+offer.count);e.dataset.tooltip=`${offer.name} · ${offer.role}：${reason||'餐点已经备齐'}；点击人物查看茶席`;e.setAttribute('aria-label',e.dataset.tooltip);}
  if(previous){
   if(p.leisure.harvests>previous.leisure.harvests)feedback('收获入袋，花圃又空出来了');
   else if(hasCargo(previous.leisure)&&!cargo&&p.sequence>previous.sequence)feedback('伙伴的战利品，已经收好了');
   else if(p.sequence!==previous.sequence&&p.notice!==previous.notice)feedback(p.notice);
  }
  previous=p;
 }
 reflect();return {reflect,dispose:()=>{motion.dispose();for(const stop of listeners)stop();}};
}
