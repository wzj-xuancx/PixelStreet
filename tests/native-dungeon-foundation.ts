import {app, BrowserWindow, screen} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {markIsolatedFolder, configureDataPaths} from '../apps/desktop/launch-profile';

const root=process.cwd();
const evidenceDir=path.join(root,'docs/evidence/dungeon-040');
const evidenceName=(process.env.PIXELSTREET_F0_EVIDENCE??'attempt-03').replace(/[^a-zA-Z0-9_-]/g,'-');
const workDir=path.join(root,'work');
fs.mkdirSync(evidenceDir,{recursive:true});fs.mkdirSync(workDir,{recursive:true});
const startedAt=new Date().toISOString();
const profile=fs.mkdtempSync(path.join(workDir,'native-dungeon-profile-'));
const checks:{name:string;pass:boolean;detail:unknown}[]=[];
const failures:string[]=[];
const events:{at:string;name:string;detail?:unknown}[]=[];
let win:BrowserWindow|undefined;
let rendererErrors:{kind:string;detail:string}[]=[];
let rendererConsole:{level:string|number;message:string;line?:number;sourceId?:string}[]=[];
let scriptErrors:string[]=[];
const sourceFiles=['packages/dungeon-core/foundation.ts','tests/dungeon-camera.test.ts','apps/desktop/renderer/foundation-probe.ts','dist/renderer/foundation-probe.js','dist/renderer/foundation-probe.html'];
const sha=(p:string)=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex');
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const record=(name:string,pass:boolean,detail:unknown)=>{checks.push({name,pass,detail});if(!pass)failures.push(name);};
const event=(name:string,detail?:unknown)=>events.push({at:new Date().toISOString(),name,detail});
const timeout=async<T>(promise:Promise<T>,ms:number,label:string):Promise<T>=>Promise.race([promise,new Promise<T>((_,reject)=>setTimeout(()=>reject(new Error(`${label} timed out after ${ms}ms`)),ms))]);
const waitUntil=async<T>(read:()=>Promise<T>,predicate:(value:T)=>boolean,label:string,ms=10000):Promise<T>=>{
 const end=Date.now()+ms;let last:T;
 do{last=await read();if(predicate(last))return last;await delay(50);}while(Date.now()<end);
 throw new Error(`${label} did not become ready; last=${JSON.stringify(last)}`);
};
const js=async<T>(expression:string):Promise<T>=>{
 if(!win||win.isDestroyed())throw new Error('Probe window is unavailable');
 return win.webContents.executeJavaScript(expression,true) as Promise<T>;
};
const probeState=()=>js<any>(`(()=>{const p=window.foundationProbe;return p&&{state:p.state,frames:p.stats.frames,tickerStarted:p.app.ticker.started,zoom:p.camera.zoom,camera:{x:p.camera.x,y:p.camera.y,width:p.camera.width,height:p.camera.height,visibleWorld:p.camera.visibleWorld},aside:document.querySelector('aside')?.getBoundingClientRect().toJSON(),hud:document.querySelector('#hud')?.getBoundingClientRect().toJSON(),hasFocus:document.hasFocus(),ready:document.body.dataset.ready==='true'}})()`);
const focusProbe=async()=>{
 if(!win||win.isDestroyed())throw new Error('Probe window is unavailable');
 const before=await probeState().catch(()=>null);
 if(win.isFocused()&&before?.hasFocus&&before?.state?.focused&&before?.tickerStarted){
  await delay(250);
  const stable=await probeState();
  return {...stable,focusOk:Boolean(win.isFocused()&&stable.hasFocus&&stable.state?.focused&&stable.tickerStarted),focusMomentary:true,focusStable250ms:Boolean(win.isFocused()&&stable.hasFocus&&stable.state?.focused&&stable.tickerStarted),focusAction:'already-focused; observed 250ms without refocusing'};
 }
 if(win.isMinimized())win.restore();
 win.show();app.focus({steal:true});win.focus();win.webContents.focus();
 try{
  const momentary=await waitUntil(probeState,s=>Boolean(s?.hasFocus&&s?.state?.focused&&s?.tickerStarted),'document focus and active Pixi ticker',6000);
  await delay(250);
  const stable=await probeState();
  return {...stable,focusOk:Boolean(stable.hasFocus&&stable.state?.focused&&stable.tickerStarted),focusMomentary:true,focusStable250ms:Boolean(stable.hasFocus&&stable.state?.focused&&stable.tickerStarted),momentary:{hasFocus:momentary.hasFocus,focused:momentary.state?.focused,tickerStarted:momentary.tickerStarted}};
 }
 catch(error){return {...(await probeState().catch(()=>({}))),focusOk:false,focusError:String(error)};}
};
const hashInputs=Object.fromEntries(sourceFiles.map(p=>[p,sha(p)]));

