import {app, BrowserWindow, type BrowserWindow as BrowserWindowType} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {startDesktop} from '../apps/desktop/bootstrap';
import {GameStore} from '../apps/desktop/game-store';
import {markIsolatedFolder} from '../apps/desktop/launch-profile';
import {APP_NAME, APP_VERSION, PROFILE_NAME} from '../apps/desktop/identity';
import {
  FORMULAS, GOOD_IDS, MARKET, PRICE_TIERS, QUOTES, advance, atelierPrice, atelierTicks, craftTicks, facilityCost, initialAtelier, initialProfile,
  initialCamp, jobPower, orderReward, parseProfile, recipes, salePrice, stableAtelierOrder, tradeQuote,
  type Good,type Profile,
} from '../packages/solo-core';

type Check={name:string;status:'PASS'|'FAIL'|'INFO';detail?:unknown};
type Trace={id:number;page:string|null;visible:()=>boolean;focused:()=>boolean;last:{isVisible:boolean;isFocused:boolean}};
type Scenario='smoke'|'smoke-keeper'|'fresh'|'rich';
type Control={exists:boolean;hidden:boolean;disabled:boolean;label:string;tip:string;cursor:string;font:number;gameButton:boolean;reachable:boolean;rect:{x:number;y:number;width:number;height:number}};

const checks:Check[]=[];
const errors:string[]=[];
const screenshotFiles:string[]=[];
const suppression=(globalThis as any).__pixelStreetSupply0110Suppression??{};
const root=process.cwd();
const evidenceDir=path.join(root,'work/inner-0110/trade/native-luna/supply');
const workEvidenceDir=path.join(root,'work/inner-0110/trade/native-luna/supply/progress');
const scenario=(process.argv.find(a=>a.startsWith('--scenario='))?.split('=')[1]??'smoke') as Scenario;
if(!['smoke','smoke-keeper','fresh','rich'].includes(scenario))throw new Error('scenario must be smoke, smoke-keeper, fresh or rich');
const runId=new Date().toISOString().replace(/[:.]/g,'-')+'-'+process.pid+'-'+scenario;
const profileRoot=fs.mkdtempSync('/private/tmp/pixelstreet-inner-0110-luna-'+scenario+'-');
const profileFile=path.join(profileRoot,'solo/profile.json');
const reportPath=path.join(evidenceDir,'native-'+scenario+'-'+runId+'.json');
const progressPath=path.join(workEvidenceDir,'native-'+scenario+'-'+runId+'.jsonl');
const screenshots:string[]=[];
const traces=new Map<number,Trace>();
const keyboardByWindow:Record<number,number>={};
const cspByWindow:Record<number,string[]>={};
let shell:Awaited<ReturnType<typeof startDesktop>>|undefined;
let preflight:Profile|undefined;
let status:'RUNNING'|'PASS'|'FAIL'='RUNNING';
let explicitFailureCount=0;

