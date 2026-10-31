import {createGrowthState,legacyGrowthState,CHOICE_CLEAR_MILESTONES,hashGrowth,mapGrowthHash,sourceKey,grantGrowthReward,spearCharge,consumeAttackBoost,grantReturnRhythm} from './growth';
export * from './growth';
import {WEAPONS,CURRENT_WEAPON_KINDS,weaponName,validWeaponForm,isMelee,meleeCanCancel,meleeMovementScale} from './weapons';
import {startMeleeAction,advanceMeleeAction} from './combat';
export * from './weapons';
import {LEGACY_WEAPONS,LEGACY_ENEMIES,LEGACY_MECHANISMS,LEGACY_UPGRADES,LEGACY_XP,legacyEligibleUpgrades} from './legacy-v3';
import {createCombatState,validCombatState,validSpawnState,migrateCombatFoundation,CURRENT_ENEMY_KINDS} from './combat-state';
import type {EnemyRuntime,SpawnTicket,SpawnWavePlan} from './combat-state';
import {movementShape,hurtShape,sweptHurtContact,circleRectOverlap,segmentRectContact,obstacleAttackRect,projectileWorldBounds} from './geometry';
import type {GeometryProfile} from './geometry';
import type {CombatFeedback,DamageContext} from './combat-state';
export * from './geometry';
export * from './combat-state';
export * from './enemies';
export * from './encounters';
import {ATTACK_START_SPACING_MS,CHASER_ATTACK_HALF_ANGLE,CHASER_ATTACK_RANGE,CHARGER_START_RANGE,ENEMY_ATTACK_RULES,GUARD_ATTACK_HALF_ANGLE,GUARD_ATTACK_RANGE,PRIEST_MAX_BUFF_TARGETS,SHIELD_REGEN_DELAY_MS,SHIELD_REGEN_RATE,SHIELD_REGEN_SAFE_RADIUS,SHOOTER_MAX_RANGE,SHOOTER_MIN_RANGE,SPAWN_RETRY_LIMIT,SPAWN_RETRY_MS,SPAWN_SAFE_DISTANCE,SPAWN_SETTLE_MS,SPAWN_WARNING_MS,createEnemyRuntime,createEnemyState,enemyAttackArcIntersects,enemyBlocksFromFacing} from './enemies';
import {encounterLayoutSignature,encounterStageForCompletedRooms,generateEncounterPlans,spawnFallbackPoints,spawnPointCandidates,spawnPlanSeed} from './encounters';
import {STEP_MS,movement} from './foundation';
import {XP_THRESHOLDS,MECHANISMS,MECHANISM_IDS,UPGRADE_IDS,eligibleUpgrades,upgradeChoices,reforgeChoices,evolutionInfo,evolutionOptions,strengthenInfo,transferInfo,mechanismInfo,mechanismRank} from './build';
export {XP_THRESHOLDS,MECHANISMS,eligibleUpgrades,upgradeChoices,reforgeChoices,evolutionInfo,evolutionOptions,strengthenInfo,transferInfo,mechanismInfo,mechanismRank} from './build';
export type {MechanismInfo} from './build';
import {baseRoom,makeFloor,roomWeapon,deriveSeed,seeded,doorTriggerRect,doorApproachRect,DOOR_OPENING_WIDTH} from './map';
export {ROOM_WALL,DOOR_OPENING_WIDTH,DOOR_TRIGGER_DEPTH,doorTriggerRect,doorApproachRect} from './map';
import type {DungeonRun,DungeonInput,RoomState,Enemy,WeaponKind,WeaponItem,Projectile,Effect,Player,Interaction,DoorView,RoomFixture,DiscoveredRoom,MechanismId,AttackZone} from './types';
export * from './types';
export {STEP_MS} from './foundation';
const KINDS=CURRENT_WEAPON_KINDS;
const MAX_PROJECTILES=192, MAX_EFFECTS=128;
const MAX_TIME=1e12, MAX_COUNTER=1e10, MAX_REWARD=1e9;
// A single bounded step can emit <10,000 IDs and schedule at most 5.5 seconds ahead.
function simulationCapacity(r:DungeonRun):boolean {
  if(r.elapsedMs<=MAX_TIME-10000&&r.tick<MAX_COUNTER&&r.sequence<MAX_COUNTER-20000&&r.revision<MAX_COUNTER)return true;
  r.phase='lost';r.choices=[];r.growth.pending=null;clearDungeonControls(r);r.notice='本次探索已达模拟上限 · 已结算奖励保留';return false;
}
function reward(r:DungeonRun,coins:number,xp:number):void {r.reward.coins=Math.min(MAX_REWARD,r.reward.coins+coins);r.reward.xp=Math.min(MAX_REWARD,r.reward.xp+xp);}
const finite=(n:unknown,min=-1e7,max=1e7):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;
const clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));
const dist=(a:{x:number;y:number},b:{x:number;y:number})=>Math.hypot(a.x-b.x,a.y-b.y);
function footRadius(r:DungeonRun,actor:Player|Enemy):number {return 'kind' in actor?movementShape(actor,actor.kind,r.combat.profile,actor.radius).radius:movementShape(actor,'player',r.combat.profile).radius;}
const unit=(x:number,y:number)=>{const n=Math.hypot(x,y)||1;return{x:x/n,y:y/n};};
const id=(r:DungeonRun,prefix:string)=>`${prefix}-${++r.sequence}`;
const next=(r:DungeonRun)=>{let x=r.rng;x^=x<<13;x^=x>>>17;x^=x<<5;r.rng=x>>>0;return r.rng/4294967296;};
export function currentRoom(r:DungeonRun):RoomState {const room=r.rooms.find(v=>v.id===r.currentRoom);if(!room)throw Error('当前房间无效');return room;}
export function activeWeapon(r:DungeonRun):WeaponItem|null {return r.player.weaponSlots[r.player.activeSlot];}
function effect(r:DungeonRun,kind:Effect['kind'],x:number,y:number,radius=15,angle=0,targetX=x,targetY=y,duration=180):void {
  if(r.effects.length>=MAX_EFFECTS)r.effects.shift();r.effects.push({id:id(r,'fx'),kind,x,y,radius,angle,targetX,targetY,expiresAt:r.elapsedMs+duration});
}
function enemy(r:DungeonRun,kind:Enemy['kind'],x:number,y:number):Enemy {return createEnemyState(id(r,'enemy'),kind,{x,y},r.elapsedMs+900+next(r)*400);}
function spawnLegacyWave(r:DungeonRun,room:RoomState):void {
  room.wave++;room.locked=true;room.nextWaveAt=0;if(room.kind==='boss'){const e=enemy(r,'boss',room.width/2,room.height/2);e.bossPhase=1;e.radius=22;e.attackReady=r.elapsedMs+1100;room.enemies=[e];r.notice='石冠守卫 · 第一相';return;}const roll=seeded(deriveSeed(room.encounterSeed,`wave-${room.wave}`));r.rng=deriveSeed(room.encounterSeed,`timing-${room.wave}`);
  if(room.id!=='encounter'){
    const count=(room.wave===1?5:7)+Math.floor(roll()*3)+(room.kind==='elite'?1:0),positions:{x:number;y:number}[]=[];
    const legal=(p:{x:number;y:number})=>!blocked(room,p.x,p.y,movementShape(p,'enemy',r.combat.profile).radius)&&dist(p,r.player)>=132&&positions.every(other=>dist(p,other)>=36);
    for(let i=0;i<600&&positions.length<count;i++){const p={x:40+roll()*(room.width-80),y:40+roll()*(room.height-80)};if(legal(p))positions.push(p);}
    if(positions.length<count)for(let y=40;y<=room.height-40&&positions.length<count;y+=36)for(let x=40;x<=room.width-40&&positions.length<count;x+=36)if(legal({x,y}))positions.push({x,y});
    const kinds:Enemy['kind'][]=['chaser','shooter','charger'];for(let i=kinds.length-1;i>0;i--){const j=Math.floor(roll()*(i+1));[kinds[i],kinds[j]]=[kinds[j],kinds[i]];}
    room.enemies=positions.map((p,i)=>{const kind=kinds[i]??(['chaser','shooter','charger'] as const)[Math.floor(roll()*3)],e=enemy(r,kind,p.x,p.y);if(room.kind==='elite'){e.hp=Math.round(e.hp*1.5);e.maxHp=e.hp;}return e;});r.notice=`第 ${room.wave}/${room.totalWaves} 波 · 封门战斗`;return;
  }
  const positions=room.wave===1?[[530,128],[580,370],[420,300]]:[[550,112],[590,390],[480,250],[370,390]];
  const kinds:Enemy['kind'][]=room.wave===1?['chaser','shooter','charger']:['shooter','chaser','charger','chaser'];
  room.enemies=positions.flatMap(([x,y],i)=>{
    const desired={x:clamp(x*room.width/720,36,room.width-36),y:clamp(y*room.height/528,36,room.height-36)};
    let spawn:{x:number;y:number}|undefined=!blocked(room,desired.x,desired.y,movementShape(desired,'enemy',r.combat.profile).radius)&&dist(desired,r.player)>=110?desired:undefined;
    if(!spawn)for(let sy=36;sy<=room.height-36&&!spawn;sy+=24)for(let sx=36;sx<=room.width-36;sx+=24)if(!blocked(room,sx,sy,movementShape({x:sx,y:sy},'enemy',r.combat.profile).radius)&&dist({x:sx,y:sy},r.player)>=110){spawn={x:sx,y:sy};break;}
    if(!spawn)return [];const e=enemy(r,kinds[i],spawn.x,spawn.y);if(room.kind==='elite'){e.hp=Math.round(e.hp*1.5);e.maxHp=e.hp;}return[e];
  });r.notice=`第 ${room.wave}/${room.totalWaves} 波 · 封门战斗`;
}
function combatRuntime(r:DungeonRun,e:Enemy):EnemyRuntime {
  let runtime=r.combat.enemyRuntime.find(value=>value.enemyId===e.id);
  if(!runtime){runtime=createEnemyRuntime(e,0,e.attackReady);r.combat.enemyRuntime.push(runtime);}
  return runtime;
}
function reservedTickets(room:RoomState,exceptId=''):SpawnTicket[] {
  return room.spawns.pending.filter(ticket=>ticket.id!==exceptId&&!room.enemies.some(enemy=>enemy.id===ticket.enemyId));
}
function safeSpawnPoint(r:DungeonRun,room:RoomState,kind:Enemy['kind'],point:{x:number;y:number},exceptId='',reserved:SpawnTicket[]=room.spawns.pending):boolean {
  const radius=movementShape(point,kind,r.combat.profile).radius;
  if(point.x<24+radius||point.x>room.width-24-radius||point.y<24+radius||point.y>room.height-24-radius||blocked(room,point.x,point.y,radius))return false;
  const safeDistance=Math.min(SPAWN_SAFE_DISTANCE,room.width*.42,room.height*.56);
  if(dist(point,r.player)<safeDistance)return false;
  for(const door of room.doors){const apron=doorApproachRect(room,door.side),x=clamp(point.x,apron.x,apron.x+apron.width),y=clamp(point.y,apron.y,apron.y+apron.height);if(dist(point,{x,y})<radius+8)return false;}
  for(const other of room.enemies)if(other.hp>0&&dist(point,other)<Math.max(36,radius+footRadius(r,other)+10))return false;
  for(const ticket of reserved){if(ticket.id===exceptId||room.enemies.some(enemy=>enemy.id===ticket.enemyId))continue;const otherRadius=movementShape(ticket.point,ticket.kind,r.combat.profile).radius;if(dist(point,ticket.point)<Math.max(36,radius+otherRadius+10))return false;}
  return true;
}
function pointForSpawn(r:DungeonRun,room:RoomState,plan:SpawnWavePlan,enemyId:string,kind:Enemy['kind'],retry:number,exceptId='',reserved:SpawnTicket[]=room.spawns.pending):{x:number;y:number}|null {
  const all=plan.batches.flatMap(batch=>batch.enemies),index=all.findIndex(enemy=>enemy.id===enemyId);if(index<0)return null;
  const seed=spawnPlanSeed(plan),points=spawnPointCandidates(seed,room.width,room.height,all.length,index,retry);
  for(const point of points)if(safeSpawnPoint(r,room,kind,point,exceptId,reserved))return point;
  if(retry>=SPAWN_RETRY_LIMIT)for(const point of spawnFallbackPoints(deriveSeed(seed,`${enemyId}-fallback-${retry}`),room.width,room.height))if(safeSpawnPoint(r,room,kind,point,exceptId,reserved))return point;
  return null;
}
function spawnMarkerPoint(r:DungeonRun,room:RoomState,plan:SpawnWavePlan,enemyId:string,kind:Enemy['kind'],retry:number,reserved:SpawnTicket[]):{x:number;y:number} {
  const all=plan.batches.flatMap(batch=>batch.enemies),index=all.findIndex(enemy=>enemy.id===enemyId),seed=spawnPlanSeed(plan),radius=movementShape({x:0,y:0},kind,r.combat.profile).radius;
  const candidates=[...spawnPointCandidates(seed,room.width,room.height,all.length,index,Math.max(retry,SPAWN_RETRY_LIMIT)),...spawnFallbackPoints(deriveSeed(seed,`${enemyId}-marker-${retry}`),room.width,room.height)];
  const legal=(point:{x:number;y:number})=>point.x>=24+radius&&point.x<=room.width-24-radius&&point.y>=24+radius&&point.y<=room.height-24-radius&&!blocked(room,point.x,point.y,radius)&&room.doors.every(door=>{const apron=doorApproachRect(room,door.side),x=clamp(point.x,apron.x,apron.x+apron.width),y=clamp(point.y,apron.y,apron.y+apron.height);return dist(point,{x,y})>=radius+8;});
  const valid=candidates.filter(legal),separated=valid.find(point=>reserved.every(ticket=>dist(point,ticket.point)>=36));return separated??valid[0]??{x:room.width/2,y:room.height/2};
}
function nextSpawnSeed(state:number):number {let value=state>>>0||0x9e3779b9;value^=value<<13;value^=value>>>17;value^=value<<5;return value>>>0||0x9e3779b9;}
function scheduleSpawnBatch(r:DungeonRun,room:RoomState,plan:SpawnWavePlan,waveIndex:number,batchIndex:number):void {
  const batch=plan.batches[batchIndex];if(!batch)return;
  const reserved:SpawnTicket[]=[];let delayed=false;
  for(const planned of batch.enemies){
    const occupied=[...room.spawns.pending,...reserved],point=pointForSpawn(r,room,plan,planned.id,planned.kind,0,'',occupied)??pointForSpawn(r,room,plan,planned.id,planned.kind,SPAWN_RETRY_LIMIT,'',occupied);
    const fallback=point??spawnMarkerPoint(r,room,plan,planned.id,planned.kind,0,occupied);
    const materializeAt=r.elapsedMs+(point?SPAWN_WARNING_MS:SPAWN_RETRY_MS);
    const ticket:SpawnTicket={id:`${planned.id}-ticket`,enemyId:planned.id,kind:planned.kind,waveIndex,batchIndex,point:fallback,warningAt:r.elapsedMs,materializeAt,readyAt:materializeAt+SPAWN_SETTLE_MS,retries:point?0:SPAWN_RETRY_LIMIT};
    reserved.push(ticket);if(!point)delayed=true;r.combat.enemyRuntime=r.combat.enemyRuntime.filter(value=>value.enemyId!==planned.id);
    room.spawns.rng=nextSpawnSeed(room.spawns.rng);
  }
  room.spawns.pending=reserved;room.spawns.batchIndex=batchIndex+1;room.spawns.phase=delayed?'delayed':'warning';room.spawns.retryAt=delayed?Math.min(...reserved.filter(value=>value.retries>=SPAWN_RETRY_LIMIT).map(value=>value.materializeAt)):0;
  room.wave=waveIndex+1;room.nextWaveAt=0;room.locked=true;
  if(delayed)r.notice='增援正在寻找安全入口 · 房间仍封锁';else r.notice=`第 ${room.wave}/${room.totalWaves} 波 · 地面预警`;
}
function initializeEncounterPlan(r:DungeonRun,room:RoomState):void {
  const completed=r.rooms.filter(candidate=>candidate.kind==='combat'&&candidate.cleared).length;
  const stage=encounterStageForCompletedRooms(completed),prior=[] as string[];
  const roomIndex=r.rooms.indexOf(room);
  for(let index=roomIndex-1;index>=0;index--){const candidate=r.rooms[index];if((candidate.kind==='combat'||candidate.kind==='elite')&&candidate.spawns.plan.length){const signature=encounterLayoutSignature(candidate.spawns.plan.at(-1)!);if(signature)prior.push(signature);break;}}
  const generated=generateEncounterPlans({seed:room.encounterSeed,roomId:room.id,width:room.width,height:room.height,stage,kind:room.kind==='boss'?'boss':room.kind==='elite'?'elite':'combat',waves:room.totalWaves,avoidSignatures:prior});
  room.spawns.plan=generated.plans;room.spawns.waveIndex=0;room.spawns.batchIndex=0;room.spawns.pending=[];room.spawns.aliveCap=generated.aliveCap;room.spawns.retryAt=0;room.spawns.rng=deriveSeed(room.encounterSeed,`${room.id}-spawn-runtime`);room.spawns.phase='active';room.wave=1;room.nextWaveAt=0;room.locked=true;
  scheduleSpawnBatch(r,room,room.spawns.plan[0],0,0);
  if(room.kind==='boss')r.notice='石冠守卫 · 地面预警';
}
function beginEncounter(r:DungeonRun,room:RoomState):void {
  room.encounterStarted=true;
  for(const trap of room.traps)trap.stateUntil=r.elapsedMs+1800;
  if(room.id==='encounter')spawnLegacyWave(r,room);else initializeEncounterPlan(r,room);
}
function tickSpawnQueue(r:DungeonRun,room:RoomState,allowClear=true):void {
  const spawns=room.spawns;
  if(!spawns.plan.length||spawns.phase==='complete')return;
  if(spawns.pending.length){
    if(spawns.retryAt>r.elapsedMs){spawns.phase='delayed';return;}
    const keep:SpawnTicket[]=[];let warning=false,settling=false,delayed=false;
    for(const ticket of spawns.pending){
      const current=room.enemies.find(enemy=>enemy.id===ticket.enemyId),runtime=r.combat.enemyRuntime.find(value=>value.enemyId===ticket.enemyId);
      if(runtime){if(r.elapsedMs<ticket.readyAt){keep.push(ticket);settling=true;}continue;}
      if(current){r.combat.enemyRuntime.push(createEnemyRuntime(current,ticket.readyAt,ticket.readyAt));if(r.elapsedMs<ticket.readyAt){keep.push(ticket);settling=true;}continue;}
      if(r.elapsedMs<ticket.materializeAt){keep.push(ticket);warning=true;continue;}
      if(!safeSpawnPoint(r,room,ticket.kind,ticket.point,ticket.id)){
        const plan=spawns.plan[ticket.waveIndex],point=plan&&pointForSpawn(r,room,plan,ticket.enemyId,ticket.kind,ticket.retries+1,ticket.id);
        if(point){ticket.point=point;ticket.retries=Math.min(SPAWN_RETRY_LIMIT,ticket.retries+1);ticket.warningAt=r.elapsedMs;ticket.materializeAt=r.elapsedMs+SPAWN_WARNING_MS;ticket.readyAt=ticket.materializeAt+SPAWN_SETTLE_MS;keep.push(ticket);warning=true;continue;}
        ticket.retries=SPAWN_RETRY_LIMIT;ticket.warningAt=r.elapsedMs;ticket.materializeAt=r.elapsedMs+SPAWN_RETRY_MS;ticket.readyAt=ticket.materializeAt+SPAWN_SETTLE_MS;keep.push(ticket);delayed=true;continue;
      }
      const enemyState=createEnemyState(ticket.enemyId,ticket.kind,ticket.point,ticket.readyAt);
      if(room.kind==='elite'){enemyState.hp=Math.round(enemyState.hp*1.5);enemyState.maxHp=enemyState.hp;}
      if(ticket.kind==='boss'){enemyState.bossPhase=1;enemyState.radius=22;enemyState.attackReady=ticket.readyAt+1100;r.notice='石冠守卫 · 第一相';}
      room.enemies.push(enemyState);r.combat.enemyRuntime.push(createEnemyRuntime(enemyState,ticket.readyAt,ticket.readyAt));keep.push(ticket);settling=true;
    }
    spawns.pending=keep;spawns.retryAt=delayed?Math.min(...keep.filter(ticket=>ticket.retries>=SPAWN_RETRY_LIMIT).map(ticket=>ticket.materializeAt)):0;
    if(keep.length){spawns.phase=delayed?'delayed':warning?'warning':settling?'settling':'warning';if(delayed)r.notice='增援正在寻找安全入口 · 房间仍封锁';return;}
    spawns.retryAt=0;spawns.phase='active';
  }
  const plan=spawns.plan[spawns.waveIndex],living=room.enemies.filter(enemy=>enemy.hp>0).length;
  if(!plan){if(spawns.waveIndex===spawns.plan.length){spawns.phase='complete';spawns.batchIndex=0;}return;}
  if(spawns.batchIndex<plan.batches.length){
    const batch=plan.batches[spawns.batchIndex];
    if(living+batch.enemies.length<=spawns.aliveCap)scheduleSpawnBatch(r,room,plan,spawns.waveIndex,spawns.batchIndex);
    else spawns.phase='active';
    return;
  }
  if(living>0){spawns.phase='active';return;}
  grantGrowthReward(r,sourceKey('wave',room.id,plan.id),room.id,'wave',2,0);
  if(spawns.waveIndex+1<spawns.plan.length){
    if(!room.nextWaveAt){room.nextWaveAt=r.elapsedMs+1000;spawns.phase='active';r.notice='下一波即将预警 · 房间仍封锁';return;}
    if(r.elapsedMs<room.nextWaveAt){spawns.phase='active';return;}
    spawns.waveIndex++;spawns.batchIndex=0;room.nextWaveAt=0;
    const nextPlan=spawns.plan[spawns.waveIndex];scheduleSpawnBatch(r,room,nextPlan,spawns.waveIndex,0);return;
  }
  if(!allowClear){spawns.phase='active';return;}
  spawns.waveIndex=spawns.plan.length;spawns.batchIndex=0;spawns.phase='complete';spawns.pending=[];spawns.retryAt=0;room.wave=room.totalWaves;room.nextWaveAt=0;room.cleared=true;room.locked=false;clearDungeonControls(r);
  r.combat.enemyRuntime=r.combat.enemyRuntime.filter(runtime=>room.enemies.some(enemy=>enemy.hp>0&&enemy.id===runtime.enemyId));
  r.projectiles=r.projectiles.filter(projectile=>projectile.owner==='player');r.zones=r.zones.filter(zone=>zone.kind!=='boss-impact');
  if(room.kind==='boss'){r.phase='won';r.choices=[];clearDungeonControls(r);r.projectiles=[];r.zones=[];r.notice='石冠守卫已击败 · 探索胜利，全部局内奖励保留';}
  else{r.notice='房间已清理 · 门已开启';completeRoomReward(r,room);}
}
export function createEncounter(seed:number):DungeonRun {
  if(!finite(seed,0,4294967295)||!Number.isInteger(seed))throw Error('种子必须为无符号32位整数');
  const room:RoomState={...baseRoom('encounter','combat',seed),encounterStarted:true,id:'encounter',kind:'combat',gridX:0,gridY:0,width:720,height:528,visited:true,cleared:false,doors:[],locked:true,wave:0,totalWaves:2,nextWaveAt:0,
    obstacles:[{id:'pillar-1',x:288,y:144,width:48,height:72,kind:'pillar',hp:100},{id:'pillar-2',x:288,y:336,width:48,height:72,kind:'pillar',hp:100},{id:'crate-1',x:432,y:216,width:24,height:24,kind:'crate',hp:24}],enemies:[],ground:[],traps:[{id:'trap-1',x:430,y:365,radius:28,state:'idle',stateUntil:2200,hit:false}],chestOpened:false};
  const run:DungeonRun={growth:createGrowthState(),combat:createCombatState(),version:4,runId:`dungeon-${seed}`,seed,rng:seed||0x9e3779b9,elapsedMs:0,tick:0,phase:'exploring',paused:false,currentRoom:room.id,rooms:[room],
    player:{x:96,y:264,hp:100,maxHp:100,shield:40,maxShield:40,shieldDelayUntil:0,moveX:0,moveY:0,aimX:200,aimY:264,firing:false,dashUntil:0,dashReady:0,dashX:1,dashY:0,skillReady:0,wardUntil:0,attackReady:0,chargeStarted:null,weaponSlots:[{id:'weapon-sword',kind:'sword',level:1,evolved:false,form:'base'},null],activeSlot:0,traits:[],runes:[],damageRank:0,hasteRank:0},projectiles:[],effects:[],level:1,essence:0,reforgesLeft:1,zones:[],reward:{coins:0,xp:0},notice:'WASD 移动 · 左键攻击 · F 拾取 · Tab 切换',choices:[],sequence:0,revision:0};
  for(const [i,kind] of (['fire','frost','lightning','boomerang'] as WeaponKind[]).entries())room.ground.push({id:`ground-${kind}`,x:132+i*36,y:312,weapon:{id:`weapon-${kind}`,kind,level:1,evolved:false,form:'base'}});
  spawnLegacyWave(run,room);return run;
}
/** Production floor; the F1 encounter remains available as an explicit unit fixture. */
export function createDungeon(seed:number,profile:GeometryProfile='mild'):DungeonRun {
  const r=createEncounter(seed);r.rooms=makeFloor(seed,profile);r.combat.profile=profile;r.currentRoom='entrance';r.player.weaponSlots=[null,null];r.player.activeSlot=0;r.sequence=0;r.rng=seed||0x9e3779b9;r.combat.enemyRuntime=[];r.combat.feedback=[];r.combat.action=null;
  const room=currentRoom(r);r.player.x=room.width/2;r.player.y=room.height/2;r.player.aimX=r.player.x+100;r.player.aimY=r.player.y;
  r.notice='当前空手 · F 打开入口宝箱，再确认拾取武器';return r;
}
export function roomDoors(r:DungeonRun):DoorView[] {const room=currentRoom(r);return room.doors.map(d=>({...d,x:d.side==='W'?24:d.side==='E'?room.width-24:room.width/2,y:d.side==='N'?24:d.side==='S'?room.height-24:room.height/2,locked:room.locked}));}
export function roomFixtures(r:DungeonRun):RoomFixture[] {
  const room=currentRoom(r),x=room.width/2,y=room.height/2;
  if(room.kind==='chest'||room.kind==='entrance')return[{id:`chest-${room.id}`,kind:'chest',x,y,used:room.chestOpened}];
  if(room.kind==='rest')return[{id:`rest-${room.id}`,kind:'rest',x,y,used:room.restUsed}];
  if(room.kind==='shop')return[{id:`merchant-${room.id}`,kind:'merchant',x,y,used:room.merchantStock.every(o=>o.sold)}];
  if(room.kind==='event')return[{id:`event-${room.id}`,kind:'event',x,y,used:room.eventUsed}];
  if(room.kind==='altar')return[{id:`altar-${room.id}`,kind:'altar',x,y,used:room.altarUsed}];
  return [];
}
export function discoveredRooms(r:DungeonRun):DiscoveredRoom[] {
  return r.rooms.filter(room=>room.visited).map(room=>({id:room.id,gridX:room.gridX,gridY:room.gridY,kind:room.kind,current:room.id===r.currentRoom,cleared:room.cleared,doors:room.doors.map(d=>{const other=r.rooms.find(v=>v.id===d.to)!;return{side:d.side,gridX:other.gridX,gridY:other.gridY,visited:other.visited,...(other.visited?{to:other.id}:{})};})}));
}
export function clearDungeonControls(r:DungeonRun):DungeonRun {r.player.moveX=0;r.player.moveY=0;r.player.firing=false;r.player.chargeStarted=null;r.combat.special.held=false;r.combat.special.startedAt=null;r.combat.action=null;r.combat.nextHit.returnProjectileId=null;r.combat.combo={step:0,expiresAt:0};r.combat.momentum={value:0,expiresAt:0};return r;}
export function nearbyInteractions(r:DungeonRun):Interaction[] {
  const room=currentRoom(r),p=r.player,result:Interaction[]=room.ground.filter(g=>dist(g,p)<=48).sort((a,b)=>dist(a,p)-dist(b,p)||a.id.localeCompare(b.id)).map(g=>({id:g.id,kind:'weapon',label:`拾取 ${weaponName(g.weapon)}`,detail:`Lv${g.weapon.level} · ${WEAPONS[g.weapon.kind].description}${!p.weaponSlots[0]&&!p.weaponSlots[1]?' · 装入主手':p.weaponSlots[0]&&p.weaponSlots[1]?' · 替换当前，旧物落地':' · 装入空槽'}`,weapon:{...g.weapon},position:{x:g.x,y:g.y}}));
  for(const f of roomFixtures(r)){
    if(dist(f,p)>64||(f.used&&f.kind!=='altar'))continue;const position={x:f.x,y:f.y};
    if(f.kind==='chest')result.push({id:f.id,kind:'chest',label:room.kind==='entrance'?'打开起始宝箱':'打开宝箱',detail:room.kind==='entrance'?'十二类武器随机一件 · 开箱后落地，再确认拾取':'取出一件随机武器，留在地面由你拾取',position});
    else if(f.kind==='rest')result.push({id:f.id,kind:'rest',label:'饮用泉水',detail:'本房一次 · 恢复生命35和全部护盾',position});
    else if(f.kind==='merchant'){for(const offer of room.merchantStock)if(!offer.sold)result.push({id:offer.id,kind:'merchant',label:`购买 ${weaponName(offer.weapon)}`,detail:`${offer.price} 局内金币 · 购买后武器落地`,weapon:{...offer.weapon},position,disabled:r.reward.coins<offer.price});}
    else if(f.kind==='event')result.push({id:f.id,kind:'event',label:'取用武器架',detail:'取出一件随机武器，落地后 F 拾取',position});
    else if(f.kind==='altar'){const info=evolutionInfo(r);result.push({id:'altar-options',kind:'altar',label:'选择进阶分支',detail:info.requirements.map(q=>`${q.label} ${q.current}/${q.required}`).join(' · ')||'当前武器没有已命名进阶',position,disabled:!info.canEvolve});}

  }
  return result;
}
function dropFixtureWeapon(r:DungeonRun,suffix:string,position:{x:number;y:number},weapon=roomWeapon(currentRoom(r),suffix)):void {currentRoom(r).ground.push({id:id(r,'ground'),x:position.x,y:position.y+24,weapon});}
function confirmFixture(r:DungeonRun,interaction:Interaction):void {
  if(interaction.disabled||!interaction.position)return;const room=currentRoom(r),p=r.player,w=activeWeapon(r);
  if((interaction.kind==='chest'||interaction.kind==='merchant'||room.kind==='event')&&room.ground.length>=64){r.notice='地面物品已满 · 请先拾取';return;}
  if(interaction.kind==='chest'&&!room.chestOpened){room.chestOpened=true;dropFixtureWeapon(r,room.kind==='entrance'?'starter':'chest',interaction.position);r.notice='宝箱武器已落地 · F 拾取';}
  else if(interaction.kind==='rest'&&!room.restUsed){room.restUsed=true;p.hp=Math.min(p.maxHp,p.hp+35);p.shield=p.maxShield;r.notice='泉水已使用 · 本房不再恢复';}
  else if(interaction.kind==='merchant'){const offer=room.merchantStock.find(o=>o.id===interaction.id&&!o.sold);if(offer&&r.reward.coins>=offer.price){r.reward.coins-=offer.price;offer.sold=true;dropFixtureWeapon(r,offer.id,interaction.position,{...offer.weapon});r.notice='购买成功 · 武器已落地';}}
  else if(interaction.kind==='event'&&room.kind==='event'&&!room.eventUsed){room.eventUsed=true;grantGrowthReward(r,sourceKey('event',room.id),room.id,'event',0,0);dropFixtureWeapon(r,'rack',interaction.position);r.notice='武器架已取用 · F 拾取';}

}
function enterDoor(r:DungeonRun):boolean {
  const source=currentRoom(r),p=r.player;if(source.locked)return false;
  const door=roomDoors(r).find(d=>{const a=doorTriggerRect(source,d.side),horizontal=d.side==='N'||d.side==='S',along=horizontal?p.x:p.y,center=horizontal?source.width/2:source.height/2;return Math.abs(along-center)<=DOOR_OPENING_WIDTH/2-footRadius(r,p)&&p.x>=a.x&&p.x<=a.x+a.width&&p.y>=a.y&&p.y<=a.y+a.height&&((d.side==='N'&&p.moveY<-.1)||(d.side==='S'&&p.moveY>.1)||(d.side==='E'&&p.moveX>.1)||(d.side==='W'&&p.moveX<-.1));});if(!door)return false;
  const target=r.rooms.find(room=>room.id===door.to)!;r.currentRoom=target.id;const back=target.doors.find(d=>d.to===source.id)!;
  p.x=back.side==='W'?64:back.side==='E'?target.width-64:target.width/2;p.y=back.side==='N'?64:back.side==='S'?target.height-64:target.height/2;
  r.projectiles=[];r.effects=[];r.zones=[];r.combat.enemyRuntime=[];p.dashUntil=0;clearDungeonControls(r);target.visited=true;r.revision++;
  if(!target.encounterStarted&&target.totalWaves>0)beginEncounter(r,target);
  else r.notice=target.cleared?'已清理房间 · 可继续探索':'安全房 · F 或按钮确认互动';
  return true;
}
function offerUpgrade(r:DungeonRun):void {
 if(!r.rooms.some(v=>v.kind==='entrance')||r.phase!=='exploring'||!currentRoom(r).cleared||r.combat.choicesTaken>=5)return;
 const legacy=r.growth.mode==='legacy',earned=legacy?LEGACY_XP.filter(x=>r.reward.xp>=x).length:CHOICE_CLEAR_MILESTONES.filter(x=>r.combat.normalClears>=x).length;
 if(earned<=r.combat.choicesTaken)return;const sourceId=legacy?`legacy-xp-${r.combat.choicesTaken+1}`:`clear-${CHOICE_CLEAR_MILESTONES[r.combat.choicesTaken]}`;
 r.growth.pending={sourceId,seed:hashGrowth(`${r.seed}|${sourceId}`),legacyIds:false};r.choices=eligibleUpgrades(r);if(!r.choices.length){r.growth.pending=null;return;}
 r.phase='upgrade';clearDungeonControls(r);r.notice='清房成长 · 选择卡牌，武器强化另用精华';r.revision++;
}
function takeUpgrade(r:DungeonRun,id:import('./types').UpgradeId,replaceSlot?:0|1|2):void {
 if(r.phase!=='upgrade'||!r.choices.includes(id))return;const p=r.player,historical=r.growth.pending?.legacyIds===true;
 if(MECHANISM_IDS.includes(id as MechanismId)){
  const mechanism=id as MechanismId,rank=mechanismRank(r,mechanism);if(rank===2)return;
  if(rank===1){if(replaceSlot!==undefined)return;r.combat.traitRanks.find(q=>q.id===id)!.rank=2;}
  else {if(p.traits.length>=3){if(replaceSlot===undefined||replaceSlot>=p.traits.length)return;const lost=p.traits[replaceSlot];p.traits[replaceSlot]=mechanism;r.combat.traitRanks=r.combat.traitRanks.filter(q=>q.id!==lost);}
   else {if(replaceSlot!==undefined)return;p.traits.push(mechanism);}r.combat.traitRanks.push({id:mechanism,rank:1});}
 }else{if(replaceSlot!==undefined)return;if(id==='power'){if(p.damageRank>=5&&!historical)return;p.damageRank=Math.min(5,p.damageRank+1);}else if(id==='haste'){if(p.hasteRank>=5&&!historical)return;p.hasteRank=Math.min(5,p.hasteRank+1);}else{if(p.maxHp>=10000&&p.hp>=p.maxHp&&!historical)return;p.maxHp=Math.min(10000,p.maxHp+15);p.hp=Math.min(p.maxHp,p.hp+35);}}
 r.combat.choicesTaken++;r.level=r.combat.choicesTaken+1;r.growth.pending=null;r.choices=[];r.phase='exploring';clearDungeonControls(r);r.revision++;offerUpgrade(r);
}
function completeRoomReward(r:DungeonRun,room:RoomState):void {
 const ordinary=room.kind==='combat',elite=room.kind==='elite',legacy=r.growth.mode==='legacy';
 if(grantGrowthReward(r,sourceKey(elite?'elite':'room',room.id),room.id,elite?'elite':'room',elite?14:10,legacy?15:ordinary?12:0,ordinary||elite?1:0)&&ordinary)r.combat.normalClears++;
 offerUpgrade(r);
}
function atAltar(r:DungeonRun):boolean {const room=currentRoom(r);return room.kind==='altar'&&dist(r.player,{x:room.width/2,y:room.height/2})<=64;}
function addZone(r:DungeonRun,kind:AttackZone['kind'],x:number,y:number,radius:number,damage:number,delay=0,duration=1600):void {if(r.zones.length>=32)r.zones.shift();r.zones.push({id:id(r,'zone'),kind,x,y,radius,damage,startsAt:r.elapsedMs+delay,expiresAt:r.elapsedMs+delay+duration,nextPulseAt:0});}
function arrow(r:DungeonRun,charge:number):void {const w=activeWeapon(r);if(w?.kind!=='frost')return;const p=r.player,origin=hurtShape(p,'player',r.combat.profile).center,a=unit(p.aimX-origin.x,p.aimY-origin.y);projectile(r,'frost',origin.x,origin.y,a.x*490,a.y*490,(14+30*charge+w.level*3)*(1+r.player.damageRank*.1)*consumeAttackBoost(r,w.kind),charge);p.attackReady=r.elapsedMs+350/(1+p.hasteRank*.08);}
export function dungeonInput(r:DungeonRun,input:DungeonInput):DungeonRun {
  const safe=parseDungeonInput(input);if(!safe)return r;const p=r.player;
  if(safe.type==='cancel-controls'){clearDungeonControls(r);return r;}
  if(safe.type==='pause'){r.paused=safe.paused;clearDungeonControls(r);return r;}
  if(safe.type==='upgrade'){if(!r.paused&&simulationCapacity(r))takeUpgrade(r,safe.id,safe.replaceSlot);return r;}
  if(r.paused||r.phase!=='exploring'||!simulationCapacity(r))return r;
  if(safe.type==='strengthen'){const info=strengthenInfo(r);if(info.canStrengthen){activeWeapon(r)!.level=info.nextLevel as WeaponItem['level'];r.essence--;clearDungeonControls(r);r.revision++;r.notice=`${info.name}强化至Lv${info.nextLevel}`;}return r;}
  if(safe.type==='transfer'){const info=transferInfo(r,safe.sourceSlot,safe.destinationSlot);if(info.canTransfer){p.weaponSlots[safe.sourceSlot]!.level=info.sourceLevelAfter as WeaponItem['level'];p.weaponSlots[safe.destinationSlot]!.level=info.destinationLevelAfter as WeaponItem['level'];r.combat.transferUsed=true;clearDungeonControls(r);r.revision++;r.notice=`转移${info.levelsMoved}级 · 本局机会已用`;}return r;}
  if(safe.type==='evolve'){const info=evolutionOptions(r).find(q=>q.form===safe.form);if(info?.canEvolve){const w=activeWeapon(r)!;w.form=safe.form;w.evolved=true;currentRoom(r).altarUsed=true;clearDungeonControls(r);r.revision++;effect(r,'evolve',p.x,p.y,80,0,p.x,p.y,700);r.notice=`进阶完成：${info.name}`;}return r;}
  if(safe.type==='control'){
    p.aimX=safe.aimX;p.aimY=safe.aimY;
    if(p.firing&&!safe.firing&&activeWeapon(r)?.kind==='frost'&&p.chargeStarted!==null){if(r.elapsedMs>=p.attackReady)arrow(r,clamp((r.elapsedMs-p.chargeStarted)/1000,0,1));p.chargeStarted=null;}
    p.moveX=safe.moveX;p.moveY=safe.moveY;
    if(!p.firing&&safe.firing&&activeWeapon(r)?.kind==='frost'&&r.elapsedMs>=p.attackReady)p.chargeStarted=r.elapsedMs;
    p.firing=safe.firing;if(p.firing&&activeWeapon(r)&&isMelee(activeWeapon(r)!.kind))startMeleeAction(r);
  } else if(safe.type==='special'){
    const w=activeWeapon(r);if(!w||!isMelee(w.kind))return r;const c=r.combat;
    if(safe.held){if(!c.special.held){c.special.held=true;c.special.startedAt=Math.max(r.elapsedMs,p.attackReady,c.special.readyAt,c.action?.endsAt??0);}}
    else if(c.special.held){const ready=r.elapsedMs>=c.special.startedAt!&&!c.action,charge=spearCharge(r,r.elapsedMs-c.special.startedAt!);c.special.held=false;c.special.startedAt=null;if(ready)startMeleeAction(r,true,charge);}
  } else if(safe.type==='switch'){
    if(p.weaponSlots[p.activeSlot===0?1:0]){clearDungeonControls(r);p.activeSlot=p.activeSlot===0?1:0;r.projectiles=r.projectiles.filter(s=>s.kind!=='orbit');p.chargeStarted=null;p.firing=false;r.revision++;r.notice=`切换：${weaponName(activeWeapon(r)!)}`;}
  } else if(safe.type==='interact'){
    const room=currentRoom(r),i=room.ground.findIndex(g=>g.id===safe.id&&dist(g,p)<=48);if(i<0){const interaction=nearbyInteractions(r).find(v=>v.id===safe.id);if(interaction)confirmFixture(r,interaction);return r;}
    const g=room.ground.splice(i,1)[0],empty=p.weaponSlots[0]===null?0:p.weaponSlots[1]===null?1:null,unarmed=!activeWeapon(r);if(empty!==null){p.weaponSlots[empty]=g.weapon;if(unarmed)p.activeSlot=empty;}
    else {const old=activeWeapon(r)!;p.weaponSlots[p.activeSlot]=g.weapon;r.projectiles=r.projectiles.filter(s=>s.kind!=='orbit');room.ground.push({id:id(r,'ground'),x:p.x,y:p.y,weapon:old});}
    clearDungeonControls(r);r.notice=`获得 ${weaponName(g.weapon)} · Tab 切换`;r.revision++;
  } else if(safe.type==='dash'&&r.elapsedMs>=p.dashReady){
    if(r.combat.action&&!meleeCanCancel(r.combat.action,r.elapsedMs))return r;if(r.combat.action)r.combat.action=null;r.combat.special.held=false;r.combat.special.startedAt=null;
    const d=Math.hypot(p.moveX,p.moveY)>0?unit(p.moveX,p.moveY):unit(p.aimX-p.x,p.aimY-p.y);const rollRank=mechanismRank(r,'roll-next');if(rollRank)r.combat.nextHit.rollUntil=r.elapsedMs+(rollRank===2?1500:1200);r.combat.nextHit.returnProjectileId=null;p.dashX=d.x;p.dashY=d.y;p.dashUntil=r.elapsedMs+170;p.dashReady=r.elapsedMs+850;r.revision++;effect(r,'dash',p.x,p.y,22);
  } else if(safe.type==='reforge'&&atAltar(r)&&r.reforgesLeft>0&&reforgeChoices(r,safe.slot).some(v=>v.id===safe.mechanism)){r.combat.traitRanks=r.combat.traitRanks.filter(q=>q.id!==p.traits[safe.slot]);p.traits[safe.slot]=safe.mechanism;r.combat.traitRanks.push({id:safe.mechanism,rank:1});clearDungeonControls(r);r.revision++;r.reforgesLeft=0;r.notice='机制已重铸 · 本局机会已用完';
  } else if(safe.type==='skill'&&r.elapsedMs>=p.skillReady){
    if(safe.skill==='burst'&&!activeWeapon(r))return r;
    p.skillReady=r.elapsedMs+5500;if(safe.skill==='ward'){p.wardUntil=r.elapsedMs+1800;effect(r,'ward',p.x,p.y,34,0,p.x,p.y,1800);}
    else {effect(r,'burst',p.x,p.y,110);for(const e of currentRoom(r).enemies)if(dist(e,p)<=110){hitEnemy(r,e,24,undefined,0,false,hurtShape(e,e.kind,r.combat.profile,e.radius).center,'skill-burst',undefined,true,{kind:'skill',generation:0});const d=unit(e.x-p.x,e.y-p.y);moveEntity(currentRoom(r),e,d.x*30,d.y*30,footRadius(r,e));}}
  }
  return r;
}
function blocked(room:RoomState,x:number,y:number,radius:number):boolean {return room.obstacles.some(o=>o.hp>0&&circleRectOverlap({x,y},radius,o));}
function moveEntity(room:RoomState,e:{x:number;y:number},dx:number,dy:number,radius:number):void {
  // Substeps prevent fast rolls/charges from crossing thin walls.
  const steps=Math.max(1,Math.ceil(Math.max(Math.abs(dx),Math.abs(dy))/6));
  for(let i=0;i<steps;i++){const x=clamp(e.x+dx/steps,24+radius,room.width-24-radius);if(!blocked(room,x,e.y,radius))e.x=x;const y=clamp(e.y+dy/steps,24+radius,room.height-24-radius);if(!blocked(room,e.x,y,radius))e.y=y;}
}
function feedback(r:DungeonRun,targetId:string,sourceId:string,kind:CombatFeedback['kind'],point:{x:number;y:number},damage=0,direction={x:0,y:0},context:DamageContext={kind:'environment',generation:0}):void {
  if(r.combat.feedback.length>=128)r.combat.feedback.shift();r.combat.feedback.push({id:id(r,'feedback'),targetId,sourceId,sourceKind:context.kind,generation:context.generation,kind,point:{...point},direction,damage,at:r.elapsedMs,expiresAt:r.elapsedMs+90});
}
function damagePlayer(r:DungeonRun,damage:number,point=hurtShape(r.player,'player',r.combat.profile).center,sourceId='enemy'):void {
  const p=r.player;if(r.elapsedMs<p.dashUntil||r.elapsedMs<p.wardUntil||p.hp<=0){feedback(r,'player',sourceId,'immune',point);return;}
  const shield=Math.min(p.shield,damage);p.shield-=shield;p.hp=Math.max(0,p.hp-(damage-shield));p.shieldDelayUntil=r.elapsedMs+SHIELD_REGEN_DELAY_MS;effect(r,'hit',point.x,point.y,18);feedback(r,'player',sourceId,'hit',point,damage);
  if(p.hp===0){r.phase='lost';clearDungeonControls(r);r.combat.reaper={weaponId:null,marks:0,bossReadyAt:0};r.notice='本次探索结束';}
}
function clearEnemyBuffLinks(r:DungeonRun,enemyId:string):void {
  for(const runtime of r.combat.enemyRuntime){
    if(runtime.enemyId===enemyId){runtime.buffTargetIds=[];runtime.buffSourceId=null;continue;}
    if(runtime.buffSourceId===enemyId)runtime.buffSourceId=null;
    if(runtime.buffTargetIds.includes(enemyId))runtime.buffTargetIds=runtime.buffTargetIds.filter(targetId=>targetId!==enemyId);
  }
}
function hitEnemy(r:DungeonRun,e:Enemy,damage:number,kind?:WeaponKind,charge=0,secondary=false,point=hurtShape(e,e.kind,r.combat.profile,e.radius).center,sourceId='attack',incoming?:{x:number;y:number},heavy=false,context:DamageContext={kind:secondary?'additional':'basic',generation:secondary?1:0}):boolean {
  if(e.hp<=0)return false;const wasFrozen=e.frozenUntil>r.elapsedMs;
  if(e.kind==='guard'&&e.state!=='recover'&&e.frozenUntil<=r.elapsedMs){const attacker=incoming??unit(r.player.x-e.x,r.player.y-e.y),facing=combatRuntime(r,e).shieldFacing;if(enemyBlocksFromFacing(facing,attacker)){feedback(r,e.id,sourceId,'block',point,0,unit(attacker.x,attacker.y),context);return false;}}
  const shatter=!secondary&&heavy&&context.generation===0&&r.player.traits.includes('shatter')&&e.frozenUntil>r.elapsedMs&&damage>=20;if(shatter){e.frozenUntil=0;const radius=mechanismRank(r,'shatter')===2?85:75;effect(r,'explosion',e.x,e.y,radius);for(const other of currentRoom(r).enemies)if(other!==e&&other.hp>0&&dist(other,e)<=radius)hitEnemy(r,other,damage*(mechanismRank(r,'shatter')===2?.9:.7),undefined,0,true,hurtShape(other,other.kind,r.combat.profile,other.radius).center,sourceId,undefined,false,{kind:'additional',generation:1});damage*=1.5;}
  const lethal=damage>=e.hp;if(lethal)clearEnemyBuffLinks(r,e.id);e.hp=Math.max(0,e.hp-damage);effect(r,'hit',point.x,point.y,12);feedback(r,e.id,sourceId,e.hp<=0?'kill':context.kind==='dot'?'dot':heavy?'heavy':'hit',point,damage,{x:-(incoming?.x??0),y:-(incoming?.y??0)},context);
  if(kind==='fire'&&!secondary)e.burnUntil=Math.max(e.burnUntil,r.elapsedMs+2400);
  if(!heavy&&kind==='sword'&&e.hp>0){const d=unit(e.x-r.player.x,e.y-r.player.y);moveEntity(currentRoom(r),e,d.x*6,d.y*6,footRadius(r,e));}
  if(heavy&&e.hp>0){const runtime=combatRuntime(r,e);if(r.elapsedMs>=runtime.knockbackReadyAt){const resistance=e.kind==='boss'?.12:currentRoom(r).kind==='elite'?.45:1,d=unit(-(incoming?.x??r.player.x-e.x),-(incoming?.y??r.player.y-e.y));moveEntity(currentRoom(r),e,d.x*(kind==='fists'?45:34)*resistance,d.y*(kind==='fists'?45:34)*resistance,footRadius(r,e));runtime.knockbackReadyAt=r.elapsedMs+(e.kind==='boss'?1400:950);if(e.kind!=='boss'){runtime.staggerUntil=Math.max(runtime.staggerUntil,r.elapsedMs+180*resistance);if(e.state==='windup'){e.state='recover';e.stateUntil=r.elapsedMs+220;}}}}
  if(kind==='frost'){e.frost+=charge>=.8?3:mechanismRank(r,'deep-freeze')===2?3:mechanismRank(r,'deep-freeze')===1?2:1;if(e.frost>=3){e.frost=0;if(!wasFrozen){e.frozenUntil=r.elapsedMs+(e.kind==='boss'?300:1500);effect(r,'freeze',e.x,e.y,22,0,e.x,e.y,e.frozenUntil-r.elapsedMs);}}}return true;
}
function projectile(r:DungeonRun,kind:Projectile['kind'],x:number,y:number,vx:number,vy:number,damage:number,charge=0,additional=false):Projectile|null {if(r.projectiles.length>=MAX_PROJECTILES)return null;const shot:Projectile={id:id(r,'shot'),kind,weaponId:kind==='enemy'?null:activeWeapon(r)?.id??null,sourceKind:kind==='enemy'?'enemy':additional?'additional':'projectile',generation:additional?1:0,owner:kind==='enemy'?'enemy':'player',x,y,vx,vy,radius:kind==='frost'?5:7,damage,expiresAt:r.elapsedMs+(kind==='boomerang'?3000:1800),bornAt:r.elapsedMs,leg:'out',hitIds:[],charge,nextHitAt:0,bounces:0};r.projectiles.push(shot);return shot;}
function attack(r:DungeonRun):void {
  const p=r.player,w=activeWeapon(r);if(!w)return;if(isMelee(w.kind)){if(p.firing&&!r.combat.special.held)startMeleeAction(r);return;}if(w.kind==='boomerang'&&w.evolved)prepareOrbit(r);if(!p.firing||r.elapsedMs<p.attackReady||w.kind==='frost')return;const room=currentRoom(r),center=hurtShape(p,'player',r.combat.profile).center,a=unit(p.aimX-center.x,p.aimY-center.y),power=(1+(w.level-1)*.18)*(1+p.damageRank*.1)*consumeAttackBoost(r,w.kind);
  p.attackReady=r.elapsedMs+(w.kind==='fire'&&w.evolved?800:({fire:430,lightning:650,boomerang:700} as const)[w.kind])/(1+p.hasteRank*.08);
  if(w.kind==='fire'&&w.evolved){addZone(r,'meteor',clamp(p.aimX,48,room.width-48),clamp(p.aimY,48,room.height-48),70,66*power,650,2000);return;}
  if(w.kind==='boomerang'&&w.evolved){for(const s of r.projectiles.filter(v=>v.kind==='orbit'&&v.leg==='orbit')){const flight=unit(p.aimX-s.x,p.aimY-s.y);s.leg='out';s.vx=flight.x*350;s.vy=flight.y*350;s.bornAt=r.elapsedMs;s.hitIds=[];s.bounces=0;s.damage=22*power;s.sourceKind='projectile';s.generation=0;s.expiresAt=r.elapsedMs+3000;}return;}
  if(w.kind==='lightning'){
    let origin:{x:number;y:number}=center;const hit=new Set<string>(),chainSource=id(r,'lightning');
    for(let jump=0;jump<3;jump++){const candidates=room.enemies.filter(e=>e.hp>0&&!hit.has(e.id)&&dist(hurtShape(e,e.kind,r.combat.profile,e.radius).center,origin)<(jump?125:215)&&!lineBlocked(room,origin.x,origin.y,hurtShape(e,e.kind,r.combat.profile,e.radius).center.x,hurtShape(e,e.kind,r.combat.profile,e.radius).center.y)&&(jump||(()=>{const target=hurtShape(e,e.kind,r.combat.profile,e.radius).center,d=unit(target.x-center.x,target.y-center.y);return d.x*a.x+d.y*a.y>.45;})()));candidates.sort((a,b)=>dist(a,origin)-dist(b,origin)||a.id.localeCompare(b.id));const target=candidates[0];if(!target)break;effect(r,'lightning',origin.x,origin.y,5,0,hurtShape(target,target.kind,r.combat.profile,target.radius).center.x,hurtShape(target,target.kind,r.combat.profile,target.radius).center.y,220);hit.add(target.id);hitEnemy(r,target,26*power*Math.pow(.85,jump),w.kind,0,false,hurtShape(target,target.kind,r.combat.profile,target.radius).center,id(r,'lightning'),unit(origin.x-hurtShape(target,target.kind,r.combat.profile,target.radius).center.x,origin.y-hurtShape(target,target.kind,r.combat.profile,target.radius).center.y),false,{kind:jump?'additional':'projectile',generation:jump as 0|1|2});origin=hurtShape(target,target.kind,r.combat.profile,target.radius).center;}
  } else {
    const origin=hurtShape(p,'player',r.combat.profile).center,flight=unit(p.aimX-origin.x,p.aimY-origin.y),flightAngle=Math.atan2(flight.y,flight.x);
    projectile(r,w.kind,origin.x,origin.y,flight.x*(w.kind==='fire'?330:290),flight.y*(w.kind==='fire'?330:290),(w.kind==='fire'?22:21)*power);
    if(w.kind==='boomerang'&&p.traits.includes('twin-blades'))projectile(r,'boomerang',origin.x,origin.y,Math.cos(flightAngle+.22)*290,Math.sin(flightAngle+.22)*290,21*power*(mechanismRank(r,'twin-blades')===2?1.25:1),0,true);
  }
}
function prepareOrbit(r:DungeonRun):void {
 const w=activeWeapon(r);if(!w)return;const wanted=r.player.traits.includes('twin-blades')?4:3,existing=r.projectiles.filter(s=>s.kind==='orbit');
 if(existing.length===wanted)return;
 if(existing.length>wanted){const remove=new Set(existing.slice(wanted).map(s=>s.id));r.projectiles=r.projectiles.filter(s=>!remove.has(s.id));existing.slice(0,wanted).forEach((s,i)=>s.charge=i/wanted);return;}
 if(existing.some(s=>Math.abs(s.charge*wanted-Math.round(s.charge*wanted))>1e-9))existing.forEach((s,i)=>s.charge=i/wanted);
 for(let i=0;i<wanted&&existing.length<wanted&&r.projectiles.length<MAX_PROJECTILES;i++){if(existing.some(s=>Math.abs(s.charge-i/wanted)<1e-9))continue;projectile(r,'orbit',r.player.x,hurtShape(r.player,'player',r.combat.profile).center.y,0,0,22*(1+(w.level-1)*.18)*(1+r.player.damageRank*.1),i/wanted);const s=r.projectiles.at(-1)!;if(i===3&&mechanismRank(r,'twin-blades')===2){s.damage*=1.25;s.sourceKind='additional';s.generation=1;}s.leg='orbit';s.expiresAt=r.elapsedMs+3000;existing.push(s);}
}

