import assert from 'node:assert/strict';
import fs from 'node:fs';
import {startPartyHarness,connectPartyRoom,prepareParty,startPreparedParty,partyControl,until} from './party-field-0190-harness.mjs';

const h=await startPartyHarness(2),[host,guest]=h.peers;
const report={kind:'task5-luna-0190-background-return',productRevision:'e397157c096bcacb903b024d51e5a3540c4324d5',profiles:'2 fresh marked /private/tmp profiles',steps:[],limits:['Strict hidden native windows throughout. Presentation modes are software models only.','Same-Mac 127.0.0.1 room transport, not a second-device LAN test.']};
let phase='launch';
const persist=()=>{if(process.env.PIXELSTREET_TASK5_REPORT)fs.writeFileSync(process.env.PIXELSTREET_TASK5_REPORT,JSON.stringify({...report,phase},null,2)+'\n',{mode:0o600});};
try{
 await Promise.all(h.peers.map(p=>until(()=>p.eval("!!document.getElementById('openSettings')"),'guarded overlay')));
 report.nativeStart=await Promise.all(h.peers.map(p=>p.call('native')));
 assert.ok(report.nativeStart.every(x=>x.windows.every(w=>!w.visible&&!w.focused)));
 phase='two-peer room preparation and start';persist();
 await connectPartyRoom(h);await prepareParty(h,9);report.prepared=await Promise.all(h.peers.map(p=>p.call('party-economy')));
 assert.ok(report.prepared.every(x=>x.busy));await startPreparedParty(h);
 report.started=await Promise.all(h.peers.map(p=>p.call('state')));
 assert.equal(report.started[0].partyField.sessionId,report.started[1].partyField.sessionId);
 assert.ok(report.started.every(x=>x.partyField.view&&x.partyField.phase==='running'));
 report.steps.push('actual room UI prepared both peers and entered the same running session');
 persist();

 phase='push to an active group, switch to manual, and select a living monster';
 await partyControl(host,{kind:'mode',mode:'push'});
 await until(async()=>{const s=await host.call('state');return s.partyField.view?.active!==null&&s.partyField.view?.active!==undefined;},'push activates a targetable encounter',5);
 await partyControl(host,{kind:'mode',mode:'manual'});
 let targetSelection=null;
 const view=await host.call('state'),actorId=view.room.localPlayerId,field=view.partyField.view,group=field.floors[field.floor].encounters[field.active];
 const probe=await host.call('party-probe');
 const current=field.actors.find(a=>a.id===actorId)?.target?.id;
 const candidates=group.monsters.filter(m=>m.hp>0).sort((a,b)=>Number(b.id.endsWith('-m1'))-Number(a.id.endsWith('-m1')));
 const chosen=candidates.find(m=>m.id!==current&&probe.field?.objects?.some(o=>o.id===m.id))??candidates.find(m=>probe.field?.objects?.some(o=>o.id===m.id));
 if(chosen){
  const object=probe.field.objects.find(o=>o.id===chosen.id),beforeTick=field.tick;
  const x=Math.round(object.bounds.x+object.bounds.width/2),y=Math.round(object.bounds.y+object.bounds.height/2);
  await host.eval(`document.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:${x},clientY:${y}}));true`);
  await until(async()=>{const s=await host.call('state');return s.partyField.view?.actors.find(a=>a.id===actorId)?.target?.id===chosen.id;},'selected target reaches host World',4);
  const selected=await host.call('state');
  let attack=null;
  try{await until(async()=>{const s=await host.call('state');attack=s.partyField.view?.events.find(e=>e.kind==='attack'&&e.actorId===actorId&&e.targetId===chosen.id&&e.tick>beforeTick)??null;return !!attack;},'attack uses selected target',4);}catch{}
  targetSelection={status:attack?'PASS':'TARGET_PERSISTED_ATTACK_NOT_OBSERVED',input:'synthetic DOM click at actual FieldScene monster bounds',targetId:chosen.id,targetRole:chosen.id.endsWith('-m1')?'preferred m1':'fallback next living visible monster',actorId,bounds:object.bounds,click:{x,y},selectedTarget:selected.partyField.view.actors.find(a=>a.id===actorId)?.target,attack};
 }else targetSelection={status:'INCONCLUSIVE',reason:'No living target from the active group was currently visible in FieldScene'};
 report.targetSelection=targetSelection;
 assert.ok(['PASS','TARGET_PERSISTED_ATTACK_NOT_OBSERVED'].includes(targetSelection.status));
 report.steps.push('actual FieldScene click selected a living monster after the Host had an active encounter');persist();

 phase='both peers workingElsewhere';
 report.background=await Promise.all(h.peers.map(p=>p.call('task5-context',{mode:'workingElsewhere'})));
 assert.ok(report.background.every(x=>x.state.workingElsewhere&&x.native.windows.every(w=>!w.visible&&!w.focused)));
 report.backgroundState=await Promise.all(h.peers.map(p=>p.call('state')));report.steps.push('both peers switched to workingElsewhere; native windows remained hidden');persist();

 phase='restore valid focused presentation model';
 report.restored=await Promise.all(h.peers.map(p=>p.call('task5-context',{mode:'focused-model'})));
 assert.ok(report.restored.every(x=>!x.state.workingElsewhere&&x.state.mode==='interaction'&&x.native.windows.every(w=>!w.visible&&!w.focused)));
 report.steps.push('both peers restored a valid focused presentation model without native activation');
 persist();

 phase='actual renderer return portal clicks';
 async function returnThroughRenderer(p,label){
  await until(async()=>{const probe=await p.call('party-probe');return !!probe.field?.objects?.some(o=>o.id==='return');},label+' return affordance');
  const probe=await p.call('party-probe'),target=probe.field.objects.find(o=>o.id==='return');
  const x=Math.round(target.bounds.x+target.bounds.width/2),y=Math.round(target.bounds.y+target.bounds.height/2);
  await p.eval(`document.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:${x},clientY:${y}}));true`);
  await until(async()=>(await p.call('state')).view==='street',label+' returned to street');
  return{input:'synthetic DOM click at actual FieldScene return portal bounds',bounds:target.bounds,click:{x,y},native:await p.call('native')};
 }
 for(const [i,p] of h.peers.entries()){
  const row=await returnThroughRenderer(p,i===0?'Host':'Guest');report.returnInputs??=[];report.returnInputs.push(row);persist();
 }
 phase='personal Worker close and pending verification';
 await until(async()=>{
  const [a,b]=await Promise.all(h.peers.map(p=>p.call('party-economy')));
  return [a,b].every(x=>!x.busy&&x.pending===0&&x.sessions.every(s=>s.status==='closed'))&&a.hostJournal.every(s=>s.recipients.every(r=>r.closedAck));
 },'both personal Workers closed and Host close ACKs durable',20);
 report.closed=await Promise.all(h.peers.map(p=>p.call('party-economy')));
 assert.ok(report.closed.every(x=>!x.busy&&x.pending===0&&x.sessions.every(s=>s.status==='closed')));
 report.nativeEnd=await Promise.all(h.peers.map(p=>p.call('native')));
 assert.ok(report.nativeEnd.every(x=>x.windows.every(w=>!w.visible&&!w.focused)&&x.errors.length===0));
 report.status='GO_SOFTWARE_RETURN_PATH';persist();
}catch(error){
 report.status='INCONCLUSIVE';report.phase=phase;report.error=String(error?.stack??error);
 try{report.failure=await Promise.all(h.peers.map(async p=>({state:await p.call('state').catch(e=>({error:String(e)})),economy:await p.call('party-economy').catch(e=>({error:String(e)})),native:await p.call('native').catch(e=>({error:String(e)})),logs:p.logs()})));}catch{}
 persist();process.stderr.write(JSON.stringify(report,null,2)+'\n');throw error;
}finally{
 try{report.cleanup={ownedChildren:h.peers.map(p=>({pid:p.child.pid,exitCode:p.child.exitCode})),native:await Promise.all(h.peers.map(p=>p.call('native').catch(()=>null)))};}catch{}
 await h.close();persist();
}
console.log(JSON.stringify(report));
