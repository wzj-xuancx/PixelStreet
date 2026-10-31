import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {EventEmitter} from 'node:events';
import * as ts from 'typescript';
import {initialProfile,transact} from '../packages/solo-core';
import {chapterIntent} from '../packages/protocol/chapter';
import {GameplayGate} from '../apps/desktop/gameplay-gate';
import {chapterCard} from '../apps/desktop/renderer/chapter-card';
// Exercise the actual shell methods without creating native windows in node:test.
function fixture(){
 const log:string[]=[];
 class Window extends EventEmitter {
  destroyed=false;shown=false;focused=false;webContents=new EventEmitter();page='';
  constructor(public options:any){super();log.push('create');}
  isDestroyed(){return this.destroyed;}isFocused(){return this.focused;}isVisible(){return this.shown;}isMinimized(){return false;}
  minimize(){log.push('minimize');}show(){this.shown=true;}showInactive(){this.shown=true;}hide(){this.shown=false;}
  destroy(){this.destroyed=true;log.push('destroy');this.emit('closed');}
  loadFile(_file:string,options:any){this.page=options.query.page;log.push('load:'+this.page);return Promise.resolve();}
 }
 const out=ts.transpileModule(fs.readFileSync('apps/desktop/shell.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const exports:any={};vm.runInNewContext(out,{exports,require:(id:string)=>id==='electron'?{BrowserWindow:Window}: {},process:{platform:'fixture'},setTimeout,clearTimeout,console});
 const shell:any=Object.create(exports.DesktopShell.prototype);
 Object.assign(shell,{mode:'interaction',gameplayGate:new GameplayGate(),state:()=>({fixture:true}),arenaWindow:null,arenaSurface:null,arenaRequested:false,page:'page',room:{inRoom:()=>false,currentRoomRun:()=>false},closePopup:()=>{},selectedDisplay:()=>({workArea:{x:0,y:0,width:1440,height:900}}),preferences:()=>({}),guardWindow:()=>{},broadcast:()=>{},cancelFocus:()=>{},focusArena:()=>{},dungeon:{pause:()=>{log.push('dungeon-pause');return Promise.resolve();}},action:{pause:()=>{log.push('action-pause');return Promise.resolve();}}});
 return {shell,log};
}
test('programmatic manual loads arena; passive loads casual; only matching surfaces reuse',()=>{
 const {shell,log}=fixture();shell.openArena(true,true);const casual=shell.arenaWindow;assert.equal(casual.page,'casual');assert.match(casual.options.title,/悠游营地/);
 shell.openArena(true,true);assert.equal(shell.arenaWindow,casual);
 shell.openArena(true);const manual=shell.arenaWindow;assert.equal(manual.page,'arena');assert.match(manual.options.title,/手动地牢/);assert.ok(casual.destroyed);assert.deepEqual(log.slice(2,6),['dungeon-pause','action-pause','destroy','create']);
 shell.openArena(true);assert.equal(shell.arenaWindow,manual);
 casual.emit('closed');assert.equal(shell.arenaWindow,manual);assert.equal(shell.arenaSurface,'arena');assert.equal(shell.arenaRequested,true);
 shell.openArena(true,true);assert.equal(shell.arenaWindow.page,'casual');assert.ok(manual.destroyed);manual.emit('closed');assert.equal(shell.arenaSurface,'casual');
 shell.closeArena();assert.equal(shell.arenaWindow,null);assert.equal(shell.arenaSurface,null);assert.equal(shell.arenaRequested,false);
});
test('surface switch retains runtime object and run, pauses without start, reset or settlement',()=>{
 const {shell}=fixture();const run={runId:'retained',paused:false,loot:2};const dungeon=shell.dungeon;dungeon.state={run,settled:false,claim:4};dungeon.pause=()=>{run.paused=true;return Promise.resolve();};
 for(const passive of [false,true,false,true]){shell.openArena(true,passive);assert.equal(shell.dungeon,dungeon);assert.equal(shell.dungeon.state.run,run);assert.equal(dungeon.state.claim,4);assert.equal(dungeon.state.settled,false);}
 assert.equal(run.paused,true);assert.equal(run.loot,2);
});
test('running guidance identifies automatic combat and returns to its field',()=>{
 let p=initialProfile(1000);p.bag.ration=3;p.job='keeper';p=transact(p,{sequence:1,requestId:'field-0171-start',action:{type:'chapter-start'}});p=transact(p,{sequence:2,requestId:'field-0171-depart',action:{type:'expedition-depart',region:0,mode:'survey',budget:3,crew:'none',meal:'none',auto:false}});
 assert.equal(chapterIntent(p).label,'挂机中 · 查看战况');assert.equal(chapterCard(p).header,'挂机中 · 自动战斗');assert.equal(chapterCard(p).primary,'返回野外画面');assert.equal(p.run!.auto,false,'automatic combat is distinct from optional automatic skills');
 const css=fs.readFileSync('apps/desktop/renderer/chapter.css','utf8');assert.match(css,/body\[data-view=field\] #stage,\s*body\[data-local-demo=true\] #stage \{background-image:url\('assets\/expedition-071\/glow-trail.webp'\)/);
});

function deferred(){let release!:()=>void;const promise=new Promise<void>(resolve=>release=resolve);return{promise,release};}
test('queued stale arena commands reject before runtime effects and preserve replacement surface',async()=>{
 const commands=[{type:'dungeon-close'},{type:'action-close'},{type:'dungeon-return'},{type:'action-return'},{type:'dungeon-claim'},{type:'action-claim'},{type:'dungeon-minimize'},{type:'dungeon-start',seed:15},{type:'action-start',weapon:'fire'},{type:'dungeon-input',input:{type:'pause',paused:false}},{type:'action-input',input:{type:'pause',paused:false}},{type:'leisure',envelope:{sequence:1,requestId:'stale-leisure',action:{type:'garden-water'}}}];
 for(const command of commands){
  const {shell}=fixture();shell.openArena(true);const old=shell.arenaWindow,blocked=deferred(),entered=deferred();const holding=shell.gameplayGate.run(()=>{entered.release();return blocked.promise;});await entered.promise;
  let effects=0;for(const runtime of [shell.dungeon,shell.action]){runtime.state={run:null,settled:true,claim:0};for(const name of ['start','input','settle','reconcile'])runtime[name]=async()=>{effects++;};}shell.game={command:async()=>{effects++;}};
  const queued=shell.arenaCommand(command);const rejected=assert.rejects(queued,/已变化|已关闭/);shell.openArena(true,true);const replacement=shell.arenaWindow;blocked.release();await holding;await rejected;
  assert.ok(old.destroyed,command.type);assert.equal(shell.arenaWindow,replacement,command.type);assert.equal(replacement.destroyed,false,command.type);assert.equal(shell.arenaSurface,'casual',command.type);assert.equal(effects,0,command.type);
 }
});
test('in-flight return finishes authorized settlement but cannot close a replacement owner',async()=>{
 for(const type of ['dungeon-return','action-return']){
  const {shell}=fixture();shell.openArena(true);const entered=deferred(),settlement=deferred();let settled=0;
  const runtime=type==='dungeon-return'?shell.dungeon:shell.action;runtime.settle=async()=>{entered.release();await settlement.promise;settled++;};
  const pending=shell.arenaCommand({type});await entered.promise;shell.openArena(true,true);const replacement=shell.arenaWindow;settlement.release();await pending;
  assert.equal(settled,1);assert.equal(shell.arenaWindow,replacement);assert.equal(replacement.destroyed,false);assert.equal(shell.arenaSurface,'casual');
 }
});
test('same-owner close and return still close normally; return settles exactly once',async()=>{
 for(const type of ['dungeon-close','action-close','dungeon-return','action-return']){
  const {shell}=fixture();shell.openArena(true);const owner=shell.arenaWindow;let settled=0;for(const runtime of [shell.dungeon,shell.action])runtime.settle=async()=>{settled++;};
  await shell.arenaCommand({type});assert.ok(owner.destroyed);assert.equal(shell.arenaWindow,null);assert.equal(settled,type.endsWith('return')?1:0);
 }
});
test('pending dungeon/action starts cannot auto-resume after owner replacement',async()=>{
 for(const type of ['dungeon-start','action-start']){
  const {shell}=fixture();shell.openArena(true);shell.arenaWindow.shown=true;shell.arenaWindow.focused=true;const entered=deferred(),starting=deferred();let resumed=0;
  for(const runtime of [shell.dungeon,shell.action]){runtime.state={run:null,settled:true,claim:0};runtime.reconcile=async()=>{};runtime.input=async()=>{resumed++;};}
  const runtime=type==='dungeon-start'?shell.dungeon:shell.action;runtime.start=async()=>{entered.release();await starting.promise;};const pending=shell.arenaCommand({type,seed:15,weapon:'fire'});await entered.promise;
  shell.openArena(true,true);const replacement=shell.arenaWindow;replacement.shown=true;replacement.focused=true;starting.release();await pending;assert.equal(resumed,0);assert.equal(shell.arenaWindow,replacement);assert.equal(replacement.destroyed,false);
 }
});
test('action start revalidates owner after asynchronous reconciliation before starting',async()=>{
 const {shell}=fixture();shell.openArena(true);shell.arenaWindow.shown=true;shell.arenaWindow.focused=true;const entered=deferred(),reconcile=deferred();let started=0;
 shell.dungeon.state={run:null,settled:true};shell.dungeon.reconcile=async()=>{entered.release();await reconcile.promise;};shell.action.state={run:null,settled:true};shell.action.start=async()=>{started++;};shell.action.input=async()=>{};
 const pending=shell.arenaCommand({type:'action-start',weapon:'fire'});await entered.promise;const rejected=assert.rejects(pending,/已变化/);shell.openArena(true,true);const replacement=shell.arenaWindow;replacement.shown=true;reconcile.release();await rejected;assert.equal(started,0);assert.equal(shell.arenaWindow,replacement);
});
