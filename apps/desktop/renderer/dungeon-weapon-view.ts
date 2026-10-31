import type {WeaponActionGeometry,WeaponPosePart} from '../../../packages/dungeon-core/weapons';
import type {DungeonFrame} from './dungeon-art';

export interface WeaponSpritePart {
 key:string;frame:string;x:number;y:number;width:number;height:number;rotation:number;
 alpha:number;tint:number;flip:boolean;z:number;
}
export interface WeaponEnergyPart {key:string;part:WeaponPosePart}
export interface WeaponView {sprites:WeaponSpritePart[];energy:WeaponEnergyPart[];forearms:WeaponPosePart[]}

/** Transform original image pixels onto the core's hand→tip segment; never invent an attack path. */
export function weaponView(pose:WeaponActionGeometry,frames:ReadonlyMap<string,DungeonFrame>,feetY:number):WeaponView {
 const view:WeaponView={sprites:[],energy:[],forearms:[]};
 const frameId=pose.form==='meteor'?'weapon-meteor':pose.form==='blade-ring'?'weapon-blade-ring':`weapon-${pose.kind}`;
 for(const part of pose.parts){
  if(part.kind==='forearm'){view.forearms.push(part);continue;}
  if(part.kind==='energy'){view.energy.push({key:part.id,part});continue;}
  if(part.kind==='chain-link'){
   const frame=frames.get('chain-link');if(!frame)throw Error('缺少链节原图');
   const length=Math.hypot(part.tip.x-part.hand.x,part.tip.y-part.hand.y),count=Math.max(1,Math.ceil(length/5.5));
   for(let i=0;i<count;i++){const t=(i+.5)/count;view.sprites.push({key:`${part.id}-${i}`,frame:'chain-link',x:part.hand.x+(part.tip.x-part.hand.x)*t,y:part.hand.y+(part.tip.y-part.hand.y)*t,width:frame.worldSize[0],height:frame.worldSize[1],rotation:part.angle-(frame.nativeDirection??Math.PI/2)-(frame.rotationOffset??0),alpha:part.alpha,tint:0xffffff,flip:false,z:feetY+(part.tip.y>=pose.origin.y?1:-1)});}
   continue;
  }
  const id=part.kind==='chain-head'?'weapon-chain':frameId,frame=frames.get(id);if(!frame)throw Error(`缺少武器原图 ${id}`);
  const flip=part.kind==='fist'&&part.id==='off';
  // A bow keeps its native limb size and faces along the shot, rather than stretching its limbs into a staff.
  const bow=pose.kind==='frost',native=bow?0:frame.nativeDirection??-Math.PI/2,grip={x:frame.anchor[0]*frame.width,y:frame.anchor[1]*frame.height},direction={x:Math.cos(native),y:Math.sin(native)};
  const exits=[direction.x>1e-6?(frame.width-grip.x)/direction.x:direction.x<-1e-6?-grip.x/direction.x:Infinity,direction.y>1e-6?(frame.height-grip.y)/direction.y:direction.y<-1e-6?-grip.y/direction.y:Infinity];
  const nativeLength=Math.max(1,Math.min(...exits)),length=Math.hypot(part.tip.x-part.hand.x,part.tip.y-part.hand.y),scale=length/nativeLength;
  view.sprites.push({key:part.id,frame:id,x:part.hand.x,y:part.hand.y,width:bow?frame.worldSize[0]:frame.width*scale,height:bow?frame.worldSize[1]:frame.height*scale,rotation:part.angle-(flip?Math.PI-native:native)-(frame.rotationOffset??0),alpha:part.alpha,tint:part.kind==='afterimage'?0xb9d0f0:pose.stage==='charge'?0xf3e4bf:0xffffff,flip,z:feetY+(part.tip.y>=pose.origin.y?1:-1)});
 }
 return view;
}
