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
 *  - Terrain: AWS Terrarium tiles, built from NRCan CDEM in Canada (Open Government Licence – Canada).
 *  City data: Open Government Licence – Vancouver. OSM: © OpenStreetMap contributors, ODbL.
 *  Also precomputed here (so the browser doesn't have to): the land/water mask, North Shore terrain grid,
 *  the Cambie, Granville and Burrard Bridge lines, marina docks and moored-boat positions.
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
import { gzipSync } from 'node:zlib';
import { sampleTerrain } from './lib/terrain.mjs';
import { buildWaterMask } from './lib/water-mask.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, 'scripts/.cache');
const OUT = join(ROOT, 'public/data/skyline.json');
const USER_AGENT = 'skyline-data-build/1.0 (static site preprocessing script)';

// ---- The shot ---------------------------------------------------------------------------------------
/** Camera: on the Olympic Village seawall at the water's edge (south shore of False Creek). Origin of the output coordinates. */
const CAMERA = { lat: 49.27175, lon: -123.1078 };
/** Crop wedge: keep buildings within these compass bearings (clockwise, wrapping through north) of APEX.
 *  APEX sits ~130 m inland of the camera so the wedge is wide enough at the shoreline. */
const VIEW = { apex: { lat: 49.2706, lon: -123.1078 }, fromBearing: 252, toBearing: 65, maxDistance: 3000, minNorth: -400 };
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
const toLonLat = (x, y) => [CAMERA.lon + x / M_PER_DEG_LON, CAMERA.lat + y / M_PER_DEG_LAT];

// Extras: water mask covers the OSM shoreline data; terrain covers the North Shore.
const MASK = { x0: -3600, x1: 3600, y0: -800, y1: 2860, metresPerPixel: 2 };
const TERRAIN = { x0: -16000, x1: 16000, y0: 2900, y1: 26000, step: 150 };
const EXTRAS_BBOX = '49.262,-123.145,49.285,-123.095';

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

const APEX = toLocal([VIEW.apex.lon, VIEW.apex.lat]);
function inView([x, y]) {
  const point = [x - APEX[0], y - APEX[1]];
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

async function cachedBinary(name, fetcher) {
  const file = join(CACHE, name);
  if (existsSync(file)) return readFile(file);
  console.log(`Downloading ${name} ...`);
  const data = await fetcher();
  await mkdir(CACHE, { recursive: true });
  await writeFile(file, data);
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

/** Runs an Overpass query (cached). Public servers are often busy: try each mirror, twice. */
function overpass(name, query) {
  const mirrors = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
  return cached(name, async () => {
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
          await new Promise((r) => setTimeout(r, 5000));
        }
      }
    }
    throw lastError;
  });
}

function osm() {
  const b = `${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}`;
  const names = LANDMARKS.map((l) => l.osm).join('|');
  return overpass('osm.json', `[out:json][timeout:120];
(
  way["building"](${b}); relation["building"](${b});
  way["building:part"](${b}); relation["building:part"](${b});
  way["natural"="coastline"](${b});
  nwr["name"~"^(${names})$"](${b});
);
out tags geom;`);
}

/** Waterfront and park detail: footpaths, bike paths, parks/lawns/fields, and mapped trees. */
function osmGround() {
  return overpass('osm-ground.json', `[out:json][timeout:90];(way["highway"~"^(footway|path|cycleway|pedestrian)$"](${EXTRAS_BBOX});way["leisure"~"^(park|garden|playground|pitch)$"](${EXTRAS_BBOX});way["landuse"~"^(grass|recreation_ground)$"](${EXTRAS_BBOX});node["natural"="tree"](${EXTRAS_BBOX}););out tags geom;`);
}

/** SkyTrain (Expo Line) tracks and stations around Main Street–Science World and Stadium–Chinatown. */
function osmRail() {
  return overpass('osm-rail.json', `[out:json][timeout:90];
(way["railway"~"^(subway|light_rail)$"](${EXTRAS_BBOX});node["railway"="station"](${EXTRAS_BBOX}););
out tags geom;`);
}

