import { randomUUID } from 'node:crypto';
import { fieldView, type FieldWorld, type FieldEffect, type FieldConfirmation } from '../../packages/field-world';
import { partyBusy, type PersonalPartySession, type PersonalPartyReply, type PersonalPartyRequest } from '../../packages/solo-core/party-ledger';
import { emptyPartyField, parsePartyWire, type PartyWire, type PartyFieldState, type PartyInput, type PartyCommand, type PartyControl } from '../../packages/protocol/party-field';
import type { GameRuntime } from './game-runtime';
import type { RoomService, RoomMembershipEvent } from './room-service';
import { PartyFieldStore, deliveryId, deliverySeq, deliveryKind, type EconomicRequest, type HostRecipient, type HostJournalSession } from './party-field-store';
import { PartyFieldRuntime } from './party-field-runtime';
const errorText = (e: unknown) => String(e instanceof Error ? e.message : e).slice(0, 200);
/** Main-only bridge: binds authenticated connections to private personal saves and the Host journal. */
export class PartyFieldService {
    state: PartyFieldState = emptyPartyField();
    readonly ready: Promise<void>;
    readonly store: PartyFieldStore;
    private runtime: PartyFieldRuntime;
    private serial: Promise<unknown> = Promise.resolve();
    private timer: ReturnType<typeof setInterval>;
    private detach: () => void;
    private disposed = false;
    private quitting = false;
    private local?: PersonalPartySession;
    private capacityPaused = new Set<string>();
    private authorized = new Set<string>();
    private completionSent = new Map<string, number>();
    private appliedCompletion = 0;
    private sentAt = new Map<string, number>();
    private inputSeq = 0;
    private receivedInputs = new Map<string, number>();
    private snapshotSeq = 0;
    private receivedSnapshot = 0;
    private lastLobby = 0;
    private lastResume = 0;
    private active = false;
    private peerActive = new Map<string, boolean>();
    private lastRoom = '';
    private effects: FieldEffect[] = [];
    private preparedUntil = 0;
    constructor(folder: string, private game: GameRuntime, private room: RoomService, private update: () => void) {
        this.store = new PartyFieldStore(folder);
        this.runtime = new PartyFieldRuntime(w => this.snapshot(w), e => { this.effects.push(...e); void this.background(() => this.drainEffects()); }, e => { this.runtime.freeze(true); this.state.error = e; this.emit(); });
        this.detach = room.attachPartyTransport({ client: (peer, payload) => { void this.background(() => this.fromGuest(peer.peerId, parsePartyWire(payload))); }, host: payload => { const epoch=room.state.roomEpoch; void this.background(async () => {if(epoch===room.state.roomEpoch)await this.fromHost(parsePartyWire(payload),epoch);}); }, membership: event => { const epoch=room.state.roomEpoch; void this.background(() => this.membership(event,epoch)); } });
        this.ready = Promise.all([game.ready, room.ready]).then(async () => {
            if(this.store.blocked){this.state.error=this.store.blocked;return;}
            if(game.state.status!=='ready'||!game.state.profile){this.state.error='个人进度暂停，组队结算保留。';return;}
            for (const s of [...this.store.value.sessions])
                if (s.phase !== 'closed')
                    this.store.closeSession(s.id, '房主进程重启，本趟已结束');
            const p = await game.authoritativeProfile();
            for (const s of p.party?.sessions ?? [])
                if (s.status === 'active')
                    await game.personalParty({ type: 'party-close', sessionId: s.sessionId, closeId: s.sessionId + ':local-restart', reason: '应用重启，等待房主核对' });
            for (const journal of this.store.value.sessions) {
                const recipient = journal.recipients.find(r => r.id === this.room.state.localPlayerId);
                if (!recipient)
                    continue;
                const own = (await game.authoritativeProfile()).party?.sessions.find(s => s.sessionId === journal.id);
                if (!own || own.capability !== recipient.capability)
                    throw Error('本机共斗恢复凭据与日志不匹配');
                for (const delivery of recipient.deliveries.filter(d => !d.acked)) {
                    await game.personalParty(delivery.request);
                    this.store.update(v => { const r = v.sessions.find(s => s.id === journal.id)!.recipients.find(r => r.id === recipient.id)!, d = r.deliveries.find(d => deliveryId(d.request) === deliveryId(delivery.request))!; d.acked = true; if (delivery.request.type === 'party-close') {
                        r.closedAck = true;
                        this.store.complete(v, r.id);
                    } });
                }
            }
        });
        this.timer = setInterval(() => { void this.background(() => this.pump()); }, 200);
        this.timer.unref();
    }
    private emit(): void { if (!this.disposed)
        this.update(); }
    private task<T>(f: () => Promise<T>): Promise<T> { const next = this.serial.then(f); this.serial = next.catch(() => { }); return next; }
    private background(f: () => Promise<unknown>): Promise<void> { return this.task(async () => { if (this.disposed)
        return; try {
        await this.ready;
        await f();
    }
    catch (e) {
        this.state.error = errorText(e);
        this.emit();
    } }); }
    private current(): HostJournalSession | undefined { return this.store.value.sessions.find(s => s.id === this.state.sessionId); }
    private online(id: string): boolean { return this.room.state.members.some(m => m.id === id && m.online); }
    private assertRoom(epoch?: number): void { if(this.store.blocked)throw Error(this.store.blocked);if (this.quitting || this.disposed || epoch !== undefined && epoch !== this.room.state.roomEpoch || !['hosting', 'joined'].includes(this.room.state.status))
        throw Error('好友房间已变化，请重新打开组队整备'); }
    private session(id: string): HostJournalSession | undefined { return this.store.value.sessions.find(s => s.id === id); }
    private backlog(id: string): number { return this.store.value.sessions.flatMap(s => s.recipients).filter(r => r.id === id).reduce((n, r) => n + r.deliveries.filter(d => !d.acked).length, 0); }
    private recipient(sessionId: string, id: string): HostRecipient | undefined { return this.session(sessionId)?.recipients.find(r => r.id === id); }
    private lobbyPayload(s: HostJournalSession): PartyWire { return { type: 'party-field-v1', op: 'lobby', sessionId: s.id, revision: s.revision, phase: s.phase, members: this.room.state.members.map(m => { const r = s.recipients.find(r => r.id === m.id && !r.closing); return { id: m.id, ready: !!r, budget: r?.loadout.budget ?? 0, supply: r?.loadout.supply ?? null, gear: r?.loadout.gear ?? [] }; }) }; }
    private broadcastLobby(): void { const s = this.current(); if (!s)
        return; const payload = this.lobbyPayload(s); if (payload.op !== 'lobby')
        return; this.state.members = payload.members; this.state.revision = s.revision; this.state.phase = s.phase; this.lastLobby = Date.now(); for (const m of this.room.state.members)
        if (m.online && m.id !== this.room.state.localPlayerId)
            this.room.sendPartyToPeer(m.id, payload); this.emit(); }
    private async open(): Promise<void> { this.assertRoom(); if (this.room.state.role === 'guest') {
        this.room.sendPartyToHost({ type: 'party-field-v1', op: 'open' });
        this.state.notice = '等待房主整备；每人分别选择口粮并准备。';
        this.emit();
        return;
    } if (this.current()?.phase === 'running')
        return; if (this.current()?.phase === 'lobby')
        return this.broadcastLobby(); const id = this.store.create(this.room.state.localPlayerId); this.state = { ...emptyPartyField(), phase: 'lobby', sessionId: id, hostId: this.room.state.localPlayerId, notice: '两关同行 · 每人准备后，房主最后出发。' }; this.broadcastLobby(); }
    command(command: PartyCommand, guard: () => void = () => { }): Promise<void> {
        return this.task(async () => {
            await this.ready;
            guard();
            if (command.op === 'claim') {
                await this.game.personalParty({ type: 'party-claim', packageId: command.packageId! });
                guard();
                this.emit();
                return;
            }
            this.assertRoom(command.roomEpoch);
            if (command.op === 'open') {
                await this.open();
                guard();
                return;
            }
            const id = this.state.sessionId;
            if (!id)
                throw Error('请先打开组队整备');
            if (command.op === 'prepare') {
                if (this.state.phase !== 'lobby')
                    throw Error('队伍已经出发');
                const profile = await this.game.authoritativeProfile();
                guard();
                this.assertRoom(command.roomEpoch);
                const previous = profile.party?.sessions.find(s => s.sessionId === id && s.status === 'active');
                const q: PersonalPartyRequest = { type: 'party-prepare', sessionId: id, prepareId: previous?.prepareId ?? randomUUID(), budget: command.budget!, supplyId: command.supplyId! };
                guard();
                const result = await this.game.personalParty(q);
                this.local = result.session;
                try {
                    guard();
                    this.assertRoom(command.roomEpoch);
                }
                catch (e) {
                    await this.closeLocalUnknown('整备面板已失效');
                    throw e;
                }
                await this.sendPrepared(result);
                this.state.error = '';
                this.emit();
            }
            else if (command.op === 'start') {
                if (this.room.state.role !== 'host')
                    throw Error('只有房主可出发');
                const s = this.current();
                if (!s || s.phase !== 'lobby')
                    throw Error('组队整备已变化');
                const online = this.room.state.members.filter(m => m.online);
                if (online.length < 2 || online.length > 4 || online.some(m => !s.recipients.some(r => r.id === m.id && !r.closing && r.pendingCount < 64) || m.id !== this.room.state.localPlayerId && !this.authorized.has(id + ':' + m.id) || this.backlog(m.id) >= 63))
                    throw Error('需要2–4位在线队员分别准备');
                guard();
                this.store.update(v => { const s = v.sessions.find(s => s.id === id)!; s.phase = 'running'; s.revision++; });
                this.snapshotSeq = 0;
                this.receivedInputs.clear();
                this.runtime.start({ sessionId: id, seed: Date.now() >>> 0, actors: this.current()!.recipients.filter(r => online.some(m => m.id === r.id)).map(r => ({ id: r.id, loadout: r.loadout })) });
                this.state.error = '';
                this.broadcastLobby();
            }
            else if (command.op === 'cancel') {
                if (this.room.state.role === 'host')
                    await this.end('取消组队准备');
                else if (this.local) {
                    this.room.sendPartyToHost({ type: 'party-field-v1', op: 'return', sessionId: id, capability: this.local.capability });
                    await this.closeLocalUnknown('取消组队准备');
                }
                this.state.view = null;
                this.emit();
            }
        });
    }
    private async sendPrepared(result?: PersonalPartyReply): Promise<void> { if (!this.local)
        return; const p = result?.summary ?? this.game.state.party; if (this.room.state.role === 'host')
        await this.register(this.room.state.localPlayerId, { type: 'party-field-v1', op: 'prepared', sessionId: this.local.sessionId, prepareId: this.local.prepareId, capability: this.local.capability, loadout: this.local.loadout, pendingCount: p?.pending.length ?? 0 });
    else if (this.room.state.status === 'joined')
        this.room.sendPartyToHost({ type: 'party-field-v1', op: 'prepared', sessionId: this.local.sessionId, prepareId: this.local.prepareId, capability: this.local.capability, loadout: this.local.loadout, pendingCount: p?.pending.length ?? 0 }); this.preparedUntil = Date.now(); }
    private async register(id: string, m: Extract<PartyWire, {
        op: 'prepared';
    }>): Promise<void> { this.assertRoom(); const s = this.current(); if (!s || s.id !== m.sessionId || s.phase !== 'lobby' || !this.online(id))
        return; if (this.backlog(id) >= 63)
        throw Error('旧结算正在确认，请稍后准备'); const old = s.recipients.find(r => r.id === id); if (old) {
        if (old.capability !== m.capability || old.prepareId !== m.prepareId || JSON.stringify(old.loadout) !== JSON.stringify(m.loadout))
            throw Error('队员准备参数冲突');
        this.authorized.add(m.sessionId + ':' + id);
        return;
    } this.store.update(v => { const s = v.sessions.find(s => s.id === m.sessionId)!; s.recipients.push({ id, capability: m.capability, prepareId: m.prepareId, loadout: m.loadout, pendingCount: m.pendingCount, deliveries: [], closing: false, closedAck: false }); s.revision++; }); this.authorized.add(m.sessionId + ':' + id); this.broadcastLobby(); }
    control(command: PartyControl, guard: () => void): Promise<void> { return this.task(async () => { await this.ready; guard(); this.assertRoom(command.roomEpoch); if (this.state.phase !== 'running' || this.state.sessionId !== command.sessionId || this.state.view?.floor !== command.floor)
        throw Error('组队场次已变化或连接暂停'); const i = command.intent; if (i.kind === 'mode' && this.room.state.role !== 'host')
        throw Error('由房主切换全队策略'); if (i.kind === 'return') {
        await this.returnLocal();
        guard();
        return;
    } if (this.room.state.role === 'host')
        this.runtime.input(this.room.state.localPlayerId, this.room.state.localPlayerId, i);
    else
        this.room.sendPartyToHost({ type: 'party-field-v1', op: 'input', sessionId: command.sessionId, seq: ++this.inputSeq, floor: command.floor, intent: i }); }); }
    private async returnLocal(): Promise<void> { if (!this.local)
        return; if (this.room.state.role === 'host')
        await this.closeRecipient(this.local.sessionId, this.room.state.localPlayerId, '主动回营');
    else {
        this.room.sendPartyToHost({ type: 'party-field-v1', op: 'return', sessionId: this.local.sessionId, capability: this.local.capability });
        await this.closeLocalUnknown('主动回营');
    } this.state.view = null; this.state.notice = '已回营；经营和制作继续。'; this.emit(); }
    private async fromGuest(id: string, m: PartyWire): Promise<void> { if (this.room.state.role !== 'host' || !this.online(id))
        return; if (m.op === 'open') {
        await this.open();
        return;
    } if (m.op === 'prepared') {
        await this.register(id, m);
        return;
    } if (m.op === 'resume') {
        for (const proof of m.sessions) {
            const r = this.recipient(proof.sessionId, id);
            if (r && r.capability === proof.capability) {
                this.authorized.add(proof.sessionId + ':' + id);
                if (this.current()?.id === proof.sessionId && !r.closing)
                    this.runtime.presence(id, true);
                this.sentAt.delete(proof.sessionId + ':' + id);
                if (this.session(proof.sessionId)?.phase === 'closed' && !r.closing)
                    this.store.closeSession(proof.sessionId, '房主恢复旧结算');
            }
        }
        await this.sendCompletion(id, true);
        if (this.current())
            this.broadcastLobby();
        return;
    } if (m.op === 'completed')
        return; if (m.op === 'ack') {
        await this.ack(id, m);
        return;
    } const s = this.current(), r = s?.recipients.find(r => r.id === id); if (!s || m.sessionId !== s.id || !r || r.closing)
        return; if (m.op === 'return') {
        if (m.capability !== r.capability)
            throw Error('组队回营凭据不匹配');
        await this.closeRecipient(s.id, id, '队员主动回营');
        return;
    } if (m.op === 'active') {
        this.peerActive.set(id, m.active);
        this.runtime.presentation(this.active || [...this.peerActive].some(([id, active]) => active && this.online(id)));
        return;
    } if (m.op === 'input') {
        if (s.phase !== 'running' || m.seq <= (this.receivedInputs.get(id) ?? 0))
            return;
        if (m.intent.kind === 'mode')
            throw Error('只有房主可切换全队策略');
        const actor = this.runtime.world?.actors.find(a => a.id === id);
        if (!actor || actor.floor !== m.floor || actor.returned || !actor.online)
            return;
        this.receivedInputs.set(id, m.seq);
        if (m.intent.kind === 'return')
            await this.closeRecipient(s.id, id, '队员主动回营');
        else
            this.runtime.input(id, this.room.state.localPlayerId, m.intent);
    } }
    private async fromHost(m: PartyWire, epoch=this.room.state.roomEpoch): Promise<void> {
        if (epoch!==this.room.state.roomEpoch || this.room.state.role !== 'guest')
            return;
        if (m.op === 'completed') {
            if (m.hostId !== this.room.state.hostId)
                throw Error('组队完成房主不匹配');
            const p = await this.game.authoritativeProfile();
            if(epoch!==this.room.state.roomEpoch)return;
            if ((p.party?.sealed.find(c => c.hostId === m.hostId)?.sequence ?? 0) < m.sequence)
                await this.game.personalParty({ type: 'party-completed', hostId: m.hostId, sequence: m.sequence });
            return;
        }
        if (m.op === 'lobby') {
            if(this.room.state.status!=='joined')return;
            if (!m.sessionId.startsWith(this.room.state.hostId + ':'))
                throw Error('组队房主归属冲突');
            if (m.sessionId === this.state.sessionId && m.revision < this.state.revision)
                return;
            const changed = m.sessionId !== this.state.sessionId;
            if (changed) {
                if (this.local?.status === 'active' && this.local.sessionId !== m.sessionId)
                    await this.closeLocalUnknown('房主已开启新整备',this.local.sessionId);
                if(epoch!==this.room.state.roomEpoch)return;
                this.receivedSnapshot = 0;
                this.state.view = null;
                this.local = undefined;
                const p = await this.game.authoritativeProfile();
                if(epoch!==this.room.state.roomEpoch)return;
                this.local = p.party?.sessions.find(s => s.sessionId === m.sessionId && s.status === 'active');
            }
            // A delayed lobby/snapshot cannot reactivate a locally returned participation.
            const returned=this.local && this.local.sessionId===m.sessionId && this.local.status!=='active';
            this.state = { ...this.state, phase: returned?'closed':m.phase, sessionId: m.sessionId, hostId: this.room.state.hostId, revision: m.revision, members: m.members, error: '' };
            if (m.phase === 'closed') {
                this.state.view = null;
                await this.closeLocalUnknown('房主已结束本趟',m.sessionId);
                if(epoch!==this.room.state.roomEpoch)return;
            }
            this.emit();
        }
        else if (m.op === 'snapshot') {
            if (m.sessionId !== this.state.sessionId || m.seq <= this.receivedSnapshot || this.room.state.status !== 'joined')
                return;
            const actor = m.world.actors.find(a => a.id === this.room.state.localPlayerId);
            if (!actor || !this.local || this.local.sessionId !== m.sessionId || this.local.status !== 'active')
                return;
            this.receivedSnapshot = m.seq;
            this.state.phase = 'running';
            this.state.view = actor.returned ? null : fieldView(m.world, this.room.state.localPlayerId);
            this.state.error = '';
            this.emit();
        }
        else if (m.op === 'economic') {
            const p = await this.game.authoritativeProfile(), s = p.party?.sessions.find(s => s.sessionId === m.sessionId);
            if(epoch!==this.room.state.roomEpoch)return;
            if (!s || s.capability !== m.capability)
                throw Error('组队结算凭据不匹配');
            const result = await this.game.personalParty(m.request);
            // An old authenticated delivery can finish saving, but cannot ACK its capability to a new room.
            if(epoch!==this.room.state.roomEpoch)return;
            if (m.request.type === 'party-reward')
                this.state.loot = { eventId: m.request.eventId, reward: m.request.package };
            if (this.local?.sessionId === m.sessionId)
                this.local = result.session;
            if (m.request.type === 'party-close' && m.sessionId === this.state.sessionId) {
                this.state.view = null;
                this.state.notice = m.request.reason.includes('确认中断') ? m.request.reason : '已回营，未用口粮与补给已核对退还。';
            }
            this.room.sendPartyToHost({ type: 'party-field-v1', op: 'ack', sessionId: m.sessionId, capability: s.capability, eventId: deliveryId(m.request as EconomicRequest), kind: deliveryKind(m.request as EconomicRequest), seq: deliverySeq(m.request as EconomicRequest), pendingCount: result.summary.pending.length });
            this.state.error = '';
            this.emit();
        }
    }
    private snapshot(world: FieldWorld): void { if (this.disposed || this.quitting || world.sessionId !== this.state.sessionId || this.current()?.phase !== 'running')
        return; const actor = world.actors.find(a => a.id === this.room.state.localPlayerId); this.state.phase = 'running'; this.state.view = actor && !actor.returned ? fieldView(world, this.room.state.localPlayerId) : null; const m: PartyWire = { type: 'party-field-v1', op: 'snapshot', sessionId: world.sessionId, seq: ++this.snapshotSeq, world }; for (const r of this.current()!.recipients)
        if (r.id !== this.room.state.localPlayerId && !r.closing && this.online(r.id) && this.authorized.has(world.sessionId + ':' + r.id))
            this.room.sendPartyToPeer(r.id, m); this.emit(); if (!world.actors.some(a => a.online && !a.returned))
        void this.background(() => this.end('没有在线冒险者，本趟结束')); }
    private async drainEffects(): Promise<void> {
        for (let processed = 0, batch = this.effects.length; processed < batch && this.effects.length; processed++) {
            const e = this.effects[0], s = this.current();
            if (!s || s.phase !== 'running') {
                this.effects.shift();
                continue;
            }
            if (e.type === 'return') {
                await this.closeRecipient(s.id, e.actorId, e.reason);
                this.effects.shift();
                continue;
            }
            if (e.type === 'encounter-start') {
                this.effects.shift();
                continue;
            }
            const r = s.recipients.find(r => r.id === e.actorId);
            if (!r || r.closing) {
                this.effects.shift();
                continue;
            }
            if (e.type === 'consume-needed' && r.pendingCount >= 64) {
                await this.closeRecipient(s.id, r.id, '待领取已满，暂停新遭遇');
                this.effects.shift();
                continue;
            }
            if (!r.deliveries.some(d => deliveryId(d.request) === e.id)) {
                if (this.backlog(r.id) >= 63) {
                    this.runtime.presence(r.id, false);
                    this.capacityPaused.add(r.id);
                    this.state.error = '待结算队列已满，暂停该队员新参与，保留全部奖励。';
                    if (e.type === 'consume-needed') {
                        await this.closeRecipient(s.id, r.id, '结算队列已满，先回营核对');
                        this.effects.shift();
                    }
                    else
                        this.effects.push(this.effects.shift()!);
                    continue;
                }
                const consumes = r.deliveries.filter(d => d.request.type === 'party-consume').length, rewards = r.deliveries.filter(d => d.request.type === 'party-reward').length;
                const request: EconomicRequest = e.type === 'consume-needed' ? { type: 'party-consume', sessionId: s.id, eventId: e.id, consumeSeq: consumes + 1, kind: e.kind, amount: 1 } : e.type === 'supply-needed' ? { type: 'party-supply', sessionId: s.id, eventId: e.id, supplyId: e.supply } : { type: 'party-reward', sessionId: s.id, eventId: e.id, rewardSeq: rewards + 1, package: e.reward };
                this.store.update(v => v.sessions.find(x => x.id === s.id)!.recipients.find(x => x.id === r.id)!.deliveries.push({ request, acked: false, activated: false }));
            }
            this.effects.shift();
        }
    }
    private async ack(id: string, m: Extract<PartyWire, {
        op: 'ack';
    }>): Promise<void> {
        const r = this.recipient(m.sessionId, id), d = r?.deliveries.find(d => deliveryId(d.request) === m.eventId);
        if (!r || r.capability !== m.capability || !d || deliveryKind(d.request) !== m.kind || deliverySeq(d.request) !== m.seq)
            return;
        if (d.acked)
            return;
        if (r.deliveries.find(d => !d.acked) !== d)
            return;
        const q = d.request;
        if (r.closing && (q.type === 'party-consume' || q.type === 'party-supply'))
            return;
        // This is the Host activation commit. A crash before it refunds this provisional charge on close;
        // after it close highwater keeps the cost, even if the World confirmation/publication is lost.
        this.store.update(v => { const r = v.sessions.find(s => s.id === m.sessionId)!.recipients.find(r => r.id === id)!, d = r.deliveries.find(d => deliveryId(d.request) === m.eventId)!; d.acked = true; d.activated = q.type === 'party-consume' || q.type === 'party-supply'; r.pendingCount = m.pendingCount; if (q.type === 'party-close') {
            r.closedAck = true;
            this.store.complete(v, r.id);
        } });
        if (this.current()?.id === m.sessionId && this.current()?.phase === 'running' && !r.closing) {
            this.runtime.confirm([{ actorId: id, eventId: m.eventId, accepted: true }]);
            if (m.pendingCount >= 64 || this.capacityPaused.has(id)) {
                this.capacityPaused.delete(id);
                await this.closeRecipient(m.sessionId, id, '待结算已满，回营处理');
            }
        }
        this.sentAt.delete(m.sessionId + ':' + id);
        this.state.error = '';
        this.emit();
    }
    private async pump(): Promise<void> {
        await this.ready;
        if (this.quitting)
            return;
        const key = [this.room.state.role, this.room.state.status, this.room.state.roomEpoch].join(':');
        if (key !== this.lastRoom) {
            this.lastRoom = key;
            if (this.room.state.role === 'guest' && this.room.state.status === 'joined')
                await this.resume();
        }
        if (this.room.state.role === 'guest' && this.room.state.status === 'disconnected' && (this.state.phase === 'frozen' || this.local?.status === 'active')) {
            const epoch=this.room.state.roomEpoch,sessionId=this.local?.sessionId??this.state.sessionId;
            await this.closeLocalUnknown('30秒内未恢复连接',sessionId??undefined);
            if(epoch!==this.room.state.roomEpoch)return;
            this.state.view = null;
            this.state.phase = 'closed';
            this.state.notice = '重连窗口已结束，已回营，待核对结算保留。';
            this.emit();
        }
        if (this.room.state.role === 'host') {
            if (this.current() && Date.now() - this.lastLobby >= 1000)
                this.broadcastLobby();
            await this.drainEffects();
            for (const member of this.room.state.members)
                if (member.online)
                    await this.sendCompletion(member.id);
            for (const s of this.store.value.sessions)
                for (const r of s.recipients) {
                    if (r.closedAck || r.id !== this.room.state.localPlayerId && (!this.online(r.id) || !this.authorized.has(s.id + ':' + r.id)))
                        continue;
                    const key = 'recipient:' + r.id;
                    if (Date.now() - (this.sentAt.get(key) ?? 0) < 200)
                        continue;
                    const d = r.deliveries.find(d => !d.acked);
                    if (!d)
                        continue;
                    this.sentAt.set(key, Date.now());
                    if (r.id === this.room.state.localPlayerId) {
                        const result = await this.game.personalParty(d.request);
                        if (d.request.type === 'party-reward')
                            this.state.loot = { eventId: d.request.eventId, reward: d.request.package };
                        if (this.local?.sessionId === s.id)
                            this.local = result.session;
                        await this.ack(r.id, { type: 'party-field-v1', op: 'ack', sessionId: s.id, capability: r.capability, eventId: deliveryId(d.request), kind: deliveryKind(d.request), seq: deliverySeq(d.request), pendingCount: result.summary.pending.length });
                    }
                    else
                        this.room.sendPartyToPeer(r.id, { type: 'party-field-v1', op: 'economic', sessionId: s.id, capability: r.capability, request: d.request });
                }
            if (this.current()?.phase === 'lobby' && this.local?.status === 'active' && !this.recipient(this.current()!.id, this.room.state.localPlayerId))
                await this.sendPrepared();
        }
        else if (this.room.state.role === 'guest' && this.room.state.status === 'joined') {
            if (Date.now() - this.lastResume >= 3000)
                await this.resume();
            if (this.state.phase === 'lobby' && this.local?.status === 'active' && !this.state.members.find(m => m.id === this.room.state.localPlayerId)?.ready && Date.now() - this.preparedUntil >= 1000)
                await this.sendPrepared();
        }
    }
    private async sendCompletion(id: string, force = false): Promise<void> { const cursor = this.store.value.completed.find(c => c.id === id); if (!cursor)
        return; if (id === this.room.state.localPlayerId) {
        if (cursor.sequence <= this.appliedCompletion)
            return;
        await this.game.personalParty({ type: 'party-completed', hostId: this.room.state.localPlayerId, sequence: cursor.sequence });
        this.appliedCompletion = cursor.sequence;
    }
    else if (force || Date.now() - (this.completionSent.get(id) ?? 0) >= 1000) {
        this.completionSent.set(id, Date.now());
        this.room.sendPartyToPeer(id, { type: 'party-field-v1', op: 'completed', hostId: this.room.state.localPlayerId, sequence: cursor.sequence });
    } }
    private async resume(): Promise<void> { const p = await this.game.authoritativeProfile(); this.lastResume = Date.now(); this.room.sendPartyToHost({ type: 'party-field-v1', op: 'resume', sessions: (p.party?.sessions ?? []).filter(s => s.sessionId.startsWith(this.room.state.hostId + ':')).map(s => ({ sessionId: s.sessionId, capability: s.capability })) }); }
    private async membership(e: RoomMembershipEvent, epoch=this.room.state.roomEpoch): Promise<void> {
        if(epoch!==this.room.state.roomEpoch)return;
        if (this.room.state.role === 'host' && e.playerId) {
            if (e.kind === 'disconnected' || e.kind === 'left' || e.kind === 'expired')
                for (const key of this.authorized)
                    if (key.endsWith(':' + e.playerId))
                        this.authorized.delete(key);
            this.runtime.presence(e.playerId, (e.kind === 'joined' || e.kind === 'roster') && this.authorized.has(this.state.sessionId + ':' + e.playerId));
            if (e.kind === 'disconnected' && this.current()?.phase === 'running') {
                const recipient = this.recipient(this.state.sessionId!, e.playerId), pending = this.runtime.world?.pending.find(x => 'actorId' in x && x.actorId === e.playerId && x.type === 'consume-needed'), delivery = recipient?.deliveries.find(d => pending ? deliveryId(d.request) === pending.id : d.request.type === 'party-consume' && !d.acked);
                if ((pending || delivery) && !delivery?.activated)
                    await this.closeRecipient(this.state.sessionId!, e.playerId, '准备确认中断，已回营，请下一趟重新准备');
            }
            if (e.kind === 'left' || e.kind === 'expired') {
                if (this.state.sessionId)
                    await this.closeRecipient(this.state.sessionId, e.playerId, e.kind === 'expired' ? '断线超过30秒' : '队员离房');
            }
            if (this.current())
                this.broadcastLobby();
        }
        if (this.room.state.role === 'guest' && e.kind === 'disconnected' && (this.room.state.status==='reconnecting'||this.room.state.status==='disconnected') && (!e.playerId||e.playerId===this.room.state.hostId)) {
            if (this.state.view || this.local?.status==='active') {
                this.state.phase = 'frozen';
                this.state.notice = '与房主连接中断，共斗暂停，正在恢复原身份。';
                this.emit();
            }
        }
        if (e.kind === 'closed') {
            if (this.current()?.phase === 'running' && this.state.hostId === this.room.state.localPlayerId)
                await this.end('房间已关闭');
            await this.closeLocalUnknown('房间已关闭');
            this.state = { ...emptyPartyField(), notice: '已返回营地；待结算会在连接恢复后核对。' };
            this.emit();
        }
    }
    private async closeRecipient(sessionId: string, id: string, reason: string): Promise<void> { const s = this.session(sessionId), r = s?.recipients.find(r => r.id === id); if (!s || !r || r.closing)
        return; this.store.update(v => { const s = v.sessions.find(s => s.id === sessionId)!; this.store.closeRecipient(s, s.recipients.find(r => r.id === id)!, reason); s.revision++; }); if (sessionId === this.state.sessionId) {
        this.runtime.retire(id);
        if (id === this.room.state.localPlayerId)
            this.state.view = null;
        if (s.phase === 'lobby') {
            await this.end('组队准备已取消');
        }
        else
            this.broadcastLobby();
    } }
    private async end(reason: string): Promise<void> { const s = this.current(); if (!s || s.phase === 'closed')
        return; await this.drainEffects(); this.store.closeSession(s.id, reason); this.runtime.stop(); this.state.view = null; this.broadcastLobby(); }
    private async closeLocalUnknown(reason: string, sessionId?:string): Promise<void> { const p = await this.game.authoritativeProfile(); for (const s of p.party?.sessions ?? [])
        if (s.status === 'active' && (!sessionId||s.sessionId===sessionId)) {
            const complete = s.consumes.length === 0 && !s.supplyEvent;
            const result = await this.game.personalParty({ type: 'party-close', sessionId: s.sessionId, closeId: s.sessionId + ':local-close', reason, ...(complete ? { consumeHighwater: 0, rewardHighwater: s.rewardReceipts.length, supplyActivated: false } : {}) });
            if (this.local?.sessionId === s.sessionId)
                this.local = result.session;
        } }
    setPresentation(active: boolean): void { if (this.active === active)
        return; this.active = active; if (this.room.state.role === 'host')
        this.runtime.presentation(active || [...this.peerActive].some(([id, active]) => active && this.online(id)));
    else if (this.state.sessionId && this.room.state.status === 'joined')
        this.room.sendPartyToHost({ type: 'party-field-v1', op: 'active', sessionId: this.state.sessionId, active }); }
    /** Before room transport leave and before GameRuntime.close. Never called from RoomService's serial callback. */
    beforeLeave(): Promise<void> { return this.task(async () => { await this.ready; if (this.room.state.role === 'host') {
        await this.end('房主结束共斗');
        await this.pump();
    }
    else {
        if (this.local)
            this.room.sendPartyToHost({ type: 'party-field-v1', op: 'return', sessionId: this.local.sessionId, capability: this.local.capability });
        await this.closeLocalUnknown('离开好友房间');
    } this.state.view = null; this.emit(); }); }
    close(): Promise<void> { return this.task(async () => { if (this.disposed)
        return; await this.ready; if (this.room.state.role === 'host') {
        await this.end('房主退出应用');
        await this.pump();
    } await this.closeLocalUnknown('应用退出，未完成结算保留'); this.quitting = true; clearInterval(this.timer); this.detach(); await this.runtime.close(); this.disposed = true; }); }
    dispose(): void { if (this.disposed)
        return; try {
        const current = this.current();
        if (current && current.phase !== 'closed')
            this.store.closeSession(current.id, '应用已关闭，保留旧结算');
    }
    catch { /* The last durable activation/outbox remains authoritative on restart. */ } this.quitting = true; this.disposed = true; clearInterval(this.timer); this.detach(); this.runtime.dispose(); }
}
