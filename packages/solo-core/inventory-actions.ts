import {isFieldMaterial,fieldMaterialCount,fieldMaterialSaleReason} from './field-progress';
import {PET_GEAR_CATALOG,petsOf,petsReason,isPetGearId,type PetAction} from './pets';
import {buddyJob} from './camp-life';
import {EQUIPMENT_CATALOG,equipmentCraftCosts,equipmentOf,equipmentReason,isEquipmentId,type EquipmentAction} from './equipment';
import type {GameAction,Profile} from './index';
import {inventoryEntries} from './inventory-view';
import {FORMULAS,atelierReason,type Good} from './atelier';
import {businessReason,tradeQuote} from './business';
import {FOODS,leisureReason,type Food} from './leisure';
import {foodPrice} from './camp-world';
export type InventoryActionKind='use'|'sell'|'craft'|'equip'|'unequip'|'pet-leisure'|'pet-expedition';
export interface InventoryActionRequest {itemId:string;kind:InventoryActionKind;count:number}
export interface InventoryCapability {kind:InventoryActionKind;label:string;mode:'single'|'range'|'one-or-all'|'ten';max:number;initial:number}
export interface InventoryQuote extends InventoryActionRequest {name:string;quantity:number;sequence:number;proceeds:number;effect:string;reason:string;binding:string;costs?:Array<{itemId:string;name:string;count:number;available:number}>;comparison?:{removed:string|null;added:string|null}}
/** Existing core commands are the complete authority: no new prices, effects or bulk-use loop. */
export function inventoryCapabilities(p:Profile,itemId:string):InventoryCapability[]{
 if(itemId==='pet:slime')return [{kind:'pet-leisure',label:'休闲职责',mode:'single',max:1,initial:1},{kind:'pet-expedition',label:'挂机职责',mode:'single',max:1,initial:1}];
 if(itemId.startsWith('petgear:')){const id=itemId.slice(8);if(!isPetGearId(id))return [];const pet=petsOf(p),owned=pet.ownedGearIDs.includes(id),equipped=pet.slots[PET_GEAR_CATALOG[id].slot]===id;return [{kind:owned?(equipped?'unequip':'equip'):'craft',label:owned?(equipped?'卸下':'穿戴'):'制作',mode:'single',max:1,initial:1}];}
 if(itemId.startsWith('equipment:')){const id=itemId.slice(10);if(!isEquipmentId(id))return [];const e=equipmentOf(p),owned=e.ownedIDs.includes(id),equipped=e.slots[EQUIPMENT_CATALOG[id].slot]===id;return [{kind:owned?(equipped?'unequip':'equip'):'craft',label:owned?(equipped?'卸下':'穿戴'):'制作',mode:'single',max:1,initial:1}];}
 const item=inventoryEntries(p).find(e=>e.id===itemId);if(!item)return [];
 const key=itemId.split(':')[1];
 if(item.source==='field'&&isFieldMaterial(key))return [{kind:'sell',label:'出售 · 1金币/份',mode:'one-or-all',max:item.quantity,initial:1}];
 if(item.source==='atelier'&&!['ingot','herbal-bandage','mining-tonic'].includes(key))return [{kind:'use',label:'使用',mode:'single',max:1,initial:1}];
 if(item.source==='bag'&&['flour','gel','ration','crystal'].includes(key))return [{kind:'sell',label:'出售',mode:'range',max:Math.min(100,item.quantity),initial:key==='flour'?Math.min(5,item.quantity):1}];
 if(item.source==='materials'&&Object.hasOwn(FOODS,key))return [{kind:'sell',label:'出售',mode:'one-or-all',max:item.quantity,initial:1}];
 if(itemId==='materials:ore')return [{kind:'sell',label:'出售',mode:'ten',max:10,initial:10}];
 return [];
}
export function inventoryAction(p:Profile,r:InventoryActionRequest):{quote:InventoryQuote;action:GameAction}{
 if(r.itemId==='pet:slime'||r.itemId.startsWith('petgear:'))return petInventoryAction(p,r);
 if(r.itemId.startsWith('equipment:'))return equipmentInventoryAction(p,r);
 const item=inventoryEntries(p).find(e=>e.id===r.itemId),cap=inventoryCapabilities(p,r.itemId).find(c=>c.kind===r.kind);
 if(!item||!cap)throw Error('此物品没有这项背包操作。');
 if(!Number.isSafeInteger(r.count)||r.count<1||r.count>cap.max||cap.mode==='single'&&r.count!==1||cap.mode==='ten'&&r.count!==10||cap.mode==='one-or-all'&&r.count!==1&&r.count!==item.quantity)throw Error('请选择现有规则支持的整数数量。');
 const key=r.itemId.split(':')[1];let action:GameAction,proceeds=0,effect='',reason='',binding='';
 if(r.kind==='use'){
  const good=key as Good;action={type:'atelier-use',good};effect=FORMULAS[good].use+'。';reason=atelierReason(p,action);
  if(good==='dew'){const index=p.leisure.plots.findIndex(v=>v&&v.due>p.tick);binding=JSON.stringify([index,p.leisure.plots[index]]);effect='第一块生长中的花圃缩短30秒，最早立即成熟。';}
 }else if(item.source==='field'&&isFieldMaterial(key)){
  action={type:'material-sell',material:key,count:r.count};proceeds=r.count;reason=fieldMaterialSaleReason(p,action);binding=JSON.stringify({coins:p.coins,job:p.job,quantity:fieldMaterialCount(p,key)});
 }else if(item.source==='bag'){
  action={type:'trade',item:key as 'flour'|'gel'|'ration'|'crystal',side:'sell',count:r.count};proceeds=tradeQuote(action.item,'sell',r.count);reason=businessReason(p,action);if(key==='flour'&&!proceeds)reason='面粉至少2份才能结算金币。';
 }else if(key==='ore'){
  action={type:'camp-supplies',trade:'ore'};proceeds=20;reason=leisureReason(p,action);
 }else{
  const food=key as Food;action={type:'camp-sell',food,all:r.count!==1};proceeds=foodPrice(p,FOODS[food].price)*r.count;reason=leisureReason(p,action);
 }
 if(r.kind==='sell')effect=`获得 ${proceeds.toLocaleString('zh-CN')} 金币。`;
 return {action,quote:{...r,name:item.name,quantity:item.quantity,sequence:p.sequence,proceeds,effect,reason,binding}};
}
export function parseInventoryActionRequest(raw:unknown):InventoryActionRequest{
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.getPrototypeOf(raw)!==Object.prototype)throw Error('物品操作无效。');
 const v=raw as Record<string,unknown>;
 if(Object.keys(v).sort().join(' ')!=='count itemId kind'||typeof v.itemId!=='string'||v.itemId.length>64||!['use','sell','craft','equip','unequip','pet-leisure','pet-expedition'].includes(String(v.kind))||typeof v.count!=='number'||!Number.isSafeInteger(v.count)||v.count<1||v.count>1e6)throw Error('物品操作字段或数量无效。');
 return {itemId:v.itemId,kind:v.kind as InventoryActionKind,count:v.count};
}

