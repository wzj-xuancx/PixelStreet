import type { PersonalPartyRequest } from '../solo-core/party-ledger';
import { createFieldWorld, parseFieldWorld, type ActorLoadout, type FieldWorld, type FieldMode, type FieldTarget, type FieldView, type RewardPackage } from '../field-world';
export interface PartyMemberView {
    id: string;
    ready: boolean;
    budget: number;
    supply: string | null;
    gear: string[];
}
export interface PartyFieldState {
    phase: 'idle' | 'lobby' | 'running' | 'frozen' | 'closed';
    sessionId: string | null;
    hostId: string | null;
    revision: number;
    members: PartyMemberView[];
    view: FieldView | null;
    notice: string;
    error: string;
    loot?: {
        eventId: string;
        reward: RewardPackage;
    };
}
export const emptyPartyField = (): PartyFieldState => ({ phase: 'idle', sessionId: null, hostId: null, revision: 0, members: [], view: null, notice: '', error: '' });
export type PartyCommand = {
    type: 'party-field';
    generation: number;
    roomEpoch: number;
    op: 'open' | 'prepare' | 'cancel' | 'start' | 'claim';
    budget?: 3 | 6 | 9;
    supplyId?: 'herbal-bandage' | 'mining-tonic' | null;
    packageId?: string;
};
export type PartyInput = {
    kind: 'target';
    target: FieldTarget;
} | {
    kind: 'mode';
    mode: FieldMode;
} | {
    kind: 'return';
};
export interface PartyControl {
    type: 'party-control';
    epoch: number;
    roomEpoch: number;
    sessionId: string;
    floor: number;
    intent: PartyInput;
}
export type PartyWire = {
    type: 'party-field-v1';
    op: 'open';
} | {
    type: 'party-field-v1';
    op: 'completed';
    hostId: string;
    sequence: number;
} | {
    type: 'party-field-v1';
    op: 'lobby';
    sessionId: string;
    revision: number;
    phase: 'lobby' | 'running' | 'closed';
    members: PartyMemberView[];
} | {
    type: 'party-field-v1';
    op: 'prepared';
    sessionId: string;
    prepareId: string;
    capability: string;
    loadout: ActorLoadout;
    pendingCount: number;
} | {
    type: 'party-field-v1';
    op: 'resume';
    sessions: Array<{
        sessionId: string;
        capability: string;
    }>;
} | {
    type: 'party-field-v1';
    op: 'economic';
    sessionId: string;
    capability: string;
    request: PersonalPartyRequest;
} | {
    type: 'party-field-v1';
    op: 'ack';
    sessionId: string;
    capability: string;
    eventId: string;
    kind: 'consume' | 'supply' | 'reward' | 'close';
    seq: number;
    pendingCount: number;
} | {
    type: 'party-field-v1';
    op: 'input';
    sessionId: string;
    seq: number;
    floor: number;
    intent: PartyInput;
} | {
    type: 'party-field-v1';
    op: 'snapshot';
    sessionId: string;
    seq: number;
    world: FieldWorld;
} | {
    type: 'party-field-v1';
    op: 'active';
    sessionId: string;
    active: boolean;
} | {
    type: 'party-field-v1';
    op: 'return';
    sessionId: string;
    capability: string;
};
const obj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
function shape(v: unknown, keys: string): asserts v is Record<string, any> { if (!obj(v) || Object.keys(v).sort().join(' ') !== keys.split(' ').sort().join(' '))
    throw Error('组队消息字段无效'); }
const integer = (v: unknown, max = 1e12, min = 0) => { if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min || v > max)
    throw Error('组队消息数值无效'); };
const sid = (v: unknown) => { if (typeof v !== 'string' || !/^([0-9a-f]{32}):([1-9][0-9]{0,11})$/.test(v))
    throw Error('组队消息场次无效'); };
const cap = (v: unknown) => { if (typeof v !== 'string' || !/^[0-9a-f]{64}$/.test(v))
    throw Error('组队消息凭据无效'); };
const eid = (v: unknown) => { if (typeof v !== 'string' || !/^[-a-zA-Z0-9_:]{1,128}$/.test(v))
    throw Error('组队消息事件无效'); };
