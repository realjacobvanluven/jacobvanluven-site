import * as THREE from 'three';

/**
 * Cambie Bridge: a long, low concrete deck on piers, with lamp standards and streams of car lights
 * (white headlights coming toward the south end, red taillights heading north). The traffic is laid out
 * per lane so it can be animated later.
 */

const DECK_WIDTH = 24;
const DECK_DEPTH = 2.2;

export function createBridge(line, { isWater = () => false, envMap = null, carSpacing = [10, 34] } = {}) {
  const [[sx, sy], [nx, ny]] = line[0][1] < line[1][1] ? line : [line[1], line[0]]; // south → north
  const L = Math.hypot(nx - sx, ny - sy);
  const ux = (nx - sx) / L, uy = (ny - sy) / L;
  const rx = uy, ry = -ux; // right of northbound travel (east side)
  const deckAt = (t) => 5 + 11 * Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, t))), 0.55); // deck height (m)
  const at = (t, side = 0) => [sx + ux * L * t + rx * side, sy + uy * L * t + ry * side];

  const group = new THREE.Group();
  const concrete = new THREE.MeshStandardMaterial({ color: 0x6b6f76, roughness: 0.85, envMap, envMapIntensity: 0.4 });

  // Deck as a strip of boxes following the profile.
  const N = 48;
  const deckGeo = new THREE.BoxGeometry(1, DECK_DEPTH, DECK_WIDTH);
  const deck = new THREE.InstancedMesh(deckGeo, concrete, N);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const heading = Math.atan2(uy, ux); // local angle from +x toward +y
  for (let i = 0; i < N; i++) {
    const t0 = i / N, t1 = (i + 1) / N;
    const [x0, y0] = at(t0), [x1, y1] = at(t1);
    const h0 = deckAt(t0), h1 = deckAt(t1);
    const segLen = Math.hypot(x1 - x0, y1 - y0, h1 - h0);
    e.set(0, heading, Math.atan2(h1 - h0, Math.hypot(x1 - x0, y1 - y0)), 'YXZ');
    q.setFromEuler(e);
    m.compose(new THREE.Vector3((x0 + x1) / 2, (h0 + h1) / 2 - DECK_DEPTH / 2, -(y0 + y1) / 2), q, new THREE.Vector3(segLen + 0.05, 1, 1));
    deck.setMatrixAt(i, m);
  }
  group.add(deck);

  // Piers where the bridge crosses water.
  const piers = [];
  for (let t = 0.02; t < 1; t += 42 / L) {
    const [x, y] = at(t);
    if (isWater(x, y)) piers.push([x, y, deckAt(t)]);
  }
  if (piers.length) {
    const pier = new THREE.InstancedMesh(new THREE.BoxGeometry(3.2, 1, DECK_WIDTH * 0.7), concrete, piers.length);
    piers.forEach(([x, y, h], i) => {
      q.setFromEuler(e.set(0, heading, 0));
      m.compose(new THREE.Vector3(x, (h - DECK_DEPTH) / 2 - 0.5, -y), q, new THREE.Vector3(1, h - DECK_DEPTH + 1, 1));
      pier.setMatrixAt(i, m);
    });
    group.add(pier);
  }

  // Lamp standards on both edges, and the traffic.
  const lights = [];
  for (let t = 0.03; t < 0.97; t += 36 / L) {
    for (const side of [-1, 1]) {
      const [x, y] = at(t, side * (DECK_WIDTH / 2 - 0.5));
      lights.push({ p: [x, deckAt(t) + 9, -y], color: [6, 4.2, 2.4], size: 0.7 });
    }
  }
  let seed = 31;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  // Lanes: offsets from the centre line (negative = west = southbound in right-hand traffic).
  // Each lane has its own speed (m/s), so cars in a lane never overlap.
  const lanes = [
    { offset: 3.2, dir: 1, speed: 13.5 }, { offset: 6.6, dir: 1, speed: 15.5 }, { offset: 9.6, dir: 1, speed: 12 },
    { offset: -3.2, dir: -1, speed: 14 }, { offset: -6.6, dir: -1, speed: 16 }, { offset: -9.6, dir: -1, speed: 12.5 },
  ];
  const cars = [];
  const carLights = [];
  for (const [li, lane] of lanes.entries()) {
    for (let s = rand() * 20; s < L; s += carSpacing[0] + rand() * (carSpacing[1] - carSpacing[0])) {
      // Northbound cars show taillights to the camera (south-east of the bridge); southbound show headlights.
      const tail = lane.dir > 0;
      const color = tail ? [5.5, 0.18, 0.08] : [6.5, 6.2, 5.4];
      cars.push({ lane: li, s0: s });
      for (let k = 0; k < 2; k++) carLights.push({ p: [0, 0, 0], color, size: tail ? 0.35 : 0.45 });
    }
  }

  /** Writes every car's two light positions for time t (seconds) into a Float32Array (xyz per light). */
  function updateTraffic(positions, time) {
    let i = 0;
    for (const car of cars) {
      const lane = lanes[car.lane];
      const s = (((car.s0 + lane.dir * lane.speed * time) % L) + L) % L;
      const t = s / L;
      const h = deckAt(t) + 0.75;
      for (const k of [-0.8, 0.8]) {
        const [x, y] = at(t, lane.offset + k);
        positions[i++] = x; positions[i++] = h; positions[i++] = -y;
      }
    }
  }

  return { group, lights, carLights, updateTraffic, lanes, cars, length: L, stats: { piers: piers.length, cars: cars.length } };
}
