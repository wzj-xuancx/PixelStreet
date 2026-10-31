import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {initialProfile,parseProfile,PROFILE_MAX_BYTES,type Profile} from '../../packages/solo-core';
class MigrationBackupError extends Error {}
// Never silently reset economic progress. Preserve invalid files and fail closed.
export class GameStore {
  readonly file:string;warnings:string[]=[];value:Profile;private lastGood:string='';private corrupt=false;
  constructor(folder:string,now=Date.now()){
    fs.mkdirSync(folder,{recursive:true,mode:0o700});this.file=path.join(folder,'profile.json');let found=false,value:Profile|undefined;
    for(const [file,backup]of [[this.file,false],[this.file+'.bak',true]]as const){
      if(!fs.existsSync(file))continue;
      found=true;
      try{
        if(fs.statSync(file).size>PROFILE_MAX_BYTES)throw Error('存档超过512KiB');
        const bytes=fs.readFileSync(file);if(bytes.length>PROFILE_MAX_BYTES)throw Error('存档超过512KiB');
        const raw=JSON.parse(bytes.toString('utf8'));
        // Validate into a tentative value first: an invalid primary must not reserve the fallback's backup name.
        const parsed=parseProfile(raw);
        if(raw.version===1||raw.version===2||raw.version===3||raw.version===4||raw.version===5||raw.version===6||raw.version===7){
          const version=raw.version,preserved=path.join(folder,`profile.v${version}-before-migration.json`);
          // A stale or different file is not an exact preservation of this source.
          try{
            if(!fs.existsSync(preserved))fs.writeFileSync(preserved,bytes,{flag:'wx',mode:0o600});
            if(!fs.lstatSync(preserved).isFile()||!fs.readFileSync(preserved).equals(bytes))throw Error('旧版存档原件备份不匹配');
          }catch{throw new MigrationBackupError('旧版存档原件备份失败，拒绝迁移');}
          this.warnings.push(`v${version}单机存档已无损升级，原件保留于${path.basename(preserved)}。`);
        }
        value=parsed;
        if(backup)this.warnings.push('主存档无法读取，已从有效备份恢复；损坏原件将另存保留。');
        break;
      }catch(error){if(error instanceof MigrationBackupError)throw error;if(!backup)this.corrupt=true;this.warnings.push(`${backup?'备份':'主'}存档无效，原件保留。`);}
    }
    if(!value&&found)throw Error('单机存档与备份无法读取，玩法已暂停；请保留文件排查，不会清空进度。');
    this.value=value??initialProfile(now);this.lastGood=JSON.stringify(this.value);if(!found)this.save(this.value);
  }
  importProgress(input:Profile):string {
    const value=parseProfile(input),backup=path.join(path.dirname(this.file),`profile.before-import-${Date.now()}-${randomUUID()}.json`);
    fs.copyFileSync(this.file,backup,fs.constants.COPYFILE_EXCL);
    this.save(value);this.warnings.push(`进度已导入；覆盖前备份：${path.basename(backup)}`);return backup;
  }
  private atomic(file:string,text:string):void{const temp=file+`.tmp-${process.pid}`;try{const fd=fs.openSync(temp,'w',0o600);try{fs.writeFileSync(fd,text+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temp,file);}catch(e){try{fs.unlinkSync(temp);}catch{}throw e;}}
  save(input:Profile):void{const value=parseProfile(input),text=JSON.stringify(value);if(Buffer.byteLength(text+'\n')>PROFILE_MAX_BYTES)throw Error('存档超过512KiB');if(this.corrupt&&fs.existsSync(this.file)){fs.copyFileSync(this.file,this.file+`.corrupt-${Date.now()}`);this.corrupt=false;}
    if(this.lastGood)this.atomic(this.file+'.bak',this.lastGood);this.atomic(this.file,text);this.value=value;this.lastGood=text;
  }
}
