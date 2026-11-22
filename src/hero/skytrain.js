import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { skyGlsl, hashGlsl, fogGlsl } from './shaders.js';

/**
 * The SkyTrain Expo Line between Main Street–Science World and Stadium–Chinatown: the elevated concrete
 * guideway on columns, the two stations (lit platform canopies), the Dunsmuir tunnel portal, and trains
 * running both ways that stop at each station and slip into the tunnel.
 *
 * The centreline comes from OpenStreetMap via the data file (east edge of the view → tunnel portal).
 * Heights are approximate: the deck sits ~9 m up; the scene's ground is flat.
 */

const DECK = 9; // deck top (m)
const HALF = 4.6; // half width of the two-track guideway
const CAR = 17.4; // car length (m)
const CARS = 4;
const SPEED = 15; // cruising speed (m/s), ~55 km/h through here
const ACCEL = 1.0; // m/s²
const DWELL = 22; // seconds at each station

/** Arc-length parametrised polyline. */
function makePath(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const length = cum[cum.length - 1];
  const at = (s) => {
    s = Math.min(length, Math.max(0, s));
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const seg = cum[i] - cum[i - 1] || 1, t = (s - cum[i - 1]) / seg;
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t, dx: (bx - ax) / seg, dy: (by - ay) / seg };
  };
  const nearest = ([px, py]) => {
    let best = 0, bd = Infinity;
    for (let s = 0; s <= length; s += 2) {
      const p = at(s), d = Math.hypot(p.x - px, p.y - py);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  };
  return { at, length, nearest };
}

