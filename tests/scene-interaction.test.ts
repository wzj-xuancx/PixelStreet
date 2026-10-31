import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalSceneHit,foregroundHit,shopBoardContains,shopContains,streetLayout} from '../apps/desktop/renderer/scene-interaction';
import {pixelScale} from '../packages/protocol/geometry';

test('building, transparent corners, seam and sign form one scaled shop target',()=>{
  for(const dpr of [1,1.25,1.5,2])for(const height of [80,112,160,208]){
    const scale=pixelScale(dpr,Math.max(.5,Math.min(2,(height-4)/96))).dip;
    for(const center of [streetLayout.bakeryX,streetLayout.alchemyX]){
      // Transform a continuous path to DIP and back, including the old 8px gap.
      for(let logicalX=center-55;logicalX<center+130;logicalX+=.5){
        const dip=123+logicalX*scale;
        assert.equal(shopContains(center,(dip-123)/scale,-30),true,`${height}/${dpr}/${logicalX}`);
      }
      assert.equal(shopContains(center,center-55,-87),true);
      assert.equal(shopContains(center,center+131,-30),false);
      assert.equal(shopBoardContains(center,center+70,-30),true);
      assert.equal(shopBoardContains(center,center,-30),false);
    }
  }
});
test('interior and exterior share identity without swallowing actors or keeper',()=>{
  assert.equal(canonicalSceneHit('interior-bakery'),'shop-bakery');
  assert.equal(canonicalSceneHit('interior-alchemy'),'shop-alchemy');
  assert.equal(canonicalSceneHit('portal-2'),'adventure-portal');
  assert.equal(canonicalSceneHit('portal-2',true),'return-portal');
  for(const id of ['keeper','player-idle-0','slime-idle-0','enemy'])assert.equal(foregroundHit(id),true);
  assert.equal(foregroundHit('shop-bakery'),false);
  assert.equal(foregroundHit('ground'),false);
});
test('portal is left of the shops and each complete shop group has breathing room',()=>{
  assert.ok(streetLayout.portalX+104<streetLayout.bakeryX-56);
  assert.ok(streetLayout.bakeryX+130<streetLayout.alchemyX-56);
  assert.ok(streetLayout.alchemyX+130<streetLayout.width);
});
