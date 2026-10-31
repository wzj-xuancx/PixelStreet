import type { EnemyKind, Point } from './types';
import type { SpawnWavePlan } from './combat-state';
import { ENEMY_ATTACK_RULES } from './enemies';

export type EncounterStage = 1 | 2 | 3;
export type EncounterRoomKind = 'combat' | 'elite' | 'boss';

export interface EncounterPlanInput {
  seed: number;
  roomId: string;
  width: number;
  height: number;
  stage: EncounterStage;
  kind: EncounterRoomKind;
  waves: number;
  avoidSignatures?: string[];
}

export interface EncounterPlanResult {
  plans: SpawnWavePlan[];
  aliveCap: number;
}

export interface EncounterStageRange {
  minCount: number;
  maxCount: number;
  minBudget: number;
  maxBudget: number;
  aliveCap: number;
}

export const ENCOUNTER_STAGE_RANGES: Readonly<Record<EncounterStage, Readonly<EncounterStageRange>>> = {
  1: { minCount: 5, maxCount: 8, minBudget: 5, maxBudget: 10, aliveCap: 8 },
  2: { minCount: 8, maxCount: 13, minBudget: 12, maxBudget: 20, aliveCap: 12 },
  3: { minCount: 11, maxCount: 18, minBudget: 20, maxBudget: 30, aliveCap: 16 },
};

const ROOM_AREA_REFERENCE = 456 * 336;
const FALLBACK_ATTEMPTS = 48;
const BASIC_KINDS: readonly EnemyKind[] = ['chaser', 'shooter', 'charger', 'guard', 'priest'];
const cost = (kind: EnemyKind): number => ENEMY_ATTACK_RULES[kind].threat;

export function threatCost(kind: EnemyKind): number { return cost(kind); }

export function encounterStageForCompletedRooms(completedOrdinaryRooms: number): EncounterStage {
  if (!Number.isInteger(completedOrdinaryRooms) || completedOrdinaryRooms < 0) throw new Error('普通战斗房进度必须为非负整数');
  if (completedOrdinaryRooms < 2) return 1;
  if (completedOrdinaryRooms < 5) return 2;
  return 3;
}

function makeRandom(seed: number): () => number {
  let state = seed >>> 0 || 0x9e3779b9;
  return () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
}

function derive(seed: number, label: string): number {
  let value = (seed ^ 0x811c9dc5) >>> 0;
  for (let i = 0; i < label.length; i++) value = Math.imul(value ^ label.charCodeAt(i), 16777619) >>> 0;
  return value || 0x9e3779b9;
}

function hash(text: string): string {
  let value = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619) >>> 0;
  return value.toString(16).padStart(8, '0');
}

function areaAdjustedRange(stage: EncounterStage, width: number, height: number, elite: boolean): EncounterStageRange {
  const base = ENCOUNTER_STAGE_RANGES[stage];
  const scale = Math.max(.6, Math.min(1, Math.sqrt(Math.max(1, width * height) / ROOM_AREA_REFERENCE)));
  const minCount = Math.max(3, Math.floor(base.minCount * scale) + (elite ? 3 : 0));
  const maxCount = Math.max(minCount, Math.floor(base.maxCount * scale) + (elite ? 3 : 0));
  const minBudget = elite ? base.maxBudget + 1 : Math.max(minCount, Math.floor(base.minBudget * scale));
  const maxBudget = elite ? base.maxBudget + 8 : Math.max(minBudget, Math.floor(base.maxBudget * scale));
  return { minCount, maxCount, minBudget, maxBudget, aliveCap: base.aliveCap };
}

function rolesFor(stage: EncounterStage): readonly EnemyKind[] {
  return stage === 1 ? ['shooter'] : stage === 2 ? ['shooter', 'charger', 'guard'] : BASIC_KINDS;
}

function roleWeight(stage: EncounterStage, kind: EnemyKind): number {
  if (kind === 'shooter') return stage === 3 ? 3 : 4;
  if (kind === 'charger') return stage === 1 ? 0 : 3;
  if (kind === 'guard') return stage === 1 ? 0 : 3;
  if (kind === 'priest') return stage === 3 ? 1 : 0;
  return 0;
}

function pickWeighted<T extends string>(values: readonly T[], weight: (value: T) => number, random: () => number): T {
  const total = values.reduce((sum, value) => sum + weight(value), 0);
  let choice = random() * total;
  for (const value of values) { choice -= weight(value); if (choice < 0) return value; }
  return values.at(-1)!;
}

