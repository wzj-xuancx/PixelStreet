import test from 'node:test';
import assert from 'node:assert/strict';
import {SoundGate,DUNGEON_SOUNDS} from '../apps/desktop/renderer/dungeon-audio';
test('audio gate bounds concurrent voices and coalesces dense same-kind hits',()=>{
 const gate=new SoundGate(2);assert.equal(gate.acquire('hit',0),true);assert.equal(gate.acquire('hit',16),false);
 assert.equal(gate.acquire('heavy',16),true);assert.equal(gate.acquire('kill',17),false);
 gate.release();assert.equal(gate.acquire('hit',60),true);assert.equal(gate.activeVoices,2);
 gate.release();gate.release();gate.release();assert.equal(gate.activeVoices,0);
 assert.equal(gate.acquire('dot',100),true);gate.release();assert.equal(gate.acquire('dot',299),false);assert.equal(gate.acquire('dot',300),true);
});
test('each gameplay sound points at a distinct licensed sample file',()=>{
 assert.equal(new Set(Object.values(DUNGEON_SOUNDS)).size,Object.keys(DUNGEON_SOUNDS).length);
 assert.ok(Object.values(DUNGEON_SOUNDS).every(file=>/^[a-z]+\.ogg$/.test(file)));
});
