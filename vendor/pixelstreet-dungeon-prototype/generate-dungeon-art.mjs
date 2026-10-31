import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Deterministic, original crisp-edge SVG pixel art for the 0.4 dungeon slice.
// This generator writes only assets/dungeon/{sprites.svg,manifest.json}.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'assets', 'dungeon');
const CELL = 72;
const COLUMNS = 8;
const ROWS = 5;
const WIDTH = CELL * COLUMNS;
const HEIGHT = CELL * ROWS;

const C = {
  ink: '#11171e', outline: '#202a31', shadow: '#071116',
  floor: '#39464b', floorLight: '#536166', floorMid: '#455359', floorDark: '#2c373c', grout: '#253036',
  stone: '#59676a', stoneLight: '#84928d', stonePale: '#b0b8a5', stoneDark: '#39464a',
  teal: '#287c78', tealLight: '#63d4bd', tealBright: '#b8ffe4', tealDark: '#174844',
  gold: '#c78e45', goldLight: '#f3cf78', cream: '#f1d6a7',
  violet: '#7858a1', violetLight: '#c4a0f3', violetDark: '#493b69',
  fireDark: '#903f38', fire: '#dc5945', fireLight: '#f58a45', fireBright: '#ffe5a0',
  ice: '#70cbd0', iceLight: '#b2f2ed', iceBright: '#e2fff4',
  wood: '#80563b', woodLight: '#bd8246', woodDark: '#4d392f', moss: '#4b896c', mossLight: '#8ec38a',
};

function int(value, label) {
  if (!Number.isInteger(value)) throw new Error(`${label} must be an integer: ${value}`);
  return value;
}
function color(value) {
  if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`invalid color: ${value}`);
  return value;
}
function opacity(value) {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`invalid opacity: ${value}`);
  return value === 1 ? '' : ` opacity="${value}"`;
}
function bounds(x, y, w, h, label) {
  for (const [value, key] of [[x, 'x'], [y, 'y'], [w, 'width'], [h, 'height']]) int(value, `${label} ${key}`);
  if (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > CELL || y + h > CELL) {
    throw new Error(`${label} lies outside the ${CELL}x${CELL} cell: ${x},${y},${w},${h}`);
  }
}
const R = (x, y, w, h, fill, a = 1) => {
  bounds(x, y, w, h, 'rect');
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${color(fill)}"${opacity(a)}/>`;
};
const P = (points, fill, a = 1) => {
  if (points.length < 3) throw new Error('polygon requires at least three points');
  const normalized = points.map(([x, y]) => {
    int(x, 'polygon x'); int(y, 'polygon y');
    if (x < 0 || y < 0 || x > CELL || y > CELL) throw new Error(`polygon point outside cell: ${x},${y}`);
    return `${x},${y}`;
  }).join(' ');
  return `<polygon points="${normalized}" fill="${color(fill)}"${opacity(a)}/>`;
};
const E = (cx, cy, rx, ry, fill, a = 1) => {
  for (const [value, key] of [[cx, 'cx'], [cy, 'cy'], [rx, 'rx'], [ry, 'ry']]) int(value, `ellipse ${key}`);
  if (rx <= 0 || ry <= 0 || cx - rx < 0 || cy - ry < 0 || cx + rx > CELL || cy + ry > CELL) {
    throw new Error(`ellipse lies outside cell: ${cx},${cy},${rx},${ry}`);
  }
  return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${color(fill)}"${opacity(a)}/>`;
};
const sprite = (id, worldSize, anchor, draw, tags) => ({ id, worldSize, anchor, draw, tags });

function floorBase(variation) {
  let art = [R(0,0,72,72,'#28363b'),R(3,3,69,69,'#344247'),R(3,3,66,3,'#3b494d'),R(69,6,3,66,'#2e3c41'),R(9,12,9,3,'#37464a')].join('');
  if(variation==='cracked')art += [P([[42,3],[45,3],[42,27],[33,30],[36,45],[33,45],[30,27],[39,24]],'#27373c'),R(45,6,3,15,'#3c4b4e')].join('');
  if(variation==='mossy')art += [R(3,57,12,3,'#3c5e4e'),R(6,60,6,3,'#4c7057'),R(60,6,9,3,'#3c5e4e')].join('');
  return art;
}

function wallTile() {
  return [
    R(0, 0, 72, 72, C.ink),
    P([[3, 6], [66, 6], [69, 12], [69, 63], [63, 69], [6, 69], [3, 63]], C.stoneDark),
    P([[6, 9], [63, 9], [66, 15], [66, 54], [60, 60], [9, 60], [6, 54]], C.stone),
    R(9, 12, 54, 6, C.stoneLight), R(12, 18, 48, 3, C.stonePale),
    R(9, 24, 24, 18, C.stone), R(36, 24, 27, 18, C.stoneLight),
    R(9, 45, 27, 12, C.stoneDark), R(39, 45, 24, 12, C.stone),
    R(33, 24, 3, 18, C.ink), R(36, 45, 3, 12, C.ink),
    R(12, 27, 15, 3, C.stonePale), R(42, 27, 15, 3, C.stonePale),
    R(12, 48, 15, 3, C.stone), R(45, 48, 12, 3, C.stoneLight),
    R(6, 60, 60, 3, C.ink), R(9, 63, 54, 3, C.outline),
  ].join('');
}

