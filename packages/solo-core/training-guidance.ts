import type {Profile} from './index';
import {bondsOf,buddyXP,bondReason,PATHS,TRAINING} from './bonds';
import type {Buddy} from './companions';
import {COMPANIONS,companionLevel} from './leisure';
/** The selected companion's actual next training requirements; no extension is installed. */
export function trainingGuidance(p:Profile,buddy:Buddy=p.leisure.active){
 const l=p.leisure,g=bondsOf(l).progress[buddy],xp=buddyXP(l,buddy),n=g.rank;
 const reason=bondReason(p,{type:'buddy-train',companion:buddy});
 if(n===3)return {buddy,name:COMPANIONS[buddy].name,reason,requirements:['三阶专长已完成。'],missing:[]};
 const checks:[string,boolean][]=[['已邀请',xp!==null],[`${xp===null?'未邀请':'Lv'+companionLevel(xp)} / Lv${[2,3,5][n]}`,xp!==null&&xp>=TRAINING.xp[n]],[`同行 ${g.voyages} / ${TRAINING.voyages[n]}趟`,g.voyages>=TRAINING.voyages[n]],[g.path?`路线 ${PATHS[g.path].name}`:'尚未选择培养路线',!!g.path],[`金币 ${p.coins} / ${TRAINING.coins[n]}`,p.coins>=TRAINING.coins[n]],[`月纹石 ${l.materials.ore} / ${TRAINING.ore[n]}`,l.materials.ore>=TRAINING.ore[n]]];
 if(g.path)checks.push([`${PATHS[g.path].foodName} ${l.materials[PATHS[g.path].food]} / ${TRAINING.food[n]}`,l.materials[PATHS[g.path].food]>=TRAINING.food[n]]);
 return {buddy,name:COMPANIONS[buddy].name,reason,requirements:checks.map(([text,met])=>(met?'✓ ':'待备 · ')+text),missing:checks.filter(([,met])=>!met).map(([text])=>text)};
}
