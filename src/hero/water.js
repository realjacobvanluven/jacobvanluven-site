import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { skyGlsl, hashGlsl, groundGlsl, fogGlsl } from './shaders.js';

/**
 * False Creek / Burrard Inlet: a planar mirror (re-renders the scene from below at reduced resolution)
 * with small ripples and vertical streaks, the look of city lights on water at night.
 * Land vs water comes from the mask precomputed in scripts/build-skyline-data.mjs.
 */

export function createMaskTexture(mask) {
  const tex = new THREE.DataTexture(mask.data, mask.width, mask.height, THREE.RedFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

export function createWater(uniforms, mask, { reflectionScale = 0.5, width = 1600, height = 900, pixelRatio = 1, streakTaps = 8 } = {}) {
  // Reflector derives the mirror plane from the mesh's transform (local +Z = normal), so the
  // plane geometry stays in XY and the mesh itself is rotated flat.
  const geometry = new THREE.PlaneGeometry(14000, 8000);
  const maskTex = createMaskTexture(mask);

  const shader = {
    uniforms: {
      color: { value: new THREE.Color(0xffffff) },
      tDiffuse: { value: null },
      textureMatrix: { value: null },
      uMask: { value: null },
      uMaskRect: { value: new THREE.Vector4(mask.x0, mask.y0, mask.x1, mask.y1) },
      uTime: { value: 0 },
      uSunDir: { value: null },
      uFogDensity: { value: 0 },
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
      #define STREAK_TAPS ${Math.max(2, Math.round(streakTaps))}
      ${skyGlsl}
      ${hashGlsl}
      ${fogGlsl}
      uniform sampler2D tDiffuse;
      uniform sampler2D uMask;
      uniform vec4 uMaskRect;
      uniform float uTime;
      varying vec4 vUv;
      varying vec3 vWorld;

      // Water inside the mask; north of it is Burrard Inlet (the North Shore terrain covers the land there).
      float waterAt(vec2 p) {
        if (p.y >= uMaskRect.w) return 1.0;
        if (p.x > uMaskRect.x && p.x < uMaskRect.z && p.y > uMaskRect.y) {
          return texture2D(uMask, (p - uMaskRect.xy) / (uMaskRect.zw - uMaskRect.xy)).r;
        }
        return 0.0;
      }

      // Surface slope (dh/dx, dh/dz) from a few travelling wave trains, ~30 m down to ~2.5 m long.
      // Each train fades out once it gets smaller than a couple of pixels, so distant water stays calm
      // instead of shimmering.
      vec2 waveSlope(vec2 p, float t, float pixelMetres) {
        vec2 g = vec2(0.0);
        // direction, wavelength (m), speed (m/s), steepness
        vec4 w[6];
        w[0] = vec4(normalize(vec2(0.8, 0.6)), 31.0, 1.6);
        w[1] = vec4(normalize(vec2(-0.5, 0.9)), 17.0, 1.2);
        w[2] = vec4(normalize(vec2(0.95, -0.3)), 9.5, 0.9);
        w[3] = vec4(normalize(vec2(-0.85, -0.5)), 5.3, 0.7);
        w[4] = vec4(normalize(vec2(0.3, 1.0)), 3.4, 0.55);
        w[5] = vec4(normalize(vec2(-0.2, -1.0)), 2.4, 0.45);
        float steep[6];
        steep[0] = 0.025; steep[1] = 0.035; steep[2] = 0.05; steep[3] = 0.06; steep[4] = 0.06; steep[5] = 0.055;
        for (int i = 0; i < 6; i++) {
          float k = 6.2831853 / w[i].z;
          float fade = 1.0 - smoothstep(0.25, 0.6, pixelMetres / w[i].z);
          g += w[i].xy * cos(dot(p, w[i].xy) * k - t * w[i].w * k + float(i) * 1.7) * steep[i] * fade;
        }
        return g;
      }

      void main() {
        vec2 local = vec2(vWorld.x, -vWorld.z);
        if (waterAt(local) < 0.5) discard;

        vec3 toCam = cameraPosition - vWorld;
        float dist = length(toCam);
        vec3 V = toCam / dist;
        float pixelMetres = length(fwidth(local));               // size of one pixel on the water here
        vec2 slope = waveSlope(local, uTime, pixelMetres);
        vec3 N = normalize(vec3(-slope.x, 1.0, slope.y));          // world z = -local y
        float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);

        // Ripples wobble the reflection: strongest close to the camera, gentler far away.
        vec4 uv = vUv;
        // Far water (Burrard Inlet, 2–4 km out) stays nearly still and its streaks short, otherwise the
        // North Shore lights smear into a glowing wall.
        float wobble = clamp(260.0 / dist, 0.03, 1.0);
        float streak = 0.009 * clamp(500.0 / dist, 0.12, 1.0);
        uv.x += slope.x * 0.045 * wobble * uv.w;
        uv.y += slope.y * 0.08 * wobble * uv.w;
        vec3 refl = vec3(0.0);
        float wsum = 0.0;
        for (int k = -3; k <= 4; k++) {
          float fk = float(k);
          float wk = exp(-fk * fk * 0.12);
          refl += texture2DProj(tDiffuse, uv + vec4(0.0, fk * streak * uv.w, 0.0, 0.0)).rgb * wk;
          wsum += wk;
        }
        refl /= wsum;

        vec3 deep = vec3(0.003, 0.007, 0.013);
        vec3 col = deep + refl * mix(0.35, 0.85, fres) * mix(1.0, 0.6, smoothstep(1500.0, 3500.0, dist));

        // Long light streaks: rippled water reflects a bright light over a wide spread of slopes, so each light
        // stretches into a broken column toward the viewer. A planar reflection is sampled at the pixel's own
        // screen position, so looking further up the reflection (toward the light's mirror image) pulls it down
        // over this pixel. Only bright samples count (windows, lamps, BC Place's ring, the afterglow), so dark
        // facades don't smear. Shorter far away, so the North Shore lights don't become a glowing wall.
        float sLen = 0.34 * clamp(380.0 / dist, 0.15, 1.0);
        float jitter = hash12(gl_FragCoord.xy); // dither between taps (no ghost copies); fixed, so it doesn't fizz
        vec3 hi = vec3(0.0);
        float hsum = 0.0;
        for (int k = 0; k < STREAK_TAPS; k++) {
          float fk = (float(k) + jitter) / float(STREAK_TAPS);
          // Sideways sway that changes along the column and slowly over time: wavy, not ruler-straight.
          float sway = sin(vWorld.z * 0.22 + fk * 7.0 + uTime * 0.5) * 0.0035 * wobble + slope.x * 0.03;
          vec3 smp = texture2DProj(tDiffuse, uv + vec4(sway * uv.w, fk * sLen * uv.w, 0.0, 0.0)).rgb;
          float l = dot(smp, vec3(0.299, 0.587, 0.114));
          float wk = 1.0 - 0.55 * fk; // fades with distance from the light
          hi += smp * smoothstep(0.12, 0.6, l) * wk;
          hsum += wk;
        }
        hi /= hsum;
        // Break the columns into shimmering bands: ripple crests that catch the light, drifting slowly. When
        // a band is smaller than a pixel, use its average.
        float crest = sin(dot(local, vec2(0.18, 1.0)) * 1.25 + slope.y * 30.0 + uTime * 0.7);
        crest = mix(0.08 + 0.92 * smoothstep(0.35, 0.95, crest), 0.3, smoothstep(0.4, 1.6, pixelMetres));
        col += hi * crest * 0.85 * mix(1.0, 0.5, smoothstep(1200.0, 3000.0, dist));
        // Glints: tiny shimmering highlights where ripples catch a bright reflection.
        float lum = dot(refl, vec3(0.299, 0.587, 0.114));
        vec2 gp = local * 2.2 + vec2(uTime * 0.7, -uTime * 0.45);
        float g = hash12(floor(gp));
        float glint = step(0.982, g) * smoothstep(0.06, 0.5, lum) * (0.5 + 0.5 * sin(uTime * 7.0 + g * 60.0));
        col += refl * glint * 4.0 / (1.0 + dist * 0.0015);
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
  // Reflector clones its uniforms: link the shared ones so time and sky stay in sync.
  const u = water.material.uniforms;
  u.uMask.value = maskTex;
  u.uTime = uniforms.uTime;
  u.uSunDir = uniforms.uSunDir;
  u.uFogDensity = uniforms.uFogDensity;

  /** Adaptive quality: resize the reflection render target. */
  water.setReflectionSize = (w, h) => water.getRenderTarget().setSize(Math.max(64, Math.round(w)), Math.max(64, Math.round(h)));
  return water;
}

/** Ground under everything (seen where the water shader discards: land). */
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
      ${hashGlsl}
      ${groundGlsl}
      ${fogGlsl}
      varying vec3 vWorld;
      void main() {
        vec3 base = groundColor(vWorld.xz);
        gl_FragColor = vec4(applyFog(base, vWorld), 1.0);
      }
    `,
  });
  return new THREE.Mesh(g, m);
}
