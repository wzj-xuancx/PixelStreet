import {app,BrowserWindow,Menu,type BrowserWindow as BrowserWindowType} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {startDesktop} from '../apps/desktop/bootstrap';
import {GameStore} from '../apps/desktop/game-store';
import {markIsolatedFolder} from '../apps/desktop/launch-profile';
import {APP_NAME,APP_VERSION,PROFILE_NAME} from '../apps/desktop/identity';
import {
  BUDDY_ORDER,FOODS,FORMULAS,GOOD_IDS,PATHS,advance,atelierShelfLimit,atelierTicks,craftTicks,
  foodTicks,initialAtelier,initialBonds,initialCamp,initialProfile,parseProfile,stableAtelierOrder,
  type Buddy,type Profile,type TrainingPath,type Food,type Good,
} from '../packages/solo-core';

type Scenario='visitor'|'apprentice'|'owner'|'rich';
type Result={name:string;status:'PASS'|'FAIL'|'INFO';detail?:unknown};
type NativeTrace={id:number;page:string|null;visible:()=>boolean;focused:()=>boolean;last:{isVisible:boolean;isFocused:boolean}};
type ButtonInfo={id:string;exists:boolean;hidden:boolean;disabled:boolean;label:string;tip:string;title:string;kind:string;art:string;image:string;cursor:string;font:number;selected:boolean;reachable:boolean;rect:{x:number;y:number;width:number;height:number};hitButton:string|null};

const root=process.cwd();
const scenario=(process.argv.find(a=>a.startsWith('--scenario='))?.split('=')[1]??'rich') as Scenario;
if(!['visitor','apprentice','owner','rich'].includes(scenario))throw new Error('scenario must be visitor, apprentice, owner or rich');
const runId=new Date().toISOString().replace(/[:.]/g,'-')+'-'+process.pid+'-'+scenario;
const evidenceDir=path.join(root,'work/village-0120/native-picture-luna');
const profileRoot=fs.mkdtempSync(`/private/tmp/pixelstreet-0120-picture-${scenario}-`);
const soloFolder=path.join(profileRoot,'solo');
const profileFile=path.join(soloFolder,'profile.json');
const reportPath=path.join(evidenceDir,`native-picture-0120-${runId}.json`);
const progressPath=path.join(evidenceDir,`progress-${runId}.jsonl`);
const checks:Result[]=[];
const errors:string[]=[];
const screenshots:string[]=[];
const traces=new Map<number,NativeTrace>();
const viewportSessions=new Map<number,boolean>();
const keyboardByWindow:Record<number,number>={};
const cspByWindow:Record<number,Array<{directive:string;blocked:string;sample:string}>>={};
const suppression=(globalThis as any).__pixelStreetPicture0120Suppression??{};
let shell:Awaited<ReturnType<typeof startDesktop>>|undefined;
let fixture:Profile|undefined;
let status:'RUNNING'|'PASS'|'FAIL'='RUNNING';

