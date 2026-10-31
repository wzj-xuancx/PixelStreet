import fs from 'node:fs';
import path from 'node:path';
import {clearDungeonControls,parseDungeonRun,CURRENT_WEAPON_KINDS,type DungeonRun,type WeaponKind} from '../../packages/dungeon-core';
export interface DungeonSave {version:1;claim:number;settled:boolean;catalog:WeaponKind[];run:DungeonRun|null;receipt:{claim:number;coins:number;xp:number}|null}
const kinds:readonly string[]=CURRENT_WEAPON_KINDS;
export function parseDungeonSave(value:unknown):DungeonSave {
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)throw Error('地牢档案无效');
 const x=value as Record<string,unknown>;
 if(!['catalog,claim,run,settled,version','catalog,claim,receipt,run,settled,version'].includes(Object.keys(x).sort().join(','))||x.version!==1||typeof x.claim!=='number'||!Number.isSafeInteger(x.claim)||x.claim<0||x.claim>=1e12||typeof x.settled!=='boolean'||!Array.isArray(x.catalog)||x.catalog.length>kinds.length||new Set(x.catalog).size!==x.catalog.length||Array.from(x.catalog).some(k=>!kinds.includes(k)))throw Error('地牢档案字段无效');
 const run=x.run===null?null:parseDungeonRun(x.run);if(x.run!==null&&!run)throw Error('地牢局内状态无效');
 if(run&&x.claim<1||!run&&(x.claim!==0||!x.settled)||run&&x.settled&&!['won','lost'].includes(run.phase))throw Error('地牢结算游标或阶段无效');
 const receipt=x.receipt??null;if(receipt!==null){const q=receipt as Record<string,unknown>;if(typeof q!=='object'||Array.isArray(q)||Object.keys(q).sort().join(',')!=='claim,coins,xp'||!Number.isSafeInteger(q.claim)||Number(q.claim)<1||Number(q.claim)>x.claim||!Number.isSafeInteger(q.coins)||Number(q.coins)<0||Number(q.coins)>10000||!Number.isSafeInteger(q.xp)||Number(q.xp)<0||Number(q.xp)>100000)throw Error('地牢结算凭据无效');}
 return{receipt:receipt?{...receipt as NonNullable<DungeonSave['receipt']>}:null,version:1,claim:x.claim,settled:x.settled,catalog:[...x.catalog] as WeaponKind[],run};
}
export class DungeonStore {
 readonly file:string;value:DungeonSave={version:1,claim:0,settled:true,catalog:[],run:null,receipt:null};warnings:string[]=[];
 private lastGood='';private corrupt=false;private migrationSource:{version:2|3;text:string}|null=null;
 constructor(folder:string){
  fs.mkdirSync(folder,{recursive:true,mode:0o700});this.file=path.join(folder,'dungeon-run.json');let found=false,loaded=false;
  for(const [file,backup] of [[this.file,false],[this.file+'.bak',true]] as const){
   if(!fs.existsSync(file))continue;found=true;
   try{if(fs.statSync(file).size>2*1024*1024)throw Error('地牢档案超过2MiB');const source=fs.readFileSync(file,'utf8'),raw=JSON.parse(source);this.value=parseDungeonSave(raw);if(raw.run?.version===2||raw.run?.version===3)this.migrationSource={version:raw.run.version,text:source};loaded=true;if(backup)this.warnings.push('地牢从有效备份恢复，损坏原件保留。');break;}
   catch{if(!backup)this.corrupt=true;this.warnings.push(`${backup?'备份':'主'}地牢档案无效，原件保留。`);}
  }
  if(found&&!loaded)throw Error('地牢主档与备份无法读取，已停止，不会清空。');
  if(this.value.run){this.value.run.paused=true;clearDungeonControls(this.value.run);}
  this.lastGood=JSON.stringify(this.value);if(!found)this.save(this.value);
 }
 private atomic(file:string,text:string,newline=true):void {const tmp=file+`.tmp-${process.pid}`;try{const fd=fs.openSync(tmp,'w',0o600);try{fs.writeFileSync(fd,text+(newline?'\n':''));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(tmp,file);}catch(e){try{fs.unlinkSync(tmp);}catch{}throw e;}}
 save(raw:unknown):void {
  const value=parseDungeonSave(raw);if(value.run){value.run.paused=true;clearDungeonControls(value.run);}const text=JSON.stringify(value);
  if(this.migrationSource){const source=this.migrationSource;this.atomic(this.file+`.schema-v${source.version}-${Date.now()}-${process.pid}.bak`,source.text,false);this.migrationSource=null;}
  if(this.corrupt&&fs.existsSync(this.file)){fs.copyFileSync(this.file,this.file+`.corrupt-${Date.now()}`);this.corrupt=false;}
  if(this.lastGood)this.atomic(this.file+'.bak',this.lastGood);this.atomic(this.file,text);this.value=value;this.lastGood=text;
 }
}
