import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {app, BrowserWindow, type BrowserWindow as BrowserWindowType} from 'electron';
import {build} from 'esbuild';
import {pathToFileURL} from 'node:url';

const root=process.cwd();
const profile=process.env.PIXELSTREET_TEST_DATA??'';
const markerName='.pixelstreet-isolated-profile.json';
const marker={product:'PixelStreet',kind:'isolated-hover-check',version:1};
const guards={show:0,showInactive:0,windowFocus:0,restore:0,moveTop:0,webContentsFocus:0,appFocus:0,activate:0};

function override(target:any,key:string,fn:(...args:any[])=>unknown):void{
  const descriptor=Object.getOwnPropertyDescriptor(target,key);
  if(descriptor&&!descriptor.configurable&&!descriptor.writable)throw Error(`Cannot guard Electron ${key}`);
  Object.defineProperty(target,key,{configurable:true,enumerable:descriptor?.enumerable??true,writable:true,value:fn});
}
function guardMethod(target:any,key:string,counter:keyof typeof guards):void{
  if(typeof target[key]!=='function')return;
  override(target,key,()=>{guards[counter]++;return false;});
}
function cssPath(name:string):string{return pathToFileURL(path.join(root,'apps/desktop/renderer',name)).href;}
function wait(ms:number):Promise<void>{return new Promise(resolve=>setTimeout(resolve,ms));}
async function inspect(win:BrowserWindowType,expression:string):Promise<any>{return win.webContents.executeJavaScript(expression,true);}
async function hidden(win:BrowserWindowType,label:string):Promise<void>{
  assert.equal(win.isVisible(),false,`${label}: native window must stay hidden`);
  assert.equal(win.isFocused(),false,`${label}: native window must stay unfocused`);
  assert.equal(guards.show+guards.showInactive+guards.windowFocus+guards.restore+guards.moveTop+guards.webContentsFocus+guards.appFocus,0,`${label}: native show/focus/topmost action was suppressed`);
}

