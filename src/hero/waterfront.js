import * as THREE from 'three';
import { skyGlsl, hashGlsl, groundGlsl, fogGlsl } from './shaders.js';
import { miterOffsets } from './ribbon.js';
import { deckHeight } from './seawall.js';

/**
 * The waterfront and parks, the most visible ground in the shot (from OpenStreetMap via the data file):
 * lawns and sports fields, the seawall footpaths and bike paths with path lights, and the mapped trees.
 */

const PATH_LAMP_SPACING = 24;

/** Lawns (0), sports fields (1) and playgrounds (2) as flat polygons just above the ground. */
function createGreens(greens, uniforms, heightAt = () => 0) {
  const pos = [], kind = [];
  for (const g of greens) {
    const contour = g.ring.map(([x, y]) => new THREE.Vector2(x, y));
    let tris;
    try { tris = THREE.ShapeUtils.triangulateShape(contour, []); } catch { continue; }
    for (const t of tris) for (const i of t) { pos.push(g.ring[i][0], 0.06 + heightAt(g.ring[i][0], g.ring[i][1]), -g.ring[i][1]); kind.push(g.kind); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aKind', new THREE.Float32BufferAttribute(kind, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    vertexShader: /* glsl */ `
      attribute float aKind; varying float vKind; varying vec3 vWorld;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; vKind = aKind; gl_Position = projectionMatrix * viewMatrix * w; }
    `,
    fragmentShader: /* glsl */ `
      ${skyGlsl}
      ${hashGlsl}
      ${groundGlsl}
      ${fogGlsl}
      varying float vKind; varying vec3 vWorld;
      void main() {
        // Lawn: broad drifts of lighter and darker grass, fine blade-scale grain, faint mowing stripes.
        float drift = gfbm(vWorld.xz / 18.0);
        float grain = gfbm(vWorld.xz * 2.4);
        float stripe = 0.94 + 0.06 * sin(dot(vWorld.xz, vec2(0.8, 0.6)) * 0.9);
        vec3 grass = mix(vec3(0.009, 0.018, 0.010), vec3(0.016, 0.028, 0.012), drift) * (0.82 + 0.36 * grain) * stripe;
        vec3 field = mix(vec3(0.014, 0.028, 0.015), vec3(0.020, 0.034, 0.016), drift) * (0.85 + 0.3 * grain) * stripe;
        // Faint pitch markings.
        vec2 g = fract(vWorld.xz / 18.0);
        float lines = (1.0 - smoothstep(0.0, 0.03, min(g.x, g.y))) * 0.35;
        vec3 play = vec3(0.03, 0.022, 0.018) * (0.8 + 0.4 * grain);
        vec3 col = vKind < 0.5 ? grass : vKind < 1.5 ? field + vec3(0.03) * lines : play;
        gl_FragColor = vec4(applyFog(col, vWorld), 1.0);
      }
    `,
  });
  return new THREE.Mesh(geo, mat);
}

/** Footpaths (light pavers) and bike paths (asphalt, dashed centre line), with path lights. */
function createPaths(paths, uniforms, { camera, lampDistance, lampSpacing, isWater = () => false, heightAt = () => 0, shoreDistance = () => Infinity }) {
  const pos = [], arc = [], across = [], half = [], cyc = [];
  const lamps = [];
  for (const p of paths) {
    const pts = p.line;
    const w = p.cycle ? 1.8 : 1.4;
    const off = miterOffsets(pts, w);
    let cum = 0;
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
      const seg = Math.hypot(bx - ax, by - ay);
      if (seg < 0.3) continue;
      // Not over open water (a path ribbon painted across the creek reads as a glitch).
      if (isWater((ax + bx) / 2, (ay + by) / 2)) { cum += seg; continue; }
      const nx = (by - ay) / seg, ny = -(bx - ax) / seg;
      const [oa, ob] = [off[i - 1], off[i]];
      // Shared (mitered) edge vertices: the ribbon is continuous through bends.
      const v = [[ax - oa[0], ay - oa[1], cum, -w], [bx - ob[0], by - ob[1], cum + seg, -w], [bx + ob[0], by + ob[1], cum + seg, w], [ax + oa[0], ay + oa[1], cum, w]];
      for (const k of [0, 1, 2, 0, 2, 3]) {
        const [x, y, a, c] = v[k];
        // On or beside the seawall: ride the deck and its slope, so the path and the deck are one surface.
        pos.push(x, Math.max(0.1 + heightAt(x, y), deckHeight(shoreDistance(x, y)) + 0.03), -y); arc.push(a); across.push(c); half.push(w); cyc.push(p.cycle ? 1 : 0);
      }
      // Path lights (footpaths only), every lampSpacing metres along the arc.
      if (!p.cycle) {
        const first = Math.ceil(cum / lampSpacing) * lampSpacing;
        for (let s = first; s < cum + seg; s += lampSpacing) {
          const t = (s - cum) / seg, x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
          const d = Math.hypot(x - camera[0], y - camera[1]);
          if (d < lampDistance && d > 120) lamps.push({ p: [x + nx * 2, 3.5 + heightAt(x, y), -(y + ny * 2)], color: [3.2, 2.2, 1.2], size: 0.45 });
        }
      }
      cum += seg;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aArc', new THREE.Float32BufferAttribute(arc, 1));
  geo.setAttribute('aAcross', new THREE.Float32BufferAttribute(across, 1));
  geo.setAttribute('aHalf', new THREE.Float32BufferAttribute(half, 1));
  geo.setAttribute('aCycle', new THREE.Float32BufferAttribute(cyc, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...uniforms, uSpacing: { value: lampSpacing } },
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    vertexShader: /* glsl */ `
      attribute float aArc; attribute float aAcross; attribute float aHalf; attribute float aCycle;
      varying vec3 vWorld; varying float vArc; varying float vAcross; varying float vHalf; varying float vCycle;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz; vArc = aArc; vAcross = aAcross; vHalf = aHalf; vCycle = aCycle;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      ${skyGlsl}
      ${hashGlsl}
      ${groundGlsl}
      ${fogGlsl}
      uniform float uSpacing;
      varying vec3 vWorld; varying float vArc; varying float vAcross; varying float vHalf; varying float vCycle;
      void main() {
        float a = abs(vAcross);
        float edge = smoothstep(vHalf, vHalf - 0.3, a);
        // Pools of light under the path lights (footpaths), a soft general glow along bike paths.
        float along = mod(vArc, uSpacing);
        along = min(along, uSpacing - along); // distance to the nearest path light
        float pool = exp(-(along * along) / (2.0 * 4.0 * 4.0));
        vec3 warm = vec3(1.0, 0.68, 0.36);
        // Surface: paving slabs with joints and grain for footpaths; asphalt with a fine grit for bike paths.
        float grain = gfbm(vWorld.xz * 3.0);
        float joint = 1.0 - 0.22 * (1.0 - step(0.05, fract(vArc / 2.4))) * (1.0 - vCycle);
        vec3 pavers = vec3(0.07, 0.068, 0.065) * (0.78 + 0.4 * grain) * joint;
        vec3 asphalt = vec3(0.03, 0.031, 0.035) * (0.8 + 0.4 * grain);
        // A kerb along both edges, and a little wear down the middle.
        float kerb = smoothstep(vHalf - 0.55, vHalf - 0.3, a);
        float wear = 1.0 + 0.14 * (1.0 - a / vHalf);
        float dash = vCycle * (1.0 - smoothstep(0.06, 0.14, a)) * step(0.5, fract(vArc / 4.0));
        vec3 base = mix(pavers, asphalt, vCycle) * wear * (1.0 - 0.5 * kerb);
        vec3 col = base * 0.45 + base * warm * pool * mix(3.2, 1.6, vCycle) + vec3(0.25, 0.22, 0.12) * dash * (0.2 + pool);
        gl_FragColor = vec4(applyFog(col, vWorld), edge);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 2;
  return { mesh, lamps };
}

/**
 * Trees (added 2026-11-22, second pass): five kinds with their own silhouettes and size ranges: round broadleaf, layered
 * conifer, tall columnar, broad spreading and small ornamental, each tinted per tree (greens from yellow to blue, a share of
 * autumn gold and copper). A crown is a camera-facing card shaded as a rounded form with a ragged, leafy edge: smooth, no
 * facets, and a fraction of the triangles of a mesh. A dark trunk below; lit warm from below near the paths.
 */
const SPECIES = [
  // weight, height [min, span], crown radius [min, span], crown centre as a share of the height, half-height as a share, trunk share
  { weight: 0.36, h: [7, 8], r: [2.4, 2.4], centre: 0.62, half: 0.4, trunk: 0.42 }, // 0 round broadleaf
  { weight: 0.2, h: [10, 10], r: [1.8, 1.5], centre: 0.56, half: 0.44, trunk: 0.14 }, // 1 layered conifer
  { weight: 0.1, h: [9, 8], r: [1.1, 0.8], centre: 0.6, half: 0.42, trunk: 0.3 }, // 2 tall columnar
  { weight: 0.18, h: [6, 5], r: [4, 2.8], centre: 0.6, half: 0.28, trunk: 0.38 }, // 3 broad spreading
  { weight: 0.16, h: [3, 2.8], r: [1.4, 1.2], centre: 0.58, half: 0.4, trunk: 0.35 }, // 4 small ornamental
];

export function createTrees(trees, uniforms, { max, heightAt = () => 0 }) {
  const list = trees.slice(0, max);
  const n = list.length;
  const speciesAttr = new Float32Array(n), tintAttr = new Float32Array(n * 3);
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      attribute float aSpecies; attribute vec3 aTint;
      varying vec3 vWorld; varying vec2 vUv; varying float vSeed; varying float vSpecies; varying vec3 vTint;
      varying vec3 vRight; varying vec3 vUp; varying vec3 vBack;
      void main() {
        mat4 m = modelMatrix * instanceMatrix;
        vec3 c = m[3].xyz;
        float rx = length(m[0].xyz), ry = length(m[1].xyz);
        vRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        vBack = vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
        vUv = position.xy;
        vSeed = fract(sin(dot(c.xz, vec2(12.9898, 78.233))) * 43758.5453);
        vSpecies = aSpecies; vTint = aTint;
        // A crown stays upright (up = world up) so tall trees don't lean as the camera tilts down toward them.
        vec3 up = normalize(mix(vec3(0.0, 1.0, 0.0), vUp, 0.35));
        vec3 w = c + vRight * position.x * rx + up * position.y * ry;
        vWorld = w;
        gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${skyGlsl}
      ${hashGlsl}
      ${fogGlsl}
      varying vec3 vWorld; varying vec2 vUv; varying float vSeed; varying float vSpecies; varying vec3 vTint;
      varying vec3 vRight; varying vec3 vUp; varying vec3 vBack;
      float vnoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
      }
      void main() {
        vec2 u = vUv;
        if (vSeed > 0.5) u.x = -u.x; // mirror half of them: the ragged edges differ
        float sp = vSpecies;
        bool conifer = sp > 0.5 && sp < 1.5;
        float ang = atan(u.y, u.x);
        vec3 n;
        float shade = 1.0;
        if (conifer) {
          // Layered tiers: a tapering cone with a serrated edge, each tier a little narrower than the one below.
          float t = (1.0 - u.y) * 0.5; // 0 at the tip, 1 at the base
          float tier = fract(t * 6.0 + vSeed * 3.0);
          float width = (0.05 + 0.95 * t) * (0.72 + 0.28 * tier) * (0.94 + 0.12 * hash12(vec2(floor(t * 6.0), vSeed * 20.0)));
          if (abs(u.x) > width) discard;
          float nx = u.x / max(width, 0.05);
          n = normalize(vRight * nx + vBack * sqrt(max(1.0 - nx * nx, 0.0)) + vec3(0.0, 0.7, 0.0));
          shade = 0.55 + 0.45 * (0.4 + 0.6 * tier) * (0.7 + 0.3 * t);
        } else {
          float r2 = dot(u, u);
          float edge = 0.84 + 0.1 * hash12(vec2(floor(ang * 6.0), vSeed * 40.0)) + 0.06 * sin(ang * 11.0 + vSeed * 30.0);
          if (r2 > edge * edge) discard;
          vec3 nv = vec3(u, sqrt(max(1.0 - r2 / (edge * edge), 0.0)));
          n = normalize(vRight * nv.x + vUp * nv.y + vBack * nv.z);
        }
        float clump = 0.65 + 0.7 * vnoise(u * (conifer ? vec2(4.0, 9.0) : vec2(3.2)) + vSeed * 17.0);
        float fine = 0.88 + 0.24 * vnoise(u * 9.0 + vSeed * 5.0);
        vec3 leaf = conifer ? mix(vec3(0.006, 0.018, 0.016), vec3(0.010, 0.024, 0.017), vSeed) : mix(vec3(0.014, 0.026, 0.015), vec3(0.026, 0.034, 0.014), vSeed);
        leaf *= vTint * clump * fine * shade;
        float sky = 0.3 + 0.7 * max(n.y, 0.0);
        vec3 col = leaf * sky * vec3(0.8, 0.95, 1.2) * 1.6;
        // Warm light from the lamps below, on the underside.
        col += vec3(1.0, 0.62, 0.3) * 0.055 * smoothstep(0.2, -0.9, n.y) * (0.5 + vSeed) * shade;
        gl_FragColor = vec4(applyFog(col, vWorld), 1.0);
      }
    `,
  });
  const geo = new THREE.PlaneGeometry(2, 2);
  geo.setAttribute('aSpecies', new THREE.InstancedBufferAttribute(speciesAttr, 1));
  geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(tintAttr, 3));
  const crowns = new THREE.InstancedMesh(geo, mat, n);
  crowns.frustumCulled = false; // billboards: the bounding sphere of one quad is wrong for the whole set
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.3, 1, 5), new THREE.MeshLambertMaterial({ color: 0x120f0d }), n);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  let seed = 5;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  list.forEach(([x, y], i) => {
    // Pick a kind by weight.
    let pick = rand() * SPECIES.reduce((t, k) => t + k.weight, 0), id = 0;
    for (; id < SPECIES.length - 1; id++) { pick -= SPECIES[id].weight; if (pick <= 0) break; }
    const k = SPECIES[id];
    const bias = rand() * rand(); // most trees middling, a few tall giants
    const h = k.h[0] + k.h[1] * (0.25 + 0.75 * bias + 0.2 * rand()) , r = k.r[0] + k.r[1] * rand();
    speciesAttr[i] = id;
    // Tint: greens from yellow to blue; some autumn gold and copper (broadleaf kinds only).
    let t = [0.85 + rand() * 0.45, 0.85 + rand() * 0.4, 0.8 + rand() * 0.5];
    const dice = rand();
    if (id !== 1 && dice < 0.1) t = [2.1, 1.35, 0.3]; // gold
    else if (id !== 1 && id !== 2 && dice < 0.15) t = [1.9, 0.55, 0.4]; // copper
    else if (id === 1) t = [0.8 + rand() * 0.3, 0.9 + rand() * 0.3, 1.0 + rand() * 0.45]; // cooler blue-greens
    tintAttr.set(t, i * 3);
    const g = heightAt(x, y);
    q.setFromAxisAngle(up, rand() * 6.28);
    m.compose(new THREE.Vector3(x, g + h * k.centre, -y), q, new THREE.Vector3(r, h * k.half, 1));
    crowns.setMatrixAt(i, m);
    const th = Math.max(1.2, h * k.trunk), tw = id === 3 ? 1.7 : id === 1 ? 1.2 : 1;
    m.compose(new THREE.Vector3(x, g + th / 2, -y), q, new THREE.Vector3(tw, th, tw));
    trunks.setMatrixAt(i, m);
  });
  const group = new THREE.Group();
  group.add(crowns, trunks);
  return { group, count: n };
}

/** Lamp posts under the glowing lamp points: thin dark poles with a small head, so the lights aren't floating. */
export function createLampPosts(lamps, { height, near = () => true } = {}) {
  const list = lamps.filter((l) => near(l.p[0], -l.p[2]));
  const geo = new THREE.CylinderGeometry(0.06, 0.09, 1, 5);
  geo.translate(0, 0.5, 0);
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0x1b1a1e }), Math.max(1, list.length));
  mesh.count = list.length;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion();
  list.forEach((l, i) => mesh.setMatrixAt(i, m.compose(new THREE.Vector3(l.p[0], l.p[1] - height, l.p[2]), q, new THREE.Vector3(1, height, 1))));
  mesh.frustumCulled = false;
  return mesh;
}

export function createWaterfront(data, uniforms, { camera = [0, 0], maxTrees = 4000, lampDistance = 1600, lampSpacing = PATH_LAMP_SPACING, isWater, heightAt = () => 0, shoreDistance } = {}) {
  const group = new THREE.Group();
  group.add(createGreens(data.greens, uniforms, heightAt));
  const paths = createPaths(data.paths, uniforms, { camera, lampDistance, lampSpacing, isWater, heightAt, shoreDistance });
  group.add(paths.mesh);
  group.add(createLampPosts(paths.lamps, { height: 3.5, near: (x, y) => Math.hypot(x - camera[0], y - camera[1]) < 800 }));
  const trees = createTrees(data.trees, uniforms, { max: maxTrees, heightAt });
  group.add(trees.group);
  return { group, lamps: paths.lamps, stats: { greens: data.greens.length, paths: data.paths.length, pathLights: paths.lamps.length, trees: trees.count } };
}
