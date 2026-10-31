import type {FieldActor,FieldWorld,WorldMonster,FieldEvent} from './types';
export const has=(a:FieldActor,id:string)=>a.loadout.gear.includes(id);
export function event(w:FieldWorld,kind:FieldEvent['kind'],a:FieldActor,m:WorldMonster|FieldActor,amount:number){w.events.push({tick:w.tick,kind,actorId:a.id,targetId:m.id,amount});if(w.events.length>48)w.events.shift();}
export function heal(w:FieldWorld,a:FieldActor,amount:number,source:FieldActor){const gained=Math.min(a.loadout.maxHP-a.hp,amount);a.hp+=gained;if(gained)event(w,'heal',source,a,gained);if(has(source,'graft-charm')&&amount>gained){const extra=Math.min(8,amount-gained);a.shield=Math.min(12,a.shield+extra);a.shieldUntil=w.tick+100;event(w,'shield',source,a,extra);}}
export function hurt(w:FieldWorld,a:FieldActor,amount:number,m:WorldMonster){let damage=Math.max(1,amount-a.loadout.defence-(a.loadout.pet?.defence??0));const absorb=Math.min(a.shield,damage);a.shield-=absorb;damage-=absorb;damage=Math.min(a.hp,damage);a.hp-=damage;event(w,'hurt',a,m,damage);}
export function hit(w:FieldWorld,a:FieldActor,m:WorldMonster,damage:number,spell=false){if(m.hp<=0)return;let d=damage;if(has(a,'breaker-hammer')&&!spell&&a.attacks%3===0){d+=4;m.armorUntil=w.tick+50;event(w,'break',a,m,4);}if(m.armorUntil>w.tick)d+=2;if(has(a,'rock-gloves')&&m.armorUntil>w.tick&&a.attacks%2===0){d+=3;event(w,'rupture',a,m,3);}if(has(a,'rock-gloves'))d+=1;if(!spell&&a.loadout.spell>0&&a.attacks%4===0){d+=a.loadout.spell;event(w,'pulse',a,m,a.loadout.spell);}
 const amount=Math.min(m.hp,d);m.hp-=amount;event(w,'attack',a,m,amount);
 if(spell){m.hits++;if(m.hits%2===0&&m.stage!=='idle'&&w.tick>=m.immuneUntil){m.stage='idle';m.due=w.tick+12;m.immuneUntil=w.tick+(m.kind==='guardian'?60:25);event(w,'interrupt',a,m,0);if(has(a,'echo-mirror')){for(const other of w.floors[w.floor].encounters[w.active!].monsters)if(other.hp>0&&Math.abs(other.x-m.x)<120){const n=Math.min(other.hp,3);other.hp-=n;}event(w,'pulse',a,m,3);}}}
}
/** Honor a living explicit selection within this group; all automatic choices use nearest. */
export function selectedMonster(a:FieldActor,monsters:WorldMonster[]):WorldMonster|undefined {const alive=monsters.filter(m=>m.hp>0),target=a.target;return (target?.kind==='monster'?alive.find(m=>m.id===target.id):undefined)??alive.sort((x,y)=>Math.abs(x.x-a.x)-Math.abs(y.x-a.x))[0];}
export function combatTick(w:FieldWorld){const group=w.floors[w.floor].encounters[w.active!];
 for(const a of w.actors){if(!group.participants.includes(a.id)||!a.eligible||!a.online||a.pending||a.hp<=0)continue;const m=selectedMonster(a,group.monsters);if(!m)continue;
  if(a.target?.kind==='ground')move(w,a,a.target.x);else move(w,a,Math.max(0,m.x-(has(a,'resonant-staff')?150:28)));
  const ranged=has(a,'resonant-staff');if(w.tick>=a.nextAttack&&Math.abs(m.x-a.x)<(ranged?260:55)){a.attacks++;a.nextAttack=w.tick+(ranged?12:10);const damage=a.loadout.attack+(a.loadout.pet?.attack??0)+(has(a,'echo-mirror')?1:0);if(ranged){w.projectiles.push({id:`shot-${a.id}-${w.tick}`,actorId:a.id,x:a.x,direction:Math.sign(m.x-a.x)||1,damage:damage+a.loadout.spell,remaining:32});event(w,'shot',a,m,damage);}else hit(w,a,m,damage);}
 }
 for(const p of w.projectiles){const old=p.x;p.x+=p.direction*26;p.remaining--;const m=group.monsters.filter(m=>m.hp>0&&m.x>=Math.min(old,p.x)-10&&m.x<=Math.max(old,p.x)+10).sort((a,b)=>Math.abs(a.x-old)-Math.abs(b.x-old))[0];if(m){hit(w,w.actors.find(a=>a.id===p.actorId)!,m,p.damage,true);p.remaining=0;}}w.projectiles=w.projectiles.filter(p=>p.remaining>0&&p.x>=0&&p.x<=1400);
 for(const m of group.monsters){if(m.hp<=0)continue;const targets=w.actors.filter(a=>group.participants.includes(a.id)&&a.eligible&&a.hp>0&&a.online);if(!targets.length)continue;const a=targets.sort((a,b)=>Math.abs(m.x-a.x)-Math.abs(m.x-b.x))[0];
  if(m.stage==='idle'){if(m.kind==='melee'&&Math.abs(m.x-a.x)>45){m.x+=Math.sign(a.x-m.x)*4;continue;}if(w.tick<m.due)continue;m.aimX=a.x;m.stage='windup';m.due=w.tick+(m.kind==='guardian'?18:m.kind==='charge'?16:m.kind==='ranged'?10:6);if(m.kind==='guardian'){m.pattern=(m.pattern+1)%3;event(w,m.pattern===0?'guardian-shield':m.pattern===1?'guardian-charge':'guardian-summon',a,m,0);}}
  else if(w.tick>=m.due){if(m.kind==='guardian'&&m.pattern===2){if(m.summons<2){m.summons++;const id=`f${w.floor}-e${w.active}-m${m.summons}`;group.monsters.push({id,kind:'melee',x:Math.max(0,m.x-45*m.summons),hp:12,max:12,stage:'idle',due:w.tick+15,aimX:a.x,armorUntil:0,hits:0,immuneUntil:0,pattern:0,summons:0});}}
   else if(m.kind==='ranged'&&m.stage==='windup'){m.stage='projectile';m.due=w.tick+6;continue;}
   else if((m.kind==='guardian'&&m.pattern===1||m.kind==='charge')&&m.stage==='windup'){m.stage='charge';m.due=w.tick+6;continue;}
   else{for(const target of targets){const range=m.kind==='guardian'?(m.pattern===0?70:44):m.kind==='charge'?65:50;const aim=m.kind==='melee'||m.kind==='guardian'&&m.pattern===0?m.x:m.aimX;if(Math.abs(target.x-aim)<range)hurt(w,target,m.kind==='guardian'?12:3+w.floor+(w.active??0),m);}if(m.stage==='charge')m.x=m.aimX;}
   m.stage='idle';m.due=w.tick+(m.kind==='guardian'?24:24+(w.active??0)*5);
  }else if(m.stage==='charge'){m.x+=Math.sign(m.aimX-m.x)*Math.min(24,Math.abs(m.aimX-m.x));}
 }
}
export function move(w:FieldWorld,a:FieldActor,x:number){const d=x-a.x,units=800+a.moveRemainder,step=Math.floor(units/a.loadout.travelPercent);a.moveRemainder=units%a.loadout.travelPercent;a.x+=Math.sign(d)*Math.min(Math.abs(d),step);w.floors[a.floor].revealed=Math.max(w.floors[a.floor].revealed,Math.min(1400,a.x+360));return Math.abs(x-a.x)<=24;}
