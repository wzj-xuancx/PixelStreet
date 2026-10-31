import {movementShape,SPAWN_SAFE_DISTANCE} from '../packages/dungeon-core';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createDungeon,currentRoom,doorTriggerRect,roomDoors,roomFixtures,discoveredRooms,nearbyInteractions,dungeonInput,stepDungeon,parseDungeonRun} from '../packages/dungeon-core';
import type {DungeonRun,RoomState} from '../packages/dungeon-core';

const step=(r:DungeonRun,n=1)=>{for(let i=0;i<n;i++)stepDungeon(r);};
const room=(r:DungeonRun,id:string)=>r.rooms.find(v=>v.id===id)!;
function route(rooms:RoomState[],from:string,to:string,avoid=''):string[]|null {
  const queue:[[string,string[]]]=[[from,[]]],seen=new Set([from]);
  while(queue.length){const [id,trail]=queue.shift()!;if(id===to)return trail;for(const d of rooms.find(v=>v.id===id)!.doors){if(d.to===avoid||seen.has(d.to))continue;seen.add(d.to);queue.push([d.to,[...trail,d.to]]);}}
  return null;
}
function blocked(room:RoomState,p:{x:number;y:number},radius:number):boolean {
  return room.obstacles.some(o=>{if(o.hp<=0)return false;const dx=Math.max(o.x-p.x,0,p.x-(o.x+o.width)),dy=Math.max(o.y-p.y,0,p.y-(o.y+o.height));return dx*dx+dy*dy<radius*radius-1e-9;});
}
/** Test harness places the player at a walkable doorway approach; transition itself uses public input and a normal step. */
function enter(r:DungeonRun,to:string):void {
  const source=currentRoom(r),door=roomDoors(r).find(d=>d.to===to);assert.ok(door,`${source.id} has door to ${to}`);assert.equal(source.locked,false);
  const trigger=doorTriggerRect(source,door.side);r.player.x=trigger.x+trigger.width/2;r.player.y=trigger.y+trigger.height/2;
  dungeonInput(r,{type:'control',moveX:door.side==='W'?-1:door.side==='E'?1:0,moveY:door.side==='N'?-1:door.side==='S'?1:0,aimX:r.player.x+100,aimY:r.player.y,firing:false});
  stepDungeon(r);assert.equal(r.currentRoom,to);dungeonInput(r,{type:'control',moveX:0,moveY:0,aimX:r.player.x,aimY:r.player.y,firing:false});assert.ok(parseDungeonRun(r),`valid after ${source.id} -> ${to}`);
}
/** Deaths and fixture positions below are test mutations, not player-play or natural-clear evidence. */
function clearWithFixtureDeaths(r:DungeonRun):void {
  const target=currentRoom(r);assert.ok(target.encounterStarted);
  for(let guard=0;!target.cleared&&guard<3000;guard++){
    for(const e of target.enemies)e.hp=0;
    stepDungeon(r);assert.ok(parseDungeonRun(r),`valid during injected clear wave ${target.wave}`);
    if(!target.cleared&&target.enemies.length===0){while(target.nextWaveAt>r.elapsedMs){stepDungeon(r);assert.ok(parseDungeonRun(r),'valid during inter-wave delay');}}
    while(r.phase==='upgrade'){
      const choice=r.choices[0];assert.ok(choice,'upgrade phase exposes a legal choice');
      dungeonInput(r,{type:'upgrade',id:choice,...(!['power','haste','vitality'].includes(choice)&&!r.player.traits.includes(choice as any)&&r.player.traits.length===3?{replaceSlot:0 as const}:{})});assert.ok(parseDungeonRun(r),'valid after public upgrade input');
    }
  }
  assert.equal(target.cleared,true);assert.equal(target.locked,false);
}
function travel(r:DungeonRun,target:string):void {
  const steps=route(r.rooms,r.currentRoom,target);assert.ok(steps,`route to ${target}`);
  for(const id of steps!){if(currentRoom(r).locked)clearWithFixtureDeaths(r);enter(r,id);}
}

