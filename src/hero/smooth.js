/**
 * Rounds the corners of a polyline: each interior vertex is replaced by a short quadratic curve that starts and ends part
 * way along its two segments (at most `radius` metres, and never more than 40% of a segment, so neighbouring corners don't
 * collide). Map data is angular (simplified outlines of curves); this turns them back into curves: loops stop being
 * hexagons, cul-de-sacs and shorelines stop being stair-steps. Endpoints stay where they are.
 * @param {number[][]} line  [[x, y], …]
 * @param {{ radius?: number, closed?: boolean, samples?: number }} opts  closed: the last point repeats the first
 */
export function roundCorners(line, { radius = 6, closed = false, samples = 4 } = {}) {
  const n = line.length;
  if (n < 3) return line;
  const pts = closed ? line.slice(0, -1) : line;
  const m = pts.length;
  const out = [];
  const at = (i) => pts[((i % m) + m) % m];
  for (let i = 0; i < m; i++) {
    const p = at(i);
    if (!closed && (i === 0 || i === m - 1)) { out.push(p); continue; }
    const a = at(i - 1), b = at(i + 1);
    const la = Math.hypot(p[0] - a[0], p[1] - a[1]), lb = Math.hypot(b[0] - p[0], b[1] - p[1]);
    if (la < 1e-6 || lb < 1e-6) { out.push(p); continue; }
    const d = Math.min(radius, la * 0.4, lb * 0.4);
    const s = [p[0] + ((a[0] - p[0]) / la) * d, p[1] + ((a[1] - p[1]) / la) * d];
    const e = [p[0] + ((b[0] - p[0]) / lb) * d, p[1] + ((b[1] - p[1]) / lb) * d];
    for (let k = 0; k <= samples; k++) {
      const t = k / samples, u = 1 - t;
      out.push([u * u * s[0] + 2 * u * t * p[0] + t * t * e[0], u * u * s[1] + 2 * u * t * p[1] + t * t * e[1]]);
    }
  }
  if (closed) out.push(out[0]);
  return out;
}
