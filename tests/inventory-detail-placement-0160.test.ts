import test from 'node:test';
import assert from 'node:assert/strict';
import {inventoryDetailPlacement} from '../apps/desktop/renderer/inventory-detail-placement';

test('minimum-size worn-pet detail leaves the actual press/release point and entire source unobstructed',()=>{
 const anchor={left:206.5,top:209,bottom:269},viewport={width:420,height:360},detail={width:310,height:304.390625};
 const p=inventoryDetailPlacement(anchor,viewport,detail),height=Math.min(detail.height,p.maxHeight);
 assert.equal(p.left,102);assert.equal(p.top,8);assert.equal(p.maxHeight,193);
 assert.ok(p.top+height<=anchor.top-8);assert.ok(239>p.top+height);assert.ok(p.top+height<=352);
 // A 44px action fits within this scrollport even with 16px padding and 2px borders.
 assert.ok(height-2*16-2*2>=44);
});

test('default-size details preserve full height below when possible and above near the lower edge',()=>{
 const viewport={width:760,height:650},detail={width:310,height:304};
 const below=inventoryDetailPlacement({left:42,top:90,bottom:150},viewport,detail);
 assert.equal(below.left,42);assert.equal(below.top,158);assert.ok(below.maxHeight>=detail.height);
 const above=inventoryDetailPlacement({left:620,top:560,bottom:620},viewport,detail);
 assert.equal(above.left,442);assert.equal(above.top,248);assert.ok(above.maxHeight>=detail.height);
});

test('varied viewport, source and content sizes always fit and never overlap the source vertical band',()=>{
 let cases=0;
 for(const width of [420,540,760,1000])for(const height of [360,420,650,900])for(const sourceHeight of [44,60,70,120])for(const fraction of [0,.1,.25,.5,.75,.9,1])for(const desiredHeight of [80,140,304.390625,1000])for(const left of [8,width/2,width-80]){
  const top=8+(height-16-sourceHeight)*fraction,anchor={left,top,bottom:top+sourceHeight};
  const detail={width:Math.min(310,width-16),height:Math.min(desiredHeight,height-16)},p=inventoryDetailPlacement(anchor,{width,height},detail),actualHeight=Math.min(detail.height,p.maxHeight);
  assert.ok(p.left>=8&&p.left+detail.width<=width-8+1e-9);assert.ok(p.top>=8-1e-9&&p.top+actualHeight<=height-8+1e-9);
  assert.ok(p.top+actualHeight<=anchor.top-8+1e-9||p.top>=anchor.bottom+8-1e-9);
  assert.ok(p.maxHeight>=0);assert.ok(actualHeight>0);cases++;
 }
 assert.equal(cases,5376);
});

test('partially clipped and scrolled-out sources still place the detail within the viewport',()=>{
 for(const top of [-100,-20,340,400]){
  const anchor={left:200,top,bottom:top+60},detail={width:310,height:304},p=inventoryDetailPlacement(anchor,{width:420,height:360},detail),height=Math.min(detail.height,p.maxHeight);
  assert.ok(p.top>=8&&p.top+height<=352);assert.ok(p.top+height<=anchor.top-8||p.top>=anchor.bottom+8);
 }
});
