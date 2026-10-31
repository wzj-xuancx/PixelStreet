import {journalFixtureClears} from './dungeon-logic-growth-fixture';
import {circleRectOverlap} from '../packages/dungeon-core';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DOOR_OPENING_WIDTH, STEP_MS, SPAWN_SAFE_DISTANCE, createDungeon, createEncounter, currentRoom, parseDungeonRun,
  doorApproachRect, doorTriggerRect, dungeonInput, roomDoors, stepDungeon, movementShape, hurtShape
} from '../packages/dungeon-core';
import type {DungeonRun, Enemy, RoomState} from '../packages/dungeon-core';

const opposite={N:'S',S:'N',E:'W',W:'E'} as const;
const rectOverlap=(a:{x:number;y:number;width:number;height:number},b:{x:number;y:number;width:number;height:number})=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
const room=(r:DungeonRun,id:string)=>r.rooms.find(v=>v.id===id)!;
function locateAtDoor(r:DungeonRun,source:RoomState,side:'N'|'S'|'E'|'W',offset=0):void {
  const p=r.player;
  if(side==='W'){p.x=80;p.y=source.height/2+offset;}
  else if(side==='E'){p.x=source.width-80;p.y=source.height/2+offset;}
  else if(side==='N'){p.x=source.width/2+offset;p.y=80;}
  else {p.x=source.width/2+offset;p.y=source.height-80;}
}
function trySyntheticEntry(side:'N'|'S'|'E'|'W',offset:number,diagonal=false):DungeonRun {
  const r=createDungeon(481),source=room(r,'entrance'),target=room(r,'crossroads');
  source.doors=[{to:target.id,side}];target.doors=[{to:source.id,side:opposite[side]}];source.locked=false;
  locateAtDoor(r,source,side,offset);
  const tangent=diagonal?.5:0;
  const move={N:{x:tangent,y:-1},S:{x:tangent,y:1},E:{x:1,y:tangent},W:{x:-1,y:tangent}}[side];
  dungeonInput(r,{type:'control',moveX:move.x,moveY:move.y,aimX:r.player.x+100,aimY:r.player.y,firing:false});stepDungeon(r,STEP_MS);
  return r;
}
function routeWithoutRoom(rooms:RoomState[],from:string,to:string,avoid:string):string[]|null {
  const queue:[[string,string[]]]=[[from,[from]]],seen=new Set([from]);
  while(queue.length){const [id,trail]=queue.shift()!;if(id===to)return trail;for(const door of rooms.find(value=>value.id===id)!.doors)if(door.to!==avoid&&!seen.has(door.to)){seen.add(door.to);queue.push([door.to,[...trail,door.to]]);}}
  return null;
}
function enterGeneratedRoom(r:DungeonRun,target:RoomState):void {
  const entry=target.doors.map(link=>({source:room(r,link.to),route:routeWithoutRoom(r.rooms,'entrance',link.to,target.id)})).find(value=>value.route);
  assert.ok(entry,`${target.id} has an entry reachable from entrance without crossing the target first`);const source=entry!.source;
  // Seed a strict-parseable, already-walked route fixture; the actual final door crossing still uses movement input.
  for(const id of entry!.route!){const ancestor=room(r,id);ancestor.visited=true;if(['combat','elite','boss'].includes(ancestor.kind)){ancestor.locked=false;ancestor.cleared=true;ancestor.enemies=[];ancestor.encounterStarted=true;ancestor.wave=ancestor.totalWaves;ancestor.nextWaveAt=0;}}
  journalFixtureClears(r);r.currentRoom=source.id;target.visited=false;target.locked=false;target.cleared=false;target.enemies=[];target.encounterStarted=false;target.wave=0;target.nextWaveAt=0;
  const door=source.doors.find(d=>d.to===target.id)!;locateAtDoor(r,source,door.side);
  const move={N:{x:0,y:-1},S:{x:0,y:1},E:{x:1,y:0},W:{x:-1,y:0}}[door.side];
  dungeonInput(r,{type:'control',moveX:move.x,moveY:move.y,aimX:r.player.x+100,aimY:r.player.y,firing:false});stepDungeon(r,STEP_MS);
  assert.equal(r.currentRoom,target.id,`${source.id} -> ${target.id}`);dungeonInput(r,{type:'control',moveX:0,moveY:0,aimX:r.player.x,aimY:r.player.y,firing:false});assert.equal(target.wave,1);assert.equal(target.encounterStarted,true);
}
function assertSafeWave(r:DungeonRun,state:RoomState,wave:number,label:string):void {
  const plan=state.spawns.plan[wave-1],planned=plan.batches.flatMap(batch=>batch.enemies),tickets=wave-1===state.spawns.waveIndex?state.spawns.pending:[],safeDistance=Math.min(SPAWN_SAFE_DISTANCE,state.width*.42,state.height*.56),threat={chaser:1,shooter:2,charger:3,guard:3,priest:4,boss:40};
  assert.ok(planned.length>=1&&planned.length<=24,`${label} planned group count ${planned.length}`);assert.ok(plan.batches.every(batch=>batch.enemies.length<=state.spawns.aliveCap),`${label} batch cap`);
  assert.equal(plan.budget,planned.reduce((sum,e)=>sum+threat[e.kind],0),`${label} threat sum`);assert.ok(new Set(planned.map(e=>e.kind)).size>=2,`${label} retains a stage role mix`);
  for(let i=0;i<tickets.length;i++){const ticket=tickets[i]!,radius=movementShape(ticket.point,ticket.kind,r.combat.profile).radius,distance=Math.hypot(ticket.point.x-r.player.x,ticket.point.y-r.player.y);assert.ok(ticket.point.x>=24+radius&&ticket.point.x<=state.width-24-radius&&ticket.point.y>=24+radius&&ticket.point.y<=state.height-24-radius,`${label} ticket inside room`);assert.ok(!state.obstacles.some(o=>o.hp>0&&circleRectOverlap(ticket.point,radius,o)),`${label} marker overlaps a footprint`);if(distance<safeDistance)assert.equal(state.spawns.phase,'delayed',`${label} unsafe marker remains visibly delayed`);for(const other of tickets.slice(i+1))assert.ok(Math.hypot(ticket.point.x-other.point.x,ticket.point.y-other.point.y)>=36-1e-7,`${label} overlapping markers`);}
}
function inertEnemy(id:string,x:number,y:number):Enemy {return{id,kind:'chaser',bossPhase:0,pattern:'none',x,y,hp:1000,maxHp:1000,radius:12,state:'recover',stateUntil:1e9,attackReady:1e9,aimX:0,aimY:1,burnUntil:0,frost:0,frozenUntil:0};}

