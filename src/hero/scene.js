import * as THREE from 'three';
import { loadSkyline } from './skyline-data.js';
import { skyGlsl, sunDirection } from './shaders.js';
import { createBuildings, createFacadeMaterial } from './buildings.js';
import { createSignatures } from './signatures.js';
import { createStreets } from './streets.js';
import { createWater, createGround } from './water.js';
import { createMountains, northShoreLightPoints, demHeightAt, terrainHeight } from './mountains.js';
import { createLightPoints, aviationLights, distantLights } from './lights.js';
import { bcPlace, harbourCentre, scienceWorld } from './landmarks.js';
import { createSeawall } from './seawall.js';
import { createBridge } from './bridge.js';
import { createBoats, createAquabus } from './boats.js';
import { createComposer } from './post.js';

/**
 * Camera: on the Olympic Village seawall at the water's edge (the data origin), 40 m up, looking slightly
 * down across False Creek. Desktop frames the Yaletown towers and BC Place, with the Cambie Bridge's north
 * approach at the left edge and Harbour Centre to the right; phone centres BC Place.
 * Local metres: x east, y north. bearing: compass degrees; pitch: degrees (negative = down); fov: vertical degrees.
 */
export const CAMERA_POSITION = [0, 0];
/** The real North Shore reads small at ~12 km; a gentle vertical exaggeration makes it feel closer. */
export const MOUNTAIN_EXAGGERATION = 1.2;
export const CAMERA_HEIGHT = 40;
export const FRAMING = {
  desktop: { bearing: 320, pitch: -2.6, fov: 35 },
  phone: { bearing: 331, pitch: -4.5, fov: 60 },
};

/**
 * Quality tiers. Phones start at "medium" (the four phone savings: 1.5× pixel density, quarter-res bloom,
 * quarter-res reflection, fewer lights). Adaptive quality (runtime.js) can drop a tier at a time.
 */
export const TIERS = {
  high: { pixelRatio: 2, reflectionScale: 0.5, bloomScale: 0.5, bloom: true, lightShare: 1, samples: 0 },
  medium: { pixelRatio: 1.5, reflectionScale: 0.25, bloomScale: 0.25, bloom: true, lightShare: 0.6, samples: 0 },
  low: { pixelRatio: 1, reflectionScale: 0.25, bloomScale: 0.25, bloom: false, lightShare: 0.35, samples: 0 },
};
export const TIER_ORDER = ['high', 'medium', 'low'];

/** Portrait screens use the phone framing (BC Place centred); landscape uses the desktop framing. */
export const framingFor = (aspect) => (aspect < 1 ? FRAMING.phone : FRAMING.desktop);
/** Where scrolling turns the camera: Science World sits ~60° east of north, so end with it in frame. */
export const TURN_BEARING = { desktop: 38, phone: 56 };

const SCENE_DETAIL = {
  desktop: { lod: { farDistance: 1300, farMinHeight: 10 }, demStride: 1, northShoreLights: 2600, boatDistance: 2400, lampSpacing: 34, carSpacing: [18, 48] },
  phone: { lod: { farDistance: 900, farMinHeight: 14 }, demStride: 2, northShoreLights: 1400, boatDistance: 1600, lampSpacing: 52, carSpacing: [30, 70] },
};