function equipmentInventoryAction(p:Profile,r:InventoryActionRequest):{quote:InventoryQuote;action:GameAction}{
 const id=r.itemId.slice(10);if(!isEquipmentId(id)||!['craft','equip','unequip'].includes(r.kind)||r.count!==1)throw Error('请选择现有规则支持的整数数量。');
 const action:EquipmentAction={type:('equipment-'+r.kind) as EquipmentAction['type'],id},d=EQUIPMENT_CATALOG[id],e=equipmentOf(p),owned=e.ownedIDs.includes(id),old=e.slots[d.slot];
 const costs=r.kind==='craft'?equipmentCraftCosts(p,id):[];
 const comparison={removed:r.kind!=='craft'&&old?EQUIPMENT_CATALOG[old].effect:null,added:r.kind==='equip'?d.effect:null};
 const effect=r.kind==='craft'?`制作${d.name}：${d.effect}。`:r.kind==='equip'?`${old?'替换'+EQUIPMENT_CATALOG[old].name+'，旧件保留在背包。':''}${d.effect}；下趟挂机生效。`:`卸下${d.name}，装备保留在背包；下趟挂机生效。`;
 // Bind authoritative balances, ownership, loadout and both run locks as well as sequence.
 const binding=JSON.stringify({ownedIDs:e.ownedIDs,slots:e.slots,run:p.run?.id??null,leisure:p.leisure.run,coins:p.coins,gel:p.bag.gel,ore:p.leisure.materials.ore,herb:p.leisure.materials.herb,costs});
 return {action,quote:{...r,name:d.name,quantity:owned?1:0,sequence:p.sequence,proceeds:0,effect,reason:equipmentReason(p,action),binding,costs,comparison}};
}

