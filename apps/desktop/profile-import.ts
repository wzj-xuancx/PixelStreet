import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {advance,parseProfile,partyBusy,PROFILE_MAX_BYTES,type Profile} from '../../packages/solo-core';
import type {GameImportPreview} from '../../packages/protocol';

export const IMPORT_MAX_BYTES=PROFILE_MAX_BYTES;
export const IMPORT_TTL_MS=10*60*1000;
export function importIdleReason(p:Profile):string {
  return p.run||p.leisure.run||partyBusy(p)?'请先让冒险队伍回营并保存，再导入进度。':'';
}

// Only an explicitly selected file reaches this class. It never searches data folders.
export class ProfileImportSession {
  private pending:{token:string;profile:Profile;generation:number;sequence:number;expires:number}|null=null;
  constructor(private readonly now:()=>number=Date.now){}
  stage(file:string,generation:number,sequence:number):GameImportPreview {
    this.pending=null;
    const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink())throw Error('请选择普通存档文件。');
    const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0));
    let bytes:Buffer;
    try {const current=fs.fstatSync(fd);if(!current.isFile()||current.size>IMPORT_MAX_BYTES)throw Error('存档超过512KiB或文件类型无效。');const buffer=Buffer.alloc(IMPORT_MAX_BYTES+1);let length=0,n=0;while(length<buffer.length&&(n=fs.readSync(fd,buffer,length,buffer.length-length,null))>0)length+=n;if(length>IMPORT_MAX_BYTES)throw Error('存档超过512KiB。');bytes=buffer.subarray(0,length);}
    finally {fs.closeSync(fd);}
    let source:unknown;try{source=JSON.parse(bytes.toString('utf8'));}catch{throw Error('文件不是有效的JSON存档。');}
    const profile=parseProfile(source),reason=importIdleReason(profile);if(reason)throw Error(reason);
    const token=randomUUID(),expires=this.now()+IMPORT_TTL_MS;
    this.pending={token,profile,generation,sequence,expires};
    return {token,fileName:path.basename(file),sourceVersion:Number((source as {version:number}).version),coins:profile.coins,xp:profile.xp,
      companions:Object.values(profile.leisure.companions).filter(x=>x!==null).length,
      buildings:Object.values(profile.leisure.journal.buildings).reduce((n,v)=>n+v,0),expiresAt:expires};
  }
  consume(token:unknown,generation:number,sequence:number):Profile {
    const pending=this.pending;
    if(!pending||typeof token!=='string'||token!==pending.token)throw Error('预览已失效，请重新选择存档。');
    if(this.now()>=pending.expires||generation!==pending.generation||sequence!==pending.sequence){this.pending=null;throw Error('预览已过期或进度已变化，请重新选择存档。');}
    this.pending=null;return structuredClone(pending.profile);
  }
  clear():void{this.pending=null;}
}

export function prepareImportedProfile(source:unknown,current:Profile,now:number):Profile {
  const imported=parseProfile(source),reason=importIdleReason(current)||importIdleReason(imported);if(reason)throw Error(reason);
  const next=advance(imported,now);
  // Active-action and room session ledgers belong to this installation. Settled
  // money, XP, camp, companion and economic progress come from the selected file.
  delete next.party;if(current.party)next.party=structuredClone(current.party);
  next.actionClaim=current.actionClaim;next.roomClaims=structuredClone(current.roomClaims);
  next.sequence=Math.max(current.sequence,next.sequence)+1;
  if(next.sequence>1e12)throw Error('存档操作序号已满，无法导入。');
  next.receipt={sequence:next.sequence,requestId:randomUUID(),fingerprint:'{"type":"import-profile"}'};
  next.notice='旧版营地进度已导入，原文件不变，覆盖前进度已另存备份。';
  return parseProfile(next);
}
