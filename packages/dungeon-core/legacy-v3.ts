import type {DungeonRun,MechanismId,UpgradeId} from './types';
/** Frozen migration vocabulary. Future production expansion must not widen old save validation. */
export const LEGACY_WEAPONS=['sword','fire','frost','lightning','boomerang'] as const;
export const LEGACY_ENEMIES=['chaser','shooter','charger','boss'] as const;
export const LEGACY_MECHANISMS=['cinder-burst','scorch-field','deep-freeze','shatter','twin-blades','ricochet'] as const;
export const LEGACY_UPGRADES=[...LEGACY_MECHANISMS,'power','haste','vitality'] as const;
export const LEGACY_XP=[18,36,54,72,108] as const;
const compatibility={fire:['cinder-burst','scorch-field'],frost:['deep-freeze','shatter'],boomerang:['twin-blades','ricochet']} as const;
/** This only validates a historical pending choice transaction; never used for new gameplay. */
export function legacyEligibleUpgrades(run:DungeonRun):UpgradeId[] {
 const kind=run.player.weaponSlots[run.player.activeSlot]?.kind;
 const ids=kind&&Object.hasOwn(compatibility,kind)?compatibility[kind as keyof typeof compatibility]:[];
 const mechanism=ids.find(id=>!run.player.traits.includes(id as MechanismId));return[mechanism??'haste','power','vitality'];
}
