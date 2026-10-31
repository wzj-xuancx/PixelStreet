'use strict';
// Guards install before importing shell; no native reveal or activation is allowed.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),electron=require('electron');
const folder=process.env.PIXELSTREET_TEST_DATA||'';
if(process.env.PIXELSTREET_PORTALS0181_GO!=='1'||!/^\/private\/tmp\/pixelstreet-portals-0181-[^/]+$/.test(folder)||fs.realpathSync(folder)!==folder||fs.lstatSync(folder).isSymbolicLink()||fs.readFileSync(path.join(folder,'.pixelstreet-isolated-profile.json'),'utf8')!==JSON.stringify({product:'PixelStreet',kind:'isolated-playtest',version:1})+'\n')throw Error('Refusing unmarked field fixture');
globalThis.__portals0181Errors=[];process.on('uncaughtExceptionMonitor',error=>{globalThis.__portals0181Errors.push(String(error?.stack||error));console.error('Original uncaught fixture error:',error?.stack||error);});process.on('unhandledRejection',error=>{globalThis.__portals0181Errors.push(String(error?.stack||error));console.error('Original unhandled fixture rejection:',error?.stack||error);});
const guards={show:0,showInactive:0,focus:0,moveTop:0,restore:0,appFocus:0,webContentsFocus:0};globalThis.__portals0181Guards=guards;
const replace=(o,k,v)=>Object.defineProperty(o,k,{configurable:true,writable:true,value:v});
if(process.platform==='darwin'){electron.app.setActivationPolicy('prohibited');electron.app.dock?.hide();for(const k of ['show','activate'])if(electron.app.dock?.[k])replace(electron.app.dock,k,()=>{throw Error('Dock activation denied');});}
if(electron.app.activate)replace(electron.app,'activate',()=>{throw Error('App activation denied');});
replace(electron.app,'focus',()=>{guards.appFocus++;return false;});const emit=electron.app.emit;replace(electron.app,'emit',function(event,...args){if(event==='activate')throw Error('App activation denied');return emit.call(this,event,...args);});
const visible=electron.BrowserWindow.prototype.isVisible,focused=electron.BrowserWindow.prototype.isFocused;
globalThis.__portals0181Native=w=>({visible:visible.call(w),focused:focused.call(w)});
const model=new WeakSet();globalThis.__portals0181Model=model;
replace(electron.BrowserWindow.prototype,'isVisible',function(){return !this.isDestroyed();});
replace(electron.BrowserWindow.prototype,'isFocused',function(){return model.has(this)&&!this.isDestroyed();});
for(const k of ['show','showInactive','focus','moveTop','restore'])replace(electron.BrowserWindow.prototype,k,()=>{guards[k]++;return false;});
electron.app.on('browser-window-created',(_,w)=>{replace(w.webContents,'focus',()=>{guards.webContentsFocus++;return false;});});
for(const k of ['showOpenDialog','showSaveDialog','showMessageBox','showErrorBox'])replace(electron.dialog,k,()=>{throw Error('Native dialog denied');});replace(electron.Menu,'setApplicationMenu',()=>{});
const load=Module._load;const NativeWorker=load('node:worker_threads',module,false).Worker;const fixtureClock=Date.now();globalThis.__portals0181Clock=fixtureClock;class FieldClockWorker extends NativeWorker{constructor(file,options){if(String(file).endsWith('/game-worker.cjs'))super("const {workerData}=require('node:worker_threads');Date.now=()=>workerData.fixtureClock;require(workerData.fixtureEntry);",{...options,eval:true,workerData:{...options?.workerData,fixtureClock:globalThis.__portals0181StartAt??fixtureClock,fixtureEntry:file}});else super(file,options);}}class HiddenTray{setToolTip(){}setContextMenu(){}on(){return this;}destroy(){}}
Module._load=function(request,parent,isMain){const value=load.call(this,request,parent,isMain);if(request==='node:worker_threads')return {...value,Worker:FieldClockWorker};if(request!=='electron')return value;return new Proxy(value,{get(o,k){if(k==='Tray')return HiddenTray;if(k==='BrowserWindow')return new Proxy(o.BrowserWindow,{construct(C,args){if(args[0]?.show!==false)throw Error('Every fixture window must be hidden');return Reflect.construct(C,args);}});if(k==='globalShortcut')throw Error('Global hooks denied');return Reflect.get(o,k,o);}});};
electron.app.setPath('userData',path.join(folder,'user-data'));electron.app.setPath('sessionData',path.join(folder,'session'));
setTimeout(()=>{console.error('Field fixture timeout');electron.app.exit(2);},120000).unref();
require(path.join(process.cwd(),'dist/native-portals-0181.cjs'));
