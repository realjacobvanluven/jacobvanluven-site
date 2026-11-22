import * as THREE from 'three';
import { loadSkyline } from './skyline-data.js';
import { skyGlsl, sunDirection } from './shaders.js';
import { createBuildings } from './buildings.js';
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

const SCENE_DETAIL = {
  desktop: { lod: { farDistance: 1300, farMinHeight: 10 }, demStride: 1, northShoreLights: 2600, boatDistance: 2400 },
  phone: { lod: { farDistance: 900, farMinHeight: 14 }, demStride: 2, northShoreLights: 1400, boatDistance: 1600 },
};

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
      void main() { gl_FragColor = vec4(skyColor(normalize(vDir)), 1.0); }
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
export async function createSkylineScene({ canvas, width, height, layout = 'desktop', tier, dataUrl = '/data/skyline.json', terrain = 'dem', maxPixelRatio = Infinity, devicePixelRatio }) {
  const detail = SCENE_DETAIL[layout];
  const framing = FRAMING[layout];
  let tierName = tier ?? (layout === 'phone' ? 'medium' : 'high');
  let q = TIERS[tierName];
  const timings = {};
  const t0 = performance.now();
  const devicePR = devicePixelRatio ?? (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
  const prFor = (t) => Math.min(t.pixelRatio, Math.max(1, devicePR), maxPixelRatio);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
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

  let t = performance.now();
  const data = await loadSkyline(dataUrl);
  timings.loadData = performance.now() - t;
  const L = data.landmarks;
  const isWater = data.waterMask.isWater;

  // Composition culls (documented in the report): south-shore buildings right beside the camera, and the
  // low blocks between the camera and BC Place that hide its base.
  const bcBearing = L.bcPlace ? bearingTo(L.bcPlace.center) : 0;
  const bcDistance = L.bcPlace ? distanceTo(L.bcPlace.center) : 0;
  const culled = { southShore: 0, frontOfBcPlace: 0 };
  const buildingList = data.buildings.filter((b) => {
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

  t = performance.now();
  const lights = []; // { p, color, size, priority } — lower priority are dropped first on low tiers
  const addLights = (list, priority) => list.forEach((l) => lights.push({ ...l, priority }));

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

  const water = createWater(uniforms, data.waterMask, { reflectionScale: q.reflectionScale, width, height, pixelRatio: renderer.getPixelRatio() });
  scene.add(water);
  scene.add(createGround(uniforms));

  const seawall = createSeawall(data.shoreline, uniforms, { camera: CAMERA_POSITION, isWater });
  scene.add(seawall.group);
  addLights(seawall.lamps, 0);

  let bridgeStats = null;
  if (data.bridge) {
    const br = createBridge(data.bridge, { isWater, envMap });
    scene.add(br.group);
    addLights(br.lights, 0);
    bridgeStats = br.stats;
  }

  // Keep the water right below the camera calm (it holds the headline on phones): no boats within 220 m.
  const boats = createBoats(data.boats, data.docks, { camera: CAMERA_POSITION, minDistance: 220, maxDistance: detail.boatDistance, envMap });
  scene.add(boats.group);
  addLights(boats.lights, 2);
  // Two Aquabus ferries in the foreground water, heading along False Creek: nearest open water to a
  // couple of spots in frame.
  const findWater = (bearing, dist) => {
    for (let r = 0; r < 120; r += 6) {
      for (let a = 0; a < 360; a += 30) {
        const b = THREE.MathUtils.degToRad(bearing), x = CAMERA_POSITION[0] + Math.sin(b) * dist + Math.cos(a) * r, y = CAMERA_POSITION[1] + Math.cos(b) * dist + Math.sin(a) * r;
        if ([[0, 0], [8, 0], [-8, 0], [0, 6], [0, -6]].every(([dx, dy]) => isWater(x + dx, y + dy))) return { x, y };
      }
    }
    return null;
  };
  const ferrySpots = [
    { ...findWater(framing.bearing + 8, 260), heading: 2.9 },
    { ...findWater(framing.bearing - 14, 420), heading: -0.2 },
  ].filter((f) => f.x !== undefined);
  for (const f of ferrySpots) {
    const ab = createAquabus(f, envMap);
    scene.add(ab.group);
    addLights(ab.lights, 1);
  }

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
  timings.total = performance.now() - t0;

  return {
    renderer, scene, camera, composer, passes, water, uniforms, points,
    get tier() { return tierName; },
    setTier: applyTier,
    aim,
    stats: {
      ...stats, culled, lights: lights.length, bridge: bridgeStats, boats: boats.stats, seawall: seawall.stats,
      ferries: ferrySpots.length, pixelRatio: renderer.getPixelRatio(), tier: tierName,
    },
    timings,
    render: (time) => {
      if (time !== undefined) uniforms.uTime.value = time;
      composer.render();
    },
  };
}