function waveGroup(random: () => number, stage: EncounterStage, range: EncounterStageRange): EnemyKind[] {
  const count = range.minCount + Math.floor(random() * (range.maxCount - range.minCount + 1));
  const targetBudget = Math.max(range.minBudget, count + 1) + Math.floor(random() * Math.max(1, range.maxBudget - Math.max(range.minBudget, count + 1) + 1));
  const allowed = rolesFor(stage), elite = range.minBudget > ENCOUNTER_STAGE_RANGES[stage].maxBudget;
  const maxSpecials = Math.min(count - 1, elite ? Math.ceil(count * .72) : Math.floor((count - 1) / 2));
  const group: EnemyKind[] = new Array(count).fill('chaser');
  let threat = count;
  // Every regular wave introduces a visible ranged decision while keeping chasers as its majority.
  group[0] = 'shooter'; threat++;
  let specialCount = 1;
  const upgrade = (ceiling: number, forceHighestThreat = false): boolean => {
    if (specialCount >= maxSpecials || threat >= ceiling) return false;
    const indices = group.map((kind, index) => kind === 'chaser' ? index : -1).filter(index => index >= 0);
    if (!indices.length) return false;
    const choices = allowed.filter(kind => kind !== 'priest' || !group.includes('priest')).filter(kind => cost(kind) > 1 && threat + cost(kind) - 1 <= range.maxBudget);
    if (!choices.length) return false;
    const kind = forceHighestThreat ? [...choices].sort((a,b)=>cost(b)-cost(a)||a.localeCompare(b))[0] : pickWeighted(choices, value => roleWeight(stage, value), random);
    const index = indices[Math.floor(random() * indices.length)];
    group[index] = kind; threat += cost(kind) - 1; specialCount++;
    return true;
  };
  while (threat < range.minBudget && upgrade(range.maxBudget,true)) { /* Fill the minimum legal threat before optional variation. */ }
  for (let guard = 0; guard < count && threat < targetBudget && random() < .62; guard++) if (!upgrade(targetBudget)) break;
  return group;
}

function fallbackGroup(stage: EncounterStage, range: EncounterStageRange): EnemyKind[] {
  const count = range.minCount, group = new Array<EnemyKind>(count).fill('chaser');
  const allowed = rolesFor(stage), elite = range.minBudget > ENCOUNTER_STAGE_RANGES[stage].maxBudget;
  const maxSpecials = Math.min(count - 1, elite ? Math.ceil(count * .72) : Math.floor((count - 1) / 2));
  group[0] = 'shooter';
  while (group.filter(kind => kind !== 'chaser').length < maxSpecials) {
    const threat = group.reduce((sum, kind) => sum + cost(kind), 0);
    if (threat >= range.minBudget) break;
    const role = allowed.filter(kind => kind !== 'priest' || !group.includes('priest')).sort((a, b) => cost(b) - cost(a))[0];
    const slot = group.findIndex(kind => kind === 'chaser');
    if (!role || slot < 0 || threat + cost(role) - 1 > range.maxBudget) break;
    group[slot] = role;
  }
  return group;
}

function themeFor(group: readonly EnemyKind[]): SpawnWavePlan['theme'] {
  if (group.includes('priest')) return 'ritual';
  if (group.includes('guard')) return 'shield';
  if (group.includes('charger')) return 'charge';
  if (group.includes('shooter')) return 'ranged';
  return 'swarm';
}

export function previewSpawnLayout(seed: number, width: number, height: number, count: number): Point[] {
  const random = makeRandom(seed), centerX = width / 2, centerY = height / 2;
  const radius = Math.max(36, Math.min(width, height) * .32);
  return Array.from({ length: count }, (_, index) => {
    const angle = Math.PI * 2 * index / Math.max(1, count) + (random() - .5) * .38;
    const distance = radius * (.82 + random() * .34);
    return { x: Math.round(Math.max(32, Math.min(width - 32, centerX + Math.cos(angle) * distance))), y: Math.round(Math.max(32, Math.min(height - 32, centerY + Math.sin(angle) * distance))) };
  });
}

export function spawnPointCandidates(seed: number, width: number, height: number, count: number, index: number, retry: number): Point[] {
  const preferred = previewSpawnLayout(seed, width, height, count)[index];
  const random = makeRandom(derive(seed, `ticket-${index}-retry-${retry}`));
  const alternatives = Array.from({ length: 96 }, () => ({ x: Math.round(32 + random() * Math.max(1, width - 64)), y: Math.round(32 + random() * Math.max(1, height - 64)) }));
  return preferred ? [preferred, ...alternatives] : alternatives;
}

