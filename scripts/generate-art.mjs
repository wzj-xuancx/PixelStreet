import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = path.join(ROOT, 'assets');
const SCALE = 2;

const C = {
  ink: '#10171e',
  inkSoft: '#25343b',
  basaltDeep: '#111a20',
  plasterLight: '#69787c',
  plaster: '#46565c',
  plasterShade: '#33434a',
  terracottaLight: '#ffb765',
  terracotta: '#df7746',
  terracottaShade: '#a44939',
  tealLight: '#8df4e4',
  teal: '#45b9ac',
  tealShade: '#1d6d76',
  woodLight: '#b78250',
  wood: '#765039',
  woodShade: '#44332d',
  glassLight: '#fff0b4',
  glass: '#f1b85c',
  glassShade: '#bd633c',
  leafLight: '#91b989',
  leaf: '#527c70',
  leafShade: '#345551',
  mintLight: '#c4fff0',
  mint: '#64dfc1',
  mintShade: '#259d91',
  lilacLight: '#c1d5d7',
  lilac: '#71949d',
  lilacShade: '#405865',
  roadLight: '#56636a',
  road: '#35424a',
  roadShade: '#202b33',
  dusk: '#151f27',
};

function rgba(hex, alpha = 255) {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, alpha];
}

function canvas(w, h) {
  return { w, h, data: new Uint8Array(w * h * 4) };
}

function pixel(c, x, y, color, alpha = 255) {
  if (x < 0 || y < 0 || x >= c.w || y >= c.h) return;
  const [r, g, b, a] = Array.isArray(color) ? color : rgba(color, alpha);
  const i = (y * c.w + x) * 4;
  c.data[i] = r;
  c.data[i + 1] = g;
  c.data[i + 2] = b;
  c.data[i + 3] = a;
}

function rect(c, x, y, w, h, color, alpha = 255) {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) pixel(c, xx, yy, color, alpha);
  }
}

function hline(c, x, y, w, color, alpha = 255) { rect(c, x, y, w, 1, color, alpha); }
function vline(c, x, y, h, color, alpha = 255) { rect(c, x, y, 1, h, color, alpha); }

function polygon(c, points, color) {
  let minY = c.h;
  let maxY = -1;
  for (const [, y] of points) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  for (let y = minY; y <= maxY; y++) {
    const hits = [];
    for (let i = 0; i < points.length; i++) {
      const [x1, y1] = points[i];
      const [x2, y2] = points[(i + 1) % points.length];
      if ((y1 <= y && y < y2) || (y2 <= y && y < y1)) {
        hits.push(Math.floor(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1)));
      }
    }
    hits.sort((a, b) => a - b);
    for (let i = 0; i + 1 < hits.length; i += 2) {
      hline(c, hits[i], y, hits[i + 1] - hits[i] + 1, color);
    }
  }
}

function outlinedRect(c, x, y, w, h, fill, outline = C.ink) {
  rect(c, x, y, w, h, outline);
  rect(c, x + 1, y + 1, w - 2, h - 2, fill);
}

const FONT = {
  A: ['010', '101', '111', '101', '101'], B: ['110', '101', '110', '101', '110'],
  C: ['011', '100', '100', '100', '011'], D: ['110', '101', '101', '101', '110'],
  E: ['111', '100', '110', '100', '111'], F: ['111', '100', '110', '100', '100'],
  G: ['011', '100', '101', '101', '011'], H: ['101', '101', '111', '101', '101'],
  I: ['111', '010', '010', '010', '111'], J: ['001', '001', '001', '101', '010'],
  K: ['101', '101', '110', '101', '101'], L: ['100', '100', '100', '100', '111'],
  M: ['101', '111', '111', '101', '101'], N: ['101', '111', '111', '111', '101'],
  O: ['010', '101', '101', '101', '010'], P: ['110', '101', '110', '100', '100'],
  Q: ['010', '101', '101', '111', '011'], R: ['110', '101', '110', '101', '101'],
  S: ['011', '100', '010', '001', '110'], T: ['111', '010', '010', '010', '010'],
  U: ['101', '101', '101', '101', '111'], V: ['101', '101', '101', '101', '010'],
  W: ['101', '101', '111', '111', '101'], X: ['101', '101', '010', '101', '101'],
  Y: ['101', '101', '010', '010', '010'], Z: ['111', '001', '010', '100', '111'],
};

function text(c, value, x, y, color) {
  let dx = x;
  for (const ch of value.toUpperCase()) {
    if (ch === ' ') { dx += 3; continue; }
    const rows = FONT[ch] ?? FONT.O;
    for (let yy = 0; yy < rows.length; yy++) {
      for (let xx = 0; xx < rows[yy].length; xx++) {
        if (rows[yy][xx] === '1') pixel(c, dx + xx, y + yy, color);
      }
    }
    dx += 4;
  }
}

function drawRoof(c, kind) {
  // A stepped basalt vault frames each shop. Warm and cool light comes from
  // the shop fixtures below it rather than from a different colored roof.
  rect(c, 0, 12, 112, 6, C.ink);
  rect(c, 3, 8, 106, 9, C.plasterShade);
  rect(c, 8, 4, 96, 10, C.plaster);
  rect(c, 15, 1, 82, 9, C.plasterLight);
  rect(c, 20, 0, 72, 6, C.plaster);
  hline(c, 21, 0, 70, C.plasterLight);
  for (let x = 26; x < 90; x += 16) vline(c, x, 2, 3, C.plasterShade);
  hline(c, 7, 14, 98, C.inkSoft);
  if (kind === 'bakery') {
    pixel(c, 8, 10, C.glassLight);
    pixel(c, 103, 10, C.glassLight);
  } else {
    pixel(c, 8, 10, C.tealLight);
    pixel(c, 103, 10, C.tealLight);
  }
}