function walk(dir:string):string[]{
  if(!fs.existsSync(dir))return[];
  return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{const file=path.join(dir,entry.name);return entry.isDirectory()?walk(file):[path.relative(root,file)];});
}
const productRoots=['package.json','package-lock.json','tsconfig.json','scripts/build.mjs','scripts/generate-art.mjs','apps/desktop','packages/solo-core','packages/protocol','packages/content','assets','dist'] as const;
const productExclusions=['dist/tests/**','dist/native-*.cjs'] as const;
function codePointCompare(a:string,b:string):number{
  const aa=Array.from(a,ch=>ch.codePointAt(0)!),bb=Array.from(b,ch=>ch.codePointAt(0)!);
  for(let i=0;i<Math.min(aa.length,bb.length);i++)if(aa[i]!==bb[i])return aa[i]-bb[i];
  return aa.length-bb.length;
}
function productFiles():string[]{
  const files=productRoots.flatMap(item=>fs.statSync(path.join(root,item)).isDirectory()?walk(path.join(root,item)):[item]);
  return [...new Set(files)].filter(file=>!/^dist\/(?:tests\/|native-.*\.cjs$)/.test(file)&&fs.existsSync(path.join(root,file))).sort(codePointCompare);
}
function productHashes():Record<string,string>{
  return Object.fromEntries(productFiles().map(file=>[file,createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')]));
}
function canonicalInventorySha256(hashes:Record<string,string>):string{
  const canonical=Object.entries(hashes).sort(([a],[b])=>codePointCompare(a,b)).map(([file,hash])=>`${hash}  ${file}\n`).join('');
  return createHash('sha256').update(canonical,'utf8').digest('hex');
}
const candidateManifestPath=path.join(root,'work/village-0120/release-tools/candidate-manifest-rc4.json');
const candidateManifest=JSON.parse(fs.readFileSync(candidateManifestPath,'utf8')) as {files:number;canonicalInventorySha256:string;hashes:Record<string,string>};
const productHashesAtStart=productHashes();
function page(win:BrowserWindowType):string|null{try{return new URL(win.webContents.getURL()).searchParams.get('page');}catch{return null;}}
function snapshots():Array<Record<string,unknown>>{
  return [...traces.values()].map(trace=>{try{trace.last={isVisible:trace.visible(),isFocused:trace.focused()};return{id:trace.id,page:trace.page,...trace.last};}catch(error){return{id:trace.id,page:trace.page,...trace.last,destroyed:true,error:String(error)};}});
}
function record(name:string,detail?:unknown,status:'PASS'|'FAIL'|'INFO'='PASS'):void{
  checks.push({name,status,detail});fs.mkdirSync(evidenceDir,{recursive:true,mode:0o700});
  fs.appendFileSync(progressPath,JSON.stringify({at:new Date().toISOString(),name,status,detail})+'\n',{mode:0o600});
}
function report(error?:unknown):void{
  fs.mkdirSync(evidenceDir,{recursive:true,mode:0o700});
  const recordValue={schema:'pixelstreet.0120.picture-interiors.luna-max.hidden-native.v1',scenario,runId,status,at:new Date().toISOString(),
    app:{name:APP_NAME,version:APP_VERSION,profileName:PROFILE_NAME},platform:process.platform,arch:process.arch,electron:process.versions.electron,
    profileRoot,profileFile,preflight:fixture?{version:fixture.version,sequence:fixture.sequence,job:fixture.job,coins:fixture.coins,xp:fixture.xp,campPresent:Object.hasOwn(fixture,'camp'),atelierPresent:Object.hasOwn(fixture,'atelier'),villagePresent:Object.hasOwn(fixture,'village'),owned:BUDDY_ORDER.filter(id=>fixture!.leisure.companions[id]!==null)}:null,
    checks,errors,screenshots,suppression,nativeWindows:snapshots(),keyboardByWindow,cspByWindow,
    productHashesAtStart,productHashesAtEnd:status==='RUNNING'?undefined:productHashes(),productFiles:Object.keys(productHashesAtStart).length,
    productScope:{roots:productRoots,excluded:productExclusions,canonicalInventorySha256:canonicalInventorySha256(productHashesAtStart),candidateManifest:path.relative(root,candidateManifestPath)},
    rawError:error?String(error):undefined,stack:error instanceof Error?error.stack:undefined,
    evidenceBoundary:{
      native:'Independent bootstrap ran before DesktopShell, prohibited app activation on macOS and intercepted BrowserWindow show/showInactive/focus/moveTop/restore, webContents.focus, Dock activation, Tray and globalShortcut. Original BrowserWindow isVisible/isFocused states were sampled; every app window must remain hidden and unfocused.',
      input:'Only HTMLElement.click(), renderer state reads, software-generated hidden street MouseEvent, BrowserWindow.setSize, hidden capturePage and GameRuntime worker test-clock requests were used. No physical pointer, keyboard or IME event is claimed.',
      profile:'A fresh /private/tmp profile was marked, parseProfile-preflighted and read back through GameStore before DesktopShell started. No installed-app profile or old application data path was opened.',
      screenshots:'PNG pixels came from hidden Electron capturePage at 760x650 and 1040x650 CSS viewport sizes; these are not visible-screen or physical-device evidence.',
      runtime:'Real Electron main process, DesktopShell, preload IPC, renderer event handlers and GameWorker profile state. No browser-only substitute.',
      integrity:'SHA-256 inventory covers application source, solo-core, protocol, content, assets and dist runtime. Test files and this dedicated native harness bundle are excluded.',
    }};
  fs.writeFileSync(reportPath,JSON.stringify(recordValue,null,2)+'\n',{flag:'wx',mode:0o600});
  fs.appendFileSync(progressPath,JSON.stringify({at:new Date().toISOString(),finalReport:reportPath,status,errors})+'\n',{mode:0o600});
}
async function until(fn:()=>Promise<boolean>|boolean,label:string,timeout=25_000):Promise<void>{
  const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await new Promise(resolve=>setTimeout(resolve,35));}throw new Error('timeout: '+label);
}
async function js<T=unknown>(win:BrowserWindowType,source:string):Promise<T>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([win.webContents.executeJavaScript(source) as Promise<T>,new Promise<T>((_resolve,reject)=>{timer=setTimeout(()=>reject(new Error('renderer evaluation timed out on '+win.id)),15_000);})]);}
  catch(error){throw new Error('renderer evaluation failed on '+win.id+': '+String(error)+'; expression='+source);}
  finally{if(timer)clearTimeout(timer);}
}
function replace(target:any,key:string,value:unknown):void{
  const descriptor=Object.getOwnPropertyDescriptor(target,key);if(descriptor&&!descriptor.configurable&&!descriptor.writable)throw new Error('cannot suppress Electron '+key);
  Object.defineProperty(target,key,{configurable:true,enumerable:descriptor?.enumerable??true,writable:true,value});
}
function track(win:BrowserWindowType):void{
  if(traces.has(win.id))return;
  const visible=win.isVisible.bind(win),focused=win.isFocused.bind(win);
  traces.set(win.id,{id:win.id,page:page(win),visible,focused,last:{isVisible:visible(),isFocused:focused()}});keyboardByWindow[win.id]=0;cspByWindow[win.id]=[];
  win.webContents.on('console-message',(event:any)=>{if(event.level==='error')errors.push(String(event.message).slice(0,700));});
  const instrument=()=>{void win.webContents.executeJavaScript('(()=>{if(window.__picture0120Installed)return true;window.__picture0120Installed=true;window.__picture0120Keys=0;window.__picture0120Csp=[];for(const t of ["keydown","keyup","keypress"])document.addEventListener(t,()=>window.__picture0120Keys++,true);document.addEventListener("securitypolicyviolation",e=>window.__picture0120Csp.push({directive:e.violatedDirective,blocked:e.blockedURI,sample:e.sample}),true);return true})()').catch(error=>{if(!win.isDestroyed())errors.push('instrument window '+win.id+': '+String(error));});};
  win.webContents.on('did-finish-load',()=>{const t=traces.get(win.id);if(t)t.page=page(win);instrument();});
  if(!win.webContents.isLoadingMainFrame())instrument();
  win.webContents.on('console-message',(event:any)=>{if(/Content Security Policy|style-src|Refused to apply inline style/i.test(String(event.message)))cspByWindow[win.id].push({directive:'console',blocked:'',sample:String(event.message).slice(0,500)});});
}
async function inspectRendererBoundary(win:BrowserWindowType,label:string):Promise<void>{
  await until(()=>js<boolean>(win,'window.__picture0120Installed===true'),label+' keyboard/CSP observer',8_000);
  const state=await js<{keys:number;csp:Array<{directive:string;blocked:string;sample:string}>}>(win,'({keys:window.__picture0120Keys||0,csp:window.__picture0120Csp||[]})');
  keyboardByWindow[win.id]=state.keys;cspByWindow[win.id]=state.csp;
  assert.equal(state.keys,0,label+' renderer received no keyboard events');assert.equal(state.csp.length,0,label+' renderer reported no CSP violations');
  record('renderer keyboard and CSP boundary '+label,{window:win.id,...state});
}
function profile():Profile{const p=shell?.game.state.profile;assert.ok(p,'GameWorker profile unavailable: '+(shell?.game.state.error||'loading'));return p;}
function overlay():BrowserWindowType{assert.ok(shell&&!shell.overlay.isDestroyed(),'street overlay missing');return shell.overlay;}
function popup():BrowserWindowType{const win=shell?.popupWindow;assert.ok(win&&!win.isDestroyed(),'popover missing');return win;}
function casual():BrowserWindowType{const win=shell?.arenaWindow;assert.ok(win&&!win.isDestroyed(),'camp window missing');return win;}
async function clickElement(win:BrowserWindowType,id:string):Promise<void>{assert.ok(await js<boolean>(win,'!!document.getElementById('+JSON.stringify(id)+')'),id+' missing');await js(win,'document.getElementById('+JSON.stringify(id)+').click()');}
async function clickSelector(win:BrowserWindowType,selector:string):Promise<void>{assert.ok(await js<boolean>(win,'!!document.querySelector('+JSON.stringify(selector)+')'),selector+' missing');await js(win,'document.querySelector('+JSON.stringify(selector)+').click()');}
async function scrollTarget(win:BrowserWindowType,id:string):Promise<void>{
  await js(win,'(()=>{const e=document.getElementById('+JSON.stringify(id)+'),c=e?.closest("#cContent"),hidden=!e||e.hidden||!!e.closest("[hidden]")||!!e.closest("details:not([open])")||getComputedStyle(e).display==="none";if(!e||hidden)return false;e.scrollIntoView({block:c?"nearest":"center",inline:"nearest",behavior:"instant"});if(c){for(let i=0;i<48;i++){const r=e.getBoundingClientRect(),cr=c.getBoundingClientRect(),top=Math.max(0,cr.top),bottom=Math.min(innerHeight,cr.bottom),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);if(r.top>=top+2&&r.bottom<=bottom-2&&hit?.closest("button")===e)break;const delta=r.bottom>bottom-2?r.bottom-(bottom-2):r.top<top+2?r.top-(top+2):0,prior=c.scrollTop;c.scrollTop+=delta||32;if(c.scrollTop===prior)break;}}return true})()');
}
async function control(win:BrowserWindowType,id:string):Promise<ButtonInfo>{
  return js(win,'(()=>{const e=document.getElementById('+JSON.stringify(id)+'),hidden=!e||e.hidden||!!e.closest("[hidden]")||!!e.closest("details:not([open])")||getComputedStyle(e).display==="none",r=e?.getBoundingClientRect(),hit=r&&document.elementFromPoint(r.left+r.width/2,r.top+r.height/2),s=e&&getComputedStyle(e),ps=e&&getComputedStyle(e,"::before"),c=e?.closest(".popover-content,#cContent")||document.scrollingElement||document.documentElement,cr=c.getBoundingClientRect();return{id:'+JSON.stringify(id)+',exists:!!e,hidden,disabled:!e||!!e.disabled,label:e?.getAttribute("aria-label")||e?.textContent?.trim()||"",tip:e?.dataset.tooltip||e?.title||"",title:e?.getAttribute("title")||"",kind:e?.dataset.piKind||"",art:e?.dataset.piArt||"",image:ps?.backgroundImage||"",cursor:s?.cursor||"",font:s?parseFloat(s.fontSize):0,selected:e?.getAttribute("aria-selected")==="true"||e?.getAttribute("aria-pressed")==="true",reachable:!hidden&&!!r&&r.width>0&&r.height>0&&r.top>=cr.top-1&&r.bottom<=cr.bottom+1&&hit?.closest("button")===e,rect:r?{x:r.x,y:r.y,width:r.width,height:r.height}:{x:0,y:0,width:0,height:0},hitButton:hit?.closest("button")?.id||null}})()');
}
async function assertButton(win:BrowserWindowType,id:string,options:{enabled?:boolean;picture?:boolean;reason?:RegExp;minFont?:number}={}):Promise<ButtonInfo>{
  await scrollTarget(win,id);const value=await control(win,id);assert.ok(value.exists&&!value.hidden,id+' missing/hidden: '+JSON.stringify(value));
  if(options.enabled!==undefined)assert.equal(value.disabled,!options.enabled,id+' disabled state: '+JSON.stringify(value));
  assert.ok(value.tip.trim(),id+' has no tooltip/disabled reason');assert.ok(value.font>=(options.minFont??16),id+' font is below 16px');
  assert.equal(value.cursor,value.disabled?'not-allowed':'pointer',id+' cursor disagrees with state');
  if(!value.disabled)assert.ok(value.reachable,id+' does not hit its own visible button: '+JSON.stringify(value));
  if(options.picture){assert.ok(value.kind&&value.art,id+' missing picture kind/art marker: '+JSON.stringify(value));assert.notEqual(value.image,'none',id+' missing picture pseudo-element background');}
  if(options.reason)assert.match(value.tip,options.reason,id+' disabled reason: '+value.tip);
  return value;
}
type ImageButtonInfo=ButtonInfo&{imageSelector:string;imageKind:string;imageArt:string;childImage:string};
async function assertImageButton(win:BrowserWindowType,selector:string,label:string,imageSelector:string,options:{enabled?:boolean;reason?:RegExp;minFont?:number}={}):Promise<ImageButtonInfo>{
  const selectorLiteral=JSON.stringify(selector),imageSelectorLiteral=JSON.stringify(imageSelector),labelLiteral=JSON.stringify(label);
  await js(win,`(()=>{const e=document.querySelector(${selectorLiteral});if(!e)return false;e.scrollIntoView({block:"center",inline:"nearest",behavior:"instant"});for(let p=e.parentElement;p;p=p.parentElement){const s=getComputedStyle(p);if(p.scrollHeight>p.clientHeight+1&&/(auto|scroll)/.test(s.overflowY)){const r=e.getBoundingClientRect(),pr=p.getBoundingClientRect();if(r.bottom>pr.bottom-2)p.scrollTop+=r.bottom-pr.bottom+4;else if(r.top<pr.top+2)p.scrollTop-=pr.top-r.top+4}}return true})()`);
  await new Promise(resolve=>setTimeout(resolve,40));
  const value=await js<ImageButtonInfo>(win,`(()=>{const e=document.querySelector(${selectorLiteral}),hidden=!e||e.hidden||!!e.closest("[hidden]")||!!e.closest("details:not([open])")||getComputedStyle(e).display==="none",art=e?.querySelector(${imageSelectorLiteral}),r=e?.getBoundingClientRect(),s=e&&getComputedStyle(e),is=art&&getComputedStyle(art),c=e?.closest(".popover-content,#cContent")||document.scrollingElement||document.documentElement,cr=c.getBoundingClientRect(),x=r?r.left+r.width/2:-1,y=r?r.top+r.height/2:-1,hit=document.elementFromPoint(x,y);return{id:${labelLiteral},exists:!!e,hidden,disabled:!e||!!e.disabled,label:e?.getAttribute("aria-label")||e?.textContent?.trim()||"",tip:e?.dataset.tooltip||e?.title||"",title:e?.getAttribute("title")||"",kind:e?.dataset.piKind||"",art:e?.dataset.piArt||"",image:"",cursor:s?.cursor||"",font:s?parseFloat(s.fontSize):0,selected:e?.getAttribute("aria-selected")==="true"||e?.getAttribute("aria-pressed")==="true",reachable:!hidden&&!!r&&r.width>0&&r.height>0&&x>=cr.left-1&&x<=cr.right+1&&y>=cr.top-1&&y<=cr.bottom+1&&hit?.closest("button")===e,rect:r?{x:r.x,y:r.y,width:r.width,height:r.height}:{x:0,y:0,width:0,height:0},hitButton:hit?.closest("button")?.id||null,imageSelector:${imageSelectorLiteral},imageKind:art?.dataset.kind||art?.dataset.good||art?.dataset.buddy||art?.dataset.rarity||(art?.dataset.path?"path":""),imageArt:art?.dataset.art||art?.dataset.good||art?.dataset.path||art?.dataset.buddy||art?.dataset.rarity||"",childImage:is?.backgroundImage||"none"}})()`);
  assert.ok(value.exists&&!value.hidden,label+' missing/hidden image button: '+JSON.stringify(value));
  if(options.enabled!==undefined)assert.equal(value.disabled,!options.enabled,label+' disabled state: '+JSON.stringify(value));
  assert.ok(value.tip.trim(),label+' has no tooltip/disabled reason');assert.ok(value.font>=(options.minFont??16),label+' font is below 16px');
  assert.equal(value.cursor,value.disabled?'not-allowed':'pointer',label+' cursor disagrees with state');
  if(!value.disabled)assert.ok(value.reachable,label+' does not hit its own visible button: '+JSON.stringify(value));
  assert.ok(value.imageKind&&value.childImage!=='none',label+' child artwork is not rendered: '+JSON.stringify(value));
  if(options.reason)assert.match(value.tip,options.reason,label+' disabled reason: '+value.tip);
  return value;
}
async function clickImageButton(win:BrowserWindowType,selector:string,label:string,imageSelector:string,options:{enabled?:boolean;reason?:RegExp}={}):Promise<ImageButtonInfo>{
  const value=await assertImageButton(win,selector,label,imageSelector,{...options,enabled:options.enabled??true});
  await js(win,'document.querySelector('+JSON.stringify(selector)+').click()');record('software image-button click '+label,{label:value.label,tooltip:value.tip,title:value.title,childArtwork:{selector:value.imageSelector,kind:value.imageKind,art:value.imageArt,background:value.childImage},rect:value.rect,hitButton:value.hitButton,input:'HTMLElement.click() after native-hidden center hit test; software-only'});return value;
}
async function click(win:BrowserWindowType,id:string,options:{enabled?:boolean;picture?:boolean;reason?:RegExp;minFont?:number}={}):Promise<ButtonInfo>{
  const value=await assertButton(win,id,{...options,enabled:options.enabled??true});
  await clickElement(win,id);record('software DOM click '+id,{label:value.label,tooltip:value.tip,title:value.title,art:{kind:value.kind,art:value.art},rect:value.rect,hitButton:value.hitButton,input:'HTMLElement.click() after native-hidden center hit test; software-only'});return value;
}
async function localClick(win:BrowserWindowType,id:string,selected?:string):Promise<ButtonInfo>{
  const before=profile().sequence,value=await click(win,id,{picture:true});
  if(selected)await until(()=>js<boolean>(win,'('+selected+')'),'local state after '+id);
  assert.equal(profile().sequence,before,id+' selection unexpectedly reached GameWorker');return value;
}
async function localImageClick(win:BrowserWindowType,id:string,selected:string,imageSelector:string):Promise<ImageButtonInfo>{
  const before=profile().sequence,value=await clickImageButton(win,'#'+id,id,imageSelector);
  await until(()=>js<boolean>(win,'('+selected+')'),'local image selection after '+id);
  assert.equal(profile().sequence,before,id+' image selection unexpectedly reached GameWorker');return value;
}
async function action(win:BrowserWindowType,id:string,checkState?:(p:Profile)=>void):Promise<Profile>{
  const before=profile().sequence,value=await click(win,id,{picture:true});
  await until(()=>profile().sequence===before+1,'one GameWorker receipt for '+id);const after=profile();checkState?.(after);
  record('real GameWorker action '+id,{sequenceBefore:before,sequenceAfter:after.sequence,coins:after.coins,notice:after.notice,label:value.label,tooltip:value.tip,input:'software DOM click; authoritative worker profile readback'});return after;
}
async function actionImage(win:BrowserWindowType,id:string,checkState:(p:Profile)=>void,imageSelector:string):Promise<Profile>{
  const before=profile().sequence,value=await clickImageButton(win,'#'+id,id,imageSelector);
  await until(()=>profile().sequence===before+1,'one GameWorker receipt for image button '+id);const after=profile();checkState(after);
  record('real GameWorker action through image button '+id,{sequenceBefore:before,sequenceAfter:after.sequence,coins:after.coins,notice:after.notice,label:value.label,tooltip:value.tip,childArtwork:{kind:value.imageKind,art:value.imageArt,background:value.childImage},input:'software DOM click; authoritative worker profile readback'});return after;
}
async function disabled(win:BrowserWindowType,id:string,reason:RegExp):Promise<ButtonInfo>{
  const value=await assertButton(win,id,{enabled:false,picture:true,reason});
  assert.ok(!value.title||!reason.test(value.title),id+' overwrote native title with its dynamic disabled reason');
  record('disabled picture action preserves its static title and exposes current reason',{id,title:value.title,tooltip:value.tip,reason:String(reason)});return value;
}
async function capture(win:BrowserWindowType,label:string,width:number):Promise<void>{
  await new Promise(resolve=>setTimeout(resolve,90));const image=await win.webContents.capturePage(),size=image.getSize(),file=path.join(evidenceDir,`screen-${runId}-${width}-${label}.png`),bytes=image.toPNG();
  fs.writeFileSync(file,bytes,{flag:'wx',mode:0o600});screenshots.push(file);assert.ok(bytes.length>7000,label+' hidden capture is unexpectedly empty');assert.equal(win.isVisible(),false);assert.equal(win.isFocused(),false);
  const geometry=await js<{width:number;height:number;pageWidth:number;bodyWidth:number}>(win,'({width:innerWidth,height:innerHeight,pageWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth})');
  assert.ok(geometry.pageWidth<=geometry.width+1,label+' has horizontal page overflow '+JSON.stringify(geometry));
  record('hidden native capture '+label,{file,viewport:geometry,capture:size,bytes:bytes.length,native:{visible:win.isVisible(),focused:win.isFocused()}});
}
async function resize(win:BrowserWindowType,width:number):Promise<void>{
  const debuggerApi=win.webContents.debugger;if(!debuggerApi.isAttached()){debuggerApi.attach('1.3');viewportSessions.set(win.id,true);}
  await debuggerApi.sendCommand('Emulation.setDeviceMetricsOverride',{width,height:650,deviceScaleFactor:1,mobile:false});
  await until(()=>js<boolean>(win,'innerWidth==='+String(width)+'&&innerHeight===650'),'native renderer viewport '+width+'x650');
  record('hidden native Electron renderer uses software CDP viewport',{window:win.id,cssViewport:[width,650],outerWindowSize:win.getSize(),method:'Emulation.setDeviceMetricsOverride; hidden software presentation only'});
}
async function auditPictures(win:BrowserWindowType,scope:string,label:string):Promise<void>{
  const ids=await js<string[]>(win,'[...document.querySelectorAll('+JSON.stringify(scope+' button[data-pi-control]')+')].filter(e=>!e.hidden&&!e.closest("[hidden]")&&!e.closest("details:not([open])")&&getComputedStyle(e).display!=="none").map(e=>e.id)');
  assert.ok(ids.length, label+' has no visible picture controls');
  const found:ButtonInfo[]=[];
  for(const id of ids)found.push(await assertButton(win,id,{picture:true}));
  record('visible picture buttons have art, tooltip, readable type and center hit target '+label,{count:found.length,ids,minimumFont:Math.min(...found.map(x=>x.font)),allReachable:found.every(x=>x.reachable),viewport:await js(win,'({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth})')});
}
async function tab(win:BrowserWindowType,id:string,panel:string):Promise<void>{
  await click(win,id,{picture:true});await until(()=>js<boolean>(win,'!document.getElementById('+JSON.stringify(panel)+').hidden&&document.getElementById('+JSON.stringify(id)+').getAttribute("aria-selected")==="true"'),id+' active tab');
}
async function advanceWorker(ms:number,label:string):Promise<Profile>{
  assert.ok(shell);const before=profile(),result=await shell.game.request('advance',{ms});assert.ok(result.profile,'GameWorker accepted test-clock advance');
  await new Promise(resolve=>setTimeout(resolve,90));record('GameWorker test clock '+label,{requestedMs:ms,tickBefore:before.tick,tickAfter:result.profile.tick,sequence:result.profile.sequence,boundary:'software clock request to real GameWorker; not elapsed user time'});return result.profile;
}
async function openShop():Promise<BrowserWindowType>{
  const street=overlay();await until(()=>!!shell&&Reflect.get(shell,'overlayCold')===false&&js<boolean>(street,'document.body.dataset.view!==undefined&&!!document.querySelector("[data-shop=\\"shop-bakery\\"]")'),'hidden street supply keeper');
  if(shell?.view!=='interior'||shell.activeShop!=='shop-bakery'){await clickSelector(street,'[data-shop="shop-bakery"]');await until(()=>shell?.view==='interior'&&shell.activeShop==='shop-bakery','enter supply shop');}
  const scene=await js<{x:number;y:number;scale:number}>(street,'({x:Number(document.body.dataset.worldX),y:Number(document.body.dataset.worldY),scale:Number(document.body.dataset.worldScale)})');
  assert.ok(Number.isFinite(scene.x+scene.y+scene.scale)&&scene.scale>0,'street world transform loaded');
  await js(street,'document.dispatchEvent(new MouseEvent("click",{bubbles:true,clientX:'+String(scene.x+244*scene.scale)+',clientY:'+String(scene.y-20*scene.scale)+'}))');
  const win=popup();await until(()=>js<boolean>(win,'document.body.dataset.popupReady==="true"&&document.body.dataset.popup==="shop"&&!!document.getElementById("livingScene")'),'shop popup ready');
  assert.equal(win.isVisible(),false);assert.equal(win.isFocused(),false);record('hidden street MouseEvent opened the real supply shop popup',{scene,window:win.id,native:{visible:win.isVisible(),focused:win.isFocused()},boundary:'software renderer event; not physical pointer'});return win;
}
async function openAlchemy():Promise<BrowserWindowType>{
  if(shell?.popupWindow&&!shell.popupWindow.isDestroyed()){await clickElement(shell.popupWindow,'popupClose');await until(()=>shell?.popup===null,'prior popup close');}
  const street=overlay();if(shell?.view!=='interior'||shell.activeShop!=='shop-alchemy'){await clickSelector(street,'[data-shop="shop-alchemy"]');await until(()=>shell?.view==='interior'&&shell.activeShop==='shop-alchemy','enter alchemy shop');}
  const scene=await js<{x:number;y:number;scale:number}>(street,'({x:Number(document.body.dataset.worldX),y:Number(document.body.dataset.worldY),scale:Number(document.body.dataset.worldScale)})');
  await js(street,'document.dispatchEvent(new MouseEvent("click",{bubbles:true,clientX:'+String(scene.x+484*scene.scale)+',clientY:'+String(scene.y-20*scene.scale)+'}))');
  const win=popup();await until(()=>js<boolean>(win,'document.body.dataset.popupReady==="true"&&document.body.dataset.popup==="alchemy"&&!!document.getElementById("alchemyScene")'),'alchemy popup ready');
  assert.equal(win.isVisible(),false);assert.equal(win.isFocused(),false);record('hidden street MouseEvent opened the real alchemy popup',{scene,window:win.id,native:{visible:win.isVisible(),focused:win.isFocused()},boundary:'software renderer event; not physical pointer'});return win;
}
async function openCasual():Promise<BrowserWindowType>{
  const street=overlay();await clickElement(street,'dungeonSign');await until(()=>!!shell?.arenaWindow&&!shell.arenaWindow.isDestroyed(),'hidden companion camp window created');
  const win=casual();await until(()=>js<boolean>(win,'document.body.dataset.casualReady==="true"&&document.getElementById("cCampHome")&&document.getElementById("cBuddyView-company")'),'casual renderer ready');
  assert.equal(win.isVisible(),false);assert.equal(win.isFocused(),false);record('hidden native companion camp is ready',{window:win.id,page:page(win),native:{visible:win.isVisible(),focused:win.isFocused()}});return win;
}
async function openFromCamp(win:BrowserWindowType,id:string,panel:string):Promise<void>{
  await click(win,id);await until(()=>js<boolean>(win,'document.getElementById("cCampHome").hidden&&!document.getElementById("cCampWorkspace").hidden&&!document.getElementById('+JSON.stringify(panel)+').hidden'),'camp location '+id+' opened '+panel);
}
async function selectLifeTab(win:BrowserWindowType,id:string):Promise<void>{await tab(win,'lifeTab-'+id,'lifePanel-'+id);}
async function selectCasualTab(win:BrowserWindowType,id:string):Promise<void>{await click(win,'cTab-'+id);await until(()=>js<boolean>(win,'!document.getElementById('+JSON.stringify('cPanel-'+id)+').hidden&&document.getElementById('+JSON.stringify('cTab-'+id)+').getAttribute("aria-selected")==="true"'),'casual tab '+id);}

