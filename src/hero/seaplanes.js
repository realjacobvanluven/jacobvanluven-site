import * as THREE from 'three';

/**
 * Harbour Air-style floatplanes (a small DHC-2 Beaver / Twin Otter shape on pontoons) arriving at and
 * leaving Coal Harbour. From the Olympic Village camera the harbour itself sits behind the downtown
 * towers, so each flight shows the plane against the sky and mountains, then drops out of sight behind
 * the skyline as it lands (departures climb out from behind it). One plane at a time, on a slow random
 * timer. Scenery only: no hotspot.
 *
 * Paths are in map metres from the camera (x east, y north) plus altitude. Approximate, hand-placed:
 * arrivals come in over Burrard Inlet from the east (landing west, into the usual wind); departures
 * climb out to the north-west over the First Narrows.
 */

// [x, y, altitude] waypoints; each flight jitters them a little so no two look identical.
const ARRIVAL = [[1500, 3600, 330], [300, 3050, 235], [-500, 2600, 135], [-900, 2280, 45], [-1050, 2150, 2]];
const DEPARTURE = [[-1000, 2130, 2], [-1350, 2340, 50], [-2000, 2800, 165], [-2900, 3450, 300], [-3800, 4100, 380]];

const SPEED = 52; // m/s (~100 kt: floatplane approach/climb-out)
const FIRST_AFTER = 8; // seconds before the first plane
const GAP = [22, 48]; // seconds between one plane leaving the scene and the next appearing

const white = () => new THREE.MeshStandardMaterial({ color: 0xdfe5ee, roughness: 0.45 });
const blue = () => new THREE.MeshStandardMaterial({ color: 0x1f4f9a, roughness: 0.5 });
const dark = () => new THREE.MeshStandardMaterial({ color: 0x20242b, roughness: 0.8 });

/** One floatplane, nose along +x, left wing toward −z, ~10 m long. */
function buildPlane() {
  const g = new THREE.Group();
  const white_ = white(), blue_ = blue(), dark_ = dark();
  const add = (geom, mat, x, y, z, rot) => {
    const m = new THREE.Mesh(geom, mat);
    m.position.set(x, y, z);
    if (rot) m.rotation.set(...rot);
    g.add(m);
    return m;
  };
  add(new THREE.CapsuleGeometry(0.9, 6.2, 4, 10), white_, 0, 0.2, 0, [0, 0, Math.PI / 2]); // fuselage
  for (const s of [-1, 1]) add(new THREE.BoxGeometry(6.4, 0.34, 0.06), blue_, 0.2, 0.15, s * 0.9); // cheat line
  add(new THREE.BoxGeometry(2.3, 0.22, 14.6), white_, 0.5, 1.15, 0); // high wing
  add(new THREE.BoxGeometry(1.5, 2.1, 0.16), blue_, -4.6, 1.5, 0); // fin
  add(new THREE.BoxGeometry(1.3, 0.12, 5.2), white_, -4.5, 0.7, 0); // tailplane
  add(new THREE.ConeGeometry(0.55, 1.1, 10), dark_, 3.9, 0.3, 0, [0, 0, -Math.PI / 2]); // nose
  for (const s of [-1, 1]) {
    add(new THREE.CapsuleGeometry(0.4, 6.4, 3, 8), white_, 0.4, -1.55, s * 2.1, [0, 0, Math.PI / 2]); // pontoon
    add(new THREE.BoxGeometry(6.2, 0.1, 0.1), blue_, 0.4, -1.45, s * 2.1);
    for (const x of [1.8, -1.2]) add(new THREE.BoxGeometry(0.14, 1.9, 0.14), dark_, x, -0.5, s * 1.55); // struts
  }
  return g;
}

/** Light offsets in the plane's own frame (metres, before scaling). */
const NAV = {
  port: { p: [0.6, 1.2, -7.35], color: [7, 0.25, 0.15], size: 0.5 },
  starboard: { p: [0.6, 1.2, 7.35], color: [0.2, 5.5, 1.6], size: 0.5 },
  tail: { p: [-5.6, 1.5, 0], color: [5, 5, 4.6], size: 0.4 },
  strobe: { p: [-4.6, 2.7, 0], color: [10, 10, 9.5], size: 0.7, blink: 0.15 },
  landing: { p: [4.4, 0.2, 0], color: [8, 7.6, 6.4], size: 0.9 },
};

