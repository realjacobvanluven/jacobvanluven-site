import * as THREE from 'three';
import { createTrees } from './waterfront.js';
import { isIsland } from './ribbon.js';
import { createCarBodies } from './streets.js';

/**
 * South-bank street life (added 2026-11-22), what you see when you tilt the view down toward the Olympic Village
 * and the seawall: railings and benches along the water, parked cars along the local streets, street trees, and
 * people and cyclists moving along the paths. Everything is generated from the same OpenStreetMap lines the rest of
 * the scene uses (shoreline, paths, roads), only near the camera, and sized per device (see `detail`).
 *
 * Local metres: x east, y north. Three.js world: X = x, Y = up, Z = -y.
 */

const TOP = 1.6; // seawall deck height above the water (matches seawall.js)

const rng = (seed) => { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); };

function cumulative(line) {
  const cum = [0];
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
  return cum;
}

/** Point and unit direction at arc length s along a polyline (with its cumulative lengths). */
function sample(line, cum, s) {
  let i = 1;
  while (i < cum.length - 1 && cum[i] < s) i++;
  const [ax, ay] = line[i - 1], [bx, by] = line[i];
  const seg = cum[i] - cum[i - 1] || 1, t = Math.min(1, Math.max(0, (s - cum[i - 1]) / seg));
  return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t, ux: (bx - ax) / seg, uy: (by - ay) / seg };
}

/** A grid of building footprints, to keep cars and trees out of them. */
function occupancy(buildings) {
  const CELL = 40, grid = new Map();
  const key = (i, j) => `${i},${j}`;
  for (const b of buildings) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of b.ring) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    const entry = { ring: b.ring, box: [x0, y0, x1, y1] };
    for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) for (let j = Math.floor(y0 / CELL); j <= Math.floor(y1 / CELL); j++) {
      const k = key(i, j);
      (grid.get(k) ?? grid.set(k, []).get(k)).push(entry);
    }
  }
  return (x, y, pad = 1.5) => {
    for (const e of grid.get(key(Math.floor(x / CELL), Math.floor(y / CELL))) ?? []) {
      const [x0, y0, x1, y1] = e.box;
      if (x < x0 - pad || x > x1 + pad || y < y0 - pad || y > y1 + pad) continue;
      let inside = false;
      const r = e.ring;
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        if (r[i][1] > y !== r[j][1] > y && x < ((r[j][0] - r[i][0]) * (y - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) inside = !inside;
      }
      if (inside) return true;
      // Also near an edge: cars and trees shouldn't touch the walls.
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const [ax, ay] = r[j], [bx, by] = r[i];
        const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
        if (Math.hypot(x - (ax + dx * t), y - (ay + dy * t)) < pad) return true;
      }
    }
    return false;
  };
}

