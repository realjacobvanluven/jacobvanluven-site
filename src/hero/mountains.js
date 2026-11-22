import * as THREE from 'three';
import { skyGlsl, hashGlsl, fogGlsl } from './shaders.js';

/**
 * North Shore mountains: a light procedural heightfield shaped around the real peaks (positions and
 * heights below), with forest-dark slopes, snow-dusted tops and heavy atmospheric haze.
 * Can be swapped for real CDEM elevation data later if that stays light enough.
 */

const ORIGIN = { lat: 49.27175, lon: -123.1078 };
const M_LAT = 111320;
const M_LON = M_LAT * Math.cos((ORIGIN.lat * Math.PI) / 180);
const local = (lat, lon) => [(lon - ORIGIN.lon) * M_LON, (lat - ORIGIN.lat) * M_LAT];

// Summit elevations in metres.
const PEAKS = [
  ['Grouse Mountain', 49.3808, -123.0814, 1231, 2600],
  ['Mount Fromme', 49.3794, -123.0581, 1185, 2400],
  ['Lynn Peak', 49.3664, -123.0172, 1015, 2200],
  ['Mount Seymour', 49.3667, -122.9461, 1449, 3200],
  ['Hollyburn Mountain', 49.3803, -123.1953, 1325, 3000],
  ['Black Mountain', 49.3878, -123.2364, 1217, 3000],
  ['Crown Mountain', 49.4111, -123.0927, 1504, 2400],
  ['Goat Mountain', 49.4140, -123.0700, 1401, 2200],
  ['West Lion', 49.4578, -123.1856, 1646, 1300],
  ['East Lion', 49.4595, -123.1790, 1606, 1300],
  ['Mount Strachan', 49.4100, -123.2050, 1454, 2600],
  ['Cathedral Mountain', 49.4836, -123.0386, 1737, 3000],
  ['Coliseum Mountain', 49.4285, -123.0255, 1446, 2600],
].map(([name, lat, lon, h, r]) => ({ name, p: local(lat, lon), h, r }));

/** North Shore shoreline (local y) as a function of x, matching the water shader. */
export function northShore(x) {
  if (x < -2000) return 5700 + 300 * Math.min(1, (-2000 - x) / 1500);
  if (x < 1800) return 5700 + (4250 - 5700) * ((x + 2000) / 3800);
  return 4250 + (3700 - 4250) * Math.min(1, (x - 1800) / 2200);
}

function noise2(x, y) {
  // Cheap smooth value noise.
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const h = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return (h(xi, yi) * (1 - u) + h(xi + 1, yi) * u) * (1 - v) + (h(xi, yi + 1) * (1 - u) + h(xi + 1, yi + 1) * u) * v;
}

export function terrainHeight(x, y) {
  const shore = northShore(x);
  const inland = y - shore;
  if (inland < 0) return -6;
  // Foothills rising from the shore, then the peaks.
  let h = Math.min(1, inland / 7000) ** 1.3 * 650;
  for (const pk of PEAKS) {
    const d2 = (x - pk.p[0]) ** 2 + (y - pk.p[1]) ** 2;
    // Exponential falloff gives sharper, more mountain-like summits than a Gaussian.
    const d = Math.sqrt(d2);
    const shape = 0.7 * Math.exp(-d2 / (2 * pk.r * pk.r)) + 0.3 * Math.exp(-d / (pk.r * 0.9));
    h = Math.max(h, pk.h * shape + h * 0.25);
  }
  // Ridges and gullies.
  let n = 0, amp = 1, freq = 1 / 2200;
  for (let o = 0; o < 5; o++) { n += (1 - Math.abs(noise2(x * freq + o * 7.3, y * freq) * 2 - 1)) ** 2 * amp; amp *= 0.5; freq *= 2.2; }
  h += (n - 0.55) * 380 * Math.min(1, inland / 2500);
  return Math.max(h * Math.min(1, inland / 900), 2);
}

