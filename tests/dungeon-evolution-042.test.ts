import {journalFixtureClears,pendingFixture} from './dungeon-logic-growth-fixture';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activeWeapon, createDungeon, currentRoom, dungeonInput, evolutionInfo, nearbyInteractions,
  parseDungeonInput, parseDungeonRun, roomFixtures, upgradeChoices
} from '../packages/dungeon-core';
import {eligibleUpgrades} from '../packages/dungeon-core/build';
import type {DungeonInput, DungeonRun, MechanismId, UpgradeId, WeaponKind} from '../packages/dungeon-core';

const EVOLUTIONS=[
  {weapon:'fire',mechanism:'cinder-burst',compatible:['cinder-burst','scorch-field'],name:'流星'},
  {weapon:'fire',mechanism:'scorch-field',compatible:['cinder-burst','scorch-field'],name:'流星'},
  {weapon:'boomerang',mechanism:'twin-blades',compatible:['twin-blades','ricochet'],name:'环刃'},
  {weapon:'boomerang',mechanism:'ricochet',compatible:['twin-blades','ricochet'],name:'环刃'}
] as const;

function upgradeState(kind:WeaponKind,traits:MechanismId[],seed=42):DungeonRun {
  const r=createDungeon(seed);
  r.player.weaponSlots[0]={id:'growth-fixture-weapon',kind,level:2,evolved:false,form:'base' as const};r.player.activeSlot=0;r.player.traits=[...traits];r.combat.traitRanks=r.player.traits.map(id=>({id,rank:1 as const}));
  r.currentRoom='entrance';currentRoom(r).cleared=true;for(const id of ['battle-a','battle-b']){const q=r.rooms.find(q=>q.id===id)!;q.visited=true;q.cleared=true;q.encounterStarted=true;q.wave=q.totalWaves;q.locked=false;}r.rooms.find(q=>q.id==='crossroads')!.visited=true;journalFixtureClears(r);pendingFixture(r);const wanted=(kind==='fire'?['cinder-burst','scorch-field']:['twin-blades','ricochet']).find(id=>!traits.includes(id as MechanismId));if(wanted&&!r.choices.includes(wanted as UpgradeId)&&seed<300)return upgradeState(kind,traits,seed+1);
  return r;
}
function upgradeInput(id:UpgradeId,replaceSlot?:number):DungeonInput {
  return {type:'upgrade',id,...(replaceSlot===undefined?{}:{replaceSlot})} as unknown as DungeonInput;
}
function pathTo(rooms:DungeonRun['rooms'],to:string):string[] {
  const queue:[[string,string[]]]=[['entrance',[]]],seen=new Set(['entrance']);
  while(queue.length){const [id,trail]=queue.shift()!;if(id===to)return trail;for(const d of rooms.find(v=>v.id===id)!.doors)if(!seen.has(d.to)){seen.add(d.to);queue.push([d.to,[...trail,d.to]]);}}
  throw new Error(`No path from entrance to ${to}`);
}
function atAltar(kind:WeaponKind,traits:MechanismId[],seed=71):DungeonRun {
  const r=createDungeon(seed),altar=r.rooms.find(v=>v.id==='altar')!;
  for(const id of ['entrance',...pathTo(r.rooms,'altar')]){
    const room=r.rooms.find(v=>v.id===id)!;room.visited=true;
    if(room.kind==='combat'||room.kind==='elite'||room.kind==='boss'){
      room.encounterStarted=true;room.wave=room.totalWaves;room.nextWaveAt=0;room.cleared=true;room.locked=false;room.enemies=[];
    }
  }
  journalFixtureClears(r);r.currentRoom='altar';altar.visited=true;r.player.x=altar.width/2;r.player.y=altar.height/2;
  r.player.weaponSlots[0]={id:'evolution-fixture-weapon',kind,level:5,evolved:false,form:'base' as const};r.player.activeSlot=0;r.player.traits=[...traits];r.combat.traitRanks=r.player.traits.map(id=>({id,rank:1 as const}));r.player.runes=[];
  return r;
}

test('upgrade input accepts one valid replacement slot and rejects missing, duplicate, or malformed slot payloads',()=>{
  assert.deepEqual(parseDungeonInput({type:'upgrade',id:'cinder-burst',replaceSlot:1}),{type:'upgrade',id:'cinder-burst',replaceSlot:1});
  for(const input of [
    {type:'upgrade',id:'cinder-burst',replaceSlot:-1},
    {type:'upgrade',id:'cinder-burst',replaceSlot:3},
    {type:'upgrade',id:'cinder-burst',replaceSlot:1.5},
    {type:'upgrade',id:'power',replaceSlot:0},
    {type:'upgrade',id:'cinder-burst',replaceSlot:1,extra:true}
  ])assert.equal(parseDungeonInput(input),null,JSON.stringify(input));
  assert.ok(parseDungeonInput({type:'upgrade',id:'cinder-burst'}),'ordinary non-replacement choice remains valid');
});