const coverageMatrix={
  smoke:['visitor supply-store scene and first-view hierarchy','lsCounter / lsSupplies / lsOven / lsShelf / lsGuest0..2 / lsLedger / lsCollect destinations with visitor-only guest visibility','roomWorkspace open and roomBack return','visitor screenshots at 760x650 and 1040x650; stable IDs, readable controls and small-viewport scroll','close/reopen preserves profile and scene readiness'],
  'smoke-keeper':['keeper supply-store scene and current real visitor orders','lsCounter / lsSupplies / lsOven / lsShelf / lsGuest0..2 / lsLedger / lsCollect destinations with keeper guest visibility','roomWorkspace open and roomBack return including every real guest workspace','keeper screenshots at 760x650 and 1040x650; stable IDs, readable controls and small-viewport scroll','close/reopen preserves profile and scene readiness'],
  fresh:['visitor → applyJob → one trial craft → worker test clock → deliverTrial → keeper','before hiring, real supply procurement and ordinary/special recipe routes expose accurate disabled reasons and remain read-only','the new atelier recipe selector and raw-material purchase entrance remain visible to a visitor without initializing optional progress','no duplicate job, cooking, purchase or delivery submission','legacy supply, oven, customer, shelf, specials and ledger routes remain reachable in details','purchase and production update authoritative profile and scene status','close/reopen and small viewport'],
  rich:['unmanaged legacy bag stock and specialty shelf count reflect real inventory; no sale while closed','legacy NPC sale changes only the selected bag stock and wallet; managed ordinary shelf is separate','parallel specialty and ordinary queues: near-complete specialty is the scene label/click destination, then ordinary-only route after cancellation','basic and specialty procurement, craft, queue, cancellation/refund, completion, pricing and sale','three real customer entries map to authoritative orders; accept/deliver changes one order once','manual shelf, price, sales and exact shared-cashbox collection; second collect is disabled with an authoritative reason','supply Atelier recipe, specialty shelf count/sale, order delivery and facility/mastery research','old overview remains reachable; small viewport, stable DOM, attributed feedback and close/reopen','motion software-state fixture: visible getter + pointerenter/blur/pointerenter stays paused; only authoritative resume releases blur latch','disabled cashbox forced-hover CSS probe; all native windows remain hidden/unfocused and zero keyboard/CSP'],
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
    ...walk(path.join(root,'apps/desktop')),
    ...walk(path.join(root,'packages/solo-core')),
    ...walk(path.join(root,'packages/protocol')),
    ...walk(path.join(root,'packages/content')),
    ...walk(path.join(root,'dist')),
    ...walk(path.join(root,'assets')),
  ];
  return [...new Set(files)]
    .filter(file=>!/^dist\/(?:tests\/|native-.*\.cjs$)/.test(file))
    .filter(file=>fs.existsSync(path.join(root,file)))
    .sort();
}
function productHashes():Record<string,string>{
  return Object.fromEntries(productFiles().map(file=>[
    file,createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex'),
  ]));
}
const hashesAtStart=productHashes();
function page(win:BrowserWindowType):string|null{
  try{return new URL(win.webContents.getURL()).searchParams.get('page');}catch{return null;}
}
function snapshots():Array<Record<string,unknown>>{
  return [...traces.values()].map(trace=>{
    try{
      trace.last={isVisible:trace.visible(),isFocused:trace.focused()};
      return{id:trace.id,page:trace.page,...trace.last};
    }catch(error){return{id:trace.id,page:trace.page,...trace.last,destroyed:true,error:String(error)};}
  });
}
function report(error?:unknown):void{
  fs.mkdirSync(evidenceDir,{recursive:true});
  fs.mkdirSync(workEvidenceDir,{recursive:true});
  const record={
    schema:'pixelstreet.inner-0110.luna-max.hidden-native.v1',
    stage:'supply-store',
    scenario,runId,status,at:new Date().toISOString(),
    identity:{name:APP_NAME,version:APP_VERSION,profileName:PROFILE_NAME},
    platform:process.platform,arch:process.arch,electron:process.versions.electron,
    profileRoot,profileFile,
    preflight:preflight?{version:preflight.version,sequence:preflight.sequence,job:preflight.job,coins:preflight.coins,atelierPresent:Object.hasOwn(preflight,'atelier')}:null,
    coverageMatrix:coverageMatrix[scenario==='smoke-keeper'?'smoke':scenario],checks,errors,screenshotFiles:screenshots,suppression,
    nativeWindows:snapshots(),keyboardByWindow,cspByWindow,
    productScope:{roots:['apps/desktop','packages/solo-core','packages/protocol','packages/content','assets','dist'],files:Object.keys(hashesAtStart).length,excluded:['tests/native-supply-0110-luna.ts','tests/native-supply-0110-luna-bootstrap.cjs','tests/run-native-supply-0110-luna.sh','dist/native-supply-0110-luna.cjs','dist/tests']},
    productHashesAtStart:hashesAtStart,
    productHashesAtEnd:status==='RUNNING'?undefined:productHashes(),
    error:error?String(error):undefined,stack:error instanceof Error?error.stack:undefined,
    evidenceBoundary:{
      windowPolicy:'The hidden-native bootstrap ran before DesktopShell loaded. It blocks app activation/focus, BrowserWindow show/showInactive/focus/moveTop/restore, webContents.focus, Dock activation, Tray and globalShortcut. On macOS activationPolicy was prohibited.',
      nativeState:'Original bound BrowserWindow isVisible/isFocused methods were sampled; no native window was shown or focused.',
      input:'Only HTMLElement.click(), renderer-dispatched MouseEvent/PointerEvent, programmatic select changes, worker test-clock requests, BrowserWindow.setSize, hidden capturePage, and a CDP forced CSS :hover probe were used. Software event/style probes are not physical mouse/keyboard evidence.',
      profile:'A newly created /private/tmp profile was marked and parseProfile-preflighted before startDesktop. No installed-app profile or old application data directory was opened.',
      motion:'App resign/become-active events, if used, are direct software lifecycle probes and are recorded as such; they do not claim a real OS app switch or visible-window test.',
      productIntegrity:'Per-run SHA-256 inventories cover source and built runtime including assets/inner-0110. The dedicated harness bundle and dist/tests are excluded.',
    },
  };
  fs.writeFileSync(reportPath,JSON.stringify(record,null,2)+'\n',{flag:'wx',mode:0o600});
  fs.appendFileSync(progressPath,JSON.stringify({at:new Date().toISOString(),finalReport:reportPath,status,errors})+'\n',{mode:0o600});
}
function check(name:string,detail?:unknown,result:'PASS'|'FAIL'|'INFO'='PASS'):void{
  checks.push({name,status:result,detail});
  if(result==='FAIL')explicitFailureCount++;
  fs.appendFileSync(progressPath,JSON.stringify({at:new Date().toISOString(),name,status:result,detail})+'\n',{mode:0o600});
}
async function until(fn:()=>Promise<boolean>|boolean,label:string,timeout=25_000):Promise<void>{
  const end=Date.now()+timeout;
  while(Date.now()<end){if(await fn())return;await new Promise(resolve=>setTimeout(resolve,35));}
  throw new Error('timeout: '+label);
}
async function js<T=unknown>(win:BrowserWindowType,source:string):Promise<T>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{
    return await Promise.race([
      win.webContents.executeJavaScript(source) as Promise<T>,
      new Promise<T>((_resolve,reject)=>{timer=setTimeout(()=>reject(new Error('renderer evaluation timed out on '+win.id)),15_000);}),
    ]);
  }finally{if(timer)clearTimeout(timer);}
}
async function instrument(win:BrowserWindowType):Promise<void>{
  await js(win,'(()=>{if(window.__supply0110Instrumented)return true;window.__supply0110Instrumented=true;window.__supply0110Keys=0;window.__supply0110Csp=[];for(const t of ["keydown","keyup","keypress"])document.addEventListener(t,()=>window.__supply0110Keys++,true);document.addEventListener("securitypolicyviolation",e=>window.__supply0110Csp.push({directive:e.violatedDirective,blocked:e.blockedURI,sample:e.sample}),true);return true})()');
}
function track(win:BrowserWindowType):void{
  if(traces.has(win.id))return;
  const visible=win.isVisible.bind(win),focused=win.isFocused.bind(win);
  traces.set(win.id,{id:win.id,page:page(win),visible,focused,last:{isVisible:visible(),isFocused:focused()}});
  keyboardByWindow[win.id]=0;cspByWindow[win.id]=[];
  win.webContents.on('console-message',(event:any)=>{
    const message=String(event.message);
    if(event.level==='error')errors.push(message.slice(0,600));
    if(/Content Security Policy|style-src|Refused to apply inline style/i.test(message))cspByWindow[win.id].push(message.slice(0,600));
  });
  win.webContents.on('did-finish-load',()=>{
    const trace=traces.get(win.id);if(trace)trace.page=page(win);
    void instrument(win).catch(error=>errors.push('instrument '+win.id+': '+String(error)));
  });
}
function overlay():BrowserWindowType{
  assert.ok(shell&&!shell.overlay.isDestroyed(),'overlay missing');return shell.overlay;
}
function popup():BrowserWindowType{
  const win=shell?.popupWindow;assert.ok(win&&!win.isDestroyed(),'popup missing');return win;
}
function profile():Profile{
  const value=shell?.game.state.profile;assert.ok(value,'profile unavailable: '+(shell?.game.state.error||'loading'));return value;
}
function assertLoadedFixture(actual:Profile,fixture:Profile):void{
  // GameRuntime advances the isolated fixture to its startup timestamp.
  // Advance the whole expected profile so every economic and identity field
  // still receives an exact comparison under the established worker semantics.
  assert.deepEqual(actual,advance(fixture,actual.wallAt),'worker must load the generated fixture advanced to its first wall-clock timestamp');
}
async function clickElement(win:BrowserWindowType,id:string):Promise<void>{
  assert.ok(await js<boolean>(win,'!!document.getElementById('+JSON.stringify(id)+')'),id+' missing');
  await js(win,'document.getElementById('+JSON.stringify(id)+').click()');
}
async function clickSelector(win:BrowserWindowType,selector:string):Promise<void>{
  assert.ok(await js<boolean>(win,'!!document.querySelector('+JSON.stringify(selector)+')'),selector+' missing');
  await js(win,'document.querySelector('+JSON.stringify(selector)+').click()');
}
async function choose(win:BrowserWindowType,id:string,value:string):Promise<void>{
  await js(win,'(()=>{const e=document.getElementById('+JSON.stringify(id)+');if(!e)return false;e.value='+JSON.stringify(value)+';e.dispatchEvent(new Event("change",{bubbles:true}));return true})()');
  await new Promise(resolve=>setTimeout(resolve,80));
}
async function popupReady():Promise<BrowserWindowType>{
  const win=popup();
  await until(()=>js<boolean>(win,'document.body.dataset.popupReady==="true"&&document.body.dataset.popup==="shop"'),'shop renderer ready');
  await until(()=>js<boolean>(win,'!!document.getElementById("livingScene")'),'living supply scene mounted');
  assert.equal(shell?.popup?.kind,'shop');
  assert.equal(win.isVisible(),false);assert.equal(win.isFocused(),false);
  await instrument(win);return win;
}
async function openBakery():Promise<BrowserWindowType>{
  const street=overlay();
  await until(()=>!!shell&&Reflect.get(shell,'overlayCold')===false&&js<boolean>(street,'document.body.dataset.view!==undefined&&!!document.querySelector("[data-shop=\\"shop-bakery\\"]")'),'bakery sign and scene-ready handler');
  if(shell?.view!=='interior'||shell.activeShop!=='shop-bakery'){
    await clickSelector(street,'[data-shop="shop-bakery"]');
    await until(()=>shell?.view==='interior'&&shell.activeShop==='shop-bakery','enter bakery');
  }
  await new Promise(resolve=>setTimeout(resolve,120));
  const logical=await js<{x:number;y:number;scale:number}>(street,'({x:Number(document.body.dataset.worldX),y:Number(document.body.dataset.worldY),scale:Number(document.body.dataset.worldScale)})');
  assert.ok(Number.isFinite(logical.x+logical.y+logical.scale)&&logical.scale>0,'street scene coordinates unavailable');
  await js(street,'document.dispatchEvent(new MouseEvent("click",{bubbles:true,clientX:'+String(logical.x+244*logical.scale)+',clientY:'+String(logical.y-20*logical.scale)+'}))');
  const win=await popupReady();
  check('software-only hidden scene click opens the supply shop', {scene:logical,shop:shell?.activeShop,window:{id:win.id,visible:win.isVisible(),focused:win.isFocused()},input:'renderer MouseEvent; not physical input'});
  return win;
}
async function control(win:BrowserWindowType,id:string):Promise<Control>{
  return js(win,'(()=>{const e=document.getElementById('+JSON.stringify(id)+'),c=document.querySelector(".popover-content")||document.scrollingElement||document.documentElement,hidden=!e||e.hidden||!!e.closest("[hidden]")||!!e.closest("details:not([open])")||getComputedStyle(e).display==="none";if(!hidden){const r=e.getBoundingClientRect(),cr=c.getBoundingClientRect();if(r.bottom>cr.bottom-2)c.scrollTop+=r.bottom-cr.bottom+4;else if(r.top<cr.top+2)c.scrollTop-=cr.top-r.top+4;e.scrollIntoView({block:"center",inline:"nearest"});}const r=e&&e.getBoundingClientRect(),cr=c.getBoundingClientRect(),s=e&&getComputedStyle(e),hit=r&&document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return{exists:!!e,hidden,disabled:!e||!!e.disabled,label:e?.getAttribute("aria-label")||e?.textContent?.trim()||"",tip:e?.dataset.tooltip||e?.title||"",cursor:s?.cursor||"",font:s?parseFloat(s.fontSize):0,gameButton:!!e?.classList.contains("game-button"),reachable:!hidden&&!!r&&r.width>0&&r.height>0&&r.top>=cr.top-.5&&r.bottom<=cr.bottom+.5&&hit?.closest("button")===e,rect:r?{x:r.x,y:r.y,width:r.width,height:r.height}:{x:0,y:0,width:0,height:0}}})()');
}
async function assertControl(win:BrowserWindowType,id:string,enabled=true):Promise<Control>{
  const state=await control(win,id);
  assert.ok(state.exists&&!state.hidden,id+' missing/hidden: '+JSON.stringify(state));
  assert.equal(state.disabled,!enabled,id+' disabled state '+JSON.stringify(state));
  assert.ok(state.gameButton,id+' is not a GameButton');
  assert.ok(state.tip.trim(),id+' has no authoritative tooltip/reason');
  assert.ok(state.font>=16,id+' font is below 16px');
  assert.equal(state.cursor,enabled?'pointer':'not-allowed',id+' cursor');
  if(enabled)assert.ok(state.reachable,id+' is not within hit viewport: '+JSON.stringify(state));
  return state;
}
async function localClick(win:BrowserWindowType,id:string):Promise<void>{
  const state=await assertControl(win,id,true);await clickElement(win,id);
  check('software local control '+id,{label:state.label,tooltip:state.tip,rect:state.rect,input:'HTMLElement.click() only'});
}
async function actionClick(win:BrowserWindowType,id:string,double=false):Promise<Profile>{
  const state=await assertControl(win,id,true),before=profile().sequence;
  await clickElement(win,id);if(double)await clickElement(win,id);
  await until(()=>profile().sequence>=before+1,id+' worker receipt');
  await new Promise(resolve=>setTimeout(resolve,220));
  assert.equal(profile().sequence,before+1,id+' submitted more than one economy action');
  check('authoritative worker action '+id,{label:state.label,tooltip:state.tip,sequenceBefore:before,sequenceAfter:profile().sequence,notice:profile().notice,doubleClickProbe:double,input:'software DOM click; not physical input'});
  return profile();
}
async function disabledControl(win:BrowserWindowType,id:string,reason?:RegExp):Promise<void>{
  const state=await assertControl(win,id,false);if(reason)assert.match(state.tip,reason,id+' disabled reason');
  check('authoritative disabled state '+id,state);
}
async function sceneAction(win:BrowserWindowType,id:string):Promise<void>{
  const state=await assertControl(win,id,true);await clickElement(win,id);
  await until(()=>js<boolean>(win,'!!document.getElementById("roomWorkspace")&&!document.getElementById("roomWorkspace").hidden'),'workspace '+id+' opened');
  await until(()=>js<boolean>(win,'!!document.getElementById("roomBack")&&!document.getElementById("roomBack").hidden'),'workspace back control exposed');
  check('scene object '+id+' opens its detail workspace',{label:state.label,tooltip:state.tip,rect:state.rect,workspace:await js(win,'document.getElementById("roomWorkspace").dataset.workspace||document.getElementById("roomWorkspace").getAttribute("aria-label")||""')});
}
async function backToScene(win:BrowserWindowType):Promise<void>{
  await localClick(win,'roomBack');
  await until(()=>js<boolean>(win,'!document.getElementById("roomWorkspace")||document.getElementById("roomWorkspace").hidden'),'detail workspace closed');
  await until(()=>js<boolean>(win,'!!document.getElementById("livingScene")&&!document.getElementById("livingScene").hidden'),'living scene restored');
}
async function verifyReopenedSceneListener(win:BrowserWindowType,label:string):Promise<void>{
  assert.equal(profile().retail,false,label+' starts with legacy shop closed');
  const before=profile().sequence,opened=await actionClick(win,'lsOpen');
  assert.equal(opened.retail,true,label+' re-opened scene listener opens the legacy shop');
  assert.equal(opened.sequence,before+1,label+' open submits exactly once');
  const closed=await actionClick(win,'lsOpen');
  assert.equal(closed.retail,false,label+' re-opened scene listener closes the legacy shop');
  assert.equal(closed.sequence,before+2,label+' close submits exactly once');
  check('reopened living scene actions submit once after the former scene is disposed',{label,sequenceBefore:before,sequenceAfter:closed.sequence,retail:closed.retail});
}
async function shopTab(win:BrowserWindowType,tab:'Supply'|'Craft'|'Orders'|'Manage'|'Specials'):Promise<void>{
  const ids={Supply:'shopTabSupply',Craft:'shopTabCraft',Orders:'shopTabOrders',Manage:'shopTabManage',Specials:'shopTabSpecials'} as const;
  const panels={Supply:'shopPanelSupply',Craft:'shopPanelCraft',Orders:'shopPanelOrders',Manage:'shopPanelManage',Specials:'shopPanelSpecials'} as const;
  await localClick(win,ids[tab]);
  await until(()=>js<boolean>(win,'!!document.getElementById('+JSON.stringify(panels[tab])+')&&!document.getElementById('+JSON.stringify(panels[tab])+').hidden'),tab+' legacy panel visible');
}
async function atelierTab(win:BrowserWindowType,tab:'craft'|'sales'|'study'):Promise<void>{
  await localClick(win,'aTab-'+tab);
  await until(()=>js<boolean>(win,'!!document.getElementById("aPanel-'+tab+'")&&!document.getElementById("aPanel-'+tab+'").hidden'),'Atelier '+tab+' panel visible');
}
async function openMarket(win:BrowserWindowType):Promise<void>{
  await js(win,'(()=>{const d=document.querySelector(".a-market");if(!d)return false;if(!d.open)d.open=true;d.scrollIntoView({block:"nearest"});return d.open})()');
  await until(()=>js<boolean>(win,'document.querySelector(".a-market")?.open===true'),'Atelier market open');
}
function reagentOwned(reagent:string):number{
  const p=profile();
  if(reagent==='dust')return p.leisure.journal.dust;
  if(reagent==='flour'||reagent==='gel')return p.bag[reagent];
  return p.leisure.materials[reagent as keyof Profile['leisure']['materials']];
}
async function auditSelectedProduct(win:BrowserWindowType,good:Good,station:'supply'|'alchemy'):Promise<void>{
  const formula=FORMULAS[good],before=profile().sequence;
  const ids=GOOD_IDS.filter(id=>FORMULAS[id].station===station).map(id=>'aPick-'+id);
  const sameNodes=await js<boolean>(win,'(()=>{window.__inner0110PickNodes=Object.fromEntries('+JSON.stringify(ids)+'.map(id=>[id,document.getElementById(id)]));return Object.values(window.__inner0110PickNodes).every(Boolean)})()');
  assert.ok(sameNodes,station+' recipe choices must be present before selection');
  await localClick(win,'aPick-'+good);
  const selected=await js<{name:string;use:string;hero:string;shelf:string;pressed:string[];count:number;visibleNeeds:string[];hiddenNeeds:string[];needDisplay:Record<string,string>;sameNodes:boolean}>(win,'(()=>{const buttons=[...document.querySelectorAll(".a-quantities button[aria-pressed=true]")],needs=[...document.querySelectorAll("[id^=aNeed-]")].filter(e=>e.id.startsWith("aNeed-")&&!e.id.startsWith("aNeedCount-"));return{name:document.getElementById("aName")?.textContent?.trim()||"",use:document.getElementById("aUseDescription")?.textContent?.trim()||"",hero:document.getElementById("aHeroArt")?.dataset.art||"",shelf:document.getElementById("aShelfArt")?.dataset.art||"",pressed:'+JSON.stringify(ids)+'.filter(id=>document.getElementById(id)?.getAttribute("aria-pressed")==="true"),count:Number(buttons[0]?.textContent?.match(/\\d+/)?.[0]||0),visibleNeeds:needs.filter(e=>!e.hidden).map(e=>e.id.slice("aNeed-".length)).sort(),hiddenNeeds:needs.filter(e=>e.hidden&&getComputedStyle(e).display!=="none").map(e=>e.id),needDisplay:Object.fromEntries(needs.filter(e=>!e.hidden).map(e=>[e.id.slice("aNeed-".length),document.getElementById("aNeedCount-"+e.id.slice("aNeed-".length))?.textContent?.trim()||""])),sameNodes:Object.entries(window.__inner0110PickNodes||{}).every(([id,node])=>node===document.getElementById(id)&&node.isConnected)}})()');
  assert.equal(selected.name,formula.name,good+' selection must update the visible recipe name');
  assert.equal(selected.use,formula.use,good+' selection must update the use decision');
  assert.equal(selected.hero,good,good+' selection must update the workbench item art');
  assert.equal(selected.shelf,good,good+' selection must update the shelf item art');
  assert.deepEqual(selected.pressed,['aPick-'+good],good+' must be the only selected recipe');
  assert.ok(selected.count>=1,'selected production quantity must remain explicit');
  const expectedNeeds=Object.entries(formula.cost).filter(([,amount])=>amount>0).map(([reagent])=>reagent).sort();
  assert.deepEqual(selected.visibleNeeds,expectedNeeds,good+' must show only its actual ingredients');
  assert.deepEqual(selected.hiddenNeeds,[],good+' hidden unrelated ingredients must remain visually hidden');
  for(const [reagent,amount]of Object.entries(formula.cost))assert.equal(selected.needDisplay[reagent],`${reagentOwned(reagent)} / ${amount!*selected.count}`,good+' actual/needed material count for '+reagent);
  assert.equal(selected.sameNodes,true,'selecting a recipe must preserve the chooser DOM nodes');
  await atelierTab(win,'sales');
  const sale=await js<{visible:boolean;art:string;stock:string;prices:Record<string,string>}>(win,'(()=>({visible:!document.getElementById("aPanel-sales").hidden,art:document.getElementById("aShelfArt")?.dataset.art||"",stock:document.getElementById("aShelfStock")?.textContent?.trim()||"",prices:Object.fromEntries(["quick","normal","premium"].map(q=>[q,document.getElementById("aPriceText-"+q)?.textContent?.trim()||""]))}))()');
  assert.equal(sale.visible,true);assert.equal(sale.art,good);assert.ok(sale.stock.includes(formula.name));
  for(const quote of ['quick','normal','premium'] as const){const seconds=QUOTES[quote].ticks/10,clock=seconds>=60?`${Math.floor(seconds/60)}分${seconds%60?`${seconds%60}秒`:''}`:`${seconds}秒`;assert.equal(sale.prices[quote],`${atelierPrice(good,quote)+jobPower(profile(),'counter')}金币 / ${clock}`,good+' selected-item quote '+quote);}
  await atelierTab(win,'study');
  const study=await js<{visible:boolean;mastery:string;facilityLevels:Record<string,string>;tiers:string[]}>(win,'(()=>({visible:!document.getElementById("aPanel-study").hidden,mastery:document.getElementById("aMasteryCount")?.textContent?.trim()||"",facilityLevels:Object.fromEntries(["kitchen","counter"].map(k=>[k,document.getElementById("aFacilityPips-"+k)?.dataset.level||""])),tiers:[0,1,2].map(i=>document.getElementById("aMasteryTier"+i)?.dataset.claimed||"")}))()');
  assert.equal(study.visible,true);assert.ok(study.mastery.startsWith(formula.name+' ·'));assert.deepEqual(study.tiers,[0,1,2].map(i=>String(i<profile().atelier!.claimed[good])));
  assert.equal(study.facilityLevels.kitchen,String(profile().atelier!.facilities.kitchen));assert.equal(study.facilityLevels.counter,String(profile().atelier!.facilities.counter));
  await atelierTab(win,'craft');assert.equal(profile().sequence,before,'recipe selection and tab changes are presentation-only');
  check('0110 selected product updates ingredients, workbench, shelf quotes and journal without replacing chooser nodes',{station,good,name:selected.name,needs:selected.visibleNeeds,prices:sale.prices,mastery:study.mastery,facilityLevels:study.facilityLevels,sequence:profile().sequence});
}
async function captureInternalPages(win:BrowserWindowType,station:'supply'|'alchemy',label:string):Promise<void>{
  const before=profile().sequence;
  for(const width of [760,1040]){
    win.setSize(width,650);await new Promise(resolve=>setTimeout(resolve,180));assert.deepEqual(win.getSize(),[width,650],'hidden internal-page viewport');
    for(const tab of ['craft','sales','study'] as const){
      await atelierTab(win,tab);
      const panel=await js<{tab:string;visible:string[]}>(win,'(()=>({tab:document.getElementById("atelierUi").dataset.tab,visible:["craft","sales","study"].filter(t=>!document.getElementById("aPanel-"+t).hidden)}))()');
      assert.equal(panel.tab,tab);assert.deepEqual(panel.visible,[tab],station+' must show only the selected '+tab+' page');
      await js(win,'document.querySelector(".popover-content").scrollTop=0');await auditLayout(win,label+' '+station+' '+tab+' '+width+' top');await auditTradeTypography(win,label+' '+station+' '+tab+' '+width+' top');await capture(win,label+'-'+station+'-'+tab+'-'+width+'-top',{width,height:500});
      const scroll=await js<number>(win,'(()=>{const e=document.querySelector(".popover-content");return e.scrollHeight-e.clientHeight})()');
      if(scroll>4){await js(win,'(()=>{const e=document.querySelector(".popover-content");e.scrollTop=e.scrollHeight})()');await auditLayout(win,label+' '+station+' '+tab+' '+width+' bottom');await auditTradeTypography(win,label+' '+station+' '+tab+' '+width+' bottom');await capture(win,label+'-'+station+'-'+tab+'-'+width+'-bottom',{width,height:500});}
      if(tab==='craft'&&width===760){
        await openMarket(win);await auditLayout(win,label+' '+station+' open-market '+width);await auditTradeTypography(win,label+' '+station+' open-market '+width);await capture(win,label+'-'+station+'-craft-market-'+width,{width,height:500});
        for(const good of GOOD_IDS.filter(id=>FORMULAS[id].station===station))await auditSelectedProduct(win,good,station);
      }
    }
  }
  await atelierTab(win,'craft');assert.equal(profile().sequence,before,'screen selection and capture did not mutate the worker profile');
}
async function captureSupplyWorkspace(win:BrowserWindowType):Promise<void>{
  const before=profile().sequence;
  await sceneAction(win,'lsCounter');
  for(const width of [760,1040]){
    win.setSize(width,650);await new Promise(resolve=>setTimeout(resolve,180));assert.deepEqual(win.getSize(),[width,650],'hidden supply-page viewport');
    for(const tab of ['Supply','Craft','Orders','Manage','Specials'] as const){
      await shopTab(win,tab);await auditLayout(win,'supply '+tab+' '+width+' top');await auditTradeTypography(win,'supply '+tab+' '+width+' top');await capture(win,'supply-'+tab.toLowerCase()+'-'+width+'-top',{width,height:500});
      const scroll=await js<number>(win,'(()=>{const e=document.querySelector(".popover-content");return e.scrollHeight-e.clientHeight})()');
      if(scroll>4){await js(win,'(()=>{const e=document.querySelector(".popover-content");e.scrollTop=e.scrollHeight})()');await auditLayout(win,'supply '+tab+' '+width+' bottom');await auditTradeTypography(win,'supply '+tab+' '+width+' bottom');await capture(win,'supply-'+tab.toLowerCase()+'-'+width+'-bottom',{width,height:500});}
    }
  }
  await backToScene(win);await sceneAction(win,'lsRecipes');
  await captureInternalPages(win,'supply','supply-special');
  await backToScene(win);assert.equal(profile().sequence,before,'supply page navigation/capture did not mutate the worker profile');
}
async function advanceWorker(ms:number,label:string):Promise<Profile>{
  assert.ok(shell);const before=profile(),result=await shell.game.request('advance',{ms});assert.ok(result.profile);
  await new Promise(resolve=>setTimeout(resolve,100));
  check('worker-only test clock '+label,{ms,tickBefore:before.tick,tickAfter:result.profile.tick,sequenceBefore:before.sequence,sequenceAfter:result.profile.sequence,input:'GameRuntime test clock; not elapsed user time'});
  return result.profile;
}
async function advanceToTick(target:number,label:string):Promise<Profile>{
  const gap=Math.max(1,target-profile().tick);const result=await advanceWorker(gap*100,label);
  assert.ok(result.tick>=target,label+' did not reach target tick '+target+'; actual '+result.tick);
  return result;
}
async function capture(win:BrowserWindowType,label:string,minimum={width:620,height:500}):Promise<void>{
  await new Promise(resolve=>setTimeout(resolve,240));
  const image=await win.webContents.capturePage(),size=image.getSize(),bytes=image.toPNG();
  assert.ok(size.width>=minimum.width&&size.height>=minimum.height,'unexpected hidden capture size '+JSON.stringify(size));
  assert.ok(bytes.length>8_000,'hidden capturePage returned too few bytes: '+bytes.length);
  const file=path.join(evidenceDir,'native-'+scenario+'-'+runId+'-'+label+'.png');
  fs.writeFileSync(file,bytes,{flag:'wx',mode:0o600});screenshots.push(file);
  assert.equal(win.isVisible(),false,'capture target became visible');assert.equal(win.isFocused(),false,'capture target became focused');
  screenshotFiles.push(file);check('hidden capturePage '+label,{file,size,bytes:bytes.length,native:{isVisible:win.isVisible(),isFocused:win.isFocused()},boundary:'hidden renderer pixels; not visible/physical evidence'});
}
async function auditTradeTypography(win:BrowserWindowType,label:string):Promise<void>{
  const small=await js<Array<{id:string;tag:string;font:number;text:string}>>(win,'(()=>[...document.querySelectorAll("#roomWorkspace:not([hidden]) .trade-workspace button,#roomWorkspace:not([hidden]) .trade-workspace h2,#roomWorkspace:not([hidden]) .trade-workspace h3,#roomWorkspace:not([hidden]) .trade-workspace p,#roomWorkspace:not([hidden]) .trade-workspace .tw-stock-label,#roomWorkspace:not([hidden]) .trade-workspace .tw-price-tag,#roomWorkspace:not([hidden]) .trade-workspace .tw-ingredient,#roomWorkspace:not([hidden]) .trade-workspace .tw-time-board,#roomWorkspace:not([hidden]) .trade-workspace .tw-reward")].filter(e=>e.getClientRects().length&&!e.closest("[hidden]")&&getComputedStyle(e).display!=="none"&&e.textContent.trim()&&parseFloat(getComputedStyle(e).fontSize)<16).map(e=>({id:e.id||"",tag:e.tagName,font:parseFloat(getComputedStyle(e).fontSize),text:e.textContent.trim().slice(0,80)})))()');
  assert.deepEqual(small,[],label+' decision text below 16px');check('trade page decision text remains readable '+label,{minimumFont:16,small});
}
async function auditLayout(win:BrowserWindowType,label:string):Promise<void>{
  const data=await js<{width:number;height:number;scrollWidth:number;scrollHeight:number;clientHeight:number;buttons:Array<{id:string;hidden:boolean;disabled:boolean;tip:string;cursor:string;font:number;gameButton:boolean}>;duplicates:string[];duplicateDetails:Array<{id:string;nodes:Array<{tag:string;section:string;hidden:boolean;parent:string}>}>}>(win,'(()=>{const root=document.getElementById("livingScene"),c=document.querySelector(".popover-content")||document.documentElement,buttons=[...document.querySelectorAll("#livingScene button[id],#roomWorkspace button[id]")].map(e=>({id:e.id,hidden:e.hidden||!!e.closest("[hidden]")||getComputedStyle(e).display==="none",disabled:e.disabled,tip:e.dataset.tooltip||e.title||"",cursor:getComputedStyle(e).cursor,font:parseFloat(getComputedStyle(e).fontSize),gameButton:e.classList.contains("game-button")})),ids=[...document.querySelectorAll("[id]")].map(e=>e.id),duplicates=[...new Set(ids.filter((id,i)=>ids.indexOf(id)!==i))],duplicateDetails=duplicates.map(id=>({id,nodes:[...document.querySelectorAll("[id]")].filter(e=>e.id===id).map(e=>({tag:e.tagName,section:e.closest("section")?.id||"",hidden:e.hidden||!!e.closest("[hidden]"),parent:e.parentElement?.id||e.parentElement?.className?.toString()||""}))}));return{width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:c.scrollHeight,clientHeight:c.clientHeight,buttons,duplicates,duplicateDetails,sceneRect:root?.getBoundingClientRect().toJSON()}})()');
  assert.ok(data.scrollWidth<=data.width+1,label+' horizontal overflow: '+JSON.stringify(data));
  assert.deepEqual(data.duplicates,[],label+' duplicate DOM IDs: '+JSON.stringify(data.duplicateDetails));
  for(const b of data.buttons.filter(button=>!button.hidden)){
    assert.ok(b.tip.trim(),b.id+' lacks tooltip or disabled reason');
    assert.ok(b.font>=16,b.id+' font below 16px: '+b.font);
    assert.ok(b.gameButton,b.id+' does not use GameButton');
    assert.equal(b.cursor,b.disabled?'not-allowed':'pointer',b.id+' cursor mismatch');
  }
  check('living scene readable controls and scroll audit '+label,data);
}
async function auditStableScene(win:BrowserWindowType,ids:string[]):Promise<void>{
  const before=await js<Record<string,boolean>>(win,'(()=>{window.__supply0110Stable=Object.fromEntries('+JSON.stringify(ids)+'.map(id=>[id,document.getElementById(id)]));return Object.fromEntries('+JSON.stringify(ids)+'.map(id=>[id,!!document.getElementById(id)]))})()');
  for(const id of ids)assert.ok(before[id],'stable scene control missing: '+id);
  const duplicates=await js<string[]>(win,'(()=>{const ids='+JSON.stringify(ids)+';return ids.filter(id=>document.querySelectorAll("#"+CSS.escape(id)).length!==1)})()');
  assert.deepEqual(duplicates,[]);
  check('scene stable-node references captured',{ids});
}
async function assertStableScene(win:BrowserWindowType):Promise<void>{
  const same=await js<boolean>(win,'(()=>Object.entries(window.__supply0110Stable||{}).every(([id,node])=>node===document.getElementById(id)&&node.isConnected))()');
  assert.ok(same,'scene controls were replaced during a worker update');
  check('scene and object DOM identity stayed stable through update');
}
async function auditGuests(win:BrowserWindowType,expectVisible=profile().job==='keeper'):Promise<void>{
  const rows=await js<Array<{id:string;label:string;title:string;need:string;exists:boolean;hidden:boolean}>>(win,'[0,1,2].map(i=>{const e=document.getElementById("lsGuest"+i);return{id:"lsGuest"+i,label:e?.getAttribute("aria-label")||e?.textContent?.trim()||"",need:document.getElementById("lsGuestNeed"+i)?.textContent?.trim()||"",title:e?.dataset.tooltip||e?.title||"",exists:!!e,hidden:!e||e.hidden||!!e.closest("[hidden]")}})');
  assert.equal(rows.length,3);
  for(let i=0;i<3;i++){
    const order=profile().business.orders[i],summary=rows[i].label+' '+rows[i].title;
    assert.ok(rows[i].exists,'guest slot '+i+' DOM node is absent');
    assert.equal(rows[i].hidden,!expectVisible,'guest visibility must match current employment state for slot '+i);
    assert.ok(summary.trim(),'guest slot '+i+' lacks accessible order identity');
    const expectedNeed=`${order.recipe==='ration'?'口粮':'魔晶餐'} ×${order.count}${order.accepted?' · 已接':''}`;
    assert.equal(rows[i].need,expectedNeed,'guest slot '+i+' must show the matching authoritative recipe/count/status');
    check(expectVisible?'keeper guest scene slot maps to current real business order '+i:'visitor has no visible order guest before employment '+i,{scene:rows[i],expectedNeed,order:{recipe:order.recipe,count:order.count,accepted:order.accepted,revision:order.revision},expectVisible,evidence:'authoritative business.orders profile state'});
  }
}
async function auditLegacyAndSpecialSceneStock(win:BrowserWindowType):Promise<void>{
  const state=await js<{legacyLabel:string;legacyTip:string;rationHidden:boolean;crystalHidden:boolean;specialBadge:{hidden:boolean;text:string};specialTip:string}>(win,'(()=>{const r=document.getElementById("livingScene"),q=(s)=>r.querySelector(s);return{legacyLabel:document.getElementById("lsShelfCount")?.textContent?.trim()||"",legacyTip:document.getElementById("lsShelf")?.dataset.tooltip||"",rationHidden:!!q(".ls-shelf-items [data-item=ration]")?.hidden,crystalHidden:!!q(".ls-shelf-items [data-item=crystal]")?.hidden,specialBadge:{hidden:!!document.getElementById("lsSpecialCount")?.hidden,text:document.getElementById("lsSpecialCount")?.textContent?.trim()||""},specialTip:document.getElementById("lsRecipes")?.dataset.tooltip||""}})()');
  const p=profile(),legacy=!p.business.managed,ordinary=legacy?Math.max(0,p.bag.ration-2)+p.bag.crystal:p.business.shelves.ration.stock+p.business.shelves.crystal.stock,special=GOOD_IDS.filter(g=>FORMULAS[g].station==='supply').reduce((n,g)=>n+p.atelier!.shelves[g].stock,0);
  assert.equal(state.legacyLabel,legacy?`背包可售 ${ordinary}份`:`${ordinary}份在架`,'scene must show the inventory that the active sales mode can actually sell');
  if(legacy)assert.match(state.legacyTip,/保留2份/,'legacy shelf tooltip must state the ration reserve');
  assert.equal(state.rationHidden,(legacy?Math.max(0,p.bag.ration-2):p.business.shelves.ration.stock)===0,'ration art visibility follows actual sellable stock');
  assert.equal(state.crystalHidden,(legacy?p.bag.crystal:p.business.shelves.crystal.stock)===0,'crystal art visibility follows actual sellable stock');
  assert.equal(state.specialBadge.hidden,special===0,'special stock badge visibility');
  assert.equal(state.specialBadge.text,String(special),'special stock badge shows the combined real shelf count');
  assert.ok(state.specialTip.includes(`特色餐盒货台 ${special}份`),'recipe shortcut tooltip reflects actual specialty shelf count');
  check('scene inventory presentation reflects legacy bag sales and real specialty shelves',{state,expected:{ordinary,special},bag:{ration:p.bag.ration,crystal:p.bag.crystal},businessManaged:p.business.managed,atelierShelves:Object.fromEntries(GOOD_IDS.filter(g=>FORMULAS[g].station==='supply').map(g=>[g,p.atelier!.shelves[g].stock]))});
}
async function assertHiddenBoundary():Promise<void>{
  for(const win of BrowserWindow.getAllWindows()){assert.equal(win.isVisible(),false,'native window visible '+win.id);assert.equal(win.isFocused(),false,'native window focused '+win.id);}
  const skipped:number[]=[];
  for(const win of BrowserWindow.getAllWindows()){
    if(win.isDestroyed()||win.webContents.isDestroyed()||!page(win)){skipped.push(win.id);continue;}
    await instrument(win);
    const observed=await js<{keys:number;csp:unknown[]}>(win,'({keys:window.__supply0110Keys||0,csp:window.__supply0110Csp||[]})');
    keyboardByWindow[win.id]=observed.keys;
    cspByWindow[win.id]=[...(cspByWindow[win.id]??[]),...observed.csp.map(String)];
  }
  assert.equal(Object.values(keyboardByWindow).reduce((n,v)=>n+v,0),0,'renderer keyboard events observed');
  assert.equal(Object.values(cspByWindow).reduce((n,v)=>n+v.length,0),0,'CSP violations observed');
  assert.equal(suppression.globalShortcut??0,0,'globalShortcut was invoked');
  check('all native windows remain hidden/unfocused; zero keyboard events and CSP violations',{nativeWindows:snapshots(),suppression,keyboardByWindow,cspByWindow,skipped});
}
async function auditMotionGates(win:BrowserWindowType):Promise<void>{
  const source=await js<{visibility:string;state:{workingElsewhere:boolean;suspended:boolean};animations:Array<{name:string;state:string;target:string}>;hoverTargets:number}>(win,'(()=>{const s=document.getElementById("livingScene"),animations=document.getAnimations({subtree:true}).map(a=>({name:a.animationName||a.constructor.name,state:a.playState,target:a.effect?.target?.id||a.effect?.target?.className||""}));return{visibility:document.visibilityState,state:{workingElsewhere:document.body.dataset.workingElsewhere==="true",suspended:document.body.dataset.suspended==="true"},animations,hoverTargets:s?.querySelectorAll(":hover").length||0}})()');
  check('initial renderer motion state sampled without physical hover',source,'INFO');
  const currentNative={isVisible:win.isVisible(),isFocused:win.isFocused()};
  assert.deepEqual(currentNative,{isVisible:false,isFocused:false});
  check('motion sampling stayed within hidden native boundary',currentNative);
}
async function disabledHoverStyles(win:BrowserWindowType,id:string,reason?:RegExp):Promise<void>{
  const disabled=await assertControl(win,id,false);if(reason)assert.match(disabled.tip,reason,id+' disabled reason');
  const debuggerApi=win.webContents.debugger,wasAttached=debuggerApi.isAttached();
  let nodeId:number|undefined;
  try{
    if(!wasAttached)debuggerApi.attach('1.3');
    await debuggerApi.sendCommand('DOM.enable');await debuggerApi.sendCommand('CSS.enable');
    const documentNode=await debuggerApi.sendCommand('DOM.getDocument',{depth:-1,pierce:true});
    const node=await debuggerApi.sendCommand('DOM.querySelector',{nodeId:documentNode.root.nodeId,selector:'#'+id});nodeId=node.nodeId;
    assert.ok(nodeId,'CDP could not resolve disabled hover target '+id);
    const sample=()=>js<{filter:string;outline:string;outlineWidth:string;outlineColor:string;boxShadow:string;background:string;borderColor:string;opacity:string;tagBackground:string;tagBorder:string;tagColor:string}>(win,'(()=>{const e=document.getElementById('+JSON.stringify(id)+'),s=getComputedStyle(e),t=e.querySelector(".ls-tag"),ts=t&&getComputedStyle(t);return{filter:s.filter,outline:s.outline,outlineWidth:s.outlineWidth,outlineColor:s.outlineColor,boxShadow:s.boxShadow,background:s.backgroundColor,borderColor:s.borderColor,opacity:s.opacity,tagBackground:ts?.backgroundColor||"",tagBorder:ts?.borderColor||"",tagColor:ts?.color||""}})()');
    const before=await sample();
    await debuggerApi.sendCommand('CSS.forcePseudoState',{nodeId,forcedPseudoClasses:['hover']});
    const hovered=await sample();
    await debuggerApi.sendCommand('CSS.forcePseudoState',{nodeId,forcedPseudoClasses:[]});
    assert.deepEqual(hovered,before,'disabled cashbox visual styles must not gain a hover highlight');
    check('disabled control remains visually disabled under forced CSS :hover',{id,tooltip:disabled.tip,before,forcedHover:hovered,probe:'Chrome DevTools CSS.forcePseudoState on hidden renderer; not physical hover'});
  }finally{
    if(nodeId!==undefined){try{await debuggerApi.sendCommand('CSS.forcePseudoState',{nodeId,forcedPseudoClasses:[]});}catch{}}
    if(!wasAttached&&debuggerApi.isAttached())debuggerApi.detach();
  }
  assert.equal(win.isVisible(),false);assert.equal(win.isFocused(),false);
}
async function auditSoftwareMotionGate(win:BrowserWindowType):Promise<void>{
  assert.ok(shell);const nativeBefore={isVisible:win.isVisible(),isFocused:win.isFocused()};
  assert.deepEqual(nativeBefore,{isVisible:false,isFocused:false});
  const actualDocument=await js<{visibility:string;hidden:boolean;hasFocus:boolean}>(win,'({visibility:document.visibilityState,hidden:document.hidden,hasFocus:document.hasFocus()})');
  const fakeVisible=await js<{visibility:string;hidden:boolean;hasFocus:boolean;motion:string}>(win,'(()=>{window.__supply0110SavedDocumentDescriptors=Object.fromEntries(["hidden","visibilityState","hasFocus"].map(k=>[k,Object.getOwnPropertyDescriptor(document,k)||null]));Object.defineProperty(document,"hidden",{configurable:true,get:()=>false});Object.defineProperty(document,"visibilityState",{configurable:true,get:()=>"visible"});Object.defineProperty(document,"hasFocus",{configurable:true,value:()=>false});return{visibility:document.visibilityState,hidden:document.hidden,hasFocus:document.hasFocus(),motion:document.getElementById("livingScene").dataset.motion}})()');
  let restored=false;
  try{
    await js(win,'document.getElementById("livingScene").dispatchEvent(new PointerEvent("pointerenter"))');
    await until(()=>js<boolean>(win,'document.getElementById("livingScene").dataset.motion==="running"'),'software visible, unfocused renderer starts local motion from pointerenter');
    const running=await js<string>(win,'document.getElementById("livingScene").dataset.motion');
    assert.equal(running,'running');
    await js(win,'window.dispatchEvent(new Event("blur"))');
    await until(()=>js<boolean>(win,'document.getElementById("livingScene").dataset.motion==="paused"'),'software blur pauses local motion');
    await js(win,'document.getElementById("livingScene").dispatchEvent(new PointerEvent("pointerenter"))');
    await js(win,'document.getElementById("livingScene").dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,isPrimary:true}))');
    const afterUntrusted=await js<string>(win,'document.getElementById("livingScene").dataset.motion');
    assert.equal(afterUntrusted,'paused','untrusted re-enter and pointerdown must not clear the blur latch');
    const hiddenDocument=await js<{visibility:string;hidden:boolean;hasFocus:boolean;motion:string}>(win,'(()=>{Object.defineProperty(document,"hidden",{configurable:true,get:()=>true});Object.defineProperty(document,"visibilityState",{configurable:true,get:()=>"hidden"});Object.defineProperty(document,"hasFocus",{configurable:true,value:()=>false});document.dispatchEvent(new Event("visibilitychange"));return{visibility:document.visibilityState,hidden:document.hidden,hasFocus:document.hasFocus(),motion:document.getElementById("livingScene").dataset.motion}})()');
    assert.equal(hiddenDocument.hidden,true,'software hidden-document fixture state');
    assert.equal(hiddenDocument.motion,'paused','visibility hidden pauses scene motion');
    const beforeLifecycle=shell.state();
    app.emit('did-resign-active');
    await until(()=>shell!.state().workingElsewhere===true&&shell!.state().popup?.suspended===true,'authoritative shell state blocks motion');
    await until(()=>js<boolean>(win,'document.hidden&&document.getElementById("livingScene").dataset.motion==="paused"'),'software hidden-document fixture stays paused while main shell is suspended');
    const rendererDuringSuspend=await js<{bodySuspended:string;hidden:boolean;motion:string}>(win,'({bodySuspended:document.body.dataset.suspended||"",hidden:document.hidden,motion:document.getElementById("livingScene").dataset.motion})');
    app.emit('did-become-active');shell.enter();
    await until(()=>shell!.state().workingElsewhere===false&&shell!.state().popup?.suspended===false,'authoritative shell resume releases motion gate');
    await until(()=>js<boolean>(win,'document.body.dataset.suspended==="false"'),'renderer observes authoritative resume before motion assertion');
    const resumedSoftwareHidden=await js<{visibility:string;hidden:boolean;hasFocus:boolean;motion:string}>(win,'({visibility:document.visibilityState,hidden:document.hidden,hasFocus:document.hasFocus(),motion:document.getElementById("livingScene").dataset.motion})');
    assert.equal(resumedSoftwareHidden.hidden,true,'the software hidden-document fixture remains hidden after main-state resume');
    assert.equal(resumedSoftwareHidden.hasFocus,false,'the software focus getter remains false');
    await js(win,'(()=>{Object.defineProperty(document,"hidden",{configurable:true,get:()=>false});Object.defineProperty(document,"visibilityState",{configurable:true,get:()=>"visible"});Object.defineProperty(document,"hasFocus",{configurable:true,value:()=>false});document.dispatchEvent(new Event("visibilitychange"));return true})()');
    await until(()=>js<boolean>(win,'document.getElementById("livingScene").dataset.motion==="paused"'),'software visible but unfocused renderer waits for local pointer');
    await js(win,'document.getElementById("livingScene").dispatchEvent(new PointerEvent("pointerenter"))');
    await until(()=>js<boolean>(win,'document.getElementById("livingScene").dataset.motion==="running"'),'software visibility restore plus pointerenter starts scene without focus');
    check('motion boundary: unfocused pointerenter animates; untrusted blur recovery stays paused; software hidden document pauses; software visibility restore plus pointerenter resumes',{actualDocument,fakeVisible,beforeLifecycle:{workingElsewhere:beforeLifecycle.workingElsewhere,suspended:beforeLifecycle.popup?.suspended},afterUntrusted,hiddenDocument,rendererDuringSuspend,afterResume:{workingElsewhere:shell.state().workingElsewhere,suspended:shell.state().popup?.suspended,document:resumedSoftwareHidden,motion:await js<string>(win,'document.getElementById("livingScene").dataset.motion')},native:{isVisible:win.isVisible(),isFocused:win.isFocused()},fixture:'temporary document visibility getters and dispatched visibilitychange/pointer events plus direct Electron lifecycle events; native window stayed hidden/unfocused; no physical input'});
  }finally{
    await js(win,'(()=>{for(const [k,d] of Object.entries(window.__supply0110SavedDocumentDescriptors||{})){if(d)Object.defineProperty(document,k,d);else delete document[k]}delete window.__supply0110SavedDocumentDescriptors;document.dispatchEvent(new Event("visibilitychange"));return{visibility:document.visibilityState,hidden:document.hidden,hasFocus:document.hasFocus()}})()');
    restored=true;
  }
  assert.ok(restored);assert.equal(win.isVisible(),false);assert.equal(win.isFocused(),false);
  check('temporary renderer visibility/focus getter overrides restored on hidden unfocused window',{native:{isVisible:win.isVisible(),isFocused:win.isFocused()},restored});
}
async function withSoftwareVisibleRenderer<T>(win:BrowserWindowType,label:string,run:()=>Promise<T>):Promise<T>{
  const original=await js<{visibility:string;hidden:boolean;hasFocus:boolean}>(win,'(()=>{window.__supply0110SavedDocumentDescriptors=Object.fromEntries(["hidden","visibilityState","hasFocus"].map(k=>[k,Object.getOwnPropertyDescriptor(document,k)||null]));Object.defineProperty(document,"hidden",{configurable:true,get:()=>false});Object.defineProperty(document,"visibilityState",{configurable:true,get:()=>"visible"});Object.defineProperty(document,"hasFocus",{configurable:true,value:()=>false});document.dispatchEvent(new Event("visibilitychange"));return{visibility:document.visibilityState,hidden:document.hidden,hasFocus:document.hasFocus()}})()');
  try{
    await js(win,'Object.defineProperty(document,"hidden",{configurable:true,get:()=>true});Object.defineProperty(document,"visibilityState",{configurable:true,get:()=>"hidden"});document.dispatchEvent(new Event("visibilitychange"));window.dispatchEvent(new Event("blur"));document.getElementById("livingScene").dispatchEvent(new PointerEvent("pointerenter"))');
    await until(()=>js<boolean>(win,'document.getElementById("livingScene").dataset.motion==="paused"'),label+' unfocused blur gate');
    await js(win,'Object.defineProperty(document,"hidden",{configurable:true,get:()=>false});Object.defineProperty(document,"visibilityState",{configurable:true,get:()=>"visible"});document.dispatchEvent(new Event("visibilitychange"))');
    await js(win,'document.getElementById("livingScene").dispatchEvent(new PointerEvent("pointerenter"))');
    await until(()=>js<boolean>(win,'document.getElementById("livingScene").dataset.motion==="running"'),label+' software-visible unfocused pointer motion state');
    const result=await run();
    check(label+' inspected while hidden native renderer used temporary visible/unfocused getters',{softwareDocument:original,motion:await js<string>(win,'document.getElementById("livingScene").dataset.motion'),native:{isVisible:win.isVisible(),isFocused:win.isFocused()},fixture:'temporary document visibility overrides, software blur/visibilitychange/pointerenter only; hasFocus stayed false, no native activation or physical input'});
    return result;
  }finally{
    await js(win,'(()=>{for(const [k,d] of Object.entries(window.__supply0110SavedDocumentDescriptors||{})){if(d)Object.defineProperty(document,k,d);else delete document[k]}delete window.__supply0110SavedDocumentDescriptors;document.dispatchEvent(new Event("visibilitychange"));return{visibility:document.visibilityState,hidden:document.hidden,hasFocus:document.hasFocus()}})()');
    assert.equal(win.isVisible(),false);assert.equal(win.isFocused(),false);
  }
}
async function suspendAndResumeMotion(win:BrowserWindowType):Promise<void>{
  assert.ok(shell);
  const generation=shell.popup?.generation;assert.ok(generation);
  const before=shell.state();
  app.emit('did-resign-active');
  await until(()=>shell!.state().workingElsewhere===true&&shell!.state().popup?.suspended===true,'shell state suspended for work');
  await until(()=>js<boolean>(win,'document.hidden&&document.getElementById("livingScene").dataset.motion==="paused"'),'hidden renderer remains paused during main suspension');
  const suspended=await js<{visibility:string;bodySuspended:string;animations:Array<{name:string;state:string}>}>(win,'({visibility:document.visibilityState,bodySuspended:document.body.dataset.suspended||"",animations:document.getAnimations({subtree:true}).map(a=>({name:a.animationName||a.constructor.name,state:a.playState}))})');
  check('software lifecycle probe suspends main popup and hidden renderer motion',{before:{workingElsewhere:before.workingElsewhere,suspended:before.popup?.suspended},after:{workingElsewhere:shell.state().workingElsewhere,suspended:shell.state().popup?.suspended},renderer:suspended,input:'direct app.did-resign-active event; hidden popup is excluded from suspended state broadcasts; not a real OS app switch'});
  assert.equal(win.isVisible(),false);assert.equal(win.isFocused(),false);
  app.emit('did-become-active');
  shell.enter();
  await until(()=>shell!.state().workingElsewhere===false&&shell!.state().popup?.suspended===false,'shell state resumed');
  await until(()=>js<boolean>(win,'document.body.dataset.suspended==="false"'),'renderer observes resume after lifecycle probe');
  const resumed=await js<{hidden:boolean;motion:string}>(win,'({hidden:document.hidden,motion:document.getElementById("livingScene").dataset.motion})');
  assert.deepEqual(resumed,{hidden:true,motion:'paused'});
  check('software lifecycle probe resumes main shell state while hidden native renderer stays paused',{workingElsewhere:shell.state().workingElsewhere,suspended:shell.state().popup?.suspended,renderer:resumed,native:{isVisible:win.isVisible(),isFocused:win.isFocused()},input:'direct lifecycle event plus DesktopShell.enter(); not a real OS app switch'});
}
function makeFreshProfile(now:number):Profile{
  return parseProfile(initialProfile(now));
}
function makeKeeperSmokeProfile(now:number):Profile{
  const p=initialProfile(now);p.job='keeper';p.coins=420;p.bag.flour=80;p.bag.ration=4;p.bag.crystal=2;
  p.business.managed=true;p.business.till=38;p.business.shelves.ration={stock:4,tier:'quick',due:p.tick+PRICE_TIERS.quick.ticks};p.retail=true;
  return parseProfile(p);
}
function makeRichProfile(now:number):Profile{
  const p=initialProfile(now);
  p.job='keeper';p.coins=2_000_000;p.xp=100;p.camp=initialCamp();p.leisure.companions.guard=0;p.camp.jobs.counter='guard';p.bag={flour:20_000,ration:14,crystal:3,gel:10};
  p.business.managed=false;p.business.till=0;p.business.reputation=0;p.business.completed=0;
  p.business.shelves.ration={stock:0,tier:'normal',due:p.tick+PRICE_TIERS.normal.ticks};
  p.business.shelves.crystal={stock:0,tier:'normal',due:p.tick+PRICE_TIERS.normal.ticks};p.retail=false;p.nextSale=0;
  p.leisure.materials.herb=2_000;p.leisure.materials.berry=2_000;p.leisure.materials.mushroom=2_000;
  p.leisure.materials.ore=5_000;p.leisure.materials.pumpkin=1_000;p.leisure.materials.snowflower=1_000;
  p.leisure.materials.tea=1_000;p.leisure.materials.biscuit=1_000;p.leisure.materials.soup=1_000;
  p.leisure.materials.pie=1_000;p.leisure.materials.snowtea=1_000;
  const atelier=initialAtelier();atelier.till=321;
  for(const good of GOOD_IDS){atelier.stock[good]=300;atelier.made[good]=150;}
  atelier.shelves.picnic={stock:5,quote:'quick',due:p.tick+PRICE_TIERS.quick.ticks};
  atelier.stock.ingot=300;p.atelier=atelier;
  return parseProfile(p);
}
async function smokeScenario():Promise<void>{
  const keeper=scenario==='smoke-keeper',job=keeper?'keeper':'visitor';
  const initial=profile();assert.equal(initial.version,8);assert.equal(initial.job,job);assert.equal(Object.hasOwn(initial,'atelier'),false);
  const win=await openBakery();
  win.setSize(760,650);await new Promise(resolve=>setTimeout(resolve,180));
  assert.deepEqual(win.getSize(),[760,650],'default smoke viewport dimensions');
  await capture(win,job+'-scene-760x650');
  const stableIds=['livingScene','lsCounter','lsSupplies','lsOven','lsShelf','lsGuest0','lsGuest1','lsGuest2','lsLedger','lsCollect','lsRecipes','lsStudy','lsOrders','lsOpen','lsBuddy'];
  win.setSize(1040,650);await new Promise(resolve=>setTimeout(resolve,180));
  assert.deepEqual(win.getSize(),[1040,650],'compact smoke viewport dimensions');
  await capture(win,job+'-scene-1040x650',{width:620,height:500});
  await auditLayout(win,job+' scene 760x650');
  await auditLayout(win,job+' scene 1040x650');
  await auditGuests(win,keeper);
  await auditStableScene(win,stableIds);
  win.setSize(760,650);await new Promise(resolve=>setTimeout(resolve,180));
  const before=profile().sequence;
  const destinations=['lsCounter','lsSupplies','lsOven','lsShelf','lsLedger','lsRecipes','lsStudy','lsOrders',...(keeper?['lsGuest0','lsGuest1','lsGuest2']:[])];
  for(const id of destinations){
    await sceneAction(win,id);await auditLayout(win,'workspace '+id);await capture(win,'workspace-'+id);
    await backToScene(win);await assertStableScene(win);
  }
  if(!keeper)await assertControl(win,'lsCollect',false);else await assertControl(win,'lsCollect',true);
  if(!keeper)await assertControl(win,'lsOpen',false);else await assertControl(win,'lsOpen',true);
  assert.equal(profile().sequence,before,'read-only first-open scene changed profile');
  assert.equal(Object.hasOwn(profile(),'atelier'),false,'scene traversal must not initialize Atelier');
  await auditMotionGates(win);
  await suspendAndResumeMotion(win);
  const prior=structuredClone(profile());
  await clickElement(win,'popupClose');await until(()=>shell?.popup===null,'close supply popup');
  const reopened=await openBakery();assert.equal(profile().sequence,prior.sequence);assert.equal(profile().job,prior.job);
  await capture(reopened,job+'-scene-reopen-760x650');
  check('close/reopen returns to the supply scene without profile mutation',{sequence:profile().sequence,job:profile().job,atelierPresent:Object.hasOwn(profile(),'atelier')});
}
async function freshScenario():Promise<void>{
  assert.equal(profile().job,'visitor');let win=await openBakery();
  await auditGuests(win,false);
  await disabledHoverStyles(win,'lsCollect',/任职|货款/);
  for(const width of [760,1040]){win.setSize(width,650);await new Promise(resolve=>setTimeout(resolve,180));assert.deepEqual(win.getSize(),[width,650],'fresh visitor scene viewport');await auditLayout(win,'fresh visitor scene '+width);await capture(win,'fresh-visitor-scene-'+width+'x650',{width:620,height:500});}win.setSize(760,650);await new Promise(resolve=>setTimeout(resolve,180));

  const beforeUnlicensed=structuredClone(profile());
  await sceneAction(win,'lsSupplies');await shopTab(win,'Supply');await auditLayout(win,'unhired raw procurement');await capture(win,'fresh-unhired-procurement-760',{width:620,height:500});
  await disabledControl(win,'buyFlour',/正式任职/);await disabledControl(win,'merchantBulk-flour',/正式任职/);
  const unlicensedPurchaseSequence=profile().sequence;await clickElement(win,'buyFlour');await clickElement(win,'merchantBulk-flour');assert.equal(profile().sequence,unlicensedPurchaseSequence,'disabled procurement must not send worker actions');await backToScene(win);

  await sceneAction(win,'lsOven');await shopTab(win,'Craft');await auditLayout(win,'unhired ordinary recipes');await disabledControl(win,'craftRation',/应聘学徒/);await disabledControl(win,'queueRation',/正式任职/);
  const unlicensedCraftSequence=profile().sequence;await clickElement(win,'craftRation');await clickElement(win,'queueRation');assert.equal(profile().sequence,unlicensedCraftSequence,'disabled ordinary recipes must not send worker actions');await backToScene(win);

  await sceneAction(win,'lsRecipes');await shopTab(win,'Specials');await atelierTab(win,'craft');await openMarket(win);await auditLayout(win,'unhired specialty recipe and raw market');await capture(win,'fresh-unhired-specialty-760',{width:620,height:500});
  await localClick(win,'aPick-picnic');assert.equal(await js<string>(win,'document.getElementById("aName").textContent.trim()'),FORMULAS.picnic.name,'visitor can inspect the selected specialty recipe');
  await disabledControl(win,'aBuy1-herb',/完成任职试餐/);await disabledControl(win,'aCraft',/完成任职试餐/);
  const unlicensedAtelierSequence=profile().sequence;await clickElement(win,'aBuy1-herb');await clickElement(win,'aCraft');assert.equal(profile().sequence,unlicensedAtelierSequence,'disabled Atelier purchase/craft must not send worker actions');
  assert.equal(Object.hasOwn(profile(),'atelier'),false,'unhired browsing must not initialize optional Atelier progress');
  assert.deepEqual(profile(),advance(beforeUnlicensed,profile().wallAt),'unhired browsing changed profile beyond the ordinary worker clock');
  await backToScene(win);

  await sceneAction(win,'lsCounter');
  await auditLayout(win,'fresh visitor job offer');await capture(win,'fresh-job-offer-760',{width:620,height:500});
  await assertControl(win,'applyJob',true);
  const visitorJobState=await js<{jobPanelHidden:boolean;trialHidden:boolean;deliverHidden:boolean}>(win,'({jobPanelHidden:document.getElementById("jobPanel").hidden,trialHidden:document.getElementById("trialCraft").hidden,deliverHidden:document.getElementById("deliverTrial").hidden})');
  assert.deepEqual(visitorJobState,{jobPanelHidden:false,trialHidden:true,deliverHidden:true},'visitor should see the offer but not apprentice-only actions');
  const beforeHire=profile();await actionClick(win,'applyJob');
  assert.equal(profile().job,'apprentice');assert.equal(profile().bag.flour,beforeHire.bag.flour+4);
  await until(()=>js<boolean>(win,'!document.getElementById("trialCraft").hidden&&!document.getElementById("deliverTrial").hidden'),'apprentice actions become visible');await capture(win,'fresh-job-apprentice-offer-760',{width:620,height:500});
  await actionClick(win,'trialCraft',true);
  assert.equal(profile().bag.flour,beforeHire.bag.flour+2,'one trial consumed exactly two flour despite double click');
  const queuedTrial=profile().queue;
  assert.ok(queuedTrial&&queuedTrial.recipe==='ration'&&queuedTrial.remaining===1,'one trial batch should be queued');
  await capture(win,'fresh-trial-in-progress-760',{width:620,height:500});
  const trialQueue=structuredClone(queuedTrial),trialTick=profile().tick;
  await advanceWorker(7_000,'apprentice trial meal');
  assert.ok(profile().tick>=trialTick+60);assert.equal(profile().bag.ration,beforeHire.bag.ration+1);
  assert.equal(profile().queue,null);check('complete trial meal advances only through worker test clock',{trialQueue,profileQueue:profile().queue,ration:profile().bag.ration});
  const beforeFormal=profile().coins;await actionClick(win,'deliverTrial');
  assert.equal(profile().job,'keeper');assert.equal(profile().coins,beforeFormal+30);assert.equal(profile().bag.ration,beforeHire.bag.ration);
  await capture(win,'fresh-formal-hire-760',{width:620,height:500});
  await assertStableScene(win);await backToScene(win);await auditGuests(win,true);
  await sceneAction(win,'lsSupplies');
  await shopTab(win,'Specials');await atelierTab(win,'craft');await openMarket(win);
  const beforeHerb=profile().leisure.materials.herb,beforeSequence=profile().sequence;
  await actionClick(win,'aBuy1-herb',true);
  assert.equal(profile().leisure.materials.herb,beforeHerb+1);assert.equal(profile().sequence,beforeSequence+1);
  await backToScene(win);
  await sceneAction(win,'lsOven');await shopTab(win,'Craft');await clickSelector(win,'[data-batch="1"]');
  const flourBefore=profile().bag.flour;await actionClick(win,'queueRation',true);
  assert.equal(profile().bag.flour,flourBefore-2);assert.equal(profile().queue?.remaining,1);
  await advanceWorker(7_000,'newly hired shop cooking');
  assert.equal(profile().queue,null);assert.equal(profile().bag.ration,beforeHire.bag.ration+1);
  await backToScene(win);
  await sceneAction(win,'lsGuest0');await shopTab(win,'Orders');
  const order=profile().business.orders[0];await actionClick(win,'acceptOrder-0');
  assert.equal(profile().business.orders[0].accepted,true);
  const coins=profile().coins,beforeDeliverySeq=profile().sequence;
  const reason=await control(win,'deliverOrder-0');
  if(profile().bag[order.recipe]<order.count){
    await disabledControl(win,'deliverOrder-0',/库存|不足|需要/);
    assert.equal(profile().sequence,beforeDeliverySeq);assert.equal(profile().coins,coins);
  }else{
    await actionClick(win,'deliverOrder-0');assert.equal(profile().business.completed,1);
  }
  await backToScene(win);
  await sceneAction(win,'lsLedger');await clickElement(win,'lifeOpen');
  await until(()=>js<boolean>(win,'!!document.getElementById("lifePanel-overview")&&!document.getElementById("lifePanel-overview").hidden'),'old management overview visible from new ledger workspace');
  check('new ledger scene preserves legacy management overview',{profile:{coins:profile().coins,job:profile().job,atelierPresent:Object.hasOwn(profile(),'atelier')},deliverReason:reason.tip});
  await auditLayout(win,'fresh ledger overview');
  await assertHiddenBoundary();
  await clickElement(win,'popupClose');await until(()=>shell?.popup===null,'close fresh supply scene');
  const reopened=await openBakery();assert.equal(profile().job,'keeper');await capture(reopened,'fresh-after-reopen');
  const reopenedProfile=profile(),reopenedAtelier=reopenedProfile.atelier;
  check('fresh progression and supply scene persist through close/reopen',{job:reopenedProfile.job,coins:reopenedProfile.coins,sequence:reopenedProfile.sequence,atelier:reopenedAtelier?{stock:reopenedAtelier.stock,facilities:reopenedAtelier.facilities}:null});
  await verifyReopenedSceneListener(reopened,'fresh');
}
async function richScenario():Promise<void>{
  assert.equal(profile().job,'keeper');assert.ok(profile().atelier);const win=await openBakery();
  await auditGuests(win,true);await auditLegacyAndSpecialSceneStock(win);await auditLayout(win,'rich entry scene');
  await auditStableScene(win,['livingScene','lsCounter','lsSupplies','lsOven','lsShelf','lsGuest0','lsGuest1','lsGuest2','lsLedger','lsCollect']);
  await auditSoftwareMotionGate(win);
  win.setSize(1040,650);await new Promise(resolve=>setTimeout(resolve,180));
  await auditLayout(win,'rich scene compact viewport 1040x650');
  await assertControl(win,'lsGuest2',true);
  await capture(win,'rich-scene-1040x650',{width:620,height:500});
  win.setSize(760,650);await new Promise(resolve=>setTimeout(resolve,180));
  await captureSupplyWorkspace(win);
  const noStockBefore=profile().totals.sold;await advanceWorker(60_000,'idle shelf must not invent sales');
  assert.equal(profile().totals.sold,noStockBefore);assert.equal(profile().business.till,0);assert.equal(profile().atelier!.till,321);
  check('idle shelf with no stock creates no sale or false receipt',{sold:profile().totals.sold,shopTill:profile().business.till,atelierTill:profile().atelier!.till});

  await sceneAction(win,'lsSupplies');await shopTab(win,'Supply');
  const flourBefore=profile().bag.flour,coinsBefore=profile().coins;
  await actionClick(win,'merchantBulk-flour',true);
  assert.equal(profile().bag.flour,flourBefore+50);assert.equal(profile().coins,coinsBefore-tradeQuote('flour','buy',50));
  await shopTab(win,'Specials');await atelierTab(win,'craft');await openMarket(win);
  const herbBefore=profile().leisure.materials.herb;await actionClick(win,'aBuy10-herb',true);
  assert.equal(profile().leisure.materials.herb,herbBefore+10);
  await backToScene(win);await assertStableScene(win);

  await sceneAction(win,'lsOven');await shopTab(win,'Craft');await clickSelector(win,'[data-batch="1"]');
  const rationBefore=profile().bag.ration,flourBeforeCraft=profile().bag.flour;
  const queued=await actionClick(win,'queueRation',true);
  assert.equal(queued.queue?.recipe,'ration');assert.equal(queued.queue?.remaining,1);assert.equal(queued.bag.flour,flourBeforeCraft-2);
  await actionClick(win,'cancelProduction-0');
  assert.equal(profile().queue,null);assert.equal(profile().bag.flour,flourBeforeCraft,'cancel refunds all unconsumed cooking material');
  const beforeCook=profile().sequence;await actionClick(win,'queueRation',true);assert.equal(profile().sequence,beforeCook+1);
  await advanceWorker(7_000,'supply cooking output');
  assert.equal(profile().queue,null);assert.equal(profile().bag.ration,rationBefore+1);
  await assertStableScene(win);await backToScene(win);

  await sceneAction(win,'lsGuest0');await shopTab(win,'Orders');
  const activeOrder=structuredClone(profile().business.orders[0]);
  const orderDescription=await js<string>(win,'document.getElementById("orderGoods-0")?.textContent?.trim()||""');
  assert.ok(orderDescription.includes(recipes[activeOrder.recipe].name)&&orderDescription.includes(String(activeOrder.count)),'customer detail does not describe the current authoritative order: '+orderDescription);
  check('new scene customer resolves to the existing business order without creating one',{order:activeOrder,description:orderDescription,orderCount:profile().business.orders.length});
  await backToScene(win);
  await verifyLegacySalesAndGuestRoutes(win);
  await verifyParallelSupplyQueuesAndFeedback(win);
  await verifyManagedShelfAtelierStudyAndCollection(win);
  await assertHiddenBoundary();
  const finalBefore=structuredClone(profile());await clickElement(win,'popupClose');await until(()=>shell?.popup===null,'close rich supply scene');
  const reopened=await openBakery();assert.equal(profile().sequence,finalBefore.sequence);assert.equal(profile().coins,finalBefore.coins);
  assert.deepEqual(profile().business,finalBefore.business);assert.deepEqual(profile().atelier,finalBefore.atelier);
  await capture(reopened,'rich-after-reopen');
  check('rich business state persists through close/reopen',{job:profile().job,coins:profile().coins,sequence:profile().sequence,business:{managed:profile().business.managed,till:profile().business.till,completed:profile().business.completed},atelier:{till:profile().atelier!.till,stock:profile().atelier!.stock,facilities:profile().atelier!.facilities}});
  await verifyReopenedSceneListener(reopened,'rich');
}

