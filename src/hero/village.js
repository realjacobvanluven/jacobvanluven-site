import * as THREE from 'three';
import { skyGlsl, hashGlsl, groundGlsl, fogGlsl } from './shaders.js';
import { roomInteriorGlsl } from './buildings.js';
import { orientedExtents, centroid } from './skyline-data.js';
import { roundCorners } from './smooth.js';

/**
 * Olympic Village (Southeast False Creek), added 2026-11-23: the mapped footprints in this area are built as real
 * mid-rise buildings instead of plain extruded prisms. Footprints and heights come from the data file; everything else is
 * generated and approximate (not a copy of any one building), in the spirit of the neighbourhood:
 *   - five cladding styles (brick, white/grey metal panel with coloured accent bays, timber, glass curtain wall, concrete with
 *     coloured spandrel stripes), floor-to-ceiling windows fitted to each wall, lit rooms with interior mapping;
 *   - rounded corners on some blocks, stepped top floors with a glazed terrace, parapets, stair/elevator penthouses, rooftop
 *     plant, green roofs and solar panel rows, mono-pitch metal roofs on the small buildings;
 *   - balconies stacked floor to floor (concrete slab, glass or coloured panel railing), ground-floor shopfront glazing with
 *     canopies and warm lights under them.
 * Scenery only, no hotspot.
 *
 * Local metres: x east, y north. Three.js world: X = x, Y = up, Z = -y.
 */

/** Where the village is: [x0, y0, x1, y1] in local metres (a generous box around Millennium Water and the blocks south of it). */
export const VILLAGE_BOX = [-130, -300, 310, -12];

/** True for a data building that belongs to the village. */
export const isVillageBuilding = (b) => b.c[0] >= VILLAGE_BOX[0] && b.c[0] <= VILLAGE_BOX[2] && b.c[1] >= VILLAGE_BOX[1] && b.c[1] <= VILLAGE_BOX[3];

