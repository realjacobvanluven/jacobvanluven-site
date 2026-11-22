import * as THREE from 'three';

/**
 * Marinas and boats on False Creek: dock floats (from OSM), moored boats placed along them by the data
 * script, and Aquabus ferries (small rainbow-striped passenger boats). Moored boats are instanced;
 * the Aquabus positions are returned so they can be animated later.
 */

/** Hull with a pointed bow: unit length along +x (bow at +0.5), unit beam, unit depth. */
function hullGeometry() {
  const s = new THREE.Shape();
  s.moveTo(-0.5, -0.42); s.lineTo(0.22, -0.5); s.lineTo(0.5, 0); s.lineTo(0.22, 0.5); s.lineTo(-0.5, 0.42); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false });
  g.rotateX(-Math.PI / 2); // shape y → -z, extrusion → +y
  g.translate(0, -0.35, 0);
  return g;
}

export function createBoats(boats, docks, { camera = [0, 0], minDistance = 0, maxDistance = 2400, envMap = null } = {}) {
  const near = (x, y) => { const d = Math.hypot(x - camera[0], y - camera[1]); return d < maxDistance && d > minDistance; };
  const list = boats.filter((b) => near(b.x, b.y));
  const group = new THREE.Group();
  const lights = [];
  const white = new THREE.MeshStandardMaterial({ color: 0xdfe3e8, roughness: 0.5, envMap, envMapIntensity: 0.8 });
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);

  const hulls = new THREE.InstancedMesh(hullGeometry(), white, list.length);
  const cabins = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), white, list.length);
  const sails = list.filter((b) => b.sail);
  const masts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.09, 1, 4), new THREE.MeshStandardMaterial({ color: 0xb8bec6, roughness: 0.4 }), sails.length);
  let seed = 17, mi = 0;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  list.forEach((b, i) => {
    q.setFromAxisAngle(up, b.heading);
    const beam = b.length * 0.32;
    m.compose(new THREE.Vector3(b.x, 0.25, -b.y), q, new THREE.Vector3(b.length, b.sail ? 1.1 : 1.6, beam));
    hulls.setMatrixAt(i, m);
    const cabinLen = b.length * (b.sail ? 0.3 : 0.45);
    const back = new THREE.Vector3(-b.length * 0.1, 0, 0).applyQuaternion(q);
    m.compose(new THREE.Vector3(b.x + back.x, 1.6, -b.y + back.z), q, new THREE.Vector3(cabinLen, b.sail ? 1.0 : 1.8, beam * 0.75));
    cabins.setMatrixAt(i, m);
    if (b.sail) {
      const h = b.length * 1.3;
      m.compose(new THREE.Vector3(b.x, 1 + h / 2, -b.y), new THREE.Quaternion(), new THREE.Vector3(1, h, 1));
      masts.setMatrixAt(mi++, m);
      lights.push({ p: [b.x, 1.2 + h, -b.y], color: [3.2, 3.2, 3.0], size: 0.25 }); // anchor light
    }
    if (rand() < 0.18) lights.push({ p: [b.x + back.x, 2.2, -b.y + back.z], color: [3.5, 2.1, 0.9], size: 0.45 }); // someone aboard
  });
  group.add(hulls, cabins, masts);

  // Dock floats: thin flat strips along each dock line.
  const pos = [];
  for (const line of docks) {
    if (!line.every(([x, y]) => near(x, y))) continue;
    for (let i = 1; i < line.length; i++) {
      const [ax, ay] = line[i - 1], [bx, by] = line[i];
      const len = Math.hypot(bx - ax, by - ay) || 1;
      const nx = (-(by - ay) / len) * 1.2, ny = ((bx - ax) / len) * 1.2;
      const v = [[ax + nx, ay + ny], [bx + nx, by + ny], [bx - nx, by - ny], [ax - nx, ay - ny]].map(([x, y]) => [x, 0.45, -y]);
      for (const k of [0, 1, 2, 0, 2, 3]) pos.push(...v[k]);
      for (let s = 10; s < len; s += 30) {
        const t = s / len;
        lights.push({ p: [ax + (bx - ax) * t, 1.1, -(ay + (by - ay) * t)], color: [2.6, 1.7, 0.8], size: 0.3 });
      }
    }
  }
  const dockGeo = new THREE.BufferGeometry();
  dockGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  dockGeo.computeVertexNormals();
  group.add(new THREE.Mesh(dockGeo, new THREE.MeshLambertMaterial({ color: 0x2a2826, side: THREE.DoubleSide })));
  return { group, lights, stats: { boats: list.length, sail: sails.length } };
}

