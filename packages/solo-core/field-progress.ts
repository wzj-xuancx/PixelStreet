import type {Profile} from './index';
export const FIELD_MATERIALS=['bone','curseCrystal','toughHide'] as const;
export type FieldMaterial=typeof FIELD_MATERIALS[number];
export type FieldSupply='herbal-bandage'|'mining-tonic';
export const FIELD_BADGE_ID='field:crystal-guardian' as const;
export interface FieldProgress {version:1;materials:Record<FieldMaterial,number>;challenge:{guardianClears:number;claimed:boolean;equipped:boolean}}
export const initialFieldProgress=():FieldProgress=>({version:1,materials:{bone:0,curseCrystal:0,toughHide:0},challenge:{guardianClears:0,claimed:false,equipped:false}});
/** Read fallback is detached and never installs persistent progress. */
export const fieldProgressOf=(p:Profile):FieldProgress=>p.fieldProgress??initialFieldProgress();
/** Authority-only mutation helper. Renderers must dispatch intents. */
export const ensureFieldProgress=(p:Profile):FieldProgress=>p.fieldProgress??=initialFieldProgress();
export const isFieldMaterial=(id:unknown):id is FieldMaterial=>typeof id==='string'&&(FIELD_MATERIALS as readonly string[]).includes(id);
export function fieldMaterialCount(p:Profile,id:FieldMaterial):number{if(!isFieldMaterial(id))throw Error('野外材料身份无效');return fieldProgressOf(p).materials[id];}
export function changeFieldMaterial(p:Profile,id:FieldMaterial,delta:number):void{const next=fieldMaterialCount(p,id)+delta;if(!Number.isSafeInteger(delta)||!Number.isSafeInteger(next)||next<0||next>9999)throw Error('野外材料余额超限');ensureFieldProgress(p).materials[id]=next;}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
function shape(v:unknown,keys:string):asserts v is Record<string,unknown>{if(!object(v)||Object.keys(v).sort().join(' ')!==keys.split(' ').sort().join(' '))throw Error('野外进度字段无效');}
export function validateFieldProgress(raw:unknown):asserts raw is FieldProgress{shape(raw,'version materials challenge');if(raw.version!==1)throw Error('野外进度版本无效');shape(raw.materials,FIELD_MATERIALS.join(' '));for(const n of Object.values(raw.materials))if(typeof n!=='number'||!Number.isSafeInteger(n)||n<0||n>9999)throw Error('野外材料余额无效');shape(raw.challenge,'guardianClears claimed equipped');const c=raw.challenge;if(typeof c.guardianClears!=='number'||!Number.isSafeInteger(c.guardianClears)||c.guardianClears<0||c.guardianClears>1e9||typeof c.claimed!=='boolean'||typeof c.equipped!=='boolean'||c.claimed&&c.guardianClears<1||c.equipped&&!c.claimed)throw Error('野外挑战进度无效');}
export type FieldChallengeAction={type:'challenge-claim'|'challenge-wear'|'challenge-unwear'};
export function parseFieldChallengeAction(v:Record<string,unknown>):FieldChallengeAction|null{if(!['challenge-claim','challenge-wear','challenge-unwear'].includes(String(v.type)))return null;shape(v,'type');return v as unknown as FieldChallengeAction;}
export function applyFieldChallenge(p:Profile,a:FieldChallengeAction):void{const c=ensureFieldProgress(p).challenge;if(a.type==='challenge-claim'){if(c.guardianClears<1)throw Error('先击败裂晶守卫');c.claimed=true;p.notice='已珍藏裂晶守卫徽记。';}else if(a.type==='challenge-wear'){if(!c.claimed)throw Error('请先领取裂晶守卫徽记');c.equipped=true;if(p.mastery)p.mastery.worn=null;p.notice='已佩戴裂晶守卫徽记。';}else{c.equipped=false;p.notice='已卸下裂晶守卫徽记。';}}

export type FieldMaterialSaleAction={type:'material-sell';material:FieldMaterial;count:number};
export function parseFieldMaterialSaleAction(v:Record<string,unknown>):FieldMaterialSaleAction|null{if(v.type!=='material-sell')return null;shape(v,'type material count');if(!isFieldMaterial(v.material)||typeof v.count!=='number'||!Number.isSafeInteger(v.count)||v.count<1||v.count>9999)throw Error('野外材料出售数量或身份无效');return v as unknown as FieldMaterialSaleAction;}
export function fieldMaterialSaleReason(p:Profile,a:FieldMaterialSaleAction):string{if(!isFieldMaterial(a.material)||!Number.isSafeInteger(a.count)||a.count<1||a.count>9999)return '野外材料出售数量或身份无效。';if(p.job!=='keeper')return '请先完成试餐，正式任职。';const stock=fieldMaterialCount(p,a.material);if(a.count>stock)return '野外材料库存不足。';if(a.count!==1&&a.count!==stock)return '请选择出售1份或全部余量。';if(p.coins>1e9-a.count)return '金币空间不足。';return '';}
export function applyFieldMaterialSale(p:Profile,a:FieldMaterialSaleAction):void{const reason=fieldMaterialSaleReason(p,a);if(reason)throw Error(reason);changeFieldMaterial(p,a.material,-a.count);p.coins+=a.count;p.totals.earned=Math.min(1e12,p.totals.earned+a.count);p.totals.sold=Math.min(1e12,p.totals.sold+a.count);p.notice=`余量已出售 ${a.count}份 · ${a.count}金币。`;}