function drawLantern(c, x, y) {
  vline(c, x + 3, y - 4, 5, C.ink);
  hline(c, x + 1, y, 5, C.woodLight);
  outlinedRect(c, x, y + 1, 7, 9, C.glassShade);
  rect(c, x + 2, y + 3, 3, 5, C.glass);
  pixel(c, x + 3, y + 4, C.glassLight);
  pixel(c, x + 4, y + 6, C.terracottaLight);
  hline(c, x + 1, y + 10, 5, C.ink);
}

function drawTorch(c, x, y) {
  rect(c, x + 2, y + 8, 3, 10, C.woodShade);
  hline(c, x, y + 8, 7, C.ink);
  hline(c, x + 1, y + 7, 5, C.woodLight);
  rect(c, x + 2, y + 3, 3, 5, C.terracotta);
  pixel(c, x + 3, y + 1, C.glassLight);
  pixel(c, x + 2, y + 2, C.terracottaLight);
  pixel(c, x + 4, y + 2, C.glass);
  hline(c, x + 1, y + 18, 5, C.ink);
}

function drawCrystal(c, x, y, size = 1) {
  const h = 7 * size;
  polygon(c, [
    [x + 2 * size, y], [x + 5 * size, y + 2 * size],
    [x + 4 * size, y + h], [x + size, y + h - size], [x, y + 2 * size],
  ], C.tealShade);
  vline(c, x + 2 * size, y + 2 * size, h - 3 * size, C.tealLight);
  pixel(c, x + 3 * size, y + size, C.mintLight);
}

function drawWindow(c, x, y, w, h, warm = true, paneCount = 2) {
  outlinedRect(c, x, y, w, h, C.basaltDeep);
  rect(c, x + 2, y + 2, w - 4, h - 4, warm ? C.woodShade : C.inkSoft);
  rect(c, x + 3, y + 3, Math.max(2, Math.floor(w / 3)), 2, warm ? C.glassLight : C.tealLight);
  if (warm) {
    rect(c, x + 3, y + 6, w - 6, h - 10, C.glassShade);
    rect(c, x + 4, y + 7, w - 8, h - 12, C.glass);
    hline(c, x + 5, y + 8, Math.max(1, w - 11), C.glassLight);
  } else {
    rect(c, x + 3, y + 6, w - 6, h - 10, C.tealShade);
    rect(c, x + 4, y + 7, w - 8, h - 12, C.teal);
    pixel(c, x + 6, y + 8, C.mintLight);
  }
  if (paneCount === 2) vline(c, x + Math.floor(w / 2), y + 1, h - 2, C.plasterShade);
  else {
    vline(c, x + Math.floor(w / 3), y + 1, h - 2, C.plasterShade);
    vline(c, x + Math.floor((w * 2) / 3), y + 1, h - 2, C.plasterShade);
  }
  hline(c, x + 1, y + Math.floor(h / 2), w - 2, C.plasterShade);
  rect(c, x - 2, y + h, w + 4, 2, C.ink);
  hline(c, x - 1, y + h, w + 2, C.plasterLight);
}

function drawDoor(c, x, y, w, h, color) {
  outlinedRect(c, x, y, w, h, C.plasterShade);
  rect(c, x + 2, y + 2, w - 4, h - 3, C.basaltDeep);
  rect(c, x + 3, y + 3, w - 6, 2, C.inkSoft);
  // One heavy timber leaf sits half open, with a deep unlit passage behind it.
  const leafW = Math.floor((w - 7) * 0.62);
  rect(c, x + 3, y + 7, leafW, h - 10, color);
  rect(c, x + 4, y + 8, leafW - 2, h - 12, C.wood);
  vline(c, x + 5 + Math.floor(leafW / 2), y + 9, h - 14, C.woodShade);
  hline(c, x + 4, y + Math.floor(h * 0.52), leafW - 2, C.woodLight);
  rect(c, x + 4, y + h - 6, leafW - 2, 2, C.woodShade);
  pixel(c, x + 3 + leafW - 2, y + Math.floor(h * 0.58), C.glassLight);
  hline(c, x + 1, y + h - 1, w - 2, C.plasterLight);
  rect(c, x - 2, y + h, w + 4, 2, C.ink);
}

function drawCaveWall(c) {
  rect(c, 0, 17, 112, 69, C.ink);
  rect(c, 2, 18, 108, 66, C.plasterShade);
  rect(c, 9, 18, 94, 64, C.plaster);
  // Irregular block joints keep the façade read as cut basalt, not plaster.
  for (const y of [27, 38, 50, 62, 75]) hline(c, 10, y, 92, C.plasterShade);
  for (const x of [20, 39, 57, 77, 95]) vline(c, x, 19, 8, C.plasterShade);
  for (const x of [29, 48, 68, 87]) vline(c, x, 28, 10, C.plasterShade);
  for (const x of [17, 36, 58, 78, 98]) vline(c, x, 39, 11, C.plasterShade);
  for (const x of [27, 48, 70, 90]) vline(c, x, 51, 11, C.plasterShade);
  rect(c, 2, 17, 7, 67, C.plasterShade);
  rect(c, 103, 17, 7, 67, C.plasterShade);
  for (const y of [25, 41, 57, 73]) {
    hline(c, 3, y, 5, C.plasterLight);
    hline(c, 104, y, 5, C.plasterLight);
  }
  rect(c, 0, 82, 112, 6, C.ink);
  rect(c, 3, 82, 106, 3, C.plasterShade);
  hline(c, 4, 82, 104, C.plasterLight);
}

