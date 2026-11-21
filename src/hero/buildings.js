import * as THREE from 'three';
import { skyGlsl, hashGlsl, fogGlsl } from './shaders.js';

/**
 * Buildings as merged prisms in ~400 m chunks (so off-screen chunks are frustum-culled), with one
 * facade shader: glass curtain walls or concrete, and lit windows generated per floor.
 *
 * Per-vertex attributes: aSeed (random per building), aKind (0 concrete, 1 glass), aTop (roof height).
 */

const CHUNK = 400; // m

/** Small deterministic PRNG so the city looks the same on every load. */
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function pushPrism(arrays, ring, base, top, seed, kind) {
  const { pos, nrm, seeds, kinds, tops } = arrays;
  const add = (x, y, z, nx, ny, nz) => {
    pos.push(x, y, z); nrm.push(nx, ny, nz); seeds.push(seed); kinds.push(kind); tops.push(top);
  };
  // Make the ring counter-clockwise (seen from above) so wall normals face outward.
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) area += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  const r = area < 0 ? ring.slice().reverse() : ring;
  // Walls (world: X = x, Z = -y).
  for (let i = 0; i < r.length; i++) {
    const [x0, y0] = r[i], [x1, y1] = r[(i + 1) % r.length];
    const ex = x1 - x0, ey = y1 - y0;
    const len = Math.hypot(ex, ey) || 1;
    const nx = ey / len, nz = ex / len; // outward normal (x, -y mapped to z)
    const a = [x0, base, -y0], b = [x1, base, -y1], c = [x1, top, -y1], d = [x0, top, -y0];
    for (const v of [a, b, c, a, c, d]) add(v[0], v[1], v[2], nx, 0, nz);
  }
  // Roof.
  const contour = r.map(([x, y]) => new THREE.Vector2(x, y));
  for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(contour, [])) {
    for (const idx of [i, j, k]) add(r[idx][0], top, -r[idx][1], 0, 1, 0);
  }
}

/**
 * @param {{ring:number[][], h:number, base:number, c:number[]}[]} buildings
 * @param {{ farDistance?: number, farMinHeight?: number }} lod  Drop low buildings far away: they're hidden or sub-pixel.
 */
export function createBuildings(buildings, uniforms, lod = {}) {
  const { farDistance = 1300, farMinHeight = 10 } = lod;
  const random = rng(20241121);
  const chunks = new Map();
  let kept = 0, dropped = 0;

  for (const b of buildings) {
    const seed = random();
    if (b.h - b.base < 1.5) { dropped++; continue; }
    if (Math.hypot(b.c[0], b.c[1]) > farDistance && b.h < farMinHeight) { dropped++; continue; }
    // Taller buildings are more often glass towers.
    const glassChance = b.h > 60 ? 0.7 : b.h > 25 ? 0.45 : 0.15;
    const kind = random() < glassChance ? 1 : 0;
    const key = `${Math.floor(b.c[0] / CHUNK)},${Math.floor(b.c[1] / CHUNK)}`;
    if (!chunks.has(key)) chunks.set(key, { pos: [], nrm: [], seeds: [], kinds: [], tops: [] });
    pushPrism(chunks.get(key), b.ring, b.base, b.h, seed, kind);
    kept++;
  }

  const material = createFacadeMaterial(uniforms);
  const group = new THREE.Group();
  let triangles = 0;
  for (const a of chunks.values()) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(a.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(a.nrm, 3));
    g.setAttribute('aSeed', new THREE.Float32BufferAttribute(a.seeds, 1));
    g.setAttribute('aKind', new THREE.Float32BufferAttribute(a.kinds, 1));
    g.setAttribute('aTop', new THREE.Float32BufferAttribute(a.tops, 1));
    g.computeBoundingSphere();
    triangles += a.pos.length / 9;
    group.add(new THREE.Mesh(g, material));
  }
  return { group, stats: { kept, dropped, chunks: chunks.size, triangles } };
}

