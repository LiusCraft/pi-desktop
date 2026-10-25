#!/usr/bin/env node
// Generates build/icon.png (1024×1024) and, on macOS, build/icon.icns.
// Dependency-free on purpose: the shape is drawn with signed distance fields
// and encoded as PNG by hand, so `make icon` works before `npm install`.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'build');
const SIZE = 1024;

// ---------------------------------------------------------------- drawing
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const mix = (a, b, t) => a + (b - a) * t;

// Distance from (x,y) to a rounded rectangle: negative inside.
function sdRoundRect(x, y, cx, cy, hw, hh, r) {
  const qx = Math.abs(x - cx) - (hw - r);
  const qy = Math.abs(y - cy) - (hh - r);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
}

// Distance from (x,y) to a thick line segment (a capsule), negative inside.
function sdCapsule(x, y, ax, ay, bx, by, r) {
  const abx = bx - ax;
  const aby = by - ay;
  const px = x - ax;
  const py = y - ay;
  const t = clamp((px * abx + py * aby) / (abx * abx + aby * aby), 0, 1);
  return Math.hypot(px - abx * t, py - aby * t) - r;
}

// 1px-wide analytic antialiasing: a half-pixel band around the edge.
const cover = (d) => clamp(0.5 - d, 0, 1);

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const TOP = hex('#dd8a68'); // app accent, light end
const BOTTOM = hex('#b0553a'); // app accent, dark end
const INK = hex('#fffdf9');

const INSET = 100; // transparent margin around the macOS squircle
const HALF = (SIZE - INSET * 2) / 2; // 412
const C = SIZE / 2;
const RADIUS = 185;

// The π mark, in icon coordinates.
const GLYPH = [
  [335, 388, 689, 388, 25], // crossbar
  [416, 388, 416, 648, 25], // left leg
  [608, 388, 608, 648, 25], // right leg
  [372, 655, 460, 655, 18], // left foot
  [564, 655, 652, 655, 18], // right foot
];

function render() {
  const rgba = Buffer.alloc(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    // Gradient + highlight are constant per row, so they are computed once.
    const t = clamp((y - INSET) / (HALF * 2), 0, 1);
    const base = TOP.map((v, i) => mix(v, BOTTOM[i], t));
    const gloss = 0.16 * Math.max(0, 1 - t * 2.6); // soft light from the top
    const shade = 0.06 * Math.max(0, (t - 0.72) / 0.28); // slight foot shading
    for (let x = 0; x < SIZE; x++) {
      const body = cover(sdRoundRect(x, y, C, C, HALF, HALF, RADIUS));
      if (body <= 0) continue;
      let r = mix(base[0], 255, gloss);
      let g = mix(base[1], 255, gloss);
      let b = mix(base[2], 255, gloss);
      r = mix(r, 0, shade);
      g = mix(g, 0, shade);
      b = mix(b, 0, shade);

      // Composite the glyph over the squircle, clipped to the body alpha.
      let glyph = 0;
      for (const [ax, ay, bx, by, rad] of GLYPH) {
        glyph = Math.max(glyph, cover(sdCapsule(x, y, ax, ay, bx, by, rad)));
        if (glyph >= 1) break;
      }
      glyph *= body;
      r = mix(r, INK[0], glyph);
      g = mix(g, INK[1], glyph);
      b = mix(b, INK[2], glyph);

      const i = (y * SIZE + x) * 4;
      rgba[i] = Math.round(r);
      rgba[i + 1] = Math.round(g);
      rgba[i + 2] = Math.round(b);
      rgba[i + 3] = Math.round(body * 255);
    }
  }
  return rgba;
}

// ---------------------------------------------------------------- PNG writer
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(rgba, width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  // filter byte 0 in front of every scanline, then deflate the lot
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- icns
// The iconset macOS expects; 1024 is the 512@2x slot.
const ICONSET = [
  [16, 'icon_16x16.png'],
  [32, 'icon_16x16@2x.png'],
  [32, 'icon_32x32.png'],
  [64, 'icon_32x32@2x.png'],
  [128, 'icon_128x128.png'],
  [256, 'icon_128x128@2x.png'],
  [256, 'icon_256x256.png'],
  [512, 'icon_256x256@2x.png'],
  [512, 'icon_512x512.png'],
  [1024, 'icon_512x512@2x.png'],
];

function writeIcns(pngPath) {
  if (process.platform !== 'darwin') {
    console.log('icon.icns skipped: needs macOS (sips + iconutil)');
    return;
  }
  const iconset = path.join(OUT_DIR, 'icon.iconset');
  fs.rmSync(iconset, { recursive: true, force: true });
  fs.mkdirSync(iconset, { recursive: true });
  for (const [size, name] of ICONSET) {
    const dest = path.join(iconset, name);
    if (size === SIZE) fs.copyFileSync(pngPath, dest);
    else execFileSync('sips', ['-z', String(size), String(size), pngPath, '--out', dest], { stdio: 'ignore' });
  }
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(OUT_DIR, 'icon.icns')]);
  fs.rmSync(iconset, { recursive: true, force: true });
  console.log('build/icon.icns written');
}

// ---------------------------------------------------------------- main
fs.mkdirSync(OUT_DIR, { recursive: true });
const pngPath = path.join(OUT_DIR, 'icon.png');
fs.writeFileSync(pngPath, png(render(), SIZE, SIZE));
console.log(`build/icon.png written (${SIZE}×${SIZE})`);
writeIcns(pngPath);
