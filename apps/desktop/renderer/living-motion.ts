/** Local presentation only. Economic time remains in the worker. */
export function bindLivingMotion(root:HTMLElement,blocked:()=>boolean,onPause:()=>void):{sync:()=>boolean;dispose:()=>void} {
 const media=matchMedia('(prefers-reduced-motion: reduce)'),controller=new AbortController(),signal=controller.signal;
 let inside=false,blurred=false,disposed=false,lastBlocked=blocked(),running=false;
 const sync=():boolean=>{
  if(disposed)return false;
  const stopped=blocked();
  // A main-process suspend -> resume is an explicit return to this game panel.
  if(lastBlocked&&!stopped)blurred=false;
  lastBlocked=stopped;
  const next=root.isConnected&&!root.closest('[hidden],[aria-hidden="true"]')&&!document.hidden&&!media.matches&&!stopped&&!blurred&&(inside||document.hasFocus());
  if(root.dataset.motion!==(next?'running':'paused'))root.dataset.motion=next?'running':'paused';
  if(!next&&running)onPause();running=next;return next;
 };
 root.addEventListener('pointerenter',()=>{inside=true;sync();},{signal});
 root.addEventListener('pointerleave',()=>{inside=false;sync();},{signal});
 root.addEventListener('pointerdown',event=>{
  // Non-focusable shop panels can be deliberately re-entered by a local click.
  // Software events never count as this trusted recovery path.
  if(event.isTrusted){inside=true;blurred=false;sync();}
 },{signal,capture:true});
 window.addEventListener('blur',()=>{inside=false;blurred=true;sync();},{signal});
 window.addEventListener('focus',()=>{if(document.hasFocus())blurred=false;sync();},{signal});
 document.addEventListener('visibilitychange',()=>{inside=false;blurred=document.hidden;sync();},{signal});
 media.addEventListener('change',sync,{signal});
 const observer=new MutationObserver(sync);
 for(let node:HTMLElement|null=root;node;node=node.parentElement)observer.observe(node,{attributes:true,attributeFilter:['hidden','aria-hidden']});
 sync();return {sync,dispose:()=>{if(disposed)return;disposed=true;controller.abort();observer.disconnect();root.dataset.motion='paused';onPause();}};
}