test('independent seeded-graph check: all nodes reachable, links reciprocal/cardinal, and boss bypasses elite',()=>{
  const expectedKinds:Record<string,string>={entrance:'entrance',crossroads:'event',spring:'rest',merchant:'shop',treasure:'chest','battle-a':'combat','battle-b':'combat','battle-c':'combat','battle-d':'combat','battle-e':'combat','battle-f':'combat','depth-a':'combat','depth-b':'combat',elite:'elite',altar:'altar',boss:'boss'};
  for(let seed=0;seed<2048;seed++){
    const r=createDungeon(seed),ids=new Set(r.rooms.map(v=>v.id));assert.equal(r.rooms.length,16,`seed ${seed}`);assert.equal(ids.size,16,`unique IDs seed ${seed}`);
    assert.deepEqual(Object.fromEntries(r.rooms.map(v=>[v.id,v.kind])),expectedKinds,`production room set seed ${seed}`);assert.equal(r.currentRoom,'entrance');
    assert.ok(parseDungeonRun(r),`initial persistence seed ${seed}`);
    assert.ok(route(r.rooms,'entrance','boss', 'elite'),`boss bypass seed ${seed}`);
    for(const v of r.rooms){assert.ok(route(r.rooms,'entrance',v.id),`reachable ${v.id} seed ${seed}`);assert.ok(v.doors.length<=4);
      for(const d of v.doors){const to=room(r,d.to),dx=to.gridX-v.gridX,dy=to.gridY-v.gridY;
        assert.equal(Math.abs(dx)+Math.abs(dy),1,`cardinal ${v.id}/${d.to} seed ${seed}`);
        const expected=dx===1?'E':dx===-1?'W':dy===1?'S':'N';assert.equal(d.side,expected,`side ${v.id}/${d.to} seed ${seed}`);
        const reverse=to.doors.find(back=>back.to===v.id);assert.ok(reverse,`reverse door ${v.id}/${d.to} seed ${seed}`);
        assert.equal(reverse!.side,({N:'S',S:'N',E:'W',W:'E'} as const)[d.side]);
      }
    }
  }
});

test('same seed reproduces map and fixture loot while distinct seeds vary those streams',()=>{
  assert.deepEqual(createDungeon(919),createDungeon(919));const layouts=new Set<string>(),shopLoot=new Set<string>(),rackLoot=new Set<string>();
  for(let seed=0;seed<64;seed++){
    const r=createDungeon(seed);layouts.add(r.rooms.map(v=>`${v.id}:${v.layoutId}:${v.width}x${v.height}`).join('|'));
    shopLoot.add(room(r,'merchant').merchantStock.map(v=>v.weapon.kind).join(','));travel(r,'crossroads');const f=roomFixtures(r)[0];r.player.x=f.x;r.player.y=f.y;dungeonInput(r,{type:'interact',id:f.id});rackLoot.add(currentRoom(r).ground[0].weapon.kind);
  }
  assert.ok(layouts.size>32);assert.ok(shopLoot.size>8);assert.ok(rackLoot.size>=3);
});

test('door view, player approach and arrival geometry agree across all door sides/layout seeds',()=>{
  const sides=new Set<string>();
  for(let seed=0;seed<256;seed++){
    const r=createDungeon(seed);
    for(const source of r.rooms){r.currentRoom=source.id;const views=roomDoors(r);assert.equal(views.length,source.doors.length);
      for(const d of source.doors){const v=views.find(x=>x.to===d.to)!;sides.add(v.side);assert.equal(v.locked,source.locked);
        assert.deepEqual({x:v.x,y:v.y},{x:v.side==='W'?24:v.side==='E'?source.width-24:source.width/2,y:v.side==='N'?24:v.side==='S'?source.height-24:source.height/2});
        const approach={x:v.side==='W'?35:v.side==='E'?source.width-35:source.width/2,y:v.side==='N'?35:v.side==='S'?source.height-35:source.height/2};
        assert.ok(!blocked(source,approach,11),`blocked approach ${source.id}/${d.to} seed ${seed}`);
        assert.ok(Math.hypot(approach.x-v.x,approach.y-v.y)<=34,`trigger range ${source.id}/${d.to} seed ${seed}`);
        const target=room(r,d.to),back=target.doors.find(x=>x.to===source.id)!;
        const arrival={x:back.side==='W'?64:back.side==='E'?target.width-64:target.width/2,y:back.side==='N'?64:back.side==='S'?target.height-64:target.height/2};
        assert.ok(arrival.x>=35&&arrival.x<=target.width-35&&arrival.y>=35&&arrival.y<=target.height-35);
        assert.ok(!blocked(target,arrival,11),`blocked arrival ${d.to} from ${source.id} seed ${seed}`);
      }
      const fixtures=roomFixtures(r);
      for(const f of fixtures){assert.deepEqual({x:f.x,y:f.y},{x:source.width/2,y:source.height/2});assert.ok(!blocked(source,f,11),`fixture obstructed ${source.id} seed ${seed}`);
        r.player.x=f.x;r.player.y=f.y;const hits=nearbyInteractions(r).filter(i=>i.kind!=='weapon');assert.ok(hits.length,`fixture should expose an in-range confirmation ${source.id} seed ${seed}`);
        for(const hit of hits)assert.deepEqual(hit.position,{x:f.x,y:f.y},`interaction/fixture mismatch ${source.id}/${hit.id} seed ${seed}`);
      }
    }
  }
  assert.deepEqual([...sides].sort(),['E','N','S','W']);
});

