// Tests for the BC Preparedness Board data layer. Run: npm test
// Fixtures copy the shapes the live services returned on 2026-11-24 (see the workplan, Phase 0).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SOURCES,
  loadBoard,
  buildSnapshot,
  contentKey,
  sortAlerts,
} from '../../src/lib/preparedness/index.ts';
import {
  aqhiCategory,
  normalizeAqhi,
  normalizeEvacuations,
  normalizeFires,
  normalizeRoadEvents,
  normalizeWeatherAlerts,
} from '../../src/lib/preparedness/normalize.ts';

const NOW = new Date('2026-11-24T20:00:00Z');

/* ----------------------------------------------------------------- fixtures */

const fires = {
  features: [
    { attributes: { FIRE_NUMBER: 'N21446', INCIDENT_NAME: 'N21446', FIRE_STATUS: 'Out', CURRENT_SIZE: 0.6 } },
    {
      attributes: {
        FIRE_NUMBER: 'C32392', INCIDENT_NAME: 'C32392', FIRE_STATUS: 'Under Control', CURRENT_SIZE: 0.5,
        FIRE_OF_NOTE_IND: 'N', FIRE_URL: 'https://wildfiresituation.nrs.gov.bc.ca/incidents?fireYear=2026&incidentNumber=C32392',
        GEOGRAPHIC_DESCRIPTION: 'S of Little Gavin Lake', LATITUDE: 52.4861, LONGITUDE: -121.7725, IGNITION_DATE: 1794611310000,
      },
    },
    {
      attributes: {
        FIRE_NUMBER: 'K70001', INCIDENT_NAME: 'Example Creek', FIRE_STATUS: 'Out of Control', CURRENT_SIZE: 1200,
        FIRE_OF_NOTE_IND: 'Y', LATITUDE: 50.1, LONGITUDE: -120.2,
      },
    },
  ],
};

const evac = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[-120, 50], [-120, 51], [-119, 51], [-120, 50]]] },
      properties: {
        EMRG_OAA_SYSID: 1, EVENT_NAME: '2898 Durrell Road Landslide', EVENT_TYPE: 'Landslide', ORDER_ALERT_NAME: 'Splatsin Kukpi7 & Tkwamipla',
        ORDER_ALERT_STATUS: 'Alert', ISSUING_AGENCY: 'Cariboo Regional District', DATE_MODIFIED: Date.parse('2022-08-24T16:00:00Z'),
        EVENT_START_DATE: 1620907200000, MULTI_SOURCED_HOMES: 1, MULTI_SOURCED_POPULATION: 0,
      },
    },
    {
      type: 'Feature', geometry: null,
      properties: { EMRG_OAA_SYSID: 2, EVENT_NAME: 'Flood', EVENT_TYPE: 'Flood', ORDER_ALERT_NAME: 'Area B', ORDER_ALERT_STATUS: 'Order', DATE_MODIFIED: Date.parse('2026-11-24T18:00:41Z') },
    },
    { type: 'Feature', geometry: null, properties: { EMRG_OAA_SYSID: 3, ORDER_ALERT_NAME: 'Area C', ORDER_ALERT_STATUS: 'All Clear' } },
  ],
};

const OFFICIAL_TEXT = 'This statement is in effect.\n\nWhat:\nCoastal flooding.\n\nWhen:\nDuring high tides.';
const eccc = {
  features: [
    {
      id: 'a1', geometry: { type: 'Polygon', coordinates: [[[-123, 49], [-123, 49.1], [-122.9, 49.1], [-123, 49]]] },
      properties: { alert_type: 'statement', alert_name_en: 'coastal flooding statement', feature_name_en: 'Boundary Bay', province: 'BC', status_en: 'continued',
        alert_text_en: OFFICIAL_TEXT, publication_datetime: '2026-11-24T23:48:59.503Z', expiration_datetime: '2026-11-25T15:48:59.503Z' },
    },
    { id: 'a2', geometry: null, properties: { alert_type: 'warning', alert_name_en: 'rainfall warning', feature_name_en: 'North Shore', province: 'BC', risk_colour_en: 'orange' } },
    { id: 'a3', geometry: null, properties: { alert_type: 'warning', alert_name_en: 'wind warning', feature_name_en: 'Howe Sound', province: 'BC', risk_colour_en: 'red' } },
    { id: 'a4', geometry: null, properties: { alert_type: 'warning', alert_name_en: 'snowfall warning', feature_name_en: 'Banff', province: 'AB' } },
    { id: 'a5', geometry: null, properties: { alert_type: 'ended', alert_name_en: 'old', feature_name_en: 'X', province: 'BC' } },
    { id: 'a6', geometry: null, properties: { alert_type: 'watch', alert_name_en: 'tornado watch', feature_name_en: 'Y', province: 'BC' } },
  ],
};