function zones(r:DungeonRun):void {for(const z of r.zones){if(z.expiresAt<=r.elapsedMs||z.startsAt>r.elapsedMs||z.nextPulseAt>r.elapsedMs)continue;if(z.kind==='boss-impact'){if(dist(z,r.player)<=z.radius+footRadius(r,r.player))damagePlayer(r,z.damage); // Only a player inside the marked area receives the hit.
      z.nextPulseAt=z.expiresAt;continue;}
    if(z.kind==='meteor'){effect(r,'explosion',z.x,z.y,z.radius);for(const e of currentRoom(r).enemies)if(dist(e,z)<=z.radius+footRadius(r,e))hitEnemy(r,e,z.damage,'fire',0,false,hurtShape(e,e.kind,r.combat.profile,e.radius).center,z.id,unit(z.x-e.x,z.y-e.y),true,{kind:'environment',generation:0});z.kind='burning';z.damage=(mechanismRank(r,'scorch-field')===2?9:6)*(1+r.player.damageRank*.1);if(r.player.traits.includes('scorch-field'))z.radius=Math.min(150,z.radius+(mechanismRank(r,'scorch-field')===2?22:14));}
    else for(const e of currentRoom(r).enemies)if(dist(e,z)<=z.radius+footRadius(r,e))hitEnemy(r,e,z.damage,'fire',0,true,hurtShape(e,e.kind,r.combat.profile,e.radius).center,z.id,undefined,false,{kind:'dot',generation:1});z.nextPulseAt=r.elapsedMs+250;
  }r.zones=r.zones.filter(z=>z.expiresAt>r.elapsedMs);}
