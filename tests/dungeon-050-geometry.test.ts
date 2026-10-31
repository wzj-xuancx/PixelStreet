import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../packages/dungeon-core';
const api=core;
test('050 shared feet movement and upper torso capsule are separate and profile scaled',()=>{
  assert.equal(typeof api.hurtShape,'function');
  for(const [profile,scale] of [['baseline',1],['mild',.8],['wide',.7]] as const){
    const move=api.movementShape({x:100,y:100},'player',profile),hurt=api.hurtShape({x:100,y:100},'player',profile);
    assert.deepEqual(move.center,{x:100,y:100});assert.equal(move.radius,11*scale);assert.equal(hurt.radius,12*scale);assert.equal(hurt.center.y,100-40*scale);
    assert.ok(api.sweptHurtContact({x:0,y:hurt.center.y},{x:200,y:hurt.center.y},1,{x:100,y:100},'player',profile));
    assert.equal(api.sweptHurtContact({x:0,y:100},{x:200,y:100},1,{x:100,y:100},'player',profile),null);
  }
});
test('050 sweep finds earliest exact contact at high speed, tangent and zero segment',()=>{
  assert.equal(typeof api.sweptHurtContact,'function');
  const hit=api.sweptHurtContact({x:0,y:80},{x:200,y:80},4,{x:100,y:100},'player','mild');assert.ok(hit);assert.ok(hit.t>0&&hit.t<.5);assert.ok(hit.point.x<100);assert.ok(Math.abs(Math.hypot(hit.normal.x,hit.normal.y)-1)<1e-8);
  assert.ok(api.sweptHurtContact({x:100,y:68},{x:100,y:68},0,{x:100,y:100},'player','mild'));
  assert.ok(api.sweptHurtContact({x:0,y:33},{x:200,y:33},0,{x:100,y:100},'player','baseline'));
  assert.equal(api.traceHurtContact({x:0,y:110},{x:200,y:110},1,{x:100,y:100},'player','mild').reason,'miss');
  assert.equal(api.traceHurtContact({x:NaN,y:80},{x:200,y:80},1,{x:100,y:100},'player','mild').reason,'invalid');
});
test('050 shield facing uses direction to attacker, front arc blocks and rear/zero miss',()=>{
  assert.equal(typeof api.shieldFacingContact,'function');assert.equal(api.shieldFacingContact({x:1,y:0},{x:1,y:.2}),true);assert.equal(api.shieldFacingContact({x:1,y:0},{x:-1,y:0}),false);assert.equal(api.shieldFacingContact({x:1,y:0},{x:0,y:1}),false);assert.equal(api.shieldFacingContact({x:0,y:0},{x:1,y:0}),false);
});
test('050 production bullets sweep torso at high speed, miss feet, preserve velocity and trace immune contact',()=>{
 function floor(){const r=core.createDungeon(77);for(const to of ['crossroads','battle-a']){const room=core.currentRoom(r),door=core.roomDoors(r).find(d=>d.to===to)!;r.player.x=door.side==='W'?35:door.side==='E'?room.width-35:room.width/2;r.player.y=door.side==='N'?35:door.side==='S'?room.height-35:room.height/2;core.dungeonInput(r,{type:'control',moveX:door.side==='W'?-1:door.side==='E'?1:0,moveY:door.side==='N'?-1:door.side==='S'?1:0,aimX:100,aimY:100,firing:false});core.stepDungeon(r);assert.equal(r.currentRoom,to);core.dungeonInput(r,{type:'control',moveX:0,moveY:0,aimX:r.player.x,aimY:r.player.y,firing:false});}const room=core.currentRoom(r);let guard=0;while(room.spawns.pending.length&&guard++<3000)core.stepDungeon(r,core.STEP_MS);assert.ok(guard<3000,'wait for a production ticket batch before hitbox isolation');room.obstacles=[];room.traps=[];room.ground=[];room.enemies=room.enemies.slice(0,1);r.combat.enemyRuntime=r.combat.enemyRuntime.filter(runtime=>room.enemies.some(enemy=>enemy.id===runtime.enemyId));room.spawns={...room.spawns,phase:'idle',plan:[],waveIndex:0,batchIndex:0,pending:[],retryAt:0};room.nextWaveAt=0;const enemy=room.enemies[0];assert.ok(enemy);Object.assign(enemy,{kind:'chaser',x:170,y:100,state:'recover',stateUntil:1e9});r.player.x=100;r.player.y=100;r.player.moveX=0;r.player.moveY=0;r.rooms=[room];room.doors=[];room.gridX=room.gridY=0;return r;}
 for(const feetOnly of [true,false]){const run=floor(),enemy=core.currentRoom(run).enemies[0],hp=enemy.hp,center=core.hurtShape(enemy,enemy.kind,run.combat.profile,enemy.radius).center;
  run.projectiles.push({id:'fixture-fast',kind:'frost',weaponId:null,sourceKind:'projectile',generation:0,owner:'player',x:100,y:feetOnly?enemy.y:center.y,vx:1000,vy:0,radius:1,damage:10,expiresAt:run.elapsedMs+1000,bornAt:run.elapsedMs,leg:'out',hitIds:[],charge:0,nextHitAt:0,bounces:0});core.stepDungeon(run,100);
  assert.equal(enemy.hp,feetOnly?hp:hp-10);assert.ok(core.parseDungeonRun(run));if(!feetOnly){const feedback=run.combat.feedback.find(f=>f.sourceId==='fixture-fast')!;assert.ok(feedback);assert.ok(feedback.point.x<enemy.x);assert.ok(feedback.point.y<enemy.y);}
 }
 for(const immune of [true,false]){const run=core.createDungeon(78),center=core.hurtShape(run.player,'player',run.combat.profile).center,shield=run.player.shield;run.player.wardUntil=immune?1000:0;run.projectiles.push({id:'fixture-hostile',kind:'enemy',weaponId:null,sourceKind:'enemy',generation:0,owner:'enemy',x:center.x-50,y:center.y,vx:1000,vy:0,radius:2,damage:10,expiresAt:1000,bornAt:0,leg:'out',hitIds:[],charge:0,nextHitAt:0,bounces:0});core.stepDungeon(run,100);assert.equal(run.player.shield,immune?shield:shield-10);assert.ok(run.combat.feedback.some(f=>f.kind===(immune?'immune':'hit')));assert.ok(core.parseDungeonRun(run));}
});
function groundContactRun(profile:core.GeometryProfile):core.DungeonRun {
 const r=core.createDungeon(79);r.combat.profile=profile;
 for(const to of ['crossroads','battle-a']){const room=core.currentRoom(r),door=core.roomDoors(r).find(d=>d.to===to)!;r.player.x=door.side==='W'?35:door.side==='E'?room.width-35:room.width/2;r.player.y=door.side==='N'?35:door.side==='S'?room.height-35:room.height/2;core.dungeonInput(r,{type:'control',moveX:door.side==='W'?-1:door.side==='E'?1:0,moveY:door.side==='N'?-1:door.side==='S'?1:0,aimX:100,aimY:100,firing:false});core.stepDungeon(r);assert.equal(r.currentRoom,to);core.dungeonInput(r,{type:'control',moveX:0,moveY:0,aimX:r.player.x,aimY:r.player.y,firing:false});}
 const room=core.currentRoom(r);let guard=0;while(room.spawns.pending.length&&guard++<3000)core.stepDungeon(r,core.STEP_MS);assert.ok(guard<3000,'geometry fixture waits for its real spawn warning and settle');
 room.obstacles=[];room.traps=[];room.enemies=room.enemies.slice(0,1);r.combat.enemyRuntime=r.combat.enemyRuntime.filter(runtime=>room.enemies.some(enemy=>enemy.id===runtime.enemyId));
 // Hitbox probes keep a real production-spawned target but detach the rest of its queued plan.
 room.spawns={...room.spawns,phase:'idle',plan:[],waveIndex:0,batchIndex:0,pending:[],retryAt:0};room.nextWaveAt=0;
 Object.assign(room.enemies[0],{kind:'chaser',x:200,y:200,state:'recover',stateUntil:1e9});r.player.x=100;r.player.y=100;r.player.moveX=0;r.player.moveY=0;r.rooms=[room];room.doors=[];room.gridX=room.gridY=0;return r;
}
test('050 ground trap, impact, melee and charges use actual profile foot circles without scaling attack reach',()=>{
 for(const profile of ['baseline','mild'] as const)for(const source of ['trap','impact','chaser','charger','boss-charge'] as const){
  const run=groundContactRun(profile),room=core.currentRoom(run),e=room.enemies[0],shield=run.player.shield;
  if(source==='trap')room.traps=[{id:'fixture-edge-trap',x:138,y:100,radius:28,state:'active',stateUntil:run.elapsedMs+1000,hit:false}];
  else if(source==='impact')run.zones=[{id:'fixture-edge-impact',kind:'boss-impact',x:165,y:100,radius:55,startsAt:0,expiresAt:run.elapsedMs+1000,nextPulseAt:0,damage:10}];
  else if(source==='chaser'){Object.assign(e,{x:141,y:100,state:'windup',stateUntil:0});const origin=core.hurtShape(e,'chaser',profile,e.radius).center,target=core.hurtShape(run.player,'player',profile).center,dx=target.x-origin.x,dy=target.y-origin.y,length=Math.hypot(dx,dy);e.aimX=dx/length;e.aimY=dy/length;}
  else {Object.assign(e,{x:source==='charger'?121:130,y:100,kind:source==='charger'?'charger':'boss',radius:source==='charger'?12:22,state:'attack',pattern:source==='charger'?'none':'charge',stateUntil:run.elapsedMs+1000,aimX:0,aimY:0});if(source==='boss-charge'){e.bossPhase=1;room.kind='boss';room.totalWaves=1;}}
  core.stepDungeon(run,.001);const expected=source==='chaser'?true:profile==='baseline';assert.equal(run.player.shield<shield,expected,`${profile} ${source} edge`);assert.ok(core.parseDungeonRun(run));
 }
});
test('050 timed sword contacts the torso capsule; ground areas retain scaled enemy foot circles',()=>{
 for(const profile of ['baseline','mild'] as const)for(const source of ['sword','burning','meteor'] as const){const run=groundContactRun(profile),enemy=core.currentRoom(run).enemies[0],hp=enemy.hp;
  if(source==='sword'){enemy.x=166;enemy.y=100-17.5*(profile==='baseline'?1:.8);run.player.weaponSlots=[{id:'fixture-edge-sword',kind:'sword',level:1,evolved:false,form:'base'},null];core.dungeonInput(run,{type:'control',moveX:0,moveY:0,aimX:300,aimY:core.hurtShape(run.player,'player',profile).center.y,firing:true});for(let i=0;i<10;i++)core.stepDungeon(run,16);}
  else {enemy.x=161;enemy.y=100;run.zones=[{id:'fixture-edge-area',kind:source,x:100,y:100,radius:50,startsAt:0,expiresAt:run.elapsedMs+1000,nextPulseAt:0,damage:10}];core.stepDungeon(run,.001);}
  assert.equal(enemy.hp<hp,profile==='baseline',`${profile} ${source} edge`);assert.ok(core.parseDungeonRun(run));
 }
});
test('050 door opening accounts for scaled foot radius at the opening edge',()=>{
 for(const profile of ['baseline','mild'] as const){const run=core.createDungeon(79);run.combat.profile=profile;const room=core.currentRoom(run),door=core.roomDoors(run)[0],horizontal=door.side==='N'||door.side==='S';run.player.x=horizontal?room.width/2+50:door.side==='W'?35:room.width-35;run.player.y=horizontal?(door.side==='N'?35:room.height-35):room.height/2+50;core.dungeonInput(run,{type:'control',moveX:door.side==='W'?-1:door.side==='E'?1:0,moveY:door.side==='N'?-1:door.side==='S'?1:0,aimX:100,aimY:100,firing:false});core.stepDungeon(run);assert.equal(run.currentRoom===door.to,profile==='mild',`${profile} opening edge`);assert.ok(core.parseDungeonRun(run));}
});
function assertAimedAt(shot:core.Projectile,target:core.Point,label:string):void {
 const dx=target.x-shot.x,dy=target.y-shot.y,speed=Math.hypot(shot.vx,shot.vy);assert.ok(Math.abs(dx*shot.vy-dy*shot.vx)/speed<1e-7,`${label} ray misses requested point`);assert.ok(dx*shot.vx+dy*shot.vy>=0,`${label} flies away from requested point`);
}
test('050 production DungeonInput fire, frost release and boomerang rays pass through the actual mouse aim',()=>{
 for(const profile of ['baseline','mild','wide'] as const)for(const kind of ['fire','frost','boomerang'] as const){const r=core.createDungeon(80);r.combat.profile=profile;r.player.x=100;r.player.y=100;r.player.weaponSlots=[{id:`fixture-aim-${kind}`,kind,level:1,evolved:false,form:'base' as const},null];const target={x:300,y:100};
  core.dungeonInput(r,{type:'control',moveX:0,moveY:0,aimX:kind==='frost'?250:target.x,aimY:kind==='frost'?150:target.y,firing:true});core.stepDungeon(r);
  if(kind==='frost')core.dungeonInput(r,{type:'control',moveX:0,moveY:0,aimX:target.x,aimY:target.y,firing:false});
  const shot=r.projectiles.find(s=>s.kind===kind);assert.ok(shot);assertAimedAt(shot,target,`${profile}/${kind}`);const v={x:shot.vx,y:shot.vy};assert.ok(Math.abs(Math.hypot(v.x,v.y)-(kind==='fire'?330:kind==='frost'?490:290))<1e-7);
  core.dungeonInput(r,{type:'control',moveX:0,moveY:0,aimX:50,aimY:250,firing:false});core.stepDungeon(r);assert.deepEqual({x:shot.vx,y:shot.vy},v);assert.ok(core.parseDungeonRun(r));
 }
});
test('050 production shooter and boss fan center launch from their torso toward the player torso and then stay fixed',()=>{
 for(const kind of ['shooter','boss'] as const){const r=groundContactRun('mild'),room=core.currentRoom(r),e=room.enemies[0];Object.assign(e,{kind,radius:kind==='boss'?22:12,x:250,y:180,state:'windup',stateUntil:0,aimX:1,aimY:0});if(kind==='boss'){Object.assign(e,{bossPhase:1,pattern:'fan',hp:1100,maxHp:1100});room.kind='boss';room.totalWaves=1;}
  const target=core.hurtShape(r.player,'player',r.combat.profile).center,origin=core.hurtShape(e,e.kind,r.combat.profile,e.radius).center,dx=target.x-origin.x,dy=target.y-origin.y,length=Math.hypot(dx,dy);e.aimX=dx/length;e.aimY=dy/length;core.stepDungeon(r,.001);const shots=r.projectiles.filter(s=>s.owner==='enemy'),shot=shots[Math.floor(shots.length/2)];assert.ok(shot);assertAimedAt(shot,target,kind);const velocity={x:shot.vx,y:shot.vy};r.player.y+=40;core.stepDungeon(r);assert.deepEqual({x:shot.vx,y:shot.vy},velocity);assert.ok(core.parseDungeonRun(r));
 }
});