test('outward movement input crosses every transformed entrance door and lands inside its matching return corridor',()=>{
  const sides=new Set<string>();
  for(let seed=0;seed<256;seed++){
    const r=createDungeon(seed),door=roomDoors(r)[0];sides.add(door.side);enter(r,'crossroads');
    const landed=currentRoom(r),back=landed.doors.find(d=>d.to==='entrance')!;
    assert.deepEqual({x:r.player.x,y:r.player.y},{x:back.side==='W'?64:back.side==='E'?landed.width-64:landed.width/2,y:back.side==='N'?64:back.side==='S'?landed.height-64:landed.height/2});
  }
  assert.deepEqual([...sides].sort(),['E','N','S','W']);
});

test('seeded battle and elite rooms begin with a parseable locked plan and legal warning points',()=>{
  for(let seed=0;seed<128;seed++){
    for(const target of ['battle-a','battle-b','elite']){
      const r=createDungeon(seed);travel(r,target);const fight=currentRoom(r);assert.equal(fight.id,target);assert.equal(fight.wave,1);assert.equal(fight.totalWaves,2);assert.equal(fight.locked,true);
      assert.equal(fight.enemies.length,0);assert.ok(fight.spawns.pending.length>0);
      const planned=fight.spawns.plan[0].batches.flatMap(batch=>batch.enemies);
      assert.ok(target==='elite'?planned.length>0:planned.length>=5&&planned.length<=8,`${target} planned count seed ${seed}: ${planned.length}`);
      for(const ticket of fight.spawns.pending){const radius=movementShape({x:ticket.point.x,y:ticket.point.y},ticket.kind,r.combat.profile).radius;assert.ok(ticket.point.x>=24+radius&&ticket.point.x<=fight.width-24-radius);assert.ok(ticket.point.y>=24+radius&&ticket.point.y<=fight.height-24-radius);assert.ok(!blocked(fight,ticket.point,radius));const distance=Math.hypot(ticket.point.x-r.player.x,ticket.point.y-r.player.y),safeDistance=Math.min(SPAWN_SAFE_DISTANCE,fight.width*.42,fight.height*.56);if(distance<safeDistance)assert.equal(fight.spawns.phase,'delayed',`${ticket.id} near player must remain a visible delay`);}
      assert.ok(parseDungeonRun(r),`${target} first wave seed ${seed}`);
    }
  }
});

