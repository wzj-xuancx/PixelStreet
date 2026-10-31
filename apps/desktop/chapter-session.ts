import {randomUUID} from 'node:crypto';
import {chapterView,type Profile,type GameAction} from '../../packages/solo-core';
import {chapterFingerprint,chapterIntent,type ChapterQuote} from '../../packages/protocol/chapter';
import {tradeQuote} from '../../packages/solo-core/business';
export class ChapterActionSession {
 private pending?:{generation:number;fingerprint:string;quote:ChapterQuote};
 cancel():void{this.pending=undefined;}
 prepare(p:Profile,generation:number,now=Date.now()):ChapterQuote {
  this.cancel();const intent=chapterIntent(p);if(!intent.purchase||intent.action?.type!=='trade')throw Error('当前步骤不需要采购确认。');if(intent.reason)throw Error(intent.reason);
  const a=intent.action,quote={token:randomUUID(),expiresAt:now+60000,step:chapterView(p).step,label:intent.label,coins:tradeQuote(a.item,a.side,a.count),sequence:p.sequence};
  this.pending={generation,fingerprint:chapterFingerprint(p),quote};return structuredClone(quote);
 }
 valid(p:Profile,generation:number,now=Date.now()):boolean{return !!this.pending&&this.pending.generation===generation&&this.pending.quote.expiresAt>now&&this.pending.fingerprint===chapterFingerprint(p);}
 confirm(p:Profile,generation:number,token:string,now=Date.now()):GameAction {
  const pending=this.pending,valid=this.valid(p,generation,now);this.cancel();if(!pending||!valid||pending.quote.token!==token)throw Error('采购预览已变化，请重新确认。');const i=chapterIntent(p);if(i.reason||!i.purchase||!i.action)throw Error(i.reason||'当前采购已变化。');return i.action;
 }
}