test('shared door rectangles admit centered and ±48 off-center crossings in every direction, including diagonal approach',()=>{
  assert.equal(DOOR_OPENING_WIDTH,120);
  for(const side of ['N','S','E','W'] as const){
    const r=createDungeon(480),entrance=room(r,'entrance'),trigger=doorTriggerRect(entrance,side);
    assert.equal((side==='N'||side==='S'?trigger.width:trigger.height),120,side);
    for(const offset of [-48,0,48])assert.equal(trySyntheticEntry(side,offset).currentRoom,'crossroads',`${side} offset=${offset}`);
    assert.equal(trySyntheticEntry(side,32,true).currentRoom,'crossroads',`${side} diagonal`);
    assert.equal(trySyntheticEntry(side,DOOR_OPENING_WIDTH/2-movementShape(r.player,'player',r.combat.profile).radius+.1).currentRoom,'entrance',`${side} outside player-center opening`);
  }
});

test('generated room door aprons are obstacle/trap free and passable through actual movement from all four wall sides',()=>{
  const sides=new Set<string>();
  for(let seed=0;seed<32;seed++){
    const r=createDungeon(seed),target=room(r,'battle-a');
    for(const state of r.rooms.filter(v=>v.kind==='combat'||v.kind==='elite'))for(const d of state.doors){
      const apron=doorApproachRect(state,d.side),radius=movementShape(r.player,'player',r.combat.profile).radius;sides.add(d.side);
      for(const o of state.obstacles)assert.equal(rectOverlap(apron,{x:o.x-radius,y:o.y-radius,width:o.width+2*radius,height:o.height+2*radius}),false,`seed ${seed} ${state.id}/${d.side} apron intersects ${o.id}`);
      for(const t of state.traps)assert.equal(rectOverlap(apron,{x:t.x-28,y:t.y-28,width:56,height:56}),false,`seed ${seed} ${state.id}/${d.side} apron intersects ${t.id}`);
    }
    const source=room(r,target.doors[0]!.to),d=source.doors.find(v=>v.to===target.id)!;
    source.visited=true;source.locked=false;source.cleared=true;source.enemies=[];source.encounterStarted=source.totalWaves>0;source.wave=source.totalWaves;source.nextWaveAt=0;
    journalFixtureClears(r);r.currentRoom=source.id;target.visited=false;target.locked=false;target.cleared=false;target.enemies=[];target.encounterStarted=false;target.wave=0;target.nextWaveAt=0;
    locateAtDoor(r,source,d.side);const move={N:{x:0,y:-1},S:{x:0,y:1},E:{x:1,y:0},W:{x:-1,y:0}}[d.side];
    dungeonInput(r,{type:'control',moveX:move.x,moveY:move.y,aimX:r.player.x+100,aimY:r.player.y,firing:false});stepDungeon(r,STEP_MS);
    assert.equal(r.currentRoom,target.id,`generated obstacle doorway blocked in seed ${seed}, side ${d.side}`);
  }
  assert.deepEqual([...sides].sort(),['E','N','S','W']);
});

