import {app, BrowserWindow, type BrowserWindow as BrowserWindowType} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {startDesktop} from '../apps/desktop/bootstrap';
import {GameStore} from '../apps/desktop/game-store';
import {markIsolatedFolder} from '../apps/desktop/launch-profile';
import {APP_NAME, APP_VERSION, PROFILE_NAME} from '../apps/desktop/identity';
import {channels, type ShellState} from '../packages/protocol';
import {
  BUILDINGS, CAMP_LEVELS, COLLECTIONS, COMPANIONS, CROPS, DESTINATIONS, DEPTHS, FOODS, ITEMS, MATERIALS, RELICS, advance, campOf, contractAt,
  foodPrice, foodTicks, initialBonds, initialCamp, initialProfile, jobPower, leisureReason,
  parseProfile, transact, type Companion, type Food, type Profile,
} from '../packages/solo-core';

type Check={name:string;status:'PASS'|'FAIL'|'INFO';detail?:unknown};
type Trace={id:number;page:string|null;visible:()=>boolean;focused:()=>boolean;last:{isVisible:boolean;isFocused:boolean}};
type Scenario='fresh'|'rich'|'claim-only'|'claim-full'|'inner';
type Control={exists:boolean;hidden:boolean;disabled:boolean;label:string;tip:string;cursor:string;font:number;gameButton:boolean;reachable:boolean;rect:{x:number;y:number;width:number;height:number};container?:{scrollWidth:number;clientWidth:number;scrollHeight:number;clientHeight:number}};

const checks:Check[]=[];
const errors:string[]=[];
const harnessIssues:string[]=[];
const screenshots:string[]=[];
const traces=new Map<number,Trace>();
const keyboardByWindow:Record<number,number>={};
const cspByWindow:Record<number,string[]>={};
const suppression=(globalThis as any).__pixelStreetCampInner0110Suppression??{};
const root=process.cwd();
const evidenceDir=path.join(root,'work/inner-0110/camp/native-luna');
const scenario=(process.argv.find(a=>a.startsWith('--scenario='))?.split('=')[1]??'rich') as Scenario;
if(!['fresh','rich','claim-only','claim-full','inner'].includes(scenario))throw new Error('scenario must be fresh, rich, claim-only, claim-full or inner');
const runId=new Date().toISOString().replace(/[:.]/g,'-')+'-'+process.pid+'-'+scenario;
const profileRoot=fs.mkdtempSync(`/private/tmp/pixelstreet-inner-0110-camp-${scenario}-`);
const profileFile=path.join(profileRoot,'solo/profile.json');
const reportPath=path.join(evidenceDir,`native-${scenario}-${runId}.json`);
const screenshotsForReport:string[]=[];
let shell:Awaited<ReturnType<typeof startDesktop>>|undefined;
let preflight:Profile|undefined;
let status:'RUNNING'|'PASS'|'FAIL'='RUNNING';
const viewportSessions=new Map<number,{wasAttached:boolean}>();

const coverageMatrix:Record<Scenario,string[]>={
  fresh:[
    'fresh schema-8 profile opens the camp scene without materializing optional camp/bond extensions',
    'all visible buildings, map, pack, plots, visitors, leader, journey, jobs and return controls are operated',
    'unassigned support and job roles stay absent; empty harvest chest is disabled with a reason',
    'all legacy tabs, camp growth pages, cooking shortcut, back, repeated close/reopen',
    'scene-node identity, readable GameButtons, 760px internal stage scroll and no page horizontal overflow',
  ],
  rich:[
    'actual scene profile for leader/support/three jobs, three plot states, three contracts and a travel letter',
    'each visible scene entry opens its matching existing page; specific companion/contract selection is checked',
    'harvest actual core yields, reject full plot capacity, then plant and harvest through the legacy garden page',
    'deliver all three current contracts once; process a real travel letter once',
    'start one real journey, settle a room on worker test clock, return early, preserve loot, claim exactly once',
    'old kitchen, cooking queue cancellation, production repeat/available, job removal and crew/growth/overview routes',
    '760px scene scroll, detail-page scroll, CSP, zero keyboard events and native windows hidden/unfocused',
    'motion lifecycle fixtures: hidden/workingElsewhere/ancestor hidden/reduced motion/dispose and blur latch',
  ],
  'claim-only':[
    'claim enabled when normal cargo is empty and only bonds satchel contains items',
    'all satchel items transfer once and a duplicate click cannot repeat the transaction',
    'hidden native boundary, profile preflight, CSP, keyboard and product hash inventory',
  ],
  'claim-full':[
    'full material inventory rejects the complete cargo claim without partial transfer',
    'disabled reason stays visible and repeated click leaves the authoritative profile unchanged',
    'hidden native boundary, profile preflight, CSP, keyboard and product hash inventory',
  ],
  inner:[
    'adventure page selects five regions, three routes, three depths, 1/3/6 trips and normal/secret modes',
    'normal excursion starts, assists, settles one room, returns early, preserves and claims settled loot',
    'five seeds are selected; three plots transition through growth and maturity, bag capacity blocks one harvest, two harvests and garden upgrades apply',
    'five cooking recipes are selected, queued, completed and sold; queue shortcut opens and cancels/ repeats real work',
    'three buildings advance through all three levels; all 15 permanent relics and 14 memories are individually selected',
    'one eligible memory reward is claimed and an unmet target remains disabled with an explanation',
    'adventure, garden, kitchen, growth, archive and scene return are repeated at 760px and 1040px',
    'hidden native boundary, marked profile preflight, CSP, zero keyboard events and unchanged product hashes',
  ],
};

