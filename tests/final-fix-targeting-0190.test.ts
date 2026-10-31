import test from 'node:test';
import assert from 'node:assert/strict';
import {createFieldWorld,defaultLoadout,stepFieldWorld,type FieldWorld} from '../packages/field-world';
function fresh(ids=['a']) { return createFieldWorld({sessionId:'selected-target',seed:7,actors:ids.map(id=>({id,loadout:defaultLoadout()}))}); }
function active(ids=['a']):FieldWorld {const w=fresh(ids);w.active=0;const g=w.floors[0].encounters[0];g.participants=ids;for(const a of w.actors){a.x=330;a.eligible=true;}for(const m of g.monsters){m.kind='ranged';m.due=999;}return w;}
test('selected alive member survives entry and target changes during economic qualification',()=>{
 let w=fresh();w.actors[0].x=300;
 let r=stepFieldWorld(w,[{actorId:'a',kind:'target',target:{kind:'monster',id:'f0-e0-m1'}}],100);
 assert.equal(r.world.actors[0].target?.kind==='monster'&&r.world.actors[0].target.id,'f0-e0-m1');
 const cost=r.effects.find(e=>e.type==='consume-needed')!;assert.ok(cost);
 r=stepFieldWorld(r.world,[{actorId:'a',kind:'target',target:{kind:'monster',id:'f0-e0-m0'}}],0);
 r=stepFieldWorld(r.world,[],0,[{eventId:cost.id,actorId:'a',accepted:true}]);
 assert.equal(r.world.active,0);assert.deepEqual(r.world.actors[0].target,{kind:'monster',id:'f0-e0-m0'});
 r=stepFieldWorld(r.world,[{actorId:'a',kind:'target',target:{kind:'monster',id:'f0-e0-m1'}}],1000);
 assert.equal(r.world.events.find(e=>e.kind==='attack')?.targetId,'f0-e0-m1');
});
test('melee honors selected target independently per owned actor instead of nearest',()=>{
 const w=active(['a','b']);w.actors[0].target={kind:'monster',id:'f0-e0-m1'};w.actors[1].target={kind:'monster',id:'f0-e0-m0'};
 const r=stepFieldWorld(w,[],100),g=r.world.floors[0].encounters[0];
 assert.equal(r.world.events.find(e=>e.kind==='attack'&&e.actorId==='a')?.targetId,'f0-e0-m1');
 assert.equal(r.world.events.find(e=>e.kind==='attack'&&e.actorId==='b')?.targetId,'f0-e0-m0');
 assert.deepEqual(g.monsters.map(m=>m.hp),[9,9]);assert.deepEqual(w.floors[0].encounters[0].monsters.map(m=>m.hp),[15,15]);
});
test('approach uses the selected target; invalid, dead and absent selections fall back to nearest living group member',()=>{
 const w=active();w.actors[0].x=200;w.actors[0].target={kind:'monster',id:'f0-e0-m1'};w.floors[0].encounters[0].monsters[0].x=120;w.floors[0].encounters[0].monsters[1].x=350;
 assert.ok(stepFieldWorld(w,[],100).world.actors[0].x>200);
 for(const selection of ['dead','foreign','absent']){const f=active();f.actors[0].target=selection==='absent'?null:{kind:'monster',id:selection==='foreign'?'f0-e1-m0':'f0-e0-m1'};if(selection==='dead')f.floors[0].encounters[0].monsters[1].hp=0;assert.equal(stepFieldWorld(f,[],100).world.events.find(e=>e.kind==='attack')?.targetId,'f0-e0-m0');}
});
test('staff aims at selected target but its projectile stays fixed and collides with the first intersecting enemy',()=>{
 const w=active();w.actors[0].x=330;w.actors[0].loadout.gear=['resonant-staff'];w.actors[0].target={kind:'monster',id:'f0-e0-m1'};const g=w.floors[0].encounters[0];g.monsters[0].x=310;g.monsters[1].x=500;
 let r=stepFieldWorld(w,[],100);assert.equal(r.world.events.find(e=>e.kind==='shot')?.targetId,'f0-e0-m1');assert.equal(r.world.projectiles[0].direction,1);
 r.world.actors[0].nextAttack=999;r.world.floors[0].encounters[0].monsters[1].x=100;r.world.floors[0].encounters[0].monsters[0].x=390;
 r=stepFieldWorld(r.world,[],100);assert.equal(r.world.events.find(e=>e.kind==='attack')?.targetId,'f0-e0-m0');assert.equal(r.world.floors[0].encounters[0].monsters[1].hp,15);
});

test('after selected monster dies the next melee attack falls back without requiring a new click',()=>{
 const w=active();w.actors[0].target={kind:'monster',id:'f0-e0-m1'};w.floors[0].encounters[0].monsters[1].hp=6;let r=stepFieldWorld(w,[],100);assert.equal(r.world.floors[0].encounters[0].monsters[1].hp,0);r=stepFieldWorld(r.world,[],1000);assert.deepEqual(r.world.events.filter(e=>e.kind==='attack').map(e=>e.targetId),['f0-e0-m1','f0-e0-m0']);
});
