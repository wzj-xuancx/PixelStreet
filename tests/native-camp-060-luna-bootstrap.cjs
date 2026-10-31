'use strict';

const path = require('node:path');
const Module = require('node:module');
const electron = require('electron');
const suppression = {
  appFocus: 0, show: 0, showInactive: 0, windowFocus: 0,
  webContentsFocus: 0, moveTop: 0, globalShortcut: 0, trayCreates: 0,
};
globalThis.__pixelStreetCamp060Suppression = suppression;

if (process.platform === 'darwin') {
  try { electron.app.setActivationPolicy('prohibited'); } catch {}
  try { electron.app.dock?.hide(); } catch {}
}

const root = path.resolve(__dirname, '..');
const inside = (candidate) => candidate === root || candidate.startsWith(root + path.sep);
const originalLoad = Module._load;
class HiddenTray {
  constructor() { suppression.trayCreates++; }
  setToolTip() {}
  setContextMenu() {}
  on() { return this; }
  destroy() {}
}
Module._load = function(request, parent, isMain) {
  const loaded = originalLoad.call(this, request, parent, isMain);
  if (request !== 'electron' || !parent?.filename || !inside(path.resolve(parent.filename))) return loaded;
  return new Proxy(loaded, {
    get(target, key) {
      if (key === 'Tray') return HiddenTray;
      if (key === 'globalShortcut') {
        const shortcuts = Reflect.get(target, key, target);
        return new Proxy(shortcuts, { get(shortcutTarget, method) {
          if (['register', 'registerAll', 'unregister', 'unregisterAll'].includes(String(method))) {
            return () => { suppression.globalShortcut++; return false; };
          }
          return Reflect.get(shortcutTarget, method, shortcutTarget);
        }});
      }
      return Reflect.get(target, key, target);
    },
  });
};

require(path.resolve(__dirname, '../work/camp-060/runtime-dist/native-camp-060-luna.cjs'));
