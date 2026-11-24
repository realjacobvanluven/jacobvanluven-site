import * as THREE from 'three';
import { skyGlsl, hashGlsl, groundGlsl, fogGlsl } from './shaders.js';

/**
 * The promenade around Science World. The mapped shoreline runs behind the building, so without this the whole
 * building (the exhibit halls and the dome's base) stands in the water. In life it sits on a deck on piles at the head of
 * False Creek with a wide walkway all the way round, a railing on the water side, and lamps.
 *
 * The outline is found by casting rays from the middle of the complex and keeping the farthest point that is still within
 * MARGIN of a building (or the dome) and over water; the radii are then smoothed so the edge is a gentle curve, not the
 * stair-steps of the map. East, where it meets the shore, it stops a few metres onto land and meets the seawall.
 */

export const DECK_TOP = 0.47; // m above the water; the seawall promenade is at 0.45
const MARGIN = 8; // walkway width outside the walls
const KERB = 0.7; // lighter kerb band along the edge
const RAYS = 240;

function segDist(x, y, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2));
  return Math.hypot(x - a[0] - dx * t, y - a[1] - dy * t);
}
function insideRing(x, y, ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    if ((ring[i][1] > y) !== (ring[j][1] > y) && x < ((ring[j][0] - ring[i][0]) * (y - ring[i][1])) / (ring[j][1] - ring[i][1]) + ring[i][0]) c = !c;
  }
  return c;
}

/** Smooth outline polygon [[x, y], …] (map metres) around the dome and the exhibit halls, plus a point-in-deck test. */
export function scienceDeckOutline({ center, radius }, rings, isWater) {
  const [cx, cy] = center;
  const ox = cx + 8, oy = cy + 4;
  const dist = (x, y) => {
    let m = Math.hypot(x - cx, y - cy) - radius;
    for (const r of rings) {
      let e = Infinity;
      for (let i = 0; i < r.length; i++) e = Math.min(e, segDist(x, y, r[i], r[(i + 1) % r.length]));
      m = Math.min(m, insideRing(x, y, r) ? -e : e);
    }
    return m;
  };
  const nearWater = (x, y) => [[0, 0], [6, 0], [-6, 0], [0, 6], [0, -6]].some(([a, b]) => isWater(x + a, y + b));
  const raw = new Float64Array(RAYS);
  for (let k = 0; k < RAYS; k++) {
    const a = (k / RAYS) * Math.PI * 2;
    let best = 0;
    for (let r = 0; r < 100; r += 0.5) {
      const x = ox + Math.cos(a) * r, y = oy + Math.sin(a) * r;
      if (dist(x, y) <= MARGIN && nearWater(x, y)) best = r;
    }
    raw[k] = best;
  }
  // Circular Gaussian smoothing (sigma ≈ 5°) so the edge has no corners.
  const sigma = 4, win = 12, rad = new Float64Array(RAYS);
  for (let k = 0; k < RAYS; k++) {
    let s = 0, w = 0;
    for (let j = -win; j <= win; j++) {
      const g = Math.exp(-(j * j) / (2 * sigma * sigma));
      s += raw[(k + j + RAYS) % RAYS] * g; w += g;
    }
    rad[k] = s / w;
  }
  const polygon = Array.from({ length: RAYS }, (_, k) => {
    const a = (k / RAYS) * Math.PI * 2;
    return [ox + Math.cos(a) * rad[k], oy + Math.sin(a) * rad[k]];
  });
  // `pad` metres outside the deck counts as inside.
  const contains = (x, y, pad = 0) => {
    const a = Math.atan2(y - oy, x - ox), k = (((a / (Math.PI * 2)) % 1) + 1) % 1 * RAYS;
    const r0 = rad[Math.floor(k) % RAYS], r1 = rad[(Math.floor(k) + 1) % RAYS], f = k - Math.floor(k);
    return Math.hypot(x - ox, y - oy) <= r0 + (r1 - r0) * f + pad;
  };
  return { polygon, contains, origin: [ox, oy] };
}

function insetPolygon(poly, d) {
  const n = poly.length;
  return poly.map((p, i) => {
    const a = poly[(i + n - 1) % n], b = poly[(i + 1) % n];
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
    // The outline runs counter-clockwise (angle increases), so the interior is on the left.
    return [p[0] - (dy / len) * d, p[1] + (dx / len) * d];
  });
}