/** Railing (a thin rail on posts) and benches along the water's edge, within `distance` of the camera. */
function createSeawallFurniture(shoreline, { camera, distance, isWater }) {
  const group = new THREE.Group();
  const near = (x, y) => Math.hypot(x - camera[0], y - camera[1]) < distance;
  const posts = [], benches = [], rail = [];
  const rand = rng(31);
  for (const line of shoreline) {
    if (isIsland(line) || !line.some(([x, y]) => near(x, y))) continue;
    const cum = cumulative(line);
    const total = cum[cum.length - 1];
    let prev = null;
    for (let s = 0; s < total; s += 4.5) {
      const p = sample(line, cum, s);
      if (!near(p.x, p.y)) { prev = null; continue; }
      // Land is on the left of the coastline direction.
      const lx = -p.uy, ly = p.ux;
      const x = p.x + lx * 0.35, y = p.y + ly * 0.35;
      posts.push([x, y]);
      if (prev) rail.push(prev, [x, y]);
      prev = [x, y];
      if (rand() < 0.06) {
        const bx = p.x + lx * 1.9, by = p.y + ly * 1.9;
        if (!isWater(bx, by)) benches.push({ x: bx, y: by, a: Math.atan2(p.uy, p.ux) });
      }
    }
  }
  // Posts.
  const postGeo = new THREE.BoxGeometry(0.1, 1.05, 0.1);
  postGeo.translate(0, 0.52, 0);
  const postMesh = new THREE.InstancedMesh(postGeo, new THREE.MeshBasicMaterial({ color: 0x44414a }), posts.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
  posts.forEach(([x, y], i) => postMesh.setMatrixAt(i, m.compose(new THREE.Vector3(x, TOP, -y), q, one)));
  group.add(postMesh);
  // Top rail: flat strip segments.
  const rp = [];
  for (let i = 0; i < rail.length; i += 2) {
    const [ax, ay] = rail[i], [bx, by] = rail[i + 1];
    const len = Math.hypot(bx - ax, by - ay) || 1, nx = -(by - ay) / len * 0.06, ny = (bx - ax) / len * 0.06;
    const y = TOP + 1.05;
    rp.push(ax - nx, y, -(ay - ny), bx - nx, y, -(by - ny), bx + nx, y, -(by + ny), ax - nx, y, -(ay - ny), bx + nx, y, -(by + ny), ax + nx, y, -(ay + ny));
  }
  const rg = new THREE.BufferGeometry();
  rg.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
  group.add(new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: 0x6a6670, side: THREE.DoubleSide })));
  // Benches: a seat and a back, facing the water.
  if (benches.length) {
    const seat = new THREE.BoxGeometry(1.8, 0.07, 0.5); seat.translate(0, 0.45, 0);
    const back = new THREE.BoxGeometry(1.8, 0.45, 0.06); back.translate(0, 0.75, 0.22);
    const geo = new THREE.BufferGeometry();
    const merged = [seat, back].map((g) => g.toNonIndexed());
    const pos = [], nrm = [];
    for (const g of merged) { pos.push(...g.attributes.position.array); nrm.push(...g.attributes.normal.array); }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0x5a4330, emissive: new THREE.Color(0.05, 0.035, 0.02) }), benches.length);
    benches.forEach((b, i) => mesh.setMatrixAt(i, m.compose(new THREE.Vector3(b.x, TOP, -b.y), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.a), one)));
    group.add(mesh);
  }
  return { group, stats: { posts: posts.length, benches: benches.length } };
}

/**
 * Walkers and cyclists on the paths and the seawall. Each follows one route (a polyline) back and forth at its own
 * speed; cyclists carry a small white front light (returned as `cyclistLights`, positions rewritten each frame).
 */
