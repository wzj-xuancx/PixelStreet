'use strict';

const path = require('node:path');
const Module = require('node:module');
const electron = require('electron');
const suppression = {appFocus:0,show:0,showInactive:0,windowFocus:0,webContentsFocus:0,moveTop:0,globalShortcut:0,trayCreates:0};
globalThis.__pixelStreetBonds070Suppression = suppression;
if(process.platform==='darwin'){
  try{electron.app.setActivationPolicy('prohibited');}catch{}
  try{electron.app.dock?.hide();}catch{}
}
const root=path.resolve(__dirname,'..');
const runtime=process.argv.find(a=>a.startsWith('--runtime='))?.split('=')[1]??'candidate';
if(!['candidate','dist'].includes(runtime))throw new Error('runtime must be candidate or dist');
const inside=(candidate)=>candidate===root||candidate.startsWith(root+path.sep);
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
require(path.join(root,runtime==='dist'?'dist':'work/bonds-070/candidate','native-bonds-070-luna.cjs'));
