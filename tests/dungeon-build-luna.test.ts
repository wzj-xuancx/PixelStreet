import {CURRENT_WEAPON_KINDS} from '../packages/dungeon-core';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  XP_THRESHOLDS, activeWeapon, createDungeon as createBareDungeon, currentRoom, doorTriggerRect, dungeonInput,
  evolutionInfo, nearbyInteractions, parseDungeonInput, parseDungeonRun,
  reforgeChoices, roomDoors, roomFixtures, stepDungeon, upgradeChoices, hurtShape
} from '../packages/dungeon-core';
import type {DungeonRun, Enemy, MechanismId, RoomState, UpgradeId, WeaponKind} from '../packages/dungeon-core';

// Existing build probes intentionally use an equipped fixture; starter behavior has its own independent suite.
const createDungeon=(seed:number)=>{const r=createBareDungeon(seed);r.player.weaponSlots[0]={id:'build-fixture-sword',kind:'sword',level:1,evolved:false,form:'base' as const};return r;};
const equippedWeapon=(r:DungeonRun)=>{const w=activeWeapon(r);assert.ok(w,'build probe requires its explicit equipped fixture');return w;};
const step=(r:DungeonRun,n=1)=>{for(let i=0;i<n;i++)stepDungeon(r);};
const room=(r:DungeonRun,id:string)=>r.rooms.find(v=>v.id===id)!;
function route(rooms:RoomState[],from:string,to:string,avoid=''):string[]|null {
  const queue:[[string,string[]]]=[[from,[]]],seen=new Set([from]);
  while(queue.length){const [id,trail]=queue.shift()!;if(id===to)return trail;for(const d of rooms.find(v=>v.id===id)!.doors)if(d.to!==avoid&&!seen.has(d.to)){seen.add(d.to);queue.push([d.to,[...trail,d.to]]);}}
  return null;
}
/** Test setup may place the player at a legal door approach; door travel itself uses public input and normal ticks. */
function enter(r:DungeonRun,to:string):void {
  const source=currentRoom(r),door=roomDoors(r).find(d=>d.to===to);assert.ok(door,`${source.id} -> ${to}`);assert.equal(source.locked,false);
  const trigger=doorTriggerRect(source,door.side);r.player.x=trigger.x+trigger.width/2;r.player.y=trigger.y+trigger.height/2;
  dungeonInput(r,{type:'control',moveX:door.side==='W'?-1:door.side==='E'?1:0,moveY:door.side==='N'?-1:door.side==='S'?1:0,aimX:r.player.x+100,aimY:r.player.y,firing:false});stepDungeon(r);
  assert.equal(r.currentRoom,to);dungeonInput(r,{type:'control',moveX:0,moveY:0,aimX:r.player.x,aimY:r.player.y,firing:false});assert.ok(parseDungeonRun(r),`parse after ${source.id}->${to}`);
}
/** Injected HP changes are only a deterministic progression fixture, never natural-play proof. */
function clearWithFixtureDeaths(r:DungeonRun):void {
  const target=currentRoom(r);assert.ok(target.encounterStarted);let guard=0;
  while(!target.cleared&&guard++<3000){
    for(const e of target.enemies)e.hp=0;
    stepDungeon(r);assert.ok(parseDungeonRun(r),`wave ${target.wave}, phase ${r.phase}`);
    while(!target.cleared&&target.enemies.length===0&&target.nextWaveAt>r.elapsedMs){stepDungeon(r);assert.ok(parseDungeonRun(r),'inter-wave persistence');}
    while(r.phase==='upgrade'){const id=r.choices[0],mechanism=!['power','haste','vitality'].includes(id);dungeonInput(r,{type:'upgrade',id,...(mechanism&&!r.player.traits.includes(id as MechanismId)&&r.player.traits.length===3?{replaceSlot:0 as const}:{})});}
  }
  assert.ok(guard<3000,'encounter completion guard');assert.equal(target.cleared,true);assert.equal(target.locked,false);
}
function travel(r:DungeonRun,to:string,avoid=''):void {
  const path=route(r.rooms,r.currentRoom,to,avoid);assert.ok(path,`route ${r.currentRoom}->${to}`);
  for(const id of path!){if(currentRoom(r).locked)clearWithFixtureDeaths(r);enter(r,id);}
}
function prepareCompatibleMechanisms(r:DungeonRun):void {
  travel(r,'battle-a');clearWithFixtureDeaths(r);travel(r,'elite');clearWithFixtureDeaths(r);
  assert.deepEqual(roomFixtures(r),[]);assert.equal(nearbyInteractions(r).some(v=>v.id.startsWith('rune-')),false);
  r.player.traits=['cinder-burst','twin-blades'];r.combat.traitRanks=r.player.traits.map(id=>({id,rank:1 as const}));r.player.runes=[];assert.ok(parseDungeonRun(r));
}
function isolatedTarget(r:DungeonRun,weapon:WeaponKind,traits:MechanismId[]=[],preserveWeapon=false):void {
  const room=currentRoom(r),p=r.player;
  // Mechanism output tests need a deliberately open lane; collision and obstacle
  // occlusion are covered by the separate map/feedback suites.
  room.obstacles=[];room.traps=[];
  if(!room.enemies.length){let guard=0;while(!room.enemies.length&&guard++<3000)stepDungeon(r);assert.ok(room.enemies.length,'wait for the first queued batch before isolating a target');}
  {let guard=0;while(room.spawns.pending.length&&guard++<3000)stepDungeon(r);assert.ok(guard<3000,'wait for materialized target standstill before weapon probes');}
  room.enemies=room.enemies.slice(0,1);
  r.combat.enemyRuntime=r.combat.enemyRuntime.filter(runtime=>room.enemies.some(enemy=>enemy.id===runtime.enemyId));
  // These weapon probes need one stable target; the remaining plan is not part of their fixture.
  room.spawns={...room.spawns,phase:'idle',plan:[],waveIndex:0,batchIndex:0,pending:[],retryAt:0};room.nextWaveAt=0;
  const e=room.enemies[0];assert.ok(e);
  p.x=room.width/2-100;p.y=room.height/2;
  e.x=p.x+150;e.y=p.y;e.hp=1000;e.maxHp=1000;e.state='recover';e.stateUntil=1e9;e.attackReady=1e9;e.frost=0;e.frozenUntil=0;e.burnUntil=0;
  const previous=equippedWeapon(r);p.weaponSlots[p.activeSlot]=preserveWeapon?{...previous}:{id:`probe-${weapon}`,kind:weapon,level:1,evolved:false,form:'base' as const};p.traits=[...traits];r.combat.traitRanks=p.traits.map(id=>({id,rank:1}));p.moveX=0;p.moveY=0;p.firing=false;p.chargeStarted=null;p.aimX=e.x;p.aimY=e.y;p.attackReady=0;p.skillReady=0;
}
function waveTwo(r:DungeonRun):void {
  const target=currentRoom(r);assert.ok(target.encounterStarted);
  for(let guard=0;guard<3000;guard++){
    if(target.spawns.waveIndex===0)for(const e of target.enemies)e.hp=0;
    stepDungeon(r);
    while(r.phase==='upgrade'){const id=r.choices[0],mechanism=!['power','haste','vitality'].includes(id);dungeonInput(r,{type:'upgrade',id,...(mechanism&&!r.player.traits.includes(id as MechanismId)&&r.player.traits.length===3?{replaceSlot:0 as const}:{})});}
    if(target.spawns.waveIndex===1&&target.spawns.pending.length===0)break;
  }
  assert.equal(target.wave,2);assert.equal(target.spawns.pending.length,0);
}
function waitForBossSpawn(r:DungeonRun):Enemy {
  const target=currentRoom(r);let guard=0;while((!target.enemies.length||target.spawns.pending.length>0)&&guard++<3000)stepDungeon(r);
  assert.ok(guard<3000&&target.enemies.length,'boss warning and settling queue completed');return target.enemies[0];
}
function finishAtExactXp(targetXp:number,level:number,weaponLevel:number,seed:number):DungeonRun {
  const r=createDungeon(seed);travel(r,'battle-a');waveTwo(r);const fight=currentRoom(r),enemyCount=fight.enemies.length;
  r.level=level;equippedWeapon(r).level=weaponLevel as 1|2|3|4|5;
  r.reward.xp=targetXp-1-3*enemyCount-15;
  for(const e of fight.enemies)e.hp=0;stepDungeon(r);
  assert.equal(fight.cleared,true);assert.equal(r.reward.xp,targetXp-1);return r;
}

