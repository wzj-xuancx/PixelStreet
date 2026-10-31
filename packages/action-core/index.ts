/** Pure, deterministic simulation for the three-stage active expedition. */

export type Weapon = 'wand' | 'bow' | 'scatter';
export type ActionPhase = 'playing' | 'upgrade' | 'won' | 'lost';
export type EnemyKind = 'chaser' | 'shooter' | 'charger' | 'boss';
export type UpgradeId = 'sharp-edge' | 'heartwood' | 'nimble' | 'quick-hands' | 'long-reach';

export interface Point { x: number; y: number }

export interface PlayerState {
  id: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  targetX: number;
  targetY: number;
  path: Point[];
  pathRefreshAt: number;
  weapon: Weapon;
  damage: number;
  speed: number;
  attackRate: number;
  rangeBonus: number;
  moveX: number;
  moveY: number;
  aimX: number;
  aimY: number;
  firing: boolean;
  attackReady: number;
  dashReady: number;
  skillReady: number;
  shieldReady: number;
  shield: number;
  shieldUntil: number;
  invulnerableUntil: number;
  alive: boolean;
  lockedEnemy: string | null;
}

export interface EnemyState {
  id: string;
  kind: EnemyKind;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  radius: number;
  damage: number;
  speed: number;
  attackReady: number;
  attackIndex: number;
  targetX: number;
  targetY: number;
  path: Point[];
  pathReady: number;
  windupUntil: number;
  chargeTargetX: number;
  chargeTargetY: number;
  chargeTargetId: string;
  bossPattern: 'none' | 'fan' | 'barrage' | 'charge';
  bossPhase: 1 | 2 | 3;
}

export interface ProjectileState {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  owner: string;
  faction: 'players' | 'enemies';
  damage: number;
  radius: number;
  ttl: number;
  style: 'wand' | 'arrow' | 'pellet' | 'enemy' | 'boss';
}

export interface Obstacle { x: number; y: number; width: number; height: number }

export interface ActionEffect {
  id: string;
  kind: 'hit' | 'dash' | 'nova' | 'ward' | 'charge' | 'boss-phase' | 'death' | 'stage-clear';
  x: number;
  y: number;
  radius: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  expiresAt: number;
}

export interface ActionTelegraph {
  id: string;
  kind: 'charge' | 'boss-fan' | 'boss-barrage';
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  radius: number;
  expiresAt: number;
}

export interface ActionState {
  version: 1;
  runId: string;
  seed: number;
  rng: number;
  phase: ActionPhase;
  paused: boolean;
  stage: 0 | 1 | 2;
  wave: number;
  width: 960;
  height: 540;
  tick: number;
  elapsedMs: number;
  carryMs: number;
  players: PlayerState[];
  enemies: EnemyState[];
  projectiles: ProjectileState[];
  obstacles: Obstacle[];
  effects: ActionEffect[];
  telegraphs: ActionTelegraph[];
  kills: number;
  reward: { coins: number; xp: number };
  notice: string;
  upgradeChoices: UpgradeId[];
  enemySequence: number;
  projectileSequence: number;
  effectSequence: number;
}

export type ActionInput =
  | { type: 'control'; moveX: number; moveY: number; aimX: number; aimY: number; firing: boolean }
  | { type: 'move'; x: number; y: number }
  | { type: 'lock'; enemyId: string }
  | { type: 'dash'; x: number; y: number }
  | { type: 'skill'; skill: 'nova' | 'ward' }
  | { type: 'upgrade'; choice: string }
  | { type: 'pause'; paused: boolean };

export interface ActionLevel {
  name: string;
  subtitle: string;
  obstacles: readonly Obstacle[];
  waves: readonly (readonly EnemyKind[])[];
}

export const ACTION_STEP_MS = 50;
export const ACTION_WIDTH = 960;
export const ACTION_HEIGHT = 540;
export const ACTION_MAX_PLAYERS = 4;
export const ACTION_MAX_ENEMIES = 24;
export const ACTION_MAX_PROJECTILES = 128;

const GRID = 24;
const PLAYER_RADIUS = 10;
const PLAYER_IDS = /^[a-zA-Z0-9_-]{1,32}$/;
const UPGRADE_IDS: readonly UpgradeId[] = ['sharp-edge', 'heartwood', 'nimble', 'quick-hands', 'long-reach'];

export const ACTION_LEVELS: readonly ActionLevel[] = [
  {
    name: '荒径', subtitle: '风蚀石堆间的短路包抄',
    obstacles: [
      { x: 355, y: 104, width: 84, height: 62 },
      { x: 500, y: 312, width: 110, height: 76 },
      { x: 704, y: 88, width: 68, height: 96 },
    ],
    waves: [
      ['chaser', 'chaser'],
      ['chaser', 'shooter', 'chaser'],
      ['charger', 'chaser', 'shooter', 'chaser'],
    ],
  },
  {
    name: '晶洞', subtitle: '狭道会遮断箭矢与魔弹',
    obstacles: [
      { x: 258, y: 54, width: 72, height: 166 },
      { x: 432, y: 245, width: 110, height: 236 },
      { x: 636, y: 48, width: 88, height: 170 },
      { x: 800, y: 328, width: 70, height: 112 },
    ],
    waves: [
      ['chaser', 'shooter', 'chaser'],
      ['shooter', 'shooter', 'chaser', 'chaser'],
      ['charger', 'charger', 'shooter', 'chaser'],
    ],
  },
  {
    name: '遗迹首领', subtitle: '护卫、扇形弹幕与阶段冲锋',
    obstacles: [
      { x: 300, y: 92, width: 64, height: 150 },
      { x: 300, y: 298, width: 64, height: 150 },
      { x: 570, y: 60, width: 58, height: 128 },
      { x: 570, y: 352, width: 58, height: 128 },
    ],
    waves: [
      ['chaser', 'chaser', 'shooter'],
      ['charger', 'charger', 'shooter', 'shooter'],
      ['boss', 'chaser', 'shooter'],
    ],
  },
];

export const ACTION_UPGRADES: Record<UpgradeId, { name: string; detail: string }> = {
  'sharp-edge': { name: '锋刃符文', detail: '全队伤害 +4' },
  heartwood: { name: '心木护符', detail: '全队生命上限 +22，存活者恢复22生命；倒地队友仅增上限，下一关以50%生命复活。' },
  nimble: { name: '疾行步法', detail: '全队移动速度 +18' },
  'quick-hands': { name: '迅捷引导', detail: '全队攻击速度 +15%' },
  'long-reach': { name: '远星刻印', detail: '全队攻击距离 +35' },
};

const WEAPON_STATS: Record<Weapon, { damage: number; cooldown: number; range: number; projectileSpeed: number }> = {
  wand: { damage: 16, cooldown: 550, range: 290, projectileSpeed: 300 },
  bow: { damage: 24, cooldown: 950, range: 410, projectileSpeed: 520 },
  scatter: { damage: 8, cooldown: 850, range: 190, projectileSpeed: 350 },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function shape(value: unknown, keys: string): asserts value is Record<string, unknown> {
  if (!isRecord(value) || Object.keys(value).sort().join(',') !== keys.split(' ').sort().join(',')) {
    throw new Error('战斗状态或指令字段不匹配');
  }
}

function numberRange(value: unknown, max: number, min = 0, name = '数值'): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${name}超出范围`);
}

function integerRange(value: unknown, max: number, min = 0, name = '数值'): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${name}超出范围`);
}

function oneOf<T extends string>(value: unknown, values: readonly T[], name: string): asserts value is T {
  if (typeof value !== 'string' || !values.includes(value as T)) throw new Error(`${name}无效`);
}

function sameObstacles(actual: unknown, expected: readonly Obstacle[]): boolean {
  if (!Array.isArray(actual) || actual.length !== expected.length) return false;
  return actual.every((item, index) => {
    if (!isRecord(item) || Object.keys(item).sort().join(',') !== 'height,width,x,y') return false;
    const target = expected[index];
    return item.x === target.x && item.y === target.y && item.width === target.width && item.height === target.height;
  });
}

function validatePoint(raw: unknown, maxX = ACTION_WIDTH, maxY = ACTION_HEIGHT): asserts raw is Point {
  shape(raw, 'x y');
  numberRange(raw.x, maxX, 0, '横坐标');
  numberRange(raw.y, maxY, 0, '纵坐标');
}

