/**
 * Street life: streetlights along the downtown streets (mostly white LED, some older orange sodium), and
 * moving traffic on the main roads (red taillights going away from the camera, white headlights coming
 * toward it). Streets come from OpenStreetMap via the data file; most of them are hidden between
 * buildings, which is exactly how a city reads at night: light leaking out of the gaps.
 */

export function createStreets(roads, { camera = [0, 0], maxDistance = 2600, lampSpacing = 34, carSpacing = [18, 48] } = {}) {
  let seed = 77;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const far = ([x, y]) => Math.hypot(x - camera[0], y - camera[1]) > maxDistance;
  const lamps = [];
  const lanes = []; // { pts, cum, length, dir, speed, color }

  for (const road of roads) {
    const pts = road.line;
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const length = cum[cum.length - 1];
    if (length < 20) continue;
    const pointAt = (s, offset) => {
      let i = 1;
      while (i < cum.length - 1 && cum[i] < s) i++;
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
      const seg = cum[i] - cum[i - 1] || 1, t = (s - cum[i - 1]) / seg;
      const ux = (bx - ax) / seg, uy = (by - ay) / seg;
      return [ax + (bx - ax) * t + uy * offset, ay + (by - ay) * t - ux * offset];
    };

    // Lamps, alternating sides.
    const half = road.main ? 11 : 8;
    let side = 1;
    for (let s = rand() * lampSpacing; s < length; s += lampSpacing) {
      const p = pointAt(s, half * side);
      side = -side;
      if (far(p) || Math.hypot(p[0] - camera[0], p[1] - camera[1]) < 150) continue;
      const sodium = rand() < 0.3;
      const k = 3.4 + rand() * 1.4;
      lamps.push({ p: [p[0], 8, -p[1]], color: (sodium ? [1, 0.55, 0.2] : [1, 0.86, 0.68]).map((c) => c * k), size: 0.7 });
    }

    // Traffic on main roads: one lane each way.
    if (!road.main || far(pts[0]) && far(pts[pts.length - 1])) continue;
    const [sx, sy] = pts[0], [ex, ey] = pts[pts.length - 1];
    const toCam = [camera[0] - (sx + ex) / 2, camera[1] - (sy + ey) / 2];
    const along = (ex - sx) * toCam[0] + (ey - sy) * toCam[1]; // > 0: forward direction heads toward the camera
    for (const dir of [1, -1]) {
      const towardCamera = dir * along > 0;
      lanes.push({
        pointAt, length, dir, speed: 10 + rand() * 4,
        color: towardCamera ? [5.5, 5.3, 4.6] : [4.8, 0.16, 0.07],
        size: towardCamera ? 0.42 : 0.34,
        cars: [],
      });
      const lane = lanes[lanes.length - 1];
      for (let s = rand() * carSpacing[1]; s < length; s += carSpacing[0] + rand() * (carSpacing[1] - carSpacing[0])) lane.cars.push(s);
    }
  }

  const carLights = [];
  for (const lane of lanes) for (let i = 0; i < lane.cars.length * 2; i++) carLights.push({ p: [0, 0, 0], color: lane.color, size: lane.size });

  /** Writes all car light positions for time t into positions (xyz per light). */
  function updateTraffic(positions, time) {
    let i = 0;
    for (const lane of lanes) {
      const L = lane.length;
      const laneOffset = 3.5 * lane.dir;
      for (const s0 of lane.cars) {
        const s = (((s0 + lane.dir * lane.speed * time) % L) + L) % L;
        for (const k of [-0.8, 0.8]) {
          const [x, y] = lane.pointAt(s, laneOffset + k);
          positions[i++] = x; positions[i++] = 0.8; positions[i++] = -y;
        }
      }
    }
  }

  return { lamps, carLights, updateTraffic, stats: { lamps: lamps.length, cars: carLights.length / 2 } };
}
