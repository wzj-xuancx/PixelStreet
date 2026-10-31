import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

type FixtureRecord={kind:string;detail?:unknown};
const electronApi=require('electron');
const originalFs=require('original-fs') as typeof fs;
const app=electronApi.app;
const BrowserWindow=electronApi.BrowserWindow;
const records:FixtureRecord[]=[];
const errors:string[]=[];
const suppressed={appFocus:0,show:0,showInactive:0,windowFocus:0,webContentsFocus:0,moveTop:0,shortcutCalls:0,trayCreates:0,singleInstanceLockBypass:0};
const workerStarts:string[]=[];
const actualVisibility=new Map<number,()=>boolean>();
let productionMainLoaded=false;
const fixtureRoot=path.resolve(__dirname,'..','..');
const resourcesPath=path.resolve(process.env.PIXELSTREET_P4_RESOURCES??'');
const profileRoot=path.resolve(process.env.PIXELSTREET_P4_PROFILE_ROOT??'');
const resultPath=path.resolve(process.env.PIXELSTREET_P4_CHILD_RESULT??path.join(fixtureRoot,'child-result.json'));

const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const pass=(kind:string,detail?:unknown)=>records.push({kind,detail});
function hash(file:string):string{return createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
function replace(target:any,key:string,value:unknown):void {
 const old=Object.getOwnPropertyDescriptor(target,key);
 if(old&&!old.configurable&&!old.writable)throw Error(`Cannot safely isolate Electron property ${key}`);
 Object.defineProperty(target,key,{configurable:true,enumerable:old?.enumerable??true,writable:true,value});
}
function patchWindow(win:any):void {
 const originalVisible=win.isVisible.bind(win);
 actualVisibility.set(win.id,originalVisible);
 replace(win,'show',()=>{suppressed.show++;});
 replace(win,'showInactive',()=>{suppressed.showInactive++;});
 replace(win,'focus',()=>{suppressed.windowFocus++;});
 replace(win,'moveTop',()=>{suppressed.moveTop++;});
 replace(win.webContents,'focus',()=>{suppressed.webContentsFocus++;});
 win.webContents.on('console-message',(event:any)=>{if(event.level==='error')errors.push(String(event.message).slice(0,300));});
 win.webContents.on('did-finish-load',()=>{
  try{if(new URL(win.webContents.getURL()).searchParams.get('page')==='arena')replace(win,'isVisible',()=>true);}catch{}
 });
}
async function until(fn:()=>Promise<boolean>|boolean,label:string,timeoutMs=20000):Promise<void>{
 const untilAt=Date.now()+timeoutMs;
 while(Date.now()<untilAt){if(await fn())return;await pause(50);}
 throw Error(`Timed out waiting for ${label}`);
}
function windows():any[]{return BrowserWindow.getAllWindows();}
function page(win:any):string|null{try{return new URL(win.webContents.getURL()).searchParams.get('page');}catch{return null;}}
function windowForPage(value:string|null):any|undefined{return windows().find(win=>page(win)===value);}
async function js(win:any,code:string):Promise<any>{return await win.webContents.executeJavaScript(code);}
async function command(win:any,value:string):Promise<any>{return js(win,`window.street.command(${value})`);}
function inside(root:string,file:string):boolean{return file===root||file.startsWith(root+path.sep);}
function writeChildResult(status:string,extra:Record<string,unknown>={}):void {
 const packageJson=JSON.parse(fs.readFileSync(path.join(fixtureRoot,'app','package.json'),'utf8'));
 const workerPaths={game:path.join(resourcesPath,'game-worker.cjs'),action:path.join(resourcesPath,'action-worker.cjs')};
 const result={
  schema:'pixelstreet.native-packaged-resources-child.v1',status,at:new Date().toISOString(),
  version:packageJson.version,platform:process.platform,arch:process.arch,electron:process.versions.electron,
  packaged:app.isPackaged,resourcesPath,profileRoot,userData:app.getPath('userData'),
  workerPaths,workerStarts:[...workerStarts].sort(),records,errors,suppressed,
  nativeVisibilityAtEnd:Object.fromEntries([...actualVisibility].map(([id,isVisible])=>[id,isVisible()])),
  ...extra
 };
 fs.mkdirSync(path.dirname(resultPath),{recursive:true});fs.writeFileSync(resultPath,JSON.stringify(result,null,2));
}

async function run():Promise<void>{
 if(!resourcesPath||!profileRoot||!originalFs.statSync(path.join(resourcesPath,'app.asar')).isFile())throw Error('Fixture requires a prepared package Resources path and a temporary profile root.');
 if(!inside(path.resolve(process.cwd()),fixtureRoot))throw Error('Fixture directory must remain beneath the project work tree.');
 const resourceFiles=['app.asar','game-worker.cjs','action-worker.cjs'];
 // Use original-fs for the physical archive itself; Electron's patched fs treats its root as a virtual directory.
 for(const file of ['game-worker.cjs','action-worker.cjs'])if(!fs.statSync(path.join(resourcesPath,file)).isFile())throw Error(`Missing packaged resource ${file}`);
 const beforeHashes=Object.fromEntries(resourceFiles.map(file=>[file,file==='app.asar'?createHash('sha256').update(originalFs.readFileSync(path.join(resourcesPath,file))).digest('hex'):hash(path.join(resourcesPath,file))]));
 const appDescriptor=Object.getOwnPropertyDescriptor(app,'isPackaged');
 const pathDescriptor=Object.getOwnPropertyDescriptor(process,'resourcesPath');
 if((appDescriptor&&!appDescriptor.configurable&&!appDescriptor.writable)||(pathDescriptor&&!pathDescriptor.configurable&&!pathDescriptor.writable))throw Error('Electron packaged/resource path properties cannot be safely fixture-patched.');
 replace(app,'isPackaged',true);replace(process,'resourcesPath',resourcesPath);
 const nativeGetPath=app.getPath.bind(app);
 replace(app,'getPath',(name:string)=>name==='appData'?profileRoot:nativeGetPath(name));
 if(path.resolve(app.getPath('appData'))!==profileRoot)throw Error('Electron appData path did not redirect to the temporary fixture root.');
 const nativeSetPath=app.setPath.bind(app);
 replace(app,'setPath',(name:string,value:string)=>{
  if(name==='userData'&&!inside(profileRoot,path.resolve(value)))throw Error('Bootstrap attempted to place Electron userData outside temporary appData.');
  return nativeSetPath(name,value);
 });
 // The fixture runs multiple times under the shared Electron executable identity; avoid
 // touching Electron's default singleton lock outside this run's temporary appData.
 replace(app,'requestSingleInstanceLock',()=>{suppressed.singleInstanceLockBypass++;return true;});
 replace(app,'releaseSingleInstanceLock',()=>{});
 replace(app,'focus',()=>{suppressed.appFocus++;});
 if(process.platform==='darwin')app.setActivationPolicy('accessory');

 // The app is forbidden from showing windows, taking focus, or adding a menu-bar/tray surface.
 app.on('browser-window-created',(_event:any,win:any)=>patchWindow(win));
 const menu=electronApi.Menu;
 replace(menu,'setApplicationMenu',()=>{});
 class HiddenTray {constructor(){suppressed.trayCreates++;}setToolTip(){}setContextMenu(){}on(){return this;}destroy(){}}
 // Electron's native API object exports Tray as non-configurable. Intercept only the
 // fixture app's require('electron') and return a proxy with a no-op Tray constructor.
 const moduleApi=require('node:module');
 const nativeModuleLoad=moduleApi._load;
 replace(moduleApi,'_load',function(this:any,request:string,parent:any,isMain:boolean){
  const loaded=nativeModuleLoad.call(this,request,parent,isMain);
  if(request==='electron'&&parent?.filename&&inside(fixtureRoot,parent.filename))return new Proxy(loaded,{get(target,key){if(key==='Tray')return HiddenTray;return Reflect.get(target,key,target);}});
  return loaded;
 });
 const shortcuts=electronApi.globalShortcut;
 if(shortcuts)for(const key of ['register','registerAll','unregister','unregisterAll'])if(typeof shortcuts[key]==='function')replace(shortcuts,key,()=>{suppressed.shortcutCalls++;return false;});

 const threads=require('node:worker_threads');
 const NativeWorker=threads.Worker;
 class ObservedWorker extends NativeWorker {
  constructor(filename:any,options?:any){workerStarts.push(path.resolve(String(filename)));super(filename,options);}
 }
 replace(threads,'Worker',ObservedWorker);
 if(app.isPackaged!==true||process.resourcesPath!==resourcesPath)throw Error('Packaged/resource path fixture did not take effect.');
 require(path.join(fixtureRoot,'app','dist','main.cjs'));
 productionMainLoaded=true;

 await until(()=>!!windowForPage(null)&&!!windowForPage('recovery'),'production bootstrap windows');
 const overlay=windowForPage(null)!;
 await until(async()=>await js(overlay,"document.body.dataset.atlas==='verified'&&!!document.getElementById('portalSign')"),'camp renderer and portal');
 await until(()=>workerStarts.length===2&&workerStarts.includes(path.resolve(path.join(resourcesPath,'game-worker.cjs')))&&workerStarts.includes(path.resolve(path.join(resourcesPath,'action-worker.cjs'))),'both packaged external workers');
 const initial=await js(overlay,'window.street.state()');
 if(initial.game.status!=='ready'||initial.game.profile?.sequence!==0||initial.game.profile?.job!=='visitor')throw Error('Fresh isolated profile did not load as a new camp.');
 if(!inside(profileRoot,app.getPath('userData')))throw Error('Electron userData escaped the temporary fixture root.');
 if(initial.action.status!=='ready')throw Error(`Action runtime did not become ready: ${initial.action.error??initial.action.status}`);
 pass('fresh-camp-rendered',{page:page(overlay),atlas:await js(overlay,'document.body.dataset.atlas'),portal:await js(overlay,"document.getElementById('portalSign').getAttribute('aria-label')"),job:initial.game.profile.job,sequence:initial.game.profile.sequence});
 pass('actual-packaged-external-workers-started',workerStarts.map(file=>path.relative(resourcesPath,file)).sort());

 await command(overlay,JSON.stringify({type:'visit',shop:'shop-bakery'}));
 await command(overlay,JSON.stringify({type:'shop-panel',anchor:{x:10,y:10,width:40,height:40}}));
 await until(()=>!!windowForPage('popover'),'management renderer window');
 const popup=windowForPage('popover')!;
 await until(async()=>await js(popup,"document.body.dataset.popup==='shop'&&!!document.getElementById('applyJob')"),'management panel renderer');
 const economy=await js(popup,`(async()=>{const s=await window.street.state();const result=await window.street.command({type:'game',generation:s.popup.generation,envelope:{sequence:s.game.profile.sequence+1,requestId:'native-p4-economic-0001',action:{type:'apply-job'}}});return{job:result.game.profile.job,flour:result.game.profile.bag.flour,sequence:result.game.profile.sequence}})()`);
 if(economy.job!=='apprentice'||economy.flour!==4||economy.sequence!==1)throw Error('Fresh-profile management request returned an unexpected result.');
 pass('management-request-through-packaged-renderer-ipc',economy);

 const currentPopup=await js(popup,'window.street.state()');
 await command(popup,JSON.stringify({type:'close-popup',generation:currentPopup.popup.generation}));
 await command(overlay,JSON.stringify({type:'adventure-panel',anchor:{x:20,y:20,width:40,height:40}}));
 await until(async()=>!!windowForPage('popover')&&await js(windowForPage('popover'),"document.body.dataset.popup==='adventure'"),'adventure panel renderer');
 const adventure=windowForPage('popover')!;
 const adventureState=await js(adventure,'window.street.state()');
 await command(adventure,JSON.stringify({type:'open-action',generation:adventureState.popup.generation}));
 await until(()=>!!windowForPage('arena'),'arena renderer window');
 const arena=windowForPage('arena')!;
 await until(async()=>await js(arena,"document.body.classList.contains('arena')&&!!document.getElementById('arenaCanvas')&&!!document.getElementById('arenaWelcome')"),'arena renderer initialized');
 const active=await js(arena,`(async()=>{const result=await window.street.command({type:'action-start',weapon:'wand'});return{status:result.action.status,phase:result.action.run?.phase,paused:result.action.run?.paused,claim:result.action.claim}})()`);
 if(active.status!=='ready'||active.phase!=='playing'||active.claim<1)throw Error('Packaged active-adventure start request failed.');
 pass('arena-rendered-and-active-start-request-accepted',{
  bodyClass:await js(arena,"document.body.className"),canvas:await js(arena,"({width:document.getElementById('arenaCanvas').width,height:document.getElementById('arenaCanvas').height})"),
  request:active,actualNativeWindowVisible:actualVisibility.get(arena.id)?.()??null,
  note:'The native window remains hidden; its isVisible() response is fixture-overridden solely so the production IPC start guard can be exercised. The run remains paused because isFocused() stays false.'
 });

 await until(()=>errors.length===0,'renderer console without errors',1000);
 if(suppressed.appFocus||suppressed.windowFocus||suppressed.webContentsFocus||suppressed.shortcutCalls)throw Error('A focus or global-shortcut call escaped the suppression fixture.');
 if([...actualVisibility.values()].some(isVisible=>isVisible()))throw Error('A native window became visible despite suppression.');
 const afterHashes=Object.fromEntries(resourceFiles.map(file=>[file,file==='app.asar'?createHash('sha256').update(originalFs.readFileSync(path.join(resourcesPath,file))).digest('hex'):hash(path.join(resourcesPath,file))]));
 if(JSON.stringify(beforeHashes)!==JSON.stringify(afterHashes))throw Error('Packaged Resources changed during the fixture.');
 writeChildResult('PASS',{beforeHashes,afterHashes,fixtureMethod:'Actual Electron runtime loading the extracted, read-only packaged app.asar bootstrap/renderer; app.isPackaged and process.resourcesPath redirected to the immutable package Resources; all native show/focus calls suppressed; profile data redirected to a unique temporary appData root.'});
 app.quit();
}

void run().catch(error=>{
 const detail={error:String(error),stack:error instanceof Error?error.stack:undefined,productionMainLoaded};
 try{writeChildResult('FAIL',detail);}catch{}
 console.error('Native packaged resource fixture failed:',String(error));
 if(productionMainLoaded)app.quit();else app.exit(1);
 setTimeout(()=>app.exit(1),25000).unref();
});
