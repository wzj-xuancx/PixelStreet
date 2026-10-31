// Independent native renderer review for Dungeon F1. Run only in a uniquely
// marked temporary profile; this entry is bundled separately from the app.
import {app,screen,type BrowserWindow} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {startDesktop} from '../apps/desktop/bootstrap';

const root=process.cwd();
const evidenceDir=path.join(root,'docs/evidence/dungeon-040');
fs.mkdirSync(evidenceDir,{recursive:true});
const profile=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'pixelstreet-dungeon-f1-luna-'));
const startedAt=new Date().toISOString();
const checks:{name:string;expected:string;actual:unknown;status:'pass'|'fail'|'not-run'}[]=[];
const errors:{kind:string;detail:string}[]=[];
const events:{at:string;type:string;detail?:unknown}[]=[];
let shell:Awaited<ReturnType<typeof startDesktop>>|undefined;
let win:BrowserWindow|undefined;
let inputReady=false;
let lastState:any;

const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const sha=(file:string)=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex');
const rec=(name:string,expected:string,actual:unknown,ok:boolean|undefined)=>checks.push({name,expected,actual,status:ok===undefined?'not-run':ok?'pass':'fail'});
const event=(type:string,detail?:unknown)=>events.push({at:new Date().toISOString(),type,detail});
const until=async<T>(read:()=>T|Promise<T>,predicate:(value:T)=>boolean,label:string,ms=12000):Promise<T>=>{
 const end=Date.now()+ms;let value:T;
 do{value=await read();if(predicate(value))return value;await delay(50);}while(Date.now()<end);
 throw Error(`${label} timed out; last=${JSON.stringify(value)}`);
};
const js=async<T>(source:string):Promise<T>=>{
 if(!win||win.isDestroyed())throw Error('Arena window is unavailable');
 return await win.webContents.executeJavaScript(source,true) as T;
};
const probe=()=>js<any>(`(()=>{const p=window.dungeonProbe;if(!p)return null;const s=p.state;const r=s.session?.run;const room=r?.rooms?.find(x=>x.id===r.currentRoom);return{focused:s.focused,hasDocumentFocus:document.hasFocus(),visibility:document.visibilityState,keys:s.keys,buttons:s.buttons,mouse:s.mouse,pointerWorld:s.pointerWorld,frameCount:s.frameCount,tickerStarted:p.app.ticker.started,zoom:p.camera.zoom,visibleTiles:s.visibleTiles,tileScreenSize:s.tileScreenSize,hud:s.hud,canvas:document.querySelector('#dungeonWorld canvas')?.getBoundingClientRect().toJSON(),camera:{x:p.camera.x,y:p.camera.y,width:p.camera.width,height:p.camera.height,zoom:p.camera.zoom},stats:p.stats.summary(),run:r?{tick:r.tick,elapsedMs:r.elapsedMs,paused:r.paused,phase:r.phase,player:{x:r.player.x,y:r.player.y,hp:r.player.hp,shield:r.player.shield,moveX:r.player.moveX,moveY:r.player.moveY,firing:r.player.firing,dashUntil:r.player.dashUntil,dashReady:r.player.dashReady,activeSlot:r.player.activeSlot,weaponSlots:r.player.weaponSlots.map(w=>w&&{id:w.id,kind:w.kind,level:w.level}),aimX:r.player.aimX,aimY:r.player.aimY},enemies:room?.enemies?.map(e=>({id:e.id,kind:e.kind,x:e.x,y:e.y,hp:e.hp})),projectiles:r.projectiles.map(q=>({id:q.id,owner:q.owner,kind:q.kind,x:q.x,y:q.y})),ground:room?.ground?.map(g=>({id:g.id,kind:g.weapon.kind,x:g.x,y:g.y})),room:{locked:room?.locked,wave:room?.wave,totalWaves:room?.totalWaves}}:null}})()`);
const capture=async(name:string)=>{
 if(!win||win.isDestroyed())return null;
 const file=path.join(evidenceDir,name);fs.writeFileSync(file,(await win.webContents.capturePage()).toPNG());return path.basename(file);
};
const nativeMouse=async(type:'mouseMove'|'mouseDown'|'mouseUp',x:number,y:number,button:'left'|'right'='left')=>{
 if(!win||win.isDestroyed()||!inputReady)return;
 win.webContents.sendInputEvent({type,x:Math.round(x),y:Math.round(y),button,clickCount:1});
};
const clickRect=async(selector:string):Promise<{x:number;y:number;width:number;height:number}|null>=>{
 const rect=await js<any>(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,disabled:!!e.disabled,hidden:!!e.closest('[hidden]')}})()`);
 if(!rect||rect.hidden||rect.disabled||rect.width<=0||rect.height<=0)return null;
 const x=rect.x+rect.width/2,y=rect.y+rect.height/2;
 await nativeMouse('mouseMove',x,y);await nativeMouse('mouseDown',x,y);await delay(45);await nativeMouse('mouseUp',x,y);await delay(120);
 return rect;
};
const key=async(code:'W'|'A'|'S'|'D'|'F'|'TAB'|'SHIFT',ms=0)=>{
 if(!win||win.isDestroyed()||!inputReady)return;
 const mapping:Record<string,string>={TAB:'TAB',SHIFT:'SHIFT'};
 const keyCode=mapping[code]??code;
 win.webContents.sendInputEvent({type:'keyDown',keyCode});
 if(ms)await delay(ms);
 win.webContents.sendInputEvent({type:'keyUp',keyCode});
};
const holdKeys=async(codes:string[],ms:number)=>{
 if(!win||win.isDestroyed()||!inputReady)return;
 const keyCodes=codes.map(code=>code==='TAB'?'TAB':code==='SHIFT'?'SHIFT':code);
 try{for(const keyCode of keyCodes)win.webContents.sendInputEvent({type:'keyDown',keyCode});await delay(ms);}
 finally{for(const keyCode of keyCodes)win.webContents.sendInputEvent({type:'keyUp',keyCode});}
};
const runCopy=(s:any)=>s?.run?JSON.parse(JSON.stringify({tick:s.run.tick,elapsedMs:s.run.elapsedMs,paused:s.run.paused,phase:s.run.phase,player:s.run.player,enemyCount:s.run.enemies?.length,projectileCount:s.run.projectiles?.length,ground:s.run.ground})):null;

const inputs={
 profile, markerPath:path.join(profile,'.pixelstreet-isolated-profile.json'),
 userData:'',sessionData:'',realProfileOpened:false,
 method:'Electron WebContents.sendInputEvent to the isolated native arena window; public DOM buttons/range input; screenshots via webContents.capturePage.',
 focusBoundary:'The product openArena path is allowed to focus the test window once. No repeated harness focus/stealFocus calls are made. Injected input is scripted native-window input, not physical-device proof.'
};
const report:any={schema:'pixelstreet.dungeon-040.F1-native-renderer-luna.v1',candidate:'PixelStreet-0.4.0',startedAt,profile:inputs,buildHashes:{},runtime:{},checks,events,rendererConsoleErrors:errors,screenshots:[],inputEvents:[],renderSample:null,limitations:[
 'Electron sendInputEvent is scripted input into a real isolated Electron renderer; it does not establish physical keyboard/mouse behavior.',
 'capturePage records renderer content, not OS compositor output or physical display presentation.',
 'FrameStats reports renderer ticker intervals and CPU submission; it does not prove GPU completion or scanout cadence.'
]};

async function main():Promise<void>{
 try{
  const appData=app.getPath('appData');
  const {markIsolatedFolder,configureDataPaths}=await import('../apps/desktop/launch-profile');
  markIsolatedFolder(profile,appData);configureDataPaths(app,appData,profile);
  inputs.userData=app.getPath('userData');inputs.sessionData=app.getPath('sessionData');
  const expectedSession=path.join(profile,'session');
  rec('isolated-temporary-profile',`userData=${profile}; sessionData=${expectedSession}; marker matches`,{
   realTmp:fs.realpathSync(os.tmpdir()),profileRealpath:fs.realpathSync(profile),marker:fs.readFileSync(inputs.markerPath,'utf8').trim(),userData:inputs.userData,sessionData:inputs.sessionData
  },fs.realpathSync(profile)===profile&&inputs.userData===profile&&inputs.sessionData===expectedSession&&profile.startsWith(fs.realpathSync(os.tmpdir())+path.sep));
  const relevant=['apps/desktop/renderer/dungeon.ts','apps/desktop/renderer/dungeon.css','packages/dungeon-core/index.ts','packages/dungeon-core/foundation.ts','apps/desktop/dungeon-runtime.ts','apps/desktop/shell.ts','dist/main.cjs','dist/dungeon-worker.cjs','dist/renderer/main.js','dist/renderer/dungeon.css'];
  report.buildHashes=Object.fromEntries(relevant.map(file=>[file,sha(file)]));
  app.on('web-contents-created',(_event,wc)=>{
   wc.on('console-message',(...args:any[])=>{
    const d=args[0]??{};const level=d.level??args[1];const message=d.message??args[2]??'';
    if(level==='error'||level===3||typeof level==='number'&&level>=3)errors.push({kind:'console-error',detail:`${message} (${d.sourceId??args[4]??''}:${d.lineNumber??args[3]??''})`});
   });
   wc.on('render-process-gone',(_e,d)=>errors.push({kind:'render-process-gone',detail:JSON.stringify(d)}));
   wc.on('did-fail-load',(_e,c,d,u)=>errors.push({kind:'did-fail-load',detail:`${c} ${d} ${u}`}));
  });
  shell=await startDesktop(profile,true);
  shell.openArena();
  await until(()=>Boolean(shell?.arenaWindow&&!shell.arenaWindow.isDestroyed()&&shell.arenaWindow.webContents.isLoadingMainFrame()===false),v=>v,'native arena main frame',15000);
  win=shell.arenaWindow!;
  const ready=await until(async()=>await js<boolean>(`document.body.dataset.dungeonReady==='true'`),Boolean,'Dungeon renderer ready',20000);
  void ready;
  await until(()=>Boolean(win&&!win.isDestroyed()&&win.isVisible()&&win.isFocused()),Boolean,'visible focused arena after product openArena',8000).catch(()=>false);
  await delay(300);
  const startFocus=await js<any>(`({documentHasFocus:document.hasFocus(),visibility:document.visibilityState,ready:document.body.dataset.dungeonReady==='true',panel:document.getElementById('dungeonPanel')?.textContent})`);
  inputReady=Boolean(win&&!win.isDestroyed()&&win.isVisible()&&win.isFocused()&&startFocus.documentHasFocus&&startFocus.visibility==='visible');
  rec('native-window-loaded-and-focused',`visible + native focused + document.hasFocus after one openArena focus`,{windowVisible:win.isVisible(),windowFocused:win.isFocused(),...startFocus},inputReady);
  const focusDisplay=screen.getDisplayMatching(win.getBounds());
  report.runtime={electron:process.versions.electron,chrome:process.versions.chrome,node:process.versions.node,platform:process.platform,arch:process.arch,displays:screen.getAllDisplays().map(d=>({id:d.id,bounds:d.bounds,workArea:d.workArea,scaleFactor:d.scaleFactor,displayFrequency:d.displayFrequency})),focusDisplayId:focusDisplay.id,focusDisplayHz:focusDisplay.displayFrequency,arenaBounds:win.getBounds(),rendererPid:win.webContents.getOSProcessId()};
  await js(`(()=>{window.__f1Events=[];for(const type of ['keydown','keyup','pointerdown','pointerup','pointermove','focus','blur'])window.addEventListener(type,e=>{if(window.__f1Events.length<500)window.__f1Events.push({type,at:performance.now(),code:e.code||'',key:e.key||'',button:e.button,buttons:e.buttons,clientX:e.clientX,clientY:e.clientY,isTrusted:e.isTrusted,repeat:e.repeat,hasFocus:document.hasFocus()})},true)})()`);
  const startImage=await capture('F1-renderer-luna-start.png');if(startImage)report.screenshots.push(startImage);
  rec('renderer-ready-probe-present','window.dungeonProbe.state and real canvas exist',await js<any>(`(()=>({probe:!!window.dungeonProbe,state:!!window.dungeonProbe?.state,canvas:!!document.querySelector('#dungeonWorld canvas'),canvasRect:document.querySelector('#dungeonWorld canvas')?.getBoundingClientRect().toJSON(),ready:document.body.dataset.dungeonReady}))()`),inputReady&&Boolean(await js<boolean>(`!!window.dungeonProbe&&!!window.dungeonProbe.state&&!!document.querySelector('#dungeonWorld canvas')`)));
  if(!inputReady){
   for(const name of ['start-button','four-direction-wasd','left-click-attack','right-click-roll','pickup-F','tab-switch','zoom-1-vs-2','pause-freeze-clear','minimize-restore'])rec(name,'scripted input requires confirmed native/document focus','skipped: no stable native focus after the single product openArena focus',undefined);
  }else{
   const startButton=await clickRect('[data-command="start"]');
   await until(()=>Boolean(shell?.dungeon.state.run&&shell.dungeon.state.run.tick>0&&!shell.dungeon.state.run.paused),Boolean,'start button opens an active run',12000);
   await delay(180);let state=await probe();lastState=state;
   rec('start-through-visible-public-button','Click visible “踏入地牢” button and enter active exploring phase',{buttonRect:startButton,run:runCopy(state),focused:state?.focused,documentHasFocus:state?.hasDocumentFocus},Boolean(startButton&&state?.run?.phase==='exploring'&&!state.run.paused));
   const battleImage=await capture('F1-renderer-luna-battle-start.png');if(battleImage)report.screenshots.push(battleImage);

   const directionResults:any[]=[];
   for(const [code,field,sign] of [['A','x',-1],['D','x',1],['W','y',-1],['S','y',1]] as const){
    const before=await probe();await key(code,210);await delay(120);const after=await probe();
    const delta=field==='x'?after.run.player.x-before.run.player.x:after.run.player.y-before.run.player.y;
    directionResults.push({code,before:{x:before.run.player.x,y:before.run.player.y},after:{x:after.run.player.x,y:after.run.player.y},axis:field,delta,expectedSign:sign,keyEvents:await js<any>(`window.__f1Events.filter(e=>e.type==='keydown'||e.type==='keyup').slice(-8)`)});
   }
   const directionsPass=directionResults.every(v=>Math.sign(v.delta)===v.expectedSign&&Math.abs(v.delta)>=6);
   rec('four-direction-wasd','A/D move left/right and W/S move up/down via native key events',directionResults,directionsPass);

   // Collect a short renderer ticker sample on the fastest reported display.
   const display=screen.getDisplayMatching(win.getBounds());
   const sampleStart=Date.now();await js(`window.dungeonProbe.stats.reset()`);await delay(2200);const sampleEnd=Date.now();
   const renderSample=await js<any>(`(()=>({summary:window.dungeonProbe.stats.summary(),raw:window.dungeonProbe.stats.raw(),frames:window.dungeonProbe.stats.frames,focused:window.dungeonProbe.state.focused,hasFocus:document.hasFocus(),tickerStarted:window.dungeonProbe.app.ticker.started,maxFPS:window.dungeonProbe.app.ticker.maxFPS}))()`);
   const intervals=renderSample.raw.frameMs as number[];const sorted=[...intervals].sort((a,b)=>a-b);const q=(p:number)=>sorted.length?sorted[Math.min(sorted.length-1,Math.floor((sorted.length-1)*p))]:null;
   const sampleDurationMs=sampleEnd-sampleStart;const rendererFps=intervals.length*1000/intervals.reduce((sum:number,n:number)=>sum+n,0);
   report.renderSample={displayFrequencyHz:display.displayFrequency,sampleDurationMs,rendererFps,intervalCount:intervals.length,p50FrameMs:q(.5),p95FrameMs:q(.95),p99FrameMs:q(.99),maxFrameMs:q(1),summary:renderSample.summary,rawFile:'F1-renderer-luna-frame-raw.json',measurement:'renderer ticker interval and Pixi submission callback; not GPU completion / compositor / physical presentation'};
   fs.writeFileSync(path.join(evidenceDir,'F1-renderer-luna-frame-raw.json'),JSON.stringify({startedAt:new Date(sampleStart).toISOString(),endedAt:new Date(sampleEnd).toISOString(),displayFrequencyHz:display.displayFrequency,summary:renderSample.summary,frameMs:renderSample.raw.frameMs,cpuSubmissionMs:renderSample.raw.cpuSubmissionMs,focused:renderSample.focused,hasFocus:renderSample.hasFocus,tickerStarted:renderSample.tickerStarted,maxFPS:renderSample.maxFPS,limits:report.limitations},null,2)+'\n');
   rec('short-renderer-frame-sample',`Capture at least 1.5s active renderer intervals, report screen frequency separately`,{displayFrequencyHz:display.displayFrequency,sampleDurationMs,rendererFps,intervalCount:intervals.length,p95FrameMs:q(.95),summary:renderSample.summary,focus:{native:win.isFocused(),document:renderSample.hasFocus,probe:renderSample.focused},notPhysicalPresent:true},sampleDurationMs>=1500&&intervals.length>=Math.floor(sampleDurationMs/1000*30)&&renderSample.tickerStarted);

   // Aim coordinates are observed from the publicly exposed camera transform.
   const canvasRect=await js<any>(`document.querySelector('#dungeonWorld canvas').getBoundingClientRect().toJSON()`);
   const aimPoint={x:canvasRect.x+canvasRect.width*.72,y:canvasRect.y+canvasRect.height*.34};
   await nativeMouse('mouseMove',aimPoint.x,aimPoint.y);await delay(150);
   const aim=await js<any>(`(()=>{const p=window.dungeonProbe,s=p.state,m=s.mouse,c=p.camera,w=c.screenToWorld(m),back=c.worldToScreen(w);return{mouse:m,world:s.pointerWorld,roundTrip:back,camera:{x:c.x,y:c.y,width:c.width,height:c.height,zoom:c.zoom},delta:Math.hypot(back.x-m.x,back.y-m.y)}})()`);
   rec('mouse-world-aim-inverse','Pointer world coordinate equals camera inverse and round-trips screen point within 0.1 CSS px',aim,aim.delta<0.1&&Math.hypot(aim.world.x-aim.camera.x-(aim.mouse.x-aim.camera.width/2)/aim.camera.zoom,aim.world.y-aim.camera.y-(aim.mouse.y-aim.camera.height/2)/aim.camera.zoom)<0.1);

   // Move to the known first ground weapon only by WASD, then activate F.
   const preApproach=await probe();await holdKeys(['D','S'],300);await delay(150);const approached=await probe();
   const target=approached.run?.ground?.find((g:any)=>g.id==='ground-fire');
   const targetDistance=target?Math.hypot(target.x-approached.run.player.x,target.y-approached.run.player.y):Infinity;
   const pickupEligible=Boolean(target&&targetDistance<=48);
   let picked:any=null;
   if(pickupEligible){await key('F');await delay(250);picked=await probe();}
   rec('pickup-with-F-through-nearby-weapon','WASD reaches the visible ground-fire pickup within 48 world units; F puts it in the empty backup slot',{preApproach:{x:preApproach.run.player.x,y:preApproach.run.player.y},approached:{x:approached.run.player.x,y:approached.run.player.y},target,targetDistance,eligible:pickupEligible,after:runCopy(picked)},Boolean(pickupEligible&&picked.run.player.weaponSlots[1]?.kind==='fire'&&!picked.run.ground.some((g:any)=>g.id==='ground-fire')));
   const afterPickupImage=await capture('F1-renderer-luna-pickup.png');if(afterPickupImage)report.screenshots.push(afterPickupImage);

   const beforeTab=await probe();await key('TAB');await delay(220);const afterTab=await probe();
   rec('tab-switches-collected-backup','Tab changes active slot to the carried fire weapon and updates player loadout', {before:runCopy(beforeTab),after:runCopy(afterTab),tabEvents:await js<any>(`window.__f1Events.filter(e=>e.type==='keydown'||e.type==='keyup').slice(-4)`)},Boolean(beforeTab.run.player.weaponSlots[1]?.kind==='fire'&&afterTab.run.player.activeSlot===1&&afterTab.run.player.weaponSlots[afterTab.run.player.activeSlot]?.kind==='fire'));

   // Aim at an existing enemy and hold left mouse to exercise attack input.
   const beforeAttack=await probe();
   const enemy=beforeAttack.run.enemies?.[0];
   let attackResult:any={skipped:'no enemy spawned'};
   if(enemy){
    const screenPoint=await js<any>(`(()=>{const s=window.dungeonProbe.camera.worldToScreen({x:${enemy.x},y:${enemy.y}}),r=document.querySelector('#dungeonWorld canvas').getBoundingClientRect();return{x:s.x+r.x,y:s.y+r.y}})()`);
    await nativeMouse('mouseMove',screenPoint.x,screenPoint.y);await nativeMouse('mouseDown',screenPoint.x,screenPoint.y,'left');await delay(900);
    const held=await probe();await nativeMouse('mouseUp',screenPoint.x,screenPoint.y,'left');await delay(220);const afterAttack=await probe();
    attackResult={target:enemy,screenPoint,held:{buttons:held.buttons,player:held.run.player,enemies:held.run.enemies,projectiles:held.run.projectiles},after:{buttons:afterAttack.buttons,player:afterAttack.run.player,enemies:afterAttack.run.enemies,projectiles:afterAttack.run.projectiles},projectileDelta:afterAttack.run.projectiles.length-beforeAttack.run.projectiles.length,enemyHpBefore:enemy.hp,enemyHpAfter:afterAttack.run.enemies.find((e:any)=>e.id===enemy.id)?.hp??null,mouseEvents:await js<any>(`window.__f1Events.filter(e=>e.type.startsWith('pointer')).slice(-8)`)};
   }
   const activeDuringClick=Boolean(attackResult.held?.buttons===1||attackResult.held?.run?.player?.firing);
   const attackEffect=Boolean((attackResult.projectileDelta??0)>0||(attackResult.enemyHpAfter!==null&&attackResult.enemyHpAfter<attackResult.enemyHpBefore));
   rec('left-click-hold-aim-and-attack','Left mouse held on a live enemy sets firing/aim and yields a projectile or enemy HP loss',attackResult,enemy?Boolean(activeDuringClick&&attackEffect):undefined);
   const attackImage=await capture('F1-renderer-luna-attack.png');if(attackImage)report.screenshots.push(attackImage);

   // Right click is a real native pointer input; verify dash cooldown/direction.
   const beforeRoll=await probe();
   const rollCanvas=await js<any>(`document.querySelector('#dungeonWorld canvas').getBoundingClientRect().toJSON()`);
   const rollX=rollCanvas.x+rollCanvas.width*.66,rollY=rollCanvas.y+rollCanvas.height*.58;
   await nativeMouse('mouseMove',rollX,rollY);await nativeMouse('mouseDown',rollX,rollY,'right');await delay(55);await nativeMouse('mouseUp',rollX,rollY,'right');await delay(110);const afterRoll=await probe();
   rec('right-click-roll','Right-click dispatches dash, raises dashReady and advances dash state',{before:runCopy(beforeRoll),after:runCopy(afterRoll),rightPointerEvents:await js<any>(`window.__f1Events.filter(e=>e.type==='pointerdown'||e.type==='pointerup').slice(-6)`)},Boolean(afterRoll.run.player.dashReady>beforeRoll.run.player.dashReady&&afterRoll.run.player.dashUntil>=beforeRoll.run.elapsedMs));

   // Zoom through the actual range control, compare world coverage and fixed HUD CSS size.
   const setZoom=async(value:number)=>{
    const data=await js<any>(`(()=>{const e=document.getElementById('dungeonZoom'),r=e.getBoundingClientRect();return{r:{x:r.x,y:r.y,width:r.width,height:r.height},min:Number(e.min),max:Number(e.max),value:Number(e.value)}})()`);
    const ratio=(value-data.min)/(data.max-data.min),x=data.r.x+8+ratio*Math.max(1,data.r.width-16),y=data.r.y+data.r.height/2;
    // Click the desired point directly. A track mousedown followed by a
    // scripted drag can snap to the endpoint in Chromium's range control.
    await nativeMouse('mouseMove',x,y);await nativeMouse('mouseDown',x,y);await delay(40);await nativeMouse('mouseUp',x,y);await delay(180);
    return{state:await probe(),rangeValue:Number(await js<string>(`document.getElementById('dungeonZoom').value`)),target:value,click:{x,y}};
   };
   const zoom1Result=await setZoom(1),zoom1=zoom1Result.state;const zoom1Image=await capture('F1-renderer-luna-zoom-1.png');if(zoom1Image)report.screenshots.push(zoom1Image);
   const zoom2Result=await setZoom(2),zoom2=zoom2Result.state;const zoom2Image=await capture('F1-renderer-luna-zoom-2.png');if(zoom2Image)report.screenshots.push(zoom2Image);
   const widthRatio=zoom1.visibleTiles/zoom2.visibleTiles;
   const hudDelta=Math.max(Math.abs(zoom1.hud.width-zoom2.hud.width),Math.abs(zoom1.hud.height-zoom2.hud.height));
   rec('zoom-1-vs-2-world-and-fixed-hud','Range input sets zoom 1 and 2; visible world width halves; tile screen size doubles; HUD CSS dimensions stay fixed',{zoom1:{zoom:zoom1.zoom,visibleTiles:zoom1.visibleTiles,tileScreenSize:zoom1.tileScreenSize,hud:zoom1.hud,range:zoom1Result.rangeValue,clicked:zoom1Result.click},zoom2:{zoom:zoom2.zoom,visibleTiles:zoom2.visibleTiles,tileScreenSize:zoom2.tileScreenSize,hud:zoom2.hud,range:zoom2Result.rangeValue,clicked:zoom2Result.click},widthRatio,hudMaxDelta:hudDelta},Math.abs(zoom1.zoom-1)<.03&&Math.abs(zoom2.zoom-2)<.03&&Math.abs(zoom1Result.rangeValue-1)<.03&&Math.abs(zoom2Result.rangeValue-2)<.03&&Math.abs(widthRatio-2)<.08&&Math.abs(zoom2.tileScreenSize/zoom1.tileScreenSize-2)<.08&&hudDelta<.5);
   // Verify the inverse after 2x zoom as well.
   const rect2=await js<any>(`document.querySelector('#dungeonWorld canvas').getBoundingClientRect().toJSON()`);await nativeMouse('mouseMove',rect2.x+rect2.width*.78,rect2.y+rect2.height*.31);await delay(100);
   const aim2=await js<any>(`(()=>{const p=window.dungeonProbe,m=p.state.mouse,w=p.state.pointerWorld,c=p.camera,b=c.worldToScreen(w);return{mouse:m,world:w,back:b,zoom:c.zoom,error:Math.hypot(b.x-m.x,b.y-m.y)}})()`);
   rec('zoomed-mouse-aim-inverse','At 2x zoom, canvas pointer maps through inverse camera transform',aim2,aim2.zoom>1.95&&aim2.error<.1);

   // Pause with Esc, verify clear and frozen time/frame; then resume and minimize while a key is held.
   // Keep the actual zoom range focused: gameplay keys should still be routed
   // while a non-text control owns DOM focus.
   const pauseKeyboardTarget=await js<any>(`({tag:document.activeElement?.tagName,type:document.activeElement?.getAttribute('type'),id:document.activeElement?.id})`);
   const pauseBefore=await probe();win.webContents.sendInputEvent({type:'keyDown',keyCode:'D'});await delay(140);const heldForPause=await probe();
   win.webContents.sendInputEvent({type:'keyDown',keyCode:'ESC'});await delay(90);win.webContents.sendInputEvent({type:'keyUp',keyCode:'ESC'});await delay(180);
   const paused=await probe();await capture('F1-renderer-luna-paused.png');const pauseTick=paused.run.tick,pauseFrame=paused.frameCount;await delay(600);const stillPaused=await probe();
   win.webContents.sendInputEvent({type:'keyUp',keyCode:'D'});
   rec('escape-pause-clears-input-and-freezes','With the zoom range still focused, D is routed as movement; Esc pauses and clears it, then simulation tick/frameCount remain stable',{before:runCopy(pauseBefore),keyboardTarget:pauseKeyboardTarget,heldForPause:{keys:heldForPause.keys,moveX:heldForPause.run.player.moveX,moveY:heldForPause.run.player.moveY},paused:runCopy(paused),keys:paused.keys,buttons:paused.buttons,frameCountBefore:pauseFrame,frameCountAfter:stillPaused.frameCount,tickBefore:pauseTick,tickAfter:stillPaused.run.tick,tickerStarted:stillPaused.tickerStarted,focused:stillPaused.focused},Boolean(pauseKeyboardTarget.id==='dungeonZoom'&&heldForPause.keys.includes('KeyD')&&heldForPause.run.player.moveX===1&&paused.run.paused&&paused.keys.length===0&&paused.buttons===0&&paused.run.player.moveX===0&&paused.run.player.moveY===0&&!paused.run.player.firing&&stillPaused.run.tick===pauseTick&&stillPaused.frameCount===pauseFrame&&!stillPaused.tickerStarted));
   const resumeRect=await clickRect('[data-command="resume"]');await delay(250);const resumed=await probe();
   rec('resume-through-public-button','Click visible resume button returns to active exploration without resetting position',{resumeRect,after:runCopy(resumed),before:{x:paused.run.player.x,y:paused.run.player.y}},Boolean(resumeRect&&!resumed.run.paused&&Math.hypot(resumed.run.player.x-paused.run.player.x,resumed.run.player.y-paused.run.player.y)<1));

   // Hold a movement key while invoking the actual minimize control. The button
   // handler and native blur/minimize are both expected to clear and pause.
   win.webContents.sendInputEvent({type:'keyDown',keyCode:'D'});await delay(130);const heldForMin=await probe();
   const minRect=await clickRect('#minimizeDungeon');
   await until(()=>Boolean(win&&!win.isDestroyed()&&win.isMinimized()),Boolean,'native arena minimized',5000).catch(()=>false);
   await delay(250);const minimized=await probe().catch(()=>null);const minTick=minimized?.run?.tick;const minPosition=minimized?.run?.player?{x:minimized.run.player.x,y:minimized.run.player.y}:null;const minFrames=minimized?.frameCount;
   await delay(600);const minimizedLater=await probe().catch(()=>null);
   rec('minimize-pauses-and-clears-held-key','Actual minimize button minimizes window, pauses, clears controls; worker tick does not advance and renderer ticker stays stopped',{buttonRect:minRect,heldBefore:{keys:heldForMin.keys,moveX:heldForMin.run.player.moveX},nativeMinimized:win.isMinimized(),after:minimized?{tick:minTick,player:minPosition,keys:minimized.keys,moveX:minimized.run.player.moveX,moveY:minimized.run.player.moveY,firing:minimized.run.player.firing,frameCount:minFrames,tickerStarted:minimized.tickerStarted}:null,later:minimizedLater?{tick:minimizedLater.run.tick,player:{x:minimizedLater.run.player.x,y:minimizedLater.run.player.y},keys:minimizedLater.keys,frameCount:minimizedLater.frameCount,tickerStarted:minimizedLater.tickerStarted}:null},Boolean(minRect&&win.isMinimized()&&minimized?.run?.paused&&minimized.keys.length===0&&minimized.run.player.moveX===0&&minimized.run.player.moveY===0&&!minimized.run.player.firing&&minimizedLater?.run?.tick===minTick&&minimizedLater?.frameCount===minFrames&&!minimizedLater?.tickerStarted));
   if(win.isMinimized())win.restore();
   await delay(350);const restored=await probe().catch(()=>null);
   const restoredImg=await capture('F1-renderer-luna-restored.png');if(restoredImg)report.screenshots.push(restoredImg);
   const restoredPosition=restored?.run?.player?{x:restored.run.player.x,y:restored.run.player.y}:null;
   rec('restore-does-not-teleport','Native restore retains the same paused run position; no synthetic refocus is attempted',{windowVisible:win.isVisible(),windowMinimized:win.isMinimized(),nativeFocused:win.isFocused(),restored:restored?{paused:restored.run.paused,tick:restored.run.tick,position:restoredPosition,probeFocused:restored.focused,hasDocumentFocus:restored.hasDocumentFocus,keys:restored.keys,frameCount:restored.frameCount,tickerStarted:restored.tickerStarted}:null,preMinimizePosition:minPosition},Boolean(restored&&restored.run.paused&&restored.run.tick===minTick&&restoredPosition&&minPosition&&Math.hypot(restoredPosition.x-minPosition.x,restoredPosition.y-minPosition.y)<1&&restored.keys.length===0));
   // Do not explicitly steal focus if OS restore did not naturally return it.
   if(!win.isFocused()||!restored?.hasDocumentFocus)event('no-focus-after-restore','Further keyboard/mouse actions stopped; no harness refocus attempted');
  }
  report.inputEvents=await js<any>(`window.__f1Events??[]`).catch(()=>[]);
  report.inputEventsSummary={trusted:report.inputEvents.filter((e:any)=>['keydown','keyup','pointerdown','pointerup'].includes(e.type)).map((e:any)=>({type:e.type,code:e.code,key:e.key,button:e.button,buttons:e.buttons,isTrusted:e.isTrusted,hasFocus:e.hasFocus})),total:report.inputEvents.length};
  rec('arena-renderer-has-no-console-or-load-errors','No console error, failed navigation, or renderer crash in arena webContents',errors,errors.length===0);
 }catch(error){
  errors.push({kind:'harness-error',detail:String(error)});event('harness-error',{error:String(error),stack:(error as Error)?.stack});
 }finally{
  try{if(shell?.arenaWindow&&!shell.arenaWindow.isDestroyed())shell.closeArena();}catch{}
  report.endedAt=new Date().toISOString();report.overall=checks.some(c=>c.status==='fail')?'FAIL':checks.some(c=>c.status==='not-run')?'PARTIAL':'PASS_WITH_SCRIPTED_INPUT_LIMITS';
  report.checks=checks;report.errors=errors;report.events=events;
  const jsonPath=path.join(evidenceDir,'F1-renderer-luna.json');fs.writeFileSync(jsonPath,JSON.stringify(report,null,2)+'\n');
  const md=[
   '# F1 Native Renderer Review (Luna)',
   '',
   `- Result: **${report.overall}**`,
   `- Started: ${startedAt}`,
   `- Finished: ${report.endedAt}`,
   `- Isolated profile: \`${profile}\` (temporary directory; marker created and checked; real profile not opened).`,
   `- Runtime: Electron ${process.versions.electron}, ${process.platform}/${process.arch}; target display ${report.runtime?.focusDisplayHz??'unknown'} Hz.`,
   '- Inputs used Electron `WebContents.sendInputEvent` into the real arena window; no repeated harness focus action was used. This is not physical keyboard/mouse evidence.',
   '- `capturePage` is renderer evidence. Frame intervals and CPU submission are not GPU completion, compositor timing, or physical presentation.',
   '',
   '| Check | Expected | Status | Actual |',
   '|---|---|---:|---|',
   ...checks.map(c=>`| ${c.name} | ${c.expected.replace(/\|/g,'\\|')} | ${c.status.toUpperCase()} | \`${JSON.stringify(c.actual).replace(/`/g,"'").replace(/\|/g,'\\|')}\` |`),
   '',
   '## Frame sample',
   '',
   `Renderer measured ${report.renderSample?.rendererFps??'not sampled'} FPS across ${report.renderSample?.intervalCount??0} intervals on a display reporting ${report.renderSample?.displayFrequencyHz??'unknown'} Hz. Raw intervals are in [F1-renderer-luna-frame-raw.json](./F1-renderer-luna-frame-raw.json). This is renderer ticker cadence, not proof of physical display refresh.`,
   '',
   '## Captures',
   '',
   ...(report.screenshots.length?report.screenshots.map((s:string)=>`- [${s}](./${s})`):['No screenshots captured.']),
   '',
   '## Limits',
   '',
   ...report.limitations.map((s:string)=>`- ${s}`),
   ''
  ].join('\n');
  fs.writeFileSync(path.join(evidenceDir,'F1-renderer-luna.md'),md);
  console.log(JSON.stringify({overall:report.overall,profile,checks:checks.map(c=>({name:c.name,status:c.status})),errors,report:'docs/evidence/dungeon-040/F1-renderer-luna.md'},null,2));
  app.quit();
 }
}
void main();
