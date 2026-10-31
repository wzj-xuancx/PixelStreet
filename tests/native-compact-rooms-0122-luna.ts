import {app,BrowserWindow,type BrowserWindow as BrowserWindowType} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import * as ts from 'typescript';
import {startDesktop} from '../apps/desktop/bootstrap';
import {GameStore} from '../apps/desktop/game-store';
import {markIsolatedFolder} from '../apps/desktop/launch-profile';
import {APP_NAME,APP_VERSION,PROFILE_NAME} from '../apps/desktop/identity';
import {
  FORMULAS,GOOD_IDS,MARKET,QUOTES,advance,atelierOf,atelierTicks,initialAtelier,initialProfile,
  parseProfile,tradeQuote,type Good,type Profile,type Reagent,type Station,
} from '../packages/solo-core';

type CheckStatus='PASS'|'FAIL'|'INFO';
type Check={name:string;status:CheckStatus;detail?:unknown};
type Trace={id:number;page:string|null;visible:()=>boolean;focused:()=>boolean;last:{visible:boolean;focused:boolean}};
type Manifest={files?:number;canonicalInventorySha256?:string;hashes?:Record<string,string>;productHashScopes?:string[];product?:Record<string,unknown>;schema?:string;metadata?:Record<string,unknown>};
type FixtureMode='fresh'|'apprentice'|'keeper';
const EXPECTED_VERSION='0.12.2';
const root=process.cwd();
const fixtureMode=(process.env.PIXELSTREET_COMPACTROOMS0122_FIXTURE||'') as FixtureMode;
const runId=new Date().toISOString().replace(/[:.]/g,'-')+'-'+process.pid;
const evidenceDir=path.join(root,'work/compact-0122/native-rooms-luna');
const profileRoot=fs.mkdtempSync(`/private/tmp/pixelstreet-compact-rooms-0122-${fixtureMode||'invalid'}-`);
const soloFolder=path.join(profileRoot,'solo');
const profileFile=path.join(soloFolder,'profile.json');
const manifestPath=path.resolve(root,process.env.PIXELSTREET_COMPACTROOMS0122_MANIFEST||'');
const reportPath=path.join(evidenceDir,`native-compact-rooms-0122-${fixtureMode}-${runId}.json`);
const progressPath=path.join(evidenceDir,`progress-${fixtureMode}-${runId}.jsonl`);
const productExclusions=['dist/tests/**','dist/native-*.cjs'] as const;
const checks:Check[]=[];
const errors:string[]=[];
const harnessIssues:string[]=[];
const screenshots:string[]=[];
const traces=new Map<number,Trace>();
const keyEvents:Record<number,number|null>={};
const cspEvents:Record<number,Array<{directive:string;blocked:string;sample:string}>|null>={};
const viewportSessions=new Map<number,boolean>();
const inlineSourceDigests=new Set<string>();
const suppression=(globalThis as any).__pixelStreetCompactRooms0122Suppression??{};
let shell:Awaited<ReturnType<typeof startDesktop>>|undefined;
let fixture:Profile|undefined;
let candidateManifest:Manifest|undefined;
let productScopes:string[]=[];
let productHashesAtStart:Record<string,string>={};
let inventoryAtStart='';
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
    void win.webContents.executeJavaScript('(()=>{if(window.__compactRooms0122Boundary)return true;window.__compactRooms0122Boundary=true;window.__compactRooms0122Keys=0;window.__compactRooms0122Csp=[];for(const t of ["keydown","keyup","keypress"])document.addEventListener(t,()=>window.__compactRooms0122Keys++,true);document.addEventListener("securitypolicyviolation",e=>window.__compactRooms0122Csp.push({directive:e.violatedDirective,blocked:e.blockedURI,sample:e.sample||""}),true);return true})()')
      .catch(error=>{if(!win.isDestroyed())harnessIssues.push('renderer boundary '+win.id+': '+String(error));});
  };
  win.webContents.on('console-message',(event:any)=>{if(event.level==='error')errors.push(JSON.stringify({window:win.id,page:page(win),message:String(event.message).slice(0,900),sourceId:event.sourceId,lineNumber:event.lineNumber}));});
  win.webContents.on('did-finish-load',()=>{const row=traces.get(win.id);if(row)row.page=page(win);instrument();});
  if(!win.webContents.isLoadingMainFrame())instrument();
}
function profile():Profile{const p=shell?.game.state.profile;assert.ok(p,'isolated GameWorker profile unavailable: '+(shell?.game.state.error||'loading'));return p;}
function overlay():BrowserWindowType{const win=shell?.overlay;assert.ok(win&&!win.isDestroyed(),'hidden street renderer unavailable');return win;}
function popup():BrowserWindowType{const win=shell?.popupWindow;assert.ok(win&&!win.isDestroyed(),'hidden shop/alchemy popup unavailable');return win;}
async function until(fn:()=>Promise<boolean>|boolean,label:string,timeout=25_000):Promise<void>{
  const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await new Promise(resolve=>setTimeout(resolve,35));}throw Error('timeout: '+label);
}
async function js<T=unknown>(win:BrowserWindowType,source:string):Promise<T>{
  // Compile every inline renderer script before it is evaluated. This catches
  // malformed JSON.stringify selectors and quoting errors without executing JS in Node.
  new vm.Script(source,{filename:'compact-rooms-renderer-inline.js'});
  inlineSourceDigests.add(createHash('sha256').update(source).digest('hex'));
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([win.webContents.executeJavaScript(source) as Promise<T>,new Promise<T>((_,reject)=>{timer=setTimeout(()=>reject(Error('renderer evaluation timeout '+win.id)),15_000);})]);}
  catch(error){throw Error('renderer evaluation failed in '+win.id+': '+String(error)+'; source='+source.slice(0,450));}
  finally{if(timer)clearTimeout(timer);}
}
async function visible(win:BrowserWindowType,selector:string):Promise<boolean>{
  return js(win,'(()=>{const e=document.querySelector('+JSON.stringify(selector)+');if(!e)return false;for(let n=e;n&&n instanceof HTMLElement;n=n.parentElement){const s=getComputedStyle(n);if(n.hidden||s.display==="none"||s.visibility==="hidden"||s.opacity==="0")return false;}return true})()');
}
async function setViewport(win:BrowserWindowType,width:760|1040,height=650):Promise<void>{
  const debuggerSession=win.webContents.debugger,wasAttached=debuggerSession.isAttached();
  if(!wasAttached){debuggerSession.attach('1.3');viewportSessions.set(win.id,false);}else if(!viewportSessions.has(win.id))viewportSessions.set(win.id,true);
  await debuggerSession.sendCommand('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
  await until(()=>js<boolean>(win,`innerWidth===${width}&&innerHeight===${height}`),'CSS viewport '+width+'x'+height);
  record('hidden Electron CSS viewport '+width+'x'+height,{width,height,outerWindow:win.getSize(),nativeVisible:win.isVisible(),nativeFocused:win.isFocused(),method:'CDP Emulation.setDeviceMetricsOverride; software CSS viewport, not physical-display evidence'});
}
async function clearViewport(win:BrowserWindowType):Promise<void>{
  const d=win.webContents.debugger;if(!d.isAttached())return;const owned=viewportSessions.get(win.id);
  try{await d.sendCommand('Emulation.clearDeviceMetricsOverride');}finally{if(owned===false&&d.isAttached())d.detach();viewportSessions.delete(win.id);}
}
async function resetInitialScroll(win:BrowserWindowType):Promise<Record<string,unknown>>{
  return js(win,'(()=>{for(const e of document.querySelectorAll(".popover-content,#cContent"))e.scrollTop=0;document.documentElement.scrollTop=0;document.body.scrollTop=0;const e=document.querySelector(".popover-content,#cContent");return{documentTop:document.scrollingElement?.scrollTop||0,root:e?{className:typeof e.className==="string"?e.className:"",id:e.id||null,top:e.scrollTop,clientHeight:e.clientHeight,scrollHeight:e.scrollHeight,max:Math.max(0,e.scrollHeight-e.clientHeight)}:null,viewport:{width:innerWidth,height:innerHeight,pageWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth}}})()');
}
function visibleImageSource(e:Element):string{
  const nodes=[e,...Array.from(e.querySelectorAll('.ls-item-art,.a-good-art,.tw-material-art'))];
  for(const node of nodes){const bg=getComputedStyle(node).backgroundImage;if(bg&&bg!=='none'&&bg.includes('url('))return bg;}
  const pseudo=getComputedStyle(e,'::before').backgroundImage;return pseudo&&pseudo!=='none'?pseudo:'none';
}
async function auditFit(win:BrowserWindowType,label:string,selectors:string[],actionSelectors:string[],minimumMatches:Record<string,number>={}):Promise<Record<string,unknown>>{
  const source=`(()=>{
    for(const e of document.querySelectorAll('.popover-content,#cContent'))e.scrollTop=0;
    document.documentElement.scrollTop=0;document.body.scrollTop=0;
    const wanted=${JSON.stringify(selectors)},actions=${JSON.stringify(actionSelectors)},targets=[],actionRects=[];
    const visible=e=>{for(let n=e;n&&n instanceof HTMLElement;n=n.parentElement){const s=getComputedStyle(n);if(n.hidden||s.display==='none'||s.visibility==='hidden'||s.opacity==='0')return false;}return true;};
    const art=e=>{for(const n of [e,...e.querySelectorAll('.ls-item-art,.a-good-art,.tw-material-art')]){const bg=getComputedStyle(n).backgroundImage;if(bg&&bg.includes('url('))return bg;}const bg=getComputedStyle(e,'::before').backgroundImage;return bg&&bg.includes('url(')?bg:'none';};
    const content=document.querySelector('.popover-content,#cContent'),border=content?.getBoundingClientRect(),clip=content&&border?{left:border.left+content.clientLeft,top:border.top+content.clientTop,right:border.left+content.clientLeft+content.clientWidth,bottom:border.top+content.clientTop+content.clientHeight}:null;
    for(const selector of wanted){const elements=[...document.querySelectorAll(selector)];targets.push({selector,matches:elements.map(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e),button=e.closest('button'),label=e.getAttribute('aria-label')||e.dataset.tooltip||e.title||e.textContent?.trim()||'',tooltip=e.dataset.tooltip||e.title||'',edgeTolerance=e.tagName==='BUTTON'?0.5:3,withinWindow=r.width>0&&r.height>0&&r.left>=-edgeTolerance&&r.top>=-edgeTolerance&&r.right<=innerWidth+edgeTolerance&&r.bottom<=innerHeight+edgeTolerance,insideClip=!!clip&&r.width>0&&r.height>0&&r.left>=clip.left-edgeTolerance&&r.top>=clip.top-edgeTolerance&&r.right<=clip.right+edgeTolerance&&r.bottom<=clip.bottom+edgeTolerance;return{selector,id:e.id||e.dataset.good||e.dataset.art||null,tag:e.tagName,visible:visible(e),disabled:!!e.disabled,label,ariaHidden:e.getAttribute('aria-hidden')==='true',tooltip,font:parseFloat(s.fontSize)||0,cursor:s.cursor,rect:{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom},art:art(e),buttonId:button?.id||null,insideWindow:withinWindow,insidePopoverContent:insideClip};})});}
    for(const selector of actions){for(const e of document.querySelectorAll(selector)){if(!visible(e))continue;const r=e.getBoundingClientRect(),button=e.closest('button'),x=r.left+r.width/2,y=r.top+r.height/2,hit=document.elementFromPoint(x,y),hitButton=hit?.closest('button');actionRects.push({selector,id:e.id||e.dataset.good||null,rect:{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height},font:parseFloat(getComputedStyle(e).fontSize)||0,disabled:!!e.disabled,button:button?.id||null,hitSameButton:!!button&&hitButton===button,hit:{tag:hit?.tagName||null,id:hit?.id||null,button:hitButton?.id||null}});}}
    const viewport={width:innerWidth,height:innerHeight,pageWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth,scrollTop:document.scrollingElement?.scrollTop||0};
    const scrollers=[...document.querySelectorAll('.popover-content,#cContent')].filter(visible).map(e=>({id:e.id||null,className:typeof e.className==='string'?e.className:'',top:e.scrollTop,clientHeight:e.clientHeight,scrollHeight:e.scrollHeight,max:Math.max(0,e.scrollHeight-e.clientHeight),clientWidth:e.clientWidth,scrollWidth:e.scrollWidth}));
    const nested=[...document.querySelectorAll('*')].filter(e=>visible(e)&&!e.matches('.popover-content,#cContent')).map(e=>({e,s:getComputedStyle(e)})).filter(x=>/(auto|scroll)/.test(x.s.overflowY)&&x.e.scrollHeight>x.e.clientHeight+2&&x.e.clientHeight>0).map(x=>({tag:x.e.tagName,id:x.e.id||null,className:typeof x.e.className==='string'?x.e.className:'',overflowY:x.s.overflowY,clientHeight:x.e.clientHeight,scrollHeight:x.e.scrollHeight}));
    return{viewport,targets,actionRects,scrollers,nestedScroll:nested,contentBounds:clip,targetsClip:!!content};
  })()`;
  const rows=await js<any>(win,source),problems:string[]=[];
  if(rows.viewport.scrollTop!==0)problems.push('document scrollTop is not 0: '+rows.viewport.scrollTop);
  if(rows.viewport.pageWidth>rows.viewport.width+1)problems.push('page horizontal overflow '+JSON.stringify(rows.viewport));
  if(rows.viewport.bodyWidth>rows.viewport.width+1)problems.push('body horizontal overflow '+JSON.stringify(rows.viewport));
  if(!rows.targetsClip)problems.push('popover content clipping bounds missing');
  for(const scroller of rows.scrollers){if(scroller.top!==0)problems.push('popover was measured after scrolling '+JSON.stringify(scroller));if(scroller.scrollWidth>scroller.clientWidth+1)problems.push('popover horizontal overflow '+JSON.stringify(scroller));}
  if(rows.nestedScroll.length)problems.push('nested scroll regions '+JSON.stringify(rows.nestedScroll));
  for(const target of rows.targets){
    const min=minimumMatches[target.selector]??1;if(target.matches.length<min)problems.push('expected '+min+' matches for '+target.selector+'; found '+target.matches.length);
    for(const item of target.matches){
      if(!item.visible)problems.push('hidden '+target.selector+' '+item.id);
      if(!item.insideWindow||!item.insidePopoverContent)problems.push('outside initial visible content '+target.selector+' '+item.id+' '+JSON.stringify(item.rect));
      if(!item.ariaHidden&&!item.label.trim())problems.push('unlabeled '+target.selector+' '+item.id);
      if(item.tag==='BUTTON'&&item.font<16)problems.push('button font below16 '+target.selector+' '+item.id+' '+item.font);
      if(item.tag==='BUTTON'&&(item.rect.height<44||item.rect.width<44))problems.push('button target below44 '+target.selector+' '+item.id+' '+JSON.stringify(item.rect));
      if(item.tag==='BUTTON'&&item.disabled&&!item.tooltip)problems.push('disabled action lacks an explanation '+target.selector+' '+item.id);
    }
  }
  for(const action of rows.actionRects)if(!action.hitSameButton)problems.push('elementFromPoint button center misses '+action.selector+' '+action.id+' '+JSON.stringify(action.hit));
  for(let i=0;i<rows.actionRects.length;i++)for(let j=i+1;j<rows.actionRects.length;j++){const a=rows.actionRects[i].rect,b=rows.actionRects[j].rect,area=Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));if(area>1)problems.push('overlapping critical controls '+rows.actionRects[i].id+' and '+rows.actionRects[j].id+' area='+area);}
  const fitReport={...rows,allTargetsFit:problems.length===0,problems,policy:'At initial scrollTop 0, each required target is inside the real scroll clip and software viewport; no target was scrolled into view before measurement.'};
  record('critical compact targets at scrollTop 0 · '+label,fitReport,problems.length?'FAIL':'PASS');
  if(problems.length){
    const slug=label.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,80)||'fit-red';
    const metrics=path.join(evidenceDir,`raw-red-fit-${fixtureMode}-${runId}-${slug}.json`);fs.writeFileSync(metrics,JSON.stringify({schema:'pixelstreet.compact-rooms-0122.luna.fit-red.v1',at:new Date().toISOString(),label,fitReport},null,2)+'\n',{flag:'wx',mode:0o600});
    record('preserved raw RED geometry before assertion',{metrics,screenshot:`red-${slug}`},'FAIL');
    try{await capture(win,'red-'+slug);}catch(error){harnessIssues.push('raw RED screenshot '+label+': '+String(error));}
  }
  assert.deepEqual(problems,[],label+' fit failed: '+problems.join('; '));return rows;
}
async function auditArt(win:BrowserWindowType,label:string,selector:string,minimum=1):Promise<void>{
  const data=await js<any>(win,`(()=>{const selector=${JSON.stringify(selector)};return{selector,items:[...document.querySelectorAll(selector)].map(e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect(),image=e instanceof HTMLImageElement?{src:e.currentSrc||e.src,complete:e.complete,width:e.naturalWidth,height:e.naturalHeight}:null;return{id:e.id||e.dataset.art||e.dataset.good||null,hidden:!!e.hidden||!!e.closest("[hidden]"),rect:{x:r.x,y:r.y,width:r.width,height:r.height},background:s.backgroundImage||"none",image}})}})()`);
  assert.ok(data.items.length>=minimum,label+' expected '+minimum+' rendered art items; got '+data.items.length);const art=[];
  for(const item of data.items){
    assert.equal(item.hidden,false,label+' art is hidden '+JSON.stringify(item));const raw=item.image?.src||item.background;const match=String(raw).match(/url\(["']?([^"')]+)["']?\)/);const url=item.image?.src||match?.[1];assert.ok(url,label+' computed image source missing '+JSON.stringify(item));
    const parsed=new URL(url);assert.equal(parsed.protocol,'file:',label+' must use loaded local art');const file=fileURLToPath(parsed);const stat=fs.statSync(file);assert.ok(stat.isFile()&&stat.size>1000,label+' loaded local art is unexpectedly small: '+file);
    if(item.image){assert.equal(item.image.complete,true,label+' HTML image decode incomplete');assert.ok(item.image.width>0&&item.image.height>0,label+' decoded HTML image has empty dimensions');}
    art.push({id:item.id,path:path.relative(root,file),bytes:stat.size,rect:item.rect});
  }
  record('actual loaded local art · '+label,{selector,art,evidence:'computed style/image source in the real hidden Electron renderer'});
}
async function clickAt(win:BrowserWindowType,selector:string,label:string,options:{allowScroll?:boolean;requireArt?:boolean}={}):Promise<Record<string,unknown>>{
  const source=`(()=>{
    const e=document.querySelector(${JSON.stringify(selector)});if(!e)return{ok:false,why:'missing'};
    if(${options.allowScroll===true})e.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
    const style=getComputedStyle(e),button=e.closest('button'),r=e.getBoundingClientRect(),content=document.querySelector('.popover-content'),border=content?.getBoundingClientRect(),clip=content&&border?{left:border.left+content.clientLeft,top:border.top+content.clientTop,right:border.left+content.clientLeft+content.clientWidth,bottom:border.top+content.clientTop+content.clientHeight}:null;
    const hidden=!!e.hidden||!!e.closest('[hidden]')||!!e.closest('details:not([open])')||style.display==='none'||style.visibility==='hidden';
    if(hidden||!button||button.disabled)return{ok:false,why:hidden?'hidden':!button?'not inside button':'disabled',scrollTop:content?.scrollTop||0};
    const art=e.matches('.ls-item-art,.a-good-art,.tw-material-art')?e:e.querySelector('.ls-item-art,.a-good-art,.tw-material-art'),ar=art?.getBoundingClientRect(),useArt=!!art&&!!ar&&ar.width>0&&ar.height>0;
    const x=useArt?ar.left+ar.width/2:r.left+r.width/2,y=useArt?ar.top+ar.height/2:r.top+r.height/2,hit=document.elementFromPoint(x,y),hitButton=hit?.closest('button'),background=art?getComputedStyle(art).backgroundImage:getComputedStyle(button,'::before').backgroundImage;
    const rectInside=!clip||(r.left>=clip.left-1&&r.top>=clip.top-1&&r.right<=clip.right+1&&r.bottom<=clip.bottom+1),within=x>=0&&y>=0&&x<innerWidth&&y<innerHeight&&!!hitButton&&hitButton===button;
    return{ok:within&&rectInside,x,y,pointSource:useArt?'rendered artwork center':'rendered button center',tag:hit?.tagName||null,hitId:hit?.id||null,buttonId:button.id||null,disabled:button.disabled,label:button.getAttribute('aria-label')||button.dataset.tooltip||button.title||button.textContent?.trim()||'',background:background||'none',scrollTop:content?.scrollTop||0,contentBounds:clip,rect:{left:r.left,top:r.top,right:r.right,bottom:r.bottom}};
  })()`;
  const measure=await js<any>(win,source);
  assert.ok(measure.ok,label+' coordinate hit did not land on the intended control: '+JSON.stringify(measure));
  if(options.requireArt)assert.match(String(measure.background),/url\(/,label+' rendered control art missing at hit point');
  const dispatched=await js<any>(win,`(()=>{const x=${measure.x},y=${measure.y},h=document.elementFromPoint(x,y),b=h?.closest("button");if(!b||b.disabled||b.id!==${JSON.stringify(measure.buttonId||'')})return{ok:false,tag:h?.tagName||null,id:h?.id||null,buttonId:b?.id||null};for(const type of ["pointerdown","pointerup"])h.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,view:window,clientX:x,clientY:y,pointerType:"mouse",button:0}));h.dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true,view:window,clientX:x,clientY:y,button:0}));return{ok:true,tag:h.tagName,id:h.id||null,buttonId:b.id||null,scrollTop:document.querySelector(".popover-content")?.scrollTop||0}})()`);
  assert.equal(dispatched.ok,true,label+' pointer event missed actual elementFromPoint target '+JSON.stringify(dispatched));
  record('software pointer hit on actual rendered control · '+label,{...measure,dispatched,boundary:'Synthetic PointerEvent/MouseEvent only; no physical pointer/keyboard/IME claim'});return measure;
}
async function capture(win:BrowserWindowType,label:string):Promise<void>{
  await new Promise(resolve=>setTimeout(resolve,80));assert.equal(win.isVisible(),false,'capture target native window became visible');assert.equal(win.isFocused(),false,'capture target native window became focused');
  const image=await win.webContents.capturePage(),size=image.getSize(),bytes=image.toPNG(),file=path.join(evidenceDir,`screen-${fixtureMode}-${runId}-${label}.png`);
  assert.ok(size.width>0&&size.height>0&&bytes.length>2500,label+' screenshot is empty');fs.writeFileSync(file,bytes,{flag:'wx',mode:0o600});screenshots.push(file);
  record('hidden Electron screenshot · '+label,{file,size,bytes:bytes.length,native:{visible:false,focused:false},method:'webContents.capturePage at software CSS viewport; not physical display evidence'});
}
async function scenePoint(win:BrowserWindowType,x:number,y:number,label:string):Promise<void>{
  const target=await js<any>(win,`(()=>{const x=${x},y=${y},e=document.elementFromPoint(x,y);return{ok:!!e&&x>=0&&y>=0&&x<=innerWidth&&y<=innerHeight,tag:e?.tagName||null,id:e?.id||null,buttonId:e?.closest("button")?.id||null,x,y}})()`);
  assert.ok(target.ok,label+' scene coordinate unavailable: '+JSON.stringify(target));
  await js(win,`(()=>{const e=document.elementFromPoint(${x},${y});for(const type of ["pointerdown","pointerup"])e.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,view:window,clientX:${x},clientY:${y},pointerType:"mouse",button:0}));e.dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true,view:window,clientX:${x},clientY:${y},button:0}));return true})()`);
  record('software image-coordinate hit in actual street scene · '+label,{...target,evidence:'Synthetic PointerEvent and MouseEvent in the real hidden Electron renderer; software-only input.'});
}
async function atBothWidths(win:BrowserWindowType,label:string,fn:(width:760|1040)=>Promise<void>):Promise<void>{
  for(const width of [760,1040] as const){await setViewport(win,width);await resetInitialScroll(win);await fn(width);await capture(win,`${label}-${width}x650`);}
}
async function openStore(shop:'shop-bakery'|'shop-alchemy'):Promise<BrowserWindowType>{
  const street=overlay();await until(()=>Reflect.get(shell!,'overlayCold')===false&&js<boolean>(street,'document.body.dataset.view!==undefined&&!!document.querySelector("[data-shop]")'),'street ready for '+shop);
  if(Reflect.get(shell!,'view')!=='interior'||Reflect.get(shell!,'activeShop')!==shop){await clickAt(street,'[data-shop="'+shop+'"]','street shop sign '+shop);await until(()=>Reflect.get(shell!,'view')==='interior'&&Reflect.get(shell!,'activeShop')===shop,'enter street shop '+shop);}
  const world=await js<{x:number;y:number;scale:number}>(street,'({x:Number(document.body.dataset.worldX),y:Number(document.body.dataset.worldY),scale:Number(document.body.dataset.worldScale)})');assert.ok(Number.isFinite(world.x+world.y+world.scale)&&world.scale>0,'street world transform');const localX=shop==='shop-bakery'?244:484;
  await scenePoint(street,world.x+localX*world.scale,world.y-20*world.scale,'shop keeper '+shop);
  await until(()=>!!shell?.popupWindow&&!shell.popupWindow.isDestroyed()&&Reflect.get(shell,'popup')?.kind===(shop==='shop-bakery'?'shop':'alchemy'),'native popup opened for '+shop);
  const win=popup();await until(()=>js<boolean>(win,'document.body.dataset.popupReady==="true"'),'actual shop popup loaded '+shop);track(win);assert.equal(win.isVisible(),false,'shop popup must remain hidden');assert.equal(win.isFocused(),false,'shop popup must remain unfocused');
  record('actual shop renderer loaded in hidden DesktopShell',{shop,page:page(win),bounds:win.getBounds(),native:{visible:false,focused:false}});return win;
}
async function openWorkspace(win:BrowserWindowType,entry:string,label:string):Promise<void>{
  await capture(win,label+'-before-workspace-navigation');await clickAt(win,'#'+entry,label+' open the operating workspace');
  await until(async()=>await visible(win,'#roomWorkspace')&&!await visible(win,'#roomSceneView'),'real shop workspace opens from '+entry);
  record('shop scene navigated to actual compact workspace',{entry,window:win.id,page:page(win)});
}
async function openTab(win:BrowserWindowType,id:string,panel:string):Promise<void>{
  const before=profile().sequence;await clickAt(win,'#'+id,'select workspace tab '+id,{allowScroll:true});
  await until(async()=>await visible(win,'#'+panel)&&await js<boolean>(win,`document.getElementById(${JSON.stringify(id)})?.getAttribute("aria-selected")==="true"`),id+' visible panel');
  assert.equal(profile().sequence,before,'tab navigation changed saved profile');await resetInitialScroll(win);
}
async function closePopup(win:BrowserWindowType):Promise<void>{
  if(win.isDestroyed())return;await capture(win,`before-popup-close-window-${win.id}`);await clickAt(win,'#popupClose','close hidden shop popup',{allowScroll:true});
  await until(()=>!shell?.popupWindow||shell.popupWindow.isDestroyed(),'shop popup destroyed after close');
}
async function auditBoundary():Promise<void>{
  for(const win of BrowserWindow.getAllWindows())track(win);
  const native=snapshots();for(const row of native){assert.equal(row.visible,false,'native window became visible '+JSON.stringify(row));assert.equal(row.focused,false,'native window became focused '+JSON.stringify(row));}
  for(const[id]of traces){const win=BrowserWindow.fromId(id);if(!win||win.isDestroyed())continue;const url=win.webContents.getURL();if(!url||url==='about:blank'){keyEvents[id]=null;cspEvents[id]=null;continue;}
    try{const boundary=await js<any>(win,'({keys:window.__compactRooms0122Boundary?window.__compactRooms0122Keys:null,csp:window.__compactRooms0122Boundary?window.__compactRooms0122Csp:null})');if(typeof boundary.keys==='number')keyEvents[id]=boundary.keys;if(Array.isArray(boundary.csp))cspEvents[id]=boundary.csp;}
    catch(error){harnessIssues.push('renderer boundary sample '+id+': '+String(error));}
  }
  const knownKeys=Object.values(keyEvents).filter((value):value is number=>typeof value==='number');
  const knownCsp=Object.values(cspEvents).filter((value):value is Array<{directive:string;blocked:string;sample:string}>=>Array.isArray(value));
  assert.equal(knownKeys.reduce((n,value)=>n+value,0),0,'test observed renderer keyboard event input');
  assert.equal(knownCsp.reduce((n,value)=>n+value.length,0),0,'renderer CSP violation observed');
  assert.equal(suppression.globalShortcut??0,0,'app attempted global shortcut API');
  record('native visibility, focus, keyboard, CSP and shortcut boundary',{native,keyEvents,cspEvents,suppression,physicalInputClaim:false,unknownWindowCounters:Object.entries(keyEvents).filter(([,value])=>value===null).map(([id])=>id)},'PASS');
}
async function verifyProfileBoundary():Promise<void>{
  assert.ok(fixture);assert.deepEqual(new GameStore(soloFolder).value,profile(),'only the isolated fixture was persisted by GameWorker');
  const marker=path.join(profileRoot,'.pixelstreet-isolated-profile.json');assert.ok(fs.existsSync(marker));assert.match(fs.readFileSync(marker,'utf8'),/isolated-playtest/);
  record('marked private profile preflight and persistence boundary',{profileRoot,profileFile,marker,version:profile().version,sequence:profile().sequence,fixtureMode});
}
function makeFixture(now:number,mode:FixtureMode):Profile{
  const p=initialProfile(now);p.tick=1000;p.wallAt=now;
  if(mode==='fresh'){p.job='visitor';p.coins=50;p.totals.earned=50;return parseProfile(p);}
  if(mode==='apprentice'){p.job='apprentice';p.coins=50;p.totals.earned=50;p.bag.flour=4;return parseProfile(p);}
  p.job='keeper';p.coins=500_000;p.xp=20_000;p.totals.earned=p.coins;p.totals.crafted=200;
  p.bag.flour=500;p.bag.gel=45;p.bag.ration=500;p.bag.crystal=500;
  p.business.managed=true;p.business.upgrades={oven:3,shelves:3,workbench:3};
  p.leisure.clears=[5,5,5,5,5];p.leisure.materials={...p.leisure.materials,ore:500,herb:500,berry:500,mushroom:500,tea:500,biscuit:500,soup:500,pumpkin:500,snowflower:500,pie:500,snowtea:500};p.leisure.journal.dust=500;
  p.atelier=initialAtelier();p.atelier.facilities={kitchen:3,still:3,counter:3};for(const good of GOOD_IDS)p.atelier.stock[good]=40;
  return parseProfile(p);
}
function assertLoadedProfile(actual:Profile,expected:Profile):void{assert.deepEqual(actual,advance(expected,actual.wallAt),'GameWorker loaded the generated preflight fixture with only normal startup time');}
async function actualAction(win:BrowserWindowType,selector:string,label:string,verify:(before:Profile,after:Profile)=>void,allowScroll=false):Promise<Profile>{
  const before=structuredClone(profile());await clickAt(win,selector,label,{allowScroll});
  await until(()=>profile().sequence===before.sequence+1,'actual GameWorker receipt for '+label);const after=profile();verify(before,after);
  record('actual rendered action reached Shell IPC and GameWorker · '+label,{selector,sequenceBefore:before.sequence,sequenceAfter:after.sequence,coinsBefore:before.coins,coinsAfter:after.coins,notice:after.notice,profileDelta:'verified by profile transition',native:{visible:win.isVisible(),focused:win.isFocused()}});return after;
}
async function advanceWorker(ms:number,label:string):Promise<Profile>{
  const before=profile(),state=await shell!.game.request('advance',{ms});assert.ok(state.profile,'GameWorker testMode accepted controlled advance');
  record('controlled GameWorker clock · '+label,{ms,tickBefore:before.tick,tickAfter:state.profile!.tick,sequence:state.profile!.sequence,boundary:'software testMode advance, not wall-clock elapsed time'});return state.profile!;
}
async function auditJobControls(win:BrowserWindowType,phase:'visitor'|'apprentice'|'trial-ready'):Promise<void>{
  const action=phase==='visitor'?'#applyJob':phase==='apprentice'?'#trialCraft':'#deliverTrial';
  const message=phase==='visitor'?'fresh visitor apply action':phase==='apprentice'?'apprentice trial craft action':'ready-to-deliver trial action';
  await atBothWidths(win,message,async width=>{
    const jobSelectors=['#jobPanel','#jobStory',action];await auditFit(win,message+' at '+width,jobSelectors,[action]);
    if(await visible(win,'#jobPanel'))await auditArt(win,message+' clerk and trial artwork','#jobPanel .tw-job-clerk, #jobPanel .ls-item-art',2);
  });
}
async function completeTrial(win:BrowserWindowType,mode:FixtureMode):Promise<void>{
  assert.ok(profile().job==='visitor'||profile().job==='apprentice','trial path must start as visitor/apprentice');
  if(profile().job==='visitor'){
    await auditJobControls(win,'visitor');const flourBefore=profile().bag.flour;
    await actualAction(win,'#applyJob','visitor applies for apprentice role',(before,after)=>{assert.equal(before.job,'visitor');assert.equal(after.job,'apprentice');assert.equal(after.bag.flour,flourBefore+4);});
  }
  await auditJobControls(win,'apprentice');
  const flourBefore=profile().bag.flour;
  await actualAction(win,'#trialCraft','apprentice starts a one-ration trial',(before,after)=>{assert.equal(after.job,'apprentice');assert.equal(after.bag.flour,before.bag.flour-2);assert.deepEqual(after.queue&&{recipe:after.queue.recipe,remaining:after.queue.remaining},{recipe:'ration',remaining:1});});
  await advanceWorker(6000,'finish the six-second apprentice trial recipe');
  await until(()=>profile().queue===null&&profile().bag.ration>=1,'apprentice trial recipe completes in the real GameWorker');
  await auditJobControls(win,'trial-ready');const coinsBefore=profile().coins,rationBefore=profile().bag.ration;
  await actualAction(win,'#deliverTrial','deliver trial ration and become keeper',(before,after)=>{assert.equal(after.job,'keeper');assert.equal(after.bag.ration,before.bag.ration-1);assert.equal(after.coins,before.coins+30);});
  record('actual employment path completed',{mode,job:profile().job,coinsBefore,coinsAfter:profile().coins,rationBefore,rationAfter:profile().bag.ration,flourBefore,flourAfter:profile().bag.flour});
}

const purchaseControls=['#buyFlour','#merchantSell-flour','#merchantBulk-flour','#merchantBuy-gel','#merchantSell-gel','#merchantBulk-gel','#merchantSell-ration','#merchantSell-crystal'];
const ordinaryCraftControls=['#craftRation','#craftRations','#craftCrystal','#craftCrystals'];
const ordinaryBatchSelectors=['#shopPanelCraft .batch-picker button','#queueRation','#queueCrystal'];
const ordinaryShelfControls=['#price-ration-quick','#price-ration-normal','#price-ration-premium','#stock-ration','#stockAll-ration','#unstock-ration','#price-crystal-quick','#price-crystal-normal','#price-crystal-premium','#stock-crystal','#stockAll-crystal','#unstock-crystal','#collectTill'];
const specialQuantityControls=['#aQty1','#aQty5','#aQty10','#aQty20','#aQty30','#aCraft','#aUse'];
const specialSalesControls=['#aPrice-quick','#aPrice-normal','#aPrice-premium','#aStock','#aStockAll','#aUnstock','#aCollect','#aOpen'];
const supplyGoods:Good[]=['picnic','stew','gift'];
const alchemyGoods:Good[]=['dew','ink','ingot','nectar','incense','frost'];

async function testPurchaseAndTrial(win:BrowserWindowType,mode:FixtureMode):Promise<void>{
  await openWorkspace(win,'lsCounter','bakery counter');
  await atBothWidths(win,'merchant-four-goods-and-role-controls',async width=>{
    const selectors=['#shopPanelSupply .merchant-item h2','#shopPanelSupply .merchant-item .tw-stock-label','#shopPanelSupply .merchant-item .tw-price-tag','#shopPanelSupply .merchant-item .ls-item-art',...purchaseControls];
    const roleAction=profile().job==='visitor'?'#applyJob':profile().job==='apprentice'?'#trialCraft':'#deliverTrial';
    if(mode!=='keeper')selectors.push('#jobPanel','#jobStory',roleAction);
    await auditFit(win,'four merchant goods, eight trade controls'+(mode==='keeper'?' for keeper':' and role action')+' '+width,selectors,[...purchaseControls,...(mode==='keeper'?[]:[roleAction])],{
      '#shopPanelSupply .merchant-item h2':4,'#shopPanelSupply .merchant-item .tw-stock-label':4,'#shopPanelSupply .merchant-item .tw-price-tag':4,'#shopPanelSupply .merchant-item .ls-item-art':4,
    });
    const cardGeometry=await js<any>(win,`(()=>{const content=document.querySelector('.popover-content'),b=content.getBoundingClientRect(),clip={left:b.left+content.clientLeft,top:b.top+content.clientTop,right:b.left+content.clientLeft+content.clientWidth,bottom:b.top+content.clientTop+content.clientHeight};return{clip,cards:[...document.querySelectorAll('#shopPanelSupply .merchant-item')].map(e=>{const r=e.getBoundingClientRect(),buttons=[...e.querySelectorAll('button')].map(x=>{const q=x.getBoundingClientRect();return{id:x.id,top:q.top,bottom:q.bottom,visible:q.bottom<=clip.bottom&&q.top>=clip.top}});return{title:e.querySelector('h2')?.textContent?.trim(),cardBottom:r.bottom,decorativeBorderExcess:Math.max(0,r.bottom-clip.bottom),buttons}})}})()`);
    const edgeExcess=Math.max(0,...cardGeometry.cards.map((card:any)=>card.decorativeBorderExcess));record('merchant card border edge and critical contents geometry '+width,{...cardGeometry,allMerchantTextAndActionsFit:true,decorativeBorderOnlyExcess:edgeExcess,interpretation:'The article border may extend beyond the scroll clip by a few CSS pixels; card title, item art, stock, price, all 8 trade buttons and the job action are independently checked for full fit. The border is not an action target.'},edgeExcess?'INFO':'PASS');
    await auditArt(win,'four actually loaded merchant item sprites','#shopPanelSupply .merchant-item .ls-item-art',4);
  });
  if(mode!=='keeper')await completeTrial(win,mode);
  else await exerciseMerchantTransactions(win);
}
async function exerciseMerchantTransactions(win:BrowserWindowType):Promise<void>{
  const actions:Array<{selector:string;item:'flour'|'gel'|'ration'|'crystal';side:'buy'|'sell';count:number}>=[
    {selector:'#buyFlour',item:'flour',side:'buy',count:10},
    {selector:'#merchantSell-flour',item:'flour',side:'sell',count:5},
    {selector:'#merchantBulk-flour',item:'flour',side:'buy',count:50},
    {selector:'#merchantBuy-gel',item:'gel',side:'buy',count:5},
    {selector:'#merchantSell-gel',item:'gel',side:'sell',count:5},
    {selector:'#merchantBulk-gel',item:'gel',side:'buy',count:50},
    {selector:'#merchantSell-ration',item:'ration',side:'sell',count:1},
    {selector:'#merchantSell-crystal',item:'crystal',side:'sell',count:1},
  ];
  for(const action of actions){
    const before=structuredClone(profile()),quote=tradeQuote(action.item,action.side,action.count);
    await actualAction(win,action.selector,'merchant '+action.side+' '+action.count+' '+action.item,(old,next)=>{
      const sign=action.side==='buy'?1:-1;assert.equal(next.bag[action.item],old.bag[action.item]+sign*action.count,'exact merchant inventory delta');
      assert.equal(next.coins,old.coins+(action.side==='buy'?-quote:quote),'exact merchant wallet delta');
    });
    assert.equal(profile().sequence,before.sequence+1);
  }
  record('all eight merchant buy/sell/bulk controls were used against the real GameWorker',{count:actions.length,actions:actions.map(({selector,item,side,count})=>({selector,item,side,count})),gelCapacityMaintained:profile().bag.gel<=100});
}

async function testOrdinaryRecipesAndFiniteQueue(win:BrowserWindowType):Promise<void>{
  await openTab(win,'shopTabCraft','shopPanelCraft');
  await atBothWidths(win,'ordinary-two-recipes-batch-and-queue-actions',async width=>{
    await auditFit(win,'two ordinary recipe cards, materials, times, four controls and batch CTAs '+width,[
      '#shopPanelCraft #shopRationRow','#shopPanelCraft #shopCrystalRow','#rationFlourNeed','#crystalFlourNeed','#crystalGelNeed',
      '#shopRationRow [data-craft-time]','#shopCrystalRow [data-craft-time]',...ordinaryCraftControls,'#batchCost','#productionCapacity',...ordinaryBatchSelectors,
    ],[...ordinaryCraftControls,...ordinaryBatchSelectors],{'#shopPanelCraft .batch-picker button':6});
    await auditArt(win,'ordinary ration and crystal recipe art','#shopPanelCraft .ls-recipe-title .ls-item-art',2);
  });
  const top=await resetInitialScroll(win);assert.equal((top.root as any)?.top,0,'ordinary queue starts at initial top');
  const batchSelector='#shopPanelCraft [data-batch="1"]';const localBefore=profile().sequence;await clickAt(win,batchSelector,'choose one ordinary batch');await until(()=>js<boolean>(win,`document.querySelector(${JSON.stringify(batchSelector)})?.getAttribute("aria-pressed")==="true"`),'ordinary batch size selected');assert.equal(profile().sequence,localBefore,'batch choice must remain renderer-local');
  const flourBefore=profile().bag.flour;
  await actualAction(win,'#queueRation','queue one finite ordinary ration batch',(before,after)=>{assert.ok(after.queue,'ordinary queue appears in GameWorker profile');assert.equal(after.queue!.recipe,'ration');assert.equal(after.queue!.remaining,1);assert.equal(after.bag.flour,before.bag.flour-2);});
  const queue=profile().queue;assert.ok(queue);
  await clickAt(win,'#cancelProduction-0','cancel the first ordinary queued batch',{allowScroll:true});
  await until(()=>profile().sequence===localBefore+2&&profile().queue===null&&profile().bag.flour===flourBefore,'ordinary queue cancellation receipt and material refund');
  record('finite ordinary queue cancellation refunded its unconsumed ingredients',{queueRecipe:queue.recipe,remaining:queue.remaining,flourBefore,flourAfter:profile().bag.flour,sequence:profile().sequence,notice:profile().notice});
}

async function testOrdinaryShelvesAndOrders(win:BrowserWindowType):Promise<void>{
  await openTab(win,'shopTabManage','shopPanelManage');
  await atBothWidths(win,'ordinary-two-shelves-price-stock-collection',async width=>{
    await auditFit(win,'both ordinary shelves, all six prices, stock and collect '+width,[
      '#shopPanelManage .tw-ordinary-shelf','#shopPanelManage .shelf-prices button','#shelfStock-ration','#shelfStock-crystal',
      '#shopTill','#collectTill',...ordinaryShelfControls,
    ],ordinaryShelfControls,{'#shopPanelManage .tw-ordinary-shelf':2,'#shopPanelManage .shelf-prices button':6});
    await auditArt(win,'both ordinary shelf product sprites','#shopPanelManage .tw-ordinary-shelf .ls-item-art',2);
  });
  await resetInitialScroll(win);
  await actualAction(win,'#price-ration-quick','set ordinary ration quick-sale price',(before,after)=>assert.equal(after.business.shelves.ration.tier,'quick'));
  await actualAction(win,'#stock-ration','stock five ordinary rations',(before,after)=>{assert.equal(after.business.shelves.ration.stock,before.business.shelves.ration.stock+5);assert.equal(after.bag.ration,before.bag.ration-5);});
  await actualAction(win,'#retailToggle','open ordinary managed shelf sales',(before,after)=>assert.equal(after.retail,true),true);
  await advanceWorker(18_000,'sell one ordinary ration at quick price');await until(()=>profile().business.till>0,'ordinary shelf sale reaches the till');
  const tillBefore=profile().business.till,coinsBefore=profile().coins;
  await actualAction(win,'#collectTill','collect actual ordinary shelf sale',(before,after)=>{assert.equal(after.business.till,0);assert.equal(after.coins,coinsBefore+tillBefore);},true);
  await openTab(win,'shopTabOrders','shopPanelOrders');await capture(win,'ordinary-orders-at-top-before-optional-scroll');
  const order0=profile().business.orders[0];assert.ok(order0);
  await actualAction(win,'#acceptOrder-0','accept first ordinary traveler order',(before,after)=>assert.equal(after.business.orders[0].accepted,true),true);
  const accepted=profile().business.orders[0];
  await actualAction(win,'#deliverOrder-0','deliver first ordinary traveler order',(before,after)=>{assert.equal(after.business.orders[0].accepted,false);assert.equal(after.business.orders[0].revision,accepted.revision+1);assert.ok(after.business.completed>before.business.completed);},true);
  await actualAction(win,'#acceptOrder-0','accept the next ordinary traveler order',(before,after)=>assert.equal(after.business.orders[0].accepted,true),true);
  await actualAction(win,'#cancelOrder-0','cancel an accepted ordinary traveler order',(before,after)=>assert.equal(after.business.orders[0].accepted,false),true);
}

function formulaSelectors(good:Good):string[]{
  const need=Object.keys(FORMULAS[good].cost).map(r=>'#aNeed-'+r);
  return ['#atelierUi .tw-selected','#aName','#aUseDescription',...need,'#aCraftTime','#aCraftReason',...specialQuantityControls];
}
async function selectRecipe(win:BrowserWindowType,good:Good):Promise<void>{
  const currentScroll=await resetInitialScroll(win);assert.equal((currentScroll.root as any)?.top,0,'selected-recipe evaluation begins at top');
  const selector='#aPick-'+good;
  await clickAt(win,selector,'select '+good+' recipe',{allowScroll:true});
  await until(()=>js<boolean>(win,`document.getElementById("aHeroArt")?.dataset.art===${JSON.stringify(good)}`),'selected recipe '+good+' becomes visible');
  await resetInitialScroll(win);
  const localSequence=profile().sequence;await clickAt(win,'#aQty1','select one '+good+' batch',{allowScroll:true});
  await until(()=>js<boolean>(win,'document.getElementById("aQty1")?.getAttribute("aria-pressed")==="true"'),'quantity 1 selected for '+good);
  assert.equal(profile().sequence,localSequence,'quantity selection must be renderer-local');await resetInitialScroll(win);
}
async function auditSelectedRecipe(win:BrowserWindowType,good:Good,width:760|1040):Promise<void>{
  const selectors=formulaSelectors(good);await auditFit(win,good+' selected ingredient, time, quantity and craft fit '+width,selectors,specialQuantityControls);
  const observed=await js<any>(win,`(()=>{const cost=${JSON.stringify(FORMULAS[good].cost)},needs={};for(const r of Object.keys(cost)){const e=document.querySelector("#aNeed-"+r),n=document.querySelector("#aNeedCount-"+r);needs[r]={visible:!!e&&!e.hidden&&getComputedStyle(e).display!=="none",text:n?.textContent?.trim()||"",required:cost[r]};}return{good:document.getElementById("aHeroArt")?.dataset.art,name:document.getElementById("aName")?.textContent?.trim(),time:document.getElementById("aCraftTime")?.textContent?.trim(),reason:document.getElementById("aCraftReason")?.textContent?.trim(),needs,quantities:[1,5,10,20,30].map(n=>{const e=document.getElementById("aQty"+n),r=e?.getBoundingClientRect();return{n,visible:!!e&&!e.hidden,disabled:!!e?.disabled,height:r?.height||0,font:parseFloat(getComputedStyle(e).fontSize)||0}}),craft:{disabled:document.getElementById("aCraft")?.disabled,label:document.getElementById("aCraft")?.textContent?.trim()}}})()`);
  assert.equal(observed.good,good,'selected recipe art and data identity');assert.equal(observed.name,FORMULAS[good].name,'selected recipe title');assert.ok(observed.time.includes('每份'),'recipe time visible');assert.ok(observed.reason,'selected batch action/requirement explanation visible');
  for(const [reagent,required]of Object.entries(FORMULAS[good].cost)){const row=observed.needs[reagent];assert.ok(row?.visible,good+' ingredient '+reagent+' visible');assert.ok(row.text.endsWith(' / '+required),good+' ingredient '+reagent+' shows current and per-batch requirement: '+row.text);}
  assert.equal(observed.quantities.length,5);for(const row of observed.quantities){assert.equal(row.visible,true,good+' quantity '+row.n+' visible');assert.ok(row.height>=44,good+' quantity '+row.n+' target >=44');assert.ok(row.font>=16,good+' quantity '+row.n+' font >=16');}
  assert.equal(observed.craft.disabled,false,good+' craft CTA should be available in fully unlocked/resource-rich fixture');
  record('selected formula content independently matched the expected costs · '+good,{...observed,width,viewport:{width,height:650},profileSequence:profile().sequence});
  await auditArt(win,'selected '+good+' formula art','#aHeroArt');
}
async function testAllFormulaLayouts(win:BrowserWindowType,station:Station,goods:Good[]):Promise<void>{
  for(const good of goods){
    await selectRecipe(win,good);
    for(const width of [760,1040] as const){await setViewport(win,width);await resetInitialScroll(win);await auditSelectedRecipe(win,good,width);await capture(win,`${station}-${good}-selected-fit-${width}x650`);}
  }
}
async function testSpecialAndAlchemyLayouts(win:BrowserWindowType):Promise<void>{
  await openTab(win,'shopTabSpecials','shopPanelSpecials');await until(()=>visible(win,'#atelierUi'),'supply atelier mounted');
  await atBothWidths(win,'supply-special-catalogue-default',async width=>{
    await auditFit(win,'three supply special recipe choices plus selected action '+width,['#aPick-picnic','#aPick-stew','#aPick-gift','#aName','#aCraftTime',...specialQuantityControls],['#aPick-picnic','#aPick-stew','#aPick-gift',...specialQuantityControls]);
  });
  await testAllFormulaLayouts(win,'supply',supplyGoods);
  await testSpecialSalesAndOrders(win,'supply');
}
async function testSpecialSalesAndOrders(win:BrowserWindowType,station:Station):Promise<void>{
  const saleGood:Good=station==='supply'?'picnic':'dew';
  await selectRecipe(win,saleGood);
  await openTab(win,'aTab-sales','aPanel-sales');
  await atBothWidths(win,station+'-sales-shelf-and-common-controls',async width=>{
    await auditFit(win,station+' shelf price, stock, open and collect controls '+width,[
      '#aShelfStock','#aShelfCapacity','#aSaleDue','#aTill','#aPrice-quick','#aPrice-normal','#aPrice-premium',...specialSalesControls,
    ],specialSalesControls);
    await auditArt(win,station+' actual selected shelf item art','#aShelfArt');
  });
  await resetInitialScroll(win);
  await actualAction(win,'#aStock','stock five '+station+' specialty units on its shelf',(before,after)=>{
    assert.equal(atelierOf(after).shelves[saleGood].stock,atelierOf(before).shelves[saleGood].stock+5);
    assert.equal(atelierOf(after).stock[saleGood],atelierOf(before).stock[saleGood]-5,'keep the rest of the specialty in the bag for matching traveler orders');
  });
  await actualAction(win,'#aPrice-quick','set '+station+' specialty quick-sale price',(before,after)=>assert.equal(atelierOf(after).shelves[saleGood].quote,'quick'));
  await actualAction(win,'#aOpen','open '+station+' specialty shelf',(before,after)=>assert.equal(atelierOf(after).open[station],true));
  const priorTill=atelierOf(profile()).till;await advanceWorker(60_000,'sell one '+station+' quick-priced specialty');await until(()=>atelierOf(profile()).till>priorTill,'specialty sale reaches actual shared atelier till');
  const collected=atelierOf(profile()).till,coins=profile().coins;
  await actualAction(win,'#aCollect','collect actual '+station+' specialty sale',(before,after)=>{assert.equal(atelierOf(after).till,0);assert.equal(after.coins,coins+collected);});
  await openTab(win,'aTab-sales','aPanel-sales');await capture(win,station+' orders first-screen before optional list scroll');
  const order=atelierOf(profile()).orders[station][0];
  await actualAction(win,'#aAccept0','accept first '+station+' atelier order',(before,after)=>assert.equal(atelierOf(after).orders[station][0].accepted,true),true);
  const accepted=atelierOf(profile()).orders[station][0];
  await actualAction(win,'#aDeliver0','deliver first '+station+' atelier order',(before,after)=>{const next=atelierOf(after).orders[station][0];assert.equal(next.accepted,false);assert.equal(next.revision,accepted.revision+1);assert.equal(after.leisure.journal.dust,before.leisure.journal.dust+1);},true);
  await actualAction(win,'#aAccept0','accept the next '+station+' atelier order',(before,after)=>assert.equal(atelierOf(after).orders[station][0].accepted,true),true);
  await actualAction(win,'#aAbandon0','abandon an accepted '+station+' atelier order',(before,after)=>assert.equal(atelierOf(after).orders[station][0].accepted,false),true);
  record('atelier sales and traveler order actions used actual GameWorker state',{station,saleGood,stockBefore:40,stockAfter:atelierOf(profile()).stock[saleGood],orderRevisionBefore:order.revision,orderRevisionAfter:atelierOf(profile()).orders[station][0].revision});
}
async function testSpecialFiniteQueue(win:BrowserWindowType,station:Station,good:Good):Promise<void>{
  const tab=station==='supply'?'shopTabSpecials':'aTab-craft',panel=station==='supply'?'shopPanelSpecials':'aPanel-craft';await openTab(win,tab,panel);
  if(station==='supply'){if(!(await visible(win,'#atelierUi')))await until(()=>visible(win,'#atelierUi'),'supply atelier panel ready for queue test');await openTab(win,'aTab-craft','aPanel-craft');}
  await selectRecipe(win,good);await setViewport(win,760);await resetInitialScroll(win);await auditSelectedRecipe(win,good,760);
  const before=structuredClone(profile()),need=FORMULAS[good].cost;
  await actualAction(win,'#aCraft','queue a finite '+station+' '+good+' batch',(old,next)=>{
    const a=atelierOf(next),q=a.queues[station][0];assert.ok(q,'actual atelier batch queued');assert.equal(q.good,good);assert.equal(q.remaining,1);
    for(const [r,n]of Object.entries(need)){const prior=resourceCount(old,r as Reagent),after=resourceCount(next,r as Reagent);assert.equal(after,prior-n,'exact '+r+' ingredients reserved');}
  });
  const batch=atelierOf(profile()).queues[station][0];assert.ok(batch);
  await clickAt(win,'#aCancel0','cancel the first finite '+station+' batch',{allowScroll:true});
  await until(()=>profile().sequence>before.sequence&&atelierOf(profile()).queues[station].length===0,'actual atelier batch cancellation and material refund');
  for(const [r,n]of Object.entries(need))assert.equal(resourceCount(profile(),r as Reagent),resourceCount(before,r as Reagent),'exact atelier cancellation refund '+r);
  record('finite atelier batch cancellation restored every reserved ingredient',{station,good,remaining:batch.remaining,cancelledId:batch.id,notice:profile().notice});
}
function resourceCount(p:Profile,r:Reagent):number{
  if(['flour','gel','ration','crystal'].includes(r))return p.bag[r as 'flour'|'gel'|'ration'|'crystal'];
  if(r==='dust')return p.leisure.journal.dust;return p.leisure.materials[r as keyof Profile['leisure']['materials']];
}
async function testAlchemyLayoutsAndTransactions(win:BrowserWindowType):Promise<void>{
  await openWorkspace(win,'alCounter','alchemy counter');
  await atBothWidths(win,'alchemy-six-recipe-catalogue-default',async width=>{
    await auditFit(win,'six alchemy recipe choices plus selected recipe/common actions '+width,['#aPick-dew','#aPick-ink','#aPick-ingot','#aPick-nectar','#aPick-incense','#aPick-frost','#aName','#aCraftTime',...specialQuantityControls],['#aPick-dew','#aPick-ink','#aPick-ingot','#aPick-nectar','#aPick-incense','#aPick-frost',...specialQuantityControls]);
  });
  await testAllFormulaLayouts(win,'alchemy',alchemyGoods);
  await testSpecialSalesAndOrders(win,'alchemy');
  await testSpecialFiniteQueue(win,'alchemy','dew');
}
async function testKeeperRooms():Promise<void>{
  let win=await openStore('shop-bakery');await testPurchaseAndTrial(win,'keeper');
  await testOrdinaryRecipesAndFiniteQueue(win);await testOrdinaryShelvesAndOrders(win);
  await testSpecialAndAlchemyLayouts(win);await testSpecialFiniteQueue(win,'supply','picnic');
  await capture(win,'final-bakery-screen-before-close');await clearViewport(win);await closePopup(win);
  win=await openStore('shop-alchemy');await testAlchemyLayoutsAndTransactions(win);await capture(win,'final-alchemy-screen-before-close');await clearViewport(win);await closePopup(win);
}
async function testEmploymentOnly():Promise<void>{
  const win=await openStore('shop-bakery');await testPurchaseAndTrial(win,fixtureMode);await capture(win,'employment-final-screen-before-close');await clearViewport(win);await closePopup(win);
}
async function staticParseInlineScripts():Promise<void>{
  // Parse every literal js(window, source) renderer payload before Electron starts.
  // The js() helper separately compiles each dynamic payload immediately before evaluation.
  const sourceText=fs.readFileSync(path.join(root,'tests/native-compact-rooms-0122-luna.ts'),'utf8');
  const sourceFile=ts.createSourceFile('native-compact-rooms-0122-luna.ts',sourceText,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  const staticPayloads:Array<{source:string;line:number}>=[];
  const visit=(node:ts.Node):void=>{
    if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==='js'&&node.arguments.length>=2){
      const payload=node.arguments[1];
      if(ts.isStringLiteral(payload)||ts.isNoSubstitutionTemplateLiteral(payload))staticPayloads.push({source:payload.text,line:sourceFile.getLineAndCharacterOfPosition(payload.getStart(sourceFile)).line+1});
    }
    ts.forEachChild(node,visit);
  };
  visit(sourceFile);
  for(const payload of staticPayloads)new vm.Script(payload.source,{filename:`compact-rooms-static-renderer-line-${payload.line}.js`});
  // This canary exercises a nested-quote data-* selector using the same safe encoding as runtime snippets.
  const batchSelector='#shopPanelCraft [data-batch="1"]';
  const sources=[
    '(()=>{const e=document.querySelector('+JSON.stringify('#aNeed-flour')+');return !!e?.closest("button")})()',
    '(()=>{const e=document.querySelector('+JSON.stringify(batchSelector)+');return e?.getAttribute("aria-pressed")==="true"})()',
    '(()=>({keys:window.__compactRooms0122Boundary?window.__compactRooms0122Keys:null,csp:window.__compactRooms0122Boundary?window.__compactRooms0122Csp:null}))()',
  ];for(const source of sources)new vm.Script(source,{filename:'compact-rooms-prelaunch-canary.js'});
  record('inline renderer JavaScript preflight passed before app startup',{staticPayloads:staticPayloads.length,canaryCount:sources.length,selectors:['#aNeed-flour',batchSelector],policy:'All statically extractable js(window, literal) payloads were AST-compiled before startup; each dynamic payload is compiled by js() before Electron evaluates it.'});
}
function report(rawError?:unknown):void{
  fs.mkdirSync(evidenceDir,{recursive:true,mode:0o700});let endHashes:Record<string,string>={};
  try{if(productScopes.length)endHashes=productHashes();}catch(error){harnessIssues.push('end product inventory: '+String(error));}
  let finalProfile:unknown=null;try{const p=profile();finalProfile={sequence:p.sequence,tick:p.tick,job:p.job,coins:p.coins,bag:p.bag,business:{managed:p.business.managed,shelves:p.business.shelves,till:p.business.till,orders:p.business.orders},atelier:p.atelier};}catch{}
  const out={schema:'pixelstreet.compact-rooms-0122.luna-max.hidden-native.v1',runId,status,at:new Date().toISOString(),identity:{name:APP_NAME,version:APP_VERSION,profileName:PROFILE_NAME,expectedVersion:EXPECTED_VERSION},fixtureMode,platform:process.platform,arch:process.arch,electron:process.versions.electron,profileRoot,profileFile,fixturePreflight:fixture?{version:fixture.version,sequence:fixture.sequence,job:fixture.job,coins:fixture.coins,bag:fixture.bag,hasAtelier:Object.hasOwn(fixture,'atelier')}:null,profileFinal:finalProfile,manifestPath,manifest:candidateManifest??null,productScopes,productExclusions,productFileCount:Object.keys(productHashesAtStart).length,canonicalInventorySha256AtStart:inventoryAtStart,canonicalInventorySha256AtEnd:endHashes?canonicalInventory(endHashes):null,productHashesAtStart,productHashesAtEnd:endHashes,productUnchanged:JSON.stringify(productHashesAtStart)===JSON.stringify(endHashes),inlineRendererScriptsCompiled:inlineSourceDigests.size,checks,errors,harnessIssues,screenshots,nativeWindows:snapshots(),keyEvents,cspEvents,suppression,rawError:rawError?String(rawError):undefined,stack:rawError instanceof Error?rawError.stack:undefined,harnessHashes:Object.fromEntries(['tests/native-compact-rooms-0122-luna.ts','tests/native-compact-rooms-0122-luna-bootstrap.cjs','dist/native-compact-rooms-0122-luna.cjs'].filter(file=>fs.existsSync(path.join(root,file))).map(file=>[file,createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')])),evidenceBoundary:{runtime:'Real Electron main process, DesktopShell, hidden shop/alchemy renderers, preload, Shell IPC, GameWorker and private marked profile. No browser preview.',native:'Bootstrap intercepted app activation/focus, BrowserWindow show/showInactive/focus/moveTop/restore, webContents focus, Dock, Tray, native file dialogs and globalShortcut before DesktopShell loaded.',input:'Software PointerEvent and MouseEvent dispatched at the actual elementFromPoint coordinate. No physical mouse, keyboard or IME evidence.',profile:'Fresh mode-specific /private/tmp profile passed parseProfile and GameStore round-trip before launch. No prior/installed user progress paths were read.',screenshots:'Electron capturePage with CDP CSS viewport 760×650 and 1040×650; software viewport only, not a physical display claim.',layout:'At each initial compact-fit check document/popover scrollTop was zero, all required controls were measured inside both viewport and .popover-content bounds, all critical action centers hit their own buttons, and nested/horizontal scroll was recorded.',time:'GameWorker testMode advances are controlled virtual time and not elapsed real time.'}};
  fs.writeFileSync(reportPath,JSON.stringify(out,null,2)+'\n',{flag:'wx',mode:0o600});
  fs.appendFileSync(progressPath,JSON.stringify({at:new Date().toISOString(),finalReport:reportPath,status,errors})+'\n',{mode:0o600});
}
async function main():Promise<void>{
  try{
    assert.ok(['fresh','apprentice','keeper'].includes(fixtureMode),'fixture mode must be fresh, apprentice or keeper');
    assert.equal(APP_VERSION,EXPECTED_VERSION,'only final 0.12.2 identity is accepted');assert.equal(APP_NAME,'PixelStreet 0.12.2');assert.equal(PROFILE_NAME,'PixelStreetCamp');
    fs.mkdirSync(evidenceDir,{recursive:true,mode:0o700});await staticParseInlineScripts();
    assert.ok(manifestPath&&fs.existsSync(manifestPath),'root final-manifest GO must provide PIXELSTREET_COMPACTROOMS0122_MANIFEST');
    const loadedManifest=JSON.parse(fs.readFileSync(manifestPath,'utf8')) as Manifest;candidateManifest=loadedManifest;assert.ok(loadedManifest.hashes&&loadedManifest.canonicalInventorySha256&&Array.isArray(loadedManifest.productHashScopes),'final manifest must contain the full exact candidate hashes and scopes');
    productScopes=loadedManifest.productHashScopes!;productHashesAtStart=productHashes();inventoryAtStart=canonicalInventory(productHashesAtStart);
    assert.deepEqual(productHashesAtStart,loadedManifest.hashes,'all product/source/runtime bytes must equal root frozen manifest');assert.equal(inventoryAtStart,loadedManifest.canonicalInventorySha256,'canonical final inventory must match root GO');
    assert.equal(Object.keys(productHashesAtStart).length,loadedManifest.files,'manifest file count');assert.equal(loadedManifest.product?.version,EXPECTED_VERSION,'manifest product version');assert.equal(loadedManifest.product?.productName,APP_NAME,'manifest product name');assert.equal(loadedManifest.product?.profileName,PROFILE_NAME,'stable profile directory');
    record('whole exact candidate inventory matches root final-manifest GO',{manifestPath,files:Object.keys(productHashesAtStart).length,canonicalInventorySha256:inventoryAtStart,productScopes,productExclusions});
    fs.chmodSync(profileRoot,0o700);markIsolatedFolder(profileRoot,app.getPath('appData'));fixture=makeFixture(Date.now(),fixtureMode);assert.equal(fixture.version,8,'stable schema8');
    fs.mkdirSync(soloFolder,{recursive:true,mode:0o700});fs.writeFileSync(profileFile,JSON.stringify(fixture)+'\n',{flag:'wx',mode:0o600});
    assert.deepEqual(parseProfile(JSON.parse(fs.readFileSync(profileFile,'utf8'))),fixture,'generated profile parse preflight');assert.deepEqual(new GameStore(soloFolder).value,fixture,'GameStore isolated fixture round trip before launch');
    record('mode-specific profile parsed and round-tripped before native launch',{mode:fixtureMode,profileRoot,profileFile,version:fixture.version,job:fixture.job,coins:fixture.coins,bag:fixture.bag,hasAtelier:Object.hasOwn(fixture,'atelier'),marker:path.join(profileRoot,'.pixelstreet-isolated-profile.json')});
    app.on('browser-window-created',(_event,win)=>track(win));app.on('web-contents-created',(_event:any,contents:any)=>contents.on('console-message',(event:any)=>{if(event.level==='error')errors.push(String(event.message).slice(0,900));}));
    shell=await startDesktop(profileRoot,true);await until(()=>shell?.game.state.status==='ready'&&!!shell.game.state.profile,'GameWorker ready on marked profile');for(const win of BrowserWindow.getAllWindows())track(win);
    assertLoadedProfile(profile(),fixture);record('real hidden DesktopShell/GameWorker loaded the exact test fixture',{sequence:profile().sequence,tick:profile().tick,job:profile().job,native:snapshots()});
    await until(()=>js<boolean>(overlay(),'document.body.dataset.atlas==="verified"&&!!document.getElementById("dungeonSign")'),'actual local street renderer verified');
    if(fixtureMode==='keeper')await testKeeperRooms();else await testEmploymentOnly();
    await shell.game.request('flush');await verifyProfileBoundary();await auditBoundary();assert.deepEqual(errors,[],'renderer console errors: '+errors.join('; '));
    const finalManifest=candidateManifest;assert.ok(finalManifest,'manifest was loaded before native launch');const end=productHashes();assert.deepEqual(end,productHashesAtStart,'no candidate source/runtime file changed during acceptance');assert.deepEqual(end,finalManifest.hashes,'end bytes equal root final manifest');assert.equal(canonicalInventory(end),finalManifest.canonicalInventorySha256);
    assert.equal(suppression.globalShortcut??0,0);for(const row of snapshots()){assert.equal(row.visible,false,'native window visible at end '+JSON.stringify(row));assert.equal(row.focused,false,'native window focused at end '+JSON.stringify(row));}
    status='PASS';record('independent 0.12.2 supply/alchemy compact-room acceptance PASS',{fixtureMode,checks:checks.length,screenshots:screenshots.length,productFiles:Object.keys(end).length,canonicalInventorySha256:inventoryAtStart,profileRoot,actualGameWorkerActions:true});
  }catch(error){status='FAIL';errors.push(String(error));checks.push({name:'raw independent hidden-native compact-rooms acceptance attempt',status:'FAIL',detail:{error:String(error),stack:error instanceof Error?error.stack:undefined}});process.exitCode=1;console.error(error instanceof Error?error.stack:String(error));}
  finally{
    try{if(shell)await shell.game.request('flush');}catch(error){harnessIssues.push('final isolated GameWorker flush: '+String(error));}
    for(const win of BrowserWindow.getAllWindows()){try{await clearViewport(win);}catch(error){harnessIssues.push('clear CSS viewport '+win.id+': '+String(error));}}
    try{report(status==='FAIL'?new Error(errors.at(-1)||'acceptance failed'):undefined);}catch(error){console.error('report write failed: '+String(error));}
    app.exit(status==='FAIL'?1:0);
  }
}
void main();
