import {app,BrowserWindow,type BrowserWindow as BrowserWindowType} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {startDesktop} from '../apps/desktop/bootstrap';
import {GameStore} from '../apps/desktop/game-store';
import {markIsolatedFolder} from '../apps/desktop/launch-profile';
import {APP_NAME,APP_VERSION,PROFILE_NAME} from '../apps/desktop/identity';
import {initialProfile,parseProfile,towerFloors,type GameAction,type Profile} from '../packages/solo-core';
import {channels,heightPresets,parseCommand,towerTargets,type TowerTarget} from '../packages/protocol';
import {pixelScale,snapDIP} from '../packages/protocol/geometry';
import * as ts from 'typescript';

type CheckStatus='PASS'|'FAIL'|'INFO';
type Check={name:string;status:CheckStatus;detail?:unknown};
type Manifest={files?:number;canonicalInventorySha256?:string;hashes?:Record<string,string>;productHashScopes?:string[];product?:Record<string,unknown>};
type Trace={id:number;page:string|null;visible:()=>boolean;focused:()=>boolean;last:{visible:boolean;focused:boolean}};
const EXPECTED_VERSION='0.13.0';
const EXPECTED_INVENTORY='d100a6e53a316a586571b005e74d330cbd68ebb96b1c4c7774661dad3455a0e2';
const EXPECTED_FILES=423;
const root=process.cwd();
const prefix='PIXELSTREET_TOWER0130_';
const fixtureMode=process.env[prefix+'FIXTURE']||'';
const runId=new Date().toISOString().replace(/[:.]/g,'-')+'-'+process.pid;
const evidenceDir=path.join(root,'work/tower-0130/native-shell-luna');
const profileRoot=fs.mkdtempSync('/private/tmp/pixelstreet-tower-0130-luna-');
const soloFolder=path.join(profileRoot,'solo');
const profileFile=path.join(soloFolder,'profile.json');
const manifestPath=path.resolve(root,process.env[prefix+'MANIFEST']||'');
const reportPath=path.join(evidenceDir,`native-tower-shell-0130-${runId}.json`);
const progressPath=path.join(evidenceDir,`progress-${runId}.jsonl`);
const checks:Check[]=[];
const errors:string[]=[];
const harnessIssues:string[]=[];
const screenshots:string[]=[];
const traces=new Map<number,Trace>();
const keyEvents:Record<number,number|null>={};
const cspEvents:Record<number,Array<{directive:string;blocked:string;sample:string}>|null>={};
const viewportSessions=new Map<number,boolean>();
const sourceDigests=new Set<string>();
const suppression=(globalThis as any).__pixelStreetTower0130Suppression??{};
let shell:Awaited<ReturnType<typeof startDesktop>>|undefined;
let fixture:Profile|undefined;
let candidateManifest:Manifest|undefined;
let productScopes:string[]=[];
let productHashesAtStart:Record<string,string>={};
let inventoryAtStart='';
let readOnlyProfileBaseline='';
let status:'RUNNING'|'PASS'|'FAIL'='RUNNING';