function door(open) {
  const art = [
    E(36, 65, 30, 4, C.shadow, .65),
    R(3, 15, 66, 6, C.ink), R(6, 18, 60, 6, C.gold), R(9, 21, 54, 6, C.woodDark),
    P([[6, 24], [66, 24], [63, 60], [9, 60]], C.stoneDark),
    R(9, 54, 54, 6, C.stone), R(12, 57, 48, 3, C.stonePale),
    R(3, 21, 9, 39, C.ink), R(60, 21, 9, 39, C.ink),
    R(6, 24, 6, 33, C.stoneLight), R(60, 24, 6, 33, C.stone),
    R(9, 27, 3, 27, C.gold), R(60, 27, 3, 27, C.goldLight),
    R(12, 57, 48, 6, C.floorDark), R(15, 60, 42, 3, C.gold),
    ...(open ? [
      // The 48-source-pixel aisle is the shared 120-unit walkable opening.
      // Open leaves fold onto the posts instead of visually blocking that aisle.
      R(12, 24, 48, 33, C.floorDark),
      P([[6, 27], [12, 27], [12, 57], [6, 54]], C.woodDark),
      P([[60, 27], [66, 27], [66, 54], [60, 57]], C.wood),
      R(9, 30, 3, 24, C.woodLight), R(60, 30, 3, 24, C.woodLight),
      R(9, 39, 3, 3, C.goldLight), R(60, 39, 3, 3, C.gold),
    ] : [
      R(18, 27, 18, 30, C.ink), R(36, 27, 18, 30, C.ink),
      R(21, 30, 15, 24, C.wood), R(39, 30, 15, 24, C.woodDark),
      R(24, 33, 9, 3, C.woodLight), R(42, 33, 9, 3, C.woodLight),
      R(24, 39, 9, 3, C.woodDark), R(42, 39, 9, 3, C.wood),
      R(24, 45, 9, 3, C.woodLight), R(42, 45, 9, 3, C.woodLight),
      R(33, 39, 6, 9, C.gold), R(33, 39, 3, 3, C.goldLight),
      R(18, 54, 36, 3, C.ink),
    ]),
    R(12, 18, 6, 3, C.goldLight), R(54, 18, 6, 3, C.goldLight),
  ].join('');
  return art;
}

function torch(frame) {
  const flame = frame === 0
    ? P([[33, 15], [30, 24], [33, 30], [27, 36], [30, 45], [36, 51], [42, 45], [45, 36], [39, 30], [42, 21], [36, 27]], C.fire)
      + P([[36, 27], [33, 36], [36, 42], [33, 45], [39, 42], [42, 36], [39, 30]], C.fireBright)
      + P([[33, 18], [36, 9], [39, 18], [39, 27], [36, 30]], C.fireLight)
    : P([[36, 12], [30, 24], [36, 30], [30, 39], [33, 48], [39, 51], [45, 42], [42, 33], [45, 24], [39, 30]], C.fire)
      + P([[36, 24], [33, 33], [36, 39], [33, 45], [39, 45], [42, 36], [39, 30]], C.fireBright)
      + P([[39, 18], [42, 9], [42, 24], [39, 30], [36, 24]], C.fireLight);
  return [
    E(36, 64, 18, 3, C.shadow, .55),
    R(27, 45, 18, 9, C.ink), R(30, 48, 12, 6, C.wood),
    R(24, 54, 24, 6, C.woodDark), R(27, 54, 18, 3, C.woodLight),
    R(21, 60, 30, 3, C.stoneDark), R(27, 63, 18, 3, C.stone),
    R(18, 57, 6, 3, C.gold), R(48, 57, 6, 3, C.goldLight),
    flame,
    R(30, 33, 3, 6, C.fireLight), R(42, 30, 3, 6, C.fireBright),
  ].join('');
}

function trap(state) {
  const base = [
    R(3, 6, 66, 60, C.ink), R(6, 9, 60, 54, C.stoneDark),
    R(12, 15, 48, 42, C.stone), R(15, 18, 42, 36, C.floorDark),
    R(18, 21, 36, 30, C.stoneDark), R(30, 21, 12, 30, C.ink),
    R(18, 33, 36, 6, C.ink), R(9, 12, 6, 3, C.stoneLight), R(57, 54, 6, 3, C.stone),
  ];
  if (state === 'idle') base.push(
    E(36, 36, 9, 9, C.tealDark), E(36, 36, 6, 6, C.teal),
    R(33, 33, 6, 6, C.stoneLight), R(33, 36, 6, 3, C.gold),
  );
  if (state === 'warn') base.push(
    E(36, 36, 12, 12, C.fireDark), E(36, 36, 8, 8, C.fireLight),
    R(33, 30, 6, 12, C.goldLight), R(30, 33, 12, 6, C.gold),
    P([[36, 9], [42, 18], [30, 18]], C.fireBright),
    R(9, 30, 6, 3, C.fireLight), R(57, 39, 6, 3, C.fireLight),
  );
  if (state === 'active') base.push(
    P([[9, 15], [18, 27], [21, 33], [15, 36]], C.ink),
    P([[63, 15], [54, 27], [51, 33], [57, 36]], C.ink),
    P([[12, 18], [18, 27], [18, 33], [15, 30]], C.stonePale),
    P([[60, 18], [54, 27], [54, 33], [57, 30]], C.stonePale),
    P([[27, 27], [33, 21], [36, 18], [39, 21], [45, 27], [42, 33], [30, 33]], C.fire),
    P([[33, 27], [36, 21], [39, 27], [36, 30]], C.goldLight),
  );
  return base.join('');
}

