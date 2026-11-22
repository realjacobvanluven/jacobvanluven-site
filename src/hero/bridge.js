import * as THREE from 'three';

/**
 * The three False Creek bridges west of the camera, each from its real OSM axis (straight line, local metres):
 *  - Cambie Bridge: low concrete box-girder deck on piers, humped over the water.
 *  - Granville Street Bridge: a long, high deck of steel girders on tall concrete portal piers (pairs of
 *    columns joined by a cap beam), with cobra-head lamps.
 *  - Burrard Street Bridge: three steel through-truss spans between concrete Art Deco pylon gateways
 *    topped with lanterns, on concrete approach spans.
 * All three carry lamp standards and per-lane streams of car lights (white headlights toward the camera, red
 * taillights away). Heights and structure are approximate; the traffic is laid out per lane so it animates.
 */

const SPECS = {
  cambie: { width: 24, depth: 2.2, endH: 5, mainH: 16, lampH: 9, pier: 'slab', laneCount: 3, speeds: [13.5, 15.5, 12] },
  granville: { width: 27, depth: 2.6, endH: 9, mainH: 21, lampH: 10, pier: 'portal', laneCount: 3, speeds: [13, 15, 12] },
  burrard: { width: 21, depth: 1.8, endH: 8, mainH: 15, lampH: 8, pier: 'portal', laneCount: 2, speeds: [11, 13] },
};

