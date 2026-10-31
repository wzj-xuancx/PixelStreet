import {buddyJob} from './camp-life';
import type {Profile} from './index';
import type {Leisure,Stroll,Material} from './leisure';
import {DEPTHS,relicBonuses} from './camp-world';
import {BUDDY_ORDER,BUDDY_LORE,type Buddy} from './companions';
export * from './companions';

export const PATHS={
 scout:{name:'引路家',effect:'每阶耗时−2%，每趟徽记+1',food:'tea',foodName:'花草茶'},
 gatherer:{name:'采集家',effect:'每阶遭遇矿石+1，每趟地区作物+1',food:'soup',foodName:'菌菇汤'},
 seeker:{name:'寻星家',effect:'每阶藏宝间金币+6，每趟星尘+1',food:'biscuit',foodName:'莓果饼'},
} as const;
export type TrainingPath=keyof typeof PATHS;
export const TRAINING={voyages:[3,8,20],xp:[2,5,14],coins:[60,180,450],ore:[10,30,80],food:[1,3,5]} as const;
export const SECRET_SITES=[
 {name:'古树心室',art:'heartwood',detail:'沿着根须，走进古树珍藏的绿光',stops:['根须阶梯','萤火小径','种芯宝库','环流石桥','树心花园','古树的赠礼']},
 {name:'潮汐秘库',art:'tidevault',detail:'月泉退潮后，贝壳拱门悄悄打开',stops:['贝壳拱门','浅潮栈道','珍珠宝库','月泉石桥','水晶穹顶','潮汐的赠礼']},
 {name:'星钟回廊',art:'starbell',detail:'听着星钟，寻找写在夜空里的答案',stops:['浮光石阶','星象长廊','银页宝库','月影庭院','悬星平台','星钟的赠礼']},
 {name:'花蜜温室',art:'honeyglass',detail:'在麦田尽头，收一份带着蜂蜜香的惊喜',stops:['金穗小门','花藤长廊','蜜糖宝库','南瓜温床','花蜜庭院','丰收的赠礼']},
 {name:'极光巢庭',art:'auroranest',detail:'跟随霜羽，在云顶等待一场极光',stops:['雪羽山口','霜灯石桥','冰晶宝库','雪松长廊','极光羽巢','雪境的赠礼']},
] as const;
export const RARITIES=[
 {name:'露叶钥匙',kind:'gatherCoins',effect:'采集路线每遭遇金币+2 / 星'},
 {name:'古树种芯',kind:'regional',effect:'每趟地区作物+1 / 星'},
 {name:'萤光瓶',kind:'bossOre',effect:'守护者矿石+2 / 星'},
 {name:'潮汐沙漏',kind:'speed',effect:'探索耗时−2% / 星'},
 {name:'月泉净瓶',kind:'dust',effect:'每趟星尘+1 / 星'},
 {name:'贝壳钱袋',kind:'treasure',effect:'藏宝间金币+8 / 星'},
 {name:'星轨眼镜',kind:'secretTokens',effect:'每趟秘境徽记+2 / 星'},
 {name:'银页天书',kind:'xp',effect:'每遭遇经验+3 / 星'},
 {name:'天幕棱镜',kind:'ore',effect:'每遭遇矿石+1 / 星'},
 {name:'蜜糖罐',kind:'biscuit',effect:'每趟莓果饼+1 / 星'},
 {name:'麦穗徽章',kind:'harvest',effect:'每趟地区作物+2 / 星'},
 {name:'花语风笛',kind:'coins',effect:'每遭遇金币+2 / 星'},
 {name:'霜银铃',kind:'frost',effect:'探索耗时−1% / 星，守护者矿石+1 / 星'},
 {name:'极光羽笔',kind:'aurora',effect:'每趟秘境徽记+2 / 星，星尘+1 / 星'},
 {name:'雪境冠冕',kind:'crown',effect:'守护者金币+10 / 星'},
] as const;
export const SETS=[
 {name:'古树之约',two:'每趟晨露草+1',three:'另加守护者矿石+2'},
 {name:'月泉回声',two:'每趟星尘+1',three:'另加耗时−3%'},
 {name:'星钟学会',two:'每趟徽记+1',three:'另加每遭遇经验+6'},
 {name:'麦浪午后',two:'每趟莓果饼+1',three:'另加每遭遇金币+4'},
 {name:'极光来信',two:'耗时−2%',three:'另加每趟秘境徽记+3'},
] as const;
export interface BuddyProgress {path:TrainingPath|null;rank:number;voyages:number;stories:number}
export interface Letter {id:number;zone:number}
export const SATCHEL_ITEMS=['herb','berry','mushroom','pumpkin','snowflower','biscuit'] as const;
export type SatchelItem=typeof SATCHEL_ITEMS[number];
export interface BondSatchel extends Record<SatchelItem,number> {dust:number;tokens:number}
export interface Bonds {version:1;progress:Record<Buddy,BuddyProgress>;support:Buddy|null;relics:number[];loadout:number[];secretClears:number[];tokens:number;satchel:BondSatchel;letters:Letter[];letterSequence:number}
export interface BondSnapshot {version:1;secret:boolean;support:Buddy|null;coins:number;ore:number;xp:number;gel:number;speed:number;treasureCoins:number;treasureOre:number;bossCoins:number;bossOre:number;dust:number;tokens:number;regional:number;herb:number;biscuit:number}
export type BondAction=
 |{type:'buddy-support';companion:Buddy|null}|{type:'buddy-path';companion:Buddy;path:TrainingPath}
 |{type:'buddy-train'|'buddy-story';companion:Buddy}
 |{type:'rarity-toggle'|'rarity-upgrade';relic:number}
 |{type:'travel-letter';id:number;choice:'supplies'|'notes'|'tokens'};
