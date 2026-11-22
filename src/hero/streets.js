/**
 * Street life: streetlights along the downtown streets (mostly white LED, some older orange sodium), and
 * moving traffic on the main roads (red taillights going away from the camera, white headlights coming
 * toward it). Streets come from OpenStreetMap via the data file; most of them are hidden between
 * buildings, which is exactly how a city reads at night: light leaking out of the gaps.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { skyGlsl, hashGlsl, fogGlsl } from './shaders.js';

export function createStreets(roads, uniforms, { camera = [0, 0], maxDistance = 2600, lampSpacing = 34, carSpacing = [18, 48], ribbonDistance = 2200, localTrafficDistance = 1300, bodyDistance = 1500 } = {}) {
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

    // Traffic: one lane each way on main roads; lighter traffic on local streets near the camera
    // (the waterfront, Olympic Village and around Science World).
    const near = (r) => pts.some((p) => Math.hypot(p[0] - camera[0], p[1] - camera[1]) < r);
    if (road.main ? far(pts[0]) && far(pts[pts.length - 1]) : !near(localTrafficDistance)) continue;
    const spacing = road.main ? carSpacing : [carSpacing[0] * 2.5, carSpacing[1] * 3];
    const bodies = near(bodyDistance);
    const [sx, sy] = pts[0], [ex, ey] = pts[pts.length - 1];
    const toCam = [camera[0] - (sx + ex) / 2, camera[1] - (sy + ey) / 2];
    const along = (ex - sx) * toCam[0] + (ey - sy) * toCam[1]; // > 0: forward direction heads toward the camera
    for (const dir of [1, -1]) {
      const towardCamera = dir * along > 0;
      lanes.push({
        pointAt, length, dir, speed: road.main ? 10 + rand() * 4 : 7 + rand() * 3,
        color: towardCamera ? [5.5, 5.3, 4.6] : [4.8, 0.16, 0.07],
        size: towardCamera ? 0.42 : 0.34,
        lightEnd: towardCamera ? 2.1 : -2.1, // headlights at the front, taillights at the back
        laneOffset: (road.main ? 3.5 : 2.4) * dir,
        bodies,
        cars: [],
      });
      const lane = lanes[lanes.length - 1];
      for (let s = rand() * spacing[1]; s < length; s += spacing[0] + rand() * (spacing[1] - spacing[0])) lane.cars.push(s);
    }
  }

  const carLights = [];
  for (const lane of lanes) for (let i = 0; i < lane.cars.length * 2; i++) carLights.push({ p: [0, 0, 0], color: lane.color, size: lane.size });
  const bodyCount = lanes.reduce((n, l) => n + (l.bodies ? l.cars.length : 0), 0);
  const bodies = bodyCount ? createCarBodies(bodyCount, uniforms, rand) : null;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);

  /** Writes all car light positions for time t into positions (xyz per light), and moves the car bodies. */
  function updateTraffic(positions, time) {
    let i = 0, b = 0;
    for (const lane of lanes) {
      const L = lane.length;
      for (const s0 of lane.cars) {
        const s = (((s0 + lane.dir * lane.speed * time) % L) + L) % L;
        const [cx, cy] = lane.pointAt(s, lane.laneOffset);
        const [fx, fy] = lane.pointAt(Math.min(L, Math.max(0, s + lane.dir * 1.5)), lane.laneOffset);
        let dx = fx - cx, dy = fy - cy;
        const len = Math.hypot(dx, dy) || 1;
        dx /= len; dy /= len;
        // Lights at the front (or back) corners of the car.
        const ex = cx + dx * lane.lightEnd, ey = cy + dy * lane.lightEnd;
        for (const k of [-0.75, 0.75]) {
          positions[i++] = ex - dy * k; positions[i++] = 0.7; positions[i++] = -(ey + dx * k);
        }
        if (lane.bodies) {
          q.setFromAxisAngle(up, Math.atan2(dy, dx));
          m.compose(v.set(cx, 0, -cy), q, one);
          bodies.mesh.setMatrixAt(b++, m);
        }
      }
    }
    if (bodies) bodies.mesh.instanceMatrix.needsUpdate = true;
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

  return { lamps, carLights, updateTraffic, surface, bodies: bodies?.mesh ?? null, stats: { lamps: lamps.length, cars: carLights.length / 2, carBodies: bodyCount, ribbonTriangles: rib.pos.length / 9 } };
}

/**
 * Car bodies (instanced): a low body and a glass cabin, about 4.4 × 1.8 m. Paint colours are mostly dark,
 * greys and whites with the odd red or blue; roofs and glass pick up the sky, sides catch street light.
 */
function createCarBodies(count, uniforms, rand) {
  const box = (w, h, d, y, part) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(0, y + h / 2, 0);
    g.setAttribute('aPart', new THREE.Float32BufferAttribute(new Array(g.attributes.position.count).fill(part), 1));
    return g;
  };
  const parts = [box(4.4, 0.75, 1.8, 0.25, 0), box(2.3, 0.55, 1.6, 1.0, 1)];
  const geo = mergeGeometries(parts);
  const paint = [[0.02, 0.02, 0.022], [0.05, 0.05, 0.055], [0.12, 0.12, 0.125], [0.3, 0.3, 0.3], [0.2, 0.02, 0.02], [0.02, 0.04, 0.1], [0.08, 0.08, 0.09]];
  const col = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) col.set(paint[Math.floor(rand() * paint.length)], i * 3);
  geo.setAttribute('aPaint', new THREE.InstancedBufferAttribute(col, 3));
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      attribute vec3 aPaint; attribute float aPart;
      varying vec3 vWorld; varying vec3 vNormal; varying vec3 vPaint; varying float vPart;
      void main() {
        vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        vNormal = normalize(mat3(modelMatrix * instanceMatrix) * normal);
        vPaint = aPaint; vPart = aPart;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      ${skyGlsl}
      ${fogGlsl}
      varying vec3 vWorld; varying vec3 vNormal; varying vec3 vPaint; varying float vPart;
      void main() {
        vec3 n = normalize(vNormal);
        vec3 V = normalize(cameraPosition - vWorld);
        float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
        vec3 R = reflect(-V, n); R.y = abs(R.y) * 0.9 + 0.02;
        vec3 sky = skyColor(R);
        // Paint lit by the sky from above and warm street light from the side.
        vec3 col = vPaint * (0.35 + 0.65 * max(n.y, 0.0)) * vec3(0.6, 0.66, 0.85) + vPaint * vec3(1.0, 0.7, 0.4) * 0.35 * (1.0 - abs(n.y));
        col += sky * mix(0.08, 0.6, fres);
        // Cabin: dark glass on the sides, the roof is paint.
        vec3 glass = vec3(0.004, 0.006, 0.01) + sky * mix(0.2, 0.8, fres);
        col = mix(col, glass, vPart * step(abs(n.y), 0.5));
        gl_FragColor = vec4(applyFog(col, vWorld), 1.0);
      }
    `,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.frustumCulled = false; // instances move every frame
  return { mesh };
}
