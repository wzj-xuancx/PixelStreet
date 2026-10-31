import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCommand} from '../packages/protocol';
test('pet and bag page intents have exact presentation-only identities',()=>{
 assert.deepEqual(parseCommand({type:'pet-toggle'}),{type:'pet-toggle'});
 assert.deepEqual(parseCommand({type:'inventory-toggle'}),{type:'inventory-toggle'});
 for(const page of ['items','pet'] as const)assert.deepEqual(parseCommand({type:'inventory-page',generation:9,page}),{type:'inventory-page',generation:9,page});
 assert.deepEqual(parseCommand({type:'expedition-link',generation:9,target:'pet'}),{type:'expedition-link',generation:9,target:'pet'});
});
test('page navigation rejects stale-shaped or gameplay-bearing requests',()=>{
 for(const value of [{type:'pet-toggle',generation:1},{type:'pet-toggle',action:{type:'pet-role'}},{type:'inventory-page',generation:0,page:'pet'},{type:'inventory-page',generation:'9',page:'pet'},{type:'inventory-page',generation:9,page:'crew'},{type:'inventory-page',generation:9,page:'pet',role:'expedition'},{type:'inventory-page',generation:9,page:['pet']},{type:'expedition-link',generation:9,target:'pet',crew:'slime'}])assert.throws(()=>parseCommand(value));
});
