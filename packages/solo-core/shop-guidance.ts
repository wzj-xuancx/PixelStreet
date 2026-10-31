import type {Profile} from './index';
import {businessReason} from './business';
import {atelierOf,atelierReason,FORMULAS,GOOD_IDS,MARKET,reagentCount,REAGENT_NAMES,type Good,type Station,type Reagent} from './atelier';
export type ShopGuideDestination='apply'|'trial-craft'|'trial-deliver'|'craft'|'stock'|'open'|'collect'|'supplies'|'market'|'wait';
export interface ShopStep {id:string;title:string;reason:string;destination:ShopGuideDestination;good?:Good;recipe?:'ration'|'crystal'}
const step=(id:string,title:string,destination:ShopGuideDestination,reason=''):ShopStep=>({id,title,destination,reason});
/** Read-only projection. Defaults are never installed and this never starts business work. */
export function nextShopStep(p:Profile,shop:'supply'|'specials'|'alchemy'='supply'):ShopStep {
 if(shop==='alchemy'&&p.job!=='keeper')return step('job','完成补给店任职','wait',atelierReason(p,{type:'atelier-craft',good:'dew',count:1}));
 if(p.job==='visitor')return step('apply','应聘学徒','apply');
 if(p.job==='apprentice'){
  if(p.bag.ration>0)return step('deliver','交付试餐','trial-deliver');
  if(p.queue)return step('trial-wait','等待试餐出炉','wait','当前制作完成后再交付试餐。');
  return step('trial-craft','制作1份试餐','trial-craft',p.bag.flour<2?'缺少面粉，补给旅商的原料货摊可采购。':'');
 }
 if(shop==='supply'){
  const b=p.business;
  if(b.till)return step('collect','收取货款','collect',businessReason(p,{type:'collect-till'}));
  if(b.shelves.ration.stock+b.shelves.crystal.stock){if(!p.retail)return step('open','开店迎客','open');return step('sale-wait','等待货架成交','wait','营业中，下一笔货款会进入钱箱。');}
  const recipe=p.bag.ration?'ration':p.bag.crystal?'crystal':undefined;
  if(recipe)return {...step('stock','把成品上架','stock',businessReason(p,{type:'stock-shelf',recipe,count:1})),recipe};
  if(p.queue||b.pending.length)return step('craft-wait','等待成品出炉','wait','制作完成后，把背包成品放上货架。');
  const reason=businessReason(p,{type:'queue-craft',recipe:'ration',count:1});
  return step('craft','制作旅行口粮',reason==='制作材料不足。'?'supplies':'craft',reason==='制作材料不足。'?'面粉不足，前往旅商采购。':reason);
 }
 const station:Station=shop==='alchemy'?'alchemy':'supply',a=atelierOf(p),goods=GOOD_IDS.filter(g=>FORMULAS[g].station===station);
 if(a.till)return step('collect','收取特色货款','collect',atelierReason(p,{type:'atelier-collect'}));
 if(goods.some(g=>a.shelves[g].stock))return !a.open[station]?step('open','本站开业','open',atelierReason(p,{type:'atelier-open',station,open:true})):step('sale-wait','等待特色货台成交','wait','本站营业中，下一笔货款会进入特色钱箱。');
 const good=goods.find(g=>a.stock[g]>0);
 if(good)return {...step('stock','把特色成品上架','stock',atelierReason(p,{type:'atelier-stock',good,count:1})),good};
 if(a.queues[station].length)return step('craft-wait','等待特色成品入库','wait','制作托盘按份完成，再把成品上架。');
 const first=goods[0],reason=atelierReason(p,{type:'atelier-craft',good:first,count:1});
 if(reason==='配方材料不足。'){
  const missing=(Object.keys(FORMULAS[first].cost) as Reagent[]).filter(r=>reagentCount(p,r)<FORMULAS[first].cost[r]!);
  const market=missing.find(r=>Object.hasOwn(MARKET,r));
  return {...step('craft','备齐特色配方材料',market?'market':'craft',market?`${REAGENT_NAMES[market]}不足，可在原料货摊采购。`:'凝胶来自普通探索；面粉在补给旅商采购。'),good:first};
 }
 return {...step('craft','制作1份特色成品','craft',reason),good:first};
}
export const shopFlowLines=['应聘学徒，领取试餐面粉。','制作1份旅行口粮，等待出炉。','交付试餐，正式任职。','制作成品，手动放上货架。','开店迎客，等待货架成交。','收取钱箱货款，继续经营。'] as const;
export function shopFlowIndex(p:Profile):number {const s=nextShopStep(p);return s.id==='apply'?0:s.id==='trial-craft'||s.id==='trial-wait'?1:s.id==='deliver'?2:s.id==='collect'?5:s.id==='open'||s.id==='sale-wait'?4:3;}
