import * as THREE from 'three';
import { skyGlsl, hashGlsl, fogGlsl } from './shaders.js';
import { orientedExtents, centroid } from './skyline-data.js';

/**
 * Granville Island (added 2026-11-22): the old industrial sheds, painted in bold colours and lit warm at street level,
 * with a few market halls (a raised clerestory along the roof), and the Ocean Concrete silos at the east end.
 * Footprints and positions are from OpenStreetMap (the island is federal land, so the City data lacks it); the
 * shapes, colours and lighting are approximate. Scenery only, no hotspot.
 *
 * Local metres: x east, y north. Three.js world: X = x, Y = up, Z = -y.
 */

// Painted wall colours (dark linear albedo: they sit in blue-hour light): brick red, ochre, teal, cream, navy, green,
// corrugated grey, rust orange, slate blue, mustard.
const PALETTE = [
  [0.38, 0.4, 0.42], [0.45, 0.16, 0.12], [0.18, 0.3, 0.3], [0.58, 0.55, 0.49], [0.24, 0.28, 0.36],
  [0.26, 0.34, 0.22], [0.48, 0.36, 0.14], [0.4, 0.22, 0.12], [0.62, 0.6, 0.55], [0.62, 0.6, 0.55], [0.38, 0.4, 0.42],
];
const ROOF = [0.16, 0.17, 0.19];

const rng = (seed) => { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); };
const signedArea = (r) => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1]; return a / 2; };

/** Collects triangles: world-space positions, flat normals, an albedo, the wall direction and a kind per vertex. */
function createBuilder() {
  const pos = [], nrm = [], col = [], dir = [], kind = [], seed = [];
  return {
    /** A planar polygon face, given as world-space points (CCW or CW; the normal is computed). */
    tri(a, b, c, albedo, k, wallDir, s) {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      for (const p of [a, b, c]) { pos.push(...p); nrm.push(nx, ny, nz); col.push(...albedo); dir.push(...wallDir); kind.push(k); seed.push(s); }
    },
    quad(a, b, c, d, albedo, k, wallDir, s) { this.tri(a, b, c, albedo, k, wallDir, s); this.tri(a, c, d, albedo, k, wallDir, s); },
    geometry() {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
      g.setAttribute('aAlbedo', new THREE.Float32BufferAttribute(col, 3));
      g.setAttribute('aDir', new THREE.Float32BufferAttribute(dir, 2));
      g.setAttribute('aKind', new THREE.Float32BufferAttribute(kind, 1));
      g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1));
      g.computeBoundingSphere();
      return g;
    },
    get count() { return pos.length / 9; },
  };
}

/** Vertical walls around a ring (plan coords) from y0 to y1; windows/glow are drawn by the shader (kind 0). */
function walls(b, ring, y0, y1, albedo, seed, kind = 0) {
  const ccw = signedArea(ring) > 0;
  const r = ccw ? ring : ring.slice().reverse();
  for (let i = 0; i < r.length; i++) {
    const [ax, ay] = r[i], [bx, by] = r[(i + 1) % r.length];
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 0.05) continue;
    const d = [(bx - ax) / len, -(by - ay) / len]; // direction along the wall in world xz
    b.quad([ax, y0, -ay], [bx, y0, -by], [bx, y1, -by], [ax, y1, -ay], albedo, kind, d, seed);
  }
}

/** Flat cap for a ring at height y. */
function cap(b, ring, y, albedo, seed, kind = 1) {
  let idx;
  try { idx = THREE.ShapeUtils.triangulateShape(ring.map(([x, yy]) => new THREE.Vector2(x, yy)), []); } catch { return; }
  for (const [i, j, k] of idx) b.tri([ring[i][0], y, -ring[i][1]], [ring[j][0], y, -ring[j][1]], [ring[k][0], y, -ring[k][1]], albedo, kind, [1, 0], seed);
}

/** Corners of an oriented rectangle in plan: centre, long-axis angle, half-length a, half-width w. */
function rect(c, angle, a, w) {
  const ux = Math.cos(angle), uy = Math.sin(angle), vx = -uy, vy = ux;
  return [[c[0] - ux * a - vx * w, c[1] - uy * a - vy * w], [c[0] + ux * a - vx * w, c[1] + uy * a - vy * w], [c[0] + ux * a + vx * w, c[1] + uy * a + vy * w], [c[0] - ux * a + vx * w, c[1] - uy * a + vy * w]];
}