function createPeople(routes, { walkers, cyclists, camera }) {
  const rand = rng(404);
  const group = new THREE.Group();
  const walkRoutes = routes.filter((r) => r.length > 40);
  const bikeRoutes = routes.filter((r) => r.length > 80);
  if (!walkRoutes.length) return { group, update() {}, updateLights() {}, cyclistLights: [], stats: { walkers: 0, cyclists: 0 } };
  // Routes close to the camera get most of the people (weight falls off with distance).
  const weight = (r) => r.length * Math.exp(-r.near / 200);
  const pick = (list) => {
    const total = list.reduce((t, r) => t + weight(r), 0);
    let v = rand() * total;
    for (const r of list) { v -= weight(r); if (v <= 0) return r; }
    return list[list.length - 1];
  };
  const agents = [];
  for (let i = 0; i < walkers; i++) agents.push({ route: pick(walkRoutes), s0: rand(), dir: rand() < 0.5 ? 1 : -1, speed: 1.1 + rand() * 0.6, off: (rand() - 0.5) * 1.4, bike: false });
  for (let i = 0; i < cyclists && bikeRoutes.length; i++) agents.push({ route: pick(bikeRoutes), s0: rand(), dir: rand() < 0.5 ? 1 : -1, speed: 4 + rand() * 2.5, off: (rand() - 0.5) * 0.8, bike: true });
  for (const a of agents) {
    // Start where the route passes closest to the camera (best of a few random tries): people are most visible there.
    let best = null;
    for (let t = 0; t < 6; t++) {
      const s = rand() * a.route.length, p = sample(a.route.line, a.route.cum, s), d = Math.hypot(p.x - camera[0], p.y - camera[1]);
      if (!best || d < best.d) best = { s, d };
    }
    a.s0 = best.s;
  }

  const people = agents.filter((a) => !a.bike), bikes = agents.filter((a) => a.bike);
  const coats = [0x2a2d38, 0x4a3a30, 0x6a3028, 0x2c3e5a, 0x8a8a92, 0x3c5a3a, 0x9a8460, 0x30303a];
  const make = (list, geo) => {
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: new THREE.Color(0.1, 0.075, 0.05) }), Math.max(1, list.length));
    mesh.frustumCulled = false; // instances move
    list.forEach((_, i) => mesh.setColorAt(i, new THREE.Color(coats[Math.floor(rand() * coats.length)])));
    return mesh;
  };
  const bodyGeo = new THREE.CylinderGeometry(0.26, 0.3, 1.55, 6); bodyGeo.translate(0, 0.78, 0);
  const headGeo = new THREE.SphereGeometry(0.16, 6, 4); headGeo.translate(0, 1.7, 0);
  const walker = new THREE.BufferGeometry();
  {
    const parts = [bodyGeo.toNonIndexed(), headGeo.toNonIndexed()];
    walker.setAttribute('position', new THREE.Float32BufferAttribute(parts.flatMap((g) => [...g.attributes.position.array]), 3));
    walker.setAttribute('normal', new THREE.Float32BufferAttribute(parts.flatMap((g) => [...g.attributes.normal.array]), 3));
  }
  const bikeGeo = new THREE.BoxGeometry(1.7, 0.95, 0.3); bikeGeo.translate(0, 0.62, 0);
  const walkMesh = make(people, walker), bikeMesh = make(bikes, bikeGeo);
  group.add(walkMesh, bikeMesh);
  const cyclistLights = bikes.map(() => ({ p: [0, 0, 0], color: [5.5, 5.4, 5], size: 0.22 }));

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  const place = (a, time) => {
    const L = a.route.length;
    const s = (((a.s0 + a.dir * a.speed * time) % L) + L) % L;
    const p = sample(a.route.line, a.route.cum, s);
    return { x: p.x - p.uy * a.off, y: p.y + p.ux * a.off, ux: p.ux * a.dir, uy: p.uy * a.dir, h: a.route.y };
  };
  return {
    group,
    cyclistLights,
    stats: { walkers: people.length, cyclists: bikes.length },
    update(time) {
      people.forEach((a, i) => {
        const p = place(a, time);
        // A little bob in the stride.
        walkMesh.setMatrixAt(i, m.compose(v.set(p.x, p.h + Math.abs(Math.sin(time * 6 + a.s0)) * 0.03, -p.y), q.setFromAxisAngle(up, Math.atan2(p.uy, p.ux)), one));
      });
      bikes.forEach((a, i) => {
        const p = place(a, time);
        bikeMesh.setMatrixAt(i, m.compose(v.set(p.x, p.h, -p.y), q.setFromAxisAngle(up, Math.atan2(p.uy, p.ux)), one));
      });
      walkMesh.instanceMatrix.needsUpdate = true;
      bikeMesh.instanceMatrix.needsUpdate = true;
    },
    /** Writes the cyclists' front-light positions (xyz per light). */
    updateLights(positions, time) {
      bikes.forEach((a, i) => {
        const p = place(a, time);
        positions[i * 3] = p.x + p.ux * 0.9; positions[i * 3 + 1] = p.h + 0.95; positions[i * 3 + 2] = -(p.y + p.uy * 0.9);
      });
    },
  };
}

/**
 * @param {object} data  decoded skyline data (shoreline, paths, roads)
 * @param {{ camera: number[], isWater: Function, buildings: object[], detail: object }} opts
 *   detail: { furnitureDistance, parkedDistance, maxParked, streetTrees, walkers, cyclists }
 */
