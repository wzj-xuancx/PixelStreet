import { app, BrowserWindow, clipboard } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { startDesktop } from '../apps/desktop/bootstrap';

type Role = 'host' | 'guest';
type Command = { id: number; op: string; [key: string]: unknown };
const role = process.argv.find(value => value.startsWith('--room-role='))?.slice('--room-role='.length) as Role | undefined;
const busArg = process.argv.find(value => value.startsWith('--room-bus='))?.slice('--room-bus='.length);
const profileArg = process.argv.find(value => value.startsWith('--room-profile='))?.slice('--room-profile='.length);
const hideReviewWindows = process.argv.includes('--room-hide-windows');
if (!busArg || !['host', 'guest'].includes(role ?? '')) throw new Error('isolated Luna review role and bus are required');
const own: Role = role!;
const root = path.resolve(busArg);
const profile = profileArg ? path.resolve(profileArg) : path.join(root, 'profiles', own);
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
fs.mkdirSync(path.join(profile, 'solo'), { recursive: true, mode: 0o700 });
fs.mkdirSync(path.join(root, 'screenshots'), { recursive: true, mode: 0o700 });

const failures: string[] = [];
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const atomic = (file: string, value: unknown): void => {
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, JSON.stringify(value), { mode: 0o600 });
  fs.renameSync(temp, file);
};

// Keep each review window non-activating so the probe cannot steal the user's keyboard.
// The fixture is only an application render/logic seam, not proof of OS focus behavior.
app.focus = () => {};
app.on('browser-window-created', (_event, win) => {
  win.focus = () => {};
  win.webContents.focus = () => {};
  const show = win.show.bind(win);
  const showInactive = win.showInactive.bind(win);
  win.show = () => { if (hideReviewWindows) win.hide(); else show(); };
  win.showInactive = () => { if (hideReviewWindows) win.hide(); else showInactive(); };
  win.webContents.on('console-message', event => {
    if (event.level === 'error') failures.push(`console: ${event.message}`);
  });
  win.webContents.on('render-process-gone', (_event, details) => failures.push(`render-process-gone: ${details.reason}/${details.exitCode}`));
  if (win.getTitle().includes('主动冒险')) win.isFocused = () => true;
});

