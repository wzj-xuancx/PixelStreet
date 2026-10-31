// Check the shareable source tree without starting Electron or opening a profile.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const issues=[];
const manifestPath=path.join(root,'assets/optimization-manifest.json');
const sourceRoots=['apps','packages','tests','scripts','assets','vendor','licenses'];
const extensions=new Set(['.ts','.js','.mjs','.cjs','.css','.html','.json','.md','.txt','.py']);
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function walk(folder){
  const result=[];
  if(!fs.existsSync(folder))return result;
  for(const item of fs.readdirSync(folder,{withFileTypes:true})){
    const file=path.join(folder,item.name);
    if(item.isSymbolicLink())issues.push(`Unexpected source symlink: ${path.relative(root,file)}`);
    else if(item.isDirectory())result.push(...walk(file));
    else if(item.isFile())result.push(file);
  }
  return result;
}
const files=sourceRoots.flatMap(name=>walk(path.join(root,name)));
for(const file of files){
  const relative=path.relative(root,file).split(path.sep).join('/');
  if(fs.statSync(file).size>=100*1024*1024)issues.push(`Git file exceeds 100 MiB: ${relative}`);
  if(!relative.startsWith('licenses/')&&extensions.has(path.extname(file))){
    const text=fs.readFileSync(file,'utf8');
    if(/\/Users\/[A-Za-z0-9_.-]+\//.test(text))issues.push(`Personal absolute path: ${relative}`);
  }
}
if(!fs.existsSync(manifestPath))issues.push('Missing assets/optimization-manifest.json');
else{
  const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
  for(const row of manifest.images){
    const file=path.resolve(root,row.file);
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){issues.push(`Missing optimized asset: ${row.file}`);continue;}
    if(sha(file)!==row.sha256)issues.push(`Optimized asset hash mismatch: ${row.file}`);
  }
  for(const row of manifest.archived){
    if(fs.existsSync(path.join(root,row.path)))issues.push(`Non-runtime artwork remains in export: ${row.path}`);
  }
}
// Literal renderer references. Dynamic expedition paths are checked from their
// content keys, so changing the file extension cannot silently break a route.
for(const file of files.filter(f=>f.includes(`${path.sep}renderer${path.sep}`)&&extensions.has(path.extname(f)))){
  const text=fs.readFileSync(file,'utf8');
  for(const match of text.matchAll(/assets\/[A-Za-z0-9_./-]+\.(?:png|webp|svg|ogg|mp3|wav)/g)){
    if(!fs.existsSync(path.join(root,match[0])))issues.push(`Missing renderer asset ${match[0]} in ${path.relative(root,file)}`);
  }
}
for(const key of ['frontier-map','glow-trail','crystal-ravine','old-sanctuary','outpost','event-cache','event-caravan']){
  if(!fs.existsSync(path.join(root,'assets/expedition-071',key+'.webp')))issues.push(`Missing expedition scene: ${key}`);
}
for(const required of ['README.md','CHANGELOG.md','ROADMAP.md','CONTRIBUTING.md','package-lock.json','docs/third-party-notices.md','docs/approved-0190/preserved-bottom-baseline.json']){
  if(!fs.existsSync(path.join(root,required)))issues.push(`Missing repository file: ${required}`);
}
if(issues.length){console.error(issues.join('\n'));process.exitCode=1;}
else console.log(`Repository checks passed: ${files.length} source/resource files; optimized images and renderer references verified.`);
