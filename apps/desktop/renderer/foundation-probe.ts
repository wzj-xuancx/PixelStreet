import {Application,Container,Graphics,UPDATE_PRIORITY} from 'pixi.js';
import 'pixi.js/unsafe-eval';
import {WorldCamera,FixedClock,FrameStats,movement,interpolate} from '../../../packages/dungeon-core/foundation';
const app=new Application(),world=new Container(),camera=new WorldCamera(),clock=new FixedClock(),stats=new FrameStats();
await app.init({resizeTo:window,background:0x111620,antialias:false,resolution:devicePixelRatio,autoDensity:true,autoStart:false,sharedTicker:false,preference:'webgl'});
document.getElementById('world')!.appendChild(app.canvas);app.stage.addChild(world);camera.x=480;camera.y=270;
const tiles=new Graphics();for(let y=0;y<48;y++)for(let x=0;x<64;x++)tiles.rect(x*24,y*24,23,23).fill((x+y)%2?0x283142:0x303a4c);world.addChild(tiles);
const actor=new Graphics().circle(0,0,9).fill(0x99dbbf);world.addChild(actor);
let p={x:480,y:270},previous={...p},keys=new Set<string>(),focused=document.hasFocus(),pointer={x:0,y:0};
const hud=document.getElementById('hud')!;let frameBegin=0,lastHud=0;
function clear():void{keys.clear();clock.reset();}
function syncActive():void {focused=document.hasFocus()&&document.visibilityState!=='hidden';if(focused){clock.reset();app.start();}else{clear();app.stop();}}
window.addEventListener('blur',syncActive);window.addEventListener('focus',syncActive);document.addEventListener('visibilitychange',syncActive);window.addEventListener('pagehide',()=>{clear();app.stop();});
let dpr= devicePixelRatio;
function resize():void {dpr=devicePixelRatio;app.renderer.resize(innerWidth,innerHeight,dpr);camera.resize(innerWidth,innerHeight);}
window.addEventListener('resize',resize);
function watchDpr():void {const query=matchMedia(`(resolution: ${devicePixelRatio}dppx)`);query.addEventListener('change',()=>{resize();watchDpr();},{once:true});}watchDpr();

window.addEventListener('keydown',e=>{if(document.hasFocus())keys.add(e.code);});window.addEventListener('keyup',e=>keys.delete(e.code));
app.canvas.addEventListener('pointermove',e=>{const r=app.canvas.getBoundingClientRect();pointer=camera.screenToWorld({x:e.clientX-r.x,y:e.clientY-r.y});});
document.getElementById('zoom')!.addEventListener('input',e=>camera.setZoom(Number((e.target as HTMLInputElement).value)));
app.ticker.maxFPS=120;app.ticker.minFPS=0;
app.ticker.add(()=>{
 const begin=performance.now();frameBegin=begin;if(dpr!==devicePixelRatio)resize();camera.resize(innerWidth,innerHeight);
 const alpha=clock.advance(begin,dt=>{previous={...p};const d=movement(Number(keys.has('KeyD'))-Number(keys.has('KeyA')),Number(keys.has('KeyS'))-Number(keys.has('KeyW')),180,dt);p.x+=d.x;p.y+=d.y;});
 const display=interpolate(previous,p,alpha);actor.position.set(display.x,display.y);world.scale.set(camera.zoom);world.position.set(camera.offset.x,camera.offset.y);
 if(begin-lastHud>400){lastHud=begin;hud.textContent=`世界格宽 ${(camera.visibleWorld.width/24).toFixed(1)} · 实测 ${stats.fps.toFixed(1)} FPS`;}
},undefined,UPDATE_PRIORITY.HIGH);
// Runs after Application render (LOW): measures CPU submission, not GPU completion/presentation.
app.ticker.add(()=>stats.record(frameBegin,performance.now()-frameBegin),undefined,UPDATE_PRIORITY.LOW-1);
Object.assign(window,{foundationProbe:{camera,stats,app,clock,get state(){return{p,previous,focused,pointer,keys:[...keys],hud:document.getElementById('hud')!.getBoundingClientRect().toJSON(),tileScreenSize:24*camera.zoom,visibleTiles:camera.visibleWorld.width/24};}}});
syncActive();document.body.dataset.ready='true';
