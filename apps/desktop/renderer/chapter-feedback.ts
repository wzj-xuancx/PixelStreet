import type {FeedbackFeed,GameplayFeedback} from '../../../packages/solo-core';
/** A subscription is a baseline, never a request to replay retained events. */
export class ChapterFeedbackConsumer {
 private epoch='';private cursor=0;private active=false;private queue:GameplayFeedback[]=[];
 get pending():readonly GameplayFeedback[]{return this.queue;}
 accept(feed:FeedbackFeed):void {
  if(!this.active)return;
  if(feed.epoch!==this.epoch){this.resume(feed);return;}
  const newer=feed.events.filter(e=>e.id>this.cursor&&e.id<=feed.cursor);this.queue=[...this.queue,...newer].slice(-32);this.cursor=Math.max(this.cursor,feed.cursor);
 }
 suspend():void{this.active=false;this.queue=[];}
 resume(feed:FeedbackFeed):void{this.epoch=feed.epoch;this.cursor=feed.cursor;this.queue=[];this.active=true;}
 drain():GameplayFeedback[]{const events=this.queue;this.queue=[];return events;}
}
