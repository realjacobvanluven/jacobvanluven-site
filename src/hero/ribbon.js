/**
 * Mitered ribbons: offsets for a polyline so that consecutive segments share their edge vertices (no notches or
 * overlaps at bends, which is what makes drawn paths and streets look ragged). Used by the paths, streets and seawall.
 */

/**
 * Per-vertex offset vectors for a ribbon of half-width `w` along `pts` ([x, y] in metres): the offset points to the
 * right of travel; the ribbon's edges are p - offset (left) and p + offset (right). At sharp bends the offset is
 * capped (`limit` × w) so spikes don't appear.
 * @returns {number[][]} [[ox, oy]] per vertex
 */
export function miterOffsets(pts, w, limit = 2.2) {
  const seg = [];
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[i - 1][0], dy = pts[i][1] - pts[i - 1][1], l = Math.hypot(dx, dy);
    seg.push(l < 1e-6 ? null : [dy / l, -dx / l]); // right-hand normal of each segment
  }
  const normalAt = (k) => seg[Math.max(0, Math.min(seg.length - 1, k))];
  return pts.map((_, i) => {
    // Nearest usable normals before and after this vertex.
    let a = null, b = null;
    for (let k = i - 1; k >= 0 && !a; k--) a = seg[k];
    for (let k = i; k < seg.length && !b; k++) b = seg[k];
    a ??= b ?? normalAt(0) ?? [0, 1]; b ??= a;
    let mx = a[0] + b[0], my = a[1] + b[1];
    const ml = Math.hypot(mx, my);
    if (ml < 1e-6) return [a[0] * w, a[1] * w];
    mx /= ml; my /= ml;
    const scale = Math.min(limit, 1 / Math.max(mx * a[0] + my * a[1], 1e-3));
    return [mx * w * scale, my * w * scale];
  });
}
