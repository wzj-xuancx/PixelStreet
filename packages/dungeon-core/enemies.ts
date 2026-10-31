import type { Enemy, EnemyKind, Point } from './types';
import type { EnemyRuntime } from './combat-state';
import type { CapsuleShape } from './geometry';
import { shieldFacingContact } from './geometry';

export interface EnemyAttackRule {
  threat: number;
  hp: number;
  moveSpeed: number;
  windupMs: number;
  activeMs: number;
  recoverMs: number;
  cooldownMs: number;
  damage: number;
  reach?: number;
  halfAngle?: number;
  attackRange?: number;
  keepRange?: number;
  shotSpeed?: number;
  minRange?: number;
  chargeSpeed?: number;
  chargeMs?: number;
  blockHalfAngle?: number;
  supportRange?: number;
  buffMultiplier?: number;
}

/** Shared simulation and renderer timing/shape values for readable enemy attacks. */
export const ENEMY_ATTACK_RULES: Readonly<Record<EnemyKind, Readonly<EnemyAttackRule>>> = {
  chaser: { threat: 1, hp: 48, moveSpeed: 95, windupMs: 420, activeMs: 140, recoverMs: 500, cooldownMs: 320, damage: 10, reach: 48, halfAngle: Math.PI * .27 },
  shooter: { threat: 2, hp: 42, moveSpeed: 85, windupMs: 600, activeMs: 120, recoverMs: 450, cooldownMs: 400, damage: 12, minRange: 170, attackRange: 270, shotSpeed: 190 },
  charger: { threat: 3, hp: 70, moveSpeed: 105, windupMs: 700, activeMs: 550, recoverMs: 650, cooldownMs: 450, damage: 18, attackRange: 240, chargeSpeed: 340, chargeMs: 550 },
  guard: { threat: 3, hp: 86, moveSpeed: 55, windupMs: 740, activeMs: 160, recoverMs: 820, cooldownMs: 480, damage: 16, reach: 52, halfAngle: Math.PI * .3, blockHalfAngle: Math.PI * .36 },
  priest: { threat: 4, hp: 54, moveSpeed: 55, windupMs: 0, activeMs: 0, recoverMs: 0, cooldownMs: 0, damage: 0, minRange: 180, supportRange: 320, buffMultiplier: 1.25 },
  boss: { threat: 40, hp: 1100, moveSpeed: 340, windupMs: 900, activeMs: 550, recoverMs: 850, cooldownMs: 400, damage: 24, attackRange: 340, shotSpeed: 175, chargeSpeed: 340, chargeMs: 550 },
};

export const GUARD_BLOCK_HALF_ANGLE = ENEMY_ATTACK_RULES.guard.blockHalfAngle!;
export const PRIEST_MAX_BUFF_TARGETS = 2;
export const ENEMY_BUFF_DAMAGE_MULTIPLIER = ENEMY_ATTACK_RULES.priest.buffMultiplier!;
export const CHASER_ATTACK_RANGE = ENEMY_ATTACK_RULES.chaser.reach!;
export const CHASER_ATTACK_HALF_ANGLE = ENEMY_ATTACK_RULES.chaser.halfAngle!;
export const GUARD_ATTACK_RANGE = ENEMY_ATTACK_RULES.guard.reach!;
export const GUARD_ATTACK_HALF_ANGLE = ENEMY_ATTACK_RULES.guard.halfAngle!;
export const SHOOTER_MIN_RANGE = ENEMY_ATTACK_RULES.shooter.minRange!;
export const SHOOTER_MAX_RANGE = ENEMY_ATTACK_RULES.shooter.attackRange!;
export const CHARGER_START_RANGE = ENEMY_ATTACK_RULES.charger.attackRange!;
export const CHARGER_TELEGRAPH_LENGTH = ENEMY_ATTACK_RULES.charger.chargeSpeed! * ENEMY_ATTACK_RULES.charger.chargeMs! / 1000;
export const SPAWN_WARNING_MS = 1100;
export const SPAWN_SETTLE_MS = 300;
export const SPAWN_RETRY_MS = 500;
export const SPAWN_RETRY_LIMIT = 8;
export const ATTACK_START_SPACING_MS = 180;
export const PLAYER_DUNGEON_SPEED = 195;
export const SPAWN_SAFE_DISTANCE = PLAYER_DUNGEON_SPEED * SPAWN_WARNING_MS / 1000 * .9;
export const SHIELD_REGEN_DELAY_MS = 5000;
export const SHIELD_REGEN_RATE = 4;
export const SHIELD_REGEN_SAFE_RADIUS = 210;