export function parseActionInput(raw: unknown): ActionInput {
  if (!isRecord(raw)) throw new Error('战斗指令无效');
  if (raw.type === 'control') {
    shape(raw, 'type moveX moveY aimX aimY firing');
    numberRange(raw.moveX, 1, -1, '横向输入');
    numberRange(raw.moveY, 1, -1, '纵向输入');
    numberRange(raw.aimX, ACTION_WIDTH, 0, '瞄准横坐标');
    numberRange(raw.aimY, ACTION_HEIGHT, 0, '瞄准纵坐标');
    if (typeof raw.firing !== 'boolean') throw new Error('射击状态无效');
    return { type: 'control', moveX: raw.moveX, moveY: raw.moveY, aimX: raw.aimX, aimY: raw.aimY, firing: raw.firing };
  }
  if (raw.type === 'move' || raw.type === 'dash') {
    shape(raw, 'type x y');
    numberRange(raw.x, ACTION_WIDTH, 0, '横坐标');
    numberRange(raw.y, ACTION_HEIGHT, 0, '纵坐标');
    return { type: raw.type, x: raw.x, y: raw.y };
  }
  if (raw.type === 'lock') {
    shape(raw, 'type enemyId');
    if (typeof raw.enemyId !== 'string' || raw.enemyId.length > 48 || !/^enemy-[0-9]+$/.test(raw.enemyId)) throw new Error('锁定目标无效');
    return { type: 'lock', enemyId: raw.enemyId };
  }
  if (raw.type === 'skill') {
    shape(raw, 'type skill');
    oneOf(raw.skill, ['nova', 'ward'], '技能');
    return { type: 'skill', skill: raw.skill };
  }
  if (raw.type === 'upgrade') {
    shape(raw, 'type choice');
    oneOf(raw.choice, UPGRADE_IDS, '升级选项');
    return { type: 'upgrade', choice: raw.choice };
  }
  if (raw.type === 'pause') {
    shape(raw, 'type paused');
    if (typeof raw.paused !== 'boolean') throw new Error('暂停状态无效');
    return { type: 'pause', paused: raw.paused };
  }
  throw new Error('未知战斗指令');
}

function validatePlayer(raw: unknown): asserts raw is PlayerState {
  const legacyShape = 'id x y hp maxHp targetX targetY path pathRefreshAt weapon damage speed attackRate rangeBonus attackReady dashReady skillReady shieldReady shield shieldUntil invulnerableUntil alive lockedEnemy';
  const controlShape = `${legacyShape} moveX moveY aimX aimY firing`;
  if (isRecord(raw) && Object.keys(raw).sort().join(',') === legacyShape.split(' ').sort().join(',')) shape(raw, legacyShape);
  else shape(raw, controlShape);
  if (typeof raw.id !== 'string' || !PLAYER_IDS.test(raw.id)) throw new Error('玩家编号无效');
  for (const key of ['x', 'y', 'targetX', 'targetY'] as const) numberRange(raw[key], key === 'x' || key === 'targetX' ? ACTION_WIDTH : ACTION_HEIGHT, 0, key);
  integerRange(raw.maxHp, 500, 1, '生命上限');
  numberRange(raw.hp, raw.maxHp as number, 0, '生命');
  if (typeof raw.alive !== 'boolean' || raw.alive !== (Number(raw.hp) > 0)) throw new Error('玩家生命状态不一致');
  oneOf(raw.weapon, ['wand', 'bow', 'scatter'], '武器');
  numberRange(raw.damage, 200, 1, '伤害');
  numberRange(raw.speed, 300, 1, '速度');
  numberRange(raw.attackRate, 3, 0.5, '攻击速度');
  numberRange(raw.rangeBonus, 200, 0, '攻击距离加成');
  if ('moveX' in raw) {
    numberRange(raw.moveX, 1, -1, '横向输入');
    numberRange(raw.moveY, 1, -1, '纵向输入');
    numberRange(raw.aimX, ACTION_WIDTH, 0, '瞄准横坐标');
    numberRange(raw.aimY, ACTION_HEIGHT, 0, '瞄准纵坐标');
    if (typeof raw.firing !== 'boolean') throw new Error('射击状态无效');
  }
  for (const key of ['pathRefreshAt', 'attackReady', 'dashReady', 'skillReady', 'shieldReady', 'shieldUntil', 'invulnerableUntil'] as const) integerRange(raw[key], 1e12, 0, key);
  numberRange(raw.shield, 200, 0, '护盾');
  if (raw.lockedEnemy !== null && (typeof raw.lockedEnemy !== 'string' || !/^enemy-[0-9]+$/.test(raw.lockedEnemy))) throw new Error('锁定目标状态无效');
  if (!Array.isArray(raw.path) || raw.path.length > 64) throw new Error('玩家寻路状态无效');
  for (const point of raw.path) validatePoint(point);
}

function validateEnemy(raw: unknown): asserts raw is EnemyState {
  shape(raw, 'id kind x y hp maxHp radius damage speed attackReady attackIndex targetX targetY path pathReady windupUntil chargeTargetX chargeTargetY chargeTargetId bossPattern bossPhase');
  if (typeof raw.id !== 'string' || !/^enemy-[0-9]+$/.test(raw.id)) throw new Error('敌人编号无效');
  oneOf(raw.kind, ['chaser', 'shooter', 'charger', 'boss'], '敌人类型');
  for (const key of ['x', 'targetX', 'chargeTargetX'] as const) numberRange(raw[key], ACTION_WIDTH, 0, key);
  for (const key of ['y', 'targetY', 'chargeTargetY'] as const) numberRange(raw[key], ACTION_HEIGHT, 0, key);
  integerRange(raw.maxHp, 5000, 1, '敌人生命上限');
  numberRange(raw.hp, raw.maxHp as number, 0, '敌人生命');
  numberRange(raw.radius, 48, 4, '敌人半径');
  numberRange(raw.damage, 100, 0, '敌人伤害');
  numberRange(raw.speed, 200, 0, '敌人速度');
  for (const key of ['attackReady', 'attackIndex', 'pathReady', 'windupUntil'] as const) integerRange(raw[key], 1e12, 0, key);
  if (typeof raw.chargeTargetId !== 'string' || (raw.chargeTargetId !== '' && !PLAYER_IDS.test(raw.chargeTargetId))) throw new Error('冲锋目标无效');
  oneOf(raw.bossPattern, ['none', 'fan', 'barrage', 'charge'], '首领攻击模式');
  integerRange(raw.bossPhase, 3, 1, '首领阶段');
  if (!Array.isArray(raw.path) || raw.path.length > 64) throw new Error('敌人寻路状态无效');
  for (const point of raw.path) validatePoint(point);
  if (raw.kind !== 'boss' && (raw.bossPhase !== 1 || raw.bossPattern !== 'none')) throw new Error('普通敌人不能带首领攻击状态');
}

function validateProjectile(raw: unknown): asserts raw is ProjectileState {
  shape(raw, 'id x y vx vy owner faction damage radius ttl style');
  if (typeof raw.id !== 'string' || !/^shot-[0-9]+$/.test(raw.id)) throw new Error('投射物编号无效');
  numberRange(raw.x, ACTION_WIDTH, 0, '投射物横坐标');
  numberRange(raw.y, ACTION_HEIGHT, 0, '投射物纵坐标');
  numberRange(raw.vx, 900, -900, '投射物水平速度');
  numberRange(raw.vy, 900, -900, '投射物垂直速度');
  if (typeof raw.owner !== 'string' || raw.owner.length < 1 || raw.owner.length > 48) throw new Error('投射物归属无效');
  oneOf(raw.faction, ['players', 'enemies'], '投射物阵营');
  numberRange(raw.damage, 500, 0, '投射物伤害');
  numberRange(raw.radius, 20, 1, '投射物半径');
  integerRange(raw.ttl, 300, 1, '投射物寿命');
  oneOf(raw.style, ['wand', 'arrow', 'pellet', 'enemy', 'boss'], '投射物样式');
  if ((raw.faction === 'players') !== ['wand', 'arrow', 'pellet'].includes(String(raw.style))) throw new Error('投射物阵营与样式不一致');
}

function validateEffect(raw: unknown): asserts raw is ActionEffect {
  shape(raw, 'id kind x y radius fromX fromY toX toY expiresAt');
  if (typeof raw.id !== 'string' || !/^effect-[0-9]+$/.test(raw.id)) throw new Error('效果编号无效');
  oneOf(raw.kind, ['hit', 'dash', 'nova', 'ward', 'charge', 'boss-phase', 'death', 'stage-clear'], '效果类型');
  for (const key of ['x', 'fromX', 'toX'] as const) numberRange(raw[key], ACTION_WIDTH, 0, key);
  for (const key of ['y', 'fromY', 'toY'] as const) numberRange(raw[key], ACTION_HEIGHT, 0, key);
  numberRange(raw.radius, 500, 0, '效果范围');
  integerRange(raw.expiresAt, 1e12, 0, '效果过期时间');
}

function validateTelegraph(raw: unknown): asserts raw is ActionTelegraph {
  shape(raw, 'id kind x y targetX targetY radius expiresAt');
  if (typeof raw.id !== 'string' || !/^telegraph-enemy-[0-9]+$/.test(raw.id)) throw new Error('预警编号无效');
  oneOf(raw.kind, ['charge', 'boss-fan', 'boss-barrage'], '预警类型');
  for (const key of ['x', 'targetX'] as const) numberRange(raw[key], ACTION_WIDTH, 0, key);
  for (const key of ['y', 'targetY'] as const) numberRange(raw[key], ACTION_HEIGHT, 0, key);
  numberRange(raw.radius, 500, 0, '预警范围');
  integerRange(raw.expiresAt, 1e12, 0, '预警时间');
}