/** The data holds some footprints twice (two sources): keep one of each. */
export function dedupeBuildings(list) {
  const seen = new Set();
  return list.filter((b) => {
    const k = `${Math.round(b.c[0] * 2)},${Math.round(b.c[1] * 2)},${Math.round(b.h)},${Math.round(b.base)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ---------- palettes (linear albedo; they sit in dim blue-hour light, so they are darker than they look in daylight) ----------
const BRICK = [[0.2, 0.07, 0.045], [0.17, 0.075, 0.055], [0.24, 0.17, 0.11], [0.14, 0.065, 0.05]];
const METAL = [[0.3, 0.31, 0.32], [0.2, 0.25, 0.23], [0.34, 0.33, 0.29], [0.15, 0.18, 0.23], [0.36, 0.36, 0.36]];
const TIMBER = [[0.2, 0.115, 0.055], [0.17, 0.105, 0.06]];
const SPANDREL = [[0.03, 0.036, 0.042], [0.04, 0.045, 0.05]];
const CONCRETE = [[0.23, 0.23, 0.225], [0.28, 0.26, 0.24]];
const ACCENT = [[0.34, 0.09, 0.035], [0.4, 0.24, 0.04], [0.04, 0.2, 0.2], [0.1, 0.17, 0.28], [0.13, 0.24, 0.07]];
const SLAB = [0.24, 0.24, 0.235];
const PAVER = [0.12, 0.115, 0.11];
const PLANT = [0.07, 0.072, 0.078];
const PARAPET_TRIM = [0.27, 0.27, 0.275];

const pick = (list, r) => list[Math.min(list.length - 1, Math.floor(r * list.length))];
const scale = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

const signedArea = (r) => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1]; return a / 2; };

function pointInRing([x, y], r) {
  let hit = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    if (r[i][1] > y !== r[j][1] > y && x < ((r[j][0] - r[i][0]) * (y - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) hit = !hit;
  }
  return hit;
}

/** Counter-clockwise, no repeated or near-duplicate points, no closing point. */
function cleanRing(r) {
  const out = [];
  for (const p of r) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.25) out.push(p);
  }
  if (out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= 0.25) out.pop();
  if (signedArea(out) < 0) out.reverse();
  return out;
}

/** Offsets a counter-clockwise ring inward by d (mitred corners). Returns null if the result is not a sane smaller ring. */
function offsetRing(ring, d) {
  const n = ring.length, out = [];
  for (let i = 0; i < n; i++) {
    const a = ring[(i + n - 1) % n], p = ring[i], b = ring[(i + 1) % n];
    const l1 = Math.hypot(p[0] - a[0], p[1] - a[1]) || 1, l2 = Math.hypot(b[0] - p[0], b[1] - p[1]) || 1;
    const n1 = [-(p[1] - a[1]) / l1, (p[0] - a[0]) / l1], n2 = [-(b[1] - p[1]) / l2, (b[0] - p[0]) / l2];
    const s = d / Math.max(0.3, 1 + n1[0] * n2[0] + n1[1] * n2[1]);
    out.push([p[0] + (n1[0] + n2[0]) * s, p[1] + (n1[1] + n2[1]) * s]);
  }
  const a0 = signedArea(ring), a1 = signedArea(out);
  if (a1 <= 0 || (d > 0 && a1 > a0) || (d > 0 && a1 < a0 * 0.3)) return null;
  if (d > 0 && !out.every((p) => pointInRing(p, ring))) return null;
  return out;
}

/** Corners of an oriented rectangle (counter-clockwise): centre, long-axis angle, half-length a, half-width w. */
function rect(c, angle, a, w) {
  const ux = Math.cos(angle), uy = Math.sin(angle), vx = -uy, vy = ux;
  return [[c[0] - ux * a - vx * w, c[1] - uy * a - vy * w], [c[0] + ux * a - vx * w, c[1] + uy * a - vy * w], [c[0] + ux * a + vx * w, c[1] + uy * a + vy * w], [c[0] - ux * a + vx * w, c[1] - uy * a + vy * w]];
}

/** Collects triangles with the attributes the village shader needs. */
function createBuilder() {
  const pos = [], nrm = [], alb = [], misc = [], wall = [];
  const W = (p) => [p[0], p[1], p[2]];
  const api = {
    /** One triangle (world-space points). Normal from the winding. ctx: { seed, style, base, floorH, noGround }. */
    tri(a, b, c, albedo, kind, ctx, wa = [0, 0, 0], wb = wa, wc = wa) {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz);
      if (l < 1e-9) return;
      nx /= l; ny /= l; nz /= l;
      const m = [ctx.seed, kind + ctx.style * 0.1, ctx.base + (ctx.noGround ? 1000 : 0), ctx.floorH];
      [[a, wa], [b, wb], [c, wc]].forEach(([p, w]) => { pos.push(...W(p)); nrm.push(nx, ny, nz); alb.push(...albedo); misc.push(...m); wall.push(...w); });
    },
    quad(a, b, c, d, albedo, kind, ctx, w0 = [0, 0, 0], w1 = w0) {
      api.tri(a, b, c, albedo, kind, ctx, w0, w1, w1);
      api.tri(a, c, d, albedo, kind, ctx, w0, w1, w0);
    },
    get count() { return pos.length / 9; },
    geometry() {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
      g.setAttribute('aAlbedo', new THREE.Float32BufferAttribute(alb, 3));
      g.setAttribute('aMisc', new THREE.Float32BufferAttribute(misc, 4));
      g.setAttribute('aWall', new THREE.Float32BufferAttribute(wall, 3));
      g.computeBoundingSphere();
      return g;
    },
  };
  return api;
}

let wallCounter = 0;

/** Vertical walls around a counter-clockwise ring from y0 up to y1 (a number, or a function of the plan point for sloped tops). */
function walls(b, ring, y0, y1, albedo, kind, ctx) {
  const top = typeof y1 === 'function' ? y1 : () => y1;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (len < 0.02) continue;
    const id = (wallCounter++ % 997) / 997;
    b.quad([p[0], y0, -p[1]], [q[0], y0, -q[1]], [q[0], top(q), -q[1]], [p[0], top(p), -p[1]], albedo, kind, ctx, [0, len, id], [len, len, id]);
  }
}

/** A flat cap (up-facing, or down-facing with dir = -1) at height y. y may be a function of the plan point (sloped roofs). */
function cap(b, ring, y, albedo, kind, ctx, dir = 1) {
  let idx;
  try { idx = THREE.ShapeUtils.triangulateShape(ring.map(([x, yy]) => new THREE.Vector2(x, yy)), []); } catch { return; }
  const yf = typeof y === 'function' ? y : () => y;
  for (const [i, j, k] of idx) {
    const a = [ring[i][0], yf(ring[i]), -ring[i][1]], c1 = [ring[j][0], yf(ring[j]), -ring[j][1]], c2 = [ring[k][0], yf(ring[k]), -ring[k][1]];
    const ny = (c1[2] - a[2]) * (c2[0] - a[0]) - (c1[0] - a[0]) * (c2[2] - a[2]); // y component of (c1-a)×(c2-a)... see tri(): (uz*vx - ux*vz)
    if (ny * dir >= 0) b.tri(a, c1, c2, albedo, kind, ctx); else b.tri(a, c2, c1, albedo, kind, ctx);
  }
}

/** A flat ring-shaped strip between an outer and an inner ring (same vertex count, from offsetRing) at height y, facing up. */
function strip(b, outer, inner, y, albedo, kind, ctx) {
  for (let i = 0; i < outer.length; i++) {
    const j = (i + 1) % outer.length;
    b.quad([outer[i][0], y, -outer[i][1]], [outer[j][0], y, -outer[j][1]], [inner[j][0], y, -inner[j][1]], [inner[i][0], y, -inner[i][1]], albedo, kind, ctx);
  }
}

/** A solid box (walls, top, optional underside). */
function prism(b, ring, y0, y1, albedo, kind, ctx, { bottom = false } = {}) {
  walls(b, ring, y0, y1, albedo, kind, ctx);
  cap(b, ring, y1, albedo, kind, ctx, 1);
  if (bottom) cap(b, ring, y0, albedo, kind, ctx, -1);
}

/** Terrain height under a ring: the lowest point, so walls always reach the ground. */
const minGround = (ring, heightAt) => ring.reduce((m, p) => Math.min(m, heightAt(p[0], p[1])), Infinity);

/**
 * @param {{ ring:number[][], h:number, base:number, c:number[] }[]} list  village buildings (from the data file)
 * @param {object} uniforms shared scene uniforms
 * @param {{ camera?: number[], heightAt?: Function, detail?: { balconyDistance?: number, balconyChance?: number, solar?: boolean, maxTriangles?: number } }} opts
 * @returns {{ group: THREE.Group, lights: object[], stats: object }}
 */
export function createVillage(list, uniforms, { camera = [0, 0], heightAt = () => 0, detail = {} } = {}) {
  const { balconyDistance = 700, balconyChance = 0.55, solar = true, maxTriangles = 260000 } = detail;
  const group = new THREE.Group();
  group.name = 'village';
  const lights = [];
  const b = createBuilder();
  const stats = { buildings: 0, balconies: 0, solarRows: 0, setbacks: 0, rounded: 0, shed: 0 };

  const rings = list.map((v) => cleanRing(v.ring));
  const bboxes = rings.map((r) => {
    const xs = r.map((p) => p[0]), ys = r.map((p) => p[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  });
  /** Is this plan point inside any village footprint? (keeps balconies from poking into the building next door) */
  const insideAny = (x, y) => {
    for (let i = 0; i < rings.length; i++) {
      const bb = bboxes[i];
      if (x < bb[0] || x > bb[2] || y < bb[1] || y > bb[3]) continue;
      if (pointInRing([x, y], rings[i])) return true;
    }
    return false;
  };

  list.forEach((src, index) => {
    let ring = rings[index];
    if (ring.length < 3) return;
    const rand = rng(Math.floor((src.c[0] + 1000) * 131 + (src.c[1] + 1000) * 7919 + src.h * 17));
    const seed = rand();
    const hasGround = !(src.base > 1);
    const g = hasGround ? Math.max(heightAt(src.c[0], src.c[1]), minGround(ring, heightAt)) : src.base;
    const y0 = hasGround ? g : src.base;
    const wallBottom = hasGround ? minGround(ring, heightAt) - 2 : src.base;
    const top = src.h;
    const H = top - y0;
    if (H < 3) return;
    let area = Math.abs(signedArea(ring));
    if (area < 12) return;
    const e = orientedExtents(ring);
    const rectish = area / (4 * e.a * e.b || 1) > 0.74 && e.b > 3;
    const floors = Math.max(1, Math.round(H / 3.05));
    const floorH = H / floors;
    const dist = Math.hypot(src.c[0] - camera[0], src.c[1] - camera[1]);

    // Cladding style by height: low blocks are brick, timber and metal; mid-rise adds concrete; towers lean to glass.
    const sr = rand();
    let style;
    if (H < 14) style = sr < 0.38 ? 0 : sr < 0.58 ? 2 : sr < 0.9 ? 1 : 4;
    else if (H < 40) style = sr < 0.2 ? 0 : sr < 0.55 ? 1 : sr < 0.65 ? 2 : sr < 0.8 ? 3 : 4;
    else style = sr < 0.15 ? 1 : sr < 0.6 ? 3 : 4;
    const albedo = style === 0 ? pick(BRICK, rand()) : style === 1 ? pick(METAL, rand()) : style === 2 ? pick(TIMBER, rand()) : style === 3 ? pick(SPANDREL, rand()) : pick(CONCRETE, rand());
    const ctx = { seed, style, base: y0, floorH, noGround: !hasGround };
    const solid = { ...ctx, style: 0 };
    const trim = style === 3 ? PARAPET_TRIM : scale(albedo, style === 0 ? 1.1 : 1.0);

    // A soft outline: rounded corners on some blocks (the stepped data outlines have square corners).
    if (floors >= 3 && ring.length <= 8 && rand() < 0.45) {
      const closed = ring.concat([ring[0]]);
      const rounded = roundCorners(closed, { radius: Math.min(3.2, e.b * 0.35), closed: true, samples: 3 });
      ring = cleanRing(rounded);
      stats.rounded++;
    }

    // ---- volumes: the main body, and sometimes a smaller top section with a terrace round it ----
    const volumes = [];
    let upper = null;
    let shed = false;
    if (floors <= 5 && H <= 18 && area < 450 && rectish && rand() < 0.4) {
      shed = true;
      stats.shed++;
    } else if (floors >= 5 && area > 220 && rand() < 0.6) {
      const upperFloors = floors >= 16 && rand() < 0.5 ? 3 : floors >= 9 ? 2 : 1;
      const inner = offsetRing(ring, 2.2 + rand() * 1.8);
      if (inner) { upper = { ring: inner, floors: upperFloors }; stats.setbacks++; }
    }
    const mainFloors = upper ? floors - upper.floors : floors;
    const mainTop = y0 + mainFloors * floorH;

    if (shed) {
      // Mono-pitch metal roof: rises toward one long side. Walls follow the roof line.
      const ux = Math.cos(e.angle), uy = Math.sin(e.angle), vx = -uy, vy = ux;
      const dir = rand() < 0.5 ? 1 : -1;
      const proj = (p) => ((p[0] - e.center[0]) * vx + (p[1] - e.center[1]) * vy) * dir;
      const rise = Math.min(2.6, 0.18 * e.b * 2 + 0.6);
      const yAt = (p) => top - rise * (0.5 - Math.max(-0.5, Math.min(0.5, proj(p) / (2 * e.b))));
      walls(b, ring, wallBottom, yAt, albedo, 0, ctx);
      cap(b, ring, (p) => yAt(p) + 0.02, scale(albedo, 0.55), 6, solid);
      // Roof edge: a thin fascia round the top so the metal reads as a roof plane, not a lid.
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i], q = ring[(i + 1) % ring.length];
        if (Math.hypot(q[0] - p[0], q[1] - p[1]) < 0.3) continue;
        b.quad([p[0], yAt(p) - 0.01, -p[1]], [q[0], yAt(q) - 0.01, -q[1]], [q[0], yAt(q) + 0.28, -q[1]], [p[0], yAt(p) + 0.28, -p[1]], scale(PARAPET_TRIM, 0.7), 2, solid);
      }
      volumes.push({ ring, top, main: true, noRoof: true });
    } else {
      walls(b, ring, wallBottom, mainTop, albedo, 0, ctx);
      volumes.push({ ring, top: mainTop, main: true, hasUpper: !!upper });
      if (upper) {
        walls(b, upper.ring, mainTop, top, albedo, 0, ctx);
        volumes.push({ ring: upper.ring, top, main: false });
      }
    }

    // ---- roofs ----
    for (const v of volumes) {
      if (v.noRoof) continue;
      if (v.hasUpper) terrace(b, v.ring, upper.ring, v.top, solid);
      else roof(b, v, trim, solid, rand, solar, stats, lights);
    }

    // ---- balconies (stacked floor to floor) ----
    if (!shed && dist < balconyDistance && b.count < maxTriangles && mainFloors >= 3 && H > 8) {
      balconies(b, ring, y0, mainFloors, floorH, solid, rand, balconyChance * (style === 3 ? 0.5 : 1), insideAny, stats);
    }

    // ---- ground floor: a canopy and warm lights along the longest wall of the bigger buildings ----
    if (hasGround && H > 8 && floors >= 2 && rand() < 0.55) {
      let best = 0, bi = 0;
      for (let i = 0; i < ring.length; i++) {
        const l = Math.hypot(ring[(i + 1) % ring.length][0] - ring[i][0], ring[(i + 1) % ring.length][1] - ring[i][1]);
        if (l > best) { best = l; bi = i; }
      }
      if (best > 9) canopy(b, ring[bi], ring[(bi + 1) % ring.length], y0 + floorH * 0.93, solid, lights);
    }
    stats.buildings++;
  });

  const mesh = new THREE.Mesh(b.geometry(), createVillageMaterial(uniforms));
  mesh.name = 'village-buildings';
  group.add(mesh);
  stats.triangles = b.count;
  stats.lights = lights.length;
  return { group, lights, stats };
}

/** Parapet, membrane/green roof, penthouse, plant and solar rows for one flat roof. */
function roof(b, v, trim, solid, rand, solar, stats, lights) {
  const { ring, top } = v;
  const ph = 0.8 + rand() * 0.3;
  const inner = offsetRing(ring, 0.35);
  if (!inner) { cap(b, ring, top, PLANT, 1, solid); return; }
  walls(b, ring, top, top + ph, trim, 2, solid); // outer face of the parapet
  strip(b, ring, inner, top + ph, trim, 2, solid); // its top
  walls(b, inner.slice().reverse(), top, top + ph, scale(trim, 0.8), 2, solid); // inner face
  cap(b, inner, top, PLANT, 1, solid); // roof surface (green, membrane or gravel, by building seed, in the shader)

  const area = Math.abs(signedArea(inner));
  const safe = offsetRing(ring, 1.6);
  if (!safe || area < 40) return;
  const e = orientedExtents(safe);
  const inside = (x, y) => pointInRing([x, y], safe);

  // Stair / elevator penthouse and a few plant boxes.
  const ux = Math.cos(e.angle), uy = Math.sin(e.angle);
  const boxes = Math.min(5, 1 + Math.floor(area / 260));
  for (let k = 0; k < boxes; k++) {
    const x = e.center[0] + ux * (rand() - 0.5) * e.a * 1.2 - uy * (rand() - 0.5) * e.b * 1.2;
    const y = e.center[1] + uy * (rand() - 0.5) * e.a * 1.2 + ux * (rand() - 0.5) * e.b * 1.2;
    const big = k === 0 && area > 120;
    const w = big ? 3 + rand() * 3 : 1 + rand() * 1.8, d = big ? 3 + rand() * 2.5 : 1 + rand() * 1.8, h = big ? 2.8 + rand() * 0.8 : 0.9 + rand() * 0.9;
    const r = rect([x, y], e.angle, w / 2, d / 2);
    if (!r.every((p) => inside(p[0], p[1]))) continue;
    prism(b, r, top, top + h, big ? scale(trim, 0.9) : PLANT, 2, solid);
    if (big && rand() < 0.6) { // a lit stair door facing along the roof: a warm slot
      lights.push({ p: [x, top + 1.2, -y], color: [2.2, 1.4, 0.7], size: 0.35 });
    }
  }

  // Solar panel rows.
  if (solar && area > 160 && rand() < 0.6) {
    const vx = -uy, vy = ux;
    const rowDepth = 1.9, pitch = 3.0, len = 5 + rand() * 6;
    const tiltNorth = vy >= 0 ? 1 : -1; // the high edge faces away from the sun side (south): panels face the afterglow
    let rows = 0;
    for (let s = -e.b + 1; s < e.b - 1 && rows < 14; s += pitch) {
      for (let t = -e.a + 1; t + len < e.a - 1 && rows < 14; t += len + 1.2) {
        const c = [e.center[0] + ux * (t + len / 2) + vx * s, e.center[1] + uy * (t + len / 2) + vy * s];
        const q = rect(c, e.angle, len / 2, rowDepth / 2);
        if (!q.every((p) => inside(p[0], p[1]))) continue;
        const lowY = top + 0.35, highY = top + 0.95;
        const lowSide = -tiltNorth; // sign along v of the low edge
        const hv = (sgn) => (sgn === lowSide ? lowY : highY);
        const P = (sx, sy) => [c[0] + ux * sx * len / 2 + vx * sy * rowDepth / 2, hv(sy), -(c[1] + uy * sx * len / 2 + vy * sy * rowDepth / 2)];
        b.quad(P(-1, -1), P(1, -1), P(1, 1), P(-1, 1), [0.01, 0.02, 0.04], 4, solid);
        rows++;
        stats.solarRows++;
      }
    }
  }
}

/** The roof of a lower volume round a setback upper volume: pavers, with a glass railing at the edge. */
function terrace(b, outer, innerRing, y, solid) {
  const edge = offsetRing(outer, 0.3);
  if (!edge) return;
  strip(b, outer, innerRing, y, PAVER, 2, solid);
  walls(b, edge, y, y + 1.05, [0.02, 0.03, 0.03], 3, solid);
  walls(b, outer, y, y + 0.35, PARAPET_TRIM, 2, solid); // low kerb the railing stands behind
}

/** Stacked balconies: concrete slab with a glass (sometimes coloured panel) railing, floor 1 up to the top of the body. */
function balconies(b, ring, y0, floors, floorH, solid, rand, chance, insideAny, stats) {
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (L < 7) continue;
    const tx = (q[0] - p[0]) / L, ty = (q[1] - p[1]) / L;
    const nx = ty, ny = -tx; // outward (counter-clockwise ring)
    const wallChance = rand() < 0.75 ? chance : chance * 0.3;
    const w = 2.8 + rand() * 0.9, depth = 1.3 + rand() * 0.6, pitch = w + 1.4 + rand() * 1.8;
    const panel = rand() < 0.25 ? pick(ACCENT, rand()) : null;
    for (let s = 1.2 + rand(); s + w <= L - 1.2; s += pitch) {
      if (rand() > wallChance) continue;
      const A = [p[0] + tx * s, p[1] + ty * s], B = [A[0] + tx * w, A[1] + ty * w];
      const C = [B[0] + nx * depth, B[1] + ny * depth], D = [A[0] + nx * depth, A[1] + ny * depth];
      // Clear of the building next door?
      if (insideAny(C[0] + nx * 2.2, C[1] + ny * 2.2) || insideAny(D[0] + nx * 2.2, D[1] + ny * 2.2)) continue;
      const stackTop = rand() < 0.85 ? floors : Math.max(2, floors - 1);
      for (let f = 1; f < stackTop; f++) {
        const ys = y0 + f * floorH, yb = ys - 0.2;
        const rail = panel ? [panel, 2] : [[0.02, 0.03, 0.03], 3];
        // Slab: front, two sides, top and underside (the back is against the wall).
        const T = (pt, y) => [pt[0], y, -pt[1]];
        b.quad(T(D, yb), T(C, yb), T(C, ys), T(D, ys), SLAB, 2, solid); // front face (D→C faces outward)
        b.quad(T(C, yb), T(B, yb), T(B, ys), T(C, ys), SLAB, 2, solid);
        b.quad(T(A, yb), T(D, yb), T(D, ys), T(A, ys), SLAB, 2, solid);
        b.quad(T(A, ys), T(D, ys), T(C, ys), T(B, ys), SLAB, 2, solid);
        b.quad(T(A, yb), T(B, yb), T(C, yb), T(D, yb), SLAB, 2, solid);
        // Railing, 1.05 m: front and both sides.
        const yr = ys + 1.05;
        b.quad(T(D, ys), T(C, ys), T(C, yr), T(D, yr), rail[0], rail[1], solid);
        b.quad(T(C, ys), T(B, ys), T(B, yr), T(C, yr), rail[0], rail[1], solid);
        b.quad(T(A, ys), T(D, ys), T(D, yr), T(A, yr), rail[0], rail[1], solid);
      }
      stats.balconies++;
    }
  }
}

/** A shopfront canopy over part of one wall, with warm lights under it. */
function canopy(b, p, q, y, solid, lights) {
  const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
  const tx = (q[0] - p[0]) / L, ty = (q[1] - p[1]) / L, nx = ty, ny = -tx;
  const len = Math.min(L * 0.7, 32), s0 = (L - len) / 2;
  const A = [p[0] + tx * s0, p[1] + ty * s0], B = [A[0] + tx * len, A[1] + ty * len];
  const C = [B[0] + nx * 1.8, B[1] + ny * 1.8], D = [A[0] + nx * 1.8, A[1] + ny * 1.8];
  const r = [A, D, C, B]; // counter-clockwise
  prism(b, r, y, y + 0.18, scale(PARAPET_TRIM, 0.7), 2, solid, { bottom: true });
  const n = Math.min(4, 1 + Math.floor(len / 9));
  for (let k = 0; k < n; k++) {
    const t = (k + 0.5) / n;
    lights.push({ p: [A[0] + tx * len * t + nx * 0.9, y - 0.12, -(A[1] + ty * len * t + ny * 0.9)], color: [3.4, 2.1, 1.0], size: 0.4 });
  }
}

// ---------- shader ----------
function createVillageMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    uniforms,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute vec3 aAlbedo; attribute vec4 aMisc; attribute vec3 aWall;
      varying vec3 vWorld; varying vec3 vNormal; varying vec3 vAlbedo; varying vec4 vMisc; varying vec3 vWall;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz; vNormal = normalize(mat3(modelMatrix) * normal); vAlbedo = aAlbedo; vMisc = aMisc; vWall = aWall;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      ${skyGlsl}
      ${hashGlsl}
      ${groundGlsl}
      ${fogGlsl}
      ${roomInteriorGlsl}
      uniform float uWindowIntensity;
      uniform float uTime;
      varying vec3 vWorld; varying vec3 vNormal; varying vec3 vAlbedo; varying vec4 vMisc; varying vec3 vWall;

      vec3 accentCol(float h) {
        return h < 0.2 ? vec3(0.34, 0.09, 0.035) : h < 0.4 ? vec3(0.4, 0.24, 0.04) : h < 0.6 ? vec3(0.04, 0.2, 0.2) : h < 0.8 ? vec3(0.1, 0.17, 0.28) : vec3(0.13, 0.24, 0.07);
      }

      void main() {
        vec3 n = normalize(vNormal);
        if (!gl_FrontFacing) n = -n;
        vec3 V = normalize(cameraPosition - vWorld);
        float seed = vMisc.x;
        float kind = floor(vMisc.y + 0.001);
        float style = floor(fract(vMisc.y + 0.001) * 10.0 + 0.5);
        float noGround = step(500.0, vMisc.z);
        float base = vMisc.z - noGround * 1000.0;
        float floorH = vMisc.w;
        float rel = vWorld.y - base;
        vec3 sunFlat = normalize(vec3(uSunDir.x, 0.0, uSunDir.z));
        float skyAmb = 0.55 + 0.45 * n.y;
        float westFacing = max(dot(n, sunFlat), 0.0);
        float ao = mix(0.55, 1.0, smoothstep(0.0, 5.0, rel));
        // Street lamps wash the lower floors warm, in pools.
        float wash = exp(-max(rel, 0.0) / 8.0) * (0.55 + 0.45 * sin(dot(vWorld.xz, vec2(0.19, 0.13)) + seed * 40.0));
        vec3 lightOn = skyAmb * vec3(0.55, 0.62, 0.85) + vec3(1.0, 0.5, 0.2) * westFacing * 0.22 + vec3(1.0, 0.62, 0.3) * wash * 0.8;
        vec3 R = reflect(-V, n);
        R.y = abs(R.y) * 0.9 + 0.02;
        float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
        vec3 col;

        if (kind > 0.5 && kind < 1.5) {
          // Roof surface: green roof (sedum patches), dark membrane with seams, or gravel; per building.
          float rk = hash12(vec2(seed * 47.0, 5.0));
          vec2 p = vWorld.xz;
          vec2 rf = fwidth(p);
          float farRoof = smoothstep(0.3, 1.2, max(rf.x, rf.y));
          vec3 roof;
          if (rk < 0.45) {
            float pn = gfbm(p / 2.4 + seed * 30.0), pm = gfbm(p * 1.6);
            vec3 g1 = vec3(0.011, 0.03, 0.011), g2 = vec3(0.034, 0.042, 0.012), g3 = vec3(0.05, 0.026, 0.014);
            roof = mix(g1, g2, smoothstep(0.35, 0.65, pn));
            roof = mix(roof, g3, smoothstep(0.62, 0.8, pm * 0.6 + pn * 0.5) * 0.6);
            roof *= mix(0.8 + 0.4 * pm, 1.0, farRoof);
          } else if (rk < 0.8) {
            roof = vec3(0.034, 0.037, 0.045) * (0.8 + 0.4 * gnoise(p / 3.0));
            float seam = 1.0 - smoothstep(0.02, 0.02 + rf.x, abs(fract(p.x / 1.6 + seed * 3.0) - 0.5) - 0.47);
            roof *= 1.0 - 0.25 * seam * (1.0 - farRoof);
          } else {
            roof = vec3(0.07, 0.07, 0.076) * mix(0.65 + 0.6 * worley(p * 3.0), 1.0, farRoof);
          }
          col = roof * vec3(0.7, 0.75, 1.0) * (0.8 + 0.3 * n.y);
        } else if (kind > 5.5) {
          // Mono-pitch metal roof: standing seams, a sheen of sky.
          float seam = 0.9 + 0.1 * step(0.5, fract(dot(vWorld.xz, vec2(0.707, 0.707)) * 2.0));
          col = vAlbedo * lightOn * ao * seam + skyColor(R) * (0.1 + 0.5 * fres) * 0.6;
        } else if (kind > 3.5) {
          // Solar panel: dark blue cells with a grid, mirroring the sky at a low angle.
          vec2 p = vWorld.xz * 1.2;
          vec2 fp = fwidth(p);
          float line = (1.0 - smoothstep(0.0, 0.05 + fp.x, abs(fract(p.x) - 0.5) * 2.0 - 0.95)) + (1.0 - smoothstep(0.0, 0.05 + fp.y, abs(fract(p.y) - 0.5) * 2.0 - 0.95));
          float visible = 1.0 - smoothstep(0.25, 0.9, max(fp.x, fp.y));
          col = vec3(0.007, 0.012, 0.028) * (1.0 + 4.0 * clamp(line, 0.0, 1.0) * visible) + skyColor(R) * mix(0.12, 0.9, fres) * 0.8;
        } else if (kind > 2.5) {
          // Balcony / terrace glass railing: dark glass mirroring the sky, with a bright metal handrail.
          float ys = rel - floor((rel + 0.01) / floorH) * floorH;
          float rail = 1.0 - smoothstep(0.0, 0.05, abs(ys - 1.03) - 0.02);
          vec3 glass = vec3(0.008, 0.014, 0.016) + skyColor(R) * mix(0.25, 0.85, fres) * vec3(0.5, 1.0, 0.9);
          col = mix(glass, vec3(0.12, 0.12, 0.13) * lightOn, rail);
          col += vec3(1.0, 0.62, 0.3) * 0.02 * wash;
        } else if (kind > 1.5) {
          // Solid detail (balcony slab, penthouse, parapet, panel railing, canopy).
          col = vAlbedo * lightOn * ao;
          // Undersides near the street pick up the warm shop light.
          col += vAlbedo * vec3(1.0, 0.6, 0.3) * 0.6 * step(n.y, -0.5) * smoothstep(7.0, 0.0, rel);
          col *= n.y < -0.5 ? 0.5 : 1.0;
        } else {
          // ---- Facade ----
          float L = vWall.y;
          float u = vWall.x;
          float wallId = floor(vWall.z * 997.0);
          float solidWall = step(L, 1.3);
          float bayT = style < 0.5 ? 2.1 : style < 1.5 ? 2.0 : style < 2.5 ? 1.8 : style < 3.5 ? 1.5 : 2.6;
          float bays = max(1.0, floor(L / bayT + 0.5));
          float colW = L / bays;
          vec2 g = vec2(u / colW, rel / floorH);
          vec2 cell = floor(g);
          vec2 f = fract(g);
          vec2 fw = fwidth(g);
          vec2 aa = max(fw, vec2(0.001));
          float detail = 1.0 - smoothstep(0.05, 0.22, max(fw.x, fw.y));
          float ground = (1.0 - noGround) * step(cell.y, 0.5);
          float retail = ground * step(hash12(vec2(seed * 9.1, 3.0)), 0.5) * step(1.2, bays);

          // Window opening inside each bay, by style.
          vec2 lo = style < 0.5 ? vec2(0.22, 0.18) : style < 1.5 ? vec2(0.1, 0.08) : style < 2.5 ? vec2(0.14, 0.12) : style < 3.5 ? vec2(0.03, 0.28) : vec2(0.03, 0.3);
          vec2 hi = style < 0.5 ? vec2(0.78, 0.86) : style < 1.5 ? vec2(0.9, 0.9) : style < 2.5 ? vec2(0.86, 0.9) : style < 3.5 ? vec2(0.97, 0.96) : vec2(0.97, 0.82);
          // Coloured accent bays (metal panel and timber blocks): every third bay is solid colour with a narrow window.
          float shift = mod(floor(seed * 3.0) + wallId, 3.0);
          float accentBay = step(0.5, style) * step(style, 1.5) * (1.0 - step(0.5, abs(mod(cell.x + shift, 3.0))));
          lo.x = mix(lo.x, 0.3, accentBay); hi.x = mix(hi.x, 0.7, accentBay);
          // Shopfront glazing on the ground floor of "retail" walls.
          lo = mix(lo, vec2(0.03, 0.05), retail); hi = mix(hi, vec2(0.97, 0.86), retail);
          vec2 m = smoothstep(lo - aa, lo + aa, f) * (1.0 - smoothstep(hi - aa, hi + aa, f));
          float edgeDist = min(u, L - u);
          float aaU = fwidth(u);
          float corner = 1.0 - smoothstep(0.25, 0.25 + aaU, edgeDist);
          float isWindow = m.x * m.y * (1.0 - corner) * (1.0 - solidWall);
          float windowArea = (hi.x - lo.x) * (hi.y - lo.y);

          // Wall material.
          vec3 wallAlb = vAlbedo;
          vec3 acc = accentCol(hash12(vec2(seed * 71.0, 2.0)));
          float bu = u * 4.65, bv = rel * 13.3;
          float rowOdd = mod(floor(bv), 2.0);
          float bd = 1.0 - smoothstep(0.1, 0.45, length(fwidth(vec2(bu, bv))));
          if (style < 0.5) {
            float tone = hash12(vec2(floor(bu + 0.5 * rowOdd), floor(bv)) + seed * 7.0);
            float mortar = max(step(fract(bv), 0.14), step(fract(bu + 0.5 * rowOdd), 0.09));
            wallAlb *= mix(1.0, 0.72 + 0.55 * tone - 0.3 * mortar, bd);
          } else if (style < 1.5) {
            wallAlb = mix(wallAlb, acc, accentBay);
            float joint = 1.0 - smoothstep(0.0, 0.03 + aa.x, min(f.x, 1.0 - f.x));
            wallAlb *= 1.0 - 0.3 * joint * detail;
          } else if (style < 2.5) {
            float bt = u * 5.5;
            float tone = hash12(vec2(floor(bt), floor(seed * 50.0)));
            wallAlb *= mix(1.0, 0.75 + 0.5 * tone, 1.0 - smoothstep(0.1, 0.5, fwidth(bt)));
          } else if (style > 3.5) {
            float stripe = step(f.y, 0.2) * step(0.45, hash12(vec2(cell.y * 3.0 + seed * 9.0, 1.0)));
            wallAlb = mix(wallAlb, acc, stripe * 0.8);
            wallAlb *= 0.9 + 0.2 * hash12(floor(vec2(u / 5.0, rel / 6.0)) + seed * 19.0);
          }
          // Weathering: rain streaks running down from the sills, a slightly darker foot.
          float streak = hash12(vec2(floor(u / 0.35), seed * 41.0));
          wallAlb *= 1.0 - detail * 0.16 * streak * smoothstep(0.0, 0.3, f.y) * (1.0 - smoothstep(0.3, 1.0, f.y));
          // Floor slab lines on the metal and timber blocks.
          float slabLine = 1.0 - smoothstep(0.0, 0.05 + aa.y, f.y);
          wallAlb *= 1.0 - 0.25 * slabLine * step(0.5, style) * step(style, 2.5);
          vec3 wallCol = wallAlb * lightOn * ao;
          // The top floor / parapet band is a little lighter where it catches the sky.
          wallCol += vec3(0.004, 0.005, 0.008);

          // Who is home: an apartment is two bays wide, one floor high.
          float unitW = 2.0;
          vec2 unit = vec2(floor((cell.x + wallId * 7.0) / unitW), cell.y);
          float litShare = mix(0.28, 0.5, hash12(vec2(seed * 13.1, 7.7)));
          float r1 = hash12(unit + seed * 117.0);
          float r2 = hash12(cell * 1.7 + seed * 53.0);
          float r3 = hash12(unit * 2.3 + seed * 29.0);
          float lit = max(step(r1, litShare), retail * step(r1, 0.72));
          vec3 k2700 = vec3(1.0, 0.52, 0.22), k3000 = vec3(1.0, 0.64, 0.34), k4000 = vec3(1.0, 0.82, 0.62), k5000 = vec3(0.8, 0.88, 1.0);
          float style2 = hash12(vec2(seed * 61.0, 8.0));
          float rk = clamp(r3 * 0.8 + style2 * 0.45 - 0.15, 0.0, 1.0);
          vec3 lampCol = rk < 0.3 ? k2700 : rk < 0.58 ? k3000 : rk < 0.82 ? k4000 : k5000;
          lampCol = mix(lampCol, vec3(1.0, 0.6, 0.3), retail * 0.7);
          float tv = step(0.965, hash12(unit * 3.1 + seed * 11.0));
          float flick = 0.55 + 0.45 * hash12(vec2(floor(uTime * 7.0), unit.x + unit.y * 13.0));
          lampCol = mix(lampCol, vec3(0.55, 0.7, 1.0), tv);
          float bright = mix(0.3, 1.2, r2 * r2);
          bright = mix(bright, bright * flick, tv);
          float blinds = step(0.78, hash12(unit + seed * 7.0)) * (1.0 - retail);
          float emitK = uWindowIntensity * lit;

          // Glass: each pane sits at a slightly different angle, so reflections break up pane by pane.
          vec2 pr = vec2(hash12(cell * 3.1 + seed * 7.0), hash12(cell * 5.7 + seed * 3.0)) - 0.5;
          vec3 T = normalize(vec3(n.z, 0.0, -n.x));
          vec3 np = normalize(n + (T * pr.x * 0.09 + vec3(0.0, pr.y * 0.06, 0.0)) * detail);
          vec3 Rg = reflect(-V, np);
          Rg.y = abs(Rg.y) * 0.9 + 0.02;
          float fg = 0.04 + 0.96 * pow(1.0 - max(dot(np, V), 0.0), 5.0);
          float gk = hash12(vec2(seed * 23.0, 4.0));
          vec3 glassTint = gk < 0.4 ? vec3(0.42, 0.98, 0.85) : gk < 0.6 ? vec3(0.42, 0.7, 1.15) : gk < 0.8 ? vec3(0.88, 0.9, 0.94) : vec3(0.5, 0.52, 0.56);
          vec3 glassCol = vec3(0.009, 0.014, 0.018) * glassTint * 1.3 + skyColor(Rg) * mix(0.25, 0.9, fg) * glassTint;
          glassCol *= ao;

          // Far away: average instead of aliasing.
          vec3 avgLamp = mix(k3000, k4000, style2) * 0.62 * uWindowIntensity * litShare;
          vec3 farCol = mix(wallCol * 0.6, glassCol * (1.0 - litShare * 0.85) + avgLamp, windowArea * (1.0 - solidWall));
          float farMix = smoothstep(0.7, 1.8, max(fw.x, fw.y));
          col = farCol;
          if (farMix < 0.999) {
            vec3 room = lampCol * mix(0.75, 1.1, f.y);
            if (lit > 0.5 && detail > 0.001) {
              vec3 dims = vec3(unitW * colW, floorH, 4.5 + 2.0 * r3);
              vec2 q = vec2((cell.x + wallId * 7.0 - unit.x * unitW + f.x) / unitW, f.y);
              vec3 dir = vec3(dot(-V, T), -V.y, dot(V, n));
              vec3 inside = roomInterior(q, dir, dims, lampCol, r1 * 0.37 + r3 * 0.63, 0.0) * 1.25;
              float cl = step(0.4, r2) * (0.08 + 0.3 * hash12(unit + 4.0));
              float cr = step(0.3, r3) * (0.06 + 0.25 * hash12(unit + 9.0));
              float curtain = max(1.0 - smoothstep(cl - 0.01, cl + 0.01, q.x), smoothstep(1.0 - cr - 0.01, 1.0 - cr + 0.01, q.x));
              vec3 fabric = lampCol * mix(vec3(0.5, 0.42, 0.34), vec3(0.4, 0.4, 0.42), fract(r1 * 9.0)) * (0.8 + 0.2 * sin(q.x * unitW * colW * 9.0));
              room = mix(room, mix(inside, fabric, curtain), detail);
            }
            room = mix(room, lampCol * 0.45 * (0.8 + 0.2 * step(0.5, fract(f.y * 9.0))), blinds);
            vec3 windowCol = glassCol * (1.0 - lit * 0.75) + room * bright * emitK;
            // Mullions: a centre bar in each window, a transom on the shopfronts.
            float mull = 1.0 - smoothstep(0.012, 0.012 + aa.x, abs(f.x - 0.5));
            mull += retail * (1.0 - smoothstep(0.012, 0.012 + aa.y, abs(f.y - 0.72)));
            windowCol = mix(windowCol, wallCol * 0.8, clamp(mull, 0.0, 1.0) * detail * 0.8);
            // Balcony doors: a frosted rail across the lower part of the window on some floors.
            float rail = step(0.16, f.y) * (1.0 - step(0.4, f.y)) * step(0.5, hash12(vec2(cell.y + floor(u / (colW * 2.0)), seed * 3.0))) * step(style, 3.5) * (1.0 - retail);
            windowCol = mix(windowCol, windowCol * 0.7 + skyColor(Rg) * 0.1, rail * 0.5 * detail);
            vec3 near = mix(wallCol, windowCol, isWindow);
            col = mix(near, farCol, farMix);
          }
        }

        gl_FragColor = vec4(applyFog(col, vWorld), 1.0);
      }
    `,
  });
}
