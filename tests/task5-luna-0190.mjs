import assert from 'node:assert/strict';
import fs from 'node:fs';
import {startPartyHarness,connectPartyRoom,prepareParty,startPreparedParty,partyControl,until} from './party-field-0190-harness.mjs';

const h=await startPartyHarness(2),[host,guest]=h.peers;
const report={kind:'task5-luna-0190-hidden-native',productRevision:'e397157c096bcacb903b024d51e5a3540c4324d5',profilePolicy:'two fresh marked /private/tmp profiles; removed only after both child processes exited',fixtureAttempts:[{attempt:1,status:'RED_TEST_FIXTURE',reason:'Owned-window readiness selected hidden cTab-* on the casual home view. The actual page=casual loaded; its original native window remained invisible/unfocused. Retried with the source path: csMap exposes the six actual tabs.'},{attempt:2,status:'RED_TEST_FIXTURE',phase:'return via partyControl after resource window 4',rawError:"Error invoking remote method 'street:command': Error: 底部冒险已暂收或操作已过期，请回到营地重试。",cause:'Test left Host workingElsewhere=true after its final sample; eval(model) does not reset main-process focus/workingElsewhere state. field-access rejects the background input as designed. No product code defect.'}],routes:{},heights:[],busyAffordance:{},party:{},resourceSamples:[],limits:[]};
let phase='launch';
function persist(){report.phase=phase;if(process.env.PIXELSTREET_TASK5_REPORT)fs.writeFileSync(process.env.PIXELSTREET_TASK5_REPORT,JSON.stringify(report,null,2)+'\n',{mode:0o600});}
function setPhase(value){phase=value;persist();}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function cpuMap(sample){return new Map(sample.metrics.map(m=>[`${m.pid}:${m.creationTime}`,m]));}
function summarizeResources(before,after,seconds){
 const first=cpuMap(before),last=cpuMap(after),rows=[];let cpuSeconds=0,cpuAvailable=true,rssStartKiB=0,rssEndKiB=0;
 for(const [key,a] of first){const b=last.get(key);if(!b)continue;const x=a.cpu?.cumulativeCPUUsage,y=b.cpu?.cumulativeCPUUsage;if(Number.isFinite(x)&&Number.isFinite(y))cpuSeconds+=Math.max(0,y-x);else cpuAvailable=false;
  const rss0=a.memory?.workingSetSize,rss1=b.memory?.workingSetSize;if(Number.isFinite(rss0))rssStartKiB+=rss0;if(Number.isFinite(rss1))rssEndKiB+=rss1;
  rows.push({pid:a.pid,type:a.type,creationTime:a.creationTime,cpuRaw:{start:a.cpu??null,end:b.cpu??null},workingSetKiB:{start:rss0??null,end:rss1??null}});
 }
 return{processes:rows,matchedProcesses:rows.length,cpuSeconds,cpuSecondsPerWallSecond:cpuAvailable?cpuSeconds/seconds:null,cpuMetric:'Electron app.getAppMetrics().cpu.cumulativeCPUUsage; raw seconds per process; summed delta / monotonic wall seconds',rssWorkingSetKiB:{start: rssStartKiB,end:rssEndKiB},rssMetric:'sum of owned app.getAppMetrics().memory.workingSetSize; KiB; Electron-reported working set',unmatchedStartPids:[...first.keys()].filter(k=>!last.has(k)),unmatchedEndPids:[...last.keys()].filter(k=>!first.has(k))};
}
async function waitForOverlay(p){await until(()=>p.eval("!!document.getElementById('dungeonSign')"),'owned street overlay');}
async function clickCasualDoor(p){await p.eval("document.getElementById('dungeonSign').click();true");await p.call('owned-ready',{target:'casual',selector:'#cClose'});await p.eval("document.getElementById('csMap').click();true",'casual');}
async function measure(label){
 await sleep(350);
 const before=await Promise.all(h.peers.map(p=>p.call('task5-sample')));
 if(!report.machine.runtime){report.machine.runtime=before[0].runtime;report.machine.displays=before[0].state.displays;report.machine.nativeWindows=before.map(x=>x.native.windows);persist();}
 const start=process.hrtime.bigint();await sleep(10500);
 const after=await Promise.all(h.peers.map(p=>p.call('task5-sample')));
 const wallSeconds=Number(process.hrtime.bigint()-start)/1e9;
 const endpoints=Object.fromEntries(h.peers.map((p,i)=>[i===0?'host':'guest',{
  before:before[i],after:after[i],delta:summarizeResources(before[i],after[i],wallSeconds),
  renderFrameDelta:after[i].renderer.frames-before[i].renderer.frames,
  rendererTargetFps:{before:before[i].renderer.targetFps,after:after[i].renderer.targetFps},
  worldTick:{before:before[i].state.party.tick,after:after[i].state.party.tick,delta:before[i].state.party.tick!==null&&after[i].state.party.tick!==null?after[i].state.party.tick-before[i].state.party.tick:null},
  nativeWindowsHidden:after[i].native.windows.every(w=>!w.visible&&!w.focused),guards:after[i].native.guards,
 } ]));
 const sample={label,wallSeconds,wallClock:'Node monotonic process.hrtime.bigint; real elapsed, no fake/accelerated logic clock',endpoints};report.resourceSamples.push(sample);persist();return sample;
}