function makeFixture(now:number):Profile{
  const p=initialProfile(now);
  if(scenario==='visitor')return parseProfile(p);
  if(scenario==='apprentice'){
    p.job='apprentice';p.coins=60;p.bag.flour=8;p.bag.ration=0;p.bag.crystal=0;p.bag.gel=0;
    return parseProfile(p);
  }
  p.job='keeper';p.coins=scenario==='rich'?600_000:20_000;p.xp=scenario==='rich'?12_000:300;p.totals.earned=p.coins;
  p.business.managed=true;p.business.till=20;p.business.completed=0;p.business.reputation=0;p.bag.flour=400;p.bag.ration=60;p.bag.crystal=40;p.bag.gel=120;
  p.leisure.materials={herb:600,berry:600,mushroom:600,ore:1800,tea:600,biscuit:600,soup:600,pumpkin:600,snowflower:600,pie:600,snowtea:600};
  p.leisure.clears=[5,5,5,5,5];p.leisure.cooked=120;p.leisure.harvests=30;
  if(scenario==='rich'){
    p.camp=initialCamp();p.atelier=initialAtelier();
    for(const good of GOOD_IDS){p.atelier.stock[good]=240;p.atelier.made[good]=150;}
    p.atelier.till=321;p.atelier.stock.ingot=300;
    p.leisure.companions={slime:14,guide:14,guard:14,fox:14,deer:14,otter:14,owl:14,bear:14,bird:14};
    p.leisure.active='slime';const bonds=initialBonds();
    for(const id of BUDDY_ORDER)bonds.progress[id]={path:null,rank:0,voyages:20,stories:0};
    bonds.support='guide';bonds.relics.fill(1);bonds.tokens=1200;p.leisure.bonds=bonds;
    p.leisure.journal.dust=1600;p.leisure.journal.buildings={lodge:3,workshop:3,archive:3};
    p.camp.jobs={counter:null,workshop:null,garden:null};
    p.camp.last={basic:{id:'ration',count:1},supply:{id:'picnic',count:1},alchemy:{id:'dew',count:1},kitchen:{id:'biscuit',count:1}};
  }
  return parseProfile(p);
}

