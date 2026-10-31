'use strict';

// Install all visibility and focus guards before DesktopShell is imported.
// This runner is fail-closed and cannot open/show/focus any native window.
const path=require('node:path');
const Module=require('node:module');
const electron=require('electron');
const root=process.cwd();
const expectedRunner=path.join(root,'dist','native-feedback-0121-luna.cjs');
if(process.env.PIXELSTREET_FEEDBACK0121_GO!=='1')throw Error('Refusing to run before root GO: set PIXELSTREET_FEEDBACK0121_GO=1 only after the final 0.12.1 bundle and manifest are frozen.');
if(path.resolve(process.env.PIXELSTREET_FEEDBACK0121_RUNNER||'')!==expectedRunner)throw Error('Set PIXELSTREET_FEEDBACK0121_RUNNER to dist/native-feedback-0121-luna.cjs.');
if(!process.env.PIXELSTREET_FEEDBACK0121_MANIFEST)throw Error('Root must provide PIXELSTREET_FEEDBACK0121_MANIFEST for exact final source/runtime comparison.');

const suppression={activationPolicy:'not-applicable',appActivateEvents:0,appFocus:0,show:0,showInactive:0,windowFocus:0,webContentsFocus:0,moveTop:0,windowRestore:0,dockShow:0,dockActivate:0,globalShortcut:0,trayConstructorIntercepts:0,dialogCalls:0};
globalThis.__pixelStreetFeedback0121Suppression=suppression;
function replace(target,key,value){const d=Object.getOwnPropertyDescriptor(target,key);if(d&&!d.configurable&&!d.writable)throw Error('cannot suppress Electron '+String(key));Object.defineProperty(target,key,{configurable:true,enumerable:d?.enumerable??true,writable:true,value});}
if(process.platform==='darwin'){
  electron.app.setActivationPolicy('prohibited');suppression.activationPolicy='prohibited';
  try{electron.app.dock?.hide();suppression.dockHidden=true;}catch{}
}
replace(electron.app,'focus',()=>{suppression.appFocus++;});
const originalEmit=electron.app.emit;
replace(electron.app,'emit',function(event,...args){if(event==='activate'){suppression.appActivateEvents++;return false;}return originalEmit.call(this,event,...args);});
try{const dock=electron.app.dock;if(dock)for(const[method,key]of[['show','dockShow'],['activate','dockActivate']])if(typeof dock[method]==='function')replace(dock,method,()=>{suppression[key]++;});}catch(error){throw Error('could not suppress Dock activation: '+String(error));}
for(const[method,key]of[['show','show'],['showInactive','showInactive'],['focus','windowFocus'],['moveTop','moveTop'],['restore','windowRestore']])if(typeof electron.BrowserWindow.prototype[method]==='function')replace(electron.BrowserWindow.prototype,method,function(){suppression[key]++;});
if(!electron.dialog||typeof electron.dialog.showOpenDialog!=='function')throw Error('Electron dialog API unavailable');
replace(electron.dialog,'showOpenDialog',async()=>{suppression.dialogCalls++;throw Error('file chooser prohibited in hidden-native acceptance');});
electron.app.on('browser-window-created',(_event,win)=>{try{if(typeof win.webContents.focus==='function')win.webContents.focus=function(){suppression.webContentsFocus++;};}catch(error){throw Error('could not suppress webContents.focus: '+String(error));}});

// Controlled acknowledgement delay and stale-envelope mutation are explicit
// software test instruments. They wrap the real Shell handler; they never
// replace or mock GameWorker behavior.
const control={
  delayMatch:null,delayPromise:null,resolveDelayReady:null,releaseAck:null,delayEvents:[],
  staleActionType:null,stalePromise:null,resolveStaleSeen:null,staleEvents:[],
  handlerFailures:[],ipcRequests:[],
  armDelay(match){this.delayMatch=match;this.releaseAck=null;this.delayPromise=new Promise(resolve=>{this.resolveDelayReady=resolve;});},
  waitDelayed(){return this.delayPromise;},
  release(){const release=this.releaseAck;this.releaseAck=null;if(release)release();},
  armStaleSequence(actionType){this.staleActionType=actionType;this.stalePromise=new Promise(resolve=>{this.resolveStaleSeen=resolve;});},
  waitStaleRewrite(){return this.stalePromise;},
};
globalThis.__pixelStreetFeedback0121Control=control;
const originalHandle=electron.ipcMain.handle.bind(electron.ipcMain);
replace(electron.ipcMain,'handle',function(channel,listener){
  if(channel!=='street:command')return originalHandle(channel,listener);
  return originalHandle(channel,async(event,raw)=>{
    let value=raw;
    const action=value?.envelope?.action;
    control.ipcRequests.push({commandType:value?.type,actionType:action?.type,sequence:value?.envelope?.sequence,at:Date.now()});
    if(control.staleActionType&&action?.type===control.staleActionType){
      const original=value.envelope.sequence;
      value={...value,envelope:{...value.envelope,sequence:Math.max(1,original-1)}};
      const item={commandType:value.type,actionType:action.type,originalSequence:original,submittedSequence:value.envelope.sequence,mutation:'stale sequence only'};
      control.staleEvents.push(item);control.staleActionType=null;control.resolveStaleSeen?.(item);control.resolveStaleSeen=null;
    }
    try{
      const result=await listener(event,value);
      if(control.delayMatch&&matches(value,control.delayMatch)){
        const item={commandType:value.type,actionType:action?.type,detail:action,phase:'actual Shell handler completed; IPC acknowledgement held'};
        control.delayEvents.push(item);control.delayMatch=null;control.resolveDelayReady?.(item);control.resolveDelayReady=null;
        await new Promise(resolve=>{control.releaseAck=resolve;});
      }
      return result;
    }catch(error){control.handlerFailures.push({commandType:value?.type,actionType:action?.type,error:String(error)});throw error;}
  });
});

const inside=file=>file===root||file.startsWith(root+path.sep);
const originalLoad=Module._load;
class HiddenTray{constructor(){suppression.trayConstructorIntercepts++;}setToolTip(){}setContextMenu(){}on(){return this;}destroy(){}}
Module._load=function(request,parent,isMain){
  const loaded=originalLoad.call(this,request,parent,isMain);
  if(request!=='electron'||!parent?.filename||!inside(path.resolve(parent.filename)))return loaded;
  return new Proxy(loaded,{get(target,key){
    if(key==='Tray')return HiddenTray;
    if(key==='globalShortcut'){
      const api=Reflect.get(target,key,target);
      return new Proxy(api,{get(apiTarget,method){if(['register','registerAll','unregister','unregisterAll'].includes(String(method)))return()=>{suppression.globalShortcut++;return false;};return Reflect.get(apiTarget,method,apiTarget);}});
    }
    return Reflect.get(target,key,target);
  }});
};

require(expectedRunner);

function matches(value,match){
  if(!match||value?.type!==match.commandType)return false;
  const action=value?.envelope?.action;
  if(!action||action.type!==match.actionType)return false;
  return Object.entries(match).every(([key,want])=>['commandType','actionType'].includes(key)||action[key]===want);
}