test('schema v4 keeps build transactions closed, exports build helpers, and upgrades are a unique three-choice transaction',()=>{const r=createDungeon(7301);assert.equal(r.version,4);assert.deepEqual(XP_THRESHOLDS,[24,48,60,72,96]);assert.ok(parseDungeonRun(r));travel(r,'battle-a');clearWithFixtureDeaths(r);assert.equal(r.level,1);travel(r,'battle-b');const target=currentRoom(r);let guard=0;while(!target.cleared&&guard++<3000){target.enemies.forEach(e=>e.hp=0);stepDungeon(r);}assert.equal(r.phase,'upgrade');assert.equal(r.choices.length,3);assert.equal(new Set(r.choices).size,3);assert.deepEqual(upgradeChoices(r).map(v=>v.id),r.choices);assert.ok(parseDungeonRun(r));const before=structuredClone(r),weapon=equippedWeapon(r).level;dungeonInput(r,{type:'upgrade',id:'shatter'});assert.deepEqual(r,before);const selected=r.choices[0];dungeonInput(r,{type:'upgrade',id:selected});assert.equal(r.level,2);assert.equal(equippedWeapon(r).level,weapon);assert.equal(r.phase,'exploring');assert.deepEqual(r.choices,[]);assert.ok(parseDungeonRun(r));const once=structuredClone(r);dungeonInput(r,{type:'upgrade',id:selected});assert.deepEqual(r,once);});

