import * as THREE from 'three';

/**
 * The three False Creek bridges west of the camera, each from its real OSM axis (straight line, local metres):
 *  - Cambie Bridge: concrete box-girder deck on paired columns, humped over the water.
 *  - Granville Street Bridge: a long, high deck on deep steel plate girders, carried by tall concrete portal
 *    piers (pairs of columns under a cap beam, on footings), with long-arm cobra lamps.
 *  - Burrard Street Bridge: three steel through-truss spans with arched top chords and outboard sidewalks,
 *    between stepped Art Deco concrete pylon gateways topped with lanterns, on concrete approach spans.
 * Granville's raised south approach (down Granville Street), its off-ramp toward Fir Street and 4th Avenue and its
 * on-ramp from the south-east follow the OSM road lines. Every deck ramps down to street level at both ends (on fill where it is low) and runs a short way onto land,
 * so none of them stops in mid-air. All carry lamp standards and per-lane streams of car lights (white
 * headlights toward the camera, red taillights away). Heights and structure are approximate.
 */

const SPECS = {
  cambie: { width: 24, depth: 2.4, endH: 1, mainH: 17, ramp: 320, lampH: 9, pier: 'pair', laneCount: 3, speeds: [13.5, 15.5, 12] },
  granville: { width: 27, depth: 2.8, endH: 1, mainH: 21, ramp: 260, lampH: 10.5, pier: 'portal', laneCount: 3, speeds: [13, 15, 12] },
  burrard: { width: 21, depth: 1.8, endH: 1, mainH: 15, ramp: 200, lampH: 8, pier: 'portal', laneCount: 2, speeds: [11, 13] },
};
const APPROACH = 50; // m of road beyond each mapped end, at street level
const GRANVILLE_SOUTH_H = 17; // m: Granville's south end stays high; its approach ramp carries it down to the street
const FILL_BELOW = 6; // m: decks lower than this sit on solid fill instead of piers

