/** Picture controls use persistent pseudo-elements, so label refreshes never replace a target. */
export function ensurePictureInteriors():void {
 if(typeof document==='undefined'||document.querySelector('link[data-picture-interiors]'))return;
 const link=document.createElement('link');link.rel='stylesheet';link.href=new URL('picture-interiors.css',document.baseURI).href;link.dataset.pictureInteriors='true';document.head.append(link);
}
export function pictureAttrs(id:string):string {
 ensurePictureInteriors();
 const nav:Record<string,[string,string]>={shopTabSupply:['material','flour'],shopTabCraft:['facility','oven'],shopTabOrders:['npc','merchant'],shopTabManage:['facility','shelves'],shopTabSpecials:['object','book'],'aTab-craft':['facility','still'],'aTab-sales':['facility','counter'],'aTab-study':['object','book'],'lifeTab-growth':['building','lodge'],'lifeTab-overview':['facility','workbench'],'lifeTab-production':['object','pot'],'lifeTab-jobs':['npc','courier'],'lifeTab-crew':['object','ledger'],'cBuddyView-company':['object','ledger'],'cBuddyView-training':['object','book'],'cBuddyView-story':['object','book']};
 let choice=nav[id],place=!!choice;
 if(!choice){
 if(/^lifeWorkplace-/.test(id)){const j=id.split('-')[1];choice=j==='garden'?['crop','pumpkin']:['facility',j==='counter'?'counter':'workbench'];place=true;}
 else if(/^(craftRation|craftRations|trialCraft|deliverTrial|queueRation)$/.test(id))choice=['material','ration'];
 else if(/^(craftCrystal|craftCrystals|queueCrystal)$/.test(id))choice=['material','crystal'];
 else if(/^(buyFlour|merchantBuy|merchantBulk|merchantSell|aBuy)/.test(id))choice=['material',id==='buyFlour'?'flour':id.split('-')[1]];
 else if(/^price-(ration|crystal)-/.test(id))choice=['material',id.split('-')[1]];
 else if(/^aPrice-/.test(id))choice=['good','picnic'];
 else if(/^(stock|stockAll|unstock)-/.test(id))choice=['material',id.split('-')[1]];
 else if(/^(aCraft|aUse|aStock|aStockAll|aUnstock)$/.test(id))choice=['good','picnic'];
 else if(/^(aDeliver|deliverOrder)/.test(id))choice=['object','pot'];
 else if(/^(aAccept|acceptOrder|applyJob)/.test(id))choice=['npc','courier'];
 else if(/^(aAbandon|cancelOrder|aCancel|cancelProduction|lifeCancelFood)/.test(id))choice=['object','ledger'];
 else if(/(Collect|collectTill|lifeGift|Mastery)/.test(id))choice=['object','cashbox'];
 else if(/^(aUpgrade|shopUpgrade)-/.test(id))choice=['facility',id.split('-')[1]==='kitchen'?'oven':id.split('-')[1]];
 else if(/^(aOpen|retailToggle)$/.test(id))choice=['facility','counter'];
 else if(/^lifeCook/.test(id))choice=['food','biscuit'];
 else if(/^life(Repeat|Available)-/.test(id)){const station=id.split('-')[1];choice=station==='kitchen'?['food','biscuit']:station==='alchemy'?['good','dew']:station==='supply'?['good','picnic']:['material','ration'];}
 else if(/^life(PlanStart|PlanStop|Redeploy|PresetSave|PresetLoad)/.test(id))choice=['object','ledger'];
 else if(/^life(Assign|Quest)-/.test(id))choice=['object','book'];
 else if(/^cBuddy(Recruit|Lead|Support)$/.test(id))choice=['npc','courier'];
 else if(id==='cBuddyFeed')choice=['food','biscuit'];
 else if(/^cBuddy(Train|Story)/.test(id))choice=['object','book'];
 else if(/^cCharm(Equip|Upgrade)$/.test(id))choice=['rarity','0'];
 else if(/^cLetterSupplies/.test(id))choice=['crop','herb'];
 else if(/^cLetterNotes/.test(id))choice=['material','dust'];
 else if(/^cLetterTokens/.test(id))choice=['object','book'];
 else if(id==='upgradeGear')choice=['material','crystal'];
 }
 return choice?` data-pi-kind="${choice[0]}" data-pi-art="${choice[1]}" data-pi-control="${place?'place':'object'}"`:'';
}
export function pictureArt(id:string,kind:string,art:string|number):void {const e=document.getElementById(id);if(e){e.dataset.piKind=kind;e.dataset.piArt=String(art);}}
