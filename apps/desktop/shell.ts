import {PartyFieldService} from './party-field-service';
import {publicGameState} from '../../packages/solo-core/party-ledger';
import type {PartyCommand,PartyControl} from '../../packages/protocol/party-field';
import {assertFieldAccess} from './field-access';
import type {FieldControl} from '../../packages/protocol/field-control';
import {NativePresentation,type NativePresentationEvent} from './native-presentation';
import type {PresentationOwner} from '../../packages/protocol/presentation';
import {chapterView,type GameAction} from '../../packages/solo-core';
import {ChapterActionSession} from './chapter-session';
import {chapterIntent,chapterGenerationAllowed,type ChapterCommand,type ChapterPresentation} from '../../packages/protocol/chapter';
import {isTowerOnlyAction} from '../../packages/solo-core/mastery';
import {towerDestination,campTowerTargets,towerRoomReason,type TowerRouteContext} from '../../packages/solo-core/tower';
import {parseInventoryActionRequest} from '../../packages/solo-core/inventory-actions';
import {atelierActionStation,type AtelierAction} from '../../packages/solo-core/atelier';
import {ProfileImportSession,importIdleReason} from './profile-import';
import { app, dialog, BrowserWindow, clipboard, ipcMain, Menu, screen, Tray, type IpcMainInvokeEvent, type IpcMainEvent } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { channels, parseCommand, type Command, type DisplayInfo, type InputMode, type PopupKind, type PopupState, type Rect, type ShellState, type ShopId, type View, type TowerTarget, type InventoryTarget } from '../../packages/protocol';
import { bottomBounds, chooseDisplay, popoverBounds } from '../../packages/protocol/geometry';
import { SettingsStore } from './settings-store';
import {PanelLayoutStore,clampPanel} from './panel-layout-store';
import {APP_NAME,APP_VERSION} from './identity';
import { trayImage } from './tray-image';
import {GameRuntime} from './game-runtime';
import {ActionRuntime} from './action-runtime';
import {DungeonRuntime} from './dungeon-runtime';
import {GameplayGate} from './gameplay-gate';
import {emptyDungeon} from '../../packages/protocol/dungeon';
import {parseDungeonInput} from '../../packages/dungeon-core';
import {RoomService} from './room-service';
import {emptyRoom,type RoomCommand} from '../../packages/protocol/room';

export class DesktopShell {
  overlay: BrowserWindow;
  recovery: BrowserWindow;
  readonly tray: Tray;
  readonly store: SettingsStore;
  readonly panelLayout:PanelLayoutStore;
  readonly game:GameRuntime;
  readonly action:ActionRuntime;
  readonly dungeon:DungeonRuntime;
  readonly room:RoomService;readonly partyField:PartyFieldService;private openedPartySession='';
  towerWindow:BrowserWindow|null=null;
  private towerSuspended=false;
  private towerPreflightHidden=false;
  private towerNavigationId=0;
  private towerNavigation?:ShellState['towerNavigation'];
  arenaWindow:BrowserWindow|null=null;
  private arenaRequested=false;
  private arenaSurface:'casual'|'arena'|null=null;
  private readonly presentation=new NativePresentation();
  private readonly presentationWindows=new Map<PresentationOwner,BrowserWindow>();
  private demoSession=0;
  private readonly chapterSession=new ChapterActionSession();
  private chapterPresentation:ChapterPresentation={location:'demo',replay:false};
  private readonly gameplayGate=new GameplayGate();
  private readonly profileImport=new ProfileImportSession();
  inventoryWindow:BrowserWindow|null=null;
  inventory:NonNullable<ShellState['inventory']>|null=null;
  private inventorySize={width:760,height:650};
  private inventoryNavigation?:ShellState['inventoryNavigation'];
  private inventoryNavigationId=0;
  private inventoryNativeReady=false;
  private inventoryDataReady=0;
  private inventoryBusy=false;
  popupWindow: BrowserWindow | null = null;
  popup: PopupState | null = null;
  mode: InputMode = 'display';
  view: View = 'street';
  activeShop: ShopId|null = null;
  epoch = 0;
  revision = 0;
  keyboard = false;
  ignoresMouse = true;
  cameraX: number;
  localMessage: { id: number; text: string } | null = null;
  private messageId = 0;
  private generation = 0;
  private popupNativeReady = false;
  private popupDataReady = 0;
  private readonly page = path.join(__dirname,'renderer/index.html');
  private quitting = false;
  private closing = false;
  private crashed = false;
  private overlayCold = true;
  private overlayLoading = false;
  private recoveryLoaded = false;
  private popupDisposeTimer?:ReturnType<typeof setTimeout>;
  private workingElsewhere = false;
  private pendingFocus?: () => void;
  private pendingFocusOwner?:'popup'|'arena';
  private focusCleanup?: ReturnType<typeof setTimeout>;
  private readonly onDisplayChange = () => { this.closePopup(false); this.position(); this.broadcast(); };
  private readonly onResignActive = () => {this.cancelFocus();this.workingElsewhere=true;this.captureMouse(false);this.suspendPopup();this.suspendInventory();this.suspendTower();this.pauseArena();this.broadcast();};
  private readonly onBecomeActive = () => {this.workingElsewhere=false;this.broadcast();};