export function parsePartyInput(v: unknown): PartyInput { if (!obj(v))
    throw Error('组队操作无效'); if (v.kind === 'return')
    shape(v, 'kind');
else if (v.kind === 'mode') {
    shape(v, 'kind mode');
    if (!['manual', 'farm', 'push'].includes(v.mode))
        throw Error('组队策略无效');
}
else if (v.kind === 'target') {
    shape(v, 'kind target');
    const t = v.target;
    if (!obj(t))
        throw Error('组队目标无效');
    if (t.kind === 'ground') {
        shape(t, 'kind x');
        integer(t.x, 1400);
    }
    else if (t.kind === 'exit')
        shape(t, 'kind');
    else if (t.kind === 'ore' || t.kind === 'monster') {
        shape(t, 'kind id');
        if (typeof t.id !== 'string' || !(t.kind === 'ore' ? /^f[01]-ore$/ : /^f[01]-e[0-2]-m[0-3]$/).test(t.id))
            throw Error('组队目标无效');
    }
    else
        throw Error('组队目标无效');
}
else
    throw Error('组队操作无效'); return structuredClone(v) as PartyInput; }
export function parsePartyCommand(v: Record<string, unknown>): PartyCommand | PartyControl | null { if (v.type === 'party-control') {
    shape(v, 'type epoch roomEpoch sessionId floor intent');
    integer(v.epoch);
    integer(v.roomEpoch);
    sid(v.sessionId);
    integer(v.floor, 1);
    parsePartyInput(v.intent);
    return structuredClone(v) as unknown as PartyControl;
} if (v.type !== 'party-field')
    return null; const op = v.op; shape(v, 'type generation roomEpoch op' + (op === 'prepare' ? ' budget supplyId' : op === 'claim' ? ' packageId' : '')); integer(v.generation, 1e12, 1); integer(v.roomEpoch); if (!['open', 'prepare', 'cancel', 'start', 'claim'].includes(String(op)))
    throw Error('组队页面操作无效'); if (op === 'prepare') {
    if (![3, 6, 9].includes(Number(v.budget)) || typeof v.budget !== 'number' || v.supplyId !== null && v.supplyId !== 'herbal-bandage' && v.supplyId !== 'mining-tonic')
        throw Error('组队准备无效');
} if (op === 'claim')
    eid(v.packageId); return structuredClone(v) as unknown as PartyCommand; }
export function parsePartyWire(v: unknown): PartyWire {
    if (!obj(v) || v.type !== 'party-field-v1')
        throw Error('组队消息无效');
    if (v.op === 'completed') {
        shape(v, 'type op hostId sequence');
        if (typeof v.hostId !== 'string' || !/^[0-9a-f]{32}$/.test(v.hostId))
            throw Error('组队完成来源无效');
        integer(v.sequence, 1e12, 1);
        return v as PartyWire;
    }
    if (v.op === 'open') {
        shape(v, 'type op');
        return v as PartyWire;
    }
    if (v.op === 'resume') {
        shape(v, 'type op sessions');
        if (!Array.isArray(v.sessions) || v.sessions.length > 64)
            throw Error('组队恢复上限');
        const ids = new Set();
        for (const x of v.sessions) {
            shape(x, 'sessionId capability');
            sid(x.sessionId);
            cap(x.capability);
            if (ids.has(x.sessionId))
                throw Error('组队恢复重复');
            ids.add(x.sessionId);
        }
        return structuredClone(v) as PartyWire;
    }
    sid(v.sessionId);
    if (v.op === 'lobby') {
        shape(v, 'type op sessionId revision phase members');
        integer(v.revision);
        if (!['lobby', 'running', 'closed'].includes(v.phase) || !Array.isArray(v.members) || v.members.length > 4)
            throw Error('组队整备无效');
        const ids = new Set();
        for (const m of v.members) {
            shape(m, 'id ready budget supply gear');
            if (typeof m.id !== 'string' || !/^[0-9a-f]{32}$/.test(m.id) || ids.has(m.id) || typeof m.ready !== 'boolean' || ![0, 3, 6, 9].includes(m.budget) || m.supply !== null && !['herbal-bandage', 'mining-tonic'].includes(m.supply) || !Array.isArray(m.gear) || m.gear.length > 6 || m.gear.some((x: unknown) => typeof x !== 'string' || x.length > 32))
                throw Error('组队成员无效');
            ids.add(m.id);
        }
    }
    else if (v.op === 'prepared') {
        shape(v, 'type op sessionId prepareId capability loadout pendingCount');
        eid(v.prepareId);
        cap(v.capability);
        integer(v.pendingCount, 64);
        createFieldWorld({ sessionId: v.sessionId, seed: 0, actors: [{ id: 'validate', loadout: v.loadout }] });
        if (![3, 6, 9].includes(v.loadout.budget))
            throw Error('组队口粮无效');
    }
    else if (v.op === 'economic') {
        shape(v, 'type op sessionId capability request');
        cap(v.capability);
        const q = parsePersonalPartyRequest(v.request);
        if (q.type === 'party-prepare' || q.type === 'party-claim' || q.type === 'party-completed' || q.sessionId !== v.sessionId)
            throw Error('组队私有请求无效');
    }
    else if (v.op === 'ack') {
        shape(v, 'type op sessionId capability eventId kind seq pendingCount');
        cap(v.capability);
        eid(v.eventId);
        integer(v.seq, 64);
        integer(v.pendingCount, 64);
        if (!['consume', 'supply', 'reward', 'close'].includes(v.kind))
            throw Error('组队确认无效');
    }
    else if (v.op === 'input') {
        shape(v, 'type op sessionId seq floor intent');
        integer(v.seq, 1e12, 1);
        integer(v.floor, 1);
        parsePartyInput(v.intent);
    }
    else if (v.op === 'snapshot') {
        shape(v, 'type op sessionId seq world');
        integer(v.seq, 1e12, 1);
        const world = parseFieldWorld(v.world);
        if (world.sessionId !== v.sessionId)
            throw Error('组队快照场次冲突');
    }
    else if (v.op === 'active') {
        shape(v, 'type op sessionId active');
        if (typeof v.active !== 'boolean')
            throw Error('组队呈现无效');
    }
    else if (v.op === 'return') {
        shape(v, 'type op sessionId capability');
        cap(v.capability);
    }
    else
        throw Error('未知组队消息');
    return structuredClone(v) as PartyWire;
}
export function validatePartyReward(v: unknown): asserts v is RewardPackage { shape(v, 'coins xp gel materials ore guardian'); for (const k of ['coins', 'xp', 'gel', 'ore'])
    integer(v[k], 1000); if (typeof v.guardian !== 'boolean' || !obj(v.materials) || Object.keys(v.materials).some(k => !['bone', 'curseCrystal', 'toughHide'].includes(k)))
    throw Error('组队奖励无效'); Object.values(v.materials).forEach(n => integer(n, 100)); }
