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
        g.setAttribute('aWall', new THREE.BufferAttribute(c.wall, 3));
        g.computeBoundingSphere();
        group.add(new THREE.Mesh(g, material));
      }
      resolve({ group, stats: data.stats });
    };
    worker.postMessage({ buildings: buildings.map(({ ring, h, base, c }) => ({ ring, h, base, c })), camera, lod });
  });
}

/** Interior mapping for lit windows (shared with the Olympic Village shader). */
export const roomInteriorGlsl = /* glsl */ `
// A lit room seen through the glass (interior mapping): a box behind the facade, so ceiling, back wall,
// side walls and floor shift with the camera instead of the window being a flat lit rectangle.
// q: position on the window plane in room units (x along, y up, 0…1); dir: view ray in room space
// (x along, y up, z into the room); room: width, height, depth (m).
vec3 roomInterior(vec2 q, vec3 dir, vec3 room, vec3 lampCol, float seed, float office) {
  vec3 p = vec3(q * room.xy, 0.0);
  vec3 d = sign(dir) * max(abs(dir), vec3(1e-4));
  vec3 tt = (step(0.0, d) * room - p) / d;
  float t = min(min(tt.x, tt.y), tt.z);
  vec3 h = (p + d * t) / room; // hit point, 0…1 in each axis
  float fall = 1.0 - 0.45 * h.z; // light falls off into the room
  vec3 col;
  if (t == tt.y && d.y > 0.0) {
    // Ceiling: a pool around the light fixture; offices get rows of panel lights.
    vec2 c = h.xz - vec2(0.25 + 0.5 * fract(seed * 7.3), 0.35);
    float spot = exp(-dot(c, c) * 14.0);
    vec2 pg = fract(vec2(h.x * room.x / 2.4, h.z * room.z / 1.8));
    float panels = step(0.18, pg.x) * step(pg.x, 0.62) * step(0.25, pg.y) * step(pg.y, 0.6);
    col = lampCol * mix(0.45 + 2.2 * spot, 0.3 + 2.0 * panels, office);
  } else if (t == tt.y) {
    // Floor: darker; wood or carpet tone.
    col = lampCol * mix(vec3(0.22, 0.15, 0.1), vec3(0.14, 0.14, 0.16), office) * (0.6 + 0.6 * fall);
  } else if (t == tt.z) {
    // Back wall, with furniture (sofa / cabinet / desks) and sometimes a picture or a doorway.
    col = lampCol * 0.55 * mix(0.85, 1.0, h.y);
    float fx = fract(seed * 13.1), fw = 0.18 + 0.25 * fract(seed * 5.7);
    float furniture = step(abs(h.x - 0.2 - 0.6 * fx), fw) * step(h.y, mix(0.3, 0.28, office) + 0.08 * fract(seed * 3.3));
    col *= 1.0 - 0.85 * furniture;
    float pic = (1.0 - office) * step(0.5, fract(seed * 17.0)) * step(abs(h.x - 0.75 + 0.5 * fx), 0.09) * step(abs(h.y - 0.6), 0.08);
    col = mix(col, lampCol * vec3(0.25, 0.22, 0.3), pic);
    float door = step(0.6, fract(seed * 23.0)) * step(abs(h.x - 0.85), 0.07) * step(h.y, 0.75);
    col *= 1.0 - 0.6 * door;
  } else {
    // Side walls.
    col = lampCol * 0.36 * fall;
    col *= 1.0 - 0.6 * office * step(h.y, 0.3) * step(0.5, fract(h.z * room.z / 2.0)); // desk rows
  }
  return col;
}
`;