test('all five fixed ordinary-clear milestones have exact below/at boundaries and fifth choice reaches level six',()=>{const r=createDungeon(8100),expected=[0,1,1,2,3,4,4,5];for(const [i,id]of ['battle-a','battle-b','battle-c','battle-d','battle-e','battle-f','depth-a','depth-b'].entries()){travel(r,id);clearWithFixtureDeaths(r);assert.equal(r.reward.xp,(i+1)*12);assert.equal(r.combat.choicesTaken,expected[i]);assert.equal(r.level,expected[i]+1);assert.equal(equippedWeapon(r).level,1);assert.ok(parseDungeonRun(r));}});

test('two ordinary rooms award exactly fixed XP24 and one card across enemy-count-varied seeds',()=>{for(let seed=0;seed<32;seed++){const r=createDungeon(seed);travel(r,'battle-a');clearWithFixtureDeaths(r);travel(r,'battle-b');clearWithFixtureDeaths(r);assert.equal(r.reward.xp,24);assert.equal(r.combat.choicesTaken,1);assert.equal(r.level,2);assert.equal(equippedWeapon(r).level,1);assert.equal(r.essence,2);assert.ok(parseDungeonRun(r));}});

test('a cleared combat room grants essence and XP once across door re-entry',()=>{
  const r=createDungeon(744),initialPath=route(r.rooms,r.currentRoom,'battle-a');assert.ok(initialPath);travel(r,'battle-a');clearWithFixtureDeaths(r);const fight=currentRoom(r),essence=r.essence,xp=r.reward.xp,coins=r.reward.coins;
  assert.equal(essence,1);assert.ok(xp>0);assert.ok(fight.cleared);const priorRoom=initialPath!.length>1?initialPath!.at(-2)!:'entrance';enter(r,priorRoom);enter(r,'battle-a');
  assert.equal(currentRoom(r).id,'battle-a');assert.equal(currentRoom(r).cleared,true);assert.equal(currentRoom(r).locked,false);assert.equal(currentRoom(r).enemies.length,0);
  assert.equal(r.essence,essence);assert.equal(r.reward.xp,xp);assert.equal(r.reward.coins,coins);assert.ok(parseDungeonRun(r));
});

test('loot bag deterministically distributes four distinct weapons from the twelve-kind pool across rack, chest and two shop offers',()=>{
  const kinds=['fire','frost','lightning','boomerang'].sort();
  for(let seed=0;seed<256;seed++){
    const r=createDungeon(seed),pool:readonly WeaponKind[]=CURRENT_WEAPON_KINDS,all=[pool[room(r,'crossroads').lootSeed%12],pool[room(r,'treasure').lootSeed%12],...room(r,'merchant').merchantStock.map(v=>v.weapon.kind)];
    assert.equal(new Set(all).size,4,`seed ${seed}: ${all}`);
    assert.deepEqual([...room(r,'merchant').merchantStock.map(v=>v.weapon.kind)].sort(),all.slice(2).sort());
    assert.ok(room(r,'merchant').merchantStock.every(v=>CURRENT_WEAPON_KINDS.includes(v.weapon.kind)&&v.weapon.level===1));assert.ok(parseDungeonRun(r));
  }
});

test('altar consumes essence only for current-slot level-up, respects cap, and evolves at most one eligible weapon',()=>{
  const r=createDungeon(742);prepareCompatibleMechanisms(r);travel(r,'altar');const altar=currentRoom(r),fixture=roomFixtures(r)[0];assert.equal(fixture.kind,'altar');r.player.x=fixture.x;r.player.y=fixture.y;
  r.player.weaponSlots[0]={id:'fire-altar-test',kind:'fire',level:4,evolved:false,form:'base' as const};r.player.weaponSlots[1]={id:'boomerang-altar-test',kind:'boomerang',level:1,evolved:false,form:'base' as const};r.player.activeSlot=0;r.essence=2;
  dungeonInput(r,{type:'strengthen'});assert.equal(equippedWeapon(r).kind,'fire');assert.equal(equippedWeapon(r).level,5);assert.equal(r.essence,1);assert.ok(parseDungeonRun(r));
  dungeonInput(r,{type:'switch'});assert.equal(equippedWeapon(r).kind,'boomerang');dungeonInput(r,{type:'strengthen'});assert.equal(equippedWeapon(r).level,2);assert.equal(r.essence,0);assert.equal(r.player.weaponSlots[0]!.level,5);assert.ok(parseDungeonRun(r));
  dungeonInput(r,{type:'switch'});assert.equal(evolutionInfo(r).canEvolve,true);assert.equal(evolutionInfo(r).canEvolve,true);
  dungeonInput(r,{type:'evolve',form:activeWeapon(r)!.kind==='fire'?'meteor':'blade-ring'});assert.equal(equippedWeapon(r).evolved,true);assert.equal(altar.altarUsed,true);assert.ok(parseDungeonRun(r));
  dungeonInput(r,{type:'switch'});assert.equal(evolutionInfo(r).canEvolve,false);dungeonInput(r,{type:'evolve',form:activeWeapon(r)!.kind==='fire'?'meteor':'blade-ring'});assert.equal(equippedWeapon(r).evolved,false);assert.ok(parseDungeonRun(r));
  r.player.weaponSlots[1]!.level=5;r.player.activeSlot=1;r.essence=1;const before=structuredClone(r);dungeonInput(r,{type:'strengthen'});assert.equal(r.essence,before.essence);assert.equal(equippedWeapon(r).level,5);assert.ok(parseDungeonRun(r));
});

