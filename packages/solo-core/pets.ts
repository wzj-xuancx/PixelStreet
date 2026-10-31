import {partyBusy} from './party-state';
import type {Profile} from './index';
import type {InventoryDefinition} from '../content/inventory-catalog';
import {buddyJob} from './camp-life';
import {COMPANIONS,companionLevel} from './leisure';
export const PET_ID='slime' as const;
export const PET_SLOTS=['collar','guard','charm'] as const;
export type PetSlot=typeof PET_SLOTS[number];
export type PetRole='leisure'|'expedition';
export const PET_SLOT_NAMES:Record<PetSlot,string>={collar:'项圈',guard:'护具',charm:'护符'};
export const PET_GEAR_CATALOG={
 'moss-collar':{name:'探路项圈',slot:'collar',effect:'挂机普攻+1',coins:6,gel:2,ore:0,herb:0},
 'leaf-guard':{name:'苔叶护具',slot:'guard',effect:'挂机减伤+1',coins:8,gel:2,ore:2,herb:0},
 'sun-charm':{name:'拾光护符',slot:'charm',effect:'远征每场采集材料+1',coins:8,gel:0,ore:1,herb:2},
} as const;
export type PetGearId=keyof typeof PET_GEAR_CATALOG;
export const PET_GEAR_IDS=Object.keys(PET_GEAR_CATALOG) as PetGearId[];
export type PetSlots=Record<PetSlot,PetGearId|null>;
export interface Pets {version:1;petId:typeof PET_ID;role:PetRole;ownedGearIDs:PetGearId[];slots:PetSlots;active:{runId:string;petId:typeof PET_ID;slots:PetSlots}|null}
export type PetAction={type:'pet-role';petId:typeof PET_ID;role:PetRole}|{type:'petgear-craft'|'petgear-equip'|'petgear-unequip';id:PetGearId};
export const emptyPetSlots=():PetSlots=>({collar:null,guard:null,charm:null});
export const initialPets=():Pets=>({version:1,petId:PET_ID,role:'leisure',ownedGearIDs:[],slots:emptyPetSlots(),active:null});
/** Read fallback never installs the extension or copies companion growth. */
export const petsOf=(p:Profile):Pets=>p.pets??initialPets();
export const petIdentity=(p:Profile)=>({petId:PET_ID,name:COMPANIONS.slime.name,xp:p.leisure.companions.slime!,level:companionLevel(p.leisure.companions.slime!),source:'初始伙伴·已结识'});
export const petGearUnlocked=(p:Profile):boolean=>p.totals.wins>=1;
export const isPetGearId=(id:unknown):id is PetGearId=>typeof id==='string'&&Object.hasOwn(PET_GEAR_CATALOG,id);
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
function shape(v:unknown,keys:string):asserts v is Record<string,unknown>{if(!object(v)||Object.keys(v).sort().join(' ')!==keys.split(' ').sort().join(' '))throw Error('宠物字段不匹配');}
function validateSlots(v:unknown,owned:PetGearId[]):asserts v is PetSlots{shape(v,PET_SLOTS.join(' '));for(const slot of PET_SLOTS){const id=v[slot];if(id!==null&&(!isPetGearId(id)||PET_GEAR_CATALOG[id].slot!==slot||!owned.includes(id)))throw Error('宠物装备槽位或所有权无效');}}
export function validatePets(raw:unknown,p:Profile):asserts raw is Pets{
 shape(raw,'version petId role ownedGearIDs slots active');if(raw.version!==1||raw.petId!==PET_ID||(raw.role!=='leisure'&&raw.role!=='expedition')||!Array.isArray(raw.ownedGearIDs)||raw.ownedGearIDs.length>3||Array.from(raw.ownedGearIDs).some(id=>!isPetGearId(id))||new Set(raw.ownedGearIDs).size!==raw.ownedGearIDs.length)throw Error('宠物身份、职责或拥有集无效');
 const owned=raw.ownedGearIDs as PetGearId[];validateSlots(raw.slots,owned);
 if(raw.role==='expedition'&&(buddyJob(p,PET_ID)||p.leisure.run?.companion===PET_ID||p.leisure.run?.bonds?.support===PET_ID))throw Error('苔团子职责与岗位或悠游冲突');
 if(raw.active!==null){shape(raw.active,'runId petId slots');if(raw.role!=='expedition'||raw.active.petId!==PET_ID||typeof raw.active.runId!=='string'||!p.run||p.run.id!==raw.active.runId||p.expedition?.active?.runId!==p.run.id||p.expedition.active.crew!==PET_ID)throw Error('宠物出发快照游标无效');validateSlots(raw.active.slots,owned);if(PET_SLOTS.some(s=>(raw.active as {slots:PetSlots}).slots[s]!== (raw.slots as PetSlots)[s]))throw Error('宠物快照与出发配置不一致');}
}
export function parsePetAction(raw:Record<string,unknown>):PetAction|null{
 if(raw.type==='pet-role'){shape(raw,'type petId role');if(raw.petId!==PET_ID||(raw.role!=='leisure'&&raw.role!=='expedition'))throw Error('宠物身份或职责无效');return raw as PetAction;}
 if(typeof raw.type!=='string'||!['petgear-craft','petgear-equip','petgear-unequip'].includes(raw.type))return null;
 shape(raw,'type id');if(!isPetGearId(raw.id))throw Error('宠物装备身份无效');return raw as PetAction;
}
export function petsReason(p:Profile,a:PetAction):string{
 if(partyBusy(p))return '请先结束组队准备或回营后调整苔团子。';if(p.run||p.leisure.run)return '请回营后调整苔团子职责或装备。';const pet=petsOf(p);
 if(a.type==='pet-role'){if(pet.role===a.role&&p.pets)return '苔团子已经选择这项职责。';if(a.role==='expedition'&&buddyJob(p,PET_ID))return '苔团子正在岗位帮忙，先撤岗再选择挂机职责。';return '';}
 const d=PET_GEAR_CATALOG[a.id];if(a.type==='petgear-craft'){if(pet.ownedGearIDs.includes(a.id))return '已持有这件宠物装备。';if(!petGearUnlocked(p))return '累计首次挂机胜利后解锁宠物装备制作。';if(p.coins<d.coins||p.bag.gel<d.gel||p.leisure.materials.ore<d.ore||p.leisure.materials.herb<d.herb)return '制作材料或金币不足。';}
 else{if(!pet.ownedGearIDs.includes(a.id))return '尚未持有这件宠物装备。';if(a.type==='petgear-equip'&&pet.slots[d.slot]===a.id)return '这件宠物装备已经穿戴。';if(a.type==='petgear-unequip'&&pet.slots[d.slot]!==a.id)return '这件宠物装备尚未穿戴。';}return '';
}
export function applyPets(p:Profile,a:PetAction):void{
 const reason=petsReason(p,a);if(reason)throw Error(reason);const pet=p.pets??=initialPets();
 if(a.type==='pet-role'){pet.role=a.role;p.notice=`苔团子已选择${a.role==='expedition'?'挂机':'休闲'}职责。`;return;}
 const d=PET_GEAR_CATALOG[a.id];if(a.type==='petgear-craft'){p.coins-=d.coins;p.bag.gel-=d.gel;p.leisure.materials.ore-=d.ore;p.leisure.materials.herb-=d.herb;pet.ownedGearIDs.push(a.id);p.notice=`已制作${d.name}，可为苔团子穿戴。`;}
 else{pet.slots[d.slot]=a.type==='petgear-equip'?a.id:null;p.notice=a.type==='petgear-equip'?`苔团子已穿戴${d.name}，下趟同行挂机生效。`:`已卸下${d.name}，宠物装备保留。`;}
}
/** Only enhanced departure with the explicitly selected same pet freezes these IDs. */
export function capturePets(p:Profile):void{const pet=p.pets,e=p.expedition?.active;if(pet&&p.run&&e?.runId===p.run.id&&e.crew===PET_ID&&pet.role==='expedition')pet.active={runId:p.run.id,petId:PET_ID,slots:{...pet.slots}};}
export function clearPets(p:Profile):void{if(p.pets)p.pets.active=null;}
export interface PetEffects {attack:number;defence:number;gather:number}
export function petEffects(slots:PetSlots):PetEffects{return {attack:Number(slots.collar==='moss-collar'),defence:Number(slots.guard==='leaf-guard'),gather:Number(slots.charm==='sun-charm')};}
export const activePetEffects=(p:Profile):PetEffects=>petEffects(p.run&&p.pets?.role==='expedition'&&p.pets.active?.runId===p.run.id&&p.expedition?.active?.runId===p.run.id&&p.expedition.active.crew===PET_ID?p.pets.active.slots:emptyPetSlots());
export function petGearDefinition(id:PetGearId):InventoryDefinition{const d=PET_GEAR_CATALOG[id];return {id:'petgear:'+id,name:d.name,category:'petgear',iconId:'petgear:'+id,source:'petgear',useText:d.effect+'；仅苔团子挂机同行时生效。',sourceText:'苔团子装备 · 营地制作',links:[]};}
export const petOwnedEntries=(p:Profile)=>petsOf(p).ownedGearIDs.map(id=>({...petGearDefinition(id),petGearId:id,slot:PET_GEAR_CATALOG[id].slot,equipped:petsOf(p).slots[PET_GEAR_CATALOG[id].slot]===id,quantity:1}));
export const petRecipeEntries=(p:Profile)=>PET_GEAR_IDS.map(id=>({...petGearDefinition(id),petGearId:id,...PET_GEAR_CATALOG[id],owned:petsOf(p).ownedGearIDs.includes(id),unlocked:petGearUnlocked(p),wins:p.totals.wins,requiredWins:1,reason:petsReason(p,{type:'petgear-craft',id})}));
/** Authoritative same-ID location; callers render at most the requested camp/field actor. */
export function streetPetPresence(p:Profile,view:'camp'|'field'):{petId:typeof PET_ID;role:PetRole;location:'camp'|'field'|'away';visible:boolean}{const carried=!!(p.run&&(p.run.field?.world?.actors[0].loadout.pet||p.expedition?.active?.runId===p.run.id&&p.expedition.active.crew===PET_ID));const location=p.leisure.run?.companion===PET_ID||p.leisure.run?.bonds?.support===PET_ID?'away':carried?'field':'camp';return {petId:PET_ID,role:petsOf(p).role,location,visible:location===view};}