const aqhi = {
  features: [
    { geometry: { type: 'Point', coordinates: [-123.4, 48.4] }, properties: { location_id: 'JCLMX', location_name_en: 'WestShore', aqhi: 1, observation_datetime: '2026-11-24T20:00:00Z', special_notes_en: '' } },
    { geometry: { type: 'Point', coordinates: [-122, 49] }, properties: { location_id: 'AAA', location_name_en: 'Mid Station', aqhi: 4.62, observation_datetime: '2026-11-24T20:00:00Z' } },
    { geometry: { type: 'Point', coordinates: [-121, 50] }, properties: { location_id: 'BBB', location_name_en: 'Smoky Station', aqhi: 8, observation_datetime: '2026-11-24T20:00:00Z', special_notes_en: 'Wildfire smoke' } },
    { geometry: null, properties: { location_id: 'CCC', location_name_en: 'No Data', aqhi: null } },
  ],
};

const roads = {
  events: [
    {
      id: 'drivebc.ca/DBC-1', status: 'ACTIVE', severity: 'MAJOR', headline: 'INCIDENT', created: '2026-07-14T14:44:12-07:00', updated: '2026-09-15T20:06:44-07:00',
      description: 'Washout at Silver Skagit Road, In Hope. Last update: September 15th, 2026 at 8:01pm PDT. Road has been impacted by washout.',
      roads: [{ name: 'Silver Skagit Road' }], areas: [{ name: 'Fraser Valley District' }], geography: { type: 'Point', coordinates: [-121.1, 49.1] },
    },
    { id: 'drivebc.ca/DBC-2', status: 'ARCHIVED', severity: 'MINOR', description: 'Old.' },
  ],
};

/* ----------------------------------------------------------------- normalizers */

test('wildfire: drops fires that are out, maps status to our level, keeps the source status', () => {
  const { alerts } = normalizeFires(fires);
  assert.equal(alerts.length, 2);
  const [calm, big] = alerts;
  assert.equal(calm.severity, 'low');
  assert.equal(calm.sourceLevel, 'Under Control');
  assert.deepEqual(calm.geometry, { type: 'Point', coordinates: [-121.7725, 52.4861] });
  assert.equal(calm.title, 'Wildfire C32392');
  assert.equal(big.severity, 'critical'); // out of control and a fire of note
  assert.equal(big.title, 'Example Creek wildfire');
  assert.equal(big.geometry?.type, 'Point');
});

test('evacuations: orders and alerts only, old records are flagged', () => {
  const { alerts } = normalizeEvacuations(evac, NOW);
  assert.equal(alerts.length, 2);
  const alert = alerts.find((a) => a.sourceLevel === 'Alert');
  const order = alerts.find((a) => a.sourceLevel === 'Order');
  assert.equal(alert.severity, 'high');
  assert.equal(alert.looksOld, true); // modified Aug 2022
  assert.equal(alert.title, 'Evacuation alert: Splatsin Kukpi7 & Tkwamipla');
  assert.equal(order.severity, 'critical');
  assert.equal(order.looksOld, false);
  assert.equal(order.geometry, null);
});

