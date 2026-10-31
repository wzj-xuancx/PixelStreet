import {legacyGrowthState,type GrowthState} from './growth';
import type {Point,MechanismId,EnemyKind,RoomState,WeaponItem} from './types';
import type {GeometryProfile} from './geometry';
import {threatCost} from './encounters';
export type MeleeKind='sword'|'hammer'|'spear'|'dual'|'scythe'|'greatsword'|'fists'|'chain';
export type MeleeBranch='base'|'piercing-lance'|'halberd'|'phantom-blades'|'blade-dance'|'hook-scythe'|'reaper';
export interface MeleeAction {id:string;weaponId:string;kind:MeleeKind;branch:MeleeBranch;stage:'windup'|'active'|'recover';special:boolean;mode:'blade'|'chain';comboStep:number;strength:number;sampledAt:number;previousFeet:Point;startedAt:number;activeAt:number;recoverAt:number;endsAt:number;origin:Point;direction:Point;charge:number;damageScale:number;splitUsed:boolean;segment:number;hitIds:string[];sweepHitIds:string[]}
export interface EnemyRuntime {enemyId:string;staggerUntil:number;knockbackReadyAt:number;attackPermitAt:number;spawnReadyAt:number;shieldFacing:Point;buffSourceId:string|null;buffTargetIds:string[]}
export type DamageSourceKind='basic'|'special'|'projectile'|'additional'|'dot'|'skill'|'environment'|'enemy';
export interface DamageContext {kind:DamageSourceKind;generation:0|1|2}
export interface CombatFeedback {sourceKind:DamageSourceKind;generation:0|1|2;id:string;sourceId:string;targetId:string;kind:'hit'|'heavy'|'block'|'immune'|'miss'|'already-hit'|'kill'|'dot';point:Point;direction:Point;at:number;expiresAt:number;damage:number}
export interface RewardEntry {sourceId:string;roomId:string;kind:'kill'|'wave'|'room'|'elite'|'event';coins:number;xp:number;essence:number;at:number}
export interface CombatState {
 profile:GeometryProfile;normalClears:number;choicesTaken:number;transferUsed:boolean;traitRanks:{id:MechanismId;rank:1|2}[];action:MeleeAction|null;
 combo:{step:number;expiresAt:number};momentum:{value:number;expiresAt:number};special:{held:boolean;startedAt:number|null;readyAt:number};chainMode:'blade'|'chain';
 reaper:{weaponId:string|null;marks:number;bossReadyAt:number};nextHit:{rollUntil:number;returnUntil:number;returnProjectileId:string|null};enemyRuntime:EnemyRuntime[];feedback:CombatFeedback[];rewardLedger:RewardEntry[];
}
export interface SpawnBatch {id:string;enemies:{id:string;kind:EnemyKind}[]}
export interface SpawnWavePlan {id:string;theme:'mixed'|'swarm'|'ranged'|'charge'|'shield'|'ritual'|'boss';budget:number;batches:SpawnBatch[]}
export interface SpawnTicket {id:string;enemyId:string;kind:EnemyKind;waveIndex:number;batchIndex:number;point:Point;warningAt:number;materializeAt:number;readyAt:number;retries:number}
export interface SpawnState {phase:'idle'|'warning'|'settling'|'active'|'delayed'|'complete';plan:SpawnWavePlan[];waveIndex:number;batchIndex:number;pending:SpawnTicket[];aliveCap:number;retryAt:number;rng:number}
export function createCombatState(profile:GeometryProfile='mild'):CombatState {return{profile,normalClears:0,choicesTaken:0,transferUsed:false,traitRanks:[],action:null,combo:{step:0,expiresAt:0},momentum:{value:0,expiresAt:0},special:{held:false,startedAt:null,readyAt:0},chainMode:'blade',reaper:{weaponId:null,marks:0,bossReadyAt:0},nextHit:{rollUntil:0,returnUntil:0,returnProjectileId:null},enemyRuntime:[],feedback:[],rewardLedger:[]};}
export function createSpawnState(rng=1):SpawnState {return{phase:'idle',plan:[],waveIndex:0,batchIndex:0,pending:[],aliveCap:8,retryAt:0,rng:rng>>>0||1};}
const record=(v:unknown):v is Record<string,unknown>=>typeof v==='object'&&v!==null&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const keys=(v:Record<string,unknown>,names:string)=>{const expected=names.split(' ');return Reflect.ownKeys(v).length===expected.length&&expected.every(k=>Object.hasOwn(v,k));};
const finite=(v:unknown,min=0,max=1e12):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
const integer=(v:unknown,min:number,max:number)=>finite(v,min,max)&&Number.isInteger(v);
const id=(v:unknown):v is string=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(v);
const member=(v:unknown,values:readonly unknown[])=>values.includes(v);
const bool=(v:unknown)=>typeof v==='boolean';
function list(v:unknown,max:number,check:(entry:unknown)=>boolean):v is unknown[] {if(!Array.isArray(v)||v.length>max||Reflect.ownKeys(v).length!==v.length+1)return false;for(let i=0;i<v.length;i++)if(!Object.hasOwn(v,i)||!check(v[i]))return false;return true;}
const point=(v:unknown)=>record(v)&&keys(v,'x y')&&finite(v.x,-100,2100)&&finite(v.y,-100,2100);
const direction=(v:unknown,zero=false)=>record(v)&&keys(v,'x y')&&finite(v.x,-1,1)&&finite(v.y,-1,1)&&(Math.abs(Math.hypot(v.x,v.y)-1)<1e-6||(zero&&v.x===0&&v.y===0));
const unique=(v:unknown[],key:(entry:any)=>unknown=(entry)=>entry)=>new Set(v.map(key)).size===v.length;
const ids=(v:unknown,max:number)=>list(v,max,id)&&unique(v);
export const CURRENT_ENEMY_KINDS=['chaser','shooter','charger','guard','priest','boss'] as const;
const enemyKinds=CURRENT_ENEMY_KINDS;
function validAction(v:unknown):boolean {
 return record(v)&&keys(v,'id weaponId kind branch stage special mode comboStep strength sampledAt previousFeet startedAt activeAt recoverAt endsAt origin direction charge damageScale splitUsed segment hitIds sweepHitIds')&&id(v.id)&&id(v.weaponId)&&member(v.kind,['sword','hammer','spear','dual','scythe','greatsword','fists','chain'])&&member(v.branch,['base','piercing-lance','halberd','phantom-blades','blade-dance','hook-scythe','reaper'])&&member(v.stage,['windup','active','recover'])&&bool(v.special)&&member(v.mode,['blade','chain'])&&integer(v.comboStep,0,3)&&integer(v.strength,0,10)&&finite(v.sampledAt)&&point(v.previousFeet)&&finite(v.startedAt)&&finite(v.activeAt)&&finite(v.recoverAt)&&finite(v.endsAt)&&v.sampledAt>=v.startedAt&&v.sampledAt<=v.endsAt&&v.startedAt<=v.activeAt&&v.activeAt<=v.recoverAt&&v.recoverAt<=v.endsAt&&point(v.origin)&&direction(v.direction)&&finite(v.charge,0,1)&&finite(v.damageScale,1,2.1)&&[1,1.35,1.5,1.25,1.4,1.6875,1.89,1.875,2.1,1.15,1.5525,1.725].some(scale=>Math.abs(scale-(v.damageScale as number))<1e-9)&&bool(v.splitUsed)&&integer(v.segment,0,3)&&ids(v.hitIds,24)&&ids(v.sweepHitIds,24)&&
 (v.branch==='base'||(member(v.branch,['piercing-lance','halberd'])&&v.kind==='spear')||(member(v.branch,['phantom-blades','blade-dance'])&&v.kind==='dual')||(member(v.branch,['hook-scythe','reaper'])&&v.kind==='scythe'));
}
export function validCombatState(v:unknown,mechanisms:readonly MechanismId[],roomIds:readonly string[]):v is CombatState {
 if(!record(v)||!keys(v,'profile normalClears choicesTaken transferUsed traitRanks action combo momentum special chainMode reaper nextHit enemyRuntime feedback rewardLedger')||!member(v.profile,['baseline','mild','wide'])||!integer(v.normalClears,0,8)||!integer(v.choicesTaken,0,5)||!bool(v.transferUsed)||!list(v.traitRanks,3,r=>record(r)&&keys(r,'id rank')&&member(r.id,mechanisms)&&integer(r.rank,1,2))||!unique(v.traitRanks,r=>r.id)||(v.action!==null&&!validAction(v.action)))return false;
 if(!record(v.combo)||!keys(v.combo,'step expiresAt')||!integer(v.combo.step,0,3)||!finite(v.combo.expiresAt)||!record(v.momentum)||!keys(v.momentum,'value expiresAt')||!integer(v.momentum.value,0,10)||!finite(v.momentum.expiresAt)||!record(v.special)||!keys(v.special,'held startedAt readyAt')||!bool(v.special.held)||(v.special.startedAt!==null&&!finite(v.special.startedAt))||v.special.held!==(v.special.startedAt!==null)||!finite(v.special.readyAt)||!member(v.chainMode,['blade','chain'])||!record(v.reaper)||!keys(v.reaper,'weaponId marks bossReadyAt')||(v.reaper.weaponId!==null&&!id(v.reaper.weaponId))||!integer(v.reaper.marks,0,6)||!finite(v.reaper.bossReadyAt)||(v.reaper.weaponId===null&&(v.reaper.marks!==0||v.reaper.bossReadyAt!==0))||!record(v.nextHit)||!keys(v.nextHit,'rollUntil returnUntil returnProjectileId')||!finite(v.nextHit.rollUntil)||!finite(v.nextHit.returnUntil)||(v.nextHit.returnProjectileId!==null&&!id(v.nextHit.returnProjectileId)))return false;
 return list(v.enemyRuntime,256,e=>record(e)&&keys(e,'enemyId staggerUntil knockbackReadyAt attackPermitAt spawnReadyAt shieldFacing buffSourceId buffTargetIds')&&id(e.enemyId)&&finite(e.staggerUntil)&&finite(e.knockbackReadyAt)&&finite(e.attackPermitAt)&&finite(e.spawnReadyAt)&&direction(e.shieldFacing)&&(e.buffSourceId===null||id(e.buffSourceId))&&ids(e.buffTargetIds,2))&&unique(v.enemyRuntime,e=>e.enemyId)&&
 list(v.feedback,128,f=>record(f)&&keys(f,'id sourceId targetId kind point direction at expiresAt damage sourceKind generation')&&id(f.id)&&id(f.sourceId)&&id(f.targetId)&&member(f.sourceKind,['basic','special','projectile','additional','dot','skill','environment','enemy'])&&integer(f.generation,0,2)&&member(f.kind,['hit','heavy','block','immune','miss','already-hit','kill','dot'])&&point(f.point)&&direction(f.direction,true)&&finite(f.at)&&finite(f.expiresAt)&&f.expiresAt>=f.at&&f.expiresAt<=f.at+1000&&finite(f.damage,0,10000))&&unique(v.feedback,f=>f.id)&&
 list(v.rewardLedger,2048,e=>record(e)&&keys(e,'sourceId roomId kind coins xp essence at')&&id(e.sourceId)&&member(e.roomId,roomIds)&&member(e.kind,['kill','wave','room','elite','event'])&&integer(e.coins,0,1e9)&&integer(e.xp,0,1e9)&&integer(e.essence,0,8)&&finite(e.at))&&unique(v.rewardLedger,e=>e.sourceId);
}
export function validSpawnState(v:unknown,cleared=false):v is SpawnState {
 if(!record(v)||!keys(v,'phase plan waveIndex batchIndex pending aliveCap retryAt rng')||!member(v.phase,['idle','warning','settling','active','delayed','complete'])||!integer(v.waveIndex,0,3)||!integer(v.batchIndex,0,32)||!integer(v.aliveCap,1,24)||!finite(v.retryAt)||!integer(v.rng,1,4294967295))return false;
 if(!list(v.plan,3,w=>record(w)&&keys(w,'id theme budget batches')&&id(w.id)&&member(w.theme,['mixed','swarm','ranged','charge','shield','ritual','boss'])&&integer(w.budget,0,120)&&list(w.batches,32,b=>record(b)&&keys(b,'id enemies')&&id(b.id)&&list(b.enemies,24,e=>record(e)&&keys(e,'id kind')&&id(e.id)&&member(e.kind,enemyKinds))&&b.enemies.length>0)&&w.batches.length>0)||!unique(v.plan,w=>w.id)||(v.waveIndex as number)>v.plan.length)return false;
 const plan=v.plan as unknown as SpawnWavePlan[],batchIds=plan.flatMap(w=>w.batches.map(b=>b.id)),enemyIds=plan.flatMap(w=>w.batches.flatMap(b=>b.enemies.map(e=>e.id)));
 if(plan.some(w=>{const enemies=w.batches.flatMap(b=>b.enemies),threat=enemies.reduce((sum,e)=>sum+threatCost(e.kind),0);return w.budget!==threat||(w.theme==='boss'?(enemies.length!==1||enemies[0].kind!=='boss'):enemies.some(e=>e.kind==='boss'))||enemies.filter(e=>e.kind==='priest').length>1;}))return false;
 if(!unique(batchIds)||!unique(enemyIds)||plan.some(w=>w.batches.reduce((sum,b)=>sum+b.enemies.length,0)>96)||(v.batchIndex as number)>(plan[v.waveIndex as number]?.batches.length??0))return false;
 if(!list(v.pending,32,t=>record(t)&&keys(t,'id enemyId kind waveIndex batchIndex point warningAt materializeAt readyAt retries')&&id(t.id)&&id(t.enemyId)&&member(t.kind,enemyKinds)&&integer(t.waveIndex,0,2)&&integer(t.batchIndex,0,31)&&point(t.point)&&finite(t.warningAt)&&finite(t.materializeAt)&&finite(t.readyAt)&&t.warningAt<=t.materializeAt&&t.materializeAt<=t.readyAt&&integer(t.retries,0,8)&&!!plan[t.waveIndex as number]?.batches[t.batchIndex as number]?.enemies.some(e=>e.id===t.enemyId&&e.kind===t.kind))||!unique(v.pending,t=>t.id)||!unique(v.pending,t=>t.enemyId))return false;
 if(member(v.phase,['warning','settling','delayed'])&&v.pending.length===0)return false;
 if(member(v.phase,['idle','complete'])&&v.pending.length!==0)return false;
 if(v.phase==='complete'&&(v.waveIndex!==plan.length||v.batchIndex!==0))return false;
 if(cleared&&(v.pending.length!==0||plan.length>0&&(v.phase!=='complete'||v.waveIndex!==plan.length)))return false;
 return true;
}
/** New namespaces are initialized only after the legacy structural validator accepts the run. */
export function migrateCombatFoundation<T extends {rooms:RoomState[];player:{traits:MechanismId[]};level:number}>(legacy:T,sourceVersion:2|3=3):T&{version:4;combat:CombatState;growth:GrowthState} {
 const run=structuredClone(legacy),combat=createCombatState();
 for(const room of run.rooms)room.spawns=createSpawnState(room.encounterSeed);
 const physical=run as unknown as {player:{weaponSlots:WeaponItem[]};rooms:RoomState[]};
 for(const item of [...physical.player.weaponSlots,...physical.rooms.flatMap(room=>[...room.ground.map(g=>g.weapon),...room.merchantStock.map(o=>o.weapon)])])if(item)item.form=item.evolved?(item.kind==='fire'?'meteor':'blade-ring'):'base';
 for(const projectile of (run as unknown as import('./types').DungeonRun).projectiles){projectile.weaponId=null;projectile.sourceKind=projectile.owner==='enemy'?'enemy':'projectile';projectile.generation=0;}
 combat.traitRanks=run.player.traits.map(id=>({id,rank:1}));combat.normalClears=run.rooms.filter(room=>room.kind==='combat'&&room.cleared).length;combat.choicesTaken=Math.max(0,run.level-1);
 return Object.assign(run,{version:4 as const,combat,growth:legacyGrowthState(run as unknown as import('./types').DungeonRun,sourceVersion)});
}
