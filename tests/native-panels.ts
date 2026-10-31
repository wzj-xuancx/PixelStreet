import {app,globalShortcut} from 'electron';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {startDesktop} from '../apps/desktop/bootstrap';
const evidence=path.resolve(__dirname,'../docs/evidence/action-loop/panels');fs.mkdirSync(evidence,{recursive:true});
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'pixelstreet-panels-'));
const checks:{name:string;detail?:unknown}[]=[];const events:unknown[]=[];const pause=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const until=async(fn:()=>Promise<boolean>,label:string)=>{for(let n=0;n<150;n++){if(await fn())return;await pause(50);}throw Error(label);};
// No focus activation in this isolated native lifecycle test; physical focus is NOT proved.
app.focus=()=>{};
void(async()=>{
 const shell=await startDesktop(folder);const height=shell.overlay.getBounds().height;
 const ready=async()=>{await until(async()=>!!shell.popupWindow?.isVisible(),'popup ready');};
 const pj=(s:string)=>shell.popupWindow!.webContents.executeJavaScript(s);
 shell.openSettings();await ready();const popup=shell.popupWindow!,generation=shell.popup!.generation;
 popup.focus=()=>{};popup.webContents.focus=()=>{};
 for(const event of ['resize','show','hide','focus','blur'])popup.on(event as any,()=>events.push({at:Date.now(),event,bounds:popup.getBounds(),generation:shell.popup?.generation}));
 assert.equal(popup.getParentWindow(),null);assert.equal(popup.isAlwaysOnTop(),false);assert.equal(shell.overlay.isAlwaysOnTop(),true);
 checks.push({name:'normal independent panel does not inherit camp topmost'});
 await pj("document.getElementById('backupDetails').open=true;document.getElementById('backupText').value='保留备份草稿';document.querySelector('.popover-content').scrollTop=80;window.panelIdentity=document.getElementById('backupText')");
 const scroll=await pj("document.querySelector('.popover-content').scrollTop");
 for(let i=0;i<12;i++){
   shell.suspendPopup();assert.equal(shell.popup!.suspended,true);assert.equal(popup.isVisible(),false);
   shell.enter();await ready();assert.equal(shell.popup!.generation,generation);assert.equal(shell.popup!.suspended,false);assert.equal(shell.popupWindow,popup);
   assert.equal(await pj("document.getElementById('backupText')===window.panelIdentity&&document.getElementById('backupText').value==='保留备份草稿'"),true);
   assert.equal(await pj("document.querySelector('.popover-content').scrollTop"),scroll);assert.equal(shell.keyboard,false);assert.equal(popup.isFocusable(),false);assert.equal(shell.overlay.getBounds().height,height);
 }
 checks.push({name:'12 suspend/road-resume cycles preserve native window, DOM, draft, scroll, generation and camp height'});
 app.emit('did-resign-active');assert.equal(shell.popup!.suspended,true);assert.equal(popup.isVisible(),false);checks.push({name:'simulated app resign event parks panel',detail:'Event fixture only, not real OS click evidence'});
 assert.equal(await shell.overlay.webContents.executeJavaScript(`window.street.command({type:'resume-popup',generation:${generation+1}}).then(()=>false,()=>true)`),true);
 assert.equal(await pj(`window.street.saveSettings(${JSON.stringify(shell.store.value)},${generation}).then(()=>false,()=>true)`),true);
 shell.command({type:'resume-popup',generation});await ready();
 shell.store.save({...shell.store.value,alwaysOnTop:false});shell.settingsChanged();assert.equal(popup.isAlwaysOnTop(),false);assert.equal(popup.getParentWindow(),null);checks.push({name:'camp topmost preference never makes large panels topmost; stale resume rejected'});
 shell.openSettings();assert.equal(shell.popup,null);assert.equal(popup.isVisible(),false);checks.push({name:'same settings button closes panel'});
 shell.openPopup('dialogue',{x:600,y:40,width:40,height:50});await ready();await pj("document.getElementById('draft').value='未发送中文草稿';window.draftIdentity=document.getElementById('draft')");const dg=shell.popup!.generation;
 shell.suspendPopup();shell.enter();await ready();assert.equal(shell.popup!.generation,dg);assert.equal(await pj("document.getElementById('draft')===window.draftIdentity&&document.getElementById('draft').value==='未发送中文草稿'"),true);assert.equal(shell.keyboard,false);checks.push({name:'dialogue resumes without clearing draft or automatically focusing keyboard'});
 fs.writeFileSync(path.join(evidence,'resumed-dialogue.png'),(await popup.webContents.capturePage()).toPNG());
 shell.hide();assert.equal(shell.popup,null);assert.equal(popup.isVisible(),false);assert.equal(shell.recovery.isVisible(),true);shell.restore();assert.equal(shell.overlay.getBounds().height,height);checks.push({name:'explicit hide clears panel and arrow restores unchanged camp height'});
 shell.openSettings();const late=shell.popup!.generation;shell.suspendPopup();shell.command({type:'popup-ready',generation:late});await pause(150);assert.equal(popup.isVisible(),false);checks.push({name:'late paint-ready cannot resurrect suspended panel'});
 assert.equal(globalShortcut.isRegistered('CommandOrControl+Alt+H'),false);assert.equal(globalShortcut.isRegistered('CommandOrControl+Alt+G'),false);checks.push({name:'no global shortcuts'});
 const result={at:new Date().toISOString(),status:'PASS',method:'Isolated real Electron BrowserWindows; lifecycle/native-property assertions and DOM intents, app focus suppressed. OS z-order/physical pointer/IME/composited flicker not proved.',folder,checks,events,manual:['Click other app while panel was opened inactive; verify ordinary z-order','Physical road click raises same panel without stealing work input','Full Chinese IME candidate confirmation','Continuous compositor flicker and cursor hand']};fs.writeFileSync(path.join(evidence,'native-panels.json'),JSON.stringify(result,null,2));console.log(`PASS ${checks.length} panel groups`);app.quit();
})().catch(e=>{fs.writeFileSync(path.join(evidence,'failure.json'),JSON.stringify({at:new Date().toISOString(),error:String(e),stack:e.stack,checks,events},null,2));console.error(e);app.exit(1);});