export const emptySatchel=():BondSatchel=>({dust:0,tokens:0,herb:0,berry:0,mushroom:0,pumpkin:0,snowflower:0,biscuit:0});
export const initialBonds=():Bonds=>({version:1,progress:Object.fromEntries(BUDDY_ORDER.map(id=>[id,{path:null,rank:0,voyages:0,stories:0}])) as Record<Buddy,BuddyProgress>,support:null,relics:Array(15).fill(0),loadout:[],secretClears:[0,0,0,0,0],tokens:0,satchel:emptySatchel(),letters:[],letterSequence:0});
// Reading defaults never mutates a legacy profile; extension state is written only by an intent or settled trip.
export const bondsOf=(l:Leisure):Bonds=>l.bonds??initialBonds();
export const ensureBonds=(l:Leisure):Bonds=>l.bonds??(l.bonds=initialBonds());
export const buddyXP=(l:Leisure,id:Buddy):number|null=>l.companions[id]??null;
export const hasBondCargo=(l:Leisure)=>!!l.bonds&&Object.values(l.bonds.satchel).some(n=>n>0);
export const regionCrop=(zone:number):SatchelItem=>(['herb','mushroom','berry','pumpkin','snowflower'] as const)[zone];
export const storyText=(l:Leisure,id:Buddy)=>BUDDY_LORE[id][Math.max(0,bondsOf(l).progress[id].stories-1)];
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
function shape(v:unknown,keys:string):asserts v is Record<string,unknown>{if(!record(v)||Object.keys(v).sort().join(' ')!==keys.split(' ').sort().join(' '))throw Error('伙伴手记字段不匹配');}
function int(v:unknown,max=1e12,min=0):asserts v is number{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<min||v>max)throw Error('伙伴手记数值无效');}
export const isBuddy=(v:unknown):v is Buddy=>typeof v==='string'&&(BUDDY_ORDER as readonly string[]).includes(v);
const isPath=(v:unknown):v is TrainingPath=>typeof v==='string'&&Object.hasOwn(PATHS,v);
export function validateBonds(raw:unknown,l:Leisure):asserts raw is Bonds {
 shape(raw,'version progress support relics loadout secretClears tokens satchel letters letterSequence');if(raw.version!==1)throw Error('伙伴手记版本无效');
 shape(raw.progress,BUDDY_ORDER.join(' '));for(const [id,v]of Object.entries(raw.progress)){shape(v,'path rank voyages stories');if(v.path!==null&&!isPath(v.path))throw Error('培养路线无效');int(v.rank,3);int(v.voyages,1e9);int(v.stories,3);if(v.path===null&&v.rank!==0)throw Error('培养路线未选择');if(buddyXP(l,id as Buddy)===null&&(v.path!==null||v.rank!==0||v.voyages!==0||v.stories!==0))throw Error('未招募伙伴不能有培养或同行记录');if(v.rank>0&&(buddyXP(l,id as Buddy)??-1)<TRAINING.xp[v.rank-1])throw Error('伙伴成长不足');if(v.rank>0&&v.voyages<TRAINING.voyages[v.rank-1])throw Error('伙伴培养同行次数不足');if(v.stories>0&&v.voyages<TRAINING.voyages[v.stories-1])throw Error('伙伴故事尚未完成');}
 if(raw.support!==null&&(!isBuddy(raw.support)||buddyXP(l,raw.support)===null||raw.support===l.active))throw Error('支援伙伴无效');
 if(!Array.isArray(raw.relics)||raw.relics.length!==15)throw Error('奇珍记录无效');for(const n of raw.relics)int(n,3);
 if(!Array.isArray(raw.loadout)||raw.loadout.length>3||new Set(raw.loadout).size!==raw.loadout.length)throw Error('奇珍槽位无效');for(const n of raw.loadout){int(n,14);if(raw.relics[n]===0)throw Error('尚未拥有这件奇珍');}
 if(!Array.isArray(raw.secretClears)||raw.secretClears.length!==5)throw Error('秘境记录无效');for(const n of raw.secretClears)int(n,1e9);
 int(raw.tokens,9999);shape(raw.satchel,'dust tokens '+SATCHEL_ITEMS.join(' '));for(const n of Object.values(raw.satchel))int(n,1e6);
 int(raw.letterSequence,1e12);if(!Array.isArray(raw.letters)||raw.letters.length>3)throw Error('旅行来信无效');const ids=new Set<number>();for(const v of raw.letters){shape(v,'id zone');int(v.id,raw.letterSequence,1);int(v.zone,4);if(ids.has(v.id))throw Error('旅行来信重复');ids.add(v.id);}
}
export function validateBondSnapshot(v:unknown,l:Leisure):asserts v is BondSnapshot {
 shape(v,'version secret support coins ore xp gel speed treasureCoins treasureOre bossCoins bossOre dust tokens regional herb biscuit');if(v.version!==1||typeof v.secret!=='boolean')throw Error('伙伴探索快照无效');
 if(v.support!==null&&(!isBuddy(v.support)||buddyXP(l,v.support)===null))throw Error('探索支援伙伴无效');
 for(const [k,n]of Object.entries(v))if(!['version','secret','support'].includes(k))int(n,100);
}
export function parseBondAction(v:Record<string,unknown>):BondAction|null {
 if(v.type==='buddy-support'){shape(v,'type companion');if(v.companion!==null&&!isBuddy(v.companion))throw Error('支援伙伴无效');return v as BondAction;}
 if(v.type==='buddy-path'){shape(v,'type companion path');if(!isBuddy(v.companion)||!isPath(v.path))throw Error('培养路线无效');return v as BondAction;}
 if(v.type==='buddy-train'||v.type==='buddy-story'){shape(v,'type companion');if(!isBuddy(v.companion))throw Error('伙伴无效');return v as BondAction;}
 if(v.type==='rarity-toggle'||v.type==='rarity-upgrade'){shape(v,'type relic');int(v.relic,14);return v as BondAction;}
 if(v.type==='travel-letter'){shape(v,'type id choice');int(v.id,1e12,1);if(!['supplies','notes','tokens'].includes(String(v.choice))||typeof v.choice!=='string')throw Error('来信选择无效');return v as BondAction;}
 return null;
}
export function secretReason(p:Profile,zone:number):string {if(p.leisure.clears[zone]<3)return '先完成本地区3趟普通探索。';if((buddyXP(p.leisure,p.leisure.active)??0)<2)return '带队伙伴达到Lv2后可以探访秘境。';return '';}
export function bondReason(p:Profile,a:BondAction):string {
 const l=p.leisure,b=bondsOf(l);
 if(a.type==='buddy-support'){if(l.run)return '回营后再调整支援伙伴。';if(a.companion!==null){if(buddyJob(p,a.companion))return '这位伙伴正在岗位帮忙，先撤岗。';if(buddyXP(l,a.companion)===null)return '先邀请这位伙伴。';if(a.companion===l.active)return '领队不能同时担任支援。';if(a.companion===b.support)return '这位伙伴已经在支援。';}else if(b.support===null)return '尚未安排支援伙伴。';}
 else if(a.type==='buddy-path'){if(buddyXP(l,a.companion)===null)return '先邀请这位伙伴。';if(l.run)return '回营后可免费切换培养路线。';if(b.progress[a.companion].path===a.path)return '已选择这条培养路线。';}
 else if(a.type==='buddy-train'){
  if(buddyXP(l,a.companion)===null)return '先邀请这位伙伴。';const g=b.progress[a.companion],n=g.rank;if(n===3)return '专长已达到三阶。';if(!g.path)return '先选择一条培养路线。';if((buddyXP(l,a.companion)??0)<TRAINING.xp[n])return `伙伴先达到Lv${[2,3,5][n]}。`;if(g.voyages<TRAINING.voyages[n])return `领队或支援累计完成${TRAINING.voyages[n]}趟探索。`;
  if(p.coins<TRAINING.coins[n]||l.materials.ore<TRAINING.ore[n]||l.materials[PATHS[g.path].food]<TRAINING.food[n])return `需要${TRAINING.coins[n]}金币、${TRAINING.ore[n]}矿石、${TRAINING.food[n]}份${PATHS[g.path].foodName}。`;
 }else if(a.type==='buddy-story'){const g=b.progress[a.companion];if(buddyXP(l,a.companion)===null)return '先邀请这位伙伴。';if(g.stories===3)return '三篇同行故事都已珍藏。';if(g.voyages<TRAINING.voyages[g.stories])return `同行达到${TRAINING.voyages[g.stories]}趟后翻开。`;if(p.coins+[40,100,250][g.stories]>1e9)return '金币空间不足，故事奖励保留。';}
 else if(a.type==='rarity-toggle'){if(l.run)return '回营后再调整奇珍搭配。';if(!b.relics[a.relic])return '先探访对应秘境，找到这件奇珍。';if(!b.loadout.includes(a.relic)&&b.loadout.length===3)return '最多携带3件奇珍，先卸下一件。';}
 else if(a.type==='rarity-upgrade'){const n=b.relics[a.relic];if(!n)return '先探访对应秘境，找到这件奇珍。';if(n===3)return '奇珍已经修复至三星。';if(b.tokens<[0,8,18][n]||l.journal.dust<[0,6,12][n]||l.materials.ore<[0,20,50][n])return `需要${[0,8,18][n]}徽记、${[0,6,12][n]}星尘、${[0,20,50][n]}矿石。`;}
 else if(a.type==='travel-letter'){const letter=b.letters.find(v=>v.id===a.id);if(!letter)return '这封来信已经处理。';if(a.choice==='supplies'&&l.materials[regionCrop(letter.zone)]+2>9999)return '作物空间不足，可选择其他纪念。';if(a.choice==='notes'&&l.journal.dust+2>9999)return '星尘已满，可选择其他纪念。';if(a.choice==='tokens'&&b.tokens+2>9999)return '徽记已满，可选择其他纪念。';}
 return '';
}
export function applyBond(p:Profile,a:BondAction):void {
 const reason=bondReason(p,a);if(reason)throw Error(reason);const l=p.leisure,b=ensureBonds(l);
 if(a.type==='buddy-support'){b.support=a.companion;p.notice=a.companion?'支援伙伴已就位，下趟一起出发。':'支援伙伴回到小院休息。';}
 else if(a.type==='buddy-path'){b.progress[a.companion].path=a.path;p.notice=`改走${PATHS[a.path].name}路线，已学阶数保留。`;}
 else if(a.type==='buddy-train'){const g=b.progress[a.companion],n=g.rank;p.coins-=TRAINING.coins[n];l.materials.ore-=TRAINING.ore[n];l.materials[PATHS[g.path!].food]-=TRAINING.food[n];g.rank++;p.notice=`专长升至${g.rank}阶，下趟探索生效。`;}
 else if(a.type==='buddy-story'){const g=b.progress[a.companion],n=g.stories,coins=[40,100,250][n];g.stories++;p.coins+=coins;p.totals.earned=Math.min(1e12,p.totals.earned+coins);b.tokens=Math.min(9999,b.tokens+[2,4,8][n]);l.journal.dust=Math.min(9999,l.journal.dust+[1,3,6][n]);p.notice='收藏了一篇同行故事，也收下了伙伴的赠礼。';}
 else if(a.type==='rarity-toggle'){const i=b.loadout.indexOf(a.relic);if(i>=0)b.loadout.splice(i,1);else b.loadout.push(a.relic);p.notice='奇珍搭配已保存，下趟探索生效。';}
 else if(a.type==='rarity-upgrade'){const n=b.relics[a.relic];b.tokens-=[0,8,18][n];l.journal.dust-=[0,6,12][n];l.materials.ore-=[0,20,50][n];b.relics[a.relic]++;p.notice=`${RARITIES[a.relic].name}修复至${n+1}星。`;}
 else if(a.type==='travel-letter'){const v=b.letters.find(v=>v.id===a.id)!;if(a.choice==='supplies')l.materials[regionCrop(v.zone)]+=2;else if(a.choice==='notes')l.journal.dust+=2;else b.tokens+=2;b.letters=b.letters.filter(x=>x.id!==a.id);p.notice='来信已珍藏，礼物收入行囊。';}
}
export function bondSnapshot(p:Profile,route:string,secret:boolean):BondSnapshot {
 const l=p.leisure,b=bondsOf(l),s:BondSnapshot={version:1,secret,support:b.support,coins:0,ore:0,xp:0,gel:0,speed:0,treasureCoins:0,treasureOre:0,bossCoins:0,bossOre:0,dust:0,tokens:0,regional:0,herb:0,biscuit:0};
 const perk=(id:Buddy,support:boolean)=>{switch(id){case 'slime':if(support)s.gel++;break;case 'guide':if(support)s.coins++;break;case 'guard':if(support)s.ore++;break;case 'fox':s.treasureCoins+=8;break;case 'deer':s.herb+=2;break;case 'otter':s.treasureOre+=4;if(secret)s.tokens++;break;case 'owl':s.dust++;break;case 'bear':s.biscuit++;break;case 'bird':s.speed+=support?2:4;break;}};
 perk(l.active,false);if(b.support)perk(b.support,true);
 const g=b.progress[l.active];if(g.path==='scout'){s.speed+=g.rank*2;s.tokens+=g.rank;}if(g.path==='gatherer'){s.ore+=g.rank;s.regional+=g.rank;}if(g.path==='seeker'){s.treasureCoins+=g.rank*6;s.dust+=g.rank;}
 for(const i of b.loadout){const rank=b.relics[i];switch(RARITIES[i].kind){case 'gatherCoins':if(route==='gather')s.coins+=2*rank;break;case 'regional':s.regional+=rank;break;case 'bossOre':s.bossOre+=2*rank;break;case 'speed':s.speed+=2*rank;break;case 'dust':s.dust+=rank;break;case 'treasure':s.treasureCoins+=8*rank;break;case 'secretTokens':if(secret)s.tokens+=2*rank;break;case 'xp':s.xp+=3*rank;break;case 'ore':s.ore+=rank;break;case 'biscuit':s.biscuit+=rank;break;case 'harvest':s.regional+=2*rank;break;case 'coins':s.coins+=2*rank;break;case 'frost':s.speed+=rank;s.bossOre+=rank;break;case 'aurora':if(secret)s.tokens+=2*rank;s.dust+=rank;break;case 'crown':s.bossCoins+=10*rank;break;}}
 for(let zone=0;zone<5;zone++){const count=b.loadout.filter(i=>Math.floor(i/3)===zone).length;if(count<2)continue;if(zone===0){s.herb++;if(count===3)s.bossOre+=2;}if(zone===1){s.dust++;if(count===3)s.speed+=3;}if(zone===2){s.tokens++;if(count===3)s.xp+=6;}if(zone===3){s.biscuit++;if(count===3)s.coins+=4;}if(zone===4){s.speed+=2;if(count===3&&secret)s.tokens+=3;}}
 return s;
}
export function bondDuration(p:Profile,ticks:number,level:number,depth:number,secret:boolean):number {
 const extra=bondSnapshot(p,'balanced',secret).speed,discount=Math.min(50,(level-1)*5+relicBonuses(p).speed+extra);
 return Math.ceil(ticks*DEPTHS[depth].scale*(secret?1.5:1)*(100-discount)/100);
}
export function settleBondRoom(p:Profile,r:Stroll):void {
 const s=r.bonds;if(!s)return;const l=p.leisure,b=ensureBonds(l),boss=r.room===5?2:1,m=DEPTHS[r.depth].reward;
 l.cargo.coins+=(s.coins*boss+(r.room===2?s.treasureCoins:0)+(r.room===5?s.bossCoins:0))*m;l.cargo.ore+=(s.ore*boss+(r.room===2?s.treasureOre:0)+(r.room===5?s.bossOre:0))*m;l.cargo.xp+=s.xp*boss*m;l.cargo.gel+=s.gel*boss;
 if(r.room===2&&b.letters.length<3&&b.letterSequence<1e12)b.letters.push({id:++b.letterSequence,zone:r.zone});
}
export function settleBondTrip(p:Profile,r:Stroll):void {
 const s=r.bonds;if(!s)return;const l=p.leisure,b=ensureBonds(l),sat=b.satchel;
 for(const id of [r.companion,s.support])if(id)b.progress[id].voyages=Math.min(1e9,b.progress[id].voyages+1);
 sat.dust+=s.dust;sat.tokens+=s.tokens;sat[regionCrop(r.zone)]+=s.regional;sat.herb+=s.herb;sat.biscuit+=s.biscuit;
 if(s.secret){b.secretClears[r.zone]=Math.min(1e9,b.secretClears[r.zone]+1);const index=r.zone*3+(b.secretClears[r.zone]-1)%3;if(!b.relics[index]){b.relics[index]=1;}else{sat.tokens+=2+r.depth;}/* Every secret trip grants base tokens; a duplicate adds the same amount again. */sat.tokens+=2+r.depth;sat.dust++;sat[regionCrop(r.zone)]+=2;}
}
export function bondClaimReason(l:Leisure):string {const b=l.bonds;if(!b)return '';for(const m of SATCHEL_ITEMS)if(l.materials[m]+b.satchel[m]>9999)return '伙伴补给空间不足，请先制作或出售食品；战利品保留。';return '';}
export function claimBonds(l:Leisure):void {const b=l.bonds;if(!b)return;for(const m of SATCHEL_ITEMS)l.materials[m]+=b.satchel[m];l.journal.dust=Math.min(9999,l.journal.dust+b.satchel.dust);b.tokens=Math.min(9999,b.tokens+b.satchel.tokens);b.satchel=emptySatchel();}