export function spawnFallbackPoints(seed: number, width: number, height: number, cell = 24): Point[] {
  const points: Point[] = [];
  for (let y = 36; y <= height - 36; y += cell) for (let x = 36; x <= width - 36; x += cell) points.push({ x, y });
  const offset = derive(seed, `fallback-grid`) % Math.max(1, points.length);
  return [...points.slice(offset), ...points.slice(0, offset)];
}

function groupSignature(group: readonly EnemyKind[], points: readonly Point[], width: number, height: number): string {
  return hash(group.map((kind, index) => `${kind}@${(points[index].x / width).toFixed(3)},${(points[index].y / height).toFixed(3)}`).join('|'));
}

export function encounterLayoutSignature(plan: SpawnWavePlan): string {
  return /-layout-([a-f0-9]{8})$/.exec(plan.id)?.[1] ?? '';
}

export function spawnPlanSeed(plan: SpawnWavePlan): number {
  const value = /-seed([a-f0-9]{1,8})-layout-[a-f0-9]{8}$/.exec(plan.id)?.[1];
  return value ? Number.parseInt(value, 16) >>> 0 || 0x9e3779b9 : derive(1, plan.id);
}

function regularWave(input: EncounterPlanInput, wave: number, avoid: Set<string>, range: EncounterStageRange): SpawnWavePlan {
  const root = derive(input.seed, `${input.roomId}-stage-${input.stage}-wave-${wave}`);
  let chosenGroup: EnemyKind[] | undefined, chosenSeed = root, signature = '';
  for (let attempt = 0; attempt < FALLBACK_ATTEMPTS; attempt++) {
    const seed = derive(root, `attempt-${attempt}`), group = waveGroup(makeRandom(seed), input.stage, range);
    const points = previewSpawnLayout(seed, input.width, input.height, group.length), candidate = groupSignature(group, points, input.width, input.height);
    if (!avoid.has(candidate)) { chosenGroup = group; chosenSeed = seed; signature = candidate; break; }
  }
  if (!chosenGroup) {
    chosenGroup = fallbackGroup(input.stage, range);
    for (let attempt = 0; attempt < 256; attempt++) {
      const seed = derive(root, `fallback-${attempt}`), points = previewSpawnLayout(seed, input.width, input.height, chosenGroup.length), candidate = groupSignature(chosenGroup, points, input.width, input.height);
      if (!avoid.has(candidate)) { chosenSeed = seed; signature = candidate; break; }
    }
  }
  const enemies = chosenGroup!.map((kind, index) => ({ id: `${input.roomId}-w${wave}-e${index + 1}`, kind }));
  const batches = Array.from({ length: Math.ceil(enemies.length / range.aliveCap) }, (_, index) => ({ id: `${input.roomId}-w${wave}-b${index + 1}`, enemies: enemies.slice(index * range.aliveCap, (index + 1) * range.aliveCap) }));
  return { id: `${input.roomId}-s${input.stage}-w${wave}-seed${chosenSeed.toString(16).padStart(8, '0')}-layout-${signature}`, theme: themeFor(chosenGroup!), budget: enemies.reduce((sum, enemy) => sum + cost(enemy.kind), 0), batches };
}

export function generateEncounterPlans(input: EncounterPlanInput): EncounterPlanResult {
  if (!Number.isInteger(input.seed) || input.seed < 0 || input.seed > 0xffffffff || !/^[a-zA-Z0-9_-]{1,34}$/.test(input.roomId) || !Number.isFinite(input.width) || !Number.isFinite(input.height) || input.width < 240 || input.height < 240 || ![1, 2, 3].includes(input.stage) || !Number.isInteger(input.waves) || input.waves < 1 || input.waves > 3) throw new Error('遭遇计划输入超出边界');
  if (input.kind === 'boss') {
    if (input.waves !== 1) throw new Error('首领房必须只有一个计划波次');
    const id = `${input.roomId}-boss-seed${derive(input.seed, input.roomId).toString(16).padStart(8, '0')}`;
    return { aliveCap: 1, plans: [{ id, theme: 'boss', budget: cost('boss'), batches: [{ id: `${input.roomId}-boss-batch`, enemies: [{ id: `${input.roomId}-boss-enemy`, kind: 'boss' }] }] }] };
  }
  const range = areaAdjustedRange(input.stage, input.width, input.height, input.kind === 'elite');
  const avoid = new Set(input.avoidSignatures ?? []), plans: SpawnWavePlan[] = [];
  for (let wave = 1; wave <= input.waves; wave++) {
    const plan = regularWave(input, wave, avoid, range);
    avoid.add(encounterLayoutSignature(plan));
    plans.push(plan);
  }
  return { plans, aliveCap: range.aliveCap };
}
