import {isDisplayBadge,type DisplayBadge} from '../solo-core/mastery';
import {parseActionInput,parseActionState,type ActionInput,type ActionState,type Weapon} from '../action-core';
import {validItemCardQuantity} from '../solo-core/item-cards';
export interface RoomItemCard {id:number;senderId:string;itemId:string;quantity:number;badge?:DisplayBadge|null}
export interface RoomKey {hostId:string;sequence:number}
export interface RoomMember {id:string;name:string;online:boolean;inRun:boolean;active:boolean;available:boolean;returned:boolean;weapon:Weapon;badge?:DisplayBadge|null}
export interface StreetPresence {x:number;petX:number;direction:-1|1;moving:boolean;view:'street'|'interior'|'field';pet:boolean}
export interface RoomPeerPresence extends StreetPresence {playerId:string}
export interface RoomChat {id:number;senderId:string;text:string}
export function validChatText(x:unknown):x is string{return typeof x==='string'&&x===x.trim()&&Array.from(x).length>=1&&Array.from(x).length<=200&&new TextEncoder().encode(x).length<=800&&!/[\u0000-\u001f\u007f-\u009f]/.test(x);}
export function parseStreetPresence(x:unknown):StreetPresence{shape(x,'x petX direction moving view pet');if(typeof x.petX!=='number'||!Number.isFinite(x.petX)||x.petX < -4096||x.petX>4096||!Number.isInteger(x.petX*4)||typeof x.x!=='number'||!Number.isFinite(x.x)||x.x < -4096||x.x>4096||!Number.isInteger(x.x*4)||![1,-1].includes(x.direction as number)||typeof x.moving!=='boolean'||typeof x.pet!=='boolean'||!['street','interior','field'].includes(x.view as string))throw Error('街道位置无效');return {...x} as unknown as StreetPresence;}
export interface RoomState {
 status:'idle'|'hosting'|'joining'|'joined'|'reconnecting'|'disconnected'|'blocked';
 roomEpoch:number;role:'none'|'host'|'guest';localPlayerId:string;hostId:string|null;address:string;addresses:string[];
 chats:RoomChat[];presence:RoomPeerPresence[];cards:RoomItemCard[];unreadCards:number;members:RoomMember[];runKey:RoomKey|null;runPhase:ActionState['phase']|null;runStage:number|null;error:string;notice:string;
}
export const emptyRoom=(addresses:string[]=[],localPlayerId=''):RoomState=>({status:'idle',roomEpoch:0,role:'none',localPlayerId,hostId:null,address:'',addresses,chats:[],presence:[],cards:[],unreadCards:0,members:[],runKey:null,runPhase:null,runStage:null,error:'',notice:'好友房间用于营地和野外队友呈现与挂机加成；主动战斗仍为单人。'});
export function roomShareReason(room:RoomState):string{
 if(room.status==='joining')return '正在连接房间，请稍候。';
 if(room.status==='reconnecting'||room.status==='disconnected')return '连接已中断，恢复后可分享。';
 if(!['hosting','joined'].includes(room.status)||room.role==='none')return '先在设置中加入好友房间。';
 if(!room.members.some(m=>m.id===room.localPlayerId&&m.online)||!room.members.some(m=>m.id===room.hostId&&m.online))return '正在读取房间成员，请稍候。';
 return '';
}
const identityTints=[0xffd58c,0x8dd9ed,0xc9a6f2,0xf2a7bd] as const;
export function roomIdentityRank(members:readonly Pick<RoomMember,'id'>[],playerId:string):number{return [...members].map(member=>member.id).sort().indexOf(playerId);}
export function roomIdentityTint(members:readonly Pick<RoomMember,'id'>[],playerId:string):number{const rank=roomIdentityRank(members,playerId);return identityTints[Math.max(0,rank)%identityTints.length];}
export type RoomCommand={type:'room-chat';generation:number;text:string}|{type:'room-open';generation:number}|{type:'room-host';generation:number;name:string;bind:string}|{type:'room-join';generation:number;name:string;invitation:string}|{type:'room-leave';generation:number;roomEpoch:number}|{type:'room-copy'|'room-read';generation:number}|{type:'room-weapon';generation:number;weapon:Weapon};
const object=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
function shape(x:unknown,keys:string):asserts x is Record<string,unknown>{if(!object(x)||Object.keys(x).sort().join(',')!==keys.split(' ').sort().join(','))throw Error('房间消息字段不匹配');}
/** Only the deliberate legacy absence is accepted; all other extra fields stay strict. */
function badgeShape(x:Record<string,unknown>,keys:string):DisplayBadge|null{shape(x,keys+(Object.hasOwn(x,'badge')?' badge':''));if(!Object.hasOwn(x,'badge'))return null;if(x.badge!==null&&!isDisplayBadge(x.badge))throw Error('房间纪念徽章无效');return x.badge as DisplayBadge|null;}
const id=(x:unknown):x is string=>typeof x==='string'&&/^[a-f0-9]{32}$/.test(x);
const weapon=(x:unknown):x is Weapon=>typeof x==='string'&&['wand','bow','scatter'].includes(x);
export const validRoomName=(x:unknown):x is string=>typeof x==='string'&&x===x.trim()&&Array.from(x).length>=1&&Array.from(x).length<=20&&new TextEncoder().encode(x).length<=80&&!/[\u0000-\u001f\u007f-\u009f]/.test(x);
export function parseRoomKey(x:unknown):RoomKey {
 shape(x,'hostId sequence');if(!id(x.hostId)||typeof x.sequence!=='number'||!Number.isSafeInteger(x.sequence)||x.sequence<1||x.sequence>1e12)throw Error('房间远征编号无效');return {hostId:x.hostId,sequence:x.sequence};
}
export function sameRoomKey(a:RoomKey|null,b:RoomKey|null):boolean{return a!==null&&b!==null&&a.hostId===b.hostId&&a.sequence===b.sequence;}
export function parseRoomMember(x:unknown):RoomMember {
 if(!object(x))throw Error('房间成员无效');const badge=badgeShape(x,'id name online inRun active available returned weapon');if(!id(x.id)||!validRoomName(x.name)||!weapon(x.weapon)||['online','inRun','active','available','returned'].some(k=>typeof x[k]!=='boolean')||x.active&&(!x.online||!x.inRun||x.returned))throw Error('房间成员无效');return {...x,badge} as unknown as RoomMember;
}
export function parseRoomCommand(x:Record<string,unknown>):RoomCommand|null {
 if(typeof x.type!=='string'||!x.type.startsWith('room-'))return null;
 if(typeof x.generation!=='number'||!Number.isSafeInteger(x.generation)||x.generation<1)throw Error('房间面板操作已过期');
 if(['room-open','room-copy','room-read'].includes(x.type)){shape(x,'type generation');return x as RoomCommand;}
 if(x.type==='room-leave'){shape(x,'type generation roomEpoch');if(!Number.isSafeInteger(x.roomEpoch)||(x.roomEpoch as number)<0)throw Error('房间操作已过期');return x as RoomCommand;}
 if(x.type==='room-chat'){shape(x,'type generation text');if(!validChatText(x.text))throw Error('消息需为1–200字，不能含控制字符');return x as RoomCommand;}
 if(x.type==='room-host'){shape(x,'type generation name bind');if(!validRoomName(x.name)||typeof x.bind!=='string'||x.bind.length>64)throw Error('开房昵称或地址无效');return x as RoomCommand;}
 if(x.type==='room-join'){shape(x,'type generation name invitation');if(!validRoomName(x.name)||typeof x.invitation!=='string'||x.invitation.length>160)throw Error('加入昵称或邀请无效');return x as RoomCommand;}
 if(x.type==='room-weapon'){shape(x,'type generation weapon');if(!weapon(x.weapon))throw Error('房间武器无效');return x as RoomCommand;}
 throw Error('未知房间指令');
}
export type ClientRoomMessage={type:'chat';text:string}|{type:'presence';presence:StreetPresence}|{type:'item-card';itemId:string;quantity:number;nonce:string}|{type:'member';key:RoomKey|null;weapon:Weapon;available:boolean;active:boolean;settledSequence:number;badge?:DisplayBadge|null}|{type:'intent';key:RoomKey;input:ActionInput}|{type:'return';key:RoomKey};
export type HostRoomMessage=({type:'chat'}&RoomChat)|{type:'presence';presence:RoomPeerPresence}|({type:'item-card'}&RoomItemCard)|{type:'room';hostId:string;members:RoomMember[];key:RoomKey|null;phase:ActionState['phase']|null;stage:number|null;notice:string}|{type:'snapshot';key:RoomKey;run:ActionState;participants:string[]}|{type:'ended';key:RoomKey}|{type:'error';message:string};
export function parseClientRoomMessage(x:unknown):ClientRoomMessage {
 if(!object(x))throw Error('房间意图无效');
 if(x.type==='chat'){shape(x,'type text');if(!validChatText(x.text))throw Error('聊天内容无效');return {...x} as ClientRoomMessage;}
 if(x.type==='presence'){shape(x,'type presence');return {type:'presence',presence:parseStreetPresence(x.presence)};}
 if(x.type==='item-card'){
  shape(x,'type itemId quantity nonce');if(!validItemCardQuantity(x.itemId,x.quantity)||typeof x.nonce!=='string'||x.nonce!==x.nonce.trim()||!/^\w[\w-]{15,63}$/.test(x.nonce))throw Error('物品展示内容无效');return {...x} as ClientRoomMessage;
 }
 if(x.type==='member'){
  const badge=badgeShape(x,'type key weapon available active settledSequence');if(!weapon(x.weapon)||typeof x.available!=='boolean'||typeof x.active!=='boolean'||typeof x.settledSequence!=='number'||!Number.isSafeInteger(x.settledSequence)||x.settledSequence<0||x.settledSequence>1e12)throw Error('成员准备状态无效');return {...x,badge,key:x.key===null?null:parseRoomKey(x.key)} as ClientRoomMessage;
 }
 if(x.type==='intent'){shape(x,'type key input');const input=parseActionInput(x.input);if(input.type==='pause'||input.type==='upgrade')throw Error('客机不能控制全队暂停或关间强化');return {type:'intent',key:parseRoomKey(x.key),input};}
 if(x.type==='return'){shape(x,'type key');return {type:'return',key:parseRoomKey(x.key)};}
 throw Error('未知房间意图');
}
export function parseHostRoomMessage(x:unknown):HostRoomMessage {
 if(!object(x))throw Error('房主消息无效');
 if(x.type==='chat'){shape(x,'type id senderId text');if(!id(x.senderId)||!Number.isSafeInteger(x.id)||(x.id as number)<1||(x.id as number)>1e12||!validChatText(x.text))throw Error('聊天内容无效');return {...x} as HostRoomMessage;}
 if(x.type==='presence'){shape(x,'type presence');if(!object(x.presence))throw Error('街道身份无效');const {playerId,...pose}=x.presence;if(!id(playerId))throw Error('街道身份无效');return {type:'presence',presence:{...parseStreetPresence(pose),playerId}};}
 if(x.type==='item-card'){
  const badge=badgeShape(x,'type id senderId itemId quantity');if(!validItemCardQuantity(x.itemId,x.quantity)||!id(x.senderId)||x.senderId.length!==32||typeof x.id!=='number'||!Number.isSafeInteger(x.id)||x.id<1||x.id>1e12)throw Error('物品展示消息无效');return {...x,badge} as HostRoomMessage;
 }
 if(x.type==='room'){
  shape(x,'type hostId members key phase stage notice');if(!id(x.hostId)||!Array.isArray(x.members)||!x.members.length||x.members.length>4||typeof x.notice!=='string'||x.notice.length>240)throw Error('房间状态无效');
  const members=x.members.map(parseRoomMember);if(new Set(members.map(m=>m.id)).size!==members.length||!members.some(m=>m.id===x.hostId))throw Error('房间成员身份重复或缺失');
  const key=x.key===null?null:parseRoomKey(x.key);if(key&&key.hostId!==x.hostId||x.phase!==null&&(typeof x.phase!=='string'||!['playing','upgrade','won','lost'].includes(x.phase))||x.stage!==null&&(typeof x.stage!=='number'||!Number.isInteger(x.stage)||x.stage<0||x.stage>2)||(key===null)!==(x.phase===null)||(key===null)!==(x.stage===null))throw Error('房间关卡状态无效');
  return {type:'room',hostId:x.hostId,members,key,phase:x.phase as ActionState['phase']|null,stage:x.stage as number|null,notice:x.notice};
 }
 if(x.type==='snapshot'){
  shape(x,'type key run participants');const key=parseRoomKey(x.key),run=parseActionState(x.run);
  const participants=x.participants;
  if(!Array.isArray(participants)||!participants.length||participants.length>4||participants.some(p=>!id(p))||new Set(participants).size!==participants.length||!participants.includes(key.hostId)||run.players.length!==participants.length||run.players.some(p=>!participants.includes(p.id)))throw Error('战斗参与名单无效');
  return {type:'snapshot',key,run,participants:[...participants] as string[]};
 }
 if(x.type==='ended'){shape(x,'type key');return {type:'ended',key:parseRoomKey(x.key)};}
 if(x.type==='error'){shape(x,'type message');if(typeof x.message!=='string'||x.message.length>240)throw Error('房间错误文本无效');return {type:'error',message:x.message};}
 throw Error('未知房主消息');
}
