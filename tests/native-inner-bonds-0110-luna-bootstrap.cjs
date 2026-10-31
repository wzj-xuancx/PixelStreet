'use strict';

// This bootstrap runs before the application bundle can create any window.
// It blocks activation and all visibility/focus APIs, then loads the dedicated
// test bundle placed beside the real desktop runtime in dist/.
const path = require('node:path');
const Module = require('node:module');
const electron = require('electron');
const root = process.cwd();
const suppression = {
  activationPolicy: 'not-applicable', appActivateEvents: 0, appFocus: 0,
  show: 0, showInactive: 0, windowFocus: 0, webContentsFocus: 0,
  moveTop: 0, restore: 0, dockShow: 0, dockActivate: 0,
  globalShortcut: 0, trayCreates: 0, dialogCalls: 0,
};
globalThis.__pixelStreetInnerBonds0110Suppression = suppression;

if (process.platform === 'darwin') {
  electron.app.setActivationPolicy('prohibited');
  suppression.activationPolicy = 'prohibited';
  try { electron.app.dock?.hide(); suppression.dockHidden = true; } catch {}
}

function replace(target, key, value) {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  if (descriptor && !descriptor.configurable && !descriptor.writable) throw new Error(`cannot suppress Electron ${String(key)}`);
  Object.defineProperty(target, key, { configurable: true, enumerable: descriptor?.enumerable ?? true, writable: true, value });
}

replace(electron.app, 'focus', () => { suppression.appFocus++; return false; });
const originalEmit = electron.app.emit;
replace(electron.app, 'emit', function (event, ...args) {
  if (event === 'activate') { suppression.appActivateEvents++; return false; }
  return originalEmit.call(this, event, ...args);
});
const dock = electron.app.dock;
if (dock) for (const [method, key] of [['show', 'dockShow'], ['activate', 'dockActivate']]) {
  if (typeof dock[method] === 'function') replace(dock, method, () => { suppression[key]++; });
}
for (const [method, key] of [['show', 'show'], ['showInactive', 'showInactive'], ['focus', 'windowFocus'], ['moveTop', 'moveTop'], ['restore', 'restore']]) {
  if (typeof electron.BrowserWindow.prototype[method] === 'function') replace(electron.BrowserWindow.prototype, method, function () { suppression[key]++; });
}
electron.app.on('browser-window-created', (_event, win) => {
  if (typeof win.webContents.focus === 'function') win.webContents.focus = () => { suppression.webContentsFocus++; };
});
if (!electron.dialog || typeof electron.dialog.showOpenDialog !== 'function') throw new Error('Electron dialog API unavailable');
replace(electron.dialog, 'showOpenDialog', async () => { suppression.dialogCalls++; throw new Error('native dialogs are prohibited in this hidden-native runner'); });

const inside = file => file === root || file.startsWith(root + path.sep);
const originalLoad = Module._load;
class HiddenTray { constructor() { suppression.trayCreates++; } setToolTip() {} setContextMenu() {} on() { return this; } destroy() {} }
Module._load = function (request, parent, isMain) {
  const loaded = originalLoad.call(this, request, parent, isMain);
  if (request !== 'electron' || !parent?.filename || !inside(path.resolve(parent.filename))) return loaded;
  return new Proxy(loaded, { get(target, key) {
    if (key === 'Tray') return HiddenTray;
    if (key === 'globalShortcut') {
      const api = Reflect.get(target, key, target);
      return new Proxy(api, { get(apiTarget, method) {
        if (['register', 'registerAll', 'unregister', 'unregisterAll'].includes(String(method))) return () => { suppression.globalShortcut++; return false; };
        return Reflect.get(apiTarget, method, apiTarget);
      }});
    }
    return Reflect.get(target, key, target);
  }});
};

require(path.join(root, 'dist', 'native-inner-bonds-0110-luna.cjs'));
