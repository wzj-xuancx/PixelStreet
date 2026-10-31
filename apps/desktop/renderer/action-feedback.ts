import type {ShellState} from '../../../packages/protocol';
import {bindLivingMotion} from './living-motion';

interface FeedbackHooks {host:HTMLElement;state:()=>ShellState|undefined}
interface Picture {image:string;size:string;position:string;repeat:string;clipPath:string;width:number;height:number}
interface Source {button:HTMLButtonElement;boundary:HTMLElement;picture?:Picture}
interface Pending {source?:Source;until:number;settled:boolean;ok?:boolean}
export interface ActionFeedback {begin:()=>number;finish:(token:number,ok:boolean,notice:string)=>void;sync:()=>boolean;dispose:()=>void}
const marks=['ps-action-pending','ps-action-success','ps-action-error'];

/** Copy only rendered artwork, never button DOM, IDs, labels or accessibility state. */
function pictureOf(button:HTMLButtonElement):Picture|undefined {
 const candidates=[...Array.from(button.querySelectorAll<HTMLElement>('.inner-art,.v-sprite,.b-buddy-art,.a-good-art,.b-rarity-art,.b-path-emblem,.cw-crop,.cw-prop,.ls-item-art')),...[button]];
 for(const element of candidates){
  if(element.hidden||element.closest('[hidden]'))continue;
  const style=getComputedStyle(element,element===button?'::before':null);
  if(style.display==='none'||style.visibility==='hidden'||!style.backgroundImage.includes('url('))continue;
  const width=parseFloat(style.width),height=parseFloat(style.height);
  if(!(width>0&&height>0))continue;
  return {image:style.backgroundImage,size:style.backgroundSize,position:style.backgroundPosition,repeat:style.backgroundRepeat,clipPath:style.clipPath,width,height};
 }
 return undefined;
}

/**
 * begin() belongs at the synchronous start of an actual action dispatch. finish()
 * belongs AFTER its IPC promise settles; pass the acknowledged notice/error. This
 * module never infers success from sequence changes, profile updates or timers.
 * Navigation clicks alone do nothing. Call sync() when ShellState changes.
 */
export function bindActionFeedback(h:FeedbackHooks):ActionFeedback {
 const controller=new AbortController(),signal=controller.signal,pending=new Map<number,Pending>();
 const toast=document.createElement('div'),artFrame=document.createElement('span'),art=document.createElement('span'),text=document.createElement('span');
 toast.className='ps-action-notice';toast.hidden=true;toast.setAttribute('aria-hidden','true');
 artFrame.className='ps-action-notice-picture';art.className='ps-action-notice-art';artFrame.append(art);
 text.className='ps-action-notice-text';toast.append(artFrame,text);h.host.append(toast);
 h.host.classList.add('ps-action-feedback-host');
 let disposed=false,sequence=0,lastShown=0,candidate:Source|undefined,timer:ReturnType<typeof setTimeout>|undefined,toastUntil=0;
 const blocked=()=>{const state=h.state();return !!state?.workingElsewhere||!!state?.popup?.suspended||state?.mode==='hidden';};
 const motion=bindLivingMotion(h.host,blocked,()=>{});
 const visible=(source?:Source)=>h.host.isConnected&&!document.hidden&&!blocked()&&!h.host.closest('[hidden],[aria-hidden="true"]')&&(!source||(source.button.isConnected&&source.boundary.isConnected&&h.host.contains(source.boundary)&&!source.boundary.closest('[hidden],[aria-hidden="true"]')));
 const clean=(button:HTMLButtonElement)=>button.classList.remove(...marks);
 function refresh():void {
  const now=Date.now(),buttons=new Set<HTMLButtonElement>();
  for(const record of pending.values())if(record.source)buttons.add(record.source.button);
  for(const button of buttons){
   clean(button);
   const records=Array.from(pending.values()).filter(record=>record.source?.button===button&&record.until>now);
   if(records.some(record=>!record.settled))button.classList.add(marks[0]);
   else {const latest=records.at(-1);if(latest)button.classList.add(latest.ok?marks[1]:marks[2]);}
  }
  // Expiring presentation never completes an IPC request or invents a result.
  for(const [token,record]of pending)if(record.until<=now&&record.settled)pending.delete(token);
  if(toastUntil<=now){toast.hidden=true;toastUntil=0;}
  clearTimeout(timer);timer=undefined;
  const deadlines=[toastUntil,...Array.from(pending.values(),record=>record.until)].filter(until=>until>now);
  if(deadlines.length)timer=setTimeout(refresh,Math.max(1,Math.min(...deadlines)-now));
 }
 h.host.addEventListener('click',event=>{
  const button=event.target instanceof Element?event.target.closest('button'):null;
  // A settled village action may hide its own row (for example stopping a
  // plan). Keep its acknowledgement within the same visible village page;
  // leaving that page still suppresses an old response.
  candidate=button instanceof HTMLButtonElement&&h.host.contains(button)&&!button.disabled&&button.getAttribute('aria-disabled')!=='true'?{button,boundary:button.closest<HTMLElement>('.v-panel')??button,picture:pictureOf(button)}:undefined;
  const captured=candidate;
  // A later programmatic dispatch must not inherit a navigation click's image.
  queueMicrotask(()=>{if(candidate===captured)candidate=undefined;});
 },{capture:true,signal});
 const sync=()=>{const running=motion.sync();if(!visible())toast.hidden=true;return running;};
 return {
  begin:()=>{
   if(disposed)return 0;
   const token=++sequence,source=candidate;candidate=undefined;
   // Bound retained tokens even if a caller abandons requests during navigation.
   if(pending.size>=32){const oldest=pending.keys().next().value!;const previous=pending.get(oldest);if(previous?.source)clean(previous.source.button);pending.delete(oldest);}
   pending.set(token,{source,until:Date.now()+12000,settled:false});sync();refresh();return token;
  },
  finish:(token,ok,notice)=>{
   if(disposed)return;
   const record=pending.get(token);if(!record||record.settled)return;
   record.settled=true;record.ok=ok;record.until=Date.now()+950;
   sync();
   // Older responses cannot overwrite a newer acknowledged result. A detached
   // source or hidden page belongs to an interaction the user has left.
   if(token>=lastShown&&notice.trim()&&visible(record.source)){
    lastShown=token;text.textContent=notice;toast.dataset.result=ok?'success':'error';
    const picture=record.source?.picture;artFrame.hidden=!picture;
    if(picture){
     Object.assign(art.style,{backgroundImage:picture.image,backgroundSize:picture.size,backgroundPosition:picture.position,backgroundRepeat:picture.repeat,clipPath:picture.clipPath,width:picture.width+'px',height:picture.height+'px',transform:`scale(${Math.min(48/picture.width,48/picture.height)})`});
    }
    toast.hidden=false;toastUntil=Date.now()+3400;
   }
   refresh();
  },
  sync,
  dispose:()=>{
   if(disposed)return;disposed=true;controller.abort();clearTimeout(timer);timer=undefined;
   for(const record of pending.values())if(record.source)clean(record.source.button);
   pending.clear();candidate=undefined;motion.dispose();toast.remove();h.host.classList.remove('ps-action-feedback-host');
  }
 };
}
