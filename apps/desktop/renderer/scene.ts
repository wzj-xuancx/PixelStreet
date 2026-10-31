import {RoomPresenceMotion} from './room-presence';
import {FieldScene} from './field-scene';
import {applyOpeningPose} from './chapter-pose';
import type {OpeningState} from './chapter-opening';
import {presentationActive} from '../../../packages/protocol/presentation';
import {chapterView,type GameplayFeedback} from '../../../packages/solo-core';
import {ChapterFeedbackConsumer} from './chapter-feedback';
import { Application, ColorMatrixFilter, Container, Graphics, ImageSource, Rectangle, Sprite, Texture, Ticker, UPDATE_PRIORITY } from 'pixi.js';
import 'pixi.js/unsafe-eval'; // Pre-generated Pixi uniform synchronizers; keeps strict CSP.
import {streetPetPresence} from '../../../packages/solo-core/pets';
import atlas from '../../../assets/atlas.json';
import manifest from '../../../assets/asset_manifest.json';
import { pixelScale, snapDIP } from '../../../packages/protocol/geometry';
import { roomIdentityTint } from '../../../packages/protocol/room';
import type { Rect, ShellState } from '../../../packages/protocol';
import {FrameStats} from '../../../packages/dungeon-core/foundation';
import { canonicalSceneHit, foregroundHit, shopBoardContains, shopContains, shopTarget, streetLayout } from './scene-interaction';
type Frame = { x:number;y:number;w:number;h:number;anchor:number[] };
type Placed = {id:string;x:number;y:number;sprite:Sprite;width:number;height:number;anchorX:number;anchorY:number;pickable?:boolean;hitOverride?:string};
export function sceneTargetFps(state:Pick<ShellState,'mode'|'workingElsewhere'|'settings'>,active=false):number{return state.mode==='hidden'||state.workingElsewhere||!active?0:120;}
export class PixelScene {
  readonly app=new Application();readonly world=new Container();private field?:FieldScene;
  private lastPartyLoot='';
  private get fieldEnabled(){return !this.opening&&this.state?.view==='field'&&(!!this.state.game.profile?.run?.field||!!this.state.partyField?.view);}
  fieldHit(x:number,y:number){return this.fieldEnabled?this.field?.hit(x,y):undefined;}
  fieldProbe(){return this.fieldEnabled?this.field?.probe():null;}
  get systemTickerStarted():boolean{return Ticker.system.started;}
  readonly frameStats=new FrameStats();private frameBegin=0;
  private opening?:OpeningState;private presencePointer=false;
  private get effectiveView(){return this.opening?'field':this.state?.view;}
  private source?:ImageSource;private pixels?:Uint8ClampedArray;private imageWidth=0;
  private textures=new Map<string,Texture>();private placed:Placed[]=[];private state?:ShellState;private lastLayout='';private lastPaint='';
  private scale=1;private offsetX=0;private offsetY=0;private time=0;private playerX:number=streetLayout.playerX;private cameraX=0;private targetX?:number;private pointerActive=false;
  private readonly feedback=new ChapterFeedbackConsumer();private feedbackActive=false;private feedbackBlurred=false;private effects:Array<{event:GameplayFeedback;at:number}>=[];
  private readonly peerMotion=new RoomPresenceMotion();private peers=new Map<string,{actor:Placed;pet?:Placed;ring:Graphics}>();private presenceTimer?:ReturnType<typeof setTimeout>;private lastPresence='';private lastPeerPaint='';private direction:-1|1=1;
  private portal?:Placed;private dungeonPortal?:Placed;private foe?:Placed;private stats?:Graphics;
  private player?:Placed;private slime?:Placed;private hovered?:Placed;private corners?:Graphics;private petUntil=0;
  // Pixi keeps the same hover contract as DOM buttons without joining their CSS classes.
  private readonly glow=new ColorMatrixFilter();frames=0;missing=new Set<string>();
  async init(host:HTMLElement):Promise<void>{
    await this.app.init({resizeTo:window,backgroundAlpha:0,resolution:devicePixelRatio,autoDensity:true,antialias:false,roundPixels:true,autoStart:false,sharedTicker:false,preference:'webgl',powerPreference:'low-power'});
    // Pixi8 SchedulerSystem starts its own system ticker independently of app.autoStart.
    // This renderer owns one Pixi application; housekeeping runs only during local activity.
    Ticker.system.stop();Ticker.shared.stop();
    host.appendChild(this.app.canvas);this.app.stage.addChild(this.world);this.glow.brightness(1.12,false);
    try{
      const bytes=await(await fetch('assets/atlas.png')).arrayBuffer();const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('');
      if(atlas.image!=='atlas.png'||hash!==manifest.sha256['atlas.png'])throw Error('图集校验失败');
      const image=new Image(),url=URL.createObjectURL(new Blob([bytes],{type:'image/png'}));try{image.src=url;await image.decode();}finally{URL.revokeObjectURL(url);}
      this.source=new ImageSource({resource:image,scaleMode:'nearest',autoGenerateMipmaps:false});
      const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d')!;ctx.drawImage(image,0,0);this.pixels=ctx.getImageData(0,0,image.width,image.height).data;this.imageWidth=image.width;
      for(const[id,f]of Object.entries(atlas.frames)){if(f.x<0||f.y<0||f.x+f.w>image.width||f.y+f.h>image.height)throw Error('图集边界无效');this.textures.set(id,new Texture({source:this.source,frame:new Rectangle(f.x,f.y,f.w,f.h)}));}
      document.body.dataset.atlas='verified';
    }catch(error){document.body.dataset.atlas='missing';this.missing.add(String(error));document.getElementById('sceneError')!.textContent='像素资源缺失或校验失败，请重建素材。';}
    this.field=new FieldScene(this.textures);await this.field.init();this.app.stage.addChild(this.field.world);
    this.app.ticker.add(()=>{this.frameBegin=performance.now();},undefined,UPDATE_PRIORITY.HIGH);
    this.app.ticker.add(ticker=>{
      const dt=Math.min(ticker.deltaMS,100)/1000;this.time+=dt;if(this.fieldEnabled){this.field?.update(dt);this.recordFrame();this.syncTicker();return;}
      if(this.targetX!==undefined){const distance=this.targetX-this.playerX,step=100*dt;if(Math.abs(distance)<=step){this.playerX=this.targetX;this.targetX=undefined;}else this.playerX+=Math.sign(distance)*step;}
      this.animate();this.recordFrame();this.syncTicker();
    });
    this.app.ticker.add(()=>this.frameStats.record(this.frameBegin,performance.now()-this.frameBegin),undefined,UPDATE_PRIORITY.LOW-1);
    const pause=()=>{this.feedbackBlurred=true;this.feedback.suspend();this.feedbackActive=false;this.effects=[];document.querySelectorAll('.ch-feedback').forEach(n=>n.remove());this.animate();this.renderNow();this.syncTicker();};
    document.addEventListener('pointermove',event=>{if(event.isTrusted){this.presencePointer=true;this.feedbackBlurred=false;this.resumeFeedback();this.syncTicker();}});document.addEventListener('pointerleave',()=>{this.presencePointer=false;this.feedback.suspend();this.feedbackActive=false;this.effects=[];this.syncTicker();});
    window.addEventListener('blur',()=>{this.presencePointer=false;pause();});document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();else this.resumeFeedback();});
    window.addEventListener('focus',()=>{this.feedbackBlurred=false;this.resumeFeedback();});document.addEventListener('pointerdown',event=>{if(event.isTrusted){this.feedbackBlurred=false;this.resumeFeedback();}},{capture:true});
    window.addEventListener('resize',()=>{this.lastLayout='';if(this.state)this.apply(this.state);});
  }
  private add(id:string,x:number,y:number,pickable=true):Placed|undefined{
    const f=(atlas.frames as Record<string,Frame>)[id],texture=this.textures.get(id);if(!f||!texture){this.missing.add(id);return;}
    const item={id,x,y,sprite:new Sprite(texture),width:f.w,height:f.h,anchorX:f.anchor[0],anchorY:f.anchor[1],pickable};this.setFrame(item,id,x);this.world.addChild(item.sprite);this.placed.push(item);return item;
  }
  apply(state:ShellState):void{
    const lostInteraction=state.workingElsewhere&&!this.state?.workingElsewhere,previousView=this.effectiveView;this.state=state;this.cameraX=state.cameraX;const changedView=previousView!==this.effectiveView;if(changedView){this.stop();if(this.effectiveView==='field')this.playerX=240;else if(previousView==='field')this.playerX=streetLayout.playerX;}
    if(this.fieldEnabled){this.publishPresence();this.world.visible=false;document.body.dataset.fieldAdventure='true';if(this.app.screen.width!==innerWidth||this.app.screen.height!==innerHeight||this.app.renderer.resolution!==devicePixelRatio)this.app.renderer.resize(innerWidth,innerHeight,devicePixelRatio);this.effects=[];this.feedback.suspend();this.feedbackActive=false;this.applyFieldView();if(this.presentationActive()&&!this.app.ticker.started)this.renderNow();this.syncTicker();return;}
    if(this.field?.visible){this.field.setVisible(false);this.lastLayout='';}this.world.visible=true;document.body.dataset.fieldAdventure='false';
    if(changedView)this.effects=[];
    if(!this.canFeedback()){this.feedback.suspend();this.feedbackActive=false;this.effects=[];document.querySelectorAll('.ch-feedback').forEach(n=>n.remove());}else if(!this.feedbackActive)this.resumeFeedback();else if(state.game.feedback){this.feedback.accept(state.game.feedback);for(const event of this.feedback.drain())this.playFeedback(event);}
    if(this.effectiveView!=='field'&&state.game.profile&&chapterView(state.game.profile).step==='depart')this.playerX=streetLayout.portalX-20;
    // A native resize can arrive before the new settings snapshot. Include the
    // preset so leaving the 48px compact layout cannot reuse its scale/hidden shops.
    const pet=!this.opening&&state.game.profile?streetPetPresence(state.game.profile,this.effectiveView==='field'?'field':'camp'):undefined;
    this.peerMotion.apply(state.room.presence??[],performance.now());
    const key=`${innerWidth}:${innerHeight}:${devicePixelRatio}:${state.settings.height}:${this.effectiveView}:${state.activeShop}:${this.cameraX}:${!!state.game.profile?.run}:${pet?.visible}:${pet?.role}`;
    if(this.lastLayout!==key&&this.source){
      this.lastLayout=key;this.app.renderer.resize(innerWidth,innerHeight,devicePixelRatio);this.hover();
      for(const child of this.world.removeChildren())child.destroy();this.placed=[];this.peers.clear();this.player=this.slime=this.portal=this.dungeonPortal=this.foe=undefined;
      const desired=state.settings.height===48?.5:Math.min(2,(innerHeight-4)/96);this.scale=pixelScale(devicePixelRatio,Math.max(.5,desired)).dip;
      this.offsetX=snapDIP(Math.max(8,(innerWidth-streetLayout.width*this.scale)/2)-this.cameraX*this.scale,devicePixelRatio);this.offsetY=snapDIP(innerHeight-8*this.scale,devicePixelRatio);
      this.world.position.set(this.offsetX,this.offsetY);this.world.scale.set(this.scale);
      Object.assign(document.body.dataset,{worldScale:String(this.scale),worldX:String(this.offsetX),worldY:String(this.offsetY),cameraX:String(this.cameraX)});
      const start=-Math.ceil(this.offsetX/this.scale/16)*16,end=(innerWidth-this.offsetX)/this.scale+32;for(let x=start;x<end;x+=16){const g=this.add('ground',x,8);if(g&&this.effectiveView==='field')g.sprite.tint=0x789595;}
      if(this.effectiveView!=='field'&&state.settings.height!==48){this.add(this.effectiveView==='interior'&&state.activeShop==='shop-bakery'?'interior-bakery':'shop-bakery',streetLayout.bakeryX,0);this.add(this.effectiveView==='interior'&&state.activeShop==='shop-alchemy'?'interior-alchemy':'shop-alchemy',streetLayout.alchemyX,0);}
      if(this.effectiveView==='interior'&&state.settings.height!==48)this.add('keeper',(state.activeShop==='shop-alchemy'?streetLayout.alchemyX:streetLayout.bakeryX)+34,0);
      this.portal=this.add('portal-0',this.effectiveView==='field'?90:streetLayout.portalX,0);
      if(this.effectiveView!=='field'){this.dungeonPortal=this.add('portal-0',streetLayout.dungeonX,0);if(this.dungeonPortal){this.dungeonPortal.hitOverride='dungeon-portal';this.dungeonPortal.sprite.tint=0xe2bdff;}}
      if(this.effectiveView==='field'){this.add('field-crystal',450,0);this.foe=this.add('enemy-0',360,0);}
      if(this.effectiveView==='field'||!state.game.profile?.run){this.player=this.add('player-idle-0',this.playerX,0);if(this.player)this.player.sprite.tint=roomIdentityTint(state.room.members,state.room.localPlayerId);}
      if(pet?.visible)this.slime=this.add('slime-idle-0',this.petX(),0);
      this.stats=new Graphics();this.world.addChild(this.stats);this.corners=new Graphics();this.world.addChild(this.corners);this.animate();
      // The DOM signs and Pixi buildings share one world transform. A sign's
      // 57px height ends 2 logical pixels into the road, independent of DPI.
      document.getElementById('placeSigns')!.style.transform=`translate(${this.offsetX}px,${this.offsetY}px) scale(${this.scale})`;const portalSign=document.getElementById('portalSign')!;portalSign.style.left=`${(this.effectiveView==='field'?90:streetLayout.portalX)+38}px`;portalSign.style.top='-55px';const dungeonSign=document.getElementById('dungeonSign')!;dungeonSign.hidden=this.effectiveView==='field';dungeonSign.style.left=`${streetLayout.dungeonX+38}px`;dungeonSign.style.top='-55px';
      const tower=document.getElementById('towerEntrance');if(tower){
        const naturalX=this.offsetX+(streetLayout.towerX-40)*this.scale,naturalW=Math.max(44,80*this.scale),compact=state.settings.height===48||naturalX+naturalW>innerWidth-104||naturalX<0||90*this.scale>innerHeight;
        const width=compact?44:naturalW,height=compact?44:Math.max(44,90*this.scale);
        // On a narrow high street, place the compact plaque in the existing gap between shops.
        const left=compact?Math.max(4,Math.min(innerWidth-124,this.offsetX+367*this.scale-22)):naturalX;
        tower.dataset.compact=String(compact);tower.querySelector('span')!.textContent='成就之塔';tower.style.left=`${left}px`;tower.style.top=`${compact?0:Math.max(0,this.offsetY-height)}px`;tower.style.width=`${width}px`;tower.style.height=`${height}px`;
      }
      document.getElementById('shopSigns')!.style.transform=`translate(${this.offsetX}px,${this.offsetY}px) scale(${this.scale})`;
      for(const el of Array.from(document.querySelectorAll<HTMLElement>('[data-shop]'))){const x=el.dataset.shop==='shop-bakery'?streetLayout.bakeryX:streetLayout.alchemyX;el.hidden=state.settings.height===48||this.effectiveView==='field';el.style.left=`${x+shopTarget.left}px`;el.style.top=`${shopTarget.top}px`;el.setAttribute('aria-pressed',String(this.effectiveView==='interior'&&state.activeShop===el.dataset.shop));}
      document.body.dataset.interiorFrame=this.effectiveView==='interior'?`interior-${state.activeShop==='shop-bakery'?'bakery':'alchemy'}`:'';
    }
    if(lostInteraction||state.mode==='hidden'){this.presencePointer=false;this.pointerActive=false;this.stop();this.hover();}
    // Business time keeps advancing while the camp is idle. Only state used by
    // this scene invalidates its static pixels; queue/inventory broadcasts do not.
    const run=!this.opening&&this.effectiveView==='field'?state.game.profile?.run:undefined;
    const field=run?`${run.phase}:${run.region}:${run.hp}:${run.enemyHP}:${run.enemyMax}:${state.game.profile?.upgraded}:${run.markedUntil>(state.game.profile?.tick??0)}`:'';
    const paint=`${key}:${state.mode}:${state.workingElsewhere}:${field}`;
    if(paint!==this.lastPaint){this.lastPaint=paint;this.animate();this.renderNow();}
    this.applyPeers();const peerPaint=JSON.stringify(state.room.presence);if(peerPaint!==this.lastPeerPaint){this.lastPeerPaint=peerPaint;this.renderNow();}this.publishPresence();this.syncTicker();
  }
  private applyFieldView():void{const state=this.state;if(!state)return;if(state.partyField?.view){this.field?.applyView(state.partyField.view,this.presentationActive()&&state.partyField.phase==='running');const loot=state.partyField.loot;if(loot&&loot.eventId!==this.lastPartyLoot){this.lastPartyLoot=loot.eventId;if(this.presentationActive())this.field?.personalLoot(loot.reward);}}else this.field?.apply(state,this.presentationActive());}
  private publishPresence():void{
    const s=this.state;if(!s||s.partyField?.view||this.opening||!['hosting','joined'].includes(s.room.status)||s.workingElsewhere||s.mode==='hidden')return;
    const pose={x:Math.max(-4096,Math.min(4096,Math.round(this.playerX*4)/4)),petX:Math.max(-4096,Math.min(4096,Math.round(this.petX()*4)/4)),direction:this.direction,moving:this.targetX!==undefined,view:s.view,pet:false};
    const fingerprint=JSON.stringify({epoch:s.epoch,role:s.room.role,pose});if(fingerprint===this.lastPresence||this.presenceTimer)return;
    this.presenceTimer=setTimeout(()=>{this.presenceTimer=undefined;const state=this.state;if(!state||!['hosting','joined'].includes(state.room.status)||state.workingElsewhere||state.mode==='hidden')return;const presence={...pose,petX:Math.max(-4096,Math.min(4096,Math.round(this.petX()*4)/4)),x:Math.max(-4096,Math.min(4096,Math.round(this.playerX*4)/4)),direction:this.direction,moving:this.targetX!==undefined,view:state.view};this.lastPresence=JSON.stringify({epoch:state.epoch,role:state.room.role,pose:presence});void window.street.command({type:'street-presence',epoch:state.epoch,presence}).catch(()=>{});},100);
  }
  private applyPeers():void{
    const s=this.state;if(!s)return;const poses=['hosting','joined'].includes(s.room.status)&&this.effectiveView==='street'?(s.room.presence??[]).filter(p=>p.playerId!==s.room.localPlayerId&&p.view==='street'&&s.room.members.some(m=>m.id===p.playerId&&m.online)):[];
    const ids=new Set(poses.map(p=>p.playerId));for(const [id,peer]of this.peers)if(!ids.has(id)){for(const p of [peer.actor,peer.pet])if(p){this.placed=this.placed.filter(x=>x!==p);p.sprite.destroy();}peer.ring.destroy();this.peers.delete(id);}
    for(const pose of poses){let peer=this.peers.get(pose.playerId);if(!peer){const actor=this.add('player-idle-0',pose.x,0,false);if(!actor)continue;const ring=new Graphics();this.world.addChild(ring);peer={actor,ring};this.peers.set(pose.playerId,peer);}
      const sampled=this.peerMotion.sample(pose.playerId,performance.now())??pose;this.setFrame(peer.actor,sampled.moving?atlas.animations['player-walk'][Math.floor(this.time*8)%4]:'player-idle-0',sampled.x);peer.actor.sprite.tint=0xffffff;
      // A small identity ring keeps the original hero artwork intact.
      peer.ring.clear().ellipse(sampled.x,-1,13,3).stroke({width:1.5,color:roomIdentityTint(s.room.members,pose.playerId),alpha:.9});
      if(pose.pet&&!peer.pet)peer.pet=this.add('slime-idle-0',sampled.petX,0,false);
      if(peer.pet){peer.pet.sprite.visible=pose.pet;this.setFrame(peer.pet,'slime-idle-0',sampled.petX);}
      peer.actor.sprite.scale.x=Math.abs(peer.actor.sprite.scale.x)*sampled.direction;if(sampled.direction===-1)peer.actor.sprite.x+=peer.actor.width;
    }
    document.body.dataset.roomPeers=JSON.stringify([...this.peers].map(([id,p])=>({id,x:p.actor.x,pet:!!p.pet?.sprite.visible,petX:p.pet?.x,direction:Math.sign(p.actor.sprite.scale.x)})));
  }
  peerHoverName(xDIP:number,yDIP:number):string{const x=(xDIP-this.offsetX)/this.scale,y=(yDIP-this.offsetY)/this.scale;for(const [id,p]of this.peers)if(Math.abs(x-p.actor.x)<20&&y<0&&y>-57)return this.state?.room.members.find(m=>m.id===id)?.name??'';return '';}
  private recordFrame():void{this.publishPresence();this.frames++;document.body.dataset.renderFrames=String(this.frames);document.body.dataset.playerX=String(Math.round(this.fieldEnabled?this.field?.renderedX??this.playerX:this.playerX));if(!this.fieldEnabled)this.updateMarker();}
  private renderNow():void{if(this.fieldEnabled&&!this.presentationActive())return;this.app.render();this.recordFrame();}
  private syncTicker():void{if(!this.state)return;if(this.fieldEnabled){const active=this.presentationActive()&&!!this.field?.active;document.body.dataset.targetFps=active?'120':'0';if(active){Ticker.system.start();this.app.ticker.maxFPS=0;this.app.start();}else{this.app.stop();Ticker.system.stop();this.frameStats.resetClock();}return;}const fps=sceneTargetFps(this.state,this.presentationActive()&&!this.opening&&(this.pointerActive||this.targetX!==undefined||this.time<this.petUntil||this.effects.length>0||this.peerMotion.active(performance.now())));const systemActive=this.presentationActive()&&(!!fps||!!this.opening&&!['defeated','done'].includes(this.opening.phase));if(systemActive)Ticker.system.start();else Ticker.system.stop();document.body.dataset.targetFps=String(fps);document.body.dataset.pointerActive=String(this.pointerActive);if(fps){if(!this.app.ticker.started)this.frameStats.resetClock();this.app.ticker.maxFPS=0;this.app.start();}else{this.app.stop();this.frameStats.resetClock();}}
  setPointerActive(active:boolean):void{if(this.pointerActive===active)return;if(this.fieldEnabled){this.pointerActive=active;this.applyFieldView();if(!this.app.ticker.started)this.renderNow();this.syncTicker();return;}this.pointerActive=active;this.animate();this.renderNow();this.syncTicker();}
  private setFrame(item:Placed,id:string,x:number):void{
    const f=(atlas.frames as Record<string,Frame>)[id],texture=this.textures.get(id);if(!f||!texture)return;
    item.width=id==='keeper'?30:id.startsWith('enemy-')?44:id.startsWith('player-')||id.startsWith('slime-')?44:f.w;item.height=id==='keeper'?42:id.startsWith('player-')?57:id.startsWith('slime-')||id.startsWith('enemy-')?29:f.h;
    item.anchorX=Math.round(f.anchor[0]*item.width/f.w);item.anchorY=Math.round(f.anchor[1]*item.height/f.h);item.id=id;item.x=Math.round(x);item.sprite.texture=texture;
    item.sprite.scale.set(item.width/f.w,item.height/f.h);item.sprite.position.set(item.x-item.anchorX,item.y-item.anchorY);
  }
  private petX():number{return this.effectiveView!=='field'&&this.state?.game.profile?.pets?.role==='expedition'?streetLayout.portalX-38:this.playerX+46;}
  private animate():void{
    if(this.fieldEnabled){this.applyFieldView();return;}
    const run=this.opening?undefined:this.state?.game.profile?.run;
    const animated=this.pointerActive&&!this.state?.workingElsewhere&&this.state?.mode!=='hidden';
    if(this.portal){this.setFrame(this.portal,animated?atlas.animations.portal[Math.floor(this.time*2)%4]:'portal-0',this.effectiveView==='field'?90:streetLayout.portalX);document.body.dataset.portalFrame=this.portal.id;}
    if(this.dungeonPortal)this.setFrame(this.dungeonPortal,animated?atlas.animations.portal[Math.floor(this.time*2)%4]:'portal-0',streetLayout.dungeonX);
    if(this.foe){this.setFrame(this.foe,atlas.animations.enemy[Math.floor(this.time*3)%4],360);this.foe.sprite.visible=run?.phase==='fight';this.foe.sprite.tint=run?.region===2?0xffbedb:run?.region===1?0xe0afff:0xffffff;}
    this.stats?.clear();if(this.stats&&this.effectiveView==='field'&&run){const max=this.state?.game.profile?.upgraded?80:70;this.stats.rect(216,-65,48,3).fill(0x1d2631).rect(216,-65,48*Math.max(0,run.hp)/max,3).fill(0x91c7aa);if(run.phase==='fight'){this.stats.rect(338,-43,44,3).fill(0x1d2631).rect(338,-43,44*Math.max(0,run.enemyHP)/run.enemyMax,3).fill(run.markedUntil>(this.state?.game.profile?.tick??0)?0x8dd9ed:0xcb849a);}}

    const now=performance.now();this.effects=this.effects.filter(e=>now-e.at<750);
    if(this.player){this.setFrame(this.player,this.targetX!==undefined?atlas.animations['player-walk'][Math.floor(this.time*8)%4]:'player-idle-0',this.playerX);applyOpeningPose(this.player,this.opening?.phase==='defeated');}
    for(const effect of this.effects){const age=(now-effect.at)/750,k=effect.event.kind;
      if(this.player&&k==='hurt'){this.player.sprite.tint=age<.35?0xffa299:0xffffff;this.player.sprite.x-=Math.round(Math.sin(age*Math.PI)*6);}
      if(this.player&&['attack','frost','shatter'].includes(k))this.player.sprite.x+=Math.round(Math.sin(age*Math.PI)*8);
      if(this.foe&&['attack','frost','shatter','win'].includes(k)){this.foe.sprite.tint=k==='frost'?0x8de4f7:k==='shatter'?0xd8b3ff:age<.3?0xffe2bb:0xffffff;this.foe.sprite.x+=Math.round(Math.sin(age*Math.PI)*7);if(k==='win'){this.foe.sprite.visible=true;this.foe.sprite.alpha=1-age;this.foe.sprite.y+=age*12;}}
      if(this.stats&&['frost','shatter'].includes(k)){const color=k==='frost'?0x8de4f7:0xd8b3ff;for(let n=0;n<5;n++)this.stats.circle(360+Math.cos(n*1.25)*age*20,-25+Math.sin(n*1.25)*age*20,2).fill({color,alpha:1-age});}
    }
    if(this.foe&&!this.effects.some(e=>e.event.kind==='win'))this.foe.sprite.alpha=1;
    if(this.opening&&this.player){
      const frame=this.opening;this.player.sprite.tint=frame.phase==='hurt'?0xffa299:0xffffff;
      if(this.foe){this.foe.sprite.visible=true;this.foe.sprite.tint=0xffffff;}
      if(this.stats){this.stats.rect(216,-65,48,3).fill(0x263932).rect(216,-65,48*frame.hp/6,3).fill(0xcb8b74);this.stats.rect(338,-43,44,3).fill(0x263932).rect(338,-43,44*frame.enemyHP/24,3).fill(0xbc9b7a);}
    }
    if(this.player&&!this.opening&&!this.effects.some(e=>e.event.kind==='hurt'))this.player.sprite.tint=this.state?roomIdentityTint(this.state.room.members,this.state.room.localPlayerId):0xffffff;
    if(this.slime){this.setFrame(this.slime,animated?atlas.animations['slime-idle'][Math.floor(this.time*3)%4]:'slime-idle-0',this.petX());if(this.time<this.petUntil)this.slime.sprite.y-=Math.round(Math.abs(Math.sin(this.time*12))*7);}
    if(this.hovered&&this.corners){const p=this.hovered;this.corners.clear();if(p.id!=='ground'){const x=p.sprite.x-2,y=p.sprite.y-2,w=p.width+4,h=p.height+4;this.corners.moveTo(x+7,y).lineTo(x,y).lineTo(x,y+7).moveTo(x+w-7,y).lineTo(x+w,y).lineTo(x+w,y+7).moveTo(x,y+h-7).lineTo(x,y+h).lineTo(x+7,y+h).moveTo(x+w-7,y+h).lineTo(x+w,y+h).lineTo(x+w,y+h-7).stroke({width:1,color:0xffd58c,alpha:.9});}}
    this.applyPeers();
    const a=this.actorAnchor();if(a)document.body.dataset.playerBounds=JSON.stringify(a);
  }
  /** Readonly actual Pixi geometry for hidden fixture/diagnostic inspection. */
  actorPoseProbe(){
    const player=this.player;if(!player)return null;
    const rectangle=(sprite:Sprite)=>{const b=sprite.getBounds();return {x:b.x,y:b.y,width:b.width,height:b.height,bottom:b.y+b.height};};
    const ground=this.placed.find(item=>item.id==='ground');
    return {bounds:rectangle(player.sprite),ground:ground?rectangle(ground.sprite):null,rotation:player.sprite.rotation,pivot:{x:player.sprite.pivot.x,y:player.sprite.pivot.y},position:{x:player.sprite.position.x,y:player.sprite.position.y},scale:{x:player.sprite.scale.x,y:player.sprite.scale.y},phase:this.opening?.phase??'ordinary',view:this.effectiveView};
  }
  private presentationActive():boolean {
    return !!this.state&&!this.feedbackBlurred&&presentationActive(this.state.presentation?.overlay,{pointer:this.presencePointer,documentVisible:!document.hidden,blocked:this.state.partyField?.phase==='frozen'||this.state.mode==='hidden'||!!this.state.workingElsewhere||!this.state.settings.interactionEnabled});
  }
  setOpening(frame?:OpeningState):void {
    if(!frame&&!this.opening)return;
    const changed=!!frame!==!!this.opening;this.opening=frame;
    if(changed){this.playerX=frame||this.state?.view==='field'?240:streetLayout.playerX;this.lastLayout='';this.effects=[];this.feedback.suspend();this.feedbackActive=false;}
    if(this.state){this.apply(this.state);this.animate();this.renderNow();this.syncTicker();}
  }
  private canFeedback():boolean{return !this.opening&&this.presentationActive()&&this.state?.mode==='interaction';}
  private resumeFeedback():void{const feed=this.state?.game.feedback;if(!feed||!this.canFeedback())return;this.feedback.resume(feed);this.feedbackActive=true;}
  private playFeedback(event:GameplayFeedback):void{
    if(!this.canFeedback()||event.kind==='sale'&&this.effectiveView!=='interior'||event.kind!=='sale'&&event.kind!=='return'&&this.effectiveView!=='field')return;
    this.effects.push({event,at:performance.now()});this.effects=this.effects.slice(-12);
    const label=document.createElement('span');label.className='ch-feedback';label.dataset.kind=event.kind;label.dataset.eventId=String(event.id);
    label.textContent=event.kind==='win'?`胜利 ＋${event.amount}金`:event.kind==='return'?`带回${event.amount}凝胶`:event.kind==='sale'?`成交 ＋${event.amount}金`:event.kind==='depart'?`携${event.amount}口粮`:event.kind==='frost'?`冰印 −${event.amount}`:event.kind==='shatter'?`碎晶 −${event.amount}`:`−${event.amount}`;
    const x=event.kind==='hurt'?this.playerX:event.kind==='sale'?streetLayout.bakeryX:360;label.style.left=`${Math.max(4,Math.min(innerWidth-150,this.offsetX+x*this.scale))}px`;label.style.top=`${Math.max(0,this.offsetY-54*this.scale)}px`;document.getElementById('root')?.append(label);label.addEventListener('animationend',()=>label.remove(),{once:true});setTimeout(()=>label.remove(),850);this.syncTicker();
  }
  anchorFor(id:string):Rect|undefined{const p=this.placed.find(p=>id==='portal'?p.id.startsWith('portal-'):p.id===id);return p?{x:this.offsetX+(p.x-p.anchorX)*this.scale,y:this.offsetY+(p.y-p.anchorY)*this.scale,width:p.width*this.scale,height:p.height*this.scale}:undefined;}
  actorAnchor():Rect|undefined{const p=this.player;if(!p)return;return{x:snapDIP(this.offsetX+(p.x-p.anchorX)*this.scale,devicePixelRatio),y:snapDIP(this.offsetY+(p.y-p.anchorY)*this.scale,devicePixelRatio),width:p.width*this.scale,height:p.height*this.scale};}
  stop():void{this.targetX=undefined;this.petUntil=0;this.lastPaint='';this.updateMarker();this.ghost();this.syncTicker();}
  pet():void{if(this.state?.workingElsewhere)return;this.petUntil=this.time+.7;document.body.dataset.petCount=String(Number(document.body.dataset.petCount??0)+1);this.syncTicker();}
  walkTo(xDIP:number):void{if(this.state?.workingElsewhere)return;const min=-this.offsetX/this.scale+22,max=(innerWidth-this.offsetX)/this.scale-22;this.direction=(xDIP-this.offsetX)/this.scale<this.playerX?-1:1;this.targetX=Math.max(min,Math.min(max,(xDIP-this.offsetX)/this.scale));this.updateMarker();this.syncTicker();}
  private updateMarker():void{const el=document.getElementById('moveMarker');if(!el)return;el.hidden=this.targetX===undefined;document.body.dataset.walkTarget=this.targetX===undefined?'':String(this.targetX);if(this.targetX!==undefined){el.style.left=`${this.offsetX+this.targetX*this.scale}px`;el.style.top=`${Math.max(15,this.offsetY-12*this.scale)}px`;}}
  private ghost(x?:number):void{const el=document.getElementById('hoverMarker');if(!el)return;el.hidden=x===undefined||this.targetX!==undefined;if(x!==undefined){x=Math.max(22*this.scale,Math.min(innerWidth-22*this.scale,x));el.style.left=`${x}px`;el.style.top=`${Math.max(15,this.offsetY-12*this.scale)}px`;}document.body.dataset.hoverTarget=el.hidden?'':String(x);}
  hover(xDIP?:number,yDIP?:number,shop?:string):string|undefined{
    if(this.fieldEnabled){const id=this.field?.hover(xDIP,yDIP);document.body.dataset.hover=id??'';if(!this.app.ticker.started)this.renderNow();return id;}
    if(shop==='tower'){this.hover();document.getElementById('towerEntrance')?.classList.add('is-hovered');document.body.dataset.hover='tower';return 'tower';}document.getElementById('towerEntrance')?.classList.remove('is-hovered');
    let p=xDIP===undefined?undefined:this.pickItem(xDIP,yDIP!);if(shop&&!foregroundHit(p?this.hitId(p):undefined))p=shop==='adventure-portal'||shop==='return-portal'?this.portal:shop==='dungeon-portal'?this.dungeonPortal:this.placed.find(p=>this.hitId(p)===shop);if(p?.id==='ground'&&this.effectiveView==='field')p=undefined;const changed=p!==this.hovered;if(changed){if(this.hovered)this.hovered.sprite.filters=[];this.hovered=p;if(p&&p.id!=='ground')p.sprite.filters=[this.glow];this.corners?.clear();}
    const highlightedShop=p?.id==='shop-bakery'||p?.id==='interior-bakery'?'shop-bakery':p?.id==='shop-alchemy'||p?.id==='interior-alchemy'?'shop-alchemy':undefined;
    for(const sign of Array.from(document.querySelectorAll<HTMLElement>('[data-shop]')))sign.classList.toggle('is-hovered',sign.dataset.shop===highlightedShop);
    this.ghost(p?.id==='ground'?xDIP:undefined);
    const label=document.getElementById('portalSign');label?.classList.toggle('is-hovered',p===this.portal);document.getElementById('dungeonSign')?.classList.toggle('is-hovered',p===this.dungeonPortal);const id=p?this.hitId(p):undefined;document.body.dataset.hover=id??'';if(changed){this.animate();this.renderNow();}return id;
  }
  private pickItem(xDIP:number,yDIP:number):Placed|undefined{
    if(!this.pixels)return;const x=(xDIP-this.offsetX)/this.scale,y=(yDIP-this.offsetY)/this.scale;
    let ground:Placed|undefined;
    for(let n=this.placed.length-1;n>=0;n--){const p=this.placed[n];if(p.pickable===false||!p.sprite.visible)continue;const f=(atlas.frames as Record<string,Frame>)[p.id],lx=Math.floor((x-p.sprite.x)*f.w/p.width),ly=Math.floor((y-p.sprite.y)*f.h/p.height);if(lx>=0&&ly>=0&&lx<f.w&&ly<f.h&&this.pixels[((f.y+ly)*this.imageWidth+f.x+lx)*4+3]>0){if(p.id==='ground')ground=p;else return p;}}
    if(this.effectiveView!=='field'&&this.state?.settings.height!==48){for(const p of this.placed)if(this.hitId(p).startsWith('shop-')&&shopContains(p.x,x,y))return p;}
    if(this.dungeonPortal&&x>=this.dungeonPortal.x-32&&x<this.dungeonPortal.x+104&&y>=-80&&y<2)return this.dungeonPortal;
    if(this.portal&&x>=this.portal.x-32&&x<this.portal.x+104&&y>=-80&&y<2)return this.portal;
    return ground;
  }
  private hitId(p:Placed):string{return p.hitOverride??canonicalSceneHit(p.id,this.effectiveView==='field');}
  onShopBoard(id:string,xDIP:number,yDIP:number):boolean{return shopBoardContains(id==='shop-bakery'?streetLayout.bakeryX:streetLayout.alchemyX,(xDIP-this.offsetX)/this.scale,(yDIP-this.offsetY)/this.scale);}
  pick(x:number,y:number):string|undefined{if(this.fieldEnabled)return this.field?.hit(x,y)?.id;const p=this.pickItem(x,y);return p&&!(p.id==='ground'&&this.effectiveView==='field')?this.hitId(p):undefined;}
}
