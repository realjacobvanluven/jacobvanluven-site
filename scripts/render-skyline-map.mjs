#!/usr/bin/env node
/**
 * Draws public/data/skyline.json as a top-down SVG map, to check the captured area by eye.
 * Usage: node scripts/render-skyline-map.mjs [out.svg]   (default: scripts/.cache/skyline-map.svg)
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] ?? join(ROOT, 'scripts/.cache/skyline-map.svg');
const data = JSON.parse(await readFile(join(ROOT, 'public/data/skyline.json'), 'utf8'));

const decode = (flat) => {
  const pts = [];
  let x = 0, y = 0;
  for (let i = 0; i < flat.length; i += 2) { x += flat[i]; y += flat[i + 1]; pts.push([x / 10, y / 10]); }
  return pts;
};

const buildings = data.buildings.map(([h, base, src, ...ring]) => ({ h: h / 10, base: base / 10, src: data.sources[src], ring: decode(ring) }));
const xs = buildings.flatMap((b) => b.ring.map((p) => p[0]));
const ys = buildings.flatMap((b) => b.ring.map((p) => p[1]));
const pad = 150;
const [x0, x1] = [Math.min(...xs, 0) - pad, Math.max(...xs) + pad];
const [y0, y1] = [Math.min(...ys, 0) - pad, Math.max(...ys) + pad];
const W = x1 - x0, H = y1 - y0;
const S = 1400 / W; // px per metre
const px = ([x, y]) => `${((x - x0) * S).toFixed(1)},${((y1 - y) * S).toFixed(1)}`;

// Height → colour: dark grey for low-rise, warming to orange for towers.
const colour = (h) => {
  const t = Math.min(1, Math.log1p(h) / Math.log1p(180));
  const mix = (a, b) => Math.round(a + (b - a) * t ** 2);
  return `rgb(${mix(60, 255)},${mix(60, 122)},${mix(64, 26)})`;
};

const polys = buildings
  .sort((a, b) => a.h - b.h)
  .map((b) => `<polygon points="${b.ring.map(px).join(' ')}" fill="${colour(b.h)}"${b.src.endsWith('est') ? ' stroke="#888" stroke-width="0.6" stroke-dasharray="2 2"' : ''}/>`)
  .join('\n');

const shore = data.shoreline.map((l) => `<polyline points="${decode(l).map(px).join(' ')}" fill="none" stroke="#3a8dde" stroke-width="2"/>`).join('\n');

// Camera (origin) and crop wedge (drawn from the crop apex).
const { crop } = data;
const [ax, ay] = crop.apex.map((v) => v / 10);
const ray = (deg) => [ax + Math.sin((deg * Math.PI) / 180) * crop.maxDistance, ay + Math.cos((deg * Math.PI) / 180) * crop.maxDistance];
const cam = px([0, 0]);
const apex = px([ax, ay]).split(',');
const wedge = [crop.fromBearing, crop.toBearing].map((d) => `<line x1="${apex[0]}" y1="${apex[1]}" x2="${px(ray(d)).split(',')[0]}" y2="${px(ray(d)).split(',')[1]}" stroke="#fff" stroke-opacity="0.35" stroke-dasharray="8 6"/>`).join('');

const main = new Set(['bc-place', 'harbour-centre', 'science-world']);
const labels = Object.entries(data.landmarks).map(([id, l]) => {
  const [cx, cy] = px([l.center[0] / 10, l.center[1] / 10]).split(',').map(Number);
  const big = main.has(id);
  const [bx0, by0] = px([l.bounds[0] / 10, l.bounds[3] / 10]).split(',').map(Number);
  const [bx1, by1] = px([l.bounds[2] / 10, l.bounds[1] / 10]).split(',').map(Number);
  return `<rect x="${bx0}" y="${by0}" width="${bx1 - bx0}" height="${by1 - by0}" fill="none" stroke="${big ? '#fff' : '#bbb'}" stroke-width="${big ? 2 : 1}"/>
<text x="${cx}" y="${by0 - 8}" text-anchor="middle" font-size="${big ? 22 : 15}" font-weight="${big ? 700 : 400}" fill="#fff" stroke="#000" stroke-width="4" paint-order="stroke">${l.name}</text>`;
}).join('\n');

const sw = 500 * S;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${(W * S).toFixed(0)}" height="${(H * S).toFixed(0)}" font-family="Helvetica, Arial, sans-serif">
<rect width="100%" height="100%" fill="#0d0f14"/>
${shore}
${wedge}
${polys}
${labels}
<circle cx="${cam.split(',')[0]}" cy="${cam.split(',')[1]}" r="9" fill="#3a8dde" stroke="#fff" stroke-width="2"/>
<text x="${Number(cam.split(',')[0]) + 14}" y="${Number(cam.split(',')[1]) + 6}" font-size="17" fill="#fff" stroke="#000" stroke-width="4" paint-order="stroke">Camera: Olympic Village seawall</text>
<g transform="translate(30,40)" fill="#fff" font-size="15">
  <text font-size="22" font-weight="700">Captured buildings: ${buildings.length} parts</text>
  <text y="24">Colour = height (grey low-rise → orange towers). Dashed = height estimated.</text>
  <text y="46">Blue = shoreline (False Creek, Burrard Inlet). Dashed white = view wedge.</text>
  <text x="0" y="90" font-size="26" font-weight="700">N ↑</text>
  <rect x="0" y="110" width="${sw}" height="6"/><text y="136">500 m</text>
</g>
</svg>`;

await mkdir(dirname(out), { recursive: true });
await writeFile(out, svg);
console.log(`Wrote ${out} (${(W * S).toFixed(0)} × ${(H * S).toFixed(0)} px)`);
