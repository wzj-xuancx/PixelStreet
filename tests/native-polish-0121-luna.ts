import {app,BrowserWindow,type BrowserWindow as BrowserWindowType} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {startDesktop} from '../apps/desktop/bootstrap';
import {GameStore} from '../apps/desktop/game-store';
import {markIsolatedFolder} from '../apps/desktop/launch-profile';
import {APP_NAME,APP_VERSION,PROFILE_NAME} from '../apps/desktop/identity';
import {
  BUDDY_ORDER,FOODS,GOOD_IDS,PATHS,QUOTES,advance,atelierOf,atelierTicks,careView,
  foodTicks,initialAtelier,initialBonds,initialCamp,initialProfile,initialVillage,
  parseProfile,projectView,regularOffer,villageOf,
  type CareActivity,type Good,type PlanStation,type Profile,type ProjectId,type RegularId,type TrainingPath,
} from '../packages/solo-core';

type Check={name:string;status:'PASS'|'FAIL'|'INFO';detail?:unknown};
type Trace={id:number;page:string|null;visible:()=>boolean;focused:()=>boolean;last:{isVisible:boolean;isFocused:boolean}};
type Hit={x:number;y:number;pointSource:string;tag:string;className:string;buttonId:string|null;tooltip:string;image:string;imageKind:string;imageArt:string;scroll:{top:number;max:number}};
type RendererBoundary={keys:number|null;csp:Array<{directive:string;blocked:string;sample:string}>|null};
const EXPECTED_VERSION='0.12.1';
const root=process.cwd();
const runId=new Date().toISOString().replace(/[:.]/g,'-')+'-'+process.pid;
const evidenceDir=path.join(root,'work/polish-0121/native-luna');
const profileRoot=fs.mkdtempSync('/private/tmp/pixelstreet-polish-0121-');
const soloFolder=path.join(profileRoot,'solo');
const profileFile=path.join(soloFolder,'profile.json');
const reportPath=path.join(evidenceDir,`native-polish-0121-${runId}.json`);
const progressPath=path.join(evidenceDir,`progress-${runId}.jsonl`);
const manifestPath=path.resolve(root,process.env.PIXELSTREET_POLISH0121_MANIFEST||'work/polish-0121/candidate-manifest.json');
const productRoots=['package.json','package-lock.json','tsconfig.json','scripts/build.mjs','scripts/generate-art.mjs','apps/desktop','packages/solo-core','packages/protocol','packages/content','assets','dist'] as const;
const productExclusions=['dist/tests/**','dist/native-*.cjs'] as const;
const checks:Check[]=[];
const errors:string[]=[];
const harnessIssues:string[]=[];
const screenshots:string[]=[];
const traces=new Map<number,Trace>();
const keyboardByWindow:Record<number,number|null>={};
const cspByWindow:Record<number,Array<{directive:string;blocked:string;sample:string}>|null>={};
const unknownBoundaryWindows:Record<number,string>={};
const viewportSessions=new Map<number,boolean>();
const suppression=(globalThis as any).__pixelStreetPolish0121Suppression??{};
let shell:Awaited<ReturnType<typeof startDesktop>>|undefined;
let fixture:Profile|undefined;
let candidateManifest:{files?:number;canonicalInventorySha256?:string;hashes?:Record<string,string>;version?:string;metadata?:Record<string,unknown>}|undefined;
let status:'RUNNING'|'PASS'|'FAIL'='RUNNING';

