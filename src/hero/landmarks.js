import * as THREE from 'three';
import { orientedExtents } from './skyline-data.js';

/**
 * Hand-built landmarks, placed from the footprint parts they replace (see skyline-data.js).
 * Lit with the scene's hemisphere/west light plus a sky environment map. Positions: world X = x, Z = -y.
 */

const hdr = (r, g, b, k) => new THREE.Color(r * k, g * k, b * k);

/** BC Place: oval bowl, cable-supported fabric roof, 36 masts and the orange LED ring. */
export function bcPlace({ center, angle, a, b }, envMap) {
  const group = new THREE.Group();
  const wallH = 32, roofRise = 24;
  const rx = a * 0.97, rz = b * 0.97;

  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(1, 1.04, wallH, 96, 1, true),
    new THREE.MeshStandardMaterial({
      color: 0x6a707a, roughness: 0.8, metalness: 0.05, envMap, envMapIntensity: 0.6,
      emissive: new THREE.Color(0.025, 0.027, 0.032), // floodlit panels
    }),
  );
  wall.scale.set(rx, 1, rz);
  wall.position.y = wallH / 2;
  group.add(wall);

  // Concourse glazing: a lit band around the bowl.
  const band = new THREE.Mesh(
    new THREE.CylinderGeometry(1.006, 1.012, 3.2, 96, 1, true),
    new THREE.MeshBasicMaterial({ color: hdr(1, 0.72, 0.45, 1.3) }),
  );
  band.scale.set(rx, 1, rz);
  band.position.y = 12;
  group.add(band);

  const roof = new THREE.Mesh(
    new THREE.SphereGeometry(1, 96, 20, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({
      color: 0xf4f5f7, roughness: 0.95, metalness: 0.0, envMap, envMapIntensity: 0.25,
      emissive: new THREE.Color(0.16, 0.155, 0.15), // white fabric, glowing softly from the lit stadium inside
    }),
  );
  roof.scale.set(rx * 0.96, roofRise, rz * 0.96);
  roof.position.y = wallH;
  group.add(roof);

  // Masts around the rim, leaning slightly outward.
  const masts = 36, mastH = 46;
  const mastMesh = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.45, 0.7, mastH, 6),
    new THREE.MeshStandardMaterial({ color: 0xe6e9ee, roughness: 0.5, metalness: 0.1, envMap, emissive: new THREE.Color(0.05, 0.05, 0.055) }),
    masts,
  );
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1);
  const tops = [];
  for (let i = 0; i < masts; i++) {
    const t = (i / masts) * Math.PI * 2;
    const x = Math.cos(t) * rx * 1.01, z = Math.sin(t) * rz * 1.01;
    const out = new THREE.Vector3(x, 0, z).normalize();
    q.setFromAxisAngle(new THREE.Vector3(-out.z, 0, out.x), 0.1);
    const p = new THREE.Vector3(x, wallH - 8 + mastH / 2, z);
    m.compose(p, q, s);
    mastMesh.setMatrixAt(i, m);
    tops.push(new THREE.Vector3(0, mastH / 2, 0).applyQuaternion(q).add(p));
  }
  group.add(mastMesh);

  // The orange LED ring along the roof edge.
  const ringPts = [];
  for (let i = 0; i < 128; i++) {
    const t = (i / 128) * Math.PI * 2;
    ringPts.push(new THREE.Vector3(Math.cos(t) * rx * 1.005, wallH + 0.6, Math.sin(t) * rz * 1.005));
  }
  const ring = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ringPts, true), 256, 0.9, 6, true),
    new THREE.MeshBasicMaterial({ color: hdr(1, 0.42, 0.08, 5) }),
  );
  group.add(ring);

  group.rotation.y = angle; // footprint long axis (local x→y rotation maps to world -Z, so same sign)
  group.position.set(center[0], 0, -center[1]);
  group.updateMatrixWorld(true);
  const mastLights = tops.map((p) => p.applyMatrix4(group.matrixWorld));
  return { group, mastLights };
}

