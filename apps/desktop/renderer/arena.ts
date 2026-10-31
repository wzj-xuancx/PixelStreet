import artManifest from '../../../assets/action/manifest.json';
import {
  ACTION_LEVELS,
  ACTION_STEP_MS,
  ACTION_UPGRADES,
  type ActionInput,
  type ActionState,
  type EnemyState,
  type Obstacle,
  type PlayerState,
  type ProjectileState,
  type UpgradeId,
  type Weapon,
} from '../../../packages/action-core';
import type { ShellState, StreetAPI } from '../../../packages/protocol';

declare global { interface Window { street: StreetAPI } }

type Frame = {
  x: number;
  y: number;
  width: number;
  height: number;
  worldSize: number[];
  anchor: number[];
};
type ArtManifest = {
  atlas: { file: string; width: number; height: number; frames: Record<string, Frame> };
  levels: Array<{ title: string; background: string }>;
};

const art = artManifest as ArtManifest;
const WORLD_WIDTH = 960;
const WORLD_HEIGHT = 540;
const BACKING_SCALE = 2;
const PLAYER_COLORS = ['#8edec7', '#c5a7f0', '#f0cd82', '#ed9a91'];
const WEAPONS: Array<{ id: Weapon; name: string; short: string; detail: string; tone: string }> = [
  { id: 'wand', name: '萤火法杖', short: '稳准 · 中程', detail: '单发魔弹，射程与速度均衡。', tone: 'teal' },
  { id: 'bow', name: '裂晶长弓', short: '强力 · 远程', detail: '蓄势较久，箭矢伤害高、飞得远。', tone: 'violet' },
  { id: 'scatter', name: '遗迹散射器', short: '扇射 · 近程', detail: '近距离三枚散弹，同时覆盖一片区域。', tone: 'gold' },
];
const levelMeta = [
  { title: '萤石荒径', palette: 'teal' },
  { title: '裂晶洞', palette: 'violet' },
  { title: '遗迹深廊', palette: 'gold' },
];
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const secondsUntil = (readyTick: number, tick: number): number => Math.max(0, (readyTick - tick) * ACTION_STEP_MS / 1000);
const fmtCooldown = (value: number): string => value > 0 ? `${value.toFixed(1)}s` : '就绪';

