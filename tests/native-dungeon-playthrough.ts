// Isolated native QA bot. It reads room geometry for navigation but performs all
// movement, attacks, pickups, choices and settlement through visible native input.
// No HP, XP, enemies, items, seed loot, claim or run-state mutation is permitted.
import {app,screen,BrowserWindow} from 'electron';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';
import {startDesktop} from '../apps/desktop/bootstrap';
import * as Core from '../packages/dungeon-core';
import {roomWeapon} from '../packages/dungeon-core/map';
import {navigation,roomRoute,combatTarget} from './dungeon-driver';
const root=process.cwd(),out=path.join(root,'docs/evidence/dungeon-040',`playthrough-${new Date().toISOString().replace(/[:.]/g,'-')}`);fs.mkdirSync(out,{recursive:true});
const profile=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'pixelstreet-dungeon-playthrough-'));
const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));const held=new Set<string>();let left=false,win:BrowserWindow,shell:Awaited<ReturnType<typeof startDesktop>>;
const report:any={schema:'pixelstreet.native-natural-input-runs.v1',startedAt:new Date().toISOString(),profile,realProfileAccessed:false,method:'A navigation bot reads authoritative graph/geometry and issues WebContents.sendInputEvent to a real Electron window. No run mutations or prewritten progress; not a human blind-exploration or physical-device test.',runs:[],frames:[],errors:[],limits:['Native scripted input and capturePage do not establish physical keyboard/mouse, GPU completion, compositor or scanout.','The bot knows the map graph. Route decisions are scripted, not evidence of human decision quality.']};
const js=(code:string)=>win.webContents.executeJavaScript(code,true);
const current=():any=>shell?.dungeon.state.run;
async function until(check:()=>boolean|Promise<boolean>,label:string,ms=15000):Promise<void>{const end=Date.now()+ms;while(Date.now()<end){if(await check())return;await wait(50);}throw Error(`timeout: ${label}`);}
function keys(next:string[]):void {const n=new Set(next);for(const k of held)if(!n.has(k)){win.webContents.sendInputEvent({type:'keyUp',keyCode:k});held.delete(k);}for(const k of n)if(!held.has(k)){win.webContents.sendInputEvent({type:'keyDown',keyCode:k});held.add(k);}}
async function tap(keyCode:string):Promise<void>{win.webContents.sendInputEvent({type:'keyDown',keyCode});await wait(25);win.webContents.sendInputEvent({type:'keyUp',keyCode});}
function mouse(type:'mouseMove'|'mouseDown'|'mouseUp',x:number,y:number,button:'left'|'right'='left'):void{win.webContents.sendInputEvent({type,x:Math.round(x),y:Math.round(y),button,clickCount:1});}
async function fire(down:boolean):Promise<void>{if(down===left)return;const m=await js('window.dungeonProbe.state.mouse');mouse(down?'mouseDown':'mouseUp',m.x,m.y);left=down;}
async function stop():Promise<void>{keys([]);await fire(false);}
async function click(selector:string):Promise<void>{await stop();let r:any=null;await until(async()=>{r=await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled||e.closest('[hidden]'))return null;return e.getBoundingClientRect().toJSON()})()`);return !!r&&r.width>0&&r.height>0;},`visible enabled button ${selector}`,2500);mouse('mouseMove',r.x+r.width/2,r.y+r.height/2);mouse('mouseDown',r.x+r.width/2,r.y+r.height/2);await wait(30);mouse('mouseUp',r.x+r.width/2,r.y+r.height/2);await wait(180);}
async function capture(name:string):Promise<string>{const file=`playthrough-${name}.png`;fs.writeFileSync(path.join(out,file),(await win.webContents.capturePage()).toPNG());return file;}
function direction(a:any,b:any):string[]{const dx=b.x-a.x,dy=b.y-a.y;return[...(dx>6?['D']:dx< -6?['A']:[]),...(dy>6?['S']:dy< -6?['W']:[])];}
async function moveTo(target:any):Promise<void>{const r=current(),room=Core.currentRoom(r);keys(direction(r.player,navigation(room,r.player,target)));}
const at=(a:any,b:any,d=40)=>Math.hypot(a.x-b.x,a.y-b.y)<=d;
async function interact(id:string):Promise<void>{await click(`[data-interact="${id}"]`);}
function summary(r:any):any{return{room:r.currentRoom,tick:r.tick,elapsedMs:r.elapsedMs,phase:r.phase,paused:r.paused,position:{x:r.player.x,y:r.player.y},hp:r.player.hp,shield:r.player.shield,level:r.level,essence:r.essence,traits:r.player.traits,runes:r.player.runes,weapons:r.player.weaponSlots,activeSlot:r.player.activeSlot,reward:r.reward,visited:r.rooms.filter((v:any)=>v.visited).map((v:any)=>v.id)};}
function seedFor(kind:string):number{for(let seed=1;seed<10000;seed++){const r=Core.createDungeon(seed),rack=roomWeapon(r.rooms.find(v=>v.kind==='event')!,'rack');if(rack.kind===kind)return seed;}throw Error('no representative seed');}
async function frameSegment(label:string):Promise<void>{const sample=await js('({summary:window.dungeonProbe.stats.summary(),raw:window.dungeonProbe.stats.raw()})');report.frames.push({at:new Date().toISOString(),label,display:screen.getDisplayMatching(win.getBounds()).id,...sample});report.progress=current()?summary(current()):null;fs.writeFileSync(path.join(out,'running.json'),JSON.stringify(report,null,2));await js('window.dungeonProbe.stats.reset()');console.log(JSON.stringify({label,state:report.progress}));}
async function runOne(kind:'fire'|'boomerang',index:number):Promise<void>{
 const seed=seedFor(kind),entry:any={kind,seed,startedAt:new Date().toISOString(),events:[],screenshots:[],outcome:'running'},events=entry.events;report.runs.push(entry);
 // Reproducible seed enters at the trusted public start command. All subsequent
 // gameplay actions are native key/pointer events; no existing run is rewritten.
 await js(`window.street.command({type:'dungeon-start',seed:${seed}})`);await until(()=>!!current()&&!current().paused&&current().phase==='exploring','new seeded run');
 entry.seed=current().seed;entry.startMethod='public validated dungeon-start IPC with explicit seed; subsequent gameplay uses native input';
 let goal=0,stage=0,lastRoom='',fightAt=0,lastFrame=Date.now(),lastCapture=0,shotStart=Date.now(),lastSkill=0;
 let recovered=false,replaced=false,chestItem='',oldItem='',combatShot=false,focusRecoveries=0;
 const goals=kind==='fire'?['crossroads','spring','merchant','treasure','battle-a','elite','altar','battle-b','boss']:['crossroads','battle-a','elite','treasure','merchant','altar','battle-b','boss'];
 const end=Date.now()+420000;
 while(Date.now()<end){
  const r=current();if(!r)throw Error('run disappeared');const room=Core.currentRoom(r);
  if(!win.isFocused()||!await js('document.hasFocus()')){const loss={at:new Date().toISOString(),native:win.isFocused(),renderer:await js('({focus:document.hasFocus(),hidden:document.hidden,active:document.activeElement?.outerHTML.slice(0,300)})'),windows:BrowserWindow.getAllWindows().map(w=>({id:w.id,title:w.getTitle(),focused:w.isFocused(),visible:w.isVisible(),minimized:w.isMinimized()}))};events.push({type:'focus-interruption',...loss});if(++focusRecoveries>3)throw Error('repeated native focus loss; QA recovery limit');await stop();await wait(1200);app.focus({steal:true});win.focus();win.webContents.focus();await until(async()=>win.isFocused()&&await js('document.hasFocus()'),'QA explicit focus recovery');await wait(150);if(current().paused)await click('[data-command="resume"]');events.push({type:'QA-explicit-focus-recovery',at:new Date().toISOString(),notProductBehavior:true});continue;}
  if(r.paused)throw Error('run paused unexpectedly');
  if(r.phase==='won'||r.phase==='lost'){await stop();entry.outcome=r.phase;entry.final=summary(r);entry.screenshots.push(await capture(`${index}-${r.phase}`));break;}
  if(r.phase==='upgrade'){
   await stop();const choices=await js('Array.from(document.querySelectorAll("[data-upgrade]")).map(e=>({id:e.dataset.upgrade,text:e.textContent}))');
   if(!choices.length)throw Error('upgrade UI missing');const wanted=kind==='fire'?['cinder-burst','scorch-field']:['twin-blades','ricochet'];const selected=choices.find((c:any)=>wanted.includes(c.id))??choices.find((c:any)=>/damage|haste/.test(c.id))??choices[0];events.push({type:'upgrade',before:summary(r),choice:selected});entry.screenshots.push(await capture(`${index}-upgrade-${r.level}`));await click(`[data-upgrade="${selected.id}"]`);continue;
  }
  if(room.id!==lastRoom){await stop();lastRoom=room.id;events.push({type:'enter',state:summary(r),locked:room.locked,wave:room.wave});entry.screenshots.push(await capture(`${index}-room-${room.id}`));fightAt=Date.now();combatShot=false;}
  if(Date.now()-lastFrame>18000){await frameSegment(`${index}-${room.id}-${room.locked?'combat':'explore'}`);lastFrame=Date.now();}
  if(room.locked){
   const c=combatTarget(room,r.player,r.elapsedMs);if(c){keys(direction(r.player,c.move));const s=await js(`window.dungeonProbe.camera.worldToScreen(${JSON.stringify(c.aim)})`);mouse('mouseMove',s.x,s.y);const w=Core.activeWeapon(r);if(w?.kind==='frost'){const t=(Date.now()-shotStart)%1250;await fire(t<1080);}else await fire(true);if(c.danger&&Date.now()-lastSkill>1100){await tap('E');if(r.elapsedMs>=r.player.dashReady)await tap('SHIFT');lastSkill=Date.now();}if(!combatShot&&Date.now()-fightAt>1400){entry.screenshots.push(await capture(`${index}-combat-${room.id}`));combatShot=true;}}
   else{await stop();}if(Date.now()-fightAt>100000)throw Error(`combat did not resolve: ${room.id}`);await wait(85);continue;
  }
  await fire(false);
  const target=goals[goal];if(!target)throw Error('script reached end before boss');
  if(room.id!==target){const next=roomRoute(r.rooms,room.id,target)[0],door=Core.roomDoors(r).find(d=>d.to===next)!;if(at(r.player,door,28)){keys([door.side==='N'?'W':door.side==='S'?'S':door.side==='E'?'D':'A']);}else await moveTo({...door,x:Math.max(43,Math.min(room.width-43,door.x)),y:Math.max(43,Math.min(room.height-43,door.y))});await wait(85);continue;}
  const fixture=Core.roomFixtures(r)[0];
  if(target==='crossroads'&&!room.eventUsed){if(!at(r.player,fixture,54)){await moveTo(fixture);}else{events.push({type:'rack-confirm'});await interact(`event-${room.id}`);}await wait(85);continue;}
  if(target==='crossroads'&&room.ground.length&&r.player.weaponSlots[1]===null){const g=room.ground[0];if(!at(r.player,g,40))await moveTo(g);else{await interact(g.id);await tap('TAB');events.push({type:'rack-pickup',state:summary(current())});}await wait(85);continue;}
  if(target==='treasure'&&!room.chestOpened){if(!at(r.player,fixture,54))await moveTo(fixture);else await interact(`chest-${room.id}`);await wait(85);continue;}
  if(target==='treasure'&&!recovered&&room.ground.length){
   if(!replaced){const g=room.ground[0];if(!at(r.player,g,40))await moveTo(g);else{oldItem=Core.activeWeapon(r)?.id??'';chestItem=g.weapon.id;events.push({type:'compare-ground-weapon',current:Core.activeWeapon(r),found:g.weapon});entry.screenshots.push(await capture(`${index}-compare`));await interact(g.id);replaced=true;events.push({type:'replace',state:summary(current())});}}
   else{const g=room.ground.find((g:any)=>g.weapon.id===oldItem);if(g){if(!at(r.player,g,40))await moveTo(g);else{await interact(g.id);recovered=true;events.push({type:'repick-old-weapon',state:summary(current()),leftWeaponId:chestItem});}}else recovered=true;}
   await wait(85);continue;
  }
  if(target==='elite'&&room.cleared&&!room.eliteRuneClaimed){if(!at(r.player,fixture,54))await moveTo(fixture);else{const active=Core.activeWeapon(r);await interact(`rune-${room.id}-${active?.kind==='sword'?kind:active?.kind}`);events.push({type:'choose-rune',state:summary(current())});}await wait(85);continue;}
  if(target==='altar'&&!room.altarUsed){if(!at(r.player,fixture,54))await moveTo(fixture);else{const options=Core.nearbyInteractions(r),evolve=options.find(v=>v.id==='altar-evolve'&&!v.disabled),level=options.find(v=>v.id==='altar-level'&&!v.disabled);if(evolve){await interact(evolve.id);events.push({type:'evolve',state:summary(current())});entry.screenshots.push(await capture(`${index}-evolved`));}else if(level)await interact(level.id);else throw Error(`evolution not available: ${JSON.stringify(options)}`);}await wait(85);continue;}
  if(target==='spring'&&r.player.hp<75&&!room.restUsed){if(!at(r.player,fixture,54))await moveTo(fixture);else await interact(`rest-${room.id}`);await wait(85);continue;}
  if(target==='merchant'&&r.reward.coins>20&&!room.merchantStock.every((o:any)=>o.sold)){if(!at(r.player,fixture,54)){await moveTo(fixture);await wait(85);continue;}const offer=Core.nearbyInteractions(r).find(v=>v.kind==='merchant'&&!v.disabled);if(offer){await interact(offer.id);events.push({type:'merchant-purchase',state:summary(current())});}}
  keys([]);goal++;events.push({type:'route-goal',goal:target,state:summary(r)});await wait(85);
 }
 await stop();await frameSegment(`${index}-final`);if(entry.outcome!=='won')throw Error(`run ${index} ended ${entry.outcome}`);
 await click('[data-command="return"]');await until(()=>shell.dungeon.state.settled,'settlement');entry.settled={claim:shell.dungeon.state.claim,receipt:shell.dungeon.state.receipt,catalog:shell.dungeon.state.catalog,streetProfile:{coins:shell.game.state.profile?.coins,xp:shell.game.state.profile?.xp,actionClaim:shell.game.state.profile?.actionClaim}};entry.endedAt=new Date().toISOString();
}
async function openWindow():Promise<void>{shell.openArena();await until(async()=>!!shell.arenaWindow&&await shell.arenaWindow.webContents.executeJavaScript("document.body.dataset.dungeonReady==='true'"),'ready');win=shell.arenaWindow!;const d=screen.getAllDisplays().sort((a,b)=>b.displayFrequency-a.displayFrequency)[0];win.setBounds({x:d.workArea.x+80,y:d.workArea.y+60,width:1040,height:760});win.show();await until(()=>win.isFocused(),'native focused');await wait(250);held.clear();left=false;}
void(async()=>{
 report.nativeEvents=[];app.on('did-resign-active',()=>report.nativeEvents.push({at:new Date().toISOString(),event:'did-resign-active'}));app.on('did-become-active',()=>report.nativeEvents.push({at:new Date().toISOString(),event:'did-become-active'}));app.on('browser-window-blur',(_e,w)=>report.nativeEvents.push({at:new Date().toISOString(),event:'blur',window:w.id,title:w.getTitle()}));app.on('browser-window-focus',(_e,w)=>report.nativeEvents.push({at:new Date().toISOString(),event:'focus',window:w.id,title:w.getTitle()}));
 app.on('web-contents-created',(_e,w)=>{w.on('console-message',e=>{if(e.level==='error')report.errors.push(e.message);});w.on('render-process-gone',(_event,details)=>report.nativeEvents.push({at:new Date().toISOString(),event:'render-process-gone',id:w.id,details}));});
 shell=await startDesktop(profile,true);for(const name of ['closeArena','hide'] as const){const original=shell[name].bind(shell);shell[name]=()=>{report.nativeEvents.push({at:new Date().toISOString(),event:`shell.${name}`,stack:new Error().stack});return original();};}await openWindow();
 report.environment={versions:process.versions,arch:process.arch,platform:process.platform,displays:screen.getAllDisplays().map(d=>({id:d.id,hz:d.displayFrequency,scale:d.scaleFactor,bounds:d.bounds})),hashes:Object.fromEntries(['packages/dungeon-core/index.ts','packages/dungeon-core/build.ts','dist/dungeon-worker.cjs','dist/renderer/main.js'].filter(f=>fs.existsSync(path.join(root,f))).map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex')]))};
 await runOne('fire',1);await openWindow();await runOne('boomerang',2);report.status='pass';
})().catch(e=>{report.status='failed';report.failure={error:String(e),stack:e.stack,state:current()?summary(current()):null};console.error(e);}).finally(async()=>{report.endedAt=new Date().toISOString();fs.writeFileSync(path.join(out,'native-playthrough.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,path:out}));app.quit();});
