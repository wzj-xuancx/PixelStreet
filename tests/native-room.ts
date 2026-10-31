import {app} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import {startDesktop} from '../apps/desktop/bootstrap';
import {initialProfile} from '../packages/solo-core';
const role=process.argv.find(v=>v.startsWith('--room-role='))?.slice(12);
const bus=process.argv.find(v=>v.startsWith('--room-bus='))?.slice(11);
if(!bus||!['host','guest','late'].includes(role??''))throw Error('isolated room probe arguments required');
const own=role!,root=path.resolve(bus),folder=path.join(root,own+'-profile');
fs.mkdirSync(root,{recursive:true,mode:0o700});fs.mkdirSync(path.join(folder,'solo'),{recursive:true,mode:0o700});
const profileFile=path.join(folder,'solo/profile.json');
if(!fs.existsSync(profileFile)){const p=initialProfile(Date.now());p.job='keeper';p.coins=100;p.bag.flour=20;p.bag.ration=9;fs.writeFileSync(profileFile,JSON.stringify(p),{mode:0o600});}
const errors:string[]=[];const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms));
app.focus=()=>{};
app.on('browser-window-created',(_e,w)=>{w.focus=()=>{};w.webContents.focus=()=>{};w.show=()=>w.showInactive();if(w.getTitle().includes('主动冒险'))w.isFocused=()=>true;w.webContents.on('console-message',e=>{if(e.level==='error')errors.push(e.message);});});
const atomic=(file:string,value:unknown)=>{const tmp=file+'.tmp-'+process.pid;fs.writeFileSync(tmp,JSON.stringify(value),{mode:0o600});fs.renameSync(tmp,file);};
void(async()=>{
 const shell=await startDesktop(folder,true);const baseline=shell.overlay.getBounds();let last=0,processing=false;
 const state=()=>({at:new Date().toISOString(),role:own,pid:process.pid,state:shell.state(),rawAction:shell.action.state,camp:shell.overlay.getBounds(),baseline,arena:shell.arenaWindow?.getBounds()??null,visible:shell.arenaWindow?.isVisible()??false,errors});
 const aj=(code:string)=>{if(!shell.arenaWindow)throw Error('arena absent');return shell.arenaWindow.webContents.executeJavaScript(code);};
 async function visible(){for(let n=0;n<240;n++){if(shell.arenaWindow?.isVisible()&&await aj("document.body.dataset.arenaAssets==='ready'"))return;await delay(50);}throw Error('arena not ready');}
 const timer=setInterval(()=>atomic(path.join(root,own+'-state.json'),state()),100);
 const poll=setInterval(()=>{if(processing)return;const file=path.join(root,own+'-command.json');if(!fs.existsSync(file))return;let m:any;try{m=JSON.parse(fs.readFileSync(file,'utf8'));}catch{return;}if(m.id<=last)return;last=m.id;processing=true;
 void(async()=>{
  let result:unknown;
  if(m.op==='host'){await shell.room.hostRoom('营地房主','127.0.0.1');fs.writeFileSync(path.join(root,'invitation.private'),shell.room.invitation(),{mode:0o600});result={address:shell.room.state.address};}
  else if(m.op==='join'){await shell.room.joinRoom(own==='late'?'晚到旅人':'同行旅人',fs.readFileSync(path.join(root,'invitation.private'),'utf8'));}
  else if(m.op==='open'){shell.openArena();await visible();shell.arenaWindow!.isFocused=()=>true;await aj("window.dispatchEvent(new Event('focus'))");await shell.room.setLocalActive(true);}
  else if(m.op==='click'){result=await aj(`(()=>{const el=document.getElementById(${JSON.stringify(m.element)});if(!el)throw Error('button absent');if(el.disabled)throw Error('button disabled');el.click();return true})()`);}
  else if(m.op==='js'){result=await aj(m.code);}
  else if(m.op==='pointer'){
   const x=Number(m.x),y=Number(m.y),button=m.button===2?2:0;
   result=await aj(`(()=>{const c=document.getElementById('arenaCanvas'),r=c.getBoundingClientRect();c.dispatchEvent(new PointerEvent('pointerdown',{button:${button},clientX:r.x+r.width*${x}/960,clientY:r.y+r.height*${y}/540,bubbles:true}));return true})()`);
  }
  else if(m.op==='blur'){if(shell.arenaWindow)await aj("window.dispatchEvent(new Event('blur'))");shell.arenaWindow?.emit('blur');}
  else if(m.op==='close'){shell.closeArena();}
  else if(m.op==='drop'){
   const host=(shell.room as any).host;if(!host)throw Error('host absent');const id=shell.room.state.members.find(x=>x.id!==shell.room.state.localPlayerId&&x.online)?.id;if(!id)throw Error('guest absent');host.disconnect(id,'probe transient link loss');
  }
  else if(m.op==='idle-advance'){result=await shell.game.request('advance',{ms:Number(m.ms)});}
  else if(m.op==='game'){const p=shell.game.state.profile!;result=await shell.game.command({sequence:p.sequence+1,requestId:`native-room-${Date.now()}`,action:m.action});}
  else if(m.op==='settle'){result=shell.room.currentRoomRun()?await shell.room.settle():await shell.action.settle();}
  else if(m.op==='leave'){await shell.room.leave();}
  else if(m.op==='capture'){if(!shell.arenaWindow)throw Error('arena absent');fs.writeFileSync(path.join(root,own+'-'+String(m.name).replace(/[^a-z0-9-]/g,'')+'.png'),(await shell.arenaWindow.webContents.capturePage()).toPNG());}
  else if(m.op==='room-panel'){shell.openPopup('room',{x:740,y:30,width:48,height:65});}
  else if(m.op==='quit'){atomic(path.join(root,own+'-reply.json'),{id:m.id,ok:true});clearInterval(timer);clearInterval(poll);app.quit();return;}
  else throw Error('unknown isolated probe operation');
  atomic(path.join(root,own+'-reply.json'),{id:m.id,ok:true,result});atomic(path.join(root,own+'-state.json'),state());
 })().catch(e=>atomic(path.join(root,own+'-reply.json'),{id:m.id,ok:false,error:String(e),stack:e.stack})).finally(()=>processing=false);
 },50);
 atomic(path.join(root,own+'-state.json'),state());
})().catch(e=>{atomic(path.join(root,own+'-fatal.json'),{error:String(e),stack:e.stack,errors});console.error(e);app.exit(1);});