test('weather alerts: BC only, ended dropped, wording kept exactly, levels mapped', () => {
  const { alerts } = normalizeWeatherAlerts(eccc);
  assert.equal(alerts.length, 4);
  assert.ok(!alerts.some((a) => a.area === 'Banff'));
  const statement = alerts.find((a) => a.id === 'eccc-alerts:a1');
  assert.equal(statement.severity, 'info');
  assert.equal(statement.title, 'Coastal flooding statement');
  assert.equal(statement.officialText, OFFICIAL_TEXT, 'official text must not be altered');
  assert.equal(statement.expiresAt, '2026-11-25T15:48:59.503Z');
  assert.equal(alerts.find((a) => a.id === 'eccc-alerts:a2').severity, 'high');
  assert.equal(alerts.find((a) => a.id === 'eccc-alerts:a3').severity, 'critical');
  assert.equal(alerts.find((a) => a.id === 'eccc-alerts:a6').severity, 'moderate');
});

test('air quality: categories follow Health Canada bands', () => {
  assert.equal(aqhiCategory(1), 'low');
  assert.equal(aqhiCategory(3.4), 'low');
  assert.equal(aqhiCategory(4), 'moderate');
  assert.equal(aqhiCategory(6.4), 'moderate');
  assert.equal(aqhiCategory(7), 'high');
  assert.equal(aqhiCategory(10), 'high');
  assert.equal(aqhiCategory(11), 'very high');
});

test('air quality: every station is a reading, only above-low stations become alerts', () => {
  const { alerts, readings } = normalizeAqhi(aqhi);
  assert.equal(readings.length, 3); // the station with no value is skipped
  assert.equal(alerts.length, 2);
  const mid = alerts.find((a) => a.area === 'Mid Station');
  assert.equal(mid.severity, 'low');
  assert.equal(mid.sourceLevel, 'AQHI 5 (moderate risk)');
  const smoky = alerts.find((a) => a.area === 'Smoky Station');
  assert.equal(smoky.severity, 'high');
  assert.equal(smoky.officialText, 'Wildfire smoke');
});

test('road events: active only, first sentence as title, full text kept', () => {
  const { alerts } = normalizeRoadEvents(roads);
  assert.equal(alerts.length, 1);
  const [e] = alerts;
  assert.equal(e.title, 'Washout at Silver Skagit Road, In Hope.');
  assert.ok(e.officialText.includes('Road has been impacted by washout.'));
  assert.equal(e.severity, 'high');
  assert.equal(e.area, 'Fraser Valley District');
  assert.equal(e.geometry?.type, 'Point');
});

test('normalizers reject responses of the wrong shape instead of returning nothing quietly', () => {
  assert.throws(() => normalizeFires({}), /Unexpected wildfire response/);
  assert.throws(() => normalizeEvacuations(null), /Unexpected evacuation response/);
  assert.throws(() => normalizeWeatherAlerts('x'), /Unexpected weather alert response/);
  assert.throws(() => normalizeAqhi({ features: 5 }), /Unexpected air quality response/);
  assert.throws(() => normalizeRoadEvents({ features: [] }), /Unexpected road events response/);
});

test('alerts sort by level, then newest first', () => {
  const mk = (id, severity, updatedAt) => ({ id, severity, updatedAt, issuedAt: null });
  const sorted = sortAlerts([mk('a', 'low', '2026-11-24T10:00:00Z'), mk('b', 'critical', '2026-11-01T00:00:00Z'), mk('c', 'low', '2026-11-24T12:00:00Z')]);
  assert.deepEqual(sorted.map((a) => a.id), ['b', 'c', 'a']);
});

test('source requests: https, only the data the board uses', () => {
  assert.equal(SOURCES.length, 5);
  for (const s of SOURCES) {
    const u = new URL(s.url);
    assert.equal(u.protocol, 'https:', s.id);
  }
  const url = (id) => new URL(SOURCES.find((s) => s.id === id).url);
  assert.equal(url('bc-wildfire').searchParams.get('where'), "FIRE_STATUS<>'Out'");
  assert.equal(url('bc-wildfire').searchParams.get('returnGeometry'), 'false');
  assert.equal(url('drivebc').searchParams.get('event_type'), 'INCIDENT');
  assert.equal(url('eccc-alerts').searchParams.get('bbox'), '-139.1,48.2,-114,60');
  assert.equal(url('eccc-aqhi').searchParams.get('latest'), 'true');
});

