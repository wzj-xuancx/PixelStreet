import test from 'node:test';
import assert from 'node:assert/strict';
import {defaults} from '../packages/protocol';
import {emptyRoom} from '../packages/protocol/room';
import {roomMarkup} from '../apps/desktop/renderer/room';
import {sceneTargetFps} from '../apps/desktop/renderer/scene';

test('camp remains still when idle or working, and targets 120fps only during local interaction',()=>{
 assert.equal(sceneTargetFps({mode:'hidden',workingElsewhere:true,settings:defaults}),0);
 assert.equal(sceneTargetFps({mode:'display',workingElsewhere:true,settings:{...defaults,mode:'friends'}},true),0);
 assert.equal(sceneTargetFps({mode:'interaction',workingElsewhere:true,settings:{...defaults,mode:'friends'}},true),0);
 for(const mode of ['display','interaction'] as const)for(const setting of ['quiet','friends'] as const){
   assert.equal(sceneTargetFps({mode,workingElsewhere:false,settings:{...defaults,mode:setting}}),0);
   assert.equal(sceneTargetFps({mode,workingElsewhere:false,settings:{...defaults,mode:setting}},true),120);
 }
});

test('room UI exposes idle presence and bonus rates without battle-start or weapon controls',()=>{
 const markup=roomMarkup();
 const guide=markup.match(/<details id="roomGuide">([\s\S]*?)<\/details>/)?.[1]??'';
 assert.match(emptyRoom().notice,/营地和野外/);
 assert.match(guide,/5%/);
 assert.match(guide,/上限15%/);
 assert.match(guide,/野外材料/);
 assert.doesNotMatch(markup,/roomWeapon|roomOpenAction|下一局武器|主动冒险窗口/);
});