test('growth preserves both slot levels and explicit safe strengthening changes only active physical item',()=>{const r=createDungeon(743);travel(r,'battle-a');clearWithFixtureDeaths(r);r.player.weaponSlots[1]={id:'offhand-boomerang',kind:'boomerang',level:3,evolved:false,form:'base'};r.player.activeSlot=1;travel(r,'battle-b');const fight=currentRoom(r);for(let i=0;i<3000&&!fight.cleared;i++){fight.enemies.forEach(e=>e.hp=0);stepDungeon(r);}assert.equal(r.phase,'upgrade');const before=structuredClone(r.player.weaponSlots);dungeonInput(r,{type:'upgrade',id:r.choices[0],...(!['power','haste','vitality'].includes(r.choices[0])&&!r.player.traits.includes(r.choices[0] as any)&&r.player.traits.length===3?{replaceSlot:0 as const}:{})});assert.deepEqual(r.player.weaponSlots,before);assert.ok(parseDungeonRun(r));dungeonInput(r,{type:'strengthen'});assert.equal(r.player.weaponSlots[1]!.level,4);assert.equal(r.player.weaponSlots[0]!.level,before[0]!.level);assert.ok(parseDungeonRun(r));});

test('weapon-usable mechanism offer commits its rank without granting a weapon level',()=>{const r=createDungeon(745);r.player.weaponSlots[0]={id:'fire-mechanism-upgrade',kind:'fire',level:2,evolved:false,form:'base'};travel(r,'battle-a');clearWithFixtureDeaths(r);travel(r,'battle-b');const fight=currentRoom(r);for(let i=0;i<3000&&!fight.cleared;i++){fight.enemies.forEach(e=>e.hp=0);stepDungeon(r);}assert.equal(r.phase,'upgrade');const id=r.choices.find(id=>['cinder-burst','scorch-field','roll-next'].includes(id));assert.ok(id);const before=equippedWeapon(r).level;dungeonInput(r,{type:'upgrade',id});assert.ok(r.player.traits.includes(id as MechanismId));assert.equal(equippedWeapon(r).level,before);assert.equal(r.level,2);assert.equal(r.phase,'exploring');assert.ok(parseDungeonRun(r));});

test('altar evolution rejects missing level, mechanism, wrong weapon, location or a second altar use',()=>{
  for(const mode of ['level','mechanism','weapon','location'] as const){
    const r=createDungeon(920);prepareCompatibleMechanisms(r);travel(r,'altar');const f=roomFixtures(r)[0];r.player.x=f.x;r.player.y=f.y;r.essence=6;
    r.player.weaponSlots[0]={id:'evolve-fixture',kind:mode==='weapon'?'lightning':'fire',level:mode==='level'?4:5,evolved:false,form:'base' as const};if(mode==='mechanism')r.player.traits=['deep-freeze'];r.combat.traitRanks=r.player.traits.map(id=>({id,rank:1 as const}));
    if(mode==='location')r.player.x=f.x+65;
    assert.equal(evolutionInfo(r).canEvolve,false,mode);const before=structuredClone(r);dungeonInput(r,{type:'evolve',form:activeWeapon(r)!.kind==='fire'?'meteor':'blade-ring'});assert.deepEqual(r,before,mode);assert.ok(parseDungeonRun(r));
  }
});

test('mechanism reforge is limited to one valid replacement and cannot duplicate a slot',()=>{
  const r=createDungeon(75);travel(r,'altar');const f=roomFixtures(r)[0];r.player.x=f.x;r.player.y=f.y;r.player.traits=['cinder-burst','deep-freeze'];r.combat.traitRanks=r.player.traits.map(id=>({id,rank:1 as const}));assert.equal(r.reforgesLeft,1);
  assert.equal(reforgeChoices(r,0).some(v=>v.id==='scorch-field'),true);assert.equal(reforgeChoices(r,0).some(v=>v.id==='cinder-burst'),false);assert.equal(reforgeChoices(r,2).length,0);
  const before=structuredClone(r);dungeonInput(r,{type:'reforge',slot:0,mechanism:'deep-freeze'});assert.deepEqual(r,before);
  dungeonInput(r,{type:'reforge',slot:0,mechanism:'scorch-field'});assert.deepEqual(r.player.traits,['scorch-field','deep-freeze']);assert.equal(r.reforgesLeft,0);assert.ok(parseDungeonRun(r));
  const after=structuredClone(r);dungeonInput(r,{type:'reforge',slot:1,mechanism:'shatter'});assert.deepEqual(r,after);assert.ok(parseDungeonRun(r));
});

