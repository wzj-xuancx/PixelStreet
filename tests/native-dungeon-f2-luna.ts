// F2 independent native renderer review. Every invocation owns a fresh marked
// temporary profile; fixture runs are valid DungeonStore saves written before
// DesktopShell/renderer startup. Scripted Electron input is not physical input.
import {app,screen,type BrowserWindow} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {startDesktop} from '../apps/desktop/bootstrap';
import {markIsolatedFolder,configureDataPaths} from '../apps/desktop/launch-profile';
import {DungeonStore} from '../apps/desktop/dungeon-store';
import {createDungeon,evolutionInfo,parseDungeonRun,roomDoors,roomFixtures,nearbyInteractions,doorTriggerRect,type DungeonRun,type RoomState} from '../packages/dungeon-core';
import {eligibleUpgrades} from '../packages/dungeon-core/build';

const root=process.cwd();
const evidenceDir=path.resolve(root,process.env.PIXELSTREET_DUNGEON_EVIDENCE??'docs/evidence/dungeon-040/F2F3-renderer-luna');
const screenshotDir=path.join(evidenceDir,'screenshots');
const rawDir=path.join(evidenceDir,'rawframes');
fs.mkdirSync(screenshotDir,{recursive:true});fs.mkdirSync(rawDir,{recursive:true});
const requestedScenario=process.argv.at(-1)??'natural';
const scenario=['natural','fixture-chest-replacement','fixture-combat','fixture-upgrade-reforge','fixture-boss'].includes(requestedScenario)?requestedScenario:'natural';
const quickMode=process.env.PIXELSTREET_DUNGEON_QUICK==='1';
const startedAt=new Date().toISOString();
const profile=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),`pixelstreet-dungeon-f2-${scenario}-`));
const markerPath=path.join(profile,'.pixelstreet-isolated-profile.json');
const checks:{name:string;expected:string;actual:unknown;status:'pass'|'fail'|'not-run'}[]=[];
const events:{at:string;kind:string;detail?:unknown}[]=[];
const frames:unknown[]=[];
const errors:{kind:string;detail:string}[]=[];
let shell:Awaited<ReturnType<typeof startDesktop>>|undefined;
let win:BrowserWindow|undefined;
let inputReady=false;
let seq=0;