export function parseActionState(raw: unknown): ActionState {
  shape(raw, 'version runId seed rng phase paused stage wave width height tick elapsedMs carryMs players enemies projectiles obstacles effects telegraphs kills reward notice upgradeChoices enemySequence projectileSequence effectSequence');
  if (raw.version !== 1 || raw.width !== ACTION_WIDTH || raw.height !== ACTION_HEIGHT) throw new Error('战斗存档版本或地图尺寸不支持');
  integerRange(raw.seed, 0xffffffff, 0, '随机种子');
  if (typeof raw.runId !== 'string' || raw.runId !== `action-${Number(raw.seed).toString(16).padStart(8, '0')}`) throw new Error('战斗编号无效');
  integerRange(raw.rng, 0xffffffff, 1, '随机状态');
  oneOf(raw.phase, ['playing', 'upgrade', 'won', 'lost'], '战斗阶段');
  if (typeof raw.paused !== 'boolean') throw new Error('暂停标记无效');
  integerRange(raw.stage, 2, 0, '关卡');
  integerRange(raw.wave, 3, 1, '波次');
  integerRange(raw.tick, 1e12, 0, '战斗时钟');
  integerRange(raw.elapsedMs, 5e13, 0, '累计时间');
  integerRange(raw.carryMs, ACTION_STEP_MS - 1, 0, '步进余数');
  if (Number(raw.elapsedMs) !== Number(raw.tick) * ACTION_STEP_MS) throw new Error('战斗时钟与累计时间不一致');
  integerRange(raw.kills, 128, 0, '击杀数');
  for (const key of ['enemySequence', 'projectileSequence', 'effectSequence'] as const) integerRange(raw[key], 1e9, 0, key);
  if (typeof raw.notice !== 'string' || raw.notice.length > 240) throw new Error('战斗提示无效');
  if (!Array.isArray(raw.players) || raw.players.length > ACTION_MAX_PLAYERS) throw new Error('玩家数量超限');
  const playerIds = new Set<string>();
  for (const player of raw.players) { validatePlayer(player); if (playerIds.has(player.id)) throw new Error('玩家编号重复'); playerIds.add(player.id); }
  if (!raw.players.length && raw.phase !== 'lost') throw new Error('进行中的战斗至少需要一名玩家');
  if (!Array.isArray(raw.enemies) || raw.enemies.length > ACTION_MAX_ENEMIES) throw new Error('敌人数量超限');
  const enemyIds = new Set<string>();
  for (const enemy of raw.enemies) { validateEnemy(enemy); if (enemyIds.has(enemy.id)) throw new Error('敌人编号重复'); enemyIds.add(enemy.id); }
  if (!Array.isArray(raw.projectiles) || raw.projectiles.length > ACTION_MAX_PROJECTILES) throw new Error('投射物数量超限');
  const projectileIds = new Set<string>();
  for (const projectile of raw.projectiles) { validateProjectile(projectile); if (projectileIds.has(projectile.id)) throw new Error('投射物编号重复'); projectileIds.add(projectile.id); }
  if (!Array.isArray(raw.obstacles) || !sameObstacles(raw.obstacles, ACTION_LEVELS[Number(raw.stage)].obstacles)) throw new Error('地图障碍与关卡不匹配');
  if (!Array.isArray(raw.effects) || raw.effects.length > 96) throw new Error('战斗效果数量超限');
  for (const effect of raw.effects) validateEffect(effect);
  if (!Array.isArray(raw.telegraphs) || raw.telegraphs.length > ACTION_MAX_ENEMIES) throw new Error('预警数量超限');
  for (const telegraph of raw.telegraphs) validateTelegraph(telegraph);
  shape(raw.reward, 'coins xp');
  integerRange(raw.reward.coins, 100000, 0, '金币奖励');
  integerRange(raw.reward.xp, 100000, 0, '经验奖励');
  if (Number(raw.reward.coins) > Number(raw.kills) * 25 + Number(raw.stage) * 20 || Number(raw.reward.xp) > Number(raw.kills) * 45 + Number(raw.stage) * 30) throw new Error('奖励超过本局击杀与关卡上限');
  if (!Array.isArray(raw.upgradeChoices) || raw.upgradeChoices.length > 3) throw new Error('升级选项数量无效');
  const choices = new Set<string>();
  for (const choice of raw.upgradeChoices) { oneOf(choice, UPGRADE_IDS, '升级选项'); if (choices.has(choice)) throw new Error('升级选项重复'); choices.add(choice); }
  if (raw.phase === 'playing' && raw.upgradeChoices.length !== 0) throw new Error('战斗阶段不能保留升级选项');
  if (raw.phase === 'upgrade' && (Number(raw.stage) > 1 || Number(raw.wave) !== 3 || raw.upgradeChoices.length !== 3 || raw.enemies.length !== 0)) throw new Error('关间升级状态无效');
  if (raw.phase === 'won' && (raw.stage !== 2 || raw.wave !== 3 || raw.enemies.length !== 0 || raw.upgradeChoices.length !== 0)) throw new Error('通关状态无效');
  if (raw.phase === 'playing' && !(raw.players as PlayerState[]).some(player => player.alive)) throw new Error('没有存活玩家，不能继续战斗');
  if (raw.phase === 'playing' && raw.enemies.length === 0) throw new Error('战斗阶段必须有敌人');
  if ((raw.phase === 'upgrade' || raw.phase === 'won') && raw.telegraphs.length !== 0) throw new Error('该阶段不能保留预警');
  const state = structuredClone(raw) as unknown as ActionState;
  // Version-1 saves from before direct-input support may lack held-control state.
  // Resume those runs safely at rest instead of replaying an old click route.
  for (const player of state.players) {
    if (!Object.hasOwn(player as unknown as Record<string, unknown>, 'moveX')) {
      Object.assign(player, {
        moveX: 0, moveY: 0,
        aimX: clamp(player.x + 100, 0, ACTION_WIDTH), aimY: player.y,
        firing: false,
      });
      player.path = [];
      player.pathRefreshAt = state.tick;
      player.targetX = player.x;
      player.targetY = player.y;
      player.lockedEnemy = null;
    }
  }
  return state;
}

function randomNext(state: ActionState): number {
  let value = state.rng | 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  state.rng = (value >>> 0) || 1;
  return state.rng;
}

function randomInt(state: ActionState, limit: number): number { return randomNext(state) % limit; }
function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
function distance(a: Point, b: Point): number { return Math.hypot(a.x - b.x, a.y - b.y); }
function distanceSq(a: Point, b: Point): number { const dx = a.x - b.x; const dy = a.y - b.y; return dx * dx + dy * dy; }
function playerRadius(_player?: PlayerState): number { return PLAYER_RADIUS; }

/** Use the projectile's real hitbox for visibility checks so auto-aim never fires into grazing cover. */
function playerShotRadius(player: PlayerState): number {
  return player.weapon === 'wand' ? 7 : 4;
}

function blockedAt(state: ActionState, point: Point, radius = PLAYER_RADIUS): boolean {
  if (point.x < radius || point.y < radius || point.x > ACTION_WIDTH - radius || point.y > ACTION_HEIGHT - radius) return true;
  return state.obstacles.some(rect => point.x >= rect.x - radius && point.x <= rect.x + rect.width + radius && point.y >= rect.y - radius && point.y <= rect.y + rect.height + radius);
}

function segmentHitsRect(from: Point, to: Point, rect: Obstacle, radius = 0): boolean {
  const left = rect.x - radius, right = rect.x + rect.width + radius;
  const top = rect.y - radius, bottom = rect.y + rect.height + radius;
  let t0 = 0, t1 = 1;
  const dx = to.x - from.x, dy = to.y - from.y;
  const p = [-dx, dx, -dy, dy];
  const q = [from.x - left, right - from.x, from.y - top, bottom - from.y];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) { if (q[i] < 0) return false; continue; }
    const t = q[i] / p[i];
    if (p[i] < 0) { if (t > t1) return false; t0 = Math.max(t0, t); }
    else { if (t < t0) return false; t1 = Math.min(t1, t); }
  }
  return t0 <= t1;
}

function clearLine(state: ActionState, from: Point, to: Point, radius = 0): boolean {
  return !state.obstacles.some(rect => segmentHitsRect(from, to, rect, radius));
}

function gridPoint(index: number, cols: number): Point {
  return { x: PLAYER_RADIUS + 2 + (index % cols) * GRID, y: PLAYER_RADIUS + 2 + Math.floor(index / cols) * GRID };
}

