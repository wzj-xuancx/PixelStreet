import {app,BrowserWindow,type BrowserWindow as BrowserWindowType} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {startDesktop} from '../apps/desktop/bootstrap';
import {GameStore} from '../apps/desktop/game-store';
import {markIsolatedFolder} from '../apps/desktop/launch-profile';
import {APP_NAME,APP_VERSION,PROFILE_NAME} from '../apps/desktop/identity';
import {
  GOOD_IDS,FORMULAS,QUOTES,atelierPrice,advance,facilityCost,initialAtelier,initialCamp,initialProfile,jobPower,
  parseProfile,stableAtelierOrder,type Good,type Profile,
} from '../packages/solo-core';

type Scenario='visitor'|'keeper'|'rich'|'reward-cap';
type Check={name:string;status:'PASS'|'FAIL'|'INFO';detail?:unknown};
type Trace={id:number;page:string|null;visible:()=>boolean;focused:()=>boolean;last:{isVisible:boolean;isFocused:boolean}};
type Control={exists:boolean;hidden:boolean;disabled:boolean;label:string;tip:string;cursor:string;font:number;gameButton:boolean;reachable:boolean;rect:{x:number;y:number;width:number;height:number}};

const checks:Check[]=[];
const errors:string[]=[];
const screenshots:string[]=[];
const suppression=(globalThis as any).__pixelStreetAlchemy0110Suppression??{};
const root=process.cwd();
const evidenceDir=path.join(root,'work/inner-0110/trade/native-luna/alchemy');
const scenario=(process.argv.find(a=>a.startsWith('--scenario='))?.split('=')[1]??'visitor') as Scenario;
if(!['visitor','keeper','rich','reward-cap'].includes(scenario))throw new Error('scenario must be visitor, keeper, rich or reward-cap');
const runId=new Date().toISOString().replace(/[:.]/g,'-')+'-'+process.pid+'-'+scenario;
const profileRoot=fs.mkdtempSync('/private/tmp/pixelstreet-inner-0110-alchemy-luna-'+scenario+'-');
const profileFile=path.join(profileRoot,'solo/profile.json');
const reportPath=path.join(evidenceDir,'native-'+scenario+'-'+runId+'.json');
const progressPath=path.join(evidenceDir,'native-'+scenario+'-'+runId+'.jsonl');
const traces=new Map<number,Trace>();
const keyboardByWindow:Record<number,number>={};
const cspByWindow:Record<number,string[]>={};
let shell:Awaited<ReturnType<typeof startDesktop>>|undefined;
let preflight:Profile|undefined;
let status:'RUNNING'|'PASS'|'FAIL'='RUNNING';

