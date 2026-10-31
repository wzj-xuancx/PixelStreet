import {spearCharge,traitRank} from './growth';
import type {DungeonRun,Point,WeaponItem,WeaponKind,WeaponForm} from './types';
import type {MeleeAction,MeleeKind,MeleeBranch} from './combat-state';
import {hurtShape} from './geometry';
export const CURRENT_WEAPON_KINDS=['sword','hammer','spear','dual','scythe','greatsword','fists','chain','fire','frost','lightning','boomerang'] as const;
export const MELEE_KINDS=CURRENT_WEAPON_KINDS.slice(0,8) as readonly MeleeKind[];
export const WEAPONS:Record<WeaponKind,{name:string;description:string;behavior:string;evolution:string}>={
 sword:{name:'短剑',description:'按住三连斩，末击较重；特殊短刺',behavior:'快速前方连斩',evolution:'基础形态上限Lv5'},
 hammer:{name:'重锤',description:'慢砸；按住特殊蓄力，松开冲击击退',behavior:'锤面落点与局部冲击',evolution:'基础形态上限Lv5'},
 spear:{name:'长枪',description:'窄直刺；按住特殊蓄力贯刺',behavior:'手动瞄准直线穿透',evolution:'Lv5 + 兼容机制 + 祭坛选择枪系分支'},
 dual:{name:'双刀',description:'交替短斩积连击；特殊消耗连击交叉斩',behavior:'双手交替与交叉斩',evolution:'Lv5 + 兼容机制 + 祭坛选择双刀分支'},
 scythe:{name:'战镰',description:'宽弧清群；特殊勾小怪到前方再扫',behavior:'长柄外缘挥扫与有限拉拽',evolution:'Lv5 + 兼容机制 + 祭坛选择镰系分支'},
 greatsword:{name:'巨剑',description:'宽横扫；按住特殊蓄力纵劈',behavior:'长刃横扫与前方纵劈',evolution:'基础形态上限Lv5'},
 fists:{name:'拳套',description:'短连拳积拳势；特殊重拳推位',behavior:'最短射程与拳势消耗',evolution:'基础形态上限Lv5'},
 chain:{name:'链刃',description:'特殊切换短刃与长链；链头去回分别命中',behavior:'近斩与长链回收',evolution:'基础双形态，进阶未命名'},
 fire:{name:'火杖',description:'直线火球命中后燃烧',behavior:'固定火球与燃烧',evolution:'Lv5 + 余烬爆破或灼烧地带 + 祭坛 → 流星'},
 frost:{name:'冰弓',description:'按住基础蓄力，松开穿透；三层霜冻结',behavior:'固定蓄力穿透箭',evolution:'基础形态上限Lv5'},
 lightning:{name:'雷杖',description:'朝瞄准方向首击，最多连锁三目标',behavior:'有界近距连锁',evolution:'基础形态上限Lv5'},
 boomerang:{name:'回旋刃',description:'固定方向飞出，再追随角色回收',behavior:'去程与回程各一次命中',evolution:'Lv5 + 双刃回响或折返弹射 + 祭坛 → 环刃'}
};
const formNames:Record<WeaponForm,string>={base:'',meteor:'流星','blade-ring':'环刃','piercing-lance':'贯刺枪',halberd:'旋刃战戟','phantom-blades':'残影双刃','blade-dance':'旋舞双刃','hook-scythe':'钩镰',reaper:'收割镰'};
export function weaponForm(item:WeaponItem):WeaponForm{return item.form;}
export function weaponName(item:WeaponItem):string{return item.form==='base'?WEAPONS[item.kind].name:formNames[item.form];}
export function isMelee(kind:WeaponKind):kind is MeleeKind{return MELEE_KINDS.includes(kind as MeleeKind);}
export function validWeaponForm(kind:WeaponKind,form:unknown,evolved:boolean,level:number):form is WeaponForm {return form==='base'?!evolved:level===5&&evolved&&((kind==='fire'&&form==='meteor')||(kind==='boomerang'&&form==='blade-ring')||(kind==='spear'&&(form==='piercing-lance'||form==='halberd'))||(kind==='dual'&&(form==='phantom-blades'||form==='blade-dance'))||(kind==='scythe'&&(form==='hook-scythe'||form==='reaper')));}
export interface MeleeTiming {windup:number;active:number;recover:number;cooldown:number}
export function meleeTiming(kind:MeleeKind,special=false,branch:MeleeBranch='base',mode:'blade'|'chain'='blade'):MeleeTiming {
 const basic:Record<MeleeKind,[number,number,number]>={sword:[70,110,140],hammer:[330,100,380],spear:[130,100,210],dual:[50,100,105],scythe:[220,210,270],greatsword:[260,180,350],fists:[45,70,90],chain:mode==='chain'?[190,400,250]:[70,100,150]};
 const alt:Record<MeleeKind,[number,number,number]>={sword:[65,100,220],hammer:[140,120,540],spear:[150,140,320],dual:[80,220,240],scythe:[160,310,310],greatsword:[150,150,500],fists:[90,90,260],chain:mode==='chain'?[100,230,290]:[80,260,240]};
 const [windup,active,recover]=special&&branch==='blade-dance'?[90,600,300]:special&&branch==='phantom-blades'?[80,320,270]:special&&branch==='reaper'?[200,260,420]:special?alt[kind]:basic[kind];return{windup,active,recover,cooldown:special?700:0};
}
export function meleeDamage(a:MeleeAction):number {if(a.special)return ({sword:30,hammer:44+36*a.charge,spear:32+28*a.charge,dual:18+a.strength*5,scythe:a.branch==='reaper'?40+a.strength*9:22,greatsword:48+34*a.charge,fists:30+a.strength*4,chain:25} as const)[a.kind];return({sword:a.comboStep===3?38:24,hammer:48,spear:29,dual:17,scythe:32,greatsword:42,fists:15,chain:a.mode==='chain'?24:22} as const)[a.kind];}
export function meleeCanCancel(a:MeleeAction,time:number):boolean {return (a.kind==='sword'||a.kind==='dual'||a.kind==='fists'||a.kind==='chain'&&a.mode==='blade')&&time>=a.recoverAt+(a.endsAt-a.recoverAt)*.45;}
export function meleeMovementScale(a:MeleeAction|null,time:number):number {if(!a)return 1;if(a.special&&a.branch==='blade-dance'&&time>=a.activeAt&&time<a.recoverAt)return .35;return a.kind==='hammer'||a.kind==='greatsword'?.65:1;}
export interface WeaponPosePart {id:string;kind:'weapon'|'fist'|'chain-link'|'chain-head'|'afterimage'|'energy'|'forearm';hand:Point;tip:Point;angle:number;width:number;alpha:number}
interface PrimitiveBase {damageFactor?:number;segment:number;heavy:boolean;pull:boolean}
export type WeaponAttackPrimitive=({kind:'segment';a:Point;b:Point;radius:number}|{kind:'circle';center:Point;radius:number})&PrimitiveBase;
export interface WeaponActionGeometry {weaponId:string;kind:WeaponKind;form:WeaponForm;stage:'idle'|'charge'|'windup'|'active'|'recover';origin:Point;direction:Point;charge:number;progress:number;parts:WeaponPosePart[];primitives:WeaponAttackPrimitive[]}
const clamp=(n:number,a=0,b=1)=>Math.max(a,Math.min(b,n));
const unit=(x:number,y:number)=>{const n=Math.hypot(x,y);return n?{x:x/n,y:y/n}:{x:1,y:0};};
const plus=(p:Point,a:number,d:number):Point=>({x:p.x+Math.cos(a)*d,y:p.y+Math.sin(a)*d});
/** Fixed tool lengths in world units; original image grip→tip mapping must not grow a tool for a finisher. */
export const WEAPON_PHYSICAL_LENGTHS:Readonly<Record<WeaponKind,number>>={sword:34,hammer:48,spear:64,dual:26,scythe:58,greatsword:68,fists:18,chain:30,fire:30,frost:34,lightning:30,boomerang:18};
/** The sole weapon trajectory source. Feet/time overrides are world-space interpolation, never camera coordinates. */
export function weaponActionGeometry(run:DungeonRun,options:{feet?:Point;time?:number}={}):WeaponActionGeometry|null {
 const w=run.player.weaponSlots[run.player.activeSlot];if(!w)return null;
 const feet=options.feet??run.player,time=options.time??run.elapsedMs,body=hurtShape(feet,'player',run.combat.profile).center,a=run.combat.action?.weaponId===w.id?run.combat.action:null,held=run.combat.special.held&&isMelee(w.kind),direction=a?a.direction:unit(run.player.aimX-body.x,run.player.aimY-body.y),angle=Math.atan2(direction.y,direction.x);
 const stage=a?(time<a.activeAt?'windup':time<a.recoverAt?'active':'recover'):held||w.kind==='frost'&&run.player.chargeStarted!==null?'charge':'idle';
 const p=a?clamp((time-a.activeAt)/(a.recoverAt-a.activeAt)):0,pre=a?clamp((time-a.startedAt)/(a.activeAt-a.startedAt||1)):0,post=a?clamp((time-a.recoverAt)/(a.endsAt-a.recoverAt||1)):0,charge=a?a.charge:spearCharge(run,time-(held?run.combat.special.startedAt!:run.player.chargeStarted??time));
 const view:WeaponActionGeometry={weaponId:w.id,kind:w.kind,form:w.form,stage,origin:body,direction:{...direction},charge,progress:p,parts:[],primitives:[]};
 const addPart=(id:string,hand:Point,tip:Point,kind:WeaponPosePart['kind']='weapon',width=5,alpha=1)=>view.parts.push({id,kind,hand,tip,angle:Math.atan2(tip.y-hand.y,tip.x-hand.x),width,alpha});
 const limb=(id:string,shoulder:Point,wrist:Point,alpha=.8)=>addPart(`arm-${id}`,shoulder,wrist,'forearm',2.5,alpha);
 const shoulder=plus(body,angle+Math.PI/2,14),grip=plus(shoulder,angle,6),length=WEAPON_PHYSICAL_LENGTHS[w.kind];
 const heavy=!!a&&(a.special&&['hammer','greatsword','fists'].includes(a.kind)||a.kind==='hammer'||a.kind==='greatsword'||a.kind==='sword'&&a.comboStep===3||a.special&&a.branch==='reaper');
 const seg=(from:Point,to:Point,radius:number,segment=0,pull=false)=>{if(stage==='active')view.primitives.push({kind:'segment',a:from,b:to,radius,segment,heavy,pull});};
 const circle=(center:Point,radius:number,segment=0)=>{if(stage==='active')view.primitives.push({kind:'circle',center,radius,segment,heavy,pull:false});};
 const swingAngle=(sweep:number,reverse=false)=>{const sign=reverse?-1:1;return angle+(stage==='active'?sign*(p-.5)*sweep:stage==='windup'?.25+(-sign*sweep*.5-.25)*pre:stage==='recover'?sign*sweep*.5*(1-post)+.25*post:stage==='charge'?-.6:.25);};
 const generic=(sweep:number,extension:number,reverse=false)=>{const theta=swingAngle(sweep,reverse),stretch=stage==='active'?extension:stage==='windup'?extension*pre:stage==='recover'?extension*(1-post):0,wrist=plus(grip,theta,stretch),tip=plus(wrist,theta,length);limb('main',shoulder,wrist);addPart('main',wrist,tip);seg(plus(wrist,theta,4),tip,5);};
 if(!isMelee(w.kind)){const theta=angle+(stage==='charge'?-.25*charge:.25),tip=plus(grip,theta,length);limb('main',shoulder,grip);addPart('main',grip,tip);return view;}
 const kind=w.kind,mode=a?.mode??run.combat.chainMode,special=a?.special??false,branch=a?.branch??(w.form as MeleeBranch),step=a?.comboStep??run.combat.combo.step;
 if(kind==='hammer'){
  const wrist=stage==='windup'?plus(shoulder,angle,6*pre):stage==='charge'?shoulder:grip,theta=angle+(stage==='windup'?-1.3*(1-pre):stage==='charge'?-1.2-.25*charge:stage==='recover'?.25*post:stage==='idle'?.25:0),tip=plus(wrist,theta,length);
  limb('main',shoulder,wrist);addPart('main',wrist,tip,'weapon',12);circle(tip,special?42+charge*22:14);
 } else if(kind==='spear'&&!(branch==='halberd'&&(special||step===3))||kind==='greatsword'&&special||kind==='sword'&&special){
  const extension=stage==='active'?Math.sin(Math.PI*p):stage==='windup'?-.25*(1-pre):stage==='charge'?-.25:stage==='recover'?(1-post)*.2:0,theta=angle+(kind==='greatsword'?(stage==='windup'?-1.4*(1-pre):stage==='charge'?-1.4:stage==='recover'?.25*post:stage==='idle'?.25:0):stage==='idle'?.25:0),wrist=plus(grip,angle,extension*16),tip=plus(wrist,theta,length);
  limb('main',shoulder,wrist);addPart('main',wrist,tip,'weapon',kind==='greatsword'?14:5);seg(kind==='spear'?plus(tip,theta,-20):plus(wrist,theta,4),tip,kind==='greatsword'?12+charge*6:kind==='sword'?6:5);
  if(kind==='spear'&&special){const distance=branch==='piercing-lance'?180+charge*65:130+charge*40,energyTip=plus(grip,angle,distance*Math.max(0,extension));if(Math.hypot(energyTip.x-grip.x,energyTip.y-grip.y)>Math.hypot(tip.x-grip.x,tip.y-grip.y)){addPart('pierce',tip,energyTip,'energy',5,.7);seg(tip,energyTip,5);}}
 } else if(kind==='dual'||kind==='fists'){
  const dance=special&&branch==='blade-dance',phantom=special&&branch==='phantom-blades',n=dance?Math.min(2,Math.floor(p*3)):special&&kind==='dual'?Math.min(1,Math.floor(p*2)):0;
  for(const side of [-1,1]){
   const id=side<0?'off':'main',sleeve=plus(body,angle+Math.PI/2,side*10),activeSide=special||side===(step%2?1:-1),striking=!(phantom&&p>=.5)&&activeSide&&(!special||kind==='fists'||dance||side===(n===0?-1:1)),q=special&&kind==='dual'&&!dance?(p*2)%1:p,theta=angle+(dance?p*Math.PI*2.4+side*.4:kind==='fists'?side*.1:side*(striking&&stage==='active'?.65-q*1.3:stage==='windup'?.9:stage==='charge'?1:.45)),extension=striking&&stage==='active'?(kind==='fists'?(special?22:16)*Math.sin(Math.PI*p):12):stage==='windup'?2+8*pre:stage==='recover'?2+10*(1-post):2,wrist=plus(sleeve,theta,extension),tip=plus(wrist,theta,length);
   limb(id,sleeve,wrist);addPart(id,wrist,tip,kind==='fists'?'fist':'weapon',kind==='fists'?9:4);if(striking)seg(kind==='fists'?plus(tip,theta,-8):plus(wrist,theta,3),tip,kind==='fists'?8:4,n);
  }
  if(phantom&&p>=.5){view.primitives=[];const theta=angle+(.5-(p-.5)*2)*1.5,sleeve=plus(a!.origin,angle+Math.PI/2,-10),wrist=plus(sleeve,theta,16),tip=plus(wrist,theta,length);limb('echo',sleeve,wrist,.3);addPart('echo',wrist,tip,'afterimage',4,.45);seg(plus(wrist,theta,3),tip,4,1);}
 } else if(kind==='scythe'&&special&&branch!=='reaper'){
  const hook=p<.48,q=hook?p/.48:(p-.48)/.52,theta=angle+(stage==='active'?(hook?0:-1.4+q*2.8):stage==='windup'?-.5*(1-pre):stage==='recover'?.25*post:stage==='idle'?.25:-.6),extension=stage==='active'?(hook?16*(1-q):8):stage==='windup'?8*pre:stage==='recover'?8*(1-post):0,wrist=plus(grip,theta,extension),tip=plus(wrist,theta,length);
  limb('main',shoulder,wrist);addPart('main',wrist,tip,'weapon',6);seg(plus(tip,theta+Math.PI/2,-20),plus(tip,theta+Math.PI/2,24),7,hook?0:1,hook);
 } else if(kind==='scythe'){
  const theta=swingAngle(special?3.8:2.8),extension=stage==='active'?(special?16:10):stage==='windup'?10*pre:stage==='recover'?10*(1-post):0,wrist=plus(grip,theta,extension),tip=plus(wrist,theta,length);
  limb('main',shoulder,wrist);addPart('main',wrist,tip,'weapon',6);seg(plus(tip,theta,-18),plus(tip,theta+Math.PI/2,24),7);
 } else if(kind==='chain'&&mode==='chain'){
  const segment=special?0:p<.5?0:1,extension=stage==='active'?(special?.2+.8*p:.25+.75*Math.sin(Math.PI*p)):stage==='windup'?.25:stage==='recover'?.25*(1-post):stage==='charge'?.3:.32,theta=angle+(special?(p-.5)*1.4:0),tip=plus(grip,theta,145*extension);
  limb('main',shoulder,grip);for(let i=0,n=Math.max(1,Math.ceil(Math.hypot(tip.x-grip.x,tip.y-grip.y)/12));i<n;i++)addPart('link-'+i,{x:grip.x+(tip.x-grip.x)*i/n,y:grip.y+(tip.y-grip.y)*i/n},{x:grip.x+(tip.x-grip.x)*(i+1)/n,y:grip.y+(tip.y-grip.y)*(i+1)/n},'chain-link',3);
  addPart('head',plus(tip,theta,-14),tip,'chain-head',8);seg(plus(tip,theta,-14),tip,8,segment);
 } else if(kind==='chain'&&special){
  const q=p<.5?p*2:(p-.5)*2,theta=angle+(p<.5?0:(q-.5)*1.8),reach=p<.5?135-95*q:40,tip=plus(grip,theta,reach),wrist=plus(tip,theta,-length);addPart('main',wrist,tip);
  if(p<.5){limb('main',shoulder,grip);for(let i=0,n=Math.max(1,Math.ceil((reach-length)/12));i<n;i++)addPart('link-'+i,plus(grip,theta,(reach-length)*i/n),plus(grip,theta,(reach-length)*(i+1)/n),'chain-link',3);}else limb('main',shoulder,wrist);
  seg(plus(tip,theta,-18),tip,6,p<.5?0:1);
 } else generic(kind==='greatsword'?2.6:kind==='spear'?special?3.5:2.4:kind==='chain'?1.6:step===3?2.7:2.0,kind==='greatsword'||kind==='spear'?10:kind==='chain'?8:12,kind==='sword'&&step===2);
 if(kind==='spear'&&special&&traitRank(run,'spear-sweep')&&stage==='active'){
  const theta=angle+(p-.5)*2.2,wrist=plus(grip,theta,12),tip=plus(wrist,theta,length);addPart('mechanism-sweep',plus(tip,theta,-20),tip,'energy',5,.65);
  view.primitives.push({kind:'segment',a:plus(tip,theta,-20),b:tip,radius:5,segment:2,heavy:false,pull:false,damageFactor:traitRank(run,'spear-sweep')===2?.6:.45});
 }
 return view;
}

