import {masteryBadge,masteryBadgeText} from './mastery-art';
import type { ShellState } from '../../../packages/protocol';
import { roomIdentityTint, validRoomName, type RoomCommand, type RoomMember, type RoomState } from '../../../packages/protocol/room';

import {itemCardDefinition} from '../../../packages/solo-core/item-cards';
import {cardContents,itemCardArt} from './item-card';
import {GameButton} from './game-button';
let detailCardId:number|undefined,readThrough=0;
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const multipliers = [1, 1.05, 1.1, 1.15];

export type RoomPanelCommand = RoomCommand;

export function roomMarkup(): string {
  detailCardId=undefined;readThrough=0;
  return `<section id="roomCurrent" class="room-section">
    <div class="room-state-line"><strong id="roomStateLabel">尚未加入房间</strong><span id="roomOnlineCount"></span></div>
    <p id="roomNotice" class="room-notice" role="status"></p><p id="roomAddress" class="room-address" hidden></p>
    <div class="room-actions"><button id="roomCopy" type="button">复制邀请</button><button id="roomLeave" type="button">离开房间</button></div>
    <p id="roomCopyStatus" role="status"></p></section>
    <section id="roomSetup" class="room-section"><label class="room-field">昵称<input id="roomName" type="text" maxlength="80" autocomplete="nickname" placeholder="1–20个字符"></label>
    <label class="room-field">本机监听地址<select id="roomBind"></select></label><button id="roomHost" class="room-action primary" type="button">创建好友房间</button>
    <label class="room-field">好友邀请<input id="roomInvitation" type="text" maxlength="160" autocomplete="off" spellcheck="false" placeholder="PS3@地址:端口#口令"></label><button id="roomJoin" class="room-action" type="button">加入好友房间</button></section>
    <section class="room-members-section"><div class="room-state-line"><strong>当前成员</strong><span id="roomMemberCount"></span></div><ul id="roomMembers" class="room-members" aria-live="polite"></ul></section>
    <details id="roomSocial"><summary>聊天与物品展示</summary><div id="roomChats" class="room-chats" role="log" aria-live="polite"></div><form id="roomChatForm" class="room-chat-form"><input id="roomChatText" aria-label="聊天消息" maxlength="400" autocomplete="off" placeholder="和好友说句话…"><button id="roomChatSend" type="submit">发送</button></form><section id="roomCardsSection"><div class="room-state-line"><strong>最近展示</strong><span>仅展示</span></div><div id="roomCards" class="room-cards"></div><p id="roomCardsEmpty">在背包中右键持有物品，选择分享卡片。</p></section>
    </details><section id="roomCardDetail" class="room-card-detail" hidden role="dialog" aria-label="物品展示详情"><div id="roomCardDetailBody"></div><button id="roomCardClose" type="button">关闭详情</button></section>
    <details id="roomGuide"><summary>房间与展示说明</summary><p>双方使用0.19.0客户端（加密房间协议3），在同一局域网或已授权私网组网；邀请由房主主动复制，房间消息统一加密。主动战斗仍为单人。</p><p>原挂机远征每位额外在线队友使金币、经验和旧野外材料增加5%，上限15%，小额余数累计；新野外与共斗按个人基础掉落表结算。</p><p>分享只展示本地物品信息与发送端声明的数量，不转移所有权，也不是可交易资产凭证。最近6张卡片和40条聊天临时保存，离房清除；徽章是对方自行声明的纪念展示，不代表服务器认证；不影响奖励和挂机加成。旧版本需双方升级后再连接。</p></details><div id="roomError" class="error" role="alert"></div>`;
}

function cleanName(value: string): string {
  const name = value.trim().normalize('NFC');
  if (!validRoomName(name)) throw new Error('昵称需为1–20个Unicode字符，且不能含控制字符。');
  return name;
}