function barrel(state) {
  if (state === 'broken') return [
    E(36, 62, 24, 4, C.shadow, .6),
    P([[9, 48], [18, 39], [27, 42], [30, 57], [24, 63], [12, 60]], C.woodDark),
    P([[39, 48], [48, 42], [63, 51], [60, 60], [45, 63], [36, 57]], C.wood),
    P([[24, 33], [42, 30], [51, 39], [45, 48], [30, 48], [21, 42]], C.woodLight),
    R(15, 45, 9, 3, C.stone), R(48, 48, 9, 3, C.stoneDark),
    R(30, 39, 12, 3, C.gold), R(36, 48, 3, 6, C.ink),
    R(30, 24, 6, 3, C.goldLight), R(48, 30, 3, 6, C.goldLight),
  ].join('');
  const cracked = state === 'cracked';
  return [
    E(36, 64, 21, 4, C.shadow, .6),
    P([[21, 15], [51, 15], [60, 24], [60, 51], [51, 63], [21, 63], [12, 51], [12, 24]], C.ink),
    P([[24, 18], [48, 18], [54, 27], [54, 48], [48, 57], [24, 57], [18, 48], [18, 27]], C.wood),
    R(24, 18, 24, 6, C.woodLight), R(21, 27, 30, 3, C.woodDark),
    R(18, 36, 36, 3, C.woodLight), R(18, 48, 36, 3, C.woodDark),
    R(21, 57, 30, 3, C.woodLight), R(30, 24, 3, 30, C.woodDark),
    R(39, 24, 3, 30, C.woodLight), R(18, 30, 6, 3, C.woodLight),
    R(48, 42, 6, 3, C.woodLight), R(33, 30, 6, 6, C.gold),
    R(36, 30, 3, 3, C.goldLight),
    ...(cracked ? [
      P([[45, 24], [48, 27], [42, 33], [45, 36], [39, 42], [36, 39], [42, 33]], C.ink),
      P([[45, 27], [48, 30], [42, 36], [45, 39], [42, 42], [39, 39], [42, 36]], C.fireLight),
      R(51, 30, 3, 6, C.ink), R(54, 33, 3, 3, C.woodLight),
    ] : []),
  ].join('');
}

function altar() {
  return [
    E(36, 63, 27, 5, C.shadow, .65),
    P([[9, 48], [18, 39], [54, 39], [63, 48], [57, 60], [15, 60]], C.ink),
    P([[15, 48], [21, 42], [51, 42], [57, 48], [54, 54], [18, 54]], C.stone),
    R(18, 54, 36, 6, C.stoneDark), R(21, 57, 30, 3, C.stoneLight),
    P([[18, 33], [27, 27], [45, 27], [54, 33], [51, 45], [21, 45]], C.ink),
    P([[21, 33], [28, 30], [44, 30], [51, 33], [48, 42], [24, 42]], C.stoneLight),
    R(27, 36, 18, 3, C.violetDark),
    P([[30, 36], [36, 24], [42, 36], [36, 42]], C.violet),
    P([[33, 33], [36, 27], [39, 33], [36, 36]], C.violetLight),
    R(34, 39, 4, 3, C.tealBright),
    R(12, 48, 6, 3, C.gold), R(54, 48, 6, 3, C.goldLight),
    P([[36, 9], [39, 18], [36, 21], [33, 18]], C.iceBright),
    R(18, 24, 3, 3, C.violetLight), R(51, 24, 3, 3, C.violetLight),
  ].join('');
}

function merchant() {
  return [
    E(36, 64, 19, 4, C.shadow, .6),
    R(21, 51, 30, 9, C.woodDark), R(24, 54, 24, 3, C.woodLight),
    R(18, 48, 36, 6, C.ink), R(21, 45, 30, 6, C.gold),
    R(24, 45, 24, 3, C.goldLight), R(27, 48, 18, 3, C.wood),
    P([[24, 30], [27, 24], [36, 21], [45, 24], [48, 33], [45, 48], [27, 48], [21, 42]], C.ink),
    P([[27, 30], [30, 27], [36, 24], [42, 27], [45, 33], [42, 45], [30, 45], [24, 39]], C.violetDark),
    P([[27, 27], [30, 18], [42, 18], [48, 27], [42, 30], [30, 30]], C.violet),
    R(30, 18, 12, 3, C.violetLight), R(24, 27, 6, 9, C.violetDark),
    R(30, 33, 12, 6, C.cream), R(33, 33, 3, 3, C.ink),
    R(30, 39, 12, 3, C.wood), R(27, 45, 18, 3, C.tealDark),
    R(27, 51, 6, 9, C.ink), R(39, 51, 6, 9, C.ink),
    R(30, 54, 3, 6, C.woodLight), R(39, 54, 3, 6, C.woodLight),
    R(30, 48, 3, 3, C.goldLight), R(39, 48, 3, 3, C.goldLight),
    R(18, 42, 6, 3, C.cream), R(48, 42, 6, 3, C.cream),
  ].join('');
}

function sword() {
  return [
    E(37, 52, 18, 4, C.shadow, .45),
    P([[35, 12], [42, 6], [46, 10], [40, 18], [28, 42], [22, 48], [20, 42], [34, 19]], C.ink),
    P([[36, 15], [41, 9], [43, 11], [38, 19], [27, 42], [24, 44], [25, 40]], C.stonePale),
    P([[40, 18], [43, 15], [39, 25], [30, 42], [27, 43]], C.stoneLight),
    R(18, 42, 12, 3, C.gold), R(21, 45, 12, 3, C.goldLight),
    P([[21, 48], [27, 45], [33, 48], [30, 54], [24, 57]], C.woodDark),
    R(24, 48, 6, 3, C.woodLight), R(27, 51, 6, 3, C.woodLight),
    R(24, 57, 6, 3, C.ink), R(27, 57, 6, 3, C.gold),
  ].join('');
}

