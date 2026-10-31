import { partyBusy, partyRationReserve, partySummary } from './party-state';
import { parsePersonalPartyRequest, validatePartyReward } from '../protocol/party-field';
export { parsePersonalPartyRequest, validatePartyReward } from '../protocol/party-field';
import { parseProfile, type Profile, type GameState } from './index';
import { equipmentEffects, equipmentOf } from './equipment';
import { petsOf, petEffects } from './pets';
import { initialAtelier, reagentSpace, refundReserve } from './atelier';
import { changeFieldMaterial, ensureFieldProgress } from './field-progress';
import { createFieldWorld, type ActorLoadout, type FieldSupply, type RewardPackage } from '../field-world';
export const PARTY_LIMIT = 64;
/** Private installation state. Never serialize this extension into Renderer/room state. */
export interface PersonalPartySession {
    sessionId: string;
    prepareId: string;
    capability: string;
    budget: 3 | 6 | 9;
    supplyId: FieldSupply | null;
    loadout: ActorLoadout;
    status: 'active' | 'resolving' | 'closed';
    retired: boolean;
    refunded: number;
    supplyRefunded: boolean;
    supplyEvent: string | null;
    consumes: Array<{
        eventId: string;
        kind: 'encounter' | 'mining';
    }>;
    rewardReceipts: Array<{
        eventId: string;
        fingerprint: string;
    }>;
    close: {
        id: string;
        fingerprint: string;
        consumeHighwater: number | null;
        rewardHighwater: number | null;
        supplyActivated: boolean | null;
    } | null;
}
export interface PartyLedger {
    version: 1;
    sealed: Array<{
        hostId: string;
        sequence: number;
    }>;
    sessions: PersonalPartySession[];
    pending: Array<{
        id: string;
        sessionId: string;
        reward: RewardPackage;
    }>;
    claimed: string[];
}
export interface PartySummary {
    busy: boolean;
    reserved: number;
    unresolved: number;
    pending: Array<{
        id: string;
        reward: RewardPackage;
    }>;
}
export type PersonalPartyRequest = {
    type: 'party-completed';
    hostId: string;
    sequence: number;
} | {
    type: 'party-prepare';
    sessionId: string;
    prepareId: string;
    budget: 3 | 6 | 9;
    supplyId: FieldSupply | null;
} | {
    type: 'party-consume';
    sessionId: string;
    eventId: string;
    consumeSeq: number;
    kind: 'encounter' | 'mining';
    amount: 1;
} | {
    type: 'party-supply';
    sessionId: string;
    eventId: string;
    supplyId: FieldSupply;
} | {
    type: 'party-reward';
    sessionId: string;
    eventId: string;
    rewardSeq: number;
    package: RewardPackage;
} | {
    type: 'party-close';
    sessionId: string;
    closeId: string;
    reason: string;
    consumeHighwater?: number;
    rewardHighwater?: number;
    supplyActivated?: boolean;
} | {
    type: 'party-claim';
    packageId: string;
};
export interface PersonalPartyReply {
    session?: PersonalPartySession;
    summary: PartySummary;
}
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
function shape(v: unknown, keys: string): asserts v is Record<string, any> { if (!object(v) || Object.keys(v).sort().join(' ') !== keys.split(' ').sort().join(' '))
    throw Error('组队字段无效'); }
function num(v: unknown, max = 1e12, min = 0): asserts v is number { if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min || v > max)
    throw Error('组队数值无效'); }
function id(v: unknown): asserts v is string { if (typeof v !== 'string' || !/^[-a-zA-Z0-9_:]{1,128}$/.test(v))
    throw Error('组队身份无效'); }
function sessionKey(v: unknown): {
    hostId: string;
    sequence: number;
} { if (typeof v !== 'string')
    throw Error('组队场次无效'); const m = /^([0-9a-f]{32}):([1-9][0-9]{0,11})$/.exec(v); if (!m)
    throw Error('组队场次无效'); num(Number(m[2]), 1e12, 1); return { hostId: m[1], sequence: Number(m[2]) }; }
