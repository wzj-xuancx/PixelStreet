'use strict';

// Install every hidden/focus guard before importing the actual DesktopShell.
// This bootstrap is fail-closed and never reveals or activates a native window.
const path=require('node:path');
const Module=require('node:module');
const electron=require('electron');
const root=process.cwd();
const expected=path.join(root,'dist','native-compact-0122-luna.cjs');
if(process.env.PIXELSTREET_COMPACT0122_GO!=='1')throw Error('Refusing hidden-native launch before the root final-manifest GO.');
if(path.resolve(process.env.PIXELSTREET_COMPACT0122_RUNNER||'')!==expected)throw Error('PIXELSTREET_COMPACT0122_RUNNER must point to '+expected+' so preload and worker paths resolve from dist.');
if(!process.env.PIXELSTREET_COMPACT0122_MANIFEST)throw Error('Root must provide PIXELSTREET_COMPACT0122_MANIFEST for exact final source/runtime comparison.');
if(process.env.PIXELSTREET_COMPACT0122_FIXTURE!=='rich')throw Error('This Luna run accepts only the rich fixture for camp/village/bonds; shop/alchemy are covered by the other independent Luna run.');

const suppression={activationPolicy:'not-applicable',appActivateEvents:0,appFocus:0,show:0,showInactive:0,windowFocus:0,webContentsFocus:0,moveTop:0,restore:0,dockShow:0,dockActivate:0,globalShortcut:0,trayConstructorIntercepts:0,dialogCalls:0};
globalThis.__pixelStreetCompact0122Suppression=suppression;
function replace(target,key,value){const d=Object.getOwnPropertyDescriptor(target,key);if(d&&!d.configurable&&!d.writable)throw Error('cannot intercept Electron '+String(key));Object.defineProperty(target,key,{configurable:true,enumerable:d?.enumerable??true,writable:true,value});}
if(process.platform==='darwin'){
  electron.app.setActivationPolicy('prohibited');suppression.activationPolicy='prohibited';
  try{electron.app.dock?.hide();}catch{}
}
replace(electron.app,'focus',()=>{suppression.appFocus++;return false;});
const originalEmit=electron.app.emit;
replace(electron.app,'emit',function(event,...args){if(event==='activate'){suppression.appActivateEvents++;return false;}return originalEmit.call(this,event,...args);});
try{const dock=electron.app.dock;if(dock)for(const[method,key]of[['show','dockShow'],['activate','dockActivate']])if(typeof dock[method]==='function')replace(dock,method,()=>{suppression[key]++;return false;});}catch(error){throw Error('could not suppress Dock activation: '+String(error));}
for(const[method,key]of[['show','show'],['showInactive','showInactive'],['focus','windowFocus'],['moveTop','moveTop'],['restore','restore']])if(typeof electron.BrowserWindow.prototype[method]==='function')replace(electron.BrowserWindow.prototype,method,function(){suppression[key]++;return false;});
if(!electron.dialog||typeof electron.dialog.showOpenDialog!=='function')throw Error('Electron file-dialog API unavailable');
replace(electron.dialog,'showOpenDialog',async()=>{suppression.dialogCalls++;throw Error('file dialogs are prohibited during hidden-native acceptance');});
if(electron.Menu&&typeof electron.Menu.setApplicationMenu==='function')replace(electron.Menu,'setApplicationMenu',()=>{});
electron.app.on('browser-window-created',(_event,win)=>{try{if(typeof win.webContents.focus==='function')win.webContents.focus=function(){suppression.webContentsFocus++;return false;};}catch(error){throw Error('could not intercept webContents.focus: '+String(error));}});
const inside=file=>file===root||file.startsWith(root+path.sep);
const originalLoad=Module._load;
class HiddenTray{constructor(){suppression.trayConstructorIntercepts++;}setToolTip(){}setContextMenu(){}on(){return this;}destroy(){}}
Module._load=function(request,parent,isMain){const loaded=originalLoad.call(this,request,parent,isMain);if(request!=='electron'||!parent?.filename||!inside(path.resolve(parent.filename)))return loaded;return new Proxy(loaded,{get(target,key){if(key==='Tray')return HiddenTray;if(key==='globalShortcut'){const api=Reflect.get(target,key,target);return new Proxy(api,{get(apiTarget,method){if(['register','registerAll','unregister','unregisterAll'].includes(String(method)))return()=>{suppression.globalShortcut++;return false;};return Reflect.get(apiTarget,method,apiTarget);}});}return Reflect.get(target,key,target);}});};
require(expected);
