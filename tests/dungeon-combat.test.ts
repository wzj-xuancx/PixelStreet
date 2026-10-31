import test from 'node:test';
import assert from 'node:assert/strict';
import {FixedClock,STEP_MS} from '../packages/dungeon-core/foundation';
import {createEncounter as createDungeon,createDungeon as createFloor,stepDungeon,dungeonInput,clearDungeonControls,currentRoom,activeWeapon,nearbyInteractions,parseDungeonInput,parseDungeonRun,hurtShape,movementShape} from '../packages/dungeon-core';
import type {DungeonRun,Enemy,WeaponKind,Projectile} from '../packages/dungeon-core';
function sandbox(kind:WeaponKind='sword'):DungeonRun {
  const r=createDungeon(123),room=currentRoom(r);room.enemies=[];room.obstacles=[];room.traps=[];room.cleared=true;room.wave=room.totalWaves;room.locked=false;
  r.player.x=100;r.player.y=100;r.player.aimX=500;r.player.aimY=100;r.player.weaponSlots[0]!.kind=kind;return r;
}
function target(r:DungeonRun,id:string,x:number,y=100,hp=200):Enemy {
  const e:Enemy={id,kind:'chaser',bossPhase:0,pattern:'none',x,y,hp,maxHp:hp,radius:12,state:'recover',stateUntil:1e9,attackReady:1e9,aimX:1,aimY:0,burnUntil:0,frost:0,frozenUntil:0};currentRoom(r).enemies.push(e);return e;
}
function advance(r:DungeonRun,ms:number):void {let left=ms;while(left>1e-7){const dt=Math.min(left,STEP_MS);stepDungeon(r,dt);left-=dt;}}
function control(r:DungeonRun,firing:boolean,moveX=0,moveY=0,aimX=500,aimY=100):void{dungeonInput(r,{type:'control',moveX,moveY,aimX,aimY,firing});}
function incoming(r:DungeonRun,damage:number):void {const s:Projectile={id:`fixture-${r.tick}`,kind:'enemy',weaponId:null,sourceKind:'enemy',generation:0,owner:'enemy',x:r.player.x,y:hurtShape(r.player,'player',r.combat.profile).center.y,vx:0,vy:0,radius:7,damage,expiresAt:r.elapsedMs+100,bornAt:r.elapsedMs,leg:'out',hitIds:[],charge:0,nextHitAt:0,bounces:0};r.projectiles.push(s);stepDungeon(r);}