/** Harbour Centre: concrete shaft, the lookout "saucer" with a lit window ring, antenna and beacon. */
export function harbourCentre({ center }, envMap) {
  const group = new THREE.Group();
  const concrete = new THREE.MeshStandardMaterial({ color: 0x5a5f68, roughness: 0.8, envMap, envMapIntensity: 0.5 });

  const shaft = new THREE.Mesh(new THREE.BoxGeometry(19, 118, 19), concrete);
  shaft.position.y = 59;
  group.add(shaft);

  // Glass elevator tracks up the face (lit faintly).
  const track = new THREE.Mesh(new THREE.BoxGeometry(3, 112, 0.6), new THREE.MeshBasicMaterial({ color: hdr(1, 0.8, 0.6, 0.6) }));
  track.position.set(0, 58, 9.8);
  group.add(track);

  const profile = [[0, 117], [11, 117], [19, 120], [21.5, 124], [21.5, 130], [18, 134], [9, 137], [0, 137]].map(
    ([r, y]) => new THREE.Vector2(r, y),
  );
  const saucer = new THREE.Mesh(new THREE.LatheGeometry(profile, 48), concrete);
  group.add(saucer);

  const windows = new THREE.Mesh(
    new THREE.CylinderGeometry(21.7, 21.7, 4.2, 48, 1, true),
    new THREE.MeshBasicMaterial({ color: hdr(1, 0.7, 0.42, 2.4) }),
  );
  windows.position.y = 127;
  group.add(windows);

  const cap = new THREE.Mesh(new THREE.CylinderGeometry(5, 6, 5, 16), concrete);
  cap.position.y = 139.5;
  group.add(cap);
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.6, 24, 6), concrete);
  antenna.position.y = 154;
  group.add(antenna);

  group.position.set(center[0], 0, -center[1]);
  return { group, beacon: [center[0], 166.5, -center[1]] };
}

