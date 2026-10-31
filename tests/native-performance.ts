import {app} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {startDesktop} from '../apps/desktop/bootstrap';

// Development-only isolated probe. It never opens the production settings/profile.
const outputArg=process.argv.find(x=>x.startsWith('--evidence='))?.slice(11);
if(!outputArg||!path.isAbsolute(outputArg))throw Error('absolute --evidence directory required');
const output=outputArg;
fs.mkdirSync(output,{recursive:true});
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'pixelstreet-residency-'));
const residencyMs=Number(process.argv.find(x=>x.startsWith('--residency-ms='))?.slice(15)??0);
if(!Number.isInteger(residencyMs)||residencyMs<0||residencyMs>7_200_000)throw Error('residency duration out of range');
const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const stages:unknown[]=[],errors:string[]=[],samples:unknown[]=[];
const startedAt=new Date().toISOString();
app.focus=()=>{};
app.on('browser-window-created',(_e,w)=>{
 w.focus=()=>{};w.webContents.focus=()=>{};w.show=()=>w.showInactive();
 w.webContents.on('console-message',e=>{if(e.level==='error')errors.push(e.message);});
});
const report=(status:string,extra:Record<string,unknown>={})=>fs.writeFileSync(path.join(output,'performance.json'),JSON.stringify({startedAt,at:new Date().toISOString(),status,method:'Isolated real Electron/Workers. app.getAppMetrics process IDs and ps cumulative CPU/RSS; native showInactive and synthetic DOM focus/blur avoid taking keyboard focus. These are app-process measurements, not OS focus/physical-input evidence. Other work may run on this Mac concurrently.',folder,residencyMs,stages,samples,errors,...extra},null,2));
void(async()=>{
 const shell=await startDesktop(folder),baseline=shell.overlay.getBounds();
 const oj=(s:string)=>shell.overlay.webContents.executeJavaScript(s);
 const aj=(s:string)=>shell.arenaWindow!.webContents.executeJavaScript(s);
 async function until(fn:()=>Promise<boolean>,label:string){for(let n=0;n<240;n++){if(await fn())return;await delay(50);}throw Error(label);}
 const sample=async()=>{
  const metrics=app.getAppMetrics(),ids=metrics.map(x=>x.pid);
  const raw=execFileSync('/bin/ps',['-o','pid=,ppid=,time=,rss=','-p',ids.join(',')],{encoding:'utf8'});
  const rows=raw.trim().split('\n').map(line=>{const [pid,ppid,cpu,rss]=line.trim().split(/\s+/);let cpuSeconds=0;for(const part of cpu.split(':').map(Number))cpuSeconds=cpuSeconds*60+part;return {pid:Number(pid),ppid:Number(ppid),cpuSeconds,rssKiB:Number(rss),type:metrics.find(x=>x.pid===Number(pid))?.type};});
  return {at:Date.now(),rows,rssMiB:rows.reduce((s,x)=>s+x.rssKiB,0)/1024,campFrames:Number(await oj('document.body.dataset.renderFrames')??0),arenaFrames:shell.arenaWindow?Number(await aj('document.body.dataset.arenaFrames')??0):0,actionTick:shell.action.state.run?.tick??0,actionPaused:shell.action.state.run?.paused??true,mode:shell.mode};
 };
 const measure=async(name:string,ms:number)=>{
  const before=await sample();await delay(ms);const after=await sample(),elapsedSeconds=(after.at-before.at)/1000;
  const cpuSeconds=after.rows.reduce((s,x)=>s+Math.max(0,x.cpuSeconds-(before.rows.find(y=>y.pid===x.pid)?.cpuSeconds??x.cpuSeconds)),0);
  const result={name,elapsedSeconds,cpuSeconds,logicalCoresUsed:cpuSeconds/elapsedSeconds,rssMiB:after.rssMiB,campFrames:after.campFrames-before.campFrames,arenaFrames:after.arenaFrames-before.arenaFrames,actionTicks:after.actionTick-before.actionTick,before,after};stages.push(result);report('running');console.log(JSON.stringify({name,logicalCoresUsed:result.logicalCoresUsed,rssMiB:result.rssMiB,arenaFrames:result.arenaFrames}));return result;
 };
 await until(async()=>await oj("document.body.dataset.atlas==='verified'"),'camp atlas');await delay(3000);
 await measure('fresh quiet street',15000);
 for(let n=0;n<3;n++){shell.openSettings();await until(async()=>!!shell.popupWindow?.isVisible(),'settings');shell.closePopup();}
 await delay(2000);await measure('quiet street after cached settings',15000);
 shell.openArena();await until(async()=>!!shell.arenaWindow?.isVisible()&&await aj("document.body.dataset.arenaAssets==='ready'"),'arena ready');
 shell.arenaWindow!.isFocused=()=>true;await aj("window.dispatchEvent(new Event('focus'));document.querySelector('[data-weapon=bow]').click();document.getElementById('arenaStart').click()");
 await until(async()=>!!shell.action.state.run&&!shell.action.state.run.paused,'playing');await delay(500);
 await measure('visible active arena',10000);
 await aj("window.dispatchEvent(new Event('blur'))");shell.closeArena();shell.hide();await delay(500);
 const hidden=await measure('all hidden with cached arena',12000);
 assert.equal(hidden.arenaFrames,0,'hidden arena painted');assert.equal(hidden.campFrames,0,'hidden camp painted');assert.equal(hidden.actionTicks,0,'away solo simulation advanced');
 shell.restore();await delay(2000);await measure('restored quiet street with cached arena',15000);
 if(residencyMs){
  const untilAt=Date.now()+residencyMs;let cycle=0;
  while(Date.now()<untilAt){
   const remaining=untilAt-Date.now();await delay(Math.min(60_000,remaining));
   samples.push(await sample());
   if(++cycle%5===0){shell.hide();await delay(250);shell.restore();await delay(250);assert.deepEqual(shell.overlay.getBounds(),baseline);}
   report('residency-running',{residencyRemainingMs:Math.max(0,untilAt-Date.now())});
  }
  await delay(2000);await measure('quiet after residency',15000);
 }
 assert.deepEqual(shell.overlay.getBounds(),baseline);assert.deepEqual(errors,[]);
 report('PASS',{completedAt:new Date().toISOString(),campBounds:baseline,topology:shell.displays()});console.log('PASS resource probe');app.quit();
})().catch(error=>{report('FAIL',{error:String(error),stack:error.stack});console.error(error);app.exit(1);});