async function verifyLegacySalesAndGuestRoutes(win:BrowserWindowType):Promise<void>{
  assert.equal(profile().business.managed,false);assert.equal(profile().retail,false);await auditLegacyAndSpecialSceneStock(win);
  await actionClick(win,'lsOpen',true);assert.equal(profile().retail,true);
  const sale=await withSoftwareVisibleRenderer(win,'legacy NPC inventory sale',async()=>{
    const before=structuredClone(profile());await advanceToTick(before.nextSale,'legacy NPC vending due');
    return{before,after:structuredClone(profile()),feedback:await js<string>(win,'document.getElementById("lsFeedback").textContent.trim()')};
  });
  assert.equal(sale.after.bag.crystal,sale.before.bag.crystal-1,'legacy NPC vending prefers one crystal meal');
  assert.equal(sale.after.bag.ration,sale.before.bag.ration,'legacy NPC vending preserves ration while crystal meal remains');
  assert.equal(sale.after.coins,sale.before.coins+recipes.crystal.price);
  assert.equal(sale.after.business.till,sale.before.business.till);assert.equal(sale.after.totals.sold,sale.before.totals.sold+1);
  assert.equal(sale.after.totals.earned,sale.before.totals.earned+recipes.crystal.price);
  assert.match(sale.after.notice,/魔晶餐/);assert.match(sale.feedback,/旅人挑走了店里的补给/);
  check('unmanaged legacy inventory sale changes one crystal meal, wallet and earned total exactly once',{before:{bag:sale.before.bag,coins:sale.before.coins},after:{bag:sale.after.bag,coins:sale.after.coins,till:sale.after.business.till,sold:sale.after.totals.sold,earned:sale.after.totals.earned},feedback:sale.feedback});
  await auditLegacyAndSpecialSceneStock(win);
  await actionClick(win,'lsOpen',true);assert.equal(profile().retail,false);
  const closed=structuredClone(profile());await advanceWorker(60_000,'legacy NPC sales pause after close');
  assert.equal(profile().bag.crystal,closed.bag.crystal);assert.equal(profile().bag.ration,closed.bag.ration);assert.equal(profile().totals.sold,closed.totals.sold);
  check('closing legacy shop pauses its bag sales without automatic purchases',{before:{bag:closed.bag,coins:closed.coins},after:{bag:profile().bag,coins:profile().coins,retail:profile().retail}});
  for(let slot=0;slot<3;slot++){
    await sceneAction(win,'lsGuest'+slot);
    assert.equal(await js<string>(win,'document.getElementById("roomWorkspaceTitle").textContent'),'旅人的委托');
    await shopTab(win,'Orders');const order=profile().business.orders[slot];
    const detail=await js<string>(win,'document.getElementById("orderGoods-'+slot+'").textContent.trim()');
    assert.equal(detail,recipes[order.recipe].name+' ×'+order.count+' · 背包'+profile().bag[order.recipe]);
    check('keeper scene guest route maps to existing order '+slot,{order:{recipe:order.recipe,count:order.count,accepted:order.accepted,revision:order.revision},detail});
    await backToScene(win);
  }
  await auditGuests(win,true);await assertStableScene(win);
}