test('256 seeded floor graphs remain connected, reciprocal, branching, and vary functional-room positions',()=>{
  const signatures=new Set<string>(),positions=new Map<string,Set<string>>();let minCrossroadsDegree=10,minEdges=99;
  for(let seed=0;seed<256;seed++){
    const r=createDungeon(seed),rooms=r.rooms;assert.equal(rooms.length,16,`seed ${seed}`);
    const byId=new Map(rooms.map(v=>[v.id,v]));
    for(const a of rooms){
      assert.ok(a.width>=384&&a.width<=720&&a.height>=288&&a.height<=504,`seed ${seed} ${a.id} room bounds`);
      if(a.kind==='combat'||a.kind==='elite')assert.ok(a.width>=456&&a.height>=336,`seed ${seed} combat footprint`);
      const sides=new Set<string>();
      for(const d of a.doors){assert.equal(sides.has(d.side),false,`seed ${seed} ${a.id} duplicate ${d.side}`);sides.add(d.side);const b=byId.get(d.to);assert.ok(b,`seed ${seed} missing ${d.to}`);
        const delta=Math.abs(a.gridX-b!.gridX)+Math.abs(a.gridY-b!.gridY);assert.equal(delta,1,`seed ${seed} nonadjacent ${a.id}->${d.to}`);assert.ok(b!.doors.some(v=>v.to===a.id&&v.side===opposite[d.side]),`seed ${seed} nonreciprocal ${a.id}->${d.to}`);
      }
      for(const d of a.doors){const apron=doorApproachRect(a,d.side),radius=movementShape(r.player,'player',r.combat.profile).radius;for(const o of a.obstacles)assert.equal(rectOverlap(apron,{x:o.x-radius,y:o.y-radius,width:o.width+2*radius,height:o.height+2*radius}),false,`seed ${seed} obstacle at ${a.id}/${d.side}`);}
      if(a.kind==='combat'||a.kind==='elite')for(const t of a.traps)for(const d of a.doors)assert.equal(rectOverlap(doorApproachRect(a,d.side),{x:t.x-28,y:t.y-28,width:56,height:56}),false,`seed ${seed} trap at ${a.id}/${d.side}`);
    }
    const reached=new Set<string>(['entrance']),queue=['entrance'];while(queue.length){const v=byId.get(queue.shift()!)!;for(const d of v.doors)if(!reached.has(d.to)){reached.add(d.to);queue.push(d.to);}}
    assert.equal(reached.size,16,`seed ${seed} disconnected map`);
    const crossroads=room(r,'crossroads');minCrossroadsDegree=Math.min(minCrossroadsDegree,crossroads.doors.length);assert.ok(crossroads.doors.length>=3,`seed ${seed} lacks route branches`);
    const edges=rooms.reduce((n,v)=>n+v.doors.length,0)/2;minEdges=Math.min(minEdges,edges);
    const featureKinds=['combat','elite','altar','rest','shop'];const featureSig=featureKinds.map(k=>{const f=rooms.find(v=>v.kind===k)!;const pos=`${f.gridX},${f.gridY}`;if(!positions.has(k))positions.set(k,new Set());positions.get(k)!.add(pos);return`${k}:${pos}`;}).join('|');signatures.add(featureSig);
  }
  assert.ok(signatures.size>=40,`only ${signatures.size} functional placement topologies`);
  for(const k of ['combat','elite','altar','rest','shop'])assert.ok(positions.get(k)!.size>=5,`${k} held too few unique grid positions: ${positions.get(k)!.size}`);
  assert.ok(minCrossroadsDegree>=3);assert.ok(minEdges>=11);
});