/**
 * @param {{ scale?: number }} opts scale: model size multiplier (a little oversized so it reads at 2+ km)
 * @returns {{ group, lights, update(positions: Float32Array, time), preview(kind, u) }}
 *   `lights` goes to createLightPoints; `update` rewrites its position array each frame.
 */
export function createSeaplanes({ scale = 1.6 } = {}) {
  const group = new THREE.Group();
  const plane = buildPlane();
  plane.scale.setScalar(scale);
  plane.visible = false;
  group.add(plane);

  const names = Object.keys(NAV);
  const lights = names.map((k) => ({ p: [0, -5000, 0], color: NAV[k].color, size: NAV[k].size * scale, blink: NAV[k].blink }));
  const v = new THREE.Vector3();

  const rand = (a, b) => a + Math.random() * (b - a);
  const makeCurve = (points) => {
    const j = (p) => new THREE.Vector3(p[0] + rand(-120, 120), p[2] > 10 ? p[2] * rand(0.88, 1.15) : p[2], -(p[1] + rand(-120, 120)));
    return new THREE.CatmullRomCurve3(points.map(j), false, 'centripetal');
  };

  let flight = null; // { kind, curve, length, t0 }
  let nextAt = FIRST_AFTER;
  let lastKind = 'departure';

  function start(kind, time) {
    const curve = makeCurve(kind === 'arrival' ? ARRIVAL : DEPARTURE);
    flight = { kind, curve, length: curve.getLength(), t0: time };
  }

  const tan = new THREE.Vector3(), tan2 = new THREE.Vector3();
  /** Pose the plane at progress u (0–1) along the flight's path. */
  function pose(u) {
    const { curve } = flight;
    const k = (x) => Math.min(1, Math.max(0, x));
    curve.getPointAt(k(u), v);
    plane.position.copy(v);
    curve.getTangentAt(k(u), tan);
    curve.getTangentAt(k(u + 0.03), tan2);
    const heading = Math.atan2(-tan.z, tan.x); // map-space heading (z = −y)
    const heading2 = Math.atan2(-tan2.z, tan2.x);
    const turn = ((heading2 - heading + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
    const pitch = Math.asin(THREE.MathUtils.clamp(tan.y, -1, 1));
    // Left turn (heading increasing) rolls the left wing (−z) down: negative roll about +x.
    plane.rotation.set(-THREE.MathUtils.clamp(turn * 5, -0.45, 0.45), heading, pitch, 'YZX');
    plane.updateMatrixWorld(true);
  }

  function writeLights(arr, show, landingOn) {
    names.forEach((name, i) => {
      if (!show || (name === 'landing' && !landingOn)) { arr[i * 3 + 1] = -5000; return; }
      v.set(...NAV[name].p).multiplyScalar(scale).applyMatrix4(plane.matrixWorld);
      arr[i * 3] = v.x; arr[i * 3 + 1] = v.y; arr[i * 3 + 2] = v.z;
    });
  }

  function update(arr, time) {
    if (!flight && time >= nextAt) {
      lastKind = lastKind === 'arrival' ? 'departure' : 'arrival';
      start(lastKind, time);
    }
    if (!flight) { plane.visible = false; writeLights(arr, false); return; }
    const dur = flight.length / SPEED;
    const raw = (time - flight.t0) / dur;
    if (raw >= 1) {
      flight = null;
      plane.visible = false;
      nextAt = time + rand(GAP[0], GAP[1]);
      writeLights(arr, false);
      return;
    }
    // Arrivals slow down as they flare; departures accelerate off the water.
    const u = flight.kind === 'arrival' ? 1 - (1 - raw) ** 1.25 : raw ** 1.25;
    plane.visible = true;
    pose(u);
    writeLights(arr, true, flight.kind === 'arrival');
  }

  /** For stills: put a plane at progress u of an arrival/departure without running the timer. */
  function preview(kind, u, arr) {
    start(kind, 0);
    plane.visible = true;
    pose(u);
    if (arr) writeLights(arr, true, kind === 'arrival');
  }

  return { group, lights, update, preview, stats: { flights: 'one at a time, every ~45–90 s' } };
}
