// Writes the board's test fixtures (and a snapshot built from them) as JSON for the browser QA script.
// Dev tool, not part of the site build.   node scripts/qa/dump-fixtures.mjs /tmp/pb-fixtures
import { writeFileSync, mkdirSync } from 'node:fs';
import { fires, evac, eccc, aqhi, roads } from '../test/fixtures.mjs';
import { buildSnapshot } from '../../src/lib/preparedness/index.ts';
const out = process.argv[2] ?? '/tmp/pb-fixtures';
mkdirSync(out, { recursive: true });
const bodies = { 'delivery.maps.gov.bc.ca': fires, 'services6.arcgis.com': evac, 'collections/weather-alerts': eccc, 'aqhi-observations': aqhi, 'open511.gov.bc.ca': roads };
writeFileSync(`${out}/bodies.json`, JSON.stringify(bodies));
const fetch = async (url) => ({ ok: true, status: 200, json: async () => bodies[Object.keys(bodies).find((k) => url.includes(k))] });
const { snapshot } = await buildSnapshot(null, { fetchImpl: fetch });
writeFileSync(`${out}/snapshot.json`, JSON.stringify(snapshot));
console.log('wrote', out);
