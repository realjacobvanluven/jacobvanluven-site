#!/usr/bin/env node
/**
 * Checks the /experience line colour tokens against WCAG contrast targets and prints pass/fail for each.
 * Reads the tokens from src/styles/experience.css and the backgrounds from src/styles/global.css.
 *   npm run check:experience-contrast
 * Strokes and markers (--line-*) need ≥ 3:1 (non-text, WCAG 1.4.11) on the page and card backgrounds.
 * Text variants (--line-*-text) need ≥ 4.5:1 (WCAG 1.4.3) on both, and as the "You are here" chip fill under --bg text.
 */
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const tokens = (css) => Object.fromEntries([...css.matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})\b/gi)].map((m) => [m[1], m[2]]));
const global = tokens(read('src/styles/global.css'));
const xp = tokens(read('src/styles/experience.css'));

const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const backgrounds = { '--bg': global['--bg'], '--surface': global['--surface'] };
let failed = 0;
const check = (label, fg, bg, min) => {
  const r = ratio(fg, bg);
  const ok = r >= min;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(44)} ${r.toFixed(2).padStart(5)}:1  (needs ${min}:1)`);
};

for (const line of ['bci', 'eps', 'edu']) {
  const stroke = xp[`--line-${line}`];
  const text = xp[`--line-${line}-text`];
  if (!stroke || !text) {
    console.log(`FAIL  --line-${line} / --line-${line}-text missing`);
    failed++;
    continue;
  }
  for (const [name, bg] of Object.entries(backgrounds)) {
    check(`--line-${line} (${stroke}) stroke on ${name}`, stroke, bg, 3);
    check(`--line-${line}-text (${text}) on ${name}`, text, bg, 4.5);
  }
  check(`--bg text on --line-${line}-text chip`, global['--bg'], text, 4.5);
}

console.log(failed ? `\n${failed} check(s) failed.` : '\nAll checks passed.');
process.exit(failed ? 1 : 0);
