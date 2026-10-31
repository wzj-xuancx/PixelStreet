import {partyBusy} from './party-state';
import {fieldMaterialCount,changeFieldMaterial,type FieldMaterial} from './field-progress';
import type {Profile} from './index';
import type {InventoryDefinition} from '../content/inventory-catalog';
export const EQUIPMENT_SLOTS=['head','body','hands','mainhand','accessory','feet'] as const;
export type EquipmentSlot=typeof EQUIPMENT_SLOTS[number];
export const EQUIPMENT_SLOT_NAMES:Record<EquipmentSlot,string>={head:'头部',body:'身体',hands:'手部',mainhand:'主手',accessory:'饰品',feet:'足部'};
export const EQUIPMENT_CATALOG={
 'trail-hood':{name:'青蓝风帽',slot:'head',effect:'每场整备恢复+2',coins:6,gel:0,ore:0,herb:2},
 'trail-coat':{name:'旅途外套',slot:'body',effect:'底部冒险减伤+1',coins:8,gel:2,ore:0,herb:0},
 'trail-gloves':{name:'旅行手套',slot:'hands',effect:'底部冒险普攻+1',coins:6,gel:2,ore:0,herb:0},
 'trail-boots':{name:'行路短靴',slot:'feet',effect:'行走与远征行程耗时−5%',coins:6,gel:0,ore:2,herb:0},
 'trail-sword':{name:'行路短剑',slot:'mainhand',effect:'底部冒险普攻+1',coins:10,gel:3,ore:3,herb:0},
 'blue-pendant':{name:'蓝石坠饰',slot:'accessory',effect:'底部冒险技能伤害+2',coins:8,gel:2,ore:1,herb:0},
 'leaf-brooch':{name:'叶纹胸针',slot:'accessory',effect:'远征每场采集材料+1',coins:8,gel:0,ore:1,herb:2},
 'breaker-hammer':{name:'破甲锤',slot:'mainhand',effect:'重击积累破甲，后续命中受益',coins:6,gel:2,ore:2,herb:0,field:{bone:2}},
 'resonant-staff':{name:'鸣晶杖',slot:'mainhand',effect:'直线晶弹，累计命中打断蓄力',coins:6,gel:2,ore:2,herb:0,field:{curseCrystal:2}},
 'rock-gloves':{name:'岩纹手套',slot:'hands',effect:'普攻+1；破甲目标触发裂甲冲击',coins:6,gel:0,ore:1,herb:0,field:{bone:2}},
 'echo-mirror':{name:'回声镜',slot:'accessory',effect:'普攻+1；成功打断后范围脉冲',coins:6,gel:0,ore:1,herb:0,field:{curseCrystal:2}},
 'moss-mantle':{name:'苔纹披肩',slot:'body',effect:'清完一组恢复生命并帮助附近队友',coins:6,gel:1,ore:0,herb:2,field:{toughHide:2}},
 'graft-charm':{name:'接枝护符',slot:'accessory',effect:'清组恢复2；溢出治疗转为短时护盾',coins:6,gel:0,ore:0,herb:2,field:{toughHide:2}},
} as const;
export type EquipmentId=keyof typeof EQUIPMENT_CATALOG;
export const EQUIPMENT_IDS=Object.keys(EQUIPMENT_CATALOG) as EquipmentId[];
export type EquipmentSlots=Record<EquipmentSlot,EquipmentId|null>;
export interface Equipment {version:1;ownedIDs:EquipmentId[];slots:EquipmentSlots;active:{runId:string;slots:EquipmentSlots}|null}
export type EquipmentAction={type:'equipment-craft'|'equipment-equip'|'equipment-unequip';id:EquipmentId};
export const emptyEquipmentSlots=():EquipmentSlots=>({head:null,body:null,hands:null,mainhand:null,accessory:null,feet:null});
export const initialEquipment=():Equipment=>({version:1,ownedIDs:[],slots:emptyEquipmentSlots(),active:null});
/** Read only fallback: never installs the optional extension. */
export const equipmentOf=(p:Profile):Equipment=>p.equipment??initialEquipment();
export const isEquipmentId=(v:unknown):v is EquipmentId=>typeof v==='string'&&Object.hasOwn(EQUIPMENT_CATALOG,v);
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
function shape(v:unknown,keys:string):asserts v is Record<string,unknown>{if(!object(v)||Object.keys(v).sort().join(' ')!==keys.split(' ').sort().join(' '))throw Error('底部冒险装备字段不匹配');}
function validateSlots(v:unknown,owned:EquipmentId[]):asserts v is EquipmentSlots{shape(v,EQUIPMENT_SLOTS.join(' '));for(const slot of EQUIPMENT_SLOTS){const id=v[slot];if(id!==null&&(!isEquipmentId(id)||EQUIPMENT_CATALOG[id].slot!==slot||!owned.includes(id)))throw Error('底部冒险装备槽位或所有权无效');}}
export function validateEquipment(raw:unknown,p:Profile):asserts raw is Equipment{
 shape(raw,'version ownedIDs slots active');if(raw.version!==1||!Array.isArray(raw.ownedIDs)||raw.ownedIDs.length>EQUIPMENT_IDS.length||Array.from(raw.ownedIDs).some(id=>!isEquipmentId(id))||new Set(raw.ownedIDs).size!==raw.ownedIDs.length)throw Error('底部冒险装备拥有集无效');
 const owned=raw.ownedIDs as EquipmentId[];validateSlots(raw.slots,owned);
 if(raw.active!==null){shape(raw.active,'runId slots');if(typeof raw.active.runId!=='string'||p.run?.id!==raw.active.runId)throw Error('底部冒险装备快照游标无效');validateSlots(raw.active.slots,owned);if(EQUIPMENT_SLOTS.some(slot=>(raw.active as {slots:EquipmentSlots}).slots[slot]!== (raw.slots as EquipmentSlots)[slot]))throw Error('底部冒险装备快照与出发配置不一致');}
}
export function parseEquipmentAction(raw:Record<string,unknown>):EquipmentAction|null{
 if(typeof raw.type!=='string'||!['equipment-craft','equipment-equip','equipment-unequip'].includes(raw.type))return null;
 shape(raw,'type id');if(!isEquipmentId(raw.id))throw Error('底部冒险装备身份无效');return raw as EquipmentAction;
}
export interface EquipmentCost {itemId:string;name:string;count:number;available:number}
export function equipmentCraftCosts(p:Profile,id:EquipmentId):EquipmentCost[]{const d=EQUIPMENT_CATALOG[id];return [
 {itemId:'coins',name:'金币',count:d.coins,available:p.coins},{itemId:'bag:gel',name:'凝胶',count:d.gel,available:p.bag.gel},
 {itemId:'materials:ore',name:'月纹石',count:d.ore,available:p.leisure.materials.ore},{itemId:'materials:herb',name:'晨露草',count:d.herb,available:p.leisure.materials.herb},
 ...Object.entries('field'in d?d.field:{}).map(([key,count])=>({itemId:'field:'+key,name:({bone:'硬骨片',curseCrystal:'咒晶碎片',toughHide:'韧皮'} as const)[key as FieldMaterial],count:count as number,available:fieldMaterialCount(p,key as FieldMaterial)}))
 ].filter(c=>c.count>0);}