function bossAI(r:DungeonRun,e:Enemy,dt:number):void {
  const p=r.player;if(e.bossPhase===1&&e.hp<=e.maxHp/2){e.bossPhase=2;e.state='recover';e.stateUntil=r.elapsedMs+1000;r.projectiles=r.projectiles.filter(s=>s.owner==='player');r.zones=r.zones.filter(z=>z.kind!=='boss-impact');effect(r,'boss-warning',e.x,e.y,95,0,e.x,e.y,1000);r.notice='石冠守卫 · 第二相：弹幕与冲锋加速';return;}
  if(e.frozenUntil>r.elapsedMs)return;
  if(e.state==='recover'&&r.elapsedMs>=e.stateUntil){e.state='idle';e.attackReady=r.elapsedMs+400;}
  if(e.state==='idle'&&r.elapsedMs>=e.attackReady){e.pattern=e.pattern==='none'||e.pattern==='impact'?'fan':e.pattern==='fan'?'charge':'impact';const origin=hurtShape(e,e.kind,r.combat.profile,e.radius).center,target=hurtShape(p,'player',r.combat.profile).center,d=e.pattern==='fan'?unit(target.x-origin.x,target.y-origin.y):unit(p.x-e.x,p.y-e.y);e.aimX=d.x;e.aimY=d.y;e.state='windup';const warning=e.pattern==='charge'?950:e.pattern==='impact'?900:700;e.stateUntil=r.elapsedMs+warning;effect(r,'boss-warning',e.x,e.y,e.pattern==='charge'?30:80,Math.atan2(d.y,d.x),p.x,p.y,warning);if(e.pattern==='impact'){addZone(r,'boss-impact',p.x,p.y,55,25,900,220);if(e.bossPhase===2){addZone(r,'boss-impact',clamp(p.x+95,79,currentRoom(r).width-79),p.y,45,20,1200,220);addZone(r,'boss-impact',clamp(p.x-95,79,currentRoom(r).width-79),p.y,45,20,1500,220);}}}
  if(e.state==='windup'&&r.elapsedMs>=e.stateUntil){e.state='attack';e.stateUntil=r.elapsedMs+(e.pattern==='charge'?ENEMY_ATTACK_RULES.boss.chargeMs!:150);if(e.pattern==='fan'){const origin=hurtShape(e,e.kind,r.combat.profile,e.radius).center,flight=unit(e.aimX,e.aimY),count=e.bossPhase===2?9:7,angle=Math.atan2(flight.y,flight.x);for(let i=0;i<count;i++){const a=angle+(i-(count-1)/2)*.23;projectile(r,'enemy',origin.x,origin.y,Math.cos(a)*(e.bossPhase===2?215:175),Math.sin(a)*(e.bossPhase===2?215:175),16);}}}
  if(e.state==='attack'&&e.pattern==='charge'){moveEntity(currentRoom(r),e,e.aimX*(e.bossPhase===2?420:340)*dt/1000,e.aimY*(e.bossPhase===2?420:340)*dt/1000,footRadius(r,e));if(dist(e,p)<footRadius(r,e)+footRadius(r,p)){damagePlayer(r,24);e.state='recover';e.stateUntil=r.elapsedMs+850;}}
  if(e.state==='attack'&&r.elapsedMs>=e.stateUntil){e.state='recover';e.stateUntil=r.elapsedMs+(e.bossPhase===2?650:850);}
}
function rotateFacing(facing:{x:number;y:number},target:{x:number;y:number},maxRadians:number):{x:number;y:number} {
  const current=Math.atan2(facing.y,facing.x),desired=Math.atan2(target.y,target.x),delta=Math.atan2(Math.sin(desired-current),Math.cos(desired-current)),angle=current+clamp(delta,-maxRadians,maxRadians);return{x:Math.cos(angle),y:Math.sin(angle)};
}
function updatePriestBuffs(r:DungeonRun,room:RoomState):void {
  const living=room.enemies.filter(enemy=>enemy.hp>0),runtimeById=new Map(living.map(enemy=>[enemy.id,combatRuntime(r,enemy)]));
  for(const enemy of living){const runtime=runtimeById.get(enemy.id)!;if(runtime.buffSourceId&&!living.some(source=>source.id===runtime.buffSourceId&&source.kind==='priest'))runtime.buffSourceId=null;}
  for(const priest of living.filter(enemy=>enemy.kind==='priest').sort((a,b)=>a.id.localeCompare(b.id))){
    const source=runtimeById.get(priest.id)!;if(r.elapsedMs<source.spawnReadyAt||priest.frozenUntil>r.elapsedMs){clearEnemyBuffLinks(r,priest.id);continue;}
    const range=ENEMY_ATTACK_RULES.priest.supportRange!,targets=living.filter(enemy=>enemy.kind!=='priest'&&enemy.id!==priest.id&&dist(enemy,priest)<=range&&(runtimeById.get(enemy.id)!.buffSourceId===null||runtimeById.get(enemy.id)!.buffSourceId===priest.id)).sort((a,b)=>dist(a,priest)-dist(b,priest)||a.id.localeCompare(b.id)).slice(0,PRIEST_MAX_BUFF_TARGETS),targetIds=targets.map(enemy=>enemy.id);
    for(const oldId of source.buffTargetIds)if(!targetIds.includes(oldId)){const previous=runtimeById.get(oldId);if(previous?.buffSourceId===priest.id)previous.buffSourceId=null;}
    source.buffTargetIds=targetIds;for(const target of targets)runtimeById.get(target.id)!.buffSourceId=priest.id;
  }
}
function enemyDamageMultiplier(r:DungeonRun,e:Enemy):number {
  const source=combatRuntime(r,e).buffSourceId;if(!source)return 1;
  return currentRoom(r).enemies.some(candidate=>candidate.kind==='priest'&&candidate.id===source&&candidate.hp>0)?ENEMY_ATTACK_RULES.priest.buffMultiplier!:1;
}
function enemyStrike(r:DungeonRun,e:Enemy,kind:'chaser'|'guard'):void {
  const origin=hurtShape(e,kind,r.combat.profile,e.radius).center,target=hurtShape(r.player,'player',r.combat.profile),rule=ENEMY_ATTACK_RULES[kind],reach=kind==='chaser'?CHASER_ATTACK_RANGE:GUARD_ATTACK_RANGE,angle=kind==='chaser'?CHASER_ATTACK_HALF_ANGLE:GUARD_ATTACK_HALF_ANGLE;
  if(enemyAttackArcIntersects(origin,{x:e.aimX,y:e.aimY},target,reach,angle))damagePlayer(r,rule.damage*enemyDamageMultiplier(r,e),target.center,e.id);
}
function permitEnemyAttack(r:DungeonRun,room:RoomState):void {
  const until=r.elapsedMs+ATTACK_START_SPACING_MS;
  for(const enemy of room.enemies)if(enemy.hp>0&&enemy.kind!=='boss')combatRuntime(r,enemy).attackPermitAt=Math.max(combatRuntime(r,enemy).attackPermitAt,until);
}
function softSeparateEnemies(r:DungeonRun,room:RoomState,e:Enemy,dt:number):void {
  if(e.kind==='boss'||e.kind==='charger'&&e.state==='attack')return;
  const radius=footRadius(r,e);
  for(const other of room.enemies){if(other===e||other.hp<=0)continue;const otherRadius=footRadius(r,other),minimum=radius+otherRadius+10,distance=dist(e,other);if(distance>=minimum)continue;const dx=e.x-other.x|| (e.id.localeCompare(other.id)<0?1:-1),d=unit(dx,e.y-other.y),push=Math.min(3,(minimum-distance)*.18)*Math.min(1,dt/STEP_MS);moveEntity(room,e,d.x*push,d.y*push,radius);}
}
function meleeSlot(room:RoomState,e:Enemy,p:Player,r:DungeonRun):{x:number;y:number} {
  const group=room.enemies.filter(enemy=>enemy.hp>0&&(enemy.kind==='chaser'||enemy.kind==='guard')).sort((a,b)=>a.id.localeCompare(b.id)),index=Math.max(0,group.findIndex(enemy=>enemy.id===e.id)),slotCount=Math.min(12,Math.max(1,group.length)),angle=Math.PI*2*(index%slotCount)/slotCount,distance=(e.kind==='guard'?GUARD_ATTACK_RANGE:CHASER_ATTACK_RANGE)+footRadius(r,e)+footRadius(r,p)+10;
  return{x:p.x+Math.cos(angle)*distance,y:p.y+Math.sin(angle)*distance};
}
function beginEnemyAttack(r:DungeonRun,room:RoomState,e:Enemy):void {
  const rule=ENEMY_ATTACK_RULES[e.kind],runtime=combatRuntime(r,e),targetCenter=hurtShape(r.player,'player',r.combat.profile).center,origin=hurtShape(e,e.kind,r.combat.profile,e.radius).center;
  let direction:{x:number;y:number};
  if(e.kind==='charger')direction=unit(r.player.x-e.x,r.player.y-e.y);else direction=unit(targetCenter.x-origin.x,targetCenter.y-origin.y);
  e.aimX=direction.x;e.aimY=direction.y;e.state='windup';e.stateUntil=r.elapsedMs+rule.windupMs;runtime.attackPermitAt=r.elapsedMs;
  if(e.kind==='guard')runtime.shieldFacing=direction;
  permitEnemyAttack(r,room);
}
function beginEnemyStrike(r:DungeonRun,e:Enemy):void {
  const rule=ENEMY_ATTACK_RULES[e.kind];
  if(e.kind==='shooter'){
    const origin=hurtShape(e,'shooter',r.combat.profile,e.radius).center;projectile(r,'enemy',origin.x,origin.y,e.aimX*rule.shotSpeed!,e.aimY*rule.shotSpeed!,rule.damage*enemyDamageMultiplier(r,e));
  } else if(e.kind==='chaser'||e.kind==='guard')enemyStrike(r,e,e.kind);
}
function enemies(r:DungeonRun,dt:number):void {
  const room=currentRoom(r),p=r.player;
  for(const e of room.enemies)if(e.hp>0)combatRuntime(r,e);
  updatePriestBuffs(r,room);
  for(const e of room.enemies){
    if(e.hp<=0)continue;
    if(e.burnUntil>r.elapsedMs){const damage=9*dt/1000;if(damage>=e.hp)clearEnemyBuffLinks(r,e.id);e.hp=Math.max(0,e.hp-damage);if(r.tick%15===0||e.hp===0){effect(r,'burn',e.x,e.y,10);feedback(r,e.id,e.id,e.hp===0?'kill':'dot',hurtShape(e,e.kind,r.combat.profile,e.radius).center,damage,{x:0,y:0},{kind:'dot',generation:1});}}
    if(e.hp<=0)continue;
    const runtime=combatRuntime(r,e);if(r.elapsedMs<runtime.spawnReadyAt)continue;
    if(e.kind==='boss'){bossAI(r,e,dt);continue;}
    if(e.frozenUntil>r.elapsedMs||r.elapsedMs<runtime.staggerUntil)continue;
    const rule=ENEMY_ATTACK_RULES[e.kind],playerCenter=hurtShape(p,'player',r.combat.profile).center,enemyCenter=hurtShape(e,e.kind,r.combat.profile,e.radius).center,distance=dist(e,p),toPlayer=unit(p.x-e.x,p.y-e.y);
    if(e.kind==='guard'&&(e.state==='idle'||e.state==='recover'))runtime.shieldFacing=rotateFacing(runtime.shieldFacing,toPlayer,1.4*dt/1000);
    if(e.state==='windup'){
      if(r.elapsedMs<e.stateUntil){softSeparateEnemies(r,room,e,dt);continue;}
      e.state='attack';e.stateUntil=r.elapsedMs+rule.activeMs;beginEnemyStrike(r,e);if(e.kind==='charger')e.stateUntil=r.elapsedMs+rule.chargeMs!;
    } else if(e.state==='attack'){
      if(e.kind==='charger'){
        moveEntity(room,e,e.aimX*rule.chargeSpeed!*dt/1000,e.aimY*rule.chargeSpeed!*dt/1000,footRadius(r,e));
        if(dist(e,p)<footRadius(r,e)+footRadius(r,p)){damagePlayer(r,rule.damage*enemyDamageMultiplier(r,e),hurtShape(p,'player',r.combat.profile).center,e.id);e.state='recover';e.stateUntil=r.elapsedMs+rule.recoverMs;}
      }
      if(e.state==='attack'&&r.elapsedMs>=e.stateUntil){e.state='recover';e.stateUntil=r.elapsedMs+rule.recoverMs;}
      softSeparateEnemies(r,room,e,dt);continue;
    } else if(e.state==='recover'){
      if(r.elapsedMs>=e.stateUntil){e.state='idle';e.attackReady=r.elapsedMs+rule.cooldownMs;}
      else {softSeparateEnemies(r,room,e,dt);continue;}
    }
    if(e.state!=='idle'){softSeparateEnemies(r,room,e,dt);continue;}
    let move:{x:number;y:number}|null=null,attackReady=distance<=CHASER_ATTACK_RANGE+footRadius(r,e)+footRadius(r,p);
    if(e.kind==='shooter'){
      if(distance<SHOOTER_MIN_RANGE)move={x:-toPlayer.x,y:-toPlayer.y};else if(distance>SHOOTER_MAX_RANGE-18)move=toPlayer;else if(r.elapsedMs>=e.attackReady&&r.elapsedMs>=runtime.attackPermitAt)beginEnemyAttack(r,room,e);
    } else if(e.kind==='charger'){
      if(distance<=CHARGER_START_RANGE){if(r.elapsedMs>=e.attackReady&&r.elapsedMs>=runtime.attackPermitAt)beginEnemyAttack(r,room,e);}else move=toPlayer;
    } else if(e.kind==='priest'){
      const preferred=ENEMY_ATTACK_RULES.priest.minRange!+54;if(distance<ENEMY_ATTACK_RULES.priest.minRange!)move={x:-toPlayer.x,y:-toPlayer.y};else if(distance>preferred)move=toPlayer;
    } else {
      const slot=meleeSlot(room,e,p,r),towardSlot=unit(slot.x-e.x,slot.y-e.y),reach=e.kind==='guard'?GUARD_ATTACK_RANGE:CHASER_ATTACK_RANGE;
      attackReady=distance<=reach+footRadius(r,e)+footRadius(r,p);
      if(!attackReady)move=towardSlot;
      if(attackReady&&r.elapsedMs>=e.attackReady&&r.elapsedMs>=runtime.attackPermitAt)beginEnemyAttack(r,room,e);
    }
    if(move){const length=Math.hypot(move.x,move.y)||1;moveEntity(room,e,move.x/length*rule.moveSpeed*dt/1000,move.y/length*rule.moveSpeed*dt/1000,footRadius(r,e));}
    softSeparateEnemies(r,room,e,dt);
    void playerCenter;void enemyCenter;
  }
}
function lineBlocked(room:RoomState,x1:number,y1:number,x2:number,y2:number,radius=0,ignoreId?:string):boolean {return room.obstacles.some(o=>o.id!==ignoreId&&o.hp>0&&segmentRectContact({x:x1,y:y1},{x:x2,y:y2},obstacleAttackRect(o),radius)!==null);}

