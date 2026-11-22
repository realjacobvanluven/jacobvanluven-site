import * as THREE from 'three';

/**
 * Hand-built landmarks, placed from the footprint parts they replace (see skyline-data.js).
 * Lit with the scene's hemisphere/west light plus a sky environment map. Positions: world X = x, Z = -y.
 */

const hdr = (r, g, b, k) => new THREE.Color(r * k, g * k, b * k);

/** BC Place: oval bowl, cable-supported fabric roof, 36 masts and the orange LED ring. */
export function bcPlace({ center, angle, a, b }, envMap) {
  const group = new THREE.Group();
  const wallH = 32, roofRise = 24;
  const rx = a * 0.97, rz = b * 0.97;

  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(1, 1.04, wallH, 96, 1, true),
    new THREE.MeshStandardMaterial({
      color: 0x6a707a, roughness: 0.8, metalness: 0.05, envMap, envMapIntensity: 0.6,
      emissive: new THREE.Color(0.025, 0.027, 0.032), // floodlit panels
    }),
  );
  wall.scale.set(rx, 1, rz);
  wall.position.y = wallH / 2;
  group.add(wall);

  // Concourse glazing: a lit band around the bowl.
  const band = new THREE.Mesh(
    new THREE.CylinderGeometry(1.006, 1.012, 3.2, 96, 1, true),
    new THREE.MeshBasicMaterial({ color: hdr(1, 0.72, 0.45, 1.3) }),
  );
  band.scale.set(rx, 1, rz);
  band.position.y = 12;
  group.add(band);

  const roof = new THREE.Mesh(
    new THREE.SphereGeometry(1, 96, 20, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({
      color: 0xf4f5f7, roughness: 0.95, metalness: 0.0, envMap, envMapIntensity: 0.25,
      emissive: new THREE.Color(0.16, 0.155, 0.15), // white fabric, glowing softly from the lit stadium inside
    }),
  );
  roof.scale.set(rx * 0.96, roofRise, rz * 0.96);
  roof.position.y = wallH;
  group.add(roof);

  // Masts around the rim, leaning slightly outward.
  const masts = 36, mastH = 46;
  const mastMesh = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.45, 0.7, mastH, 6),
    new THREE.MeshStandardMaterial({ color: 0xe6e9ee, roughness: 0.5, metalness: 0.1, envMap, emissive: new THREE.Color(0.05, 0.05, 0.055) }),
    masts,
  );
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1);
  const tops = [];
  for (let i = 0; i < masts; i++) {
    const t = (i / masts) * Math.PI * 2;
    const x = Math.cos(t) * rx * 1.01, z = Math.sin(t) * rz * 1.01;
    const out = new THREE.Vector3(x, 0, z).normalize();
    q.setFromAxisAngle(new THREE.Vector3(-out.z, 0, out.x), 0.1);
    const p = new THREE.Vector3(x, wallH - 8 + mastH / 2, z);
    m.compose(p, q, s);
    mastMesh.setMatrixAt(i, m);
    tops.push(new THREE.Vector3(0, mastH / 2, 0).applyQuaternion(q).add(p));
  }
  group.add(mastMesh);

  // The orange LED ring along the roof edge.
  const ringPts = [];
  for (let i = 0; i < 128; i++) {
    const t = (i / 128) * Math.PI * 2;
    ringPts.push(new THREE.Vector3(Math.cos(t) * rx * 1.005, wallH + 0.6, Math.sin(t) * rz * 1.005));
  }
  const ring = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ringPts, true), 256, 0.9, 6, true),
    new THREE.MeshBasicMaterial({ color: hdr(1, 0.42, 0.08, 5) }),
  );
  group.add(ring);

  group.rotation.y = angle; // footprint long axis (local x→y rotation maps to world -Z, so same sign)
  group.position.set(center[0], 0, -center[1]);
  group.updateMatrixWorld(true);
  const mastLights = tops.map((p) => p.applyMatrix4(group.matrixWorld));
  return { group, mastLights };
}

/** Harbour Centre: concrete shaft, the lookout "saucer" with a lit window ring, antenna and beacon. */
export function harbourCentre({ center }, envMap) {
  const group = new THREE.Group();
  const concrete = new THREE.MeshStandardMaterial({ color: 0x5a5f68, roughness: 0.8, envMap, envMapIntensity: 0.5 });

  const shaft = new THREE.Mesh(new THREE.BoxGeometry(19, 118, 19), concrete);
  shaft.position.y = 59;
  group.add(shaft);

  // Glass elevator tracks up the face (lit faintly).
  const track = new THREE.Mesh(new THREE.BoxGeometry(3, 112, 0.6), new THREE.MeshBasicMaterial({ color: hdr(1, 0.8, 0.6, 0.6) }));
  track.position.set(0, 58, 9.8);
  group.add(track);

  const profile = [[0, 117], [11, 117], [19, 120], [21.5, 124], [21.5, 130], [18, 134], [9, 137], [0, 137]].map(
    ([r, y]) => new THREE.Vector2(r, y),
  );
  const saucer = new THREE.Mesh(new THREE.LatheGeometry(profile, 48), concrete);
  group.add(saucer);

  const windows = new THREE.Mesh(
    new THREE.CylinderGeometry(21.7, 21.7, 4.2, 48, 1, true),
    new THREE.MeshBasicMaterial({ color: hdr(1, 0.7, 0.42, 2.4) }),
  );
  windows.position.y = 127;
  group.add(windows);

  const cap = new THREE.Mesh(new THREE.CylinderGeometry(5, 6, 5, 16), concrete);
  cap.position.y = 139.5;
  group.add(cap);
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.6, 24, 6), concrete);
  antenna.position.y = 154;
  group.add(antenna);

  group.position.set(center[0], 0, -center[1]);
  return { group, beacon: [center[0], 166.5, -center[1]] };
}

/** Science World: geodesic dome on a short pedestal, with its lights on the triangle vertices. */
export function scienceWorld({ center, radius, top }, envMap) {
  const group = new THREE.Group();
  const r = Math.max(radius, 17);
  const cy = top - r;

  const dome = new THREE.Mesh(
    new THREE.IcosahedronGeometry(r, 3),
    new THREE.MeshStandardMaterial({ color: 0xc8ced6, metalness: 0.85, roughness: 0.28, envMap, envMapIntensity: 1.3, flatShading: true }),
  );
  dome.position.y = cy;
  group.add(dome);

  const pedestal = new THREE.Mesh(
    new THREE.CylinderGeometry(r * 0.45, r * 0.55, cy, 24),
    new THREE.MeshStandardMaterial({ color: 0x23262c, roughness: 0.9 }),
  );
  pedestal.position.y = cy / 2;
  group.add(pedestal);

  group.position.set(center[0], 0, -center[1]);

  // Unique vertices of a coarser icosphere = light positions.
  const ico = new THREE.IcosahedronGeometry(r * 1.01, 2);
  const seen = new Set();
  const lights = [];
  const p = ico.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(2)},${p.getY(i).toFixed(2)},${p.getZ(i).toFixed(2)}`;
    if (seen.has(key) || p.getY(i) < -r * 0.45) continue;
    seen.add(key);
    lights.push([center[0] + p.getX(i), cy + p.getY(i), -center[1] + p.getZ(i)]);
  }
  return { group, lights };
}
