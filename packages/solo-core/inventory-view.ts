import {petOwnedEntries} from './pets';
import {equipmentOwnedEntries} from './equipment';
import type {Profile} from './index';
import {INVENTORY_CATALOG,type InventoryDefinition} from '../content/inventory-catalog';
export type {InventoryCategory,InventorySource} from '../content/inventory-catalog';
export interface InventoryEntry extends InventoryDefinition {quantity:number}
/** Read only: no extension installation, queue settlement, cargo or shelf projection. */
export function inventoryEntries(profile:Profile):InventoryEntry[]{
 const entries:InventoryEntry[]=[];
 for(const definition of INVENTORY_CATALOG){
  const key=definition.id.split(':')[1];
  const stock=definition.source==='field'?profile.fieldProgress?.materials:definition.source==='bag'?profile.bag:definition.source==='materials'?profile.leisure.materials:definition.source==='journal'?profile.leisure.journal:profile.atelier?.stock;
  const quantity=stock?.[key as keyof typeof stock];
  if(typeof quantity==='number'&&Number.isSafeInteger(quantity)&&quantity>0)entries.push({...definition,quantity});
 }
 return [...entries,...equipmentOwnedEntries(profile).filter(e=>!e.equipped),...petOwnedEntries(profile).filter(e=>!e.equipped)];
}