async function checkShopTabsAndScene(win:BrowserWindowType):Promise<void>{
  const tabs=[['shopTabSupply','shopPanelSupply'],['shopTabCraft','shopPanelCraft'],['shopTabOrders','shopPanelOrders'],['shopTabManage','shopPanelManage'],['shopTabSpecials','shopPanelSpecials']] as const;
  await click(win,'lsCounter');await until(()=>js<boolean>(win,'!document.getElementById("roomWorkspace").hidden'),'counter enters shop workspace for tab review');
  for(const width of [760,1040]){
    await resize(win,width);
    for(const[id,panel]of tabs){await tab(win,id,panel);await capture(win,`shop-${id}-${width}`,width);await auditPictures(win,'#shopUi',`shop ${id} ${width}`);}
  }
  await tab(win,'shopTabSpecials','shopPanelSpecials');
  for(const width of [760,1040]){
    await resize(win,width);
    for(const name of ['craft','sales','study'] as const){
      await tab(win,'aTab-'+name,'aPanel-'+name);
      if(name==='craft')await js(win,'(()=>{const d=document.querySelector("#shopPanelSpecials details.a-market");if(d)d.open=true;return!!d})()');
      await capture(win,`shop-special-${name}-${width}`,width);await auditPictures(win,'#shopUi',`shop special ${name} ${width}`);
      if(name==='craft')await js(win,'(()=>{const d=document.querySelector("#shopPanelSpecials details.a-market");if(d)d.open=false})()');
    }
  }
  await resize(win,1040);
  await click(win,'roomBack');await until(()=>js<boolean>(win,'!document.getElementById("roomSceneView").hidden'),'return to shop scene for destination review');
  const destinations=['lsCounter','lsSupplies','lsOven','lsShelf','lsLedger','lsRecipes','lsStudy','lsOrders'];
  for(const id of destinations){
    assert.ok(await js<boolean>(win,'!!document.getElementById('+JSON.stringify(id)+')'),'store scene destination '+id);
    await click(win,id);await until(()=>js<boolean>(win,'!document.getElementById("roomWorkspace").hidden'),'shop scene object '+id+' opens workspace');
    const selected=await js<string>(win,'document.querySelector("#shopUi [aria-selected=true]")?.id||""');record('shop pictorial destination opens its original workspace',{id,selected});
    await click(win,'roomBack');await until(()=>js<boolean>(win,'!document.getElementById("roomSceneView").hidden&&document.getElementById("roomWorkspace").hidden'),'shop room back '+id);
  }
  await click(win,'lsCounter');await until(()=>js<boolean>(win,'!document.getElementById("roomWorkspace").hidden'),'re-enter shop workspace after pictorial destination review');
}