export interface WeaponSpecialInfo {available:boolean;ready:boolean;reason:string;held:boolean;charge:number;readyIn:number;current:number;required:number}
/** Resources gate preparation; ordinary recovery/cooldown permits a held intent but never a free cancellation. */
export function weaponSpecialInfo(run:DungeonRun):WeaponSpecialInfo {
 const w=run.player.weaponSlots[run.player.activeSlot],c=run.combat,required=w?.form==='reaper'?1:w?.form==='blade-dance'||w?.form==='phantom-blades'?3:0,current=w?.form==='reaper'&&c.reaper.weaponId===w.id?c.reaper.marks:w?.kind==='dual'?c.combo.expiresAt>=run.elapsedMs?c.combo.step:0:w?.kind==='fists'?c.momentum.expiresAt>=run.elapsedMs?c.momentum.value:0:0,readyIn=Math.max(0,run.player.attackReady-run.elapsedMs,c.special.readyAt-run.elapsedMs,(c.action?.endsAt??0)-run.elapsedMs),available=!!w&&isMelee(w.kind)&&run.phase==='exploring'&&!run.paused&&current>=required,ready=available&&readyIn===0&&!c.action;
 const reason=!w?'空手':!isMelee(w.kind)?'震荡技能':run.phase!=='exploring'||run.paused?'暂停中':current<required?w.form==='reaper'?'需要收割印记':'需要3连击':c.action?'等待完整收招':readyIn>0?'特殊冷却中':c.special.held?'松开释放':'按住准备，松开释放';return{available,ready,reason,held:c.special.held,charge:c.special.startedAt===null?0:spearCharge(run,run.elapsedMs-c.special.startedAt),readyIn,current,required};
}