test('same input and seed produce identical state under 60, 120 and irregular render schedules',()=>{
  function schedule(times:number[]):DungeonRun {const r=sandbox('fire'),c=new FixedClock();control(r,true,.4,.2);for(const t of times)c.advance(t,dt=>stepDungeon(r,dt));return r;}
  const regular=(hz:number)=>Array.from({length:hz*10+1},(_,i)=>i*1000/hz),irregular=[0];let t=0,i=0;while(t<10000){t=Math.min(10000,t+[7,23,5,31,11][i++%5]);irregular.push(t);}
  const a=schedule(regular(60));assert.deepEqual(a,schedule(regular(120)));assert.deepEqual(a,schedule(irregular));assert.equal(a.tick,600);assert.ok(Math.abs(a.elapsedMs-10000)<1e-6);
});
test('WASD diagonal is normalized and dash preserves a cardinal movement direction',()=>{
  const a=sandbox(),b=sandbox();control(a,false,1,0);control(b,false,1,1);advance(a,600);advance(b,600);assert.ok(Math.abs(Math.hypot(a.player.x-100,a.player.y-100)-Math.hypot(b.player.x-100,b.player.y-100))<1e-6);
  dungeonInput(a,{type:'dash'});const y=a.player.y;advance(a,100);assert.equal(a.player.y,y);assert.ok(a.player.x>230);
});
test('idle input never attacks or automatically picks up a weapon',()=>{const r=sandbox('fire'),e=target(r,'target',160);r.player.x=132;r.player.y=312;advance(r,2000);assert.equal(e.hp,200);assert.equal(r.projectiles.length,0);assert.equal(r.player.weaponSlots[1],null);assert.equal(currentRoom(r).ground.length,4);});
test('sword damages and knocks back only enemies inside its forward arc and range',()=>{const r=sandbox(),front=target(r,'front',145),back=target(r,'back',70),far=target(r,'far',210);control(r,true);advance(r,210);assert.ok(front.hp<200);assert.ok(front.x>145);assert.equal(back.hp,200);assert.equal(far.hp,200);});
test('fire projectile applies damage then burns after firing stops',()=>{const r=sandbox('fire'),e=target(r,'target',180);control(r,true);advance(r,230);control(r,false);const hp=e.hp;assert.ok(hp<178);assert.ok(e.burnUntil>r.elapsedMs);advance(r,1000);assert.ok(e.hp<hp-8);});
test('frost charges without auto-release, then releases a piercing arrow and freezes both targets',()=>{const r=sandbox('frost'),a=target(r,'first',170),b=target(r,'second',240);control(r,true);advance(r,1100);assert.equal(a.hp,200);assert.equal(r.projectiles.length,0);assert.equal(r.player.chargeStarted,0);control(r,false);assert.equal(r.projectiles[0].charge,1);advance(r,400);assert.ok(a.hp<160&&b.hp<160);assert.ok(a.frozenUntil>r.elapsedMs&&b.frozenUntil>r.elapsedMs);assert.equal(r.player.chargeStarted,null);});
test('three partial frost shots accumulate freeze while a tap causes less damage',()=>{const r=sandbox('frost'),e=target(r,'target',180);for(let i=0;i<3;i++){control(r,true);advance(r,100);control(r,false);advance(r,400);}assert.ok(e.hp<150&&e.hp>100);assert.ok(e.frozenUntil>r.elapsedMs);});
test('lightning chains actual damage to three neighboring targets without re-hitting one',()=>{const r=sandbox('lightning'),a=target(r,'a',170),b=target(r,'b',270),c=target(r,'c',370),far=target(r,'far',600);control(r,true);stepDungeon(r);assert.equal(a.hp,174);assert.ok(b.hp<200&&c.hp<200);assert.equal(far.hp,200);assert.equal(r.effects.filter(e=>e.kind==='lightning').length,3);});
test('boomerang hits a target once on each leg and is caught',()=>{const r=sandbox('boomerang'),e=target(r,'target',195);control(r,true);stepDungeon(r);control(r,false);advance(r,1200);assert.equal(e.hp,158);assert.equal(r.projectiles.length,0);});
test('boomerang return steers toward a moving owner rather than its launch point',()=>{const r=sandbox('boomerang');control(r,true);stepDungeon(r);control(r,false);advance(r,500);r.player.y=210;stepDungeon(r);const s=r.projectiles[0];assert.equal(s.leg,'return');assert.ok(s.vy>100);advance(r,1000);assert.equal(r.projectiles.length,0);});
test('explicit dual-slot pickup, replacement and recovery conserve item identity and level',()=>{const r=sandbox(),room=currentRoom(r);r.player.x=132;r.player.y=312;const fire=room.ground.find(g=>g.weapon.kind==='fire')!;dungeonInput(r,{type:'interact',id:fire.id});assert.equal(r.player.weaponSlots[1]?.kind,'fire');assert.equal(activeWeapon(r)!.kind,'sword');dungeonInput(r,{type:'switch'});assert.equal(activeWeapon(r)!.kind,'fire');activeWeapon(r)!.level=4;
  r.player.x=168;const frost=room.ground.find(g=>g.weapon.kind==='frost')!;dungeonInput(r,{type:'interact',id:frost.id});assert.equal(activeWeapon(r)!.kind,'frost');const dropped=room.ground.find(g=>g.weapon.kind==='fire')!;assert.equal(dropped.weapon.id,'weapon-fire');assert.equal(dropped.weapon.level,4);assert.equal(nearbyInteractions(r).some(g=>g.id===dropped.id),true);dungeonInput(r,{type:'interact',id:dropped.id});assert.equal(activeWeapon(r)!.id,'weapon-fire');assert.equal(activeWeapon(r)!.level,4);const ids=[...r.player.weaponSlots.filter(Boolean).map(w=>w!.id),...room.ground.map(g=>g.weapon.id)];assert.equal(ids.length,5);assert.equal(new Set(ids).size,5);
});
test('out-of-range interaction is rejected and comparison data is isolated',()=>{const r=sandbox();const room=currentRoom(r),g=room.ground[0];dungeonInput(r,{type:'interact',id:g.id});assert.equal(room.ground.length,4);r.player.x=g.x;r.player.y=g.y;const data=nearbyInteractions(r);data[0].weapon!.level=5;assert.equal(g.weapon.level,1);});
test('safe shield regeneration waits five seconds after damage and restores four points per second',()=>{const r=sandbox();incoming(r,15);assert.equal(r.player.hp,100);assert.equal(r.player.shield,25);advance(r,2900);assert.equal(r.player.shield,25);incoming(r,30);assert.equal(r.player.hp,95);assert.equal(r.player.shield,0);advance(r,4900);assert.equal(r.player.shield,0);advance(r,1500);assert.ok(r.player.shield>5.5&&r.player.shield<5.7);});
test('pause clears held movement, firing and charge and freezes time and shield',()=>{const r=sandbox('frost');r.player.shield=0;control(r,true,1,0);advance(r,200);dungeonInput(r,{type:'pause',paused:true});const saved=structuredClone(r);advance(r,5000);assert.deepEqual(r,saved);assert.equal(r.player.moveX,0);assert.equal(r.player.firing,false);assert.equal(r.player.chargeStarted,null);dungeonInput(r,{type:'pause',paused:false});advance(r,100);assert.equal(r.player.x,saved.player.x);assert.equal(r.projectiles.length,0);clearDungeonControls(r);});
test('two waves keep doors sealed between waves and open once, with settled rewards only once',()=>{const r=createDungeon(99),room=currentRoom(r);room.traps=[];room.enemies.forEach(e=>e.hp=0);stepDungeon(r);assert.equal(room.wave,1);assert.equal(room.locked,true);assert.equal(room.cleared,false);advance(r,1100);assert.equal(room.wave,2);assert.equal(room.enemies.length,4);assert.equal(room.locked,true);room.enemies.forEach(e=>e.hp=0);stepDungeon(r);assert.equal(room.locked,false);assert.equal(room.cleared,true);const rewards={...r.reward};advance(r,4000);assert.deepEqual(r.reward,rewards);assert.equal(room.enemies.length,0);});
test('trap gives a visible windup and only damages once per active window',()=>{const r=sandbox(),room=currentRoom(r);room.traps=[{id:'test-trap',x:100,y:100,radius:28,state:'idle',stateUntil:100,hit:false}];advance(r,150);assert.equal(room.traps[0].state,'windup');assert.equal(r.player.shield,40);advance(r,950);const shield=r.player.shield;assert.equal(shield,24);advance(r,200);assert.equal(r.player.shield,shield);});
test('strict input parser rejects non-finite values, unknown fields and unsupported commands',()=>{for(const raw of [{type:'control',moveX:Infinity,moveY:0,aimX:0,aimY:0,firing:false},{type:'control',moveX:2,moveY:0,aimX:0,aimY:0,firing:false},{type:'dash',extra:1},{type:'skill',skill:'win'},{type:'interact',id:'../../save'},{type:'pause',paused:'yes'},{type:'next-level'}])assert.equal(parseDungeonInput(raw),null);assert.deepEqual(parseDungeonInput({type:'switch'}),{type:'switch'});});
test('run parser roundtrips valid state and rejects malformed, duplicate and over-budget entities',()=>{const r=createDungeon(42);assert.deepEqual(parseDungeonRun(r),r);const parsed=parseDungeonRun(r)!;parsed.player.hp=1;assert.equal(r.player.hp,100);const cases:((v:DungeonRun)=>void)[]=[v=>v.player.hp=Infinity,v=>v.player.hp=101,v=>v.player.weaponSlots[0]!.level=6 as 1,v=>v.rooms[0].enemies=Array.from({length:25},()=>({...v.rooms[0].enemies[0]})),v=>v.rooms[0].ground[0].weapon.id=v.player.weaponSlots[0]!.id,v=>v.currentRoom='missing',v=>v.projectiles=Array.from({length:193},()=>({} as Projectile)),v=>(v as unknown as Record<string,unknown>).surprise=true];for(const mutate of cases){const v=structuredClone(r);mutate(v);assert.equal(parseDungeonRun(v),null);}advance(r,1000);assert.ok(parseDungeonRun(r));});
test('solid cover blocks melee, lightning and fast projectiles across the entire travel segment',()=>{for(const kind of ['sword','lightning','fire'] as WeaponKind[]){const r=sandbox(kind),e=target(r,'covered',150);currentRoom(r).obstacles=[{id:'cover',x:122,y:70,width:12,height:60,kind:'pillar',hp:100}];control(r,true);stepDungeon(r,100);assert.equal(e.hp,200);advance(r,400);assert.equal(e.hp,200);}});
test('enemy attacks announce windup before damage and ward protects against an incoming hit',()=>{const r=sandbox(),e=target(r,'attacker',125);e.state='idle';e.stateUntil=0;e.attackReady=0;stepDungeon(r);assert.equal(e.state,'windup');assert.equal(r.player.shield,40);advance(r,350);assert.equal(r.player.shield,40);advance(r,100);assert.equal(r.player.shield,30);dungeonInput(r,{type:'skill',skill:'ward'});incoming(r,60);assert.equal(r.player.shield,30);assert.equal(r.player.hp,100);});
test('lethal damage ends simulation and clears held input',()=>{const r=sandbox();control(r,true,1,0);incoming(r,1000);assert.equal(r.phase,'lost');assert.equal(r.player.hp,0);assert.equal(r.player.firing,false);assert.equal(r.player.moveX,0);const before=structuredClone(r);advance(r,1000);assert.deepEqual(r,before);});
test('persistence rejects a sequence rollback that would collide with existing entities',()=>{const r=createDungeon(1);r.sequence=0;assert.equal(parseDungeonRun(r),null);});
test('persistence rejects sparse collections without throwing, including nested and weapon-slot holes',()=>{
  const cases:((r:DungeonRun)=>void)[]=[
    r=>r.rooms=new Array(1),r=>currentRoom(r).enemies=new Array(1),r=>currentRoom(r).doors=new Array(1),
    r=>currentRoom(r).obstacles=new Array(1),r=>currentRoom(r).ground=new Array(1),r=>currentRoom(r).traps=new Array(1),
    r=>r.projectiles=new Array(1),r=>r.effects=new Array(1),r=>r.choices=new Array(1),
    r=>r.player.traits=new Array(1),r=>r.player.runes=new Array(1),
    r=>r.player.weaponSlots=new Array(2) as DungeonRun['player']['weaponSlots'],
    r=>{const slots=new Array(2) as DungeonRun['player']['weaponSlots'];slots[0]=r.player.weaponSlots[0];r.player.weaponSlots=slots;},
    r=>{const inherited=Object.create(Array.prototype) as unknown[];inherited[0]=currentRoom(r).enemies[0];const enemies=new Array(1);Object.setPrototypeOf(enemies,inherited);currentRoom(r).enemies=enemies;},
    r=>{r.player.weaponSlots[0]!.kind='fire';control(r,true);stepDungeon(r);r.projectiles[0].hitIds=new Array(1);}
  ];
  for(const mutate of cases){const r=createDungeon(1001);mutate(r);assert.doesNotThrow(()=>assert.equal(parseDungeonRun(r),null));}
  assert.ok(parseDungeonRun(createDungeon(1001)));
});
test('room-relative geometry rejects unreachable or embedded entities rather than clamping on step',()=>{
  const bad:((r:DungeonRun)=>void)[]=[
    r=>r.player.x=0,r=>r.player.x=24+movementShape(r.player,'player',r.combat.profile).radius-.1,r=>r.player.y=currentRoom(r).height-24-movementShape(r.player,'player',r.combat.profile).radius+.1,
    r=>{r.player.x=300;r.player.y=160;},
    r=>currentRoom(r).ground[0].x=1500,r=>currentRoom(r).ground[0].x=31,
    r=>{currentRoom(r).ground[0].x=300;currentRoom(r).ground[0].y=160;},
    r=>currentRoom(r).enemies[0].x=24+movementShape(currentRoom(r).enemies[0],'enemy',r.combat.profile,12).radius-.1,r=>currentRoom(r).enemies[0].y=1000,
    r=>currentRoom(r).obstacles[0].x=10,r=>currentRoom(r).obstacles[0].width=500,
    r=>currentRoom(r).traps[0].x=700,r=>currentRoom(r).traps[0].y=10,
    r=>currentRoom(r).width=300
  ];
  for(const mutate of bad){const r=createDungeon(111);mutate(r);assert.equal(parseDungeonRun(r),null);}
  const r=sandbox();r.player.x=35;r.player.y=35;assert.ok(parseDungeonRun(r));const p={x:r.player.x,y:r.player.y};stepDungeon(r);assert.deepEqual({x:r.player.x,y:r.player.y},p);
});
test('door sides and destinations must be unique, existent and non-self',()=>{
  function twoRooms():DungeonRun {const r=createDungeon(111),second=structuredClone(currentRoom(r));second.id='other';second.gridX=1;second.obstacles=[];second.ground=[];second.enemies=[];second.traps=[];r.rooms.push(second);return r;}
  for(const doors of [[{to:'missing',side:'E'}],[{to:'encounter',side:'E'}],[{to:'other',side:'E'},{to:'other',side:'W'}]] as DungeonRun['rooms'][number]['doors'][]){const r=twoRooms();currentRoom(r).doors=doors;assert.equal(parseDungeonRun(r),null);}
  const r=twoRooms(),third=structuredClone(r.rooms[1]);third.id='third';third.gridX=2;r.rooms.push(third);currentRoom(r).doors=[{to:'other',side:'N'},{to:'third',side:'N'}];assert.equal(parseDungeonRun(r),null);currentRoom(r).doors=[{to:'other',side:'E'}];r.rooms[1].doors=[{to:'encounter',side:'W'},{to:'third',side:'E'}];third.doors=[{to:'other',side:'W'}];assert.ok(parseDungeonRun(r));
});
test('accepted exact numerical limits remain parseable after input and stepping, preserving settled rewards',()=>{
  const mutations:((r:DungeonRun)=>void)[]=[r=>r.elapsedMs=1e12,r=>r.tick=1e10,r=>r.sequence=1e10,r=>r.revision=1e10];
  for(const mutate of mutations){const r=createDungeon(111);r.reward={coins:123,xp:456};mutate(r);assert.ok(parseDungeonRun(r));dungeonInput(r,{type:'dash'});stepDungeon(r);assert.equal(r.phase,'lost');assert.deepEqual(r.reward,{coins:123,xp:456});assert.ok(parseDungeonRun(r));}
  const r=createDungeon(111);r.reward={coins:1e9,xp:1e9};currentRoom(r).enemies.forEach(e=>e.hp=0);assert.ok(parseDungeonRun(r));stepDungeon(r);assert.deepEqual(r.reward,{coins:1e9,xp:1e9});assert.ok(parseDungeonRun(r));
  const near=createDungeon(111);near.elapsedMs=1e12-10000;near.tick=1e10-1;near.sequence=1e10-20001;dungeonInput(near,{type:'skill',skill:'ward'});stepDungeon(near);assert.ok(parseDungeonRun(near));stepDungeon(near);assert.ok(parseDungeonRun(near));assert.equal(near.phase,'lost');
});
test('wall-edge weapon behavior and generated combat preserve the parse-after-step closure',()=>{
  for(const kind of ['sword','fire','frost','lightning','boomerang'] as WeaponKind[]){for(const [x,y,aimX,aimY] of [[35,35,-100,-100],[685,493,900,700]]){const r=sandbox(kind);r.player.x=x;r.player.y=y;for(let i=0;i<180;i++){control(r,i%75<60,0,0,aimX,aimY);stepDungeon(r);assert.ok(parseDungeonRun(r),`${kind} wall step ${i}`);}}}
  for(const seed of [0,1,1001]){const r=createDungeon(seed);for(let i=0;i<1800;i++){control(r,i%80<60,Math.sin(i/90),Math.cos(i/90),500,260);if(i%150===0)dungeonInput(r,{type:'skill',skill:'burst'});stepDungeon(r);assert.ok(parseDungeonRun(r),`seed ${seed} step ${i}`);}}
});
test('forty minutes of live room time remain inside persistence bounds',()=>{const r=sandbox();for(let i=0;i<24000;i++){stepDungeon(r,100);if(i%100===0)assert.ok(parseDungeonRun(r));}assert.equal(r.elapsedMs,2400000);assert.equal(r.phase,'exploring');assert.ok(parseDungeonRun(r));});
test('a valid smaller room spawns its next wave within its dimensions and outside cover',()=>{const r=createDungeon(111),room=currentRoom(r);room.width=480;room.height=360;room.enemies=[];room.ground=[];room.traps=[];room.obstacles=[{id:'scaled-cover',x:320,y:60,width:80,height:80,kind:'pillar',hp:100}];room.nextWaveAt=1;r.player.x=100;r.player.y=100;assert.ok(parseDungeonRun(r));stepDungeon(r);assert.equal(room.wave,2);assert.equal(room.enemies.length,4);for(let i=0;i<120;i++){assert.ok(parseDungeonRun(r));stepDungeon(r);}assert.ok(parseDungeonRun(r));});
test('input guards exact sequence and revision limits before dash effects or slot mutation while pause stays safe',()=>{
  const r=createDungeon(1001);r.player.x=132;r.player.y=312;dungeonInput(r,{type:'interact',id:'ground-fire'});r.revision=1e10;assert.ok(parseDungeonRun(r));dungeonInput(r,{type:'switch'});assert.equal(r.player.activeSlot,0);assert.equal(r.phase,'lost');assert.ok(parseDungeonRun(r));
  const s=createDungeon(1001);s.sequence=1e10;const before=s.effects.length;assert.ok(parseDungeonRun(s));dungeonInput(s,{type:'dash'});assert.equal(s.sequence,1e10);assert.equal(s.effects.length,before);assert.equal(s.phase,'lost');assert.ok(parseDungeonRun(s));
  const paused=createDungeon(1001);paused.sequence=1e10;paused.player.firing=true;dungeonInput(paused,{type:'pause',paused:true});assert.equal(paused.paused,true);assert.equal(paused.player.firing,false);assert.ok(parseDungeonRun(paused));dungeonInput(paused,{type:'pause',paused:false});stepDungeon(paused);assert.equal(paused.phase,'lost');assert.ok(parseDungeonRun(paused));
});

