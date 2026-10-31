import {app,Menu,type BrowserWindow} from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {startDesktop} from '../apps/desktop/bootstrap';
import {GameStore} from '../apps/desktop/game-store';
import {assertIsolatedFolder,markIsolatedFolder} from '../apps/desktop/launch-profile';
import {APP_NAME,APP_VERSION,PROFILE_NAME} from '../apps/desktop/identity';
import {channels} from '../packages/protocol';
import {initialProfile,parseProfile,type Profile} from '../packages/solo-core';

type RecordRow={name:string;status:'PASS'|'FAIL'|'INFO';detail?:unknown};
type NativeWindow={id:number;page:string|null;visible:()=>boolean;focused:()=>boolean;minimized:()=>boolean;last:{isVisible:boolean|null;isFocused:boolean|null;isMinimized:boolean|null}};
const records:RecordRow[]=[];
const errors:string[]=[];
const suppression=(globalThis as any).__pixelStreetCasualSuppression??{appFocus:0,show:0,showInactive:0,windowFocus:0,webContentsFocus:0,moveTop:0,globalShortcut:0,trayCreates:0};
const nativeWindows=new Map<number,NativeWindow>();
const root=path.resolve(__dirname,'../../..');
const evidenceDir=path.join(root,'docs/evidence/casual-052');
const scenario=(process.argv.find(a=>a.startsWith('--scenario='))?.split('=')[1]??'fresh') as 'fresh'|'fixture';
if(scenario!=='fresh'&&scenario!=='fixture')throw Error('scenario must be fresh or fixture');
const runId=new Date().toISOString().replace(/[:.]/g,'-')+'-'+process.pid+'-'+scenario;
const reportPath=path.join(evidenceDir,`native-luna-${runId}.json`);
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
let shell:Awaited<ReturnType<typeof startDesktop>>|undefined;
let overlay:BrowserWindow|undefined;
let profileRoot='';
let preflight:Profile|undefined;
let status:'RUNNING'|'PASS'|'FAIL'='RUNNING';

