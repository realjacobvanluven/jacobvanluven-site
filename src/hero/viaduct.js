import * as THREE from 'three';

/**
 * The Georgia and Dunsmuir Viaducts as they stood before demolition (2022–25): one-way concrete decks on piers
 * that rise from grade by Beatty Street, curve past Rogers Arena and run east above the rail yards.
 * Centrelines come from OSM (west → east); heights are approximate (about 10 m at the crown).
 */

const DECK_WIDTH = 13;
const DECK_DEPTH = 1.9;
const CROWN = 10.5;
const RAMP_WEST = 300, RAMP_EAST = 170; // metres to climb from grade at each end
const STEP = 5;

/** Polyline helper: cumulative lengths and point/tangent lookup by arc length. */
function pathOf(line) {
  const cum = [0];
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
  const length = cum[cum.length - 1];
  const at = (s) => {
    s = Math.min(length, Math.max(0, s));
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const f = (s - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
    const [x0, y0] = line[i - 1], [x1, y1] = line[i];
    const d = Math.hypot(x1 - x0, y1 - y0) || 1;
    return { x: x0 + (x1 - x0) * f, y: y0 + (y1 - y0) * f, tx: (x1 - x0) / d, ty: (y1 - y0) / d };
  };
  const height = (s) => {
    const k = (v) => v * v * (3 - 2 * v); // smoothstep
    return CROWN * k(Math.min(1, s / RAMP_WEST)) * k(Math.min(1, (length - s) / RAMP_EAST));
  };
  return { length, at, height };
}

export function createViaducts(lines, { envMap = null, carSpacing = [14, 40] } = {}) {
  const group = new THREE.Group();
  const concrete = new THREE.MeshStandardMaterial({ color: 0x777a80, roughness: 0.9, envMap, envMapIntensity: 0.4 });
  const paths = lines.map(pathOf);

  const deckInst = [], barrierInst = [], pierInst = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const place = (list, x, y, z, heading, pitch, sx, sy, sz) => {
    q.setFromEuler(e.set(0, heading, pitch, 'YXZ'));
    list.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz)));
  };

  const lights = [];
  paths.forEach((p) => {
    for (let s = 0; s < p.length; s += STEP) {
      const a = p.at(s), b = p.at(Math.min(p.length, s + STEP));
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const h0 = p.height(s), h1 = p.height(Math.min(p.length, s + STEP)), hm = (h0 + h1) / 2;
      const run = Math.hypot(b.x - a.x, b.y - a.y);
      const heading = Math.atan2(b.y - a.y, b.x - a.x), pitch = Math.atan2(h1 - h0, run);
      const seg = Math.hypot(run, h1 - h0) * 1.12;
      place(deckInst, mx, hm - DECK_DEPTH / 2, -my, heading, pitch, seg, 1, 1);
      const rx = b.y - a.y, ry = -(b.x - a.x), rl = Math.hypot(rx, ry) || 1;
      for (const side of [-1, 1]) {
        const o = side * (DECK_WIDTH / 2 - 0.3);
        place(barrierInst, mx + (rx / rl) * o, hm + 0.45, -(my + (ry / rl) * o), heading, pitch, seg, 1, 1);
      }
    }
    // Piers every ~26 m where the deck is clear of the ground.
    for (let s = 13; s < p.length; s += 26) {
      const c = p.at(s), h = p.height(s);
      if (h < 2.5) continue;
      place(pierInst, c.x, (h - DECK_DEPTH) / 2, -c.y, Math.atan2(c.ty, c.tx), 0, 1, h - DECK_DEPTH, 1);
    }
    // Lamp standards on both edges, warm sodium.
    for (let s = 18; s < p.length - 10; s += 34) {
      const c = p.at(s), h = p.height(s);
      for (const side of [-1, 1]) {
        const o = side * (DECK_WIDTH / 2 - 0.4);
        lights.push({ p: [c.x + c.ty * o, h + 8.5, -(c.y - c.tx * o)], color: [6, 4.2, 2.4], size: 0.65 });
      }
    }
  });

  const addInst = (geo, mats) => {
    const mesh = new THREE.InstancedMesh(geo, concrete, mats.length);
    mats.forEach((mat, i) => mesh.setMatrixAt(i, mat));
    group.add(mesh);
  };
  addInst(new THREE.BoxGeometry(1, DECK_DEPTH, DECK_WIDTH), deckInst);
  addInst(new THREE.BoxGeometry(1, 0.9, 0.55), barrierInst);
  addInst(new THREE.BoxGeometry(2.4, 1, 6.5), pierInst);

  // Traffic: one-way, three lanes, in the direction the way was mapped (west → east after ordering is
  // reversed, so Georgia runs east and Dunsmuir west, into downtown).
  let seed = 77;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const lanes = [{ offset: -4, speed: 12 }, { offset: 0, speed: 14.5 }, { offset: 4, speed: 13 }];
  const cars = [], carLights = [];
  lines.forEach((_, vi) => {
    const dir = vi === 0 ? 1 : -1; // Georgia eastbound, Dunsmuir westbound
    const p = paths[vi];
    for (const [li] of lanes.entries()) {
      for (let s = rand() * 25; s < p.length; s += carSpacing[0] + rand() * (carSpacing[1] - carSpacing[0])) {
        const t = p.at(s);
        const ty = dir * t.ty; // + = heading north, away from the camera → taillights
        const color = ty > 0.35 ? [5.5, 0.18, 0.08] : ty < -0.35 ? [6.5, 6.2, 5.4] : [3.4, 1.9, 1.0];
        cars.push({ v: vi, lane: li, s0: s, dir });
        for (let k = 0; k < 2; k++) carLights.push({ p: [0, 0, 0], color, size: 0.4 });
      }
    }
  });

  function updateTraffic(positions, time) {
    let i = 0;
    for (const car of cars) {
      const p = paths[car.v], lane = lanes[car.lane];
      const s = (((car.s0 + car.dir * lane.speed * time) % p.length) + p.length) % p.length;
      const c = p.at(s), h = p.height(s) + 0.75;
      for (const k of [-0.8, 0.8]) {
        const o = lane.offset + k;
        positions[i++] = c.x + c.ty * o; positions[i++] = h; positions[i++] = -(c.y - c.tx * o);
      }
    }
  }

  return { group, lights, carLights, updateTraffic, stats: { cars: cars.length, lights: lights.length, length: paths.reduce((t, p) => t + p.length, 0) } };
}