test('ordinary fire, frost and enemy projectiles keep their original velocity after aim or target movement',()=>{for(const kind of ['fire','frost'] as const){const r=sandbox(kind);control(r,true);if(kind==='frost'){advance(r,500);control(r,false);}else stepDungeon(r);const shot=r.projectiles[0];assert.ok(shot);const velocity={x:shot.vx,y:shot.vy},start={x:shot.x,y:shot.y};control(r,false,0,0,100,450);target(r,'moving-target',450,300);advance(r,150);assert.deepEqual({x:shot.vx,y:shot.vy},velocity);assert.ok(Math.abs(shot.x-start.x-velocity.x*.15)<1e-6);assert.ok(Math.abs(shot.y-start.y-velocity.y*.15)<1e-6);}
  const r=sandbox(),e=target(r,'shooter',350,100);e.kind='shooter';e.state='windup';e.stateUntil=0;e.aimX=-1;e.aimY=0;stepDungeon(r);const s=r.projectiles[0],velocity={x:s.vx,y:s.vy},start={x:s.x,y:s.y};r.player.y=220;advance(r,150);assert.deepEqual({x:s.vx,y:s.vy},velocity);assert.ok(Math.abs(s.x-start.x-velocity.x*.15)<1e-6);assert.ok(Math.abs(s.y-start.y-velocity.y*.15)<1e-6);
});

test('production movement is faster with normalized diagonals while the F1 encounter speed stays frozen',()=>{const floor=createFloor(3),diagonal=createFloor(3),old=sandbox(),start={x:floor.player.x,y:floor.player.y};control(floor,false,1,0);control(diagonal,false,1,1);advance(floor,200);advance(diagonal,200);assert.ok(Math.abs(floor.player.x-start.x-39)<1e-6);assert.ok(Math.abs(Math.hypot(diagonal.player.x-start.x,diagonal.player.y-start.y)-39)<1e-6);control(old,false,1,0);advance(old,200);assert.ok(Math.abs(old.player.x-100-30)<1e-6);
  for(const kind of ['chaser','shooter','charger'] as const){const r=createFloor(3),room=currentRoom(r);room.kind='combat';room.encounterStarted=true;room.wave=1;room.totalWaves=2;room.locked=true;room.obstacles=[];room.traps=[];r.player.x=60;r.player.y=room.height/2;const e=target(r,'speed-probe',room.width-60,r.player.y);e.kind=kind;e.state='idle';e.attackReady=1e9;const x=e.x;stepDungeon(r,100);assert.ok(Math.abs(x-e.x-({chaser:95,shooter:85,charger:105}[kind])*.1)<1e-6);}
});
