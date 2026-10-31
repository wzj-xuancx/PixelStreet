import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { GameRuntime } from '../apps/desktop/game-runtime';
import { ActionRuntime } from '../apps/desktop/action-runtime';
import { RoomService } from '../apps/desktop/room-service';
import type { ActionState } from '../packages/action-core';
import type { ActionSource } from '../packages/protocol/action';

type PeerHarness = {
  index: number;
  folder: string;
  game: GameRuntime;
  action: ActionRuntime;
  room: RoomService;
};

const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};
async function until(check: () => boolean, description: string, timeoutMs = 15_000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (check()) return;
    await pause(40);
  }
  throw new Error(`Timed out waiting for ${description}`);
}
const hashFile = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const safeId = (id: string) => id.slice(0, 8);
function bagSnapshot(peer: PeerHarness): string {
  const bag = peer.game.state.profile?.bag;
  assert(bag, `peer ${peer.index} profile not ready`);
  return JSON.stringify(bag);
}
function memberFor(peer: PeerHarness, id: string) {
  return peer.room.state.members.find(member => member.id === id);
}

async function main(): Promise<void> {
  await app.whenReady();
  const root = fs.mkdtempSync(path.join(__dirname, 'run-'));
  const peers: PeerHarness[] = [];
  const notes: Record<string, unknown> = {};
  let success = false;
  try {
    for (let index = 0; index < 4; index++) {
      const folder = path.join(root, `peer-${index}`, 'solo');
      fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
      let room: RoomService | undefined;
      const game = new GameRuntime(folder, () => room?.gameUpdated(), false);
      const action = new ActionRuntime(folder, game, () => room?.actionUpdated());
      room = new RoomService(folder, game, action, () => {});
      peers.push({ index, folder, game, action, room });
    }

    await Promise.all(peers.map(peer => peer.room.ready));
    await until(() => peers.every(peer => peer.game.state.status === 'ready' && peer.action.state.status === 'ready'), 'four independent production worker pairs');
    assert(new Set(peers.map(peer => peer.room.state.localPlayerId)).size === 4, 'the four temporary profiles must have distinct installation identities');

    // Give only the host distinct inventory using real GameRuntime intents. Nothing here edits profile fields.
    const host = peers[0];
    const apply = async (action: { type: string; [key: string]: unknown }, suffix: string): Promise<void> => {
      const profile = host.game.state.profile;
      assert(profile, 'host game profile not ready');
      await host.game.command({ sequence: profile.sequence + 1, requestId: `room4-${suffix}-0001`, action } as never);
    };
    await apply({ type: 'apply-job' }, 'job');
    await apply({ type: 'craft', recipe: 'ration', count: 1 }, 'ration');
    await until(() => host.game.state.profile?.queue === null && host.game.state.profile?.bag.ration === 1, 'host-only ration craft', 12_000);
    const bagsBefore = peers.map(peer => bagSnapshot(peer));
    assert(bagsBefore[0] !== bagsBefore[1] && bagsBefore.slice(1).every(value => value === bagsBefore[1]), 'temporary profiles need distinct host inventory and independent guest inventories');

    await host.room.hostRoom('P3 host', '127.0.0.1');
    const invitation = host.room.invitation();
    await peers[1].room.joinRoom('P3 bow', invitation);
    await peers[2].room.joinRoom('P3 scatter', invitation);
    await until(() => host.room.state.members.length === 3 && host.room.state.members.every(member => member.online), 'host plus two real TCP guests');
    await peers[1].room.setWeapon('bow');
    await peers[2].room.setWeapon('scatter');
    await until(() => memberFor(host, peers[1].room.state.localPlayerId)?.weapon === 'bow' && memberFor(host, peers[2].room.state.localPlayerId)?.weapon === 'scatter', 'host receives both weapon acknowledgments');
    await peers[0].room.setLocalActive(true);
    await peers[1].room.setLocalActive(true);
    await peers[2].room.setLocalActive(true);
    await until(() => peers.slice(0, 3).every(peer => peer.game.state.partySize === 3), 'party size 3 on all connected GameWorkers');
    await until(() => host.room.state.members.filter(member => member.available).length === 3, 'three members prepared for next run');
    const first = await host.room.start('wand');
    const firstKey = host.room.state.runKey;
    assert(firstKey, 'first run key missing');
    await until(() => peers.slice(0, 3).every(peer =>
      peer.room.state.runKey?.hostId === firstKey.hostId &&
      peer.room.state.runKey?.sequence === firstKey.sequence &&
      memberFor(peer, peer.room.state.localPlayerId)?.inRun === true), 'initial run key and participant roster');
    await until(() => host.room.state.members.filter(member => member.active && member.inRun).length === 3, 'fresh active acknowledgments from host plus two guests');
    const firstRun = host.action.state.run;
    assert(firstRun, 'host run absent');
    const firstParticipants = firstRun.players.map(player => player.id);
    const firstWeapons = Object.fromEntries(firstRun.players.map(player => [safeId(player.id), player.weapon]));
    assert(firstRun.players.length === 3, `first run roster should be three, found ${firstRun.players.length}`);
    assert(firstRun.players.find(player => player.id === peers[0].room.state.localPlayerId)?.weapon === 'wand', 'host weapon was not applied');
    assert(firstRun.players.find(player => player.id === peers[1].room.state.localPlayerId)?.weapon === 'bow', 'guest bow was not applied');
    assert(firstRun.players.find(player => player.id === peers[2].room.state.localPlayerId)?.weapon === 'scatter', 'guest scatter was not applied');
    assert(firstParticipants.every(id => peers.slice(0, 3).some(peer => peer.room.state.localPlayerId === id)), 'first run contains an unknown participant');
    notes.firstRun = { key: { hostId: safeId(firstKey.hostId), sequence: firstKey.sequence }, rosterSize: firstRun.players.length, weapons: firstWeapons, partySizes: peers.slice(0, 3).map(peer => peer.game.state.partySize), activeCount: 3 };

    // A fourth member joins after the run has begun. It receives no mirror and cannot issue current-run input.
    await peers[3].room.joinRoom('P3 late', invitation);
    await until(() => host.room.state.members.length === 4 && host.room.state.members.every(member => member.online), 'four real TCP members');
    await until(() => peers.every(peer => peer.game.state.partySize === 4), 'party size 4 on all connected GameWorkers');
    assert(!host.action.state.run?.players.some(player => player.id === peers[3].room.state.localPlayerId), 'late joiner was inserted into the current authoritative run');
    assert(peers[3].action.state.run === null && peers[3].action.state.source === null, 'late joiner received a current-run action mirror');
    await peers[3].room.setLocalActive(true);
    await until(() => !!memberFor(host, peers[3].room.state.localPlayerId), 'late member roster');
    assert(memberFor(host, peers[3].room.state.localPlayerId)?.inRun === false && memberFor(host, peers[3].room.state.localPlayerId)?.active === false, 'late joiner became active in the current run');
    let lateInputRejected = false;
    try { await peers[3].room.input({ type: 'move', x: 420, y: 260 }); }
    catch { lateInputRejected = true; }
    assert(lateInputRejected, 'late joiner current-run input was not rejected');

    // When every member is temporarily away, the authority pauses the shared tick.
    await Promise.all(peers.map(peer => peer.room.setLocalActive(false)));
    await until(() => host.action.state.run?.paused === true && host.room.state.members.every(member => !member.active), 'all members temporarily inactive');
    const frozenTick = host.action.state.run!.tick;
    const frozenHp = host.action.state.run!.players.map(player => player.hp);
    await pause(700);
    assert(host.action.state.run?.tick === frozenTick, 'authoritative tick advanced while all members were inactive');
    assert(JSON.stringify(host.action.state.run?.players.map(player => player.hp)) === JSON.stringify(frozenHp), 'player HP changed while all members were inactive');
    notes.lateJoinAndPause = { memberCount: 4, partySizes: peers.map(peer => peer.game.state.partySize), firstRunRosterStill: host.action.state.run!.players.length, lateInputRejected, allInactiveFrozenTick: frozenTick, frozenHpUnchanged: true };

    // Resume the three current participants and play through only normal room input intents.
    await Promise.all(peers.slice(0, 3).map(peer => peer.room.setLocalActive(true)));
    await until(() => host.room.state.members.filter(member => member.active && member.inRun).length === 3 && host.action.state.run?.paused === false, 'three current-run members resume');
    const lastInputAtByPlayer = new Map<string, number>();
    const upgradeHandled = new Set<number>();
    let stageReached = 0;
    const runStartedAt = Date.now();
    const runDeadline = runStartedAt + 12 * 60_000;
    while (Date.now() < runDeadline) {
      const run: ActionState | null = host.action.state.run;
      assert(run, 'host action worker lost its run');
      stageReached = Math.max(stageReached, run.stage + 1);
      if (run.phase === 'won' || run.phase === 'lost') break;
      if (run.phase === 'upgrade') {
        if (!upgradeHandled.has(run.stage)) {
          const choice = run.upgradeChoices[0];
          assert(choice, 'upgrade phase has no public choice');
          await host.room.input({ type: 'upgrade', choice });
          upgradeHandled.add(run.stage);
        }
      } else if (run.phase === 'playing') {
        const enemies = run.enemies.filter(enemy => enemy.hp > 0);
        for (const peer of peers.slice(0, 3)) {
          const id = peer.room.state.localPlayerId;
          const player = run.players.find(candidate => candidate.id === id);
          if (!player?.alive || !memberFor(host, id)?.active || !enemies.length) continue;
          const currentTarget = run.enemies.find(enemy => enemy.id === player.lockedEnemy && enemy.hp > 0);
          if (!currentTarget) {
            const now = Date.now();
            if (now - (lastInputAtByPlayer.get(id) ?? 0) < 400) continue;
            const target = [...enemies].sort((a, b) => Math.hypot(a.x - player.x, a.y - player.y) - Math.hypot(b.x - player.x, b.y - player.y))[0];
            lastInputAtByPlayer.set(id, now);
            try { await peer.room.input({ type: 'lock', enemyId: target.id }); }
            catch { /* target may die between the observed snapshot and this valid player intent */ }
          }
          if (player.shieldReady <= run.tick && player.hp < player.maxHp && player.shield < 20 && nowSkillDue(id)) {
            setSkillDue(id);
            try { await peer.room.input({ type: 'skill', skill: 'ward' }); }
            catch { /* another authoritative tick may have moved the cooldown */ }
          }
        }
      }
      await pause(150);
    }
    const naturalResult = host.action.state.run;
    assert(naturalResult && (naturalResult.phase === 'won' || naturalResult.phase === 'lost'), `first run did not reach a natural terminal phase within 12 minutes (stage ${stageReached})`);
    const reward = { ...naturalResult.reward };
    const terminalPhase = naturalResult.phase;
    const rewardBaselines = peers.map(peer => ({ coins: peer.game.state.profile!.coins, xp: peer.game.state.profile!.xp }));
    await host.room.settle();
    await until(() => peers.slice(1, 3).every(peer => peer.action.state.run && ['won', 'lost'].includes(peer.action.state.run.phase)), 'guests receive the host terminal snapshot');
    await Promise.all(peers.slice(1, 3).map(peer => peer.room.settle()));
    await until(() => peers.slice(1, 3).every(peer => peer.action.state.settled), 'both guest reward claims committed locally');
    try {
      await until(() => peers.slice(0, 3).every(peer => {
        const member = memberFor(host, peer.room.state.localPlayerId);
        return member?.returned === true && member.available;
      }) && memberFor(host, peers[3].room.state.localPlayerId)?.online === true &&
        memberFor(host, peers[3].room.state.localPlayerId)?.available === true &&
        memberFor(host, peers[3].room.state.localPlayerId)?.inRun === false &&
        memberFor(host, peers[3].room.state.localPlayerId)?.returned === false, 'three run participants returned; late member remains available for next run');
    } catch {
      const diagnostic = {
        hostMembers: host.room.state.members.map(member => ({ id: safeId(member.id), online: member.online, inRun: member.inRun, active: member.active, available: member.available, returned: member.returned })),
        peers: peers.map(peer => ({ index: peer.index, roomStatus: peer.room.state.status, gamePartySize: peer.game.state.partySize, actionSettled: peer.action.state.settled, actionPhase: peer.action.state.run?.phase ?? null, actionClaim: peer.game.state.profile?.actionClaim ?? null, roomError: peer.room.state.error })),
      };
      throw new Error(`Four members did not become returned and prepared: ${JSON.stringify(diagnostic)}`);
    }
    const rewardChecks = peers.map((peer, index) => {
      const profile = peer.game.state.profile!;
      const delta = { coins: profile.coins - rewardBaselines[index].coins, xp: profile.xp - rewardBaselines[index].xp };
      if (index < 3) {
        assert(delta.coins === reward.coins && delta.xp === reward.xp, `run participant ${peer.index} did not receive its own confirmed reward exactly once: ${JSON.stringify(delta)} vs ${JSON.stringify(reward)}`);
        if (index > 0) assert(profile.roomClaims.some(claim => claim.hostId === firstKey.hostId && claim.sequence === firstKey.sequence), `guest ${peer.index} lacks durable host/run claim`);
      } else {
        assert(delta.coins === 0 && delta.xp === 0, `late nonparticipant ${peer.index} incorrectly received first-run reward: ${JSON.stringify(delta)}`);
        assert(!profile.roomClaims.some(claim => claim.hostId === firstKey.hostId && claim.sequence === firstKey.sequence), `late nonparticipant ${peer.index} incorrectly received a first-run claim`);
      }
      assert(bagSnapshot(peer) === bagsBefore[index], `peer ${peer.index} inventory changed during shared action battle`);
      return { peer: safeId(peer.room.state.localPlayerId), delta, participated: index < 3, remoteClaim: index > 0 && index < 3 };
    });
    notes.firstRunFinish = { terminalPhase, stageReached, elapsedMs: Date.now() - runStartedAt, reward, rewardChecks, materialsAndRationsUnchanged: true };

    // Re-arm all four and start another room run. This proves a late joiner enters only the next run after a fresh ack.
    await until(() => host.room.state.members.filter(member => member.online && member.available).length === 4, 'all four members available after settlement');
    const second = await host.room.start('wand');
    const secondKey = host.room.state.runKey;
    assert(secondKey && secondKey.sequence > firstKey.sequence, 'second run key did not advance');
    await until(() => peers.every(peer =>
      peer.room.state.runKey?.hostId === secondKey.hostId &&
      peer.room.state.runKey?.sequence === secondKey.sequence &&
      memberFor(peer, peer.room.state.localPlayerId)?.inRun === true), 'all four members receive second run roster');
    await Promise.all(peers.map(peer => peer.room.setLocalActive(true)));
    try {
      await until(() => host.room.state.members.filter(member => member.active && member.inRun).length === 4, 'fresh active acknowledgment from all four members');
    } catch {
      const diagnostic = {
        hostMembers: host.room.state.members.map(member => ({ id: safeId(member.id), online: member.online, inRun: member.inRun, active: member.active, available: member.available, returned: member.returned })),
        peers: peers.map(peer => ({ index: peer.index, roomStatus: peer.room.state.status, roomKey: peer.room.state.runKey ? { hostId: safeId(peer.room.state.runKey.hostId), sequence: peer.room.state.runKey.sequence } : null, localMember: memberFor(peer, peer.room.state.localPlayerId) ? { inRun: memberFor(peer, peer.room.state.localPlayerId)!.inRun, active: memberFor(peer, peer.room.state.localPlayerId)!.active, available: memberFor(peer, peer.room.state.localPlayerId)!.available, returned: memberFor(peer, peer.room.state.localPlayerId)!.returned } : null, actionSource: peer.action.state.source ? { role: peer.action.state.source.role, sequence: peer.action.state.source.sequence } : null, actionPhase: peer.action.state.run?.phase ?? null, actionSettled: peer.action.state.settled, roomError: peer.room.state.error })),
      };
      throw new Error(`Four-member next-run active acknowledgment timed out: ${JSON.stringify(diagnostic)}`);
    }
    const secondRun = host.action.state.run;
    assert(secondRun?.players.length === 4, `second run roster should be four, found ${secondRun?.players.length ?? 0}`);
    assert(peers.every(peer => secondRun.players.some(player => player.id === peer.room.state.localPlayerId)), 'second run omitted one of the four peers');
    const lateSource = peers[3].action.state.source as ActionSource | null;
    assert(lateSource?.sequence === secondKey.sequence && lateSource.role === 'guest', 'late member did not receive the new run mirror');
    notes.secondRun = { key: { hostId: safeId(secondKey.hostId), sequence: secondKey.sequence }, rosterSize: secondRun.players.length, activeCount: 4, partySizes: peers.map(peer => peer.game.state.partySize) };

    // Confirm P3 gameplay intents do not mutate each member's local materials or provisions.
    assert(peers.every((peer, index) => bagSnapshot(peer) === bagsBefore[index]), 'a peer inventory changed while the next room run was active');
    const probe = {
      processArch: process.arch,
      electronVersion: process.versions.electron,
      hostId: safeId(host.room.state.localPlayerId),
      workerSha256: {
        game: hashFile(path.join(__dirname, 'game-worker.cjs')),
        action: hashFile(path.join(__dirname, 'action-worker.cjs')),
      },
      workerCopiesMatchDist: ['game-worker.cjs', 'action-worker.cjs'].every(name =>
        hashFile(path.join(__dirname, name)) === hashFile(path.resolve(__dirname, '../../../../dist', name))),
    };
    notes.probe = probe;
    assert(probe.workerCopiesMatchDist === true, 'probe worker copies differ from current production dist workers');
    success = true;
  } finally {
    await Promise.allSettled(peers.map(peer => peer.room.close()));
    await Promise.allSettled(peers.map(peer => peer.action.close()));
    await Promise.allSettled(peers.map(peer => peer.game.close()));
    fs.rmSync(root, { recursive: true, force: true });
  }
  const result = { status: success ? 'PASS' : 'FAIL', scope: 'single Electron process; four isolated RoomService/GameRuntime/ActionRuntime sets; real production workers; actual 127.0.0.1 TCP; no BrowserWindow', notes };
  fs.writeFileSync(path.join(__dirname, 'room-four-peer-luna-result.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify(result));

  function nowSkillDue(id: string): boolean { return Date.now() - (lastSkillAtByPlayer.get(id) ?? 0) >= 1000; }
  function setSkillDue(id: string): void { lastSkillAtByPlayer.set(id, Date.now()); }
}

const lastSkillAtByPlayer = new Map<string, number>();
void main().then(() => app.quit()).catch(error => {
  const result = { status: 'FAIL', error: String(error instanceof Error ? error.message : error).slice(0, 2000), stack: error instanceof Error ? error.stack?.split('\n').slice(0, 12).join('\n') : '' };
  fs.writeFileSync(path.join(__dirname, 'room-four-peer-luna-result.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
  console.error(JSON.stringify(result));
  app.exit(1);
});
