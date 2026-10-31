import {randomUUID} from 'node:crypto';
import {transact,type Profile} from '../../packages/solo-core';
import {inventoryAction,parseInventoryActionRequest,type InventoryQuote,type InventoryActionRequest} from '../../packages/solo-core/inventory-actions';
export interface InventoryPreview {token:string;expiresAt:number;quote:InventoryQuote}
/** One outstanding, expiring preview per inventory owner; consumed before every commit attempt. */
export class InventoryActionSession {
 private pending?:{generation:number;preview:InventoryPreview;request:InventoryActionRequest};
 prepare(p:Profile,generation:number,raw:unknown,now=Date.now()):InventoryPreview {
  this.pending=undefined;if(!Number.isSafeInteger(generation)||generation<1)throw Error('背包窗口代次无效。');const request=parseInventoryActionRequest(raw),{quote}=inventoryAction(p,request);
  const preview={token:randomUUID(),expiresAt:now+60000,quote};this.pending={generation,preview,request};return structuredClone(preview);
 }
 cancel(token?:string):void {if(!token||this.pending?.preview.token===token)this.pending=undefined;}
 confirm(p:Profile,generation:number,token:string,partySize=1,now=Date.now()):Profile {
  const pending=this.pending;this.pending=undefined;
  if(!pending||pending.generation!==generation||pending.preview.token!==token||pending.preview.expiresAt<=now)throw Error('物品预览已过期，请重新打开确认。');
  const {action,quote}=inventoryAction(p,pending.request);
  if(JSON.stringify(quote)!==JSON.stringify(pending.preview.quote))throw Error('预览后物品或回报已变化，请重新预览。');
  if(quote.reason)throw Error(quote.reason);
  return transact(p,{sequence:p.sequence+1,requestId:token,action},partySize);
 }
}
