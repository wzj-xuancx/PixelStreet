import {masteryBadge} from './mastery-art';
import {ownedItemCard,itemCardDefinition} from '../../../packages/solo-core/item-cards';
import {roomShareReason,type RoomItemCard,type RoomState} from '../../../packages/protocol/room';
import type {ShellState} from '../../../packages/protocol';
import {inventoryArt} from './inventory-art';
import {GameButton} from './game-button';
const artwork=new Map<string,string>();
export function itemCardArt(id:string):string{let markup=artwork.get(id);if(!markup){markup=inventoryArt(id);artwork.set(id,markup);}return markup;}
export function cardContents(card:Pick<RoomItemCard,'itemId'|'quantity'|'badge'>):HTMLElement{
 const item=itemCardDefinition(card.itemId)!;const body=document.createElement('div');body.className='item-card-body';
 body.innerHTML=`<div class="item-card-heading">${itemCardArt(item.iconId)}<div><h2></h2><p data-card-quantity></p></div></div><p class="item-card-effect"></p>${masteryBadge(card.badge,48)}<p class="item-card-label">仅展示 · 物品归原持有者所有</p>`;
 body.querySelector('h2')!.textContent=item.name;body.querySelector('[data-card-quantity]')!.textContent=`持有 ×${card.quantity.toLocaleString('zh-CN')}`;body.querySelector('.item-card-effect')!.textContent=item.useText;return body;
}
const roomKey=(room:RoomState)=>[room.hostId,room.address,room.role].join('|');
/** Read-only local preview. Opening/canceling never invokes IPC or networking. */
export class ItemCardPreview{
 private panel=document.createElement('section');private itemId?:string;private generation=0;private room='';private busy=false;private revision=0;private quantity=0;private failed=false;
 constructor(private state:()=>ShellState|undefined,private node:(id:string)=>HTMLElement|undefined,private apply:(state:ShellState)=>void,private feedback:(text:string)=>void){
  this.panel.id='itemCardPreview';this.panel.className='inventory-preview item-card-preview';this.panel.hidden=true;this.panel.setAttribute('role','dialog');this.panel.setAttribute('aria-label','物品展示预览');document.body.append(this.panel);
  this.panel.addEventListener('focusout',event=>{if(!this.panel.hidden&&!this.panel.contains(event.relatedTarget as Node))this.clear();});
  document.addEventListener('pointerdown',event=>{if(!this.panel.hidden&&!this.panel.contains(event.target as Node))this.clear();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!this.panel.hidden){event.preventDefault();event.stopPropagation();const id=this.itemId;this.clear();if(id)this.node(id)?.focus({preventScroll:true});}});
  window.addEventListener('blur',()=>this.clear());window.addEventListener('resize',()=>this.clear());document.addEventListener('visibilitychange',()=>{if(document.hidden)this.clear();});
 }
 menu(id:string){const state=this.state();return state?.game.profile&&ownedItemCard(state.game.profile,id)?[{label:'分享卡片',reason:'',run:()=>this.open(id)}]:[];}
 open(id:string):void{
  if(this.busy)return;this.clear();const state=this.state(),item=state?.game.profile&&ownedItemCard(state.game.profile,id);if(!state||!item)return;
  this.itemId=id;this.generation=state.inventory?.generation??0;this.room=roomKey(state.room);this.quantity=item.quantity;this.failed=false;
  this.panel.replaceChildren(cardContents({itemId:id,quantity:item.quantity}));
  const reason=document.createElement('p');reason.dataset.shareReason='';reason.setAttribute('role','status');
  const buttons=document.createElement('div');buttons.className='inventory-preview-buttons';
  for(const [key,label]of [['cancel','取消'],['confirm','分享']] as const){const b=document.createElement('button');b.type='button';b.dataset[key]='';b.dataset.shareAction=key;b.textContent=label;GameButton.enhance(b);b.addEventListener('click',()=>key==='cancel'?this.clear():void this.confirm());buttons.append(b);}
  this.panel.append(reason,buttons);this.panel.hidden=false;this.sync();
  const source=this.node(id)?.getBoundingClientRect(),rect=this.panel.getBoundingClientRect();this.panel.style.left=Math.max(8,Math.min(innerWidth-rect.width-8,source?.left??8))+'px';this.panel.style.top=Math.max(8,Math.min(innerHeight-rect.height-8,source?.bottom??8))+'px';
  this.panel.querySelector<HTMLButtonElement>('[data-share-action=cancel]')!.focus({preventScroll:true});
 }
 sync():void{
  if(!this.itemId)return;const state=this.state(),item=state?.game.profile&&ownedItemCard(state.game.profile,this.itemId);
  if(!state||!item||state.game.status!=='ready'||state.inventory?.generation!==this.generation||state.inventory.suspended||roomKey(state.room)!==this.room||['reconnecting','disconnected'].includes(state.room.status)){this.clear();return;}
  if(item.quantity!==this.quantity){this.clear();this.feedback('物品数量已变化，请重新预览。');return;}
  if(this.failed)return;
  const reason=roomShareReason(state.room),button=this.panel.querySelector<HTMLButtonElement>('[data-share-action=confirm]')!;
  const message=this.panel.querySelector('[data-share-reason]')!;if(message.textContent!==reason)message.textContent=reason;const disabled=this.busy||!!reason;if(button.disabled!==disabled)button.disabled=disabled;if(button.dataset.disabledReason!==reason)button.dataset.disabledReason=reason;GameButton.enhance(button);
 }
 private async confirm():Promise<void>{
  const state=this.state();if(this.busy||!this.itemId||!state||roomShareReason(state.room))return;
  const itemId=this.itemId,generation=this.generation,revision=this.revision;this.busy=true;
  for(const b of Array.from(this.panel.querySelectorAll<HTMLButtonElement>('button')))b.disabled=true;
  try{const next=await window.street.command({type:'inventory-share',generation,itemId});this.clear();this.apply(next);this.feedback('已发送物品展示；物品仍归你所有。');}
  catch(error){const text=String(error).replace(/^Error: /,'');if(revision===this.revision&&!this.panel.hidden){this.failed=true;this.panel.querySelector('[data-share-reason]')!.textContent=text;this.panel.querySelector<HTMLButtonElement>('[data-share-action=cancel]')!.disabled=false;}else this.feedback(text);}
  finally{this.busy=false;}
 }
 clear():void{this.revision++;this.itemId=undefined;this.panel.hidden=true;}
}
