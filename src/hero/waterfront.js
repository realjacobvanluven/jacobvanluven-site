import * as THREE from 'three';
import { skyGlsl, hashGlsl, fogGlsl } from './shaders.js';
import { miterOffsets } from './ribbon.js';

/**
 * The waterfront and parks, the most visible ground in the shot (from OpenStreetMap via the data file):
 * lawns and sports fields, the seawall footpaths and bike paths with path lights, and the mapped trees.
 */

const PATH_LAMP_SPACING = 24;

/** Lawns (0), sports fields (1) and playgrounds (2) as flat polygons just above the ground. */
function createGreens(greens, uniforms) {
  const pos = [], kind = [];
  for (const g of greens) {
    const contour = g.ring.map(([x, y]) => new THREE.Vector2(x, y));
    let tris;
    try { tris = THREE.ShapeUtils.triangulateShape(contour, []); } catch { continue; }
    for (const t of tris) for (const i of t) { pos.push(g.ring[i][0], 0.06, -g.ring[i][1]); kind.push(g.kind); }
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
      ${fogGlsl}
      varying float vKind; varying vec3 vWorld;
      void main() {
        float n = hash12(floor(vWorld.xz / 4.0)) * 0.5 + hash12(floor(vWorld.xz / 13.0)) * 0.5;
        vec3 grass = vec3(0.010, 0.019, 0.011) * (0.75 + 0.5 * n);
        vec3 field = vec3(0.016, 0.030, 0.017) * (0.9 + 0.2 * n);
        // Faint pitch markings.
        vec2 g = fract(vWorld.xz / 18.0);
        float lines = (1.0 - smoothstep(0.0, 0.03, min(g.x, g.y))) * 0.35;
        vec3 play = vec3(0.03, 0.022, 0.018);
        vec3 col = vKind < 0.5 ? grass : vKind < 1.5 ? field + vec3(0.03) * lines : play;
        gl_FragColor = vec4(applyFog(col, vWorld), 1.0);
      }
    `,
  });
  return new THREE.Mesh(geo, mat);
}

/** Footpaths (light pavers) and bike paths (asphalt, dashed centre line), with path lights. */
function createPaths(paths, uniforms, { camera, lampDistance, lampSpacing, isWater = () => false }) {
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
        pos.push(x, 0.1, -y); arc.push(a); across.push(c); half.push(w); cyc.push(p.cycle ? 1 : 0);
      }
      // Path lights (footpaths only), every lampSpacing metres along the arc.
      if (!p.cycle) {
        const first = Math.ceil(cum / lampSpacing) * lampSpacing;
        for (let s = first; s < cum + seg; s += lampSpacing) {
          const t = (s - cum) / seg, x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
          const d = Math.hypot(x - camera[0], y - camera[1]);
          if (d < lampDistance && d > 120) lamps.push({ p: [x + nx * 2, 3.5, -(y + ny * 2)], color: [3.2, 2.2, 1.2], size: 0.45 });
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
      ${fogGlsl}
      uniform float uSpacing;
      varying vec3 vWorld; varying float vArc; varying float vAcross; varying float vHalf; varying float vCycle;
      void main() {
        float edge = smoothstep(vHalf, vHalf - 0.4, abs(vAcross));
        // Pools of light under the path lights (footpaths), a soft general glow along bike paths.
        float along = mod(vArc, uSpacing);
        along = min(along, uSpacing - along); // distance to the nearest path light
        float pool = exp(-(along * along) / (2.0 * 4.0 * 4.0));
        vec3 warm = vec3(1.0, 0.68, 0.36);
        vec3 pavers = vec3(0.07, 0.068, 0.065) * (0.85 + 0.3 * hash12(floor(vWorld.xz * 1.5)));
        vec3 asphalt = vec3(0.03, 0.031, 0.035);
        float dash = vCycle * (1.0 - smoothstep(0.06, 0.14, abs(vAcross))) * step(0.5, fract(vArc / 4.0));
        vec3 base = mix(pavers, asphalt, vCycle);
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
 * Trees: each crown is a camera-facing disc shaded as a sphere (smooth, no facets), with a ragged leafy edge and clumped
 * shading, so it reads as foliage rather than a faceted lump, at a fraction of the triangles of a mesh crown. A dark
 * trunk below. Lit warm from below near the paths.
 */
export function createTrees(trees, uniforms, { max }) {
  const list = trees.slice(0, max);
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      varying vec3 vWorld; varying vec2 vUv; varying float vSeed; varying float vRel;
      varying vec3 vRight; varying vec3 vUp; varying vec3 vBack;
      void main() {
        mat4 m = modelMatrix * instanceMatrix;
        vec3 c = m[3].xyz;
        float R = 0.5 * (length(m[0].xyz) + length(m[1].xyz));
        vRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        vBack = vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
        vUv = position.xy;
        vSeed = fract(sin(dot(c.xz, vec2(12.9898, 78.233))) * 43758.5453);
        vec3 w = c + (vRight * position.x + vUp * position.y) * R;
        vWorld = w;
        vRel = 0.0;
        gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${skyGlsl}
      ${hashGlsl}
      ${fogGlsl}
      varying vec3 vWorld; varying vec2 vUv; varying float vSeed; varying float vRel;
      varying vec3 vRight; varying vec3 vUp; varying vec3 vBack;
      float vnoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
      }
      void main() {
        float r2 = dot(vUv, vUv);
        float ang = atan(vUv.y, vUv.x);
        // Ragged edge: lumps of foliage around the rim.
        float edge = 0.84 + 0.1 * hash12(vec2(floor(ang * 6.0), vSeed * 40.0)) + 0.06 * sin(ang * 11.0 + vSeed * 30.0);
        if (r2 > edge * edge) discard;
        vec3 nv = vec3(vUv, sqrt(max(1.0 - r2 / (edge * edge), 0.0)));
        vec3 n = normalize(vRight * nv.x + vUp * nv.y + vBack * nv.z);
        // Leaf clumps: shading varies in patches across the crown.
        float clump = 0.65 + 0.7 * vnoise(vUv * 3.2 + vSeed * 17.0);
        float fine = 0.88 + 0.24 * vnoise(vUv * 9.0 + vSeed * 5.0);
        vec3 leaf = mix(vec3(0.014, 0.026, 0.015), vec3(0.026, 0.034, 0.014), vSeed) * clump * fine;
        float sky = 0.3 + 0.7 * max(n.y, 0.0);
        vec3 col = leaf * sky * vec3(0.8, 0.95, 1.2) * 1.6;
        // Warm light from the lamps below, on the underside.
        col += vec3(1.0, 0.62, 0.3) * 0.055 * smoothstep(0.2, -0.9, n.y) * (0.5 + vSeed);
        gl_FragColor = vec4(applyFog(col, vWorld), 1.0);
      }
    `,
  });
  const crowns = new THREE.InstancedMesh(new THREE.PlaneGeometry(2, 2), mat, list.length);
  crowns.frustumCulled = false; // billboards: the bounding sphere of one quad is wrong for the whole set
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.18, 0.28, 1, 5), new THREE.MeshLambertMaterial({ color: 0x120f0d }), list.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion();
  let seed = 5;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  list.forEach(([x, y], i) => {
    const h = 6 + rand() * 9, r = 2 + rand() * 2.6;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * 6.28);
    m.compose(new THREE.Vector3(x, h * 0.62, -y), q, new THREE.Vector3(r * 1.1, h * 0.38 * 1.15, r * 1.1));
    crowns.setMatrixAt(i, m);
    m.compose(new THREE.Vector3(x, h * 0.2, -y), q, new THREE.Vector3(1, h * 0.4, 1));
    trunks.setMatrixAt(i, m);
  });
  const group = new THREE.Group();
  group.add(crowns, trunks);
  return { group, count: list.length };
}

export function createWaterfront(data, uniforms, { camera = [0, 0], maxTrees = 4000, lampDistance = 1600, lampSpacing = PATH_LAMP_SPACING, isWater } = {}) {
  const group = new THREE.Group();
  group.add(createGreens(data.greens, uniforms));
  const paths = createPaths(data.paths, uniforms, { camera, lampDistance, lampSpacing, isWater });
  group.add(paths.mesh);
  const trees = createTrees(data.trees, uniforms, { max: maxTrees });
  group.add(trees.group);
  return { group, lamps: paths.lamps, stats: { greens: data.greens.length, paths: data.paths.length, pathLights: paths.lamps.length, trees: trees.count } };
}