function fireStaff() {
  return [
    E(38, 44, 17, 3, C.shadow, .4),
    P([[24, 57], [27, 54], [45, 21], [49, 24], [31, 60]], C.ink),
    P([[27, 54], [30, 54], [47, 24], [45, 22]], C.woodLight),
    R(42, 18, 12, 6, C.woodDark), R(45, 15, 9, 6, C.gold),
    P([[45, 18], [48, 9], [54, 15], [54, 24], [48, 27]], C.fire),
    P([[48, 15], [51, 12], [51, 21], [48, 24]], C.fireBright),
    R(48, 21, 3, 3, C.goldLight), R(24, 54, 6, 6, C.gold),
    R(21, 57, 6, 6, C.woodDark),
  ].join('');
}

function frostBow() {
  return [
    P([[24, 12], [18, 21], [18, 33], [24, 45], [33, 54], [42, 57], [48, 51], [42, 48], [33, 42], [27, 33], [27, 21], [33, 15]], C.ink),
    P([[27, 18], [21, 24], [21, 33], [27, 42], [33, 48], [39, 51], [42, 48], [36, 45], [30, 39], [24, 33], [24, 24], [30, 21]], C.woodLight),
    P([[24, 18], [27, 18], [51, 54], [48, 57], [45, 54]], C.iceBright),
    P([[21, 27], [27, 30], [30, 33], [27, 36], [21, 39], [24, 33]], C.ice),
    P([[42, 42], [48, 39], [51, 42], [48, 45], [42, 44]], C.iceLight),
    R(33, 30, 6, 6, C.tealBright), R(36, 27, 3, 12, C.iceBright),
    R(30, 33, 12, 3, C.iceBright), R(34, 28, 3, 11, C.teal),
  ].join('');
}

function lightningStaff() {
  return [
    E(37, 44, 15, 3, C.shadow, .4),
    P([[25, 57], [29, 60], [48, 20], [44, 17]], C.ink),
    P([[28, 56], [30, 57], [46, 21], [44, 20]], C.gold),
    R(39, 18, 15, 6, C.woodDark), R(42, 15, 12, 6, C.goldLight),
    P([[42, 15], [45, 6], [51, 12], [57, 15], [51, 21], [48, 27], [42, 24], [45, 18]], C.gold),
    P([[45, 15], [48, 9], [51, 15], [48, 21]], C.iceBright),
    R(48, 15, 6, 3, C.tealBright), R(24, 54, 9, 6, C.goldLight),
    P([[33, 33], [39, 33], [36, 42], [42, 42], [30, 54], [33, 45], [27, 45]], C.goldLight),
  ].join('');
}

function boomerang() {
  return [
    E(36, 38, 21, 18, C.shadow, .38),
    P([[18, 18], [27, 15], [36, 21], [42, 30], [51, 36], [57, 33], [60, 39], [54, 48], [45, 54], [36, 51], [30, 42], [24, 30], [18, 27]], C.ink),
    P([[21, 21], [27, 18], [33, 24], [39, 33], [48, 39], [54, 36], [54, 39], [51, 45], [45, 48], [39, 45], [33, 36], [27, 27], [21, 24]], C.gold),
    P([[24, 21], [27, 21], [33, 27], [39, 36], [48, 42], [51, 42], [48, 45], [42, 42], [36, 33], [30, 27]], C.goldLight),
    R(27, 24, 6, 3, C.cream), R(42, 42, 6, 3, C.stonePale),
    R(18, 30, 6, 3, C.ink), R(54, 30, 6, 3, C.ink),
  ].join('');
}

function meteor() {
  return [
    E(36, 54, 25, 7, C.shadow, .4),
    P([[12, 48], [18, 39], [27, 36], [33, 24], [45, 18], [54, 24], [60, 36], [57, 48], [48, 57], [30, 60], [18, 57]], C.ink),
    P([[18, 48], [24, 39], [33, 36], [36, 27], [45, 24], [54, 30], [57, 39], [51, 48], [45, 54], [30, 54], [21, 51]], C.fire),
    P([[27, 45], [33, 36], [36, 30], [42, 30], [48, 36], [45, 42], [39, 45], [36, 51], [30, 48]], C.fireLight),
    P([[36, 36], [42, 30], [45, 36], [42, 42], [36, 45]], C.goldLight),
    R(18, 30, 6, 3, C.fire), R(12, 24, 6, 3, C.fireLight),
    R(9, 18, 6, 3, C.gold), R(24, 27, 6, 3, C.goldLight),
    P([[42, 15], [48, 9], [51, 18], [48, 24]], C.fireLight),
  ].join('');
}

function bladeRing() {
  return [
    E(36, 36, 21, 21, C.violetDark), E(36, 36, 15, 15, C.floorDark),
    E(36, 36, 9, 9, C.violet), E(36, 36, 4, 4, C.goldLight),
    P([[33, 9], [42, 6], [39, 18], [36, 24], [30, 18]], C.ink),
    P([[36, 12], [39, 9], [36, 18], [33, 18]], C.stonePale),
    P([[54, 30], [63, 36], [54, 42], [45, 39], [45, 33]], C.ink),
    P([[57, 36], [60, 36], [54, 39], [48, 36]], C.iceBright),
    P([[33, 63], [30, 54], [36, 48], [42, 54], [39, 63]], C.ink),
    P([[36, 60], [33, 57], [36, 51], [39, 57]], C.goldLight),
    R(30, 33, 12, 3, C.violetLight), R(33, 30, 6, 3, C.tealBright),
  ].join('');
}