test('real door input starts one sealed encounter, keeps both waves queued, then revisits without reroll or reward',()=>{
  const r=createDungeon(9127);travel(r,'crossroads');const entryPath=route(r.rooms,r.currentRoom,'battle-a');assert.ok(entryPath);travel(r,'battle-a');const fight=currentRoom(r);assert.equal(fight.wave,1);assert.equal(fight.totalWaves,2);assert.equal(fight.locked,true);assert.equal(fight.enemies.length,0);assert.ok(fight.spawns.pending.length>0);
  const returnTo=entryPath!.length>1?entryPath!.at(-2)!:'crossroads';const exit=roomDoors(r).find(d=>d.to===returnTo)!,exitRect=doorTriggerRect(fight,exit.side);r.player.x=exitRect.x+exitRect.width/2;r.player.y=exitRect.y+exitRect.height/2;
  dungeonInput(r,{type:'control',moveX:exit.side==='W'?-1:exit.side==='E'?1:0,moveY:exit.side==='N'?-1:exit.side==='S'?1:0,aimX:r.player.x,aimY:r.player.y,firing:false});stepDungeon(r);assert.equal(r.currentRoom,'battle-a');assert.equal(fight.locked,true);
  for(const e of fight.enemies)e.hp=0;stepDungeon(r);assert.equal(fight.wave,1);assert.equal(fight.locked,true);assert.equal(fight.cleared,false);assert.ok(fight.spawns.pending.length>0);clearWithFixtureDeaths(r);assert.equal(fight.wave,2);assert.equal(fight.cleared,true);
  const cleared=structuredClone(fight),reward={...r.reward};assert.equal(fight.cleared,true);assert.equal(fight.locked,false);assert.ok(reward.coins>0&&reward.xp>0);
  enter(r,returnTo);enter(r,'battle-a');assert.equal(currentRoom(r).wave,cleared.wave);assert.deepEqual(currentRoom(r).enemies,cleared.enemies);assert.equal(currentRoom(r).cleared,true);assert.deepEqual(r.reward,reward);assert.ok(parseDungeonRun(r));
});

test('public door transitions preserve a discovered route to the placeholder boss without visiting elite',()=>{
  const r=createDungeon(44),planned=route(r.rooms,'entrance','boss','elite');assert.ok(planned);assert.equal(planned!.includes('elite'),false);
  for(const id of planned!){if(currentRoom(r).locked)clearWithFixtureDeaths(r);enter(r,id);}
  assert.equal(r.currentRoom,'boss');assert.ok(parseDungeonRun(r));const visible=discoveredRooms(r);
  assert.ok(visible.some(v=>v.id==='boss'));assert.equal(visible.some(v=>v.id==='elite'),false);
});

test('fixture hotzones, repeated confirmation and two-slot replacement preserve one copy of every weapon',()=>{
  const r=createDungeon(204);r.player.weaponSlots[0]={id:'explicit-hotzone-fixture',kind:'sword',level:1,evolved:false,form:'base' as const};const sword=r.player.weaponSlots[0];travel(r,'crossroads');const rack=roomFixtures(r)[0];assert.equal(rack.kind,'event');
  r.player.x=rack.x+64.001;r.player.y=rack.y;assert.equal(nearbyInteractions(r).some(i=>i.id===rack.id),false);
  r.player.x=rack.x+64;r.player.y=rack.y;assert.ok(nearbyInteractions(r).some(i=>i.id===rack.id));
  r.player.x=rack.x;r.player.y=rack.y;
  for(let i=0;i<12;i++){dungeonInput(r,{type:'interact',id:rack.id});assert.ok(parseDungeonRun(r),`after rack repeat ${i}`);}
  const roomNow=currentRoom(r),dropped=roomNow.ground[0];assert.ok(dropped);assert.equal(roomNow.eventUsed,true);assert.equal(roomNow.ground.length,1);
  const beforeIds=[sword!.id,dropped.weapon.id].sort();dungeonInput(r,{type:'interact',id:dropped.id});assert.equal(r.player.weaponSlots[1]?.id,dropped.weapon.id);assert.equal(roomNow.ground.length,0);
  dungeonInput(r,{type:'interact',id:dropped.id});assert.deepEqual([r.player.weaponSlots[0]!.id,r.player.weaponSlots[1]!.id].sort(),beforeIds);assert.ok(parseDungeonRun(r));
  travel(r,'merchant');const shop=currentRoom(r),offers=[...shop.merchantStock],total=offers.reduce((n,o)=>n+o.price,0);travel(r,'battle-a');clearWithFixtureDeaths(r);travel(r,'merchant');r.reward.coins=Math.min(r.reward.coins,total+3);const purchaseStart=r.reward.coins;const initialHeld=r.player.weaponSlots.filter(Boolean).map(w=>w!.id);
  for(const offer of offers){const fixture=roomFixtures(r)[0];r.player.x=fixture.x;r.player.y=fixture.y;for(let n=0;n<5;n++){dungeonInput(r,{type:'interact',id:offer.id});assert.ok(parseDungeonRun(r),`purchase replay ${offer.id}/${n}`);}assert.equal(offer.sold,true);}
  assert.equal(r.reward.coins,purchaseStart-total);assert.equal(shop.ground.length,2);const purchased=shop.ground.map(g=>g.weapon.id);assert.equal(new Set(purchased).size,2);
  for(const g of [...shop.ground]){r.player.x=g.x;r.player.y=g.y;dungeonInput(r,{type:'interact',id:g.id});assert.ok(parseDungeonRun(r));}
  const all=[...r.player.weaponSlots.filter(Boolean).map(w=>w!.id),...shop.ground.map(g=>g.weapon.id)].sort();assert.equal(all.length,4);assert.equal(new Set(all).size,4);
  assert.equal(shop.ground.length,2);assert.deepEqual(all.sort(),[...initialHeld,...purchased].sort());
});