const coverageMatrix:Record<Scenario,string[]>={
  visitor:[
    'new visitor opens the visible alchemy location; all three unreceivable guest NPCs are hidden',
    'alchemy opening and shared cash collection are disabled with actual employment reasons; direct worker rejection leaves profile unchanged',
    'unhired raw-material market and selectable recipe remain reachable; purchase/craft controls expose truthful role reasons and the worker rejects bypassed purchases',
    'read-only routes and repeated popup close/reopen do not lazily add the optional atelier extension',
    'scene destinations counter/supplies/still/shelf/study/recipes/orders/overview are operable; 760x650 and 1040x650 hidden captures',
    'hidden native, keyboard, CSP, private marked profile and product-hash boundaries',
  ],
  keeper:[
    'keeper legacy profile without atelier remains uninitialized through all read-only scene and workspace routes',
    'explicitly opening the alchemy counter is the first worker action that initializes Atelier',
    'empty shared cashbox and absent workshop job show truthful disabled/hidden state',
    'all existing alchemy craft/sales/study/overview pages and popup reopen remain reachable',
    'hidden native, keyboard, CSP, private marked profile and product-hash boundaries',
  ],
  rich:[
    'all six real alchemy shelf goods reflect stock exactly; no zero-stock ghost item',
    'every selectable alchemy recipe updates its selected name, use, art, actual ingredient rows, shelf quote and journal while preserving chooser nodes',
    'craft/sales/study pages are captured at 760x650 and 1040x650 with the selected page alone visible and no legacy text table',
    'all alchemy scene navigation including three matching real guest slots and assigned workshop companion',
    'raw-material purchase, production queue/completion/refund, stale batch-id rejection, three still research tiers, counter research and journal reward',
    'manual pricing, alchemy opening, worker-clock automatic sale, closing and exact-once shared cashbox collection',
    'three actual orders accept/deliver/accept/abandon and advance their authoritative revisions',
    'old craft/sales/study/overview pages, stable scene DOM, popup close/reopen, 760x650 and 1040x650',
    'shared motion hover, blur latch, authoritative blocked/resume fields, ancestor hidden, reduced-motion, pulse cancellation',
    'hidden native, keyboard, CSP, private marked profile and product-hash boundaries',
  ],
  'reward-cap':[
    'real alchemy guest opens its matching order; accepted order cannot deliver when reward exceeds coin capacity',
    'reward-space disabled reason is surfaced and no sequence, stock, coin, dust or order state is mutated',
    'hidden native, keyboard, CSP, private marked profile and product-hash boundaries',
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
  const files=[
    ...walk(path.join(root,'apps/desktop')),...walk(path.join(root,'packages/solo-core')),
    ...walk(path.join(root,'packages/protocol')),...walk(path.join(root,'packages/content')),
    ...walk(path.join(root,'assets')),...walk(path.join(root,'dist')),
  ];
  return [...new Set(files)].filter(file=>!/^dist\/(?:tests\/|native-.*\.cjs$)/.test(file)&&fs.existsSync(path.join(root,file))).sort();
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
    schema:'pixelstreet.inner-0110.alchemy.luna-max.hidden-native.v1',stage:'alchemy-scene',scenario,runId,status,at:new Date().toISOString(),
    identity:{name:APP_NAME,version:APP_VERSION,profileName:PROFILE_NAME},platform:process.platform,arch:process.arch,electron:process.versions.electron,
    profileRoot,profileFile,preflight:preflight?{version:preflight.version,sequence:preflight.sequence,job:preflight.job,coins:preflight.coins,atelierPresent:Object.hasOwn(preflight,'atelier')}:null,
    coverageMatrix:coverageMatrix[scenario],checks,errors,screenshots,suppression,nativeWindows:snapshots(),keyboardByWindow,cspByWindow,
    productScope:{roots:['apps/desktop','packages/solo-core','packages/protocol','packages/content','assets','dist'],files:Object.keys(hashesAtStart).length,excluded:['tests/native-alchemy-0110-luna.ts','tests/native-alchemy-0110-luna-bootstrap.cjs','tests/run-native-alchemy-0110-luna.sh','dist/native-alchemy-0110-luna.cjs','dist/tests']},
    productHashesAtStart:hashesAtStart,productHashesAtEnd:status==='RUNNING'?undefined:productHashes(),
    error:error?String(error):undefined,stack:error instanceof Error?error.stack:undefined,
    evidenceBoundary:{
      windowPolicy:'The independent bootstrap loaded before DesktopShell. It blocks activation/focus, BrowserWindow show/showInactive/focus/moveTop/restore, webContents.focus, Dock activation, Tray and globalShortcut. macOS activationPolicy is prohibited.',
      nativeState:'Original Electron BrowserWindow isVisible/isFocused methods are sampled throughout. Every app window must remain hidden and unfocused.',
      input:'Only HTMLElement.click(), renderer-dispatched MouseEvent/PointerEvent, programmatic select changes, worker test-clock requests, BrowserWindow.setSize, hidden capturePage, renderer getter fixtures and a CDP forced CSS probe are used. These are software probes, not physical input evidence.',
      profile:'A new /private/tmp profile is parseProfile-preflighted and marked before startDesktop. No installed-app profile or old application data directory is opened.',
    motion:'Renderer document.hidden/visibilityState/hasFocus test overrides are restored after each probe; native hidden windows may still report document.hidden=false. A same-revision renderer state push tests popup.suspended because the main process withholds intermediate updates to a suspended popup. Direct Electron lifecycle events do not claim a real OS app switch.',
      productIntegrity:'Per-run SHA-256 inventory covers source and built runtime including assets. The dedicated harness bundle and test files are excluded.',
      screen:'All native windows remain hidden; capturePage images are hidden renderer evidence and are not described as a visible display or physical-device result.',
    },
  };
  fs.writeFileSync(reportPath,JSON.stringify(record,null,2)+'\n',{flag:'wx',mode:0o600});
  fs.appendFileSync(progressPath,JSON.stringify({at:new Date().toISOString(),finalReport:reportPath,status,errors})+'\n',{mode:0o600});
}
function check(name:string,detail?:unknown,result:'PASS'|'FAIL'|'INFO'='PASS'):void{
  checks.push({name,status:result,detail});
  fs.appendFileSync(progressPath,JSON.stringify({at:new Date().toISOString(),name,status:result,detail})+'\n',{mode:0o600});
}
async function until(fn:()=>Promise<boolean>|boolean,label:string,timeout=25_000):Promise<void>{
  const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await new Promise(resolve=>setTimeout(resolve,35));}throw new Error('timeout: '+label);
}
async function js<T=unknown>(win:BrowserWindowType,source:string):Promise<T>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([win.webContents.executeJavaScript(source) as Promise<T>,new Promise<T>((_resolve,reject)=>{timer=setTimeout(()=>reject(new Error('renderer evaluation timed out on '+win.id)),15_000);})]);}
  finally{if(timer)clearTimeout(timer);}
}
async function instrument(win:BrowserWindowType):Promise<void>{
  await js(win,'(()=>{if(window.__alchemy0110Instrumented)return true;window.__alchemy0110Instrumented=true;window.__alchemy0110Keys=0;window.__alchemy0110Csp=[];for(const t of ["keydown","keyup","keypress"])document.addEventListener(t,()=>window.__alchemy0110Keys++,true);document.addEventListener("securitypolicyviolation",e=>window.__alchemy0110Csp.push({directive:e.violatedDirective,blocked:e.blockedURI,sample:e.sample}),true);return true})()');
}
function track(win:BrowserWindowType):void{
  if(traces.has(win.id))return;
  const visible=win.isVisible.bind(win),focused=win.isFocused.bind(win);
  traces.set(win.id,{id:win.id,page:page(win),visible,focused,last:{isVisible:visible(),isFocused:focused()}});
  keyboardByWindow[win.id]=0;cspByWindow[win.id]=[];
  win.webContents.on('console-message',(event:any)=>{
    const message=String(event.message);if(event.level==='error')errors.push(message.slice(0,600));
    if(/Content Security Policy|style-src|Refused to apply inline style/i.test(message))cspByWindow[win.id].push(message.slice(0,600));
  });
  win.webContents.on('did-finish-load',()=>{const trace=traces.get(win.id);if(trace)trace.page=page(win);void instrument(win).catch(error=>errors.push('instrument '+win.id+': '+String(error)));});
}
function overlay():BrowserWindowType{assert.ok(shell&&!shell.overlay.isDestroyed(),'overlay missing');return shell.overlay;}
function popup():BrowserWindowType{const win=shell?.popupWindow;assert.ok(win&&!win.isDestroyed(),'popup missing');return win;}
function profile():Profile{const p=shell?.game.state.profile;assert.ok(p,'profile unavailable: '+(shell?.game.state.error||'loading'));return p;}
function assertLoadedFixture(actual:Profile,fixture:Profile):void{assert.deepEqual(actual,advance(fixture,actual.wallAt),'worker loaded the private fixture advanced to startup wall time');}
async function clickElement(win:BrowserWindowType,id:string):Promise<void>{assert.ok(await js<boolean>(win,'!!document.getElementById('+JSON.stringify(id)+')'),id+' missing');await js(win,'document.getElementById('+JSON.stringify(id)+').click()');}
async function clickSelector(win:BrowserWindowType,selector:string):Promise<void>{assert.ok(await js<boolean>(win,'!!document.querySelector('+JSON.stringify(selector)+')'),selector+' missing');await js(win,'document.querySelector('+JSON.stringify(selector)+').click()');}
async function popupReady():Promise<BrowserWindowType>{
  const win=popup(),generation=shell?.popup?.generation;assert.ok(generation,'alchemy popup generation missing');
  await until(()=>js<boolean>(win,'document.body.dataset.popupReady==="true"&&document.body.dataset.popup==="alchemy"&&document.body.dataset.generation==='+JSON.stringify(String(generation))),'alchemy popup generation ready');
  await until(()=>js<boolean>(win,'!!document.getElementById("alchemyScene")&&!!document.getElementById("roomSceneView")'),'alchemy scene mounted');
  assert.equal(shell?.popup?.kind,'alchemy');assert.equal(shell?.popup?.generation,generation);assert.equal(win.isVisible(),false);assert.equal(win.isFocused(),false);await instrument(win);return win;
}
async function openAlchemy():Promise<BrowserWindowType>{
  const street=overlay();await until(()=>!!shell&&Reflect.get(shell,'overlayCold')===false&&js<boolean>(street,'document.body.dataset.view!==undefined&&!!document.querySelector("[data-shop=\\"shop-alchemy\\"]")'),'alchemy street location ready');
  if(shell?.view!=='interior'||shell.activeShop!=='shop-alchemy'){
    await clickSelector(street,'[data-shop="shop-alchemy"]');await until(()=>shell?.view==='interior'&&shell.activeShop==='shop-alchemy','enter alchemy location');
  }
  await new Promise(resolve=>setTimeout(resolve,120));
  const logical=await js<{x:number;y:number;scale:number;interior:string}>(street,'({x:Number(document.body.dataset.worldX),y:Number(document.body.dataset.worldY),scale:Number(document.body.dataset.worldScale),interior:document.body.dataset.interiorFrame})');
  assert.equal(logical.interior,'interior-alchemy');assert.ok(Number.isFinite(logical.x+logical.y+logical.scale)&&logical.scale>0,'street scene coordinates unavailable');
  await js(street,'document.dispatchEvent(new MouseEvent("click",{bubbles:true,clientX:'+String(logical.x+484*logical.scale)+',clientY:'+String(logical.y-20*logical.scale)+'}))');
  const win=await popupReady();check('software click on hidden street alchemy keeper opens the alchemy popup',{scene:logical,shop:shell?.activeShop,window:{id:win.id,visible:win.isVisible(),focused:win.isFocused()},input:'renderer MouseEvent; not physical input'});return win;
}
async function control(win:BrowserWindowType,id:string):Promise<Control>{
  return js(win,'(()=>{const e=document.getElementById('+JSON.stringify(id)+'),c=document.querySelector(".popover-content")||document.scrollingElement||document.documentElement,hidden=!e||e.hidden||!!e.closest("[hidden]")||!!e.closest("details:not([open])")||getComputedStyle(e).display==="none";if(!hidden)e.scrollIntoView({block:"center",inline:"nearest"});const r=e&&e.getBoundingClientRect(),cr=c.getBoundingClientRect(),s=e&&getComputedStyle(e),hit=r&&document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return{exists:!!e,hidden,disabled:!e||!!e.disabled,label:e?.getAttribute("aria-label")||e?.textContent?.trim()||"",tip:e?.dataset.tooltip||e?.title||"",cursor:s?.cursor||"",font:s?parseFloat(s.fontSize):0,gameButton:!!e?.classList.contains("game-button"),reachable:!hidden&&!!r&&r.width>0&&r.height>0&&r.top>=cr.top-.5&&r.bottom<=cr.bottom+.5&&hit?.closest("button")==e,rect:r?{x:r.x,y:r.y,width:r.width,height:r.height}:{x:0,y:0,width:0,height:0}}})()');
}
async function assertControl(win:BrowserWindowType,id:string,enabled=true):Promise<Control>{
  const state=await control(win,id);assert.ok(state.exists&&!state.hidden,id+' missing/hidden: '+JSON.stringify(state));assert.equal(state.disabled,!enabled,id+' disabled state');
  assert.ok(state.gameButton,id+' is not a GameButton');assert.ok(state.tip.trim(),id+' has no tooltip or disabled reason');assert.ok(state.font>=16,id+' font is below 16px');
  assert.equal(state.cursor,enabled?'pointer':'not-allowed',id+' cursor');if(enabled)assert.ok(state.reachable,id+' not reachable: '+JSON.stringify(state));return state;
}
async function localClick(win:BrowserWindowType,id:string):Promise<void>{const s=await assertControl(win,id,true);await clickElement(win,id);check('software local control '+id,{label:s.label,tooltip:s.tip,rect:s.rect,input:'HTMLElement.click() only'});}
async function actionClick(win:BrowserWindowType,id:string,double=false):Promise<Profile>{
  const s=await assertControl(win,id,true),before=profile().sequence;await clickElement(win,id);if(double)await clickElement(win,id);
  await until(()=>profile().sequence>=before+1,id+' worker receipt');await new Promise(resolve=>setTimeout(resolve,90));assert.equal(profile().sequence,before+1,id+' submitted more than one action');
  check('authoritative alchemy worker action '+id,{label:s.label,tooltip:s.tip,sequenceBefore:before,sequenceAfter:profile().sequence,notice:profile().notice,doubleClickProbe:double,input:'software DOM click; not physical input'});return profile();
}
async function disabledControl(win:BrowserWindowType,id:string,reason?:RegExp):Promise<Control>{const s=await assertControl(win,id,false);if(reason)assert.match(s.tip,reason,id+' disabled reason');check('authoritative disabled control '+id,s);return s;}
async function disabledHoverStyles(win:BrowserWindowType,id:string,reason?:RegExp):Promise<void>{
  const disabled=await disabledControl(win,id,reason),debuggerApi=win.webContents.debugger,wasAttached=debuggerApi.isAttached();let nodeId:number|undefined;
  try{
    if(!wasAttached)debuggerApi.attach('1.3');await debuggerApi.sendCommand('DOM.enable');await debuggerApi.sendCommand('CSS.enable');
    const doc=await debuggerApi.sendCommand('DOM.getDocument',{depth:-1,pierce:true});const node=await debuggerApi.sendCommand('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'#'+id});nodeId=node.nodeId;assert.ok(nodeId,'CDP could not resolve disabled hover target '+id);
    const sample=()=>js<Record<string,string>>(win,'(()=>{const e=document.getElementById('+JSON.stringify(id)+'),s=getComputedStyle(e),t=e.querySelector(".ls-tag"),ts=t&&getComputedStyle(t),shadow=s.boxShadow;return{filter:s.filter,outline:s.outline,outlineWidth:s.outlineWidth,outlineColor:s.outlineColor,boxShadow:shadow==="none"||/^rgba\\(0, 0, 0, 0\\) 0px 0px 0px 0px$/.test(shadow)?"none":shadow,background:s.backgroundColor,borderColor:s.borderColor,opacity:s.opacity,tagBackground:ts?.backgroundColor||"",tagBorder:ts?.borderColor||"",tagColor:ts?.color||""}})()');
    const before=await sample();await debuggerApi.sendCommand('CSS.forcePseudoState',{nodeId,forcedPseudoClasses:['hover']});const hovered=await sample();await debuggerApi.sendCommand('CSS.forcePseudoState',{nodeId,forcedPseudoClasses:[]});
    assert.deepEqual(hovered,before,'disabled '+id+' gained a hover highlight');check('disabled scene control remains visually unchanged under forced CSS :hover',{id,tooltip:disabled.tip,before,forcedHover:hovered,probe:'Chrome DevTools CSS.forcePseudoState on hidden renderer; not physical hover'});
  }finally{if(nodeId!==undefined){try{await debuggerApi.sendCommand('CSS.forcePseudoState',{nodeId,forcedPseudoClasses:[]});}catch{}}if(!wasAttached&&debuggerApi.isAttached())debuggerApi.detach();}
  assert.equal(win.isVisible(),false);assert.equal(win.isFocused(),false);
}
async function capture(win:BrowserWindowType,label:string,minimum={width:620,height:500}):Promise<void>{
  await new Promise(resolve=>setTimeout(resolve,180));const image=await win.webContents.capturePage(),size=image.getSize(),bytes=image.toPNG();
  assert.ok(size.width>=minimum.width&&size.height>=minimum.height,'hidden capture size too small '+JSON.stringify(size));assert.ok(bytes.length>8_000,'hidden capturePage returned too few bytes: '+bytes.length);
  const file=path.join(evidenceDir,'native-'+scenario+'-'+runId+'-'+label+'.png');fs.writeFileSync(file,bytes,{flag:'wx',mode:0o600});screenshots.push(file);
  assert.equal(win.isVisible(),false);assert.equal(win.isFocused(),false);check('hidden capturePage '+label,{file,size,bytes:bytes.length,native:{visible:win.isVisible(),focused:win.isFocused()},boundary:'hidden renderer pixels only'});
}
async function auditVisibleControls(win:BrowserWindowType,label:string):Promise<void>{
  const data=await js<{width:number;scrollWidth:number;buttons:Array<{id:string;hidden:boolean;disabled:boolean;tip:string;cursor:string;font:number;gameButton:boolean;width:number;height:number}>;duplicates:string[]}>(win,'(()=>{const scope=[...document.querySelectorAll("#roomSceneView:not([hidden]),#roomWorkspace:not([hidden])")],buttons=scope.flatMap(r=>[...r.querySelectorAll("button[id]")]).filter(e=>!e.hidden&&!e.closest("[hidden]")&&getComputedStyle(e).display!=="none").map(e=>{const s=getComputedStyle(e),b=e.getBoundingClientRect();return{id:e.id,hidden:false,disabled:e.disabled,tip:e.dataset.tooltip||e.title||"",cursor:s.cursor,font:parseFloat(s.fontSize),gameButton:e.classList.contains("game-button"),width:b.width,height:b.height}}),ids=scope.flatMap(r=>[...r.querySelectorAll("[id]")].map(e=>e.id)),duplicates=[...new Set(ids.filter((id,i)=>ids.indexOf(id)!==i))];return{width:innerWidth,scrollWidth:document.documentElement.scrollWidth,buttons,duplicates}})()');
  assert.ok(data.scrollWidth<=data.width+1,label+' horizontal overflow '+JSON.stringify(data));assert.deepEqual(data.duplicates,[],label+' duplicate IDs');
  for(const b of data.buttons){assert.ok(b.tip.trim(),b.id+' lacks tooltip/reason');assert.ok(b.font>=16,b.id+' font below 16px');assert.ok(b.gameButton,b.id+' is not GameButton');assert.equal(b.cursor,b.disabled?'not-allowed':'pointer',b.id+' cursor');}
  check('readable GameButton and overflow audit '+label,data);
}
async function sceneButtonIds(win:BrowserWindowType):Promise<string[]>{return js(win,'[...document.querySelectorAll("#alchemyScene button[id]")].map(e=>e.id)');}
async function captureStableScene(win:BrowserWindowType):Promise<void>{
  const ids=await sceneButtonIds(win);assert.ok(ids.includes('alCounter')&&ids.includes('alGuest2')&&ids.includes('alOverview'));
  await js(win,'window.__alchemy0110Stable=Object.fromEntries('+JSON.stringify(ids)+'.map(id=>[id,document.getElementById(id)]))');check('alchemy scene node identities captured',{ids});
}
async function assertStableScene(win:BrowserWindowType):Promise<void>{
  const result=await js<{stable:boolean;missing:string[]}>(win,'(()=>{const entries=Object.entries(window.__alchemy0110Stable||{});return{stable:entries.every(([id,node])=>node===document.getElementById(id)&&node.isConnected),missing:entries.filter(([id,node])=>node!==document.getElementById(id)||!node.isConnected).map(([id])=>id)}})()');
  assert.equal(result.stable,true,'reflect/navigation replaced scene nodes '+JSON.stringify(result.missing));check('scene controls retain their DOM identity through route and worker updates');
}
type Route={id:string;tab?:'craft'|'sales'|'study';guest?:number;market?:boolean;overview?:boolean;workshop?:boolean};
async function visitRoute(win:BrowserWindowType,route:Route,label=route.id,returnToScene=true):Promise<void>{
  const s=await assertControl(win,route.id,true);await clickElement(win,route.id);
  await until(()=>js<boolean>(win,'!!document.getElementById("roomWorkspace")&&!document.getElementById("roomWorkspace").hidden'),'workspace route '+route.id);
  await until(()=>js<boolean>(win,'!!document.getElementById("roomBack")&&!document.getElementById("roomBack").hidden'),'room back route '+route.id);
  if(route.overview){await until(()=>js<boolean>(win,'!!document.getElementById("lifePanel-overview")&&!document.getElementById("lifePanel-overview").hidden'),'overview route '+route.id);}
  else if(route.tab){const panel='aPanel-'+route.tab;await until(()=>js<boolean>(win,'!!document.getElementById('+JSON.stringify(panel)+')&&!document.getElementById('+JSON.stringify(panel)+').hidden'),panel+' destination '+route.id);}
  if(route.market){const market=await js<{open:boolean;visible:boolean}>(win,'(()=>{const e=document.querySelector(".a-market");return{open:!!e?.open,visible:!!e&&!e.hidden&&!e.closest("[hidden]")}})()');assert.deepEqual(market,{open:true,visible:true},'supplies route must expose existing raw-material disclosure');}
  if(route.guest!==undefined){const order=await js<{visible:boolean;name:string;text:string}>(win,'(()=>{const who=document.getElementById('+JSON.stringify('aOrderWho'+route.guest)+'),article=who?.closest(".a-order"),r=article?.getBoundingClientRect(),c=document.querySelector(".popover-content")?.getBoundingClientRect();return{visible:!!article&&!!r&&!!c&&r.top>=c.top-.5&&r.bottom<=c.bottom+.5,name:who?.textContent?.trim()||"",text:article?.textContent?.trim()||""}})()');assert.ok(order.visible,'guest '+route.guest+' did not scroll to its actual order');assert.ok(order.name&&order.text.includes(order.name));check('guest scene route points to its existing authoritative order',{id:route.id,slot:route.guest,...order});}
  const detail=route.overview?await js<string>(win,'document.getElementById("lifePanel-overview")?.textContent?.trim().slice(0,160)||""'):await js<string>(win,'document.getElementById("roomWorkspaceTitle")?.textContent?.trim()||""');
  check('visible scene entrance '+route.id+' opens its expected existing detail',{label:s.label,tooltip:s.tip,tab:route.tab,guest:route.guest,overview:route.overview,workspaceTitle:detail});await auditVisibleControls(win,'route '+label);
  if(returnToScene){
    if(route.overview){await localClick(win,'lifeBack');await until(()=>js<boolean>(win,'document.getElementById("lifePanel")?.hidden===true'),'return from overview subpanel');}
    await localClick(win,'roomBack');await until(()=>js<boolean>(win,'!!document.getElementById("alchemyScene")&&!document.getElementById("alchemyScene").hidden'),'return to alchemy scene');await assertStableScene(win);
  }
}
async function routeAllExistingPages(win:BrowserWindowType,includeGuests:boolean):Promise<void>{
  const start=profile().sequence;
  const routes:Route[]=[
    {id:'alCounter',tab:'craft'},
    {id:'alSupplies',tab:'craft',market:true},
    {id:'alStill',tab:'craft'},
    {id:'alShelf',tab:'sales'},
    {id:'alStudy',tab:'study'},
    {id:'alRecipes',tab:'craft'},
    {id:'alOrders',tab:'sales'},
    {id:'alOverview',overview:true},
  ];
  if(includeGuests)routes.push({id:'alGuest0',tab:'sales',guest:0},{id:'alGuest1',tab:'sales',guest:1},{id:'alGuest2',tab:'sales',guest:2});
  if(await js<boolean>(win,'!document.getElementById("alBuddy").hidden'))routes.push({id:'alBuddy',overview:true,workshop:true});
  for(const route of routes)await visitRoute(win,route);
  assert.equal(profile().sequence,start,'read-only scene routes mutated profile');check('every reachable old Atelier and management page is available without economic mutation',{routes:routes.map(r=>r.id),sequence:start,atelierPresent:Object.hasOwn(profile(),'atelier')});
}
async function resizeScene(win:BrowserWindowType,width:number,height:number,label:string):Promise<void>{
  win.setSize(width,height);await new Promise(resolve=>setTimeout(resolve,180));assert.deepEqual(win.getSize(),[width,height],'requested hidden native test viewport');
  await capture(win,label,{width:Math.min(620,width-40),height:Math.min(500,height-40)});await auditVisibleControls(win,label);
}
async function backToScene(win:BrowserWindowType):Promise<void>{await localClick(win,'roomBack');await until(()=>js<boolean>(win,'!document.getElementById("roomWorkspace")||document.getElementById("roomWorkspace").hidden'),'workspace hidden');await until(()=>js<boolean>(win,'!!document.getElementById("alchemyScene")&&!document.getElementById("alchemyScene").hidden'),'scene shown');}
async function setProfileFieldForMotion(field:'workingElsewhere'|'mode'|'popup.suspended',value:unknown):Promise<void>{
  assert.ok(shell);const s=shell as any;
  if(field==='popup.suspended'){
    const base=shell.state();assert.ok(base.popup,'alchemy popup state missing');const simulated=structuredClone(base);simulated.popup!.suspended=value as boolean;
    popup().webContents.send('street:update',simulated);
    await until(()=>js<boolean>(popup(),'document.body.dataset.suspended==="true"&&document.getElementById("alchemyScene").dataset.motion==="paused"'),field+' simulated renderer state blocks motion');
    check('software renderer-state fixture pauses the shared motion helper',{field,value,windowVisible:popup().isVisible(),windowFocused:popup().isFocused(),fixture:'direct street:update delivery to the isolated renderer; main process continues to withhold real suspended-popup updates'});
    popup().webContents.send('street:update',base);
    await until(()=>js<boolean>(popup(),'document.body.dataset.suspended==="false"&&document.getElementById("alchemyScene").dataset.motion==="running"'),field+' restored renderer state resumes motion');
    check('restored software renderer-state fixture resumes local motion',{field,valueBefore:base.popup?.suspended,motion:await js(popup(),'document.getElementById("alchemyScene").dataset.motion'),fixture:'same-revision state push; no native focus'});return;
  }
  const old:unknown=s[field];s[field]=value;
  s.broadcast();
  try{await until(()=>js<boolean>(popup(),'document.getElementById("alchemyScene").dataset.motion==="paused"'),field+' blocks motion');check('software ShellState field pauses motion',{field,value,windowVisible:popup().isVisible(),windowFocused:popup().isFocused(),fixture:'private in-process ShellState mutation plus broadcast while popup is not suspended'});}
  finally{s[field]=old;s.broadcast();}
  await until(()=>js<boolean>(popup(),'document.getElementById("alchemyScene").dataset.motion==="running"'),field+' resume clears motion block');
  check('restored ShellState field resumes software-local motion',{field,valueBefore:old,motion:await js(popup(),'document.getElementById("alchemyScene").dataset.motion'),fixture:'in-process software state; no native focus'});
}
async function auditMotion(win:BrowserWindowType):Promise<void>{
  const initial=await js<{hidden:boolean;visibility:string;hasFocus:boolean;motion:string}>(win,'({hidden:document.hidden,visibility:document.visibilityState,hasFocus:document.hasFocus(),motion:document.getElementById("alchemyScene").dataset.motion})');
  check('renderer visibility/focus state sampled while the native window remains hidden before fixtures',initial,'INFO');assert.deepEqual({visible:win.isVisible(),focused:win.isFocused()},{visible:false,focused:false});
  const software=await js<{hidden:boolean;visibility:string;hasFocus:boolean}>(win,'(()=>{window.__alchemy0110SavedDocumentDescriptors=Object.fromEntries(["hidden","visibilityState","hasFocus"].map(k=>[k,Object.getOwnPropertyDescriptor(document,k)||null]));window.__alchemy0110HiddenFixture=false;Object.defineProperty(document,"hidden",{configurable:true,get:()=>window.__alchemy0110HiddenFixture===true});Object.defineProperty(document,"visibilityState",{configurable:true,get:()=>window.__alchemy0110HiddenFixture===true?"hidden":"visible"});Object.defineProperty(document,"hasFocus",{configurable:true,value:()=>false});return{hidden:document.hidden,visibility:document.visibilityState,hasFocus:document.hasFocus()}})()');
  let restored=false;
  try{
    await js(win,'document.getElementById("alchemyScene").dispatchEvent(new PointerEvent("pointerenter"))');
    await until(()=>js<boolean>(win,'document.getElementById("alchemyScene").dataset.motion==="running"'),'initial software hover runs without renderer focus');
    check('initial nonfocused software hover enables local scene motion',{document:software,motion:await js(win,'document.getElementById("alchemyScene").dataset.motion'),fixture:'synthetic PointerEvent and temporary document getters; hidden native window'});
    for(const [field,value] of [['workingElsewhere',true],['popup.suspended',true],['mode','hidden']] as const)await setProfileFieldForMotion(field,value);
    await js(win,'document.getElementById("alchemyScene").hidden=true');await until(()=>js<boolean>(win,'document.getElementById("alchemyScene").dataset.motion==="paused"'),'hidden scene ancestor pauses motion');
    await js(win,'document.getElementById("alchemyScene").hidden=false');await until(()=>js<boolean>(win,'document.getElementById("alchemyScene").dataset.motion==="running"'),'visible scene ancestor resumes motion');check('MutationObserver stops motion under hidden scene and restores it without polling');
    await js(win,'window.__alchemy0110HiddenFixture=true;document.dispatchEvent(new Event("visibilitychange"))');await until(()=>js<boolean>(win,'document.getElementById("alchemyScene").dataset.motion==="paused"'),'software document.hidden visibilitychange pauses motion');
    await js(win,'window.__alchemy0110HiddenFixture=false;document.dispatchEvent(new Event("visibilitychange"))');await until(()=>js<boolean>(win,'document.getElementById("alchemyScene").dataset.motion==="paused"'),'visibility restoration requires local re-entry without focus');
    await js(win,'document.getElementById("alchemyScene").dispatchEvent(new PointerEvent("pointerenter"))');await until(()=>js<boolean>(win,'document.getElementById("alchemyScene").dataset.motion==="running"'),'visibility restoration plus local re-entry resumes motion');check('software document.hidden/visibilitychange pauses motion and local re-entry restores it while unfocused');
    const debuggerApi=win.webContents.debugger,wasAttached=debuggerApi.isAttached();
    try{if(!wasAttached)debuggerApi.attach('1.3');await debuggerApi.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await until(()=>js<boolean>(win,'document.getElementById("alchemyScene").dataset.motion==="paused"'),'reduced motion pauses');await debuggerApi.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});await until(()=>js<boolean>(win,'document.getElementById("alchemyScene").dataset.motion==="running"'),'reduced motion restores');check('Chromium reduced-motion emulation pauses and restores shared helper');}
    finally{if(!wasAttached&&debuggerApi.isAttached())debuggerApi.detach();}
    await js(win,'window.dispatchEvent(new Event("blur"));document.getElementById("alchemyScene").dispatchEvent(new PointerEvent("pointerenter"));document.getElementById("alchemyScene").dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,isPrimary:true}));window.dispatchEvent(new Event("focus"))');
    const afterUntrusted=await js<string>(win,'document.getElementById("alchemyScene").dataset.motion');assert.equal(afterUntrusted,'paused','software enter/down/focus cannot clear blur latch when hasFocus is false');
    await setProfileFieldForMotion('workingElsewhere',true);await js(win,'document.getElementById("alchemyScene").dispatchEvent(new PointerEvent("pointerenter"))');
    await until(()=>js<boolean>(win,'document.getElementById("alchemyScene").dataset.motion==="running"'),'authoritative resume clears blur latch');check('untrusted enter/down/focus cannot resume after blur; authoritative ShellState resume can',{afterUntrusted,motion:await js(win,'document.getElementById("alchemyScene").dataset.motion'),fixture:'software DOM events and ShellState broadcasts'});
  }finally{
    await js(win,'(()=>{for(const [k,d] of Object.entries(window.__alchemy0110SavedDocumentDescriptors||{})){if(d)Object.defineProperty(document,k,d);else delete document[k]}delete window.__alchemy0110SavedDocumentDescriptors;delete window.__alchemy0110HiddenFixture;document.dispatchEvent(new Event("visibilitychange"));return{hidden:document.hidden,visibility:document.visibilityState,hasFocus:document.hasFocus()}})()');restored=true;
  }
  assert.ok(restored);assert.equal(win.isVisible(),false);assert.equal(win.isFocused(),false);check('temporary renderer document.hidden/visibilityState/hasFocus getters restored; native window still hidden/unfocused',{restored,native:{visible:win.isVisible(),focused:win.isFocused()}});
}
async function withSoftwareVisible<T>(win:BrowserWindowType,label:string,body:()=>Promise<T>):Promise<T>{
  const original=await js<{hidden:boolean;visibility:string;hasFocus:boolean}>(win,'(()=>{window.__alchemy0110SavedDocumentDescriptors=Object.fromEntries(["hidden","visibilityState","hasFocus"].map(k=>[k,Object.getOwnPropertyDescriptor(document,k)||null]));Object.defineProperty(document,"hidden",{configurable:true,get:()=>window.__alchemy0110HiddenFixture===true});Object.defineProperty(document,"visibilityState",{configurable:true,get:()=>window.__alchemy0110HiddenFixture===true?"hidden":"visible"});Object.defineProperty(document,"hasFocus",{configurable:true,value:()=>false});window.__alchemy0110HiddenFixture=false;return{hidden:document.hidden,visibility:document.visibilityState,hasFocus:document.hasFocus()}})()');
  try{await js(win,'document.dispatchEvent(new Event("visibilitychange"));document.getElementById("alchemyScene").dispatchEvent(new PointerEvent("pointerenter"))');await until(()=>js<boolean>(win,'document.getElementById("alchemyScene").dataset.motion==="running"'),label+' scene motion');const result=await body();check(label+' used software visible document state while native window stayed hidden',{document:original,native:{visible:win.isVisible(),focused:win.isFocused()},fixture:'synthetic visibilitychange/pointerenter and temporary document getters; not physical input'});return result;}
  finally{await js(win,'(()=>{for(const [k,d] of Object.entries(window.__alchemy0110SavedDocumentDescriptors||{})){if(d)Object.defineProperty(document,k,d);else delete document[k]}delete window.__alchemy0110SavedDocumentDescriptors;delete window.__alchemy0110HiddenFixture;document.dispatchEvent(new Event("visibilitychange"));return true})()');assert.equal(win.isVisible(),false);assert.equal(win.isFocused(),false);}
}
async function assertHiddenBoundary():Promise<void>{
  for(const win of BrowserWindow.getAllWindows()){assert.equal(win.isVisible(),false,'native window visible '+win.id);assert.equal(win.isFocused(),false,'native window focused '+win.id);}
  const skipped:number[]=[];
  for(const win of BrowserWindow.getAllWindows()){
    if(win.isDestroyed()||win.webContents.isDestroyed()||!page(win)){skipped.push(win.id);continue;}
    await instrument(win);const observed=await js<{keys:number;csp:unknown[]}>(win,'({keys:window.__alchemy0110Keys||0,csp:window.__alchemy0110Csp||[]})');
    keyboardByWindow[win.id]=observed.keys;cspByWindow[win.id]=[...(cspByWindow[win.id]??[]),...observed.csp.map(String)];
  }
  assert.equal(Object.values(keyboardByWindow).reduce((n,v)=>n+v,0),0,'renderer keyboard events observed');assert.equal(Object.values(cspByWindow).reduce((n,v)=>n+v.length,0),0,'CSP violations observed');assert.equal(suppression.globalShortcut??0,0,'globalShortcut was invoked');
  check('all native windows hidden and unfocused; zero keyboard events, CSP violations and global shortcuts',{nativeWindows:snapshots(),suppression,keyboardByWindow,cspByWindow,skipped});
}
async function motionActionPulse(win:BrowserWindowType):Promise<void>{
  await withSoftwareVisible(win,'scene action feedback pulse',async()=>{
    await actionClick(win,'alOpen');
    const animations=await js<number>(win,'document.getElementById("alFeedback").getAnimations().length');assert.ok(animations>0,'authoritative scene action did not produce a local feedback pulse');
    await js(win,'window.__alchemy0110HiddenFixture=true;document.dispatchEvent(new Event("visibilitychange"))');await until(()=>js<boolean>(win,'document.getElementById("alchemyScene").dataset.motion==="paused"'),'software visibility pauses action feedback');
    const afterPause=await js<number>(win,'document.getElementById("alFeedback").getAnimations().length');assert.equal(afterPause,0,'motion pause must cancel the current feedback pulse');
    await js(win,'window.__alchemy0110HiddenFixture=false;document.dispatchEvent(new Event("visibilitychange"));document.getElementById("alchemyScene").dispatchEvent(new PointerEvent("pointerenter"))');await until(()=>js<boolean>(win,'document.getElementById("alchemyScene").dataset.motion==="running"'),'software visibility restore resumes after local re-entry');
    check('authoritative action pulse starts locally and software visibilitychange cancels and restores it',{animations,afterPause,profile:{open:profile().atelier?.open.alchemy,notice:profile().notice},fixture:'software document.hidden/visibilityState getter and visibilitychange; native window remains hidden'});
  });
}
async function auditShellLifecycle(win:BrowserWindowType):Promise<void>{
  assert.ok(shell);app.emit('did-resign-active');await until(()=>shell!.state().workingElsewhere===true&&shell!.state().popup?.suspended===true,'main ShellState reports hidden-popup suspension');
  assert.equal(win.isVisible(),false);assert.equal(win.isFocused(),false);check('software main-process resign state suspends the popup without delivering an intermediate suspended snapshot',{workingElsewhere:shell.state().workingElsewhere,popupSuspended:shell.state().popup?.suspended,native:{visible:win.isVisible(),focused:win.isFocused()},boundary:'synthetic Electron lifecycle event; hidden popup does not receive Shell.broadcast while suspended'});
  await js(win,'(()=>{window.__alchemy0110UpdateCount=0;window.street.subscribe(()=>window.__alchemy0110UpdateCount++);return true})()');const updatesBefore=await js<number>(win,'window.__alchemy0110UpdateCount');
  app.emit('did-become-active');shell.enter();await until(()=>shell!.state().workingElsewhere===false&&shell!.state().popup?.suspended===false,'main ShellState reports resumed popup');
  await until(()=>js<boolean>(win,'window.__alchemy0110UpdateCount>'+updatesBefore+'&&document.body.dataset.suspended==="false"'),'renderer receives final resumed snapshot');assert.equal(win.isVisible(),false);assert.equal(win.isFocused(),false);
  check('software main-process resume sends the final state while native activation remains suppressed',{workingElsewhere:shell.state().workingElsewhere,popupSuspended:shell.state().popup?.suspended,rendererUpdates:await js<number>(win,'window.__alchemy0110UpdateCount'),native:{visible:win.isVisible(),focused:win.isFocused()},fixture:'direct Electron app lifecycle plus DesktopShell.enter; no real OS switch'});
}
function makeBase(now:number):Profile{
  const p=initialProfile(now);
  if(scenario==='visitor')return parseProfile(p);
  p.job='keeper';p.coins=scenario==='reward-cap'?999_999_500:2_000_000;p.bag.flour=2_000;p.bag.gel=20;
  if(scenario!=='rich'&&scenario!=='reward-cap')return parseProfile(p);
  p.xp=900;p.business.till=97;p.business.managed=true;
  p.leisure.clears=[1,1,1,1,1];p.leisure.materials.herb=2_000;p.leisure.materials.berry=2_000;p.leisure.materials.mushroom=2_000;
  p.leisure.materials.ore=5_000;p.leisure.materials.pumpkin=1_000;p.leisure.materials.snowflower=1_000;p.leisure.materials.biscuit=500;p.leisure.journal.dust=500;
  p.leisure.companions.guide=0;p.camp=initialCamp();p.camp.jobs.workshop='guide';
  if(p.leisure.plots[0]===null)p.leisure.plots[0]={crop:'herb',due:p.tick+100_000};
  const a=initialAtelier();a.till=321;
  for(const good of GOOD_IDS){a.stock[good]=200;a.made[good]=20;a.shelves[good]={stock:1,quote:'normal',due:p.tick+QUOTES.normal.ticks};}
  a.made.ink=10;p.atelier=a;
  if(scenario==='reward-cap'){
    const order=stableAtelierOrder(p,'alchemy',0);p.coins=1_000_000_000-order.coins+1;
  }
  return parseProfile(p);
}
const ALCHEMY_GOODS=GOOD_IDS.filter(g=>FORMULAS[g].station==='alchemy');
function expectedVisibleGoods(p:Profile):Good[]{return ALCHEMY_GOODS.filter(g=>p.atelier!.shelves[g].stock>0);}
async function assertGuests(win:BrowserWindowType,keeper:boolean):Promise<void>{
  const ids=['alGuest0','alGuest1','alGuest2'];const state=await js<Array<{id:string;hidden:boolean;ready:string;label:string}>>(win,'['+ids.map(id=>'(()=>{const e=document.getElementById('+JSON.stringify(id)+');return{id:'+JSON.stringify(id)+',hidden:e.hidden||!!e.closest("[hidden]"),ready:e.dataset.ready||"",label:e.dataset.tooltip||""}})()').join(',')+']');
  assert.equal(state.length,3);for(const guest of state){assert.equal(guest.hidden,!keeper,guest.id+' visibility follows real keeper role');if(!keeper)assert.equal(guest.ready,'false');else assert.match(guest.label,/待接取|已接取/);}
  check('three alchemy visitor NPCs reflect role and current real order state',{keeper,state});
}
async function visitorScenario():Promise<void>{
  const before=structuredClone(profile());assert.equal(before.job,'visitor');assert.equal(Object.hasOwn(before,'atelier'),false);let win=await openAlchemy();
  await assertGuests(win,false);await disabledControl(win,'alOpen',/任职/);await disabledHoverStyles(win,'alOpen',/任职/);await disabledControl(win,'alCollect',/任职|暂无/);
  await resizeScene(win,760,650,'visitor-scene-760x650');await resizeScene(win,1040,650,'visitor-scene-1040x650');win.setSize(760,650);await captureStableScene(win);
  await routeAllExistingPages(win,false);assert.deepEqual(profile(),advance(before,profile().wallAt),'visitor read-only scene must not alter profile beyond worker clock or initialize Atelier');
  win.setSize(760,650);await new Promise(resolve=>setTimeout(resolve,180));
  const unhiredBefore=structuredClone(profile());await visitRoute(win,{id:'alSupplies',tab:'craft',market:true},'unhired alchemy materials and recipe',false);await openMarket(win);
  await capture(win,'visitor-unhired-market-760',{width:620,height:500});await selectGood(win,'dew');
  const selection=await js<{name:string;art:string;herbNeed:string;marketCount:string}>(win,'({name:document.getElementById("aName").textContent.trim(),art:document.getElementById("aHeroArt").dataset.art,herbNeed:document.getElementById("aNeedCount-herb").textContent.trim(),marketCount:document.getElementById("aMarketStock-herb").textContent.trim()})');
  assert.deepEqual(selection,{name:FORMULAS.dew.name,art:'dew',herbNeed:`${profile().leisure.materials.herb} / 10`,marketCount:String(profile().leisure.materials.herb)},'visitor can inspect recipe needs and actual raw-material stock without buying');
  await disabledControl(win,'aBuy1-herb',/任职试餐/);await disabledControl(win,'aCraft',/任职试餐/);
  const disabledSequence=profile().sequence;await clickElement(win,'aBuy1-herb');await clickElement(win,'aCraft');assert.equal(profile().sequence,disabledSequence,'disabled visitor purchase/craft does not submit an action');
  const alBuyGeneration=shell!.popup!.generation,sequence=profile().sequence+1;
  const rejectedPurchase=await js<string>(win,'window.street.command({type:"game",generation:'+alBuyGeneration+',envelope:{sequence:'+sequence+',requestId:crypto.randomUUID(),action:{type:"atelier-buy",item:"herb",count:1}}}).then(()=>"accepted").catch(e=>String(e))');
  assert.match(rejectedPurchase,/任职试餐/);assert.equal(profile().sequence,sequence-1);assert.equal(Object.hasOwn(profile(),'atelier'),false);
  check('unhired alchemy ingredient purchase is rejected by the real worker without initializing Atelier',{selection,rejectedPurchase,sequence:profile().sequence,atelierPresent:Object.hasOwn(profile(),'atelier'),input:'renderer local clicks plus real street IPC; no physical input'});
  assert.deepEqual(profile(),advance(unhiredBefore,profile().wallAt),'unhired ingredient browsing changed profile beyond worker time');await backToScene(win);
  const generation=shell!.popup!.generation,seq=profile().sequence;
  const rejected=await js<string>(win,'window.street.command({type:"game",generation:'+generation+',envelope:{sequence:'+(seq+1)+',requestId:crypto.randomUUID(),action:{type:"atelier-open",station:"alchemy",open:true}}}).then(()=>"accepted").catch(e=>String(e))');
  assert.match(rejected,/任职试餐/);assert.equal(profile().sequence,seq);assert.equal(Object.hasOwn(profile(),'atelier'),false);check('direct worker request for visitor alchemy opening is rejected without mutation',{rejected,sequence:seq,atelierPresent:Object.hasOwn(profile(),'atelier'),boundary:'software IPC call; no DOM disabled button bypass or physical input'});
  const saved=structuredClone(profile());await clickElement(win,'popupClose');await until(()=>shell?.popup===null,'close visitor alchemy');win=await openAlchemy();assert.deepEqual(profile(),advance(saved,profile().wallAt),'popup close/reopen changed the legacy profile beyond worker clock');await capture(win,'visitor-after-reopen');check('visitor popup close/reopen preserves legacy profile beyond ordinary worker time',{sequence:profile().sequence,atelierPresent:Object.hasOwn(profile(),'atelier')});
}
async function keeperScenario():Promise<void>{
  const before=structuredClone(profile());assert.equal(before.job,'keeper');assert.equal(Object.hasOwn(before,'atelier'),false);let win=await openAlchemy();await assertGuests(win,true);
  assert.ok(await js<boolean>(win,'document.getElementById("alBuddy").hidden'),'keeper without workshop job must not invent a companion');await routeAllExistingPages(win,true);
  assert.equal(Object.hasOwn(profile(),'atelier'),false,'read-only route traversal initialized Atelier');await disabledControl(win,'alCollect',/暂无/);await disabledHoverStyles(win,'alCollect',/暂无/);await assertControl(win,'alOpen',true);
  await resizeScene(win,760,650,'keeper-scene-760x650');await resizeScene(win,1040,650,'keeper-scene-1040x650');win.setSize(760,650);
  await actionClick(win,'alOpen');assert.equal(profile().atelier?.open.alchemy,true,'explicit open action initializes and opens Atelier');assert.equal(Object.hasOwn(profile(),'atelier'),true);check('explicit player open is the first action that creates the optional Atelier extension',{sequence:profile().sequence,open:profile().atelier?.open.alchemy,profileBeforeAbsent:true});
  await actionClick(win,'alOpen');assert.equal(profile().atelier?.open.alchemy,false);const saved=structuredClone(profile());await clickElement(win,'popupClose');await until(()=>shell?.popup===null,'close keeper alchemy');win=await openAlchemy();assert.deepEqual(profile(),saved);await capture(win,'keeper-after-reopen');check('keeper open/close/reopen preserves the explicit extension and closed state',{open:profile().atelier?.open.alchemy,sequence:profile().sequence});
}
async function assertShelfInventory(win:BrowserWindowType,label:string):Promise<void>{
  const state=await js<{goods:string[];visible:string[];counts:Record<string,string>}>(win,'(()=>{const all=[...document.querySelectorAll("[data-shelf-good]")];return{goods:all.map(e=>e.getAttribute("data-shelf-good")),visible:all.filter(e=>!e.hidden).map(e=>e.getAttribute("data-shelf-good")),counts:Object.fromEntries(all.map(e=>[e.getAttribute("data-shelf-good"),e.getAttribute("data-count")||""]))}})()');
  assert.deepEqual(state.goods,[...ALCHEMY_GOODS]);assert.deepEqual(state.visible.sort(),expectedVisibleGoods(profile()).sort(),label+' displayed shelf goods do not match worker inventory');
  check('visible shelf goods and counts match actual alchemy stock '+label,{state,expected:expectedVisibleGoods(profile()),workerStock:profile().atelier?.shelves});
}
async function selectGood(win:BrowserWindowType,good:Good):Promise<void>{await localClick(win,'aPick-'+good);const selected=await js<boolean>(win,'document.getElementById('+JSON.stringify('aPick-'+good)+')?.getAttribute("aria-pressed")==="true"');assert.ok(selected,good+' recipe selection did not update');}
async function atelierTab(win:BrowserWindowType,tab:'craft'|'sales'|'study'):Promise<void>{
  const id='aTab-'+tab,panel='aPanel-'+tab;await localClick(win,id);await until(()=>js<boolean>(win,'!!document.getElementById('+JSON.stringify(panel)+')&&!document.getElementById('+JSON.stringify(panel)+').hidden'),panel+' visible');
}
async function openMarket(win:BrowserWindowType):Promise<void>{
  await js(win,'(()=>{const d=document.querySelector(".a-market");if(!d)return false;if(!d.open)d.open=true;d.scrollIntoView({block:"nearest"});return d.open})()');
  await until(()=>js<boolean>(win,'document.querySelector(".a-market")?.open===true'),'alchemy raw-material market open');
}
function reagentOwned(reagent:string):number{
  const p=profile();
  if(reagent==='dust')return p.leisure.journal.dust;
  if(reagent==='flour'||reagent==='gel')return p.bag[reagent];
  return p.leisure.materials[reagent as keyof Profile['leisure']['materials']];
}
async function auditSelectedAlchemyGood(win:BrowserWindowType,good:Good):Promise<void>{
  const formula=FORMULAS[good],before=profile().sequence;
  const ids=ALCHEMY_GOODS.map(g=>'aPick-'+g);
  const nodesExist=await js<boolean>(win,'(()=>{window.__alchemy0110PickNodes=Object.fromEntries('+JSON.stringify(ids)+'.map(id=>[id,document.getElementById(id)]));return Object.values(window.__alchemy0110PickNodes).every(Boolean)})()');
  assert.equal(nodesExist,true,'all six selectable alchemy recipes must remain in the catalog');
  await selectGood(win,good);
  const selected=await js<{name:string;use:string;hero:string;pressed:string[];quantity:number;visibleNeeds:string[];hiddenNeeds:string[];needDisplay:Record<string,string>;sameNodes:boolean}>(win,'(()=>{const buttons=[...document.querySelectorAll(".a-quantities button[aria-pressed=true]")],needs=[...document.querySelectorAll("[id^=aNeed-]")].filter(e=>e.id.startsWith("aNeed-")&&!e.id.startsWith("aNeedCount-"));return{name:document.getElementById("aName")?.textContent?.trim()||"",use:document.getElementById("aUseDescription")?.textContent?.trim()||"",hero:document.getElementById("aHeroArt")?.dataset.art||"",pressed:'+JSON.stringify(ids)+'.filter(id=>document.getElementById(id)?.getAttribute("aria-pressed")==="true"),quantity:Number(document.querySelector(".a-quantities button[aria-pressed=true]")?.id.slice("aQty".length)||0),visibleNeeds:needs.filter(e=>!e.hidden).map(e=>e.id.slice("aNeed-".length)).sort(),hiddenNeeds:needs.filter(e=>e.hidden&&getComputedStyle(e).display!=="none").map(e=>e.id),needDisplay:Object.fromEntries(needs.filter(e=>!e.hidden).map(e=>[e.id.slice("aNeed-".length),document.getElementById("aNeedCount-"+e.id.slice("aNeed-".length))?.textContent?.trim()||""])),sameNodes:Object.entries(window.__alchemy0110PickNodes||{}).every(([id,node])=>node===document.getElementById(id)&&node.isConnected)}})()');
  assert.equal(selected.name,formula.name,good+' choice must update the large selected name');
  assert.equal(selected.use,formula.use,good+' choice must update its use decision');
  assert.equal(selected.hero,good,good+' choice must update the main product art');
  assert.deepEqual(selected.pressed,['aPick-'+good],good+' must be the only selected recipe');
  assert.ok(selected.quantity>=1,'selected batch size must stay explicit');
  const expectedNeeds=Object.entries(formula.cost).filter(([,amount])=>amount>0).map(([reagent])=>reagent).sort();
  assert.deepEqual(selected.visibleNeeds,expectedNeeds,good+' must show exactly its own materials');
  assert.deepEqual(selected.hiddenNeeds,[],good+' unrelated materials must remain hidden under computed CSS');
  for(const [reagent,amount]of Object.entries(formula.cost))assert.equal(selected.needDisplay[reagent],`${reagentOwned(reagent)} / ${amount!*selected.quantity}`,good+' owned/needed count for '+reagent);
  assert.equal(selected.sameNodes,true,'recipe selection must preserve chooser button identities');
  await atelierTab(win,'sales');
  const sale=await js<{visible:boolean;art:string;stock:string;prices:Record<string,string>}>(win,'(()=>({visible:!document.getElementById("aPanel-sales").hidden,art:document.getElementById("aShelfArt")?.dataset.art||"",stock:document.getElementById("aShelfStock")?.textContent?.trim()||"",prices:Object.fromEntries(["quick","normal","premium"].map(q=>[q,document.getElementById("aPriceText-"+q)?.textContent?.trim()||""]))}))()');
  assert.equal(sale.visible,true);assert.equal(sale.art,good);assert.ok(sale.stock.includes(formula.name));
  for(const quote of ['quick','normal','premium'] as const){const seconds=QUOTES[quote].ticks/10,clock=seconds>=60?`${Math.floor(seconds/60)}分${seconds%60?`${seconds%60}秒`:''}`:`${seconds}秒`;assert.equal(sale.prices[quote],`${atelierPrice(good,quote)+jobPower(profile(),'counter')}金币 / ${clock}`,good+' selected shelf quote '+quote);}
  await atelierTab(win,'study');
  const study=await js<{visible:boolean;mastery:string;facilityLevels:Record<string,string>;tiers:string[]}>(win,'(()=>({visible:!document.getElementById("aPanel-study").hidden,mastery:document.getElementById("aMasteryCount")?.textContent?.trim()||"",facilityLevels:Object.fromEntries(["still","counter"].map(k=>[k,document.getElementById("aFacilityPips-"+k)?.dataset.level||""])),tiers:[0,1,2].map(i=>document.getElementById("aMasteryTier"+i)?.dataset.claimed||"")}))()');
  assert.equal(study.visible,true);assert.equal(study.mastery,`${formula.name} · 累计制作 ${profile().atelier!.made[good]}份 · 手记 ${profile().atelier!.claimed[good]}/3`);assert.deepEqual(study.tiers,[0,1,2].map(i=>String(i<profile().atelier!.claimed[good])));
  assert.equal(study.facilityLevels.still,String(profile().atelier!.facilities.still));assert.equal(study.facilityLevels.counter,String(profile().atelier!.facilities.counter));
  await atelierTab(win,'craft');assert.equal(profile().sequence,before,'selecting a product and changing page must not submit an economy action');
  check('selected alchemy recipe updates its materials, workbench, shelf quotes and journal without replacing chooser nodes',{good,name:selected.name,needs:selected.visibleNeeds,prices:sale.prices,mastery:study.mastery,facilityLevels:study.facilityLevels,sequence:profile().sequence});
}
async function auditAlchemyTypography(win:BrowserWindowType,label:string):Promise<void>{
  const small=await js<Array<{id:string;tag:string;font:number;text:string}>>(win,'(()=>[...document.querySelectorAll("#roomWorkspace:not([hidden]) .trade-workspace button,#roomWorkspace:not([hidden]) .trade-workspace h2,#roomWorkspace:not([hidden]) .trade-workspace h3,#roomWorkspace:not([hidden]) .trade-workspace p,#roomWorkspace:not([hidden]) .trade-workspace .tw-stock-label,#roomWorkspace:not([hidden]) .trade-workspace .tw-price-tag,#roomWorkspace:not([hidden]) .trade-workspace .tw-ingredient,#roomWorkspace:not([hidden]) .trade-workspace .tw-time-board,#roomWorkspace:not([hidden]) .trade-workspace .tw-reward")].filter(e=>e.getClientRects().length&&!e.closest("[hidden]")&&getComputedStyle(e).display!=="none"&&e.textContent.trim()&&parseFloat(getComputedStyle(e).fontSize)<16).map(e=>({id:e.id||"",tag:e.tagName,font:parseFloat(getComputedStyle(e).fontSize),text:e.textContent.trim().slice(0,80)})))()');
  assert.deepEqual(small,[],label+' visible decision text below 16px');check('alchemy page decision text remains readable '+label,{minimumFont:16,small});
}
async function captureAlchemyPages(win:BrowserWindowType):Promise<void>{
  const before=profile().sequence;
  for(const width of [760,1040]){
    win.setSize(width,650);await new Promise(resolve=>setTimeout(resolve,180));assert.deepEqual(win.getSize(),[width,650],'hidden alchemy workspace viewport');
    for(const tab of ['craft','sales','study'] as const){
      await atelierTab(win,tab);
      const state=await js<{tab:string;visible:string[];newWorkbench:boolean;legacyTables:number}>(win,'(()=>({tab:document.getElementById("atelierUi").dataset.tab,visible:["craft","sales","study"].filter(t=>!document.getElementById("aPanel-"+t).hidden),newWorkbench:!!document.querySelector(".tw-atelier-layout")&&(document.getElementById("atelierUi").dataset.tab!=="craft"||!!document.querySelector("#aPanel-craft .tw-workbench")),legacyTables:document.querySelectorAll("#roomWorkspace .trade-workspace table").length}))()');
      assert.equal(state.tab,tab);assert.deepEqual(state.visible,[tab],'only the selected internal page should be shown');assert.ok(state.newWorkbench,tab+' should use the new object-based workbench');assert.equal(state.legacyTables,0,'alchemy workspace must not fall back to a legacy text table');
      await auditVisibleControls(win,'alchemy '+tab+' '+width);await auditAlchemyTypography(win,'alchemy '+tab+' '+width+' top');
      await js(win,'document.querySelector(".popover-content").scrollTop=0');await capture(win,'alchemy-'+tab+'-'+width+'-top',{width:620,height:500});
      const scroll=await js<number>(win,'(()=>{const e=document.querySelector(".popover-content");return e.scrollHeight-e.clientHeight})()');
      if(scroll>4){await js(win,'(()=>{const e=document.querySelector(".popover-content");e.scrollTop=e.scrollHeight})()');await auditVisibleControls(win,'alchemy '+tab+' '+width+' bottom');await auditAlchemyTypography(win,'alchemy '+tab+' '+width+' bottom');await capture(win,'alchemy-'+tab+'-'+width+'-bottom',{width:620,height:500});}
      if(tab==='craft'){
        await js(win,'document.querySelector(".popover-content").scrollTop=0');
        for(const good of ALCHEMY_GOODS)await auditSelectedAlchemyGood(win,good);
        if(width===760)await capture(win,'alchemy-selected-frost-760',{width:620,height:500});
        else{await auditSelectedAlchemyGood(win,'dew');await capture(win,'alchemy-selected-dew-1040',{width:620,height:500});}
      }
    }
  }
  await atelierTab(win,'craft');assert.equal(profile().sequence,before,'page navigation and recipe selection must remain presentation-only');
}
async function advanceWorker(ms:number,label:string):Promise<Profile>{
  assert.ok(shell);const before=profile(),result=await shell.game.request('advance',{ms});assert.ok(result.profile);await new Promise(resolve=>setTimeout(resolve,70));
  check('worker-only economic test clock '+label,{ms,tickBefore:before.tick,tickAfter:result.profile.tick,sequenceBefore:before.sequence,sequenceAfter:result.profile.sequence,input:'GameRuntime test clock; not elapsed user time'});return result.profile;
}
async function auditStaleBatchId(win:BrowserWindowType):Promise<void>{
  await selectGood(win,'ingot');await localClick(win,'aQty1');
  const initialInputs={ore:profile().leisure.materials.ore,gel:profile().bag.gel};
  const waitForQueueCancel=async(label:string):Promise<void>=>{
    let last:unknown;
    try{await until(async()=>{last=await js(win,'(()=>{const row=document.getElementById("aQueue0"),button=document.getElementById("aCancel0");return{rowHidden:!row||row.hidden,disabled:!button||button.disabled,tooltip:button?.dataset.tooltip||"",queue:document.getElementById("aQueueText0")?.textContent?.trim()||""}})()');return !!last&&!((last as any).rowHidden||(last as any).disabled);},label);}
    catch(error){throw new Error(`${String(error)}; last renderer queue state=${JSON.stringify(last)}; worker queue=${JSON.stringify(profile().atelier!.queues.alchemy[0])}`);}
    check('rendered cancellation control reflects the committed worker queue',{label,renderer:last,workerQueue:profile().atelier!.queues.alchemy[0]});
  };
  const first=await actionClick(win,'aCraft'),firstBatch=first.atelier!.queues.alchemy[0];assert.ok(firstBatch);const staleId=firstBatch.id;assert.equal(profile().leisure.materials.ore,initialInputs.ore-4);assert.equal(profile().bag.gel,initialInputs.gel-1);await waitForQueueCancel('first alchemy batch cancellation enabled after worker-to-renderer refresh');
  await actionClick(win,'aCancel0');assert.equal(profile().atelier!.queues.alchemy.length,0);assert.equal(profile().leisure.materials.ore,initialInputs.ore);assert.equal(profile().bag.gel,initialInputs.gel,'cancel returns all unused ingredients');
  await selectGood(win,'ink');await actionClick(win,'aCraft');const next=profile().atelier!.queues.alchemy[0];assert.ok(next);assert.notEqual(next.id,staleId);await waitForQueueCancel('replacement batch cancellation enabled after worker-to-renderer refresh');
  const generation=shell!.popup!.generation,sequence=profile().sequence+1;
  const rejected=await js<string>(win,'window.street.command({type:"game",generation:'+generation+',envelope:{sequence:'+sequence+',requestId:crypto.randomUUID(),action:{type:"atelier-cancel",station:"alchemy",position:0,id:'+staleId+'}}}).then(()=>"accepted").catch(e=>String(e))');
  assert.match(rejected,/队列已变化/);assert.equal(profile().sequence,sequence-1);assert.equal(profile().atelier!.queues.alchemy[0].id,next.id);
  check('reused queue position rejects the stale batch identity without mutation',{staleId,currentId:next.id,rejected,sequence:profile().sequence});await actionClick(win,'aCancel0');assert.equal(profile().atelier!.queues.alchemy.length,0);
}
async function orderCycle(win:BrowserWindowType):Promise<void>{
  await visitRoute(win,{id:'alOrders',tab:'sales'},'authoritative order controls',false);
  for(let slot=0;slot<3;slot++){
    const order=stableAtelierOrder(profile(),'alchemy',slot),before={coins:profile().coins,dust:profile().leisure.journal.dust,stock:profile().atelier!.stock[order.good],revision:profile().atelier!.orders.alchemy[slot].revision};
    await actionClick(win,'aAccept'+slot,slot===0);assert.equal(profile().atelier!.orders.alchemy[slot].accepted,true);
    await actionClick(win,'aDeliver'+slot,slot===0);assert.equal(profile().atelier!.orders.alchemy[slot].revision,before.revision+1);assert.equal(profile().atelier!.orders.alchemy[slot].accepted,false);
    assert.equal(profile().coins, before.coins+order.coins);assert.equal(profile().leisure.journal.dust,before.dust+1);assert.equal(profile().atelier!.stock[order.good],before.stock-order.count);
    const next=stableAtelierOrder(profile(),'alchemy',slot);await actionClick(win,'aAccept'+slot);assert.equal(profile().atelier!.orders.alchemy[slot].accepted,true);await actionClick(win,'aAbandon'+slot);assert.equal(profile().atelier!.orders.alchemy[slot].accepted,false);assert.equal(profile().atelier!.orders.alchemy[slot].revision,next.revision);
    check('alchemy order accept/deliver/reaccept/abandon '+slot,{firstOrder:order,nextOrder:next,revisionBefore:before.revision,revisionAfter:profile().atelier!.orders.alchemy[slot].revision,acceptedAfter:false,exactCoins:order.coins,exactDust:1});
  }
}
async function richScenario():Promise<void>{
  assert.equal(profile().job,'keeper');assert.ok(profile().atelier);let win=await openAlchemy();await assertGuests(win,true);assert.deepEqual(await js<string>(win,'document.getElementById("alBuddyName").textContent.trim()'),'提灯旅人 · 工坊');assert.equal(await js<boolean>(win,'document.getElementById("alBuddy").hidden'),false);
  await captureStableScene(win);await resizeScene(win,760,650,'rich-scene-760x650');await resizeScene(win,1040,650,'rich-scene-1040x650');win.setSize(760,650);await assertShelfInventory(win,'initial six-item shelf');
  await auditVisibleControls(win,'rich scene first view');const routesBefore=profile().sequence;await routeAllExistingPages(win,true);assert.equal(profile().sequence,routesBefore);

  await visitRoute(win,{id:'alRecipes',tab:'craft'},'alchemy internal pages and recipe selector',false);await captureAlchemyPages(win);await backToScene(win);await assertStableScene(win);

  await visitRoute(win,{id:'alSupplies',tab:'craft',market:true},'raw-material procurement',false);
  const coinsBefore=profile().coins,herbBefore=profile().leisure.materials.herb;await actionClick(win,'aBuy10-herb',true);assert.equal(profile().coins,coinsBefore-30);assert.equal(profile().leisure.materials.herb,herbBefore+10);await backToScene(win);await assertStableScene(win);

  await visitRoute(win,{id:'alStill',tab:'craft'},'still production',false);await selectGood(win,'dew');await localClick(win,'aQty1');
  const inputBefore={herb:profile().leisure.materials.herb,gel:profile().bag.gel,made:profile().atelier!.made.dew,sequence:profile().sequence};
  await actionClick(win,'aCraft',true);const queued=profile().atelier!.queues.alchemy[0];assert.ok(queued);assert.equal(queued.good,'dew');assert.equal(queued.remaining,1);assert.equal(profile().leisure.materials.herb,inputBefore.herb-2);assert.equal(profile().bag.gel,inputBefore.gel-1);
  await advanceWorker(25_000,'finish one dew recipe');assert.equal(profile().atelier!.queues.alchemy.length,0);assert.equal(profile().atelier!.stock.dew,201);assert.equal(profile().atelier!.made.dew,inputBefore.made+1);await assertShelfInventory(win,'post-production real inventory');
  await auditStaleBatchId(win);await backToScene(win);await assertStableScene(win);

  await visitRoute(win,{id:'alStudy',tab:'study'},'recipe journal',false);const inkBefore={coins:profile().coins,dust:profile().leisure.journal.dust,claimed:profile().atelier!.claimed.ink};await selectGood(win,'ink');await actionClick(win,'aMastery');
  assert.equal(profile().atelier!.claimed.ink,inkBefore.claimed+1);assert.equal(profile().coins,inkBefore.coins+15);assert.equal(profile().leisure.journal.dust,inkBefore.dust+1);await disabledControl(win,'aMastery',/累计制作|手记/);check('recipe journal first milestone claims its exact coin and dust reward',{before:inkBefore,after:{claimed:profile().atelier!.claimed.ink,coins:profile().coins,dust:profile().leisure.journal.dust}});
  for(const [facility,levels]of [['still',[1,2,3]],['counter',[1]]] as const){
    for(const expectedLevel of levels){
      const before={coins:profile().coins,ore:profile().leisure.materials.ore,ingot:profile().atelier!.stock.ingot,level:profile().atelier!.facilities[facility]},cost=facilityCost(profile().atelier!,facility);
      await actionClick(win,'aUpgrade-'+facility);assert.equal(profile().atelier!.facilities[facility],expectedLevel,facility+' research should advance one actual level');
      assert.equal(profile().coins,before.coins-cost.coins);assert.equal(profile().leisure.materials.ore,before.ore-cost.ore);assert.equal(profile().atelier!.stock.ingot,before.ingot-cost.ingot);
      await until(()=>js<boolean>(win,'document.getElementById('+JSON.stringify('aFacilityPips-'+facility)+')?.dataset.level==='+JSON.stringify(String(expectedLevel))),facility+' level pips reflect worker state');
      check('alchemy facility research spends the listed inputs and advances its visible level',{facility,expectedLevel,before,cost,after:{coins:profile().coins,ore:profile().leisure.materials.ore,ingot:profile().atelier!.stock.ingot,level:profile().atelier!.facilities[facility]}});
    }
  }
  await disabledControl(win,'aUpgrade-still',/设施已满级/);await auditAlchemyTypography(win,'fully researched facility page');await capture(win,'alchemy-study-fully-researched',{width:620,height:500});await backToScene(win);

  await visitRoute(win,{id:'alShelf',tab:'sales'},'shelf pricing and stock',false);await selectGood(win,'dew');await actionClick(win,'aUnstock');assert.equal(profile().atelier!.shelves.dew.stock,0);await backToScene(win);await assertShelfInventory(win,'manually unstocked dew is absent');
  await visitRoute(win,{id:'alShelf',tab:'sales'},'return a good to its shelf',false);await selectGood(win,'dew');await actionClick(win,'aStock');assert.equal(profile().atelier!.shelves.dew.stock,5);
  for(const quote of ['quick','premium','normal','quick'] as const){await actionClick(win,'aPrice-'+quote);assert.equal(profile().atelier!.shelves.dew.quote,quote);}
  await backToScene(win);
  const shelfBefore=profile().atelier!.shelves.dew.stock,tillBefore=profile().atelier!.till,saleValue=atelierPrice('dew','quick');assert.equal(shelfBefore,5);
  await withSoftwareVisible(win,'alchemy open and sale feedback',async()=>{
    await actionClick(win,'alOpen');assert.equal(profile().atelier!.open.alchemy,true);
  });
  const openTick=profile().tick,soldBefore=profile().totals.sold;const sale=await advanceWorker(61_000,'quick alchemy shelf sale');assert.equal(sale.tick>=openTick+600,true);assert.equal(sale.atelier!.shelves.dew.stock,shelfBefore-1);assert.equal(sale.atelier!.till,tillBefore+saleValue);assert.equal(sale.totals.sold,soldBefore+1);await assertShelfInventory(win,'dew automatic sale updates the real shelf count');
  const tillText=await js<string>(win,'document.getElementById("alTill").textContent.trim()');assert.match(tillText,/335金币/);assert.ok(!tillText.includes('97'),'alchemy till must not include old ordinary business till');
  const collectBefore={coins:profile().coins,till:profile().atelier!.till,businessTill:profile().business.till,sequence:profile().sequence};assert.equal(collectBefore.till,tillBefore+saleValue);
  await actionClick(win,'alCollect',true);assert.equal(profile().coins,collectBefore.coins+collectBefore.till);assert.equal(profile().atelier!.till,0);assert.equal(profile().business.till,collectBefore.businessTill);await disabledControl(win,'alCollect',/暂无货款/);
  const afterCollect=profile().sequence;await clickElement(win,'alCollect');assert.equal(profile().sequence,afterCollect,'disabled second collect must submit no action');
  check('alchemy cashbox collects the shared specialty till once and leaves old business till untouched',{before:collectBefore,after:{coins:profile().coins,atelierTill:profile().atelier!.till,businessTill:profile().business.till,sequence:profile().sequence},exactCollection:collectBefore.till,doubleClickProbe:true});
  await actionClick(win,'alOpen');assert.equal(profile().atelier!.open.alchemy,false);const closed=profile();await advanceWorker(61_000,'closed alchemy shelf does not trade');assert.equal(profile().atelier!.shelves.dew.stock,closed.atelier!.shelves.dew.stock);assert.equal(profile().atelier!.till,0);check('closing the alchemy stall stops future sales while economic clock advances',{stockBefore:closed.atelier!.shelves.dew.stock,stockAfter:profile().atelier!.shelves.dew.stock,till:profile().atelier!.till});

  await orderCycle(win);await backToScene(win);await assertStableScene(win);
  await auditMotion(win);await motionActionPulse(win);await auditShellLifecycle(win);await assertStableScene(win);
  const beforeReopen=structuredClone(profile());await js(win,'window.__alchemy0110DisposedRoot=document.getElementById("alchemyScene")');await clickElement(win,'popupClose');await until(()=>shell?.popup===null,'close rich alchemy');assert.equal(popup().isVisible(),false);
  const sequenceAtDispose=profile().sequence;win=await openAlchemy();
  const disposed=await js<{connected:boolean;motion:string;animations:number}>(win,'(()=>{const r=window.__alchemy0110DisposedRoot;return{connected:!!r?.isConnected,motion:r?.dataset.motion||"missing",animations:r?.getAnimations({subtree:true}).length||0}})()');
  assert.equal(disposed.connected,false);assert.equal(disposed.motion,'paused');assert.equal(disposed.animations,0);
  await js(win,'window.__alchemy0110DisposedRoot.querySelector("#alOpen").click()');assert.equal(profile().sequence,sequenceAtDispose,'disposed scene listener still dispatched an action');
  check('popup generation change disposes old scene observer/animation and aborts detached listeners',{disposed,sequenceAtDispose,sequenceAfterDetachedClick:profile().sequence,input:'software HTMLElement.click() on detached node; not physical input'});
  assert.deepEqual(profile(),advance(beforeReopen,profile().wallAt),'popup close/reopen changed profile beyond its authoritative wall-clock progression');check('popup close/reopen preserves all state beyond the ordinary worker wall clock',{before:{tick:beforeReopen.tick,wallAt:beforeReopen.wallAt,sequence:beforeReopen.sequence},after:{tick:profile().tick,wallAt:profile().wallAt,sequence:profile().sequence},expected:advance(beforeReopen,profile().wallAt)});await capture(win,'rich-scene-after-reopen');await assertShelfInventory(win,'reopened scene exact inventory');
}
async function rewardCapScenario():Promise<void>{
  assert.equal(profile().job,'keeper');assert.ok(profile().atelier);let win=await openAlchemy();await assertGuests(win,true);await visitRoute(win,{id:'alGuest0',tab:'sales',guest:0},'reward-cap NPC order',false);
  const order=stableAtelierOrder(profile(),'alchemy',0);await actionClick(win,'aAccept0');assert.equal(profile().atelier!.orders.alchemy[0].accepted,true);
  const before=structuredClone(profile()),disabled=await disabledControl(win,'aDeliver0',/奖励空间不足/);assert.ok(before.coins+order.coins>1_000_000_000);assert.equal(profile().sequence,before.sequence);assert.equal(profile().coins,before.coins);assert.equal(profile().atelier!.stock[order.good],before.atelier!.stock[order.good]);assert.equal(profile().leisure.journal.dust,before.leisure.journal.dust);assert.deepEqual(profile().atelier!.orders.alchemy[0],before.atelier!.orders.alchemy[0]);
  check('reward-cap real order remains accepted without consuming stock or emitting payout',{order,before:{coins:before.coins,stock:before.atelier!.stock[order.good],dust:before.leisure.journal.dust,sequence:before.sequence},after:{coins:profile().coins,stock:profile().atelier!.stock[order.good],dust:profile().leisure.journal.dust,sequence:profile().sequence,accepted:profile().atelier!.orders.alchemy[0].accepted},disabledReason:disabled.tip});
}
async function main():Promise<void>{
  try{
    fs.mkdirSync(evidenceDir,{recursive:true,mode:0o700});
    const fixture=makeBase(Date.now());preflight=parseProfile(fixture);assert.equal(preflight.version,8);
    if(scenario==='visitor'||scenario==='keeper')assert.equal(Object.hasOwn(preflight,'atelier'),false,'legacy fixture begins without optional Atelier state');else assert.equal(Object.hasOwn(preflight,'atelier'),true);
    const folder=path.join(profileRoot,'solo');fs.mkdirSync(folder,{recursive:true,mode:0o700});markIsolatedFolder(profileRoot,app.getPath('appData'));
    fs.writeFileSync(profileFile,JSON.stringify(preflight)+'\n',{flag:'wx',mode:0o600});assert.deepEqual(parseProfile(JSON.parse(fs.readFileSync(profileFile,'utf8'))),preflight,'only the preflighted private profile is written');
    app.on('browser-window-created',(_event,win)=>track(win));shell=await startDesktop(profileRoot,true);
    await until(()=>shell?.game.state.status==='ready'&&!!shell.game.state.profile,'isolated worker ready');for(const win of BrowserWindow.getAllWindows())track(win);
    const loaded=shell.game.state.profile;assert.ok(loaded);assertLoadedFixture(loaded,preflight);check('preflighted private schema 8 profile loaded',{version:profile().version,sequence:profile().sequence,job:profile().job,atelierPresent:Object.hasOwn(profile(),'atelier'),profileRoot});
    await until(()=>js<boolean>(overlay(),'document.body.dataset.view!==undefined&&document.querySelectorAll("[data-shop]").length===2'),'hidden street renderer ready');
    if(scenario==='visitor')await visitorScenario();else if(scenario==='keeper')await keeperScenario();else if(scenario==='rich')await richScenario();else await rewardCapScenario();
    await shell.game.request('flush');assert.deepEqual(new GameStore(path.join(profileRoot,'solo')).value,profile(),'only this run isolated profile persisted');await assertHiddenBoundary();
    assert.equal(errors.length,0,'renderer errors: '+errors.join('; '));for(const row of snapshots())assert.deepEqual({visible:row.isVisible,focused:row.isFocused},{visible:false,focused:false},'native window visible or focused '+JSON.stringify(row));
    assert.deepEqual(hashesAtStart,productHashes(),'source/runtime product hashes changed during the run');status='PASS';check('hidden-native alchemy 0.11.0 acceptance completed',{scenario,profileFile,nativeWindows:snapshots(),suppression,productFiles:Object.keys(hashesAtStart).length});
  }catch(error){status='FAIL';errors.push(String(error));console.error(error instanceof Error?error.stack:String(error));}
  finally{report(status==='FAIL'?new Error(errors.at(-1)||'failure'):undefined);if(status==='FAIL')process.exitCode=1;app.quit();}
}
void main();
