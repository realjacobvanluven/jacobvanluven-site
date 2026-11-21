#!/usr/bin/env node
/**
 * Builds public/data/skyline.json: the downtown Vancouver buildings seen from Olympic Village,
 * looking north across False Creek. Run locally (`npm run data:skyline`); never at runtime.
 *
 * Sources
 *  - City of Vancouver "Building Footprints 2015": current-ish outlines, but 2D only (no heights).
 *  - City of Vancouver "Building Footprints 2009": stepped building parts, each with a height above
 *    ground (HGT_AGL). Used for heights and podium/tower massing wherever the 2015 building still matches.
 *  - OpenStreetMap (Overpass API): heights for buildings the City data doesn't cover, towers built
 *    after 2015, False Creek shoreline, and landmark positions.
 *  City data: Open Government Licence – Vancouver. OSM: © OpenStreetMap contributors, ODbL.
 *
 * How a building is chosen (per 2015 footprint)
 *  1. If 2009 parts cover most of it, the building existed in 2009: use those stepped parts.
 *  2. Otherwise use the 2015 outline, with a height from OSM (height, or levels × 3.3 m), else an estimate.
 *  3. If OSM says the site is now much taller (a redevelopment), use the OSM geometry instead.
 *  Then OSM buildings that match no 2015 footprint are added: they were built after 2015.
 *
 * Downloads are cached in scripts/.cache/ (git-ignored). Delete it to refetch.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, 'scripts/.cache');
const OUT = join(ROOT, 'public/data/skyline.json');
const USER_AGENT = 'skyline-data-build/1.0 (static site preprocessing script)';

// ---- The shot ---------------------------------------------------------------------------------------
/** Camera: Olympic Village seawall on the south shore of False Creek. Origin of the output coordinates. */
const CAMERA = { lat: 49.2706, lon: -123.1078 };
/** Keep buildings inside this wedge (compass bearings from the camera, clockwise, wrapping through north). */
const VIEW = { fromBearing: 275, toBearing: 65, maxDistance: 3000, minNorth: 30 };
/** Download box (lat/lon) that safely contains the wedge. */
const BBOX = { south: 49.268, west: -123.15, north: 49.2975, east: -123.08 };

// ---- Tuning -----------------------------------------------------------------------------------------
const MIN_AREA = 15; // m², drop sheds and slivers
const SIMPLIFY = 0.5; // m, Douglas–Peucker tolerance
const LEVEL_HEIGHT = 3.3; // m per storey when OSM only gives building:levels
const DEFAULT_HEIGHT = 7; // m, when no source has a height (flagged as estimated)
const COVERAGE_2009 = 0.5; // share of a 2015 footprint the 2009 parts must cover to count as "same building"
const REDEVELOPED = 20; // m, OSM height this much above the 2009 height means the site was rebuilt

const LANDMARKS = [
  { id: 'bc-place', name: 'BC Place', osm: 'BC Place' },
  { id: 'harbour-centre', name: 'Harbour Centre', osm: 'Harbour Centre' },
  { id: 'science-world', name: 'Science World', osm: 'Science World' },
  { id: 'rogers-arena', name: 'Rogers Arena', osm: 'Rogers Arena' },
  { id: 'cambie-bridge', name: 'Cambie Bridge', osm: 'Cambie Bridge' },
];

// ---- Geometry (local metres: x east, y north, origin at the camera) ------------------------------
const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((CAMERA.lat * Math.PI) / 180);
const toLocal = ([lon, lat]) => [(lon - CAMERA.lon) * M_PER_DEG_LON, (lat - CAMERA.lat) * M_PER_DEG_LAT];

function area(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return Math.abs(a / 2);
}

function centroid(ring) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    a += f; cx += (ring[j][0] + ring[i][0]) * f; cy += (ring[j][1] + ring[i][1]) * f;
  }
  if (Math.abs(a) < 1e-9) return ring[0];
  return [cx / (3 * a), cy / (3 * a)];
}

function bounds(ring) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of ring) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return [x0, y0, x1, y1];
}

function inside([x, y], ring, b = bounds(ring)) {
  if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) return false;
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

