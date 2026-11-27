/**
 * Background thread: turns building footprints into merged prism geometry, chunked by ~400 m cells,
 * so the main thread stays responsive while the hero loads. Dependency-free (no three.js import).
 *
 * In:  { buildings: [{ ring: [[x,y]...], h, base, c: [x,y] }], camera: [x,y], lod: { farDistance, farMinHeight } }
 * Out: { chunks: [{ position, normal, seed, kind, top }], stats }  (typed arrays, transferred)
 *
 * Facade kinds: 0 concrete (punched windows), 1 residential glass (balcony bands), 2 office curtain wall.
 * Roofs follow roofPlan() (roof-plan.js): stepped setbacks, slanted tops, mechanical penthouses, antenna
 * masts and small rooftop units (kind 3: plain walls, no windows), all chosen from each building's ID.
 */

import { roofPlan, buildingId, rng } from './roof-plan.js';

const CHUNK = 400;

function signedArea(r) {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  return a / 2;
}

/** Ear-clipping triangulation of a simple CCW polygon → index triples. Falls back to a fan. */
function triangulate(r) {
  const idx = r.map((_, i) => i);
  const out = [];
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const inTri = (p, a, b, c) => cross(a, b, p) > 0 && cross(b, c, p) > 0 && cross(c, a, p) > 0;
  let guard = 0;
  while (idx.length > 3 && guard++ < 5000) {
    let clipped = false;
    for (let k = 0; k < idx.length; k++) {
      const i0 = idx[(k + idx.length - 1) % idx.length], i1 = idx[k], i2 = idx[(k + 1) % idx.length];
      const a = r[i0], b = r[i1], c = r[i2];
      if (cross(a, b, c) <= 1e-9) continue;
      let ear = true;
      for (const j of idx) {
        if (j === i0 || j === i1 || j === i2) continue;
        if (inTri(r[j], a, b, c)) { ear = false; break; }
      }
      if (!ear) continue;
      out.push([i0, i1, i2]);
      idx.splice(k, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (idx.length === 3) out.push([idx[0], idx[1], idx[2]]);
  else for (let k = 1; k < idx.length - 1; k++) out.push([idx[0], idx[k], idx[k + 1]]);
  return out;
}

function createChunk() {
  return { pos: [], nrm: [], seed: [], kind: [], top: [], wall: [] };
}

/** Prism with a per-vertex top height (flat, or sloped for angled crowns). */
let wallCounter = 0;
function pushPrism(ch, ring, base, topAt, roofTop, seed, kind) {
  // wall = [distance along this wall, wall length, wall id]: lets the shader fit whole windows to each wall.
  const add = (x, y, z, nx, ny, nz, w = [0, 0, 0]) => { ch.pos.push(x, y, z); ch.nrm.push(nx, ny, nz); ch.seed.push(seed); ch.kind.push(kind); ch.top.push(roofTop); ch.wall.push(w[0], w[1], w[2]); };
  const r = signedArea(ring) < 0 ? ring.slice().reverse() : ring;
  const tops = r.map(topAt);
  for (let i = 0; i < r.length; i++) {
    const j = (i + 1) % r.length;
    const [x0, y0] = r[i], [x1, y1] = r[j];
    const len = Math.hypot(x1 - x0, y1 - y0) || 1;
    const nx = (y1 - y0) / len, nz = (x1 - x0) / len;
    const id = (wallCounter++ % 997) / 997;
    const a = [x0, base, -y0, 0], b = [x1, base, -y1, len], c = [x1, tops[j], -y1, len], d = [x0, tops[i], -y0, 0];
    for (const v of [a, b, c, a, c, d]) add(v[0], v[1], v[2], nx, 0, nz, [v[3], len, id]);
  }
  for (const [i, j, k] of triangulate(r)) {
    // Roof normal from the triangle (sloped for angled crowns).
    const p0 = [r[i][0], tops[i], -r[i][1]], p1 = [r[j][0], tops[j], -r[j][1]], p2 = [r[k][0], tops[k], -r[k][1]];
    const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
    const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
    for (const p of [p0, p1, p2]) add(p[0], p[1], p[2], nx, ny, nz);
  }
}

function insideRing([x, y], r) {
  let hit = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    if (r[i][1] > y !== r[j][1] > y && x < ((r[j][0] - r[i][0]) * (y - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) hit = !hit;
  }
  return hit;
}

/** Direction of the footprint's longest edge (unit vector), so rooftop units line up with the walls. */
function mainAxis(ring) {
  let best = 0, ux = 1, uy = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i], [x1, y1] = ring[(i + 1) % ring.length];
    const l = Math.hypot(x1 - x0, y1 - y0);
    if (l > best) { best = l; ux = (x1 - x0) / l; uy = (y1 - y0) / l; }
  }
  return [ux, uy];
}

const scaleRing = (ring, [cx, cy], k) => ring.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k]);