/** Downtown streets (for streetlights and traffic). */
function osmRoads() {
  const b = `${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}`;
  return overpass('osm-roads.json', `[out:json][timeout:90];
way["highway"~"^(trunk|primary|secondary|tertiary|residential|unclassified)$"](${b});
out tags geom;`);
}

/**
 * Signature towers, hand-modelled in the scene (src/hero/signatures.js). Located by OSM way id, or for
 * Living Shangri-La (not named in OSM here) by its address coordinates. Heights are approximate.
 */
const SIGNATURES = [
  { id: 'wallCentre', way: 91998089, height: 150 },
  { id: 'paradox', way: 362187535, height: 188 },
  { id: 'butterfly', way: 653660958, height: 177 },
  { id: 'mnp', way: 361463297, height: 144 },
  { id: 'vancouverHouse', way: 742009401, height: 150 },
  { id: 'shangriLa', near: [49.2856, -123.1238], height: 197 },
];

/** Cambie Bridge roadway, marinas and their docks. */
function osmExtras() {
  return overpass('osm-extras.json', `[out:json][timeout:60];
(
  way["name"~"^Cambie (Street )?Bridge"]["highway"](${EXTRAS_BBOX});
  way["leisure"="marina"](${EXTRAS_BBOX});
  way["man_made"="pier"](${EXTRAS_BBOX});
);
out tags geom;`);
}

/** Granville and Burrard Street Bridge decks (main spans only), by OSM way id. */
const BRIDGE_WAYS = {
  granville: [1419040127, 1419040128, 1419040129],
  burrard: [849900149, 23188868],
};
/** Granville's south approach and its two ramps, as OSM way chains (each oriented to continue from the last). */
const RAMP_CHAINS = [
  // Granville Street south of the bridge, a raised deck that comes down to street level at 6th Avenue.
  { id: 'approach', bridge: 'granville', kind: 'down', width: 22, ids: [1419040137, 1419040132, 1419040138, 1419040133, 1285848467, 256879265], near: 'main-start', joinMain: true },
  // Off-ramp curving away west toward Fir Street and 4th Avenue.
  { id: 'offramp', bridge: 'granville', kind: 'down', width: 10, ids: [1419040135, 1419040136, 992936499, 35354235], near: 'main-start' },
  // On-ramp climbing from the south-east to merge with the approach.
  { id: 'onramp', bridge: 'granville', kind: 'up', width: 9, ids: [304881410, 1419040130, 1419040131, 37226820], near: [-2043, -590] },
];
function osmBridges() {
  const ids = [...Object.values(BRIDGE_WAYS).flat(), ...RAMP_CHAINS.flatMap((r) => r.ids)].join(',');
  return overpass('osm-bridges-2.json', `[out:json][timeout:60];way(id:${ids});out tags geom;`);
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
const extras = await osmExtras();
const bridgeEls = await osmBridges();
const roadsData = await osmRoads();
const railData = await osmRail();
const groundData = await osmGround();

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
  // Rogers Arena is hand-built from its mapped footprint (the stepped 2009 parts are removed in the scene).
  if (l.id === 'rogers-arena') landmarkOut[l.id].ring = encodeRing(cleanRing(found.points));
}

const shoreLines = coastline
  .map((line) => line.filter(([x, y]) => Math.abs(x) < 3700 && y > -900 && y < 3500))
  .filter((line) => line.length > 1)
  .map((line) => simplify(line, 1));
const shore = shoreLines.map(encodeRing);

// ---- Extras -----------------------------------------------------------------------------------------
// Signature towers: footprint ring (local metres) + height; the scene removes the data buildings inside.
const signatures = [];
for (const sig of SIGNATURES) {
  let ring = null;
  if (sig.way) {
    const el = osmData.elements.find((e) => e.type === 'way' && e.id === sig.way);
    if (el?.geometry) ring = cleanRing(el.geometry.map((p) => toLocal([p.lon, p.lat])));
  } else if (sig.near) {
    // Tallest kept building part within 60 m of the address.
    const [nx, ny] = toLocal([sig.near[1], sig.near[0]]);
    const cand = kept.filter((o) => Math.hypot(...centroid(o.ring).map((v, i) => v - [nx, ny][i])) < 60).sort((a, b) => b.h - a.h)[0];
    if (cand) ring = cand.ring;
  }
  if (!ring) { console.warn(`Signature tower not found: ${sig.id}`); continue; }
  signatures.push({ id: sig.id, height: sig.height, ring: encodeRing(ring) });
}