test('boomerang re-hit on return is real damage; twin-blades adds an independently moving projectile',()=>{
  const base=createDungeon(61);travel(base,'battle-a');isolatedTarget(base,'boomerang');const target=currentRoom(base).enemies[0];
  const targetPoint=hurtShape(target,target.kind,base.combat.profile,target.radius).center;
  dungeonInput(base,{type:'control',moveX:0,moveY:0,aimX:targetPoint.x,aimY:targetPoint.y,firing:true});step(base,34);
  const baseDamage=1000-target.hp;assert.ok(baseDamage>=35,`out and return should hit: ${baseDamage}`);assert.ok(baseDamage<=50);assert.ok(parseDungeonRun(base));
  const twin=createDungeon(61);travel(twin,'battle-a');isolatedTarget(twin,'boomerang',['twin-blades']);const twinTarget=currentRoom(twin).enemies[0];
  const second={...twinTarget,id:'twin-angle-target',x:twin.player.x+150*Math.cos(.22),y:twin.player.y+150*Math.sin(.22),hp:1000,maxHp:1000};currentRoom(twin).enemies.push(second);
  const twinPoint=hurtShape(twinTarget,twinTarget.kind,twin.combat.profile,twinTarget.radius).center;
  dungeonInput(twin,{type:'control',moveX:0,moveY:0,aimX:twinPoint.x,aimY:twinPoint.y,firing:true});stepDungeon(twin);assert.equal(twin.projectiles.filter(v=>v.kind==='boomerang').length,2);step(twin,34);
  assert.ok(1000-twinTarget.hp+1000-second.hp>baseDamage,`twin total damage ${2000-twinTarget.hp-second.hp} should exceed baseline ${baseDamage}`);assert.ok(parseDungeonRun(twin));
});

test('fire/scorch-field creates a persistent damaging zone; cinder-burst chains actual nearby damage on burned death',()=>{
  const scorch=createDungeon(62);travel(scorch,'battle-a');isolatedTarget(scorch,'fire',['scorch-field']);const target=currentRoom(scorch).enemies[0];
  dungeonInput(scorch,{type:'control',moveX:0,moveY:0,aimX:target.x,aimY:target.y,firing:true});step(scorch,38);
  assert.ok(scorch.zones.some(z=>z.kind==='burning'));const zone=structuredClone(scorch.zones[0]);const second={...target,id:'synthetic-neighbor',x:zone.x+10,y:zone.y,hp:500,maxHp:500};currentRoom(scorch).enemies.push(second);step(scorch,20);
  assert.ok(second.hp<500,`zone pulse dealt ${500-second.hp}`);assert.ok(parseDungeonRun(scorch));
  const cinder=createDungeon(63);travel(cinder,'battle-a');isolatedTarget(cinder,'fire',['cinder-burst']);const first=currentRoom(cinder).enemies[0];first.hp=1;first.burnUntil=10000;const neighbor={...first,id:'synthetic-chain-target',x:first.x+35,y:first.y,hp:500,maxHp:500,burnUntil:0};currentRoom(cinder).enemies.push(neighbor);step(cinder,8);
  assert.ok(neighbor.hp<=480,`cinder burst must damage neighbors: ${500-neighbor.hp}`);assert.ok(cinder.effects.some(e=>e.kind==='explosion'));assert.ok(parseDungeonRun(cinder));
});

test('deep-freeze adds two frost stacks and shatter cracks frozen targets plus nearby enemies',()=>{
  const r=createDungeon(64);travel(r,'battle-a');isolatedTarget(r,'frost',['deep-freeze']);const target=currentRoom(r).enemies[0];
  for(let shot=0;shot<2;shot++){
    const aim=hurtShape(target,target.kind,r.combat.profile,target.radius).center;
    dungeonInput(r,{type:'control',moveX:0,moveY:0,aimX:aim.x,aimY:aim.y,firing:true});step(r,12);
    dungeonInput(r,{type:'control',moveX:0,moveY:0,aimX:aim.x,aimY:aim.y,firing:false});step(r,22);
  }
  assert.ok(target.frozenUntil>r.elapsedMs,`frost stacks freeze target, now=${target.frozenUntil} elapsed=${r.elapsedMs}`);assert.ok(parseDungeonRun(r));
  target.x=r.player.x+80;target.y=r.player.y;r.player.traits=['shatter'];r.combat.traitRanks=r.player.traits.map(id=>({id,rank:1 as const}));const neighbor={...target,id:'synthetic-shatter-target',x:target.x+40,y:target.y,hp:500,maxHp:500,frozenUntil:0,frost:0};currentRoom(r).enemies.push(neighbor);
  const oldHp=target.hp;dungeonInput(r,{type:'skill',skill:'burst'});assert.equal(target.frozenUntil,0);assert.ok(oldHp-target.hp>=36);assert.ok(neighbor.hp<500);assert.ok(r.effects.some(e=>e.kind==='explosion'));assert.ok(parseDungeonRun(r));
});

