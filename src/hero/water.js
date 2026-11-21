import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { skyGlsl, hashGlsl, fogGlsl } from './shaders.js';

/**
 * False Creek / Burrard Inlet: a planar mirror (re-renders the scene from below, at reduced resolution)
 * with procedural ripples and vertical streaks, the classic look of city lights on water at night.
 * Land vs water comes from a mask built by flood-filling the OSM shoreline.
 */

// Mask covers the OSM shoreline data (local metres). Outside it, simple rules (see shader).
export const MASK = { x0: -3600, x1: 3600, y0: -500, y1: 2860, metresPerPixel: 3 };

/**
 * Builds a land/water mask texture (255 water, 0 land, 128 shoreline).
 * The OSM coastline always has land on its left, and the lines are open where the data is clipped,
 * so instead of flood-filling we paint a thin land band on the left of every line and a water band
 * on the right, then give every other pixel the label of the nearest band (multi-source BFS).
 */
export function createWaterMask(shoreline) {
  const { x0, x1, y0, y1, metresPerPixel: mpp } = MASK;
  const W = Math.round((x1 - x0) / mpp), H = Math.round((y1 - y0) / mpp);
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const toPx = ([x, y]) => [(x - x0) / mpp, (y1 - y) / mpp];
  const offsetLine = (line, d) =>
    line.map((p, i) => {
      const a = line[Math.max(0, i - 1)], b = line[Math.min(line.length - 1, i + 1)];
      const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
      return [p[0] - (dy / len) * d, p[1] + (dx / len) * d]; // + d = left of travel
    });
  const stroke = (line, style, width) => {
    ctx.strokeStyle = style; ctx.lineWidth = width; ctx.beginPath();
    line.forEach((p, i) => (i ? ctx.lineTo(...toPx(p)) : ctx.moveTo(...toPx(p))));
    ctx.stroke();
  };
  ctx.imageSmoothingEnabled = false;
  for (const line of shoreline) {
    stroke(offsetLine(line, 2 * mpp), '#f00', 2.5); // land side
    stroke(offsetLine(line, -2 * mpp), '#00f', 2.5); // water side
  }
  const img = ctx.getImageData(0, 0, W, H).data;

  const label = new Uint8Array(W * H); // 0 unlabelled, 1 land, 2 water
  const queue = new Int32Array(W * H);
  let head = 0, tail = 0;
  for (let i = 0; i < W * H; i++) {
    const r = img[i * 4], b = img[i * 4 + 2], a = img[i * 4 + 3];
    if (a < 100) continue;
    label[i] = r > b ? 1 : 2;
    queue[tail++] = i;
  }
  while (head < tail) {
    const i = queue[head++];
    const x = i % W, y = (i / W) | 0;
    if (x > 0 && !label[i - 1]) { label[i - 1] = label[i]; queue[tail++] = i - 1; }
    if (x < W - 1 && !label[i + 1]) { label[i + 1] = label[i]; queue[tail++] = i + 1; }
    if (y > 0 && !label[i - W]) { label[i - W] = label[i]; queue[tail++] = i - W; }
    if (y < H - 1 && !label[i + W]) { label[i + W] = label[i]; queue[tail++] = i + W; }
  }
  // Remove thin land slivers (piers, stray clipped lines): a land pixel needs at least 5 land neighbours.
  for (let pass = 0; pass < 2; pass++) {
    const copy = label.slice();
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (copy[i] !== 1) continue;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) n += copy[i + dy * W + dx] === 1 ? 1 : 0;
      if (n < 6) label[i] = 2;
    }
  }
  // Texture rows go bottom-up (v = 0 at y0).
  const data = new Uint8Array(W * H);
  for (let row = 0; row < H; row++) {
    const src = (H - 1 - row) * W;
    for (let x = 0; x < W; x++) data[row * W + x] = label[src + x] === 2 ? 255 : 0;
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RedFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  // Region lookup for culling (local metres → 'land' | 'water').
  tex.userData.isWater = (x, y) => {
    const px = Math.floor((x - x0) / mpp), py = Math.floor((y1 - y) / mpp);
    if (px < 0 || py < 0 || px >= W || py >= H) return false;
    return label[py * W + px] === 2;
  };
  return tex;
}

