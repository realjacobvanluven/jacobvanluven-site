import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { skyGlsl, hashGlsl, fogGlsl } from './shaders.js';
import { createLightPoints } from './lights.js';

/**
 * Marinas and boats on False Creek: dock floats (from OSM), moored boats placed along them by the data
 * script, and Aquabus ferries (small rainbow-striped passenger boats). Moored boats are instanced;
 * the Aquabus positions are returned so they can be animated later.
 */

/**
 * Moored boats are built from four nominal 10 m models (runabout, cabin cruiser, flybridge yacht,
 * sailboat), each scaled uniformly to the boat's length. Every vertex carries a part id
 * (0 hull, 1 deck, 2 cabin, 3 canvas, 4 mast/boom) and its model-space position, so one shader can paint
 * white gelcoat, waterline stripes, cabin windows (some lit) and canvas, and bob the boat on the water.
 */

const NOMINAL = 10;

/** Lofted hull: pointed bow, flat transom, sheer line rising toward the bow, V bottom. */
function hullParts({ beam = 3.3, deckStern = 1.0, deckBow = 1.45 } = {}) {
  const N = 9, half = beam / 2;
  const stations = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N; // 0 stern … 1 bow
    const w = t < 0.55 ? half * (0.86 + 0.14 * Math.sin((t / 0.55) * Math.PI / 2)) : half * Math.cos(((t - 0.55) / 0.45) * Math.PI / 2) ** 0.75;
    const x = -NOMINAL / 2 + t * NOMINAL;
    const sheer = deckStern + (deckBow - deckStern) * t * t;
    // Section from port deck edge round the keel to starboard deck edge.
    const sec = [[-w, sheer], [-w * 0.97, 0.35], [-w * 0.75, -0.08], [0, -0.48], [w * 0.75, -0.08], [w * 0.97, 0.35], [w, sheer]];
    stations.push({ x, w, sheer, sec });
  }
  // Hull skin (indexed, smooth normals).
  const pos = [], idx = [];
  const M = stations[0].sec.length;
  for (const st of stations) for (const [z, y] of st.sec) pos.push(st.x, y, z);
  for (let i = 0; i < N; i++) for (let k = 0; k < M - 1; k++) {
    const a = i * M + k, b = (i + 1) * M + k;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const skin = new THREE.BufferGeometry();
  skin.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  skin.setIndex(idx);
  skin.computeVertexNormals();
  // Deck: strips across each station pair at sheer height.
  const dpos = [];
  for (let i = 0; i < N; i++) {
    const a = stations[i], b = stations[i + 1];
    const q = [[a.x, a.sheer, -a.w], [b.x, b.sheer, -b.w], [b.x, b.sheer, b.w], [a.x, a.sheer, a.w]];
    for (const k of [0, 2, 1, 0, 3, 2]) dpos.push(...q[k]);
  }
  const deck = new THREE.BufferGeometry();
  deck.setAttribute('position', new THREE.Float32BufferAttribute(dpos, 3));
  deck.computeVertexNormals();
  // Transom: the flat stern.
  const st = stations[0], tpos = [];
  for (let k = 0; k < M - 1; k++) {
    const [z0, y0] = st.sec[k], [z1, y1] = st.sec[k + 1];
    tpos.push(st.x, y0, z0, st.x, y1, z1, st.x, st.sheer, 0);
  }
  const transom = new THREE.BufferGeometry();
  transom.setAttribute('position', new THREE.Float32BufferAttribute(tpos, 3));
  transom.computeVertexNormals();
  return { skin: skin.toNonIndexed(), deck, transom, stations };
}

const deckAt = (stations, x) => {
  const t = Math.min(1, Math.max(0, (x + NOMINAL / 2) / NOMINAL));
  const st = stations[Math.round(t * (stations.length - 1))];
  return st.sheer;
};

/** Box from x0..x1, y0..y1, ±halfZ, with the top front edge pulled back (a raked windscreen). */
function cabinBox(x0, x1, y0, y1, halfZ, rake = 0) {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, halfZ * 2).toNonIndexed();
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > y1 - 1e-3 && p.getX(i) > x1 - 1e-3) p.setX(i, x1 - rake);
  g.computeVertexNormals();
  return g;
}

