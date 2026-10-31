import {test} from 'node:test';
import assert from 'node:assert/strict';
import {FixedClock,WorldCamera,movement,interpolate,FrameStats} from '../packages/dungeon-core/foundation';
test('elapsed-time simulation produces same distance at 60,120 and irregular presentation',()=>{
 const run=(deltas:number[])=>{const c=new FixedClock();let x=0,t=0,n=0;c.advance(0,()=>{});while(t<10000-1e-7){t=Math.min(10000,t+deltas[n++%deltas.length]);c.advance(t,dt=>x+=movement(1,0,180,dt).x);}return x;};
 for(const ds of [[1000/60],[1000/120],[7,19,12,26]])assert.ok(Math.abs(run(ds)-1800)<1e-5);
 assert.ok(Math.abs(Math.hypot(...Object.values(movement(1,1,180,1000)))-180)<1e-6);
});
test('pause/reset discards stale input time; stalls have bounded catchup',()=>{const c=new FixedClock();let n=0;c.advance(0,()=>n++);c.advance(10000,()=>n++);assert.equal(n,6);assert.equal(c.droppedMs,9900);c.reset(20000);c.advance(20000,()=>n++);assert.equal(n,6);});
test('world-only zoom halves visible tile count and preserves aim inverse at DPR-independent coordinates',()=>{const c=new WorldCamera();c.resize(960,540);c.x=521;c.y=327;for(const z of [.75,1,1.5,2]){c.setZoom(z);const p={x:716,y:81},back=c.screenToWorld(c.worldToScreen(p));assert.ok(Math.abs(back.x-p.x)<1e-8&&Math.abs(back.y-p.y)<1e-8);}c.setZoom(1);const a=c.visibleWorld.width/24;c.setZoom(2);assert.equal(a/2,c.visibleWorld.width/24);});
test('interpolation clamps alpha rather than extrapolating past the latest position',()=>{assert.deepEqual(interpolate({x:0,y:0},{x:10,y:20},2),{x:10,y:20});assert.deepEqual(interpolate({x:0,y:0},{x:10,y:20},.5),{x:5,y:10});});
test('frame report derives measured cadence rather than target',()=>{const s=new FrameStats();for(let i=0;i<=120;i++)s.record(i*1000/60,.3);assert.ok(Math.abs(s.summary().fps-60)<.01);assert.equal(s.summary().samples,120);});
test('frame budget counters use exact 120Hz/60Hz boundaries with only floating tolerance',()=>{const stats=new FrameStats();let at=0;stats.record(at,0);for(const dt of [1000/120,8.5,1000/60,16.8]){at+=dt;stats.record(at,.1);}assert.equal(stats.summary().over120HzBudget,3);assert.equal(stats.summary().over60HzBudget,1);});