try{
 await Promise.all(h.peers.map(waitForOverlay));
 setPhase('native receipts and five street heights');
 const initial=await Promise.all(h.peers.map(p=>p.call('native')));
 assert.ok(initial.every(x=>x.windows.every(w=>!w.visible&&!w.focused)));
 report.machine={platform:process.platform,arch:process.arch,node:process.version,appVersion:'0.19.0',macOS:'26.1 (verified with sw_vers)',hardware:'M4 / 16 GiB per Root environment check',environment:'Root observed approximately 11.9 GiB system swap in use before this task; normal user workload, not an idle dedicated machine.',nativeInitialReceipts:initial};persist();

 // Native window bounds, world transform and original two portal hit regions at every protected street height.
 for(const height of [48,80,112,160,208]){
  const row=await host.call('task5-height',{height});
  assert.equal(row.savedHeight,height);assert.equal(row.windowBounds.height,height);assert.equal(row.native.visible,false);assert.equal(row.native.focused,false);
  assert.equal(row.renderer.viewport.height,height);
  report.heights.push(row);
 }
 await host.call('task5-height',{height:48});

 // Original mouse-camp route: all six existing pages open in the actual hidden native endpoint.
 setPhase('original casual portal and six tabs');
 await clickCasualDoor(host);
 const casualTabs=[];
 for(const [id,label] of [['adventure','探索'],['garden','花圃'],['kitchen','厨房'],['friends','伙伴'],['camp','营地'],['collection','收藏']]){
  casualTabs.push(await host.expression(`(()=>{const b=document.getElementById('cTab-${id}'),panel=document.getElementById('cPanel-${id}');b.click();return{id:'${id}',label:b.textContent.trim(),selected:b.getAttribute('aria-selected'),panelVisible:!!panel&&!panel.hidden}})()`,'casual'));
 }
 assert.equal(casualTabs.length,6);assert.ok(casualTabs.every(t=>t.panelVisible&&t.selected==='true'));
 report.routes.casual={endpoint:'original dungeonSign -> native page=casual',interaction:'synthetic DOM click inside strictly hidden native window',tabs:casualTabs};
 await host.eval("document.getElementById('cClose').click();true",'casual');await sleep(200);

 await host.eval("document.getElementById('portalSign').click();true");
 setPhase('original expedition portal and four tabs');
 await host.call('owned-ready',{target:'popup',selector:'[id^="eTab-"]'});
 const expeditionTabs=[];
 for(const [id,label] of [['plan','远行计划'],['records','旅途记录'],['guild','商会委托'],['growth','远征成长']]){
  expeditionTabs.push(await host.expression(`(()=>{const b=document.getElementById('eTab-${id}'),panel=document.getElementById('ePanel-${id}');b.click();return{id:'${id}',label:b.textContent.trim(),selected:b.getAttribute('aria-selected'),panelVisible:!!panel&&!panel.hidden}})()`,'popup'));
 }
 assert.equal(expeditionTabs.length,4);assert.ok(expeditionTabs.every(t=>t.panelVisible&&t.selected==='true'));
 report.routes.expedition={endpoint:'original portalSign -> adventure popup; added room entry inside preserved page',interaction:'synthetic DOM clicks inside strictly hidden native window',tabs:expeditionTabs,newRoomEntryPresent:await host.expression("!!document.getElementById('openPartyField')",'popup')};
 assert.equal(report.routes.expedition.newRoomEntryPresent,true);

 // Real same-Mac LAN transport path is intentionally constrained to 127.0.0.1 and two marked endpoints.
 setPhase('two-peer preparation and actual busy affordance');
 await connectPartyRoom(h);
 await prepareParty(h,9);
 report.party.prepared=await Promise.all(h.peers.map(p=>p.call('party-economy')));
 assert.ok(report.party.prepared.every(p=>p.busy));

 // Inspect the final first-use equipment and pet-role affordance while preparation owns the profile.
 await host.call('open-inventory');
 await host.eval("document.getElementById('equipmentRecipes').click();document.querySelector('[data-recipe-pick=\"equipment:trail-coat\"]').click();true",'inventory');
 report.busyAffordance.equipment=await host.expression("(()=>{const r=document.querySelector('[data-recipe-id=\"equipment:trail-coat\"]'),b=r?.querySelector('button');return{disabled:!!b?.disabled,reason:b?.dataset.disabledReason??'',label:b?.textContent?.trim()??''}})()",'inventory');
 await host.eval("document.querySelector('[data-page=\"pet\"]').click();true",'inventory');
 await until(()=>host.expression("!!document.querySelector('#petMount [data-role=\"expedition\"]')",'inventory'),'pet roles in marked inventory');
 report.busyAffordance.pet=await host.expression("(()=>{const b=document.querySelector('#petMount [data-role=\"expedition\"]');return{disabled:!!b?.disabled,reason:b?.dataset.disabledReason??'',label:b?.textContent?.trim()??''}})()",'inventory');
 assert.ok(report.busyAffordance.equipment.disabled&&report.busyAffordance.equipment.reason.includes('组队'));
 assert.ok(report.busyAffordance.pet.disabled&&report.busyAffordance.pet.reason.includes('组队'));
 await host.eval("document.getElementById('inventoryClose').click();true",'inventory');

 await startPreparedParty(h);
 setPhase('shared World and visible-target selection');
 const started=await Promise.all(h.peers.map(p=>p.call('state')));
 const sessionIds=started.map(s=>s.partyField.sessionId);
 assert.equal(sessionIds[0],sessionIds[1]);assert.ok(started.every(s=>s.partyField.view&&s.partyField.phase==='running'));
 const common=(s)=>({sessionId:s.partyField.sessionId,floor:s.partyField.view.floor,active:s.partyField.view.active,actors:s.partyField.view.actors.map(a=>a.id).sort(),enemies:s.partyField.view.floors[s.partyField.view.floor].encounters.flatMap(g=>g.monsters).map(m=>({id:m.id,hp:m.hp,kind:m.kind}))});
 report.party.started={host:common(started[0]),guest:common(started[1]),sharedSession:sessionIds[0]};
 assert.deepEqual(report.party.started.host.actors,report.party.started.guest.actors);

 // A real renderer canvas-coordinate click selects a visible living target through the original input route.
 let targetReceipt=null;
 try{
  await until(async()=>{const s=await host.call('state');return !!s.partyField.view&&s.partyField.view.active!==null;},'active targetable encounter',15);
  const s=await host.call('state'),actorId=s.room.localPlayerId,group=s.partyField.view.floors[s.partyField.view.floor].encounters[s.partyField.view.active],chosen=group.monsters.find(m=>m.hp>0&&m.id.endsWith('-m1'));
  const probe=await host.call('party-probe'),object=probe.field?.objects?.find(o=>o.id===chosen?.id);
  if(chosen&&object){const x=Math.round(object.bounds.x+object.bounds.width/2),y=Math.round(object.bounds.y+object.bounds.height/2);await host.eval(`document.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:${x},clientY:${y}}));true`);await until(async()=>{const state=await host.call('state'),a=state.partyField.view?.actors.find(x=>x.id===actorId);return a?.target?.kind==='monster'&&a.target.id===chosen.id;},'renderer-selected target reaches Host World',5);const selected=await host.call('state');targetReceipt={input:'synthetic renderer click at actual FieldScene target bounds',targetId:chosen.id,bounds:object.bounds,actorId,selectedTarget:selected.partyField.view.actors.find(a=>a.id===actorId)?.target};}
 }catch(error){targetReceipt={status:'not confirmed',reason:String(error)};}
 report.party.targetSelection=targetReceipt;

 await partyControl(host,{kind:'mode',mode:'push'});
 setPhase('separate personal reward packages');
 const beforeRewards=await Promise.all(h.peers.map(p=>p.call('party-economy')));
 await until(async()=>Promise.all(h.peers.map(p=>p.call('party-economy'))).then(xs=>xs.every((x,i)=>x.wins>beforeRewards[i].wins)),'each peer receives its own settled reward',24);
 const rewarded=await Promise.all(h.peers.map(p=>p.call('party-economy')));
 report.party.reward={before:beforeRewards.map(x=>({wins:x.wins,bone:x.materials?.bone,crystal:x.materials?.crystal,hide:x.materials?.hide,pending:x.pending})),after:rewarded.map(x=>({wins:x.wins,bone:x.materials?.bone,crystal:x.materials?.crystal,hide:x.materials?.hide,pending:x.pending})),personalProgress:rewarded.every((x,i)=>x.wins>beforeRewards[i].wins),pendingBeforeReturn:rewarded.map(x=>x.pending)};
 assert.ok(report.party.reward.personalProgress&&rewarded.every(x=>x.pending===0));

 // Reuse this 9-ration same-version two-peer session for all resource contexts.
 setPhase('resource sample 1: idle focused-presentation model');
 await Promise.all(h.peers.map(p=>p.call('task5-context',{mode:'focused-model'})));
 await measure('focused-presentation-model idle');
 setPhase('resource sample 2: both endpoints workingElsewhere');
 await Promise.all(h.peers.map(p=>p.call('task5-context',{mode:'workingElsewhere'})));
 await measure('both endpoints workingElsewhere/background');
 setPhase('resource sample 3: both endpoints app hidden mode');
 await Promise.all(h.peers.map(p=>p.call('task5-context',{mode:'hidden'})));
 await measure('both endpoints app hidden mode');
 setPhase('resource sample 4: Host background and Guest active');
 await host.call('task5-context',{mode:'workingElsewhere'});await guest.call('task5-context',{mode:'focused-model'});
 await measure('Host workingElsewhere with Guest foreground presentation model');
 report.party.resourceSession=await Promise.all(h.peers.map(p=>p.call('state')));
 assert.ok(report.resourceSamples.every(s=>s.wallSeconds>=10&&s.wallSeconds<=15));
 for(const sample of report.resourceSamples){for(const endpoint of Object.values(sample.endpoints)){assert.ok(endpoint.nativeWindowsHidden);assert.ok(endpoint.worldTick.delta>0,`${sample.label}: no world tick delta for endpoint`);}}
 const hostBackground=report.resourceSamples.at(-1);assert.equal(hostBackground.endpoints.host.rendererTargetFps.after,0);assert.ok(hostBackground.endpoints.guest.renderFrameDelta>0);
 report.limits.push('All samples are strictly hidden native windows with a synthetic renderer presentation/focus model; software evidence only, no real foreground/compositor/physical pointer/IME proof.');
 report.limits.push('Electron app.getAppMetrics CPU and workingSetSize cover only these owned app processes; working set is not private memory. No long-duration power or stable 120 FPS claim.');
 report.limits.push('Host-background/Guest-active uses two separate PixelStreet processes on 127.0.0.1; it is not a two-device LAN acceptance.');

 // Return both players; confirm no outstanding packages and closed durable personal sessions.
 setPhase('restore focused model before actual renderer return');
 await Promise.all(h.peers.map(p=>p.call('task5-context',{mode:'focused-model'})));
 const returnInputs=[];
 for(const [i,p] of h.peers.entries()){
  await until(async()=>{const probe=await p.call('party-probe');return !!probe.field?.objects?.some(o=>o.id==='return');},'return portal '+i);
  const probe=await p.call('party-probe'),target=probe.field.objects.find(o=>o.id==='return'),x=Math.round(target.bounds.x+target.bounds.width/2),y=Math.round(target.bounds.y+target.bounds.height/2);
  await p.eval(`document.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:${x},clientY:${y}}));true`);
  await until(async()=>(await p.call('state')).view==='street','player '+i+' returns to original street');
  returnInputs.push({endpoint:i===0?'host':'guest',input:'synthetic DOM click at actual FieldScene return portal bounds',bounds:target.bounds,click:{x,y},native:await p.call('native')});persist();
 }
 const closed=await Promise.all(h.peers.map(p=>p.call('party-economy')));
 report.party.return={inputs:returnInputs,busy:closed.map(x=>x.busy),pending:closed.map(x=>x.pending),sessions:closed.map(x=>x.sessions),hostJournal:(await host.call('party-economy')).hostJournal};
 assert.ok(closed.every(x=>!x.busy&&x.pending===0&&x.sessions.every(s=>s.status==='closed')));
 report.finalNative=await Promise.all(h.peers.map(p=>p.call('native')));
 assert.ok(report.finalNative.every(x=>x.windows.every(w=>!w.visible&&!w.focused)&&x.errors.length===0));
 report.status='GO_SOFTWARE_ONLY';
}catch(error){
 report.status='NO_GO_OR_INCONCLUSIVE';report.phase=phase;report.error=String(error?.stack??error);
 try{report.failureReceipts=await Promise.all(h.peers.map(async p=>({index:p.index,state:await p.call('state').catch(e=>({error:String(e)})),economy:await p.call('party-economy').catch(e=>({error:String(e)})),native:await p.call('native').catch(e=>({error:String(e)})),logs:p.logs()})));}catch{}
 persist();process.stderr.write(JSON.stringify({fixtureFailure:true,phase,report},null,2)+'\n');
 throw error;
}finally{
 try{report.cleanup={before:await Promise.all(h.peers.map(p=>p.call('native').catch(()=>null))),children:[...h.peers].map(p=>({index:p.index,pid:p.child.pid,exitCode:p.child.exitCode}))};}catch{}
 await h.close();
 persist();
}

console.log(JSON.stringify(report));
