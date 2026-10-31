'use strict';
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),electron=require('electron');
const folder=process.env.PIXELSTREET_TEST_DATA||'';
if(process.env.PIXELSTREET_INVENTORY0140_GO!=='1'||!/^\/private\/tmp\/pixelstreet-inventory-0140-[^/]+$/.test(folder)||fs.realpathSync(folder)!==folder||fs.lstatSync(folder).isSymbolicLink()||fs.readFileSync(path.join(folder,'.pixelstreet-isolated-profile.json'),'utf8')!==JSON.stringify({product:'PixelStreet',kind:'isolated-inventory-author',version:1})+'\n')throw Error('Refusing native execution without GO and exact direct /private/tmp marker.');
const guards={show:0,showInactive:0,focus:0,moveTop:0,restore:0,appFocus:0,activate:0,webContentsFocus:0};globalThis.__inventoryGuards=guards;
const replace=(o,k,v)=>{const d=Object.getOwnPropertyDescriptor(o,k);if(d&&!d.configurable&&!d.writable)throw Error('Cannot guard '+k);Object.defineProperty(o,k,{configurable:true,writable:true,value:v});};
if(process.platform==='darwin'){electron.app.setActivationPolicy('prohibited');electron.app.dock?.hide();for(const k of ['show','activate'])if(electron.app.dock?.[k])replace(electron.app.dock,k,()=>{throw Error('Dock activation denied');});}
replace(electron.app,'focus',()=>{guards.appFocus++;return false;});const emit=electron.app.emit;replace(electron.app,'emit',function(e,...args){if(e==='activate'){guards.activate++;return false;}return emit.call(this,e,...args);});
for(const k of ['show','showInactive','focus','moveTop','restore'])replace(electron.BrowserWindow.prototype,k,()=>{guards[k]++;return false;});
electron.app.on('browser-window-created',(_,w)=>{replace(w.webContents,'focus',()=>{guards.webContentsFocus++;return false;});w.webContents.setBackgroundThrottling(false);});
for(const k of ['showOpenDialog','showSaveDialog','showMessageBox','showErrorBox'])replace(electron.dialog,k,()=>{throw Error('Native dialog denied');});replace(electron.Menu,'setApplicationMenu',()=>{});
const load=Module._load;class HiddenTray{setToolTip(){}setContextMenu(){}on(){return this;}destroy(){}}
Module._load=function(request,parent,isMain){const value=load.call(this,request,parent,isMain);if(request!=='electron')return value;return new Proxy(value,{get(o,k){if(k==='Tray')return HiddenTray;if(k==='BrowserWindow')return new Proxy(o.BrowserWindow,{construct(C,args){if(args[0]?.show!==false)throw Error('Hidden-window invariant');return Reflect.construct(C,args);}});if(k==='globalShortcut')throw Error('Global shortcut denied');return Reflect.get(o,k,o);}});};
electron.app.setPath('userData',path.join(folder,'user-data'));electron.app.setPath('sessionData',path.join(folder,'session'));
setTimeout(()=>{console.error('Native inventory author check timed out');electron.app.exit(2);},45000).unref();
require(path.join(process.cwd(),process.env.PIXELSTREET_INVENTORY0140_PROBE==='contrast'?'dist/native-inventory-0140-contrast.cjs':'dist/native-inventory-0140-author.cjs'));