test('growth offers every compatible mechanism across full fire and boomerang builds',()=>{
  for(const {weapon,mechanism,compatible} of EVOLUTIONS){
    const traits:MechanismId[]=weapon==='fire'
      ?(mechanism==='cinder-burst'?['scorch-field','deep-freeze','shatter']:['cinder-burst','deep-freeze','shatter'])
      :(mechanism==='twin-blades'?['ricochet','deep-freeze','shatter']:['twin-blades','deep-freeze','shatter']);
    const r=upgradeState(weapon as WeaponKind,traits);
    assert.equal(r.player.traits.length,3);
    assert.ok(compatible.includes(mechanism as never));
    assert.ok(r.choices.includes(mechanism),`${weapon} full build must offer ${mechanism}`);
    assert.ok(upgradeChoices(r).some(choice=>choice.id===mechanism));
  }
});

test('a full-slot mechanism choice atomically replaces one trait and consumes exactly one growth',()=>{
  for(const {weapon,mechanism} of EVOLUTIONS){
    const traits:MechanismId[]=weapon==='fire'
      ?(mechanism==='cinder-burst'?['scorch-field','deep-freeze','shatter']:['cinder-burst','deep-freeze','shatter'])
      :(mechanism==='twin-blades'?['ricochet','deep-freeze','shatter']:['twin-blades','deep-freeze','shatter']);
    const r=upgradeState(weapon as WeaponKind,traits),slot=1,before={level:r.level,weaponLevel:activeWeapon(r)!.level,reforges:r.reforgesLeft};
    assert.ok(r.choices.includes(mechanism));
    dungeonInput(r,upgradeInput(mechanism,slot));
    assert.equal(r.player.traits[slot],mechanism);assert.equal(r.player.traits.length,3);
    assert.equal(r.level,before.level+1);assert.equal(activeWeapon(r)!.level,before.weaponLevel);
    assert.equal(r.reforgesLeft,before.reforges);assert.equal(r.phase,'exploring');assert.deepEqual(r.choices,[]);
    assert.ok(parseDungeonRun(r));
    const once=structuredClone(r);dungeonInput(r,upgradeInput(mechanism,slot));assert.deepEqual(r,once,'a duplicate request cannot consume another growth');
  }
});

test('full-slot growth fails closed for missing or duplicate mechanisms and pause rejects replacement',()=>{
  const traits:MechanismId[]=['scorch-field','deep-freeze','shatter'];
  const missing=upgradeState('fire',traits),beforeMissing=structuredClone(missing);dungeonInput(missing,upgradeInput('cinder-burst'));
  assert.deepEqual(missing,beforeMissing,'a full build must name the slot to replace');
  const duplicate=upgradeState('fire',['cinder-burst','deep-freeze','shatter']);duplicate.choices=['cinder-burst','power','vitality'];
  const beforeDuplicate=structuredClone(duplicate);dungeonInput(duplicate,upgradeInput('cinder-burst',1));assert.deepEqual(duplicate,beforeDuplicate);
  const paused=upgradeState('fire',traits);dungeonInput(paused,{type:'pause',paused:true});const beforePaused=structuredClone(paused);
  dungeonInput(paused,upgradeInput('cinder-burst',1));assert.deepEqual(paused,beforePaused);
  assert.equal(parseDungeonInput({type:'upgrade',id:'cinder-burst',replaceSlot:1.1}),null);
});