function insideRing([x, y], r) {
  let hit = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    if (r[i][1] > y !== r[j][1] > y && x < ((r[j][0] - r[i][0]) * (y - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) hit = !hit;
  }
  return hit;
}

function createSky(uniforms) {
  const g = new THREE.SphereGeometry(30000, 48, 24);
  const m = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      ${skyGlsl}
      varying vec3 vDir;
      uniform float uTime;
      void main() { gl_FragColor = vec4(skyWithClouds(normalize(vDir), uTime), 1.0); }
    `,
  });
  const sky = new THREE.Mesh(g, m);
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  return sky;
}

const bearingTo = ([x, y]) => ((Math.atan2(x - CAMERA_POSITION[0], y - CAMERA_POSITION[1]) * 180) / Math.PI + 360) % 360;
const distanceTo = ([x, y]) => Math.hypot(x - CAMERA_POSITION[0], y - CAMERA_POSITION[1]);
const angleDiff = (a, b) => ((a - b + 540) % 360) - 180;

/**
 * @param {{ canvas, width, height, layout: 'desktop'|'phone', tier?: string, dataUrl?: string, terrain?: 'dem'|'procedural', maxPixelRatio?: number }} opts
 */
export async function createSkylineScene({ canvas, width, height, layout = 'desktop', tier, dataUrl = '/data/skyline.json', terrain = 'dem', maxPixelRatio = Infinity, devicePixelRatio, preserveDrawingBuffer = false }) {
  const detail = SCENE_DETAIL[layout];
  let framing = framingFor(width / height);
  let tierName = tier ?? (layout === 'phone' ? 'medium' : 'high');
  let q = TIERS[tierName];
  const timings = {};
  const t0 = performance.now();
  const devicePR = devicePixelRatio ?? (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
  const prFor = (t) => Math.min(t.pixelRatio, Math.max(1, devicePR), maxPixelRatio);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer });
  renderer.setPixelRatio(prFor(q));
  renderer.setSize(width, height, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;

  const camera = new THREE.PerspectiveCamera(framing.fov, width / height, 4, 40000);
  const aim = (bearing, pitch) => {
    const b = THREE.MathUtils.degToRad(bearing), p = THREE.MathUtils.degToRad(pitch);
    camera.position.set(CAMERA_POSITION[0], CAMERA_HEIGHT, -CAMERA_POSITION[1]);
    camera.lookAt(camera.position.x + Math.sin(b) * Math.cos(p), CAMERA_HEIGHT + Math.sin(p), camera.position.z - Math.cos(b) * Math.cos(p));
  };
  aim(framing.bearing, framing.pitch);
  /** Point the camera: bearing/pitch in degrees, fov (vertical, degrees) optional. */
  const look = ({ bearing, pitch, fov }) => {
    if (fov !== undefined && fov !== camera.fov) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
      uniforms.uTanHalfFov.value = Math.tan(THREE.MathUtils.degToRad(fov / 2));
    }
    aim(bearing, pitch);
  };

  const uniforms = {
    uSunDir: { value: new THREE.Vector3(...sunDirection()) },
    uFogDensity: { value: 0.00006 },
    uMountainHaze: { value: 0.00005 },
    uTime: { value: 3.0 },
    uWindowIntensity: { value: 1.35 },
    uPixelHeight: { value: height * renderer.getPixelRatio() },
    uTanHalfFov: { value: Math.tan(THREE.MathUtils.degToRad(framing.fov / 2)) },
  };

  const scene = new THREE.Scene();
  scene.add(createSky(uniforms));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(createSky(uniforms));
  const envMap = pmrem.fromScene(envScene, 0, 1, 40000).texture;
  scene.add(new THREE.HemisphereLight(0x3a4a7a, 0x07080c, 0.9));
  const west = new THREE.DirectionalLight(0xff9a4a, 0.35);
  west.position.set(...sunDirection().map((v) => v * 1000)).setY(60);
  scene.add(west);
  scene.fog = new THREE.FogExp2(new THREE.Color(0.04, 0.06, 0.14), uniforms.uFogDensity.value);
  timings.setup = performance.now() - t0;

  // Yield to the browser between construction stages so no single task blocks input for long.
  const breathe = () => new Promise((r) => setTimeout(r, 0));
  await breathe();
  let t = performance.now();
  const data = await loadSkyline(dataUrl);
  await breathe();
  timings.loadData = performance.now() - t;
  const L = data.landmarks;
  const isWater = data.waterMask.isWater;

  // Composition culls (documented in the report): south-shore buildings right beside the camera, and the
  // low blocks between the camera and BC Place that hide its base.
  const bcBearing = L.bcPlace ? bearingTo(L.bcPlace.center) : 0;
  const bcDistance = L.bcPlace ? distanceTo(L.bcPlace.center) : 0;
  const culled = { southShore: 0, frontOfBcPlace: 0, signatures: 0 };
  // Signature towers replace the data buildings inside their (slightly enlarged) footprints.
  const sigRings = data.signatures.map((sg) => {
    const cx = sg.ring.reduce((t, p) => t + p[0], 0) / sg.ring.length, cy = sg.ring.reduce((t, p) => t + p[1], 0) / sg.ring.length;
    return sg.ring.map(([x, y]) => [cx + (x - cx) * 1.2, cy + (y - cy) * 1.2]);
  });
  const buildingList = data.buildings.filter((b) => {
    if (sigRings.some((r) => insideRing(b.c, r))) { culled.signatures++; return false; }
    const d = distanceTo(b.c);
    if (d < 700 && b.c[1] < 150) {
      let crossesWater = false;
      for (let i = 1; i <= 12 && !crossesWater; i++) {
        const k = i / 13;
        crossesWater = isWater(CAMERA_POSITION[0] + (b.c[0] - CAMERA_POSITION[0]) * k, CAMERA_POSITION[1] + (b.c[1] - CAMERA_POSITION[1]) * k);
      }
      if (!crossesWater) { culled.southShore++; return false; }
    }
    if (L.bcPlace && b.h < 32 && d < bcDistance - 90 && Math.abs(angleDiff(bearingTo(b.c), bcBearing)) < 15) {
      culled.frontOfBcPlace++;
      return false;
    }
    return true;
  });

  t = performance.now();
  const { group: buildings, stats } = await createBuildings(buildingList, uniforms, { camera: CAMERA_POSITION, lod: detail.lod });
  scene.add(buildings);
  timings.buildingsWorker = performance.now() - t;
  const signatures = createSignatures(data.signatures, createFacadeMaterial(uniforms));
  signatures.mesh.userData.signatures = true;
  scene.add(signatures.mesh);

  await breathe();
  t = performance.now();
  const lights = []; // { p, color, size, priority } — lower priority are dropped first on low tiers
  const addLights = (list, priority) => list.forEach((l) => lights.push({ ...l, priority }));
  addLights(signatures.crownLights, 0);

  if (L.bcPlace) {
    const bc = bcPlace(L.bcPlace, envMap);
    scene.add(bc.group);
    addLights(bc.mastLights.map((v) => ({ p: [v.x, v.y, v.z], color: [5, 5, 5.5], size: 0.5 })), 1);
  }
  if (L.harbourCentre) {
    const hc = harbourCentre(L.harbourCentre, envMap);
    scene.add(hc.group);
    addLights([{ p: hc.beacon, color: [14, 9, 5], size: 3.2 }], 0);
  }
  if (L.scienceWorld) {
    const sw = scienceWorld(L.scienceWorld, envMap);
    scene.add(sw.group);
    addLights(sw.lights.map((p) => ({ p, color: [3.2, 3.4, 3.8], size: 0.45 })), 1);
  }

  // Hotspot anchors (world coordinates) for the interactive hero.
  const anchors = {};
  if (L.bcPlace) anchors.bcPlace = [L.bcPlace.center[0], 64, -L.bcPlace.center[1]];
  if (L.harbourCentre) anchors.harbourCentre = [L.harbourCentre.center[0], 172, -L.harbourCentre.center[1]];
  if (L.scienceWorld) anchors.scienceWorld = [L.scienceWorld.center[0], L.scienceWorld.top + 8, -L.scienceWorld.center[1]];
  // A prominent downtown tower: the tallest in the desktop frame, within 1.6 km.
  const tower = buildingList
    .filter((b) => distanceTo(b.c) < 1600 && Math.abs(angleDiff(bearingTo(b.c), FRAMING.desktop.bearing)) < 22)
    .reduce((best, b) => (!best || b.h > best.h ? b : best), null);
  if (tower) anchors.tower = [tower.c[0], tower.h + 6, -tower.c[1]];

  await breathe();
  const water = createWater(uniforms, data.waterMask, { reflectionScale: q.reflectionScale, width, height, pixelRatio: renderer.getPixelRatio() });
  scene.add(water);
  scene.add(createGround(uniforms));

  await breathe();
  const seawall = createSeawall(data.shoreline, uniforms, { camera: CAMERA_POSITION, isWater });
  scene.add(seawall.group);
  addLights(seawall.lamps, 0);

  let bridgeStats = null;
  const animators = []; // (time) => void, run before every frame

  // Street life: lamps along the downtown streets, traffic on the main roads.
  const streets = createStreets(data.roads, { camera: CAMERA_POSITION, lampSpacing: detail.lampSpacing, carSpacing: detail.carSpacing });
  addLights(streets.lamps, 2);
  if (streets.carLights.length) {
    const streetTraffic = createLightPoints(streets.carLights, uniforms);
    scene.add(streetTraffic);
    const sp = streetTraffic.geometry.attributes.position;
    animators.push((time) => { streets.updateTraffic(sp.array, time); sp.needsUpdate = true; });
  }
  if (data.bridge) {
    const br = createBridge(data.bridge, { isWater, envMap });
    scene.add(br.group);
    addLights(br.lights, 0);
    bridgeStats = br.stats;
    // Moving traffic: its own light layer, positions rewritten each frame.
    const traffic = createLightPoints(br.carLights, uniforms);
    scene.add(traffic);
    const pos = traffic.geometry.attributes.position;
    animators.push((time) => { br.updateTraffic(pos.array, time); pos.needsUpdate = true; });
  }

  // Keep the water right below the camera calm (it holds the headline on phones): no boats within 220 m.
  await breathe();
  const boats = createBoats(data.boats, data.docks, { camera: CAMERA_POSITION, minDistance: 220, maxDistance: detail.boatDistance, envMap });
  scene.add(boats.group);
  addLights(boats.lights, 2);
  // Two Aquabus ferries crossing False Creek in the foreground: candidate crossings (bearing/distance
  // pairs from the camera), keeping the first two whose whole path is open water.
  const findWater = (bearing, dist) => {
    for (let r = 0; r < 120; r += 6) {
      for (let a = 0; a < 360; a += 30) {
        const b = THREE.MathUtils.degToRad(bearing), x = CAMERA_POSITION[0] + Math.sin(b) * dist + Math.cos(a) * r, y = CAMERA_POSITION[1] + Math.cos(b) * dist + Math.sin(a) * r;
        if ([[0, 0], [8, 0], [-8, 0], [0, 6], [0, -6]].every(([dx, dy]) => isWater(x + dx, y + dy))) return { x, y };
      }
    }
    return null;
  };
  const pathIsWater = (a, b) => {
    for (let i = 0; i <= 24; i++) if (!isWater(a.x + ((b.x - a.x) * i) / 24, a.y + ((b.y - a.y) * i) / 24)) return false;
    return true;
  };
  const crossings = [
    [[300, 130], [318, 380]],
    [[340, 150], [5, 330]],
    [[290, 220], [325, 430]],
    [[350, 120], [345, 380]],
    [[20, 120], [355, 300]],
  ];
  const ferrySpots = [];
  for (const [[ba, da], [bb, db]] of crossings) {
    if (ferrySpots.length === 2) break;
    const from = findWater(ba, da), to = findWater(bb, db);
    if (from && to && pathIsWater(from, to) && Math.hypot(to.x - from.x, to.y - from.y) > 120) ferrySpots.push({ from, to });
  }
  ferrySpots.forEach((route, i) => {
    const ab = createAquabus({ ...route, phase: i * 23 }, envMap);
    scene.add(ab.group);
    animators.push(ab.update);
  });

  await breathe();
  const dem = terrain === 'dem' ? data.terrain : null;
  const vScale = dem ? MOUNTAIN_EXAGGERATION : 1;
  const heightAt = dem ? (x, y) => demHeightAt(dem, x, y) * vScale : terrainHeight;
  scene.add(createMountains(uniforms, { dem, stride: detail.demStride, verticalScale: vScale }));
  addLights(aviationLights(data.buildings), 0);
  let seed = 11;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  addLights(distantLights(northShoreLightPoints(detail.northShoreLights, heightAt), rand), 3);
  timings.sceneParts = performance.now() - t;

  // Light sprites sorted by priority so low tiers can simply draw fewer of them.
  lights.sort((a, b) => a.priority - b.priority);
  const points = createLightPoints(lights, uniforms);
  scene.add(points);

  const { composer, passes } = createComposer(renderer, scene, camera, {
    width, height, pixelRatio: renderer.getPixelRatio(), samples: q.samples, bloomScale: q.bloomScale,
  });

  function applyTier(name) {
    tierName = name;
    q = TIERS[name];
    const pr = prFor(q);
    renderer.setPixelRatio(pr);
    renderer.setSize(width, height, false);
    composer.setPixelRatio(pr);
    passes.bloomPass.scale = q.bloomScale;
    passes.bloomPass.enabled = q.bloom;
    composer.setSize(width, height);
    passes.grainPass.uniforms.uRes.value.set(width * pr, height * pr);
    water.setReflectionSize(width * pr * q.reflectionScale, height * pr * q.reflectionScale);
    uniforms.uPixelHeight.value = height * pr;
    points.geometry.setDrawRange(0, Math.round(lights.length * q.lightShare));
  }
  applyTier(tierName);
  // Compile all shaders up front, in parallel where the browser supports it (KHR_parallel_shader_compile),
  // instead of stalling the first frame.
  await breathe();
  try { await renderer.compileAsync(scene, camera); } catch { /* falls back to compiling on first render */ }
  timings.total = performance.now() - t0;

  /** Resize the canvas drawing buffer and everything that depends on it; switches framing by aspect. */
  function setSize(w, h) {
    width = w; height = h;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    framing = framingFor(w / h);
    applyTier(tierName);
  }

  const v3 = new THREE.Vector3();
  /** Screen position (CSS px, relative to the canvas) of a hotspot anchor, or null if behind the camera. */
  function project(id) {
    const a = anchors[id];
    if (!a) return null;
    v3.set(a[0], a[1], a[2]).project(camera);
    if (v3.z > 1 || v3.z < -1) return null;
    return { x: ((v3.x + 1) / 2) * width, y: ((1 - v3.y) / 2) * height };
  }
  /** Camera bearing/pitch (degrees) that looks straight at a hotspot anchor. */
  function viewOf(id) {
    const a = anchors[id];
    if (!a) return null;
    const dx = a[0] - camera.position.x, dz = a[2] - camera.position.z, dy = a[1] - 12 - camera.position.y;
    return {
      bearing: ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360,
      pitch: (Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI,
    };
  }

  return {
    renderer, scene, camera, composer, passes, water, uniforms, points, anchors, project, viewOf,
    get tier() { return tierName; },
    get framing() { return framing; },
    setTier: applyTier,
    setSize,
    aim,
    look,
    stats: {
      ...stats, culled, lights: lights.length, bridge: bridgeStats, boats: boats.stats, seawall: seawall.stats,
      ferries: ferrySpots.length, streets: streets.stats, signatures: data.signatures.length, pixelRatio: renderer.getPixelRatio(), tier: tierName,
    },
    timings,
    render: (time) => {
      if (time !== undefined) uniforms.uTime.value = time;
      for (const animate of animators) animate(uniforms.uTime.value);
      composer.render();
    },
  };
}
