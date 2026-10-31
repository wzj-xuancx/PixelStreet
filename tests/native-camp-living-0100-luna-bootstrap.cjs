'use strict';

// Must run before the product bundle constructs DesktopShell. This harness is
// intentionally fail-closed: all native windows remain hidden and unfocused.
const path = require('node:path');
const Module = require('node:module');
const electron = require('electron');
const root = process.cwd();
const suppression = {
  activationPolicy: 'not-applicable', appActivateEvents: 0, appFocus: 0,
  show: 0, showInactive: 0, windowFocus: 0, webContentsFocus: 0, moveTop: 0,
  windowRestore: 0, dockShow: 0, dockActivate: 0,
  globalShortcut: 0, trayCreates: 0, dialogCalls: 0,
};
globalThis.__pixelStreetCampLiving0100Suppression = suppression;

if (process.platform === 'darwin') {
  electron.app.setActivationPolicy('prohibited');
  suppression.activationPolicy = 'prohibited';
  try { electron.app.dock?.hide(); } catch {}
}

function replace(target, key, value) {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  if (descriptor && !descriptor.configurable && !descriptor.writable) {
    throw new Error(`cannot suppress Electron ${String(key)}`);
  }
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: descriptor?.enumerable ?? true,
    writable: true,
    value,
  });
}

replace(electron.app, 'focus', () => { suppression.appFocus++; });
const originalEmit = electron.app.emit;
replace(electron.app, 'emit', function (event, ...args) {
  if (event === 'activate') {
    suppression.appActivateEvents++;
    return false;
  }
  return originalEmit.call(this, event, ...args);
});
try {
  const dock = electron.app.dock;
  if (dock) {
    for (const [method, key] of [['show', 'dockShow'], ['activate', 'dockActivate']]) {
      if (typeof dock[method] === 'function') replace(dock, method, () => { suppression[key]++; });
    }
  }
} catch (error) {
  throw new Error(`could not suppress Dock activation: ${String(error)}`);
}

for (const [method, key] of [
  ['show', 'show'], ['showInactive', 'showInactive'], ['focus', 'windowFocus'],
  ['moveTop', 'moveTop'], ['restore', 'windowRestore'],
]) {
  if (typeof electron.BrowserWindow.prototype[method] === 'function') {
    replace(electron.BrowserWindow.prototype, method, function () { suppression[key]++; });
  }
}

if (!electron.dialog || typeof electron.dialog.showOpenDialog !== 'function') {
  throw new Error('Electron dialog API unavailable');
}
replace(electron.dialog, 'showOpenDialog', async () => {
  suppression.dialogCalls++;
  throw new Error('native file chooser is prohibited in the camp hidden-native runner');
});

electron.app.on('browser-window-created', (_event, win) => {
  try {
    if (typeof win.webContents.focus === 'function') {
      win.webContents.focus = function () { suppression.webContentsFocus++; };
    }
  } catch (error) {
    throw new Error(`could not suppress webContents.focus before page load: ${String(error)}`);
  }
});

const inside = file => file === root || file.startsWith(root + path.sep);
const originalLoad = Module._load;
class HiddenTray {
  constructor() { suppression.trayCreates++; }
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
        return new Proxy(api, {
          get(apiTarget, method) {
            if (['register', 'registerAll', 'unregister', 'unregisterAll'].includes(String(method))) {
              return () => { suppression.globalShortcut++; return false; };
            }
            return Reflect.get(apiTarget, method, apiTarget);
          },
        });
      }
      return Reflect.get(target, key, target);
    },
  });
};

require(path.join(root, 'dist', 'native-camp-living-0100-luna.cjs'));