function walk(dir:string):string[]{
  if(!fs.existsSync(dir))return[];
  return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>{const f=path.join(dir,e.name);return e.isDirectory()?walk(f):[path.relative(root,f)];});
}
function codePointCompare(a:string,b:string):number{
  const aa=Array.from(a,c=>c.codePointAt(0)!),bb=Array.from(b,c=>c.codePointAt(0)!);
  for(let i=0;i<Math.min(aa.length,bb.length);i++)if(aa[i]!==bb[i])return aa[i]-bb[i];
  return aa.length-bb.length;
}
function productFiles():string[]{
  const directoryRoots=['apps/desktop','packages/solo-core','packages/protocol','packages/content','assets','dist'] as const;
  const files=[...productRoots.filter(x=>!directoryRoots.includes(x as typeof directoryRoots[number])),
    ...directoryRoots.flatMap(x=>walk(path.join(root,x)))];
  return [...new Set(files)].filter(f=>!/^dist\/(?:tests\/|native-.*\.cjs$)/.test(f)).filter(f=>fs.existsSync(path.join(root,f))).sort(codePointCompare);
}
function hashes(files=productFiles()):Record<string,string>{return Object.fromEntries(files.map(f=>[f,createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex')]));}
function canonicalInventory(map:Record<string,string>):string{
  const text=Object.entries(map).sort(([a],[b])=>codePointCompare(a,b)).map(([file,hash])=>`${hash}  ${file}\n`).join('');
  return createHash('sha256').update(text,'utf8').digest('hex');
}
const productHashesAtStart=hashes();
const inventoryAtStart=canonicalInventory(productHashesAtStart);
function record(name:string,detail?:unknown,statusValue:'PASS'|'FAIL'|'INFO'='PASS'):void{
  const item={name,status:statusValue,detail};checks.push(item);
  try{fs.mkdirSync(evidenceDir,{recursive:true,mode:0o700});fs.appendFileSync(progressPath,JSON.stringify({at:new Date().toISOString(),...item})+'\n',{mode:0o600});}catch(error){harnessIssues.push('progress log: '+String(error));}
}
function saveBoundarySample(id:number,state:RendererBoundary|null|undefined):void{
  if(typeof state?.keys==='number')keyboardByWindow[id]=state.keys;
  if(Array.isArray(state?.csp))cspByWindow[id]=state.csp;
  if(keyboardByWindow[id]===null||cspByWindow[id]===null)unknownBoundaryWindows[id]='renderer acceptance counters have not yet been observed';
  else delete unknownBoundaryWindows[id];
}
function page(win:BrowserWindowType):string|null{try{return new URL(win.webContents.getURL()).searchParams.get('page');}catch{return null;}}
function snapshots():Array<Record<string,unknown>>{
  return [...traces.values()].map(t=>{try{const win=BrowserWindow.fromId(t.id);t.last={isVisible:t.visible(),isFocused:t.focused()};return{id:t.id,page:t.page,...t.last,destroyed:!win||win.isDestroyed(),url:win&&!win.isDestroyed()?win.webContents.getURL()||null:null,loading:win&&!win.isDestroyed()?win.webContents.isLoadingMainFrame():null};}catch(error){return{id:t.id,page:t.page,...t.last,destroyed:true,url:null,loading:null,error:String(error)};}});
}
function track(win:BrowserWindowType):void{
  if(traces.has(win.id))return;
  const visible=win.isVisible.bind(win),focused=win.isFocused.bind(win);
  traces.set(win.id,{id:win.id,page:page(win),visible,focused,last:{isVisible:visible(),isFocused:focused()}});
  keyboardByWindow[win.id]=null;cspByWindow[win.id]=null;
  const instrument=()=>{if(win.isDestroyed())return;void win.webContents.executeJavaScript('(()=>{if(window.__polish0121Boundary)return true;window.__polish0121Boundary=true;window.__polish0121Keys=0;window.__polish0121Csp=[];for(const t of ["keydown","keyup","keypress"])document.addEventListener(t,()=>window.__polish0121Keys++,true);document.addEventListener("securitypolicyviolation",e=>window.__polish0121Csp.push({directive:e.violatedDirective,blocked:e.blockedURI,sample:e.sample||""}),true);return true})()').catch(error=>{if(!win.isDestroyed())harnessIssues.push('renderer boundary '+win.id+': '+String(error));});};
  win.webContents.on('console-message',(event:any)=>{if(event.level==='error')errors.push(JSON.stringify({window:win.id,page:page(win),message:String(event.message).slice(0,900),sourceId:event.sourceId,lineNumber:event.lineNumber}));});
  win.webContents.on('did-finish-load',()=>{const row=traces.get(win.id);if(row)row.page=page(win);instrument();});
  if(!win.webContents.isLoadingMainFrame())instrument();
}
function profile():Profile{const p=shell?.game.state.profile;assert.ok(p,'isolated GameWorker profile unavailable: '+(shell?.game.state.error||'loading'));return p;}
function profileWithoutClock(p:Profile):Profile{const copy=structuredClone(p) as any;delete copy.tick;delete copy.wallAt;delete copy.carryMs;return copy as Profile;}
function overlay():BrowserWindowType{const w=shell?.overlay;assert.ok(w&&!w.isDestroyed(),'street overlay unavailable');return w;}
function arena():BrowserWindowType{const w=shell?.arenaWindow;assert.ok(w&&!w.isDestroyed(),'camp window unavailable');return w;}
function popup():BrowserWindowType{const w=shell?.popupWindow;assert.ok(w&&!w.isDestroyed(),'shop/alchemy popup unavailable');return w;}
async function until(fn:()=>Promise<boolean>|boolean,label:string,timeout=25_000):Promise<void>{
  const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,35));}throw Error('timeout: '+label);
}
async function js<T=unknown>(win:BrowserWindowType,source:string):Promise<T>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([win.webContents.executeJavaScript(source) as Promise<T>,new Promise<T>((_,reject)=>{timer=setTimeout(()=>reject(Error('renderer evaluation timeout '+win.id)),15_000);})]);}
  catch(error){throw Error('renderer evaluation failed in '+win.id+': '+String(error)+'; source='+source.slice(0,500));}
  finally{if(timer)clearTimeout(timer);}
}
function buttonSelector(id:string):string{return '#'+id;}
function villageSelector(ref:string):string{return '#villageUi [data-v-ref='+JSON.stringify(ref)+']';}
async function control(win:BrowserWindowType,selector:string):Promise<any>{
  return js(win,'(()=>{const e=document.querySelector('+JSON.stringify(selector)+'),s=e&&getComputedStyle(e),r=e?.getBoundingClientRect(),art=e?.querySelector(".inner-art,.v-sprite,.b-rarity-art,.b-buddy-art,.b-path-emblem,.ls-person,.ls-item-art"),as=art&&getComputedStyle(art),ps=e&&getComputedStyle(e,"::before"),hidden=!e||!!e.hidden||!!e.closest("[hidden]")||!!e.closest("details:not([open])")||s?.display==="none"||s?.visibility==="hidden";return{exists:!!e,hidden,disabled:!e||!!e.disabled,label:e?.getAttribute("aria-label")||e?.textContent?.trim()||"",tip:e?.dataset.tooltip||e?.title||"",title:e?.getAttribute("title")||"",font:s?parseFloat(s.fontSize):0,cursor:s?.cursor||"",gameButton:!!e?.classList.contains("game-button"),pi:!!e?.hasAttribute("data-pi-control"),piKind:e?.dataset.piKind||"",piArt:e?.dataset.piArt||"",selected:e?.getAttribute("aria-selected")==="true"||e?.getAttribute("aria-pressed")==="true",rect:r?{x:r.x,y:r.y,width:r.width,height:r.height}:null,art:art?{className:art.className,background:as?.backgroundImage||"none",rect:{x:art.getBoundingClientRect().x,y:art.getBoundingClientRect().y,width:art.getBoundingClientRect().width,height:art.getBoundingClientRect().height}}:null,pseudo:{content:ps?.content||"",background:ps?.backgroundImage||"none",width:parseFloat(ps?.width||"0"),height:parseFloat(ps?.height||"0")}}})()');
}
function imageUrl(background:string):string|undefined{const m=background.match(/url\(["']?([^"')]+)["']?\)/);return m?.[1];}
async function coordinateClick(win:BrowserWindowType,selector:string,label:string,requireImage=true):Promise<Hit>{
  const scrolled=await js<boolean>(win,'(()=>{const e=document.querySelector('+JSON.stringify(selector)+'),s=e&&getComputedStyle(e);if(!e||e.hidden||e.disabled||!!e.closest("[hidden]")||!!e.closest("details:not([open])")||s?.display==="none")return false;e.scrollIntoView({block:"nearest",inline:"nearest",behavior:"instant"});return true})()');
  assert.ok(scrolled,label+' is missing, hidden, disabled, or inside a closed disclosure');await new Promise(r=>setTimeout(r,40));
  const cssViewport=await js(win,'({width:innerWidth,height:innerHeight})');
  const beforeState=await control(win,selector);assert.ok(beforeState.exists&&!beforeState.hidden,label+' control unavailable before hit');assert.ok((beforeState.tip||beforeState.label).trim(),label+' needs a readable label or tooltip');assert.ok(beforeState.font>=12,label+' text is too small: '+beforeState.font);assert.equal(beforeState.cursor,'pointer',label+' enabled control needs pointer cursor');
  const result=await js<any>(win,'(()=>{const b=document.querySelector('+JSON.stringify(selector)+');if(!b||b.disabled||b.hidden||!!b.closest("[hidden]")||!!b.closest("details:not([open])"))return{ok:false,why:"unavailable"};const boundary=window.__polish0121Boundary?{keys:window.__polish0121Keys||0,csp:window.__polish0121Csp||[]}:null;const br=b.getBoundingClientRect(),style=getComputedStyle(b),art=b.querySelector(".inner-art,.v-sprite,.b-rarity-art,.b-buddy-art,.b-path-emblem,.ls-person,.ls-item-art"),ar=art?.getBoundingClientRect(),ps=getComputedStyle(b,"::before"),pseudoImage=ps.backgroundImage||"none";let x,y,pointSource="button center",image=art?getComputedStyle(art).backgroundImage:pseudoImage,kind=art?.dataset.kind||art?.dataset.good||art?.dataset.rarity||(art?.dataset.path?"path":"")||b.dataset.piKind||"",artId=art?.dataset.art||art?.dataset.good||art?.dataset.path||art?.dataset.buddy||art?.dataset.rarity||b.dataset.piArt||"";if(art&&ar&&ar.width>0&&ar.height>0){x=ar.left+ar.width/2;y=ar.top+ar.height/2;pointSource="rendered child image center";}else if(pseudoImage!=="none"&&/url\\(/.test(pseudoImage)){const pw=parseFloat(ps.width)||0,ph=parseFloat(ps.height)||0,padTop=parseFloat(style.paddingTop)||0,gap=parseFloat(style.gap)||0;if(style.flexDirection.startsWith("column")){x=br.left+br.width/2;y=br.top+parseFloat(style.borderTopWidth||"0")+padTop+ph/2;pointSource="rendered ::before image center";}else{const range=document.createRange();range.selectNodeContents(b);const tr=range.getBoundingClientRect();x=tr.width>0?tr.left-gap-pw/2:br.left+parseFloat(style.paddingLeft||"0")+pw/2;y=br.top+br.height/2;pointSource="rendered ::before image center";}}else{x=br.left+br.width/2;y=br.top+br.height/2;}const hit=document.elementFromPoint(x,y),button=b.closest("button"),within=!!button&&hit?.closest("button")==button;const scrollRoot=b.closest(".popover-content,#cContent")||document.scrollingElement||document.documentElement,scroll={top:scrollRoot.scrollTop||0,max:Math.max(0,scrollRoot.scrollHeight-scrollRoot.clientHeight)};const imageBackground=image||"none",isImage=!!imageBackground&&imageBackground!=="none"&&/url\\(/.test(imageBackground);if(!button||!within||x<0||y<0||x>innerWidth||y>innerHeight)return{ok:false,x,y,pointSource,tag:hit?.tagName||"",image:imageBackground,isImage,buttonId:button?.id||null,scroll,boundary};if(b instanceof HTMLButtonElement&&b.disabled)return{ok:false,why:"disabled",x,y,pointSource};if('+String(requireImage)+'&&!isImage)return{ok:false,why:"missing rendered picture",x,y,pointSource,image:imageBackground};hit.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,cancelable:true,view:window,clientX:x,clientY:y,pointerType:"mouse",button:0}));hit.dispatchEvent(new PointerEvent("pointerup",{bubbles:true,cancelable:true,view:window,clientX:x,clientY:y,pointerType:"mouse",button:0}));hit.dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true,view:window,clientX:x,clientY:y,button:0}));return{ok:true,x,y,pointSource,tag:hit.tagName,className:typeof hit.className==="string"?hit.className:"",image:imageBackground,imageKind:kind,imageArt:artId,buttonId:button.id||null,tooltip:button.dataset.tooltip||button.title||button.getAttribute("aria-label")||"",scroll,boundary};})()');
  saveBoundarySample(win.id,result.boundary);
  assert.ok(result.ok,label+' image-coordinate hit failed: '+JSON.stringify(result));
  const image=result.image as string;let assetPath='';
  if(requireImage){assert.ok(image&&image!=='none',label+' rendered art background is missing');const src=imageUrl(image);assert.ok(src,label+' rendered art is not a CSS image URL: '+image);const asset=new URL(src!);assert.equal(asset.protocol,'file:',label+' image must be the local app asset');assetPath=fileURLToPath(asset);assert.ok(fs.statSync(assetPath).size>1000,label+' local art asset is unexpectedly small');}
  const state=beforeState;
  const hit:Hit={x:result.x,y:result.y,pointSource:result.pointSource,tag:result.tag,className:result.className||'',buttonId:result.buttonId,tooltip:result.tooltip||state.tip,image,imageKind:result.imageKind||state.piKind,imageArt:result.imageArt||state.piArt,scroll:result.scroll};
  record(requireImage?'software pointer hit on the rendered image coordinate · '+label:'software pointer hit on a visible control · '+label,{...hit,asset:assetPath?path.relative(root,assetPath):undefined,assetBytes:assetPath?fs.statSync(assetPath).size:undefined,cssViewport,evidence:'coordinate PointerEvent and MouseEvent in hidden Electron renderer; software-only'});
  return hit;
}
async function clickButton(win:BrowserWindowType,id:string,label=id,requireImage=true):Promise<Hit>{return coordinateClick(win,buttonSelector(id),label,requireImage);}
async function clickVillage(win:BrowserWindowType,ref:string,label=ref,requireImage=true):Promise<Hit>{return coordinateClick(win,villageSelector(ref),label,requireImage);}
async function actionButton(win:BrowserWindowType,id:string,label=id):Promise<Profile>{
  const before=structuredClone(profile()),seq=before.sequence;const hit=await clickButton(win,id,label);
  await until(()=>profile().sequence===seq+1,'actual GameWorker receipt for '+label);const after=profile();
  record('renderer image-coordinate action reached the isolated GameWorker · '+label,{sequenceBefore:seq,sequenceAfter:after.sequence,coinsBefore:before.coins,coinsAfter:after.coins,notice:after.notice,hit});return after;
}
async function actionVillage(win:BrowserWindowType,ref:string,action:unknown,label=ref,requireImage=true):Promise<Profile>{
  const before=structuredClone(profile()),seq=before.sequence;const hit=await clickVillage(win,ref,label,requireImage);
  await until(()=>profile().sequence===seq+1,'actual GameWorker receipt for village '+label);
  const after=profile();record('village action reached the isolated GameWorker · '+label,{sequenceBefore:seq,sequenceAfter:after.sequence,notice:after.notice,hit,action});return after;
}
async function localButton(win:BrowserWindowType,id:string,selected:()=>Promise<boolean>,label=id,requireImage=true):Promise<void>{
  const seq=profile().sequence,hit=await clickButton(win,id,label,requireImage);await until(selected,'local selection after '+label);
  assert.equal(profile().sequence,seq,label+' must remain a renderer-only selection');record('renderer-only picture navigation · '+label,{sequence:seq,hit});
}
async function localVillage(win:BrowserWindowType,ref:string,selected:()=>Promise<boolean>,label=ref):Promise<void>{
  const seq=profile().sequence,hit=await clickVillage(win,ref,label);await until(selected,'local village selection after '+label);
  assert.equal(profile().sequence,seq,label+' must remain a renderer-only selection');record('renderer-only village picture navigation · '+label,{sequence:seq,hit});
}
async function visible(win:BrowserWindowType,selector:string):Promise<boolean>{return js(win,'(()=>{const e=document.querySelector('+JSON.stringify(selector)+');return!!e&&!e.hidden&&!e.closest("[hidden]")&&!e.closest("details:not([open])")&&getComputedStyle(e).display!=="none"})()');}
async function selectedTab(win:BrowserWindowType,id:string,panel:string):Promise<void>{
  const before=profile().sequence;await clickButton(win,id,'navigation '+id);await until(async()=>await visible(win,'#'+panel)&&await js<boolean>(win,'document.getElementById('+JSON.stringify(id)+')?.getAttribute("aria-selected")==="true"'),id+' panel selected');
  assert.equal(profile().sequence,before,'tab navigation changed profile');record('inner navigation selected the requested panel',{id,panel,sequence:before});
}
async function setViewport(win:BrowserWindowType,width:760|1040,height=650):Promise<void>{
  const d=win.webContents.debugger,attached=d.isAttached();if(!attached){d.attach('1.3');viewportSessions.set(win.id,false);}
  await d.sendCommand('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
  await until(()=>js<boolean>(win,'innerWidth==='+width+'&&innerHeight==='+height),'CSS viewport '+width+'x'+height);
  const metrics=await js<any>(win,'({width:innerWidth,height:innerHeight,pageWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth,content:document.querySelector(".popover-content,#cContent")?(()=>{const e=document.querySelector(".popover-content,#cContent");return{width:e.clientWidth,scrollWidth:e.scrollWidth,height:e.clientHeight,scrollHeight:e.scrollHeight,top:e.scrollTop}})():null})');
  assert.ok(metrics.pageWidth<=width+1,'horizontal page overflow '+JSON.stringify(metrics));
  record('hidden native renderer CSS layout at '+width+'x'+height,{...metrics,outerWindowSize:win.getSize(),method:'CDP viewport; hidden Electron app window'});
}
async function clearViewport(win:BrowserWindowType):Promise<void>{
  const d=win.webContents.debugger,wasAttached=viewportSessions.get(win.id);if(!d.isAttached())return;
  try{await d.sendCommand('Emulation.clearDeviceMetricsOverride');}finally{if(wasAttached===false&&d.isAttached())d.detach();viewportSessions.delete(win.id);}
}
async function capture(win:BrowserWindowType,label:string):Promise<void>{
  await new Promise(r=>setTimeout(r,100));assert.equal(win.isVisible(),false,'capture target became visible');assert.equal(win.isFocused(),false,'capture target became focused');
  const img=await win.webContents.capturePage(),size=img.getSize(),bytes=img.toPNG(),file=path.join(evidenceDir,`screen-${runId}-${label}.png`);
  assert.ok(size.width>0&&size.height>0&&bytes.length>7000,label+' hidden native screenshot is empty');fs.writeFileSync(file,bytes,{flag:'wx',mode:0o600});screenshots.push(file);
  record('hidden native application screenshot '+label,{file,size,bytes:bytes.length,native:{visible:false,focused:false},evidence:'real Electron renderer capturePage; no browser preview'});
}
async function viewAtBothWidths(win:BrowserWindowType,label:string):Promise<void>{
  await setViewport(win,760);await capture(win,label+'-760x650');
  await setViewport(win,1040);await capture(win,label+'-1040x650');
}
async function clickSceneAt(win:BrowserWindowType,x:number,y:number,label:string):Promise<any>{
  return js<any>(win,'(()=>{const boundary=window.__polish0121Boundary?{keys:window.__polish0121Keys||0,csp:window.__polish0121Csp||[]}:null,x='+x+',y='+y+',h=document.elementFromPoint(x,y);if(!h)return{ok:false,x,y,boundary};for(const type of ["pointerdown","pointerup"])h.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,view:window,clientX:x,clientY:y,pointerType:"mouse",button:0}));h.dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true,view:window,clientX:x,clientY:y,button:0}));return{ok:true,x,y,tag:h.tagName,className:typeof h.className==="string"?h.className:"",id:h.id||null,boundary}})()').then(hit=>{saveBoundarySample(win.id,hit.boundary);assert.ok(hit.ok,label+' scene-coordinate hit failed '+JSON.stringify(hit));record('software scene image-coordinate hit · '+label,{...hit,evidence:'coordinate PointerEvent and MouseEvent in hidden Electron renderer; software-only'});return hit;});
}
async function clickCampSceneButton(win:BrowserWindowType,selector:string,label:string):Promise<any>{
  assert.equal(await js<boolean>(win,'(()=>{const e=document.querySelector('+JSON.stringify(selector)+');if(!e||e.hidden||e.disabled||!!e.closest("[hidden]"))return false;e.scrollIntoView({block:"nearest",inline:"nearest",behavior:"instant"});return true})()'),true,label+' missing or unavailable');
  const hit=await js<any>(win,'(()=>{const b=document.querySelector('+JSON.stringify(selector)+'),scene=document.querySelector("#csStage .cs-landscape");if(!b||!scene)return{ok:false,why:"scene target or background missing"};const bg=getComputedStyle(scene).backgroundImage,r=b.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,h=document.elementFromPoint(x,y),button=b.closest("button");return{ok:!!button&&h?.closest("button")==button&&x>=0&&y>=0&&x<=innerWidth&&y<=innerHeight,x,y,background:bg,tag:h?.tagName||"",buttonId:button?.id||null,scroll:{top:document.querySelector("#cContent")?.scrollTop||0}}})()');
  assert.ok(hit.ok,label+' scene picture coordinate did not land on its visible button: '+JSON.stringify(hit));const src=imageUrl(hit.background);assert.ok(src,label+' camp scene background is not a rendered image');const asset=new URL(src!);assert.equal(asset.protocol,'file:');const file=fileURLToPath(asset);assert.ok(fs.statSync(file).size>1000,label+' scene backdrop asset unexpectedly small');
  const boundary=await js<RendererBoundary|null>(win,'(()=>{const boundary=window.__polish0121Boundary?{keys:window.__polish0121Keys||0,csp:window.__polish0121Csp||[]}:null,b=document.querySelector('+JSON.stringify(selector)+'),r=b.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,h=document.elementFromPoint(x,y);for(const type of ["pointerdown","pointerup"])h.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,view:window,clientX:x,clientY:y,pointerType:"mouse",button:0}));h.dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true,view:window,clientX:x,clientY:y,button:0}));return boundary})()');saveBoundarySample(win.id,boundary);
  record('software coordinate hit over rendered camp-scene artwork · '+label,{...hit,backgroundAsset:path.relative(root,file),backgroundBytes:fs.statSync(file).size,evidence:'coordinate within scene art button overlay; PointerEvent and MouseEvent in hidden Electron renderer; software-only'});return hit;
}
async function probeCooldown(win:BrowserWindowType,ref:string,label:string,expected:RegExp):Promise<void>{
  const selector=villageSelector(ref),before=structuredClone(profile()),state=await control(win,selector);assert.ok(state.exists&&!state.hidden,label+' cooldown action missing');assert.equal(state.disabled,false,label+' cooldown should remain clickable');const cooldown=await js<any>(win,'(()=>{const e=document.querySelector('+JSON.stringify(selector)+');return{cooldown:e?.dataset.cooldown||"false",tip:e?.dataset.tooltip||"",cursor:getComputedStyle(e).cursor}})()');assert.equal(cooldown.cooldown,'true',label+' cooldown marker');assert.match(cooldown.tip,expected,label+' cooldown reason');assert.equal(cooldown.cursor,'pointer',label+' cooldown cursor');
  const hit=await coordinateClick(win,selector,label+' clickable cooldown no-op probe');await new Promise(r=>setTimeout(r,400));assert.deepEqual(profileWithoutClock(profile()),profileWithoutClock(before),label+' cooldown click must not change the profile or sequence apart from normal time');const after=await control(win,selector);assert.equal(after.disabled,false,label+' cooldown remains clickable after the no-op');
  const feedback=await js<{toast:string;toastVisible:boolean;notice:string;alert:string;documentHidden:boolean;visibilityState:string}>(win,'(()=>{const t=document.querySelector(".ps-action-notice"),a=document.querySelector("#cNotice,[role=alert]");return{toast:t?.querySelector(".ps-action-notice-text")?.textContent||"",toastVisible:!!t&&!t.hidden,notice:document.getElementById("cNotice")?.textContent?.trim()||"",alert:a?.textContent?.trim()||"",documentHidden:document.hidden,visibilityState:document.visibilityState}})()');
  assert.equal(feedback.toastVisible,true,label+' must show the actual settled result in the picture notice');assert.match(feedback.toast,expected,label+' player-facing feedback should explain the cooldown');assert.match(feedback.notice,expected,label+' camp status should explain the cooldown');assert.doesNotMatch(feedback.toast,/Error invoking remote method|\bError:/,label+' toast must not expose technical Electron errors');assert.doesNotMatch(feedback.notice,/Error invoking remote method|\bError:/,label+' camp status must not expose technical Electron errors');
  record('cooldown remains visibly clickable, produces clean player-facing feedback and is a safe no-op',{label,cooldown,sequence:before.sequence,profileUnchanged:true,normalClockAdvanceIgnored:true,feedback,hit});
}
async function openStore(shop:'shop-bakery'|'shop-alchemy'):Promise<BrowserWindowType>{
  const street=overlay();await until(()=>Reflect.get(shell!,'overlayCold')===false&&js<boolean>(street,'document.body.dataset.view!==undefined&&!!document.querySelector('+JSON.stringify('[data-shop="'+shop+'"]')+')'),'street scene ready for '+shop);
  const prior=Reflect.get(shell!,'activeShop');if(Reflect.get(shell!,'view')!=='interior'||prior!==shop){await coordinateClick(street,'[data-shop="'+shop+'"]','street '+shop+' shop sign',false);await until(()=>Reflect.get(shell!,'view')==='interior'&&Reflect.get(shell!,'activeShop')===shop,'enter '+shop);}
  const world=await js<{x:number;y:number;scale:number}>(street,'({x:Number(document.body.dataset.worldX),y:Number(document.body.dataset.worldY),scale:Number(document.body.dataset.worldScale)})');
  assert.ok(Number.isFinite(world.x+world.y+world.scale)&&world.scale>0,'street world transform is valid');
  const localX=shop==='shop-bakery'?244:484;await clickSceneAt(street,world.x+localX*world.scale,world.y-20*world.scale,'shop keeper '+shop);
  await until(()=>!!shell?.popupWindow&&!shell.popupWindow.isDestroyed()&&Reflect.get(shell,'popup')?.kind===(shop==='shop-bakery'?'shop':'alchemy'),'native popup opened for '+shop);
  const win=popup();await until(()=>js<boolean>(win,'document.body.dataset.popupReady==="true"'),'popup renderer ready '+shop);track(win);
  assert.equal(win.isVisible(),false);assert.equal(win.isFocused(),false);record('actual shop popup is loaded in the hidden native app',{shop,page:page(win),bounds:win.getBounds(),native:{visible:false,focused:false},world});return win;
}
async function openCamp():Promise<BrowserWindowType>{
  const street=overlay();await until(()=>js<boolean>(street,'!!document.getElementById("dungeonSign")'),'street dungeon door ready');
  await coordinateClick(street,'#dungeonSign','street dungeon door',false);await until(()=>!!shell?.arenaWindow&&!shell.arenaWindow.isDestroyed(),'hidden native camp window');
  const win=arena();await until(()=>js<boolean>(win,'document.body.dataset.casualReady==="true"&&!!document.getElementById("campScene")'),'camp renderer ready');track(win);
  assert.equal(win.isVisible(),false);assert.equal(win.isFocused(),false);record('actual dungeon camp page loaded in hidden native window',{page:page(win),bounds:win.getBounds()});return win;
}
async function sceneVillage(win:BrowserWindowType,entry:string,view:'projects'|'regulars'|'life'|'plans'):Promise<void>{
  await clickCampSceneButton(win,'#'+entry,'camp scene location '+entry);const panel='#villageUi [data-v-ref="panel-'+view+'"]';
  await until(async()=>await visible(win,'#cPanel-village')&&await visible(win,panel),'camp location opened village '+view);record('camp scene opened the expected village view',{entry,view});
}
async function villageNav(win:BrowserWindowType,view:'projects'|'regulars'|'life'|'plans'):Promise<void>{
  const ref='nav-'+view;await localVillage(win,ref,async()=>await visible(win,'#villageUi [data-v-ref="panel-'+view+'"]')&&await js<boolean>(win,'document.querySelector('+JSON.stringify(villageSelector(ref))+')?.getAttribute("aria-pressed")==="true"'),'village nav '+view);
}
async function testVillage(win:BrowserWindowType):Promise<void>{
  await setViewport(win,1040);await clickCampSceneButton(win,'#csArchive','open a legacy camp workspace');await until(()=>visible(win,'#cPanel-collection'),'legacy workspace open before the village shortcut');
  assert.equal(await visible(win,'#cVillageShortcut'),true,'legacy workspace needs a visible village entry');await clickButton(win,'cVillageShortcut','open the village from the legacy workspace');await until(async()=>await visible(win,'#cPanel-village')&&await visible(win,'#villageUi [data-v-ref="panel-projects"]'),'legacy village shortcut opens projects');
  assert.equal(await visible(win,'#cVillageShortcut'),false,'the legacy shortcut is hidden while already in the village');await capture(win,'village-shortcut-from-legacy-workspace');await coordinateClick(win,'#cCampBack','return to camp scene after legacy shortcut',false);await until(async()=>await visible(win,'#campScene')&&!await visible(win,'#cCampWorkspace'),'camp scene restored from village shortcut');
  await sceneVillage(win,'csLodge','projects');
  await villageNav(win,'projects');await viewAtBothWidths(win,'village-project-overview');
  const beforeBuild=structuredClone(profile()),buildView=projectView(beforeBuild,'teahouse');assert.equal(buildView.stage,0);assert.equal(buildView.reason,'','first tea-house stage should be available in the prepared profile');
  await localVillage(win,'project-teahouse',()=>visible(win,'#villageUi [data-v-ref="project-detail"]'),'select tea-house build');
  await capture(win,'village-before-stage-build');
  const built=await actionVillage(win,'build',{type:'village-build',project:'teahouse',stage:0},'build first tea-house stage');
  assert.equal(built.village?.projects.teahouse,1);assert.equal(built.coins,beforeBuild.coins-buildView.coins);
  for(const [key,n]of Object.entries(buildView.cost))assert.equal((built.leisure.materials as any)[key],(beforeBuild.leisure.materials as any)[key]-n,`exact construction ${key} cost`);
  await capture(win,'village-after-stage-build');record('stage construction exact costs and visible stage advanced',{stage:built.village?.projects.teahouse,coins:built.coins,notice:built.notice});

  await villageNav(win,'regulars');await setViewport(win,760);await capture(win,'village-regulars-760-before-service');await setViewport(win,1040);await capture(win,'village-regulars-before-service');
  await localVillage(win,'regular-miner',()=>js<boolean>(win,'document.querySelector('+JSON.stringify(villageSelector('regular-miner'))+')?.getAttribute("aria-pressed")==="true"'),'select regular miner');
  const beforeServe=structuredClone(profile()),offer=regularOffer(beforeServe,'miner');assert.equal(offer.item,'soup');assert.equal(offer.reason,'','miner offer should be ready');
  const served=await actionVillage(win,'serve',{type:'village-serve',regular:'miner',revision:offer.revision},'serve regular miner');
  assert.equal(served.village?.regulars.miner.served,3);assert.equal(served.coins,beforeServe.coins+offer.coins);assert.equal(served.leisure.materials.soup,beforeServe.leisure.materials.soup-1,'guest tray ingredient is paid once');
  await capture(win,'village-after-regular-service');await probeCooldown(win,'serve','serve the miner while their return cooldown is active',/常客还在旅途中/);
  await actionVillage(win,'gift-0',{type:'village-gift',regular:'miner',tier:0},'claim first miner keepsake');
  assert.equal(profile().village?.regulars.miner.gifts,1);assert.equal(profile().leisure.journal.dust,fixture!.leisure.journal.dust+1);await capture(win,'village-after-keepsake');

  await villageNav(win,'life');await viewAtBothWidths(win,'village-companion-life');
  await localVillage(win,'companion-slime',()=>js<boolean>(win,'document.querySelector('+JSON.stringify(villageSelector('companion-slime'))+')?.getAttribute("aria-pressed")==="true"'),'select life companion slime');
  const careBefore=structuredClone(profile()),care=careView(careBefore,'slime','tea');assert.equal(care.reason,'','slime tea visit should be available');
  await capture(win,'village-before-companion-care');const cared=await actionVillage(win,'care-tea',{type:'village-care',companion:'slime',activity:'tea',visits:care.visits},'share tea with slime');
  assert.equal(cared.village?.life.slime.visits,care.visits+1);assert.equal(cared.leisure.companions.slime,(careBefore.leisure.companions.slime??0)+1);await capture(win,'village-after-companion-care');await probeCooldown(win,'care-tea','share tea with slime while resting',/伙伴正在休息/);

  await villageNav(win,'plans');await viewAtBothWidths(win,'village-finite-plans');
  await localVillage(win,'station-kitchen',()=>js<boolean>(win,'document.querySelector('+JSON.stringify(villageSelector('station-kitchen'))+')?.getAttribute("aria-pressed")==="true"'),'select kitchen plan station');
  await localVillage(win,'item-soup',()=>js<boolean>(win,'document.querySelector('+JSON.stringify(villageSelector('item-soup'))+')?.getAttribute("aria-pressed")==="true"'),'select soup plan item');
  await localVillage(win,'count-10',()=>js<boolean>(win,'document.querySelector('+JSON.stringify(villageSelector('count-10'))+')?.getAttribute("aria-pressed")==="true"'),'select ten meal plan');
  const beforePlan=structuredClone(profile()),q=await actionVillage(win,'plan-start',{type:'village-plan',station:'kitchen',item:'soup',count:10,reserve:0,sell:false},'start finite kitchen plan');
  const active=q.village?.plans.kitchen;assert.ok(active&&active.remaining===10&&active.due>0);const currentBatchIngredients={...FOODS.soup.materials,...(FOODS.soup.flour?{flour:FOODS.soup.flour}:{}),...(FOODS.soup.gel?{gel:FOODS.soup.gel}:{})};
  for(const [key,n]of Object.entries(currentBatchIngredients)){const beforeAmount=['flour','gel','ration','crystal'].includes(key)?(beforePlan.bag as any)[key]:(beforePlan.leisure.materials as any)[key],afterAmount=['flour','gel','ration','crystal'].includes(key)?(q.bag as any)[key]:(q.leisure.materials as any)[key];assert.equal(afterAmount,beforeAmount-n,`plan begins one soup batch; ${key}`);}
  await capture(win,'village-plan-active-before-stop');const refundBefore=structuredClone(profile());const stopSelector=villageSelector('plan-stop');let stopState=await control(win,stopSelector);record('active finite plan renderer stop-control state before scrolling',{stopState,profilePlan:refundBefore.village?.plans.kitchen,viewport:await js(win,'({width:innerWidth,height:innerHeight,scrollTop:document.querySelector("#cContent")?.scrollTop||0})')});
  await until(async()=>{stopState=await control(win,stopSelector);return stopState.exists&&!stopState.hidden&&!stopState.disabled},'active plan stop control is visible and ready after worker receipt');record('active finite plan stop control became ready',{stopState});
  const stopped=await actionVillage(win,'plan-stop',{type:'village-plan-stop',station:'kitchen',id:active.id},'stop finite kitchen plan',false);
  assert.equal(stopped.village?.plans.kitchen,null);for(const [key,n]of Object.entries(currentBatchIngredients)){const beforeAmount=['flour','gel','ration','crystal'].includes(key)?(refundBefore.bag as any)[key]:(refundBefore.leisure.materials as any)[key],afterAmount=['flour','gel','ration','crystal'].includes(key)?(stopped.bag as any)[key]:(stopped.leisure.materials as any)[key];assert.equal(afterAmount,beforeAmount+n,`one unfinished batch refunded; ${key}`);}
  const stopFeedback=()=>js<any>(win,'(()=>{const all=document.querySelectorAll(".ps-action-notice"),t=document.querySelector("#casualUi .ps-action-notice"),n=document.querySelector("#villageUi [data-v-ref=notice]");return{toastCount:all.length,toast:t?.querySelector(".ps-action-notice-text")?.textContent||"",toastVisible:!!t&&!t.hidden&&getComputedStyle(t).display!=="none",result:t?.dataset.result||"",notice:n?.textContent?.trim()||"",documentHidden:document.hidden,visibilityState:document.visibilityState}})()');
  await until(async()=>{const feedback=await stopFeedback();return feedback.toastCount===1&&feedback.toastVisible&&feedback.result==='success'&&feedback.toast.includes('安排已停止');},'finite plan stop acknowledgement remains visible after its row is hidden');
  const stopAcknowledgement=await stopFeedback();assert.equal(stopAcknowledgement.toastCount,1);assert.equal(stopAcknowledgement.toast,'安排已停止，未完成这一份的材料退回，已完成与已售商品保留。');assert.equal(stopAcknowledgement.notice,stopAcknowledgement.toast);assert.doesNotMatch(stopAcknowledgement.toast,/Error invoking remote method|\bError:/);record('finite plan stop received visible success acknowledgement after the running row disappeared',stopAcknowledgement);
  await capture(win,'village-plan-stopped-after-refund');record('finite plan start/stop preserved completed output and refunded only the in-progress recipe',{planId:active.id,remaining:active.remaining,refunded:currentBatchIngredients});
}
async function enterRoomWorkspace(win:BrowserWindowType,entry:string):Promise<void>{
  await coordinateClick(win,'#'+entry,'shop scene location '+entry);await until(async()=>await visible(win,'#roomWorkspace')&&!await visible(win,'#roomSceneView'),'room workspace '+entry);
}
async function testWorkspaceBackNavigation(win:BrowserWindowType,station:'supply'|'alchemy'):Promise<void>{
  await capture(win,station+'-workspace-before-ledger-navigation');await coordinateClick(win,'#lifeOpen','open the shop management ledger');
  await until(async()=>await visible(win,'#lifePanel')&&await js<boolean>(win,'document.getElementById("roomWorkspace")?.dataset.workspaceView==="ledger"'),'ledger view selected');
  const back=await control(win,'#lifeBack');assert.ok(back.exists&&!back.hidden,'lifeBack must be available from the workspace header');
  assert.equal(await visible(win,'.life-switch'),false,'ledger hides its duplicate management toolbar');assert.equal(await visible(win,'#roomBack'),false,'ledger uses the local workspace header for return');
  await capture(win,station+'-workspace-ledger-with-header-back');await coordinateClick(win,'#lifeBack','return from ledger using workspace header',false);
  await until(async()=>await visible(win,'#lifeRegular')&&await js<boolean>(win,'document.getElementById("roomWorkspace")?.dataset.workspaceView==="regular"'),'shop workspace restored from ledger');
  await coordinateClick(win,'#roomVillageProjects','open village from shop management');
  await until(async()=>await visible(win,'#roomVillagePanel')&&await js<boolean>(win,'document.getElementById("roomWorkspace")?.dataset.workspaceView==="village"'),'village view selected inside workspace');
  assert.equal(await visible(win,'.life-switch'),false,'village hides its duplicate management toolbar');assert.equal(await visible(win,'#lifeBack'),true,'village leaves the workspace-header return available');assert.equal(await visible(win,'#roomBack'),false,'village does not show the scene-return control');
  await capture(win,station+'-workspace-village-with-header-back');await coordinateClick(win,'#lifeBack','return from village using workspace header',false);
  await until(async()=>await visible(win,'#lifeRegular')&&await js<boolean>(win,'document.getElementById("roomWorkspace")?.dataset.workspaceView==="regular"'),'shop workspace restored from village');
  record('shop ledger and village routes use the local workspace-header return control',{lifeBackParent:await js<string>(win,'document.getElementById("lifeBack")?.parentElement?.className||""'),workspaceView:await js<string>(win,'document.getElementById("roomWorkspace")?.dataset.workspaceView||""')});
}
async function testWorkshop(win:BrowserWindowType,station:'supply'|'alchemy'):Promise<void>{
  await enterRoomWorkspace(win,station==='supply'?'lsCounter':'alSupplies');
  await testWorkspaceBackNavigation(win,station);
  const shopTabs=station==='supply'?[['shopTabSupply','shopPanelSupply'],['shopTabCraft','shopPanelCraft'],['shopTabOrders','shopPanelOrders'],['shopTabManage','shopPanelManage'],['shopTabSpecials','shopPanelSpecials']] as const:[['aTab-craft','aPanel-craft'],['aTab-sales','aPanel-sales'],['aTab-study','aPanel-study']] as const;
  await setViewport(win,760);for(const[id,panel]of shopTabs)await selectedTab(win,id,panel);await capture(win,station+'-inner-navigation-760');
  await setViewport(win,1040);for(const[id,panel]of shopTabs)await selectedTab(win,id,panel);await capture(win,station+'-inner-navigation-1040');
  if(station==='supply')await selectedTab(win,'shopTabSpecials','shopPanelSpecials');
  await selectedTab(win,'aTab-craft','aPanel-craft');await viewAtBothWidths(win,station+'-workbench-craft');
  const good:Good=station==='supply'?'stew':'dew';assert.ok(GOOD_IDS.includes(good));
  await localButton(win,'aPick-'+good,()=>js<boolean>(win,'document.getElementById('+JSON.stringify('aPick-'+good)+')?.getAttribute("aria-pressed")==="true"'),'select '+good+' workbench recipe');
  await localButton(win,'aQty1',()=>js<boolean>(win,'document.getElementById("aQty1")?.getAttribute("aria-pressed")==="true"'),station+' select one production unit',false);
  const ticks=atelierTicks(atelierOf(profile()),good,profile()),madeBefore=atelierOf(profile()).made[good],stockBeforeCraft=atelierOf(profile()).stock[good],seqBefore=profile().sequence;
  await capture(win,station+'-workbench-before-craft');await actionButton(win,'aCraft',station+' craft '+good);assert.equal(atelierOf(profile()).queues[station][0]?.good,good);
  await capture(win,station+'-workbench-craft-queued');await advanceWorker((ticks+2)*100,station+' finish one '+good);
  await until(()=>atelierOf(profile()).made[good]===madeBefore+1,'real workshop craft completes '+good);
  assert.equal(atelierOf(profile()).stock[good],stockBeforeCraft+1,'one finished item enters product stock');
  await capture(win,station+'-workbench-after-craft');
  if(station==='supply')await selectedTab(win,'shopTabSpecials','shopPanelSpecials');await selectedTab(win,'aTab-sales','aPanel-sales');
  const stockBeforeListing=atelierOf(profile()).stock[good],shelfBefore=atelierOf(profile()).shelves[good].stock;
  await capture(win,station+'-workbench-before-price-and-sell');await actionButton(win,'aStockAll',station+' stock crafted '+good);
  assert.equal(atelierOf(profile()).stock[good],stockBeforeListing-1,'one crafted product moved to the shelf');assert.equal(atelierOf(profile()).shelves[good].stock,shelfBefore+1,'crafted product was put on the real specialty shelf');
  const quoteBefore=atelierOf(profile()).shelves[good].quote;await capture(win,station+'-price-before');
  await actionButton(win,'aPrice-quick',station+' set quick price '+good);assert.equal(atelierOf(profile()).shelves[good].quote,'quick');await capture(win,station+'-price-after');
  const tillBefore=atelierOf(profile()).till,soldStock=atelierOf(profile()).shelves[good].stock;
  await capture(win,station+'-sell-before');await actionButton(win,'aOpen',station+' open '+station+' sales');
  await until(()=>atelierOf(profile()).open[station],'real workshop open state '+station);
  await advanceWorker((QUOTES.quick.ticks+2)*100,station+' sell one '+good+' at the quick quote');
  await until(()=>atelierOf(profile()).shelves[good].stock<soldStock&&atelierOf(profile()).till>tillBefore,'real shelf sale '+good);
  assert.equal(atelierOf(profile()).shelves[good].quote,'quick');await capture(win,station+'-sell-after');
  record('workbench craft, price and sale reached the actual isolated GameWorker',{station,good,sequenceBefore:seqBefore,sequenceAfter:profile().sequence,recipeTicks:ticks,made:atelierOf(profile()).made[good],stockBefore:stockBeforeCraft,stockAfter:atelierOf(profile()).stock[good],shelfBefore,shelfAfter:atelierOf(profile()).shelves[good].stock,quoteBefore,quoteAfter:atelierOf(profile()).shelves[good].quote,tillBefore,tillAfter:atelierOf(profile()).till,elapsed:'GameWorker advance request; not elapsed wall-clock time'});
}
async function backToRoomScene(win:BrowserWindowType):Promise<void>{await coordinateClick(win,'#roomBack','return to shop room scene',false);await until(async()=>await visible(win,'#roomSceneView')&&!await visible(win,'#roomWorkspace'),'room scene restored');}
async function closePopup(win:BrowserWindowType):Promise<void>{await coordinateClick(win,'#popupClose','close shop/alchemy popup',false);await until(()=>!shell?.popupWindow||shell.popupWindow.isDestroyed(),'popup closed');}
async function testBonds(win:BrowserWindowType):Promise<void>{
  await coordinateClick(win,'#cCampBack','return from village workspace to camp scene',false);await until(async()=>await visible(win,'#campScene')&&!await visible(win,'#cCampWorkspace'),'camp scene restored after village plans');
  await setViewport(win,1040);await clickCampSceneButton(win,'#csTent','enter companion tent');await until(()=>visible(win,'#cPanel-friends'),'companion panel opened');
  await selectedTab(win,'cTab-friends','cPanel-friends');await clickButton(win,'cBuddyView-training','open companion route view');await until(()=>visible(win,'#cBuddyViewPanel-training'),'training routes visible');
  await viewAtBothWidths(win,'bonds-routes');await localButton(win,'cBuddyPick-deer',()=>js<boolean>(win,'document.getElementById("cBuddyPortrait")?.dataset.buddy==="deer"'),'select deer for route');
  const pathBefore=profile().leisure.bonds!.progress.deer.path;await capture(win,'bonds-before-route-selection');
  await actionButton(win,'cBuddyPath-scout','choose deer scout route');assert.equal(profile().leisure.bonds!.progress.deer.path,'scout');await capture(win,'bonds-after-route-selection');
  record('companion training route is visible and persisted by GameWorker',{buddy:'deer',pathBefore,pathAfter:profile().leisure.bonds!.progress.deer.path});

  await selectedTab(win,'cTab-collection','cPanel-collection');await coordinateClick(win,'#cArchiveNew','open new rarity collection',false);await until(()=>visible(win,'#cArchiveRarities'),'new rarity collection visible');
  await setViewport(win,760);await capture(win,'rarity-access-760-before-equip');await setViewport(win,1040);await capture(win,'rarity-access-1040-before-equip');await setViewport(win,760);
  await localButton(win,'cCharmPick0',()=>js<boolean>(win,'document.getElementById("cCharmPick0")?.getAttribute("aria-pressed")==="true"'),'select owned rarity relic');
  await capture(win,'rarity-before-equip');const loadoutBefore=profile().leisure.bonds!.loadout.slice();
  await actionButton(win,'cCharmEquip','equip first rarity relic');assert.ok(profile().leisure.bonds!.loadout.includes(0));await capture(win,'rarity-after-equip');
  const rankBefore=profile().leisure.bonds!.relics[0],tokenBefore=profile().leisure.bonds!.tokens,dustBefore=profile().leisure.journal.dust,oreBefore=profile().leisure.materials.ore;
  await capture(win,'rarity-before-repair');await actionButton(win,'cCharmUpgrade','repair first rarity relic');assert.equal(profile().leisure.bonds!.relics[0],rankBefore+1);
  assert.equal(profile().leisure.bonds!.tokens,tokenBefore-8);assert.equal(profile().leisure.journal.dust,dustBefore-6);assert.equal(profile().leisure.materials.ore,oreBefore-20);
  await capture(win,'rarity-after-repair');record('rarity equip and repair used the selected image and persisted exact costs',{loadoutBefore,loadoutAfter:profile().leisure.bonds!.loadout,rankBefore,rankAfter:profile().leisure.bonds!.relics[0],tokensBefore:tokenBefore,tokensAfter:profile().leisure.bonds!.tokens,dustBefore,dustAfter:profile().leisure.journal.dust,oreBefore,oreAfter:profile().leisure.materials.ore});
}
async function advanceWorker(ms:number,label:string):Promise<Profile>{
  const before=profile(),result=await shell!.game.request('advance',{ms});assert.ok(result.profile,'GameWorker accepted virtual-time request');
  record('GameWorker virtual clock · '+label,{ms,tickBefore:before.tick,tickAfter:result.profile!.tick,sequenceBefore:before.sequence,sequenceAfter:result.profile!.sequence,boundary:'testMode request; not elapsed wall-clock time'});return result.profile!;
}
function makeFixture(now:number):Profile{
  const p=initialProfile(now);p.tick=1000;p.wallAt=now;p.job='keeper';p.coins=800_000;p.xp=20_000;p.totals.earned=p.coins;p.totals.crafted=200;
  p.leisure.rooms=40;p.leisure.harvests=40;p.leisure.cooked=100;p.leisure.clears=[5,5,5,5,5];
  p.leisure.materials={...p.leisure.materials,ore:500,herb:500,berry:500,mushroom:500,tea:500,biscuit:500,soup:500,pumpkin:500,snowflower:500,pie:500,snowtea:500};
  p.bag.flour=500;p.bag.gel=80;p.bag.ration=100;p.bag.crystal=100;
  p.business.managed=true;p.atelier=initialAtelier();p.atelier.facilities={kitchen:3,still:3,counter:3};p.camp=initialCamp();
  for(const id of BUDDY_ORDER)p.leisure.companions[id]=10;
  p.leisure.active='slime';p.leisure.journal.dust=50;p.leisure.bonds=initialBonds();p.leisure.bonds.tokens=120;
  p.leisure.bonds.relics[0]=1;p.leisure.bonds.progress.deer.path=null;
  p.village=initialVillage();p.village.regulars.miner.served=2;
  return parseProfile(p);
}
function assertFixture(actual:Profile,expected:Profile):void{assert.deepEqual(actual,advance(expected,actual.wallAt),'GameWorker loaded the exact generated fixture with only normal startup advance');}
async function auditFinalBoundary():Promise<void>{
  for(const w of BrowserWindow.getAllWindows())track(w);
  const rows=snapshots();for(const row of rows){assert.equal(row.isVisible,false,'native window became visible '+JSON.stringify(row));assert.equal(row.isFocused,false,'native window became focused '+JSON.stringify(row));}
  for(const [id,trace]of traces){try{const w=BrowserWindow.fromId(id);if(!w||w.isDestroyed()){if(keyboardByWindow[id]===null||cspByWindow[id]===null)unknownBoundaryWindows[id]='native window was destroyed before renderer counters could be sampled';continue;}const url=w.webContents.getURL();if(!url||url==='about:blank'){keyboardByWindow[id]=null;cspByWindow[id]=null;unknownBoundaryWindows[id]='hidden BrowserWindow has no loaded app document; renderer keyboard/CSP counters cannot be queried';continue;}const state=await js<any>(w,'({keys:window.__polish0121Boundary?window.__polish0121Keys:null,csp:window.__polish0121Boundary?window.__polish0121Csp:null})');if(typeof state.keys==='number')keyboardByWindow[id]=state.keys;if(Array.isArray(state.csp))cspByWindow[id]=state.csp;if(keyboardByWindow[id]===null||cspByWindow[id]===null)unknownBoundaryWindows[id]='loaded renderer did not expose the acceptance boundary counters';else delete unknownBoundaryWindows[id];}catch(error){if(keyboardByWindow[id]===null||cspByWindow[id]===null){unknownBoundaryWindows[id]='boundary sample unavailable without a prior renderer snapshot: '+String(error);if(!trace.last.isVisible)harnessIssues.push('boundary sample '+id+': '+String(error));}}}
  const knownKeyboard=[...Object.values(keyboardByWindow)].filter((n):n is number=>n!==null),knownCsp=[...Object.values(cspByWindow)].filter((rows):rows is Array<{directive:string;blocked:string;sample:string}>=>rows!==null);
  assert.equal(knownKeyboard.reduce((n,x)=>n+x,0),0,'hidden test observed keyboard input in sampled renderer boundaries');
  assert.equal(knownCsp.reduce((n,x)=>n+x.length,0),0,'sampled renderers had CSP violations');
  assert.equal(suppression.globalShortcut??0,0,'application attempted a global shortcut');
  const unknown=Object.keys(unknownBoundaryWindows).length>0;
  record('native and input boundary',{nativeWindows:rows,keyboardByWindow,cspByWindow,unknownBoundaryWindows,suppression,policy:'focus/show/tray/activation effects were intercepted before native effect; keyboard/CSP counts are null when no app renderer boundary was queryable; no keyboard or physical pointer claim'},unknown||Object.values(suppression).some((x:any)=>typeof x==='number'&&x>0)?'INFO':'PASS');
}
async function verifyProfileBoundary():Promise<void>{
  assert.ok(fixture);const store=new GameStore(soloFolder).value;assert.deepEqual(store,profile(),'only the isolated fixture persisted');
  const marker=path.join(profileRoot,'.pixelstreet-isolated-profile.json');assert.ok(fs.existsSync(marker));assert.match(fs.readFileSync(marker,'utf8'),/isolated-playtest/);
  record('only preflighted private test profile was written',{profileRoot,profileFile,marker,version:profile().version,sequence:profile().sequence});
}
function harnessHashes():Record<string,string>{
  const files=['tests/native-polish-0121-luna.ts','tests/native-polish-0121-luna-bootstrap.cjs','work/polish-0121/native-luna/native-polish-0121-luna.cjs','dist/native-polish-0121-luna.cjs'].filter(f=>fs.existsSync(path.join(root,f)));
  return hashes(files);
}
function report(rawError?:unknown):void{
  fs.mkdirSync(evidenceDir,{recursive:true,mode:0o700});const endHashes=hashes();
  let profileFinal:unknown=null;try{const p=profile();profileFinal={sequence:p.sequence,tick:p.tick,coins:p.coins,projects:p.village?.projects,plans:p.village?.plans,bonds:p.leisure.bonds};}catch{}
  const out={schema:'pixelstreet.polish-0121.luna-max.hidden-native.v1',runId,status,at:new Date().toISOString(),identity:{name:APP_NAME,version:APP_VERSION,profileName:PROFILE_NAME,expectedVersion:EXPECTED_VERSION},platform:process.platform,arch:process.arch,electron:process.versions.electron,profileRoot,profileFile,manifestPath,manifest:candidateManifest?{files:candidateManifest.files,canonicalInventorySha256:candidateManifest.canonicalInventorySha256,version:candidateManifest.version,metadata:candidateManifest.metadata}:null,profilePreflight:fixture?{version:fixture.version,sequence:fixture.sequence,tick:fixture.tick,job:fixture.job,hasVillage:Object.hasOwn(fixture,'village'),hasAtelier:Object.hasOwn(fixture,'atelier'),hasCamp:Object.hasOwn(fixture,'camp')}:null,profileFinal,checks,errors,harnessIssues,screenshots,nativeWindows:snapshots(),keyboardByWindow,cspByWindow,unknownBoundaryWindows,priorRawAttempts:[path.join(evidenceDir,'native-polish-0121-2026-10-23T17-33-41-922Z-88085.json'),path.join(evidenceDir,'native-polish-0121-2026-10-23T17-37-57-595Z-91569.json')],suppression,productRoots,productExclusions,productFileCount:Object.keys(productHashesAtStart).length,canonicalInventorySha256AtStart:inventoryAtStart,canonicalInventorySha256AtEnd:canonicalInventory(endHashes),productHashesAtStart,productHashesAtEnd:status==='RUNNING'?undefined:endHashes,harnessHashes:harnessHashes(),rawError:rawError?String(rawError):undefined,stack:rawError instanceof Error?rawError.stack:undefined,evidenceBoundary:{runtime:'Real Electron desktop process, DesktopShell, preload/IPC, renderer and GameWorker. No browser preview.',window:'macOS activation prohibited; app focus/activation, BrowserWindow show/showInactive/focus/moveTop/restore, webContents.focus, Dock, Tray and globalShortcut intercepted before native effect. Original isVisible/isFocused methods sampled.',input:'Software coordinate PointerEvent and MouseEvent at rendered image or picture-control pixels. No physical pointer, keyboard or IME evidence is claimed.',profile:'Fresh marked /private/tmp profile passed parseProfile and GameStore round-trip before startDesktop. No installed-app data or real progress file was opened.',time:'Only GameWorker testMode advance requests were used; these are not elapsed wall-clock time.',screenshots:'Hidden Electron capturePage at CSS viewports 760x650 and 1040x650.'}};
  fs.writeFileSync(reportPath,JSON.stringify(out,null,2)+'\n',{flag:'wx',mode:0o600});
  fs.appendFileSync(progressPath,JSON.stringify({at:new Date().toISOString(),finalReport:reportPath,status,errors})+'\n',{mode:0o600});
}
async function main():Promise<void>{
  try{
    fs.mkdirSync(evidenceDir,{recursive:true,mode:0o700});assert.equal(APP_VERSION,EXPECTED_VERSION,'only the final 0.12.1 identity can be accepted');assert.equal(APP_NAME,'PixelStreet 0.12.1');assert.equal(PROFILE_NAME,'PixelStreetCamp');
    assert.ok(fs.existsSync(manifestPath),'final 0.12.1 exact-inventory manifest missing at '+manifestPath);candidateManifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
    assert.ok(candidateManifest!.hashes&&candidateManifest!.canonicalInventorySha256,'candidate manifest lacks exact hashes/canonical digest');assert.deepEqual(productHashesAtStart,candidateManifest!.hashes,'tested source/runtime bytes must exactly match the final candidate manifest');assert.equal(inventoryAtStart,candidateManifest!.canonicalInventorySha256,'tested canonical full inventory must match final candidate');if(candidateManifest!.files!==undefined)assert.equal(Object.keys(productHashesAtStart).length,candidateManifest!.files,'full candidate inventory file count mismatch');
    const manifestVersion=candidateManifest!.version||candidateManifest!.metadata?.version;if(manifestVersion!==undefined)assert.equal(manifestVersion,EXPECTED_VERSION,'candidate manifest metadata version');
    record('final 0.12.1 full source/runtime inventory matches the exact candidate manifest',{manifestPath,files:Object.keys(productHashesAtStart).length,canonicalInventorySha256:inventoryAtStart,version:manifestVersion||EXPECTED_VERSION});
    fs.chmodSync(profileRoot,0o700);markIsolatedFolder(profileRoot,app.getPath('appData'));fixture=makeFixture(Date.now());assert.equal(fixture.version,8);fs.mkdirSync(soloFolder,{recursive:true,mode:0o700});fs.writeFileSync(profileFile,JSON.stringify(fixture)+'\n',{flag:'wx',mode:0o600});assert.deepEqual(parseProfile(JSON.parse(fs.readFileSync(profileFile,'utf8'))),fixture);assert.deepEqual(new GameStore(soloFolder).value,fixture,'private marked profile must pass GameStore preflight before Shell launch');
    record('generated /private/tmp fixture parsed and round-tripped before native app startup',{profileRoot,profileFile,marker:path.join(profileRoot,'.pixelstreet-isolated-profile.json'),version:fixture.version,hasVillage:true,hasAtelier:true,hasCamp:true});
    app.on('browser-window-created',(_event,win)=>track(win));app.on('web-contents-created',(_event:any,contents:any)=>contents.on('console-message',(event:any)=>{if(event.level==='error')errors.push(String(event.message).slice(0,900));}));
    shell=await startDesktop(profileRoot,true);await until(()=>shell?.game.state.status==='ready'&&!!shell.game.state.profile,'GameWorker ready on marked profile');for(const w of BrowserWindow.getAllWindows())track(w);assertFixture(profile(),fixture);record('actual native Shell and GameWorker loaded the marked fixture',{sequence:profile().sequence,tick:profile().tick,native:snapshots()});
    await until(()=>js<boolean>(overlay(),'document.body.dataset.atlas==="verified"&&!!document.getElementById("dungeonSign")'),'hidden street renderer ready');

    let shop=await openStore('shop-bakery');await testWorkshop(shop,'supply');await clearViewport(shop);await backToRoomScene(shop);await closePopup(shop);
    shop=await openStore('shop-alchemy');await testWorkshop(shop,'alchemy');await clearViewport(shop);await backToRoomScene(shop);await closePopup(shop);

    const camp=await openCamp();await testVillage(camp);await testBonds(camp);await clearViewport(camp);
    if(!camp.isDestroyed())await coordinateClick(camp,'#cClose','close hidden camp window',false);
    await until(()=>!shell?.arenaWindow||shell.arenaWindow.isDestroyed(),'camp window closes');
    await shell.game.request('flush');await verifyProfileBoundary();await auditFinalBoundary();
    assert.deepEqual(errors,[],'renderer console errors');const endHashes=hashes();assert.deepEqual(endHashes,productHashesAtStart,'no product file changed during hidden acceptance');assert.deepEqual(endHashes,candidateManifest!.hashes,'final bytes still equal the frozen candidate');assert.equal(canonicalInventory(endHashes),candidateManifest!.canonicalInventorySha256);
    status='PASS';record('independent 0.12.1 hidden-native visual-operation acceptance completed with unchanged frozen product hashes',{checks:checks.length,screenshots:screenshots.length,files:Object.keys(endHashes).length,canonicalInventorySha256:inventoryAtStart,profileRoot});
  }catch(error){status='FAIL';errors.push(String(error));checks.push({name:'raw final-candidate acceptance failure',status:'FAIL',detail:{error:String(error),stack:error instanceof Error?error.stack:undefined}});process.exitCode=1;console.error(error instanceof Error?error.stack:String(error));}
  finally{try{if(shell)await shell.game.request('flush');}catch(error){harnessIssues.push('final flush: '+String(error));}try{report(status==='FAIL'?new Error(errors.at(-1)||'acceptance failed'):undefined);}catch(error){console.error('report write failed: '+String(error));}app.exit(status==='FAIL'?1:0);}
}
void main();