async function checkToolbarAndManual(win:BrowserWindowType,station:'supply'|'alchemy'):Promise<void>{
  const sequence=profile().sequence;
  for(const id of ['lifeOpen','roomVillageProjects','roomVillageRegulars','roomVillagePlans'])await assertImageButton(win,'#'+id,id,'.inner-art');
  await click(win,'lifeOpen');await until(()=>js<boolean>(win,'!document.getElementById("lifePanel").hidden'),'ledger toolbar opens management');
  for(const [entry,view] of [['roomVillageProjects','projects'],['roomVillageRegulars','regulars'],['roomVillagePlans','plans']] as const){
    await click(win,entry);const panelSelector='#villageUi [data-v-ref="panel-'+view+'"]',navSelector='#villageUi [data-v-ref="nav-'+view+'"]';
    await until(()=>js<boolean>(win,'(()=>{const r=document.getElementById("roomVillagePanel"),p=document.querySelector('+JSON.stringify(panelSelector)+'),n=document.querySelector('+JSON.stringify(navSelector)+');return !!r&&!r.hidden&&!!p&&!p.hidden&&n?.getAttribute("aria-pressed")==="true"})()'),'popover toolbar '+entry+' opens '+view);
    const toolbar=await js<Array<{id:string;art:string;background:string}>>(win,'[...document.querySelectorAll("#roomWorkspace .life-switch > button")].map(e=>({id:e.id,art:e.querySelector(".inner-art")?.dataset.art||e.querySelector(".inner-art")?.dataset.sprite||"",background:getComputedStyle(e.querySelector(".inner-art")||e).backgroundImage}))');
    record('popover village toolbar remains picture-led',{entry,view,toolbar});
    if(view==='plans'){
      const manualSelector='#villageUi [data-v-ref="manual"]',stationSelector=(id:string)=>'#villageUi [data-v-ref="'+id+'"]';
      const manual=await assertImageButton(win,manualSelector,'manual','.inner-art');assert.equal(manual.disabled,false);
      await clickImageButton(win,stationSelector('station-kitchen'),'station-kitchen','.inner-art');
      const kitchenManual=await assertImageButton(win,manualSelector,'manual','.inner-art');assert.equal(kitchenManual.disabled,false,'kitchen handoff must remain available');
      await clickImageButton(win,manualSelector,'manual','.inner-art');await until(()=>js<boolean>(win,'!document.getElementById("lifePanel-production").hidden'),'kitchen manual returns to native cooking page');
      const back=await assertButton(win,'lifeBack');assert.equal(back.hidden,false);await click(win,'lifeBack');await until(()=>js<boolean>(win,'!document.getElementById("lifeRegular").hidden'),'kitchen manual back returns to current store');
      await click(win,'roomVillagePlans');await until(()=>js<boolean>(win,'(()=>{const r=document.getElementById("roomVillagePanel"),p=document.querySelector("#villageUi [data-v-ref=\\"panel-plans\\"]"),n=document.querySelector("#villageUi [data-v-ref=\\"nav-plans\\"]");return !!r&&!r.hidden&&!!p&&!p.hidden&&n?.getAttribute("aria-pressed")==="true"})()'),'return to plans after kitchen manual');
      const storeManual=await assertImageButton(win,manualSelector,'manual','.inner-art');assert.equal(storeManual.disabled,false,'current store manual should be available');
      const other=station==='supply'?'alchemy':'supply';await clickImageButton(win,stationSelector('station-'+other),'station-'+other,'.inner-art');
      const cross=await js<{exists:boolean;hidden:boolean;kind:string;art:string}>(win,'(()=>{const e=document.querySelector('+JSON.stringify(manualSelector)+'),a=e?.querySelector(".inner-art");return{exists:!!e,hidden:!e||e.hidden||!!e.closest("[hidden]"),kind:a?.dataset.kind||"",art:a?.dataset.art||""}})()');
      assert.ok(cross.exists);assert.equal(cross.hidden,true,'cross-store manual must be hidden');record('cross-station manual is unavailable',{station,other,manual:cross});
      await clickImageButton(win,stationSelector('station-'+station),'station-'+station,'.inner-art');const currentManual=await assertImageButton(win,manualSelector,'manual','.inner-art');assert.equal(currentManual.hidden,false);
      await clickImageButton(win,manualSelector,'manual','.inner-art');await until(()=>js<boolean>(win,station==='supply'?'!document.getElementById("aPanel-craft").hidden&&document.getElementById("shopPanelSpecials").getAttribute("aria-labelledby")==="shopTabSpecials"':'!document.getElementById("aPanel-craft").hidden'),'current store manual returns to its own craft page');
      if(station==='supply')assert.equal(await js<string>(win,'document.getElementById("shopUi").dataset.shopTab'),'specials','supply manual remains within current supply shop');
      await click(win,'lifeOpen');await until(()=>js<boolean>(win,'!document.getElementById("lifePanel").hidden'),'reopen current store ledger');
      await click(win,'lifeBack');await until(()=>js<boolean>(win,'!document.getElementById("lifeRegular").hidden'),'store manual back returns to its shop scene');
    }else{
      await click(win,'lifeBack');await until(()=>js<boolean>(win,'!document.getElementById("lifeRegular").hidden'),'village back returns to alchemy scene');
    }
  }
  assert.equal(profile().sequence,sequence,'opening/read-only toolbar and manual routes changed no worker data');
  record('popover toolbar, local back, same-store and kitchen manual routes are readable navigation only',{station,sequence,after:profile().sequence});
}