/** 8-neighbour breadth-first routing keeps click-to-move paths around solid obstacles. */
function findPath(state: ActionState, from: Point, destination: Point, radius = PLAYER_RADIUS): Point[] {
  const direct = { x: clamp(destination.x, radius, ACTION_WIDTH - radius), y: clamp(destination.y, radius, ACTION_HEIGHT - radius) };
  if (!blockedAt(state, direct, radius) && clearLine(state, from, direct, radius)) return distance(from, direct) < 2 ? [] : [direct];
  const cols = Math.floor((ACTION_WIDTH - radius * 2 - 4) / GRID) + 1;
  const rows = Math.floor((ACTION_HEIGHT - radius * 2 - 4) / GRID) + 1;
  const total = cols * rows;
  const walkable = new Uint8Array(total);
  let start = -1, startD = Number.POSITIVE_INFINITY;
  for (let index = 0; index < total; index++) {
    const p = gridPoint(index, cols);
    if (p.y > ACTION_HEIGHT - radius - 2 || blockedAt(state, p, radius)) continue;
    walkable[index] = 1;
    const d = distanceSq(from, p);
    if (d < startD) { startD = d; start = index; }
  }
  if (start < 0) return [];
  const parents = new Int32Array(total); parents.fill(-2); parents[start] = -1;
  const queue = new Int32Array(total); let head = 0, tail = 0; queue[tail++] = start;
  const offsets = [-cols - 1, -cols, -cols + 1, -1, 1, cols - 1, cols, cols + 1];
  while (head < tail) {
    const current = queue[head++], cx = current % cols, cy = Math.floor(current / cols);
    for (const offset of offsets) {
      const next = current + offset;
      if (next < 0 || next >= total || !walkable[next] || parents[next] !== -2) continue;
      const nx = next % cols, ny = Math.floor(next / cols);
      if (Math.abs(nx - cx) > 1 || Math.abs(ny - cy) > 1) continue;
      if (nx !== cx && ny !== cy && (!walkable[cy * cols + nx] || !walkable[ny * cols + cx])) continue;
      parents[next] = current; queue[tail++] = next;
    }
  }
  let goal = start, best = Number.POSITIVE_INFINITY;
  for (let index = 0; index < total; index++) {
    if (parents[index] === -2) continue;
    const p = gridPoint(index, cols), d = distanceSq(p, direct);
    if (d < best || (d === best && index < goal)) { best = d; goal = index; }
  }
  const route: Point[] = [];
  for (let at = goal; at >= 0; at = parents[at]) route.push(gridPoint(at, cols));
  route.reverse();
  if (route.length && distance(route[route.length - 1], direct) < GRID * 0.6 && clearLine(state, route[route.length - 1], direct, radius)) route.push(direct);
  return route.filter((point, index) => index === 0 || distance(point, route[index - 1]) > 3);
}

function makePlayer(id: string, weapon: Weapon, x: number, y: number): PlayerState {
  const weaponStats = WEAPON_STATS[weapon];
  return {
    id, x, y, hp: 140, maxHp: 140, targetX: x, targetY: y, path: [], pathRefreshAt: 0,
    weapon, damage: weaponStats.damage, speed: 118, attackRate: 1, rangeBonus: 0,
    moveX: 0, moveY: 0, aimX: Math.min(ACTION_WIDTH, x + 100), aimY: y, firing: false,
    attackReady: 0, dashReady: 0, skillReady: 0, shieldReady: 0, shield: 0, shieldUntil: 0,
    invulnerableUntil: 0, alive: true, lockedEnemy: null,
  };
}

export function createActionRun(seed: number, weapon: Weapon, playerIds: string[] = ['player-1']): ActionState {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('随机种子必须是32位无符号整数');
  oneOf(weapon, ['wand', 'bow', 'scatter'], '武器');
  if (!Array.isArray(playerIds) || playerIds.length < 1 || playerIds.length > ACTION_MAX_PLAYERS || playerIds.some(id => typeof id !== 'string' || !PLAYER_IDS.test(id)) || new Set(playerIds).size !== playerIds.length) throw new Error('初始玩家列表无效');
  const normalizedSeed = seed >>> 0;
  const state: ActionState = {
    version: 1, runId: `action-${normalizedSeed.toString(16).padStart(8, '0')}`, seed: normalizedSeed, rng: normalizedSeed || 1,
    phase: 'playing', paused: false, stage: 0, wave: 1, width: ACTION_WIDTH, height: ACTION_HEIGHT,
    tick: 0, elapsedMs: 0, carryMs: 0,
    players: playerIds.map((id, index) => makePlayer(id, weapon, 78, 270 + (index - (playerIds.length - 1) / 2) * 26)),
    enemies: [], projectiles: [], obstacles: ACTION_LEVELS[0].obstacles.map(rect => ({ ...rect })), effects: [], telegraphs: [],
    kills: 0, reward: { coins: 0, xp: 0 }, notice: `${ACTION_LEVELS[0].name} · ${ACTION_LEVELS[0].subtitle}`,
    upgradeChoices: [], enemySequence: 0, projectileSequence: 0, effectSequence: 0,
  };
  spawnWave(state);
  return state;
}

export function setActionPlayerWeapon(state: ActionState, playerId: string, weapon: Weapon): void {
  if (typeof playerId !== 'string' || !PLAYER_IDS.test(playerId)) throw new Error('玩家编号无效');
  const player = state.players.find(item => item.id === playerId);
  if (!player) throw new Error('玩家不在当前战斗中');
  oneOf(weapon, ['wand', 'bow', 'scatter'], '武器');
  if (state.tick !== 0) throw new Error('只能在本局第一个模拟步前选择武器');
  player.weapon = weapon;
  player.damage = WEAPON_STATS[weapon].damage;
}

function enemyBase(state: ActionState, kind: EnemyKind, point: Point): EnemyState {
  const countScale = 1 + 0.3 * Math.max(0, state.players.length - 1);
  const stage = state.stage;
  const base: Record<EnemyKind, { hp: number; damage: number; speed: number; radius: number; cooldown: number }> = {
    chaser: { hp: 38 + 12 * stage, damage: 6 + stage, speed: 57 + 3 * stage, radius: 13, cooldown: 1200 },
    shooter: { hp: 30 + 8 * stage, damage: 5 + stage, speed: 42 + 2 * stage, radius: 12, cooldown: 1800 },
    charger: { hp: 48 + 12 * stage, damage: 10 + 2 * stage, speed: 54 + 2 * stage, radius: 15, cooldown: 2500 },
    boss: { hp: 440, damage: 9, speed: 35, radius: 31, cooldown: 1400 },
  };
  const stats = base[kind], id = `enemy-${++state.enemySequence}`;
  const hp = Math.round(stats.hp * countScale);
  return {
    id, kind, x: point.x, y: point.y, hp, maxHp: hp, radius: stats.radius, damage: stats.damage, speed: stats.speed,
    attackReady: state.tick + 10 + randomInt(state, 12), attackIndex: 0, targetX: point.x, targetY: point.y,
    path: [], pathReady: 0, windupUntil: 0, chargeTargetX: point.x, chargeTargetY: point.y, chargeTargetId: '', bossPattern: 'none', bossPhase: 1,
  };
}

function enemySpawnPoints(): Point[] {
  return [
    { x: 850, y: 84 }, { x: 864, y: 270 }, { x: 852, y: 458 }, { x: 680, y: 478 },
    { x: 495, y: 46 }, { x: 194, y: 455 }, { x: 138, y: 120 }, { x: 702, y: 265 },
    { x: 820, y: 188 }, { x: 540, y: 453 }, { x: 194, y: 270 }, { x: 724, y: 352 },
  ];
}

function freeSpawn(state: ActionState, proposed: Point, radius: number): Point {
  if (!blockedAt(state, proposed, radius)) return proposed;
  for (let distanceStep = 0; distanceStep < 300; distanceStep += 18) {
    for (let angle = 0; angle < 16; angle++) {
      const theta = angle * Math.PI / 8;
      const point = { x: clamp(proposed.x + Math.cos(theta) * distanceStep, radius, ACTION_WIDTH - radius), y: clamp(proposed.y + Math.sin(theta) * distanceStep, radius, ACTION_HEIGHT - radius) };
      if (!blockedAt(state, point, radius)) return point;
    }
  }
  return { x: ACTION_WIDTH - 50, y: ACTION_HEIGHT / 2 };
}

function spawnWave(state: ActionState): void {
  const kinds = ACTION_LEVELS[state.stage].waves[state.wave - 1];
  state.enemies = [];
  state.telegraphs = [];
  state.projectiles = [];
  const points = enemySpawnPoints();
  for (const kind of kinds.slice(0, ACTION_MAX_ENEMIES - state.enemies.length)) {
    const offset = randomInt(state, points.length);
    let point = points[offset];
    for (let n = 0; n < points.length; n++) {
      const candidate = points[(offset + n) % points.length];
      if (!blockedAt(state, candidate, kind === 'boss' ? 32 : 15)) { point = candidate; break; }
    }
    point = freeSpawn(state, point, kind === 'boss' ? 32 : 15);
    state.enemies.push(enemyBase(state, kind, point));
  }
  // A wave change clears the old target lock, while a player's ground-click route remains valid.
  for (const player of state.players) player.lockedEnemy = null;
}

