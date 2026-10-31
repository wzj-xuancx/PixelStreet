import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
test('shipping atlas and samples match provenance; every frame is bounded and animations share anchors', () => {
  const folder = path.resolve('assets'); const atlas = JSON.parse(fs.readFileSync(path.join(folder, 'atlas.json'), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'asset_manifest.json'), 'utf8'));
  assert.equal(atlas.tileSize, 16); assert.equal(atlas.image, 'atlas.png');
  for (const [name, hash] of Object.entries(manifest.sha256)) assert.equal(createHash('sha256').update(fs.readFileSync(path.join(folder, name))).digest('hex'), hash);
  const image = fs.readFileSync(path.join(folder, atlas.image)); const width = image.readUInt32BE(16), height = image.readUInt32BE(20);
  for (const frame of Object.values(atlas.frames) as any[]) {
    assert.ok([frame.x, frame.y, frame.w, frame.h, ...frame.anchor].every(Number.isInteger));
    assert.ok(frame.x >= 0 && frame.y >= 0 && frame.x + frame.w <= width && frame.y + frame.h <= height);
    assert.ok(frame.anchor[0] >= 0 && frame.anchor[0] <= frame.w && frame.anchor[1] >= 0 && frame.anchor[1] <= frame.h);
  }
  for (const frames of Object.values(atlas.animations) as string[][]) {
    const anchor = atlas.frames[frames[0]].anchor;
    for (const id of frames) { assert.ok(atlas.frames[id]); assert.deepEqual(atlas.frames[id].anchor, anchor); }
  }
});
