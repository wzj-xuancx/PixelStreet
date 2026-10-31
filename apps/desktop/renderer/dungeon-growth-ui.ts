import {activeWeapon,evolutionOptions,mechanismInfo,transferInfo,upgradeChoices,weaponName,type DungeonRun,type MechanismId,type WeaponItem} from '../../../packages/dungeon-core';

export interface GrowthArt {
 weapon:(item:WeaponItem,size:number)=>string;
 mechanism:(id:MechanismId,size:number)=>string;
}
const esc=(text:string)=>text.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));

/** Presentation consumes the core's costs, ranks and branch eligibility. */
export function mechanismHint(run:DungeonRun,id:MechanismId):string {
 const info=mechanismInfo(run,id),active=info.usableSlots.includes(run.player.activeSlot);
 return `${info.name} · ${info.rank||1}级 · ${info.description}${active?'':info.usableSlots.length?' · 备用武器适用':' · 当前装备未适用'}`;
}

export function growthCards(run:DungeonRun):string {
 return `<h2>选择成长</h2><div class="d-upgrade-options">${upgradeChoices(run).map((choice,index)=>`<button data-upgrade-index="${index}" title="${esc(choice.detail)}"><span class="d-choice-number">${index+1}</span><b>${esc(choice.label)}</b><span class="d-card-effect">${esc(choice.detail)}</span>${choice.kind==='mechanism'?`<span class="d-card-rank">${choice.operation==='rank-up'?`${choice.currentRank} → ${choice.targetRank} 级`:choice.requiresReplacement?'选择替换一个机制':'新机制'}</span>`:''}${choice.synergy===activeWeapon(run)?.kind?'<em>当前武器适用</em>':''}</button>`).join('')}</div>`;
}

export function replacementCards(run:DungeonRun,incoming:MechanismId,selected:0|1|2|null,pending:boolean,art:GrowthArt):string {
 const next=mechanismInfo(run,incoming,1),old=selected===null?null:mechanismInfo(run,run.player.traits[selected]);
 const slots=run.player.traits.map((id,index)=>{const info=mechanismInfo(run,id);return `<button type="button" data-replacement-slot="${index}" aria-pressed="${selected===index}" title="${esc(mechanismHint(run,id))}" class="${selected===index?'selected':''}"><span class="d-replacement-slot-label"><span class="d-choice-number">${index+1}</span>${art.mechanism(id,22)}<b>${esc(info.name)} ${info.rank}</b></span></button>`;}).join('');
 const preview=old?`<div class="d-replacement-preview"><section class="d-replacement-effect lost"><span>失去 · ${old.rank}级</span><b>${esc(old.name)}</b><p>${esc(old.description)}</p></section><span class="d-replacement-arrow" aria-hidden="true">→</span><section class="d-replacement-effect gained"><span>获得 · 1级</span><b>${esc(next.name)}</b><p>${esc(next.description)}</p></section></div>`:'<p class="d-replacement-prompt">选择要替换的机制</p>';
 return `<h2>替换机制</h2><div class="d-replacement-options">${slots}</div>${preview}<div class="d-replacement-actions"><button type="button" data-cancel-replacement ${pending?'disabled':''}>取消</button><button type="button" class="primary" data-confirm-replacement ${selected===null||pending?'disabled':''}>${pending?'确认中…':'确认替换'}</button></div>`;
}

export function altarBranches(run:DungeonRun,art:GrowthArt):string {
 const weapon=activeWeapon(run),options=evolutionOptions(run);
 if(!weapon||!options.length)return '<p>这把武器没有进阶形态</p>';
 const progress=`<div class="d-altar-status">${art.weapon(weapon,28)}<b>${esc(weaponName(weapon))}</b><span class="${weapon.level===5?'met':''}">${weapon.evolved?'已进阶':`Lv ${weapon.level}/5`}</span></div>`;
 if(weapon.evolved)return `${progress}<p>${esc(options.find(option=>option.form===weapon.form)?.detail??'进阶形态已保留')}</p>`;
 const branches=options.map(option=>{
  const missing=option.requirements.find(requirement=>!requirement.met),reasons:Record<string,string>={weapon:'当前武器没有进阶形态',level:'需要武器 Lv5',mechanism:'需要一项适配机制',altar:'靠近祭坛',unused:'祭坛已使用，或后段战斗已完成'},reason=missing?(reasons[missing.key]??missing.label):option.canEvolve?'确认进阶':'当前无法进阶';
  const mechanisms=option.compatible.map(id=>{const info=mechanismInfo(run,id);return `<span class="d-compatible-chip ${info.owned?'met':''}">${art.mechanism(id,18)}<span>${esc(info.name)}</span><b>${info.owned?'✓':'○'}</b></span>`;}).join('');
  return `<button type="button" data-evolve="${option.form}" class="d-branch ${option.canEvolve?'primary':''}" ${option.canEvolve?'':'disabled'} title="${esc(reason+' · '+option.detail)}"><b>${esc(option.name)}</b><span class="d-branch-effect">${esc(option.detail)}</span><span class="d-compatible-list">${mechanisms}</span></button>`;
 }).join('');
 return `${progress}<div class="d-evolution-branches">${branches}</div>`;
}

export function transferPreview(run:DungeonRun,sourceSlot:0|1,pending:boolean,art:GrowthArt):string {
 const destinationSlot=sourceSlot===0?1:0,info=transferInfo(run,sourceSlot,destinationSlot),source=run.player.weaponSlots[sourceSlot],destination=run.player.weaponSlots[destinationSlot];
 const item=(weapon:WeaponItem|null,before:number,after:number)=>`<section>${weapon?art.weapon(weapon,44):''}<b>${weapon?esc(weaponName(weapon)):'空槽'}</b><span>Lv ${before} → ${after}</span></section>`;
 return `<h2>强化转移</h2><div class="d-transfer-items">${item(source,info.sourceLevel,info.sourceLevelAfter)}<button type="button" data-reverse-transfer ${pending?'disabled':''} aria-label="反转转移方向" title="反转转移方向">⇄</button>${item(destination,info.destinationLevel,info.destinationLevelAfter)}</div><p class="d-transfer-result">${info.canTransfer?`转移 ${info.levelsMoved} 级 · 本局一次`:esc(info.reason)}</p><div class="d-replacement-actions"><button type="button" data-cancel-transfer ${pending?'disabled':''}>取消</button><button type="button" class="primary" data-confirm-transfer ${!info.canTransfer||pending?'disabled':''}>${pending?'确认中…':'确认转移'}</button></div>`;
}
