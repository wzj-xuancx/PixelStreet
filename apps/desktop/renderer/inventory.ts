import {ItemCardPreview} from './item-card';
import {equipmentOwnedEntries,petOwnedEntries,type Profile} from '../../../packages/solo-core';
import {EquipmentPanel} from './equipment-panel';
import {PetPanel} from './pet-panel';
import {InventoryActions} from './inventory-actions';
import {inventoryEntries,type InventoryEntry,type InventoryCategory} from '../../../packages/solo-core/inventory-view';
import type {ShellState} from '../../../packages/protocol';
import {icon,iconButton} from './icons';
import {inventoryArt} from './inventory-art';
import {InventoryDetails} from './inventory-details';
export async function inventoryPage():Promise<void>{
 document.body.classList.add('popover','inventory-page');document.body.dataset.detached='true';
 const root=document.getElementById('root')!;
 root.innerHTML=`<section class="inventory-shell"><header class="panel-drag"><h1>${icon('bag')}<span>背包</span></h1><div class="inventory-wallet" aria-label="金币">${icon('gold')}<strong id="inventoryGold">—</strong></div>${iconButton('inventoryClose','close','收起背包')}</header><nav class="inventory-pages" aria-label="背包页面"><button type="button" data-page="items" aria-pressed="true">物品</button><button type="button" data-page="pet" aria-pressed="false">宠物</button></nav><div class="inventory-content"><section class="inventory-items-page" id="inventoryItems"><div id="equipmentMount"></div><nav class="inventory-filters" aria-label="物品分类"></nav><div class="inventory-summary" id="inventorySummary" role="status">正在读取行囊…</div><div class="inventory-grid" aria-label="持有物品"></div></section><div id="petMount" hidden></div><div class="inventory-state" role="status" id="inventoryState"></div><div class="inventory-feedback" id="inventoryFeedback" role="status"></div><div class="inventory-error" id="inventoryError" role="alert"></div></div></section>`;
 const grid=root.querySelector<HTMLElement>('.inventory-grid')!,filters=root.querySelector<HTMLElement>('.inventory-filters')!,message=document.getElementById('inventoryState')!,error=document.getElementById('inventoryError')!,summary=document.getElementById('inventorySummary')!;
 let profile:Profile|null=null;let snapshot:ShellState|undefined;
 let page:'items'|'pet'='items';
 let generation=0,acknowledged=0,dataError=false,entries:InventoryEntry[]=[],filter:'all'|InventoryCategory='all';
 const nodes=new Map<string,HTMLButtonElement>(),filterNodes=new Map<string,HTMLButtonElement>();
 let equipment:EquipmentPanel,pet:PetPanel;
 const node=(id:string)=>page==='pet'?pet?.node(id):nodes.get(id)??equipment?.node(id);
 const actions=new InventoryActions(()=>profile,()=>generation,id=>node(id),state=>apply(state),text=>{document.getElementById('inventoryFeedback')!.textContent=text;},()=>!!snapshot?.game.party?.busy);
 const sharing=new ItemCardPreview(()=>snapshot,id=>node(id),state=>apply(state),text=>{document.getElementById('inventoryFeedback')!.textContent=text;});
 const details=new InventoryDetails(id=>page==='pet'?(profile?petOwnedEntries(profile).find(e=>e.id===id):undefined):id.startsWith('equipment:')?profile?equipmentOwnedEntries(profile).find(e=>e.id===id&&(e.equipped||filter==='all'||filter==='equipment')):undefined:entries.find(e=>e.id===id&& (filter==='all'||e.category===filter)),id=>node(id),link=>{error.textContent='';void window.street.command({type:'inventory-link',generation,target:link.target}).catch(e=>{error.textContent=String(e).replace(/^Error: /,'');});},id=>[...actions.menu(id),...sharing.menu(id)],()=>{actions.clear();sharing.clear();});
 equipment=new EquipmentPanel((b,id)=>details.bind(b,id),id=>actions.open(id,'craft'),()=>details.clear());document.getElementById('equipmentMount')!.append(equipment.element);
 pet=new PetPanel((b,id)=>details.bind(b,id),(id,kind)=>actions.open(id,kind),()=>details.clear());document.getElementById('petMount')!.append(pet.element);
 for(const b of Array.from(root.querySelectorAll<HTMLButtonElement>('[data-page]')))b.addEventListener('click',()=>{details.clear();void window.street.command({type:'inventory-page',generation,page:b.dataset.page as 'items'|'pet'}).then(apply).catch(e=>error.textContent=String(e).replace(/^Error: /,''));});
 root.querySelector('.inventory-content')!.addEventListener('scroll',()=>details.clear());
 document.getElementById('inventoryClose')!.addEventListener('click',()=>{details.clear();void window.street.command({type:'inventory-close',generation}).catch(e=>error.textContent=String(e));});
 function render():void{
  const categories=[['all','全部'],['material','材料'],['supply','补给'],['crafted','成品'],['equipment','装备'],['petgear','宠物装备']] as const;
  if(filter!=='all'&&!entries.some(e=>e.category===filter))filter='all';
  for(const [id,label]of categories){
   let button=filterNodes.get(id);
   if(id!=='all'&&!entries.some(e=>e.category===id)){button?.remove();filterNodes.delete(id);continue;}
   if(!button){button=document.createElement('button');button.type='button';button.dataset.filter=id;button.textContent=label;button.addEventListener('click',()=>{details.clear();filter=id;render();});filterNodes.set(id,button);filters.append(button);}
   button.setAttribute('aria-pressed',String(filter===id));
  }
  const ids=new Set(entries.map(e=>e.id));for(const [id,button]of nodes)if(!ids.has(id)){button.remove();nodes.delete(id);}
  for(const item of entries){
   let button=nodes.get(item.id);
   if(!button){button=document.createElement('button');button.type='button';button.className='inventory-item';button.dataset.itemId=item.id;button.dataset.tooltipOwner='custom';button.innerHTML=inventoryArt(item.iconId)+'<strong class="inventory-count"></strong>';nodes.set(item.id,button);details.bind(button,item.id);const next=entries.slice(entries.indexOf(item)+1).map(e=>nodes.get(e.id)).find(Boolean);grid.insertBefore(button,next??null);}
   const label=`${item.name}，持有 ${item.quantity} 份`;if(button.getAttribute('aria-label')!==label)button.setAttribute('aria-label',label);
   const count=button.querySelector('.inventory-count')!,value=item.quantity<10000?String(item.quantity):new Intl.NumberFormat('zh-CN',{notation:'compact',maximumFractionDigits:1}).format(item.quantity);if(count.textContent!==value)count.textContent=value;
   button.hidden=filter!=='all'&&item.category!==filter;
  }
  summary.textContent=`${entries.length} 种物品`;
  message.textContent=entries.length?'':'行囊还是空的，收集与制作的物品会出现在这里。';message.hidden=entries.length>0||page==='pet';
  equipment.update(profile,!!snapshot?.game.party?.busy);pet.update(profile,!!snapshot?.game.party?.busy);details.sync();actions.sync();sharing.sync();
 }
 const apply=(state:ShellState)=>{
  if(snapshot?.inventory?.generation!==state.inventory?.generation)sharing.clear();snapshot=state;
  generation=state.inventory?.generation??0;
  const nextPage=state.inventory?.page??'items';if(nextPage!==page){details.clear();pet.stopGesture();page=nextPage;root.querySelector('.inventory-content')!.scrollTop=0;}
  document.body.dataset.inventoryPage=page;document.getElementById('inventoryItems')!.hidden=page!=='items';document.getElementById('petMount')!.hidden=page!=='pet';for(const b of Array.from(root.querySelectorAll<HTMLButtonElement>('[data-page]')))b.setAttribute('aria-pressed',String(b.dataset.page===page));
  if(generation>0&&acknowledged!==generation){acknowledged=generation;void window.street.command({type:'inventory-ready',generation}).catch(e=>{dataError=true;error.textContent=String(e);});}
  if(state.inventory?.suspended){details.clear();pet.stopGesture();}
  profile=state.game.profile;
  if(!profile||state.game.status!=='ready'){
   details.clear();equipment.update(null);pet.update(null);entries=[];for(const button of nodes.values())button.remove();nodes.clear();filters.replaceChildren();filterNodes.clear();summary.textContent='';document.getElementById('inventoryGold')!.textContent='—';
   message.hidden=false;message.replaceChildren(document.createTextNode(state.game.status==='blocked'?'暂时无法读取行囊。':'正在读取行囊…'));
   if(state.game.error){dataError=true;error.textContent=state.game.error;const retry=document.createElement('button');retry.type='button';retry.textContent='重新读取';retry.addEventListener('click',()=>{retry.disabled=true;void window.street.state().then(apply).catch(e=>{error.textContent=String(e);retry.disabled=false;});});message.append(retry);}return;
  }
  if(dataError){error.textContent='';dataError=false;}
  const gold=document.getElementById('inventoryGold')!,value=profile.coins.toLocaleString('zh-CN');if(gold.textContent!==value)gold.textContent=value;
  entries=inventoryEntries(profile);render();
 };
 try{apply(await window.street.state());}catch(e){dataError=true;message.textContent='暂时无法读取行囊。';error.textContent=String(e);const retry=document.createElement('button');retry.textContent='重新读取';retry.addEventListener('click',()=>{void window.street.state().then(apply).catch(e=>error.textContent=String(e));});message.append(retry);}
 window.street.subscribe(apply);document.body.dataset.inventoryReady='true';

}
