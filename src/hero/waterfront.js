import * as THREE from 'three';
import { skyGlsl, hashGlsl, fogGlsl } from './shaders.js';

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
function createPaths(paths, uniforms, { camera, lampDistance, lampSpacing }) {
  const pos = [], arc = [], across = [], half = [], cyc = [];
  const lamps = [];
  for (const p of paths) {
    const pts = p.line;
    const w = p.cycle ? 1.8 : 1.4;
    let cum = 0;
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
      const seg = Math.hypot(bx - ax, by - ay);
      if (seg < 0.3) continue;
      const nx = (by - ay) / seg, ny = -(bx - ax) / seg;
      const v = [[ax - nx * w, ay - ny * w, cum, -w], [bx - nx * w, by - ny * w, cum + seg, -w], [bx + nx * w, by + ny * w, cum + seg, w], [ax + nx * w, ay + ny * w, cum, w]];
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

/** Mapped trees: low-poly crowns with a dark trunk, lit warm from below near the paths. */
export function createTrees(trees, uniforms, { max }) {
  const list = trees.slice(0, max);
  const crownGeo = new THREE.IcosahedronGeometry(1, 1);
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      varying vec3 vWorld; varying vec3 vNormal; varying float vSeed; varying float vRel;
      void main() {
        vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        vNormal = normalize(mat3(modelMatrix * instanceMatrix) * normal);
        vSeed = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
        vRel = position.y; // -1 bottom … 1 top of the crown
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      ${skyGlsl}
      ${fogGlsl}
      varying vec3 vWorld; varying vec3 vNormal; varying float vSeed; varying float vRel;
      void main() {
        vec3 n = normalize(vNormal);
        vec3 leaf = mix(vec3(0.012, 0.022, 0.014), vec3(0.02, 0.026, 0.012), vSeed);
        float sky = 0.35 + 0.65 * max(n.y, 0.0);
        vec3 col = leaf * sky * vec3(0.7, 0.8, 1.0);
        // Warm light from the lamps below, on the underside.
        col += vec3(1.0, 0.62, 0.3) * 0.045 * smoothstep(0.3, -1.0, vRel) * (0.5 + vSeed);
        gl_FragColor = vec4(applyFog(col, vWorld), 1.0);
      }
    `,
  });
  const crowns = new THREE.InstancedMesh(crownGeo, mat, list.length);
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.18, 0.28, 1, 5), new THREE.MeshLambertMaterial({ color: 0x120f0d }), list.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion();
  let seed = 5;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  list.forEach(([x, y], i) => {
    const h = 6 + rand() * 9, r = 2 + rand() * 2.6;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * 6.28);
    m.compose(new THREE.Vector3(x, h * 0.62, -y), q, new THREE.Vector3(r, h * 0.38, r * (0.85 + rand() * 0.3)));
    crowns.setMatrixAt(i, m);
    m.compose(new THREE.Vector3(x, h * 0.2, -y), q, new THREE.Vector3(1, h * 0.4, 1));
    trunks.setMatrixAt(i, m);
  });
  const group = new THREE.Group();
  group.add(crowns, trunks);
  return { group, count: list.length };
}

export function createWaterfront(data, uniforms, { camera = [0, 0], maxTrees = 4000, lampDistance = 1600, lampSpacing = PATH_LAMP_SPACING } = {}) {
  const group = new THREE.Group();
  group.add(createGreens(data.greens, uniforms));
  const paths = createPaths(data.paths, uniforms, { camera, lampDistance, lampSpacing });
  group.add(paths.mesh);
  const trees = createTrees(data.trees, uniforms, { max: maxTrees });
  group.add(trees.group);
  return { group, lamps: paths.lamps, stats: { greens: data.greens.length, paths: data.paths.length, pathLights: paths.lamps.length, trees: trees.count } };
}