/** Sweeps a closed cross-section (pairs [across, up]) along the path from s0 to s1 → geometry with aAcross. */
function sweep(path, section, s0, s1, step = 6) {
  const pos = [], nrm = [], across = [];
  const frames = [];
  for (let s = s0; ; s += step) {
    const c = Math.min(s, s1);
    const p = path.at(c);
    frames.push(p);
    if (c >= s1) break;
  }
  const point = (f, [a, h]) => [f.x + f.dy * a, h, -(f.y - f.dx * a)]; // right of travel = (dy, -dx)
  for (let k = 0; k < frames.length - 1; k++) {
    const f0 = frames[k], f1 = frames[k + 1];
    for (let i = 0; i < section.length; i++) {
      const a = section[i], b = section[(i + 1) % section.length];
      const p = [point(f0, a), point(f1, a), point(f1, b), point(f0, b)];
      const u = p[1].map((v, j) => v - p[0][j]), w = p[3].map((v, j) => v - p[0][j]);
      let n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
      const l = Math.hypot(...n) || 1;
      n = n.map((v) => v / l);
      for (const [q, ac] of [[p[0], a[0]], [p[1], a[0]], [p[2], b[0]], [p[0], a[0]], [p[2], b[0]], [p[3], b[0]]]) {
        pos.push(...q); nrm.push(...n); across.push(ac);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aAcross', new THREE.Float32BufferAttribute(across, 1));
  return g;
}

function concreteMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    uniforms,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute float aAcross; attribute float aKind;
      varying vec3 vWorld; varying vec3 vNormal; varying float vAcross; varying float vKind;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz; vNormal = normalize(mat3(modelMatrix) * normal); vAcross = aAcross; vKind = aKind;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      ${skyGlsl}
      ${hashGlsl}
      ${fogGlsl}
      varying vec3 vWorld; varying vec3 vNormal; varying float vAcross; varying float vKind;
      void main() {
        vec3 n = normalize(vNormal);
        if (!gl_FrontFacing) n = -n;
        vec3 V = normalize(cameraPosition - vWorld);
        if (dot(n, V) < 0.0) n = -n;
        // Kind 0 concrete, 1 station roof (glass and steel lit from beneath), 2 portal.
        float stain = 0.85 + 0.3 * hash12(floor(vWorld.xz / 6.0));
        vec3 conc = vec3(0.1, 0.1, 0.105) * stain;
        vec3 col = conc * (0.35 + 0.65 * max(n.y, 0.0)) * vec3(0.6, 0.66, 0.85);
        col += conc * vec3(1.0, 0.62, 0.3) * 0.5 * exp(-vWorld.y / 7.0); // street light from below
        if (n.y < -0.5) col = conc * 0.12; // underside
        // Deck top: two tracks, each with running rails and the linear-motor reaction rail between them.
        if (vKind < 0.5 && n.y > 0.9) {
          float a = abs(vAcross);
          float aa = fwidth(vAcross) + 0.02;
          float rails = 0.0;
          for (int i = 0; i < 3; i++) {
            float r = float(i) * 0.75 + 1.5; // 1.5, 2.25 (reaction rail), 3.0
            rails = max(rails, 1.0 - smoothstep(0.05, 0.05 + aa, abs(a - r)));
          }
          vec3 R = reflect(-V, n);
          col = mix(col * 0.7, vec3(0.06, 0.065, 0.075) + skyColor(R) * 0.35, rails * 0.8);
        }
        if (vKind > 0.5 && vKind < 1.5) {
          // Station canopy: glass panes between steel ribs, glowing with the platform lights.
          float rib = step(0.85, fract(vWorld.x / 3.0 + vWorld.z / 3.0));
          vec3 glow = vec3(1.0, 0.86, 0.66) * (0.16 + 0.14 * (1.0 - max(n.y, 0.0)));
          col = mix(glow + skyColor(reflect(-V, n)) * 0.15, vec3(0.03, 0.032, 0.036), rib);
        }
        gl_FragColor = vec4(applyFog(col, vWorld), 1.0);
      }
    `,
  });
}

function setKind(g, kind) {
  g.setAttribute('aKind', new THREE.Float32BufferAttribute(new Array(g.attributes.position.count).fill(kind), 1));
  if (!g.attributes.aAcross) g.setAttribute('aAcross', new THREE.Float32BufferAttribute(new Array(g.attributes.position.count).fill(0), 1));
  if (g.index) return g.toNonIndexed();
  return g;
}

/** Train cars: white bodies with a blue stripe, lit windows, clipped at the tunnel portal. */
function trainMaterial(uniforms, portal) {
  return new THREE.ShaderMaterial({
    uniforms: { ...uniforms, uPortal: { value: portal } },
    vertexShader: /* glsl */ `
      varying vec3 vWorld; varying vec3 vNormal; varying vec3 vLocal;
      void main() {
        vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vWorld = w.xyz; vLocal = position;
        vNormal = normalize(mat3(modelMatrix * instanceMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      ${skyGlsl}
      ${fogGlsl}
      uniform vec4 uPortal; // xz point and xz direction into the tunnel
      varying vec3 vWorld; varying vec3 vNormal; varying vec3 vLocal;
      void main() {
        if (dot(vWorld.xz - uPortal.xy, uPortal.zw) > 0.0) discard; // inside the tunnel
        vec3 n = normalize(vNormal);
        vec3 V = normalize(cameraPosition - vWorld);
        float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
        vec3 R = reflect(-V, n); R.y = abs(R.y) * 0.9 + 0.02;
        vec3 body = vec3(0.32, 0.33, 0.34);
        vec3 col = body * (0.3 + 0.7 * max(n.y, 0.0)) * vec3(0.6, 0.66, 0.85) + skyColor(R) * mix(0.1, 0.6, fres);
        float side = step(0.5, abs(n.z));
        float y = vLocal.y;
        // Blue stripe under the windows; window band lit from inside, with pillars between the panes
        // and dark doors.
        float stripe = side * step(0.85, y) * step(y, 1.15);
        col = mix(col, vec3(0.01, 0.03, 0.09), stripe);
        float win = step(1.35, y) * step(y, 2.35);
        float pane = step(0.12, fract(vLocal.x / 1.45));
        float door = step(abs(fract(vLocal.x / 8.7) - 0.5), 0.07);
        vec3 inside = vec3(0.85, 0.92, 1.0) * 1.5;
        col = mix(col, mix(inside * pane, vec3(0.02), door), win * side);
        // Ends: the cab window glows faintly.
        col = mix(col, inside * 0.35, (1.0 - side) * step(0.5, abs(n.x)) * win);
        gl_FragColor = vec4(applyFog(col, vWorld), 1.0);
      }
    `,
  });
}

/** Position on a leg of length len that starts at speed v0 and ends at v1 (0 or SPEED), at time t. */
function leg(len, v0, v1) {
  const dA = (SPEED * SPEED - v0 * v0) / (2 * ACCEL), dD = (SPEED * SPEED - v1 * v1) / (2 * ACCEL);
  const dC = Math.max(0, len - dA - dD);
  const tA = (SPEED - v0) / ACCEL, tC = dC / SPEED, tD = (SPEED - v1) / ACCEL;
  return {
    time: tA + tC + tD,
    at(t) {
      if (t < tA) return v0 * t + 0.5 * ACCEL * t * t;
      if (t < tA + tC) return dA + SPEED * (t - tA);
      const u = Math.min(t - tA - tC, tD);
      return dA + dC + SPEED * u - 0.5 * ACCEL * u * u;
    },
  };
}

export function createSkytrain(skytrain, uniforms) {
  const path = makePath(skytrain.line);
  const L = path.length;
  const group = new THREE.Group();
  const lights = [];
  const stationS = {};
  for (const st of skytrain.stations) stationS[st.id] = path.nearest(st.p);

  // Guideway: deck with low parapets, swept along the line.
  const w = HALF;
  const deck = [[-w, DECK - 1.8], [w, DECK - 1.8], [w, DECK + 0.9], [w - 0.3, DECK + 0.9], [w - 0.3, DECK], [-w + 0.3, DECK], [-w + 0.3, DECK + 0.9], [-w, DECK + 0.9]];
  const parts = [setKind(sweep(path, deck, 0, L), 0)];
  // Columns every ~30 m.
  for (let s = 12; s < L - 5; s += 30) {
    const p = path.at(s);
    const c = new THREE.CylinderGeometry(1.0, 1.15, DECK - 1.8, 10);
    c.translate(p.x, (DECK - 1.8) / 2, -p.y);
    parts.push(setKind(c, 0));
  }
  // Stations: a wider platform slab and an arched glass canopy over ~80 m, lit along both platforms.
  for (const [id, s] of Object.entries(stationS)) {
    const len = id === 'stadium' ? 70 : 84;
    const s0 = Math.max(0, s - len / 2), s1 = Math.min(L - 2, s + len / 2);
    const pw = 8.5;
    parts.push(setKind(sweep(path, [[-pw, DECK - 1.2], [pw, DECK - 1.2], [pw, DECK + 0.2], [-pw, DECK + 0.2]], s0, s1, 4), 0));
    const arch = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8, a = -pw + 2 * pw * t;
      arch.push([a, DECK + 4.2 + 2.2 * Math.sin(Math.PI * t)]);
    }
    for (let i = 8; i >= 0; i--) arch.push([arch[i][0], arch[i][1] - 0.35]);
    parts.push(setKind(sweep(path, arch, s0, s1, 4), 1));
    for (let q = s0 + 4; q < s1; q += 8) {
      const p = path.at(q);
      for (const side of [-1, 1]) {
        const a = side * (pw - 1.2);
        lights.push({ p: [p.x + p.dy * a, DECK + 3.6, -(p.y - p.dx * a)], color: [3.4, 3.2, 2.8], size: 0.5 });
      }
    }
  }
  // Tunnel portal at the west end: a concrete headwall the trains disappear into.
  const end = path.at(L);
  const hw = 7, hl = 12, hh = DECK + 9;
  const corners = [];
  for (const [a, b] of [[-hw, 0], [hw, 0], [hw, 2 * hl], [-hw, 2 * hl]]) corners.push([end.x + end.dy * a + end.dx * b, end.y - end.dx * a + end.dy * b]);
  const pg = new THREE.BufferGeometry();
  const pp = [], pn = [];
  const quad = (a, b, c, d) => {
    const u = b.map((v, j) => v - a[j]), w2 = d.map((v, j) => v - a[j]);
    let n = [u[1] * w2[2] - u[2] * w2[1], u[2] * w2[0] - u[0] * w2[2], u[0] * w2[1] - u[1] * w2[0]];
    const l = Math.hypot(...n) || 1;
    n = n.map((v) => v / l);
    for (const q of [a, b, c, a, c, d]) { pp.push(...q); pn.push(...n); }
  };
  const P = (i, h) => [corners[i][0], h, -corners[i][1]];
  for (let i = 0; i < 4; i++) quad(P(i, 0), P((i + 1) % 4, 0), P((i + 1) % 4, hh), P(i, hh));
  quad(P(0, hh), P(1, hh), P(2, hh), P(3, hh));
  pg.setAttribute('position', new THREE.Float32BufferAttribute(pp, 3));
  pg.setAttribute('normal', new THREE.Float32BufferAttribute(pn, 3));
  parts.push(setKind(pg, 2));

  const structure = new THREE.Mesh(mergeGeometries(parts.map((g) => {
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'aAcross', 'aKind'].includes(k)) g.deleteAttribute(k);
    return g;
  })), concreteMaterial(uniforms));
  group.add(structure);

  // Trains.
  const carGeo = new THREE.BoxGeometry(CAR - 0.8, 3.1, 2.65);
  carGeo.translate(0, 1.55, 0);
  const portalVec = new THREE.Vector4(end.x, -end.y, end.dx, -end.dy);
  const cars = new THREE.InstancedMesh(carGeo, trainMaterial(uniforms, portalVec), 4 * CARS);
  cars.frustumCulled = false;
  group.add(cars);

  // Timetable for one westbound run (east edge → Main St → Stadium → into the tunnel); eastbound is the
  // mirror image. Distances are for the head of the train.
  const sMain = (stationS.mainStreet ?? L * 0.4) + (CAR * CARS) / 2;
  const sStad = Math.min(L - 6, (stationS.stadium ?? L - 30) + (CAR * CARS) / 2);
  const start = -40, beyond = L + CAR * CARS + 20;
  const westLegs = [[sMain - start, SPEED, 0], [sStad - sMain, 0, 0], [beyond - sStad, 0, SPEED]].map(([d, a, b]) => leg(d, a, b));
  const runTime = westLegs.reduce((t, l) => t + l.time, 0) + 2 * DWELL;
  const period = runTime + 50; // then out of sight for a bit (the next train is half a period behind)
  const westHead = (t) => {
    let s = start;
    for (let i = 0; i < westLegs.length; i++) {
      const l = westLegs[i];
      if (t < l.time) return s + l.at(t);
      t -= l.time;
      s += l.at(l.time);
      if (i < 2) { if (t < DWELL) return s; t -= DWELL; }
    }
    return null; // finished: hidden
  };
  // Eastbound: out of the tunnel, Stadium, Main St, off the east edge.
  const eStad = (stationS.stadium ?? L - 30) - (CAR * CARS) / 2;
  const eMain = (stationS.mainStreet ?? L * 0.4) - (CAR * CARS) / 2;
  const eStart = L + 30, eEnd = -CAR * CARS - 40;
  const eastLegs = [[eStart - eStad, SPEED, 0], [eStad - eMain, 0, 0], [eMain - eEnd, 0, SPEED]].map(([d, a, b]) => leg(d, a, b));
  const eastHead = (t) => {
    let s = eStart;
    for (let i = 0; i < eastLegs.length; i++) {
      const l = eastLegs[i];
      if (t < l.time) return s - l.at(t);
      t -= l.time;
      s -= l.at(l.time);
      if (i < 2) { if (t < DWELL) return s; t -= DWELL; }
    }
    return null;
  };
  const trains = [
    { head: westHead, dir: 1, offset: 2.25, phase: 0 },
    { head: westHead, dir: 1, offset: 2.25, phase: period / 2 },
    { head: eastHead, dir: -1, offset: -2.25, phase: period * 0.27 },
    { head: eastHead, dir: -1, offset: -2.25, phase: period * 0.77 },
  ];
  const trainLights = [];
  for (const t of trains) {
    trainLights.push({ p: [0, -100, 0], color: [5.5, 5.4, 5.0], size: 0.5 }, { p: [0, -100, 0], color: [5.5, 5.4, 5.0], size: 0.5 });
    trainLights.push({ p: [0, -100, 0], color: [4.8, 0.2, 0.1], size: 0.4 }, { p: [0, -100, 0], color: [4.8, 0.2, 0.1], size: 0.4 });
  }

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), zero = new THREE.Vector3(0, 0, 0), up = new THREE.Vector3(0, 1, 0);
  const visible = (s) => s > -10 && s < L + CAR; // the shader clips at the portal
  /** Moves the trains; writes head/tail light positions (xyz per light). */
  function update(positions, time) {
    let li = 0, ci = 0;
    for (const tr of trains) {
      const head = tr.head((((time + tr.phase) % period) + period) % period);
      for (let k = 0; k < CARS; k++) {
        const sc = head === null ? null : head - tr.dir * (k + 0.5) * CAR;
        if (sc === null || !visible(sc)) { m.compose(v.set(0, -50, 0), q, zero); cars.setMatrixAt(ci++, m); continue; }
        const p = path.at(sc);
        const x = p.x + p.dy * tr.offset, y = p.y - p.dx * tr.offset;
        q.setFromAxisAngle(up, Math.atan2(p.dy, p.dx));
        m.compose(v.set(x, DECK + 0.25, -y), q, one);
        cars.setMatrixAt(ci++, m);
      }
      // Headlights at the front of the first car, tail lights at the back of the last.
      const ends = head === null ? null : [head, head - tr.dir * CARS * CAR];
      for (let e = 0; e < 2; e++) {
        const s = ends?.[e];
        const show = s !== undefined && s !== null && visible(s) && s < L - 1;
        const p = show ? path.at(s) : null;
        for (const side of [-0.85, 0.85]) {
          if (!p) { positions[li * 3 + 1] = -100; li++; continue; }
          const a = tr.offset + side;
          positions[li * 3] = p.x + p.dy * a; positions[li * 3 + 1] = DECK + 1.0; positions[li * 3 + 2] = -(p.y - p.dx * a);
          li++;
        }
      }
    }
    cars.instanceMatrix.needsUpdate = true;
  }

  return { group, lights, trainLights, update, stats: { length: Math.round(L), stations: Object.keys(stationS) } };
}
