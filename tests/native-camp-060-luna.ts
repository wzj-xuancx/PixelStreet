import {app, Menu, type BrowserWindow} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {startDesktop} from '../apps/desktop/bootstrap';
import {GameStore} from '../apps/desktop/game-store';
import {assertIsolatedFolder,markIsolatedFolder} from '../apps/desktop/launch-profile';
import {APP_NAME,APP_VERSION,PROFILE_NAME} from '../apps/desktop/identity';
import {channels} from '../packages/protocol';
import {initialProfile,parseProfile,type Profile} from '../packages/solo-core';

type Status='PASS'|'FAIL'|'INFO';
type Row={name:string;status:Status;detail?:unknown};
type NativeRow={id:number;page:string|null;visible:()=>boolean;focused:()=>boolean;minimized:()=>boolean;last:{isVisible:boolean|null;isFocused:boolean|null;isMinimized:boolean|null}};
const records:Row[]=[];
const errors:string[]=[];
const suppression=(globalThis as any).__pixelStreetCamp060Suppression??{appFocus:0,show:0,showInactive:0,windowFocus:0,webContentsFocus:0,moveTop:0,globalShortcut:0,trayCreates:0};
const nativeWindows=new Map<number,NativeRow>();
const root=path.resolve(__dirname,'../../..');
const evidenceDir=path.join(root,'docs/evidence/camp-060');
const scenario=(process.argv.find(a=>a.startsWith('--scenario='))?.split('=')[1]??'fresh') as 'fresh'|'fixture';
if(scenario!=='fresh'&&scenario!=='fixture')throw Error('scenario must be fresh or fixture');
const runId=new Date().toISOString().replace(/[:.]/g,'-')+'-'+process.pid+'-'+scenario;
const profileRoot=fs.mkdtempSync(`/private/tmp/pixelstreet-camp-060-luna-${scenario}-`);
const reportPath=path.join(evidenceDir,`native-luna-${runId}.json`);
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
let shell:Awaited<ReturnType<typeof startDesktop>>|undefined;
let overlay:BrowserWindow|undefined;
let preflight:Profile|undefined;
let status:'RUNNING'|'PASS'|'FAIL'='RUNNING';

