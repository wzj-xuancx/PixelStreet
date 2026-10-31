import {createFieldWorld,stepFieldWorld,parseFieldWorld,fieldView,type FieldWorld,type FieldEffect,type FieldConfirmation,type RewardPackage,type FieldView} from '../field-world';
import {equipmentOf,equipmentEffects} from './equipment';
import {petsOf,petEffects} from './pets';
import type {IdleRun,Profile,GameplayObserver} from './index';
export type FieldMode='manual'|'farm'|'push';
export type FieldTarget={kind:'ground';x:number}|{kind:'monster';id:string}|{kind:'ore';id:string}|{kind:'exit'};
export type FieldAction={type:'field-enter';budget:number;supply?:'herbal-bandage'|'mining-tonic'|null}|{type:'field-mode';runId:string;mode:FieldMode}|{type:'field-target';runId:string;floor:number;target:FieldTarget}|{type:'field-return';runId:string};
export type FieldEnemyKind='melee'|'ranged'|'charge'|'guardian';
export interface FieldMonster {id:string;kind:FieldEnemyKind;x:number;hp:number;max:number;stage:'idle'|'windup'|'projectile'|'charge';due:number;aimX:number}
export interface FieldEncounter {cleared:boolean;readyAt:number;monsters:FieldMonster[]}
export interface FieldFloor {encounters:FieldEncounter[];oreReadyAt:number;revealed:number}
export interface FieldRun {version:1|2;rulesVersion?:2;world?:FieldWorld;legacyEnemyMax:number|null;moveRemainder?:number;floor:number;x:number;mode:FieldMode;target:FieldTarget|null;farmTarget:FieldTarget|null;active:number|null;miningDue:number;recoverUntil:number;safe:{floor:number;encounter:number}|null;floors:FieldFloor[]}
export const FIELD_FLOORS=[0,1].map(floor=>({id:floor,name:floor?'裂晶洞口':'萤石荒径',width:1400,entryX:40,exitX:1320,ore:{id:`f${floor}-ore`,x:150},encounters:[320,700,1080].map((x,i)=>({id:`f${floor}-e${i}`,x,kind:(['melee','ranged','charge'] as const)[i],hp:8+i*2+floor*2,attack:1+i+floor,interval:[20,26,38][i],windup:[6,10,16][i]}))}));
const rec=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
function shape(v:unknown,keys:string):asserts v is Record<string,unknown>{if(!rec(v)||Object.keys(v).sort().join(' ')!==keys.split(' ').sort().join(' '))throw Error('横向冒险字段无效');}
function int(v:unknown,max=1e15,min=0):asserts v is number{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<min||v>max)throw Error('横向冒险数值无效');}
function target(v:unknown,summons=false):asserts v is FieldTarget{if(!rec(v))throw Error('横向目标无效');if(v.kind==='ground'){shape(v,'kind x');int(v.x,1400);}else if(v.kind==='exit')shape(v,'kind');else if(v.kind==='ore'||v.kind==='monster'){shape(v,'kind id');if(typeof v.id!=='string'||!(v.kind==='ore'?/^f[01]-ore$/:summons?/^f[01]-e[0-2]-m[0-3]$/:/^f[01]-e[0-2]-m[01]$/).test(v.id))throw Error('横向目标标识无效');}else throw Error('横向目标无效');}
export function parseFieldAction(v:unknown):FieldAction|null{
 if(!rec(v)||typeof v.type!=='string'||!v.type.startsWith('field-'))return null;
 if(v.type==='field-enter'){shape(v,'type budget'+(Object.hasOwn(v,'supply')?' supply':''));int(v.budget,9,1);if(Object.hasOwn(v,'supply')&&v.supply!==null&&v.supply!=='herbal-bandage'&&v.supply!=='mining-tonic')throw Error('随行物资无效');return v as unknown as FieldAction;}
 if(v.type==='field-mode'){shape(v,'type runId mode');if(typeof v.mode!=='string'||!['manual','farm','push'].includes(v.mode))throw Error('横向模式无效');}
 else if(v.type==='field-target'){shape(v,'type runId floor target');int(v.floor,1);target(v.target,true);}
 else if(v.type==='field-return')shape(v,'type runId');else throw Error('横向操作无效');
 if(typeof v.runId!=='string'||!/^run-[0-9]+$/.test(v.runId))throw Error('横向趟次无效');return structuredClone(v) as unknown as FieldAction;
}
export const fieldOf=(p:Profile):FieldRun|null=>p.run?.field??null;
export interface FieldHooks {start:(budget:number)=>void;begin:()=>void;win:()=>void;finish:(reason:string)=>void;stats:()=>{attack:number;defence:number;travelPercent:number};observe?:GameplayObserver;consume?:(kind:'encounter'|'mining',details:{floor:number;encounter:number|null})=>boolean;reward?:(reward:RewardPackage)=>boolean}
function current(p:Profile){const f=fieldOf(p)!;return {r:p.run!,f,level:f.floors[f.floor],catalog:FIELD_FLOORS[f.floor]};}
function encounterOf(f:FieldRun,t:FieldTarget|null):number|null{if(t?.kind!=='monster')return null;const match=/^f([01])-e([0-2])-m[01]$/.exec(t.id);return match&&Number(match[1])===f.floor?Number(match[2]):null;}
function sync(r:IdleRun,f:FieldRun):void{const ms=f.active===null?[]:f.floors[f.floor].encounters[f.active].monsters;r.enemyHP=ms.reduce((s,m)=>s+m.hp,0);r.enemyMax=ms.reduce((s,m)=>s+m.max,0);}
function validTarget(p:Profile,t:FieldTarget):void{
 const {f,level,catalog}=current(p);const e=encounterOf(f,t);
 if(t.kind==='monster'&&(e===null||!level.encounters[e].monsters.some(m=>m.id===t.id)))throw Error('魔物不在当前关卡');
 if(t.kind==='ore'&&t.id!==catalog.ore.id)throw Error('矿点不在当前关卡');
 if(t.kind==='exit'&&!level.encounters.every(e=>e.cleared))throw Error('先清除本关三处遭遇');
 const x=t.kind==='ground'?t.x:t.kind==='ore'?catalog.ore.x:t.kind==='exit'?catalog.exitX:catalog.encounters[e!].x;
 if(x>level.revealed)throw Error('目标尚未发现，请沿路前进');
}
export function applyField(p:Profile,a:FieldAction,h:FieldHooks):void{
 if(a.type==='field-enter'){if(p.run&&!p.run.field)throw Error('原远征仍在进行，请原样继续或回营');if(p.run?.field)throw Error('已经在横向冒险中');if(a.supply&&!(p.atelier?.stock[a.supply]))throw Error('背包中没有这件随行物资');if(!p.run)h.start(a.budget);installV2(p,a.supply??null,h);p.notice='采集硬骨片、咒晶碎片、韧皮，制作装备后挑战裂晶守卫。';return;}
 const r=p.run;if(!r?.field||r.id!==a.runId)throw Error('横向趟次已变化');const f=r.field;if(f.version===2){applyV2(p,a,h);return;}
 if(a.type==='field-return'){h.finish('主动回营，已结算战利品');return;}
 if(a.type==='field-mode'){
  if(f.mode===a.mode)return;
  if(a.mode==='farm'){
   const chosen=f.target?.kind==='monster'||f.target?.kind==='ore'?f.target:f.farmTarget;
   if(!chosen)throw Error('先点选一处魔物或矿点，再刷材料');f.farmTarget=structuredClone(chosen);
  }
  f.mode=a.mode;return;
 }
 if(a.floor!==f.floor)throw Error('关卡已变化');validTarget(p,a.target);
 f.target=structuredClone(a.target);f.miningDue=0;
 if(a.target.kind==='monster'||a.target.kind==='ore')f.farmTarget=structuredClone(a.target);
 // An explicit ground/exit click performs a single manual movement.
 if(a.target.kind==='ground'||a.target.kind==='exit')f.mode='manual';
}
function done(f:FieldRun):void{f.miningDue=0;if(f.mode!=='farm')f.target=null;}
function move(f:FieldRun,x:number,travelPercent:number):boolean{
 const d=x-f.x;
 if(d!==0){
  // 8 units per tick at100%; frozen boots reduce travel time to95%.
  // Persist the integer division remainder so rounding cannot erase the effect.
  const units=800+(f.moveRemainder??0),distance=Math.floor(units/travelPercent);
  f.moveRemainder=units%travelPercent;f.x+=Math.sign(d)*Math.min(distance,Math.abs(d));
 }
 f.floors[f.floor].revealed=Math.max(f.floors[f.floor].revealed,Math.min(1400,f.x+360));return Math.abs(x-f.x)<=24;
}
function defeat(p:Profile,h:FieldHooks):void{
 const {r,f,level}=current(p);if(f.active!==null){const group=level.encounters[f.active];for(const m of group.monsters){m.hp=m.max;m.stage='idle';m.due=0;}group.readyAt=p.tick+300;}
 f.active=null;f.miningDue=0;sync(r,f);
 if(!r.remaining||!f.safe){h.finish('失利，没有可退守地点或补给，保留战利品回营');return;}
 f.floor=f.safe.floor;r.region=f.floor;f.x=FIELD_FLOORS[f.floor].encounters[f.safe.encounter].x-30;f.target={kind:'monster',id:f.floors[f.floor].encounters[f.safe.encounter].monsters[0].id};f.farmTarget=structuredClone(f.target);f.mode='farm';f.recoverUntil=p.tick+80;r.phase='recover';r.hp=0;r.due=f.recoverUntil;p.notice=r.log='失利，退回最近战胜地点，8秒整备后刷材料。';
}
export function stepField(p:Profile,h:FieldHooks):void{
 if(!p.run?.field)return;if(p.run.field.version===2){advanceV2(p,[],100,h);return;}let {r,f,level,catalog}=current(p);
 if(f.recoverUntil){if(p.tick<f.recoverUntil)return;f.recoverUntil=0;r.hp=35;r.phase='travel';}
 if(f.active!==null){
  const group=level.encounters[f.active],c=catalog.encounters[f.active],alive=group.monsters.filter(m=>m.hp>0),nearest=alive.sort((a,b)=>Math.abs(a.x-f.x)-Math.abs(b.x-f.x))[0];
  // Combat remains locked to its nearest living member; intents never attack another group.
  if(f.target?.kind==='ground')move(f,f.target.x,h.stats().travelPercent);else if(nearest)move(f,Math.max(0,nearest.x-24),h.stats().travelPercent);
  if(nearest&&Math.abs(nearest.x-f.x)<=48&&p.tick>=r.nextAttack){const damage=Math.min(nearest.hp,h.stats().attack);nearest.hp-=damage;r.nextAttack=p.tick+10;h.observe?.({tick:p.tick,runId:r.id,wave:r.wave,kind:'attack',amount:damage});}
  sync(r,f);
  if(!r.enemyHP){group.cleared=true;group.readyAt=p.tick+300;f.safe={floor:f.floor,encounter:f.active};f.active=null;h.win();if(p.run!==r)return;sync(r,f);done(f);return;}
  for(const m of group.monsters){
   if(m.hp<=0)continue;
   if(m.stage==='idle'){
    if(m.kind==='melee'&&Math.abs(m.x-f.x)>48){m.x+=Math.sign(f.x-m.x)*Math.min(4,Math.abs(f.x-m.x));continue;}
    if(p.tick>=m.due){m.stage='windup';m.aimX=f.x;m.due=p.tick+c.windup;}
   }else if(p.tick>=m.due){
    if(m.kind==='ranged'&&m.stage==='windup'){m.stage='projectile';m.due=p.tick+6;continue;}
    const hit=m.kind==='melee'?Math.abs(m.x-f.x)<=60:Math.abs(m.aimX-f.x)<(m.kind==='charge'?90:50);
    if(m.kind==='charge')m.x=m.aimX;
    if(hit){const damage=Math.min(r.hp,Math.max(1,c.attack-h.stats().defence));r.hp-=damage;h.observe?.({tick:p.tick,runId:r.id,wave:r.wave,kind:'hurt',amount:damage});}
    m.stage='idle';m.due=p.tick+c.interval;
    if(!r.hp){defeat(p,h);return;}
   }
  }
  return;
 }
 if(!r.remaining){h.finish('补给耗尽，已安全回营');return;}
 if(!f.target&&f.mode==='push'){
  const next=level.encounters.findIndex(e=>!e.cleared);f.target=next<0?{kind:'exit'}:{kind:'monster',id:level.encounters[next].monsters[0].id};
 }
 if(!f.target&&f.mode==='farm')f.target=f.farmTarget&&structuredClone(f.farmTarget);
 const t=f.target;if(!t)return;
 const e=encounterOf(f,t),x=t.kind==='ground'?t.x:t.kind==='ore'?catalog.ore.x:t.kind==='exit'?catalog.exitX:catalog.encounters[e!].x;
 // Walking toward a target cannot bypass a living encounter or its reward transaction.
 const blocker=level.encounters.findIndex((g,i)=>!g.cleared&&catalog.encounters[i].x>=f.x-48&&catalog.encounters[i].x<=Math.max(f.x,x)+48);
 const destination=blocker>=0&&x>=f.x?Math.min(x,catalog.encounters[blocker].x-24):x;
 if(!move(f,destination,h.stats().travelPercent))return;
 const engage=blocker>=0&&Math.abs(f.x-catalog.encounters[blocker].x)<=50?blocker:e;
 if(engage!==null&&engage>=0&&(t.kind==='monster'||blocker>=0)){
  const group=level.encounters[engage];if(group.cleared){if(f.mode!=='farm'){done(f);return;}if(p.tick<group.readyAt)return;for(const m of group.monsters){m.hp=m.max;m.stage='idle';m.due=0;}/* cleared remains a gate achievement */}
  const hp=r.hp;r.region=f.floor;h.begin();if(p.run!==r)return;r.hp=hp;f.active=engage;r.phase='fight';for(const m of group.monsters)m.due=p.tick;sync(r,f);return;
 }
 if(t.kind==='ground'){f.x=x;done(f);return;}
 if(t.kind==='ore'){
  if(p.leisure.materials.ore>=9999){f.target=null;f.mode='manual';f.miningDue=0;p.notice='月纹石库存已满，开采暂停。';return;}
  if(p.tick<level.oreReadyAt)return;
  if(!f.miningDue){f.miningDue=p.tick+30;return;}if(p.tick<f.miningDue)return;
  r.remaining--;r.spent++;p.leisure.materials.ore++;level.oreReadyAt=p.tick+300;done(f);p.notice='采得月纹石 +1，可制作行路短靴或短剑。';if(!r.remaining)h.finish('补给耗尽，采矿收益已保存并回营');return;
 }
 if(t.kind==='exit'){
  if(!level.encounters.every(e=>e.cleared)){f.target=null;return;}
  if(f.floor===1){h.finish('两关探索完成，已安全回营');return;}
  f.floor=1;r.region=1;f.x=40;f.target=null;f.farmTarget=null;f.miningDue=0;p.notice='穿过魔幻门，进入裂晶洞口。';
 }
}
/** Presentation only. Waiting/recovery uses the ordinary 500ms Worker interval. */
export function fieldWork(p:Profile):boolean{const f=fieldOf(p);if(f?.world)return fieldViewWork(fieldView(f.world,'solo'));if(!f||f.recoverUntil)return false;if(f.active!==null)return true;if(!f.target)return f.mode==='push';if(f.target.kind==='ore'&&Math.abs(f.x-FIELD_FLOORS[f.floor].ore.x)<=24&&f.floors[f.floor].oreReadyAt>p.tick)return false;const e=encounterOf(f,f.target);if(e!==null&&Math.abs(f.x-FIELD_FLOORS[f.floor].encounters[e].x)<=24&&f.floors[f.floor].encounters[e].cleared&&f.floors[f.floor].encounters[e].readyAt>p.tick)return false;return true;}
export function validateFieldRun(v:unknown,r:IdleRun):asserts v is FieldRun{
 if(rec(v)&&v.version===2){validateV2(v,r);return;}
 shape(v,'version legacyEnemyMax floor x mode target farmTarget active miningDue recoverUntil safe floors'+(rec(v)&&Object.hasOwn(v,'moveRemainder')?' moveRemainder':''));if(Object.hasOwn(v,'moveRemainder'))int(v.moveRemainder,99);if(v.version!==1||typeof v.mode!=='string'||!['manual','farm','push'].includes(v.mode))throw Error('横向版本/模式无效');if(v.legacyEnemyMax!==null)int(v.legacyEnemyMax,100,1);int(v.floor,1);int(v.x,1400);int(v.miningDue);int(v.recoverUntil);if(v.active!==null)int(v.active,2);
 for(const t of [v.target,v.farmTarget])if(t!==null){target(t);if(t.kind==='ore'&&t.id!==FIELD_FLOORS[v.floor].ore.id||t.kind==='monster'&&!t.id.startsWith(`f${v.floor}-`))throw Error('横向目标关卡无效');}
 if(v.safe!==null){shape(v.safe,'floor encounter');int(v.safe.floor,1);int(v.safe.encounter,2);}
 if(!Array.isArray(v.floors)||v.floors.length!==2)throw Error('横向关卡数无效');
 for(let fi=0;fi<2;fi++){
  const l=v.floors[fi];shape(l,'encounters oreReadyAt revealed');int(l.oreReadyAt);int(l.revealed,1400,400);if(!Array.isArray(l.encounters)||l.encounters.length!==3)throw Error('遭遇数无效');
  for(let ei=0;ei<3;ei++){const g=l.encounters[ei];shape(g,'cleared readyAt monsters');if(typeof g.cleared!=='boolean')throw Error('清关状态无效');int(g.readyAt);if(!Array.isArray(g.monsters)||g.monsters.length!==2)throw Error('魔物数无效');for(let mi=0;mi<2;mi++){const m=g.monsters[mi];shape(m,'id kind x hp max stage due aimX');if(m.id!==`f${fi}-e${ei}-m${mi}`||m.kind!==FIELD_FLOORS[fi].encounters[ei].kind||(typeof m.stage!=='string'||!['idle','windup','projectile'].includes(m.stage)))throw Error('魔物状态无效');int(m.x,1400);const expected=fi===0&&ei===0&&v.legacyEnemyMax!==null?(mi===0?Math.ceil((v.legacyEnemyMax as number)/2):Math.floor((v.legacyEnemyMax as number)/2)):FIELD_FLOORS[fi].encounters[ei].hp;if(m.max!==expected)throw Error('魔物上限无效');int(m.hp,expected);int(m.due);int(m.aimX,1400);}}
 }
 const f=v as unknown as FieldRun;const ms=f.active===null?[]:f.floors[f.floor].encounters[f.active].monsters;
 if(r.enemyHP!==ms.reduce((s,m)=>s+m.hp,0)||r.enemyMax!==ms.reduce((s,m)=>s+m.max,0)||(f.active!==null)!==(r.phase==='fight'))throw Error('魔物生命汇总不一致');
 if(f.farmTarget&&f.farmTarget.kind!=='monster'&&f.farmTarget.kind!=='ore')throw Error('刷取目标无效');
 if(f.mode==='farm'&&!f.farmTarget)throw Error('刷取地点缺失');
 if((f.recoverUntil>0)!==(r.phase==='recover')||(f.miningDue>0&&(f.target?.kind!=='ore'||f.active!==null||f.recoverUntil>0)))throw Error('横向计时状态无效');
 if(f.safe&&!f.floors[f.safe.floor].encounters[f.safe.encounter].cleared)throw Error('退守点未战胜');if(f.floor===1&&!f.floors[0].encounters.every(g=>g.cleared))throw Error('关卡门未解锁');
}

