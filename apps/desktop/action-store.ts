import fs from 'node:fs';
import path from 'node:path';
import {parseActionState,type ActionState} from '../../packages/action-core';
import {parseActionSource,type ActionSource} from '../../packages/protocol/action';

export interface ActionSave {version:2;claim:number;settled:boolean;run:ActionState|null;source:ActionSource|null}
export function parseActionSave(value:unknown):ActionSave {
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)throw Error('主动冒险存档无效');
 const x=value as Record<string,unknown>;
 if(x.version===1){
  if(Object.keys(x).sort().join(',')!=='claim,run,settled,version')throw Error('旧主动冒险存档字段无效');
  return parseActionSave({...x,version:2,source:null});
 }
 if(Object.keys(x).sort().join(',')!=='claim,run,settled,source,version'||x.version!==2||typeof x.claim!=='number'||!Number.isSafeInteger(x.claim)||x.claim<0||x.claim>1e12||typeof x.settled!=='boolean')throw Error('主动冒险存档字段无效');
 const source=x.source===null?null:parseActionSource(x.source);
 if(x.run===null){if(x.claim!==0||!x.settled||source)throw Error('主动冒险游标无效');return {version:2,claim:0,settled:true,run:null,source:null};}
 const run=parseActionState(x.run);
 if(x.claim<1||source&&(!run.players.some(p=>p.id===source.playerId)||source.role==='host'&&source.sequence!==x.claim))throw Error('主动冒险结算号或参与身份无效');
 return {version:2,claim:x.claim,settled:x.settled,run,source};
}
export class ActionStore {
 readonly file:string;
 value:ActionSave={version:2,claim:0,settled:true,run:null,source:null};
 warnings:string[]=[];
 private lastGood='';
 private corrupt=false;
 constructor(folder:string){
  fs.mkdirSync(folder,{recursive:true,mode:0o700});this.file=path.join(folder,'action-run.json');let found=false,loaded=false;
  for(const [file,backup] of [[this.file,false],[this.file+'.bak',true]] as const){
   if(!fs.existsSync(file))continue;found=true;
   try{
    if(fs.statSync(file).size>2*1024*1024)throw Error('主动存档超过2MiB');
    const raw=JSON.parse(fs.readFileSync(file,'utf8'));
    this.value=parseActionSave(raw);loaded=true;
    if(raw.version===1){const kept=path.join(folder,'action-run.v1-before-migration.json');if(!fs.existsSync(kept))fs.copyFileSync(file,kept,fs.constants.COPYFILE_EXCL);this.warnings.push('旧主动存档已升级，原件保留。');}
    if(backup)this.warnings.push('主动冒险从有效备份恢复，损坏原件保留。');break;
   }catch{if(!backup)this.corrupt=true;this.warnings.push(`${backup?'备份':'主'}主动存档无效，原件保留。`);}
  }
  if(found&&!loaded)throw Error('主动冒险存档与备份无法读取，已暂停；不会清空进度。');
  if(this.value.run){
   this.value.run.paused=true;
   // A closed room has no authority after restart. Retain confirmed loot, never run it offline.
   if(this.value.source&&['playing','upgrade'].includes(this.value.run.phase)){
    this.value.run.phase='lost';this.value.run.notice='原房间已结束，可带回最后确认的战利品；新房间从新一局出发。';
   }
  }
  this.lastGood=JSON.stringify(this.value);if(!found)this.save(this.value);
 }
 private atomic(file:string,text:string):void{
  const temp=file+`.tmp-${process.pid}`;
  try{const fd=fs.openSync(temp,'w',0o600);try{fs.writeFileSync(fd,text+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temp,file);}catch(e){try{fs.unlinkSync(temp);}catch{}throw e;}
 }
 save(raw:unknown):void{
  const value=parseActionSave(raw);if(value.run)value.run.paused=true;const text=JSON.stringify(value);
  if(this.corrupt&&fs.existsSync(this.file)){fs.copyFileSync(this.file,this.file+`.corrupt-${Date.now()}`);this.corrupt=false;}
  if(this.lastGood)this.atomic(this.file+'.bak',this.lastGood);this.atomic(this.file,text);this.value=value;this.lastGood=text;
 }
}
