import {app, BrowserWindow, Menu, type BrowserWindow as BrowserWindowType} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {startDesktop} from '../apps/desktop/bootstrap';
import {GameStore} from '../apps/desktop/game-store';
import {markIsolatedFolder} from '../apps/desktop/launch-profile';
import {APP_NAME, APP_VERSION, PROFILE_NAME} from '../apps/desktop/identity';
import {
  BUDDY_ORDER, CAMP_LEVELS, COMPANIONS, FOODS, GOOD_IDS, FORMULAS, PATHS,
  TRAINING, initialBonds, initialCamp, initialProfile, parseProfile,
  type Buddy, type CampJob, type Food, type Profile, type TrainingPath,
} from '../packages/solo-core';

type Result={name:string;status:'PASS'|'FAIL'|'INFO';detail?:unknown};
type NativeTrace={id:number;page:string|null;visible:()=>boolean;focused:()=>boolean;last:{isVisible:boolean;isFocused:boolean}};
type Control={id:string;exists:boolean;hidden:boolean;disabled:boolean;label:string;tip:string;cursor:string;font:number;gameButton:boolean;reachable:boolean;rect:{x:number;y:number;width:number;height:number};container:{scrollWidth:number;clientWidth:number;scrollHeight:number;clientHeight:number}};

const root=process.cwd();
const evidenceDir=path.join(root,'work/inner-0110/native-bonds-luna');
const runId=new Date().toISOString().replace(/[:.]/g,'-')+'-'+process.pid;
const profileRoot=fs.mkdtempSync('/private/tmp/pixelstreet-inner0110-bonds-luna-');
const soloFolder=path.join(profileRoot,'solo');
const reportPath=path.join(evidenceDir,'native-inner-bonds-0110-'+runId+'.json');
const checks:Result[]=[];
const failures:Array<{phase:string;error:string;stack?:string}>=[];
const rendererErrors:string[]=[];
const cspViolations:Array<{windowId:number;directive:string;blocked:string;sample:string}>=[];
const keyboardByWindow:Record<number,number>={};
const traces=new Map<number,NativeTrace>();
const suppression=(globalThis as any).__pixelStreetInnerBonds0110Suppression??{};
let shell:Awaited<ReturnType<typeof startDesktop>>|undefined;
let profileBefore:Profile|undefined;
let status:'RUNNING'|'PASS'|'FAIL'='RUNNING';
let activeWin:BrowserWindowType|undefined;
let reportWritten=false;

