import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { initialProfile, parseProfile, initialAtelier, PROFILE_MAX_BYTES, personalParty, type Profile } from '../packages/solo-core';
import { prepareImportedProfile } from '../apps/desktop/profile-import';
import { GameStore } from '../apps/desktop/game-store';
import { workerFixture } from './p7-worker-fixture';
import { PartyFieldStore } from '../apps/desktop/party-field-store';
import { defaultLoadout } from '../packages/field-world';
import { parsePartyWire, parsePartyCommand } from '../packages/protocol/party-field';
const host = '0123456789abcdef0123456789abcdef', sessionId = host + ':1', cap = 'a'.repeat(64), prep = { type: 'party-prepare', sessionId, prepareId: 'prepare-0001', budget: 3, supplyId: null } as const;
function fresh() { const p = initialProfile(Date.now()); p.job = 'keeper'; p.bag.ration = 12; return p; }
const reward = { coins: 4, xp: 6, gel: 1, materials: { bone: 1 }, ore: 0, guardian: true };
function folder(t: any) { const f = fs.mkdtempSync('/private/tmp/pixelstreet-party0190-fault-'); fs.writeFileSync(path.join(f, 'PARTY0190-OWNED'), String(process.pid)); t.after(() => fs.rmSync(f, { recursive: true, force: true })); return f; }
test('actual Worker prepare/consume/reward is durable before ACK, dropped reply/restart dedupe, public state private redaction', async (t) => { const dir = folder(t); fs.writeFileSync(path.join(dir, 'profile.json'), JSON.stringify(fresh())); let f = workerFixture(dir); await f.game.ready; try {
    const prepared: any = await f.game.request('personal-party', { personal: prep });
    assert.match(prepared.session.capability, /^[a-f0-9]{64}$/);
    assert.equal(f.game.state.profile.party, undefined);
    assert.ok(!JSON.stringify(f.game.state).includes(prepared.session.capability));
    const cost = { type: 'party-consume', sessionId, eventId: 'cost-1', consumeSeq: 1, kind: 'encounter', amount: 1 };
    await f.game.request('personal-party', { personal: cost });
    await f.close();
    f = workerFixture(dir);
    await f.game.ready;
    await f.game.request('personal-party', { personal: cost });
    const q = { type: 'party-reward', sessionId, eventId: 'reward-1', rewardSeq: 1, package: reward };
    await f.game.request('personal-party', { personal: q });
    await f.game.request('personal-party', { personal: q });
    const disk: Profile = JSON.parse(fs.readFileSync(path.join(dir, 'profile.json'), 'utf8'));
    assert.equal(disk.bag.ration, 9);
    assert.equal(disk.party!.sessions[0].consumes.length, 1);
    assert.equal(disk.party!.sessions[0].rewardReceipts.length, 1);
    assert.equal(disk.bag.gel, 1);
    assert.equal(disk.fieldProgress!.challenge.guardianClears, 1);
    assert.equal(disk.totals.wins, 1);
    assert.equal(f.game.state.profile.party, undefined);
}
finally {
    await f.close();
} });
test('actual Worker save fault sends no ACK/no new state and personal retry succeeds after filesystem recovery', async (t) => { const dir = folder(t); fs.writeFileSync(path.join(dir, 'profile.json'), JSON.stringify(fresh())); const f = workerFixture(dir); await f.game.ready; try {
    await f.game.request('personal-party', { personal: prep });
    const before = fs.readFileSync(path.join(dir, 'profile.json'), 'utf8'), fault = path.join(dir, `profile.json.bak.tmp-${process.pid}`);
    fs.mkdirSync(fault);
    await assert.rejects(f.game.request('personal-party', { personal: { type: 'party-consume', sessionId, eventId: 'cost-1', consumeSeq: 1, kind: 'mining', amount: 1 } }), /保存失败/);
    assert.equal(fs.readFileSync(path.join(dir, 'profile.json'), 'utf8'), before);
    assert.equal(f.game.state.status, 'blocked');
    fs.rmdirSync(fault);
    await f.game.request('personal-party', { personal: { type: 'party-consume', sessionId, eventId: 'cost-1', consumeSeq: 1, kind: 'mining', amount: 1 } });
    assert.equal(f.game.state.status, 'ready');
    const p = await f.game.authoritativeProfile();
    assert.equal(p.party.sessions[0].consumes.length, 1);
}
finally {
    await f.close();
} });
test('import retains this installation ledger/pending, strips foreign capability, active prepare blocks import', () => { let p = personalParty(fresh(), prep, cap).profile; assert.throws(() => prepareImportedProfile(fresh(), p, Date.now()), /回营/); p = personalParty(p, { type: 'party-close', sessionId, closeId: 'close-1', reason: 'done', consumeHighwater: 0, rewardHighwater: 0, supplyActivated: false }).profile; let foreign = personalParty(fresh(), { ...prep, sessionId: host + ':2' }, 'b'.repeat(64)).profile; foreign = personalParty(foreign, { type: 'party-close', sessionId: host + ':2', closeId: 'close-2', reason: 'done', consumeHighwater: 0, rewardHighwater: 0, supplyActivated: false }).profile; const imported = prepareImportedProfile(foreign, p, Date.now()); assert.deepEqual(imported.party, p.party); assert.ok(!JSON.stringify(imported).includes('b'.repeat(64))); });
test('refund capacity includes ration production/held supply and manufacturing queues', () => { let p = fresh(); p.bag.ration = 1e6; p.atelier = initialAtelier(); p.atelier.stock['herbal-bandage'] = 9999; p = personalParty(p, { ...prep, supplyId: 'herbal-bandage' }, cap).profile; const bad = structuredClone(p); bad.bag.ration++; assert.throws(() => parseProfile(bad), /预留|退款/); const supply = structuredClone(p); supply.atelier!.stock['herbal-bandage']++; assert.throws(() => parseProfile(supply), /预留/); p = personalParty(p, { type: 'party-close', sessionId, closeId: 'close-1', reason: 'cancel', consumeHighwater: 0, rewardHighwater: 0, supplyActivated: false }).profile; assert.equal(p.bag.ration, 1e6); assert.equal(p.atelier!.stock['herbal-bandage'], 9999); });
test('64 legitimate pending packages roundtrip one atomic Profile below shared512KiB; limit never drops reward', t => { const dir = folder(t); let p = fresh(); p.bag.ration = 1000; p.bag.gel = 100; for (let i = 1; i <= 64; i++) {
    const s = host + ':' + i;
    p = personalParty(p, { ...prep, sessionId: s }, cap).profile;
    p = personalParty(p, { type: 'party-consume', sessionId: s, eventId: s + ':consume', consumeSeq: 1, kind: 'encounter', amount: 1 }).profile;
    p = personalParty(p, { type: 'party-reward', sessionId: s, eventId: s + ':reward', rewardSeq: 1, package: reward }).profile;
    p = personalParty(p, { type: 'party-close', sessionId: s, closeId: s + ':close', reason: 'done', consumeHighwater: 1, rewardHighwater: 1, supplyActivated: false }).profile;
} assert.equal(p.party!.pending.length, 64); const bytes = Buffer.byteLength(JSON.stringify(p)); assert.ok(bytes < PROFILE_MAX_BYTES); const store = new GameStore(dir); store.save(p); assert.deepEqual(new GameStore(dir).value, p); assert.throws(() => personalParty(p, { ...prep, sessionId: host + ':65' }, cap), /待领取已满/); assert.equal(p.party!.pending.length, 64); });
test('Host real file journal activation separates charged-but-unactivated from activated on crash, save fault leaves original', t => { const dir = folder(t), store = new PartyFieldStore(dir), sid = store.create(host); store.update(v => v.sessions[0].recipients.push({ id: host, capability: cap, prepareId: 'prepare-001', loadout: { ...defaultLoadout(), budget: 3 }, pendingCount: 0, deliveries: [{ request: { type: 'party-consume', sessionId: sid, eventId: 'consume-1', consumeSeq: 1, kind: 'encounter', amount: 1 }, acked: false, activated: false }], closing: false, closedAck: false })); const unactivated = new PartyFieldStore(dir); unactivated.closeSession(sid, 'restart'); assert.equal((unactivated.value.sessions[0].recipients[0].deliveries.at(-1)!.request as any).consumeHighwater, 0); const other = folder(t), activated = new PartyFieldStore(other), sid2 = activated.create(host); activated.update(v => v.sessions[0].recipients.push({ ...store.value.sessions[0].recipients[0], deliveries: [{ request: { type: 'party-consume', sessionId: sid2, eventId: 'consume-1', consumeSeq: 1, kind: 'encounter', amount: 1 }, acked: true, activated: true }] })); const fault = activated.file + `.bak.tmp-${process.pid}`; fs.mkdirSync(fault); const before = fs.readFileSync(activated.file, 'utf8'); assert.throws(() => activated.closeSession(sid2, 'restart')); assert.equal(fs.readFileSync(activated.file, 'utf8'), before); fs.rmdirSync(fault); activated.closeSession(sid2, 'restart'); assert.equal((activated.value.sessions[0].recipients[0].deliveries.at(-1)!.request as any).consumeHighwater, 1); });
test('strict wire/Renderer command parsers reject identity/economy injection and noncanonical capabilities', () => { assert.throws(() => parsePartyWire({ type: 'party-field-v1', op: 'input', sessionId, seq: 1, floor: 0, intent: { kind: 'kill', damage: 999 } })); assert.throws(() => parsePartyWire({ type: 'party-field-v1', op: 'input', sessionId, seq: 1, floor: 0, intent: { kind: 'return' }, actorId: host })); assert.throws(() => parsePartyCommand({ type: 'party-control', epoch: 1, roomEpoch: 1, sessionId, floor: 0, intent: { kind: 'return' }, capability: cap })); assert.throws(() => parsePartyWire({ type: 'party-field-v1', op: 'economic', sessionId, capability: cap, request: prep })); assert.throws(() => parsePartyWire({ type: 'party-field-v1', op: 'resume', sessions: [{ sessionId, capability: 'bad' }] })); });
test('invalid Host journal blocks only new co-op operations and preserves exact original file',t=>{const dir=folder(t),file=path.join(dir,'party-host.json');fs.writeFileSync(file,'bad journal preserved');const store=new PartyFieldStore(dir);assert.match(store.blocked,/原文件保留/);assert.throws(()=>store.create(host),/原文件保留/);assert.equal(fs.readFileSync(file,'utf8'),'bad journal preserved');});
test('maximum bounded personal extension with64 complete sessions and64 pending packages fits atomic512KiB',t=>{const dir=folder(t);let p=fresh();p.bag.ration=10000;let event=0;for(let s=1;s<=64;s++){const sid=s.toString(16).padStart(32,'0')+':1';p=personalParty(p,{...prep,sessionId:sid,budget:9},cap).profile;for(let n=1;n<=9;n++){event++;p.bag.gel=event>512?100:0;p.leisure.materials.ore=0;if(p.fieldProgress)for(const k of ['bone','curseCrystal','toughHide'] as const)p.fieldProgress.materials[k]=0;p=personalParty(p,{type:'party-consume',sessionId:sid,eventId:sid+':c'+n,consumeSeq:n,kind:'encounter',amount:1}).profile;p=personalParty(p,{type:'party-reward',sessionId:sid,eventId:sid+':r'+n,rewardSeq:n,package:{coins:1000,xp:1000,gel:1,ore:1000,materials:{bone:100,curseCrystal:100,toughHide:100},guardian:true}}).profile;}p=personalParty(p,{type:'party-close',sessionId:sid,closeId:sid+':close',reason:'bounded fixture',consumeHighwater:9,rewardHighwater:9,supplyActivated:false}).profile;}assert.equal(p.party!.sessions.length,64);assert.equal(p.party!.pending.length,64);const bytes=Buffer.byteLength(JSON.stringify(p));t.diagnostic('maximum bounded extension fixture '+bytes+' bytes');assert.ok(bytes<PROFILE_MAX_BYTES);const store=new GameStore(dir);store.save(p);assert.deepEqual(new GameStore(dir).value,p);});
