import {parseDungeonInput,type DungeonInput,type DungeonRun,type WeaponKind} from '../dungeon-core';
export interface DungeonSession {
 status:'loading'|'ready'|'blocked';run:DungeonRun|null;claim:number;settled:boolean;
 catalog:WeaponKind[];receipt?:{claim:number;coins:number;xp:number}|null;error:string;warnings:string[];logicHz:number;droppedMs:number;
}
export type DungeonCommand={type:'dungeon-start';seed:number}|{type:'dungeon-input';input:DungeonInput}|{type:'dungeon-close'|'dungeon-minimize'|'dungeon-return'|'dungeon-claim'};
export function parseDungeonCommand(x:Record<string,unknown>):DungeonCommand|null {
 const n=Object.keys(x).length;
 if(x.type==='dungeon-start'&&n===2&&typeof x.seed==='number'&&Number.isSafeInteger(x.seed)&&x.seed>0&&x.seed<=0xffffffff)return x as DungeonCommand;
 if(x.type==='dungeon-input'&&n===2){const input=parseDungeonInput(x.input);if(input)return{type:'dungeon-input',input};}
 if(['dungeon-close','dungeon-minimize','dungeon-return','dungeon-claim'].includes(String(x.type))&&n===1)return x as DungeonCommand;
 return null;
}
export const emptyDungeon=():DungeonSession=>({status:'loading',run:null,claim:0,settled:true,catalog:[],error:'',warnings:[],logicHz:0,droppedMs:0});
export function bankedDungeonReward(s:Pick<DungeonSession,'run'>):{coins:number;xp:number} {
 const r=s.run;if(!r)return{coins:0,xp:0};const multiplier=r.phase==='won'?1:.5;
 return{coins:Math.floor(r.reward.coins*multiplier),xp:Math.floor(r.reward.xp*multiplier)};
}