test('chest and spring remain one-shot across repeated and revisited interactions',()=>{
  const r=createDungeon(808);travel(r,'treasure');const chestRoom=currentRoom(r),chest=roomFixtures(r)[0];assert.equal(chest.kind,'chest');
  r.player.x=chest.x;r.player.y=chest.y;
  for(let i=0;i<8;i++){dungeonInput(r,{type:'interact',id:chest.id});assert.ok(parseDungeonRun(r),`chest replay ${i}`);}
  assert.equal(chestRoom.chestOpened,true);assert.equal(chestRoom.ground.length,1);const rewardId=chestRoom.ground[0].weapon.id;
  travel(r,'merchant');travel(r,'treasure');assert.equal(chestRoom.ground.length,1);assert.equal(chestRoom.ground[0].weapon.id,rewardId);assert.equal(roomFixtures(r)[0].used,true);
  travel(r,'spring');const springRoom=currentRoom(r),spring=roomFixtures(r)[0];assert.equal(spring.kind,'rest');r.player.hp=20;r.player.shield=0;r.player.x=spring.x;r.player.y=spring.y;
  for(let i=0;i<8;i++){dungeonInput(r,{type:'interact',id:spring.id});assert.ok(parseDungeonRun(r),`spring replay ${i}`);}
  assert.equal(r.player.hp,55);assert.equal(r.player.shield,r.player.maxShield);assert.equal(springRoom.restUsed,true);
  r.player.hp=10;dungeonInput(r,{type:'interact',id:spring.id});assert.equal(r.player.hp,10);travel(r,'merchant');travel(r,'spring');assert.equal(roomFixtures(r)[0].used,true);assert.ok(parseDungeonRun(r));
});

test('elite completion pays once without adding rune choices or rune progress',()=>{
  for(const seed of [4,19,73,811]){
    const r=createDungeon(seed);travel(r,'elite');const elite=currentRoom(r),before={...r.reward};assert.equal(elite.locked,true);
    assert.equal(nearbyInteractions(r).filter(v=>v.id.startsWith('rune-')).length,0);
    clearWithFixtureDeaths(r);assert.equal(roomFixtures(r).length,0);assert.deepEqual(r.player.runes,[]);assert.equal(elite.eliteRuneClaimed,false);
    assert.ok(r.reward.coins>before.coins);assert.ok(r.reward.xp===before.xp);const paid={...r.reward};
    travel(r,'crossroads');travel(r,'elite');assert.deepEqual(r.reward,paid);assert.equal(nearbyInteractions(r).some(v=>v.id.startsWith('rune-')),false);assert.ok(parseDungeonRun(r));
  }
});

test('ground-item pickup hotzone has the same inclusive radius as its advertised core interaction range',()=>{
  const r=createDungeon(51);r.player.weaponSlots[0]={id:'explicit-range-fixture',kind:'sword',level:1,evolved:false,form:'base' as const};travel(r,'crossroads');const safe=currentRoom(r);r.player.x=safe.width/2;r.player.y=safe.height/2;
  safe.ground.push({id:'probe-ground',x:r.player.x+48,y:r.player.y,weapon:{id:'probe-weapon',kind:'fire',level:1,evolved:false,form:'base' as const}});
  assert.ok(nearbyInteractions(r).some(i=>i.id==='probe-ground'));
  safe.ground[0].x=r.player.x+48.001;assert.equal(nearbyInteractions(r).some(i=>i.id==='probe-ground'),false);
  safe.ground[0].x=r.player.x+48;dungeonInput(r,{type:'interact',id:'probe-ground'});assert.equal(r.player.weaponSlots[1]?.id,'probe-weapon');assert.equal(safe.ground.length,0);assert.ok(parseDungeonRun(r));
});