async function shopTransactions(win:BrowserWindowType):Promise<void>{
  await tab(win,'shopTabSupply','shopPanelSupply');
  const flourBefore=profile().bag.flour;await action(win,'buyFlour',p=>assert.equal(p.bag.flour,flourBefore+10));
  await tab(win,'shopTabCraft','shopPanelCraft');const rationBefore=profile().bag.ration,seqBefore=profile().sequence;
  await action(win,'craftRation',p=>assert.ok(p.sequence===seqBefore+1));
  assert.ok(profile().queue,'basic shop craft enters real worker queue');
  const recipeTicks=craftTicks('ration',profile().business);await advanceWorker((recipeTicks+1)*100,'complete one shop ration');
  assert.equal(profile().bag.ration,rationBefore+1,'finished craft is delivered to the real bag');assert.equal(profile().queue,null,'shop worker queue completes');
  await tab(win,'shopTabManage','shopPanelManage');const shelfBefore=profile().business.shelves.ration.stock,bagBefore=profile().bag.ration;
  await action(win,'stock-ration',p=>{assert.equal(p.business.shelves.ration.stock,shelfBefore+5);assert.equal(p.bag.ration,bagBefore-5);});
  await action(win,'price-ration-quick',p=>assert.equal(p.business.shelves.ration.tier,'quick'));
  const stockAfter=profile().business.shelves.ration.stock,tillBefore=profile().business.till;
  await action(win,'retailToggle',p=>assert.equal(p.retail,true));await advanceWorker(18_100,'one quick ordinary shelf sale');
  assert.equal(profile().business.shelves.ration.stock,stockAfter-1,'shop clock sells one listed real product');assert.ok(profile().business.till>tillBefore,'shop sale reaches the real till');
  const cashBefore=profile().coins,till=profile().business.till;await action(win,'collectTill',p=>{assert.equal(p.coins,cashBefore+till);assert.equal(p.business.till,0);});
  await tab(win,'shopTabOrders','shopPanelOrders');const order=profile().business.orders[0],coinsBefore=profile().coins;
  await action(win,'acceptOrder-0',p=>assert.equal(p.business.orders[0].accepted,true));
  await action(win,'deliverOrder-0',p=>{assert.equal(p.business.orders[0].accepted,false);assert.equal(p.business.orders[0].revision,order.revision+1);assert.ok(p.coins>coinsBefore);});
  await tab(win,'shopTabManage','shopPanelManage');const level=profile().business.upgrades.oven;
  await action(win,'shopUpgrade-oven',p=>assert.equal(p.business.upgrades.oven,level+1));
  await tab(win,'shopTabSpecials','shopPanelSpecials');await tab(win,'aTab-craft','aPanel-craft');
  await js(win,'(()=>{const d=document.querySelector("#shopPanelSpecials details.a-market");if(d)d.open=true;return!!d})()');
  const herbBefore=profile().leisure.materials.herb,purchaseCoinsBefore=profile().coins;
  await action(win,'aBuy1-herb',p=>{assert.equal(p.leisure.materials.herb,herbBefore+1);assert.equal(p.coins,purchaseCoinsBefore-3);});
  record('pictured raw-material purchase reaches true atelier inventory',{item:'herb',before:herbBefore,after:profile().leisure.materials.herb,coins:profile().coins});
  record('shop operations affect actual isolated GameWorker state: purchase, craft/completion, shelf, price, sale, collection, order and facility',{coins:profile().coins,bag:profile().bag,business:{managed:profile().business.managed,till:profile().business.till,shelves:profile().business.shelves,upgrades:profile().business.upgrades,orders:profile().business.orders}});
}

async function alchemyTabsAndTransactions(win:BrowserWindowType,station:'supply'|'alchemy'):Promise<void>{
  const tabNames=['craft','sales','study'] as const;
  for(const width of [760,1040]){
    await resize(win,width);
    for(const name of tabNames){
      await tab(win,'aTab-'+name,'aPanel-'+name);
      if(name==='craft')await js(win,'(()=>{const d=document.querySelector("#atelierUi details.a-market");if(d)d.open=true;return!!d})()');
      await capture(win,`alchemy-${station}-${name}-${width}`,width);await auditPictures(win,'#atelierUi',`alchemy ${station} ${name} ${width}`);
      if(name==='craft')await js(win,'(()=>{const d=document.querySelector("#atelierUi details.a-market");if(d)d.open=false})()');
    }
  }
  await resize(win,1040);await tab(win,'aTab-craft','aPanel-craft');
  const good:Good=station==='supply'?'stew':'dew';
  await click(win,'aQty1');record('selected one-item production batch on the pictured atelier workbench',{good,quantity:1});
  const goodButton='aPick-'+good;await localImageClick(win,goodButton,'document.getElementById('+JSON.stringify(goodButton)+')?.getAttribute("aria-pressed")==="true"','.a-good-art');
  assert.equal((await control(win,'aCraft')).art,good,'craft action artwork tracks the selected actual product');
  const madeBefore=profile().atelier!.made[good],stockBefore=profile().atelier!.stock[good];await action(win,'aCraft',p=>assert.equal(p.atelier!.queues[station][0]?.good,good));
  await advanceWorker((atelierTicks(profile().atelier!,good,profile())+1)*100,'finish one real alchemy product');
  assert.equal(profile().atelier!.queues[station].length,0);assert.equal(profile().atelier!.made[good],madeBefore+1);assert.equal(profile().atelier!.stock[good],stockBefore+1);
  await tab(win,'aTab-sales','aPanel-sales');const listedBefore=profile().atelier!.shelves[good].stock,available=profile().atelier!.stock[good],shelfRoom=atelierShelfLimit(profile().atelier!)-Object.values(profile().atelier!.shelves).reduce((n,v)=>n+v.stock,0),stocked=Math.min(available,shelfRoom);
  await action(win,'aStockAll',p=>assert.equal(p.atelier!.shelves[good].stock,listedBefore+stocked));
  await action(win,'aPrice-quick',p=>assert.equal(p.atelier!.shelves[good].quote,'quick'));
  const tillBefore=profile().atelier!.till,shelfCount=profile().atelier!.shelves[good].stock;
  await action(win,'aOpen',p=>assert.equal(p.atelier!.open[station],true));await advanceWorker(QUICK_ALCHEMY_MS,'one quick alchemy sale');
  assert.equal(profile().atelier!.shelves[good].stock,shelfCount-1);assert.ok(profile().atelier!.till>tillBefore);
  const coinBefore=profile().coins,cash=profile().atelier!.till;await action(win,'aCollect',p=>{assert.equal(p.coins,coinBefore+cash);assert.equal(p.atelier!.till,0);});
  const order=stableAtelierOrder(profile(),station,0),beforeCoins=profile().coins;await action(win,'aAccept0',p=>assert.equal(p.atelier!.orders[station][0].accepted,true));
  await tab(win,'aTab-craft','aPanel-craft');await click(win,'aQty5');
  const orderGoodButton='aPick-'+order.good;await localImageClick(win,orderGoodButton,'document.getElementById('+JSON.stringify(orderGoodButton)+')?.getAttribute("aria-pressed")==="true"','.a-good-art');
  const orderStock=profile().atelier!.stock[order.good];await action(win,'aCraft',p=>{assert.equal(p.atelier!.queues[station][0]?.good,order.good);assert.equal(p.atelier!.queues[station][0]?.remaining,5);});
  await advanceWorker((atelierTicks(profile().atelier!,order.good,profile())+1)*5*100,'produce goods for the displayed alchemy order');
  assert.equal(profile().atelier!.stock[order.good],orderStock+5);assert.equal(profile().atelier!.queues[station].length,0);
  await tab(win,'aTab-sales','aPanel-sales');await action(win,'aDeliver0',p=>{assert.equal(p.atelier!.orders[station][0].accepted,false);assert.equal(p.atelier!.orders[station][0].revision,order.revision+1);assert.ok(p.coins>beforeCoins);});
  await tab(win,'aTab-study','aPanel-study');const facility=station==='supply'?'kitchen':'still',level=profile().atelier!.facilities[facility];
  await action(win,'aUpgrade-'+facility,p=>assert.equal(p.atelier!.facilities[facility],level+1));
  record('alchemy interior transactions reach the correct real station and worker state',{station,good,made:profile().atelier!.made[good],shelf:profile().atelier!.shelves[good],till:profile().atelier!.till,facility,level:profile().atelier!.facilities[facility]});
}

