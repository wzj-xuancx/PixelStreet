import {inventoryArt} from './inventory-art';
const adventureId=(kind:string,id:string|number)=>kind==='good'&&['herbal-bandage','mining-tonic'].includes(String(id))?'atelier:'+id:kind==='material'&&['bone','curseCrystal','toughHide'].includes(String(id))?'field:'+id:'';
export function setInnerArt(e:HTMLElement,kind:string,id:string|number):void {const key=adventureId(kind,id);e.dataset.kind=kind;e.dataset.art=String(id);if(e.dataset.adventureArt!==(key||'')){e.dataset.adventureArt=key;e.innerHTML=key?inventoryArt(key):'';}}
/** Object art shared by the actual operating pages, independent of economy state. */
export function ensureInnerArt():void {
  if(typeof document==='undefined'||document.querySelector('link[data-inner-art]'))return;
  const link=document.createElement('link');link.rel='stylesheet';link.href=new URL('inner-art.css',document.baseURI).href;link.dataset.innerArt='true';document.head.append(link);
}
const attr=(value:string|number)=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function artMarkup(kind:string,id:string|number,extra=''):string {
  ensureInnerArt();return `<span class="inner-art ${attr(extra)}" data-kind="${attr(kind)}" data-art="${attr(id)}" data-adventure-art="${adventureId(kind,id)}" aria-hidden="true">${adventureId(kind,id)?inventoryArt(adventureId(kind,id)):""}</span>`;
}
