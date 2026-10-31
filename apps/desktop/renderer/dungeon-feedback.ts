import {Container,Graphics,Text} from 'pixi.js';
import type {CombatFeedback} from '../../../packages/dungeon-core/combat-state';
export interface FeedbackOptions {showNumbers:boolean;effectsEnabled:boolean;reducedMotion:boolean}
/** Short, local contact marks. These never pause simulation or gate room completion. */
export class DungeonFeedback {
 private seen=new Set<string>();private order:string[]=[];
 private events=new Map<string,CombatFeedback>();private numbers=new Map<string,Text>();
 private spare:Text[]=[];
 constructor(private layer:Container){}
 clear():void{this.seen.clear();this.order=[];this.events.clear();for(const text of this.numbers.values()){text.visible=false;this.spare.push(text);}this.numbers.clear();}
 accept(events:readonly CombatFeedback[]):void{
  for(const event of events){if(this.seen.has(event.id))continue;
   this.seen.add(event.id);this.order.push(event.id);if(this.order.length>256)this.seen.delete(this.order.shift()!);
   if(this.events.size>=96){const oldest=this.events.keys().next().value!;this.recycle(oldest);this.events.delete(oldest);}
   this.events.set(event.id,event);
  }
 }
 private recycle(id:string):void{const text=this.numbers.get(id);if(text){text.visible=false;this.numbers.delete(id);this.spare.push(text);}}
 draw(graphics:Graphics,now:number,options:FeedbackOptions,zoom:number):void{
  const grouped=new Set<string>();
  for(const [id,event]of this.events){
   const age=Math.max(0,now-event.at),life=event.kind==='heavy'||event.kind==='kill'?260:160;
   if(age>420){this.recycle(id);this.events.delete(id);continue;}
   const t=Math.min(1,age/life),alpha=(1-t)*.9,point=event.point;
   if(options.effectsEnabled&&alpha>0&&!['miss','already-hit'].includes(event.kind)){
    const direction=Math.atan2(event.direction.y,event.direction.x),color=event.kind==='block'?0xd4e4e5:event.kind==='immune'?0x7ba6ae:event.kind==='dot'?0xea9b62:event.targetId==='player'?0xf09887:event.kind==='heavy'?0xffd58f:0xf6e0b6;
    const heavy=event.kind==='heavy',radius=heavy?15:7,spread=options.reducedMotion?0:t*(heavy?12:5);
    if(event.kind==='block'){
     for(const sign of [-1,1]){const a=direction+sign*.8;graphics.moveTo(point.x,point.y).lineTo(point.x+Math.cos(a)*(12+spread),point.y+Math.sin(a)*(12+spread));}
     graphics.stroke({color,width:2,alpha});
    }else if(event.kind==='immune')graphics.circle(point.x,point.y,8).stroke({color,width:1,alpha});
    else if(event.kind==='dot')graphics.circle(point.x,point.y,2+t*2).fill({color,alpha:alpha*.6});
    else{
     const count=heavy?6:event.kind==='kill'?5:3;
     for(let i=0;i<count;i++){const a=direction+(i-(count-1)/2)*.9,start=3+spread,end=radius+spread;
      graphics.moveTo(point.x+Math.cos(a)*start,point.y+Math.sin(a)*start).lineTo(point.x+Math.cos(a)*end,point.y+Math.sin(a)*end);}
     graphics.stroke({color,width:heavy?3:2,alpha});
    }
   }
   const key=`${event.sourceId}:${event.targetId}:${event.at}:${event.damage}`;
   const number=options.showNumbers&&event.damage>0&&['hit','heavy','kill','dot'].includes(event.kind)&&!grouped.has(key);
   grouped.add(key);
   if(number){
    let text=this.numbers.get(id);
    if(!text){text=this.spare.pop()??new Text({text:'',style:{fontFamily:'-apple-system,PingFang SC,sans-serif',fontSize:17,fontWeight:'600',fill:0xffe6b3,stroke:{color:0x14201d,width:3}}});text.anchor.set(.5);if(!text.parent)this.layer.addChild(text);this.numbers.set(id,text);}
    text.text=String(Math.round(event.damage));text.tint=event.targetId==='player'?0xffa99a:event.kind==='dot'?0xe6b48c:0xffffff;
    text.position.set(point.x,point.y-12-(options.reducedMotion?0:Math.min(24,age*.06)));
    text.scale.set(1/Math.max(.5,zoom));text.alpha=Math.max(0,1-age/420);text.visible=true;
   }else this.recycle(id);
  }
 }
 dispose():void{for(const text of [...this.numbers.values(),...this.spare])text.destroy();this.numbers.clear();this.spare=[];this.events.clear();this.seen.clear();}
}
