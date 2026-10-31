'use strict';

// Install fail-closed native-window guards before importing the actual desktop
// runner. This process may render hidden Electron pages, but it never reveals or
// activates a native window.
const path = require('node:path');
const Module = require('node:module');
const electron = require('electron');
const root = process.cwd();
const runner = path.join(root, 'dist', 'native-tower-0130-luna.cjs');

if (process.env.PIXELSTREET_TOWER0130_GO !== '1') throw Error('Refusing hidden-native tower acceptance before the root final-manifest GO.');
if (path.resolve(process.env.PIXELSTREET_TOWER0130_RUNNER || '') !== runner) throw Error('PIXELSTREET_TOWER0130_RUNNER must point to ' + runner + ' so preload and Worker paths resolve from dist.');
if (!process.env.PIXELSTREET_TOWER0130_MANIFEST) throw Error('Root must provide PIXELSTREET_TOWER0130_MANIFEST for exact final candidate hash comparison.');
if (!['fresh', 'veteran', 'caps', 'blocked', 'complete', 'rewards'].includes(process.env.PIXELSTREET_TOWER0130_FIXTURE || '')) throw Error('PIXELSTREET_TOWER0130_FIXTURE must be fresh, veteran, caps, blocked, complete, or rewards.');

const suppression = {
  activationPolicy: 'not-applicable', appActivateEvents: 0, appFocus: 0,
  show: 0, showInactive: 0, windowFocus: 0, webContentsFocus: 0,
  moveTop: 0, restore: 0, dockShow: 0, dockActivate: 0,
  globalShortcut: 0, trayConstructorIntercepts: 0, dialogCalls: 0,
};
globalThis.__pixelStreetTower0130Suppression = suppression;
function replace(target, key, value) {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  if (descriptor && !descriptor.configurable && !descriptor.writable) throw Error('cannot intercept Electron ' + String(key));
  Object.defineProperty(target, key, { configurable: true, enumerable: descriptor?.enumerable ?? true, writable: true, value });
}
if (process.platform === 'darwin') {
  electron.app.setActivationPolicy('prohibited');
  suppression.activationPolicy = 'prohibited';
  try { electron.app.dock?.hide(); } catch {}
}
replace(electron.app, 'focus', () => { suppression.appFocus++; return false; });
const originalEmit = electron.app.emit;
replace(electron.app, 'emit', function (event, ...args) {
  if (event === 'activate') { suppression.appActivateEvents++; return false; }
  return originalEmit.call(this, event, ...args);
});
try {
  const dock = electron.app.dock;
  if (dock) for (const [method, key] of [['show', 'dockShow'], ['activate', 'dockActivate']]) {
    if (typeof dock[method] === 'function') replace(dock, method, () => { suppression[key]++; return false; });
  }
} catch (error) { throw Error('could not suppress Dock activation: ' + String(error)); }
for (const [method, key] of [['show', 'show'], ['showInactive', 'showInactive'], ['focus', 'windowFocus'], ['moveTop', 'moveTop'], ['restore', 'restore']]) {
  if (typeof electron.BrowserWindow.prototype[method] === 'function') replace(electron.BrowserWindow.prototype, method, function () { suppression[key]++; return false; });
}
if (!electron.dialog || typeof electron.dialog.showOpenDialog !== 'function') throw Error('Electron file-dialog API unavailable');
for (const method of ['showOpenDialog', 'showSaveDialog', 'showMessageBox']) {
  if (typeof electron.dialog[method] === 'function') replace(electron.dialog, method, async () => { suppression.dialogCalls++; throw Error('native dialogs are prohibited during hidden-native acceptance'); });
}
if (typeof electron.dialog.showErrorBox === 'function') replace(electron.dialog, 'showErrorBox', () => { suppression.dialogCalls++; throw Error('native dialogs are prohibited during hidden-native acceptance'); });
if (electron.Menu && typeof electron.Menu.setApplicationMenu === 'function') replace(electron.Menu, 'setApplicationMenu', () => {});
electron.app.on('browser-window-created', (_event, win) => {
  try { if (typeof win.webContents.focus === 'function') win.webContents.focus = function () { suppression.webContentsFocus++; return false; }; }
  catch (error) { throw Error('could not intercept webContents.focus: ' + String(error)); }
});
const inside = file => file === root || file.startsWith(root + path.sep);
const originalLoad = Module._load;
class HiddenTray {
  constructor() { suppression.trayConstructorIntercepts++; }
  setToolTip() {}
  setContextMenu() {}
  on() { return this; }
  destroy() {}
}
Module._load = function (request, parent, isMain) {
  const loaded = originalLoad.call(this, request, parent, isMain);
  if (request !== 'electron' || !parent?.filename || !inside(path.resolve(parent.filename))) return loaded;
  return new Proxy(loaded, {
    get(target, key) {
      if (key === 'Tray') return HiddenTray;
      if (key === 'globalShortcut') {
        const api = Reflect.get(target, key, target);
        return new Proxy(api, { get(apiTarget, method) {
          if (['register', 'registerAll', 'unregister', 'unregisterAll'].includes(String(method))) return () => { suppression.globalShortcut++; return false; };
          return Reflect.get(apiTarget, method, apiTarget);
        } });
      }
      return Reflect.get(target, key, target);
    },
  });
};
require(runner);
