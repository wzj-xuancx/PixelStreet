import type {Profile} from './index';
import {INVENTORY_CATALOG,type InventoryDefinition} from '../content/inventory-catalog';
import {EQUIPMENT_IDS,equipmentDefinition,equipmentOwnedEntries} from './equipment';
import {PET_GEAR_IDS,petGearDefinition,petOwnedEntries} from './pets';
/** Only these local definitions may supply card text/art; never wire metadata. */
export const ITEM_CARD_CATALOG:readonly InventoryDefinition[]=Object.freeze([
 ...INVENTORY_CATALOG,...EQUIPMENT_IDS.map(equipmentDefinition),...PET_GEAR_IDS.map(petGearDefinition),
]);
const definitions=new Map(ITEM_CARD_CATALOG.map(item=>[item.id,item]));
export function itemCardDefinition(id:unknown):InventoryDefinition|undefined{return typeof id==='string'?definitions.get(id):undefined;}
export function validItemCardQuantity(id:unknown,quantity:unknown):quantity is number{
 const item=itemCardDefinition(id);
 return !!item&&typeof quantity==='number'&&Number.isSafeInteger(quantity)&&quantity>=1&&quantity<=(item.source==='field'?9999:1e6)&&(!['equipment','petgear'].includes(item.category)||quantity===1);
}
/** Read only, including equipped pieces. Does not install optional extensions. */
export function ownedItemCard(p:Profile,id:unknown):(InventoryDefinition&{quantity:number})|undefined{
 const item=itemCardDefinition(id);if(!item)return;
 let quantity:unknown;
 if(item.source==='equipment')quantity=equipmentOwnedEntries(p).find(entry=>entry.id===item.id)?.quantity;
 else if(item.source==='petgear')quantity=petOwnedEntries(p).find(entry=>entry.id===item.id)?.quantity;
 else{
  const key=item.id.split(':')[1],stock=item.source==='field'?p.fieldProgress?.materials:item.source==='bag'?p.bag:item.source==='materials'?p.leisure.materials:item.source==='journal'?p.leisure.journal:p.atelier?.stock;
  quantity=stock?.[key as keyof typeof stock];
 }
 return validItemCardQuantity(id,quantity)?{...item,quantity}:undefined;
}
