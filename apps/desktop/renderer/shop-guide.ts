import {nextShopStep,type Profile,type ShopStep} from '../../../packages/solo-core';
import {GameButton} from './game-button';
const $=(id:string)=>document.getElementById(id);
export function shopGuideMarkup():string {return `<details id="shopGuide" class="shop-next-step" open><summary>下一步 · <span id="shopGuideTitle">读取经营进度</span><span class="shop-guide-fold">展开 / 收起</span></summary><div class="shop-guide-action"><button type="button" id="shopGuideGo" class="game-button" data-tooltip="前往现有操作位置">前往</button><p id="shopGuideReason"></p></div></details>`;}
export function updateShopGuide(p:Profile|undefined,busy:boolean,shop:'supply'|'specials'|'alchemy'):void {
 if(!$('shopGuide'))return;const b=$('shopGuideGo') as HTMLButtonElement,s=p?nextShopStep(p,shop):undefined;
 $('shopGuideTitle')!.textContent=s?.title??'等待营地档案';$('shopGuideReason')!.textContent=s?.reason??'';$('shopGuideReason')!.hidden=!s?.reason;
 b.disabled=busy||!s||s.destination==='wait';b.textContent=s?.destination==='wait'?'等待中':'前往';b.dataset.tooltip=busy?'操作提交中。':s?.destination==='wait'?s.reason:'前往现有操作位置';GameButton.enhance(b);
}
/** Navigation only: the highlighted existing button still needs a deliberate player click. */
export function bindShopGuide(profile:()=>Profile|undefined,shop:()=> 'supply'|'specials'|'alchemy'):void {
 $('shopGuideGo')?.addEventListener('click',()=>{const p=profile();if(!p)return;const page=shop(),s=nextShopStep(p,page);if(s.destination==='wait')return;
  const click=(id:string)=>$(id)?.click();
  if(page==='supply'){
   const tab=['apply','trial-craft','trial-deliver'].includes(s.destination)?'Supply':s.destination==='craft'?'Craft':s.destination==='supplies'?'Supply':'Manage';click('shopTab'+tab);if(s.destination==='craft')document.querySelector<HTMLButtonElement>('[data-batch="1"]')?.click();
  }else {if(page==='specials')click('shopTabSpecials');click('aTab-'+(['stock','open','collect'].includes(s.destination)?'sales':'craft'));if(s.good)click('aPick-'+s.good);if(s.destination==='craft')click('aQty1');}
  let id=destinationId(s,page);
  if(s.destination==='market'){const details=document.querySelector<HTMLDetailsElement>('#atelierUi .a-market');if(details){details.open=true;id='';details.scrollIntoView({block:'nearest'});}}
  const target=id?$(id):undefined;if(target){target.scrollIntoView({block:'nearest'});target.classList.add('guide-destination');setTimeout(()=>target.classList.remove('guide-destination'),2200);}
 });
}
function destinationId(s:ShopStep,page:'supply'|'specials'|'alchemy'):string {
 const regular:Record<string,string>={apply:'applyJob','trial-craft':'trialCraft','trial-deliver':'deliverTrial',craft:'queueRation',stock:'stockAll-'+(s.recipe??'ration'),open:'retailToggle',collect:'collectTill',supplies:'buyFlour'};
 if(['apply','trial-craft','trial-deliver'].includes(s.destination))return regular[s.destination];
 return page==='supply'?regular[s.destination]??'':({craft:'aCraft',stock:'aStockAll',open:'aOpen',collect:'aCollect'} as Record<string,string>)[s.destination]??'';
}