export async function arenaPage(): Promise<void> {
  document.body.classList.add('arena');
  if (!document.querySelector<HTMLLinkElement>('link[data-arena-style]')) {
    const style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = 'arena.css';
    style.dataset.arenaStyle = 'true';
    document.head.append(style);
  }

  const root = $('root');
  root.innerHTML = `
    <main class="arena-shell" aria-label="地下远征">
      <header class="arena-header">
        <div class="arena-heading">
          <span class="arena-mark" aria-hidden="true">✦</span>
          <div><strong>地下远征</strong><small>WASD 走位 · 鼠标瞄准</small></div>
        </div>
        <div class="arena-stats" aria-live="polite">
          <span id="arenaLevel" class="arena-chip">准备出发</span>
          <span id="arenaWave" class="arena-chip muted">三段远征</span>
          <span class="arena-health"><i aria-hidden="true">♥</i><span id="arenaHp">—</span><span class="arena-health-track"><b id="arenaHpFill"></b></span></span>
          <span class="arena-chip resource"><i class="coin-dot" aria-hidden="true">◆</i><span id="arenaCoins">0</span></span>
          <span class="arena-chip resource"><i class="xp-dot" aria-hidden="true">✦</i><span id="arenaXp">0</span></span>
        </div>
        <nav class="arena-header-actions" aria-label="远征操作">
          <button id="arenaPause" type="button" class="arena-icon-button" aria-label="继续战斗" title="继续战斗">Ⅱ</button>
          <button id="arenaClose" type="button" class="arena-quiet-button" title="暂停并暂时离开">暂离</button>
          <button id="arenaReturn" type="button" class="arena-quiet-button return" title="立即结算并返回营地">回营结算</button>
        </nav>
      </header>

      <section class="arena-world-wrap" aria-label="战斗场地">
        <canvas id="arenaCanvas" width="1920" height="1080" role="img" aria-label="地下远征战斗画面；WASD 移动，按住鼠标左键朝指针射击，右键或 Shift 翻滚，Q 和 E 使用技能，Esc 暂停。"></canvas>
        <div id="arenaTeam" class="arena-team" hidden aria-live="polite"></div>
        <div id="arenaNotice" class="arena-world-notice" aria-live="polite"></div>
        <div id="arenaLoading" class="arena-scrim compact" hidden><div class="arena-dialog"><span class="arena-spinner" aria-hidden="true"></span><strong>正在准备远征</strong><p>载入本地战斗状态…</p></div></div>
        <div id="arenaProblem" class="arena-scrim" hidden><div class="arena-dialog"><span class="arena-kicker">战斗暂不可用</span><h2>无法进入远征</h2><p id="arenaProblemText"></p><button id="arenaProblemClose" type="button" class="arena-button secondary">返回营地</button></div></div>

        <section id="arenaWelcome" class="arena-scrim">
          <div class="arena-dialog welcome-dialog">
            <div class="arena-kicker">萤石荒径 · 裂晶洞 · 遗迹深廊</div>
            <h1>整装，深入地下</h1>
            <p id="arenaWelcomeCopy" class="welcome-copy">三关主动冒险。WASD 移动，按住左键朝指针射击；右键或 Shift 翻滚，Q/E 使用技能，Esc 暂停。</p>
            <div id="arenaWaiting" class="arena-waiting" hidden><strong id="arenaWaitTitle"></strong><p id="arenaWaitCopy"></p></div>
            <div id="arenaWeaponGrid" class="weapon-grid" role="group" aria-label="选择武器">
              ${WEAPONS.map((weapon, index) => `<button class="weapon-card${index === 0 ? ' selected' : ''}" type="button" data-weapon="${weapon.id}" aria-pressed="${index === 0}">
                <canvas class="weapon-preview" data-preview="weapon-${weapon.id}" width="72" height="72" aria-hidden="true"></canvas>
                <span class="weapon-text"><strong>${weapon.name}</strong><small>${weapon.short}</small><span>${weapon.detail}</span></span>
              </button>`).join('')}
            </div>
            <div id="arenaWelcomeControls" class="welcome-controls"><span><b>WASD</b> 移动</span><span><b>按住左键</b> 瞄准射击</span><span><b>右键 / Shift</b> 翻滚</span><span><b>Q / E</b> 技能</span><span><b>Esc</b> 暂停</span></div>
            <div class="welcome-actions"><button id="arenaStart" type="button" class="arena-button primary">开始冒险 <span aria-hidden="true">→</span></button><small>暂离或切换窗口时自动暂停。</small></div>
          </div>
        </section>

        <section id="arenaPaused" class="arena-scrim" hidden>
          <div class="arena-dialog pause-dialog">
            <div class="arena-pause-glyph" aria-hidden="true">Ⅱ</div>
            <div class="arena-kicker">远征暂歇</div>
            <h2>洞穴安静了一会儿</h2>
            <p id="arenaPauseCopy">战斗已暂停。准备好后继续。</p>
            <button id="arenaContinue" type="button" class="arena-button primary">继续冒险 <span aria-hidden="true">→</span></button>
            <small>离开窗口也会自动暂停。</small>
          </div>
        </section>

        <section id="arenaUpgrade" class="arena-scrim" hidden>
          <div class="arena-dialog upgrade-dialog">
            <div class="arena-kicker">第 <span id="arenaUpgradeStage">2</span> 段 · 关间整备</div>
            <h2>带上一枚符文</h2>
            <p id="arenaUpgradeCopy">选择一项在本次远征持续生效的强化，再进入下一处遗迹。</p>
            <div id="arenaUpgradeCards" class="upgrade-grid">
              <button class="upgrade-card" type="button" data-upgrade=""><span class="upgrade-glyph">✦</span><span><strong class="upgrade-name"></strong><small class="upgrade-detail"></small></span><span class="upgrade-arrow">→</span></button>
              <button class="upgrade-card" type="button" data-upgrade=""><span class="upgrade-glyph">◈</span><span><strong class="upgrade-name"></strong><small class="upgrade-detail"></small></span><span class="upgrade-arrow">→</span></button>
              <button class="upgrade-card" type="button" data-upgrade=""><span class="upgrade-glyph">⌁</span><span><strong class="upgrade-name"></strong><small class="upgrade-detail"></small></span><span class="upgrade-arrow">→</span></button>
            </div>
            <small>选择会立即开启下一段；暂停时请先点击“继续冒险”。</small>
          </div>
        </section>

        <section id="arenaResult" class="arena-scrim" hidden>
          <div class="arena-dialog result-dialog">
            <div id="arenaResultGlyph" class="result-glyph" aria-hidden="true">✦</div>
            <div id="arenaResultKicker" class="arena-kicker">远征结束</div>
            <h2 id="arenaResultTitle">战利品已整理</h2>
            <p id="arenaResultCopy"></p>
            <div class="result-reward-row"><span>本次远征</span><strong><i class="coin-dot" aria-hidden="true">◆</i><b id="arenaRunCoins">0</b> 金币 <i class="xp-dot" aria-hidden="true">✦</i><b id="arenaRunXp">0</b> 经验</strong></div>
            <div class="result-reward-row total"><span>营地累计</span><strong><b id="arenaTotalCoins">0</b> 金币 <b id="arenaTotalXp">0</b> 经验</strong></div>
            <div class="result-actions"><button id="arenaClaim" type="button" class="arena-button primary">领取奖励</button><button id="arenaResultReturn" type="button" class="arena-button secondary">回营结算</button><button id="arenaRestart" type="button" class="arena-button text-button">再开一局</button></div>
            <small id="arenaSettledNote">奖励会带回营地。</small>
          </div>
        </section>
      </section>

      <footer class="arena-footer">
        <div class="arena-skills" aria-label="战斗技能">
          <button id="arenaNova" type="button" class="skill-button nova" title="星爆脉冲：对周围敌人造成范围伤害。">
            <span class="skill-glyph" aria-hidden="true">✦</span><span><strong>星爆脉冲</strong><small id="arenaNovaCd">范围伤害</small></span><kbd>Q</kbd>
          </button>
          <button id="arenaWard" type="button" class="skill-button ward" title="守望结界：获得临时护盾。">
            <span class="skill-glyph" aria-hidden="true">◉</span><span><strong>守望结界</strong><small id="arenaWardCd">临时护盾</small></span><kbd>E</kbd>
          </button>
        </div>
        <div class="arena-hints"><span><b>WASD</b> 移动 · <b>按住左键</b> 瞄准</span><span><b>右键 / Shift</b> 翻滚</span><span><b>Q/E</b> 技能 · <b>Esc</b> 暂停</span><span id="arenaNoticeFooter">击败 0 个敌人</span></div>
        <div id="arenaError" class="arena-error" role="alert" aria-live="assertive"></div>
      </footer>
    </main>`;

  const canvas = $('arenaCanvas') as HTMLCanvasElement;
  const canvasContext = canvas.getContext('2d', { alpha: false });
  if (!canvasContext) throw new Error('当前环境无法建立战斗画布。');
  const ctx: CanvasRenderingContext2D = canvasContext;
  ctx.imageSmoothingEnabled = false;

  let state: ShellState | undefined;
  let atlas: HTMLImageElement | undefined;
  const backgrounds: Array<HTMLImageElement | undefined> = [];
  let selectedWeapon: Weapon = 'wand';
  let lastRoomWeapon: Weapon | undefined;
  function selectWeapon(weapon:Weapon):void {
    selectedWeapon=weapon;
    document.querySelectorAll<HTMLButtonElement>('[data-weapon]').forEach(card=>{const selected=card.dataset.weapon===weapon;card.classList.toggle('selected',selected);card.setAttribute('aria-pressed',String(selected));});
  }
  let pointer: { x: number; y: number; inside: boolean } = { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2, inside: false };
  let aimPoint: { x: number; y: number } = { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 };
  let heldKeys = new Set<string>();
  let firingPointerId: number | undefined;
  let pendingControl: ActionInput | undefined;
  let controlTimer = 0;
  let controlInFlight = false;
  let lastControlSentAt = 0;
  let lastDashAt = 0;
  let hoverEnemyId: string | undefined;
  let raf = 0;
  let lastDrawAt = 0;
  let localError = '';
  let localErrorUntil = 0;
  let windowFocused = document.hasFocus();
  let unsubscribe: (() => void) | undefined;
  let disposed = false;

  function loadImage(path: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`无法载入本地美术资源：${path}`));
      image.src = new URL(path, document.baseURI).href;
    });
  }

  function showError(message: string): void {
    localError = message;
    localErrorUntil = performance.now() + 4500;
    syncError();
    window.setTimeout(() => { if (performance.now() >= localErrorUntil) syncError(); }, 4550);
  }

  function syncError(): void {
    if (!canRender()) return;
    const sessionError = state?.action.status === 'blocked' ? state.action.error : '';
    const warnings = state?.action.warnings?.length ? state.action.warnings.join(' · ') : '';
    const visibleLocal = performance.now() < localErrorUntil ? localError : '';
    $('arenaError').textContent = visibleLocal || sessionError || warnings;
  }

  function canRender(): boolean {
    return !disposed && windowFocused && document.visibilityState !== 'hidden' && state?.mode !== 'hidden';
  }

  function localActionPlayer(): PlayerState | undefined {
    const run = state?.action.run;
    return run?.players.find(player => player.id === state?.action.localPlayerId);
  }

  function combatInputAvailable(allowPaused = false): boolean {
    const run = state?.action.run;
    const player = localActionPlayer();
    return canRender() && !!run && run.phase === 'playing' && (allowPaused || !run.paused) && !!player?.alive;
  }

  function controlSnapshot(): ActionInput {
    const moveX = (heldKeys.has('KeyD') ? 1 : 0) - (heldKeys.has('KeyA') ? 1 : 0);
    const moveY = (heldKeys.has('KeyS') ? 1 : 0) - (heldKeys.has('KeyW') ? 1 : 0);
    return { type: 'control', moveX, moveY, aimX: aimPoint.x, aimY: aimPoint.y, firing: firingPointerId !== undefined };
  }

  async function flushControl(): Promise<void> {
    controlTimer = 0;
    if (controlInFlight || !pendingControl) return;
    const input = pendingControl;
    pendingControl = undefined;
    controlInFlight = true;
    lastControlSentAt = performance.now();
    await sendInput(input);
    controlInFlight = false;
    if (pendingControl) queueCombatControl();
  }

  function queueCombatControl(immediate = false): void {
    if (!combatInputAvailable()) return;
    pendingControl = controlSnapshot();
    if (controlInFlight) return;
    if (controlTimer) window.clearTimeout(controlTimer);
    const delay = immediate ? 0 : Math.max(0, 40 - (performance.now() - lastControlSentAt));
    controlTimer = window.setTimeout(() => { void flushControl(); }, delay);
  }

  function clearHeldCombatInput(sendNeutral: boolean): void {
    const capturedPointerId = firingPointerId;
    heldKeys.clear();
    firingPointerId = undefined;
    pendingControl = undefined;
    if (controlTimer) window.clearTimeout(controlTimer);
    controlTimer = 0;
    if (capturedPointerId !== undefined) {
      try {
        if (canvas.hasPointerCapture(capturedPointerId)) canvas.releasePointerCapture(capturedPointerId);
      } catch { /* pointer capture may already have been released by the platform */ }
    }
    if (!sendNeutral) return;
    const player = localActionPlayer();
    const run = state?.action.run;
    if (player && run) {
      void sendInput({ type: 'control', moveX: 0, moveY: 0, aimX: aimPoint.x, aimY: aimPoint.y, firing: false });
    }
    updateWorldCursor();
    draw();
  }

  function isTextEntryTarget(target: EventTarget | null): boolean {
    const element = target instanceof Element ? target : null;
    const active = document.activeElement instanceof Element ? document.activeElement : null;
    const isTextEntry = (candidate: Element | null): boolean => {
      if (!candidate) return false;
      if (candidate.closest('textarea, select, [role="textbox"], [contenteditable]:not([contenteditable="false"])')) return true;
      const input = candidate.closest('input') as HTMLInputElement | null;
      return !!input && !['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'file', 'image', 'hidden'].includes(input.type);
    };
    return isTextEntry(element) || isTextEntry(active);
  }

  function heldMoveKey(code: string): boolean {
    return code === 'KeyW' || code === 'KeyA' || code === 'KeyS' || code === 'KeyD';
  }

  function dashToward(target: { x: number; y: number }): void {
    if (!combatInputAvailable()) return;
    const player = localActionPlayer();
    if (!player) return;
    const dx = target.x - player.x, dy = target.y - player.y;
    const length = Math.hypot(dx, dy);
    if (length < 1) return;
    const destination = {
      x: clamp(player.x + dx / length * 148, 0, WORLD_WIDTH),
      y: clamp(player.y + dy / length * 148, 0, WORLD_HEIGHT),
    };
    const now = performance.now();
    if (now - lastDashAt < 120) return;
    lastDashAt = now;
    void sendInput({ type: 'dash', ...destination });
  }

  function sprite(name: string, x: number, y: number, rotation = 0, scale = 1): void {
    const frame = art.atlas.frames[name];
    if (!atlas || !frame) return;
    const width = frame.worldSize[0] * scale;
    const height = frame.worldSize[1] * scale;
    const left = -frame.anchor[0] * width;
    const top = -frame.anchor[1] * height;
    ctx.save();
    ctx.translate(x, y);
    if (rotation) ctx.rotate(rotation);
    ctx.drawImage(atlas, frame.x, frame.y, frame.width, frame.height, left, top, width, height);
    ctx.restore();
  }

  function drawHealthBar(x: number, y: number, width: number, hp: number, maxHp: number, color: string): void {
    const ratio = clamp(hp / Math.max(1, maxHp), 0, 1);
    ctx.fillStyle = '#171a22dc';
    ctx.fillRect(x - width / 2 - 1, y - 1, width + 2, 6);
    ctx.fillStyle = '#40444a';
    ctx.fillRect(x - width / 2, y, width, 4);
    ctx.fillStyle = color;
    ctx.fillRect(x - width / 2, y, Math.ceil(width * ratio), 4);
    ctx.fillStyle = '#ffffff60';
    ctx.fillRect(x - width / 2, y, Math.ceil(width * ratio), 1);
  }

  function drawTelegraphs(run: ActionState): void {
    for (const warning of run.telegraphs) {
      const life = clamp((warning.expiresAt - run.tick) / 20, 0.16, 1);
      ctx.save();
      ctx.globalAlpha = 0.35 + life * 0.3;
      ctx.lineCap = 'butt';
      ctx.strokeStyle = warning.kind === 'charge' ? '#f3a76d' : '#ffcf7f';
      ctx.fillStyle = warning.kind === 'charge' ? '#c96d5838' : '#d99b5432';
      ctx.lineWidth = warning.kind === 'charge' ? Math.max(12, warning.radius * 1.5) : 2;
      ctx.setLineDash([9, 7]);
      if (warning.kind === 'charge') {
        ctx.beginPath();
        ctx.moveTo(warning.x, warning.y);
        ctx.lineTo(warning.targetX, warning.targetY);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.strokeStyle = '#ffd49d';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(warning.x, warning.y);
        ctx.lineTo(warning.targetX, warning.targetY);
        ctx.stroke();
      } else if (warning.kind === 'boss-fan') {
        const angle = Math.atan2(warning.targetY - warning.y, warning.targetX - warning.x);
        const spread = 0.7;
        ctx.beginPath();
        ctx.moveTo(warning.x, warning.y);
        ctx.arc(warning.x, warning.y, Math.max(90, warning.radius), angle - spread, angle + spread);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(warning.targetX, warning.targetY, Math.max(34, warning.radius), 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(warning.targetX - 14, warning.targetY);
        ctx.lineTo(warning.targetX + 14, warning.targetY);
        ctx.moveTo(warning.targetX, warning.targetY - 14);
        ctx.lineTo(warning.targetX, warning.targetY + 14);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  function drawEffects(run: ActionState): void {
    for (const effect of run.effects) {
      const remaining = clamp((effect.expiresAt - run.tick) / 24, 0.1, 1);
      ctx.save();
      if (effect.kind === 'dash') {
        ctx.globalAlpha = 0.58 * remaining;
        ctx.strokeStyle = '#dbffff';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(effect.fromX, effect.fromY);
        ctx.lineTo(effect.toX, effect.toY);
        ctx.stroke();
        sprite('effect-roll-echo', effect.x, effect.y, 0, 0.9);
      } else if (effect.kind === 'nova') {
        const radius = Math.max(22, effect.radius * (1.12 - remaining * 0.12));
        ctx.globalAlpha = 0.18 + remaining * 0.18;
        ctx.fillStyle = '#abf4e6';
        ctx.beginPath();
        ctx.arc(effect.x, effect.y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.85 * remaining;
        ctx.strokeStyle = '#c8fff0';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(effect.x, effect.y, radius, 0, Math.PI * 2);
        ctx.stroke();
      } else if (effect.kind === 'ward') {
        ctx.globalAlpha = 0.48 * remaining;
        ctx.strokeStyle = '#9fe3e8';
        ctx.lineWidth = 3;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.arc(effect.x, effect.y, Math.max(22, effect.radius), 0, Math.PI * 2);
        ctx.stroke();
      } else if (effect.kind === 'hit') {
        ctx.globalAlpha = remaining;
        sprite('effect-impact', effect.x, effect.y, 0, clamp(effect.radius / 15, 0.8, 1.2));
      } else if (effect.kind === 'charge') {
        ctx.globalAlpha = 0.5 * remaining;
        ctx.strokeStyle = '#ffd086';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(effect.x, effect.y, Math.max(24, effect.radius), 0, Math.PI * 2);
        ctx.stroke();
      } else if (effect.kind === 'boss-phase') {
        ctx.globalAlpha = 0.42 * remaining;
        ctx.strokeStyle = '#f3d585';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(effect.x, effect.y, Math.max(38, effect.radius), 0, Math.PI * 2);
        ctx.stroke();
        sprite('objective-impact', effect.x, effect.y, 0, 1.1);
      } else if (effect.kind === 'stage-clear') {
        ctx.globalAlpha = 0.5 * remaining;
        ctx.strokeStyle = '#d9edb0';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(effect.x, effect.y, Math.max(38, effect.radius), 0, Math.PI * 2);
        ctx.stroke();
      } else if (effect.kind === 'death') {
        ctx.globalAlpha = remaining * 0.4;
        ctx.fillStyle = '#e5c3a0';
        ctx.beginPath();
        ctx.arc(effect.x, effect.y, Math.max(18, effect.radius), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  function drawProjectile(projectile: ProjectileState): void {
    if (projectile.faction === 'enemies') {
      const bossShot = projectile.style === 'boss';
      ctx.save();
      ctx.translate(projectile.x, projectile.y);
      ctx.globalAlpha = 0.85;
      ctx.shadowColor = bossShot ? '#ffd184' : '#e99a83';
      ctx.shadowBlur = bossShot ? 12 : 7;
      ctx.fillStyle = bossShot ? '#f6d58a' : '#ef988a';
      ctx.beginPath();
      ctx.arc(0, 0, Math.max(projectile.radius, bossShot ? 7 : 5), 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#fff2cd';
      ctx.fillRect(-2, -2, 4, 4);
      ctx.restore();
      return;
    }
    const frame = projectile.style === 'arrow' ? 'projectile-arrow' : projectile.style === 'pellet' ? 'projectile-scatter' : 'projectile-wand';
    const rotation = projectile.style === 'arrow' ? Math.atan2(projectile.vy, projectile.vx) : 0;
    sprite(frame, projectile.x, projectile.y, rotation, projectile.style === 'arrow' ? 0.8 : 0.75);
  }

  function drawObstacle(obstacle: Obstacle, index: number, stage: number): void {
    const cracked = stage > 0 && index % 2 === 1;
    const x = obstacle.x, y = obstacle.y, w = obstacle.width, h = obstacle.height;
    const palette = stage === 0
      ? { shadow: '#253a3e', face: '#536c66', light: '#9db5a0', top: '#728e80' }
      : stage === 1
        ? { shadow: '#2f2a43', face: '#625879', light: '#b7a5db', top: '#81769c' }
        : { shadow: '#3b3427', face: '#746347', light: '#c8b27b', top: '#9c8757' };
    ctx.save();
    ctx.fillStyle = '#17192170';
    ctx.fillRect(x + 5, y + 6, w, h);
    ctx.fillStyle = palette.shadow;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = palette.face;
    ctx.fillRect(x + 3, y + 3, Math.max(1, w - 6), Math.max(1, h - 6));
    ctx.fillStyle = palette.top;
    ctx.fillRect(x + 4, y + 4, Math.max(1, w - 8), 6);
    ctx.fillStyle = palette.light;
    ctx.fillRect(x + 4, y + 4, 4, Math.max(5, h - 8));
    ctx.fillStyle = '#11162140';
    for (let bx = x + 12; bx < x + w - 8; bx += 24) {
      ctx.fillRect(bx, y + 12, 2, Math.max(4, h - 20));
      ctx.fillRect(bx + 7, y + 18, 5, 2);
    }
    if (cracked) {
      ctx.strokeStyle = palette.light;
      ctx.globalAlpha = 0.8;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + w * 0.52, y + 10);
      ctx.lineTo(x + w * 0.43, y + h * 0.38);
      ctx.lineTo(x + w * 0.58, y + h * 0.55);
      ctx.lineTo(x + w * 0.46, y + h - 10);
      ctx.stroke();
    }
    sprite(cracked ? 'obstacle-column-cracked' : 'obstacle-column', x + w / 2, y + h - 2, 0, clamp(Math.min(w / 42, h / 54), 0.72, 1.15));
    ctx.restore();
  }

  function playerFacing(player: PlayerState, run: ActionState): { direction: string; moving: boolean } {
    let dx = player.targetX - player.x, dy = player.targetY - player.y;
    const locked = player.lockedEnemy ? run.enemies.find(enemy => enemy.id === player.lockedEnemy && enemy.hp > 0) : undefined;
    const hasMoveInput = player.moveX !== 0 || player.moveY !== 0;
    if (player.firing) { dx = player.aimX - player.x; dy = player.aimY - player.y; }
    else if (hasMoveInput) { dx = player.moveX; dy = player.moveY; }
    else if (locked) { dx = locked.x - player.x; dy = locked.y - player.y; }
    const moving = !locked && (hasMoveInput || player.path.length > 0 || !player.firing && Math.hypot(dx, dy) > 4);
    let direction = 'down';
    if (Math.abs(dx) > Math.abs(dy)) direction = dx < 0 ? 'left' : 'right';
    else if (Math.abs(dy) > 0.1) direction = dy < 0 ? 'up' : 'down';
    return { direction, moving };
  }

  function enemyFrame(enemy: EnemyState, run: ActionState): string {
    if (enemy.kind === 'chaser') return run.tick % 10 < 5 ? 'enemy-slime-idle' : 'enemy-slime-squash';
    if (enemy.kind === 'shooter') return 'enemy-mage';
    if (enemy.kind === 'charger') return enemy.windupUntil > run.tick ? 'enemy-beast-charge' : 'enemy-beast-idle';
    if (enemy.windupUntil > run.tick || run.telegraphs.some(item => item.kind !== 'charge' && item.x === enemy.x && item.y === enemy.y)) return 'boss-telegraph';
    if (run.effects.some(item => item.kind === 'hit' && Math.hypot(item.x - enemy.x, item.y - enemy.y) < 18 && item.expiresAt - run.tick > 2)) return 'boss-hit';
    return 'boss-idle';
  }

  function drawActor(run: ActionState, actor: PlayerState | EnemyState, isPlayer: boolean, localPlayerId?: string): void {
    const local = isPlayer && actor.id === localPlayerId;
    if (isPlayer) {
      const player = actor as PlayerState;
      if (!player.alive) return;
      const playerIndex = run.players.findIndex(item => item.id === player.id);
      const color = PLAYER_COLORS[Math.max(0, playerIndex) % PLAYER_COLORS.length];
      const { direction, moving } = playerFacing(player, run);
      const name = `player-${direction}-${moving ? 'walk' : 'idle'}`;
      if (player.shield > 0 && player.shieldUntil > run.tick) {
        ctx.save();
        ctx.globalAlpha = 0.32;
        sprite('player-aura', player.x, player.y + 12, 0, 1.05);
        ctx.globalAlpha = 0.8;
        ctx.strokeStyle = '#a9eff1';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(player.x, player.y - 7, 26, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      if (player.invulnerableUntil > run.tick && run.tick % 3 === 0) ctx.globalAlpha = 0.48;
      sprite(name, player.x, player.y + 6, 0, local ? 1 : 0.92);
      ctx.globalAlpha = 1;
      sprite(`weapon-${player.weapon}`, player.x + 15, player.y - 10, 0, 0.55);
      ctx.save();
      ctx.strokeStyle = color;
      ctx.globalAlpha = local ? 0.95 : 0.72;
      ctx.lineWidth = local ? 2 : 1.5;
      ctx.beginPath();
      ctx.ellipse(player.x, player.y + 11, 24, 8, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      if (run.players.length > 1 || state?.room.role !== 'none') {
        const rawName = state?.room.members.find(member => member.id === player.id)?.name ?? (local ? '你' : `队友${Math.max(1, playerIndex + 1)}`);
        const name = Array.from(rawName).slice(0, 9).join('') + (Array.from(rawName).length > 9 ? '…' : '');
        ctx.save();
        ctx.font = '10px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const width = Math.ceil(ctx.measureText(name).width) + 8;
        ctx.fillStyle = '#10191edb';
        ctx.fillRect(player.x - width / 2, player.y - 30, width, 14);
        ctx.fillStyle = color;
        ctx.fillText(name, player.x, player.y - 23);
        ctx.restore();
      }
      return;
    }

    const enemy = actor as EnemyState;
    if (enemy.hp <= 0) return;
    const selected = enemy.id === hoverEnemyId || enemy.id === localPlayer?.lockedEnemy;
    if (selected) {
      ctx.save();
      ctx.strokeStyle = enemy.kind === 'boss' ? '#ffe2a4' : '#e8f4c0';
      ctx.lineWidth = enemy.kind === 'boss' ? 2.5 : 2;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.ellipse(enemy.x, enemy.y + enemy.radius * 0.58, enemy.radius + 7, Math.max(8, enemy.radius * 0.5), 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    if (enemy.kind === 'boss' && enemy.bossPhase > 1) {
      ctx.save();
      ctx.globalAlpha = 0.3;
      ctx.strokeStyle = enemy.bossPhase === 2 ? '#ffc77c' : '#ff9276';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(enemy.x, enemy.y - 8, 40 + enemy.bossPhase * 3, -0.6, Math.PI * 1.6);
      ctx.stroke();
      ctx.restore();
    }
    // Atlas cells include transparent margins. Keep the visible body close to its
    // interaction target instead of shrinking small enemies twice.
    const enemyScale = enemy.kind === 'chaser' ? 1.6 : enemy.kind === 'boss' ? 1 : 1.15;
    sprite(enemyFrame(enemy, run), enemy.x, enemy.y + enemy.radius * 0.44, 0, enemyScale);
    if (selected || enemy.kind === 'boss' || enemy.kind === 'charger' && enemy.windupUntil > run.tick) {
      drawHealthBar(enemy.x, enemy.y - enemy.radius - 14, enemy.kind === 'boss' ? 76 : 38, enemy.hp, enemy.maxHp, enemy.kind === 'boss' ? '#e4c57c' : '#d9877a');
    }
    if (enemy.kind === 'boss') {
      ctx.save();
      ctx.font = '9px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#f2ddae';
      ctx.fillText(`阶段 ${enemy.bossPhase}`, enemy.x, enemy.y - enemy.radius - 20);
      ctx.restore();
    }
  }

  let localPlayer: PlayerState | undefined;
  function drawCursorMarker(): void {
    if (!pointer.inside && firingPointerId === undefined) return;
    if (hoverEnemyId) {
      const enemy = state?.action.run?.enemies.find(item => item.id === hoverEnemyId && item.hp > 0);
      if (enemy) {
        ctx.save();
        ctx.strokeStyle = '#fff0be';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(enemy.x, enemy.y, enemy.radius + 12, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        return;
      }
    }
    ctx.save();
    ctx.globalAlpha = firingPointerId === undefined ? 0.45 : 0.9;
    ctx.strokeStyle = firingPointerId === undefined ? '#d8f7db' : '#fff0be';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(aimPoint.x, aimPoint.y, firingPointerId === undefined ? 8 : 11, 0, Math.PI * 2);
    ctx.moveTo(aimPoint.x - 15, aimPoint.y);
    ctx.lineTo(aimPoint.x + 15, aimPoint.y);
    ctx.moveTo(aimPoint.x, aimPoint.y - 15);
    ctx.lineTo(aimPoint.x, aimPoint.y + 15);
    ctx.stroke();
    ctx.restore();
  }

  function draw(run = state?.action.run ?? null): void {
    if (!ctx || !canRender()) return;
    document.body.dataset.arenaFrames=String(Number(document.body.dataset.arenaFrames??0)+1);
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(BACKING_SCALE, 0, 0, BACKING_SCALE, 0, 0);
    const stage = run?.stage ?? 0;
    const background = backgrounds[stage];
    if (background) ctx.drawImage(background, 0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    else {
      ctx.fillStyle = ['#263b3a', '#312a48', '#403928'][stage] ?? '#263b3a';
      ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    }
    if (!run) {
      sprite('portal-arch', 850, 286, 0, 1.15);
      sprite('objective-target-ring', 850, 300, 0, 1.1);
      return;
    }

    localPlayer = run.players.find(player => player.id === state?.action.localPlayerId);
    if (localPlayer) {
      ctx.save();
      ctx.globalAlpha = 0.3;
      sprite('player-aura', localPlayer.x, localPlayer.y + 14, 0, 1.1);
      ctx.restore();
    }

    drawTelegraphs(run);
    drawEffects(run);
    for (const shot of run.projectiles) drawProjectile(shot);

    const depthItems: Array<{ y: number; draw: () => void }> = [];
    run.obstacles.forEach((obstacle, index) => depthItems.push({ y: obstacle.y + obstacle.height, draw: () => drawObstacle(obstacle, index, run.stage) }));
    for (const enemy of run.enemies) depthItems.push({ y: enemy.y + enemy.radius, draw: () => drawActor(run, enemy, false) });
    for (const player of run.players) depthItems.push({ y: player.y + 14, draw: () => drawActor(run, player, true, localPlayer?.id) });
    depthItems.sort((left, right) => left.y - right.y);
    for (const item of depthItems) item.draw();

    for (const effect of run.effects) {
      if (effect.kind === 'hit' && effect.expiresAt > run.tick) {
        ctx.save();
        ctx.globalAlpha = clamp((effect.expiresAt - run.tick) / 8, 0.18, 0.8);
        sprite('objective-impact', effect.x, effect.y, 0, 0.6);
        ctx.restore();
      }
    }
    drawCursorMarker();
  }

  function updateWorldCursor(): void {
    const run = state?.action.run;
    if (!run || run.phase !== 'playing' || run.paused || !pointer.inside) {
      hoverEnemyId = undefined;
      canvas.dataset.hoverEnemy = '';
      canvas.style.cursor = run?.paused ? 'default' : 'crosshair';
      return;
    }
    const candidate = nearestEnemy(pointer.x, pointer.y, run);
    hoverEnemyId = candidate?.id;
    canvas.dataset.hoverEnemy = candidate ? 'true' : '';
    canvas.style.cursor = 'crosshair';
  }

  function scheduleDraw(): void {
    if (disposed || raf || !windowFocused || document.visibilityState === 'hidden' || state?.mode === 'hidden') return;
    const run = state?.action.run;
    if (!run || run.paused || run.phase === 'won' || run.phase === 'lost') return;
    raf = requestAnimationFrame(onFrame);
  }

  function stopDrawLoop(): void {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  function onFrame(now: number): void {
    raf = 0;
    const run = state?.action.run;
    if (disposed || !windowFocused || document.visibilityState === 'hidden' || state?.mode === 'hidden' || !run || run.paused || run.phase !== 'playing') return;
    if (now - lastDrawAt >= 40) {
      draw(run);
      lastDrawAt = now;
    }
    scheduleDraw();
  }

  function syncLoop(): void {
    const run = state?.action.run;
    if (!run || run.paused || run.phase !== 'playing' || !windowFocused || document.visibilityState === 'hidden' || state?.mode === 'hidden') {
      stopDrawLoop();
      return;
    }
    scheduleDraw();
  }

  function setText(id: string, value: string | number): void { const element=$(id),text=String(value);if(element.textContent!==text)element.textContent=text; }

  function renderTeam(): void {
    const container = $('arenaTeam');
    const room = state?.room;
    if (!room || room.role === 'none') { container.hidden = true; return; }
    container.hidden = false;
    const signature = room.members.map(member => member.id).join('|');
    if (container.dataset.members !== signature) {
      container.replaceChildren();
      const heading = document.createElement('div');
      heading.className = 'arena-team-heading';
      const title = document.createElement('strong');
      title.className = 'arena-team-title';
      const count = document.createElement('span');
      count.className = 'arena-team-count';
      heading.append(title, count);
      const list = document.createElement('ul');
      list.className = 'arena-team-list';
      for (const member of room.members) {
        const item = document.createElement('li');
        item.className = 'arena-team-member';
        item.dataset.memberId = member.id;
        const dot = document.createElement('i');
        dot.className = 'arena-team-dot';
        dot.setAttribute('aria-hidden', 'true');
        const name = document.createElement('strong');
        name.className = 'arena-team-name';
        const detail = document.createElement('span');
        detail.className = 'arena-team-detail';
        item.append(dot, name, detail);
        list.append(item);
      }
      if (!room.members.length) {
        const empty = document.createElement('li');
        empty.className = 'arena-team-empty';
        empty.textContent = '等待房主成员状态';
        list.append(empty);
      }
      container.append(heading, list);
      container.dataset.members = signature;
    }
    const heading = container.querySelector<HTMLElement>('.arena-team-title');
    if (heading) heading.textContent = room.role === 'host' ? '你是房主' : '好友队伍';
    const count = container.querySelector<HTMLElement>('.arena-team-count');
    if (count) count.textContent = `${room.members.filter(member => member.online).length}/4在线`;
    for (const member of room.members) {
      const item = container.querySelector<HTMLElement>(`[data-member-id="${CSS.escape(member.id)}"]`);
      if (!item) continue;
      const player = state?.action.run?.players.find(candidate => candidate.id === member.id);
      const local = member.id === room.localPlayerId;
      const index = state?.action.run?.players.findIndex(candidate => candidate.id === member.id) ?? -1;
      const colorIndex = index >= 0 ? index : room.members.findIndex(candidate => candidate.id === member.id);
      item.classList.toggle('away', !member.active && member.online && !!room.runKey);
      item.classList.toggle('offline', !member.online);
      item.querySelector<HTMLElement>('.arena-team-dot')!.style.backgroundColor = PLAYER_COLORS[Math.max(0, colorIndex) % PLAYER_COLORS.length];
      item.querySelector<HTMLElement>('.arena-team-name')!.textContent = `${member.name}${local ? '（你）' : ''}${member.id === room.hostId ? ' · 房主' : ''}`;
      let detail = member.returned ? '已回营 · 等待下一局' : room.runKey && !member.inRun ? '晚到 · 等待下一局' : !member.online ? '离线' : room.runPhase === 'won' || room.runPhase === 'lost' ? '本局结束 · 等待下一局' : room.runKey && !member.active ? '在线 · 暂离' : room.runKey ? '在线 · 战斗中' : member.available ? '在线 · 可参加' : '在线 · 正在经营或结算';
      if (player) detail += ` · 生命 ${Math.max(0, Math.ceil(player.hp))}/${player.maxHp}`;
      item.querySelector<HTMLElement>('.arena-team-detail')!.textContent = detail;
    }
  }

  function renderHud(): void {
    const run = state?.action.run;
    const profile = state?.game.profile;
    if (!run) {
      setText('arenaLevel', '准备出发');
      setText('arenaWave', '三段远征');
      setText('arenaHp', '—');
      setText('arenaCoins', profile?.coins ?? 0);
      setText('arenaXp', profile?.xp ?? 0);
      $('arenaHpFill').style.width = '0%';
      $('arenaNotice').textContent = '';
      $('arenaNoticeFooter').textContent = 'WASD 移动 · 左键瞄准射击';
      ($('arenaNova') as HTMLButtonElement).disabled=true;($('arenaWard') as HTMLButtonElement).disabled=true;
      return;
    }
    const level = ACTION_LEVELS[run.stage];
    const player = run.players.find(item => item.id === state?.action.localPlayerId);
    setText('arenaLevel', `${levelMeta[run.stage]?.title ?? level.name}`);
    setText('arenaWave', `波次 ${Math.min(run.wave, level.waves.length)} / ${level.waves.length}`);
    setText('arenaHp', player ? `${Math.ceil(player.hp)} / ${player.maxHp}` : '—');
    $('arenaHpFill').style.width = `${player ? clamp(player.hp / Math.max(1, player.maxHp) * 100, 0, 100) : 0}%`;
    $('arenaHpFill').classList.toggle('low', !!player && player.hp / Math.max(1, player.maxHp) < 0.32);
    setText('arenaCoins', run.reward.coins);
    setText('arenaXp', run.reward.xp);
    $('arenaNotice').textContent = player ? run.notice : state?.room.role === 'guest' ? '等待房主同步本局数据。' : run.notice;
    $('arenaNoticeFooter').textContent = `${run.kills} 击败 · ${level.subtitle}`;
    const live = run.phase === 'playing' && !run.paused;
    const novaLeft = player ? secondsUntil(player.skillReady, run.tick) : 0;
    const wardLeft = player ? secondsUntil(player.shieldReady, run.tick) : 0;
    const dashLeft = player ? secondsUntil(player.dashReady, run.tick) : 0;
    const novaButton = $('arenaNova') as HTMLButtonElement;
    const wardButton = $('arenaWard') as HTMLButtonElement;
    novaButton.disabled = !live || novaLeft > 0 || !player?.alive;
    wardButton.disabled = !live || wardLeft > 0 || !player?.alive;
    setText('arenaNovaCd', novaLeft > 0 ? `冷却 ${fmtCooldown(novaLeft)}` : '范围伤害 · 就绪');
    setText('arenaWardCd', wardLeft > 0 ? `冷却 ${fmtCooldown(wardLeft)}` : `护盾${player?.shield ? ` ${Math.ceil(player.shield)}` : ''} · 就绪`);
    $('arenaCanvas').title = live ? `WASD 移动 · 按住左键瞄准射击 · 右键或 Shift 翻滚${dashLeft > 0 ? `（冷却 ${fmtCooldown(dashLeft)}）` : ''} · Q/E 技能 · Esc 暂停` : '战斗暂停';
  }

  function renderOverlays(): void {
    const session = state?.action;
    const run = session?.run ?? null;
    const room = state?.room;
    const roomGuest = room?.role === 'guest';
    const roomHost = room?.role === 'host';
    const localMember = room?.members.find(member => member.id === room.localPlayerId);
    const phase = run?.phase;
    const terminal = phase === 'won' || phase === 'lost';
    const paused = !!run?.paused && !terminal;
    const waitingForHost = roomGuest && !run && session?.status === 'ready';
    $('arenaWelcome').hidden = !!run || session?.status === 'loading' || session?.status === 'blocked';
    $('arenaLoading').hidden = session?.status !== 'loading' || !!run;
    const blocked = session?.status === 'blocked';
    $('arenaProblem').hidden = !blocked;
    if (blocked) setText('arenaProblemText', session?.error || '当前运行环境没有可用的本地战斗引擎。');
    $('arenaPaused').hidden = !paused;
    $('arenaUpgrade').hidden = !(phase === 'upgrade' && !paused);
    $('arenaResult').hidden = !terminal;
    $('arenaWaiting').hidden = !waitingForHost;
    $('arenaWeaponGrid').hidden = waitingForHost;
    $('arenaWelcomeControls').hidden = waitingForHost;
    $('arenaStart').hidden = waitingForHost;
    if (waitingForHost) {
      const late = !!room?.runKey && !!localMember && !localMember.inRun;
      setText('arenaWaitTitle', room?.status === 'reconnecting' ? '正在恢复连接' : room?.status === 'disconnected' ? '连接已断开' : late ? '本局名单已固定' : '等待房主开始下一局');
      setText('arenaWaitCopy', room?.status === 'reconnecting' ? '正在恢复你的房间身份；恢复后可继续参加下一局。' : room?.status === 'disconnected' ? '请回到营地好友房间查看连接状态。' : late ? '你加入得较晚，本局不会中途加入；房主开始下一局后即可出发。' : '已加入队伍。主动冒险由房主开始；已领取的本局奖励不能再次加入。');
    }
    setText('arenaWelcomeCopy', roomGuest
      ? '好友房间的主动冒险由房主开始；本局使用 WASD 移动、按住左键瞄准射击、右键或 Shift 翻滚、Q/E 使用技能。'
      : '三关主动冒险。WASD 移动，按住左键朝指针射击；右键或 Shift 翻滚，Q/E 使用技能，Esc 暂停。');
    const start = $('arenaStart') as HTMLButtonElement;
    start.disabled = roomGuest || roomHost && room?.status !== 'hosting';
    const startLabel = roomHost ? '开始队伍远征 →' : '开始冒险 →';
    if (start.textContent !== startLabel) start.textContent = startLabel;
    const upgradeGuest = roomGuest;
    setText('arenaUpgradeCopy', upgradeGuest ? '关间强化由房主统一选择。倒地队友会在下一关以半血起身，请等待房主完成整备。' : '选择一项在本次远征持续生效的强化，再进入下一处遗迹。倒地队友会在下一关以半血起身。');

    const pause = $('arenaPause') as HTMLButtonElement;
    pause.disabled = !run || terminal;
    pause.textContent = run?.paused ? '▶' : 'Ⅱ';
    pause.setAttribute('aria-label', run?.paused ? '继续战斗' : '暂停战斗');
    pause.title = run?.paused ? '继续战斗' : '暂停战斗';
    ($('arenaClose') as HTMLButtonElement).disabled = false;
    ($('arenaReturn') as HTMLButtonElement).disabled = !run;
    setText('arenaPauseCopy', phase === 'upgrade' ? '整备已经准备好。继续后即可选择本段强化。' : '战斗已暂停。准备好后继续。');
    setText('arenaUpgradeStage', Math.min(3, (run?.stage ?? 0) + 2));

    const upgradeButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.upgrade-card'));
    const choices = run?.upgradeChoices ?? [];
    upgradeButtons.forEach((button, index) => {
      const choice = choices[index] as UpgradeId | undefined;
      button.hidden = !choice;
      button.dataset.upgrade = choice ?? '';
      if (choice) {
        setElementText(button, '.upgrade-name', ACTION_UPGRADES[choice].name);
        setElementText(button, '.upgrade-detail', ACTION_UPGRADES[choice].detail);
      }
      button.disabled = upgradeGuest;
    });

    if (terminal && run) {
      const won = phase === 'won';
      $('arenaResultGlyph').textContent = won ? '✦' : '⌁';
      $('arenaResultGlyph').classList.toggle('lost', !won);
      setText('arenaResultKicker', won ? '远征完成' : '远征结束');
      setText('arenaResultTitle', won ? '遗迹已归于沉寂' : '冒险者需要整备');
      setText('arenaResultCopy', won
        ? `三处遗迹全部清理。击败 ${run.kills} 个敌人后安全撤出。`
        : `这次深入到${levelMeta[run.stage]?.title ?? '地下遗迹'}。战斗奖励已记录，可以带回营地。`);
      setText('arenaRunCoins', run.reward.coins);
      setText('arenaRunXp', run.reward.xp);
      setText('arenaTotalCoins', profileCoins());
      setText('arenaTotalXp', profileXp());
      const claim = $('arenaClaim') as HTMLButtonElement;
      claim.disabled = !!session?.settled;
      claim.textContent = session?.settled ? '奖励已领取' : '领取奖励';
      $('arenaResultReturn').textContent = session?.settled ? '返回营地' : '回营结算';
      ($('arenaRestart') as HTMLButtonElement).hidden = !session?.settled;
      const teamFinished=room?.runPhase==='won'||room?.runPhase==='lost';
      setText('arenaSettledNote', session?.settled
        ? roomGuest ? '本次奖励已结算；等待房主开始下一局。' : roomHost ? '本局奖励已结算；可以开始队伍下一局。' : '本局奖励已结算；可以重新出发或返回营地。'
        : roomGuest ? teamFinished ? '全队本局已结束，领取奖励后等待房主开始下一局。' : '领取后只结束你的参与，队友可继续本局。'
        : roomHost ? teamFinished ? '全队本局已结束，领取后可以开始下一局。' : '领取或回营会结束全队本局。'
        : '领取奖励留在本页，或回营结束本次远征。');
      const restart = $('arenaRestart') as HTMLButtonElement;
      restart.hidden = !session?.settled || roomGuest || roomHost && room?.status !== 'hosting';
      restart.textContent = roomHost ? '开始队伍下一局' : '再开一局';
    }
    if (paused) {
      const away = !!localMember && !localMember.active;
      setText('arenaPauseCopy', roomGuest || roomHost ? away ? '你已暂离；队友仍可继续。全员暂离时本局暂停，回来后点继续即可。' : '你目前在线；个人暂离只影响自己，全员暂离时本局暂停。' : phase === 'upgrade' ? '整备已经准备好。继续后即可选择本段强化。' : '战斗已暂停。准备好后继续。');
    }
    const returnLabel = roomGuest ? '个人回营结算' : roomHost ? '结束全队本局并回营' : '回营结算';
    $('arenaReturn').textContent = returnLabel;
    $('arenaResultReturn').textContent = session?.settled ? '返回营地' : returnLabel;
    ($('arenaClose') as HTMLButtonElement).textContent = '暂离';
    renderTeam();
    renderHud();
  }

  function profileCoins(): number { return state?.game.profile?.coins ?? 0; }
  function profileXp(): number { return state?.game.profile?.xp ?? 0; }
  function setElementText(element: HTMLElement, selector: string, value: string): void {
    const child = element.querySelector<HTMLElement>(selector);
    if (child) child.textContent = value;
  }

  function apply(next: ShellState): void {
    if (state && next.revision < state.revision) return;
    if (state?.action.run && next.action.run?.runId === state.action.run.runId && next.action.run.tick < state.action.run.tick) {
      next = { ...next, action: state.action };
    }
    state = next;
    const roomWeapon=next.room.role==='host'?next.room.members.find(member=>member.id===next.room.localPlayerId)?.weapon:undefined;
    if(roomWeapon&&roomWeapon!==lastRoomWeapon)selectWeapon(roomWeapon);
    lastRoomWeapon=roomWeapon;
    Object.assign(document.body.dataset,{arenaPhase:next.action.run?.phase??'welcome',arenaStage:String(next.action.run?.stage??0),arenaTick:String(next.action.run?.tick??0),arenaPaused:String(next.action.run?.paused??true)});
    const nextRun = next.action.run;
    if ((!nextRun || nextRun.paused || nextRun.phase !== 'playing' || next.mode === 'hidden') && (heldKeys.size || firingPointerId !== undefined || pendingControl)) {
      clearHeldCombatInput(false);
    }
    if (canRender()) {
      updateWorldCursor();
      renderOverlays();
      // Playing frames have one clock. State messages update the latest snapshot;
      // the 25Hz RAF loop paints it instead of adding another 20Hz paint stream.
      if (!next.action.run || next.action.run.paused || next.action.run.phase !== 'playing') draw();
      syncError();
    }
    syncLoop();
  }

  async function sendInput(input: ActionInput): Promise<void> {
    try {
      const next = await window.street.command({ type: 'action-input', input });
      apply(next);
      localError = '';
      syncError();
    } catch (error) {
      if (input.type !== 'control') showError(error instanceof Error ? error.message : String(error));
    }
  }

  async function sendCommand(command: Parameters<StreetAPI['command']>[0]): Promise<void> {
    try { apply(await window.street.command(command)); }
    catch (error) { showError(error instanceof Error ? error.message : String(error)); }
  }

  function mapPointer(event: PointerEvent, clampOutside = false): { x: number; y: number } | undefined {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return undefined;
    const x = (event.clientX - rect.left) * WORLD_WIDTH / rect.width;
    const y = (event.clientY - rect.top) * WORLD_HEIGHT / rect.height;
    if (!clampOutside && (x < 0 || y < 0 || x > WORLD_WIDTH || y > WORLD_HEIGHT)) return undefined;
    return { x: clamp(x, 0, WORLD_WIDTH), y: clamp(y, 0, WORLD_HEIGHT) };
  }

  function pointerInsideCanvas(event: PointerEvent): boolean {
    const rect = canvas.getBoundingClientRect();
    return event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
  }

  function firePointerReleased(pointerId: number): void {
    if (firingPointerId !== pointerId) return;
    firingPointerId = undefined;
    if (combatInputAvailable()) queueCombatControl(true);
    else clearHeldCombatInput(true);
    updateWorldCursor();
    draw();
  }

  function onWindowPointerUp(event: PointerEvent): void { firePointerReleased(event.pointerId); }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.isComposing || event.keyCode === 229 || isTextEntryTarget(event.target)) return;
    const run = state?.action.run;
    if (event.code === 'Escape' && combatInputAvailable(true)) {
      event.preventDefault();
      if (event.repeat) return;
      clearHeldCombatInput(true);
      if (run) void sendInput({ type: 'pause', paused: !run.paused });
      return;
    }
    if (!combatInputAvailable()) return;
    if (heldMoveKey(event.code)) {
      event.preventDefault();
      if (!heldKeys.has(event.code)) {
        heldKeys.add(event.code);
        queueCombatControl(true);
      }
      return;
    }
    if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
      event.preventDefault();
      if (!event.repeat) dashToward(aimPoint);
      return;
    }
    if (event.code === 'KeyQ' || event.code === 'KeyE') {
      event.preventDefault();
      if (event.repeat) return;
      void sendInput({ type: 'skill', skill: event.code === 'KeyQ' ? 'nova' : 'ward' });
    }
  }

  function onKeyUp(event: KeyboardEvent): void {
    if (!heldMoveKey(event.code) || !heldKeys.delete(event.code)) return;
    if (combatInputAvailable()) queueCombatControl(true);
    else clearHeldCombatInput(true);
  }

  function nearestEnemy(x: number, y: number, run: ActionState): EnemyState | undefined {
    // Hover and click share one target, including the visible head above the feet.
    return [...run.enemies].sort((a, b) => b.y - a.y).find(enemy => enemy.hp > 0 && (
      Math.hypot(enemy.x - x, enemy.y - y) <= enemy.radius + 10 ||
      Math.abs(enemy.x - x) <= enemy.radius + 6 && y >= enemy.y - enemy.radius - 18 && y <= enemy.y + enemy.radius + 6
    ));
  }

  canvas.addEventListener('pointermove', event => {
    if (!canRender()) return;
    const point = mapPointer(event, firingPointerId === event.pointerId);
    if (!point) { pointer.inside = false; updateWorldCursor(); draw(); return; }
    pointer = { ...point, inside: pointerInsideCanvas(event) };
    aimPoint = { x: point.x, y: point.y };
    updateWorldCursor();
    if (firingPointerId === event.pointerId) queueCombatControl();
    draw();
  });
  canvas.addEventListener('pointerleave', () => {
    if (!canRender()) return;
    pointer.inside = false;
    updateWorldCursor();
    draw();
  });
  canvas.addEventListener('contextmenu', event => event.preventDefault());
  canvas.addEventListener('pointerdown', event => {
    if (!combatInputAvailable()) return;
    if (event.button !== 0 && event.button !== 2) return;
    const run = state?.action.run;
    if (!run || run.phase !== 'playing' || run.paused) return;
    const point = mapPointer(event);
    if (!point) return;
    event.preventDefault();
    pointer = { ...point, inside: true };
    aimPoint = { x: point.x, y: point.y };
    if (event.button === 2) {
      dashToward(point);
    } else {
      firingPointerId = event.pointerId;
      try { canvas.setPointerCapture(event.pointerId); } catch { /* the platform may not expose capture for a synthetic pointer */ }
      queueCombatControl(true);
    }
    draw();
  });
  canvas.addEventListener('pointercancel', event => firePointerReleased(event.pointerId));
  window.addEventListener('pointerup', onWindowPointerUp, true);
  window.addEventListener('pointercancel', onWindowPointerUp, true);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  document.querySelectorAll<HTMLButtonElement>('[data-weapon]').forEach(button => {
    button.addEventListener('click', () => {
      selectWeapon(button.dataset.weapon as Weapon);
    });
  });
  $('arenaStart').addEventListener('click', () => { if (state?.room.role === 'guest') return; void sendCommand({ type: 'action-start', weapon: selectedWeapon }); });
  $('arenaPause').addEventListener('click', () => {
    const run = state?.action.run;
    if (run) { clearHeldCombatInput(true); void sendInput({ type: 'pause', paused: !run.paused }); }
  });
  $('arenaContinue').addEventListener('click', () => { clearHeldCombatInput(true); void sendInput({ type: 'pause', paused: false }); });
  $('arenaClose').addEventListener('click', () => { clearHeldCombatInput(true); void sendCommand({ type: 'action-close' }); });
  $('arenaReturn').addEventListener('click', () => { clearHeldCombatInput(true); void sendCommand({ type: 'action-return' }); });
  $('arenaResultReturn').addEventListener('click', () => { clearHeldCombatInput(true); void sendCommand({ type: 'action-return' }); });
  $('arenaClaim').addEventListener('click', () => { clearHeldCombatInput(true); void sendCommand({ type: 'action-claim' }); });
  $('arenaRestart').addEventListener('click', () => { if (state?.room.role === 'guest') return; clearHeldCombatInput(true); void sendCommand({ type: 'action-start', weapon: selectedWeapon }); });
  $('arenaProblemClose').addEventListener('click', () => { clearHeldCombatInput(true); void sendCommand({ type: 'action-close' }); });
  $('arenaNova').addEventListener('click', () => {
    if (combatInputAvailable()) void sendInput({ type: 'skill', skill: 'nova' });
  });
  $('arenaWard').addEventListener('click', () => {
    if (combatInputAvailable()) void sendInput({ type: 'skill', skill: 'ward' });
  });
  document.querySelectorAll<HTMLButtonElement>('.upgrade-card').forEach(button => {
    button.addEventListener('click', () => {
      if (state?.room.role === 'guest') return;
      const choice = button.dataset.upgrade;
      if (choice) { clearHeldCombatInput(true); void sendInput({ type: 'upgrade', choice }); }
    });
  });

  const previews = Array.from(document.querySelectorAll<HTMLCanvasElement>('[data-preview]'));
  const assetFailures: string[] = [];
  const assetTasks = [
    loadImage(`assets/action/${art.atlas.file}`).then(image => { atlas = image; }).catch(error => { assetFailures.push(String(error)); }),
    ...art.levels.map((level, index) => loadImage(`assets/action/${level.background}`).then(image => { backgrounds[index] = image; }).catch(error => { assetFailures.push(String(error)); })),
  ];
  void Promise.all(assetTasks).then(() => {
    document.body.dataset.arenaAssets=assetFailures.length?'failed':'ready';
    for (const preview of previews) {
      const previewCtx = preview.getContext('2d');
      const name = preview.dataset.preview ?? '';
      const frame = art.atlas.frames[name];
      if (previewCtx && atlas && frame) {
        previewCtx.imageSmoothingEnabled = false;
        previewCtx.clearRect(0, 0, preview.width, preview.height);
        previewCtx.drawImage(atlas, frame.x, frame.y, frame.width, frame.height, 0, 0, preview.width, preview.height);
      }
    }
    if (assetFailures.length) showError(assetFailures.join('；'));
    draw();
  });

  const renderVisibleState = (): void => {
    if (!canRender()) return;
    updateWorldCursor();
    renderOverlays();
    draw();
    syncError();
  };
  const onVisibility = (): void => {
    if (document.visibilityState === 'hidden') clearHeldCombatInput(true);
    renderVisibleState(); syncLoop();
  };
  const onBlur = (): void => { windowFocused = false; clearHeldCombatInput(true); syncLoop(); };
  const onFocus = (): void => { windowFocused = true; renderVisibleState(); syncLoop(); };
  const onFocusIn = (event: FocusEvent): void => { if (isTextEntryTarget(event.target)) clearHeldCombatInput(true); };
  const onBeforeUnload = (): void => clearHeldCombatInput(true);
  document.addEventListener('visibilitychange', onVisibility);
  document.addEventListener('focusin', onFocusIn);
  window.addEventListener('blur', onBlur);
  window.addEventListener('focus', onFocus);
  window.addEventListener('beforeunload', onBeforeUnload);
  let subscriptionUpdates = 0;
  unsubscribe = window.street.subscribe(next => { subscriptionUpdates++; apply(next); });
  try {
    const initial = await window.street.state();
    if (subscriptionUpdates === 0) apply(initial);
  }
  catch (error) { showError(error instanceof Error ? error.message : String(error)); }

  // Renderer pages are replaced as whole documents, but dispose defensively if the host
  // keeps the module alive across a route swap.
  const observer = new MutationObserver(() => {
    if (root.isConnected) return;
    clearHeldCombatInput(true);
    disposed = true;
    stopDrawLoop();
    unsubscribe?.();
    document.removeEventListener('visibilitychange', onVisibility);
    document.removeEventListener('focusin', onFocusIn);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('focus', onFocus);
    window.removeEventListener('beforeunload', onBeforeUnload);
    window.removeEventListener('pointerup', onWindowPointerUp, true);
    window.removeEventListener('pointercancel', onWindowPointerUp, true);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    if (controlTimer) window.clearTimeout(controlTimer);
    observer.disconnect();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