/** Science World: geodesic dome on a short pedestal, with its lights on the triangle vertices. */
export function scienceWorld({ center, radius, top }, envMap) {
  const group = new THREE.Group();
  const r = Math.max(radius, 17);
  const cy = top - r;

  const dome = new THREE.Mesh(
    new THREE.IcosahedronGeometry(r, 3),
    new THREE.MeshStandardMaterial({ color: 0xc8ced6, metalness: 0.85, roughness: 0.28, envMap, envMapIntensity: 1.3, flatShading: true }),
  );
  dome.position.y = cy;
  group.add(dome);

  const pedestal = new THREE.Mesh(
    new THREE.CylinderGeometry(r * 0.45, r * 0.55, cy, 24),
    new THREE.MeshStandardMaterial({ color: 0x23262c, roughness: 0.9 }),
  );
  pedestal.position.y = cy / 2;
  group.add(pedestal);

  group.position.set(center[0], 0, -center[1]);

  // Unique vertices of a coarser icosphere = light positions.
  const ico = new THREE.IcosahedronGeometry(r * 1.01, 2);
  const seen = new Set();
  const lights = [];
  const p = ico.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(2)},${p.getY(i).toFixed(2)},${p.getZ(i).toFixed(2)}`;
    if (seen.has(key) || p.getY(i) < -r * 0.45) continue;
    seen.add(key);
    lights.push([center[0] + p.getX(i), cy + p.getY(i), -center[1] + p.getZ(i)]);
  }
  return { group, lights };
}

/** Procedural facade textures (browser only): lit curtain glass with mullions, and ribbed metal cladding. */
function arenaTextures() {
  if (typeof document === 'undefined') return null;
  const make = (w, h, draw, srgb = true) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  let seed = 9;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const bays = 8, bayW = 64; // one repeat = 8 bays of 6 m
  const lit = Array.from({ length: bays * 2 }, () => (rand() < 0.78 ? 0.45 + rand() * 0.55 : 0.08));
  const glassW = bays * bayW, glassH = 128;
  const glass = make(glassW, glassH, (g, w, h) => {
    g.fillStyle = '#10151c'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#2a323d';
    for (let b = 0; b <= bays; b++) g.fillRect(b * bayW - 1.5, 0, 3, h); // mullions
    g.fillRect(0, h / 2 - 1.5, w, 3); // transom
    g.fillRect(0, 0, w, 3); g.fillRect(0, h - 3, w, 3);
  });
  const glow = make(glassW, glassH, (g, w, h) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    for (let b = 0; b < bays; b++) for (let r = 0; r < 2; r++) {
      const k = lit[b * 2 + r];
      const warm = rand() < 0.2 ? [210, 225, 255] : [255, 190, 120];
      g.fillStyle = `rgb(${warm.map((v) => Math.round(v * k)).join(',')})`;
      g.fillRect(b * bayW + 3, r * (h / 2) + 5, bayW - 6, h / 2 - 9);
    }
  });
  const clad = make(256, 64, (g, w, h) => {
    g.fillStyle = '#9aa0a9'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#7a808a';
    for (let y = 0; y < h; y += 8) g.fillRect(0, y, w, 2); // ribs
    g.fillStyle = '#6a707a';
    for (let x = 0; x < w; x += 64) g.fillRect(x, 0, 2, h); // panel seams
  });
  return { glass, glow, clad };
}

/**
 * Rogers Arena: a dark podium, a tall lit curtain-glass concourse, ribbed metal cladding, and the low dark
 * domed roof with its skylight ridge. The mapped footprint is angular (it includes the atrium and
 * the bend where the viaduct splits), so it only sets the position, orientation, proportions and area; the
 * bowl itself is a smooth rounded superellipse of the same area.
 */
export function rogersArena({ ring: rawRing, height }, envMap, { signAt = 0.8, toward = null } = {}) {
  const group = new THREE.Group();
  const ex = orientedExtents(rawRing);
  const [cx, cy] = ex.center;
  const ux = Math.cos(ex.angle), uy = Math.sin(ex.angle);

  let footprint = 0;
  for (let i = 0, j = rawRing.length - 1; i < rawRing.length; j = i++) footprint += rawRing[j][0] * rawRing[i][1] - rawRing[i][0] * rawRing[j][1];
  footprint = Math.abs(footprint) / 2;
  // Superellipse |x/A|^n + |y/B|^n = 1: area = 4AB·Γ(1+1/n)²/Γ(1+2/n) ≈ 3.48·AB for n = 2.8 (rounded corners).
  const EXP = 2.8, FACTOR = 3.48, ASPECT = ex.a / ex.b, GROW = 1.06;
  const B = Math.sqrt(footprint / (FACTOR * ASPECT)) * GROW, A = B * ASPECT;
  const N = 96;
  const pts = [], arc = [];
  let run = 0;
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2, c = Math.cos(t), sn = Math.sin(t);
    const lx = A * Math.sign(c) * Math.pow(Math.abs(c), 2 / EXP), ly = B * Math.sign(sn) * Math.pow(Math.abs(sn), 2 / EXP);
    pts.push([lx * ux - ly * uy, lx * uy + ly * ux]); // counter-clockwise, rotated onto the footprint's axis
    if (i) run += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    arc.push(run);
  }
  const perimeter = run + Math.hypot(pts[0][0] - pts[N - 1][0], pts[0][1] - pts[N - 1][1]);

  const top = Math.min(Math.max(height, 34), 42);
  const rise = 11, baseH = top - rise;
  // Low dome: rises evenly from the eave to the crown (convex everywhere, no saddle), flat-topped.
  const roofAt = (x, y) => {
    const un = Math.abs(x * ux + y * uy) / A, vn = Math.abs(-x * uy + y * ux) / B;
    const r = Math.min(1, Math.pow(Math.pow(un, EXP) + Math.pow(vn, EXP), 1 / EXP)); // 1 on the outline
    return rise * Math.pow(1 - r * r * r, 0.7);
  };

  const tex = arenaTextures();
  const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0.05, side: THREE.DoubleSide, envMap, envMapIntensity: 0.6, ...extra });
  const podiumMat = std(0x565a62, { emissive: new THREE.Color(0.03, 0.03, 0.034) });
  const glassMat = tex
    ? std(0xffffff, { map: tex.glass, emissiveMap: tex.glow, emissive: new THREE.Color(1.5, 1.5, 1.5), roughness: 0.35, metalness: 0.3, envMapIntensity: 1 })
    : new THREE.MeshBasicMaterial({ color: hdr(1, 0.7, 0.42, 1.2), side: THREE.DoubleSide });
  const cladMat = std(tex ? 0xffffff : 0x8b919a, { map: tex?.clad ?? null, roughness: 0.55, metalness: 0.35, envMapIntensity: 0.9, emissive: new THREE.Color(0.05, 0.052, 0.058) });
  // Same metal as the cladding below it (its average tone, without the rib texture) so wall and roof read as one skin.
  const roofMat = std(0x8c929b, { roughness: 0.55, metalness: 0.35, envMapIntensity: 0.9, emissive: new THREE.Color(0.05, 0.052, 0.058) });

  /** A vertical band around the footprint: bottom/top heights per point, UVs by metres of perimeter. */
  const wall = (scale, y0, y1, material, uMetres, vMetres, include = () => true) => {
    const pos = [], uv = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const [x, y] = pts[i % N];
      const sx = x * scale, sy = y * scale;
      const a = typeof y0 === 'function' ? y0(x, y) : y0, b = typeof y1 === 'function' ? y1(x, y) : y1;
      const u = (i === N ? perimeter : arc[i]) / uMetres;
      pos.push(sx, a, -sy, sx, b, -sy);
      uv.push(u, 0, u, vMetres ? (b - a) / vMetres : 1);
      if (i < N && include(i)) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    group.add(new THREE.Mesh(geo, material));
  };

  const podiumH = 9, glassH = 12;
  wall(1, 0, podiumH, podiumMat, 12, 0);
  // The concourse is glazed along some stretches only; the rest is solid wall (t = fraction round the outline,
  // counter-clockwise from the east end of the long axis; the south side faces the camera).
  const GLAZED = [[0.9, 1.12], [0.3, 0.5], [0.62, 0.8]];
  const glazed = (i) => { const t = (i + 0.5) / N; return GLAZED.some(([a, b]) => (t >= a && t < b) || t + 1 < b); };
  wall(1.004, podiumH, podiumH + glassH, glassMat, 48, glassH, glazed);
  wall(1.002, podiumH, podiumH + glassH, std(0x4d5159, { emissive: new THREE.Color(0.025, 0.026, 0.03) }), 12, 0, (i) => !glazed(i));
  wall(1, podiumH + glassH, (x, y) => baseH + roofAt(x, y), cladMat, 32, 7); // cladding up to the roof edge

  // Roof: concentric rings from the eave to the crown, shaded smoothly.
  const LAYERS = 9;
  const rpos = [], ridx = [];
  for (let j = 0; j <= LAYERS; j++) {
    const s = 1 - j / LAYERS;
    for (let i = 0; i < N; i++) {
      const x = pts[i][0] * s, y = pts[i][1] * s;
      rpos.push(x, baseH + roofAt(x, y), -y);
    }
  }
  for (let j = 0; j < LAYERS; j++) for (let i = 0; i < N; i++) {
    const a = j * N + i, b = j * N + ((i + 1) % N), c = (j + 1) * N + i, d = (j + 1) * N + ((i + 1) % N);
    ridx.push(a, c, b, b, c, d);
  }
  const roofGeo = new THREE.BufferGeometry();
  roofGeo.setAttribute('position', new THREE.Float32BufferAttribute(rpos, 3));
  roofGeo.setIndex(ridx);
  roofGeo.computeVertexNormals();
  group.add(new THREE.Mesh(roofGeo, roofMat));

  // Skylight ridge along the crown (warm glow from inside).
  const ridge = new THREE.Mesh(new THREE.BoxGeometry(A * 1.2, 0.5, 3.4), new THREE.MeshBasicMaterial({ color: hdr(1, 0.82, 0.55, 0.85) }));
  ridge.rotation.y = ex.angle;
  ridge.position.set(0, top + 0.3, 0);
  group.add(ridge);

  // Small red signs on the cladding above the glass, like the real ones: one on the camera-facing (south)
  // side, one on the side facing BC Place (`toward`, in local metres), at the outline point whose outward
  // normal points most nearly that way.
  const signY = podiumH + glassH + 3.6;
  const signLights = [];
  const addSign = (si) => {
    const sp = pts[si], tx = pts[(si + 1) % N][0] - pts[(si - 1 + N) % N][0], ty = pts[(si + 1) % N][1] - pts[(si - 1 + N) % N][1];
    const tl = Math.hypot(tx, ty), nx = ty / tl, ny = -tx / tl; // outward normal (counter-clockwise outline)
    const sign = new THREE.Group();
    sign.add(new THREE.Mesh(new THREE.BoxGeometry(15, 3.4, 0.5), new THREE.MeshStandardMaterial({ color: 0x1b1c20, roughness: 0.7 })));
    const face = new THREE.Mesh(new THREE.BoxGeometry(13, 2.1, 0.3), new THREE.MeshBasicMaterial({ color: hdr(1, 0.08, 0.06, 3.2) }));
    face.position.z = 0.3;
    sign.add(face);
    sign.rotation.y = Math.atan2(ty, tx); // local +Z (the face) points along the outward normal
    sign.position.set(sp[0] * 1.012 + nx * 0.5, signY, -(sp[1] * 1.012 + ny * 0.5));
    group.add(sign);
    signLights.push([cx + sp[0] * 1.012 + nx * 2, signY, -(cy + sp[1] * 1.012 + ny * 2)]);
  };
  addSign(Math.round(signAt * N) % N);
  if (toward) {
    const dx = toward[0] - cx, dy = toward[1] - cy, dl = Math.hypot(dx, dy);
    let best = 0, bestDot = -2;
    for (let i = 0; i < N; i++) {
      const tx = pts[(i + 1) % N][0] - pts[(i - 1 + N) % N][0], ty = pts[(i + 1) % N][1] - pts[(i - 1 + N) % N][1], tl = Math.hypot(tx, ty);
      const dot = ((ty / tl) * dx + (-tx / tl) * dy) / dl;
      if (dot > bestDot) { bestDot = dot; best = i; }
    }
    addSign(best);
  }

  group.position.set(cx, 0, -cy);

  // Floodlit signage corners at the four extremes of the footprint, high on the cladding.
  const lights = [];
  for (const pick of [(a, b) => a[0] < b[0], (a, b) => a[0] > b[0], (a, b) => a[1] < b[1], (a, b) => a[1] > b[1]]) {
    const p = pts.reduce((m, q) => (pick(q, m) ? q : m));
    lights.push([cx + p[0] * 0.97, podiumH + glassH + 4, -(cy + p[1] * 0.97)]);
  }
  return { group, lights, signLights };
}