/* ----------------------------------------------------------------- loader and failure states */

const bodies = { 'delivery.maps.gov.bc.ca': fires, 'services6.arcgis.com': evac, 'collections/weather-alerts': eccc, 'aqhi-observations': aqhi, 'open511.gov.bc.ca': roads };

/** A fake fetch. `fail` maps a URL fragment to 'http' | 'arcgis-error' | 'hang' | 'network'. */
function fakeFetch({ fail = {}, snapshot = null } = {}) {
  return (url, init) => {
    if (url.includes('preparedness-snapshot')) {
      return snapshot
        ? Promise.resolve({ ok: true, status: 200, json: async () => snapshot })
        : Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    }
    const key = Object.keys(bodies).find((k) => url.includes(k));
    const mode = Object.entries(fail).find(([frag]) => url.includes(frag))?.[1];
    if (mode === 'http') return Promise.resolve({ ok: false, status: 503, json: async () => ({}) });
    if (mode === 'network') return Promise.reject(new TypeError('Failed to fetch'));
    if (mode === 'arcgis-error') return Promise.resolve({ ok: true, status: 200, json: async () => ({ error: { code: 400, message: 'bad' } }) });
    if (mode === 'hang') return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
    return Promise.resolve({ ok: true, status: 200, json: async () => bodies[key] });
  };
}

const opts = (extra = {}) => ({ now: () => NOW, timeoutMs: 50, ...extra });

test('board: all sources live', async () => {
  const board = await loadBoard(opts({ fetchImpl: fakeFetch() }));
  assert.equal(board.status, 'live');
  assert.ok(board.sources.every((s) => s.origin === 'live' && !s.stale && s.error === null));
  assert.equal(board.counts.wildfire, 2);
  assert.equal(board.counts.evacuation, 2);
  assert.equal(board.counts.weather, 4);
  assert.equal(board.counts['air-quality'], 2);
  assert.equal(board.counts.road, 1);
  assert.equal(board.readings.length, 3);
  assert.equal(board.alerts[0].severity, 'critical'); // most serious first
});

test('board: one source down falls back to its own snapshot and says so', async () => {
  const { snapshot } = await buildSnapshot(null, opts({ fetchImpl: fakeFetch(), now: () => new Date('2026-11-24T14:00:00Z') }));
  const board = await loadBoard(opts({ fetchImpl: fakeFetch({ fail: { 'open511.gov.bc.ca': 'http' }, snapshot }) }));
  assert.equal(board.status, 'partial');
  const road = board.sources.find((s) => s.id === 'drivebc');
  assert.equal(road.origin, 'snapshot');
  assert.equal(road.error, 'HTTP 503');
  assert.equal(road.ageMs, 6 * 3_600_000);
  assert.equal(road.stale, false);
  assert.equal(board.counts.road, 1, 'the road alert still shows, from the snapshot');
  assert.equal(board.sources.filter((s) => s.origin === 'live').length, 4);
});

test('board: every source down uses the snapshot, flags it stale when old', async () => {
  const { snapshot } = await buildSnapshot(null, opts({ fetchImpl: fakeFetch(), now: () => new Date('2026-11-22T00:00:00Z') }));
  const everything = Object.fromEntries(Object.keys(bodies).map((k) => [k, 'network']));
  const board = await loadBoard(opts({ fetchImpl: fakeFetch({ fail: everything, snapshot }) }));
  assert.equal(board.status, 'snapshot');
  assert.ok(board.sources.every((s) => s.origin === 'snapshot' && s.stale), 'two days old is past the stale limit');
  assert.ok(board.alerts.length > 0);
});

test('board: every source down and no snapshot is "unavailable", not an empty all-clear', async () => {
  const everything = Object.fromEntries(Object.keys(bodies).map((k) => [k, 'network']));
  const board = await loadBoard(opts({ fetchImpl: fakeFetch({ fail: everything }) }));
  assert.equal(board.status, 'unavailable');
  assert.equal(board.alerts.length, 0);
  assert.ok(board.sources.every((s) => s.origin === 'none' && s.fetchedAt === null && s.error));
});

