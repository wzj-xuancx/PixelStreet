'use strict';
// Guarded execution of the exact packaged main in the installed matching Electron.
// This is not an unmodified production App/double-click or physical-input test.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
if(!process.versions.electron){
 const {spawnSync}=require('node:child_process');const [app,report]=process.argv.slice(2);
 if(!app||!report)throw Error('Usage: node scripts/smoke-package-0190.cjs APP REPORT');
 const profile=fs.mkdtempSync('/private/tmp/pixelstreet-package-0190-');
 fs.writeFileSync(path.join(profile,'.pixelstreet-isolated-profile.json'),JSON.stringify({product:'PixelStreet',kind:'isolated-playtest',version:1})+'\n',{flag:'wx',mode:0o600});
 const env={...process.env,PIXELSTREET_TEST_DATA:profile,PIXELSTREET_REQUIRE_ISOLATION:'1'};delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_OPTIONS;
 for(const key of Object.keys(env))if(/^PIXELSTREET_.*(?:PROFILE|TEST_DATA)/.test(key)&&key!=='PIXELSTREET_TEST_DATA')delete env[key];
 const child=spawnSync(require('electron'),[__filename,'--child',path.resolve(app),path.resolve(report),profile],{env,stdio:'inherit',timeout:60000});
 if(child.status===0){fs.rmSync(profile,{recursive:true});console.log('PASS guarded packaged-main/resources; owned profile removed after child exit');}else console.error('FAILED guarded packaged smoke; owned profile retained:',profile,{signal:child.signal,status:child.status,error:String(child.error??'')});
 process.exit(child.status??1);
}
const [flag,appPath,reportPath,folder]=process.argv.slice(2);if(flag!=='--child')throw Error('Wrong child invocation');
const marker=JSON.stringify({product:'PixelStreet',kind:'isolated-playtest',version:1})+'\n';
if(!/^\/private\/tmp\/pixelstreet-package-0190-[^/]+$/.test(folder)||fs.realpathSync(folder)!==folder||fs.readFileSync(path.join(folder,'.pixelstreet-isolated-profile.json'),'utf8')!==marker||process.env.PIXELSTREET_REQUIRE_ISOLATION!=='1'||process.env.PIXELSTREET_TEST_DATA!==folder)throw Error('Refusing unmarked packaged smoke');
const electron=require('electron'),Module=require('node:module'),thread=require('node:worker_threads'),NativeWorker=thread.Worker;
const resources=path.join(fs.realpathSync(appPath),'Contents/Resources'),archive=path.join(resources,'app.asar');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');const errors=[],guards={},workers=[],windows=[],instances=new Map();let extraWorker;
const report={status:'IN_PROGRESS',kind:'guarded exact packaged-main resource execution',unmodifiedProductionAppStart:false,limits:['Exact signed app.asar main/preload/renderer and outside-ASAR workers executed under installed Electron44.5.1 with pre-import native guards and app.isPackaged/resourcesPath overrides.','Not a production double-click, physical input, visible compositor, LAN second Mac, FPS or long-power test.'],app:appPath,profile:folder,guards,workers,errors};
const write=()=>fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
const replace=(o,k,v)=>Object.defineProperty(o,k,{configurable:true,writable:true,value:v});
process.on('uncaughtException',e=>{errors.push(String(e.stack??e));report.status='FAIL';write();electron.app.exit(1);});
process.on('uncaughtExceptionMonitor',e=>{errors.push(String(e.stack??e));write();});process.on('unhandledRejection',e=>{errors.push(String(e?.stack??e));write();});
electron.app.setActivationPolicy('prohibited');electron.app.dock?.hide();
for(const k of ['show','activate'])if(electron.app.dock?.[k])replace(electron.app.dock,k,()=>{throw Error('Dock activation denied');});
for(const k of ['focus','activate'])replace(electron.app,k,()=>{guards['app.'+k]=(guards['app.'+k]??0)+1;return false;});
const visible=electron.BrowserWindow.prototype.isVisible,focused=electron.BrowserWindow.prototype.isFocused;
for(const k of ['show','showInactive','focus','moveTop','restore'])replace(electron.BrowserWindow.prototype,k,()=>{guards[k]=(guards[k]??0)+1;return false;});
electron.app.on('browser-window-created',(_,w)=>{windows.push(w);replace(w.webContents,'focus',()=>{guards.webContentsFocus=(guards.webContentsFocus??0)+1;return false;});w.webContents.on('did-fail-load',(_,code,description)=>errors.push('did-fail-load '+code+' '+description));});
for(const k of ['showOpenDialog','showSaveDialog','showMessageBox','showErrorBox'])replace(electron.dialog,k,()=>{throw Error('Native dialog denied');});
replace(electron.clipboard,'writeText',()=>{throw Error('Clipboard write denied');});replace(electron.Menu,'setApplicationMenu',()=>{});
class HiddenTray{setToolTip(){}setContextMenu(){}on(){return this;}destroy(){}}
const load=Module._load;Module._load=function(request,parent,isMain){const value=load.call(this,request,parent,isMain);
 if(request==='electron')return new Proxy(value,{get(o,k){if(k==='Tray')return HiddenTray;if(k==='BrowserWindow')return new Proxy(o.BrowserWindow,{construct(C,args){if(args[0]?.show!==false)throw Error('Window constructor must request hidden');return Reflect.construct(C,args);}});if(k==='globalShortcut')throw Error('Global hooks denied');return Reflect.get(o,k,o);}});
 if(request==='node:worker_threads')return new Proxy(value,{get(o,k){if(k!=='Worker')return Reflect.get(o,k,o);return class extends NativeWorker{constructor(file,opts){if(!path.resolve(file).startsWith(resources+path.sep)||!['game-worker.cjs','action-worker.cjs','dungeon-worker.cjs','party-field-worker.cjs'].includes(path.basename(file)))throw Error('Unexpected Worker path '+file);const row={path:file,sha256:sha(fs.readFileSync(file)),messages:[]};workers.push(row);super(file,opts);instances.set(path.basename(file),this);this.on('message',m=>{if(row.messages.length<4)row.messages.push({type:m.type,status:m.state?.status,id:m.id,world:m.world===null?'null':undefined});});this.on('error',e=>errors.push(String(e)));}};}});return value;};