const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const sha=(file:string)=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex');
const record=(name:string,expected:string,actual:unknown,ok:boolean|undefined)=>checks.push({name,expected,actual,status:ok===undefined?'not-run':ok?'pass':'fail'});
const mark=(kind:string,detail?:unknown)=>events.push({at:new Date().toISOString(),kind,detail});
const until=async<T>(read:()=>T|Promise<T>,predicate:(value:T)=>boolean,label:string,ms=12000):Promise<T>=>{
 const end=Date.now()+ms;let value!:T;
 do{value=await read();if(predicate(value))return value;await delay(50);}while(Date.now()<end);
 throw Error(`${label} timed out; last=${JSON.stringify(value)}`);
};
const js=async<T>(source:string):Promise<T>=>{
 if(!win||win.isDestroyed())throw Error('Dungeon window is unavailable');
 return await win.webContents.executeJavaScript(source,true) as T;
};
const observe=async():Promise<any>=>js<any>(`(()=>{
 const p=window.dungeonProbe;if(!p)return null;const s=p.state,r=s.session?.run,room=r?.rooms?.find(x=>x.id===r.currentRoom);
 const canvas=document.querySelector('#dungeonWorld canvas'),range=document.getElementById('dungeonZoom'),map=document.getElementById('miniMap'),panel=document.getElementById('dungeonPanel'),settings=document.getElementById('dungeonSettings'),guide=document.querySelector('#dungeonSettings .d-guide-book'),metrics=document.getElementById('dungeonShowMetrics');
 const text=(id)=>document.getElementById(id)?.textContent??null,fill=(id)=>document.getElementById(id)?.getBoundingClientRect().width??null;
 const font=(id)=>{const e=document.getElementById(id);return e?Number.parseFloat(getComputedStyle(e).fontSize):null;};
 const selectorFont=(selector)=>{const e=document.querySelector(selector);return e?Number.parseFloat(getComputedStyle(e).fontSize):null;};
 const visibleText=document.body.innerText.replace(/\s+/g,' ').trim();
 return{ready:document.body.dataset.dungeonReady,focused:s.focused,documentFocus:document.hasFocus(),visibility:document.visibilityState,keys:s.keys,buttons:s.buttons,
 mouse:s.mouse,pointerWorld:s.pointerWorld,frameCount:s.frameCount,tickerStarted:p.app.ticker.started,zoom:p.camera.zoom,visibleTiles:s.visibleTiles,tileScreenSize:s.tileScreenSize,
 hud:s.hud,world:s.world,obstacleDraws:s.obstacleDraws,rendererResolution:s.rendererResolution,camera:{x:p.camera.x,y:p.camera.y,width:p.camera.width,height:p.camera.height,zoom:p.camera.zoom},canvas:canvas?.getBoundingClientRect().toJSON(),
 range:range?{value:Number(range.value),min:Number(range.min),max:Number(range.max),step:Number(range.step),hidden:!!range.closest('[hidden]'),rect:range.getBoundingClientRect().toJSON()}:null,
 settings:settings?{hidden:settings.hidden,expanded:document.getElementById('settingsDungeon')?.getAttribute('aria-expanded'),pointerEvents:getComputedStyle(settings).pointerEvents,rect:settings.getBoundingClientRect().toJSON(),guideOpen:guide?.open??null,guideText:guide?.innerText??null,metricsChecked:metrics?.checked??null,metricsHidden:document.getElementById('frameText')?.hidden??null}:null,
 textAudit:{visibleChars:visibleText.length,visibleNonWhitespace:visibleText.replace(/\s/g,'').length,visibleText,fonts:{health:font('healthText'),shield:font('shieldText'),room:selectorFont('.d-heading span'),weapon:font('weaponText'),roomProgress:font('roomProgress'),notice:font('dungeonNotice'),worldPrompt:font('worldPrompt'),settings:settings?Number.parseFloat(getComputedStyle(settings).fontSize):null,settingsTitle:selectorFont('.d-settings-title b'),guideSummary:selectorFont('#dungeonSettings .d-guide-book summary'),guideBody:selectorFont('#dungeonSettings .d-guide-book p'),panelTitle:selectorFont('#dungeonPanel h1'),panelBody:selectorFont('#dungeonPanel p'),panelButton:selectorFont('#dungeonPanel button')}},
 panel:panel?{hidden:panel.hidden,text:panel.innerText,buttons:[...panel.querySelectorAll('button')].map(b=>({text:b.innerText,id:b.dataset.interact??null,upgrade:b.dataset.upgrade??null,reforge:b.dataset.reforge??null,slot:b.dataset.reforgeSlot??null,command:b.dataset.command??null,disabled:b.disabled}))}:null,
 ui:{healthText:text('healthText'),shieldText:text('shieldText'),healthFillWidth:fill('healthFill'),shieldFillWidth:fill('shieldFill'),roomText:text('roomText'),bossText:text('bossText'),bossHidden:document.getElementById('bossHud')?.hidden??null,notice:text('dungeonNotice')},
 prompt:(()=>{const e=document.getElementById('worldPrompt');return e?{hidden:e.hidden,text:e.textContent,rect:e.getBoundingClientRect().toJSON()}:null})(),
 map:map?{svg:map.innerHTML,rects:map.querySelectorAll('rect').length,circles:map.querySelectorAll('circle').length,paths:map.querySelectorAll('path').length,text:[...map.querySelectorAll('text')].map(e=>e.textContent)}:null,
 run:r?{version:r.version,runId:r.runId,seed:r.seed,tick:r.tick,elapsedMs:r.elapsedMs,paused:r.paused,phase:r.phase,currentRoom:r.currentRoom,level:r.level,essence:r.essence,reforgesLeft:r.reforgesLeft,choices:r.choices,reward:r.reward,notice:r.notice,player:{x:r.player.x,y:r.player.y,hp:r.player.hp,maxHp:r.player.maxHp,shield:r.player.shield,maxShield:r.player.maxShield,moveX:r.player.moveX,moveY:r.player.moveY,firing:r.player.firing,activeSlot:r.player.activeSlot,traits:r.player.traits,runes:r.player.runes,weaponSlots:r.player.weaponSlots.map(w=>w&&{id:w.id,kind:w.kind,level:w.level,evolved:w.evolved})},rooms:r.rooms.map(x=>({id:x.id,kind:x.kind,gridX:x.gridX,gridY:x.gridY,width:x.width,height:x.height,visited:x.visited,cleared:x.cleared,doors:x.doors,locked:x.locked,wave:x.wave,totalWaves:x.totalWaves,nextWaveAt:x.nextWaveAt,encounterStarted:x.encounterStarted,obstacles:x.obstacles.map(o=>({...o})),traps:x.traps.map(t=>({...t})),enemies:x.enemies.map(e=>({id:e.id,kind:e.kind,bossPhase:e.bossPhase,pattern:e.pattern,state:e.state,x:e.x,y:e.y,hp:e.hp,maxHp:e.maxHp,attackReady:e.attackReady,stateUntil:e.stateUntil})),ground:x.ground.map(g=>({id:g.id,kind:g.weapon.kind,weaponId:g.weapon.id,x:g.x,y:g.y})),chestOpened:x.chestOpened,restUsed:x.restUsed,eventUsed:x.eventUsed,altarUsed:x.altarUsed,merchantStock:x.merchantStock.map(o=>({id:o.id,price:o.price,sold:o.sold}))})),projectiles:r.projectiles.map(p=>({...p})),effects:r.effects.map(e=>({id:e.id,kind:e.kind,x:e.x,y:e.y,expiresAt:e.expiresAt})),zones:r.zones}:null,
 events:window.__f2Events?.slice(-30)??[]};
})()`);
const snapshot=(label:string,state:any)=>frames.push({at:new Date().toISOString(),label,frameCount:state?.frameCount,tick:state?.run?.tick,room:state?.run?.currentRoom,position:state?.run?.player?{x:state.run.player.x,y:state.run.player.y}:null,zoom:state?.zoom,prompt:state?.prompt?.text,focused:state?.documentFocus});
const capture=async(name:string):Promise<{path:string;sha256:string;size:{width:number;height:number};bytes:number}|null>=>{
 if(!win||win.isDestroyed())return null;const image=await win.webContents.capturePage();const bytes=image.toPNG(),file=path.join(screenshotDir,name);fs.writeFileSync(file,bytes);
 return{path:path.relative(root,file),sha256:crypto.createHash('sha256').update(bytes).digest('hex'),size:image.getSize(),bytes:bytes.length};
};
const inputMouse=async(type:'mouseMove'|'mouseDown'|'mouseUp',x:number,y:number,button:'left'|'right'='left')=>{
 if(!inputReady||!win||win.isDestroyed())return;win.webContents.sendInputEvent({type,x:Math.round(x),y:Math.round(y),button,clickCount:1});
};
const clickRect=async(selector:string):Promise<any>=>{
 if(!inputReady||!win||win.isDestroyed())return null;
 const r=await js<any>(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const q=e.getBoundingClientRect(),x=q.x+q.width/2,y=q.y+q.height/2;return{x:q.x,y:q.y,width:q.width,height:q.height,disabled:!!e.disabled,hidden:!!e.closest('[hidden]'),tag:e.tagName,text:e.innerText??e.value??'',targetAtPoint:document.elementFromPoint(x,y)?.id||document.elementFromPoint(x,y)?.tagName||null,eventStart:window.__f2Events?.length??0}})()`);
 if(!r||r.disabled||r.hidden||r.width<=0||r.height<=0)return r;
 const x=r.x+r.width/2,y=r.y+r.height/2;await inputMouse('mouseMove',x,y);await inputMouse('mouseDown',x,y);await delay(35);await inputMouse('mouseUp',x,y);await delay(130);
 const dispatched=await js<any>(`(()=>window.__f2Events?.slice(${r.eventStart}).filter(e=>e.type==='pointerdown'||e.type==='click').slice(-4)??[])()`);
 return{...r,click:{x,y},dispatched};
};
const clickPoint=async(x:number,y:number):Promise<any>=>{
 if(!inputReady||!win||win.isDestroyed())return null;
 const before=await js<any>(`(()=>{const q=document.elementsFromPoint(${x},${y}).slice(0,6).map(e=>({id:e.id||'',tag:e.tagName,classes:String(e.className||''),pointerEvents:getComputedStyle(e).pointerEvents}));return{eventStart:window.__f2Events?.length??0,stack:q}})()`);
 await inputMouse('mouseMove',x,y);await inputMouse('mouseDown',x,y);await delay(35);await inputMouse('mouseUp',x,y);await delay(100);
 const events=await js<any>(`(()=>window.__f2Events?.slice(${before.eventStart}).filter(e=>e.type==='pointerdown'||e.type==='click').slice(-4)??[])()`);
 return{point:{x,y},stack:before.stack,events};
};
const press=async(keyCode:string,holdMs=0)=>{
 if(!inputReady||!win||win.isDestroyed())return;win.webContents.sendInputEvent({type:'keyDown',keyCode});if(holdMs)await delay(holdMs);win.webContents.sendInputEvent({type:'keyUp',keyCode});
};
const hold=async(codes:string[],durationMs:number)=>{
 if(!inputReady||!win||win.isDestroyed())return;for(const keyCode of codes)win.webContents.sendInputEvent({type:'keyDown',keyCode});
 try{await delay(durationMs);}finally{for(const keyCode of codes)win.webContents.sendInputEvent({type:'keyUp',keyCode});}
};
const frameCapture=async(label:string)=>{const s=await observe();snapshot(label,s);mark('state-frame',{label,state:s});return s;};
const sideKey=(side:string)=>({N:'W',E:'D',S:'S',W:'A'} as Record<string,string>)[side];
const axisKeys=(dx:number,dy:number)=>[dx< -4?'A':dx>4?'D':null,dy< -4?'W':dy>4?'S':null].filter(Boolean) as string[];
const roomPath=(run:DungeonRun,startId:string,targetId:string,avoidActiveCombat=false):string[]|null=>{
 const previous=new Map<string,string|null>([[startId,null]]),pending=[startId];
 while(pending.length){const id=pending.shift()!;if(id===targetId)break;const current=run.rooms.find(room=>room.id===id);if(!current)continue;
  for(const door of current.doors){const next=run.rooms.find(room=>room.id===door.to);if(!next||previous.has(next.id))continue;if(avoidActiveCombat&&['combat','elite','boss'].includes(next.kind)&&!next.cleared)continue;previous.set(next.id,id);pending.push(next.id);}
 }
 if(!previous.has(targetId))return null;const result:string[]=[];for(let cursor:string|null=targetId;cursor!==null;cursor=previous.get(cursor)??null)result.push(cursor);return result.reverse();
};
const walkPathTo=async(targetId:string,avoidActiveCombat=false):Promise<string[]|null>=>{
 const s=await observe();if(!s?.run)return null;const path=roomPath(shell!.dungeon.state.run!,s.run.currentRoom,targetId,avoidActiveCombat);if(!path)return null;
 for(const id of path.slice(1))await enterRoom(id);return path;
};
const walkToSafeKind=async(kind:string):Promise<{path:string[];roomId:string}|null>=>{
 const run=shell?.dungeon.state.run;if(!run)return null;const candidates=run.rooms.filter(room=>room.kind===kind).map(room=>({room,path:roomPath(run,run.currentRoom,room.id,true)})).filter((value):value is {room:RoomState;path:string[]}=>!!value.path).sort((a,b)=>a.path.length-b.path.length||a.room.id.localeCompare(b.room.id));
 if(!candidates.length)return null;const chosen=candidates[0];for(const id of chosen.path.slice(1))await enterRoom(id);return{path:chosen.path,roomId:chosen.room.id};
};
const moveToInteraction=async(interactionId:string,tolerance=32):Promise<any>=>{
 const run=shell?.dungeon.state.run;if(!run)return null;const target=nearbyInteractions(run).find(value=>value.id===interactionId)?.position??roomFixtures(run).find(value=>value.id===interactionId);
 if(!target)return{interactionId,missing:true};const move=await moveNear(target.x,target.y,tolerance);return{interactionId,target,move};
};
const moveNear=async(x:number,y:number,tolerance=24,timeoutMs=8000):Promise<any>=>{
 const before=await observe();if(!before?.run)throw Error('No run while positioning');const dx=x-before.run.player.x,dy=y-before.run.player.y;
 if(Math.hypot(dx,dy)<=tolerance)return{before:{x:before.run.player.x,y:before.run.player.y},after:{x:before.run.player.x,y:before.run.player.y},keys:[],durationMs:0};
 const codes=axisKeys(dx,dy);for(const c of codes)win!.webContents.sendInputEvent({type:'keyDown',keyCode:c});
 const end=Date.now()+timeoutMs;let last=before;
 try{while(Date.now()<end){await delay(60);last=await observe();if(!last?.run||last.run.currentRoom!==before.run.currentRoom)break;if(Math.hypot(x-last.run.player.x,y-last.run.player.y)<=tolerance)break;}}
 finally{for(const c of codes)win!.webContents.sendInputEvent({type:'keyUp',keyCode:c});}
 return{before:{x:before.run.player.x,y:before.run.player.y},after:last?.run?.player?{x:last.run.player.x,y:last.run.player.y}:null,keys:codes,durationMs:Date.now()-end+timeoutMs};
};
const enterRoom=async(targetId:string):Promise<any>=>{
 const before=await observe();const run=before?.run;if(!run)throw Error('No active run');const room=run.rooms.find((r:any)=>r.id===run.currentRoom);const door=roomDoors(shell!.dungeon.state.run!).find((d:any)=>d.to===targetId);
 if(!door)throw Error(`No connecting door from ${room?.id} to ${targetId}`);
 const trigger=doorTriggerRect(room,door.side);const target=door.side==='N'?{x:door.x,y:trigger.y+trigger.height-3}:door.side==='S'?{x:door.x,y:trigger.y+3}:door.side==='E'?{x:trigger.x+3,y:door.y}:{x:trigger.x+trigger.width-3,y:door.y};
 const alignment=await moveNear(target.x,target.y,18);
 const code=sideKey(door.side);win!.webContents.sendInputEvent({type:'keyDown',keyCode:code});const end=Date.now()+6000;let after=await observe();
 try{while(Date.now()<end){await delay(50);after=await observe();if(after?.run?.currentRoom===targetId)break;}}
 finally{win!.webContents.sendInputEvent({type:'keyUp',keyCode:code});}
 mark('door-traverse',{from:run.currentRoom,to:targetId,side:door.side,alignment,after:after?.run?{currentRoom:after.run.currentRoom,player:after.run.player}:null});
 if(after?.run?.currentRoom!==targetId)throw Error(`Failed to enter ${targetId}; got ${after?.run?.currentRoom}`);
 await delay(120);return await observe();
};
const doorEvidence=async(targetId:string):Promise<any>=>{
 const run=shell?.dungeon.state.run;if(!run)return null;const source=run.rooms.find(room=>room.id===run.currentRoom);const door=roomDoors(run).find(value=>value.to===targetId);if(!door||!source)return null;const trigger=doorTriggerRect(source,door.side);
 const screen=await js<any>(`(()=>{const p=window.dungeonProbe,c=p.camera,r=document.querySelector('#dungeonWorld canvas').getBoundingClientRect(),q=c.worldToScreen({x:${door.x},y:${door.y}});return{x:q.x+r.x,y:q.y+r.y,canvas:r.toJSON()}})()`);
 return{door,triggerRect:trigger,screen};
};
const interactionEvidence=async(interactionId:string):Promise<any>=>{
 const run=shell?.dungeon.state.run;if(!run)return null;const interaction=nearbyInteractions(run).find(value=>value.id===interactionId);if(!interaction?.position)return{interaction};
 const state=await observe(),screen=await js<any>(`(()=>{const p=window.dungeonProbe,c=p.camera,r=document.querySelector('#dungeonWorld canvas').getBoundingClientRect(),q=c.worldToScreen({x:${interaction.position.x},y:${interaction.position.y}}),e=document.getElementById('worldPrompt'),b=e?.getBoundingClientRect();return{point:{x:q.x+r.x,y:q.y+r.y},canvas:r.toJSON(),zoom:c.zoom,prompt:e?{hidden:e.hidden,text:e.textContent,rect:b?.toJSON()??null}:null}})()`);
 const rect=screen?.prompt?.rect,expectedTop=screen?.point?.y-30*screen?.zoom;
 const anchorError=rect?Math.max(Math.abs(rect.x+rect.width/2-screen.point.x),Math.abs(rect.y+rect.height-expectedTop)):null;
 return{interaction,screenPoint:screen?.point,expectedPromptAnchor:{x:screen?.point?.x,y:expectedTop},prompt:screen?.prompt,anchorError};
};
const noErrors=(label:string)=>record(label,'No renderer JS console error, failed load, or crashed renderer',errors,errors.length===0);

const auditReadableSurface=(label:string,state:any,settingsOpen=false):void=>{
 const fonts=state?.textAudit?.fonts??{},primary=[fonts.health,fonts.shield,fonts.room,fonts.weapon,fonts.notice,fonts.worldPrompt].filter((value:any)=>Number.isFinite(value));
 const minPrimary=primary.length?Math.min(...primary):null,visible=state?.textAudit?.visibleNonWhitespace??Infinity,panelVisible=Boolean(state?.panel&&!state.panel.hidden),visibleLimit=settingsOpen?420:panelVisible?520:240;
 const settingsOk=!settingsOpen||(fonts.settings>=15&&fonts.settingsTitle>=15&&fonts.guideSummary>=16&&fonts.guideBody>=15);
 const panelFonts=[fonts.panelTitle,fonts.panelBody,fonts.panelButton].filter((value:any)=>Number.isFinite(value)),panelOk=!panelVisible||!panelFonts.length||Math.min(...panelFonts)>=14;
 record(label,'Compact screen ≤240 non-whitespace visible characters (larger expanded panels ≤420/520); primary combat/location text ≥14px; visible panel text ≥14px; settings/guide text ≥15px (summary ≥16px)',{visibleNonWhitespace:visible,visibleLimit,visibleText:state?.textAudit?.visibleText,primaryFonts:{health:fonts.health,shield:fonts.shield,room:fonts.room,weapon:fonts.weapon,notice:fonts.notice,worldPrompt:fonts.worldPrompt},minimumPrimaryFont:minPrimary,panelVisible,panelFonts:{title:fonts.panelTitle,body:fonts.panelBody,button:fonts.panelButton},settingsFonts:{panel:fonts.settings,title:fonts.settingsTitle,guideSummary:fonts.guideSummary,guideBody:fonts.guideBody}},visible<=visibleLimit&&minPrimary!==null&&minPrimary>=14&&settingsOk&&panelOk);
};

async function exerciseSettingsAndZoom():Promise<void>{
 let s=await observe();
 const open=await clickRect('#settingsDungeon');
 s=await until(()=>observe(),v=>Boolean(v?.settings&&!v.settings.hidden&&v.settings.expanded==='true'&&v.run?.paused),'open settings gear and pause active run');
 const pausedTick=s.run.tick;await delay(240);const frozen=await observe();
 record('settings-open-pauses-and-freezes','Opening the settings gear pauses an active run, clears controls and holds the simulation tick',{gear:open,paused:{tick:pausedTick,phase:s.run.phase,keys:s.keys,buttons:s.buttons},afterWait:{tick:frozen.run?.tick,paused:frozen.run?.paused}},Boolean(open&&frozen.run?.paused&&frozen.run.tick===pausedTick&&!frozen.keys?.length&&!frozen.buttons));
 const settingsRect=s.settings.rect,blankPoint={x:settingsRect.x+Math.min(settingsRect.width-12,settingsRect.width*.32),y:settingsRect.y+settingsRect.height-10};
 const blankHit=await clickPoint(blankPoint.x,blankPoint.y),blankPointer=blankHit?.events?.find((event:any)=>event.type==='pointerdown');
 record('settings-panel-background-intercepts-mouse','A click in blank settings-panel padding targets the panel instead of passing through to the dungeon canvas',{pointerEvents:s.settings.pointerEvents,rect:settingsRect,point:blankPoint,stack:blankHit?.stack,pointerdown:blankPointer},Boolean(s.settings.pointerEvents==='auto'&&blankPointer?.insideSettings&&!blankPointer?.onCanvas));
 const guideClick=await clickRect('#dungeonSettings .d-guide-book summary');const withGuide=await observe();
 const guideEvent=guideClick?.dispatched?.find((event:any)=>event.type==='pointerdown');
 record('settings-guide-opens-from-mouse','The collapsed operation guide expands from a native mouse click on its summary',{click:guideClick,guideOpen:withGuide.settings?.guideOpen,guideEvent,guideBodyFont:withGuide.textAudit?.fonts?.guideBody,guideBodyText:withGuide.settings?.guideText},Boolean(guideClick&&guideEvent?.insideSettings&&!guideEvent?.onCanvas&&withGuide.settings?.guideOpen));
 auditReadableSurface('settings-and-guide-text-density',withGuide,true);
 const gearClose=await clickRect('#settingsDungeon');
 let afterGear=await until(()=>observe(),v=>Boolean(v?.settings?.hidden&&v.run&&!v.run.paused),'close settings with same gear and resume run');
 await delay(100);afterGear=await observe();
 record('gear-closes-and-restores-run','Clicking the same gear closes settings and resumes the state that was running before opening',{click:gearClose,settings:afterGear.settings,run:{phase:afterGear.run?.phase,paused:afterGear.run?.paused,tick:afterGear.run?.tick},settingsBeforeTick:pausedTick},Boolean(gearClose&&afterGear.settings?.hidden&&afterGear.run&&!afterGear.run.paused&&afterGear.run.tick>pausedTick));

 const reopen=await clickRect('#settingsDungeon');
 const reopened=await until(()=>observe(),v=>Boolean(v?.settings&&!v.settings.hidden&&v.settings.expanded==='true'&&v.run?.paused),'reopen settings for native zoom input');
 const rangeClick=await clickRect('#dungeonZoom');await press('HOME');for(let i=0;i<5;i++)await press('RIGHT');await delay(170);let z1=await observe();
 const zoom1Capture=await capture(`${scenario}-zoom-1.png`);if(zoom1Capture)report.screenshots.push(zoom1Capture);snapshot('settings-native-zoom-1',z1);
 await press('END');await delay(170);let z2=await observe();
 const zoom2Capture=await capture(`${scenario}-zoom-2.png`);if(zoom2Capture)report.screenshots.push(zoom2Capture);snapshot('settings-native-zoom-2',z2);
 const ratio=z1.visibleTiles/z2.visibleTiles,hudDelta=Math.max(Math.abs(z1.hud.width-z2.hud.width),Math.abs(z1.hud.height-z2.hud.height));
 record('settings-native-range-zoom-1-vs-2','The settings range Home+Right×5 selects 1.00; End selects 2.00; world scale doubles while HUD size remains fixed',{reopen,rangeClick,zoom1:{value:z1.range?.value,zoom:z1.zoom,visibleTiles:z1.visibleTiles,tileScreenSize:z1.tileScreenSize,hud:z1.hud},zoom2:{value:z2.range?.value,zoom:z2.zoom,visibleTiles:z2.visibleTiles,tileScreenSize:z2.tileScreenSize,hud:z2.hud},visibleWidthRatio:ratio,hudMaxDelta:hudDelta},Boolean(reopen&&rangeClick?.dispatched?.some((event:any)=>event.type==='pointerdown'&&event.targetId==='dungeonZoom')&&Math.abs(z1.range?.value-1)<.011&&Math.abs(z1.zoom-1)<.011&&Math.abs(z2.range?.value-2)<.011&&Math.abs(z2.zoom-2)<.011&&Math.abs(ratio-2)<.08&&Math.abs(z2.tileScreenSize/z1.tileScreenSize-2)<.08&&hudDelta<.5));
 const resetRange=await clickRect('#dungeonZoom');await press('HOME');for(let i=0;i<15;i++)await press('RIGHT');await delay(100);const resetZoom=await observe();
 record('settings-zoom-restored-to-default','After comparing exact 1.00 and 2.00 zoom, restore the 1.50 default before world traversal',{resetRange,range:resetZoom.range,zoom:resetZoom.zoom},Boolean(resetRange&&Math.abs(resetZoom.range?.value-1.5)<.011&&Math.abs(resetZoom.zoom-1.5)<.011));
 const escClose=await press('ESC');
 let afterEsc=await until(()=>observe(),v=>Boolean(v?.settings?.hidden&&v.run&&!v.run.paused),'Escape closes settings and restores running state');
 await delay(100);afterEsc=await observe();
 record('escape-closes-and-restores-run','Escape closes the settings panel and resumes the previous active run',{escapeSent:inputReady,settings:afterEsc.settings,run:{phase:afterEsc.run?.phase,paused:afterEsc.run?.paused,tick:afterEsc.run?.tick}},Boolean(inputReady&&afterEsc.settings?.hidden&&afterEsc.run&&!afterEsc.run.paused));
 auditReadableSurface('compact-active-hud-text',afterEsc,false);
 mark('settings-redesign-check',{panelPointerEvents:s.settings.pointerEvents,blankHit,guideClick,gearClose,reopen,rangeClick,resetRange,escClose,zoom:{one:z1.range?.value,two:z2.range?.value,restored:resetZoom.range?.value},afterEsc:{settings:afterEsc.settings,run:afterEsc.run?{paused:afterEsc.run.paused,tick:afterEsc.run.tick}:null}});
}

function writeFixture(mode:string,folder:string):unknown{
 const seed=3,run=createDungeon(seed);
 const roomId=mode==='fixture-chest-replacement'?'treasure':mode==='fixture-combat'?'battle-a':mode==='fixture-upgrade-reforge'?'altar':mode==='fixture-boss'?'boss':'';
 const room=run.rooms.find(r=>r.id===roomId);if(!room)throw Error(`fixture room ${roomId} missing`);
 for(const candidate of run.rooms)candidate.visited=false;
 const entrance=run.rooms.find(candidate=>candidate.kind==='entrance');if(!entrance)throw Error('fixture dungeon has no entrance');
 const previous=new Map<string,string|null>([[entrance.id,null]]),pending=[entrance.id];
 while(pending.length){const id=pending.shift()!;const current=run.rooms.find(candidate=>candidate.id===id)!;for(const door of current.doors)if(!previous.has(door.to)){previous.set(door.to,current.id);pending.push(door.to);}}
 if(!previous.has(room.id))throw Error(`fixture room ${room.id} is unreachable from entrance`);
 const pathIds:string[]=[];for(let cursor:string|null=room.id;cursor!==null;cursor=previous.get(cursor)??null){pathIds.push(cursor);const visited=run.rooms.find(candidate=>candidate.id===cursor);if(visited)visited.visited=true;}
 pathIds.reverse();
 // Any combat node used only to connect the fixture to the entrance is marked
 // as a valid previously cleared room. This keeps schema-v2 visited reachability
 // legal without pretending the current-room interaction occurred naturally.
 const priorCombats:string[]=[];
 for(const id of pathIds){const prior=run.rooms.find(candidate=>candidate.id===id)!;if(prior.id===room.id||!['combat','elite','boss'].includes(prior.kind))continue;
  prior.encounterStarted=true;prior.wave=prior.totalWaves;prior.cleared=true;prior.locked=false;prior.nextWaveAt=0;prior.enemies=[];prior.visited=true;priorCombats.push(prior.id);
 }
 run.currentRoom=room.id;run.phase='exploring';run.paused=true;run.tick=0;run.elapsedMs=0;run.reward={coins:0,xp:0};
 const interactionFixture=roomFixtures(run).find(value=>value.kind==='chest'||value.kind==='altar');
 const combatSpawn=mode==='fixture-combat'?(()=>{const cx=room.width/2,cy=room.height/2,candidates=[{x:cx,y:cy}];for(let radius=24;radius<=192;radius+=24)for(let dx=-radius;dx<=radius;dx+=24)for(const dy of [-radius,radius])candidates.push({x:cx+dx,y:cy+dy});for(let dy=-168;dy<=168;dy+=24)for(const dx of [-192,192])candidates.push({x:cx+dx,y:cy+dy});const walkable=(p:{x:number;y:number})=>p.x>=28&&p.x<=room.width-28&&p.y>=28&&p.y<=room.height-28&&!room.obstacles.some(o=>o.hp>0&&p.x+12>o.x&&p.x-12<o.x+o.width&&p.y+12>o.y&&p.y-12<o.y+o.height);return candidates.find(walkable)??null;})():null;
 const startPosition=interactionFixture?{x:interactionFixture.x,y:interactionFixture.y,kind:interactionFixture.kind,id:interactionFixture.id}:combatSpawn?{...combatSpawn,kind:'walkable-combat-center'}:{x:room.width/2,y:room.height/2,kind:'room-center'};
 run.player.x=startPosition.x;run.player.y=startPosition.y;run.player.aimX=run.player.x+100;run.player.aimY=run.player.y;run.player.moveX=0;run.player.moveY=0;run.player.firing=false;room.visited=true;
 if(mode==='fixture-chest-replacement'){
  room.chestOpened=false;room.ground=[];run.player.weaponSlots[0]={id:'fixture-active-sword',kind:'sword',level:1,evolved:false,form:'base' as const};run.player.weaponSlots[1]={id:'fixture-backup-boomerang',kind:'boomerang',level:2,evolved:false,form:'base' as const};run.player.activeSlot=0;
 }
 if(mode==='fixture-combat'){
  run.player.maxHp=10000;run.player.hp=10000;run.player.maxShield=10000;run.player.shield=10000;run.player.weaponSlots[0]={id:'fixture-fire',kind:'fire',level:5,evolved:false,form:'base' as const};run.player.weaponSlots[1]=null;run.player.activeSlot=0;
  run.player.attackReady=0;run.player.skillReady=0;run.player.aimX=run.player.x+100;run.player.aimY=run.player.y;
  room.encounterStarted=true;room.wave=1;room.totalWaves=2;room.locked=true;room.cleared=false;room.nextWaveAt=0;room.enemies=[];
  const points:{x:number;y:number}[]=[];const candidates=[];
  for(let x=run.player.x+36;x<=Math.min(room.width-44,run.player.x+180);x+=24)for(let y=run.player.y-72;y<=run.player.y+72;y+=24)candidates.push({x,y});
  const blocked=(p:{x:number;y:number},radius:number)=>room.obstacles.some(o=>o.hp>0&&p.x+radius>o.x&&p.x-radius<o.x+o.width&&p.y+radius>o.y&&p.y-radius<o.y+o.height);
  for(const p of candidates){if(p.y<36||p.y>room.height-36||blocked(p,12)||points.some(q=>Math.hypot(q.x-p.x,q.y-p.y)<28))continue;points.push(p);if(points.length===3)break;}
  if(points.length!==3)throw Error('could not place three valid wave-one fixture enemies');
  room.enemies=points.map((p,i)=>({id:`fixture-enemy-${i+1}`,kind:(['chaser','shooter','charger'] as const)[i],x:p.x,y:p.y,hp:1,maxHp:1,radius:12,state:'idle' as const,stateUntil:0,attackReady:100000,aimX:0,aimY:1,burnUntil:0,frost:0,frozenUntil:0,bossPhase:0,pattern:'none' as const}));
 }
 if(mode==='fixture-upgrade-reforge'){
  room.cleared=true;room.altarUsed=false;run.phase='upgrade';run.level=1;run.reward.xp=18;run.essence=0;run.reforgesLeft=1;
  run.player.weaponSlots[0]={id:'fixture-fire',kind:'fire',level:4,evolved:false,form:'base' as const};run.player.weaponSlots[1]={id:'fixture-boomerang',kind:'boomerang',level:1,evolved:false,form:'base' as const};run.player.activeSlot=0;
  run.player.traits=['cinder-burst','deep-freeze'];run.player.runes=['fire'];run.choices=eligibleUpgrades(run);
 }
 if(mode==='fixture-boss'){
  run.player.x=room.width/2;run.player.y=room.height/2+120;run.player.maxHp=100;run.player.hp=100;run.player.maxShield=40;run.player.shield=40;run.player.weaponSlots[0]={id:'fixture-boss-sword',kind:'sword',level:1,evolved:false,form:'base' as const};run.player.weaponSlots[1]=null;run.player.activeSlot=0;
  room.encounterStarted=true;room.wave=1;room.totalWaves=1;room.locked=true;room.cleared=false;room.nextWaveAt=0;
  room.enemies=[{id:'fixture-boss',kind:'boss',bossPhase:1,pattern:'none',x:room.width/2,y:room.height/2,hp:500,maxHp:1100,radius:22,state:'idle',stateUntil:0,attackReady:0,aimX:0,aimY:1,burnUntil:0,frost:0,frozenUntil:0}];
 }
 const parsed=parseDungeonRun(run);if(!parsed)throw Error(`fixture ${mode} rejected by parseDungeonRun`);
 const store=new DungeonStore(folder);store.save({...store.value,claim:1,settled:false,run:parsed,receipt:null});
  return{source:'DungeonStore.save before DesktopShell startup; explicit valid schema-v2 isolated-profile fixture; not natural progression',mode,seed,roomId,pathIds,parentRoomId:pathIds.length>1?pathIds.at(-2):null,priorCombatsMarkedCleared:priorCombats,interactionFixture,startPosition,playerStartsAtInteractionFixture:interactionFixture?run.player.x===interactionFixture.x&&run.player.y===interactionFixture.y:null,combatSpawnWalkable:mode==='fixture-combat'?!!combatSpawn:null,runAcceptedByParser:!!parseDungeonRun(parsed),adjustments:mode==='fixture-combat'?{playerHp:10000,shield:10000,weapon:'fire Lv5',wave1FixtureEnemies:3,eachHp:1,secondWaveUsesProductionSpawn:true,entrySpawn:startPosition}:mode==='fixture-upgrade-reforge'?{altarClearedTestPrecondition:true,xp:18,activeWeapon:'fire Lv4',fireRunePresent:true,traits:['cinder-burst','deep-freeze'],essence:0}:mode==='fixture-boss'?{bossHp:500,maxHp:1100,startsPhase:1,attackReady:0}:mode==='fixture-chest-replacement'?{activeSlot:'sword',backupSlot:'boomerang',chestUnopened:true}:null};
}

const report:any={schema:'pixelstreet.dungeon-040.F2F3-renderer-luna.case.v1',candidate:'PixelStreet-0.4.0',scenario,startedAt,profile:{path:profile,markerPath,markerExpected:'{"product":"PixelStreet","kind":"isolated-playtest","version":1}\n',userData:'',sessionData:'',realProfileOpened:false},hashes:{},fixture:null,runtime:{},checks,events,screenshots:[],frameObservations:frames,inputEvents:[],rendererErrors:errors,limitations:[
 'Electron WebContents.sendInputEvent is scripted native-window input; it is not physical keyboard or mouse evidence.',
 'BrowserWindow.webContents.capturePage records renderer pixels, not macOS compositor output or physical display scanout.',
 'Safe-room and combat fixture sessions are valid isolated DungeonStore saves written before startup; they do not prove natural room progression or game balance.'
]};

async function main():Promise<void>{
 try{
  const appData=app.getPath('appData');markIsolatedFolder(profile,appData);configureDataPaths(app,appData,profile);
  const expectedMarker='{"product":"PixelStreet","kind":"isolated-playtest","version":1}\n';
  if(scenario.startsWith('fixture-'))report.fixture=writeFixture(scenario,path.join(profile,'solo'));
  report.profile.userData=app.getPath('userData');report.profile.sessionData=app.getPath('sessionData');
  record('strict-isolated-profile',`userData=${profile}; sessionData=${path.join(profile,'session')}; exact marker`,{profileRealpath:fs.realpathSync(profile),marker:fs.readFileSync(markerPath,'utf8'),userData:report.profile.userData,sessionData:report.profile.sessionData,fixture:report.fixture},fs.realpathSync(profile)===profile&&report.profile.userData===profile&&report.profile.sessionData===path.join(profile,'session')&&fs.readFileSync(markerPath,'utf8')===expectedMarker&&profile.startsWith(fs.realpathSync(os.tmpdir())+path.sep));
  const rendererChunkFiles=fs.readdirSync(path.join(root,'dist/renderer/chunks')).filter(file=>/^dungeon-.*\.js$/.test(file)).map(file=>`dist/renderer/chunks/${file}`);
  const relevant=['apps/desktop/renderer/dungeon.ts','apps/desktop/renderer/dungeon.css','packages/dungeon-core/index.ts','packages/dungeon-core/map.ts','packages/dungeon-core/types.ts','apps/desktop/dungeon-store.ts','apps/desktop/dungeon-runtime.ts','apps/desktop/shell.ts','dist/main.cjs','dist/dungeon-worker.cjs','dist/renderer/main.js',...rendererChunkFiles,'dist/renderer/dungeon.css','assets/dungeon/manifest.json','assets/dungeon/sprites.svg','assets/action/manifest.json','assets/action/sprites.svg'];
  report.hashes=Object.fromEntries(relevant.filter(file=>fs.existsSync(path.join(root,file))).map(file=>[file,sha(file)]));
  app.on('web-contents-created',(_event,wc)=>{
   wc.on('console-message',(...args:any[])=>{const d=args[0]??{},level=d.level??args[1],message=d.message??args[2]??'';if(level==='error'||level===3||typeof level==='number'&&level>=3)errors.push({kind:'console-error',detail:`${message} (${d.sourceId??args[4]??''}:${d.lineNumber??args[3]??''})`});});
   wc.on('render-process-gone',(_e,d)=>errors.push({kind:'render-process-gone',detail:JSON.stringify(d)}));
   wc.on('did-fail-load',(_e,c,d,u)=>errors.push({kind:'did-fail-load',detail:`${c} ${d} ${u}`}));
  });
  shell=await startDesktop(profile,true);shell.openArena();
  await until(()=>Boolean(shell?.arenaWindow&&!shell.arenaWindow.isDestroyed()&&!shell.arenaWindow.webContents.isLoadingMainFrame()),Boolean,'native arena main frame',18000);
  win=shell.arenaWindow!;await until(()=>js<boolean>(`document.body.dataset.dungeonReady==='true'`),Boolean,'dungeon renderer ready',25000);
  const displays=screen.getAllDisplays().map(d=>({id:d.id,bounds:d.bounds,workArea:d.workArea,scaleFactor:d.scaleFactor,displayFrequency:d.displayFrequency})).sort((a,b)=>b.displayFrequency-a.displayFrequency);
  const requestedDisplay=displays[0]??null;
  if(requestedDisplay){const b=win.getBounds();win.setBounds({x:requestedDisplay.bounds.x+Math.round((requestedDisplay.bounds.width-b.width)/2),y:requestedDisplay.bounds.y+Math.round((requestedDisplay.bounds.height-b.height)/2),width:b.width,height:b.height});await delay(180);}
  const focusWaitStarted=Date.now(),focusDeadline=focusWaitStarted+2500;let first=await observe();
  while(Date.now()<focusDeadline&&!(win.isVisible()&&win.isFocused()&&first?.documentFocus&&first.visibility==='visible')){await delay(100);first=await observe();}
  const focusWaitMs=Date.now()-focusWaitStarted,productDefaultState=first,productDefaultInputReady=Boolean(win.isVisible()&&win.isFocused()&&first?.documentFocus&&first.visibility==='visible');inputReady=productDefaultInputReady;
  let qaFocusRecovery:any=null;
  if(!productDefaultInputReady){const before={nativeFocused:win.isFocused(),documentFocused:first?.documentFocus,visible:win.isVisible(),minimized:win.isMinimized(),ready:first?.ready};app.focus({steal:true});win.focus();const qaDeadline=Date.now()+2500;let qaState=first;while(Date.now()<qaDeadline&&!(win.isVisible()&&win.isFocused()&&qaState?.documentFocus&&qaState.visibility==='visible')){await delay(100);qaState=await observe();}qaFocusRecovery={explicitlyRequested:true,methods:['app.focus({steal:true})','BrowserWindow.focus()'],before,after:{nativeFocused:win.isFocused(),documentFocused:qaState?.documentFocus,visible:win.isVisible(),visibility:qaState?.visibility},waitMs:Date.now()-(qaDeadline-2500),ready:Boolean(win.isVisible()&&win.isFocused()&&qaState?.documentFocus&&qaState.visibility==='visible')};inputReady=qaFocusRecovery.ready;if(inputReady)first=qaState;}
  const display=screen.getDisplayMatching(win.getBounds());report.runtime={electron:process.versions.electron,chrome:process.versions.chrome,node:process.versions.node,platform:process.platform,arch:process.arch,windowId:win.id,bounds:win.getBounds(),visible:win.isVisible(),focused:win.isFocused(),display:{id:display.id,bounds:display.bounds,scaleFactor:display.scaleFactor,displayFrequency:display.displayFrequency},requestedHighestDisplay:requestedDisplay,availableDisplays:displays,rendererPid:win.webContents.getOSProcessId(),inputReady,focusWaitMs,productDefaultInputReady,productDefaultFocusObservations:{nativeFocused:qaFocusRecovery?.before.nativeFocused??win.isFocused(),documentFocused:productDefaultInputReady?productDefaultState?.documentFocus:qaFocusRecovery?.before.documentFocused,visible:productDefaultInputReady?productDefaultState?.visibility:qaFocusRecovery?.before.visible,ready:productDefaultState?.ready},qaFocusRecovery};
  await js(`(()=>{window.__f2Events=[];for(const type of ['keydown','keyup','pointerdown','pointerup','pointermove','focus','blur','visibilitychange'])window.addEventListener(type,e=>{if(window.__f2Events.length<1200){const target=e.target instanceof Element?e.target:null;window.__f2Events.push({type,at:performance.now(),code:e.code||'',key:e.key||'',button:e.button,buttons:e.buttons,clientX:e.clientX,clientY:e.clientY,isTrusted:e.isTrusted,repeat:e.repeat,hasFocus:document.hasFocus(),targetId:target?.id||'',targetTag:target?.tagName||'',insideSettings:!!target?.closest('#dungeonSettings'),onCanvas:target===document.querySelector('#dungeonWorld canvas')})}},true)})()`);
  record('renderer-window-focused-once','Product openArena produces visible/focused window and document focus without test focus injection',{visible:qaFocusRecovery?.before.visible??win.isVisible(),nativeFocused:qaFocusRecovery?.before.nativeFocused??win.isFocused(),documentFocused:qaFocusRecovery?.before.documentFocused??productDefaultState?.documentFocus,ready:productDefaultState?.ready,waitMs:focusWaitMs,inputReady:productDefaultInputReady},productDefaultInputReady);
  if(qaFocusRecovery)record('qa-explicit-focus-recovery','Only after preserving the failed default-focus observation, issue one explicit app/window focus request and verify native/document focus through real state',{productDefaultInputReady,qaFocusRecovery},Boolean(qaFocusRecovery.ready));
  const initialCapture=await capture(`${scenario}-initial.png`);if(initialCapture)report.screenshots.push(initialCapture);snapshot('initial',first);
  record('real-pixi-renderer-ready','dungeonProbe, canvas, UI and current renderer build are present',{ready:first?.ready,canvas:first?.canvas,zoom:first?.zoom,hud:first?.hud,resolution:first?.rendererResolution,ticker:first?.tickerStarted},Boolean(first?.ready==='true'&&first.canvas&&first.hud));
  record('settings-guide-and-metrics-default-collapsed','Settings start hidden, guide closed, performance metrics off, and zoom at the configured 1.50 default',{settings:first?.settings,range:first?.range,frameTextHidden:first?.settings?.metricsHidden},Boolean(first?.settings?.hidden&&first.settings.expanded!=='true'&&first.settings.guideOpen===false&&first.settings.metricsChecked===false&&first.settings.metricsHidden===true&&Math.abs(first?.range?.value-1.5)<.011&&Math.abs(first?.range?.min-.75)<.001&&Math.abs(first?.range?.max-2)<.001&&Math.abs(first?.range?.step-.05)<.001));

  if(!inputReady){record('scenario-input','Native scripted input gated by confirmed focused isolated window','skipped: product openArena did not establish native and document focus',undefined);}
  else if(scenario==='natural')await naturalScenario();
  else await fixtureScenario();

  record('renderer-has-no-console-or-load-errors','No renderer JS console error, navigation failure, or crash',errors,errors.length===0);
 }catch(error){errors.push({kind:'harness-error',detail:String(error)});mark('harness-error',{error:String(error),stack:(error as Error)?.stack});}
 finally{
  try{report.inputEvents=await js<any>(`window.__f2Events??[]`);}catch{report.inputEvents=[];}
  try{if(shell?.arenaWindow&&!shell.arenaWindow.isDestroyed())shell.closeArena();}catch{}
  report.endedAt=new Date().toISOString();report.checks=checks;report.errors=errors;report.events=events;report.frameObservations=frames;
  report.overall=errors.length||checks.some(c=>c.status==='fail')?'FAIL':!checks.length||checks.some(c=>c.status==='not-run')?'PARTIAL':'PASS_WITH_SCRIPTED_INPUT_LIMITS';
  const file=path.join(evidenceDir,'raw',`${scenario}.json`);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');
  fs.writeFileSync(path.join(rawDir,`${scenario}.json`),JSON.stringify({scenario,startedAt,endedAt:report.endedAt,frames,events:events.filter(e=>e.kind==='state-frame'),inputEvents:report.inputEvents,limitations:report.limitations},null,2)+'\n');
  console.log(JSON.stringify({scenario,overall:report.overall,profile,checks:checks.map(c=>({name:c.name,status:c.status})),errors,report:path.relative(root,file)},null,2));
  app.quit();
 }
}

async function naturalScenario():Promise<void>{
 const publicStart=await clickRect('[data-command="start"]');
 await until(()=>Boolean(shell?.dungeon.state.run&&!shell.dungeon.state.run.paused&&shell.dungeon.state.run.phase==='exploring'),Boolean,'production createDungeon run from public start button',15000);
 await exerciseSettingsAndZoom();
 let s=await frameCapture('natural-start');const entrance=s.run?.rooms.find((r:any)=>r.id==='entrance');
 record('public-start-creates-production-entrance','The visible start button produces a normal createDungeon run in the entrance with no preseeded run',{button:publicStart,seed:s.run?.seed,currentRoom:s.run?.currentRoom,entrance:entrance?{visited:entrance.visited,kind:entrance.kind,doors:entrance.doors}:null,fixture:null},Boolean(publicStart&&s.run?.currentRoom==='entrance'&&entrance?.visited&&entrance.kind==='entrance'));
 const entranceImage=await capture('natural-entrance.png');if(entranceImage)report.screenshots.push(entranceImage);
 const entryDoor=await doorEvidence('crossroads');const entryRoomText=s.ui?.roomText;
 record('production-door-coordinate-and-entry-indicator','Door coordinate comes from the live room model; the room HUD identifies the entrance state',{entryDoor,roomText:entryRoomText},Boolean(entryDoor&&entryDoor.door.side&&Math.abs(entryDoor.door.x-(entryDoor.door.side==='W'?24:entryDoor.door.side==='E'?entrance.width-24:entrance.width/2))<.01&&Math.abs(entryDoor.door.y-(entryDoor.door.side==='N'?24:entryDoor.door.side==='S'?entrance.height-24:entrance.height/2))<.01&&String(entryRoomText).includes('传送厅')));
 const entrancePath=await walkPathTo('crossroads');s=await observe();
 const visited=s.run.rooms.filter((r:any)=>r.visited);const map=s.map;const unvisited=s.run.rooms.filter((r:any)=>!r.visited).map((r:any)=>r.id);const leaked=unvisited.filter((id:string)=>String(map?.svg).includes(id));
 record('native-wasd-entrance-to-crossroads','Native WASD follows the production BFS door route from entrance into crossroads',{currentRoom:s.run.currentRoom,position:s.run.player,route:events.find(e=>e.kind==='door-traverse'),path:entrancePath,keyEvents:s.events.filter((e:any)=>e.type==='keydown'||e.type==='keyup').slice(-8),documentFocus:s.documentFocus},Boolean(s.run.currentRoom==='crossroads'&&s.documentFocus&&entrancePath?.[0]==='entrance'&&entrancePath.at(-1)==='crossroads'));
 record('minimap-discovered-only','Minimap has exactly one room rect per visited room and does not expose undiscovered IDs/content',{visited:visited.map((r:any)=>r.id),rects:map?.rects,circles:map?.circles,paths:map?.paths,labels:map?.text,undiscoveredIdsLeaked:leaked,svg:map?.svg},Boolean(map&&map.rects===visited.length&&leaked.length===0));
 const crossImage=await capture('natural-crossroads-rack.png');if(crossImage)report.screenshots.push(crossImage);snapshot('crossroads-arrival',s);
 const rackFixture=roomFixtures(shell!.dungeon.state.run!).find(value=>value.kind==='event');const rackApproach=rackFixture?await moveToInteraction(rackFixture.id,34):null;s=await observe();const rackOptions=nearbyInteractions(shell!.dungeon.state.run!);const rack=rackOptions.find(v=>v.kind==='event');
 const rackPosition=rack?await interactionEvidence(rack.id):null;
 record('fixture-prompt-aligns-to-rack','At the live crossroads feature coordinate, the renderer shows the F prompt aligned to the model position',{player:s.run.player,room:{id:s.run.currentRoom,kind:s.run.rooms.find((r:any)=>r.id==='crossroads')?.kind},rackFixture,rackApproach,nearby:rack,position:rackPosition,prompt:s.prompt,panel:s.panel},Boolean(rackFixture&&rack&&s.run.currentRoom==='crossroads'&&!s.prompt?.hidden&&String(s.prompt?.text).includes('武器架')&&rackPosition?.anchorError!==null&&rackPosition?.anchorError<2));
 const rackCapture=await capture('natural-rack-prompt.png');if(rackCapture)report.screenshots.push(rackCapture);snapshot('rack-prompt',s);
 await press('F');await until(()=>Boolean(shell?.dungeon.state.run?.rooms.find(r=>r.id==='crossroads')?.eventUsed),Boolean,'F uses weapon rack',5000);
 s=await frameCapture('natural-rack-used');record('F-uses-rack','First F consumes the nearby rack and visibly drops one weapon',{eventUsed:s.run.rooms.find((r:any)=>r.id==='crossroads')?.eventUsed,ground:s.run.rooms.find((r:any)=>r.id==='crossroads')?.ground,notice:s.run.notice},Boolean(s.run.rooms.find((r:any)=>r.id==='crossroads')?.eventUsed&&s.run.rooms.find((r:any)=>r.id==='crossroads')?.ground.length>=1));
 const rackUsedCapture=await capture('natural-rack-used-ground.png');if(rackUsedCapture)report.screenshots.push(rackUsedCapture);
 const dropped=shell!.dungeon.state.run!.rooms.find(r=>r.id==='crossroads')!.ground[0];
 const pickupScreen=await js<any>(`(()=>{const p=window.dungeonProbe,c=p.camera,r=document.querySelector('#dungeonWorld canvas').getBoundingClientRect(),q=c.worldToScreen({x:${dropped.x},y:${dropped.y}});return{x:q.x+r.x,y:q.y+r.y}})()`);
 await inputMouse('mouseMove',pickupScreen.x,pickupScreen.y);await delay(100);s=await observe();const pickupAimError=Math.hypot(s.pointerWorld.x-dropped.x,s.pointerWorld.y-dropped.y);
 record('world-aim-target-matches-ground-pickup','Pointer aim uses the exact live dropped-weapon coordinate at current zoom before the explicit F pickup',{ground:{x:dropped.x,y:dropped.y,id:dropped.id},screen:pickupScreen,pointerWorld:s.pointerWorld,error:pickupAimError,pointerEvents:s.events.filter((e:any)=>e.type==='pointermove').slice(-3)},Boolean(s.events.some((e:any)=>e.type==='pointermove'&&e.isTrusted)&&pickupAimError<1.5));
 await press('F');await until(()=>Boolean(shell?.dungeon.state.run?.player.weaponSlots[1]),Boolean,'second F picks weapon into backup slot',5000);
 s=await frameCapture('natural-picked-up');record('F-picks-ground-weapon','Second F collects the dropped rack weapon into the backup slot',{slots:s.run.player.weaponSlots,ground:s.run.rooms.find((r:any)=>r.id==='crossroads')?.ground,notice:s.run.notice},Boolean(s.run.player.weaponSlots[1]&&s.run.rooms.find((r:any)=>r.id==='crossroads')?.ground.length===0));
 await press('TAB');await delay(180);s=await frameCapture('natural-tab');
 record('tab-switches-collected-weapon','Tab switches to the collected backup weapon and updates the UI',{activeSlot:s.run.player.activeSlot,weapon:s.run.player.weaponSlots[s.run.player.activeSlot],panel:s.panel?.text,backup:s.run.player.weaponSlots[1]},Boolean(s.run.player.activeSlot===1&&s.run.player.weaponSlots[1]));
 const pickupCapture=await capture('natural-tab-loadout.png');if(pickupCapture)report.screenshots.push(pickupCapture);

 // The range test was performed inside the settings panel before gameplay
 // aiming; the panel is collapsed here so native pointer coordinates reach the
 // world canvas rather than a HUD overlay.
 const zoomState=await observe();const canvas=zoomState.canvas;const currentRoom=zoomState.run.rooms.find((r:any)=>r.id===zoomState.run.currentRoom);const target={x:currentRoom.width/2,y:currentRoom.height/2};const screenPoint=await js<any>(`(()=>{const p=window.dungeonProbe,c=p.camera,r=document.querySelector('#dungeonWorld canvas').getBoundingClientRect(),q=c.worldToScreen({x:${target.x},y:${target.y}});return{x:q.x+r.x,y:q.y+r.y,canvas:r.toJSON()}})()`);
 await inputMouse('mouseMove',screenPoint.x,screenPoint.y);await delay(100);s=await observe();
 const mouseError=Math.hypot(s.pointerWorld.x-target.x,s.pointerWorld.y-target.y);
 record('native-pointer-to-world-and-screen-coordinates','A native pointermove over the rack world point is received and camera inverse resolves back to the same coordinates',{target,screenPoint,mouse:s.mouse,pointerWorld:s.pointerWorld,camera:s.camera,mouseError,pointerEvents:s.events.filter((e:any)=>e.type==='pointermove').slice(-3)},Boolean(s.events.some((e:any)=>e.type==='pointermove'&&e.isTrusted)&&mouseError<1.5));

 // Optional facility detours are omitted in the authorized short session.
 if(quickMode)record('natural-facility-detours-not-run','This bounded run focuses on settings, the entrance route, and the weapon pickup','Skipped by the 100-second native play budget',undefined);
 else {
 const springRoute=await walkToSafeKind('rest');
 if(springRoute){let at=await observe();const restFixture=roomFixtures(shell!.dungeon.state.run!).find(value=>value.kind==='rest'),restApproach=restFixture?await moveToInteraction(restFixture.id,34):null;at=await observe();const water=nearbyInteractions(shell!.dungeon.state.run!).find(v=>v.kind==='rest');
  record('natural-spring-room-arrival','A generated rest room is reached by BFS over live connected doors without assuming it directly borders crossroads',{currentRoom:at.run.currentRoom,path:springRoute.path,fixture:false,player:at.run.player,water,restFixture,restApproach},Boolean(at.run.rooms.find((r:any)=>r.id===springRoute.roomId)?.kind==='rest'&&at.run.currentRoom===springRoute.roomId));
  const springShot=await capture('natural-spring-room.png');if(springShot)report.screenshots.push(springShot);const waterPosition=water?await interactionEvidence(water.id):null;record('spring-facility-model-coordinate','The spring prompt is rendered at the live rest fixture coordinate from the current run model',{water,waterFixture:restFixture,waterPosition,prompt:at.prompt},Boolean(water&&waterPosition?.anchorError!==null&&waterPosition?.anchorError<2));
  const merchantRoute=await walkToSafeKind('shop');
  if(merchantRoute){const merchantFixture=roomFixtures(shell!.dungeon.state.run!).find(value=>value.kind==='merchant'),merchantApproach=merchantFixture?await moveToInteraction(merchantFixture.id,34):null;at=await observe();const offers=nearbyInteractions(shell!.dungeon.state.run!).filter(v=>v.kind==='merchant'),offerPosition=offers[0]?await interactionEvidence(offers[0].id):null;record('natural-merchant-room-arrival','A generated merchant room is reached by BFS when a safe path is available; offer prompt follows the live fixture coordinate',{currentRoom:at.run.currentRoom,path:merchantRoute.path,offers,merchantFixture,merchantApproach,offerPosition,panel:at.panel},Boolean(at.run.currentRoom===merchantRoute.roomId&&offers.length>0&&offerPosition?.anchorError!==null&&offerPosition?.anchorError<2));
   const merchantShot=await capture('natural-merchant-room.png');if(merchantShot)report.screenshots.push(merchantShot);
  }else record('natural-merchant-safe-route','Merchant screen is covered only when a BFS route avoids uncleared combat rooms','No safe route from current room; optional natural visit skipped',undefined);
 }else record('natural-rest-safe-route','Rest screen is covered only when a BFS route avoids uncleared combat rooms','No safe route from crossroads; optional natural visit skipped',undefined);
 }
 if(win&&!win.isDestroyed()){
  const before=await observe(),canvas=before?.canvas;
  if(canvas){await inputMouse('mouseMove',canvas.x+canvas.width/2,canvas.y+canvas.height/2);await inputMouse('mouseDown',canvas.x+canvas.width/2,canvas.y+canvas.height/2);win.webContents.sendInputEvent({type:'keyDown',keyCode:'W'});}
  const held=await until(()=>observe(),v=>Boolean(v?.keys?.includes('KeyW')&&v.buttons===1),'scripted movement and attack are held before native minimize',3000).catch(()=>null);
  record('native-minimize-starts-with-input-held','Before native minimize, the renderer has a held movement key and attack button',{held,native:{visible:win.isVisible(),focused:win.isFocused(),minimized:win.isMinimized()}},Boolean(held?.keys?.includes('KeyW')&&held.buttons===1));
  win.minimize();
  const cleared=await until(()=>observe(),v=>Boolean(!v?.focused&&!v?.keys?.length&&!v?.buttons&&v?.run?.paused),'native minimize blurs, clears controls, and pauses the run',5000).catch(()=>observe().catch(()=>null));
  const sawBlur=Boolean(cleared?.events?.some((e:any)=>e.type==='blur'));
  record('native-minimize-clears-input-and-pauses','Native minimize produces a renderer blur, clears held controls, and pauses the dungeon',{renderer:{focused:cleared?.focused,documentFocus:cleared?.documentFocus,keys:cleared?.keys,buttons:cleared?.buttons,runPaused:cleared?.run?.paused},native:{visible:win.isVisible(),focused:win.isFocused(),minimized:win.isMinimized()},sawBlur,blurEvents:cleared?.events?.filter((e:any)=>e.type==='blur').slice(-2)},Boolean(cleared&&!cleared.focused&&!cleared.keys?.length&&!cleared.buttons&&cleared.run?.paused&&win.isMinimized()&&sawBlur));
 }
}

async function fixtureScenario():Promise<void>{
 let s=await observe();const loadedState=s;record('prewritten-v2-fixture-loaded','Schema-v2 fixture is parse-accepted and loaded paused before renderer input',{fixture:report.fixture,run:s.run?{version:s.run.version,room:s.run.currentRoom,paused:s.run.paused,phase:s.run.phase,claim:s.session?.claim,settled:s.session?.settled}:null},Boolean(report.fixture&&report.fixture.runAcceptedByParser&&s.run?.version===2&&s.run.currentRoom===report.fixture.roomId&&s.run.paused&&s.session?.settled===false));
 const fixtureStart=await capture(`${scenario}-paused-fixture.png`);if(fixtureStart)report.screenshots.push(fixtureStart);
 if(s.run?.paused){const resume=await clickRect('[data-command="resume"]');await until(()=>Boolean(shell?.dungeon.state.run&&!shell.dungeon.state.run.paused),Boolean,'resume valid schema-v2 fixture through public UI',5000);record('fixture-resumes-through-public-button','Explicit valid fixture can be resumed through the renderer public control',{button:resume,run:await observe().then(v=>({room:v.run?.currentRoom,phase:v.run?.phase,paused:v.run?.paused}))},Boolean(resume&&!shell!.dungeon.state.run?.paused));}
 s=await observe();
 if(scenario==='fixture-chest-replacement'){
  const beforeRun=shell!.dungeon.state.run!,beforeSlots=beforeRun.player.weaponSlots.map(w=>w&&{...w});const options=nearbyInteractions(beforeRun),chest=options.find(o=>o.kind==='chest');
  const chestPosition=chest?await interactionEvidence(chest.id):null;record('chest-presents-open-action','Chest interaction is visible, enabled and its prompt aligns with the model-derived chest coordinate',{chest,chestPosition,prompt:s.prompt,panel:s.panel,beforeSlots},Boolean(chest&&!chest.disabled&&s.panel?.buttons.some((b:any)=>!b.disabled&&b.id===chest.id)&&chestPosition?.anchorError!==null&&chestPosition?.anchorError<2));
  const before=await capture('chest-replacement-before.png');if(before)report.screenshots.push(before);const open=chest?await clickRect(`[data-interact="${chest.id}"]`):null;
  await until(()=>Boolean(shell?.dungeon.state.run?.rooms.find(r=>r.id==='treasure')?.chestOpened),Boolean,'open live chest via public renderer button',5000);s=await frameCapture('chest-replacement-open');
  const drop=s.run.rooms.find((r:any)=>r.id==='treasure')?.ground?.[0];record('chest-explicitly-drops-pickup','Opening chest visibly replaces the unopened prop state with one ground weapon; no automatic inventory grant',{open,chestOpened:s.run.rooms.find((r:any)=>r.id==='treasure')?.chestOpened,drop,slots:s.run.player.weaponSlots},Boolean(s.run.rooms.find((r:any)=>r.id==='treasure')?.chestOpened&&drop?.weaponId==='weapon-treasure-chest'&&s.run.player.weaponSlots[0]?.id===beforeSlots[0]?.id));
  const opened=await capture('chest-replacement-ground-item.png');if(opened)report.screenshots.push(opened);
  await press('F');await until(()=>shell?.dungeon.state.run?.player.weaponSlots[0]?.id==='weapon-treasure-chest',Boolean,'F picks the chest weapon and replaces the active full slot',5000);s=await frameCapture('chest-replacement-picked');
  const treasure=s.run.rooms.find((r:any)=>r.id==='treasure'),replaced=treasure?.ground.find((g:any)=>g.weapon.id===beforeSlots[0]?.id);
  record('explicit-pickup-replaces-active-keeps-old-weapon','F picks the chest weapon into the active slot, preserves the backup slot and drops the replaced active weapon on the floor',{beforeSlots,afterSlots:s.run.player.weaponSlots,remainingGround:treasure?.ground,notice:s.ui?.notice},Boolean(s.run.player.weaponSlots[0]?.id==='weapon-treasure-chest'&&s.run.player.weaponSlots[1]?.id===beforeSlots[1]?.id&&replaced?.weapon.kind==='sword'&&treasure?.ground.length===1));const after=await capture('chest-replacement-after.png');if(after)report.screenshots.push(after);
 }else if(scenario==='fixture-combat'){
  let room=s.run.rooms.find((r:any)=>r.id==='battle-a');const returnRoomId=report.fixture?.parentRoomId as string|null,doors=returnRoomId?await doorEvidence(returnRoomId):null;const lockedStatus=s.ui?.roomText;
  record('locked-wave-one-hp-shield-and-door-hud','The two-wave combat fixture starts with closed exits, visible health/shield meters, and model-derived door geometry',{room:{id:room.id,kind:room.kind,locked:room.locked,wave:room.wave,totalWaves:room.totalWaves,enemies:room.enemies,width:room.width,height:room.height,obstacles:room.obstacles},doors,ui:s.ui,fixture:report.fixture},Boolean(room.kind==='combat'&&room.locked&&room.wave===1&&room.totalWaves===2&&room.enemies.length===3&&doors?.door.locked&&String(lockedStatus).includes('1/2')&&String(s.ui?.healthText).includes('10000 / 10000')&&String(s.ui?.shieldText).includes('10000 / 10000')));
  const initialDrawState=await observe(),pillarDraws=(initialDrawState.obstacleDraws??[]).filter((d:any)=>d.footprint.width===40&&d.footprint.height===28);
  record('combat-room-compact-scale-and-pillar-footprints','The generated combat room remains compact; its model and rendered pillar dimensions resolve to 40×28 world units after zoom normalization',{width:room.width,height:room.height,pillars:room.obstacles.filter((o:any)=>o.kind==='pillar'),pillarDraws,zoom:initialDrawState.zoom},room.width<=552&&room.height<=408&&pillarDraws.some((d:any)=>Math.abs(d.sprite.width/initialDrawState.zoom-40)<2&&Math.abs(d.sprite.height/initialDrawState.zoom-28)<2));
  const startShot=await capture('combat-wave1-locked.png');if(startShot)report.screenshots.push(startShot);
  const collisionStart=await observe();const playerStart={x:collisionStart.run.player.x,y:collisionStart.run.player.y};
  const obstacle=[...room.obstacles].filter((o:any)=>o.hp>0).sort((a:any,b:any)=>Math.hypot(a.x+a.width/2-playerStart.x,a.y+a.height/2-playerStart.y)-Math.hypot(b.x+b.width/2-playerStart.x,b.y+b.height/2-playerStart.y))[0];
  if(obstacle){const startGap=Math.hypot(Math.max(Math.abs(playerStart.x-(obstacle.x+obstacle.width/2))-obstacle.width/2,0),Math.max(Math.abs(playerStart.y-(obstacle.y+obstacle.height/2))-obstacle.height/2,0));const approach=await moveNear(obstacle.x+obstacle.width/2,obstacle.y+obstacle.height/2,5,900);const collisionAfter=await observe();const end={x:collisionAfter.run.player.x,y:collisionAfter.run.player.y};const endGap=Math.hypot(Math.max(Math.abs(end.x-(obstacle.x+obstacle.width/2))-obstacle.width/2,0),Math.max(Math.abs(end.y-(obstacle.y+obstacle.height/2))-obstacle.height/2,0));const moved=Math.hypot(end.x-playerStart.x,end.y-playerStart.y);record('player-collides-with-live-obstacle-footprint','Move toward the nearest live fixture obstacle; player radius must remain outside the actual rectangle while approaching it',{obstacle,playerRadius:11,start:playerStart,end,startGap,endGap,moved,approach,allFootprints:collisionAfter.run.rooms.find((r:any)=>r.id==='battle-a')?.obstacles},Boolean(startGap>11&&endGap>=10.9&&endGap<startGap-8&&moved>12));const collisionImage=await capture('combat-obstacle-collision.png');if(collisionImage)report.screenshots.push(collisionImage);}
  else record('player-collides-with-live-obstacle-footprint','Move toward a live room obstacle and remain outside its footprint','No live obstacle in fixture room',undefined);
  const collisionState=await observe();const playerPos={x:collisionState.run.player.x,y:collisionState.run.player.y};
  await js('window.dungeonProbe.stats.reset()');const performanceStarted=Date.now();
  const firstEnemy=room.enemies[0],projectileAim=(()=>{const p=room.obstacles.filter((o:any)=>o.hp>0),x=playerPos.x,y=playerPos.y;const candidates=[{x:x+160,y},{x:x-160,y},{x,y:y+140},{x,y:y-140},{x:x+110,y:y+100},{x:x-110,y:y-100}].filter((q:any)=>q.x>30&&q.x<room.width-30&&q.y>30&&q.y<room.height-30);const clear=(q:any)=>{for(let i=1;i<=12;i++){const t=i/12,sx=x+(q.x-x)*t,sy=y+(q.y-y)*t;if(p.some((o:any)=>sx>o.x-3&&sx<o.x+o.width+3&&sy>o.y-3&&sy<o.y+o.height+3))return false;}return true;};return candidates.find(clear)??{x:Math.min(room.width-36,x+120),y};})();
  const startAim=await js<any>(`(()=>{const p=window.dungeonProbe,c=p.camera,r=document.querySelector('#dungeonWorld canvas').getBoundingClientRect(),q=c.worldToScreen({x:${projectileAim.x},y:${projectileAim.y}});return{x:q.x+r.x,y:q.y+r.y}})()`);await inputMouse('mouseMove',startAim.x,startAim.y);await inputMouse('mouseDown',startAim.x,startAim.y,'left');
  const firstShot=await until(()=>observe(),v=>v?.run?.projectiles?.some((p:any)=>p.kind==='fire'&&p.owner==='player'),'first fixed-direction fire projectile',1800).catch(()=>null);
  const shot=firstShot?.run?.projectiles?.find((p:any)=>p.kind==='fire'&&p.owner==='player');
  if(shot){const opposite={x:Math.max(30,Math.min(room.width-30,playerPos.x-(projectileAim.x-playerPos.x))),y:Math.max(30,Math.min(room.height-30,playerPos.y-(projectileAim.y-playerPos.y)))};const oppositeScreen=await js<any>(`(()=>{const p=window.dungeonProbe,c=p.camera,r=document.querySelector('#dungeonWorld canvas').getBoundingClientRect(),q=c.worldToScreen({x:${opposite.x},y:${opposite.y}});return{x:q.x+r.x,y:q.y+r.y}})()`);await inputMouse('mouseMove',oppositeScreen.x,oppositeScreen.y);await delay(60);const afterAim=await observe(),same=afterAim.run.projectiles.find((p:any)=>p.id===shot.id);const delta=same?Math.hypot(same.vx-shot.vx,same.vy-shot.vy):Infinity;record('fire-projectile-direction-is-fixed-after-aim-moves','A launched fire projectile keeps its launch velocity after the pointer moves to the opposite side',{shotId:shot.id,initial:{vx:shot.vx,vy:shot.vy},after:{vx:same?.vx,vy:same?.vy},directionDelta:delta,firstAim:projectileAim,oppositeAim:opposite},Boolean(same&&delta<.001));const shotImage=await capture('combat-fixed-projectile.png');if(shotImage)report.screenshots.push(shotImage);}
  else record('fire-projectile-direction-is-fixed-after-aim-moves','A launched fire projectile keeps its launch velocity after pointer aim changes','No player fire projectile observed',false);
  await inputMouse('mouseUp',startAim.x,startAim.y,'left');const startTarget=await js<any>(`(()=>{const p=window.dungeonProbe,c=p.camera,r=document.querySelector('#dungeonWorld canvas').getBoundingClientRect(),q=c.worldToScreen({x:${firstEnemy.x},y:${firstEnemy.y}});return{x:q.x+r.x,y:q.y+r.y}})()`);await inputMouse('mouseMove',startTarget.x,startTarget.y);await inputMouse('mouseDown',startTarget.x,startTarget.y,'left');
  const deadline=Date.now()+32000;let last=s,waveOneCleared=false,secondWave=false,secondWaveCount=0;
  try{while(Date.now()<deadline){await delay(180);last=await observe();const current=last?.run?.rooms.find((r:any)=>r.id==='battle-a');if(current?.wave===1&&current.enemies.length===0&&current.nextWaveAt>0&&!waveOneCleared){waveOneCleared=true;mark('wave-one-cleared',{tick:last.run.tick,nextWaveAt:current.nextWaveAt,player:last.run.player});}if(current?.wave===2&&current.enemies.length>0&&!secondWave){secondWave=true;secondWaveCount=current.enemies.length;mark('wave-two-spawned',{tick:last.run.tick,count:secondWaveCount,enemies:current.enemies});}
   const currentEnemy=current?.enemies.find((e:any)=>e.hp>0);if(currentEnemy){const point=await js<any>(`(()=>{const p=window.dungeonProbe,c=p.camera,r=document.querySelector('#dungeonWorld canvas').getBoundingClientRect(),q=c.worldToScreen({x:${currentEnemy.x},y:${currentEnemy.y}});return{x:q.x+r.x,y:q.y+r.y}})()`);await inputMouse('mouseMove',point.x,point.y);}
   if(current?.cleared&&!current.locked&&current.wave===2&&current.enemies.length===0)break;
  }}finally{const point=await observe().catch(()=>null);if(point?.canvas)await inputMouse('mouseUp',point.canvas.x+point.canvas.width/2,point.canvas.y+point.canvas.height/2,'left');}
  s=await frameCapture('combat-two-waves-cleared');room=s.run.rooms.find((r:any)=>r.id==='battle-a');const unlocked=room?.cleared&&room.wave===2&&!room.locked&&room.enemies.length===0;record('second-production-wave-density','The second wave uses the generated 7–9 enemy production spawn count',{secondWave,secondWaveCount,expectedRange:[7,9]},Boolean(secondWave&&secondWaveCount>=7&&secondWaveCount<=9));record('two-production-waves-open-doors','Scripted held-left attack clears the fixture first wave and production-spawned second wave, then the live room unlocks',{waveOneCleared,secondWave,room:{wave:room?.wave,totalWaves:room?.totalWaves,cleared:room?.cleared,locked:room?.locked,enemies:room?.enemies},phase:s.run.phase,elapsedMs:s.run.elapsedMs,health:s.run.player.hp,shield:s.run.player.shield,events:s.events.filter((e:any)=>e.type==='pointerdown'||e.type==='pointerup').slice(-6)},Boolean(waveOneCleared&&secondWave&&unlocked));const unlockedShot=await capture('combat-two-waves-unlocked.png');if(unlockedShot)report.screenshots.push(unlockedShot);
  const performance=await js<any>('(()=>({summary:window.dungeonProbe.stats.summary(),raw:window.dungeonProbe.stats.raw()}))()');report.performance={label:'fixture-combat-active',display:report.runtime.display,elapsedMs:Date.now()-performanceStarted,...performance};fs.writeFileSync(path.join(rawDir,'fixture-combat-performance.json'),JSON.stringify(report.performance,null,2)+'\n');
  const authoritativeBeforeMinimize={paused:shell!.dungeon.state.run?.paused,tick:shell!.dungeon.state.run?.tick,phase:shell!.dungeon.state.run?.phase};win!.minimize();await delay(500);const authoritativeMinimizeSample1={paused:shell!.dungeon.state.run?.paused,tick:shell!.dungeon.state.run?.tick,phase:shell!.dungeon.state.run?.phase};await delay(500);const authoritativeMinimizeSample2={paused:shell!.dungeon.state.run?.paused,tick:shell!.dungeon.state.run?.tick,phase:shell!.dungeon.state.run?.phase};const rendererAfterMinimize=await observe().catch(()=>null);const tickDeltaBetweenSamples=(authoritativeMinimizeSample2.tick??0)-(authoritativeMinimizeSample1.tick??0),rendererBlur=Boolean(rendererAfterMinimize?.events?.some((e:any)=>e.type==='blur')),rendererControlsCleared=Boolean(rendererAfterMinimize&&!rendererAfterMinimize.focused&&!rendererAfterMinimize.documentFocus&&!rendererAfterMinimize.keys?.length&&!rendererAfterMinimize.buttons&&rendererBlur);record('minimize-pauses-authoritative-worker','After native minimize, two main-process DungeonRuntime samples 500ms apart must remain paused without tick advance; renderer is used only to check blur/control clearing',{authoritativeBeforeMinimize,authoritativeMinimizeSample1,authoritativeMinimizeSample2,tickDeltaBetweenSamples,renderer:{focused:rendererAfterMinimize?.focused,documentFocus:rendererAfterMinimize?.documentFocus,keys:rendererAfterMinimize?.keys,buttons:rendererAfterMinimize?.buttons,blurEvents:rendererAfterMinimize?.events?.filter((e:any)=>e.type==='blur').slice(-2),controlsCleared:rendererControlsCleared},native:{visible:win!.isVisible(),focused:win!.isFocused(),minimized:win!.isMinimized()}},Boolean(authoritativeMinimizeSample1.paused===true&&authoritativeMinimizeSample2.paused===true&&tickDeltaBetweenSamples===0&&win!.isMinimized()&&rendererControlsCleared));
  if(unlocked&&s.run.phase==='upgrade'){
   const choices=s.panel?.buttons.filter((b:any)=>b.upgrade).map((b:any)=>b.upgrade)??[];record('combat-clear-presents-three-upgrade-choices','Natural clear reward opens the 3-choice upgrade UI before leaving the room',{phase:s.run.phase,choices,panel:s.panel?.text},choices.length===3);
   const choose=choices[0]?await clickRect(`[data-upgrade="${choices[0]}"]`):null;await until(()=>shell?.dungeon.state.run?.phase==='exploring',Boolean,'select clear reward upgrade to resume traversal',4000);s=await observe();record('combat-upgrade-selection-continues-run','Selecting one valid clear reward closes the choice panel and resumes exploration',{choose,phase:s.run.phase,level:s.run.level},Boolean(choose&&s.run.phase==='exploring'));
  }
  if(unlocked&&s.run.phase==='exploring'&&!quickMode){
   const doorAfterClear=returnRoomId?await doorEvidence(returnRoomId):null;record('cleared-door-geometry-opens','Door at the recorded connected-room coordinate is unlocked after both waves clear',{returnRoomId,doorAfterClear,roomText:s.ui?.roomText},Boolean(doorAfterClear&&!doorAfterClear.door.locked&&s.run.phase==='exploring'));
   if(returnRoomId){await enterRoom(returnRoomId);const afterLeave=await observe();record('cleared-combat-room-exits','After both waves, the production door returns to its BFS predecessor room',{parentRoomId:returnRoomId,currentRoom:afterLeave.run.currentRoom,route:events.filter(e=>e.kind==='door-traverse').at(-1)},Boolean(afterLeave.run.currentRoom===returnRoomId));
    const revisitPath=await walkPathTo('battle-a');s=await frameCapture('combat-room-revisited');room=s.run.rooms.find((r:any)=>r.id==='battle-a');record('revisit-preserves-cleared-state','BFS re-entry into the cleared room keeps wave 2 state and does not respawn enemies',{path:revisitPath,currentRoom:s.run.currentRoom,wave:room?.wave,totalWaves:room?.totalWaves,cleared:room?.cleared,locked:room?.locked,enemies:room?.enemies,notice:s.run.notice},Boolean(s.run.currentRoom==='battle-a'&&room?.cleared&&room.wave===2&&!room.locked&&room.enemies.length===0));const shot=await capture('combat-room-revisited.png');if(shot)report.screenshots.push(shot);
   }
  }else record('clear-exit-revisit-not-run','Door traversal/revisit are deferred in this short combat-only run','skipped after one bounded dense-combat sample',undefined);
 }else if(scenario==='fixture-upgrade-reforge'){
  const initialRun=shell!.dungeon.state.run!,initialInfo=evolutionInfo(initialRun),options=s.panel?.buttons.filter((b:any)=>b.upgrade).map((b:any)=>b.upgrade)??[];
  record('upgrade-panel-shows-three-real-choices','Schema-v2 upgrade state presents exactly three distinct, valid options while preserving altar progression requirements',{phase:s.run.phase,choices:s.run.choices,renderedChoices:options,weapon:s.run.player.weaponSlots[0],traits:s.run.player.traits,evolution:initialInfo},Boolean(s.run.phase==='upgrade'&&options.length===3&&new Set(options).size===3&&s.run.player.traits.length===2&&!initialInfo.canEvolve&&initialInfo.requirements.some(q=>q.label==='武器等级5'&&!q.met)));
  const panelShot=await capture('upgrade-three-choices.png');if(panelShot)report.screenshots.push(panelShot);
  const selectedId=options.find((id:string)=>id==='scorch-field');const selected=selectedId?await clickRect(`[data-upgrade="${selectedId}"]`):null;
  await until(()=>shell?.dungeon.state.run?.phase==='exploring'&&shell.dungeon.state.run.player.weaponSlots[0]?.level===5,Boolean,'choose valid fire mechanism upgrade and reach level five',5000);s=await frameCapture('upgrade-selected-three-slots');
  record('upgrade-fills-third-mechanism-slot','The selected 1-of-3 upgrade raises the active weapon to Lv5 and fills the third mechanism slot',{selected,phase:s.run.phase,level:s.run.level,weapon:s.run.player.weaponSlots[0],traits:s.run.player.traits,choices:s.run.choices},Boolean(selected&&s.run.player.weaponSlots[0]?.level===5&&s.run.player.traits.length===3&&s.run.phase==='exploring'));
  const altarOptions=nearbyInteractions(shell!.dungeon.state.run!).filter(v=>v.kind==='altar'),altarLevel=altarOptions.find(v=>v.id==='altar-level'),beforeEvolve=altarOptions.find(v=>v.id==='altar-evolve');
  const altarPosition=beforeEvolve?await interactionEvidence(beforeEvolve.id):null;record('altar-requirements-update-and-evolution-enables','At the actual altar, the Lv5 zero-essence upgrade is disabled, eligible fire evolution is enabled, and the prompt aligns with the altar model coordinate',{evolution:evolutionInfo(shell!.dungeon.state.run!),altarOptions,altarPosition,panel:s.panel,player:{x:s.run.player.x,y:s.run.player.y,runes:s.run.player.runes},room:s.run.currentRoom},Boolean(altarLevel?.disabled&&beforeEvolve&&!beforeEvolve.disabled&&evolutionInfo(shell!.dungeon.state.run!).canEvolve&&altarPosition?.anchorError!==null&&altarPosition?.anchorError<2));
  const altarBefore=await capture('altar-ready-before-reforge.png');if(altarBefore)report.screenshots.push(altarBefore);
  const detail=await clickRect('.d-reforge summary');await until(()=>js<boolean>(`Boolean(document.querySelector('.d-reforge[open]'))`),Boolean,'open public reforge details',3000);
  const slotClick=await clickRect('[data-reforge-slot="0"]');const reforge=await clickRect('[data-reforge="twin-blades"]');
  await until(()=>shell?.dungeon.state.run?.player.traits[0]==='twin-blades'&&shell.dungeon.state.run.reforgesLeft===0,Boolean,'reforge first mechanism slot once via renderer buttons',5000);s=await frameCapture('altar-reforged');
  record('three-slot-reforge-is-one-time','Reforge replaces one selected trait with a distinct allowed mechanism and consumes the single use',{detail,slotClick,reforge,traits:s.run.player.traits,reforgesLeft:s.run.reforgesLeft},Boolean(s.run.player.traits.length===3&&s.run.player.traits[0]==='twin-blades'&&s.run.reforgesLeft===0));
  const evolveNow=nearbyInteractions(shell!.dungeon.state.run!).find(v=>v.id==='altar-evolve'),evolveClick=evolveNow?await clickRect('[data-interact="altar-evolve"]'):null;
  await until(()=>Boolean(shell?.dungeon.state.run?.player.weaponSlots[0]?.evolved&&shell.dungeon.state.run.rooms.find(r=>r.id==='altar')?.altarUsed),Boolean,'evolve at the altar through the enabled public interaction',5000);s=await frameCapture('altar-evolved-through-ui');
  record('altar-performs-real-legal-evolution','Enabled altar action evolves the level-5 fire weapon and records the unique used altar in the same run',{evolveClick,weapon:s.run.player.weaponSlots[0],runes:s.run.player.runes,altarUsed:s.run.rooms.find((r:any)=>r.id==='altar')?.altarUsed,info:evolutionInfo(shell!.dungeon.state.run!),ui:s.ui?.notice},Boolean(evolveClick&&s.run.player.weaponSlots[0]?.evolved&&s.run.rooms.find((r:any)=>r.id==='altar')?.altarUsed&&s.run.player.runes.includes('fire')));const shot=await capture('altar-evolution-complete.png');if(shot)report.screenshots.push(shot);
 }else if(scenario==='fixture-boss'){
  let boss=loadedState.run.rooms.find((r:any)=>r.id==='boss')?.enemies.find((e:any)=>e.kind==='boss');
  record('boss-fixture-is-schema-v2-and-locked','Valid boss-room fixture starts in phase 1 with visible boss HUD, locked exit, and no pre-evolved weapon',{room:loadedState.run.currentRoom,locked:loadedState.run.rooms.find((r:any)=>r.id==='boss')?.locked,boss,ui:loadedState.ui,fixture:report.fixture},Boolean(loadedState.run.currentRoom==='boss'&&loadedState.run.rooms.find((r:any)=>r.id==='boss')?.locked&&boss?.bossPhase===1&&!loadedState.run.player.weaponSlots.some((w:any)=>w?.evolved)&&loadedState.ui?.bossHidden===false));
  const bossStart=await capture('boss-phase-one-start.png');if(bossStart)report.screenshots.push(bossStart);
  await until(()=>shell?.dungeon.state.run?.rooms.find(r=>r.id==='boss')?.enemies[0]?.bossPhase===2,Boolean,'boss enters second phase through live simulation threshold',7000);s=await frameCapture('boss-phase-two-transition');boss=s.run.rooms.find((r:any)=>r.id==='boss')?.enemies[0];
  record('boss-phase-transition-warns','Boss health threshold triggers phase 2, warning effect, and updated status/notice',{boss,notice:s.ui?.notice,bossText:s.ui?.bossText,effects:s.run.effects.filter((e:any)=>e.kind==='boss-warning')},Boolean(boss?.bossPhase===2&&s.run.effects.some((e:any)=>e.kind==='boss-warning')&&String(s.ui?.bossText).includes('第2相')));
  const transitionShot=await capture('boss-phase-two-warning.png');if(transitionShot)report.screenshots.push(transitionShot);
  await until(()=>{const e=shell?.dungeon.state.run?.rooms.find(r=>r.id==='boss')?.enemies[0];return e&&e.bossPhase===2&&e.state==='windup';},Boolean,'second-phase attack displays a telegraph',7000);s=await frameCapture('boss-phase-two-telegraph');boss=s.run.rooms.find((r:any)=>r.id==='boss')?.enemies[0];
  record('boss-attack-warning-has-readable-pattern','Second phase windup identifies an attack pattern in the HUD and retains its visual warning event',{boss,bossText:s.ui?.bossText,warningEffects:s.run.effects.filter((e:any)=>e.kind==='boss-warning'),notice:s.ui?.notice},Boolean(boss?.bossPhase===2&&boss.state==='windup'&&boss.pattern!=='none'&&String(s.ui?.bossText).includes('第2相')&&s.run.effects.some((e:any)=>e.kind==='boss-warning')));const warningShot=await capture('boss-phase-two-telegraph.png');if(warningShot)report.screenshots.push(warningShot);
 }
 noErrors('renderer-has-no-console-or-load-errors');
}

void main();
