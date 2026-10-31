import test from 'node:test';
import assert from 'node:assert/strict';
import {FieldHud} from '../apps/desktop/renderer/field-hud';
import {defaults,type ShellState} from '../packages/protocol';
function fixture(send:()=>Promise<void>=async()=>{}){
 const span={textContent:''},guide={hidden:false},issue={hidden:true,dataset:{},querySelector:(selector:string)=>selector==='span'?span:guide};const node=()=>({hidden:true,textContent:'',disabled:false,setAttribute:()=>{},getAttribute:()=>'',classList:{toggle:()=>{}}});
 const hud:any=Object.create(FieldHud.prototype);Object.assign(hud,{root:node(),status:{querySelector:()=>node()},button:node(),menu:{...node(),querySelectorAll:()=>[]},note:node(),issue,send,issueSerial:0,settledReplies:0});
 const camp={epoch:4,revision:1,mode:'interaction',view:'street',activeShop:null,settings:{...defaults,interactionEnabled:true},game:{status:'ready',profile:{run:null}},popup:null} as unknown as ShellState;
 return{hud,issue,span,guide,camp};
}
test('actual FieldHud keeps prerequisite issue and node identities across ordinary camp snapshots',()=>{
 const f=fixture();f.hud.apply(f.camp);f.hud.showIssue('缺少旅行口粮，请在补给店制作。');assert.equal(f.issue.hidden,false);const issue=f.hud.issue;
 for(let n=0;n<4;n++)f.hud.apply({...f.camp,revision:2+n});assert.equal(f.issue.hidden,false);assert.equal(f.hud.issue,issue);assert.equal(f.hud.issue.querySelector('button'),f.guide);
});
test('actual FieldHud clears on navigation/hidden/disabled/working and can be dismissed',()=>{
 for(const change of [{view:'interior',activeShop:'shop-bakery'},{view:'field',game:{profile:{run:{id:'run-1',hp:70,remaining:3,field:{floor:0,mode:'manual'}}}}},{epoch:5},{popup:{kind:'settings',generation:7}},{inventory:{generation:9}},{mode:'hidden'},{workingElsewhere:true},{settings:{...defaults,interactionEnabled:false}}]){
  const f=fixture();f.hud.apply(f.camp);f.hud.showIssue('先完成任职试餐');f.hud.apply({...f.camp,...change});assert.equal(f.issue.hidden,true);f.hud.apply(f.camp);assert.equal(f.issue.hidden,true);
 }
 const f=fixture();f.hud.apply(f.camp);f.hud.showIssue('缺少旅行口粮');f.hud.clearIssue();assert.equal(f.issue.hidden,true);
});
test('actual FieldHud cannot revive an awaited entry error after navigation',async()=>{
 let reject!:(e:Error)=>void;const f=fixture(()=>new Promise<void>((_,r)=>reject=r));f.hud.apply(f.camp);const pending=f.hud.intent({kind:'enter'});f.hud.apply({...f.camp,view:'interior',activeShop:'shop-bakery'});reject(Error('缺少旅行口粮'));await pending;assert.equal(f.issue.hidden,true);
});

function pending(){let reject!:(e:Error)=>void;const promise=new Promise<void>((_,r)=>reject=r);return{promise,reject};}
test('actual FieldHud permanently retires pending entry on settings ABA, including an invisible issue',async()=>{
 for(const explicitClear of [true,false]){const request=pending(),f=fixture(()=>request.promise);f.hud.apply(f.camp);const started=f.hud.intent({kind:'enter'});if(explicitClear)f.hud.clearIssue();f.hud.apply({...f.camp,popup:{kind:'settings',generation:9}});f.hud.apply(f.camp);request.reject(Error('旧缺少口粮'));await started;assert.equal(f.issue.hidden,true);}
});
test('actual FieldHud dismiss in same context permanently retires an older pending reply',async()=>{
 const request=pending(),f=fixture(()=>request.promise);f.hud.apply(f.camp);const started=f.hud.intent({kind:'enter'});f.hud.showIssue('缺少口粮');f.hud.clearIssue();request.reject(Error('迟到的缺少口粮'));await started;assert.equal(f.issue.hidden,true);
});
test('actual FieldHud newer request wins and a genuinely new current error still displays',async()=>{
 const old=pending(),fresh=pending();let calls=0;const f=fixture(()=>calls++?fresh.promise:old.promise);f.hud.apply(f.camp);const first=f.hud.intent({kind:'enter'}),second=f.hud.intent({kind:'enter'});fresh.reject(Error('当前缺少口粮'));await second;assert.equal(f.issue.hidden,false);assert.equal(f.span.textContent,'当前缺少口粮');old.reject(Error('过期缺少口粮'));await first;assert.equal(f.span.textContent,'当前缺少口粮');assert.equal(f.issue.hidden,false);f.hud.apply({...f.camp,revision:8});assert.equal(f.issue.hidden,false);
});
