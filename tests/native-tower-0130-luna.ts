import {app,BrowserWindow,ipcMain,type BrowserWindow as BrowserWindowType} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {startDesktop} from '../apps/desktop/bootstrap';
import {GameRuntime} from '../apps/desktop/game-runtime';
import {GameStore} from '../apps/desktop/game-store';
import {markIsolatedFolder} from '../apps/desktop/launch-profile';
import {APP_NAME,APP_VERSION,PROFILE_NAME} from '../apps/desktop/identity';
import {advance,initialAtelier,initialBonds,initialProfile,initialVillage,parseProfile,towerFloors,towerView,transact,type GameAction,type Profile} from '../packages/solo-core';
import {channels} from '../packages/protocol';

type CheckStatus='PASS'|'FAIL'|'INFO';
type Check={name:string;status:CheckStatus;detail?:unknown};
type Manifest={files?:number;canonicalInventorySha256?:string;hashes?:Record<string,string>;productHashScopes?:string[];product?:Record<string,unknown>;schema?:string;exclusions?:string[]};
type FixtureMode='fresh'|'veteran'|'caps'|'blocked'|'complete'|'rewards';
type WindowTrace={id:number;page:string|null;visible:()=>boolean;focused:()=>boolean;last:{visible:boolean;focused:boolean}};

const EXPECTED_VERSION='0.13.0';
const root=process.cwd();
const fixtureMode=(process.env.PIXELSTREET_TOWER0130_FIXTURE||'') as FixtureMode;
const runId=new Date().toISOString().replace(/[:.]/g,'-')+'-'+process.pid;
const evidenceDir=path.join(root,'work/tower-0130/native-luna');
const profileRoot=fs.mkdtempSync(`/private/tmp/pixelstreet-tower-0130-${fixtureMode||'invalid'}-`);
const soloFolder=path.join(profileRoot,'solo');
const profileFile=path.join(soloFolder,'profile.json');
const manifestPath=path.resolve(process.env.PIXELSTREET_TOWER0130_MANIFEST||'');
const reportPath=path.join(evidenceDir,`tower-0130-${fixtureMode}-${runId}.json`);
const progressPath=path.join(evidenceDir,`progress-${fixtureMode}-${runId}.jsonl`);
const checks:Check[]=[];
const errors:string[]=[];
const harnessIssues:string[]=[];
const screenshots:string[]=[];
const traces=new Map<number,WindowTrace>();
const viewportSessions=new Map<number,boolean>();
const suppression=(globalThis as any).__pixelStreetTower0130Suppression??{};
let shell:Awaited<ReturnType<typeof startDesktop>>|undefined;
let candidateManifest:Manifest|undefined;
let productScopes:string[]=[];
let productHashesAtStart:Record<string,string>={};
let inventoryAtStart='';
let fixture:Profile|undefined;
let status:'RUNNING'|'PASS'|'FAIL'='RUNNING';
let releaseTowerLoadingGate!:()=>void;
let towerLoadingGateEnabled=true;
const towerLoadingGate=new Promise<void>(resolve=>{releaseTowerLoadingGate=resolve;});
const delayedTowerUpdates:Array<{send:(channel:string,...args:any[])=>unknown;args:any[]}>=[];
const actualTowerRewardTally={coins:0,flour:0,ore:0,biscuit:0};

// Hold only real Tower state results and broadcasts long enough to inspect the
// loading screen; the actual Shell IPC handler still supplies the real state.
const originalIpcHandle=(ipcMain as any).handle.bind(ipcMain);
(ipcMain as any).handle=(channel:string,listener:(event:any,...args:any[])=>unknown)=>{
 if(channel!==channels.state)return originalIpcHandle(channel,listener);
 return originalIpcHandle(channel,async(event:any,...args:any[])=>{
  const state=await listener(event,...args);
  if(towerLoadingGateEnabled&&new URL(event.sender.getURL()).searchParams.get('page')==='tower')await towerLoadingGate;
  return state;
 });
};