test('production queued waves keep planned budgets, caps, legal warning points and readable separation for 24 seeds',()=>{
  for(let seed=0;seed<24;seed++)for(const id of ['battle-a','battle-b','elite']){
    const r=createDungeon(seed),target=room(r,id);enterGeneratedRoom(r,target);assert.equal(target.enemies.length,0);assert.ok(target.spawns.pending.length>0);assertSafeWave(r,target,1,`${seed}/${id}/wave1`);assertSafeWave(r,target,2,`${seed}/${id}/wave2`);
    assert.ok(parseDungeonRun(r),`production queue strict parse ${seed}/${id}, phase=${target.spawns.phase}`);
  }
});

test('production player and chaser cover equal distance across 20Hz, 60Hz and 120Hz partitions',()=>{
  const playerAt=(hz:number)=>{const r=createDungeon(899),s=currentRoom(r);s.doors=[];s.obstacles=[];s.enemies=[];r.player.x=80;r.player.y=80;dungeonInput(r,{type:'control',moveX:.6,moveY:.8,aimX:180,aimY:80,firing:false});for(let i=0;i<hz;i++)stepDungeon(r,1000/hz);return{x:r.player.x,y:r.player.y,elapsed:r.elapsedMs};};
  const enemyAt=(hz:number)=>{const r=createDungeon(899),s=currentRoom(r);s.doors=[];s.obstacles=[];const chaser:Enemy={id:'speed-chaser',kind:'chaser',bossPhase:0,pattern:'none',x:300,y:80,hp:100,maxHp:100,radius:12,state:'idle',stateUntil:0,attackReady:1e9,aimX:0,aimY:1,burnUntil:0,frost:0,frozenUntil:0};s.enemies=[chaser];r.player.x=80;r.player.y=80;for(let i=0;i<hz;i++)stepDungeon(r,1000/hz);return{x:chaser.x,y:chaser.y,elapsed:r.elapsedMs};};
  const player20=playerAt(20),enemy20=enemyAt(20);for(const hz of [60,120]){
    const player=playerAt(hz),enemy=enemyAt(hz);
    assert.ok(Math.abs(player.x-player20.x)<1e-7&&Math.abs(player.y-player20.y)<1e-7,`player differs by Hz: ${JSON.stringify({player20,player})}`);
    assert.ok(Math.abs(enemy.x-enemy20.x)<1e-7&&Math.abs(enemy.y-enemy20.y)<1e-7,`enemy differs by Hz: ${JSON.stringify({enemy20,enemy})}`);
    assert.ok(Math.abs(player.elapsed-1000)<1e-7&&Math.abs(enemy.elapsed-1000)<1e-7);
  }
  assert.ok(Math.abs(player20.x-197)<1e-6&&Math.abs(player20.y-236)<1e-6,'production diagonal movement must integrate to 195 world units');assert.ok(Math.abs(enemy20.x-205)<1e-6&&Math.abs(enemy20.y-80)<1e-6,'production chaser must cover 95 world units');
});

