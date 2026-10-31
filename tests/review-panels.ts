import { app, BrowserWindow, globalShortcut } from 'electron';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startDesktop } from '../apps/desktop/bootstrap';

// Independent Luna probe: a separate Electron process, temp userData/session,
// and no programmatic focus calls. This does not emulate physical OS clicks.
const project = path.resolve(__dirname, '..');
const evidence = path.join(project, 'docs/evidence/action-loop/panel-luna-review');
fs.mkdirSync(evidence, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pixelstreet-luna-panels-'));
const focusCalls = { app: 0, window: 0, webContents: 0 };
const focusEvents: unknown[] = [];
const checks: { name: string; detail?: unknown }[] = [];
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn: () => Promise<boolean>, label: string, ms = 10000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { if (await fn()) return; await sleep(40); }
  throw new Error(`Timed out: ${label}`);
}
const passed = (name: string, detail?: unknown) => checks.push({ name, detail });
const js = (win: BrowserWindow, code: string) => win.webContents.executeJavaScript(code);
async function clickControl(win: BrowserWindow, selector: string): Promise<void> {
  const point = await js(win, `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('missing '+${JSON.stringify(selector)});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  for (const type of ['mouseMove', 'mouseDown', 'mouseUp'] as const) {
    win.webContents.sendInputEvent({ type, x: point.x, y: point.y, button: 'left', clickCount: 1 });
  }
  await sleep(160);
}
function patchNoFocus(win: BrowserWindow): void {
  win.focus = (() => { focusCalls.window++; }) as typeof win.focus;
  win.webContents.focus = (() => { focusCalls.webContents++; }) as typeof win.webContents.focus;
  win.on('focus', () => focusEvents.push({ id: win.id, event: 'focus', at: Date.now() }));
  win.on('blur', () => focusEvents.push({ id: win.id, event: 'blur', at: Date.now() }));
}

if (process.platform === 'darwin') app.setActivationPolicy('accessory');
app.focus = (() => { focusCalls.app++; }) as typeof app.focus;
app.on('browser-window-created', (_event, win) => patchNoFocus(win));

let shell: Awaited<ReturnType<typeof startDesktop>> | undefined;
let popup: BrowserWindow | undefined;
void (async () => {
  shell = await startDesktop(profile, true);
  assert.equal(app.getPath('userData'), profile, 'Electron profile is isolated in tempdir');
  await until(() => shell!.overlay.webContents.executeJavaScript("document.body.dataset.atlas==='verified'"), 'atlas load');
  const initialFocus = { ...focusCalls };
  const initialActive = process.platform === 'darwin' ? app.isActive() : undefined;

  shell.openSettings();
  await until(async () => !!shell!.popupWindow?.isVisible() && await js(shell!.popupWindow!, "document.body.dataset.popupReady==='true'"), 'settings native window');
  popup = shell.popupWindow!;
  assert.equal(popup.getParentWindow(), null);
  assert.equal(popup.isAlwaysOnTop(), false);
  assert.equal(popup.isFocusable(), false);
  assert.equal(shell.overlay.isAlwaysOnTop(), true);
  assert.deepEqual(focusCalls, initialFocus, 'opening an inactive settings panel must not call a focus API');
  if (initialActive !== undefined) assert.equal(app.isActive(), initialActive, 'showInactive/moveTop must preserve app activation state');
  passed('Settings opened in an isolated real Electron BrowserWindow: parent=null, normal level, nonfocusable, focus-call counters unchanged', { bounds: popup.getBounds(), appActiveBefore: initialActive, appActiveAfter: process.platform === 'darwin' ? app.isActive() : undefined });

  const label = await js(popup, "document.querySelector('label:has(#alwaysOnTop)')?.innerText");
  assert.match(label, /营地保持在其他窗口前/);
  await clickControl(popup, '#alwaysOnTop');
  assert.equal(shell.store.value.alwaysOnTop, false);
  assert.equal(shell.overlay.isAlwaysOnTop(), false);
  assert.equal(popup.isAlwaysOnTop(), false, 'camp pinning must not promote the large panel');
  await fs.promises.writeFile(path.join(evidence, 'settings-pin-off.png'), (await popup.webContents.capturePage()).toPNG());
  await clickControl(popup, '#alwaysOnTop');
  assert.equal(shell.store.value.alwaysOnTop, true);
  assert.equal(shell.overlay.isAlwaysOnTop(), true);
  assert.equal(popup.isAlwaysOnTop(), false);
  assert.equal(popup.isFocused(), false);
  assert.deepEqual(focusCalls, initialFocus, 'toggling camp pinning must not focus the panel');
  passed('Native settings checkbox toggles only the street overlay; large panel remains normal and unfocused', { label, settingsPinOffScreenshot: 'settings-pin-off.png' });

  const beforeBounds = shell.overlay.getBounds();
  const work = shell.selectedDisplay().workArea;
  const generation = shell.popup!.generation;
  for (const dock of ['top', 'bottom'] as const) for (const height of [48, 80, 112, 160, 208]) {
    shell.store.save({ ...shell.store.value, height, dock });
    shell.settingsChanged();
    const b = shell.overlay.getBounds();
    assert.equal(b.height, height);
    assert.equal(b.x, Math.ceil(work.x));
    assert.equal(b.width, Math.floor(work.x + work.width) - Math.ceil(work.x));
    assert.equal(b.y, dock === 'top' ? Math.ceil(work.y) : Math.floor(work.y + work.height) - height);
    assert.equal(shell.popup!.generation, generation);
    const p = shell.popup!.bounds;
    assert.ok(p.x >= work.x && p.y >= work.y && p.x + p.width <= work.x + work.width && p.y + p.height <= work.y + work.height, `${dock}/${height} popup is within work area`);
  }
  assert.equal(shell.overlay.getBounds().height, 208);
  passed('All five street heights across both dock edges preserve their configured bounds and keep the popup inside workArea', { combinations: 10, workArea: work, beforeBounds });

  // Restore test defaults without closing the cached native window.
  shell.store.save({ ...shell.store.value, height: 112, dock: 'bottom', alwaysOnTop: true });
  shell.settingsChanged();
  await js(popup, "document.getElementById('backupDetails').open=true;document.getElementById('backupText').value='隔离探针草稿';document.querySelector('.popover-content').scrollTop=96;window.__reviewNode=document.getElementById('backupText')");
  const scroll = await js(popup, "document.querySelector('.popover-content').scrollTop");
  const focusBeforeResume = { ...focusCalls };
  app.emit('did-resign-active');
  assert.equal(shell.popup!.suspended, true);
  assert.equal(popup.isVisible(), false);
  passed('Simulated did-resign-active event parks the panel through the app listener (event fixture only, not OS evidence)');
  await js(shell.overlay, "document.body.dataset.reviewClicks='0';document.addEventListener('click',()=>document.body.dataset.reviewClicks=String(Number(document.body.dataset.reviewClicks)+1),true)");

  // Find an actual ground hit in the running scene, then use Electron's native
  // WebContents input API. This is not a physical mouse/OS z-order test.
  const size = shell.overlay.getBounds();
  let ground: { x: number; y: number } | undefined;
  for (const y of [size.height - 3, size.height - 8, size.height - 14, size.height - 20]) {
    for (let x = 24; x < size.width - 24; x += 32) {
      await shell.overlay.webContents.sendInputEvent({ type: 'mouseMove', x, y });
      await sleep(8);
      if (await js(shell.overlay, "document.body.dataset.hover==='ground'")) { ground = { x, y }; break; }
    }
    if (ground) break;
  }
  if (!ground) {
    const diagnostics = await js(shell.overlay, `({height:innerHeight,body:{...document.body.dataset},stage:document.getElementById('stage').getBoundingClientRect().toJSON(),points:${JSON.stringify([size.height - 3, size.height - 8, size.height - 14, size.height - 20])}})`);
    throw new Error(`probe must find a ground point before sending a click: ${JSON.stringify(diagnostics)}`);
  }
  shell.overlay.webContents.sendInputEvent({ type: 'mouseDown', ...ground, button: 'left', clickCount: 1 });
  shell.overlay.webContents.sendInputEvent({ type: 'mouseUp', ...ground, button: 'left', clickCount: 1 });
  await until(async () => !shell!.popup!.suspended && popup!.isVisible(), 'road click resumes popup');
  assert.equal(shell.popup!.generation, generation);
  assert.equal(shell.popupWindow, popup);
  assert.equal(await js(popup, "document.getElementById('backupText')===window.__reviewNode&&document.getElementById('backupText').value==='隔离探针草稿'"), true);
  assert.equal(await js(popup, "document.querySelector('.popover-content').scrollTop"), scroll);
  assert.equal(shell.keyboard, false);
  assert.equal(popup.isFocusable(), false);
  assert.equal(popup.isFocused(), false);
  assert.deepEqual(focusCalls, focusBeforeResume, 'road resume must not call app/window/webContents focus');
  await fs.promises.writeFile(path.join(evidence, 'settings-road-resume.png'), (await popup.webContents.capturePage()).toPNG());
  passed('Synthetic native road click resumes the same BrowserWindow/generation and preserves draft, scroll and DOM node without focus calls', { roadPoint: ground, generation, scroll, focusCalls: { ...focusCalls } });

  // Stale generation and cross-window ownership checks on real loaded renderers.
  const staleGeneration = generation + 10;
  const staleResume = await js(shell.overlay, `window.street.command({type:'resume-popup',generation:${staleGeneration}}).then(()=>false,()=>true)`);
  assert.equal(staleResume, true);
  const popupCannotResume = await js(popup, `window.street.command({type:'resume-popup',generation:${generation}}).then(()=>false,()=>true)`);
  assert.equal(popupCannotResume, true);
  const staleClose = await js(popup, `window.street.command({type:'close-popup',generation:${staleGeneration}}).then(()=>false,()=>true)`);
  assert.equal(staleClose, true);
  assert.equal(shell.popup!.generation, generation);
  passed('Stale generation and popup-origin resume/close attempts are denied; active generation remains unchanged');

  // A resumed dialogue must stay non-keyboard until the user presses its input.
  shell.openPopup('actor', { x: 420, y: 42, width: 30, height: 30 });
  const actorGeneration = shell.popup!.generation;
  await until(async () => await js(popup!, `document.body.dataset.generation==='${actorGeneration}'&&document.body.dataset.popupReady==='true'`), 'actor renderer ready');
  shell.command({ type: 'talk', generation: actorGeneration });
  const dialogueGeneration = shell.popup!.generation;
  await until(async () => await js(popup!, `document.body.dataset.generation==='${dialogueGeneration}'&&document.body.dataset.popupReady==='true'`), 'dialogue renderer ready');
  const focusBeforeDialogueResume = { ...focusCalls };
  app.emit('did-resign-active');
  assert.equal(shell.popup!.suspended, true);
  assert.equal(popup!.isVisible(), false);
  shell.resumePopup(dialogueGeneration);
  assert.equal(shell.popup!.suspended, false);
  assert.equal(shell.keyboard, false);
  assert.equal(popup!.isFocusable(), false);
  assert.equal(popup!.isFocused(), false);
  assert.deepEqual(focusCalls, focusBeforeDialogueResume, 'dialogue restoration does not refocus or steal current input');
  await clickControl(popup!, '#draft');
  assert.equal(shell.keyboard, true, 'only an explicit input press enables keyboard focus');
  assert.equal(focusCalls.app, focusBeforeDialogueResume.app + 1);
  assert.equal(focusCalls.window, focusBeforeDialogueResume.window + 1);
  assert.equal(focusCalls.webContents, focusBeforeDialogueResume.webContents + 1);
  passed('Dialogue restore remains non-focusable; explicit draft pointerdown is the only action that requests focus', { generation: dialogueGeneration, focusBeforeResume: focusBeforeDialogueResume, focusAfterInputPress: { ...focusCalls } });

  // A late renderer-ready message may arrive after suspend; it must not re-show.
  shell.openPopup('actor', { x: 420, y: 42, width: 30, height: 30 });
  const raceGeneration = shell.popup!.generation;
  shell.suspendPopup();
  await until(async () => await js(popup!, "document.body.dataset.generation===String(" + raceGeneration + ")&&document.body.dataset.popupReady==='true'"), 'late popup-ready');
  await sleep(100);
  assert.equal(popup!.isVisible(), false);
  assert.equal(shell.popup!.suspended, true);
  assert.equal(shell.popup!.generation, raceGeneration);
  passed('Late popup-ready cannot resurrect a newly suspended generation', { generation: raceGeneration, visible: popup!.isVisible() });

  shell.hide();
  assert.equal(shell.mode, 'hidden');
  assert.equal(shell.popup, null);
  assert.equal(popup!.isVisible(), false);
  assert.equal(shell.recovery.isVisible(), true);
  passed('Explicitly hiding the camp clears the popup and leaves the recovery arrow visible');

  assert.equal(globalShortcut.isRegistered('CommandOrControl+Alt+G'), false);
  assert.equal(globalShortcut.isRegistered('CommandOrControl+Alt+H'), false);
  const report = {
    at: new Date().toISOString(), status: 'PASS', reviewer: 'gpt-6-luna + max',
    platform: process.platform, arch: process.arch, os: os.release(), electron: process.versions.electron, chromium: process.versions.chrome,
    profile, screenshots: ['settings-pin-off.png', 'settings-road-resume.png'], checks, focusCalls, focusEvents,
    method: 'Separate Electron process and temp userData/solo/session profile. BrowserWindow/app focus calls are stubbed and counted. Settings controls and street are addressed through native Electron WebContents input; DOM state and BrowserWindow native properties are queried. These are not physical OS mouse events and do not prove cross-application z-order, compositor, IME, or keyboard focus behavior.',
    physicalOS: 'NOT TESTED: user must physically click another application and the street on target macOS to establish native z-order and no-focus behavior.'
  };
  await fs.promises.writeFile(path.join(evidence, 'panel-luna-review.json'), JSON.stringify(report, null, 2));
  console.log(`PASS ${checks.length} independent panel review groups`);
  app.quit();
})().catch(async error => {
  const failure = { at: new Date().toISOString(), error: String(error), stack: error?.stack, profile, checks, focusCalls, focusEvents, state: shell?.state() };
  await fs.promises.writeFile(path.join(evidence, 'panel-luna-failure.json'), JSON.stringify(failure, null, 2)).catch(() => {});
  console.error(error);
  app.exit(1);
});
