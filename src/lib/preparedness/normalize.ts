import type { Alert, GeoJsonGeometry, Reading, Severity, SourceResult } from './types.ts';
import { OLD_RECORD_DAYS } from './constants.ts';

/* Pure functions: raw source JSON in, common records out. No network, no clock unless passed in. */

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Epoch milliseconds or an ISO string to an ISO string; null when missing or not a date. */
export function toIso(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  const d = new Date(v as string | number);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function features(json: unknown, label: string, key = 'features'): Obj[] {
  if (!isObj(json) || !Array.isArray(json[key])) {
    throw new Error(`Unexpected ${label} response`);
  }
  return (json[key] as unknown[]).filter(isObj);
}

function geometryOf(v: unknown): GeoJsonGeometry | null {
  return isObj(v) && typeof v.type === 'string' && v.coordinates !== undefined
    ? { type: v.type, coordinates: v.coordinates }
    : null;
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/* ---------------------------------------------------------------- BC Wildfire fire locations */

function fireSeverity(status: string, ofNote: boolean): Severity {
  switch (status) {
    case 'Out of Control':
      return ofNote ? 'critical' : 'high';
    case 'Being Held':
      return 'moderate';
    default:
      return 'low';
  }
}

/** ArcGIS query result (f=json, no geometry) for current fire locations. Fires that are Out are dropped. */
export function normalizeFires(json: unknown): SourceResult {
  const alerts: Alert[] = [];
  for (const f of features(json, 'wildfire')) {
    const a = isObj(f.attributes) ? f.attributes : {};
    const status = str(a.FIRE_STATUS);
    if (status === 'Out') continue;
    const number = str(a.FIRE_NUMBER) || str(a.INCIDENT_NAME);
    const name = str(a.INCIDENT_NAME);
    const where = str(a.GEOGRAPHIC_DESCRIPTION);
    const lat = num(a.LATITUDE);
    const lon = num(a.LONGITUDE);
    const size = num(a.CURRENT_SIZE);
    const ofNote = str(a.FIRE_OF_NOTE_IND) === 'Y';
    const title = name && name !== number ? `${name} wildfire` : `Wildfire ${number}`;
    alerts.push({
      id: `bc-wildfire:${str(a.FIRE_NUMBER) || str(a.OBJECTID) || title}`,
      source: 'bc-wildfire',
      hazard: 'wildfire',
      severity: fireSeverity(status, ofNote),
      sourceLevel: status || 'Unknown',
      title,
      summary: [status, size !== null ? `${size} ha` : '', ofNote ? 'fire of note' : ''].filter(Boolean).join(', '),
      officialText: null,
      area: where || null,
      issuedAt: toIso(a.IGNITION_DATE),
      updatedAt: null,
      expiresAt: null,
      looksOld: false,
      url: str(a.FIRE_URL) || 'https://wildfiresituation.nrs.gov.bc.ca',
      geometry: lat !== null && lon !== null ? { type: 'Point', coordinates: [lon, lat] } : null,
    });
  }
  return { alerts, readings: [] };
}

/* ---------------------------------------------------------------- Evacuation Orders and Alerts */

/** ArcGIS query result as GeoJSON (f=geojson). */
export function normalizeEvacuations(json: unknown, now: Date = new Date()): SourceResult {
  const alerts: Alert[] = [];
  for (const f of features(json, 'evacuation')) {
    const p = isObj(f.properties) ? f.properties : {};
    const status = str(p.ORDER_ALERT_STATUS);
    if (status !== 'Order' && status !== 'Alert') continue; // "All Clear" and anything else are not active
    const updatedAt = toIso(p.DATE_MODIFIED);
    const ageDays = updatedAt ? (now.getTime() - new Date(updatedAt).getTime()) / 86_400_000 : 0;
    const name = str(p.ORDER_ALERT_NAME) || 'Unnamed area';
    const event = str(p.EVENT_NAME);
    const kind = str(p.EVENT_TYPE);
    const agency = str(p.ISSUING_AGENCY);
    const homes = num(p.MULTI_SOURCED_HOMES);
    const people = num(p.MULTI_SOURCED_POPULATION);
    alerts.push({
      id: `bc-evacuation:${str(p.EMRG_OAA_SYSID) || str(p.OBJECTID) || `${name}-${status}`}`,
      source: 'bc-evacuation',
      hazard: 'evacuation',
      severity: status === 'Order' ? 'critical' : 'high',
      sourceLevel: status,
      title: `Evacuation ${status.toLowerCase()}: ${name}`,
      summary: [
        event && kind ? `${event} (${kind})` : event || kind,
        agency ? `Issued by ${agency}` : '',
        homes ? `${homes} homes` : '',
        people ? `${people} people` : '',
      ]
        .filter(Boolean)
        .join('. '),
      officialText: null,
      area: name,
      issuedAt: toIso(p.EVENT_START_DATE),
      updatedAt,
      expiresAt: null,
      looksOld: ageDays > OLD_RECORD_DAYS,
      url: 'https://www.emergencyinfobc.gov.bc.ca/',
      geometry: geometryOf(f.geometry),
    });
  }
  return { alerts, readings: [] };
}

/* ---------------------------------------------------------------- Environment Canada weather alerts */

function weatherSeverity(type: string, colour: string): Severity {
  switch (type) {
    case 'warning':
      return colour === 'red' ? 'critical' : 'high';
    case 'watch':
      return 'moderate';
    case 'advisory':
      return 'low';
    default:
      return 'info'; // statements
  }
}

/** OGL-API items from the weather-alerts collection (f=json). Only BC, only alerts still in effect. */
export function normalizeWeatherAlerts(json: unknown): SourceResult {
  const alerts: Alert[] = [];
  for (const f of features(json, 'weather alert')) {
    const p = isObj(f.properties) ? f.properties : {};
    const province = str(p.province);
    if (province && province !== 'BC') continue;
    const type = str(p.alert_type).toLowerCase();
    const status = str(p.status_en).toLowerCase();
    if (type === 'ended' || status === 'ended') continue;
    const colour = str(p.risk_colour_en).toLowerCase();
    const name = str(p.alert_name_en) || str(p.alert_short_name_en) || 'Weather alert';
    const area = str(p.feature_name_en);
    const idPart = str(f.id) || `${str(p.feature_id)}:${str(p.alert_code)}`;
    // Official wording: keep line breaks, only trim the ends.
    const text = typeof p.alert_text_en === 'string' && p.alert_text_en.trim() ? p.alert_text_en.trim() : null;
    alerts.push({
      id: `eccc-alerts:${idPart}`,
      source: 'eccc-alerts',
      hazard: 'weather',
      severity: weatherSeverity(type, colour),
      sourceLevel: type || 'alert',
      title: capitalize(name),
      summary: area ? `In effect for ${area}.` : '',
      officialText: text,
      area: area || null,
      issuedAt: toIso(p.publication_datetime),
      updatedAt: toIso(p.publication_datetime),
      expiresAt: toIso(p.expiration_datetime) ?? toIso(p.event_end_datetime),
      looksOld: false,
      url: 'https://weather.gc.ca/',
      geometry: geometryOf(f.geometry),
    });
  }
  return { alerts, readings: [] };
}

/* ---------------------------------------------------------------- Air Quality Health Index */

/** Health Canada AQHI categories: 1-3 low, 4-6 moderate, 7-10 high, above 10 very high. */
export function aqhiCategory(value: number): Reading['category'] {
  const v = Math.round(value);
  if (v <= 3) return 'low';
  if (v <= 6) return 'moderate';
  if (v <= 10) return 'high';
  return 'very high';
}

/**
 * Latest AQHI observations (f=json, latest=true). Every station becomes a reading; only stations
 * above the low category also become alerts, so the feed is not full of "low risk" entries.
 */
export function normalizeAqhi(json: unknown): SourceResult {
  const readings: Reading[] = [];
  const alerts: Alert[] = [];
  for (const f of features(json, 'air quality')) {
    const p = isObj(f.properties) ? f.properties : {};
    const value = num(p.aqhi);
    if (value === null) continue;
    const name = str(p.location_name_en) || str(p.location_id) || 'Station';
    const category = aqhiCategory(value);
    const observedAt = toIso(p.observation_datetime);
    const notes = str(p.special_notes_en) || null;
    const geometry = geometryOf(f.geometry);
    const idPart = str(p.location_id) || name;
    readings.push({ id: `eccc-aqhi:${idPart}`, source: 'eccc-aqhi', hazard: 'air-quality', name, value, category, observedAt, notes, geometry });
    if (category !== 'low') {
      alerts.push({
        id: `eccc-aqhi:${idPart}`,
        source: 'eccc-aqhi',
        hazard: 'air-quality',
        severity: category === 'moderate' ? 'low' : category === 'high' ? 'high' : 'critical',
        sourceLevel: `AQHI ${Math.round(value)} (${category} risk)`,
        title: `Air quality: ${name}`,
        summary: `Air Quality Health Index ${Math.round(value)}, ${category} health risk.`,
        officialText: notes,
        area: name,
        issuedAt: observedAt,
        updatedAt: observedAt,
        expiresAt: null,
        looksOld: false,
        url: 'https://weather.gc.ca/',
        geometry,
      });
    }
  }
  return { alerts, readings };
}

/* ---------------------------------------------------------------- DriveBC Open511 */

function roadSeverity(s: string): Severity {
  switch (s.toUpperCase()) {
    case 'MAJOR':
      return 'high';
    case 'MODERATE':
      return 'moderate';
    case 'MINOR':
      return 'low';
    default:
      return 'info';
  }
}

/** First sentence of a DriveBC description, as a title. The full text stays in `officialText`. */
function firstSentence(text: string): string {
  const end = text.search(/[.!?](\s|$)/);
  const s = end > 0 ? text.slice(0, end + 1) : text;
  return s.length > 120 ? `${s.slice(0, 117).trimEnd()}...` : s;
}

/** Open511 events response (already filtered to active incidents by the request). */
export function normalizeRoadEvents(json: unknown): SourceResult {
  const alerts: Alert[] = [];
  for (const e of features(json, 'road events', 'events')) {
    if (str(e.status) && str(e.status) !== 'ACTIVE') continue;
    const description = str(e.description);
    const roads = Array.isArray(e.roads) ? e.roads.filter(isObj) : [];
    const areas = Array.isArray(e.areas) ? e.areas.filter(isObj) : [];
    const road = roads.length ? str(roads[0].name) : '';
    const area = areas.length ? str(areas[0].name) : '';
    const severity = str(e.severity);
    alerts.push({
      id: `drivebc:${str(e.id) || description.slice(0, 40)}`,
      source: 'drivebc',
      hazard: 'road',
      severity: roadSeverity(severity),
      sourceLevel: severity ? severity.toLowerCase() : str(e.headline).toLowerCase() || 'incident',
      title: description ? firstSentence(description) : road ? `Road incident on ${road}` : 'Road incident',
      summary: [road, area].filter(Boolean).join(', '),
      officialText: description || null,
      area: area || road || null,
      issuedAt: toIso(e.created),
      updatedAt: toIso(e.updated),
      expiresAt: null,
      looksOld: false,
      url: 'https://drivebc.ca/',
      geometry: geometryOf(e.geography),
    });
  }
  return { alerts, readings: [] };
}
