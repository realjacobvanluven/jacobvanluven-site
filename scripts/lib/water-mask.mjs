/**
 * Land/water mask from the OSM coastline (precomputed here so the browser doesn't have to).
 * OSM coastlines always have land on their left, and our lines are open where the data is clipped,
 * so instead of flood-filling we stamp a thin land band left of every line and a water band right of
 * it, then give every other pixel the label of the nearest band (multi-source BFS).
 * Output: run-length encoded rows, top row = north edge. Runs alternate land, water, land… starting with land.
 */
export function buildWaterMask(shoreline, { x0, x1, y0, y1, metresPerPixel: mpp }) {
  const W = Math.round((x1 - x0) / mpp), H = Math.round((y1 - y0) / mpp);
  const label = new Uint8Array(W * H); // 0 unlabelled, 1 land, 2 water
  const toPx = ([x, y]) => [(x - x0) / mpp, (y1 - y) / mpp];

  const stampLine = (line, value) => {
    for (let i = 1; i < line.length; i++) {
      const [ax, ay] = toPx(line[i - 1]), [bx, by] = toPx(line[i]);
      const steps = Math.ceil(Math.hypot(bx - ax, by - ay) * 2) + 1;
      for (let s = 0; s <= steps; s++) {
        const x = Math.round(ax + ((bx - ax) * s) / steps), y = Math.round(ay + ((by - ay) * s) / steps);
        if (x >= 0 && y >= 0 && x < W && y < H) label[y * W + x] = value;
      }
    }
  };
  const offsetLine = (line, d) =>
    line.map((p, i) => {
      const a = line[Math.max(0, i - 1)], b = line[Math.min(line.length - 1, i + 1)];
      const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
      return [p[0] - (dy / len) * d, p[1] + (dx / len) * d]; // +d = left of travel = land
    });
  for (const line of shoreline) {
    for (const k of [1, 1.6]) {
      stampLine(offsetLine(line, k * mpp), 1);
      stampLine(offsetLine(line, -k * mpp), 2);
    }
  }

  const queue = new Int32Array(W * H);
  let head = 0, tail = 0;
  for (let i = 0; i < W * H; i++) if (label[i]) queue[tail++] = i;
  while (head < tail) {
    const i = queue[head++], x = i % W;
    for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) {
      if (j < 0 || j >= W * H || label[j]) continue;
      label[j] = label[i];
      queue[tail++] = j;
    }
  }

  // Remove thin land slivers (piers, stray clipped lines).
  for (let pass = 0; pass < 2; pass++) {
    const copy = label.slice();
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        if (copy[i] !== 1) continue;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) n += copy[i + dy * W + dx] === 1 ? 1 : 0;
        if (n < 6) label[i] = 2;
      }
    }
  }

  const rows = [];
  for (let y = 0; y < H; y++) {
    const runs = [];
    let cur = 1, run = 0;
    for (let x = 0; x < W; x++) {
      const v = label[y * W + x] === 2 ? 2 : 1;
      if (v === cur) run++;
      else { runs.push(run); cur = v; run = 1; }
    }
    runs.push(run);
    rows.push(runs);
  }
  return { width: W, height: H, rows, isWater: (x, y) => {
    const px = Math.floor((x - x0) / mpp), py = Math.floor((y1 - y) / mpp);
    return px >= 0 && py >= 0 && px < W && py < H && label[py * W + px] === 2;
  } };
}
