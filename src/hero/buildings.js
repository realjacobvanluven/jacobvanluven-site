import * as THREE from 'three';
import { skyGlsl, hashGlsl, fogGlsl } from './shaders.js';

/**
 * Buildings: geometry is built off the main thread (geometry-worker.js), then drawn with one facade
 * shader that generates windows procedurally.
 *
 * Facade kinds (aKind): 0 concrete with punched windows, 1 residential glass with balcony bands,
 * 2 office curtain wall with spandrels. Roughly 20–35% of windows are lit, with per-window brightness
 * and colour, some blinds, and a few blue TV-flicker windows.
 */

/** Builds building geometry in a worker. Resolves to { group, stats }. */
export function createBuildings(buildings, uniforms, { camera = [0, 0], lod = {} } = {}) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./geometry-worker.js', import.meta.url), { type: 'module' });
    worker.onerror = (e) => reject(new Error(`Geometry worker failed: ${e.message}`));
    worker.onmessage = ({ data }) => {
      worker.terminate();
      const material = createFacadeMaterial(uniforms);
      const group = new THREE.Group();
      for (const c of data.chunks) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(c.position, 3));
        g.setAttribute('normal', new THREE.BufferAttribute(c.normal, 3));
        g.setAttribute('aSeed', new THREE.BufferAttribute(c.seed, 1));
        g.setAttribute('aKind', new THREE.BufferAttribute(c.kind, 1));
        g.setAttribute('aTop', new THREE.BufferAttribute(c.top, 1));
        g.computeBoundingSphere();
        group.add(new THREE.Mesh(g, material));
      }
      resolve({ group, stats: data.stats });
    };
    worker.postMessage({ buildings: buildings.map(({ ring, h, base, c }) => ({ ring, h, base, c })), camera, lod });
  });
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
      uniform float uTime;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying float vSeed;
      varying float vKind;
      varying float vTop;

      void main() {
        vec3 n = normalize(vNormal);
        vec3 V = normalize(cameraPosition - vWorld);
        float isConcrete = step(vKind, 0.5);
        float isResi = step(0.5, vKind) * step(vKind, 1.5);
        float isOffice = step(1.5, vKind);
        vec3 sunFlat = normalize(vec3(uSunDir.x, 0.0, uSunDir.z));
        vec3 westWarm = vec3(1.0, 0.5, 0.2);

        // Contact shadow: walls darken toward the ground, where sky light is blocked by the street canyon.
        float ao = mix(0.45, 1.0, smoothstep(0.0, 7.0, vWorld.y));

        if (n.y > 0.5) {
          vec3 roof = vec3(0.016, 0.018, 0.024) * (0.7 + 0.6 * hash12(vec2(vSeed * 91.0, 3.0)));
          gl_FragColor = vec4(applyFog(roof, vWorld), 1.0);
          return;
        }
        // Rooftop equipment: plain walls, no windows.
        if (vKind > 2.5) {
          vec3 plant = vec3(0.05, 0.052, 0.058) * (0.6 + 0.4 * n.y) * vec3(0.6, 0.66, 0.85);
          gl_FragColor = vec4(applyFog(plant, vWorld), 1.0);
          return;
        }

        // Facade grid. u along the wall, v up. Panel widths and floor heights by kind.
        vec2 t = normalize(vec2(-n.z, n.x));
        float u = dot(vWorld.xz, t);
        float floorH = isConcrete * 3.0 + isResi * 2.9 + isOffice * 3.8;
        float colW = isConcrete * 1.9 + isResi * 1.25 + isOffice * 1.5;
        vec2 g = vec2(u / colW, (vWorld.y - 0.4) / floorH);
        vec2 cell = floor(g);
        vec2 f = fract(g);
        vec2 fw = fwidth(g);
        vec2 aa = max(fw, vec2(0.001));

        // Glazed area inside each cell.
        vec2 lo = isConcrete * vec2(0.2, 0.32) + isResi * vec2(0.04, 0.2) + isOffice * vec2(0.03, 0.3);
        vec2 hi = isConcrete * vec2(0.8, 0.84) + isResi * vec2(0.96, 0.97) + isOffice * vec2(0.97, 0.97);
        vec2 m = smoothstep(lo - aa, lo + aa, f) * (1.0 - smoothstep(hi - aa, hi + aa, f));
        float isWindow = m.x * m.y;
        float windowArea = (hi.x - lo.x) * (hi.y - lo.y);
        // Residential: the slab edge / balcony band under each floor's glass.
        float slab = isResi * (1.0 - smoothstep(0.16 - aa.y, 0.16 + aa.y, f.y));

        // Who's home: units span several panels; offices light whole floors.
        float unitW = isConcrete * 2.0 + isResi * 3.0 + isOffice * 6.0;
        vec2 unit = vec2(floor(cell.x / unitW), cell.y);
        float litShare = mix(0.20, 0.35, hash12(vec2(vSeed * 13.1, 7.7)));
        float r1 = hash12(unit + vSeed * 117.0);
        float r2 = hash12(cell * 1.7 + vSeed * 53.0);   // per window
        float r3 = hash12(unit * 2.3 + vSeed * 29.0);
        float floorRand = hash12(vec2(cell.y, vSeed * 71.0));
        float lit = step(r1, litShare);
        lit = mix(lit, step(floorRand, 0.22) * step(0.2, r2), isOffice); // office: some floors on, a few panels off
        float ground = 1.0 - step(1.0, cell.y);
        lit = max(lit, ground * step(r1, 0.6));
        lit *= step(vWorld.y + floorH * 0.9, vTop) + ground;

        // Light colour and brightness per window.
        vec3 warm = vec3(1.0, 0.58, 0.26);
        vec3 neutral = vec3(1.0, 0.78, 0.55);
        vec3 cool = vec3(0.76, 0.86, 1.0);
        vec3 lampCol = r3 < 0.55 ? warm : (r3 < 0.85 ? neutral : cool);
        lampCol = mix(lampCol, mix(neutral, cool, 0.5), isOffice);
        float bright = mix(0.3, 1.2, r2 * r2) * mix(1.0, 0.55, isOffice);
        // Blinds: dimmer, faint slats.
        float blinds = step(0.75, hash12(unit + vSeed * 7.0)) * (1.0 - isOffice);
        bright *= mix(1.0, 0.45 * (0.8 + 0.2 * step(0.5, fract(f.y * 9.0))), blinds);
        // TV flicker: a few blue-white windows whose brightness jitters.
        float tv = step(0.965, hash12(unit * 3.1 + vSeed * 11.0)) * isResi;
        float flick = 0.55 + 0.45 * hash12(vec2(floor(uTime * 7.0), unit.x + unit.y * 13.0));
        lampCol = mix(lampCol, vec3(0.55, 0.7, 1.0), tv);
        bright = mix(bright, bright * flick, tv);
        // Ceiling lights: a little brighter toward the top of the window.
        bright *= mix(0.75, 1.1, f.y);
        lampCol = mix(lampCol, warm, ground * 0.6);
        vec3 lampEmit = lampCol * bright * uWindowIntensity * lit * (1.0 + ground * 0.15);

        // Base materials under blue-hour sky light.
        float skyAmb = 0.55 + 0.45 * n.y;
        float westFacing = max(dot(n, sunFlat), 0.0);
        vec3 concrete = vec3(0.12, 0.12, 0.125) * (0.7 + 0.6 * hash12(vec2(vSeed * 7.0, 1.0)));
        vec3 wallLit = concrete * skyAmb * vec3(0.55, 0.62, 0.85) + concrete * westWarm * westFacing * 0.2;
        vec3 slabCol = vec3(0.16, 0.16, 0.165) * skyAmb * vec3(0.6, 0.66, 0.86) + lampEmit * 0.04;

        vec3 R = reflect(-V, n);
        R.y = abs(R.y) * 0.9 + 0.02;
        float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
        vec3 tint = mix(vec3(0.008, 0.014, 0.02), vec3(0.012, 0.018, 0.016), hash12(vec2(vSeed * 3.0, 9.0)));
        vec3 glassCol = tint + skyColor(R) * mix(0.25, 0.9, fres);

        vec3 frameCol = mix(wallLit, vec3(0.018, 0.02, 0.025), 1.0 - isConcrete);
        frameCol = mix(frameCol, vec3(0.012, 0.013, 0.016), isOffice); // spandrels
        frameCol *= ao;
        glassCol *= ao;
        slabCol *= ao;
        vec3 windowCol = glassCol * (1.0 - lit * 0.85) + lampEmit;
        vec3 near = mix(frameCol, windowCol, isWindow);
        near = mix(near, slabCol, slab);

        // Far away: average instead of aliasing.
        float avgLit = mix(litShare, 0.27, isOffice);
        vec3 avgLamp = mix(mix(warm, neutral, 0.4), cool, isOffice * 0.7) * 0.62 * uWindowIntensity * avgLit;
        // Distant facades read as dark walls with a glow of windows, not pale blocks: darken the wall part.
        vec3 far = mix(frameCol * 0.55, glassCol * (1.0 - avgLit * 0.85) + avgLamp, windowArea);
        far = mix(far, slabCol * 0.6, isResi * 0.16);
        // Keep individual windows until they're well under a pixel (a little sparkle reads as city lights).
        float farMix = smoothstep(0.7, 1.8, max(fw.x, fw.y));
        vec3 col = mix(near, far, farMix);

        gl_FragColor = vec4(applyFog(col, vWorld), 1.0);
      }
    `,
  });
}
