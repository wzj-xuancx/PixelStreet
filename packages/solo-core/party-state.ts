import type { Profile, GameState, PrivateGameState } from './index';
import type { PartySummary } from './party-ledger';
export const partyBusy = (p: Profile): boolean => !!p.party?.sessions.some(s => s.status === 'active');
/** All still refundable inventory, including provisional consumes until an authenticated close resolves them. */
export const partyRationReserve = (p: Profile): number => p.party?.sessions.reduce((n, s) => n + (s.status === 'closed' ? 0 : s.budget - s.refunded), 0) ?? 0;
export const partySupplyReserve = (p: Profile, g: string): number => p.party?.sessions.reduce((n, s) => n + Number(s.status !== 'closed' && s.supplyId === g && !s.supplyRefunded), 0) ?? 0;
export function partySummary(p: Profile): PartySummary { return { busy: partyBusy(p), reserved: partyRationReserve(p), unresolved: p.party?.sessions.filter(s => s.status === 'resolving').length ?? 0, pending: structuredClone(p.party?.pending.map(x => ({ id: x.id, reward: x.reward })) ?? []) }; }
export function publicGameState(s: GameState | PrivateGameState): GameState { if (!s.profile)
    return { ...s }; const profile = structuredClone(s.profile) as Profile; delete profile.party; return { ...s, profile, party: (s.profile as Profile).party ? partySummary(s.profile) : s.party ?? partySummary(s.profile) }; }
