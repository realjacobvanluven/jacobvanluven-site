/**
 * Per-building identity and roof plan, shared by the geometry worker (which builds the roofs) and the
 * aviation lights (which must sit on top of whatever the roof carries). Dependency-free.
 *
 * The data has no building IDs, so the ID is a hash of the footprint (first vertices, quantized to 10 cm)
 * and height. The data file is static, so every building gets the same look on every visit, independent of
 * the order buildings are listed or filtered in.
 */

/** Stable 32-bit ID for a building footprint. */
export function buildingId({ ring, h }) {
  let x = 2166136261 >>> 0;
  const mix = (v) => { x ^= v & 0xffff; x = Math.imul(x, 16777619) >>> 0; x ^= v >>> 16; x = Math.imul(x, 16777619) >>> 0; };
  for (let i = 0; i < Math.min(ring.length, 4); i++) { mix(Math.round(ring[i][0] * 10)); mix(Math.round(ring[i][1] * 10)); }
  mix(ring.length); mix(Math.round(h * 10));
  return x;
}

/** Small deterministic generator (LCG) seeded by the building ID. */
export function rng(seed) {
  let s = (seed ^ 0x9e3779b9) >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/**
 * What sits on top of a building. Heights are above the main roof (b.h).
 *   type: 'flat' | 'stepped' | 'slanted'
 *   tiers: stepped only, [{ start: fraction of height where the tier begins, scale: footprint inset }]
 *   slant: slanted only, { angle, drop }
 *   penthouse: mechanical penthouse (lift overrun / plant room) on the roof, { scale, h } or null
 *   mast: antenna / spire at the centroid, { h } or null
 *   boxes: number of small rooftop units (HVAC, cooling) to scatter
 *   crownTop: highest point over the centroid, for the aviation light
 */
export function roofPlan(b) {
  const r = rng(buildingId(b));
  const seed = r(), pick = r(), p1 = r(), p2 = r(), p3 = r(), p4 = r();
  const height = b.h - b.base;
  const simple = b.ring.length <= 24; // insets of very ragged outlines can poke out of the walls
  const plan = { seed, type: 'flat', tiers: null, slant: null, penthouse: null, mast: null, boxes: 0, crownTop: b.h };

  if (height > 55 && simple) {
    if (pick < 0.24) {
      // Wedding-cake top: one to three setbacks over the top ~8–20% of the tower.
      const n = 1 + Math.floor(p1 * 3);
      plan.type = 'stepped';
      plan.tiers = [];
      let start = 1 - (0.08 + 0.12 * p2), scale = 1;
      const step = (1 - start) / n;
      for (let k = 0; k < n; k++) {
        scale *= 0.74 + 0.12 * ((p3 * (k + 3.7)) % 1);
        plan.tiers.push({ start: start + step * k, scale });
      }
    } else if (pick < 0.4) {
      plan.type = 'slanted';
      plan.slant = { angle: p1 * Math.PI * 2, drop: Math.min((0.08 + 0.08 * p2) * height, 16) };
    }
    if (plan.type !== 'slanted' && p4 < 0.6) plan.penthouse = { scale: 0.32 + 0.18 * p3, h: 3.5 + 3.5 * p2 };
    if (plan.type === 'flat') plan.boxes = 1 + Math.floor(p1 * 3);
    if (height > 90 && plan.type !== 'slanted' && p2 > 0.7) plan.mast = { h: 6 + 12 * p3 };
  } else if (height > 25 && simple) {
    if (pick < 0.18) {
      plan.type = 'stepped';
      plan.tiers = [{ start: 1 - 3.2 / height, scale: 0.7 + 0.15 * p1 }]; // one inset penthouse floor
    } else if (pick < 0.27) {
      plan.type = 'slanted';
      plan.slant = { angle: p1 * Math.PI * 2, drop: Math.min(0.1 * height, 6) };
    }
    if (plan.type === 'flat') plan.boxes = 1 + Math.floor(p1 * 3);
    if (plan.type !== 'slanted' && p4 < 0.35) plan.penthouse = { scale: 0.3 + 0.15 * p3, h: 3 + 2 * p2 };
  } else if (height > 12) {
    plan.boxes = Math.floor(p1 * 4);
  }

  plan.crownTop = b.h + (plan.penthouse?.h ?? 0) + (plan.mast?.h ?? 0);
  return plan;
}