async function verifyParallelSupplyQueuesAndFeedback(win:BrowserWindowType):Promise<void>{
  await sceneAction(win,'lsRecipes');await shopTab(win,'Specials');await atelierTab(win,'craft');
  await localClick(win,'aPick-picnic');await localClick(win,'aQty1');
  const firstSpecialty=await actionClick(win,'aCraft',true);assert.equal(firstSpecialty.atelier!.queues.supply[0]?.good,'picnic');
  const firstBeforeCancel=structuredClone(profile()),firstQueue=firstBeforeCancel.atelier!.queues.supply[0]!;
  const cancelled=await actionClick(win,'aCancel0',true);
  assert.equal(cancelled.atelier!.queues.supply.length,0);
  assert.equal(cancelled.bag.flour,firstBeforeCancel.bag.flour+FORMULAS.picnic.cost.flour!*firstQueue.remaining);
  assert.equal(cancelled.leisure.materials.berry,firstBeforeCancel.leisure.materials.berry+FORMULAS.picnic.cost.berry!*firstQueue.remaining);
  assert.equal(cancelled.bag.gel,firstBeforeCancel.bag.gel+FORMULAS.picnic.cost.gel!*firstQueue.remaining);
  check('specialty supply cancellation refunds every unconsumed ingredient exactly once',{before:firstQueue,after:{flour:cancelled.bag.flour,berry:cancelled.leisure.materials.berry,gel:cancelled.bag.gel}});

  await localClick(win,'aPick-picnic');await localClick(win,'aQty1');
  const queued=await actionClick(win,'aCraft',true);assert.equal(queued.atelier!.queues.supply[0]?.good,'picnic');
  const specialtyDue=queued.atelier!.queues.supply[0]!.due;
  await advanceToTick(specialtyDue-50,'specialty queue reaches 50 ticks remaining before ordinary production is queued');
  await shopTab(win,'Craft');await clickSelector(win,'[data-batch="1"]');
  const ordinary=await actionClick(win,'queueRation',true);assert.equal(ordinary.queue?.recipe,'ration');assert.equal(ordinary.queue?.remaining,1);
  assert.ok(specialtyDue<ordinary.queue!.due,'specialty queue should finish before the parallel ordinary queue');
  await backToScene(win);
  const summary=await js<string>(win,'document.getElementById("lsProduction").textContent.trim()');
  const remaining=Math.max(0,Math.ceil((specialtyDue-profile().tick)/10));
  assert.equal(summary,'2份 · '+remaining+'秒','scene summary uses the earliest supply completion');
  await sceneAction(win,'lsOven');assert.equal(await js<string>(win,'document.getElementById("roomWorkspaceTitle").textContent'),'特色餐盒');
  assert.equal(await js<boolean>(win,'!document.getElementById("aPanel-craft").hidden'),true);
  check('parallel queues route the shared oven to the specialty queue with the earlier due time',{specialtyDue,ordinaryDue:ordinary.queue!.due,remainingTicks:Math.max(0,specialtyDue-profile().tick),workspace:await js<string>(win,'document.getElementById("roomWorkspaceTitle").textContent')});
  await backToScene(win);
  const parallelBefore=structuredClone(profile());
  await advanceToTick(ordinary.queue!.due,'parallel specialty and ordinary outputs settle in due order');
  assert.equal(profile().queue,null);assert.equal(profile().atelier!.queues.supply.length,0);
  assert.equal(profile().bag.ration,parallelBefore.bag.ration+1);
  assert.equal(profile().atelier!.made.picnic,parallelBefore.atelier!.made.picnic+1);
  assert.equal(profile().atelier!.stock.picnic,parallelBefore.atelier!.stock.picnic+1);
  check('parallel queue completion updates ordinary and specialty inventories once',{before:{ration:parallelBefore.bag.ration,picnicMade:parallelBefore.atelier!.made.picnic,picnicStock:parallelBefore.atelier!.stock.picnic},after:{ration:profile().bag.ration,picnicMade:profile().atelier!.made.picnic,picnicStock:profile().atelier!.stock.picnic}});

  await sceneAction(win,'lsOven');assert.equal(await js<string>(win,'document.getElementById("roomWorkspaceTitle").textContent'),'炉灶制作');
  await shopTab(win,'Craft');await clickSelector(win,'[data-batch="1"]');
  await actionClick(win,'queueRation',true);
  await backToScene(win);
  const rationCook=await withSoftwareVisibleRenderer(win,'ordinary ration craft completion',async()=>{
    const before=structuredClone(profile());assert.ok(before.queue);await advanceToTick(before.queue.due,'ordinary ration output');
    return{before,after:structuredClone(profile()),feedback:await js<string>(win,'document.getElementById("lsFeedback").textContent.trim()')};
  });
  assert.equal(rationCook.after.queue,null);assert.equal(rationCook.after.bag.ration,rationCook.before.bag.ration+1);
  assert.equal(rationCook.after.totals.crafted,rationCook.before.totals.crafted+1);assert.match(rationCook.after.notice,/旅行口粮/);
  assert.equal(rationCook.feedback,'新的补给已经制作完成');

  await sceneAction(win,'lsOven');await shopTab(win,'Craft');await clickSelector(win,'[data-batch="1"]');
  const crystalQueued=await actionClick(win,'queueCrystal',true);assert.equal(crystalQueued.queue?.recipe,'crystal');
  await backToScene(win);
  const crystalCook=await withSoftwareVisibleRenderer(win,'crystal meal craft completion',async()=>{
    const before=structuredClone(profile());assert.ok(before.queue);await advanceToTick(before.queue.due,'ordinary crystal meal output');
    return{before,after:structuredClone(profile()),feedback:await js<string>(win,'document.getElementById("lsFeedback").textContent.trim()')};
  });
  assert.equal(crystalCook.after.bag.crystal,crystalCook.before.bag.crystal+1);assert.equal(crystalCook.after.totals.crafted,crystalCook.before.totals.crafted+1);
  assert.match(crystalCook.after.notice,/魔晶餐/);assert.equal(crystalCook.feedback,'新的补给已经制作完成');assert.doesNotMatch(crystalCook.feedback,/口粮/);

  await sceneAction(win,'lsRecipes');await shopTab(win,'Specials');await atelierTab(win,'craft');
  await localClick(win,'aPick-picnic');await localClick(win,'aQty1');
  const picnicIngredients=structuredClone(profile());
  const created=await actionClick(win,'aCraft',true);assert.equal(created.atelier!.queues.supply[0]?.good,'picnic');
  assert.equal(created.bag.flour,picnicIngredients.bag.flour-FORMULAS.picnic.cost.flour!);
  assert.equal(created.leisure.materials.berry,picnicIngredients.leisure.materials.berry-FORMULAS.picnic.cost.berry!);
  assert.equal(created.bag.gel,picnicIngredients.bag.gel-FORMULAS.picnic.cost.gel!);
  await backToScene(win);
  const picnicCook=await withSoftwareVisibleRenderer(win,'specialty picnic craft completion',async()=>{
    const before=structuredClone(profile()),due=before.atelier!.queues.supply[0]!.due;await advanceToTick(due,'specialty picnic output');
    return{before,after:structuredClone(profile()),feedback:await js<string>(win,'document.getElementById("lsFeedback").textContent.trim()')};
  });
  assert.equal(picnicCook.after.atelier!.made.picnic,picnicCook.before.atelier!.made.picnic+1);
  assert.equal(picnicCook.after.atelier!.stock.picnic,picnicCook.before.atelier!.stock.picnic+1);
  assert.equal(picnicCook.after.totals.crafted,picnicCook.before.totals.crafted);
  assert.equal(picnicCook.after.bag.flour,picnicCook.before.bag.flour,'materials are prepaid when queued and stay deducted on completion');
  assert.equal(picnicCook.feedback,'新的特色餐盒已经入库');assert.doesNotMatch(picnicCook.feedback,/口粮/);
  await assertStableScene(win);
}