function installV2(p:Profile,supply:'herbal-bandage'|'mining-tonic'|null,h:FieldHooks):void{
 const r=p.run!,slots=p.equipment?.active?.slots??equipmentOf(p).slots,effects=equipmentEffects(slots),pet=petsOf(p),stats=h.stats();
 let seed=p.rng|0;seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;p.rng=seed>>>0;
 const world=createFieldWorld({sessionId:r.id,seed:p.rng,actors:[{id:'solo',loadout:{gear:Object.values(slots).filter((x):x is NonNullable<typeof x>=>x!==null),attack:stats.attack,defence:stats.defence,maxHP:p.upgraded?80:70,heal:effects.heal,spell:effects.spell,gather:effects.gather,travelPercent:effects.travelPercent,pet:pet.role==='expedition'?petEffects(pet.slots):null,supply,budget:r.budget}}]});
 // Reserve one unit at departure. It stays unavailable to crafting/selling; unused unit is returned.
 if(supply)p.atelier!.stock[supply]--;
 r.field={version:2,rulesVersion:2,world,legacyEnemyMax:null,moveRemainder:0,floor:0,x:40,mode:'manual',target:null,farmTarget:null,active:null,miningDue:0,recoverUntil:0,safe:null,floors:[]};projectV2(r);
}
function projectV2(r:IdleRun):void{const f=r.field!,w=f.world!,a=w.actors[0];f.floor=a.floor;f.x=a.x;f.mode=a.mode;f.target=structuredClone(a.target);f.farmTarget=structuredClone(a.farmTarget);f.active=w.active;f.miningDue=a.miningDue;f.recoverUntil=a.recoverUntil;f.safe=structuredClone(a.safe);f.moveRemainder=a.moveRemainder;
 f.floors=w.floors.map((level,fi)=>({revealed:level.revealed,oreReadyAt:a.oreReadyAt[fi],encounters:level.encounters.map(g=>({cleared:g.cleared,readyAt:g.readyAt,monsters:g.monsters.map(m=>({id:m.id,kind:m.kind,x:m.x,hp:m.hp,max:m.max,stage:m.stage,due:m.due,aimX:m.aimX}))}))}));r.hp=a.hp;r.remaining=a.remaining;r.spent=a.spent;r.region=a.floor;r.nextAttack=a.nextAttack;r.phase=a.recoverUntil?'recover':w.active!==null?'fight':'travel';r.due=a.recoverUntil||paddedDue(w.tick);sync(r,f);
}
const paddedDue=(tick:number)=>tick+1;
function applyV2(p:Profile,a:Exclude<FieldAction,{type:'field-enter'}>,h:FieldHooks):void{const f=p.run!.field!;if(a.type==='field-target'&&a.floor!==f.floor)throw Error('关卡已变化');advanceV2(p,[a.type==='field-return'?{actorId:'solo',kind:'return'}:a.type==='field-mode'?{actorId:'solo',kind:'mode',mode:a.mode}:{actorId:'solo',kind:'target',target:a.target}],0,h);}
function advanceV2(p:Profile,intents:Parameters<typeof stepFieldWorld>[1],ms:number,h:FieldHooks):void{const r=p.run!,f=r.field!;let result=stepFieldWorld(f.world!,intents,ms),round=0;const returns:FieldEffect[]=[];
 while(true){f.world=result.world;projectV2(r);const confirmations:FieldConfirmation[]=[];for(const e of result.effects){if(e.type==='return'){returns.push(e);continue;}if(e.type==='consume-needed'){const accepted=!!h.consume?.(e.kind,e);confirmations.push({eventId:e.id,actorId:e.actorId,accepted});if(accepted&&e.kind==='encounter')r.wave++;}else if(e.type==='supply-needed')confirmations.push({eventId:e.id,actorId:e.actorId,accepted:true});else if(e.type==='reward-candidate'||e.type==='mine-complete'){const accepted=!!h.reward?.(e.reward);confirmations.push({eventId:e.id,actorId:e.actorId,accepted});if(accepted)p.notice=e.type==='mine-complete'?`采得月纹石 +${e.reward.ore}，已收入背包。`:e.reward.guardian?'裂晶守卫已击败！野外挑战徽记可在成就之塔领取。':'遭遇胜利，材料与奖励已收入背包。';}}
  if(!confirmations.length||++round>8)break;result=stepFieldWorld(f.world!,[],0,confirmations);
 }
 f.world=result.world;projectV2(r);if(returns.length){h.finish((returns.at(-1) as Extract<FieldEffect,{type:'return'}>).reason);}
}
function validateV2(raw:Record<string,unknown>,r:IdleRun):void{shape(raw,'version rulesVersion world legacyEnemyMax moveRemainder floor x mode target farmTarget active miningDue recoverUntil safe floors');if(raw.rulesVersion!==2||raw.legacyEnemyMax!==null)throw Error('野外规则版本无效');const world=parseFieldWorld(raw.world);if(world.sessionId!==r.id||world.actors.length!==1||world.actors[0].id!=='solo'||world.actors[0].loadout.budget!==r.budget)throw Error('单人世界归属无效');const expected=structuredClone(r);expected.field=structuredClone(raw) as unknown as FieldRun;projectV2(expected);const canonical=(v:unknown)=>JSON.stringify(v,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,value[key]])):value);if(canonical(expected.field)!==canonical(raw)||expected.hp!==r.hp||expected.remaining!==r.remaining||expected.spent!==r.spent||expected.enemyHP!==r.enemyHP||expected.enemyMax!==r.enemyMax||expected.phase!==r.phase||expected.region!==r.region)throw Error('单人世界投影不一致');}
/** Renderer consumes a FieldView directly. Co-op supplies fieldView(hostSnapshot, localId). */
export function soloFieldView(p:Profile):FieldView|null{const w=p.run?.field?.world;return w?fieldView(w,'solo'):null;}
/** Readonly presentation for both saved rule versions, without manufacturing a Profile. */
export function profileFieldView(p:Profile):FieldView|null{if(!p.run?.field)return null;const current=soloFieldView(p);if(current)return current;const r=p.run,f=r.field!,loadout={gear:[] as string[],attack:6,defence:0,maxHP:p.upgraded?80:70,heal:0,spell:0,gather:0,travelPercent:100,pet:null,supply:null,budget:r.budget};const actor={id:'solo',loadout,floor:f.floor,x:f.x,hp:r.hp,shield:0,shieldUntil:0,mode:f.mode,target:f.target,farmTarget:f.farmTarget,online:true,remaining:r.remaining,spent:r.spent,eligible:f.active!==null,pending:null,nextAttack:r.nextAttack,attacks:0,miningDue:f.miningDue,oreReadyAt:f.floors.map(l=>l.oreReadyAt),mines:0,supplyUsed:false,recoverUntil:f.recoverUntil,safe:f.safe,moveRemainder:f.moveRemainder??0,returned:false};return {sessionId:r.id,localActorId:'solo',tick:p.tick,floor:f.floor,mode:f.mode,x:f.x,hp:r.hp,maxHP:loadout.maxHP,remaining:r.remaining,shield:0,target:f.target,miningDue:f.miningDue,recoverUntil:f.recoverUntil,active:f.active,loadout,actors:[actor],floors:f.floors.map((l,fi)=>({oreX:FIELD_FLOORS[fi].ore.x,revealed:l.revealed,encounters:l.encounters.map((g,ei)=>({...g,material:(['bone','curseCrystal','toughHide'] as const)[ei],participants:['solo'],scaled:true,cycle:0,monsters:g.monsters.map(m=>({...m,armorUntil:0,hits:0,immuneUntil:0,pattern:0,summons:0}))}))})),projectiles:[],events:[]};}

export function fieldViewWork(v:FieldView):boolean{const a=v.actors.find(a=>a.id===v.localActorId)!;if(a.returned||a.recoverUntil||a.pending)return false;if(v.active!==null)return true;if(!v.target)return v.mode==='push';const level=v.floors[v.floor];if(v.target.kind==='ore'&&Math.abs(v.x-level.oreX)<=24&&a.oreReadyAt[v.floor]>v.tick)return false;const e=encounterOf({floor:v.floor} as FieldRun,v.target);if(e!==null&&Math.abs(v.x-FIELD_FLOORS[v.floor].encounters[e].x)<=24&&level.encounters[e].cleared&&level.encounters[e].readyAt>v.tick)return false;return true;}