export function createBridge(spec, { isWater = () => false, envMap = null, carSpacing = [10, 34] } = {}) {
  const { id, line } = spec;
  const S = SPECS[id] ?? SPECS.cambie;
  let [[sx, sy], [nx, ny]] = line[0][1] < line[1][1] ? line : [line[1], line[0]]; // south → north
  const L0 = Math.hypot(nx - sx, ny - sy);
  const ux = (nx - sx) / L0, uy = (ny - sy) / L0;
  const southHigh = id === 'granville'; // its south end hands over to the approach ramp instead of descending
  const extS = southHigh ? 0 : APPROACH;
  sx -= ux * extS; sy -= uy * extS; nx += ux * APPROACH; ny += uy * APPROACH; // road continues onto land
  const L = L0 + extS + APPROACH;
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

  // Deck height (m above the water): at street level at each end, rising to the main level over S.ramp metres.
  const smooth = (v) => { const k = Math.min(1, Math.max(0, v)); return k * k * (3 - 2 * k); };
  const deckAt = (t) => {
    const sN = (1 - t) * L, sS = t * L;
    const hN = S.endH + (S.mainH - S.endH) * smooth((sN - APPROACH * 0.6) / S.ramp);
    const hS = southHigh
      ? GRANVILLE_SOUTH_H + (S.mainH - GRANVILLE_SOUTH_H) * smooth(sS / 140)
      : S.endH + (S.mainH - S.endH) * smooth((sS - APPROACH * 0.6) / S.ramp);
    let h = Math.min(hN, hS);
    if (id === 'cambie') h += 1.2 * Math.sin(Math.PI * Math.min(1, Math.max(0, (t - tw0) / Math.max(0.01, tw1 - tw0)))); // slight hump over the water
    return h;
  };
  const W = (t, side, h) => { const [x, y] = at(t, side); return new THREE.Vector3(x, h, -y); };

  const group = new THREE.Group();
  const concrete = new THREE.MeshStandardMaterial({ color: id === 'granville' ? 0x74777c : 0x6b6f76, roughness: 0.85, envMap, envMapIntensity: 0.4 });
  const steel = new THREE.MeshStandardMaterial({ color: id === 'burrard' ? 0x3f4a52 : 0x4b5158, roughness: 0.55, metalness: 0.5, envMap, envMapIntensity: 0.7 });
  const asphalt = new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.95, envMap, envMapIntensity: 0.15 });
  const q = new THREE.Quaternion(), e = new THREE.Euler(), v3 = new THREE.Vector3();
  const unit = new THREE.BoxGeometry(1, 1, 1);

  /** Collects boxes (centre, orientation, size) into one InstancedMesh per material. */
  const batch = (material) => {
    const items = [];
    return {
      /** Box centred at c, with local axes: x along the bridge, y up, z across; size = [along, up, across]. */
      box(c, size, tilt = 0, hd = heading) {
        q.setFromEuler(e.set(0, hd, tilt, 'YXZ'));
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
  const deckParts = batch(id === 'granville' ? steel : concrete);
  const roadParts = batch(asphalt);
  const concreteParts = batch(concrete);
  const steelParts = batch(steel);

  const lamps = []; // extra light sprites (pylon lanterns, walkway lights)

  // ---- Deck, road surface, parapets, girders, fill ---------------------------------------------------
  const N = Math.max(30, Math.ceil(L / 12));
  for (let i = 0; i < N; i++) {
    const t0 = i / N, t1 = (i + 1) / N, tm = (t0 + t1) / 2;
    const [x0, y0] = at(t0), [x1, y1] = at(t1);
    const h0 = deckAt(t0), h1 = deckAt(t1), hm = (h0 + h1) / 2;
    const run = Math.hypot(x1 - x0, y1 - y0), tilt = Math.atan2(h1 - h0, run), seg = Math.hypot(run, h1 - h0) + 0.05;
    deckParts.box(W(tm, 0, hm - S.depth / 2), [seg, S.depth, S.width], tilt);
    roadParts.box(W(tm, 0, hm + 0.04), [seg, 0.12, S.width - 2.4], tilt); // darker road surface just proud of the deck
    for (const side of [-1, 1]) {
      concreteParts.box(W(tm, side * (S.width / 2 - 0.25), hm + 0.5), [seg, 1.0, 0.5], tilt); // parapet
    }
    if (id === 'granville') {
      // Deep steel plate girders under the deck, tied together by cross diaphragms.
      for (const g of [-10.5, -4, 4, 10.5]) steelParts.box(W(tm, g, hm - S.depth - 0.7), [seg, 1.5, 0.45], tilt);
      steelParts.box(W(tm, 0, hm - S.depth - 0.35), [0.5, 0.9, S.width - 2], tilt);
      steelParts.box(W(tm, 0, hm - S.depth - 1.25), [0.35, 0.35, 22], tilt); // lower bracing strut
      // Outboard sidewalk and bike path on cantilever brackets, with railings and path lights.
      for (const side of [-1, 1]) {
        const off = side * (S.width / 2 + 1.9);
        concreteParts.box(W(tm, off, hm - 0.55), [seg, 0.5, 3.4], tilt);
        steelParts.box(W(tm, off, hm - 1.4), [0.45, 0.6, 3.6], tilt); // bracket
        steelParts.box(W(tm, side * (S.width / 2 + 3.5), hm + 0.35), [seg, 1.1, 0.12], tilt); // railing
        steelParts.box(W(tm, side * (S.width / 2 + 3.5), hm + 0.9), [seg, 0.1, 0.16], tilt); // handrail
        if (i % 2 === 0) { const p = W(tm, side * (S.width / 2 + 3.3), hm + 1.5); lamps.push({ p: [p.x, p.y, p.z], color: [3.4, 2.4, 1.3], size: 0.42 }); }
      }
    } else if (id === 'cambie' && hm > FILL_BELOW) {
      // Box-girder haunch: a deeper centre web.
      concreteParts.box(W(tm, 0, hm - S.depth - 0.8), [seg, 1.6, S.width * 0.45], tilt);
    }
    if (hm < FILL_BELOW && hm - S.depth > -0.3) {
      // Ramp on fill: retaining walls and earth under the deck down to the ground.
      concreteParts.box(W(tm, 0, (hm - S.depth) / 2 - 0.2), [seg, hm - S.depth + 0.4, S.width - 1.4], 0);
    }
  }

  // ---- Piers -----------------------------------------------------------------------------------------
  let piers = 0;
  /** Column from the ground to just under the deck, with a footing pad. */
  const column = (t, side, w, h, d = w) => {
    concreteParts.box(W(t, side, (h - S.depth) / 2 - 0.4), [d, h - S.depth + 0.8, w]);
    concreteParts.box(W(t, side, 0.3), [d + 1.4, 1.0, w + 1.4]);
    piers++;
  };
  /** Pier positions: every `step` metres from each end's fill, only where the deck is high enough. */
  const pierTs = (step) => {
    const out = [];
    for (let s = (southHigh ? 0 : APPROACH) + step * 0.5; s < L - APPROACH; s += step) if (deckAt(s / L) > FILL_BELOW) out.push(s / L);
    return out;
  };

  if (S.pier === 'pair') {
    // Cambie: paired columns under a cap beam, every ~40 m.
    for (const t of pierTs(40)) {
      const h = deckAt(t);
      for (const side of [-1, 1]) column(t, side * 5.2, 2.2, h - 0.5, 3.0);
      concreteParts.box(W(t, 0, h - S.depth - 0.6), [3.0, 1.4, S.width * 0.62]);
    }
  } else if (id === 'granville') {
    // Tall concrete portal piers every ~48 m: tapered column pairs, a mid-height strut and X bracing on the tall
    // ones, a deep cap beam with bearing pads under each girder, on wide footings.
    for (const t of pierTs(48)) {
      const h = deckAt(t), top = h - S.depth - 1.6;
      for (const side of [-1, 1]) {
        const x = side * 8.2;
        concreteParts.box(W(t, x, 0.3), [5.4, 1.2, 4.6]); // footing
        concreteParts.box(W(t, x, top * 0.2 + 0.6), [3.6, top * 0.4, 3.2]); // flared base
        concreteParts.box(W(t, x, top * 0.6 + 0.6), [2.6, top * 0.8 + 0.2, 2.2]); // shaft
        piers++;
      }
      if (h > 13) {
        concreteParts.box(W(t, 0, top * 0.55), [2.2, 1.5, 16.4]); // mid-height strut
        for (const side of [-1, 1]) {
          steelParts.bar(W(t, side * 8.2, top * 0.15), W(t, -side * 8.2, top * 0.55), 0.55); // X bracing
          steelParts.bar(W(t, side * 8.2, top * 0.55), W(t, -side * 8.2, top * 0.95), 0.55);
        }
      }
      concreteParts.box(W(t, 0, h - S.depth - 1.6), [3.4, 2.6, S.width * 0.8]); // cap beam
      for (const g of [-10.5, -4, 4, 10.5]) steelParts.box(W(t, g, h - S.depth - 0.25), [1.0, 0.4, 0.9]); // bearing pads
    }
  }

  // ---- Burrard: steel through-truss spans between pylon gateways --------------------------------------
  const trussT0 = Math.max(0.05, tw0 - 0.05), trussT1 = Math.min(0.95, tw1 + 0.05);
  const lampPos = (p) => [p.x, p.y, p.z];
  if (id === 'burrard') {
    const spans = 3, TW = S.width / 2 - 1.2; // trusses sit just inside the edges
    const pylonTs = [];
    for (let k = 0; k <= spans; k++) pylonTs.push(trussT0 + ((trussT1 - trussT0) * k) / spans);
    // Concrete approach piers outside the truss section.
    for (const t of pierTs(34)) {
      if (t > trussT0 - 0.01 && t < trussT1 + 0.01) continue;
      const h = deckAt(t);
      for (const side of [-1, 1]) column(t, side * 7, 2.2, h - 0.5);
      concreteParts.box(W(t, 0, h - S.depth - 0.9), [2.2, 1.8, S.width * 0.7]);
    }
    for (let k = 0; k < spans; k++) {
      const ta = pylonTs[k], tb = pylonTs[k + 1], spanLen = (tb - ta) * L;
      const panels = Math.max(6, Math.round(spanLen / 8));
      const peak = k === 1 ? 13 : 10, endTop = 7.5;
      const top = (s) => endTop + (peak - endTop) * Math.pow(Math.sin(Math.PI * s), 0.8); // arched top chord
      for (const side of [-1, 1]) {
        const sd = side * TW;
        let prev = null;
        for (let i = 0; i <= panels; i++) {
          const s = i / panels, t = ta + (tb - ta) * s, hd = deckAt(t) + 0.6;
          const pTop = W(t, sd, hd + top(s)), pBot = W(t, sd, hd);
          steelParts.bar(pBot, pTop, 0.8); // post
          if (prev) {
            steelParts.bar(prev.t, pTop, 1.2); // top chord
            steelParts.bar(prev.b, pBot, 0.9); // bottom chord
            // Pratt diagonals sloping toward mid-span; the centre span is cross-braced both ways.
            if (k === 1) { steelParts.bar(prev.t, pBot, 0.5); steelParts.bar(prev.b, pTop, 0.5); }
            else if (s <= 0.5) steelParts.bar(prev.t, pBot, 0.55); else steelParts.bar(pTop, prev.b, 0.55);
          }
          // Lateral bracing across the roadway overhead at every other panel.
          if (side < 0 && i > 0 && i < panels && i % 2 === 0) steelParts.bar(W(t, -TW, hd + top(s) - 0.5), W(t, TW, hd + top(s) - 0.5), 0.5);
          prev = { t: pTop, b: pBot };
        }
        // Outboard sidewalk on brackets, outside the truss.
        const mid = (ta + tb) / 2;
        concreteParts.box(W(mid, side * (TW + 2.3), deckAt(mid) - 0.1), [spanLen + 0.2, 0.6, 3.2]);
        steelParts.box(W(mid, side * (TW + 3.8), deckAt(mid) + 0.55), [spanLen + 0.2, 1.1, 0.12]); // railing
      }
    }
    // Pylon gateways at each end of the truss section, and shorter piers at the two inner joints.
    pylonTs.forEach((t, k) => {
      const h = deckAt(t), end = k === 0 || k === spans;
      for (const side of [-1, 1]) {
        const sd = side * (S.width / 2 + 1.4);
        column(t, sd, 4.6, h - 0.5, 4.6);
        if (end) {
          // Stepped Art Deco pylon: base, shaft, setbacks, cap and lantern.
          concreteParts.box(W(t, sd, h + 5), [4.6, 10, 4.6]);
          concreteParts.box(W(t, sd, h + 14), [3.8, 8, 3.8]);
          concreteParts.box(W(t, sd, h + 19.2), [3.0, 2.4, 3.0]);
          concreteParts.box(W(t, sd, h + 21), [4.0, 1.2, 4.0]); // cornice
          concreteParts.box(W(t, sd, h + 22.4), [2.2, 1.6, 2.2]); // lantern housing
          lamps.push({ p: lampPos(W(t, sd, h + 23.8)), color: [7, 5.2, 3.2], size: 2.4 });
          lamps.push({ p: lampPos(W(t, sd, h + 3)), color: [4, 3, 2], size: 1.6 }); // uplight at the base
          lamps.push({ p: lampPos(W(t, sd, h + 12)), color: [3, 2.3, 1.5], size: 1.3 });
        } else {
          concreteParts.box(W(t, sd, h + 2.5), [4.6, 5, 4.6]);
          concreteParts.box(W(t, sd, h + 5.4), [3.4, 0.8, 3.4]);
          lamps.push({ p: lampPos(W(t, sd, h + 6.4)), color: [6, 4.6, 3], size: 1.2 });
        }
      }
      if (end) {
        concreteParts.box(W(t, 0, h + 16.8), [3.2, 2.6, S.width + 5]); // gateway beam across the deck
        concreteParts.box(W(t, 0, h + 15.2), [2.4, 0.8, S.width - 1]);
      }
      concreteParts.box(W(t, 0, h - S.depth - 0.9), [4.6, 1.8, S.width + 5.2]);
    });
  }

  const poleList = []; // lamp poles collected for the ramps
  let seed0 = 77;
  const rand0 = () => ((seed0 = (seed0 * 1664525 + 1013904223) >>> 0) / 4294967296);

  // ---- Granville's south approach and ramps (OSM polylines) ------------------------------------------
  const rampCarDefs = [];
  const paths = {};
  /** Polyline helper: position and heading at distance s along it. */
  const makePath = (pts) => {
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = cum[cum.length - 1];
    const pathAt = (dist) => {
      const d = Math.min(total, Math.max(0, dist));
      let i = 1;
      while (i < cum.length - 1 && cum[i] < d) i++;
      const k = (d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1;
      return { x: x0 + dx * k, y: y0 + dy * k, ux: dx / len, uy: dy / len };
    };
    return { total, pathAt };
  };
  for (const r of spec.ramps ?? []) {
    if (r.bridge !== id || r.line.length < 2) continue;
    const path = makePath(r.line);
    const w = r.width, dpt = 1.5; // deck width and thickness
    let hOf;
    if (r.kind === 'down') {
      const h0 = deckAt(0) - 0.15;
      hOf = (d) => h0 - (h0 - S.endH) * (d / path.total);
    } else {
      // Climbs from street level to meet the approach deck beside its far end.
      const end = path.pathAt(path.total), host = paths.approach;
      let target = 12;
      if (host) {
        let best = Infinity;
        for (let d = 0; d <= host.path.total; d += 4) { const p = host.path.pathAt(d); const dd = Math.hypot(p.x - end.x, p.y - end.y); if (dd < best) { best = dd; target = host.hOf(d) - 0.3; } }
      }
      hOf = (d) => S.endH + (target - S.endH) * (d / path.total);
    }
    paths[r.id] = { path, hOf };
    const steps = Math.max(3, Math.ceil(path.total / 12));
    for (let k = 0; k < steps; k++) {
      const d0 = (k / steps) * path.total, d1 = ((k + 1) / steps) * path.total, dm_ = (d0 + d1) / 2;
      const a = path.pathAt(d0), b = path.pathAt(d1), c = path.pathAt(dm_);
      const run = Math.hypot(b.x - a.x, b.y - a.y) || 0.01, h0 = hOf(d0), h1 = hOf(d1), hm = (h0 + h1) / 2;
      const hd = Math.atan2(b.y - a.y, b.x - a.x), tilt = Math.atan2(h1 - h0, run), seg = Math.hypot(run, h1 - h0) + 0.15;
      const P = (side, y) => new THREE.Vector3(c.x + c.uy * side, y, -(c.y - c.ux * side)); // side: + = right of travel
      concreteParts.box(P(0, hm - dpt / 2), [seg, dpt, w], tilt, hd);
      roadParts.box(P(0, hm + 0.04), [seg, 0.12, w - 1.6], tilt, hd);
      for (const side of [-1, 1]) concreteParts.box(P(side * (w / 2 - 0.25), hm + 0.5), [seg, 1.0, 0.45], tilt, hd);
      if (hm < FILL_BELOW) {
        if (hm - dpt > -0.3) concreteParts.box(P(0, (hm - dpt) / 2 - 0.2), [seg, hm - dpt + 0.4, w - 1], 0, hd);
      } else if (k % 2 === 1) {
        // Single-column bent under the deck every ~24 m, with a cap beam; paired columns under the wide approach.
        const cols = w > 15 ? [-5.5, 5.5] : [0];
        for (const off of cols) {
          concreteParts.box(P(off, (hm - dpt) / 2 - 0.4), [2.0, hm - dpt + 0.8, 2.0], 0, hd);
          concreteParts.box(P(off, 0.3), [3.4, 1.0, 3.4], 0, hd);
          piers++;
        }
        concreteParts.box(P(0, hm - dpt - 0.6), [2.2, 1.2, w * 0.8], 0, hd);
      }
      if (k % 3 === 1) { // lamp standard with an arm reaching over the road, alternating sides
        const side = k % 2 ? 1 : -1, edge = side * (w / 2 - 0.4);
        poleList.push({ pos: P(edge, hm + 4.5), size: [0.3, 9, 0.3], hd });
        poleList.push({ pos: P(edge - side * 1.0, hm + 9), size: [0.28, 0.28, 2.2], hd });
        const lp = P(edge - side * 2.0, hm + 8.8);
        lamps.push({ p: [lp.x, lp.y, lp.z], color: [6, 4.2, 2.4], size: 0.75 });
      }
    }
    // Traffic: the approach carries both directions; the ramps are one-way.
    const dirs = r.id === 'approach' ? [[1, 2.2], [1, 5.6], [-1, -2.2], [-1, -5.6]] : [[1, -2.0], [1, 2.0]];
    dirs.forEach(([dir, off], li) => {
      const speed = 9 + li * 1.7 + (r.id === 'approach' ? 2 : 0);
      for (let s0 = rand0() * 25; s0 < path.total; s0 += 14 + rand0() * 26) rampCarDefs.push({ id: r.id, path, hOf, dir, off, speed, s0 });
    });
  }

  deckParts.finish(); roadParts.finish(); concreteParts.finish(); steelParts.finish();

  // ---- Lamp standards (pole, arm and light) and traffic ----------------------------------------------
  const lights = [...lamps];
  const poles = batch(steel);
  const lampStep = id === 'burrard' ? 30 : 36;
  for (let t = 14 / L; t < 1 - 8 / L; t += lampStep / L) {
    for (const side of [-1, 1]) {
      const h = deckAt(t), edge = side * (S.width / 2 - 0.5);
      poles.box(W(t, edge, h + S.lampH / 2), [0.35, S.lampH, 0.35]);
      poles.box(W(t, edge - side * 1.1, h + S.lampH), [0.3, 0.3, 2.4]); // arm reaching over the road
      const p = W(t, edge - side * 2.2, h + S.lampH - 0.2);
      lights.push({ p: [p.x, p.y, p.z], color: [6, 4.2, 2.4], size: 0.8 });
    }
  }
  for (const pl of poleList) poles.box(pl.pos, pl.size, 0, pl.hd);
  poles.finish();

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

  // Ramp traffic: headlights for cars driving toward the camera (at the origin), taillights otherwise.
  for (const c of rampCarDefs) {
    const p = c.path.pathAt(c.s0);
    const toward = (c.dir * p.ux) * -p.x + (c.dir * p.uy) * -p.y > 0;
    c.toward = toward;
    for (let k = 0; k < 2; k++) carLights.push({ p: [0, 0, 0], color: toward ? [6.5, 6.2, 5.4] : [5.5, 0.18, 0.08], size: toward ? 0.45 : 0.35 });
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
    for (const c of rampCarDefs) {
      const total = c.path.total;
      const d = (((c.s0 + c.dir * c.speed * time) % total) + total) % total;
      const p = c.path.pathAt(d), h = c.hOf(d) + 0.75;
      for (const k of [-0.8, 0.8]) {
        const lat = c.off + k; // lateral offset, + = right of the polyline direction
        positions[i++] = p.x + p.uy * lat; positions[i++] = h; positions[i++] = -(p.y - p.ux * lat);
      }
    }
  }

  return { id, group, lights, carLights, updateTraffic, lanes, cars, length: L, stats: { id, piers, cars: cars.length + rampCarDefs.length, ramps: Object.keys(paths).length, members: steelParts.count } };
}
