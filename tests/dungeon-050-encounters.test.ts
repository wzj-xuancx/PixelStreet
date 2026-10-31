import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../packages/dungeon-core';

const generate = (core as any).generateEncounterPlans as (input: {
  seed: number; roomId: string; width: number; height: number; stage: 1 | 2 | 3;
  kind: 'combat' | 'elite' | 'boss'; waves: number; avoidSignatures?: string[];
}) => { plans: any[]; aliveCap: number };
const THREAT: Record<string, number> = { chaser: 1, shooter: 2, charger: 3, guard: 3, priest: 4, boss: 40 };
const STAGES = [
  { stage: 1 as const, min: 5, max: 8, low: 5, high: 10, cap: 8 },
  { stage: 2 as const, min: 8, max: 13, low: 12, high: 20, cap: 12 },
  { stage: 3 as const, min: 11, max: 18, low: 20, high: 30, cap: 16 },
];

test('050 normal encounter plans are deterministic and honor per-wave count, threat, cap and priest limits across 256 seeds per stage', () => {
  assert.equal(typeof generate, 'function');
  for (const { stage, min, max, low, high, cap } of STAGES) {
    for (let seed = 0; seed < 256; seed++) {
      const input = { seed, roomId: `room-${stage}-${seed}`, width: 720, height: 528, stage, kind: 'combat' as const, waves: 2 };
      const first = generate(input), second = generate(input);
      assert.deepEqual(first, second, `stage ${stage}, seed ${seed} was not stable`);
      assert.equal(first.aliveCap, cap);
      assert.equal(first.plans.length, 2);
      for (const plan of first.plans) {
        const enemies = plan.batches.flatMap((batch: any) => batch.enemies);
        const threat = enemies.reduce((sum: number, enemy: any) => sum + THREAT[enemy.kind], 0);
        assert.ok(enemies.length >= min && enemies.length <= max, `stage ${stage}, seed ${seed}: ${enemies.length}`);
        assert.ok(threat >= low && threat <= high, `stage ${stage}, seed ${seed}: threat ${threat}`);
        assert.equal(plan.budget, threat, 'stored budget is the sum of the selected roles');
        assert.ok(enemies.filter((enemy: any) => enemy.kind === 'priest').length <= 1);
        assert.ok(plan.batches.every((batch: any) => batch.enemies.length <= cap));
        assert.ok(plan.batches.length > 0);
      }
      const signatures = first.plans.map((plan: any) => (core as any).encounterLayoutSignature?.(plan));
      assert.ok(signatures.every((value: unknown) => typeof value === 'string' && value.length > 0));
      assert.notEqual(signatures[0], signatures[1], `adjacent wave repeated its group and spawn layout at stage ${stage}, seed ${seed}`);
    }
  }
});

test('050 elite and boss plans use their own budgets rather than ordinary stage ranges', () => {
  assert.equal(typeof generate, 'function');
  const elite = generate({ seed: 19, roomId: 'elite-19', width: 720, height: 528, stage: 2, kind: 'elite', waves: 2 });
  assert.ok(elite.plans.every((plan: any) => plan.budget > 20));
  const boss = generate({ seed: 19, roomId: 'boss-19', width: 600, height: 432, stage: 3, kind: 'boss', waves: 1 });
  assert.equal(boss.aliveCap, 1);
  assert.equal(boss.plans.length, 1);
  assert.equal(boss.plans[0].theme, 'boss');
  assert.deepEqual(boss.plans[0].batches.flatMap((batch: any) => batch.enemies).map((enemy: any) => enemy.kind), ['boss']);
  assert.ok(boss.plans[0].budget > 30);
});
