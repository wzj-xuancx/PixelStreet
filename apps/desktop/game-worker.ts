import {personalParty,publicGameState,type PersonalPartyRequest} from '../../packages/solo-core/party-ledger';
import {randomBytes,randomUUID} from 'node:crypto';
import {InventoryActionSession} from './inventory-session';
import {parentPort,workerData} from 'node:worker_threads';
import {advance,transact,parseEnvelope,createFeedbackFeed,appendFeedback,pendingFeedback,grantActionReward,hasBusinessWork,atelierWork,leisureWork,campWork,villageWork,fieldWork,type GameState,type PrivateGameState,type Profile,type RemoteActionReward} from '../../packages/solo-core';
import {prepareImportedProfile} from './profile-import';
import {GameStore} from './game-store';
const inventorySession=new InventoryActionSession();
const port=parentPort!;let testOffset=0,partySize=1;const now=()=>Date.now()+(workerData.testMode?testOffset:0);let store:GameStore,p:Profile,blocked='',savedAt=0;
let presentationActive=false;
let feedback=createFeedbackFeed(randomUUID());
const state=():PrivateGameState=>({status:blocked?'blocked':'ready',profile:p??null,partySize,error:blocked,warnings:store?.warnings??[],feedback});
const publish=()=>port.postMessage({type:'state',state:publicGameState(state())});
function commit(next:Profile):void{try{store.save(next);}catch(e){blocked='保存失败，单机进度已暂停：'+String(e);throw Error(blocked);}p=next;blocked='';savedAt=Date.now();}
function progress(at=now(),force=false):void{
 if(blocked)return;
 const pending=pendingFeedback(),next=advance(p,at,partySize,pending.observe);
 const needsSave=force||next.run?.field?.world?.actors[0].supplyUsed!==p.run?.field?.world?.actors[0].supplyUsed||Date.now()-savedAt>=5000||next.totals.crafted!==p.totals.crafted||next.totals.sold!==p.totals.sold||next.totals.wins!==p.totals.wins||next.run?.phase!==p.run?.phase||next.leisure.materials.ore!==p.leisure.materials.ore||next.run?.spent!==p.run?.spent||next.run?.field?.floor!==p.run?.field?.floor||next.run?.field?.recoverUntil!==p.run?.field?.recoverUntil;
 // Validated in-memory progress is authoritative between normal checkpoints.
 // Hit feedback stays prompt; critical transitions still save before publication.
 if(needsSave)commit(next);else p=next;
 pending.publish(event=>appendFeedback(feedback,[event]));
}
function readPartySize(value:unknown):number{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<1||value>4)throw Error('队伍人数必须是1到4的整数');return value;}
try{store=new GameStore(workerData.folder,now());p=store.value;commit(advance(p,now(),partySize));}catch(e){blocked=String(e);}
publish();
let timer:ReturnType<typeof setTimeout>|undefined;let scheduledInterval=0;
const hasWork=()=>!blocked&&!!p&&(!!p.queue||!!p.run||atelierWork(p)||leisureWork(p)||campWork(p)||villageWork(p)||hasBusinessWork(p)||(p.retail&&!p.business.managed&&(p.bag.crystal>0||p.bag.ration>2)));
function schedule():void {
 if(!hasWork()){clearTimeout(timer);timer=undefined;return;}
 const interval=presentationActive&&fieldWork(p)?100:500;
 if(timer&&scheduledInterval===interval)return;
 clearTimeout(timer);scheduledInterval=interval;
 timer=setTimeout(()=>{timer=undefined;try{progress();}catch(e){blocked='保存失败，单机进度已暂停：'+String(e);}publish();schedule();},interval);
}
schedule();
port.on('message',(m:{id:number;type:'personal-party'|'profile-read'|'inventory-preview'|'inventory-confirm'|'inventory-cancel'|'command'|'flush'|'advance'|'action-reward'|'party-context'|'presentation-context'|'import-profile';generation?:number;token?:string;request?:unknown;profile?:unknown;expectedSequence?:number;envelope?:unknown;ms?:number;claim?:number;coins?:number;xp?:number;remote?:unknown;partySize?:unknown;active?:unknown;personal?:PersonalPartyRequest})=>{
  const pending=pendingFeedback();
  try{
    if(m.type==='profile-read'){if(!p)throw Error(blocked||'当前进度未就绪');port.postMessage({type:'reply',id:m.id,state:publicGameState(state()),result:state()});return;}
    if(m.type==='personal-party'){const result=personalParty(p,m.personal!,randomBytes(32).toString('hex'));commit(result.profile);publish();port.postMessage({type:'reply',id:m.id,state:publicGameState(state()),result:result.reply});return;}
    if(blocked)throw Error(blocked);
    if(m.type==='inventory-preview'){const result=inventorySession.prepare(p,m.generation!,m.request);port.postMessage({type:'reply',id:m.id,state:publicGameState(state()),result});return;}
    else if(m.type==='inventory-cancel')inventorySession.cancel(m.token);
    else if(m.type==='inventory-confirm')commit(inventorySession.confirm(advance(p,now(),partySize,pending.observe),m.generation!,m.token!,partySize));
    else if(m.type==='command'){
      const envelope=parseEnvelope(m.envelope),receipt=p.receipt;
      if(receipt?.sequence===envelope.sequence&&receipt.requestId===envelope.requestId&&receipt.fingerprint===JSON.stringify(envelope.action))transact(p,envelope,partySize);
      else commit(transact(advance(p,now(),partySize,pending.observe),envelope,partySize,pending.observe));
    }
    else if(m.type==='import-profile'){
      if(m.expectedSequence!==p.sequence)throw Error('预览后进度已变化，请重新选择存档。');
      progress(now(),true);const next=prepareImportedProfile(m.profile,p,now());
      try{store.importProgress(next);}catch(e){blocked='导入保存失败，原进度与备份保留：'+String(e);throw Error(blocked);}
      p=next;savedAt=Date.now();feedback=createFeedbackFeed(randomUUID());
    }
    else if(m.type==='action-reward')commit(grantActionReward(advance(p,now(),partySize,pending.observe),m.claim!,m.coins!,m.xp!,m.remote as RemoteActionReward|undefined));
    else if(m.type==='presentation-context'){
      if(typeof m.active!=='boolean')throw Error('呈现状态无效');presentationActive=m.active;
    }
    else if(m.type==='party-context'){
      const nextPartySize=readPartySize(m.partySize);
      if(nextPartySize!==partySize){progress(now(),true);partySize=nextPartySize;}
    }
    else if(m.type==='flush')progress(now(),true);
    else if(m.type==='advance'&&workerData.testMode&&Number.isSafeInteger(m.ms)&&m.ms!>=0&&m.ms!<=8*3600*1000){testOffset+=m.ms!;commit(advance(p,now(),partySize,pending.observe));}
    else throw Error('未知Worker操作');
    pending.publish(event=>appendFeedback(feedback,[event]));publish();port.postMessage({type:'reply',id:m.id,state:publicGameState(state())});
  }catch(e){if(blocked)publish();port.postMessage({type:'reply',id:m.id,error:String(e)});}
  finally{schedule();}
});
port.on('close',()=>clearTimeout(timer));
