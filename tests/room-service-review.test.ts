import test from 'node:test';
import assert from 'node:assert/strict';
import {RoomService} from '../apps/desktop/room-service';
import {emptyRoom,roomIdentityRank,roomIdentityTint} from '../packages/protocol/room';

const hostId='a'.repeat(32),guestId='b'.repeat(32);
const unsupported=/仅支持营地联机与挂机加成；主动战斗仍为单人/;
const member=(id:string,online=true)=>({id,name:id===hostId?'房主':'队友',online,inRun:true,active:true,available:true,returned:false,weapon:'wand' as const});

test('identity-ranked colors are deterministic across host and guest member ordering',()=>{
 const host=[member(guestId),member(hostId),member('0'.repeat(32))];
 const guest=[member('0'.repeat(32)),member(hostId),member(guestId)];
 for(const id of [hostId,guestId,'0'.repeat(32)]){
  assert.equal(roomIdentityRank(host,id),roomIdentityRank(guest,id));
  assert.equal(roomIdentityTint(host,id),roomIdentityTint(guest,id));
 }
 assert.notEqual(roomIdentityTint(host,hostId),roomIdentityTint(host,guestId));
});

test('legacy member activity and snapshots cannot reactivate multiplayer combat',async()=>{
 const service:any=Object.create(RoomService.prototype),sent:any[]=[],activeCalls:any[]=[];
 Object.assign(service,{
  state:{...emptyRoom([],hostId),status:'hosting',role:'host',hostId,members:[member(hostId),member(guestId)]},
  action:{state:{status:'ready',settled:false,source:{hostId,sequence:2,role:'host',playerId:hostId},run:{phase:'playing',stage:0,players:[]}},async active(ids:string[]){activeCalls.push(ids);}},
  game:{state:{status:'ready',profile:{run:null,roomClaims:[]}},async request(){}},
  host:{send(_peer:string,payload:any){sent.push(payload);return true;}},
  serial:Promise.resolve(),desiredActive:false,selectedWeapon:'wand',lastMember:'',partyTarget:2,disposed:false,onUpdate(){}
 });
 service.state.runKey={hostId,sequence:2};service.state.runPhase='playing';
 await service.clientMessage({peerId:guestId},{type:'member',key:{hostId,sequence:2},weapon:'bow',available:true,active:true,settledSequence:0});
 assert.equal(service.state.members[1].active,false);
 assert.equal(service.state.members[1].inRun,false);
 assert.deepEqual(activeCalls,[]);
 assert.equal(sent.at(-1).type,'room');
 await service.clientMessage({peerId:guestId},{type:'intent',key:{hostId,sequence:2},input:{type:'move',x:20,y:30}});
 assert.match(sent.at(-1).message,unsupported);
 assert.deepEqual(activeCalls,[]);
});

test('legacy room start command and action snapshot are rejected at the RoomService boundary',async()=>{
 const service:any=Object.create(RoomService.prototype),actionCalls:any[]=[];
 Object.assign(service,{
  state:{...emptyRoom([],hostId),status:'hosting',role:'host',hostId,members:[member(hostId)]},
  action:{state:{status:'ready',settled:true,run:null},async startRoom(){actionCalls.push('start');}},
  game:{state:{status:'ready',profile:{run:null,roomClaims:[]}}},
  serial:Promise.resolve(),desiredActive:false,selectedWeapon:'wand',lastMember:'',partyTarget:1,disposed:false,onUpdate(){}
 });
 await assert.rejects(service.start('wand'),unsupported);
 await assert.rejects(service.setWeapon('bow'),unsupported);
 assert.deepEqual(actionCalls,[]);
});