// Set and validate the dedicated data paths before app.whenReady, exactly as production does.
const appData=app.getPath('appData');
markIsolatedFolder(profile,appData);
configureDataPaths(app,appData,profile);
const expectedSession=path.join(profile,'session');
if(app.getPath('userData')!==profile||app.getPath('sessionData')!==expectedSession||profile===path.join(appData,'PixelStreetS1')){
 throw new Error('Isolated Electron paths did not resolve to the unique temporary profile');
}

const report:any={
 schema:'pixelstreet.dungeon-f0.native-review.v1',candidate:'PixelStreet-0.4.0',startedAt,
 buildBaseline:{sourceAndRendererSha256:hashInputs},
 isolation:{status:'verified-before-ready',profile,marker:fs.readFileSync(path.join(profile,'.pixelstreet-isolated-profile.json'),'utf8'),userData:app.getPath('userData'),sessionData:app.getPath('sessionData'),realProfileOpened:false},
 runtime:{},checks,events,rendererErrors,rendererConsole,scriptErrors,failures,
 limits:['Input was delivered through Electron sendInputEvent / executeJavaScript, not physical keyboard or mouse.','Ticker timestamps measure renderer cadence; they do not prove GPU completion or physical display presentation.']
};

async function main():Promise<void>{
 try{
  await app.whenReady();
  const displays=screen.getAllDisplays().map(d=>({id:d.id,bounds:d.bounds,workArea:d.workArea,size:d.size,scaleFactor:d.scaleFactor,rotation:d.rotation,displayFrequency:d.displayFrequency,internal:d.internal}));
  let gpu:any;
  try{gpu=await timeout(app.getGPUInfo('complete'),6000,'GPU information');}
  catch(error){gpu={error:String(error)};}
  const gpuSummary=gpu&&typeof gpu==='object'?{
   machineModelName:gpu.machineModelName,machineModelVersion:gpu.machineModelVersion,
   driverVersion:gpu.driverVersion,gpuDevice:gpu.gpuDevice,auxAttributes:gpu.auxAttributes,
   featureStatus:app.getGPUFeatureStatus()
  }:gpu;
  report.runtime={electron:process.versions.electron,chrome:process.versions.chrome,node:process.versions.node,platform:process.platform,arch:process.arch,displays,gpu:gpuSummary};
  record('isolated-userdata-and-sessiondata',app.getPath('userData')===profile&&app.getPath('sessionData')===expectedSession,{userData:app.getPath('userData'),sessionData:app.getPath('sessionData'),markerPresent:fs.existsSync(path.join(profile,'.pixelstreet-isolated-profile.json'))});
  const gpuHardwareRecorded=Array.isArray(gpuSummary?.gpuDevice)&&gpuSummary.gpuDevice.length>0;
  record('display-frequency-and-hardware-recorded',displays.length>0&&displays.every(d=>Number.isFinite(d.displayFrequency))&&gpuHardwareRecorded,{displays,gpu:gpuSummary,gpuHardwareRecorded});

  const targetDisplayInfo=screen.getAllDisplays().sort((a,b)=>b.displayFrequency-a.displayFrequency)[0];
  const width=Math.min(1120,Math.max(800,targetDisplayInfo.workArea.width-40));
  const height=Math.min(760,Math.max(600,targetDisplayInfo.workArea.height-60));
  win=new BrowserWindow({x:targetDisplayInfo.workArea.x+40,y:targetDisplayInfo.workArea.y+40,width,height,show:false,title:'PixelStreet F0 Dungeon Foundation Probe',webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});
  win.on('closed',()=>event('window-closed'));
  win.on('focus',()=>event('native-window-focus'));
  win.on('blur',()=>event('native-window-blur'));
  win.on('minimize',()=>event('native-window-minimize'));
  win.on('restore',()=>event('native-window-restore'));
  win.webContents.on('console-message',(details,legacyLevel,legacyMessage,legacyLine,legacySource)=>{
   const event:any=details as any;
   const level:string|number=typeof event.level==='number'||typeof event.level==='string'?event.level:legacyLevel;
   const message=typeof event.message==='string'?event.message:legacyMessage;
   const line=typeof event.lineNumber==='number'?event.lineNumber:typeof event.line==='number'?event.line:legacyLine;
   const sourceId=typeof event.sourceId==='string'?event.sourceId:legacySource;
   rendererConsole.push({level,message,line,sourceId});
   const isError=typeof level==='number'?level>=3:level==='error';
   if(isError)rendererErrors.push({kind:'console-error',detail:`${message} (${sourceId}:${line})`});
  });
  win.webContents.on('render-process-gone',(_e,details)=>rendererErrors.push({kind:'render-process-gone',detail:JSON.stringify(details)}));
  win.webContents.on('did-fail-load',(_e,code,description,url)=>rendererErrors.push({kind:'did-fail-load',detail:`${code} ${description} ${url}`}));
  const page=path.join(root,'dist/renderer/foundation-probe.html');
  await win.loadURL(new URL(`file://${page}`).href);
  win.show();
  const ready=await waitUntil(probeState,s=>Boolean(s?.ready&&s?.state),'probe module and Pixi application',15000);
  const sampleDisplay=screen.getDisplayMatching(win.getBounds());
  event('probe-ready',{url:win.webContents.getURL(),bounds:win.getBounds(),ready:ready.ready,hasFocus:ready.hasFocus,selectedDisplay:{id:sampleDisplay.id,displayFrequency:sampleDisplay.displayFrequency,scaleFactor:sampleDisplay.scaleFactor}});
  record('probe-loaded-and-renderer-ready',Boolean(ready.ready&&ready.state),{url:win.webContents.getURL(),rendererPid:win.webContents.getOSProcessId(),hasFocus:ready.hasFocus,tickerStarted:ready.tickerStarted,canvas:await js<any>(`document.querySelector('canvas')?.getBoundingClientRect().toJSON()`)});
  const stateGetter=await js<any>(`(()=>{const d=Object.getOwnPropertyDescriptor(window.foundationProbe,'state');return{hasGetter:typeof d?.get==='function',hasSetter:typeof d?.set==='function',valueKeys:Object.keys(window.foundationProbe.state||{})}})()`);
  record('probe-live-state-getter-preserved',stateGetter.hasGetter&&stateGetter.valueKeys.includes('p')&&stateGetter.valueKeys.includes('focused'),stateGetter);
  await js(`(()=>{window.__f0InputAudit=[];for(const type of ['keydown','keyup','focus','blur'])window.addEventListener(type,e=>window.__f0InputAudit.push({type,at:performance.now(),code:e.code||'',key:e.key||'',isTrusted:e.isTrusted,hasFocus:document.hasFocus(),visibility:document.visibilityState,repeat:e.repeat,meta:e.metaKey,ctrl:e.ctrlKey,alt:e.altKey,shift:e.shiftKey}),true);const canvas=document.querySelector('canvas');canvas.addEventListener('pointermove',e=>window.__f0InputAudit.push({type:'pointermove',at:performance.now(),clientX:e.clientX,clientY:e.clientY,isTrusted:e.isTrusted,hasFocus:document.hasFocus(),visibility:document.visibilityState,world:{...window.foundationProbe.state.pointer}}));})()`);
  const focusedBeforeSample=await focusProbe();
  record('explicit-test-focus-activates-ticker',Boolean(focusedBeforeSample.focusOk&&focusedBeforeSample.hasFocus&&focusedBeforeSample.state?.focused&&focusedBeforeSample.tickerStarted),{windowFocused:win.isFocused(),hasFocus:focusedBeforeSample.hasFocus,probeFocused:focusedBeforeSample.state?.focused,tickerStarted:focusedBeforeSample.tickerStarted,focusError:focusedBeforeSample.focusError,focusStable250ms:focusedBeforeSample.focusStable250ms,focusAction:focusedBeforeSample.focusAction??'test harness called app.focus, BrowserWindow.focus, and WebContents.focus'});

  // Capture initial state only after renderer readiness; no forced state normalization.
  const initial=await probeState();
  const workArea=sampleDisplay.workArea;
  record('probe-window-visible-with-renderer-canvas',win.isVisible()&&Boolean(initial.state)&&initial.camera.width>0&&initial.camera.height>0,{visible:win.isVisible(),bounds:win.getBounds(),workArea,initial});

  // Preserve a paired capped/follow-refresh sample on the fastest reported display.
  const renderSamples=[] as any[];
  const collectRenderSample=async(label:string,seconds:number)=>{
   const focusAtStart={windowFocused:win?.isFocused()??false,state:await probeState()};
   const eventStart=events.length;
   await js(`window.foundationProbe.stats.reset()`);
   const sampleStart=Date.now();await delay(seconds*1000);const sampleEnd=Date.now();
   const sample=await js<any>(`(()=>({summary:window.foundationProbe.stats.summary(),raw:window.foundationProbe.stats.raw(),frames:window.foundationProbe.stats.frames,tickerStarted:window.foundationProbe.app.ticker.started,maxFPS:window.foundationProbe.app.ticker.maxFPS,elapsed:performance.now(),hasFocus:document.hasFocus(),probeFocused:window.foundationProbe.state.focused,keys:window.foundationProbe.state.keys}))()`);
   const focusEvents=events.slice(eventStart).filter(e=>e.name==='native-window-blur'||e.name==='native-window-minimize');
   const expectedFrames=Math.floor(seconds*Math.min(sampleDisplay.displayFrequency,sample.maxFPS||sampleDisplay.displayFrequency));
   const continuous=Boolean(focusAtStart.windowFocused&&focusAtStart.state.hasFocus&&focusAtStart.state.state?.focused&&focusAtStart.state.tickerStarted&&sample.hasFocus&&sample.probeFocused&&sample.tickerStarted&&focusEvents.length===0&&sample.summary.samples>=expectedFrames*.8);
   const row={label,startedAt:new Date(sampleStart).toISOString(),endedAt:new Date(sampleEnd).toISOString(),wallSeconds:(sampleEnd-sampleStart)/1000,summary:sample.summary,frameCount:sample.frames,tickerStarted:sample.tickerStarted,maxFPS:sample.maxFPS,raw:sample.raw,displayFrequency:sampleDisplay.displayFrequency,displayId:sampleDisplay.id,physical120HzPresentationProven:false,focusAtStart:{windowFocused:focusAtStart.windowFocused,hasFocus:focusAtStart.state.hasFocus,probeFocused:focusAtStart.state.state?.focused,tickerStarted:focusAtStart.state.tickerStarted},focusAtEnd:{hasFocus:sample.hasFocus,probeFocused:sample.probeFocused,tickerStarted:sample.tickerStarted},focusOrMinimizeEvents:focusEvents,expectedFrames,validity:continuous?'VALID_ACTIVE_WINDOW_SAMPLE':'INVALID_FOCUS_OR_INSUFFICIENT_ACTIVE_FRAMES'};
   renderSamples.push(row);
   record(`render-sample-${label}`,row.wallSeconds>=seconds&&row.validity==='VALID_ACTIVE_WINDOW_SAMPLE'&&sample.raw.frameMs.length===sample.summary.samples&&sample.raw.cpuSubmissionMs.length===sample.summary.samples,{wallSeconds:row.wallSeconds,summary:sample.summary,rawCounts:{frameMs:sample.raw.frameMs.length,cpuSubmissionMs:sample.raw.cpuSubmissionMs.length},maxFPS:sample.maxFPS,displayFrequency:sampleDisplay.displayFrequency,displayId:sampleDisplay.id,focusAtStart:row.focusAtStart,focusAtEnd:row.focusAtEnd,focusOrMinimizeEvents:focusEvents,expectedFrames,validity:row.validity});
   return row;
  };
  const capped=await collectRenderSample('maxfps-120',5);
  record('maxfps-120-cadence',capped.validity==='VALID_ACTIVE_WINDOW_SAMPLE'&&capped.summary.fps>=108&&capped.summary.fps<=126,{observedTickerFPS:capped.summary.fps,meanIntervalMs:capped.summary.p50,displayFrequency:sampleDisplay.displayFrequency,configuredMaxFPS:capped.maxFPS,validity:capped.validity});
  await js(`window.foundationProbe.app.ticker.maxFPS=0`);
  const follow=await collectRenderSample('follow-display',5);
  record('follow-display-cadence',follow.validity==='VALID_ACTIVE_WINDOW_SAMPLE'&&(sampleDisplay.displayFrequency<120?follow.summary.fps>0:follow.summary.fps>=sampleDisplay.displayFrequency*.88),{observedTickerFPS:follow.summary.fps,meanIntervalMs:follow.summary.p50,displayFrequency:sampleDisplay.displayFrequency,configuredMaxFPS:follow.maxFPS,validity:follow.validity});
  report.renderSamples=renderSamples;
  report.renderSample=renderSamples[0];
  report.physical120HzPresentationProven=false;
  record('renderer-cadence-reported-without-claiming-presentation',renderSamples.every(s=>s.validity==='VALID_ACTIVE_WINDOW_SAMPLE'&&s.summary.fps>0),{samples:renderSamples.map(s=>({label:s.label,observedTickerFPS:s.summary.fps,displayFrequency:s.displayFrequency,displayId:s.displayId,validity:s.validity})),physical120HzPresentationProven:false});
  await js(`window.foundationProbe.app.ticker.maxFPS=120`);

  // Zoom changes only the world transform. The screen-space HUD panel should not scale.
  await js(`(()=>{const el=document.querySelector('#zoom');el.value='1';el.dispatchEvent(new Event('input',{bubbles:true}));})()`);await delay(50);
  const zoom1=await probeState();
  await js(`(()=>{const el=document.querySelector('#zoom');el.value='2';el.dispatchEvent(new Event('input',{bubbles:true}));})()`);await delay(50);
  const zoom2=await probeState();
  const gridRatio=zoom2.state.visibleTiles/zoom1.state.visibleTiles;
  const hudStable=Math.abs(zoom2.aside.width-zoom1.aside.width)<0.01&&Math.abs(zoom2.aside.height-zoom1.aside.height)<0.01;
  record('zoom-one-to-two-halves-world-grid',Math.abs(gridRatio-.5)<1e-8,{zoom1:zoom1.zoom,zoom2:zoom2.zoom,visibleTiles1:zoom1.state.visibleTiles,visibleTiles2:zoom2.state.visibleTiles,ratio:gridRatio,tileScreenSize1:zoom1.state.tileScreenSize,tileScreenSize2:zoom2.state.tileScreenSize});
  record('hud-screen-size-is-zoom-invariant',hudStable,{asideAtZoom1:zoom1.aside,asideAtZoom2:zoom2.aside,hudTextAtZoom1:zoom1.hud,hudTextAtZoom2:zoom2.hud});

  // Mouse coordinates are injected into WebContents in CSS/DIP coordinates, then compared to the camera inverse.
  await js(`(()=>{const el=document.querySelector('#zoom');el.value='1';el.dispatchEvent(new Event('input',{bubbles:true}));})()`);await delay(50);
  const canvas=await js<any>(`document.querySelector('canvas').getBoundingClientRect().toJSON()`);
  const pointerAuditStart=await js<number>(`window.__f0InputAudit.length`);
  const pointerStartAt=await js<number>(`performance.now()`);
  const mouse={x:Math.round(canvas.width*.72),y:Math.round(canvas.height*.64)};
  const pointerBefore=await probeState();
  const pointerInputFocused=Boolean(win.isFocused()&&pointerBefore.hasFocus&&pointerBefore.state.focused);
  if(pointerInputFocused){win.webContents.sendInputEvent({type:'mouseMove',x:mouse.x,y:mouse.y});await delay(300);}
  const pointerEvents=pointerInputFocused?await js<any[]>(`window.__f0InputAudit.slice(${pointerAuditStart}).filter(e=>e.type==='pointermove')`):[];
  const pointerEvent=pointerEvents[0]??null;
  const pointerEventDelayMs=pointerEvent?pointerEvent.at-pointerStartAt:null;
  const pointerWithin300ms=typeof pointerEventDelayMs==='number'&&pointerEventDelayMs<=300;
  const pointerAtFirstEvent=pointerEvent?.world??null;
  const pointer=await probeState();
  const expected=pointerEvent?await js<any>(`(()=>{const r=document.querySelector('canvas').getBoundingClientRect();return window.foundationProbe.camera.screenToWorld({x:${pointerEvent.clientX}-r.x,y:${pointerEvent.clientY}-r.y})})()`):null;
  const worldFromScreen=await js<any>(`window.foundationProbe.camera.screenToWorld(window.foundationProbe.camera.worldToScreen({x:713.25,y:129.75}))`);
  const screenInverse=await js<any>(`window.foundationProbe.camera.worldToScreen({x:713.25,y:129.75})`);
  const back=await js<any>(`window.foundationProbe.camera.screenToWorld({x:${screenInverse.x},y:${screenInverse.y}})`);
  const pointerMapMatches=Boolean(pointerEvent&&expected&&pointerAtFirstEvent&&Math.hypot(pointerAtFirstEvent.x-expected.x,pointerAtFirstEvent.y-expected.y)<1e-5);
  record('screen-world-mouse-inverse',pointerMapMatches&&pointerWithin300ms,{requestedContentPoint:mouse,pointerInputFocused,skippedReason:pointerInputFocused?undefined:'window or renderer not focused; input was not sent',deliveredPointerEvent:pointerEvent,pointerEventDelayMs,pointerWithin300ms,pointerAtFirstEvent,latestPointer:pointer.state.pointer,expectedFromDeliveredEvent:expected,laterPointerEvents:Math.max(0,pointerEvents.length-1),inputMode:'Electron WebContents.sendInputEvent; compare the first delivered event coordinates to world-at-that-event, not later pointer state'});
  record('camera-screen-world-math-roundtrip',Math.hypot(back.x-worldFromScreen.x,back.y-worldFromScreen.y)<1e-8,{world:{x:713.25,y:129.75},screen:screenInverse,back});
  event('pointer-input-delivery-diagnostic',{requested:mouse,first:pointerEvent,delayMs:pointerEventDelayMs,within300ms:pointerWithin300ms,pointerInputFocused,eventCount:pointerEvents.length});

  // App-level directional input is sent via Electron and intentionally is not treated as physical input.
  const directions:{code:string;expect:(dx:number,dy:number)=>boolean}[]=[
   {code:'W',expect:(_dx,dy)=>dy< -12},{code:'A',expect:(dx)=>dx< -12},{code:'S',expect:(_dx,dy)=>dy>12},{code:'D',expect:(dx)=>dx>12}
  ];
  const directionResults=[] as any[];
  const keyboardFocus=[] as any[];
  const keyboardActivation=await probeState();
  keyboardFocus.push({stage:'keyboard-phase-focus-check',windowFocused:win.isFocused(),hasFocus:keyboardActivation.hasFocus,probeFocused:keyboardActivation.state?.focused,tickerStarted:keyboardActivation.tickerStarted,action:'no focus-steal; proceed only while already focused'});
  const keyboardStageFocus=await probeState();
  keyboardFocus.push({stage:'before-WASD',windowFocused:win.isFocused(),hasFocus:keyboardStageFocus.hasFocus,probeFocused:keyboardStageFocus.state?.focused,tickerStarted:keyboardStageFocus.tickerStarted});
  for(const direction of directions){
   const beforeSnapshot=await probeState();
   const before=beforeSnapshot.state.p;
   const inputCanReach=Boolean(win.isFocused()&&beforeSnapshot.hasFocus&&beforeSnapshot.state.focused&&beforeSnapshot.tickerStarted);
   keyboardFocus.push({keyCode:direction.code,windowFocused:win.isFocused(),hasFocus:beforeSnapshot.hasFocus,probeFocused:beforeSnapshot.state.focused,tickerStarted:beforeSnapshot.tickerStarted,inputCanReach});
   if(!inputCanReach){directionResults.push({keyCode:direction.code,skipped:'window or renderer not focused',before,after:before,delta:{x:0,y:0},held:beforeSnapshot.state.keys,captured:[]});continue;}
   const auditStart=await js<number>(`window.__f0InputAudit.length`);
   win.webContents.sendInputEvent({type:'keyDown',keyCode:direction.code});await delay(400);
   const held=await js<any>(`window.foundationProbe.state.keys`);
   const captured=await js<any[]>(`window.__f0InputAudit.slice(${auditStart}).filter(e=>e.type==='keydown')`);
   const duringSnapshot=await probeState();
   const canRelease=Boolean(win.isFocused()&&duringSnapshot.hasFocus&&duringSnapshot.state.focused);
   if(canRelease){win.webContents.sendInputEvent({type:'keyUp',keyCode:direction.code});await delay(60);}
   const afterSnapshot=await probeState();const after=afterSnapshot.state.p;
   directionResults.push({keyCode:direction.code,before,after,delta:{x:after.x-before.x,y:after.y-before.y},held,captured,afterFocus:{windowFocused:win.isFocused(),hasFocus:afterSnapshot.hasFocus,probeFocused:afterSnapshot.state.focused,tickerStarted:afterSnapshot.tickerStarted},keyupSkippedBecauseBlurred:!canRelease,keyupEvents:canRelease?await js<any[]>(`window.__f0InputAudit.slice(${auditStart}).filter(e=>e.type==='keyup')`):[]});
  }
  const directionsPass=directionResults.length===4&&directionResults.every((r,i)=>directions[i].expect(r.after.x-r.before.x,r.after.y-r.before.y)&&r.held.includes(`Key${directions[i].code}`)&&r.captured.some((e:any)=>e.code===`Key${directions[i].code}`));
  record('software-injected-wasd-directions',directionsPass,{mode:'Electron WebContents.sendInputEvent; not physical keyboard evidence',focusBeforeEach:keyboardFocus,directions:directionResults});

  // Minimize with a key held to exercise the renderer blur path, stopped ticker, clear keys and clock reset.
  const preMinimizeFocus=await probeState();
  const canHoldKeyForMinimize=Boolean(win.isFocused()&&preMinimizeFocus.hasFocus&&preMinimizeFocus.state.focused&&preMinimizeFocus.tickerStarted);
  if(canHoldKeyForMinimize){win.webContents.sendInputEvent({type:'keyDown',keyCode:'W'});await delay(180);}
  const beforeBlur=await probeState();
  if(!win.isMinimized()){event('harness-requested-minimize');win.minimize();}
  let blurred:any;
  try{blurred=await waitUntil(probeState,s=>Boolean(s&&!s.state.focused&&!s.tickerStarted&&s.state.keys.length===0),'minimize-triggered blur handling',5000);}
  catch(error){
   const nativeState=await probeState().catch(()=>null);
   event('native-minimize-did-not-reach-blur-assertion',{error:String(error),nativeState});
   blurred=nativeState;
  }
  const frameCountAtBlur=Number(blurred?.frames??-1);
  await delay(300);
  const heldAtBlur=await probeState().catch(()=>null);
  const nativeBlur=Boolean(heldAtBlur&&!heldAtBlur.hasFocus&&!heldAtBlur.state.focused&&!heldAtBlur.tickerStarted&&heldAtBlur.state.keys.length===0);
  const stopped=nativeBlur&&heldAtBlur?.frames===frameCountAtBlur;
  record('blur-clears-key-and-stops-ticker',Boolean(canHoldKeyForMinimize&&stopped),{keyHeldBeforeMinimize:canHoldKeyForMinimize,beforeBlur:{p:beforeBlur.state.p,keys:beforeBlur.state.keys,focused:beforeBlur.state.focused,documentHasFocus:beforeBlur.hasFocus,tickerStarted:beforeBlur.tickerStarted,frames:beforeBlur.frames},afterBlur:heldAtBlur?{p:heldAtBlur.state.p,keys:heldAtBlur.state.keys,focused:heldAtBlur.state.focused,documentHasFocus:heldAtBlur.hasFocus,tickerStarted:heldAtBlur.tickerStarted,frames:heldAtBlur.frames}:null,nativeWindowMinimized:win.isMinimized(),mechanism:'BrowserWindow.minimize; no synthetic DOM blur fallback; no refocus after the initial sample focus',framesStayedStopped:heldAtBlur?.frames===frameCountAtBlur});

  const preRestore=heldAtBlur?.state?.p??beforeBlur.state.p;
  win.restore();
  const resumeEventStart=events.length;
  await delay(800);
  const afterResume=await probeState();
  const noTeleport=Math.hypot(afterResume.state.p.x-preRestore.x,afterResume.state.p.y-preRestore.y)<5;
  const resumeEvents=events.slice(resumeEventStart).filter(e=>e.name==='native-window-focus'||e.name==='native-window-blur'||e.name==='native-window-restore');
  record('resume-reacquires-focus-and-ticker',Boolean(win.isFocused()&&afterResume.hasFocus&&afterResume.state.focused&&afterResume.tickerStarted),{windowFocused:win.isFocused(),afterResume:{hasFocus:afterResume.hasFocus,focused:afterResume.state.focused,tickerStarted:afterResume.tickerStarted,frames:afterResume.frames},events:resumeEvents,focusWasNotForced:true});
  record('resume-clock-does-not-teleport',Boolean(noTeleport&&afterResume.state.keys.length===0),{preRestore,afterResume:{p:afterResume.state.p,keys:afterResume.state.keys,focused:afterResume.state.focused,tickerStarted:afterResume.tickerStarted,frames:afterResume.frames},delta:{x:afterResume.state.p.x-preRestore.x,y:afterResume.state.p.y-preRestore.y}});

  const screenshot=await win.capturePage();
  const screenshotPath=path.join(evidenceDir,`${evidenceName}-probe.png`);
  fs.writeFileSync(screenshotPath,screenshot.toPNG());
  report.screenshot={path:screenshotPath,width:screenshot.getSize().width,height:screenshot.getSize().height,sha256:crypto.createHash('sha256').update(screenshot.toPNG()).digest('hex')};
  report.rendererErrors=rendererErrors;report.rendererConsole=rendererConsole;report.scriptErrors=scriptErrors;report.failures=failures;
  report.status=failures.length?'PARTIAL_FAILURE':'FUNCTIONAL_PASS';
 }catch(error){
  scriptErrors.push(String(error));report.status='PARTIAL_FAILURE';report.scriptErrors=scriptErrors;report.failures=failures;
 }finally{
  report.finishedAt=new Date().toISOString();
  report.checks=checks;report.events=events;report.rendererErrors=rendererErrors;report.rendererConsole=rendererConsole;report.scriptErrors=scriptErrors;report.failures=failures;
  const jsonPath=path.join(evidenceDir,`${evidenceName}.json`);
  try{fs.writeFileSync(jsonPath,JSON.stringify(report,null,2)+'\n');}catch(error){console.error('Could not write evidence JSON:',String(error));}
  console.log(JSON.stringify({status:report.status,jsonPath,profile,checks:checks.map(c=>({name:c.name,pass:c.pass})),failures,scriptErrors},null,2));
  win?.close();
  app.exit(report.status==='FUNCTIONAL_PASS'?0:1);
 }
}

app.on('render-process-gone',(_e,details)=>{rendererErrors.push({kind:'app-render-process-gone',detail:JSON.stringify(details)});});
void main();
