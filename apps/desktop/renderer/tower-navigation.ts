import type {TowerRouteContext} from '../../../packages/solo-core/tower';
import type {ShellState} from '../../../packages/protocol';
/** Reuses existing local navigation buttons. Never dispatches an economic action or focuses input. */
export function towerNavigator(surface:'shop'|'casual',hooks?:{journey:(context:Extract<TowerRouteContext,{kind:'journey'}>)=>void;clear:()=>void}):(state:ShellState)=>void {
 let last=0,lastInventory=0;
 const click=(id:string)=>document.getElementById(id)?.click();
 return state=>{
  const inventory=state.inventoryNavigation;
  if(inventory&&inventory.id!==lastInventory){
   const casual=['kitchen','camp-growth','collection','companions'].includes(inventory.target);
   const ready=surface==='casual'?!!document.getElementById('cCampHome'):!!document.getElementById('roomSceneView');
   if(casual===(surface==='casual')&&ready){
    lastInventory=inventory.id;
    if(casual){document.getElementById('cCampHome')!.hidden=true;document.getElementById('cCampWorkspace')!.hidden=false;const tabs:Record<string,string>={kitchen:'kitchen','camp-growth':'camp',collection:'collection',companions:'friends'};click('cTab-'+tabs[inventory.target]);if(inventory.target==='camp-growth')click('lifeTab-growth');if(inventory.target==='collection')click('cArchiveOld');}
    else{
     const ids:Record<string,string>={'supply-craft':'lsOven','supply-trade':'lsSupplies','supply-specials':'lsRecipes','supply-special-shelves':'lsRecipes','supply-shelves':'lsShelf','alchemy-craft':'alStill','alchemy-shelves':'alShelf','alchemy-study':'alStudy'};
     click(ids[inventory.target]);
     if(inventory.target==='supply-craft')click('shopTabCraft');
     if(inventory.target==='supply-special-shelves')click('aTab-sales');
    }
    document.body.dataset.inventoryDestination=inventory.target;
   }
  }
  const nav=state.towerNavigation;if(!nav){hooks?.clear();delete document.body.dataset.towerDestination;return;}if(nav.id===last)return;
  const casual=['dungeon','garden','companions','kitchen','camp-growth','collection','village-projects'].includes(nav.target);
  if(casual!==(surface==='casual'))return;
  if(surface==='shop'&&!document.getElementById('roomSceneView'))return;
  if(surface==='casual'&&!document.getElementById('cCampHome'))return;
  last=nav.id;
  if(surface==='shop'){
   const ids:Record<string,string>={supply:'lsCounter','supply-job':'lsCounter','supply-craft':'lsOven','supply-trade':'lsSupplies','supply-manage':'lsShelf','supply-orders':'lsOrders',alchemy:'alStill','alchemy-craft':'alStill','alchemy-trade':'alSupplies',ledger:'lsLedger'};
   if(nav.context?.kind==='atelier'){click(nav.context.station==='supply'?'lsRecipes':'alStill');click('aTab-'+nav.context.panel);}else{click(ids[nav.target]??'lsCounter');if(nav.target==='supply-craft')click('shopTabCraft');}
  }else{
   document.getElementById('cCampHome')!.hidden=true;document.getElementById('cCampWorkspace')!.hidden=false;
   const tabs:Record<string,string>={dungeon:'adventure',garden:'garden',companions:'friends',kitchen:'kitchen','camp-growth':'camp',collection:'collection'};
   if(nav.target==='village-projects')click('cVillageShortcut');else click('cTab-'+tabs[nav.target]);
   if(nav.target==='camp-growth')click('lifeTab-growth');if(nav.target==='collection')click('cArchiveOld');
   if(nav.context?.kind==='journey')hooks?.journey(nav.context);
   if(nav.context?.kind==='training'){click('cBuddyPick-'+nav.context.buddy);click('cBuddyView-training');document.getElementById('cBuddyTrain')?.scrollIntoView({block:'nearest'});}
  }
  document.body.dataset.towerDestination=nav.target;
  const marker=surface==='casual'?document.getElementById(nav.context?.kind==='journey'?'cStart':nav.context?.kind==='training'?'cBuddyTrain':'cContent'):document.getElementById(nav.context?.kind==='atelier'?'aPanel-'+nav.context.panel:'roomWorkspace');if(marker){marker.dataset.towerArrival=String(nav.id);marker.scrollIntoView({block:'nearest'});}
 };
}