export function createFacadeMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      attribute float aSeed;
      attribute float aKind;
      attribute float aTop;
      attribute vec3 aWall;
      varying vec3 vWall;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying float vSeed;
      varying float vKind;
      varying float vTop;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        vSeed = aSeed; vKind = aKind; vTop = aTop; vWall = aWall;
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
      varying vec3 vWall; // distance along the wall, wall length, wall id (0 length: use the world grid)

      ${roomInteriorGlsl}

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
          // Roofs: per building dark tar, grey membrane (with seams) or a green roof; patchy up close.
          float rk = hash12(vec2(vSeed * 47.0, 5.0));
          float rn = hash12(floor(vWorld.xz / 3.0) + vSeed * 31.0) * 0.5 + hash12(floor(vWorld.xz / 0.7)) * 0.5;
          vec3 roof = rk < 0.45 ? vec3(0.016, 0.018, 0.024) : rk < 0.88 ? vec3(0.04, 0.042, 0.05) : vec3(0.012, 0.017, 0.012);
          roof *= (0.75 + 0.5 * hash12(vec2(vSeed * 91.0, 3.0))) * (0.8 + 0.4 * rn);
          vec2 rf = fwidth(vWorld.xz);
          float seam = step(0.45, rk) * step(rk, 0.88) * (1.0 - smoothstep(0.04, 0.04 + rf.x, abs(fract(vWorld.x / 1.6) - 0.5) - 0.46));
          roof *= 1.0 - 0.25 * seam * (1.0 - smoothstep(0.1, 0.4, rf.x));
          gl_FragColor = vec4(applyFog(roof, vWorld), 1.0);
          return;
        }
        // Rooftop equipment: plain walls, no windows.
        if (vKind > 2.5) {
          float louvre = 0.85 + 0.15 * step(0.5, fract(vWorld.y * 4.0));
          vec3 plant = vec3(0.05, 0.052, 0.058) * (0.6 + 0.4 * n.y) * vec3(0.6, 0.66, 0.85) * louvre;
          gl_FragColor = vec4(applyFog(plant, vWorld), 1.0);
          return;
        }

        // Facade grid. u along the wall, v up. Panel widths and floor heights by kind.
        vec2 t = normalize(vec2(-n.z, n.x));
        vec3 T = vec3(t.x, 0.0, t.y);
        // Variety below applies to generated buildings only (they carry wall data); the hand-modelled signature
        // towers share this shader and keep their original look.
        float generated = step(0.5, vWall.y);
        // Per building: slightly different floor heights and panel widths, so neighbours don't share one grid.
        float floorH = (isConcrete * 3.0 + isResi * 2.9 + isOffice * 3.8) * mix(1.0, 0.93 + 0.14 * hash12(vec2(vSeed * 17.0, 3.0)), generated);
        float colW = (isConcrete * 1.9 + isResi * 1.25 + isOffice * 1.5) * mix(1.0, 0.85 + 0.3 * hash12(vec2(vSeed * 29.0, 5.0)), generated);
        // Dark reflective glass: some office and condo towers read as near-black mirrors that pick up the sky
        // (the western afterglow on walls that face it) instead of showing a window grid.
        float darkGlass = generated * (1.0 - isConcrete) * step(hash12(vec2(vSeed * 43.0, 9.0)), mix(0.22, 0.45, isOffice));
        // Fit whole window columns to each wall (no windows sliced at the corners); curved hand-built
        // towers have no wall data and use the world grid.
        float wallLen = vWall.y;
        float fitted = step(0.5, wallLen);
        float u = mix(dot(vWorld.xz, t), vWall.x, fitted);
        float shortWall = fitted * step(wallLen, colW * 0.8); // chamfers and slivers: no windows
        colW = mix(colW, wallLen / max(1.0, floor(wallLen / colW + 0.5)), fitted);
        float edgeDist = mix(99.0, min(vWall.x, wallLen - vWall.x), fitted);
        vec2 g = vec2(u / colW, (vWorld.y - 0.4) / floorH);
        vec2 cell = floor(g);
        vec2 f = fract(g);
        vec2 fw = fwidth(g);
        vec2 aa = max(fw, vec2(0.001));
        // How much close-up detail this pixel can show (1 when a window panel spans many pixels).
        float detail = 1.0 - smoothstep(0.05, 0.22, max(fw.x, fw.y));

        // Glazed area inside each cell.
        vec2 lo = isConcrete * vec2(0.2, 0.32) + isResi * vec2(0.04, 0.2) + isOffice * vec2(0.03, 0.3);
        vec2 hi = isConcrete * vec2(0.8, 0.84) + isResi * vec2(0.96, 0.97) + isOffice * vec2(0.97, 0.97);
        // Lobby / shopfronts: the ground floor has taller glazing.
        float groundFloor = 1.0 - step(1.0, floor((vWorld.y - 0.4) / floorH));
        lo.y = mix(lo.y, 0.06, groundFloor); hi.y = mix(hi.y, 0.9, groundFloor);
        vec2 m = smoothstep(lo - aa, lo + aa, f) * (1.0 - smoothstep(hi - aa, hi + aa, f));
        float isWindow = m.x * m.y;
        // Solid corners (piers / corner mullions), very short walls, and a parapet band at the top.
        float aaU = fwidth(u);
        float corner = 1.0 - smoothstep(0.3, 0.3 + aaU, edgeDist);
        float parapet = step(vTop - 1.1, vWorld.y);
        isWindow *= (1.0 - corner) * (1.0 - parapet) * (1.0 - shortWall);
        float windowArea = (hi.x - lo.x) * (hi.y - lo.y);
        // Residential: the slab edge / balcony band under each floor's glass.
        float slab = isResi * (1.0 - smoothstep(0.16 - aa.y, 0.16 + aa.y, f.y));

        // Who's home: units span several panels; offices light whole floors.
        float unitW = isConcrete * 2.0 + isResi * 3.0 + isOffice * 6.0;
        // Each wall gets its own pattern (shift by whole units so rooms still line up with windows).
        cell.x += floor(vWall.z * 997.0) * unitW * 7.0;
        vec2 unit = vec2(floor(cell.x / unitW), cell.y);
        // Occupancy per building: most moderately lit, some nearly dark (empty offices, unsold units), some busy.
        // Mirror-glass towers show less of their interior.
        float occ = hash12(vec2(vSeed * 13.1, 7.7));
        float litShare = occ < 0.18 ? mix(0.03, 0.1, occ / 0.18) : occ < 0.82 ? mix(0.18, 0.38, (occ - 0.18) / 0.64) : mix(0.5, 0.7, (occ - 0.82) / 0.18);
        litShare *= mix(1.0, 0.55, darkGlass);
        litShare = mix(mix(0.20, 0.35, occ), litShare, generated);
        float r1 = hash12(unit + vSeed * 117.0);
        float r2 = hash12(cell * 1.7 + vSeed * 53.0);   // per window
        float r3 = hash12(unit * 2.3 + vSeed * 29.0);
        float floorRand = hash12(vec2(cell.y, vSeed * 71.0));
        // Floors differ too: some busier, some quiet, instead of an even sprinkle over the whole facade.
        float floorBusy = mix(1.0, mix(0.45, 1.55, hash12(vec2(cell.y * 3.7 + 1.0, vSeed * 59.0))), generated);
        float officeFloors = mix(0.22, litShare * 0.8, generated);
        float lit = step(r1, litShare * floorBusy);
        lit = mix(lit, step(floorRand, officeFloors) * step(0.2, r2), isOffice); // office: some floors on, a few panels off
        float ground = 1.0 - step(1.0, cell.y);
        lit = max(lit, ground * step(r1, 0.6));
        lit *= step(vWorld.y + floorH * 0.9, vTop) + ground;

        // Light colour and brightness per window.
        vec3 warm = vec3(1.0, 0.58, 0.26);
        vec3 neutral = vec3(1.0, 0.78, 0.55);
        vec3 cool = vec3(0.76, 0.86, 1.0);
        // Each building has a lighting style (some warmer, some cooler), and homes vary from 2700 K
        // tungsten to 5000 K daylight LED; offices are a building-wide 4000 K or 5000 K.
        float style = hash12(vec2(vSeed * 61.0, 8.0));
        vec3 k2700 = vec3(1.0, 0.52, 0.22), k3000 = vec3(1.0, 0.64, 0.34), k4000 = vec3(1.0, 0.82, 0.62), k5000 = vec3(0.8, 0.88, 1.0);
        float rk = clamp(r3 * 0.8 + style * 0.45 - 0.15, 0.0, 1.0);
        vec3 lampCol = rk < 0.3 ? k2700 : rk < 0.58 ? k3000 : rk < 0.82 ? k4000 : k5000;
        vec3 officeCol = style < 0.4 ? mix(k4000, k5000, 0.3) : style < 0.85 ? mix(k4000, k5000, 0.75) : vec3(0.72, 0.9, 0.95);
        lampCol = mix(lampCol, officeCol, isOffice);
        // A few homes with coloured LED strips or grow lights.
        float rgb = step(0.98, hash12(unit * 5.3 + vSeed * 17.0)) * (1.0 - isOffice);
        float hue = hash12(unit * 9.1 + vSeed * 5.0);
        vec3 accentRoom = hue < 0.3 ? vec3(0.62, 0.32, 1.0) : hue < 0.5 ? vec3(1.0, 0.3, 0.62) : hue < 0.7 ? vec3(0.25, 0.85, 0.9) : hue < 0.85 ? vec3(1.0, 0.28, 0.2) : vec3(0.45, 1.0, 0.45);
        lampCol = mix(lampCol, accentRoom, rgb);
        float bright = mix(0.3, 1.2, r2 * r2) * mix(1.0, 0.55, isOffice);
        // Office floors are one room: every panel on a floor shares the light level.
        bright = mix(bright, mix(0.45, 0.7, floorRand), isOffice);
        // Blinds: dimmer, faint slats.
        float blinds = step(0.75, hash12(unit + vSeed * 7.0)) * (1.0 - isOffice);
        float slats = 0.8 + 0.2 * step(0.5, fract(f.y * 9.0));
        // TV flicker: a few blue-white windows whose brightness jitters.
        float tv = step(0.965, hash12(unit * 3.1 + vSeed * 11.0)) * isResi;
        float flick = 0.55 + 0.45 * hash12(vec2(floor(uTime * 7.0), unit.x + unit.y * 13.0));
        lampCol = mix(lampCol, vec3(0.55, 0.7, 1.0), tv);
        bright = mix(bright, bright * flick, tv);
        lampCol = mix(lampCol, warm, ground * 0.6);
        // Shopfronts: some carry a coloured sign or neon.
        float shop = ground * step(0.7, hash12(unit * 2.9 + vSeed * 13.0));
        float signHue = hash12(unit * 4.7 + vSeed);
        vec3 signCol = signHue < 0.3 ? vec3(1.0, 0.2, 0.15) : signHue < 0.5 ? vec3(0.3, 0.55, 1.0) : signHue < 0.7 ? vec3(1.0, 0.45, 0.85) : signHue < 0.85 ? vec3(0.35, 1.0, 0.6) : vec3(1.0, 0.85, 0.3);
        lampCol = mix(lampCol, signCol, shop * 0.7);
        float emitK = uWindowIntensity * lit * (1.0 + ground * 0.15);
        // Flat (distant) version of a lit window: ceiling lights make the top a little brighter.
        vec3 flatRoom = lampCol * mix(0.75, 1.1, f.y);

        // Base materials under blue-hour sky light. Each building gets its own cladding: grey concrete,
        // warm beige, dark brick-brown or painted white.
        float skyAmb = 0.55 + 0.45 * n.y;
        float westFacing = max(dot(n, sunFlat), 0.0);
        float pick = hash12(vec2(vSeed * 5.3, 2.0));
        vec3 clad = pick < 0.45 ? vec3(0.12, 0.12, 0.125) : pick < 0.7 ? vec3(0.14, 0.122, 0.1) : pick < 0.88 ? vec3(0.075, 0.062, 0.055) : vec3(0.17, 0.17, 0.168);
        vec3 concrete = clad * (0.75 + 0.5 * hash12(vec2(vSeed * 7.0, 1.0)));
        // Weathering: large faint patches and, up close, rain streaks running down from the sills.
        concrete *= 0.9 + 0.2 * hash12(floor(vec2(u / 7.0, vWorld.y / 9.0)) + vSeed * 19.0);
        float streak = hash12(vec2(floor(u / 0.3), vSeed * 41.0));
        float underSill = m.x * (1.0 - step(lo.y, f.y)) * smoothstep(0.0, lo.y, f.y);
        concrete *= 1.0 - detail * (0.22 * underSill * streak + 0.06 * streak);
        // Sky light is a touch stronger higher up; street lights wash the lower floors warm, in pools.
        skyAmb *= 0.85 + 0.2 * smoothstep(0.0, 150.0, vWorld.y);
        float streetWash = exp(-max(vWorld.y, 0.0) / 9.0) * (0.55 + 0.45 * sin(u * 0.19 + vSeed * 40.0));
        vec3 washCol = vec3(1.0, 0.62, 0.3) * streetWash;
        // Afterglow on west-facing walls: strongest at grazing angles (the lit edge of a tower seen side-on)
        // and higher up, where the low western sky isn't blocked by the neighbours.
        float grazing = 1.0 - max(dot(n, V), 0.0);
        float high = smoothstep(8.0, 140.0, vWorld.y);
        float glowEdge = westFacing * (0.35 + 0.65 * grazing * grazing) * (0.3 + 0.7 * high);
        vec3 wallLit = concrete * skyAmb * vec3(0.55, 0.62, 0.85) + concrete * westWarm * glowEdge * 0.75 + concrete * washCol * 0.9;
        // Concrete: a lighter sill under each window and a floor line.
        float sill = isConcrete * m.x * step(lo.y - 0.05, f.y) * (1.0 - step(lo.y, f.y));
        float floorLine = isConcrete * (1.0 - smoothstep(0.03 - aa.y, 0.05 + aa.y, f.y));
        wallLit *= 1.0 + detail * (0.35 * sill - 0.18 * floorLine);
        vec3 slabCol = vec3(0.16, 0.16, 0.165) * skyAmb * vec3(0.6, 0.66, 0.86) + lampCol * bright * emitK * 0.04;

        // Glass: each pane sits at a slightly different angle, so reflections break up pane by pane.
        vec2 pr = vec2(hash12(cell * 3.1 + vSeed * 7.0), hash12(cell * 5.7 + vSeed * 3.0)) - 0.5;
        vec3 np = normalize(n + (T * pr.x * 0.09 + vec3(0.0, pr.y * 0.06, 0.0)) * detail * mix(1.0, 0.3, darkGlass)); // mirror glass: flatter panes
        vec3 R = reflect(-V, np);
        R.y = abs(R.y) * 0.9 + 0.02;
        float fres = 0.04 + 0.96 * pow(1.0 - max(dot(np, V), 0.0), 5.0);
        // Glass type per building: Vancouver's green-teal condo glass, blue, bronze, silver or dark smoked.
        float gk = hash12(vec2(vSeed * 23.0, 4.0));
        vec3 glassTint = gk < 0.32 ? vec3(0.42, 0.98, 0.85) : gk < 0.52 ? vec3(0.42, 0.7, 1.15) : gk < 0.66 ? vec3(1.15, 0.75, 0.45) : gk < 0.86 ? vec3(0.88, 0.9, 0.94) : vec3(0.5, 0.52, 0.56);
        glassTint = mix(glassTint, gk < 0.5 ? vec3(0.62, 0.66, 0.74) : vec3(0.78, 0.68, 0.58), darkGlass); // smoke-grey or bronze mirror
        vec3 tint = vec3(0.009, 0.014, 0.018) * glassTint * mix(1.3, 0.35, darkGlass);
        vec3 glassCol = tint + skyColor(R) * mix(0.25, 0.9, fres) * glassTint * mix(1.0, 1.25, darkGlass);
        // The city reflected in the glass: a faint band of distant lit windows near the horizon.
        float az = atan(R.x, R.z);
        float cityBand = (1.0 - smoothstep(0.0, 0.12, R.y)) * step(0.9, hash12(floor(vec2(az * 420.0, R.y * 900.0))));
        glassCol += vec3(1.0, 0.7, 0.4) * cityBand * 0.14 * detail * mix(0.4, 1.0, fres);
        // Soft (blurred) reflection of the western afterglow on glass that faces partly west, strongest on the
        // mirror-glass towers and at grazing angles.
        glassCol += westWarm * glowEdge * mix(0.012, 0.09, darkGlass);

        // Mullions/slab edges per building: white, black, bronze or grey metal; office spandrels take the
        // glass colour.
        float mk = hash12(vec2(vSeed * 37.0, 6.0));
        vec3 metal = mk < 0.3 ? vec3(0.07, 0.072, 0.078) : mk < 0.55 ? vec3(0.012, 0.013, 0.015) : mk < 0.72 ? vec3(0.04, 0.028, 0.017) : vec3(0.03, 0.032, 0.036);
        metal *= skyAmb * vec3(0.75, 0.8, 0.95);
        metal += westWarm * glowEdge * 0.03; // metal fins and frames catch a warm edge
        vec3 frameCol = mix(wallLit, metal, 1.0 - isConcrete);
        frameCol = mix(frameCol, vec3(0.011) * glassTint * 1.2 + metal * 0.3, isOffice); // spandrels
        // Mirror-glass towers: spandrels are the same glass, so the facade reads as one reflective skin.
        frameCol = mix(frameCol, glassCol * 0.85 + metal * 0.15, darkGlass * (1.0 - parapet));
        frameCol += vec3(0.02, 0.016, 0.012) * washCol * (1.0 - isConcrete);
        // Parapet cap and corner trim: a little lighter (metal / precast), catching the sky.
        frameCol = mix(frameCol, wallLit * 1.15 + vec3(0.004, 0.005, 0.008), max(parapet, corner * (1.0 - isConcrete)) * (1.0 - isConcrete * 0.6));
        frameCol *= ao;
        glassCol *= ao;
        glassCol += vec3(0.012, 0.008, 0.004) * washCol;
        slabCol *= ao;

        // Far away: average instead of aliasing.
        float avgLit = mix(litShare, mix(0.27, officeFloors * 0.8, generated), isOffice);
        vec3 avgLamp = mix(mix(k3000, k4000, style), officeCol, isOffice) * 0.62 * uWindowIntensity * avgLit;
        // Distant facades read as dark walls with a glow of windows, not pale blocks: darken the wall part.
        vec3 far = mix(frameCol * 0.55, glassCol * (1.0 - avgLit * 0.85) + avgLamp, windowArea);
        far = mix(far, slabCol * 0.6, isResi * 0.16);
        // Keep individual windows until they're well under a pixel (a little sparkle reads as city lights).
        float farMix = smoothstep(0.7, 1.8, max(fw.x, fw.y));
        vec3 col = far;

        if (farMix < 0.999) {
          vec3 room = flatRoom;
          if (lit > 0.5 && detail > 0.001) {
            // Room behind this window: the unit (several panels wide), one floor high, 4–6 m deep
            // (open-plan office floors are deeper).
            vec3 dims = vec3(unitW * colW, floorH, mix(4.0 + 2.0 * r3, 11.0, isOffice));
            vec2 q = vec2((cell.x - unit.x * unitW + f.x) / unitW, f.y);
            vec3 dir = vec3(dot(-V, T), -V.y, dot(V, n));
            vec3 inside = roomInterior(q, dir, dims, lampCol, r1 * 0.37 + r3 * 0.63, isOffice) * 1.25;
            // Curtains drawn partway in from the sides (homes), with soft folds; the light glows through.
            float cl = (1.0 - isOffice) * step(0.4, r2) * (0.08 + 0.3 * hash12(unit + 4.0));
            float cr = (1.0 - isOffice) * step(0.3, r3) * (0.06 + 0.25 * hash12(unit + 9.0));
            float curtain = max(1.0 - smoothstep(cl - 0.01, cl + 0.01, q.x), smoothstep(1.0 - cr - 0.01, 1.0 - cr + 0.01, q.x));
            vec3 fabric = lampCol * mix(vec3(0.5, 0.42, 0.34), vec3(0.4, 0.4, 0.42), fract(r1 * 9.0)) * (0.8 + 0.2 * sin(q.x * unitW * colW * 9.0));
            inside = mix(inside, fabric, curtain);
            room = mix(flatRoom, inside, detail);
          }
          room = mix(room, lampCol * 0.45 * slats, blinds);
          vec3 lampEmit = room * bright * emitK;
          // Lit glass still reflects a little; dark glass is mostly reflection.
          vec3 windowCol = glassCol * (1.0 - lit * 0.75) + lampEmit;

          // Mullions: punched windows split into two panes; condo glass gets a transom near the top;
          // a recess shadow along the head of punched windows.
          float mullion = isConcrete * (1.0 - smoothstep(0.012, 0.012 + aa.x, abs(f.x - 0.5)));
          mullion += isResi * step(0.5, fract(vSeed * 37.0)) * (1.0 - smoothstep(0.012, 0.012 + aa.y, abs(f.y - 0.8)));
          mullion += isOffice * (1.0 - smoothstep(0.015, 0.015 + aa.x, min(f.x - lo.x, hi.x - f.x)));
          windowCol = mix(windowCol, frameCol * 0.8 + lampEmit * 0.05, clamp(mullion, 0.0, 1.0) * detail);
          float recess = isConcrete * smoothstep(hi.y - 0.09, hi.y, f.y) * detail;
          windowCol *= 1.0 - 0.45 * recess;

          // Condo balconies: a frosted glass railing across the lower part of each floor, with a top rail.
          float rail = isResi * step(0.16, f.y) * (1.0 - step(0.42, f.y)) * step(0.35, hash12(vec2(unit.x, vSeed * 3.0)));
          float topRail = isResi * (1.0 - smoothstep(0.008, 0.008 + aa.y, abs(f.y - 0.42))) * step(0.35, hash12(vec2(unit.x, vSeed * 3.0)));
          windowCol = mix(windowCol, windowCol * 0.7 + skyColor(R) * 0.12, rail * 0.6);
          windowCol = mix(windowCol, slabCol * 1.2, topRail * detail);

          vec3 near = mix(frameCol, windowCol, isWindow);
          near = mix(near, slabCol, slab);
          col = mix(near, far, farMix);
        }

        // Feature lighting on some towers: a coloured LED band at the crown washing down the top floors
        // (white, blue, purple, teal or amber), visible across the city.
        float crownOn = step(55.0, vTop) * step(hash12(vec2(vSeed * 71.0, 2.0)), 0.2);
        float ch = hash12(vec2(vSeed * 83.0, 1.0));
        vec3 crownCol = ch < 0.3 ? vec3(0.85, 0.92, 1.0) : ch < 0.5 ? vec3(0.25, 0.45, 1.0) : ch < 0.68 ? vec3(0.6, 0.3, 1.0) : ch < 0.84 ? vec3(0.15, 0.85, 0.8) : vec3(1.0, 0.55, 0.2);
        float dTop = vTop - vWorld.y;
        float crownBand = (1.0 - smoothstep(0.2, 1.4, dTop)) * 1.6 + exp(-max(dTop, 0.0) / 6.0) * 0.14;
        col += crownCol * crownBand * crownOn * step(dTop, 40.0);
        gl_FragColor = vec4(applyFog(col, vWorld), 1.0);
      }
    `,
  });
}
