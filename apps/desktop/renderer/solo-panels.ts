import {shopGuideMarkup,updateShopGuide,bindShopGuide} from './shop-guide';
import {pictureAttrs,ensurePictureInteriors} from './picture-interiors';
import {atelierMarkup,updateAtelier,bindAtelier} from './atelier-panel';
import type {ShellState} from '../../../packages/protocol';
import {craftTicks,type GameAction,type GameEnvelope} from '../../../packages/solo-core';
import {icon} from './icons';
import {businessMarkup,updateBusiness,bindBusiness} from './business-panel';
import {itemPicture} from './living-scene';
// Refresh labels in place: a worker snapshot must not replace the button under the mouse.
function ensureShopStyles():void{
  if(document.querySelector('link[data-pixelstreet-shop-style]'))return;
  const link=document.createElement('link');link.rel='stylesheet';link.href=new URL('shop.css',document.baseURI).href;link.dataset.pixelstreetShopStyle='true';document.head.append(link);
  if(!document.querySelector('link[data-trade-workspace]')){const trade=document.createElement('link');trade.rel='stylesheet';trade.href=new URL('trade-workspace.css',document.baseURI).href;trade.setAttribute('data-trade-workspace','true');document.head.append(trade);}
}
const shopButton=(id:string,label:string,tip:string,classes=''):string=>`<button id="${id}"${pictureAttrs(id)} class="game-button shop-action ${classes}" type="button" data-tooltip="${tip}">${label}</button>`;
const shopIcon=(name:string):string=>`<span class="shop-icon" aria-hidden="true">${icon(name)}</span>`;
const shopMetric=(name:string,value:string,title:string):string=>`<span class="shop-metric" title="${title}" data-tooltip="${title}">${shopIcon(name)}<strong>${value}</strong></span>`;
const shopMaterial=(id:string,name:string,count:number):string=>`<span class="shop-material tw-ingredient" id="${id}" title="每份所需${name}${count}份" data-tooltip="每份所需${name}${count}份">${itemPicture(name==='面粉'?'flour':'gel')}<span>${name}<strong><b id="${id}Own">0</b> / ${count}</strong></span></span>`;

