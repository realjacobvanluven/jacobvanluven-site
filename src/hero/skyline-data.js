/**
 * Decodes public/data/skyline.json and prepares it for the scene.
 * Local metres: x east, y north, origin = camera point on the Olympic Village seawall.
 * Three.js world: X = x, Y = up, Z = -y.
 */

const decodeRing = (flat, from = 0) => {
  const pts = [];
  let x = 0, y = 0;
  for (let i = from; i < flat.length; i += 2) {
    x += flat[i];
    y += flat[i + 1];
    pts.push([x / 10, y / 10]);
  }
  return pts;
};

const centroid = (ring) => {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    a += f; cx += (ring[j][0] + ring[i][0]) * f; cy += (ring[j][1] + ring[i][1]) * f;
  }
  return Math.abs(a) < 1e-9 ? ring[0] : [cx / (3 * a), cy / (3 * a)];
};

const inBounds = ([x, y], [x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1;

/** Principal axes of a footprint: centre, angle of the long axis, and half-extents along both axes. */
function orientedExtents(ring) {
  const [cx, cy] = centroid(ring);
  let sxx = 0, syy = 0, sxy = 0;
  for (const [x, y] of ring) { sxx += (x - cx) ** 2; syy += (y - cy) ** 2; sxy += (x - cx) * (y - cy); }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const ux = Math.cos(angle), uy = Math.sin(angle);
  let a = 0, b = 0;
  for (const [x, y] of ring) {
    a = Math.max(a, Math.abs((x - cx) * ux + (y - cy) * uy));
    b = Math.max(b, Math.abs(-(x - cx) * uy + (y - cy) * ux));
  }
  return { center: [cx, cy], angle, a, b };
}

/**
 * @returns {{ buildings: {ring:number[][], h:number, base:number, c:number[]}[], landmarks: object, shoreline: number[][][], raw: object }}
 * Landmark parts (BC Place bowl, Harbour Centre tower, Science World dome) are removed here and
 * replaced by hand-built models; their placement comes from the removed parts.
 */
export async function loadSkyline(url) {
  const raw = await (await fetch(url)).json();
  const lm = raw.landmarks;
  const bounds = (id) => lm[id].bounds.map((v) => v / 10);

  const buildings = [];
  let bcPlace = null, harbourTower = [], scienceDome = null;
  for (const b of raw.buildings) {
    const ring = decodeRing(b, 3);
    const h = b[0] / 10, base = b[1] / 10;
    const c = centroid(ring);
    if (inBounds(c, bounds('bc-place')) && h > 50) { bcPlace = { ring, h }; continue; }
    if (inBounds(c, bounds('harbour-centre')) && h > 100) { harbourTower.push({ ring, h, c }); continue; }
    if (inBounds(c, bounds('science-world')) && h > 30) { scienceDome = { ring, h, c }; continue; }
    buildings.push({ ring, h, base, c });
  }

  const landmarks = {};
  if (bcPlace) landmarks.bcPlace = { ...orientedExtents(bcPlace.ring), height: bcPlace.h };
  if (harbourTower.length) {
    const tallest = harbourTower.reduce((m, p) => (p.h > m.h ? p : m));
    const shaft = harbourTower.reduce((m, p) => (p.h < m.h ? p : m));
    landmarks.harbourCentre = { center: centroid(shaft.ring), top: tallest.h };
  }
  if (scienceDome) {
    const e = orientedExtents(scienceDome.ring);
    landmarks.scienceWorld = { center: e.center, radius: (e.a + e.b) / 2, top: scienceDome.h };
  }

  return { buildings, landmarks, shoreline: raw.shoreline.map((l) => decodeRing(l)), raw };
}