function projectileBlock(room:RoomState,from:{x:number;y:number},to:{x:number;y:number},radius:number,profile:GeometryProfile):{t:number;targetId:string}|null {
 const bounds=projectileWorldBounds(room,profile),hits:{t:number;targetId:string}[]=[];
 for(const o of room.obstacles)if(o.hp>0){const t=segmentRectContact(from,to,obstacleAttackRect(o),radius);if(t!==null)hits.push({t,targetId:o.id});}
 for(const [start,end,min,max] of [[from.x,to.x,bounds.x,bounds.x+bounds.width],[from.y,to.y,bounds.y,bounds.y+bounds.height]]){if(start<min||start>max)hits.push({t:0,targetId:'wall'});else if(end<min||end>max)hits.push({t:((end<min?min:max)-start)/(end-start),targetId:'wall'});}
 hits.sort((a,b)=>a.t-b.t||a.targetId.localeCompare(b.targetId));return hits[0]??null;
}
function projectiles(r:DungeonRun,dt:number):void {
 const room=currentRoom(r),p=r.player,ownerCenter=hurtShape(p,'player',r.combat.profile).center,bounds=projectileWorldBounds(room,r.combat.profile);
 for(const s of r.projectiles){
  if(s.expiresAt<=r.elapsedMs)continue;
  if((s.kind==='boomerang'||s.kind==='orbit')&&s.leg==='out'&&r.elapsedMs-s.bornAt>=480){s.leg='return';s.hitIds=[];}
  if((s.kind==='boomerang'||s.kind==='orbit')&&s.leg==='return'){const d=unit(ownerCenter.x-s.x,ownerCenter.y-s.y);s.vx=d.x*370;s.vy=d.y*370;if(dist(s,ownerCenter)<18){if(s.weaponId===activeWeapon(r)?.id)grantReturnRhythm(r,s.id);if(s.kind==='orbit'){s.leg='orbit';s.hitIds=[];}else s.expiresAt=0;continue;}}
  if(s.kind==='orbit'&&s.leg==='orbit'){const angle=r.elapsedMs*.004+s.charge*Math.PI*2;s.x=clamp(p.x+Math.cos(angle)*48,bounds.x,bounds.x+bounds.width);s.y=clamp(ownerCenter.y+Math.sin(angle)*48,bounds.y,bounds.y+bounds.height);s.vx=0;s.vy=0;s.expiresAt=r.elapsedMs+3000;if(r.elapsedMs>=s.nextHitAt){s.hitIds=[];s.nextHitAt=r.elapsedMs+350;}}
  const from={x:s.x,y:s.y},wanted={x:s.x+s.vx*dt/1000,y:s.y+s.vy*dt/1000},block=projectileBlock(room,from,wanted,s.radius,r.combat.profile),travel=block?Math.max(0,block.t-1e-7):1,to={x:from.x+(wanted.x-from.x)*travel,y:from.y+(wanted.y-from.y)*travel};s.x=to.x;s.y=to.y;
  if(s.kind==='orbit'&&s.leg==='orbit'&&block)continue; // A covered passive orb has no attack contact.
  if(s.owner==='enemy'){const contact=sweptHurtContact(from,to,s.radius,p,'player',r.combat.profile);if(contact){damagePlayer(r,s.damage,contact.point,s.id);s.expiresAt=0;}else if(block)s.expiresAt=0;continue;}
  const contacts=room.enemies.filter(e=>e.hp>0).map(e=>({e,contact:sweptHurtContact(from,to,s.radius,e,e.kind,r.combat.profile,e.radius)})).filter(v=>v.contact!==null).sort((a,b)=>a.contact!.t-b.contact!.t||a.e.id.localeCompare(b.e.id));
  for(const {e,contact} of contacts){if(s.hitIds.includes(e.id))continue;const accepted=hitEnemy(r,e,s.damage,s.kind==='spear-shard'?undefined:s.kind as WeaponKind,s.charge,s.generation>0,contact!.point,s.id,unit(-s.vx,-s.vy),s.kind==='frost'&&s.charge>=.8,{kind:s.sourceKind==='additional'?'additional':'projectile',generation:s.generation});s.hitIds.push(e.id);if(accepted&&s.generation===0&&(s.kind==='boomerang'||s.kind==='orbit')&&s.leg==='out'&&s.weaponId===activeWeapon(r)?.id&&mechanismRank(r,'return-rhythm'))r.combat.nextHit.returnProjectileId=s.id;if(s.kind==='spear-shard'){s.expiresAt=0;break;}if(s.kind==='fire'){if(p.traits.includes('scorch-field'))addZone(r,'burning',contact!.point.x,contact!.point.y,mechanismRank(r,'scorch-field')===2?42:34,(mechanismRank(r,'scorch-field')===2?6:4)*(1+p.damageRank*.1));s.x=contact!.point.x;s.y=contact!.point.y;s.expiresAt=0;break;}}
  if(block&&s.expiresAt>r.elapsedMs){feedback(r,block.targetId,s.id,'block',to,0,{x:0,y:0},{kind:'projectile',generation:0});if((s.kind==='boomerang'||s.kind==='orbit')&&s.leg==='out'){if(p.traits.includes('ricochet')&&s.bounces===0){const horizontal=projectileBlock(room,from,{x:wanted.x,y:from.y},s.radius,r.combat.profile);if(horizontal)s.vx=-s.vx;else s.vy=-s.vy;s.bounces=1;if(mechanismRank(r,'ricochet')===2)s.damage*=1.2;}else{s.leg='return';s.hitIds=[];}}else s.expiresAt=0;}
 }
 r.projectiles=r.projectiles.filter(s=>s.expiresAt>r.elapsedMs);
}