test('board: a service that answers 200 with an error body counts as failed', async () => {
  const board = await loadBoard(opts({ fetchImpl: fakeFetch({ fail: { 'services6.arcgis.com': 'arcgis-error' } }) }));
  const s = board.sources.find((x) => x.id === 'bc-evacuation');
  assert.equal(s.origin, 'none');
  assert.equal(s.error, 'The service returned an error');
  assert.equal(board.status, 'partial');
});

test('board: a source that never answers times out without blocking the others', async () => {
  const started = Date.now();
  const board = await loadBoard(opts({ fetchImpl: fakeFetch({ fail: { 'aqhi-observations': 'hang' } }) }));
  assert.ok(Date.now() - started < 2000);
  assert.equal(board.sources.find((s) => s.id === 'eccc-aqhi').error, 'Timed out');
  assert.equal(board.counts.wildfire, 2);
});

test('board: the snapshot is only requested when a live source fails', async () => {
  const requested = [];
  const spy = (url, init) => {
    requested.push(url);
    return fakeFetch()(url, init);
  };
  await loadBoard(opts({ fetchImpl: spy }));
  assert.ok(!requested.some((u) => u.includes('preparedness-snapshot')), 'all live: no snapshot download');
  requested.length = 0;
  const spy2 = (url, init) => {
    requested.push(url);
    return fakeFetch({ fail: { 'open511.gov.bc.ca': 'http' } })(url, init);
  };
  await loadBoard(opts({ fetchImpl: spy2 }));
  assert.ok(requested.some((u) => u.includes('preparedness-snapshot')), 'a source failed: snapshot is fetched');
});

test('board: a broken snapshot file is ignored', async () => {
  const board = await loadBoard(opts({ fetchImpl: fakeFetch({ fail: { 'open511.gov.bc.ca': 'http' }, snapshot: { nonsense: true } }) }));
  assert.equal(board.status, 'partial');
  assert.equal(board.sources.find((s) => s.id === 'drivebc').origin, 'none');
});

/* ----------------------------------------------------------------- snapshot */

test('snapshot: a failing source keeps its last good data with the error recorded', async () => {
  const first = await buildSnapshot(null, opts({ fetchImpl: fakeFetch(), now: () => new Date('2026-11-24T06:00:00Z') }));
  assert.equal(first.okCount, 5);
  const second = await buildSnapshot(first.snapshot, opts({ fetchImpl: fakeFetch({ fail: { 'collections/weather-alerts': 'http' } }), now: () => new Date('2026-11-24T12:00:00Z') }));
  assert.equal(second.okCount, 4);
  const w = second.snapshot.sources['eccc-alerts'];
  assert.equal(w.status, 'error');
  assert.equal(w.error, 'HTTP 503');
  assert.equal(w.fetchedAt, '2026-11-24T06:00:00.000Z', 'time of the last good fetch, not the failed one');
  assert.equal(w.alerts.length, 4, 'earlier alerts are kept');
});

test('snapshot: a first run with a failing source stores an empty, errored entry', async () => {
  const { snapshot } = await buildSnapshot(null, opts({ fetchImpl: fakeFetch({ fail: { 'open511.gov.bc.ca': 'network' } }) }));
  const r = snapshot.sources.drivebc;
  assert.deepEqual([r.status, r.fetchedAt, r.alerts.length], ['error', null, 0]);
});

test('snapshot: the change key ignores timestamps', async () => {
  const a = await buildSnapshot(null, opts({ fetchImpl: fakeFetch(), now: () => new Date('2026-11-24T06:00:00Z') }));
  const b = await buildSnapshot(a.snapshot, opts({ fetchImpl: fakeFetch(), now: () => new Date('2026-11-24T12:00:00Z') }));
  assert.notEqual(a.snapshot.generatedAt, b.snapshot.generatedAt);
  assert.equal(contentKey(a.snapshot), contentKey(b.snapshot));
  assert.notEqual(contentKey(a.snapshot), contentKey(null));
});
