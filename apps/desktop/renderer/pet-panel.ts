import {inventoryPartyReason} from './inventory-party-affordance';
import {PET_SLOTS,PET_SLOT_NAMES,PET_GEAR_CATALOG,petIdentity,petsOf,petOwnedEntries,petRecipeEntries,petEffects,activePetEffects,streetPetPresence,type PetSlot,type PetRole,type PetSlots,type PetEffects,type Profile,buddyJob} from '../../../packages/solo-core';
import {inventoryAction,type InventoryActionKind} from '../../../packages/solo-core/inventory-actions';
import {inventoryArt} from './inventory-art';
import {equipmentCosts} from './equipment-presentation';
const setText=(node:Element,value:string):void=>{if(node.textContent!==value)node.textContent=value;};
const setAttr=(node:Element,name:string,value:string):void=>{if(node.getAttribute(name)!==value)node.setAttribute(name,value);};
export const petEffectText=(e:PetEffects):string=>[e.attack?`普攻+${e.attack}`:'',e.defence?`减伤+${e.defence}`:'',e.gather?`远征采集材料+${e.gather}`:''].filter(Boolean).join(' · ')||'无宠物装备加成';
export const petMiniMarkup=(slots:PetSlots):string=>PET_SLOTS.map(slot=>{const id=slots[slot];return `<span class="equipment-mini pet-mini">${id?inventoryArt('petgear:'+id):''}<span>${PET_SLOT_NAMES[slot]} · ${id?PET_GEAR_CATALOG[id].name:'空槽'}</span></span>`;}).join('');
/** The existing slime identity and growth, with three authoritative equipment slots. */
export class PetPanel {
 readonly element=document.createElement('section');
 private profile:Profile|null=null;
 private partyBusy=false;
 private slots=new Map<PetSlot,HTMLButtonElement>();
 private slotSignatures=new Map<PetSlot,string>();
 private recipes=new Map<string,HTMLElement>();
 private recipeCostMarkup=new Map<string,string>();
 private filter:PetSlot|'all'='all';
 private roleAnchor:HTMLButtonElement|undefined;
 private gesture:ReturnType<typeof setTimeout>|undefined;
 constructor(private bind:(button:HTMLButtonElement,id:()=>string|null)=>void,private preview:(id:string,kind:InventoryActionKind)=>void,private closeDetails:()=>void){
  this.element.className='pet-panel';this.element.hidden=true;
  this.element.innerHTML=`<div class="pet-heading"><div><h2 id="petName">苔团子</h2><p id="petSource"></p></div><button type="button" id="petRecipes" aria-controls="petDrawer" aria-expanded="false">制作宠物装备</button></div><div class="pet-dossier"><figure class="pet-portrait">${inventoryArt('pet:slime')}<figcaption id="petGrowth"></figcaption></figure><div class="pet-slots" aria-label="苔团子装备"></div></div><div class="pet-role-row"><span>职责</span><div class="pet-roles" aria-label="苔团子职责"><button type="button" data-role="leisure">休闲</button><button type="button" data-role="expedition">挂机</button></div><button type="button" id="petStroke">摸摸</button></div><p id="petStatus" role="status"></p><p id="petEffects"></p><p id="petGesture" role="status"></p><section id="petDrawer" class="equipment-drawer" aria-label="宠物装备配方" hidden><div class="equipment-drawer-heading"><h3>苔团子的装备</h3><button type="button" data-pet-close>收起</button></div><p id="petUnlock"></p><nav class="equipment-recipe-filters" aria-label="宠物装备类型"></nav><div class="equipment-recipes"></div></section>`;
  for(const slot of PET_SLOTS){const b=document.createElement('button');b.type='button';b.className='inventory-item pet-slot';b.dataset.slot=slot;b.dataset.tooltipOwner='custom';b.innerHTML='<span class="pet-slot-type"></span><span class="pet-slot-art"></span><span class="pet-slot-name"></span>';b.querySelector('.pet-slot-type')!.textContent=PET_SLOT_NAMES[slot];this.slots.set(slot,b);this.element.querySelector('.pet-slots')!.append(b);
   this.bind(b,()=>{const id=this.profile&&petsOf(this.profile).slots[slot];return id?'petgear:'+id:null;});
   b.addEventListener('click',()=>{const p=this.profile;if(!p||petsOf(p).slots[slot])return;const owned=petOwnedEntries(p).find(e=>e.slot===slot);this.closeDetails();if(owned)this.preview(owned.id,'equip');else this.openRecipes(slot);});
  }
  for(const role of ['leisure','expedition'] as const){const b=this.element.querySelector<HTMLButtonElement>(`[data-role="${role}"]`)!;b.addEventListener('click',()=>{const p=this.profile;if(!p||p.pets?.role===role)return;this.closeDetails();this.roleAnchor=b;this.preview('pet:slime',role==='leisure'?'pet-leisure':'pet-expedition');});}
  for(const key of ['all',...PET_SLOTS] as const){const b=document.createElement('button');b.type='button';b.textContent=key==='all'?'全部':PET_SLOT_NAMES[key];b.dataset.petFilter=key;b.addEventListener('click',()=>{this.closeDetails();this.filter=key;this.renderRecipes();});this.element.querySelector('.equipment-recipe-filters')!.append(b);}
  this.element.querySelector('#petRecipes')!.addEventListener('click',()=>{if(this.drawer.hidden)this.openRecipes('all');else this.closeRecipes();});this.element.querySelector('[data-pet-close]')!.addEventListener('click',()=>this.closeRecipes());
  this.element.querySelector('#petStroke')!.addEventListener('click',()=>{if(document.hidden||!this.profile||streetPetPresence(this.profile,'camp').location!=='camp')return;this.stopGesture();this.element.classList.add('is-petted');setText(this.element.querySelector('#petGesture')!,'苔团子轻轻晃了晃叶芽。');this.gesture=setTimeout(()=>this.stopGesture(),900);});
  window.addEventListener('blur',()=>this.stopGesture());document.addEventListener('visibilitychange',()=>{if(document.hidden)this.stopGesture();});
 }
 private get drawer():HTMLElement{return this.element.querySelector('#petDrawer')!;}
 node(id:string):HTMLButtonElement|undefined {if(id==='pet:slime')return this.roleAnchor??this.element.querySelector<HTMLButtonElement>('[data-role="leisure"]')!;return [...this.slots.values()].find(b=>b.dataset.itemId===id);}
 stopGesture():void{clearTimeout(this.gesture);this.gesture=undefined;this.element.classList.remove('is-petted');setText(this.element.querySelector('#petGesture')!,'');}
 private closeRecipes():void{this.closeDetails();this.drawer.hidden=true;setAttr(this.element.querySelector('#petRecipes')!,'aria-expanded','false');}
 openRecipes(slot:PetSlot|'all'):void{this.closeDetails();this.filter=slot;this.drawer.hidden=false;setAttr(this.element.querySelector('#petRecipes')!,'aria-expanded','true');this.renderRecipes();this.drawer.scrollIntoView({block:'nearest'});}
 update(p:Profile|null,partyBusy=false):void{
  this.partyBusy=partyBusy;this.profile=p;if(this.element.hidden!==!p)this.element.hidden=!p;if(!p){this.closeRecipes();this.stopGesture();return;}
  const pet=petsOf(p),identity=petIdentity(p),presence=streetPetPresence(p,'camp'),job=buddyJob(p,'slime');
  setText(this.element.querySelector('#petName')!,identity.name);setText(this.element.querySelector('#petSource')!,identity.source);setText(this.element.querySelector('#petGrowth')!,`Lv${identity.level} · 成长经验 ${identity.xp}`);
  for(const slot of PET_SLOTS){const b=this.slots.get(slot)!,equipped=pet.slots[slot],owned=petOwnedEntries(p).find(e=>e.slot===slot),id=equipped??owned?.petGearId,key=id?'petgear:'+id:'';
   const signature=JSON.stringify([equipped,owned?.petGearId??null]);
   if(this.slotSignatures.get(slot)!==signature){
    this.slotSignatures.set(slot,signature);setAttr(b,'data-item-id',key);b.classList.toggle('is-equipped',!!equipped);
    const art=b.querySelector('.pet-slot-art')!,markup=equipped?inventoryArt(key):'<span class="equipment-empty">＋</span>';if(art.innerHTML!==markup)art.innerHTML=markup;
    setText(b.querySelector('.pet-slot-name')!,equipped?PET_GEAR_CATALOG[equipped].name:owned?'已持有 · 穿戴':'空槽 · 制作');
    setAttr(b,'aria-label',`${PET_SLOT_NAMES[slot]}，${equipped?PET_GEAR_CATALOG[equipped].name+'，已穿戴':owned?owned.name+'，已持有，点击穿戴':'空槽，点击查看配方'}`);
   }
  }
  for(const b of Array.from(this.element.querySelectorAll<HTMLButtonElement>('[data-role]'))){const role=b.dataset.role as PetRole,q=inventoryAction(p,{itemId:'pet:slime',kind:role==='leisure'?'pet-leisure':'pet-expedition',count:1}).quote;q.reason=inventoryPartyReason('pet:slime',role==='leisure'?'pet-leisure':'pet-expedition',this.partyBusy)||q.reason;setAttr(b,'aria-pressed',String(pet.role===role));const disabled=!!q.reason&&p.pets?.role!==role;if(b.disabled!==disabled)b.disabled=disabled;setAttr(b,'data-disabled-reason',q.reason);}
  setText(this.element.querySelector('#petStatus')!,presence.location==='away'?'悠游途中 · 回营后可调整职责和装备':presence.location==='field'?'挂机同行中 · 本趟装备已固定':job?'正在营地岗位帮忙 · 调整挂机职责前先撤岗':pet.role==='expedition'?'挂机职责 · 营地待命，出发时手动选择苔团子同行':'休闲职责 · 在营地陪伴你');
  setText(this.element.querySelector('#petEffects')!,p.run?`本趟 · ${p.pets?.active?.runId===p.run.id?petEffectText(activePetEffects(p)):'未携带宠物装备'}`:`下趟同行 · ${petEffectText(petEffects(pet.slots))}`);
  const stroke=this.element.querySelector<HTMLButtonElement>('#petStroke')!;const away=presence.location!=='camp';if(stroke.disabled!==away)stroke.disabled=away;setAttr(stroke,'data-disabled-reason',away?'苔团子外出中，回营再摸摸。':'');this.renderRecipes();
 }
 private renderRecipes():void{const p=this.profile;if(!p)return;setText(this.element.querySelector('#petUnlock')!,`制作前置 · 首次挂机胜利 ${Math.min(p.totals.wins,1)}/1`);
  for(const b of Array.from(this.element.querySelectorAll<HTMLButtonElement>('[data-pet-filter]')))setAttr(b,'aria-pressed',String(b.dataset.petFilter===this.filter));
  for(const r of petRecipeEntries(p)){let row=this.recipes.get(r.id);if(!row){row=document.createElement('article');row.className='equipment-recipe';row.dataset.recipeId=r.id;row.innerHTML=`<div class="equipment-recipe-title">${inventoryArt(r.iconId)}<div><h4>${r.name}</h4><p>${r.effect}</p></div></div><div class="equipment-costs"></div><div class="equipment-recipe-action"><button type="button">制作</button><p class="equipment-recipe-reason"></p></div>`;row.querySelector('button')!.addEventListener('click',()=>{this.closeDetails();this.preview(r.id,this.profile&&petOwnedEntries(this.profile).some(e=>e.id===r.id)?'equip':'craft');});this.recipes.set(r.id,row);this.element.querySelector('.equipment-recipes')!.append(row);}
   const hidden=this.filter!=='all'&&r.slot!==this.filter;if(row.hidden!==hidden)row.hidden=hidden;const equipped=petsOf(p).slots[r.slot]===r.petGearId,kind=r.owned?'equip':'craft',quote=inventoryAction(p,{itemId:r.id,kind,count:1}).quote;quote.reason=inventoryPartyReason(r.id,kind,this.partyBusy)||quote.reason;const costs=row.querySelector('.equipment-costs')!,markup=r.owned?'':equipmentCosts(quote.costs??[]);if(this.recipeCostMarkup.get(r.id)!==markup){costs.innerHTML=markup;this.recipeCostMarkup.set(r.id,markup);}const b=row.querySelector('button')!;if(b.disabled!==!!quote.reason)b.disabled=!!quote.reason;setText(b,equipped?'已穿戴':r.owned?'穿戴':'制作');setAttr(b,'data-disabled-reason',quote.reason);setText(row.querySelector('.equipment-recipe-reason')!,equipped?'可在装备槽查看或卸下':quote.reason|| (r.owned?'已持有 · 选择穿戴':'制作一件，归苔团子所有'));
  }
 }
}