function traps(r:DungeonRun):void {for(const t of currentRoom(r).traps){if(r.elapsedMs>=t.stateUntil){if(t.state==='idle'){t.state='windup';t.stateUntil=r.elapsedMs+900;t.hit=false;}else if(t.state==='windup'){t.state='active';t.stateUntil=r.elapsedMs+350;}else{t.state='idle';t.stateUntil=r.elapsedMs+2400;}}if(t.state==='active'&&!t.hit&&dist(t,r.player)<=t.radius+footRadius(r,r.player)){damagePlayer(r,16);t.hit=true;}}}
export function stepDungeon(r:DungeonRun,dtMs=STEP_MS):DungeonRun {
  if(!finite(dtMs,.001,100))throw Error('逻辑步长必须为0–100毫秒');if(r.paused||r.phase!=='exploring'||!simulationCapacity(r))return r;
  r.elapsedMs+=dtMs;r.tick++;if(r.combat.combo.expiresAt<r.elapsedMs)r.combat.combo.step=0;if(r.combat.momentum.expiresAt<r.elapsedMs)r.combat.momentum.value=0;const p=r.player,room=currentRoom(r),d=r.elapsedMs<p.dashUntil?{x:p.dashX*440*dtMs/1000,y:p.dashY*440*dtMs/1000}:movement(p.moveX,p.moveY,(r.rooms.some(v=>v.kind==='entrance')?195:150)*meleeMovementScale(r.combat.action,r.elapsedMs),dtMs);
  moveEntity(room,p,d.x,d.y,footRadius(r,p));if(enterDoor(r))return r;tickSpawnQueue(r,room,false);attack(r);advanceMeleeAction(r,{hit:(e,damage,point,source,incoming,heavy,additional)=>hitEnemy(r,e,damage,activeWeapon(r)?.kind,0,additional,point,source,incoming,heavy,{kind:additional?'additional':r.combat.action?.special?'special':'basic',generation:additional?1:0}),move:(entity,dx,dy)=>moveEntity(room,entity,dx,dy,entity===p?footRadius(r,p):footRadius(r,entity as Enemy)),split:(point,direction,damage,ignoreId)=>{for(const offset of [-.5,.5]){const angle=Math.atan2(direction.y,direction.x)+offset;const shot=projectile(r,'spear-shard',point.x,point.y,Math.cos(angle)*360,Math.sin(angle)*360,damage,0,true);if(shot?.kind==='spear-shard'){shot.expiresAt=r.elapsedMs+340;shot.hitIds=[ignoreId];}}},blocked:(from,to,ignore)=>lineBlocked(room,from.x,from.y,to.x,to.y,0,ignore),hitObstacle:(obstacleId,damage,point)=>{const o=room.obstacles.find(o=>o.id===obstacleId)!;o.hp=Math.max(0,o.hp-damage);feedback(r,o.id,r.combat.action!.id,o.hp===0?'kill':'hit',point,damage,{x:0,y:0},{kind:r.combat.action?.special?'special':'basic',generation:0});},feedback:(target,source,kind,point)=>feedback(r,target,source,kind,point,0,{x:0,y:0},{kind:r.combat.action?.special?'special':'basic',generation:0})});enemies(r,dtMs);projectiles(r,dtMs);zones(r);traps(r);
  const closeEnemy=room.enemies.some(enemy=>enemy.hp>0&&dist(enemy,p)<=SHIELD_REGEN_SAFE_RADIUS),closeProjectile=r.projectiles.some(value=>value.owner==='enemy'&&dist(value,p)<=SHIELD_REGEN_SAFE_RADIUS),stationary=Math.hypot(p.moveX,p.moveY)<.001&&r.elapsedMs>=p.dashUntil&&!p.firing&&p.chargeStarted===null&&r.combat.action===null&&!r.combat.special.held;
  if(p.hp>0&&r.elapsedMs>=p.shieldDelayUntil&&stationary&&!closeEnemy&&!closeProjectile)p.shield=Math.min(p.maxShield,p.shield+SHIELD_REGEN_RATE*dtMs/1000);
  const dead=room.enemies.filter(e=>e.hp<=0),propagatedKills=new Map<string,1|2>();for(let i=0;i<dead.length;i++){const e=dead[i];grantGrowthReward(r,sourceKey('kill',room.id,e.id),room.id,'kill',e.kind==='boss'?40:2,r.growth.mode==='legacy'?(e.kind==='boss'?30:3):0);effect(r,'death',e.x,e.y,20);if((propagatedKills.get(e.id)??0)<2&&(e.burnUntil>r.elapsedMs||propagatedKills.has(e.id))&&p.traits.includes('cinder-burst')){const rank=mechanismRank(r,'cinder-burst'),radius=rank===2?90:80;effect(r,'explosion',e.x,e.y,radius);for(const other of room.enemies)if(other.hp>0&&dist(other,e)<=radius){hitEnemy(r,other,(rank===2?26:20)*(1+p.damageRank*.1),'fire',0,true,hurtShape(other,other.kind,r.combat.profile,other.radius).center,e.id,undefined,false,{kind:'additional',generation:((propagatedKills.get(e.id)??0)+1) as 1|2});if(other.hp<=0){dead.push(other);propagatedKills.set(other.id,((propagatedKills.get(e.id)??0)+1) as 1|2);}}}}
  for(const e of dead)clearEnemyBuffLinks(r,e.id);
  room.enemies=room.enemies.filter(e=>e.hp>0);
  const aliveIds=new Set(room.enemies.map(enemy=>enemy.id)),pendingIds=new Set(room.spawns.pending.map(ticket=>ticket.enemyId));r.combat.enemyRuntime=r.combat.enemyRuntime.filter(runtime=>aliveIds.has(runtime.enemyId)||pendingIds.has(runtime.enemyId));
  if(room.encounterStarted&&!room.cleared&&r.phase==='exploring'){
    if(room.spawns.plan.length)tickSpawnQueue(r,room);
    else if(room.enemies.length===0){
      if(room.wave<room.totalWaves){if(!room.nextWaveAt){room.nextWaveAt=r.elapsedMs+1000;r.notice='下一波即将出现';}else if(r.elapsedMs>=room.nextWaveAt)spawnLegacyWave(r,room);}
      else {room.cleared=true;room.locked=false;clearDungeonControls(r);r.projectiles=r.projectiles.filter(s=>s.owner==='player');r.zones=r.zones.filter(z=>z.kind!=='boss-impact');if(room.kind==='boss'){r.phase='won';r.choices=[];clearDungeonControls(r);r.projectiles=[];r.zones=[];r.notice='石冠守卫已击败 · 探索胜利，全部局内奖励保留';}else{r.notice='房间已清理 · 门已开启';completeRoomReward(r,room);}}
    }
  }
  r.effects=r.effects.filter(e=>e.expiresAt>r.elapsedMs);r.combat.feedback=r.combat.feedback.filter(f=>f.expiresAt>r.elapsedMs);return r;
}
function record(v:unknown):v is Record<string,unknown>{return typeof v==='object'&&v!==null&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;}
function keys(v:Record<string,unknown>,names:string):boolean {const expected=names.split(' ');return Reflect.ownKeys(v).length===expected.length&&expected.every(k=>Object.hasOwn(v,k));}
const textId=(v:unknown):v is string=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(v);
const enumIs=(v:unknown,values:readonly unknown[])=>values.includes(v);
const boolean=(v:unknown)=>typeof v==='boolean';
const integer=(v:unknown,min:number,max:number)=>finite(v,min,max)&&Number.isInteger(v);
const point=(v:Record<string,unknown>)=>finite(v.x,0,2000)&&finite(v.y,0,2000);
const time=(v:unknown)=>finite(v,0,MAX_TIME);
function list(v:unknown,max:number,check:(x:unknown)=>boolean):v is unknown[] {
  if(!Array.isArray(v)||v.length>max||Reflect.ownKeys(v).length!==v.length+1)return false;
  // Array.every skips holes; persistence requires an explicit, valid value at every index.
  for(let i=0;i<v.length;i++)if(!Object.hasOwn(v,i)||!check(v[i]))return false;
  return true;
}
function weapon(v:unknown,modern=false):v is WeaponItem {return record(v)&&keys(v,modern?'id kind level evolved form':'id kind level evolved')&&textId(v.id)&&enumIs(v.kind,modern?KINDS:LEGACY_WEAPONS)&&integer(v.level,1,5)&&boolean(v.evolved)&&(modern?validWeaponForm(v.kind as WeaponKind,v.form,v.evolved,v.level as number):!v.evolved||(v.level===5&&enumIs(v.kind,['fire','boomerang'])));}
function validEnemy(v:unknown,modern=false):boolean {return record(v)&&keys(v,'id kind bossPhase pattern x y hp maxHp radius state stateUntil attackReady aimX aimY burnUntil frost frozenUntil')&&textId(v.id)&&enumIs(v.kind,modern?CURRENT_ENEMY_KINDS:LEGACY_ENEMIES)&&integer(v.bossPhase,0,2)&&enumIs(v.pattern,['none','fan','charge','impact'])&&point(v)&&finite(v.hp,0,10000)&&finite(v.maxHp,1,10000)&&(v.hp as number)<=(v.maxHp as number)&&finite(v.radius,1,40)&&enumIs(v.state,['idle','windup','attack','recover'])&&time(v.stateUntil)&&time(v.attackReady)&&finite(v.aimX,-1,1)&&finite(v.aimY,-1,1)&&time(v.burnUntil)&&finite(v.frost,0,3)&&time(v.frozenUntil);}
function insideRoom(room:RoomState,p:{x:number;y:number},radius:number):boolean {const inset=24+radius;return p.x>=inset&&p.x<=room.width-inset&&p.y>=inset&&p.y<=room.height-inset;}
function legalEncounterState(room:RoomState):boolean {
  if(room.cleared&&!room.visited)return false;
  if(room.kind==='combat'||room.kind==='elite'||room.kind==='boss'){
    if(room.totalWaves!==(room.kind==='boss'?1:2))return false;
    if(!room.encounterStarted)return !room.visited&&room.wave===0&&!room.cleared&&!room.locked&&room.enemies.length===0&&room.nextWaveAt===0;
    if(!room.visited||room.wave<1)return false;
    if(room.cleared)return room.wave===room.totalWaves&&!room.locked&&room.enemies.length===0&&room.nextWaveAt===0;
    return room.locked&&(room.wave<room.totalWaves||room.nextWaveAt===0)&&(room.nextWaveAt===0||room.enemies.length===0);
  }
  return room.totalWaves===0&&room.wave===0&&!room.encounterStarted&&!room.locked&&room.enemies.length===0&&room.nextWaveAt===0;
}
function legalRoomGeometry(room:RoomState,profile:GeometryProfile='baseline'):boolean {
  const playerRadius=movementShape({x:0,y:0},'player',profile).radius;
  return room.obstacles.every(o=>o.x>=24&&o.y>=24&&o.x+o.width<=room.width-24&&o.y+o.height<=room.height-24)
    &&room.enemies.every(e=>insideRoom(room,e,movementShape(e,e.kind,profile,e.radius).radius)&&!blocked(room,e.x,e.y,movementShape(e,e.kind,profile,e.radius).radius))
    &&room.ground.every(g=>insideRoom(room,g,8)&&!blocked(room,g.x,g.y,8))
    &&room.traps.every(t=>insideRoom(room,t,t.radius)&&!blocked(room,t.x,t.y,0))
    &&room.doors.every(d=>{const a=doorApproachRect(room,d.side);return !room.obstacles.some(o=>o.hp>0&&a.x<o.x+o.width+playerRadius&&a.x+a.width>o.x-playerRadius&&a.y<o.y+o.height+playerRadius&&a.y+a.height>o.y-playerRadius);});
}
function validRoom(v:unknown,modern=false):boolean {
  return record(v)&&keys(v,'id kind gridX gridY width height visited cleared doors locked wave totalWaves nextWaveAt layoutId encounterSeed lootSeed encounterStarted restUsed merchantStock eventUsed altarUsed eliteRuneClaimed obstacles enemies ground traps chestOpened')&&textId(v.id)&&enumIs(v.kind,['entrance','combat','chest','rest','shop','event','elite','altar','boss'])&&integer(v.gridX,-20,20)&&integer(v.gridY,-20,20)&&finite(v.width,240,1000)&&finite(v.height,240,1000)&&boolean(v.visited)&&boolean(v.cleared)&&boolean(v.locked)&&!(v.cleared&&v.locked)&&integer(v.wave,0,3)&&integer(v.totalWaves,0,3)&&(v.wave as number)<=(v.totalWaves as number)&&time(v.nextWaveAt)&&boolean(v.chestOpened)&&textId(v.layoutId)&&integer(v.encounterSeed,1,4294967295)&&integer(v.lootSeed,1,4294967295)&&boolean(v.encounterStarted)&&boolean(v.restUsed)&&boolean(v.eventUsed)&&boolean(v.altarUsed)&&boolean(v.eliteRuneClaimed)&&list(v.merchantStock,8,o=>record(o)&&keys(o,'id weapon price sold')&&textId(o.id)&&weapon(o.weapon,modern)&&integer(o.price,0,1000000)&&boolean(o.sold))&&
  list(v.doors,4,d=>record(d)&&keys(d,'to side')&&textId(d.to)&&enumIs(d.side,['N','E','S','W']))&&
  list(v.enemies,24,e=>validEnemy(e,modern))&&list(v.obstacles,64,o=>record(o)&&keys(o,'id x y width height kind hp')&&textId(o.id)&&point(o)&&finite(o.width,1,200)&&finite(o.height,1,200)&&enumIs(o.kind,['pillar','crate'])&&finite(o.hp,0,10000))&&
  list(v.ground,64,g=>record(g)&&keys(g,'id x y weapon')&&textId(g.id)&&point(g)&&weapon(g.weapon,modern))&&
  list(v.traps,16,t=>record(t)&&keys(t,'id x y radius state stateUntil hit')&&textId(t.id)&&point(t)&&finite(t.radius,1,80)&&enumIs(t.state,['idle','windup','active'])&&time(t.stateUntil)&&boolean(t.hit));
}
function validPlayer(v:unknown,modern=false):v is Player {
  return record(v)&&keys(v,'x y hp maxHp shield maxShield shieldDelayUntil moveX moveY aimX aimY firing dashUntil dashReady dashX dashY skillReady wardUntil attackReady chargeStarted weaponSlots activeSlot traits runes damageRank hasteRank')&&point(v)&&finite(v.hp,0,10000)&&finite(v.maxHp,1,10000)&&(v.hp as number)<=(v.maxHp as number)&&finite(v.shield,0,10000)&&finite(v.maxShield,0,10000)&&(v.shield as number)<=(v.maxShield as number)&&time(v.shieldDelayUntil)&&finite(v.moveX,-1,1)&&finite(v.moveY,-1,1)&&finite(v.aimX,-2000,4000)&&finite(v.aimY,-2000,4000)&&boolean(v.firing)&&time(v.dashUntil)&&time(v.dashReady)&&finite(v.dashX,-1,1)&&finite(v.dashY,-1,1)&&time(v.skillReady)&&time(v.wardUntil)&&time(v.attackReady)&&(v.chargeStarted===null||time(v.chargeStarted))&&list(v.weaponSlots,2,w=>w===null||weapon(w,modern))&&v.weaponSlots.length===2&&enumIs(v.activeSlot,[0,1])&&(v.weaponSlots[v.activeSlot as number]!==null||(v.activeSlot===0&&v.weaponSlots.every(w=>w===null)))&&list(v.traits,3,id=>enumIs(id,modern?MECHANISM_IDS:LEGACY_MECHANISMS))&&new Set(v.traits).size===v.traits.length&&list(v.runes,4,id=>enumIs(id,['fire','frost','lightning','boomerang']))&&new Set(v.runes).size===v.runes.length&&integer(v.damageRank,0,5)&&integer(v.hasteRank,0,5);
}
function validModernEncounterLinks(run:DungeonRun):boolean {
  const current=run.rooms.find(room=>room.id===run.currentRoom);if(!current)return false;
  for(const room of run.rooms){
    const spawn=room.spawns;
    if(!spawn.plan.length){if(spawn.pending.length||spawn.phase!=='idle'||spawn.waveIndex!==0||spawn.batchIndex!==0)return false;continue;}
    if(!room.visited||!room.encounterStarted||!['combat','elite','boss'].includes(room.kind)||spawn.plan.length!==room.totalWaves)return false;
    if(room.id!==run.currentRoom&&spawn.pending.length)return false;
    if(spawn.phase==='complete'){
      if(!room.cleared||room.locked||room.wave!==room.totalWaves||room.enemies.length||spawn.waveIndex!==spawn.plan.length||spawn.batchIndex!==0||room.nextWaveAt!==0)return false;
      continue;
    }
    if(room.cleared||!room.locked||room.wave!==spawn.waveIndex+1||spawn.waveIndex>=spawn.plan.length)return false;
    const wave=spawn.plan[spawn.waveIndex];if(spawn.batchIndex>wave.batches.length||room.enemies.filter(enemy=>enemy.hp>0).length>spawn.aliveCap)return false;
    const planned=new Map(wave.batches.flatMap(batch=>batch.enemies).map(enemy=>[enemy.id,enemy.kind]));
    if(room.enemies.some(enemy=>planned.get(enemy.id)!==enemy.kind))return false;
    if(room.nextWaveAt>0&&(spawn.waveIndex+1>=spawn.plan.length||spawn.pending.length||room.enemies.length||spawn.batchIndex!==wave.batches.length))return false;
    for(const ticket of spawn.pending)if(ticket.waveIndex!==spawn.waveIndex||ticket.batchIndex>=spawn.batchIndex)return false;
    if(spawn.phase==='warning'&&!spawn.pending.some(ticket=>!run.combat.enemyRuntime.some(runtime=>runtime.enemyId===ticket.enemyId)))return false;
    if(spawn.phase==='settling'&&!spawn.pending.some(ticket=>run.combat.enemyRuntime.some(runtime=>runtime.enemyId===ticket.enemyId)))return false;
    if(spawn.phase==='delayed'&&spawn.retryAt<=run.elapsedMs)return false;
  }
  const currentEnemies=new Map(current.enemies.map(enemy=>[enemy.id,enemy])),currentTickets=new Map(current.spawns.pending.map(ticket=>[ticket.enemyId,ticket])),runtimes=new Map(run.combat.enemyRuntime.map(runtime=>[runtime.enemyId,runtime]));
  for(const enemy of current.enemies){
    const runtime=runtimes.get(enemy.id);if(current.spawns.plan.length&&enemy.hp>0&&!runtime)return false;
    const ticket=currentTickets.get(enemy.id);if(ticket&&runtime&&runtime.spawnReadyAt!==ticket.readyAt)return false;
  }
  for(const runtime of run.combat.enemyRuntime){
    if(!currentEnemies.has(runtime.enemyId)&&!currentTickets.has(runtime.enemyId))return false;
    const target=currentEnemies.get(runtime.enemyId);
    if(runtime.buffSourceId){const source=currentEnemies.get(runtime.buffSourceId),sourceRuntime=runtimes.get(runtime.buffSourceId);if(!source||source.hp<=0||source.kind!=='priest'||!target||target.hp<=0||target.kind==='priest'||!sourceRuntime?.buffTargetIds.includes(runtime.enemyId))return false;}
    for(const targetId of runtime.buffTargetIds){const source=currentEnemies.get(runtime.enemyId),buffTarget=currentEnemies.get(targetId),targetRuntime=runtimes.get(targetId);if(!source||source.hp<=0||source.kind!=='priest'||!buffTarget||buffTarget.kind==='priest'||buffTarget.hp<=0||targetRuntime?.buffSourceId!==source.id)return false;}
  }
  return true;
}
export function parseDungeonInput(raw:unknown):DungeonInput|null {
  if(!record(raw))return null;
  if(raw.type==='control'&&keys(raw,'type moveX moveY aimX aimY firing')&&finite(raw.moveX,-1,1)&&finite(raw.moveY,-1,1)&&finite(raw.aimX,-2000,4000)&&finite(raw.aimY,-2000,4000)&&boolean(raw.firing))return {...raw} as unknown as DungeonInput;
  if(raw.type==='upgrade'&&enumIs(raw.id,UPGRADE_IDS)){
    if(keys(raw,'type id'))return {...raw} as DungeonInput;
    if(keys(raw,'type id replaceSlot')&&MECHANISM_IDS.includes(raw.id as MechanismId)&&integer(raw.replaceSlot,0,2))return {...raw} as DungeonInput;
  }
  if(raw.type==='strengthen'&&keys(raw,'type'))return {type:'strengthen'};
  if(raw.type==='transfer'&&keys(raw,'type sourceSlot destinationSlot')&&enumIs(raw.sourceSlot,[0,1])&&enumIs(raw.destinationSlot,[0,1]))return {...raw} as DungeonInput;
  if(raw.type==='evolve'&&keys(raw,'type form')&&enumIs(raw.form,['meteor','blade-ring','piercing-lance','halberd','phantom-blades','blade-dance','hook-scythe','reaper']))return {...raw} as DungeonInput;
  if(raw.type==='reforge'&&keys(raw,'type slot mechanism')&&integer(raw.slot,0,2)&&enumIs(raw.mechanism,MECHANISM_IDS))return {...raw} as DungeonInput;
  if(raw.type==='special'&&keys(raw,'type held')&&boolean(raw.held))return {...raw} as DungeonInput;
  if(enumIs(raw.type,['dash','switch','cancel-controls'])&&keys(raw,'type'))return {...raw} as DungeonInput;
  if(raw.type==='skill'&&keys(raw,'type skill')&&enumIs(raw.skill,['burst','ward']))return {...raw} as DungeonInput;
  if(raw.type==='interact'&&keys(raw,'type id')&&textId(raw.id))return {...raw} as DungeonInput;
  if(raw.type==='pause'&&keys(raw,'type paused')&&boolean(raw.paused))return {...raw} as DungeonInput;
  return null;
}
/** Persistence boundary: reject malformed or unbounded state; never repair into a different run. */
function parseValidatedDungeonRun(raw:unknown,modern=false,profile:GeometryProfile='baseline',modernRun?:DungeonRun):DungeonRun|null {
  if(record(raw)&&raw.version===2){
    // v2 always owned a weapon. Validate that old invariant before an explicit, clone-only migration.
    if(!record(raw.player)||!list(raw.player.weaponSlots,2,w=>w===null||weapon(w,modern))||raw.player.weaponSlots.length!==2||!weapon(raw.player.weaponSlots[0])||!enumIs(raw.player.activeSlot,[0,1])||!raw.player.weaponSlots[raw.player.activeSlot as number])return null;
    const migrated=parseValidatedDungeonRun({...raw,version:3});if(!migrated)return null;
    // Existing runs retain their equipment/progress and cannot claim a new starter reward retroactively.
    for(const room of migrated.rooms)if(room.kind==='entrance')room.chestOpened=true;return migrated;
  }
  if(!record(raw)||!keys(raw,'version runId seed rng elapsedMs tick phase paused currentRoom rooms player projectiles effects reward notice choices sequence revision level essence reforgesLeft zones')||raw.version!==3||!textId(raw.runId)||!integer(raw.seed,0,4294967295)||!integer(raw.rng,1,4294967295)||!time(raw.elapsedMs)||!integer(raw.tick,0,MAX_COUNTER)||!enumIs(raw.phase,['exploring','upgrade','won','lost'])||!boolean(raw.paused)||!textId(raw.currentRoom)||!list(raw.rooms,modern?32:12,v=>validRoom(v,modern))||!raw.rooms.length||!validPlayer(raw.player,modern)||!integer(raw.sequence,0,MAX_COUNTER)||!integer(raw.revision,0,MAX_COUNTER)||typeof raw.notice!=='string'||raw.notice.length>300||!list(raw.choices,3,id=>enumIs(id,modern?UPGRADE_IDS:LEGACY_UPGRADES))||!record(raw.reward)||!keys(raw.reward,'coins xp')||!integer(raw.reward.coins,0,MAX_REWARD)||!integer(raw.reward.xp,0,MAX_REWARD))return null;
  if(!list(raw.projectiles,MAX_PROJECTILES,s=>record(s)&&keys(s,modern?'id kind weaponId sourceKind generation owner x y vx vy radius damage expiresAt bornAt leg hitIds charge nextHitAt bounces':'id kind owner x y vx vy radius damage expiresAt bornAt leg hitIds charge nextHitAt bounces')&&textId(s.id)&&enumIs(s.kind,modern?['fire','frost','boomerang','orbit','enemy','spear-shard']:['fire','frost','boomerang','orbit','enemy'])&&(!modern||(s.weaponId===null||textId(s.weaponId))&&enumIs(s.sourceKind,['projectile','additional','enemy'])&&integer(s.generation,0,1)&&(s.sourceKind==='enemy')===(s.owner==='enemy')&&(s.sourceKind==='additional')===(s.generation===1)&&(s.kind!=='spear-shard'||s.generation===1&&s.leg==='out'&&s.bounces===0))&&enumIs(s.owner,['player','enemy'])&&((s.kind==='enemy')===(s.owner==='enemy'))&&finite(s.x,-100,2100)&&finite(s.y,-100,2100)&&finite(s.vx,-1000,1000)&&finite(s.vy,-1000,1000)&&finite(s.radius,1,40)&&finite(s.damage,0,10000)&&time(s.expiresAt)&&time(s.bornAt)&&enumIs(s.leg,['out','return','orbit'])&&list(s.hitIds,24,textId)&&finite(s.charge,0,1)&&time(s.nextHitAt)&&integer(s.bounces,0,1)))return null;
  if(!list(raw.effects,MAX_EFFECTS,e=>record(e)&&keys(e,'id kind x y radius angle targetX targetY expiresAt')&&textId(e.id)&&enumIs(e.kind,['slash','hit','burn','freeze','lightning','dash','burst','ward','death','explosion','evolve','boss-warning'])&&finite(e.x,-100,2100)&&finite(e.y,-100,2100)&&finite(e.radius,0,300)&&finite(e.angle,-Math.PI,Math.PI)&&finite(e.targetX,-100,2100)&&finite(e.targetY,-100,2100)&&time(e.expiresAt)))return null;
  if(!integer(raw.level,1,6)||!integer(raw.essence,0,modern?16:6)||!integer(raw.reforgesLeft,0,1)||!list(raw.zones,32,z=>record(z)&&keys(z,'id kind x y radius startsAt expiresAt nextPulseAt damage')&&textId(z.id)&&enumIs(z.kind,['burning','meteor','boss-impact'])&&point(z)&&finite(z.radius,1,150)&&time(z.startsAt)&&time(z.expiresAt)&&time(z.nextPulseAt)&&finite(z.damage,0,10000)))return null;
  const run=modernRun??raw as unknown as DungeonRun,room=run.rooms.find(r=>r.id===run.currentRoom);
  if(!activeWeapon(run)&&run.player.chargeStarted!==null)return null;
  if(!room||!room.visited||!insideRoom(room,run.player,movementShape(run.player,'player',profile).radius)||blocked(room,run.player.x,run.player.y,movementShape(run.player,'player',profile).radius))return null;
  // Shots can briefly enter the wall band on launch/return; unlike pickups they need not be walkable.
  if(!run.projectiles.every(s=>insideRoom(room,s,modern?-124:-24))||!run.effects.every(e=>insideRoom(room,e,modern?-124:-24)&&insideRoom(room,{x:e.targetX,y:e.targetY},modern?-124:-24)))return null;
  if(new Set(run.rooms.map(r=>`${r.gridX},${r.gridY}`)).size!==run.rooms.length)return null;
  const evolved=[...run.player.weaponSlots.filter((w):w is WeaponItem=>w!==null),...run.rooms.flatMap(v=>[...v.ground.map(g=>g.weapon),...v.merchantStock.filter(o=>!o.sold).map(o=>o.weapon)])].filter(w=>w.evolved);
  const usedAltars=run.rooms.filter(v=>v.altarUsed);
  if(evolved.length>1||usedAltars.length!==evolved.length||usedAltars.some(v=>v.kind!=='altar'||!v.visited))return null;
  if(!modern&&run.level>1&&run.reward.xp<LEGACY_XP[run.level-2])return null;
  if(run.phase==='won'&&(room.kind!=='boss'||!room.cleared||run.player.hp<=0))return null;
  if(!modern&&run.phase==='upgrade'&&JSON.stringify(run.choices)!==JSON.stringify(legacyEligibleUpgrades(run)))return null;
  if((run.phase==='upgrade')!==(modern?run.choices.length>0:run.choices.length===3)||new Set(run.choices).size!==run.choices.length||(run.phase==='upgrade'&&(!room.cleared||run.level>5||!modern&&run.reward.xp<LEGACY_XP[run.level-1])))return null;
  if(run.zones.some(z=>!insideRoom(room,z,-24)))return null;
  const ids=new Set<string>(),add=(v:string)=>{const serial=/^(?:enemy|fx|shot|ground|zone|feedback)-(\d+)$/.exec(v);if(ids.has(v)||(serial&&Number(serial[1])>run.sequence))return false;ids.add(v);return true;};
  for(const r of run.rooms){
    if(r.enemies.some(e=>e.kind==='boss'?(r.kind!=='boss'||e.bossPhase===0):(e.bossPhase!==0||e.pattern!=='none')))return null;
    if(!add(r.id)||!legalRoomGeometry(r,profile)||!legalEncounterState(r)||new Set(r.doors.map(d=>d.side)).size!==r.doors.length||new Set(r.doors.map(d=>d.to)).size!==r.doors.length||!r.doors.every(d=>{const to=run.rooms.find(v=>v.id===d.to),opposite={N:'S',S:'N',E:'W',W:'E'} as const;if(!to||to===r)return false;const dx=d.side==='E'?1:d.side==='W'?-1:0,dy=d.side==='S'?1:d.side==='N'?-1:0;return to.gridX===r.gridX+dx&&to.gridY===r.gridY+dy&&to.doors.some(back=>back.to===r.id&&back.side===opposite[d.side]);}))return null;for(const e of [...r.enemies,...r.obstacles,...r.ground,...r.traps])if(!add(e.id))return null;for(const g of r.ground)if(!add(g.weapon.id))return null;for(const offer of r.merchantStock){if(!add(offer.id)||(!offer.sold&&!add(offer.weapon.id)))return null;}}
  const entrances=run.rooms.filter(v=>v.kind==='entrance');if(entrances.length>1)return null;
  // Standalone encounter fixtures have no entrance; every multi-room state still forms one reachable graph.
  const reached=new Set<string>(),pending=[entrances[0]??room];while(pending.length){const candidate=pending.pop()!;if(reached.has(candidate.id))continue;reached.add(candidate.id);for(const d of candidate.doors)pending.push(run.rooms.find(v=>v.id===d.to)!);}if(reached.size!==run.rooms.length)return null;
  const seenVisited=new Set<string>(),visitedPending=[entrances[0]??room];while(visitedPending.length){const candidate=visitedPending.pop()!;if(!candidate.visited||seenVisited.has(candidate.id))continue;seenVisited.add(candidate.id);for(const d of candidate.doors){const other=run.rooms.find(v=>v.id===d.to)!;if(other.visited)visitedPending.push(other);}}if(seenVisited.size!==run.rooms.filter(v=>v.visited).length)return null;
  for(const w of run.player.weaponSlots)if(w&&!add(w.id))return null;for(const e of [...run.projectiles,...run.effects,...run.zones])if(!add(e.id))return null;
  return structuredClone(run);
}

