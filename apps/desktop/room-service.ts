import {streetPetPresence} from '../../packages/solo-core/pets';
import {roomDisplayBadge,type DisplayBadge} from '../../packages/solo-core/mastery';
import {randomUUID} from 'node:crypto';
import {ownedItemCard,itemCardDefinition} from '../../packages/solo-core/item-cards';
import {hostRoom,joinRoom,localRoomAddresses,parseRoomAddress,type RoomHost,type RoomClient,type ResumeCredential,type Peer} from '../../packages/room-net';
import {emptyRoom,validChatText,parseStreetPresence,type StreetPresence,type RoomPeerPresence,type RoomChat,roomShareReason,parseClientRoomMessage,parseHostRoomMessage,sameRoomKey,type RoomItemCard,type RoomKey,type RoomMember,type RoomState,type HostRoomMessage} from '../../packages/protocol/room';
import type {ActionInput,Weapon} from '../../packages/action-core';
import type {ActionSession} from '../../packages/protocol/action';
import type {GameRuntime} from './game-runtime';
import type {ActionRuntime} from './action-runtime';
import {installationId} from './identity-store';

export interface RoomMembershipEvent {kind:'joined'|'disconnected'|'left'|'expired'|'roster'|'closed';playerId?:string}
interface Connection {name:string;address:string;key:string;resume?:ResumeCredential}
const cleanError=(e:unknown)=>String(e instanceof Error?e.message:e).slice(0,240);
const joinError=()=> '未能加入好友房间。请确认房主在线、地址可达且邀请完整；若首次连接刚中断，请等30秒后重试。';
const battleUnavailable='本版本好友房间仅支持营地联机与挂机加成；主动战斗仍为单人。';
export class RoomService {
 state:RoomState;
 readonly ready:Promise<void>;
 private host?:RoomHost;
 private client?:RoomClient;
 private connection?:Connection;
 private epoch=0;
 private serial:Promise<unknown>=Promise.resolve();
 private reconnectTimer?:ReturnType<typeof setTimeout>;
 private reconnectUntil=0;
 private retry=0;
 private offlineAt=new Map<string,number>();
 private timer:ReturnType<typeof setInterval>;
 private desiredActive=false;
 private selectedWeapon:Weapon='wand';
 private lastMember='';
 private localBadge:DisplayBadge|null=null;
 private badgeRefreshPending=false;
 private partyTarget=1;
 private disposed=false;
 private shareEpoch=0;
 private lastShare:number|undefined;
 private peerShareAt=new Map<string,number>();
 private peerNonces=new Map<string,string[]>();
 private cardSequence=0;
 private chatSequence=0;private lastChatId=0;private chatAt=new Map<string,number>();private presenceAt=new Map<string,number>();
 private localPresence:StreetPresence={x:360,petX:406,direction:1,moving:false,view:'street',pet:false};
 private lastCardId=0;
 private clearCards():void{this.state.chats=[];this.state.presence=[];this.chatSequence=0;this.lastChatId=0;this.chatAt.clear();this.presenceAt.clear();this.state.cards=[];this.state.unreadCards=0;this.lastShare=undefined;this.peerShareAt.clear();this.peerNonces.clear();this.cardSequence=0;this.lastCardId=0;++this.shareEpoch;}
 private receiveCard(card:RoomItemCard):void{
  this.state.cards=[...this.state.cards,card].slice(-6);
  if(card.senderId!==this.state.localPlayerId)this.state.unreadCards=Math.min(6,this.state.unreadCards+1);
  const sender=this.state.members.find(m=>m.id===card.senderId)!;
  this.state.notice=`${sender.name} 展示了${itemCardDefinition(card.itemId)!.name}。仅展示，不转移物品。`;
 }
 invalidateShares():void{++this.shareEpoch;}
 markCardsRead():void{if(this.state.unreadCards){this.state.unreadCards=0;this.emit();}}
 /** Main-only submit. Ownership is fetched inside the room queue, never supplied by renderer. */
 shareItem(itemId:string,guard:()=>void=()=>{}):Promise<RoomState>{
  const epoch=this.epoch,shareEpoch=this.shareEpoch;
  return this.task(async()=>{
   const check=()=>{guard();if(this.disposed||epoch!==this.epoch||shareEpoch!==this.shareEpoch)throw Error('房间已变化，请重新预览。');const reason=roomShareReason(this.state);if(reason)throw Error(reason);if(this.game.state.status!=='ready')throw Error('当前进度未就绪');};
   check();
   const profile=await this.game.authoritativeProfile();check();
   const item=ownedItemCard(profile,itemId);if(!item)throw Error('已不再持有这件物品，请重新选择。');
   const now=Date.now();if(this.lastShare!==undefined&&now-this.lastShare<2000)throw Error('请间隔2秒再分享。');
   if(this.applyLocalBadge(roomDisplayBadge(profile))){if(this.state.role==='guest')this.sendMember();else this.sendRoster();}
   if(this.state.role==='guest'){
    if(!this.client?.send({type:'item-card',itemId,quantity:item.quantity,nonce:randomUUID()}))throw Error('连接拥堵，展示未发送。');
    this.lastShare=now;this.state.error='';this.state.notice='已发送物品展示；物品仍在你的行囊中。';this.emit();return this.state;
   }
   if(!this.host)throw Error('房间已关闭。');
   this.lastShare=now;this.broadcastCard(this.state.localPlayerId,itemId,item.quantity);return this.state;
  });
 }
 private broadcastCard(senderId:string,itemId:string,quantity:number):void{
  if(!this.host||this.cardSequence>=1e12)throw Error('请重新创建房间后分享。');
  const card={id:++this.cardSequence,senderId,itemId,quantity,badge:this.state.members.find(m=>m.id===senderId)?.badge??null};
  this.receiveCard(card);let failed=false;
  for(const member of this.state.members)if(member.online&&member.id!==this.state.localPlayerId)if(!this.host.send(member.id,{type:'item-card',...card}))failed=true;
  this.state.error=failed?'展示已更新，但部分连接拥堵，未向所有在线成员发送。':'';this.emit();
  if(failed)throw Error(this.state.error);
 }