function addEffect(state: ActionState, kind: ActionEffect['kind'], point: Point, radius: number, from = point, to = point, durationMs = 450): void {
  state.effects.push({ id: `effect-${++state.effectSequence}`, kind, x: point.x, y: point.y, radius, fromX: from.x, fromY: from.y, toX: to.x, toY: to.y, expiresAt: state.tick + Math.max(1, Math.ceil(durationMs / ACTION_STEP_MS)) });
  if (state.effects.length > 96) state.effects.splice(0, state.effects.length - 96);
}

function makePath(state: ActionState, player: PlayerState, destination: Point): void {
  const safe = { x: clamp(destination.x, PLAYER_RADIUS, ACTION_WIDTH - PLAYER_RADIUS), y: clamp(destination.y, PLAYER_RADIUS, ACTION_HEIGHT - PLAYER_RADIUS) };
  player.path = findPath(state, { x: player.x, y: player.y }, safe, PLAYER_RADIUS);
  const last = player.path[player.path.length - 1] ?? { x: player.x, y: player.y };
  player.targetX = last.x; player.targetY = last.y; player.pathRefreshAt = state.tick + 8;
}

function makeAttackPath(state: ActionState, player: PlayerState, enemy: EnemyState, preferredDistance: number): void {
  let best: Point[] | undefined, bestCost = Number.POSITIVE_INFINITY;
  const shotRadius = playerShotRadius(player);
  for (let index = 0; index < 16; index++) {
    const angle = index * Math.PI / 8;
    const candidate = {
      x: clamp(enemy.x + Math.cos(angle) * preferredDistance, PLAYER_RADIUS, ACTION_WIDTH - PLAYER_RADIUS),
      y: clamp(enemy.y + Math.sin(angle) * preferredDistance, PLAYER_RADIUS, ACTION_HEIGHT - PLAYER_RADIUS),
    };
    if (blockedAt(state, candidate, PLAYER_RADIUS) || !clearLine(state, candidate, enemy, shotRadius)) continue;
    const path = findPath(state, player, candidate, PLAYER_RADIUS);
    let cost = distance(player, path[0] ?? candidate);
    for (let i = 1; i < path.length; i++) cost += distance(path[i - 1], path[i]);
    if (cost < bestCost) { bestCost = cost; best = path; }
  }
  if (!best) { makePath(state, player, enemy); return; }
  player.path = best;
  const last = best[best.length - 1] ?? { x: player.x, y: player.y };
  player.targetX = last.x; player.targetY = last.y; player.pathRefreshAt = state.tick + 8;
}

function closestFreeOnDash(state: ActionState, from: Point, destination: Point): Point {
  const dx = destination.x - from.x, dy = destination.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length < 1) return from;
  const travel = Math.min(148, length);
  const to = { x: clamp(from.x + dx / length * travel, PLAYER_RADIUS, ACTION_WIDTH - PLAYER_RADIUS), y: clamp(from.y + dy / length * travel, PLAYER_RADIUS, ACTION_HEIGHT - PLAYER_RADIUS) };
  const steps = Math.max(1, Math.ceil(distance(from, to) / 4));
  let result = from;
  for (let i = 1; i <= steps; i++) {
    const candidate = { x: from.x + (to.x - from.x) * i / steps, y: from.y + (to.y - from.y) * i / steps };
    if (blockedAt(state, candidate, PLAYER_RADIUS)) break;
    result = candidate;
  }
  return result;
}

function clearPlayerControls(player: PlayerState): void {
  player.moveX = 0;
  player.moveY = 0;
  player.firing = false;
  player.path = [];
  player.targetX = player.x;
  player.targetY = player.y;
  player.lockedEnemy = null;
}

function clearRunControls(state: ActionState): void {
  for (const player of state.players) clearPlayerControls(player);
}

/** Clear held movement, firing, and legacy targeting for every player in a run. */
export function clearActionControls(state: ActionState): void {
  clearRunControls(state);
}

export function actionInput(state: ActionState, playerId: string, rawInput: ActionInput): void {
  const input = parseActionInput(rawInput);
  if (typeof playerId !== 'string' || !PLAYER_IDS.test(playerId)) throw new Error('玩家编号无效');
  const player = state.players.find(item => item.id === playerId);
  if (!player) throw new Error('玩家不在当前战斗中');
  if (input.type === 'pause') { state.paused = input.paused; state.carryMs = 0; clearRunControls(state); return; }
  if (input.type === 'control' && input.moveX === 0 && input.moveY === 0 && !input.firing) {
    player.moveX = 0; player.moveY = 0; player.firing = false;
    player.path = []; player.targetX = player.x; player.targetY = player.y; player.lockedEnemy = null;
    return;
  }
  if (state.paused) throw new Error('战斗已暂停');
  if (state.phase === 'won' || state.phase === 'lost') throw new Error('本局战斗已经结束');
  if (!player.alive && input.type !== 'upgrade') throw new Error('倒下的玩家不能操作');
  if (input.type === 'control') {
    player.moveX = input.moveX;
    player.moveY = input.moveY;
    player.aimX = input.aimX;
    player.aimY = input.aimY;
    player.firing = input.firing;
    player.path = [];
    player.lockedEnemy = null;
    player.targetX = player.x;
    player.targetY = player.y;
    return;
  }
  if (input.type === 'move') {
    player.lockedEnemy = null;
    makePath(state, player, { x: input.x, y: input.y });
    return;
  }
  if (input.type === 'lock') {
    const enemy = state.enemies.find(item => item.id === input.enemyId && item.hp > 0);
    if (!enemy) throw new Error('锁定的敌人不存在或已被击败');
    player.lockedEnemy = enemy.id;
    const desired = Math.max(58, (WEAPON_STATS[player.weapon].range + player.rangeBonus) * 0.7);
    makeAttackPath(state, player, enemy, desired);
    return;
  }
  if (input.type === 'dash') {
    if (state.phase !== 'playing') throw new Error('只有战斗中可以翻滚');
    if (state.tick < player.dashReady) throw new Error('翻滚冷却中');
    const from = { x: player.x, y: player.y }, to = closestFreeOnDash(state, from, { x: input.x, y: input.y });
    player.x = to.x; player.y = to.y; player.path = []; player.lockedEnemy = null;
    player.targetX = to.x; player.targetY = to.y;
    player.invulnerableUntil = state.tick + 9;
    player.dashReady = state.tick + 36;
    addEffect(state, 'dash', to, 18, from, to, 380);
    return;
  }
  if (input.type === 'skill') {
    if (state.phase !== 'playing') throw new Error('只有战斗中可以使用技能');
    if (input.skill === 'nova') {
      if (state.tick < player.skillReady) throw new Error('星爆脉冲冷却中');
      player.skillReady = state.tick + 160;
      const radius = 138;
      for (const enemy of [...state.enemies]) {
        if (enemy.hp > 0 && distance(player, enemy) <= radius + enemy.radius && clearLine(state, player, enemy, 0)) damageEnemy(state, enemy, player.damage * 1.45, player.id);
      }
      addEffect(state, 'nova', player, radius, player, player, 650);
      state.notice = '星爆脉冲：范围内敌人受到伤害。';
    } else {
      if (state.tick < player.shieldReady) throw new Error('守望结界冷却中');
      player.shield = Math.min(100, player.shield + 46);
      player.shieldUntil = state.tick + 80;
      player.shieldReady = state.tick + 220;
      addEffect(state, 'ward', player, 46, player, player, 1200);
      state.notice = '守望结界：获得46点临时护盾。';
    }
    return;
  }
  if (input.type === 'upgrade') {
    if (state.phase !== 'upgrade') throw new Error('当前没有可选的关间升级');
    if (!state.upgradeChoices.includes(input.choice as UpgradeId)) throw new Error('该升级不在本次选项中');
    clearRunControls(state);
    const choice = input.choice as UpgradeId;
    for (const teammate of state.players) {
      if (choice === 'sharp-edge') teammate.damage = Math.min(200, teammate.damage + 4);
      else if (choice === 'heartwood') {
        teammate.maxHp = Math.min(500, teammate.maxHp + 22);
        if (teammate.alive) teammate.hp = Math.min(teammate.maxHp, teammate.hp + 22);
      }
      else if (choice === 'nimble') teammate.speed = Math.min(300, teammate.speed + 18);
      else if (choice === 'quick-hands') teammate.attackRate = Math.min(3, teammate.attackRate + 0.15);
      else if (choice === 'long-reach') teammate.rangeBonus = Math.min(200, teammate.rangeBonus + 35);
    }
    for (const teammate of state.players) {
      if (teammate.alive) teammate.hp = Math.min(teammate.maxHp, teammate.hp + 18);
      else {
        teammate.alive = true;
        teammate.hp = teammate.maxHp / 2;
        teammate.shield = 0;
        teammate.shieldUntil = 0;
      }
    }
    state.stage = (state.stage + 1) as 1 | 2;
    state.wave = 1;
    state.phase = 'playing';
    state.upgradeChoices = [];
    state.obstacles = ACTION_LEVELS[state.stage].obstacles.map(rect => ({ ...rect }));
    for (const teammate of state.players) {
      const spawn = freeSpawn(state, { x: 78, y: 270 + (state.players.indexOf(teammate) - (state.players.length - 1) / 2) * 26 }, PLAYER_RADIUS);
      teammate.x = spawn.x; teammate.y = spawn.y; teammate.targetX = spawn.x; teammate.targetY = spawn.y; teammate.path = []; teammate.lockedEnemy = null;
    }
    state.notice = `${ACTION_LEVELS[state.stage].name} · ${ACTION_LEVELS[state.stage].subtitle}`;
    spawnWave(state);
  }
}

