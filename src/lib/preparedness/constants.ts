import type { HazardId, Severity, SourceId } from './types.ts';

/** Rough box around BC, west/south/east/north. Used to filter Environment Canada requests. */
export const BC_BBOX = [-139.1, 48.2, -114.0, 60.0] as const;

/** Where the scheduled job saves its fallback copy (served by Cloudflare Pages). */
export const SNAPSHOT_URL = '/data/preparedness-snapshot.json';

/** A snapshot older than this is shown with a stale warning. A proposal: tune after watching it run. */
export const STALE_SNAPSHOT_HOURS = 36;

/**
 * An evacuation record untouched for this long is treated as probably rescinded: it stays in the list with a
 * warning but is not drawn on the map. The BC dataset still carries orders last modified in 2022-2025.
 */
export const OLD_RECORD_DAYS = 60;

/** How long to wait for one source before giving up on it. */
export const FETCH_TIMEOUT_MS = 10_000;

export const HAZARD_LABELS: Record<HazardId, string> = {
  wildfire: 'Wildfire',
  evacuation: 'Evacuation',
  weather: 'Weather',
  'air-quality': 'Air quality',
  road: 'Roads',
};

export const HAZARD_ORDER: HazardId[] = ['evacuation', 'wildfire', 'weather', 'air-quality', 'road'];

/** Most to least serious. */
export const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'moderate', 'low', 'info'];

/** Credit lines required by the data licences (checked 2026-11-24; see the workplan). */
export const CREDITS = {
  oglBc: 'Contains information licensed under the Open Government Licence – British Columbia.',
  eccc: 'Contains information licenced under the Data Server End-use Licence of Environment and Climate Change Canada.',
} as const;

/** Which credit each source needs. */
export const SOURCE_CREDIT: Record<SourceId, keyof typeof CREDITS> = {
  'bc-wildfire': 'oglBc',
  'bc-evacuation': 'oglBc',
  drivebc: 'oglBc',
  'eccc-alerts': 'eccc',
  'eccc-aqhi': 'eccc',
};

/** Official places to send people. The board is not an official alert service. */
export const OFFICIAL_LINKS = [
  { label: 'EmergencyInfoBC', url: 'https://www.emergencyinfobc.gov.bc.ca/' },
  { label: 'BC Wildfire Service', url: 'https://wildfiresituation.nrs.gov.bc.ca' },
  { label: 'DriveBC', url: 'https://drivebc.ca/' },
  { label: 'BC River Forecast Centre flood warnings', url: 'https://bcrfc.env.gov.bc.ca/warnings/index.htm' },
  { label: 'Environment Canada weather', url: 'https://weather.gc.ca/' },
] as const;