async function inspectVillageToolbar(win:BrowserWindowType):Promise<void>{
  await checkShopTabsAndScene(win);
}

async function campAndBonds(win:BrowserWindowType):Promise<void>{
  await openFromCamp(win,'csTent','cPanel-friends');await selectCasualTab(win,'friends');
  assert.equal(await js<number>(win,'document.querySelectorAll("#cPanel-friends .b-buddy-pick").length'),9,'nine companion roster images exist');
  const atlas=await js<{ids:string[];backgrounds:string[];positions:string[];loaded:boolean;size:{width:number;height:number}}>(win,'(async()=>{const es=[...document.querySelectorAll("#cPanel-friends .b-buddy-pick .b-buddy-art[data-buddy]")],bg=getComputedStyle(es[0]).backgroundImage,url=bg.match(/url\\(["\\\']?(.*?)["\\\']?\\)/)?.[1]||"",img=new Image();img.src=url;try{await img.decode()}catch{}return{ids:es.map(e=>e.dataset.buddy),backgrounds:[...new Set(es.map(e=>getComputedStyle(e).backgroundImage))],positions:es.map(e=>getComputedStyle(e).backgroundPosition),loaded:img.naturalWidth>0,size:{width:img.naturalWidth,height:img.naturalHeight}}})()');
  assert.deepEqual(atlas.ids,BUDDY_ORDER);assert.equal(new Set(atlas.positions).size,9,'nine distinct companion portraits');assert.ok(atlas.loaded&&atlas.size.width>0);record('all nine companion portraits load as distinct images',atlas);
  for(const width of [760,1040]){
    await resize(win,width);await click(win,'cBuddyView-company',{picture:true});await until(()=>js<boolean>(win,'!document.getElementById("cBuddyViewPanel-company").hidden'),'companion company view before roster capture '+width);
    await capture(win,`bonds-roster-${width}`,width);await auditPictures(win,'#cPanel-friends',`bonds roster ${width}`);
    if(width===760)for(const id of BUDDY_ORDER){await localImageClick(win,'cBuddyPick-'+id,'document.getElementById("cBuddyPortrait").dataset.buddy==='+JSON.stringify(id),'.b-buddy-art');}
    await click(win,'cBuddyView-training',{picture:true});await capture(win,`bonds-routes-${width}`,width);await auditPictures(win,'#cBuddyViewPanel-training',`bonds route nodes ${width}`);
    const routeBuddy=width===760?'deer':'bear';await localImageClick(win,'cBuddyPick-'+routeBuddy,'document.getElementById("cBuddyPortrait").dataset.buddy==='+JSON.stringify(routeBuddy),'.b-buddy-art');
    const routes=(width===760?Object.keys(PATHS):['scout']) as TrainingPath[];
    for(const route of routes){const before=profile().sequence;await actionImage(win,'cBuddyPath-'+route,p=>assert.equal(p.leisure.bonds!.progress[routeBuddy].path,route),'.b-path-emblem');assert.equal(profile().sequence,before+1);}
  }
  await click(win,'cBuddyView-company',{picture:true});await localImageClick(win,'cBuddyPick-guide','document.getElementById("cBuddyPortrait").dataset.buddy==="guide"','.b-buddy-art');
  await action(win,'cBuddyLead',p=>{assert.equal(p.leisure.active,'guide');assert.equal(p.leisure.bonds!.support,null);});
  await localImageClick(win,'cBuddyPick-fox','document.getElementById("cBuddyPortrait").dataset.buddy==="fox"','.b-buddy-art');await action(win,'cBuddySupport',p=>{assert.equal(p.leisure.active,'guide');assert.equal(p.leisure.bonds!.support,'fox');});
  await selectCasualTab(win,'collection');await click(win,'cArchiveNew');
  for(const width of [760,1040]){
    await resize(win,width);await capture(win,`rarity-gallery-${width}`,width);await auditPictures(win,'#cPanel-collection',`rarity gallery ${width}`);
    for(let i=0;i<15;i++)await clickImageButton(win,'#cCharmPick'+i,'cCharmPick'+i,'.b-exhibit .b-rarity-art');
    const rarityAtlas=await js<{count:number;background:string;uniquePositions:number}>(win,'(()=>{const es=[...document.querySelectorAll("#cPanel-collection .b-rarity-pick .b-rarity-art")];return{count:es.length,background:getComputedStyle(es[0]).backgroundImage,uniquePositions:new Set(es.map(e=>getComputedStyle(e).backgroundPosition)).size}})()');
    assert.equal(rarityAtlas.count,15);assert.equal(rarityAtlas.uniquePositions,15,'all rarity image controls show distinct relic art');record('all rarity image controls render distinct atlas cells',{width,...rarityAtlas});
  }
  await click(win,'cCharmPick0');
  await action(win,'cCharmEquip',p=>assert.ok(p.leisure.bonds!.loadout.includes(0)));
  const rarity=profile().leisure.bonds!.relics[0],token=profile().leisure.bonds!.tokens,dust=profile().leisure.journal.dust;
  await action(win,'cCharmUpgrade',p=>{assert.equal(p.leisure.bonds!.relics[0],rarity+1);assert.equal(p.leisure.bonds!.tokens,token-8);assert.equal(p.leisure.journal.dust,dust-6);});
  record('leader/support exclusivity and rarity equip/repair are real worker actions',{leader:profile().leisure.active,support:profile().leisure.bonds!.support,loadout:profile().leisure.bonds!.loadout,rarity:profile().leisure.bonds!.relics[0]});

  await selectCasualTab(win,'camp');await selectLifeTab(win,'jobs');
  for(const job of ['counter','workshop','garden'] as const){
    await localClick(win,'lifeWorkplace-'+job,'document.querySelector("#lifeWorkplacePanel-'+job+'").hidden===false');
    const buddy=job==='counter'?'guard':job==='workshop'?'owl':'bear';
    await clickImageButton(win,'#lifeJobPick-'+job+'-'+buddy,'lifeJobPick-'+job+'-'+buddy,'.life-buddy');
    await action(win,'lifeAssign-'+job,p=>assert.equal(p.camp!.jobs[job],buddy));
  }
  for(const width of [760,1040]){await resize(win,width);await capture(win,`camp-jobs-${width}`,width);await auditPictures(win,'#lifePanel-jobs',`camp jobs ${width}`);}
  await selectLifeTab(win,'production');
  for(const id of Object.keys(FOODS) as Food[])await assertImageButton(win,'#lifeFoodPick-'+id,'lifeFoodPick-'+id,'.inner-art.life-food-art');
  const food:Food='pie';await localImageClick(win,'lifeFoodPick-'+food,'document.getElementById("lifeFoodPick-'+food+'").getAttribute("aria-pressed")==="true"','.inner-art.life-food-art');
  assert.equal((await control(win,'lifeCook1')).art,food,'camp cook action art follows the selected dish');
  const foodBefore=profile().leisure.materials[food],cookedBefore=profile().leisure.cooked;
  await action(win,'lifeCook1',p=>assert.equal(p.camp!.cooking[0]?.food,food));
  await advanceWorker((foodTicks(profile(),food)+1)*100,'finish one selected camp meal');
  assert.equal(profile().leisure.materials[food],foodBefore+1);assert.equal(profile().leisure.cooked,cookedBefore+1);
  for(const width of [760,1040]){await resize(win,width);await capture(win,`camp-production-${width}`,width);await auditPictures(win,'#lifePanel-production',`camp production ${width}`);}
  record('camp workplace picture cards assign real companions and selected food completes through the GameWorker',{jobs:profile().camp!.jobs,cooked:profile().leisure.cooked,food,inventory:profile().leisure.materials[food]});
}

