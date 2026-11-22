#!/usr/bin/env node
/**
 * Measures what the hero costs to download: bundles src/hero/runtime.js (with three.js, tree-shaken and
 * minified, worker as its own file) the way the site build will, then reports raw and gzip sizes
 * together with the data file. Output goes to scripts/.cache/hero-size/ (git-ignored).
 * Usage: node scripts/measure-hero-size.mjs
 */
import { build } from 'vite';
import { readdir, readFile, stat } from 'node:fs/promises';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'scripts/.cache/hero-size');

await build({
  root: ROOT,
  logLevel: 'warn',
  configFile: false,
  publicDir: false,
  build: {
    outDir: OUT,
    emptyOutDir: true,
    minify: true,
    lib: { entry: join(ROOT, 'src/hero/runtime.js'), formats: ['es'], fileName: 'hero' },
  },
});

async function files(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await files(p)));
    else out.push(p);
  }
  return out;
}

const rows = [];
for (const f of [...(await files(OUT)), join(ROOT, 'public/data/skyline.json')]) {
  const buf = await readFile(f);
  rows.push({ file: f.replace(ROOT + '/', ''), raw: buf.length, gzip: gzipSync(buf, { level: 9 }).length, brotli: brotliCompressSync(buf).length });
}
const kb = (n) => (n / 1024).toFixed(1).padStart(7) + ' KB';
for (const r of rows) console.log(`${r.file.padEnd(48)} raw ${kb(r.raw)}  gzip ${kb(r.gzip)}  brotli ${kb(r.brotli)}`);
const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
console.log(`${'TOTAL'.padEnd(48)} raw ${kb(sum('raw'))}  gzip ${kb(sum('gzip'))}  brotli ${kb(sum('brotli'))}`);