export function createScienceDeck(landmark, rings, isWater, uniforms) {
  const { polygon, contains } = scienceDeckOutline(landmark, rings, isWater);
  const n = polygon.length;
  const inner = insetPolygon(polygon, KERB);
  const W = ([x, y], h) => [x, h, -y];

  // Deck surface: kerb band (outer ring to inset ring) and the paved interior.
  const pos = [], kind = [], nrm = [];
  const push = (v, k) => { pos.push(...v); kind.push(k); nrm.push(0, 1, 0); };
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    for (const v of [W(polygon[i], DECK_TOP), W(polygon[j], DECK_TOP), W(inner[j], DECK_TOP), W(polygon[i], DECK_TOP), W(inner[j], DECK_TOP), W(inner[i], DECK_TOP)]) push(v, 1);
  }
  const contour = inner.map(([x, y]) => new THREE.Vector2(x, y));
  for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(contour, [])) for (const idx of [a, b, c]) push(W(inner[idx], DECK_TOP), 0);
  // Fascia: the vertical concrete edge down into the water.
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dx = polygon[j][0] - polygon[i][0], dy = polygon[j][1] - polygon[i][1], len = Math.hypot(dx, dy) || 1;
    const nx = dy / len, nz = dx / len; // outward normal (x, z = -y)
    for (const v of [W(polygon[i], -0.9), W(polygon[j], -0.9), W(polygon[j], DECK_TOP), W(polygon[i], -0.9), W(polygon[j], DECK_TOP), W(polygon[i], DECK_TOP)]) {
      pos.push(...v); kind.push(2); nrm.push(nx, 0, nz);
    }
  }

  // Lamps every ~16 m around the edge, set back from it.
  const perimeter = polygon.reduce((s, p, i) => s + Math.hypot(p[0] - polygon[(i + 1) % n][0], p[1] - polygon[(i + 1) % n][1]), 0);
  const lampCount = Math.max(8, Math.round(perimeter / 16));
  const lampPoints = [];
  {
    const cum = [0];
    for (let i = 0; i < n; i++) cum.push(cum[i] + Math.hypot(polygon[(i + 1) % n][0] - polygon[i][0], polygon[(i + 1) % n][1] - polygon[i][1]));
    let seg = 0;
    for (let k = 0; k < lampCount; k++) {
      const s = ((k + 0.5) / lampCount) * perimeter;
      while (cum[seg + 1] < s) seg++;
      const t = (s - cum[seg]) / (cum[seg + 1] - cum[seg] || 1);
      const a = inner[seg], b = inner[(seg + 1) % n];
      const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
      const ex = polygon[seg][0] + (polygon[(seg + 1) % n][0] - polygon[seg][0]) * t, ey = polygon[seg][1] + (polygon[(seg + 1) % n][1] - polygon[seg][1]) * t;
      // 0.9 m further in from the kerb; none out on the land where the seawall already has its own lamps.
      const l = Math.hypot(x - ex, y - ey) || 1;
      const lx = x + ((x - ex) / l) * 0.9, ly = y + ((y - ey) / l) * 0.9;
      if (!isWater(ex + (ex - lx) * 3, ey + (ey - ly) * 3)) continue;
      lampPoints.push([lx, ly]);
    }
  }
  const poolUniform = Array.from({ length: 48 }, (_, i) => (lampPoints[i] ? new THREE.Vector2(lampPoints[i][0], -lampPoints[i][1]) : new THREE.Vector2(1e5, 1e5)));

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aKind', new THREE.Float32BufferAttribute(kind, 1));
  const material = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    uniforms: { ...uniforms, uLamps: { value: poolUniform } },
    vertexShader: /* glsl */ `
      attribute float aKind;
      varying vec3 vWorld; varying float vKind;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz; vKind = aKind;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      ${skyGlsl}
      ${hashGlsl}
      ${groundGlsl}
      ${fogGlsl}
      uniform vec2 uLamps[48];
      varying vec3 vWorld; varying float vKind;
      void main() {
        vec3 warm = vec3(1.0, 0.6, 0.28);
        float pool = 0.0;
        for (int i = 0; i < 48; i++) {
          vec2 d = vWorld.xz - uLamps[i];
          pool += exp(-dot(d, d) / (2.0 * 5.5 * 5.5));
        }
        pool = min(pool, 1.6);
        // Broad planks laid across the deck (a boardwalk): long boards with thin gaps and a per-board tone shift.
        vec2 q = vWorld.xz;
        float board = floor(q.x / 0.32 + q.y * 0.0);
        float tone = 0.9 + 0.2 * hash12(vec2(board, floor(q.y / 4.0)));
        float gap = 1.0 - 0.35 * (1.0 - smoothstep(0.0, 0.05, fract(q.x / 0.32)));
        float grain = (0.8 + 0.4 * gfbm(q * 1.7)) * tone * gap;
        vec3 deck = vec3(0.07, 0.065, 0.062) * grain;
        vec3 kerb = vec3(0.10, 0.098, 0.095) * (0.85 + 0.3 * gfbm(q * 1.2));
        vec3 concrete = vec3(0.12, 0.12, 0.125);
        float wallGrad = smoothstep(-0.9, 0.5, vWorld.y);
        vec3 wall = concrete * (0.05 + 0.5 * pool * wallGrad) * mix(vec3(0.6, 0.66, 0.85), warm, 0.6);
        vec3 top = mix(deck, kerb, step(0.5, vKind)) ;
        vec3 col = top * vec3(0.5, 0.55, 0.7) * 0.4 + top * warm * pool * 2.6;
        col = mix(col, wall, step(1.5, vKind));
        gl_FragColor = vec4(applyFog(col, vWorld), 1.0);
      }
    `,
  });

  const group = new THREE.Group();
  group.add(new THREE.Mesh(g, material));

  // Railing on the water side (posts every ~3.5 m and a top rail), left open where the deck meets the shore.
  const railPoly = insetPolygon(polygon, 0.25);
  const posts = [], rail = [];
  let prev = null;
  const step = 2.5;
  const cum = [0];
  for (let i = 0; i < n; i++) cum.push(cum[i] + Math.hypot(railPoly[(i + 1) % n][0] - railPoly[i][0], railPoly[(i + 1) % n][1] - railPoly[i][1]));
  let seg = 0;
  for (let s = 0; s < cum[n]; s += step) {
    while (cum[seg + 1] < s) seg++;
    const t = (s - cum[seg]) / (cum[seg + 1] - cum[seg] || 1);
    const a = railPoly[seg], b = railPoly[(seg + 1) % n];
    const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
    // Open water just beyond the edge (so none along the shore or against the seawall).
    const waterSide = isWater(x + (x - landmark.center[0]) * 0.0, y) && [[2.5, 0], [-2.5, 0], [0, 2.5], [0, -2.5]].filter(([dx, dy]) => isWater(x + dx, y + dy)).length >= 2;
    if (!waterSide) { prev = null; continue; }
    posts.push([x, y]);
    if (prev) rail.push(prev, [x, y]);
    prev = [x, y];
  }
  const postGeo = new THREE.BoxGeometry(0.09, 1.1, 0.09);
  postGeo.translate(0, 0.55, 0);
  const postMesh = new THREE.InstancedMesh(postGeo, new THREE.MeshBasicMaterial({ color: 0x8d8a96 }), Math.max(1, posts.length));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
  posts.forEach(([x, y], i) => postMesh.setMatrixAt(i, m.compose(new THREE.Vector3(x, DECK_TOP, -y), q, one)));
  postMesh.count = posts.length;
  group.add(postMesh);
  const rp = [];
  for (let i = 0; i < rail.length; i += 2) {
    const [ax, ay] = rail[i], [bx, by] = rail[i + 1];
    const len = Math.hypot(bx - ax, by - ay) || 1, nx = (-(by - ay) / len) * 0.05, ny = ((bx - ax) / len) * 0.05;
    for (const h of [DECK_TOP + 1.1, DECK_TOP + 0.8, DECK_TOP + 0.5]) {
      rp.push(ax - nx, h, -(ay - ny), bx - nx, h, -(by - ny), bx + nx, h, -(by + ny), ax - nx, h, -(ay - ny), bx + nx, h, -(by + ny), ax + nx, h, -(ay + ny));
    }
  }
  const rg = new THREE.BufferGeometry();
  rg.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
  group.add(new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: 0xa09cab, side: THREE.DoubleSide })));

  // Lamp posts.
  if (lampPoints.length) {
    const lampGeo = new THREE.CylinderGeometry(0.06, 0.09, 3.6, 6);
    lampGeo.translate(0, 1.8, 0);
    const lampMesh = new THREE.InstancedMesh(lampGeo, new THREE.MeshBasicMaterial({ color: 0x2c2b31 }), lampPoints.length);
    lampPoints.forEach(([x, y], i) => lampMesh.setMatrixAt(i, m.compose(new THREE.Vector3(x, DECK_TOP, -y), q, one)));
    group.add(lampMesh);
  }
  const lamps = lampPoints.map(([x, y]) => ({ p: [x, DECK_TOP + 3.7, -y], color: [6.5, 3.9, 1.8], size: 0.8 }));

  return { group, lamps, contains, stats: { deckPoints: n, lamps: lamps.length, posts: posts.length } };
}