export function parsePersonalPartyRequest(v: unknown): PersonalPartyRequest {
    if (!obj(v))
        throw Error('组队请求无效');
    if (v.type === 'party-completed') {
        shape(v, 'type hostId sequence');
        if (typeof v.hostId !== 'string' || !/^[0-9a-f]{32}$/.test(v.hostId))
            throw Error('组队完成来源无效');
        integer(v.sequence, 1e12, 1);
        return v as PersonalPartyRequest;
    }
    if (v.type === 'party-claim') {
        shape(v, 'type packageId');
        eid(v.packageId);
        return v as PersonalPartyRequest;
    }
    sid(v.sessionId);
    if (v.type === 'party-prepare') {
        shape(v, 'type sessionId prepareId budget supplyId');
        eid(v.prepareId);
        if (![3, 6, 9].includes(v.budget) || v.supplyId !== null && !['herbal-bandage', 'mining-tonic'].includes(v.supplyId))
            throw Error('组队预留无效');
    }
    else if (v.type === 'party-consume') {
        shape(v, 'type sessionId eventId consumeSeq kind amount');
        eid(v.eventId);
        integer(v.consumeSeq, 9, 1);
        if (!['encounter', 'mining'].includes(v.kind) || v.amount !== 1)
            throw Error('组队消费无效');
    }
    else if (v.type === 'party-supply') {
        shape(v, 'type sessionId eventId supplyId');
        eid(v.eventId);
        if (!['herbal-bandage', 'mining-tonic'].includes(v.supplyId))
            throw Error('组队随行物无效');
    }
    else if (v.type === 'party-reward') {
        shape(v, 'type sessionId eventId rewardSeq package');
        eid(v.eventId);
        integer(v.rewardSeq, 64, 1);
        validatePartyReward(v.package);
    }
    else if (v.type === 'party-close') {
        const full = Object.hasOwn(v, 'consumeHighwater');
        shape(v, 'type sessionId closeId reason' + (full ? ' consumeHighwater rewardHighwater supplyActivated' : ''));
        eid(v.closeId);
        if (typeof v.reason !== 'string' || v.reason.length > 120)
            throw Error('组队关闭原因无效');
        if (full) {
            integer(v.consumeHighwater, 9);
            integer(v.rewardHighwater, 64);
            if (typeof v.supplyActivated !== 'boolean')
                throw Error('组队关闭高水位无效');
        }
    }
    else
        throw Error('未知组队请求');
    return structuredClone(v) as PersonalPartyRequest;
}
