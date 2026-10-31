import {Application,Container,Graphics,ImageSource,Rectangle,Sprite,Texture,UPDATE_PRIORITY} from 'pixi.js';
import 'pixi.js/unsafe-eval';
import dungeonAtlas from '../../../assets/dungeon/manifest.json';
import combatAtlas from '../../../assets/combat/manifest.json';
import {activeWeapon,currentRoom,nearbyInteractions,roomDoors,roomFixtures,discoveredRooms,upgradeChoices,reforgeChoices,evolutionInfo,strengthenInfo,transferInfo,mechanismInfo,MECHANISMS,WEAPONS,ROOM_WALL,DOOR_OPENING_WIDTH,doorTriggerRect,hurtShape,movementShape,GEOMETRY_PROFILES,weaponActionGeometry,weaponSpecialInfo,weaponName,weaponForm,isMelee,obstacleAttackRect,projectileWorldBounds,type DungeonInput,type DungeonRun,type Point,type MechanismId,type UpgradeId,type WeaponForm} from '../../../packages/dungeon-core';
import {enemyTelegraph,ENEMY_ATTACK_RULES,SPAWN_WARNING_MS} from '../../../packages/dungeon-core/enemies';
import {WorldCamera,FrameStats,interpolate} from '../../../packages/dungeon-core/foundation';
import {emptyDungeon,bankedDungeonReward,type DungeonSession} from '../../../packages/protocol/dungeon';
import {APP_NAME} from '../identity';
import type {Command,ShellState} from '../../../packages/protocol';
import {icon} from './icons';
import {DungeonAudio,type DungeonSound} from './dungeon-audio';
import {DungeonFeedback} from './dungeon-feedback';
import {DungeonIcons} from './dungeon-art';
import {weaponView,type WeaponView} from './dungeon-weapon-view';
import {altarBranches,growthCards,mechanismHint,replacementCards,transferPreview,type GrowthArt} from './dungeon-growth-ui';
import type {WeaponActionGeometry} from '../../../packages/dungeon-core/weapons';
import {loadDungeonPreferences,saveDungeonPreferences,defaultDungeonPreferences,CONTROL_ACTIONS,CONTROL_LABELS,DEFAULT_BINDINGS,rebindControl,bindingLabel,canonicalCode,controlForCode,movementFromHeld,type ControlAction} from './dungeon-controls';
type Frame={x:number;y:number;width:number;height:number;worldSize:number[];anchor:number[];tint?:number;rotationOffset?:number;nativeDirection?:number};
const names:Record<string,string>={entrance:'传送厅',combat:'守卫室',chest:'藏宝室',rest:'泉水间',shop:'旅商营地',event:'回响密室',elite:'精英守卫',altar:'进阶祭坛',boss:'封印大厅'};
const el=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export async function dungeonPage():Promise<void>{
 document.body.classList.add('dungeon');
 const prefs=(()=>{try{return loadDungeonPreferences(localStorage);}catch{return defaultDungeonPreferences();}})();
 const preferenceFlags=[['showNumbers','伤害数字'],['screenShake','重击震动'],['reducedMotion','减少动态效果'],['effectsEnabled','命中特效'],['showDebug','判定调试'],['audioEnabled','地牢音效']] as const;
 document.title=APP_NAME+' · 手动地牢';
 el('root').innerHTML=`<div id="dungeonWorld" aria-label="地下城战斗区域"></div>
 <div id="dungeonHud"><header class="d-top"><div id="vitals"><div class="d-label" hidden><span>Lv<span id="levelText">1</span></span></div><div class="d-meter health" aria-label="生命"><i id="healthFill"></i><span id="healthText">100 / 100</span></div><div class="d-meter shield" aria-label="护盾"><i id="shieldFill"></i><span id="shieldText">40 / 40</span></div></div><div class="d-heading"><span id="roomText"></span></div><div class="d-actions"><button id="settingsDungeon" title="设置与指南" aria-label="设置与指南">${icon('settings')}</button><button id="pauseDungeon" title="暂停 / Esc" aria-label="暂停">Ⅱ</button><button id="minimizeDungeon" title="最小化" aria-label="最小化">−</button><button id="closeDungeon" title="暂存并关闭" aria-label="暂存并关闭">×</button></div></header>
 <aside class="d-map-panel"><svg id="miniMap" viewBox="0 0 180 145" aria-label="小地图"></svg><span id="roomProgress"></span></aside>
 <div id="bossHud" hidden><b id="bossText"></b><div><i id="bossFill"></i></div></div><div class="d-notice" id="dungeonNotice"></div><div id="worldPrompt" class="d-world-prompt" hidden></div>
 <div class="d-bottom"><div class="d-loadout"><button id="switchDungeon" title="切换武器 / Tab"><span id="weaponIcon">⚔</span><span><b id="weaponText">朴素剑</b><small id="dBackupText" hidden></small></span><kbd data-binding-for="switch">Tab</kbd></button><div id="weaponCharge" class="d-charge-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-label="蓄力进度" hidden><i></i></div><div class="d-loadout-support"><div id="buildText" class="d-build"></div><div id="growthActions" class="d-growth-actions"><span id="essenceDungeon" class="d-essence" data-tooltip="强化精华">${icon('gel')}<b id="essenceCount">0</b></span><button id="strengthenDungeon" type="button" aria-label="强化武器" title="强化武器">${icon('plus')}</button><button id="transferDungeon" type="button" aria-label="强化转移" title="本局一次强化转移">${icon('export')}</button></div></div><div id="evolutionText" class="d-evolution" hidden></div></div><div class="d-tools"><button id="attackDungeon" title="按住攻击" aria-label="按住攻击"><span>⚔</span><kbd data-binding-for="attack">左键</kbd></button><button id="burstDungeon" title="特殊动作 / Q" aria-label="特殊动作"><span>${icon('crystal')}</span><b id="specialResource" class="d-special-resource" hidden></b><kbd data-binding-for="special">Q</kbd></button><button id="wardDungeon" title="守护 / E" aria-label="守护"><span>${icon('check')}</span><kbd data-binding-for="ward">E</kbd></button></div></div>
 <span id="frameText" class="d-frame" title="渲染回调FPS，不是固定配置值"></span><div id="dungeonError" role="status"></div><span id="dungeonDebug" class="d-debug" hidden></span></div>
 <aside id="dungeonSettings" class="d-settings" hidden><div class="d-settings-scroll"><div class="d-settings-title"><b>设置</b><button id="settingsDungeonClose" aria-label="收起设置">×</button></div><label class="d-zoom">视野 <input id="dungeonZoom" type="range" min="0.75" max="2" step="0.05" value="1.5" aria-label="世界缩放"><output id="zoomText">150%</output></label><label class="d-check"><input id="dungeonShowMetrics" type="checkbox">显示帧时间</label>${preferenceFlags.map(([key,label])=>`<label class="d-check"><input data-dungeon-pref="${key}" type="checkbox" ${prefs[key]?'checked':''}>${label}</label>`).join('')}<label class="d-zoom">音量 <input id="dungeonVolume" type="range" min="0" max="1" step="0.05" value="${prefs.audioVolume}" aria-label="地牢音效音量"></label><details class="d-guide-book"><summary role="button">按键</summary><div class="d-bindings">${CONTROL_ACTIONS.map(action=>`<label><span>${CONTROL_LABELS[action]}</span><button type="button" data-bind-action="${action}" aria-pressed="false">${bindingLabel(prefs.bindings[action])}</button></label>`).join('')}</div><p id="bindingMessage" class="d-binding-error" role="status"></p><button id="resetDungeonBindings" type="button">恢复默认</button></details><details class="d-guide-book"><summary role="button">操作指南</summary><p>${(['up','left','down','right'] as const).map(action=>`<span data-binding-for="${action}">${bindingLabel(prefs.bindings[action])}</span>`).join(' ')} 移动<br><span data-binding-for="attack">左键</span> 按住攻击 · <span data-binding-for="special">Q</span> 特殊动作（远程为近身冲击）<br><span data-binding-for="dash">Shift</span> / <span data-binding-for="dashAlt">右键</span> 翻滚 · <span data-binding-for="ward">E</span> 守护<br><span data-binding-for="interact">F</span> 交互 · <span data-binding-for="switch">Tab</span> 换武器 · Esc 暂停</p><p>走过门探索；清房开门。武器需确认拾取，替换后旧武器留在原地。</p><p>清房获得精华，安全时强化武器。Lv5＋适配机制，在祭坛选择进阶。三项机制槽满后可升级或替换。</p><p>冰弓按住攻击蓄力；锤、枪、巨剑按住特殊动作后松开。链刃用特殊动作切换形态。普通弹道方向固定。</p></details></div></aside>
 <section id="dungeonPanel" class="d-panel" hidden></section>`;
 const app=new Application(),world=new Container(),tiles=new Container(),objects=new Container(),units=new Container(),shots=new Container(),arms=new Graphics(),fx=new Graphics(),debugShapes=new Graphics(),labels=new Container(),floorMark=new Graphics(),stats=new FrameStats(),camera=new WorldCamera();
 await app.init({width:innerWidth,height:innerHeight,background:0x0d141a,antialias:false,autoDensity:true,resolution:devicePixelRatio,roundPixels:false,autoStart:false,sharedTicker:false,preference:'webgl',powerPreference:'high-performance'});
 let renderCount=0;app.renderer.runners.prerender.add({prerender:()=>{renderCount++;}});
 el('dungeonWorld').appendChild(app.canvas);app.canvas.tabIndex=0;app.canvas.setAttribute('aria-label','WASD 移动，鼠标瞄准攻击');
 app.stage.addChild(world);world.addChild(tiles,objects,floorMark,arms,units,shots,fx,debugShapes,labels);units.sortableChildren=true;
 const frameFiles=new Map<string,{folder:string;file:string;width:number;height:number}>(),frames=new Map<string,Frame>(),textures=new Map<string,Texture>(),sources:ImageSource[]=[];
 for(const [folder,atlas] of [['dungeon',dungeonAtlas]] as const){
  const image=new Image();image.src=`assets/${folder}/${atlas.atlas.file}`;await image.decode();
  const source=new ImageSource({resource:image,scaleMode:'nearest',autoGenerateMipmaps:false});sources.push(source);
  for(const [id,f] of Object.entries(atlas.atlas.frames)){frames.set(id,f);frameFiles.set(id,{folder,file:atlas.atlas.file,width:atlas.atlas.width,height:atlas.atlas.height});textures.set(id,new Texture({source,frame:new Rectangle(f.x,f.y,f.width,f.height)}));}
 }
 for(const [name,definition] of Object.entries(combatAtlas.sources)){
  const image=new Image();image.src=`assets/combat/${definition.file}`;await image.decode();
  const source=new ImageSource({resource:image,scaleMode:'nearest',autoGenerateMipmaps:false});sources.push(source);
  for(const [id,frame] of Object.entries(combatAtlas.frames))if(frame.source===name){frames.set(id,frame);frameFiles.set(id,{folder:'combat',file:definition.file,width:definition.width,height:definition.height});textures.set(id,new Texture({source,frame:new Rectangle(frame.x,frame.y,frame.width,frame.height)}));}
 }
 const icons=new DungeonIcons(frames,frameFiles);
 const weaponImage=document.createElement('span');el('weaponIcon').replaceChildren(weaponImage);
 const deaths=new Map<string,{kind:string;position:Point;radius:number;at:number}>();
 const pools=new Map<string,Sprite>(),used=new Set<string>();let state=await window.street.state(),session=state.dungeon??emptyDungeon(),run=session.run,previous:DungeonRun|null=null,received=performance.now();
 let resizeEvents=0,resizeCount=0,roomBuilds=0,resizeFrame=0;let roomKey='',mapKey='',panelKey='',buildKey='',uiAt=0,lastControl=0,begin=0,dpr=devicePixelRatio,buttons=0,mouse={x:innerWidth/2,y:innerHeight/2},pointerWorld={x:0,y:0},focused=document.hasFocus(),frameCount=0,disposed=false;
 let lastWeaponPose:WeaponActionGeometry|null=null,lastWeaponView:WeaponView={sprites:[],energy:[],forearms:[]};
 let serial=0,reforgeSlot=0,reforgeOpen=false,settingsOpen=false,settingsResume=false,settingsRestoring=false,settingsRevision=0,lastNotice='',noticeUntil=0,replacementChoice:MechanismId|null=null,replacementSlot:0|1|2|null=null,upgradePending=false,transferOpen=false,transferSource:0|1=1,transferPending=false,bindingAction:ControlAction|null=null,specialSent=false;const keys=new Set<string>(),physicalKeys=new Set<string>(),virtualHeld=new Set<'attack'|'special'>();camera.setZoom(1.5);
 function sprite(id:string,key:string,x:number,y:number,parent:Container=units,rotation=0,tint=0xffffff,alpha=1,w?:number,h?:number,flip=false):Sprite{
  let s=pools.get(key);if(!s){s=new Sprite();s.label=key;pools.set(key,s);parent.addChild(s);}else if(s.parent!==parent)parent.addChild(s);
  const f=frames.get(id);if(!f||!textures.has(id))throw Error(`缺少地牢图像 ${id}`);s.texture=textures.get(id)!;s.anchor.set(f.anchor[0],f.anchor[1]);s.width=w??f.worldSize[0];s.height=h??f.worldSize[1];s.scale.x=Math.abs(s.scale.x)*(flip?-1:1);s.position.set(x,y);s.rotation=rotation+(f.rotationOffset??0);s.tint=tint===0xffffff?(f.tint??tint):tint;s.alpha=alpha;s.visible=true;s.zIndex=y;used.add(key);return s;
 }
 function staticSprite(id:string,x:number,y:number,rotation=0,w?:number,h?:number):void{const key=`tile-${++serial}`;sprite(id,key,x,y,tiles,rotation,0xffffff,1,w,h);pools.delete(key);}
 const feedbackView=new DungeonFeedback(labels);
 const audio=new DungeonAudio(()=>({enabled:prefs.audioEnabled,volume:prefs.audioVolume,focused:focused&&document.visibilityState!=='hidden'}));
 function loadoutKey(r:DungeonRun|null):string{return r?`${r.player.activeSlot}|${r.player.traits.join(',')}:${r.combat.traitRanks.map(t=>`${t.id}-${t.rank}`).join(',')}|${r.player.weaponSlots.map(w=>w?`${w.id}:${w.kind}:${w.level}:${w.form}`:'-').join('|')}`:'-';}
 function criticalUiChange(a:ShellState,b:ShellState,oldSession:DungeonSession,nextSession:DungeonSession,before:DungeonRun|null,after:DungeonRun|null):boolean{
  if(oldSession.status!==nextSession.status||oldSession.settled!==nextSession.settled||a.action.settled!==b.action.settled||a.action.claim!==b.action.claim)return true;
  if(!before||!after)return before!==after;
  return before.runId!==after.runId||before.currentRoom!==after.currentRoom||before.phase!==after.phase||before.paused!==after.paused||before.level!==after.level||before.choices.join('|')!==after.choices.join('|')||loadoutKey(before)!==loadoutKey(after);
 }
 function canChooseUpgrade():boolean{return !!run&&run.phase==='upgrade'&&!run.paused&&!session.settled&&session.status==='ready'&&focused&&document.visibilityState!=='hidden'&&!settingsOpen&&!settingsRestoring&&!upgradePending;}
 function cancelReplacement():void{if(!replacementChoice||upgradePending)return;replacementChoice=null;replacementSlot=null;updateUI(true);}
 async function commitUpgrade(id:UpgradeId,slot?:0|1|2):Promise<void>{if(!canChooseUpgrade())return;upgradePending=true;updateUI(true);try{await input(slot===undefined?{type:'upgrade',id}:{type:'upgrade',id,replaceSlot:slot});}finally{upgradePending=false;updateUI(true);}}
 function chooseUpgradeChoice(index:number):void{
  if(!canChooseUpgrade())return;const choice=upgradeChoices(run!)[index];if(!choice)return;
  if(choice.kind==='mechanism'&&choice.requiresReplacement){replacementChoice=choice.id as MechanismId;replacementSlot=null;updateUI(true);return;}
  void commitUpgrade(choice.id);
 }
 function chooseReplacementSlot(index:number):void{if(!canChooseUpgrade()||!replacementChoice||!Number.isInteger(index)||index<0||index>=3)return;replacementSlot=index as 0|1|2;updateUI(true);}
 function handleUpgradeDigit(index:number):void{if(replacementChoice)chooseReplacementSlot(index);else chooseUpgradeChoice(index);}
 function confirmReplacement():void{
  if(!canChooseUpgrade()||!replacementChoice||replacementSlot===null)return;
  if(!run!.player.traits[replacementSlot]||run!.player.traits.includes(replacementChoice)){cancelReplacement();return;}
  void commitUpgrade(replacementChoice,replacementSlot);
 }
 function accept(s:ShellState):void{
  const oldState=state,oldSession=session,oldRun=run,next=s.dungeon??emptyDungeon(),n=next.run;state=s;
  if(n&&run&&n.runId===run.runId&&n.currentRoom===run.currentRoom&&n.revision===run.revision){if(n.elapsedMs>run.elapsedMs)previous=run;}else{previous=null;if(!n||!run||n.runId!==run.runId||n.currentRoom!==run.currentRoom)roomKey='';}
  if(n&&run&&n.runId===run.runId){
   for(const event of n.combat.feedback)if(!run.combat.feedback.some(old=>old.id===event.id)){
    const sound:Partial<Record<typeof event.kind,DungeonSound>>={hit:event.targetId==='player'?'hurt':String(activeWeapon(n)?.kind)==='fists'?'fist':'hit',heavy:'heavy',block:'block',kill:'kill',dot:'dot'};
    if(sound[event.kind])audio.play(sound[event.kind]!);
    if(event.kind==='kill'){const enemy=currentRoom(run).enemies.find(e=>e.id===event.targetId);if(enemy){deaths.set(event.targetId,{kind:enemy.kind,position:{x:enemy.x,y:enemy.y},radius:enemy.radius,at:performance.now()});if(deaths.size>32)deaths.delete(deaths.keys().next().value!);}}
   }
   if(n.combat.action&&n.combat.action.id!==run.combat.action?.id)audio.play('swing');
  }
  const visualChange=!n||!run||n.runId!==run.runId||n.elapsedMs!==run.elapsedMs||n.revision!==run.revision||n.currentRoom!==run.currentRoom||n.paused!==run.paused||n.phase!==run.phase;
  const immediate=criticalUiChange(oldState,s,oldSession,next,oldRun,n);
  if(n?.runId!==run?.runId)clear();
  if(n&&run&&n.runId===run.runId){const before=activeWeapon(run),after=activeWeapon(n);if(before?.id!==after?.id||before?.form!==after?.form)clear();else if(n.currentRoom!==run.currentRoom)clear(true);else if(!currentRoom(run).cleared&&currentRoom(n).cleared)clear(n.phase==='exploring');}
  if(n?.phase==='upgrade'&&run?.phase!=='upgrade')clear();
  if(transferOpen&&(!n||n.runId!==run?.runId||n.paused||n.phase!=='exploring'||next.settled))transferOpen=false;
  if(replacementChoice&&(!n||n.runId!==run?.runId||n.phase!=='upgrade'||n.paused||n.choices.join('|')!==run?.choices.join('|')||loadoutKey(n)!==loadoutKey(run))){replacementChoice=null;replacementSlot=null;}
  if(n?.runId!==run?.runId){feedbackView.clear();deaths.clear();}if(n?.currentRoom!==run?.currentRoom)deaths.clear();if(n)feedbackView.accept(n.combat.feedback);
  session=next;run=n;if(visualChange)received=performance.now();
  if(immediate||visualChange&&(performance.now()-uiAt>120||!app.ticker.started)){uiAt=performance.now();updateUI(false);}sync(visualChange||immediate);
 }
 const unsubscribe=window.street.subscribe(accept);
 async function command(c:Command):Promise<void>{try{el('dungeonError').textContent='';accept(await window.street.command(c));}catch(e){el('dungeonError').textContent=String(e);}}
 const input=(v:DungeonInput)=>command({type:'dungeon-input',input:v});
 function active():boolean{return !settingsOpen&&!settingsRestoring&&!transferOpen&&focused&&document.visibilityState!=='hidden'&&!!run&&!run.paused&&run.phase==='exploring'&&!session.settled&&session.status==='ready';}
 function clear(keepMovement=false):void{audio.silence();if(keepMovement){const movementCodes=new Set([prefs.bindings.up,prefs.bindings.down,prefs.bindings.left,prefs.bindings.right]);for(const code of keys)if(!movementCodes.has(code))keys.delete(code);for(const code of physicalKeys)if(!movementCodes.has(canonicalCode(code)))physicalKeys.delete(code);}else{keys.clear();physicalKeys.clear();}virtualHeld.clear();specialSent=false;buttons=0;lastControl=0;if(run&&session.status==='ready')window.street.dungeonControl({type:'cancel-controls'});}
 function sync(renderOnce=true):void {if(disposed)return;if(active())app.start();else{app.stop();if(renderOnce&&document.visibilityState!=='hidden'){if(run)draw(performance.now());app.render();}stats.resetClock();}}
 function focusChanged():void{focused=document.hasFocus();if(!focused){transferOpen=false;audio.silence();clear();bindingAction=null;updateBindings();replacementChoice=null;replacementSlot=null;if(run&&!run.paused)void input({type:'pause',paused:true});}stats.resetClock();sync();updateUI(true);}
 window.addEventListener('blur',focusChanged);window.addEventListener('focus',focusChanged);document.addEventListener('visibilitychange',focusChanged);
 function resize():void{resizeEvents++;if(resizeFrame)return;resizeFrame=requestAnimationFrame(()=>{resizeFrame=0;dpr=devicePixelRatio;app.renderer.resize(innerWidth,innerHeight,dpr);resizeCount++;camera.resize(innerWidth,innerHeight);if(!app.ticker.started)sync();});}
 window.addEventListener('resize',resize);function watchDpr():void{matchMedia(`(resolution: ${devicePixelRatio}dppx)`).addEventListener('change',()=>{resize();watchDpr();},{once:true});}watchDpr();
 function updateCamera(p:Point):void{if(!run)return;const room=currentRoom(run);camera.resize(innerWidth,innerHeight);const halfW=camera.visibleWorld.width/2,halfH=camera.visibleWorld.height/2;camera.x=room.width<=halfW*2?room.width/2:Math.max(halfW,Math.min(room.width-halfW,p.x));camera.y=room.height<=halfH*2?room.height/2:Math.max(halfH,Math.min(room.height-halfH,p.y));if(prefs.screenShake&&!prefs.reducedMotion){const heavy=run.combat.feedback.find(f=>f.kind==='heavy'&&run!.elapsedMs-f.at<100);if(heavy){const amount=(1-(run.elapsedMs-heavy.at)/100)*3/camera.zoom;camera.x+=Math.sin(run.elapsedMs*.17)*amount;camera.y+=Math.cos(run.elapsedMs*.21)*amount;}}world.scale.set(camera.zoom);world.position.set(camera.offset.x,camera.offset.y);pointerWorld=camera.screenToWorld(mouse);}
 function control(now:number,force=false):void{
  if(!active()||(!force&&now-lastControl<1000/60))return;lastControl=now;
  const movement=movementFromHeld(prefs.bindings,keys),special=keys.has(prefs.bindings.special)||virtualHeld.has('special');
  window.street.dungeonControl({type:'control',moveX:movement.x,moveY:movement.y,aimX:Math.max(-2000,Math.min(4000,pointerWorld.x)),aimY:Math.max(-2000,Math.min(4000,pointerWorld.y)),firing:keys.has(prefs.bindings.attack)||virtualHeld.has('attack')});
  if(special!==specialSent){specialSent=special;const weapon=activeWeapon(run!);if(weapon&&isMelee(weapon.kind))void input({type:'special',held:special});else if(special&&weapon)void input({type:'skill',skill:'burst'});}
 }
 function triggerAction(action:ControlAction|null):void{
  if(!active())return;
  if(action==='dash'||action==='dashAlt')void input({type:'dash'});
  else if(action==='switch'){clear();void input({type:'switch'});}
  else if(action==='ward')void input({type:'skill',skill:'ward'});
  else if(action==='interact'){const near=nearbyInteractions(run!).find(value=>!value.disabled);if(near)void input({type:'interact',id:near.id});}
 }
 app.canvas.addEventListener('pointermove',event=>{const rect=app.canvas.getBoundingClientRect();mouse={x:event.clientX-rect.x,y:event.clientY-rect.y};pointerWorld=camera.screenToWorld(mouse);});
 app.canvas.addEventListener('pointerdown',event=>{
  if(!active()||event.button>2)return;app.canvas.focus({preventScroll:true});void audio.unlock();buttons=event.buttons;
  const rect=app.canvas.getBoundingClientRect();mouse={x:event.clientX-rect.x,y:event.clientY-rect.y};pointerWorld=camera.screenToWorld(mouse);
  const code=`Mouse${event.button}`;keys.add(code);app.canvas.setPointerCapture(event.pointerId);triggerAction(controlForCode(prefs.bindings,code));control(performance.now(),true);event.preventDefault();
 });
 window.addEventListener('pointerup',event=>{buttons=event.buttons;keys.delete(`Mouse${event.button}`);if(!buttons)for(const code of ['Mouse0','Mouse1','Mouse2'])keys.delete(code);control(performance.now(),true);});
 app.canvas.addEventListener('lostpointercapture',()=>{if(buttons)clear();});
 app.canvas.addEventListener('pointercancel',()=>clear());app.canvas.addEventListener('contextmenu',event=>event.preventDefault());
 const textTarget=(event:KeyboardEvent)=>event.isComposing||event.keyCode===229||(event.target instanceof HTMLInputElement&&!['range','checkbox','button'].includes(event.target.type))||event.target instanceof HTMLTextAreaElement||event.target instanceof HTMLSelectElement||(event.target instanceof HTMLElement&&event.target.isContentEditable);
 window.addEventListener('compositionstart',()=>clear());
 window.addEventListener('keydown',event=>{
  if(!focused||textTarget(event))return;
  if(event.metaKey||event.ctrlKey||event.altKey){if(keys.size||virtualHeld.size)clear();return;}
  const code=canonicalCode(event.code),action=controlForCode(prefs.bindings,code);
  if(settingsOpen){if(code==='Escape'&&!event.repeat){event.preventDefault();setSettings(false);}return;}
  if(action||code==='Escape'||run?.phase==='upgrade'&&/^Digit[123]$/.test(code))event.preventDefault();
  if(code==='Escape'&&!event.repeat){if(transferOpen&&!transferPending){cancelTransfer();return;}if(transferPending)return;if(replacementChoice&&!upgradePending){cancelReplacement();return;}if(upgradePending)return;clear();if(run&&!session.settled)void input({type:'pause',paused:!run.paused});return;}
  if(run?.phase==='upgrade'&&!run.paused&&!event.repeat&&/^Digit[123]$/.test(code)){handleUpgradeDigit(Number(code.slice(-1))-1);return;}
  if(!active()||!action)return;physicalKeys.add(event.code);keys.add(code);void audio.unlock();if(!event.repeat)triggerAction(action);control(performance.now(),true);
 });
 window.addEventListener('keyup',event=>{physicalKeys.delete(event.code);const code=canonicalCode(event.code);if(![...physicalKeys].some(held=>canonicalCode(held)===code))keys.delete(code);control(performance.now(),true);});
 el('pauseDungeon').onclick=()=>{if(settingsOpen){setSettings(false);return;}clear();if(run&&!session.settled)void input({type:'pause',paused:!run.paused});};
 function setSettings(open:boolean):void{if(open===settingsOpen)return;const revision=++settingsRevision;settingsOpen=open;if(open)transferOpen=false;if(!open){bindingAction=null;el('bindingMessage').textContent='';updateBindings();}el('dungeonSettings').hidden=!open;el('settingsDungeon').setAttribute('aria-expanded',String(open));if(open){replacementChoice=null;replacementSlot=null;settingsResume=settingsRestoring||!!run&&!run.paused&&['exploring','upgrade'].includes(run.phase);settingsRestoring=false;clear();if(settingsResume)void input({type:'pause',paused:true});}else if(settingsResume&&focused&&run&&!session.settled){settingsResume=false;settingsRestoring=true;void input({type:'pause',paused:false}).finally(()=>{if(revision===settingsRevision){settingsRestoring=false;updateUI(true);sync();}});}updateUI(true);sync();}
 el('settingsDungeon').onclick=()=>setSettings(!settingsOpen);el('settingsDungeonClose').onclick=()=>setSettings(false);el<HTMLInputElement>('dungeonShowMetrics').checked=prefs.showMetrics;
 function savePreferences():void{try{if(!saveDungeonPreferences(localStorage,prefs))el('dungeonError').textContent='设置未能保存';}catch{el('dungeonError').textContent='设置未能保存';}}
 function updateBindings():void{
  document.querySelectorAll<HTMLElement>('[data-binding-for]').forEach(label=>{const action=label.dataset.bindingFor as ControlAction;label.textContent=bindingLabel(prefs.bindings[action]).replace('鼠标','');const button=label.closest('button');if(button){button.title=`${action==='attack'?'按住攻击':CONTROL_LABELS[action]} · ${bindingLabel(prefs.bindings[action])}`;button.setAttribute('aria-label',CONTROL_LABELS[action]);}});
  document.querySelectorAll<HTMLButtonElement>('[data-bind-action]').forEach(button=>{const action=button.dataset.bindAction as ControlAction;button.textContent=bindingAction===action?'按下按键…':bindingLabel(prefs.bindings[action]);button.setAttribute('aria-pressed',String(bindingAction===action));});
 }
 let suppressBindingClick=false;
 function captureBinding(code:string):void{
  if(!bindingAction)return;const result=rebindControl(prefs.bindings,bindingAction,code);
  if(result.ok){prefs.bindings=result.bindings;bindingAction=null;el('bindingMessage').textContent='';savePreferences();}
  else el('bindingMessage').textContent=result.reason==='conflict'?`已用于${CONTROL_LABELS[result.conflict!]}`:result.reason==='reserved'?'该按键留给系统或成长选择':'暂不支持该按键';
  updateBindings();
 }
 document.querySelectorAll<HTMLButtonElement>('[data-bind-action]').forEach(button=>button.onclick=()=>{bindingAction=button.dataset.bindAction as ControlAction;el('bindingMessage').textContent='Esc 取消';updateBindings();});
 el('resetDungeonBindings').onclick=()=>{prefs.bindings={...DEFAULT_BINDINGS};bindingAction=null;el('bindingMessage').textContent='';savePreferences();updateBindings();};
 window.addEventListener('keydown',event=>{
  if(!settingsOpen||!bindingAction||event.isComposing||event.keyCode===229||event.metaKey||event.ctrlKey||event.altKey)return;
  event.preventDefault();event.stopImmediatePropagation();
  if(event.code==='Escape'){bindingAction=null;el('bindingMessage').textContent='';updateBindings();}else if(!event.repeat)captureBinding(event.code);
 },true);
 window.addEventListener('pointerdown',event=>{suppressBindingClick=false;if(!settingsOpen||!bindingAction)return;event.preventDefault();event.stopImmediatePropagation();suppressBindingClick=true;captureBinding(`Mouse${event.button}`);},true);
 window.addEventListener('click',event=>{if(!suppressBindingClick)return;suppressBindingClick=false;event.preventDefault();event.stopImmediatePropagation();},true);

 el<HTMLInputElement>('dungeonShowMetrics').onchange=()=>{prefs.showMetrics=el<HTMLInputElement>('dungeonShowMetrics').checked;savePreferences();updateUI(true);};
 for(const checkbox of Array.from(document.querySelectorAll<HTMLInputElement>('[data-dungeon-pref]')))checkbox.onchange=()=>{const key=checkbox.dataset.dungeonPref as typeof preferenceFlags[number][0];prefs[key]=checkbox.checked;savePreferences();if(key==='audioEnabled'){if(prefs.audioEnabled)void audio.unlock();else audio.silence();}if(!app.ticker.started)sync();};
 el<HTMLInputElement>('dungeonVolume').oninput=()=>{prefs.audioVolume=Number(el<HTMLInputElement>('dungeonVolume').value);savePreferences();if(prefs.audioVolume===0)audio.silence();};
 el('minimizeDungeon').onclick=()=>{clear();void command({type:'dungeon-minimize'});};el('closeDungeon').onclick=()=>{clear();void command({type:'dungeon-close'});};
 el('switchDungeon').onclick=()=>triggerAction('switch');el('wardDungeon').onclick=()=>triggerAction('ward');
 function cancelTransfer():void{if(transferPending)return;transferOpen=false;updateUI(true);sync();}
 el('strengthenDungeon').onclick=()=>{if(!run||!active()||!strengthenInfo(run).canStrengthen)return;clear();void input({type:'strengthen'});};
 el('transferDungeon').onclick=()=>{if(!run||!active())return;const backup=run.player.activeSlot===0?1:0;transferSource=transferInfo(run,backup,run.player.activeSlot).canTransfer?backup:run.player.activeSlot;if(!transferInfo(run,transferSource,transferSource===0?1:0).canTransfer)return;clear();transferOpen=true;updateUI(true);sync();};
 async function confirmTransfer():Promise<void>{if(!run||!transferOpen||transferPending||!focused||document.visibilityState==='hidden'||settingsOpen||!transferInfo(run,transferSource,transferSource===0?1:0).canTransfer)return;transferPending=true;updateUI(true);try{await input({type:'transfer',sourceSlot:transferSource,destinationSlot:transferSource===0?1:0});}finally{transferPending=false;transferOpen=false;updateUI(true);sync();}}

 for(const [id,action]of [['attackDungeon','attack'],['burstDungeon','special']] as const){
  const button=el<HTMLButtonElement>(id);
  button.addEventListener('pointerdown',event=>{if(event.button!==0||!active()||button.disabled)return;event.preventDefault();virtualHeld.add(action);button.setPointerCapture(event.pointerId);void audio.unlock();control(performance.now(),true);});
  button.addEventListener('pointerup',()=>{virtualHeld.delete(action);control(performance.now(),true);});
  button.addEventListener('lostpointercapture',()=>{if(virtualHeld.has(action))clear();});button.addEventListener('pointercancel',()=>clear());
  button.addEventListener('keydown',event=>{if((event.code==='Space'||event.code==='Enter')&&!event.repeat&&active()){event.preventDefault();event.stopPropagation();virtualHeld.add(action);control(performance.now(),true);}});
  button.addEventListener('keyup',event=>{if(event.code==='Space'||event.code==='Enter'){event.preventDefault();event.stopPropagation();virtualHeld.delete(action);control(performance.now(),true);}});
  button.addEventListener('blur',()=>{if(virtualHeld.has(action))clear();});
 }
 updateBindings();
 el<HTMLInputElement>('dungeonZoom').oninput=()=>{camera.setZoom(Number(el<HTMLInputElement>('dungeonZoom').value));el('zoomText').textContent=`${Math.round(camera.zoom*100)}%`;if(!app.ticker.started)sync();};
 function interpolationAlpha(now:number):number{return Math.max(0,Math.min(1,(now-received)/Math.max(1000/60,run&&previous?run.elapsedMs-previous.elapsedMs:1000/60)));}
 function position(p:Point,old?:Point,now=performance.now()):Point{return old?interpolate(old,p,interpolationAlpha(now)):p;}
 function rebuildRoom():void{if(!run)return;const room=currentRoom(run),key=`${run.runId}:${room.id}:${room.width}:${room.height}`;if(key===roomKey)return;roomKey=key;
  for(const s of tiles.removeChildren())s.destroy();serial=0;roomBuilds++;
  for(let y=0;y<room.height;y+=24)for(let x=0;x<room.width;x+=24){const wall=x===0||y===0||x>=room.width-24||y>=room.height-24,opening=room.doors.some(d=>(d.side==='N'?y===0:d.side==='S'?y>=room.height-24:d.side==='W'?x===0:x>=room.width-24)&&Math.abs((d.side==='N'||d.side==='S'?x+12:y+12)-(d.side==='N'||d.side==='S'?room.width/2:room.height/2))<(DOOR_OPENING_WIDTH+ROOM_WALL)/2);const variation=((x/24*31+y/24*67+room.lootSeed)>>>0)%31;staticSprite(`tile-floor-${variation===0?1:variation===1?4:0}`,x,y,0,24,24);if(wall&&!opening){staticSprite(y===0?'wall-front':y>=room.height-24?'wall-front':x===0?'wall-side-left':'wall-side-right',x,y);if(y===0)staticSprite('wall-top',x,y-24);}}

 }
 function draw(now:number):void{if(!run)return;const room=currentRoom(run),p=position(run.player,previous?.player,now),renderTime=previous?previous.elapsedMs+(run.elapsedMs-previous.elapsedMs)*interpolationAlpha(now):run.elapsedMs;updateCamera(p);rebuildRoom();used.clear();fx.clear();arms.clear();debugShapes.clear();floorMark.clear();
  for(const ticket of room.spawns.pending){
   const age=Math.max(0,run.elapsedMs-ticket.warningAt),warning=Math.max(1,ticket.materializeAt-ticket.warningAt),pulse=Math.min(2,Math.floor(age/(warning/3))),progress=Math.min(1,age/warning),radius=movementShape(ticket.point,ticket.kind,run.combat.profile).radius+12;
   const waiting=room.spawns.phase==='delayed'&&warning<SPAWN_WARNING_MS;
   const alpha=(prefs.reducedMotion||waiting)?.5:.3+Math.sin(Math.PI*(age%(warning/3))/(warning/3))*.4;
   floorMark.circle(ticket.point.x,ticket.point.y,radius).fill({color:0xa984b6,alpha:.08}).stroke({color:0xe2b6c2,width:2,alpha});
   if(waiting){floorMark.circle(ticket.point.x,ticket.point.y,5).stroke({color:0xe0bf9c,width:1.5}).moveTo(ticket.point.x,ticket.point.y-3).lineTo(ticket.point.x,ticket.point.y).lineTo(ticket.point.x+3,ticket.point.y).stroke({color:0xe0bf9c,width:1.5});}
   else{floorMark.arc(ticket.point.x,ticket.point.y,radius+4,-Math.PI/2,-Math.PI/2+Math.PI*2*progress).stroke({color:0xdfaeb4,width:2,alpha:.65});for(let i=0;i<3;i++)floorMark.circle(ticket.point.x-7+i*7,ticket.point.y+radius+7,1.8).fill({color:i<=pulse?0xf1c5bd:0x60445e,alpha:.8});}
  }
  for(const d of roomDoors(run)){const rotation=d.side==='E'||d.side==='W'?Math.PI/2:0,at=(x:number,y=0)=>({x:d.x+Math.cos(rotation)*x-Math.sin(rotation)*y,y:d.y+Math.sin(rotation)*x+Math.cos(rotation)*y});for(const side of [-1,1]){const p=at(side*(DOOR_OPENING_WIDTH/2+12));sprite(side<0?'gate-post-left':'gate-post-right',`gate-${d.side}-${side}`,p.x,p.y,objects,rotation);}if(d.locked){for(const offset of [-48,0,48]){const p=at(offset);sprite('gate-leaf-closed',`gate-${d.side}-leaf-${offset}`,p.x,p.y,objects,rotation);}}else{const a=doorTriggerRect(room,d.side);floorMark.rect(a.x,a.y,a.width,a.height).fill({color:0x84bda8,alpha:.07});}}
  sprite(`fountain-red-${(prefs.reducedMotion?0:Math.floor(run.elapsedMs/210)%3)}`,'fountain-left',72,12,objects);sprite(`fountain-red-${(prefs.reducedMotion?0:Math.floor(run.elapsedMs/210+1)%3)}`,'fountain-right',room.width-72,12,objects);
  if(room.kind==='entrance')sprite('floor-stairs','entry-stairs',room.width/2,room.height/2+90,objects);
  for(const f of roomFixtures(run)){
   const id=f.kind==='chest'?(f.used?'chest-open':'chest-closed'):f.kind==='merchant'?`merchant-${Math.floor(run.elapsedMs/180)%4}`:f.kind==='rest'?`fountain-blue-${(prefs.reducedMotion?0:Math.floor(run.elapsedMs/210)%3)}`:f.kind==='event'||f.kind==='rune'?'chest-open':'altar';
   sprite(id,f.id,f.x,f.y,objects,0,f.kind==='rest'?0x84d7ea:0xffffff,f.used?.5:1);
   if(f.kind==='rest')sprite('potion-health',`${f.id}-spring`,f.x,f.y-15,objects,0,0xb3efff,1,18,18);
   if(f.kind==='event'&&!f.used){sprite('weapon-fire',`${f.id}-rack-a`,f.x-14,f.y-14,objects,0,0xffffff,1,8,30);sprite('weapon-boomerang',`${f.id}-rack-b`,f.x+14,f.y-14,objects,0,0xffffff,1,15,21);}
   if(f.kind==='altar')sprite('altar-idol',`${f.id}-idol`,f.x,f.y-8,objects);
   if(f.kind==='rune'&&!f.used)for(const [i,kind]of ['fire','frost','lightning','boomerang'].entries())sprite(`rune-${kind}`,`${f.id}-${kind}`,f.x-33+i*22,f.y-44,objects,0,0xffffff,1,kind==='boomerang'?14:16,kind==='boomerang'?19.6:16);
   if(!f.used)floorMark.ellipse(f.x,f.y+7,30,10).stroke({color:0xe0cb8e,width:1,alpha:.45});
  }
  for(const o of room.obstacles)if(o.hp>0){floorMark.roundRect(o.x,o.y,o.width,o.height,4).fill({color:0x111c20,alpha:.6});sprite(o.kind==='pillar'?'obstacle-column':'crate',o.id,o.x+o.width/2,o.y+o.height,units,0,o.hp<20&&o.kind==='crate'?0xc0b0a0:0xffffff);}
  for(const t of room.traps)sprite(`trap-${t.state==='windup'?'warn':t.state}`,t.id,t.x,t.y,objects,0,0xffffff,t.state==='windup'?.65+Math.sin(now*.018)*.3:1,t.radius*2,t.radius*2);
  for(const z of run.zones){const warning=run.elapsedMs<z.startsAt,pulse=.72+Math.sin(run.elapsedMs*.018)*.18,color=z.kind==='boss-impact'?0xf09380:0xeebf69;
   floorMark.circle(z.x,z.y,z.radius).fill({color:warning?color:0xd9773d,alpha:warning?.08:.18}).stroke({color,width:warning?2:1,alpha:warning?pulse:.4});
   if(warning){floorMark.moveTo(z.x-9,z.y).lineTo(z.x+9,z.y).moveTo(z.x,z.y-9).lineTo(z.x,z.y+9).stroke({color,width:2});}
   else if(z.kind!=='boss-impact'){for(let i=0;i<3;i++){const a=i*Math.PI*2/3;sprite('projectile-fire',`${z.id}-flame-${i}`,z.x+Math.cos(a)*z.radius*.4,z.y+Math.sin(a)*z.radius*.4,objects,0,0xffddaa,.8,12,12);}}
  }
  for(const g of room.ground){const kind:string=g.weapon.kind;
   if(kind==='dual'||kind==='fists')for(const [i,side]of [-1,1].entries())sprite(weaponFrame(g.weapon),`${g.id}-${i}`,g.x+side*7,g.y,objects,side*.2,0xffffff,1,undefined,undefined,side<0);
   else{sprite(weaponFrame(g.weapon),g.id,g.x,g.y,objects);if(kind==='chain')for(let i=0;i<3;i++)sprite('chain-link',`${g.id}-link-${i}`,g.x-5-i*4,g.y+4+i*4,objects,-Math.PI/4);}
   const near=Math.hypot(g.x-run.player.x,g.y-run.player.y)<=48;floorMark.ellipse(g.x,g.y+6,near?19:14,near?7:4).stroke({color:near?0xf1d690:0x829989,width:near?2:1,alpha:near?.85:.4});}
  const facingLeft=run.player.aimX<run.player.x,walking=Math.hypot(run.player.moveX,run.player.moveY)>0;
  const hit=run.combat.feedback.some(e=>e.targetId==='player'&&e.kind==='hit'&&run!.elapsedMs-e.at<100),dead=run.player.hp<=0,dashing=run.elapsedMs<run.player.dashUntil;
  const playerFrame=hit||dead?'player-hit':`player-${walking||dashing?'run':'idle'}-${Math.floor(run.elapsedMs/(dashing?70:130))%4}`;
  sprite(playerFrame,'player',p.x,p.y,units,dead?Math.PI/2:0,hit?0xffd9b8:dashing?0xc5e9ef:0xffffff,dead?.5:1,48*GEOMETRY_PROFILES[run.combat.profile].displayScale,84*GEOMETRY_PROFILES[run.combat.profile].displayScale,facingLeft);
  lastWeaponPose=dead?null:weaponActionGeometry(run,{feet:p,time:renderTime});lastWeaponView=lastWeaponPose?weaponView(lastWeaponPose,frames,p.y):{sprites:[],energy:[],forearms:[]};
  const chargeBar=el('weaponCharge');chargeBar.hidden=lastWeaponPose?.stage!=='charge';if(!chargeBar.hidden){chargeBar.style.setProperty('--charge',String(lastWeaponPose!.charge));chargeBar.setAttribute('aria-valuenow',String(Math.round(lastWeaponPose!.charge*100)));}
  for(const part of lastWeaponView.forearms){arms.moveTo(part.hand.x,part.hand.y).lineTo(part.tip.x,part.tip.y).stroke({color:0x172a2d,width:part.width+2,alpha:part.alpha});arms.moveTo(part.hand.x,part.hand.y).lineTo(part.tip.x,part.tip.y).stroke({color:0x718c8a,width:part.width,alpha:part.alpha});}
  for(const part of lastWeaponView.sprites){const s=sprite(part.frame,`held-${part.key}`,part.x,part.y,units,part.rotation,part.tint,part.alpha,part.width,part.height,part.flip);s.zIndex=part.z;}
  for(const {part} of lastWeaponView.energy){fx.moveTo(part.hand.x,part.hand.y).lineTo(part.tip.x,part.tip.y).stroke({color:0xa9e7e0,width:part.width+3,alpha:.22});fx.moveTo(part.hand.x,part.hand.y).lineTo(part.tip.x,part.tip.y).stroke({color:0xf2f3d8,width:part.width,alpha:part.alpha});}
  if(lastWeaponPose?.parts.some(part=>part.kind==='afterimage')&&run.combat.action){const origin=run.combat.action.origin,bodyOffset=hurtShape({x:0,y:0},'player',run.combat.profile).center;sprite(playerFrame,'player-echo',origin.x-bodyOffset.x,origin.y-bodyOffset.y,units,0,0xb9d0f0,.2,48*GEOMETRY_PROFILES[run.combat.profile].displayScale,84*GEOMETRY_PROFILES[run.combat.profile].displayScale,facingLeft);}
  if(lastWeaponPose?.stage==='active'&&prefs.effectsEnabled){for(const primitive of lastWeaponPose.primitives){const color=primitive.heavy?0xf3d0a1:0xcee1d4;if(primitive.kind==='segment')fx.moveTo(primitive.a.x,primitive.a.y).lineTo(primitive.b.x,primitive.b.y).stroke({color,width:primitive.radius*2,alpha:.10});else fx.circle(primitive.center.x,primitive.center.y,primitive.radius).stroke({color,width:2,alpha:.38});}}
  if(run.player.shield>0)floorMark.ellipse(p.x,p.y+3,17,8).stroke({color:0x85cddd,width:1,alpha:.3});
  for(const [id,death]of deaths){const age=now-death.at;if(age>=240){deaths.delete(id);continue;}const base=death.kind==='chaser'?'enemy-skeleton':death.kind==='shooter'?'enemy-shaman':death.kind==='boss'?'boss':death.kind==='priest'?'enemy-priest':'enemy-orc',frame=`${base}-idle-0`,f=frames.get(frame)!,scale=movementShape(death.position,death.kind as Parameters<typeof movementShape>[1],run.combat.profile,death.radius).radius/(death.kind==='boss'?22:12),t=Math.min(1,age/240);sprite(frame,`fallen-${id}`,death.position.x,death.position.y,units,prefs.reducedMotion?.2:t*.8,0xb1a99a,1-t,f.worldSize[0]*scale,f.worldSize[1]*scale);}
  for(const e of room.enemies){
   const old=previous&&currentRoom(previous).enemies.find(v=>v.id===e.id),pos=position(e,old??undefined,now),tell=e.state==='windup',moving=old&&Math.hypot(e.x-old.x,e.y-old.y)>.1,base=e.kind==='chaser'?'enemy-skeleton':e.kind==='shooter'?'enemy-shaman':e.kind==='boss'?'boss':String(e.kind)==='priest'?'enemy-priest':'enemy-orc';
   const hurt=run.combat.feedback.some(f=>f.targetId===e.id&&['hit','heavy','kill'].includes(f.kind)&&run!.elapsedMs-f.at<90),frame=`${base}-${moving&&!tell&&base!=='enemy-priest'?'run':'idle'}-${Math.floor(run.elapsedMs/140)%4}`;const actorScale=movementShape(e,e.kind,run.combat.profile,e.radius).radius/(e.kind==='boss'?22:12),actorFrame=frames.get(frame)!;
   const runtime=run.combat.enemyRuntime.find(v=>v.enemyId===e.id),settling=!!runtime&&runtime.spawnReadyAt>run.elapsedMs;
   const attackProgress=e.state==='attack'?Math.max(0,Math.min(1,1-(e.stateUntil-renderTime)/Math.max(1,ENEMY_ATTACK_RULES[e.kind].activeMs))):0,lean=e.state==='attack'&&['chaser','guard'].includes(e.kind)?Math.sin(attackProgress*Math.PI)*.15*(e.aimX<0?-1:1):tell&&e.kind==='charger'?.08:0;
   sprite(frame,e.id,pos.x,pos.y,units,lean,e.frozenUntil>run.elapsedMs?0xb3eeff:hurt?0xffd5ba:0xffffff,settling?.65:1,actorFrame.worldSize[0]*actorScale,actorFrame.worldSize[1]*actorScale,e.aimX<0);
   if(String(e.kind)==='guard'&&runtime&&frames.has('enemy-guard-shield')){const facing=runtime.shieldFacing,body=hurtShape(pos,e.kind,run.combat.profile,e.radius).center;const shieldAngle=Math.atan2(facing.y,facing.x);sprite('enemy-guard-shield',`${e.id}-shield`,body.x+facing.x*15,body.y+facing.y*15,units,shieldAngle+Math.PI/2+(e.state==='recover'?.65:0),0xffffff,e.state==='recover'?.55:1,22*actorScale,28*actorScale);}
   if(runtime?.buffSourceId)floorMark.ellipse(e.x,e.y+3,17*actorScale,7*actorScale).stroke({color:0xc7a7de,width:2,alpha:.6});
   if(runtime?.buffTargetIds.length){for(const targetId of runtime.buffTargetIds){const target=room.enemies.find(v=>v.id===targetId);if(target)floorMark.moveTo(e.x,e.y-24*actorScale).lineTo(target.x,target.y-20*actorScale).stroke({color:0xb59bcb,width:1,alpha:.22});}}

   if(e.hp<e.maxHp&&e.kind!=='boss'){const y=pos.y-actorFrame.worldSize[1]*actorScale-6;fx.rect(pos.x-15,y,30,3).fill(0x18212b).rect(pos.x-15,y,30*e.hp/e.maxHp,3).fill(0xdf8776);}
   if((tell||e.state==='attack')&&e.kind!=='boss'){
    const origin=e.kind==='charger'?pos:hurtShape(pos,e.kind,run.combat.profile,e.radius).center,shape=enemyTelegraph(e.kind,origin,{x:e.aimX,y:e.aimY}),angle=Math.atan2(shape.direction.y,shape.direction.x),alpha=tell?.28:.75;
    if(shape.kind==='arc')floorMark.moveTo(origin.x,origin.y).arc(origin.x,origin.y,shape.reach,angle-shape.halfAngle,angle+shape.halfAngle).closePath().fill({color:0xe59b7c,alpha:alpha*.3}).stroke({color:0xf1b18c,width:1.5,alpha});
    else if(shape.kind==='line')floorMark.moveTo(origin.x,origin.y).lineTo(origin.x+shape.direction.x*shape.length,origin.y+shape.direction.y*shape.length).stroke({color:e.kind==='shooter'?0xe4a5aa:0xf4a277,width:e.kind==='charger'?movementShape(e,e.kind,run.combat.profile,e.radius).radius*2:1.5,alpha});
   }
   if(tell){floorMark.circle(e.x,e.y,e.radius+7).stroke({color:0xea8b68,width:2});
    if(e.kind==='boss'&&e.pattern==='charge'){const length=250;floorMark.moveTo(e.x,e.y).lineTo(e.x+e.aimX*length,e.y+e.aimY*length).stroke({color:0xf4a277,width:34,alpha:.24});}
    if(e.kind==='boss'&&e.pattern==='fan'){const a=Math.atan2(e.aimY,e.aimX),spread=e.bossPhase===2?.95:.72;floorMark.moveTo(e.x,e.y).lineTo(e.x+Math.cos(a-spread)*240,e.y+Math.sin(a-spread)*240).moveTo(e.x,e.y).lineTo(e.x+Math.cos(a+spread)*240,e.y+Math.sin(a+spread)*240).arc(e.x,e.y,240,a-spread,a+spread).stroke({color:0xf6af81,width:2,alpha:.48});}
   }
  }
  for(const s of run.projectiles){const old=previous?.projectiles.find(v=>v.id===s.id),pos=position(s,old,now);if(s.kind==='spear-shard'){const speed=Math.hypot(s.vx,s.vy)||1,dx=s.vx/speed,dy=s.vy/speed;fx.moveTo(pos.x-dx*8,pos.y-dy*8).lineTo(pos.x+dx*3,pos.y+dy*3).stroke({color:0xbde4d0,width:3,alpha:.8});fx.moveTo(pos.x-dx*6,pos.y-dy*6).lineTo(pos.x+dx*3,pos.y+dy*3).stroke({color:0xf3f4cf,width:1});continue;}const id=`projectile-${s.kind==='enemy'?'enemy':s.kind==='boomerang'||s.kind==='orbit'?'blade':s.kind}`;sprite(id,s.id,pos.x,pos.y,shots,s.kind==='boomerang'||s.kind==='orbit'?renderTime*.018:Math.atan2(s.vy,s.vx));}
  for(const e of run.effects){const alpha=Math.max(.12,Math.min(1,(e.expiresAt-run.elapsedMs)/180));if(e.kind==='slash'){continue;}else if(e.kind==='lightning'){const mx=(e.x+e.targetX)/2,my=(e.y+e.targetY)/2;fx.moveTo(e.x,e.y).lineTo(mx-5,my+7).lineTo(mx+5,my-7).lineTo(e.targetX,e.targetY).stroke({color:0xb0dfff,width:3,alpha});}else if(e.kind==='death')sprite('enemy-remains',e.id,e.x,e.y,units,0,0xffffff,alpha);else if(e.kind==='hit')sprite('effect-impact',e.id,e.x,e.y,shots,0,0xffffff,alpha);else if(e.kind==='explosion'||e.kind==='evolve'){fx.circle(e.x,e.y,e.radius).stroke({color:e.kind==='explosion'?0xffbf68:0xbde5bd,width:4,alpha});for(let i=0;i<5;i++){const a=i*Math.PI*2/5;sprite(e.kind==='explosion'?'projectile-fire':'projectile-blade',`${e.id}-spark-${i}`,e.x+Math.cos(a)*e.radius*.7,e.y+Math.sin(a)*e.radius*.7,shots,a,0xffffff,alpha,12,12);}}else{const c=e.kind==='boss-warning'?0xf4a277:e.kind==='freeze'?0xa8ebed:e.kind==='burn'?0xf49257:e.kind==='ward'?0x83d9d1:0xb9cfb3;fx.circle(e.x,e.y,e.radius).stroke({color:c,width:e.kind==='burst'?3:2,alpha:alpha*.6});}}
  const nearby=nearbyInteractions(run),near=nearby.find(v=>!v.disabled)??nearby[0];if(near?.position&&!near.disabled){const s=camera.worldToScreen(near.position);el('worldPrompt').style.left=`${Math.max(18,Math.min(innerWidth-18,s.x+34*camera.zoom))}px`;el('worldPrompt').style.top=`${Math.max(32,Math.min(innerHeight-80,s.y-30*camera.zoom))}px`;el('worldPrompt').textContent=bindingLabel(prefs.bindings.interact).replace('鼠标','');el('worldPrompt').setAttribute('aria-label',near.label);el('worldPrompt').hidden=false;}else el('worldPrompt').hidden=true;
  feedbackView.draw(fx,run.elapsedMs,prefs,camera.zoom);
  if(prefs.showDebug){
   const actors=[{feet:run.player,kind:'player' as const,radius:undefined},...room.enemies.map(e=>({feet:e,kind:e.kind,radius:e.radius}))];
   for(const actor of actors){const foot=movementShape(actor.feet,actor.kind,run.combat.profile,actor.radius),body=hurtShape(actor.feet,actor.kind,run.combat.profile,actor.radius);
    debugShapes.circle(foot.center.x,foot.center.y,foot.radius).stroke({color:0x94e4a1,width:1});
    debugShapes.moveTo(body.a.x-body.radius,body.a.y).lineTo(body.b.x-body.radius,body.b.y).moveTo(body.a.x+body.radius,body.a.y).lineTo(body.b.x+body.radius,body.b.y).stroke({color:0xe5c875,width:1});
    debugShapes.arc(body.a.x,body.a.y,body.radius,Math.PI,Math.PI*2).arc(body.b.x,body.b.y,body.radius,0,Math.PI).stroke({color:0xe5c875,width:1});
   }
   for(const obstacle of room.obstacles)if(obstacle.hp>0){const r=obstacleAttackRect(obstacle);debugShapes.rect(r.x,r.y,r.width,r.height).stroke({color:0xe598cd,width:1});}
   const limits=projectileWorldBounds(room,run.combat.profile);debugShapes.rect(limits.x,limits.y,limits.width,limits.height).stroke({color:0x8bb8e7,width:1});
   if(lastWeaponPose)for(const primitive of lastWeaponPose.primitives){if(primitive.kind==='segment')debugShapes.moveTo(primitive.a.x,primitive.a.y).lineTo(primitive.b.x,primitive.b.y).stroke({color:0xdff1b2,width:primitive.radius*2,alpha:.35});else debugShapes.circle(primitive.center.x,primitive.center.y,primitive.radius).stroke({color:0xdff1b2,width:1.5});}
   const last=run.combat.feedback.at(-1);el('dungeonDebug').textContent=last?`${last.kind} · ${last.targetId}`:'脚圈 · 躯干';
  }
  el('dungeonDebug').hidden=!prefs.showDebug;
  for(const [k,s]of pools)if(!used.has(k)){pools.delete(k);s.destroy();}
  if(now-uiAt>120){uiAt=now;updateUI(false);}control(now);
 }
 function updateMap():void{
  if(!run)return;const rooms=discoveredRooms(run),key=`${run.runId}:${run.currentRoom}:${run.rooms.length}:${run.reward.coins}:${rooms.map(room=>`${room.id}-${room.cleared}-${room.doors.map(door=>`${door.to}:${door.visited}`).join(',')}`).join('|')}`;if(key===mapKey)return;mapKey=key;
  const glyphs:Record<string,string>={entrance:'home',chest:'bag',rest:'plus',shop:'gold',event:'dungeon',altar:'crystal',elite:'target',boss:'dungeon'},all=rooms.flatMap(r=>[{x:r.gridX,y:r.gridY},...r.doors.map(d=>({x:d.gridX,y:d.gridY}))]),minX=Math.min(...all.map(r=>r.x)),minY=Math.min(...all.map(r=>r.y)),maxX=Math.max(...all.map(r=>r.x)),maxY=Math.max(...all.map(r=>r.y)),size=Math.min(30,150/(maxX-minX+2),110/(maxY-minY+2));
  const point=(x:number,y:number)=>({x:90+(x-(minX+maxX)/2)*size,y:72+(y-(minY+maxY)/2)*size});let markup='';
  for(const r of rooms){const p=point(r.gridX,r.gridY);for(const d of r.doors){const q=point(d.gridX,d.gridY);markup+=`<path d="M${p.x},${p.y} L${q.x},${q.y}" stroke="${d.visited?'#758c89':'#455b59'}" stroke-width="2" ${d.visited?'':'stroke-dasharray="3 3"'}/>`;if(!d.visited)markup+=`<circle cx="${q.x}" cy="${q.y}" r="3" fill="#51655f"/>`;}markup+=`<rect x="${p.x-7}" y="${p.y-7}" width="14" height="14" rx="2" fill="${r.current?'#efd194':r.cleared?'#79a496':'#4b6672'}"/>${glyphs[r.kind]?`<g fill="#162029" transform="translate(${p.x-5} ${p.y-5}) scale(${10/1024})">${icon(glyphs[r.kind]).replace(/^<svg[^>]*>/,'').replace(/<\/svg>$/,'')}</g>`:''}`;}
  el('miniMap').innerHTML=markup;el('roomProgress').textContent=`${rooms.length}/${run.rooms.length}　◇ ${run.reward.coins}`;
 }
 function atlasIcon(id:string,size=22):string{return icons.atlas(id,size);}
 function weaponFrame(w:Parameters<typeof weaponForm>[0]):string{return `weapon-${w.form==='meteor'?'meteor':w.form==='blade-ring'?'blade-ring':w.kind}`;}
 function weaponArt(kind:string):string{return frames.has(`weapon-${kind}`)?`weapon-${kind}`:'weapon-sword';}
 function mechanismArt(id:MechanismId):string{return MECHANISMS[id].weapon==='fire'?'projectile-fire':MECHANISMS[id].weapon==='boomerang'?'projectile-blade':weaponArt(MECHANISMS[id].weapon);}
 function mechanismIcon(id:MechanismId,size=22):string{const symbols:Record<string,string>={'roll-next':'reset','spear-split':'filter','spear-charge':'crystal','spear-sweep':'target','return-rhythm':'clock'};return symbols[id]?icon(symbols[id]).replace('<svg ',`<svg class="d-mechanism-symbol" width="${size}" height="${size}" `):atlasIcon(mechanismArt(id),size);}
 function growthArt():GrowthArt{return{weapon:(w,size)=>icons.weapon(weaponFrame(w).slice(7),size),mechanism:mechanismIcon};}
 function renderAltar(r:DungeonRun):string{return altarBranches(r,growthArt());}
 function renderReplacement(r:DungeonRun):string{return replacementChoice?replacementCards(r,replacementChoice,replacementSlot,upgradePending,growthArt()):'';}
 function updateUI(force:boolean):void{
  if(run){const p=run.player,w=activeWeapon(run!),room=currentRoom(run),ev=evolutionInfo(run),back=p.weaponSlots[p.activeSlot===0?1:0];
   el('healthText').textContent=`♥ ${Math.ceil(p.hp)} / ${p.maxHp}`;el('shieldText').textContent=`◇ ${Math.ceil(p.shield)} / ${p.maxShield}`;el('healthFill').style.width=`${p.hp/p.maxHp*100}%`;el('shieldFill').style.width=`${p.maxShield?p.shield/p.maxShield*100:0}%`;
   el('roomText').textContent=`${names[room.kind]}${room.locked?`　${room.wave}/${room.totalWaves}${room.spawns.phase==='delayed'?'　◷':''}`:''}`;el('weaponText').textContent=w?`${weaponName(w)} Lv${w.level}${ev.canEvolve?' ◆':''}`:'空手';el('dBackupText').textContent=back?`${weaponName(back)} Lv${back.level}`:'';el('levelText').textContent=String(run.level);el('vitals').title=`本局经验 ${run.reward.xp}`;
   el<HTMLButtonElement>('switchDungeon').disabled=!active()||!back;
   el('switchDungeon').title=`${bindingLabel(prefs.bindings.switch)} · ${back?`备用 ${weaponName(back)} Lv${back.level}`:'备用槽空'}\n进阶条件请查看祭坛`;
   el('weaponIcon').hidden=!w;if(w){const artKind=weaponFrame(w).slice('weapon-'.length);if(weaponImage.dataset.art!==artKind){weaponImage.dataset.art=artKind;weaponImage.innerHTML=icons.weapon(artKind,40);el('attackDungeon').querySelector('span')!.innerHTML=icons.weapon(artKind,28);}}
   const strengthen=strengthenInfo(run),forward=transferInfo(run,0,1),backward=transferInfo(run,1,0);el('essenceCount').textContent=String(run.essence);el('growthActions').hidden=!w;const strengthenButton=el<HTMLButtonElement>('strengthenDungeon'),transferButton=el<HTMLButtonElement>('transferDungeon');strengthenButton.disabled=!active()||!strengthen.canStrengthen;strengthenButton.title=strengthen.canStrengthen?`${strengthen.name} Lv${strengthen.currentLevel} → ${strengthen.nextLevel} · ${strengthen.cost}精华`:strengthen.reason;transferButton.disabled=!active()||!forward.canTransfer&&!backward.canTransfer;transferButton.title=forward.canTransfer||backward.canTransfer?'强化转移 · 本局一次':forward.reason;
   const nextBuildKey=loadoutKey(run);if(nextBuildKey!==buildKey){buildKey=nextBuildKey;el('buildText').innerHTML=Array.from({length:3},(_,i)=>{const m=p.traits[i],info=m?mechanismInfo(run!,m):null,rank=info?.rank??0;return `<span class="d-trait ${m?'filled':''} ${info&&!info.usableSlots.includes(p.activeSlot)?'inactive':''}" data-tooltip="${m?esc(mechanismHint(run!,m)):'空机制槽'}">${m?mechanismIcon(m,22):'·'}${m?`<b>${rank}</b>`:''}</span>`;}).join('');}el('evolutionText').textContent=ev.canEvolve?'◆ 可在祭坛进阶':'';el('evolutionText').hidden=!ev.canEvolve;
   const boss=room.enemies.find(e=>e.kind==='boss');el('bossHud').hidden=!boss;if(boss){el('bossText').textContent=`封印守卫　${boss.bossPhase===2?'Ⅱ':'Ⅰ'}`;el('bossFill').style.width=`${boss.hp/boss.maxHp*100}%`;}
   if(run.notice!==lastNotice){lastNotice=run.notice;noticeUntil=/获得|进阶完成|房间已清理|下一波|第二相|购买成功|已领取/.test(run.notice)?performance.now()+1800:0;}el('dungeonNotice').style.top=boss?'125px':'80px';el('dungeonNotice').hidden=performance.now()>noticeUntil;el('dungeonNotice').textContent=run.notice.replace(/ · .*/,'');
   const special=weaponSpecialInfo(run),specialButton=el<HTMLButtonElement>('burstDungeon'),resource=el('specialResource');specialButton.disabled=!active()||!w||(isMelee(w.kind)?!special.available&&!special.held:run.elapsedMs<p.skillReady);specialButton.classList.toggle('is-held',special.held);specialButton.dataset.tooltip=w&&isMelee(w.kind)?`${special.reason} · ${WEAPONS[w.kind].description}`:'近身冲击 · 与守护共用冷却';resource.hidden=!w||!['dual','fists'].includes(w.kind)&&w.form!=='reaper';resource.textContent=w?.form==='reaper'?`${special.current}/6`:w?.kind==='fists'?`${special.current}/10`:`${special.current}/3`;el('attackDungeon').toggleAttribute('disabled',!active()||!w);el('wardDungeon').toggleAttribute('disabled',!active()||run.elapsedMs<p.skillReady);updateMap();}
  else{el('evolutionText').hidden=true;el('growthActions').hidden=true;}
  const pauseButton=el<HTMLButtonElement>('pauseDungeon');pauseButton.disabled=!run||session.settled||!['exploring','upgrade'].includes(run.phase);pauseButton.title=settingsOpen?'收起设置':run?.paused?'继续 / Esc':'暂停 / Esc';pauseButton.setAttribute('aria-label',settingsOpen?'收起设置':run?.paused?'继续':'暂停');pauseButton.textContent=run?.paused&&!settingsOpen?'▶':'Ⅱ';
  el('frameText').textContent=active()?`${stats.liveFps>0?stats.liveFps.toFixed(0):'—'} FPS${el<HTMLInputElement>('dungeonShowMetrics').checked?' · '+stats.summary().p95.toFixed(1)+' ms p95':''}`:'已暂停';
  const options=run?nearbyInteractions(run):[],near=options.find(v=>!v.disabled)??options[0],canReforge=!!run&&currentRoom(run).kind==='altar'&&Math.hypot(run.player.x-currentRoom(run).width/2,run.player.y-currentRoom(run).height/2)<=64&&run.reforgesLeft>0&&run.player.traits.length>0;const k=`${session.status}:${run?.runId}:${session.settled}:${run?.currentRoom}:${run?.phase}:${run?.paused}:${options.map(v=>`${v.id}-${v.disabled}`).join()}:${run?.player.activeSlot}:${run?.level}:${run?.choices.join()}:${run?.essence}:${run?.reforgesLeft}:${run?.player.traits.join()}:${run?.combat.traitRanks.map(t=>`${t.id}-${t.rank}`).join()}:${run?.player.weaponSlots.map(w=>w?`${w.id}-${w.level}-${w.form}`:'-').join()}:${canReforge}:${focused}:${state.action.settled}:${state.action.claim}:${replacementChoice}:${replacementSlot}:${upgradePending}:${transferOpen}:${transferSource}:${transferPending}:${transferOpen&&run?transferInfo(run,transferSource,transferSource===0?1:0).canTransfer:''}`;
  if(!force&&k===panelKey)return;panelKey=k;const panel=el('dungeonPanel');let html='';
  if(settingsOpen||settingsRestoring){panel.hidden=true;return;}
  if(session.status==='blocked')html=`<p class="d-eyebrow">已安全暂停</p><h1>地牢暂时无法打开</h1><p>${esc(session.error)}</p><p>原始存档已保留。</p>`;
  else if(state.action.run&&!state.action.settled)html=`<p class="d-eyebrow">旧版本进度</p><h1>先带回旧版战利品</h1><p>旧版主动冒险保存在独立档案中。</p><button data-command="legacy">结算旧版并保留营地进度</button>`;
  else if(!run||session.settled)html=`<h1>回响地窟</h1><button class="primary" data-command="start">踏入地牢</button>`;
  else if(run.phase==='lost'||run.phase==='won'){const reward=bankedDungeonReward(session);html=`<h1>${run.phase==='won'?'封印已破':'探索结束'}</h1><p>◇ ${reward.coins}　·　经验 ${reward.xp}</p><button class="primary" data-command="return">返回商业街</button>`;}
  else if(run.paused||!focused)html=`<h1>已暂停</h1><button class="primary" data-command="resume">继续</button><button data-command="return" title="带回一半本局奖励">撤回营地</button>`;
  else if(transferOpen)html=transferPreview(run,transferSource,transferPending,growthArt());
  else if(run.phase==='upgrade')html=replacementChoice?renderReplacement(run):growthCards(run);
  else if(near||canReforge)html=`<h2>${near?.kind==='weapon'?esc(weaponName(near.weapon!)):near?.kind==='altar'?'进阶祭坛':near?.kind==='merchant'?'旅商':near?.kind==='event'?'回响密室':''}</h2>${near?.kind==='weapon'?`<p>${esc(WEAPONS[near.weapon!.kind].behavior)}</p><small>${activeWeapon(run!)?`当前 ${esc(weaponName(activeWeapon(run!)!))} Lv${activeWeapon(run!)!.level}`:'空手'} → Lv${near.weapon!.level}</small>`:''}${near?.kind==='altar'?renderAltar(run!):`<div class="d-options">${options.map((option,i)=>`<button ${option.disabled?'disabled':''} title="${esc(option.detail)}" class="${i===options.indexOf(near)?'primary':''}" data-interact="${esc(option.id)}">${option.kind==='weapon'?`${icons.weapon(weaponFrame(option.weapon!).slice(7),28)}<span>${esc(weaponName(option.weapon!))} Lv${option.weapon!.level}</span>`:esc(option.label)}${option.kind==='merchant'?`　◇ ${option.detail.split(' ')[0]}`:''}</button>`).join('')}</div>`}${canReforge?`<details class="d-reforge" ${reforgeOpen?'open':''}><summary role="button">重铸 · ${run.reforgesLeft} 次</summary><div class="d-reforge-slots">${run.player.traits.map((id,i)=>`<button data-reforge-slot="${i}" class="${reforgeSlot===i?'selected':''}">${MECHANISMS[id].name}</button>`).join('')}</div>${reforgeChoices(run,Math.min(reforgeSlot,run.player.traits.length-1)).map(c=>`<button data-reforge="${c.id}" title="${esc(c.detail)}">${esc(c.label)}</button>`).join('')}</details>`:''}`;

  panel.hidden=!html;panel.classList.toggle('d-pickup',(!!near||canReforge)&&active());panel.classList.toggle('d-altar-pickup',near?.kind==='altar'&&active());panel.classList.toggle('d-transfer-panel',transferOpen);panel.classList.toggle('d-upgrade',run?.phase==='upgrade'&&!run.paused);panel.innerHTML=html;
  panel.querySelector<HTMLButtonElement>('[data-cancel-transfer]')?.addEventListener('click',cancelTransfer);
  panel.querySelector<HTMLButtonElement>('[data-reverse-transfer]')?.addEventListener('click',()=>{if(!transferPending){transferSource=transferSource===0?1:0;updateUI(true);}});
  panel.querySelector<HTMLButtonElement>('[data-confirm-transfer]')?.addEventListener('click',()=>void confirmTransfer());
  panel.querySelectorAll<HTMLButtonElement>('[data-evolve]').forEach(button=>button.onclick=()=>{if(!run||!active())return;clear();void input({type:'evolve',form:button.dataset.evolve as Exclude<WeaponForm,'base'>});});
  const details=panel.querySelector<HTMLDetailsElement>('.d-reforge');if(details)details.ontoggle=()=>{reforgeOpen=details.open;};
  panel.querySelectorAll<HTMLButtonElement>('[data-upgrade-index]').forEach(b=>b.onclick=()=>chooseUpgradeChoice(Number(b.dataset.upgradeIndex)));
  panel.querySelectorAll<HTMLButtonElement>('[data-replacement-slot]').forEach(b=>b.onclick=()=>chooseReplacementSlot(Number(b.dataset.replacementSlot)));
  panel.querySelector<HTMLButtonElement>('[data-cancel-replacement]')?.addEventListener('click',cancelReplacement);
  panel.querySelector<HTMLButtonElement>('[data-confirm-replacement]')?.addEventListener('click',confirmReplacement);
  panel.querySelectorAll<HTMLButtonElement>('[data-reforge-slot]').forEach(b=>b.onclick=()=>{reforgeSlot=Number(b.dataset.reforgeSlot);reforgeOpen=true;updateUI(true);});
  panel.querySelectorAll<HTMLButtonElement>('[data-reforge]').forEach(b=>b.onclick=()=>void input({type:'reforge',slot:Math.min(reforgeSlot,run!.player.traits.length-1) as 0|1|2,mechanism:b.dataset.reforge as MechanismId}));
  panel.querySelectorAll<HTMLButtonElement>('[data-interact]').forEach(b=>b.onclick=()=>void input({type:'interact',id:b.dataset.interact!}));
  panel.querySelectorAll<HTMLButtonElement>('[data-command]').forEach(b=>b.onclick=()=>{const c=b.dataset.command;if(c==='start'){const seed=crypto.getRandomValues(new Uint32Array(1))[0]||1;void command({type:'dungeon-start',seed});}else if(c==='resume')void input({type:'pause',paused:false});else if(c==='return'){clear();void command({type:'dungeon-return'});}else if(c==='legacy')void command({type:'action-claim'});else if(c==='pickup'&&near)void input({type:'interact',id:near.id});});
 }
 app.ticker.maxFPS=0;app.ticker.minFPS=0;app.ticker.add(()=>{begin=performance.now();if(dpr!==devicePixelRatio)resize();draw(begin);frameCount++;},undefined,UPDATE_PRIORITY.HIGH);app.ticker.add(()=>stats.record(begin,performance.now()-begin),undefined,UPDATE_PRIORITY.LOW-1);
 Object.assign(window,{dungeonProbe:{app,camera,stats,get state(){return{session,focused,settingsOpen,transferOpen,transferPending,transferSource,bindingAction,preferences:structuredClone(prefs),keys:[...keys],virtualHeld:[...virtualHeld],specialSent,buttons,pointerWorld,mouse,frameCount,renderCount,lastWeaponPose,lastWeaponView,playerDraw:pools.get('player')?.getBounds().rectangle,heldDraws:lastWeaponView.sprites.map(part=>({key:part.key,frame:part.frame,width:part.width,height:part.height,hand:{x:part.x,y:part.y},rotation:pools.get(`held-${part.key}`)?.rotation,bounds:pools.get(`held-${part.key}`)?.getBounds().rectangle})),resizeEvents,resizeCount,roomBuilds,staticSprites:tiles.children.length,dynamicSprites:pools.size,visibleTiles:camera.visibleWorld.width/24,tileScreenSize:24*camera.zoom,hud:el('vitals').getBoundingClientRect().toJSON(),world:world.getBounds().rectangle,rendererResolution:app.renderer.resolution,obstacleDraws:run?currentRoom(run).obstacles.filter(o=>o.hp>0).map(o=>({footprint:{x:o.x,y:o.y,width:o.width,height:o.height},sprite:pools.get(o.id)?.getBounds().rectangle})):[]};}}});
 window.addEventListener('pagehide',()=>{disposed=true;cancelAnimationFrame(resizeFrame);clear();unsubscribe();app.stop();audio.dispose();feedbackView.dispose();});resize();updateUI(true);sync();document.body.dataset.dungeonReady='true';
}