function drawShopSign(c, kind) {
  outlinedRect(c, 25, 18, 62, 15, C.woodShade, C.ink);
  rect(c, 27, 20, 58, 11, C.wood);
  hline(c, 28, 20, 56, C.woodLight);
  pixel(c, 28, 22, C.glassLight);
  pixel(c, 83, 22, C.glassLight);
  if (kind === 'bakery') {
    // Leave a single large, scored-loaf symbol for the freestanding sign.
    polygon(c, [[43, 28], [44, 24], [48, 21], [60, 21], [65, 25], [65, 29], [43, 29]], C.glass);
    hline(c, 46, 22, 15, C.glassLight);
    vline(c, 49, 23, 4, C.terracotta);
    vline(c, 55, 22, 5, C.terracotta);
    pixel(c, 61, 24, C.terracotta);
  } else {
    // A larger flask silhouette is legible without a tiny roof label.
    rect(c, 53, 21, 6, 3, C.plasterLight);
    rect(c, 54, 23, 4, 3, C.plasterLight);
    polygon(c, [[54, 25], [58, 25], [64, 29], [64, 30], [48, 30], [48, 29]], C.tealShade);
    rect(c, 50, 28, 12, 2, C.tealLight);
    pixel(c, 54, 27, C.mintLight);
  }
}

function drawBakery(c) {
  drawRoof(c, 'bakery');
  drawCaveWall(c);
  drawShopSign(c, 'bakery');
  drawLantern(c, 92, 35);
  drawTorch(c, 7, 34);
  drawWindow(c, 17, 46, 44, 27, true, 2);
  drawDoor(c, 77, 43, 23, 39, C.woodLight);
  // Warm bread trays sit behind the recessed service window.
  hline(c, 21, 66, 36, C.woodShade);
  rect(c, 23, 62, 8, 4, C.terracotta);
  hline(c, 24, 61, 5, C.glassLight);
  rect(c, 34, 60, 9, 6, C.glass);
  pixel(c, 36, 59, C.glassLight);
  pixel(c, 40, 59, C.glassLight);
  rect(c, 46, 62, 8, 4, C.terracottaShade);
  hline(c, 47, 61, 5, C.glass);
  outlinedRect(c, 62, 73, 11, 8, C.woodShade);
  rect(c, 64, 75, 7, 4, C.terracotta);
  rect(c, 64, 74, 6, 1, C.glassLight);
  rect(c, 94, 73, 10, 8, C.woodShade);
  hline(c, 96, 75, 6, C.woodLight);
  return c;
}

function drawBottle(c, x, y, color, height = 8) {
  rect(c, x + 2, y, 3, 1, C.ink);
  rect(c, x + 1, y + 1, 5, 2, C.plasterLight);
  rect(c, x, y + 3, 7, height - 3, C.ink);
  rect(c, x + 1, y + 4, 5, height - 5, color);
  pixel(c, x + 2, y + 4, C.mintLight);
}

function drawAlchemy(c) {
  drawRoof(c, 'alchemy');
  drawCaveWall(c);
  drawShopSign(c, 'alchemy');
  drawLantern(c, 92, 35);
  drawTorch(c, 7, 34);
  drawWindow(c, 17, 46, 47, 27, false, 3);
  drawDoor(c, 78, 43, 23, 39, C.tealShade);
  // Stoppered bottles, crystal light, and a cauldron identify the apothecary.
  hline(c, 20, 66, 40, C.woodShade);
  drawBottle(c, 22, 56, C.lilac, 9);
  drawBottle(c, 34, 53, C.mintShade, 12);
  drawBottle(c, 47, 57, C.terracotta, 8);
  pixel(c, 55, 53, C.glassLight);
  pixel(c, 56, 54, C.glassLight);
  pixel(c, 57, 55, C.glassLight);
  pixel(c, 55, 56, C.glassLight);
  pixel(c, 54, 55, C.glassLight);
  outlinedRect(c, 64, 73, 11, 8, C.ink);
  rect(c, 66, 75, 7, 4, C.tealShade);
  hline(c, 65, 73, 9, C.plasterLight);
  drawCrystal(c, 69, 64);
  drawCrystal(c, 73, 67, 1);
  rect(c, 94, 73, 10, 8, C.woodShade);
  rect(c, 96, 75, 6, 4, C.tealLight);
  pixel(c, 98, 75, C.mintLight);
  return c;
}