/** Gable roof over an oriented rectangle (ridge along the long axis), overhanging the walls a little like real eaves. */
function gable(b, c, angle, a, w, eave, rise, albedo, seed) {
  const ux = Math.cos(angle), uy = Math.sin(angle);
  const [p0, p1, p2, p3] = rect(c, angle, a, w);
  const r0 = [c[0] - ux * a, c[1] - uy * a], r1 = [c[0] + ux * a, c[1] + uy * a];
  const W = (p, y) => [p[0], y, -p[1]];
  // Roof planes: wider than the walls (side eaves 0.6 m, ends 0.4 m), sloping with the same pitch, so the eaves drop a little.
  const over = 0.6, drop = (rise / Math.max(w, 1)) * over;
  const [q0, q1, q2, q3] = rect(c, angle, a + 0.4, w + over);
  const s0 = [c[0] - ux * (a + 0.4), c[1] - uy * (a + 0.4)], s1 = [c[0] + ux * (a + 0.4), c[1] + uy * (a + 0.4)];
  b.quad(W(q0, eave - drop), W(q1, eave - drop), W(s1, eave + rise), W(s0, eave + rise), albedo, 1, [1, 0], seed);
  b.quad(W(q3, eave - drop), W(s0, eave + rise), W(s1, eave + rise), W(q2, eave - drop), albedo, 1, [1, 0], seed);
  const gab = (p, q, apex) => b.tri(W(p, eave), W(q, eave), W(apex, eave + rise), albedo, 0, [1, 0], seed); // gable ends (wall paint)
  gab(p0, p3, r0);
  gab(p1, p2, r1);
}

/** A small axis-aligned box (a vent, a chimney, a plant housing) standing on a roof. */
function roofBox(b, x, y, w, d, y0, y1, albedo, seed) {
  const pts = [[x - w / 2, y - d / 2], [x + w / 2, y - d / 2], [x + w / 2, y + d / 2], [x - w / 2, y + d / 2]];
  walls(b, pts, y0, y1, albedo, seed, 1);
  cap(b, pts, y1, [0.1, 0.1, 0.11], seed);
}

function createShedMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    uniforms,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute vec3 aAlbedo; attribute vec2 aDir; attribute float aKind; attribute float aSeed;
      varying vec3 vWorld; varying vec3 vNormal; varying vec3 vAlbedo; varying vec2 vDir; varying float vKind; varying float vSeed;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz; vNormal = normal; vAlbedo = aAlbedo; vDir = aDir; vKind = aKind; vSeed = aSeed;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      ${skyGlsl}
      ${hashGlsl}
      ${fogGlsl}
      varying vec3 vWorld; varying vec3 vNormal; varying vec3 vAlbedo; varying vec2 vDir; varying float vKind; varying float vSeed;
      void main() {
        vec3 n = normalize(vNormal);
        if (!gl_FrontFacing) n = -n;
        vec3 V = normalize(cameraPosition - vWorld);
        float isRoof = step(0.5, vKind) * step(vKind, 1.5);
        float isGlass = step(1.5, vKind);
        float roofish = max(isRoof, step(0.35, n.y));
        vec3 sky = skyColor(normalize(vec3(n.x, max(n.y, 0.15), n.z)));
        // Sky light from above, warm spill from the lamps and lit doorways near the ground.
        // Facing matters: the west afterglow lights walls that face it, the rest get cool sky light.
        float afterglow = max(dot(n, normalize(vec3(uSunDir.x, 0.15, uSunDir.z))), 0.0);
        vec3 col = vAlbedo * (0.16 + 0.55 * max(n.y, 0.0)) * vec3(0.5, 0.58, 0.8);
        col += vAlbedo * vec3(1.0, 0.6, 0.32) * 0.55 * afterglow * (1.0 - abs(n.y));
        col += vAlbedo * vec3(1.0, 0.68, 0.38) * 0.1 * (1.0 - abs(n.y)) * (0.45 + 0.9 * smoothstep(9.0, 0.5, vWorld.y));
        // Weathering: dirty at the foot of the wall, streaked below the eaves.
        col *= 1.0 - 0.35 * (1.0 - roofish) * smoothstep(2.0, 0.0, vWorld.y);
        col += sky * 0.5 * roofish * mix(0.1, 0.6, pow(1.0 - max(dot(n, V), 0.0), 4.0)); // metal roofs catch the sky
        // Walls: corrugation lines, then lit shopfront windows and doorways along the ground floor.
        float along = dot(vWorld.xz, vDir);
        float wall = 1.0 - roofish;
        col *= 1.0 - 0.18 * wall * step(0.5, fract(along * 1.6));
        float colCell = floor(along / 3.4);
        float inCol = step(abs(fract(along / 3.4) - 0.5), 0.3);
        float rowOk = step(1.0, vWorld.y) * step(vWorld.y, 3.6);
        float lit = step(0.32, hash12(vec2(colCell, floor(vSeed * 97.0)))) * inCol * rowOk * wall;
        float warm = hash12(vec2(colCell * 1.7, vSeed * 31.0));
        vec3 lamp = mix(vec3(1.0, 0.66, 0.34), vec3(0.85, 0.9, 1.0), step(0.86, warm));
        col = mix(col, lamp * (0.9 + 0.7 * warm), lit * 0.9);
        // Clerestory glass: an even warm glow with mullions.
        float mull = step(0.12, abs(fract(along / 2.2) - 0.5) * 2.0 - 0.0);
        col = mix(col, vec3(1.0, 0.72, 0.4) * 1.5 * (0.7 + 0.5 * mull), isGlass * 0.9);
        gl_FragColor = vec4(applyFog(col, vWorld), 1.0);
      }
    `,
  });
}

/** The Ocean Concrete silos: pale concrete cylinders with big blocks of painted colour, floodlit at the base. */
function createSilos(silos, uniforms) {
  const geo = new THREE.CylinderGeometry(1, 1, 1, 28, 1);
  geo.translate(0, 0.5, 0);
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      varying vec3 vWorld; varying vec3 vNormal; varying vec3 vCentre; varying float vTop;
      void main() {
        vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        vNormal = normalize(mat3(modelMatrix * instanceMatrix) * normal);
        vCentre = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        vTop = position.y;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      ${skyGlsl}
      ${hashGlsl}
      ${fogGlsl}
      varying vec3 vWorld; varying vec3 vNormal; varying vec3 vCentre; varying float vTop;
      vec3 paint(float id) {
        if (id < 0.15) return vec3(0.62, 0.62, 0.6);
        if (id < 0.3) return vec3(0.1, 0.28, 0.5);
        if (id < 0.45) return vec3(0.66, 0.5, 0.1);
        if (id < 0.6) return vec3(0.5, 0.12, 0.09);
        if (id < 0.75) return vec3(0.1, 0.38, 0.34);
        return vec3(0.7, 0.68, 0.62);
      }
      void main() {
        vec3 n = normalize(vNormal);
        vec2 r = vWorld.xz - vCentre.xz;
        float ang = atan(r.y, r.x);
        float h = vWorld.y;
        // Pale concrete with a few large painted patches (about one in three), a different pick per silo.
        float sector = floor((ang + 3.14159) / 6.28318 * 6.0);
        float band = floor(h / 11.0);
        float id = hash12(vec2(sector * 3.1 + floor(vCentre.x * 0.37), band * 5.3 + floor(vCentre.z * 0.21)));
        vec3 concrete = vec3(0.58, 0.58, 0.56);
        vec3 albedo = id > 0.66 ? paint((id - 0.66) / 0.34) * 0.8 : concrete;
        albedo *= 1.0 - 0.1 * step(0.95, fract(h / 3.3)); // pour lines
        // Round shading: afterglow side bright, shadow side cool and dark.
        float glow = max(dot(n, normalize(vec3(uSunDir.x, 0.1, uSunDir.z))), 0.0);
        vec3 col = albedo * (0.12 + 0.5 * max(n.y, 0.0)) * vec3(0.5, 0.58, 0.8);
        col += albedo * vec3(1.0, 0.6, 0.32) * 0.65 * glow * (1.0 - abs(n.y));
        // Floodlights from the yard: warm light on the lower third, fading up.
        col += albedo * vec3(1.0, 0.7, 0.42) * 0.6 * smoothstep(20.0, 0.0, h) * (1.0 - abs(n.y));
        col = mix(col, vec3(0.03, 0.032, 0.036), step(0.9, vTop) * step(0.7, n.y)); // dark cap
        gl_FragColor = vec4(applyFog(col, vWorld), 1.0);
      }
    `,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, silos.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion();
  silos.forEach((s, i) => {
    m.compose(new THREE.Vector3(s.c[0], 0, -s.c[1]), q, new THREE.Vector3(s.r, s.h, s.r));
    mesh.setMatrixAt(i, m);
  });
  return mesh;
}

/**
 * @param {{ buildings: {ring:number[][], h:number, base:number}[], silos: {c:number[], r:number, h:number}[] }} gi
 * @returns {{ group: THREE.Group, lights: object[], stats: object }}
 */
