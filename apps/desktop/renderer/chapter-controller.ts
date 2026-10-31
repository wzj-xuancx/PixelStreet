import type {ShellState,ChapterOperation,ChapterCommand} from '../../../packages/protocol';
export const chapterGeneration=(s:ShellState,owner:'popup'|'overlay'|'tower')=>owner==='popup'?s.popup!.generation:s.epoch+1;
export class ChapterController {
 busy=false;error='';private serial=0;
 constructor(private state:()=>ShellState,private apply:(s:ShellState)=>void,private reflect:()=>void,private owner:'popup'|'overlay'|'tower'='popup'){}
 async send(op:ChapterOperation,token?:string):Promise<void>{
  if(this.busy)return;const s=this.state(),generation=chapterGeneration(s,this.owner),serial=++this.serial;
  const command:ChapterCommand=token?{type:'chapter-confirm',generation,token}:{type:'chapter',generation,op};
  this.busy=true;this.error='';this.reflect();
  try{const next=await window.street.command(command);if(serial!==this.serial)return;this.apply(next);}
  catch(e){if(serial===this.serial){this.error=e instanceof Error?e.message:String(e);try{this.apply(await window.street.state());}catch{}}}
  finally{if(serial===this.serial){this.busy=false;this.reflect();}}
 }
 dispose():void{this.serial++;this.busy=false;}
}
export function ensureChapterStyle():void {if(document.querySelector('link[data-chapter-style]'))return;const link=document.createElement('link');link.rel='stylesheet';link.href=new URL('chapter.css',document.baseURI).href;link.dataset.chapterStyle='true';document.head.append(link);}
