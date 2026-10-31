import type {Sprite} from 'pixi.js';
interface LocalActor {sprite:Sprite;x:number;y:number;width:number;height:number;anchorX:number;anchorY:number}
/** Rebase each frame, then rotate only the local demo body around its centre onto the standing baseline. */
export function applyOpeningPose(actor:LocalActor,defeated:boolean):void {
 const {sprite}=actor;
 sprite.rotation=0;sprite.pivot.set(0,0);sprite.position.set(actor.x-actor.anchorX,actor.y-actor.anchorY);
 if(!defeated)return;
 const texture=sprite.texture.orig;
 const standingBottom=actor.y-actor.anchorY+actor.height;
 sprite.pivot.set(texture.width/2,texture.height/2);
 sprite.rotation=-Math.PI/2;
 sprite.position.set(actor.x-actor.anchorX+actor.width/2,standingBottom-actor.width/2);
}