async function runOwnerWindow():Promise<void>{
  let win=await openShop();await inspectVillageToolbar(win);await shopTransactions(win);
  await checkToolbarAndManual(win,'supply');
  await inspectRendererBoundary(win,'supply shop popup before route change');
  win=await openAlchemy();await click(win,'alRecipes');await until(()=>js<boolean>(win,'!document.getElementById("roomWorkspace").hidden'),'enter alchemy workspace before village toolbar');
  await checkToolbarAndManual(win,'alchemy');
  await click(win,'roomBack');await until(()=>js<boolean>(win,'!document.getElementById("roomSceneView").hidden&&document.getElementById("roomWorkspace").hidden'),'return to alchemy scene after village manual routing');
  await click(win,'alRecipes');await until(()=>js<boolean>(win,'!document.getElementById("roomWorkspace").hidden'),'return to alchemy workspace after manual routing');
  await alchemyTabsAndTransactions(win,'alchemy');await inspectRendererBoundary(win,'alchemy popup before close');
  await click(win,'popupClose',{minFont:12});await until(()=>shell?.popup===null,'close alchemy popover');
}
async function runFreshWindow():Promise<void>{
  const before=structuredClone(profile());let win=await openShop();
  await click(win,'lsCounter');await until(()=>js<boolean>(win,'!document.getElementById("roomWorkspace").hidden'),'fresh visitor enters shop workspace');
  for(const [id,panel] of [['shopTabSupply','shopPanelSupply'],['shopTabCraft','shopPanelCraft'],['shopTabOrders','shopPanelOrders'],['shopTabManage','shopPanelManage'],['shopTabSpecials','shopPanelSpecials']] as const){
    await tab(win,id,panel);await assertButton(win,id,{picture:true});
  }
  await tab(win,'shopTabCraft','shopPanelCraft');await disabled(win,'craftRation',/应聘/);
  await tab(win,'shopTabSpecials','shopPanelSpecials');await tab(win,'aTab-craft','aPanel-craft');await disabled(win,'aCraft',/任职|应聘|正式/);
  assert.equal(profile().sequence,before.sequence);assert.equal(Object.hasOwn(profile(),'atelier'),false);assert.equal(Object.hasOwn(profile(),'camp'),false);assert.equal(Object.hasOwn(profile(),'village'),false);
  record('fresh visitor can browse every pictured route without lazily initializing optional progress',{sequence:profile().sequence,extensions:{atelier:Object.hasOwn(profile(),'atelier'),camp:Object.hasOwn(profile(),'camp'),village:Object.hasOwn(profile(),'village')}});
  await inspectRendererBoundary(overlay(),'street overlay after visitor routing');await inspectRendererBoundary(win,'visitor shop popup before close');
  await click(win,'popupClose',{minFont:12});await until(()=>shell?.popup===null,'close fresh shop');
}
async function runApprentice():Promise<void>{
  const win=await openShop();await click(win,'lsCounter');await until(()=>js<boolean>(win,'!document.getElementById("roomWorkspace").hidden'),'apprentice enters shop workspace');await tab(win,'shopTabCraft','shopPanelCraft');await disabled(win,'craftRations',/试餐|单份|试餐/);
  const flour=profile().bag.flour;await action(win,'trialCraft',p=>assert.ok(p.queue));
  await advanceWorker((craftTicks('ration',profile().business)+1)*100,'finish apprentice trial meal');assert.equal(profile().bag.ration,1);
  const coins=profile().coins;await action(win,'deliverTrial',p=>{assert.equal(p.job,'keeper');assert.equal(p.coins,coins+30);assert.equal(p.bag.ration,0);});
  assert.equal(profile().bag.flour,flour-2);record('employee completes the true paid trial flow and becomes shopkeeper',{job:profile().job,coins:profile().coins,bag:profile().bag});
  await inspectRendererBoundary(overlay(),'street overlay after apprentice route');await inspectRendererBoundary(win,'apprentice shop popup before close');
  await click(win,'popupClose',{minFont:12});await until(()=>shell?.popup===null,'close apprentice shop');
}

async function main():Promise<void>{
  let fatal:unknown;
  try{
    fs.mkdirSync(evidenceDir,{recursive:true,mode:0o700});fs.mkdirSync(soloFolder,{recursive:true,mode:0o700});
    const now=Date.now();fixture=parseProfile(makeFixture(now));assert.equal(fixture.version,8);
    markIsolatedFolder(profileRoot,app.getPath('appData'));fs.writeFileSync(profileFile,JSON.stringify(fixture)+'\n',{flag:'wx',mode:0o600});
    assert.deepEqual(new GameStore(soloFolder,now).value,fixture,'marked /private/tmp profile round-trips through GameStore before Shell start');
    if(process.platform==='darwin'){app.setActivationPolicy('prohibited');suppression.activationPolicy='prohibited';try{app.dock?.hide();suppression.dockHidden=true;}catch{}}
    replace(app,'focus',()=>{suppression.appFocus++;return false;});replace(Menu,'setApplicationMenu',()=>{});
    app.on('browser-window-created',(_event,win)=>track(win));
    app.on('web-contents-created',(_event:any,contents:any)=>contents.on('console-message',(event:any)=>{if(event.level==='error')errors.push(String(event.message).slice(0,700));}));
    shell=await startDesktop(profileRoot,true);await until(()=>shell?.game.state.status==='ready'&&!!shell.game.state.profile,'isolated GameWorker ready');
    for(const win of BrowserWindow.getAllWindows())track(win);
    assert.deepEqual(profile(),advance(fixture,profile().wallAt),'worker loaded the preflighted private fixture, with only ordinary startup wall-clock advance');
    await until(()=>js<boolean>(overlay(),'document.body.dataset.atlas==="verified"&&!!document.getElementById("dungeonSign")&&document.querySelectorAll("[data-shop]").length===2'),'hidden renderer/street ready');
    assert.equal(overlay().isVisible(),false);assert.equal(overlay().isFocused(),false);
    record('preflighted profile loaded into real Shell and Worker',{scenario,profileRoot,version:profile().version,job:profile().job,sequence:profile().sequence,native:{visible:overlay().isVisible(),focused:overlay().isFocused()}});
    if(scenario==='visitor')await runFreshWindow();
    else if(scenario==='apprentice')await runApprentice();
    else{await runOwnerWindow();if(scenario==='rich'){const win=await openCasual();await campAndBonds(win);await inspectRendererBoundary(win,'companion camp before close');}}
    await inspectRendererBoundary(overlay(),'street overlay before final flush');
    if(shell?.arenaWindow&&!shell.arenaWindow.isDestroyed()){await clickElement(shell.arenaWindow,'cClose');await until(()=>!shell?.arenaWindow,'close hidden camp window');}
    await shell.game.request('flush');assert.deepEqual(new GameStore(soloFolder).value,profile(),'only the isolated preflight profile was written');
    assert.ok(Object.values(keyboardByWindow).every(keys=>keys===0),'no renderer keyboard events');assert.ok(Object.values(cspByWindow).every(events=>events.length===0),'no CSP violations');
    assert.equal(suppression.globalShortcut,0,'no global shortcut calls');assert.equal(suppression.trayCreates,1,'one application Tray constructor was intercepted by the no-op HiddenTray');assert.equal(suppression.dialogCalls,0,'no native dialog');
    for(const win of BrowserWindow.getAllWindows())assert.deepEqual({visible:win.isVisible(),focused:win.isFocused()},{visible:false,focused:false},'all native app windows remain hidden and unfocused');
    assert.equal(Object.keys(productHashesAtStart).length,candidateManifest.files,'complete frozen candidate file count');
    assert.equal(canonicalInventorySha256(productHashesAtStart),candidateManifest.canonicalInventorySha256,'complete frozen candidate canonical SHA');
    assert.deepEqual(productHashesAtStart,candidateManifest.hashes,'complete source/runtime map matches frozen RC4 manifest');
    assert.deepEqual(productHashesAtStart,productHashes(),'source/runtime candidate remained byte-identical while the reviewer exercised it');
    assert.deepEqual(errors,[],'no renderer console errors');status='PASS';record('independent hidden-native picture-interior review completed',{scenario,checks:checks.length,screenshots:screenshots.length,productFiles:Object.keys(productHashesAtStart).length});
  }catch(error){fatal=error;status='FAIL';errors.push(String(error));console.error(error instanceof Error?error.stack:String(error));}
  finally{try{if(shell)await shell.game.request('flush');}catch(error){errors.push('final worker flush: '+String(error));}if(status==='RUNNING')status='FAIL';try{report(fatal);}catch(error){console.error('report write failed',error);}app.quit();}
}

const QUICK_ALCHEMY_MS=61_000;
void main();
