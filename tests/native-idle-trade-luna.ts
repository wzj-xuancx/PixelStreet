import { app, Menu, type BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { startDesktop } from '../apps/desktop/bootstrap';
import { GameStore } from '../apps/desktop/game-store';
import {
  advance, initialProfile, initialBusiness, makeOrder, parseProfile, transact,
  hasBusinessWork, type GameAction, type Profile,
} from '../packages/solo-core';
import { assertIsolatedFolder, markIsolatedFolder } from '../apps/desktop/launch-profile';
import { APP_NAME, APP_VERSION, PROFILE_NAME } from '../apps/desktop/identity';

type NativeRecord = { name:string; status:'PASS'|'FAIL'|'INFO'; detail?:unknown };
const records:NativeRecord[]=[];
const consoleErrors:string[]=[];
const suppression=(globalThis as any).__pixelStreetIdleTradeSuppression??{appFocus:0,show:0,showInactive:0,windowFocus:0,webContentsFocus:0,moveTop:0,globalShortcut:0,trayCreates:0};
const actualWindows=new Map<number,{page:string|null;visible:()=>boolean;focused:()=>boolean}>();
const root=path.resolve(__dirname,'..');
const evidenceDir=path.join(root,'docs/evidence/idle-trade');
const runId=new Date().toISOString().replace(/[:.]/g,'-')+'-'+process.pid;
const reportPath=path.join(evidenceDir,`luna-max-${runId}.json`);
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
let shell:Awaited<ReturnType<typeof startDesktop>>|undefined;
let overlay:BrowserWindow|undefined;
let popup:BrowserWindow|undefined;
let profileRoot='';
const profileRoots:string[]=[];
let popupGeneration=0;
function productFiles():string[]{
  const fixed=['apps/desktop/identity.ts','apps/desktop/game-store.ts','apps/desktop/game-worker.ts','apps/desktop/renderer/business-panel.ts','apps/desktop/renderer/solo-panels.ts','apps/desktop/renderer/shop.css','apps/desktop/renderer/game-button.ts','packages/solo-core/business.ts','packages/solo-core/catalog.ts','packages/solo-core/index.ts','package.json','package-lock.json','独立存档试玩.command','dist/main.cjs','dist/preload.cjs','dist/game-worker.cjs','dist/renderer/index.html'];
  const visit=(folder:string):string[]=>fs.existsSync(folder)?fs.readdirSync(folder,{withFileTypes:true}).flatMap(entry=>{const target=path.join(folder,entry.name);return entry.isDirectory()?visit(target):[target];}):[];
  return [...fixed,...visit(path.join(root,'dist/renderer')).map(file=>path.relative(root,file))].filter(file=>fs.existsSync(path.join(root,file))).sort();
}
function hashFiles():Record<string,string>{return Object.fromEntries(productFiles().map(file=>[file,createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')]));}
const productHashesAtStart=hashFiles();

function nativeSnapshots():Array<Record<string,unknown>>{
  return [...actualWindows].map(([id,w])=>{
    try{return{id,page:w.page,isVisible:w.visible(),isFocused:w.focused()};}
    catch(error){return{id,page:w.page,isVisible:null,isFocused:null,apiState:String(error)};}
  });
}
function writeProgress(status='RUNNING',error?:unknown):void{
  try{
    fs.mkdirSync(evidenceDir,{recursive:true});
    const report={schema:'pixelstreet.idle-trade-luna-max.v1',runId,status,at:new Date().toISOString(),app:{name:APP_NAME,version:APP_VERSION,profileName:PROFILE_NAME},platform:process.platform,arch:process.arch,electron:process.versions.electron,profileRoot,profileRoots,profileMarker:profileRoot?path.join(profileRoot,'.pixelstreet-isolated-profile.json'):null,profileFile:profileRoot?path.join(profileRoot,'solo/profile.json'):null,profilePreflight:'parseProfile(version=8) passed before Electron startup',records,consoleErrors,suppression,nativeWindows:nativeSnapshots(),productHashesAtStart,error:error?String(error):undefined,stack:error instanceof Error?error.stack:undefined};
    fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n',{mode:0o600});
  }catch{}
}
function record(name:string,status:'PASS'|'FAIL'|'INFO'='PASS',detail?:unknown):void{records.push({name,status,detail});writeProgress();}
function replace(target:any,key:string,value:unknown):void{
  const old=Object.getOwnPropertyDescriptor(target,key);
  if(old&&!old.configurable&&!old.writable)throw Error(`无法安全抑制 Electron.${key}`);
  Object.defineProperty(target,key,{configurable:true,enumerable:old?.enumerable??true,writable:true,value});
}
function page(win:BrowserWindow):string|null{try{return new URL(win.webContents.getURL()).searchParams.get('page');}catch{return null;}}
function patchWindow(win:BrowserWindow):void{
  const visible=win.isVisible.bind(win),focused=win.isFocused.bind(win),key=win.id;
  actualWindows.set(key,{page:page(win),visible,focused});
  replace(win,'show',()=>{suppression.show++;});
  replace(win,'showInactive',()=>{suppression.showInactive++;});
  replace(win,'focus',()=>{suppression.windowFocus++;});
  replace(win,'moveTop',()=>{suppression.moveTop++;});
  replace(win.webContents,'focus',()=>{suppression.webContentsFocus++;});
  win.webContents.on('console-message',(event:any)=>{if(event.level==='error')consoleErrors.push(String(event.message).slice(0,500));});
  win.webContents.on('did-finish-load',()=>{const e=actualWindows.get(key);if(e)e.page=page(win);});
}
async function until(fn:()=>Promise<boolean>|boolean,label:string,timeout=20000):Promise<void>{
  const end=Date.now()+timeout;
  while(Date.now()<end){if(await fn())return;await pause(40);}
  throw Error(`等待超时：${label}`);
}
async function js<T=any>(win:BrowserWindow,source:string):Promise<T>{return await win.webContents.executeJavaScript(source) as T;}
function getProfile():Profile{const p=shell?.game.state.profile;if(!p)throw Error(`单机存档未就绪：${shell?.game.state.error??'unknown'}`);return p;}
async function uiReady(label='经营面板空闲'):Promise<void>{
  await until(async()=>!!popup&&!popup.isDestroyed()&&await js(popup!,'document.body.dataset.popupReady==="true"&&document.body.dataset.popup==="shop"'),label);
  await until(async()=>await js(popup!,'document.getElementById("shopUi")?.dataset.businessBusy==="false"'),`${label}·无提交中操作`);
}
async function stableButtons():Promise<void>{
  const result=await js<{stable:boolean;ids:string[];missing:string[]}>(popup!,`(()=>{const refs=window.__idleTradeButtonRefs||{};const ids=Object.keys(refs);const missing=ids.filter(id=>document.getElementById(id)!==refs[id]);return{stable:missing.length===0,ids,missing}})()`);
  assert.equal(result.stable,true,`按钮DOM被重建：${result.missing.join(',')}`);
}
async function clickUi(id:string):Promise<Profile>{
  await uiReady();
  const before=getProfile().sequence;
  const state=await js<{exists:boolean;hidden:boolean;disabled:boolean;label:string;reachable:boolean}>(popup!,`(()=>{const e=document.getElementById(${JSON.stringify(id)}),content=document.querySelector('.popover-content');if(e)e.scrollIntoView({block:'nearest',inline:'nearest'});const r=e?.getBoundingClientRect(),v=content.getBoundingClientRect(),hit=r?document.elementFromPoint(r.left+r.width/2,r.top+r.height/2):null;return{exists:!!e,hidden:!e||e.hidden||!!e.closest('[hidden]'),disabled:!e||e.disabled,label:e?.getAttribute('aria-label')||e?.textContent||'',reachable:!!r&&r.width>0&&r.height>0&&r.bottom>v.top&&r.top<v.bottom&&r.right>v.left&&r.left<v.right&&!!hit?.closest('button')&&hit.closest('button')===e}})()`);
  assert.equal(state.exists,true,`找不到按钮 ${id}`);assert.equal(state.hidden,false,`按钮 ${id} 或其面板被隐藏`);assert.equal(state.reachable,true,`按钮 ${id} 无法滚动到popover视口`);assert.equal(state.disabled,false,`按钮 ${id} 被禁用：${state.label}`);
  await js(popup!,`document.getElementById(${JSON.stringify(id)}).click()`);
  await until(()=>getProfile().sequence===before+1,`${id}操作回执`);
  await uiReady(`${id}完成后经营面板空闲`);
  await stableButtons();
  record(`UI click ${id}`, 'PASS',{label:state.label,sequence:before+1,notice:getProfile().notice,scrollReachable:state.reachable,input:'software DOM click'});
  return getProfile();
}
async function localClick(id:string):Promise<void>{
  const result=await js<{exists:boolean;hidden:boolean;disabled:boolean;reachable:boolean}>(popup!,`(()=>{const e=document.getElementById(${JSON.stringify(id)}),content=document.querySelector('.popover-content');if(e)e.scrollIntoView({block:'nearest',inline:'nearest'});const r=e?.getBoundingClientRect(),v=content.getBoundingClientRect(),hit=r?document.elementFromPoint(r.left+r.width/2,r.top+r.height/2):null;return{exists:!!e,hidden:!e||e.hidden||!!e.closest('[hidden]'),disabled:!e||e.disabled,reachable:!!r&&r.width>0&&r.height>0&&r.bottom>v.top&&r.top<v.bottom&&r.right>v.left&&r.left<v.right&&!!hit?.closest('button')&&hit.closest('button')===e}})()`);
  assert.equal(result.exists,true,`找不到控件 ${id}`);assert.equal(result.hidden,false,`控件 ${id} 或其面板当前隐藏`);assert.equal(result.reachable,true,`控件 ${id} 无法滚动到popover视口`);assert.equal(result.disabled,false,`控件 ${id} 当前禁用`);
  await js(popup!,`document.getElementById(${JSON.stringify(id)}).click()`);
  await pause(20);
  await stableButtons();
}
async function batch(n:number):Promise<void>{
  const result=await js<{exists:boolean;hidden:boolean;disabled:boolean;reachable:boolean}>(popup!,`(()=>{const e=document.querySelector('[data-batch="${n}"]'),content=document.querySelector('.popover-content');if(e)e.scrollIntoView({block:'nearest',inline:'nearest'});const r=e?.getBoundingClientRect(),v=content.getBoundingClientRect(),hit=r?document.elementFromPoint(r.left+r.width/2,r.top+r.height/2):null;return{exists:!!e,hidden:!e||e.hidden||!!e.closest('[hidden]'),disabled:!e||e.disabled,reachable:!!r&&r.width>0&&r.height>0&&r.bottom>v.top&&r.top<v.bottom&&r.right>v.left&&r.left<v.right&&!!hit?.closest('button')&&hit.closest('button')===e}})()`);
  assert.equal(result.exists,true,`找不到批量选项 ${n}`);assert.equal(result.hidden,false,`批量选项 ${n} 或其面板当前隐藏`);assert.equal(result.reachable,true,`批量选项 ${n} 无法滚动到popover视口`);assert.equal(result.disabled,false,`批量选项 ${n} 当前禁用`);
  await js(popup!,`document.querySelector('[data-batch="${n}"]').click()`);await pause(20);await stableButtons();
  const selected=await js<string>(popup!,`document.querySelector('[data-batch="${n}"]').getAttribute('aria-pressed')`);assert.equal(selected,'true');
  record(`UI batch selector ${n}`,'PASS',{selected});
}
async function tab(id:string,panel:string):Promise<void>{
  await localClick(id);
  const state=await js<{selected:string|null;hidden:boolean}>(popup!,`({selected:document.getElementById(${JSON.stringify(id)}).getAttribute('aria-selected'),hidden:document.getElementById(${JSON.stringify(panel)}).hidden})`);
  assert.deepEqual(state,{selected:'true',hidden:false},`页签 ${id} 状态`);
  await pause(250);
  record(`UI tab ${id}`,'PASS',state);
}
async function auditButtonContract():Promise<void>{
  const buttons=await js<Array<{id:string;gameButton:boolean;tooltip:string;fontSize:number;cursor:string;disabled:boolean}>>(popup!,`Array.from(document.querySelectorAll('#shopUi button')).map(b=>({id:b.id||'batch-'+(b.dataset.batch||'unknown'),gameButton:b.classList.contains('game-button'),tooltip:(b.dataset.tooltip||'').trim(),fontSize:parseFloat(getComputedStyle(b).fontSize),cursor:getComputedStyle(b).cursor,disabled:b.disabled}))`);
  assert.ok(buttons.length>=50,`商店操作按钮数量异常：${buttons.length}`);
  const bad=buttons.filter(b=>!b.gameButton||!b.tooltip||b.fontSize<14||b.cursor!==(b.disabled?'not-allowed':'pointer'));
  assert.deepEqual(bad,[],'存在未统一高亮、提示、可读字号或指针状态的商店按钮');
  record('all business buttons use GameButton, tooltip, readable font and cursor','PASS',{count:buttons.length,fontRange:[Math.min(...buttons.map(b=>b.fontSize)),Math.max(...buttons.map(b=>b.fontSize))],enabledPointer:buttons.filter(b=>!b.disabled).length,disabledNotAllowed:buttons.filter(b=>b.disabled).length,ids:buttons.map(b=>b.id)});
}
async function auditPanelReachability(panelId:string,label:string):Promise<void>{
  const rows=await js<Array<{id:string;gameButton:boolean;tooltip:string;fontSize:number;cursor:string;disabled:boolean;reachable:boolean;rect:{width:number;height:number};scrollTop:number}>>(popup!,`(()=>{const content=document.querySelector('.popover-content'),panel=document.getElementById(${JSON.stringify(panelId)}),rows=[];for(const b of Array.from(panel.querySelectorAll('button[id],button[data-batch]'))){if(b.hidden||b.closest('[hidden]'))continue;b.scrollIntoView({block:'nearest',inline:'nearest'});const r=b.getBoundingClientRect(),v=content.getBoundingClientRect(),cs=getComputedStyle(b),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);rows.push({id:b.id||'batch-'+b.dataset.batch,gameButton:b.classList.contains('game-button'),tooltip:(b.dataset.tooltip||'').trim(),fontSize:parseFloat(cs.fontSize),cursor:cs.cursor,disabled:b.disabled,reachable:r.width>0&&r.height>0&&r.bottom>v.top&&r.top<v.bottom&&r.right>v.left&&r.left<v.right&&!!hit?.closest('button')&&hit.closest('button')===b,rect:{width:r.width,height:r.height},scrollTop:content.scrollTop});}content.scrollTop=0;return rows;})()`);
  assert.ok(rows.length>0,`${label}没有可见按钮`);
  const bad=rows.filter(b=>!b.gameButton||!b.tooltip||b.fontSize<14||b.cursor!==(b.disabled?'not-allowed':'pointer')||!b.reachable);
  assert.deepEqual(bad,[],`${label}存在样式或滚动可达性问题`);
  record(`UI ${label} buttons scroll into view`,'PASS',{count:rows.length,scrollRange:[Math.min(...rows.map(r=>r.scrollTop)),Math.max(...rows.map(r=>r.scrollTop))],ids:rows.map(r=>r.id),allReachable:true});
}
async function auditManagedRetailLayout(label:string):Promise<void>{
  const layout=await js<{texts:string[];tips:string[];fontSizes:number[];rects:Array<{left:number;right:number;top:number;bottom:number;width:number;height:number}>;operationRect:{left:number;right:number;top:number;bottom:number};overlap:boolean;timeBeforeGold:boolean;goldBeforeAction:boolean;allVisible:boolean;columnPercents:number[]}>(popup!,`(()=>{const content=document.querySelector('.popover-content');content.scrollTop=0;const viewport=content.getBoundingClientRect(),table=document.querySelector('.shop-table-manage'),metrics=Array.from(document.querySelectorAll('#shopRetailRow .shop-metric')),rects=metrics.map(e=>{const r=e.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}}),op=document.getElementById('retailToggle').getBoundingClientRect(),operationRect={left:op.left,right:op.right,top:op.top,bottom:op.bottom},cols=Array.from(table.querySelectorAll('colgroup col')),tableWidth=table.getBoundingClientRect().width,columnPercents=cols.map(c=>Math.round(c.getBoundingClientRect().width*100/tableWidth)),a=rects[0],b=rects[1];return{texts:metrics.map(e=>e.querySelector('strong')?.textContent?.trim()||''),tips:metrics.map(e=>e.dataset.tooltip||''),fontSizes:metrics.map(e=>parseFloat(getComputedStyle(e.querySelector('strong')).fontSize)),rects,operationRect,overlap:!!a&&!!b&&a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top,timeBeforeGold:!!a&&!!b&&a.right<=b.left,goldBeforeAction:!!b&&b.right<=operationRect.left,allVisible:rects.every(r=>r.height>0&&r.top>=viewport.top&&r.bottom<=viewport.bottom)&&operationRect.top>=viewport.top&&operationRect.bottom<=viewport.bottom,columnPercents}})()`);
  assert.deepEqual(layout.texts,['18–60秒','看定价'],`${label}表格指标内容`);assert.deepEqual(layout.columnPercents,[20,22,22,18,18],`${label}经营表列宽`);assert.equal(layout.overlap,false,`${label}时间与金币指标发生矩形重叠`);assert.equal(layout.timeBeforeGold,true,`${label}时间指标右侧没有留在金币指标左侧`);assert.equal(layout.goldBeforeAction,true,`${label}金币指标与操作按钮重叠`);assert.equal(layout.allVisible,true,`${label}指标行未滚动到可见视口`);assert.deepEqual(layout.fontSizes,[18,18],`${label}指标字号`);assert.match(layout.tips[0],/每18、30或60秒成交一份/);assert.match(layout.tips[1],/当前定价/);assert.match(layout.tips[1],/存入钱箱/);
  record(`${label} managed retail metrics do not overlap`, 'PASS',layout);
}
async function pointerPressContract(id:string):Promise<void>{
  const state=await js<{down:boolean;up:boolean}>(popup!,`(()=>{const b=document.getElementById(${JSON.stringify(id)});b.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'mouse',button:0,isPrimary:true}));const down=b.classList.contains('is-pressed');b.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerType:'mouse',button:0,isPrimary:true}));return{down,up:!b.classList.contains('is-pressed')}})()`);
  assert.deepEqual(state,{down:true,up:true});record(`synthetic pointerdown/up press state ${id}`,'PASS',{...state,input:'software DOM PointerEvent; not physical evidence'});
}
async function captureHiddenScreenshot(label:string):Promise<void>{
  try{
    await pause(250);
    const image=await popup!.webContents.capturePage(),size=image.getSize(),png=image.toPNG(),bitmap=image.toBitmap();
    const stride=Math.max(4,Math.floor(bitmap.length/600/4)*4),colors=new Set<string>();
    for(let i=0;i+3<bitmap.length;i+=stride)colors.add(`${bitmap[i]},${bitmap[i+1]},${bitmap[i+2]},${bitmap[i+3]}`);
    const file=path.join(evidenceDir,`luna-max-${runId}-${label}.png`);fs.writeFileSync(file,png,{mode:0o600});
    const detail={file,width:size.width,height:size.height,pngBytes:png.length,sampledColors:colors.size,nativeVisible:popup!.isVisible(),nativeFocused:popup!.isFocused(),pixelEvidence:png.length>1000&&size.width>=400&&size.height>=300&&colors.size>8?'valid':'insufficient pixels'};
    record(`hidden rendered page PNG ${label}`,detail.pixelEvidence==='valid'?'PASS':'INFO',detail);
  }catch(error){record(`hidden rendered page PNG ${label}`,'INFO',{error:String(error),evidence:'capturePage unavailable; no visible window was opened'});}
}
async function workerAdvance(ms:number,label:string):Promise<Profile>{
  const before=getProfile().tick;
  const next=await shell!.game.request('advance',{ms});
  const p=next.profile!;
  await until(()=>getProfile().tick>=before+Math.floor(ms/100)-2,`${label} worker推进`);
  await uiReady(`${label}后UI更新`);
  await stableButtons();
  record(`worker clock ${label}`,'PASS',{requestedMs:ms,beforeTick:before,afterTick:getProfile().tick,storedWallAt:getProfile().wallAt});
  return p;
}
function fixtureProfile(now:number,job:Profile['job']='keeper',gel=90):Profile{
  const p=initialProfile(now);p.job=job;p.coins=100_000;
  // Match reachable storage: gel is capped at 100 and the UI buy action adds five.
  // High flour/finished stock lets the test exercise large non-gel ration batches.
  p.bag={flour:100_000,ration:100_000,crystal:100_000,gel};
  p.business=initialBusiness(0x51a7e);p.business.completed=20;p.business.reputation=20;
  p.business.orders=[7,7,6].map((revision,slot)=>makeOrder(p.business.seed,slot,revision));
  return parseProfile(p);
}
function saveProfile(folder:string,p:Profile):string{
  const file=path.join(folder,'solo/profile.json');fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  fs.writeFileSync(file,JSON.stringify(parseProfile(p))+'\n',{mode:0o600,flag:'wx'});return file;
}
function oldProfile(version:1|2|3|4,now:number):Record<string,unknown>{
  const p=initialProfile(now) as unknown as Record<string,unknown>;delete p.business;
  if(version<=3)delete p.rewardRemainders;
  if(version<=2)delete p.roomClaims;
  if(version===1){delete p.xp;delete p.actionClaim;}
  p.version=version;return p;
}
function pureCoreAudit():void{
  const now=1_800_000_000_000;
  for(const version of [1,2,3,4] as const){const migrated=parseProfile(oldProfile(version,now));assert.equal(migrated.version,8);assert.equal(migrated.business.seed,migrated.rng);record(`core migration v${version}→v8`,'PASS',{business:migrated.business.orders.length,seed:migrated.business.seed});}
  const seed=fixtureProfile(now);for(let i=0;i<3;i++)assert.deepEqual(makeOrder(seed.business.seed,i,4),makeOrder(seed.business.seed,i,4));
  const migrationRoot=fs.mkdtempSync(path.join('/private/tmp',`pixelstreet-idle-migration-${runId}-`));
  markIsolatedFolder(migrationRoot,app.getPath('appData'));
  for(const version of [1,2,3,4] as const){
    const folder=path.join(migrationRoot,`v${version}`);fs.mkdirSync(folder,{recursive:true,mode:0o700});
    const original=JSON.stringify(oldProfile(version,now))+'\n';const file=path.join(folder,'profile.json');fs.writeFileSync(file,original,{mode:0o600,flag:'wx'});
    const stored=new GameStore(folder,now);assert.equal(stored.value.version,8);assert.equal(fs.readFileSync(file,'utf8'),original);
    const preserved=path.join(folder,`profile.v${version}-before-migration.json`);assert.equal(fs.readFileSync(preserved,'utf8'),original);
    stored.save(stored.value);assert.equal(parseProfile(JSON.parse(fs.readFileSync(file,'utf8'))).version,8);assert.equal(fs.readFileSync(preserved,'utf8'),original);
  }
  record('v1–v4 GameStore migration preserves exact source bytes','PASS',{migrationRoot,versions:[1,2,3,4],mainFilesRewrittenToV8:true,preservedCopiesExact:true});
  const action:GameAction={type:'trade',item:'flour',side:'buy',count:10},env={sequence:1,requestId:'idle-trade-luna-0001',action};
  const bought=transact(seed,env);assert.equal(bought.coins,seed.coins-10);assert.equal(bought.bag.flour,seed.bag.flour+10);assert.deepEqual(transact(bought,env),bought);
  const before=structuredClone(bought);assert.throws(()=>transact(bought,{...env,action:{type:'trade',item:'flour',side:'sell',count:10}}),/过期/);assert.deepEqual(bought,before);
  record('core transaction replay and stale-intent rejection','PASS',{firstSequence:bought.sequence,replaySequence:transact(bought,env).sequence});
  const surplusLegacy=oldProfile(4,now) as any;surplusLegacy.job='keeper';surplusLegacy.bag.flour=10;surplusLegacy.bag.gel=101;
  const migratedSurplus=parseProfile(surplusLegacy);const legacyQueue=transact(migratedSurplus,{sequence:1,requestId:'idle-trade-luna-0006',action:{type:'queue-craft',recipe:'ration',count:1}});
  const legacyRefund=transact(legacyQueue,{sequence:2,requestId:'idle-trade-luna-0007',action:{type:'cancel-craft',position:0}});
  assert.equal(legacyRefund.bag.flour,10);assert.equal(legacyRefund.bag.gel,101);assert.equal(legacyRefund.queue,null);
  record('legacy v4 surplus gel migration and zero-gel ration refund','PASS',{version:migratedSurplus.version,gelBefore:101,gelAfter:legacyRefund.bag.gel,flourRestored:legacyRefund.bag.flour});
  let idleLoop=initialProfile(now);idleLoop.job='keeper';idleLoop.coins=10_000;idleLoop.bag.flour=90;idleLoop.business=initialBusiness(0x15f1f);
  let idleActionSequence=0;
  const applyIdleAction=(action:GameAction):void=>{idleActionSequence++;idleLoop=transact(idleLoop,{sequence:idleLoop.sequence+1,requestId:`idle-trade-luna-${String(40+idleActionSequence).padStart(4,'0')}`,action});};
  applyIdleAction({type:'trade',item:'gel',side:'buy',count:50});applyIdleAction({type:'trade',item:'gel',side:'buy',count:50});
  for(let batch=1;batch<=3;batch++){
    applyIdleAction({type:'queue-craft',recipe:'crystal',count:30});
    assert.equal(idleLoop.bag.gel,100-batch*60+(batch-1)*50,'100凝胶容量内分批补货后材料余额守恒');
    idleLoop=advance(idleLoop,now+batch*300_000);
    assert.equal(idleLoop.bag.crystal,batch*30);assert.equal(idleLoop.queue,null);
    if(batch<3)applyIdleAction({type:'trade',item:'gel',side:'buy',count:50});
  }
  assert.equal(idleLoop.bag.gel,20);assert.equal(idleLoop.bag.flour,0);assert.equal(idleLoop.coins,9_000);assert.equal(idleLoop.totals.crafted,90);
  record('three 30-crystal-meal batches fit the 100-gel bag with staged 50-gel purchases','PASS',{batches:3,meals:idleLoop.totals.crafted,gelPurchased:200,gelConsumed:180,gelRemaining:idleLoop.bag.gel,flourConsumed:90,elapsedMinutes:15,coinsSpent:1_000});
  let p=fixtureProfile(now);p.business.upgrades.oven=1;p.bag.flour=100;p.bag.gel=100;p.bag.ration=0;
  const startFlour=p.bag.flour;const q=transact(p,{sequence:1,requestId:'idle-trade-luna-0002',action:{type:'queue-craft',recipe:'ration',count:10}});
  assert.equal(q.bag.flour,startFlour-20);p=advance(q,now+6000);assert.equal(p.bag.ration,1);assert.equal(p.queue?.remaining,9);
  const cancelled=transact(p,{sequence:p.sequence+1,requestId:'idle-trade-luna-0003',action:{type:'cancel-craft',position:0}});
  assert.equal(cancelled.bag.ration,1);assert.equal(cancelled.bag.flour,startFlour-2);assert.equal(cancelled.queue,null);
  record('core per-item crafting and remaining-material refund','PASS',{crafted:cancelled.bag.ration,flourAfterRefund:cancelled.bag.flour});
  let capped=fixtureProfile(now);capped.retail=true;capped.business.managed=true;capped.business.shelves.ration={stock:20,tier:'quick',due:0};
  const one=advance(capped,now+24*3600_000);assert.equal(one.tick,8*3600*10);const same=advance(one,now+24*3600_000);assert.deepEqual(same,one);
  const splitBase=fixtureProfile(now);splitBase.retail=true;splitBase.business.managed=true;splitBase.business.shelves.ration={stock:20,tier:'quick',due:0};
  const split=advance(advance(splitBase,now+4*3600_000),now+8*3600_000);assert.deepEqual(split,advance(splitBase,now+8*3600_000));
  assert.deepEqual(advance(one,now-1000),one);
  record('core offline cap, rollback, and 4h+4h equivalence','PASS',{capTicks:one.tick,sold:one.totals.sold,till:one.business.till,rollbackNoChange:true,segmentedEqual:true});
  let fullTill=fixtureProfile(now);fullTill.retail=true;fullTill.business.managed=true;fullTill.business.till=1e9-1;fullTill.business.shelves.ration={stock:1,tier:'normal',due:1};
  const tillCapped=advance(fullTill,now+200);assert.equal(tillCapped.business.shelves.ration.stock,1);assert.equal(tillCapped.business.till,1e9-1);assert.equal(hasBusinessWork(tillCapped),false);
  record('core till cap stops sales before consuming shelf stock','PASS',{stock:tillCapped.business.shelves.ration.stock,till:tillCapped.business.till,scheduledWork:hasBusinessWork(tillCapped)});
  let refund=transact(fixtureProfile(now),{sequence:1,requestId:'idle-trade-luna-0004',action:{type:'queue-craft',recipe:'ration',count:1}});refund.bag.flour=999_999;const refundBefore=structuredClone(refund);
  assert.throws(()=>transact(refund,{sequence:2,requestId:'idle-trade-luna-0005',action:{type:'cancel-craft',position:0}}),/材料空间不足/);assert.deepEqual(refund,refundBefore);
  record('core full-inventory cancellation refusal preserves batch and materials','PASS',{queue:refund.queue,flour:refund.bag.flour,unchanged:true});
}
async function runNative():Promise<void>{
  fs.mkdirSync(evidenceDir,{recursive:true});
  pureCoreAudit();
  const base='/private/tmp';fs.mkdirSync(base,{recursive:true});profileRoot=path.join(base,`pixelstreet-idle-trade-luna-${runId}`);fs.mkdirSync(profileRoot,{mode:0o700});profileRoots.push(profileRoot);
  markIsolatedFolder(profileRoot,app.getPath('appData'));assert.equal(assertIsolatedFolder(profileRoot,app.getPath('appData'),true),profileRoot);
  const seeded=fixtureProfile(Date.now(),'visitor',40);const preflight=parseProfile(seeded);assert.equal(preflight.version,8);const profileFile=saveProfile(profileRoot,preflight);
  record('isolated profile preflight','PASS',{profileRoot,profileFile,version:preflight.version,job:preflight.job,sequence:preflight.sequence,marker:'.pixelstreet-isolated-profile.json'});
  if(process.platform==='darwin'){
    try{app.setActivationPolicy('prohibited');}catch(error){record('activation policy','FAIL',{error:String(error)});throw error;}
    try{app.dock?.hide();}catch(error){record('dock hide','FAIL',{error:String(error)});throw error;}
  }
  replace(app,'focus',()=>{suppression.appFocus++;});
  replace(Menu,'setApplicationMenu',()=>{});
  app.on('browser-window-created',(_event:any,win:BrowserWindow)=>patchWindow(win));
  app.on('web-contents-created',(_event:any,contents:any)=>contents.on('console-message',(event:any)=>{if(event.level==='error')consoleErrors.push(String(event.message).slice(0,500));}));
  shell=await startDesktop(profileRoot,true);overlay=shell.overlay;
  await until(async()=>await js(overlay!,"document.body.dataset.atlas==='verified'&&!!document.getElementById('portalSign')"),'隐藏原生营地渲染');
  await until(()=>shell!.game.state.status==='ready'&&shell!.game.state.profile?.version===8,'隐藏原生单机存档');
  if(overlay.isVisible())throw Error('营地窗口违反隐藏验收约束。');
  record('actual Electron hidden camp and v8 profile loaded','PASS',{version:shell.game.state.profile?.version,job:shell.game.state.profile?.job,profileRoot,nativeVisible:overlay.isVisible(),nativeFocused:overlay.isFocused(),atlas:await js(overlay,'document.body.dataset.atlas')});
  await js(overlay!,"window.street.command({type:'visit',shop:'shop-bakery'})");
  await js(overlay!,"window.street.command({type:'shop-panel',anchor:{x:12,y:12,width:36,height:36}})");
  await until(()=>!!shell!.popupWindow&&shell!.popup?.kind==='shop','商店弹层');popup=shell.popupWindow!;popupGeneration=shell.popup!.generation;await uiReady();
  if(popup.isVisible())throw Error('商店窗口违反隐藏验收约束。');
  await js(popup,`window.__idleTradeButtonRefs=Object.fromEntries(Array.from(document.querySelectorAll('button[id]')).map(e=>[e.id,e]));`);
  const firstButtonCount=await js<number>(popup,'Object.keys(window.__idleTradeButtonRefs).length');
  record('actual Electron business panel loaded hidden','PASS',{generation:popupGeneration,buttonCount:firstButtonCount,nativeVisible:popup.isVisible(),nativeFocused:popup.isFocused(),tabCount:await js(popup,"document.querySelectorAll('[role=tab]').length"),defaultBatchFont:await js(popup,"getComputedStyle(document.querySelector('[data-batch]')).fontSize")});
  await auditButtonContract();
  const beforeTrial=getProfile().bag.ration,coinsBeforeHire=getProfile().coins,flourBeforeHire=getProfile().bag.flour;
  await clickUi('applyJob');assert.equal(getProfile().job,'apprentice');assert.equal(getProfile().bag.flour,flourBeforeHire+4);
  await clickUi('trialCraft');assert.equal(getProfile().queue?.recipe,'ration');await workerAdvance(7000,'完成学徒试餐');assert.equal(getProfile().bag.ration,beforeTrial+1);assert.equal(getProfile().queue,null);
  await clickUi('deliverTrial');assert.equal(getProfile().job,'keeper');assert.equal(getProfile().bag.ration,beforeTrial);assert.equal(getProfile().coins,coinsBeforeHire+30);
  record('job application, trial craft and delivery unlock business','PASS',{job:getProfile().job,flourGranted:4,trialOutputObserved:true,reward:30});

  await tab('shopTabSupply','shopPanelSupply');
  await auditPanelReachability('shopPanelSupply','采购面板');await captureHiddenScreenshot('supply');
  const gelTradeLabels=await js<{buy:string;sell:string}>(popup!,"({buy:document.getElementById('merchantBuy-gel').textContent.trim(),sell:document.getElementById('merchantSell-gel').textContent.trim()})");
  assert.deepEqual(gelTradeLabels,{buy:'买5份',sell:'卖5份'});record('gel trade purchase/sale quantities shown in UI','PASS',gelTradeLabels);
  await pointerPressContract('buyFlour');
  let beforeCoins=getProfile().coins,beforeFlour=getProfile().bag.flour;await clickUi('buyFlour');assert.equal(getProfile().coins,beforeCoins-10);assert.equal(getProfile().bag.flour,beforeFlour+10);
  beforeCoins=getProfile().coins;beforeFlour=getProfile().bag.flour;await clickUi('merchantBulk-flour');assert.equal(getProfile().coins,beforeCoins-50);assert.equal(getProfile().bag.flour,beforeFlour+50);
  beforeCoins=getProfile().coins;let beforeGel=getProfile().bag.gel;await clickUi('merchantBuy-gel');assert.equal(getProfile().coins,beforeCoins-25);assert.equal(getProfile().bag.gel,beforeGel+5);
  const gelBulkLabel=await js<string>(popup!,"document.getElementById('merchantBulk-gel').textContent.trim()");assert.equal(gelBulkLabel,'采购50份 · 250金币');await clickUi('merchantBulk-gel');assert.equal(getProfile().coins,beforeCoins-275);assert.equal(getProfile().bag.gel,beforeGel+55);
  const cappedBulk=await js<{disabled:boolean;tip:string}>(popup!,"({disabled:document.getElementById('merchantBulk-gel').disabled,tip:document.getElementById('merchantBulk-gel').dataset.tooltip})");assert.equal(cappedBulk.disabled,true);assert.match(cappedBulk.tip,/背包空间不足/);record('bulk gel purchase respects the 100-item bag cap','PASS',{bagGel:getProfile().bag.gel,buttonDisabled:cappedBulk.disabled,tooltip:cappedBulk.tip,label:gelBulkLabel});
  beforeCoins=getProfile().coins;beforeFlour=getProfile().bag.flour;await clickUi('merchantSell-flour');assert.equal(getProfile().coins,beforeCoins+3);assert.equal(getProfile().bag.flour,beforeFlour-5);
  beforeCoins=getProfile().coins;beforeGel=getProfile().bag.gel;await clickUi('merchantSell-gel');assert.equal(getProfile().coins,beforeCoins+10);assert.equal(getProfile().bag.gel,beforeGel-5);
  beforeCoins=getProfile().coins;let beforeRation=getProfile().bag.ration;await clickUi('merchantSell-ration');assert.equal(getProfile().coins,beforeCoins+4);assert.equal(getProfile().bag.ration,beforeRation-1);
  beforeCoins=getProfile().coins;let beforeCrystal=getProfile().bag.crystal;await clickUi('merchantSell-crystal');assert.equal(getProfile().coins,beforeCoins+10);assert.equal(getProfile().bag.crystal,beforeCrystal-1);

  await tab('shopTabOrders','shopPanelOrders');
  await auditPanelReachability('shopPanelOrders','订单面板');await captureHiddenScreenshot('orders');
  const initialOrder0={...getProfile().business.orders[0]},initialOrderItemCount=getProfile().bag[initialOrder0.recipe],initialOrderCoins=getProfile().coins;
  await clickUi('acceptOrder-0');assert.equal(getProfile().business.orders[0].accepted,true);await clickUi('cancelOrder-0');assert.equal(getProfile().business.orders[0].accepted,false);assert.equal(getProfile().bag[initialOrder0.recipe],initialOrderItemCount);
  await clickUi('acceptOrder-0');await clickUi('deliverOrder-0');assert.equal(getProfile().business.orders[0].revision,8);assert.equal(getProfile().bag[initialOrder0.recipe],initialOrderItemCount-initialOrder0.count);assert.equal(getProfile().coins,initialOrderCoins+Math.ceil((initialOrder0.recipe==='ration'?5:14)*initialOrder0.count*1.25));
  await clickUi('acceptOrder-1');const noDeadlineRevision=getProfile().business.orders[1].revision;await workerAdvance(15*60_000,'接单后等待15分钟');assert.equal(getProfile().business.orders[1].accepted,true);assert.equal(getProfile().business.orders[1].revision,noDeadlineRevision);await clickUi('cancelOrder-1');await clickUi('acceptOrder-1');await clickUi('deliverOrder-1');
  await clickUi('acceptOrder-2');await clickUi('cancelOrder-2');await clickUi('acceptOrder-2');await clickUi('deliverOrder-2');
  record('orders: three slots accept, cancel and deliver; no time penalty','PASS',{completed:getProfile().business.completed,reputation:getProfile().business.reputation,revisions:getProfile().business.orders.map(o=>o.revision)});

  await tab('shopTabCraft','shopPanelCraft');
  await auditPanelReachability('shopPanelCraft','制作面板');await captureHiddenScreenshot('craft');
  let legacyRationBefore=getProfile().bag.ration;await clickUi('craftRation');assert.equal(getProfile().queue?.remaining,1);await workerAdvance(7000,'旧接口制作单份口粮');assert.equal(getProfile().bag.ration,legacyRationBefore+1);
  legacyRationBefore=getProfile().bag.ration;await clickUi('craftRations');assert.equal(getProfile().queue?.remaining,3);await workerAdvance(19_000,'旧接口制作三份口粮');assert.equal(getProfile().bag.ration,legacyRationBefore+3);
  let legacyCrystalBefore=getProfile().bag.crystal;await clickUi('craftCrystal');assert.equal(getProfile().queue?.remaining,1);await workerAdvance(11_000,'旧接口制作单份魔晶餐');assert.equal(getProfile().bag.crystal,legacyCrystalBefore+1);
  legacyCrystalBefore=getProfile().bag.crystal;await clickUi('craftCrystals');assert.equal(getProfile().queue?.remaining,3);await workerAdvance(31_000,'旧接口制作三份魔晶餐');assert.equal(getProfile().bag.crystal,legacyCrystalBefore+3);
  record('legacy single and triple recipe buttons remain usable','PASS',{rationCounts:[1,3],crystalCounts:[1,3],queueCleared:getProfile().queue===null});
  for(const n of [1,10,30])await batch(n);
  await batch(30);const materialStart=getProfile().bag.flour;await clickUi('queueRation');assert.equal(getProfile().queue?.remaining,30);await clickUi('cancelProduction-0');assert.equal(getProfile().bag.flour,materialStart);
  await batch(10);const partialFlour=getProfile().bag.flour,partialRation=getProfile().bag.ration;
  await clickUi('queueRation');assert.equal(getProfile().queue?.remaining,10);await workerAdvance(7000,'完成第一份口粮');assert.equal(getProfile().bag.ration,partialRation+1);assert.equal(getProfile().queue?.remaining,9);await clickUi('cancelProduction-0');assert.equal(getProfile().bag.flour,partialFlour-2);assert.equal(getProfile().bag.ration,partialRation+1);
  await batch(1);await clickUi('queueCrystal');assert.equal(getProfile().queue?.recipe,'crystal');await clickUi('cancelProduction-0');
  record('UI batch production and partial refund','PASS',{singleCrafted:getProfile().bag.ration-partialRation,flourAfterNineRefund:getProfile().bag.flour-partialFlour});

  await tab('shopTabManage','shopPanelManage');
  await auditPanelReachability('shopPanelManage','经营面板');await captureHiddenScreenshot('manage');
  const legacyRetailInfo=await js<{buttonTip:string;metrics:Array<{text:string;tip:string}>}>(popup!,`(()=>{const row=document.getElementById('shopRetailRow'),m=Array.from(row.querySelectorAll('.shop-metric'));return{buttonTip:document.getElementById('retailToggle').dataset.tooltip,metrics:m.map(e=>({text:e.textContent.trim(),tip:e.dataset.tooltip||''}))}})()`);
  assert.match(legacyRetailInfo.metrics[0].tip,/每6秒/);assert.match(legacyRetailInfo.metrics[1].tip,/5金币/);
  record('legacy retail table tooltips describe legacy auto-sale mode','PASS',legacyRetailInfo);
  const gearBefore={coins:getProfile().coins,gel:getProfile().bag.gel};await clickUi('upgradeGear');assert.equal(getProfile().upgraded,true);assert.equal(getProfile().coins,gearBefore.coins-20);assert.equal(getProfile().bag.gel,gearBefore.gel-5);
  const gearDisabled=await js<{disabled:boolean;tip:string}>(popup!,"({disabled:document.getElementById('upgradeGear').disabled,tip:document.getElementById('upgradeGear').dataset.tooltip})");assert.equal(gearDisabled.disabled,true);assert.match(gearDisabled.tip,/本轮已强化/);
  record('legacy one-time expedition gear action remains gated after use','PASS',{coinsDelta:-20,gelDelta:-5,buttonDisabled:gearDisabled.disabled,tooltip:gearDisabled.tip});
  const legacyCoins=getProfile().coins,legacyCrystal=getProfile().bag.crystal,legacySales=getProfile().totals.sold;
  await clickUi('retailToggle');assert.equal(getProfile().retail,true);assert.equal(getProfile().business.managed,false);
  await workerAdvance(7000,'旧自动售卖模式6秒');assert.equal(getProfile().bag.crystal,legacyCrystal-1);assert.equal(getProfile().coins,legacyCoins+14);assert.equal(getProfile().business.till,0);
  await clickUi('retailToggle');assert.equal(getProfile().totals.sold,legacySales+1);assert.equal(getProfile().business.managed,false);
  record('legacy auto-sale profile keeps direct-wallet rule before first stocking','PASS',{coinsDelta:14,bagCrystalDelta:-1,till:0,managed:false});
  for(const recipe of ['ration','crystal'] as const)for(const tier of ['quick','normal','premium'] as const)await clickUi(`price-${recipe}-${tier}`);
  await clickUi('price-ration-quick');await clickUi('stock-ration');assert.equal(getProfile().business.managed,true);
  const managedRetailInfo=await js<{buttonTip:string;metrics:Array<{text:string;tip:string}>}>(popup!,`(()=>{const row=document.getElementById('shopRetailRow'),m=Array.from(row.querySelectorAll('.shop-metric'));return{buttonTip:document.getElementById('retailToggle').dataset.tooltip,metrics:m.map(e=>({text:e.textContent.trim(),tip:e.dataset.tooltip||''}))}})()`);
  assert.match(managedRetailInfo.buttonTip,/只出售货架商品/);assert.match(managedRetailInfo.metrics[0].tip,/18、30或60秒/);assert.match(managedRetailInfo.metrics[1].tip,/定价/);assert.match(managedRetailInfo.metrics[1].tip,/存入钱箱/);
  record('legacy retail table tooltips follow managed shelf mode','PASS',managedRetailInfo);await auditManagedRetailLayout('managed retail table');await js(popup!,"document.querySelector('.popover-content').scrollTop=0");await captureHiddenScreenshot('manage-shelf');await captureHiddenScreenshot('manage-table-final');
  await clickUi('stockAll-ration');assert.equal(getProfile().business.shelves.ration.stock,20);await clickUi('unstock-ration');assert.equal(getProfile().business.shelves.ration.stock,0);
  await clickUi('price-crystal-premium');await clickUi('stock-crystal');await clickUi('stockAll-crystal');assert.equal(getProfile().business.shelves.crystal.stock,20);await clickUi('unstock-crystal');assert.equal(getProfile().business.shelves.crystal.stock,0);
  await clickUi('price-ration-quick');await clickUi('stock-ration');const firstSaleDue=getProfile().business.shelves.ration.due;
  await clickUi('retailToggle');assert.equal(getProfile().retail,true);assert.equal(getProfile().business.managed,true);
  let remainingTicks=firstSaleDue-getProfile().tick;await workerAdvance(Math.max(100,(remainingTicks-20)*100),'快速价到期前');assert.equal(getProfile().business.till,0);assert.equal(getProfile().business.shelves.ration.stock,5);
  remainingTicks=getProfile().business.shelves.ration.due-getProfile().tick;await workerAdvance(Math.max(100,(remainingTicks+5)*100),'快速价首笔成交');assert.equal(getProfile().business.till,4);assert.equal(getProfile().business.shelves.ration.stock,4);
  await clickUi('retailToggle');const closed={stock:getProfile().business.shelves.ration.stock,till:getProfile().business.till};await workerAdvance(10*60_000,'关店10分钟');assert.deepEqual({stock:getProfile().business.shelves.ration.stock,till:getProfile().business.till},closed);
  const coinsBeforeCollect=getProfile().coins;await clickUi('collectTill');assert.equal(getProfile().business.till,0);assert.equal(getProfile().coins,coinsBeforeCollect+4);const quickCollected=getProfile().coins-coinsBeforeCollect;
  const collectDisabled=await js<{disabled:boolean;reason:string}>(popup!,"({disabled:document.getElementById('collectTill').disabled,reason:document.getElementById('collectTill').dataset.tooltip})");assert.equal(collectDisabled.disabled,true);
  await clickUi('retailToggle');await clickUi('price-ration-premium');const changedPriceDue=getProfile().business.shelves.ration.due;remainingTicks=changedPriceDue-getProfile().tick;
  await workerAdvance(Math.max(100,(remainingTicks-20)*100),'改价后完整等待期未到');assert.equal(getProfile().business.till,0);assert.equal(getProfile().business.shelves.ration.stock,4);
  remainingTicks=getProfile().business.shelves.ration.due-getProfile().tick;await workerAdvance(Math.max(100,(remainingTicks+5)*100),'改价后高价口粮成交');assert.equal(getProfile().business.till,7);assert.equal(getProfile().business.shelves.ration.stock,3);
  await clickUi('retailToggle');const rationPremiumCoins=getProfile().coins;await clickUi('collectTill');assert.equal(getProfile().coins,rationPremiumCoins+7);
  await clickUi('unstock-ration');
  await clickUi('price-crystal-premium');await clickUi('stock-crystal');await clickUi('retailToggle');await workerAdvance(61_000,'高价晶餐成交');assert.equal(getProfile().business.till,19);await clickUi('collectTill');assert.equal(getProfile().business.till,0);
  await clickUi('retailToggle');
  record('shelves, three prices, price-reset timer, open/close, till and collection','PASS',{quickUnitPrice:4,premiumRationUnitPrice:7,premiumCrystalUnitPrice:19,closedStock:closed.stock,quickCollected,managed:getProfile().business.managed});

  await clickUi('unstock-crystal');assert.equal(getProfile().business.shelves.ration.stock+getProfile().business.shelves.crystal.stock,0);
  for(const recipe of ['ration','crystal'] as const){const emptyShelf:{disabled:boolean;tip:string}=await js<{disabled:boolean;tip:string}>(popup!,`({disabled:document.getElementById('unstock-${recipe}').disabled,tip:document.getElementById('unstock-${recipe}').dataset.tooltip})`);assert.equal(emptyShelf.disabled,true);assert.match(emptyShelf.tip,/货架数量不足/);}
  record('empty shelf cannot be unstocked','PASS',{ration:0,crystal:0,buttonsDisabled:true});

  await clickUi('shopUpgrade-oven');assert.equal(getProfile().business.upgrades.oven,1);assert.match((await js(popup!,"document.getElementById('upgradeEffect-oven').textContent")),/制作耗时/);
  const ovenTimes:string[]=[await js(popup!,"document.querySelector('#shopRationRow td:nth-of-type(2) .shop-metric strong').textContent")];assert.equal(ovenTimes[0],'5.4秒');
  await clickUi('shopUpgrade-oven');assert.equal(getProfile().business.upgrades.oven,2);ovenTimes.push(await js(popup!,"document.querySelector('#shopRationRow td:nth-of-type(2) .shop-metric strong').textContent"));assert.equal(ovenTimes[1],'4.8秒');
  await clickUi('shopUpgrade-oven');assert.equal(getProfile().business.upgrades.oven,3);ovenTimes.push(await js(popup!,"document.querySelector('#shopRationRow td:nth-of-type(2) .shop-metric strong').textContent"));assert.equal(ovenTimes[2],'4.2秒');
  await clickUi('shopUpgrade-shelves');assert.equal(await js(popup!,"document.getElementById('shopShelfCount').textContent"),'货架 0/40');
  await clickUi('shopUpgrade-shelves');assert.equal(await js(popup!,"document.getElementById('shopShelfCount').textContent"),'货架 0/60');
  await clickUi('shopUpgrade-shelves');assert.equal(await js(popup!,"document.getElementById('shopShelfCount').textContent"),'货架 0/80');
  await clickUi('shopUpgrade-workbench');assert.equal(getProfile().business.upgrades.workbench,1);assert.equal(await js<boolean>(popup!,"document.querySelector('[data-batch=\"50\"]').hidden"),false);
  await tab('shopTabCraft','shopPanelCraft');await auditPanelReachability('shopPanelCraft','工作台Lv1制作面板');assert.equal(await js(popup!,"document.getElementById('productionCapacity').textContent"),'0/4批');await batch(50);let beforeCraft={flour:getProfile().bag.flour,gel:getProfile().bag.gel};await clickUi('queueRation');assert.equal(getProfile().queue?.remaining,50);await clickUi('cancelProduction-0');assert.deepEqual({flour:getProfile().bag.flour,gel:getProfile().bag.gel},beforeCraft);
  await tab('shopTabManage','shopPanelManage');await clickUi('shopUpgrade-workbench');await tab('shopTabCraft','shopPanelCraft');await auditPanelReachability('shopPanelCraft','工作台Lv2制作面板');assert.equal(await js(popup!,"document.getElementById('productionCapacity').textContent"),'0/6批');await batch(70);beforeCraft={flour:getProfile().bag.flour,gel:getProfile().bag.gel};await clickUi('queueRation');assert.equal(getProfile().queue?.remaining,70);await clickUi('cancelProduction-0');assert.deepEqual({flour:getProfile().bag.flour,gel:getProfile().bag.gel},beforeCraft);
  await tab('shopTabManage','shopPanelManage');await clickUi('shopUpgrade-workbench');await tab('shopTabCraft','shopPanelCraft');await auditPanelReachability('shopPanelCraft','工作台Lv3制作面板');assert.equal(await js(popup!,"document.getElementById('productionCapacity').textContent"),'0/8批');await batch(99);
  const crystal99=await js<{disabled:boolean;tip:string}>(popup!,"({disabled:document.getElementById('queueCrystal').disabled,tip:document.getElementById('queueCrystal').dataset.tooltip})");
  assert.equal(crystal99.disabled,true);assert.match(crystal99.tip,/制作材料不足/);
  beforeCraft={flour:getProfile().bag.flour,gel:getProfile().bag.gel};await clickUi('queueRation');assert.equal(getProfile().queue?.remaining,99);await clickUi('cancelProduction-0');assert.deepEqual({flour:getProfile().bag.flour,gel:getProfile().bag.gel},beforeCraft);
  await tab('shopTabManage','shopPanelManage');
  for(const id of ['shopUpgrade-oven','shopUpgrade-shelves','shopUpgrade-workbench']){const upgradeButton: {disabled:boolean;tip:string}=await js<{disabled:boolean;tip:string}>(popup!,`({disabled:document.getElementById(${JSON.stringify(id)}).disabled,tip:document.getElementById(${JSON.stringify(id)}).dataset.tooltip})`);assert.equal(upgradeButton.disabled,true);}
  record('all three three-level upgrades and batch/queue unlocks','PASS',{levels:getProfile().business.upgrades,ovenTimes,shelfLimit:await js(popup!,"document.getElementById('shopShelfCount').textContent"),queueLimit:await js(popup!,"document.getElementById('productionCapacity').textContent"),batchLimit:await js(popup!,"document.querySelector('[data-batch=\"99\"]').hidden"),maxUpgradeButtonsDisabled:true});

  await tab('shopTabCraft','shopPanelCraft');await auditPanelReachability('shopPanelCraft','满级工作台制作面板');await batch(1);
  for(let i=0;i<8;i++)await clickUi('queueRation');
  const fullQueue={count:(getProfile().queue?1:0)+getProfile().business.pending.length,limit:await js(popup!,"document.getElementById('productionCapacity').textContent")};assert.equal(fullQueue.count,8);
  const fullButton=await js<{disabled:boolean;tip:string}>(popup!,"({disabled:document.getElementById('queueRation').disabled,tip:document.getElementById('queueRation').dataset.tooltip})");assert.equal(fullButton.disabled,true);assert.match(fullButton.tip,/排产已满/);
  for(let i=7;i>=0;i--)await clickUi(`cancelProduction-${i}`);
  assert.equal(getProfile().queue,null);assert.equal(getProfile().business.pending.length,0);
  record('eight-batch queue limit and each cancellation row 0–7','PASS',{queueBeforeCancel:fullQueue,queueAfterCancel:0,ids:[0,1,2,3,4,5,6,7]});

  await tab('shopTabSupply','shopPanelSupply');await tab('shopTabCraft','shopPanelCraft');await tab('shopTabOrders','shopPanelOrders');await tab('shopTabManage','shopPanelManage');
  const html=await js<{fontSize:string;buttons:number;stable:boolean}>(popup!,`(()=>({fontSize:getComputedStyle(document.querySelector('.business-section')).fontSize,buttons:document.querySelectorAll('button[id]').length,stable:Object.keys(window.__idleTradeButtonRefs).every(id=>document.getElementById(id)===window.__idleTradeButtonRefs[id])}))()`);
  assert.equal(html.stable,true);assert.ok(parseFloat(html.fontSize)>=16);record('business panel readable font and stable button DOM','PASS',html);

  await js(popup!,"document.getElementById('popupClose').click()");await until(()=>shell!.popup===null,'经营面板关闭');
  await js(overlay!,"window.street.command({type:'shop-panel',anchor:{x:12,y:12,width:36,height:36}})");await uiReady('经营面板恢复');assert.ok(shell.popup!.generation>popupGeneration);popupGeneration=shell.popup!.generation;popup=shell.popupWindow!;
  await js(popup,`window.__idleTradeButtonRefs=Object.fromEntries(Array.from(document.querySelectorAll('button[id]')).map(e=>[e.id,e]));`);await stableButtons();
  record('close/reopen restores panel with saved v8 state','PASS',{generation:popupGeneration,coins:getProfile().coins,upgrades:getProfile().business.upgrades,retail:getProfile().retail,nativeVisible:popup.isVisible(),nativeFocused:popup.isFocused()});
  await js(popup,"document.getElementById('popupClose').click()");await until(()=>shell!.popup===null,'第二次经营面板关闭');
  await js(overlay!,"window.street.command({type:'shop-panel',anchor:{x:12,y:12,width:36,height:36}})");await uiReady('第二次经营面板恢复');popup=shell.popupWindow!;popupGeneration=shell.popup!.generation;
  record('repeat close and restore','PASS',{generation:popupGeneration,restoredJob:getProfile().job,restoredSequence:getProfile().sequence});

  await shell.game.request('flush');const storedRaw=fs.readFileSync(profileFile,'utf8'),stored=parseProfile(JSON.parse(storedRaw));
  assert.equal(stored.version,8);assert.equal(stored.sequence,getProfile().sequence);assert.deepEqual(stored.business,getProfile().business);assert.equal(stored.coins,getProfile().coins);
  const reloaded=new GameStore(path.join(profileRoot,'solo'));assert.deepEqual(reloaded.value,stored);
  record('atomic v8 save and reload','PASS',{file:profileFile,bytes:Buffer.byteLength(storedRaw),sequence:stored.sequence,receipt:stored.receipt?.requestId,business:{completed:stored.business.completed,till:stored.business.till,upgrades:stored.business.upgrades},reloaded:true});

  const buttonList=records.find(r=>r.name==='all business buttons use GameButton, tooltip, readable font and cursor')?.detail as {ids?:string[]}|undefined;
  const exercised=new Set<string>();for(const r of records){if(r.name.startsWith('UI click '))exercised.add(r.name.slice('UI click '.length));else if(r.name.startsWith('UI tab '))exercised.add(r.name.slice('UI tab '.length));else if(r.name.startsWith('UI batch selector '))exercised.add(`batch-${r.name.slice('UI batch selector '.length)}`);}
  const unexercised=(buttonList?.ids??[]).filter(id=>!exercised.has(id));assert.deepEqual(unexercised,[],'有业务按钮尚未通过可见页面操作覆盖');
  record('every business button exercised on a visible, scroll-reachable page','PASS',{buttonCount:buttonList?.ids?.length,exercised:exercised.size,unexercised});

  if(popup.isVisible()||overlay.isVisible()||popup.isFocused()||overlay.isFocused())throw Error('验收结束时窗口不再满足隐藏或无焦点状态。');
  if(consoleErrors.length)throw Error(`渲染器控制台错误：${consoleErrors.join('\n')}`);
  if(suppression.appFocus||suppression.windowFocus||suppression.webContentsFocus||suppression.globalShortcut)throw Error(`意外调用聚焦或全局快捷键：${JSON.stringify(suppression)}`);
  record('native windows remain hidden and unfocused','PASS',{windowStates:nativeSnapshots(),suppression,consoleErrors});
}
function result(status:'PASS'|'FAIL',error?:unknown):void{
  const windows=nativeSnapshots();
  const hashes=hashFiles();
  const report={schema:'pixelstreet.idle-trade-luna-max.v1',runId,status,at:new Date().toISOString(),app:{name:APP_NAME,version:APP_VERSION,profileName:PROFILE_NAME},platform:process.platform,arch:process.arch,electron:process.versions.electron,profileRoot,profileRoots,profileMarker:profileRoot?path.join(profileRoot,'.pixelstreet-isolated-profile.json'):null,profileFile:profileRoot?path.join(profileRoot,'solo/profile.json'):null,profilePreflight:'parseProfile(version=8) passed before Electron startup',testMethod:'Actual Electron BrowserWindows created by DesktopShell; every show/showInactive/focus/moveTop/app-focus call suppressed; macOS activation policy prohibited and Dock hidden; main and popup pages operated by executeJavaScript DOM .click() calls; no physical mouse/IME evidence; real isVisible/isFocused responses recorded without override; Tray proxied to no-op in bootstrap.',records,consoleErrors,suppression,nativeWindows:windows,productHashesAtStart,productHashesAtEnd:hashes,productHashesUnchanged:JSON.stringify(productHashesAtStart)===JSON.stringify(hashes),error:error?String(error):undefined,stack:error instanceof Error?error.stack:undefined};
  fs.mkdirSync(evidenceDir,{recursive:true});fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n',{mode:0o600});
}
async function runFreshVisitorLoop():Promise<void>{
  fs.mkdirSync(evidenceDir,{recursive:true});
  const base='/private/tmp';fs.mkdirSync(base,{recursive:true});profileRoot=path.join(base,`pixelstreet-idle-trade-fresh-loop-${runId}`);fs.mkdirSync(profileRoot,{mode:0o700});profileRoots.push(profileRoot);
  markIsolatedFolder(profileRoot,app.getPath('appData'));assert.equal(assertIsolatedFolder(profileRoot,app.getPath('appData'),true),profileRoot);
  const preflight=parseProfile(initialProfile(Date.now()));assert.equal(preflight.version,8);assert.equal(preflight.job,'visitor');assert.equal(preflight.coins,20);assert.deepEqual(preflight.bag,{flour:0,ration:0,crystal:0,gel:0});
  const profileFile=saveProfile(profileRoot,preflight);record('fresh visitor profile preflight: default level, balance and inventory','PASS',{profileRoot,job:preflight.job,coins:preflight.coins,bag:preflight.bag,version:preflight.version});
  if(process.platform==='darwin'){app.setActivationPolicy('prohibited');app.dock?.hide();}
  replace(app,'focus',()=>{suppression.appFocus++;});replace(Menu,'setApplicationMenu',()=>{});
  app.on('browser-window-created',(_event:any,win:BrowserWindow)=>patchWindow(win));
  app.on('web-contents-created',(_event:any,contents:any)=>contents.on('console-message',(event:any)=>{if(event.level==='error')consoleErrors.push(String(event.message).slice(0,500));}));
  shell=await startDesktop(profileRoot,true);overlay=shell.overlay;
  await until(async()=>await js(overlay!,"document.body.dataset.atlas==='verified'&&!!document.getElementById('portalSign')"),'新档隐藏原生营地渲染');
  await until(()=>shell!.game.state.status==='ready'&&shell!.game.state.profile?.version===8,'新档visitor载入');
  assert.equal(getProfile().job,'visitor');assert.equal(getProfile().coins,20);assert.deepEqual(getProfile().bag,{flour:0,ration:0,crystal:0,gel:0});
  if(overlay.isVisible())throw Error('新档营地窗口违反隐藏验收约束。');
  record('fresh visitor profile loaded in actual hidden Electron','PASS',{job:getProfile().job,coins:getProfile().coins,bag:getProfile().bag,nativeVisible:overlay.isVisible(),nativeFocused:overlay.isFocused()});
  await js(overlay,"window.street.command({type:'visit',shop:'shop-bakery'})");await js(overlay,"window.street.command({type:'shop-panel',anchor:{x:12,y:12,width:36,height:36}})");
  await until(()=>!!shell!.popupWindow&&shell!.popup?.kind==='shop','新档商店面板');popup=shell.popupWindow!;popupGeneration=shell.popup!.generation;await uiReady('visitor经营面板空闲');
  if(popup.isVisible())throw Error('visitor经营面板违反隐藏验收约束。');
  await js(popup,`window.__idleTradeButtonRefs=Object.fromEntries(Array.from(document.querySelectorAll('button[id]')).map(e=>[e.id,e]));`);await stableButtons();await auditButtonContract();
  const initialOrder=getProfile().business.orders[0];assert.equal(initialOrder.recipe,'ration');
  const initialRation=getProfile().bag.ration;assert.equal(getProfile().coins,20);
  await clickUi('applyJob');assert.equal(getProfile().job,'apprentice');assert.equal(getProfile().bag.flour,4);
  await clickUi('trialCraft');assert.equal(getProfile().queue?.recipe,'ration');await workerAdvance(6000,'visitor完成任职试餐');assert.equal(getProfile().bag.ration,initialRation+1);assert.equal(getProfile().queue,null);
  const coinsBeforeDelivery=getProfile().coins;await clickUi('deliverTrial');assert.equal(getProfile().job,'keeper');assert.equal(getProfile().bag.ration,initialRation);assert.equal(getProfile().coins,coinsBeforeDelivery+30);assert.equal(getProfile().coins,50);
  await tab('shopTabSupply','shopPanelSupply');await auditPanelReachability('shopPanelSupply','新手采购面板');
  const flourBefore=getProfile().bag.flour;await clickUi('merchantBulk-flour');assert.equal(getProfile().bag.flour,flourBefore+50);assert.equal(getProfile().coins,0);assert.equal(getProfile().bag.flour,52);
  await captureHiddenScreenshot('fresh-loop-supply');record('new player can use the exact 50-coin balance for 50-flour bulk purchase','PASS',{coins:0,flour:getProfile().bag.flour,bulkPrice:50,label:await js(popup,"document.getElementById('merchantBulk-flour').textContent.trim()")});
  await tab('shopTabCraft','shopPanelCraft');await batch(10);await clickUi('queueRation');assert.equal(getProfile().queue?.remaining,10);assert.equal(getProfile().bag.flour,32);
  await workerAdvance(60_000,'visitor批量制作10份口粮');assert.equal(getProfile().bag.ration,10);assert.equal(getProfile().queue,null);
  await tab('shopTabOrders','shopPanelOrders');const orderCount=getProfile().business.orders[0].count;assert.ok(orderCount>=3&&orderCount<=6);await clickUi('acceptOrder-0');await clickUi('deliverOrder-0');
  assert.equal(getProfile().business.completed,1);const remainingRation=10-orderCount;assert.equal(getProfile().bag.ration,remainingRation);assert.ok(remainingRation>0);
  await tab('shopTabManage','shopPanelManage');await clickUi('stockAll-ration');assert.equal(getProfile().business.shelves.ration.stock,remainingRation);assert.equal(getProfile().bag.ration,0);assert.equal(getProfile().business.managed,true);
  await clickUi('retailToggle');assert.equal(getProfile().retail,true);await auditManagedRetailLayout('fresh visitor managed retail table');await js(popup,"document.querySelector('.popover-content').scrollTop=0");await captureHiddenScreenshot('fresh-loop-manage-table');const tillBefore=getProfile().business.till;await workerAdvance(remainingRation*30_000+1_000,'新档营业并售完货架');
  assert.equal(getProfile().business.shelves.ration.stock,0);assert.equal(getProfile().business.till,remainingRation*5);assert.equal(getProfile().business.till,tillBefore+remainingRation*5);
  await captureHiddenScreenshot('fresh-loop-till');const collected=getProfile().business.till,coinsBeforeCollection=getProfile().coins;await clickUi('collectTill');assert.equal(getProfile().business.till,0);assert.equal(getProfile().coins,coinsBeforeCollection+collected);
  record('fresh visitor completes hire→trial→bulk purchase→10 ration→order→shelf→sale→till','PASS',{job:getProfile().job,initialCoins:20,coinsAfterHire:50,bulkFlour:50,coinsAfterPurchase:0,craftCount:10,orderCount,stockedAndSold:remainingRation,tillCollected:collected,finalCoins:getProfile().coins,finalBag:getProfile().bag});
  await shell.game.request('flush');const stored=parseProfile(JSON.parse(fs.readFileSync(profileFile,'utf8')));assert.equal(stored.version,8);assert.deepEqual(stored.business,getProfile().business);assert.equal(stored.coins,getProfile().coins);
  record('fresh visitor loop persists and reloads exact business and balance','PASS',{file:profileFile,sequence:stored.sequence,coins:stored.coins,till:stored.business.till,completed:stored.business.completed});
  if(popup.isVisible()||overlay.isVisible()||popup.isFocused()||overlay.isFocused())throw Error('visitor新手流程结束时窗口不再满足隐藏或无焦点状态。');
  if(consoleErrors.length)throw Error(`渲染器控制台错误：${consoleErrors.join('\n')}`);
  if(suppression.appFocus||suppression.windowFocus||suppression.webContentsFocus||suppression.globalShortcut)throw Error(`visitor流程意外调用聚焦或全局快捷键：${JSON.stringify(suppression)}`);
  record('fresh visitor native windows remain hidden and unfocused','PASS',{windowStates:nativeSnapshots(),suppression,consoleErrors});
}
const activeRun=process.env.PIXELSTREET_IDLE_FRESH_LOOP==='1'?runFreshVisitorLoop():runNative();
void activeRun.then(()=>{result('PASS');console.log('LUNA MAX IDLE TRADE PASS',reportPath);app.quit();}).catch(async error=>{
  result('FAIL',error);console.error('LUNA MAX IDLE TRADE FAIL',error);
  try{await shell?.room.close();await Promise.allSettled([shell?.action.close(),shell?.dungeon.close(),shell?.game.close()]);}catch{}
  app.exit(1);setTimeout(()=>app.exit(1),20000).unref();
});
