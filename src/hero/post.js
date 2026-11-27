import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

/** Film grain + gentle vignette, applied after tone mapping (display space). */
const GrainShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uGrain: { value: 0.03 }, uVignette: { value: 0.3 }, uRes: { value: new THREE.Vector2(1, 1) } },
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uGrain; uniform float uVignette; uniform vec2 uRes;
    varying vec2 vUv;
    float h(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      vec2 q = vUv - 0.5;
      q.x *= uRes.x / uRes.y;
      c *= 1.0 - uVignette * smoothstep(0.35, 1.05, length(q));
      float n = h(vUv * uRes + fract(uTime) * 917.0) - 0.5;
      c += n * uGrain * (0.6 + 0.4 * (1.0 - dot(c, vec3(0.333))));
      gl_FragColor = vec4(c, 1.0);
    }
  `,
};

export function createComposer(renderer, scene, camera, { width, height, pixelRatio, bloomScale = 0.5, samples = 4, bloom = {}, grain = 0.03 }) {
  // A 24-bit depth texture: the default render-target depth buffer is only 16 bits, which at a few hundred metres cannot tell apart
  // ground layers a few centimetres apart (lawns, sidewalks, streets, paths): they flickered and swapped places with the view angle.
  const target = new THREE.WebGLRenderTarget(width * pixelRatio, height * pixelRatio, { type: THREE.HalfFloatType, samples, depthTexture: new THREE.DepthTexture(width * pixelRatio, height * pixelRatio) });
  const composer = new EffectComposer(renderer, target);
  composer.setPixelRatio(pixelRatio);
  composer.setSize(width, height);

  const renderPass = new RenderPass(scene, camera);
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(width * pixelRatio * bloomScale, height * pixelRatio * bloomScale),
    bloom.strength ?? 0.24,
    bloom.radius ?? 0.55,
    bloom.threshold ?? 0.85,
  );
  // Understated, not neon (2026-11-27): low strength, wide soft radius, threshold 0.85 (HDR, before tone mapping) with a
  // soft knee, so brightness fades into the bloom over threshold … threshold + smoothWidth instead of switching on at a hard
  // cut (the pass default smoothWidth is 0.01, which made windows near the threshold pop). What glows: the brighter lit
  // windows, streetlights, aviation and mast lights, BC Place's ring, and faintly the brightest part of the sunset horizon.
  bloomPass.highPassUniforms.smoothWidth.value = bloom.smoothWidth ?? 0.45;
  // UnrealBloomPass always blurs at half the size it's given; scale that so phones can bloom at a quarter.
  const bloomSetSize = bloomPass.setSize.bind(bloomPass);
  bloomPass.scale = bloomScale;
  bloomPass.setSize = (w, h) => bloomSetSize(Math.max(2, w * bloomPass.scale * 2), Math.max(2, h * bloomPass.scale * 2));
  const outputPass = new OutputPass();
  // Edge smoothing (the scene has no MSAA): one cheap full-screen pass on the display-space image.
  const fxaaPass = new ShaderPass(FXAAShader);
  fxaaPass.uniforms.resolution.value.set(1 / (width * pixelRatio), 1 / (height * pixelRatio));
  const grainPass = new ShaderPass(GrainShader);
  grainPass.uniforms.uRes.value.set(width * pixelRatio, height * pixelRatio);
  grainPass.uniforms.uGrain.value = grain;

  composer.addPass(renderPass);
  bloomPass.setSize(width * pixelRatio, height * pixelRatio);
  composer.addPass(bloomPass);
  composer.addPass(outputPass);
  composer.addPass(fxaaPass);
  composer.addPass(grainPass);
  return { composer, passes: { renderPass, bloomPass, outputPass, fxaaPass, grainPass } };
}
