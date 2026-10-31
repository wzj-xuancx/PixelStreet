import {showInteractionHint} from './game-button';
import {presentationActive,type ShellState} from '../../../packages/protocol';
import {initialOpening,openingReduce,type OpeningState} from './chapter-opening';
import type {PixelScene} from './scene';
/** Overlay-owned scripted frames never enter ShellState.game or the Worker. */
export class ChapterDemo {
 private local=initialOpening();private session=0;private frame=0;private last=0;private pointer=false;private blurred=false;private finishing=0;
 constructor(private scene:PixelScene,private state:()=>ShellState,private apply:(s:ShellState)=>void){
  const strip=document.createElement('div');strip.id='chapterDemoStrip';strip.className='ch-demo-strip';strip.hidden=true;strip.dataset.hit='';
  strip.innerHTML='<span id="chapterDemoLabel">演示 · 不影响正式进度</span><button id="chapterDemoSkip" type="button">跳过</button>';
  document.getElementById('root')!.append(strip);
  document.getElementById('chapterDemoSkip')!.addEventListener('click',()=>{this.local=openingReduce(this.local,{type:'skip'});void this.finish('skip');});
  document.addEventListener('pointermove',e=>{if(e.isTrusted){this.pointer=true;this.blurred=false;this.sync();}});
  document.addEventListener('pointerleave',()=>{this.pointer=false;this.sync();});
  window.addEventListener('blur',()=>{this.blurred=true;this.pointer=false;this.sync();});
  window.addEventListener('focus',()=>{this.blurred=false;this.sync();});
  document.addEventListener('visibilitychange',()=>this.sync());
 }
 private active():boolean {
  const s=this.state();if(!s)return false;return !this.blurred&&presentationActive(s.presentation?.overlay,{pointer:this.pointer,documentVisible:!document.hidden,blocked:s.mode==='hidden'||!!s.workingElsewhere||!s.settings.interactionEnabled||!!s.popup&&!s.popup.suspended});
 }
 update():void {
  const state=this.state(),request=state.chapter?.opening;
  if(state.workingElsewhere||state.mode==='hidden'){this.pointer=false;this.blurred=true;}
  if(request&&request.session!==this.session){this.session=request.session;this.finishing=0;this.local=openingReduce(initialOpening(),{type:'start'});}
  if(!request){this.session=0;this.stop();this.scene.setOpening();}
  else if(request.phase==='finished'){
   this.stop();this.scene.setOpening(request.outcome==='defeated'?{...this.local,phase:'defeated',hp:0}:undefined);
  }else{this.scene.setOpening(this.local);this.sync();}
  const strip=document.getElementById('chapterDemoStrip')!;strip.hidden=!request||request.phase!=='playing';
  const localField=!!request&&request.phase==='playing'||request?.outcome==='defeated';
  document.body.dataset.localDemo=String(localField);
  if(localField)showInteractionHint('',0,0);
 }
 private sync():void {
  const request=this.state().chapter?.opening;
  if(!request||request.phase!=='playing'||!this.active()){this.stop();return;}
  this.local=openingReduce(this.local,{type:'resume'});
  if(!this.frame){this.last=0;this.frame=requestAnimationFrame(now=>this.tick(now));}
 }
 private tick(now:number):void {
  this.frame=0;if(!this.active()||this.state().chapter?.opening?.phase!=='playing')return;
  this.local=openingReduce(this.local,{type:'advance',ms:this.last?now-this.last:0});this.last=now;this.scene.setOpening(this.local);
  document.getElementById('chapterDemoLabel')!.textContent=`演示 · 不影响正式进度 · 生命${this.local.hp}`;
  if(this.local.phase==='defeated')void this.finish('defeated');else this.frame=requestAnimationFrame(next=>this.tick(next));
 }
 private stop():void {if(this.frame)cancelAnimationFrame(this.frame);this.frame=0;this.last=0;this.local=openingReduce(this.local,{type:'suspend'});}
 private async finish(outcome:'skip'|'defeated'):Promise<void> {
  if(!this.session||this.finishing===this.session)return;const own=this.session;this.finishing=own;this.stop();
  try{const next=await window.street.command({type:'chapter-demo-end',generation:this.state().epoch+1,session:own,outcome});if(own===this.session)this.apply(next);}
  catch(error){if(own===this.session){this.finishing=0;document.getElementById('sceneError')!.textContent=String(error);}}
 }
}
export type {OpeningState};
