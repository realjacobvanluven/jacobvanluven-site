// Saves the fallback copy of the BC Preparedness Board data to public/data/preparedness-snapshot.json.
// Run by .github/workflows/preparedness-snapshot.yml on a schedule, or by hand: npm run data:preparedness
// It uses the same fetchers as the browser (src/lib/preparedness), so what is saved is what the page would show.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSnapshot, contentKey } from '../src/lib/preparedness/index.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, process.argv[2] ?? 'public/data/preparedness-snapshot.json');
/** Rewrite an unchanged snapshot only this often, so the saved time never looks too old. */
const REFRESH_AFTER_HOURS = 20;

let previous = null;
try {
  previous = JSON.parse(await readFile(out, 'utf8'));
  if (previous?.version !== 1) previous = null;
} catch {
  previous = null;
}

const { snapshot, okCount } = await buildSnapshot(previous);

for (const [id, s] of Object.entries(snapshot.sources)) {
  console.log(`${s.status === 'ok' ? 'ok   ' : 'ERROR'} ${id}: ${s.alerts.length} alerts, ${s.readings.length} readings${s.error ? ` (${s.error})` : ''}`);
}

if (okCount === 0) {
  console.error('Every source failed. Leaving the saved snapshot as it is.');
  process.exit(1);
}

const unchanged = contentKey(previous) === contentKey(snapshot);
const ageHours = previous ? (Date.now() - Date.parse(previous.generatedAt)) / 3_600_000 : Infinity;
if (unchanged && ageHours < REFRESH_AFTER_HOURS) {
  console.log('No changes since the last snapshot; not rewriting it.');
} else {
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(snapshot) + '\n');
  console.log(`Wrote ${out}`);
}
