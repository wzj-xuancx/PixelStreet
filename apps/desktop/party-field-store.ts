import fs from 'node:fs';
import path from 'node:path';
import { parsePersonalPartyRequest, type PersonalPartyRequest } from '../../packages/solo-core/party-ledger';
import { createFieldWorld, type ActorLoadout } from '../../packages/field-world';
export type EconomicRequest = Exclude<PersonalPartyRequest, {
    type: 'party-prepare' | 'party-claim' | 'party-completed';
}>;
export interface PartyDelivery {
    request: EconomicRequest;
    acked: boolean;
    activated: boolean;
}
export interface HostRecipient {
    id: string;
    capability: string;
    prepareId: string;
    loadout: ActorLoadout;
    pendingCount: number;
    deliveries: PartyDelivery[];
    closing: boolean;
    closedAck: boolean;
}
export interface HostJournalSession {
    id: string;
    phase: 'lobby' | 'running' | 'closed';
    revision: number;
    recipients: HostRecipient[];
}
export interface HostJournal {
    version: 1;
    completed: Array<{
        id: string;
        sequence: number;
    }>;
    nextSession: number;
    sessions: HostJournalSession[];
}
export const deliveryId = (q: EconomicRequest): string => q.type === 'party-close' ? q.closeId : q.eventId;
export const deliverySeq = (q: EconomicRequest): number => q.type === 'party-consume' ? q.consumeSeq : q.type === 'party-reward' ? q.rewardSeq : 0;
export const deliveryKind = (q: EconomicRequest): 'consume' | 'reward' | 'supply' | 'close' => q.type === 'party-consume' ? 'consume' : q.type === 'party-reward' ? 'reward' : q.type === 'party-supply' ? 'supply' : 'close';
/** Only critical admission, activation, reward/outbox and close points; never stores the 10Hz world. */
export class PartyFieldStore {
    readonly file: string;
    blocked = '';
    value: HostJournal;
    private text = '';
    constructor(folder:string) {
        this.file=path.join(folder,'party-host.json');fs.mkdirSync(folder,{recursive:true,mode:0o700});
        this.value={version:1,completed:[],nextSession:0,sessions:[]};
        if(fs.existsSync(this.file))try{if(fs.statSync(this.file).size>2*1024*1024)throw Error('共斗日志过大');this.value=this.validate(JSON.parse(fs.readFileSync(this.file,'utf8')));this.text=JSON.stringify(this.value);}catch(error){this.blocked='共斗日志读取失败，原文件保留：'+String(error);}
    }
    private validate(raw: any): HostJournal { if (!raw || Object.keys(raw).sort().join(' ') !== 'completed nextSession sessions version' || raw.version !== 1 || !Number.isSafeInteger(raw.nextSession) || raw.nextSession < 0 || raw.nextSession > 1e12 || !Array.isArray(raw.sessions) || raw.sessions.length > 64)
        throw Error('共斗日志无效'); if (!Array.isArray(raw.completed) || raw.completed.length > 256 || new Set(raw.completed.map((x: any) => x.id)).size !== raw.completed.length || raw.completed.some((x: any) => Object.keys(x).sort().join(' ') !== 'id sequence' || !/^[0-9a-f]{32}$/.test(x.id) || !Number.isSafeInteger(x.sequence) || x.sequence < 1 || x.sequence > 1e12))
        throw Error('共斗完成游标无效'); const outbox = new Map<string, number>(); const sessions = new Set(); for (const s of raw.sessions) {
        if (Object.keys(s).sort().join(' ') !== 'id phase recipients revision' || !/^([0-9a-f]{32}):[1-9][0-9]{0,11}$/.test(s.id) || sessions.has(s.id) || !['lobby', 'running', 'closed'].includes(s.phase) || !Number.isSafeInteger(s.revision) || s.revision < 0 || !Array.isArray(s.recipients) || s.recipients.length > 4)
            throw Error('共斗场次日志无效');
        sessions.add(s.id);
        const ids = new Set();
        for (const r of s.recipients) {
            if (Object.keys(r).sort().join(' ') !== 'capability closedAck closing deliveries id loadout pendingCount prepareId' || !/^[0-9a-f]{32}$/.test(r.id) || ids.has(r.id) || !/^[0-9a-f]{64}$/.test(r.capability) || !/^[-a-zA-Z0-9_:]{1,128}$/.test(r.prepareId) || typeof r.closing !== 'boolean' || typeof r.closedAck !== 'boolean' || !Number.isSafeInteger(r.pendingCount) || r.pendingCount < 0 || r.pendingCount > 64 || !Array.isArray(r.deliveries) || r.deliveries.length > 84 || r.deliveries.filter((d: PartyDelivery) => !d.acked).length > 64)
                throw Error('共斗接收者日志无效');
            ids.add(r.id);
            const outstanding = (outbox.get(r.id) ?? 0) + r.deliveries.filter((d: PartyDelivery) => !d.acked).length;
            if (outstanding > 64)
                throw Error('个人共斗发件箱已满');
            outbox.set(r.id, outstanding);
            createFieldWorld({ sessionId: s.id, seed: 0, actors: [{ id: r.id, loadout: r.loadout }] });
            const events = new Set();
            for (const d of r.deliveries) {
                if (Object.keys(d).sort().join(' ') !== 'acked activated request' || typeof d.acked !== 'boolean' || typeof d.activated !== 'boolean')
                    throw Error('共斗发件箱无效');
                const q = parsePersonalPartyRequest(d.request);
                if (q.type === 'party-prepare' || q.type === 'party-claim' || q.type === 'party-completed' || q.sessionId !== s.id || events.has(deliveryId(q)))
                    throw Error('共斗事件冲突');
                events.add(deliveryId(q));
            }
        }
    } return structuredClone(raw); }
    private atomic(file: string, text: string): void { const temporary = file + `.tmp-${process.pid}`; try {
        const fd = fs.openSync(temporary, 'w', 0o600);
        try {
            fs.writeFileSync(fd, text + '\n');
            fs.fsyncSync(fd);
        }
        finally {
            fs.closeSync(fd);
        }
        fs.renameSync(temporary, file);
    }
    catch (e) {
        try {
            fs.unlinkSync(temporary);
        }
        catch { }
        throw e;
    } }
    private save(input: HostJournal): void { const next = this.validate(input), text = JSON.stringify(next); if (Buffer.byteLength(text) > 2 * 1024 * 1024)
        throw Error('共斗日志已满'); if (this.text)
        this.atomic(this.file + '.bak', this.text); this.atomic(this.file, text); this.value = next; this.text = text; }
    update(mutate: (next: HostJournal) => void): void { if(this.blocked)throw Error(this.blocked);const next = structuredClone(this.value); mutate(next); this.save(next); }
    create(hostId: string): string { let id = ''; this.update(v => { v.sessions = v.sessions.filter(s => !s.recipients.every(r => r.closedAck) && s.recipients.length > 0 || s.phase !== 'closed'); if (v.sessions.length >= 64)
        throw Error('共斗恢复日志已满，先完成旧结算'); id = hostId + ':' + (++v.nextSession); v.sessions.push({ id, phase: 'lobby', revision: 1, recipients: [] }); }); return id; }
    complete(v: HostJournal, id: string): void { const rows = v.sessions.flatMap(s => s.recipients.filter(r => r.id === id).map(r => ({ sequence: Number(s.id.split(':')[1]), closed: r.closedAck }))), firstOpen = Math.min(Infinity, ...rows.filter(r => !r.closed).map(r => r.sequence)), sequence = Math.max(0, ...rows.filter(r => r.closed && r.sequence < firstOpen).map(r => r.sequence)); if (!sequence)
        return; const cursor = v.completed.find(c => c.id === id); if (cursor)
        cursor.sequence = Math.max(cursor.sequence, sequence);
    else {
        if (v.completed.length >= 256)
            throw Error('共斗结算成员记录已满');
        v.completed.push({ id, sequence });
    } }
    closeSession(id: string, reason: string): void { this.update(v => { const s = v.sessions.find(s => s.id === id); if (!s)
        return; s.phase = 'closed'; s.revision++; for (const r of s.recipients)
        this.closeRecipient(s, r, reason); }); }
    closeRecipient(s: HostJournalSession, r: HostRecipient, reason: string): void { if (r.closing)
        return; r.closing = true; const consumes = r.deliveries.filter(d => d.request.type === 'party-consume' && d.activated), supply = r.deliveries.some(d => d.request.type === 'party-supply' && d.activated), rewards = r.deliveries.filter(d => d.request.type === 'party-reward'); r.deliveries = r.deliveries.filter(d => d.request.type !== 'party-consume' && d.request.type !== 'party-supply' || d.activated); r.deliveries.push({ request: { type: 'party-close', sessionId: s.id, closeId: s.id + ':close:' + r.id, reason, consumeHighwater: consumes.length, rewardHighwater: rewards.length, supplyActivated: supply }, acked: false, activated: false }); }
}