/** Marks a piece with its part id and (cabins) the height band of its windows. */
function tag(g, part, win = [0, 0]) {
  if (g.attributes.uv) g.deleteAttribute('uv');
  const n = g.attributes.position.count;
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(new Array(n).fill(part), 1));
  g.setAttribute('aWin', new THREE.Float32BufferAttribute(Array.from({ length: n }, () => win).flat(), 2));
  return g;
}

function boatModel(type) {
  const parts = [];
  if (type === 'sail') {
    const h = hullParts({ beam: 3.2, deckStern: 0.85, deckBow: 1.2 });
    parts.push(tag(h.skin, 0), tag(h.transom, 0), tag(h.deck, 1));
    const d = deckAt(h.stations, 0);
    parts.push(tag(cabinBox(-1.8, 1.6, d - 0.05, d + 0.62, 0.95, 0.5), 2, [d + 0.2, d + 0.48]));
    parts.push(tag(cabinBox(0.9, 1.08, d, d + 13.2, 0.07), 4)); // mast
    parts.push(tag(cabinBox(-3.4, 1.0, d + 1.55, d + 1.68, 0.06), 4)); // boom
    parts.push(tag(cabinBox(-3.0, 0.9, d + 1.68, d + 2.0, 0.18), 3)); // furled mainsail cover
  } else if (type === 'runabout') {
    const h = hullParts({ beam: 3.0, deckStern: 0.75, deckBow: 1.05 });
    parts.push(tag(h.skin, 0), tag(h.transom, 0), tag(h.deck, 1));
    const d = deckAt(h.stations, 0);
    parts.push(tag(cabinBox(-0.6, 0.6, d, d + 0.9, 0.55, 0.3), 2, [d + 0.6, d + 0.9])); // console with windscreen
    parts.push(tag(cabinBox(-2.6, 0.4, d + 1.75, d + 1.85, 1.2), 3)); // bimini top
  } else {
    const fly = type === 'flybridge';
    const h = hullParts({ beam: 3.5, deckStern: 1.05, deckBow: 1.55 });
    parts.push(tag(h.skin, 0), tag(h.transom, 0), tag(h.deck, 1));
    const d = deckAt(h.stations, 0);
    parts.push(tag(cabinBox(-2.4, 2.2, d - 0.05, d + 1.55, 1.4, 0.9), 2, [d + 0.55, d + 1.35]));
    if (fly) {
      parts.push(tag(cabinBox(-2.2, 0.6, d + 1.55, d + 2.25, 1.15, 0.4), 2, [d + 1.8, d + 2.25])); // flybridge
      parts.push(tag(cabinBox(-2.6, 0.2, d + 3.15, d + 3.25, 1.35), 3)); // bimini over the flybridge
    }
  }
  return mergeGeometries(parts);
}

function boatMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      uniform float uTime;
      attribute float aPart; attribute vec2 aWin; attribute vec3 aHull; attribute vec3 aStripe; attribute float aLit; attribute float aPhase;
      varying vec3 vWorld; varying vec3 vNormal; varying vec3 vLocal; varying float vPart; varying vec2 vWin;
      varying vec3 vHull; varying vec3 vStripe; varying float vLit; varying float vPhase;
      void main() {
        vWin = aWin;
        // Moored boats bob and roll a little on the ripples.
        float roll = sin(uTime * 0.9 + aPhase * 6.28) * 0.022;
        float pitch = sin(uTime * 0.7 + aPhase * 11.0) * 0.008;
        vec3 p = position;
        p.yz = mat2(cos(roll), sin(roll), -sin(roll), cos(roll)) * p.yz;
        p.xy = mat2(cos(pitch), sin(pitch), -sin(pitch), cos(pitch)) * p.xy;
        p.y += sin(uTime * 1.2 + aPhase * 17.0) * 0.05;
        vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.0);
        vWorld = w.xyz; vLocal = position; vPart = aPart;
        vNormal = normalize(mat3(modelMatrix * instanceMatrix) * normal);
        vHull = aHull; vStripe = aStripe; vLit = aLit; vPhase = aPhase;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      ${skyGlsl}
      ${hashGlsl}
      ${fogGlsl}
      uniform float uWindowIntensity;
      varying vec3 vWorld; varying vec3 vNormal; varying vec3 vLocal; varying float vPart; varying vec2 vWin;
      varying vec3 vHull; varying vec3 vStripe; varying float vLit; varying float vPhase;
      void main() {
        vec3 n = normalize(vNormal);
        vec3 V = normalize(cameraPosition - vWorld);
        if (dot(n, V) < 0.0) n = -n;
        float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
        vec3 R = reflect(-V, n); R.y = abs(R.y) * 0.9 + 0.02;
        vec3 sky = skyColor(R);
        float y = vLocal.y;
        vec3 albedo = vec3(0.8);
        float gloss = 0.5;
        vec3 emit = vec3(0.0);
        if (vPart < 0.5) {
          // Hull: gelcoat colour, a coloured stripe along the waterline, dark antifouling below it.
          albedo = vHull;
          float stripe = step(0.18, y) * step(y, 0.36);
          albedo = mix(albedo, vStripe, stripe);
          albedo = mix(albedo, vec3(0.04, 0.03, 0.03), step(y, 0.06));
          gloss = 0.9;
        } else if (vPart < 1.5) {
          // Deck: non-skid white, or teak on some boats.
          albedo = mix(vec3(0.62, 0.62, 0.6), vec3(0.28, 0.17, 0.09), step(0.7, fract(vPhase * 7.0)));
          gloss = 0.15;
        } else if (vPart < 2.5) {
          // Cabin: white, with a band of dark glass (lit warm on some boats).
          albedo = vec3(0.78, 0.79, 0.8);
          // Windows: a band of dark glass round the cabin sides and windscreen, split into panes.
          float side = 1.0 - step(0.6, abs(vNormal.y));
          float pane = step(0.1, fract(vLocal.x / 1.3 + 0.05));
          float win = side * step(vWin.x, y) * step(y, vWin.y) * mix(pane, 1.0, step(0.5, abs(vNormal.x)));
          vec3 glass = vec3(0.004, 0.006, 0.01) + sky * mix(0.25, 0.9, fres);
          vec3 cabinLight = vec3(1.0, 0.62, 0.3) * 0.9 * uWindowIntensity * vLit;
          vec3 wcol = glass * (1.0 - vLit * 0.7) + cabinLight;
          albedo = mix(albedo, vec3(0.0), win);
          emit = wcol * win;
          gloss = 0.6;
        } else if (vPart < 3.5) {
          albedo = mix(vec3(0.05, 0.07, 0.14), vec3(0.45, 0.43, 0.4), step(0.6, fract(vPhase * 3.0))); // navy or tan canvas
          gloss = 0.05;
        } else {
          albedo = vec3(0.5, 0.52, 0.55); // aluminium mast and boom
          gloss = 0.7;
        }
        // Blue-hour sky light from above, warm marina and street light from the sides.
        vec3 light = vec3(0.6, 0.66, 0.85) * (0.07 + 0.08 * max(n.y, 0.0)) + vec3(1.0, 0.66, 0.35) * 0.045 * (1.0 - abs(n.y));
        vec3 col = albedo * light + sky * fres * gloss * 0.6 + emit;
        gl_FragColor = vec4(applyFog(col, vWorld), 1.0);
      }
    `,
  });
}

export function createBoats(boats, docks, { camera = [0, 0], minDistance = 0, maxDistance = 2400, uniforms } = {}) {
  const near = (x, y) => { const d = Math.hypot(x - camera[0], y - camera[1]); return d < maxDistance && d > minDistance; };
  // Drop boats that would overlap one already placed (oriented-rectangle test, binned on a 20 m grid).
  const corners = (b) => {
    const c = Math.cos(b.heading), sn = Math.sin(b.heading), hl = b.length * 0.5, hb = b.length * 0.17;
    return [[hl, hb], [hl, -hb], [-hl, -hb], [-hl, hb]].map(([u, v]) => [b.x + u * c - v * sn, b.y + u * sn + v * c]);
  };
  const separated = (A, B) => {
    for (const P of [A, B]) for (let i = 0; i < 4; i++) {
      const [x0, y0] = P[i], [x1, y1] = P[(i + 1) % 4], ax = y0 - y1, ay = x1 - x0;
      const pa = A.map(([x, y]) => x * ax + y * ay), pb = B.map(([x, y]) => x * ax + y * ay);
      if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return true;
    }
    return false;
  };
  const grid = new Map(), list = [];
  for (const b of boats) {
    if (!near(b.x, b.y)) continue;
    const box = corners(b), gx = Math.floor(b.x / 20), gy = Math.floor(b.y / 20);
    let clash = false;
    for (let i = -1; i <= 1 && !clash; i++) for (let j = -1; j <= 1 && !clash; j++) {
      for (const o of grid.get(`${gx + i},${gy + j}`) ?? []) if (!separated(box, o)) { clash = true; break; }
    }
    if (clash) continue;
    list.push(b);
    const key = `${gx},${gy}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(box);
  }
  const group = new THREE.Group();
  const lights = [];
  let seed = 17;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const typeOf = (b) => (b.sail ? 'sail' : b.length > 13 ? 'flybridge' : b.length < 8 ? 'runabout' : 'cruiser');
  const hulls = [[0.8, 0.81, 0.82], [0.8, 0.81, 0.82], [0.8, 0.81, 0.82], [0.8, 0.81, 0.82], [0.8, 0.81, 0.82], [0.8, 0.81, 0.82], [0.8, 0.81, 0.82], [0.8, 0.81, 0.82],
    [0.05, 0.07, 0.16], [0.05, 0.12, 0.08], [0.74, 0.7, 0.6], [0.04, 0.04, 0.045], [0.5, 0.07, 0.06]];
  const stripes = [[0.05, 0.08, 0.2], [0.04, 0.04, 0.05], [0.55, 0.08, 0.06], [0.05, 0.3, 0.35], [0.12, 0.2, 0.45]];
  const material = boatMaterial(uniforms);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  for (const type of ['runabout', 'cruiser', 'flybridge', 'sail']) {
    const these = list.filter((b) => typeOf(b) === type);
    if (!these.length) continue;
    const geo = boatModel(type);
    const hull = new Float32Array(these.length * 3), stripe = new Float32Array(these.length * 3), lit = new Float32Array(these.length), phase = new Float32Array(these.length);
    const mesh = new THREE.InstancedMesh(geo, material, these.length);
    these.forEach((b, i) => {
      const s = b.length / NOMINAL;
      q.setFromAxisAngle(up, b.heading);
      m.compose(new THREE.Vector3(b.x, 0.1, -b.y), q, new THREE.Vector3(s, s, s));
      mesh.setMatrixAt(i, m);
      const hc = hulls[Math.floor(rand() * hulls.length)];
      hull.set(hc, i * 3);
      stripe.set(rand() < 0.35 ? hc : stripes[Math.floor(rand() * stripes.length)], i * 3);
      lit[i] = type !== 'runabout' && rand() < 0.2 ? 0.6 + rand() * 0.4 : 0;
      phase[i] = rand();
      if (type === 'sail') lights.push({ p: [b.x + Math.cos(b.heading) * s, 1.2 + 14.2 * s, -(b.y + Math.sin(b.heading) * s)], color: [3.2, 3.2, 3.0], size: 0.25 }); // anchor light
      if (lit[i]) lights.push({ p: [b.x, (type === 'flybridge' ? 2.6 : 2.0) * s, -b.y], color: [3.0, 1.9, 0.9], size: 0.35 });
    });
    geo.setAttribute('aHull', new THREE.InstancedBufferAttribute(hull, 3));
    geo.setAttribute('aStripe', new THREE.InstancedBufferAttribute(stripe, 3));
    geo.setAttribute('aLit', new THREE.InstancedBufferAttribute(lit, 1));
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
    mesh.computeBoundingSphere();
    group.add(mesh);
  }

  // Dock floats: plank decks with a darker skirt, pools of light under the dock lamps (every 30 m).
  const pos = [], along = [], part = [];
  for (const line of docks) {
    if (!line.every(([x, y]) => near(x, y))) continue;
    let cum = 0;
    for (let i = 1; i < line.length; i++) {
      const [ax, ay] = line[i - 1], [bx, by] = line[i];
      const len = Math.hypot(bx - ax, by - ay) || 1;
      const nx = (-(by - ay) / len) * 1.2, ny = ((bx - ax) / len) * 1.2;
      const top = [[ax + nx, ay + ny, cum], [bx + nx, by + ny, cum + len], [bx - nx, by - ny, cum + len], [ax - nx, ay - ny, cum]];
      for (const k of [0, 1, 2, 0, 2, 3]) { const [x, y, a] = top[k]; pos.push(x, 0.5, -y); along.push(a); part.push(0); }
      for (const [p0, p1] of [[top[0], top[1]], [top[2], top[3]]]) {
        const v = [[p0[0], 0.5, p0[1], p0[2]], [p1[0], 0.5, p1[1], p1[2]], [p1[0], 0.05, p1[1], p1[2]], [p0[0], 0.05, p0[1], p0[2]]];
        for (const k of [0, 1, 2, 0, 2, 3]) { const [x, h, y, a] = v[k]; pos.push(x, h, -y); along.push(a); part.push(1); }
      }
      for (let s = 10; s < len; s += 30) {
        const t = s / len;
        lights.push({ p: [ax + (bx - ax) * t, 1.1, -(ay + (by - ay) * t)], color: [2.6, 1.7, 0.8], size: 0.3 });
      }
      cum += len;
    }
  }
  const dockGeo = new THREE.BufferGeometry();
  dockGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  dockGeo.setAttribute('aAlong', new THREE.Float32BufferAttribute(along, 1));
  dockGeo.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
  const dockMat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute float aAlong; attribute float aPart;
      varying vec3 vWorld; varying float vAlong; varying float vPart;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; vAlong = aAlong; vPart = aPart; gl_Position = projectionMatrix * viewMatrix * w; }
    `,
    fragmentShader: /* glsl */ `
      ${skyGlsl}
      ${hashGlsl}
      ${fogGlsl}
      varying vec3 vWorld; varying float vAlong; varying float vPart;
      void main() {
        // Weathered planks across the float, lit by the dock lamps.
        float plank = 0.85 + 0.15 * step(0.12, fract(vAlong / 0.32)) * (0.8 + 0.4 * hash12(vec2(floor(vAlong / 0.32), 3.0)));
        vec3 wood = vec3(0.07, 0.062, 0.055) * plank;
        float d = mod(vAlong - 10.0, 30.0); d = min(d, 30.0 - d);
        float pool = exp(-d * d / (2.0 * 4.0 * 4.0));
        vec3 col = wood * (0.6 + 2.6 * pool * vec3(1.0, 0.75, 0.5));
        col = mix(col, vec3(0.02, 0.022, 0.025) * (0.6 + pool), vPart);
        gl_FragColor = vec4(applyFog(col, vWorld), 1.0);
      }
    `,
  });
  group.add(new THREE.Mesh(dockGeo, dockMat));
  return { group, lights, stats: { boats: list.length, sail: list.filter((b) => b.sail).length } };
}

/** Rainbow stripes for the Aquabus hull sides. */
function rainbowTexture() {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 64;
  const ctx = c.getContext('2d');
  const bands = ['#e8312f', '#f58a1f', '#f7d031', '#3db54a', '#1f8fd6', '#6a3fa0'];
  bands.forEach((col, i) => { ctx.fillStyle = col; ctx.fillRect(0, (i * 64) / bands.length, 4, 64 / bands.length + 1); });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * An Aquabus: rainbow-striped hull, white canopy, lit cabin. Shuttles back and forth between two points
 * on the water (`from`, `to`, local metres), easing in and out and waiting a few seconds at each end.
 * Call update(time) every frame.
 */
export function createAquabus({ from, to, speed = 4.5, dwell = 6, phase = 0 }, envMap = null) {
  const group = new THREE.Group();
  const L = 11, B = 3.8;
  const stripes = new THREE.MeshStandardMaterial({ map: rainbowTexture(), roughness: 0.5, emissive: 0xffffff, emissiveIntensity: 0.05, envMap });
  const hull = new THREE.Mesh(
    new THREE.BoxGeometry(L, 1.3, B),
    [
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }),
      new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.6 }),
      new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.9 }),
      stripes,
      stripes,
    ],
  );
  hull.position.y = 0.5;
  const bow = new THREE.Mesh(new THREE.ConeGeometry(B / 2, 2.4, 4, 1), new THREE.MeshStandardMaterial({ color: 0xe8312f, roughness: 0.6 }));
  bow.rotation.z = -Math.PI / 2;
  bow.rotation.x = Math.PI / 4;
  bow.scale.set(1, 1, 0.62);
  bow.position.set(L / 2 + 1.1, 0.5, 0);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(L * 0.62, 1.5, B * 0.86), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 1.05, 0.6) }));
  cabin.position.set(-0.6, 1.9, 0);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(L * 0.7, 0.18, B * 0.95), new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6, envMap }));
  roof.position.set(-0.6, 2.75, 0);
  // Masthead light (bright enough to bloom) travels with the boat.
  const masthead = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 5, 4.6) }));
  masthead.position.set(1.5, 3.4, 0);
  group.add(hull, bow, cabin, roof, masthead);

  // Wake: a faint V of churned water behind the stern, shown while the boat is moving.
  const wakeMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uStrength: { value: 0 }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uStrength; uniform float uTime; varying vec2 vUv;
      void main() {
        float behind = 1.0 - vUv.x;                       // 0 at the stern, 1 at the far end
        float side = abs(vUv.y - 0.5) * 2.0;              // 0 centre line, 1 edges
        float arms = exp(-pow((side - behind * 0.85) * 7.0, 2.0));
        float trail = exp(-pow(side * 4.0, 2.0)) * (1.0 - behind) * 0.7;
        float foam = (arms + trail) * (1.0 - behind) * (0.7 + 0.3 * sin(vUv.x * 60.0 - uTime * 5.0));
        gl_FragColor = vec4(vec3(0.5, 0.56, 0.62) * foam * 0.22 * uStrength, 1.0);
      }
    `,
  });
  const wake = new THREE.Mesh(new THREE.PlaneGeometry(44, 18), wakeMat);
  wake.rotation.x = -Math.PI / 2;
  wake.position.set(-L / 2 - 22, 0.06, 0);
  group.add(wake);

  const dx = to.x - from.x, dy = to.y - from.y;
  const D = Math.hypot(dx, dy);
  const travel = D / speed;
  const cycle = 2 * (travel + dwell);
  const smooth = (t) => t * t * (3 - 2 * t);

  function update(time) {
    let u = (((time + phase) % cycle) + cycle) % cycle;
    let k, outbound;
    if (u < dwell) { k = 0; outbound = true; }
    else if (u < dwell + travel) { k = smooth((u - dwell) / travel); outbound = true; }
    else if (u < 2 * dwell + travel) { k = 1; outbound = false; }
    else { k = 1 - smooth((u - 2 * dwell - travel) / travel); outbound = false; }
    const x = from.x + dx * k, y = from.y + dy * k;
    group.position.set(x, 0, -y);
    // Bow points the way it's going (local +x → heading); a gentle bob on the ripples.
    const heading = Math.atan2(outbound ? dy : -dy, outbound ? dx : -dx);
    group.rotation.set(0, heading, Math.sin(time * 1.3 + phase) * 0.015);
    group.position.y = Math.sin(time * 1.7 + phase) * 0.08;
    // Wake strength follows speed (zero while docked).
    const trip = u > dwell && u < dwell + travel ? (u - dwell) / travel : u > 2 * dwell + travel ? (u - 2 * dwell - travel) / travel : -1;
    const ramp = (t) => Math.min(1, Math.max(0, t));
    wakeMat.uniforms.uStrength.value = trip < 0 ? 0 : ramp(trip / 0.15) * ramp((1 - trip) / 0.2);
    wakeMat.uniforms.uTime.value = time;
  }
  update(0);
  return { group, update, lights: [] };
}