export function createSouthBank(data, uniforms, { camera, isWater, buildings, detail }) {
  const group = new THREE.Group();
  group.name = 'south-bank';
  const rand = rng(88);
  const dist = (x, y) => Math.hypot(x - camera[0], y - camera[1]);
  const blocked = occupancy(buildings.filter((b) => dist(b.c[0], b.c[1]) < Math.max(detail.parkedDistance, 900) + 200));

  const furniture = createSeawallFurniture(data.shoreline, { camera, distance: detail.furnitureDistance, isWater });
  group.add(furniture.group);

  // Parked cars along the local streets (one kerb lane each side, about half full) and street trees beyond them.
  const cars = [], treePts = [];
  for (const road of data.roads) {
    if (road.main || road.line.length < 2 || !road.line.some(([x, y]) => dist(x, y) < detail.parkedDistance)) continue;
    const cum = cumulative(road.line), total = cum[cum.length - 1];
    if (total < 25) continue;
    for (const side of [1, -1]) {
      for (let s = 8 + rand() * 4; s < total - 8; s += 6.4 + rand() * 1.6) {
        const p = sample(road.line, cum, s);
        if (dist(p.x, p.y) > detail.parkedDistance) continue;
        const x = p.x - p.uy * 4.6 * side, y = p.y + p.ux * 4.6 * side;
        if (rand() < 0.5 || isWater(x, y) || blocked(x, y, 2.2)) continue;
        cars.push({ x, y, a: Math.atan2(p.uy, p.ux) + (rand() < 0.04 ? 0.18 : 0) });
      }
      for (let s = 5 + rand() * 6; s < total - 5; s += 13 + rand() * 5) {
        const p = sample(road.line, cum, s);
        if (dist(p.x, p.y) > detail.parkedDistance * 1.3 || rand() < 0.4) continue;
        const x = p.x - p.uy * 8.2 * side, y = p.y + p.ux * 8.2 * side;
        if (!isWater(x, y) && !blocked(x, y, 3)) treePts.push([x, y]);
      }
    }
  }
  cars.sort((a, b) => dist(a.x, a.y) - dist(b.x, b.y));
  const parked = cars.slice(0, detail.maxParked);
  if (parked.length) {
    const bodies = createCarBodies(parked.length, uniforms, rand);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    parked.forEach((c, i) => bodies.mesh.setMatrixAt(i, m.compose(v.set(c.x, 0, -c.y), q.setFromAxisAngle(up, c.a), one)));
    bodies.mesh.instanceMatrix.needsUpdate = true;
    group.add(bodies.mesh);
  }
  treePts.sort((a, b) => dist(a[0], a[1]) - dist(b[0], b[1]));
  const trees = treePts.length ? createTrees(treePts, uniforms, { max: detail.streetTrees }) : null;
  if (trees) group.add(trees.group);

  // Routes for walkers and cyclists: the seawall (offset inland from the shoreline) and the mapped footpaths.
  const routes = [];
  const addRoute = (line, y) => {
    const pts = line.filter(([x, y]) => dist(x, y) < detail.peopleDistance);
    if (pts.length < 2) return;
    const cum = cumulative(pts);
    if (cum[cum.length - 1] > 30) routes.push({ line: pts, cum, length: cum[cum.length - 1], y, near: Math.min(...pts.map(([x, y]) => dist(x, y))) });
  };
  for (const line of data.shoreline) {
    if (isIsland(line)) continue;
    // Offset to the seawall path (land is on the left of the coastline direction).
    const off = line.map((p, i) => {
      const a = line[Math.max(0, i - 1)], b = line[Math.min(line.length - 1, i + 1)];
      const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
      return [p[0] - (dy / l) * 2.6, p[1] + (dx / l) * 2.6];
    });
    addRoute(off, TOP);
  }
  for (const path of data.paths) addRoute(path.line, 0.1);
  const people = createPeople(routes, { walkers: detail.walkers, cyclists: detail.cyclists, camera });
  group.add(people.group);

  return {
    group,
    update: people.update,
    cyclistLights: people.cyclistLights,
    updateLights: people.updateLights,
    stats: { ...furniture.stats, parkedCars: parked.length, streetTrees: trees?.count ?? 0, ...people.stats, routes: routes.length },
  };
}