/** Rainbow stripes for the Aquabus hull sides. */
function rainbowTexture() {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 64;
  const ctx = c.getContext('2d');
  const bands = ['#e8312f', '#f58a1f', '#f7d031', '#3db54a', '#1f8fd6', '#6a3fa0'];
  bands.forEach((col, i) => { ctx.fillStyle = col; ctx.fillRect(0, (i * 64) / bands.length, 4, 64 / bands.length + 1); });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * An Aquabus: rainbow-striped hull, white canopy, lit cabin. Shuttles back and forth between two points
 * on the water (`from`, `to`, local metres), easing in and out and waiting a few seconds at each end.
 * Call update(time) every frame.
 */
export function createAquabus({ from, to, speed = 4.5, dwell = 6, phase = 0 }, envMap = null) {
  const group = new THREE.Group();
  const L = 11, B = 3.8;
  const stripes = new THREE.MeshStandardMaterial({ map: rainbowTexture(), roughness: 0.5, emissive: 0xffffff, emissiveIntensity: 0.05, envMap });
  const hull = new THREE.Mesh(
    new THREE.BoxGeometry(L, 1.3, B),
    [
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }),
      new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.6 }),
      new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.9 }),
      stripes,
      stripes,
    ],
  );
  hull.position.y = 0.5;
  const bow = new THREE.Mesh(new THREE.ConeGeometry(B / 2, 2.4, 4, 1), new THREE.MeshStandardMaterial({ color: 0xe8312f, roughness: 0.6 }));
  bow.rotation.z = -Math.PI / 2;
  bow.rotation.x = Math.PI / 4;
  bow.scale.set(1, 1, 0.62);
  bow.position.set(L / 2 + 1.1, 0.5, 0);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(L * 0.62, 1.5, B * 0.86), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 1.05, 0.6) }));
  cabin.position.set(-0.6, 1.9, 0);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(L * 0.7, 0.18, B * 0.95), new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6, envMap }));
  roof.position.set(-0.6, 2.75, 0);
  // Masthead light (bright enough to bloom) travels with the boat.
  const masthead = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 5, 4.6) }));
  masthead.position.set(1.5, 3.4, 0);
  group.add(hull, bow, cabin, roof, masthead);

  const dx = to.x - from.x, dy = to.y - from.y;
  const D = Math.hypot(dx, dy);
  const travel = D / speed;
  const cycle = 2 * (travel + dwell);
  const smooth = (t) => t * t * (3 - 2 * t);

  function update(time) {
    let u = (((time + phase) % cycle) + cycle) % cycle;
    let k, outbound;
    if (u < dwell) { k = 0; outbound = true; }
    else if (u < dwell + travel) { k = smooth((u - dwell) / travel); outbound = true; }
    else if (u < 2 * dwell + travel) { k = 1; outbound = false; }
    else { k = 1 - smooth((u - 2 * dwell - travel) / travel); outbound = false; }
    const x = from.x + dx * k, y = from.y + dy * k;
    group.position.set(x, 0, -y);
    // Bow points the way it's going (local +x → heading); a gentle bob on the ripples.
    const heading = Math.atan2(outbound ? dy : -dy, outbound ? dx : -dx);
    group.rotation.set(0, heading, Math.sin(time * 1.3 + phase) * 0.015);
    group.position.y = Math.sin(time * 1.7 + phase) * 0.08;
  }
  update(0);
  return { group, update, lights: [] };
}
