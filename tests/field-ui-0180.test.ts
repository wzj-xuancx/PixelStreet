import test from 'node:test';
import assert from 'node:assert/strict';
import {fieldTransform,fieldWorldAt,fieldScreenAt,fieldVisible} from '../apps/desktop/renderer/field-geometry';
import {parseCommand} from '../packages/protocol';
import {fieldTargetHint} from '../apps/desktop/renderer/scene-interaction';
import {assertFieldAccess} from '../apps/desktop/field-access';
test('five heights: world input inverts camera/scale and fog excludes undiscovered objects',()=>{
 for(const height of [48,80,112,160,208])for(const camera of [0,400,1000]){
  const t=fieldTransform(1280,height,camera);for(const x of [0,40,150,320,700,1320,1400]){const s=fieldScreenAt(t,x,-16);assert.ok(Math.abs(fieldWorldAt(t,s.x,s.y).x-x)<1);}
  assert.equal(fieldVisible(401,400),false);assert.equal(fieldVisible(400,400),true);
 }
});
test('narrow field intents reject unknown keys, stale shapes and economic fields',()=>{
 const c={type:'field-control',epoch:0,intent:{kind:'enter'}};assert.deepEqual(parseCommand(c),c);
 for(const v of [{...c,budget:9},{...c,intent:{kind:'enter',budget:9}},{...c,epoch:-1},{...c,intent:{kind:'target',target:{kind:'ground',x:NaN}}},{...c,intent:{kind:'mode',mode:'farm'}}])assert.throws(()=>parseCommand(v));
 assert.throws(()=>parseCommand({type:'game',generation:1,envelope:{sequence:1,requestId:'field-bypass-001',action:{type:'field-enter',budget:9}}}));
 assert.throws(()=>parseCommand({type:'return-camp',envelope:{sequence:1,requestId:'field-bypass-002',action:{type:'field-return',runId:'run-1'}}}));
 const valid={type:'field-control',epoch:2,runId:'run-1',floor:0,intent:{kind:'target',target:{kind:'ground',x:120}}};assert.deepEqual(parseCommand(valid),valid);
});
test('field owner guard checks every admission condition',()=>{
 const a={accepted:true,epoch:2,visible:true,hidden:false,interaction:true,workingElsewhere:false};assert.doesNotThrow(()=>assertFieldAccess(a,2));
 for(const x of [{accepted:false},{epoch:3},{visible:false},{hidden:true},{interaction:false},{workingElsewhere:true}])assert.throws(()=>assertFieldAccess({...a,...x},2));
});

test('new field target purposes and settings navigation schema remain narrow',()=>{
 assert.match(fieldTargetHint('f0-e0-m0',0),/走近.*普攻/);assert.match(fieldTargetHint('return',0),/回.*营.*结算/);assert.match(fieldTargetHint('exit',0),/下一关/);assert.match(fieldTargetHint('exit',1),/完成.*回营/);assert.equal(fieldTargetHint('field-ground',0),'');
 assert.deepEqual(parseCommand({type:'expedition-open',generation:2}),{type:'expedition-open',generation:2});for(const v of [{type:'expedition-open',generation:0},{type:'expedition-open',generation:2,budget:9}])assert.throws(()=>parseCommand(v));
});