function drawInterior(c) {
  // Straight-on cross-section of the shared camp shop: stone walls, a warm
  // oven, potion stock, and one sturdy timber counter.
  rect(c, 0, 0, 112, 88, C.ink);
  rect(c, 2, 2, 108, 84, C.plasterShade);
  rect(c, 5, 5, 102, 47, C.plaster);
  for (const y of [13, 25, 39, 51]) hline(c, 6, y, 100, C.plasterShade);
  for (const x of [17, 39, 61, 84, 102]) vline(c, x, 6, 7, C.plasterShade);
  for (const x of [27, 50, 73, 94]) vline(c, x, 14, 11, C.plasterShade);
  for (const x of [16, 38, 62, 83, 102]) vline(c, x, 26, 12, C.plasterShade);
  outlinedRect(c, 40, 5, 33, 12, C.woodShade);
  rect(c, 42, 7, 29, 8, C.wood);
  text(c, 'CAMP', 47, 9, C.glassLight);
  drawTorch(c, 7, 6);
  drawTorch(c, 98, 6);
  // Upper shelf carries bottles; the oven and cauldron split the lower shelf.
  rect(c, 8, 27, 96, 3, C.woodShade);
  rect(c, 9, 27, 94, 1, C.woodLight);
  rect(c, 8, 44, 96, 3, C.woodShade);
  rect(c, 9, 44, 94, 1, C.woodLight);
  drawBottle(c, 15, 18, C.mintShade, 9);
  drawBottle(c, 29, 19, C.lilac, 8);
  drawBottle(c, 43, 18, C.terracotta, 9);
  drawBottle(c, 82, 19, C.tealLight, 8);
  drawBottle(c, 96, 18, C.lilacShade, 9);
  outlinedRect(c, 13, 32, 26, 11, C.basaltDeep);
  rect(c, 16, 35, 20, 6, C.glassShade);
  rect(c, 18, 36, 16, 4, C.glass);
  pixel(c, 22, 37, C.glassLight);
  pixel(c, 30, 37, C.glassLight);
  outlinedRect(c, 72, 33, 18, 10, C.tealShade);
  rect(c, 75, 36, 12, 5, C.teal);
  rect(c, 77, 31, 8, 2, C.ink);
  hline(c, 74, 43, 14, C.woodLight);
  drawCrystal(c, 57, 32);
  // Thick counter and display case anchor the room to the same ground plane.
  rect(c, 4, 54, 104, 4, C.ink);
  rect(c, 5, 54, 102, 2, C.woodLight);
  rect(c, 7, 58, 98, 23, C.woodShade);
  rect(c, 9, 59, 94, 3, C.wood);
  outlinedRect(c, 14, 61, 35, 15, C.ink);
  rect(c, 16, 63, 31, 10, C.glassShade);
  hline(c, 17, 64, 28, C.glassLight);
  rect(c, 19, 69, 7, 3, C.terracotta);
  rect(c, 31, 67, 8, 5, C.terracottaShade);
  rect(c, 42, 69, 4, 3, C.glass);
  rect(c, 61, 62, 29, 14, C.basaltDeep);
  rect(c, 63, 64, 25, 10, C.plasterShade);
  rect(c, 66, 66, 7, 2, C.wood);
  rect(c, 77, 66, 8, 2, C.wood);
  rect(c, 9, 78, 94, 2, C.ink);
  for (let x = 16; x < 100; x += 21) {
    rect(c, x, 80, 12, 1, C.woodLight);
    pixel(c, x + 5, 80, C.glassLight);
  }
  rect(c, 2, 83, 108, 3, C.ink);
  return c;
}

function drawInteriorCaveBase(c) {
  // Interior plates show a room cut through the cave: no shopfront, sign, or door.
  rect(c, 0, 0, 112, 88, C.basaltDeep);
  rect(c, 0, 13, 112, 52, C.plasterShade);
  rect(c, 5, 10, 102, 54, C.plaster);
  rect(c, 12, 5, 88, 58, C.plasterShade);
  rect(c, 17, 4, 78, 58, C.plaster);
  // Exposed stone blocks in the back wall and arch.
  hline(c, 7, 18, 98, C.plasterShade);
  hline(c, 6, 31, 100, C.plasterShade);
  hline(c, 6, 45, 100, C.plasterShade);
  hline(c, 5, 58, 102, C.plasterShade);
  for (const x of [18, 38, 59, 81, 101]) vline(c, x, 11, 7, C.plasterShade);
  for (const x of [27, 49, 71, 92]) vline(c, x, 19, 12, C.plasterShade);
  for (const x of [17, 40, 62, 84, 103]) vline(c, x, 32, 12, C.plasterShade);
  for (const x of [28, 50, 73, 95]) vline(c, x, 46, 11, C.plasterShade);
  // The flagstone floor runs across the whole cutaway and shares the shop baseline.
  rect(c, 0, 62, 112, 26, C.roadShade);
  rect(c, 0, 64, 112, 22, C.road);
  hline(c, 0, 73, 112, C.roadShade);
  hline(c, 0, 74, 112, C.roadLight);
  for (const x of [17, 38, 60, 82, 103]) vline(c, x, 65, 8, C.roadShade);
  for (const x of [8, 29, 51, 73, 95]) vline(c, x, 75, 10, C.roadShade);
  hline(c, 4, 86, 104, C.ink);
  return c;
}

function drawInteriorLoaf(c, x, y) {
  polygon(c, [[x, y + 5], [x + 1, y + 2], [x + 4, y], [x + 8, y], [x + 11, y + 3], [x + 11, y + 6], [x, y + 6]], C.terracottaShade);
  hline(c, x + 2, y + 1, 7, C.glassLight);
  vline(c, x + 3, y + 2, 3, C.glass);
  vline(c, x + 7, y + 1, 4, C.glass);
}

function drawBakeryInterior() {
  const c = drawInteriorCaveBase(canvas(112, 88));
  drawTorch(c, 7, 28);
  drawTorch(c, 98, 27);

  // A large stone arch oven dominates this room.
  rect(c, 8, 31, 42, 28, C.ink);
  rect(c, 10, 27, 38, 32, C.plasterShade);
  rect(c, 14, 22, 30, 37, C.plasterShade);
  rect(c, 19, 19, 20, 40, C.plasterLight);
  rect(c, 12, 32, 34, 25, C.ink);
  rect(c, 16, 27, 26, 30, C.ink);
  rect(c, 21, 24, 16, 33, C.basaltDeep);
  hline(c, 15, 25, 28, C.plasterLight);
  hline(c, 12, 31, 34, C.plasterLight);
  vline(c, 15, 33, 21, C.plasterLight);
  vline(c, 43, 33, 21, C.plasterShade);
  rect(c, 20, 44, 18, 11, C.glassShade);
  rect(c, 22, 47, 14, 7, C.terracotta);
  pixel(c, 25, 46, C.glassLight);
  pixel(c, 31, 45, C.glassLight);
  pixel(c, 34, 47, C.glass);
  hline(c, 17, 57, 23, C.woodLight);
  // Chimney flue rises into the cave ceiling above the oven.
  rect(c, 23, 12, 12, 9, C.plasterShade);
  rect(c, 26, 9, 6, 5, C.inkSoft);
  hline(c, 22, 12, 14, C.plasterLight);

  // Back shelves carry baked loaves; no potion shapes appear in this room.
  rect(c, 56, 24, 49, 3, C.woodShade);
  hline(c, 57, 24, 47, C.woodLight);
  rect(c, 57, 40, 48, 3, C.woodShade);
  hline(c, 58, 40, 46, C.woodLight);
  rect(c, 60, 19, 13, 5, C.wood);
  rect(c, 83, 19, 16, 5, C.wood);
  drawInteriorLoaf(c, 61, 17);
  drawInteriorLoaf(c, 76, 33);
  drawInteriorLoaf(c, 89, 17);
  drawInteriorLoaf(c, 93, 33);
  // Flour bowl and dough board sit on the heavy preparation bench.
  rect(c, 52, 53, 55, 4, C.ink);
  rect(c, 54, 51, 51, 3, C.woodLight);
  rect(c, 55, 57, 49, 10, C.woodShade);
  rect(c, 58, 58, 44, 2, C.wood);
  rect(c, 65, 44, 22, 6, C.woodShade);
  rect(c, 67, 45, 18, 4, C.plasterLight);
  polygon(c, [[72, 45], [75, 43], [79, 43], [82, 46], [81, 48], [72, 48]], C.glass);
  hline(c, 74, 44, 6, C.glassLight);
  outlinedRect(c, 90, 45, 9, 5, C.woodShade);
  drawInteriorLoaf(c, 89, 43);
  return c;
}

