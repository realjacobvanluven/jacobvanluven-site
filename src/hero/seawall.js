import * as THREE from 'three';
import { skyGlsl, hashGlsl, fogGlsl } from './shaders.js';
import { miterOffsets, isIsland } from './ribbon.js';

/**
 * The seawall: a clean concrete edge along the shoreline, a paved path with warm pools of light under
 * a row of lamps, and a few trees. Hides the stair-stepped edge of the land/water mask.
 */

const LAMP_SPACING = 28; // m
const PATH_WIDTH = 5; // m, inland from the edge (wider strips overlap into blobs on tight curves)
const LAMP_INSET = 3.5; // m from the edge
const TOP = 1.6; // m above water
const EMBANKMENT = 2.2; // m, the slope from the deck edge down to the ground
/** The deck's profile, so other layers (the paths) can ride on it exactly: height above the water at distance d inland of the shoreline. */
export const deckHeight = (d) => (d <= PATH_WIDTH ? TOP : d >= PATH_WIDTH + EMBANKMENT ? 0 : TOP + (0.05 - TOP) * ((d - PATH_WIDTH) / EMBANKMENT));

/** Walks each shoreline polyline, calling fn(x, y, ux, uy, arc) every `spacing` metres (u = direction). */
function walk(line, spacing, offset, fn) {
  let arc = 0;
  let next = offset;
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1], [bx, by] = line[i];
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 1e-3) continue;
    const ux = (bx - ax) / len, uy = (by - ay) / len;
    while (next <= arc + len) {
      const s = next - arc;
      fn(ax + ux * s, ay + uy * s, ux, uy, next);
      next += spacing;
    }
    arc += len;
  }
}