// Streets inside the view, simplified; class 0 = main road (traffic), 1 = local street.
const ROAD_CLASS = { trunk: 0, primary: 0, secondary: 0, tertiary: 1, residential: 1, unclassified: 1 };
const roads = [];
// The Georgia and Dunsmuir Viaducts (demolished 2022–25, drawn as they stood) are elevated decks of their own,
// chained from OSM ways west → east, so they're kept out of the ground-level road list.
const VIADUCT_CHAINS = {
  georgia: [507910545, 4645645, 35354254],
  dunsmuir: [1368517838, 36767239, 35354252, 35354253, 36767233, 1285852098],
};
const viaductIds = new Set(Object.values(VIADUCT_CHAINS).flat());
for (const e of roadsData.elements) {
  if (viaductIds.has(e.id)) continue;
  if (e.type !== 'way' || !e.geometry || e.tags?.bridge === 'yes' || e.tags?.tunnel === 'yes') continue;
  const line = simplify(e.geometry.map((p) => toLocal([p.lon, p.lat])), 2);
  // The view wedge, plus everything close to the camera (the camera turns east toward Science World).
  const inside = line.filter((p) => (inView(p) && Math.hypot(...p) < 2900) || (Math.hypot(...p) < 1100 && p[1] > -60));
  if (inside.length < 2) continue;
  roads.push([ROAD_CLASS[e.tags.highway] ?? 1, ...encodeRing(inside)]);
}

// [lineEncoded…] per viaduct, ordered west → east (the deck is at grade at the west end, by Beatty Street).
const viaducts = Object.values(VIADUCT_CHAINS).map((ids) => {
  const segs = ids.map((id) => {
    const way = roadsData.elements.find((e) => e.id === id);
    if (!way) throw new Error(`Viaduct way ${id} missing from the OSM road cache`);
    return way.geometry.map((p) => toLocal([p.lon, p.lat]));
  });
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  // Orient the first way so it ends where the second begins, then flip each next way to start where the chain ended.
  const [f, g] = [segs[0], segs[1]];
  const gEnds = [g[0], g[g.length - 1]];
  if (Math.min(...gEnds.map((e) => d(f[0], e))) < Math.min(...gEnds.map((e) => d(f[f.length - 1], e)))) f.reverse();
  const pts = [...f];
  for (const seg of segs.slice(1)) {
    const end = pts[pts.length - 1];
    const ordered = d(seg[0], end) <= d(seg[seg.length - 1], end) ? seg : [...seg].reverse();
    pts.push(...ordered.slice(1));
  }
  if (pts[0][0] > pts[pts.length - 1][0]) pts.reverse();
  return encodeRing(simplify(pts, 0.6));
});

const mask = buildWaterMask(shoreLines, MASK);

// SkyTrain Expo Line: one continuous centreline from the east edge of the view through Main Street–Science
// World station to the Dunsmuir tunnel portal past Stadium–Chinatown (chained from one track's OSM ways),
// with a height per point: elevated on the viaduct (~9 m), ramping down to the portal.
const expoWays = railData.elements.filter((e) => e.type === 'way' && /Expo Line/.test(e.tags?.name ?? '') && e.tags?.tunnel !== 'yes' && !e.tags?.service)
  .map((e) => e.geometry.map((p) => toLocal([p.lon, p.lat])));