function drawAlchemyInterior() {
  const c = drawInteriorCaveBase(canvas(112, 88));
  drawTorch(c, 7, 28);
  // Mineral clusters cast cool light across a tall ingredient rack.
  drawCrystal(c, 14, 18, 2);
  drawCrystal(c, 20, 22);
  drawCrystal(c, 93, 16, 2);
  rect(c, 57, 22, 49, 3, C.woodShade);
  hline(c, 58, 22, 47, C.woodLight);
  rect(c, 59, 38, 46, 3, C.woodShade);
  hline(c, 60, 38, 44, C.woodLight);
  rect(c, 59, 52, 47, 3, C.woodShade);
  hline(c, 60, 52, 45, C.woodLight);
  drawBottle(c, 61, 13, C.tealLight, 8);
  drawBottle(c, 74, 14, C.lilac, 7);
  drawBottle(c, 88, 13, C.mintShade, 8);
  drawBottle(c, 63, 29, C.terracotta, 8);
  drawBottle(c, 78, 28, C.teal, 9);
  drawBottle(c, 94, 29, C.lilacShade, 8);

  // A broad bubbling cauldron is the room's unmistakable center.
  polygon(c, [[13, 47], [18, 43], [47, 43], [53, 47], [50, 60], [44, 66], [22, 66], [16, 60]], C.ink);
  polygon(c, [[17, 48], [21, 46], [45, 46], [49, 48], [46, 58], [41, 62], [25, 62], [20, 58]], C.tealShade);
  hline(c, 15, 47, 36, C.plasterLight);
  hline(c, 17, 49, 32, C.inkSoft);
  rect(c, 20, 51, 27, 8, C.teal);
  hline(c, 22, 51, 22, C.tealLight);
  pixel(c, 26, 50, C.mintLight);
  pixel(c, 37, 48, C.mintLight);
  pixel(c, 43, 52, C.glassLight);
  vline(c, 22, 63, 4, C.ink);
  vline(c, 42, 63, 4, C.ink);
  rect(c, 19, 66, 7, 2, C.plasterLight);
  rect(c, 40, 66, 7, 2, C.plasterLight);
  // A small retort and bench complete the brewing station.
  rect(c, 56, 57, 51, 4, C.ink);
  rect(c, 58, 55, 47, 3, C.woodLight);
  rect(c, 60, 61, 44, 8, C.woodShade);
  rect(c, 68, 44, 10, 8, C.basaltDeep);
  rect(c, 71, 41, 4, 4, C.plasterLight);
  rect(c, 70, 47, 6, 4, C.tealLight);
  pixel(c, 72, 47, C.mintLight);
  drawCrystal(c, 85, 44);
  return c;
}

function drawGround(c) {
  rect(c, 0, 0, 16, 16, C.road);
  rect(c, 0, 0, 16, 2, C.roadLight);
  hline(c, 0, 2, 16, C.inkSoft);
  // Cut basalt pavers use dark joints and sparse cool glints.
  hline(c, 0, 7, 16, C.roadShade);
  hline(c, 0, 8, 16, C.roadLight);
  vline(c, 4, 3, 4, C.roadShade);
  vline(c, 12, 9, 6, C.roadShade);
  hline(c, 5, 4, 5, C.roadLight);
  hline(c, 1, 11, 8, C.roadLight);
  pixel(c, 2, 5, C.plasterLight);
  pixel(c, 10, 13, C.plasterShade);
  pixel(c, 14, 5, C.tealShade);
  pixel(c, 7, 14, C.inkSoft);
  return c;
}

