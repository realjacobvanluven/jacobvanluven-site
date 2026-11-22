/**
 * Street life: streetlights along the downtown streets (mostly white LED, some older orange sodium), and
 * moving traffic on the main roads (red taillights going away from the camera, white headlights coming
 * toward it). Streets come from OpenStreetMap via the data file; most of them are hidden between
 * buildings, which is exactly how a city reads at night: light leaking out of the gaps.
 */

import * as THREE from 'three';
import { skyGlsl, hashGlsl, fogGlsl } from './shaders.js';

export function createStreets(roads, uniforms, { camera = [0, 0], maxDistance = 2600, lampSpacing = 34, carSpacing = [18, 48], ribbonDistance = 2200 } = {}) {
  let seed = 77;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const far = ([x, y]) => Math.hypot(x - camera[0], y - camera[1]) > maxDistance;
  const lamps = [];
  const lanes = []; // { pts, cum, length, dir, speed, color }
  // Street surfaces: ribbons along each road with the lamp layout encoded per vertex, so the shader can
  // paint pools of light exactly under the streetlights (aArc: distance along, aAcross: offset from centre).
  const rib = { pos: [], arc: [], across: [], phase: [], half: [] };

  for (const road of roads) {
    const pts = road.line;
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const length = cum[cum.length - 1];
    if (length < 20) continue;
    const pointAt = (s, offset) => {
      let i = 1;
      while (i < cum.length - 1 && cum[i] < s) i++;
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
      const seg = cum[i] - cum[i - 1] || 1, t = (s - cum[i - 1]) / seg;
      const ux = (bx - ax) / seg, uy = (by - ay) / seg;
      return [ax + (bx - ax) * t + uy * offset, ay + (by - ay) * t - ux * offset];
    };

    // Lamps, alternating sides.
    const half = road.main ? 11 : 8;
    let side = 1;
    const phase = rand() * lampSpacing;
    if (pts.some((p) => Math.hypot(p[0] - camera[0], p[1] - camera[1]) < ribbonDistance)) {
      const w = half + 2;
      for (let i = 1; i < pts.length; i++) {
        const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
        const seg = cum[i] - cum[i - 1];
        if (seg < 0.5) continue;
        const nx = (by - ay) / seg, ny = -(bx - ax) / seg; // right of travel
        const v = [[ax - nx * w, ay - ny * w, cum[i - 1], -w], [bx - nx * w, by - ny * w, cum[i], -w], [bx + nx * w, by + ny * w, cum[i], w], [ax + nx * w, ay + ny * w, cum[i - 1], w]];
        for (const k of [0, 1, 2, 0, 2, 3]) {
          const [x, y, a, c] = v[k];
          rib.pos.push(x, 0.12, -y); rib.arc.push(a); rib.across.push(c); rib.phase.push(phase); rib.half.push(half);
        }
      }
    }
    for (let s = phase; s < length; s += lampSpacing) {
      const p = pointAt(s, half * side);
      side = -side;
      if (far(p) || Math.hypot(p[0] - camera[0], p[1] - camera[1]) < 150) continue;
      const sodium = rand() < 0.3;
      const k = 3.4 + rand() * 1.4;
      lamps.push({ p: [p[0], 8, -p[1]], color: (sodium ? [1, 0.55, 0.2] : [1, 0.86, 0.68]).map((c) => c * k), size: 0.7 });
    }

    // Traffic on main roads: one lane each way.
    if (!road.main || far(pts[0]) && far(pts[pts.length - 1])) continue;
    const [sx, sy] = pts[0], [ex, ey] = pts[pts.length - 1];
    const toCam = [camera[0] - (sx + ex) / 2, camera[1] - (sy + ey) / 2];
    const along = (ex - sx) * toCam[0] + (ey - sy) * toCam[1]; // > 0: forward direction heads toward the camera
    for (const dir of [1, -1]) {
      const towardCamera = dir * along > 0;
      lanes.push({
        pointAt, length, dir, speed: 10 + rand() * 4,
        color: towardCamera ? [5.5, 5.3, 4.6] : [4.8, 0.16, 0.07],
        size: towardCamera ? 0.42 : 0.34,
        cars: [],
      });
      const lane = lanes[lanes.length - 1];
      for (let s = rand() * carSpacing[1]; s < length; s += carSpacing[0] + rand() * (carSpacing[1] - carSpacing[0])) lane.cars.push(s);
    }
  }

  const carLights = [];
  for (const lane of lanes) for (let i = 0; i < lane.cars.length * 2; i++) carLights.push({ p: [0, 0, 0], color: lane.color, size: lane.size });

  /** Writes all car light positions for time t into positions (xyz per light). */
  function updateTraffic(positions, time) {
    let i = 0;
    for (const lane of lanes) {
      const L = lane.length;
      const laneOffset = 3.5 * lane.dir;
      for (const s0 of lane.cars) {
        const s = (((s0 + lane.dir * lane.speed * time) % L) + L) % L;
        for (const k of [-0.8, 0.8]) {
          const [x, y] = lane.pointAt(s, laneOffset + k);
          positions[i++] = x; positions[i++] = 0.8; positions[i++] = -y;
        }
      }
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(rib.pos, 3));
  g.setAttribute('aArc', new THREE.Float32BufferAttribute(rib.arc, 1));
  g.setAttribute('aAcross', new THREE.Float32BufferAttribute(rib.across, 1));
  g.setAttribute('aPhase', new THREE.Float32BufferAttribute(rib.phase, 1));
  g.setAttribute('aHalf', new THREE.Float32BufferAttribute(rib.half, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: { ...uniforms, uSpacing: { value: lampSpacing } },
    side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    vertexShader: /* glsl */ `
      attribute float aArc; attribute float aAcross; attribute float aPhase; attribute float aHalf;
      varying vec3 vWorld; varying float vArc; varying float vAcross; varying float vPhase; varying float vHalf;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz; vArc = aArc; vAcross = aAcross; vPhase = aPhase; vHalf = aHalf;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      ${skyGlsl}
      ${hashGlsl}
      ${fogGlsl}
      uniform float uSpacing;
      varying vec3 vWorld; varying float vArc; varying float vAcross; varying float vPhase; varying float vHalf;
      void main() {
        // Nearest lamp along this road (lamps alternate sides), and how far this point is from it.
        float k = floor((vArc - vPhase) / uSpacing + 0.5);
        float along = vArc - (vPhase + k * uSpacing);
        float side = mod(k, 2.0) < 0.5 ? 1.0 : -1.0;
        float across = vAcross - side * vHalf;
        float pool = exp(-(along * along * 0.8 + across * across) / (2.0 * 5.5 * 5.5));
        float sodium = step(0.7, hash12(vec2(k, vPhase * 13.0)));
        vec3 lamp = mix(vec3(1.0, 0.82, 0.6), vec3(1.0, 0.55, 0.22), sodium);
        // Asphalt, a touch lighter in the middle; faint lane markings on wide roads.
        float edge = smoothstep(vHalf + 2.0, vHalf - 1.0, abs(vAcross));
        vec3 asphalt = vec3(0.022, 0.023, 0.027) * (0.85 + 0.3 * hash12(floor(vWorld.xz / 3.0)));
        float marking = step(vHalf, 10.5) < 0.5 ? (1.0 - smoothstep(0.1, 0.25, abs(vAcross))) * step(0.5, fract(vArc / 6.0)) : 0.0;
        vec3 col = asphalt + lamp * pool * 0.28 + vec3(0.6) * marking * pool * 0.15;
        gl_FragColor = vec4(applyFog(col * edge, vWorld), edge);
      }
    `,
    transparent: true,
    depthWrite: false,
  });
  const surface = new THREE.Mesh(g, material);
  surface.renderOrder = 1;

  return { lamps, carLights, updateTraffic, surface, stats: { lamps: lamps.length, cars: carLights.length / 2, ribbonTriangles: rib.pos.length / 9 } };
}
