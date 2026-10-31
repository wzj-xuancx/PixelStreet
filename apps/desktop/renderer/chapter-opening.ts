export interface OpeningState {phase:'idle'|'fight'|'hurt'|'defeated'|'done';elapsed:number;hp:number;enemyHP:number;suspended:boolean}
export type OpeningInput={type:'start'|'skip'|'suspend'|'resume'}|{type:'advance';ms:number};
export const initialOpening=():OpeningState=>({phase:'idle',elapsed:0,hp:6,enemyHP:24,suspended:false});
/** Local presentation only: this module has no Profile, RNG, clock or IPC dependency. */
export function openingReduce(s:OpeningState,a:OpeningInput):OpeningState {
 if(a.type==='skip')return {...s,phase:'done'};
 if(a.type==='start')return {...initialOpening(),phase:'fight'};
 if(a.type==='suspend'||a.type==='resume')return {...s,suspended:a.type==='suspend'};
 if(s.suspended||s.phase==='idle'||s.phase==='done'||s.phase==='defeated')return s;
 if(a.type!=='advance')return s;
 const elapsed=s.elapsed+Math.max(0,Math.min(a.ms,200));
 return {...s,elapsed,phase:elapsed>=4800?'defeated':elapsed>=2200?'hurt':'fight',hp:elapsed>=4800?0:elapsed>=2200?3:6,enemyHP:elapsed>=3600?12:elapsed>=1000?18:24};
}
