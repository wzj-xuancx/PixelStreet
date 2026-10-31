import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { startDesktop } from '../apps/desktop/bootstrap';

const evidence = path.resolve(process.cwd(), process.env.PIXELSTREET_ACTION_EVIDENCE_DIR || 'docs/evidence/action-loop/action-play-luna');
fs.mkdirSync(evidence, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pixelstreet-action-luna-'));
const errors: string[] = [];
const records: any[] = [];
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function until(test: () => Promise<boolean>, label: string): Promise<void> {
  for (let n = 0; n < 300; n++) {
    if (await test()) return;
    await pause(50);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function emit(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

app.focus = () => {};
app.on('browser-window-created', (_event, win) => {
  win.focus = () => {};
  win.webContents.focus = () => {};
  win.show = () => win.showInactive();
  win.webContents.on('console-message', event => {
    if (event.level === 'error') errors.push(event.message);
  });
});

void (async () => {
  const shell = await startDesktop(profile);
  const campBounds = shell.overlay.getBounds();
  const popupJs = (source: string) => shell.popupWindow!.webContents.executeJavaScript(source);
  const arenaJs = (source: string) => shell.arenaWindow!.webContents.executeJavaScript(source);

  shell.openPopup('adventure', { x: 740, y: 30, width: 48, height: 65 });
  await until(async () => !!shell.popupWindow?.isVisible(), 'adventure panel');
  if (!(await popupJs("!!document.getElementById('openAction')"))) throw new Error('openAction button missing');
  await popupJs("document.getElementById('openAction').click()");
  await until(async () => !!shell.arenaWindow?.isVisible() && await arenaJs("document.body.dataset.arenaAssets==='ready'"), 'arena and assets');

  const win = shell.arenaWindow!;
  // Test fixture only: suppress activation/focus while allowing the UI command path to accept gameplay intents.
  win.isFocused = () => true;
  await pause(80);
  const firstStyle = await arenaJs(`(()=>{
    const body=getComputedStyle(document.body),root=document.querySelector('.arena-shell'),shell=root?getComputedStyle(root):null;
    return {bodyClass:document.body.className,bodyBackground:body.backgroundColor,shellDisplay:shell?.display||null,shellBackground:shell?.backgroundImage||shell?.backgroundColor||null,
      shellRect:root?(()=>{const r=root.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})():null,
      welcomeHidden:document.getElementById('arenaWelcome')?.hidden??null,assets:document.body.dataset.arenaAssets||''};
  })()`);
  const firstScreenshot = path.join(evidence, 'first-visible-welcome.png');
  fs.writeFileSync(firstScreenshot, (await win.webContents.capturePage()).toPNG());
  emit({ type: 'first-visible', path: firstScreenshot, bounds: win.getBounds(), style: firstStyle, screenshotBytes: fs.statSync(firstScreenshot).size });
  emit({ type: 'ready', profile, campBounds, arenaBounds: win.getBounds(), focusMode: 'app.focus and window focus methods suppressed; show redirected to showInactive; arena isFocused fixture true' });

  const compact = () => {
    const session = shell.action.state;
    const run = session.run;
    return { status: session.status, claim: session.claim, settled: session.settled, error: session.error, warnings: session.warnings,
      run: run ? { runId: run.runId, phase: run.phase, paused: run.paused, stage: run.stage, wave: run.wave, tick: run.tick, elapsedMs: run.elapsedMs,
        kills: run.kills, player: run.players[0] ? { x: run.players[0].x, y: run.players[0].y, hp: run.players[0].hp, maxHp: run.players[0].maxHp,
          weapon: run.players[0].weapon, damage: run.players[0].damage, attackRate: run.players[0].attackRate, rangeBonus: run.players[0].rangeBonus,
          targetX: run.players[0].targetX, targetY: run.players[0].targetY, lockedEnemy: run.players[0].lockedEnemy,
          dashReady: run.players[0].dashReady, skillReady: run.players[0].skillReady, shieldReady: run.players[0].shieldReady, shield: run.players[0].shield } : null,
        enemies: run.enemies.filter(enemy => enemy.hp > 0).map(enemy => ({ id: enemy.id, kind: enemy.kind, x: enemy.x, y: enemy.y, hp: enemy.hp, maxHp: enemy.maxHp, radius: enemy.radius, bossPhase: enemy.bossPhase, windupUntil: enemy.windupUntil, bossPattern: enemy.bossPattern })),
        projectiles: run.projectiles.map(item => ({ faction: item.faction, style: item.style, x: item.x, y: item.y, radius: item.radius })),
        telegraphs: run.telegraphs.map(item => ({ kind: item.kind, x: item.x, y: item.y, targetX: item.targetX, targetY: item.targetY, radius: item.radius })),
        reward: run.reward, upgradeChoices: run.upgradeChoices, notice: run.notice } : null };
  };
  const saveEvidence = () => fs.writeFileSync(path.join(evidence, 'action-play-luna.json'), JSON.stringify({
    createdAt: new Date().toISOString(), profile, campBounds, arenaBounds: win.getBounds(), focusMode: 'Isolated Electron; app.focus, window.focus and webContents.focus suppressed; show redirected to showInactive; arena isFocused fixture true. Renderer and worker ran normally; button and DOM PointerEvent intents only; no state, HP, damage, tick, seed, or reward mutation.',
    records, final: compact(), errors: [...errors],
  }, null, 2));

  const snapshot = async () => {
    const visual = await arenaJs(`(()=>{
      const c=document.getElementById('arenaCanvas'),r=c.getBoundingClientRect();
      const ids=['arenaStart','arenaPause','arenaContinue','arenaNova','arenaWard','arenaReturn','arenaClaim','arenaRestart','arenaResultReturn'];
      return {title:document.title,bodyClass:document.body.className,phase:document.body.dataset.arenaPhase,stage:document.body.dataset.arenaStage,paused:document.body.dataset.arenaPaused,
        canvas:{x:r.x,y:r.y,width:r.width,height:r.height,cursor:c.style.cursor,hoverEnemy:c.dataset.hoverEnemy},
        buttons:Object.fromEntries(ids.map(id=>{const e=document.getElementById(id);return [id,e?{text:e.innerText,disabled:e.disabled,hidden:e.hidden,rect:(()=>{const q=e.getBoundingClientRect();return {x:q.x,y:q.y,width:q.width,height:q.height}})()}:null]})),
        upgrades:[...document.querySelectorAll('.upgrade-card')].map(e=>({text:e.innerText,choice:e.dataset.upgrade,disabled:e.disabled})),
        dialogs:[...document.querySelectorAll('[role=dialog]')].map(e=>({text:e.innerText,hidden:e.hidden})),
        error:document.querySelector('.arena-error')?.innerText||'', assetState:document.body.dataset.arenaAssets};
    })()`);
    return { at: new Date().toISOString(), state: shell.action.state, visual, bounds: win.getBounds(), campBounds, errors: [...errors] };
  };

  async function handle(command: any): Promise<unknown> {
    if (command.type === 'snapshot') return snapshot();
    if (command.type === 'brief') return { at: new Date().toISOString(), state: compact(), visual: await arenaJs(`(()=>{const c=document.getElementById('arenaCanvas');return {phase:document.body.dataset.arenaPhase,stage:document.body.dataset.arenaStage,paused:document.body.dataset.arenaPaused,cursor:c.style.cursor,hoverEnemy:c.dataset.hoverEnemy,canvasRect:(()=>{const r=c.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})(),errors:document.getElementById('arenaError')?.innerText||''}})()`) };
    if (command.type === 'button') {
      const id = String(command.id);
      const exists = await arenaJs(`!!document.getElementById(${JSON.stringify(id)})`);
      if (!exists) throw new Error(`Missing button ${id}`);
      await arenaJs(`document.getElementById(${JSON.stringify(id)}).click()`);
      await pause(100);
      return snapshot();
    }
    if (command.type === 'weapon') {
      const id = String(command.id);
      await arenaJs(`(()=>{const id=${JSON.stringify(id)};const e=[...document.querySelectorAll('[data-weapon]')].find(item=>item.dataset.weapon===id);if(!e)throw Error('missing weapon');e.click()})()`);
      await pause(50);
      return { selected: await arenaJs("[...document.querySelectorAll('[data-weapon]')].filter(e=>e.getAttribute('aria-pressed')==='true').map(e=>e.dataset.weapon)"), visual: await snapshot() };
    }
    if (command.type === 'pointer') {
      const x = Number(command.x), y = Number(command.y), button = command.button === 2 ? 2 : 0;
      const click = command.action !== 'move';
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('pointer coordinates must be finite world coordinates');
      return arenaJs(`(()=>{const c=document.getElementById('arenaCanvas'),r=c.getBoundingClientRect(),x=${x},y=${y},button=${button};
        const clientX=r.left+x/960*r.width,clientY=r.top+y/540*r.height;
        c.dispatchEvent(new PointerEvent('pointermove',{button:0,clientX,clientY,bubbles:true}));
        ${click ? "c.dispatchEvent(new PointerEvent('pointerdown',{button,clientX,clientY,bubbles:true,cancelable:true}));c.dispatchEvent(new PointerEvent('pointerup',{button,clientX,clientY,bubbles:true}));" : ''}
        return {world:{x,y},client:{x:clientX,y:clientY},canvas:{x:r.x,y:r.y,width:r.width,height:r.height},cursor:c.style.cursor,hoverEnemy:c.dataset.hoverEnemy};})()`)
        .then(async input => ({ input, snapshot: command.action === 'move' ? await snapshot() : await snapshot() }));
    }
    if (command.type === 'target') {
      const run = shell.action.state.run;
      if (!run || run.phase !== 'playing' || run.paused) throw new Error('No active mouse target is available');
      const enemy = run.enemies.find(item => item.id === String(command.enemyId) && item.hp > 0);
      if (!enemy) throw new Error(`Enemy ${String(command.enemyId)} is no longer alive`);
      const x = enemy.x, y = enemy.y;
      const input = await arenaJs(`(()=>{const c=document.getElementById('arenaCanvas'),r=c.getBoundingClientRect(),x=${x},y=${y};
        const clientX=r.left+x/960*r.width,clientY=r.top+y/540*r.height;
        c.dispatchEvent(new PointerEvent('pointermove',{button:0,clientX,clientY,bubbles:true}));
        const cursor=c.style.cursor,hoverEnemy=c.dataset.hoverEnemy;
        c.dispatchEvent(new PointerEvent('pointerdown',{button:0,clientX,clientY,bubbles:true,cancelable:true}));
        c.dispatchEvent(new PointerEvent('pointerup',{button:0,clientX,clientY,bubbles:true}));
        return {world:{x,y},client:{x:clientX,y:clientY},cursor,hoverEnemy};})()`);
      await pause(80);
      return { target: { id: enemy.id, kind: enemy.kind, hp: enemy.hp }, input, state: compact() };
    }
    if (command.type === 'enemyPoint') {
      const run = shell.action.state.run;
      if (!run || run.phase !== 'playing' || run.paused) throw new Error('No active mouse target is available');
      const player = run.players[0];
      const enemy = command.enemyId
        ? run.enemies.find(item => item.id === String(command.enemyId) && item.hp > 0)
        : run.enemies.filter(item => item.kind === String(command.kind || 'chaser') && item.hp > 0)
          .sort((a, b) => Math.hypot(b.x - player.x, b.y - player.y) - Math.hypot(a.x - player.x, a.y - player.y))[0];
      if (!enemy) throw new Error(`No live ${String(command.kind || 'chaser')} is available`);
      const part = command.part === 'head' ? 'head' : 'body';
      const action = command.action === 'move' ? 'move' : 'click';
      const x = enemy.x, y = part === 'head' ? enemy.y - enemy.radius - 5 : enemy.y;
      const input = await arenaJs(`(()=>{const c=document.getElementById('arenaCanvas'),r=c.getBoundingClientRect(),x=${x},y=${y},click=${action === 'click'};
        const clientX=r.left+x/960*r.width,clientY=r.top+y/540*r.height;
        c.dispatchEvent(new PointerEvent('pointermove',{button:0,clientX,clientY,bubbles:true}));
        const cursor=c.style.cursor,hoverEnemy=c.dataset.hoverEnemy;
        if(click){c.dispatchEvent(new PointerEvent('pointerdown',{button:0,clientX,clientY,bubbles:true,cancelable:true}));c.dispatchEvent(new PointerEvent('pointerup',{button:0,clientX,clientY,bubbles:true}));}
        return {part:${JSON.stringify(part)},action:${JSON.stringify(action)},world:{x,y},client:{x:clientX,y:clientY},cursor,hoverEnemy,canvas:{x:r.x,y:r.y,width:r.width,height:r.height}};})()`);
      await pause(80);
      return { target: { id: enemy.id, kind: enemy.kind, hp: enemy.hp, radius: enemy.radius }, input, state: compact() };
    }
    if (command.type === 'element') {
      const selector = String(command.selector);
      const clicked = await arenaJs(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('element not found');if(e.disabled)throw Error('element disabled');e.click();return {tag:e.tagName,text:e.innerText||'',selector:${JSON.stringify(selector)}}})()`);
      await pause(100);
      return { clicked, snapshot: await snapshot() };
    }
    if (command.type === 'resize') {
      const width = Math.max(800, Math.min(1040, Math.round(Number(command.width))));
      const height = Math.max(620, Math.min(760, Math.round(Number(command.height))));
      win.setSize(width, height);
      await pause(200);
      return snapshot();
    }
    if (command.type === 'screenshot') {
      const name = String(command.name).replace(/[^a-zA-Z0-9._-]/g, '-');
      const target = path.join(evidence, `${name}.png`);
      fs.writeFileSync(target, (await win.webContents.capturePage()).toPNG());
      return { path: target, bounds: win.getBounds(), visual: await snapshot() };
    }
    if (command.type === 'closeArena') {
      shell.closeArena();
      await pause(100);
      return snapshot();
    }
    if (command.type === 'openArena') {
      shell.openArena();
      await until(async () => !!shell.arenaWindow?.isVisible(), 'arena reopen');
      return snapshot();
    }
    if (command.type === 'stop') {
      const result = { type: 'stopped', snapshot: await snapshot() };
      saveEvidence();
      emit(result);
      app.quit();
      return undefined;
    }
    throw new Error(`Unknown command type: ${String(command.type)}`);
  }

  emit({ type: 'snapshot', snapshot: await snapshot() });
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  input.on('line', line => {
    void (async () => {
      let command: any;
      try {
        command = JSON.parse(line);
        const result = await handle(command);
        records.push({ at: new Date().toISOString(), command, result: command.type === 'snapshot' ? compact() : compact() });
        saveEvidence();
        emit({ type: 'result', id: command.id ?? command.button ?? command.selector ?? null, result });
      } catch (error) {
        records.push({ at: new Date().toISOString(), command, error: String(error), state: compact() });
        saveEvidence();
        emit({ type: 'command-error', message: String(error), stack: error instanceof Error ? error.stack : undefined });
      }
    })();
  });
  input.on('close', () => app.quit());
})().catch(error => {
  emit({ type: 'fatal', error: String(error), stack: error instanceof Error ? error.stack : undefined });
  app.exit(1);
});
