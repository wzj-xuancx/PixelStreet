import type {Profile} from './index';
import type {Food,Material} from './leisure';

export const DEPTHS=[{name:'悠闲漫步',scale:1,reward:1},{name:'秘境寻访',scale:1.5,reward:2},{name:'远古回响',scale:2,reward:3}] as const;
export const masteryLevel=(clears:number)=>1+[3,10,25,50].filter(n=>clears>=n).length;
export const masteryNext=(clears:number)=>[3,10,25,50].find(n=>n>clears)??null;
export const LANDMARKS=[['萤火石桥','蘑菇树屋','旧井宝藏','苔色花园','林间空地','古树守护者'],['蓝晶入口','矿工栈道','月泉宝库','回声岩廊','水晶湖畔','岩灵守护者'],['断柱长阶','星象庭院','陨星宝库','浮光回廊','观星平台','遗迹守护者'],['麦浪小径','溪边风车','丰收粮仓','南瓜田埂','夕照山坡','风铃守护者'],['雪松山口','冰湖石桥','霜晶宝库','灯火山道','云顶钟楼','雪境守护者']] as const;
export const RELICS=[
 ['萤火提灯','coins','每个遭遇金币'],['苔纹石印','ore','守护者月纹石'],['四叶书签','speed','探索耗时减少'],
 ['月泉银币','coins','每个遭遇金币'],['蓝晶罗盘','ore','守护者月纹石'],['回声贝壳','speed','探索耗时减少'],
 ['陨星坠饰','coins','每个遭遇金币'],['古代星盘','ore','守护者月纹石'],['流光羽毛','speed','探索耗时减少'],
 ['丰收铜铃','coins','每个遭遇金币'],['风车齿轮','ore','守护者月纹石'],['金穗风筝','speed','探索耗时减少'],
 ['霜夜灯芯','coins','每个遭遇金币'],['冰湖棱镜','ore','守护者月纹石'],['雪松徽章','speed','探索耗时减少'],
] as const;
export type Building='lodge'|'workshop'|'archive';
export const BUILDINGS={
 lodge:{name:'旅人小屋',effect:['解锁秘境寻访；凝胶容量150','解锁远古回响；凝胶容量200','可连走六趟；凝胶容量250'],coins:[90,350,1000],ore:[15,50,120],unlock:[0,2,4]},
 workshop:{name:'篝火厨房',effect:['每份料理多卖2金币','每份料理多卖4金币','每份料理多卖6金币'],coins:[70,250,700],ore:[10,40,100],unlock:[0,1,3]},
 archive:{name:'观星收藏室',effect:['可修复二星遗物；每趟星尘+1','可修复三星遗物；每趟星尘+2','每趟星尘+3'],coins:[120,400,1200],ore:[20,60,150],unlock:[1,2,4]},
} as const;
export interface Journal {buildings:Record<Building,number>;relics:number[];dust:number;contracts:number[];deliveries:number}
export type WorldAction={type:'camp-build';building:Building}|{type:'relic-upgrade';relic:number}|{type:'camp-deliver';slot:number};
export const initialJournal=():Journal=>({buildings:{lodge:0,workshop:0,archive:0},relics:Array(15).fill(0),dust:0,contracts:[0,0,0],deliveries:0});
export const relicBonuses=(p:Profile)=>p.leisure.journal.relics.reduce((b,rank,i)=>{b[RELICS[i][1]]+=rank;return b;},{coins:0,ore:0,speed:0});
export const leisureGelCapacity=(p:Profile)=>100+p.leisure.journal.buildings.lodge*50;
export const foodPrice=(p:Profile,base:number)=>base+p.leisure.journal.buildings.workshop*2;
export function depthReason(p:Profile,zone:number,depth:number):string {
 if(depth===0)return '';
 if(p.leisure.journal.buildings.lodge<depth)return `先将旅人小屋建至Lv${depth}。`;
 if(masteryLevel(p.leisure.clears[zone])<depth+1)return `地区熟悉度达到Lv${depth+1}后开放。`;
 return '';
}
export const strollDuration=(p:Profile,zoneTicks:number,level:number,depth:number)=>Math.ceil(zoneTicks*DEPTHS[depth].scale*(100-(level-1)*5-relicBonuses(p).speed)/100);
export const CONTRACTS=[
 {name:'采药人的茶歇',who:'草药师',items:{tea:2},coins:38,ore:2,dust:0,unlock:-1},
 {name:'林间野餐篮',who:'旅行商人',items:{biscuit:2},coins:48,ore:3,dust:0,unlock:-1},
 {name:'矿工的晚餐',who:'月泉矿工',items:{soup:2},coins:68,ore:4,dust:1,unlock:0},
 {name:'新的草药标本',who:'营地学者',items:{herb:8,berry:4},coins:55,ore:4,dust:1,unlock:-1},
 {name:'观星之夜',who:'星象学者',items:{tea:3,soup:2},coins:110,ore:7,dust:2,unlock:1},
 {name:'守林人的口粮',who:'林地守卫',items:{biscuit:4,mushroom:3},coins:140,ore:8,dust:2,unlock:1},
 {name:'丰收庆典',who:'风车农夫',items:{pie:3},coins:190,ore:12,dust:3,unlock:3},
 {name:'雪境暖心礼',who:'云顶旅人',items:{snowtea:3,pie:2},coins:300,ore:18,dust:4,unlock:4},
] as const;
export const contractAt=(p:Profile,slot:number)=>CONTRACTS[(slot+p.leisure.journal.contracts[slot]*3)%CONTRACTS.length];
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
function shape(v:unknown,keys:string):asserts v is Record<string,unknown>{if(!object(v)||Object.keys(v).sort().join(' ')!==keys.split(' ').sort().join(' '))throw Error('探索手记字段不匹配');}
function int(v:unknown,max=1e12):asserts v is number{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0||v>max)throw Error('探索手记数值无效');}
export function validateJournal(v:unknown):asserts v is Journal {
 shape(v,'buildings relics dust contracts deliveries');shape(v.buildings,'lodge workshop archive');for(const n of Object.values(v.buildings))int(n,3);
 if(!Array.isArray(v.relics)||v.relics.length!==15)throw Error('遗物记录无效');for(const n of v.relics)int(n,3);
 int(v.dust,9999);int(v.deliveries);if(!Array.isArray(v.contracts)||v.contracts.length!==3)throw Error('委托记录无效');for(const n of v.contracts)int(n,1e9);
 if(v.contracts.reduce((a,b)=>a+b,0)!==v.deliveries)throw Error('委托总数无效');
}
export function parseWorldAction(v:Record<string,unknown>):WorldAction|null {
 if(v.type==='camp-build'){shape(v,'type building');if(typeof v.building!=='string'||!Object.hasOwn(BUILDINGS,v.building))throw Error('营地建筑无效');return v as WorldAction;}
 if(v.type==='relic-upgrade'){shape(v,'type relic');int(v.relic,14);return v as WorldAction;}
 if(v.type==='camp-deliver'){shape(v,'type slot');int(v.slot,2);return v as WorldAction;}
 return null;
}
export function worldReason(p:Profile,a:WorldAction):string {
 const j=p.leisure.journal;
 if(a.type==='camp-build'){
  const n=j.buildings[a.building],b=BUILDINGS[a.building];if(n===3)return '建筑已满级。';
  if(!p.leisure.clears[b.unlock[n]])return '先完成对应地区的探索。';
  if(p.coins<b.coins[n]||p.leisure.materials.ore<b.ore[n])return `需要${b.coins[n]}金币、${b.ore[n]}月纹石。`;
 }else if(a.type==='relic-upgrade'){
  const rank=j.relics[a.relic];if(!rank)return '先探索对应地区，找到这件遗物。';if(rank===3)return '遗物已修复至三星。';
  if(j.buildings.archive<rank)return `先将观星收藏室建至Lv${rank}。`;
  if(j.dust<[0,4,10][rank]||p.leisure.materials.ore<[0,15,40][rank])return `需要${[0,4,10][rank]}星尘、${[0,15,40][rank]}月纹石。`;
 }else{
  const c=contractAt(p,a.slot);if(c.unlock>=0&&!p.leisure.clears[c.unlock])return '先探索委托对应地区。';
  if(Object.entries(c.items).some(([m,n])=>p.leisure.materials[m as Material]<n))return '委托所需物品不足。';
  if(p.coins+c.coins>1e9||p.leisure.materials.ore+c.ore>9999||j.dust+c.dust>9999)return '奖励空间不足，委托物品保留。';
  if(j.contracts[a.slot]===1e9)return '该委托栏已达上限。';
 }
 return '';
}
export function applyWorld(p:Profile,a:WorldAction):void {
 const reason=worldReason(p,a);if(reason)throw Error(reason);const j=p.leisure.journal;
 if(a.type==='camp-build'){const n=j.buildings[a.building],b=BUILDINGS[a.building];p.coins-=b.coins[n];p.leisure.materials.ore-=b.ore[n];j.buildings[a.building]++;p.notice=`${b.name}建至Lv${n+1}。`;}
 else if(a.type==='relic-upgrade'){const rank=j.relics[a.relic];j.dust-=[0,4,10][rank];p.leisure.materials.ore-=[0,15,40][rank];j.relics[a.relic]++;p.notice=`${RELICS[a.relic][0]}修复至${rank+1}星；探索加成在下趟生效。`;}
 else{const c=contractAt(p,a.slot);for(const [m,n]of Object.entries(c.items))p.leisure.materials[m as Material]-=n;p.coins+=c.coins;p.totals.earned=Math.min(1e12,p.totals.earned+c.coins);p.leisure.materials.ore+=c.ore;j.dust+=c.dust;j.contracts[a.slot]++;j.deliveries++;p.notice=`完成“${c.name}”，新委托已送达。`;}
}
export function discoverRelic(p:Profile,zone:number,depth:number):void {
 const j=p.leisure.journal,index=zone*3+(p.leisure.clears[zone]-1)%3;
 if(j.relics[index]===0){j.relics[index]=1;p.notice=`发现遗物：${RELICS[index][0]}！`;}else j.dust=Math.min(9999,j.dust+1+depth);
}