test('ricochet reflects once off a wall and returns; invalid weapon slots or mechanisms are rejected at input boundary',()=>{
  const r=createDungeon(65);travel(r,'battle-a');isolatedTarget(r,'boomerang',['ricochet']);for(const e of currentRoom(r).enemies)e.hp=0;step(r);
  r.player.x=currentRoom(r).width-90;r.player.y=currentRoom(r).height/2;r.player.aimX=currentRoom(r).width+100;r.player.aimY=r.player.y;r.player.firing=true;r.player.attackReady=0;
  step(r,20);const shot=r.projectiles.find(v=>v.kind==='boomerang');assert.ok(shot);assert.equal(shot.bounces,1);assert.equal(shot.leg,'out');assert.ok(shot.vx<0);assert.ok(parseDungeonRun(r));
  assert.equal(parseDungeonInput({type:'reforge',slot:3,mechanism:'shatter'}),null);assert.equal(parseDungeonInput({type:'upgrade',id:'not-a-choice'}),null);
});

/** Fixture fast-forwards level/combat budget; compatible mechanics, altar evolution, item swap, attacks and damage use public core inputs. */
function evolvedRun(seed:number,kind:'fire'|'boomerang',traits:MechanismId[]=[]):DungeonRun {
  const r=createDungeon(seed);travel(r,'battle-a');clearWithFixtureDeaths(r);travel(r,'elite');clearWithFixtureDeaths(r);
  assert.deepEqual(roomFixtures(r),[]);assert.equal(nearbyInteractions(r).some(v=>v.id.startsWith('rune-')),false);
  r.player.traits=[kind==='fire'?'cinder-burst':'twin-blades'];r.combat.traitRanks=r.player.traits.map(id=>({id,rank:1 as const}));r.player.runes=[];assert.ok(parseDungeonRun(r));
  r.player.weaponSlots[0]={id:`${kind}-level-five-fixture`,kind,level:5,evolved:false,form:'base' as const};r.player.activeSlot=0;travel(r,'altar');const altar=roomFixtures(r)[0];r.player.x=altar.x;r.player.y=altar.y;
  assert.equal(evolutionInfo(r).canEvolve,true);dungeonInput(r,{type:'evolve',form:activeWeapon(r)!.kind==='fire'?'meteor':'blade-ring'});assert.equal(equippedWeapon(r).evolved,true);assert.ok(parseDungeonRun(r));
  // Valid swap path: the evolved item is dropped to ground and can be picked back up without losing its provenance.
  r.player.weaponSlots[1]={id:'evolution-backup',kind:'sword',level:1,evolved:false,form:'base' as const};const replacementId=`ground-${r.sequence+1}`;r.sequence++;
  currentRoom(r).ground.push({id:replacementId,x:r.player.x,y:r.player.y,weapon:{id:'evolution-replacement',kind:'lightning',level:1,evolved:false,form:'base' as const}});
  dungeonInput(r,{type:'interact',id:replacementId});assert.equal(equippedWeapon(r).kind,'lightning');const dropped=currentRoom(r).ground.find(v=>v.weapon.evolved);assert.ok(dropped);assert.ok(parseDungeonRun(r));
  dungeonInput(r,{type:'interact',id:dropped!.id});assert.equal(equippedWeapon(r).kind,kind);assert.equal(equippedWeapon(r).evolved,true);assert.ok(parseDungeonRun(r));
  travel(r,'depth-a');isolatedTarget(r,kind,traits,true);assert.equal(equippedWeapon(r).evolved,true);assert.ok(parseDungeonRun(r));return r;
}

test('evolution changes attack output: fire emits a delayed meteor zone and orbit creates three blades then releases them',()=>{
  const fire=evolvedRun(66,'fire',['scorch-field']);const fireTarget=currentRoom(fire).enemies[0];const beforeMeteor=fireTarget.hp;
  dungeonInput(fire,{type:'control',moveX:0,moveY:0,aimX:fireTarget.x,aimY:fireTarget.y,firing:true});stepDungeon(fire);assert.equal(fire.zones.filter(v=>v.kind==='meteor').length,1);assert.ok(parseDungeonRun(fire));
  step(fire,45);assert.ok(fire.zones.some(v=>v.kind==='burning'));assert.ok(fireTarget.hp<beforeMeteor,`meteor dealt ${beforeMeteor-fireTarget.hp}`);assert.ok(parseDungeonRun(fire));
  const orbit=evolvedRun(67,'boomerang');const orbitTarget=currentRoom(orbit).enemies[0];orbit.player.firing=false;stepDungeon(orbit);
  assert.equal(orbit.projectiles.filter(v=>v.kind==='orbit'&&v.leg==='orbit').length,3);assert.ok(parseDungeonRun(orbit));
  const atRest=orbit.projectiles.filter(v=>v.kind==='orbit'&&v.leg==='orbit').map(v=>({x:v.x,y:v.y}));step(orbit,10);const moved=orbit.projectiles.filter(v=>v.kind==='orbit'&&v.leg==='orbit');assert.ok(moved.some((v,i)=>Math.hypot(v.x-atRest[i].x,v.y-atRest[i].y)>0.1));
  const beforeOrbit=orbitTarget.hp;dungeonInput(orbit,{type:'control',moveX:0,moveY:0,aimX:orbitTarget.x,aimY:orbitTarget.y,firing:true});stepDungeon(orbit);assert.equal(orbit.projectiles.filter(v=>v.kind==='orbit'&&v.leg==='out').length,3);dungeonInput(orbit,{type:'control',moveX:0,moveY:0,aimX:orbitTarget.x,aimY:orbitTarget.y,firing:false});step(orbit,35);const releasedDamage=beforeOrbit-orbitTarget.hp;assert.ok(releasedDamage>=70,`three released blades should concentrate on target: damage=${releasedDamage}`);assert.ok(parseDungeonRun(orbit));
  for(let i=0;i<60;i++){stepDungeon(orbit);assert.ok(parseDungeonRun(orbit),`return tick ${i}`);}assert.equal(orbit.projectiles.filter(v=>v.kind==='orbit'&&v.leg==='orbit').length,3,'all three released blades return to orbit');
  const twin=evolvedRun(68,'boomerang',['twin-blades']);twin.player.firing=false;stepDungeon(twin);assert.equal(twin.projectiles.filter(v=>v.kind==='orbit'&&v.leg==='orbit').length,4);assert.ok(parseDungeonRun(twin));
});