function payEquipmentCost(p:Profile,c:EquipmentCost):void{const [source,key]=c.itemId.split(':');if(source==='coins')p.coins-=c.count;else if(source==='field')changeFieldMaterial(p,key as FieldMaterial,-c.count);else if(source==='bag')p.bag.gel-=c.count;else p.leisure.materials[key as 'ore'|'herb']-=c.count;}
export function equipmentReason(p:Profile,a:EquipmentAction):string{
 if(partyBusy(p))return '请先结束组队准备或回营后调整装备。';if(p.run||p.leisure.run)return '请回营后调整底部冒险装备。';const e=equipmentOf(p),d=EQUIPMENT_CATALOG[a.id];
 if(a.type==='equipment-craft'){if(e.ownedIDs.includes(a.id))return '已持有这件底部冒险装备。';if(equipmentCraftCosts(p,a.id).some(c=>c.available<c.count))return '制作材料或金币不足。';}
 else{if(!e.ownedIDs.includes(a.id))return '尚未持有这件底部冒险装备。';if(a.type==='equipment-equip'&&e.slots[d.slot]===a.id)return '这件底部冒险装备已经穿戴。';if(a.type==='equipment-unequip'&&e.slots[d.slot]!==a.id)return '这件底部冒险装备尚未穿戴。';}return '';
}
export function applyEquipment(p:Profile,a:EquipmentAction):void{
 const reason=equipmentReason(p,a);if(reason)throw Error(reason);const e=p.equipment??=initialEquipment(),d=EQUIPMENT_CATALOG[a.id];
 if(a.type==='equipment-craft'){for(const cost of equipmentCraftCosts(p,a.id))payEquipmentCost(p,cost);e.ownedIDs.push(a.id);p.notice=`已制作${d.name}，可在回营时穿戴。`;}
 else{e.slots[d.slot]=a.type==='equipment-equip'?a.id:null;p.notice=a.type==='equipment-equip'?`已穿戴${d.name}，下趟底部冒险生效。`:`已卸下${d.name}，装备保留在背包。`;}
}
export function captureEquipment(p:Profile):void{if(p.equipment&&p.run)p.equipment.active={runId:p.run.id,slots:{...p.equipment.slots}};}
export function clearEquipment(p:Profile):void{if(p.equipment)p.equipment.active=null;}
export interface EquipmentEffects {attack:number;defence:number;heal:number;spell:number;gather:number;travelPercent:number}
export function equipmentEffects(slots:EquipmentSlots):EquipmentEffects{
 const has=(id:EquipmentId)=>slots[EQUIPMENT_CATALOG[id].slot]===id;
 return {attack:Number(has('trail-gloves'))+Number(has('trail-sword')),defence:Number(has('trail-coat')),heal:has('trail-hood')?2:0,spell:has('blue-pendant')?2:0,gather:Number(has('leaf-brooch')),travelPercent:has('trail-boots')?95:100};
}
export const activeEquipmentEffects=(p:Profile):EquipmentEffects=>equipmentEffects(p.equipment?.active?.runId===p.run?.id&&p.run?p.equipment!.active!.slots:emptyEquipmentSlots());
export const equipmentTravel=(p:Profile,ticks:number):number=>Math.max(1,Math.round(ticks*activeEquipmentEffects(p).travelPercent/100));
export function equipmentDefinition(id:EquipmentId):InventoryDefinition{const d=EQUIPMENT_CATALOG[id];return {id:'equipment:'+id,name:d.name,category:'equipment',iconId:'equipment:'+id,source:'equipment',useText:d.effect+'；出发时冻结，影响底部冒险，独立俯视地牢不受影响。',sourceText:'底部冒险装备 · 营地制作',links:[]};}
/** Paperdoll/details read all owned pieces; bag projection filters equipped pieces separately. */
export const equipmentOwnedEntries=(p:Profile)=>equipmentOf(p).ownedIDs.map(id=>({...equipmentDefinition(id),equipmentId:id,slot:EQUIPMENT_CATALOG[id].slot,equipped:equipmentOf(p).slots[EQUIPMENT_CATALOG[id].slot]===id,quantity:1}));
/** Recipes are independent of the owned inventory projection, including all uncrafted pieces. */
export const equipmentRecipeEntries=(p:Profile)=>EQUIPMENT_IDS.map(id=>({...equipmentDefinition(id),equipmentId:id,...EQUIPMENT_CATALOG[id],owned:equipmentOf(p).ownedIDs.includes(id),reason:equipmentReason(p,{type:'equipment-craft',id})}));