test('map persistence parser rejects disconnected floor graphs and a current room that is still undiscovered',()=>{
  const disconnected=createDungeon(123),boss=room(disconnected,'boss'),battle=room(disconnected,'depth-b');boss.doors=[];battle.doors=battle.doors.filter(d=>d.to!=='boss');
  assert.equal(parseDungeonRun(disconnected),null,'a reciprocal local graph with an unreachable room is not a valid floor');
  const undiscovered=createDungeon(123);undiscovered.currentRoom='boss';
  assert.equal(parseDungeonRun(undiscovered),null,'currentRoom must be visited/discovered');
  const fogLeak=createDungeon(123);room(fogLeak,'boss').visited=true;
  assert.equal(parseDungeonRun(fogLeak),null,'a visited room must be reachable through already visited rooms');
  assert.equal(discoveredRooms(fogLeak).some(v=>v.id==='boss'),true,'this intentionally demonstrates the leak when parser accepts the corrupted state');
});

test('room persistence rejects impossible encounter-kind/lifecycle tuples and accepts queued warning tickets',()=>{
  const invalid:((r:DungeonRun)=>void)[]=[
    r=>{room(r,'battle-a').cleared=true;},
    r=>{room(r,'battle-a').wave=2;},
    r=>{room(r,'battle-a').totalWaves=0;},
    r=>{room(r,'spring').totalWaves=2;},
    r=>{room(r,'boss').totalWaves=2;},
    r=>{room(r,'spring').locked=true;},
    r=>{room(r,'battle-a').encounterStarted=true;}
  ];
  for(const mutate of invalid){const r=createDungeon(991);mutate(r);assert.equal(parseDungeonRun(r),null);}
  const r=createDungeon(992);travel(r,'battle-a');const fight=currentRoom(r);assert.equal(fight.enemies.length,0);assert.ok(fight.spawns.pending.length>0);fight.enemies.forEach(e=>e.hp=0);stepDungeon(r);
  assert.equal(fight.wave,1);assert.equal(fight.locked,true);assert.equal(fight.enemies.length,0);assert.ok(fight.spawns.pending.length>0);assert.ok(parseDungeonRun(r));
  clearWithFixtureDeaths(r);assert.equal(fight.wave,2);assert.equal(fight.cleared,true);assert.equal(fight.locked,false);assert.ok(parseDungeonRun(r));
  // Synthetic terminal envelope for a same-tick player death/last-enemy removal; this is parser coverage, not a natural death run.
  const terminal=createDungeon(993);travel(terminal,'battle-a');terminal.phase='lost';const last=currentRoom(terminal);last.enemies=[];last.nextWaveAt=0;last.locked=true;assert.ok(parseDungeonRun(terminal));
});

test('minimap projection exposes visited rooms and anonymous adjacent coordinates only',()=>{
  const r=createDungeon(67),initial=discoveredRooms(r);assert.equal(initial.length,1);assert.equal(initial[0].id,'entrance');
  for(const edge of initial[0].doors){assert.equal(edge.visited,false);assert.equal(Object.hasOwn(edge,'to'),false);assert.equal(Object.hasOwn(edge,'kind'),false);}
  const serialized=JSON.stringify(initial);for(const hidden of r.rooms.filter(v=>!v.visited))assert.equal(serialized.includes(`\"id\":\"${hidden.id}\"`),false);
  const first=room(r,'entrance').doors[0].to;enter(r,first);const projection=discoveredRooms(r);assert.equal(projection.length,2);assert.equal(projection.find(v=>v.id===first)?.current,true);
  for(const v of projection)for(const edge of v.doors)if(!edge.visited){assert.equal(Object.hasOwn(edge,'to'),false);assert.equal(Object.hasOwn(edge,'kind'),false);}
  projection[0].doors[0].gridX=999;assert.notEqual(discoveredRooms(r)[0].doors[0].gridX,999);
});
