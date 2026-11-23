import * as THREE from 'three';
import { skyGlsl, hashGlsl, groundGlsl, fogGlsl } from './shaders.js';
import { isIsland, miterOffsets } from './ribbon.js';

/**
 * Small natural islands near the camera (Habitat Island, beside Hinge Park): a rocky shore, a planted interior and a
 * rock causeway to the mainland, instead of the paved seawall the city shoreline gets. Islands are the closed coastline
 * rings in the data; the causeways come from the data build (the shortest gap to the mainland).
 */

const CREST = 0.3; // m above the water plane: the top of the rock rim
const GROUND = 0.08; // the planted interior (paths are drawn at 0.1, just above it)

export function createIslands(shoreline, causeways, uniforms) {
  const pos = [], kind = [];
  const tri = (a, b, c, k) => { for (const v of [a, b, c]) { pos.push(...v); kind.push(k); } };
  const P = (x, y, h) => [x, h, -y];

  for (const line of shoreline) {
    if (!isIsland(line)) continue;
    // Rock rim: from below the waterline just off the coast, up to a crest a couple of metres inland.
    const toe = miterOffsets(line, -1.6), crest = miterOffsets(line, 2.2); // right offsets: negative = toward the water
    for (let i = 1; i < line.length; i++) {
      const [ax, ay] = line[i - 1], [bx, by] = line[i];
      const wa = [ax - toe[i - 1][0], ay - toe[i - 1][1]], wb = [bx - toe[i][0], by - toe[i][1]];
      const ca = [ax - crest[i - 1][0], ay - crest[i - 1][1]], cb = [bx - crest[i][0], by - crest[i][1]];
      const sa = P(wa[0], wa[1], -0.7), sb = P(wb[0], wb[1], -0.7), ta = P(ca[0], ca[1], CREST), tb = P(cb[0], cb[1], CREST);
      tri(sa, sb, tb, 0); tri(sa, tb, ta, 0);
    }
    // Interior.
    const ring = line.slice(0, -1);
    let idx;
    try { idx = THREE.ShapeUtils.triangulateShape(ring.map(([x, y]) => new THREE.Vector2(x, y)), []); } catch { idx = []; }
    for (const [i, j, k] of idx) tri(P(ring[i][0], ring[i][1], GROUND), P(ring[j][0], ring[j][1], GROUND), P(ring[k][0], ring[k][1], GROUND), 1);
  }

  // Causeways: a rock mound with a paved path along the top, following the mapped path across the water (a polyline), a few
  // metres past each end so it overlaps the shore.
  for (const line of causeways) {
    if (line.length < 2) continue;
    // Profile across the mound: [offset, height] from one toe to the other.
    const profile = [[-4, -0.7], [-2.3, CREST + 0.25], [-1, CREST + 0.3], [1, CREST + 0.3], [2.3, CREST + 0.25], [4, -0.7]];
    const rows = profile.map(([o]) => miterOffsets(line, o)); // right offsets: p + offset
    // The mound settles into the ground over the last 6 m at each end, so it meets the island and the shore without a ledge.
    const cum = [0];
    for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
    const total = cum[cum.length - 1];
    const settle = (i) => { const t = Math.min(1, Math.min(cum[i], total - cum[i]) / 6); return t * t * (3 - 2 * t); };
    const at = (i, k) => P(line[i][0] + rows[k][i][0] * (0.55 + 0.45 * settle(i)), line[i][1] + rows[k][i][1] * (0.55 + 0.45 * settle(i)), profile[k][1] * settle(i) + 0.08 * (1 - settle(i)));
    for (let i = 1; i < line.length; i++) for (let k = 0; k < 5; k++) {
      const kind2 = k === 2 ? 2 : 0;
      tri(at(i - 1, k), at(i, k), at(i, k + 1), kind2); tri(at(i - 1, k), at(i, k + 1), at(i - 1, k + 1), kind2);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aKind', new THREE.Float32BufferAttribute(kind, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute float aKind; varying vec3 vWorld; varying float vKind;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; vKind = aKind; gl_Position = projectionMatrix * viewMatrix * w; }
    `,
    fragmentShader: /* glsl */ `
      ${skyGlsl}
      ${hashGlsl}
      ${groundGlsl}
      ${fogGlsl}
      varying vec3 vWorld; varying float vKind;
      void main() {
        vec2 p = vWorld.xz;
        // Rock: rounded boulders with dark gaps between them (cellular), broad lighter and darker drifts across them.
        float cell = worley(p * 0.85);
        float stone = 1.0 - smoothstep(0.38, 0.66, cell);
        float drift = gfbm(p * 0.6);
        float grit = gfbm(p * 3.1);
        vec3 rock = mix(vec3(0.026, 0.026, 0.028), vec3(0.10, 0.094, 0.085), drift) * (0.45 + 0.7 * stone) * (0.8 + 0.4 * grit);
        // Planting: broad clumps of lighter and darker green, fine grain.
        float clump = gfbm(p / 5.0);
        vec3 plants = mix(vec3(0.010, 0.022, 0.012), vec3(0.022, 0.032, 0.014), clump) * (0.75 + 0.5 * grit);
        // Pavers (the causeway path): slabs with joints.
        vec2 sf = fract(p / 0.9);
        vec3 pavers = vec3(0.07, 0.068, 0.064) * (0.85 + 0.3 * grit) * (1.0 - 0.25 * (1.0 - smoothstep(0.0, 0.05, min(sf.x, sf.y))));
        vec3 base = vKind < 0.5 ? rock : vKind < 1.5 ? plants : pavers;
        // Cool sky light, and a little warm spill from the seawall lamps nearby.
        vec3 col = base * vec3(0.55, 0.62, 0.85) * 1.2 + base * vec3(1.0, 0.65, 0.35) * 0.35;
        gl_FragColor = vec4(applyFog(col, vWorld), 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'islands';
  return { group: mesh, stats: { triangles: pos.length / 9 } };
}