function drawPlayer(pose = -1) {
  const c = canvas(24, 32);
  const step = pose < 0 ? 0 : pose;
  const footPairs = [[4, 14], [7, 12], [14, 4], [12, 7]];
  const arms = [[0, 1], [0, -1], [0, -2], [0, 2]];
  const [leftFoot, rightFoot] = footPairs[step];
  const [, rightArm] = arms[step];
  // A hooded delver with a short teal mantle, travel boots, and a hand lantern.
  polygon(c, [[8, 3], [10, 1], [15, 1], [18, 4], [19, 10], [17, 14], [7, 14], [5, 11], [6, 5]], C.ink);
  polygon(c, [[8, 4], [10, 2], [14, 2], [17, 5], [17, 9], [15, 12], [8, 12], [7, 9], [7, 6]], C.lilacShade);
  rect(c, 8, 6, 8, 6, C.plasterShade);
  rect(c, 9, 6, 6, 5, '#d9a982');
  rect(c, 8, 5, 8, 2, C.woodShade);
  pixel(c, 9, 6, C.woodLight);
  pixel(c, 14, 6, C.woodLight);
  pixel(c, 10, 9, C.ink);
  pixel(c, 14, 9, C.ink);
  hline(c, 11, 11, 3, C.terracottaShade);
  pixel(c, 6, 8, C.lilac);
  pixel(c, 17, 8, C.lilac);
  // The left arm stays near the lantern; the right sleeve swings while walking.
  polygon(c, [[6, 14], [9, 14], [8, 19], [5, 20], [3, 18]], C.ink);
  polygon(c, [[15, 14], [18, 14], [21, 18 + rightArm], [19, 20 + rightArm], [16, 19 + rightArm]], C.ink);
  rect(c, 3, 18, 3, 3, '#d9a982');
  rect(c, 18, 18 + rightArm, 3, 3, '#d9a982');
  // The mantle leaves a narrow tunic panel and belt visible at native size.
  polygon(c, [[7, 13], [17, 13], [19, 17], [21, 26], [19, 29], [5, 29], [3, 26], [5, 17]], C.ink);
  polygon(c, [[8, 14], [16, 14], [18, 18], [19, 25], [17, 27], [7, 27], [5, 25], [6, 18]], C.lilacShade);
  polygon(c, [[8, 16], [11, 17], [10, 25], [7, 26], [6, 24], [7, 18]], C.tealShade);
  polygon(c, [[13, 16], [16, 15], [18, 19], [18, 24], [16, 26], [13, 24]], C.teal);
  hline(c, 7, 26, 11, C.plasterLight);
  pixel(c, 12, 19, C.glassLight);
  hline(c, 6, 23, 12, C.woodShade);
  rect(c, 15, 21, 4, 5, C.terracottaShade);
  pixel(c, 16, 22, C.glassLight);
  // Two distinct dark boots keep the baseline readable across all four poses.
  rect(c, leftFoot, 28, 3, 2, C.woodShade);
  rect(c, rightFoot, 28, 3, 2, C.woodShade);
  rect(c, leftFoot - 1, 30, 5, 1, C.ink);
  rect(c, rightFoot - 1, 30, 5, 1, C.ink);
  pixel(c, leftFoot, 29, C.woodLight);
  pixel(c, rightFoot, 29, C.woodLight);
  drawLantern(c, 0, 19);
  return c;
}

function drawSlime(phase) {
  const c = canvas(24, 16);
  const forms = [
    { left: 1, right: 22, top: 5, shoulder: 8 },
    { left: 4, right: 19, top: 1, shoulder: 4 },
    { left: 1, right: 22, top: 4, shoulder: 7 },
    { left: 3, right: 20, top: 2, shoulder: 5 },
  ];
  const f = forms[phase];
  const outline = [[12, f.top], [16, f.top + 1], [19, f.shoulder], [f.right, 11], [f.right - 1, 14], [4, 14], [f.left + 1, 12], [f.left, 10], [7, f.shoulder]];
  polygon(c, outline, C.ink);
  const inset = [[12, f.top + 1], [15, f.top + 2], [18, f.shoulder + 1], [f.right - 2, 11], [f.right - 2, 13], [4, 13], [f.left + 2, 11], [8, f.shoulder + 1]];
  polygon(c, inset, C.mintShade);
  if (phase % 2 === 0) {
    rect(c, 7, f.top + 4, 10, 6, C.mint, 226);
    rect(c, 8, f.top + 3, 6, 2, C.mintLight, 236);
  } else {
    rect(c, 8, f.top + 3, 8, 7, C.mint, 226);
    rect(c, 9, f.top + 2, 5, 2, C.mintLight, 236);
  }
  pixel(c, 9, 10, C.ink);
  pixel(c, 15, 10, C.ink);
  hline(c, 11, 12, 3, C.inkSoft);
  pixel(c, 12, f.top + 3, C.glassLight, 220);
  pixel(c, 13, f.top + 4, C.tealLight, 230);
  pixel(c, 5, 12, C.mintLight, 230);
  pixel(c, 18, 8, C.mintLight, 230);
  if (phase === 1) {
    pixel(c, 19, 2, C.mintLight, 230);
    pixel(c, 20, 0, C.mintLight, 220);
  } else if (phase === 3) {
    pixel(c, 4, 3, C.mintLight, 230);
    pixel(c, 2, 1, C.mintLight, 220);
  }
  return c;
}

function blit(dst, src, x, y) {
  for (let sy = 0; sy < src.h; sy++) {
    for (let sx = 0; sx < src.w; sx++) {
      const si = (sy * src.w + sx) * 4;
      const alpha = src.data[si + 3];
      if (!alpha) continue;
      const di = ((y + sy) * dst.w + x + sx) * 4;
      if (alpha === 255 || dst.data[di + 3] === 0) {
        dst.data[di] = src.data[si];
        dst.data[di + 1] = src.data[si + 1];
        dst.data[di + 2] = src.data[si + 2];
        dst.data[di + 3] = alpha;
      } else {
        const oldA = dst.data[di + 3] / 255;
        const a = alpha / 255;
        const outA = a + oldA * (1 - a);
        for (let k = 0; k < 3; k++) dst.data[di + k] = Math.round((src.data[si + k] * a + dst.data[di + k] * oldA * (1 - a)) / outA);
        dst.data[di + 3] = Math.round(outA * 255);
      }
    }
  }
}

