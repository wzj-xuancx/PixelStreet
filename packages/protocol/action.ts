import {parseActionInput,type ActionInput,type ActionState,type Weapon} from '../action-core';
export interface ActionSource {hostId:string;sequence:number;role:'host'|'guest';playerId:string}
export function parseActionSource(value:unknown):ActionSource {
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)throw Error('房间冒险来源无效');
 const x=value as Record<string,unknown>;
 if(Object.keys(x).sort().join(',')!=='hostId,playerId,role,sequence'||typeof x.hostId!=='string'||!/^[a-f0-9]{32}$/.test(x.hostId)||typeof x.playerId!=='string'||!/^[a-f0-9]{32}$/.test(x.playerId)||typeof x.role!=='string'||!['host','guest'].includes(x.role)||typeof x.sequence!=='number'||!Number.isSafeInteger(x.sequence)||x.sequence<1||x.sequence>1e12)throw Error('房间冒险来源字段无效');
 return {...x} as unknown as ActionSource;
}
export interface ActionSession {status:'ready'|'blocked'|'loading';run:ActionState|null;claim:number;settled:boolean;source:ActionSource|null;localPlayerId:string;error:string;warnings:string[]}
export type ArenaCommand={type:'open-action';generation:number}|{type:'action-start';weapon:Weapon}|{type:'action-input';input:ActionInput}|{type:'action-close'|'action-return'|'action-claim'};
export function parseArenaCommand(v:Record<string,unknown>):ArenaCommand|null {
 const n=Object.keys(v).length;
 if(v.type==='open-action'&&n===2&&typeof v.generation==='number'&&Number.isSafeInteger(v.generation)&&v.generation>0)return v as ArenaCommand;
 if(v.type==='action-start'&&n===2&&typeof v.weapon==='string'&&['wand','bow','scatter'].includes(v.weapon))return v as ArenaCommand;
 if(v.type==='action-input'&&n===2)return {type:'action-input',input:parseActionInput(v.input)};
 if(['action-close','action-return','action-claim'].includes(String(v.type))&&n===1)return v as ArenaCommand;
 return null;
}