function codePointCompare(a:string,b:string):number{
  const aa=Array.from(a,c=>c.codePointAt(0)!),bb=Array.from(b,c=>c.codePointAt(0)!);
  for(let i=0;i<Math.min(aa.length,bb.length);i++)if(aa[i]!==bb[i])return aa[i]-bb[i];
  return aa.length-bb.length;
}
function excluded(file:string):boolean{return file.startsWith('dist/tests/')||/^dist\/native-.*\.cjs$/.test(file);}
function walkScope(scope:string,out:Set<string>):void{
  const absolute=path.join(root,scope);assert.ok(fs.existsSync(absolute),'manifest scope missing: '+scope);
  const stat=fs.lstatSync(absolute);assert.ok(!stat.isSymbolicLink(),'symlink in product scope: '+scope);
  if(stat.isFile()){if(!excluded(scope))out.add(scope);return;}
  assert.ok(stat.isDirectory(),'unsupported product scope object: '+scope);
  const visit=(dir:string,relative:string)=>{
    for(const entry of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>codePointCompare(a.name,b.name))){
      const absoluteEntry=path.join(dir,entry.name),relativeEntry=path.posix.join(relative,entry.name);
      assert.ok(!entry.isSymbolicLink(),'symlink in product inventory: '+relativeEntry);
      if(entry.isDirectory())visit(absoluteEntry,relativeEntry);
      else if(entry.isFile()){if(!excluded(relativeEntry))out.add(relativeEntry);}
      else throw Error('unsupported product inventory entry: '+relativeEntry);
    }
  };
  visit(absolute,scope);
}
function productHashes():Record<string,string>{
  const files=new Set<string>();for(const scope of productScopes)walkScope(scope,files);
  return Object.fromEntries([...files].sort(codePointCompare).map(file=>[file,createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')]));
}
function canonicalInventory(hashes:Record<string,string>):string{
  const text=Object.entries(hashes).sort(([a],[b])=>codePointCompare(a,b)).map(([file,hash])=>`${hash}  ${file}\n`).join('');
  return createHash('sha256').update(text,'utf8').digest('hex');
}
function record(name:string,detail?:unknown,statusValue:CheckStatus='PASS'):void{
  const item={name,status:statusValue,detail};checks.push(item);
  try{fs.mkdirSync(evidenceDir,{recursive:true,mode:0o700});fs.appendFileSync(progressPath,JSON.stringify({at:new Date().toISOString(),...item})+'\n',{mode:0o600});}
  catch(error){harnessIssues.push('progress log: '+String(error));}
}
function check(name:string,condition:unknown,detail?:unknown):void{
  const ok=!!condition;record(name,detail,ok?'PASS':'FAIL');if(!ok)throw Error(name+': '+JSON.stringify(detail??condition));
}
function page(win:BrowserWindowType):string|null{try{return new URL(win.webContents.getURL()).searchParams.get('page');}catch{return null;}}
function snapshots():Array<Record<string,unknown>>{
  return [...traces.values()].map(t=>{
    try{t.last={visible:t.visible(),focused:t.focused()};const win=BrowserWindow.fromId(t.id);return{id:t.id,page:t.page,...t.last,destroyed:!win||win.isDestroyed(),url:win&&!win.isDestroyed()?win.webContents.getURL()||null:null};}
    catch(error){return{id:t.id,page:t.page,...t.last,destroyed:true,url:null,error:String(error)};}
  });
}
function track(win:BrowserWindowType):void{
  if(traces.has(win.id))return;
  const visible=win.isVisible.bind(win),focused=win.isFocused.bind(win);
  traces.set(win.id,{id:win.id,page:page(win),visible,focused,last:{visible:visible(),focused:focused()}});
  keyEvents[win.id]=null;cspEvents[win.id]=null;
  const instrument=()=>{
    if(win.isDestroyed())return;
    void win.webContents.executeJavaScript('(()=>{if(window.__towerShell0130Boundary)return true;window.__towerShell0130Boundary=true;window.__towerShell0130Keys=0;window.__towerShell0130Csp=[];for(const t of ["keydown","keyup","keypress"])document.addEventListener(t,()=>window.__towerShell0130Keys++,true);document.addEventListener("securitypolicyviolation",e=>window.__towerShell0130Csp.push({directive:e.violatedDirective,blocked:e.blockedURI,sample:e.sample||""}),true);return true})()')
      .catch(error=>{if(!win.isDestroyed())harnessIssues.push('renderer boundary '+win.id+': '+String(error));});
  };
  win.webContents.on('console-message',(event:any)=>{if(event.level==='error')errors.push(JSON.stringify({window:win.id,page:page(win),message:String(event.message).slice(0,900),sourceId:event.sourceId,lineNumber:event.lineNumber}));});
  win.webContents.on('did-finish-load',()=>{const row=traces.get(win.id);if(row)row.page=page(win);instrument();});
  if(!win.webContents.isLoadingMainFrame())instrument();
}
function profile():Profile{const p=shell?.game.state.profile;assert.ok(p,'isolated GameWorker profile unavailable: '+(shell?.game.state.error||'loading'));return p;}
function overlay():BrowserWindowType{const win=shell?.overlay;assert.ok(win&&!win.isDestroyed(),'hidden street renderer unavailable');return win;}
function tower():BrowserWindowType{const win=shell?.towerWindow;assert.ok(win&&!win.isDestroyed(),'hidden tower renderer unavailable');return win;}
async function until(fn:()=>Promise<boolean>|boolean,label:string,timeout=25_000):Promise<void>{
  const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await new Promise(resolve=>setTimeout(resolve,35));}throw Error('timeout: '+label);
}
async function js<T=unknown>(win:BrowserWindowType,source:string):Promise<T>{
  new vm.Script(source,{filename:'tower-0130-renderer-inline.js'});sourceDigests.add(createHash('sha256').update(source).digest('hex'));
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([win.webContents.executeJavaScript(source) as Promise<T>,new Promise<T>((_,reject)=>{timer=setTimeout(()=>reject(Error('renderer evaluation timeout '+win.id)),15_000);})]);}
  catch(error){throw Error('renderer evaluation failed in '+win.id+': '+String(error)+'; source='+source.slice(0,450));}
  finally{if(timer)clearTimeout(timer);}
}
async function visible(win:BrowserWindowType,selector:string):Promise<boolean>{
  return js(win,'(()=>{const e=document.querySelector('+JSON.stringify(selector)+');if(!e)return false;for(let n=e;n&&n instanceof HTMLElement;n=n.parentElement){const s=getComputedStyle(n);if(n.hidden||s.display==="none"||s.visibility==="hidden"||s.opacity==="0")return false;}return true})()');
}
async function setViewport(win:BrowserWindowType,width:number,height:number):Promise<number>{
  const dpr=await js<number>(win,'devicePixelRatio');
  const debuggerSession=win.webContents.debugger,wasAttached=debuggerSession.isAttached();
  if(!wasAttached){debuggerSession.attach('1.3');viewportSessions.set(win.id,false);}else if(!viewportSessions.has(win.id))viewportSessions.set(win.id,true);
  await debuggerSession.sendCommand('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:dpr,mobile:false});
  await until(()=>js<boolean>(win,`innerWidth===${width}&&innerHeight===${height}`),'CSS viewport '+width+'x'+height);
  // Chromium can update innerWidth before Pixi's resize listener receives the
  // change. Force that software resize path and wait for the scene's own layout
  // snapshot to reflect this viewport before measuring DOM hit rectangles.
  const scale=pixelScale(dpr,Math.max(.5,Math.min(2,(height-4)/96))).dip;
  const camera=await js<number>(win,'Number(document.body.dataset.cameraX||0)');
  const expectedWorldX=snapDIP(Math.max(8,(width-940*scale)/2)-camera*scale,dpr);
  await js(win,'window.dispatchEvent(new Event("resize"))');
  await until(()=>js<boolean>(win,`Math.abs(Number(document.body.dataset.worldScale)-${scale})<1e-9&&Math.abs(Number(document.body.dataset.worldX)-${expectedWorldX})<1e-9`),'scene layout recomputed for CSS viewport '+width+'x'+height);
  return dpr;
}
async function clearViewport(win:BrowserWindowType):Promise<void>{
  const d=win.webContents.debugger;if(!d.isAttached())return;const owned=viewportSessions.get(win.id);
  try{await d.sendCommand('Emulation.clearDeviceMetricsOverride');}finally{if(owned===false&&d.isAttached())d.detach();viewportSessions.delete(win.id);}
}
async function capture(win:BrowserWindowType,label:string):Promise<void>{
  try{
    const image=await win.webContents.capturePage();const file=path.join(evidenceDir,`screen-${runId}-${label.replace(/[^a-z0-9-]+/gi,'-').slice(0,90)}.png`);
    fs.writeFileSync(file,image.toPNG(),{flag:'wx',mode:0o600});screenshots.push(file);
    record('hidden Electron capturePage evidence',{file,windowId:win.id,page:page(win),nativeVisible:win.isVisible(),nativeFocused:win.isFocused(),method:'Electron webContents.capturePage; software-only hidden renderer capture, not a physical display screenshot.'});
  }catch(error){harnessIssues.push('capture '+label+': '+String(error));}
}
function commandError(name:string,error:unknown):boolean{return String(error).toLowerCase().includes(name.toLowerCase());}
async function invoke(win:BrowserWindowType,command:unknown):Promise<{ok:boolean;value?:unknown;error?:string}>{
  return js(win,`(()=>window.street.command(${JSON.stringify(command)}).then(value=>({ok:true,value}),error=>({ok:false,error:String(error)})))()`);
}
async function closeTowerThroughRenderer(win:BrowserWindowType,label:string):Promise<void>{
  const windowId=win.id;
  // tower-close destroys its own sender before Electron can deliver invoke()'s
  // reply. Schedule the real UI button click after this evaluation returns and
  // assert the native Shell singleton closes; do not await a dead renderer.
  const scheduled=await js<any>(win,'(()=>{const e=document.getElementById("towerClose");if(!e)return{scheduled:false,reason:"missing close button"};if(e.disabled)return{scheduled:false,reason:"close button disabled"};setTimeout(()=>e.click(),50);return{scheduled:true,id:e.id,tag:e.tagName}})()');
  check(label+' schedules the actual towerClose UI control',scheduled.scheduled===true,scheduled);
  await until(()=>shell!.towerWindow===null||win.isDestroyed(),label+' native tower close completion');
  check(label+' actual towerClose UI control closes its singleton',shell!.towerWindow===null,{windowId,destroyed:win.isDestroyed(),currentTowerId:shell!.towerWindow?.id??null});
  record('tower closed through its actual renderer close button without awaiting a response from the destroyed sender',{label,windowId,closed:shell!.towerWindow===null,method:'Synthetic DOM click on #towerClose; verified main-process singleton teardown, no IPC reply awaited after sender destruction.'});
}
async function stateFrom(win:BrowserWindowType):Promise<any>{return js(win,'window.street.state()');}
function assertNoTowerExtension(p:Profile,label:string):void{
  assert.equal(Object.hasOwn(p,'tower'),false,label+' must leave the optional tower extension uninitialized');
}
function stableProfile(p:Profile):Profile{
  const stable=structuredClone(p);stable.tick=0;stable.wallAt=0;stable.carryMs=0;return stable;
}
async function assertAllHidden(label:string):Promise<void>{
  const rows=snapshots(),live=rows.filter(row=>!row.destroyed);const failures=live.filter(row=>row.visible||row.focused);
  check(label,failures.length===0,{liveWindows:live,failures,suppression:{...suppression}});
}

async function preflightManifest():Promise<void>{
  assert.equal(process.env[prefix+'GO'],'RC4','root RC4 manifest GO is required before native launch');
  assert.equal(fixtureMode,'fresh','only the private fresh profile fixture is accepted');
  assert.equal(APP_VERSION,EXPECTED_VERSION);assert.equal(APP_NAME,'PixelStreet 0.13.0');assert.equal(PROFILE_NAME,'PixelStreetCamp');
  assert.ok(manifestPath&&fs.existsSync(manifestPath),'root final-manifest GO must provide PIXELSTREET_TOWER0130_MANIFEST');
  candidateManifest=JSON.parse(fs.readFileSync(manifestPath,'utf8')) as Manifest;
  assert.ok(candidateManifest.hashes&&candidateManifest.canonicalInventorySha256&&Array.isArray(candidateManifest.productHashScopes),'manifest must include exact product hashes and scopes');
  productScopes=candidateManifest.productHashScopes!;productHashesAtStart=productHashes();inventoryAtStart=canonicalInventory(productHashesAtStart);
  assert.deepEqual(productHashesAtStart,candidateManifest.hashes,'product bytes must equal the frozen RC4 manifest');
  assert.equal(Object.keys(productHashesAtStart).length,EXPECTED_FILES,'frozen RC4 product file count');
  assert.equal(candidateManifest.files,EXPECTED_FILES,'manifest file count');
  assert.equal(inventoryAtStart,EXPECTED_INVENTORY,'parent-issued RC4 canonical digest');
  assert.equal(candidateManifest.canonicalInventorySha256,EXPECTED_INVENTORY,'manifest canonical digest');
  assert.equal(candidateManifest.product?.version,EXPECTED_VERSION,'manifest version');
  assert.equal(candidateManifest.product?.productName,APP_NAME,'manifest product name');
  assert.equal(candidateManifest.product?.profileName,PROFILE_NAME,'stable profile directory');
  record('exact RC4 product inventory bound before native startup',{manifestPath,files:Object.keys(productHashesAtStart).length,canonicalInventorySha256:inventoryAtStart,productScopes,exclusions:['dist/tests/**','dist/native-*.cjs']});
}
async function preflightFixture():Promise<void>{
  fs.chmodSync(profileRoot,0o700);markIsolatedFolder(profileRoot,app.getPath('appData'));
  fixture=initialProfile(Date.now());assert.equal(fixture.version,8);assertNoTowerExtension(fixture,'fresh fixture');
  fs.mkdirSync(soloFolder,{recursive:true,mode:0o700});fs.writeFileSync(profileFile,JSON.stringify(fixture)+'\n',{flag:'wx',mode:0o600});
  assert.deepEqual(parseProfile(JSON.parse(fs.readFileSync(profileFile,'utf8'))),fixture,'isolated profile parses before launch');
  assert.deepEqual(new GameStore(soloFolder).value,fixture,'GameStore round trip before launch');
  record('private fresh schema8 profile is marked and round-tripped before launch',{profileRoot,profileFile,version:fixture.version,sequence:fixture.sequence,hasTower:Object.hasOwn(fixture,'tower'),marker:path.join(profileRoot,'.pixelstreet-isolated-profile.json')});
}
async function testStreetEntranceMatrix():Promise<void>{
  const win=overlay();await until(()=>js<boolean>(win,'document.body.dataset.atlas==="verified"&&!!document.getElementById("towerEntrance")'),'verified local street renderer and tower entrance');
  for(const h of heightPresets){
    const settings={...shell!.store.value,height:h};shell!.store.save(settings);shell!.settingsChanged();
    await until(()=>win.getBounds().height===h,'native street bounds height '+h);
    assert.equal(win.isVisible(),false,'overlay must remain natively hidden during height matrix');
    for(const width of [1024,1280,1440]){
      const dpr=await setViewport(win,width,h);
      await until(()=>js<boolean>(win,'!!document.getElementById("towerEntrance")&&!!document.body.dataset.worldScale'),'tower entrance layout at '+width+'x'+h);
      const observed=await js<any>(win,`(()=>{const e=document.getElementById('towerEntrance'),img=e.querySelector('img'),label=e.querySelector('span'),r=e.getBoundingClientRect(),ir=img.getBoundingClientRect(),lr=label.getBoundingClientRect(),toolbar=document.getElementById('primaryBar').getBoundingClientRect(),s=Number(document.body.dataset.worldScale),x=Number(document.body.dataset.worldX),height=${h},width=${width},naturalX=x+(835-40)*s,naturalW=Math.max(44,80*s),compact=height===48||naturalX+naturalW>innerWidth-104||naturalX<0||90*s>innerHeight,expectedW=compact?44:naturalW,expectedH=compact?44:Math.max(44,90*s),expectedX=compact?Math.max(4,Math.min(innerWidth-124,x+367*s-22)):naturalX,expectedY=compact?0:Math.max(0,Number(document.body.dataset.worldY)-expectedH),overlaps=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;return{viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},world:{scale:s,x,y:Number(document.body.dataset.worldY)},heightSetting:Number(e.closest('body')?.dataset.height||${h}),hidden:e.hidden,disabled:e.disabled,compact:e.dataset.compact,rect:{x:r.x,y:r.y,width:r.width,height:r.height,left:r.left,top:r.top,right:r.right,bottom:r.bottom},image:{complete:img.complete,naturalWidth:img.naturalWidth,naturalHeight:img.naturalHeight,rect:{x:ir.x,y:ir.y,width:ir.width,height:ir.height},pointerEvents:getComputedStyle(img).pointerEvents},label:{text:label.textContent,fontSize:parseFloat(getComputedStyle(label).fontSize),rect:{x:lr.x,y:lr.y,width:lr.width,height:lr.height},pointerEvents:getComputedStyle(label).pointerEvents},toolbar:{left:toolbar.left,top:toolbar.top,right:toolbar.right,bottom:toolbar.bottom,width:toolbar.width,height:toolbar.height,overlapsTower:overlaps(r,toolbar)},cursor:getComputedStyle(e).cursor,button:e.tagName,ariaLabel:e.getAttribute('aria-label'),scaleExpected:${JSON.stringify(pixelScale(dpr,Math.max(.5,Math.min(2,(h-4)/96))).dip)},compactExpected:compact,expectedRect:{x:expectedX,y:expectedY,width:expectedW,height:expectedH},elementFromImage:document.elementFromPoint(ir.left+ir.width/2,ir.top+ir.height/2)?.closest('button')?.id||null,elementFromPlaque:document.elementFromPoint(lr.left+lr.width/2,lr.top+lr.height/2)?.closest('button')?.id||null,renderFrames:document.body.dataset.renderFrames,targetFps:document.body.dataset.targetFps}})()`);
      const right=observed.rect.right<=width+1&&observed.rect.x>=-1&&observed.rect.top>=-1&&observed.rect.bottom<=h+1;
      check(`street tower geometry and ratio ${width}x${h}`,observed.viewport.width===width&&observed.viewport.height===h&&Math.abs(observed.world.scale-observed.scaleExpected)<1e-9&&observed.hidden===false&&observed.disabled===false&&observed.button==='BUTTON'&&observed.cursor==='pointer'&&observed.image.complete&&observed.image.naturalWidth>0&&observed.label.text==='成就之塔'&&right&&Math.abs(observed.rect.x-observed.expectedRect.x)<1&&Math.abs(observed.rect.y-observed.expectedRect.y)<1&&Math.abs(observed.rect.width-observed.expectedRect.width)<1&&Math.abs(observed.rect.height-observed.expectedRect.height)<1&&observed.elementFromImage==='towerEntrance'&&observed.elementFromPlaque==='towerEntrance',observed);
      const insideActualViewport=observed.rect.left>=0&&observed.rect.top>=0&&observed.rect.right<=observed.viewport.width&&observed.rect.bottom<=observed.viewport.height;
      check(`independent tower hit target bounds and minimum 44px ${width}x${h}`,insideActualViewport&&observed.rect.width>=44&&observed.rect.height>=44,{viewport:observed.viewport,rect:observed.rect,minimum:{width:44,height:44},insideActualViewport});
      check(`independent tower label readability and toolbar clearance ${width}x${h}`,observed.label.fontSize>=16&&!observed.toolbar.overlapsTower,{label:{text:observed.label.text,fontSize:observed.label.fontSize,rect:observed.label.rect},toolbar:observed.toolbar,tower:observed.rect});
      const hover=await js<any>(win,`(()=>{const e=document.getElementById('towerEntrance'),img=e.querySelector('img'),label=e.querySelector('span'),centers=[img,label].map(n=>{const r=n.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}}),rows=[];for(const p of centers){e.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:p.x,clientY:p.y}));rows.push({x:p.x,y:p.y,hover:document.body.dataset.hover,cursor:document.body.dataset.pointerCursor,highlight:e.classList.contains('is-hovered'),hit:document.elementFromPoint(p.x,p.y)?.closest('button')?.id||null});}return{rows}})()`);
      check(`street tower hover and hand cursor on image and plaque ${width}x${h}`,hover.rows.length===2&&hover.rows.every((row:any)=>row.hover==='tower'&&row.cursor==='pointer'&&row.highlight&&row.hit==='towerEntrance'),hover);
      if((width===1024&&h===48)||(width===1280&&h===112)||(width===1440&&h===208))await capture(win,`street-${width}x${h}`);
      await clearViewport(win);
      await until(()=>js<boolean>(win,`innerHeight===${h}`),'native height restored after CSS override '+h);
    }
  }
  assert.deepEqual([...heightPresets],[48,80,112,160,208],'all five existing height presets');
  record('street entrance covered all 15 width/height combinations',{widths:[1024,1280,1440],heights:[...heightPresets],measurements:'actual Electron overlay with CDP CSS viewport; native BrowserWindow DIP height separately equals selected preset',proportion:'world scale compared to pixelScale(devicePixelRatio, max(0.5,min(2,(innerHeight-4)/96))); expected scene placement and compact 44x44 plaque compared against viewport.'});
  await shell!.store.save({...shell!.store.value,height:48});shell!.settingsChanged();await until(()=>win.getBounds().height===48,'restore compact street for measured real-coordinate click tests');
  const dpr=await setViewport(win,1024,48);void dpr;
  const coordinates=await js<any>(win,'(()=>{const e=document.getElementById("towerEntrance"),img=e.querySelector("img"),label=e.querySelector("span"),center=n=>{const r=n.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2,button:document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.closest("button")?.id||null}},r=e.getBoundingClientRect();return{rect:{x:r.x,y:r.y,w:r.width,h:r.height},image:center(img),plaque:center(label),view:document.body.dataset.view}})()');
  check('48px compact tower offers measured building and plaque click centers',coordinates.view==='street'&&coordinates.rect.w>=44&&coordinates.rect.h>=44&&coordinates.image.button==='towerEntrance'&&coordinates.plaque.button==='towerEntrance',coordinates);
  const imageClick=await js<any>(win,'(()=>{const e=document.getElementById("towerEntrance"),img=e.querySelector("img"),r=img.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;e.dispatchEvent(new MouseEvent("mousemove",{bubbles:true,clientX:x,clientY:y}));e.dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true,clientX:x,clientY:y,button:0,buttons:1}));return{client:{x,y},hit:document.elementFromPoint(x,y)?.closest("button")?.id,hover:document.body.dataset.hover}})()');
  check('actual image-center MouseEvent reaches the tower-open handler',imageClick.hit==='towerEntrance'&&imageClick.hover==='tower',imageClick);
  await until(()=>!!shell!.towerWindow&&!shell!.towerWindow.isDestroyed(),'48px image-center click opens a hidden native tower');
  const imageTowerId=shell!.towerWindow!.id;await until(()=>js<boolean>(tower(),'document.body.dataset.towerReady==="true"'),'tower ready after compact building click');
  const plaqueClick=await js<any>(win,'(()=>{const e=document.getElementById("towerEntrance"),n=e.querySelector("span"),r=n.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;e.dispatchEvent(new MouseEvent("mousemove",{bubbles:true,clientX:x,clientY:y}));e.dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true,clientX:x,clientY:y,button:0,buttons:1}));return{client:{x,y},hit:document.elementFromPoint(x,y)?.closest("button")?.id,hover:document.body.dataset.hover}})()');
  check('actual plaque-center MouseEvent uses the same tower entry',plaqueClick.hit==='towerEntrance'&&plaqueClick.hover==='tower',plaqueClick);
  await until(()=>shell!.towerWindow?.id===imageTowerId,'plaque click reuses the existing tower singleton');
  check('compact building and plaque actual-coordinate clicks use one hidden singleton',!shell!.towerWindow!.isVisible()&&!shell!.towerWindow!.isFocused(),{id:imageTowerId,visible:shell!.towerWindow!.isVisible(),focused:shell!.towerWindow!.isFocused(),imageClick,plaqueClick});
  await closeTowerThroughRenderer(tower(),'compact entrance click test');
  await clearViewport(win);await until(()=>win.getBounds().height===48&&js<boolean>(win,'innerHeight===48'),'native compact height restored after coordinate clicks');
}
async function testFieldAndInteractionGuards():Promise<void>{
  const win=overlay(),originalView=shell!.view,originalSettings={...shell!.store.value};
  try{
    shell!.view='field';shell!.position();(shell! as any).broadcast();
    await until(()=>js<boolean>(win,'document.body.dataset.view==="field"'),'field view broadcast');
    const field=await js<any>(win,'(()=>{const e=document.getElementById("towerEntrance");return{hidden:e.hidden,display:getComputedStyle(e).display,rect:(()=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height}})()}})()');
    check('field view hides the tower entrance',field.hidden===true&&field.display==='none',field);
  }finally{shell!.view=originalView;shell!.position();(shell! as any).broadcast();}
  await until(()=>js<boolean>(win,'document.body.dataset.view==="street"'),'street view restored');
  shell!.store.save({...originalSettings,interactionEnabled:false});shell!.settingsChanged();
  try{
    await until(()=>js<boolean>(win,'document.getElementById("towerEntrance").disabled'),'interaction-off disabled tower entry');
    const dom=await js<any>(win,'(()=>{const e=document.getElementById("towerEntrance");return{hidden:e.hidden,disabled:e.disabled,cursor:getComputedStyle(e).cursor,aria:e.getAttribute("aria-disabled")}})()');
    check('interaction-off disables the tower entry',dom.disabled===true&&dom.hidden===false,dom);
    const result=await invoke(win,{type:'tower-open'});
    check('interaction-off rejects a forged street tower-open command',!result.ok&&String(result.error).includes('鼠标交互'),result);
    assert.equal(shell!.towerWindow,null,'interaction-off cannot create a tower window');
  }finally{shell!.store.save(originalSettings);shell!.settingsChanged();}
  await until(()=>js<boolean>(win,'document.getElementById("towerEntrance").disabled===false'),'interaction restored');
}
async function testForgedProtocolAndOwnerIsolation():Promise<void>{
  const valid={type:'tower-action',envelope:{sequence:1,requestId:randomUUID(),action:{type:'tower-claim',floor:1}}};
  assert.equal(parseCommand(valid).type,'tower-action','strict protocol accepts a valid claim envelope');
  const rejected:Array<{name:string;value:unknown}>=[];
  for(const [name,value] of [
    ['extra command field',{type:'tower-link',target:'dungeon',profile:{coins:999999}}],
    ['unknown navigation target',{type:'tower-link',target:'delete-profile'}],
    ['unsupported tower action',{type:'tower-action',envelope:{sequence:1,requestId:randomUUID(),action:{type:'apply-job'}}}],
    ['extra tower action field',{type:'tower-action',envelope:{sequence:1,requestId:randomUUID(),action:{type:'tower-claim',floor:1,coins:999999}}}],
    ['extra tower link field',{type:'tower-link',target:'dungeon',coins:999999}],
  ] as const){let threw=false;try{parseCommand(value);}catch{threw=true;}if(!threw)rejected.push({name,value});}
  check('protocol parser rejects malformed or forged tower commands',rejected.length===0,{acceptedMalformed:rejected,validAccepted:true});
  const overlayWin=overlay();
  const before=structuredClone(profile());
  const forbidden:[string,unknown][]=[
    ['tower-link',{type:'tower-link',target:'dungeon'}],
    ['tower-close',{type:'tower-close'}],
    ['tower-minimize',{type:'tower-minimize'}],
    ['tower claim',{type:'tower-action',envelope:{sequence:before.sequence+1,requestId:randomUUID(),action:{type:'tower-claim',floor:1}}}],
    ['generic game claim',{type:'game',generation:1,envelope:{sequence:before.sequence+1,requestId:randomUUID(),action:{type:'tower-claim',floor:1}}}],
  ];
  for(const [label,command]of forbidden){const result=await invoke(overlayWin,command);check(`overlay cannot use tower-owned ${label}`,!result.ok,result);}
  const overlayTowerOpen=await invoke(overlayWin,{type:'tower-open'});
  check('street overlay is the sole native tower-open source',overlayTowerOpen.ok&&!!shell!.towerWindow,{result:overlayTowerOpen,towerWindowId:shell!.towerWindow?.id});
  await until(()=>js<boolean>(tower(),'document.body.dataset.towerReady==="true"'),'tower page ready after actual street entrance');
  const towerWin=tower();track(towerWin);
  await until(()=>js<boolean>(towerWin,'window.__towerShell0130Boundary===true'),'tower renderer input boundary instrumented');
  const towerState=await stateFrom(towerWin);assert.equal(towerState.tower?.suspended,false);assertNoTowerExtension(towerState.game.profile,'tower initial read');
  record('real overlay IPC opened the singleton tower window',{id:towerWin.id,page:page(towerWin),visible:towerWin.isVisible(),focused:towerWin.isFocused(),state:towerState.tower});

  const popupAnchor={x:10,y:4,width:29,height:29};shell!.openPopup('shop',popupAnchor);
  const popupWin=shell!.popupWindow;assert.ok(popupWin&&!popupWin.isDestroyed());track(popupWin);
  await until(()=>js<boolean>(popupWin,'!!window.street&&!!document.getElementById("roomSceneView")'),'real shop popup renderer loaded');
  for(const [label,command]of forbidden.slice(0,3)){const result=await invoke(popupWin,command);check(`shop popup cannot use tower-owned ${label}`,!result.ok,result);}
  const popupTowerOpen=await invoke(popupWin,{type:'tower-open'});check('shop popup cannot spoof the street-only open source',!popupTowerOpen.ok,popupTowerOpen);
  const inventoryBefore=structuredClone(profile());shell!.closePopup(false,true);shell!.openInventory();
  const inventoryWin=shell!.inventoryWindow;assert.ok(inventoryWin&&!inventoryWin.isDestroyed());track(inventoryWin);
  await until(()=>js<boolean>(inventoryWin,'!!window.street&&document.body.dataset.inventoryReady==="true"'),'real inventory renderer loaded');
  const inventoryTower=await invoke(inventoryWin,{type:'tower-link',target:'dungeon'});check('inventory cannot navigate through tower authority',!inventoryTower.ok,inventoryTower);
  const inventoryAction=await invoke(inventoryWin,valid);check('inventory cannot claim through tower authority',!inventoryAction.ok,inventoryAction);
  assert.deepEqual(profile(),inventoryBefore,'source checks do not alter the real GameWorker profile');shell!.closeInventory(false);
  shell!.openArena(true,true);const arenaWin=shell!.arenaWindow;assert.ok(arenaWin&&!arenaWin.isDestroyed());track(arenaWin);
  await until(()=>js<boolean>(arenaWin,'!!window.street&&!!document.getElementById("cCampHome")'),'real casual arena renderer loaded');
  for(const [label,command]of forbidden.slice(0,3)){const result=await invoke(arenaWin,command);check(`casual window cannot use tower-owned ${label}`,!result.ok,result);}
  const arenaOpen=await invoke(arenaWin,{type:'tower-open'});check('casual window cannot spoof the street-only open source',!arenaOpen.ok,arenaOpen);
  const arenaAction=await invoke(arenaWin,valid);check('casual window cannot claim through tower authority',!arenaAction.ok,arenaAction);
  assert.deepEqual(profile(),before,'no non-tower renderer changed economy or progress');
  shell!.closeArena();
  const p=profile();assert.equal(p.sequence,before.sequence,'source-isolation probes do not advance the GameWorker receipt');assert.equal(p.coins,before.coins);assert.equal(p.xp,before.xp);assertNoTowerExtension(p,'source-isolation probes');
  record('overlay/popup/inventory/casual IPC ownership rejected tower authority outside the tower renderer',{sources:['overlay','popup','inventory','arena'],commands:forbidden.map(([label])=>label),profileSequence:p.sequence,hasTower:Object.hasOwn(p,'tower')});
}
const casualTargets=new Set<TowerTarget>(['dungeon','garden','companions','kitchen','camp-growth','collection','village-projects']);
const routeExpectations:Record<TowerTarget,{page:'shop'|'casual';required:string[];controls:string[];forbidden?:string[]}>={
  supply:{page:'shop',required:['#roomWorkspace','#shopPanelSupply'],controls:['#buyFlour']},
  'supply-job':{page:'shop',required:['#roomWorkspace','#shopPanelSupply','#jobPanel','#jobStory'],controls:['#applyJob']},
  'supply-craft':{page:'shop',required:['#roomWorkspace','#shopPanelCraft'],controls:['#craftRation','#queueRation']},
  'supply-trade':{page:'shop',required:['#roomWorkspace','#shopPanelSupply'],controls:['#buyFlour','#merchantSell-flour']},
  'supply-manage':{page:'shop',required:['#roomWorkspace','#shopPanelManage'],controls:['#stock-ration','#retailToggle']},
  'supply-orders':{page:'shop',required:['#roomWorkspace','#shopPanelOrders'],controls:['#acceptOrder-0']},
  kitchen:{page:'casual',required:['#cCampWorkspace','#cPanel-kitchen'],controls:['#cwFoodPick-tea','#cCook1-tea']},
  'camp-growth':{page:'casual',required:['#cCampWorkspace','#cPanel-camp','#lifeOldCamp','#lifePanel-growth'],controls:['#lifeTab-growth','#cBuild-lodge']},
  collection:{page:'casual',required:['#cCampWorkspace','#cPanel-collection','#cArchivePermanent'],controls:['#cArchiveOld','#cwRelicPick-0']},
  'village-projects':{page:'casual',required:['#cCampWorkspace','#cPanel-village','[data-v-ref="nav-projects"]','[data-v-ref="project-teahouse"]'],controls:['[data-v-ref="nav-projects"]','[data-v-ref="project-teahouse"]']},
  alchemy:{page:'shop',required:['#roomWorkspace','#aPanel-craft'],controls:['#aCraft','#aQty1']},
  'alchemy-craft':{page:'shop',required:['#roomWorkspace','#aPanel-craft'],controls:['#aCraft','#aQty1']},
  'alchemy-trade':{page:'shop',required:['#roomWorkspace','#aPanel-craft','#atelierUi .a-market[open]'],controls:['#aBuy1-herb']},
  dungeon:{page:'casual',required:['#cCampWorkspace','#cPanel-adventure'],controls:['#cZone0','#cStart']},
  garden:{page:'casual',required:['#cCampWorkspace','#cPanel-garden'],controls:['#cSeed-herb','#cPlant0']},
  companions:{page:'casual',required:['#cCampWorkspace','#cPanel-friends'],controls:['#cBuddyView-training']},
  ledger:{page:'shop',required:['#roomWorkspace','#lifePanel'],controls:['#lifeTab-growth']},
};
async function routeSurface(target:TowerTarget):Promise<{win:BrowserWindowType;observed:any}>{
  if(casualTargets.has(target)){const win=shell!.arenaWindow;assert.ok(win&&!win.isDestroyed(),'casual target creates actual arena inner window');await until(()=>js<boolean>(win,'document.body.dataset.towerDestination==='+JSON.stringify(target)),'casual route surface '+target);const observed=await js<any>(win,`(()=>{const visible=e=>!!e&&!e.closest('[hidden]')&&getComputedStyle(e).display!=='none';return{page:'casual',target:document.body.dataset.towerDestination,workspace:visible(document.getElementById('cCampWorkspace')),panels:[...document.querySelectorAll('#cContent>section')].filter(visible).map(e=>e.id),archivePermanent:visible(document.getElementById('cArchivePermanent')),lifeSubtab:document.querySelector('#cPanel-camp [aria-selected="true"]')?.id||null,navId:window.__towerNavId||null}})()`);return{win,observed};}
  const win=shell!.popupWindow;assert.ok(win&&!win.isDestroyed(),'shop target creates actual shop/alchemy inner window');await until(()=>js<boolean>(win,'document.body.dataset.towerDestination==='+JSON.stringify(target)),'shop route surface '+target);const observed=await js<any>(win,`(()=>{const visible=e=>!!e&&!e.closest('[hidden]')&&getComputedStyle(e).display!=='none';return{page:'shop',target:document.body.dataset.towerDestination,workspace:visible(document.getElementById('roomWorkspace')),scene:visible(document.getElementById('roomSceneView')),panels:[...document.querySelectorAll('#roomWorkspace section.shop-panel,#atelierUi section[id^="aPanel-"],#lifePanel')].filter(visible).map(e=>e.id||e.className),lifePanel:visible(document.getElementById('lifePanel')),marketOpen:!!document.querySelector('#atelierUi .a-market[open]'),navId:window.__towerNavId||null}})()`);return{win,observed};
}
const safeRouteClicks:Partial<Record<TowerTarget,{selector:string;postcondition:string;description:string}>>={
  supply:{selector:'#shopTabSupply',postcondition:'!!document.querySelector("#shopPanelSupply:not([hidden])")',description:'select the ordinary supply tab'},
  'supply-job':{selector:'#shopTabSupply',postcondition:'!!document.querySelector("#jobPanel:not([hidden])")',description:'keep application and trial controls in view'},
  'supply-craft':{selector:'#shopTabCraft',postcondition:'!!document.querySelector("#shopPanelCraft:not([hidden]) #queueRation")',description:'keep the ordinary recipe and batch workbench selected without queuing production'},
  'supply-trade':{selector:'#shopTabSupply',postcondition:'!!document.querySelector("#shopPanelSupply:not([hidden]) #buyFlour")',description:'select the existing merchant counter'},
  'supply-manage':{selector:'#shopTabManage',postcondition:'!!document.querySelector("#shopPanelManage:not([hidden]) #retailToggle")',description:'select management without stocking or opening the shop'},
  'supply-orders':{selector:'#shopTabOrders',postcondition:'!!document.querySelector("#shopPanelOrders:not([hidden]) #acceptOrder-0")',description:'select the order desk without accepting an order'},
  kitchen:{selector:'#cwFoodPick-biscuit',postcondition:'document.querySelector("#cwFoodPick-biscuit")?.getAttribute("aria-pressed")==="true"',description:'select a recipe without starting cooking'},
  'camp-growth':{selector:'#lifeTab-growth',postcondition:'!!document.querySelector("#lifeOldCamp:not([hidden]) #cBuild-lodge")',description:'select the repair view without repairing'},
  collection:{selector:'#cArchiveOld',postcondition:'!!document.querySelector("#cArchivePermanent:not([hidden]) #cwRelicPick-0")',description:'open the permanent relic collection'},
  'village-projects':{selector:'[data-v-ref="project-teahouse"]',postcondition:'!!document.querySelector("[data-v-ref=\\"project-detail\\"]:not([hidden]) [data-v-ref=\\"build\\"]")',description:'open the teahouse plan without committing construction'},
  alchemy:{selector:'#aQty1',postcondition:'document.querySelector("#aQty1")?.getAttribute("aria-pressed")==="true"',description:'select one recipe batch without scheduling a craft'},
  'alchemy-craft':{selector:'#aQty1',postcondition:'document.querySelector("#aQty1")?.getAttribute("aria-pressed")==="true"',description:'select one recipe batch without scheduling a craft'},
  'alchemy-trade':{selector:'#aTab-craft',postcondition:'document.querySelector("#atelierUi")?.dataset.tab==="craft"&&document.querySelector("#atelierUi .a-market")?.open===true',description:'select the craft panel while leaving the market open and without buying inventory'},
  dungeon:{selector:'#cZone0',postcondition:'document.querySelector("#cZone0")?.getAttribute("aria-pressed")==="true"',description:'select a destination without starting an expedition'},
  garden:{selector:'#cSeed-herb',postcondition:'document.querySelector("#cSeed-herb")?.getAttribute("aria-pressed")==="true"',description:'select a seed without planting'},
  companions:{selector:'#cBuddyView-training',postcondition:'!!document.querySelector("#cBuddyViewPanel-training:not([hidden]) #cBuddyTrain")',description:'open partner training without training'},
  ledger:{selector:'#lifeTab-growth',postcondition:'!!document.querySelector("#lifePanel-growth:not([hidden])")',description:'select the camp growth page in the ledger'},
};
async function completePrivateIntroThroughShop(win:BrowserWindowType):Promise<void>{
  assert.equal(profile().job,'visitor','private tutorial progression starts from a fresh visitor profile');
  const submit=async(action:GameAction,label:string):Promise<void>=>{
    const current=profile(),result=await shell!.game.command({sequence:current.sequence+1,requestId:randomUUID(),action});
    assert.ok(result.profile,'legal action reached the real private GameWorker');
    const winState=shell!.state();win.webContents.send(channels.update,winState);
    record(label,{sequence:result.profile.sequence,job:result.profile.job,coins:result.profile.coins,bag:result.profile.bag,queue:result.profile.queue,totals:result.profile.totals,refresh:'test explicitly sent the actual ShellState on channels.update to a natively hidden renderer; preflightHidden intentionally suspends popup IPC and no window was resumed or shown.'});
  };
  await submit({type:'apply-job'},'real GameWorker legal apply-job action on the private marked tutorial profile');
  await until(()=>profile().job==='apprentice'&&profile().bag.flour===4,'legal isolated apply-job action and flour gift');
  await until(()=>js<boolean>(win,'(()=>{const e=document.getElementById("trialCraft");return !!e&&!e.hidden&&!e.disabled})()'),'trialCraft becomes an enabled control after the job prerequisite');
  await submit({type:'craft',recipe:'ration',count:1},'real GameWorker legal trial ration craft action on the private marked tutorial profile');
  await until(()=>profile().queue?.recipe==='ration','trial ration queued by the actual shop renderer action');
  const queued=structuredClone(profile());
  const advanced=await shell!.game.request('advance',{ms:7000});assert.ok(advanced.profile,'real GameWorker accepts its testMode virtual clock');
  win.webContents.send(channels.update,shell!.state());
  await until(()=>profile().queue===null&&profile().bag.ration===1&&profile().totals.crafted===1,'GameWorker virtual 7-second trial completion');
  await until(()=>js<boolean>(win,'(()=>{const e=document.getElementById("deliverTrial");return !!e&&!e.hidden&&!e.disabled})()'),'delivery becomes available when the trial craft completes');
  await submit({type:'deliver-trial'},'real GameWorker legal deliver-trial action on the private marked tutorial profile');
  await until(()=>profile().job==='keeper'&&profile().bag.ration===0&&profile().coins===50,'legal trial delivery hires the isolated test player');
  const p=profile();assert.equal(p.sequence,3);assert.equal(p.totals.crafted,1);assert.equal(p.totals.earned,30);assert.equal(p.bag.flour,2);assert.equal(p.xp,0);assertNoTowerExtension(p,'private tutorial progression');
  readOnlyProfileBaseline=JSON.stringify(p);
  record('private fresh tutorial exposes application, trial-crafting, and keeper-stage controls',{before:{sequence:0,coins:20,job:'visitor'},after:{sequence:p.sequence,coins:p.coins,job:p.job,flour:p.bag.flour,ration:p.bag.ration,crafted:p.totals.crafted,earned:p.totals.earned,xp:p.xp,hasTower:Object.hasOwn(p,'tower')},queueBeforeVirtualAdvance:{recipe:queued.queue?.recipe,remaining:queued.queue?.remaining},virtualAdvanceMs:7000,input:'legal GameRuntime.command actions to the real GameWorker and its testMode clock; real button readiness checked in hidden renderer from explicit channels.update ShellState snapshots. Preflight-hidden popup IPC is suspended, no panel is resumed or shown, no user profile or network.'});
}
async function testAllTowerDestinations():Promise<void>{
  const supported=[...towerTargets].sort(codePointCompare),floorTargets=[...new Set(towerFloors.map(f=>f.target))].sort(codePointCompare),routes=Object.keys(routeExpectations).sort(codePointCompare);
  assert.equal(supported.length,17,'all 17 unique allowed tower destination targets');
  assert.deepEqual(routes,supported,'every allowed TowerTarget has an actual destination-page/control expectation');
  assert.ok(floorTargets.every(target=>towerTargets.includes(target)),'every 20-floor destination is within the allowed TowerTarget protocol');
  record('20 floor metadata and complete 17-target protocol are covered independently',{floorCount:towerFloors.length,uniqueFloorTargets:floorTargets,allAllowedTowerTargets:supported,targetsWithoutFloor: supported.filter(target=>!floorTargets.includes(target))});
  const towerWindow=tower();
  const fresh=structuredClone(profile()),seq=fresh.sequence;
  const ahead=await invoke(towerWindow,{type:'tower-action',envelope:{sequence:seq+2,requestId:randomUUID(),action:{type:'tower-claim',floor:1}}});
  check('tower owner rejects a stale/ahead receipt before progress changes',!ahead.ok,ahead);assert.deepEqual(profile(),fresh,'out-of-date tower receipt does not mutate the fresh profile');
  const validClaim=await invoke(towerWindow,{type:'tower-action',envelope:{sequence:seq+1,requestId:randomUUID(),action:{type:'tower-claim',floor:1}}});
  check('valid tower-only claim reaches fresh objective validation and is rejected before completion',!validClaim.ok&&String(validClaim.error).includes('尚未完成'),validClaim);
  assert.deepEqual(profile(),fresh,'ineligible fresh-profile claim does not create extension or economic mutation');assertNoTowerExtension(profile(),'fresh rejected tower claims');
  const routeOrder:TowerTarget[]=['supply-job',...towerTargets.filter(target=>target!=='supply-job')];
  for(const target of routeOrder){
    shell!.closePopup(false,true);shell!.closeArena();shell!.openTower(true);
    const state=await stateFrom(towerWindow);assert.equal(state.tower?.suspended,false,'tower explicitly rearmed before route '+target);
    const before={...suppression};
    const result=await invoke(towerWindow,{type:'tower-link',target});
    check('trusted TowerTarget IPC accepted '+target,result.ok,{result,target});
    await until(()=>shell!.state().towerNavigation?.target===target,'ShellState towerNavigation target '+target);
    await until(()=>shell!.state().tower?.suspended===true,'tower suspended after link '+target);
    const surface=await routeSurface(target),expectedRoute=routeExpectations[target];
    assert.equal(surface.observed.target,target,'renderer consumed exact cached navigation snapshot '+target);
    assert.equal(surface.observed.page,expectedRoute.page,'expected destination surface '+target);
    for(const selector of expectedRoute.required)check(`TowerTarget ${target} reaches visible ${selector}`,await visible(surface.win,selector),{target,selector,observed:surface.observed});
    for(const selector of expectedRoute.controls)check(`TowerTarget ${target} exposes real action control ${selector}`,await visible(surface.win,selector),{target,selector,observed:surface.observed});
    if(target==='supply-job'){
      const jobFlow=await js<any>(surface.win,'(()=>{const apply=document.getElementById("applyJob"),trial=document.getElementById("trialCraft"),deliver=document.getElementById("deliverTrial"),story=document.getElementById("jobStory");return{role:document.body.dataset.job,apply:{exists:!!apply,hidden:!!apply?.hidden,disabled:!!apply?.disabled,label:apply?.getAttribute("aria-label")||null},trial:{exists:!!trial,hidden:!!trial?.hidden,disabled:!!trial?.disabled,tooltip:trial?.dataset.tooltip||null},deliver:{exists:!!deliver,hidden:!!deliver?.hidden},story:story?.textContent||""}})()');
      check('job destination exposes application now and guards the trial step until its prerequisite',jobFlow.role==='visitor'&&jobFlow.apply.exists&&!jobFlow.apply.hidden&&!jobFlow.apply.disabled&&jobFlow.trial.exists&&jobFlow.trial.hidden&&jobFlow.trial.disabled&&String(jobFlow.trial.tooltip).includes('先应聘学徒')&&jobFlow.deliver.exists&&jobFlow.deliver.hidden,{target,jobFlow});
    }
    if(target==='collection')check('collection destination opens permanent relic/keepsake view',await visible(surface.win,'#cArchivePermanent'),surface.observed);
    if(target==='camp-growth')check('growth destination opens the camp maintenance panel',await visible(surface.win,'#lifeOldCamp'),surface.observed);
    if(target==='supply-job')check('new visitor lands at the actual job panel',await visible(surface.win,'#jobPanel'),surface.observed);
    const safeClick=safeRouteClicks[target];assert.ok(safeClick,'each target has a representative non-economic local click: '+target);
    const clickResult=await js<any>(surface.win,`(()=>{const e=document.querySelector(${JSON.stringify(safeClick.selector)});if(!e)return{found:false,disabled:false};if(e instanceof HTMLButtonElement&&e.disabled)return{found:true,disabled:true,id:e.id||null};e.click();return{found:true,disabled:false,id:e.id||null,tag:e.tagName}})()`);
    check(`actual destination control click · ${target} · ${safeClick.description}`,clickResult.found&&!clickResult.disabled,clickResult);
    await until(()=>js<boolean>(surface.win,safeClick.postcondition),`representative destination control response ${target}`);
    check(`representative destination control state updated · ${target}`,await js<boolean>(surface.win,safeClick.postcondition),{selector:safeClick.selector,postcondition:safeClick.postcondition});
    assert.equal(surface.win.isVisible(),false,'destination surface remains natively hidden');assert.equal(surface.win.isFocused(),false,'destination surface remains unfocused');assert.equal(towerWindow.isVisible(),false,'tower remains hidden after navigation');
    assert.equal(suppression.show,before.show,'navigation must never call BrowserWindow.show');assert.equal(suppression.windowFocus,before.windowFocus,'navigation must never call BrowserWindow.focus');assert.equal(suppression.webContentsFocus,before.webContentsFocus,'navigation must never call webContents.focus');
    record('all-route ShellState snapshot reached its actual operation controls and accepted a safe representative click',{target,navigation:shell!.state().towerNavigation,windowId:surface.win.id,page:page(surface.win),observed:surface.observed,requiredPanels:expectedRoute.required,operationControls:expectedRoute.controls,representativeClick:{...safeClick,...clickResult},destinationVisible:surface.win.isVisible(),towerVisible:towerWindow.isVisible(),hiddenPreflight:true,noEconomicActionDispatched:true});
    if(target==='supply-job'||target==='collection'||target==='alchemy-trade'||target==='village-projects')await capture(surface.win,`route-${target}`);
    if(target==='supply-job')await completePrivateIntroThroughShop(surface.win);
  }
  assert.ok(readOnlyProfileBaseline,'private legal tutorial actions establish the baseline for the remaining read-only acceptance');
  record('fresh claim rejection precedes legal tutorial progression; navigation thereafter uses its keeper baseline',{freshSequence:fresh.sequence,freshJob:fresh.job,freshCoins:fresh.coins,navigationBaseline:JSON.parse(readOnlyProfileBaseline),hasTower:Object.hasOwn(profile(),'tower')});
}
async function testRoomGateKeepsTowerUsable():Promise<void>{
  const room=shell!.room,role=room.state.role;assert.equal(role,'none','no real friend-room session is started in this isolated acceptance');
  shell!.closePopup(false,true);shell!.closeArena();shell!.openTower(true);const win=tower();
  await until(()=>js<boolean>(win,'document.body.dataset.towerReady==="true"'),'tower ready before synthetic room-gate case');
  const before=structuredClone(profile());
  try{
    // Exercise the existing RoomService.inRoom() gate without opening a listener,
    // joining another machine, or sending network traffic.
    room.state.role='host';
    const denied=await invoke(win,{type:'tower-link',target:'dungeon'});
    check('simulated active-room gate rejects a casual tower destination',!denied.ok&&String(denied.error).includes('好友房间'),denied);
    const state=await stateFrom(win);check('room rejection leaves the tower readable and unsuspended',state.tower?.suspended===false&&state.game?.status==='ready',state);
    check('room rejection does not hide or destroy the tower',shell!.towerWindow===win&&!win.isDestroyed()&&!win.isVisible()&&!win.isFocused(),{windowId:win.id,state:state.tower,destroyed:win.isDestroyed(),visible:win.isVisible(),focused:win.isFocused()});
    await closeTowerThroughRenderer(win,'tower after simulated room denial');
    shell!.openTower(true);const reopened=tower();await until(()=>js<boolean>(reopened,'document.body.dataset.towerReady==="true"'),'tower reopened after room rejection');
    const retry=await invoke(reopened,{type:'tower-link',target:'supply'});check('tower accepts a subsequent non-room destination after rejection',retry.ok,retry);
    await until(()=>shell!.state().towerNavigation?.target==='supply'&&shell!.state().tower?.suspended===true,'successful supply route after room-gate rejection');
    const destination=shell!.popupWindow;assert.ok(destination&&!destination.isDestroyed());await until(()=>js<boolean>(destination,'document.body.dataset.towerDestination==="supply"'),'shop workspace after room-gate recovery');
    check('post-rejection tower navigation lands in the requested real shop workspace',await visible(destination,'#roomWorkspace')&&await visible(destination,'#shopPanelSupply'),{windowId:destination.id,target:shell!.state().towerNavigation,workspace:await visible(destination,'#roomWorkspace'),panel:await visible(destination,'#shopPanelSupply')});
    assert.deepEqual(profile(),before,'room-gate error, close, and retry are read-only');assertNoTowerExtension(profile(),'room-gate recovery');
    record('room rejection did not strand the tower; read, close, reopen and navigate all succeeded',{simulation:'RoomService.inRoom() source is exercised using its role flag in memory; no actual room listener, peer, or network traffic.',windowId:win.id,reopenedId:reopened.id,rejectedTarget:'dungeon',acceptedTarget:'supply',profileSequence:profile().sequence});
  }finally{
    room.state.role=role;shell!.closePopup(false,true);shell!.closeArena();if(shell!.towerWindow)shell!.closeTower();
  }
}
async function testTowerLifecycle():Promise<void>{
  shell!.closePopup(false,true);shell!.closeArena();shell!.openTower(true);const win=tower();const firstId=win.id;await until(()=>js<boolean>(win,'document.body.dataset.towerReady==="true"&&!!document.getElementById("towerClose")'),'tower DOM ready before lifecycle minimize');
  const minimize=await invoke(win,{type:'tower-minimize'});check('tower minimize is accepted from the tower renderer',minimize.ok,minimize);
  let minimizeEvent:'native'|'synthetic-fallback'='native';
  if(shell!.state().tower?.suspended!==true){minimizeEvent='synthetic-fallback';win.emit('minimize');}
  await until(()=>shell!.state().tower?.suspended===true,'tower minimize pauses/suspends it');
  check('minimized tower is suspended without becoming visible or focused',!win.isVisible()&&!win.isFocused(),{windowId:win.id,minimized:win.isMinimized(),state:shell!.state().tower});
  const blockedLink=await invoke(win,{type:'tower-link',target:'dungeon'});check('suspended tower cannot dispatch navigation until explicitly resumed',!blockedLink.ok,blockedLink);
  const beforeActivation={...suppression};app.emit('did-resign-active');
  await until(()=>shell!.state().workingElsewhere===true&&shell!.state().tower?.suspended===true,'app-resign lifecycle suspends the tower');
  app.emit('did-become-active');await until(()=>shell!.state().workingElsewhere===false,'app-return lifecycle observed');
  check('returning to the app does not automatically unsuspend or reopen the tower',shell!.state().tower?.suspended===true&&shell!.towerWindow?.id===firstId&&!win.isVisible(),{id:firstId,state:shell!.state().tower,visible:win.isVisible(),focused:win.isFocused(),activationEvents:suppression.appActivateEvents-beforeActivation.appActivateEvents});
  const restoreEntry=await invoke(overlay(),{type:'tower-open'});check('street entry explicitly resumes existing tower after app return',restoreEntry.ok,restoreEntry);
  await until(()=>shell!.state().tower?.suspended===false,'street entry re-arms minimized tower');
  await until(()=>js<boolean>(win,'document.body.dataset.towerReady==="true"&&!!document.getElementById("towerClose")'),'tower DOM remains ready after explicit street recovery');
  check('explicit street resume keeps the existing tower singleton',shell!.towerWindow?.id===firstId,{firstId,currentId:shell!.towerWindow?.id,visible:win.isVisible(),focused:win.isFocused(),restoreAttempts:suppression.restore});
  await closeTowerThroughRenderer(win,'lifecycle close');
  const closedId=win.id;app.emit('did-become-active');await new Promise(resolve=>setTimeout(resolve,150));
  check('closing the tower does not auto-reopen it on app activation',shell!.towerWindow===null,{closedId,currentId:shell!.towerWindow?.id,activateEvents:suppression.appActivateEvents});
  const reopen=await invoke(overlay(),{type:'tower-open'});check('a new explicit street entry reopens a closed tower',reopen.ok,reopen);
  await until(()=>!!shell!.towerWindow&&!shell!.towerWindow.isDestroyed()&&shell!.towerWindow.id!==closedId,'new singleton after explicit reopen');
  await until(()=>js<boolean>(tower(),'document.body.dataset.towerReady==="true"'),'reopened tower page ready');
  check('explicit reopen creates one new hidden singleton and keeps profile read-only',shell!.towerWindow?.id!==closedId&&BrowserWindow.getAllWindows().filter(w=>page(w)==='tower'&&!w.isDestroyed()).length===1&&!Object.hasOwn(profile(),'tower'),{oldId:closedId,newId:shell!.towerWindow?.id,towerPages:BrowserWindow.getAllWindows().filter(w=>page(w)==='tower'&&!w.isDestroyed()).map(w=>w.id),profileSequence:profile().sequence,hasTower:Object.hasOwn(profile(),'tower')});
  await closeTowerThroughRenderer(tower(),'reopened tower final close');
  record('tower lifecycle exercised through hidden Electron event state',{windowBeforeMinimize:firstId,windowAfterExplicitReopen:closedId,minimizeEvent,appResignAndReturn:'synthetic Electron did-resign-active/did-become-active lifecycle events; no actual visible OS app-switch proof',windowMinimize:'actual BrowserWindow.minimize call against a hidden window; a synthetic minimize event fallback is explicitly marked if Electron does not emit it for hidden windows. Physical visibility and user-facing OS minimize recovery cannot be established in this hidden run.',explicitRecovery:'real overlay preload IPC tower-open re-arms same singleton; actual show/restore requests remain intercepted'});
}
async function testReadOnlyReopenAndBoundaries():Promise<void>{
  if(!shell!.towerWindow){const opened=await invoke(overlay(),{type:'tower-open'});check('street entry opens a tower for the independent read-only close/reopen case',opened.ok,opened);await until(()=>!!shell!.towerWindow&&!shell!.towerWindow.isDestroyed(),'read-only lifecycle tower singleton');}
  const towerWin=tower();await until(()=>js<boolean>(towerWin,'document.body.dataset.towerReady==="true"&&!!document.getElementById("towerClose")'),'read-only tower ready before close/reopen');const snapshot=structuredClone(profile());assertNoTowerExtension(snapshot,'before close/reopen');
  await capture(towerWin,'tower-first-open');await closeTowerThroughRenderer(towerWin,'read-only tower close');
  await until(()=>shell!.towerWindow===null,'tower closed before final reopen check');
  assert.deepEqual(profile(),snapshot,'closing a read-only tower preserves profile exactly');
  const open=await invoke(overlay(),{type:'tower-open'});check('tower can be opened again without creating persistent extension',open.ok,open);
  await until(()=>!!shell!.towerWindow&&!shell!.towerWindow.isDestroyed(),'reopened tower exists');await until(()=>js<boolean>(tower(),'document.body.dataset.towerReady==="true"'),'reopened tower data ready');
  assert.deepEqual(profile(),snapshot,'reopened read-only tower leaves profile unchanged');assertNoTowerExtension(profile(),'read-only tower after reopen');
  record('tower reads are lazy and closing/reopening does not persist optional extension',{profileSequence:profile().sequence,profileHasTower:Object.hasOwn(profile(),'tower'),profileFileHasTower:Object.hasOwn(JSON.parse(fs.readFileSync(profileFile,'utf8')),'tower'),reopenedWindowId:tower().id});
}
async function auditRendererBoundaries():Promise<void>{
  const rows=snapshots();
  for(const row of rows){const win=BrowserWindow.fromId(Number(row.id));if(!win||win.isDestroyed())continue;
    if(!win.webContents.getURL()){record('keyboard/CSP renderer audit skipped an unloaded lazy native shell',{window:win.id,reason:'No document was loaded into this intentionally lazy recovery BrowserWindow; it is still covered by native hidden/unfocused assertions.'},'INFO');continue;}
    try{const result=await js<any>(win,'(()=>({installed:!!window.__towerShell0130Boundary,keys:window.__towerShell0130Boundary?window.__towerShell0130Keys:null,csp:window.__towerShell0130Boundary?window.__towerShell0130Csp:null}))()');keyEvents[win.id]=result.keys;cspEvents[win.id]=result.csp;if(result.csp?.length)errors.push('CSP violation window '+win.id+': '+JSON.stringify(result.csp));check('renderer had no keyboard events or CSP violations · window '+win.id,result.installed&&result.keys===0&&result.csp?.length===0,result);}
    catch(error){harnessIssues.push('renderer boundary snapshot '+win.id+': '+String(error));}
  }
  check('no global shortcut registrations intercepted',suppression.globalShortcut===0,suppression);
  check('no file dialogs opened',suppression.dialogCalls===0,suppression);
  check('all native windows are hidden and unfocused',rows.filter(row=>!row.destroyed).every(row=>row.visible===false&&row.focused===false),rows);
  assert.ok(readOnlyProfileBaseline,'private tutorial baseline exists before final read-only audit');
  const p=profile(),expected=JSON.parse(readOnlyProfileBaseline) as Profile;
  assert.deepEqual(stableProfile(p),stableProfile(expected),'navigation/lifecycle/source tests preserve the post-tutorial private profile');assertNoTowerExtension(p,'final in-memory profile');
  await shell!.game.request('flush');
  const saved=JSON.parse(fs.readFileSync(profileFile,'utf8'));assert.deepEqual(stableProfile(parseProfile(saved)),stableProfile(p),'isolated disk and live GameWorker stable fields agree; game clock fields can advance during flush');assert.deepEqual(stableProfile(saved),stableProfile(expected),'only the explicit legal tutorial flow changed the private profile');assertNoTowerExtension(saved,'final persisted profile');
  check('isolated profile matches the legal starter tutorial baseline and has no tower extension',saved.sequence===expected.sequence&&saved.coins===expected.coins&&saved.xp===expected.xp&&saved.job===expected.job&&!Object.hasOwn(saved,'tower'),{profileRoot,profileFile,version:saved.version,sequence:saved.sequence,coins:saved.coins,xp:saved.xp,job:saved.job,bag:saved.bag,crafted:saved.totals.crafted,earned:saved.totals.earned,hasTower:Object.hasOwn(saved,'tower')});
}
async function staticPreflight():Promise<void>{
  const source=fs.readFileSync(path.join(root,'tests/native-tower-shell-0130-luna.ts'),'utf8');
  const sourceFile=ts.createSourceFile('native-tower-shell-0130-luna.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  const staticPayloads:Array<{source:string;line:number}>=[];
  const visit=(node:ts.Node):void=>{if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==='js'&&node.arguments.length>=2){const payload=node.arguments[1];if(ts.isStringLiteral(payload)||ts.isNoSubstitutionTemplateLiteral(payload))staticPayloads.push({source:payload.text,line:sourceFile.getLineAndCharacterOfPosition(payload.getStart(sourceFile)).line+1});}ts.forEachChild(node,visit);};
  visit(sourceFile);for(const payload of staticPayloads)new vm.Script(payload.source,{filename:`tower-static-line-${payload.line}.js`});
  const clickPredicates=Object.entries(safeRouteClicks).map(([target,click])=>({target,source:click.postcondition}));for(const entry of clickPredicates)new vm.Script(entry.source,{filename:`tower-route-postcondition-${entry.target}.js`});
  const canaries=['(()=>window.street.state())()','(()=>window.street.command({type:"tower-link",target:"dungeon"}))()','(()=>document.elementFromPoint(22,22)?.closest("button")?.id||null)()'];for(const source of canaries)new vm.Script(source,{filename:'tower-prelaunch-canary.js'});
  record('inline Electron renderer JavaScript and every route postcondition were compiled before execution',{literalPayloads:staticPayloads.length,routePostconditions:clickPredicates.length,canaries:canaries.length});
}
function report(rawError?:unknown):void{
  fs.mkdirSync(evidenceDir,{recursive:true,mode:0o700});let endHashes:Record<string,string>={};
  try{if(productScopes.length)endHashes=productHashes();}catch(error){harnessIssues.push('end product inventory: '+String(error));}
  let finalProfile:unknown=null;try{const p=profile();finalProfile={version:p.version,sequence:p.sequence,tick:p.tick,job:p.job,coins:p.coins,xp:p.xp,bag:p.bag,hasTower:Object.hasOwn(p,'tower'),tower:p.tower};}catch{}
  const out={schema:'pixelstreet.tower-0130.luna.max.hidden-native.shell.v1',runId,status,at:new Date().toISOString(),identity:{name:APP_NAME,version:APP_VERSION,profileName:PROFILE_NAME,expectedVersion:EXPECTED_VERSION},fixtureMode,platform:process.platform,arch:process.arch,electron:process.versions.electron,profileRoot,profileFile,fixturePreflight:fixture?{version:fixture.version,sequence:fixture.sequence,job:fixture.job,coins:fixture.coins,xp:fixture.xp,hasTower:Object.hasOwn(fixture,'tower')}:null,profileFinal:finalProfile,manifestPath,manifest:candidateManifest??null,productScopes,productFileCount:Object.keys(productHashesAtStart).length,canonicalInventorySha256AtStart:inventoryAtStart,canonicalInventorySha256AtEnd:endHashes?canonicalInventory(endHashes):null,productHashesAtStart,productHashesAtEnd:endHashes,productUnchanged:JSON.stringify(productHashesAtStart)===JSON.stringify(endHashes),rendererJavaScriptDigests:sourceDigests.size,checks,errors,harnessIssues,screenshots,nativeWindows:snapshots(),keyEvents,cspEvents,suppression,rawError:rawError?String(rawError):undefined,stack:rawError instanceof Error?rawError.stack:undefined,harnessHashes:Object.fromEntries(['tests/native-tower-shell-0130-luna.ts','work/tower-0130/native-shell-luna/bootstrap.cjs','dist/native-tower-shell-0130-luna.cjs'].filter(file=>fs.existsSync(path.join(root,file))).map(file=>[file,createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')])),evidenceBoundary:{runtime:'Real Electron main process, actual DesktopShell, hidden street/shop/alchemy/casual/tower renderer pages, real preload IPC, and GameWorker backed by a private marked profile. No browser preview.',startup:'The bootstrap blocks app activation/focus, BrowserWindow show/showInactive/focus/moveTop/restore, webContents.focus, Dock activation, native dialogs, Tray construction and globalShortcut before DesktopShell import. All native windows were asserted hidden and unfocused.',input:'Street hover/click uses synthetic MouseEvent at actual measured DOM hit coordinates. Tutorial actions use software DOM button clicks; virtual time is advanced only through GameWorker testMode. No physical mouse, keyboard or IME evidence. No keyboard events were dispatched.',profile:'Fresh schema8 profile under /private/tmp was marker-checked before startDesktop. A legal apply/craft/virtual-time/deliver tutorial sequence uses only that marked profile, then every later navigation/lifecycle/source test is compared to its private post-tutorial baseline. No installed/user progress location was inspected; the profile file and live GameWorker were compared.',viewports:'Native street height was checked against all five selected DIP bounds. Width/height viewport matrix uses CDP Emulation software CSS metrics with actual renderer devicePixelRatio; software capturePage screenshots are not physical-display evidence.',lifecycle:'App resign/return uses synthetic Electron lifecycle events. BrowserWindow.minimize is exercised while the window is hidden. No visible OS task-switch/minimize/recovery proof is claimed.',installation:'Final DMG/install byte audit is a separate read-only follow-up after a root-provided installation audit plan.'}};
  fs.writeFileSync(reportPath,JSON.stringify(out,null,2)+'\n',{flag:'wx',mode:0o600});
  fs.appendFileSync(progressPath,JSON.stringify({at:new Date().toISOString(),finalReport:reportPath,status,errors})+'\n',{mode:0o600});
}
async function main():Promise<void>{
  try{
    await preflightManifest();await staticPreflight();await preflightFixture();
    app.on('browser-window-created',(_event,win)=>track(win));app.on('web-contents-created',(_event:any,contents:any)=>contents.on('console-message',(event:any)=>{if(event.level==='error')errors.push(String(event.message).slice(0,900));}));
    shell=await startDesktop(profileRoot,true);await until(()=>shell?.game.state.status==='ready'&&!!shell.game.state.profile,'GameWorker ready on the private marked profile');for(const win of BrowserWindow.getAllWindows())track(win);
    assert.deepEqual(stableProfile(profile()),stableProfile(fixture!),'actual GameWorker loaded the generated fresh fixture; startup tick, carryMs and wallAt may naturally advance');
    const street=overlay();await until(()=>js<boolean>(street,'document.body.dataset.atlas==="verified"&&!!document.getElementById("towerEntrance")'),'actual local street art and tower entrance ready');
    await testStreetEntranceMatrix();await testFieldAndInteractionGuards();
    const hit=await js<any>(overlay(),'(()=>{const e=document.getElementById("towerEntrance"),r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;e.dispatchEvent(new MouseEvent("mousemove",{bubbles:true,clientX:x,clientY:y}));e.dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true,clientX:x,clientY:y,button:0,buttons:1}));return{rect:{x:r.x,y:r.y,w:r.width,h:r.height},target:document.elementFromPoint(x,y)?.closest("button")?.id,hover:document.body.dataset.hover}})()');
    check('actual street DOM hit triggers tower-open at building/plaque target',hit.target==='towerEntrance'&&hit.hover==='tower',hit);
    await until(()=>!!shell!.towerWindow&&!shell!.towerWindow.isDestroyed(),'street tower-open IPC creates native singleton');await until(()=>js<boolean>(tower(),'document.body.dataset.towerReady==="true"'),'tower page first read complete');track(tower());
    await testForgedProtocolAndOwnerIsolation();await testAllTowerDestinations();await testRoomGateKeepsTowerUsable();await testTowerLifecycle();await testReadOnlyReopenAndBoundaries();
    assert.ok(readOnlyProfileBaseline,'verified legal starter steps produced a private read-only baseline before lifecycle checks');
    const baseline=JSON.parse(readOnlyProfileBaseline) as Profile;await shell.game.request('flush');assert.deepEqual(stableProfile(profile()),stableProfile(baseline),'post-tutorial shell/navigation acceptance leaves private progress identical to its baseline (time fields may advance normally)');
    await auditRendererBoundaries();assert.deepEqual(errors,[],'renderer console/CSP errors: '+errors.join('; '));
    const end=productHashes();assert.deepEqual(end,productHashesAtStart,'all candidate bytes unchanged during acceptance');assert.deepEqual(end,candidateManifest?.hashes,'end bytes equal RC4 frozen manifest');assert.equal(canonicalInventory(end),EXPECTED_INVENTORY);
    check('exact frozen RC4 product hashes remain unchanged through test',JSON.stringify(end)===JSON.stringify(productHashesAtStart),{files:Object.keys(end).length,canonicalInventorySha256:canonicalInventory(end)});
    check('bootstrap did not permit app or window activation',suppression.appFocus===0&&suppression.windowFocus===0&&suppression.webContentsFocus===0&&suppression.appActivateEvents===0,{...suppression});
    status='PASS';record('independent Luna max 0.13.0 shell/IPC/navigation/lifecycle hidden-native acceptance PASS',{checks:checks.length,screenshots:screenshots.length,productFiles:Object.keys(end).length,canonicalInventorySha256:inventoryAtStart,profileRoot,allTargets:towerTargets,allFiveHeights:heightPresets});
  }catch(error){
    status='FAIL';errors.push(String(error));checks.push({name:'raw independent hidden-native tower shell acceptance attempt',status:'FAIL',detail:{error:String(error),stack:error instanceof Error?error.stack:undefined}});console.error(error instanceof Error?error.stack:String(error));
    for(const win of BrowserWindow.getAllWindows())try{await capture(win,`raw-red-${page(win)||'unknown'}-${win.id}`);}catch(captureError){harnessIssues.push('raw RED capture: '+String(captureError));}
  }finally{
    try{if(shell)await shell.game.request('flush');}catch(error){harnessIssues.push('final isolated GameWorker flush: '+String(error));}
    for(const win of BrowserWindow.getAllWindows())try{await clearViewport(win);}catch(error){harnessIssues.push('clear CSS viewport '+win.id+': '+String(error));}
    try{report(status==='FAIL'?new Error(errors.at(-1)||'acceptance failed'):undefined);}catch(error){console.error('report write failed: '+String(error));}
    app.exit(status==='FAIL'?1:0);
  }
}
void main();
