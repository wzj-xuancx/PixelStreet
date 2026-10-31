/** Display-independent simulation and a single invertible world transform. */
export const STEP_MS = 1000 / 60;
export interface Vec {x:number;y:number}
export class FixedClock {
  private last?:number; private carry=0;
  droppedMs=0;
  reset(now?:number):void {this.last=now;this.carry=0;}
  advance(now:number, step:(dt:number)=>void):number {
    if(!Number.isFinite(now))throw Error('时钟无效');
    if(this.last===undefined){this.last=now;return 0;}
    const elapsed=Math.max(0,now-this.last);this.last=now;
    this.droppedMs+=Math.max(0,elapsed-100);this.carry+=Math.min(100,elapsed);
    while(this.carry+1e-7>=STEP_MS){step(STEP_MS);this.carry=Math.max(0,this.carry-STEP_MS);}
    return this.carry/STEP_MS;
  }
}
export class WorldCamera {
  x=0;y=0;zoom=1;width=960;height=540;
  resize(width:number,height:number):void {this.width=Math.max(1,width);this.height=Math.max(1,height);}
  setZoom(value:number):void {if(Number.isFinite(value))this.zoom=Math.min(2,Math.max(.75,value));}
  worldToScreen(p:Vec):Vec{return{x:(p.x-this.x)*this.zoom+this.width/2,y:(p.y-this.y)*this.zoom+this.height/2};}
  screenToWorld(p:Vec):Vec{return{x:(p.x-this.width/2)/this.zoom+this.x,y:(p.y-this.height/2)/this.zoom+this.y};}
  get offset():Vec{return{x:this.width/2-this.x*this.zoom,y:this.height/2-this.y*this.zoom};}
  get visibleWorld():{width:number;height:number}{return{width:this.width/this.zoom,height:this.height/this.zoom};}
}
export function interpolate(a:Vec,b:Vec,alpha:number):Vec {const t=Math.min(1,Math.max(0,alpha));return{x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};}
export function movement(x:number,y:number,speed:number,dtMs:number):Vec {const n=Math.max(1,Math.hypot(x,y));return{x:x/n*speed*dtMs/1000,y:y/n*speed*dtMs/1000};}
export class FrameStats {
  private recent:{at:number;dt:number}[]=[];private recentSum=0;
  private times:number[]=[];private costs:number[]=[];private last?:number;private cursor=0;private sum=0;frames=0;
  reset():void {this.recent=[];this.recentSum=0;this.times=[];this.costs=[];this.last=undefined;this.cursor=0;this.sum=0;this.frames=0;}
  /** Ignore a pause/hidden gap without discarding the measured segment. */
  resetClock():void {this.last=undefined;this.recent=[];this.recentSum=0;}
  record(now:number,cpuSubmissionMs:number):void {
    if(this.last!==undefined){const dt=now-this.last;if(dt>0){
      this.recent.push({at:now,dt});this.recentSum+=dt;while(this.recent.length&&this.recent[0].at<now-1000)this.recentSum-=this.recent.shift()!.dt;
      if(this.times.length<14400){this.times.push(dt);this.costs.push(cpuSubmissionMs);this.sum+=dt;}
      else{this.sum+=dt-this.times[this.cursor];this.times[this.cursor]=dt;this.costs[this.cursor]=cpuSubmissionMs;this.cursor=(this.cursor+1)%14400;}
    }}this.last=now;this.frames++;
  }
  get liveFps():number{return this.recentSum>0?1000*this.recent.length/this.recentSum:0;}
  get fps():number{return this.sum>0?1000*this.times.length/this.sum:0;}
  summary():{samples:number;fps:number;p50:number;p95:number;p99:number;max:number;over60HzBudget:number;over120HzBudget:number;cpuSubmissionP95:number} {
    const sorted=[...this.times].sort((a,b)=>a-b),costs=[...this.costs].sort((a,b)=>a-b);
    const q=(a:number[],p:number)=>a.length?a[Math.min(a.length-1,Math.floor((a.length-1)*p))]:0;
    return{samples:sorted.length,fps:this.fps,p50:q(sorted,.5),p95:q(sorted,.95),p99:q(sorted,.99),max:q(sorted,1),over60HzBudget:sorted.filter(x=>x>1000/60+1e-6).length,over120HzBudget:sorted.filter(x=>x>1000/120+1e-6).length,cpuSubmissionP95:q(costs,.95)};
  }
  raw():{frameMs:number[];cpuSubmissionMs:number[]}{const order=(a:number[])=>this.cursor?[...a.slice(this.cursor),...a.slice(0,this.cursor)]:[...a];return{frameMs:order(this.times),cpuSubmissionMs:order(this.costs)};}
}
