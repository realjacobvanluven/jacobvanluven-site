/**
 * North Shore elevation from the free AWS "Terrarium" terrain tiles (s3://elevation-tiles-prod), which in
 * Canada are built from Natural Resources Canada's CDEM (Open Government Licence – Canada).
 * Tiles are PNG: elevation = R * 256 + G + B / 256 - 32768 metres. Includes a tiny PNG decoder so the
 * script needs no dependencies.
 */
import { inflateSync } from 'node:zlib';

const ZOOM = 11;

/** Decodes an 8-bit RGB/RGBA, non-interlaced PNG into { width, height, channels, pixels }. */
export function decodePng(buf) {
  let p = 8, width = 0, height = 0, colorType = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4); colorType = data[9];
      if (data[8] !== 8 || data[12] !== 0) throw new Error('Only 8-bit non-interlaced PNG supported');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!channels) throw new Error(`Unsupported PNG colour type ${colorType}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels, out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[dst + x - channels] : 0;
      const b = y > 0 ? out[dst - stride + x] : 0;
      const c = x >= channels && y > 0 ? out[dst - stride + x - channels] : 0;
      let v = raw[src + x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[dst + x] = v & 255;
    }
  }
  return { width, height, channels, pixels: out };
}

const tileX = (lon) => ((lon + 180) / 360) * 2 ** ZOOM;
const tileY = (lat) => ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** ZOOM;

/**
 * Samples elevation on a regular local grid.
 * @param {(name: string, fetcher: () => Promise<Buffer>) => Promise<Buffer>} cachedBinary
 * @param {(x: number, y: number) => [number, number]} toLonLat  local metres → [lon, lat]
 */
export async function sampleTerrain({ x0, x1, y0, y1, step }, toLonLat, cachedBinary, userAgent) {
  const cols = Math.round((x1 - x0) / step) + 1, rows = Math.round((y1 - y0) / step) + 1;
  const corners = [toLonLat(x0, y0), toLonLat(x1, y1)];
  const tx0 = Math.floor(tileX(corners[0][0])), tx1 = Math.floor(tileX(corners[1][0]));
  const ty0 = Math.floor(tileY(corners[1][1])), ty1 = Math.floor(tileY(corners[0][1]));
  const tiles = new Map();
  for (let tx = tx0; tx <= tx1; tx++) {
    for (let ty = ty0; ty <= ty1; ty++) {
      const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${ZOOM}/${tx}/${ty}.png`;
      const buf = await cachedBinary(`terrarium-${ZOOM}-${tx}-${ty}.png`, async () => {
        const res = await fetch(url, { headers: { 'User-Agent': userAgent } });
        if (!res.ok) throw new Error(`${res.status} for ${url}`);
        return Buffer.from(await res.arrayBuffer());
      });
      tiles.set(`${tx},${ty}`, decodePng(buf));
    }
  }
  const elevAt = (lon, lat) => {
    const fx = tileX(lon), fy = tileY(lat);
    const tx = Math.floor(fx), ty = Math.floor(fy);
    const t = tiles.get(`${tx},${ty}`);
    if (!t) return 0;
    // Bilinear inside the tile (edges clamp; seams are invisible at this scale).
    const px = Math.min(t.width - 1.001, (fx - tx) * t.width - 0.5), py = Math.min(t.height - 1.001, (fy - ty) * t.height - 0.5);
    const ix = Math.max(0, Math.floor(px)), iy = Math.max(0, Math.floor(py)), ax = Math.max(0, px - ix), ay = Math.max(0, py - iy);
    const e = (x, y) => { const i = (y * t.width + x) * t.channels; return t.pixels[i] * 256 + t.pixels[i + 1] + t.pixels[i + 2] / 256 - 32768; };
    return (e(ix, iy) * (1 - ax) + e(ix + 1, iy) * ax) * (1 - ay) + (e(ix, iy + 1) * (1 - ax) + e(ix + 1, iy + 1) * ax) * ay;
  };
  const heights = new Int16Array(cols * rows);
  let max = -Infinity;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const [lon, lat] = toLonLat(x0 + c * step, y0 + r * step);
      const h = Math.round(elevAt(lon, lat));
      heights[r * cols + c] = h;
      max = Math.max(max, h);
    }
  }
  return { cols, rows, heights, max, tiles: tiles.size };
}