function petInventoryAction(p:Profile,r:InventoryActionRequest):{quote:InventoryQuote;action:GameAction}{
 const pet=petsOf(p);let action:PetAction,name:string,quantity:number,effect:string,costs:NonNullable<InventoryQuote['costs']>=[],comparison:InventoryQuote['comparison'];
 if(r.count!==1)throw Error('宠物操作每次仅支持1项。');
 if(r.itemId==='pet:slime'){
  if(r.kind!=='pet-leisure'&&r.kind!=='pet-expedition')throw Error('宠物职责操作无效。');
  const role=r.kind==='pet-expedition'?'expedition':'leisure';action={type:'pet-role',petId:'slime',role};name='苔团子';quantity=1;effect=role==='expedition'?'同一只苔团子切换挂机职责；回营待命，出发时需手动选择同行。':'同一只苔团子切换休闲职责，继续原有成长与营地生活。';
 }else{
  const id=r.itemId.slice(8);if(!isPetGearId(id)||!['craft','equip','unequip'].includes(r.kind))throw Error('宠物装备操作无效。');
  action={type:('petgear-'+r.kind) as 'petgear-craft'|'petgear-equip'|'petgear-unequip',id};const d=PET_GEAR_CATALOG[id],old=pet.slots[d.slot];name=d.name;quantity=pet.ownedGearIDs.includes(id)?1:0;
  if(r.kind==='craft')costs=[{itemId:'coins',name:'金币',count:d.coins,available:p.coins},{itemId:'bag:gel',name:'凝胶',count:d.gel,available:p.bag.gel},{itemId:'materials:ore',name:'月纹石',count:d.ore,available:p.leisure.materials.ore},{itemId:'materials:herb',name:'晨露草',count:d.herb,available:p.leisure.materials.herb}].filter(c=>c.count>0);
  comparison={removed:r.kind!=='craft'&&old?PET_GEAR_CATALOG[old].effect:null,added:r.kind==='equip'?d.effect:null};
  effect=r.kind==='craft'?`制作${d.name}：${d.effect}。`:r.kind==='equip'?`${d.effect}；仅苔团子下趟挂机同行生效。`:`卸下${d.name}，宠物装备保留。`;
 }
 const binding=JSON.stringify({pets:p.pets??null,run:p.run?.id??null,leisure:p.leisure.run,job:buddyJob(p,'slime'),xp:p.leisure.companions.slime,wins:p.totals.wins,coins:p.coins,gel:p.bag.gel,ore:p.leisure.materials.ore,herb:p.leisure.materials.herb});
 return {action,quote:{...r,name,quantity,sequence:p.sequence,proceeds:0,effect,reason:petsReason(p,action),binding,costs,comparison}};
}