function walk(dir:string):string[]{
  if(!fs.existsSync(dir))return[];
  return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>{const file=path.join(dir,e.name);return e.isDirectory()?walk(file):[path.relative(root,file)];});
}
function productHashes():Record<string,string>{
  const files=[...walk(path.join(root,'apps/desktop')),...walk(path.join(root,'packages/solo-core')),...walk(path.join(root,'packages/protocol')),...walk(path.join(root,'packages/content')),...walk(path.join(root,'assets')),...walk(path.join(root,'dist'))];
  const keep=[...new Set(files)].filter(f=>!/^dist\/(?:tests\/|native-.*\.cjs$)/.test(f)&&fs.existsSync(path.join(root,f))).sort();
  return Object.fromEntries(keep.map(f=>[f,createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex')]));
}
const productHashesAtStart=productHashes();
function page(win:BrowserWindowType):string|null{try{return new URL(win.webContents.getURL()).searchParams.get('page');}catch{return null;}}
function snapshots():Array<Record<string,unknown>>{
  return [...traces.values()].map(t=>{try{t.last={isVisible:t.visible(),isFocused:t.focused()};return{id:t.id,page:t.page,...t.last};}catch(e){return{id:t.id,page:t.page,...t.last,destroyed:true,error:String(e)};}});
}
function writeReport(error?:unknown):void{
  if(reportWritten)return;
  fs.mkdirSync(evidenceDir,{recursive:true,mode:0o700});
  const report={schema:'pixelstreet.inner-0110.bonds-camp-life.luna-max.hidden-native.v1',runId,status,at:new Date().toISOString(),
    app:{name:APP_NAME,version:APP_VERSION,profileName:PROFILE_NAME},platform:process.platform,arch:process.arch,electron:process.versions.electron,
    profileRoot,profileFile:path.join(soloFolder,'profile.json'),preflight:profileBefore?{version:profileBefore.version,sequence:profileBefore.sequence,wallAt:profileBefore.wallAt,job:profileBefore.job,coins:profileBefore.coins,xp:profileBefore.xp,allNineOwned:BUDDY_ORDER.every(id=>profileBefore!.leisure.companions[id]!==null),campPresent:Object.hasOwn(profileBefore,'camp'),bondsPresent:Object.hasOwn(profileBefore.leisure,'bonds')}:null,
    checks,failures,rendererErrors,cspViolations,suppression,nativeWindows:snapshots(),keyboardByWindow,
    coverage:{bonds:['all nine companion portraits and local company/training/story tabs','three routes, all three training ranks, missing-route and missing-level gates','three story rewards and each saved story page','leader/support mutual exclusion and affection feed','all 15 curiosity focus states, three equipment slots, two upgrade ranks and active set','all three letter reward choices'],campLife:['growth XP, seven gifts and three buildings through all levels','four station overview repeat/available operations and shared till collection','five recipe selectors, actual material display, cook and cancel for each recipe','supply/alchemy product, count and reserve selectors with finite plan start/stop','three workplace scene cards, visible companion picker, hidden select reflection, assign/rest and conflict reason','three distinct crew preset saves and loads plus actual last-route redepart'],layout:['captured hidden renderer screens at 760 and 1040 CSS pixels','visible button tooltips, disabled reasons, cursor, font size, hit target, page overflow and repeated DOM identity']},
    candidate:{fileCount:Object.keys(productHashesAtStart).length,sha256AtStart:productHashesAtStart,sha256AtEnd:status==='RUNNING'?undefined:productHashes(),unchanged:status!=='RUNNING'&&JSON.stringify(productHashesAtStart)===JSON.stringify(productHashes())},
    rawError:error?String(error):undefined,stack:error instanceof Error?error.stack:undefined,
    evidenceBoundary:{runtime:'Real Electron main process, DesktopShell, IPC bridge, preload, renderer and GameWorker; all gameplay state was read from shell.game.state.profile after renderer intent delivery.',native:'macOS activation policy prohibited; app/window/webContents focus and all show/restore/moveTop methods intercepted before shell construction. isVisible and isFocused sampled through original Electron methods and required false.',input:'Only coordinate-derived software PointerEvent/MouseEvent sequences and the UI click handlers were used. No physical mouse or keyboard event is claimed; key listeners observed zero events.',profile:'A new /private/tmp profile was marked and parsed before startDesktop. No installed-app data path or real progress was opened.',screenshots:'Hidden Electron renderer pixels at requested CSS viewport sizes; not a visible-screen or physical-device claim.',clock:'No test-clock advance was used; ordinary worker time may elapse during the run.',integrity:'SHA-256 inventories cover application source, core/protocol/content, assets and dist runtime. Dedicated test bundle is excluded.'}};
  fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
  reportWritten=true;
}
function record(name:string,detail?:unknown,result:'PASS'|'FAIL'|'INFO'='PASS'):void{
  checks.push({name,status:result,detail});
  fs.mkdirSync(evidenceDir,{recursive:true,mode:0o700});
  fs.appendFileSync(path.join(evidenceDir,'progress-'+runId+'.jsonl'),JSON.stringify({at:new Date().toISOString(),name,status:result,detail})+'\n',{flag:'a',mode:0o600});
}
async function phase(name:string,fn:()=>Promise<void>):Promise<void>{
  try{await fn();record('phase completed: '+name,{ok:true});}
  catch(error){const e=error instanceof Error?error:new Error(String(error));failures.push({phase:name,error:e.message,stack:e.stack});record('phase raw failure: '+name,{error:e.message,stack:e.stack},'FAIL');}
}
async function until(fn:()=>Promise<boolean>|boolean,label:string,timeout=25000):Promise<void>{
  const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,35));}throw new Error('timeout: '+label);
}
async function js<T=unknown>(win:BrowserWindowType,source:string):Promise<T>{return await win.webContents.executeJavaScript(source) as T;}
function currentProfile():Profile{const p=shell?.game.state.profile;if(!p)throw new Error('profile unavailable: '+(shell?.game.state.error||'not loaded'));return p;}
function replace(target:any,key:string,value:unknown):void{const d=Object.getOwnPropertyDescriptor(target,key);if(d&&!d.configurable&&!d.writable)throw new Error('cannot intercept Electron '+String(key));Object.defineProperty(target,key,{configurable:true,enumerable:d?.enumerable??true,writable:true,value});}
function track(win:BrowserWindowType):void{
  if(traces.has(win.id))return;
  const visible=win.isVisible.bind(win),focused=win.isFocused.bind(win);
  traces.set(win.id,{id:win.id,page:page(win),visible,focused,last:{isVisible:visible(),isFocused:focused()}});keyboardByWindow[win.id]=0;
  win.webContents.on('console-message',(event:any)=>{if(event.level==='error')rendererErrors.push(String(event.message).slice(0,800));});
  win.webContents.on('did-finish-load',()=>{const t=traces.get(win.id);if(t)t.page=page(win);});
}
function attachInstrument(win:BrowserWindowType):Promise<void>{
  return js(win,'(()=>{if(window.__inner0110Audit)return true;window.__inner0110Audit={keys:0,csp:[]};for(const t of ["keydown","keyup","keypress"])document.addEventListener(t,()=>window.__inner0110Audit.keys++,true);document.addEventListener("securitypolicyviolation",e=>window.__inner0110Audit.csp.push({directive:e.violatedDirective,blocked:e.blockedURI,sample:e.sample}),true);return true})()').then(()=>undefined);
}
async function profileReady():Promise<void>{await until(()=>shell?.game.state.status==='ready'&&shell.game.state.profile?.version===8,'GameWorker schema-8 profile');}
function casual():BrowserWindowType{const win=shell?.arenaWindow;assert.ok(win&&!win.isDestroyed(),'casual window missing');return win;}
async function ready(win:BrowserWindowType):Promise<void>{await until(()=>!win.isDestroyed()&&js<boolean>(win,'document.body.dataset.casualReady==="true"?document.getElementById("casualUi")?.dataset.busy==="false":document.body.dataset.atlas==="verified"&&!!document.getElementById("dungeonSign")'),'desktop renderer ready');}
async function control(win:BrowserWindowType,id:string):Promise<Control>{
  return js(win,'(()=>{const id='+JSON.stringify(id)+',e=document.getElementById(id),hidden=!e||e.hidden||!!e.closest("[hidden]")||getComputedStyle(e).display==="none",c=e?.closest("#cContent")||document.documentElement;if(e&&!hidden){e.scrollIntoView({block:"nearest",inline:"nearest"});if(e.closest("#cContent")){for(let i=0;i<10;i++){const r=e.getBoundingClientRect(),cr=c.getBoundingClientRect(),top=Math.max(0,cr.top),bottom=Math.min(innerHeight,cr.bottom),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);if(r.top>=top+2&&r.bottom<=bottom-2&&hit?.closest("button")===e)break;const delta=r.bottom>bottom-2?r.bottom-(bottom-2):r.top<top+2?r.top-(top+2):0;c.scrollTop+=delta||32;}}}const r=e?.getBoundingClientRect(),cr=c.getBoundingClientRect(),s=e?getComputedStyle(e):null,hit=r?document.elementFromPoint(r.left+r.width/2,r.top+r.height/2):null,clip={left:Math.max(0,cr.left),right:Math.min(innerWidth,cr.right),top:Math.max(0,cr.top),bottom:Math.min(innerHeight,cr.bottom)};return{id,exists:!!e,hidden,disabled:!e||e.disabled,label:e?.getAttribute("aria-label")||e?.textContent?.trim()||"",tip:e?.dataset.tooltip||e?.title||"",cursor:s?.cursor||"",font:s?parseFloat(s.fontSize):0,gameButton:!!e?.classList.contains("game-button"),reachable:!hidden&&!!r&&r.width>0&&r.height>0&&r.left>=clip.left-1&&r.right<=clip.right+1&&r.top>=clip.top-1&&r.bottom<=clip.bottom+1&&hit?.closest("button")===e,rect:r?{x:r.x,y:r.y,width:r.width,height:r.height}:{x:0,y:0,width:0,height:0},container:{scrollWidth:c.scrollWidth,clientWidth:c.clientWidth,scrollHeight:c.scrollHeight,clientHeight:c.clientHeight,scrollTop:c.scrollTop}}})()') as Promise<Control>;
}
async function assertControl(win:BrowserWindowType,id:string,enabled?:boolean,minFont=16):Promise<Control>{
  const s=await control(win,id);assert.ok(s.exists&&!s.hidden,id+' missing/hidden: '+JSON.stringify(s));
  if(enabled!==undefined)assert.equal(s.disabled,!enabled,id+' disabled state: '+JSON.stringify(s));
  assert.ok(s.gameButton,id+' is not GameButton');assert.ok(s.tip.trim(),id+' has no tooltip / disabled reason');
  assert.ok(s.font>=minFont,id+' font below '+minFont+'px: '+s.font);assert.equal(s.cursor,s.disabled?'not-allowed':'pointer',id+' cursor disagrees with state');
  if(!s.disabled)assert.ok(s.reachable,id+' cannot be hit inside its scroll viewport: '+JSON.stringify(s));
  return s;
}
async function click(win:BrowserWindowType,id:string,minFont=16):Promise<Control>{
  await ready(win);const raw=await control(win,id);if(raw.disabled)record('unexpected disabled state before enabled-action input '+id,{control:raw,cooking:currentProfile().camp?.cooking,sequence:currentProfile().sequence},'INFO');const s=await assertControl(win,id,true,minFont);
  const hit=await js<{ok:boolean;x:number;y:number;hitTag:string;hitId:string|null;buttonId:string|null}>(win,'(()=>{const e=document.getElementById('+JSON.stringify(id)+'),r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,h=document.elementFromPoint(x,y);if(h?.closest("button")!==e)return{ok:false,x,y,hitTag:h?.tagName||"",hitId:h?.id||null,buttonId:h?.closest("button")?.id||null};const common={bubbles:true,cancelable:true,view:window,clientX:x,clientY:y,button:0};h.dispatchEvent(new PointerEvent("pointerdown",{...common,pointerId:1,pointerType:"mouse",isPrimary:true}));h.dispatchEvent(new MouseEvent("mousedown",common));h.dispatchEvent(new PointerEvent("pointerup",{...common,pointerId:1,pointerType:"mouse",isPrimary:true}));h.dispatchEvent(new MouseEvent("mouseup",common));h.dispatchEvent(new MouseEvent("click",common));return{ok:true,x,y,hitTag:h.tagName,hitId:h.id||null,buttonId:e.id}})()');
  assert.ok(hit.ok,id+' hit target mismatch: '+JSON.stringify(hit));record('software coordinate input '+id,{label:s.label,tip:s.tip,rect:s.rect,hit,input:'PointerEvent/MouseEvent dispatched at actual elementFromPoint target; software-only'});await new Promise(r=>setTimeout(r,50));return s;
}
async function action(win:BrowserWindowType,id:string):Promise<Profile>{
  const before=currentProfile().sequence;const s=await click(win,id);await until(()=>currentProfile().sequence===before+1,'GameWorker IPC receipt for '+id);await ready(win);const p=currentProfile();record('authoritative GameWorker action '+id,{sequenceBefore:before,sequenceAfter:p.sequence,label:s.label,tooltip:s.tip,notice:p.notice,profileFields:{coins:p.coins,xp:p.xp,active:p.leisure.active,run:!!p.leisure.run}});return p;
}
async function disabled(win:BrowserWindowType,id:string,reason?:RegExp):Promise<Control>{const s=await assertControl(win,id,false);if(reason)assert.match(s.tip,reason,id+' expected disabled reason '+reason+'; actual: '+s.tip);record('visible disabled control '+id,{tip:s.tip,label:s.label});return s;}
async function localSelection(win:BrowserWindowType,id:string,checkResult:()=>Promise<boolean>,label:string):Promise<void>{const seq=currentProfile().sequence;await click(win,id);await until(checkResult,label);assert.equal(currentProfile().sequence,seq,'selection should not submit a GameWorker action');}
async function selectCasualTab(win:BrowserWindowType,name:string):Promise<void>{await click(win,'cTab-'+name);await until(()=>js<boolean>(win,'document.getElementById('+JSON.stringify('cTab-'+name)+')?.getAttribute("aria-selected")==="true"&&!document.getElementById('+JSON.stringify('cPanel-'+name)+')?.hidden'),'casual tab '+name);}
async function selectLifeTab(win:BrowserWindowType,name:string):Promise<void>{await click(win,'lifeTab-'+name);await until(()=>js<boolean>(win,'!document.getElementById('+JSON.stringify('lifePanel-'+name)+').hidden'),'camp life tab '+name);}
async function selectBuddyPath(win:BrowserWindowType,buddy:Buddy,id:TrainingPath):Promise<void>{const p=await action(win,'cBuddyPath-'+id);assert.equal(p.leisure.bonds!.progress[buddy].path,id,'selected training path persists through Worker');}
async function openFromScene(win:BrowserWindowType,id:string,panel:string,tab?:string):Promise<void>{
  const home=await js<boolean>(win,'!document.getElementById("cCampHome").hidden&&document.getElementById("cCampWorkspace").hidden');assert.ok(home,'expected interactive camp scene before entering '+panel);
  await click(win,id);await until(()=>js<boolean>(win,'document.getElementById("cCampHome").hidden&&!document.getElementById("cCampWorkspace").hidden&&!!document.getElementById('+JSON.stringify(panel)+')&&!document.getElementById('+JSON.stringify(panel)+').hidden'),'scene entrance '+id+' -> '+panel);
  if(tab)await until(()=>js<boolean>(win,'document.getElementById('+JSON.stringify('cTab-'+tab)+')?.getAttribute("aria-selected")==="true"'),'scene tab '+tab);
}
async function backToScene(win:BrowserWindowType):Promise<void>{
  assert.equal(await js<boolean>(win,'!document.getElementById("cCampWorkspace").hidden'),true,'workspace should be open before return');
  await click(win,'cCampBack');await until(()=>js<boolean>(win,'!document.getElementById("cCampHome").hidden&&document.getElementById("cCampWorkspace").hidden'),'return to camp scene');
  assert.equal(win.isVisible(),false);assert.equal(win.isFocused(),false);
}
async function auditPanel(win:BrowserWindowType,selector:string,label:string):Promise<void>{
  const result=await js<{width:number;pageWidth:number;scrollWidth:number;clientWidth:number;duplicates:string[];ids:string[]}>(win,'(()=>{const root=document.documentElement,ids=[...document.querySelectorAll("[id]")].map(e=>e.id),scope=document.querySelector('+JSON.stringify(selector)+'),r=scope?.getBoundingClientRect();return{width:innerWidth,pageWidth:root.scrollWidth,scrollWidth:scope?.scrollWidth||0,clientWidth:scope?.clientWidth||0,duplicates:[...new Set(ids.filter((x,i)=>ids.indexOf(x)!==i))],ids:[...scope?.querySelectorAll("button[id]")||[]].map(e=>e.id),rect:r?{left:r.left,right:r.right,width:r.width}:null}})()');
  assert.ok(result.pageWidth<=result.width+1,label+' horizontal page overflow '+JSON.stringify(result));assert.deepEqual(result.duplicates,[],label+' duplicate DOM ids');
  const rows:Control[]=[];for(const id of result.ids){const s=await control(win,id);if(s.hidden)continue;const checked=await assertControl(win,id);rows.push(checked);}
  record('visible controls audited '+label,{width:result.width,pageWidth:result.pageWidth,visibleButtons:rows.length,totalButtonIds:result.ids.length,disabled:rows.filter(x=>x.disabled).map(x=>({id:x.id,tip:x.tip})),allGameButtons:rows.every(x=>x.gameButton),minimumButtonFont:Math.min(...rows.map(x=>x.font)),noOverflow:true});
}
async function capture(win:BrowserWindowType,label:string,width:number,height:number):Promise<void>{
  await ready(win);await new Promise(r=>setTimeout(r,180));const view=await js<{width:number;height:number;pageWidth:number;scrollWidth:number;clientWidth:number}>(win,'({width:innerWidth,height:innerHeight,pageWidth:document.documentElement.scrollWidth,scrollWidth:document.getElementById("cContent").scrollWidth,clientWidth:document.getElementById("cContent").clientWidth})');
  assert.equal(view.width,width,label+' viewport width');assert.ok(view.pageWidth<=width+1,label+' viewport overflow');
  const image=await win.webContents.capturePage(),size=image.getSize(),png=image.toPNG();assert.ok(png.length>8000,label+' empty capture');const file=path.join(evidenceDir,'screen-'+runId+'-'+width+'-'+label+'.png');fs.writeFileSync(file,png,{flag:'wx',mode:0o600});
  assert.equal(win.isVisible(),false);assert.equal(win.isFocused(),false);record('hidden Electron capturePage '+label,{file,requestedViewport:{width,height},rendererViewport:view,captureSize:size,bytes:png.length,native:{isVisible:win.isVisible(),isFocused:win.isFocused()},evidence:'hidden software pixels; no physical display claim'});
}
async function setViewport(win:BrowserWindowType,width:number,height:number):Promise<()=>Promise<void>>{
  const d=win.webContents.debugger,wasAttached=d.isAttached();if(!wasAttached)d.attach('1.3');
  await d.sendCommand('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
  await until(()=>js<boolean>(win,'innerWidth==='+String(width)+'&&innerHeight==='+String(height)),'CSS viewport '+width+'x'+height);
  return async()=>{try{await d.sendCommand('Emulation.clearDeviceMetricsOverride');}finally{if(!wasAttached&&d.isAttached())d.detach();}};
}
async function auditAllScreens(win:BrowserWindowType,width:number,height:number):Promise<void>{
  const clear=await setViewport(win,width,height);
  try{
    await selectCasualTab(win,'friends');await click(win,'cBuddyView-company');await capture(win,'friends-company',width,height);await auditPanel(win,'#cPanel-friends','friends company '+width);
    await click(win,'cBuddyView-training');await capture(win,'friends-training',width,height);await auditPanel(win,'#cBuddyViewPanel-training','friends training '+width);
    await click(win,'cBuddyView-story');await capture(win,'friends-story',width,height);await auditPanel(win,'#cBuddyViewPanel-story','friends story '+width);
    await selectCasualTab(win,'collection');await click(win,'cArchiveNew');await capture(win,'rarity-cabinet',width,height);await auditPanel(win,'#cArchiveRarities','rarity cabinet '+width);
    await selectCasualTab(win,'camp');
    for(const tab of ['growth','overview','production','jobs','crew']){await selectLifeTab(win,tab);await js(win,'document.getElementById("cContent").scrollTop=0');await capture(win,'camp-'+tab,width,height);await auditPanel(win,'#lifePanel-'+tab,'camp '+tab+' '+width);}
    await selectLifeTab(win,'jobs');
    for(const job of ['counter','workshop','garden']){await click(win,'lifeWorkplace-'+job);await capture(win,'workplace-'+job,width,height);await auditPanel(win,'#lifeWorkplacePanel-'+job,'workplace '+job+' '+width);}
    await selectCasualTab(win,'adventure');await js(win,'document.getElementById("cLetters").scrollIntoView({block:"start"})');await capture(win,'travel-letters',width,height);await auditPanel(win,'#cLetters','travel letters '+width);
  }finally{await clear();}
}
function makeFixture(now:number):Profile{
  const p=initialProfile(now);p.job='keeper';p.coins=600000;p.xp=12000;p.totals.earned=600000;p.business.managed=true;p.business.till=240;
  p.bag.flour=500;p.bag.gel=40;
  p.leisure.clears=[12,12,12,12,12];p.leisure.active='fox';p.leisure.gardenLevel=2;p.leisure.cooked=100;p.leisure.harvests=30;
  p.leisure.materials={herb:2500,berry:2500,mushroom:2500,ore:4500,tea:2500,biscuit:2500,soup:2500,pumpkin:2500,snowflower:2500,pie:2500,snowtea:2500};
  p.leisure.companions={slime:0,guide:14,guard:14,fox:14,deer:14,otter:14,owl:14,bear:14,bird:14};
  p.leisure.journal.buildings={lodge:0,workshop:0,archive:0};p.leisure.journal.dust=1500;
  const bonds=initialBonds();for(const id of BUDDY_ORDER)bonds.progress[id]={path:null,rank:0,voyages:20,stories:0};
  bonds.progress.slime.voyages=0;bonds.support='guide';bonds.relics.fill(1);bonds.relics[14]=0;bonds.tokens=1200;bonds.letters=[{id:1,zone:0},{id:2,zone:1},{id:3,zone:2}];bonds.letterSequence=3;p.leisure.bonds=bonds;
  const camp=initialCamp();camp.last={basic:{id:'ration',count:1},supply:{id:'picnic',count:1},alchemy:{id:'ink',count:1},kitchen:{id:'biscuit',count:1}};
  camp.lastJourney={zone:0,route:'balanced',trips:1,depth:0,secret:false};p.camp=camp;
  return parseProfile(p);
}
async function openCasual():Promise<BrowserWindowType>{
  const street=shell!.overlay;await until(()=>js<boolean>(street,'!!document.getElementById("dungeonSign")'),'street adventure portal');
  await click(street,'dungeonSign',14);await until(()=>!!shell?.arenaWindow&&!shell.arenaWindow.isDestroyed(),'casual BrowserWindow creation');const win=casual();activeWin=win;
  await ready(win);await attachInstrument(win);assert.equal(page(win),'casual');assert.equal(win.isVisible(),false);assert.equal(win.isFocused(),false);
  await until(()=>js<boolean>(win,'!!document.getElementById("campScene")&&!!document.getElementById("lifePanel-growth")&&!!document.getElementById("cBuddyView-company")'),'0110 renderer modules mounted');
  const state=await js(win,'({homeHidden:document.getElementById("cCampHome").hidden,workspaceHidden:document.getElementById("cCampWorkspace").hidden,keys:window.__inner0110Audit.keys,documentFocus:document.hasFocus(),pageWidth:document.documentElement.scrollWidth})');
  record('hidden casual renderer ready through real Shell and preload IPC',{page:page(win),bounds:win.getBounds(),native:{isVisible:win.isVisible(),isFocused:win.isFocused()},ui:state});return win;
}
async function inspectBuddyPortraits(win:BrowserWindowType):Promise<void>{
  await openFromScene(win,'csTent','cPanel-friends','friends');
  assert.equal(await js<number>(win,'document.querySelectorAll("#cPanel-friends .b-buddy-pick").length'),9);
  await js(win,'window.__inner0110FirstBuddyNode=document.getElementById("cBuddyPick-slime")');
  const clearSmallViewport=await setViewport(win,760,650);
  try{const scrollDiagnostic=await js<any>(win,'(()=>{const c=document.getElementById("cContent"),e=document.getElementById("cBuddyPick-owl"),a=e.closest(".b-roster"),measure=()=>{const r=e.getBoundingClientRect(),cr=c.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return{inner:{width:innerWidth,height:innerHeight},scrollTop:c.scrollTop,content:{top:cr.top,bottom:cr.bottom,clientHeight:c.clientHeight,scrollHeight:c.scrollHeight},roster:{position:getComputedStyle(a).position,top:a.getBoundingClientRect().top,bottom:a.getBoundingClientRect().bottom,clientHeight:a.clientHeight,scrollHeight:a.scrollHeight,overflowY:getComputedStyle(a).overflowY},target:{top:r.top,bottom:r.bottom,left:r.left,right:r.right},centerHit:{tag:hit?.tagName||null,id:hit?.id||null,button:hit?.closest("button")?.id||null}}};e.scrollIntoView({block:"nearest",inline:"nearest"});const into=measure();c.scrollTop=c.scrollHeight;return{scrollIntoView:into,manual:measure()}})()');
    await new Promise(r=>setTimeout(r,80));record('roster sticky / real scroll reachability diagnostic',scrollDiagnostic,'INFO');await capture(win,'roster-manual-scroll',760,650);
  }finally{await clearSmallViewport();await js(win,'document.getElementById("cContent").scrollTop=0');}
  for(const id of BUDDY_ORDER){await localSelection(win,'cBuddyPick-'+id,()=>js<boolean>(win,'document.getElementById('+JSON.stringify('cBuddyPick-'+id)+')?.getAttribute("aria-pressed")==="true"&&document.getElementById("cBuddyPortrait").dataset.buddy==='+JSON.stringify(id)+'&&document.getElementById("cBuddyName").textContent==='+JSON.stringify(COMPANIONS[id].name)),'buddy portrait '+id);}
  const atlas=await js<{ids:string[];positions:string[];backgrounds:string[];loaded:boolean;size:{width:number;height:number}}>(win,'(async()=>{const es=[...document.querySelectorAll("#cPanel-friends .b-buddy-pick .b-buddy-art[data-buddy]")],bg=getComputedStyle(es[0]).backgroundImage,url=bg.match(/url\\([\"\']?(.*?)[\"\']?\\)/)?.[1]||"",img=new Image();img.src=url;try{await img.decode()}catch{}return{ids:es.map(e=>e.dataset.buddy),positions:es.map(e=>getComputedStyle(e).backgroundPosition),backgrounds:[...new Set(es.map(e=>getComputedStyle(e).backgroundImage))],loaded:img.naturalWidth>0,size:{width:img.naturalWidth,height:img.naturalHeight}}})()');
  assert.deepEqual(atlas.ids,BUDDY_ORDER);assert.equal(new Set(atlas.positions).size,9);assert.equal(atlas.backgrounds.length,1);assert.ok(atlas.loaded&&atlas.size.width>0);assert.equal(await js<boolean>(win,'window.__inner0110FirstBuddyNode===document.getElementById("cBuddyPick-slime")'),true);
  record('nine companion atlas portraits resolve to nine distinct sprites',atlas);
}
async function testTrainingAndStories(win:BrowserWindowType):Promise<void>{
  await click(win,'cBuddyPick-slime');await click(win,'cBuddyView-training');
  const unchosen=await disabled(win,'cBuddyTrain',/先选择一条培养路线/);assert.match(unchosen.tip,/先选择/);
  await selectBuddyPath(win,'slime','scout');
  await disabled(win,'cBuddyTrain',/伙伴先达到Lv2/);
  for(const id of ['scout','gatherer','seeker'] as TrainingPath[]){if(currentProfile().leisure.bonds!.progress.slime.path!==id)await selectBuddyPath(win,'slime',id);const scene=await js<{path:string;rank:string;text:string}>(win,'({path:document.getElementById("cBuddyPath-'+id+'").getAttribute("aria-pressed"),rank:document.getElementById("cBuddyRank").textContent,text:document.getElementById("cBuddyTrainCost").textContent})');assert.equal(scene.path,'true');record('training route card selection '+id,scene);}
  await click(win,'cBuddyPick-guide');await click(win,'cBuddyView-training');
  const expected=[1,2,3];for(let i=0;i<3;i++){
    const route=(['scout','gatherer','seeker'] as TrainingPath[])[i];await selectBuddyPath(win,'guide',route);
    const before=currentProfile().leisure.bonds!.progress.guide.rank;const after=await action(win,'cBuddyTrain');assert.equal(after.leisure.bonds!.progress.guide.rank,expected[i]);assert.equal(after.leisure.bonds!.progress.guide.path,route);assert.ok(after.leisure.bonds!.progress.guide.rank>before);
    const pips=await js<number>(win,'Number(document.getElementById("cBuddyPips-'+route+'").dataset.rank)');assert.equal(pips,expected[i]);
  }
  await disabled(win,'cBuddyTrain',/专长已达到三阶/);record('three training ranks retain progress while changing among all three paths',{progress:currentProfile().leisure.bonds!.progress.guide});
  await click(win,'cBuddyView-story');await until(()=>js<boolean>(win,'!document.getElementById("cBuddyViewPanel-story").hidden'),'story subtab');
  for(let i=0;i<3;i++){
    const p0=currentProfile(),g=p0.leisure.bonds!.progress.guide;assert.equal(g.stories,i);const coins=[40,100,250][i],tokens=[2,4,8][i],dust=[1,3,6][i];
    const p1=await action(win,'cBuddyStory');assert.equal(p1.leisure.bonds!.progress.guide.stories,i+1);assert.equal(p1.coins,p0.coins+coins);assert.equal(p1.leisure.bonds!.tokens,p0.leisure.bonds!.tokens+tokens);assert.equal(p1.leisure.journal.dust,p0.leisure.journal.dust+dust);
    await localSelection(win,'cBuddyStoryPage'+i,()=>js<boolean>(win,'document.getElementById("cBuddyStoryPage'+i+'").getAttribute("aria-pressed")==="true"'),'open archived story page '+i);
    const story=await js<{speaker:string;text:string;page:boolean}>(win,'({speaker:document.getElementById("cBuddyStorySpeaker").textContent,text:document.getElementById("cBuddyStoryText").textContent,page:document.getElementById("cBuddyStoryPage'+i+'").getAttribute("aria-pressed")==="true"})');assert.equal(story.speaker,COMPANIONS.guide.name);assert.ok(story.text.trim().length>10);assert.equal(story.page,true);record('story reward and archive page '+i,{story,coins,tokens,dust});
  }
  await disabled(win,'cBuddyStory',/三篇同行故事都已珍藏/);
  await click(win,'cBuddyView-company');await click(win,'cBuddyPick-guide');await action(win,'cBuddyLead');assert.equal(currentProfile().leisure.active,'guide');assert.equal(currentProfile().leisure.bonds!.support,null,'promotion from support to leader must remove support');
  await click(win,'cBuddyPick-fox');await action(win,'cBuddySupport');assert.equal(currentProfile().leisure.active,'guide');assert.equal(currentProfile().leisure.bonds!.support,'fox');
  await click(win,'cBuddyPick-slime');const biscuitBefore=currentProfile().leisure.materials.biscuit,xpBefore=currentProfile().leisure.companions.slime;await action(win,'cBuddyFeed');assert.equal(currentProfile().leisure.materials.biscuit,biscuitBefore-1);assert.equal(currentProfile().leisure.companions.slime,(xpBefore??0)+1);
  record('leader/support remain exclusive and feeding updates real affection',{leader:currentProfile().leisure.active,support:currentProfile().leisure.bonds!.support,biscuitBefore,biscuitAfter:currentProfile().leisure.materials.biscuit,feedBuddy:'slime',slimeXp:currentProfile().leisure.companions.slime});
}
async function testRarities(win:BrowserWindowType):Promise<void>{
  await backToScene(win);await openFromScene(win,'csArchive','cPanel-collection','collection');await click(win,'cArchiveNew');
  assert.equal(await js<number>(win,'document.querySelectorAll("#cArchiveRarities .b-rarity-pick").length'),15);await js(win,'window.__inner0110FirstCharmNode=document.getElementById("cCharmPick0")');
  for(let i=0;i<15;i++){await localSelection(win,'cCharmPick'+i,()=>js<boolean>(win,'document.getElementById("cCharmPick'+i+'").getAttribute("aria-pressed")==="true"&&document.getElementById("cCharmPortrait").dataset.rarity==='+JSON.stringify(String(i))),'focus curiosity '+i);const label=await js<string>(win,'document.getElementById("cCharmName").textContent');assert.ok(label.length>0);}
  const art=await js<{ids:string[];positions:string[];backgrounds:string[];loaded:boolean;size:{width:number;height:number}}>(win,'(async()=>{const es=[...document.querySelectorAll("#cArchiveRarities .b-rarity-pick .b-rarity-art[data-rarity]")],bg=getComputedStyle(es[0]).backgroundImage,url=bg.match(/url\\([\"\']?(.*?)[\"\']?\\)/)?.[1]||"",img=new Image();img.src=url;try{await img.decode()}catch{}return{ids:es.map(e=>e.dataset.rarity),positions:es.map(e=>getComputedStyle(e).backgroundPosition),backgrounds:[...new Set(es.map(e=>getComputedStyle(e).backgroundImage))],loaded:img.naturalWidth>0,size:{width:img.naturalWidth,height:img.naturalHeight}}})()');
  assert.deepEqual(art.ids,Array.from({length:15},(_,i)=>String(i)));assert.equal(new Set(art.positions).size,15);assert.equal(art.backgrounds.length,1);assert.ok(art.loaded&&art.size.width>0);assert.equal(await js<boolean>(win,'window.__inner0110FirstCharmNode===document.getElementById("cCharmPick0")'),true);record('15 curiosity sprites show all rarity cells from the loaded atlas',art);
  for(const id of [0,1,2]){await click(win,'cCharmPick'+id);const p=await action(win,'cCharmEquip');assert.ok(p.leisure.bonds!.loadout.includes(id));}
  assert.deepEqual(currentProfile().leisure.bonds!.loadout,[0,1,2]);const set=await js<{name:string;two:string;three:string}>(win,'({name:document.getElementById("cCharmSetName").textContent,two:document.getElementById("cCharmSetTwo").textContent,three:document.getElementById("cCharmSetThree").textContent})');assert.match(set.name,/3 \/ 3/);assert.match(set.three,/已激活/);
  await click(win,'cCharmPick3');await disabled(win,'cCharmEquip',/最多携带3件/);
  const clearViewport=await setViewport(win,760,650);try{const diag=await js<any>(win,'(()=>{const c=document.getElementById("cContent"),e=document.getElementById("cCharmUpgrade"),a=e.closest(".b-rarity-detail"),measure=()=>{const r=e.getBoundingClientRect(),cr=c.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return{scrollTop:c.scrollTop,content:{top:cr.top,bottom:cr.bottom,clientHeight:c.clientHeight,scrollHeight:c.scrollHeight},detail:{position:getComputedStyle(a).position,top:a.getBoundingClientRect().top,bottom:a.getBoundingClientRect().bottom,clientHeight:a.clientHeight,scrollHeight:a.scrollHeight,overflowY:getComputedStyle(a).overflowY},button:{top:r.top,bottom:r.bottom},centerHit:hit?.closest("button")?.id||null}};e.scrollIntoView({block:"nearest"});const into=measure();c.scrollTop=c.scrollHeight;return{scrollIntoView:into,manual:measure()}})()');record('rarity detail sticky / upgrade button scroll reachability diagnostic',diag,'INFO');await capture(win,'rarity-upgrade-manual-scroll',760,650);}finally{await clearViewport();await js(win,'document.getElementById("cContent").scrollTop=0');}
  await click(win,'cCharmPick0');const oldRank=currentProfile().leisure.bonds!.relics[0];await action(win,'cCharmUpgrade');assert.equal(currentProfile().leisure.bonds!.relics[0],oldRank+1);await action(win,'cCharmUpgrade');assert.equal(currentProfile().leisure.bonds!.relics[0],3);await disabled(win,'cCharmUpgrade',/已经修复至三星/);
  await click(win,'cCharmPick14');await disabled(win,'cCharmEquip',/先探访对应秘境/);await disabled(win,'cCharmUpgrade',/先探访对应秘境/);
  record('three loadout slots, set activation, repair levels and undiscovered reasons',{loadout:currentProfile().leisure.bonds!.loadout,relicRanks:currentProfile().leisure.bonds!.relics,set});
}
async function testLetters(win:BrowserWindowType):Promise<void>{
  await backToScene(win);await until(()=>js<boolean>(win,'!document.getElementById("csLetters").hidden'),'camp scene travel-letter shortcut visible');await click(win,'csLetters');await until(()=>js<boolean>(win,'!document.getElementById("cPanel-adventure").hidden&&!document.getElementById("cLetters").hidden'),'travel letter workspace');
  const initial=await js<Array<{id:string;title:string;zone:string}>>(win,'[0,1,2].map(i=>({id:document.getElementById("cLetter"+i).id,title:document.getElementById("cLetterTitle"+i).textContent||"",zone:document.getElementById("cLetter"+i).dataset.letterZone||""}))');assert.ok(initial.every(x=>x.title.trim().length>0));
  const cases=[{button:'cLetterSupplies0',choice:'supplies',material:'herb'},{button:'cLetterNotes0',choice:'notes',material:'dust'},{button:'cLetterTokens0',choice:'tokens',material:'tokens'}] as const;
  for(const c of cases){const before=currentProfile(),letter=before.leisure.bonds!.letters[0];assert.ok(letter);const expected=letter.zone===0?'herb':letter.zone===1?'mushroom':'berry';const p=await action(win,c.button);assert.equal(p.leisure.bonds!.letters.length,before.leisure.bonds!.letters.length-1);if(c.choice==='supplies')assert.equal(p.leisure.materials[expected as keyof typeof p.leisure.materials],before.leisure.materials[expected as keyof typeof p.leisure.materials]+2);else if(c.choice==='notes')assert.equal(p.leisure.journal.dust,before.leisure.journal.dust+2);else assert.equal(p.leisure.bonds!.tokens,before.leisure.bonds!.tokens+2);}
  assert.equal(currentProfile().leisure.bonds!.letters.length,0);record('each of the three travel letter choices resolves exactly one real current letter',{initial,lettersLeft:0,materials:currentProfile().leisure.materials,dust:currentProfile().leisure.journal.dust,tokens:currentProfile().leisure.bonds!.tokens});
}
async function testGrowth(win:BrowserWindowType):Promise<void>{
  await backToScene(win);await openFromScene(win,'csLodge','cPanel-camp','camp');await selectLifeTab(win,'growth');
  const road=await js<{level:string;xp:string;unlocked:string[];goal:string}>(win,'({level:document.getElementById("lifeLevel").textContent,xp:document.getElementById("lifeXp").textContent,unlocked:Array.from({length:7},(_,i)=>document.getElementById("lifeRoad"+i).dataset.unlocked||""),goal:document.getElementById("lifeGoal").textContent||""})');assert.equal(road.unlocked.filter(x=>x==='true').length,7);assert.match(road.level,/Lv7/);assert.ok(road.goal.length>0);record('growth route displays actual level, XP and seven unlocked milestones',road);
  for(let i=0;i<CAMP_LEVELS.length;i++){const before=currentProfile(),c=before.camp!;assert.equal(c.claimed,i);const after=await action(win,'lifeGift');assert.equal(after.camp!.claimed,i+1);assert.equal(after.coins,before.coins+CAMP_LEVELS[i].coins);assert.equal(after.leisure.materials.ore,before.leisure.materials.ore+CAMP_LEVELS[i].ore);}
  await disabled(win,'lifeGift',/所有营地赠礼已领取/);
  for(const building of ['lodge','workshop','archive'] as const){for(let level=1;level<=3;level++){const p=await action(win,'cBuild-'+building);assert.equal(p.leisure.journal.buildings[building],level);const visible=await js<string>(win,'document.getElementById("cBuildingLevel-'+building+'").textContent');assert.ok(visible.includes('Lv'+level));}}
  record('all seven camp gifts and all three building milestone paths completed through visible actions',{claimed:currentProfile().camp!.claimed,buildings:currentProfile().leisure.journal.buildings,level:road.level});
}
async function testOverviewAndPlans(win:BrowserWindowType):Promise<void>{
  await selectLifeTab(win,'overview');const till=currentProfile().business.till,coins=currentProfile().coins;await action(win,'lifeCollect');assert.equal(currentProfile().business.till,0);assert.equal(currentProfile().coins,coins+till);
  for(const station of ['basic','supply','alchemy','kitchen'] as const){
    const s1=await action(win,'lifeRepeat-'+station);const has=station==='basic'?!!s1.queue:station==='kitchen'?s1.camp!.cooking.length>0:s1.atelier!.queues[station].length>0;assert.ok(has,'repeat must create the selected station batch '+station);
    const s2=await action(win,'lifeAvailable-'+station);const has2=station==='basic'?!!s2.queue||s2.business.pending.length>0:station==='kitchen'?s2.camp!.cooking.length>0:s2.atelier!.queues[station].length>0;assert.ok(has2,'available must use materials on '+station);
  }
  const queued=await js<Array<{station:string;name:string;count:string}>>(win,'[...document.querySelectorAll(".life-stations article")].map(e=>({station:e.dataset.station||"",name:e.querySelector(".life-station-stage h3")?.textContent||"",count:e.querySelector(".life-mini-queue")?.textContent||""}))');assert.equal(queued.length,4);assert.ok(queued.every(x=>x.station&&x.name));record('overview repeats, available-material actions and station queue visuals',{queued,tillBefore:till,tillAfter:currentProfile().business.till});
  await selectLifeTab(win,'production');
  const plans=[{station:'supply',good:'gift',count:30,reserve:0},{station:'alchemy',good:'incense',count:10,reserve:10}] as const;
  for(const plan of plans){
    await localSelection(win,'lifePlanPick-'+plan.good,()=>js<boolean>(win,'document.getElementById("lifePlanGood-'+plan.station+'").value==='+JSON.stringify(plan.good)+'&&document.getElementById("lifePlanPick-'+plan.good+'").getAttribute("aria-pressed")==="true"'),'visible product card updates hidden '+plan.station+' select');
    await localSelection(win,'lifePlanCountPick-'+plan.station+'-'+plan.count,()=>js<boolean>(win,'document.getElementById("lifePlanCount-'+plan.station+'").value==='+JSON.stringify(String(plan.count))),'finite plan count chip '+plan.station);
    await localSelection(win,'lifePlanReservePick-'+plan.station+'-'+plan.reserve,()=>js<boolean>(win,'document.getElementById("lifePlanReserve-'+plan.station+'").value==='+JSON.stringify(String(plan.reserve))),'finite plan reserve chip '+plan.station);
    const p=await action(win,'lifePlanStart-'+plan.station);assert.deepEqual(p.camp!.stockPlans[plan.station],{good:plan.good,remaining:plan.count,reserve:plan.reserve});
    const stop=await action(win,'lifePlanStop-'+plan.station);assert.equal(stop.camp!.stockPlans[plan.station],null);
  }
  await disabled(win,'lifePlanStop-supply',/本站没有上架计划/);
  record('finite stocking plans preserve chosen product, exact count and reserve and stop without purchasing or crafting',{plans,stockPlans:currentProfile().camp!.stockPlans,notice:currentProfile().notice});
}
async function testRecipes(win:BrowserWindowType):Promise<void>{
  await selectLifeTab(win,'production');await js(win,'window.__foodPickerNode=document.getElementById("lifeFoodPick-tea")');
  while(currentProfile().camp!.cooking.length)await action(win,'lifeCancelFood0');
  for(const food of ['snowtea','soup','pie','biscuit','tea'] as Food[]){
    await localSelection(win,'lifeFoodPick-'+food,()=>js<boolean>(win,'document.getElementById("lifeFood").value==='+JSON.stringify(food)+'&&document.getElementById("lifeFoodName").textContent==='+JSON.stringify(FOODS[food].name)),'visible food card updates selected hidden recipe '+food);
    const tray=await js<{selected:string;materials:Array<{id:string;need:string;text:string;lack:boolean}>}>(win,'(()=>({selected:document.getElementById("lifeFoodName").textContent,materials:[...document.getElementById("lifeFoodMaterials").children].map(e=>({id:e.dataset.material||"",need:e.dataset.need||"",text:e.textContent||"",lack:e.classList.contains("life-lack")}))}))()');assert.equal(tray.selected,FOODS[food].name);assert.ok(tray.materials.length>0);assert.ok(tray.materials.every(m=>m.text.includes(m.need)&&!m.lack));
    const before=currentProfile(),queued=await action(win,'lifeCook1');assert.equal(queued.camp!.cooking.length,before.camp!.cooking.length+1);const fresh=queued.camp!.cooking.filter(q=>!before.camp!.cooking.some(old=>old.id===q.id));assert.equal(fresh.length,1);assert.equal(fresh[0].food,food);
    const row=await js<{hidden:boolean;food:string;buttonExists:boolean}>(win,'(()=>{const e=document.getElementById("lifeFoodRow0"),art=document.getElementById("lifeFoodQueueArt0");return{hidden:e.hidden,food:art.dataset.art||"",buttonExists:!!document.getElementById("lifeCancelFood0")}})()');assert.equal(row.hidden,false);assert.equal(row.food,food);assert.equal(row.buttonExists,true);
    const post=await action(win,'lifeCancelFood0');assert.equal(post.camp!.cooking.length,before.camp!.cooking.length);assert.deepEqual(post.leisure.materials,before.leisure.materials,'cancel returns the exact prequeue recipe stock');assert.deepEqual(post.bag,before.bag,'cancel returns prequeue flour and gel');
    record('visible recipe selection, ingredient tray, cook and refund '+food,{tray,row,queueAfter:post.camp!.cooking.length,sequence:post.sequence});
  }
  assert.equal(await js<boolean>(win,'window.__foodPickerNode===document.getElementById("lifeFoodPick-tea")'),true,'food button DOM node should survive local selections');
}
async function selectWorkplace(win:BrowserWindowType,job:CampJob):Promise<void>{await localSelection(win,'lifeWorkplace-'+job,()=>js<boolean>(win,'document.getElementById('+JSON.stringify('lifeWorkplacePanel-'+job)+').hidden===false&&document.getElementById('+JSON.stringify('lifeWorkplace-'+job)+').getAttribute("aria-selected")==="true"'),'workplace scene '+job);}
async function testJobs(win:BrowserWindowType):Promise<void>{
  await selectLifeTab(win,'jobs');await js(win,'window.__jobPickerNode=document.getElementById("lifeJobPick-counter-slime")');
  for(const job of ['counter','workshop','garden'] as CampJob[]){
    await selectWorkplace(win,job);const chosen=job==='counter'?'slime':job==='workshop'?'deer':'owl';
    if(job==='workshop'){
      await click(win,'lifeJobPick-workshop-slime');const dup=await disabled(win,'lifeAssign-workshop',/已在其他岗位/);record('duplicate job assignment exposes visible conflict reason',{tooltip:dup.tip,job:currentProfile().camp!.jobs.counter});
    }
    const pickId='lifeJobPick-'+job+'-'+chosen,selectId='lifeJobChoice-'+job;
    await localSelection(win,pickId,()=>js<boolean>(win,'document.getElementById('+JSON.stringify(selectId)+').value==='+JSON.stringify(chosen)+'&&document.getElementById('+JSON.stringify(pickId)+').getAttribute("aria-pressed")==="true"'),'portrait selection and hidden select bridge '+job);
    const assigned=await action(win,'lifeAssign-'+job);assert.equal(assigned.camp!.jobs[job],chosen);const shown=await js<{buddy:string;hidden:boolean;status:string}>(win,'({buddy:document.getElementById("lifeJobPortrait-'+job+'").dataset.buddy||"",hidden:document.getElementById("lifeJobPortrait-'+job+'").hidden,status:document.getElementById("lifeJobState-'+job+'").textContent||""})');assert.equal(shown.buddy,chosen);assert.equal(shown.hidden,false);assert.ok(shown.status.includes(COMPANIONS[chosen].name));
    if(job!=='counter'){await localSelection(win,'lifeJobPick-'+job+'-none',()=>js<boolean>(win,'document.getElementById("lifeJobChoice-'+job+'").value==="none"'),'workplace rest picker '+job);const rested=await action(win,'lifeAssign-'+job);assert.equal(rested.camp!.jobs[job],null);record('workplace card, portrait picker, legacy value reflection, assign and rest '+job,{chosen,shown,jobs:rested.camp!.jobs});}
    else record('counter workplace card and portrait picker assign the first worker for an occupied-member conflict test',{chosen,shown,jobs:assigned.camp!.jobs});
  }
  await selectWorkplace(win,'counter');await localSelection(win,'lifeJobPick-counter-none',()=>js<boolean>(win,'document.getElementById("lifeJobChoice-counter").value==="none"'),'counter rest picker after workplace conflict test');const counterRest=await action(win,'lifeAssign-counter');assert.equal(counterRest.camp!.jobs.counter,null);
  assert.equal(await js<boolean>(win,'window.__jobPickerNode===document.getElementById("lifeJobPick-counter-slime")'),true,'job picker DOM node should be stable');
  await auditPanel(win,'#lifePanel-jobs','all workplace cards and memory buttons');
}
async function setLoadout(win:BrowserWindowType,ids:number[]):Promise<void>{
  await selectCasualTab(win,'collection');await click(win,'cArchiveNew');
  while(currentProfile().leisure.bonds!.loadout.length){await click(win,'cCharmSlot0');await until(()=>!currentProfile().leisure.bonds!.loadout.length||currentProfile().sequence>0,'remove current curiosity');}
  for(const id of ids){await click(win,'cCharmPick'+id);await action(win,'cCharmEquip');}
  assert.deepEqual(currentProfile().leisure.bonds!.loadout,ids);
}
async function setTeam(win:BrowserWindowType,leader:Buddy,support:Buddy|null):Promise<void>{
  await selectCasualTab(win,'friends');await click(win,'cBuddyView-company');
  if(currentProfile().leisure.active!==leader){await click(win,'cBuddyPick-'+leader);await action(win,'cBuddyLead');}
  if(currentProfile().leisure.bonds!.support!==support){const next=support??currentProfile().leisure.bonds!.support;if(next){await click(win,'cBuddyPick-'+next);await action(win,'cBuddySupport');}if(support&&currentProfile().leisure.bonds!.support!==support){await click(win,'cBuddyPick-'+support);await action(win,'cBuddySupport');}}
  assert.equal(currentProfile().leisure.active,leader);assert.equal(currentProfile().leisure.bonds!.support,support);
}
async function testCrew(win:BrowserWindowType):Promise<void>{
  await selectLifeTab(win,'crew');const defaultCrew=await js<{leader:string;support:string;relics:string[]}>(win,'({leader:document.getElementById("lifeCrewLead").textContent||"",support:document.getElementById("lifeCrewSupport").textContent||"",relics:[0,1,2].map(i=>document.getElementById("lifeCrewRelicName"+i).textContent||"")})');assert.match(defaultCrew.leader,/领队/);assert.ok(defaultCrew.support.includes('支援'));
  const crews=[{slot:0,leader:'guide',support:'fox',relics:[0,1,2]},{slot:1,leader:'slime',support:'bear',relics:[3,4,5]},{slot:2,leader:'deer',support:'owl',relics:[6,7,8]}] as const;
  for(const c of crews){await setTeam(win,c.leader,c.support);await setLoadout(win,[...c.relics]);await selectCasualTab(win,'camp');await selectLifeTab(win,'crew');const saved=await action(win,'lifePresetSave'+c.slot);assert.deepEqual(saved.camp!.presets[c.slot],{leader:c.leader,support:c.support,relics:[...c.relics]});}
  for(const c of crews){await setTeam(win,'fox','guide');await setLoadout(win,[0,1,2]);await selectCasualTab(win,'camp');await selectLifeTab(win,'crew');const loaded=await action(win,'lifePresetLoad'+c.slot);assert.equal(loaded.leisure.active,c.leader);assert.equal(loaded.leisure.bonds!.support,c.support);assert.deepEqual(loaded.leisure.bonds!.loadout,[...c.relics]);const card=await js<string>(win,'document.getElementById("lifePresetState'+c.slot+'").textContent||""');assert.ok(card.includes(COMPANIONS[c.leader].name));}
  const before=currentProfile();const redepart=await action(win,'lifeRedeploy');assert.ok(redepart.leisure.run);assert.equal(redepart.leisure.run!.zone,0);assert.equal(redepart.leisure.run!.route,'balanced');assert.equal(redepart.leisure.run!.total,1);
  record('three distinct team presets save/load with current leader, support and relics; last route redeparts through Worker',{presets:currentProfile().camp!.presets,run:currentProfile().leisure.run,priorTrip:before.camp!.lastJourney});
}
async function checkBoundary(win:BrowserWindowType):Promise<void>{
  const events=await js<{keys:number;csp:Array<{directive:string;blocked:string;sample:string}>;activeTag:string|null;documentFocus:boolean}>(win,'({keys:window.__inner0110Audit.keys,csp:window.__inner0110Audit.csp,activeTag:document.activeElement?.tagName||null,documentFocus:document.hasFocus()})');
  keyboardByWindow[win.id]=events.keys;for(const v of events.csp)cspViolations.push({windowId:win.id,...v});assert.equal(events.keys,0,'renderer received no keyboard events');assert.equal(win.isVisible(),false);assert.equal(win.isFocused(),false);assert.equal(events.csp.length,0,'no CSP violations');
  assert.equal(suppression.globalShortcut??0,0,'globalShortcut remained unused');
  record('hidden-window / keyboard / CSP / global input boundary',{native:{isVisible:win.isVisible(),isFocused:win.isFocused()},renderer:events,suppression,tray:'constructor replaced with no-op; count records suppressed attempts'});
}
async function finishAndReopen(win:BrowserWindowType):Promise<void>{
  const before=structuredClone(currentProfile()),nativeBefore={isVisible:win.isVisible(),isFocused:win.isFocused()};assert.deepEqual(nativeBefore,{isVisible:false,isFocused:false});await click(win,'cClose');await until(()=>!shell?.arenaWindow,'close adventure window to camp');const closed=snapshots().find(x=>x.id===win.id);assert.ok(!shell?.arenaWindow);assert.equal(closed?.destroyed,true,'closed native window is destroyed without ever showing or focusing');
  const reopened=await openCasual();const after=currentProfile();const normalized=structuredClone(after);normalized.tick=before.tick;normalized.wallAt=before.wallAt;normalized.carryMs=before.carryMs;
  const expected=structuredClone(before);expected.tick=before.tick;expected.wallAt=before.wallAt;expected.carryMs=before.carryMs;assert.deepEqual(normalized,expected,'reopened window reads same worker profile except natural elapsed clock');
  await checkBoundary(reopened);const reopenedNativeBefore={isVisible:reopened.isVisible(),isFocused:reopened.isFocused()};assert.deepEqual(reopenedNativeBefore,{isVisible:false,isFocused:false});await click(reopened,'cClose');await until(()=>!shell?.arenaWindow,'final casual close');
  record('repeated close and return restores same isolated profile',{sequence:after.sequence,profileVersion:after.version,native:snapshots()});
}

async function main():Promise<void>{
  let fatal:unknown;
  try{
    fs.mkdirSync(evidenceDir,{recursive:true,mode:0o700});fs.mkdirSync(soloFolder,{recursive:true,mode:0o700});
    markIsolatedFolder(profileRoot,app.getPath('appData'));
    const now=Date.now(),seed=makeFixture(now);fs.writeFileSync(path.join(soloFolder,'profile.json'),JSON.stringify(seed)+'\n',{flag:'wx',mode:0o600});
    const readback=new GameStore(soloFolder,now).value;assert.deepEqual(readback,seed,'independent marker profile must roundtrip through GameStore');profileBefore=parseProfile(readback);
    record('fresh independent /private/tmp profile marked and parseProfile preflighted before Electron Shell',{profileRoot,profileFile:path.join(soloFolder,'profile.json'),version:seed.version,sequence:seed.sequence,job:seed.job,owned:BUDDY_ORDER.filter(id=>seed.leisure.companions[id]!==null),profileReadbackMatches:true});
    if(process.platform==='darwin'){app.setActivationPolicy('prohibited');suppression.activationPolicy='prohibited';try{app.dock?.hide();suppression.dockHidden=true;}catch{}}
    replace(app,'focus',()=>{suppression.appFocus=(suppression.appFocus??0)+1;return false;});
    replace(Menu,'setApplicationMenu',()=>{});
    app.on('browser-window-created',(_event,win)=>track(win));
    app.on('web-contents-created',(_event:any,contents:any)=>contents.on('console-message',(event:any)=>{if(event.level==='error')rendererErrors.push(String(event.message).slice(0,800));}));
    shell=await startDesktop(profileRoot,true);await profileReady();
    await until(()=>js<boolean>(shell!.overlay,'document.body.dataset.atlas==="verified"&&!!document.getElementById("dungeonSign")'),'hidden camp shell ready');
    assert.equal(shell.overlay.isVisible(),false);assert.equal(shell.overlay.isFocused(),false);record('real Shell, overlay, IPC and GameWorker are ready with hidden native state',{shell:{mode:shell.mode,view:shell.view,overlay:{isVisible:shell.overlay.isVisible(),isFocused:shell.overlay.isFocused()}},profile:{version:currentProfile().version,sequence:currentProfile().sequence,job:currentProfile().job},suppression});
    let win=await openCasual();
    await phase('all nine companion portraits and stable roster',()=>inspectBuddyPortraits(win));
    await phase('training gates, all three ranks, archived stories, leader/support and feeding',()=>testTrainingAndStories(win));
    await phase('15 rarity focus states, three slots, repair, set activation and locked state',()=>testRarities(win));
    await phase('three real travel letters and reward choices',()=>testLetters(win));
    await phase('growth milestones, all gifts and building upgrades',()=>testGrowth(win));
    await phase('overview actions, till collection and finite stock plans',()=>testOverviewAndPlans(win));
    await phase('five food selectors, material trays, cooking and cancellation',()=>testRecipes(win));
    await phase('three workplace cards, portrait selection, select bridge and rest',()=>testJobs(win));
    await phase('three distinct crew presets and redepart',()=>testCrew(win));
    for(const size of [{width:760,height:650},{width:1040,height:760}])await phase('visual and control audit at '+size.width+'px',()=>auditAllScreens(win,size.width,size.height));
    await checkBoundary(win);await finishAndReopen(win);
    await shell.game.request('flush');const persisted=new GameStore(soloFolder).value;assert.deepEqual(persisted,currentProfile(),'only this marked isolated profile is written by the worker');
    assert.deepEqual(productHashesAtStart,productHashes(),'candidate/product files changed during independent QA');
    status=failures.length||rendererErrors.length||cspViolations.length?'FAIL':'PASS';
    if(status==='FAIL'&&!failures.length)failures.push({phase:'global boundary',error:rendererErrors.length?'renderer console errors: '+rendererErrors.join('; '):'CSP violation'});
    record('final candidate integrity and final status',{status,productFiles:Object.keys(productHashesAtStart).length,productHashesUnchanged:true,isolatedOnly:true,checks:checks.length,failures:failures.length});
  }catch(error){fatal=error;status='FAIL';const e=error instanceof Error?error:new Error(String(error));failures.push({phase:'fatal harness',error:e.message,stack:e.stack});record('raw fatal harness failure',{error:e.message,stack:e.stack},'FAIL');}
  finally{
    try{if(shell?.arenaWindow&&!shell.arenaWindow.isDestroyed())shell.closeArena();}catch{}
    try{if(shell)await shell.game.request('flush');}catch{}
    status=status==='RUNNING'?'FAIL':status;
    try{writeReport(fatal);}catch(e){console.error('report write failed',e);}
    app.quit();
  }
}
void main();