const skytrainLine = [];
{
  const pool = expoWays.slice();
  // Start at the easternmost endpoint.
  let best = null;
  for (const w of pool) for (const end of [0, w.length - 1]) if (!best || w[end][0] > best.p[0]) best = { w, end, p: w[end] };
  let cur = best.end === 0 ? best.w : best.w.slice().reverse();
  pool.splice(pool.indexOf(best.w), 1);
  skytrainLine.push(...cur);
  for (;;) {
    const tail = skytrainLine[skytrainLine.length - 1];
    let next = null;
    for (const w of pool) for (const end of [0, w.length - 1]) {
      const d = Math.hypot(w[end][0] - tail[0], w[end][1] - tail[1]);
      if (d < 18 && (!next || d < next.d)) next = { w, end, d };
    }
    if (!next) break;
    pool.splice(pool.indexOf(next.w), 1);
    const seg = next.end === 0 ? next.w : next.w.slice().reverse();
    skytrainLine.push(...seg.slice(1));
  }
}
// The chain can run on to the other track and come back: stop at the point farthest from the start (the portal).
{
  const [sx, sy] = skytrainLine[0];
  let far = 0;
  skytrainLine.forEach(([x, y], i) => { if (Math.hypot(x - sx, y - sy) > Math.hypot(skytrainLine[far][0] - sx, skytrainLine[far][1] - sy)) far = i; });
  skytrainLine.length = far + 1;
}
const stationNames = { 'Main Street–Science World': 'mainStreet', 'Stadium–Chinatown': 'stadium' };
const skytrainStations = railData.elements.filter((e) => e.type === 'node' && stationNames[e.tags?.name])
  .map((e) => ({ id: stationNames[e.tags.name], name: e.tags.name, p: toLocal([e.lon, e.lat]).map(dm) }));
const skytrain = skytrainLine.length > 1 ? { line: encodeRing(simplify(skytrainLine, 0.5)), stations: skytrainStations } : null;
console.log('SkyTrain:', skytrainLine.length, 'points', skytrainStations.map((s) => s.name).join(', '));

// Waterfront/park detail near the camera (the most visible ground): paths, green areas, trees.
const GROUND_RANGE = 1800;
const nearView = (p) => inView(p) && Math.hypot(...p) < GROUND_RANGE;
const paths = [];
const greens = [];
const treePts = [];
const GREEN_KIND = { park: 0, garden: 0, grass: 0, recreation_ground: 0, pitch: 1, playground: 2 };
for (const e of groundData.elements) {
  const t = e.tags ?? {};
  if (e.type === 'node' && t.natural === 'tree') {
    const p = toLocal([e.lon, e.lat]);
    if (nearView(p) && !mask.isWater(...p)) treePts.push(p);
    continue;
  }
  if (e.type !== 'way' || !e.geometry) continue;
  const pts = e.geometry.map((q) => toLocal([q.lon, q.lat]));
  if (t.highway) {
    // Paths on bridges and viaducts (or at any raised level) are not ground: painted flat they would run across the
    // water and the land under every bridge. The bridges themselves are modelled in src/hero/bridge.js.
    if (t.tunnel === 'yes' || (t.layer && +t.layer < 0) || (t.bridge && t.bridge !== 'boardwalk' && t.bridge !== 'no') || (t.layer && +t.layer >= 1)) continue;
    const line = simplify(pts, 1).filter(nearView);
    if (line.length >= 2) paths.push([t.highway === 'cycleway' ? 1 : 0, ...encodeRing(line)]);
  } else {
    const kind = GREEN_KIND[t.leisure ?? t.landuse];
    const ring = cleanRing(pts);
    if (kind === undefined || !ring || area(ring) < 40 || !nearView(centroid(ring))) continue;
    greens.push([kind, ...encodeRing(ring)]);
  }
}
// Trees sorted by distance (nearest first) so the scene can cap the count per device.
treePts.sort((a, b) => Math.hypot(...a) - Math.hypot(...b));
const trees = encodeRing(treePts);


const terrain = await sampleTerrain(TERRAIN, toLonLat, cachedBinary, USER_AGENT);
// Sea level and below → -4 m so the water plane covers it.
const terrainRows = [];
for (let r = 0; r < terrain.rows; r++) {
  const row = [];
  let prev = 0;
  for (let c = 0; c < terrain.cols; c++) {
    const h = Math.max(-4, terrain.heights[r * terrain.cols + c] <= 0 ? -4 : terrain.heights[r * terrain.cols + c]);
    row.push(h - prev);
    prev = h;
  }
  terrainRows.push(row);
}