function productFiles():string[]{
 const fixed=['apps/desktop/identity.ts','apps/desktop/bootstrap.ts','apps/desktop/shell.ts','apps/desktop/game-store.ts','apps/desktop/game-worker.ts','apps/desktop/renderer/overlay.ts','apps/desktop/renderer/scene.ts','apps/desktop/renderer/casual.ts','apps/desktop/renderer/casual.css','apps/desktop/renderer/game-button.ts','packages/protocol/index.ts','packages/solo-core/index.ts','packages/solo-core/leisure.ts','packages/solo-core/catalog.ts','package.json','package-lock.json','dist/main.cjs','dist/preload.cjs','dist/game-worker.cjs','dist/action-worker.cjs','dist/dungeon-worker.cjs','dist/renderer/index.html'];
 const visit=(folder:string):string[]=>fs.existsSync(folder)?fs.readdirSync(folder,{withFileTypes:true}).flatMap(e=>{const p=path.join(folder,e.name);return e.isDirectory()?visit(p):[p];}):[];
 return [...new Set([...fixed,...visit(path.join(root,'dist/renderer')).map(p=>path.relative(root,p))])].filter(f=>fs.existsSync(path.join(root,f))).sort();
}
function hashFiles():Record<string,string>{return Object.fromEntries(productFiles().map(f=>[f,createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex')]));}
const productHashesAtStart=hashFiles();
function currentPage(win:BrowserWindow):string|null{try{return new URL(win.webContents.getURL()).searchParams.get('page');}catch{return null;}}
function nativeSnapshot():Array<Record<string,unknown>>{
 return [...nativeWindows.values()].map(w=>{try{w.last={isVisible:w.visible(),isFocused:w.focused(),isMinimized:w.minimized()};return{id:w.id,page:w.page,...w.last};}catch(e){return{id:w.id,page:w.page,...w.last,destroyed:true,error:String(e)};}});
}
function writeProgress(error?:unknown):void{
 try{
  fs.mkdirSync(evidenceDir,{recursive:true});
  fs.writeFileSync(reportPath,JSON.stringify({schema:'pixelstreet.casual-052.luna-max-hidden-native.v1',runId,scenario,status,at:new Date().toISOString(),app:{name:APP_NAME,version:APP_VERSION,profileName:PROFILE_NAME},platform:process.platform,arch:process.arch,electron:process.versions.electron,profileRoot,profileFile:profileRoot?path.join(profileRoot,'solo/profile.json'):null,preflight:preflight?{version:preflight.version,job:preflight.job,coins:preflight.coins,sequence:preflight.sequence,kind:scenario==='fresh'?'parseProfile(initialProfile) default visitor':'parseProfile(rich test fixture)'}:null,records,errors,suppression,nativeWindows:nativeSnapshot(),productHashesAtStart,productHashesAtEnd:error?undefined:hashFiles(),error:error?String(error):undefined,stack:error instanceof Error?error.stack:undefined,evidenceBoundary:{windowPolicy:'Electron app activation prohibited and dock hidden on macOS; BrowserWindow show/showInactive/focus/moveTop and webContents.focus are intercepted before returning to application code.',windowState:'isVisible/isFocused/isMinimized are captured through original bound Electron API functions.',input:'All interactions in this run use software DOM click()/test-clock or synthetic IPC refresh. No physical mouse/keyboard evidence is claimed.',keyboard:'No keyboard events are sent; renderer listeners count keydown/keyup/keypress.',profile:'Only the newly-created /private/tmp isolated profile is read or written.'}},null,2)+'\n',{mode:0o600});
 }catch(e){errors.push(`report write failed: ${String(e)}`);}
}
function record(name:string,rowStatus:'PASS'|'FAIL'|'INFO'='PASS',detail?:unknown):void{records.push({name,status:rowStatus,detail});writeProgress();}
function replace(target:any,key:string,value:unknown):void{
 const old=Object.getOwnPropertyDescriptor(target,key);
 if(old&&!old.configurable&&!old.writable)throw Error(`cannot suppress Electron.${key}`);
 Object.defineProperty(target,key,{configurable:true,enumerable:old?.enumerable??true,writable:true,value});
}
function patchWindow(win:BrowserWindow):void{
 const id=win.id,visible=win.isVisible.bind(win),focused=win.isFocused.bind(win),minimized=win.isMinimized.bind(win);
 const row:NativeWindow={id,page:currentPage(win),visible,focused,minimized,last:{isVisible:visible(),isFocused:focused(),isMinimized:minimized()}};nativeWindows.set(id,row);
 const destroy=win.destroy.bind(win);replace(win,'destroy',()=>{try{row.last={isVisible:visible(),isFocused:focused(),isMinimized:minimized()};}catch{}destroy();});
 replace(win,'show',()=>{suppression.show++;});
 replace(win,'showInactive',()=>{suppression.showInactive++;});
 replace(win,'focus',()=>{suppression.windowFocus++;});
 replace(win,'moveTop',()=>{suppression.moveTop++;});
 replace(win.webContents,'focus',()=>{suppression.webContentsFocus++;});
 win.webContents.on('console-message',(event:any)=>{if(event.level==='error')errors.push(String(event.message).slice(0,500));});
 win.webContents.on('did-finish-load',()=>{const row=nativeWindows.get(id);if(row)row.page=currentPage(win);});
}
async function until(fn:()=>Promise<boolean>|boolean,label:string,timeout=20000):Promise<void>{
 const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await pause(35);}throw Error(`timeout: ${label}`);
}
async function js<T=unknown>(win:BrowserWindow,source:string):Promise<T>{return await win.webContents.executeJavaScript(source) as T;}
function currentProfile():Profile{const p=shell?.game.state.profile;if(!p)throw Error(`game profile unavailable: ${shell?.game.state.error??'unknown'}`);return p;}
function arena():BrowserWindow{const w=shell?.arenaWindow;if(!w||w.isDestroyed())throw Error('casual native window unavailable');return w;}
async function waitUi(win=arena(),label='casual UI idle'):Promise<void>{
 await until(()=>!win.isDestroyed()&&js<boolean>(win,'document.body.dataset.casualReady==="true"&&document.getElementById("casualUi")?.dataset.busy==="false"'),label);
}
function fixtureProfile(now:number):Profile{
 const p=initialProfile(now);p.coins=20_000;p.bag.flour=200;p.bag.gel=100;
 p.leisure.materials={herb:60,berry:60,mushroom:60,ore:500,tea:20,biscuit:80,soup:20,pumpkin:60,snowflower:60,pie:20,snowtea:20};
 return parseProfile(p);
}
function seedProfile(folder:string,kind:'fresh'|'fixture',now:number):Profile{
 const solo=path.join(folder,'solo');fs.mkdirSync(solo,{recursive:true,mode:0o700});
 const raw=kind==='fresh'?initialProfile(now):fixtureProfile(now),validated=parseProfile(raw),file=path.join(solo,'profile.json');
 fs.writeFileSync(file,JSON.stringify(validated)+'\n',{flag:'wx',mode:0o600});
 const readback=new GameStore(solo,now).value;assert.deepEqual(readback,validated,'preflight GameStore readback');
 return parseProfile(readback);
}
async function clickPortal():Promise<BrowserWindow>{
 if(!overlay||overlay.isDestroyed())throw Error('overlay unavailable');
 const target=await js<{exists:boolean;hidden:boolean;reachable:boolean;label:string}>(overlay,`(()=>{const e=document.getElementById('dungeonSign'),r=e?.getBoundingClientRect();return{exists:!!e,hidden:!e||e.hidden,reachable:!!r&&r.width>0&&r.height>0,label:e?.getAttribute('aria-label')||''}})()`);
 assert.deepEqual(target,{exists:true,hidden:false,reachable:true,label:target.label});assert.match(target.label,/休闲冒险/);
 await js(overlay,"document.getElementById('dungeonSign').click()");
 record('software DOM click dungeon entrance','PASS',{label:target.label,input:'HTMLElement.click()'});
 await until(()=>!!shell?.arenaWindow&&!shell.arenaWindow.isDestroyed(),'arena native window creation');
 const win=arena();await until(()=>js<boolean>(win,'document.body.dataset.casualReady==="true"'),'casual page ready');await waitUi(win);
 assert.equal(win.isVisible(),false,'native BrowserWindow isVisible must remain false');assert.equal(win.isFocused(),false,'native BrowserWindow isFocused must remain false');
 await js(win,`window.__casualKeyEvents=0;for(const t of ['keydown','keyup','keypress'])document.addEventListener(t,()=>window.__casualKeyEvents++,true);window.__casualButtonRefs=Object.fromEntries(Array.from(document.querySelectorAll('#casualUi button[id]')).map(e=>[e.id,e]));true`);
 record('dungeon portal opens hidden native page=casual','PASS',{label:target.label,page:currentPage(win),ready:true,isVisible:win.isVisible(),isFocused:win.isFocused(),width:win.getBounds().width,height:win.getBounds().height});
 return win;
}
async function uiState(win:BrowserWindow,id:string):Promise<{exists:boolean;hidden:boolean;disabled:boolean;label:string;tooltip:string;reachable:boolean}>{
 return await js(win,`(()=>{const e=document.getElementById(${JSON.stringify(id)}),content=document.getElementById('cContent');if(e&&!e.hidden)e.scrollIntoView({block:'nearest',inline:'nearest'});const r=e?.getBoundingClientRect(),v=content?.getBoundingClientRect(),hit=r?document.elementFromPoint(r.left+r.width/2,r.top+r.height/2):null,viewport={left:0,top:0,right:innerWidth,bottom:innerHeight};const box=v&&e?.closest('#cContent')?v:viewport;return{exists:!!e,hidden:!e||e.hidden||!!e.closest('[hidden]'),disabled:!e||e.disabled,label:e?.getAttribute('aria-label')||e?.textContent?.trim()||'',tooltip:e?.dataset.tooltip||'',reachable:!!r&&r.width>0&&r.height>0&&r.bottom>box.top&&r.top<box.bottom&&r.right>box.left&&r.left<box.right&&hit?.closest('button')===e}})()`);
}
async function revealButtonTab(win:BrowserWindow,id:string):Promise<void>{
 const owner=await js<{panel:string|null;tab:string|null;hidden:boolean}>(win,`(()=>{const e=document.getElementById(${JSON.stringify(id)}),p=e?.closest('[role="tabpanel"]');return{panel:p?.id||null,tab:p?.getAttribute('aria-labelledby')||null,hidden:!!p?.hidden}})()`);
 if(owner.panel&&owner.tab&&owner.hidden)await tab(win,owner.tab,owner.panel);
}
async function clickWindowButton(win:BrowserWindow,id:'cClose'|'cMinimize',label:string):Promise<void>{
 await waitUi(win);const s=await uiState(win,id);assert.ok(s.exists,`missing button ${id}`);assert.equal(s.hidden,false,`${id} is hidden`);assert.equal(s.disabled,false,`${id} disabled`);assert.equal(s.reachable,true,`${id} cannot be reached`);
 await js(win,`document.getElementById(${JSON.stringify(id)}).click()`);
 if(id==='cClose')await until(()=>!shell?.arenaWindow,label);else await until(()=>win.isMinimized(),label);
 const native=nativeSnapshot().find(w=>w.id===win.id);record(`software DOM click ${id}`,'PASS',{label:s.label,tooltip:s.tooltip,native,input:'HTMLElement.click()'});
}
async function clickSimple(win:BrowserWindow,id:string):Promise<void>{
 await waitUi(win);await revealButtonTab(win,id);const s=await uiState(win,id);assert.ok(s.exists,`missing button ${id}`);assert.equal(s.hidden,false,`${id} is hidden`);assert.equal(s.disabled,false,`${id} disabled: ${s.tooltip}`);assert.equal(s.reachable,true,`${id} cannot be scrolled into view`);
 const before=currentProfile().sequence;await js(win,`document.getElementById(${JSON.stringify(id)}).click()`);await pause(40);await waitUi(win,`${id} UI update`);assert.equal(currentProfile().sequence,before,`${id} must be a local UI action`);
 record(`software DOM click ${id}`,'PASS',{label:s.label,tooltip:s.tooltip,scrollReachable:s.reachable,input:'HTMLElement.click()'});
}
async function clickAction(win:BrowserWindow,id:string):Promise<Profile>{
 await waitUi(win);await revealButtonTab(win,id);const s=await uiState(win,id);assert.ok(s.exists,`missing action ${id}`);assert.equal(s.hidden,false,`${id} is hidden`);assert.equal(s.disabled,false,`${id} disabled: ${s.tooltip}`);assert.equal(s.reachable,true,`${id} cannot be scrolled into view`);
 const before=currentProfile().sequence;await js(win,`document.getElementById(${JSON.stringify(id)}).click()`);
 await until(()=>currentProfile().sequence===before+1,`${id} action receipt`);await waitUi(win,`${id} action settled`);const p=currentProfile();
 record(`software DOM click ${id}`,'PASS',{label:s.label,tooltip:s.tooltip,sequence:p.sequence,notice:p.notice,scrollReachable:s.reachable,input:'HTMLElement.click()'});return p;
}
async function assertDisabled(win:BrowserWindow,id:string,reason:RegExp,hidden=false):Promise<void>{
 await revealButtonTab(win,id);const s=await uiState(win,id);assert.ok(s.exists,`missing button ${id}`);assert.equal(s.hidden,hidden,`${id} hidden state`);if(!hidden){assert.equal(s.disabled,true,`${id} expected disabled`);assert.ok(reason.test(s.tooltip),`${id} disabled reason ${s.tooltip}`);}
 record(`expected disabled state ${id}`,'PASS',{hidden:s.hidden,disabled:s.disabled,tooltip:s.tooltip});
}
async function tab(win:BrowserWindow,id:string,panel:string):Promise<void>{
 await clickSimple(win,id);const s=await js<{selected:string|null;hidden:boolean}>(win,`({selected:document.getElementById(${JSON.stringify(id)}).getAttribute('aria-selected'),hidden:document.getElementById(${JSON.stringify(panel)}).hidden})`);assert.deepEqual(s,{selected:'true',hidden:false});await pause(160);record(`tab ${id}`,'PASS',s);
}
async function auditButtons(win:BrowserWindow):Promise<void>{
 const rows=await js<Array<{id:string;gameButton:boolean;tooltip:string;fontSize:number;cursor:string;disabled:boolean;hidden:boolean}>>(win,`Array.from(document.querySelectorAll('#casualUi button[id]')).map(b=>({id:b.id,gameButton:b.classList.contains('game-button'),tooltip:(b.dataset.tooltip||b.getAttribute('aria-label')||'').trim(),fontSize:parseFloat(getComputedStyle(b).fontSize),cursor:getComputedStyle(b).cursor,disabled:b.disabled,hidden:b.hidden||!!b.closest('[hidden]')}))`);
 assert.equal(rows.length,63,`unexpected casual button inventory (${rows.length})`);
 const bad=rows.filter(b=>!b.gameButton||!b.tooltip||b.fontSize<16||b.cursor!==(b.disabled?'not-allowed':'pointer'));
 assert.deepEqual(bad,[],'a casual control violates GameButton, tooltip, readable text or cursor contract');
 record('all casual buttons meet GameButton and readability contract','PASS',{count:rows.length,ids:rows.map(b=>b.id),fontRange:[Math.min(...rows.map(b=>b.fontSize)),Math.max(...rows.map(b=>b.fontSize))],enabled:rows.filter(b=>!b.disabled).length,disabled:rows.filter(b=>b.disabled).length,hidden:rows.filter(b=>b.hidden).length});
}
async function auditReachability(win:BrowserWindow,panel:string,label:string):Promise<void>{
 const rows=await js<Array<{id:string;reachable:boolean;scrollTop:number;w:number;h:number}>>(win,`(()=>{const content=document.getElementById('cContent'),section=document.getElementById(${JSON.stringify(panel)}),out=[];content.scrollTop=0;for(const b of Array.from(section.querySelectorAll('button[id]'))){if(b.hidden||b.closest('[hidden]'))continue;b.scrollIntoView({block:'nearest',inline:'nearest'});const r=b.getBoundingClientRect(),v=content.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);out.push({id:b.id,reachable:r.width>0&&r.height>0&&r.bottom>v.top&&r.top<v.bottom&&r.right>v.left&&r.left<v.right&&hit?.closest('button')===b,scrollTop:content.scrollTop,w:r.width,h:r.height});}content.scrollTop=0;return out})()`);
 const bad=rows.filter(r=>!r.reachable||r.w<=0||r.h<=0);assert.deepEqual(bad,[],`${label} contains a button that cannot be scrolled into view`);
 const width=await js<{innerWidth:number;scrollWidth:number;contentWidth:number;contentClient:number}>(win,"({innerWidth,scrollWidth:document.documentElement.scrollWidth,contentWidth:document.getElementById('cContent').scrollWidth,contentClient:document.getElementById('cContent').clientWidth})");
 assert.ok(width.scrollWidth<=width.innerWidth+1,`${label} horizontal page overflow ${JSON.stringify(width)}`);assert.ok(width.contentWidth<=width.contentClient+1,`${label} horizontal content overflow ${JSON.stringify(width)}`);
 record(`scroll reachability ${label}`,'PASS',{count:rows.length,allReachable:true,scrollRange:[Math.min(0,...rows.map(r=>r.scrollTop)),Math.max(0,...rows.map(r=>r.scrollTop))],ids:rows.map(r=>r.id),width});
}
async function stableButtons(win:BrowserWindow):Promise<void>{
 const r=await js<{stable:boolean;count:number;missing:string[]}>(win,`(()=>{const refs=window.__casualButtonRefs||{},ids=Object.keys(refs),missing=ids.filter(id=>document.getElementById(id)!==refs[id]);return{stable:ids.length===63&&missing.length===0,count:ids.length,missing}})()`);assert.equal(r.stable,true,`casual button nodes were replaced ${r.missing.join(',')}`);record('button DOM references remain stable','PASS',r);
}
async function pointerContract(win:BrowserWindow,id:string):Promise<void>{
 const r=await js<{down:boolean;up:boolean}>(win,`(()=>{const b=document.getElementById(${JSON.stringify(id)});b.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'mouse',button:0,isPrimary:true}));const down=b.classList.contains('is-pressed');b.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerType:'mouse',button:0,isPrimary:true}));return{down,up:!b.classList.contains('is-pressed')}})()`);assert.deepEqual(r,{down:true,up:true});record(`synthetic pointer press state ${id}`,'PASS',{...r,evidence:'software PointerEvent, not physical mouse'});
}
async function resizeAndRecord(win:BrowserWindow,width:number,height:number,label:string):Promise<void>{
 win.setSize(width,height);await pause(300);const view=await js<{width:number;height:number;scrollWidth:number}>(win,'({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth})');assert.equal(view.width,width,`${label} window width`);assert.ok(view.height<=height&&view.height>=height-40,`${label} viewport height ${view.height}`);assert.ok(view.scrollWidth<=view.width+1,`${label} page overflows horizontally`);
 record(`native hidden window size ${label}`,'PASS',{requested:{width,height},viewport:view,nativeBounds:win.getBounds(),isVisible:win.isVisible(),isFocused:win.isFocused()});
}
async function capture(win:BrowserWindow,label:string):Promise<void>{
 await pause(220);try{const image=await win.webContents.capturePage(),size=image.getSize(),png=image.toPNG(),bitmap=image.toBitmap(),stride=Math.max(4,Math.floor(bitmap.length/800/4)*4),colors=new Set<string>();for(let i=0;i+3<bitmap.length;i+=stride)colors.add(`${bitmap[i]},${bitmap[i+1]},${bitmap[i+2]},${bitmap[i+3]}`);
  const file=path.join(evidenceDir,`native-luna-${runId}-${label}.png`);fs.writeFileSync(file,png,{mode:0o600});const valid=png.length>1000&&size.width>=400&&size.height>=300&&colors.size>8;record(`hidden Electron capturePage ${label}`,valid?'PASS':'INFO',{file,width:size.width,height:size.height,pngBytes:png.length,sampledColors:colors.size,pixelEvidence:valid?'valid':'insufficient pixels',isVisible:win.isVisible(),isFocused:win.isFocused()});
 }catch(e){record(`hidden Electron capturePage ${label}`,'INFO',{error:String(e),evidence:'capturePage failed; window remained hidden'});}
}
async function inventoryJs<T=unknown>(source:string):Promise<T>{
 const win=shell?.inventoryWindow;if(!win||win.isDestroyed())throw Error('inventory native window unavailable');return await js<T>(win,source);
}
function inventoryCounts(profile:Profile):Record<string,number>{
 return{flour:profile.bag.flour,gel:profile.bag.gel,ration:profile.bag.ration,crystal:profile.bag.crystal,herb:profile.leisure.materials.herb,berry:profile.leisure.materials.berry,mushroom:profile.leisure.materials.mushroom,ore:profile.leisure.materials.ore,tea:profile.leisure.materials.tea,biscuit:profile.leisure.materials.biscuit,soup:profile.leisure.materials.soup};
}
async function verifyInventoryCounts(label:string):Promise<void>{
 await until(async()=>{const expected=inventoryCounts(currentProfile()),actual=await inventoryJs<Record<string,number>>(`Object.fromEntries(Array.from(document.querySelectorAll('.inventory-item')).map(e=>[e.querySelector('.inventory-count').id.replace('inventory-',''),Number(e.querySelector('.inventory-count').textContent)]))`);return Object.entries(expected).every(([id,value])=>actual[id]===value);},`${label} inventory count refresh`);
 const expected=inventoryCounts(currentProfile()),actual=await inventoryJs<Record<string,number>>(`Object.fromEntries(Array.from(document.querySelectorAll('.inventory-item')).map(e=>[e.querySelector('.inventory-count').id.replace('inventory-',''),Number(e.querySelector('.inventory-count').textContent)]))`);assert.deepEqual(actual,expected,`${label} inventory counts should match saved profile`);record(`inventory live material counts ${label}`,'PASS',{count:11,values:actual});
}
async function openInventoryPanel(label:string):Promise<void>{
 const state=await js<{exists:boolean;reachable:boolean;label:string;tooltip:string}>(overlay!,`(()=>{const b=document.getElementById('openInventory'),r=b?.getBoundingClientRect();return{exists:!!b,reachable:!!r&&r.width>0&&r.height>0,label:b?.getAttribute('aria-label')||'',tooltip:b?.dataset.tooltip||''}})()`);assert.ok(state.exists&&state.reachable,'open inventory control must be reachable');
 await js(overlay!,"document.getElementById('openInventory').click()");record('software DOM click openInventory','PASS',{...state,input:'HTMLElement.click()'});
 await until(()=>!!shell?.inventoryWindow&&!shell.inventoryWindow.isDestroyed()&&js<boolean>(shell.inventoryWindow,'document.body.dataset.inventoryReady==="true"'),'inventory window ready');const win=shell!.inventoryWindow!;assert.equal(currentPage(win),'inventory');assert.equal(win.isVisible(),false);assert.equal(win.isFocused(),false);record('inventory opens as hidden native window','PASS',{page:currentPage(win),isVisible:win.isVisible(),isFocused:win.isFocused(),bounds:win.getBounds()});
 const rows=await inventoryJs<Array<{id:string;name:string;category:string;fontSize:number}>>(`Array.from(document.querySelectorAll('.inventory-item')).map(e=>({id:e.querySelector('.inventory-count').id.replace('inventory-',''),name:e.querySelector('.inventory-item-name').textContent,category:e.dataset.category,fontSize:parseFloat(getComputedStyle(e.querySelector('.inventory-item-name')).fontSize)}))`);
 const ids=['flour','gel','ration','crystal','herb','berry','mushroom','ore','tea','biscuit','soup'];assert.deepEqual(rows.map(r=>r.id),ids);assert.equal(rows.filter(r=>r.category==='材料').length,6);assert.equal(rows.filter(r=>r.category==='补给').length,5);assert.ok(rows.every(r=>r.fontSize>=16));
 const layout=await inventoryJs<{width:number;height:number;scrollHeight:number;clientHeight:number;scrollTop:number;lastVisible:boolean}>(`(()=>{const grid=document.querySelector('.inventory-grid'),last=document.getElementById('inventory-soup').closest('.inventory-item');grid.scrollTop=grid.scrollHeight;const g=grid.getBoundingClientRect(),r=last.getBoundingClientRect();return{width:innerWidth,height:innerHeight,scrollHeight:grid.scrollHeight,clientHeight:grid.clientHeight,scrollTop:grid.scrollTop,lastVisible:r.top>=g.top-1&&r.bottom<=g.bottom+1}})()`);assert.ok(layout.scrollHeight>layout.clientHeight,'inventory grid should scroll at its native compact size');assert.equal(layout.lastVisible,true,'last inventory item should be reachable by scrolling');record(`inventory 11 item categories and scroll ${label}`,'PASS',{items:rows,layout});
 for(const [filter,category,count]of [['材料','材料',6],['补给','补给',5],['全部','',11]] as const){await inventoryJs(`document.querySelector('[data-filter="${filter}"]').click()`);await pause(45);const view=await inventoryJs<{pressed:string;visible:number;wrongVisible:string[]}>(`(()=>{const b=document.querySelector('[data-filter="${filter}"]'),items=Array.from(document.querySelectorAll('.inventory-item')),visible=items.filter(e=>!e.hidden);return{pressed:b.getAttribute('aria-pressed'),visible:visible.length,wrongVisible:visible.filter(e=>${JSON.stringify(category)}&&e.dataset.category!==${JSON.stringify(category)}).map(e=>e.dataset.category)}})()`);assert.equal(view.pressed,'true');assert.equal(view.visible,count);assert.deepEqual(view.wrongVisible,[]);record(`inventory category filter ${filter}`,'PASS',view);}
 await capture(win,`inventory-${label}-400x330-scroll`);await inventoryJs("document.querySelector('.inventory-grid').scrollTop=0");await pause(60);await capture(win,`inventory-${label}-400x330-top`);await verifyInventoryCounts(`${label} initial`);
}
async function closeInventoryPanel(label:string):Promise<void>{
 const win=shell?.inventoryWindow;if(!win||win.isDestroyed())throw Error('inventory panel missing before close');const button=await inventoryJs<{label:string;reachable:boolean}>(`(()=>{const b=document.getElementById('inventoryClose'),r=b?.getBoundingClientRect();return{label:b?.getAttribute('aria-label')||'',reachable:!!r&&r.width>0&&r.height>0}})()`);assert.ok(button.reachable,'inventory close control should be reachable');await inventoryJs("document.getElementById('inventoryClose').click()");await until(()=>!shell?.inventoryWindow,`${label} inventory close`);const native=nativeSnapshot().find(w=>w.id===win.id);assert.equal(native?.isVisible,false);assert.equal(native?.isFocused,false);record('software DOM click inventoryClose','PASS',{...button,native,input:'HTMLElement.click()'});
}
async function workerAdvance(ms:number,label:string):Promise<Profile>{
 const before=currentProfile().tick;const state=await shell!.game.request('advance',{ms});assert.ok(state.profile);await until(()=>currentProfile().tick>=before+Math.floor(ms/100)-1,`${label} game worker clock`);
 const win=shell?.arenaWindow;if(win&&!win.isDestroyed())win.webContents.send(channels.update,shell!.state());
 if(win&&!win.isDestroyed())await waitUi(win,`${label} renderer refresh`);
 const p=currentProfile();record(`test worker clock ${label}`,'PASS',{requestedMs:ms,beforeTick:before,afterTick:p.tick,profileVersion:p.version,rendererRefresh:'test harness explicitly pushes the current production shell.state() snapshot to hidden webContents for DOM/screenshot inspection; production does not broadcast to hidden/minimized arena windows',nativeVisible:win&&!win.isDestroyed()?win.isVisible():null,nativeFocused:win&&!win.isDestroyed()?win.isFocused():null});return p;
}
async function toggleGuide(win:BrowserWindow):Promise<void>{await clickSimple(win,'cGuide');assert.equal(await js<boolean>(win,"document.getElementById('cHelp').hidden"),false);await clickSimple(win,'cGuideClose');assert.equal(await js<boolean>(win,"document.getElementById('cHelp').hidden"),true);const state=await js<{hidden:boolean;display:string;rect:{width:number;height:number};visible:boolean}>(win,"(()=>{const e=document.getElementById('cHelp'),r=e.getBoundingClientRect(),s=getComputedStyle(e);return{hidden:e.hidden,display:s.display,rect:{width:r.width,height:r.height},visible:r.width>0&&r.height>0&&s.display!=='none'}})()");assert.deepEqual(state,{hidden:true,display:'none',rect:{width:0,height:0},visible:false},'guide close should remove it from rendered layout');record('guide open-close visibility contract','PASS',state);}
async function tabScreenshotSet(win:BrowserWindow,scenarioName:string):Promise<void>{
 for(const [tabId,panel,label] of [['cTab-adventure','cPanel-adventure','adventure'],['cTab-garden','cPanel-garden','garden'],['cTab-kitchen','cPanel-kitchen','kitchen'],['cTab-friends','cPanel-friends','friends'],['cTab-collection','cPanel-collection','collection']] as const){await tab(win,tabId,panel);await auditReachability(win,panel,label);await capture(win,`${scenarioName}-${label}-1040x760`);}
 await tab(win,'cTab-adventure','cPanel-adventure');
}
async function freshScenario():Promise<void>{
 await openInventoryPanel('fresh');const win=await clickPortal();assert.equal(currentProfile().coins,20);assert.equal(currentProfile().job,'visitor');
 await auditButtons(win);await stableButtons(win);await toggleGuide(win);await pointerContract(win,'cStart');
 await resizeAndRecord(win,1040,760,'1040x760');await capture(win,'fresh-adventure-1040x760');
 await assertDisabled(win,'cZone1',/前一个地点/);await assertDisabled(win,'cZone2',/前一个地点/);await clickSimple(win,'cZone0');await clickSimple(win,'cRoute-gather');await clickSimple(win,'cRoute-treasure');await clickSimple(win,'cRoute-balanced');await clickSimple(win,'cTrips3');await clickSimple(win,'cTrips1');
 let p=await clickAction(win,'cStart');assert.deepEqual({zone:p.leisure.run?.zone,route:p.leisure.run?.route,total:p.leisure.run?.total},{zone:0,route:'balanced',total:1});
 const dueBefore=p.leisure.run!.due;p=await clickAction(win,'cAssist');assert.equal(p.leisure.run!.due,dueBefore-30);await capture(win,'fresh-running-hidden');
 p=await workerAdvance(120_000,'fresh visitor completes six rooms');assert.equal(p.leisure.rooms,6);assert.deepEqual(p.leisure.clears,[1,0,0,0,0]);assert.deepEqual(p.leisure.cargo,{coins:28,xp:35,gel:14,ore:7});
 assert.equal(await js<boolean>(win,"document.getElementById('cQuickClaim').hidden"),false);await clickAction(win,'cQuickClaim');assert.equal(currentProfile().coins,48);assert.equal(currentProfile().bag.gel,14);assert.equal(currentProfile().leisure.materials.ore,7);assert.deepEqual(currentProfile().leisure.cargo,{coins:0,xp:0,gel:0,ore:0});
 await tab(win,'cTab-garden','cPanel-garden');await auditReachability(win,'cPanel-garden','fresh garden');await capture(win,'fresh-garden-1040x760');
 await resizeAndRecord(win,800,620,'800x620');await auditReachability(win,'cPanel-garden','fresh garden at 800x620');await capture(win,'fresh-garden-800x620');await resizeAndRecord(win,1040,760,'1040x760-restored');
 await clickSimple(win,'cSeed-herb');await clickAction(win,'cPlant0');await clickSimple(win,'cSeed-berry');await clickAction(win,'cPlant1');await clickSimple(win,'cSeed-mushroom');await clickAction(win,'cPlant2');
 for(const id of ['cHarvest0','cHarvest1','cHarvest2'])await assertDisabled(win,id,/生长/);p=await workerAdvance(600_000,'fresh crops mature while away');assert.ok(p.leisure.plots.every(Boolean));assert.equal(p.leisure.materials.herb,0);assert.equal(p.leisure.materials.berry,0);assert.equal(p.leisure.materials.mushroom,0);
 for(const id of ['cHarvest0','cHarvest1','cHarvest2'])p=await clickAction(win,id);assert.deepEqual({herb:p.leisure.materials.herb,berry:p.leisure.materials.berry,mushroom:p.leisure.materials.mushroom},{herb:3,berry:4,mushroom:2});await verifyInventoryCounts('fresh after harvest');
 await tab(win,'cTab-kitchen','cPanel-kitchen');await auditReachability(win,'cPanel-kitchen','fresh kitchen');for(const food of ['tea','biscuit','soup'])await assertDisabled(win,`cSell1-${food}`,/没有可出售的食品/);await capture(win,'fresh-kitchen-1040x760');
 p=await clickAction(win,'cBuyFlour');assert.equal(p.bag.flour,10);p=await clickAction(win,'cSellGel');assert.equal(p.bag.gel,9);p=await clickAction(win,'cCook1-tea');p=await clickAction(win,'cCook1-biscuit');p=await clickAction(win,'cCook1-biscuit');p=await clickAction(win,'cCook1-soup');p=await clickAction(win,'cSellAll-tea');p=await clickAction(win,'cSellAll-soup');p=await clickAction(win,'cSellAllGel');assert.equal(p.bag.gel,0);assert.ok(p.coins>48);await assertDisabled(win,'cSell1-tea',/没有可出售的食品/);await assertDisabled(win,'cSell1-soup',/没有可出售的食品/);await assertDisabled(win,'cSellOre',/10份月纹石/);
 await tab(win,'cTab-friends','cPanel-friends');await auditReachability(win,'cPanel-friends','fresh friends');const freeFriend=await uiState(win,'cFeed-slime');record('diagnostic fresh free companion control state','INFO',{ui:freeFriend,level:await js<string>(win,"document.getElementById('cCompanionLevel-slime').textContent"),friendPanelHidden:await js<boolean>(win,"document.getElementById('cPanel-friends').hidden")});await capture(win,'fresh-friends-1040x760');p=await clickAction(win,'cFeed-slime');p=await clickAction(win,'cFeed-slime');assert.equal(p.leisure.companions.slime,2);await tab(win,'cTab-kitchen','cPanel-kitchen');await assertDisabled(win,'cSell1-biscuit',/没有可出售的食品/);await tab(win,'cTab-friends','cPanel-friends');await assertDisabled(win,'cRecruit-guard',/完成对应地点/);p=await clickAction(win,'cRecruit-guide');assert.equal(p.leisure.companions.guide,0);p=await clickAction(win,'cEquip-guide');assert.equal(p.leisure.active,'guide');
 await tab(win,'cTab-collection','cPanel-collection');await auditReachability(win,'cPanel-collection','fresh collection');await clickAction(win,'cCollection-first-trip');await clickAction(win,'cCollection-green-fingers');await clickAction(win,'cCollection-good-friend');await assertDisabled(win,'cCollection-first-trip',/已领取/);await capture(win,'fresh-collection-1040x760');
 const beforeClose=structuredClone(currentProfile());await clickWindowButton(win,'cClose','close button destroys casual window');record('cClose leaves leisure profile persisted','PASS',{rooms:beforeClose.leisure.rooms,coins:beforeClose.coins,clears:beforeClose.leisure.clears});
 const reopened=await clickPortal();assert.equal(currentProfile().coins,beforeClose.coins);assert.deepEqual(currentProfile().leisure,beforeClose.leisure,'close/reopen retains v8 leisure state');record('portal reopen restores saved fresh visitor state','PASS',{page:currentPage(reopened),coins:currentProfile().coins,sequence:currentProfile().sequence});
 await clickSimple(reopened,'cTrips3');p=await clickAction(reopened,'cStart');assert.equal(p.leisure.run?.total,3);await clickWindowButton(reopened,'cMinimize','native minimize state');assert.equal(reopened.isVisible(),false);assert.equal(reopened.isFocused(),false);
 p=await workerAdvance(360_000,'three trips continue while casual window is minimized');assert.equal(p.leisure.run,null);assert.equal(p.leisure.rooms,24);assert.equal(p.leisure.clears[0],4);record('minimized hidden native window keeps finite adventure clock running','PASS',{isVisible:reopened.isVisible(),isFocused:reopened.isFocused(),isMinimized:reopened.isMinimized(),rooms:p.leisure.rooms,clears:p.leisure.clears,suppressed:{show:suppression.show,focus:suppression.windowFocus}});
 await clickWindowButton(reopened,'cClose','close minimized casual window');const final=await clickPortal();assert.equal(currentProfile().leisure.rooms,24);assert.equal(await js<boolean>(final,"document.getElementById('cQuickClaim').hidden"),false);await clickAction(final,'cClaim');
 const keyEvents=await js<number>(final,'window.__casualKeyEvents');assert.equal(keyEvents,0);await stableButtons(final);record('fresh visitor flow completed without keyboard events','PASS',{keyEvents,profile:{coins:currentProfile().coins,rooms:currentProfile().leisure.rooms,harvests:currentProfile().leisure.harvests,cooked:currentProfile().leisure.cooked,companionLevel:currentProfile().leisure.companions.slime}});
 await clickWindowButton(final,'cClose','fresh final close');await verifyInventoryCounts('fresh after final claim');await closeInventoryPanel('fresh final');
}
async function fixtureScenario():Promise<void>{
 await openInventoryPanel('fixture');let win=await clickPortal();await auditButtons(win);await stableButtons(win);await toggleGuide(win);await resizeAndRecord(win,1040,760,'1040x760');await capture(win,'fixture-adventure-1040x760');
 await assertDisabled(win,'cZone1',/前一个地点/);await assertDisabled(win,'cZone2',/前一个地点/);
 await tab(win,'cTab-friends','cPanel-friends');await assertDisabled(win,'cRecruit-slime',/.*/,true);await assertDisabled(win,'cRecruit-guide',/完成对应地点/);await assertDisabled(win,'cRecruit-guard',/完成对应地点/);
 await tab(win,'cTab-collection','cPanel-collection');await assertDisabled(win,'cCollection-first-trip',/完成/);
 await tab(win,'cTab-garden','cPanel-garden');await auditReachability(win,'cPanel-garden','fixture garden');await capture(win,'fixture-garden-1040x760');
 await resizeAndRecord(win,800,620,'800x620');await auditReachability(win,'cPanel-garden','fixture garden at 800x620');await capture(win,'fixture-garden-800x620');await resizeAndRecord(win,1040,760,'1040x760-restored');
 let p=await clickAction(win,'cGardenUpgrade');p=await clickAction(win,'cGardenUpgrade');assert.equal(p.leisure.gardenLevel,2);await assertDisabled(win,'cGardenUpgrade',/满级/);
 await clickSimple(win,'cSeed-herb');await clickAction(win,'cPlant0');await clickSimple(win,'cSeed-berry');await clickAction(win,'cPlant1');await clickSimple(win,'cSeed-mushroom');await clickAction(win,'cPlant2');for(const id of ['cHarvest0','cHarvest1','cHarvest2'])await assertDisabled(win,id,/生长/);
 p=await workerAdvance(600_000,'fixture crops mature');for(const id of ['cHarvest0','cHarvest1','cHarvest2'])p=await clickAction(win,id);assert.deepEqual({herb:p.leisure.materials.herb,berry:p.leisure.materials.berry,mushroom:p.leisure.materials.mushroom},{herb:65,berry:66,mushroom:64});await verifyInventoryCounts('fixture after harvest');
 await tab(win,'cTab-kitchen','cPanel-kitchen');await auditReachability(win,'cPanel-kitchen','fixture kitchen');await capture(win,'fixture-kitchen-1040x760');
 p=await clickAction(win,'cBuyFlour');assert.equal(p.bag.flour,210);p=await clickAction(win,'cSellGel');assert.equal(p.bag.gel,95);
 for(const food of ['tea','biscuit','soup'] as const){p=await clickAction(win,`cCook1-${food}`);p=await clickAction(win,`cCook5-${food}`);p=await clickAction(win,`cSell1-${food}`);if(food!=='biscuit')p=await clickAction(win,`cSellAll-${food}`);}
 p=await clickAction(win,'cSellOre');assert.equal(p.leisure.materials.ore,473);p=await clickAction(win,'cSellAllGel');assert.equal(p.bag.gel,0);await verifyInventoryCounts('fixture kitchen and supplies');await auditReachability(win,'cPanel-kitchen','fixture kitchen after supplies');
 await tab(win,'cTab-adventure','cPanel-adventure');await auditReachability(win,'cPanel-adventure','fixture adventure');
 await clickSimple(win,'cZone0');await clickSimple(win,'cRoute-gather');await clickSimple(win,'cTrips3');p=await clickAction(win,'cStart');assert.equal(p.leisure.run?.total,3);p=await clickAction(win,'cAssist');assert.ok(Math.abs(p.leisure.run!.due-(p.tick+170))<=1,`assist due/tick drift ${p.leisure.run!.due} vs ${p.tick+170}`);
 p=await workerAdvance(17_000,'first partial room settles');assert.equal(p.leisure.run?.room,1);await assertDisabled(win,'cStart',/伙伴正在冒险/,true);p=await clickAction(win,'cReturn');assert.equal(p.leisure.run,null);assert.ok(p.leisure.cargo.gel>0);await clickAction(win,'cQuickClaim');assert.equal(currentProfile().leisure.cargo.gel,0);
 await assertDisabled(win,'cRecruit-guide',/完成对应地点/);await clickSimple(win,'cRoute-treasure');await clickSimple(win,'cTrips1');p=await clickAction(win,'cStart');p=await workerAdvance(120_000,'first area clear');assert.equal(p.leisure.clears[0],1);await clickAction(win,'cClaim');
 await tab(win,'cTab-friends','cPanel-friends');await auditReachability(win,'cPanel-friends','fixture friends before recruit');p=await clickAction(win,'cRecruit-guide');assert.equal(p.leisure.companions.guide,0);p=await clickAction(win,'cEquip-guide');assert.equal(p.leisure.active,'guide');
 for(let i=0;i<14;i++)p=await clickAction(win,'cFeed-slime');assert.equal(p.leisure.companions.slime,14);await assertDisabled(win,'cFeed-slime',/Lv5/);
 await clickSimple(win,'cRoute-balanced');await tab(win,'cTab-adventure','cPanel-adventure');await clickSimple(win,'cZone1');p=await clickAction(win,'cStart');assert.equal(p.leisure.run?.zone,1);p=await workerAdvance(240_000,'second area clear');assert.equal(p.leisure.clears[1],1);await clickAction(win,'cQuickClaim');
 await tab(win,'cTab-friends','cPanel-friends');p=await clickAction(win,'cRecruit-guard');assert.equal(p.leisure.companions.guard,0);p=await clickAction(win,'cEquip-guard');assert.equal(p.leisure.active,'guard');for(let i=0;i<14;i++)p=await clickAction(win,'cFeed-guide');for(let i=0;i<14;i++)p=await clickAction(win,'cFeed-guard');assert.equal(p.leisure.companions.guide,14);assert.equal(p.leisure.companions.guard,14);await assertDisabled(win,'cFeed-guide',/Lv5/);await assertDisabled(win,'cFeed-guard',/Lv5/);
 p=await clickAction(win,'cSellAll-biscuit');assert.equal(p.leisure.materials.biscuit,0);await clickAction(win,'cEquip-slime');await clickAction(win,'cEquip-guide');await clickAction(win,'cEquip-guard');await capture(win,'fixture-friends-1040x760');
 await tab(win,'cTab-adventure','cPanel-adventure');await clickSimple(win,'cZone2');await clickSimple(win,'cRoute-treasure');p=await clickAction(win,'cStart');assert.equal(p.leisure.run?.zone,2);p=await clickAction(win,'cAssist');assert.ok(Math.abs(p.leisure.run!.due-(p.tick+p.leisure.run!.duration-30))<=1,`zone two assist due/tick drift ${p.leisure.run!.due} vs ${p.tick+p.leisure.run!.duration-30}`);
 p=await workerAdvance(15_000,'assist cooldown expires');p=await clickAction(win,'cAssist');assert.ok(Math.abs(p.leisure.run!.assistReady-(p.tick+150))<=1,`assist cooldown/tick drift ${p.leisure.run!.assistReady} vs ${p.tick+150}`);
 p=await workerAdvance(39_000,'first zone two encounter');assert.equal(p.leisure.run?.room,1);p=await workerAdvance(60_000,'treasure room appears');assert.equal(p.leisure.run?.room,2);const treasure=await js<{frame:string;encounter:string}>(win,"({frame:document.getElementById('cEnemySprite').dataset.frame,encounter:document.getElementById('cEncounter').textContent})");assert.deepEqual(treasure,{frame:'chest-closed',encounter:'藏宝间'});await capture(win,'fixture-zone2-treasure-room');
 p=await workerAdvance(240_000,'zone two boss and first clear');assert.equal(p.leisure.run,null);assert.equal(p.leisure.clears[2],1);await clickAction(win,'cClaim');
 await clickSimple(win,'cTrips3');p=await clickAction(win,'cStart');const threeTripMs=p.leisure.run!.duration*6*3*100;p=await workerAdvance(threeTripMs,'three fully automatic zone two trips');assert.equal(p.leisure.run,null);assert.equal(p.leisure.clears[2],4);assert.equal(p.leisure.rooms,37);await clickAction(win,'cClaim');
 await tab(win,'cTab-collection','cPanel-collection');await auditReachability(win,'cPanel-collection','fixture collection');for(const id of ['first-trip','green-fingers','camp-chef','good-friend','moon-path','star-path'])await clickAction(win,`cCollection-${id}`);for(const id of ['first-trip','green-fingers','camp-chef','good-friend','moon-path','star-path'])await assertDisabled(win,`cCollection-${id}`,/已领取/);await capture(win,'fixture-collection-1040x760');
 await resizeAndRecord(win,800,620,'collection-800x620');await auditReachability(win,'cPanel-collection','fixture collection at 800x620');await capture(win,'fixture-collection-800x620');
 await tab(win,'cTab-adventure','cPanel-adventure');await clickSimple(win,'cTrips3');p=await clickAction(win,'cStart');const minimizedRunMs=p.leisure.run!.duration*6*3*100;await clickWindowButton(win,'cMinimize','native minimize state');assert.equal(win.isVisible(),false);assert.equal(win.isFocused(),false);p=await workerAdvance(minimizedRunMs,'adventure continues while minimized');assert.equal(p.leisure.run,null);assert.equal(p.leisure.rooms,55);
 await clickWindowButton(win,'cClose','close minimized window');const reopened=await clickPortal();assert.equal(currentProfile().leisure.rooms,55);assert.equal(await js<boolean>(reopened,"document.getElementById('cQuickClaim').hidden"),false);p=await clickAction(reopened,'cQuickClaim');assert.equal(p.leisure.cargo.coins,0);
 const keys=await js<number>(reopened,'window.__casualKeyEvents');assert.equal(keys,0);await stableButtons(reopened);record('rich UI fixture exercised all requested leisure actions with no keyboard events','PASS',{keyEvents:keys,buttonCount:await js<number>(reopened,"document.querySelectorAll('#casualUi button[id]').length"),profile:{rooms:p.leisure.rooms,clears:p.leisure.clears,harvests:p.leisure.harvests,cooked:p.leisure.cooked,claimed:p.leisure.claimed,companions:p.leisure.companions},native:{isVisible:reopened.isVisible(),isFocused:reopened.isFocused(),isMinimized:reopened.isMinimized()}});
 await clickWindowButton(reopened,'cClose','fixture final close');await verifyInventoryCounts('fixture after final claim');await closeInventoryPanel('fixture final');
}
async function main():Promise<void>{
 try{
  fs.mkdirSync('/private/tmp',{recursive:true});profileRoot=fs.mkdtempSync('/private/tmp/pixelstreet-casual-052-luna-');markIsolatedFolder(profileRoot,app.getPath('appData'));assert.equal(assertIsolatedFolder(profileRoot,app.getPath('appData'),true),profileRoot);
  preflight=seedProfile(profileRoot,scenario,Date.now());if(scenario==='fresh'){assert.equal(preflight.job,'visitor');assert.equal(preflight.coins,20);assert.deepEqual(preflight.bag,{flour:0,ration:0,crystal:0,gel:0});}record('isolated profile validated before Electron startup','PASS',{profileRoot,profileFile:path.join(profileRoot,'solo/profile.json'),marker:path.join(profileRoot,'.pixelstreet-isolated-profile.json'),version:preflight.version,job:preflight.job,coins:preflight.coins,scenario});
  if(process.platform==='darwin'){app.setActivationPolicy('prohibited');app.dock?.hide();record('macOS activation policy and dock suppression','PASS',{policy:'prohibited',dockHidden:true});}
  replace(app,'focus',()=>{suppression.appFocus++;return false;});replace(Menu,'setApplicationMenu',()=>{});
  app.on('browser-window-created',(_event,win)=>patchWindow(win));app.on('web-contents-created',(_event:any,contents:any)=>contents.on('console-message',(event:any)=>{if(event.level==='error')errors.push(String(event.message).slice(0,500));}));
  shell=await startDesktop(profileRoot,true);overlay=shell.overlay;await until(()=>js<boolean>(overlay!,'document.body.dataset.atlas==="verified"&&!!document.getElementById("dungeonSign")'),'hidden native overlay and verified art');
  await until(()=>shell!.game.state.status==='ready'&&shell!.game.state.profile?.version===8,'isolated v8 game worker');assert.equal(overlay.isVisible(),false);assert.equal(overlay.isFocused(),false);record('Electron shell and v8 game worker loaded hidden','PASS',{overlay:{isVisible:overlay.isVisible(),isFocused:overlay.isFocused()},profile:{version:currentProfile().version,job:currentProfile().job,coins:currentProfile().coins},workerStatus:shell.game.state.status});
  if(scenario==='fresh')await freshScenario();else await fixtureScenario();
  assert.equal(suppression.globalShortcut,0,'no global shortcut registration requests');assert.equal(errors.length,0,`renderer console errors: ${errors.join('; ')}`);
  for(const w of nativeSnapshot())assert.equal(w.isVisible,false,`native window became visible: ${JSON.stringify(w)}`);
  status='PASS';record('hidden native acceptance completed','PASS',{suppression,nativeWindows:nativeSnapshot(),noGlobalShortcutRegistration:true,rendererConsoleErrors:errors.length,productHashesUnchanged:JSON.stringify(productHashesAtStart)===JSON.stringify(hashFiles())});
 }catch(e){status='FAIL';errors.push(String(e));writeProgress(e);console.error(e instanceof Error?e.stack:String(e));}
 finally{
  if(shell?.arenaWindow&&!shell.arenaWindow.isDestroyed())try{shell.closeArena();}catch{}
  writeProgress(status==='FAIL'?new Error(errors.at(-1)??'failure'):undefined);
  app.quit();
 }
}
void main();
