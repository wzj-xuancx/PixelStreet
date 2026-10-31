import {inventoryArt} from './inventory-art';
import {setGeneratedMarkup} from './generated-markup';
import type {RewardPackage,FieldView} from '../../../packages/field-world';
import {Container,Graphics,ImageSource,Rectangle,Sprite,Texture,ColorMatrixFilter} from 'pixi.js';
import type {ShellState,Rect} from '../../../packages/protocol';
import {FIELD_FLOORS,profileFieldView,fieldViewWork,type FieldTarget} from '../../../packages/solo-core/field-adventure';
import art from '../../../assets/dungeon/manifest.json';
import {fieldTransform,fieldWorldAt,fieldScreenAt,fieldVisible,type FieldTransform} from './field-geometry';
type Item={id:string;x:number;y:number;sprite:Sprite;width:number;height:number;target?:FieldTarget|'return'};
/** Presentation only: owns Pixi objects and readonly geometry; never changes authority. */
export class FieldScene {
 readonly world=new Container();private fx=new Graphics();private backdrop=new Container();private backdropSize='';private fog=new Graphics();private items=new Map<string,Item>();private textures=new Map<string,Texture>();private source?:ImageSource;
 private view?:FieldView;private floor=-1;private runId='';private camera=0;private heroX=40;private previousX=40;private received=0;private enabled=false;private hovered?:string;private clock=0;
 private seenEvents=new Set<string>();private guardianShield?:Sprite;private guardianCore?:Sprite;private pet?:Sprite;private team=new Map<string,Sprite>();private teamPets=new Map<string,Sprite>();
 private flashes=new Map<string,{at:number;damage:number}>();private previousHP=new Map<string,number>();private lastAttack=0;private previousOre=0;private swingAt=-1e6;
 private glow=new ColorMatrixFilter();private flash=new ColorMatrixFilter();private weapon?:Sprite;private feedbackHost:HTMLElement;private t:FieldTransform=fieldTransform(1000,112,0);
 constructor(private street:ReadonlyMap<string,Texture>){this.glow.brightness(1.4,false);this.flash.brightness(3,false);this.world.visible=false;this.feedbackHost=document.createElement('div');this.feedbackHost.id='fieldEffects';document.getElementById('root')!.append(this.feedbackHost);}
 async init():Promise<void>{
  const bytes=await(await fetch('assets/dungeon/'+art.atlas.file)).arrayBuffer();const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');if(hash!==art.source.imageSha256)throw Error('冒险图集校验失败');
  const img=new Image(),url=URL.createObjectURL(new Blob([bytes],{type:'image/png'}));try{img.src=url;await img.decode();}finally{URL.revokeObjectURL(url);}
  const shield=new Image();shield.src='assets/combat/shield-original.png';await shield.decode();const shieldTexture=Texture.from(shield);shieldTexture.source.scaleMode='nearest';this.textures.set('guardian-shield',shieldTexture);
  this.source=new ImageSource({resource:img,scaleMode:'nearest',autoGenerateMipmaps:false});this.textures.set('field-wall',new Texture({source:this.source,frame:new Rectangle(32,16,16,16)}));for(const [id,f]of Object.entries(art.atlas.frames))this.textures.set(id,new Texture({source:this.source,frame:new Rectangle(f.x,f.y,f.width,f.height)}));
 }
 get visible(){return this.world.visible;}
 get renderedX(){return this.heroX;}
 setVisible(value:boolean){this.world.visible=value;if(!value){this.enabled=false;this.hover();this.suspend();}}
 private add(id:string,texture:string,x:number,y:number,width:number,height:number,target?:Item['target']):Item{
  const s=new Sprite(this.textures.get(texture)??this.street.get(texture));s.anchor.set(.5,1);s.width=width;s.height=height;s.position.set(x,y);const item={id,x,y,sprite:s,width,height,target};this.items.set(id,item);this.world.addChild(s);return item;
 }
 private layout(){
  for(const child of this.world.removeChildren())child.destroy();this.items.clear();this.backdrop=new Container();this.backdropSize='';this.world.addChild(this.backdrop);this.fx=new Graphics();this.fog=new Graphics();const f=this.view!,c=FIELD_FLOORS[f.floor];this.floor=f.floor;this.runId=f.sessionId;this.team.clear();this.teamPets.clear();this.heroX=this.previousX=f.x;this.camera=0;this.previousHP.clear();this.seenEvents.clear();
  for(let x=0;x<=1400;x+=32){this.add('ground-'+x,'ground',x,8,32,16);}
  this.add('return','portal-0',c.entryX,0,42,58,'return');this.add(c.ore.id,'field-crystal',f.floors[f.floor].oreX,0,35,33,{kind:'ore',id:c.ore.id});this.add('exit','portal-0',c.exitX,0,48,64,{kind:'exit'});
  for(const group of f.floors[f.floor].encounters)for(const m of group.monsters){this.add(m.id,this.monsterFrame(m.kind==='melee'&&m.id.startsWith('f1-e2-')?'summon':m.kind,false,0),m.x,0,27,42,{kind:'monster',id:m.id});this.previousHP.set(m.id,m.hp);}
  this.add('hero','player-idle-0',f.x,0,26,46);for(const a of f.actors)if(a.id!==f.localActorId){const sprite=this.add('actor-'+a.id,'player-idle-0',a.x,0,26,46).sprite;this.team.set(a.id,sprite);if(a.loadout.pet)this.teamPets.set(a.id,this.add('pet-'+a.id,'slime-idle-0',a.x-22,0,22,14).sprite);}this.pet=this.add('field-pet','slime-idle-0',f.x-20,0,22,14).sprite;this.guardianShield=this.add('guardian-shield','guardian-shield',0,0,19,24).sprite;this.guardianCore=this.add('guardian-core','field-crystal',0,0,10,12).sprite;this.weapon=new Sprite(this.textures.get('weapon-sword'));this.weapon.anchor.set(.5,.82);this.weapon.width=13;this.weapon.height=27;this.world.addChild(this.weapon);this.world.addChild(this.fx,this.fog);this.lastAttack=f.actors.find(a=>a.id===f.localActorId)!.nextAttack;this.previousOre=f.actors.find(a=>a.id===f.localActorId)!.mines;this.previousHP.set('hero',f.hp);
 }
 apply(state:ShellState,active:boolean):void{this.applyView(state.game.profile?profileFieldView(state.game.profile):null,active);}
 /** Shared single/co-op renderer entry. No fabricated p.run or Profile required. */
 applyView(view:FieldView|null,active:boolean):void{
  const was=this.enabled;this.view=view??undefined;this.enabled=active;
  if(!view){this.setVisible(false);return;}const f=view,actor=f.actors.find(a=>a.id===f.localActorId)!;this.world.visible=true;if(this.floor!==f.floor||this.runId!==f.sessionId)this.layout();
  const now=performance.now();this.previousX=this.heroX;this.received=now;
  const changed=(id:string,hp:number)=>{const prev=this.previousHP.get(id);if(was&&active&&prev!==undefined&&hp<prev){this.flashes.set(id,{at:now,damage:prev-hp});this.damage(id,prev-hp);}this.previousHP.set(id,hp);};
  if(was&&active&&actor.mines>this.previousOre)this.resource(f.floors[f.floor].oreX);this.previousOre=actor.mines;
  changed('hero',f.hp);for(const g of f.floors[f.floor].encounters)for(const m of g.monsters)changed(m.id,m.hp);
  for(const e of f.events){const key=[e.tick,e.kind,e.actorId,e.targetId].join(':');if(this.seenEvents.has(key))continue;this.seenEvents.add(key);if(this.seenEvents.size>96)this.seenEvents.delete(this.seenEvents.values().next().value!);if(was&&active&&f.tick-e.tick<8){const labels:Record<string,string>={break:'破甲',rupture:'裂甲',interrupt:'打断',pulse:'回声',heal:'恢复 +'+e.amount,shield:'护盾 +'+e.amount,bandage:'绷带',victory:'击退'};const label=labels[e.kind];if(label)this.mechanism(e.targetId,label,e.actorId);}}
  if(was&&active&&actor.nextAttack!==this.lastAttack)this.swingAt=now;this.lastAttack=actor.nextAttack;
  if(!active||!was){this.suspend();this.heroX=f.x;this.previousX=f.x;}
  this.resize(innerWidth,innerHeight);this.update(0);
 }
 suspend(){this.flashes.clear();this.feedbackHost.replaceChildren();this.swingAt=-1e6;}
 resize(width:number,height:number){this.t=fieldTransform(width,height,this.camera);this.world.position.set(this.t.x,this.t.y);this.world.scale.set(this.t.scale);this.background();}
 private background(){const key=`${this.t.width}:${this.t.height}:${this.t.scale}`;const left=-this.t.x/this.t.scale;this.backdrop.x=left;if(key===this.backdropSize)return;this.backdropSize=key;for(const child of this.backdrop.removeChildren())child.destroy();const w=this.t.width/this.t.scale+32,h=this.t.height/this.t.scale+32;for(let x=-16;x<w;x+=32)for(let y=-h;y<8;y+=32){const s=new Sprite(this.textures.get('field-wall'));s.position.set(x,y);s.width=s.height=32;s.tint=0x8b9c94;this.backdrop.addChild(s);}const shade=new Graphics().rect(-16,-h,w+32,h+16).fill({color:0x102323,alpha:.38});this.backdrop.addChild(shade);}
 private desiredCamera(){const f=this.view;if(!f)return 0;return Math.max(0,Math.min(1400-(this.t.width-48)/this.t.scale,f.x-(this.t.width*.35-24)/this.t.scale));}
 get active():boolean{const f=this.view;return !!f&&this.enabled&&(fieldViewWork(f)||Math.abs(this.desiredCamera()-this.camera)>.2||Math.abs(f.x-this.heroX)>.2||this.flashes.size>0||performance.now()-this.swingAt<250);}
 update(dt:number):void{
  const f=this.view;if(!f||!this.visible)return;const actor=f.actors.find(a=>a.id===f.localActorId)!;
  this.clock+=dt;const now=performance.now(),level=f.floors[f.floor],c=FIELD_FLOORS[f.floor];
  this.heroX=this.enabled?this.previousX+(f.x-this.previousX)*Math.min(1,(now-this.received)/100):f.x;
  const desired=this.desiredCamera();this.camera=!this.enabled?desired:dt>0?this.camera+(desired-this.camera)*(1-Math.exp(-dt*10)):this.camera;this.resize(this.t.width,this.t.height);
  const hero=this.items.get('hero')!;hero.x=this.heroX;hero.sprite.x=this.heroX;hero.sprite.texture=this.textures.get((Math.abs(f.x-this.heroX)>.3||f.target&&f.active===null?'player-run-':'player-idle-')+Math.floor(this.clock*8)%4)!;hero.sprite.width=26;hero.sprite.height=46;
  this.fx.clear();
  for(const group of level.encounters)for(const m of group.monsters){const item=this.items.get(m.id)??this.add(m.id,this.monsterFrame(m.kind==='melee'&&m.id.startsWith('f1-e2-')?'summon':m.kind,false,0),m.x,0,22,30,{kind:'monster',id:m.id});const old=item.x;item.x=m.x;item.sprite.position.set(m.x,0);item.sprite.visible=m.hp>0&&fieldVisible(m.x,level.revealed);item.sprite.texture=this.textures.get(this.monsterFrame(m.kind==='melee'&&m.id.startsWith('f1-e2-')?'summon':m.kind,Math.abs(old-m.x)>0,Math.floor(this.clock*6)%4))!;item.sprite.width=m.kind==='guardian'?43:27;item.sprite.height=m.kind==='guardian'?49:42;
   if(!item.sprite.visible)continue;
   if(m.hp<m.max)this.fx.rect(m.x-14,-48,28,3).fill(0x273330).rect(m.x-14,-48,28*m.hp/m.max,3).fill(0xb9cf9e);
   if(m.stage!=='idle'){
    const ticks=Math.max(0,m.due-f.tick),fraction=1-Math.min(1,ticks/(m.kind==='melee'?6:m.kind==='ranged'&&m.stage==='projectile'?6:m.kind==='ranged'?10:16));
    const color=m.kind==='melee'?0xe8c780:m.kind==='ranged'?0x91d8e2:0xe5a088;
    if(m.kind==='guardian'&&m.pattern===1||m.kind==='charge')this.fx.rect(Math.min(m.x,m.aimX)-12,-8,Math.abs(m.x-m.aimX)+24,8).fill({color,alpha:.2+fraction*.3});
    else if(m.kind==='ranged'&&m.stage==='projectile'){const x=m.x+(m.aimX-m.x)*fraction;this.fx.circle(x,-20,4).fill(color);}
    else this.fx.arc(m.x,-25,20,-Math.PI, -Math.PI+Math.PI*fraction).stroke({width:3,color});
    this.fx.moveTo(m.aimX-6,-2).lineTo(m.aimX+6,-2).stroke({width:2,color});
   }
  }
  const boss=level.encounters.flatMap(g=>g.monsters).find(m=>m.kind==='guardian');if(this.guardianShield&&this.guardianCore){const visible=!!boss&&boss.hp>0&&fieldVisible(boss.x,level.revealed);this.guardianShield.visible=this.guardianCore.visible=visible;if(boss){const windup=boss.stage==='windup',charge=boss.stage==='charge';this.guardianShield.position.set(boss.x-16+(windup?Math.sin(this.clock*8)*4:charge?-9:0),-14);this.guardianShield.rotation=windup?-.4+Math.sin(this.clock*6)*.3:charge?-.7:.12;this.guardianCore.position.set(boss.x+5,-30+Math.sin(this.clock*5));}}
  if(this.pet){this.pet.visible=!!f.loadout.pet;this.pet.position.set(this.heroX-22,-Math.abs(Math.sin(this.clock*5))*3);this.pet.texture=this.street.get('slime-idle-'+Math.floor(this.clock*6)%4)!;}for(const [id,sprite]of this.team){const a=f.actors.find(a=>a.id===id);sprite.visible=!!a&&!a.returned&&a.floor===f.floor&&fieldVisible(a.x,level.revealed);if(a){sprite.x=a.x;sprite.alpha=a.online?1:.45;let color=0;for(const c of id)color=(color*31+c.charCodeAt(0))>>>0;this.fx.ellipse(a.x,0,15,4).stroke({width:2,color:[0x91cbd9,0xc1a1cf,0xe6c77f,0x9ecb95][color%4],alpha:a.online?1:.4});const pet=this.teamPets.get(id);if(pet){pet.visible=sprite.visible;pet.position.set(a.x-22,-Math.abs(Math.sin(this.clock*5))*3);pet.texture=this.street.get('slime-idle-'+Math.floor(this.clock*6)%4)!;}}}
  for(const shot of f.projectiles)this.fx.circle(shot.x,-23,3).fill(0x91d8e2);for(const e of f.events.filter(e=>f.tick-e.tick<7)){const a=f.actors.find(a=>a.id===e.actorId);if(!a||a.floor!==f.floor)continue;if(e.kind==='pulse')this.fx.circle(level.encounters.flatMap(g=>g.monsters).find(m=>m.id===e.targetId)?.x??a.x,-20,25+(f.tick-e.tick)*6).stroke({color:0x9bd7e5,width:2,alpha:.6});if(e.kind==='heal'||e.kind==='shield'||e.kind==='bandage')this.fx.circle(a.x,-20,18+(f.tick-e.tick)*2).stroke({color:e.kind==='shield'?0xa7d9df:0xb6d994,width:2,alpha:.7});}if(f.shield)this.fx.arc(this.heroX,-23,19,-Math.PI*.8,Math.PI*.8).stroke({color:0xa7d9df,width:2});
  const ore=this.items.get(c.ore.id)!;ore.sprite.alpha=actor.oreReadyAt[f.floor]>f.tick?.5:1;
  if(f.miningDue){const k=Math.max(0,Math.min(1,(f.tick-(f.miningDue-30))/30));this.fx.rect(level.oreX-20,-40,40,4).fill(0x263c40).rect(level.oreX-20,-40,40*k,4).fill(0xbcd99c);}
  this.items.get('exit')!.sprite.visible=fieldVisible(c.exitX,level.revealed);this.items.get('exit')!.sprite.tint=level.encounters.every(g=>g.cleared)?0xffffff:0x868794;
  for(const [id,item]of this.items){item.sprite.filters=id===this.hovered?[this.glow]:[];item.sprite.tint=id==='exit'?item.sprite.tint:0xffffff;const hit=this.flashes.get(id);if(hit){const age=now-hit.at;if(age>300){this.flashes.delete(id);}else{item.sprite.tint=age<110?0xffffff:0xffc5b2;if(age<110)item.sprite.filters=[this.flash];item.sprite.x=item.x+Math.sin(age/300*Math.PI)*5;item.sprite.alpha=age<110?.65:1;}}else if(id!=='exit'&&id!==c.ore.id)item.sprite.alpha=1;}
  if(this.weapon){this.weapon.texture=this.textures.get(f.loadout.gear.includes('breaker-hammer')?'weapon-hammer':f.loadout.gear.includes('resonant-staff')?'weapon-fire':'weapon-sword')??this.textures.get('weapon-sword')!;this.weapon.position.set(this.heroX+12,-19);this.weapon.rotation=now-this.swingAt<250?Math.sin((now-this.swingAt)/250*Math.PI)*1.8-.7:.25;}
  const hover=this.hovered?this.items.get(this.hovered):undefined;if(hover?.sprite.visible){this.fx.ellipse(hover.x,-2,hover.width*.65,4).stroke({width:2,color:0xf2d99a});}
  this.fog.clear().rect(level.revealed,-220,Math.max(1440,(this.t.width-this.t.x)/this.t.scale+32)-level.revealed,244).fill(0x17282b);for(let n=0;n<6;n++)this.fog.rect(level.revealed-18+n*3,-220,3,244).fill({color:0x17282b,alpha:(n+1)/7});
  Object.assign(document.body.dataset,{worldScale:String(this.t.scale),worldX:String(this.t.x),worldY:String(this.t.y),cameraX:String(this.camera),playerX:String(this.heroX)});this.markers();
 }
 private monsterFrame(kind:string,moving:boolean,frame:number){if(kind==='summon')return `enemy-imp-${moving?'run':'idle'}-${frame}`;if(kind==='guardian')return `boss-${moving?'run':'idle'}-${frame}`;return `enemy-${kind==='melee'?'skeleton':kind==='ranged'?'shaman':'orc'}-${moving?'run':'idle'}-${frame}`;}
 worldAt(x:number,y:number){return fieldWorldAt(this.t,x,y);}
 screenAt(x:number,y=0){return fieldScreenAt(this.t,x,y);}
 hit(x:number,y:number):{id:string;target:FieldTarget|'return'}|undefined{
  const f=this.view;if(!f||x<0||y<0||x>this.t.width||y>this.t.height)return;
  for(const item of [...this.items.values()].reverse())if(item.target&&item.sprite.visible&&fieldVisible(item.x,f.floors[f.floor].revealed)){const b=this.bounds(item);if(x>=b.x&&x<=b.x+b.width&&y>=b.y&&y<=b.y+b.height)return{id:item.id,target:item.target};}
  const w=this.worldAt(x,y);if(w.x>=0&&w.x<=f.floors[f.floor].revealed&&w.y>=-32&&w.y<=12)return{id:'field-ground',target:{kind:'ground',x:Math.round(Math.max(0,Math.min(1400,w.x)))}};
 }
 hover(x?:number,y?:number){const hit=x===undefined?undefined:this.hit(x,y!);this.hovered=hit?.id;const ghost=document.getElementById('hoverMarker')!;ghost.hidden=hit?.id!=='field-ground';if(!ghost.hidden){ghost.style.left=x+'px';ghost.style.top=Math.max(14,this.t.y-10*this.t.scale)+'px';}this.update(0);return hit?.id;}
 private bounds(i:Item):Rect{const b=i.sprite.getBounds();return{x:b.x,y:b.y,width:b.width,height:b.height};}
 private markers(){const el=document.getElementById('moveMarker')!,f=this.view;el.hidden=f?.target?.kind!=='ground';if(f?.target?.kind==='ground'){const pos=this.screenAt(f.target.x);el.style.left=pos.x+'px';el.style.top=Math.max(14,pos.y-10*this.t.scale)+'px';}}
 private mechanism(targetId:string,label:string,actorId:string){const f=this.view!,actor=f.actors.find(a=>a.id===actorId),monster=f.floors[f.floor].encounters.flatMap(g=>g.monsters).find(m=>m.id===targetId),x=monster?.x??actor?.x;if(x===undefined)return;const el=document.createElement('span');el.className='field-damage';el.textContent=label;const p=this.screenAt(x,-55);el.style.left=p.x+'px';el.style.top=Math.max(16,p.y)+'px';this.feedbackHost.append(el);setTimeout(()=>el.remove(),500);}
 personalLoot(reward:RewardPackage):void{const entries=[...Object.entries(reward.materials).map(([id,n])=>['field:'+id,n] as const),...(reward.ore?[['materials:ore',reward.ore] as const]:[])].filter(([,n])=>n).slice(0,3);if(!entries.length||!this.view)return;const node=document.createElement('span');node.className='field-personal-loot';setGeneratedMarkup(node,entries.map(([id,n])=>`<span>${inventoryArt(id)} +${n}</span>`).join(''));const p=this.screenAt(this.heroX,-60);node.style.left=Math.max(8,Math.min(innerWidth-150,p.x))+'px';node.style.top=Math.max(12,p.y)+'px';this.feedbackHost.append(node);setTimeout(()=>node.remove(),1800);}
 private resource(x:number){const el=document.createElement('span');el.className='field-damage';el.textContent='◇ +1';const pos=this.screenAt(x,-40);el.style.left=pos.x+'px';el.style.top=Math.max(0,pos.y)+'px';this.feedbackHost.append(el);setTimeout(()=>el.remove(),400);}
 private damage(id:string,amount:number){const item=this.items.get(id);if(!item)return;const el=document.createElement('span');el.className='field-damage';el.textContent='−'+amount;const p=this.screenAt(item.x,-46);el.style.left=p.x+'px';el.style.top=Math.max(0,p.y)+'px';this.feedbackHost.append(el);setTimeout(()=>el.remove(),400);}
 probe(){const f=this.view;return{floor:f?.floor,runId:this.runId,transform:{...this.t},camera:this.camera,heroX:this.heroX,authoritativeX:f?.x,revealed:f?.floors[f.floor].revealed,renderedIDs:[...this.items.values()].filter(i=>i.sprite.visible&&i.target&&f&&fieldVisible(i.x,f.floors[f.floor].revealed)).map(i=>i.id),objects:[...this.items.values()].filter(i=>i.target&&i.sprite.visible&&f&&fieldVisible(i.x,f.floors[f.floor].revealed)).map(i=>({id:i.id,x:i.x,bounds:this.bounds(i)})),hero:this.items.has('hero')?this.bounds(this.items.get('hero')!):null,active:this.active,hovered:this.hovered,highlighted:[...this.items.values()].filter(i=>i.sprite.filters?.length).map(i=>i.id),threats:f?f.floors[f.floor].encounters.flatMap(g=>g.monsters.filter(m=>m.hp>0&&fieldVisible(m.x,f.floors[f.floor].revealed)).map(m=>({id:m.id,kind:m.kind,stage:m.stage,due:m.due,aimX:m.aimX}))):[]};}
 destroy(){this.world.destroy({children:true});for(const t of this.textures.values())t.destroy();this.source?.destroy();this.feedbackHost.remove();}
}
