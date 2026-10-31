import type {Profile} from '../../../packages/solo-core';
import {MASTERY_IDS,MASTERY_GOALS,masteryView,masteryChapters,type MasteryAction} from '../../../packages/solo-core/mastery';
import {masteryBadge,masterySmallArt,masteryBadgeText} from './mastery-art';
import {GameButton} from './game-button';
const text=(node:Element,value:string)=>{if(node.textContent!==value)node.textContent=value;};
export class MasteryPanel {
 readonly element=document.createElement('section');
 private start:HTMLButtonElement;
 constructor(private send:(action:MasteryAction)=>void){
  this.element.className='mastery-panel';this.element.id='masteryPanel';this.element.hidden=true;
  this.element.innerHTML=`<div class="mastery-intro"><div><h2>选择留下的纪念</h2><p id="masteryStartHint">开启后记录 · 纪念物可装饰人物头像</p></div><button id="masteryStart" type="button">开启精通</button></div><div class="mastery-lines">${(['business','idle'] as const).map((line,i)=>`<section class="mastery-chapter" data-line="${line}"><header><h3>${i?'远征精通':'经营精通'}</h3><span class="mastery-chapter-state"></span></header>${MASTERY_IDS.slice(i*3,i*3+3).map(id=>`<article class="mastery-niche" data-goal="${id}" data-status="active"><div class="mastery-preview" aria-label="${MASTERY_GOALS[id].name}纪念物预览">${masteryBadge(id,32)}</div><div class="mastery-copy"><h4>${MASTERY_GOALS[id].name}</h4><p>${MASTERY_GOALS[id].goal}</p><strong class="mastery-progress"></strong><div class="mastery-actions"><button type="button" data-claim="${id}">领取</button><button type="button" data-wear="${id}" hidden>佩戴</button></div></div><details><summary role="button" aria-label="${MASTERY_GOALS[id].name}：查看目标详情" data-tooltip="${masteryBadgeText(id)}">目标详情</summary><div class="mastery-goal-detail">${masterySmallArt(id,48)}<p>${MASTERY_GOALS[id].detail}</p></div></details></article>`).join('')}</section>`).join('')}</div>`;
  this.start=this.element.querySelector('#masteryStart')!;this.start.addEventListener('click',()=>this.send({type:'mastery-start'}));
  for(const id of MASTERY_IDS){this.element.querySelector(`[data-claim="${id}"]`)!.addEventListener('click',()=>this.send({type:'mastery-claim',id}));this.element.querySelector(`[data-wear="${id}"]`)!.addEventListener('click',()=>this.send(this.element.querySelector(`[data-goal="${id}"]`)!.getAttribute('data-worn')==='true'?{type:'mastery-unwear'}:{type:'mastery-wear',id}));}
  for(const b of Array.from(this.element.querySelectorAll<HTMLElement>('button,summary[role=button]')))GameButton.enhance(b);
 }
 update(p:Profile,busy:boolean):void{
  this.start.hidden=!!p.mastery;this.start.disabled=busy;this.start.dataset.tooltip='开启后记录真实成交、委托与远征；纪念物用于头像展示';GameButton.enhance(this.start);text(this.element.querySelector('#masteryStartHint')!,p.mastery?'真实选择点亮纪念 · 可领取后佩戴':'开启后记录 · 纪念物可装饰人物头像');
  const chapters=masteryChapters(p);for(const line of ['business','idle'] as const){const chapter=this.element.querySelector<HTMLElement>(`[data-line="${line}"]`)!;chapter.dataset.complete=String(chapters[line]);text(chapter.querySelector('.mastery-chapter-state')!,chapters[line]?'章饰已点亮':`${p.mastery?.claimed.filter(id=>MASTERY_GOALS[id].line===line).length??0} / 3`);}
  for(const v of masteryView(p)){const tile=this.element.querySelector<HTMLElement>(`[data-goal="${v.id}"]`)!;tile.dataset.status=v.status;tile.dataset.worn=String(v.worn);text(tile.querySelector('.mastery-progress')!,v.status==='claimed'?(v.worn?'已佩戴':'已珍藏'):v.status==='ready'?'可领取':p.mastery?`${v.progress} / ${v.required}`:'开启后记录');const claim=tile.querySelector<HTMLButtonElement>('[data-claim]')!,wear=tile.querySelector<HTMLButtonElement>('[data-wear]')!;claim.hidden=v.status==='claimed';claim.disabled=busy||!!v.claimReason;claim.dataset.tooltip=busy?'操作提交中…':v.claimReason||`领取${v.name}，仅纪念展示`;claim.setAttribute('aria-label',claim.dataset.tooltip);wear.hidden=v.status!=='claimed';wear.disabled=busy;text(wear,v.worn?'卸下':'佩戴');wear.setAttribute('aria-label',`${v.worn?'卸下':'佩戴'}${v.name}头像装饰`);GameButton.enhance(claim);GameButton.enhance(wear);}
 }
}