function walk(dir:string):string[]{
  if(!fs.existsSync(dir))return[];
  return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{
    const file=path.join(dir,entry.name);
    return entry.isDirectory()?walk(file):[path.relative(root,file)];
  });
}
function productFiles():string[]{
  const files=[...walk(path.join(root,'apps/desktop')),...walk(path.join(root,'packages/solo-core')),
    ...walk(path.join(root,'packages/protocol')),...walk(path.join(root,'packages/content')),
    ...walk(path.join(root,'dist')),...walk(path.join(root,'assets'))];
  return [...new Set(files)].filter(file=>!/^dist\/(?:tests\/|native-.*\.cjs$)/.test(file))
    .filter(file=>fs.existsSync(path.join(root,file))).sort();
}
function productHashes():Record<string,string>{
  return Object.fromEntries(productFiles().map(file=>[file,createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')]));
}
const hashesAtStart=productHashes();
function page(win:BrowserWindowType):string|null{try{return new URL(win.webContents.getURL()).searchParams.get('page');}catch{return null;}}
function snapshots():Array<Record<string,unknown>>{
  return [...traces.values()].map(trace=>{
    try{trace.last={isVisible:trace.visible(),isFocused:trace.focused()};return{id:trace.id,page:trace.page,...trace.last};}
    catch(error){return{id:trace.id,page:trace.page,...trace.last,destroyed:true,error:String(error)};}
  });
}
function report(error?:unknown):void{
  fs.mkdirSync(evidenceDir,{recursive:true,mode:0o700});
  const record={
    schema:'pixelstreet.inner-0110.camp.luna-max.hidden-native.v1',stage:'inner-camp-pages',scenario,runId,status,
    at:new Date().toISOString(),identity:{name:APP_NAME,version:APP_VERSION,profileName:PROFILE_NAME},
    platform:process.platform,arch:process.arch,electron:process.versions.electron,
    profileRoot,profileFile,preflight:preflight?{version:preflight.version,sequence:preflight.sequence,
      tick:preflight.tick,campPresent:Object.hasOwn(preflight,'camp'),bondsPresent:Object.hasOwn(preflight.leisure,'bonds')}:null,
    checks,errors,harnessIssues,screenshots:screenshotsForReport,suppression,nativeWindows:snapshots(),keyboardByWindow,cspByWindow,
    coverageMatrix:coverageMatrix[scenario],productScope:{roots:['apps/desktop','packages/solo-core','packages/protocol','packages/content','assets','dist'],
      files:Object.keys(hashesAtStart).length,excluded:['tests/native-camp-inner-0110-luna.ts','tests/native-camp-inner-0110-luna-bootstrap.cjs',
        'tests/run-native-camp-inner-0110-luna.sh','dist/native-camp-inner-0110-luna.cjs','dist/tests']},
    productHashesAtStart:hashesAtStart,productHashesAtEnd:status==='RUNNING'?undefined:productHashes(),
    rawError:error?String(error):undefined,stack:error instanceof Error?error.stack:undefined,
    evidenceBoundary:{windowPolicy:'The bootstrap ran before DesktopShell loaded; Electron activation/focus, BrowserWindow show/showInactive/focus/moveTop/restore, webContents.focus, Dock activation, Tray UI and globalShortcut registration were blocked. No native window was shown or focused.',
      input:'Only HTMLElement.click(), coordinate MouseEvent/PointerEvent dispatched to the actual elementFromPoint target, programmatic select value/change events, software ShellState IPC and app lifecycle events, worker test-clock requests, CDP viewport/media emulation and hidden capturePage were used. No physical mouse/keyboard evidence is claimed.',
      profile:'A fresh /private/tmp profile was marked and parseProfile-preflighted before startDesktop. No installed-app profile, old application data directory or real progress file was opened.',
      documentVisibility:'Any renderer document.hidden/visibilityState/hasFocus getter overrides are explicitly recorded in checks and restored in finally blocks.',
      productIntegrity:'Per-run SHA-256 inventories cover product source and runtime, including assets/inner-0110; the dedicated harness bundle and dist/tests are excluded.'},
  };
  fs.writeFileSync(reportPath,JSON.stringify(record,null,2)+'\n',{flag:'wx',mode:0o600});
  fs.appendFileSync(path.join(evidenceDir,`progress-${scenario}-${runId}.jsonl`),JSON.stringify({at:new Date().toISOString(),status,reportPath,errors,harnessIssues})+'\n',{mode:0o600});
}
function check(name:string,detail?:unknown,result:'PASS'|'FAIL'|'INFO'='PASS'):void{
  checks.push({name,status:result,detail});
  if(result==='FAIL')fs.appendFileSync(path.join(evidenceDir,`progress-${scenario}-${runId}.jsonl`),JSON.stringify({at:new Date().toISOString(),name,status:result,detail})+'\n',{mode:0o600});
}
async function until(fn:()=>Promise<boolean>|boolean,label:string,timeout=25_000):Promise<void>{
  const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await new Promise(resolve=>setTimeout(resolve,35));}
  throw new Error('timeout: '+label);
}
async function js<T=unknown>(win:BrowserWindowType,source:string):Promise<T>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([win.webContents.executeJavaScript(source) as Promise<T>,
    new Promise<T>((_resolve,reject)=>{timer=setTimeout(()=>reject(new Error('renderer evaluation timed out on '+win.id)),15_000);})]);}
  finally{if(timer)clearTimeout(timer);}
}
async function instrument(win:BrowserWindowType):Promise<void>{
  await js(win,'(()=>{if(window.__campInner0110Instrumented)return true;window.__campInner0110Instrumented=true;window.__campInner0110Keys=0;window.__campInner0110Csp=[];window.__campInner0110State={revision:0,workingElsewhere:null,mode:null,shellRevision:null};for(const t of ["keydown","keyup","keypress"])document.addEventListener(t,()=>window.__campInner0110Keys++,true);document.addEventListener("securitypolicyviolation",e=>window.__campInner0110Csp.push({directive:e.violatedDirective,blocked:e.blockedURI,sample:e.sample}),true);window.__campInner0110Unsubscribe=window.street?.subscribe?.(state=>{window.__campInner0110State={revision:(window.__campInner0110State?.revision||0)+1,workingElsewhere:state.workingElsewhere,mode:state.mode,shellRevision:state.revision};});return true})()');
}
function track(win:BrowserWindowType):void{
  if(traces.has(win.id))return;
  const visible=win.isVisible.bind(win),focused=win.isFocused.bind(win);
  traces.set(win.id,{id:win.id,page:page(win),visible,focused,last:{isVisible:visible(),isFocused:focused()}});
  keyboardByWindow[win.id]=0;cspByWindow[win.id]=[];
  win.webContents.on('console-message',(event:any)=>{
    const message=String(event.message);if(event.level==='error')errors.push(message.slice(0,800));
    if(/Content Security Policy|style-src|Refused to apply inline style/i.test(message))cspByWindow[win.id].push(message.slice(0,800));
  });
  win.webContents.on('did-finish-load',()=>{const row=traces.get(win.id);if(row)row.page=page(win);void instrument(win).catch(error=>{harnessIssues.push('instrument '+win.id+': '+String(error));});});
}
function overlay():BrowserWindowType{assert.ok(shell&&!shell.overlay.isDestroyed(),'street overlay missing');return shell.overlay;}
function profile():Profile{const value=shell?.game.state.profile;assert.ok(value,'profile unavailable: '+(shell?.game.state.error||'loading'));return value;}
function assertLoadedFixture(actual:Profile,fixture:Profile):void{
  assert.deepEqual(actual,advance(fixture,actual.wallAt),'worker must load the generated fixture advanced to its first wall-clock timestamp');
}
async function clickElement(win:BrowserWindowType,id:string):Promise<void>{
  assert.ok(await js<boolean>(win,'!!document.getElementById('+JSON.stringify(id)+')'),id+' missing');
  await js(win,'document.getElementById('+JSON.stringify(id)+').click()');
}
async function clickAtControl(win:BrowserWindowType,id:string):Promise<{x:number;y:number;hitTag:string;hitId:string|null;buttonId:string|null}> {
  const hit=await js<{ok:boolean;x:number;y:number;hitTag:string;hitId:string|null;buttonId:string|null}>(win,'(()=>{const e=document.getElementById('+JSON.stringify(id)+'),r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,hit=document.elementFromPoint(x,y),button=hit?.closest("button");if(button!==e)return{ok:false,x,y,hitTag:hit?.tagName||"",hitId:hit?.id||null,buttonId:button?.id||null};hit.dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true,view:window,clientX:x,clientY:y,button:0}));return{ok:true,x,y,hitTag:hit.tagName,hitId:hit.id||null,buttonId:button.id}})()');
  assert.ok(hit.ok,id+' center hit-test was intercepted: '+JSON.stringify(hit));
  return{x:hit.x,y:hit.y,hitTag:hit.hitTag,hitId:hit.hitId,buttonId:hit.buttonId};
}
async function setViewport(win:BrowserWindowType,width:number,height:number):Promise<{width:number;height:number;nativeWidth:number;nativeHeight:number}> {
  const api=win.webContents.debugger,wasAttached=api.isAttached();
  try{if(!wasAttached){api.attach('1.3');viewportSessions.set(win.id,{wasAttached});}await api.sendCommand('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    await new Promise(resolve=>setTimeout(resolve,100));const result=await js<{width:number;height:number}>(win,'({width:innerWidth,height:innerHeight})');
    return{...result,nativeWidth:win.getBounds().width,nativeHeight:win.getBounds().height};
  }catch(error){if(!wasAttached&&api.isAttached()){api.detach();viewportSessions.delete(win.id);}throw error;}
}
async function clearViewport(win:BrowserWindowType):Promise<void>{
  const api=win.webContents.debugger,session=viewportSessions.get(win.id);
  try{await api.sendCommand('Emulation.clearDeviceMetricsOverride');}finally{if(session&&!session.wasAttached&&api.isAttached())api.detach();viewportSessions.delete(win.id);}
}
function casual():BrowserWindowType{const win=shell?.arenaWindow;assert.ok(win&&!win.isDestroyed(),'casual window missing');return win;}
async function openCasual():Promise<BrowserWindowType>{
  const street=overlay();await until(()=>js<boolean>(street,'!!document.getElementById("dungeonSign")'),'visible portal node exists on hidden street renderer');
  await clickElement(street,'dungeonSign');await until(()=>!!shell?.arenaWindow&&!shell.arenaWindow.isDestroyed(),'hidden casual BrowserWindow created');
  const win=casual();await until(()=>js<boolean>(win,'document.body.dataset.casualReady==="true"'),'casual renderer ready');await instrument(win);
  assert.equal(page(win),'casual');assert.equal(win.isVisible(),false);assert.equal(win.isFocused(),false);
  await until(()=>js<boolean>(win,'!!document.getElementById("campScene")'),'camp scene module mounted');
  check('hidden casual native window loaded with scene; portal input was software DOM click',{page:page(win),bounds:win.getBounds(),native:{isVisible:win.isVisible(),isFocused:win.isFocused()},input:'HTMLElement.click()'});
  return win;
}
async function control(win:BrowserWindowType,id:string):Promise<Control>{
  return js(win,'(()=>{const e=document.getElementById('+JSON.stringify(id)+'),c=e?.closest(".cs-scroll")||e?.closest("#cContent")||e?.closest(".cs-home")||document.documentElement,hidden=!e||e.hidden||!!e.closest("[hidden]")||getComputedStyle(e).display==="none";if(!hidden){e.scrollIntoView({block:"nearest",inline:"nearest"});}const r=e?.getBoundingClientRect(),cr=c?.getBoundingClientRect(),s=e?getComputedStyle(e):null,hit=r?document.elementFromPoint(r.left+r.width/2,r.top+r.height/2):null;return{exists:!!e,hidden,disabled:!e||e.disabled,label:e?.getAttribute("aria-label")||e?.textContent?.trim()||"",tip:e?.dataset.tooltip||e?.title||"",cursor:s?.cursor||"",font:s?parseFloat(s.fontSize):0,gameButton:!!e?.classList.contains("game-button"),reachable:!hidden&&!!r&&!!cr&&r.width>0&&r.height>0&&r.top>=cr.top-.5&&r.bottom<=cr.bottom+.5&&hit?.closest("button")===e,rect:r?{x:r.x,y:r.y,width:r.width,height:r.height}:{x:0,y:0,width:0,height:0},container:{scrollWidth:c?.scrollWidth||0,clientWidth:c?.clientWidth||0,scrollHeight:c?.scrollHeight||0,clientHeight:c?.clientHeight||0}}})()') as Promise<Control>;
}
async function assertControl(win:BrowserWindowType,id:string,enabled=true):Promise<Control>{
  const state=await control(win,id);assert.ok(state.exists&&!state.hidden,id+' missing/hidden: '+JSON.stringify(state));
  assert.equal(state.disabled,!enabled,id+' disabled state');assert.ok(state.gameButton,id+' is not a GameButton');
  assert.ok(state.tip.trim(),id+' lacks tooltip or disabled reason');assert.ok(state.font>=16,id+' font below 16px: '+state.font);
  assert.equal(state.cursor,enabled?'pointer':'not-allowed',id+' cursor');if(enabled)assert.ok(state.reachable,id+' is outside its scroll viewport: '+JSON.stringify(state));return state;
}
async function localClick(win:BrowserWindowType,id:string):Promise<void>{
  const state=await assertControl(win,id,true),hit=await clickAtControl(win,id);
  check('software coordinate-dispatched UI click '+id,{label:state.label,tooltip:state.tip,rect:state.rect,hit,input:'MouseEvent dispatched at actual elementFromPoint target; software-only'});
}
async function actionClick(win:BrowserWindowType,id:string):Promise<Profile>{
  const state=await assertControl(win,id,true),before=profile().sequence,hit=await clickAtControl(win,id);
  await until(()=>profile().sequence===before+1,id+' authoritative GameWorker receipt');
  const after=profile();check('software action '+id,{label:state.label,tooltip:state.tip,hit,sequenceBefore:before,sequenceAfter:after.sequence,notice:after.notice,input:'MouseEvent dispatched at actual elementFromPoint target; software-only'});return after;
}
async function disabled(win:BrowserWindowType,id:string,reason?:RegExp):Promise<Control>{
  const state=await assertControl(win,id,false);if(reason)assert.match(state.tip,reason,id+' disabled explanation');
  check('visible disabled action '+id,state);return state;
}
async function backToScene(win:BrowserWindowType):Promise<void>{
  await until(()=>js<boolean>(win,'document.getElementById("cCampHome")?.hidden===true&&document.getElementById("cCampWorkspace")?.hidden===false'),'detail workspace opened');
  await clickElement(win,'cCampBack');await until(()=>js<boolean>(win,'document.getElementById("cCampHome")?.hidden===false&&document.getElementById("cCampWorkspace")?.hidden===true'),'return to camp scene');
  assert.equal(win.isVisible(),false);assert.equal(win.isFocused(),false);
}
async function enter(win:BrowserWindowType,id:string,panel:string,buddy?:Companion,detailId?:string):Promise<void>{
  await openDetail(win,id,panel,buddy,detailId);await backToScene(win);
}
async function openDetail(win:BrowserWindowType,id:string,panel:string,buddy?:Companion,detailId?:string):Promise<void>{
  await localClick(win,id);await until(()=>js<boolean>(win,'document.getElementById('+JSON.stringify(panel)+')&&!document.getElementById('+JSON.stringify(panel)+').hidden'),id+' expected detail '+panel);
  if(buddy&&panel==='lifePanel-jobs'){
    const slot=id.replace('csBuddy-','') as 'counter'|'workshop'|'garden';
    assert.ok(['counter','workshop','garden'].includes(slot),id+' job companion entrance must identify its slot');
    const detail=await js<{selected:string;summary:string}>(win,'(()=>({selected:document.getElementById('+JSON.stringify('lifeJobChoice-'+slot)+').value,summary:document.getElementById('+JSON.stringify('lifeJobState-'+slot)+').textContent||""}))()');
    assert.equal(detail.selected,buddy,id+' jobs page must show the actual assigned '+slot+' companion');
    assert.ok(detail.summary.includes(COMPANIONS[buddy].name),id+' jobs detail must name '+buddy+': '+detail.summary);
  }else if(buddy){const selected=await js<boolean>(win,'document.getElementById('+JSON.stringify('cBuddyPick-'+buddy)+')?.getAttribute("aria-pressed")==="true"');assert.equal(selected,true,id+' must select '+buddy);}
  if(detailId){const detail=await control(win,detailId);assert.ok(detail.exists&&!detail.hidden,detailId+' must be visible in the selected detail page');}
  check('scene entrance opens intended existing page',{id,panel,buddy,detailId,workspace:await js(win,'({homeHidden:document.getElementById("cCampHome").hidden,workspaceHidden:document.getElementById("cCampWorkspace").hidden})')});
}
async function advanceWorker(ms:number,label:string):Promise<Profile>{
  assert.ok(shell);const before=profile(),result=await shell.game.request('advance',{ms});assert.ok(result.profile);
  await new Promise(resolve=>setTimeout(resolve,90));await sendState(casual(),{},'hidden arena renderer sync after worker clock '+label);
  check('worker-only test clock '+label,{ms,tickBefore:before.tick,tickAfter:result.profile!.tick,sequenceBefore:before.sequence,sequenceAfter:result.profile!.sequence,input:'GameRuntime test clock; not elapsed user time',rendererSync:'direct software ShellState delivery because hidden arena is excluded from Shell.broadcast'});return result.profile!;
}
async function capture(win:BrowserWindowType,label:string):Promise<void>{
  await new Promise(resolve=>setTimeout(resolve,220));const image=await win.webContents.capturePage(),size=image.getSize(),bytes=image.toPNG();
  assert.ok(bytes.length>8_000,'hidden capturePage returned too few bytes: '+bytes.length);
  const file=path.join(evidenceDir,`native-${scenario}-${runId}-${label}.png`);fs.writeFileSync(file,bytes,{flag:'wx',mode:0o600});screenshots.push(file);screenshotsForReport.push(file);
  assert.equal(win.isVisible(),false,'capture target became visible');assert.equal(win.isFocused(),false,'capture target became focused');
  check('hidden native capturePage '+label,{file,size,bytes:bytes.length,native:{isVisible:win.isVisible(),isFocused:win.isFocused()},boundary:'software-rendered hidden pixels; not visible or physical evidence'});
}
async function auditScene(win:BrowserWindowType,label:string):Promise<void>{
  const audit=await js<{width:number;height:number;scrollWidth:number;scene:{motion:string;stageWidth:number;scrollWidth:number;clientWidth:number;scrollLeft:number};buttons:Array<{id:string;hidden:boolean;disabled:boolean;tip:string;cursor:string;font:number;gameButton:boolean}>;duplicates:string[]}>(win,'(()=>{const s=document.getElementById("campScene"),sc=s.querySelector(".cs-scroll"),buttons=[...s.querySelectorAll("button[id]")].map(e=>({id:e.id,hidden:e.hidden||!!e.closest("[hidden]")||getComputedStyle(e).display==="none",disabled:e.disabled,tip:e.dataset.tooltip||e.title||"",cursor:getComputedStyle(e).cursor,font:parseFloat(getComputedStyle(e).fontSize),gameButton:e.classList.contains("game-button")})),ids=[...document.querySelectorAll("[id]")].map(e=>e.id);return{width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scene:{motion:s.dataset.motion,stageWidth:s.querySelector(".cs-stage").getBoundingClientRect().width,scrollWidth:sc.scrollWidth,clientWidth:sc.clientWidth,scrollLeft:sc.scrollLeft},buttons,duplicates:[...new Set(ids.filter((id,i)=>ids.indexOf(id)!==i))]}})()');
  assert.ok(audit.scrollWidth<=audit.width+1,label+' page horizontal overflow '+JSON.stringify(audit));assert.deepEqual(audit.duplicates,[],label+' duplicate IDs');
  for(const b of audit.buttons.filter(x=>!x.hidden)){assert.ok(b.tip.trim(),b.id+' lacks tooltip');assert.ok(b.font>=16,b.id+' below 16px');assert.ok(b.gameButton,b.id+' not GameButton');assert.equal(b.cursor,b.disabled?'not-allowed':'pointer',b.id+' cursor mismatch');}
  check('scene readable controls, stable IDs and no page overflow '+label,audit);
}
async function stableScene(win:BrowserWindowType):Promise<void>{
  const ids=['csLodge','csKitchen','csArchive','csTent','csFire','csMap','csPack','csPlot0','csPlot1','csPlot2','csBuddy-leader','csBuddy-support','csBuddy-counter','csBuddy-workshop','csBuddy-garden','csVisitor0','csVisitor1','csVisitor2','csJourney','csLootDetails','csClaim','csJobs','csLetters','cCampBack'];
  await js(win,'window.__campStableRefs=Object.fromEntries('+JSON.stringify(ids)+'.map(id=>[id,document.getElementById(id)]))');
  for(const id of ids)assert.ok(await js<boolean>(win,'!!document.getElementById('+JSON.stringify(id)+')'),id+' node absent');
  check('scene DOM reference baseline captured',{ids});
}
async function assertStableScene(win:BrowserWindowType,label:string):Promise<void>{
  const changed=await js<string[]>(win,'(()=>Object.entries(window.__campStableRefs||{}).filter(([id,node])=>node!==document.getElementById(id)).map(([id])=>id))()');
  assert.deepEqual(changed,[],label+' scene DOM nodes were replaced under pointer targets');
}
async function auditProfileBoundary():Promise<void>{
  assert.ok(preflight);const persisted=new GameStore(path.join(profileRoot,'solo')).value;assert.deepEqual(persisted,profile(),'only this isolated profile persisted');
  assert.equal(fs.readFileSync(path.join(profileRoot,'.pixelstreet-isolated-profile.json'),'utf8').includes('isolated-playtest'),true);
  check('private marked profile remains the only profile opened and persisted',{profileRoot,profileFile,sequence:profile().sequence,marker:path.join(profileRoot,'.pixelstreet-isolated-profile.json')});
}
function makeFreshProfile(now:number):Profile{return parseProfile(initialProfile(now));}
function makeRichProfile(now:number):Profile{
  const p=initialProfile(now);p.tick=1_000;p.wallAt=now;p.xp=4_500;p.coins=200_000;
  p.leisure.clears=[10,10,10,10,10];p.leisure.companions=Object.fromEntries((Object.keys(COMPANIONS) as Companion[]).map(id=>[id,5])) as Profile['leisure']['companions'];
  p.leisure.active='slime';p.leisure.bonds=initialBonds();p.leisure.bonds.support='guide';p.leisure.bonds.letterSequence=1;p.leisure.bonds.letters=[{id:1,zone:0}];
  p.leisure.bonds.satchel.herb=2;p.leisure.bonds.satchel.dust=1;p.leisure.bonds.satchel.tokens=2;
  p.leisure.materials={...p.leisure.materials,herb:100,berry:100,mushroom:100,ore:250,pumpkin:100,snowflower:100,tea:100,biscuit:100,soup:100,pie:100,snowtea:100};
  p.bag.flour=10;
  p.leisure.gardenLevel=2;
  p.leisure.journal.buildings={lodge:3,workshop:3,archive:3};
  p.leisure.plots=[{crop:'herb',due:999},{crop:'berry',due:1_000},{crop:'pumpkin',due:1_100}];
  p.camp=initialCamp();p.camp.jobs={counter:'fox',workshop:'bear',garden:'deer'};
  p.camp.last={kitchen:{id:'biscuit',count:1}};p.camp.lastJourney={zone:0,route:'balanced',trips:1,depth:0,secret:false};
  p.leisure.materials.pumpkin=9_999-(CROPS.pumpkin.yield+p.leisure.gardenLevel+jobPower(p,'garden'))+1;
  p.leisure.cargo={coins:55,xp:12,gel:3,ore:5};
  return parseProfile(p);
}
function makeClaimOnlyProfile(now:number):Profile{
  const p=initialProfile(now);p.leisure.bonds=initialBonds();p.leisure.bonds.satchel.berry=3;p.leisure.bonds.satchel.dust=2;p.leisure.bonds.satchel.tokens=4;
  return parseProfile(p);
}
function makeClaimFullProfile(now:number):Profile{
  const p=initialProfile(now);p.leisure.materials.ore=9_999;p.leisure.cargo={coins:12,xp:7,gel:0,ore:1};
  return parseProfile(p);
}
function makeProfile():Profile{
  const now=Date.now();return scenario==='inner'?makeInnerProfile(now):parseProfile(scenario==='fresh'?makeFreshProfile(now):scenario==='rich'?makeRichProfile(now):scenario==='claim-only'?makeClaimOnlyProfile(now):makeClaimFullProfile(now));
}
function makeInnerProfile(now:number):Profile{
  const p=initialProfile(now);
  p.tick=1_000;p.wallAt=now;p.coins=250_000;p.xp=9_000;
  p.leisure.clears=[50,50,50,50,50];
  p.leisure.companions=Object.fromEntries(Object.keys(COMPANIONS).map(id=>[id,5])) as Profile['leisure']['companions'];
  p.leisure.active='slime';p.leisure.bonds=initialBonds();p.leisure.bonds.support='guide';
  p.leisure.journal.buildings={lodge:0,workshop:0,archive:0};
  p.leisure.journal.relics=Array(15).fill(1);p.leisure.journal.dust=500;
  p.leisure.journal.contracts=[2,2,2];p.leisure.journal.deliveries=6;
  p.leisure.materials={...p.leisure.materials,herb:9_998,berry:500,mushroom:500,ore:9_000,pumpkin:500,snowflower:500,tea:20,biscuit:20,soup:20,pie:20,snowtea:20};
  p.leisure.plots=[null,null,null];p.leisure.gardenLevel=0;p.leisure.harvests=1;p.leisure.cooked=0;
  p.leisure.run=null;p.leisure.cargo={coins:0,xp:0,gel:0,ore:0};
  p.bag.flour=100;p.bag.gel=100;p.camp=initialCamp();
  return parseProfile(p);
}
async function assertSceneFirstView(win:BrowserWindowType):Promise<void>{
  const view=await js<{homeHidden:boolean;workspaceHidden:boolean;stageWidth:number;plotStates:string[];roles:Record<string,boolean>;lettersHidden:boolean}>(win,'(()=>({homeHidden:document.getElementById("cCampHome").hidden,workspaceHidden:document.getElementById("cCampWorkspace").hidden,stageWidth:document.querySelector(".cs-stage").getBoundingClientRect().width,plotStates:[0,1,2].map(i=>document.getElementById("csPlot"+i).dataset.state||""),roles:Object.fromEntries(["leader","support","counter","workshop","garden"].map(r=>[r,!document.getElementById("csBuddy-"+r).hidden])),lettersHidden:document.getElementById("csLetters").hidden}))()');
  assert.equal(view.homeHidden,false);assert.equal(view.workspaceHidden,true);check('first casual view is the interactive camp scene',view);
}
async function testFresh():Promise<void>{
  let win=await openCasual();await assertSceneFirstView(win);await auditScene(win,'fresh-default');await stableScene(win);
  const state=await js<{plots:Array<{hidden:boolean;cropHidden:boolean}>;roles:Record<string,boolean>;claimDisabled:boolean;buttons:number}>(win,'(()=>({plots:[0,1,2].map(i=>({hidden:document.getElementById("csCrop"+i).hidden,cropHidden:document.getElementById("csCrop"+i).hidden})),roles:Object.fromEntries(["leader","support","counter","workshop","garden"].map(r=>[r,!document.getElementById("csBuddy-"+r).hidden])),claimDisabled:document.getElementById("csClaim").disabled,buttons:document.querySelectorAll("#campScene button").length}))()');
  assert.equal(state.plots.some(x=>!x.cropHidden),false,'fresh camp must not draw invented crops');assert.deepEqual(state.roles,{leader:true,support:false,counter:false,workshop:false,garden:false});assert.equal(state.claimDisabled,true);
  assert.equal(Object.hasOwn(profile(),'camp'),false);assert.equal(Object.hasOwn(profile().leisure,'bonds'),false);await disabled(win,'csClaim',/战利品箱还是空的/);
  await setViewport(win,760,650);try{const compact=await js<{width:number;pageWidth:number;scrollWidth:number;clientWidth:number;stageWidth:number}>(win,'(()=>{const sc=document.querySelector(".cs-scroll");return{width:innerWidth,pageWidth:document.documentElement.scrollWidth,scrollWidth:sc.scrollWidth,clientWidth:sc.clientWidth,stageWidth:document.querySelector(".cs-stage").getBoundingClientRect().width}})()');
    assert.equal(compact.width,760);assert.ok(compact.pageWidth<=760+1,'760px scene page horizontally overflows');assert.ok(compact.scrollWidth>compact.clientWidth,'stage should scroll internally at 760px');check('760px renderer keeps page within viewport and scrolls the wide scene internally',{...compact,viewport:'CDP software metrics emulation'});await capture(win,'fresh-760');
  }finally{await clearViewport(win);}

  const allNav:[string,string,string?,Companion?][]=[
    ['csLodge','lifePanel-growth'],['csKitchen','cPanel-kitchen'],['csArchive','cPanel-collection'],['csTent','cPanel-friends'],
    ['csFire','lifePanel-crew'],['csMap','cPanel-adventure'],['csPack','cPanel-collection'],['csJourney','cPanel-adventure'],
    ['csLootDetails','cPanel-adventure'],['csJobs','lifePanel-jobs'],['csPlot0','cPanel-garden'],['csVisitor0','cPanel-kitchen','cDeliver0'],
    ['csVisitor1','cPanel-kitchen','cDeliver1'],['csVisitor2','cPanel-kitchen','cDeliver2'],['csBuddy-leader','cPanel-friends',undefined,'slime'],
  ];
  for(const [id,panel,detail,buddy] of allNav)await enter(win,id,panel,buddy,detail);
  for(const id of ['csBuddy-support','csBuddy-counter','csBuddy-workshop','csBuddy-garden'])assert.equal((await control(win,id)).hidden,true,id+' must be absent for empty role');
  await openDetail(win,'csMap','cPanel-adventure');
  for(const tab of ['adventure','garden','kitchen','friends','camp','collection']){
    await localClick(win,'cTab-'+tab);await until(()=>js<boolean>(win,'!document.getElementById('+JSON.stringify('cPanel-'+tab)+').hidden'),'legacy tab '+tab);
    check('legacy tab remains reachable '+tab,{panel:'cPanel-'+tab});
  }
  await localClick(win,'cTab-camp');await until(()=>js<boolean>(win,'!document.getElementById("cPanel-camp").hidden'),'legacy camp tab');
  for(const tab of ['growth','overview','production','jobs','crew']){
    await localClick(win,'lifeTab-'+tab);await until(()=>js<boolean>(win,'!document.getElementById('+JSON.stringify('lifePanel-'+tab)+').hidden'),'legacy camp panel '+tab);
    check('legacy camp management panel remains reachable '+tab,{panel:'lifePanel-'+tab});
  }
  await localClick(win,'cTab-adventure');await clickElement(win,'cLifeOpen');await until(()=>js<boolean>(win,'!document.getElementById("cCampWorkspace").hidden&&!document.getElementById("lifePanel-growth").hidden'),'old growth shortcut opens workspace');
  check('legacy growth shortcut opens from the scene-era adventure page',{shortcut:'cLifeOpen'});await backToScene(win);
  await openDetail(win,'csKitchen','cPanel-kitchen');await clickElement(win,'cCookingOpen');await until(()=>js<boolean>(win,'!document.getElementById("lifePanel-production").hidden'),'old kitchen shortcut opens production');
  check('legacy cooking shortcut opens production from the kitchen page',{shortcut:'cCookingOpen'});await backToScene(win);
  await assertStableScene(win,'fresh routes and repeats');
  const seq=profile().sequence;assert.equal(win.isVisible(),false);assert.equal(win.isFocused(),false);await clickElement(win,'cClose');await until(()=>!shell?.arenaWindow,'fresh casual close');check('fresh casual closes after hidden/unfocused native boundary',{closed:win.isDestroyed(),native:{isVisible:false,isFocused:false}});
  assert.deepEqual(new GameStore(path.join(profileRoot,'solo')).value,profile());assert.equal(profile().sequence,seq);win=await openCasual();await assertSceneFirstView(win);
  await clickElement(win,'cClose');await until(()=>!shell?.arenaWindow,'fresh second close');win=await openCasual();await assertSceneFirstView(win);
  assert.equal(Object.hasOwn(profile(),'camp'),false);assert.equal(Object.hasOwn(profile().leisure,'bonds'),false);await auditProfileBoundary();await capture(win,'fresh-reopened');
}
async function testEntrances(win:BrowserWindowType):Promise<void>{
  const entries:[string,string,string?,Companion?][]=[
    ['csLodge','lifePanel-growth'],['csKitchen','cPanel-kitchen'],['csArchive','cPanel-collection'],['csTent','cPanel-friends'],
    ['csFire','lifePanel-crew'],['csMap','cPanel-adventure'],['csPack','cPanel-collection'],['csJourney','cPanel-adventure'],
    ['csLootDetails','cPanel-adventure'],['csJobs','lifePanel-jobs'],['csBuddy-leader','cPanel-friends',undefined,'slime'],
    ['csBuddy-support','cPanel-friends',undefined,'guide'],['csBuddy-counter','lifePanel-jobs',undefined,'fox'],
    ['csBuddy-workshop','lifePanel-jobs',undefined,'bear'],['csBuddy-garden','lifePanel-jobs',undefined,'deer'],
    ['csVisitor0','cPanel-kitchen','cDeliver0'],['csVisitor1','cPanel-kitchen','cDeliver1'],['csVisitor2','cPanel-kitchen','cDeliver2'],
    ['csLetters','cPanel-adventure','cLetter0'],
  ];
  for(const [id,panel,detail,buddy] of entries)await enter(win,id,panel,buddy,detail);
}
async function testHarvestAndGarden(win:BrowserWindowType):Promise<void>{
  for(const plot of [0,1]){
    const before=profile(),record=before.leisure.plots[plot];assert.ok(record);const expected=CROPS[record.crop].yield+before.leisure.gardenLevel+jobPower(before,'garden');
    const id='csPlot'+plot,button=await assertControl(win,id,true),hit=await clickAtControl(win,id);await until(()=>profile().sequence===before.sequence+1,id+' real scene harvest');
    assert.equal(profile().leisure.materials[record.crop],before.leisure.materials[record.crop]+expected,record.crop+' harvest yield');assert.equal(profile().leisure.plots[plot],null);assert.equal(profile().leisure.harvests,before.leisure.harvests+1);
    check('scene harvest matches authoritative crop yield and job power',{id,crop:record.crop,expected,actual:profile().leisure.materials[record.crop]-before.leisure.materials[record.crop],tooltip:button.tip,hit});
  }
  const growingBefore=profile().sequence;await localClick(win,'csPlot2');await until(()=>js<boolean>(win,'!document.getElementById("cCampWorkspace").hidden&&!document.getElementById("cPanel-garden").hidden'),'growing plot opens legacy garden');
  assert.equal(profile().sequence,growingBefore,'opening a growing plot does not harvest it');check('growing crop opens its specific existing garden page without a harvest action',{plot:profile().leisure.plots[2],page:'cPanel-garden'});await backToScene(win);
  const plot=profile().leisure.plots[2];assert.ok(plot);const remaining=Math.max(0,plot.due-profile().tick);if(remaining)await advanceWorker(remaining*100,'third crop reaches maturity under the worker test clock');
  assert.equal(profile().tick>=plot.due,true,'pumpkin reaches its actual due tick');
  await until(()=>js<boolean>(win,'(()=>{const e=document.getElementById("csPlot2");return e.dataset.state==="ready"&&e.disabled&&/作物背包已满/.test(e.dataset.tooltip||"")})()'),'renderer reflects mature crop and full-bag rejection');
  const blocked=await disabled(win,'csPlot2',/作物背包已满/),beforeFull=structuredClone(profile());await clickElement(win,'csPlot2');await new Promise(resolve=>setTimeout(resolve,100));assert.deepEqual(profile(),beforeFull,'full bag harvest is rejected without partial clear');
  check('full crop bag retains mature plot and all profile fields',{plot:profile().leisure.plots[2],reason:blocked.tip,sequence:profile().sequence});
  await openDetail(win,'csPlot0','cPanel-garden');
  await localClick(win,'cSeed-mushroom');const plant=profile(),seq=plant.sequence;await actionClick(win,'cPlant0');assert.equal(profile().leisure.plots[0]?.crop,'mushroom');assert.equal(profile().sequence,seq+1);
  const due=profile().leisure.plots[0]!.due,target=Math.max(1,due-profile().tick);await advanceWorker(target*100,'mushroom crop reaches mature tick');const beforeHarvest=profile(),amount=CROPS.mushroom.yield+beforeHarvest.leisure.gardenLevel+jobPower(beforeHarvest,'garden');await actionClick(win,'cHarvest0');
  assert.equal(profile().leisure.materials.mushroom,beforeHarvest.leisure.materials.mushroom+amount);assert.equal(profile().leisure.plots[0],null);
  check('legacy garden planting and harvest remain functional through existing buttons',{crop:'mushroom',amount,plot:profile().leisure.plots[0]});await backToScene(win);
}
async function testContracts(win:BrowserWindowType):Promise<void>{
  for(const slot of [0,1,2]){
    const contract=contractAt(profile(),slot),before=structuredClone(profile());await openDetail(win,'csVisitor'+slot,'cPanel-kitchen',undefined,'cDeliver'+slot);
    const title=await js<string>(win,'document.getElementById("cContractName"+'+slot+').textContent');assert.equal(title,contract.name,'visitor should point at that slot exact contract');
    const id='cDeliver'+slot;await assertControl(win,id,true);await actionClick(win,id);
    assert.equal(profile().leisure.journal.contracts[slot],before.leisure.journal.contracts[slot]+1);assert.equal(profile().leisure.journal.deliveries,before.leisure.journal.deliveries+1);
    for(const [material,count]of Object.entries(contract.items))assert.equal(profile().leisure.materials[material as keyof typeof MATERIALS],before.leisure.materials[material as keyof typeof MATERIALS]-count,`slot ${slot} exact material delta`);
    assert.equal(profile().coins,before.coins+contract.coins);assert.equal(profile().leisure.materials.ore,before.leisure.materials.ore+contract.ore);
    assert.equal(profile().leisure.journal.dust,before.leisure.journal.dust+contract.dust);
    check('scene visitor delivers only the exact authoritative contract slot',{slot,contract:contract.name,items:contract.items,coins:contract.coins,ore:contract.ore,dust:contract.dust});await backToScene(win);
  }
}
async function testTravelLetter(win:BrowserWindowType):Promise<void>{
  const before=structuredClone(profile());assert.equal(before.leisure.bonds?.letters.length,1);await openDetail(win,'csLetters','cPanel-adventure',undefined,'cLetter0');
  const title=await js<string>(win,'document.getElementById("cLetterTitle0").textContent');assert.ok(title.includes('古树心室'));
  await actionClick(win,'cLetterSupplies0');assert.equal(profile().leisure.materials.herb,before.leisure.materials.herb+2);assert.equal(profile().leisure.bonds?.letters.length,0);
  check('visible travel letter choice stores its real two-crop gift once',{title,herbBefore:before.leisure.materials.herb,herbAfter:profile().leisure.materials.herb});await backToScene(win);
}
async function testOldKitchenAndCamp(win:BrowserWindowType):Promise<void>{
  await openDetail(win,'csKitchen','cPanel-kitchen');await localClick(win,'cTab-kitchen');await until(()=>js<boolean>(win,'!document.getElementById("cPanel-kitchen").hidden'),'legacy kitchen panel');
  const before=profile(),queued=before.leisure.materials.berry;await actionClick(win,'cCook1-biscuit');assert.equal(campOf(profile()).cooking.length,1);assert.equal(profile().leisure.materials.berry,queued-2);
  await clickElement(win,'cCookingOpen');await until(()=>js<boolean>(win,'!document.getElementById("lifePanel-production").hidden'),'production page opens');
  const batch=campOf(profile()).cooking[0],berryAfterQueue=profile().leisure.materials.berry;await actionClick(win,'lifeCancelFood0');assert.equal(campOf(profile()).cooking.length,0);assert.equal(profile().leisure.materials.berry,berryAfterQueue+2);
  check('legacy kitchen queue can be cancelled from camp production page with exact material refund',{batch,berryAfter:profile().leisure.materials.berry});
  await localClick(win,'lifeTab-overview');await until(()=>js<boolean>(win,'!document.getElementById("lifePanel-overview").hidden'),'overview controls visible for repeat/available actions');
  const oldLast=campOf(profile()).last.kitchen;assert.equal(oldLast?.id,'biscuit');await actionClick(win,'lifeRepeat-kitchen');assert.equal(campOf(profile()).cooking.length,1);
  await localClick(win,'lifeTab-production');await until(()=>js<boolean>(win,'!document.getElementById("lifePanel-production").hidden'),'production queue visible after repeat');await actionClick(win,'lifeCancelFood0');assert.equal(campOf(profile()).cooking.length,0);
  await localClick(win,'lifeTab-overview');await until(()=>js<boolean>(win,'!document.getElementById("lifePanel-overview").hidden'),'overview visible for available production');await actionClick(win,'lifeAvailable-kitchen');assert.ok(campOf(profile()).cooking.length>=1);
  await localClick(win,'lifeTab-production');await until(()=>js<boolean>(win,'!document.getElementById("lifePanel-production").hidden'),'production queue visible after available');await actionClick(win,'lifeCancelFood0');
  check('legacy production repeat/available controls remain real and cancellable',{last:oldLast,cooking:campOf(profile()).cooking.length});
  await clickElement(win,'lifeTab-jobs');await until(()=>js<boolean>(win,'!document.getElementById("lifePanel-jobs").hidden'),'job page visible');
  await js(win,'(()=>{const e=document.getElementById("lifeJobChoice-garden");e.value="none";e.dispatchEvent(new Event("change",{bubbles:true}))})()');await new Promise(resolve=>setTimeout(resolve,60));await actionClick(win,'lifeAssign-garden');assert.equal(campOf(profile()).jobs.garden,null);
  await js(win,'(()=>{const e=document.getElementById("lifeJobChoice-garden");e.value="deer";e.dispatchEvent(new Event("change",{bubbles:true}))})()');await new Promise(resolve=>setTimeout(resolve,60));await actionClick(win,'lifeAssign-garden');assert.equal(campOf(profile()).jobs.garden,'deer');
  await clickElement(win,'lifeTab-crew');await until(()=>js<boolean>(win,'!document.getElementById("lifePanel-crew").hidden'),'crew page visible');await actionClick(win,'lifePresetSave0');assert.ok(campOf(profile()).presets[0]);
  await clickElement(win,'lifeTab-growth');await until(()=>js<boolean>(win,'!document.getElementById("lifePanel-growth").hidden'),'growth page visible');
  const unlockedGifts=Math.min(CAMP_LEVELS.length,CAMP_LEVELS.filter(level=>profile().xp>=level.xp).length);
  while(campOf(profile()).claimed<unlockedGifts){const beforeGift=profile(),gift=CAMP_LEVELS[campOf(beforeGift).claimed];await actionClick(win,'lifeGift');assert.equal(profile().coins,beforeGift.coins+gift.coins,'exact growth-gift coins');assert.equal(profile().leisure.materials.ore,beforeGift.leisure.materials.ore+gift.ore,'exact growth-gift ore');}
  await disabled(win,'lifeGift',unlockedGifts<CAMP_LEVELS.length?/达到下一营地等级/:/所有营地赠礼/);
  await clickElement(win,'lifeTab-overview');await until(()=>js<boolean>(win,'!document.getElementById("lifePanel-overview").hidden'),'overview page visible');
  await localClick(win,'cTab-collection');await until(()=>js<boolean>(win,'!document.getElementById("cPanel-collection").hidden'),'collection panel reachable from camp workspace');
  await localClick(win,'cArchiveOld');await until(()=>js<boolean>(win,'!document.getElementById("cArchivePermanent").hidden'),'permanent archive tab selected');
  const archive=await js<{count:string;newHidden:boolean}>(win,'({count:document.getElementById("cRelicCount").textContent||"",newHidden:document.getElementById("cArchiveRarities").hidden})');assert.ok(archive.count.length>0&&archive.newHidden);check('permanent relic archive remains reachable from the old collection panel',archive);
  await localClick(win,'cArchiveNew');await until(()=>js<boolean>(win,'document.getElementById("cArchivePermanent").hidden'),'new curiosities tab restored');
  await localClick(win,'cTab-camp');await until(()=>js<boolean>(win,'!document.getElementById("cPanel-camp").hidden'),'camp panel restored');
  check('existing overview, jobs, production, crew and growth interactions remain available',{camp:campOf(profile()),coins:profile().coins});await backToScene(win);
}
async function testJourney(win:BrowserWindowType):Promise<void>{
  await openDetail(win,'csMap','cPanel-adventure');
  await localClick(win,'cZone0');await localClick(win,'cRoute-gather');await localClick(win,'cTrips1');const start=await actionClick(win,'cStart');assert.ok(start.leisure.run);const run=structuredClone(start.leisure.run!);
  check('existing adventure map starts a real one-trip run',{run:{zone:run.zone,route:run.route,total:run.total,companion:run.companion,support:run.bonds?.support}});
  await backToScene(win);const away=await js<{leader:{away:string;filter:string;opacity:string};support:{away:string;filter:string;opacity:string};motion:string}>(win,'(()=>{const read=id=>{const e=document.getElementById(id),a=e.querySelector(".cs-buddy-art"),s=getComputedStyle(a);return{away:e.dataset.away,filter:s.filter,opacity:s.opacity}};return{leader:read("csBuddy-leader"),support:read("csBuddy-support"),motion:document.getElementById("campScene").dataset.motion}})()');
  assert.equal(away.leader.away,'true');assert.equal(away.support.away,'true');assert.match(away.leader.filter,/grayscale/);assert.equal(away.leader.opacity,'0.48');check('run snapshot companions are marked away and rendered as still grey shadows',away);
  await openDetail(win,'csJourney','cPanel-adventure',undefined,'cReturn');const firstDue=profile().leisure.run!.due,wait=Math.max(1,firstDue-profile().tick);await advanceWorker(wait*100,'first room settles before an early return');
  assert.ok(profile().leisure.run);assert.ok(profile().leisure.cargo.coins>0||profile().leisure.cargo.xp>0);const cargoBefore=structuredClone(profile().leisure.cargo);
  await actionClick(win,'cReturn');assert.equal(profile().leisure.run,null);assert.deepEqual(profile().leisure.cargo,cargoBefore,'early return preserves already settled loot');check('early return ends only the remaining journey and retains settled cargo',{cargo:cargoBefore});await backToScene(win);
  const before=structuredClone(profile());await actionClick(win,'csClaim');assert.equal(profile().leisure.cargo.coins,0);assert.equal(profile().leisure.cargo.xp,0);assert.equal(profile().coins,before.coins+before.leisure.cargo.coins);assert.equal(profile().xp,before.xp+before.leisure.cargo.xp);
  const claimed=structuredClone(profile());await clickElement(win,'csClaim');await new Promise(resolve=>setTimeout(resolve,100));assert.deepEqual(profile(),claimed,'second claim must not repeat rewards');await disabled(win,'csClaim',/战利品箱还是空的/);
  check('mixed run and bond satchel cargo settles once; second click is a no-op',{before:before.leisure.cargo,after:profile().leisure.cargo,sequence:profile().sequence});
}
async function testRichLayout(win:BrowserWindowType):Promise<void>{
  await setViewport(win,760,650);try{const sample=await js<{width:number;pageWidth:number;stageWidth:number;scrollWidth:number;clientWidth:number;scrollHeight:number;clientHeight:number}>(win,'(()=>{const s=document.querySelector(".cs-scroll");return{width:innerWidth,pageWidth:document.documentElement.scrollWidth,stageWidth:document.querySelector(".cs-stage").getBoundingClientRect().width,scrollWidth:s.scrollWidth,clientWidth:s.clientWidth,scrollHeight:s.scrollHeight,clientHeight:s.clientHeight}})()');
    assert.equal(sample.width,760);assert.ok(sample.pageWidth<=761,'scene page horizontal overflow');assert.ok(sample.scrollWidth>sample.clientWidth,'scene must scroll inside at 760px');check('760px small viewport uses internal scene scrolling without page overflow',{...sample,viewport:'CDP software metrics emulation'});await capture(win,'rich-scene-760');
    await openDetail(win,'csKitchen','cPanel-kitchen');const details=await js<{width:number;pageWidth:number;scrollHeight:number;clientHeight:number}>(win,'(()=>{const e=document.getElementById("cContent");return{width:innerWidth,pageWidth:document.documentElement.scrollWidth,scrollHeight:e.scrollHeight,clientHeight:e.clientHeight}})()');assert.ok(details.pageWidth<=761);assert.ok(details.scrollHeight>=details.clientHeight);check('legacy details remain vertically reachable at compact viewport without page overflow',details);await capture(win,'rich-detail-760');await backToScene(win);
  }finally{await clearViewport(win);}
}
async function captureViewportPair(win:BrowserWindowType,label:string):Promise<void>{
  for(const width of [1040,760]){
    let active=false;
    try{
      await setViewport(win,width,760);active=true;
      const sample=await js<{width:number;height:number;pageWidth:number;contentWidth:number;contentScrollWidth:number;contentClientWidth:number;contentHeight:number;contentClientHeight:number}>(win,'(()=>{const c=document.getElementById("cContent");return{width:innerWidth,height:innerHeight,pageWidth:document.documentElement.scrollWidth,contentWidth:c.getBoundingClientRect().width,contentScrollWidth:c.scrollWidth,contentClientWidth:c.clientWidth,contentHeight:c.scrollHeight,contentClientHeight:c.clientHeight}})()');
      assert.equal(sample.width,width,label+' viewport width');assert.ok(sample.pageWidth<=width+1,label+' page horizontal overflow: '+JSON.stringify(sample));
      check('inner-page viewport audit '+label+' '+width,sample);
      await capture(win,`${label}-${width}`);
    }finally{if(active)await clearViewport(win);}
  }
}
async function selectedDetail(win:BrowserWindowType,picker:string,detail:string,allDetails:string[],label:string):Promise<void>{
  await localClick(win,picker);
  const state=await js<{selected:boolean;visible:string[];text:string;state:string}>(win,'(()=>({selected:document.getElementById('+JSON.stringify(picker)+').getAttribute("aria-pressed")==="true",visible:'+JSON.stringify(allDetails)+'.filter(id=>!document.getElementById(id).hidden),text:document.getElementById('+JSON.stringify(detail)+').textContent||"",state:document.getElementById('+JSON.stringify(picker)+').dataset.state||""}))()');
  assert.equal(state.selected,true,label+' selected picker');assert.deepEqual(state.visible,[detail],label+' only its chosen detail is visible');
  check('new selection reveals only the matching operation card '+label,{picker,detail,text:state.text.slice(0,160),state:state.state});
}
async function assertBackToScene(win:BrowserWindowType,label:string):Promise<void>{
  await backToScene(win);
  const home=await js<{home:boolean;workspaceHidden:boolean;scene:boolean}>(win,'({home:!document.getElementById("cCampHome").hidden,workspaceHidden:document.getElementById("cCampWorkspace").hidden,scene:!!document.getElementById("campScene")})');
  assert.deepEqual(home,{home:true,workspaceHidden:true,scene:true},label+' returns to the scene');
  check('camp workspace returns to its scene after '+label,home);
}
async function testInnerAdventure(win:BrowserWindowType):Promise<void>{
  await openDetail(win,'csMap','cPanel-adventure');
  const names:string[]=[];
  for(let i=0;i<DESTINATIONS.length;i++){
    await localClick(win,'cZone'+i);
    const view=await js<{selected:boolean;name:string}>(win,'({selected:document.getElementById('+JSON.stringify('cZone'+i)+').getAttribute("aria-pressed")==="true",name:document.getElementById("cRegionName").textContent||""})');
    assert.equal(view.selected,true,'region '+i+' should become the selected postcard');assert.equal(view.name,DESTINATIONS[i].name,'selected region name');names.push(view.name);
  }
  const routes=['balanced','gather','treasure'] as const;
  for(const route of routes){await localClick(win,'cRoute-'+route);assert.equal(await js<boolean>(win,'document.getElementById('+JSON.stringify('cRoute-'+route)+').getAttribute("aria-pressed")==="true"'),true,'route '+route+' selected');}
  for(const trips of [1,3] as const){await localClick(win,'cTrips'+trips);assert.equal(await js<boolean>(win,'document.getElementById('+JSON.stringify('cTrips'+trips)+').getAttribute("aria-pressed")==="true"'),true,'trip count '+trips+' selected');}
  await disabled(win,'cTrips6',/旅人小屋Lv3/);
  await disabled(win,'cDepth1',/旅人小屋/);await disabled(win,'cDepth2',/旅人小屋/);
  await localClick(win,'cJourneySecret');assert.equal(await js<boolean>(win,'document.getElementById("cJourneySecret").getAttribute("aria-pressed")==="true"'),true);
  await localClick(win,'cJourneyNormal');assert.equal(await js<boolean>(win,'document.getElementById("cJourneyNormal").getAttribute("aria-pressed")==="true"'),true);
  await captureViewportPair(win,'adventure-selected');
  check('five actual regions, all routes and trip counts, and both journey modes were selected',{regions:names,routes,trips:[1,3,6],normal:true,secret:true,lockedDepthReasons:['lodge Lv1','lodge Lv2']});
  await assertBackToScene(win,'adventure selection');
}
async function testInnerGarden(win:BrowserWindowType):Promise<void>{
  await openDetail(win,'csPlot0','cPanel-garden');
  const crops=Object.keys(CROPS) as Array<keyof typeof CROPS>;
  for(const crop of crops){
    await localClick(win,'cSeed-'+crop);
    const selected=await js<boolean>(win,'document.getElementById('+JSON.stringify('cSeed-'+crop)+').getAttribute("aria-pressed")==="true"&&document.getElementById("cwSeedSummary").textContent?.includes('+JSON.stringify(CROPS[crop].name)+')');
    assert.equal(selected,true,'selected seed '+crop+' updates the seed box');
  }
  const assignments=[['herb',0],['pumpkin',1],['snowflower',2]] as const;
  for(const [crop,plot]of assignments){
    await localClick(win,'cSeed-'+crop);const planted=await actionClick(win,'cPlant'+plot);
    assert.equal(planted.leisure.plots[plot]?.crop,crop,'plot '+plot+' uses the current seed');
    await until(()=>js<boolean>(win,'document.getElementById('+JSON.stringify('cwPlot'+plot)+').dataset.state==="growing"&&document.getElementById('+JSON.stringify('cwPlotArt'+plot)+').dataset.crop==="sprout"'),'plot '+plot+' enters the growing art state');
  }
  const growing=await js<Array<{state:string;crop:string}>>(win,'[0,1,2].map(i=>({state:document.getElementById("cwPlot"+i).dataset.state||"",crop:document.getElementById("cwPlotArt"+i).dataset.crop||""}))');
  assert.deepEqual(growing,[{state:'growing',crop:'sprout'},{state:'growing',crop:'sprout'},{state:'growing',crop:'sprout'}]);
  const matureAt=Math.max(...profile().leisure.plots.map(plot=>plot?.due??0));await advanceWorker(Math.max(1,matureAt-profile().tick)*100,'all three garden plots reach their actual mature ticks');
  await until(()=>js<boolean>(win,'[0,1,2].every(i=>document.getElementById("cwPlot"+i).dataset.state==="ready")'),'all three planted plots mature');
  const mature=await js<Array<{state:string;crop:string;title:string}>>(win,'[0,1,2].map(i=>({state:document.getElementById("cwPlot"+i).dataset.state||"",crop:document.getElementById("cwPlotArt"+i).dataset.crop||"",title:document.getElementById("cPlotName"+i).textContent||""}))');
  assert.deepEqual(mature.map(x=>x.crop),['herb','pumpkin','snowflower']);assert.deepEqual(mature.map(x=>x.state),['ready','ready','ready']);
  await captureViewportPair(win,'garden-mature');
  const full=await disabled(win,'cHarvest0',/作物背包已满/);assert.equal(profile().leisure.materials.herb,9_998,'capacity fixture remains unchanged');
  for(const plot of [1,2]){
    const before=profile(),crop=before.leisure.plots[plot]!.crop,expected=CROPS[crop].yield+before.leisure.gardenLevel+jobPower(before,'garden');
    await actionClick(win,'cHarvest'+plot);assert.equal(profile().leisure.materials[crop],before.leisure.materials[crop]+expected,'harvested '+crop);assert.equal(profile().leisure.plots[plot],null);
  }
  for(const target of [1,2]){await actionClick(win,'cGardenUpgrade');assert.equal(profile().leisure.gardenLevel,target,'garden reaches level '+target);const label=await js<string>(win,'document.getElementById("cGardenLevel").textContent||""');assert.ok(label.includes('Lv'+target));}
  await disabled(win,'cGardenUpgrade',/满级/);
  check('three plots visibly grow and mature; full herb capacity is preserved, two harvests and both upgrades settle',{growing,mature,fullBagReason:full.tip,harvests:profile().leisure.harvests,gardenLevel:profile().leisure.gardenLevel,remaining:profile().leisure.plots});
  await assertBackToScene(win,'garden');
}
async function finishCookingQueue(label:string):Promise<void>{
  let guard=0;
  while(campOf(profile()).cooking.length&&guard++<8){
    const before=profile(),batch=campOf(before).cooking[0];assert.ok(batch,'queue batch should exist');
    const steps=Math.max(1,batch.due-before.tick);await advanceWorker(steps*100,label+' '+batch.food+' remaining '+batch.remaining);
    await until(()=>profile().leisure.cooked>before.leisure.cooked,label+' completes one real food item');
  }
  assert.equal(campOf(profile()).cooking.length,0,label+' queue drains');
}
async function testInnerKitchen(win:BrowserWindowType):Promise<void>{
  await openDetail(win,'csKitchen','cPanel-kitchen');await captureViewportPair(win,'kitchen-workbench');
  for(const slot of [0,1,2]){
    const before=structuredClone(profile()),contract=contractAt(before,slot);
    const shown=await js<string>(win,'document.getElementById('+JSON.stringify('cContractName'+slot)+').textContent||""');assert.equal(shown,contract.name,'NPC order '+slot+' matches the profile');
    await actionClick(win,'cDeliver'+slot);assert.equal(profile().leisure.journal.contracts[slot],before.leisure.journal.contracts[slot]+1);assert.equal(profile().leisure.journal.deliveries,before.leisure.journal.deliveries+1);
    for(const [material,count]of Object.entries(contract.items))assert.equal(profile().leisure.materials[material as keyof typeof MATERIALS],before.leisure.materials[material as keyof typeof MATERIALS]-count,'NPC order consumes exact '+material);
    assert.equal(profile().coins,before.coins+contract.coins);assert.equal(profile().leisure.materials.ore,before.leisure.materials.ore+contract.ore);
    check('selected camp kitchen NPC order settles its exact materials and reward',{slot,name:contract.name,items:contract.items,coins:contract.coins,ore:contract.ore});
  }
  const foods=Object.keys(FOODS) as Food[];
  for(const food of foods){
    await selectedDetail(win,'cwFoodPick-'+food,'cwFood-'+food,foods.map(id=>'cwFood-'+id),'food '+food);
    const bench=await js<{name:string;price:string;cost:string;art:boolean}>(win,'(()=>({name:document.querySelector("#cwFood-'+food+' h2")?.textContent||"",price:document.getElementById("cFoodPrice-'+food+'")?.textContent||"",cost:document.getElementById("cFoodCost-'+food+'")?.textContent||"",art:!!document.querySelector("#cwFood-'+food+' .cw-food-art")}))()');
    assert.equal(bench.name,FOODS[food].name);assert.ok(Number(bench.price)>0);assert.ok(bench.cost.trim().length>0);assert.equal(bench.art,true);
    if(food==='tea')await captureViewportPair(win,'kitchen-selected-tea');
    const count=food==='tea'?5:1;await actionClick(win,'cCook'+count+'-'+food);
    assert.equal(campOf(profile()).cooking.at(-1)?.food,food,'selected workbench schedules '+food);assert.equal(campOf(profile()).cooking.at(-1)?.remaining,count);
    if(food==='tea'){
      await localClick(win,'cCookingOpen');await until(()=>js<boolean>(win,'!document.getElementById("lifePanel-production").hidden'),'workbench schedule shortcut opens production');
      const queued=campOf(profile()).cooking[0];assert.equal(queued.food,'tea');assert.equal(queued.remaining,5);
      check('five-piece tea batch appears in the selected schedule after using the kitchen shortcut',{queued,screen:await js(win,'({panel:document.getElementById("lifePanel-production").hidden,stock:document.getElementById("lifeFoodQueue0").textContent})')});
    }
    await finishCookingQueue('cook '+food);
    if(food==='tea')await localClick(win,'cTab-kitchen');
    const stock=profile().leisure.materials[food],expectedStock=(food==='tea'?5:1);
    assert.ok(stock>=expectedStock,'completed '+food+' stock is visible in the authoritative profile');
    const price=foodPrice(profile(),FOODS[food].price),beforeOne=profile();await actionClick(win,'cSell1-'+food);
    assert.equal(profile().leisure.materials[food],beforeOne.leisure.materials[food]-1);assert.equal(profile().coins,beforeOne.coins+price);
    const beforeAll=profile(),allCount=beforeAll.leisure.materials[food];await actionClick(win,'cSellAll-'+food);
    assert.equal(profile().leisure.materials[food],0,'sell all '+food);assert.equal(profile().coins,beforeAll.coins+allCount*price,'sell all actual '+food+' price');
    check('selected workbench recipe cooks and both one/all sale actions use its actual price',{food,count,stock,price,remaining:profile().leisure.materials[food]});
  }
  const beforeFlour=profile();await actionClick(win,'cBuyFlour');assert.equal(profile().bag.flour,beforeFlour.bag.flour+10);assert.equal(profile().coins,beforeFlour.coins-10*ITEMS.flour.buy);
  const beforeGel=profile();await actionClick(win,'cSellGel');assert.equal(profile().bag.gel,beforeGel.bag.gel-5);assert.equal(profile().coins,beforeGel.coins+5*ITEMS.gel.sell);
  const beforeGelAll=profile(),gelAll=beforeGelAll.bag.gel;await actionClick(win,'cSellAllGel');assert.equal(profile().bag.gel,0);assert.equal(profile().coins,beforeGelAll.coins+gelAll*ITEMS.gel.sell);
  const beforeOre=profile();await actionClick(win,'cSellOre');assert.equal(profile().leisure.materials.ore,beforeOre.leisure.materials.ore-10);assert.equal(profile().coins,beforeOre.coins+20);
  await localClick(win,'cCookingOpen');await until(()=>js<boolean>(win,'!document.getElementById("lifePanel-production").hidden'),'queue shortcut production page reopened');
  const last=campOf(profile()).last.kitchen;assert.ok(last,'completed kitchen recipes leave a real repeat record');
  await localClick(win,'lifeTab-overview');const beforeRepeat=profile();await actionClick(win,'lifeRepeat-kitchen');assert.equal(campOf(profile()).cooking[0]?.food,last.id);assert.equal(campOf(profile()).cooking[0]?.remaining,last.count);
  await localClick(win,'lifeTab-production');const queued=campOf(profile()).cooking[0];assert.ok(queued);const beforeCancel=profile();await actionClick(win,'lifeCancelFood0');assert.equal(campOf(profile()).cooking.length,0);
  const canceledRecipe=FOODS[queued.food];for(const [material,count]of Object.entries(canceledRecipe.materials))assert.equal(profile().leisure.materials[material as keyof typeof MATERIALS],beforeCancel.leisure.materials[material as keyof typeof MATERIALS]+count*queued.remaining);
  const beforeAvailable=profile();await localClick(win,'lifeTab-overview');await actionClick(win,'lifeAvailable-kitchen');assert.ok(campOf(profile()).cooking.length>=1,'available materials create a real quick queue');
  await localClick(win,'lifeTab-production');await actionClick(win,'lifeCancelFood0');assert.equal(campOf(profile()).cooking.length,0);
  check('merchant supply actions, queue repeat/available and cancellation refunds all complete',{flour:profile().bag.flour,gel:profile().bag.gel,ore:profile().leisure.materials.ore,repeat:last,beforeRepeat:beforeRepeat.sequence,beforeAvailable:beforeAvailable.sequence,deliveries:profile().leisure.journal.deliveries});
  await assertBackToScene(win,'kitchen and production shortcuts');
}
async function testInnerBuildings(win:BrowserWindowType):Promise<void>{
  await openDetail(win,'csLodge','lifePanel-growth');await captureViewportPair(win,'camp-growth-buildings');
  for(const building of Object.keys(BUILDINGS) as Array<keyof typeof BUILDINGS>){
    for(let level=1;level<=3;level++){
      const before=profile();assert.equal(before.leisure.journal.buildings[building],level-1);
      await actionClick(win,'cBuild-'+building);assert.equal(profile().leisure.journal.buildings[building],level);
      const display=await js<{level:string;pip:string;effect:string;cost:string}>(win,'(()=>({level:document.getElementById('+JSON.stringify('cBuildingLevel-'+building)+').textContent||"",pip:document.getElementById('+JSON.stringify('cwBuildingPips-'+building)+').dataset.level||"",effect:document.getElementById('+JSON.stringify('cBuildingEffect-'+building)+').textContent||"",cost:document.getElementById('+JSON.stringify('cBuildingCost-'+building)+').textContent||""}))()');
      assert.ok(display.level.includes('Lv'+level));assert.equal(display.pip,String(level));assert.ok(display.effect.trim());assert.ok(display.cost.trim());
      check('camp building level '+building+' '+level+' settles and updates its plaque',{display,sequence:profile().sequence});
    }
    await disabled(win,'cBuild-'+building,/满级/);
  }
  await captureViewportPair(win,'camp-growth-buildings-level3');
  await assertBackToScene(win,'three buildings');
}
async function testInnerCollection(win:BrowserWindowType):Promise<void>{
  await openDetail(win,'csArchive','cPanel-collection');await localClick(win,'cArchiveOld');
  await until(()=>js<boolean>(win,'!document.getElementById("cArchivePermanent").hidden&&document.getElementById("cArchiveRarities").hidden'),'permanent collection opens its cabinet');
  await captureViewportPair(win,'collection-permanent-cabinet');
  for(let i=0;i<RELICS.length;i++){
    await selectedDetail(win,'cwRelicPick-'+i,'cRelic-'+i,RELICS.map((_,n)=>'cRelic-'+n),'permanent relic '+i);
    const detail=await js<{name:string;rank:string;effect:string;cost:string;selected:boolean}>(win,'(()=>({name:document.querySelector('+JSON.stringify('#cRelic-'+i+' h2')+')?.textContent||"",rank:document.getElementById('+JSON.stringify('cRelicRank-'+i)+').textContent||"",effect:document.getElementById('+JSON.stringify('cRelicEffect-'+i)+').textContent||"",cost:document.getElementById('+JSON.stringify('cRelicCost-'+i)+').textContent||"",selected:document.getElementById('+JSON.stringify('cwRelicPick-'+i)+').getAttribute("aria-pressed")==="true"}))()');
    assert.equal(detail.name,RELICS[i][0]);assert.equal(detail.rank,'★');assert.ok(detail.effect.trim());assert.ok(detail.selected);
    if(i===0)await captureViewportPair(win,'collection-selected-relic');
    const before=profile();await actionClick(win,'cRelicUpgrade-'+i);assert.equal(profile().leisure.journal.relics[i],2);
    assert.equal(profile().leisure.journal.dust,before.leisure.journal.dust-4);assert.equal(profile().leisure.materials.ore,before.leisure.materials.ore-15);
  }
  await selectedDetail(win,'cwRelicPick-0','cRelic-0',RELICS.map((_,n)=>'cRelic-'+n),'permanent relic 0 second repair');
  const beforeThird=profile();await actionClick(win,'cRelicUpgrade-0');assert.equal(profile().leisure.journal.relics[0],3);assert.equal(profile().leisure.journal.dust,beforeThird.leisure.journal.dust-10);assert.equal(profile().leisure.materials.ore,beforeThird.leisure.materials.ore-40);
  await disabled(win,'cRelicUpgrade-0',/三星/);
  const visibleMemoryIds=COLLECTIONS.map(item=>'cwMemory-'+item.id);
  for(const item of COLLECTIONS){
    await selectedDetail(win,'cwMemoryPick-'+item.id,'cwMemory-'+item.id,visibleMemoryIds,'memory '+item.id);
    const ready=item.ready(profile().leisure),buttonId='cCollection-'+item.id;
    const status=await js<{state:string;label:string;visible:boolean}>(win,'({state:document.getElementById('+JSON.stringify('cwMemoryPick-'+item.id)+').dataset.state||"",label:document.getElementById('+JSON.stringify('cwMemoryState-'+item.id)+').textContent||"",visible:!document.getElementById('+JSON.stringify('cCollection-'+item.id)+').hidden})');
    assert.equal(status.visible,true);assert.equal(status.state,ready?'ready':'future');assert.equal(status.label,ready?'可领取':'尚未完成');
    if(ready)await assertControl(win,buttonId,true);else await disabled(win,buttonId,new RegExp(item.detail));
    if(item.id==='first-trip'){
      assert.equal(ready,true);const before=profile();await actionClick(win,buttonId);assert.ok(profile().leisure.claimed.includes(item.id));assert.equal(profile().coins,before.coins+item.coins);assert.equal(profile().leisure.materials.ore,before.leisure.materials.ore+item.ore);
      await disabled(win,buttonId,/已领取/);check('selected ready memory reward is claimed once and then closes',{id:item.id,claimed:profile().leisure.claimed});
    }
    if(item.id==='helping-hand')assert.equal(ready,false,'the ten-order memory remains visibly unmet at nine deliveries');
  }
  assert.equal(COLLECTIONS.length,14,'all 14 travel memories were exercised');
  await selectedDetail(win,'cwMemoryPick-first-trip','cwMemory-first-trip',visibleMemoryIds,'claimed first trip memory repeated selection');
  const duplicateBefore=structuredClone(profile());await clickElement(win,'cCollection-first-trip');await new Promise(resolve=>setTimeout(resolve,80));assert.deepEqual(profile(),duplicateBefore,'a claimed memory cannot pay twice');
  await captureViewportPair(win,'collection-selected-memory');
  check('all 15 permanent objects and 14 memory cards were chosen; a ready reward paid once while the 10-order target stayed unmet',{relics:profile().leisure.journal.relics,claimed:profile().leisure.claimed,deliveries:profile().leisure.journal.deliveries});
  await assertBackToScene(win,'archive and memories');
}
async function testInnerJourneyActions(win:BrowserWindowType):Promise<void>{
  await openDetail(win,'csMap','cPanel-adventure');
  for(let i=0;i<DESTINATIONS.length;i++){
    await localClick(win,'cZone'+i);assert.equal(await js<boolean>(win,'document.getElementById('+JSON.stringify('cZone'+i)+').getAttribute("aria-pressed")==="true"'),true);
  }
  for(const route of ['balanced','gather','treasure'] as const){await localClick(win,'cRoute-'+route);assert.equal(await js<boolean>(win,'document.getElementById('+JSON.stringify('cRoute-'+route)+').getAttribute("aria-pressed")==="true"'),true);}
  for(const depth of [0,1,2] as const){await localClick(win,'cDepth'+depth);assert.equal(await js<boolean>(win,'document.getElementById('+JSON.stringify('cDepth'+depth)+').getAttribute("aria-pressed")==="true"'),true);}
  for(const trips of [1,3,6] as const){await localClick(win,'cTrips'+trips);assert.equal(await js<boolean>(win,'document.getElementById('+JSON.stringify('cTrips'+trips)+').getAttribute("aria-pressed")==="true"'),true);}
  await localClick(win,'cJourneyNormal');assert.equal(await js<boolean>(win,'document.getElementById("cJourneyNormal").getAttribute("aria-pressed")==="true"'),true);
  await localClick(win,'cRoute-gather');await localClick(win,'cDepth2');await localClick(win,'cTrips6');
  const initial=profile(),started=await actionClick(win,'cStart');assert.ok(started.leisure.run);assert.equal(started.leisure.run.zone,4);assert.equal(started.leisure.run.route,'gather');assert.equal(started.leisure.run.depth,2);assert.equal(started.leisure.run.total,6);assert.equal(started.leisure.run.bonds?.secret,false);
  check('selected ordinary sixth-region deep gathering journey starts with its exact snapshot',{before:initial.sequence,run:started.leisure.run});
  const beforeAssist=started.leisure.run.due,assisted=await actionClick(win,'cAssist');assert.ok(assisted.leisure.run);assert.equal(assisted.leisure.run.due,Math.max(assisted.tick+1,beforeAssist-30));
  const run=assisted.leisure.run;assert.ok(run);await advanceWorker(Math.max(1,run.due-profile().tick)*100,'one deep ordinary encounter settles before an early return');
  assert.ok(profile().leisure.run);assert.ok(profile().leisure.cargo.coins+profile().leisure.cargo.xp>0);const cargo=structuredClone(profile().leisure.cargo);
  await actionClick(win,'cReturn');assert.equal(profile().leisure.run,null);assert.deepEqual(profile().leisure.cargo,cargo,'early return preserves settled ordinary loot');
  const beforeClaim=profile();await actionClick(win,'cClaim');assert.deepEqual(profile().leisure.cargo,{coins:0,xp:0,gel:0,ore:0});assert.equal(profile().coins,beforeClaim.coins+beforeClaim.leisure.cargo.coins);assert.equal(profile().xp,beforeClaim.xp+beforeClaim.leisure.cargo.xp);
  await disabled(win,'cClaim',/战利品箱还是空的/);
  await localClick(win,'cJourneySecret');assert.equal(await js<boolean>(win,'document.getElementById("cJourneySecret").getAttribute("aria-pressed")==="true"'),true);
  await localClick(win,'cTrips1');const secretStart=await actionClick(win,'cStart');assert.ok(secretStart.leisure.run);assert.equal(secretStart.leisure.run.bonds?.secret,true);assert.equal(secretStart.leisure.run.total,1);
  const secretSnapshot=secretStart.leisure.run;await actionClick(win,'cReturn');assert.equal(profile().leisure.run,null);assert.deepEqual(profile().leisure.cargo,{coins:0,xp:0,gel:0,ore:0});
  check('secret mode starts with the actual secret snapshot and can return without inventing unsettled loot',{run:{zone:secretSnapshot.zone,secret:secretSnapshot.bonds?.secret,total:secretSnapshot.total},cargo:profile().leisure.cargo});
  await assertBackToScene(win,'normal and secret journey actions');
}
async function testInner():Promise<void>{
  const win=await openCasual();await assertSceneFirstView(win);await auditScene(win,'inner-default');await stableScene(win);await capture(win,'inner-scene-1040');
  assert.equal(APP_VERSION,'0.11.0','candidate app identity is 0.11.0');assert.equal(profile().version,8);
  await testInnerAdventure(win);await testInnerGarden(win);await testInnerKitchen(win);await testInnerBuildings(win);await testInnerCollection(win);await testInnerJourneyActions(win);
  // Plot 0 remains deliberately mature at a full bag to verify rejection; use the harvested empty plot for the repeated garden entrance.
  for(const [id,panel] of [['csMap','cPanel-adventure'],['csPlot1','cPanel-garden'],['csKitchen','cPanel-kitchen'],['csArchive','cPanel-collection']] as const){
    await enter(win,id,panel);await assertStableScene(win,'repeat page '+panel);
  }
  await assertStableScene(win,'all 0.11.0 inner page operations and repeated returns');await auditProfileBoundary();
  await capture(win,'inner-scene-final');await clickElement(win,'cClose');await until(()=>!shell?.arenaWindow,'inner acceptance casual window closes');
}
async function sendState(win:BrowserWindowType,patch:Partial<ShellState>,label:string):Promise<void>{
  assert.ok(shell);const state={...shell.state(),...patch} as ShellState,before=await js<number>(win,'window.__campInner0110State?.revision||0');win.webContents.send(channels.update,state);
  await until(()=>js<boolean>(win,'(window.__campInner0110State?.revision||0)>='+String(before+1)+'&&window.__campInner0110State?.workingElsewhere==='+String(state.workingElsewhere)+'&&window.__campInner0110State?.mode==='+JSON.stringify(state.mode)),'renderer receives software ShellState '+label);
  const observed=await js(win,'window.__campInner0110State');check('software ShellState motion fixture '+label,{workingElsewhere:state.workingElsewhere,mode:state.mode,renderer:observed,delivery:'direct hidden-webContents software fixture; no native window activation',native:{isVisible:win.isVisible(),isFocused:win.isFocused()}});
}
async function testMotion(win:BrowserWindowType):Promise<void>{
  const native={isVisible:win.isVisible(),isFocused:win.isFocused()};assert.deepEqual(native,{isVisible:false,isFocused:false});
  const initial=await js<{motion:string;hidden:boolean;focus:boolean}>(win,'({motion:document.getElementById("campScene").dataset.motion,hidden:document.hidden,focus:document.hasFocus()})');
  const saved=await js(win,'(()=>{window.__campDocSaved=Object.fromEntries(["hidden","visibilityState","hasFocus"].map(k=>[k,Object.getOwnPropertyDescriptor(document,k)||null]));window.__campDocFixture={hidden:false,visibilityState:"visible",hasFocus:false};Object.defineProperty(document,"hidden",{configurable:true,get:()=>window.__campDocFixture.hidden});Object.defineProperty(document,"visibilityState",{configurable:true,get:()=>window.__campDocFixture.visibilityState});Object.defineProperty(document,"hasFocus",{configurable:true,value:()=>window.__campDocFixture.hasFocus});return{hidden:document.hidden,visibility:document.visibilityState,hasFocus:document.hasFocus(),boundary:"explicit software getter override; native window remains hidden"}})()');
  try{
    await js(win,'document.getElementById("campScene").dispatchEvent(new PointerEvent("pointerenter"))');await until(()=>js<boolean>(win,'document.getElementById("campScene").dataset.motion==="running"'),'software-visible non-focused hover starts motion before blur latch');
    check('software-visible non-focused hover may start motion before a blur event; native window remains independently hidden',{document:await js(win,'({hidden:document.hidden,visibilityState:document.visibilityState,hasFocus:document.hasFocus()})'),motion:await js(win,'document.getElementById("campScene").dataset.motion'),initialActualDOM:initial,native});
    const current=shell!.state();await sendState(win,{workingElsewhere:false,mode:current.mode==='hidden'?'interaction':current.mode},'visible software fixture baseline');
    await js(win,'window.__campDocFixture.hasFocus=true;document.getElementById("campScene").dispatchEvent(new PointerEvent("pointerenter"))');await until(()=>js<boolean>(win,'document.getElementById("campScene").dataset.motion==="running"'),'software visible scene begins motion');
    await js(win,'window.dispatchEvent(new Event("blur"))');await until(()=>js<boolean>(win,'document.getElementById("campScene").dataset.motion==="paused"'),'software blur pauses motion');
    await js(win,'document.getElementById("campScene").dispatchEvent(new PointerEvent("pointerenter"))');assert.equal(await js<string>(win,'document.getElementById("campScene").dataset.motion'),'paused','synthetic pointerenter cannot clear blur latch');
    const rendererBeforeLifecycle=await js<number>(win,'window.__campInner0110State?.revision||0');app.emit('did-resign-active');
    await until(()=>shell?.state().workingElsewhere===true,'main software did-resign-active state');
    const blockedState=shell!.state();
    // Shell.broadcast excludes a never-shown arenaWindow. Deliver the observed
    // main ShellState directly to this hidden renderer and await its own IPC
    // observer plus scene pause before emitting the synthetic resume event.
    await sendState(win,{},'did-resign-active manually delivered to hidden arena renderer');
    await until(()=>js<boolean>(win,'window.__campInner0110State?.workingElsewhere===true&&document.getElementById("campScene").dataset.motion==="paused"'),'renderer observes blocked state and scene pauses');
    const blockedRenderer=await js(win,'({before:'+rendererBeforeLifecycle+',state:window.__campInner0110State,motion:document.getElementById("campScene").dataset.motion,native:{hidden:'+String(!win.isVisible())+',focused:'+String(win.isFocused())+'}})');
    check('software resign lifecycle reaches hidden renderer and pauses scene before resume',{main:{workingElsewhere:blockedState.workingElsewhere,revision:blockedState.revision},renderer:blockedRenderer,delivery:'main ShellState manually delivered because hidden arenaWindow is not a broadcast recipient',native:{isVisible:win.isVisible(),isFocused:win.isFocused()},input:'software app event and IPC delivery'});
    app.emit('did-become-active');await until(()=>shell?.state().workingElsewhere===false,'main software did-become-active state');
    await sendState(win,{},'did-become-active delivered after observed blocked pause');
    await js(win,'document.getElementById("campScene").dispatchEvent(new PointerEvent("pointerenter"))');
    await until(()=>js<boolean>(win,'window.__campInner0110State?.workingElsewhere===false&&document.getElementById("campScene").dataset.motion==="running"'),'renderer observes resume and clears software blur latch');
    check('software resume delivered only after renderer observed blocked pause',{renderer:await js(win,'window.__campInner0110State'),motion:await js(win,'document.getElementById("campScene").dataset.motion'),native:{isVisible:win.isVisible(),isFocused:win.isFocused()}});
    await js(win,'window.__campDocFixture={hidden:true,visibilityState:"hidden",hasFocus:false};document.dispatchEvent(new Event("visibilitychange"))');
    await until(()=>js<boolean>(win,'document.hidden&&document.visibilityState==="hidden"&&!document.hasFocus()&&document.getElementById("campScene").dataset.motion==="paused"'),'explicit software hidden/visibilitychange stops motion');
    check('explicit software document.hidden/visibilitychange pauses scene; native window state sampled separately',{document:await js(win,'({hidden:document.hidden,visibilityState:document.visibilityState,hasFocus:document.hasFocus()})'),motion:await js(win,'document.getElementById("campScene").dataset.motion'),native:{isVisible:win.isVisible(),isFocused:win.isFocused()},input:'temporary document getter override and dispatched visibilitychange'});
    await js(win,'window.__campDocFixture={hidden:false,visibilityState:"visible",hasFocus:true};document.dispatchEvent(new Event("visibilitychange"))');
    await until(()=>js<boolean>(win,'!document.hidden&&document.visibilityState==="visible"&&document.hasFocus()'),'explicit software document visible/focus state restored');
    await js(win,'document.getElementById("campScene").dispatchEvent(new PointerEvent("pointerenter"))');await until(()=>js<boolean>(win,'document.getElementById("campScene").dataset.motion==="running"'),'software visible state allows local pointer hover');
    const fakePopup={kind:'shop',generation:999,anchor:{x:0,y:0,width:1,height:1},bounds:{x:0,y:0,width:1,height:1},tail:0,side:'top',suspended:true} as const;
    await sendState(win,{workingElsewhere:false,popup:fakePopup as ShellState['popup']},'unrelated shop popup suspended');assert.equal(await js<string>(win,'document.getElementById("campScene").dataset.motion'),'running','popup.suspended must not gate camp scene');
    await sendState(win,{mode:'hidden'},'hidden mode');await until(()=>js<boolean>(win,'document.getElementById("campScene").dataset.motion==="paused"'),'hidden mode pauses camp scene');
    await sendState(win,{mode:current.mode==='hidden'?'interaction':current.mode,popup:null,workingElsewhere:false},'restore from hidden mode');
    await js(win,'document.getElementById("campScene").dispatchEvent(new PointerEvent("pointerenter"))');await until(()=>js<boolean>(win,'document.getElementById("campScene").dataset.motion==="running"'),'restored mode permits scene motion');
    const api=win.webContents.debugger,attached=api.isAttached();try{if(!attached)api.attach('1.3');await api.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await new Promise(resolve=>setTimeout(resolve,100));assert.equal(await js<string>(win,'document.getElementById("campScene").dataset.motion'),'paused');check('reduced motion preference pauses camp animation',{source:'CDP Emulation.setEmulatedMedia; software preference fixture'});}finally{try{await api.sendCommand('Emulation.setEmulatedMedia',{features:[]});}catch{}if(!attached&&api.isAttached())api.detach();}
    await sendState(win,{mode:current.mode==='hidden'?'interaction':current.mode,popup:null,workingElsewhere:false},'motion fixture restored');
    await clickElement(win,'csMap');await until(()=>js<boolean>(win,'document.getElementById("cCampHome").hidden'),'scene parent hidden by detail navigation');assert.equal(await js<string>(win,'document.getElementById("campScene").dataset.motion'),'paused','hidden ancestor pauses scene');await clickElement(win,'cCampBack');await until(()=>js<boolean>(win,'!document.getElementById("cCampHome").hidden'),'scene parent restored');
    check('ancestor hidden transition pauses scene and returning to camp restores its visible root',{motion:await js<string>(win,'document.getElementById("campScene").dataset.motion')});
  }finally{
    await js(win,'(()=>{for(const [k,d]of Object.entries(window.__campDocSaved||{})){if(d)Object.defineProperty(document,k,d);else delete document[k]}delete window.__campDocSaved;delete window.__campDocFixture;document.dispatchEvent(new Event("visibilitychange"));return{hidden:document.hidden,visibility:document.visibilityState,hasFocus:document.hasFocus()}})()');
  }
  const restored=await js(win,'({hidden:document.hidden,visibility:document.visibilityState,hasFocus:document.hasFocus()})');check('temporary visibility/focus getter overrides restored after motion fixtures',{original:saved,restored,native:{isVisible:win.isVisible(),isFocused:win.isFocused()}});
  assert.equal(win.isVisible(),false);assert.equal(win.isFocused(),false);
}
async function testRich():Promise<void>{
  const win=await openCasual();await assertSceneFirstView(win);await auditScene(win,'rich-default');await stableScene(win);await capture(win,'rich-default');
  const actual=await js<{roles:Record<string,string>;plots:Array<{crop:string;state:string;amount:string}>;visitorNames:string[];lettersHidden:boolean}>(win,'(()=>({roles:Object.fromEntries(["leader","support","counter","workshop","garden"].map(r=>[r,document.getElementById("csName-"+r).textContent||""])),plots:[0,1,2].map(i=>({crop:document.getElementById("csCrop"+i).dataset.crop,state:document.getElementById("csPlot"+i).dataset.state,amount:document.getElementById("csPlotState"+i).textContent||""})),visitorNames:[0,1,2].map(i=>document.getElementById("csVisitorName"+i).textContent||""),lettersHidden:document.getElementById("csLetters").hidden}))()');
  assert.deepEqual(actual.roles,{leader:COMPANIONS.slime.name,support:COMPANIONS.guide.name,counter:COMPANIONS.fox.name,workshop:COMPANIONS.bear.name,garden:COMPANIONS.deer.name});
  for(const [i,crop]of ['herb','berry','pumpkin'].entries()){assert.equal(actual.plots[i].crop,crop);assert.equal(actual.plots[i].state,i===2?'growing':'ready');}
  assert.deepEqual(actual.visitorNames,[0,1,2].map(i=>contractAt(profile(),i).who));assert.equal(actual.lettersHidden,false);check('scene presents five actual roles, mature/growing true crops, three authoritative visitors and a real letter',actual);
  await testEntrances(win);
  await openDetail(win,'csBuddy-counter','lifePanel-jobs','fox');
  const buddyDetail=await js<{selected:string;summary:string}>(win,'({selected:document.getElementById("lifeJobChoice-counter").value,summary:document.getElementById("lifeJobState-counter").textContent})');assert.equal(buddyDetail.selected,'fox');assert.ok(buddyDetail.summary.includes(COMPANIONS.fox.name));check('counter role scene click opens existing job detail with its actual assigned companion',buddyDetail);await backToScene(win);
  // One scene claim first exercises simultaneous normal cargo and bond satchel contents.
  const beforeClaim=structuredClone(profile()),claimBefore=await assertControl(win,'csClaim',true);await actionClick(win,'csClaim');
  for(const [m,n]of Object.entries(beforeClaim.leisure.bonds!.satchel)){
    if(['dust','tokens'].includes(m))continue;
    assert.equal(profile().leisure.materials[m as keyof typeof MATERIALS],beforeClaim.leisure.materials[m as keyof typeof MATERIALS]+n,`satchel ${m} exactly once`);
  }
  assert.equal(profile().leisure.journal.dust,beforeClaim.leisure.journal.dust+beforeClaim.leisure.bonds!.satchel.dust);
  assert.equal(profile().leisure.bonds!.tokens,beforeClaim.leisure.bonds!.tokens+beforeClaim.leisure.bonds!.satchel.tokens);
  assert.equal(profile().coins,beforeClaim.coins+beforeClaim.leisure.cargo.coins);assert.equal(profile().xp,beforeClaim.xp+beforeClaim.leisure.cargo.xp);
  assert.equal(profile().bag.gel,beforeClaim.bag.gel+beforeClaim.leisure.cargo.gel);assert.equal(profile().leisure.materials.ore,beforeClaim.leisure.materials.ore+beforeClaim.leisure.cargo.ore);
  const claimed=structuredClone(profile());await clickElement(win,'csClaim');await new Promise(resolve=>setTimeout(resolve,100));assert.deepEqual(profile(),claimed);await disabled(win,'csClaim',/战利品箱还是空的/);
  check('mixed normal cargo and satchel are fully transferred once; repeat click changes no state',{tip:claimBefore.tip,sequence:profile().sequence,notice:profile().notice});
  await testHarvestAndGarden(win);await testContracts(win);await testTravelLetter(win);await testOldKitchenAndCamp(win);
  await testJourney(win);await testRichLayout(win);await testMotion(win);await assertStableScene(win,'all rich interactions');
  const beforeClose=structuredClone(profile());await clickElement(win,'cClose');await until(()=>!shell?.arenaWindow,'rich close');
  assert.deepEqual(new GameStore(path.join(profileRoot,'solo')).value,beforeClose,'isolated store matches all completed operations');
  let reopened=await openCasual();await assertSceneFirstView(reopened);assert.equal(profile().sequence,beforeClose.sequence);await assertStableScene(reopened,'close and reopen');
  await capture(reopened,'rich-reopened');await clickElement(reopened,'cClose');await until(()=>!shell?.arenaWindow,'second rich close');reopened=await openCasual();await assertSceneFirstView(reopened);
  assert.equal(profile().sequence,beforeClose.sequence);await auditProfileBoundary();await assertStableScene(reopened,'second reopen');
  await js(reopened,'window.dispatchEvent(new Event("pagehide"))');await until(()=>js<boolean>(reopened,'document.getElementById("campScene").dataset.motion==="paused"'),'pagehide disposes local motion');check('pagehide disposes scene motion before final close',{motion:await js(reopened,'document.getElementById("campScene").dataset.motion')});
  await clickElement(reopened,'cClose');await until(()=>!shell?.arenaWindow,'final rich close');
}
async function testClaimOnly(win:BrowserWindowType):Promise<void>{
  await assertSceneFirstView(win);const before=structuredClone(profile());assert.deepEqual(before.leisure.cargo,{coins:0,xp:0,gel:0,ore:0});assert.ok(before.leisure.bonds&&Object.values(before.leisure.bonds.satchel).some(n=>n>0));
  await assertControl(win,'csClaim',true);await actionClick(win,'csClaim');
  for(const item of ['herb','berry','mushroom','pumpkin','snowflower','biscuit'] as const)assert.equal(profile().leisure.materials[item],before.leisure.materials[item]+before.leisure.bonds!.satchel[item]);
  assert.equal(profile().leisure.journal.dust,before.leisure.journal.dust+before.leisure.bonds!.satchel.dust);assert.equal(profile().leisure.bonds!.tokens,before.leisure.bonds!.tokens+before.leisure.bonds!.satchel.tokens);
  assert.deepEqual(profile().leisure.cargo,{coins:0,xp:0,gel:0,ore:0});const once=structuredClone(profile());await clickElement(win,'csClaim');await new Promise(resolve=>setTimeout(resolve,80));assert.deepEqual(profile(),once);await disabled(win,'csClaim',/战利品箱还是空的/);
  check('satchel-only chest is claimable and its second click does not repeat',{before:before.leisure.bonds!.satchel,after:profile().leisure.bonds!.satchel,sequence:profile().sequence});await auditProfileBoundary();
}
async function testClaimFull(win:BrowserWindowType):Promise<void>{
  await assertSceneFirstView(win);const before=structuredClone(profile()),state=await disabled(win,'csClaim',/月纹石空间不足/);await clickElement(win,'csClaim');await new Promise(resolve=>setTimeout(resolve,100));assert.deepEqual(profile(),before,'full inventory rejects all cargo and preserves chest');
  check('full inventory rejects entire claim without partial gold/xp/item transfer',{reason:state.tip,cargo:profile().leisure.cargo,ore:profile().leisure.materials.ore,sequence:profile().sequence});await auditProfileBoundary();
}
async function finalBoundary():Promise<void>{
  const skipped:number[]=[];
  for(const win of BrowserWindow.getAllWindows()){
    track(win);if(win.isDestroyed()||win.webContents.isDestroyed()||!page(win)){skipped.push(win.id);continue;}await instrument(win);
    const observed=await js<{keys:number;csp:unknown[]}>(win,'({keys:window.__campInner0110Keys||0,csp:window.__campInner0110Csp||[]})');
    keyboardByWindow[win.id]=observed.keys;cspByWindow[win.id]=[...(cspByWindow[win.id]??[]),...observed.csp.map(String)];
  }
  assert.equal(Object.values(keyboardByWindow).reduce((n,v)=>n+v,0),0,'renderer keyboard event observed');
  assert.equal(Object.values(cspByWindow).reduce((n,v)=>n+v.length,0),0,'CSP violation observed');
  assert.equal(suppression.globalShortcut??0,0,'globalShortcut registration intercepted');
  for(const row of snapshots()){assert.equal(row.isVisible,false,'native window became visible '+JSON.stringify(row));assert.equal(row.isFocused,false,'native window became focused '+JSON.stringify(row));}
  const blockedFocusAttempts={app:suppression.appFocus??0,window:suppression.windowFocus??0,webContents:suppression.webContentsFocus??0,activation:suppression.appActivateEvents??0};
  check('native hidden/unfocused boundary, zero keyboard events, zero CSP and no global shortcut',{nativeWindows:snapshots(),keyboardByWindow,cspByWindow,suppression,blockedFocusAttempts,focusBoundary:'focus/activation APIs were intercepted before native effect; counts are attempts, not actual focus',skipped},Object.values(blockedFocusAttempts).some(Boolean)?'INFO':'PASS');
}
async function main():Promise<void>{
  try{
    fs.mkdirSync(evidenceDir,{recursive:true,mode:0o700});fs.chmodSync(profileRoot,0o700);markIsolatedFolder(profileRoot,app.getPath('appData'));
    preflight=parseProfile(makeProfile());assert.equal(preflight.version,8);fs.mkdirSync(path.dirname(profileFile),{recursive:true,mode:0o700});
    fs.writeFileSync(profileFile,JSON.stringify(preflight)+'\n',{flag:'wx',mode:0o600});
    assert.deepEqual(parseProfile(JSON.parse(fs.readFileSync(profileFile,'utf8'))),preflight,'written profile must pass parseProfile preflight');
    check('only an independently generated, marked /private/tmp profile passed parseProfile before app launch',{profileRoot,profileFile,marker:path.join(profileRoot,'.pixelstreet-isolated-profile.json'),version:preflight.version,scenario});
    app.on('browser-window-created',(_event,win)=>track(win));shell=await startDesktop(profileRoot,true);
    await until(()=>shell?.game.state.status==='ready'&&!!shell.game.state.profile,'isolated GameWorker ready');for(const win of BrowserWindow.getAllWindows())track(win);
    const loaded=shell.game.state.profile;assert.ok(loaded);assertLoadedFixture(loaded,preflight);check('GameWorker loaded only the preflight fixture',{sequence:profile().sequence,version:profile().version,profileRoot});
    const street=overlay();await until(()=>js<boolean>(street,'document.body.dataset.view!==undefined&&!!document.getElementById("dungeonSign")'),'hidden street and visible dungeon portal renderer ready');
    if(scenario==='inner')await testInner();else if(scenario==='fresh')await testFresh();else if(scenario==='rich')await testRich();else {const win=await openCasual();if(scenario==='claim-only')await testClaimOnly(win);else await testClaimFull(win);}
    if(shell?.arenaWindow&&!shell.arenaWindow.isDestroyed()){await clickElement(shell.arenaWindow,'cClose');await until(()=>!shell?.arenaWindow,'close remaining casual');}
    await shell.game.request('flush');await auditProfileBoundary();await finalBoundary();
    assert.equal(errors.length,0,'renderer console/runtime errors: '+errors.join('; '));
    assert.deepEqual(hashesAtStart,productHashes(),'product source/runtime hashes changed during this hidden run');
    status='PASS';check('hidden-native camp scene run completed without source mutation',{scenario,profileFile,checks:checks.length,nativeWindows:snapshots(),productFiles:Object.keys(hashesAtStart).length});
  }catch(error){
    status='FAIL';errors.push(String(error));checks.push({name:'raw scenario failure',status:'FAIL',detail:{error:String(error),stack:error instanceof Error?error.stack:undefined}});
    process.exitCode=1;
    console.error(error instanceof Error?error.stack:String(error));
  }finally{
    try{if(shell)await shell.game.request('flush');}catch(error){harnessIssues.push('final flush failed: '+String(error));}
    try{report(status==='FAIL'?new Error(errors.at(-1)||'scenario failed'):undefined);}catch(error){console.error('report write failed: '+String(error));}
    app.exit(status==='FAIL'?1:0);
  }
}
void main();
