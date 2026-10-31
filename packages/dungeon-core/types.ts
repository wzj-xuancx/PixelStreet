import type {GrowthState} from './growth';
import type {CombatState,SpawnState} from './combat-state';
export type WeaponKind = 'sword'|'hammer'|'spear'|'dual'|'scythe'|'greatsword'|'fists'|'chain'|'fire'|'frost'|'lightning'|'boomerang';
export type WeaponForm='base'|'meteor'|'blade-ring'|'piercing-lance'|'halberd'|'phantom-blades'|'blade-dance'|'hook-scythe'|'reaper';
export interface WeaponItem {id:string;kind:WeaponKind;level:1|2|3|4|5;evolved:boolean;form:WeaponForm}
export interface Point {x:number;y:number}
export type MechanismId='cinder-burst'|'scorch-field'|'deep-freeze'|'shatter'|'twin-blades'|'ricochet'|'roll-next'|'spear-split'|'spear-charge'|'spear-sweep'|'return-rhythm';
export interface Player extends Point {
  hp:number;maxHp:number;shield:number;maxShield:number;shieldDelayUntil:number;
  moveX:number;moveY:number;aimX:number;aimY:number;firing:boolean;
  dashUntil:number;dashReady:number;dashX:number;dashY:number;skillReady:number;wardUntil:number;
  attackReady:number;chargeStarted:number|null;weaponSlots:[WeaponItem|null,WeaponItem|null];activeSlot:0|1;
  traits:MechanismId[];runes:string[];damageRank:number;hasteRank:number;
}
export type EnemyKind='chaser'|'shooter'|'charger'|'guard'|'priest'|'boss';
export interface Enemy extends Point {
  id:string;kind:EnemyKind;bossPhase:0|1|2;pattern:'none'|'fan'|'charge'|'impact';hp:number;maxHp:number;radius:number;state:'idle'|'windup'|'attack'|'recover';
  stateUntil:number;attackReady:number;aimX:number;aimY:number;burnUntil:number;frost:number;frozenUntil:number;
}
export interface Obstacle extends Point {id:string;width:number;height:number;kind:'pillar'|'crate';hp:number}
export interface GroundWeapon extends Point {id:string;weapon:WeaponItem}
export interface Trap extends Point {id:string;radius:number;state:'idle'|'windup'|'active';stateUntil:number;hit:boolean}
export interface MerchantOffer {id:string;weapon:WeaponItem;price:number;sold:boolean}
export interface DoorView extends Point {to:string;side:'N'|'E'|'S'|'W';locked:boolean}
export interface RoomFixture extends Point {id:string;kind:'chest'|'rest'|'merchant'|'event'|'altar'|'rune';used:boolean}
export interface DiscoveredRoom {id:string;gridX:number;gridY:number;kind:RoomState['kind'];current:boolean;cleared:boolean;doors:{side:'N'|'E'|'S'|'W';gridX:number;gridY:number;visited:boolean;to?:string}[]}
export interface RoomState {
  spawns:SpawnState;id:string;kind:'entrance'|'combat'|'chest'|'rest'|'shop'|'event'|'elite'|'altar'|'boss';gridX:number;gridY:number;
  width:number;height:number;visited:boolean;cleared:boolean;doors:{to:string;side:'N'|'E'|'S'|'W'}[];locked:boolean;
  wave:number;totalWaves:number;nextWaveAt:number;layoutId:string;encounterSeed:number;lootSeed:number;encounterStarted:boolean;restUsed:boolean;merchantStock:MerchantOffer[];eventUsed:boolean;altarUsed:boolean;eliteRuneClaimed:boolean;obstacles:Obstacle[];enemies:Enemy[];ground:GroundWeapon[];traps:Trap[];chestOpened:boolean;
}
export interface Projectile extends Point {
  id:string;kind:'fire'|'frost'|'boomerang'|'orbit'|'enemy'|'spear-shard';weaponId:string|null;sourceKind:'projectile'|'additional'|'enemy';generation:0|1;owner:'player'|'enemy';vx:number;vy:number;radius:number;
  damage:number;expiresAt:number;bornAt:number;leg:'out'|'return'|'orbit';hitIds:string[];charge:number;nextHitAt:number;bounces:0|1;
}
export interface Effect extends Point {
  id:string;kind:'slash'|'hit'|'burn'|'freeze'|'lightning'|'dash'|'burst'|'ward'|'death'|'explosion'|'evolve'|'boss-warning';expiresAt:number;
  radius:number;angle:number;targetX:number;targetY:number;
}
export type UpgradeId=MechanismId|'power'|'haste'|'vitality';
export interface UpgradeChoice {operation:'acquire'|'rank-up'|'stat';currentRank:0|1|2;targetRank:1|2|null;requiresReplacement:boolean;id:UpgradeId;label:string;detail:string;kind:'mechanism'|'stat';synergy:string}
export type EvolutionRequirementKey='weapon'|'level'|'mechanism'|'altar'|'unused';
export interface EvolutionRequirement {key:EvolutionRequirementKey;label:string;current:number;required:number;met:boolean}
export interface EvolutionOption extends EvolutionInfo {form:Exclude<WeaponForm,'base'>;detail:string}
export interface EvolutionInfo {name:string;canEvolve:boolean;compatible:MechanismId[];requirements:EvolutionRequirement[]}
export interface AttackZone extends Point {id:string;kind:'burning'|'meteor'|'boss-impact';radius:number;startsAt:number;expiresAt:number;nextPulseAt:number;damage:number}
export interface DungeonRun {
  growth:GrowthState;combat:CombatState;version:4;runId:string;seed:number;rng:number;elapsedMs:number;tick:number;phase:'exploring'|'upgrade'|'won'|'lost';paused:boolean;
  currentRoom:string;rooms:RoomState[];player:Player;projectiles:Projectile[];effects:Effect[];
  level:number;essence:number;reforgesLeft:0|1;zones:AttackZone[];reward:{coins:number;xp:number};notice:string;choices:UpgradeId[];sequence:number;revision:number;
}
export type DungeonInput =
  |{type:'control';moveX:number;moveY:number;aimX:number;aimY:number;firing:boolean}
  |{type:'strengthen'}|{type:'transfer';sourceSlot:0|1;destinationSlot:0|1}|{type:'evolve';form:Exclude<WeaponForm,'base'>}
  |{type:'special';held:boolean}|{type:'cancel-controls'}
  |{type:'upgrade';id:UpgradeId;replaceSlot?:0|1|2}|{type:'reforge';slot:0|1|2;mechanism:MechanismId}|{type:'dash'}|{type:'skill';skill:'burst'|'ward'}|{type:'interact';id:string}|{type:'switch'}|{type:'pause';paused:boolean};
export interface Interaction {id:string;kind:'weapon'|'chest'|'rest'|'merchant'|'event'|'altar';label:string;detail:string;weapon?:WeaponItem;position?:Point;disabled?:boolean}