function recipeCard(id:string,name:string,recipe:string,material:string,time:string,gold:string,action:string):string{
  return `<article id="${id}" class="ls-recipe-card"><div class="ls-recipe-title">${itemPicture(recipe)}<h2>${name}</h2></div><div class="ls-recipe-material">${material}</div><div class="ls-recipe-metrics"><span data-craft-time>${time}</span><span>${gold}<span class="ls-price-label">商人收购</span></span></div><div class="ls-recipe-actions">${action}</div></article>`;
}
export function shopMarkup():string{
  ensureShopStyles();ensurePictureInteriors();
  const business=businessMarkup();
  const tabs=[['shopTabSupply','Supply','采购货摊','材料买卖与快速出货'],['shopTabCraft','Craft','炉灶','配方与批量排产'],['shopTabOrders','Orders','旅人','接取与交付NPC订单'],['shopTabManage','Manage','货架','货架、货款与店铺升级'],['shopTabSpecials','Specials','特色手记','餐盒制作、特色货台与研修']] as const;
  return `<section id="shopUi" class="shop-ui trade-workspace" data-shop-tab="supply"><div class="shop-banner" role="img" aria-label="营地补给店"></div>${business.summary}${shopGuideMarkup()}
    <nav class="shop-tabs" role="tablist" aria-label="商店页面">${tabs.map(([id,key,label,tip],i)=>`<button id="${id}"${pictureAttrs(id)} class="game-button shop-tab" type="button" role="tab" aria-controls="shopPanel${key[0].toUpperCase()+key.slice(1)}" aria-selected="${i===0}" tabindex="${i===0?'0':'-1'}" title="${tip}" data-tooltip="${tip}">${label}</button>`).join('')}</nav>
    <section id="shopPanelSupply" class="shop-panel" role="tabpanel" aria-labelledby="shopTabSupply">${business.supply}</section>
    <section id="shopPanelCraft" class="shop-panel" role="tabpanel" aria-labelledby="shopTabCraft" hidden><div class="ls-recipe-grid">
      ${recipeCard('shopRationRow','旅行口粮','ration',shopMaterial('rationFlourNeed','面粉',2),shopMetric('clock','6秒','每份制作耗时6秒'),shopMetric('gold','5','NPC每份售价5金币'),`${shopButton('craftRation','制作1份','消耗2面粉，制作1份旅行口粮')}${shopButton('craftRations','制作3份','消耗6面粉，制作3份旅行口粮')}`)}
      ${recipeCard('shopCrystalRow','魔晶餐','crystal',`${shopMaterial('crystalFlourNeed','面粉',1)}${shopMaterial('crystalGelNeed','凝胶',2)}`,shopMetric('clock','10秒','每份制作耗时10秒'),shopMetric('gold','14','NPC每份售价14金币'),`${shopButton('craftCrystal','制作1份','消耗1面粉和2凝胶，制作1份魔晶餐')}${shopButton('craftCrystals','制作3份','消耗3面粉和6凝胶，制作3份魔晶餐')}`)}
    </div><p id="queueState" class="shop-live-status" role="status" aria-live="polite"></p>${business.craft}</section>
    <section id="shopPanelOrders" class="shop-panel" role="tabpanel" aria-labelledby="shopTabOrders" hidden>${business.orders}</section>
    <section id="shopPanelManage" class="shop-panel" role="tabpanel" aria-labelledby="shopTabManage" hidden>${business.manage}<div class="tw-counter-operations"><article id="shopRetailRow" class="tw-signboard"><div class="shop-item">${itemPicture('cashbox')}<strong>营业牌</strong></div><div class="shop-rule-material">${shopIcon('ration')}<strong>保留2份</strong></div><div class="tw-operation-metrics">${shopMetric('clock','6秒','每6秒检查并售出至多1份')}${shopMetric('gold','5 / 14','旅行口粮售价5金币；魔晶餐售价14金币')}</div>${shopButton('retailToggle','开启售卖','每6秒检查库存；优先魔晶餐，旅行口粮保留2份，不自动采购')}</article>
 <article id="shopUpgradeRow" class="tw-signboard"><div class="shop-item">${shopIcon('plus')}<strong>远征护符</strong></div><p>攻击 +3 · 生命上限 +10</p><div class="shop-rule-material">${itemPicture('gel')}<strong>5凝胶</strong></div><span class="tw-price-tag">20金币 · 本轮一次</span>${shopButton('upgradeGear','强化护符','消耗20金币和5凝胶；本轮仅可强化一次')}</article></div></section>
    <section id="shopPanelSpecials" class="shop-panel" role="tabpanel" aria-labelledby="shopTabSpecials" hidden>${atelierMarkup('supply')}</section>
    <section id="jobPanel" class="shop-job tw-job-dialogue" aria-labelledby="jobHeading"><span class="ls-person tw-job-clerk" data-person="0" aria-hidden="true"></span><div class="tw-job-bubble"><h2 id="jobHeading">炉边的第一份工作</h2><p id="jobStory" class="shop-job-story"></p><div id="jobActions" class="shop-job-actions">${shopButton('applyJob','应聘学徒','应聘后获赠4面粉；学徒需完成旅行口粮试餐')}${shopButton('trialCraft','制作试餐','消耗2面粉并等待6秒制作1份旅行口粮')}${shopButton('deliverTrial','交付试餐','交付1份旅行口粮，正式任职并获得30金币')}</div></div><div class="tw-trial-tray">${itemPicture('ration')}<span>店员的试餐托盘</span></div></section>
    <p id="gameNotice" class="shop-live-status" role="status" aria-live="polite"></p><p id="shopLoadState" class="shop-live-status" role="alert" hidden></p>
  </section>`;
}
const $=(id:string)=>document.getElementById(id)!;
export function updateShop(state:ShellState,busy:boolean):void{
  lastShopState=state;lastShopBusy=busy;updateAtelier(state,busy);updateShopGuide(state.game.profile??undefined,busy,document.getElementById('shopUi')?.dataset.shopTab==='specials'?'specials':'supply');
  const g=state.game,p=g.profile,root=$('shopUi');
  updateBusiness(p,busy||g.status!=='ready');
  const text=(id:string,value:string)=>{const e=$(id);if(e.textContent!==value)e.textContent=value;};
  const attr=(e:Element,key:string,value:string)=>{if(e.getAttribute(key)!==value)e.setAttribute(key,value);};
  const tip=(e:HTMLElement,value:string)=>{if(e.dataset.tooltip!==value)e.dataset.tooltip=value;};
  if(document.body.dataset.job!==(p?.job??''))document.body.dataset.job=p?.job??'';if(document.body.dataset.sequence!==String(p?.sequence??0))document.body.dataset.sequence=String(p?.sequence??0);
  const load=$('shopLoadState');text('shopLoadState',g.status==='ready'?g.warnings.join(' '):g.error||'正在读取单机存档……');if(load.hidden!==!load.textContent)load.hidden=!load.textContent;
  const action=(id:string,label:string,tip:string,eligible:boolean,reason='',visible=true):void=>{const b=$(id)as HTMLButtonElement;if(b.hidden!==!visible)b.hidden=!visible;text(id,label);const why=busy?'操作提交中，请稍候。':g.status!=='ready'?(g.error||'单机存档暂不可用。'):!eligible?reason:'';if(b.disabled!==!!why)b.disabled=!!why;if(b.dataset.tooltip!==(why||tip))b.dataset.tooltip=why||tip;attr(b,'aria-label',label);};
  if(!p){for(const b of Array.from(root.querySelectorAll<HTMLButtonElement>('.shop-action')))action(b.id,b.textContent||'操作',g.error||'等待单机存档就绪。',false,g.error||'等待单机存档就绪。');if(!$('jobActions').hidden)$('jobActions').hidden=true;text('jobStory','正在读取任职状态…');text('gameNotice','');text('queueState','');if($('jobPanel').hidden)$('jobPanel').hidden=false;return;}
  if($('jobActions').hidden)$('jobActions').hidden=false;
  const roleStory=p.job==='visitor'?'先应聘学徒，获赠4份面粉。':p.job==='apprentice'?'制作1份旅行口粮并交付试餐，正式任职后获得30金币。':'已任职补给店员。';text('jobStory',roleStory);if($('jobPanel').hidden!==(p.job==='keeper'))$('jobPanel').hidden=p.job==='keeper';
  const bag=p.bag,queue=p.queue;
  for(const [row,recipe] of [['shopRationRow','ration'],['shopCrystalRow','crystal']] as const){const metric=$(row).querySelector<HTMLElement>('[data-craft-time] .shop-metric');if(metric){metric.querySelector('strong')!.textContent=`${craftTicks(recipe,p.business)/10}秒`;tip(metric,`当前每份制作耗时${craftTicks(recipe,p.business)/10}秒`);}}
  const shortage=(flour:number,gel:number):string=>{const missing:string[]=[];if(bag.flour<flour)missing.push(`缺少面粉${flour-bag.flour}`);if(bag.gel<gel)missing.push(`缺少凝胶${gel-bag.gel}`);return missing.join('、');};
  const craftReason=(recipe:'ration'|'crystal',count:1|3):string=>{
    if(p.job==='visitor')return '请先应聘学徒。';
    if(p.job==='apprentice'&&(recipe!=='ration'||count!==1))return '学徒需先完成单份旅行口粮试餐。';
    if(queue)return '当前制作完成后再开始下一份。';
    const needFlour=(recipe==='ration'?2:1)*count,needGel=(recipe==='crystal'?2:0)*count,full=bag[recipe]+count+(recipe==='ration'?(p.run?.remaining??0):0)>1e6;
    if(full)return '该物品库存已满，无法继续制作。';return shortage(needFlour,needGel);
  };
  const setMissing=(id:string,missing:boolean,tip:string):void=>{const el=$(id);el.classList.toggle('is-missing',missing);if(el.dataset.tooltip!==tip)el.dataset.tooltip=tip;};
  text('rationFlourNeedOwn',String(bag.flour));text('crystalFlourNeedOwn',String(bag.flour));text('crystalGelNeedOwn',String(bag.gel));
  const rationMissing=bag.flour<2,crystalFlourMissing=bag.flour<1,crystalGelMissing=bag.gel<2;
  setMissing('rationFlourNeed',rationMissing,rationMissing?`缺少面粉${2-bag.flour}`:'每份需要2份面粉');
  setMissing('crystalFlourNeed',crystalFlourMissing,crystalFlourMissing?`缺少面粉${1-bag.flour}`:'每份需要1份面粉');
  setMissing('crystalGelNeed',crystalGelMissing,crystalGelMissing?`缺少凝胶${2-bag.gel}`:'每份需要2份凝胶');
  action('applyJob','应聘学徒','应聘后获赠4份面粉；学徒需完成旅行口粮试餐',p.job==='visitor','已完成任职。',p.job==='visitor');
  action('trialCraft','制作试餐','消耗2面粉并等待6秒制作1份旅行口粮',p.job==='apprentice'&&!queue&&bag.flour>=2,p.job!=='apprentice'?'先应聘学徒。':queue?'当前制作完成后再制作试餐。':shortage(2,0),p.job==='apprentice');
  action('deliverTrial','交付试餐','交付1份旅行口粮，正式任职并获得30金币',p.job==='apprentice'&&bag.ration>0,p.job!=='apprentice'?'只有学徒可以交付试餐。':'需要1份旅行口粮。',p.job==='apprentice');
  action('buyFlour','采购10份','花费10金币采购10份面粉',p.job==='keeper'&&p.coins>=10&&bag.flour<=1e6-10,p.job!=='keeper'?'正式任职后才能采购。':p.coins<10?'缺少10金币。':bag.flour>1e6-10?'面粉库存已满。':'');
  action('craftRation','制作1份','消耗2面粉，制作1份旅行口粮',!craftReason('ration',1),craftReason('ration',1));
  action('craftRations','制作3份','消耗6面粉，制作3份旅行口粮',!craftReason('ration',3),craftReason('ration',3));
  action('craftCrystal','制作1份','消耗1面粉和2凝胶，制作1份魔晶餐',!craftReason('crystal',1),craftReason('crystal',1));
  action('craftCrystals','制作3份','消耗3面粉和6凝胶，制作3份魔晶餐',!craftReason('crystal',3),craftReason('crystal',3));
  const retailTip=p.business.managed?'只出售货架商品，货款存入钱箱，不自动补货。':'每6秒检查背包；优先魔晶餐，旅行口粮保留2份。上架后切换为货架经营。';action('retailToggle',p.retail?'关店':'开店',retailTip,p.job==='keeper',p.job!=='keeper'?'正式任职后才能管理售卖。':'');attr($('retailToggle'),'aria-pressed',String(p.retail));attr($('shopRetailRow'),'data-active',String(p.retail));
  const retailRow=$('shopRetailRow');const material=retailRow.querySelector<HTMLElement>('.shop-rule-material strong')!;material.textContent=p.business.managed?'只卖货架':'背包留2份';const metrics=retailRow.querySelectorAll<HTMLElement>('.shop-metric strong');metrics[0].textContent=p.business.managed?'18–60秒':'6秒';metrics[1].textContent=p.business.managed?'看定价':'5 / 14';
  tip(retailRow.querySelector<HTMLElement>('.shop-item')!,retailTip);
  tip(retailRow.querySelectorAll<HTMLElement>('.shop-metric')[0],p.business.managed?'按各商品定价，每18、30或60秒成交一份。':'每6秒检查背包并售出至多1份。');
  tip(retailRow.querySelectorAll<HTMLElement>('.shop-metric')[1],p.business.managed?'每件收入以货架当前定价为准，货款存入钱箱。':'旅行口粮5金币，魔晶餐14金币。');
  tip(retailRow.querySelector<HTMLElement>('.shop-rule-material')!,p.business.managed?'只出售手动上架数量，不动背包库存。':'旅行口粮在背包保留2份。');
  const upgradeReason=p.job!=='keeper'?'正式任职后才能强化。':p.upgraded?'本轮已强化，不可重复。':p.run?'请先回营结算远征。':p.coins<20?'缺少20金币。':bag.gel<5?`缺少凝胶${5-bag.gel}。`:'';
  action('upgradeGear',p.upgraded?'已强化':'强化护符','消耗20金币和5凝胶；本轮仅可强化一次',!upgradeReason,upgradeReason);
  const upgradeMaterial=$('shopUpgradeRow').querySelector<HTMLElement>('.shop-rule-material')!;upgradeMaterial.classList.toggle('is-missing',bag.gel<5);tip(upgradeMaterial,bag.gel<5?`缺少凝胶${5-bag.gel}`:'强化需要5份凝胶');
  text('queueState',queue?`制作中 · ${queue.recipe==='ration'?'旅行口粮':'魔晶餐'} · 还需${Math.max(0,Math.ceil((queue.due-p.tick)/10))}秒`:'');
  text('gameNotice',p.notice);
}
let lastShopState:ShellState,lastShopBusy=false;
export function bindShop(send:(a:GameAction)=>void):void{
  $('shopUi').insertBefore($('jobPanel'),$('shopUi').querySelector('.shop-tabs'));
  bindShopGuide(()=>lastShopState?.game.profile??undefined,()=>document.getElementById('shopUi')?.dataset.shopTab==='specials'?'specials':'supply');
  bindBusiness(send);
  bindAtelier('supply',()=>lastShopState,send);
  const tabs=[['shopTabSupply','shopPanelSupply','supply'],['shopTabCraft','shopPanelCraft','craft'],['shopTabOrders','shopPanelOrders','orders'],['shopTabManage','shopPanelManage','manage'],['shopTabSpecials','shopPanelSpecials','specials']] as const;
  const activate=(key:string,focus=false):void=>{const selected=tabs.find(([, ,value])=>value===key)??tabs[0];$('shopUi').setAttribute('data-shop-tab',selected[2]);document.querySelector<HTMLElement>('.popover-content')!.scrollTop=0;for(const[id,panel]of tabs){const active=id===selected[0],tab=$(id)as HTMLButtonElement;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;$(panel).hidden=!active;if(active&&focus)tab.focus();}if(lastShopState)updateShopGuide(lastShopState.game.profile??undefined,lastShopBusy,selected[2]==='specials'?'specials':'supply');};
  for(const[id,,key]of tabs){const tab=$(id)as HTMLButtonElement;tab.addEventListener('click',()=>activate(key));tab.addEventListener('keydown',event=>{if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight')return;event.preventDefault();const index=tabs.findIndex(([tabId])=>tabId===id),next=(index+(event.key==='ArrowRight'?1:tabs.length-1))%tabs.length;activate(tabs[next][2],true);});}
  const actions=[['craftRation',{type:'craft',recipe:'ration',count:1}],['craftRations',{type:'craft',recipe:'ration',count:3}],['craftCrystal',{type:'craft',recipe:'crystal',count:1}],['craftCrystals',{type:'craft',recipe:'crystal',count:3}],['buyFlour',{type:'buy-flour'}],['upgradeGear',{type:'upgrade'}],['applyJob',{type:'apply-job'}],['trialCraft',{type:'craft',recipe:'ration',count:1}],['deliverTrial',{type:'deliver-trial'}]] as const;
  for(const[id,action]of actions)$(id).addEventListener('click',()=>send(action));
  $('retailToggle').addEventListener('click',()=>send({type:'retail',enabled:$('retailToggle').getAttribute('aria-pressed')!=='true'}));
}
export function envelope(state:ShellState,action:GameAction):GameEnvelope{if(!state.game.profile)throw Error('单机存档尚未就绪');return{sequence:state.game.profile.sequence+1,requestId:crypto.randomUUID(),action};}

export {adventureMarkup,updateAdventure,bindAdventure} from './expedition-panel';