// Bridges: principal axis of each bridge's roadway points → one straight line (all are nearly straight).
function axisLine(pts) {
  if (pts.length < 2) return null;
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  let sxx = 0, syy = 0, sxy = 0;
  for (const [x, y] of pts) { sxx += (x - cx) ** 2; syy += (y - cy) ** 2; sxy += (x - cx) * (y - cy); }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy), ux = Math.cos(ang), uy = Math.sin(ang);
  const proj = pts.map(([x, y]) => (x - cx) * ux + (y - cy) * uy);
  const t0 = Math.min(...proj), t1 = Math.max(...proj);
  return [[cx + ux * t0, cy + uy * t0], [cx + ux * t1, cy + uy * t1]];
}
const wayPoints = (els) => els.filter((e) => e.type === 'way' && e.geometry).flatMap((e) => e.geometry.map((p) => toLocal([p.lon, p.lat])));
const bridges = [
  { id: 'cambie', line: axisLine(wayPoints(extras.elements.filter((e) => /^Cambie (Street )?Bridge/.test(e.tags?.name ?? '')))) },
  ...Object.entries(BRIDGE_WAYS).map(([id, ways]) => ({ id, line: axisLine(wayPoints(bridgeEls.elements.filter((e) => ways.includes(e.id)))) })),
].filter((b) => b.line).map((b) => ({ id: b.id, line: b.line.map((p) => p.map(dm)) }));

// Ramps: chain each way list into one polyline, oriented to start nearest its `near` point.
const ramps = RAMP_CHAINS.map((r) => {
  const main = bridges.find((b) => b.id === r.bridge).line.map((p) => p.map((v) => v / 10)); // [[x,y],[x,y]] south → north, metres
  const near = r.near === 'main-start' ? main[0] : r.near;
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const pts = [];
  r.ids.forEach((id, i) => {
    let g = bridgeEls.elements.find((e) => e.id === id).geometry.map((p) => toLocal([p.lon, p.lat]));
    const ref = i === 0 ? near : pts[pts.length - 1];
    if (d(g[g.length - 1], ref) < d(g[0], ref)) g = g.reverse();
    pts.push(...(i === 0 ? g : g.slice(1)));
  });
  if (r.joinMain) pts.unshift(main[0]); // starts at the end of the main deck
  return { id: r.id, bridge: r.bridge, kind: r.kind, width: r.width, line: pts.map((p) => p.map(dm)) };
});

// Docks and moored boats: boats side by side, perpendicular to each dock, wherever the water mask says water.
let seed = 4242;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const docks = extras.elements
  .filter((e) => e.type === 'way' && e.tags?.man_made === 'pier' && e.geometry)
  .map((e) => e.geometry.map((p) => toLocal([p.lon, p.lat])))
  .filter((line) => line.some(([x, y]) => Math.hypot(x, y) < 3000));
const boats = [];
for (const line of docks) {
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1], [bx, by] = line[i];
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 6) continue;
    const ux = (bx - ax) / len, uy = (by - ay) / len;
    for (let s = 3; s < len - 2; s += 5.5 + rand() * 2.5) {
      for (const side of [-1, 1]) {
        if (rand() > 0.72) continue;
        const L = 8 + rand() * 9;
        const nx = -uy * side, ny = ux * side;
        const cx = ax + ux * s + nx * (L / 2 + 1.6), cy = ay + uy * s + ny * (L / 2 + 1.6);
        const ok = [0, 0.5, -0.5].every((k) => mask.isWater(cx + nx * L * k, cy + ny * L * k));
        if (!ok) continue;
        boats.push([dm(cx), dm(cy), Math.round((Math.atan2(ny, nx) * 1800) / Math.PI), dm(L), rand() < 0.45 ? 1 : 0]);
      }
    }
  }
}