function projectile(state: ActionState, faction: ProjectileState['faction'], owner: string, from: Point, angle: number, speed: number, damage: number, style: ProjectileState['style'], radius = 5): void {
  if (state.projectiles.length >= ACTION_MAX_PROJECTILES) return;
  const velocity = { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed };
  state.projectiles.push({ id: `shot-${++state.projectileSequence}`, x: from.x, y: from.y, vx: velocity.x, vy: velocity.y, owner, faction, damage, radius, ttl: 90, style });
}

function weaponTarget(state: ActionState, player: PlayerState): EnemyState | undefined {
  if (player.lockedEnemy) {
    const locked = state.enemies.find(enemy => enemy.id === player.lockedEnemy && enemy.hp > 0);
    if (locked) return locked;
    player.lockedEnemy = null;
  }
  return undefined;
}

function firePlayerWeapon(state: ActionState, player: PlayerState, target: Point): void {
  const stats = WEAPON_STATS[player.weapon];
  const angle = Math.atan2(target.y - player.y, target.x - player.x);
  const speed = stats.projectileSpeed;
  const ready = state.tick + Math.max(3, Math.ceil(stats.cooldown / player.attackRate / ACTION_STEP_MS));
  if (player.weapon === 'scatter') {
    for (const offset of [-0.23, 0, 0.23]) projectile(state, 'players', player.id, player, angle + offset, speed, player.damage, 'pellet', 4);
  } else if (player.weapon === 'bow') projectile(state, 'players', player.id, player, angle, speed, player.damage, 'arrow', 4);
  else projectile(state, 'players', player.id, player, angle, speed, player.damage, 'wand', 7);
  player.attackReady = ready;
}

function chooseTarget(state: ActionState, from: Point, activePlayerIds: ReadonlySet<string>): PlayerState | undefined {
  let best: PlayerState | undefined, bestDistance = Number.POSITIVE_INFINITY;
  for (const player of state.players) {
    if (!player.alive || !activePlayerIds.has(player.id)) continue;
    const d = distanceSq(from, player);
    if (d < bestDistance) { best = player; bestDistance = d; }
  }
  return best;
}

function damageEnemy(state: ActionState, enemy: EnemyState, damage: number, _owner: string): void {
  if (enemy.hp <= 0) return;
  enemy.hp = Math.max(0, enemy.hp - damage);
  if (enemy.hp > 0) return;
  state.kills++;
  const reward = enemy.kind === 'boss' ? { coins: 25, xp: 45 } : enemy.kind === 'charger' ? { coins: 5, xp: 8 } : enemy.kind === 'shooter' ? { coins: 4, xp: 6 } : { coins: 3, xp: 4 };
  state.reward.coins += reward.coins; state.reward.xp += reward.xp;
  addEffect(state, enemy.kind === 'boss' ? 'stage-clear' : 'hit', enemy, enemy.radius + 8, enemy, enemy, enemy.kind === 'boss' ? 1100 : 350);
  for (const player of state.players) if (player.lockedEnemy === enemy.id) player.lockedEnemy = null;
  if (enemy.kind === 'boss') { state.reward.coins += 15; state.reward.xp += 25; }
}

function finishActionRunAsLost(state: ActionState, notice: string): void {
  clearRunControls(state);
  state.phase = 'lost'; state.enemies = []; state.projectiles = []; state.telegraphs = [];
  state.upgradeChoices = []; state.carryMs = 0; state.notice = notice;
}

function damagePlayer(state: ActionState, player: PlayerState, amount: number, source: Point, activePlayerIds: ReadonlySet<string>): void {
  if (!activePlayerIds.has(player.id) || !player.alive || state.tick < player.invulnerableUntil) return;
  if (player.shield > 0 && state.tick < player.shieldUntil) {
    const absorbed = Math.min(player.shield, amount);
    player.shield -= absorbed; amount -= absorbed;
  }
  if (amount > 0) player.hp = Math.max(0, player.hp - amount);
  addEffect(state, player.hp > 0 ? 'hit' : 'death', player, 16, source, player, 420);
  if (player.hp <= 0) {
    player.alive = false; player.path = []; player.lockedEnemy = null;
    state.notice = `${player.id} 倒下了。`;
    if (!state.players.some(other => other.alive && activePlayerIds.has(other.id))) {
      finishActionRunAsLost(state, '远征失败；本局已获得的金币与经验仍在奖励账本中。');
    }
  }
}

function moveAlongPath(state: ActionState, actor: PlayerState | EnemyState, speed: number, radius: number, steps: number): void {
  if (!actor.path.length) return;
  const travel = speed * ACTION_STEP_MS / 1000;
  let remaining = travel;
  while (remaining > 0 && actor.path.length) {
    const next = actor.path[0], dx = next.x - actor.x, dy = next.y - actor.y, length = Math.hypot(dx, dy);
    if (length < 1.5) { actor.x = next.x; actor.y = next.y; actor.path.shift(); continue; }
    const amount = Math.min(remaining, length), point = { x: actor.x + dx / length * amount, y: actor.y + dy / length * amount };
    if (blockedAt(state, point, radius)) { actor.path = []; break; }
    actor.x = point.x; actor.y = point.y; remaining -= amount;
  }
  if (!actor.path.length && 'pathRefreshAt' in actor) { actor.targetX = actor.x; actor.targetY = actor.y; }
  void steps;
}

function movePlayerByAxes(state: ActionState, player: PlayerState): void {
  const length = Math.hypot(player.moveX, player.moveY);
  if (length === 0) return;
  const travel = player.speed * ACTION_STEP_MS / 1000;
  const dx = player.moveX / length * travel;
  const dy = player.moveY / length * travel;
  const destination = { x: player.x + dx, y: player.y + dy };
  if (!blockedAt(state, destination, PLAYER_RADIUS)) {
    player.x = destination.x;
    player.y = destination.y;
  } else {
    const horizontal = { x: player.x + dx, y: player.y };
    const vertical = { x: player.x, y: player.y + dy };
    if (!blockedAt(state, horizontal, PLAYER_RADIUS)) {
      player.x = horizontal.x;
      player.y = horizontal.y;
    } else if (!blockedAt(state, vertical, PLAYER_RADIUS)) {
      player.x = vertical.x;
      player.y = vertical.y;
    }
  }
  player.path = [];
  player.targetX = player.x;
  player.targetY = player.y;
}

function movePlayer(state: ActionState, player: PlayerState): void {
  if (!player.alive) return;
  const locked = player.lockedEnemy ? state.enemies.find(enemy => enemy.id === player.lockedEnemy && enemy.hp > 0) : undefined;
  if (player.moveX !== 0 || player.moveY !== 0) {
    player.lockedEnemy = null;
    movePlayerByAxes(state, player);
  } else if (locked) {
    // Legacy explicit lock inputs remain supported internally; the new arena UI
    // never sends them, so ordinary aiming never pulls the player toward a target.
    const range = WEAPON_STATS[player.weapon].range + player.rangeBonus;
    const dist = distance(player, locked);
    const desired = Math.max(58, range * 0.7);
    const blockedShot = !clearLine(state, player, locked, playerShotRadius(player));
    if ((dist > desired || blockedShot) && (state.tick >= player.pathRefreshAt || player.path.length === 0)) {
      makeAttackPath(state, player, locked, desired);
    }
    moveAlongPath(state, player, player.speed, PLAYER_RADIUS, 1);
  } else {
    moveAlongPath(state, player, player.speed, PLAYER_RADIUS, 1);
  }
  if (state.tick < player.attackReady) return;
  if (player.firing) {
    if (distance(player, { x: player.aimX, y: player.aimY }) < 1) return;
    firePlayerWeapon(state, player, { x: player.aimX, y: player.aimY });
    return;
  }
  const target = weaponTarget(state, player);
  if (!target) return;
  const range = WEAPON_STATS[player.weapon].range + player.rangeBonus;
  if (distance(player, target) <= range && clearLine(state, player, target, playerShotRadius(player))) firePlayerWeapon(state, player, target);
}