test('lightning chains real damage through three distinct visible targets',()=>{
  const r=createDungeon(69);travel(r,'battle-a');isolatedTarget(r,'lightning');const roomState=currentRoom(r),p=r.player,first=roomState.enemies[0];
  p.x=Math.max(40,Math.round(roomState.width*.16));p.y=roomState.height/2;first.x=p.x+85;first.y=p.y;first.hp=first.maxHp=1000;
  const second={...first,id:'lightning-second',x:p.x+170,y:p.y,hp:1000,maxHp:1000},third={...first,id:'lightning-third',x:p.x+255,y:p.y,hp:1000,maxHp:1000};roomState.enemies.push(second,third);
  dungeonInput(r,{type:'control',moveX:0,moveY:0,aimX:first.x,aimY:first.y,firing:true});stepDungeon(r);
  assert.ok(first.hp<1000&&second.hp<1000&&third.hp<1000,`chain damage ${[first.hp,second.hp,third.hp]}`);assert.equal(r.effects.filter(e=>e.kind==='lightning').length,3);assert.ok(parseDungeonRun(r));
});

test('boss impact telegraph resolves one marked hit; scorch-field expansion saturates at the persisted radius limit',()=>{
  const bossRun=createDungeon(70);travel(bossRun,'boss','elite');const boss=waitForBossSpawn(bossRun);boss.state='idle';boss.pattern='charge';boss.attackReady=bossRun.elapsedMs;
  stepDungeon(bossRun);assert.ok(bossRun.zones.some(v=>v.kind==='boss-impact'));const before=bossRun.player.hp+bossRun.player.shield;step(bossRun,60);
  assert.ok(bossRun.player.hp+bossRun.player.shield<=before-24,`impact hit did not resolve: ${before-(bossRun.player.hp+bossRun.player.shield)}`);assert.ok(parseDungeonRun(bossRun));
  const zoneRun=createDungeon(71),burning=currentRoom(zoneRun),zoneId=`zone-${zoneRun.sequence+1}`;zoneRun.sequence++;
  zoneRun.player.traits=['scorch-field'];zoneRun.combat.traitRanks=zoneRun.player.traits.map(id=>({id,rank:1 as const}));zoneRun.zones.push({id:zoneId,kind:'meteor',x:burning.width/2,y:burning.height/2,radius:150,startsAt:zoneRun.elapsedMs,expiresAt:zoneRun.elapsedMs+1200,nextPulseAt:0,damage:40});
  assert.ok(parseDungeonRun(zoneRun));stepDungeon(zoneRun);assert.equal(zoneRun.zones[0]?.kind,'burning');assert.equal(zoneRun.zones[0]?.radius,150);assert.ok(parseDungeonRun(zoneRun));
});

