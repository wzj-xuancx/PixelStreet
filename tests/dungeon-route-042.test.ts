import test from 'node:test';
import assert from 'node:assert/strict';
import {makeFloor,doorApproachRect} from '../packages/dungeon-core/map';
import type {RoomState} from '../packages/dungeon-core/types';

function route(rooms:RoomState[],to:string,avoid=''):string[]|null {
  const queue=[['entrance']],seen=new Set<string>();
  while(queue.length){const trail=queue.shift()!,id=trail.at(-1)!;if(id===avoid||seen.has(id))continue;if(id===to)return trail;seen.add(id);for(const d of rooms.find(r=>r.id===id)!.doors)queue.push([...trail,d.to]);}return null;
}
const overlaps=(a:{x:number;y:number;width:number;height:number},b:{x:number;y:number;width:number;height:number})=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;

test('050: 256 randomized floors reserve altar then two complete combat rooms then boss, with optional front branches',()=>{
  const graphs=new Set<string>(),positions=new Set<string>(),layouts=new Set<string>();
  for(let seed=0;seed<256;seed++){
    const rooms=makeFloor(seed);assert.equal(rooms.length,16,`seed ${seed}`);assert.deepEqual(makeFloor(seed),rooms);
    assert.equal(new Set(rooms.map(r=>`${r.gridX},${r.gridY}`)).size,16);
    assert.deepEqual(route(rooms,'boss'),['entrance','crossroads','battle-a','battle-b','battle-c','battle-d','battle-e','battle-f','altar','depth-a','depth-b','boss']);
    for(const checkpoint of ['battle-a','battle-b','battle-c','battle-d','battle-e','battle-f','altar','depth-a','depth-b'])assert.equal(route(rooms,'boss',checkpoint),null,`no ${checkpoint} bypass seed ${seed}`);
    assert.ok(route(rooms,'boss','elite'));assert.ok(rooms.find(r=>r.id==='crossroads')!.doors.length>=3);
    for(const id of ['treasure','spring','merchant','elite']){const branch=rooms.find(r=>r.id===id)!;assert.equal(branch.doors.length,1);assert.ok(['crossroads','battle-a','battle-b','battle-c','battle-d','battle-e','battle-f'].includes(branch.doors[0].to));}
    for(const id of ['depth-a','depth-b']){const r=rooms.find(r=>r.id===id)!;assert.equal(r.kind,'combat');assert.equal(r.totalWaves,2);assert.equal(r.encounterStarted,false);assert.equal(r.cleared,false);}
    for(const r of rooms){assert.ok(route(rooms,r.id));assert.equal(new Set(r.doors.map(d=>d.side)).size,r.doors.length);for(const d of r.doors){const b=rooms.find(v=>v.id===d.to)!;assert.equal(Math.abs(r.gridX-b.gridX)+Math.abs(r.gridY-b.gridY),1);assert.ok(b.doors.some(back=>back.to===r.id&&back.side===({N:'S',S:'N',E:'W',W:'E'} as const)[d.side]));const apron=doorApproachRect(r,d.side);for(const o of r.obstacles)assert.equal(overlaps(apron,{x:o.x-11,y:o.y-11,width:o.width+22,height:o.height+22}),false);}}
    graphs.add(rooms.map(r=>`${r.id}:${r.doors.map(d=>d.to).sort().join(',')}`).join('|'));
    positions.add(rooms.map(r=>`${r.id}:${r.gridX},${r.gridY}`).join('|'));
    layouts.add(rooms.map(r=>`${r.id}:${r.width}x${r.height}:${r.layoutId}`).join('|'));
  }
  assert.ok(graphs.size>=10,`${graphs.size} graphs`);assert.ok(positions.size>200);assert.ok(layouts.size>200);
});

