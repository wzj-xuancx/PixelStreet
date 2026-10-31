import {app} from 'electron';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
import {startDesktop} from '../apps/desktop/bootstrap';
const root=path.resolve(__dirname,'..'),out=path.join(root,'docs/evidence/solo-loop');fs.mkdirSync(out,{recursive:true});
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'pixelstreet-solo-native-'));app.focus=()=>{};
const checks:{name:string;detail?:unknown}[]=[],errors:string[]=[];const pause=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function until(fn:()=>Promise<boolean>,label:string){const end=Date.now()+15000;while(Date.now()<end){if(await fn())return;await pause(50);}throw Error('timeout '+label);}
void(async()=>{
 app.on('web-contents-created',(_e,w)=>w.on('console-message',e=>{if(e.level==='error')errors.push(e.message);}));
 const shell=await startDesktop(folder,true),js=(s:string)=>shell.overlay.webContents.executeJavaScript(s),pj=(s:string)=>shell.popupWindow!.webContents.executeJavaScript(s);
 await until(async()=>await js("document.body.dataset.atlas==='verified'"),'atlas');const bounds=shell.overlay.getBounds();
 assert.equal(await js("window.street.command({type:'shop-panel',anchor:{x:400,y:60,width:30,height:40}}).then(()=>false,()=>true)"),true);
 await js("window.street.command({type:'visit',shop:'shop-bakery'})");
 const point=await js("({x:Number(document.body.dataset.worldX)+124*Number(document.body.dataset.worldScale),y:Number(document.body.dataset.worldY)-20*Number(document.body.dataset.worldScale)})");
 for(const type of ['mouseMove','mouseDown','mouseUp']as const)shell.overlay.webContents.sendInputEvent({type,x:Math.round(point.x),y:Math.round(point.y),button:'left',clickCount:1});
 await until(async()=>shell.popup?.kind==='shop'&&!!shell.popupWindow?.isVisible(),'keeper popup');shell.popupWindow!.focus=()=>{};shell.popupWindow!.webContents.focus=()=>{};
 await pj("document.getElementById('applyJob').click()");await until(async()=>shell.game.state.profile?.job==='apprentice','apprenticeship');const p=structuredClone(shell.game.state.profile!);
 const gen=shell.popup!.generation;const repeat={type:'game',generation:gen,envelope:{sequence:p.sequence,requestId:p.receipt!.requestId,action:{type:'apply-job'}}};await pj(`window.street.command(${JSON.stringify(repeat)})`);assert.equal(shell.game.state.profile!.bag.flour,4);checks.push({name:'F1 native mouse selects keeper; UI applies job; duplicate request grants flour once'});
 await pj("document.getElementById('trialCraft').click()");await until(async()=>!!shell.game.state.profile?.queue,'queue');shell.closePopup();await pause(6500);assert.equal(shell.game.state.profile!.bag.ration,1);checks.push({name:'F1 actual 6-second worker craft continues after closing attached panel'});
 shell.command({type:'shop-panel',anchor:{x:point.x,y:point.y,width:30,height:40}});await until(async()=>!!shell.popupWindow?.isVisible(),'reopen');await pj("document.getElementById('deliverTrial').click()");await until(async()=>shell.game.state.profile?.job==='keeper','keeper');assert.equal(shell.game.state.profile!.coins,50);assert.equal(shell.game.state.profile!.bag.ration,0);assert.equal(shell.overlay.isFocusable(),false);assert.equal(shell.popupWindow!.isFocusable(),false);assert.deepEqual(shell.overlay.getBounds(),bounds);checks.push({name:'F1 trial completion grants 30 coins once; both native surfaces remain nonfocusable at original height',detail:{bounds,profile:shell.game.state.profile}});
 const denied=await pj(`window.street.command({type:'input-focus',generation:${shell.popup!.generation}}).then(()=>false,()=>true)`);assert.equal(denied,true);shell.openSettings();await until(async()=>!!shell.popupWindow?.isVisible(),'settings');assert.equal(await pj(`window.street.command(${JSON.stringify({...repeat,generation:shell.popup!.generation})}).then(()=>false,()=>true)`),true);checks.push({name:'F1 store panel cannot request keyboard; settings panel cannot mutate economy'});
 await shell.game.request('flush');const disk=JSON.parse(fs.readFileSync(path.join(folder,'solo/profile.json'),'utf8'));assert.equal(disk.job,'keeper');assert.equal(disk.coins,50);assert.ok(errors.length===0,errors.join('\n'));
 fs.writeFileSync(path.join(out,'F1-native.json'),JSON.stringify({time:new Date().toISOString(),method:'Actual macOS Electron windows; native webContents mouse events + programmatic DOM activation; focus explicitly suppressed. Not physical OS click/IME evidence.',folder,checks,errors},null,2));console.log('F1 PASS',checks.length);app.quit();
})().catch(e=>{fs.writeFileSync(path.join(out,'native-failure.json'),JSON.stringify({error:String(e),stack:e.stack,checks,errors},null,2));console.error(e);app.exit(1);});
