import * as THREE from 'three';
import { orientedExtents } from './skyline-data.js';

/**
 * Hand-modelled signature towers, so the skyline reads as Vancouver: One Wall Centre (dark ellipse with a
 * lit crown), Paradox (the former Trump tower, upper half rotated 45°), Living Shangri-La (slim, stepped
 * glass crown), The Butterfly (two curved lobes), MNP Tower (sloped crown) and Vancouver House (a tower that
 * widens as it rises). Positioned from their real footprints; heights are approximate.
 *
 * Each model is a stack of rings (closed loops of [x, y, z] in world space) skinned into walls, so it uses
 * the same facade shader (windows) as the other buildings.
 */

const ellipse = (cx, cy, a, b, angle, n = 36) =>
  Array.from({ length: n }, (_, i) => {
    const t = (i / n) * Math.PI * 2, x = Math.cos(t) * a, y = Math.sin(t) * b;
    return [cx + x * Math.cos(angle) - y * Math.sin(angle), cy + x * Math.sin(angle) + y * Math.cos(angle)];
  });
const rect = (cx, cy, a, b, angle) =>
  [[-a, -b], [a, -b], [a, b], [-a, b]].map(([x, y]) => [cx + x * Math.cos(angle) - y * Math.sin(angle), cy + x * Math.sin(angle) + y * Math.cos(angle)]);
const at = (ring2d, h) => ring2d.map(([x, y]) => [x, h, -y]); // local (x, y north) → world

/** Skins a stack of same-length rings into walls (+ a flat/sloped cap on the last ring). */
function skin(rings, { seed, kind, top }) {
  const pos = [], nrm = [];
  const push = (p, n) => { pos.push(...p); nrm.push(...n); };
  const normalOf = (a, b, c) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    const l = Math.hypot(...n) || 1;
    return n.map((v) => v / l);
  };
  for (let k = 0; k < rings.length - 1; k++) {
    const r0 = rings[k], r1 = rings[k + 1];
    for (let i = 0; i < r0.length; i++) {
      const j = (i + 1) % r0.length;
      const a = r0[i], b = r0[j], c = r1[j], d = r1[i];
      // Horizontal outward normal, same convention as geometry-worker.js (rings are CCW in local x/y;
      // world z = -y): local outward (dy, -dx) → world (dy, 0, dx).
      const dx = b[0] - a[0], dy = -(b[2] - a[2]);
      const l = Math.hypot(dx, dy) || 1;
      const n = [dy / l, 0, dx / l];
      for (const p of [a, b, c, a, c, d]) push(p, n);
    }
  }
  // Cap: fan from the centre of the last ring.
  const last = rings[rings.length - 1];
  const c = last.reduce((s, p) => [s[0] + p[0] / last.length, s[1] + p[1] / last.length, s[2] + p[2] / last.length], [0, 0, 0]);
  for (let i = 0; i < last.length; i++) {
    const a = last[i], b = last[(i + 1) % last.length];
    let n = normalOf(c, a, b);
    if (n[1] < 0) n = n.map((v) => -v);
    for (const p of [c, a, b]) push(p, n);
  }
  const count = pos.length / 3;
  return { pos, nrm, seed: new Array(count).fill(seed), kind: new Array(count).fill(kind), top: new Array(count).fill(top) };
}

/** Ensure rings wind counter-clockwise seen from above (outward normals). */
function ccw(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return a < 0 ? ring.slice().reverse() : ring;
}