async function verifyManagedShelfAtelierStudyAndCollection(win:BrowserWindowType):Promise<void>{
  await sceneAction(win,'lsGuest0');await shopTab(win,'Orders');
  const order=structuredClone(profile().business.orders[0]),beforeAccept=structuredClone(profile());
  const accepted=await actionClick(win,'acceptOrder-0',true);assert.equal(accepted.business.orders[0].accepted,true);
  assert.equal(accepted.sequence,beforeAccept.sequence+1);
  const beforeDeliver=structuredClone(profile()),reward=orderReward(order),delivered=await actionClick(win,'deliverOrder-0',true);
  assert.equal(delivered.business.completed,beforeDeliver.business.completed+1);assert.equal(delivered.business.reputation,beforeDeliver.business.reputation+1);
  assert.equal(delivered.business.orders[0].revision,order.revision+1);assert.equal(delivered.business.orders[0].accepted,false);
  assert.equal(delivered.bag[order.recipe],beforeDeliver.bag[order.recipe]-order.count);
  assert.equal(delivered.coins,beforeDeliver.coins+reward);assert.equal(delivered.totals.earned,beforeDeliver.totals.earned+reward);
  await backToScene(win);await auditGuests(win,true);

  await sceneAction(win,'lsShelf');await shopTab(win,'Manage');assert.equal(profile().business.managed,false);
  const bagBeforeStock=profile().bag.ration;await actionClick(win,'stock-ration',true);
  assert.equal(profile().business.managed,true);assert.equal(profile().business.shelves.ration.stock,5);assert.equal(profile().bag.ration,bagBeforeStock-5);
  await actionClick(win,'price-ration-quick',true);
  const price=salePrice('ration','quick')+jobPower(profile(),'counter');
  assert.equal(jobPower(profile(),'counter'),1,'rich fixture includes an active counter companion job');
  const priceText=await js<string>(win,'document.getElementById("price-ration-quick").querySelector("span").textContent.trim()');
  assert.equal(priceText,price+'金币 / '+PRICE_TIERS.quick.ticks/10+'秒','ordinary price label includes actual counter-job addition');
  await backToScene(win);await actionClick(win,'lsOpen',true);assert.equal(profile().retail,true);
  const ordinarySale=await withSoftwareVisibleRenderer(win,'managed ordinary shelf sale',async()=>{
    const before=structuredClone(profile()),due=before.business.shelves.ration.due;await advanceToTick(due,'managed ordinary shelf sale due');
    return{before,after:structuredClone(profile()),feedback:await js<string>(win,'document.getElementById("lsFeedback").textContent.trim()')};
  });
  assert.equal(ordinarySale.after.business.shelves.ration.stock,ordinarySale.before.business.shelves.ration.stock-1);
  assert.equal(ordinarySale.after.bag.ration,ordinarySale.before.bag.ration);
  assert.equal(ordinarySale.after.business.till,ordinarySale.before.business.till+price);
  assert.equal(ordinarySale.after.coins,ordinarySale.before.coins);assert.equal(ordinarySale.after.atelier!.till,ordinarySale.before.atelier!.till);
  assert.equal(ordinarySale.after.totals.sold,ordinarySale.before.totals.sold+1);assert.match(ordinarySale.feedback,/旅人挑走了店里的补给/);
  await actionClick(win,'lsOpen',true);assert.equal(profile().retail,false);
  const ordinaryClosed=structuredClone(profile());await advanceWorker(18_000,'ordinary shelf remains paused while closed');
  assert.equal(profile().business.shelves.ration.stock,ordinaryClosed.business.shelves.ration.stock);assert.equal(profile().business.till,ordinaryClosed.business.till);

  await sceneAction(win,'lsRecipes');await shopTab(win,'Specials');await atelierTab(win,'sales');await localClick(win,'aPick-picnic');
  const stockBefore=profile().atelier!.stock.picnic,shelfCount=profile().atelier!.shelves.picnic.stock;
  await actionClick(win,'aUnstock',true);assert.equal(profile().atelier!.shelves.picnic.stock,0);
  assert.equal(profile().atelier!.stock.picnic,stockBefore+shelfCount);
  await actionClick(win,'aStock',true);assert.equal(profile().atelier!.shelves.picnic.stock,5);
  await actionClick(win,'aPrice-normal',true);await actionClick(win,'aPrice-quick',true);
  const specialtyPrice=atelierPrice('picnic','quick')+jobPower(profile(),'counter');
  const specialtyPriceText=await js<string>(win,'document.getElementById("aPriceText-quick").textContent.trim()');
  const quickQuoteSeconds=QUOTES.quick.ticks/10,quickQuoteLabel=quickQuoteSeconds>=60?String(Math.floor(quickQuoteSeconds/60))+'分'+(quickQuoteSeconds%60?quickQuoteSeconds%60+'秒':''):String(quickQuoteSeconds)+'秒';
  assert.equal(specialtyPriceText,specialtyPrice+'金币 / '+quickQuoteLabel,'specialty price label includes actual counter-job addition and readable quote duration');
  await actionClick(win,'aOpen',true);assert.equal(profile().atelier!.open.supply,true);
  await backToScene(win);
  const specialtySale=await withSoftwareVisibleRenderer(win,'specialty shelf sale',async()=>{
    const before=structuredClone(profile()),due=before.atelier!.shelves.picnic.due;await advanceToTick(due,'specialty shelf sale due');
    return{before,after:structuredClone(profile()),feedback:await js<string>(win,'document.getElementById("lsFeedback").textContent.trim()')};
  });
  assert.equal(specialtySale.after.atelier!.shelves.picnic.stock,specialtySale.before.atelier!.shelves.picnic.stock-1);
  assert.equal(specialtySale.after.atelier!.till,specialtySale.before.atelier!.till+specialtyPrice);
  assert.equal(specialtySale.after.business.till,specialtySale.before.business.till);assert.equal(specialtySale.after.coins,specialtySale.before.coins);
  assert.equal(specialtySale.after.totals.sold,specialtySale.before.totals.sold+1);assert.equal(specialtySale.feedback,'特色餐盒售出，货款已存入钱箱');
  await sceneAction(win,'lsRecipes');await shopTab(win,'Specials');await atelierTab(win,'sales');
  await actionClick(win,'aOpen',true);assert.equal(profile().atelier!.open.supply,false);
  const specialtyClosed=structuredClone(profile());await advanceWorker(60_000,'specialty shelf stays stocked and unpaid while closed');
  assert.equal(profile().atelier!.shelves.picnic.stock,specialtyClosed.atelier!.shelves.picnic.stock);
  assert.equal(profile().atelier!.till,specialtyClosed.atelier!.till);assert.equal(profile().business.till,specialtyClosed.business.till);
  await backToScene(win);await auditLegacyAndSpecialSceneStock(win);await assertStableScene(win);

  await sceneAction(win,'lsOrders');await shopTab(win,'Specials');await atelierTab(win,'sales');
  const specialOrder=stableAtelierOrder(profile(),'supply',0),beforeSpecialAccept=structuredClone(profile());
  const specialAccepted=await actionClick(win,'aAccept0',true);assert.equal(specialAccepted.atelier!.orders.supply[0].accepted,true);
  assert.equal(specialAccepted.sequence,beforeSpecialAccept.sequence+1);
  const beforeSpecialDeliver=structuredClone(profile()),specialDelivery=stableAtelierOrder(beforeSpecialDeliver,'supply',0);
  assert.deepEqual({good:specialDelivery.good,count:specialDelivery.count,coins:specialDelivery.coins,revision:specialDelivery.revision},{good:specialOrder.good,count:specialOrder.count,coins:specialOrder.coins,revision:specialOrder.revision});
  const specialDelivered=await actionClick(win,'aDeliver0',true);
  assert.equal(specialDelivered.atelier!.stock[specialDelivery.good],beforeSpecialDeliver.atelier!.stock[specialDelivery.good]-specialDelivery.count);
  assert.equal(specialDelivered.coins,beforeSpecialDeliver.coins+specialDelivery.coins);assert.equal(specialDelivered.totals.earned,beforeSpecialDeliver.totals.earned+specialDelivery.coins);
  assert.equal(specialDelivered.leisure.journal.dust,beforeSpecialDeliver.leisure.journal.dust+1);
  assert.equal(specialDelivered.atelier!.orders.supply[0].revision,specialDelivery.revision+1);assert.equal(specialDelivered.atelier!.orders.supply[0].accepted,false);

  await atelierTab(win,'study');await localClick(win,'aPick-picnic');
  const kitchenCost=facilityCost(profile().atelier!,'kitchen'),beforeKitchen=structuredClone(profile());
  const kitchen=await actionClick(win,'aUpgrade-kitchen',true);
  assert.equal(kitchen.atelier!.facilities.kitchen,beforeKitchen.atelier!.facilities.kitchen+1);
  assert.equal(kitchen.coins,beforeKitchen.coins-kitchenCost.coins);assert.equal(kitchen.leisure.materials.ore,beforeKitchen.leisure.materials.ore-kitchenCost.ore);
  assert.equal(kitchen.atelier!.stock.ingot,beforeKitchen.atelier!.stock.ingot-kitchenCost.ingot);
  const counterCost=facilityCost(kitchen.atelier!,'counter'),beforeCounter=structuredClone(kitchen),counter=await actionClick(win,'aUpgrade-counter',true);
  assert.equal(counter.atelier!.facilities.counter,beforeCounter.atelier!.facilities.counter+1);
  assert.equal(counter.coins,beforeCounter.coins-counterCost.coins);assert.equal(counter.leisure.materials.ore,beforeCounter.leisure.materials.ore-counterCost.ore);
  assert.equal(counter.atelier!.stock.ingot,beforeCounter.atelier!.stock.ingot-counterCost.ingot);
  const mastery=await actionClick(win,'aMastery',true);
  assert.equal(mastery.atelier!.claimed.picnic,beforeCounter.atelier!.claimed.picnic+1);
  assert.equal(mastery.coins,counter.coins+15);assert.equal(mastery.leisure.journal.dust,counter.leisure.journal.dust+1);

  await backToScene(win);await sceneAction(win,'lsLedger');await clickElement(win,'lifeOpen');
  await until(()=>js<boolean>(win,'!!document.getElementById("lifePanel-overview")&&!document.getElementById("lifePanel-overview").hidden'),'legacy overview visible from living ledger');
  await auditLayout(win,'rich legacy ledger overview');await backToScene(win);
  const beforeCollect=structuredClone(profile()),bothTills=beforeCollect.business.till+beforeCollect.atelier!.till;
  assert.ok(beforeCollect.business.till>0&&beforeCollect.atelier!.till>0,'both shops must have distinct pending receipts');
  await actionClick(win,'lsCollect',true);
  assert.equal(profile().business.till,0);assert.equal(profile().atelier!.till,0);
  assert.equal(profile().coins,beforeCollect.coins+bothTills);assert.equal(profile().totals.earned,beforeCollect.totals.earned+bothTills);
  const sequence=profile().sequence;await disabledControl(win,'lsCollect',/暂无待收货款/);
  await disabledHoverStyles(win,'lsCollect',/暂无待收货款/);await clickElement(win,'lsCollect');
  assert.equal(profile().sequence,sequence,'empty second cash collection is disabled');
  check('scene collection combines distinct tills once and refuses an empty second collection',{collected:bothTills,coins:profile().coins,sequence,tills:{business:profile().business.till,atelier:profile().atelier!.till}});
}

