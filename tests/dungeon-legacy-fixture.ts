import type {DungeonRun} from '../packages/dungeon-core';
import {parseDungeonRun,createEncounter} from '../packages/dungeon-core';
import frozen042 from './fixtures/legacy042-fresh.json';
/** Bundled genuine042 fixed map; seed metadata is retagged for caller identity, not old-map seed coverage.
 * The exported source must not depend on the former developer's sibling checkout.
 * The single-room F1 constructor keeps the legacy vocabulary; the production16-room floor is never projected.
 */
export function legacyCompatibleFixture(run:DungeonRun):DungeonRun {
 const old=run.rooms.some(q=>q.kind==='entrance')?structuredClone(frozen042.run):legacyDungeonFixture(createEncounter(run.seed));
 old.seed=run.seed;old.runId=run.runId;old.rng=run.seed||0x9e3779b9;
 const migrated=parseDungeonRun(old);if(!migrated)throw Error('Bundled042 fixture rejected');return migrated;
}
/** Explicit test-only legacy projection after retaining a true old constructor map. */
export function legacyDungeonFixture(run:DungeonRun,version:2|3=3){const floor=run.rooms.some(q=>q.kind==='entrance'),copy=run.growth.mode==='legacy'||!floor?structuredClone(run):legacyCompatibleFixture(run);if(run.growth.mode!=='legacy'&&!floor)copy.player=structuredClone(run.player);
 for(const item of [...copy.player.weaponSlots,...copy.rooms.flatMap(room=>[...room.ground.map(g=>g.weapon),...room.merchantStock.map(o=>o.weapon)])])if(item)delete (item as any).form;
 for(const shot of copy.projectiles){delete (shot as any).weaponId;delete (shot as any).sourceKind;delete (shot as any).generation;}
 const {combat,growth,rooms,...body}=copy;return{...body,version,rooms:rooms.map(room=>{const {spawns,...legacy}=room;return legacy;})};}
