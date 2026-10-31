import test from 'node:test';
import assert from 'node:assert/strict';
import {initialProfile, parseProfile, type Profile} from '../packages/solo-core';
import {initialBonds, type Buddy} from '../packages/solo-core/bonds';

function fixture(): Profile {
  const p = initialProfile(700_070);
  p.leisure.bonds = initialBonds();
  return p;
}

test('profile parser rejects voyage progress on an unowned companion', () => {
  const p = fixture();
  const unowned: Buddy = 'fox';
  assert.equal(p.leisure.companions[unowned], undefined);
  p.leisure.bonds!.progress[unowned].voyages = 1;
  assert.throws(() => parseProfile(p));
});

test('profile parser rejects a training rank earned before its completed-voyage threshold', () => {
  const p = fixture();
  p.leisure.companions.slime = 2;
  p.leisure.bonds!.progress.slime = {path: 'scout', rank: 1, voyages: 0, stories: 0};
  assert.throws(() => parseProfile(p));
});