export function createSeawall(shoreline, uniforms, { camera = [0, 0], maxDistance = 2600, treeDistance = 1600, isWater = () => false } = {}) {
  const near = (x, y, d) => Math.hypot(x - camera[0], y - camera[1]) < d;
  const pos = [], nrm = [], arcA = [], acrossA = [];
  const lamps = [];
  const trees = [];
  let seed = 99;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

  for (const line of shoreline) {
    if (!line.some(([x, y]) => near(x, y, maxDistance))) continue;
    if (isIsland(line)) continue; // natural islands get a rocky shore instead (islands.js)
    // Mitered inland edges (land is on the left): the deck and its sloping embankment stay continuous through bends.
    const inner = miterOffsets(line, PATH_WIDTH), outer = miterOffsets(line, PATH_WIDTH + EMBANKMENT);
    let arc = 0;
    for (let i = 1; i < line.length; i++) {
      const [ax, ay] = line[i - 1], [bx, by] = line[i];
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 1e-3) continue;
      if (!near(ax, ay, maxDistance) && !near(bx, by, maxDistance)) { arc += len; continue; }
      const ux = (bx - ax) / len, uy = (by - ay) / len;
      const lx = -uy, ly = ux; // land side (OSM coastline: land on the left)
      const W = (x, y, h) => [x, h, -y];
      // Wall face toward the water (normal = water side).
      const nx = uy, nz = ux; // world normal of the water-facing side: (x: uy, z: -(-ux)) = (uy, ux)
      const a = W(ax, ay, -0.8), b = W(bx, by, -0.8), c = W(bx, by, TOP), d = W(ax, ay, TOP);
      for (const v of [a, c, b, a, d, c]) { pos.push(...v); nrm.push(nx, 0, nz); arcA.push(v === a || v === d ? arc : arc + len); acrossA.push(-1); }
      // Path (flat, inland).
      const e = W(ax - inner[i - 1][0], ay - inner[i - 1][1], TOP), f = W(bx - inner[i][0], by - inner[i][1], TOP);
      for (const [v, ac, acr] of [[d, arc, 0], [c, arc + len, 0], [f, arc + len, PATH_WIDTH], [d, arc, 0], [f, arc + len, PATH_WIDTH], [e, arc, PATH_WIDTH]]) {
        pos.push(...v); nrm.push(0, 1, 0); arcA.push(ac); acrossA.push(acr);
      }
      // Embankment: the deck's inland edge slopes down to the ground instead of hanging in the air.
      const g = W(ax - outer[i - 1][0], ay - outer[i - 1][1], 0.05), h = W(bx - outer[i][0], by - outer[i][1], 0.05);
      for (const [v, ac, acr] of [[e, arc, PATH_WIDTH], [f, arc + len, PATH_WIDTH], [h, arc + len, PATH_WIDTH + EMBANKMENT], [e, arc, PATH_WIDTH], [h, arc + len, PATH_WIDTH + EMBANKMENT], [g, arc, PATH_WIDTH + EMBANKMENT]]) {
        pos.push(...v); nrm.push(0, 1, 0); arcA.push(ac); acrossA.push(acr);
      }
      arc += len;
    }
    // Lamps and trees along the same arc positions the shader uses for light pools.
    walk(line, LAMP_SPACING, LAMP_SPACING / 2, (x, y, ux, uy) => {
      const lx = x - uy * LAMP_INSET, ly = y + ux * LAMP_INSET;
      if (!near(lx, ly, maxDistance) || near(lx, ly, 60)) return;
      lamps.push({ p: [lx, 5.2, -ly], color: [6.5, 3.9, 1.8], size: 0.8 });
    });
    walk(line, 15, 7, (x, y, ux, uy) => {
      if (rand() > 0.5) return;
      const inset = 11 + rand() * 6;
      const tx = x - uy * inset, ty = y + ux * inset;
      if (!near(tx, ty, treeDistance) || near(tx, ty, 300) || isWater(tx, ty)) return; // none in the near foreground
      trees.push({ x: tx, y: ty, h: 6 + rand() * 5, r: 2.0 + rand() * 1.4 });
    });
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aArc', new THREE.Float32BufferAttribute(arcA, 1));
  g.setAttribute('aAcross', new THREE.Float32BufferAttribute(acrossA, 1));
  const material = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: { ...uniforms, uSpacing: { value: LAMP_SPACING }, uInset: { value: LAMP_INSET } },
    vertexShader: /* glsl */ `
      attribute float aArc;
      attribute float aAcross;
      varying vec3 vWorld; varying vec3 vNormal; varying float vArc; varying float vAcross;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz; vNormal = normal; vArc = aArc; vAcross = aAcross;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      ${skyGlsl}
      ${hashGlsl}
      ${fogGlsl}
      uniform float uSpacing; uniform float uInset;
      varying vec3 vWorld; varying vec3 vNormal; varying float vArc; varying float vAcross;
      void main() {
        vec3 warm = vec3(1.0, 0.6, 0.28);
        float along = mod(vArc, uSpacing) - uSpacing * 0.5;
        float isWall = step(vAcross, -0.5);
        float across = mix(vAcross - uInset, 3.0, isWall);
        float pool = exp(-(along * along + across * across) / (2.0 * 4.5 * 4.5));
        vec3 paving = vec3(0.05, 0.05, 0.055);
        vec3 concrete = vec3(0.13, 0.13, 0.135);
        // Wall: lit from above by the lamps, darker toward the waterline.
        float wallGrad = smoothstep(-0.8, 1.6, vWorld.y);
        vec3 wall = concrete * (0.08 + 0.5 * pool * wallGrad) * mix(vec3(0.6, 0.66, 0.85), warm, 0.6);
        vec3 path = paving * vec3(0.5, 0.55, 0.7) * 0.4 + paving * warm * pool * 2.4;
        vec3 col = mix(path, wall, isWall);
        gl_FragColor = vec4(applyFog(col, vWorld), 1.0);
      }
    `,
  });
  const group = new THREE.Group();
  group.add(new THREE.Mesh(g, material));

  if (trees.length) {
    const crown = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 1),
      new THREE.MeshLambertMaterial({ color: 0x24362a, emissive: new THREE.Color(0.03, 0.022, 0.012) }), // lamp-lit from below
      trees.length,
    );
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.25, 0.35, 1, 5), new THREE.MeshLambertMaterial({ color: 0x15110e }), trees.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    trees.forEach((t, i) => {
      m.compose(new THREE.Vector3(t.x, TOP + t.h * 0.62, -t.y), q, new THREE.Vector3(t.r, t.h * 0.42, t.r));
      crown.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(t.x, TOP + t.h * 0.2, -t.y), q, new THREE.Vector3(1, t.h * 0.4, 1));
      trunk.setMatrixAt(i, m);
    });
    group.add(crown, trunk);
  }
  return { group, lamps, stats: { lamps: lamps.length, trees: trees.length } };
}
