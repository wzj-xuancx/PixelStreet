'use strict';
// Guards install before importing shell; no native reveal or activation is allowed.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),electron=require('electron');
const folder=process.env.PIXELSTREET_TEST_DATA||'';
if(process.env.PIXELSTREET_FIELD0171_GO!=='1'||!/^\/private\/tmp\/pixelstreet-field-0171-[^/]+$/.test(folder)||fs.realpathSync(folder)!==folder||fs.lstatSync(folder).isSymbolicLink()||fs.readFileSync(path.join(folder,'.pixelstreet-isolated-profile.json'),'utf8')!==JSON.stringify({product:'PixelStreet',kind:'isolated-playtest',version:1})+'\n')throw Error('Refusing unmarked field fixture');
const guards={show:0,showInactive:0,focus:0,moveTop:0,restore:0,appFocus:0,webContentsFocus:0};globalThis.__field0171Guards=guards;
const replace=(o,k,v)=>Object.defineProperty(o,k,{configurable:true,writable:true,value:v});
if(process.platform==='darwin'){electron.app.setActivationPolicy('prohibited');electron.app.dock?.hide();for(const k of ['show','activate'])if(electron.app.dock?.[k])replace(electron.app.dock,k,()=>{throw Error('Dock activation denied');});}
replace(electron.app,'focus',()=>{guards.appFocus++;return false;});const emit=electron.app.emit;replace(electron.app,'emit',function(event,...args){if(event==='activate')throw Error('App activation denied');return emit.call(this,event,...args);});
const visible=electron.BrowserWindow.prototype.isVisible,focused=electron.BrowserWindow.prototype.isFocused;
globalThis.__field0171Native=w=>({visible:visible.call(w),focused:focused.call(w)});
const model=new WeakSet();globalThis.__field0171Model=model;
replace(electron.BrowserWindow.prototype,'isVisible',function(){return !this.isDestroyed();});
replace(electron.BrowserWindow.prototype,'isFocused',function(){return model.has(this)&&!this.isDestroyed();});
for(const k of ['show','showInactive','focus','moveTop','restore'])replace(electron.BrowserWindow.prototype,k,()=>{guards[k]++;return false;});
electron.app.on('browser-window-created',(_,w)=>{replace(w.webContents,'focus',()=>{guards.webContentsFocus++;return false;});});
for(const k of ['showOpenDialog','showSaveDialog','showMessageBox','showErrorBox'])replace(electron.dialog,k,()=>{throw Error('Native dialog denied');});replace(electron.Menu,'setApplicationMenu',()=>{});
const load=Module._load;class HiddenTray{setToolTip(){}setContextMenu(){}on(){return this;}destroy(){}}
Module._load=function(request,parent,isMain){const value=load.call(this,request,parent,isMain);if(request!=='electron')return value;return new Proxy(value,{get(o,k){if(k==='Tray')return HiddenTray;if(k==='BrowserWindow')return new Proxy(o.BrowserWindow,{construct(C,args){if(args[0]?.show!==false)throw Error('Every fixture window must be hidden');return Reflect.construct(C,args);}});if(k==='globalShortcut')throw Error('Global hooks denied');return Reflect.get(o,k,o);}});};
electron.app.setPath('userData',path.join(folder,'user-data'));electron.app.setPath('sessionData',path.join(folder,'session'));
setTimeout(()=>{console.error('Field fixture timeout');electron.app.exit(2);},60000).unref();
require(path.join(process.cwd(),'dist/native-field-entry-0171.cjs'));
