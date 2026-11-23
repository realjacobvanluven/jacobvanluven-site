import * as THREE from 'three';
import { skyGlsl, hashGlsl, groundGlsl, fogGlsl } from './shaders.js';

/**
 * The land south of False Creek rises toward Broadway (the Fairview slopes): a real terrain surface instead of a flat
 * plane, with the roads, paths, trees, lamps, cars and people following it through `heightAt`. The data file carries the
 * ground height (metres above the flat shore) on a 40 m grid; this surface is that grid, smoothly interpolated.
 * Zero everywhere else (the north bank, the water, Granville Island), so nothing changes there.
 */

/** Decodes the data file's grid and returns { heightAt(x, y), grid }. Local metres: x east, y north. */
export function decodeTerrain(t) {
  if (!t) return { heightAt: () => 0, grid: null };
  const heights = new Float32Array(t.cols * t.rows);
  t.heights.forEach((row, j) => { let h = 0; row.forEach((d, i) => { h += d; heights[j * t.cols + i] = h / 10; }); });
  const heightAt = (x, y) => {
    const fx = (x - t.x0) / t.step, fy = (y - t.y0) / t.step;
    if (fx < 0 || fy < 0 || fx > t.cols - 1 || fy > t.rows - 1) return 0;
    const i = Math.min(t.cols - 2, Math.floor(fx)), j = Math.min(t.rows - 2, Math.floor(fy));
    const ax = fx - i, ay = fy - j;
    // Smoothstep weights: no visible creases at the grid lines.
    const sx = ax * ax * (3 - 2 * ax), sy = ay * ay * (3 - 2 * ay);
    const g = (a, b) => heights[b * t.cols + a];
    return (g(i, j) * (1 - sx) + g(i + 1, j) * sx) * (1 - sy) + (g(i, j + 1) * (1 - sx) + g(i + 1, j + 1) * sx) * sy;
  };
  return { heightAt, grid: { ...t, heights } };
}

/** The terrain mesh (resampled to 20 m), shaded like the ground but lit by the afterglow so slopes read. */
export function createTerrain(terrain, uniforms) {
  const { grid, heightAt } = terrain;
  if (!grid) return null;
  const step = grid.step / 2;
  const cols = (grid.cols - 1) * 2 + 1, rows = (grid.rows - 1) * 2 + 1;
  const pos = new Float32Array(cols * rows * 3), idx = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const x = grid.x0 + i * step, y = grid.y0 + j * step;
    pos.set([x, heightAt(x, y) - 0.4, -y], (j * cols + i) * 3); // 0.4 below the water plane, like the flat ground
  }
  for (let j = 0; j < rows - 1; j++) for (let i = 0; i < cols - 1; i++) {
    const a = j * cols + i, b = a + 1, c = a + cols, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    uniforms,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, // wins over the flat ground where they meet (ground decal stack, bottom to top: terrain -1, lawns -3, sidewalks -4, streets -5, paths -6, turnarounds -7)
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
        vec3 base = groundColor(vWorld.xz); // same open ground as the flat plane
        // Slope lighting from the surface itself: west-facing slopes catch the afterglow, east-facing ones fall into shade.
        vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
        if (n.y < 0.0) n = -n;
        float glow = max(dot(n, normalize(vec3(uSunDir.x, 0.25, uSunDir.z))), 0.0);
        vec3 col = base * (0.7 + 2.2 * glow * vec3(1.0, 0.62, 0.34)) + base * vec3(0.3, 0.4, 0.8) * n.y;
        gl_FragColor = vec4(applyFog(col, vWorld), 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'south-terrain';
  mesh.frustumCulled = false;
  return mesh;
}
