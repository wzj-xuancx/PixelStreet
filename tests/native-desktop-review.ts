import { app, BrowserWindow, globalShortcut, screen, session } from 'electron';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startDesktop } from '../apps/desktop/bootstrap';
import { defaults, heightPresets } from '../packages/protocol';

// Independent P4 review probe. It uses a private Electron userData/solo folder,
// addresses only this app's WebContents, and never sends system-wide input.
const sourceRoot = path.resolve(process.env.PIXELSTREET_REVIEW_SOURCE_ROOT ?? path.resolve(__dirname, '..'));
const evidenceRoot = path.resolve(process.env.PIXELSTREET_REVIEW_EVIDENCE_ROOT ?? path.join(sourceRoot, 'docs/evidence/action-loop'));
const evidenceDir = path.join(evidenceRoot, 'desktop-final-luna');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pixelstreet-p4-luna-'));
fs.mkdirSync(path.join(evidenceDir, 'screenshots'), { recursive: true });

type Check = { name: string; status: 'PASS'; detail?: unknown };
const checks: Check[] = [];
const layoutEvidence: unknown[] = [];
const nativeEvents: unknown[] = [];
const focusCalls = { app: 0, window: 0, webContents: 0, showInactive: 0 };
const focusEvents: unknown[] = [];
const globalShortcutCalls: unknown[] = [];
const permissionHandlers: { request?: Function; check?: Function } = {};
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const pass = (name: string, detail?: unknown) => checks.push({ name, status: 'PASS', detail });