function rune(kind) {
  const base = [E(36, 39, 21, 21, C.shadow, .45), P([[36, 12], [57, 33], [36, 57], [15, 33]], C.ink), P([[36, 18], [51, 33], [36, 51], [21, 33]], C.violetDark)];
  if (kind === 'fire') base.push(
    P([[36, 24], [30, 36], [36, 33], [33, 45], [42, 36], [39, 30], [42, 27]], C.fireLight),
    P([[36, 33], [33, 39], [36, 42], [39, 36]], C.goldLight),
    R(18, 33, 6, 3, C.fire), R(48, 33, 6, 3, C.fire),
  );
  if (kind === 'frost') base.push(
    P([[36, 21], [39, 30], [48, 27], [42, 36], [48, 42], [39, 42], [36, 51], [33, 42], [24, 42], [30, 36], [24, 27], [33, 30]], C.iceBright),
    R(34, 30, 4, 12, C.ice), R(30, 34, 12, 4, C.tealBright),
  );
  if (kind === 'boomerang') base.push(
    P([[24, 27], [33, 24], [39, 30], [45, 36], [51, 33], [48, 42], [39, 45], [33, 39], [27, 33]], C.gold),
    P([[27, 27], [33, 27], [39, 33], [45, 36], [42, 39], [36, 36], [30, 30]], C.goldLight),
    R(18, 30, 6, 3, C.cream),
  );
  return base.join('');
}

function projectile(kind) {
  if (kind === 'fire') return [
    E(36, 39, 18, 15, C.fire, .42),
    P([[36, 18], [42, 30], [51, 33], [45, 42], [42, 54], [30, 48], [24, 39], [30, 33]], C.fire),
    P([[36, 27], [42, 36], [39, 42], [42, 45], [33, 42], [33, 36]], C.fireBright),
    R(21, 36, 6, 3, C.fireLight), R(15, 42, 6, 3, C.gold),
  ].join('');
  if (kind === 'frost') return [
    E(36, 36, 17, 17, C.ice, .28),
    P([[36, 12], [42, 30], [54, 36], [42, 42], [36, 60], [30, 42], [18, 36], [30, 30]], C.teal),
    P([[36, 18], [39, 33], [48, 36], [39, 39], [36, 54], [33, 39], [24, 36], [33, 33]], C.iceBright),
    R(33, 30, 6, 12, C.ice), R(30, 33, 12, 6, C.iceLight),
  ].join('');
  if (kind === 'lightning') return [
    E(36, 36, 15, 18, C.gold, .2),
    P([[39, 12], [54, 12], [42, 33], [51, 33], [30, 60], [36, 39], [27, 39]], C.gold),
    P([[39, 18], [48, 18], [36, 36], [45, 36], [33, 51], [36, 36], [30, 36]], C.goldLight),
    R(18, 30, 6, 3, C.iceBright), R(48, 45, 6, 3, C.cream),
  ].join('');
  return [
    E(36, 36, 18, 18, C.violet, .2),
    P([[18, 27], [24, 21], [39, 30], [51, 36], [54, 42], [48, 48], [36, 42], [27, 33]], C.ink),
    P([[21, 27], [24, 24], [36, 30], [48, 36], [48, 42], [45, 45], [36, 39], [27, 33]], C.stonePale),
    P([[24, 27], [30, 30], [33, 33], [30, 36], [24, 33]], C.goldLight),
    R(42, 30, 6, 3, C.iceBright), R(48, 36, 6, 3, C.cream),
  ].join('');
}

function playerBase(pose) {
  const boots = pose === 'side' ? [
    R(27, 54, 9, 9, C.ink), R(39, 54, 9, 9, C.ink),
    R(30, 57, 6, 3, C.woodLight), R(42, 57, 6, 3, C.woodLight),
  ] : [
    R(24, 54, 9, 9, C.ink), R(39, 54, 9, 9, C.ink),
    R(27, 57, 6, 3, C.woodLight), R(42, 57, 6, 3, C.woodLight),
  ];
  return [
    E(36, 63, 18, 3, C.shadow, .55),
    ...boots,
    P([[21, 33], [27, 27], [45, 27], [51, 36], [48, 51], [42, 57], [27, 57], [21, 51]], C.ink),
    P([[24, 36], [30, 30], [42, 30], [48, 36], [45, 48], [39, 54], [30, 54], [24, 48]], C.tealDark),
    P([[30, 36], [36, 33], [42, 36], [42, 45], [36, 51], [30, 48]], C.teal),
    R(24, 39, 6, 9, C.tealDark), R(42, 39, 6, 9, C.tealDark),
    R(27, 45, 18, 3, C.gold), R(33, 45, 6, 3, C.goldLight),
    R(30, 18, 12, 12, C.woodDark),
    P([[24, 21], [30, 15], [42, 15], [48, 24], [45, 33], [27, 33]], C.ink),
    P([[27, 21], [33, 18], [42, 18], [45, 24], [42, 27], [30, 27]], C.woodLight),
    R(30, 24, 3, 3, C.cream), R(39, 24, 3, 3, C.cream),
    R(31, 24, 2, 3, C.ink), R(40, 24, 2, 3, C.ink),
    R(33, 30, 9, 3, C.goldLight), R(36, 30, 3, 3, C.cream),
    R(24, 21, 3, 9, C.fire), R(45, 21, 3, 9, C.fire),
  ].join('');
}

function playerHit() {
  return [
    playerBase('front'),
    P([[21, 12], [27, 15], [24, 21], [18, 18]], C.iceBright),
    P([[54, 18], [60, 21], [54, 27], [51, 24]], C.fireBright),
    R(18, 36, 6, 3, C.cream), R(48, 42, 6, 3, C.cream),
    R(27, 33, 18, 3, C.iceBright, .7),
  ].join('');
}

