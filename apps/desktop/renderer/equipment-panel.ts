import {inventoryPartyReason} from './inventory-party-affordance';
import {masterySmallArt,masteryBadgeText} from './mastery-art';
import {roomDisplayBadge} from '../../../packages/solo-core/mastery';
import {equipmentOf,equipmentEffects,activeEquipmentEffects,equipmentRecipeEntries,EQUIPMENT_SLOTS,EQUIPMENT_SLOT_NAMES,type EquipmentSlot,type Profile} from '../../../packages/solo-core';
import {inventoryAction} from '../../../packages/solo-core/inventory-actions';
import {inventoryArt} from './inventory-art';
import {equipmentCosts,equipmentEffectText} from './equipment-presentation';
import {setGeneratedMarkup} from './generated-markup';
const shortNames:Record<EquipmentSlot,string>={head:'头',body:'身',hands:'手',mainhand:'主手',accessory:'饰品',feet:'足'};
/** Camp identity illustration with actual owned IDs in six independent slots. */
export class EquipmentPanel {
 readonly element=document.createElement('section');
 private slots=new Map<EquipmentSlot,HTMLButtonElement>();
 private recipes=new Map<string,HTMLElement>();
 private recipePicks=new Map<string,HTMLButtonElement>();
 private selectedRecipe='';
 private profile:Profile|null=null;
 private partyBusy=false;
 private recipeFilter:EquipmentSlot|'all'='all';
 constructor(private bind:(button:HTMLButtonElement,id:()=>string|null)=>void,private craft:(id:string)=>void,private closeDetails:()=>void){
  this.element.className='equipment-panel';this.element.hidden=true;
  this.element.innerHTML=`<div class="equipment-heading"><h2>底部冒险装备</h2><button type="button" id="equipmentRecipes" aria-expanded="false" aria-controls="equipmentDrawer">制作装备</button></div><div class="equipment-paperdoll"><div class="equipment-slots equipment-slots-left"></div><figure class="equipment-portrait"><img src="assets/equipment-0160/hero-portrait.webp" alt="棕发青蓝衣的冒险者" draggable="false"><span class="equipment-mastery-ornament" role="img" tabindex="0" hidden></span></figure><div class="equipment-slots equipment-slots-right"></div></div><p class="equipment-effects" id="equipmentEffects"></p><p class="equipment-legacy" id="equipmentLegacy" hidden>永久护符 · 已强化</p><section id="equipmentDrawer" class="equipment-drawer" aria-label="装备配方" hidden><div class="equipment-drawer-heading"><h3>装备配方</h3><button type="button" data-recipe-close aria-label="收起装备配方">收起</button></div><nav class="equipment-recipe-filters" aria-label="装备类型"></nav><nav class="equipment-recipe-picks" aria-label="选择制作目标"></nav><div class="equipment-recipes"></div></section>`;
  for(const [i,slot] of EQUIPMENT_SLOTS.entries()){
   const b=document.createElement('button');b.type='button';b.className='inventory-item equipment-slot';b.dataset.slot=slot;b.dataset.tooltipOwner='custom';b.innerHTML='<span class="equipment-slot-type"></span><span class="equipment-slot-art"></span><span class="equipment-slot-name"></span>';b.querySelector('.equipment-slot-type')!.textContent=EQUIPMENT_SLOT_NAMES[slot];
   this.slots.set(slot,b);this.element.querySelector(i<3?'.equipment-slots-left':'.equipment-slots-right')!.append(b);this.bind(b,()=>{const id=this.profile&&equipmentOf(this.profile).slots[slot];return id?'equipment:'+id:null;});
   b.addEventListener('click',()=>{if(this.profile&&!equipmentOf(this.profile).slots[slot])this.openRecipes(slot);});
  }
  const filters=this.element.querySelector('.equipment-recipe-filters')!;
  for(const key of ['all',...EQUIPMENT_SLOTS] as const){const b=document.createElement('button');b.type='button';b.textContent=key==='all'?'全部':shortNames[key];b.dataset.recipeFilter=key;b.addEventListener('click',()=>{this.closeDetails();this.recipeFilter=key;this.renderRecipes();});filters.append(b);}
  this.element.querySelector('#equipmentRecipes')!.addEventListener('click',()=>{if(this.drawer.hidden)this.openRecipes('all');else this.closeRecipes();});this.element.querySelector('[data-recipe-close]')!.addEventListener('click',()=>this.closeRecipes());
  for(const button of Array.from(this.element.querySelectorAll('button')))button.classList.add('game-button');
 }
 private get drawer():HTMLElement{return this.element.querySelector('#equipmentDrawer')!;}
 node(id:string):HTMLButtonElement|undefined{return [...this.slots.values()].find(b=>b.dataset.itemId===id);}
 private closeRecipes():void{this.closeDetails();this.drawer.hidden=true;this.element.querySelector('#equipmentRecipes')!.setAttribute('aria-expanded','false');}
 openRecipes(slot:EquipmentSlot|'all'):void{this.closeDetails();this.recipeFilter=slot;this.drawer.hidden=false;this.element.querySelector('#equipmentRecipes')!.setAttribute('aria-expanded','true');this.renderRecipes();this.drawer.scrollIntoView({block:'nearest'});}
 update(p:Profile|null,partyBusy=false):void{
  this.partyBusy=partyBusy;this.profile=p;this.element.hidden=!p;if(!p){this.closeRecipes();return;}
  const ornament=this.element.querySelector<HTMLElement>('.equipment-mastery-ornament')!,worn=roomDisplayBadge(p);ornament.hidden=!worn;if(ornament.dataset.medal!==(worn??'')){ornament.dataset.medal=worn??'';ornament.innerHTML=worn?masterySmallArt(worn,20):'';ornament.dataset.tooltip=worn?masteryBadgeText(worn):'';ornament.setAttribute('aria-label',ornament.dataset.tooltip);}
  const e=equipmentOf(p);
  for(const slot of EQUIPMENT_SLOTS){const b=this.slots.get(slot)!,id=e.slots[slot],key=id?'equipment:'+id:'';
   if(b.dataset.itemId!==key){b.removeAttribute('aria-describedby');b.dataset.itemId=key;b.querySelector('.equipment-slot-art')!.innerHTML=id?inventoryArt(key):'<span class="equipment-empty">＋</span>';b.querySelector('.equipment-slot-name')!.textContent=id?equipmentRecipeEntries(p).find(r=>r.equipmentId===id)!.name:'空槽 · 制作';}
   const name=b.querySelector('.equipment-slot-name')!.textContent!;b.setAttribute('aria-label',EQUIPMENT_SLOT_NAMES[slot]+'，'+name+(id?'，已穿戴':''));b.classList.toggle('is-equipped',!!id);
  }
  const active=p.run&&p.equipment?.active?.runId===p.run.id;
  this.element.querySelector('#equipmentEffects')!.textContent=p.run?`本趟 · ${active?equipmentEffectText(activeEquipmentEffects(p)):'无装备快照，无装备加成'}`:`下趟 · ${equipmentEffectText(equipmentEffects(e.slots))}`;
  (this.element.querySelector('#equipmentLegacy') as HTMLElement).hidden=!p.upgraded;this.renderRecipes();
 }
 private renderRecipes():void{
  const p=this.profile;if(!p)return;
  for(const b of Array.from(this.element.querySelectorAll<HTMLButtonElement>('[data-recipe-filter]')))b.setAttribute('aria-pressed',String(b.dataset.recipeFilter===this.recipeFilter));
  const entries=equipmentRecipeEntries(p),visible=entries.filter(r=>this.recipeFilter==='all'||r.slot===this.recipeFilter);
  if(!visible.some(r=>r.id===this.selectedRecipe))this.selectedRecipe=visible[0]?.id??'';
  for(const r of entries){
   let pick=this.recipePicks.get(r.id);
   if(!pick){pick=document.createElement('button');pick.type='button';pick.className='game-button equipment-recipe-pick';pick.dataset.recipePick=r.id;pick.dataset.tooltip=r.name;pick.setAttribute('aria-label',r.name);pick.innerHTML=inventoryArt(r.iconId);pick.addEventListener('click',()=>{this.closeDetails();this.selectedRecipe=r.id;this.renderRecipes();});this.recipePicks.set(r.id,pick);this.element.querySelector('.equipment-recipe-picks')!.append(pick);}
   pick.hidden=this.recipeFilter!=='all'&&r.slot!==this.recipeFilter;pick.setAttribute('aria-pressed',String(r.id===this.selectedRecipe));
   let row=this.recipes.get(r.id);
   if(!row){row=document.createElement('article');row.className='equipment-recipe';row.dataset.recipeId=r.id;row.innerHTML=`<div class="equipment-recipe-title">${inventoryArt(r.iconId)}<div><h4>${r.name}</h4><p>${r.effect}</p></div></div><div class="equipment-costs"></div><div class="equipment-recipe-action"><button type="button" class="game-button">制作</button><p class="equipment-recipe-reason"></p></div>`;row.querySelector('button')!.addEventListener('click',()=>{this.closeDetails();this.craft(r.id);});this.recipes.set(r.id,row);this.element.querySelector('.equipment-recipes')!.append(row);}
   row.hidden=r.id!==this.selectedRecipe;
   const quote=inventoryAction(p,{itemId:r.id,kind:'craft',count:1}).quote;quote.reason=inventoryPartyReason(r.id,'craft',this.partyBusy)||quote.reason;const cost=row.querySelector<HTMLElement>('.equipment-costs')!,markup=equipmentCosts(quote.costs??[]);setGeneratedMarkup(cost,markup);
   const b=row.querySelector('button')!;b.disabled=!!quote.reason;b.textContent=r.owned?'已持有':'制作';b.dataset.disabledReason=quote.reason;row.querySelector('.equipment-recipe-reason')!.textContent=r.owned?'已持有 · 可在装备槽或背包查看':quote.reason;
  }
 }
}
