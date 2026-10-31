import {bindPartyAdventure} from './expedition-panel';
import {chapterView} from '../../../packages/solo-core';
import {bindChapterPanel} from './chapter-panel';
import {ensureChapterStyle} from './chapter-controller';
import {shopFlowLines,shopFlowIndex} from '../../../packages/solo-core/shop-guidance';
import {towerNavigator} from './tower-navigation';
import {ensureInteriorPolish} from './interior-polish';
import {bindActionFeedback} from './action-feedback';
import {commandErrorText} from './command-error';
import {villageMarkup,bindVillage,type VillageView} from './village-ui';
import {artMarkup} from './inner-art';
import {ensureInnerArt} from './inner-art';
import {alchemySceneMarkup,bindAlchemyScene} from './alchemy-scene';
import {campLifeMarkup,bindCampLife} from './camp-life-ui';
import {livingShopMarkup,bindLivingShop,type RoomTarget} from './living-scene';
import {atelierMarkup,bindAtelier,updateAtelier} from './atelier-panel';
import {shopMarkup,updateShop,bindShop,envelope,adventureMarkup,updateAdventure,bindAdventure} from './solo-panels';
import type {GameAction} from '../../../packages/solo-core';
import { defaults, heightPresets, type Settings, type ShellState } from '../../../packages/protocol';
import { composerKey, validLocalText } from '../../../packages/protocol/input';
import { icon, iconButton } from './icons';
import { bindRoom, roomMarkup, updateRoom, type RoomPanelCommand } from './room';
const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const errorText=commandErrorText;
export async function popoverPage():Promise<void>{
  const navigateTower=towerNavigator('shop');
  document.body.classList.add('popover');let state:ShellState,generation=0,composing=false,endedAt=-Infinity;
  const report=(e:unknown)=>{const el=document.getElementById('popupError');if(el)el.textContent=errorText(e);};
  const run=(p:Promise<unknown>)=>{void p.catch(report);};
  const close=()=>run(window.street.command({type:'close-popup',generation}));
  const header=(title:string)=>`<header class="${state.popup?.kind==='shop'||state.popup?.kind==='alchemy'?'panel-drag':''}"><h1>${state.popup?.kind==='shop'||state.popup?.kind==='alchemy'?`<span class="inner-room-mark" aria-hidden="true">${icon(state.popup.kind==='shop'?'ration':'gel')}</span>`:''}${title}</h1>${iconButton('popupClose','close','收起面板')}</header>`;
  const click=(id:string,fn:()=>void)=>$(id).addEventListener('click',fn);
  let chapterUi:ReturnType<typeof bindChapterPanel>|undefined;
  let lifeUi:ReturnType<typeof bindCampLife>|undefined;let villageUi:ReturnType<typeof bindVillage>|undefined;
  let livingUi:ReturnType<typeof bindLivingShop>|undefined;let actionFeedback:ReturnType<typeof bindActionFeedback>|undefined;
  let gameBusy=false,roomBusy=false;const updateGame=()=>{if(state.popup?.kind==='chapter'){chapterUi?.update();return;}if(state.popup?.kind==='alchemy')updateAtelier(state,gameBusy);else if(state.popup?.kind==='shop')updateShop(state,gameBusy);else if(state.popup?.kind==='adventure')updateAdventure(state,gameBusy);else if(state.popup?.kind==='room')updateRoom(state,roomBusy);lifeUi?.reflect();livingUi?.reflect();villageUi?.reflect();actionFeedback?.sync();};
  async function gameSend(action:GameAction):Promise<void>{if(gameBusy)return;const own=generation,feedback=actionFeedback,token=feedback?.begin()??0;gameBusy=true;updateGame();try{const next=await window.street.command({type:'game',generation:own,envelope:envelope(state,action)});if(generation===own){apply(next);$('popupError').textContent='';feedback?.finish(token,true,next.game.profile?.notice??'');}}catch(e){if(generation===own){feedback?.finish(token,false,errorText(e));throw e;}}finally{if(generation===own){gameBusy=false;updateGame();}}}
  const management=(regular:string)=>`<div class="life-switch"><button type="button" id="lifeOpen" class="game-button" data-tooltip="查看所有工坊、收款和营地成长">${artMarkup('object','ledger')}营地手账</button><button type="button" id="roomVillageProjects" class="game-button" data-tooltip="查看连续建设目标">${artMarkup('project','teahouse')}<span>营地建设</span></button><button type="button" id="roomVillageRegulars" class="game-button" data-tooltip="点常客和餐点接待">${artMarkup('regular','herbalist')}<span>常客茶席</span></button><button type="button" id="roomVillagePlans" class="game-button" data-tooltip="安排有限制作和上架">${artMarkup('object','pot')}<span>经营安排</span></button></div><div id="lifeRegular">${regular}</div><div id="lifePanel" hidden>${campLifeMarkup('management')}</div><div id="roomVillagePanel" hidden>${villageMarkup()}</div>`;
  function bindManagement():void {
    lifeUi=bindCampLife({profile:()=>state.game.profile??undefined,busy:()=>gameBusy,dispatch:a=>run(gameSend(a))});
    const toggle=(open:boolean)=>{$('roomWorkspace').dataset.workspaceView=open?'ledger':'regular';$('roomVillagePanel').hidden=true;$('lifePanel').hidden=!open;$('lifeRegular').hidden=open;$('lifeOpen').hidden=open;$('lifeBack').hidden=!open;document.querySelector<HTMLElement>('.popover-content')!.scrollTop=0;};
    villageUi=bindVillage({profile:()=>state.game.profile??undefined,busy:()=>gameBusy,state:()=>state,dispatch:a=>run(gameSend(a)),canNavigate:target=>target==='kitchen'||target===(state.popup?.kind==='alchemy'?'alchemy':'supply'),navigate:target=>{if(target==='kitchen'){toggle(true);$('lifeTab-production').click();}else{toggle(false);if(state.popup?.kind==='shop')$('shopTabSpecials').click();$('aTab-craft').click();}}});
    const openVillage=(view:VillageView)=>{$('roomWorkspace').dataset.workspaceView='village';$('roomWorkspaceTitle').textContent='营地生活';$('lifePanel').hidden=true;$('lifeRegular').hidden=true;$('roomVillagePanel').hidden=false;$('lifeBack').hidden=false;$('lifeOpen').hidden=false;villageUi?.open(view,view==='plans'?{station:state.popup?.kind==='alchemy'?'alchemy':'supply'}:undefined);document.querySelector<HTMLElement>('.popover-content')!.scrollTop=0;};
    click('roomVillageProjects',()=>openVillage('projects'));click('roomVillageRegulars',()=>openVillage('regulars'));click('roomVillagePlans',()=>openVillage('plans'));
    click('lifeOpen',()=>{toggle(true);$('roomWorkspaceTitle').textContent='营地手账';});click('lifeBack',()=>{toggle(false);$('roomWorkspaceTitle').textContent=state.popup?.kind==='shop'?'补给工作台':'炼金工作台';});lifeUi.reflect();
  }
  function roomStyles():void{ensureInnerArt();if(!document.querySelector('link[data-village-integration]')){const link=document.createElement('link');link.rel='stylesheet';link.href=new URL('village-integration.css',document.baseURI).href;link.dataset.villageIntegration='true';document.head.append(link);}if(!document.querySelector('link[data-inner-shell]')){const link=document.createElement('link');link.rel='stylesheet';link.href=new URL('inner-shell.css',document.baseURI).href;link.dataset.innerShell='true';document.head.append(link);}}
  function shop():void{
    roomStyles();
    if(!document.querySelector('link[data-living]')){const link=document.createElement('link');link.rel='stylesheet';link.href=new URL('living-scene.css',document.baseURI).href;link.dataset.living='true';document.head.append(link);}
    $('root').innerHTML=`<section class="popover-shell"><div class="popover-content">${header('炉边补给店')}<div id="roomSceneView">${livingShopMarkup('supply')}</div><div id="roomWorkspace" class="ls-workspace" hidden><div class="ls-workspace-head"><button type="button" id="roomBack" class="game-button" data-tooltip="回到可交互的店内场景">← 返回店内</button><button type="button" id="lifeBack" class="game-button" data-tooltip="返回本店配方与交易" hidden>← 返回本店</button><strong id="roomWorkspaceTitle"></strong></div>${management(shopMarkup())}</div><div id="popupError" class="error" role="alert"></div></div></section>`;
    bindShop(a=>run(gameSend(a)));bindManagement();
    const open=(target:RoomTarget,slot?:number)=>{
      $('roomSceneView').hidden=true;$('roomWorkspace').hidden=false;document.querySelector<HTMLElement>('.popover-content')!.scrollTop=0;if($('lifeRegular').hidden)$('lifeBack').click();
      const titles:Record<RoomTarget,string>={counter:'店员与原料',supplies:'原料交易',craft:'炉灶制作',shelf:'货架与经营',orders:'旅人的委托',specials:'特色餐盒',study:'设施与研修',overview:'营地经营手账'};
      $('roomWorkspaceTitle').textContent=titles[target];
      const tab=target==='craft'?'Craft':target==='shelf'?'Manage':target==='orders'?'Orders':target==='specials'||target==='study'?'Specials':'Supply';$('shopTab'+tab).click();
      if(target==='study')$('aTab-study').click();if(target==='specials')$('aTab-craft').click();if(target==='overview'){$('lifeOpen').click();$('lifeTab-overview').click();}
      if(target==='counter'&&state.game.profile?.job!=='keeper')$('jobPanel').scrollIntoView({block:'nearest'});
      if(target==='orders'&&slot!==undefined)$('order-'+slot).scrollIntoView({block:'nearest'});
      livingUi?.reflect();
    };
    click('roomBack',()=>{$('roomWorkspace').hidden=true;$('roomSceneView').hidden=false;document.querySelector<HTMLElement>('.popover-content')!.scrollTop=0;livingUi?.reflect();});
    livingUi=bindLivingShop({station:'supply',state:()=>state,busy:()=>gameBusy,open,dispatch:a=>run(gameSend(a))});updateShop(state,gameBusy);for(const[id,title]of [['Supply','采购货摊'],['Craft','炉灶制作'],['Orders','旅人委托'],['Manage','货架经营'],['Specials','特色工坊']])click('shopTab'+id,()=>{$('roomWorkspaceTitle').textContent=title;});ensureInteriorPolish();actionFeedback=bindActionFeedback({host:document.body,state:()=>state});
  }
  function alchemy():void{
    roomStyles();
    for(const name of ['living-scene','alchemy-scene'])if(!document.querySelector('link[data-scene="'+name+'"]')&&!document.querySelector(name==='living-scene'?'link[data-living]':'link[data-alchemy]')){const link=document.createElement('link');link.rel='stylesheet';link.href=new URL(name+'.css',document.baseURI).href;link.dataset.scene=name;if(name==='living-scene')link.dataset.living='true';else link.dataset.alchemy='true';document.head.append(link);}
    $('root').innerHTML=`<section class="popover-shell"><div class="popover-content">${header('水晶炼金工坊')}<div id="roomSceneView">${alchemySceneMarkup()}</div><div id="roomWorkspace" class="ls-workspace" hidden><div class="ls-workspace-head"><button type="button" id="roomBack" class="game-button" data-tooltip="回到可交互的炼金工坊">← 返回店内</button><button type="button" id="lifeBack" class="game-button" data-tooltip="返回本店配方与交易" hidden>← 返回本店</button><strong id="roomWorkspaceTitle"></strong></div>${management(atelierMarkup('alchemy'))}</div><div id="popupError" class="error" role="alert"></div></div></section>`;
    bindAtelier('alchemy',()=>state,a=>run(gameSend(a)));bindManagement();
    const open=(target:string,slot?:number)=>{
      $('roomSceneView').hidden=true;$('roomWorkspace').hidden=false;document.querySelector<HTMLElement>('.popover-content')!.scrollTop=0;if($('lifeRegular').hidden)$('lifeBack').click();
      const titles:Record<string,string>={counter:'炼金师与调配',supplies:'炼金原料',craft:'调配与排产',specials:'炼金配方',shelf:'药剂货架与定价',orders:'旅人的委托',study:'设施研修与配方手记',overview:'营地经营手账'};
      $('roomWorkspaceTitle').textContent=titles[target]??'炼金工坊';$('aTab-'+(target==='study'?'study':target==='shelf'||target==='orders'?'sales':'craft')).click();
      if(target==='supplies'){const market=document.querySelector<HTMLDetailsElement>('#atelierUi .a-market')!;market.open=true;market.scrollIntoView({block:'nearest'});}
      if(target==='orders'&&slot!==undefined)$('aOrderWho'+slot).closest('.a-order')?.scrollIntoView({block:'nearest'});
      if(target==='overview'){$('lifeOpen').click();$('lifeTab-overview').click();}
      livingUi?.reflect();
    };
    click('roomBack',()=>{$('roomWorkspace').hidden=true;$('roomSceneView').hidden=false;document.querySelector<HTMLElement>('.popover-content')!.scrollTop=0;livingUi?.reflect();});
    livingUi=bindAlchemyScene({state:()=>state,busy:()=>gameBusy,open,dispatch:a=>run(gameSend(a))});updateAtelier(state,gameBusy);for(const[id,title]of [['craft','调配工作台'],['sales','货台与委托'],['study','设施与手记']])click('aTab-'+id,()=>{$('roomWorkspaceTitle').textContent=title;});ensureInteriorPolish();actionFeedback=bindActionFeedback({host:document.body,state:()=>state});
  }
  async function openField():Promise<void>{if(gameBusy)return;const own=generation;gameBusy=true;updateGame();try{const next=await window.street.command({type:'field-open',generation:own,supply:($<HTMLSelectElement>('eFieldSupply').value==='none'?null:$<HTMLSelectElement>('eFieldSupply').value) as 'herbal-bandage'|'mining-tonic'|null});if(generation===own&&state.popup?.kind==='adventure')apply(next);}catch(e){if(generation===own&&state.popup?.kind==='adventure')report(e);}finally{if(generation===own){gameBusy=false;if(state.popup?.kind==='adventure')updateGame();}}}
  function adventure():void{$('root').innerHTML=`<section class="popover-shell"><div class="popover-content">${header('远征之门')}${adventureMarkup()}<div id="popupError" class="error" role="alert"></div></div></section>`;if(state.game.profile&&chapterView(state.game.profile).step==='depart'&&!state.game.profile.chapter?.skipped)$<HTMLInputElement>('startAuto').checked=false;bindAdventure(()=>state,a=>run(gameSend(a)),()=>run(window.street.command({type:'field-view',generation})),updateGame,target=>run(window.street.command({type:'expedition-link',generation,target})));$('openBottomField').addEventListener('click',()=>run(openField()));bindPartyAdventure(()=>state,async command=>{if(gameBusy)return;const own=generation;gameBusy=true;updateGame();try{const next=await window.street.command(command);if(own===generation)apply(next);}catch(e){if(own===generation)report(e);}finally{if(own===generation){gameBusy=false;updateGame();}}},updateGame);updateGame();}
  function room():void{
    roomBusy=false;
    $('root').innerHTML=`<section class="popover-shell"><div class="popover-content">${header('好友房间')}${roomMarkup()}<div id="popupError" class="error" role="alert"></div></div></section>`;
    const roomSend=async(command:RoomPanelCommand):Promise<void>=>{
      if(roomBusy)return;
      const own=generation;roomBusy=true;updateRoom(state,true);
      try{const next=await window.street.command(command);if(generation===own)apply(next);}
      finally{roomBusy=false;if(generation===own&&state.popup?.kind==='room')updateRoom(state,false);}
    };
    bindRoom(()=>state,generation,roomSend,message=>{report(new Error(message));$('roomError').textContent=message;});
    for(const id of ['roomName','roomInvitation'])$<HTMLInputElement>(id).addEventListener('pointerdown',()=>run(window.street.command({type:'input-focus',generation})));
    updateRoom(state);
  }
  const status=()=>{const roomButton=document.getElementById('openRoom');if(roomButton){roomButton.dataset.unread=String(state.room.unreadCards>0);roomButton.setAttribute('aria-label',state.room.unreadCards?'好友房间 · 有新物品展示':'好友房间');}const current=state.game.profile?shopFlowIndex(state.game.profile):-1;for(const li of Array.from(document.querySelectorAll<HTMLElement>('[data-shop-flow]'))){const i=Number(li.dataset.shopFlow);li.textContent=shopFlowLines[i]+(current===i?' ← 当前':'');if(current===i)li.setAttribute('aria-current','step');else li.removeAttribute('aria-current');}$('warnings').textContent=state.warnings.join('\n');$('displayStatus').textContent=`${state.version} · ${state.bounds.height} DIP · ${Math.round(state.scaleFactor*100)}%`;};
  function fill(value:Settings):void{
    for(const id of ['mode','dock','opacity','volume','cameraX'])$<HTMLInputElement>(id).value=String(value[id as keyof Settings]);
    for(const id of ['alwaysOnTop','interactionEnabled','soundEnabled','bubbles'])$<HTMLInputElement>(id).checked=Boolean(value[id as keyof Settings]);
    const select=$<HTMLSelectElement>('displayId');select.replaceChildren(new Option('当前主显示器','auto'));for(const d of state.displays)select.add(new Option(`${d.label} · ${Math.round(d.scaleFactor*100)}%`,String(d.id)));select.value=value.displayId===null?'auto':String(value.displayId);
    $('heightChoices').dataset.value=String(value.height);for(const b of Array.from($('heightChoices').querySelectorAll<HTMLButtonElement>('button'))){const selected=Number(b.dataset.height)===value.height;b.setAttribute('aria-pressed',String(selected));}
    $('cameraValue').textContent=String(value.cameraX);
  }
  function collect():Settings{return{version:4,mode:$<HTMLSelectElement>('mode').value as Settings['mode'],height:Number($('heightChoices').dataset.value),displayId:$<HTMLSelectElement>('displayId').value==='auto'?null:Number($<HTMLSelectElement>('displayId').value),dock:$<HTMLSelectElement>('dock').value as Settings['dock'],cameraX:Number($<HTMLInputElement>('cameraX').value),alwaysOnTop:$<HTMLInputElement>('alwaysOnTop').checked,opacity:Number($<HTMLInputElement>('opacity').value),soundEnabled:$<HTMLInputElement>('soundEnabled').checked,volume:Number($<HTMLInputElement>('volume').value),bubbles:$<HTMLInputElement>('bubbles').checked,interactionEnabled:$<HTMLInputElement>('interactionEnabled').checked};}
  async function save(value=collect()):Promise<void>{const own=generation;const next=await window.street.saveSettings(value,own);if(generation!==own)return;state=next;fill(next.settings);status();$('saved').textContent='已保存，下次启动继续使用。';$('popupError').textContent='';}
  function settings():void{
    if(!document.querySelector('link[data-camp-life]')){const link=document.createElement('link');link.rel='stylesheet';link.href=new URL('camp-life.css',document.baseURI).href;link.dataset.campLife='true';document.head.append(link);}
    $('root').innerHTML=`<section class="popover-shell"><div class="popover-content">${header('营地设置')}<form id="settingsForm"><fieldset><legend>位置与大小</legend>
    <div class="row"><span>高度档位 / DIP</span><div id="heightChoices" class="segments" role="group" aria-label="高度档位">${heightPresets.map(h=>`<button type="button" data-height="${h}" aria-pressed="false" title="${h} DIP${h===48?' · 极简':''}">${h}</button>`).join('')}</div></div><p class="help">像素按整物理像素缩放，使用五档高度；48 为极简。对话和设置不改变街道高度。</p>
    <label class="row">镜头位置 <output id="cameraValue"></output><input id="cameraX" aria-label="镜头位置" type="range" min="0" max="320" step="1"></label>
    <label class="row">停靠位置<select id="dock"><option value="bottom">屏幕底部</option><option value="top">屏幕顶部</option></select></label>
    <label class="row">显示器<select id="displayId"></select></label>
    <label class="row">营地保持在其他窗口前<input id="alwaysOnTop" type="checkbox"></label><label class="row">内容透明度<input id="opacity" type="range" min="0.4" max="1" step="0.05"></label><p class="help">大面板会让位给其他窗口；点营地道路可继续查看。</p></fieldset>
    <fieldset><legend>工作与交互</legend><label class="row">工作模式<select id="mode"><option value="quiet">安静工作 · 空闲静止</option><option value="friends">好友摸鱼 · 交互时动态</option></select></label>
    <label class="row">允许鼠标交互<input id="interactionEnabled" type="checkbox"></label><label class="row">本地文字气泡<input id="bubbles" type="checkbox"></label><label class="row">本地提示音<input id="soundEnabled" type="checkbox"></label><label class="row">提示音音量<input id="volume" type="range" min="0" max="1" step="0.05"></label><p class="help">安静工作和隐藏始终静音。没有全局快捷键；点击人物，再选对话才开始输入。</p></fieldset>
    <div class="actions">${iconButton('openRoom','friends','好友房间')}${iconButton('save','save','保存设置','primary')}${iconButton('reset','reset','恢复安全默认')}${iconButton('hide','hide','立即隐藏营地')}</div></form>
    <details id="fieldGuide"><summary>底部冒险</summary><p>远征之门进入底部冒险；点地走、点怪走近普攻、点矿开采。先选魔物或矿点再切「刷材料」；「自动推关」向右清怪过门。切模式保留生命与开采进度。月纹石可在背包制作行路短靴、短剑，回营穿戴后下趟生效；独立俯视地牢不受影响。补给耗尽回营，不会自动购买。</p><button type="button" id="openExpeditionSetup">远征整备与物资</button></details><details id="shopFlowGuide"><summary>经营流程指南</summary><ol>${shopFlowLines.map((line,i)=>`<li data-shop-flow="${i}"${state.game.profile&&shopFlowIndex(state.game.profile)===i?' aria-current="step"':''}>${line}${state.game.profile&&shopFlowIndex(state.game.profile)===i?' ← 当前':''}</li>`).join('')}</ol></details><div id="saved" class="help" role="status"></div><details class="life-import" id="gameImportDetails"><summary>营地进度与旧档导入</summary><p>本版使用稳定营地目录，后续兼容更新继续养成。选择旧版 solo/profile.json，先预览再导入；覆盖前自动备份当前进度，旧文件不变。</p><button type="button" id="gameImportPick" class="game-button" data-tooltip="只读取你选择的存档，不扫描旧目录">选择旧存档</button><p class="life-import-hint">0.8.0旧档位置：~/Library/Application Support/PixelStreetPreview080/solo/profile.json。可在文件选择器中使用“前往文件夹”。</p><p id="gameImportPreview" role="status"></p><p id="gameImportBoundary" hidden>导入营地、商店和伙伴进度；不导入旧主动战斗或房间会话。当前进度将先备份，离线最多补算8小时。</p><button type="button" id="gameImportConfirm" class="game-button" data-tooltip="备份当前进度后导入预览的存档" disabled>备份当前进度并导入</button></details><details id="backupDetails"><summary>设置备份</summary><textarea id="backupText" aria-label="设置备份文本" placeholder="仅包含本机设置"></textarea><div class="actions">${iconButton('export','export','生成设置备份')}${iconButton('import','import','导入设置备份')}</div></details><div id="warnings" class="help"></div><div id="displayStatus" class="help"></div><div id="popupError" class="error" role="alert"></div></div></section>`;
    ensureChapterStyle();const guide=document.createElement('div');guide.className='ch-secondary';guide.innerHTML='<button type="button" id="chapterResume">继续开张与初行</button><button type="button" id="chapterReplay">回看战斗演示</button>';document.getElementById('shopFlowGuide')!.before(guide);click('chapterResume',()=>run(window.street.command({type:'chapter',generation,op:state.game.profile?.chapter?'resume':'start'})));click('chapterReplay',()=>run(window.street.command({type:'chapter',generation,op:'replay'})));
    click('openExpeditionSetup',()=>run(window.street.command({type:'expedition-open',generation})));
    fill(state.settings);status();$('settingsForm').addEventListener('submit',e=>{e.preventDefault();run(save());});
    click('openRoom',()=>run(window.street.command({type:'room-open',generation})));click('save',()=>run(save()));click('reset',()=>run(save({...defaults})));click('hide',()=>run(window.street.command({type:'hide',generation})));
    for(const b of Array.from($('heightChoices').querySelectorAll<HTMLButtonElement>('button')))b.addEventListener('click',()=>{$('heightChoices').dataset.value=b.dataset.height;run(save());});
    const camera=$<HTMLInputElement>('cameraX');camera.addEventListener('input',()=>{$('cameraValue').textContent=camera.value;run(window.street.command({type:'camera',value:Number(camera.value),generation}));});camera.addEventListener('change',()=>run(save()));
    $('alwaysOnTop').addEventListener('change',()=>run(save()));
    click('export',()=>{const own=generation;run(window.street.exportSettings(own).then(text=>{if(generation===own){$<HTMLTextAreaElement>('backupText').value=text;$('saved').textContent='已生成仅含设置的备份。';}}));});
    click('import',()=>{const own=generation;run(window.street.importSettings($<HTMLTextAreaElement>('backupText').value,own).then(next=>{if(generation===own){state=next;fill(next.settings);status();$('popupError').textContent='';$('saved').textContent='设置备份已恢复。';}}));});
    let importToken:string|null=null,importBusy=false;
    click('gameImportPick',()=>{if(importBusy)return;const own=generation;importBusy=true;$<HTMLButtonElement>('gameImportPick').disabled=true;$<HTMLButtonElement>('gameImportConfirm').disabled=true;run(window.street.previewGameImport(own).then(preview=>{if(generation!==own)return;importToken=preview?.token??null;$('popupError').textContent='';$('gameImportBoundary').hidden=!preview;$('gameImportPreview').textContent=preview?`${preview.fileName} · ${preview.coins}金币 · ${preview.xp}经验 · ${preview.companions}位伙伴 · ${preview.buildings}次建设`:'已取消选择';$<HTMLButtonElement>('gameImportConfirm').disabled=!preview;}).finally(()=>{importBusy=false;if(generation===own)$<HTMLButtonElement>('gameImportPick').disabled=false;}));});
    click('gameImportConfirm',()=>{if(importBusy||!importToken)return;const own=generation,token=importToken;importBusy=true;importToken=null;$<HTMLButtonElement>('gameImportConfirm').disabled=true;run(window.street.confirmGameImport(token,own).then(next=>{if(generation!==own)return;apply(next);$('gameImportPreview').textContent=next.game.warnings.filter(s=>s.includes('覆盖前备份')).join('；')||'进度已导入，原文件不变。';$('gameImportBoundary').hidden=true;}).finally(()=>{importBusy=false;}));});
    $('backupText').addEventListener('pointerdown',()=>run(window.street.command({type:'input-focus',generation})));
  }
  function actor():void{$('root').innerHTML=`<section class="popover-shell"><div class="popover-content">${header('冒险者')}<button id="talk" class="actor-action" type="button">${iconButtonInner()}<span>对话</span></button><div id="popupError" class="error"></div></div></section>`;click('talk',()=>run(window.street.command({type:'talk',generation})));}
  function iconButtonInner():string{return icon('chat');}
  function dialogue():void{
    composing=false;endedAt=-Infinity;document.body.dataset.composing='false';
    $('root').innerHTML=`<section class="popover-shell"><div class="popover-content">${header('与冒险者对话')}<p class="help compact">本机样片 · Enter 显示，Shift+Enter 换行</p><textarea id="draft" aria-label="对话输入" placeholder="说点什么……" maxlength="240"></textarea><div class="dialogue-footer"><span id="textStatus" class="help">0/120</span>${iconButton('sendLocal','send','本地显示','primary')}</div><div id="popupError" class="error" role="alert"></div></div></section>`;
    const draft=$<HTMLTextAreaElement>('draft');
    draft.addEventListener('pointerdown',()=>{if(!state.keyboard)run(window.street.command({type:'input-focus',generation}));});
    draft.addEventListener('compositionstart',()=>{composing=true;document.body.dataset.composing='true';});draft.addEventListener('compositionend',()=>{composing=false;endedAt=performance.now();document.body.dataset.composing='false';});
    draft.addEventListener('input',()=>{$('textStatus').textContent=`${Array.from(draft.value).length}/120`;});
    let sending=false;
    async function send():Promise<void>{if(sending||composing||performance.now()-endedAt<80)return;if(!validLocalText(draft.value)){$('popupError').textContent='请输入1–120个字符，最多512字节。';return;}
      const own=generation,text=draft.value;sending=true;$<HTMLButtonElement>('sendLocal').disabled=true;
      try{await window.street.command({type:'local-text',text,generation:own});if(generation!==own)return;if(draft.value===text)draft.value='';$('textStatus').textContent=draft.value?`${Array.from(draft.value).length}/120`:'已在本机显示';$('popupError').textContent='';document.body.dataset.localSends=String(Number(document.body.dataset.localSends??0)+1);}
      finally{sending=false;if(generation===own)$<HTMLButtonElement>('sendLocal').disabled=false;}}
    click('sendLocal',()=>run(send()));draft.addEventListener('keydown',e=>{const key=composerKey(e.key,e.shiftKey,composing||e.isComposing,e.keyCode,performance.now()-endedAt);if(key==='send'){e.preventDefault();run(send());}else if(key==='release'){e.preventDefault();close();}});
  }
  function apply(next:ShellState):void{
    if(state&&next.revision<state.revision)return;state=next;const popup=next.popup;
    if(!popup){chapterUi?.dispose();chapterUi=undefined;actionFeedback?.dispose();actionFeedback=undefined;villageUi?.dispose();villageUi=undefined;livingUi?.dispose();livingUi=undefined;generation=0;composing=false;document.body.dataset.composing='false';$('root').replaceChildren();document.body.dataset.popupReady='false';return;}
    for(const [key,value] of Object.entries({detached:String(!!popup.detached),popup:popup.kind,side:popup.side,generation:String(popup.generation),suspended:String(popup.suspended)}))if(document.body.dataset[key]!==value)document.body.dataset[key]=value;const tail=`${popup.tail}px`;if(document.documentElement.style.getPropertyValue('--tail')!==tail)document.documentElement.style.setProperty('--tail',tail);
    if(generation===popup.generation){if(popup.kind==='settings')status();if(popup.kind==='chapter'||popup.kind==='shop'||popup.kind==='alchemy'||popup.kind==='adventure'||popup.kind==='room')updateGame();navigateTower(state);return;}
    chapterUi?.dispose();chapterUi=undefined;actionFeedback?.dispose();actionFeedback=undefined;livingUi?.dispose();livingUi=undefined;villageUi?.dispose();villageUi=undefined;generation=popup.generation;gameBusy=false;roomBusy=false;lifeUi=undefined;document.body.dataset.popupReady='false';if(popup.kind==='chapter')chapterUi=bindChapterPanel(()=>state,apply);else if(popup.kind==='settings')settings();else if(popup.kind==='actor')actor();else if(popup.kind==='shop')shop();else if(popup.kind==='alchemy')alchemy();else if(popup.kind==='adventure')adventure();else if(popup.kind==='room')room();else dialogue();if(popup.kind!=='chapter')click('popupClose',close);navigateTower(state);
    // A cached native popup is hidden while its next generation is prepared.
    // Hidden pages may suspend animation frames; readiness must not wait for
    // a frame when the main process itself waits for readiness before showing.
    const own=generation;queueMicrotask(()=>{if(generation!==own)return;$('root').getBoundingClientRect();document.body.dataset.popupReady='true';run(window.street.command({type:'popup-ready',generation:own}));});
  }
  window.addEventListener('focus',()=>{if(state?.popup?.kind==='dialogue')$<HTMLTextAreaElement>('draft')?.focus();});
  window.addEventListener('pagehide',()=>actionFeedback?.dispose(),{once:true});apply(await window.street.state());window.street.subscribe(apply);
}
