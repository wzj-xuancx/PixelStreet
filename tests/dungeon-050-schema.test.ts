import test from 'node:test';
import assert from 'node:assert/strict';
import {createDungeon,parseDungeonRun,sourceKey} from '../packages/dungeon-core';
import fs from 'node:fs';
import path from 'node:path';
import {DungeonStore} from '../apps/desktop/dungeon-store';
import {legacyDungeonFixture} from './dungeon-legacy-fixture';
const plain=()=>JSON.parse(JSON.stringify(createDungeon(501)));
test('050 production default is v4 with serializable combat/spawn defaults',()=>{
 const run=plain();assert.equal(run.version,4);assert.equal(run.combat.profile,'mild');assert.equal(run.combat.transferUsed,false);assert.ok(run.rooms.every((r:any)=>r.spawns.pending.length===0));assert.deepEqual(parseDungeonRun(run),run);
});
test('050 structured action, feedback, ledger and pending plan roundtrip and reject relational corruption',()=>{
 const run=plain();run.player.weaponSlots[0]={id:'held-sword',kind:'sword',level:1,evolved:false,form:'base' as const};
 run.combat.action={id:'action-one',weaponId:'held-sword',kind:'sword',branch:'base',stage:'windup',special:false,mode:'blade',comboStep:1,strength:0,sampledAt:0,previousFeet:{x:100,y:100},startedAt:0,activeAt:50,recoverAt:80,endsAt:150,origin:{x:100,y:100},direction:{x:1,y:0},charge:0,damageScale:1,splitUsed:false,segment:0,hitIds:[],sweepHitIds:[]};
 run.combat.special={held:false,startedAt:null,readyAt:100};
 run.combat.enemyRuntime=[];
 run.combat.feedback=[{id:'contact-one',sourceId:'held-sword',targetId:'planned-one',kind:'miss',sourceKind:'basic',generation:0,point:{x:100,y:80},direction:{x:1,y:0},at:0,expiresAt:90,damage:0}];
 run.rooms.find((r:any)=>r.id==='crossroads').eventUsed=true;run.combat.rewardLedger=[{sourceId:sourceKey('event','crossroads'),roomId:'crossroads',kind:'event',coins:0,xp:0,essence:0,at:0}];
 const room=run.rooms.find((r:any)=>r.kind==='combat'),queue=[['entrance',['entrance'] as string[]]],seen=new Set(['entrance']);let route:string[]|undefined;while(queue.length){const [id,path]=queue.shift() as [string,string[]];if(id===room.id){route=path;break;}for(const door of run.rooms.find((r:any)=>r.id===id).doors)if(!seen.has(door.to)){seen.add(door.to);queue.push([door.to,[...path,door.to]]);}}
 assert.ok(route);for(const id of route!.slice(0,-1)){const prior=run.rooms.find((r:any)=>r.id===id);prior.visited=true;if(['combat','elite','boss'].includes(prior.kind)){prior.cleared=true;prior.locked=false;prior.encounterStarted=true;prior.wave=prior.totalWaves;prior.nextWaveAt=0;prior.enemies=[];}}
 const previous=run.rooms.find((r:any)=>r.id===route!.at(-2));const back=room.doors.find((d:any)=>d.to===previous.id);run.currentRoom=room.id;run.player.x=back.side==='W'?64:back.side==='E'?room.width-64:room.width/2;run.player.y=back.side==='N'?64:back.side==='S'?room.height-64:room.height/2;room.visited=true;room.encounterStarted=true;room.wave=1;room.locked=true;room.spawns={phase:'warning',plan:[{id:'plan-one',theme:'mixed',budget:1,batches:[{id:'batch-one',enemies:[{id:'planned-one',kind:'chaser'}]}]},{id:'plan-two',theme:'mixed',budget:1,batches:[{id:'batch-two',enemies:[{id:'planned-two',kind:'chaser'}]}]}],waveIndex:0,batchIndex:1,pending:[{id:'ticket-one',enemyId:'planned-one',kind:'chaser',waveIndex:0,batchIndex:0,point:{x:100,y:100},warningAt:0,materializeAt:1100,readyAt:1400,retries:0}],aliveCap:8,retryAt:0,rng:1};
 assert.deepEqual(parseDungeonRun(run),run);
 const changes=[(r:any)=>r.combat.action.hitIds=['dup','dup'],(r:any)=>r.combat.action.direction.x=0,(r:any)=>r.combat.action.activeAt=200,(r:any)=>r.combat.action.weaponId='missing',(r:any)=>r.combat.action.branch='reaper',(r:any)=>r.combat.special.startedAt=0,(r:any)=>r.combat.feedback[0].expiresAt=1001,(r:any)=>r.combat.feedback[0].id='held-sword',(r:any)=>r.combat.enemyRuntime.push({...r.combat.enemyRuntime[0]}),(r:any)=>r.combat.rewardLedger[0].roomId='missing',(r:any)=>r.rooms.find((x:any)=>x.kind==='combat').spawns.pending[0].enemyId='not-in-plan',(r:any)=>r.rooms.find((x:any)=>x.kind==='combat').spawns.pending[0].materializeAt=1500,(r:any)=>r.rooms.find((x:any)=>x.kind==='combat').spawns.plan[0].batches[0].enemies.push({id:'planned-one',kind:'shooter'}),(r:any)=>r.rooms.find((x:any)=>x.kind==='combat').cleared=true];
 for(const mutate of changes){const bad=structuredClone(run);mutate(bad);assert.equal(parseDungeonRun(bad),null);}
});
test('050 cold store load pauses a default run and migration preserves original v3 bytes before first write',()=>{
 const folder=fs.mkdtempSync('/private/tmp/pixelstreet050-task1-schema-');
 try{
  const run=createDungeon(88),store=new DungeonStore(folder);run.player.weaponSlots[0]={id:'cold-held-sword',kind:'sword',level:1,evolved:false,form:'base'};run.player.moveX=1;run.player.firing=true;run.combat.special={held:true,startedAt:0,readyAt:100};
  store.save({...store.value,claim:1,settled:false,run});const restored=new DungeonStore(folder);
  assert.equal(restored.value.run?.paused,true);assert.equal(restored.value.run?.player.moveX,0);assert.equal(restored.value.run?.combat.special.held,false);assert.equal(run.combat.special.held,true);
  const old=legacyDungeonFixture(createDungeon(89)),text=JSON.stringify({...store.value,claim:2,settled:false,run:old},null,2)+'\n';fs.writeFileSync(store.file,text);
  const migrated=new DungeonStore(folder);assert.equal(migrated.value.run?.version,4);assert.equal(fs.readFileSync(store.file,'utf8'),text);migrated.save(migrated.value);
  const backups=fs.readdirSync(folder).filter(name=>name.includes('.schema-v3-'));assert.equal(backups.length,1);assert.equal(fs.readFileSync(path.join(folder,backups[0]),'utf8'),text);assert.equal(new DungeonStore(folder).value.run?.paused,true);
 }finally{fs.rmSync(folder,{recursive:true,force:true});}
});
test('050 combat strict parser rejects unknown/nonfinite/bad rank, holes and duplicate source IDs',()=>{
 const mutations=[(r:any)=>r.combat.transferUsed='yes',(r:any)=>r.combat.extra=1,(r:any)=>r.combat.special.readyAt=Infinity,(r:any)=>r.combat.traitRanks=[{id:'shatter',rank:3}],(r:any)=>r.combat.feedback=new Array(1),(r:any)=>r.combat.normalClears=9,(r:any)=>r.combat.choicesTaken=6,(r:any)=>r.combat.feedback[Symbol('hidden')]=true,(r:any)=>r.combat[Symbol('hidden')]=true,(r:any)=>r.combat.rewardLedger=[0,1].map(()=>({sourceId:'dup',roomId:'entrance',kind:'room',coins:1,xp:1,essence:1,at:0})),(r:any)=>r.rooms[0].spawns.extra=true,(r:any)=>r.rooms[0].spawns.pending=new Array(1),(r:any)=>r.rooms[0].spawns.waveIndex=1];
 for(const change of mutations){const run=plain();assert.ok(run.combat,'combat namespace exists');change(run);assert.equal(parseDungeonRun(run),null);}
});
test('050 valid v3 migrates only after strict old validation without input mutation or grants',()=>{
 const old=legacyDungeonFixture(createDungeon(501));
 const before=structuredClone(old),parsed=parseDungeonRun(old);assert.ok(parsed);assert.equal(parsed.version,4);assert.deepEqual(old,before);assert.deepEqual(parsed.reward,old.reward);assert.equal((parsed as any).combat.rewardLedger.length,0);
 const bad:any=structuredClone(old);bad.player.extra=true;assert.equal(parseDungeonRun(bad),null);const badRoom:any=structuredClone(old);badRoom.rooms[0].extra=true;assert.equal(parseDungeonRun(badRoom),null);assert.equal(parseDungeonRun({...old,combat:{}}),null);const future=structuredClone(old);future.player.weaponSlots[0]={id:'future-hammer',kind:'hammer',level:1,evolved:false,form:'base' as const};assert.equal(parseDungeonRun(future),null);
});
