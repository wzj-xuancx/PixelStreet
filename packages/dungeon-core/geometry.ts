import type {Point} from './types';
export type GeometryProfile='baseline'|'mild'|'wide';
export type GeometryActor='player'|'enemy'|'boss'|'chaser'|'shooter'|'charger'|'guard'|'priest';
export const GEOMETRY_PROFILES={baseline:{displayScale:1,roomScale:1},mild:{displayScale:.8,roomScale:1.2},wide:{displayScale:.7,roomScale:1.3}} as const;
export interface CircleShape {kind:'circle';center:Point;radius:number}
export interface CapsuleShape {kind:'capsule';a:Point;b:Point;radius:number;center:Point}
export interface HurtContact {t:number;point:Point;normal:Point;shape:CapsuleShape}
export interface HurtTrace {reason:'hit'|'miss'|'invalid';contact:HurtContact|null}
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
const small={foot:12,top:31,bottom:14,hurt:11},tall={foot:12,top:46,bottom:20,hurt:11};
const dimensions={player:{foot:11,top:55,bottom:25,hurt:12},enemy:small,chaser:small,shooter:tall,charger:tall,guard:tall,priest:tall,boss:{foot:22,top:76,bottom:32,hurt:22}} as const;
function scale(actor:GeometryActor,profile:GeometryProfile,baseRadius?:number):number {return GEOMETRY_PROFILES[profile].displayScale*(baseRadius===undefined?1:baseRadius/dimensions[actor].foot);}
/** Feet anchors stay in world units; no camera or screen transform enters core. */
export function movementShape(feet:Point,actor:GeometryActor='player',profile:GeometryProfile='mild',baseRadius?:number):CircleShape {return{kind:'circle',center:{...feet},radius:dimensions[actor].foot*scale(actor,profile,baseRadius)};}
export function hurtShape(feet:Point,actor:GeometryActor='player',profile:GeometryProfile='mild',baseRadius?:number):CapsuleShape {
 const d=dimensions[actor],s=scale(actor,profile,baseRadius),a={x:feet.x,y:feet.y-d.top*s},b={x:feet.x,y:feet.y-d.bottom*s};return{kind:'capsule',a,b,radius:d.hurt*s,center:{x:feet.x,y:(a.y+b.y)/2}};
}
const validPoint=(p:Point)=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y);
/** Exact continuous segment sweep against capsule plus projectile radius (Minkowski sum). */
export function traceHurtContact(from:Point,to:Point,projectileRadius:number,feet:Point,actor:GeometryActor='player',profile:GeometryProfile='mild',baseRadius?:number):HurtTrace {
 if(!validPoint(from)||!validPoint(to)||!validPoint(feet)||!Object.hasOwn(dimensions,actor)||!Object.hasOwn(GEOMETRY_PROFILES,profile)||!Number.isFinite(projectileRadius)||projectileRadius<0||(baseRadius!==undefined&&(!Number.isFinite(baseRadius)||baseRadius<=0)))return{reason:'invalid',contact:null};
 const shape=hurtShape(feet,actor,profile,baseRadius),radius=shape.radius+projectileRadius,dx=to.x-from.x,dy=to.y-from.y,candidates:number[]=[];
 const nearestY=clamp(from.y,shape.a.y,shape.b.y);
 if(Math.hypot(from.x-shape.a.x,from.y-nearestY)<=radius)candidates.push(0);
 const aa=dx*dx+dy*dy;
 if(aa>0){
  for(const center of [shape.a,shape.b]){
   const fx=from.x-center.x,fy=from.y-center.y,bb=2*(fx*dx+fy*dy),cc=fx*fx+fy*fy-radius*radius,disc=bb*bb-4*aa*cc;
   if(disc>=-1e-8){const t=(-bb-Math.sqrt(Math.max(0,disc)))/(2*aa);if(t>=0&&t<=1)candidates.push(t);}
  }
  // The straight capsule body between the two circular end caps.
  let enter=0,leave=1;
  for(const [start,delta,min,max] of [[from.x,dx,shape.a.x-radius,shape.a.x+radius],[from.y,dy,shape.a.y,shape.b.y]]){
   if(Math.abs(delta)<1e-12){if(start<min||start>max){enter=2;break;}}
   else {let a=(min-start)/delta,b=(max-start)/delta;if(a>b)[a,b]=[b,a];enter=Math.max(enter,a);leave=Math.min(leave,b);}
  }
  if(enter<=leave&&enter>=0&&enter<=1)candidates.push(enter);
 }
 if(!candidates.length)return{reason:'miss',contact:null};
 const t=Math.min(...candidates),center={x:from.x+dx*t,y:from.y+dy*t},spine={x:shape.a.x,y:clamp(center.y,shape.a.y,shape.b.y)},nx=center.x-spine.x,ny=center.y-spine.y,n=Math.hypot(nx,ny),speed=Math.hypot(dx,dy),normal=n>1e-10?{x:nx/n,y:ny/n}:speed>0?{x:-dx/speed,y:-dy/speed}:{x:1,y:0};
 return{reason:'hit',contact:{t,point:{x:spine.x+normal.x*shape.radius,y:spine.y+normal.y*shape.radius},normal,shape}};
}
export function sweptHurtContact(from:Point,to:Point,projectileRadius:number,feet:Point,actor:GeometryActor='player',profile:GeometryProfile='mild',baseRadius?:number):HurtContact|null {return traceHurtContact(from,to,projectileRadius,feet,actor,profile,baseRadius).contact;}
/** Incoming points from defender toward damage origin, rather than projectile velocity. */
export function shieldFacingContact(facing:Point,incoming:Point,halfAngle=Math.PI*.36):boolean {
 if(!validPoint(facing)||!validPoint(incoming)||!Number.isFinite(halfAngle)||halfAngle<0||halfAngle>Math.PI)return false;
 const a=Math.hypot(facing.x,facing.y),b=Math.hypot(incoming.x,incoming.y);return a>0&&b>0&&(facing.x*incoming.x+facing.y*incoming.y)/(a*b)>=Math.cos(halfAngle);
}
export interface WorldRectangle {x:number;y:number;width:number;height:number}
/** Exact closest-point foot-circle test. Tangency is clear; penetration is blocked. */
export function circleRectOverlap(center:Point,radius:number,rect:WorldRectangle):boolean {const x=clamp(center.x,rect.x,rect.x+rect.width),y=clamp(center.y,rect.y,rect.y+rect.height);return (center.x-x)**2+(center.y-y)**2<radius*radius-1e-9;}
/** Continuous circle sweep against a rectangle with rounded Minkowski corners. */
export function segmentRectContact(from:Point,to:Point,rect:WorldRectangle,radius=0):number|null {
 const dx=to.x-from.x,dy=to.y-from.y,candidates:number[]=[],inside=(p:Point)=>p.x>=rect.x&&p.x<=rect.x+rect.width&&p.y>=rect.y&&p.y<=rect.y+rect.height;
 if(inside(from)||circleRectOverlap(from,radius,rect))return 0;
 for(const [edge,axis]of [[rect.x-radius,'x'],[rect.x+rect.width+radius,'x'],[rect.y-radius,'y'],[rect.y+rect.height+radius,'y']] as const){const delta=axis==='x'?dx:dy;if(Math.abs(delta)<1e-12)continue;const t=(edge-(axis==='x'?from.x:from.y))/delta;if(t<0||t>1)continue;const cross=axis==='x'?from.y+dy*t:from.x+dx*t,min=axis==='x'?rect.y:rect.x,max=min+(axis==='x'?rect.height:rect.width);if(cross>=min&&cross<=max)candidates.push(t);}
 const aa=dx*dx+dy*dy;if(radius>0&&aa>0)for(const x of [rect.x,rect.x+rect.width])for(const y of [rect.y,rect.y+rect.height]){const fx=from.x-x,fy=from.y-y,bb=2*(fx*dx+fy*dy),cc=fx*fx+fy*fy-radius*radius,disc=bb*bb-4*aa*cc;if(disc<0)continue;const t=(-bb-Math.sqrt(disc))/(2*aa);if(t>=0&&t<=1)candidates.push(t);}
 return candidates.length?Math.min(...candidates):null;
}
/** Matches the actual column/crate sprite extents, independently of their ground footprint. */
export function obstacleAttackRect(obstacle:WorldRectangle&{kind:'pillar'|'crate'}):WorldRectangle {const width=obstacle.kind==='pillar'?40:24,height=obstacle.kind==='pillar'?87.5:240/7;return{x:obstacle.x+obstacle.width/2-width/2,y:obstacle.y+obstacle.height-height,width,height};}
/** Upper wall has the same raised band as a legal boss torso; feet remain constrained to the ground wall. */
export function projectileWorldBounds(room:{width:number;height:number},profile:GeometryProfile='mild'):WorldRectangle {const top=24-54*GEOMETRY_PROFILES[profile].displayScale;return{x:24,y:top,width:room.width-48,height:room.height-24-top};}
