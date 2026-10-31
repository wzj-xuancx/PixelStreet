import {parseFieldAction,type FieldMode,type FieldTarget} from '../solo-core/field-adventure';
export type FieldIntent={kind:'enter'}|{kind:'mode';mode:FieldMode}|{kind:'target';target:FieldTarget}|{kind:'return'};
export interface FieldControl {type:'field-control';epoch:number;runId?:string;floor?:number;intent:FieldIntent}
export function parseFieldControl(v:Record<string,unknown>):FieldControl|null {
 if(v.type!=='field-control')return null;
 const bound=Object.hasOwn(v,'runId')&&Object.hasOwn(v,'floor'),keys=bound?'epoch floor intent runId type':'epoch intent type';
 if(Object.keys(v).sort().join(' ')!==keys||!Number.isSafeInteger(v.epoch)||Number(v.epoch)<0||!v.intent||typeof v.intent!=='object'||Array.isArray(v.intent))throw Error('底部冒险意图无效');
 const i=v.intent as Record<string,unknown>;
 if(bound&&(typeof v.runId!=='string'||!/^run-[0-9]+$/.test(v.runId)||!Number.isInteger(v.floor)||Number(v.floor)<0||Number(v.floor)>1))throw Error('底部冒险趟次无效');
 if(i.kind==='enter'){if(Object.keys(i).join(' ')!=='kind')throw Error('出发意图无效');}
 else {
  if(!bound)throw Error('底部冒险缺少趟次');
  if(i.kind==='mode'&&Object.keys(i).sort().join(' ')==='kind mode')parseFieldAction({type:'field-mode',runId:v.runId,mode:i.mode});
  else if(i.kind==='target'&&Object.keys(i).sort().join(' ')==='kind target')parseFieldAction({type:'field-target',runId:v.runId,floor:v.floor,target:i.target});
  else if(i.kind!=='return'||Object.keys(i).join(' ')!=='kind')throw Error('底部冒险意图无效');
 }
 return structuredClone(v) as unknown as FieldControl;
}
