import type {Profile} from '../../../packages/solo-core';
import {inventoryAction,inventoryCapabilities,type InventoryActionKind,type InventoryActionRequest,type InventoryQuote} from '../../../packages/solo-core/inventory-actions';
import type {InventoryPreview,ShellState} from '../../../packages/protocol';
import {inventoryPartyReason} from './inventory-party-affordance';
import {inventoryArt} from './inventory-art';
import {equipmentCosts,inventoryActionLabel} from './equipment-presentation';
export class InventoryActions {
 private panel=document.createElement('section');
 private request?:InventoryActionRequest;
 private preview?:InventoryPreview;
 private revision=0;
 private busy=false;
 constructor(private profile:()=>Profile|null,private generation:()=>number,private node:(id:string)=>HTMLElement|undefined,private apply:(state:ShellState)=>void,private feedback:(text:string)=>void,private partyBusy:()=>boolean=()=>false){
  this.panel.id='inventoryPreview';this.panel.className='inventory-preview';this.panel.hidden=true;this.panel.setAttribute('role','dialog');this.panel.setAttribute('aria-modal','false');this.panel.setAttribute('aria-label','确认物品操作');document.body.append(this.panel);
  this.panel.addEventListener('focusout',event=>{if(!this.panel.hidden&&!this.panel.contains(event.relatedTarget as Node))this.clear();});
  document.addEventListener('pointerdown',e=>{if(!this.panel.hidden&&!this.panel.contains(e.target as Node))this.clear();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!this.panel.hidden){e.preventDefault();e.stopPropagation();const id=this.request?.itemId;this.clear();if(id)this.node(id)?.focus({preventScroll:true});}});
  window.addEventListener('blur',()=>this.clear());window.addEventListener('resize',()=>this.clear());document.addEventListener('visibilitychange',()=>{if(document.hidden)this.clear();});
 }
 menu(id:string):Array<{label:string;reason:string;run:()=>void}>{
  const p=this.profile();if(!p)return [];
  return inventoryCapabilities(p,id).map(c=>{
   const request={itemId:id,kind:c.kind,count:c.initial};let reason='';
   try{reason=inventoryAction(p,request).quote.reason;if(reason&&c.mode==='range'){const minimum=id==='bag:flour'?2:1;if(minimum<=c.max&&!inventoryAction(p,{...request,count:minimum}).quote.reason)reason='';}}
   catch(e){reason=String(e).replace(/^Error: /,'');}
   let label=c.label;try{label=inventoryActionLabel(inventoryAction(p,request).quote);}catch{}
   reason=inventoryPartyReason(id,c.kind,this.partyBusy())||reason;
   return {label,reason,run:()=>this.open(id,c.kind)};
  });
 }
 open(itemId:string,kind:InventoryActionKind):void {
  const locked=inventoryPartyReason(itemId,kind,this.partyBusy());if(locked){this.feedback(locked);return;}
  this.clear();const p=this.profile(),cap=p&&inventoryCapabilities(p,itemId).find(c=>c.kind===kind);if(!p||!cap)return;
  this.request={itemId,kind,count:cap.initial};
  this.panel.innerHTML=`<div class="inventory-preview-heading">${inventoryArt(itemId)}<div><h2></h2><p data-owned></p></div></div><label class="inventory-preview-count">数量 <span data-control></span></label><p data-effect></p><div class="equipment-costs" data-costs></div><div class="equipment-comparison" data-comparison></div><p data-reason role="status"></p><div class="inventory-preview-buttons"><button type="button" data-cancel>取消</button><button type="button" data-confirm disabled>确认</button></div>`;
  this.panel.querySelector('h2')!.textContent=inventoryActionLabel(inventoryAction(p,this.request).quote)+' · '+inventoryAction(p,this.request).quote.name;
  const control=this.panel.querySelector('[data-control]')!;
  if(cap.mode==='range'){const input=document.createElement('input');input.type='number';input.min='1';input.max=String(cap.max);input.step='1';input.value=String(cap.initial);input.setAttribute('aria-label','出售数量');input.addEventListener('input',()=>{if(this.request)this.request.count=input.valueAsNumber;void this.refresh();});control.append(input);}
  else if(cap.mode==='one-or-all'&&cap.max>1){const select=document.createElement('select');select.setAttribute('aria-label','出售数量');for(const [n,label]of [[1,'1份'],[cap.max,`全部 ${cap.max} 份`]] as const){const option=document.createElement('option');option.value=String(n);option.textContent=label;select.append(option);}select.addEventListener('change',()=>{if(this.request)this.request.count=Number(select.value);void this.refresh();});control.append(select);}
  else control.textContent=String(cap.initial)+' 份';
  (this.panel.querySelector('.inventory-preview-count') as HTMLElement).hidden=['craft','equip','unequip','pet-leisure','pet-expedition'].includes(kind);
  this.panel.querySelector('[data-cancel]')!.addEventListener('click',()=>this.clear());this.panel.querySelector('[data-confirm]')!.addEventListener('click',()=>void this.confirm());
  this.panel.hidden=false;const r=this.node(itemId)?.getBoundingClientRect();this.place(r?.left??8,r?.bottom??8);this.panel.querySelector<HTMLButtonElement>('[data-cancel]')!.focus({preventScroll:true});void this.refresh();
 }
 private renderQuote(quote:InventoryQuote):void{
  this.panel.querySelector('h2')!.textContent=inventoryActionLabel(quote)+' · '+quote.name;
  this.panel.querySelector('[data-owned]')!.textContent=quote.kind.startsWith('pet-')?'确认后切换苔团子职责；成长与身份保持一致':quote.kind==='craft'?'制作后放入背包，可在营地穿戴':quote.kind==='equip'?'穿戴后下趟底部冒险生效':quote.kind==='unequip'?'卸下后保留在背包':`持有 ${quote.quantity} 份 · 本次消耗 ${quote.count} 份`;
  this.panel.querySelector('[data-effect]')!.textContent=quote.effect;
  this.panel.querySelector('[data-costs]')!.innerHTML=equipmentCosts(quote.costs??[]);
  const compare=this.panel.querySelector('[data-comparison]')!;compare.replaceChildren();
  for(const [label,text] of [['失去',quote.comparison?.removed],['获得',quote.comparison?.added]])if(text){const p=document.createElement('p');p.textContent=label+' · '+text;compare.append(p);}
  this.panel.querySelector('[data-confirm]')!.textContent='确认'+inventoryActionLabel(quote);
 }
 private place(x:number,y:number):void{const r=this.panel.getBoundingClientRect();this.panel.style.left=Math.max(8,Math.min(innerWidth-r.width-8,x))+'px';this.panel.style.top=Math.max(8,Math.min(innerHeight-r.height-8,y))+'px';}
 private async refresh():Promise<void>{
  const revision=++this.revision,request=this.request&&{...this.request},p=this.profile();this.cancelToken();if(!request||!p)return;
  const confirm=this.panel.querySelector<HTMLButtonElement>('[data-confirm]')!;confirm.disabled=true;
  const reason=this.panel.querySelector('[data-reason]')!;
  try{const {quote}=inventoryAction(p,request);this.renderQuote(quote);const locked=inventoryPartyReason(request.itemId,request.kind,this.partyBusy());reason.textContent=locked||quote.reason||'正在核对…';this.place(parseFloat(this.panel.style.left)||8,parseFloat(this.panel.style.top)||8);if(locked||quote.reason)return;
   const prepared=await window.street.previewInventory(this.generation(),request);
   if(revision!==this.revision||!this.request){void window.street.command({type:'inventory-cancel',generation:this.generation(),token:prepared.token}).catch(()=>undefined);return;}
   this.preview=prepared;reason.textContent=prepared.quote.reason;this.renderQuote(prepared.quote);confirm.disabled=!!prepared.quote.reason||this.busy;this.place(parseFloat(this.panel.style.left)||8,parseFloat(this.panel.style.top)||8);
  }catch(e){if(revision===this.revision){reason.textContent=String(e).replace(/^Error: /,'');this.place(parseFloat(this.panel.style.left)||8,parseFloat(this.panel.style.top)||8);}}
 }
 private async confirm():Promise<void>{
  if(this.busy||!this.preview)return;const preview=this.preview;this.preview=undefined;this.busy=true;const revision=this.revision;this.panel.querySelector<HTMLButtonElement>('[data-confirm]')!.disabled=true;
  try{const state=await window.street.command({type:'inventory-confirm',generation:this.generation(),token:preview.token});this.clear();this.apply(state);this.feedback(state.game.profile?.notice||'物品操作已完成。');}
  catch(e){if(revision===this.revision&&!this.panel.hidden){this.panel.querySelector('[data-reason]')!.textContent=String(e).replace(/^Error: /,'')+' 请取消后重新预览。';}else this.feedback(String(e).replace(/^Error: /,''));}
  finally{this.busy=false;}
 }
 sync():void{
  if(!this.request)return;const p=this.profile();
  if(!p||!inventoryCapabilities(p,this.request.itemId).some(c=>c.kind===this.request!.kind)){this.clear();return;}
  // An incomplete number edit is allowed to remain visible with Confirm disabled.
  // Only a prepared quote is invalidated by a changed source/result snapshot.
  if(!this.preview)return;
  try{const {quote}=inventoryAction(p,this.request);if(JSON.stringify(quote)!==JSON.stringify(this.preview.quote)){this.clear();this.feedback('物品或回报已变化，请重新选择。');}}catch{this.clear();}
 }
 private cancelToken():void{if(this.preview){void window.street.command({type:'inventory-cancel',generation:this.generation(),token:this.preview.token}).catch(()=>undefined);this.preview=undefined;}}
 clear():void{this.revision++;this.cancelToken();this.request=undefined;this.panel.hidden=true;}
}
