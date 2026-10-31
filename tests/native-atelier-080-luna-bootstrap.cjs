'use strict';
const path=require('node:path');
const Module=require('node:module');
const electron=require('electron');
const root=process.cwd();
const suppression={appFocus:0,show:0,showInactive:0,windowFocus:0,webContentsFocus:0,moveTop:0,globalShortcut:0,trayCreates:0};
globalThis.__pixelStreetAtelier080Suppression=suppression;
if(process.platform==='darwin'){
  try{electron.app.setActivationPolicy('prohibited');}catch{}
  try{electron.app.dock?.hide();}catch{}
}
const replace=(target,key,value)=>{
  const descriptor=Object.getOwnPropertyDescriptor(target,key);
  if(descriptor&&!descriptor.configurable&&!descriptor.writable)throw new Error(`cannot suppress ${key}`);
  Object.defineProperty(target,key,{configurable:true,enumerable:descriptor?.enumerable??true,writable:true,value});
};
replace(electron.app,'focus',()=>{suppression.appFocus++;});
for(const [method,key] of [['show','show'],['showInactive','showInactive'],['focus','windowFocus'],['moveTop','moveTop']]){
  const original=electron.BrowserWindow.prototype[method];
  if(typeof original==='function')replace(electron.BrowserWindow.prototype,method,function(){suppression[key]++;});
}
electron.app.on('browser-window-created',(_event,win)=>{
  const original=win.webContents.focus;
  if(typeof original==='function')try{win.webContents.focus=function(){suppression.webContentsFocus++;};}catch{}
});
const inside=file=>file===root||file.startsWith(root+path.sep);
const originalLoad=Module._load;
class HiddenTray{constructor(){suppression.trayCreates++;}setToolTip(){}setContextMenu(){}on(){return this;}destroy(){}}
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
require(path.join(root,'dist','native-atelier-080-luna.cjs'));