function moveActorToward(state: ActionState, enemy: EnemyState, target: Point, speed: number, radius: number): void {
  if (distance(enemy, target) < 4) { enemy.path = []; return; }
  if (state.tick >= enemy.pathReady || distance({ x: enemy.targetX, y: enemy.targetY }, target) > 45) {
    enemy.targetX = target.x; enemy.targetY = target.y;
    enemy.path = findPath(state, enemy, target, radius);
    enemy.pathReady = state.tick + 10;
  }
  if (enemy.path.length) moveAlongPath(state, enemy, speed, radius, 1);
  else {
    const dx = target.x - enemy.x, dy = target.y - enemy.y, length = Math.hypot(dx, dy) || 1;
    const candidate = { x: enemy.x + dx / length * speed * ACTION_STEP_MS / 1000, y: enemy.y + dy / length * speed * ACTION_STEP_MS / 1000 };
    if (!blockedAt(state, candidate, radius)) { enemy.x = candidate.x; enemy.y = candidate.y; }
  }
}

function beginCharge(state: ActionState, enemy: EnemyState, target: PlayerState, durationMs: number, kind: ActionTelegraph['kind'] = 'charge'): void {
  enemy.windupUntil = state.tick + Math.ceil(durationMs / ACTION_STEP_MS);
  enemy.chargeTargetX = target.x; enemy.chargeTargetY = target.y; enemy.chargeTargetId = target.id;
  if (enemy.kind === 'boss') enemy.bossPattern = 'charge';
  state.telegraphs.push({ id: `telegraph-${enemy.id}`, kind, x: enemy.x, y: enemy.y, targetX: target.x, targetY: target.y, radius: enemy.kind === 'boss' ? 28 : 22, expiresAt: enemy.windupUntil });
}

function resolveCharge(state: ActionState, enemy: EnemyState, activePlayerIds: ReadonlySet<string>): void {
  const from = { x: enemy.x, y: enemy.y }, target = { x: enemy.chargeTargetX, y: enemy.chargeTargetY };
  const dx = target.x - from.x, dy = target.y - from.y, length = Math.hypot(dx, dy) || 1;
  const travel = Math.min(enemy.kind === 'boss' ? 230 : 190, length + 28);
  const desired = { x: clamp(from.x + dx / length * travel, enemy.radius, ACTION_WIDTH - enemy.radius), y: clamp(from.y + dy / length * travel, enemy.radius, ACTION_HEIGHT - enemy.radius) };
  let to = from;
  const count = Math.ceil(distance(from, desired) / 4);
  for (let i = 1; i <= count; i++) {
    const candidate = { x: from.x + (desired.x - from.x) * i / count, y: from.y + (desired.y - from.y) * i / count };
    if (blockedAt(state, candidate, enemy.radius)) break;
    to = candidate;
  }
  enemy.x = to.x; enemy.y = to.y; enemy.path = []; enemy.windupUntil = 0;
  if (enemy.kind === 'boss') enemy.bossPattern = 'none';
  const impactRadius = enemy.kind === 'boss' ? 24 : 18;
  for (const player of state.players) {
    if (activePlayerIds.has(player.id) && player.alive && pointSegmentDistance(player, from, to) <= impactRadius + PLAYER_RADIUS) damagePlayer(state, player, enemy.damage, from, activePlayerIds);
  }
  addEffect(state, 'charge', to, impactRadius, from, to, 550);
  enemy.attackReady = state.tick + (enemy.kind === 'boss' ? 45 : 38);
}

function pointSegmentDistance(point: Point, from: Point, to: Point): number {
  const dx = to.x - from.x, dy = to.y - from.y;
  if (dx === 0 && dy === 0) return distance(point, from);
  const t = clamp(((point.x - from.x) * dx + (point.y - from.y) * dy) / (dx * dx + dy * dy), 0, 1);
  return Math.hypot(point.x - (from.x + t * dx), point.y - (from.y + t * dy));
}

function enemyAttack(state: ActionState, enemy: EnemyState, target: PlayerState, activePlayerIds: ReadonlySet<string>): void {
  const targetAngle = Math.atan2(target.y - enemy.y, target.x - enemy.x);
  if (enemy.kind === 'chaser') {
    const d = distance(enemy, target);
    if (d > enemy.radius + PLAYER_RADIUS + 4) moveActorToward(state, enemy, target, enemy.speed, enemy.radius);
    else if (state.tick >= enemy.attackReady) {
      damagePlayer(state, target, enemy.damage, enemy, activePlayerIds); enemy.attackReady = state.tick + 24;
    }
    return;
  }
  if (enemy.kind === 'shooter') {
    const d = distance(enemy, target);
    if (d > 290 || !clearLine(state, enemy, target, 0)) moveActorToward(state, enemy, target, enemy.speed, enemy.radius);
    else if (d < 165) {
      const away = Math.atan2(enemy.y - target.y, enemy.x - target.x);
      const retreat = { x: clamp(enemy.x + Math.cos(away) * 8, enemy.radius, ACTION_WIDTH - enemy.radius), y: clamp(enemy.y + Math.sin(away) * 8, enemy.radius, ACTION_HEIGHT - enemy.radius) };
      if (!blockedAt(state, retreat, enemy.radius)) { enemy.x = retreat.x; enemy.y = retreat.y; enemy.path = []; }
    }
    if (d <= 400 && clearLine(state, enemy, target, 0) && state.tick >= enemy.attackReady) {
      projectile(state, 'enemies', enemy.id, enemy, targetAngle, 205, enemy.damage, 'enemy', 6);
      enemy.attackReady = state.tick + 34;
    }
    return;
  }
  if (enemy.kind === 'charger') {
    if (enemy.windupUntil > 0) { if (state.tick >= enemy.windupUntil) resolveCharge(state, enemy, activePlayerIds); return; }
    const d = distance(enemy, target);
    if (state.tick >= enemy.attackReady && d <= 280) beginCharge(state, enemy, target, 800);
    else if (d > 200) moveActorToward(state, enemy, target, enemy.speed, enemy.radius);
    return;
  }
  const nextPhase: 1 | 2 | 3 = enemy.hp <= enemy.maxHp * 0.3 ? 3 : enemy.hp <= enemy.maxHp * 0.65 ? 2 : 1;
  if (nextPhase !== enemy.bossPhase) {
    enemy.bossPhase = nextPhase;
    addEffect(state, 'boss-phase', enemy, 86, enemy, enemy, 950);
    state.notice = nextPhase === 2 ? '遗迹首领进入第二阶段：七向扇形弹幕。' : '遗迹首领进入狂暴阶段：密集弹幕与冲锋预警。';
  }
  if (enemy.windupUntil > 0) {
    if (state.tick >= enemy.windupUntil) {
      if (enemy.bossPattern === 'charge') resolveCharge(state, enemy, activePlayerIds);
      else {
        const angle = Math.atan2(enemy.chargeTargetY - enemy.y, enemy.chargeTargetX - enemy.x);
        if (enemy.bossPattern === 'fan') {
          for (let i = 0; i < 7; i++) projectile(state, 'enemies', enemy.id, enemy, angle + (i - 3) * 0.2, 215, enemy.damage * 0.72, 'boss', 7);
        } else if (enemy.bossPattern === 'barrage') {
          for (let i = 0; i < 12; i++) projectile(state, 'enemies', enemy.id, enemy, i * Math.PI / 6 + angle * 0.08, 235, enemy.damage * 0.64, 'boss', 7);
        }
        enemy.windupUntil = 0; enemy.bossPattern = 'none'; enemy.attackReady = state.tick + 28;
      }
    }
    return;
  }
  if (state.tick < enemy.attackReady) return;
  enemy.attackIndex++;
  if (enemy.bossPhase === 1) {
    projectile(state, 'enemies', enemy.id, enemy, targetAngle, 225, enemy.damage, 'boss', 8);
    enemy.attackReady = state.tick + 30;
  } else if (enemy.bossPhase === 2) {
    enemy.bossPattern = 'fan'; enemy.windupUntil = state.tick + 10;
    enemy.chargeTargetX = target.x; enemy.chargeTargetY = target.y;
    state.telegraphs.push({ id: `telegraph-${enemy.id}`, kind: 'boss-fan', x: enemy.x, y: enemy.y, targetX: target.x, targetY: target.y, radius: 160, expiresAt: enemy.windupUntil });
    enemy.attackReady = enemy.windupUntil + 25;
  } else if (enemy.attackIndex % 3 === 0) {
    beginCharge(state, enemy, target, 650, 'boss-barrage');
  } else {
    enemy.bossPattern = 'barrage'; enemy.windupUntil = state.tick + 9;
    enemy.chargeTargetX = target.x; enemy.chargeTargetY = target.y;
    enemy.attackReady = enemy.windupUntil + 24;
    state.telegraphs.push({ id: `telegraph-${enemy.id}`, kind: 'boss-barrage', x: enemy.x, y: enemy.y, targetX: target.x, targetY: target.y, radius: 130, expiresAt: enemy.windupUntil });
  }
}

function projectileHitsObstacle(from: Point, to: Point, state: ActionState, radius: number): boolean {
  return state.obstacles.some(rect => segmentHitsRect(from, to, rect, radius));
}

