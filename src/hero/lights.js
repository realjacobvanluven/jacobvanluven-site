import * as THREE from 'three';

/**
 * Small light sources (streetlights, distant houses, aviation lights, dome lights, beacon) as one
 * kind of glowing point sprite. Size is in metres with a minimum on-screen size, so far lights stay
 * visible as pinpricks; brightness is HDR so bloom picks them up.
 */
export function createLightPoints(lights, uniforms, { minPixels = 1.6 } = {}) {
  const n = lights.length;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n), blink = new Float32Array(n);
  lights.forEach((l, i) => {
    pos.set(l.p, i * 3); col.set(l.color, i * 3); size[i] = l.size; blink[i] = l.blink ?? -1;
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  g.setAttribute('aBlink', new THREE.BufferAttribute(blink, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { ...uniforms, uMinPixels: { value: minPixels } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      uniform float uPixelHeight;   // viewport height in device pixels
      uniform float uTanHalfFov;
      uniform float uMinPixels;
      uniform float uFogDensity;
      uniform float uTime;
      attribute vec3 aColor;
      attribute float aSize;
      attribute float aBlink;        // phase for blinking lights, -1 = steady
      varying vec3 vColor;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float dist = -mv.z;
        float px = aSize / (dist * uTanHalfFov) * uPixelHeight * 0.5;
        float shown = max(px, uMinPixels);
        // Keep total light constant when a sprite is clamped up to the minimum size.
        float energy = (px * px) / (shown * shown);
        float fog = exp(-dist * uFogDensity * 1.2);
        float on = aBlink < 0.0 ? 1.0 : step(0.5, fract(uTime * 0.5 + aBlink));
        vColor = aColor * mix(0.35, 1.0, sqrt(energy)) * fog * on;
        gl_PointSize = shown * 3.0; // the glow extends past the lamp itself
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float r2 = dot(d, d) * 4.0;
        float core = exp(-r2 * 22.0);
        float halo = exp(-r2 * 4.0) * 0.18;
        float a = core + halo;
        if (a < 0.003) discard;
        gl_FragColor = vec4(vColor * a, 1.0);
      }
    `,
  });
  const points = new THREE.Points(g, m);
  points.frustumCulled = false;
  return points;
}

const WARM = [1.0, 0.62, 0.3];

/** Lamps every ~28 m along the shoreline (the seawall), set a few metres inland. */
export function seawallLights(shoreline, { spacing = 28, maxDistance = 2600, intensity = 6 } = {}) {
  const out = [];
  for (const line of shoreline) {
    let carry = 0;
    for (let i = 1; i < line.length; i++) {
      const [x0, y0] = line[i - 1], [x1, y1] = line[i];
      const len = Math.hypot(x1 - x0, y1 - y0);
      if (len < 1e-3) continue;
      const dx = (x1 - x0) / len, dy = (y1 - y0) / len;
      for (let s = spacing - carry; s < len; s += spacing) {
        const x = x0 + dx * s - dy * 6, y = y0 + dy * s + dx * 6; // OSM coastline: land on the left
        const d = Math.hypot(x, y);
        if (d > maxDistance || d < 60) continue; // none right under the camera
        out.push({ p: [x, 5.5, -y], color: WARM.map((c) => c * intensity), size: 0.9 });
      }
      carry = (carry + len) % spacing;
    }
  }
  return out;
}

/** Red obstruction lights on the tallest towers, blinking out of sync. */
export function aviationLights(buildings, { minHeight = 105, max = 30 } = {}) {
  return buildings
    .filter((b) => b.h >= minHeight)
    .sort((a, b) => b.h - a.h)
    .slice(0, max)
    .map((b, i) => ({ p: [b.c[0], b.h + 1.5, -b.c[1]], color: [9, 0.25, 0.12], size: 1.4, blink: (i * 0.37) % 1 }));
}

export function distantLights(points, rand = Math.random) {
  return points.map((p) => {
    const cool = rand() < 0.3;
    const k = 1.5 + rand() * 3;
    return { p, color: (cool ? [0.8, 0.88, 1.0] : WARM).map((c) => c * k), size: 2.2 };
  });
}