function build({ buildings, camera, lod }) {
  const { farDistance = 1300, farMinHeight = 10 } = lod ?? {};
  const chunks = new Map();
  const stats = { kept: 0, dropped: 0, setback: 0, angled: 0, penthouse: 0, mast: 0, rooftop: 0 };

  for (const b of buildings) {
    if (b.h - b.base < 1.5) { stats.dropped++; continue; }
    if (Math.hypot(b.c[0] - camera[0], b.c[1] - camera[1]) > farDistance && b.h < farMinHeight) { stats.dropped++; continue; }
    // Everything random about a building comes from its ID (see roof-plan.js).
    const plan = roofPlan(b);
    const random = rng(buildingId(b) * 31 + 7);
    const seed = plan.seed, r1 = random();
    const kind = b.h > 60 ? (r1 < 0.55 ? 1 : r1 < 0.82 ? 2 : 0)
      : b.h > 25 ? (r1 < 0.35 ? 1 : r1 < 0.5 ? 2 : 0)
      : (r1 < 0.2 ? 2 : 0);
    const key = `${Math.floor(b.c[0] / CHUNK)},${Math.floor(b.c[1] / CHUNK)}`;
    if (!chunks.has(key)) chunks.set(key, createChunk());
    const ch = chunks.get(key);
    stats.kept++;

    const height = b.h - b.base;
    let topRing = b.ring, topScale = 1;
    if (plan.type === 'stepped') {
      // Main shaft, then each tier inset from the one below.
      const levels = plan.tiers.map((t) => b.base + height * t.start).concat(b.h);
      pushPrism(ch, b.ring, b.base, () => levels[0], levels[0], seed, kind);
      plan.tiers.forEach((t, k) => {
        const ring = scaleRing(b.ring, b.c, t.scale);
        pushPrism(ch, ring, levels[k], () => levels[k + 1], levels[k + 1], seed, kind);
        topRing = ring; topScale = t.scale;
      });
      stats.setback++;
    } else if (plan.type === 'slanted') {
      // Roof slopes across the footprint along a direction picked per building.
      const ux = Math.cos(plan.slant.angle), uy = Math.sin(plan.slant.angle);
      const proj = b.ring.map(([x, y]) => x * ux + y * uy);
      const p0 = Math.min(...proj), p1 = Math.max(...proj);
      pushPrism(ch, b.ring, b.base, ([x, y]) => b.h - plan.slant.drop * ((x * ux + y * uy - p0) / (p1 - p0 || 1)), b.h, seed, kind);
      stats.angled++;
    } else {
      pushPrism(ch, b.ring, b.base, () => b.h, b.h, seed, kind);
    }

    // Mechanical penthouse (lift overrun / plant room): the footprint shrunk around its centre.
    if (plan.penthouse) {
      const k = Math.min(plan.penthouse.scale, topScale * 0.7);
      pushPrism(ch, scaleRing(b.ring, b.c, k), b.h, () => b.h + plan.penthouse.h, b.h + plan.penthouse.h, seed, 3);
      stats.penthouse++;
    }
    // Antenna mast: a thin square post on a small base; the aviation light sits on its tip.
    if (plan.mast) {
      const top = b.h + (plan.penthouse?.h ?? 0);
      const [cx, cy] = b.c;
      const sq = (s) => [[cx - s, cy - s], [cx + s, cy - s], [cx + s, cy + s], [cx - s, cy + s]];
      pushPrism(ch, sq(0.9), top, () => top + 1.2, top + 1.2, seed, 3);
      pushPrism(ch, sq(0.28), top + 1.2, () => plan.crownTop, plan.crownTop, seed, 3);
      stats.mast++;
    }
    // Small rooftop units (HVAC, cooling towers), lined up with the building's long axis. Low roofs far away
    // can't be seen from the camera height, so they skip them.
    const far = Math.hypot(b.c[0] - camera[0], b.c[1] - camera[1]) > farDistance * 0.6;
    if (plan.boxes && !(far && height <= 25)) {
      const [ax, ay] = mainAxis(topRing), bx = -ay, by = ax;
      const pa = topRing.map(([x, y]) => (x - b.c[0]) * ax + (y - b.c[1]) * ay);
      const pb = topRing.map(([x, y]) => (x - b.c[0]) * bx + (y - b.c[1]) * by);
      const w = Math.max(...pa) - Math.min(...pa), d = Math.max(...pb) - Math.min(...pb);
      for (let k = 0; k < plan.boxes; k++) {
        const oa = (random() - 0.5) * w * 0.55, ob = (random() - 0.5) * d * 0.55;
        const hw = Math.min(1.2 + random() * 2.5, w * 0.2), hd = Math.min(1.2 + random() * 2.5, d * 0.2), bh = 1.6 + random() * 2.4;
        if (hw < 0.6 || hd < 0.6) continue;
        const ox = b.c[0] + oa * ax + ob * bx, oy = b.c[1] + oa * ay + ob * by;
        const box = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([u, v]) => [ox + u * ax + v * bx, oy + u * ay + v * by]);
        if (!box.every((p) => insideRing(p, topRing))) continue;
        pushPrism(ch, box, b.h, () => b.h + bh, b.h + bh, seed, 3);
        stats.rooftop++;
      }
    }
  }

  const out = [];
  const transfer = [];
  let triangles = 0;
  for (const ch of chunks.values()) {
    const c = {
      position: new Float32Array(ch.pos), normal: new Float32Array(ch.nrm),
      seed: new Float32Array(ch.seed), kind: new Float32Array(ch.kind), top: new Float32Array(ch.top), wall: new Float32Array(ch.wall),
    };
    triangles += ch.pos.length / 9;
    out.push(c);
    transfer.push(c.position.buffer, c.normal.buffer, c.seed.buffer, c.kind.buffer, c.top.buffer, c.wall.buffer);
  }
  stats.chunks = out.length;
  stats.triangles = triangles;
  return { result: { chunks: out, stats }, transfer };
}

self.onmessage = (e) => {
  const { result, transfer } = build(e.data);
  self.postMessage(result, transfer);
};