test('each compatible mechanism evolves its matching Lv5 weapon without runes and one altar is consumed once',()=>{
  for(const {weapon,mechanism,compatible,name} of EVOLUTIONS){
    const r=atAltar(weapon as WeaponKind,[mechanism as MechanismId]);
    const info=evolutionInfo(r);
    assert.deepEqual(info.compatible,compatible);
    assert.deepEqual(info.requirements.map(v=>v.key),['weapon','level','mechanism','altar','unused']);
    assert.equal(info.name,name);assert.equal(info.canEvolve,true);assert.deepEqual(r.player.runes,[]);assert.ok(parseDungeonRun(r));
    assert.equal(nearbyInteractions(r).some(v=>v.id==='altar-evolve'),false);const option=nearbyInteractions(r).find(v=>v.kind==='altar');assert.ok(option,'read-only altar discovery opens explicit branch UI');assert.equal(option.id,'altar-options');assert.deepEqual(option.position,{x:currentRoom(r).width/2,y:currentRoom(r).height/2});const beforeOpen=structuredClone(r);dungeonInput(r,{type:'interact',id:option.id});assert.deepEqual(r,beforeOpen,'discovering/opening altar never chooses a default form');assert.ok(evolutionInfo(r).canEvolve);
    dungeonInput(r,{type:'evolve',form:activeWeapon(r)!.kind==='fire'?'meteor':'blade-ring'});assert.equal(activeWeapon(r)!.evolved,true);assert.equal(currentRoom(r).altarUsed,true);
    assert.deepEqual(r.player.traits,[mechanism]);assert.ok(parseDungeonRun(r));
    const afterFirst=structuredClone(r);dungeonInput(r,{type:'evolve',form:activeWeapon(r)!.kind==='fire'?'meteor':'blade-ring'});assert.deepEqual(r,afterFirst,'the same altar cannot evolve twice');
  }
});

test('evolution rejects unsupported weapons, Lv4, incompatible mechanisms, and a spent rear route',()=>{
  const cases=[
    {kind:'fire' as const,traits:['twin-blades'] as MechanismId[],level:5 as 4|5},
    {kind:'fire' as const,traits:['cinder-burst'] as MechanismId[],level:4 as 4|5},
    {kind:'lightning' as const,traits:['cinder-burst'] as MechanismId[],level:5 as 4|5}
  ];
  for(const c of cases){const r=atAltar(c.kind,c.traits);activeWeapon(r)!.level=c.level;assert.equal(evolutionInfo(r).canEvolve,false);assert.ok(parseDungeonRun(r));}
  const exhausted=atAltar('boomerang',['ricochet']);
  for(const id of ['depth-a','depth-b','boss']){const room=exhausted.rooms.find(v=>v.id===id)!;room.visited=true;room.cleared=true;room.locked=false;if(room.totalWaves){room.encounterStarted=true;room.wave=room.totalWaves;room.enemies=[];}}
  const info=evolutionInfo(exhausted);assert.equal(info.requirements.find(v=>v.key==='unused')!.met,false);assert.equal(info.canEvolve,false);
});

test('an evolved item remains legal after replacing its mechanism and can be dropped and recovered',()=>{
  const r=atAltar('fire',['cinder-burst']);dungeonInput(r,{type:'evolve',form:activeWeapon(r)!.kind==='fire'?'meteor':'blade-ring'});assert.ok(activeWeapon(r)!.evolved);
  dungeonInput(r,{type:'reforge',slot:0,mechanism:'twin-blades'});assert.deepEqual(r.player.traits,['twin-blades']);assert.equal(activeWeapon(r)!.evolved,true);
  assert.equal(evolutionInfo(r).canEvolve,false);assert.ok(parseDungeonRun(r),'altar provenance, not the replaced mechanism, validates evolution');
  r.player.weaponSlots[1]={id:'fixture-backup-sword',kind:'sword',level:1,evolved:false,form:'base' as const};
  currentRoom(r).ground.push({id:'fixture-replacement-ground',x:r.player.x,y:r.player.y,weapon:{id:'fixture-replacement-item',kind:'lightning',level:1,evolved:false,form:'base' as const}});
  dungeonInput(r,{type:'interact',id:'fixture-replacement-ground'});assert.equal(activeWeapon(r)!.kind,'lightning');assert.ok(currentRoom(r).ground.some(g=>g.weapon.evolved));assert.ok(parseDungeonRun(r));
  const dropped=currentRoom(r).ground.find(g=>g.weapon.evolved)!;dungeonInput(r,{type:'interact',id:dropped.id});assert.equal(activeWeapon(r)!.evolved,true);assert.deepEqual(activeWeapon(r)!.kind,'fire');assert.ok(parseDungeonRun(r));
});

test('legacy rune fields are inert and cleared elite rooms no longer offer rune fixtures',()=>{
  const legacy=createDungeon(99);legacy.player.runes=['fire'];legacy.rooms.find(v=>v.id==='elite')!.eliteRuneClaimed=true;
  assert.deepEqual(parseDungeonRun(legacy)?.player.runes,['fire']);
  const r=createDungeon(100),elite=r.rooms.find(v=>v.id==='elite')!;r.currentRoom=elite.id;elite.visited=true;elite.cleared=true;elite.locked=false;elite.encounterStarted=true;elite.wave=elite.totalWaves;elite.enemies=[];
  assert.deepEqual(roomFixtures(r),[]);assert.equal(nearbyInteractions(r).some(v=>v.id.startsWith('rune-')),false);assert.deepEqual(r.player.runes,[]);
});
