// Offline single-App builder. Uses only the installed, read-only exact Electron runtime.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {fileURLToPath} from 'node:url';import {execFileSync} from 'node:child_process';import {build,Platform,Arch} from 'electron-builder';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));process.chdir(root);
const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));if(pkg.version!=='0.19.0'||pkg.devDependencies.electron!=='44.5.1')throw Error('Unexpected release identity');
const electronDist=fs.realpathSync('node_modules/electron/dist'),runtime=path.join(electronDist,'Electron.app'),app=path.join(root,'release/mac-arm64',pkg.productName+'.app');
if(fs.existsSync(app))throw Error('Refusing to overwrite an existing App');
const sha=f=>{const h=crypto.createHash('sha256');const fd=fs.openSync(f,'r'),buf=Buffer.alloc(1024*1024);try{let n;while((n=fs.readSync(fd,buf,0,buf.length,null)))h.update(buf.subarray(0,n));}finally{fs.closeSync(fd);}return h.digest('hex');};
function tree(folder){const rows=[];function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,e.name),s=fs.lstatSync(f),rel=path.relative(folder,f);if(e.isSymbolicLink())rows.push({path:rel,target:fs.readlinkSync(f)});else if(e.isDirectory())walk(f);else if(e.isFile())rows.push({path:rel,sha256:sha(f),mode:s.mode&0o7777,inode:`${s.dev}:${s.ino}`});else throw Error('Unexpected runtime entry '+f);}}walk(folder);return rows.sort((a,b)=>a.path.localeCompare(b.path));}
const before=tree(runtime),oldInodes=new Set(before.filter(r=>r.inode).map(r=>r.inode));
const version=execFileSync('/usr/libexec/PlistBuddy',['-c','Print :CFBundleShortVersionString',path.join(runtime,'Contents/Info.plist')],{encoding:'utf8'}).trim();if(version!=='44.5.1')throw Error('Installed Electron version mismatch');
process.env.CSC_IDENTITY_AUTO_DISCOVERY='false';
await build({targets:Platform.MAC.createTarget('dir',Arch.arm64),publish:'never',config:{electronDist,npmRebuild:false,mac:{identity:null}}});
const rows=tree(app),links=rows.filter(r=>r.target!==undefined);
for(const r of rows){const f=path.join(app,r.path);if(r.inode&&oldInodes.has(r.inode))throw Error('Hardlinked source runtime '+r.path);if(r.target!==undefined&&(path.isAbsolute(r.target)||!fs.realpathSync(f).startsWith(app+path.sep)))throw Error('Unsafe App symlink '+r.path);}
if(JSON.stringify(before)!==JSON.stringify(tree(runtime)))throw Error('Source Electron changed during build');
// Safe to sign only after every link and new regular-file inode has been checked.
execFileSync('/usr/bin/codesign',['--force','--deep','--sign','-','--timestamp=none',app],{stdio:'inherit'});
execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',app],{stdio:'inherit'});
if(JSON.stringify(before)!==JSON.stringify(tree(runtime)))throw Error('Source Electron changed during signing');
const report={status:'PASS',version:pkg.version,app,electronVersion:version,electronDist,networkDownloads:false,builder:'electron-builder '+pkg.devDependencies['electron-builder'],signature:'ad-hoc; not notarized',preSignRegularFilesNewInodes:rows.filter(r=>r.inode).length,safeRelativeSymlinks:links,sourceElectronBefore:before,sourceElectronAfterUnchanged:true,sourceElectronMainSha256:sha(path.join(runtime,'Contents/MacOS/Electron'))};
fs.writeFileSync('release/build-author-0190.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,app,preSignRegularFilesNewInodes:report.preSignRegularFilesNewInodes,safeRelativeSymlinks:links.length,sourceElectronAfterUnchanged:true}));