import {createDungeon,currentRoom,roomDoors,roomFixtures,nearbyInteractions,dungeonInput,stepDungeon,parseDungeonRun,activeWeapon,evolutionInfo} from '../packages/dungeon-core';
import type {DungeonRun,WeaponKind} from '../packages/dungeon-core';
function chooseGrowth(r:DungeonRun):void {
  while(r.phase==='upgrade'){
    const candidate=r.choices.find(id=>!['power','haste','vitality'].includes(id))??'power';
    dungeonInput(r,{type:'upgrade',id:candidate,...(!['power','haste','vitality'].includes(candidate)&&!r.player.traits.includes(candidate as any)&&r.player.traits.length===3?{replaceSlot:2 as const}:{})});
  }
}
/** HP and doorway positioning are isolated logic fixtures. XP, choices, loot and evolution use production transactions. */
function clearFixture(r:DungeonRun):void {
  const room=currentRoom(r);let guard=0;
  while(!room.cleared&&guard++<3000){for(const e of room.enemies)e.hp=0;stepDungeon(r);chooseGrowth(r);}
  assert.equal(room.cleared,true);assert.ok(parseDungeonRun(r));
}
function throughFixture(r:DungeonRun,to:string):void {
  const room=currentRoom(r),door=roomDoors(r).find(d=>d.to===to);assert.ok(door);assert.equal(room.locked,false);
  r.player.x=door.side==='W'?35:door.side==='E'?room.width-35:room.width/2;
  r.player.y=door.side==='N'?35:door.side==='S'?room.height-35:room.height/2;
  dungeonInput(r,{type:'control',moveX:door.side==='W'?-1:door.side==='E'?1:0,moveY:door.side==='N'?-1:door.side==='S'?1:0,aimX:r.player.x,aimY:r.player.y,firing:false});stepDungeon(r);assert.equal(r.currentRoom,to);dungeonInput(r,{type:'control',moveX:0,moveY:0,aimX:r.player.x,aimY:r.player.y,firing:false});assert.ok(parseDungeonRun(r));
}
function waitForSpawnSettle(r:DungeonRun):void {const room=currentRoom(r);let guard=0;while((!room.enemies.length||room.spawns.pending.length>0)&&guard++<3000)stepDungeon(r);assert.ok(guard<3000,`${room.id} warning and settling queue`);}
function openStarter(r:DungeonRun):void {
  const chest=roomFixtures(r)[0];r.player.x=chest.x;r.player.y=chest.y;dungeonInput(r,{type:'interact',id:chest.id});
  const ground=currentRoom(r).ground[0];r.player.x=ground.x;r.player.y=ground.y;dungeonInput(r,{type:'interact',id:ground.id});assert.ok(activeWeapon(r));
}
test('050: real starter drops and six front-room rewards fund both compatible evolutions before two untouched fights and boss',()=>{
  for(const kind of ['fire','boomerang'] as WeaponKind[]){
    const seeds:number[]=[];
    for(let seed=0;seed<512&&seeds.length<8;seed++){const probe=createDungeon(seed);openStarter(probe);if(activeWeapon(probe)!.kind===kind)seeds.push(seed);}
    assert.equal(seeds.length,8);
    for(const seed of seeds){
      const r=createDungeon(seed);openStarter(r);const physicalId=activeWeapon(r)!.id;
      assert.equal(r.reward.xp,0);assert.equal(activeWeapon(r)!.level,1);
      throughFixture(r,'crossroads');for(const id of ['battle-a','battle-b','battle-c','battle-d','battle-e','battle-f']){throughFixture(r,id);clearFixture(r);if(activeWeapon(r)!.level<5)dungeonInput(r,{type:'strengthen'});}throughFixture(r,'altar');
      r.player.x=currentRoom(r).width/2;r.player.y=currentRoom(r).height/2;
      /* 0.5.0 wave budgets change cumulative XP; retain the route's functional Lv5/evolution checks below. */
      assert.equal(activeWeapon(r)!.id,physicalId);assert.equal(activeWeapon(r)!.level,5);assert.equal(r.essence,2);
      assert.equal(evolutionInfo(r).canEvolve,true);assert.equal(r.player.runes.length,0);
      const untouched=r.rooms.filter(v=>['depth-a','depth-b','boss'].includes(v.id));assert.equal(untouched.length,3);assert.ok(untouched.every(v=>!v.encounterStarted&&!v.cleared));
      dungeonInput(r,{type:'evolve',form:activeWeapon(r)!.kind==='fire'?'meteor':'blade-ring'});assert.equal(activeWeapon(r)!.evolved,true);assert.ok(parseDungeonRun(r));
      throughFixture(r,'depth-a');assert.equal(currentRoom(r).wave,1);clearFixture(r);assert.equal(currentRoom(r).wave,2);
      throughFixture(r,'depth-b');assert.equal(currentRoom(r).wave,1);clearFixture(r);assert.equal(currentRoom(r).wave,2);
      throughFixture(r,'boss');waitForSpawnSettle(r);assert.equal(currentRoom(r).enemies[0].kind,'boss');clearFixture(r);assert.equal(r.phase,'won');assert.ok(parseDungeonRun(r));
      const restored=parseDungeonRun(JSON.parse(JSON.stringify(r)));assert.deepEqual(restored,r);
    }
  }
});
