import type {InventoryQuote} from '../../../packages/solo-core/inventory-actions';
import {EQUIPMENT_CATALOG,EQUIPMENT_SLOTS,type EquipmentEffects,type EquipmentSlots} from '../../../packages/solo-core/equipment';
import {inventoryArt} from './inventory-art';
import {icon} from './icons';
export function equipmentCosts(costs:NonNullable<InventoryQuote['costs']>):string {
 return costs.map(c=>`<span class="equipment-cost${c.available<c.count?' is-missing':''}" aria-label="${c.name}，需要${c.count}，现有${c.available}">${c.itemId==='coins'?icon('gold'):inventoryArt(c.itemId)}<span>${c.name} ×${c.count}<span class="equipment-available">现有 ${c.available}</span></span></span>`).join('');
}
export function inventoryActionLabel(quote:InventoryQuote):string {
 return quote.kind==='equip'&&quote.comparison?.removed?'替换':({use:'使用',sell:'出售',craft:'制作',equip:'穿戴',unequip:'卸下','pet-leisure':'休闲职责','pet-expedition':'挂机职责'} as const)[quote.kind];
}
export function equipmentEffectText(e:EquipmentEffects):string {
 return [e.attack?`普攻+${e.attack}`:'',e.defence?`减伤+${e.defence}`:'',e.heal?`整备恢复+${e.heal}`:'',e.spell?`技能伤害+${e.spell}`:'',e.gather?`远征采集材料+${e.gather}`:'',e.travelPercent<100?`行走与行程−${100-e.travelPercent}%`:''].filter(Boolean).join(' · ')||'无装备加成';
}
export function equipmentMiniMarkup(slots:EquipmentSlots):string {
 const ids=EQUIPMENT_SLOTS.map(s=>slots[s]).filter(id=>id!==null);
 return ids.map(id=>`<span class="equipment-mini" aria-label="${EQUIPMENT_CATALOG[id].name}">${inventoryArt('equipment:'+id)}<span>${EQUIPMENT_CATALOG[id].name}</span></span>`).join('')||'<span>未穿戴装备</span>';
}