export function createBridge(spec, { isWater = () => false, envMap = null, carSpacing = [10, 34] } = {}) {
  const { id, line } = spec;
  const S = SPECS[id] ?? SPECS.cambie;
  const [[sx, sy], [nx, ny]] = line[0][1] < line[1][1] ? line : [line[1], line[0]]; // south → north
  const L = Math.hypot(nx - sx, ny - sy);
  const ux = (nx - sx) / L, uy = (ny - sy) / L;
  const rx = uy, ry = -ux; // right of northbound travel
  const at = (t, side = 0) => [sx + ux * L * t + rx * side, sy + uy * L * t + ry * side];
  const heading = Math.atan2(uy, ux);

  // Where the deck crosses open water (as a share of its length).
  let tw0 = 1, tw1 = 0;
  for (let s = 0; s <= L; s += 3) {
    const [x, y] = at(s / L);
    if (isWater(x, y)) { tw0 = Math.min(tw0, s / L); tw1 = Math.max(tw1, s / L); }
  }
  if (tw1 <= tw0) { tw0 = 0.3; tw1 = 0.7; }

  // Deck height (m above the water): ramps up from the street at each end to the main level.
  const smooth = (v) => { const k = Math.min(1, Math.max(0, v)); return k * k * (3 - 2 * k); };
  let deckAt;
  if (id === 'cambie') {
    deckAt = (t) => 5 + 11 * Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, t))), 0.55);
  } else {
    const ramp = id === 'granville' ? 0.2 : 0.12;
    deckAt = (t) => S.endH + (S.mainH - S.endH) * smooth(Math.min(t, 1 - t) / ramp);
  }
  const W = (t, side, h) => { const [x, y] = at(t, side); return new THREE.Vector3(x, h, -y); };

  const group = new THREE.Group();
  const concrete = new THREE.MeshStandardMaterial({ color: id === 'granville' ? 0x74777c : 0x6b6f76, roughness: 0.85, envMap, envMapIntensity: 0.4 });
  const steel = new THREE.MeshStandardMaterial({ color: id === 'burrard' ? 0x3f4a52 : 0x4b5158, roughness: 0.55, metalness: 0.5, envMap, envMapIntensity: 0.7 });
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v3 = new THREE.Vector3();
  const unit = new THREE.BoxGeometry(1, 1, 1);

  /** Collects boxes (centre, orientation, size) into one InstancedMesh per material. */
  const batch = (material) => {
    const items = [];
    return {
      /** Box centred at c, with local axes: x along the bridge, y up, z across; size = [along, up, across]. */
      box(c, size, tilt = 0) {
        q.setFromEuler(e.set(0, heading, tilt, 'YXZ'));
        items.push(new THREE.Matrix4().compose(c.clone(), q.clone(), v3.set(...size).clone()));
      },
      /** Slender member from p0 to p1 with a square section. */
      bar(p0, p1, thick) {
        const d = p1.clone().sub(p0), len = d.length();
        q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), d.normalize());
        items.push(new THREE.Matrix4().compose(p0.clone().add(p1).multiplyScalar(0.5), q.clone(), new THREE.Vector3(len, thick, thick)));
      },
      finish() {
        if (!items.length) return;
        const mesh = new THREE.InstancedMesh(unit, material, items.length);
        items.forEach((mat, i) => mesh.setMatrixAt(i, mat));
        group.add(mesh);
      },
      get count() { return items.length; },
    };
  };
  const deckParts = batch(id === 'burrard' ? concrete : id === 'granville' ? steel : concrete);
  const concreteParts = batch(concrete);
  const steelParts = batch(steel);

  // Deck as a strip of boxes following the profile (a deep edge girder on Granville).
  const N = Math.max(24, Math.ceil(L / 14));
  for (let i = 0; i < N; i++) {
    const t0 = i / N, t1 = (i + 1) / N;
    const [x0, y0] = at(t0), [x1, y1] = at(t1);
    const h0 = deckAt(t0), h1 = deckAt(t1);
    const run = Math.hypot(x1 - x0, y1 - y0);
    const c = new THREE.Vector3((x0 + x1) / 2, (h0 + h1) / 2 - S.depth / 2, -(y0 + y1) / 2);
    deckParts.box(c, [Math.hypot(run, h1 - h0) + 0.05, S.depth, S.width], Math.atan2(h1 - h0, run));
    // Low parapets on both edges.
    for (const side of [-1, 1]) {
      const p = W((t0 + t1) / 2, side * (S.width / 2 - 0.25), (h0 + h1) / 2 + 0.45);
      concreteParts.box(p, [Math.hypot(run, h1 - h0) + 0.05, 0.9, 0.5], Math.atan2(h1 - h0, run));
    }
  }

  // ---- Piers -----------------------------------------------------------------------------------------
  let piers = 0;
  const column = (t, side, w, h, d = w) => { // concrete column from the ground up to the deck underside
    concreteParts.box(W(t, side, (h - S.depth) / 2 - 0.4), [d, h - S.depth + 0.8, w]);
    piers++;
  };
  if (S.pier === 'slab') {
    // Cambie: slab piers where the bridge crosses water.
    for (let t = 0.02; t < 1; t += 42 / L) {
      const [x, y] = at(t);
      if (isWater(x, y)) { const h = deckAt(t); concreteParts.box(W(t, 0, (h - S.depth) / 2 - 0.5), [3.2, h - S.depth + 1, S.width * 0.7]); piers++; }
    }
  } else if (id === 'granville') {
    // Tall concrete portal piers: pairs of columns under a cap beam, every ~48 m, the whole length.
    const n = Math.round(L / 48);
    for (let k = 1; k < n; k++) {
      const t = k / n, h = deckAt(t);
      for (const side of [-1, 1]) column(t, side * 8.2, 2.6, h - 1, 2.2);
      concreteParts.box(W(t, 0, h - S.depth - 1.1), [2.6, 2.2, S.width * 0.74]);
    }
  }

  // ---- Burrard: steel through-truss spans between pylon gateways --------------------------------------
  const lamps = [];
  const trussT0 = Math.max(0.05, tw0 - 0.02), trussT1 = Math.min(0.95, tw1 + 0.02);
  if (id === 'burrard') {
    const spans = 3, TW = S.width / 2 - 1.5; // trusses sit just inside the edges
    const pylonTs = [];
    for (let k = 0; k <= spans; k++) pylonTs.push(trussT0 + ((trussT1 - trussT0) * k) / spans);
    // Concrete approach piers outside the truss section (and the truss piers themselves are the pylon bases).
    for (let t = 0.03; t < 1; t += 34 / L) {
      if (t > trussT0 - 0.01 && t < trussT1 + 0.01) continue;
      const h = deckAt(t);
      for (const side of [-1, 1]) column(t, side * 7, 2.2, h - 0.5);
      concreteParts.box(W(t, 0, h - S.depth - 0.9), [2.2, 1.8, S.width * 0.7]);
    }
    for (let k = 0; k < spans; k++) {
      const ta = pylonTs[k], tb = pylonTs[k + 1], spanLen = (tb - ta) * L;
      const panels = Math.max(6, Math.round(spanLen / 9));
      const peak = k === 1 ? 12 : 9, endTop = 7;
      const top = (s) => endTop + (peak - endTop) * Math.pow(Math.sin(Math.PI * s), 0.8);
      for (const side of [-1, 1]) {
        const sd = side * TW;
        let prevTop = null;
        for (let i = 0; i <= panels; i++) {
          const s = i / panels, t = ta + (tb - ta) * s, hd = deckAt(t) + 0.6;
          const pTop = W(t, sd, hd + top(s)), pBot = W(t, sd, hd);
          steelParts.bar(pBot, pTop, 0.7); // post
          if (prevTop) {
            steelParts.bar(prevTop.t, pTop, 0.9); // top chord
            // Pratt diagonals, sloping down toward mid-span.
            const dir = s <= 0.5 ? 1 : -1, pb = prevTop.b;
            if (dir > 0) steelParts.bar(prevTop.t, pBot, 0.5); else steelParts.bar(pTop, pb, 0.5);
          }
          // Top lateral bracing across the roadway at every other panel.
          if (side < 0 && i > 0 && i < panels && i % 2 === 0) steelParts.bar(W(t, -TW, hd + top(s) - 0.4), W(t, TW, hd + top(s) - 0.4), 0.45);
          prevTop = { t: pTop, b: pBot };
        }
      }
    }
    // Pylon gateways at each end of the truss section, and shorter piers at the two inner joints.
    pylonTs.forEach((t, k) => {
      const h = deckAt(t), end = k === 0 || k === spans;
      for (const side of [-1, 1]) {
        const sd = side * (S.width / 2 + 1.2);
        column(t, sd, 4.2, h - 0.5, 4.2);
        if (end) {
          concreteParts.box(W(t, sd, h + 9), [4.2, 18, 4.2]);
          concreteParts.box(W(t, sd, h + 19), [5.2, 1.4, 5.2]);
          concreteParts.box(W(t, sd, h + 20.4), [3.2, 1.4, 3.2]);
          lamps.push({ p: [...(({ x, y, z }) => [x, y, z])(W(t, sd, h + 21.5))], color: [7, 5.2, 3.2], size: 2.2 });
          lamps.push({ p: [...(({ x, y, z }) => [x, y, z])(W(t, sd, h + 2))], color: [4, 3, 2], size: 1.6 });
        } else {
          concreteParts.box(W(t, sd, h + 2.5), [4.2, 5, 4.2]);
          lamps.push({ p: [...(({ x, y, z }) => [x, y, z])(W(t, sd, h + 5.6))], color: [6, 4.6, 3], size: 1.2 });
        }
      }
      if (end) concreteParts.box(W(t, 0, h + 16.5), [3.2, 2.4, S.width + 4.8]); // gateway beam across the deck
      concreteParts.box(W(t, 0, h - S.depth - 0.9), [4.2, 1.8, S.width + 4.8]);
    });
  }

  deckParts.finish(); concreteParts.finish(); steelParts.finish();

  // ---- Lamp standards and traffic --------------------------------------------------------------------
  const lights = [...lamps];
  for (let t = 0.03; t < 0.97; t += 36 / L) {
    for (const side of [-1, 1]) {
      const p = W(t, side * (S.width / 2 - 0.5), deckAt(t) + S.lampH);
      lights.push({ p: [p.x, p.y, p.z], color: [6, 4.2, 2.4], size: 0.7 });
    }
  }
  // Camera sits at the origin: lanes heading toward it show headlights, those heading away show taillights.
  const mid = at(0.5);
  const northTowardCamera = ux * -mid[0] + uy * -mid[1] > 0;

  let seed = 31 + id.length * 7;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  // Lanes: offsets from the centre line. Each lane has its own speed (m/s), so cars in a lane never overlap.
  const lanes = [];
  for (let i = 0; i < S.laneCount; i++) {
    const off = 3 + i * 3.3;
    lanes.push({ offset: off, dir: 1, speed: S.speeds[i] }, { offset: -off, dir: -1, speed: S.speeds[i] + 0.6 });
  }
  const cars = [];
  const carLights = [];
  for (const [li, lane] of lanes.entries()) {
    for (let s = rand() * 20; s < L; s += carSpacing[0] + rand() * (carSpacing[1] - carSpacing[0])) {
      const toward = (lane.dir > 0) === northTowardCamera;
      const color = toward ? [6.5, 6.2, 5.4] : [5.5, 0.18, 0.08];
      cars.push({ lane: li, s0: s });
      for (let k = 0; k < 2; k++) carLights.push({ p: [0, 0, 0], color, size: toward ? 0.45 : 0.35 });
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

  return { id, group, lights, carLights, updateTraffic, lanes, cars, length: L, stats: { id, piers, cars: cars.length, members: steelParts.count } };
}