/** v3 is a frozen, strict entry point; v4 never normalizes unknown or invalid state. */
export function parseDungeonRun(raw:unknown):DungeonRun|null {
  if(!record(raw))return null;
  if(raw.version===2||raw.version===3){const old=parseValidatedDungeonRun(raw);return old?migrateCombatFoundation(old,raw.version):null;}
  if(raw.version!==4||!keys(raw,'version runId seed rng elapsedMs tick phase paused currentRoom rooms player projectiles effects reward notice choices sequence revision level essence reforgesLeft zones combat growth')||!Array.isArray(raw.rooms))return null;
  const roomIds=raw.rooms.map(room=>record(room)?room.id:undefined);if(!roomIds.every((id):id is string=>typeof id==='string')||!validCombatState(raw.combat,MECHANISM_IDS,roomIds))return null;
  if(!list(raw.rooms,32,room=>record(room)&&Object.hasOwn(room,'spawns')&&validSpawnState(room.spawns,room.cleared===true)))return null;
  const {combat,growth,rooms,...body}=raw;
  const structural={...body,version:3,rooms:rooms.map(room=>{const {spawns,...legacy}=room as Record<string,unknown>;return legacy;})};
  if(!parseValidatedDungeonRun(structural,true,combat.profile,raw as unknown as DungeonRun))return null;
  if(combat.action&&!raw.player)return null;
  const parsed=raw as unknown as DungeonRun;
  const held=activeWeapon(parsed);if(combat.special.held&&(!held||!isMelee(held.kind)||combat.action!==null&&combat.special.startedAt!<combat.action.endsAt))return null;
  if(combat.action&&(combat.action.sampledAt>parsed.elapsedMs||parsed.elapsedMs>=combat.action.endsAt||combat.action.stage!==(combat.action.sampledAt<combat.action.activeAt?'windup':combat.action.sampledAt<combat.action.recoverAt?'active':'recover')))return null;
  if(combat.action&&!parsed.player.weaponSlots.some((w,i)=>i===parsed.player.activeSlot&&w&&w.id===combat.action!.weaponId&&w.kind===combat.action!.kind&&w.form===combat.action!.branch))return null;
  const physical=[...parsed.player.weaponSlots,...parsed.rooms.flatMap(room=>[...room.ground.map(g=>g.weapon),...room.merchantStock.filter(o=>!o.sold).map(o=>o.weapon)])];
  for(const shot of parsed.projectiles){if(shot.owner==='enemy'){if(shot.weaponId!==null)return null;continue;}if(shot.weaponId===null){if(parsed.growth?.mode==='paced'&&parsed.rooms.some(q=>q.kind==='entrance'))return null;}else{const source=physical.find(w=>w?.id===shot.weaponId);if(!source||source.kind!==(shot.kind==='orbit'?'boomerang':shot.kind==='spear-shard'?'spear':shot.kind))return null;}if(shot.sourceKind==='additional'&&!['boomerang','orbit','spear-shard'].includes(shot.kind))return null;}
  if(combat.reaper.weaponId!==null&&!physical.some(w=>w&&w.id===combat.reaper.weaponId&&w.form==='reaper'))return null;
  const serialIds=new Set(parsed.rooms.flatMap(room=>[room.id,...room.enemies.map(e=>e.id),...room.obstacles.map(e=>e.id),...room.ground.flatMap(g=>[g.id,g.weapon.id]),...room.traps.map(e=>e.id),...room.merchantStock.flatMap(o=>o.sold?[o.id]:[o.id,o.weapon.id])]).concat(parsed.player.weaponSlots.flatMap(w=>w?[w.id]:[]),parsed.projectiles.map(p=>p.id),parsed.effects.map(e=>e.id),parsed.zones.map(z=>z.id)));
  for(const newId of [...combat.feedback.map(f=>f.id),...(combat.action?[combat.action.id]:[]),...parsed.rooms.flatMap(room=>[...room.spawns.plan.flatMap(w=>[w.id,...w.batches.map(b=>b.id)]),...room.spawns.pending.map(t=>t.id)])]){if(serialIds.has(newId))return null;serialIds.add(newId);const serial=/^(?:feedback|action)-(\d+)$/.exec(newId);if(serial&&Number(serial[1])>parsed.sequence)return null;}
  const plannedEnemyIds=parsed.rooms.flatMap(room=>room.spawns.plan.flatMap(w=>w.batches.flatMap(batch=>batch.enemies.map(enemy=>enemy.id))));if(new Set(plannedEnemyIds).size!==plannedEnemyIds.length)return null;
  for(const enemyId of plannedEnemyIds){if(serialIds.has(enemyId)&&!parsed.rooms.some(room=>room.enemies.some(enemy=>enemy.id===enemyId)))return null;serialIds.add(enemyId);}
  if(!validModernEncounterLinks(parsed)||!validGrowthState(parsed))return null;

  return structuredClone(raw) as unknown as DungeonRun;
}

