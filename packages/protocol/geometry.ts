import type { DisplayInfo, Rect, View } from './index';
export function bottomBounds(display: DisplayInfo, view: View, streetHeight: number, dock: 'top' | 'bottom' = 'bottom'): Rect {
  const w = display.workArea;
  if (![w.x,w.y,w.width,w.height].every(Number.isFinite) || w.width < 1 || w.height < 1) throw new Error('Invalid workArea');
  // Entering a shop swaps its facade for a cutaway; it never expands the desktop strip.
  const height = Math.max(1,Math.min(Math.floor(w.height),streetHeight));
  return { x:Math.ceil(w.x), y:dock === 'top' ? Math.ceil(w.y) : Math.floor(w.y+w.height)-height, width:Math.max(1,Math.floor(w.x+w.width)-Math.ceil(w.x)), height };
}
export function popoverBounds(work: Rect, street: Rect, anchor: Rect, size: { width:number; height:number }, dock: 'top'|'bottom') {
  const width = Math.max(1,Math.min(size.width,Math.floor(work.width))), height = Math.max(1,Math.min(size.height,Math.floor(work.height)));
  const cx = street.x+anchor.x+anchor.width/2, top = street.y+anchor.y, bottom = top+anchor.height;
  const above = top-work.y-2, below = work.y+work.height-bottom-2;
  const preferred = dock === 'bottom' ? 'bottom' : 'top';
  const side: 'top'|'bottom' = preferred === 'bottom' ? (above >= height || above >= below ? 'bottom' : 'top') : (below >= height || below >= above ? 'top' : 'bottom');
  const x = Math.round(Math.max(work.x,Math.min(work.x+work.width-width,cx-width/2)));
  const y = Math.round(Math.max(work.y,Math.min(work.y+work.height-height,side === 'bottom' ? top-height-2 : bottom+2)));
  return { bounds:{x,y,width,height}, side, tail:Math.max(Math.min(18,width/2),Math.min(width-Math.min(18,width/2),Math.round(cx-x))) };
}
export function pixelScale(deviceScale:number,desiredDIP=2): {physical:number;dip:number} {
  if (!Number.isFinite(deviceScale)||deviceScale<=0||!Number.isFinite(desiredDIP)||desiredDIP<=0) throw new Error('Invalid scale');
  const physical=Math.max(1,Math.floor(deviceScale*desiredDIP));return {physical,dip:physical/deviceScale};
}
export function snapDIP(value:number,deviceScale:number):number{return Math.round(value*deviceScale)/deviceScale;}
export function chooseDisplay(displays:DisplayInfo[],preferred:number|null,primaryId:number):DisplayInfo {
  const match=displays.find(d=>d.id===preferred)??displays.find(d=>d.id===primaryId)??displays[0];if(!match)throw new Error('No display is available');return match;
}