const data = {
  version: 1,
  about: 'Downtown Vancouver from Olympic Village, looking north. Generated by scripts/build-skyline-data.mjs.',
  attribution: [
    'Contains information licensed under the Open Government Licence – Vancouver (Building Footprints 2015, 2009)',
    '© OpenStreetMap contributors, ODbL',
  ],
  origin: CAMERA,
  crop: { apex: APEX.map(dm), fromBearing: VIEW.fromBearing, toBearing: VIEW.toBearing, maxDistance: VIEW.maxDistance },
  units: 'decimetres; x east, y north, from origin; rings delta-encoded',
  sources: SRC,
  // [heightDm, baseDm, sourceIndex, ...ring]
  buildings: kept.map((o) => [dm(o.h), dm(o.base), SRC.indexOf(o.src), ...encodeRing(o.ring)]),
  landmarks: landmarkOut,
  shoreline: shore,
  waterMask: { ...MASK, width: mask.width, height: mask.height, rows: mask.rows },
  terrain: { ...TERRAIN, cols: terrain.cols, rows: terrain.rows, source: 'AWS Terrarium tiles (NRCan CDEM)', heights: terrainRows },
  // [{ id, line: [[xDm, yDm], [xDm, yDm]] }]: straight deck axes of the Cambie, Granville and Burrard Bridges
  bridges,
  // [{ id, bridge, kind: 'down' (leaves the deck, descends) | 'up' (climbs to merge), width, line: [[xDm, yDm]…] }]
  ramps,
  docks: docks.map(encodeRing),
  // [xDm, yDm, headingDeciDegrees (bow direction, from +x toward +y), lengthDm, kind 0 motor / 1 sail]
  boats,
  signatures,
  // [class, ...line] (class 0 main road, 1 local street)
  roads,
  // Georgia and Dunsmuir Viaduct centrelines (delta-encoded, west → east)
  viaducts,
  // Expo Line centreline (delta-encoded, east → tunnel portal) and stations [{ id, name, p: [xDm, yDm] }]
  skytrain,
  // Waterfront detail: [class, ...line] (0 footway, 1 cycleway); [kind, ...ring] (0 lawn/park, 1 sports field,
  // 2 playground); trees as one delta-encoded point list, nearest first.
  paths,
  greens,
  trees,
};

await mkdir(dirname(OUT), { recursive: true });
const json = JSON.stringify(data);
await writeFile(OUT, json);

const bySrc = Object.fromEntries(SRC.map((s) => [s, kept.filter((o) => o.src === s).length]));
console.log('2015 footprints:', f15.length, '| 2009 parts with height:', p09.length, '| OSM buildings:', osmBuildings.length, 'parts:', osmParts.length);
console.log('Decisions:', stats);
console.log('Kept in view:', kept.length, 'prisms', bySrc);
console.log('Tallest:', kept.sort((a, b) => b.h - a.h).slice(0, 8).map((o) => `${o.h.toFixed(0)}m(${o.src})`).join(', '));
console.log('Landmarks:', Object.keys(landmarkOut).join(', '));
const part = (k) => `${k} ${(gzipSync(JSON.stringify(data[k])).length / 1024).toFixed(0)} KB`;
console.log('Extras:', `mask ${mask.width}×${mask.height},`, `terrain ${terrain.cols}×${terrain.rows} (max ${terrain.max} m, ${terrain.tiles} tiles),`, `bridges ${bridges.map((b) => b.id).join('/')},`, `${docks.length} docks, ${boats.length} boats`);
console.log('Gzipped parts:', ['buildings', 'waterMask', 'terrain', 'shoreline', 'docks', 'boats', 'signatures', 'roads', 'paths', 'greens', 'trees'].map(part).join(', '));
console.log('Signatures:', signatures.map((s) => s.id).join(', '), '| roads:', roads.length, '| paths:', paths.length, '| greens:', greens.length, '| trees:', treePts.length);
console.log(`Wrote ${OUT}: ${(json.length / 1024).toFixed(0)} KB, ${(gzipSync(json).length / 1024).toFixed(0)} KB gzipped`);