test('boss entry seals one wave, cycles fan/charge/impact warnings, escalates phase, and wins once',()=>{
  const r=createDungeon(931);travel(r,'boss','elite');const bossRoom=currentRoom(r),boss=waitForBossSpawn(r);assert.equal(boss.kind,'boss');assert.equal(bossRoom.wave,1);assert.equal(bossRoom.totalWaves,1);assert.equal(bossRoom.locked,true);assert.equal(r.phase,'exploring');assert.ok(parseDungeonRun(r));
  const seen=new Set<string>(),warnings=new Set<string>();
  for(const [prior,nextPattern] of [['none','fan'],['fan','charge'],['charge','impact']] as const){boss.state='idle';boss.pattern=prior;boss.attackReady=r.elapsedMs;const before={x:boss.x,y:boss.y};stepDungeon(r);assert.equal(boss.state,'windup');assert.equal(boss.pattern,nextPattern);seen.add(nextPattern);if(r.effects.some(v=>v.kind==='boss-warning'&&v.expiresAt>r.elapsedMs))warnings.add(nextPattern);assert.ok(parseDungeonRun(r));
    if(nextPattern==='fan'){step(r,43);assert.equal(boss.state,'attack');assert.ok(r.projectiles.filter(v=>v.owner==='enemy').length>=7);}
    if(nextPattern==='charge'){step(r,60);assert.ok(boss.x!==before.x||boss.y!==before.y,'charge moves after a distinct telegraph');}
    if(nextPattern==='impact')assert.ok(r.zones.some(v=>v.kind==='boss-impact'),'impact has a marked zone');
  }
  assert.deepEqual([...seen].sort(),['charge','fan','impact']);assert.deepEqual([...warnings].sort(),['charge','fan','impact']);
  boss.hp=550;boss.state='recover';boss.stateUntil=r.elapsedMs+100000;boss.pattern='none';r.player.weaponSlots[r.player.activeSlot]={id:'boss-fire',kind:'fire',level:5,evolved:false,form:'base' as const};r.player.aimX=boss.x;r.player.aimY=boss.y;r.player.attackReady=0;
  const bossTarget=hurtShape(boss,boss.kind,r.combat.profile,boss.radius).center;dungeonInput(r,{type:'control',moveX:0,moveY:0,aimX:bossTarget.x,aimY:bossTarget.y,firing:true});step(r,90);assert.ok(boss.hp<550,`actual fire projectile damage=${550-boss.hp}`);stepDungeon(r);assert.equal(boss.bossPhase,2);assert.ok(parseDungeonRun(r));
  boss.state='idle';boss.pattern='impact';boss.attackReady=r.elapsedMs;stepDungeon(r);assert.equal(boss.pattern,'fan');step(r,43);assert.ok(r.projectiles.filter(v=>v.owner==='enemy').length>=9,'phase-two fan has nine projectiles');assert.ok(parseDungeonRun(r));
  boss.hp=0;for(const v of r.projectiles)v.expiresAt=0;stepDungeon(r);assert.equal(r.phase,'won');assert.equal(bossRoom.cleared,true);assert.equal(bossRoom.locked,false);assert.ok(parseDungeonRun(r));
  const reward=structuredClone(r.reward);step(r,60);dungeonInput(r,{type:'evolve',form:activeWeapon(r)!.kind==='fire'?'meteor':'blade-ring'});assert.deepEqual(r.reward,reward);assert.equal(r.phase,'won');assert.ok(parseDungeonRun(r));
});

test('schema v2 rejects invalid upgrade, mechanism, legacy-rune, evolved-weapon and boss-state combinations',()=>{
  const base=createDungeon(9081);assert.ok(parseDungeonRun(base));const mutations:((r:DungeonRun)=>void)[]=[
    r=>{r.level=7;},r=>{r.essence=7;},r=>{(r as unknown as {reforgesLeft:number}).reforgesLeft=2;},r=>{r.player.damageRank=6;},
    r=>{r.player.traits=['cinder-burst','cinder-burst'];r.combat.traitRanks=r.player.traits.map(id=>({id,rank:1 as const}));},r=>{r.player.traits=['unknown-mechanism' as MechanismId];r.combat.traitRanks=r.player.traits.map(id=>({id,rank:1 as const}));},
    r=>{r.player.runes=[''];},r=>{r.player.runes=['unknown-rune'];},r=>{r.player.runes=['fire','fire'];},r=>{r.player.runes=['sword'];},r=>{r.player.weaponSlots[0]!.evolved=true;},
    r=>{r.player.weaponSlots[0]!.kind='fire';r.player.weaponSlots[0]!.evolved=true;r.player.weaponSlots[0]!.level=4;},
    r=>{r.player.weaponSlots[0]!.kind='fire';r.player.weaponSlots[0]!.evolved=true;r.player.weaponSlots[0]!.level=5;},
    r=>{r.choices=['power','power','vitality'];r.phase='upgrade';},
    r=>{r.phase='upgrade';r.choices=['power','vitality','haste'];},
  ];
  for(const mutate of mutations){const r=structuredClone(base);mutate(r);assert.equal(parseDungeonRun(r),null,JSON.stringify(r).slice(0,240));}
  const noRune=createDungeon(9083);travel(noRune,'altar');noRune.player.weaponSlots[0]={id:'invalid-evolved-fire',kind:'fire',level:5,evolved:true,form:'meteor' as const};assert.equal(parseDungeonRun(noRune),null,'evolved weapon still needs a used altar');
  const inertLegacyRune=createDungeon(9085);inertLegacyRune.player.runes=['fire'];assert.ok(parseDungeonRun(inertLegacyRune),'legacy rune values no longer require an elite claim');
  const duplicateEvolution=createDungeon(9084);travel(duplicateEvolution,'altar');duplicateEvolution.player.weaponSlots[0]={id:'evolved-fire',kind:'fire',level:5,evolved:true,form:'meteor' as const};duplicateEvolution.player.weaponSlots[1]={id:'evolved-boomerang',kind:'boomerang',level:5,evolved:true,form:'blade-ring' as const};room(duplicateEvolution,'altar').altarUsed=true;assert.equal(parseDungeonRun(duplicateEvolution),null,'one altar cannot persist two evolved weapons');
  const boss=createDungeon(9082);travel(boss,'boss','elite');const e=waitForBossSpawn(boss);e.bossPhase=0;assert.equal(parseDungeonRun(boss),null);
});