async function checkKeyboardAndCsp():Promise<void>{
  await assertHiddenBoundary();
}
async function main():Promise<void>{
  try{
    fs.mkdirSync(evidenceDir,{recursive:true,mode:0o700});
    fs.mkdirSync(workEvidenceDir,{recursive:true,mode:0o700});
    const now=Date.now(),fixture=scenario==='rich'?makeRichProfile(now):scenario==='smoke-keeper'?makeKeeperSmokeProfile(now):makeFreshProfile(now);
    preflight=parseProfile(fixture);assert.equal(preflight.version,8);
    if(scenario==='smoke-keeper'){assert.equal(preflight.job,'keeper');assert.equal(Object.hasOwn(preflight,'atelier'),false);}
    else if(scenario!=='rich'){assert.equal(preflight.job,'visitor');assert.equal(Object.hasOwn(preflight,'atelier'),false);}
    const folder=path.join(profileRoot,'solo');fs.mkdirSync(folder,{recursive:true,mode:0o700});
    markIsolatedFolder(profileRoot,app.getPath('appData'));
    fs.writeFileSync(profileFile,JSON.stringify(preflight)+'\n',{flag:'wx',mode:0o600});
    assert.deepEqual(parseProfile(JSON.parse(fs.readFileSync(profileFile,'utf8'))),preflight,'written tmp profile must pass parseProfile preflight');
    app.on('browser-window-created',(_event,win)=>track(win));
    shell=await startDesktop(profileRoot,true);
    await until(()=>shell?.game.state.status==='ready'&&!!shell.game.state.profile,'isolated game worker ready');
    for(const win of BrowserWindow.getAllWindows())track(win);
    const loadedProfile=shell.game.state.profile;assert.ok(loadedProfile,'worker profile disappeared after ready');
    assertLoadedFixture(loadedProfile,preflight);
    check('only preflighted private test profile loaded',{version:profile().version,job:profile().job,coins:profile().coins,atelierPresent:Object.hasOwn(profile(),'atelier'),profileRoot});
    await until(()=>js<boolean>(overlay(),'document.body.dataset.view!==undefined&&document.querySelectorAll("[data-shop]").length===2'),'hidden street renderer ready');
    if(scenario==='smoke'||scenario==='smoke-keeper')await smokeScenario();else if(scenario==='fresh')await freshScenario();else await richScenario();
    await shell.game.request('flush');
    assert.deepEqual(new GameStore(path.join(profileRoot,'solo')).value,profile(),'only this run’s isolated profile persists');
    await checkKeyboardAndCsp();
    assert.equal(errors.length,0,'renderer console/runtime errors: '+errors.join('; '));
    assert.equal(suppression.globalShortcut??0,0);
    for(const row of snapshots())assert.equal(row.isVisible,false,'native window was visible '+JSON.stringify(row));
    assert.deepEqual(hashesAtStart,productHashes(),'source/runtime product hashes changed during the run');
    status='PASS';check('hidden 0.11.0 supply acceptance completed',{scenario,profileFile,nativeWindows:snapshots(),suppression,productFiles:Object.keys(hashesAtStart).length});
  }catch(error){
    status='FAIL';errors.push(String(error));console.error(error instanceof Error?error.stack:String(error));
  }finally{
    report(status==='FAIL'?new Error(errors.at(-1)||'failure'):undefined);
    if(status==='FAIL')process.exitCode=1;
    app.quit();
  }
}
void main();