async function until(fn: () => Promise<boolean> | boolean, label: string, timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await pause(35);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function patchNonactivating(win: BrowserWindow): void {
  const nativeShowInactive = win.showInactive.bind(win);
  win.showInactive = (() => {
    focusCalls.showInactive++;
    nativeEvents.push({ at: Date.now(), windowId: win.id, action: 'showInactive', bounds: win.getBounds() });
    nativeShowInactive();
  }) as typeof win.showInactive;
  win.focus = (() => { focusCalls.window++; }) as typeof win.focus;
  win.webContents.focus = (() => { focusCalls.webContents++; }) as typeof win.webContents.focus;
  for (const event of ['focus', 'blur', 'show', 'hide', 'resize']) {
    win.on(event as any, () => focusEvents.push({ at: Date.now(), windowId: win.id, event, visible: win.isVisible() }));
  }
}

let shell: Awaited<ReturnType<typeof startDesktop>> | undefined;
let finalReport: Record<string, unknown> = {};
const writeReport = async (status: string, extra: Record<string, unknown> = {}) => {
  const rendererPath = path.join(__dirname, 'renderer/main.js');
  const testBundlePath = __filename;
  const hashFile = async (file: string) => fs.promises.readFile(file).then(bytes => createHash('sha256').update(bytes).digest('hex')).catch(() => null);
  finalReport = {
    schema: 'pixelstreet.desktop-final-luna.v1',
    at: new Date().toISOString(),
    status,
    reviewer: 'gpt-6-luna + max',
    platform: process.platform,
    arch: process.arch,
    os: os.release(),
    electron: process.versions.electron,
    chromium: process.versions.chrome,
    sourceRoot,
    frozenBuild: {
      root: path.resolve(__dirname, '..'),
      renderer: rendererPath,
      rendererSha256: await hashFile(rendererPath),
      testBundle: testBundlePath,
      testBundleSha256: await hashFile(testBundlePath),
    },
    profile,
    checks,
    layoutEvidence,
    nativeEvents,
    focusCalls,
    focusEvents,
    globalShortcutCalls,
    method: 'Isolated real Electron BrowserWindows from a frozen work copy; DOM geometry and synthetic input are queried only through this app\'s WebContents. app/window/webContents focus calls are no-ops; showInactive is observed and delegated to Electron\'s non-activating native method. No global input hooks are installed.',
    evidenceBoundary: {
      programmatic: 'Native BrowserWindow bounds/attributes, renderer DOM geometry, Pixi atlas/layout, hover state, app event fixture, IPC permission handlers, and WebContents synthetic input.',
      physicalOs: 'Not tested by this probe: physical mouse behavior, cross-app compositor/z-order, real macOS activation/focus behavior, Chinese IME, menu-bar/tray click, and long-duration flicker.',
    },
    ...extra,
  };
  await fs.promises.writeFile(path.join(evidenceRoot, 'desktop-final-luna.json'), JSON.stringify(finalReport, null, 2));
};

const js = (win: BrowserWindow, code: string) => win.webContents.executeJavaScript(code);
const overlayJS = (code: string) => js(shell!.overlay, code);
const popupJS = (code: string) => js(shell!.popupWindow!, code);
const openSettings = async () => {
  if (shell!.popup?.kind !== 'settings') await overlayJS("document.getElementById('openSettings').click()");
  await until(async () => shell!.popup?.kind === 'settings' && !!shell!.popupWindow?.isVisible() && await popupJS("document.body.dataset.popupReady==='true' && document.body.dataset.popup==='settings'"), 'settings panel ready');
};
const closeSettings = async () => {
  if (shell!.popup?.kind === 'settings') await overlayJS("document.getElementById('openSettings').click()");
  await until(() => shell!.popup === null && !shell!.popupWindow?.isVisible(), 'settings panel hidden');
};
function closeEnough(actual: number, expected: number, label: string, tolerance = 0.35): void {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: expected ${expected}, got ${actual}`);
}

async function captureAverage(region: { x: number; y: number; width: number; height: number }): Promise<number> {
  const bitmap = (await shell!.overlay.webContents.capturePage(region)).toBitmap();
  let sum = 0;
  for (let i = 0; i < bitmap.length; i += 4) sum += bitmap[i] + bitmap[i + 1] + bitmap[i + 2];
  return sum / Math.max(1, bitmap.length / 4 * 3);
}

async function findGroundPoint(): Promise<{ x: number; y: number }> {
  const bounds = shell!.overlay.getBounds();
  for (const y of [bounds.height - 3, bounds.height - 8, bounds.height - 14, bounds.height - 20]) {
    for (let x = 24; x < bounds.width - 24; x += 32) {
      await shell!.overlay.webContents.sendInputEvent({ type: 'mouseMove', x, y });
      await pause(12);
      if (await overlayJS("document.body.dataset.hover==='ground'")) return { x, y };
    }
  }
  throw new Error('Could not find a scene ground point for the in-place resume input fixture');
}

void (async () => {
  if (process.platform === 'darwin') app.setActivationPolicy('accessory');
  app.focus = (() => { focusCalls.app++; }) as typeof app.focus;
  app.on('browser-window-created', (_event, win) => patchNonactivating(win));
  const shortcut = globalShortcut as any;
  for (const method of ['register', 'registerAll', 'unregister', 'unregisterAll']) {
    const original = shortcut[method]?.bind(shortcut);
    if (original) shortcut[method] = (...args: unknown[]) => {
      globalShortcutCalls.push({ method, args: method.startsWith('unregister') ? undefined : args });
      return original(...args);
    };
  }

  await app.whenReady();
  const permissionSession = session.fromPartition('pixel-street-s1');
  const sessionAny = permissionSession as any;
  const nativeRequestSetter = permissionSession.setPermissionRequestHandler.bind(permissionSession);
  const nativeCheckSetter = permissionSession.setPermissionCheckHandler.bind(permissionSession);
  sessionAny.setPermissionRequestHandler = (handler: Function) => { permissionHandlers.request = handler; nativeRequestSetter(handler as any); };
  sessionAny.setPermissionCheckHandler = (handler: Function) => { permissionHandlers.check = handler; nativeCheckSetter(handler as any); };
  const activeBefore = process.platform === 'darwin' ? app.isActive() : undefined;

  shell = await startDesktop(profile, true);
  assert.equal(app.getPath('userData'), profile, 'Electron userData must be isolated');
  await until(() => overlayJS("document.body.dataset.atlas==='verified'"), 'verified native atlas');
  assert.equal(shell.game.state.status, 'ready', 'private GameWorker profile must be ready');
  const displays = shell.displays();
  assert.ok(displays.length >= 2, `P4 native layout requires two physical displays; detected ${displays.length}`);
  const targetDisplays = displays.slice(0, 2);

  const permissionBrowser = shell.overlay.webContents;
  assert.equal(typeof permissionHandlers.request, 'function', 'deny-all permission request handler must be registered');
  assert.equal(typeof permissionHandlers.check, 'function', 'deny-all permission check handler must be registered');
  let permissionGranted: boolean | undefined;
  permissionHandlers.request!(permissionBrowser, 'geolocation', (value: boolean) => { permissionGranted = value; }, { securityOrigin: 'file://pixelstreet.invalid', requestingUrl: 'file://pixelstreet.invalid/' });
  assert.equal(permissionGranted, false, 'permission request callback must deny without a prompt');
  assert.equal(permissionHandlers.check!(permissionBrowser, 'notifications', 'file://pixelstreet.invalid', {}), false, 'permission check must deny');
  pass('Permission requests and checks are configured deny-all without invoking a system prompt');

  const overlayApi = await overlayJS("({keys:Object.keys(window.street).sort(),node:typeof window.require,process:typeof window.process,primary:Array.from(document.querySelectorAll('#primaryBar button:not([hidden])')).map(e=>e.id),portal:!!document.getElementById('portalSign'),hide:!!document.getElementById('displayHide')})");
  assert.equal(overlayApi.node, 'undefined');
  assert.equal(overlayApi.process, 'undefined');
  assert.deepEqual(overlayApi.primary, ['openSettings', 'displayHide']);
  assert.equal(overlayApi.portal, true);
  assert.equal(overlayApi.hide, true);
  pass('Street exposes only settings/hide controls and visible portal; no renderer Node access', overlayApi);

  await openSettings();
  const popup = shell.popupWindow!;
  const popupId = popup.id;
  const generation = shell.popup!.generation;
  assert.equal(popup.getParentWindow(), null, 'large panel must be an ordinary unparented native window');
  assert.equal(popup.isAlwaysOnTop(), false, 'large panel must remain normal z-order');
  assert.equal(popup.isFocusable(), false, 'settings panel must not take keyboard focus');
  assert.equal(shell.overlay.isAlwaysOnTop(), true, 'default camp overlay remains pinned when opted in');
  assert.deepEqual({ app: focusCalls.app, window: focusCalls.window, webContents: focusCalls.webContents }, { app: 0, window: 0, webContents: 0 }, 'initial show must not call focus APIs');
  assert.ok(focusCalls.showInactive >= 2, 'camp and panel should use the non-activating show method');
  await popupJS('window.__reviewHeightChoices=document.getElementById("heightChoices");window.__reviewBackup=document.getElementById("backupText")');
  pass('Settings is a cached unparented normal-level, nonfocusable native window', { popupId, generation, popupBounds: popup.getBounds(), campBounds: shell.overlay.getBounds(), focusCalls: { ...focusCalls } });

  for (let i = 0; i < 6; i++) {
    await closeSettings();
    assert.equal(shell.popupWindow, popup, `close cycle ${i + 1} must retain the same native window`);
    assert.equal(popup.id, popupId);
    await openSettings();
    assert.equal(shell.popupWindow, popup, `open cycle ${i + 1} must reuse the native window`);
    assert.equal(shell.popup!.generation > generation, true);
  }
  assert.equal(await popupJS('document.getElementById("heightChoices")!==window.__reviewHeightChoices'), true, 'new generation must rebuild the content while reusing the native window');
  assert.equal(await popupJS(`window.street.command({type:'popup-ready',generation:${generation}}).then(()=>false,()=>true)`), true, 'old settings generation readiness must be rejected');
  assert.deepEqual({ app: focusCalls.app, window: focusCalls.window, webContents: focusCalls.webContents }, { app: 0, window: 0, webContents: 0 });
  pass('Same toolbar button toggles settings six times while retaining one native BrowserWindow without focus calls', { popupId, focusCalls: { ...focusCalls } });

  const atlas = JSON.parse(await fs.promises.readFile(path.join(sourceRoot, 'assets/atlas.json'), 'utf8')) as { frames: Record<string, { w: number; h: number; anchor: [number, number] }> };
  const fontHeights: Record<string, number> = {};
  for (const display of targetDisplays) {
    for (const dock of ['top', 'bottom'] as const) {
      for (const height of heightPresets) {
        await popupJS(`(()=>{document.getElementById('displayId').value=${JSON.stringify(String(display.id))};document.getElementById('dock').value=${JSON.stringify(dock)};document.querySelector('[data-height="${height}"]').click()})()`);
        await until(async () => shell!.store.value.height === height && shell!.store.value.dock === dock && shell!.store.value.displayId === display.id && shell!.overlay.getBounds().height === height && shell!.selectedDisplay().id === display.id && await overlayJS(`document.body.dataset.dock==='${dock}'&&document.body.dataset.view==='street'&&Number(document.body.dataset.worldScale)>0`) && await popupJS(`document.getElementById('heightChoices').dataset.value==='${height}'`), `native display ${display.id} ${dock} ${height} layout`);
        await pause(80);

        const work = display.workArea;
        const native = shell!.overlay.getBounds();
        const expected = {
          x: Math.ceil(work.x),
          y: dock === 'top' ? Math.ceil(work.y) : Math.floor(work.y + work.height) - height,
          width: Math.max(1, Math.floor(work.x + work.width) - Math.ceil(work.x)),
          height,
        };
        assert.deepEqual(native, expected, `native camp bounds for ${display.id}/${dock}/${height}`);
        assert.equal(shell!.popupWindow, popup);
        assert.equal(popup.getParentWindow(), null);
        assert.equal(popup.isAlwaysOnTop(), false);
        const panelBounds = popup.getBounds();
        assert.ok(panelBounds.x >= work.x - 1 && panelBounds.y >= work.y - 1 && panelBounds.x + panelBounds.width <= work.x + work.width + 1 && panelBounds.y + panelBounds.height <= work.y + work.height + 1, 'popup must remain inside the selected display workArea');

        const dom = await overlayJS(`(()=>{const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom}};const font=e=>{const range=document.createRange();range.selectNodeContents(e.querySelector('span'));return{box:rect(e),glyphHeight:range.getBoundingClientRect().height,fontSize:getComputedStyle(e).fontSize,hidden:e.hidden,hovered:e.classList.contains('is-hovered'),pressed:e.getAttribute('aria-pressed')}};const p=document.getElementById('portalSign');return{innerWidth,innerHeight,worldX:Number(document.body.dataset.worldX),worldY:Number(document.body.dataset.worldY),scale:Number(document.body.dataset.worldScale),dock:document.body.dataset.dock,view:document.body.dataset.view,portal:{...font(p),place:p.dataset.place,label:p.getAttribute('aria-label')},shops:Array.from(document.querySelectorAll('[data-shop]')).map(e=>({id:e.dataset.shop,...font(e)})),shopTransform:getComputedStyle(document.getElementById('shopSigns')).transform,placeTransform:getComputedStyle(document.getElementById('placeSigns')).transform}})()`);
        const scale = dom.scale;
        assert.equal(dom.portal.hidden, false, 'portal sign must stay visible at every height');
        assert.equal(dom.portal.place, 'adventure-portal');
        assert.equal(dom.portal.label, '打开远征之门');
        closeEnough(dom.portal.box.x, dom.worldX + 493 * scale, 'portal sign x');
        closeEnough(dom.portal.box.y, dom.worldY - 55 * scale, 'portal sign y');
        closeEnough(dom.portal.box.width, 66 * scale, 'portal sign width');
        closeEnough(dom.portal.box.height, 57 * scale, 'portal sign height');
        closeEnough(dom.portal.box.bottom - dom.worldY, 2 * scale, 'portal sign road overlap');
        closeEnough(dom.portal.box.x - (dom.worldX + (455 - atlas.frames['portal-0'].anchor[0] + atlas.frames['portal-0'].w) * scale), 6 * scale, 'portal sprite/sign gap');
        assert.equal(dom.shopTransform, dom.placeTransform, 'shops and portal signs must share one transform');
        assert.equal(dom.portal.fontSize, '14px');

        const shops: unknown[] = [];
        for (const [id, logicalX, frameId] of [['shop-bakery', 90, 'shop-bakery'], ['shop-alchemy', 290, 'shop-alchemy']] as const) {
          const sign = dom.shops.find((x: any) => x.id === id)! as any;
          assert.equal(sign.hidden, height === 48, `${id} compact visibility at ${height}`);
          if (height === 48) { shops.push({ id, hidden: sign.hidden }); continue; }
          closeEnough(sign.box.x, dom.worldX + (logicalX + 64) * scale, `${id} sign x`);
          closeEnough(sign.box.y, dom.worldY - 55 * scale, `${id} sign y`);
          closeEnough(sign.box.width, 66 * scale, `${id} sign width`);
          closeEnough(sign.box.height, 57 * scale, `${id} sign height`);
          closeEnough(sign.box.bottom - dom.worldY, 2 * scale, `${id} road overlap`);
          const frame = atlas.frames[frameId];
          const buildingRight = logicalX - frame.anchor[0] + frame.w;
          closeEnough(sign.box.x - (dom.worldX + buildingRight * scale), 8 * scale, `${id} sprite/sign gap`);
          assert.equal(sign.fontSize, '14px');
          fontHeights[id] ??= sign.glyphHeight / scale;
          closeEnough(sign.glyphHeight / scale, fontHeights[id], `${id} normalized glyph height`, 0.75);
          shops.push({ id, ...sign, normalizedGlyphHeight: sign.glyphHeight / scale });
        }
        const placement = { displayId: display.id, label: display.label, scaleFactor: display.scaleFactor, workArea: work, dock, height, nativeBounds: native, popupBounds: panelBounds, popupSide: shell!.popup!.side, portal: dom.portal, shops, sharedSignTransform: dom.shopTransform };
        layoutEvidence.push(placement);
        if (height === 112 && dock === 'bottom') {
          await fs.promises.writeFile(path.join(evidenceDir, 'screenshots', `native-display-${String(display.id)}-112-bottom.png`), (await shell!.overlay.webContents.capturePage()).toPNG());
        }
      }
    }
  }
  assert.equal(layoutEvidence.length, 20, 'must exercise 2 real displays × 2 docks × 5 heights');
  pass('Actual two-display native bounds, popup containment, portal visibility, signage/font scaling and sprite/sign alignment across both docks and all five heights', { layouts: layoutEvidence.length, displays: targetDisplays.map(d => ({ id: d.id, label: d.label, workArea: d.workArea, scaleFactor: d.scaleFactor })), fontHeights });

  // Return the private profile to a stable visible layout before scene interaction.
  await popupJS(`(()=>{document.getElementById('displayId').value='auto';document.getElementById('dock').value='bottom';document.querySelector('[data-height="112"]').click()})()`);
  await until(() => shell!.store.value.height === 112 && shell!.store.value.dock === 'bottom' && shell!.overlay.getBounds().height === 112 && shell!.selectedDisplay().id === screen.getPrimaryDisplay().id, 'primary display baseline');
  await pause(100);
  const sceneOrigin = await overlayJS("({x:Number(document.body.dataset.worldX),y:Number(document.body.dataset.worldY),scale:Number(document.body.dataset.worldScale)})");

  await closeSettings();
  const settingsNativeId = popup.id;
  shell!.openSettings();
  await openSettings();
  const pinStart = { ...focusCalls };
  await popupJS("document.getElementById('alwaysOnTop').click()");
  await until(() => shell!.store.value.alwaysOnTop === false, 'camp pin off');
  assert.equal(shell!.overlay.isAlwaysOnTop(), false);
  assert.equal(popup.isAlwaysOnTop(), false);
  await popupJS("document.getElementById('alwaysOnTop').click()");
  await until(() => shell!.store.value.alwaysOnTop === true, 'camp pin on');
  assert.equal(shell!.overlay.isAlwaysOnTop(), true);
  assert.equal(popup.isAlwaysOnTop(), false, 'camp pin preference must not promote ordinary panel');
  assert.deepEqual({ app: focusCalls.app, window: focusCalls.window, webContents: focusCalls.webContents }, { app: pinStart.app, window: pinStart.window, webContents: pinStart.webContents });
  pass('Settings pin toggle changes only camp overlay z-order and leaves the cached large panel ordinary/unfocused', { popupId: settingsNativeId, overlayTopmost: shell!.overlay.isAlwaysOnTop(), panelTopmost: popup.isAlwaysOnTop(), focusCalls: { ...focusCalls } });

  // Preserve settings draft and scroll in the same native/renderer generation.
  const draftText = 'P4隔离草稿：不可覆盖';
  await popupJS(`(()=>{document.getElementById('backupDetails').open=true;document.getElementById('backupText').value=${JSON.stringify(draftText)};document.querySelector('.popover-content').scrollTop=70;window.__reviewDraftNode=document.getElementById('backupText')})()`);
  const draftScroll = await popupJS('document.querySelector(".popover-content").scrollTop');
  const resumeGeneration = shell!.popup!.generation;
  const focusBeforeSuspend = { app: focusCalls.app, window: focusCalls.window, webContents: focusCalls.webContents };
  shell!.suspendPopup();
  assert.equal(shell!.popup!.suspended, true);
  assert.equal(popup.isVisible(), false);
  const staleReadyAfterSuspend = await popupJS(`window.street.command({type:'popup-ready',generation:${resumeGeneration}}).then(()=>false,()=>true)`);
  assert.equal(staleReadyAfterSuspend, false, 'current generation ready may be acknowledged but suspended guard must hold');
  await pause(100);
  assert.equal(popup.isVisible(), false, 'late ready must not resurrect a suspended panel');
  const ground = await findGroundPoint();
  await shell!.overlay.webContents.sendInputEvent({ type: 'mouseDown', x: ground.x, y: ground.y, button: 'left', clickCount: 1 });
  await shell!.overlay.webContents.sendInputEvent({ type: 'mouseUp', x: ground.x, y: ground.y, button: 'left', clickCount: 1 });
  await until(() => shell!.popup?.generation === resumeGeneration && shell!.popup.suspended === false && popup.isVisible(), 'road click resumes same panel');
  assert.equal(shell!.popupWindow, popup);
  assert.equal(popup.id, popupId);
  assert.equal(await popupJS(`document.getElementById('backupText')===window.__reviewDraftNode&&document.getElementById('backupText').value===${JSON.stringify(draftText)}`), true);
  assert.equal(await popupJS('document.querySelector(".popover-content").scrollTop'), draftScroll);
  assert.equal(shell!.keyboard, false);
  assert.equal(popup.isFocusable(), false);
  assert.deepEqual({ app: focusCalls.app, window: focusCalls.window, webContents: focusCalls.webContents }, focusBeforeSuspend, 'road resume must not call focus APIs');
  const staleResume = await overlayJS(`window.street.command({type:'resume-popup',generation:${resumeGeneration + 1}}).then(()=>false,()=>true)`);
  assert.equal(staleResume, true, 'wrong generation must be rejected');
  const popupResume = await popupJS(`window.street.command({type:'resume-popup',generation:${resumeGeneration}}).then(()=>false,()=>true)`);
  assert.equal(popupResume, true, 'popup renderer cannot resume itself');
  pass('Temporary suspend and synthetic road resume preserve same native window, generation, draft node/value and scroll; stale/cross-owner resume is rejected', { popupId, generation: resumeGeneration, draftScroll, ground, focusCalls: { ...focusCalls } });
  await closeSettings();

  // Sign/building hover are bidirectionally linked, then entering/leaving a shop must preserve its geometry.
  for (const [shopId, logicalX, frameId, interiorFrame, label] of [
    ['shop-bakery', 90, 'shop-bakery', 'interior-bakery', '补给商店'],
    ['shop-alchemy', 290, 'shop-alchemy', 'interior-alchemy', '炼金工坊'],
  ] as const) {
    const frame = atlas.frames[frameId];
    const signBefore = await overlayJS(`(()=>{const e=document.querySelector('[data-shop="${shopId}"]'),r=e.getBoundingClientRect();return{rect:{x:r.x,y:r.y,width:r.width,height:r.height},scale:Number(document.body.dataset.worldScale),worldX:Number(document.body.dataset.worldX),worldY:Number(document.body.dataset.worldY),transform:getComputedStyle(document.getElementById('shopSigns')).transform}})()`);
    assert.equal(signBefore.scale, sceneOrigin.scale);
    const building = { x: sceneOrigin.x + (logicalX - frame.anchor[0]) * sceneOrigin.scale, y: sceneOrigin.y - frame.anchor[1] * sceneOrigin.scale, width: frame.w * sceneOrigin.scale, height: frame.h * sceneOrigin.scale };
    const crop = { x: Math.round(building.x), y: Math.round(building.y), width: Math.max(1, Math.round(building.width)), height: Math.max(1, Math.round(building.height)) };
    await overlayJS("document.dispatchEvent(new MouseEvent('mouseleave'))");
    await pause(80);
    const before = await captureAverage(crop);
    await overlayJS(`(()=>{const e=document.querySelector('[data-shop="${shopId}"] span'),r=e.getBoundingClientRect();document.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:r.x+r.width/2,clientY:r.y+r.height/2}))})()`);
    await pause(180);
    const after = await captureAverage(crop);
    const signHover = await overlayJS(`(()=>{const e=document.querySelector('[data-shop="${shopId}"]');return{hover:document.body.dataset.hover,highlight:e.classList.contains('is-hovered'),background:getComputedStyle(e.querySelector('span')).backgroundColor,aria:e.getAttribute('aria-pressed')}})()`);
    assert.equal(signHover.hover, shopId);
    assert.equal(signHover.highlight, true);
    assert.ok(after > before * 1.04, `${shopId} sprite should brighten when its sign is hovered: ${before} -> ${after}`);
    await overlayJS(`document.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:${sceneOrigin.x + logicalX * sceneOrigin.scale},clientY:${sceneOrigin.y - 45 * sceneOrigin.scale}}))`);
    await pause(100);
    const buildingHover = await overlayJS(`(()=>{const e=document.querySelector('[data-shop="${shopId}"]');return{hover:document.body.dataset.hover,highlight:e.classList.contains('is-hovered'),background:getComputedStyle(e.querySelector('span')).backgroundColor}})()`);
    assert.equal(buildingHover.hover, shopId);
    assert.equal(buildingHover.highlight, true, 'sprite hover must highlight its matching sign');
    await overlayJS("document.dispatchEvent(new MouseEvent('mouseleave'))");
    await pause(80);
    assert.equal(await overlayJS(`document.querySelector('[data-shop="${shopId}"]').classList.contains('is-hovered')`), false);
    await overlayJS(`document.querySelector('[data-shop="${shopId}"]').click()`);
    await until(() => shell!.view === 'interior' && shell!.activeShop === shopId, `${shopId} interior entry`);
    await until(async () => await overlayJS(`document.body.dataset.interiorFrame==='${interiorFrame}'&&document.querySelector('[data-shop="${shopId}"]').getAttribute('aria-pressed')==='true'`), `${shopId} cutaway ready`);
    const inside = await overlayJS(`(()=>{const e=document.querySelector('[data-shop="${shopId}"]'),r=e.getBoundingClientRect();return{rect:{x:r.x,y:r.y,width:r.width,height:r.height},text:e.innerText,label:e.getAttribute('aria-label'),aria:e.getAttribute('aria-pressed'),badge:document.getElementById('interiorBadge').textContent,portalHidden:document.getElementById('portalSign').hidden}})()`);
    assert.deepEqual(inside.rect, signBefore.rect, 'inside/exit sign must not move or resize');
    assert.match(inside.text, /离开/);
    assert.match(inside.label, new RegExp(`离开${label}`));
    assert.equal(inside.aria, 'true');
    assert.equal(inside.portalHidden, false);
    assert.equal(shell!.overlay.getBounds().height, 112);
    if (shopId === 'shop-bakery') {
      const keeperPoint = { x: sceneOrigin.x + 124 * sceneOrigin.scale, y: sceneOrigin.y - 20 * sceneOrigin.scale };
      await overlayJS(`document.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:${keeperPoint.x},clientY:${keeperPoint.y}}))`);
      await until(() => overlayJS("document.body.dataset.hover==='keeper'"), 'bakery keeper hit');
      await overlayJS(`document.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:${keeperPoint.x},clientY:${keeperPoint.y}}))`);
      await until(async () => shell!.popup?.kind === 'shop' && !!shell!.popupWindow?.isVisible() && await popupJS("document.body.dataset.popupReady==='true'"), 'original bakery shop panel');
      const shopPanel = await popupJS("({title:document.querySelector('h1')?.textContent,apply:!!document.getElementById('applyJob'),trial:!!document.getElementById('trialCraft'),deliver:!!document.getElementById('deliverTrial'),generation:document.body.dataset.generation})");
      assert.equal(shopPanel.title, '炉边补给店');
      assert.equal(shopPanel.apply && shopPanel.trial && shopPanel.deliver, true, 'original shop job/trial actions remain reachable');
      await popupJS("document.getElementById('popupClose').click()");
      await until(() => shell!.popup === null && !popup.isVisible(), 'close original shop panel');
      pass('Bakery cutaway still exposes the original keeper and job/trial shop panel without changing street height', { keeperPoint, shopPanel });
    }
    await overlayJS(`document.querySelector('[data-shop="${shopId}"]').click()`);
    await until(() => shell!.view === 'street' && shell!.activeShop === shopId, `${shopId} interior exit`);
    await until(async () => await overlayJS(`document.body.dataset.interiorFrame===''&&document.querySelector('[data-shop="${shopId}"]').getAttribute('aria-pressed')==='false'`), `${shopId} street restored`);
    const out = await overlayJS(`(()=>{const e=document.querySelector('[data-shop="${shopId}"]'),r=e.getBoundingClientRect();return{rect:{x:r.x,y:r.y,width:r.width,height:r.height},text:e.innerText,label:e.getAttribute('aria-label'),aria:e.getAttribute('aria-pressed'),portalHidden:document.getElementById('portalSign').hidden}})()`);
    assert.deepEqual(out.rect, signBefore.rect, 'street sign geometry must be restored in place');
    assert.equal(out.aria, 'false');
    assert.equal(out.portalHidden, false);
    const pixel = { shopId, sign: signBefore, building, crop, hoverBefore: before, hoverAfter: after, signHover, buildingHover, inside, out };
    layoutEvidence.push({ shopFlow: pixel });
    pass(`${shopId} building/sign hover is linked both ways; inside/exit keeps sign geometry and portal available`, { signHover, buildingHover, inside, out, brightnessRatio: after / before });
  }

  await openSettings();
  await popupJS("document.getElementById('interactionEnabled').click()");
  await popupJS("document.getElementById('save').click()");
  await until(() => shell!.store.value.interactionEnabled === false, 'interaction permission disabled');
  await overlayJS("document.querySelector('[data-shop=shop-bakery]').click()");
  await pause(120);
  assert.equal(shell!.view, 'street', 'disabled interaction must prevent entering shop');
  await popupJS("document.getElementById('interactionEnabled').click();document.getElementById('save').click()");
  await until(() => shell!.store.value.interactionEnabled === true, 'interaction permission restored');
  await closeSettings();
  const hideControls = await overlayJS("({buttons:Array.from(document.querySelectorAll('#primaryBar button')).map(e=>({id:e.id,label:e.getAttribute('aria-label')})),recoveryButton:!!document.getElementById('recoverArrow')})");
  assert.deepEqual(hideControls.buttons.map((x: any) => x.id), ['openSettings', 'displayHide']);
  assert.equal(hideControls.recoveryButton, false, 'recovery control appears only after hide');
  await openSettings();
  const hiddenGeneration = shell!.popup!.generation;
  await overlayJS("document.getElementById('displayHide').click()");
  await until(() => shell!.mode === 'hidden' && !shell!.overlay.isVisible() && shell!.recovery.isVisible(), 'hide arrow state');
  assert.equal(shell!.popup, null);
  assert.equal(shell!.popupWindow?.isVisible(), false);
  assert.equal(await popupJS(`window.street.command({type:'popup-ready',generation:${hiddenGeneration}}).then(()=>false,()=>true)`), true, 'hidden/closed panel readiness must be stale');
  assert.equal(popup.isVisible(), false);
  assert.equal(shell!.recovery.isFocusable(), false);
  const recoveryState = await js(shell!.recovery, "({button:!!document.getElementById('recoverArrow'),label:document.getElementById('recoverArrow')?.getAttribute('aria-label'),count:document.querySelectorAll('button').length})");
  assert.equal(recoveryState.button, true);
  assert.equal(recoveryState.count, 1);
  await js(shell!.recovery, "document.getElementById('recoverArrow').click()");
  await until(() => shell!.mode === 'display' && shell!.overlay.isVisible() && !shell!.recovery.isVisible(), 'recovery arrow restore');
  assert.equal(shell!.overlay.getBounds().height, 112);
  assert.equal(shell!.overlay.isFocusable(), false);
  assert.equal(globalShortcutCalls.length, 0, 'desktop must not install global shortcut hooks');
  assert.equal(globalShortcut.isRegistered('CommandOrControl+Alt+G'), false);
  assert.equal(globalShortcut.isRegistered('CommandOrControl+Alt+H'), false);
  assert.deepEqual({ app: focusCalls.app, window: focusCalls.window, webContents: focusCalls.webContents }, { app: 0, window: 0, webContents: 0 }, 'no workflow used a focus API');
  if (activeBefore !== undefined) assert.equal(app.isActive(), activeBefore, 'showInactive flows must not activate the app');
  pass('Hide arrow and recovery permission boundary work with one-button recovery; no global shortcuts or focus calls', { hideControls, recoveryState, focusCalls: { ...focusCalls }, activeBefore, activeAfter: process.platform === 'darwin' ? app.isActive() : undefined });

  await writeReport('PASS_PROGRAMMATIC_NATIVE_REVIEW', {
    limitations: ['This is not physical OS/IME/tray acceptance.', 'Two-display coordinates are native Electron bounds queried from actual connected displays; mouse interactions are synthetic WebContents events.', 'P1 parent/AOT legacy expectations from tests/native-smoke.ts and tests/button-audit.ts were deliberately excluded.'],
  });
  console.log(`PASS_PROGRAMMATIC_NATIVE_REVIEW ${checks.length} groups; ${targetDisplays.length * 2 * heightPresets.length} native layouts; ${layoutEvidence.length - targetDisplays.length * 2 * heightPresets.length} shop-flow records`);
  app.quit();
})().catch(async error => {
  const detail = { error: String(error), stack: error?.stack, currentState: shell?.state(), windows: BrowserWindow.getAllWindows().map(win => ({ id: win.id, visible: win.isVisible(), bounds: win.getBounds(), parentId: win.getParentWindow()?.id ?? null, alwaysOnTop: win.isAlwaysOnTop() })) };
  await writeReport('FAIL', { failure: detail, limitations: ['This is not physical OS/IME/tray acceptance.'] }).catch(() => {});
  console.error(error);
  app.exit(1);
});