 /** Bounded local-only renderer pose. Identity/pet ownership are supplied by Main. No economy effect. */
 updatePresence(value:StreetPresence):void{
  if(this.game.state.party?.busy)return;const pose=parseStreetPresence(value),p=this.game.state.profile;
  this.localPresence={...pose,pet:!!p&&streetPetPresence(p,pose.view==='field'?'field':'camp').visible};
  if(!['hosting','joined'].includes(this.state.status))return;
  const now=Date.now(),id=this.state.localPlayerId;if(now-(this.presenceAt.get(id)??-Infinity)<90)return;
  this.presenceAt.set(id,now);
  if(this.host)this.broadcastPresence(id,this.localPresence);else this.client?.send({type:'presence',presence:this.localPresence});
 }
 private broadcastPresence(playerId:string,pose:StreetPresence):void{
  const presence={...pose,playerId};this.receivePresence(presence);
  for(const m of this.state.members)if(m.online&&m.id!==this.state.localPlayerId)this.host?.send(m.id,{type:'presence',presence});
  this.emit();
 }
 private receivePresence(presence:RoomPeerPresence):void{this.state.presence=[...this.state.presence.filter(p=>p.playerId!==presence.playerId),presence].slice(-4);}
 chat(text:string):Promise<RoomState>{return this.task(async()=>{
  if(!validChatText(text))throw Error('消息需为1–200字，不能含控制字符');const reason=roomShareReason(this.state);if(reason)throw Error(reason);
  const id=this.state.localPlayerId;this.chatLimit(id);
  if(this.host)this.broadcastChat(id,text);else if(!this.client?.send({type:'chat',text}))throw Error('连接拥堵，消息未发送。');return this.state;
 });}
 private chatLimit(id:string):void{const now=Date.now();if(now-(this.chatAt.get(id)??-Infinity)<750)throw Error('消息太快，请稍候。');this.chatAt.set(id,now);}
 private receiveChat(chat:RoomChat):void{this.state.chats=[...this.state.chats,chat].slice(-40);}
 private broadcastChat(senderId:string,text:string):void{
  if(!this.host||this.chatSequence>=1e12)throw Error('请重新创建房间');const chat={id:++this.chatSequence,senderId,text};this.receiveChat(chat);
  for(const m of this.state.members)if(m.online&&m.id!==this.state.localPlayerId)this.host.send(m.id,{type:'chat',...chat});this.emit();
 }
 /** Main-only authenticated transport hooks for the separate PartyField adapter. Never exposed over IPC. */
 private partyHandlers?:{client:(peer:Peer,payload:Record<string,unknown>)=>void;host:(payload:Record<string,unknown>)=>void;membership?:(event:RoomMembershipEvent)=>void};
 attachPartyTransport(handlers:NonNullable<RoomService['partyHandlers']>):()=>void{this.partyHandlers=handlers;return()=>{if(this.partyHandlers===handlers)this.partyHandlers=undefined;};}
 sendPartyToHost(payload:Record<string,unknown>):boolean{return payload.type==='party-field-v1'&&!!this.client?.send(payload);}
 sendPartyToPeer(playerId:string,payload:Record<string,unknown>):boolean{return payload.type==='party-field-v1'&&!!this.host?.send(playerId,payload);}
 constructor(folder:string,private game:GameRuntime,private action:ActionRuntime,private onUpdate:()=>void){
  let addresses:string[]=[];try{addresses=localRoomAddresses();}catch{}
  this.state=emptyRoom(addresses);
  try{this.state.localPlayerId=installationId(folder);}catch(e){this.state.status='blocked';this.state.error=cleanError(e);}
  this.ready=Promise.all([game.ready,action.ready]).then(async()=>{if(game.state.status==='ready')await game.request('party-context',{partySize:1});});
  this.timer=setInterval(()=>{if(this.state.role==='host')void this.background(()=>this.expireReservations());},1000);this.timer.unref();
 }
 private task<T>(fn:()=>Promise<T>):Promise<T>{const next=this.serial.then(fn);this.serial=next.catch(()=>{});return next;}
 private background(fn:()=>Promise<unknown>):Promise<void>{return this.task(async()=>{if(this.disposed)return;try{await fn();}catch(e){this.state.error=cleanError(e);this.emit();}});}
 private emit():void{if(!this.disposed)this.onUpdate();}
 private local():RoomMember|undefined{return this.state.members.find(m=>m.id===this.state.localPlayerId);}
 private belongs():boolean{return !!this.action.state.source&&this.action.state.source.hostId===this.state.hostId;}
 private available():boolean {
  const p=this.game.state.profile,s=this.action.state;
  return this.game.state.status==='ready'&&!!p&&!p.run&&!this.game.state.party?.busy&&s.status==='ready'&&(s.settled||this.belongs()&&(s.run?.phase==='won'||s.run?.phase==='lost'||sameRoomKey(this.state.runKey,s.source)&&!!this.local()?.inRun&&!this.local()?.returned));
 }
 private settledSequence():number{return this.game.state.profile?.roomClaims.find(c=>c.hostId===this.state.hostId)?.sequence??0;}
 private partySize():number {
  if(!['hosting','joined'].includes(this.state.status))return 1;
  return Math.max(1,Math.min(4,this.state.members.filter(m=>m.online).length));
 }
 private async party():Promise<void>{const n=this.partySize();if(n===this.partyTarget)return;await this.game.request('party-context',{partySize:n});this.partyTarget=n;}
 private memberMessage():Record<string,unknown>{return {type:'member',key:this.state.runKey,weapon:this.selectedWeapon,available:this.available(),active:this.desiredActive,settledSequence:this.settledSequence(),badge:this.localBadge};}
 private sendMember(force=false):void {
  if(!this.client||this.state.status!=='joined')return;const message=this.memberMessage(),fingerprint=JSON.stringify(message);
  if(force||fingerprint!==this.lastMember){this.lastMember=fingerprint;if(!this.client.send(message))this.state.error='连接拥堵，成员状态未发送。';}
 }
 /** Worker reads are serialized/coalesced; a roster echo cannot trigger a new read/send loop. */
 private applyLocalBadge(badge:DisplayBadge|null):boolean{
  this.localBadge=badge;const local=this.local();if(!local||(local.badge??null)===badge)return false;local.badge=badge;return true;
 }
 gameUpdated():void {
  if(this.disposed||!this.inRoom()||this.badgeRefreshPending)return;
  this.badgeRefreshPending=true;const epoch=this.epoch;
  void this.background(async()=>{try{
   const badge=this.game.state.status==='ready'?roomDisplayBadge(await this.game.authoritativeProfile()):null;
   if(epoch!==this.epoch)return;
   const changed=this.applyLocalBadge(badge);
   if(this.state.role==='guest'){this.sendMember();if(changed)this.emit();return;}
   const local=this.local(),available=this.available();
   if(this.state.role==='host'&&local&&(changed||local.available!==available)){local.available=available;if(!available)local.active=false;await this.activeContext();this.sendRoster();this.emit();}
  }finally{this.badgeRefreshPending=false;}});
 }
 actionUpdated():void {
  // Legacy ActionRuntime saves remain available for local settlement, but this
  // release shares idle presence only and never publishes battle snapshots.
 }
 viewAction():ActionSession {
  const value=this.action.state;
  if(!value.source||!value.run)return value;
  const active=sameRoomKey(this.state.runKey,value.source)&&this.local()?.active&&['hosting','joined'].includes(this.state.status);
  return {...value,run:{...value.run,paused:value.run.paused||!active}};
 }
 inRoom():boolean{return this.state.role!=='none';}
 currentRoomRun():boolean{return !!this.action.state.source&&sameRoomKey(this.state.runKey,this.action.state.source)&&this.inRoom()&&!this.action.state.settled;}
 invitation():string {
  if(!this.host||this.state.role!=='host')throw Error('只有房主可复制本机邀请');return `PS3@${this.host.address}#${this.host.key}`;
 }
 hostRoom(name:string,bind:string):Promise<RoomState>{return this.task(async()=>{
  await this.ready;if(this.state.status==='blocked')throw Error(this.state.error);if(this.inRoom())throw Error('请先离开当前房间');
  this.localBadge=roomDisplayBadge(await this.game.authoritativeProfile());
  this.clearCards();const epoch=++this.epoch;this.state.error='';this.desiredActive=false;this.offlineAt.clear();
  const server=await hostRoom({peerId:this.state.localPlayerId,name,bind},{
   admit:(peer,pendingPeerIds)=>{
    if(this.state.members.some(m=>m.id===peer.peerId))return;
    const occupied=this.state.members.filter(m=>m.online||Date.now()-(this.offlineAt.get(m.id)??Date.now())<30000);
    if(new Set([...occupied.map(m=>m.id),...pendingPeerIds]).size>=4)return occupied.some(m=>!m.online)?'房间席位正在为断线队友保留30秒，请稍后加入。':'房间席位已满（4人），请等好友离房后再加入。';
   },
   peerJoined:peer=>{if(epoch===this.epoch)void this.background(()=>this.joinedPeer(peer));},
   peerLeft:(peer,reason,departure)=>epoch===this.epoch?this.background(()=>this.leftPeer(peer,reason,departure)):undefined,
   message:(peer,payload)=>{if(epoch===this.epoch)void this.background(()=>this.clientMessage(peer,payload));},
   error:message=>{if(epoch===this.epoch){this.state.error=message;this.emit();}}
  });
  this.host=server;this.state={...this.state,status:'hosting',roomEpoch:epoch,role:'host',hostId:this.state.localPlayerId,address:server.address,members:[{id:this.state.localPlayerId,name,weapon:this.selectedWeapon,online:true,inRun:false,active:false,available:false,returned:false,badge:this.localBadge}],runKey:null,runPhase:null,runStage:null,notice:'房间已建立。邀请同一局域网或已授权私网中的好友；在线队友会出现在营地和野外。'};
  this.local()!.available=this.available();this.updatePresence(this.localPresence);await this.party();this.emit();return this.state;
 });}
 joinRoom(name:string,invitation:string):Promise<RoomState>{return this.task(async()=>{
  await this.ready;if(this.state.status==='blocked')throw Error(this.state.error);if(this.inRoom())throw Error('请先离开当前房间');
  if(/^PS[12]@/.test(invitation.trim()))throw Error('房间版本不一致，请双方使用0.19.0并重新复制PS3邀请。');
  const match=/^PS3@([^#]{1,64})#([A-Za-z0-9_-]{22})$/.exec(invitation.trim());if(!match)throw Error('邀请格式无效，请完整粘贴 PS3@地址:端口#口令');parseRoomAddress(match[1]);
  this.clearCards();const epoch=++this.epoch;this.connection={name,address:match[1],key:match[2]};this.desiredActive=false;this.lastMember='';
  this.state={...this.state,status:'joining',roomEpoch:epoch,role:'guest',address:match[1],error:'',notice:'正在连接好友的电脑……',members:[],runKey:null,runPhase:null,runStage:null};this.emit();
  try{await this.connect(epoch);this.emit();return this.state;}catch(e){
   if(this.connection?.resume){await this.connectionLost('interrupted authenticated handshake',epoch);return this.state;}
   const message=/房间版本不一致|^房间席位/.test(cleanError(e))?cleanError(e):joinError();this.connection=undefined;this.client=undefined;this.state={...emptyRoom(this.state.addresses,this.state.localPlayerId),roomEpoch:this.epoch,error:message};this.emit();throw Error(message);
  }
 });}
 private async connect(epoch:number):Promise<void>{
  const c=this.connection;if(!c||this.disposed||epoch!==this.epoch)throw Error('连接已取消');
  const badge=roomDisplayBadge(await this.game.authoritativeProfile());
  if(epoch!==this.epoch||this.disposed)return;
  const client=await joinRoom({peerId:this.state.localPlayerId,...c},{
   credential:resume=>{if(epoch===this.epoch&&this.connection===c)c.resume={...resume};},
   message:payload=>{if(epoch===this.epoch)void this.background(()=>this.hostMessage(payload));},
   closed:reason=>{if(epoch===this.epoch)void this.background(()=>this.connectionLost(reason,epoch));}
  });
  if(epoch!==this.epoch||this.disposed){await client.close();return;}
  this.localBadge=badge;
  this.client=client;c.resume=client.resume;this.state.hostId=client.hostId;this.state.status='joined';this.state.error='';this.state.notice='已加入营地队伍；在线队友会出现在营地和野外，挂机收益按在线人数提升。'+battleUnavailable;this.retry=0;this.reconnectUntil=0;this.sendMember(true);this.updatePresence(this.localPresence);
 }
 private async connectionLost(reason:string,epoch:number):Promise<void>{
  this.client=undefined;if(!this.connection||this.disposed||epoch!==this.epoch)return;
  ++this.shareEpoch;this.state.presence=[];this.state.status='reconnecting';this.state.error='连接中断，正在尝试恢复原身份。';this.state.notice='连接恢复期间按当前在线人数计算挂机加成；单机经营和远征继续。';
  for(const m of this.state.members){m.online=m.id===this.state.localPlayerId;m.active=false;if(!m.online)m.badge=null;}
  this.partyHandlers?.membership?.({kind:'disconnected',playerId:this.state.hostId??undefined});this.desiredActive=false;if(this.currentRoomRun())await this.action.pause();await this.party();this.emit();
  if(!this.reconnectUntil)this.reconnectUntil=Date.now()+30000;
  this.scheduleReconnect(epoch);
 }
 private scheduleReconnect(epoch:number):void {
  clearTimeout(this.reconnectTimer);if(!this.connection||this.disposed||epoch!==this.epoch)return;
  if(Date.now()>=this.reconnectUntil){this.state.status='disconnected';this.state.error='30秒内未恢复连接；可离开房间或稍后重新加入，单机经营和挂机继续。';this.emit();return;}
  const delay=Math.min(2500,400*2**Math.min(this.retry++,3));
  this.reconnectTimer=setTimeout(()=>{void this.background(async()=>{if(epoch!==this.epoch||!this.connection)return;try{await this.connect(epoch);this.emit();}catch(e){if(cleanError(e).includes('房间版本不一致')){this.state.status='disconnected';this.state.error=cleanError(e);this.emit();}else this.scheduleReconnect(epoch);}});},delay);this.reconnectTimer.unref();
 }
 private async joinedPeer(peer:Peer):Promise<void>{
  if(!this.host)return;await this.expireReservations();let member=this.state.members.find(m=>m.id===peer.peerId);
  if(!member){
   if(this.state.members.length>=4){const expired=this.state.members.find(m=>!m.online&&!m.inRun&&(Date.now()-(this.offlineAt.get(m.id)??Date.now()))>=30000);if(expired){this.state.members=this.state.members.filter(m=>m!==expired);this.peerShareAt.delete(expired.id);this.chatAt.delete(expired.id);this.presenceAt.delete(expired.id);this.peerNonces.delete(expired.id);this.offlineAt.delete(expired.id);}}
   if(this.state.members.length>=4){this.host.disconnect(peer.peerId,'成员名额正在为断线队友保留，请稍后加入');return;}
   member={id:peer.peerId,name:peer.name,online:true,available:false,inRun:false,active:false,returned:false,weapon:'wand',badge:null};this.state.members.push(member);
  }else{member.name=peer.name;member.online=true;member.active=false;member.badge=null;}
  this.offlineAt.delete(peer.peerId);this.state.notice=`${peer.name} 已加入，${this.state.members.filter(m=>m.online).length}/4人在线。`+(this.state.members.some(m=>!m.online)?' 断线队友席位保留30秒。':'');await this.party();this.sendRoster();for(const presence of this.state.presence)this.host.send(peer.peerId,{type:'presence',presence});this.partyHandlers?.membership?.({kind:'joined',playerId:peer.peerId});this.emit();
 }
 private forgetPeer(id:string):void{
  this.state.members=this.state.members.filter(m=>m.id!==id);this.state.presence=this.state.presence.filter(p=>p.playerId!==id);this.offlineAt.delete(id);this.peerShareAt.delete(id);this.peerNonces.delete(id);this.chatAt.delete(id);this.presenceAt.delete(id);
 }
 private async leftPeer(peer:Peer,_reason:string,departure:'left'|'disconnected'):Promise<void>{
  const member=this.state.members.find(m=>m.id===peer.peerId);if(!member)return;
  if(departure==='left'){this.forgetPeer(peer.peerId);this.state.notice=`${member.name} 已离房，空出的席位可立即加入。`;this.partyHandlers?.membership?.({kind:'left',playerId:peer.peerId});}
  else{member.online=false;member.active=false;member.badge=null;this.state.presence=this.state.presence.filter(p=>p.playerId!==peer.peerId);this.offlineAt.set(peer.peerId,Date.now());this.state.notice=`${member.name} 连接中断，席位保留30秒等待原身份恢复。`;this.partyHandlers?.membership?.({kind:'disconnected',playerId:peer.peerId});}
  await this.activeContext();await this.party();this.sendRoster();this.emit();
 }
 private async expireReservations():Promise<void>{
  let changed=false;for(const m of [...this.state.members])if(!m.online&&Date.now()-(this.offlineAt.get(m.id)??Date.now())>=30000){this.forgetPeer(m.id);this.partyHandlers?.membership?.({kind:'expired',playerId:m.id});changed=true;}
  if(changed){this.state.notice='断线保留时间已结束，空出的席位可加入新好友。';await this.activeContext();await this.party();this.sendRoster();this.emit();}
 }
 private async clientMessage(peer:Peer,payload:Record<string,unknown>):Promise<void>{
  const member=this.state.members.find(m=>m.id===peer.peerId);if(!member?.online||!this.host)return;
  try{
   if(payload.type==='start'||payload.type==='input'||payload.type==='intent')throw Error(battleUnavailable);
   if(payload.type==='party-field-v1'){this.partyHandlers?.client(peer,payload);return;}
   const message=parseClientRoomMessage(payload);
   if(message.type==='chat'){this.chatLimit(peer.peerId);this.broadcastChat(peer.peerId,message.text);}
   else if(message.type==='presence'){const now=Date.now();if(now-(this.presenceAt.get(peer.peerId)??-Infinity)<80)return;this.presenceAt.set(peer.peerId,now);this.broadcastPresence(peer.peerId,message.presence);}
   else if(message.type==='item-card'){
    const now=Date.now(),nonces=this.peerNonces.get(peer.peerId)??[];
    if(nonces.includes(message.nonce))throw Error('重复的展示已拒绝。');
    if(now-(this.peerShareAt.get(peer.peerId)??-Infinity)<2000)throw Error('请间隔2秒再分享。');
    this.peerShareAt.set(peer.peerId,now);this.peerNonces.set(peer.peerId,[...nonces,message.nonce].slice(-64));
    this.broadcastCard(peer.peerId,message.itemId,message.quantity);
   }else if(message.type==='member'){
    member.badge=message.badge??null;member.weapon=message.weapon;member.available=false;member.active=false;member.inRun=false;member.returned=false;
    await this.activeContext();this.sendRoster();this.emit();
   }else{
    if(!sameRoomKey(message.key,this.state.runKey)||!member.inRun||member.returned)throw Error('本版本只同步营地成员，未启用房间战斗。');
    if(message.type==='return'){member.returned=true;member.inRun=false;member.active=false;await this.activeContext();this.sendRoster();this.emit();}
    else throw Error(battleUnavailable);
   }
  }catch(e){this.host.send(peer.peerId,{type:'error',message:cleanError(e)});}
 }
 private sendRoster():void {
  if(!this.host)return;
  const message:HostRoomMessage={type:'room',hostId:this.state.localPlayerId,members:this.state.members.map(m=>({...m})),key:this.state.runKey,phase:this.state.runPhase,stage:this.state.runStage,notice:this.state.notice};
  for(const m of this.state.members)if(m.online&&m.id!==this.state.localPlayerId)this.host.send(m.id,message as unknown as Record<string,unknown>);
 }
 private sendSnapshot(force=false):void {
  void force;
  // Battle snapshots belong to the legacy protocol only; new rooms are idle presence.
 }
 private async activeContext():Promise<void>{
  // Do not change the active-run roster from an idle-presence room.
 }
 private async hostMessage(payload:Record<string,unknown>):Promise<void>{
  if(!this.client||this.state.status!=='joined')return;
  try{
   if(payload.type==='party-field-v1'){this.partyHandlers?.host(payload);return;}
   const message=parseHostRoomMessage(payload);
   if(message.type==='chat'){if(!this.state.members.some(m=>m.id===message.senderId&&m.online))throw Error('聊天身份不在房间');if(message.id<=this.lastChatId)return;this.lastChatId=message.id;this.receiveChat({id:message.id,senderId:message.senderId,text:message.text});this.emit();}
   else if(message.type==='presence'){if(!this.state.members.some(m=>m.id===message.presence.playerId&&m.online))return;this.receivePresence(message.presence);this.emit();}
   else if(message.type==='item-card'){
    if(this.client.hostId!==this.state.hostId)throw Error('展示不属于当前认证房主。');
    if(!this.state.members.some(m=>m.id===message.senderId&&m.online))throw Error('展示发送者不在当前在线成员中。');
    if(message.id<=this.lastCardId)return;
    this.lastCardId=message.id;const {type:_,...card}=message;this.receiveCard(card);this.emit();
   }else if(message.type==='room'){
    if(message.hostId!==this.client.hostId||!message.members.some(m=>m.id===this.state.localPlayerId))throw Error('房主成员名单未包含当前身份');
    this.state.members=message.members;this.state.presence=this.state.presence.filter(p=>message.members.some(m=>m.id===p.playerId&&m.online));this.partyHandlers?.membership?.({kind:'roster'});this.state.runKey=message.key;this.state.runPhase=message.phase;this.state.runStage=message.stage;this.state.notice=message.notice;
    if(message.phase==='won'||message.phase==='lost')this.desiredActive=false;
    await this.party();this.sendMember();this.emit();
   }else if(message.type==='snapshot'){
    throw Error(battleUnavailable);
   }else if(message.type==='ended'){
    if(sameRoomKey(message.key,this.action.state.source)&&!this.action.state.settled)await this.action.request('finish');
    this.desiredActive=false;for(const m of this.state.members)m.active=false;this.state.notice='房主结束了历史房间战斗状态；旧战斗存档仍可在本机结算。';this.emit();
   }else{this.state.error=message.message;this.emit();}
  }catch(e){this.state.error='房间状态未应用：'+cleanError(e);this.desiredActive=false;this.sendMember(true);this.emit();}
 }
 setWeapon(weapon:Weapon):Promise<RoomState>{return this.task(async()=>{void weapon;throw Error(battleUnavailable);});}
 start(weapon:Weapon):Promise<ActionSession>{return this.task(async()=>{void weapon;throw Error(battleUnavailable);});}
 setLocalActive(active:boolean):Promise<ActionSession>{return this.task(async()=>{
  void active;throw Error(battleUnavailable);
 });}
 input(input:ActionInput):Promise<ActionSession>{return this.task(async()=>{
  void input;throw Error(battleUnavailable);
 });}
 settle():Promise<ActionSession>{return this.task(async()=>{
  this.desiredActive=false;const own=this.local();
  if(this.state.role==='host'){
   for(const m of this.state.members)m.active=false;await this.activeContext();const result=await this.action.settle();this.actionUpdated();this.sendSnapshot(true);
   if(this.host&&this.state.runKey)for(const m of this.state.members)if(m.online&&m.id!==this.state.localPlayerId)this.host.send(m.id,{type:'ended',key:this.state.runKey});
   if(own){own.returned=true;own.inRun=false;}this.sendRoster();this.emit();return result;
  }
  if(this.client&&this.state.runKey)this.client.send({type:'return',key:this.state.runKey});
  if(own){own.active=false;own.returned=true;own.inRun=false;}const result=await this.action.settle();this.sendMember(true);this.emit();return result;
 });}
 leave(expectedEpoch=this.epoch):Promise<RoomState>{if(expectedEpoch!==this.epoch)return Promise.reject(Error('房间已变化，旧离房操作已拒绝。'));++this.shareEpoch;return this.task(async()=>{if(expectedEpoch!==this.epoch)throw Error('房间已变化，旧离房操作已拒绝。');await this.leaveInternal(true);return this.state;});}
 private async leaveInternal(settle:boolean):Promise<void>{
  this.clearCards();const oldKey=this.state.runKey;this.desiredActive=false;clearTimeout(this.reconnectTimer);++this.epoch;
  let failure='';
  try{
   if(this.belongs()&&!this.action.state.settled){
    if(this.host){for(const m of this.state.members)m.active=false;await this.activeContext();await this.action.request('finish');this.actionUpdated();this.sendSnapshot(true);if(oldKey)for(const m of this.state.members)if(m.online&&m.id!==this.state.localPlayerId)this.host.send(m.id,{type:'ended',key:oldKey});}
    else{if(this.client&&oldKey)this.client.send({type:'return',key:oldKey});await this.action.pause();}
    if(settle)await this.action.settle();
   }
  }catch(e){failure=cleanError(e);}
  const host=this.host,client=this.client;if(!client&&this.connection?.resume&&!failure)failure='离房未获认证连接确认；房主可能暂留断线席位30秒。';this.host=undefined;this.client=undefined;this.connection=undefined;
  if(client)try{await client.leave();}catch(e){failure=cleanError(e);}finally{await client.close();}
  await host?.close();
  const addresses=this.state.addresses,id=this.state.localPlayerId;this.state={...emptyRoom(addresses,id),roomEpoch:this.epoch,error:failure,notice:failure?'本机已断开；离房未获确认时，房主可能保留断线席位30秒。':'已离开房间，个人经营和挂机继续。'};this.lastMember='';this.localBadge=null;this.reconnectUntil=0;this.offlineAt.clear();await this.party();this.partyHandlers?.membership?.({kind:'closed'});this.emit();
 }
 async close():Promise<void>{await this.task(()=>this.leaveInternal(false));this.disposed=true;clearInterval(this.timer);clearTimeout(this.reconnectTimer);}
 dispose():void{this.clearCards();this.disposed=true;++this.epoch;clearInterval(this.timer);clearTimeout(this.reconnectTimer);void this.host?.close().catch(()=>{});void this.client?.close().catch(()=>{});}
}
