import type {InventoryEntry} from '../../../packages/solo-core/inventory-view';
import type {InventoryLink} from '../../../packages/content/inventory-catalog';
import {showInteractionHint} from './game-button';
import {inventoryArt} from './inventory-art';
import {inventoryDetailPlacement} from './inventory-detail-placement';
/** Local rich details/menu; IDs, never grid positions, own every interaction. */
export class InventoryDetails {
 private detail=document.createElement('aside');
 private menu=document.createElement('div');
 private active:string|null=null;
 private menuId:string|null=null;
 private menuNode:HTMLButtonElement|undefined;
 private menuSignature='';
 private pinned=false;
 private signature='';
 private timer:ReturnType<typeof setTimeout>|undefined;
 private leave:ReturnType<typeof setTimeout>|undefined;
 constructor(private get:(id:string)=>InventoryEntry|undefined,private node:(id:string)=>HTMLButtonElement|undefined,private navigate:(link:InventoryLink)=>void,private actions:(id:string)=>Array<{label:string;reason:string;run:()=>void}>=()=>[],private closeAction:()=>void=()=>{}){
  this.detail.id='inventoryDetails';this.detail.className='inventory-detail';this.detail.hidden=true;this.detail.dataset.interactive='false';this.detail.setAttribute('role','tooltip');
  this.menu.id='inventoryMenu';this.menu.className='inventory-menu';this.menu.setAttribute('role','menu');this.menu.setAttribute('aria-label','物品操作');this.menu.hidden=true;
  document.body.append(this.detail,this.menu);
  this.menu.addEventListener('focusout',event=>{
   if(!this.menuId||this.menu.contains(event.relatedTarget as Node))return;
   this.clear();
  });
  this.detail.addEventListener('pointerenter',()=>clearTimeout(this.leave));
  this.detail.addEventListener('pointerleave',()=>this.deferClose());
  document.addEventListener('pointerdown',e=>{if(!(e.target instanceof Element)||(!e.target.closest('.inventory-item,.inventory-preview')&&!this.detail.contains(e.target)&&!this.menu.contains(e.target)))this.clear();});
  document.addEventListener('keydown',e=>{
   if(e.key==='Escape'&&(this.active||this.menuId)){e.preventDefault();e.stopPropagation();const id=this.menuId;this.clear();if(id)this.node(id)?.focus({preventScroll:true});}
   if(!this.menu.hidden&&['ArrowDown','ArrowUp','Home','End'].includes(e.key)){
    e.preventDefault();const buttons=Array.from(this.menu.querySelectorAll<HTMLButtonElement>('button')),i=buttons.indexOf(document.activeElement as HTMLButtonElement);buttons[e.key==='Home'?0:e.key==='End'?buttons.length-1:(i+(e.key==='ArrowUp'?-1:1)+buttons.length)%buttons.length]?.focus();
   }
  });
  window.addEventListener('blur',()=>this.clear());window.addEventListener('resize',()=>this.clear());
  document.addEventListener('visibilitychange',()=>{if(document.hidden)this.clear();});
 }
 bind(button:HTMLButtonElement,identity:string|(()=>string|null)):void{
  const resolve=()=>typeof identity==='string'?identity:identity();
  button.addEventListener('pointerenter',()=>{clearTimeout(this.leave);clearTimeout(this.timer);if(this.pinned||this.menuId)return;showInteractionHint('',0,0);this.timer=setTimeout(()=>{const id=resolve();if(id)this.show(id);},240);});
  button.addEventListener('pointerleave',()=>{clearTimeout(this.timer);this.deferClose();});
  button.addEventListener('focus',()=>{if(!this.menuId){const id=resolve();if(id){this.pinned=false;this.show(id);}};});
  button.addEventListener('blur',e=>{
   // A direct slot action has already released details before focusing its preview.
   // Native hidden-window focus transitions can report a null relatedTarget.
   if(!this.active&&!this.menuId)return;
   if(e.relatedTarget instanceof Element&&e.relatedTarget.closest('.inventory-preview'))return;
   if(!this.menu.contains(e.relatedTarget as Node)&&!this.detail.contains(e.relatedTarget as Node))this.clear();
  });
  button.addEventListener('click',()=>{this.closeMenu();const id=resolve();if(id){this.pinned=true;this.show(id);}});
  button.addEventListener('contextmenu',e=>{e.preventDefault();const id=resolve();if(id)this.openMenu(id,e.clientX,e.clientY);});
  button.addEventListener('keydown',e=>{if(e.key==='ContextMenu'||(e.shiftKey&&e.key==='F10')){e.preventDefault();const r=button.getBoundingClientRect(),id=resolve();if(id)this.openMenu(id,r.left+r.width/2,r.bottom);}});
 }
 private deferClose():void {if(!this.active||this.pinned||this.menuId||(this.active&&this.node(this.active)?.matches(':focus-visible')))return;clearTimeout(this.leave);this.leave=setTimeout(()=>{if(!this.detail.matches(':hover'))this.clear();},180);}
 private place(element:HTMLElement,x:number,y:number):void {const r=element.getBoundingClientRect();element.style.left=Math.max(8,Math.min(innerWidth-r.width-8,x))+'px';element.style.top=Math.max(8,Math.min(innerHeight-r.height-8,y))+'px';}
 show(id:string):void{
  const item=this.get(id),button=this.node(id);if(!item||!button||button.hidden){this.clear();return;}
  showInteractionHint('',0,0);clearTimeout(this.leave);clearTimeout(this.timer);
  if(this.active&&this.active!==id)this.node(this.active)?.removeAttribute('aria-describedby');
  this.active=id;button.setAttribute('aria-describedby',this.detail.id);
  this.detail.dataset.interactive=String(this.pinned);
  const actions=this.pinned?this.actions(id):[],signature=JSON.stringify([item,this.pinned,actions.map(a=>[a.label,a.reason])]);
  if(this.signature!==signature){this.signature=signature;
  this.detail.innerHTML=`<div class="inventory-detail-heading">${inventoryArt(id)}<div><h2></h2><p class="inventory-detail-quantity"></p></div></div><p class="inventory-detail-use"></p><p class="inventory-detail-source"></p>`;
  this.detail.querySelector('h2')!.textContent=item.name;
  this.detail.querySelector('.inventory-detail-quantity')!.textContent=(item.category==='equipment'||item.category==='petgear')?('equipped' in item&&item.equipped?'已穿戴 · '+(item.category==='petgear'?'苔团子装备':'底部冒险装备'):'已持有 · '+(item.category==='petgear'?'苔团子装备':'底部冒险装备')):`持有 ${item.quantity.toLocaleString('zh-CN')} 份`;
  this.detail.querySelector('.inventory-detail-use')!.textContent=item.useText;
  this.detail.querySelector('.inventory-detail-source')!.textContent=`来源 · ${item.sourceText}`;
  if(actions.length){const controls=document.createElement('div');controls.className='inventory-detail-actions';for(const action of actions){const b=document.createElement('button');b.type='button';b.textContent=action.label;b.disabled=!!action.reason;b.dataset.disabledReason=action.reason;b.addEventListener('click',()=>{this.clear();action.run();});controls.append(b);if(action.reason){const reason=document.createElement('p');reason.className='equipment-recipe-reason';reason.textContent=action.reason;controls.append(reason);}}this.detail.append(controls);}
  }
  this.detail.hidden=false;const detailRect=this.detail.getBoundingClientRect();
  // Measure full content without expanding an existing scrollport on every sync.
  const height=Math.min(innerHeight-16,this.detail.scrollHeight+detailRect.height-this.detail.clientHeight);
  const placement=inventoryDetailPlacement(button.getBoundingClientRect(),{width:innerWidth,height:innerHeight},{width:detailRect.width,height});
  this.detail.style.maxHeight=placement.maxHeight+'px';this.detail.style.left=placement.left+'px';this.detail.style.top=placement.top+'px';
 }
 private closeMenu():void{this.menuId=null;this.menuNode=undefined;this.menuSignature='';this.menu.hidden=true;}
 private openMenu(id:string,x:number,y:number):void{
  const item=this.get(id);if(!item)return;
  this.clear();this.menuId=id;this.menuNode=this.node(id);this.menuSignature=JSON.stringify(this.actions(id).map(a=>[a.label,a.reason]));this.pinned=true;this.menu.replaceChildren();
  const add=(label:string,fn:()=>void,reason='')=>{const b=document.createElement('button');b.type='button';b.dataset.tooltipOwner='custom';b.setAttribute('role','menuitem');b.textContent=label;if(reason){b.setAttribute('aria-disabled','true');b.textContent=label+' · '+reason;}b.addEventListener('click',()=>{if(reason)return;this.closeMenu();fn();});this.menu.append(b);};
  const actions=this.actions(id);for(const action of actions)add(action.label,()=>{this.clear();action.run();},action.reason);
  add('查看详情',()=>{this.node(id)?.focus({preventScroll:true});this.pinned=true;this.show(id);});
  for(const link of item.links){if(actions.some(a=>a.label==='使用')&&['supply-specials','alchemy-craft'].includes(link.target))continue;if(actions.some(a=>a.label==='出售')&&['supply-trade','kitchen'].includes(link.target))continue;add(link.label,()=>{this.clear();this.navigate(link);});}
  this.menu.hidden=false;this.place(this.menu,x,y);this.menu.querySelector('button')?.focus({preventScroll:true});
 }
 sync():void{if(this.menuId&&(!this.get(this.menuId)||this.node(this.menuId)!==this.menuNode||JSON.stringify(this.actions(this.menuId).map(a=>[a.label,a.reason]))!==this.menuSignature))this.clear();if(this.active){if(this.get(this.active)&&this.node(this.active)?.getAttribute('aria-describedby')===this.detail.id)this.show(this.active);else this.clear();}}
 clear():void{this.closeAction();clearTimeout(this.timer);clearTimeout(this.leave);if(this.active)this.node(this.active)?.removeAttribute('aria-describedby');this.active=null;this.signature='';this.pinned=false;this.detail.dataset.interactive='false';this.detail.hidden=true;this.closeMenu();showInteractionHint('',0,0);}
}
