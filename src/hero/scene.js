import * as THREE from 'three';
import { loadSkyline } from './skyline-data.js';
import { skyGlsl, sunDirection } from './shaders.js';
import { createBuildings } from './buildings.js';
import { createWater, createWaterMask, createGround } from './water.js';
import { createMountains, northShoreLightPoints } from './mountains.js';
import { createLightPoints, seawallLights, aviationLights, distantLights } from './lights.js';
import { bcPlace, harbourCentre, scienceWorld } from './landmarks.js';
import { createComposer } from './post.js';

/**
 * Camera framing (option b): normal lens on downtown from the Olympic Village seawall, 40 m up.
 * bearing: compass degrees; pitch: degrees (negative = down); fov: vertical degrees.
 * The interactive hero will turn the bearing toward Science World (~60°).
 */
export const CAMERA_HEIGHT = 40;
export const FRAMING = {
  desktop: { bearing: 340, pitch: -2.5, fov: 36 },
  phone: { bearing: 342, pitch: -2.5, fov: 50 },
};

/** Quality tiers. Phone settings target a mid-range phone at 60 fps (30 fps floor). */
export const QUALITY = {
  desktop: { pixelRatio: 1, maxPixelRatio: 2, reflectionScale: 0.5, samples: 0, lod: { farDistance: 1300, farMinHeight: 10 }, mountainSegments: [180, 110], northShoreLights: 2600 },
  phone: { pixelRatio: 2, maxPixelRatio: 2, reflectionScale: 0.35, samples: 0, lod: { farDistance: 900, farMinHeight: 14 }, mountainSegments: [110, 70], northShoreLights: 1600 },
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

export async function createSkylineScene({ canvas, width, height, preset = 'desktop', dataUrl = '/data/skyline.json' }) {
  const q = QUALITY[preset];
  const framing = FRAMING[preset];
  const timings = {};
  const t0 = performance.now();

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(q.pixelRatio, q.maxPixelRatio));
  renderer.setSize(width, height, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;

  const camera = new THREE.PerspectiveCamera(framing.fov, width / height, 4, 40000);
  const b = THREE.MathUtils.degToRad(framing.bearing), p = THREE.MathUtils.degToRad(framing.pitch);
  camera.position.set(0, CAMERA_HEIGHT, 0);
  camera.lookAt(Math.sin(b) * Math.cos(p), CAMERA_HEIGHT + Math.sin(p), -Math.cos(b) * Math.cos(p));

  const pr = renderer.getPixelRatio();
  const uniforms = {
    uSunDir: { value: new THREE.Vector3(...sunDirection()) },
    uFogDensity: { value: 0.00006 },
    uMountainHaze: { value: 0.000075 },
    uTime: { value: 3.0 },
    uWindowIntensity: { value: 1.25 },
    uPixelHeight: { value: height * pr },
    uTanHalfFov: { value: Math.tan(THREE.MathUtils.degToRad(framing.fov / 2)) },
  };

  const scene = new THREE.Scene();
  const sky = createSky(uniforms);
  scene.add(sky);

  // Environment map from the sky, for the landmarks' metal and fabric.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(createSky(uniforms));
  const envMap = pmrem.fromScene(envScene, 0, 1, 40000).texture;
  scene.add(new THREE.HemisphereLight(0x3a4a7a, 0x07080c, 0.9));
  const west = new THREE.DirectionalLight(0xff8a4a, 0.35);
  west.position.set(...sunDirection().map((v) => v * 1000)).setY(60);
  scene.add(west);
  scene.fog = new THREE.FogExp2(new THREE.Color(0.04, 0.06, 0.14), uniforms.uFogDensity.value);
  timings.setup = performance.now() - t0;

  let t = performance.now();
  const data = await loadSkyline(dataUrl);
  timings.loadData = performance.now() - t;

  t = performance.now();
  const L = data.landmarks;
  const mask = createWaterMask(data.shoreline);
  timings.waterMask = performance.now() - t;
  // Composition: drop south-shore buildings right beside the camera (same shore, within 700 m),
  // which would otherwise wall off the left of the frame. Everything across the water stays.
  const sameShore = (b) => {
    const [x, y] = b.c;
    if (Math.hypot(x, y) > 700 || y > 150) return false;
    for (let i = 1; i <= 12; i++) if (mask.userData.isWater((x * i) / 13, (y * i) / 13)) return false;
    return true;
  };
  const buildingList = data.buildings.filter((b) => !sameShore(b));
  const { group: buildings, stats } = createBuildings(buildingList, uniforms, q.lod);
  stats.culledSouthShore = data.buildings.length - buildingList.length;
  scene.add(buildings);
  timings.buildings = performance.now() - t;

  t = performance.now();
  const landmarkLights = [];
  if (L.bcPlace) {
    const bc = bcPlace(L.bcPlace, envMap);
    scene.add(bc.group);
    landmarkLights.push(...bc.mastLights.map((v) => ({ p: [v.x, v.y, v.z], color: [6, 6, 6.5], size: 0.7 })));
  }
  if (L.harbourCentre) {
    const hc = harbourCentre(L.harbourCentre, envMap);
    scene.add(hc.group);
    landmarkLights.push({ p: hc.beacon, color: [14, 9, 5], size: 3.2 }); // subtle beacon: findable, not flashing
  }
  if (L.scienceWorld) {
    const sw = scienceWorld(L.scienceWorld, envMap);
    scene.add(sw.group);
    landmarkLights.push(...sw.lights.map((p) => ({ p, color: [3.2, 3.4, 3.8], size: 0.45 })));
  }
  timings.landmarks = performance.now() - t;

  const water = createWater(uniforms, mask, { reflectionScale: q.reflectionScale, width, height, pixelRatio: pr });
  scene.add(water);
  scene.add(createGround(uniforms));

  t = performance.now();
  const mountains = createMountains(uniforms, { segmentsX: q.mountainSegments[0], segmentsY: q.mountainSegments[1] });
  scene.add(mountains);
  timings.mountains = performance.now() - t;

  let seed = 11;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const lights = [
    ...seawallLights(data.shoreline),
    ...aviationLights(data.buildings),
    ...distantLights(northShoreLightPoints(q.northShoreLights), rand),
    ...landmarkLights,
  ];
  scene.add(createLightPoints(lights, uniforms));

  const { composer, passes } = createComposer(renderer, scene, camera, { width, height, pixelRatio: pr, samples: q.samples });
  timings.total = performance.now() - t0;

  return {
    renderer, scene, camera, composer, passes, water, uniforms,
    stats: { ...stats, lights: lights.length, pixelRatio: pr },
    timings,
    render: () => composer.render(),
  };
}