function moveProjectiles(state: ActionState, activePlayerIds: ReadonlySet<string>): void {
  const remaining: ProjectileState[] = [];
  for (const shot of state.projectiles) {
    shot.ttl--;
    const from = { x: shot.x, y: shot.y };
    const to = { x: shot.x + shot.vx * ACTION_STEP_MS / 1000, y: shot.y + shot.vy * ACTION_STEP_MS / 1000 };
    if (shot.ttl <= 0 || to.x < 0 || to.x > ACTION_WIDTH || to.y < 0 || to.y > ACTION_HEIGHT || projectileHitsObstacle(from, to, state, shot.radius)) continue;
    let hit = false;
    if (shot.faction === 'players') {
      if (!activePlayerIds.has(shot.owner)) continue;
      for (const enemy of state.enemies) {
        if (enemy.hp <= 0) continue;
        if (pointSegmentDistance(enemy, from, to) <= enemy.radius + shot.radius) {
          damageEnemy(state, enemy, shot.damage, shot.owner);
          hit = true;
          break;
        }
      }
    } else {
      for (const player of state.players) {
        if (!activePlayerIds.has(player.id) || !player.alive) continue;
        if (pointSegmentDistance(player, from, to) <= PLAYER_RADIUS + shot.radius) {
          damagePlayer(state, player, shot.damage, from, activePlayerIds);
          hit = true;
          break;
        }
      }
    }
    if (state.phase === 'lost') break;
    if (!hit) { shot.x = to.x; shot.y = to.y; remaining.push(shot); }
  }
  state.projectiles = state.phase === 'lost' ? [] : remaining.slice(0, ACTION_MAX_PROJECTILES);
}

function onWaveCleared(state: ActionState): void {
  clearRunControls(state);
  state.enemies = [];
  state.projectiles = [];
  state.telegraphs = [];
  for (const player of state.players) if (player.alive) player.hp = Math.min(player.maxHp, player.hp + 12);
  if (state.wave < 3) {
    state.wave++;
    state.notice = `第${state.wave - 1}波已清理，下一波逼近。`;
    spawnWave(state);
    return;
  }
  if (state.stage === 2) {
    state.phase = 'won'; state.upgradeChoices = []; state.telegraphs = []; state.projectiles = []; state.notice = '遗迹首领已击败，三关远征完成。';
    state.reward.coins += 15; state.reward.xp += 20;
    addEffect(state, 'stage-clear', { x: 480, y: 270 }, 240, { x: 480, y: 270 }, { x: 480, y: 270 }, 1400);
    return;
  }
  state.phase = 'upgrade';
  state.reward.coins += 6 + state.stage * 3;
  state.reward.xp += 12 + state.stage * 6;
  const available = [...UPGRADE_IDS], choices: UpgradeId[] = [];
  while (choices.length < 3) choices.push(available.splice(randomInt(state, available.length), 1)[0]);
  state.upgradeChoices = choices;
  state.telegraphs = [];
  state.notice = `${ACTION_LEVELS[state.stage].name}已清理，选一项升级并恢复少量生命。`;
  addEffect(state, 'stage-clear', { x: 480, y: 270 }, 180, { x: 480, y: 270 }, { x: 480, y: 270 }, 900);
}

function updateTelegraphs(state: ActionState): void {
  state.telegraphs = state.telegraphs.filter(item => item.expiresAt > state.tick && (item.kind !== 'charge' || state.enemies.some(enemy => `telegraph-${enemy.id}` === item.id && enemy.windupUntil > state.tick)));
  for (const enemy of state.enemies) {
    if (enemy.windupUntil <= state.tick || enemy.hp <= 0) continue;
    const id = `telegraph-${enemy.id}`;
    if (!state.telegraphs.some(item => item.id === id)) state.telegraphs.push({ id, kind: enemy.kind === 'boss' ? enemy.bossPattern === 'fan' ? 'boss-fan' : 'boss-barrage' : 'charge', x: enemy.x, y: enemy.y, targetX: enemy.chargeTargetX, targetY: enemy.chargeTargetY, radius: enemy.kind === 'boss' ? 28 : 22, expiresAt: enemy.windupUntil });
  }
}

function stepOne(state: ActionState, activePlayerIds: ReadonlySet<string>): void {
  state.tick++;
  state.elapsedMs += ACTION_STEP_MS;
  state.effects = state.effects.filter(effect => effect.expiresAt > state.tick);
  if (state.phase !== 'playing') { state.telegraphs = []; return; }
  for (const player of state.players) if (player.alive && activePlayerIds.has(player.id)) {
    if (player.shieldUntil <= state.tick) player.shield = 0;
    movePlayer(state, player);
  }
  for (const enemy of [...state.enemies]) {
    if (enemy.hp <= 0 || state.phase !== 'playing') continue;
    const target = chooseTarget(state, enemy, activePlayerIds);
    if (target) enemyAttack(state, enemy, target, activePlayerIds);
  }
  moveProjectiles(state, activePlayerIds);
  updateTelegraphs(state);
  state.enemies = state.enemies.filter(enemy => enemy.hp > 0);
  if (state.phase === 'playing' && state.enemies.length === 0) onWaveCleared(state);
}

function resolveActivePlayerIds(state: ActionState, activePlayerIds?: readonly string[]): Set<string> {
  if (activePlayerIds === undefined) return new Set(state.players.map(player => player.id));
  if (!Array.isArray(activePlayerIds)) throw new Error('活跃玩家列表无效');
  const active = new Set<string>();
  for (const id of activePlayerIds) {
    if (typeof id !== 'string' || !PLAYER_IDS.test(id) || !state.players.some(player => player.id === id)) throw new Error('活跃玩家必须属于当前战斗');
    if (active.has(id)) throw new Error('活跃玩家编号不能重复');
    active.add(id);
  }
  return active;
}

function isTerminalActionState(state: ActionState): boolean {
  return state.phase === 'won' || state.phase === 'lost';
}

export function stepAction(state: ActionState, elapsedMs: number, activePlayerIds?: readonly string[]): void {
  numberRange(elapsedMs, 60000, 0, '模拟时间');
  const active = resolveActivePlayerIds(state, activePlayerIds);
  if (active.size === 0 && activePlayerIds !== undefined) return;
  if (state.phase === 'won' || state.phase === 'lost') { state.carryMs = 0; return; }
  if (active.size === 0) {
    finishActionRunAsLost(state, '远征失败；战场上没有可用的队友。');
    return;
  }
  if (!state.players.some(player => active.has(player.id) && player.alive)) {
    finishActionRunAsLost(state, '远征失败；当前在场队友已全部倒下，暂离队友不能继续战斗。');
    return;
  }
  if (state.paused) { state.carryMs = 0; return; }
  state.projectiles = state.projectiles.filter(shot => shot.faction !== 'players' || active.has(shot.owner));
  const ms = state.carryMs + Math.round(elapsedMs);
  const steps = Math.floor(ms / ACTION_STEP_MS);
  state.carryMs = ms % ACTION_STEP_MS;
  for (let index = 0; index < steps; index++) {
    if (isTerminalActionState(state)) break;
    stepOne(state, active);
  }
  if (isTerminalActionState(state)) state.carryMs = 0;
}

export function addActionPlayer(state: ActionState, id: string): void {
  if (typeof id !== 'string' || !PLAYER_IDS.test(id)) throw new Error('玩家编号无效');
  if (state.players.some(player => player.id === id)) throw new Error('玩家已经在本局中');
  if (state.players.length >= ACTION_MAX_PLAYERS) throw new Error('队伍人数已满');
  if (state.phase === 'won' || state.phase === 'lost') throw new Error('结束的战斗不能加入玩家');
  const index = state.players.length;
  const player = makePlayer(id, state.players[0]?.weapon ?? 'wand', 78, 270 + (index - (state.players.length - 1) / 2) * 26);
  const spawn = freeSpawn(state, player, PLAYER_RADIUS);
  player.x = spawn.x; player.y = spawn.y; player.targetX = spawn.x; player.targetY = spawn.y;
  state.players.push(player);
  state.notice = `${id} 加入队伍。`;
  if (state.phase === 'upgrade') for (const enemy of state.enemies) enemy.maxHp = enemy.hp = Math.round(enemy.maxHp * 1.12);
}

export function removeActionPlayer(state: ActionState, id: string): void {
  const index = state.players.findIndex(player => player.id === id);
  if (index < 0) throw new Error('玩家不在当前战斗中');
  state.players.splice(index, 1);
  state.projectiles = state.projectiles.filter(shot => shot.owner !== id);
  for (const player of state.players) if (player.lockedEnemy && !state.enemies.some(enemy => enemy.id === player.lockedEnemy && enemy.hp > 0)) player.lockedEnemy = null;
  if (!state.players.length) {
    state.phase = 'lost'; state.enemies = []; state.projectiles = []; state.telegraphs = []; state.upgradeChoices = [];
    state.notice = '队伍无人留在战场；已获得奖励保留在本局账本。';
  } else state.notice = `${id} 离开队伍。`;
}