test('normal fire, frost and shooter projectiles keep launch velocity after aim/player changes',()=>{
  for(const kind of ['fire','frost'] as const){
    const r=createDungeon(901);r.player.weaponSlots[0]={id:`aim-${kind}`,kind,level:1,evolved:false,form:'base' as const};r.player.attackReady=0;const p=r.player;
    dungeonInput(r,{type:'control',moveX:0,moveY:0,aimX:p.x+180,aimY:p.y+60,firing:true});stepDungeon(r,STEP_MS);
    if(kind==='frost'){for(let i=0;i<6;i++)stepDungeon(r,50);dungeonInput(r,{type:'control',moveX:0,moveY:0,aimX:p.x+180,aimY:p.y+60,firing:false});stepDungeon(r,STEP_MS);}
    else dungeonInput(r,{type:'control',moveX:0,moveY:0,aimX:p.x+180,aimY:p.y+60,firing:false});
    const shot=r.projectiles.find(v=>v.kind===kind);assert.ok(shot,`${kind} launch`);const velocity={x:shot.vx,y:shot.vy};
    dungeonInput(r,{type:'control',moveX:0,moveY:0,aimX:p.x-100,aimY:p.y-150,firing:false});stepDungeon(r,STEP_MS);
    assert.deepEqual({x:shot.vx,y:shot.vy},velocity,`${kind} retargeted after launch`);
  }
  const r=createEncounter(902),s=currentRoom(r);const shooter:Enemy={id:'aim-shooter',kind:'shooter',bossPhase:0,pattern:'none',x:420,y:240,hp:100,maxHp:100,radius:12,state:'windup',stateUntil:0,attackReady:0,aimX:-1,aimY:0,burnUntil:0,frost:0,frozenUntil:0};s.enemies=[shooter];r.player.x=160;r.player.y=240;
  const origin=hurtShape(shooter,'shooter',r.combat.profile,shooter.radius).center,target=hurtShape(r.player,'player',r.combat.profile).center,locked={x:target.x-origin.x,y:target.y-origin.y},length=Math.hypot(locked.x,locked.y);shooter.aimX=locked.x/length;shooter.aimY=locked.y/length;
  stepDungeon(r,STEP_MS);const shot=r.projectiles.find(v=>v.owner==='enemy');assert.ok(shot,'shooter launch');const velocity={x:shot.vx,y:shot.vy};assert.ok(velocity.x<0);assert.ok(Math.abs((target.x-origin.x)*velocity.y-(target.y-origin.y)*velocity.x)<1e-7);
  dungeonInput(r,{type:'control',moveX:0,moveY:1,aimX:r.player.x,aimY:r.player.y+100,firing:false});stepDungeon(r,STEP_MS*3);
  assert.deepEqual({x:shot.vx,y:shot.vy},velocity,'enemy projectile tracked the moving player');
});

test('compact-room-safe targets still receive evolved meteor and three-hop lightning damage',()=>{
  const fire=createDungeon(903),fireRoom=currentRoom(fire),p=fire.player;p.x=80;p.y=fireRoom.height/2;
  const meteorTarget=inertEnemy('meteor-target',p.x+150,p.y);fireRoom.enemies=[meteorTarget];p.weaponSlots[0]={id:'evolved-fire-fixture',kind:'fire',level:5,evolved:true,form:'meteor' as const};p.attackReady=0;
  dungeonInput(fire,{type:'control',moveX:0,moveY:0,aimX:meteorTarget.x,aimY:meteorTarget.y,firing:true});stepDungeon(fire,STEP_MS);assert.equal(fire.zones.some(v=>v.kind==='meteor'&&v.x===meteorTarget.x&&v.y===meteorTarget.y),true);
  for(let i=0;i<48;i++)stepDungeon(fire,STEP_MS);assert.ok(meteorTarget.hp<=934,`meteor failed to hit on its telegraphed point: hp=${meteorTarget.hp}`);

  const lightning=createDungeon(904),roomState=currentRoom(lightning),lp=lightning.player;assert.equal(roomState.obstacles.length,0);lp.x=60;lp.y=60;lp.weaponSlots[0]={id:'lightning-fixture',kind:'lightning',level:1,evolved:false,form:'base' as const};lp.attackReady=0;
  const chain=[inertEnemy('chain-a',150,60),inertEnemy('chain-b',240,60),inertEnemy('chain-c',330,60)];roomState.enemies=chain;
  dungeonInput(lightning,{type:'control',moveX:0,moveY:0,aimX:chain[0]!.x,aimY:chain[0]!.y,firing:true});stepDungeon(lightning,STEP_MS);
  assert.ok(chain.every(v=>v.hp<1000),`safe lane at ${roomState.width}x${roomState.height} should chain across all three targets`);assert.equal(lightning.effects.filter(v=>v.kind==='lightning').length,3);
});