function codePointCompare(a:string,b:string):number{
 const aa=Array.from(a,c=>c.codePointAt(0)!),bb=Array.from(b,c=>c.codePointAt(0)!);
 for(let i=0;i<Math.min(aa.length,bb.length);i++)if(aa[i]!==bb[i])return aa[i]-bb[i];
 return aa.length-bb.length;
}
function plannedRewardTotal():{coins:number;flour:number;ore:number;biscuit:number}{
 return towerFloors.reduce((total,floor)=>{
  total.coins+=floor.reward.coins??0;total.flour+=floor.reward.flour??0;total.ore+=floor.reward.ore??0;total.biscuit+=floor.reward.biscuit??0;return total;
 },{coins:0,flour:0,ore:0,biscuit:0});
}
function excluded(file:string):boolean{return file.startsWith('dist/tests/')||/^dist\/native-.*\.cjs$/.test(file);}
function walkScope(scope:string,out:Set<string>):void{
 const absolute=path.join(root,scope);assert.ok(fs.existsSync(absolute),'candidate scope missing: '+scope);
 const stat=fs.lstatSync(absolute);assert.ok(!stat.isSymbolicLink(),'symlink in candidate scope: '+scope);
 if(stat.isFile()){if(!excluded(scope))out.add(scope);return;}
 assert.ok(stat.isDirectory(),'unsupported candidate scope object: '+scope);
 const visit=(dir:string,relative:string)=>{
  for(const entry of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>codePointCompare(a.name,b.name))){
   const absoluteEntry=path.join(dir,entry.name),relativeEntry=path.posix.join(relative,entry.name);
   assert.ok(!entry.isSymbolicLink(),'symlink in candidate inventory: '+relativeEntry);
   if(entry.isDirectory())visit(absoluteEntry,relativeEntry);
   else if(entry.isFile()){if(!excluded(relativeEntry))out.add(relativeEntry);}
   else throw Error('unsupported candidate inventory entry: '+relativeEntry);
  }
 };
 visit(absolute,scope);
}
function productHashes():Record<string,string>{
 const files=new Set<string>();for(const scope of productScopes)walkScope(scope,files);
 return Object.fromEntries([...files].sort(codePointCompare).map(file=>[file,createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')]));
}
function canonicalInventory(hashes:Record<string,string>):string{
 const bytes=Object.entries(hashes).sort(([a],[b])=>codePointCompare(a,b)).map(([file,hash])=>`${hash}  ${file}\n`).join('');
 return createHash('sha256').update(bytes,'utf8').digest('hex');
}
function record(name:string,detail?:unknown,statusValue:CheckStatus='PASS'):void{
 const item={name,status:statusValue,detail};checks.push(item);
 try{fs.mkdirSync(evidenceDir,{recursive:true,mode:0o700});fs.appendFileSync(progressPath,JSON.stringify({at:new Date().toISOString(),...item})+'\n',{mode:0o600});}
 catch(error){harnessIssues.push('progress log: '+String(error));}
}
function page(win:BrowserWindowType):string|null{try{return new URL(win.webContents.getURL()).searchParams.get('page');}catch{return null;}}
function snapshots():Array<Record<string,unknown>>{
 return [...traces.values()].map(t=>{
  try{const win=BrowserWindow.fromId(t.id);t.last={visible:t.visible(),focused:t.focused()};return{id:t.id,page:t.page,...t.last,destroyed:!win||win.isDestroyed(),url:win&&!win.isDestroyed()?win.webContents.getURL()||null:null};}
  catch(error){return{id:t.id,page:t.page,...t.last,destroyed:true,url:null,error:String(error)};}
 });
}
function track(win:BrowserWindowType):void{
 if(traces.has(win.id))return;
 const visible=win.isVisible.bind(win),focused=win.isFocused.bind(win);
 traces.set(win.id,{id:win.id,page:page(win),visible,focused,last:{visible:visible(),focused:focused()}});
 const instrument=()=>{
  if(win.isDestroyed())return;
  void win.webContents.executeJavaScript('(()=>{if(window.__tower0130KeyProbe)return;window.__tower0130KeyProbe={count:0,types:[]};for(const t of ["keydown","keyup","keypress"])document.addEventListener(t,e=>{window.__tower0130KeyProbe.count++;window.__tower0130KeyProbe.types.push(e.type)},true)})()').catch(error=>{if(!win.isDestroyed())harnessIssues.push('renderer key probe '+win.id+': '+String(error));});
 };
 win.webContents.on('console-message',(event:any)=>{if(event.level==='error')errors.push(JSON.stringify({window:win.id,page:page(win),message:String(event.message).slice(0,1000),sourceId:event.sourceId,lineNumber:event.lineNumber}));});
 const actualSend=win.webContents.send.bind(win.webContents);
 win.webContents.send=function(channel:string,...args:any[]):any{
  if(towerLoadingGateEnabled&&channel===channels.update&&page(win)==='tower'){delayedTowerUpdates.push({send:actualSend,args:[channel,...args]});return undefined;}
  return actualSend(channel,...args);
 };
 win.webContents.on('did-finish-load',()=>{const row=traces.get(win.id);if(row)row.page=page(win);instrument();});
 if(!win.webContents.isLoadingMainFrame())instrument();
}
function profile():Profile{const p=shell?.game.state.profile;assert.ok(p,'real isolated GameWorker profile unavailable: '+(shell?.game.state.error||'loading'));return p;}
function gameplayState(p:Profile):Record<string,unknown>{const copy=structuredClone(p) as any;delete copy.tick;delete copy.wallAt;delete copy.carryMs;return copy;}
function assertGameplayState(actual:Profile,expected:Profile,label:string):void{assert.deepEqual(gameplayState(actual),gameplayState(expected),label+' (natural Worker clock fields tick/wallAt/carryMs are observed separately)');}
function overlay():BrowserWindowType{const win=shell?.overlay;assert.ok(win&&!win.isDestroyed(),'street renderer unavailable');return win;}
function tower():BrowserWindowType{const win=shell?.towerWindow;assert.ok(win&&!win.isDestroyed(),'tower renderer unavailable');return win;}
async function until(fn:()=>Promise<boolean>|boolean,label:string,timeout=25_000):Promise<void>{
 const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await new Promise(resolve=>setTimeout(resolve,40));}throw Error('timeout: '+label);
}
async function js<T=unknown>(win:BrowserWindowType,source:string):Promise<T>{
 new vm.Script(source,{filename:'tower-0130-renderer-probe.js'});
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([win.webContents.executeJavaScript(source) as Promise<T>,new Promise<T>((_,reject)=>{timer=setTimeout(()=>reject(Error('renderer evaluation timeout '+win.id)),15_000);})]);}
 catch(error){throw Error('renderer evaluation failed in '+win.id+': '+String(error)+'; source='+source.slice(0,500));}
 finally{if(timer)clearTimeout(timer);}
}
async function setViewport(win:BrowserWindowType,width:760|1040,height:650|720):Promise<void>{
 const d=win.webContents.debugger,wasAttached=d.isAttached();if(!wasAttached){d.attach('1.3');viewportSessions.set(win.id,false);}else if(!viewportSessions.has(win.id))viewportSessions.set(win.id,true);
 await d.sendCommand('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
 await until(()=>js<boolean>(win,`innerWidth===${width}&&innerHeight===${height}`),'CSS viewport '+width+'x'+height);
 record('software-only hidden Electron CSS viewport',{width,height,outerWindow:win.getSize(),native:{visible:win.isVisible(),focused:win.isFocused()},method:'CDP Emulation.setDeviceMetricsOverride; no physical-display claim'});
}
async function clearViewports():Promise<void>{
 for(const win of BrowserWindow.getAllWindows()){const d=win.webContents.debugger;if(!d.isAttached())continue;const owned=viewportSessions.get(win.id);try{await d.sendCommand('Emulation.clearDeviceMetricsOverride');}catch(error){harnessIssues.push('clear viewport '+win.id+': '+String(error));}finally{if(owned===false&&d.isAttached())d.detach();viewportSessions.delete(win.id);}}
}
function releaseTowerLoading():void{
 if(!towerLoadingGateEnabled)return;
 towerLoadingGateEnabled=false;releaseTowerLoadingGate();
 for(const queued of delayedTowerUpdates.splice(0)){try{(queued.send as any)(...queued.args);}catch(error){harnessIssues.push('release delayed Tower state broadcast: '+String(error));}}
}
async function buttonState(win:BrowserWindowType,selector:string):Promise<any>{
 return js<any>(win,`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const r=e.getBoundingClientRect(),s=getComputedStyle(e),b=e.closest('button'),bs=b?getComputedStyle(b):s;return{exists:true,id:e.id||null,hidden:!!e.hidden||s.display==='none',disabled:!!b?.disabled||e.getAttribute('aria-disabled')==='true',label:e.getAttribute('aria-label')||e.textContent?.trim()||'',tooltip:b?.dataset.tooltip||e.dataset.tooltip||'',cursor:bs.cursor,background:bs.backgroundColor,boxShadow:bs.boxShadow,filter:bs.filter,rect:{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom},font:parseFloat(s.fontSize)||0}})()`);
}
async function clickAt(win:BrowserWindowType,selector:string):Promise<Record<string,unknown>>{
 const m=await js<any>(win,`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return{ok:false,reason:'missing'};const b=e.closest('button');if(!b||b.disabled||e.hidden||getComputedStyle(e).display==='none')return{ok:false,reason:'not actionable',button:b?.id||null,disabled:!!b?.disabled};const r=b.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,h=document.elementFromPoint(x,y),hit=h?.closest('button');return{ok:true,id:b.id,x,y,hit:hit?.id||null,rect:{x:r.x,y:r.y,width:r.width,height:r.height},label:b.getAttribute('aria-label')||b.textContent?.trim()||'',tooltip:b.dataset.tooltip||''}})()`);
 assert.ok(m?.ok,'software pointer target unavailable: '+selector+' '+JSON.stringify(m));assert.equal(m.hit,m.id,'target center resolves to its own actual button: '+selector);
 assert.ok(m.rect.width>=44&&m.rect.height>=44,'actual software-pointer target meets 44px minimum: '+selector+' '+JSON.stringify(m.rect));
 const nativeBefore={visible:win.isVisible(),focused:win.isFocused()};assert.equal(nativeBefore.visible,false,'target is hidden before software pointer action');assert.equal(nativeBefore.focused,false,'target is unfocused before software pointer action');
 const d=win.webContents.debugger;if(!d.isAttached()){d.attach('1.3');viewportSessions.set(win.id,false);}
 await d.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',x:m.x,y:m.y,pointerType:'mouse'});
 await d.sendCommand('Input.dispatchMouseEvent',{type:'mousePressed',x:m.x,y:m.y,button:'left',clickCount:1,pointerType:'mouse'});
 await d.sendCommand('Input.dispatchMouseEvent',{type:'mouseReleased',x:m.x,y:m.y,button:'left',clickCount:1,pointerType:'mouse'});
 const destroyed=win.isDestroyed(),nativeAfter=destroyed?{destroyed:true,visible:false,focused:false}:{destroyed:false,visible:win.isVisible(),focused:win.isFocused()};assert.equal(nativeAfter.visible,false,'software pointer action never showed a native window');assert.equal(nativeAfter.focused,false,'software pointer action never focused a native window');
 record('hidden renderer software CDP pointer action',{selector,id:m.id,label:m.label,tooltip:m.tooltip,center:{x:m.x,y:m.y},native:{before:nativeBefore,after:nativeAfter},evidence:'programmatic Chromium input; not a physical mouse'});
 return m;
}
async function capture(win:BrowserWindowType,label:string):Promise<void>{
 await new Promise(resolve=>setTimeout(resolve,180));const image=await win.webContents.capturePage(),size=image.getSize(),bytes=image.toPNG();
 assert.ok(bytes.length>5000,'hidden capture unexpectedly empty: '+label+' '+bytes.length);
 const safe=label.replace(/[^a-z0-9-]+/gi,'-').toLowerCase(),file=path.join(evidenceDir,`tower-${fixtureMode}-${runId}-${safe}.png`);
 fs.writeFileSync(file,bytes,{flag:'wx',mode:0o600});screenshots.push(file);
 assert.equal(win.isVisible(),false,'native window remained hidden during capture');assert.equal(win.isFocused(),false,'native window remained unfocused during capture');
 record('hidden Electron capturePage '+label,{file,size,bytes:bytes.length,native:{visible:false,focused:false},method:'renderer capture only; software CSS viewport; not physical-display evidence'});
}
async function visible(win:BrowserWindowType,selector:string):Promise<boolean>{
 return js<boolean>(win,`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return false;for(let n=e;n&&n instanceof HTMLElement;n=n.parentElement){const s=getComputedStyle(n);if(n.hidden||s.display==='none'||s.visibility==='hidden'||s.opacity==='0')return false;}return true})()`);
}
async function auditTowerFit(win:BrowserWindowType,width:number,height:number,label:string):Promise<void>{
 const row=await js<any>(win,`(()=>{
  for(const e of document.querySelectorAll('*'))if(e instanceof HTMLElement&&e.scrollTop)e.scrollTop=0;
  document.documentElement.scrollTop=0;document.body.scrollTop=0;
  const ids=['towerClaimed','towerChapterName','towerChapterProgress','towerFloorNumber','towerFloorTitle','towerFloorStatus','towerInstruction','towerGoalText','towerGoalCount','towerGoalProgress','towerReward-coins','towerRewardCount-coins','towerClaimReason','towerGo','towerClaim','towerNext','towerContinue'];
  const rows=ids.map(id=>{const e=document.getElementById(id),s=e&&getComputedStyle(e),r=e?.getBoundingClientRect();return{id,exists:!!e,visible:!!e&&(()=>{for(let n=e;n&&n instanceof HTMLElement;n=n.parentElement){const q=getComputedStyle(n);if(n.hidden||q.display==='none'||q.visibility==='hidden')return false;}return true})(),font:s?parseFloat(s.fontSize)||0:0,rect:r?{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}:null,disabled:e?.disabled??false,tooltip:e?.dataset.tooltip||''};});
  const actions=[...document.querySelectorAll('.t-chapter'),...document.querySelectorAll('.t-floor:not([hidden])'),document.getElementById('towerGo'),document.getElementById('towerClaim'),document.getElementById('towerNext'),document.getElementById('towerContinue')].filter(e=>e&&!e.hidden).map(e=>{const r=e?.getBoundingClientRect();return{id:e?.id||'',rect:r?{width:r.width,height:r.height,left:r.left,top:r.top,right:r.right,bottom:r.bottom}:null,aria:e?.getAttribute('aria-label')||'',tooltip:e?.dataset.tooltip||'',cursor:e?getComputedStyle(e).cursor:'',hidden:!!e?.hidden,disabled:e?.disabled??false,centerHit:(()=>{if(!r)return null;return document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.closest('button')?.id||null})()};});
  const rewards=[...document.querySelectorAll('.t-reward:not([hidden])')].map(e=>{const r=e.getBoundingClientRect(),count=e.querySelector('span:last-child');return{id:e.id,visible:!e.hidden,font:count?parseFloat(getComputedStyle(count).fontSize)||0:0,text:count?.textContent?.trim()||'',rect:{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}}});
  const scrolls=[...document.querySelectorAll('*')].filter(e=>e instanceof HTMLElement).filter(e=>/(auto|scroll)/.test(getComputedStyle(e).overflowY)&&e.scrollHeight>e.clientHeight+2).map(e=>({id:e.id||'',className:typeof e.className==='string'?e.className:'',scrollTop:e.scrollTop,client:e.clientHeight,scroll:e.scrollHeight}));
  return{viewport:{width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,documentHeight:document.documentElement.scrollHeight,scrollTop:document.scrollingElement?.scrollTop||0,bodyTop:document.body.scrollTop},rows,actions,rewards,scrolls,selected:document.getElementById('towerDetail')?.dataset.floor,status:document.getElementById('towerDetail')?.dataset.status};
 })()`);
 const problems:string[]=[];
 if(row.viewport.width!==width||row.viewport.height!==height||row.viewport.documentWidth>width+1||row.viewport.documentHeight>height+1||row.viewport.scrollTop!==0||row.viewport.bodyTop!==0)problems.push('viewport, overflow, or initial scroll: '+JSON.stringify(row.viewport));
 for(const x of row.rows){const isClaim=x.id==='towerClaim',isNext=x.id==='towerNext';const shouldShow=isClaim?row.status!=='claimed':isNext?row.status==='claimed':true;if(x.visible!==shouldShow)problems.push('action visibility does not match the selected floor state: '+JSON.stringify(x));if(!x.exists||!shouldShow)continue;const r=x.rect;if(!r||r.width<=0||r.height<=0||r.x< -1||r.y< -1||r.right>width+1||r.bottom>height+1)problems.push('required target outside viewport: '+JSON.stringify(x));if(['towerInstruction','towerGoalText','towerGoalCount','towerRewardCount-coins','towerClaimReason','towerChapterProgress'].includes(x.id)&&x.font<16)problems.push('necessary text below 16px: '+JSON.stringify(x));}
 for(const x of row.actions){if(!x.rect||x.rect.height<44||x.rect.width<44)problems.push('button below 44px: '+JSON.stringify(x));if(x.cursor!==(x.disabled?'not-allowed':'pointer'))problems.push('button cursor does not match enabled state: '+JSON.stringify(x));if(!x.aria)problems.push('button lacks accessible purpose: '+x.id);if(x.disabled&&!x.tooltip)problems.push('disabled button lacks an explanation: '+JSON.stringify(x));if(x.centerHit!==x.id)problems.push('button center misses its own hit target: '+JSON.stringify(x));}
 for(const x of row.rewards){if(!x.visible||x.font<16||x.rect.width<=0||x.rect.height<=0||x.rect.x< -1||x.rect.y< -1||x.rect.right>width+1||x.rect.bottom>height+1)problems.push('reward count/image row is hidden, too small, or outside viewport: '+JSON.stringify(x));}
 if(row.scrolls.length)problems.push('nested scrolling needed: '+JSON.stringify(row.scrolls));
 record('tower one-screen readability and action geometry '+label,{...row,problems,policy:'Initial document scrollTop is zero; all visible rewards, goal, instructions, progress and next actions remain in viewport without nested scrolling.'},problems.length?'FAIL':'PASS');
 if(problems.length){const file=path.join(evidenceDir,`raw-red-fit-${fixtureMode}-${runId}-${label.replace(/[^a-z0-9]+/gi,'-').toLowerCase()}.json`);fs.writeFileSync(file,JSON.stringify({label,measured:row,problems},null,2)+'\n',{flag:'wx',mode:0o600});await capture(win,'raw-red-'+label);assert.deepEqual(problems,[],label+' one-screen audit failed: '+problems.join('; '));}
}
async function auditLoadedArt(win:BrowserWindowType,label:string):Promise<void>{
 const art=await js<any>(win,`(async()=>{
  const check=async(img)=>{if(!img)return null;if(!img.complete)await new Promise((resolve,reject)=>{img.addEventListener('load',resolve,{once:true});img.addEventListener('error',()=>reject(Error('image load failed '+img.src)),{once:true});setTimeout(()=>reject(Error('image load timeout '+img.src)),5000)});if(img.decode)await img.decode();return{src:img.currentSrc||img.src,complete:img.complete,width:img.naturalWidth,height:img.naturalHeight};};
  const scene=await check(document.querySelector('.t-interior'));
  const entrance=await check(document.querySelector('#towerEntrance img'));
  const art=document.getElementById('towerHeroArt'),bg=art?getComputedStyle(art).backgroundImage:'';
  const match=bg.match(/url\\([\"']?(.*?)[\"']?\\)/),sprite=match?.[1]||'';
  let spriteLoaded=null;if(sprite){const image=new Image();image.src=sprite;await image.decode();spriteLoaded={src:sprite,width:image.naturalWidth,height:image.naturalHeight,complete:image.complete};}
  return{scene,entrance,spriteBackground:bg,spriteLoaded};
 })()`);
 assert.ok(art.scene?.complete&&art.scene.width>0&&art.scene.height>0,label+' tower interior bitmap loaded');
 assert.ok(art.spriteLoaded?.complete&&art.spriteLoaded.width>0&&art.spriteLoaded.height>0,label+' target item sprite atlas loaded');
 record('actual tower interior/hero artwork loaded in Electron renderer '+label,{...art,streetEntranceImage:'independently decoded in overlay renderer before opening Tower'});
}
async function auditHeroBounds(win:BrowserWindowType,floor:number,label:string):Promise<void>{
 const item=await js<any>(win,`(async()=>{const hero=document.getElementById('towerHeroArt'),stage=hero?.parentElement,title=document.getElementById('towerFloorTitle'),art=hero?getComputedStyle(hero).backgroundImage:'',match=art.match(/url\\(["']?(.*?)["']?\\)/),url=match?.[1]||'',image=url?new Image():null;if(image){image.src=url;await image.decode();}const box=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}};const h=hero?box(hero):null,s=stage?box(stage):null,t=title?box(title):null;const overlap=h&&t?{width:Math.max(0,Math.min(h.right,t.right)-Math.max(h.x,t.x)),height:Math.max(0,Math.min(h.bottom,t.bottom)-Math.max(h.y,t.y))}:null;return{floor:${floor},kind:hero?.dataset.kind,art:hero?.dataset.art,background:art,decoded:image?{src:image.currentSrc||image.src,complete:image.complete,width:image.naturalWidth,height:image.naturalHeight}:null,hero:h,stage:s,title:t,insideStage:!!h&&!!s&&h.x>=s.x-1&&h.y>=s.y-1&&h.right<=s.right+1&&h.bottom<=s.bottom+1,heroTitleOverlap:!!overlap&&overlap.width>1&&overlap.height>1,overlap}})()`);
 assert.ok(item.decoded?.complete&&item.decoded.width>0&&item.decoded.height>0,'floor '+floor+' real atlas image decoded: '+JSON.stringify(item));
 const failed=!item.insideStage||item.heroTitleOverlap;
 record('floor hero artwork bounds and title separation '+label+' floor '+floor,{...item,policy:'actual computed image box fits its stage and does not overlap the floor title'},failed?'FAIL':'PASS');
 if(failed){const file=path.join(evidenceDir,`raw-red-hero-${fixtureMode}-${runId}-floor-${floor}-${label.replace(/[^a-z0-9]+/gi,'-').toLowerCase()}.json`);fs.writeFileSync(file,JSON.stringify(item,null,2)+'\n',{flag:'wx',mode:0o600});await capture(win,`raw-red-hero-floor-${floor}-${label}`);assert.fail('floor '+floor+' hero must fit its stage and stay clear of title: '+JSON.stringify(item));}
}
async function auditTwentyFloorNavigation(win:BrowserWindowType,width:760|1040,height:650|720,label:string):Promise<void>{
 await setViewport(win,width,height);await auditTowerFit(win,width,height,label+' baseline');
 const clicked:number[]=[],chapterNames=['街角','炉火','日常','同行','灯火'] as const;
 for(let chapter=0;chapter<5;chapter++){
  await clickAt(win,`#towerChapter${chapter}`);
  const chapterState=await js<any>(win,`(()=>({pressed:document.getElementById('towerChapter${chapter}').getAttribute('aria-pressed'),visible:[...document.querySelectorAll('.t-floor')].filter(e=>!e.hidden).map(e=>Number(e.dataset.floor)),name:document.getElementById('towerChapterName').textContent,progress:document.getElementById('towerChapterProgress').textContent}))()`);
  assert.equal(chapterState.pressed,'true',label+' chapter tab selection '+chapter);assert.equal(chapterState.visible.length,4,label+' shows four floor controls for chapter '+chapter);assert.equal(chapterState.name,`第${['一','二','三','四','五'][chapter]}章 · ${chapterNames[chapter]}`,label+' chapter image plaque names the selected chapter');const expectedChapterLit=towerView(profile()).floors.slice(chapter*4,chapter*4+4).filter(f=>f.status==='claimed').length;assert.equal(chapterState.progress,`${expectedChapterLit} / 4 盏灯`,label+' selected chapter reports its actual claimed-light count');
  for(let slot=0;slot<4;slot++){
   const id=chapter*4+slot+1;await clickAt(win,`#towerFloor${id}`);const expected=towerView(profile()).floors[id-1],definition=towerFloors[id-1];const selected=await js<any>(win,`(()=>({floor:document.getElementById('towerDetail').dataset.floor,pressed:document.getElementById('towerFloor${id}').getAttribute('aria-pressed'),state:document.getElementById('towerFloorState${id}').textContent,button:document.getElementById('towerFloor${id}').getAttribute('aria-label'),title:document.getElementById('towerFloorTitle').textContent,status:document.getElementById('towerDetail').dataset.status,statusText:document.getElementById('towerFloorStatus').textContent,instruction:document.getElementById('towerInstruction').textContent,goal:document.getElementById('towerGoalText').textContent,count:document.getElementById('towerGoalCount').textContent,go:document.getElementById('towerGoLabel').textContent,goTip:document.getElementById('towerGo').dataset.tooltip,goalProgress:{max:document.getElementById('towerGoalProgress').max,value:document.getElementById('towerGoalProgress').value},rewards:['coins','flour','ore','biscuit'].map(k=>({key:k,hidden:document.getElementById('towerReward-'+k).hidden,text:document.getElementById('towerRewardCount-'+k).textContent}))}))()`);
   const expectedStatusText=({locked:'待前层领奖',active:'正在点亮',ready:'可以领奖',claimed:'星灯已点亮'} as const)[expected.status],targetNames:Record<string,string>={supply:'前往补给店',alchemy:'前往炼金工坊',dungeon:'前往地牢营地',garden:'前往花圃',companions:'前往伙伴小屋',ledger:'前往经营手账','supply-job':'前往店员处','supply-craft':'前往补给料理台','supply-trade':'前往补给货台','supply-manage':'前往补给经营台','supply-orders':'前往补给委托台','alchemy-craft':'前往炼金调配台','alchemy-trade':'前往炼金货台',kitchen:'前往旅人厨房','camp-growth':'前往营地修缮',collection:'前往收藏馆','village-projects':'前往村落建设'};
   const rewardNames={coins:'金币',flour:'面粉',ore:'月纹石',biscuit:'莓果饼'} as const;assert.equal(selected.floor,String(id),label+' floor '+id+' selected detail');assert.equal(selected.pressed,'true',label+' floor '+id+' selected star');assert.ok(selected.button.includes(String(id)),label+' floor '+id+' accessible name');assert.equal(selected.state,expectedStatusText,label+' truthful navigation state for floor '+id);assert.equal(selected.status,expected.status,label+' detail action state for floor '+id);assert.equal(selected.statusText,expectedStatusText,label+' detail status copy for floor '+id);assert.equal(selected.title,definition.title,label+' visible title for floor '+id);assert.equal(selected.instruction,definition.detail,label+' visible actionable explanation for floor '+id);assert.equal(selected.goal,definition.goal,label+' visible goal for floor '+id);assert.equal(selected.count,`${expected.progress} / ${definition.required}`,label+' actual progress for floor '+id);assert.equal(selected.goalProgress.max,definition.required,label+' native progress max for floor '+id);assert.equal(selected.goalProgress.value,expected.progress,label+' native progress value for floor '+id);assert.equal(selected.go,targetNames[definition.target],label+' actionable destination copy for floor '+id);assert.equal(selected.goTip,targetNames[definition.target],label+' destination tooltip for floor '+id);
   for(const reward of selected.rewards){const amount=definition.reward[reward.key as keyof typeof definition.reward]??0;assert.equal(reward.hidden,amount===0,label+' reward visibility floor '+id+' '+reward.key);if(amount)assert.equal(reward.text,`${amount} ${rewardNames[reward.key as keyof typeof rewardNames]}`,label+' exact one-time reward label floor '+id+' '+reward.key);}
   await auditHeroBounds(win,id,label);await auditTowerFit(win,width,height,label+' floor '+id+' one-screen detail');clicked.push(id);
   if(slot===3)await capture(win,`${label}-chapter-${chapter+1}-floor-${id}`);
  }
 }
 assert.deepEqual(clicked,Array.from({length:20},(_,i)=>i+1),label+' every one of twenty floor controls was clicked through actual renderer input');
 record('all five chapters and twenty selectable floors '+label,{width,height,chapters:5,floors:clicked,actualRendererButtons:true});
 await clearViewports();
}
async function probeHover(win:BrowserWindowType,selector:string,label:string):Promise<void>{
 const before=await buttonState(win,selector);assert.ok(before?.exists&&!before.hidden,'hover target is visible: '+selector);
 const d=win.webContents.debugger;if(!d.isAttached()){d.attach('1.3');viewportSessions.set(win.id,false);}const x=before.rect.x+before.rect.width/2,y=before.rect.y+before.rect.height/2;
 await d.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',x,y,pointerType:'mouse'});await new Promise(resolve=>setTimeout(resolve,350));
 const after=await js<any>(win,`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),b=e.closest('button'),s=getComputedStyle(b),tip=document.getElementById('interactionHint');return{cursor:s.cursor,hover: b.matches(':hover'),boxShadow:s.boxShadow,background:s.backgroundColor,pressed:b.classList.contains('is-pressed'),tip:tip?{hidden:tip.hidden,text:tip.textContent}:null,tooltip:b.dataset.tooltip,label:b.getAttribute('aria-label')}})()`);
 assert.equal(after.cursor,'pointer',label+' software-hover cursor');assert.equal(after.hover,true,label+' Chromium hover state');assert.ok(after.boxShadow!==before.boxShadow||after.background!==before.background||after.filter!==before.filter,label+' has visible hover/selected treatment');
 if(after.tip)assert.ok(after.tip.hidden||after.tip.text===after.tooltip,label+' tooltip matches target accessible purpose');
 record('software pointer hover, hand cursor, highlight and hint '+label,{selector,before,after,evidence:'CDP browser-input mouseMoved; native OS pointer not used'});
}
async function streetEntrance():Promise<void>{
 const street=overlay();await until(()=>js<boolean>(street,'document.body.dataset.atlas==="verified"&&!!document.getElementById("towerEntrance")'),'actual street renderer and tower entrance ready');
 await until(()=>js<boolean>(street,'(()=>{const i=document.querySelector("#towerEntrance img");return!!i&&i.complete&&i.naturalWidth>0})()'),'tower building art loaded');
 const initial=await js<any>(street,'(()=>{const b=document.getElementById("towerEntrance"),r=b.getBoundingClientRect(),i=b.querySelector("i"),img=b.querySelector("img");return{hidden:b.hidden,rect:{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom},cursor:getComputedStyle(b).cursor,badge:i?.textContent,title:b.title,alt:img?.alt,image:img?{src:img.currentSrc||img.src,complete:img.complete,width:img.naturalWidth,height:img.naturalHeight}:null}})()');
 assert.equal(initial.hidden,false,'tower entrance is present on the bottom street');assert.equal(initial.cursor,'pointer');assert.ok(initial.rect.width>=44&&initial.rect.height>=44,'street entrance target is at least 44px');assert.ok(initial.badge,'street entrance carries a next-step/claim marker');
 assert.ok(initial.image?.complete&&initial.image.width>0&&initial.image.height>0,'real street tower image decoded with nonzero pixels');
 await probeHover(street,'#towerEntrance','street tower entrance');
 record('clickable street achievement-tower entrance preflight',initial);
 await clickAt(street,'#towerEntrance');
 await until(()=>!!shell?.towerWindow&&!shell.towerWindow.isDestroyed(),'actual street preload/IPC created tower window');
 shell!.openTower(true);
 const win=tower();for(const w of BrowserWindow.getAllWindows())track(w);
 await until(()=>js<boolean>(win,'!!document.getElementById("towerUi")&&document.getElementById("towerState").hidden===false&&document.getElementById("towerStateTitle").textContent.includes("正在打开")'),'actual Tower loading state before the real Shell state response');
 const loading=await js<any>(win,'(()=>({title:document.getElementById("towerStateTitle").textContent,text:document.getElementById("towerStateText").textContent,retry:{disabled:document.getElementById("towerRetry").disabled,label:document.getElementById("towerRetry").getAttribute("aria-label")},floorsDisabled:[...document.querySelectorAll(".t-layout button")].every(b=>b.disabled),ready:document.body.dataset.towerReady||null}))()');
 assert.match(loading.title,/正在打开/);assert.equal(loading.retry.disabled,true,'loading retry is disabled only while its state request is in flight');assert.equal(loading.floorsDisabled,true);assert.notEqual(loading.ready,'true');
 await capture(win,'tower-real-ipc-loading-state');record('actual Tower loading view is recoverable when the held real IPC state response arrives',{loading,method:'test-only delay gate around actual Shell state IPC/broadcast, no replacement state or Worker'});releaseTowerLoading();
 await until(()=>js<boolean>(win,'document.body.dataset.towerReady==="true"&&!!document.getElementById("towerUi")'),'actual tower renderer/preload state ready');
 assert.equal(win.isVisible(),false,'street click and preflight did not reveal tower');assert.equal(win.isFocused(),false,'street click and preflight did not focus tower');
 record('street entrance invoked actual tower-open IPC; hidden preflight retained visibility/focus boundary',{state:shell!.state().tower,window:snapshots(),suppression});
}
async function openOrReopenTower():Promise<BrowserWindowType>{
 if(!shell!.towerWindow||shell!.towerWindow.isDestroyed())await clickAt(overlay(),'#towerEntrance');
 shell!.openTower(true);const win=tower();track(win);await until(()=>js<boolean>(win,'document.body.dataset.towerReady==="true"'),'tower renderer ready after open/reopen');assert.equal(win.isVisible(),false);assert.equal(win.isFocused(),false);return win;
}
async function closeTowerViaRenderer(win:BrowserWindowType,label:string):Promise<void>{
 await clickAt(win,'#towerClose');await until(()=>!shell?.towerWindow||shell.towerWindow.isDestroyed(),label+' closes actual tower window');
 assert.equal(win.isDestroyed(),true,label+' destroyed its isolated Tower BrowserWindow');record(label+' tower close control and Shell IPC',{native:{visible:false,focused:false}});
}
function envelope(action:GameAction,sequence:number,requestId=randomUUID()):any{return{sequence,requestId,action};}
async function gameAction(action:GameAction,label:string):Promise<Profile>{
 const before=profile(),result=await shell!.game.command(envelope(action,before.sequence+1));assert.ok(result.profile,label+' real GameWorker returned profile');
 record('real GameWorker legal setup action '+label,{action,sequenceBefore:before.sequence,sequenceAfter:result.profile.sequence,coinsBefore:before.coins,coinsAfter:result.profile.coins,notice:result.profile.notice,evidence:'direct GameRuntime command for legitimate gameplay setup; Tower awards use actual tower renderer -> preload -> Shell IPC'});
 return result.profile;
}
async function advanceWorker(ms:number,label:string):Promise<Profile>{
 const before=profile(),result=await shell!.game.request('advance',{ms});assert.ok(result.profile,'real testMode GameWorker state after controlled clock');
 record('controlled virtual GameWorker clock '+label,{ms,tickBefore:before.tick,tickAfter:result.profile.tick,roomsBefore:before.leisure.rooms,roomsAfter:result.profile.leisure.rooms,xpBefore:before.xp,xpAfter:result.profile.xp,evidence:'GameWorker testOffset only; not elapsed real time'});
 return result.profile;
}
async function actualTowerIPC(command:any):Promise<any>{
 const source=`(async()=>{try{const s=await window.street.command(${JSON.stringify(command)});return{ok:true,state:{sequence:s.game.profile?.sequence,coins:s.game.profile?.coins,claimed:s.game.profile?.tower?.claimed??0}}}catch(e){return{ok:false,error:String(e)}}})()`;
 return js<any>(tower(),source);
}
async function assertClaimReason(win:BrowserWindowType,floor:number,reason:RegExp,label:string):Promise<void>{
 const row=await js<any>(win,`(()=>({selected:document.getElementById('towerDetail').dataset.floor,status:document.getElementById('towerDetail').dataset.status,disabled:document.getElementById('towerClaim').disabled,tooltip:document.getElementById('towerClaim').dataset.tooltip,reason:document.getElementById('towerClaimReason').textContent,label:document.getElementById('towerClaim').getAttribute('aria-label')}))()`);
 assert.equal(row.selected,String(floor),label+' selected floor');assert.equal(row.disabled,true,label+' claim button disabled');assert.match(row.reason,reason,label+' visible reason');assert.match(row.tooltip,reason,label+' tooltip reason');assert.match(row.label,reason,label+' accessible disabled reason');
 record('real disabled claim reason '+label,row);
}
async function selectFloor(win:BrowserWindowType,id:number):Promise<void>{
 const current=await js<string>(win,'document.getElementById("towerDetail").dataset.floor');if(current!==String(id))await clickAt(win,`#towerChapter${Math.floor((id-1)/4)}`);
 await clickAt(win,`#towerFloor${id}`);await until(()=>js<boolean>(win,`document.getElementById('towerDetail').dataset.floor===${JSON.stringify(String(id))}`),'select tower floor '+id);
}
async function claimFromVisibleUI(win:BrowserWindowType,id:number):Promise<Profile>{
 await selectFloor(win,id);const before=profile();
 const controls=await js<any>(win,`(()=>({disabled:document.getElementById('towerClaim').disabled,hidden:document.getElementById('towerClaim').hidden,status:document.getElementById('towerDetail').dataset.status,progress:document.getElementById('towerGoalCount').textContent}))()`);
 assert.equal(controls.disabled,false,'floor '+id+' ready claim enabled: '+JSON.stringify(controls));assert.equal(controls.hidden,false);assert.equal(controls.status,'ready');
 await clickAt(win,'#towerClaim');await until(()=>profile().sequence===before.sequence+1&&profile().tower?.claimed===id,'real tower IPC claim floor '+id);
 const after=profile(),f=towerFloors[id-1];assert.equal(after.tower?.claimed,id);const rewardDelta={coins:after.coins-before.coins,flour:after.bag.flour-before.bag.flour,ore:after.leisure.materials.ore-before.leisure.materials.ore,biscuit:after.leisure.materials.biscuit-before.leisure.materials.biscuit};const expectedReward={coins:f.reward.coins??0,flour:f.reward.flour??0,ore:f.reward.ore??0,biscuit:f.reward.biscuit??0};assert.deepEqual(rewardDelta,expectedReward,'floor '+id+' exact single reward');for(const key of Object.keys(actualTowerRewardTally) as Array<keyof typeof actualTowerRewardTally>)actualTowerRewardTally[key]+=rewardDelta[key];assert.equal(after.totals.earned,before.totals.earned,'tower gift does not count as earned business income');
 await until(()=>js<boolean>(win,`document.getElementById('towerDetail').dataset.status==='claimed'&&document.getElementById('towerClaim').hidden&&document.getElementById('towerNext').hidden===false`),'renderer reflects actual claim and exposes the next-target control');assert.equal(await visible(win,'#towerClaim'),false,'already-claimed floor hides its claim button');assert.equal(await visible(win,'#towerNext'),true,'claimed floors expose the dedicated next-target control');const nextState=await buttonState(win,'#towerNext');assert.equal(nextState.disabled,id===20,'only the final all-complete state disables the next-target control');if(id===20)assert.match(nextState.label,/全部点亮/,'completed tower accessible name explains why there is no next floor');
 record('actual tower page claim IPC and all-or-nothing worker receipt',{floor:id,goal:f.goal,progress:controls.progress,sequenceBefore:before.sequence,sequenceAfter:after.sequence,coinsBefore:before.coins,coinsAfter:after.coins,rewardDelta,expectedReward,claimed:after.tower?.claimed,bagBefore:before.bag,bagAfter:after.bag,materialsBefore:before.leisure.materials,materialsAfter:after.leisure.materials,earnedBefore:before.totals.earned,earnedAfter:after.totals.earned,requestReceipt:after.receipt});
 if(id<20){await clickAt(win,'#towerNext');await until(()=>js<boolean>(win,`document.getElementById('towerDetail').dataset.floor===${JSON.stringify(String(id+1))}`),'#towerNext selects next unclaimed floor');record('dedicated #towerNext continues the tower after claim',{from:id,to:id+1,visible:await visible(win,'#towerNext'),disabled:(await buttonState(win,'#towerNext'))?.disabled});}
 return after;
}
async function clickNextToFloor(win:BrowserWindowType,id:number):Promise<void>{
 if((await js<string>(win,'document.getElementById("towerDetail").dataset.floor'))===String(id))return;
 await clickAt(win,'#towerContinue');await until(()=>js<boolean>(win,`document.getElementById('towerDetail').dataset.floor===${JSON.stringify(String(id))}`),'header next-target control selects floor '+id);
}
async function verifyTowerPersistenceAndRestart(label:string):Promise<void>{
 const before=profile(),flushed=await shell!.game.request('flush');assert.ok(flushed.profile,label+' real GameWorker flush returned persisted profile');const disk=new GameStore(soloFolder).value;assert.deepEqual(disk,flushed.profile,label+' only the isolated GameStore has the actual flushed Worker state');
 const marker=path.join(profileRoot,'.pixelstreet-isolated-profile.json');assert.ok(fs.existsSync(marker));assert.match(fs.readFileSync(marker,'utf8'),/isolated-playtest/);
 const old=shell!.game;try{await old.close();}catch(error){record(label+' old Worker termination after flush refusal',{error:String(error)},'INFO');}
 const target=shell as any;const replacement=new GameRuntime(soloFolder,()=>target.broadcast(),true);Object.defineProperty(target,'game',{configurable:true,writable:true,value:replacement});await replacement.ready;
 await until(()=>target.game.state.status==='ready'&&!!target.game.state.profile,label+' actual restarted GameWorker ready');assertGameplayState(profile(),disk,label+' restarted real GameWorker reads persisted isolated profile');target.broadcast();
 record(label+' actual GameWorker flush/restart/reload persisted private profile',{profileRoot,profileFile,marker,sequence:profile().sequence,tower:profile().tower??null,onlyWorkerRestarted:true});
}
async function initializeProfile():Promise<void>{
 fs.mkdirSync(evidenceDir,{recursive:true,mode:0o700});
 assert.equal(process.env.PIXELSTREET_TOWER0130_GO,'1','root final-manifest GO is required');
 assert.equal(process.env.PIXELSTREET_TOWER0130_RUNNER,path.join(root,'dist','native-tower-0130-luna.cjs'));
 assert.ok(['fresh','veteran','caps','blocked','complete','rewards'].includes(fixtureMode),'fixture mode required');
 assert.equal(APP_VERSION,EXPECTED_VERSION);assert.equal(APP_NAME,'PixelStreet 0.13.0');assert.equal(PROFILE_NAME,'PixelStreetCamp');
 assert.deepEqual(plannedRewardTotal(),{coins:188,flour:4,ore:6,biscuit:3},'twenty permanent gifts match the planned balanced reward total');
 assert.ok(manifestPath&&fs.existsSync(manifestPath),'root final candidate manifest is required');candidateManifest=JSON.parse(fs.readFileSync(manifestPath,'utf8')) as Manifest;
 assert.ok(candidateManifest.hashes&&candidateManifest.canonicalInventorySha256&&Array.isArray(candidateManifest.productHashScopes),'final manifest must provide exact product hashes/scopes');productScopes=candidateManifest.productHashScopes!;
 productHashesAtStart=productHashes();inventoryAtStart=canonicalInventory(productHashesAtStart);
 assert.deepEqual(productHashesAtStart,candidateManifest.hashes,'all source/runtime product bytes match root frozen candidate');assert.equal(inventoryAtStart,candidateManifest.canonicalInventorySha256);assert.equal(Object.keys(productHashesAtStart).length,candidateManifest.files);
 assert.equal(candidateManifest.schema,'pixelstreet.camp-0130.candidate-manifest.v1');assert.equal(candidateManifest.product?.version,EXPECTED_VERSION);assert.equal(candidateManifest.product?.productName,APP_NAME);assert.equal(candidateManifest.product?.profileName,PROFILE_NAME);
 record('root frozen RC candidate manifest exact product inventory GO',{manifestPath,files:Object.keys(productHashesAtStart).length,canonicalInventorySha256:inventoryAtStart,productHashScopes:productScopes,exclusions:candidateManifest.exclusions});
 fs.chmodSync(profileRoot,0o700);markIsolatedFolder(profileRoot,app.getPath('appData'));fixture=buildFixture(fixtureMode,Date.now());fs.mkdirSync(soloFolder,{recursive:true,mode:0o700});
 if(fixtureMode==='blocked'){
  fs.writeFileSync(profileFile,'{ deliberately invalid isolated test profile\n',{flag:'wx',mode:0o600});
  const rawPath=path.join(evidenceDir,`blocked-profile-raw-${runId}.txt`);fs.writeFileSync(rawPath,fs.readFileSync(profileFile),{flag:'wx',mode:0o600});
  record('blocked-mode raw profile fixture is isolated and preserved',{profileRoot,marker:path.join(profileRoot,'.pixelstreet-isolated-profile.json'),rawPath,validRecoveryFixture:{version:fixture.version,sequence:fixture.sequence,coins:fixture.coins},boundary:'deliberately invalid bytes exist only in this marked /private/tmp profile'});
 }else{
  fs.writeFileSync(profileFile,JSON.stringify(fixture)+'\n',{flag:'wx',mode:0o600});
  assert.deepEqual(parseProfile(JSON.parse(fs.readFileSync(profileFile,'utf8'))),fixture,'fixture passes schema8 parser');
  assert.deepEqual(new GameStore(soloFolder).value,fixture,'fixture round-trips through actual GameStore before launch');
  const nature=fixtureMode==='rewards'?'schema-valid synthetic achieved-history fixture with no tower extension; supports UI/IPC reward coverage only, not gameplay completion':fixtureMode==='complete'?'synthetic display fixture; not gameplay completion':fixtureMode==='veteran'?'legacy state created only by legal solo-core actions':'fresh/edge state';
  record('mode-specific marked schema8 profile parsed and GameStore round-trip before Electron launch',{fixtureMode,profileRoot,profileFile,marker:path.join(profileRoot,'.pixelstreet-isolated-profile.json'),version:fixture.version,sequence:fixture.sequence,job:fixture.job,coins:fixture.coins,hasTower:Object.hasOwn(fixture,'tower'),fixtureNature:nature});
 }
}
function buildFixture(mode:FixtureMode,now:number):Profile{
 let p=initialProfile(now);
 const act=(action:GameAction)=>{p=transact(p,envelope(action,p.sequence+1));};
 if(mode==='veteran'){
  act({type:'apply-job'});act({type:'craft',recipe:'ration',count:1});p=advance(p,p.wallAt+8_000);act({type:'deliver-trial'});
  assert.equal(Object.hasOwn(p,'tower'),false,'legacy history fixture does not seed the new tower extension');return parseProfile(p);
 }
 if(mode==='caps'){
  act({type:'apply-job'});p.coins=1_000_000_000;return parseProfile(p);
 }
 if(mode==='complete'){
  p.tower={version:1,claimed:20,progress:towerFloors.map(f=>f.required)};return parseProfile(p);
 }
 if(mode==='rewards'){
  // Same schema-valid historical achievement shape as the core veteran() fixture,
  // but no tower extension: the real Worker must initialize it on first claim.
  p.job='keeper';p.coins=200;p.totals={crafted:1,sold:1,earned:100,wins:0};p.xp=5;
  p.leisure.rooms=6;p.leisure.clears=[1,1,1,0,0];p.leisure.companions.slime=2;p.leisure.companions.guide=0;
  p.leisure.harvests=1;p.leisure.cooked=1;p.leisure.journal.buildings.workshop=1;
  p.leisure.journal.relics[0]=1;p.leisure.journal.relics[1]=1;p.leisure.journal.relics[2]=1;
  p.atelier=initialAtelier();p.atelier.made.dew=1;p.atelier.orders.alchemy[0].revision=1;
  p.leisure.bonds=initialBonds();p.leisure.bonds.progress.slime={path:'scout',rank:1,voyages:3,stories:0};
  p.village=initialVillage();p.village.projects.teahouse=1;
  const achieved=parseProfile(p);
  assert.equal(Object.hasOwn(achieved,'tower'),false,'achieved-history fixture leaves the optional tower extension absent');
  assert.deepEqual(towerView(achieved).floors.map(f=>f.progress),towerFloors.map(f=>f.required),'all twenty targets are recognized from schema-valid historical counters');
  return achieved;
 }
 return parseProfile(p);
}
async function launchAndOpenTower():Promise<BrowserWindowType>{
 app.on('browser-window-created',(_event,win)=>track(win));
 app.on('web-contents-created',(_event:any,contents:any)=>contents.on('console-message',(event:any)=>{if(event.level==='error')errors.push('renderer '+String(event.message).slice(0,1000));}));
 shell=await startDesktop(profileRoot,true);
 await until(()=>shell?.game.state.status==='ready'||shell?.game.state.status==='blocked','real GameWorker ready or deliberate blocked state');
 if(fixtureMode==='blocked')assert.equal(shell.game.state.status,'blocked','damaged profile blocks only the isolated real GameWorker');else{assert.equal(shell.game.state.status,'ready');assertGameplayState(profile(),fixture!,'real GameWorker loaded validated preflight fixture');}
 for(const win of BrowserWindow.getAllWindows())track(win);
 for(const row of snapshots()){assert.equal(row.visible,false,'native window stayed hidden on startup: '+JSON.stringify(row));assert.equal(row.focused,false,'native window stayed unfocused on startup: '+JSON.stringify(row));}
 record('real hidden Electron DesktopShell and GameWorker started against marked profile',{fixtureMode,gameStatus:shell.game.state.status,profile:fixtureMode==='blocked'?null:{version:profile().version,sequence:profile().sequence,coins:profile().coins,job:profile().job,tower:profile().tower??null},nativeWindows:snapshots(),suppression});
 await streetEntrance();return tower();
}
async function testInitialDisabledAndBadClaims(win:BrowserWindowType):Promise<void>{
 await selectFloor(win,1);await assertClaimReason(win,1,/尚未完成本层目标/,'fresh floor 1 unmet');
 const before=profile(),unmet=await actualTowerIPC({type:'tower-action',envelope:envelope({type:'tower-claim',floor:1},before.sequence+1)});
 assert.equal(unmet.ok,false,'direct actual tower IPC rejects unmet goal');assert.match(unmet.error,/尚未完成本层目标/);assert.equal(profile().sequence,before.sequence);assert.equal(Object.hasOwn(profile(),'tower'),false,'failed read/claim does not initialize optional extension');
 const locked=await actualTowerIPC({type:'tower-action',envelope:envelope({type:'tower-claim',floor:2},before.sequence+1)});
 assert.equal(locked.ok,false,'actual tower IPC rejects a future locked floor');assert.match(locked.error,/先领取前一层/);assert.equal(profile().sequence,before.sequence);assert.equal(Object.hasOwn(profile(),'tower'),false);
 await selectFloor(win,2);await assertClaimReason(win,2,/先领取前一层/,'fresh floor 2 locked');
 record('actual Tower IPC rejects incomplete and locked floors without sequence/profile mutation',{unmet,locked,sequence:profile().sequence,towerExtension:Object.hasOwn(profile(),'tower')});
}
async function testGoToJobAndRecover():Promise<BrowserWindowType>{
 const win=tower();await selectFloor(win,1);const before=profile().sequence;
 await clickAt(win,'#towerGo');await until(()=>shell?.state().tower?.suspended===true&&shell.popup?.kind==='shop','tower link suspends tower and opens actual supply work area');
 const shop=shell!.popupWindow;assert.ok(shop&&!shop.isDestroyed());track(shop);await until(()=>js<boolean>(shop,'document.body.dataset.popupReady==="true"&&document.body.dataset.popup==="shop"&&document.getElementById("jobPanel")!==null'),'real supply renderer loaded for tower destination');
 const destination=await js<any>(shop,'(()=>({destination:document.body.dataset.towerDestination,jobHidden:document.getElementById("jobPanel").hidden,jobText:document.getElementById("jobStory").textContent,profileJob:document.body.dataset.job,scrollTop:document.querySelector(".popover-content")?.scrollTop??0}))()');
 assert.equal(destination.destination,'supply-job');assert.equal(destination.jobHidden,false,'tower guide lands on the live job task');assert.equal(destination.profileJob,'visitor');
 assert.equal(profile().sequence,before,'navigation does not mutate progress');record('tower Go reaches the real existing first-job task instead of a destination shell page',destination);
 const old=win;await clickAt(overlay(),'#towerEntrance');await until(()=>shell?.towerWindow===old&&!old.isDestroyed()&&shell.state().tower?.suspended===false,'actual camp tower entrance resumes the existing tower window');
 const activeShell=shell!;await until(()=>activeShell.popup===null||activeShell.popupWindow?.isDestroyed()||activeShell.popup?.suspended===true,'tower return keeps the hidden work-area boundary');
 return tower();
}
async function testFloorFitAndLifecycle(win:BrowserWindowType):Promise<BrowserWindowType>{
 await auditLoadedArt(win,'fresh tower opened by street entrance');
 await selectFloor(win,1);await setViewport(win,760,650);await auditTowerFit(win,760,650,'fresh 760×650 first goal');await probeHover(win,'#towerGo','tower Go button');await capture(win,'fresh-first-goal-760x650');
 await auditTwentyFloorNavigation(win,760,650,'760x650');
 await setViewport(win,1040,720);await selectFloor(win,1);await auditTowerFit(win,1040,720,'fresh 1040×720 first goal');await auditTwentyFloorNavigation(win,1040,720,'1040x720');
 await clearViewports();
 await selectFloor(win,1);await testGoToJobAndRecover();
 await closeTowerViaRenderer(tower(),'close and reopen default target');win=await openOrReopenTower();
 const initial=await js<any>(win,'(()=>({floor:document.getElementById("towerDetail").dataset.floor,title:document.getElementById("towerFloorTitle").textContent,claimDisabled:document.getElementById("towerClaim").disabled,nextHidden:document.getElementById("towerNext").hidden,scroll:document.scrollingElement?.scrollTop??0}))()');
 assert.equal(initial.floor,'1','fresh profile reopens on first unclaimed floor');assert.equal(initial.scroll,0);record('close/reopen returns the fresh profile to its first unclaimed goal',initial);
 await testInitialDisabledAndBadClaims(win);return win;
}
async function actualClaimIdempotency(win:BrowserWindowType):Promise<void>{
 const before=profile(),floor=1;assert.equal(towerView(before).floors[floor-1].status,'claimed','fresh UI claim completed immediately before receipt replay');
 const receipt=before.receipt;assert.ok(receipt&&receipt.sequence===before.sequence,'worker persisted exact tower receipt');
 const exact={type:'tower-action',envelope:{sequence:receipt.sequence,requestId:receipt.requestId,action:{type:'tower-claim',floor}}};
 const same=await actualTowerIPC(exact);assert.equal(same.ok,true,'retry with exact receipt is idempotent');assert.equal(profile().sequence,before.sequence);assert.equal(profile().coins,before.coins);
 const duplicate=await actualTowerIPC({type:'tower-action',envelope:envelope({type:'tower-claim',floor},profile().sequence+1)});
 assert.equal(duplicate.ok,false,'new request for an already claimed floor is rejected');assert.match(duplicate.error,/奖励已领取/);assert.equal(profile().sequence,before.sequence);assert.equal(profile().coins,before.coins);
 record('real Tower IPC exact-receipt retry is idempotent; new duplicate receipt is rejected',{sameReceipt:same,newDuplicate:duplicate,sequence:profile().sequence,coins:profile().coins,claimed:profile().tower?.claimed});
}
async function testFreshEightFloors(win:BrowserWindowType):Promise<BrowserWindowType>{
 const start=profile();assert.equal(start.coins,20);assert.equal(start.job,'visitor');assert.equal(Object.hasOwn(start,'tower'),false);
 await selectFloor(win,1);
 await gameAction({type:'apply-job'},'from the actual 20-coin visitor profile apply for the supply job');
 assert.equal(profile().coins,20);await until(()=>js<boolean>(win,'document.getElementById("towerDetail").dataset.status==="ready"'),'floor 1 becomes ready from actual job');
 const first=await claimFromVisibleUI(win,1);assert.equal(first.coins,23);assert.equal(first.bag.flour,6);
 await actualClaimIdempotency(win);
 await gameAction({type:'craft',recipe:'ration',count:1},'craft the first ration with the four real apprenticeship flour');
 await advanceWorker(8_000,'first ration completes');assert.equal(profile().totals.crafted,1);await claimFromVisibleUI(win,2);
 await gameAction({type:'deliver-trial'},'deliver the actually crafted trial and become keeper');assert.equal(profile().job,'keeper');assert.equal(profile().coins,56,'30 trial coins stack after the first two claimed tower gifts');await claimFromVisibleUI(win,3);
 await gameAction({type:'craft',recipe:'ration',count:3},'make three saleable rations with the earned/awarded flour');await advanceWorker(20_000,'three rations complete');assert.equal(profile().bag.ration,3);
 await gameAction({type:'retail',enabled:true},'open NPC retail without automatic purchasing');await advanceWorker(6_000,'first actual NPC sale');assert.equal(profile().totals.sold,1);await claimFromVisibleUI(win,4);
 await gameAction({type:'stroll-start',zone:0,route:'balanced',trips:1},'send the companion on one legitimate Mosslight Courtyard stroll');
 const stroll=await advanceWorker(120_000,'complete one six-encounter trip on controlled Worker time');assert.equal(stroll.leisure.clears[0],1);assert.equal(stroll.leisure.rooms,6);assert.equal(stroll.leisure.run,null);
 await gameAction({type:'stroll-claim'},'collect the real stroll cargo into profile XP/materials');assert.ok(profile().xp>=5);
 await claimFromVisibleUI(win,5);await claimFromVisibleUI(win,6);await claimFromVisibleUI(win,7);
 assert.ok(profile().leisure.materials.biscuit>=2,'floor 7 reward is the source of two actual biscuit items');
 await gameAction({type:'companion-feed',companion:'slime'},'feed one earned floor-7 berry biscuit');await gameAction({type:'companion-feed',companion:'slime'},'feed the second earned floor-7 berry biscuit');
 assert.ok((profile().leisure.companions.slime??0)>=2);await claimFromVisibleUI(win,8);
 const final=profile();assert.equal(final.tower?.claimed,8);assert.equal(final.tower?.progress[0],1);assert.equal(final.tower?.progress[1],1);assert.equal(final.tower?.progress[2],1);assert.equal(final.tower?.progress[3],1);assert.equal(final.tower?.progress[4],1);assert.equal(final.tower?.progress[5],5);assert.equal(final.tower?.progress[6],1);assert.equal(final.tower?.progress[7],2);
 assert.deepEqual(actualTowerRewardTally,{coins:41,flour:4,ore:1,biscuit:2},'fresh first eight floors receive the balanced planned one-time rewards');
 record('fresh real gameplay reaches and claims the first eight tower floors',{initialCoins:start.coins,job:final.job,crafted:final.totals.crafted,sold:final.totals.sold,rooms:final.leisure.rooms,clears:final.leisure.clears,xp:final.xp,slimeXP:final.leisure.companions.slime,claimed:final.tower?.claimed,sequence:final.sequence,coins:final.coins,earned:final.totals.earned,flour:final.bag.flour,biscuits:final.leisure.materials.biscuit,towerRewardTally:{...actualTowerRewardTally},evidence:'all progress came from legal actions/virtual ticks in the actual GameWorker; tower rewards came through the tower page IPC'});
 await gameAction({type:'garden-plant',plot:0,crop:'herb'},'plant one legal 2-coin herb to create a real ready ninth-floor target for the animation check');await advanceWorker(180_000,'wait for the actual herb crop to mature using testMode clock');await gameAction({type:'garden-harvest',plot:0},'harvest the actual mature herb; floor 9 becomes ready in the Worker');assert.equal(profile().leisure.harvests,1);await until(()=>js<boolean>(win,'document.getElementById("towerFloor9").dataset.status==="ready"'),'real ninth-floor target ready for presentation pause test');record('legal garden actions make the animation target genuinely ready in GameWorker',{harvests:profile().leisure.harvests,floor9:towerView(profile()).floors[8].status,coins:profile().coins,time:'Worker virtual testMode clock; not elapsed real time'});
 await capture(win,'fresh-eight-floors-and-dedicated-next-button');return win;
}
async function testWorkingElsewhere(win:BrowserWindowType):Promise<void>{
 const visibility=await js<any>(win,'(()=>{const d={};for(const k of ["hidden","visibilityState","hasFocus"])d[k]=Object.getOwnPropertyDescriptor(document,k)||null;return{saved:d,actual:{hidden:document.hidden,visibilityState:document.visibilityState,hasFocus:document.hasFocus()}}})()');
 await js(win,'(()=>{Object.defineProperty(document,"hidden",{configurable:true,get:()=>false});Object.defineProperty(document,"visibilityState",{configurable:true,get:()=>"visible"});Object.defineProperty(document,"hasFocus",{configurable:true,value:()=>true});document.getElementById("towerUi").dispatchEvent(new PointerEvent("pointerenter",{bubbles:false}));return true})()');
 const running=await js<any>(win,'(()=>({motion:document.getElementById("towerUi").dataset.motion,animation:getComputedStyle(document.querySelector(".t-floor[data-status=ready] .t-lamp")).animationName}))()');
 if(running.motion!=='running')record('software-only motion enable probe could not enter running state',{running,visibility,windowHidden:!win.isVisible(),nativeFocus:win.isFocused()},'INFO');
 await gameAction({type:'stroll-start',zone:0,route:'balanced',trips:1},'begin another legitimate stroll for idle-tick verification');
 const before=profile();app.emit('did-resign-active');await until(()=>shell?.state().workingElsewhere===true&&shell.state().tower?.suspended===true,'real DesktopShell workingElsewhere suspension signal');
 await until(()=>js<boolean>(win,'document.getElementById("towerUi").dataset.motion==="paused"'),'tower motion paused after Shell workingElsewhere');
 const paused=await js<any>(win,'(()=>({motion:document.getElementById("towerUi").dataset.motion,animation:getComputedStyle(document.querySelector(".t-floor[data-status=ready] .t-lamp")).animationPlayState,workingElsewhere:undefined}))()');
 assert.equal(paused.motion,'paused','tower presentation motion state pauses when Shell enters workingElsewhere');assert.equal(paused.animation,'paused','ready-floor lamp CSS animation pauses when Shell enters workingElsewhere');
 const after=await advanceWorker(30_000,'actual companion stroll continues while Shell reports workingElsewhere');
 assert.equal(shell!.state().workingElsewhere,true);assert.equal(after.tick,before.tick+300);assert.equal(after.leisure.rooms,before.leisure.rooms+1,'idle progress advances despite tower motion pause');assert.equal(after.leisure.run?.room,1);
 record('workingElsewhere pauses presentation while real companion economy continues',{before:{tick:before.tick,rooms:before.leisure.rooms,run:before.leisure.run},after:{tick:after.tick,rooms:after.leisure.rooms,run:after.leisure.run},running,paused,workingElsewhere:shell!.state().workingElsewhere,native:{visible:win.isVisible(),focused:win.isFocused()},time:'virtual GameWorker advance, not 30 seconds of real-world play',blur:'synthetic Electron Shell did-resign-active event; no physical application switch'});
 app.emit('did-become-active');shell!.openTower(true);await until(()=>shell?.state().workingElsewhere===false&&shell.state().tower?.suspended===false,'hidden tower becomes available after synthetic app return and camp re-open');
 await until(()=>js<boolean>(win,'document.getElementById("towerUi").dataset.motion==="running"||document.getElementById("towerUi").dataset.motion==="paused"'),'tower motion settles after Shell return');
 await js(win,`(()=>{const x=${JSON.stringify(visibility.saved)};for(const k of ["hidden","visibilityState","hasFocus"]){if(x[k])Object.defineProperty(document,k,x[k]);else delete document[k];}document.getElementById("towerUi").dispatchEvent(new Event("visibilitychange"));return true})()`);
 assert.equal(win.isVisible(),false);assert.equal(win.isFocused(),false);
 record('workingElsewhere return probe restored native document property descriptors',{savedNativeDocument:visibility.actual,restored:true,workingElsewhere:shell!.state().workingElsewhere,native:{visible:win.isVisible(),focused:win.isFocused()}});
}
async function testFreshMode(win:BrowserWindowType):Promise<void>{
 win=await testFloorFitAndLifecycle(win);win=await testFreshEightFloors(win);await testWorkingElsewhere(win);
 await closeTowerViaRenderer(win,'persisted tower close');await verifyTowerPersistenceAndRestart('first-eight-floor reward persistence');
 win=await openOrReopenTower();const reopened=await js<any>(win,'(()=>({floor:document.getElementById("towerDetail").dataset.floor,claimed:document.getElementById("towerClaimed").textContent,scroll:document.scrollingElement?.scrollTop??0}))()');
 assert.equal(reopened.floor,'9');assert.equal(reopened.claimed,'8');assert.equal(reopened.scroll,0);record('restarted actual Worker and reopened tower targets the next unclaimed ninth floor',reopened);
 await closeTowerViaRenderer(win,'final fresh-mode tower close');
}
async function testVeteranMode(win:BrowserWindowType):Promise<void>{
 assert.equal(Object.hasOwn(profile(),'tower'),false,'legacy fixture has no optional tower extension');assert.equal(profile().job,'keeper');assert.equal(profile().totals.crafted,1);
 const noWrite=profile();await until(()=>js<boolean>(win,'document.getElementById("towerDetail").dataset.status==="ready"'),'legacy accomplished first tower floor recognized');
 const historical=await js<any>(win,'(()=>({floors:[1,2,3,4].map(i=>({id:i,status:document.getElementById("towerFloor"+i).dataset.status,text:document.getElementById("towerFloorState"+i).textContent,progress:i===Number(document.getElementById("towerDetail").dataset.floor)?document.getElementById("towerGoalCount").textContent:null})),selected:document.getElementById("towerDetail").dataset.floor,goal:document.getElementById("towerGoalCount").textContent}))()');
 assert.equal(historical.selected,'1');assert.equal(historical.floors[0].status,'ready');assert.equal(historical.goal,'1 / 1','legacy employment history is recognized as first-floor progress');assert.equal(historical.floors[1].status,'locked','historical second-floor progress waits behind the first reward');assert.equal(towerView(profile()).floors[1].progress,1,'legacy crafting history is recognized before its floor unlocks');assert.equal(historical.floors[2].status,'locked','historical keeper history waits behind earlier rewards');assert.equal(towerView(profile()).floors[2].progress,1,'legacy keeper history is recognized before its floor unlocks');assert.equal(towerView(profile()).floors[3].progress,0,'no future sales goal is invented');
 await selectFloor(win,2);assert.equal(await js<string>(win,'document.getElementById("towerGoalCount").textContent'),'1 / 1','locked legacy craft floor still displays recognized progress');await assertClaimReason(win,2,/先领取前一层/,'legacy completed craft awaits prior claim');
 await selectFloor(win,3);assert.equal(await js<string>(win,'document.getElementById("towerGoalCount").textContent'),'1 / 1','locked legacy keeper floor still displays recognized progress');await assertClaimReason(win,3,/先领取前一层/,'legacy completed keeper floor awaits prior claim');
 await selectFloor(win,4);assert.equal(await js<string>(win,'document.getElementById("towerGoalCount").textContent'),'0 / 1','future unmet sales floor shows its real current progress');await selectFloor(win,1);
 assert.equal(Object.hasOwn(profile(),'tower'),false,'read and legacy-progress recognition leave extension absent');assert.equal(profile().sequence,noWrite.sequence);
 await claimFromVisibleUI(win,1);await claimFromVisibleUI(win,2);await claimFromVisibleUI(win,3);assert.equal(profile().tower?.claimed,3);
 await verifyTowerPersistenceAndRestart('legacy progress recognition');await closeTowerViaRenderer(tower(),'veteran close');win=await openOrReopenTower();const reopened=await js<any>(win,'({floor:document.getElementById("towerDetail").dataset.floor,claimed:document.getElementById("towerClaimed").textContent})');assert.equal(reopened.floor,'4');assert.equal(reopened.claimed,'3');
 record('legacy schema7 actions are recognized from history after actual GameWorker restart',{initialJob:noWrite.job,initialCrafted:noWrite.totals.crafted,floors:historical.floors,reopened,extensionAfterFirstAward:profile().tower});await closeTowerViaRenderer(win,'veteran final close');
}
async function replaceWithMarkedFixture(next:Profile,label:string,broadcastUpdates=true):Promise<void>{
 const marker=path.join(profileRoot,'.pixelstreet-isolated-profile.json');assert.ok(fs.existsSync(marker));const validated=parseProfile(next);
 if(shell!.game.state.status==='ready')await shell!.game.request('flush');
 else record(label+' blocked Worker has no flushable profile; retain its damaged bytes until isolated repair',{status:shell!.game.state.status,error:shell!.game.state.error},'INFO');
 const old=shell!.game;try{await old.close();}catch(error){record(label+' old real Worker close warning',{error:String(error)},'INFO');}
 fs.writeFileSync(profileFile,JSON.stringify(validated)+'\n',{flag:'w',mode:0o600});assert.deepEqual(parseProfile(JSON.parse(fs.readFileSync(profileFile,'utf8'))),validated,label+' new fixture validates after marker check and before restart');
 const target=shell as any;const replacement=new GameRuntime(soloFolder,()=>{if(broadcastUpdates)target.broadcast();},true);Object.defineProperty(target,'game',{configurable:true,writable:true,value:replacement});await replacement.ready;await until(()=>target.game.state.status==='ready'&&!!target.game.state.profile,label+' actual restarted Worker loads new validated fixture');if(broadcastUpdates)target.broadcast();
 assertGameplayState(profile(),validated,label+' actual worker state equals validated written fixture');record(label+' marked-profile fixture replacement followed by actual GameWorker restart',{marker,profileFile,version:validated.version,sequence:validated.sequence,coins:validated.coins,bag:validated.bag,tower:validated.tower??null,actualWorkerRestart:true});
}
async function testCapacityMode(win:BrowserWindowType):Promise<void>{
 const max=profile();assert.equal(max.coins,1_000_000_000);await selectFloor(win,1);await assertClaimReason(win,1,/金币空间不足/,'coin capacity');const exactBefore={sequence:max.sequence,coins:max.coins,flour:max.bag.flour};
 const coinFull=await actualTowerIPC({type:'tower-action',envelope:envelope({type:'tower-claim',floor:1},max.sequence+1)});assert.equal(coinFull.ok,false);assert.match(coinFull.error,/金币空间不足/);assert.deepEqual({sequence:profile().sequence,coins:profile().coins,flour:profile().bag.flour},exactBefore);assert.equal(Object.hasOwn(profile(),'tower'),false);
 let flour=initialProfile(Date.now());flour=transact(flour,envelope({type:'apply-job'},flour.sequence+1));flour.coins=20;flour.bag.flour=999_999;flour=parseProfile(flour);
 await replaceWithMarkedFixture(flour,'flour space boundary');await until(()=>js<boolean>(win,'document.body.dataset.towerReady==="true"'),'tower state updates after capacity fixture restart');
 await selectFloor(win,1);await assertClaimReason(win,1,/材料空间不足/,'flour capacity with insufficient room for full reward');const flourBefore={sequence:profile().sequence,coins:profile().coins,flour:profile().bag.flour,tower:profile().tower??null};
 const flourFull=await actualTowerIPC({type:'tower-action',envelope:envelope({type:'tower-claim',floor:1},profile().sequence+1)});assert.equal(flourFull.ok,false);assert.match(flourFull.error,/材料空间不足/);assert.deepEqual({sequence:profile().sequence,coins:profile().coins,flour:profile().bag.flour,tower:profile().tower??null},flourBefore,'reward room validation is atomic: no coin grant and no tower cursor');
 record('real Worker capacity rejection covers full coins and insufficient flour with no partial reward',{coinFull,coinBefore:exactBefore,flourFull,flourBefore,actualRestartAfterMarkedFixture:true});await closeTowerViaRenderer(win,'capacity mode close');
}
async function testBlockedMode(win:BrowserWindowType):Promise<void>{
 assert.equal(shell!.game.state.status,'blocked');assert.ok(shell!.game.state.error);await until(()=>js<boolean>(win,'document.body.dataset.towerReady==="true"&&document.getElementById("towerState").hidden===false'),'actual blocked Worker shown in tower recovery state');
 const blocked=await js<any>(win,'(()=>({title:document.getElementById("towerStateTitle").textContent,text:document.getElementById("towerStateText").textContent,retry:{disabled:document.getElementById("towerRetry").disabled,label:document.getElementById("towerRetry").getAttribute("aria-label")},ready:document.body.dataset.towerReady}))()');assert.match(blocked.title,/不可用|读取/);assert.equal(blocked.retry.disabled,false);
 await clickAt(win,'#towerRetry');await new Promise(resolve=>setTimeout(resolve,100));assert.equal(shell!.game.state.status,'blocked');assert.equal(await visible(win,'#towerState'),true,'retry against real blocked Worker keeps truthful recovery state');
 const recover=fixture!;await replaceWithMarkedFixture(recover,'blocked-profile recovery',false);
 await clickAt(tower(),'#towerRetry');await until(()=>js<boolean>(tower(),'document.getElementById("towerState").hidden===true&&document.getElementById("towerDetail").dataset.floor==="1"'),'tower Retry reads the restarted ready GameWorker');
 assert.equal(shell!.game.state.status,'ready');assert.equal(profile().coins,20);assert.equal(Object.hasOwn(profile(),'tower'),false);
 record('real blocked profile is recoverable after marker-preserving file repair and actual Worker restart',{blocked,recoveryProfile:{version:profile().version,sequence:profile().sequence,coins:profile().coins},towerReady:await visible(tower(),'#towerUi'),loadingState:'See actual loading capture before first real IPC response; after release the real Worker state renders.'});
 await closeTowerViaRenderer(tower(),'blocked mode final close');
}
async function testCompleteMode(win:BrowserWindowType):Promise<void>{
 assert.equal(profile().tower?.claimed,20,'complete mode is a validated isolated display fixture loaded by actual GameWorker');await setViewport(win,760,650);await auditTowerFit(win,760,650,'complete 760×650 last unclaimed/complete display');
 const summary=await js<any>(win,'(()=>({claimed:document.getElementById("towerClaimed").textContent,total:document.querySelector(".t-summary").textContent,next:document.getElementById("towerNext").textContent,nextLabel:document.getElementById("towerNext").getAttribute("aria-label"),nextHidden:document.getElementById("towerNext").hidden,nextDisabled:document.getElementById("towerNext").disabled,continueDisabled:document.getElementById("towerContinue").disabled,claimHidden:document.getElementById("towerClaim").hidden,selected:document.getElementById("towerDetail").dataset.floor}))()');
 assert.equal(summary.claimed,'20');assert.equal(summary.nextDisabled,true);assert.equal(summary.nextHidden,false);assert.match(summary.next,/星灯全部点亮/);assert.match(summary.nextLabel,/全部点亮/);assert.equal(summary.continueDisabled,true);assert.equal(summary.claimHidden,true);assert.equal(summary.selected,'20');
 await auditTwentyFloorNavigation(win,760,650,'complete 760x650');await auditTwentyFloorNavigation(win,1040,720,'complete 1040x720');await setViewport(win,1040,720);await auditTowerFit(win,1040,720,'complete 1040×720 display');await capture(win,'all-20-floors-complete-1040x720');
 record('all-complete 20/20 presentation state from explicit display fixture',{summary,fixtureKind:'schema-validated marked test profile, actual restarted GameWorker; synthetic completed history does not prove gameplay completion'});await clearViewports();await closeTowerViaRenderer(win,'complete fixture final close');
}
async function testRewardsMode(win:BrowserWindowType):Promise<void>{
 const start=profile();assert.equal(Object.hasOwn(start,'tower'),false,'achieved-history fixture has no pre-seeded tower extension');assert.equal(start.coins,200);assert.equal(start.totals.earned,100);
 assert.deepEqual(towerView(start).floors.map(f=>f.progress),towerFloors.map(f=>f.required),'actual Worker sees every historical goal as met before tower initialization');
 assert.deepEqual(actualTowerRewardTally,{coins:0,flour:0,ore:0,biscuit:0},'reward tally starts before the first Tower IPC');
 await setViewport(win,760,650);await auditTowerFit(win,760,650,'rewards mode first actual ready claim');await capture(win,'achieved-history-first-ready-floor-before-claim');
 for(const floor of towerFloors){
  const before=profile();assert.equal(before.tower?.claimed??0,floor.id-1,'only the preceding prefix is claimed before floor '+floor.id);
  const view=towerView(before).floors[floor.id-1];assert.equal(view.status,'ready','historically achieved floor '+floor.id+' becomes claimable exactly at the sequential cursor');
  const after=await claimFromVisibleUI(win,floor.id);assert.equal(after.tower?.claimed,floor.id,'actual Tower renderer claim advances cursor to '+floor.id);
  assert.equal(after.totals.earned,100,'Tower coins remain excluded from the synthetic earned-income history');
 }
 assert.deepEqual(actualTowerRewardTally,{coins:188,flour:4,ore:6,biscuit:3},'twenty actual renderer claims award exactly the planned total once');
 const completed=profile();assert.equal(completed.tower?.claimed,20);assert.equal(completed.sequence,start.sequence+20,'exactly twenty new Worker actions were committed');assert.equal(completed.coins,start.coins+188);assert.equal(completed.bag.flour,start.bag.flour+4);assert.equal(completed.leisure.materials.ore,start.leisure.materials.ore+6);assert.equal(completed.leisure.materials.biscuit,start.leisure.materials.biscuit+3);assert.equal(completed.totals.earned,start.totals.earned);
 const duplicateBefore={sequence:completed.sequence,coins:completed.coins,bag:structuredClone(completed.bag),materials:structuredClone(completed.leisure.materials),tower:structuredClone(completed.tower),earned:completed.totals.earned};
 assert.ok(completed.receipt&&completed.receipt.sequence===completed.sequence,'floor 20 receipt is the current persisted Worker receipt');
 const exact=await actualTowerIPC({type:'tower-action',envelope:{sequence:completed.receipt.sequence,requestId:completed.receipt.requestId,action:{type:'tower-claim',floor:20}}});assert.equal(exact.ok,true,'retrying the exact final Tower receipt remains idempotent');
 assert.deepEqual({sequence:profile().sequence,coins:profile().coins,bag:profile().bag,materials:profile().leisure.materials,tower:profile().tower,earned:profile().totals.earned},duplicateBefore,'exact receipt retry changes no reward or cursor');
 const duplicate=await actualTowerIPC({type:'tower-action',envelope:envelope({type:'tower-claim',floor:20},profile().sequence+1)});assert.equal(duplicate.ok,false,'a new request cannot claim floor 20 twice');assert.match(duplicate.error,/奖励已领取/);assert.deepEqual({sequence:profile().sequence,coins:profile().coins,bag:profile().bag,materials:profile().leisure.materials,tower:profile().tower,earned:profile().totals.earned},duplicateBefore,'new duplicate rejection is atomic');
 const finish=await js<any>(win,'(()=>({selected:document.getElementById("towerDetail").dataset.floor,claimed:document.getElementById("towerClaimed").textContent,nextHidden:document.getElementById("towerNext").hidden,nextDisabled:document.getElementById("towerNext").disabled,nextText:document.getElementById("towerNext").textContent,claimHidden:document.getElementById("towerClaim").hidden,scroll:document.scrollingElement?.scrollTop??0}))()');
 assert.equal(finish.selected,'20');assert.equal(finish.claimed,'20');assert.equal(finish.nextHidden,false);assert.equal(finish.nextDisabled,true);assert.match(finish.nextText,/星灯全部点亮/);assert.equal(finish.claimHidden,true);assert.equal(finish.scroll,0);
 record('synthetic achieved-history fixture produced twenty actual sequential Tower renderer IPC claims',{fixtureKind:'schema-valid, parseProfile/GameStore-validated history matching core veteran achievement counters; no tower extension seeded; not a claim of real gameplay completion',initial:{coins:start.coins,earned:start.totals.earned,sequence:start.sequence,tower:null},final:{coins:completed.coins,earned:completed.totals.earned,sequence:completed.sequence,claimed:completed.tower?.claimed,bag:completed.bag,materials:completed.leisure.materials},towerRewardTally:{...actualTowerRewardTally},exactReceiptRetry:exact,newDuplicate:duplicate,completeView:finish});await capture(win,'all-twenty-real-claims-final-budget-760x650');
 await closeTowerViaRenderer(win,'rewards mode close before Worker restart');await verifyTowerPersistenceAndRestart('all twenty actual tower rewards');
 const persisted=profile();assert.equal(persisted.tower?.claimed,20);assert.equal(persisted.coins,start.coins+188);assert.equal(persisted.bag.flour,start.bag.flour+4);assert.equal(persisted.leisure.materials.ore,start.leisure.materials.ore+6);assert.equal(persisted.leisure.materials.biscuit,start.leisure.materials.biscuit+3);assert.equal(persisted.totals.earned,100);
 win=await openOrReopenTower();const reopened=await js<any>(win,'(()=>({selected:document.getElementById("towerDetail").dataset.floor,claimed:document.getElementById("towerClaimed").textContent,claimHidden:document.getElementById("towerClaim").hidden,nextDisabled:document.getElementById("towerNext").disabled,nextText:document.getElementById("towerNext").textContent,scroll:document.scrollingElement?.scrollTop??0}))()');
 assert.deepEqual(reopened,{selected:'20',claimed:'20',claimHidden:true,nextDisabled:true,nextText:reopened.nextText,scroll:0});assert.match(reopened.nextText,/星灯全部点亮/);
 record('twenty actual reward receipts persist across isolated profile flush, real Worker restart and Tower reopen',{persisted:{sequence:persisted.sequence,coins:persisted.coins,earned:persisted.totals.earned,tower:persisted.tower,bag:persisted.bag,materials:persisted.leisure.materials},reopened});await capture(win,'all-twenty-persisted-after-worker-restart');await closeTowerViaRenderer(win,'rewards mode final close');
}
async function auditBoundaries():Promise<void>{
 assert.equal(suppression.globalShortcut??0,0,'no globalShortcut API was attempted');assert.equal(suppression.dialogCalls??0,0,'no native dialog was attempted');
 const marker=path.join(profileRoot,'.pixelstreet-isolated-profile.json');assert.ok(fs.existsSync(marker));assert.match(fs.readFileSync(marker,'utf8'),/isolated-playtest/);
 const keys:Array<Record<string,unknown>>=[];for(const win of BrowserWindow.getAllWindows()){
  if(win.isDestroyed())continue;
  let url='';try{url=win.webContents.getURL();}catch{}
  if(!url){const item={id:win.id,page:page(win),probe:null,reason:'Electron window has no loaded renderer URL; no renderer can receive keyboard events'};keys.push(item);record('keyboard probe not applicable to an empty native window',item,'INFO');continue;}
  try{const probe=await js<any>(win,'window.__tower0130KeyProbe||null');keys.push({id:win.id,page:page(win),url,probe});if(probe)assert.equal(probe.count,0,'test dispatched no keyboard events into renderer '+win.id);else throw Error('loaded renderer key probe was not installed');}
  catch(error){harnessIssues.push('read key boundary '+win.id+': '+String(error));}
 }
 await shell?.game.request('flush').catch(error=>harnessIssues.push('final worker flush: '+String(error)));
 if(fixtureMode!=='blocked'||shell?.game.state.status==='ready')assert.deepEqual(profile(),new GameStore(soloFolder).value,'only the marked isolated GameWorker profile is persisted');
 for(const row of snapshots()){assert.equal(row.visible,false,'native window still hidden '+JSON.stringify(row));assert.equal(row.focused,false,'native window still unfocused '+JSON.stringify(row));}
 assert.deepEqual(errors,[],'renderer console errors: '+errors.join('; '));assert.deepEqual(harnessIssues,[],'harness issues: '+harnessIssues.join('; '));
 const end=productHashes();assert.deepEqual(end,productHashesAtStart,'candidate source/runtime product inventory unchanged through final acceptance');assert.deepEqual(end,candidateManifest?.hashes,'end bytes still match root final manifest');assert.equal(canonicalInventory(end),candidateManifest?.canonicalInventorySha256);
 record('final renderer/key/focus/profile/product integrity boundaries',{nativeWindows:snapshots(),keyEvents:keys,globalShortcut:suppression.globalShortcut??0,nativeDialogCalls:suppression.dialogCalls??0,marker,profileRoot,profileFile,productFiles:Object.keys(end).length,canonicalInventorySha256:canonicalInventory(end),productUnchanged:true,screenEvidence:'capturePage only; no visible screen'});
}
function report(rawError?:unknown):void{
 fs.mkdirSync(evidenceDir,{recursive:true,mode:0o700});let end:Record<string,string>={};try{if(productScopes.length)end=productHashes();}catch(error){harnessIssues.push('end product inventory: '+String(error));}
 let profileFinal:unknown=null;try{const p=profile();profileFinal={version:p.version,sequence:p.sequence,coins:p.coins,job:p.job,tick:p.tick,tower:p.tower??null,totals:p.totals,leisure:{rooms:p.leisure.rooms,clears:p.leisure.clears,xp:p.xp}};}catch{}
 const harnessFiles=['tests/native-tower-0130-luna.ts','tests/native-tower-0130-luna-bootstrap.cjs','dist/native-tower-0130-luna.cjs'];
 const fixtureNature=fixtureMode==='rewards'?'schema-valid synthetic achieved-history counters with no tower extension, used for twenty actual renderer-to-Worker reward claims; not real gameplay completion':fixtureMode==='complete'?'schema-valid synthetic completion state for UI display only':fixtureMode==='veteran'?'legal solo-core historical actions without tower extension':fixtureMode==='blocked'?'intentionally damaged private profile, then real Worker recovery':fixtureMode==='caps'?'isolated capacity boundary states, each followed by real Worker restart':'new 20-coin profile with legal gameplay actions';
 const out={schema:'pixelstreet.tower-0130.luna-max.hidden-native.v1',runId,status,at:new Date().toISOString(),identity:{name:APP_NAME,version:APP_VERSION,profileName:PROFILE_NAME,expectedVersion:EXPECTED_VERSION},fixtureMode,fixtureNature,profileRoot,profileFile,profileMarker:path.join(profileRoot,'.pixelstreet-isolated-profile.json'),fixturePreflight:fixture?{version:fixture.version,sequence:fixture.sequence,coins:fixture.coins,job:fixture.job,hasTower:Object.hasOwn(fixture,'tower'),bag:fixture.bag}:null,profileFinal,manifestPath,manifest:candidateManifest??null,productScopes,productExclusions:['dist/tests/**','dist/native-*.cjs'],productFileCount:Object.keys(productHashesAtStart).length,canonicalInventorySha256AtStart:inventoryAtStart,canonicalInventorySha256AtEnd:end?canonicalInventory(end):null,productHashesAtStart,productHashesAtEnd:end,productUnchanged:JSON.stringify(productHashesAtStart)===JSON.stringify(end),checks,errors,harnessIssues,screenshots,nativeWindows:snapshots(),suppression,rawError:rawError?String(rawError):undefined,stack:rawError instanceof Error?rawError.stack:undefined,harnessHashes:Object.fromEntries(harnessFiles.filter(file=>fs.existsSync(path.join(root,file))).map(file=>[file,createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')])),evidenceBoundary:{runtime:'Real Electron main process, DesktopShell, BrowserWindows, tower/shop/overlay renderer pages, preload IPC and GameWorker; no browser preview.',native:'Before importing this runner, bootstrap prohibits macOS activation where applicable and intercepts app.activate/focus, BrowserWindow show/showInactive/focus/moveTop/restore, webContents.focus, Dock activation, Tray construction, native dialogs and globalShortcut. isVisible/isFocused sampled from Electron APIs.',input:'Software Chromium CDP pointer events at measured elementFromPoint centers. No physical pointer, keyboard or IME events were used; renderer key probes stayed at zero.',profile:'New marked /private/tmp profile per run; only its profile.json was opened. Legacy/capacity/blocked fixture replacement is followed by a schema parser check and an actual GameWorker restart. No installed or prior profile path is read.',screenshots:'Electron capturePage with software CDP CSS viewports 760×650 and 1040×720; screenshots show renderer pixels while all native windows stay hidden/unfocused, not physical display evidence.',time:'GameWorker testMode advance uses virtual testOffset and does not assert real time. workingElsewhere is a synthetic app lifecycle event, not a real app switch.',fixtures:'rewards mode uses a schema-valid synthetic achieved-history profile with no tower extension, followed by twenty actual Tower renderer claims handled by the real Worker; it does not prove gameplay completion. complete mode is a separate synthetic completion display fixture. Blocked mode preserves corrupt isolated bytes. Raw RED reports are never overwritten.'}};
 fs.writeFileSync(reportPath,JSON.stringify(out,null,2)+'\n',{flag:'wx',mode:0o600});fs.appendFileSync(progressPath,JSON.stringify({at:new Date().toISOString(),finalReport:reportPath,status,errors})+'\n',{mode:0o600});
}
async function main():Promise<void>{
 let rawError:unknown;
 try{
  await initializeProfile();const win=await launchAndOpenTower();
  if(fixtureMode==='fresh')await testFreshMode(win);
  else if(fixtureMode==='veteran')await testVeteranMode(win);
  else if(fixtureMode==='caps')await testCapacityMode(win);
  else if(fixtureMode==='blocked')await testBlockedMode(win);
  else if(fixtureMode==='complete')await testCompleteMode(win);
  else await testRewardsMode(win);
  await auditBoundaries();status='PASS';record('independent 0.13.0 achievement tower Luna max hidden-native attempt PASS',{fixtureMode,checks:checks.length,screenshots:screenshots.length,productFiles:Object.keys(productHashesAtStart).length,canonicalInventorySha256:inventoryAtStart,profileRoot,actualDesktopShell:true,actualGameWorker:true,actualTowerIPC:true});
 }catch(error){rawError=error;status='FAIL';errors.push(String(error));checks.push({name:'raw independent hidden-native achievement tower acceptance attempt',status:'FAIL',detail:{error:String(error),stack:error instanceof Error?error.stack:undefined}});process.exitCode=1;console.error(error instanceof Error?error.stack:String(error));}
 finally{
  releaseTowerLoading();
  try{if(shell?.game.state.status==='ready')await shell.game.request('flush');}catch(error){harnessIssues.push('final isolated GameWorker flush: '+String(error));}
  await clearViewports();try{report(rawError);}catch(error){console.error('report write failed: '+String(error));}
  app.exit(status==='FAIL'?1:0);
 }
}
void main();