function scaleCanvas(src, scale) {
  const dst = canvas(src.w * scale, src.h * scale);
  for (let y = 0; y < dst.h; y++) {
    for (let x = 0; x < dst.w; x++) {
      const si = (Math.floor(y / scale) * src.w + Math.floor(x / scale)) * 4;
      const di = (y * dst.w + x) * 4;
      dst.data.set(src.data.subarray(si, si + 4), di);
    }
  }
  return dst;
}

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const body = Buffer.concat([name, data]);
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, tail]);
}

function png(c) {
  const raw = Buffer.alloc((c.w * 4 + 1) * c.h);
  for (let y = 0; y < c.h; y++) {
    const offset = y * (c.w * 4 + 1);
    raw[offset] = 0;
    Buffer.from(c.data.buffer, c.data.byteOffset + y * c.w * 4, c.w * 4).copy(raw, offset + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(c.w, 0);
  ihdr.writeUInt32BE(c.h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function drawKeeper(){
  const c=canvas(24,32);rect(c,5,3,14,6,C.glassLight);rect(c,7,1,10,5,C.glassLight);rect(c,7,8,10,8,C.terracottaLight);pixel(c,10,11,C.ink);pixel(c,15,11,C.ink);rect(c,5,16,15,11,C.terracottaShade);rect(c,9,15,9,13,C.glassLight);rect(c,10,19,7,6,C.woodLight);rect(c,6,27,5,4,C.ink);rect(c,15,27,5,4,C.ink);rect(c,3,18,3,7,C.terracottaLight);return c;
}
function drawPortal(phase){
 const c=canvas(64,80);for(let y=2;y<77;y++)for(let x=3;x<62;x++){const dx=x-32,dy=y-39,q=dx*dx/(27*27)+dy*dy/(37*37),inside=dx*dx/(21*21)+dy*dy/(31*31);if(q<=1){if(inside>=1)pixel(c,x,y,(x+y)%9<2?C.plasterLight:C.plasterShade);else{const band=(Math.floor(Math.sqrt(dx*dx+dy*dy)*.55)+phase*2+Math.floor(dy/7))%8;pixel(c,x,y,band<2?'#6c67ac':band<4?'#3b486f':'#202d49',220);}}}
 for(let i=0;i<4;i++){const y=15+i*15;rect(c,7+(i%2)*2,y,3,5,i===phase?C.mintLight:C.teal);rect(c,53-(i%2)*2,y+3,3,5,i===(phase+2)%4?C.mintLight:C.teal);}
 rect(c,3,75,58,5,C.ink);rect(c,6,74,52,3,C.plaster);rect(c,12,72,40,2,C.tealShade);pixel(c,31,27+phase*4,C.mintLight);pixel(c,23+phase*3,47,C.lilacLight);return c;
}
function drawEnemy(phase){const c=drawSlime(phase);for(let i=0;i<c.data.length;i+=4){const [r,g,b]=c.data.slice(i,i+3);if(g>r*1.25&&g>b*.95){c.data[i]=Math.min(255,r+100);c.data[i+1]=Math.round(g*.48);c.data[i+2]=Math.min(255,b+20);}}pixel(c,8,9,'#ffe4b0');pixel(c,16,9,'#ffe4b0');return c;}
function drawFieldCrystal(){const c=canvas(48,72);polygon(c,[[4,70],[8,50],[18,42],[26,46],[44,65],[45,71]],C.plasterShade);polygon(c,[[17,59],[13,32],[23,10],[32,32],[28,60]],'#394b70');polygon(c,[[23,12],[23,57],[17,48],[15,33]],'#728ec4');polygon(c,[[27,65],[32,41],[39,32],[44,48],[40,66]],C.tealShade);polygon(c,[[39,34],[38,61],[33,58],[34,43]],C.tealLight);rect(c,2,68,44,4,C.ink);return c;}
function createAtlas() {
  const atlas = canvas(352, 336);
  const frames = {};
  function add(id, image, x, y, anchor) {
    blit(atlas, image, x, y);
    frames[id] = { x, y, w: image.w, h: image.h, anchor };
  }
  add('shop-bakery', drawBakery(canvas(112, 88)), 0, 0, [56, 88]);
  add('shop-alchemy', drawAlchemy(canvas(112, 88)), 120, 0, [56, 88]);
  add('interior', drawInterior(canvas(112, 88)), 240, 0, [56, 88]);
  const playerXs = [0, 32, 64, 96, 128];
  add('player-idle-0', drawPlayer(-1), playerXs[0], 96, [12, 31]);
  for (let i = 0; i < 4; i++) add(`player-walk-${i}`, drawPlayer(i), playerXs[i + 1], 96, [12, 31]);
  for (let i = 0; i < 4; i++) add(`slime-idle-${i}`, drawSlime(i), 160 + i * 32, 96, [12, 14]);
  add('ground', drawGround(canvas(16, 16)), 296, 96, [8, 8]);
  add('interior-bakery', drawBakeryInterior(), 0, 136, [56, 88]);
  add('interior-alchemy', drawAlchemyInterior(), 120, 136, [56, 88]);
  add('keeper',drawKeeper(),240,136,[12,31]);
  add('field-crystal',drawFieldCrystal(),280,136,[24,72]);
  for(let i=0;i<4;i++){add('portal-'+i,drawPortal(i),i*72,224,[32,80]);add('enemy-'+i,drawEnemy(i),i*32,312,[12,14]);}
  const animations = {
    'portal': ['portal-0','portal-1','portal-2','portal-3'],
    'enemy': ['enemy-0','enemy-1','enemy-2','enemy-3'],
    'player-idle': ['player-idle-0'],
    'player-walk': ['player-walk-0', 'player-walk-1', 'player-walk-2', 'player-walk-3'],
    'slime-idle': ['slime-idle-0', 'slime-idle-1', 'slime-idle-2', 'slime-idle-3'],
  };
  const required = [
    'shop-bakery', 'shop-alchemy', 'interior', 'ground', 'player-idle-0',
    'player-walk-0', 'player-walk-1', 'player-walk-2', 'player-walk-3',
    'slime-idle-0', 'slime-idle-1', 'slime-idle-2', 'slime-idle-3',
    'interior-bakery', 'interior-alchemy',
  ];
  for (const id of required) if (!frames[id]) throw new Error(`missing required frame: ${id}`);
  const used = Object.entries(frames).map(([id, f]) => ({ id, ...f }));
  for (const f of used) {
    if (![f.x, f.y, f.w, f.h, ...f.anchor].every(Number.isInteger)) throw new Error(`non-integer frame metadata: ${f.id}`);
    if (f.w <= 0 || f.h <= 0 || f.x < 0 || f.y < 0 || f.x + f.w > atlas.w || f.y + f.h > atlas.h) throw new Error(`frame out of bounds: ${f.id}`);
    if (f.anchor[0] < 0 || f.anchor[0] > f.w || f.anchor[1] < 0 || f.anchor[1] > f.h) throw new Error(`anchor out of bounds: ${f.id}`);
  }
  for (const id of ['shop-bakery', 'shop-alchemy', 'interior']) {
    if (frames[id].anchor[0] !== 56 || frames[id].anchor[1] !== 88) throw new Error(`${id} must use the [56,88] baseline anchor`);
  }
  for (let i = 0; i < used.length; i++) {
    for (let j = i + 1; j < used.length; j++) {
      const a = used[i]; const b = used[j];
      if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) {
        throw new Error(`frame overlap: ${a.id} and ${b.id}`);
      }
    }
  }
  for (const ids of Object.values(animations)) for (const id of ids) if (!frames[id]) throw new Error(`missing animation frame: ${id}`);
  const frameDigest = (id) => {
    const f = frames[id];
    const bytes = Buffer.alloc(f.w * f.h * 4);
    for (let y = 0; y < f.h; y++) {
      const start = ((f.y + y) * atlas.w + f.x) * 4;
      bytes.set(atlas.data.subarray(start, start + f.w * 4), y * f.w * 4);
    }
    return crypto.createHash('sha256').update(bytes).digest('hex');
  };
  for (const [name, ids] of [['player-walk', animations['player-walk']], ['slime-idle', animations['slime-idle']]]) {
    if (new Set(ids.map(frameDigest)).size !== ids.length) throw new Error(`${name} frames must all contain distinct poses`);
  }
  for (const [name, ids] of [['player-walk', animations['player-walk']], ['slime-idle', animations['slime-idle']]]) {
    const anchors = ids.map((id) => JSON.stringify(frames[id].anchor));
    if (new Set(anchors).size !== 1) throw new Error(`${name} frames must share a feet anchor`);
  }
  return { atlas, frames, animations };
}

function composeSample(atlasFrames) {
  const scene = canvas(224, 96);
  rect(scene, 0, 0, scene.w, scene.h, C.dusk);
  // Dusk shows through a narrow roofline gap and makes the warm shop windows read.
  for (let x = 12; x < 224; x += 37) pixel(scene, x, 3 + (x % 3), C.glassLight);
  blit(scene, atlasFrames.bakery, 0, 0);
  blit(scene, atlasFrames.alchemy, 112, 0);
  for (let x = 0; x < scene.w; x += 16) blit(scene, atlasFrames.ground, x, 88);
  blit(scene, atlasFrames.player, 75, 64);
  blit(scene, atlasFrames.slime, 169, 80);
  rect(scene, 0, 95, scene.w, 1, C.ink);
  return scene;
}

function writeImage(name, image) {
  const bytes = png(image);
  fs.writeFileSync(path.join(ASSETS, name), bytes);
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

fs.mkdirSync(ASSETS, { recursive: true });
fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
const { atlas, frames, animations } = createAtlas();
const atlasJson = { tileSize: 16, image: 'atlas.png', frames, animations };
fs.writeFileSync(path.join(ASSETS, 'atlas.json'), `${JSON.stringify(atlasJson, null, 2)}\n`);

const bakery = canvas(112, 88); drawBakery(bakery);
const alchemy = canvas(112, 88); drawAlchemy(alchemy);
const ground = drawGround(canvas(16, 16));
const slime = drawSlime(0);
const sample = composeSample({ bakery, alchemy, ground, player: drawPlayer(0), slime });
const hashes = {
  'atlas.png': writeImage('atlas.png', atlas),
  'art-sample.png': writeImage('art-sample.png', scaleCanvas(sample, SCALE)),
  'art-sample-1x.png': writeImage('art-sample-1x.png', sample),
};

const manifest = {
  schemaVersion: 1,
  project: 'PixelStreet',
  originalSource: 'Original procedural pixel art created specifically for PixelStreet; no third-party source assets used.',
  author: 'PixelStreet project (procedural pixel art)',
  generatedBy: 'scripts/generate-art.mjs',
  rebuild: 'node scripts/generate-art.mjs',
  license: 'Original project artwork; no third-party artwork is included.',
  dimensions: {
    atlas: [atlas.w, atlas.h],
    shop: [112, 88],
    interior: [112, 88],
    interiorBakery: [112, 88],
    interiorAlchemy: [112, 88],
    character: [24, 32],
    slime: [24, 16],
    ground: [16, 16],
    sampleLogical: [sample.w, sample.h],
    sampleRendered: [sample.w * SCALE, sample.h * SCALE],
  },
  sha256: hashes,
};
fs.writeFileSync(path.join(ASSETS, 'asset_manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Generated ${Object.keys(frames).length} atlas frames (${atlas.w}x${atlas.h}); sample ${sample.w * SCALE}x${sample.h * SCALE}.`);