function playerDeath(frame) {
  return [
    E(36, 60, 24, 5, C.shadow, .55),
    P(frame === 0
      ? [[15, 45], [24, 36], [42, 36], [54, 42], [57, 51], [48, 57], [24, 57], [15, 54]]
      : [[18, 48], [27, 42], [45, 39], [54, 45], [51, 54], [39, 60], [21, 57]], C.ink),
    P(frame === 0
      ? [[21, 45], [27, 39], [42, 39], [51, 45], [51, 51], [45, 54], [24, 54], [18, 51]]
      : [[24, 48], [30, 45], [45, 42], [48, 48], [45, 54], [36, 57], [24, 54]], C.tealDark),
    R(18, 42, 12, 6, C.woodDark), R(21, 42, 9, 3, C.woodLight),
    E(frame === 0 ? 42 : 45, frame === 0 ? 42 : 45, 12, 9, C.ink),
    P([[33, 39], [39, 33], [48, 36], [51, 42], [45, 48], [36, 45]], C.woodLight),
    R(39, 39, 3, 3, C.cream), R(45, 42, 3, 3, C.ink),
    R(27, 54, 9, 3, C.gold), R(42, 54, 6, 3, C.goldLight),
    ...(frame === 0
      ? [P([[15, 30], [18, 24], [21, 30], [27, 33], [21, 36], [18, 42], [15, 36], [9, 33]], C.fireLight)]
      : [R(12, 27, 3, 6, C.iceBright), R(18, 21, 3, 3, C.goldLight), R(54, 33, 6, 3, C.fireLight)]),
  ].join('');
}

function playerAttack(frame) {
  const slash = frame === 0
    ? P([[42, 21], [48, 18], [57, 24], [63, 36], [57, 48], [51, 45], [54, 36], [48, 30]], C.iceBright, .88)
      + P([[45, 27], [51, 24], [57, 33], [54, 42], [51, 39], [51, 33]], C.goldLight)
    : P([[39, 15], [45, 12], [57, 18], [66, 30], [63, 45], [57, 54], [54, 48], [60, 36], [54, 27], [45, 24]], C.iceBright, .85)
      + P([[45, 18], [51, 18], [60, 27], [60, 39], [54, 48], [57, 36], [54, 27]], C.cream);
  return [
    E(33, 63, 18, 3, C.shadow, .55),
    R(frame === 0 ? 21 : 24, 54, 9, 9, C.ink), R(frame === 0 ? 39 : 42, 51, 9, 9, C.ink),
    R(24, 57, 6, 3, C.woodLight), R(42, 54, 6, 3, C.woodLight),
    P([[18, 33], [24, 27], [42, 27], [48, 33], [48, 48], [42, 54], [24, 54], [18, 48]], C.ink),
    P([[21, 36], [27, 30], [39, 30], [45, 36], [42, 48], [39, 51], [27, 51], [21, 45]], C.tealDark),
    P([[27, 36], [33, 33], [39, 36], [39, 45], [33, 48], [27, 45]], C.teal),
    R(24, 39, 6, 9, C.cream), R(42, 36, 9, 6, C.tealDark),
    R(24, 45, 18, 3, C.gold), R(30, 45, 6, 3, C.goldLight),
    P([[27, 21], [33, 15], [45, 18], [48, 27], [42, 33], [27, 30]], C.ink),
    P([[30, 21], [36, 18], [42, 21], [45, 27], [39, 27], [30, 27]], C.woodLight),
    R(33, 24, 3, 3, C.cream), R(42, 24, 3, 3, C.ink),
    P(frame === 0 ? [[42, 36], [51, 27], [54, 30], [45, 42]] : [[42, 36], [54, 24], [57, 27], [45, 42]], C.ink),
    P(frame === 0 ? [[45, 36], [51, 30], [51, 33], [45, 39]] : [[45, 36], [54, 27], [54, 30], [45, 39]], C.stonePale),
    slash,
  ].join('');
}

function playerDash(frame) {
  return [
    ...(frame === 0
      ? [P([[9, 33], [30, 30], [33, 36], [12, 42]], C.teal, .25), P([[15, 42], [30, 39], [33, 45], [18, 48]], C.ice, .35)]
      : [P([[3, 30], [27, 27], [30, 33], [6, 39]], C.teal, .28), P([[9, 42], [27, 39], [30, 45], [12, 48]], C.ice, .4)]),
    E(39, 63, 18, 3, C.shadow, .5),
    P([[27, 45], [33, 36], [48, 33], [54, 39], [48, 48], [36, 54], [24, 54]], C.ink),
    P([[30, 45], [36, 39], [48, 36], [51, 39], [45, 45], [36, 51], [27, 51]], C.tealDark),
    R(33, 42, 9, 3, C.tealLight), R(39, 45, 9, 3, C.gold),
    P([[42, 27], [48, 21], [57, 24], [60, 30], [54, 36], [42, 33]], C.ink),
    P([[45, 27], [51, 24], [57, 27], [54, 30], [45, 30]], C.woodLight),
    R(48, 27, 3, 3, C.cream), R(54, 27, 3, 3, C.ink),
    ...(frame === 0
      ? [R(21, 30, 6, 3, C.goldLight), R(15, 36, 6, 3, C.iceBright)]
      : [R(24, 24, 6, 3, C.goldLight), R(18, 30, 6, 3, C.iceBright), R(9, 36, 6, 3, C.tealLight)]),
  ].join('');
}

function enemyHit() {
  return [
    E(36, 42, 21, 15, C.tealDark),
    P([[18, 42], [24, 30], [33, 27], [45, 30], [54, 39], [51, 51], [42, 57], [24, 54]], C.ink),
    P([[21, 42], [27, 33], [36, 30], [45, 33], [51, 42], [48, 48], [42, 51], [27, 51]], C.moss),
    P([[30, 18], [36, 27], [45, 24], [42, 33], [51, 36], [42, 39], [36, 48], [30, 39], [21, 36], [30, 33], [27, 24]], C.cream),
    P([[33, 27], [36, 33], [42, 30], [39, 36], [42, 39], [36, 36], [33, 42], [33, 36], [27, 36], [33, 33]], C.goldLight),
    R(15, 27, 6, 3, C.iceBright), R(54, 48, 6, 3, C.fireLight),
  ].join('');
}

