import {emptyPresentations,type NativePresentations,type PresentationOwner} from '../../packages/protocol/presentation';
export type NativePresentationEvent='show'|'hide'|'minimize'|'restore'|'focus'|'blur'|'closed';
/** Only native window events update this readonly renderer signal. IPC visibility is a separate authority check. */
export class NativePresentation {
 private value=emptyPresentations();
 reset(owner:PresentationOwner):void {this.value={...this.value,[owner]:{shown:false,focused:false}};}
 event(owner:PresentationOwner,event:NativePresentationEvent):void {
  const old=this.value[owner];let shown=old.shown,focused=old.focused;
  if(event==='show'||event==='restore')shown=true;
  if(event==='hide'||event==='minimize'||event==='closed'){shown=false;focused=false;}
  if(event==='focus')focused=shown;
  if(event==='blur')focused=false;
  this.value={...this.value,[owner]:{shown,focused}};
 }
 snapshot():NativePresentations{return structuredClone(this.value);}
}
