import {app,BrowserWindow,screen} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {markIsolatedFolder,configureDataPaths} from '../apps/desktop/launch-profile';

const root=process.cwd();
const evidence=path.join(root,'docs/evidence/dungeon-040');
const work=path.join(root,'work');
fs.mkdirSync(evidence,{recursive:true});fs.mkdirSync(work,{recursive:true});
const profile=fs.mkdtempSync(path.join(work,'native-dungeon-art-review-profile-'));
const marker=path.join(profile,'.pixelstreet-isolated-profile.json');
const appData=app.getPath('appData');
markIsolatedFolder(profile,appData);
configureDataPaths(app,appData,profile);
const sessionData=path.join(profile,'session');
if(app.getPath('userData')!==profile||app.getPath('sessionData')!==sessionData||profile===path.join(appData,'PixelStreetS1'))throw Error('isolated art-review profile was not installed');

const sha=(buffer:Buffer|string)=>crypto.createHash('sha256').update(buffer).digest('hex');
const readAtlas=(folder:string)=>{
 const manifestPath=path.join(root,'assets',folder,'manifest.json');
 const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
 const atlasPath=path.join(root,'assets',folder,manifest.atlas.file);
 const frames=Object.entries(manifest.atlas.frames).map(([id,value]:[string,any])=>({id,...value}));
 const issues:string[]=[];
 for(const f of frames){
  if(![f.x,f.y,f.width,f.height,...f.worldSize].every(Number.isInteger)||!f.anchor.every(Number.isFinite))issues.push(`non-numeric frame metadata: ${f.id}`);
  if(f.x<0||f.y<0||f.width<=0||f.height<=0||f.x+f.width>manifest.atlas.width||f.y+f.height>manifest.atlas.height)issues.push(`out-of-atlas frame: ${f.id}`);
  if(f.width!==72||f.height!==72||f.x%72!==0||f.y%72!==0)issues.push(`frame does not match 72px cell grid: ${f.id}`);
  if(!Array.isArray(f.anchor)||f.anchor.length!==2||f.anchor.some((v:number)=>v<0||v>1))issues.push(`invalid anchor: ${f.id}`);
 }
 for(let i=0;i<frames.length;i++)for(let j=i+1;j<frames.length;j++){
  const a=frames[i],b=frames[j];
  if(a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y)issues.push(`overlapping crop: ${a.id}, ${b.id}`);
 }
 const svg=fs.readFileSync(atlasPath,'utf8');
 if(/<image\b|(?:href|xlink:href)=['"]https?:/i.test(svg))issues.push('external image or remote href is present');
 return {folder,manifestPath,atlasPath,manifest,frames,svg,issues};
};
const atlases=[readAtlas('dungeon'),readAtlas('action')];
const expected={dungeon:40,action:36};
for(const a of atlases){if(a.frames.length!==expected[a.folder as keyof typeof expected])a.issues.push(`unexpected frame count ${a.frames.length}`);if(a.issues.length)throw Error(`${a.folder} atlas validation failed: ${a.issues.join('; ')}`);}

const atlasData=atlases.map(a=>({
 folder:a.folder,
 title:a.folder==='dungeon'?'地牢 atlas · 40 帧':'Action atlas · 36 帧',
 width:a.manifest.atlas.width,
 height:a.manifest.atlas.height,
 file:pathToFileURL(a.atlasPath).href,
 frames:a.frames.map(f=>({id:f.id,x:f.x,y:f.y,width:f.width,height:f.height,anchor:f.anchor,worldSize:f.worldSize,tags:f.tags??[]})),
}));
const page=path.join(work,'native-dungeon-art-review.html');
const html=`<!doctype html><html><head><meta charset="utf-8"><title>PixelStreet atlas review</title><style>
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#11171e;color:#e8e4d5;font:13px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}
header{height:62px;display:flex;align-items:center;justify-content:space-between;padding:8px 20px;border-bottom:1px solid #39464b;background:#19232a}h1{font-size:17px;margin:0 0 4px;color:#f1d6a7}header small{color:#aab8b1}button{border:1px solid #64766d;border-radius:6px;background:#253933;color:#f1d6a7;padding:8px 14px;font:inherit}main{padding:12px 20px}.grid{display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:8px}.card{height:165px;min-width:0;padding:4px 5px;background:#1a252b;border:1px solid #39464b;border-radius:5px;overflow:hidden}.sprite{position:relative;width:144px;height:144px;margin:0 auto 2px;background-color:#263239;background-image:linear-gradient(45deg,#3c4a4c 25%,transparent 25%),linear-gradient(-45deg,#3c4a4c 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#3c4a4c 75%),linear-gradient(-45deg,transparent 75%,#3c4a4c 75%);background-size:16px 16px;background-position:0 0,0 8px,8px -8px,-8px 0;background-repeat:repeat;image-rendering:pixelated}.frame{position:absolute;inset:0;background-repeat:no-repeat;image-rendering:pixelated}.anchor{position:absolute;width:8px;height:8px;border:1px solid #ff665f;border-radius:50%;background:#ff665f66;transform:translate(-50%,-50%);box-shadow:0 0 0 1px #10171c}.name{height:18px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;text-align:center;color:#eee5cc;font-size:11px}.meta{text-align:center;color:#9eafa5;font:9px ui-monospace,monospace}.legend{position:absolute;right:195px;top:24px;color:#bac7bb;font-size:10px}.legend i{display:inline-block;width:8px;height:8px;border:1px solid #ff665f;border-radius:50%;background:#ff665f66;vertical-align:middle;margin-right:4px}
</style></head><body><header><div><h1 id="title"></h1><small id="subtitle"></small></div><div class="legend"><i></i>manifest anchor · 棋盘底纹显示透明区域</div><div><button onclick="switchAtlas('dungeon')">地牢 40</button> <button onclick="switchAtlas('action')">Action 36</button></div></header><main><div id="grid" class="grid"></div></main>
<script>const atlasData=${JSON.stringify(atlasData)};const byName=Object.fromEntries(atlasData.map(a=>[a.folder,a]));window.switchAtlas=(name)=>{const a=byName[name];document.getElementById('title').textContent=a.title;document.getElementById('subtitle').textContent=a.width+'×'+a.height+' SVG · '+a.frames.length+' 个 72×72 crop · 每帧红点标 anchor';const grid=document.getElementById('grid');grid.replaceChildren();for(const f of a.frames){const card=document.createElement('article');card.className='card';const sprite=document.createElement('div');sprite.className='sprite';const frame=document.createElement('div');frame.className='frame';frame.style.backgroundImage='url("'+a.file+'")';frame.style.backgroundSize=(a.width*2)+'px '+(a.height*2)+'px';frame.style.backgroundPosition=(-f.x*2)+'px '+(-f.y*2)+'px';const anchor=document.createElement('i');anchor.className='anchor';anchor.style.left=(f.anchor[0]*100)+'%';anchor.style.top=(f.anchor[1]*100)+'%';sprite.append(frame,anchor);const name=document.createElement('div');name.className='name';name.textContent=f.id;const meta=document.createElement('div');meta.className='meta';meta.textContent=f.worldSize.join('×')+' · '+f.anchor.map(v=>Number(v.toFixed(2))).join(',');card.append(sprite,name,meta);grid.append(card)}document.body.dataset.atlas=name;document.body.dataset.ready='true'};const readyImages=atlasData.map(a=>new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(true);i.onerror=()=>reject(Error('atlas image failed '+a.folder));i.src=a.file}));Promise.all(readyImages).then(()=>window.switchAtlas('dungeon')).catch(e=>{document.body.dataset.error=String(e);document.body.dataset.ready='error'});</script></body></html>`;
fs.writeFileSync(page,html);

const startedAt=new Date().toISOString();
const output:any={schema:'pixelstreet.dungeon-f1-art-review.v1',candidate:'PixelStreet-0.4.0',startedAt,isolation:{profile,marker:fs.readFileSync(marker,'utf8'),userData:app.getPath('userData'),sessionData:app.getPath('sessionData'),realProfileOpened:false},runtime:{electron:process.versions.electron,chrome:process.versions.chrome,node:process.versions.node,platform:process.platform,arch:process.arch},window:null,screenshots:[],atlases:atlases.map(a=>({folder:a.folder,count:a.frames.length,dimensions:[a.manifest.atlas.width,a.manifest.atlas.height],file:a.manifest.atlas.file,sha256:{svg:sha(a.svg),manifest:sha(fs.readFileSync(a.manifestPath))},issues:a.issues})),errors:[]};
let win:BrowserWindow|undefined;
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function main():Promise<void>{
 try{
  await app.whenReady();
  const display=screen.getPrimaryDisplay();const area=display.workArea;
  const width=Math.min(1500,area.width-24),height=Math.min(1010,area.height-48);
  win=new BrowserWindow({x:area.x+12,y:area.y+12,width,height,show:false,title:'PixelStreet — Atlas Review (isolated)',backgroundColor:'#11171e',webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});
  win.webContents.on('console-message',(e)=>{const detail:any=e;if(detail.level==='error'||detail.level>=3)output.errors.push({kind:'renderer-console',message:detail.message,line:detail.lineNumber,sourceId:detail.sourceId});});
  win.webContents.on('did-fail-load',(_e,code,description,url)=>output.errors.push({kind:'did-fail-load',code,description,url}));
  await win.loadFile(page);win.show();
  const until=Date.now()+10000;let ready:any;
  while(Date.now()<until){ready=await win.webContents.executeJavaScript(`({ready:document.body.dataset.ready,error:document.body.dataset.error,atlas:document.body.dataset.atlas,title:document.getElementById('title').textContent,gridCount:document.querySelectorAll('.card').length,viewport:[innerWidth,innerHeight],scrollHeight:document.documentElement.scrollHeight})`,true);if(ready.ready==='true')break;await delay(50);}
  if(ready?.ready!=='true')throw Error(`Atlas review page did not become ready: ${JSON.stringify(ready)}`);
  output.window={url:win.webContents.getURL(),id:win.id,bounds:win.getBounds(),visible:win.isVisible(),focusedAtCapture:win.isFocused(),viewport:ready.viewport};
  for(const folder of ['dungeon','action']){
   if(folder==='action')await win.webContents.executeJavaScript(`window.switchAtlas('action')`,true);
   await delay(180);
   const info=await win.webContents.executeJavaScript(`({atlas:document.body.dataset.atlas,title:document.getElementById('title').textContent,count:document.querySelectorAll('.card').length,scrollHeight:document.documentElement.scrollHeight,ready:document.body.dataset.ready,error:document.body.dataset.error})`,true);
   if(info.atlas!==folder||info.count!==(folder==='dungeon'?40:36)||info.scrollHeight>Number(ready.viewport[1])+40)output.errors.push({kind:'layout-or-frame-count',folder,info,viewport:ready.viewport});
   const png=await win.capturePage();const bytes=png.toPNG();const file=path.join(evidence,`F1-art-luna-${folder}-atlas.png`);fs.writeFileSync(file,bytes);
   output.screenshots.push({folder,path:path.relative(root,file),sha256:sha(bytes),bytes:bytes.length,size:png.getSize(),page:info});
  }
  output.finishedAt=new Date().toISOString();
  const outPath=path.join(evidence,'F1-art-luna-capture.json');fs.writeFileSync(outPath,JSON.stringify(output,null,2)+'\n');
  console.log(JSON.stringify({status:output.errors.length?'FAIL':'PASS',report:path.relative(root,outPath),screenshots:output.screenshots,profile:output.isolation.profile},null,2));
  win.close();win=undefined;app.quit();
 }catch(error){output.errors.push({kind:'fatal',detail:String(error)});output.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(evidence,'F1-art-luna-capture.json'),JSON.stringify(output,null,2)+'\n');console.error(String(error));try{win?.close();}catch{}app.exit(1);}
}
void main();