export type EnemyTelegraph =
  | { kind: 'arc'; origin: Point; direction: Point; reach: number; halfAngle: number }
  | { kind: 'line'; origin: Point; direction: Point; length: number }
  | { kind: 'support'; origin: Point; direction: Point; radius: number };

/** One geometry contract feeds both the combat warning and the renderer/debug overlay. */
export function enemyTelegraph(kind: EnemyKind, origin: Point, direction: Point): EnemyTelegraph {
  const length = Math.hypot(direction.x, direction.y) || 1;
  const facing = { x: direction.x / length, y: direction.y / length };
  const rule = ENEMY_ATTACK_RULES[kind];
  if (kind === 'chaser') return { kind: 'arc', origin: { ...origin }, direction: facing, reach: rule.reach!, halfAngle: rule.halfAngle! };
  if (kind === 'guard') return { kind: 'arc', origin: { ...origin }, direction: facing, reach: rule.reach!, halfAngle: rule.halfAngle! };
  if (kind === 'priest') return { kind: 'support', origin: { ...origin }, direction: facing, radius: rule.supportRange! };
  if (kind === 'charger') return { kind: 'line', origin: { ...origin }, direction: facing, length: CHARGER_TELEGRAPH_LENGTH };
  if (kind === 'shooter') return { kind: 'line', origin: { ...origin }, direction: facing, length: rule.attackRange! };
  return { kind: 'line', origin: { ...origin }, direction: facing, length: rule.attackRange! };
}

function pointSegmentDistance(point: Point, a: Point, b: Point): number {
  const dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy,t=length<=1e-12?0:Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/length));
  return Math.hypot(point.x-a.x-dx*t,point.y-a.y-dy*t);
}
function cross(a:Point,b:Point,c:Point):number {return(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);}
function segmentsIntersect(a:Point,b:Point,c:Point,d:Point):boolean {
  const abC=cross(a,b,c),abD=cross(a,b,d),cdA=cross(c,d,a),cdB=cross(c,d,b),epsilon=1e-9;
  if(((abC>epsilon&&abD< -epsilon)||(abC< -epsilon&&abD>epsilon))&&((cdA>epsilon&&cdB< -epsilon)||(cdA< -epsilon&&cdB>epsilon)))return true;
  const on=(p:Point,q:Point,v:Point)=>Math.abs(cross(p,q,v))<=epsilon&&v.x>=Math.min(p.x,q.x)-epsilon&&v.x<=Math.max(p.x,q.x)+epsilon&&v.y>=Math.min(p.y,q.y)-epsilon&&v.y<=Math.max(p.y,q.y)+epsilon;
  return on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b);
}
function segmentDistance(a:Point,b:Point,c:Point,d:Point):number {
  if(segmentsIntersect(a,b,c,d))return 0;
  return Math.min(pointSegmentDistance(a,c,d),pointSegmentDistance(b,c,d),pointSegmentDistance(c,a,b),pointSegmentDistance(d,a,b));
}
function angleInside(origin:Point,point:Point,angle:number,halfAngle:number):boolean {
  const target=Math.atan2(point.y-origin.y,point.x-origin.x),delta=Math.atan2(Math.sin(target-angle),Math.cos(target-angle));
  return Math.abs(delta)<=halfAngle+1e-9;
}
function pointInsideSector(point:Point,origin:Point,angle:number,halfAngle:number,reach:number):boolean {
  return Math.hypot(point.x-origin.x,point.y-origin.y)<=reach+1e-9&&angleInside(origin,point,angle,halfAngle);
}
function pointArcDistance(point:Point,origin:Point,angle:number,halfAngle:number,reach:number):number {
  if(angleInside(origin,point,angle,halfAngle))return Math.abs(Math.hypot(point.x-origin.x,point.y-origin.y)-reach);
  const left={x:origin.x+Math.cos(angle-halfAngle)*reach,y:origin.y+Math.sin(angle-halfAngle)*reach},right={x:origin.x+Math.cos(angle+halfAngle)*reach,y:origin.y+Math.sin(angle+halfAngle)*reach};
  return Math.min(Math.hypot(point.x-left.x,point.y-left.y),Math.hypot(point.x-right.x,point.y-right.y));
}
function segmentArcDistance(a:Point,b:Point,origin:Point,angle:number,halfAngle:number,reach:number):number {
  const left={x:origin.x+Math.cos(angle-halfAngle)*reach,y:origin.y+Math.sin(angle-halfAngle)*reach},right={x:origin.x+Math.cos(angle+halfAngle)*reach,y:origin.y+Math.sin(angle+halfAngle)*reach};
  let best=Math.min(pointArcDistance(a,origin,angle,halfAngle,reach),pointArcDistance(b,origin,angle,halfAngle,reach),pointSegmentDistance(left,a,b),pointSegmentDistance(right,a,b));
  const dx=b.x-a.x,dy=b.y-a.y,fx=a.x-origin.x,fy=a.y-origin.y,A=dx*dx+dy*dy;
  if(A>1e-12){const B=2*(fx*dx+fy*dy),C=fx*fx+fy*fy-reach*reach,discriminant=B*B-4*A*C;if(discriminant>=0){const root=Math.sqrt(discriminant);for(const t of [(-B-root)/(2*A),(-B+root)/(2*A)])if(t>=0&&t<=1){const point={x:a.x+dx*t,y:a.y+dy*t};if(angleInside(origin,point,angle,halfAngle))return 0;}}}
  const projection=pointSegmentDistance(origin,a,b),length=Math.hypot(dx,dy),t=length<=1e-12?0:Math.max(0,Math.min(1,((origin.x-a.x)*dx+(origin.y-a.y)*dy)/(length*length))),nearest={x:a.x+dx*t,y:a.y+dy*t};
  if(angleInside(origin,nearest,angle,halfAngle))best=Math.min(best,Math.abs(projection-reach));
  return best;
}

