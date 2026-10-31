import {chapterView,regions,type Profile,type ChapterStep} from '../../../packages/solo-core';
import {craftTicks} from '../../../packages/solo-core/business';
import {readExpedition,EXPEDITION_MATERIALS} from '../../../packages/solo-core/expedition';
export interface ChapterResource {id:string;name:string;owned:number;needed:number}
export interface ChapterCard {header:string;title:string;description:string;art:string;map:boolean;resources:ChapterResource[];note:string;primary:string;worn:boolean}
const resource=(id:string,name:string,owned:number,needed:number):ChapterResource=>({id,name,owned,needed});
/** Costs describe this click only; completed crafting costs never bleed into wear/wait cards. */
export function chapterCard(p:Profile,demo=false):ChapterCard {
 const c:ChapterCard={header:'当前目标',title:'',description:'',art:'bag:ration',map:false,resources:[],note:'',primary:'继续',worn:false};
 if(demo)return {...c,header:'先备一件防具',title:'旅途外套',description:'挂机受击 −1',art:'equipment:trail-coat',note:'同一攻击 3 → 2',primary:'去补给店 →'};
 const step=chapterView(p).step;
 const flour=(n:number)=>resource('flour','面粉',p.bag.flour,n),gel=(n:number)=>resource('gel','凝胶',p.bag.gel,n),coins=(n:number)=>resource('coins','金币',p.coins,n),ration=()=>resource('ration','口粮',p.bag.ration,3);
 switch(step){
 case 'apply':Object.assign(c,{header:'先赚取工钱',title:'店员试做',description:'应聘获4面粉，学做一份试餐。',primary:'应聘'});break;
 case 'trial-craft':Object.assign(c,{header:'店员试做',title:'旅行口粮',description:'试餐制作 · 6秒',resources:[flour(2)],primary:'制作试餐'});break;
 case 'trial-wait':Object.assign(c,{header:'店员试做',title:'试餐制作中',primary:'制作中'});break;
 case 'trial-deliver':Object.assign(c,{header:'领取工钱',title:'试餐已做好',description:'交付1份，正式任职并获30金币。',resources:[resource('ration','试餐',p.bag.ration,1)],primary:'交付试餐'});break;
 case 'coat-material':Object.assign(c,{header:'准备外套原料',title:'凝胶',description:p.bag.gel<2?'采购2份凝胶。':'凝胶已备齐，继续经营赚取金币。',art:'bag:gel',resources:p.bag.gel<2?[coins(10)]:[coins(8)],primary:'采购2凝胶'});break;
 case 'coat-craft':Object.assign(c,{header:'制作防具',title:'旅途外套',description:'挂机受击 −1',art:'equipment:trail-coat',resources:[coins(8),gel(2)],primary:'制作'});break;
 case 'coat-wear':Object.assign(c,{header:'穿好再出发',title:'旅途外套',description:'挂机受击 −1',art:'equipment:trail-coat',note:'已制作 · 待穿戴',primary:'穿戴'});break;
 case 'ration-material':Object.assign(c,{header:'准备口粮原料',title:'面粉',description:'采购10份，留作本次与后续补给。',art:'bag:flour',resources:[coins(10)],primary:'采购10面粉'});break;
 case 'ration-craft':Object.assign(c,{header:'备好出行补给',title:'旅行口粮',description:`制作3份 · ${craftTicks('ration',p.business)*3/10}秒`,resources:[flour(6)],primary:'制作'});break;
 case 'ration-wait':Object.assign(c,{header:'备好出行补给',title:'口粮制作中',resources:[ration()],primary:'制作中'});break;
 case 'depart':Object.assign(c,{header:'准备重试',title:regions[0].name,art:'',map:true,resources:[ration()],worn:p.equipment?.slots.body==='trail-coat',note:'勘探 · 独行 · 无料理 · 自动技能关闭',primary:'出发 →'});break;
 case 'running':Object.assign(c,{header:'挂机中 · 自动战斗',title:regions[p.run?.region??0].name,map:true,art:'',description:p.run?`生命${p.run.hp} · 魔物${p.run.enemyHP}/${p.run.enemyMax}`:'',note:p.run?.log??'',primary:'返回野外画面'});break;
 case 'cargo':{const e=readExpedition(p);Object.assign(c,{header:'整理回营收获',title:'远征物资箱',description:e.last?`已结算${e.last.coins}金 · ${e.last.xp}经验 · 已带回${e.last.gel}凝胶`:'金币经验与凝胶已结算。',note:'待入库：'+Object.entries(e.cargo).filter(([,n])=>n).map(([k,n])=>`${EXPEDITION_MATERIALS[k as keyof typeof EXPEDITION_MATERIALS]}${n}`).join(' · '),primary:'货箱入库'});break;}
 case 'crystal-craft':Object.assign(c,{header:'把材料做成商品',title:'魔晶餐',description:`制作1份 · ${craftTicks('crystal',p.business)/10}秒`,art:'bag:crystal',resources:[flour(1),gel(2)],primary:'制作'});break;
 case 'crystal-wait':Object.assign(c,{header:'把材料做成商品',title:'魔晶餐制作中',art:'bag:crystal',primary:'制作中'});break;
 case 'crystal-stock':Object.assign(c,{header:'准备开张',title:'魔晶餐',description:'上架1份，保留其余库存。',art:'bag:crystal',resources:[resource('crystal','魔晶餐',p.bag.crystal,1)],primary:'上架'});break;
 case 'open':Object.assign(c,{header:'迎接第一位顾客',title:'商品已上架',description:`魔晶餐 · 货架${p.business.shelves.crystal.stock}份`,art:'bag:crystal',primary:'开店'});break;
 case 'sale-wait':Object.assign(c,{header:'等待真实成交',title:'魔晶餐',description:`货架${p.business.shelves.crystal.stock}份 · 钱箱${p.business.till}金`,art:'bag:crystal',note:`下次顾客约${Math.ceil(Math.max(0,p.business.shelves.crystal.due-p.tick)/10)}秒`,primary:'营业中'});break;
 case 'collect':Object.assign(c,{header:'开张回款',title:'钱箱',description:`实际货款 ${p.business.till}金币`,art:'bag:crystal',primary:'收款'});break;
 case 'complete':Object.assign(c,{header:'一家店，一次远行',title:'四盏章灯已点亮',description:'到塔中回看这段旅程。',art:'equipment:trail-gloves',primary:'前往塔中 →'});break;
 }
 if((['trial-wait','ration-wait','crystal-wait'] as ChapterStep[]).includes(step)&&p.queue)c.note=`下份剩余${Math.ceil(Math.max(0,p.queue.due-p.tick)/10)}秒 · 可收起等待`;
 return c;
}
