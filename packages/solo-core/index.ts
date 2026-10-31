import {partyBusy,partyRationReserve,validatePartyLedger,type PartyLedger,type PartySummary} from './party-ledger';
export * from './party-ledger';
import {parseFieldMaterialSaleAction,applyFieldMaterialSale,type FieldMaterialSaleAction,parseFieldChallengeAction,applyFieldChallenge,type FieldChallengeAction,changeFieldMaterial,ensureFieldProgress,validateFieldProgress,type FieldProgress} from './field-progress';
export * from './field-progress';
export const PROFILE_MAX_BYTES=512*1024;
import {parseFieldAction,applyField,stepField,validateFieldRun,type FieldRun,type FieldAction,type FieldHooks} from './field-adventure';
export * from './field-adventure';
import {parseChapterAction,applyChapter,validateChapter,recordChapterWear,recordChapterDepart,recordChapterWin,recordChapterReturn,type Chapter,type ChapterAction} from './chapter';
export * from './chapter';
import {pendingFeedback,type GameplayObserver,type FeedbackFeed} from './gameplay-feedback';
export * from './gameplay-feedback';
import {parseMasteryAction,applyMastery,validateMastery,recordMasteryCombo,recordMasteryWin,clearMasteryRun,type Mastery,type MasteryAction} from './mastery';
export * from './mastery';
import {parsePetAction,applyPets,validatePets,clearPets,activePetEffects,type Pets,type PetAction} from './pets';
export * from './pets';
import {parseEquipmentAction,applyEquipment,validateEquipment,captureEquipment,clearEquipment,activeEquipmentEffects,equipmentTravel,type Equipment,type EquipmentAction} from './equipment';
export * from './equipment';
import {parseTowerAction,applyTower,validateTower,observeTower,type Tower,type TowerAction} from './tower';
export * from './tower';
import {parseVillageAction,applyVillage,validateVillage,stepVillage,type Village,type VillageAction} from './village';
export * from './village';
// The worker owns this state. Renderers send intents, never balances, clocks or rewards.
import {parseCampAction,applyCamp,validateCamp,stepCamp,rememberProduction,type CampLife,type CampAction} from './camp-life';
export * from './camp-life';
import {recipes,type Recipe} from './catalog';
import {initialBusiness,validateBusiness,parseBusinessAction,applyBusiness,stepBusiness,craftTicks,pendingOutput,PRICE_TIERS,type Business,type BusinessAction} from './business';
import {initialLeisure,migrateLeisureV6,validateLeisure,parseLeisureAction,applyLeisure,stepLeisure,type Leisure,type LeisureAction} from './leisure';
import {parseExpeditionAction,applyExpedition,validateExpedition,recordExpeditionWin,hasRoomForExpeditionWin,finishExpedition,expeditionGelBonus,expeditionGoldBonus,expeditionAttackBonus,expeditionDefence,expeditionHealing,expeditionSpell,expeditionCooldown,expeditionNextTravel,type Expedition,type ExpeditionAction} from './expedition';
import {reagentSpace,refundReserve,parseAtelierAction,applyAtelier,validateAtelier,stepAtelier,type Atelier,type AtelierAction} from './atelier';
export * from './atelier';
export * from './expedition';
export * from './catalog';
export * from './business';
export * from './leisure';
export type Job = 'visitor' | 'apprentice' | 'keeper';
export interface IdleRun {field?:FieldRun;id:string;wave:number;region:number;budget:number;remaining:number;spent:number;loot:number;defeated:number[];phase:'travel'|'fight'|'recover';due:number;hp:number;enemyHP:number;enemyMax:number;nextAttack:number;enemyAttack:number;frostReady:number;shatterReady:number;markedUntil:number;auto:boolean;log:string}
export const regions=[{name:'萤石荒径',hp:24,attack:3,interval:20},{name:'裂晶洞口',hp:50,attack:6,interval:16},{name:'遗迹深廊',hp:100,attack:14,interval:16}] as const;
export type GameAction = FieldMaterialSaleAction | FieldChallengeAction | FieldAction | ChapterAction | MasteryAction | PetAction | EquipmentAction | TowerAction | VillageAction | CampAction | AtelierAction | ExpeditionAction | LeisureAction | BusinessAction | {type:'start-run';region:number;budget:number;auto:boolean}|{type:'retreat'}|{type:'auto-skills';enabled:boolean}|{type:'skill';skill:'frost'|'shatter';runId:string;wave:number} | {type:'apply-job'|'deliver-trial'|'buy-flour'|'upgrade'} | {type:'craft';recipe:Recipe;count:1|3} | {type:'retail';enabled:boolean};
export interface GameEnvelope {sequence:number;requestId:string;action:GameAction}
export interface Profile {
  version:8; party?:PartyLedger; fieldProgress?:FieldProgress; chapter?:Chapter; mastery?:Mastery; pets?:Pets; equipment?:Equipment; tower?:Tower; village?:Village; camp?:CampLife; atelier?:Atelier; expedition?:Expedition; business:Business; leisure:Leisure; tick:number; wallAt:number; carryMs:number; sequence:number;
  receipt:{sequence:number;requestId:string;fingerprint:string}|null;
  job:Job; coins:number; xp:number; actionClaim:number; bag:{flour:number;ration:number;crystal:number;gel:number};
  roomClaims:Array<{hostId:string;sequence:number}>;
  rewardRemainders:{coins:number;xp:number;gel:number};
  queue:{recipe:Recipe;remaining:number;due:number}|null;
  retail:boolean; nextSale:number; upgraded:boolean;
  totals:{crafted:number;sold:number;earned:number;wins:number};
  cleared:number[]; run:IdleRun|null; rng:number; lastTrip:string; notice:string;
}
export type PublicProfile=Omit<Profile,'party'>;
export type PrivateGameState=Omit<GameState,'profile'>&{profile:Profile|null};
export interface GameState {status:'ready'|'blocked'|'loading';profile:PublicProfile|null;partySize:number;error:string;warnings:string[];feedback?:FeedbackFeed;party?:PartySummary}
export const initialProfile=(now:number):Profile=>({version:8,business:initialBusiness((now>>>0)||1),leisure:initialLeisure(),tick:0,wallAt:now,carryMs:0,sequence:0,receipt:null,job:'visitor',coins:20,xp:0,actionClaim:0,roomClaims:[],rewardRemainders:{coins:0,xp:0,gel:0},bag:{flour:0,ration:0,crystal:0,gel:0},queue:null,retail:false,nextSale:0,upgraded:false,totals:{crafted:0,sold:0,earned:0,wins:0},cleared:[],run:null,rng:(now>>>0)||1,lastTrip:'尚未远征。',notice:'点击补给店内的店员，开始任职。'});
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
function shape(v:unknown,keys:string):asserts v is Record<string,unknown>{if(!record(v)||Object.keys(v).sort().join(',')!==keys.split(' ').sort().join(','))throw Error('存档或指令字段不匹配');}
function integer(v:unknown,max=1e9,min=0):asserts v is number {if(typeof v!=='number'||!Number.isSafeInteger(v)||v<min||v>max)throw Error('数值超出范围');}
export function parseAction(raw:unknown):GameAction{
  if(!record(raw))throw Error('玩法操作无效');
  const materialSale=parseFieldMaterialSaleAction(raw);if(materialSale)return materialSale;
  const challenge=parseFieldChallengeAction(raw);if(challenge)return challenge;
  const field=parseFieldAction(raw);if(field)return field;
  const chapter=parseChapterAction(raw);if(chapter)return chapter;
  const mastery=parseMasteryAction(raw);if(mastery)return mastery;
  const pet=parsePetAction(raw);if(pet)return pet;
  const equipment=parseEquipmentAction(raw);if(equipment)return equipment;
  const tower=parseTowerAction(raw);if(tower)return tower;
  const village=parseVillageAction(raw);if(village)return village;
  const camp=parseCampAction(raw);if(camp)return camp;
  const atelier=parseAtelierAction(raw);if(atelier)return atelier;
  const expedition=parseExpeditionAction(raw);if(expedition)return expedition;
  const leisure=parseLeisureAction(raw);if(leisure)return leisure;
  const business=parseBusinessAction(raw);if(business)return business;
  if(['apply-job','deliver-trial','buy-flour','upgrade'].includes(typeof raw.type==='string'?raw.type:'')){shape(raw,'type');return raw as GameAction;}
  if(raw.type==='start-run'){shape(raw,'type region budget auto');integer(raw.region,2);integer(raw.budget,9,1);if(typeof raw.auto!=='boolean')throw Error('技能模式无效');return {type:'start-run',region:raw.region,budget:raw.budget,auto:raw.auto};}
  if(raw.type==='retreat'){shape(raw,'type');return {type:'retreat'};}
  if(raw.type==='auto-skills'){shape(raw,'type enabled');if(typeof raw.enabled!=='boolean')throw Error('技能模式无效');return {type:'auto-skills',enabled:raw.enabled};}
  if(raw.type==='skill'){shape(raw,'type skill runId wave');integer(raw.wave,1e12,1);if(typeof raw.runId!=='string'||!/^run-[0-9]+$/.test(raw.runId)||!['frost','shatter'].includes(typeof raw.skill==='string'?raw.skill:''))throw Error('技能目标无效');return {type:'skill',skill:raw.skill as 'frost'|'shatter',runId:raw.runId,wave:raw.wave};}
  if(raw.type==='craft'){shape(raw,'type recipe count');if(!['ration','crystal'].includes(typeof raw.recipe==='string'?raw.recipe:'')||![1,3].includes(Number(raw.count))||typeof raw.count!=='number')throw Error('配方或份数无效');return {type:'craft',recipe:raw.recipe as Recipe,count:raw.count as 1|3};}
  if(raw.type==='retail'){shape(raw,'type enabled');if(typeof raw.enabled!=='boolean')throw Error('售卖开关无效');return {type:'retail',enabled:raw.enabled};}
  throw Error('未知玩法操作');
}
export function parseEnvelope(raw:unknown):GameEnvelope{shape(raw,'sequence requestId action');integer(raw.sequence,1e12,1);if(typeof raw.requestId!=='string'||!/^[-a-zA-Z0-9]{8,64}$/.test(raw.requestId))throw Error('请求标识无效');return {sequence:raw.sequence,requestId:raw.requestId,action:parseAction(raw.action)};}
export function parseProfile(raw:unknown):Profile{
  const legacyKeys='version tick wallAt carryMs sequence receipt job coins bag queue retail nextSale upgraded totals cleared run rng lastTrip notice';
  const v2Keys=legacyKeys+' xp actionClaim';
  const v3Keys=v2Keys+' roomClaims';
  const emptyRemainders={coins:0,xp:0,gel:0};
  if(record(raw)&&raw.version===1){shape(raw,legacyKeys);return parseProfile({...raw,version:4,xp:0,actionClaim:0,roomClaims:[],rewardRemainders:emptyRemainders});}
  if(record(raw)&&raw.version===2){shape(raw,v2Keys);return parseProfile({...raw,version:4,roomClaims:[],rewardRemainders:emptyRemainders});}
  if(record(raw)&&raw.version===3){shape(raw,v3Keys);return parseProfile({...raw,version:4,rewardRemainders:emptyRemainders});}
  if(record(raw)&&raw.version===4){shape(raw,v3Keys+' rewardRemainders');integer(raw.rng,0xffffffff,1);return parseProfile({...raw,version:5,business:initialBusiness(raw.rng)});}
  if(record(raw)&&raw.version===5){shape(raw,v3Keys+' rewardRemainders business');return parseProfile({...raw,version:7,leisure:initialLeisure()});}
  if(record(raw)&&raw.version===6){shape(raw,v3Keys+' rewardRemainders business leisure');return parseProfile({...raw,version:7,leisure:migrateLeisureV6(raw.leisure,Number(raw.tick))});}
  if(record(raw)&&raw.version===7){
    // Only compatibility keys are supplied. Existing values and in-flight tasks are validated intact.
    let atelier=raw.atelier;
    if(Object.hasOwn(raw,'fieldProgress')||Object.hasOwn(raw,'party'))throw Error('旧版存档含新扩展');
    if(atelier!==undefined){
      if(!record(atelier))throw Error('工坊字段不匹配');
      const maps:Record<string,unknown>={};
      const oldGoods='picnic stew gift dew ink ingot nectar incense frost';
      for(const key of ['stock','shelves','made','claimed']){shape(atelier[key],oldGoods);maps[key]={...atelier[key],...Object.fromEntries(['herbal-bandage','mining-tonic'].map(g=>[g,key==='shelves'?{stock:0,quote:'normal',due:0}:0]))};}
      atelier={...atelier,...maps};
    }
    return parseProfile({...raw,version:8,...(atelier===undefined?{}:{atelier})});
  }
  shape(raw,v3Keys+' rewardRemainders business leisure'+(record(raw)&&Object.hasOwn(raw,'expedition')?' expedition':'')+(record(raw)&&Object.hasOwn(raw,'atelier')?' atelier':'')+(record(raw)&&Object.hasOwn(raw,'camp')?' camp':'')+(record(raw)&&Object.hasOwn(raw,'village')?' village':'')+(record(raw)&&Object.hasOwn(raw,'tower')?' tower':'')+(record(raw)&&Object.hasOwn(raw,'equipment')?' equipment':'')+(record(raw)&&Object.hasOwn(raw,'pets')?' pets':'')+(record(raw)&&Object.hasOwn(raw,'mastery')?' mastery':'')+(record(raw)&&Object.hasOwn(raw,'chapter')?' chapter':'')+(record(raw)&&Object.hasOwn(raw,'fieldProgress')?' fieldProgress':'')+(record(raw)&&Object.hasOwn(raw,'party')?' party':''));
  if(raw.version!==8||!['visitor','apprentice','keeper'].includes(typeof raw.job==='string'?raw.job:''))throw Error('不支持的存档版本/职业');
  if(Object.hasOwn(raw,'expedition'))validateExpedition(raw.expedition,raw as unknown as Profile);
  validateBusiness(raw.business,(raw.expedition as Expedition|undefined)?.orders.reduce((sum,n)=>sum+n,0)??0);
  for(const k of ['tick','wallAt','sequence','nextSale'])integer(raw[k],1e15);integer(raw.carryMs,99);integer(raw.coins,1e9);
  integer(raw.xp,1e12);integer(raw.actionClaim,1e12);
  if(!Array.isArray(raw.roomClaims)||raw.roomClaims.length>256)throw Error('远征奖励记录无效');
  const claimedHosts=new Set<string>();
  for(const claim of raw.roomClaims){
    shape(claim,'hostId sequence');
    if(typeof claim.hostId!=='string'||!/^[0-9a-f]{32}$/.test(claim.hostId)||claimedHosts.has(claim.hostId))throw Error('远征奖励房主标识无效');
    integer(claim.sequence,1e12,1);claimedHosts.add(claim.hostId);
  }
  shape(raw.rewardRemainders,'coins xp gel');for(const value of Object.values(raw.rewardRemainders))integer(value,99);
  shape(raw.bag,'flour ration crystal gel');for(const v of Object.values(raw.bag))integer(v,1e6);
  shape(raw.totals,'crafted sold earned wins');for(const v of Object.values(raw.totals))integer(v,1e12);
  if(typeof raw.retail!=='boolean'||typeof raw.upgraded!=='boolean'||!Array.isArray(raw.cleared)||raw.cleared.length>3||raw.cleared.some((v,i)=>v!==i))throw Error('存档状态无效');
  validateLeisure(raw.leisure,Number(raw.tick));
  integer(raw.rng,0xffffffff,1);if(typeof raw.lastTrip!=='string'||raw.lastTrip.length>240)throw Error('远征记录无效');
  if(raw.run!==null)validateRun(raw.run,raw);
  if(typeof raw.notice!=='string'||raw.notice.length>240)throw Error('提示内容无效');
  if(raw.queue!==null){shape(raw.queue,'recipe remaining due');if(!['ration','crystal'].includes(typeof raw.queue.recipe==='string'?raw.queue.recipe:''))throw Error('配方无效');integer(raw.queue.remaining,99,1);integer(raw.queue.due,1e15);if(raw.queue.due<=Number(raw.tick))throw Error('队列游标无效');}
  const profile=raw as unknown as Profile;
  if(Object.hasOwn(raw,'party'))validatePartyLedger(raw.party,profile);
  if(Object.hasOwn(raw,'fieldProgress'))validateFieldProgress(raw.fieldProgress);
  if(Object.hasOwn(raw,'atelier'))validateAtelier(raw.atelier,profile);
  if(Object.hasOwn(raw,'camp'))validateCamp(raw.camp,profile);
  if(Object.hasOwn(raw,'village'))validateVillage(raw.village,profile);
  if(Object.hasOwn(raw,'tower'))validateTower(raw.tower);
  if(Object.hasOwn(raw,'equipment'))validateEquipment(raw.equipment,profile);
  if(Object.hasOwn(raw,'pets'))validatePets(raw.pets,profile);
  if(Object.hasOwn(raw,'mastery'))validateMastery(raw.mastery,profile);if(profile.fieldProgress?.challenge.equipped&&profile.mastery?.worn)throw Error('头像同时只能佩戴一枚徽记');
  if(Object.hasOwn(raw,'chapter'))validateChapter(raw.chapter,profile);
  if(!raw.queue&&profile.business.pending.length)throw Error('排产缺少当前批次');
  for(const recipe of ['ration','crystal'] as const)if(profile.bag[recipe]+pendingOutput(profile,recipe)+profile.business.shelves[recipe].stock+(recipe==='ration'?(profile.run?.remaining??0)+partyRationReserve(profile):0)>1e6)throw Error('成品预留库存超限');
  if(raw.receipt!==null){shape(raw.receipt,'sequence requestId fingerprint');integer(raw.receipt.sequence,1e12,1);if(raw.receipt.sequence!==raw.sequence||typeof raw.receipt.requestId!=='string'||!/^[-a-zA-Z0-9]{8,64}$/.test(raw.receipt.requestId)||typeof raw.receipt.fingerprint!=='string'||raw.receipt.fingerprint.length>256)throw Error('指令游标无效');}
  if((raw.sequence===0)!==(raw.receipt===null))throw Error('存档序号不一致');
  return structuredClone(raw) as unknown as Profile;
}
// Private main/worker settlement only. This is intentionally absent from GameAction / renderer IPC.
// Monotonic local claim cursors make retries safe even after the action receipt file was not saved.
export interface RemoteActionReward {hostId:string;sequence:number}
export function grantActionReward(source:Profile,claim:number,coins:number,xp:number,remote?:RemoteActionReward):Profile {
  integer(claim,1e12,1);integer(coins,10000);integer(xp,100000);
  const p=parseProfile(source);
  if(remote!==undefined){
    shape(remote,'hostId sequence');
    if(typeof remote.hostId!=='string'||!/^[0-9a-f]{32}$/.test(remote.hostId))throw Error('远征奖励房主标识无效');
    integer(remote.sequence,1e12,1);
  }
  if(remote===undefined&&claim<=p.actionClaim)return p;
  const previous=remote&&p.roomClaims.find(item=>item.hostId===remote.hostId);
  const freshRemote=!!remote&&(!previous||remote.sequence>previous.sequence);
  if(remote&&!previous&&p.roomClaims.length>=256)throw Error('远征奖励记录已满，奖励保留待领取。');
  const shouldReward=claim>p.actionClaim&&(remote===undefined||freshRemote);
  if(shouldReward&&(p.coins+coins>1e9||p.xp+xp>1e12))throw Error('营地金币或经验已满，奖励保留待领取。');
  if(remote&&freshRemote){if(previous)previous.sequence=remote.sequence;else p.roomClaims.push({hostId:remote.hostId,sequence:remote.sequence});}
  if(claim>p.actionClaim)p.actionClaim=claim;
  if(shouldReward){p.coins+=coins;p.xp+=xp;p.totals.earned=Math.min(1e12,p.totals.earned+coins);p.notice=`主动冒险结算：${coins}金币，${xp}经验。`;}
  observeTower(p);return parseProfile(p);
}
function validateRun(raw:unknown,p:Record<string,unknown>):void{
 shape(raw,'id wave region budget remaining spent loot defeated phase due hp enemyHP enemyMax nextAttack enemyAttack frostReady shatterReady markedUntil auto log'+(record(raw)&&Object.hasOwn(raw,'field')?' field':''));
 if(typeof raw.id!=='string'||!/^run-[0-9]+$/.test(raw.id)||!['travel','fight','recover'].includes(typeof raw.phase==='string'?raw.phase:'')||typeof raw.auto!=='boolean'||typeof raw.log!=='string'||raw.log.length>240)throw Error('远征状态无效');
 for(const k of ['wave','due','nextAttack','enemyAttack','frostReady','shatterReady','markedUntil'])integer(raw[k],1e15);
 integer(raw.region,2);integer(raw.budget,9,1);integer(raw.remaining,9);integer(raw.spent,9);integer(raw.loot,100);integer(raw.hp,p.upgraded?80:70);const enemyCap=record(raw.field)&&raw.field.version===2?1000:100;integer(raw.enemyHP,enemyCap);integer(raw.enemyMax,enemyCap);
 if(Number(raw.remaining)+Number(raw.spent)!==raw.budget||!Array.isArray(raw.defeated)||raw.defeated.length>3||new Set(raw.defeated).size!==raw.defeated.length||raw.defeated.some(v=>!Number.isInteger(v)||v<0||v>2)||p.job!=='keeper')throw Error('远征预算/职业无效');
 if(raw.phase==='fight'&&(raw.wave===0||Number(raw.hp)<=0||Number(raw.enemyHP)<=0||Number(raw.enemyHP)>Number(raw.enemyMax)))throw Error('战斗生命游标无效');
 if(Number(raw.region)>0&&!(p.cleared as number[]).includes(Number(raw.region)-1))throw Error('区域未解锁');
 if(Object.hasOwn(raw,'field'))validateFieldRun(raw.field,raw as unknown as IdleRun);
 const bag=p.bag as Record<string,number>;if(bag.gel+Number(raw.loot)>100||bag.ration+Number(raw.remaining)>1e6)throw Error('远征预留库存超限');
}
function finishRun(p:Profile,reason:string,observe?:GameplayObserver):void{const r=p.run;if(!r)return;const actor=r.field?.version===2?r.field.world?.actors[0]:null;if(actor?.loadout.supply&&!actor.supplyUsed)p.atelier!.stock[actor.loadout.supply]++;recordChapterReturn(p);observe?.({tick:p.tick,runId:r.id,wave:r.wave,kind:'return',amount:r.loot});clearMasteryRun(p);finishExpedition(p,reason);p.bag.gel+=r.loot;p.bag.ration+=r.remaining;p.lastTrip=reason+' · 带回'+r.loot+'凝胶，退还'+r.remaining+'口粮。';p.notice=p.lastTrip;p.run=null;clearEquipment(p);clearPets(p);}
const COINS_CAP=1e9,XP_CAP=1e12;
function partyReward(base:number,remainder:number,partySize:number):{amount:number;remainder:number}{const hundredths=base*(100+5*(partySize-1))+remainder;return {amount:Math.floor(hundredths/100),remainder:hundredths%100};}
export function hasRoomForNextGelDrop(p:Profile,partySize:number,loot=0):boolean{return 100-p.bag.gel-loot>=partyReward(2+expeditionGelBonus(p),p.rewardRemainders.gel,partySize).amount;}
function canPayNextWin(p:Profile,partySize:number):boolean{const level=p.run!.region+1,coins=partyReward(4*level+expeditionGoldBonus(p),p.rewardRemainders.coins,partySize).amount,xp=partyReward(6*level,p.rewardRemainders.xp,partySize).amount;return p.coins<=COINS_CAP-coins&&p.xp<=XP_CAP-xp;}
function win(p:Profile,partySize:number,observe?:GameplayObserver):void{
 const r=p.run!;if(!hasRoomForExpeditionWin(p,partySize)){r.remaining++;r.spent--;finishRun(p,'远征物资箱空间不足，本场未计奖励并退还口粮',observe);return;}const coinReward=partyReward(4*(r.region+1)+expeditionGoldBonus(p),p.rewardRemainders.coins,partySize),xpReward=partyReward(6*(r.region+1),p.rewardRemainders.xp,partySize),coins=coinReward.amount,xp=xpReward.amount;
 if(p.coins>COINS_CAP-coins||p.xp>XP_CAP-xp){r.remaining++;r.spent--;finishRun(p,'金币或经验已满，安全回营并退还本场口粮',observe);return;}
 let nextRng=p.rng|0;nextRng^=nextRng<<13;nextRng^=nextRng>>>17;nextRng^=nextRng<<5;nextRng>>>=0;
 const gelReward=partyReward(1+(nextRng%2)+expeditionGelBonus(p),p.rewardRemainders.gel,partySize);
 if(p.bag.gel+r.loot+gelReward.amount>100){r.remaining++;r.spent--;finishRun(p,'凝胶背包已满，本场未计奖励并退还口粮',observe);return;}
 p.rewardRemainders.coins=coinReward.remainder;p.rewardRemainders.xp=xpReward.remainder;p.rewardRemainders.gel=gelReward.remainder;
 p.coins+=coins;p.xp+=xp;p.totals.earned=Math.min(1e12,p.totals.earned+coins);
 p.rng=nextRng;p.totals.wins++;recordChapterWin(p);observe?.({tick:p.tick,runId:r.id,wave:r.wave,kind:'win',amount:coins});recordMasteryWin(p);recordExpeditionWin(p,coins,xp,gelReward.amount,partySize);r.loot+=gelReward.amount;if(!p.cleared.includes(r.region)){p.cleared.push(r.region);p.cleared.sort();}r.enemyHP=0;r.phase='travel';r.due=p.tick+expeditionNextTravel(p);r.log=`击退魔物，获得${coins}金币、${xp}经验与${gelReward.amount}凝胶，奖励余数已保留。`;
 if(!hasRoomForNextGelDrop(p,partySize,r.loot))finishRun(p,'凝胶背包空间不足以安全开始下一场，已安全回营',observe);else if(r.remaining===0)finishRun(p,'补给耗尽，已安全回营',observe);else if(p.coins===COINS_CAP||p.xp===XP_CAP)finishRun(p,'金币或经验已满，已安全回营',observe);
}
function lose(p:Profile,observe?:GameplayObserver):void{const r=p.run!;if(!r.defeated.includes(r.region))r.defeated.push(r.region);const lower=p.cleared.filter(i=>i<r.region&&!r.defeated.includes(i)).at(-1);if(r.remaining===0){finishRun(p,'补给耗尽，保留战利品回营',observe);return;}if(lower===undefined){finishRun(p,'没有可退守的已通关区域，保留战利品回营',observe);return;}r.region=lower;r.phase='recover';r.hp=0;r.enemyHP=0;r.due=p.tick+80;r.log='失利，退守'+regions[lower].name+'；8秒整备后继续刷材料。';p.notice=r.log;}
function beginFight(p:Profile,partySize:number,observe?:GameplayObserver,heal=true):void{const r=p.run!;if(!r.remaining){finishRun(p,'补给耗尽，已安全回营',observe);return;}if(!hasRoomForExpeditionWin(p,partySize)){finishRun(p,'远征物资箱空间不足，已安全回营',observe);return;}if(!canPayNextWin(p,partySize)){finishRun(p,'金币或经验已满，已安全回营',observe);return;}if(!hasRoomForNextGelDrop(p,partySize,r.loot)){finishRun(p,'凝胶背包即将满，已安全回营',observe);return;}r.remaining--;r.spent++;if(heal)r.hp=Math.min(p.upgraded?80:70,r.hp+30+expeditionHealing(p)+activeEquipmentEffects(p).heal);r.wave++;r.markedUntil=0;r.enemyMax=regions[r.region].hp;r.enemyHP=r.enemyMax;r.phase='fight';r.nextAttack=p.tick+10;r.enemyAttack=p.tick+regions[r.region].interval;r.log='遭遇魔物 · 本场已消耗1口粮';}
function cast(p:Profile,skill:'frost'|'shatter',partySize:number,observe?:GameplayObserver):void{const r=p.run!,before=r.enemyHP;if(r.phase!=='fight')throw Error('当前没有可命中的魔物。');if(p.tick<(skill==='frost'?r.frostReady:r.shatterReady))throw Error('技能冷却中。');if(skill==='frost'){r.frostReady=p.tick+80-expeditionCooldown(p);r.markedUntil=p.tick+30;r.enemyHP-=8+expeditionSpell(p)+activeEquipmentEffects(p).spell;r.log='冰印命中：3秒内碎晶可引爆。';}else{const marked=r.markedUntil>p.tick;if(marked)recordMasteryCombo(p,r.id);r.shatterReady=p.tick+100-expeditionCooldown(p);const damage=(marked?30:14)+expeditionSpell(p)+activeEquipmentEffects(p).spell;r.enemyHP-=damage;r.markedUntil=0;r.log=marked?`碎晶引爆冰印，造成${damage}伤害！`:`碎晶命中，造成${damage}伤害。`;}observe?.({tick:p.tick,runId:r.id,wave:r.wave,kind:skill,amount:Math.min(before,before-r.enemyHP)});if(r.enemyHP<=0)win(p,partySize,observe);}
function stepCombat(p:Profile,partySize:number,observe?:GameplayObserver):void{const r=p.run;if(!r)return;if(r.field){stepField(p,fieldHooks(p,partySize,observe));return;}if(r.phase!=='fight'){if(p.tick>=r.due){if(r.phase==='recover')r.hp=35;beginFight(p,partySize,observe);}return;}
 if(r.auto){if(p.tick>=r.frostReady&&r.markedUntil<=p.tick)cast(p,'frost',partySize,observe);if(p.run===r&&r.phase==='fight'&&p.tick>=r.shatterReady&&(r.markedUntil>p.tick||r.enemyHP<=14))cast(p,'shatter',partySize,observe);}
 if(p.run!==r||r.phase!=='fight')return;
 if(p.tick>=r.nextAttack){const damage=(p.upgraded?9:6)+expeditionAttackBonus(p)+activeEquipmentEffects(p).attack+activePetEffects(p).attack;observe?.({tick:p.tick,runId:r.id,wave:r.wave,kind:'attack',amount:Math.min(r.enemyHP,damage)});r.enemyHP-=damage;r.nextAttack+=10;if(r.enemyHP<=0){win(p,partySize,observe);return;}}
 if(p.tick>=r.enemyAttack){const damage=Math.max(1,regions[r.region].attack-expeditionDefence(p)-activeEquipmentEffects(p).defence-activePetEffects(p).defence);observe?.({tick:p.tick,runId:r.id,wave:r.wave,kind:'hurt',amount:Math.min(r.hp,damage)});r.hp-=damage;r.enemyAttack+=regions[r.region].interval;if(r.hp<=0)lose(p,observe);}
}
function fieldHooks(p:Profile,partySize:number,observe?:GameplayObserver):FieldHooks{return {consume:(kind,details)=>{const r=p.run!,actor=r.field?.world?.actors[0],ore=1+(actor?.loadout.gather??0)+(actor?.loadout.pet?.gather??0)+(actor?.loadout.supply==='mining-tonic'&&(actor?.mines??0)<3?1:0),material=(['bone','curseCrystal','toughHide'] as const)[details.encounter??0];return r.remaining>0&&(kind==='mining'?reagentSpace(p,'ore')>=ore+refundReserve(p,'ore'):p.coins<=COINS_CAP-8&&p.xp<=XP_CAP-12&&reagentSpace(p,'gel')>=2+refundReserve(p,'gel')&&reagentSpace(p,material)>=1+refundReserve(p,material));},reward:reward=>{const r=p.run!;if(p.coins>COINS_CAP-reward.coins||p.xp>XP_CAP-reward.xp||reagentSpace(p,'gel')<reward.gel+refundReserve(p,'gel')||reagentSpace(p,'ore')<reward.ore+refundReserve(p,'ore')||Object.entries(reward.materials).some(([key,n])=>reagentSpace(p,key as 'bone'|'curseCrystal'|'toughHide')<n!+refundReserve(p,key as 'bone'|'curseCrystal'|'toughHide')))return false;p.coins+=reward.coins;p.xp+=reward.xp;r.loot+=reward.gel;p.leisure.materials.ore+=reward.ore;for(const [key,n]of Object.entries(reward.materials))changeFieldMaterial(p,key as 'bone'|'curseCrystal'|'toughHide',n!);if(reward.guardian)ensureFieldProgress(p).challenge.guardianClears=Math.min(1e9,ensureFieldProgress(p).challenge.guardianClears+1);if(reward.coins){p.totals.earned=Math.min(1e12,p.totals.earned+reward.coins);p.totals.wins++;recordChapterWin(p);recordMasteryWin(p);if(!p.cleared.includes(r.region)){p.cleared.push(r.region);p.cleared.sort();}observe?.({tick:p.tick,runId:r.id,wave:r.wave,kind:'win',amount:reward.coins});}return true;},start:budget=>applyGameplayAction(p,{type:'start-run',region:0,budget,auto:false},partySize,observe),begin:()=>beginFight(p,partySize,observe,false),win:()=>win(p,partySize,observe),finish:reason=>finishRun(p,reason,observe),stats:()=>({attack:(p.upgraded?9:6)+expeditionAttackBonus(p)+activeEquipmentEffects(p).attack+activePetEffects(p).attack,defence:expeditionDefence(p)+activeEquipmentEffects(p).defence+activePetEffects(p).defence,travelPercent:activeEquipmentEffects(p).travelPercent}),observe};}
export function applyAction(p:Profile,a:GameAction,partySize=1,observe?:GameplayObserver):void{
  applyGameplayAction(p,a,partySize,observe);recordChapterWear(p);observeTower(p);
}
function applyGameplayAction(p:Profile,a:GameAction,partySize=1,observe?:GameplayObserver):void{
  if(partyBusy(p)&&(/^(field-|equipment-|pet-|petgear-|expedition-)/.test(a.type)||['start-run','stroll-start','companion-equip','upgrade'].includes(a.type)))throw Error('请先结束组队准备或回营，再调整冒险。');
  const materialSale=parseFieldMaterialSaleAction(a as unknown as Record<string,unknown>);if(materialSale){applyFieldMaterialSale(p,materialSale);return;}
  const challenge=parseFieldChallengeAction(a as unknown as Record<string,unknown>);if(challenge){applyFieldChallenge(p,challenge);return;}
  const field=parseFieldAction(a);if(field){applyField(p,field,fieldHooks(p,partySize,observe));return;}
  const chapter=parseChapterAction(a as unknown as Record<string,unknown>);if(chapter){applyChapter(p,chapter);return;}
  const mastery=parseMasteryAction(a as unknown as Record<string,unknown>);if(mastery){applyMastery(p,mastery);return;}
  const pet=parsePetAction(a as unknown as Record<string,unknown>);if(pet){applyPets(p,pet);return;}
  const equipment=parseEquipmentAction(a as unknown as Record<string,unknown>);if(equipment){applyEquipment(p,equipment);return;}
  const tower=parseTowerAction(a as unknown as Record<string,unknown>);if(tower){applyTower(p,tower);return;}
  const village=parseVillageAction(a as unknown as Record<string,unknown>);if(village){applyVillage(p,village);return;}
  const camp=parseCampAction(a as unknown as Record<string,unknown>);if(camp){applyCamp(p,camp,next=>applyAction(p,next,partySize,observe));return;}
  const atelier=parseAtelierAction(a as unknown as Record<string,unknown>);if(atelier){applyAtelier(p,atelier);rememberProduction(p,a);return;}
  const expedition=parseExpeditionAction(a);if(expedition){applyExpedition(p,expedition,(region,budget,auto)=>applyAction(p,{type:'start-run',region,budget,auto},partySize,observe),partySize);return;}
  const leisure=parseLeisureAction(a);if(leisure){applyLeisure(p,leisure);rememberProduction(p,a);return;}
  const business=parseBusinessAction(a);if(business){applyBusiness(p,business);rememberProduction(p,a);return;}
  if(a.type==='start-run'){
    if(p.leisure.run)throw Error('请先结束悠游冒险。');if(p.job!=='keeper')throw Error('先完成补给店试餐，正式任职后再远征。');if(p.run)throw Error('已有远征进行中。');if(a.region>0&&!p.cleared.includes(a.region-1))throw Error('先通关前一区域。');if(p.bag.ration<a.budget)throw Error('旅行口粮不足，请回店制作。');if(!hasRoomForNextGelDrop(p,partySize))throw Error('凝胶背包空间不足，请先制作或强化。');
    p.bag.ration-=a.budget;p.run={id:'run-'+(p.sequence+1),wave:0,region:a.region,budget:a.budget,remaining:a.budget,spent:0,loot:0,defeated:[],phase:'travel',due:p.tick+10,hp:p.upgraded?80:70,enemyHP:0,enemyMax:0,nextAttack:0,enemyAttack:0,frostReady:p.tick,shatterReady:p.tick,markedUntil:0,auto:a.auto,log:'穿越传送门，正在寻找魔物。'};captureEquipment(p);recordChapterDepart(p);observe?.({tick:p.tick,runId:p.run.id,wave:0,kind:'depart',amount:a.budget});p.run.due=p.tick+equipmentTravel(p,10);p.notice='远征出发；每场消耗1口粮，隐藏仍继续。';return;
  }
  if(a.type==='retreat'){finishRun(p,'主动回营，已结算战利品',observe);return;}
  if(a.type==='auto-skills'){if(p.run?.field)throw Error('横向冒险使用普通攻击，请点选魔物。');if(!p.run)throw Error('没有进行中的远征。');p.run.auto=a.enabled;return;}
  if(a.type==='skill'){if(p.run?.field)throw Error('横向冒险使用普通攻击，请点选魔物。');if(!p.run||p.run.id!==a.runId||p.run.wave!==a.wave)throw Error('魔物已变化，本次技能未释放。');cast(p,a.skill,partySize,observe);return;}
  if(a.type==='apply-job'){if(p.job!=='visitor')throw Error('已经任职，无需重复应聘。');p.job='apprentice';p.bag.flour+=4;p.notice='已成为学徒，获赠4面粉。制作1份旅行口粮，再交付试餐。';return;}
  if(a.type==='craft'){
    if(p.job==='visitor')throw Error('请先向店员应聘。');if(p.job==='apprentice'&&(a.recipe!=='ration'||a.count!==1))throw Error('学徒先制作一份旅行口粮。');if(p.queue)throw Error('炉火正在制作，请等当前队列完成。');
    const r=recipes[a.recipe];if(p.bag.flour<r.flour*a.count||p.bag.gel<r.gel*a.count)throw Error('材料不足。');if(p.bag[a.recipe]+a.count+p.business.shelves[a.recipe].stock+(a.recipe==='ration'?(p.run?.remaining??0)+partyRationReserve(p):0)>1e6)throw Error('库存已满。');p.bag.flour-=r.flour*a.count;p.bag.gel-=r.gel*a.count;p.queue={recipe:a.recipe,remaining:a.count,due:p.tick+craftTicks(a.recipe,p.business)};p.notice=`已投入${a.count}份${r.name}的材料，每份${craftTicks(a.recipe,p.business)/10}秒。`;rememberProduction(p,a);return;
  }
  if(a.type==='deliver-trial'){if(p.job!=='apprentice'||p.bag.ration<1)throw Error('请以学徒身份交付一份旅行口粮。');p.bag.ration--;p.job='keeper';p.coins+=30;p.totals.earned+=30;p.notice='试餐合格！已任职补给店员，获得30金币。';return;}
  if(p.job!=='keeper')throw Error('请先完成试餐，正式任职。');
  if(a.type==='buy-flour'){if(p.coins<10||p.bag.flour>1e6-10)throw Error('金币不足或面粉库存已满。');p.coins-=10;p.bag.flour+=10;p.notice='花费10金币，购入10面粉。';return;}
  if(a.type==='retail'){if(p.retail!==a.enabled){p.retail=a.enabled;p.nextSale=p.tick+60;for(const s of Object.values(p.business.shelves))s.due=p.tick+PRICE_TIERS[s.tier].ticks;}p.notice=a.enabled?(p.business.managed?'店铺已开，只出售货架商品；货款存入钱箱。':'NPC售卖已开：每6秒出售1份，基础口粮保留2份，不自动采购。'):'NPC售卖已暂停。';return;}
  if(a.type==='upgrade'){if(p.run)throw Error('请先回营结算，再强化护符。');if(p.upgraded)throw Error('本轮装备已强化。');if(p.coins<20||p.bag.gel<5)throw Error('强化需要20金币与5野外凝胶。');p.coins-=20;p.bag.gel-=5;p.upgraded=true;p.notice='护符强化完成：冒险攻击+3，生命上限+10。';return;}
  throw Error('未知经营操作。');
}
export function transact(source:Profile,raw:unknown,partySize=1,observe?:GameplayObserver):Profile{
  integer(partySize,4,1);
  const e=parseEnvelope(raw),fp=JSON.stringify(e.action);
  if(source.receipt?.sequence===e.sequence&&source.receipt.requestId===e.requestId&&source.receipt.fingerprint===fp)return structuredClone(source);
  if(e.sequence!==source.sequence+1)throw Error('操作已过期，请刷新后重试。');
  const pending=pendingFeedback(),p=structuredClone(source);applyAction(p,e.action,partySize,pending.observe);p.sequence=e.sequence;p.receipt={sequence:e.sequence,requestId:e.requestId,fingerprint:fp};const result=parseProfile(p);pending.publish(observe);return result;
}
// 100ms fixed steps; renderer visibility and animation timing never award resources.
export function advance(source:Profile,now:number,partySize=1,observe?:GameplayObserver):Profile{
  integer(now,1e15);integer(partySize,4,1);const pending=pendingFeedback(),p=parseProfile(source),elapsed=Math.max(0,now-p.wallAt);const ms=Math.min(elapsed,8*3600*1000)+p.carryMs,steps=Math.floor(ms/100);p.carryMs=ms%100;p.wallAt=Math.max(p.wallAt,now);
  for(let i=0;i<steps;i++){
    p.tick++;
    if(p.queue&&p.tick>=p.queue.due){const q=p.queue;p.bag[q.recipe]++;p.totals.crafted++;q.remaining--;if(q.remaining)q.due+=craftTicks(q.recipe,p.business);else{const next=p.business.pending.shift();p.queue=next?{...next,due:p.tick+craftTicks(next.recipe,p.business)}:null;}p.notice=`${recipes[q.recipe].name}已做好。`;}
    stepAtelier(p);
    stepLeisure(p);
    stepCombat(p,partySize,pending.observe);
    stepBusiness(p,pending.observe);
    stepCamp(p);
    stepVillage(p);
    if(p.retail&&!p.business.managed&&p.job==='keeper'&&p.tick>=p.nextSale){p.nextSale=p.tick+60;const item=p.bag.crystal>0?'crystal':p.bag.ration>2?'ration':null;if(item){const price=recipes[item].price;if(p.coins<=1e9-price){pending.observe({tick:p.tick,runId:null,wave:0,kind:'sale',amount:price,recipe:item});p.bag[item]--;p.coins+=price;p.totals.sold++;p.totals.earned+=price;p.notice=`NPC买走一份${recipes[item].name}，收入${price}金币。`;}}}
  }
  observeTower(p);const result=parseProfile(p);pending.publish(observe);return result;
}
export * from './shop-guidance';
export * from './training-guidance';
export * from './item-cards';