/**
 * Small boats under way: a few cruisers and runabouts drifting very slowly round closed loops of open water
 * (`loops`: [{ c: [x, y], rx, ry, rot, speed, dir, phase, length, type }], local metres, speed in m/s), with
 * navigation lights (red port, green starboard, white masthead and stern) and a lit cabin. They are real
 * geometry, so the water reflects them and streaks their lights. Call update(time) every frame.
 */
export function createDrifters(loops, uniforms) {
  const group = new THREE.Group();
  const material = boatMaterial(uniforms);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), pos = new THREE.Vector3(), scl = new THREE.Vector3();
  const meshes = [];
  for (const type of ['runabout', 'cruiser']) {
    const these = loops.filter((l) => l.type === type);
    if (!these.length) continue;
    const geo = boatModel(type);
    const n = these.length;
    geo.setAttribute('aHull', new THREE.InstancedBufferAttribute(new Float32Array(n * 3).fill(0.8), 3));
    geo.setAttribute('aStripe', new THREE.InstancedBufferAttribute(new Float32Array(these.flatMap((_, i) => (i % 2 ? [0.05, 0.08, 0.2] : [0.04, 0.04, 0.05]))), 3));
    geo.setAttribute('aLit', new THREE.InstancedBufferAttribute(new Float32Array(n).fill(0.9), 1)); // cabins lit: they're out for the evening
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(new Float32Array(these.map((l) => l.phase % 1)), 1));
    const mesh = new THREE.InstancedMesh(geo, material, n);
    mesh.frustumCulled = false; // instances move; there are only a handful
    group.add(mesh);
    meshes.push({ mesh, loops: these });
  }
  // Five lights per boat: port, starboard, masthead, stern, and a soft cabin glow.
  const COLORS = [[6, 0.35, 0.18], [0.3, 5, 1.4], [4.2, 4.2, 4], [3.2, 3.2, 3], [2.4, 1.5, 0.7]];
  const SIZES = [0.32, 0.32, 0.35, 0.3, 0.9];
  const all = meshes.flatMap((g) => g.loops);
  const points = createLightPoints(all.flatMap(() => COLORS.map((color, k) => ({ p: [0, -100, 0], color, size: SIZES[k] }))), uniforms);
  group.add(points);
  const lp = points.geometry.attributes.position;

  const pose = (l, time) => {
    // Angle round the ellipse; angular speed from the mean radius gives roughly the given speed.
    const th = l.phase * Math.PI * 2 + (l.dir * time * l.speed) / ((l.rx + l.ry) / 2);
    const cr = Math.cos(l.rot), sr = Math.sin(l.rot);
    const ex = l.rx * Math.cos(th), ey = l.ry * Math.sin(th);
    const tx = -l.rx * Math.sin(th) * l.dir, ty = l.ry * Math.cos(th) * l.dir;
    return { x: l.c[0] + ex * cr - ey * sr, y: l.c[1] + ex * sr + ey * cr, heading: Math.atan2(tx * sr + ty * cr, tx * cr - ty * sr) };
  };
  const update = (time) => {
    let li = 0;
    for (const { mesh, loops: these } of meshes) {
      these.forEach((l, i) => {
        const { x, y, heading } = pose(l, time);
        const s = l.length / NOMINAL;
        q.setFromAxisAngle(up, heading);
        m.compose(pos.set(x, 0.1, -y), q, scl.set(s, s, s));
        mesh.setMatrixAt(i, m);
        const fx = Math.cos(heading), fy = Math.sin(heading), px = -fy, py = fx; // forward, port (left)
        const at = (f, side, h) => [x + fx * f * l.length + px * side * l.length, h * s, -(y + fy * f * l.length + py * side * l.length)];
        const cabinTop = l.type === 'cruiser' ? 2.7 : 1.9;
        const spots = [at(0.25, 0.15, 1.5), at(0.25, -0.15, 1.5), at(0.02, 0, cabinTop + 0.6), at(-0.49, 0, 1.2), at(-0.05, 0, cabinTop - 0.6)];
        for (const p of spots) lp.setXYZ(li++, p[0], p[1], p[2]);
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
    lp.needsUpdate = true;
  };
  update(0);
  return { group, update };
}