function validInvitation(value: string): string {
  const invitation = value.trim();
  if(/^PS[12]@/.test(invitation))throw Error('房间版本不一致，请双方使用0.19.0并重新复制PS3邀请。');
  const match = /^PS3@((?:\d{1,3}\.){3}\d{1,3}):([1-9]\d{0,4})#([A-Za-z0-9_-]{22})$/.exec(invitation);
  if (!match) throw new Error('邀请格式应为 PS3@IPv4:端口#22位口令。');
  const octets = match[1].split('.');
  if (octets.some(part => Number(part) > 255 || String(Number(part)) !== part) || Number(match[2]) > 65535) {
    throw new Error('邀请中的IPv4地址或端口无效。');
  }
  return invitation;
}

function roomStatus(room: RoomState): string {
  if (room.status === 'blocked') return '房间功能暂不可用';
  if (room.status === 'joining') return '正在加入好友房间';
  if (room.status === 'reconnecting') return '连接中断 · 正在恢复';
  if (room.status === 'disconnected') return '连接已断开';
  if (room.role === 'host' && room.status === 'hosting') return '你是房主';
  if (room.role === 'guest' && room.status === 'joined') return '已加入好友房间';
  return '尚未加入房间';
}

function memberLabel(member: RoomMember, room: RoomState): string {
  if (!member.online) return '离线 · 身份暂留';
  return member.id === room.hostId ? '在线 · 房主' : '在线 · 营地队友';
}

function setAddressOptions(room: RoomState): void {
  const select = $('roomBind') as HTMLSelectElement;
  const values = room.addresses;
  const signature = values.join('|');
  if (select.dataset.addresses === signature) return;
  const previous = select.value;
  select.replaceChildren();
  for (const address of values) select.add(new Option(address === '127.0.0.1' ? `${address} · 仅本机` : address, address));
  if (!values.includes(previous)) select.value = values[0] ?? '';
  select.dataset.addresses = signature;
}

function setMembers(room: RoomState): void {
  const list = $('roomMembers');
  const members = [...room.members].sort((a, b) => a.id.localeCompare(b.id));
  if (!members.length) {
    if (list.dataset.members !== 'empty') {
      const empty = document.createElement('li');
      empty.className = 'room-members-empty';
      empty.textContent = '加入或创建房间后，成员会显示在这里。';
      list.replaceChildren(empty);
      list.dataset.members = 'empty';
    }
    return;
  }
  const signature = members.map(member => member.id).join('|');
  if (list.dataset.members !== signature) {
    list.replaceChildren();
    for (const member of members) {
      const item = document.createElement('li');
      item.className = 'room-member';
      item.dataset.memberId = member.id;
      const dot = document.createElement('span');
      dot.className = 'room-member-dot';
      dot.setAttribute('aria-hidden', 'true');
      const name = document.createElement('strong');
      name.className = 'room-member-name';
      const status = document.createElement('span');
      status.className = 'room-member-status';
      const badge=document.createElement('span');badge.className='room-member-badge';
      item.append(dot,name,badge,status);
      list.append(item);
    }
    list.dataset.members = signature;
  }
  for (const member of members) {
    const item = list.querySelector<HTMLElement>(`[data-member-id="${CSS.escape(member.id)}"]`);
    if (!item) continue;
    const local = member.id === room.localPlayerId;
    item.classList.toggle('offline', !member.online);
    const dot = item.querySelector<HTMLElement>('.room-member-dot')!;
    dot.dataset.host = String(member.id === room.hostId);
    dot.style.backgroundColor = member.online ? `#${roomIdentityTint(room.members, member.id).toString(16).padStart(6, '0')}` : '#777f7b';
    item.querySelector<HTMLElement>('.room-member-name')!.textContent = `${member.name}${local ? '（你）' : ''}${member.id === room.hostId ? ' · 房主' : ''}`;
    const badge=item.querySelector<HTMLElement>('.room-member-badge')!;const badgeId=member.badge??'';if(badge.dataset.badge!==badgeId){badge.dataset.badge=badgeId;badge.innerHTML=masteryBadge(member.badge,20);}
    item.querySelector<HTMLElement>('.room-member-status')!.textContent = memberLabel(member, room);
  }
}