export function createGranville(gi, uniforms, { lightShare = 1 } = {}) {
  const group = new THREE.Group();
  group.name = 'granville';
  const lights = [];
  const rand = rng(2026);
  const b = createBuilder();

  gi.buildings.forEach((bd, i) => {
    const ring = bd.ring;
    if (ring.length < 3) return;
    const seed = rand();
    const area = Math.abs(signedArea(ring));
    const e = orientedExtents(ring);
    const rectArea = 4 * e.a * e.b;
    const albedo = PALETTE[Math.floor(rand() * PALETTE.length)].map((v) => v * 0.85);
    const eave = Math.max(4, bd.h);
    const isRect = area / (rectArea || 1) > 0.72 && e.b > 3 && e.a > 4;
    const c = centroid(ring);
    if (isRect && eave < 14) {
      const outline = rect(e.center, e.angle, e.a, e.b);
      walls(b, outline, 0, eave, albedo, seed);
      if (area > 900) {
        // A market hall: a row of parallel gabled bays (the stepped corrugated roofline), one with a glazed clerestory.
        const bays = Math.max(2, Math.round((2 * e.b) / 13));
        const bw = e.b / bays;
        const ux = Math.cos(e.angle), uy = Math.sin(e.angle), vx = -uy, vy = ux;
        for (let k = 0; k < bays; k++) {
          const off = -e.b + bw * (2 * k + 1);
          gable(b, [e.center[0] + vx * off, e.center[1] + vy * off], e.angle, e.a, bw, eave, Math.min(bw * 0.42, 2.8), ROOF, seed);
        }
        const cl = rect(e.center, e.angle, e.a * 0.7, 1.2);
        walls(b, cl, eave + 1.2, eave + 3.4, [0.2, 0.2, 0.22], seed, 2);
        cap(b, cl, eave + 3.4, ROOF, seed);
      } else if (area > 120) {
        gable(b, e.center, e.angle, e.a, e.b, eave, Math.min(e.b * 0.5, 3.4), ROOF, seed);
      } else {
        cap(b, outline, eave, ROOF, seed);
      }
    } else {
      walls(b, ring, 0, eave, albedo, seed);
      cap(b, ring, eave, ROOF, seed);
    }
    // Rooftop vents and chimneys on the bigger sheds (kept off the edges): small dark boxes, a few per roof.
    if (area > 160 && isRect) {
      const ux = Math.cos(e.angle), uy = Math.sin(e.angle);
      const vents = Math.min(4, 1 + Math.floor(area / 500));
      for (let k = 0; k < vents; k++) {
        const t = (rand() - 0.5) * 1.5 * e.a, sd = (rand() - 0.5) * 0.9 * e.b;
        const x = e.center[0] + ux * t - uy * sd, y = e.center[1] + uy * t + ux * sd;
        const top = eave + (area > 900 ? 2.6 : Math.min(e.b * 0.5, 3.4)) * (1 - Math.abs(sd) / e.b) * 0.9;
        roofBox(b, x, y, 0.7 + rand() * 0.8, 0.7 + rand() * 0.8, top - 0.3, top + 0.9 + rand() * 1.4, [0.2, 0.2, 0.22], seed);
      }
    }
    // Warm lights along the long walls (string lights, lanterns, shopfronts): the lit-up island look.
    if (area > 80) {
      const n = Math.min(6, 1 + Math.floor(e.a / 9));
      for (let k = 0; k < n; k++) {
        const t = ((k + 0.5) / n - 0.5) * 2 * e.a * 0.9, side = k % 2 ? 1 : -1;
        const px = Math.cos(e.angle) * t - Math.sin(e.angle) * (e.b + 0.8) * side, py = Math.sin(e.angle) * t + Math.cos(e.angle) * (e.b + 0.8) * side;
        lights.push({ p: [e.center[0] + px, 3.4, -(e.center[1] + py)], color: [3.6, 2.2, 1.0], size: 0.45 });
      }
    }
  });
  const sheds = new THREE.Mesh(b.geometry(), createShedMaterial(uniforms));
  sheds.name = 'granville-sheds';
  group.add(sheds);

  group.add(createSilos(gi.silos, uniforms));
  // Warm floodlights on the silo yard and a red obstruction light on the tallest silos.
  gi.silos.forEach((s, i) => {
    lights.push({ p: [s.c[0], 6, -s.c[1]], color: [5, 3.2, 1.6], size: 1.1 });
    if (i % 3 === 0) lights.push({ p: [s.c[0], s.h + 1.5, -s.c[1]], color: [8, 0.6, 0.4], size: 0.7, blink: (i * 0.37) % 1 });
  });
  return { group, lights, stats: { buildings: gi.buildings.length, silos: gi.silos.length, triangles: b.count, lights: lights.length } };
}
