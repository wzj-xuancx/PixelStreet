import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
// The durable installation id is also the room reward issuer. Invalid identity never generates a new issuer silently.
export function installationId(folder:string):string {
 fs.mkdirSync(folder,{recursive:true,mode:0o700});const file=path.join(folder,'installation.json');let found=false;
 for(const candidate of [file,file+'.bak']){
  if(!fs.existsSync(candidate))continue;found=true;
  try{
   if(fs.statSync(candidate).size>1024)throw Error('identity too large');const x=JSON.parse(fs.readFileSync(candidate,'utf8'));
   if(!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).sort().join(',')!=='id,version'||x.version!==1||typeof x.id!=='string'||!/^[a-f0-9]{32}$/.test(x.id))throw Error('invalid identity');
   return x.id;
  }catch{}
 }
 if(found)throw Error('房间身份文件及备份无效，已停用房间；请保留文件排查，不会生成新身份覆盖。');
 const id=randomBytes(16).toString('hex'),text=JSON.stringify({version:1,id})+'\n';
 const atomic=(target:string)=>{const temp=target+`.tmp-${process.pid}`;try{const fd=fs.openSync(temp,'wx',0o600);try{fs.writeFileSync(fd,text);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temp,target);}catch(e){try{fs.unlinkSync(temp);}catch{}throw e;}};
 atomic(file);atomic(file+'.bak');return id;
}