function simplify(points, tol) {
  if (points.length <= 4) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    const [ax, ay] = points[s], [bx, by] = points[e];
    const len = Math.hypot(bx - ax, by - ay);
    let max = 0, idx = -1;
    for (let i = s + 1; i < e; i++) {
      // Distance to the segment's line; for a closed ring (start = end) fall back to distance to that point.
      const d = len < 1e-9
        ? Math.hypot(points[i][0] - ax, points[i][1] - ay)
        : Math.abs((bx - ax) * (ay - points[i][1]) - (ax - points[i][0]) * (by - ay)) / len;
      if (d > max) { max = d; idx = i; }
    }
    if (max > tol) { keep[idx] = 1; stack.push([s, idx], [idx, e]); }
  }
  return points.filter((_, i) => keep[i]);
}

/** Open ring (no repeated closing point), simplified. */
function cleanRing(ring) {
  const r = ring.slice();
  const [fx, fy] = r[0], [lx, ly] = r[r.length - 1];
  if (fx === lx && fy === ly) r.pop();
  if (r.length < 3) return null;
  const s = simplify([...r, r[0]], SIMPLIFY);
  s.pop();
  return s.length >= 3 ? s : null;
}

function bearingDistance([x, y]) {
  return { bearing: ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360, distance: Math.hypot(x, y) };
}

function inView(point) {
  const { bearing, distance } = bearingDistance(point);
  const inArc = VIEW.fromBearing > VIEW.toBearing
    ? bearing >= VIEW.fromBearing || bearing <= VIEW.toBearing
    : bearing >= VIEW.fromBearing && bearing <= VIEW.toBearing;
  return inArc && distance <= VIEW.maxDistance && point[1] >= VIEW.minNorth;
}

// ---- Downloads --------------------------------------------------------------------------------------
async function cached(name, fetcher) {
  const file = join(CACHE, name);
  if (existsSync(file)) return JSON.parse(await readFile(file, 'utf8'));
  console.log(`Downloading ${name} ...`);
  const data = await fetcher();
  await mkdir(CACHE, { recursive: true });
  await writeFile(file, JSON.stringify(data));
  return data;
}