function listProductFiles():string[]{
 const fixed=['apps/desktop/identity.ts','apps/desktop/bootstrap.ts','apps/desktop/shell.ts','apps/desktop/game-store.ts','apps/desktop/game-worker.ts','apps/desktop/renderer/casual.ts','apps/desktop/renderer/casual.css','apps/desktop/renderer/inventory.ts','packages/protocol/index.ts','packages/solo-core/index.ts','packages/solo-core/leisure.ts','packages/solo-core/camp-world.ts','package.json','package-lock.json','dist/main.cjs','dist/preload.cjs','dist/game-worker.cjs','dist/action-worker.cjs','dist/renderer/index.html'];
 const visit=(folder:string):string[]=>fs.existsSync(folder)?fs.readdirSync(folder,{withFileTypes:true}).flatMap(e=>{const p=path.join(folder,e.name);return e.isDirectory()?visit(p):[path.relative(root,p)];}):[];
 return [...new Set([...fixed,...visit(path.join(root,'assets/camp-060')),...visit(path.join(root,'dist'))])].filter(f=>fs.existsSync(path.join(root,f))).sort();
}
function hashFiles():Record<string,string>{return Object.fromEntries(listProductFiles().map(f=>[f,createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex')]));}
const productHashesAtStart=hashFiles();
function currentPage(win:BrowserWindow):string|null{try{return new URL(win.webContents.getURL()).searchParams.get('page');}catch{return null;}}
function nativeSnapshot():Array<Record<string,unknown>>{return [...nativeWindows.values()].map(w=>{try{w.last={isVisible:w.visible(),isFocused:w.focused(),isMinimized:w.minimized()};return{id:w.id,page:w.page,...w.last};}catch(e){return{id:w.id,page:w.page,...w.last,destroyed:true,error:String(e)};}});}
function writeProgress(error?:unknown):void{try{fs.mkdirSync(evidenceDir,{recursive:true});fs.writeFileSync(reportPath,JSON.stringify({schema:'pixelstreet.camp-060.luna-max-hidden-native.v1',runId,scenario,status,at:new Date().toISOString(),app:{name:APP_NAME,version:APP_VERSION,profileName:PROFILE_NAME},platform:process.platform,arch:process.arch,electron:process.versions.electron,profileRoot,profileFile:path.join(profileRoot,'solo/profile.json'),preflight:preflight?{version:preflight.version,job:preflight.job,coins:preflight.coins,sequence:preflight.sequence,fixture:scenario==='fixture'}:null,records,errors,suppression,nativeWindows:nativeSnapshot(),productHashesAtStart,productHashesAtEnd:error?undefined:hashFiles(),error:error?String(error):undefined,stack:error instanceof Error?error.stack:undefined,evidenceBoundary:{windowPolicy:'macOS activation policy prohibited; dock hidden; app.focus and BrowserWindow show/showInactive/focus/moveTop plus webContents.focus intercepted.',windowState:'isVisible/isFocused/isMinimized recorded from original bound Electron APIs.',input:'Only HTMLElement.click(), resize, test-worker clock, and optional hidden renderer snapshot push; no physical mouse or keyboard evidence claimed.',keyboard:'No keyboard events are sent; a passive key-event counter is installed in renderer.',profile:'Only the new /private/tmp isolated profile for this run is accessed.'}},null,2)+'\n',{mode:0o600});}catch(e){errors.push(`report write failed: ${String(e)}`);}}
function record(name:string,rowStatus:Status='PASS',detail?:unknown):void{records.push({name,status:rowStatus,detail});writeProgress();}
function replace(target:any,key:string,value:unknown):void{const old=Object.getOwnPropertyDescriptor(target,key);if(old&&!old.configurable&&!old.writable)throw Error(`cannot suppress Electron.${key}`);Object.defineProperty(target,key,{configurable:true,enumerable:old?.enumerable??true,writable:true,value});}
function patchWindow(win:BrowserWindow):void{const id=win.id,visible=win.isVisible.bind(win),focused=win.isFocused.bind(win),minimized=win.isMinimized.bind(win);const row:NativeRow={id,page:currentPage(win),visible,focused,minimized,last:{isVisible:visible(),isFocused:focused(),isMinimized:minimized()}};nativeWindows.set(id,row);const destroy=win.destroy.bind(win);replace(win,'destroy',()=>{try{row.last={isVisible:visible(),isFocused:focused(),isMinimized:minimized()};}catch{}destroy();});replace(win,'show',()=>{suppression.show++;});replace(win,'showInactive',()=>{suppression.showInactive++;});replace(win,'focus',()=>{suppression.windowFocus++;});replace(win,'moveTop',()=>{suppression.moveTop++;});replace(win.webContents,'focus',()=>{suppression.webContentsFocus++;});win.webContents.on('console-message',(event:any)=>{if(event.level==='error')errors.push(String(event.message).slice(0,500));});win.webContents.on('did-finish-load',()=>{const r=nativeWindows.get(id);if(r)r.page=currentPage(win);});}
async function until(fn:()=>Promise<boolean>|boolean,label:string,timeout=25000):Promise<void>{const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await pause(35);}throw Error(`timeout: ${label}`);}
async function js<T=unknown>(win:BrowserWindow,source:string):Promise<T>{return await win.webContents.executeJavaScript(source) as T;}
function profile():Profile{const p=shell?.game.state.profile;if(!p)throw Error(`profile unavailable: ${shell?.game.state.error??'unknown'}`);return p;}
function arena():BrowserWindow{const w=shell?.arenaWindow;if(!w||w.isDestroyed())throw Error('casual arena window unavailable');return w;}
async function waitUi(win=arena(),label='casual UI idle'):Promise<void>{await until(()=>!win.isDestroyed()&&js<boolean>(win,'document.body.dataset.casualReady==="true"&&document.getElementById("casualUi")?.dataset.busy==="false"'),label);}
function fixtureProfile(now:number):Profile{const p=initialProfile(now);p.coins=20_000;p.bag.flour=500;p.bag.gel=90;p.leisure.clears=[50,50,50,50,50];p.leisure.materials={herb:500,berry:500,mushroom:500,ore:4000,tea:100,biscuit:200,soup:100,pumpkin:500,snowflower:500,pie:100,snowtea:100};p.leisure.journal.relics=Array(15).fill(1);p.leisure.journal.dust=1000;return parseProfile(p);}
function seedProfile(now:number):Profile{markIsolatedFolder(profileRoot,app.getPath('appData'));const folder=path.join(profileRoot,'solo');fs.mkdirSync(folder,{recursive:true,mode:0o700});const raw=scenario==='fresh'?initialProfile(now):fixtureProfile(now),valid=parseProfile(raw),file=path.join(folder,'profile.json');fs.writeFileSync(file,JSON.stringify(valid)+'\n',{flag:'wx',mode:0o600});const readback=new GameStore(folder,now).value;assert.deepEqual(readback,valid,'GameStore readback must equal parseProfile preflight');return parseProfile(readback);}
async function clickPortal():Promise<BrowserWindow>{if(!overlay||overlay.isDestroyed())throw Error('overlay unavailable');const s=await js<{exists:boolean;hidden:boolean;reachable:boolean;label:string}>(overlay,`(()=>{const e=document.getElementById('dungeonSign'),r=e?.getBoundingClientRect();return{exists:!!e,hidden:!e||e.hidden,reachable:!!r&&r.width>0&&r.height>0,label:e?.getAttribute('aria-label')||''}})()`);assert.ok(s.exists&&s.reachable&&!s.hidden,`dungeonSign unavailable: ${JSON.stringify(s)}`);assert.match(s.label,/悠游|冒险/);await js(overlay,"document.getElementById('dungeonSign').click()");record('software DOM click dungeonSign','PASS',{label:s.label,input:'HTMLElement.click()'});await until(()=>!!shell?.arenaWindow&&!shell.arenaWindow.isDestroyed(),'arena creation');const win=arena();await waitUi(win,'casual page ready');assert.equal(win.isVisible(),false);assert.equal(win.isFocused(),false);await js(win,`window.__campKeyEvents=0;for(const t of ['keydown','keyup','keypress'])document.addEventListener(t,()=>window.__campKeyEvents++,true);window.__campButtonRefs=Object.fromEntries(Array.from(document.querySelectorAll('#casualUi button[id]')).map(e=>[e.id,e]));true`);record('hidden casual native page is ready','PASS',{page:currentPage(win),isVisible:win.isVisible(),isFocused:win.isFocused(),bounds:win.getBounds()});return win;}
async function buttonState(win:BrowserWindow,id:string):Promise<{exists:boolean;hidden:boolean;disabled:boolean;label:string;tooltip:string;reachable:boolean}>{return await js(win,`(()=>{const e=document.getElementById(${JSON.stringify(id)}),content=document.getElementById('cContent');if(e&&!e.hidden)e.scrollIntoView({block:'nearest',inline:'nearest'});const r=e?.getBoundingClientRect(),v=content?.getBoundingClientRect(),hit=r?document.elementFromPoint(r.left+r.width/2,r.top+r.height/2):null,box=v&&e?.closest('#cContent')?v:{left:0,top:0,right:innerWidth,bottom:innerHeight};return{exists:!!e,hidden:!e||e.hidden||!!e.closest('[hidden]'),disabled:!e||e.disabled,label:e?.getAttribute('aria-label')||e?.textContent?.trim()||'',tooltip:e?.dataset.tooltip||'',reachable:!!r&&r.width>0&&r.height>0&&r.bottom>box.top&&r.top<box.bottom&&r.right>box.left&&r.left<box.right&&hit?.closest('button')===e}})()`);}
async function clickButton(win:BrowserWindow,id:string):Promise<void>{await waitUi(win);const s=await buttonState(win,id);assert.ok(s.exists&&!s.hidden&&!s.disabled&&s.reachable,`${id} not clickable: ${JSON.stringify(s)}`);await js(win,`document.getElementById(${JSON.stringify(id)}).click()`);await pause(80);await waitUi(win,`${id} settle`);record(`software DOM click ${id}`,'PASS',{label:s.label,tooltip:s.tooltip,scrollReachable:s.reachable,input:'HTMLElement.click()'});}
async function clickAction(win:BrowserWindow,id:string):Promise<Profile>{await waitUi(win);const s=await buttonState(win,id);assert.ok(s.exists&&!s.hidden&&!s.disabled&&s.reachable,`${id} not actionable: ${JSON.stringify(s)}`);const before=profile().sequence;await js(win,`document.getElementById(${JSON.stringify(id)}).click()`);await until(()=>profile().sequence===before+1,`${id} action receipt`);await waitUi(win,`${id} settled`);const p=profile();record(`software DOM action ${id}`,'PASS',{label:s.label,tooltip:s.tooltip,sequence:p.sequence,notice:p.notice,scrollReachable:s.reachable,input:'HTMLElement.click()'});return p;}
async function expectDisabled(win:BrowserWindow,id:string,reason:RegExp,hidden=false):Promise<void>{const s=await buttonState(win,id);assert.ok(s.exists,`missing expected control ${id}`);assert.equal(s.hidden,hidden,`${id} hidden state`);if(!hidden){assert.equal(s.disabled,true,`${id} expected disabled`);assert.match(s.tooltip,reason,`${id} disabled tooltip`);}record(`expected disabled/hidden state ${id}`,'PASS',{hidden:s.hidden,disabled:s.disabled,tooltip:s.tooltip});}
async function tab(win:BrowserWindow,name:string):Promise<void>{const id='cTab-'+name,panel='cPanel-'+name;await clickButton(win,id);const s=await js<{selected:string|null;hidden:boolean}>(win,`({selected:document.getElementById(${JSON.stringify(id)}).getAttribute('aria-selected'),hidden:document.getElementById(${JSON.stringify(panel)}).hidden})`);assert.deepEqual(s,{selected:'true',hidden:false});await pause(180);record(`tab ${name}`,'PASS',s);}
async function capture(win:BrowserWindow,label:string,minWidth=800,minHeight=580):Promise<void>{await pause(240);const image=await win.webContents.capturePage(),size=image.getSize(),png=image.toPNG(),bitmap=image.toBitmap();let nonzero=0;for(let i=0;i<bitmap.length;i+=Math.max(4,Math.floor(bitmap.length/5000/4)*4))if(bitmap[i]||bitmap[i+1]||bitmap[i+2])nonzero++;const file=path.join(evidenceDir,`native-${runId}-${label}.png`);fs.writeFileSync(file,png,{mode:0o600,flag:'wx'});assert.ok(size.width>=minWidth&&size.height>=minHeight,`capturePage image too small: ${JSON.stringify(size)}`);assert.ok(nonzero>0,'capturePage returned no visible pixels');record(`hidden capturePage ${label}`,'PASS',{path:file,size,bytes:png.length,nonzeroSampledPixels:nonzero,native:{isVisible:win.isVisible(),isFocused:win.isFocused()},evidence:'hidden Electron render; no physical display or pointer evidence'});}
function inventoryCounts(p:Profile):Record<string,number>{return{flour:p.bag.flour,gel:p.bag.gel,ration:p.bag.ration,crystal:p.bag.crystal,herb:p.leisure.materials.herb,berry:p.leisure.materials.berry,mushroom:p.leisure.materials.mushroom,ore:p.leisure.materials.ore,tea:p.leisure.materials.tea,biscuit:p.leisure.materials.biscuit,soup:p.leisure.materials.soup,pumpkin:p.leisure.materials.pumpkin,snowflower:p.leisure.materials.snowflower,pie:p.leisure.materials.pie,snowtea:p.leisure.materials.snowtea,dust:p.leisure.journal.dust};}
async function inventoryJs<T=unknown>(source:string):Promise<T>{const win=shell?.inventoryWindow;if(!win||win.isDestroyed())throw Error('inventory window unavailable');return await js<T>(win,source);}
async function verifyInventoryCounts(label:string):Promise<void>{await until(async()=>{const expected=inventoryCounts(profile()),actual=await inventoryJs<Record<string,number>>(`Object.fromEntries(Array.from(document.querySelectorAll('.inventory-item')).map(e=>[e.querySelector('.inventory-count').id.replace('inventory-',''),Number(e.querySelector('.inventory-count').textContent)]))`);return Object.entries(expected).every(([id,value])=>actual[id]===value);},`${label} inventory live counts`);const expected=inventoryCounts(profile()),actual=await inventoryJs<Record<string,number>>(`Object.fromEntries(Array.from(document.querySelectorAll('.inventory-item')).map(e=>[e.querySelector('.inventory-count').id.replace('inventory-',''),Number(e.querySelector('.inventory-count').textContent)]))`);assert.deepEqual(actual,expected);record(`inventory live counts ${label}`,'PASS',{count:Object.keys(actual).length,values:actual});}
async function openInventoryPanel(label:string):Promise<void>{const s=await js<{reachable:boolean;tooltip:string;label:string}>(overlay!,`(()=>{const b=document.getElementById('openInventory'),r=b.getBoundingClientRect();return{reachable:r.width>0&&r.height>0,label:b.getAttribute('aria-label')||'',tooltip:b.dataset.tooltip||''}})()`);assert.ok(s.reachable);await js(overlay!,"document.getElementById('openInventory').click()");record('software DOM click openInventory','PASS',{...s,input:'HTMLElement.click()'});await until(()=>!!shell?.inventoryWindow&&!shell.inventoryWindow.isDestroyed()&&js<boolean>(shell.inventoryWindow,'document.body.dataset.inventoryReady==="true"'),'inventory page ready');const win=shell!.inventoryWindow!;assert.equal(currentPage(win),'inventory');assert.equal(win.isVisible(),false);assert.equal(win.isFocused(),false);const rows=await inventoryJs<Array<{id:string;name:string;category:string;fontSize:number}>>(`Array.from(document.querySelectorAll('.inventory-item')).map(e=>({id:e.querySelector('.inventory-count').id.replace('inventory-',''),name:e.querySelector('.inventory-item-name').textContent,category:e.dataset.category,fontSize:parseFloat(getComputedStyle(e.querySelector('.inventory-item-name')).fontSize)}))`),ids=['flour','gel','ration','crystal','herb','berry','mushroom','ore','tea','biscuit','soup','pumpkin','snowflower','pie','snowtea','dust'];assert.deepEqual(rows.map(r=>r.id),ids);assert.equal(rows.filter(r=>r.category==='材料').length,9);assert.equal(rows.filter(r=>r.category==='补给').length,7);assert.ok(rows.every(r=>r.fontSize>=16));const layout=await inventoryJs<{scrollHeight:number;clientHeight:number;scrollTop:number;lastVisible:boolean}>(`(()=>{const grid=document.querySelector('.inventory-grid'),last=document.getElementById('inventory-dust').closest('.inventory-item');grid.scrollTop=grid.scrollHeight;const g=grid.getBoundingClientRect(),r=last.getBoundingClientRect();return{scrollHeight:grid.scrollHeight,clientHeight:grid.clientHeight,scrollTop:grid.scrollTop,lastVisible:r.top>=g.top-1&&r.bottom<=g.bottom+1}})()`);assert.ok(layout.scrollHeight>layout.clientHeight);assert.equal(layout.lastVisible,true);record(`inventory 16-item layout and scroll ${label}`,'PASS',{items:rows,layout,native:{isVisible:win.isVisible(),isFocused:win.isFocused()}});for(const [filter,count]of [['材料',9],['补给',7],['全部',16]] as const){await inventoryJs(`document.querySelector('[data-filter="${filter}"]').click()`);await pause(40);const result=await inventoryJs<{pressed:string;visible:number}>(`(()=>{const b=document.querySelector('[data-filter="${filter}"]');return{pressed:b.getAttribute('aria-pressed'),visible:document.querySelectorAll('.inventory-item:not([hidden])').length}})()`);assert.equal(result.pressed,'true');assert.equal(result.visible,count);record(`inventory category filter ${filter}`,'PASS',result);}await inventoryJs("document.querySelector('[data-filter=\"全部\"]').click();document.querySelector('.inventory-grid').scrollTop=0");await capture(win,`inventory-${label}-400x330`,360,280);await verifyInventoryCounts(`${label} initial`);}
async function closeInventoryPanel(label:string):Promise<void>{const win=shell?.inventoryWindow;if(!win||win.isDestroyed())throw Error('inventory panel missing');const b=await inventoryJs<{reachable:boolean;tooltip:string}>(`(()=>{const e=document.getElementById('inventoryClose'),r=e.getBoundingClientRect();return{reachable:r.width>0&&r.height>0,tooltip:e.getAttribute('aria-label')||''}})()`);assert.ok(b.reachable);await inventoryJs("document.getElementById('inventoryClose').click()");await until(()=>!shell?.inventoryWindow,`${label} inventory close`);const native=nativeSnapshot().find(row=>row.id===win.id);assert.equal(native?.isVisible,false);assert.equal(native?.isFocused,false);record('software DOM click inventoryClose','PASS',{...b,native,input:'HTMLElement.click()'});}
async function pushSnapshot(win:BrowserWindow):Promise<void>{win.webContents.send(channels.update,shell!.state());await waitUi(win,'explicit hidden snapshot push');}
async function resize(win:BrowserWindow,width:number,height:number):Promise<void>{win.setSize(width,height);await pause(280);const v=await js<{width:number;height:number;scrollWidth:number}>(win,'({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth})');assert.equal(v.width,width);assert.ok(v.height<=height&&v.height>=height-40);assert.ok(v.scrollWidth<=v.width+1);record(`hidden native size ${width}x${height}`,'PASS',{viewport:v,isVisible:win.isVisible(),isFocused:win.isFocused()});}
async function auditButtons(win:BrowserWindow):Promise<void>{const rows=await js<Array<{id:string;gameButton:boolean;tooltip:string;fontSize:number;cursor:string;disabled:boolean;hidden:boolean}>>(win,`Array.from(document.querySelectorAll('#casualUi button[id]')).map(b=>({id:b.id,gameButton:b.classList.contains('game-button'),tooltip:(b.dataset.tooltip||b.getAttribute('aria-label')||'').trim(),fontSize:parseFloat(getComputedStyle(b).fontSize),cursor:getComputedStyle(b).cursor,disabled:b.disabled,hidden:b.hidden||!!b.closest('[hidden]')}))`);assert.ok(rows.length>=100,`unexpected control inventory ${rows.length}`);const bad=rows.filter(b=>!b.gameButton||!b.tooltip||b.fontSize<16||b.cursor!==(b.disabled?'not-allowed':'pointer'));assert.deepEqual(bad,[],'buttons must use GameButton, tooltip, readable text, cursor');record('dynamic button inventory and visual contract','PASS',{count:rows.length,ids:rows.map(b=>b.id),minimumFont:Math.min(...rows.map(b=>b.fontSize)),bad});}
async function pointerPress(win:BrowserWindow,id:string):Promise<void>{const result=await js<{down:boolean;up:boolean}>(win,`(()=>{const b=document.getElementById(${JSON.stringify(id)});b.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'mouse',button:0,isPrimary:true}));const down=b.classList.contains('is-pressed');b.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerType:'mouse',button:0,isPrimary:true}));return{down,up:!b.classList.contains('is-pressed')}})()`);assert.deepEqual(result,{down:true,up:true});record(`synthetic pointer press feedback ${id}`,'PASS',{...result,evidence:'software PointerEvent only; no physical mouse evidence'});}
async function auditMapPins(win:BrowserWindow,label:string):Promise<void>{const rows=await js<Array<{id:string;disabled:boolean;hidden:boolean;display:string;visibility:string;opacity:string;pointerEvents:string;zIndex:string;rect:{x:number;y:number;width:number;height:number};map:{x:number;y:number;width:number;height:number};insideMap:boolean;hitTag:string|null;hitId:string|null;hitClass:string|null;hitButton:string|null;scrollTop:number}>>(win,`(()=>{const content=document.getElementById('cContent'),map=document.querySelector('.c-world-map'),out=[];for(const b of Array.from(map.querySelectorAll('button[id^="cZone"]'))){b.scrollIntoView({block:'nearest',inline:'nearest'});const r=b.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,hit=document.elementFromPoint(x,y),cs=getComputedStyle(b),mapBox=map.getBoundingClientRect();out.push({id:b.id,disabled:b.disabled,hidden:b.hidden||!!b.closest('[hidden]'),display:cs.display,visibility:cs.visibility,opacity:cs.opacity,pointerEvents:cs.pointerEvents,zIndex:cs.zIndex,rect:{x:r.x,y:r.y,width:r.width,height:r.height},map:{x:mapBox.x,y:mapBox.y,width:mapBox.width,height:mapBox.height},insideMap:r.left>=mapBox.left&&r.right<=mapBox.right&&r.top>=mapBox.top&&r.bottom<=mapBox.bottom,hitTag:hit?.tagName??null,hitId:hit?.id??null,hitClass:hit?.className?.toString?.()??null,hitButton:hit?.closest('button')?.id??null,scrollTop:content.scrollTop});}content.scrollTop=0;return out})()`);const bad=rows.filter(r=>r.hidden||r.display==='none'||r.visibility!=='visible'||Number(r.opacity)<=0||r.pointerEvents==='none'||!r.insideMap||r.hitButton!==r.id);assert.equal(rows.length,5);assert.deepEqual(bad,[],`map pins not visible/hittable: ${JSON.stringify(bad)}`);record(`five map pins visible and center-hit reachable ${label}`,'PASS',{pins:rows,evidence:'software DOM geometry/hit-test only; no physical pointer evidence'});}
async function auditPanel(win:BrowserWindow,panelName:string,label:string):Promise<void>{const rows=await js<Array<{id:string;reachable:boolean;scrollTop:number;width:number;height:number}>>(win,`(()=>{const content=document.getElementById('cContent'),section=document.getElementById(${JSON.stringify('cPanel-'+panelName)}),out=[];content.scrollTop=0;for(const b of Array.from(section.querySelectorAll('button[id]'))){if(b.hidden||b.closest('[hidden]'))continue;b.scrollIntoView({block:'nearest',inline:'nearest'});const r=b.getBoundingClientRect(),v=content.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);out.push({id:b.id,reachable:r.width>0&&r.height>0&&r.bottom>v.top&&r.top<v.bottom&&r.right>v.left&&r.left<v.right&&hit?.closest('button')===b,scrollTop:content.scrollTop,width:r.width,height:r.height});}content.scrollTop=0;return out})()`);assert.ok(rows.length>0,`${label} has no visible controls`);const bad=rows.filter(r=>!r.reachable||r.width<=0||r.height<=0);assert.deepEqual(bad,[],`${label} controls cannot be reached by scrolling`);const overflow=await js<{innerWidth:number;page:number;content:number;client:number}>(win,'({innerWidth, page:document.documentElement.scrollWidth, content:document.getElementById("cContent").scrollWidth, client:document.getElementById("cContent").clientWidth})');assert.ok(overflow.page<=overflow.innerWidth+1&&overflow.content<=overflow.client+1);record(`scroll reachability ${label}`,'PASS',{count:rows.length,allVisibleReachable:true,maxScroll:Math.max(0,...rows.map(r=>r.scrollTop)),overflow});}
async function auditRelicAtlas(win:BrowserWindow,label:string):Promise<void>{
 const r=await js<{icons:Array<{id:number;position:string;background:string}>;region:Array<{id:string|null;position:string;label:string|null}>;zone:number}>(win,"(()=>({icons:Array.from(document.querySelectorAll('#cPanel-collection .c-relic-art[data-relic]')).map(e=>({id:Number(e.dataset.relic),position:getComputedStyle(e).backgroundPosition,background:getComputedStyle(e).backgroundImage})),region:Array.from(document.querySelectorAll('.c-region-relics .c-relic-art')).map(e=>({id:e.dataset.relic||null,position:getComputedStyle(e).backgroundPosition,label:e.getAttribute('aria-label')})),zone:Number((document.querySelector('.c-map-pin[aria-pressed=\"true\"]')?.id||'cZone0').replace('cZone',''))}))()");
 assert.equal(r.icons.length,15);
 assert.equal(new Set(r.icons.map(i=>i.position)).size,15);
 assert.ok(r.icons.every(i=>i.background.includes('relics.webp')));
 assert.deepEqual(r.region.map(i=>i.id),[String(r.zone*3),String(r.zone*3+1),String(r.zone*3+2)]);
 record('15 distinct relic atlas cells '+label,'PASS',r);
}
async function screenshots(win:BrowserWindow,prefix:string):Promise<void>{await resize(win,1040,760);await tab(win,'adventure');await auditMapPins(win,prefix);await capture(win,`${prefix}-adventure-map-1040x760`);await clickButton(win,'cToggleMap');await capture(win,`${prefix}-adventure-scenery-1040x760`);const bg=await js<{zone:string;frame:string;imgLoaded:boolean;imgWidth:number;background:string}>(win,`(()=>{const e=document.getElementById('cScene'),s=getComputedStyle(e),img=document.querySelector('#cMapView img');return{zone:e.dataset.zone,frame:document.getElementById('cEnemySprite').dataset.frame,imgLoaded:!!img?.complete&&img.naturalWidth>0,imgWidth:img?.naturalWidth||0,background:s.backgroundImage}})()`);assert.ok(bg.imgLoaded&&bg.background.includes('camp-060/moss.webp'));record('map and initial scenery assets loaded','PASS',bg);await clickButton(win,'cToggleMap');await tab(win,'camp');await auditPanel(win,'camp',`${prefix} camp`);await capture(win,`${prefix}-camp-1040x760`);await tab(win,'collection');await auditPanel(win,'collection',`${prefix} collection`);await auditRelicAtlas(win,prefix);await capture(win,`${prefix}-collection-1040x760`);await tab(win,'adventure');await auditPanel(win,'adventure',`${prefix} adventure`);await resize(win,800,620);await auditPanel(win,'adventure',`${prefix} adventure at 800x620`);await capture(win,`${prefix}-adventure-800x620`);await resize(win,1040,760);}
async function auditFiveScenes(win:BrowserWindow,prefix:string):Promise<void>{const expected=['moss','moon','star','wind','snow'];for(let i=0;i<expected.length;i++){if(i>0){await clickButton(win,'cToggleMap');await clickButton(win,`cZone${i}`);await clickButton(win,'cToggleMap');}else await clickButton(win,'cToggleMap');const s=await js<{zone:string;background:string}>(win,"(()=>({zone:document.getElementById('cScene').dataset.zone,background:getComputedStyle(document.getElementById('cScene')).backgroundImage}))()");assert.equal(s.zone,String(i));assert.ok(s.background.includes(`camp-060/${expected[i]}.png`),`zone ${i} scenic image missing: ${s.background}`);await capture(win,`${prefix}-scene-zone-${i}-${expected[i]}`);record(`scene image ${i} loaded and selected`,'PASS',s);}await clickButton(win,'cToggleMap');}
async function advance(ms:number,label:string):Promise<Profile>{const before=profile().tick;const state=await shell!.game.request('advance',{ms});assert.ok(state.profile);await until(()=>profile().tick>=before+Math.floor(ms/100)-1,`${label} worker ticks`);if(shell?.arenaWindow&&!shell.arenaWindow.isDestroyed())await pushSnapshot(shell.arenaWindow);const p=profile();record(`test worker clock ${label}`,'PASS',{requestedMs:ms,beforeTick:before,afterTick:p.tick,run:p.leisure.run&&{zone:p.leisure.run.zone,room:p.leisure.run.room},rendererSnapshot:'test harness explicitly pushes current production shell.state() to hidden renderer for inspection; no production broadcast while hidden'});return p;}
async function fresh():Promise<void>{await openInventoryPanel('fresh');let win=await clickPortal();assert.equal(profile().version,8);assert.equal(profile().job,'visitor');assert.equal(profile().coins,20);await auditButtons(win);await screenshots(win,'fresh');await expectDisabled(win,'cZone1',/苔光庭院/);await expectDisabled(win,'cZone2',/月泉矿洞/);await expectDisabled(win,'cDepth1',/旅人小屋|熟悉度/);await expectDisabled(win,'cDepth2',/旅人小屋|熟悉度/);await expectDisabled(win,'cTrips6',/旅人小屋Lv3/);await expectDisabled(win,'cReturn',/.*/,true);await expectDisabled(win,'cClaim',/战利品箱还是空的/);await expectDisabled(win,'cAssist',/.*/,true);assert.equal(await js<boolean>(win,"document.getElementById('cQuickClaim').hidden"),true);await pointerPress(win,'cStart');await clickButton(win,'cZone0');await clickButton(win,'cRoute-balanced');await clickButton(win,'cTrips1');let p=await clickAction(win,'cStart');assert.equal(p.leisure.run?.total,1);assert.equal(await js<boolean>(win,"document.getElementById('cScene').hidden"),false);assert.equal(await js<boolean>(win,"document.getElementById('cMapView').hidden"),true);await capture(win,'fresh-running');const due=p.leisure.run!.due;p=await clickAction(win,'cAssist');assert.equal(p.leisure.run!.due,due-30);p=await advance(120_000,'new visitor completes one six-room trip');assert.equal(p.leisure.rooms,6);assert.equal(p.leisure.clears[0],1);await clickAction(win,'cQuickClaim');assert.equal(profile().leisure.cargo.ore,0);assert.equal(profile().coins,48);await clickButton(win,'cToggleMap');await clickButton(win,'cZone1');assert.equal(await js<string>(win,"document.getElementById('cRegionName').textContent"),'月泉矿洞');await verifyInventoryCounts('fresh after adventure claim');await tab(win,'garden');p=await clickAction(win,'cGardenUpgrade');assert.equal(p.leisure.gardenLevel,1);await clickButton(win,'cSeed-herb');p=await clickAction(win,'cPlant0');assert.equal(p.leisure.plots[0]?.crop,'herb');await expectDisabled(win,'cHarvest0',/作物还在生长/);p=await advance(180_000,'new visitor herb grows while away');assert.equal(p.leisure.plots[0]?.crop,'herb');p=await clickAction(win,'cHarvest0');assert.equal(p.leisure.materials.herb,4);await verifyInventoryCounts('fresh after harvest');await tab(win,'kitchen');for(const food of ['tea','biscuit','soup','pie','snowtea']){await expectDisabled(win,`cSell1-${food}`,/没有可出售的食品/);await expectDisabled(win,`cSellAll-${food}`,/没有可出售的食品/);}p=await clickAction(win,'cCook1-tea');const beforeTeaSale=p.coins;p=await clickAction(win,'cSell1-tea');assert.equal(p.leisure.materials.tea,0);assert.ok(p.coins>beforeTeaSale);await verifyInventoryCounts('fresh after tea sale');record('fresh visitor reaches adventure, garden, kitchen and sale loop','PASS',{version:p.version,coins:p.coins,rooms:p.leisure.rooms,harvests:p.leisure.harvests,cooked:p.leisure.cooked});const before=structuredClone(profile().leisure);await js(win,"document.getElementById('cClose').click()");await until(()=>!shell?.arenaWindow,'casual window close');win=await clickPortal();assert.deepEqual(profile().leisure,before,'close/reopen persists fresh progress');await clickButton(win,'cGuide');assert.equal(await js<boolean>(win,"document.getElementById('cHelp').hidden"),false);await clickButton(win,'cGuideClose');assert.equal(await js<boolean>(win,"document.getElementById('cHelp').hidden"),true);record('guide open/close and close/reopen persistence','PASS',{rooms:profile().leisure.rooms,coins:profile().coins});await clickButton(win,'cZone0');await clickButton(win,'cTrips3');p=await clickAction(win,'cStart');assert.equal(p.leisure.run?.total,3);await clickButton(win,'cMinimize');assert.equal(win.isMinimized(),true);assert.equal(win.isVisible(),false);assert.equal(win.isFocused(),false);p=await advance(360_000,'three trips continue while hidden window is minimized');assert.equal(p.leisure.run,null);assert.equal(p.leisure.rooms,24);assert.equal(p.leisure.clears[0],4);record('minimized hidden native adventure continues on test clock','PASS',{rooms:p.leisure.rooms,clears:p.leisure.clears,native:{isVisible:win.isVisible(),isFocused:win.isFocused(),isMinimized:win.isMinimized()}});await js(win,"document.getElementById('cClose').click()");await until(()=>!shell?.arenaWindow,'close minimized casual window');win=await clickPortal();assert.equal(profile().leisure.rooms,24);await clickAction(win,'cClaim');assert.equal(profile().leisure.cargo.coins,0);assert.equal(await js<number>(win,'window.__campKeyEvents'),0);record('fresh flow closed/reopened without keyboard events','PASS',{keyEvents:0,coins:profile().coins,rooms:profile().leisure.rooms});await js(win,"document.getElementById('cClose').click()");await until(()=>!shell?.arenaWindow,'final fresh window close');await verifyInventoryCounts('fresh after final claim');await closeInventoryPanel('fresh final');}

async function fixture():Promise<void>{
 await openInventoryPanel('fixture');
 let win=await clickPortal();
 assert.equal(profile().version,8);
 assert.equal(profile().coins,20000);
 assert.equal(profile().leisure.clears.length,5);
 assert.equal(profile().leisure.journal.relics.length,15);
 await auditButtons(win);
 await screenshots(win,'fixture');
 await auditFiveScenes(win,'fixture');

 await tab(win,'garden');
 for(let i=0;i<2;i++)await clickAction(win,'cGardenUpgrade');
 assert.equal(profile().leisure.gardenLevel,2);
 await expectDisabled(win,'cGardenUpgrade',/花圃已满级/);
 for(let i=0;i<3;i++){
  const crop=['herb','berry','mushroom'][i];
  await clickButton(win,'cSeed-'+crop);
  await clickAction(win,'cPlant'+i);
 }
 await advance(600500,'fixture herb berry mushroom mature');
 for(let i=0;i<3;i++)await clickAction(win,'cHarvest'+i);
 await clickButton(win,'cSeed-pumpkin');
 await clickAction(win,'cPlant0');
 await clickButton(win,'cSeed-snowflower');
 await clickAction(win,'cPlant1');
 await advance(900500,'fixture pumpkin and snowflower mature');
 await clickAction(win,'cHarvest0');
 await clickAction(win,'cHarvest1');
 assert.equal(profile().leisure.harvests,5);
 await verifyInventoryCounts('fixture after all five crops');

 await tab(win,'kitchen');
 for(const id of ['cBuyFlour','cSellGel','cSellOre'])await clickAction(win,id);
 assert.equal(profile().bag.flour,510);
 assert.equal(profile().bag.gel,85);
 const seenContracts=new Set<string>();
 for(let round=0;round<8;round++)for(let slot=0;slot<3;slot++){
  const name=String(await js(win,"document.getElementById('cContractName"+slot+"').textContent"));
  const state=await buttonState(win,'cDeliver'+slot);
  assert.ok(state.exists&&!state.hidden&&!state.disabled&&state.reachable,'contract '+slot+' should be deliverable: '+JSON.stringify(state));
  seenContracts.add(name);
  await clickAction(win,'cDeliver'+slot);
 }
 assert.equal(seenContracts.size,8,'each of the eight rotating contracts must appear');
 assert.equal(profile().leisure.journal.deliveries,24);
 assert.deepEqual(profile().leisure.journal.contracts,[8,8,8]);
 record('all 8 rotating contracts delivered in each slot','PASS',{names:[...seenContracts],contracts:profile().leisure.journal.contracts,deliveries:profile().leisure.journal.deliveries});

 await tab(win,'friends');
 await expectDisabled(win,'cRecruit-slime',/.*/,true);
 await expectDisabled(win,'cEquip-slime',/已经在带队/);
 await clickAction(win,'cRecruit-guide');
 await clickAction(win,'cRecruit-guard');
 await expectDisabled(win,'cRecruit-guide',/.*/,true);
 await expectDisabled(win,'cRecruit-guard',/.*/,true);
 for(const companion of ['slime','guide','guard'] as const){
  if(profile().leisure.active===companion)await expectDisabled(win,'cEquip-'+companion,/已经在带队/);
  else{
   const p=await clickAction(win,'cEquip-'+companion);
   assert.equal(p.leisure.active,companion);
  }
  for(let level=0;level<14;level++){
   const p=await clickAction(win,'cFeed-'+companion);
   assert.equal(p.leisure.companions[companion],level+1);
  }
  await expectDisabled(win,'cFeed-'+companion,/伙伴已到Lv5/);
 }
 if(profile().leisure.active!=='slime')await clickAction(win,'cEquip-slime');
 await expectDisabled(win,'cEquip-slime',/已经在带队/);
 assert.deepEqual(profile().leisure.companions,{slime:14,guide:14,guard:14});
 await auditPanel(win,'friends','fixture friends after recruitment and growth');

 await tab(win,'kitchen');
 for(const food of ['tea','biscuit','soup','pie','snowtea']){
  await clickAction(win,'cCook1-'+food);
  await clickAction(win,'cCook5-'+food);
  await clickAction(win,'cSell1-'+food);
  await clickAction(win,'cSellAll-'+food);
  await expectDisabled(win,'cSell1-'+food,/没有可出售的食品/);
  await expectDisabled(win,'cSellAll-'+food,/没有可出售的食品/);
 }
 assert.equal(profile().leisure.cooked,30);
 await clickAction(win,'cSellAllGel');
 assert.equal(profile().bag.gel,0);
 await verifyInventoryCounts('fixture after cooking and selling every food');

 await tab(win,'adventure');
 await expectDisabled(win,'cDepth1',/建至Lv1/);
 await expectDisabled(win,'cDepth2',/建至Lv2/);
 await expectDisabled(win,'cTrips6',/旅人小屋Lv3/);
 await tab(win,'camp');
 await clickAction(win,'cBuild-lodge');
 assert.ok(String(await js(win,"document.getElementById('cCampBonus').textContent")).includes('凝胶容量 150'));
 await tab(win,'adventure');
 await clickButton(win,'cDepth1');
 await expectDisabled(win,'cDepth2',/建至Lv2/);
 await tab(win,'camp');
 await clickAction(win,'cBuild-lodge');
 assert.ok(String(await js(win,"document.getElementById('cCampBonus').textContent")).includes('凝胶容量 200'));
 await tab(win,'adventure');
 await clickButton(win,'cDepth2');
 await tab(win,'camp');
 await clickAction(win,'cBuild-lodge');
 assert.ok(String(await js(win,"document.getElementById('cCampBonus').textContent")).includes('凝胶容量 250'));
 await tab(win,'adventure');
 const sixTrip=await buttonState(win,'cTrips6');
 assert.ok(sixTrip.exists&&!sixTrip.hidden&&!sixTrip.disabled&&sixTrip.reachable,'six trips should open at lodge Lv3');
 await clickButton(win,'cTrips6');
 assert.equal(profile().leisure.journal.buildings.lodge,3);
 await tab(win,'camp');
 await expectDisabled(win,'cBuild-lodge',/建筑已满级/);

 await tab(win,'camp');
 for(let level=1;level<=3;level++){
  await clickAction(win,'cBuild-workshop');
  await tab(win,'kitchen');
  const price=Number(await js(win,"document.getElementById('cFoodPrice-tea').textContent"));
  assert.equal(price,12+2*level,'workshop dynamic food price at level '+level);
  await tab(win,'camp');
 }
 assert.equal(profile().leisure.journal.buildings.workshop,3);
 await expectDisabled(win,'cBuild-workshop',/建筑已满级/);

 await tab(win,'collection');
 await expectDisabled(win,'cRelicUpgrade-0',/建至Lv1/);
 await tab(win,'camp');
 await clickAction(win,'cBuild-archive');
 await tab(win,'collection');
 for(let i=0;i<15;i++){
  const p=await clickAction(win,'cRelicUpgrade-'+i);
  assert.equal(p.leisure.journal.relics[i],2);
 }
 await expectDisabled(win,'cRelicUpgrade-0',/建至Lv2/);
 await tab(win,'camp');
 await clickAction(win,'cBuild-archive');
 await tab(win,'collection');
 for(let i=0;i<15;i++){
  const p=await clickAction(win,'cRelicUpgrade-'+i);
  assert.equal(p.leisure.journal.relics[i],3);
 }
 await expectDisabled(win,'cRelicUpgrade-0',/三星/);
 await tab(win,'camp');
 await clickAction(win,'cBuild-archive');
 assert.deepEqual(profile().leisure.journal.buildings,{lodge:3,workshop:3,archive:3});
 await expectDisabled(win,'cBuild-archive',/建筑已满级/);
 await tab(win,'collection');
 await auditRelicAtlas(win,'fixture after all relic repairs');
 await auditPanel(win,'collection','fixture collection after relic repairs');

 await tab(win,'adventure');
 await clickButton(win,'cZone0');
 const returnedRun=await clickAction(win,'cStart');
 assert.equal(returnedRun.leisure.run?.zone,0);
 const returned=await clickAction(win,'cReturn');
 assert.equal(returned.leisure.run,null);
 await expectDisabled(win,'cReturn',/.*/,true);
 assert.equal(returned.leisure.cargo.coins,0);
 await clickButton(win,'cToggleMap');

 const routes=['balanced','gather','treasure','balanced','gather'];
 const depths=[0,1,2,2,1];
 const tripCounts=[1,1,1,3,6];
 for(let zone=0;zone<5;zone++){
  const mapHidden=await js<boolean>(win,"document.getElementById('cMapView').hidden");
  if(mapHidden)await clickButton(win,'cToggleMap');
  await clickButton(win,'cZone'+zone);
  for(const route of ['balanced','gather','treasure'])await clickButton(win,'cRoute-'+route);
  await clickButton(win,'cRoute-'+routes[zone]);
  for(let depth=0;depth<3;depth++)await clickButton(win,'cDepth'+depth);
  await clickButton(win,'cDepth'+depths[zone]);
  for(const count of [1,3,6])await clickButton(win,'cTrips'+count);
  await clickButton(win,'cTrips'+tripCounts[zone]);
  const started=await clickAction(win,'cStart');
  assert.equal(started.leisure.run?.zone,zone);
  assert.equal(started.leisure.run?.route,routes[zone]);
  assert.equal(started.leisure.run?.depth,depths[zone]);
  assert.equal(started.leisure.run?.total,tripCounts[zone]);
  if(zone===0){
   const due=started.leisure.run!.due;
   const assisted=await clickAction(win,'cAssist');
   assert.equal(assisted.leisure.run!.due,due-30);
  }
  if(zone===3){
   const due=started.leisure.run!.due;
   const assisted=await clickAction(win,'cAssist');
   assert.equal(assisted.leisure.run!.due,due-30);
   await js(win,"document.getElementById('cClose').click()");
   await until(()=>!shell?.arenaWindow,'close during zone 3 task');
   win=await clickPortal();
   await until(async()=>!!profile().leisure.run&&await js<boolean>(win,"document.getElementById('cScene').hidden===false&&document.getElementById('cMapView').hidden===true&&document.getElementById('cScene').dataset.zone==='3'"),'restore nonzero in-flight scenic destination');
   const restored=await js<{sceneHidden:boolean;mapHidden:boolean;zone:string;zonePressed:string|null;routePressed:string|null;depthPressed:string|null;tripsPressed:string|null;background:string}>(win,"(()=>({sceneHidden:document.getElementById('cScene').hidden,mapHidden:document.getElementById('cMapView').hidden,zone:document.getElementById('cScene').dataset.zone,zonePressed:document.getElementById('cZone3').getAttribute('aria-pressed'),routePressed:document.getElementById('cRoute-balanced').getAttribute('aria-pressed'),depthPressed:document.getElementById('cDepth2').getAttribute('aria-pressed'),tripsPressed:document.getElementById('cTrips3').getAttribute('aria-pressed'),background:getComputedStyle(document.getElementById('cScene')).backgroundImage}))()");
   assert.equal(restored.sceneHidden,false);
   assert.equal(restored.mapHidden,true);
   assert.equal(restored.zone,'3');
   assert.equal(restored.zonePressed,'true');
   assert.equal(restored.routePressed,'true');
   assert.equal(restored.depthPressed,'true');
   assert.equal(restored.tripsPressed,'true');
   assert.ok(restored.background.includes('wind.webp'));
   assert.equal(profile().leisure.run?.zone,3);
   assert.equal(profile().leisure.run?.route,routes[zone]);
   assert.equal(profile().leisure.run?.depth,depths[zone]);
   assert.equal(profile().leisure.run?.total,tripCounts[zone]);
   await capture(win,'fixture-zone3-inflight-restored');
   record('close/reopen preserves nonzero in-flight region, route, depth and trips','PASS',{restored,run:{zone:profile().leisure.run?.zone,route:profile().leisure.run?.route,depth:profile().leisure.run?.depth,total:profile().leisure.run?.total},native:{isVisible:win.isVisible(),isFocused:win.isFocused()}});
  }
  const run=profile().leisure.run!;
  const before=profile().leisure.clears[zone];
  const p=await advance(run.duration*6*run.remaining*100+500,'fixture region '+zone+' journey');
  assert.equal(p.leisure.run,null);
  assert.equal(p.leisure.clears[zone],before+tripCounts[zone]);
  const scene=await js<{zone:string;sceneHidden:boolean;mapHidden:boolean;background:string}>(win,"(()=>({zone:document.getElementById('cScene').dataset.zone,sceneHidden:document.getElementById('cScene').hidden,mapHidden:document.getElementById('cMapView').hidden,background:getComputedStyle(document.getElementById('cScene')).backgroundImage}))()");
  if(zone===3){
   assert.equal(scene.zone,'3');
   assert.equal(scene.sceneHidden,false);
   assert.equal(scene.mapHidden,true);
   assert.ok(scene.background.includes('wind.webp'));
   await capture(win,'fixture-zone3-finished-scenery-retained');
  }
  const claimId=zone===3?'cQuickClaim':'cClaim';
  await clickAction(win,claimId);
  assert.equal(profile().leisure.cargo.coins,0);
  record('destination journey completed and claimed '+zone,'PASS',{zone,clearCount:profile().leisure.clears[zone],route:routes[zone],depth:depths[zone],trips:tripCounts[zone],scene});
 }
 assert.equal(profile().leisure.clears[3],53);
 assert.equal(profile().leisure.clears[4],56);

 await tab(win,'collection');
 const awards=['first-trip','green-fingers','camp-chef','good-friend','moon-path','star-path','wind-path','snow-path','relic-hunter','relic-master','camp-builder','camp-home','helping-hand','old-friend'];
 for(const id of awards){
  const p=await clickAction(win,'cCollection-'+id);
  assert.ok(p.leisure.claimed.includes(id),'collection reward not recorded: '+id);
 }
 assert.equal(profile().leisure.claimed.length,14);
 await expectDisabled(win,'cCollection-first-trip',/纪念奖励已领取/);
 await verifyInventoryCounts('fixture after collection rewards');

 await resize(win,800,620);
 for(const name of ['adventure','garden','kitchen','friends','camp','collection']){
  await tab(win,name);
  await auditPanel(win,name,'fixture '+name+' at 800x620');
 }
 await resize(win,1040,760);
 const keyEvents=await js<number>(win,'window.__campKeyEvents');
 assert.equal(keyEvents,0);
 const actionCount=records.filter(r=>r.name.startsWith('software DOM action ')).length;
 record('rich fixture exercised all tabs and new systems','PASS',{clears:profile().leisure.clears,buildings:profile().leisure.journal.buildings,relicRanks:profile().leisure.journal.relics,contracts:profile().leisure.journal.contracts,deliveries:profile().leisure.journal.deliveries,companions:profile().leisure.companions,harvests:profile().leisure.harvests,cooked:profile().leisure.cooked,claimed:profile().leisure.claimed.length,actionCount,buttonCount:await js<number>(win,"document.querySelectorAll('#casualUi button[id]').length"),keyEvents,isVisible:win.isVisible(),isFocused:win.isFocused()});
 await js(win,"document.getElementById('cClose').click()");
 await until(()=>!shell?.arenaWindow,'final rich fixture window close');
 await verifyInventoryCounts('fixture final');
 await closeInventoryPanel('fixture final');
}

async function main():Promise<void>{try{fs.mkdirSync('/private/tmp',{recursive:true});preflight=seedProfile(Date.now());assert.equal(assertIsolatedFolder(profileRoot,app.getPath('appData'),true),profileRoot);assert.equal(preflight.version,8);if(scenario==='fresh'){assert.equal(preflight.job,'visitor');assert.equal(preflight.coins,20);}record('independent profile preflight via parseProfile and GameStore','PASS',{profileRoot,version:preflight.version,job:preflight.job,coins:preflight.coins,sequence:preflight.sequence,scenario});if(process.platform==='darwin'){app.setActivationPolicy('prohibited');app.dock?.hide();record('macOS activation suppression','PASS',{policy:'prohibited',dockHidden:true});}replace(app,'focus',()=>{suppression.appFocus++;return false;});replace(Menu,'setApplicationMenu',()=>{});app.on('browser-window-created',(_e,win)=>patchWindow(win));app.on('web-contents-created',(_e:any,contents:any)=>contents.on('console-message',(event:any)=>{if(event.level==='error')errors.push(String(event.message).slice(0,500));}));shell=await startDesktop(profileRoot,true);overlay=shell.overlay;await until(()=>js<boolean>(overlay!,'document.body.dataset.atlas==="verified"&&!!document.getElementById("dungeonSign")'),'hidden overlay ready');await until(()=>shell!.game.state.status==='ready'&&shell!.game.state.profile?.version===8,'game worker ready');assert.equal(overlay.isVisible(),false);assert.equal(overlay.isFocused(),false);record('hidden shell and schema8 worker ready','PASS',{overlay:{isVisible:overlay.isVisible(),isFocused:overlay.isFocused()},profile:{version:profile().version,job:profile().job,coins:profile().coins},status:shell.game.state.status});if(scenario==='fresh')await fresh();else await fixture();assert.equal(suppression.globalShortcut,0,'no globalShortcut API request');assert.equal(errors.length,0,`renderer console errors: ${errors.join('; ')}`);for(const w of nativeSnapshot())assert.equal(w.isVisible,false,`window visible: ${JSON.stringify(w)}`);assert.equal(JSON.stringify(productHashesAtStart),JSON.stringify(hashFiles()),'product files changed during native test');status='PASS';record('hidden native acceptance completed','PASS',{nativeWindows:nativeSnapshot(),suppression,rendererConsoleErrors:errors.length,productHashesUnchanged:true});}catch(e){status='FAIL';errors.push(String(e));writeProgress(e);console.error(e instanceof Error?e.stack:String(e));}finally{if(shell?.arenaWindow&&!shell.arenaWindow.isDestroyed())try{shell.closeArena();}catch{}writeProgress(status==='FAIL'?new Error(errors.at(-1)??'failure'):undefined);app.quit();}}
void main();
