/** Explicit saved-v1 fixture: old assertions keep their original rules. Never exposed by product IPC. */
import {transact,parseProfile,type Profile,type GameAction,FIELD_FLOORS,type FieldRun,type FieldMonster} from '../packages/solo-core';
const monster=(floor:number,e:number,m:number):FieldMonster=>{const c=FIELD_FLOORS[floor].encounters[e];return {id:`f${floor}-e${e}-m${m}`,kind:c.kind,x:c.x+m*36,hp:c.hp,max:c.hp,stage:'idle',due:0,aimX:c.x};};
function attach(p:Profile):void{
 const r=p.run!;const f:FieldRun={version:1,legacyEnemyMax:r.phase==='fight'?r.enemyMax:null,moveRemainder:0,floor:0,x:40,mode:'manual',target:null,farmTarget:null,active:null,miningDue:0,recoverUntil:0,safe:null,floors:FIELD_FLOORS.map((_,floor)=>({encounters:[0,1,2].map(e=>({cleared:false,readyAt:0,monsters:[0,1].map(m=>monster(floor,e,m))})),oreReadyAt:0,revealed:400}))};r.field=f;
 if(r.phase==='fight'){
  f.active=0;f.x=290;f.floors[0].revealed=530;const ms=f.floors[0].encounters[0].monsters;
  ms[0].max=Math.ceil(r.enemyMax/2);ms[1].max=Math.floor(r.enemyMax/2);ms[0].hp=Math.min(ms[0].max,r.enemyHP);ms[1].hp=r.enemyHP-ms[0].hp;for(const m of ms){m.stage='windup';m.aimX=f.x;m.due=r.enemyAttack;}
  f.target={kind:'monster',id:ms[0].id};
 }else if(r.phase==='recover'){f.recoverUntil=Math.max(p.tick+1,r.due);r.enemyHP=0;r.enemyMax=0;}else{r.enemyHP=0;r.enemyMax=0;}
}

export function enterLegacyField(source:Profile,budget:number):Profile{let p=structuredClone(source);if(!p.run)p=transact(p,{sequence:p.sequence+1,requestId:'legacy-field-'+(p.sequence+1),action:{type:'start-run',region:0,budget,auto:false}});else{p.sequence++;p.receipt={sequence:p.sequence,requestId:'legacy-field-'+p.sequence,fingerprint:JSON.stringify({type:'field-enter',budget})};}attach(p);return parseProfile(p);}
export const legacyFieldAction=(p:Profile,a:GameAction):Profile=>a.type==='field-enter'?enterLegacyField(p,a.budget):transact(p,{sequence:p.sequence+1,requestId:'field-test-'+(p.sequence+1),action:a});
