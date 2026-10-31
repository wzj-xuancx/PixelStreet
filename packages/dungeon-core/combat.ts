import {consumeAttackBoost,traitRank,grantReturnRhythm} from './growth';
import type {DungeonRun,Enemy,Point,WeaponItem} from './types';
import type {MeleeAction,MeleeBranch,CombatFeedback} from './combat-state';
import {hurtShape,sweptHurtContact,segmentRectContact,obstacleAttackRect} from './geometry';
import {isMelee,meleeDamage,meleeTiming,weaponActionGeometry} from './weapons';
const unit=(x:number,y:number)=>{const n=Math.hypot(x,y)||1;return{x:x/n,y:y/n};};
export interface MeleeHooks {hit:(enemy:Enemy,damage:number,point:Point,sourceId:string,incoming:Point,heavy:boolean,additional:boolean)=>boolean;move:(entity:Point,dx:number,dy:number)=>void;blocked:(from:Point,to:Point,ignoreId?:string)=>boolean;hitObstacle:(id:string,damage:number,point:Point)=>void;split:(point:Point,direction:Point,damage:number,ignoreId:string)=>void;feedback:(targetId:string,sourceId:string,kind:CombatFeedback['kind'],point:Point)=>void}
export function startMeleeAction(r:DungeonRun,special=false,charge=0):boolean {
 const p=r.player,w=p.weaponSlots[p.activeSlot];if(!w||!isMelee(w.kind)||r.combat.action||r.elapsedMs<p.attackReady||!special&&r.combat.special.held)return false;
 const c=r.combat;if(special&&r.elapsedMs<c.special.readyAt)return false;const branch=(w.form==='base'?'base':w.form) as MeleeBranch;
 if(c.combo.expiresAt<r.elapsedMs)c.combo.step=0;if(c.momentum.expiresAt<r.elapsedMs)c.momentum.value=0;
 if(special&&(branch==='blade-dance'||branch==='phantom-blades')&&c.combo.step<3)return false;
 if(w.form==='reaper'&&c.reaper.weaponId!==w.id)c.reaper={weaponId:w.id,marks:0,bossReadyAt:0};
 if(special&&branch==='reaper'&&c.reaper.marks===0)return false;
 let strength=0;if(special&&w.kind==='dual'){strength=c.combo.step;c.combo.step=0;}if(special&&w.kind==='fists'){strength=c.momentum.value;c.momentum.value=0;}if(special&&branch==='reaper'){strength=c.reaper.marks;c.reaper.marks=0;}
 if(w.kind==='chain'&&special)c.chainMode=c.chainMode==='blade'?'chain':'blade';
 let comboStep=0;if(!special&&(w.kind==='sword'||w.kind==='spear')){comboStep=c.combo.step%3+1;c.combo={step:comboStep,expiresAt:r.elapsedMs+1100};}else if(!special&&(w.kind==='dual'||w.kind==='fists'))comboStep=r.sequence%2+1;
 const timing=meleeTiming(w.kind,special,branch,c.chainMode),speed=1+p.hasteRank*.08,startedAt=r.elapsedMs,activeAt=startedAt+timing.windup/speed,recoverAt=activeAt+timing.active/speed,endsAt=recoverAt+timing.recover/speed,origin=hurtShape(p,'player',c.profile).center,direction=unit(p.aimX-origin.x,p.aimY-origin.y);
 if(direction.x===0&&direction.y===0)direction.x=1;
 c.action={id:`action-${++r.sequence}`,weaponId:w.id,kind:w.kind,branch,special,mode:w.kind==='chain'?c.chainMode:'blade',comboStep,strength,stage:'windup',startedAt,activeAt,recoverAt,endsAt,origin,direction,charge:Math.max(0,Math.min(1,charge)),damageScale:consumeAttackBoost(r,w.kind)*(special&&w.kind==='spear'&&charge>=1?(traitRank(r,'spear-charge')===2?1.25:traitRank(r,'spear-charge')===1?1.15:1):1),splitUsed:false,segment:0,hitIds:[],sweepHitIds:[],sampledAt:startedAt,previousFeet:{x:p.x,y:p.y}};
 p.attackReady=endsAt;if(special)c.special.readyAt=endsAt+timing.cooldown;return true;
}
function reaperGain(r:DungeonRun,w:WeaponItem,e:Enemy,killed:boolean):void {if(w.form!=='reaper'||r.combat.reaper.weaponId!==w.id)return;const state=r.combat.reaper;if(killed)state.marks=Math.min(6,state.marks+1);else if(e.kind==='boss'&&r.elapsedMs>=state.bossReadyAt){state.marks=Math.min(6,state.marks+1);state.bossReadyAt=r.elapsedMs+900;}}
/** Bounded sub-sampling of the same visible blade/head primitives, including moving-body paths. */
export function advanceMeleeAction(r:DungeonRun,hooks:MeleeHooks):void {
 const a=r.combat.action;if(!a)return;const w=r.player.weaponSlots[r.player.activeSlot];if(!w||w.id!==a.weaponId){r.combat.action=null;return;}
 const room=r.rooms.find(room=>room.id===r.currentRoom)!,now=Math.min(r.elapsedMs,a.endsAt),from=a.sampledAt,to=Math.min(now,a.recoverAt),oldFeet={...a.previousFeet};
 if(a.special&&a.branch==='phantom-blades'&&from<a.activeAt&&now>=a.activeAt)hooks.move(r.player,-a.direction.x*44,-a.direction.y*44);
 const feet={x:r.player.x,y:r.player.y},start=Math.max(from,a.activeAt),span=Math.max(0,to-start),steps=Math.max(1,Math.ceil(span/2));
 if(to>=a.activeAt&&from<a.recoverAt)for(let i=0;i<=steps;i++){
  const t=start+span*i/steps,alpha=now===from?1:Math.max(0,Math.min(1,(t-from)/(now-from))),sampleFeet={x:oldFeet.x+(feet.x-oldFeet.x)*alpha,y:oldFeet.y+(feet.y-oldFeet.y)*alpha},view=weaponActionGeometry(r,{time:Math.min(t,a.recoverAt-1e-7),feet:sampleFeet});if(!view)continue;
  for(const shape of view.primitives){if(shape.segment!==2&&shape.segment!==a.segment){if(!a.hitIds.length)hooks.feedback('air',a.id,'miss',view.origin);a.segment=shape.segment;a.hitIds=[];}
   const hits=shape.segment===2?a.sweepHitIds:a.hitIds;
   const line=shape.kind==='circle'?{a:shape.center,b:shape.center}:shape;
   for(const o of room.obstacles){if(o.kind!=='crate'||o.hp<=0||hits.includes(o.id)||hits.length>=24)continue;const t=segmentRectContact(line.a,line.b,obstacleAttackRect(o),shape.radius);if(t===null)continue;const point={x:line.a.x+(line.b.x-line.a.x)*t,y:line.a.y+(line.b.y-line.a.y)*t};if(hooks.blocked(view.origin,point,o.id))continue;hooks.hitObstacle(o.id,meleeDamage(a)*a.damageScale*(shape.damageFactor??1)*(1+(w.level-1)*.18)*(1+r.player.damageRank*.1),point);hits.push(o.id);}
   const contacts=room.enemies.filter(e=>e.hp>0&&!hits.includes(e.id)).map(e=>({e,contact:sweptHurtContact(line.a,line.b,shape.radius,e,e.kind,r.combat.profile,e.radius)})).filter(v=>v.contact!==null).sort((x,y)=>x.contact!.t-y.contact!.t||x.e.id.localeCompare(y.e.id));
   for(const {e,contact} of contacts){if(hits.length>=24||hits.includes(e.id))continue;const origin=a.special&&a.branch==='phantom-blades'&&shape.segment===1?a.origin:view.origin;if(hooks.blocked(origin,contact!.point)){hits.push(e.id);hooks.feedback(e.id,a.id,'block',contact!.point);continue;}
    const before=e.hp,accepted=hooks.hit(e,meleeDamage(a)*a.damageScale*(shape.damageFactor??1)*(1+(w.level-1)*.18)*(1+r.player.damageRank*.1),contact!.point,a.id,unit(origin.x-contact!.point.x,origin.y-contact!.point.y),shape.heavy,shape.segment===2);hits.push(e.id);if(!accepted)continue;
    if(a.kind==='spear'&&shape.segment!==2&&!a.splitUsed&&traitRank(r,'spear-split')){a.splitUsed=true;hooks.split(contact!.point,a.direction,meleeDamage(a)*a.damageScale*(1+(w.level-1)*.18)*(1+r.player.damageRank*.1)*(traitRank(r,'spear-split')===2?.35:.25),e.id);}
    if(a.kind==='chain'&&a.mode==='chain'&&traitRank(r,'return-rhythm'))r.combat.nextHit.returnProjectileId=a.id;
    if(!a.special&&a.kind==='dual'){r.combat.combo.step=Math.min(3,r.combat.combo.step+1);r.combat.combo.expiresAt=r.elapsedMs+1500;}
    if(!a.special&&a.kind==='fists'){r.combat.momentum.value=Math.min(10,r.combat.momentum.value+1);r.combat.momentum.expiresAt=r.elapsedMs+2400;}
    reaperGain(r,w,e,before>0&&e.hp<=0);
    if(shape.pull&&e.kind!=='boss'&&room.kind!=='elite'&&hits.length<=(a.branch==='hook-scythe'?3:2)){const side=hits.length%2?1:-1,target={x:r.player.x+a.direction.x*47-a.direction.y*side*15,y:r.player.y+a.direction.y*47+a.direction.x*side*15},dx=target.x-e.x,dy=target.y-e.y,n=Math.hypot(dx,dy)||1;hooks.move(e,dx*Math.min(1,95/n),dy*Math.min(1,95/n));}
   }
  }
 }
 a.sampledAt=now;a.previousFeet=feet;a.stage=now<a.activeAt?'windup':now<a.recoverAt?'active':'recover';
 if(from<a.recoverAt&&now>=a.recoverAt&&!a.hitIds.length)hooks.feedback('air',a.id,'miss',weaponActionGeometry(r)?.origin??a.origin);
 if(r.elapsedMs>=a.endsAt){if(a.kind==='chain'&&a.mode==='chain')grantReturnRhythm(r,a.id);r.combat.action=null;}
}