  constructor(folder: string,private readonly soloFolder=path.join(folder,'solo'),testMode=false) {
    this.store = new SettingsStore(folder);this.panelLayout=new PanelLayoutStore(folder); this.cameraX = this.store.value.cameraX;
    this.overlay=this.createOverlay();this.recovery=this.createRecovery();
    this.tray=new Tray(trayImage());this.tray.setToolTip('PixelStreet · 地下城营地');this.tray.on('double-click',()=>this.restore());
    this.registerIPC();this.updateTray();
    this.game=new GameRuntime(soloFolder,()=>{if(this.closing||this.quitting)return;this.room?.gameUpdated();if(this.view==='field'&&this.game.state.status==='ready'&&!this.game.state.profile?.run&&!this.partyField?.state.view){if(this.popup?.kind==='adventure')this.closePopup(false);this.view='street';this.position();}this.broadcast();},testMode);
    this.action=new ActionRuntime(soloFolder,this.game,()=>{if(this.closing||this.quitting)return;this.room?.actionUpdated();const win=this.arenaWindow;if(win&&!win.isDestroyed()&&win.isVisible()&&!win.isMinimized())win.webContents.send(channels.update,this.state());});
    this.dungeon=new DungeonRuntime(soloFolder,this.game,()=>{if(this.closing||this.quitting)return;const win=this.arenaWindow;if(win&&!win.isDestroyed()&&win.isVisible()&&!win.isMinimized())win.webContents.send(channels.update,this.state());});
    this.room=new RoomService(soloFolder,this.game,this.action,()=>this.broadcast());
    this.partyField=new PartyFieldService(soloFolder,this.game,this.room,()=>{if(this.closing||this.quitting)return;const p=this.partyField?.state;if(p?.view&&this.openedPartySession!==p.sessionId){this.openedPartySession=p.sessionId!;if(this.popup?.kind==='adventure')this.closePopup(false);this.view='field';this.position();}else if(this.view==='field'&&!p?.view&&!this.game.state.profile?.run){this.setView('street');}this.broadcast();});
    screen.on('display-added',this.onDisplayChange);screen.on('display-removed',this.onDisplayChange);screen.on('display-metrics-changed',this.onDisplayChange);app.on('did-resign-active',this.onResignActive);app.on('did-become-active',this.onBecomeActive);
  }
  private trackPresentation(owner:PresentationOwner,win:BrowserWindow):void {
    this.presentationWindows.set(owner,win);this.presentation.reset(owner);
    for(const event of ['show','hide','minimize','restore','focus','blur','closed'] as NativePresentationEvent[]){
      win.on(event as any,()=>{if(this.presentationWindows.get(owner)!==win)return;this.presentation.event(owner,event);this.publishPresentation();});
    }
  }
  /** Stop signals reach suspended renderers too; ordinary economy broadcasts retain their existing recipients. */
  private publishPresentation():void {
    if(this.closing||this.quitting||this.overlay.isDestroyed())return;this.syncFieldPresentation();this.revision++;const state=this.state();
    for(const win of [this.overlay,this.popupWindow,this.towerWindow])if(win&&!win.isDestroyed()&&!win.webContents.isDestroyed())win.webContents.send(channels.update,state);
  }
  private createOverlay():BrowserWindow {
    const win=new BrowserWindow({...bottomBounds(this.selectedDisplay(),this.view,this.store.value.height,this.store.value.dock),show:false,frame:false,transparent:true,backgroundColor:'#00000000',alwaysOnTop:this.store.value.alwaysOnTop,focusable:false,skipTaskbar:true,hasShadow:false,resizable:false,movable:false,minimizable:false,maximizable:false,fullscreenable:false,title:'PixelStreet · 营地',webPreferences:this.preferences()});
    win.setIgnoreMouseEvents(true,{forward:true});win.setAlwaysOnTop(this.store.value.alwaysOnTop,'floating');this.guardWindow(win);this.trackPresentation('overlay',win);
    win.on('close',event=>{if(!this.quitting){event.preventDefault();this.hide();}});
    win.webContents.on('render-process-gone',()=>{if(this.overlay===win&&this.mode!=='hidden'&&!this.quitting){this.crashed=true;this.hide();}});
    return win;
  }
  private createRecovery():BrowserWindow {
    const win=new BrowserWindow({...this.recoveryBounds(),show:false,frame:false,transparent:true,backgroundColor:'#00000000',alwaysOnTop:true,focusable:false,skipTaskbar:true,hasShadow:false,resizable:false,movable:false,minimizable:false,maximizable:false,fullscreenable:false,title:'PixelStreet · 恢复箭头',webPreferences:this.preferences()});
    this.guardWindow(win);win.setAlwaysOnTop(true,'floating');win.on('close',event=>{if(!this.quitting)event.preventDefault();});return win;
  }
  private showRecovery():void {
    const win=this.recovery;
    if(this.recoveryLoaded){if(this.mode==='hidden')win.showInactive();return;}
    this.recoveryLoaded=true;
    void win.loadFile(this.page,{query:{page:'recovery'}}).then(()=>{if(this.mode==='hidden'&&this.recovery===win&&!win.isDestroyed())win.showInactive();}).catch(()=>{if(this.recovery===win)this.recoveryLoaded=false;});
  }
  private async loadOverlay():Promise<void> {
    if(this.overlayLoading||!this.overlayCold)return;
    this.overlayLoading=true;const win=this.overlay;
    try{await win.loadFile(this.page);}
    catch(error){if(this.overlay===win&&!this.quitting){this.store.warnings.push('营地恢复失败，可点箭头重试。');this.crashed=true;this.hide();}}
    finally{if(this.overlay===win)this.overlayLoading=false;}
  }
  private sceneReady():void {
    this.overlayCold=false;this.crashed=false;
    if(this.mode==='hidden')return;
    this.position();if(!this.overlay.isVisible())this.overlay.showInactive();
    // The heavy camp is fully drawn before its lightweight recovery route closes.
    this.recovery.destroy();this.recovery=this.createRecovery();this.recoveryLoaded=false;
  }
  private preferences():Electron.WebPreferences {
    return {preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false,webviewTag:false,spellcheck:false,backgroundThrottling:true,
      partition:'pixel-street-s1',navigateOnDragDrop:false,autoplayPolicy:'user-gesture-required'};
  }
  private guardWindow(win:BrowserWindow):void {
    win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());win.webContents.on('will-attach-webview',e=>e.preventDefault());
    win.webContents.session.setPermissionRequestHandler((_wc,_permission,cb)=>cb(false));win.webContents.session.setPermissionCheckHandler(()=>false);
    const allowedRoot=path.resolve(__dirname,'renderer')+path.sep;
    win.webContents.session.webRequest.onBeforeRequest((details,cb)=>{try{const url=new URL(details.url);const local=url.protocol==='file:'&&path.resolve(fileURLToPath(url)).startsWith(allowedRoot);cb({cancel:!(local||['data:','blob:'].includes(url.protocol))});}catch{cb({cancel:true});}});
  }
  private trust(event:IpcMainInvokeEvent|IpcMainEvent):'overlay'|'popup'|'recovery'|'arena'|'inventory'|'tower' {
    if(this.closing||this.quitting)throw Error('应用正在关闭');
    const owner=event.sender===this.towerWindow?.webContents?'tower':event.sender===this.overlay.webContents?'overlay':event.sender===this.popupWindow?.webContents?'popup':event.sender===this.recovery.webContents?'recovery':event.sender===this.arenaWindow?.webContents?'arena':event.sender===this.inventoryWindow?.webContents?'inventory':null;
    if(!owner||event.senderFrame!==event.sender.mainFrame)throw new Error('Untrusted IPC sender');
    try{if(fileURLToPath(new URL(event.senderFrame.url))!==this.page)throw new Error();}catch{throw new Error('Untrusted IPC page');}
    return owner;
  }
  private assertInventoryAction(generation:unknown,allowBusy=false):void {
    if(!this.store.value.interactionEnabled)throw Error('鼠标交互已关闭，请先在设置中开启。');
    if(!this.inventory||generation!==this.inventory.generation||!Number.isSafeInteger(generation)||this.inventory.suspended||this.mode==='hidden'||!this.inventoryWindow||this.inventoryWindow.isDestroyed()||!this.inventoryWindow.isVisible()||this.game.state.status!=='ready'||!this.game.state.profile)throw Error('背包已暂收或操作已过期，请重新打开。');
    if(this.inventoryBusy&&!allowBusy)throw Error('物品操作正在结算，请稍候。');
  }
  private assertPopupGeneration(generation:unknown,kind?:PopupKind):void {
    if(!this.popup||!Number.isSafeInteger(generation)||generation!==this.popup.generation||(kind&&this.popup.kind!==kind))throw new Error('面板操作已过期或权限不匹配。');
  }
  private registerIPC():void {
    ipcMain.handle(channels.state,event=>{this.trust(event);return this.state();});
    ipcMain.handle(channels.inventoryPreview,(event,generation:unknown,raw:unknown)=>{
      if(this.trust(event)!=='inventory')throw Error('物品预览仅属于背包。');
      this.assertInventoryAction(generation);const request=parseInventoryActionRequest(raw);
      return this.gameplayGate.run(async()=>{this.assertInventoryAction(generation);const preview=await this.game.inventoryPreview(generation as number,request);try{this.assertInventoryAction(generation);}catch(e){this.game.inventoryCancel(preview.token);throw e;}return preview;});
    });
    ipcMain.handle(channels.command,(event,value:unknown)=>{
      const owner=this.trust(event),command=parseCommand(value);
      if(command.type==='street-presence'){if(owner!=='overlay'||command.epoch!==this.epoch||command.presence.view!==this.view||this.mode==='hidden'||this.workingElsewhere)return this.state();this.room.updatePresence(command.presence);return this.state();}
      if(command.type==='party-field')return this.partyCommand(owner,command);
      if(command.type==='party-control')return this.partyControl(owner,command);
      if(command.type==='expedition-open')return this.openExpeditionFromSettings(owner,command.generation);
      if(command.type==='field-open')return this.openFieldFromAdventure(owner,command.generation,command.supply);
      if(command.type==='field-control')return this.fieldCommand(owner,command);
      if(command.type==='chapter'||command.type==='chapter-confirm'||command.type==='chapter-demo-end')return this.chapterCommand(owner,command);
      if(owner==='tower')return this.towerCommand(command);
      if('envelope'in command&&isTowerOnlyAction(command.envelope.action))throw Error('请在成就之塔领奖');
      if(['tower-action','tower-link','tower-route','tower-close','tower-minimize'].includes(command.type))throw Error('此命令仅属于成就之塔');
      if(command.type==='tower-open'&&owner!=='overlay')throw Error('请从营地打开成就之塔');
      if(owner==='inventory'){
        if(!['inventory-share','inventory-ready','inventory-close','inventory-page','inventory-link','inventory-confirm','inventory-cancel'].includes(command.type)||!('generation'in command)||command.generation!==this.inventory?.generation)throw Error('背包仅允许当前窗口的物品操作、导航与收起');
        if(command.type==='inventory-share'){
          const inventory=this.inventory,page=inventory?.page;
          const guard=()=>{if(this.trust(event)!=='inventory'||this.inventory!==inventory||this.inventory?.page!==page)throw Error('分享窗口已变化，请重新预览。');this.assertInventoryAction(command.generation,true);if(!this.inventoryNativeReady||this.inventoryDataReady!==command.generation)throw Error('背包尚未就绪。');};
          this.assertInventoryAction(command.generation);guard();this.inventoryBusy=true;
          return this.gameplayGate.run(async()=>{await this.room.shareItem(command.itemId,guard);this.broadcast();return this.state();}).finally(()=>{this.inventoryBusy=false;});
        }
        if(command.type==='inventory-confirm'){
          this.assertInventoryAction(command.generation);this.inventoryBusy=true;
          return this.gameplayGate.run(async()=>{this.assertInventoryAction(command.generation,true);await this.game.inventoryConfirm(command.generation,command.token);this.broadcast();return this.state();}).finally(()=>{this.inventoryBusy=false;});
        }
        if(command.type==='inventory-cancel'){this.game.inventoryCancel(command.token);return this.state();}
        if(command.type==='inventory-close')this.closeInventory();
        else if(command.type==='inventory-page'){
          this.assertInventoryAction(command.generation);this.openInventory(command.page);
        }else if(command.type==='inventory-link'){
          if(this.mode==='hidden'||this.inventory?.suspended||!this.inventoryWindow?.isVisible())throw Error('背包已暂收，请重新打开后导航。');
          this.navigateInventory(command.target);
        }else{this.inventoryDataReady=Number(command.generation);this.showInventoryIfReady();}
        return this.state();
      }
      if(['inventory-share','inventory-ready','inventory-close','inventory-page','inventory-link','inventory-confirm','inventory-cancel'].includes(command.type))throw Error('此命令仅属于背包');
      const arenaOnly=['leisure','action-start','action-input','action-close','action-return','action-claim','dungeon-start','dungeon-input','dungeon-close','dungeon-minimize','dungeon-return','dungeon-claim'];
      if(owner==='arena'&&!arenaOnly.includes(command.type))throw Error('主动窗口仅允许战斗操作');
      if(owner!=='arena'&&arenaOnly.includes(command.type))throw Error('请在主动冒险窗口操作');
      if(owner==='arena')return this.arenaCommand(command);
      if(owner==='recovery'&&command.type!=='restore')throw new Error('恢复箭头仅允许恢复展示');
      if(['scene-ready','dungeon-portal','inventory-toggle','pet-toggle'].includes(command.type)&&owner!=='overlay')throw Error('场景就绪仅属于营地');
      if(owner==='overlay'&&(['talk','input-focus','camera','local-text','popup-ready','game','field-view','expedition-link'].includes(command.type)||command.type.startsWith('room-')))throw new Error('此命令仅属于当前子面板');
      if(owner==='popup'){
        if(!('generation'in command))throw new Error('子面板操作必须属于当前代。');
        this.assertPopupGeneration(command.generation);
        if(this.popup!.suspended&&!['popup-ready','close-popup'].includes(command.type))throw Error('面板已暂收，请从营地恢复后操作。');
        const allowed={chapter:['popup-ready','close-popup'],settings:['popup-ready','close-popup','input-focus','camera','hide','room-open'],actor:['popup-ready','close-popup','talk'],dialogue:['popup-ready','close-popup','input-focus','local-text'],shop:['popup-ready','close-popup','game'],alchemy:['popup-ready','close-popup','game'],adventure:['popup-ready','close-popup','game','field-view','expedition-link'],room:['popup-ready','close-popup','input-focus','room-host','room-join','room-copy','room-leave','room-read','room-chat']};
        if(!allowed[this.popup!.kind].includes(command.type))throw new Error('子面板无此窗口权限');
      }
      if(owner==='overlay'&&this.mode==='hidden'&&command.type!=='restore')return this.state();
      if(command.type.startsWith('room-'))return this.roomCommand(command as RoomCommand);
      if(command.type==='open-action'){if(owner!=='popup'||this.popup!.kind!=='adventure')throw Error('请从远征之门选择主动冒险');this.assertPopupGeneration(command.generation);this.openArena();return this.state();}
      if(command.type==='return-camp'){
        const accepted=this.overlay,epoch=this.epoch;const guard=()=>{if(owner!=='overlay'||this.overlay!==accepted||epoch!==this.epoch||this.mode==='hidden'||this.view!=='field')throw Error('请从野外回营地点返回');};
        guard();return this.gameplayGate.run(async()=>{guard();const p=await this.game.authoritativeProfile();guard();if(p.run?.field)throw Error('请从底部冒险回营地点返回');await this.game.command(command.envelope);if(this.overlay===accepted&&epoch===this.epoch)this.setView('street');return this.state();});
      }
      if(command.type==='game'&&isTowerOnlyAction(command.envelope.action))throw Error('请在成就之塔领奖');
      if(command.type==='game')return this.gameplayGate.run(async()=>{if(command.envelope.action.type==='material-sell'||command.envelope.action.type.startsWith('field-')||this.game.state.profile?.run?.field&&['retreat','skill','auto-skills'].includes(command.envelope.action.type))throw Error('请在底部冒险操作');const departure=['start-run','expedition-depart'].includes(command.envelope.action.type),adventure=['start-run','retreat','auto-skills','skill'].includes(command.envelope.action.type)||command.envelope.action.type.startsWith('expedition-');const a=command.envelope.action;if(a.type.startsWith('camp-')||a.type.startsWith('village-')){const kind=this.popup?.kind;if(kind!=='shop'&&kind!=='alchemy')throw Error('请在经营总览操作。');this.assertPopupGeneration(command.generation,kind);}else if(a.type.startsWith('atelier-')){const station=atelierActionStation(a as AtelierAction),kind=this.popup?.kind;this.assertPopupGeneration(command.generation,kind==='alchemy'?'alchemy':'shop');if(station&&(station==='alchemy'?'alchemy':'shop')!==kind)throw Error('请在对应店铺操作。');}else this.assertPopupGeneration(command.generation,adventure?'adventure':'shop');if(departure)await this.dungeon.reconcile();if(departure&&((this.action.state.run&&!this.action.state.settled)||(this.dungeon.state.run&&!this.dungeon.state.settled)))throw Error('请先带回主动冒险战利品，再开启挂机远征。');await this.game.command(command.envelope);if(command.envelope.action.type==='start-run')this.setView('field');this.broadcast();return this.state();});
      return this.command(command);
    });
    ipcMain.on(channels.dungeonControl,(event,value:unknown)=>{
      try{if(this.trust(event)!=='arena')return;const input=parseDungeonInput(value);if(input?.type==='cancel-controls'){this.dungeon.control(input);return;}const win=this.arenaWindow;if(!win||!win.isVisible()||win.isMinimized()||!win.isFocused()||this.workingElsewhere)return;if(input?.type==='control')this.dungeon.control(input);}catch{/* Only trusted stop signals may pass after focus loss. */}
    });
    const settings=(event:IpcMainInvokeEvent,generation:unknown)=>{if(this.trust(event)!=='popup')throw new Error('Settings belong to popup');this.assertPopupGeneration(generation,'settings');if(this.popup!.suspended)throw Error('设置已暂收，请从营地恢复。');};
    ipcMain.handle(channels.save,(event,value:unknown,generation:unknown)=>{settings(event,generation);this.store.save(value);this.settingsChanged();return this.state();});
    ipcMain.handle(channels.export,(event,generation:unknown)=>{settings(event,generation);return this.store.export();});
    ipcMain.handle(channels.import,(event,value:unknown,generation:unknown)=>{settings(event,generation);this.store.import(value);this.settingsChanged();return this.state();});
    ipcMain.handle(channels.gameImportPreview,async(event,generation:unknown)=>{
      settings(event,generation);this.profileImport.clear();const p=this.game.state.profile;if(!p)throw Error('营地进度尚未就绪。');const reason=importIdleReason(p);if(reason)throw Error(reason);
      const picked=await dialog.showOpenDialog(this.popupWindow!,{title:'选择旧版营地存档',properties:['openFile'],filters:[{name:'PixelStreet进度',extensions:['json','bak']}]});
      settings(event,generation);if(picked.canceled||!picked.filePaths[0]){this.profileImport.clear();return null;}
      const file=picked.filePaths[0];if(path.resolve(file)===path.resolve(this.soloFolder,'profile.json'))throw Error('请选择旧版文件，不能用正在使用的主存档覆盖自身。');
      return this.profileImport.stage(file,Number(generation),this.game.state.profile!.sequence);
    });
    ipcMain.handle(channels.gameImportConfirm,(event,token:unknown,generation:unknown)=>this.gameplayGate.run(async()=>{
      settings(event,generation);const p=this.game.state.profile;if(!p)throw Error('营地进度尚未就绪。');
      if((this.action.state.run&&!this.action.state.settled)||(this.dungeon.state.run&&!this.dungeon.state.settled))throw Error('先结算主动冒险，再导入营地。');
      const source=this.profileImport.consume(token,Number(generation),p.sequence);
      await this.game.request('import-profile',{profile:source,expectedSequence:p.sequence});this.broadcast();return this.state();
    }));
  }
  displays():DisplayInfo[]{return screen.getAllDisplays().map((d,i)=>({id:d.id,label:d.label||`显示器 ${i+1}`,workArea:{...d.workArea},scaleFactor:d.scaleFactor,refreshRate:d.displayFrequency}));}
  selectedDisplay():DisplayInfo{return chooseDisplay(this.displays(),this.store.value.displayId,screen.getPrimaryDisplay().id);}
  state():ShellState{const displays=this.displays(),selected=chooseDisplay(displays,this.store.value.displayId,screen.getPrimaryDisplay().id);return {presentation:this.presentation.snapshot(),chapter:this.chapterState(),tower:this.towerWindow?{suspended:this.towerSuspended}:undefined,towerNavigation:this.towerNavigation,workingElsewhere:this.workingElsewhere,mode:this.mode,view:this.view,epoch:this.epoch,revision:this.revision,bounds:this.overlay.getBounds(),scaleFactor:selected.scaleFactor,keyboard:this.keyboard,
    inventoryNavigation:this.inventoryNavigation,activeShop:this.activeShop,inventory:this.inventory?{...this.inventory,bounds:{...this.inventory.bounds}}:null,popup:this.popup?{...this.popup,anchor:{...this.popup.anchor},bounds:{...this.popup.bounds}}:null,cameraX:this.cameraX,localMessage:this.localMessage?{...this.localMessage}:null,
    partyField:this.partyField?.state,game:this.game?publicGameState(this.game.state):{status:'loading',profile:null,partySize:1,error:'',warnings:[]},action:this.action?.state??{status:'loading',run:null,claim:0,settled:true,source:null,localPlayerId:'local',error:'',warnings:[]},dungeon:this.dungeon?.state??emptyDungeon(),room:this.room?.state??emptyRoom(),settings:{...this.store.value},displays,warnings:[...this.store.warnings,...(this.crashed?['画面异常，恢复可重新加载。']:[])],version:APP_VERSION};}
  async load():Promise<void>{await Promise.all([this.game.ready,this.action.ready,this.dungeon.ready,this.room.ready,this.partyField.ready]);try{await this.dungeon.reconcile();}catch(error){this.store.warnings.push('地牢奖励恢复待处理：'+String(error));}this.position();await this.loadOverlay();this.broadcast();}
  position():void {
    const bounds=bottomBounds(this.selectedDisplay(),this.view,this.store.value.height,this.store.value.dock);
    this.setBoundsIfChanged(this.overlay,bounds);this.setBoundsIfChanged(this.recovery,this.recoveryBounds());
    if(this.overlay.getOpacity()!==this.store.value.opacity)this.overlay.setOpacity(this.store.value.opacity);
    if(this.overlay.isAlwaysOnTop()!==this.store.value.alwaysOnTop)this.overlay.setAlwaysOnTop(this.store.value.alwaysOnTop,'floating');
    if(this.inventory&&this.inventoryWindow){this.inventory.bounds=this.panelLayout.place('inventory',this.inventory.bounds,[this.selectedDisplay().workArea,...this.displays().filter(d=>d.id!==this.selectedDisplay().id).map(d=>d.workArea)]);const a=screen.getDisplayMatching(this.inventory.bounds).workArea;this.inventoryWindow.setMinimumSize(Math.min(420,a.width),Math.min(360,a.height));this.setBoundsIfChanged(this.inventoryWindow,this.inventory.bounds);}
    if(this.popup){const suspended=this.popup.suspended;this.popup={...this.popupLayout(this.popup.kind,this.popup.kind==='settings'?this.defaultAnchor():this.popup.anchor,this.popup.generation),suspended};if(this.popupWindow)this.setBoundsIfChanged(this.popupWindow,this.popup.bounds);}
  }
  private setBoundsIfChanged(win:BrowserWindow,bounds:Rect):void {const old=win.getBounds();if(Object.keys(bounds).some(k=>old[k as keyof Rect]!==bounds[k as keyof Rect]))win.setBounds(bounds);}
  private recoveryBounds():Rect {const w=this.selectedDisplay().workArea;return {x:w.x+w.width-26,y:this.store.value.dock==='top'?w.y+4:w.y+w.height-44,width:26,height:40};}
  private captureMouse(capture:boolean):void {const ignore=!capture||this.mode==='hidden';if(this.ignoresMouse!==ignore){this.overlay.setIgnoreMouseEvents(ignore,{forward:true});this.ignoresMouse=ignore;this.syncFieldPresentation();}}
  private cancelFocus(owner?:'popup'|'arena'):void {if(owner&&owner!==this.pendingFocusOwner)return;if(this.pendingFocus)app.removeListener('did-become-active',this.pendingFocus);this.pendingFocus=undefined;this.pendingFocusOwner=undefined;clearTimeout(this.focusCleanup);}
  private focusInput():void {
    this.cancelFocus();const generation=this.popup?.generation;
    const focus=()=>{const win=this.popupWindow;if(!win||win.isDestroyed()||!this.keyboard||!this.popup||this.popup.generation!==generation||!win.isVisible())return;win.focus();win.webContents.focus();};
    if(process.platform==='darwin'){this.pendingFocusOwner='popup';this.pendingFocus=()=>{this.cancelFocus('popup');focus();};app.once('did-become-active',this.pendingFocus);this.focusCleanup=setTimeout(()=>this.cancelFocus('popup'),1500);this.focusCleanup.unref();app.focus({steal:true});}focus();
  }
  enter():void {this.workingElsewhere=false;if(this.mode==='hidden'||!this.store.value.interactionEnabled)return;this.resumeInventory();if(this.popup){this.resumePopup(this.popup.generation);return;}this.mode='interaction';this.captureMouse(true);this.broadcast();}
  release():void {if(this.mode==='hidden')return;this.closePopup(false);this.mode='display';if(this.view!=='street'){this.view='street';this.position();}this.captureMouse(false);this.broadcast();}
  hide():void {
    this.closeTower();this.closeArena();this.closeInventory(false);this.closePopup(false,true);this.localMessage=null;this.mode='hidden';this.epoch++;this.captureMouse(false);
    this.overlay.hide();this.overlay.destroy();this.overlay=this.createOverlay();this.overlayCold=true;this.overlayLoading=false;this.ignoresMouse=true;
    this.showRecovery();this.broadcast();
  }
  restore():void {
    this.closePopup(false);this.mode='display';this.view='street';this.workingElsewhere=false;this.captureMouse(false);this.position();
    if(this.overlayCold)void this.loadOverlay();else{this.recovery.hide();if(!this.overlay.isVisible())this.overlay.showInactive();}
    this.broadcast();
  }
  setView(view:View):void {if(view==='field'&&!this.game.state.profile?.run&&!this.partyField?.state.view)throw Error('没有进行中的远征。');if(this.mode==='hidden'||!this.store.value.interactionEnabled)return;this.workingElsewhere=false;this.closePopup(false);this.mode='interaction';this.view=view;this.position();this.broadcast();}
  private defaultAnchor():Rect {const b=this.overlay.getBounds();return {x:Math.max(0,b.width-69),y:this.store.value.dock==='top'?7:Math.max(0,b.height-37),width:29,height:29};}
  private popupLayout(kind:PopupKind,anchor:Rect,generation:number):PopupState {
    const sizes={chapter:{width:430,height:370},settings:{width:368,height:532},actor:{width:172,height:100},dialogue:{width:328,height:218},shop:{width:760,height:650},alchemy:{width:760,height:650},adventure:{width:760,height:650},room:{width:354,height:500}};
    const layout=popoverBounds(this.selectedDisplay().workArea,this.overlay.getBounds(),anchor,sizes[kind],this.store.value.dock);const bounds=(kind==='shop'||kind==='alchemy'||kind==='chapter')?this.panelLayout.place('shop',layout.bounds,[this.selectedDisplay().workArea,...this.displays().filter(d=>d.id!==this.selectedDisplay().id).map(d=>d.workArea)]):layout.bounds;return {kind,generation,anchor:{...anchor},...layout,bounds,detached:(kind==='shop'||kind==='alchemy'||kind==='chapter')&&this.panelLayout.has('shop'),suspended:false};
  }

  private chapterState():ChapterPresentation {
    const p=this.game?.state.profile;
    if(this.chapterPresentation.quote&&(!p||!this.popup||!this.chapterSession.valid(p,this.popup.generation))){this.chapterSession.cancel();this.chapterPresentation.quote=undefined;}
    return this.chapterPresentation;
  }
  private openExpeditionFromSettings(owner:string,generation:number):ShellState {
    this.assertPopupGeneration(generation,'settings');const win=this.popupWindow;
    if(owner!=='popup'||!win||win.isDestroyed()||!win.isVisible()||win.isMinimized()||this.popup!.suspended||this.mode==='hidden'||this.workingElsewhere||!this.store.value.interactionEnabled)throw Error('设置已暂收或入口已过期，请重新打开。');
    this.openPopup('adventure',this.popup!.anchor);return this.state();
  }
  /** Explicit addition inside the original expedition panel; never attaches a legacy trip. */
  private partyCommand(owner:string,command:PartyCommand):Promise<ShellState>{
    const accepted=this.popupWindow,popup=this.popup,epoch=this.epoch,roomEpoch=this.room.state.roomEpoch;
    const guard=()=>{this.assertPopupGeneration(command.generation,'adventure');if(this.closing||this.quitting||owner!=='popup'||this.popupWindow!==accepted||this.popup!==popup||this.epoch!==epoch||command.roomEpoch!==roomEpoch||this.room.state.roomEpoch!==roomEpoch||!accepted||accepted.isDestroyed()||!accepted.isVisible()||accepted.isMinimized()||this.popup!.suspended||this.mode==='hidden'||this.workingElsewhere||!this.store.value.interactionEnabled)throw Error('组队整备已暂收或过期，请重新打开。');};
    guard();return this.gameplayGate.run(async()=>{guard();await this.dungeon.reconcile();guard();if((this.action.state.run&&!this.action.state.settled)||(this.dungeon.state.run&&!this.dungeon.state.settled))throw Error('请先带回独立地牢战利品');await this.partyField.command(command,guard);if((command.op==='start'||command.op==='open')&&this.partyField.state.view){this.closePopup(false);this.setView('field');}this.broadcast();return this.state();});
  }
  private partyControl(owner:string,command:PartyControl):Promise<ShellState>{const accepted=this.overlay;const guard=()=>assertFieldAccess({accepted:!this.closing&&!this.quitting&&owner==='overlay'&&this.overlay===accepted&&!accepted.isDestroyed(),epoch:this.epoch,visible:!accepted.isDestroyed()&&accepted.isVisible()&&!accepted.isMinimized(),hidden:this.mode==='hidden',interaction:this.store.value.interactionEnabled,workingElsewhere:this.workingElsewhere},command.epoch);guard();return this.gameplayGate.run(async()=>{guard();await this.partyField.control(command,guard);if(command.intent.kind==='return')this.setView('street');this.broadcast();return this.state();});}
  private openFieldFromAdventure(owner:string,generation:number,supply?:'herbal-bandage'|'mining-tonic'|null):Promise<ShellState> {
    const accepted=this.popupWindow,popup=this.popup,epoch=this.epoch;
    const guard=()=>{
      this.assertPopupGeneration(generation,'adventure');
      if(owner!=='popup'||this.popup!==popup||this.popupWindow!==accepted||this.epoch!==epoch||!accepted||accepted.isDestroyed()||!accepted.isVisible()||accepted.isMinimized()||this.popup!.suspended||this.mode==='hidden'||this.workingElsewhere||!this.store.value.interactionEnabled)throw Error('远征面板已暂收或入口已过期，请重新打开。');
    };
    guard();return this.gameplayGate.run(async()=>{
      guard();await this.dungeon.reconcile();guard();
      if((this.action.state.run&&!this.action.state.settled)||(this.dungeon.state.run&&!this.dungeon.state.settled))throw Error('请先带回独立地牢战利品。');
      const p=await this.game.authoritativeProfile();guard();
      if(p.leisure.run)throw Error('悠游冒险进行中，请先结束悠游冒险。');
      if(p.run&&!p.run.field)throw Error('当前远征进行中，请等远征结束或先回营，再进入底部野外。');
      if(!p.run){
        if(p.job!=='keeper')throw Error('先在补给店完成任职试餐。');
        if(p.bag.ration<1)throw Error('缺少旅行口粮，请在补给店制作。');
        await this.game.command({sequence:p.sequence+1,requestId:crypto.randomUUID(),action:{type:'field-enter',budget:Math.min(9,p.bag.ration),...(supply!==undefined?{supply}:{})}});
        guard();
      }
      guard();this.closePopup(false);this.setView('field');this.broadcast();return this.state();
    });
  }
  private fieldCommand(owner:string,command:FieldControl):Promise<ShellState> {
    const accepted=this.overlay;
    const guard=()=>assertFieldAccess({accepted:owner==='overlay'&&this.overlay===accepted&&!accepted.isDestroyed(),epoch:this.epoch,visible:!accepted.isDestroyed()&&accepted.isVisible()&&!accepted.isMinimized(),hidden:this.mode==='hidden',interaction:this.store.value.interactionEnabled,workingElsewhere:this.workingElsewhere},command.epoch);
    guard();return this.gameplayGate.run(async()=>{
      guard();
      if(command.intent.kind==='enter'){await this.dungeon.reconcile();guard();if((this.action.state.run&&!this.action.state.settled)||(this.dungeon.state.run&&!this.dungeon.state.settled))throw Error('请先带回独立地牢战利品。');}
      const p=await this.game.authoritativeProfile();guard();
      const r=p.run;
      if(r?(command.runId!==r.id||command.floor!==(r.field?.floor??0)):command.runId!==undefined)throw Error('冒险趟次已变化，请重新点选。');
      const i=command.intent;let action:GameAction|undefined;
      if(i.kind==='enter'){
        if(!r){if(p.job!=='keeper')throw Error('先在补给店完成任职试餐。');if(p.bag.ration<1)throw Error('缺少旅行口粮，请在补给店制作。');}
        if(r&&!r.field)throw Error('当前远征进行中，请等远征结束或先回营，再进入底部野外。');
        if(!r)action={type:'field-enter',budget:Math.max(1,Math.min(9,p.bag.ration))};
      }else{
        if(this.view!=='field'||!r?.field)throw Error('请先进入底部冒险。');
        action=i.kind==='mode'?{type:'field-mode',runId:r.id,mode:i.mode}:i.kind==='target'?{type:'field-target',runId:r.id,floor:r.field.floor,target:i.target}:{type:'field-return',runId:r.id};
      }
      guard();if(action)await this.game.command({sequence:p.sequence+1,requestId:crypto.randomUUID(),action});
      guard();if(i.kind==='enter'){this.closePopup(false);this.mode='interaction';this.setView('field');}else if(i.kind==='return')this.setView('street');
      this.broadcast();return this.state();
    });
  }
  private syncFieldPresentation():void {
    if(!this.game)return;
    const p=this.presentation.snapshot().overlay;
    const active=this.view==='field'&&p.shown&&(p.focused||!this.ignoresMouse)&&!this.workingElsewhere&&this.mode!=='hidden'&&this.store.value.interactionEnabled&&!this.overlay.isDestroyed()&&this.overlay.isVisible();
    void this.game.setPresentationContext(active).catch(()=>{});this.partyField?.setPresentation(active);
  }
  private chapterCommand(owner:string,command:ChapterCommand):Promise<ShellState> {
    const guard=()=>{
      if(!this.store.value.interactionEnabled||this.mode==='hidden'||this.workingElsewhere||!chapterGenerationAllowed(owner,command.generation,this.epoch,this.popup))throw Error('章节窗口已暂收或操作已过期。');
      const win=owner==='popup'?this.popupWindow:owner==='tower'?this.towerWindow:owner==='overlay'?this.overlay:null;if(!win||win.isDestroyed()||!win.isVisible())throw Error('章节窗口当前不可操作。');
      if(owner==='popup'&&!['chapter','settings'].includes(this.popup!.kind))throw Error('请在章节窗口操作。');
      if(owner==='tower'&&(this.towerSuspended||!this.towerWindow))throw Error('成就之塔已暂收。');
    };
    guard();return this.gameplayGate.run(async()=>{
      guard();
      if(command.type==='chapter-demo-end'){
        const opening=this.chapterPresentation.opening;
        if(owner!=='overlay'||!opening||opening.session!==command.session||opening.phase!=='playing')throw Error('演示会话已过期。');
        this.chapterPresentation.opening={...opening,phase:'finished',outcome:command.outcome};this.openPopup('chapter',this.defaultAnchor());this.broadcast();return this.state();
      }
      let p=await this.game.authoritativeProfile();guard();
      const perform=async(action:GameAction)=>{await this.game.command({sequence:p.sequence+1,requestId:crypto.randomUUID(),action});p=this.game.state.profile!;};
      if(command.type==='chapter-confirm'){
        if(owner!=='popup'||this.popup!.kind!=='chapter')throw Error('采购确认仅属于章节窗口。');
        const action=this.chapterSession.confirm(p,command.generation,command.token);this.chapterPresentation.quote=undefined;await perform(action);
      }else if(command.op==='open'||command.op==='replay'){
        if(owner==='tower'&&command.op==='open'&&chapterView(p).step==='complete'){this.suspendTower();this.openInventory('items');this.broadcast();return this.state();}
        if(command.op==='replay'||!p.chapter&&!this.chapterPresentation.opening){
          if(owner==='tower')this.suspendTower();this.closePopup(false);this.mode='interaction';
          this.chapterPresentation={location:'demo',replay:command.op==='replay',opening:{session:++this.demoSession,phase:'playing'}};
        }else{
          this.chapterPresentation={...this.chapterPresentation,location:chapterView(p).enrolled?chapterView(p).target:'demo'};
          if(owner==='tower')this.suspendTower();this.openPopup('chapter',this.defaultAnchor());
          if(this.chapterPresentation.location!=='demo')this.chapterNavigate(this.chapterPresentation.location);
        }
      }else if(command.op==='start'||command.op==='skip'||command.op==='resume'){
        await perform({type:command.op==='start'?'chapter-start':command.op==='skip'?'chapter-skip':'chapter-resume'});
        this.chapterSession.cancel();this.chapterPresentation={location:'demo',replay:false};
        if(command.op==='skip')this.closePopup(false);else{if(owner==='tower')this.suspendTower();this.openPopup('chapter',this.defaultAnchor());this.chapterPresentation.location=chapterView(p).target;this.chapterNavigate(chapterView(p).target);}
      }else{
        if(owner!=='popup'||this.popup!.kind!=='chapter')throw Error('请在当前章节面板操作。');
        const intent=chapterIntent(p,this.game.state.partySize),target=intent.location;
        if(command.op==='cancel'){this.chapterSession.cancel();this.chapterPresentation.quote=undefined;}
        else if(command.op==='more'){
          this.chapterSession.cancel();this.chapterPresentation.quote=undefined;
          if(target==='equipment'||target==='tower'){this.openInventory('items');this.closePopup(false);}else if(target==='expedition'){this.openPopup('adventure',this.defaultAnchor());}else{this.activeShop='shop-bakery';this.view='interior';this.openPopup('shop',this.defaultAnchor());}
        }else if(this.chapterPresentation.location!==target){this.chapterSession.cancel();this.chapterPresentation.quote=undefined;this.chapterPresentation.location=target;this.chapterNavigate(target);}
        else if(command.op==='preview'){this.chapterPresentation.quote=this.chapterSession.prepare(p,command.generation);}
        else if(command.op==='perform'){
          this.chapterSession.cancel();this.chapterPresentation.quote=undefined;
          if(intent.purchase)throw Error('采购需要先预览并主动确认。');
          if(intent.reason)throw Error(intent.reason);
          if(intent.action){
            if(intent.action.type==='expedition-depart'){await this.dungeon.reconcile();guard();if((this.action.state.run&&!this.action.state.settled)||(this.dungeon.state.run&&!this.dungeon.state.settled))throw Error('请先带回主动冒险战利品。');p=await this.game.authoritativeProfile();guard();const fresh=chapterIntent(p,this.game.state.partySize);if(fresh.action?.type!=='expedition-depart'||fresh.reason)throw Error(fresh.reason||'当前步骤已变化。');await perform(fresh.action);this.closePopup(false);this.setView('field');}else await perform(intent.action);
          }else if(chapterView(p).step==='running'){this.closePopup(false);this.setView('field');}else if(chapterView(p).step==='complete'){this.openInventory('items');this.closePopup(false);}
        }
      }
      this.broadcast();return this.state();
    });
  }
  private chapterNavigate(target:ChapterPresentation['location']):void {
    if(target==='shop'||target==='equipment'){this.activeShop='shop-bakery';this.view='interior';}
    else if(target==='tower'){this.openTower();return;}
    else if(target==='expedition')this.view=this.game.state.profile?.run?'field':'street';
    this.position();
  }
  private popupAllowsNativeFocus():boolean{return this.keyboard||this.popup?.kind==='shop'||this.popup?.kind==='alchemy'||this.popup?.kind==='room';}
  openSettings(anchor=this.defaultAnchor()):void {if(this.popup?.kind==='settings'){this.closePopup();return;}this.openPopup('settings',anchor);}
  openPopup(kind:PopupKind,anchor:Rect):void {
    this.towerNavigation=undefined;this.inventoryNavigation=undefined;
    this.cancelFocus();
    clearTimeout(this.popupDisposeTimer);this.popupDisposeTimer=undefined;this.workingElsewhere=false;
    if((this.mode==='hidden'&&kind!=='settings')||(kind!=='settings'&&!this.store.value.interactionEnabled))return;
    if(kind!=='settings')this.mode='interaction';
    const b=this.overlay.getBounds();if(anchor.x+anchor.width<0||anchor.x>b.width||anchor.y+anchor.height<0||anchor.y>b.height)throw new Error('面板锚点在街道之外。');
    this.chapterSession.cancel();this.chapterPresentation.quote=undefined;
    this.closePopup(false);clearTimeout(this.popupDisposeTimer);this.popupDisposeTimer=undefined;this.popup=this.popupLayout(kind,anchor,++this.generation);this.popupDataReady=0;this.keyboard=kind==='dialogue';
    if(!this.popupWindow||this.popupWindow.isDestroyed()){
      this.popupNativeReady=false;
      const win=new BrowserWindow({...this.popup.bounds,show:false,frame:false,transparent:true,backgroundColor:'#00000000',hasShadow:false,
        alwaysOnTop:false,focusable:this.popupAllowsNativeFocus(),skipTaskbar:true,resizable:false,movable:kind==='shop'||kind==='alchemy'||kind==='chapter',minimizable:false,maximizable:false,fullscreenable:false,title:APP_NAME+' · 面板',webPreferences:this.preferences()});
      this.popupWindow=win;this.guardWindow(win);this.trackPresentation('popup',win);
      win.on('moved',()=>{if(this.popupWindow!==win||!this.popup||!['shop','alchemy','chapter'].includes(this.popup.kind)||!win.isVisible())return;this.popup.bounds=win.getBounds();this.popup.detached=true;this.panelLayout.save('shop',this.popup.bounds);this.broadcast();});
      win.on('blur',()=>{if(this.popupWindow===win&&this.keyboard)this.suspendPopup();});
      win.on('close',event=>{if(!this.quitting){event.preventDefault();this.closePopup();}});
      win.on('closed',()=>{if(this.popupWindow===win){this.popupWindow=null;this.popup=null;this.towerNavigation=undefined;this.popupNativeReady=false;this.popupDataReady=0;this.keyboard=false;this.cancelFocus('popup');}});
      win.once('ready-to-show',()=>{if(this.popupWindow!==win)return;this.popupNativeReady=true;this.showPopupIfReady();});
      void win.loadFile(this.page,{query:{page:'popover'}}).catch(()=>{
        if(this.popupWindow===win){this.store.warnings.push('浮出面板加载失败，可重新打开。');this.closePopup(false,true);this.broadcast();}
        else if(!win.isDestroyed())win.destroy();
      });
    }else{
      this.popupWindow.setMovable(kind==='shop'||kind==='alchemy'||kind==='chapter');this.setBoundsIfChanged(this.popupWindow,this.popup.bounds);const focusable=this.popupAllowsNativeFocus();if(this.popupWindow.isFocusable()!==focusable)this.popupWindow.setFocusable(focusable);
    }
    this.broadcast();
  }
  closePopup(broadcast=true,releaseImmediately=false):void {
    this.chapterSession.cancel();this.chapterPresentation.quote=undefined;
    this.towerNavigation=undefined;this.inventoryNavigation=undefined;
    this.cancelFocus('popup');clearTimeout(this.popupDisposeTimer);this.popupDisposeTimer=undefined;if(this.popup?.kind==='settings')this.cameraX=this.store.value.cameraX;this.popup=null;this.popupDataReady=0;this.keyboard=false;
    const win=this.popupWindow;
    if(win&&!win.isDestroyed()){
      win.hide();if(win.isFocusable())win.setFocusable(false);
      const release=()=>{if(this.popupWindow===win&&!this.popup&&!win.isDestroyed())win.destroy();};
      if(releaseImmediately)release();else{this.popupDisposeTimer=setTimeout(release,1000);this.popupDisposeTimer.unref();}
    }
    if(broadcast)this.broadcast();
  }
  suspendPopup():void {
    if(!this.popup||this.popup.suspended)return;this.chapterSession.cancel();this.chapterPresentation.quote=undefined;this.cancelFocus('popup');this.popup.suspended=true;this.keyboard=false;
    const win=this.popupWindow;if(win&&!win.isDestroyed()){win.hide();if(win.isFocusable())win.setFocusable(false);}this.publishPresentation();this.broadcast();
  }
  resumePopup(generation:number):void {
    this.assertPopupGeneration(generation);if(this.mode==='hidden')return;this.workingElsewhere=false;this.cancelFocus();this.popup!.suspended=false;this.keyboard=false;
    const win=this.popupWindow;if(win&&!win.isDestroyed()){const focusable=this.popupAllowsNativeFocus();if(win.isFocusable()!==focusable)win.setFocusable(focusable);}
    this.broadcast();this.showPopupIfReady();if(win&&!win.isDestroyed()&&win.isVisible())win.moveTop();
  }
  private showPopupIfReady():void {
    const win=this.popupWindow;if(!win||win.isDestroyed()||!this.popup||this.popup.suspended||!this.popupNativeReady||this.popupDataReady!==this.popup.generation)return;
    if(!win.isVisible()){win.showInactive();win.moveTop();}if(this.keyboard)this.focusInput();
  }
  openInventory(page:'items'|'pet'='items'):void {
    if(this.mode==='hidden')return;this.workingElsewhere=false;
    if(this.inventory&&this.inventoryWindow&&!this.inventoryWindow.isDestroyed()){if(this.inventory.page!==page){this.game.inventoryCancel();this.inventory.page=page;}if(this.inventory.suspended)this.resumeInventory();this.showInventoryIfReady();this.broadcast();return;}
    const area=this.selectedDisplay().workArea,width=Math.min(this.inventorySize.width,area.width),height=Math.min(this.inventorySize.height,area.height),base={x:area.x+area.width-width-24,y:area.y+area.height-height-this.store.value.height-10,width,height};
    this.inventory={generation:++this.generation,page,bounds:this.panelLayout.place('inventory',base,[area,...this.displays().filter(d=>d.id!==this.selectedDisplay().id).map(d=>d.workArea)]),suspended:false};
    this.inventoryNativeReady=false;this.inventoryDataReady=0;
    const win=new BrowserWindow({...this.inventory.bounds,show:false,frame:false,transparent:true,backgroundColor:'#00000000',hasShadow:false,alwaysOnTop:false,focusable:true,skipTaskbar:true,resizable:true,minWidth:Math.min(420,area.width),minHeight:Math.min(360,area.height),movable:true,minimizable:false,maximizable:false,fullscreenable:false,title:APP_NAME+' · 背包',webPreferences:this.preferences()});
    this.inventoryWindow=win;this.guardWindow(win);
    win.once('ready-to-show',()=>{if(this.inventoryWindow===win){this.inventoryNativeReady=true;this.showInventoryIfReady();}});
    // Focusable only for explicitly clicked inventory keyboard/menu interaction; opening stays showInactive.
    const remember=()=>{if(this.inventoryWindow!==win||!this.inventory)return;const current=win.getBounds(),area=screen.getDisplayMatching(current).workArea,bounds=clampPanel(current,area);win.setMinimumSize(Math.min(420,area.width),Math.min(360,area.height));this.inventory.bounds=bounds;this.inventorySize={width:bounds.width,height:bounds.height};this.setBoundsIfChanged(win,bounds);if(win.isVisible())this.panelLayout.save('inventory',bounds);};
    win.on('moved',remember);win.on('resized',remember);
    win.on('close',event=>{if(!this.quitting){event.preventDefault();this.closeInventory();}});
    win.on('closed',()=>{if(this.inventoryWindow===win){this.game.inventoryCancel();this.inventoryWindow=null;this.inventory=null;}});
    void win.loadFile(this.page,{query:{page:'inventory'}}).catch(()=>{if(this.inventoryWindow===win){this.store.warnings.push('背包加载失败，请重试。');this.closeInventory();}});this.broadcast();
  }
  /** Presentation-only destinations; authority is the inventory owner/generation gate above. */
  private navigateInventory(target:InventoryTarget):void {
    if(!this.store.value.interactionEnabled)throw Error('鼠标交互已关闭，请先在设置中开启。');
    const casual=['kitchen','camp-growth','collection','companions'].includes(target);
    if(casual&&this.room.inRoom())throw Error('请先离开好友房间，再前往地牢营地。');
    if(casual)this.openArena(false,true);
    else{const alchemy=target.startsWith('alchemy');this.activeShop=alchemy?'shop-alchemy':'shop-bakery';this.view='interior';this.mode='interaction';this.openPopup(alchemy?'alchemy':'shop',this.defaultAnchor());}
    this.inventoryNavigation={id:++this.inventoryNavigationId,target};this.broadcast();
  }
  closeInventory(broadcast=true):void{this.game.inventoryCancel();const win=this.inventoryWindow;this.inventoryWindow=null;this.inventory=null;this.inventoryNativeReady=false;this.inventoryDataReady=0;if(win&&!win.isDestroyed())win.destroy();if(broadcast)this.broadcast();}
  private suspendInventory():void{if(!this.inventory)return;this.game.inventoryCancel();this.inventory.suspended=true;this.inventoryWindow?.hide();}
  private resumeInventory():void{if(!this.inventory||!this.inventory.suspended)return;this.inventory.suspended=false;this.showInventoryIfReady();}
  private showInventoryIfReady():void{if(this.inventory&&!this.inventory.suspended&&this.inventoryNativeReady&&this.inventoryDataReady===this.inventory.generation&&this.inventoryWindow&&!this.inventoryWindow.isDestroyed()){if(!this.inventoryWindow.isVisible())this.inventoryWindow.showInactive();this.inventoryWindow.moveTop();}}
  /** Hidden native preflight never shows or activates any destination window. */
  openTower(preflightHidden=false):void {
    if(this.mode==='hidden'&&!preflightHidden)return;
    this.towerPreflightHidden=preflightHidden;this.towerSuspended=false;
    if(!preflightHidden){this.workingElsewhere=false;this.closePopup(false);}
    if(this.towerWindow&&!this.towerWindow.isDestroyed()){if(!preflightHidden){if(this.towerWindow.isMinimized())this.towerWindow.restore();this.towerWindow.showInactive();}this.broadcast();return;}
    const area=this.selectedDisplay().workArea,width=Math.min(1040,area.width),height=Math.min(720,area.height);
    const win=new BrowserWindow({x:Math.round(area.x+(area.width-width)/2),y:Math.round(area.y+(area.height-height)/2),width,height,minWidth:Math.min(760,width),minHeight:Math.min(650,height),show:false,backgroundColor:'#16272a',title:APP_NAME+' · 成就之塔',alwaysOnTop:false,webPreferences:this.preferences()});
    this.towerWindow=win;this.guardWindow(win);this.trackPresentation('tower',win);
    win.once('ready-to-show',()=>{if(this.towerWindow===win&&!this.towerSuspended&&!this.towerPreflightHidden&&this.mode!=='hidden')win.showInactive();});
    win.on('close',event=>{if(!this.quitting){event.preventDefault();this.closeTower();}});
    win.on('minimize',()=>{if(this.towerWindow===win){this.towerSuspended=true;this.broadcast();}});
    win.on('restore',()=>{if(this.towerWindow===win){this.towerSuspended=false;this.broadcast();}});
    win.on('closed',()=>{if(this.towerWindow===win){this.towerWindow=null;this.towerSuspended=false;}});
    win.webContents.on('render-process-gone',()=>{if(this.towerWindow===win)this.closeTower();});
    void win.loadFile(this.page,{query:{page:'tower'}}).catch(()=>{if(this.towerWindow===win){this.store.warnings.push('成就之塔加载失败，请重试。');this.closeTower();}});this.broadcast();
  }
  closeTower():void{const win=this.towerWindow;this.towerWindow=null;this.towerSuspended=false;if(win&&!win.isDestroyed())win.destroy();this.broadcast();}
  private suspendTower():void{if(!this.towerWindow)return;this.towerSuspended=true;this.towerWindow.hide();}
  private async towerCommand(command:Command):Promise<ShellState>{
    if(command.type==='tower-close'){this.closeTower();return this.state();}
    if(command.type==='tower-minimize'){this.towerWindow?.minimize();return this.state();}
    if(command.type!=='tower-action'&&command.type!=='tower-link'&&command.type!=='tower-route')throw Error('成就之塔无此窗口权限');
    if(this.towerSuspended)throw Error('成就之塔已暂收，请点击营地的塔恢复。');
    if(command.type==='tower-action')return this.gameplayGate.run(async()=>{if(!isTowerOnlyAction(command.envelope.action))throw Error('成就之塔仅接受固定领奖与精通操作');await this.game.command(command.envelope);this.broadcast();return this.state();});
    if(command.type==='tower-route'){const profile=this.game.state.profile;if(this.game.state.status!=='ready'||!profile)throw Error('营地档案尚未就绪。');const route=towerDestination(profile,command.floor,command.choice);if(route.reason)throw Error(route.reason);this.navigateTower(route.target,route.context);}else this.navigateTower(command.target);return this.state();
  }
  private navigateTower(target:TowerTarget,context?:TowerRouteContext):void{
    const casual=campTowerTargets.includes(target);
    if(casual&&this.room.inRoom())throw Error(towerRoomReason);
    const hidden=this.towerPreflightHidden;this.suspendTower();
    if(casual)this.openArena(hidden,true);
    else{
      const alchemy=target.startsWith('alchemy');this.activeShop=alchemy?'shop-alchemy':'shop-bakery';
      // The trusted link opens the actual workspace, with the same generation gate as a street click.
      this.view='interior';this.mode='interaction';this.openPopup(alchemy?'alchemy':'shop',this.defaultAnchor());
      if(hidden){this.popup!.suspended=true;this.popupWindow?.hide();}
    }
    this.towerNavigation={id:++this.towerNavigationId,target,...(context?{context}:{})};this.broadcast();
    if(hidden){const destination=['dungeon','garden','companions','kitchen','camp-growth','collection','village-projects'].includes(target)?this.arenaWindow:this.popupWindow;if(destination&&!destination.isDestroyed())destination.webContents.send(channels.update,this.state());}
  }
  private focusArena(win:BrowserWindow):void {
    this.cancelFocus();
    const focus=()=>{if(this.arenaWindow!==win||!this.arenaRequested||win.isDestroyed()||!win.isVisible()||win.isMinimized())return;win.focus();win.webContents.focus();};
    // The camp is deliberately non-focusable. An explicit adventure click must
    // activate the macOS app as well as its newly focusable native window.
    if(process.platform==='darwin'){this.pendingFocusOwner='arena';this.pendingFocus=()=>{this.cancelFocus('arena');focus();};app.once('did-become-active',this.pendingFocus);this.focusCleanup=setTimeout(()=>this.cancelFocus('arena'),1500);this.focusCleanup.unref();app.focus({steal:true});}
    focus();
  }
  openArena(preflightHidden=false,passive=false):void {
    this.towerNavigation=undefined;this.inventoryNavigation=undefined;
    if(this.room.inRoom())throw Error('主动冒险当前仅支持单机，请先离开营地房间。');
    if(this.mode==='hidden'&&!preflightHidden)return;this.closePopup(false);this.workingElsewhere=false;this.arenaRequested=true;
    const surface=passive?'casual':'arena';
    // A destination owns its native window. Changing surfaces pauses the retained
    // runtime before destroying the old owner; navigation never starts or settles it.
    if(this.arenaWindow&&!this.arenaWindow.isDestroyed()&&this.arenaSurface!==surface){this.closeArena();this.arenaRequested=true;}
    if(this.arenaWindow&&!this.arenaWindow.isDestroyed()){if(!preflightHidden){if(passive)this.arenaWindow.showInactive();else{this.arenaWindow.show();this.focusArena(this.arenaWindow);}}if(this.room.inRoom())void this.room.setLocalActive(this.arenaWindow.isFocused()).catch(()=>{});this.broadcast();return;}
    const area=this.selectedDisplay().workArea,width=Math.min(1040,area.width),height=Math.min(760,area.height);
    const win=new BrowserWindow({x:Math.round(area.x+(area.width-width)/2),y:Math.round(area.y+(area.height-height)/2),width,height,minWidth:Math.min(800,width),minHeight:Math.min(620,height),show:false,backgroundColor:'#142321',title:APP_NAME+(passive?' · 悠游营地':' · 手动地牢'),alwaysOnTop:false,webPreferences:{...this.preferences(),backgroundThrottling:true}});
    this.arenaWindow=win;this.arenaSurface=surface;this.guardWindow(win);
    win.on('close',event=>{if(!this.quitting&&this.arenaWindow===win){event.preventDefault();this.closeArena();}});
    win.on('blur',()=>{if(this.arenaWindow===win)this.pauseArena();});win.on('minimize',()=>{if(this.arenaWindow===win)this.pauseArena();});
    const refresh=()=>{if(this.arenaWindow===win&&this.arenaRequested)this.broadcast();};
    win.on('focus',refresh);win.on('restore',refresh);
    win.on('closed',()=>{if(this.arenaWindow===win){this.arenaWindow=null;this.arenaSurface=null;this.towerNavigation=undefined;}});
    const failed=()=>{if(this.arenaWindow===win)this.closeArena();else if(!win.isDestroyed())win.destroy();};
    win.webContents.on('render-process-gone',failed);
    win.once('ready-to-show',()=>{if(this.arenaWindow===win&&this.arenaRequested&&!preflightHidden){if(passive)win.showInactive();else{win.show();this.focusArena(win);}}});
    void win.loadFile(this.page,{query:{page:surface}}).catch(failed);this.broadcast();
  }
  private pauseArena():void {void this.dungeon?.pause().catch(()=>{});if(this.room?.inRoom())void this.room.setLocalActive(false).catch(()=>{});if(!this.room?.currentRoomRun())void this.action?.pause().catch(()=>{});}
  closeArena():void {this.towerNavigation=undefined;this.inventoryNavigation=undefined;this.arenaRequested=false;this.cancelFocus('arena');this.pauseArena();const win=this.arenaWindow;this.arenaWindow=null;this.arenaSurface=null;if(win&&!win.isDestroyed()){win.hide();win.destroy();}}
  private arenaCommand(command:Command):Promise<ShellState>{
    // IPC trust is checked at receipt; retain that native owner across the queue.
    const owner=this.arenaWindow;
    return this.gameplayGate.run(()=>{if(!owner||owner.isDestroyed()||this.arenaWindow!==owner)throw Error('主动冒险窗口已变化，请重新操作。');return this.arenaCommandInner(command,owner);});
  }
  private async arenaCommandInner(command:Command,owner:BrowserWindow):Promise<ShellState> {
    const current=()=>this.arenaWindow===owner&&!owner.isDestroyed();
    const guard=()=>{if(!current())throw Error('主动冒险窗口已变化，请重新操作。');};
    guard();
    switch(command.type){
      case 'leisure':await this.game.command(command.envelope);break;
      case 'dungeon-start':
        if(this.room.inRoom())throw Error('地牢当前仅支持单机');
        if(this.action.state.run&&!this.action.state.settled)throw Error('请先结算旧版主动冒险');
        if(!owner.isVisible()||!owner.isFocused())throw Error('请先点击地牢窗口');
        await this.dungeon.start(command.seed,this.action.state.claim);if(current()&&owner.isVisible()&&owner.isFocused()&&!owner.isMinimized()&&!this.workingElsewhere)await this.dungeon.input({type:'pause',paused:false});break;
      case 'dungeon-input':
        if(!owner.isVisible()||((command.input.type!=='pause'||!command.input.paused)&&(!owner.isFocused()||owner.isMinimized())))throw Error('请先点击地牢窗口再继续。');
        await this.dungeon.input(command.input);break;
      case 'dungeon-minimize':this.pauseArena();owner.minimize();break;
      case 'dungeon-close':this.closeArena();break;
      // An authorized settlement must finish even if its renderer is replaced.
      // Only the native close belongs to the original owner after that await.
      case 'dungeon-return':await this.dungeon.settle();if(current())this.closeArena();break;
      case 'dungeon-claim':await this.dungeon.settle();break;
      case 'action-start':
        await this.dungeon.reconcile();guard();
        if(this.dungeon.state.run&&!this.dungeon.state.settled)throw Error('请先结算地牢');
        if(this.room.inRoom())throw Error('主动冒险暂不支持联机');
        if(!owner.isVisible())throw Error('请先打开主动冒险窗口');
        if(this.room.inRoom()){await this.room.setLocalActive(owner.isFocused());guard();await this.room.start(command.weapon);}
        else{await this.action.start(command.weapon);if(current()&&owner.isVisible()&&owner.isFocused()&&!owner.isMinimized()&&!this.workingElsewhere)await this.action.input({type:'pause',paused:false});}break;
      case 'action-input':if(!owner.isVisible()||!owner.isFocused()||(command.input.type==='pause'&&!command.input.paused&&!owner.isFocused()))throw Error('请先点击主动冒险窗口再继续。');if(this.room.currentRoomRun())await this.room.input(command.input);else await this.action.input(command.input);break;
      case 'action-close':this.closeArena();break;
      case 'action-return':if(this.room.currentRoomRun())await this.room.settle();else await this.action.settle();if(current())this.closeArena();break;
      case 'action-claim':if(this.room.currentRoomRun())await this.room.settle();else await this.action.settle();break;
      default:throw Error('不属于主动冒险的指令');
    }
    this.broadcast();return this.state();
  }
  private roomCommand(command:RoomCommand):Promise<ShellState>{if(command.type==='room-leave'&&command.roomEpoch===this.room.state.roomEpoch)this.room.invalidateShares();return this.gameplayGate.run(()=>this.roomCommandInner(command));}
  private async roomCommandInner(command:RoomCommand):Promise<ShellState>{
    if(command.type==='room-open'){this.assertPopupGeneration(command.generation,'settings');this.openPopup('room',this.popup!.anchor);return this.state();}
    this.assertPopupGeneration(command.generation,'room');
    if(command.type==='room-read'){if(this.popup!.suspended||!this.popupWindow?.isVisible()||!this.store.value.interactionEnabled)throw Error('房间已暂收');this.room.markCardsRead();return this.state();}
    if(['room-host','room-join'].includes(command.type))await this.dungeon.reconcile();
    if(['room-host','room-join'].includes(command.type)&&((this.action.state.run&&!this.action.state.settled)||(this.dungeon.state.run&&!this.dungeon.state.settled)))throw Error('请先结算单机主动冒险，再加入营地房间。');
    if(command.type==='room-host')await this.room.hostRoom(command.name,command.bind);
    else if(command.type==='room-join')await this.room.joinRoom(command.name,command.invitation);
    else if(command.type==='room-chat')await this.room.chat(command.text);
    else if(command.type==='room-leave'){if(command.roomEpoch!==this.room.state.roomEpoch)throw Error('房间已变化');await this.partyField.beforeLeave();await this.room.leave(command.roomEpoch);}
    else if(command.type==='room-copy')clipboard.writeText(this.room.invitation());
    else if(command.type==='room-weapon')await this.room.setWeapon(command.weapon);
    this.broadcast();return this.state();
  }
  command(command:Command):ShellState {
    switch(command.type){
      case 'tower-open':if(!this.store.value.interactionEnabled)throw Error('鼠标交互已关闭');this.openTower();break;
      case 'scene-ready':this.sceneReady();break;
      case 'dungeon-portal':if(!this.store.value.interactionEnabled)throw Error('鼠标交互已关闭，请先在设置中开启。');this.openArena(false,true);break;
      case 'inventory-toggle':case 'pet-toggle':{const page=command.type==='pet-toggle'?'pet':'items';if(this.inventory&&!this.inventory.suspended&&this.inventory.page===page)this.closeInventory();else this.openInventory(page);break;}
      case 'play':this.enter();break;
      case 'visit':if(this.mode!=='hidden'&&this.store.value.interactionEnabled){this.activeShop=command.shop;this.setView('interior');}break;
      case 'release':this.release();break;
      case 'hide':this.hide();break;
      case 'restore':this.restore();break;
      case 'resume-popup':this.resumePopup(command.generation);break;
      case 'view':this.setView(command.value);break;
      case 'pointer':this.captureMouse(command.capture);break;
      case 'settings':this.openSettings(command.anchor);break;
      case 'field-view':this.assertPopupGeneration(command.generation,'adventure');if(!this.game.state.profile?.run)throw Error('没有进行中的远征');this.setView('field');break;
      case 'expedition-link':this.assertPopupGeneration(command.generation,'adventure');if(command.target==='inventory'||command.target==='pet'){this.openInventory(command.target==='pet'?'pet':'items');}else{this.activeShop='shop-bakery';this.setView('interior');this.openPopup('shop',this.defaultAnchor());}break;
      case 'adventure-panel':this.openPopup('adventure',command.anchor);break;
      case 'return-camp':throw Error('回营请求必须通过原生IPC');
      case 'alchemy-panel':if(this.view!=='interior'||this.activeShop!=='shop-alchemy')throw Error('请先进入炼金工坊，与店员交谈。');if(this.popup?.kind==='alchemy'&&!this.popup.suspended)this.closePopup();else if(this.popup?.kind==='alchemy')this.resumePopup(this.popup.generation);else this.openPopup('alchemy',command.anchor);break;
      case 'shop-panel':if(this.view!=='interior'||this.activeShop!=='shop-bakery')throw Error('请先进入补给商店，与店员交谈。');if(this.popup?.kind==='shop'&&!this.popup.suspended)this.closePopup();else if(this.popup?.kind==='shop')this.resumePopup(this.popup.generation);else this.openPopup('shop',command.anchor);break;
      case 'game':throw Error('玩法指令必须由当前面板提交。');
      case 'actor':this.openPopup('actor',command.anchor);break;
      case 'talk':this.assertPopupGeneration(command.generation,'actor');this.openPopup('dialogue',this.popup!.anchor);break;
      case 'close-popup':this.assertPopupGeneration(command.generation);this.closePopup();break;
      case 'popup-ready':this.assertPopupGeneration(command.generation);this.popupDataReady=command.generation;this.showPopupIfReady();break;
      case 'input-focus':this.assertPopupGeneration(command.generation);if(this.popup?.kind==='actor')throw new Error('动作菜单不取得键盘焦点');this.keyboard=true;this.popupWindow?.setFocusable(true);this.focusInput();this.broadcast();break;
      case 'camera':this.assertPopupGeneration(command.generation,'settings');this.cameraX=command.value;this.broadcast();break;
      case 'local-text':this.assertPopupGeneration(command.generation,'dialogue');this.localMessage={id:++this.messageId,text:command.text.trim()};this.broadcast();break;
    }
    return this.state();
  }
  settingsChanged():void {this.cameraX=this.store.value.cameraX;if(!this.store.value.interactionEnabled&&this.popup?.kind!=='settings')this.closePopup(false);this.position();this.broadcast();}
  private broadcast():void {
    if(this.closing||this.quitting||this.overlay.isDestroyed()||this.overlay.webContents.isDestroyed())return;
    this.syncFieldPresentation();this.revision++;this.overlay.webContents.setAudioMuted(this.mode==='hidden'||!this.store.value.soundEnabled||this.store.value.mode==='quiet');
    const recipients=[this.mode!=='hidden'&&!this.overlayCold?this.overlay:null,this.popup&&!this.popup.suspended?this.popupWindow:null,this.inventory&&!this.inventory.suspended?this.inventoryWindow:null,this.arenaRequested&&this.arenaWindow?.isVisible()&&!this.arenaWindow.isMinimized()?this.arenaWindow:null,this.towerWindow].filter((win):win is BrowserWindow=>!!win&&!win.isDestroyed()&&!win.webContents.isDestroyed());
    if(recipients.length){const state=this.state();for(const win of recipients)win.webContents.send(channels.update,state);}
  }
  private updateTray():void {this.tray.setContextMenu(Menu.buildFromTemplate([{label:APP_NAME+' · 地下城营地',enabled:false},{label:'恢复营地',click:()=>this.restore()},{label:'立即隐藏并静音',click:()=>this.hide()},{label:'设置',click:()=>this.openSettings()},{type:'separator'},{label:'退出 PixelStreet',click:()=>app.quit()}]));}
  beginClose():void {this.closing=true;this.cancelFocus();}
  dispose():void {if(this.quitting)return;this.closing=true;this.quitting=true;this.cancelFocus();clearTimeout(this.popupDisposeTimer);app.removeListener('did-resign-active',this.onResignActive);app.removeListener('did-become-active',this.onBecomeActive);screen.removeListener('display-added',this.onDisplayChange);screen.removeListener('display-removed',this.onDisplayChange);screen.removeListener('display-metrics-changed',this.onDisplayChange);for(const channel of [channels.inventoryPreview,channels.state,channels.command,channels.save,channels.export,channels.import])ipcMain.removeHandler(channel);this.partyField?.dispose();this.room.dispose();this.game.dispose();this.action.dispose();this.dungeon.dispose();ipcMain.removeAllListeners(channels.dungeonControl);this.tray.destroy();this.towerWindow?.destroy();this.arenaWindow?.destroy();this.inventoryWindow?.destroy();this.popupWindow?.destroy();this.recovery.destroy();this.overlay.destroy();}
}
