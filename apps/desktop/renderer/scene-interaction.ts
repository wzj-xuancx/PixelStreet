import type {Rect} from '../../../packages/protocol';

// All values use the same logical coordinates as the sprites and scaled signs.
export const streetLayout = Object.freeze({width:940,towerX:835,portalX:45,dungeonX:665,bakeryX:210,alchemyX:450,playerX:360});
export const shopBody = Object.freeze({left:-56,top:-88,width:112,height:88});
export const shopBoard = Object.freeze({left:64,top:-55,width:66,height:57});
export const shopTarget = Object.freeze({left:-56,top:-88,width:186,height:90});

export function containsPoint(rect:Rect,x:number,y:number):boolean {
  return x>=rect.x&&x<rect.x+rect.width&&y>=rect.y&&y<rect.y+rect.height;
}
export function shopBoardContains(center:number,x:number,y:number):boolean {
  return containsPoint({x:center+shopBoard.left,y:shopBoard.top,width:shopBoard.width,height:shopBoard.height},x,y);
}
export function shopContains(center:number,x:number,y:number):boolean {
  // A single forgiving target covers the building, its board and their seam.
  return containsPoint({x:center+shopTarget.left,y:shopTarget.top,width:shopTarget.width,height:shopTarget.height},x,y);
}
export function canonicalSceneHit(id:string,field=false):string {
  if(id==='interior-bakery')return 'shop-bakery';
  if(id==='interior-alchemy')return 'shop-alchemy';
  if(id.startsWith('portal-'))return field?'return-portal':'adventure-portal';
  return id.startsWith('enemy-')?'enemy':id;
}
export function foregroundHit(id:string|undefined):boolean {
  return !!id&&(id==='keeper'||id==='enemy'||id.startsWith('player-')||id.startsWith('slime-'));
}

/** Purpose copy for discovered field hit IDs; never changes target or authority. */
export function fieldTargetHint(id:string|undefined,floor=0):string {
 if(id&&/^f[01]-e[0-2]-m[0-3]$/.test(id))return '走近魔物 · 锁定普攻';
 if(id==='return')return '返回营地 · 结算战利品';
 if(id==='exit')return floor===1?'清除本关遭遇后，完成探索回营':'清除本关遭遇后，前往下一关';
 return '';
}