void (async () => {
  const shell = await startDesktop(profile, true);
  const baseline = shell.overlay.getBounds();
  let lastCommand = 0;
  let processing = false;
  const dom = async (win: BrowserWindow | null, source: string): Promise<unknown> => {
    if (!win || win.isDestroyed()) throw new Error('requested renderer window is unavailable');
    return win.webContents.executeJavaScript(source);
  };
  const popupDom = (source: string) => dom(shell.popupWindow, source);
  const arenaDom = (source: string) => dom(shell.arenaWindow, source);
  const publicClick = (win: BrowserWindow | null, id: string): Promise<unknown> => dom(win,
    `(()=>{const e=document.getElementById(${JSON.stringify(id)});if(!e)throw Error('missing public control #'+${JSON.stringify(id)});if(e.hidden)throw Error('public control hidden #'+${JSON.stringify(id)});if(e.disabled)throw Error('public control disabled #'+${JSON.stringify(id)});const r=e.getBoundingClientRect();const init={bubbles:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2,pointerId:1,pointerType:'mouse',isPrimary:true};e.dispatchEvent(new PointerEvent('pointerdown',init));e.dispatchEvent(new MouseEvent('mousedown',init));e.dispatchEvent(new PointerEvent('pointerup',init));e.dispatchEvent(new MouseEvent('mouseup',init));e.click();return {id:e.id,tag:e.tagName,rect:{x:r.x,y:r.y,width:r.width,height:r.height}}})()`);
  const setControl = (win: BrowserWindow | null, id: string, value: string): Promise<unknown> => dom(win,
    `(()=>{const e=document.getElementById(${JSON.stringify(id)});if(!e)throw Error('missing public input #'+${JSON.stringify(id)});const r=e.getBoundingClientRect();const init={bubbles:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2,pointerId:1,pointerType:'mouse',isPrimary:true};e.dispatchEvent(new PointerEvent('pointerdown',init));e.focus();e.value=${JSON.stringify(value)};e.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:${JSON.stringify(value)}}));e.dispatchEvent(new Event('change',{bubbles:true}));return {id:e.id,value:e.value,tag:e.tagName}})()`);
  const waitFor = async (check: () => Promise<boolean>, description: string, timeoutMs = 15000): Promise<void> => {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      try { if (await check()) return; } catch { /* wait until the renderer exists */ }
      await pause(50);
    }
    throw new Error(`timed out waiting for ${description}`);
  };
  const openPanelForPublicEntry = async (kind: 'adventure' | 'room'): Promise<void> => {
    const b = shell.overlay.getBounds();
    const anchor = { x: Math.max(0, b.width - 72), y: Math.max(0, b.height - 38), width: 30, height: 30 };
    shell.openPopup(kind, anchor);
    await waitFor(async () => await popupDom(`document.body.dataset.popup==='${kind}'&&document.body.dataset.popupReady==='true'`) === true, `${kind} public panel`);
  };
  const openRoomViaAdventure = async (): Promise<void> => {
    await openPanelForPublicEntry('adventure');
    await publicClick(shell.popupWindow, 'openRoom');
    await waitFor(async () => await popupDom("document.body.dataset.popup==='room'&&document.body.dataset.popupReady==='true'") === true, 'room panel opened by public button');
  };
  const openArenaViaRoomButton = async (): Promise<void> => {
    if (!shell.popup || shell.popup.kind !== 'room') await openRoomViaAdventure();
    await waitFor(async () => await popupDom("!!document.getElementById('roomOpenAction')&&!document.getElementById('roomOpenAction').disabled") === true, 'room open-arena button enabled');
    await publicClick(shell.popupWindow, 'roomOpenAction');
    await waitFor(async () => !!shell.arenaWindow && !shell.arenaWindow.isDestroyed() && (hideReviewWindows || shell.arenaWindow.isVisible()) && await arenaDom("document.body.dataset.arenaAssets==='ready'&&!!document.getElementById('arenaWelcome')") === true, 'native arena and assets', 20000);
    shell.arenaWindow!.isFocused = () => true;
    await arenaDom("window.dispatchEvent(new Event('focus'));true");
    shell.arenaWindow!.emit('focus');
  };
  const canvasInput = (x: number, y: number, button: 0 | 2): Promise<unknown> => arenaDom(
    `(()=>{const c=document.getElementById('arenaCanvas');if(!c)throw Error('arena canvas absent');const r=c.getBoundingClientRect();const clientX=r.left+r.width*${x}/960,clientY=r.top+r.height*${y}/540;const init={bubbles:true,button:${button},clientX,clientY,pointerId:1,pointerType:'mouse',isPrimary:true};c.dispatchEvent(new PointerEvent('pointermove',init));c.dispatchEvent(new PointerEvent('pointerdown',init));c.dispatchEvent(new PointerEvent('pointerup',init));return {x:${x},y:${y},button:${button},rect:{x:r.x,y:r.y,width:r.width,height:r.height}}})()`);
  const snapshot = async (): Promise<Record<string, unknown>> => {
    let ui: unknown = null;
    if (shell.arenaWindow && !shell.arenaWindow.isDestroyed() && (shell.arenaWindow.isVisible() || hideReviewWindows)) {
      ui = await arenaDom(`(()=>({documentHasFocus:document.hasFocus(),assets:document.body.dataset.arenaAssets,level:document.getElementById('arenaLevel')?.textContent,wave:document.getElementById('arenaWave')?.textContent,hp:document.getElementById('arenaHp')?.textContent,team:document.getElementById('arenaTeam')?.innerText,visible:{welcome:!document.getElementById('arenaWelcome')?.hidden,upgrade:!document.getElementById('arenaUpgrade')?.hidden,result:!document.getElementById('arenaResult')?.hidden},controls:Object.fromEntries(['arenaStart','arenaContinue','arenaClose','arenaReturn','arenaClaim','arenaNova','arenaWard'].map(id=>{const e=document.getElementById(id);return [id,e?{hidden:e.hidden,disabled:e.disabled,text:e.innerText}:null]})),weaponCards:[...document.querySelectorAll('[data-weapon]')].map(e=>({weapon:e.dataset.weapon,pressed:e.getAttribute('aria-pressed'),disabled:e.disabled})),upgradeCards:[...document.querySelectorAll('.upgrade-card')].map(e=>({disabled:e.disabled,upgrade:e.dataset.upgrade,text:e.innerText})),canvas:{width:document.getElementById('arenaCanvas')?.getBoundingClientRect().width,height:document.getElementById('arenaCanvas')?.getBoundingClientRect().height},errors:document.getElementById('arenaError')?.innerText}))()`);
    }
    else if (shell.popupWindow && !shell.popupWindow.isDestroyed() && (shell.popupWindow.isVisible() || hideReviewWindows)) {
      ui = await popupDom(`(()=>({documentHasFocus:document.hasFocus(),popup:document.body.dataset.popup,ready:document.body.dataset.popupReady,roomOnline:document.getElementById('roomOnlineCount')?.textContent,roomCount:document.getElementById('roomMemberCount')?.textContent,members:document.getElementById('roomMembers')?.innerText,error:document.getElementById('roomError')?.innerText||document.getElementById('popupError')?.innerText,copyStatus:document.getElementById('roomCopyStatus')?.innerText,partyNote:document.getElementById('partyRewardNote')?.innerText,controls:Object.fromEntries(['roomHost','roomJoin','roomCopy','roomOpenAction','openRoom','openAction'].map(id=>{const e=document.getElementById(id);return [id,e?{hidden:e.hidden,disabled:e.disabled,text:e.innerText}:null]}))}))()`);
    }
    return {
      at: new Date().toISOString(), role: own, pid: process.pid, profile, baseline,
      shell: shell.state(), rawAction: shell.action.state, room: shell.room.state,
      arenaWindow: shell.arenaWindow && !shell.arenaWindow.isDestroyed() ? { visible: shell.arenaWindow.isVisible(), bounds: shell.arenaWindow.getBounds(), fixtureIsFocused: shell.arenaWindow.isFocused() } : null,
      popup: shell.popup, popupVisible: !!shell.popupWindow?.isVisible(), ui, failures: [...failures],
    };
  };
  const capture = async (name: string): Promise<string> => {
    const arenaAvailable = shell.arenaWindow && !shell.arenaWindow.isDestroyed() && (shell.arenaWindow.isVisible() || hideReviewWindows);
    const popupAvailable = shell.popupWindow && !shell.popupWindow.isDestroyed() && (shell.popupWindow.isVisible() || hideReviewWindows);
    const win = arenaAvailable ? shell.arenaWindow! : popupAvailable ? shell.popupWindow! : shell.overlay;
    const file = path.join(root, 'screenshots', `${own}-${name.replace(/[^a-z0-9-]/gi, '-')}.png`);
    fs.writeFileSync(file, (await win.webContents.capturePage()).toPNG(), { mode: 0o600 });
    return file;
  };

  const timer = setInterval(() => { void snapshot().then(value => atomic(path.join(root, `${own}-state.json`), value)).catch(error => failures.push(`snapshot: ${String(error)}`)); }, 250);
  const poll = setInterval(() => {
    if (processing) return;
    const file = path.join(root, `${own}-command.json`);
    if (!fs.existsSync(file)) return;
    let command: Command;
    try { command = JSON.parse(fs.readFileSync(file, 'utf8')) as Command; } catch { return; }
    if (command.id <= lastCommand) return;
    lastCommand = command.id;
    processing = true;
    void (async () => {
      let result: unknown;
      switch (command.op) {
        case 'bootstrap-room': await openRoomViaAdventure(); result = 'adventure→openRoom public click'; break;
        case 'click': {
          const target = command.target === 'arena' ? shell.arenaWindow : shell.popupWindow;
          result = await publicClick(target, String(command.element));
          break;
        }
        case 'set': {
          const target = command.target === 'arena' ? shell.arenaWindow : shell.popupWindow;
          result = await setControl(target, String(command.element), String(command.value));
          break;
        }
        case 'select-weapon': {
          const weapon = String(command.weapon);
          result = await dom(shell.arenaWindow, `(()=>{const e=document.querySelector('[data-weapon="'+${JSON.stringify(weapon)}+'"]');if(!e)throw Error('weapon card absent');if(e.disabled)throw Error('weapon card disabled');e.click();return {weapon:e.dataset.weapon,pressed:e.getAttribute('aria-pressed')}})()`);
          break;
        }
        case 'upgrade': {
          const index = Number(command.index);
          if (!Number.isInteger(index) || index < 0 || index > 2) throw new Error('upgrade index must be 0, 1, or 2');
          result = await arenaDom(`(()=>{const e=document.querySelectorAll('.upgrade-card')[${index}];if(!e)throw Error('public upgrade card absent');if(e.hidden||e.disabled)throw Error('public upgrade card unavailable');const r=e.getBoundingClientRect();const init={bubbles:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2,pointerId:1,pointerType:'mouse',isPrimary:true};e.dispatchEvent(new PointerEvent('pointerdown',init));e.dispatchEvent(new MouseEvent('mousedown',init));e.dispatchEvent(new PointerEvent('pointerup',init));e.dispatchEvent(new MouseEvent('mouseup',init));e.click();return {upgrade:e.dataset.upgrade,rect:{x:r.x,y:r.y,width:r.width,height:r.height}}})()`);
          break;
        }
        case 'open-arena': await openArenaViaRoomButton(); result = 'roomOpenAction public click; synthetic DOM focus'; break;
        case 'focus-arena': {
          if (!shell.arenaWindow) throw new Error('arena absent');
          await arenaDom("window.dispatchEvent(new Event('focus'));true");
          shell.arenaWindow.emit('focus'); result = 'synthetic DOM focus plus native app focus-event handler'; break;
        }
        case 'blur-arena': {
          if (!shell.arenaWindow) throw new Error('arena absent');
          await arenaDom("window.dispatchEvent(new Event('blur'));true");
          shell.arenaWindow.emit('blur'); result = 'synthetic DOM blur plus native app blur-event handler'; break;
        }
        case 'canvas': result = await canvasInput(Number(command.x), Number(command.y), command.button === 2 ? 2 : 0); break;
        case 'open-room-ui': await openRoomViaAdventure(); result = 'test bootstrap opened adventure; public openRoom click'; break;
        case 'open-solo-arena': {
          await openPanelForPublicEntry('adventure');
          await publicClick(shell.popupWindow, 'openAction');
          await waitFor(async () => !!shell.arenaWindow && !shell.arenaWindow.isDestroyed() && (hideReviewWindows || shell.arenaWindow.isVisible()) && await arenaDom("document.body.dataset.arenaAssets==='ready'") === true, 'solo arena visibility/assets', 20000);
          shell.arenaWindow!.isFocused = () => true;
          await arenaDom("window.dispatchEvent(new Event('focus'));true");
          shell.arenaWindow!.emit('focus');
          result = 'test bootstrap opened adventure panel; actual public openAction click; synthetic DOM focus';
          break;
        }
        case 'copy-invitation': {
          const original = await clipboard.readText();
          await publicClick(shell.popupWindow, 'roomCopy');
          await waitFor(async () => await popupDom("document.getElementById('roomCopyStatus')?.textContent==='邀请已复制到剪贴板，可直接发送给好友。'") === true, 'copy confirmation');
          const invitation = await clipboard.readText();
          atomic(path.join(root, 'invitation.private'), { invitation });
          await clipboard.writeText(original);
          result = { copied: /^PS1@127\.0\.0\.1:[1-9][0-9]*#[A-Za-z0-9_-]{22}$/.test(invitation), status: '邀请已复制到剪贴板，可直接发送给好友。', clipboardRestored: true };
          break;
        }
        case 'join-invitation': {
          const invitation = (JSON.parse(fs.readFileSync(path.join(root, 'invitation.private'), 'utf8')) as { invitation: string }).invitation;
          await setControl(shell.popupWindow, 'roomInvitation', invitation);
          result = await publicClick(shell.popupWindow, 'roomJoin');
          break;
        }
        case 'wait-arena': await waitFor(async () => !!shell.arenaWindow && !shell.arenaWindow.isDestroyed() && (hideReviewWindows || shell.arenaWindow.isVisible()) && await arenaDom("document.body.dataset.arenaAssets==='ready'") === true, 'arena visibility/assets', 20000); await arenaDom("window.dispatchEvent(new Event('focus'));true"); result = true; break;
        case 'inspect': result = await snapshot(); break;
        case 'capture': result = await capture(String(command.name ?? 'capture')); break;
        case 'drop-peer': {
          const remote = shell.room.state.members.find(member => member.id !== shell.room.state.localPlayerId && member.online);
          if (!remote) throw new Error('no online remote member to drop');
          const host = (shell.room as unknown as { host?: { disconnect(peerId: string, reason: string): void } }).host;
          if (!host) throw new Error('host TCP server unavailable');
          host.disconnect(remote.id, 'independent review: transient socket close after welcome');
          result = { peerId: remote.id, injectedBy: 'direct RoomService host socket disconnect; real Node TCP peer close' };
          break;
        }
        case 'quit':
          atomic(path.join(root, `${own}-reply.json`), { id: command.id, ok: true, result: 'quitting' });
          clearInterval(timer); clearInterval(poll); app.quit(); return;
        default: throw new Error(`unknown independent review operation ${command.op}`);
      }
      const state = await snapshot();
      atomic(path.join(root, `${own}-reply.json`), { id: command.id, ok: true, result, state });
      atomic(path.join(root, `${own}-state.json`), state);
    })().catch(error => atomic(path.join(root, `${own}-reply.json`), { id: command.id, ok: false, error: String(error), stack: error instanceof Error ? error.stack : '' })).finally(() => { processing = false; });
  }, 50);
  atomic(path.join(root, `${own}-state.json`), await snapshot());
})().catch(error => {
  atomic(path.join(root, `${own}-fatal.json`), { error: String(error), stack: error instanceof Error ? error.stack : '', failures });
  console.error(error);
  app.exit(1);
});