Object.defineProperty(process,'resourcesPath',{configurable:true,value:resources});Object.defineProperty(electron.app,'isPackaged',{configurable:true,value:true});replace(electron.app,'getAppPath',()=>archive);
electron.app.setPath('userData',folder);electron.app.setPath('sessionData',path.join(folder,'session'));fs.mkdirSync(path.join(folder,'session'),{recursive:true});
report.mainSha256=sha(fs.readFileSync(path.join(archive,'dist/main.cjs')));report.archiveSha256=sha(require('original-fs').readFileSync(archive));report.runtime={electron:process.versions.electron,chrome:process.versions.chrome,arch:process.arch};
const native=()=>windows.filter(w=>!w.isDestroyed()).map(w=>({id:w.id,url:w.webContents.getURL(),visible:visible.call(w),focused:focused.call(w)}));
const timer=setTimeout(()=>{errors.push('Packaged resource smoke timeout');report.status='FAIL';report.windows=native();write();electron.app.exit(2);},40000);timer.unref();
// Import the packaged entry itself, never a rebuilt/source DesktopShell.
require(path.join(archive,'dist/main.cjs'));
(async()=>{await electron.app.whenReady();for(let n=0;n<600;n++){
 const w=windows.find(w=>!w.isDestroyed()&&w.webContents.getURL().includes('/app.asar/dist/renderer/index.html'));
 if(w&&!w.webContents.isLoadingMainFrame())try{const s=await w.webContents.executeJavaScript('window.street.state()');if(s?.game?.status==='ready'||s?.profile||workers.filter(r=>r.messages.some(m=>m.status==='ready')).length===3){report.renderer={url:w.webContents.getURL(),readyState:await w.webContents.executeJavaScript('document.readyState'),stateVersion:s.version??null,bodyTextLength:await w.webContents.executeJavaScript('document.body.textContent.length')};break;}}catch{}
 await new Promise(r=>setTimeout(r,50));}
 if(!report.renderer)throw Error('Packaged renderer/game did not become ready');
 // Query the actual fourth Worker created by packaged main; no source Worker substitute.
 extraWorker=instances.get('party-field-worker.cjs');if(!extraWorker)throw Error('Packaged main did not create Party Worker');
 await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('Party Worker read timeout')),5000);const listener=m=>{if(m.type==='reply'&&m.id===190){clearTimeout(t);extraWorker.off('message',listener);if(m.world!==null)reject(Error('Fresh party World should be empty'));else resolve();}};extraWorker.on('message',listener);extraWorker.postMessage({type:'read',id:190});});
 extraWorker=null;
 report.windows=native();if(!report.windows.length||report.windows.some(w=>w.visible||w.focused))throw Error('Native hidden/unfocused assertion failed');
 if(workers.length!==4||workers.filter(r=>r.messages.some(m=>m.status==='ready')).length!==3||errors.length)throw Error('Worker readiness/errors failed');
 report.dataPath=electron.app.getPath('userData');if(report.dataPath!==folder)throw Error('Isolation path mismatch');report.status='PASS';write();electron.app.quit();
})().catch(async e=>{errors.push(String(e.stack??e));report.status='FAIL';report.windows=native();write();await extraWorker?.terminate();electron.app.exit(1);});