function towerParts(sig) {
  const { center: [cx, cy], angle, a, b } = orientedExtents(sig.ring);
  const H = sig.height;
  const parts = [];
  const add = (rings, kind, top = H) => parts.push(skin(rings, { seed: (cx * 13.7 + cy * 7.1) % 1, kind, top }));
  const crowns = []; // [x, y, z] spots for crown lights

  switch (sig.id) {
    case 'wallCentre': {
      // Dark elliptical tower; the crown is lit.
      const e = ccw(ellipse(cx, cy, a * 0.95, b * 0.95, angle));
      add([at(e, 0), at(e, H)], 2);
      for (const p of ellipse(cx, cy, a * 0.97, b * 0.97, angle, 24)) crowns.push([p[0], H - 1.5, -p[1]]);
      break;
    }
    case 'paradox': {
      // Lower third follows the street grid; the upper tower is rotated 45°.
      const s = Math.min(a, b) * 0.95;
      const low = ccw(rect(cx, cy, a * 0.9, b * 0.9, angle));
      const up = ccw(rect(cx, cy, s * 0.82, s * 0.82, angle + Math.PI / 4));
      add([at(low, 0), at(low, H * 0.33)], 1, H * 0.33);
      add([at(up, H * 0.33), at(up, H)], 2);
      break;
    }
    case 'shangriLa': {
      // Slim glass tower stepping in toward a lit crown.
      const r0 = ccw(rect(cx, cy, a * 0.95, b * 0.95, angle));
      const r1 = ccw(rect(cx, cy, a * 0.8, b * 0.8, angle));
      const r2 = ccw(rect(cx, cy, a * 0.62, b * 0.62, angle));
      add([at(r0, 0), at(r0, H * 0.86)], 2, H * 0.86);
      add([at(r1, H * 0.86), at(r1, H * 0.94)], 2, H * 0.94);
      add([at(r2, H * 0.94), at(r2, H)], 2);
      crowns.push([cx, H + 6, -cy]);
      break;
    }
    case 'butterfly': {
      // Two curved lobes side by side.
      const ux = Math.cos(angle), uy = Math.sin(angle);
      for (const [k, h] of [[-0.42, H], [0.42, H * 0.95]]) {
        const e = ccw(ellipse(cx + ux * a * k, cy + uy * a * k, a * 0.55, b * 0.85, angle, 28));
        add([at(e, 0), at(e, h)], 1, h);
      }
      break;
    }
    case 'mnp': {
      // Office tower with a crown that slopes across the top.
      const r = ccw(rect(cx, cy, a * 0.92, b * 0.92, angle));
      const ux = Math.cos(angle), uy = Math.sin(angle);
      const slope = r.map(([x, y]) => [x, H - 14 * (0.5 + ((x - cx) * ux + (y - cy) * uy) / (2 * a)), -y]);
      add([at(r, 0), slope], 2);
      break;
    }
    case 'vancouverHouse': {
      // Widens as it rises: a narrow base "unpeels" to a full rectangle near the top.
      const ux = Math.cos(angle), uy = Math.sin(angle), vx = -uy, vy = ux;
      const W = Math.max(a, 22), D = Math.max(b, 14);
      const rings = [];
      for (let k = 0; k <= 10; k++) {
        const t = k / 10, grow = 0.35 + 0.65 * Math.min(1, t / 0.75) ** 1.4;
        const r = [[-W * grow, -D], [W * 0.15, -D], [W * 0.15 + W * 0.85 * grow, D], [-W * grow, D]].map(([x, y]) => [cx + ux * x + vx * y, cy + uy * x + vy * y]);
        rings.push(at(ccw(r), H * t));
      }
      add(rings, 1);
      break;
    }
  }
  return { parts, crowns, footprint: sig.ring, center: [cx, cy] };
}

/** Builds all signature towers. Returns { mesh, crownLights, footprints } (mesh uses the facade material). */
export function createSignatures(signatures, facadeMaterial) {
  const all = { pos: [], nrm: [], seed: [], kind: [], top: [] };
  const crownLights = [];
  const footprints = [];
  for (const sig of signatures) {
    const t = towerParts(sig);
    for (const p of t.parts) for (const k of Object.keys(all)) all[k].push(...p[k]);
    crownLights.push(...t.crowns.map((p) => ({ p, color: [5.5, 6, 7], size: 0.9 })));
    footprints.push(t.footprint);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(all.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(all.nrm, 3));
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(all.seed, 1));
  g.setAttribute('aKind', new THREE.Float32BufferAttribute(all.kind, 1));
  g.setAttribute('aTop', new THREE.Float32BufferAttribute(all.top, 1));
  g.setAttribute('aWall', new THREE.Float32BufferAttribute(new Float32Array(all.pos.length), 3)); // no per-wall fit: curved skins use the world grid
  g.computeBoundingSphere();
  return { mesh: new THREE.Mesh(g, facadeMaterial), crownLights, footprints };
}
