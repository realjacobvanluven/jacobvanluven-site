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

const pointInRing = ([x, y], ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
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
export { orientedExtents, centroid };

export async function loadSkyline(url) {
  const raw = await (await fetch(url)).json();
  const lm = raw.landmarks;
  const bounds = (id) => lm[id].bounds.map((v) => v / 10);

  const buildings = [];
  let bcPlace = null, harbourTower = [], scienceDome = null;
  // Rogers Arena: its mapped footprint; the stepped parts inside it are replaced by the hand-built model.
  const arenaRing = lm['rogers-arena']?.ring ? decodeRing(lm['rogers-arena'].ring) : null;
  const arenaParts = [];
  for (const b of raw.buildings) {
    const ring = decodeRing(b, 3);
    const h = b[0] / 10, base = b[1] / 10;
    const c = centroid(ring);
    if (inBounds(c, bounds('bc-place')) && h > 50) { bcPlace = { ring, h }; continue; }
    if (inBounds(c, bounds('harbour-centre')) && h > 100) { harbourTower.push({ ring, h, c }); continue; }
    if (inBounds(c, bounds('science-world')) && h > 30) { scienceDome = { ring, h, c }; continue; }
    if (arenaRing && h > 8 && pointInRing(c, arenaRing)) { arenaParts.push(h); continue; }
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

  if (arenaRing && arenaParts.length) landmarks.rogersArena = { ring: arenaRing, height: Math.max(...arenaParts) };

  return {
    buildings, landmarks,
    shoreline: raw.shoreline.map((l) => decodeRing(l)),
    waterMask: decodeWaterMask(raw.waterMask),
    terrain: decodeTerrain(raw.terrain),
    bridges: (raw.bridges ?? []).map((b) => ({ id: b.id, line: b.line.map((p) => p.map((v) => v / 10)) })),
    ramps: (raw.ramps ?? []).map((r) => ({ ...r, line: r.line.map((p) => p.map((v) => v / 10)) })),
    docks: (raw.docks ?? []).map((l) => decodeRing(l)),
    boats: (raw.boats ?? []).map(([x, y, a, len, kind]) => ({ x: x / 10, y: y / 10, heading: (a / 1800) * Math.PI, length: len / 10, sail: kind === 1 })),
    southTerrain: raw.southTerrain ?? null,
    causeways: (raw.causeways ?? []).map((c) => c.map((v) => v / 10)),
    granville: {
      buildings: (raw.granville?.buildings ?? []).map((b) => ({ h: b[0] / 10, base: b[1] / 10, ring: decodeRing(b, 2) })),
      silos: (raw.granville?.silos ?? []).map(([x, y, r, h]) => ({ c: [x / 10, y / 10], r: r / 10, h: h / 10 })),
    },
    signatures: (raw.signatures ?? []).map((sg) => ({ id: sg.id, height: sg.height, ring: decodeRing(sg.ring) })),
    viaducts: (raw.viaducts ?? []).map((l) => decodeRing(l)),
    roads: (raw.roads ?? []).map(([cls, ...line]) => ({ main: cls === 0, line: decodeRing(line) })),
    paths: (raw.paths ?? []).map(([cls, ...line]) => ({ cycle: cls === 1, line: decodeRing(line) })),
    greens: (raw.greens ?? []).map(([kind, ...ring]) => ({ kind, ring: decodeRing(ring) })),
    trees: raw.trees ? decodeRing(raw.trees) : [],
    raw,
  };
}

/** Run-length rows (land, water, land…; top row = north) → bottom-up Uint8 texture data + lookup. */
function decodeWaterMask(m) {
  const { width: W, height: H } = m;
  const data = new Uint8Array(W * H);
  m.rows.forEach((runs, rowFromTop) => {
    const row = H - 1 - rowFromTop;
    let x = 0, water = false;
    for (const run of runs) {
      if (water) data.fill(255, row * W + x, row * W + x + run);
      x += run;
      water = !water;
    }
  });
  const isWater = (x, y) => {
    const px = Math.floor((x - m.x0) / m.metresPerPixel), py = Math.floor((y - m.y0) / m.metresPerPixel);
    return px >= 0 && py >= 0 && px < W && py < H && data[py * W + px] === 255;
  };
  return { ...m, data, isWater };
}

/** Delta-encoded rows (south → north) → Float32 heights, row-major. */
function decodeTerrain(t) {
  if (!t) return null;
  const heights = new Float32Array(t.cols * t.rows);
  t.heights.forEach((row, r) => {
    let h = 0;
    row.forEach((d, c) => { h += d; heights[r * t.cols + c] = h; });
  });
  return { x0: t.x0, y0: t.y0, step: t.step, cols: t.cols, rows: t.rows, heights };
}
