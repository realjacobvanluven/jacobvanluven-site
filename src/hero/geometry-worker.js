/**
 * Background thread: turns building footprints into merged prism geometry, chunked by ~400 m cells,
 * so the main thread stays responsive while the hero loads. Dependency-free (no three.js import).
 *
 * In:  { buildings: [{ ring: [[x,y]...], h, base, c: [x,y] }], camera: [x,y], lod: { farDistance, farMinHeight } }
 * Out: { chunks: [{ position, normal, seed, kind, top }], stats }  (typed arrays, transferred)
 *
 * Facade kinds: 0 concrete (punched windows), 1 residential glass (balcony bands), 2 office curtain wall.
 * Taller towers get some variety on top: stepped (setback) crowns or angled roofs. Larger flat roofs get a
 * few mechanical boxes (kind 3: plain walls, no windows).
 */

const CHUNK = 400;

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

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
  return { pos: [], nrm: [], seed: [], kind: [], top: [] };
}

/** Prism with a per-vertex top height (flat, or sloped for angled crowns). */
function pushPrism(ch, ring, base, topAt, roofTop, seed, kind) {
  const add = (x, y, z, nx, ny, nz) => { ch.pos.push(x, y, z); ch.nrm.push(nx, ny, nz); ch.seed.push(seed); ch.kind.push(kind); ch.top.push(roofTop); };
  const r = signedArea(ring) < 0 ? ring.slice().reverse() : ring;
  const tops = r.map(topAt);
  for (let i = 0; i < r.length; i++) {
    const j = (i + 1) % r.length;
    const [x0, y0] = r[i], [x1, y1] = r[j];
    const len = Math.hypot(x1 - x0, y1 - y0) || 1;
    const nx = (y1 - y0) / len, nz = (x1 - x0) / len;
    const a = [x0, base, -y0], b = [x1, base, -y1], c = [x1, tops[j], -y1], d = [x0, tops[i], -y0];
    for (const v of [a, b, c, a, c, d]) add(v[0], v[1], v[2], nx, 0, nz);
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

function build({ buildings, camera, lod }) {
  const { farDistance = 1300, farMinHeight = 10 } = lod ?? {};
  const random = rng(20241121);
  const chunks = new Map();
  const stats = { kept: 0, dropped: 0, setback: 0, angled: 0 };

  for (const b of buildings) {
    const seed = random(), r1 = random(), r2 = random(), r3 = random();
    if (b.h - b.base < 1.5) { stats.dropped++; continue; }
    if (Math.hypot(b.c[0] - camera[0], b.c[1] - camera[1]) > farDistance && b.h < farMinHeight) { stats.dropped++; continue; }
    const kind = b.h > 60 ? (r1 < 0.55 ? 1 : r1 < 0.82 ? 2 : 0)
      : b.h > 25 ? (r1 < 0.35 ? 1 : r1 < 0.5 ? 2 : 0)
      : (r1 < 0.2 ? 2 : 0);
    const key = `${Math.floor(b.c[0] / CHUNK)},${Math.floor(b.c[1] / CHUNK)}`;
    if (!chunks.has(key)) chunks.set(key, createChunk());
    const ch = chunks.get(key);
    stats.kept++;

    const tall = b.h > 55 && kind !== 0 && b.ring.length <= 24;
    if (tall && r2 < 0.3) {
      // Stepped crown: main shaft to ~90%, then an inset top section.
      const h0 = b.base + (b.h - b.base) * (0.86 + r3 * 0.06);
      pushPrism(ch, b.ring, b.base, () => h0, h0, seed, kind);
      const [cx, cy] = b.c, k = 0.72 + r3 * 0.12;
      const inner = b.ring.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k]);
      pushPrism(ch, inner, h0, () => b.h, b.h, seed, kind);
      stats.setback++;
    } else if (tall && r2 < 0.45) {
      // Angled crown: roof slopes across the footprint along a random direction.
      const ang = r3 * Math.PI * 2, ux = Math.cos(ang), uy = Math.sin(ang);
      const proj = b.ring.map(([x, y]) => x * ux + y * uy);
      const p0 = Math.min(...proj), p1 = Math.max(...proj);
      const drop = Math.min(0.12 * b.h, 14);
      pushPrism(ch, b.ring, b.base, ([x, y]) => b.h - drop * ((x * ux + y * uy - p0) / (p1 - p0 || 1)), b.h, seed, kind);
      stats.angled++;
    } else {
      pushPrism(ch, b.ring, b.base, () => b.h, b.h, seed, kind);
      // Rooftop equipment on bigger flat roofs.
      const area = Math.abs(signedArea(b.ring));
      if (b.h > 15 && area > 250) {
        const xs = b.ring.map((p) => p[0]), ys = b.ring.map((p) => p[1]);
        const w = Math.max(...xs) - Math.min(...xs), d = Math.max(...ys) - Math.min(...ys);
        const n = 1 + Math.floor(r3 * 3);
        for (let k = 0; k < n; k++) {
          const ox = b.c[0] + (random() - 0.5) * w * 0.5, oy = b.c[1] + (random() - 0.5) * d * 0.5;
          const bw = 2.5 + random() * 5, bd = 2.5 + random() * 5, bh = 1.8 + random() * 2.6;
          if (!insideRing([ox, oy], b.ring)) continue;
          const box = [[ox - bw / 2, oy - bd / 2], [ox + bw / 2, oy - bd / 2], [ox + bw / 2, oy + bd / 2], [ox - bw / 2, oy + bd / 2]];
          pushPrism(ch, box, b.h, () => b.h + bh, b.h + bh, seed, 3);
          stats.rooftop = (stats.rooftop ?? 0) + 1;
        }
      }
    }
  }

  const out = [];
  const transfer = [];
  let triangles = 0;
  for (const ch of chunks.values()) {
    const c = {
      position: new Float32Array(ch.pos), normal: new Float32Array(ch.nrm),
      seed: new Float32Array(ch.seed), kind: new Float32Array(ch.kind), top: new Float32Array(ch.top),
    };
    triangles += ch.pos.length / 9;
    out.push(c);
    transfer.push(c.position.buffer, c.normal.buffer, c.seed.buffer, c.kind.buffer, c.top.buffer);
  }
  stats.chunks = out.length;
  stats.triangles = triangles;
  return { result: { chunks: out, stats }, transfer };
}

self.onmessage = (e) => {
  const { result, transfer } = build(e.data);
  self.postMessage(result, transfer);
};
