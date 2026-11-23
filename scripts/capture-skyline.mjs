#!/usr/bin/env node
/**
 * Captures stills from scripts/skyline-lookdev.html with headless Chrome (software GL), waiting for the page to
 * finish (window.__result) instead of guessing a delay. Dev tool: never part of the site build.
 *
 *   python3 -m http.server 8123          # in the repo root, in another terminal
 *   node scripts/capture-skyline.mjs <outDir> <name> "<lookdev query>" [<name> "<query>" …]
 *   node scripts/capture-skyline.mjs /tmp/shots west "preset=desktop&bearing=268&pitch=-3&fov=35"
 *
 * Writes <outDir>/<name>.png for each pair and prints the scene stats/timings. Env: PORT (server, default 8123),
 * CHROME (path to Chrome), DEBUG_PORT (default 9333).
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = process.env.PORT ?? 8123;
const DEBUG = process.env.DEBUG_PORT ?? 9333;
const [outDir, ...pairs] = process.argv.slice(2);
if (!outDir || pairs.length < 2 || pairs.length % 2) {
  console.error('usage: capture-skyline.mjs <outDir> <name> "<query>" [<name> "<query>" …]');
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'skyline-chrome-'))}`,
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1600,900',
  '--no-first-run', '--no-default-browser-check', 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pageSocket() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${DEBUG}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return new WebSocket(page.webSocketDebuggerUrl);
    } catch { /* Chrome still starting */ }
    await sleep(250);
  }
  throw new Error('Chrome did not start');
}

try {
  const ws = await pageSocket();
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true })).result?.result?.value;

  for (let k = 0; k < pairs.length; k += 2) {
    const [name, query] = [pairs[k], pairs[k + 1]];
    const w = +(/(?:^|&)w=(\d+)/.exec(query)?.[1] ?? 0), h = +(/(?:^|&)h=(\d+)/.exec(query)?.[1] ?? 0);
    await send('Emulation.setDeviceMetricsOverride', { width: w || 1600, height: h || 900, deviceScaleFactor: 1, mobile: false });
    // The very first load in a fresh Chrome sometimes stalls: give each attempt 60 s, and retry once.
    const t0 = Date.now();
    let done = false;
    for (let attempt = 0; attempt < 2 && !done; attempt++) {
      await send('Page.navigate', { url: `http://localhost:${PORT}/scripts/skyline-lookdev.html?${query}&v=${Date.now()}` });
      const t1 = Date.now();
      while (Date.now() - t1 < 60_000) {
        await sleep(1000);
        if (await evaluate('Boolean(window.__result)')) { done = true; break; }
      }
    }
    if (!done) { console.error(`${name}: timed out`); continue; }
    const result = JSON.parse((await evaluate('JSON.stringify({ error: window.__result.error, png: window.__result.png, tiers: window.__result.tiers, stats: window.__result.stats, timings: window.__result.timings, log: window.__result.log })')) ?? '{}');
    if (result.error || !result.png) { console.error(`${name}: ${result.error ?? 'no image'}\n${(result.log ?? []).join('\n')}`); continue; }
    writeFileSync(join(outDir, `${name}.png`), Buffer.from(result.png.split(',')[1], 'base64'));
    const t = result.timings ?? {};
    if (result.tiers) console.log('tiers:', JSON.stringify(result.tiers));
    if (process.env.STATS) { const { bridge, boats, ...rest } = result.stats ?? {}; console.log(JSON.stringify(rest)); }
    console.log(`${name}: ok in ${((Date.now() - t0) / 1000).toFixed(1)}s (scene build ${Math.round(t.total ?? 0)} ms)${result.log?.length ? ` | log: ${result.log.slice(0, 3).join(' / ')}` : ''}`);
  }
  ws.close();
} finally {
  chrome.kill();
}
