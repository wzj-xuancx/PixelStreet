import type {InventoryActionKind} from '../../../packages/solo-core/inventory-actions';
/** Presentation only: the public summary supplies this lock; Main still authorizes every action. */
export function inventoryPartyReason(itemId:string,kind:InventoryActionKind,busy:boolean):string {
 if(!busy)return '';
 if(itemId.startsWith('equipment:')&&['craft','equip','unequip'].includes(kind))return '请先结束组队准备或回营后调整装备。';
 if((itemId.startsWith('petgear:')&&['craft','equip','unequip'].includes(kind))||(itemId==='pet:slime'&&kind.startsWith('pet-')))return '请先结束组队准备或回营后调整宠物。';
 return '';
}