function enemyDeath(frame) {
  const pieces = frame === 0
    ? [
      P([[18, 39], [27, 33], [33, 36], [30, 45], [24, 48]], C.moss),
      P([[42, 30], [51, 36], [48, 45], [42, 42]], C.tealLight),
      R(30, 24, 6, 6, C.cream), R(39, 48, 6, 3, C.goldLight),
    ]
    : [
      P([[15, 45], [24, 39], [27, 42], [21, 51]], C.moss),
      P([[45, 39], [54, 45], [48, 51], [42, 45]], C.tealLight),
      R(30, 18, 3, 6, C.cream), R(39, 54, 6, 3, C.gold),
      P([[30, 33], [36, 27], [42, 33], [39, 39], [33, 39]], C.ice),
    ];
  return [
    E(36, 54, 24, 6, C.shadow, .3),
    ...pieces,
    R(21, 30, 3, 3, C.fireLight), R(48, 27, 3, 3, C.goldLight),
    R(33, 54, 6, 3, C.teal), R(24, 24, 3, 3, C.iceBright),
  ].join('');
}

const specs = [
  sprite('tile-floor-0', [24, 24], [0, 0], floorBase('plain'), ['tile', 'floor', 'plain']),
  sprite('tile-floor-1', [24, 24], [0, 0], floorBase('cracked'), ['tile', 'floor', 'cracked']),
  sprite('tile-floor-2', [24, 24], [0, 0], floorBase('mossy'), ['tile', 'floor', 'moss']),
  sprite('tile-wall', [24, 24], [0, 0], wallTile(), ['tile', 'wall', 'boundary']),
  sprite('door-open', [64, 32], [.5, .9], door(true), ['door', 'open']),
  sprite('door-closed', [64, 32], [.5, .9], door(false), ['door', 'closed', 'locked']),
  sprite('torch-0', [12, 24], [.5, .94], torch(0), ['prop', 'torch', 'frame-0']),
  sprite('torch-1', [12, 24], [.5, .94], torch(1), ['prop', 'torch', 'frame-1']),
  sprite('trap-idle', [24, 24], [.5, .5], trap('idle'), ['trap', 'idle']),
  sprite('trap-warn', [24, 24], [.5, .5], trap('warn'), ['trap', 'telegraph']),
  sprite('trap-active', [24, 24], [.5, .5], trap('active'), ['trap', 'active']),
  sprite('barrel-intact', [24, 30], [.5, .9], barrel('intact'), ['prop', 'barrel', 'intact']),
  sprite('barrel-cracked', [24, 30], [.5, .9], barrel('cracked'), ['prop', 'barrel', 'cracked']),
  sprite('barrel-broken', [24, 30], [.5, .9], barrel('broken'), ['prop', 'barrel', 'broken']),
  sprite('altar', [56, 56], [.5, .9], altar(), ['prop', 'altar', 'rune']),
  sprite('merchant', [32, 42], [.5, .9], merchant(), ['npc', 'merchant']),
  sprite('weapon-sword', [24, 32], [.5, .58], sword(), ['weapon', 'sword', 'physical']),
  sprite('weapon-fire', [24, 32], [.5, .58], fireStaff(), ['weapon', 'fire', 'staff']),
  sprite('weapon-frost', [24, 32], [.5, .58], frostBow(), ['weapon', 'frost', 'bow']),
  sprite('weapon-lightning', [24, 32], [.5, .58], lightningStaff(), ['weapon', 'lightning', 'staff']),
  sprite('weapon-boomerang', [24, 32], [.5, .58], boomerang(), ['weapon', 'boomerang', 'returning']),
  sprite('weapon-meteor', [32, 32], [.5, .58], meteor(), ['weapon', 'fire', 'evolved', 'meteor']),
  sprite('weapon-blade-ring', [32, 32], [.5, .5], bladeRing(), ['weapon', 'boomerang', 'evolved', 'blade-ring']),
  sprite('rune-fire', [24, 24], [.5, .5], rune('fire'), ['rune', 'fire']),
  sprite('rune-frost', [24, 24], [.5, .5], rune('frost'), ['rune', 'frost']),
  sprite('rune-boomerang', [24, 24], [.5, .5], rune('boomerang'), ['rune', 'boomerang']),
  sprite('projectile-fire', [18, 18], [.5, .5], projectile('fire'), ['projectile', 'fire']),
  sprite('projectile-frost', [20, 20], [.5, .5], projectile('frost'), ['projectile', 'frost']),
  sprite('projectile-lightning', [18, 24], [.5, .5], projectile('lightning'), ['projectile', 'lightning']),
  sprite('projectile-blade', [22, 16], [.5, .5], projectile('blade'), ['projectile', 'blade']),
  sprite('player-hit', [38, 48], [.5, .88], playerHit(), ['player', 'hit']),
  sprite('player-death-0', [38, 48], [.5, .88], playerDeath(0), ['player', 'death', 'frame-0']),
  sprite('player-death-1', [38, 48], [.5, .88], playerDeath(1), ['player', 'death', 'frame-1']),
  sprite('player-attack-0', [38, 48], [.5, .88], playerAttack(0), ['player', 'attack', 'frame-0']),
  sprite('player-attack-1', [38, 48], [.5, .88], playerAttack(1), ['player', 'attack', 'frame-1']),
  sprite('player-dash-0', [38, 48], [.5, .88], playerDash(0), ['player', 'dash', 'frame-0']),
  sprite('player-dash-1', [38, 48], [.5, .88], playerDash(1), ['player', 'dash', 'frame-1']),
  sprite('enemy-hit', [28, 28], [.5, .75], enemyHit(), ['enemy', 'hit', 'generic']),
  sprite('enemy-death-0', [28, 28], [.5, .75], enemyDeath(0), ['enemy', 'death', 'frame-0']),
  sprite('enemy-death-1', [28, 28], [.5, .75], enemyDeath(1), ['enemy', 'death', 'frame-1']),
];

