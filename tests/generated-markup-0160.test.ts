import test from 'node:test';
import assert from 'node:assert/strict';
import {setGeneratedMarkup} from '../apps/desktop/renderer/generated-markup';
// Models a browser-normalized serialization and replacement of child identity.
// Actual renderer node identity is independently retested in hidden native QA.
function normalizedNode(){let serialized='',child={},writes=0;return {node:{get innerHTML(){return serialized;},set innerHTML(v:string){serialized=v.replace('/>','></image>');child={};writes++;}} as HTMLElement,get child(){return child;},get writes(){return writes;}};}
const svg='<svg><image href="asset.png"/></svg>';
test('unchanged generated SVG preserves children despite normalized DOM serialization',()=>{
 const a=normalizedNode();setGeneratedMarkup(a.node,svg);const child=a.child;assert.notEqual(a.node.innerHTML,svg);
 for(let n=0;n<5;n++)setGeneratedMarkup(a.node,svg);assert.equal(a.child,child);assert.equal(a.writes,1);
 setGeneratedMarkup(a.node,'<span>无装备快照</span>');assert.notEqual(a.child,child);assert.equal(a.writes,2);
 setGeneratedMarkup(a.node,'<span>无装备快照</span>');assert.equal(a.writes,2);setGeneratedMarkup(a.node,svg);assert.equal(a.writes,3);
});
test('new popup nodes with the same ID and generated input are drawn independently',()=>{
 const first=normalizedNode(),reopened=normalizedNode();first.node.id=reopened.node.id='eGearCamp';
 setGeneratedMarkup(first.node,svg);setGeneratedMarkup(reopened.node,svg);assert.equal(first.writes,1);assert.equal(reopened.writes,1);assert.ok(reopened.node.innerHTML.includes('<image'));
 const empty=normalizedNode();setGeneratedMarkup(empty.node,'');assert.equal(empty.writes,1);setGeneratedMarkup(empty.node,svg);assert.equal(empty.writes,2);
});
