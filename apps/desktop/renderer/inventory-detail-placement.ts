export interface DetailAnchor {left:number;top:number;bottom:number}
/** Keep the whole detail in the viewport and outside its source's vertical band.
 * The selected side owns its height limit; long content scrolls inside it. */
export function inventoryDetailPlacement(anchor:DetailAnchor,viewport:{width:number;height:number},detail:{width:number;height:number}):{left:number;top:number;maxHeight:number}{
 const margin=8,gap=8;
 const aboveEnd=Math.min(viewport.height-margin,anchor.top-gap),belowStart=Math.max(margin,anchor.bottom+gap);
 const above=Math.max(0,aboveEnd-margin),below=Math.max(0,viewport.height-margin-belowStart);
 const useBelow=detail.height<=below||(detail.height>above&&below>=above);
 const maxHeight=useBelow?below:above,height=Math.min(detail.height,maxHeight);
 return {left:Math.max(margin,Math.min(viewport.width-detail.width-margin,anchor.left)),top:useBelow?belowStart:aboveEnd-height,maxHeight};
}
