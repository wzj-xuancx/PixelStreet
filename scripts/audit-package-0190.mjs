// Read-only app audit. Writes only the explicitly requested report; never starts the app.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import * as asar from '@electron/asar';
const [rootArg,appArg,outArg]=process.argv.slice(2);
if(!rootArg||!appArg||!outArg)throw Error('Usage: node audit-package-0190.mjs SOURCE APP REPORT');
const root=fs.realpathSync(rootArg),app=fs.realpathSync(appArg),out=path.resolve(outArg);
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
if(pkg.version!=='0.19.0'||pkg.build.appId!=='org.pixelstreet.camp0190')throw Error('Wrong candidate identity');
const resources=path.join(app,'Contents/Resources'),archive=path.join(resources,'app.asar');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const sourceFiles=[];
function walk(folder,prefix=''){
 for(const e of fs.readdirSync(folder,{withFileTypes:true})){
  const rel=prefix?`${prefix}/${e.name}`:e.name,full=path.join(folder,e.name);
  if(e.isSymbolicLink())throw Error(`Unexpected source link ${full}`);
  if(e.isDirectory())walk(full,rel);else if(e.isFile())sourceFiles.push(rel);
 }
}
walk(path.join(root,'dist/renderer'));
const excluded=new Set(['foundation-probe.js','foundation-probe.html','foundation-probe.css']);
const packedPaths=['dist/main.cjs','dist/preload.cjs','docs/third-party-notices.md',...sourceFiles.filter(f=>!excluded.has(f)).map(f=>`dist/renderer/${f}`)];
const rows=packedPaths.map(file=>({file,match:sha(fs.readFileSync(path.join(root,file)))===sha(asar.extractFile(archive,file))}));
for(const file of ['game-worker.cjs','action-worker.cjs','dungeon-worker.cjs','party-field-worker.cjs'])rows.push({file,match:sha(fs.readFileSync(path.join(root,'dist',file)))===sha(fs.readFileSync(path.join(resources,file)))});
const licensePaths=[];
function licenses(folder,prefix=''){
 for(const e of fs.readdirSync(folder,{withFileTypes:true})){
  const rel=prefix?`${prefix}/${e.name}`:e.name;
  if(e.isDirectory())licenses(path.join(folder,e.name),rel);
  else if(e.isFile())licensePaths.push(rel);
  else throw Error('Unexpected license link');
 }
}
licenses(path.join(root,'licenses'));
for(const file of licensePaths)rows.push({file:`licenses/${file}`,match:sha(fs.readFileSync(path.join(root,'licenses',file)))===sha(fs.readFileSync(path.join(resources,'licenses',file)))});
const archiveFiles=asar.listPackage(archive).map(s=>s.replace(/^\//,'')).filter(s=>!asar.statFile(archive,s,false).files);
const allow=new Set([...packedPaths,'package.json']);
const extra=archiveFiles.filter(s=>!allow.has(s)),missing=[...allow].filter(s=>!archiveFiles.includes(s));
const packed=JSON.parse(asar.extractFile(archive,'package.json').toString());
const plist=key=>execFileSync('/usr/libexec/PlistBuddy',['-c',`Print :${key}`,path.join(app,'Contents/Info.plist')],{encoding:'utf8'}).trim();
const identity={version:plist('CFBundleShortVersionString'),build:plist('CFBundleVersion'),bundleId:plist('CFBundleIdentifier'),executable:plist('CFBundleExecutable'),minimumMacOS:plist('LSMinimumSystemVersion')};
const localNetworkPurpose=plist('NSLocalNetworkUsageDescription');
const symlinks=[];function safeLinks(folder){for(const e of fs.readdirSync(folder,{withFileTypes:true})){const f=path.join(folder,e.name);if(e.isSymbolicLink()){const target=fs.readlinkSync(f),resolved=fs.realpathSync(f);if(path.isAbsolute(target)||!resolved.startsWith(app+path.sep))throw Error('Escaping or absolute App link '+f);symlinks.push({path:path.relative(app,f),target});}else if(e.isDirectory())safeLinks(f);}}safeLinks(app);
const architecture=execFileSync('/usr/bin/lipo',['-archs',path.join(app,'Contents/MacOS',identity.executable)],{encoding:'utf8'}).trim();
execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',app],{stdio:'pipe'});
const signatureDetails=spawnSync('/usr/bin/codesign',['-d','--verbose=2',app],{encoding:'utf8'});
const adHoc=signatureDetails.status===0&&/Signature=adhoc/.test(signatureDetails.stderr);
const forbidden=archiveFiles.filter(s=>/(^|\/)(tests?|node_modules|\.superpowers|work)(\/|$)|(^|\/)(profile|settings|identity|panel-layout)\.json(?:\.bak)?$|isolated-profile/.test(s));
const ok=rows.every(r=>r.match)&&!extra.length&&!missing.length&&!forbidden.length&&packed.version===pkg.version&&packed.main==='dist/main.cjs'&&!packed.dependencies&&!packed.devDependencies&&identity.version===pkg.version&&identity.build===pkg.version&&identity.bundleId===pkg.build.appId&&identity.executable===pkg.productName&&identity.minimumMacOS==='13.0'&&architecture==='arm64'&&adHoc&&localNetworkPurpose===pkg.build.mac.extendInfo.NSLocalNetworkUsageDescription;
const report={status:ok?'PASS':'FAIL',root,app,identity,architecture,localNetworkPurpose,symlinks,signature:{deepStrictVerified:true,adHoc,notarized:false,details:signatureDetails.stderr},appAsarSha256:sha(fs.readFileSync(archive)),matched:rows.filter(r=>r.match).length,total:rows.length,licenses:licensePaths.length,archiveFiles:archiveFiles.length,extra,missing,forbidden,rows};
fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,matched:report.matched,total:report.total,identity,architecture,report:out}));
if(!ok)process.exitCode=1;