async function getJson(url, init = {}) {
  const res = await fetch(url, { ...init, headers: { 'User-Agent': USER_AGENT, ...init.headers } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

function cityFootprints(year) {
  const where = `in_bbox(geo_point_2d, ${BBOX.south}, ${BBOX.west}, ${BBOX.north}, ${BBOX.east})`;
  const url = `https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/building-footprints-${year}/exports/geojson?where=${encodeURIComponent(where)}`;
  return cached(`city-footprints-${year}.geojson`, () => getJson(url));
}

function osm() {
  const b = `${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}`;
  const names = LANDMARKS.map((l) => l.osm).join('|');
  const query = `[out:json][timeout:120];
(
  way["building"](${b}); relation["building"](${b});
  way["building:part"](${b}); relation["building:part"](${b});
  way["natural"="coastline"](${b});
  nwr["name"~"^(${names})$"](${b});
);
out tags geom;`;
  // Public Overpass servers are often busy: try each mirror, twice.
  const mirrors = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
  return cached('osm.json', async () => {
    let lastError;
    for (let attempt = 0; attempt < 2; attempt++) {
      for (const url of mirrors) {
        try {
          return await getJson(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `data=${encodeURIComponent(query)}`,
          });
        } catch (e) {
          lastError = e;
          console.warn(`  Overpass failed (${e.message}); trying next mirror`);
          await new Promise((r) => setTimeout(r, 3000));
        }
      }
    }
    throw lastError;
  });
}

// ---- Parsing ----------------------------------------------------------------------------------------
function cityRings(fc, withHeight) {
  const out = [];
  for (const f of fc.features) {
    const g = f.geometry;
    if (!g) continue;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    for (const poly of polys) {
      const ring = cleanRing(poly[0].map(toLocal));
      if (!ring || area(ring) < MIN_AREA) continue;
      const h = withHeight ? Number(f.properties.hgt_agl) : NaN;
      out.push({ ring, b: bounds(ring), c: centroid(ring), a: area(ring), h: Number.isFinite(h) && h > 0 ? h : null });
    }
  }
  return out;
}

const metres = (v) => {
  const n = Number.parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
};

function osmHeight(tags) {
  const h = metres(tags.height);
  if (h) return { h, exact: true };
  const levels = metres(tags['building:levels']);
  if (levels) return { h: levels * LEVEL_HEIGHT + (metres(tags['roof:levels']) ?? 0) * LEVEL_HEIGHT, exact: false };
  return null;
}

/** Outer rings of an OSM way or (simple) multipolygon relation, in local metres. */
function osmRings(el) {
  if (el.type === 'way' && el.geometry) return [el.geometry.map((p) => toLocal([p.lon, p.lat]))];
  if (el.type === 'relation' && el.members) {
    return el.members
      .filter((m) => m.role === 'outer' && m.geometry && m.geometry.length > 3)
      .map((m) => m.geometry.map((p) => toLocal([p.lon, p.lat])))
      .filter((r) => r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]); // closed only
  }
  return [];
}

// ---- Build ------------------------------------------------------------------------------------------
const [fc2015, fc2009, osmData] = await Promise.all([cityFootprints(2015), cityFootprints(2009), osm()]);

const f15 = cityRings(fc2015, false);
const p09 = cityRings(fc2009, true).filter((p) => p.h);

const osmBuildings = [];
const osmParts = [];
const coastline = [];
const landmarks = {};
for (const el of osmData.elements) {
  const t = el.tags ?? {};
  const lm = LANDMARKS.find((l) => l.osm === t.name);
  if (lm) {
    const pts = el.type === 'node' ? [toLocal([el.lon, el.lat])] : osmRings(el).flat();
    if (pts.length) {
      const prev = landmarks[lm.id]?.points ?? [];
      landmarks[lm.id] = { name: lm.name, points: [...prev, ...pts] };
    }
  }
  if (t.natural === 'coastline' && el.geometry) {
    coastline.push(el.geometry.map((p) => toLocal([p.lon, p.lat])));
    continue;
  }
  const isPart = Boolean(t['building:part']) && !t.building;
  if (!t.building && !isPart) continue;
  for (const raw of osmRings(el)) {
    const ring = cleanRing(raw);
    if (!ring || area(ring) < MIN_AREA) continue;
    const height = osmHeight(t);
    const item = {
      ring, b: bounds(ring), c: centroid(ring), a: area(ring),
      h: height?.h ?? null, exact: height?.exact ?? false, minH: metres(t.min_height) ?? 0, name: t.name,
    };
    (isPart ? osmParts : osmBuildings).push(item);
  }
}

// OSM building height = its own tag, or the tallest of its parts.
for (const b of osmBuildings) {
  b.parts = osmParts.filter((p) => inside(p.c, b.ring, b.b));
  const tallest = Math.max(0, ...b.parts.map((p) => p.h ?? 0));
  if (tallest > (b.h ?? 0)) { b.h = tallest; b.exact = b.parts.some((p) => p.exact); }
}

const out = []; // { ring, h, base, src }
const stats = { city2009: 0, city2015: 0, redeveloped: 0, osmNew: 0, estimated: 0 };
const used09 = new Set();
const usedOsm = new Set();

const emitOsm = (b, src) => {
  const parts = b.parts.filter((p) => p.h);
  if (parts.length) for (const p of parts) out.push({ ring: p.ring, h: p.h, base: p.minH, src });
  else out.push({ ring: b.ring, h: b.h ?? DEFAULT_HEIGHT, base: 0, src });
};

for (const f of f15) {
  const parts = p09.filter((p, i) => !used09.has(i) && inside(p.c, f.ring, f.b));
  const covered = parts.reduce((s, p) => s + p.a, 0) / f.a;
  const match = osmBuildings.find((o) => inside(o.c, f.ring, f.b) || inside(f.c, o.ring, o.b));
  if (match) usedOsm.add(match);

  if (parts.length && covered >= COVERAGE_2009) {
    const h09 = Math.max(...parts.map((p) => p.h));
    if (match?.exact && match.h > h09 + REDEVELOPED) {
      emitOsm(match, 'osm');
      stats.redeveloped++;
    } else {
      p09.forEach((p, i) => parts.includes(p) && used09.add(i));
      for (const p of parts) out.push({ ring: p.ring, h: p.h, base: 0, src: 'city2009' });
      stats.city2009++;
    }
  } else if (match?.h) {
    if (match.exact && match.parts.some((p) => p.h)) emitOsm(match, 'osm');
    else out.push({ ring: f.ring, h: match.h, base: 0, src: 'city2015+osm' });
    stats.city2015++;
  } else {
    const h = parts.length ? Math.max(...parts.map((p) => p.h)) : DEFAULT_HEIGHT;
    out.push({ ring: f.ring, h, base: 0, src: parts.length ? 'city2015+2009' : 'city2015+est' });
    if (!parts.length) stats.estimated++;
    stats.city2015++;
  }
}

// Built after 2015: OSM buildings that matched no 2015 footprint.
for (const b of osmBuildings) {
  if (usedOsm.has(b)) continue;
  if (f15.some((f) => inside(b.c, f.ring, f.b) || inside(f.c, b.ring, b.b))) continue;
  emitOsm(b, 'osm');
  stats.osmNew++;
}

// Crop to the view wedge.
const kept = out.filter((o) => inView(centroid(o.ring)));

// ---- Encode -----------------------------------------------------------------------------------------
// Compact format: integer decimetres; each ring is delta-encoded [x0, y0, dx1, dy1, ...].
const dm = (v) => Math.round(v * 10);
const SRC = ['city2009', 'city2015+osm', 'city2015+2009', 'city2015+est', 'osm'];
const encodeRing = (ring) => {
  const flat = [];
  let px = 0, py = 0;
  for (const [x, y] of ring) { const ix = dm(x), iy = dm(y); flat.push(ix - px, iy - py); px = ix; py = iy; }
  return flat;
};

const landmarkOut = {};
for (const l of LANDMARKS) {
  const found = landmarks[l.id];
  if (!found) { console.warn(`Landmark not found in OSM: ${l.name}`); continue; }
  const [x0, y0, x1, y1] = bounds(found.points);
  landmarkOut[l.id] = { name: l.name, center: [dm((x0 + x1) / 2), dm((y0 + y1) / 2)], bounds: [dm(x0), dm(y0), dm(x1), dm(y1)] };
}

const shore = coastline
  .map((line) => line.filter(([x, y]) => Math.abs(x) < 3500 && y > -500 && y < 3500))
  .filter((line) => line.length > 1)
  .map((line) => encodeRing(simplify(line, 2)));

const data = {
  version: 1,
  about: 'Downtown Vancouver from Olympic Village, looking north. Generated by scripts/build-skyline-data.mjs.',
  attribution: [
    'Contains information licensed under the Open Government Licence – Vancouver (Building Footprints 2015, 2009)',
    '© OpenStreetMap contributors, ODbL',
  ],
  origin: CAMERA,
  units: 'decimetres; x east, y north, from origin; rings delta-encoded',
  sources: SRC,
  // [heightDm, baseDm, sourceIndex, ...ring]
  buildings: kept.map((o) => [dm(o.h), dm(o.base), SRC.indexOf(o.src), ...encodeRing(o.ring)]),
  landmarks: landmarkOut,
  shoreline: shore,
};

await mkdir(dirname(OUT), { recursive: true });
const json = JSON.stringify(data);
await writeFile(OUT, json);

const { gzipSync } = await import('node:zlib');
const bySrc = Object.fromEntries(SRC.map((s) => [s, kept.filter((o) => o.src === s).length]));
console.log('2015 footprints:', f15.length, '| 2009 parts with height:', p09.length, '| OSM buildings:', osmBuildings.length, 'parts:', osmParts.length);
console.log('Decisions:', stats);
console.log('Kept in view:', kept.length, 'prisms', bySrc);
console.log('Tallest:', kept.sort((a, b) => b.h - a.h).slice(0, 8).map((o) => `${o.h.toFixed(0)}m(${o.src})`).join(', '));
console.log('Landmarks:', Object.keys(landmarkOut).join(', '));
console.log(`Wrote ${OUT}: ${(json.length / 1024).toFixed(0)} KB, ${(gzipSync(json).length / 1024).toFixed(0)} KB gzipped`);
