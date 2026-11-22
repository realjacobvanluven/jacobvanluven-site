import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { skyGlsl, hashGlsl, fogGlsl } from './shaders.js';

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

export function createWater(uniforms, mask, { reflectionScale = 0.5, width = 1600, height = 900, pixelRatio = 1 } = {}) {
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
        if (waterAt(local) < 0.5) discard;

        vec3 toCam = cameraPosition - vWorld;
        float dist = length(toCam);
        vec3 V = toCam / dist;
        vec2 rg = ripple(local * 1.6, uTime) * (1.0 / (1.0 + dist * 0.006));
        vec3 N = normalize(vec3(rg.x * 0.05, 1.0, rg.y * 0.05));
        float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);

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

        vec3 deep = vec3(0.003, 0.007, 0.013);
        vec3 col = deep + refl * mix(0.35, 0.85, fres);
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
      ${fogGlsl}
      varying vec3 vWorld;
      void main() { gl_FragColor = vec4(applyFog(vec3(0.014, 0.015, 0.018), vWorld), 1.0); }
    `,
  });
  return new THREE.Mesh(g, m);
}
