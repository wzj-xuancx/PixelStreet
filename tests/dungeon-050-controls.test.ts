import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_BINDINGS,canonicalCode,rebindControl,controlForCode,defaultDungeonPreferences,parseDungeonPreferences,loadDungeonPreferences,saveDungeonPreferences,movementFromHeld,DUNGEON_PREFERENCE_KEY} from '../apps/desktop/renderer/dungeon-controls';

test('local control remapping preserves the old binding on conflict or system-reserved keys',()=>{
 const initial={...DEFAULT_BINDINGS};
 assert.deepEqual(rebindControl(initial,'special','KeyW'),{ok:false,reason:'conflict',conflict:'up'});
 assert.deepEqual(rebindControl(initial,'special','Escape'),{ok:false,reason:'reserved'});
 assert.deepEqual(rebindControl(initial,'special','Digit1'),{ok:false,reason:'reserved'});
 assert.deepEqual(rebindControl(initial,'special','F23'),{ok:false,reason:'unsupported'});
 assert.deepEqual(initial,DEFAULT_BINDINGS);
 const bound=rebindControl(initial,'special','Space');assert.ok(bound.ok);
 assert.equal(controlForCode(bound.bindings,'KeyQ'),null);assert.equal(controlForCode(bound.bindings,'Space'),'special');
});
test('right Shift aliases left Shift and mouse attack/secondary roll do not collide silently',()=>{
 assert.equal(canonicalCode('ShiftRight'),'ShiftLeft');assert.equal(controlForCode({...DEFAULT_BINDINGS},'ShiftRight'),'dash');
 assert.deepEqual(rebindControl({...DEFAULT_BINDINGS},'attack','Mouse2'),{ok:false,reason:'conflict',conflict:'dashAlt'});
 const duplicate=defaultDungeonPreferences();duplicate.bindings.special='ShiftRight';assert.equal(parseDungeonPreferences(duplicate),null);
});
test('preferences survive storage roundtrip; malformed and oversized data safely use independent defaults',()=>{
 const store=new Map<string,string>();const storage={getItem:(k:string)=>store.get(k)??null,setItem:(k:string,v:string)=>{store.set(k,v);}};
 const prefs=defaultDungeonPreferences();prefs.showNumbers=true;prefs.reducedMotion=true;const rebound=rebindControl(prefs.bindings,'special','Space');assert.ok(rebound.ok);prefs.bindings=rebound.bindings;
 assert.ok(saveDungeonPreferences(storage,prefs));assert.deepEqual(loadDungeonPreferences(storage),prefs);
 store.set(DUNGEON_PREFERENCE_KEY,'{"version":1,"bindings":null}');assert.deepEqual(loadDungeonPreferences(storage),defaultDungeonPreferences());
 store.set(DUNGEON_PREFERENCE_KEY,'x'.repeat(9000));assert.deepEqual(loadDungeonPreferences(storage),defaultDungeonPreferences());
 assert.equal(parseDungeonPreferences({...prefs,unknown:true}),null);assert.equal(parseDungeonPreferences({...prefs,showDebug:'true'}),null);
 assert.equal(saveDungeonPreferences({getItem:()=>null,setItem:()=>{throw Error('quota');}},prefs),false);
 const a=defaultDungeonPreferences(),b=defaultDungeonPreferences();a.bindings.attack='KeyJ';assert.equal(b.bindings.attack,'Mouse0');
});
test('movement resolves remapped directions and opposing input cancels without changing source state',()=>{
 const bindings={...DEFAULT_BINDINGS,up:'ArrowUp',down:'ArrowDown',left:'ArrowLeft',right:'ArrowRight'};
 const held=new Set(['ArrowUp','ArrowRight']);assert.deepEqual(movementFromHeld(bindings,held),{x:1,y:-1});
 held.add('ArrowDown');assert.deepEqual(movementFromHeld(bindings,held),{x:1,y:0});assert.equal(held.size,3);
});
