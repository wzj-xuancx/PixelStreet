import test from 'node:test';
import assert from 'node:assert/strict';
import {createActionRun} from '../packages/action-core';
import {RoomService} from '../apps/desktop/room-service';
import {emptyRoom,parseClientRoomMessage} from '../packages/protocol/room';

const hostId='a'.repeat(32),guestId='b'.repeat(32);
const key={hostId,sequence:4};
const member=(id:string)=>({id,name:id===hostId?'房主':'队友',online:true,inRun:false,active:false,available:false,returned:false,weapon:'wand' as const});
const unavailable=/仅支持营地联机与挂机加成；主动战斗仍为单人/;

function hostService():any {
 const sent:any[]=[],actionCalls:any[]=[];
 const service:any=Object.create(RoomService.prototype);
 Object.assign(service,{
  state:{...emptyRoom([],hostId),status:'hosting',role:'host',hostId,members:[member(hostId),member(guestId)]},
  action:{state:{status:'ready',settled:true,source:null,run:null},async startRoom(...args:any[]){actionCalls.push(['startRoom',...args]);},async hostInput(...args:any[]){actionCalls.push(['hostInput',...args]);},async active(...args:any[]){actionCalls.push(['active',...args]);}},
  game:{state:{status:'ready',profile:{run:null,roomClaims:[]}},async request(){return {}}},
  host:{send(peerId:string,payload:any){sent.push({peerId,payload});return true;}},
  epoch:1,serial:Promise.resolve(),desiredActive:false,selectedWeapon:'wand',lastMember:'',partyTarget:1,disposed:false,onUpdate(){}
 });
 service.sent=sent;service.actionCalls=actionCalls;return service;
}

function guestService():any {
 const sent:any[]=[],actionCalls:any[]=[];
 const service:any=Object.create(RoomService.prototype);
 Object.assign(service,{
  state:{...emptyRoom([],guestId),status:'joined',role:'guest',hostId,members:[member(hostId),member(guestId)],runKey:key},
  action:{state:{status:'ready',settled:false,source:{...key,role:'guest',playerId:guestId},run:createActionRun(10,'bow',[hostId,guestId])},async mirror(...args:any[]){actionCalls.push(['mirror',...args]);},async request(...args:any[]){actionCalls.push(['request',...args]);}},
  game:{state:{status:'ready',profile:{run:null,roomClaims:[]}}},
  client:{hostId,send(payload:any){sent.push(payload);return true;}},
  serial:Promise.resolve(),desiredActive:false,selectedWeapon:'bow',lastMember:'',partyTarget:2,disposed:false,onUpdate(){}
 });
 service.sent=sent;service.actionCalls=actionCalls;return service;
}

test('all public room battle controls refuse without invoking ActionRuntime',async()=>{
 const service=hostService();
 await assert.rejects(service.start('wand'),unavailable);
 await assert.rejects(service.setWeapon('scatter'),unavailable);
 await assert.rejects(service.setLocalActive(true),unavailable);
 await assert.rejects(service.input({type:'move',x:400,y:300}),unavailable);
 assert.deepEqual(service.actionCalls,[]);
});

test('remote start and input messages are explicitly refused; valid activity still updates idle presence only',async()=>{
 const service=hostService();
 for(const payload of [{type:'start',key},{type:'input',key,input:{type:'move',x:400,y:300}},{type:'intent',key,input:{type:'move',x:400,y:300}}]){
  await service.clientMessage({peerId:guestId},payload);
  assert.match(service.sent.at(-1).payload.message,unavailable);
 }
 assert.deepEqual(service.actionCalls,[]);
 const presence={type:'member',key:null,weapon:'bow',available:true,active:true,settledSequence:0};
 assert.doesNotThrow(()=>parseClientRoomMessage(presence));
 await service.clientMessage({peerId:guestId},presence);
 assert.equal(service.state.members[1].online,true);
 assert.equal(service.state.members[1].active,false);
 assert.equal(service.state.members[1].inRun,false);
 assert.equal(service.state.members[1].weapon,'bow');
 assert.deepEqual(service.actionCalls,[]);
});

test('remote battle snapshots are refused, while legacy ended message can finish a saved remote run',async()=>{
 const service=guestService();
 const run=createActionRun(20,'bow',[hostId,guestId]);
 await service.hostMessage({type:'snapshot',key,run,participants:[hostId,guestId]});
 assert.match(service.state.error,unavailable);
 assert.equal(service.actionCalls.some((call:any)=>call[0]==='mirror'),false);
 await service.hostMessage({type:'ended',key});
 assert.deepEqual(service.actionCalls.find((call:any)=>call[0]==='request'),['request','finish']);
});

test('party context follows only actual online room members, from one through four',async()=>{
 const service=hostService(),counts:number[]=[];
 service.game.request=async(_type:string,value:any)=>{counts.push(value.partySize);};
 service.partyTarget=1;
 for(let online=1;online<=4;online++){
  service.state.members=Array.from({length:online},(_,index)=>({...member(index===0?hostId:index.toString(16).padStart(32,'0')),online:true}));
  if(online>1)service.state.members[1].id=guestId;
  await service.party();
 }
 service.state.members[3].online=false;await service.party();
 assert.deepEqual(counts,[2,3,4,3]);
});