async function main():Promise<void>{
  assert.ok(profile.startsWith('/private/tmp/pixelstreet-hover-0140-'),'Refusing a non-isolated profile path.');
  assert.equal(fs.realpathSync(profile),profile,'Profile must be a direct real path under /private/tmp.');
  assert.equal(fs.lstatSync(profile).isSymbolicLink(),false,'Profile must not be a symlink.');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(profile,markerName),'utf8')),marker,'Isolated profile marker mismatch.');
  fs.mkdirSync(path.join(profile,'user-data'),{recursive:true,mode:0o700});
  app.setPath('userData',path.join(profile,'user-data'));
  if(process.platform==='darwin'){
    (app as any).setActivationPolicy?.('prohibited');
    try{app.dock?.hide();}catch{}
  }
  guardMethod(app,'focus','appFocus');
  const originalEmit=app.emit.bind(app);
  override(app,'emit',(event:string,...args:any[])=>{if(event==='activate'){guards.activate++;return false;}return originalEmit(event,...args);});
  for(const[method,counter]of [['show','show'],['showInactive','showInactive'],['focus','windowFocus'],['restore','restore'],['moveTop','moveTop']] as const)guardMethod(BrowserWindow.prototype,method,counter);
  app.on('browser-window-created',(_event,win)=>{
    try{win.webContents.focus=()=>{guards.webContentsFocus++;return false;};}
    catch(error){throw Error(`Could not guard webContents.focus: ${String(error)}`);}
  });

  const bundle=path.join(profile,'game-button.js');
  await build({
    entryPoints:[path.join(root,'apps/desktop/renderer/game-button.ts')],
    outfile:bundle,bundle:true,platform:'browser',target:'chrome138',format:'iife',globalName:'PixelStreetGameButtonModule',logLevel:'silent'
  });
  const html=path.join(profile,'hover-check.html');
  const document=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="stylesheet" href="${cssPath('style.css')}"><link rel="stylesheet" href="${cssPath('game-button.css')}"><link rel="stylesheet" href="${cssPath('living-scene.css')}"></head><body><main id="root"><section class="living-scene"><button id="livingObject" type="button" class="game-button ls-object" aria-label="面包烤炉" title="查看烤炉"><span class="ls-item-art" aria-hidden="true"></span><span class="ls-tag">面包烤炉</span></button><form id="submitForm"><button id="nativeDisabled" class="game-button" type="submit" disabled title="缺少面粉">开始制作</button><button id="ariaDisabled" class="game-button" type="submit" aria-disabled="true" data-disabled-reason="等待档案就绪">提交操作</button></form><button id="customOwner" class="game-button" type="button" data-tooltip-owner="custom" data-tooltip="自定义物品详情">物品</button><button id="selectedButton" class="game-button" type="button" aria-pressed="true" style="position:fixed;left:400px;top:300px;z-index:100;background-color:rgb(30,70,40)">选中项</button></section></main><script src="${pathToFileURL(bundle).href}"></script><script>window.PixelStreetGameButtonModule.installGameButtons();window.__submits=0;window.__ariaClicks=0;document.getElementById('submitForm').addEventListener('submit',event=>{event.preventDefault();window.__submits++});document.getElementById('ariaDisabled').addEventListener('click',()=>window.__ariaClicks++);</script></body></html>`;
  fs.writeFileSync(html,document,{flag:'w',mode:0o600});

  await app.whenReady();
  const win=new BrowserWindow({width:560,height:380,frame:false,show:false,focusable:false,skipTaskbar:true,resizable:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
  await win.loadFile(html);
  await inspect(win,'new Promise(resolve=>setTimeout(()=>resolve(true),80))');
  await hidden(win,'loaded');
  const debuggerSession=win.webContents.debugger;
  debuggerSession.attach('1.3');

  const bounds=await inspect(win,`(()=>{const r=document.getElementById('livingObject').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,width:r.width,height:r.height}})()`);
  await debuggerSession.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',x:bounds.x,y:bounds.y,pointerType:'mouse'});
  await wait(340);
  const hovered=await inspect(win,`(()=>{const b=document.getElementById('livingObject'),tag=b.querySelector('.ls-tag'),s=getComputedStyle(b),t=getComputedStyle(tag),r=b.getBoundingClientRect();return{hover:b.matches(':hover'),cursor:s.cursor,outlineStyle:s.outlineStyle,outlineWidth:s.outlineWidth,tagBackground:t.backgroundColor,tagBorder:t.borderColor,rect:{x:r.x,y:r.y,width:r.width,height:r.height},hintHidden:document.getElementById('interactionHint')?.hidden??null,clicks:window.__submits}})()`);
  assert.equal(hovered.hover,true,'CDP pointer must hover the actual object button.');
  assert.equal(hovered.cursor,'pointer','The actual hovered target should compute a hand cursor.');
  assert.equal(hovered.outlineStyle,'solid','Living-scene hover must retain a visible outline.');
  assert.equal(hovered.outlineWidth,'2px','Hover feedback must not enlarge the target.');
  assert.equal(hovered.clicks,0,'Hover must not submit a business action.');

  const tagPoint=await inspect(win,`(()=>{const r=document.querySelector('#livingObject .ls-tag').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await debuggerSession.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',x:tagPoint.x,y:tagPoint.y,pointerType:'mouse'});
  const childTarget=await inspect(win,`(()=>{const b=document.getElementById('livingObject'),under=document.elementFromPoint(${tagPoint.x},${tagPoint.y});return{sameTarget:under?.closest('button')===b,cursor:getComputedStyle(under).cursor,hintHidden:document.getElementById('interactionHint')?.hidden??null}})()`);
  assert.equal(childTarget.sameTarget,true,'Artwork and label must resolve to one semantic button target.');
  assert.equal(childTarget.cursor,'pointer','The whole target, including its label, must keep the hand cursor.');
  assert.equal(childTarget.hintHidden,false,'Crossing from artwork to label must retain the same hint.');
  assert.equal(hovered.rect.width,bounds.width,'Hover must not change target width.');
  assert.equal(hovered.rect.height,bounds.height,'Hover must not change target height.');

  const selectedBounds=await inspect(win,`(()=>{const r=document.getElementById('selectedButton').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await debuggerSession.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',x:selectedBounds.x,y:selectedBounds.y,pointerType:'mouse'});
  const selected=await inspect(win,`(()=>{const b=document.getElementById('selectedButton'),s=getComputedStyle(b),r=b.getBoundingClientRect(),under=document.elementFromPoint(${selectedBounds.x},${selectedBounds.y});return{pressed:b.getAttribute('aria-pressed'),background:s.backgroundColor,outline:s.outlineStyle,outlineWidth:s.outlineWidth,cursor:s.cursor,hover:b.matches(':hover'),under:under?.id||under?.tagName,rect:{x:r.x,y:r.y,width:r.width,height:r.height}}})()`);
  assert.equal(selected.under,'selectedButton','The selected-control probe must hit its own actual target.');
  assert.equal(selected.hover,true,'The selected-control probe must be in :hover state.');
  assert.equal(selected.pressed,'true','Hover must not clear selected state.');
  assert.equal(selected.background,'rgb(30, 70, 40)','Hover outline must not replace the selected surface.');
  assert.equal(selected.outline,'solid',`Selected controls still receive distinct hover feedback: ${JSON.stringify(selected)}`);
  assert.equal(selected.cursor,'pointer','Selected controls remain pointer targets.');

  await debuggerSession.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',x:550,y:370,pointerType:'mouse'});
  await inspect(win,`(()=>{document.getElementById('livingObject').focus({focusVisible:true});return true})()`);
  await wait(340);
  const focused=await inspect(win,`(()=>{const b=document.getElementById('livingObject'),tip=document.getElementById('interactionHint');return{focusVisible:b.matches(':focus-visible'),hintHidden:tip?.hidden??null,hint:tip?.textContent??'',outlineStyle:getComputedStyle(b).outlineStyle,outlineWidth:getComputedStyle(b).outlineWidth}})()`);
  assert.equal(focused.focusVisible,true,'The local focus probe must use :focus-visible.');
  assert.equal(focused.hintHidden,false,'Keyboard/local focus must expose the plain-button hint.');
  assert.equal(focused.hint,'查看烤炉','The focused hint should match the target label.');
  assert.equal(focused.outlineStyle,'solid','Focus-visible feedback must remain clear.');

  await inspect(win,`(()=>{document.getElementById('customOwner').focus({focusVisible:true});return true})()`);
  await wait(340);
  const customOwner=await inspect(win,`(()=>{const b=document.getElementById('customOwner'),tip=document.getElementById('interactionHint');return{tooltip:b.dataset.tooltip,title:b.getAttribute('title'),hintHidden:tip?.hidden??null}})()`);
  assert.equal(customOwner.tooltip,'自定义物品详情','A custom owner must retain its richer tooltip payload.');
  assert.equal(customOwner.title,null,'The custom owner test does not leave a browser-native title tooltip.');
  assert.equal(customOwner.hintHidden,true,'The shared plain hint must defer to a custom owner.');

  const disabled=await inspect(win,`(()=>{const n=document.getElementById('nativeDisabled'),a=document.getElementById('ariaDisabled');for(const e of [n,a])e.click();return{native:{disabled:n.disabled,cursor:getComputedStyle(n).cursor,reason:n.dataset.disabledReason,description:n.getAttribute('aria-description'),outline:getComputedStyle(n).outlineStyle,boxShadow:getComputedStyle(n).boxShadow},aria:{disabled:a.getAttribute('aria-disabled'),cursor:getComputedStyle(a).cursor,reason:a.dataset.disabledReason,description:a.getAttribute('aria-description'),outline:getComputedStyle(a).outlineStyle,boxShadow:getComputedStyle(a).boxShadow},submits:window.__submits,ariaClicks:window.__ariaClicks}})()`);
  assert.equal(disabled.native.disabled,true,'Native disabled controls must stay disabled.');
  assert.equal(disabled.native.cursor,'not-allowed','Disabled controls must not show a usable hand cursor.');
  assert.equal(disabled.native.reason,'缺少面粉','A disabled title must become an explicit reason.');
  assert.equal(disabled.native.description,'缺少面粉','The disabled reason must be available to assistive technology.');
  assert.equal(disabled.aria.disabled,'true','aria-disabled state must be preserved.');
  assert.equal(disabled.aria.cursor,'not-allowed','aria-disabled controls must not show a usable hand cursor.');
  assert.equal(disabled.aria.description,'等待档案就绪','An explicit disabled reason must be exposed accessibly.');
  assert.equal(disabled.submits,0,'Disabled controls must not submit a form.');
  assert.equal(disabled.ariaClicks,0,'aria-disabled controls must not activate handlers.');

  await debuggerSession.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',x:bounds.x,y:bounds.y,pointerType:'mouse'});
  await debuggerSession.sendCommand('Input.dispatchMouseEvent',{type:'mousePressed',x:bounds.x,y:bounds.y,button:'left',clickCount:1,pointerType:'mouse'});
  const pressed=await inspect(win,`(()=>{const b=document.getElementById('livingObject');return{active:b.classList.contains('is-pressed'),artTransform:getComputedStyle(b.querySelector('.ls-item-art')).transform}})()`);
  await debuggerSession.sendCommand('Input.dispatchMouseEvent',{type:'mouseReleased',x:bounds.x,y:bounds.y,button:'left',clickCount:1,pointerType:'mouse'});
  const released=await inspect(win,`(()=>{const b=document.getElementById('livingObject');return{active:b.classList.contains('is-pressed'),artTransform:getComputedStyle(b.querySelector('.ls-item-art')).transform}})()`);
  assert.equal(pressed.active,true,'Primary pointer down must enter pressed state.');
  assert.notEqual(pressed.artTransform,'none','Pressed feedback must remain distinct from hover.');
  assert.equal(released.active,false,'Pointer up must clear pressed state.');
  assert.equal(released.artTransform,'none','Pressed feedback must disappear after pointer up.');

  const lifecycle=await inspect(win,`(()=>{const b=document.getElementById('livingObject'),r={};b.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0}));r.down=b.classList.contains('is-pressed');b.dispatchEvent(new PointerEvent('pointercancel',{bubbles:true,button:0}));r.cancel=!b.classList.contains('is-pressed');b.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0}));window.dispatchEvent(new Event('blur'));r.blur=!b.classList.contains('is-pressed');b.classList.add('is-pressed');window.PixelStreetGameButtonModule.clearPressedGameButtons();r.hidden=!b.classList.contains('is-pressed');return r})()`);
  assert.deepEqual(lifecycle,{down:true,cancel:true,blur:true,hidden:true},'Cancel, blur and hidden-state reset must clear pressed styling.');
  await hidden(win,'all renderer state probes');
  assert.equal(guards.activate,0,'The isolated check must not activate the application.');

  console.log(JSON.stringify({status:'CHECKED',method:'hidden Electron renderer with CDP-injected pointer and local DOM focus; not physical-device evidence',profile,window:{visible:win.isVisible(),focused:win.isFocused()},hover:{cursor:hovered.cursor,outline:hovered.outlineStyle,childTarget:childTarget.sameTarget,noClick:hovered.clicks===0},selected:{preserved:selected.pressed,background:selected.background},focus:{visible:focused.focusVisible,hint:focused.hint},customTooltipOwner:customOwner.hintHidden,disabled:{nativeReason:disabled.native.reason,ariaReason:disabled.aria.description,submits:disabled.submits,ariaClicks:disabled.ariaClicks},pressed:{pointerUp:released.active,cancel:lifecycle.cancel,blur:lifecycle.blur,hidden:lifecycle.hidden},guards}));
  debuggerSession.detach();
  win.close();
  fs.rmSync(bundle,{force:true});
  fs.rmSync(html,{force:true});
  app.quit();
}

void main().catch(error=>{
  console.error(String(error));
  try{
    if(profile.startsWith('/private/tmp/pixelstreet-hover-0140-')&&fs.realpathSync(profile)===profile&&JSON.parse(fs.readFileSync(path.join(profile,markerName),'utf8')).kind===marker.kind){
      fs.rmSync(path.join(profile,'game-button.js'),{force:true});
      fs.rmSync(path.join(profile,'hover-check.html'),{force:true});
    }
  }catch{}
  app.exit(1);
});
