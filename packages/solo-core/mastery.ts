import {FIELD_BADGE_ID} from './field-progress';
import type {Profile} from './index';
import type {Recipe} from './catalog';
import {COMPANIONS} from './leisure';
import type {PriceTier} from './business';
import {EQUIPMENT_SLOTS,EQUIPMENT_CATALOG,emptyEquipmentSlots,isEquipmentId,type EquipmentSlots} from './equipment';
import {PET_SLOTS,PET_GEAR_CATALOG,emptyPetSlots,isPetGearId,type PetSlots} from './pets';
export const MASTERY_IDS=['paired-shelves','price-choice','two-recipes','ready-six','two-builds','moss-guardian'] as const;
export type MasteryId=typeof MASTERY_IDS[number];
export const MASTERY_GOALS={
 'paired-shelves':{name:'双麦徽记',line:'business',goal:'双货架各售出一份',detail:'两种商品同时陈列时，旅行口粮和魔晶餐各实际售出一份。'},
 'price-choice':{name:'天平徽记',line:'business',goal:'同商品快卖与高价成交',detail:'同一种商品分别选择快卖、高价，并等待真实成交。'},
 'two-recipes':{name:'商会印章',line:'business',goal:'交付两种配方委托',detail:'在补给店接取并交付旅行口粮、魔晶餐两种委托。'},
 'ready-six':{name:'行路者徽记',line:'idle',goal:'六格装备齐备获胜',detail:'出发时人物六格装备齐备，赢下一场挂机遭遇。'},
 'two-builds':{name:'双途徽记',line:'idle',goal:'冰印连招与采集获胜',detail:'一趟戴蓝石坠饰实际引爆冰印后获胜；另一趟戴叶纹胸针，在野外采集路线获胜。'},
 'moss-guardian':{name:'苔光守护徽记',line:'idle',goal:'苔团子整装深入获胜',detail:'苔团子三格装备齐备，携菌菇汤，在裂晶洞口或更深地区的增强远征中获胜。'},
} as const;
type ProofKind='six'|'blue'|'leaf'|'moss';
export interface MasteryProof {kind:ProofKind;runId:string;region:number;mode:'basic'|'survey'|'forage'|'caravan';meal:'none'|'tea'|'biscuit'|'soup';crew:string;gear:EquipmentSlots;pet:PetSlots;combo:boolean}
export interface Mastery {version:1;startedTick:number;startedSequence:number;shelves:number;quick:number;premium:number;orders:number;proofs:MasteryProof[];comboRun:string|null;claimed:MasteryId[];worn:MasteryId|null}
export type MasteryAction={type:'mastery-start'}|{type:'mastery-unwear'}|{type:'mastery-claim'|'mastery-wear';id:MasteryId};
export const isMasteryId=(v:unknown):v is MasteryId=>typeof v==='string'&&(MASTERY_IDS as readonly string[]).includes(v);
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
function shape(v:unknown,keys:string):asserts v is Record<string,unknown>{if(!object(v)||Object.keys(v).sort().join(' ')!==keys.split(' ').sort().join(' '))throw Error('精通字段无效');}
function int(v:unknown,max=1e15):asserts v is number{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0||v>max)throw Error('精通数值无效');}
const runId=(v:unknown):v is string=>typeof v==='string'&&/^run-[0-9]{1,16}$/.test(v);
/** Read-only cosmetic projection; never starts mastery or changes a profile. */
export type DisplayBadge=MasteryId|typeof FIELD_BADGE_ID;
export const isDisplayBadge=(v:unknown):v is DisplayBadge=>v===FIELD_BADGE_ID||isMasteryId(v);
export function roomDisplayBadge(p:Profile):DisplayBadge|null{if(p.fieldProgress?.challenge.equipped)return FIELD_BADGE_ID;const m=p.mastery;return m&&isMasteryId(m.worn)&&m.claimed.includes(m.worn)?m.worn:null;}
export const masteryOf=(p:Profile):Mastery|undefined=>p.mastery;
const kindReady=(p:MasteryProof,k:ProofKind)=>k==='six'?EQUIPMENT_SLOTS.every(s=>p.gear[s]!==null):k==='blue'?p.gear.accessory==='blue-pendant'&&p.combo:k==='leaf'?p.gear.accessory==='leaf-brooch'&&p.mode==='forage':p.crew==='slime'&&p.mode!=='basic'&&p.meal==='soup'&&p.region>=1&&PET_SLOTS.every(s=>p.pet[s]!==null);
export function validateMastery(v:unknown,p:Profile):asserts v is Mastery{
 shape(v,'version startedTick startedSequence shelves quick premium orders proofs comboRun claimed worn');if(v.version!==1)throw Error('精通版本无效');int(v.startedTick,p.tick);int(v.startedSequence,p.sequence);for(const k of ['shelves','quick','premium','orders'])int(v[k],3);
 if(v.comboRun!==null&&(!runId(v.comboRun)||v.comboRun!==p.run?.id))throw Error('精通连招游标无效');
 if(!Array.isArray(v.proofs)||v.proofs.length>4)throw Error('精通证据无效');const seen=new Set();for(const proof of v.proofs){shape(proof,'kind runId region mode meal crew gear pet combo');if(typeof proof.kind!=='string'||!['six','blue','leaf','moss'].includes(proof.kind)||seen.has(proof.kind)||!runId(proof.runId)||typeof proof.mode!=='string'||!['basic','survey','forage','caravan'].includes(proof.mode)||typeof proof.meal!=='string'||!['none','tea','biscuit','soup'].includes(proof.meal)||!(proof.crew==='none'||typeof proof.crew==='string'&&Object.hasOwn(COMPANIONS,proof.crew))||typeof proof.combo!=='boolean')throw Error('精通证据身份无效');seen.add(proof.kind);int(proof.region,2);shape(proof.gear,EQUIPMENT_SLOTS.join(' '));for(const s of EQUIPMENT_SLOTS){const x=proof.gear[s];if(x!==null&&(!isEquipmentId(x)||EQUIPMENT_CATALOG[x].slot!==s))throw Error('精通人物装备无效');}shape(proof.pet,PET_SLOTS.join(' '));for(const s of PET_SLOTS){const x=proof.pet[s];if(x!==null&&(!isPetGearId(x)||PET_GEAR_CATALOG[x].slot!==s))throw Error('精通宠物装备无效');}if(!kindReady(proof as unknown as MasteryProof,proof.kind as ProofKind))throw Error('精通证据不满足目标');}
 const blue=(v.proofs as MasteryProof[]).find(x=>x.kind==='blue'),leaf=(v.proofs as MasteryProof[]).find(x=>x.kind==='leaf');if(blue&&leaf&&blue.runId===leaf.runId)throw Error('双途需要两次出发');
 if(!Array.isArray(v.claimed)||v.claimed.length>6||Array.from(v.claimed).some(x=>!isMasteryId(x))||new Set(v.claimed).size!==v.claimed.length)throw Error('精通纪念物无效');const m=v as unknown as Mastery;for(const x of m.claimed)if(!completed(m,x))throw Error('精通纪念物缺少证据');if(v.worn!==null&&(!isMasteryId(v.worn)||!m.claimed.includes(v.worn)))throw Error('未拥有精通装饰');
}
function completed(m:Mastery,id:MasteryId):boolean {if(id==='paired-shelves')return m.shelves===3;if(id==='price-choice')return (m.quick&m.premium)!==0;if(id==='two-recipes')return m.orders===3;const has=(k:ProofKind)=>m.proofs.some(p=>p.kind===k);return id==='ready-six'?has('six'):id==='two-builds'?has('blue')&&has('leaf'):has('moss');}
export function masteryView(p:Profile){const m=p.mastery;return MASTERY_IDS.map(id=>{const owned=!!m?.claimed.includes(id),ready=!!m&&completed(m,id);let progress=0;const bits=(n:number)=>Number(!!(n&1))+Number(!!(n&2));if(m)progress=id==='paired-shelves'?bits(m.shelves):id==='price-choice'?((m.quick&m.premium)?2:Math.max(bits(m.quick&1)+bits(m.premium&1),bits(m.quick&2)+bits(m.premium&2))):id==='two-recipes'?bits(m.orders):id==='two-builds'?Number(m.proofs.some(p=>p.kind==='blue'))+Number(m.proofs.some(p=>p.kind==='leaf')):Number(ready);return {id,...MASTERY_GOALS[id],status:owned?'claimed':ready?'ready':'active',progress,required:['ready-six','moss-guardian'].includes(id)?1:2,worn:m?.worn===id,claimReason:!m?'开启后记录。':owned?'已领取这枚纪念物。':!ready?'继续完成目标。':''};});}
export const masteryChapters=(p:Profile)=>({business:MASTERY_IDS.slice(0,3).every(id=>p.mastery?.claimed.includes(id)),idle:MASTERY_IDS.slice(3).every(id=>p.mastery?.claimed.includes(id))});
export const isTowerOnlyAction=(a:{type:string}):boolean=>['challenge-claim','challenge-wear','challenge-unwear','tower-claim','mastery-start','mastery-claim','mastery-wear','mastery-unwear'].includes(a.type);
export function parseMasteryAction(v:Record<string,unknown>):MasteryAction|null{if(v.type==='mastery-start'||v.type==='mastery-unwear'){shape(v,'type');return v as MasteryAction;}if(v.type==='mastery-claim'||v.type==='mastery-wear'){shape(v,'type id');if(!isMasteryId(v.id))throw Error('精通目标无效');return v as MasteryAction;}return null;}
export function applyMastery(p:Profile,a:MasteryAction):void{if(a.type==='mastery-start'){if(p.mastery)throw Error('精通已经开启。');p.mastery={version:1,startedTick:p.tick,startedSequence:p.sequence+1,shelves:0,quick:0,premium:0,orders:0,proofs:[],comboRun:null,claimed:[],worn:null};p.notice='精通已开启，今后的实际成交与远征会留下纪念。';return;}const m=p.mastery;if(!m)throw Error('请先开启精通。');if(a.type==='mastery-unwear'){if(!m.worn)throw Error('尚未佩戴纪念物。');m.worn=null;p.notice='已卸下头像纪念装饰。';return;}if(a.type==='mastery-claim'){if(m.claimed.includes(a.id))throw Error('这枚纪念物已领取。');if(!completed(m,a.id))throw Error('精通目标尚未完成。');m.claimed.push(a.id);p.notice=`已珍藏${MASTERY_GOALS[a.id].name}。`;}else{if(!m.claimed.includes(a.id))throw Error('请先领取这枚纪念物。');if(m.worn===a.id)throw Error('已经佩戴这枚纪念物。');m.worn=a.id;if(p.fieldProgress)p.fieldProgress.challenge.equipped=false;p.notice=`已佩戴${MASTERY_GOALS[a.id].name}头像装饰。`;}}
export function recordMasterySale(p:Profile,recipe:Recipe,tier:PriceTier,bothStocked:boolean):void{const m=p.mastery;if(!m)return;const b=recipe==='ration'?1:2;if(bothStocked)m.shelves|=b;if(tier==='quick')m.quick|=b;if(tier==='premium')m.premium|=b;}
export function recordMasteryOrder(p:Profile,recipe:Recipe):void{if(p.mastery)p.mastery.orders|=recipe==='ration'?1:2;}
export function recordMasteryCombo(p:Profile,run:string):void{if(p.mastery&&p.run?.id===run)p.mastery.comboRun=run;}
export function clearMasteryRun(p:Profile):void{if(p.mastery)p.mastery.comboRun=null;}
/** Called only after reward capacity checks and actual win settlement, before frozen state clears. */
export function recordMasteryWin(p:Profile):void{const m=p.mastery,r=p.run;if(!m||!r)return;const e=p.expedition?.active?.runId===r.id?p.expedition.active:null;const proof:MasteryProof={kind:'six',runId:r.id,region:r.region,mode:e?.mode??'basic',meal:e?.meal??'none',crew:e?.crew??'none',gear:p.equipment?.active?.runId===r.id?{...p.equipment.active.slots}:emptyEquipmentSlots(),pet:p.pets?.active?.runId===r.id?{...p.pets.active.slots}:emptyPetSlots(),combo:m.comboRun===r.id};for(const k of ['six','blue','leaf','moss'] as const)if(!m.proofs.some(p=>p.kind===k)&&kindReady(proof,k))m.proofs.push({...proof,kind:k});}