/** Bilinear height lookup on the real elevation grid (local metres). */
export function demHeightAt(dem, x, y) {
  const fx = (x - dem.x0) / dem.step, fy = (y - dem.y0) / dem.step;
  const ix = Math.max(0, Math.min(dem.cols - 2, Math.floor(fx))), iy = Math.max(0, Math.min(dem.rows - 2, Math.floor(fy)));
  const ax = Math.min(1, Math.max(0, fx - ix)), ay = Math.min(1, Math.max(0, fy - iy));
  const h = (c, r) => dem.heights[r * dem.cols + c];
  return (h(ix, iy) * (1 - ax) + h(ix + 1, iy) * ax) * (1 - ay) + (h(ix, iy + 1) * (1 - ax) + h(ix + 1, iy + 1) * ax) * ay;
}

/**
 * North Shore mountains. With `dem` (real elevation grid from the data file) the mesh follows the actual
 * terrain; without it, the procedural range above is used. `stride` skips grid points on low tiers.
 */
export function createMountains(uniforms, { dem = null, stride = 1, segmentsX = 180, segmentsY = 110, verticalScale = 1 } = {}) {
  let g;
  if (dem) {
    const cols = Math.floor((dem.cols - 1) / stride) + 1, rows = Math.floor((dem.rows - 1) / stride) + 1;
    const span = [(cols - 1) * stride * dem.step, (rows - 1) * stride * dem.step];
    g = new THREE.PlaneGeometry(span[0], span[1], cols - 1, rows - 1);
    g.rotateX(-Math.PI / 2);
    g.translate(dem.x0 + span[0] / 2, 0, -(dem.y0 + span[1] / 2));
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, demHeightAt(dem, pos.getX(i), -pos.getZ(i)));
  } else {
    const x0 = -16000, x1 = 16000, y0 = 3400, y1 = 26000;
    g = new THREE.PlaneGeometry(x1 - x0, y1 - y0, segmentsX, segmentsY);
    g.rotateX(-Math.PI / 2);
    g.translate((x0 + x1) / 2, 0, -(y0 + y1) / 2);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, terrainHeight(pos.getX(i), -pos.getZ(i)));
  }
  g.computeVertexNormals();

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying float vElevation; // real elevation (before any vertical exaggeration)
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz; vNormal = normalize(mat3(modelMatrix) * normal); vElevation = position.y;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      ${skyGlsl}
      ${hashGlsl}
      uniform float uMountainHaze;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying float vElevation;
      void main() {
        vec3 n = normalize(vNormal);
        vec3 sunFlat = normalize(vec3(uSunDir.x, 0.0, uSunDir.z));
        // Snow above ~1100 m, patchy, mostly on gentler slopes.
        float snowPatch = hash12(floor(vWorld.xz / 50.0)) * 160.0;
        float snow = smoothstep(1050.0, 1200.0, vElevation + snowPatch) * smoothstep(0.5, 0.85, n.y);
        vec3 forest = vec3(0.0025, 0.0045, 0.0065);
        vec3 snowCol = vec3(0.07, 0.06, 0.08);           // faintly pink in the afterglow
        vec3 base = mix(forest, snowCol, snow);
        float sky = 0.55 + 0.45 * n.y;
        float west = max(dot(n, sunFlat), 0.0);
        vec3 col = base * sky * vec3(0.8, 0.85, 1.0) + base * vec3(1.0, 0.5, 0.45) * west * (0.5 + snow * 1.2);
        // Light haze with distance, a little more low down; toward a darkened horizon colour so the
        // range stays a dark silhouette under the brighter sky.
        vec3 v = vWorld - cameraPosition;
        float dist = length(v);
        float haze = 1.0 - exp(-dist * uMountainHaze);
        haze = clamp(haze + (1.0 - smoothstep(0.0, 600.0, vElevation)) * 0.08, 0.0, 0.9);
        gl_FragColor = vec4(mix(col, hazeColor(v / dist) * 0.45, haze), 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(g, material);
  mesh.scale.y = verticalScale;
  return mesh;
}

/** Scattered house and street lights on the lower North Shore slopes (North and West Vancouver). */
export function northShoreLightPoints(count = 2600, heightAt = terrainHeight, seed = 7) {
  let s = seed;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const pts = [];
  let guard = 0;
  while (pts.length < count && guard++ < count * 30) {
    const x = -8000 + rand() * 16000;
    const y = 3300 + rand() * 7000;
    const h = heightAt(x, y);
    // On land, dense near the shore, thinning up the slopes; none above ~450 m.
    if (h < 3 || h > 450 || rand() > 1 - h / 480) continue;
    pts.push([x, h + 3, -y]);
  }
  return pts;
}