export function createFacadeMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      attribute float aSeed;
      attribute float aKind;
      attribute float aTop;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying float vSeed;
      varying float vKind;
      varying float vTop;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        vSeed = aSeed; vKind = aKind; vTop = aTop;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      ${skyGlsl}
      ${hashGlsl}
      ${fogGlsl}
      uniform float uWindowIntensity;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying float vSeed;
      varying float vKind;
      varying float vTop;

      void main() {
        vec3 n = normalize(vNormal);
        vec3 V = normalize(cameraPosition - vWorld);
        float glass = step(0.5, vKind);
        vec3 westWarm = vec3(1.0, 0.45, 0.18);
        vec3 sunFlat = normalize(vec3(uSunDir.x, 0.0, uSunDir.z));

        // Roofs: dark, faint sky light.
        if (n.y > 0.5) {
          vec3 roof = vec3(0.018, 0.02, 0.026) * (0.7 + 0.6 * hash12(vec2(vSeed * 91.0, 3.0)));
          gl_FragColor = vec4(applyFog(roof, vWorld), 1.0);
          return;
        }

        // Facade grid: u runs along the wall, v up the building.
        vec2 t = normalize(vec2(-n.z, n.x));
        float u = dot(vWorld.xz, t);
        float floorH = mix(3.0, 3.6, glass);
        float colW = mix(2.4, 1.5, glass);
        vec2 g = vec2(u / colW, (vWorld.y - 0.6) / floorH);
        vec2 cell = floor(g);
        vec2 f = fract(g);

        // Window shape inside each cell (glass walls: almost all glass; concrete: punched windows).
        // Glass walls: tall panes with a dark spandrel band at each floor slab.
        vec2 lo = mix(vec2(0.2, 0.3), vec2(0.05, 0.26), glass);
        vec2 hi = mix(vec2(0.8, 0.8), vec2(0.95, 0.97), glass);
        vec2 fw = fwidth(g);
        vec2 aa = max(fw, vec2(0.001));
        vec2 m = smoothstep(lo - aa, lo + aa, f) * (1.0 - smoothstep(hi - aa, hi + aa, f));
        float windowArea = (hi.x - lo.x) * (hi.y - lo.y);
        float isWindow = m.x * m.y;

        // Lighting by room: neighbouring columns share a light; 30–50% of rooms lit per building.
        float litShare = mix(0.30, 0.50, hash12(vec2(vSeed * 13.1, 7.7)));
        vec2 room = vec2(floor(cell.x / 3.0), cell.y);
        float r1 = hash12(room + vSeed * 117.0);
        float r2 = hash12(room * 1.7 + vSeed * 53.0);
        float r3 = hash12(room * 2.3 + vSeed * 29.0);
        float lit = step(r1, litShare);
        // Some whole floors lit (offices working late), some dark.
        float fl = hash12(vec2(cell.y, vSeed * 71.0));
        lit = fl < 0.07 ? 1.0 : (fl > 0.9 ? 0.0 : lit);
        // Ground floor: shops and lobbies, mostly lit and brighter.
        float ground = 1.0 - step(1.0, cell.y);
        lit = max(lit, ground * step(r1, 0.7));
        // Don't light the band right under the roof (mechanical floors).
        lit *= step(vWorld.y + floorH * 0.9, vTop) + ground;
        vec3 warm = vec3(1.0, 0.6, 0.28);
        vec3 cool = vec3(0.75, 0.85, 1.0);
        vec3 lampCol = mix(warm, cool, step(0.75, r2)) * mix(0.2, 1.15, r3 * r3) * (1.0 + ground * 0.6);

        // Wall / glass base shading under blue-hour sky light.
        float skyAmb = 0.55 + 0.45 * n.y;
        float westFacing = max(dot(n, sunFlat), 0.0);
        vec3 concrete = vec3(0.11, 0.11, 0.115) * (0.7 + 0.6 * hash12(vec2(vSeed * 7.0, 1.0)));
        vec3 wallLit = concrete * skyAmb * vec3(0.55, 0.62, 0.85) + concrete * westWarm * westFacing * 0.18;

        // Glass: dark tinted, reflecting the sky with Fresnel.
        vec3 R = reflect(-V, n);
        R.y = abs(R.y) * 0.9 + 0.02; // reflections of the ground read as horizon haze
        float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
        vec3 tint = mix(vec3(0.010, 0.016, 0.022), vec3(0.016, 0.020, 0.018), hash12(vec2(vSeed * 3.0, 9.0)));
        vec3 glassCol = tint + skyColor(R) * mix(0.25, 0.9, fres);

        // Unlit windows on concrete are glass too; mullions on glass walls are dark metal.
        vec3 paneCol = glassCol;
        vec3 frameCol = mix(wallLit, vec3(0.02, 0.022, 0.026), glass);
        vec3 lampEmit = lampCol * uWindowIntensity * lit;
        vec3 windowCol = paneCol * (1.0 - lit * 0.85) + lampEmit;
        vec3 near = mix(frameCol, windowCol, isWindow);

        // Far away a window is smaller than a pixel: use the average instead of aliasing.
        float avgLit = mix(litShare, 1.0, ground * 0.7);
        vec3 avgEmit = lampCol * uWindowIntensity * avgLit * 0.9;
        vec3 far = mix(frameCol, paneCol * (1.0 - avgLit * 0.85) + avgEmit, windowArea);
        float farMix = smoothstep(0.35, 0.9, max(fw.x, fw.y));
        vec3 col = mix(near, far, farMix);

        gl_FragColor = vec4(applyFog(col, vWorld), 1.0);
      }
    `,
  });
}