function setCards(room:RoomState):void{
 const list=$('roomCards'),ids=new Set(room.cards.map(card=>String(card.id)));
 for(const child of Array.from(list.children))if(!ids.has((child as HTMLElement).dataset.cardId??''))child.remove();
 for(const card of room.cards){
  let b=list.querySelector<HTMLButtonElement>(`[data-card-id="${card.id}"]`);
  if(!b){b=document.createElement('button');b.type='button';b.className='room-card';b.dataset.cardId=String(card.id);b.innerHTML=itemCardArt(card.itemId)+'<span><strong></strong><small></small></span>'+masteryBadge(card.badge,24,false);GameButton.enhance(b);b.addEventListener('click',()=>{detailCardId=card.id;const detail=$('roomCardDetailBody');detail.replaceChildren(cardContents(card));detail.querySelector('[data-card-quantity]')!.textContent=`展示数量 ×${card.quantity.toLocaleString('zh-CN')}`;$('roomCardDetail').hidden=false;$('roomCardClose').focus({preventScroll:true});});list.append(b);}
  const name=itemCardDefinition(card.itemId)!.name,sender=room.members.find(m=>m.id===card.senderId)?.name??'已离开的队友';
  const title=`${name} ×${card.quantity.toLocaleString('zh-CN')}`,subtitle=`${sender} · 展示`;
  if(b.querySelector('strong')!.textContent!==title)b.querySelector('strong')!.textContent=title;
  if(b.querySelector('small')!.textContent!==subtitle)b.querySelector('small')!.textContent=subtitle;
  const label=`${title}，${sender}展示，查看详情${card.badge?'；'+masteryBadgeText(card.badge):''}`;b.dataset.tooltip=label;if(b.getAttribute('aria-label')!==label)b.setAttribute('aria-label',label);
 }
 $('roomCardsEmpty').hidden=room.cards.length>0;
 if(detailCardId!==undefined&&!room.cards.some(c=>c.id===detailCardId)){$('roomCardDetail').hidden=true;detailCardId=undefined;}
}

export function updateRoom(state: ShellState, busy = false): void {
  const room = state.room;
  const inRoom = room.role !== 'none';
  const size = Math.max(1, Math.min(4, state.game.partySize || 1));
  setAddressOptions(room);
  $('roomSetup').hidden = inRoom;
  $('roomStateLabel').textContent = roomStatus(room);
  $('roomOnlineCount').textContent = inRoom ? `${room.members.filter(member => member.online).length}/4 在线` : '';
  $('roomAddress').hidden = !(room.role === 'host' && !!room.address);
  $('roomAddress').textContent = room.role === 'host' && room.address ? `好友连接地址：${room.address}` : '';
  $('roomNotice').textContent = room.runKey ? '检测到历史房间战斗状态；本版本不会同步或继续房间战斗。请在本机结算保留的旧战斗存档。' : room.notice;
  $('roomError').textContent = room.error;
  $('roomMemberCount').textContent = inRoom ? `${room.members.length}人 · ${room.members.filter(member => member.online).length}人在线 · 挂机 ×${multipliers[size - 1]}` : '';
  $('roomCopy').hidden = room.role !== 'host' || room.status !== 'hosting';
  if (room.role !== 'host') $('roomCopyStatus').textContent = '';
  $('roomLeave').hidden = !inRoom;
  ($('roomHost') as HTMLButtonElement).disabled = busy || room.status !== 'idle' || !room.addresses.length || state.game.status !== 'ready';
  ($('roomJoin') as HTMLButtonElement).disabled = busy || room.status !== 'idle' || state.game.status !== 'ready';
  ($('roomCopy') as HTMLButtonElement).disabled = busy;
  ($('roomLeave') as HTMLButtonElement).disabled = busy;
  setMembers(room);setCards(room);
  const log=$('roomChats'),chatIds=new Set(room.chats.map(c=>String(c.id)));
  for(const child of Array.from(log.children))if(!chatIds.has((child as HTMLElement).dataset.chatId??''))child.remove();
  for(const chat of room.chats){if(log.querySelector(`[data-chat-id="${chat.id}"]`))continue;const line=document.createElement('p');line.dataset.chatId=String(chat.id);const name=room.members.find(m=>m.id===chat.senderId)?.name??'已离开的队友';line.textContent=`${name}：${chat.text}`;log.append(line);log.scrollTop=log.scrollHeight;}
  ($('roomChatSend') as HTMLButtonElement).disabled=busy||!['hosting','joined'].includes(room.status);
  ($('roomChatText') as HTMLInputElement).disabled=!['hosting','joined'].includes(room.status);
  if(state.popup?.kind==='room'&&!state.popup.suspended&&!document.hidden&&room.unreadCards>0){const latest=room.cards.at(-1)?.id??0;if(latest>readThrough){readThrough=latest;void window.street.command({type:'room-read',generation:state.popup.generation}).catch(()=>{readThrough=0;});}}

}

