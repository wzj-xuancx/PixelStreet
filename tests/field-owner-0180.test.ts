import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as ts from 'typescript';
import {randomUUID} from 'node:crypto';
import {assertFieldAccess} from '../apps/desktop/field-access';
import {GameplayGate} from '../apps/desktop/gameplay-gate';
import {chapterIntent,chapterGenerationAllowed} from '../packages/protocol/chapter';
import {chapterCard} from '../apps/desktop/renderer/chapter-card';
import {initialProfile,transact,advance,chapterView,type Profile,type GameAction,type GameEnvelope} from '../packages/solo-core';
function deferred(){let release!:()=>void;const promise=new Promise<void>(r=>release=r);return{promise,release};}
function fixture(){
 const code=ts.transpileModule(fs.readFileSync('apps/desktop/shell.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,exports:any={};
 vm.runInNewContext(code,{exports,require:(id:string)=>id==='./field-access'?{assertFieldAccess}:id==='../../packages/protocol/chapter'?{chapterIntent,chapterGenerationAllowed}:id==='../../packages/solo-core'?{chapterView}:{},crypto:{randomUUID},setTimeout,clearTimeout,console});
 const shell:any=Object.create(exports.DesktopShell.prototype),window={isDestroyed:()=>false,isVisible:()=>true,isMinimized:()=>false};let p=initialProfile(1000);p.job='keeper';p.bag.ration=3;const effects:GameEnvelope[]=[];
 Object.assign(shell,{overlay:window,epoch:4,mode:'interaction',view:'street',workingElsewhere:false,store:{value:{interactionEnabled:true}},gameplayGate:new GameplayGate(),dungeon:{state:{run:null},reconcile:async()=>{}},action:{state:{run:null}},game:{state:{profile:structuredClone(p)},authoritativeProfile:async()=>p,command:async(e:GameEnvelope)=>{effects.push(e);p=transact(p,structuredClone(e));shell.game.state.profile=p;}},closePopup:()=>{},setView:(view:string)=>shell.view=view,broadcast:()=>{},state:()=>({})});
 return{shell,effects,p:()=>p,setProfile:(value:Profile)=>{p=value;shell.game.state.profile=p;},enter:{type:'field-control',epoch:4,intent:{kind:'enter'}}};
}
test('main creates field envelopes from fresh authority and caps its own budget; resuming field keeps run',async()=>{
 const f=fixture();f.shell.game.state.profile.bag.ration=9;await f.shell.fieldCommand('overlay',f.enter);assert.equal((f.effects[0].action as any).budget,3);assert.equal(f.p().run!.budget,3);const before=structuredClone(f.p().run);await f.shell.fieldCommand('overlay',{...f.enter,runId:before!.id,floor:0});assert.equal(f.effects.length,1);assert.deepEqual(f.p().run,before);
});
test('main rejects foreign owner and stale run/floor before mutation',async()=>{
 const f=fixture();assert.throws(()=>f.shell.fieldCommand('popup',f.enter));await f.shell.fieldCommand('overlay',f.enter);
 for(const c of [{runId:'run-999',floor:0},{runId:f.p().run!.id,floor:1}])await assert.rejects(f.shell.fieldCommand('overlay',{...f.enter,...c,intent:{kind:'mode',mode:'push'}}),/趟次/);assert.equal(f.effects.length,1);
});
test('queued field intent rechecks hidden/epoch/interaction/working/owner at execution',async()=>{
 for(const mutate of [(s:any)=>s.mode='hidden',(s:any)=>s.epoch++,(s:any)=>s.store.value.interactionEnabled=false,(s:any)=>s.workingElsewhere=true,(s:any)=>s.overlay={...s.overlay}]){
  const f=fixture(),hold=deferred(),entered=deferred();const holding=f.shell.gameplayGate.run(()=>{entered.release();return hold.promise;});await entered.promise;const pending=f.shell.fieldCommand('overlay',f.enter),rejected=assert.rejects(pending,/暂收|过期/);mutate(f.shell);hold.release();await holding;await rejected;assert.equal(f.effects.length,0);
 }
});
test('field intent rechecks presentation and accepted owner after await authoritative read',async()=>{
 for(const mutate of [(s:any)=>s.mode='hidden',(s:any)=>s.epoch++,(s:any)=>s.store.value.interactionEnabled=false,(s:any)=>s.workingElsewhere=true,(s:any)=>s.overlay={...s.overlay},(s:any)=>s.overlay.isVisible=()=>false]){
  const f=fixture(),hold=deferred(),entered=deferred();f.shell.game.authoritativeProfile=async()=>{entered.release();await hold.promise;return f.p();};const pending=f.shell.fieldCommand('overlay',f.enter);await entered.promise;const rejected=assert.rejects(pending,/暂收|过期/);mutate(f.shell);hold.release();await rejected;assert.equal(f.effects.length,0);
 }
});

test('native overlay destruction transition cannot publish bounds of the retired owner',()=>{const f=fixture();let read=false;f.shell.overlay.isDestroyed=()=>true;f.shell.state=()=>{read=true;throw Error('retired overlay bounds');};assert.doesNotThrow(()=>f.shell.publishPresentation());assert.equal(read,false);});

test('chapter actual method reserves the promised3 with9 available as original expedition',async()=>{
 const f=fixture();let p=initialProfile(1000);const act=(a:GameAction)=>p=transact(p,{sequence:p.sequence+1,requestId:'chapter-budget-'+(p.sequence+1),action:a});act({type:'chapter-start'});for(let n=0;n<40&&chapterView(p).step!=='depart';n++){const i=chapterIntent(p);if(i.action)act(i.action);else p=advance(p,p.wallAt+30000);}assert.equal(chapterView(p).step,'depart');p.bag.ration=9;f.setProfile(p);
 assert.match(chapterIntent(p).label,/3/);assert.equal(chapterCard(p).resources.find(r=>r.id==='ration')?.needed,3);
 Object.assign(f.shell,{popup:{kind:'chapter',generation:8,suspended:false},popupWindow:f.shell.overlay,chapterPresentation:{location:'expedition',replay:false},chapterSession:{cancel:()=>{}}});
 await f.shell.chapterCommand('popup',{type:'chapter',generation:8,op:'perform'});assert.equal(f.p().run!.budget,3);assert.equal(f.p().bag.ration,6);assert.equal((f.effects.at(-1)!.action as any).budget,3);assert.equal(f.effects.at(-1)!.action.type,'expedition-depart');assert.equal(f.p().run!.field,undefined);const running=structuredClone(f.p());await f.shell.chapterCommand('popup',{type:'chapter',generation:8,op:'perform'});assert.deepEqual(f.p(),running);assert.equal(f.shell.view,'field');
});
test('settings-only expedition navigation checks generation, accepted owner and presentation without economy mutation',()=>{
 const f=fixture(),accepted=f.shell.overlay;let opened=0;Object.assign(f.shell,{popup:{kind:'settings',generation:8,suspended:false,anchor:{}},popupWindow:accepted,openPopup:(kind:string)=>{assert.equal(kind,'adventure');opened++;}});
 assert.throws(()=>f.shell.openExpeditionFromSettings('overlay',8));assert.throws(()=>f.shell.openExpeditionFromSettings('popup',7));
 for(const property of ['hidden','working','disabled','suspended','invisible']){const previous={mode:f.shell.mode,working:f.shell.workingElsewhere,enabled:f.shell.store.value.interactionEnabled,suspended:f.shell.popup.suspended};if(property==='hidden')f.shell.mode='hidden';if(property==='working')f.shell.workingElsewhere=true;if(property==='disabled')f.shell.store.value.interactionEnabled=false;if(property==='suspended')f.shell.popup.suspended=true;if(property==='invisible')accepted.isVisible=()=>false;assert.throws(()=>f.shell.openExpeditionFromSettings('popup',8));f.shell.mode=previous.mode;f.shell.workingElsewhere=previous.working;f.shell.store.value.interactionEnabled=previous.enabled;f.shell.popup.suspended=previous.suspended;accepted.isVisible=()=>true;}
 f.shell.openExpeditionFromSettings('popup',8);assert.equal(opened,1);assert.equal(f.effects.length,0);
});
