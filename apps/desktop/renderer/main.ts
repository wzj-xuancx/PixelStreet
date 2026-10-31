import {APP_NAME} from '../identity';
import {installGameButtons} from './game-button';
import type { StreetAPI } from '../../../packages/protocol';
declare global { interface Window { street: StreetAPI } }
const root=document.getElementById('root')!;
const page=new URL(location.href).searchParams.get('page');
async function start():Promise<void>{
 document.title=APP_NAME+' · 行囊与同行成长';
 installGameButtons();
 if(!window.street){root.textContent='请从原生桌面程序打开；浏览器预览不构成桌面验收。';return;}
 if(page==='recovery'){
  document.body.classList.add('recovery');
  const {iconButton}=await import('./icons');
  root.innerHTML=iconButton('recoverArrow','left','恢复营地（展示态）');
  document.getElementById('recoverArrow')!.addEventListener('click',()=>{void window.street.command({type:'restore'}).catch(error=>{root.title=String(error);});});
 }else if(page==='tower'){const {towerPage}=await import('./tower');await towerPage();}
 else if(page==='casual'){const {casualPage}=await import('./casual');await casualPage();}
 else if(page==='arena'){const {dungeonPage}=await import('./dungeon');await dungeonPage();}
 else if(page==='inventory'){const {inventoryPage}=await import('./inventory');await inventoryPage();}
 else if(page==='popover'){const {popoverPage}=await import('./popover');await popoverPage();}
 else{const {overlayPage}=await import('./overlay');await overlayPage();}
}
void start().catch(error=>{console.error(error);root.textContent='样片初始化失败：'+String(error);});