export function createWater(uniforms, mask, { reflectionScale = 0.5, width = 1600, height = 900, pixelRatio = 1 } = {}) {
  // Reflector derives the mirror plane from the mesh's transform (local +Z = normal), so the
  // plane geometry stays in XY and the mesh itself is rotated flat.
  const geometry = new THREE.PlaneGeometry(14000, 8000);

  const shader = {
    uniforms: {
      color: { value: new THREE.Color(0xffffff) },
      tDiffuse: { value: null },
      textureMatrix: { value: null },
      uMask: { value: mask },
      uMaskRect: { value: new THREE.Vector4(MASK.x0, MASK.y0, MASK.x1, MASK.y1) },
      uTime: uniforms.uTime,
      uSunDir: uniforms.uSunDir,
      uFogDensity: uniforms.uFogDensity,
    },
    vertexShader: /* glsl */ `
      uniform mat4 textureMatrix;
      varying vec4 vUv;
      varying vec3 vWorld;
      void main() {
        vUv = textureMatrix * vec4(position, 1.0);
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      ${skyGlsl}
      ${hashGlsl}
      ${fogGlsl}
      uniform sampler2D tDiffuse;
      uniform sampler2D uMask;
      uniform vec4 uMaskRect;
      uniform float uTime;
      varying vec4 vUv;
      varying vec3 vWorld;

      // Is this point (local metres) water?
      float waterAt(vec2 p) {
        if (p.x > uMaskRect.x && p.x < uMaskRect.z && p.y > uMaskRect.y && p.y < uMaskRect.w) {
          vec2 uv = (p - uMaskRect.xy) / (uMaskRect.zw - uMaskRect.xy);
          return texture2D(uMask, uv).r;
        }
        // North of the mask: Burrard Inlet up to the North Shore, except Stanley Park.
        if (p.y >= uMaskRect.w) {
          float northShore = p.x < -2000.0 ? mix(5700.0, 6000.0, clamp((-2000.0 - p.x) / 1500.0, 0.0, 1.0))
                           : p.x < 1800.0 ? mix(5700.0, 4250.0, (p.x + 2000.0) / 3800.0)
                           : mix(4250.0, 3700.0, clamp((p.x - 1800.0) / 2200.0, 0.0, 1.0));
          bool stanleyPark = p.x < -700.0 && p.y < 4600.0;
          return (p.y < northShore && !stanleyPark) ? 1.0 : 0.0;
        }
        return 0.0;
      }

      // Small travelling ripples: gradient of a few sine waves plus noise.
      vec2 ripple(vec2 p, float t) {
        vec2 g = vec2(0.0);
        g += vec2(0.6, 0.8) * cos(dot(p, vec2(0.6, 0.8)) * 0.9 + t * 1.3);
        g += vec2(-0.7, 0.5) * cos(dot(p, vec2(-0.7, 0.5)) * 1.7 + t * 1.9) * 0.6;
        g += vec2(0.2, -1.0) * cos(dot(p, vec2(0.2, -1.0)) * 3.1 + t * 2.3) * 0.35;
        g += (vec2(hash12(floor(p * 0.6)), hash12(floor(p * 0.6) + 17.0)) - 0.5) * 0.6;
        return g;
      }

      void main() {
        vec2 local = vec2(vWorld.x, -vWorld.z);
        float w = waterAt(local);
        if (w < 0.5) discard;

        vec3 toCam = cameraPosition - vWorld;
        float dist = length(toCam);
        vec3 V = toCam / dist;

        // Ripples shrink with distance so far water reads calmer.
        vec2 rg = ripple(local * 1.6, uTime) * (1.0 / (1.0 + dist * 0.006));
        vec3 N = normalize(vec3(rg.x * 0.05, 1.0, rg.y * 0.05));
        float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);

        // Reflection: distorted by ripples, smeared vertically like light on moving water.
        vec4 uv = vUv;
        uv.x += rg.x * 0.0025 * uv.w;
        uv.y += rg.y * 0.004 * uv.w;
        vec3 refl = vec3(0.0);
        float wsum = 0.0;
        for (int k = -3; k <= 4; k++) {
          float fk = float(k);
          float wk = exp(-fk * fk * 0.12);
          refl += texture2DProj(tDiffuse, uv + vec4(0.0, fk * 0.009 * uv.w, 0.0, 0.0)).rgb * wk;
          wsum += wk;
        }
        refl /= wsum;

        vec3 deep = vec3(0.004, 0.008, 0.014);
        vec3 col = deep + refl * mix(0.35, 0.85, fres);
        gl_FragColor = vec4(applyFog(col, vWorld), 1.0);
      }
    `,
  };

  const water = new Reflector(geometry, {
    shader,
    textureWidth: Math.round(width * pixelRatio * reflectionScale),
    textureHeight: Math.round(height * pixelRatio * reflectionScale),
    clipBias: 0.003,
    multisample: 0, // the ripple blur hides aliasing; MSAA here would double the reflection cost
  });
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, 0, -3400); // spans local y -600 … 7400
  // Reflector clones its uniforms: re-link the shared ones so time and sky stay in sync.
  const u = water.material.uniforms;
  u.uMask.value = mask;
  u.uTime = uniforms.uTime;
  u.uSunDir = uniforms.uSunDir;
  u.uFogDensity = uniforms.uFogDensity;
  return water;
}

/** Ground under everything (seen through where the water shader discards: land). */
export function createGround(uniforms) {
  const g = new THREE.PlaneGeometry(40000, 40000);
  g.rotateX(-Math.PI / 2);
  g.translate(0, -0.4, -8000);
  const m = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }
    `,
    fragmentShader: /* glsl */ `
      ${skyGlsl}
      ${fogGlsl}
      varying vec3 vWorld;
      void main() { gl_FragColor = vec4(applyFog(vec3(0.016, 0.017, 0.02), vWorld), 1.0); }
    `,
  });
  return new THREE.Mesh(g, m);
}