/** True when the full target capsule intersects the finite sector, including radial edges and arc. */
export function enemyAttackArcIntersects(origin: Point, facing: Point, target: CapsuleShape, reach: number, halfAngle: number): boolean {
  const facingLength=Math.hypot(facing.x,facing.y);if(facingLength<=1e-9||reach<0||halfAngle<0||halfAngle>Math.PI)return false;
  const angle=Math.atan2(facing.y,facing.x),left={x:origin.x+Math.cos(angle-halfAngle)*reach,y:origin.y+Math.sin(angle-halfAngle)*reach},right={x:origin.x+Math.cos(angle+halfAngle)*reach,y:origin.y+Math.sin(angle+halfAngle)*reach};
  if(pointInsideSector(target.a,origin,angle,halfAngle,reach)||pointInsideSector(target.b,origin,angle,halfAngle,reach)||segmentsIntersect(target.a,target.b,origin,left)||segmentsIntersect(target.a,target.b,origin,right))return true;
  const distance=Math.min(pointSegmentDistance(origin,target.a,target.b),segmentDistance(target.a,target.b,origin,left),segmentDistance(target.a,target.b,origin,right),segmentArcDistance(target.a,target.b,origin,angle,halfAngle,reach));
  return distance<=target.radius+1e-9;
}

export function enemyBlocksFromFacing(facing: Point, incoming: Point): boolean {
  return shieldFacingContact(facing, incoming, GUARD_BLOCK_HALF_ANGLE);
}

export function createEnemyState(id: string, kind: EnemyKind, point: Point, attackReady: number): Enemy {
  const rule = ENEMY_ATTACK_RULES[kind];
  return { id, kind, bossPhase: 0, pattern: 'none', x: point.x, y: point.y, hp: rule.hp, maxHp: rule.hp, radius: kind === 'boss' ? 22 : 12, state: 'idle', stateUntil: 0, attackReady, aimX: 0, aimY: 1, burnUntil: 0, frost: 0, frozenUntil: 0 };
}

export function createEnemyRuntime(enemy: Enemy, spawnReadyAt: number, attackPermitAt: number): EnemyRuntime {
  const length = Math.hypot(enemy.aimX, enemy.aimY) || 1;
  return { enemyId: enemy.id, staggerUntil: 0, knockbackReadyAt: 0, attackPermitAt, spawnReadyAt, shieldFacing: { x: enemy.aimX / length, y: enemy.aimY / length }, buffSourceId: null, buffTargetIds: [] };
}
