/** Pure serializable rules. Actor identity and confirmations belong to a trusted adapter. */
export type FieldMode='manual'|'farm'|'push';
export type FieldTarget={kind:'ground';x:number}|{kind:'monster';id:string}|{kind:'ore';id:string}|{kind:'exit'};
export type FieldMaterial='bone'|'curseCrystal'|'toughHide';
export type FieldSupply='herbal-bandage'|'mining-tonic';
export interface ActorLoadout {gear:string[];attack:number;defence:number;maxHP:number;heal:number;spell:number;gather:number;travelPercent:number;pet:{attack:number;defence:number;gather:number}|null;supply:FieldSupply|null;budget:number}
export interface FieldActor {id:string;loadout:ActorLoadout;floor:number;x:number;hp:number;shield:number;shieldUntil:number;mode:FieldMode;target:FieldTarget|null;farmTarget:FieldTarget|null;online:boolean;remaining:number;spent:number;eligible:boolean;pending:string|null;nextAttack:number;attacks:number;miningDue:number;oreReadyAt:number[];mines:number;supplyUsed:boolean;recoverUntil:number;safe:{floor:number;encounter:number}|null;moveRemainder:number;returned:boolean}
export type EnemyKind='melee'|'ranged'|'charge'|'guardian';
export interface WorldMonster {id:string;kind:EnemyKind;x:number;hp:number;max:number;stage:'idle'|'windup'|'projectile'|'charge';due:number;aimX:number;armorUntil:number;hits:number;immuneUntil:number;pattern:number;summons:number}
export interface WorldEncounter {cleared:boolean;readyAt:number;material:FieldMaterial;monsters:WorldMonster[];participants:string[];scaled:boolean;cycle:number}
export interface WorldFloor {oreX:number;revealed:number;encounters:WorldEncounter[]}
export interface FieldProjectile {id:string;actorId:string;x:number;direction:number;damage:number;remaining:number}
export interface RewardPackage {coins:number;xp:number;gel:number;materials:Partial<Record<FieldMaterial,number>>;ore:number;guardian:boolean}
export type FieldEffect=
 |{id:string;type:'consume-needed';actorId:string;kind:'encounter'|'mining';amount:1;floor:number;encounter:number|null}
 |{id:string;type:'supply-needed';actorId:string;supply:FieldSupply}
 |{id:string;type:'encounter-start';floor:number;encounter:number;actorIds:string[]}
 |{id:string;type:'reward-candidate';actorId:string;reward:RewardPackage;floor:number;encounter:number}
 |{id:string;type:'mine-complete';actorId:string;reward:RewardPackage;floor:number}
 |{id:string;type:'return';actorId:string;reason:string};
export interface FieldConfirmation {eventId:string;actorId:string;accepted:boolean}
export type FieldIntent={actorId:string;kind:'mode';mode:FieldMode}|{actorId:string;kind:'target';target:FieldTarget}|{actorId:string;kind:'return'};
export interface FieldEvent {tick:number;kind:'attack'|'hurt'|'break'|'rupture'|'shot'|'interrupt'|'pulse'|'heal'|'shield'|'bandage'|'guardian-shield'|'guardian-charge'|'guardian-summon'|'victory';actorId:string;targetId:string;amount:number}
export interface FieldWorld {version:2;rulesVersion:2;sessionId:string;seed:number;tick:number;carryMs:number;eventSeq:number;floor:number;active:number|null;actors:FieldActor[];floors:WorldFloor[];projectiles:FieldProjectile[];pending:FieldEffect[];events:FieldEvent[]}
export interface CreateFieldWorldOptions {sessionId:string;seed:number;actors:Array<{id:string;loadout:ActorLoadout}>}
export interface FieldView {sessionId:string;localActorId:string;tick:number;floor:number;mode:FieldMode;x:number;hp:number;maxHP:number;remaining:number;shield:number;target:FieldTarget|null;miningDue:number;recoverUntil:number;active:number|null;floors:WorldFloor[];actors:FieldActor[];projectiles:FieldProjectile[];events:FieldEvent[];loadout:ActorLoadout}