export { partyBusy, partyRationReserve, partySupplyReserve, partySummary, publicGameState } from './party-state';
function freezeLoadout(p: Profile, budget: number, supply: FieldSupply | null): ActorLoadout { const slots = equipmentOf(p).slots, effects = equipmentEffects(slots), pet = petsOf(p), petStats = pet.role === 'expedition' ? petEffects(pet.slots) : null; return { gear: Object.values(slots).filter((v): v is NonNullable<typeof v> => v !== null), attack: (p.upgraded ? 9 : 6) + effects.attack, defence: effects.defence, maxHP: p.upgraded ? 80 : 70, heal: effects.heal, spell: effects.spell, gather: effects.gather, travelPercent: effects.travelPercent, pet: petStats, supply, budget }; }
function canFit(p: Profile, r: RewardPackage): boolean { return p.coins <= 1e9 - r.coins && p.xp <= 1e12 - r.xp && (['gel', 'ore'] as const).every(k => reagentSpace(p, k) >= r[k] + refundReserve(p, k)) && Object.entries(r.materials).every(([k, n]) => reagentSpace(p, k as 'bone') >= n! + refundReserve(p, k as 'bone')); }
function deposit(p: Profile, r: RewardPackage): void { p.coins += r.coins; p.xp += r.xp; p.bag.gel += r.gel; p.leisure.materials.ore += r.ore; for (const [k, n] of Object.entries(r.materials))
    changeFieldMaterial(p, k as 'bone', n!); }
