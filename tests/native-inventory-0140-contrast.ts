import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {app,BrowserWindow} from 'electron';
import {DesktopShell} from '../apps/desktop/shell';
import {initialProfile,parseProfile} from '../packages/solo-core';
const folder=process.env.PIXELSTREET_TEST_DATA!,wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
let shell:DesktopShell|undefined;
function luminance(rgb:string):number{const values=rgb.match(/[\d.]+/g)!.slice(0,3).map(Number).map(v=>{const n=v/255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;});return values[0]*.2126+values[1]*.7152+values[2]*.0722;}
async function main(){
 assert.ok((globalThis as any).__inventoryGuards,'Only guarded bootstrap may start this probe');
 const profile=initialProfile(Date.now());profile.job='keeper';profile.bag.flour=1000000;profile.bag.gel=2;profile.bag.ration=1;fs.mkdirSync(path.join(folder,'solo'),{recursive:true});fs.writeFileSync(path.join(folder,'solo/profile.json'),JSON.stringify(parseProfile(profile))+'\n');
 await app.whenReady();shell=new DesktopShell(folder,path.join(folder,'solo'),true);await shell.game.ready;shell.mode='interaction';shell.openInventory();const win=shell.inventoryWindow!,js=(code:string)=>win.webContents.executeJavaScript(code,true);
 for(let n=0;n<100;n++){if(await js("document.body.dataset.inventoryReady==='true'"))break;await wait(40);}assert.equal(await js("document.body.dataset.inventoryReady"),'true');
 win.webContents.debugger.attach('1.3');await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true});
 const before=JSON.stringify(shell.game.state.profile),states:any[]=[];
 const read=async(selector:string,textSelector?:string)=>js(`(()=>{const b=document.querySelector(${JSON.stringify(selector)}),t=${textSelector?`b.querySelector(${JSON.stringify(textSelector)})`:'b'},s=getComputedStyle(b),c=getComputedStyle(t),r=b.getBoundingClientRect();return{foreground:c.color,background:s.backgroundColor,backgroundImage:s.backgroundImage,filter:s.filter,cursor:s.cursor,outline:s.outlineStyle,outlineWidth:s.outlineWidth,shadow:s.boxShadow,hover:b.matches(':hover'),focus:b.matches(':focus-visible'),width:r.width,height:r.height}})()`);
 const move=async(x:number,y:number)=>win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',x,y,pointerType:'mouse'});
 const test=async(name:string,selector:string,textSelector?:string)=>{
  const size=await read(selector,textSelector);const point=await js(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await move(point.x,point.y);await wait(160);const hover=await read(selector,textSelector);assert.equal(hover.hover,true,name+' real CDP hover');states.push({name,state:'hover',...hover});assert.equal(hover.width,size.width);assert.equal(hover.height,size.height);
  await move(5,5);await js(`document.querySelector(${JSON.stringify(selector)}).focus({focusVisible:true});true`);await wait(160);const focus=await read(selector,textSelector);assert.equal(focus.focus,true,name+' local focus-visible');states.push({name,state:'focus',...focus});assert.equal(focus.width,size.width);assert.equal(focus.height,size.height);
 };
 await test('item-count','[data-item-id="bag:flour"]','.inventory-count');await test('filter-unselected','[data-filter="material"]');await test('filter-selected','[data-filter="all"]');
 await js(`(()=>{const b=document.querySelector('[data-item-id="bag:flour"]');b.focus({focusVisible:true});b.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:300,clientY:260}));document.querySelector('#inventoryMenu button:last-child').focus({focusVisible:true});return true})()`);assert.equal(await js("document.getElementById('inventoryMenu').hidden"),false);
 await test('menu-item','#inventoryMenu button:first-child');
 for(const state of states){const a=luminance(state.foreground),b=luminance(state.background);state.contrast=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);}
 console.log(JSON.stringify({phase:'computed',states}));
 for(const state of states){assert.equal(state.filter,'none',state.name+' text must not be brightness filtered');assert.equal(state.backgroundImage,'none',state.name+' tested state has explicit solid surface');assert.ok(state.contrast>=4.5,`${state.name} ${state.state} contrast ${state.contrast}`);assert.equal(state.cursor,'pointer');assert.equal(state.outline,'solid');assert.notEqual(state.outlineWidth,'0px');}
 // The common pressed inset remains distinct without dimming the component's text.
 await js("document.querySelector('[data-filter=all]').focus();true");const point=await js(`(()=>{const r=document.querySelector('[data-item-id="bag:flour"]').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+20}})()`);await move(point.x,point.y);await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mousePressed',x:point.x,y:point.y,button:'left',clickCount:1});const pressed=await read('[data-item-id="bag:flour"]','.inventory-count');assert.match(pressed.shadow,/inset/);assert.equal(pressed.filter,'none');await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x,y:point.y,button:'left',clickCount:1});
 assert.equal(JSON.stringify(shell.game.state.profile),before);for(const w of BrowserWindow.getAllWindows()){assert.equal(w.isVisible(),false);assert.equal(w.isFocused(),false);}const guards=(globalThis as any).__inventoryGuards;assert.equal(guards.show+guards.focus+guards.appFocus+guards.activate+guards.webContentsFocus,0);
 console.log(JSON.stringify({status:'CHECKED',probe:'inventory interaction color contrast only',states:states.map(s=>({name:s.name,state:s.state,foreground:s.foreground,background:s.background,filter:s.filter,contrast:s.contrast})),pressedShadow:pressed.shadow,guards,profile:folder,evidence:'Actual renderer/preload/Worker; CDP hover and emulated document focus only, no OS focus or screenshot.'}));shell.dispose();app.exit(0);
}
void main().catch(error=>{console.error(error.stack||String(error));shell?.dispose();app.exit(1);});