/** Modern growth is validated separately so frozen v2/v3 acceptance never broadens. */
function validGrowthState(r:DungeonRun):boolean {
 const g=r.growth;if(!record(g)||!keys(g,'mode legacy pending')||!enumIs(g.mode,['paced','legacy']))return false;
 if(g.mode==='paced'){if(g.legacy!==null)return false;}
 else {const l=g.legacy;if(!record(l)||!keys(l,'version roomCount mapHash initialLevel initialClears baseCoins baseXp baseEssence pendingChoices')||!enumIs(l.version,[2,3])||!integer(l.roomCount,1,12)||l.roomCount!==r.rooms.length||!integer(l.mapHash,1,4294967295)||l.mapHash!==mapGrowthHash(r.rooms)||!integer(l.initialLevel,1,6)||!integer(l.initialClears,0,8)||l.initialClears>r.combat.normalClears||!integer(l.baseCoins,0,MAX_REWARD)||!integer(l.baseXp,0,MAX_REWARD)||!integer(l.baseEssence,0,6)||!list(l.pendingChoices,3,id=>enumIs(id,LEGACY_UPGRADES))||new Set(l.pendingChoices).size!==l.pendingChoices.length||l.initialLevel>r.level||l.initialLevel>1&&l.baseXp<LEGACY_XP[l.initialLevel-2])return false;
  // Genuine legacy maps retain their old role vocabulary and at most four ordinary fights.
  if(r.rooms.some(q=>['battle-c','battle-d','battle-e','battle-f'].includes(q.id))||r.rooms.filter(q=>q.kind==='combat').length>4)return false;
 }
 if(r.level!==r.combat.choicesTaken+1||r.rooms.some(q=>q.kind==='entrance')&&r.combat.normalClears!==r.rooms.filter(q=>q.kind==='combat'&&q.cleared).length)return false;
 if(r.player.traits.length!==r.combat.traitRanks.length||r.player.traits.some(id=>!r.combat.traitRanks.some(q=>q.id===id)))return false;
 const floor=r.rooms.some(q=>q.kind==='entrance');
 if(g.mode==='paced'&&floor){
  if(r.rooms.length!==16||r.rooms.filter(q=>q.kind==='combat').length!==8)return false;
  const chain=['entrance','crossroads','battle-a','battle-b','battle-c','battle-d','battle-e','battle-f','altar','depth-a','depth-b','boss'];
  if(chain.some((id,i)=>!r.rooms.some(q=>q.id===id&&(i===0||q.doors.some(d=>d.to===chain[i-1]))))||r.rooms.some(q=>chain.includes(q.id)&&q.doors.some(d=>chain.includes(d.to)&&Math.abs(chain.indexOf(q.id)-chain.indexOf(d.to))!==1)))return false;
 }
 if((r.phase==='upgrade')!==(g.pending!==null))return false;
 if(g.pending){const p=g.pending;if(!record(p)||!keys(p,'sourceId seed legacyIds')||!textId(p.sourceId)||!integer(p.seed,1,4294967295)||!boolean(p.legacyIds))return false;
  if(p.legacyIds){const l=g.legacy;if(g.mode!=='legacy'||!l||p.sourceId!=='legacy-pending'||p.seed!==hashGrowth(r.runId+'-legacy-pending')||r.level!==l.initialLevel||JSON.stringify(r.choices)!==JSON.stringify(l.pendingChoices)||r.choices.length!==3)return false;}
  else {const source=g.mode==='legacy'?`legacy-xp-${r.combat.choicesTaken+1}`:`clear-${CHOICE_CLEAR_MILESTONES[r.combat.choicesTaken]}`;
   if(p.sourceId!==source||p.seed!==hashGrowth(`${r.seed}|${source}`)||JSON.stringify(r.choices)!==JSON.stringify(eligibleUpgrades(r)))return false;
   if(g.mode==='paced'?r.combat.normalClears<CHOICE_CLEAR_MILESTONES[r.combat.choicesTaken]:r.reward.xp<LEGACY_XP[r.combat.choicesTaken])return false;
  }
 }
 const earned=g.mode==='paced'?CHOICE_CLEAR_MILESTONES.filter(x=>r.combat.normalClears>=x).length:LEGACY_XP.filter(x=>r.reward.xp>=x).length;
 if(floor&&r.combat.choicesTaken>earned)return false;
 const ledger=r.combat.rewardLedger;for(const e of ledger){const room=r.rooms.find(q=>q.id===e.roomId)!;if(e.at>r.elapsedMs)return false;
  if(e.kind==='room'||e.kind==='elite'){if(!room.cleared||e.kind==='elite'!==(room.kind==='elite')||e.sourceId!==sourceKey(e.kind,room.id)||e.coins!==(e.kind==='elite'?14:10)||e.essence!==(room.kind==='combat'||room.kind==='elite'?1:0)||e.xp!==(g.mode==='legacy'?15:room.kind==='combat'?12:0))return false;}
  else if(e.kind==='event'){if(!room.eventUsed||e.sourceId!==sourceKey('event',room.id)||e.coins||e.xp||e.essence)return false;}
  else if(e.kind==='wave'){if(e.coins!==2||e.xp||e.essence||!room.spawns.plan.some((plan,i)=>e.sourceId===sourceKey('wave',room.id,plan.id)&&(room.cleared||i<room.spawns.waveIndex||i===room.spawns.waveIndex&&room.spawns.batchIndex===plan.batches.length&&!room.enemies.some(e=>e.hp>0)&&!room.spawns.pending.length)))return false;}
  else if(e.kind==='kill'){const plans=room.spawns.plan.flatMap(p=>p.batches.flatMap(b=>b.enemies)),matched=plans.find(enemy=>e.sourceId===sourceKey('kill',room.id,enemy.id));if(e.essence||e.coins!==2&&e.coins!==40||g.mode==='paced'&&e.xp!==0||g.mode==='legacy'&&e.xp!==(e.coins===40?30:3))return false;if(matched){const wave=room.spawns.plan.findIndex(p=>p.batches.some(b=>b.enemies.some(enemy=>enemy.id===matched.id))),batch=room.spawns.plan[wave].batches.findIndex(b=>b.enemies.some(enemy=>enemy.id===matched.id));if(wave>room.spawns.waveIndex||wave===room.spawns.waveIndex&&batch>=room.spawns.batchIndex||room.spawns.pending.some(t=>t.enemyId===matched.id)&&!r.combat.enemyRuntime.some(e=>e.enemyId===matched.id))return false;}if(plans.length&&(!matched||room.enemies.some(enemy=>enemy.id===matched.id&&enemy.hp>0)||(matched.kind==='boss')!==(e.coins===40)))return false;}
 }
 if(floor&&g.mode==='paced'&&r.rooms.some(q=>q.kind==='combat'&&q.cleared&&!ledger.some(e=>e.roomId===q.id&&e.kind==='room')))return false;
 if(floor){const xp=(g.legacy?.baseXp??0)+ledger.reduce((n,e)=>n+e.xp,0),coins=(g.legacy?.baseCoins??0)+ledger.reduce((n,e)=>n+e.coins,0),essence=(g.legacy?.baseEssence??0)+ledger.reduce((n,e)=>n+e.essence,0);if(r.reward.xp!==Math.min(MAX_REWARD,xp)||r.reward.coins>coins||r.essence>essence)return false;}
 return true;
}