export function personalParty(source: Profile, input: PersonalPartyRequest, capability?: string): {
    profile: Profile;
    reply: PersonalPartyReply;
} {
    const q = parsePersonalPartyRequest(input), p = parseProfile(source), ledger = p.party ??= { version: 1, sealed: [], sessions: [], pending: [], claimed: [] };
    let s = 'sessionId' in q ? ledger.sessions.find(s => s.sessionId === q.sessionId) : undefined;
    if (q.type === 'party-completed') {
        let cursor = ledger.sealed.find(x => x.hostId === q.hostId);
        if (!cursor) {
            if (ledger.sealed.length >= PARTY_LIMIT)
                throw Error('组队结算来源记录已满');
            cursor = { hostId: q.hostId, sequence: q.sequence };
            ledger.sealed.push(cursor);
        }
        else
            cursor.sequence = Math.max(cursor.sequence, q.sequence);
        for (const old of ledger.sessions)
            if (old.sessionId.startsWith(q.hostId + ':') && sessionKey(old.sessionId).sequence <= q.sequence && old.status === 'closed' && old.rewardReceipts.length === old.close!.rewardHighwater)
                old.retired = true;
    }
    else if (q.type === 'party-prepare') {
        if (s) {
            if (s.status !== 'active')
                throw Error('组队场次已关闭');
            if (s.prepareId !== q.prepareId || s.budget !== q.budget || s.supplyId !== q.supplyId)
                throw Error('组队预留参数冲突');
        }
        else {
            const key = sessionKey(q.sessionId);
            if ((ledger.sealed.find(x => x.hostId === key.hostId)?.sequence ?? 0) >= key.sequence)
                throw Error('组队场次已封存关闭');
            if (partyBusy(p) || p.run || p.leisure.run)
                throw Error('请先结束当前组队或冒险');
            if (p.job !== 'keeper' || p.bag.ration < q.budget)
                throw Error('组队口粮不足，请先任职并制作口粮');
            if (ledger.pending.length >= PARTY_LIMIT)
                throw Error('组队待领取已满，请先领取');
            // A closed, fully delivered session can be compacted into its host highwater. Pending packages are independent.
            ledger.sessions = ledger.sessions.filter(old => !old.retired);
            if (ledger.sessions.length >= PARTY_LIMIT || !ledger.sealed.some(x => x.hostId === key.hostId) && ledger.sealed.length >= PARTY_LIMIT)
                throw Error('组队恢复记录已满，请先完成待结算');
            if (typeof capability !== 'string' || !/^[0-9a-f]{64}$/.test(capability))
                throw Error('组队恢复凭据无效');
            if (q.supplyId && !(p.atelier?.stock[q.supplyId]))
                throw Error('没有这件随行补给');
            s = { sessionId: q.sessionId, prepareId: q.prepareId, capability, budget: q.budget, supplyId: q.supplyId, loadout: freezeLoadout(p, q.budget, q.supplyId), status: 'active', retired: false, refunded: 0, supplyRefunded: false, supplyEvent: null, consumes: [], rewardReceipts: [], close: null };
            ledger.sessions.push(s);
            p.bag.ration -= q.budget;
            if (q.supplyId)
                p.atelier!.stock[q.supplyId]--;
            p.notice = '组队准备完成，口粮与装备已预留。';
        }
    }
    else if (q.type === 'party-claim') {
        const n = ledger.pending.findIndex(x => x.id === q.packageId);
        if (n < 0) {
            if (!ledger.claimed.includes(q.packageId))
                throw Error('未知待领取包');
        }
        else {
            const r = ledger.pending[n];
            if (!canFit(p, r.reward))
                throw Error('背包空间不足，奖励继续保留');
            deposit(p, r.reward);
            ledger.pending.splice(n, 1);
            ledger.claimed = [...ledger.claimed, q.packageId].slice(-PARTY_LIMIT);
            p.notice = '组队战利品已收入背包。';
        }
    }
    else {
        if (!s)
            throw Error('未知或封存组队场次');
        if (q.type === 'party-consume') {
            if (s.status !== 'active')
                throw Error('组队场次已关闭');
            const prev = s.consumes[q.consumeSeq - 1];
            if (prev) {
                if (prev.eventId !== q.eventId || prev.kind !== q.kind)
                    throw Error('组队消费参数冲突');
            }
            else {
                if (q.consumeSeq !== s.consumes.length + 1)
                    throw Error('组队消费序列缺口');
                if (s.consumes.length >= s.budget)
                    throw Error('组队口粮已耗尽');
                if (ledger.pending.length >= PARTY_LIMIT)
                    throw Error('组队待领取已满');
                s.consumes.push({ eventId: q.eventId, kind: q.kind });
            }
        }
        else if (q.type === 'party-supply') {
            if (s.status !== 'active')
                throw Error('组队场次已关闭');
            if (s.supplyId !== q.supplyId || s.supplyEvent && s.supplyEvent !== q.eventId)
                throw Error('组队随行物参数冲突');
            s.supplyEvent = q.eventId;
        }
        else if (q.type === 'party-reward') {
            const fp = JSON.stringify(q.package), prev = s.rewardReceipts[q.rewardSeq - 1];
            if (prev) {
                if (prev.eventId !== q.eventId || prev.fingerprint !== fp)
                    throw Error('组队奖励参数冲突');
            }
            else {
                if (q.rewardSeq !== s.rewardReceipts.length + 1)
                    throw Error('组队奖励序列缺口');
                if (s.status === 'closed' && (s.close!.rewardHighwater === null || q.rewardSeq > s.close!.rewardHighwater))
                    throw Error('组队已关闭，奖励未登记');
                if(q.rewardSeq>s.consumes.length)throw Error('组队奖励缺少对应持久消费');
                if (q.rewardSeq > s.budget)
                    throw Error('组队奖励超过本趟预算');
                if (ledger.pending.length >= PARTY_LIMIT)
                    throw Error('组队待领取已满');
                if (canFit(p, q.package))
                    deposit(p, q.package);
                else
                    ledger.pending.push({ id: q.eventId, sessionId: q.sessionId, reward: structuredClone(q.package) });
                s.rewardReceipts.push({ eventId: q.eventId, fingerprint: fp });
                if (q.package.guardian) {
                    const c = ensureFieldProgress(p).challenge;
                    c.guardianClears = Math.min(1e9, c.guardianClears + 1);
                }
                if (q.package.coins) {
                    p.totals.wins = Math.min(1e12, p.totals.wins + 1);
                    p.totals.earned = Math.min(1e12, p.totals.earned + q.package.coins);
                }
                p.notice = ledger.pending.some(x => x.id === q.eventId) ? '战利品已保存待领取，回营后腾出空间。' : '组队战利品已收入背包。';
            }
        }
        else if (q.type === 'party-close') {
            const complete = q.consumeHighwater !== undefined, fp = JSON.stringify({ consumeHighwater: q.consumeHighwater ?? null, rewardHighwater: q.rewardHighwater ?? null, supplyActivated: q.supplyActivated ?? null });
            if (s.status === 'closed') {
                if (s.close!.fingerprint !== fp)
                    throw Error('组队关闭参数冲突');
            }
            else {
                if (complete && (q.consumeHighwater! > s.consumes.length || q.rewardHighwater! > q.consumeHighwater! || q.rewardHighwater! > s.budget || q.rewardHighwater! < s.rewardReceipts.length || q.supplyActivated && !s.supplyEvent))
                    throw Error('组队关闭高水位冲突');
                const used = complete ? q.consumeHighwater! : s.consumes.length, refund = s.budget - used - s.refunded;
                if (refund < 0)
                    throw Error('组队退款冲突');
                p.bag.ration += refund;
                s.refunded += refund;
                const returnSupply = s.supplyId && !s.supplyRefunded && (complete ? !q.supplyActivated : !s.supplyEvent);
                if (returnSupply) {
                    (p.atelier ??= initialAtelier()).stock[s.supplyId!]++;
                    s.supplyRefunded = true;
                }
                s.status = complete ? 'closed' : 'resolving';
                s.close = { id: q.closeId, fingerprint: fp, consumeHighwater: q.consumeHighwater ?? null, rewardHighwater: q.rewardHighwater ?? null, supplyActivated: q.supplyActivated ?? null };
                p.notice = complete ? '组队已回营，未用口粮与补给已退还。' : '已回营，未用口粮已退还；连接恢复后核对待结算费用。';
            }
        }
    }
    return { profile: parseProfile(p), reply: { ...(s ? { session: structuredClone(s) } : {}), summary: partySummary(p) } };
}
export function validatePartyLedger(v: unknown, p: Profile): asserts v is PartyLedger {
    shape(v, 'version sealed sessions pending claimed');
    if (v.version !== 1 || !Array.isArray(v.sealed) || v.sealed.length > PARTY_LIMIT || !Array.isArray(v.sessions) || v.sessions.length > PARTY_LIMIT || !Array.isArray(v.pending) || v.pending.length > PARTY_LIMIT || !Array.isArray(v.claimed) || v.claimed.length > PARTY_LIMIT)
        throw Error('组队账本数量无效');
    const hosts = new Set<string>();
    for (const c of v.sealed) {
        shape(c, 'hostId sequence');
        sessionKey(c.hostId + ':' + c.sequence);
        if (hosts.has(c.hostId))
            throw Error('组队封存重复');
        hosts.add(c.hostId);
    }
    const sessions = new Set<string>();
    let active = 0;
    for (const s of v.sessions) {
        shape(s, 'sessionId prepareId capability budget supplyId loadout status retired refunded supplyRefunded supplyEvent consumes rewardReceipts close');
        sessionKey(s.sessionId);
        id(s.prepareId);
        if (sessions.has(s.sessionId) || typeof s.capability !== 'string' || !/^[0-9a-f]{64}$/.test(s.capability) || ![3, 6, 9].includes(s.budget) || !['active', 'resolving', 'closed'].includes(s.status) || s.supplyId !== null && !['herbal-bandage', 'mining-tonic'].includes(s.supplyId))
            throw Error('组队预留记录无效');
        if (typeof s.retired !== 'boolean' || s.retired && (s.status !== 'closed' || !v.sealed.some((x: any) => x.hostId === sessionKey(s.sessionId).hostId && x.sequence >= sessionKey(s.sessionId).sequence)))
            throw Error('组队完成封存无效');
        sessions.add(s.sessionId);
        active += Number(s.status === 'active');
        createFieldWorld({ sessionId: s.sessionId, seed: 0, actors: [{ id: 'validate', loadout: s.loadout }] });
        if (s.loadout.budget !== s.budget || s.loadout.supply !== s.supplyId)
            throw Error('组队冻结配置冲突');
        num(s.refunded, s.budget);
        if (typeof s.supplyRefunded !== 'boolean')
            throw Error('组队补给退款无效');
        if (s.supplyEvent !== null)
            id(s.supplyEvent);
        if (!Array.isArray(s.consumes) || s.consumes.length > s.budget || !Array.isArray(s.rewardReceipts) || s.rewardReceipts.length > s.consumes.length || s.rewardReceipts.length > s.budget)
            throw Error('组队事件上限无效');
        const ids = new Set();
        for (const c of s.consumes) {
            shape(c, 'eventId kind');
            id(c.eventId);
            if (ids.has(c.eventId) || !['encounter', 'mining'].includes(c.kind))
                throw Error('组队消费记录无效');
            ids.add(c.eventId);
        }
        for (const r of s.rewardReceipts) {
            shape(r, 'eventId fingerprint');
            id(r.eventId);
            if (ids.has(r.eventId) || typeof r.fingerprint !== 'string' || r.fingerprint.length > 512)
                throw Error('组队奖励记录无效');
            ids.add(r.eventId);
            validatePartyReward(JSON.parse(r.fingerprint));
        }
        if (s.close !== null) {
            shape(s.close, 'id fingerprint consumeHighwater rewardHighwater supplyActivated');
            id(s.close.id);
            if (typeof s.close.fingerprint !== 'string' || s.close.fingerprint.length > 160)
                throw Error('组队关闭记录无效');
            if (s.close.consumeHighwater !== null) {
                num(s.close.consumeHighwater, s.consumes.length);
                num(s.close.rewardHighwater, s.budget);
                if (typeof s.close.supplyActivated !== 'boolean' || s.refunded + s.close.consumeHighwater !== s.budget || s.rewardReceipts.length > s.close.rewardHighwater || s.close.rewardHighwater > s.close.consumeHighwater)
                    throw Error('组队退款高水位无效');
            }
            else if (s.refunded + s.consumes.length !== s.budget)
                throw Error('组队待核对退款无效');
        }
        if (s.status === 'active' && (s.refunded !== 0 || s.supplyRefunded) || s.supplyRefunded && !s.supplyId)
            throw Error('组队退款状态无效');
        if (s.close && s.close.fingerprint !== JSON.stringify({ consumeHighwater: s.close.consumeHighwater, rewardHighwater: s.close.rewardHighwater, supplyActivated: s.close.supplyActivated }))
            throw Error('组队关闭参数记录冲突');
        if ((s.status === 'active') !== (s.close === null) || s.status === 'closed' && s.close.consumeHighwater === null || s.status === 'resolving' && s.close.consumeHighwater !== null)
            throw Error('组队关闭状态冲突');
    }
    if (active > 1 || active && (p.run || p.leisure.run) || p.bag.ration + partyRationReserve(p) > 1e6)
        throw Error('组队活动或退款空间冲突');
    const pending = new Set();
    for (const r of v.pending) {
        shape(r, 'id sessionId reward');
        id(r.id);
        sessionKey(r.sessionId);
        validatePartyReward(r.reward);
        if (pending.has(r.id))
            throw Error('组队待领取重复');
        pending.add(r.id);
    }
    const claimed = new Set();
    for (const x of v.claimed) {
        id(x);
        if (claimed.has(x) || pending.has(x))
            throw Error('组队领取记录冲突');
        claimed.add(x);
    }
}