const REQUIRED = [
  'tile-floor-0', 'tile-floor-1', 'tile-floor-2', 'tile-wall', 'door-open', 'door-closed',
  'torch-0', 'torch-1', 'trap-idle', 'trap-warn', 'trap-active',
  'barrel-intact', 'barrel-cracked', 'barrel-broken', 'altar', 'merchant',
  'weapon-sword', 'weapon-fire', 'weapon-frost', 'weapon-lightning', 'weapon-boomerang', 'weapon-meteor', 'weapon-blade-ring',
  'rune-fire', 'rune-frost', 'rune-boomerang',
  'projectile-fire', 'projectile-frost', 'projectile-lightning', 'projectile-blade',
  'player-hit', 'player-death-0', 'player-death-1', 'player-attack-0', 'player-attack-1', 'player-dash-0', 'player-dash-1',
  'enemy-hit', 'enemy-death-0', 'enemy-death-1',
];

function createManifest() {
  if (specs.length !== REQUIRED.length) throw new Error(`expected ${REQUIRED.length} specs, got ${specs.length}`);
  const ids = specs.map(({ id }) => id);
  if (new Set(ids).size !== ids.length) throw new Error('duplicate frame id');
  const missing = REQUIRED.filter((id) => !ids.includes(id));
  const extra = ids.filter((id) => !REQUIRED.includes(id));
  if (missing.length || extra.length) throw new Error(`required frame mismatch; missing=${missing} extra=${extra}`);

  const frames = {};
  specs.forEach((item, index) => {
    const x = (index % COLUMNS) * CELL;
    const y = Math.floor(index / COLUMNS) * CELL;
    const [worldWidth, worldHeight] = item.worldSize;
    if (![worldWidth, worldHeight].every((value) => Number.isFinite(value) && value > 0)) throw new Error(`invalid worldSize: ${item.id}`);
    if (item.anchor.length !== 2 || !item.anchor.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) throw new Error(`invalid normalized anchor: ${item.id}`);
    if (x < 0 || y < 0 || x + CELL > WIDTH || y + CELL > HEIGHT) throw new Error(`atlas crop out of bounds: ${item.id}`);
    frames[item.id] = {
      x, y, width: CELL, height: CELL,
      trim: { x: 0, y: 0, width: CELL, height: CELL },
      worldSize: item.worldSize,
      anchor: item.anchor,
      tags: item.tags,
    };
  });
  return {
    schemaVersion: 1,
    title: 'PixelStreet Dungeon Pixel Art',
    originality: 'All artwork is authored as original vector pixel art in this generator. It uses no third-party images, icons, fonts, or textures.',
    generator: 'scripts/generate-dungeon-art.mjs',
    rebuild: 'node scripts/generate-dungeon-art.mjs',
    render: { tileSize: 24, imageSmoothing: false, svgShapeRendering: 'crispEdges' },
    atlas: { file: 'sprites.svg', width: WIDTH, height: HEIGHT, columns: COLUMNS, rows: ROWS, cellSize: [CELL, CELL], frames },
    animations: {
      torch: ['torch-0', 'torch-1'],
      'player-death': ['player-death-0', 'player-death-1'],
      'player-attack': ['player-attack-0', 'player-attack-1'],
      'player-dash': ['player-dash-0', 'player-dash-1'],
      'enemy-death': ['enemy-death-0', 'enemy-death-1'],
    },
    integration: {
      canvas: 'Load sprites.svg as a local image source and use atlas.frames[id].x/y/width/height as the crop rectangle.',
      placement: 'worldSize is expressed in 24-unit dungeon world coordinates; anchor is normalized within the 72x72 source frame.',
      pixels: 'Use nearest-neighbor sampling and disable image smoothing. Tiles use [0,0] anchors; standing props and characters use feet/baseline anchors.',
      states: 'Doors, traps, destructible barrels, and hit/death frames are separate explicit state frames; gameplay owns state timing.',
    },
  };
}

function createSvg() {
  const body = specs.map((item, index) => {
    const x = (index % COLUMNS) * CELL;
    const y = Math.floor(index / COLUMNS) * CELL;
    return `<g id="${item.id}" transform="translate(${x} ${y})">${item.draw}</g>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" shape-rendering="crispEdges" image-rendering="pixelated" role="img" aria-label="Original PixelStreet dungeon sprite atlas">\n<title>PixelStreet Dungeon Atlas</title>\n${body}\n</svg>\n`;
}

function sha256(text) { return createHash('sha256').update(text, 'utf8').digest('hex'); }
const manifestText = `${JSON.stringify(createManifest(), null, 2)}\n`;
const svgText = createSvg();
fs.mkdirSync(OUT, { recursive: true });
for (const [name, text] of [['sprites.svg', svgText], ['manifest.json', manifestText]]) {
  fs.writeFileSync(path.join(OUT, name), text, 'utf8');
}
for (const [name, text] of [['sprites.svg', svgText], ['manifest.json', manifestText]]) {
  console.log(`${sha256(text)}  assets/dungeon/${name}`);
}
console.log(`Generated ${specs.length} frames in ${WIDTH}x${HEIGHT} atlas; required keys and crop bounds verified.`);