export function bindRoom(
  getState: () => ShellState,
  generation: number,
  send: (command: RoomPanelCommand) => Promise<void>,
  onError: (message: string) => void,
): void {
  let pending = false;
  for(const b of Array.from(document.querySelectorAll<HTMLElement>('body[data-popup=room] button')))GameButton.enhance(b);
  GameButton.enhance($('roomGuide').querySelector('summary')!);GameButton.enhance($('roomSocial').querySelector('summary')!);
  $('roomCardClose').addEventListener('click',()=>{const id=detailCardId;detailCardId=undefined;$('roomCardDetail').hidden=true;if(id!==undefined)$('roomCards').querySelector<HTMLButtonElement>(`[data-card-id="${id}"]`)?.focus({preventScroll:true});});
  const clearDetail=()=>{detailCardId=undefined;if(document.getElementById('roomCardDetail'))$('roomCardDetail').hidden=true;};
  window.addEventListener('blur',clearDetail);document.addEventListener('visibilitychange',()=>{if(document.hidden)clearDetail();});
  $('roomCardDetail').addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();$('roomCardClose').click();}});

  const current = (): boolean => getState().popup?.kind === 'room' && getState().popup?.generation === generation && !!document.getElementById('roomBind');
  const submit = (make: () => RoomPanelCommand, success?: () => void): void => {
    if (pending || !current()) return;
    let command: RoomPanelCommand;
    try { command = make(); } catch (error) { onError(error instanceof Error ? error.message : String(error)); return; }
    pending = true;
    onError('');
    updateRoom(getState(), true);
    void send(command).then(() => { if(current())success?.(); }).catch(error => {
      if(current())onError(error instanceof Error ? error.message : String(error));
    }).finally(() => {
      pending = false;
      if(current())updateRoom(getState());
    });
  };
  let composing=false;const chat=$('roomChatText') as HTMLInputElement;chat.addEventListener('compositionstart',()=>{composing=true;});chat.addEventListener('compositionend',()=>{composing=false;});chat.addEventListener('keydown',event=>{if(event.key==='Enter'&&(composing||event.isComposing||event.keyCode===229))event.preventDefault();});
  $('roomChatForm').addEventListener('submit',event=>{event.preventDefault();if(composing)return;submit(()=>({type:'room-chat',generation,text:chat.value.trim()}),()=>{chat.value='';});});
  const name = (): string => cleanName(($('roomName') as HTMLInputElement).value);
  $('roomHost').addEventListener('click', () => submit(() => {
    const bind = ($('roomBind') as HTMLSelectElement).value;
    if (!getState().room.addresses.includes(bind)) throw new Error('请选择本机可用的监听地址。');
    return { type: 'room-host', name: name(), bind, generation };
  }));
  $('roomJoin').addEventListener('click', () => submit(() => ({
    type: 'room-join', name: name(), invitation: validInvitation(($('roomInvitation') as HTMLInputElement).value), generation,
  }), () => { ($('roomInvitation') as HTMLInputElement).value = ''; }));
  $('roomCopy').addEventListener('click', () => {
    $('roomCopyStatus').textContent = '';
    submit(() => ({ type: 'room-copy', generation }), () => {
      $('roomCopyStatus').textContent = '邀请已复制到剪贴板，可直接发送给好友。';
    });
  });
  $('roomLeave').addEventListener('click', () => submit(() => ({ type: 'room-leave', generation,roomEpoch:getState().room.roomEpoch })));
}
