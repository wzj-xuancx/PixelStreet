'use strict';

// This bootstrap runs before the bundled app imports or constructs DesktopShell.
// It keeps every Electron window hidden and prevents activation at the native layer.
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
globalThis.__pixelStreetAlchemy0110Suppression = suppression;
const dialogState = {queue: [], calls: [], previews: [], pending: []};
dialogState.resolveNext = () => {
  const item = dialogState.pending.shift();
  if (!item) throw new Error('no deferred mock file chooser is pending');
  const spec = item.spec;
  item.resolve({canceled: !!spec.canceled, filePaths: spec.canceled ? [] : [spec.path]});
};
globalThis.__pixelStreetAlchemy0110Dialog = dialogState;

if (process.platform === 'darwin') {
  try {
    electron.app.setActivationPolicy('prohibited');
    suppression.activationPolicy = 'prohibited';
  } catch (error) {
    suppression.activationPolicy = `failed: ${String(error)}`;
    throw error;
  }
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
  ['show', 'show'], ['showInactive', 'showInactive'], ['focus', 'windowFocus'], ['moveTop', 'moveTop'],
  ['restore', 'windowRestore'],
]) {
  if (typeof electron.BrowserWindow.prototype[method] === 'function') {
    replace(electron.BrowserWindow.prototype, method, function () { suppression[key]++; });
  }
}

// The real native chooser is never called. Every result comes from a harness
// fixture under this run's marked /private/tmp root; an empty queue fails closed.
const nativeDialog = electron.dialog;
if (!nativeDialog || typeof nativeDialog.showOpenDialog !== 'function') throw new Error('Electron dialog API unavailable');
replace(nativeDialog, 'showOpenDialog', async (...args) => {
  suppression.dialogCalls++;
  const spec = dialogState.queue.shift();
  const call = {at: new Date().toISOString(), title: args[1]?.title ?? args[0]?.title ?? '', spec: spec ? {...spec} : null};
  dialogState.calls.push(call);
  if (!spec) throw new Error('mock file picker has no queued private fixture; real file chooser is prohibited');
  if (spec.deferred) return await new Promise((resolve) => dialogState.pending.push({spec, resolve}));
  return {canceled: !!spec.canceled, filePaths: spec.canceled ? [] : [spec.path]};
});

// Preserve the actual ipcMain handlers while observing import preview tokens
// only inside this isolated test process. This is test instrumentation, not a
// replacement for renderer/preload/main IPC execution.
const originalHandle = electron.ipcMain.handle;
replace(electron.ipcMain, 'handle', function (channel, listener) {
  if (channel !== 'street:preview-game-import') return originalHandle.call(this, channel, listener);
  return originalHandle.call(this, channel, async (...args) => {
    const result = await listener(...args);
    if (result) dialogState.previews.push({token: result.token, fileName: result.fileName, generation: args[1]});
    return result;
  });
});

electron.app.on('browser-window-created', (_event, win) => {
  try {
    const original = win.webContents.focus;
    if (typeof original === 'function') {
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

const runner = process.env.PIXELSTREET_ALCHEMY0110_RUNNER;
const expectedRunner = path.join(root, 'dist', 'native-alchemy-0110-luna.cjs');
if (!runner || path.resolve(runner) !== expectedRunner) {
  throw new Error('set PIXELSTREET_ALCHEMY0110_RUNNER to the dedicated dist/native-alchemy-0110-luna.cjs test harness');
}
require(expectedRunner);
