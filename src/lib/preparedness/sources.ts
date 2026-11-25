import type { HazardId, SourceId, SourceResult } from './types.ts';
import { BC_BBOX } from './constants.ts';
import {
  normalizeAqhi,
  normalizeEvacuations,
  normalizeFires,
  normalizeRoadEvents,
  normalizeWeatherAlerts,
} from './normalize.ts';

/**
 * The live sources. All free, no keys. Each request asks only for what the board uses (small payloads,
 * and ECCC's usage policy asks users to request only the data they intend to use).
 * Tested from a browser on 2026-11-24; see the workplan's Phase 0 results.
 */

export interface SourceDef {
  id: SourceId;
  label: string;
  hazard: HazardId;
  url: string;
  normalize: (raw: unknown, now: Date) => SourceResult;
}

function withParams(base: string, params: Record<string, string>): string {
  const url = new URL(base);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

const bbox = BC_BBOX.join(',');

export const SOURCES: SourceDef[] = [
  {
    id: 'bc-wildfire',
    label: 'BC Wildfire Service: fire locations',
    hazard: 'wildfire',
    // Without the filter this layer hits its 1,000-record cap (about 618 KB), mostly fires that are out.
    url: withParams('https://delivery.maps.gov.bc.ca/arcgis/rest/services/mpcm/bcgwpub/MapServer/502/query', {
      where: "FIRE_STATUS<>'Out'",
      outFields:
        'FIRE_NUMBER,INCIDENT_NAME,FIRE_STATUS,CURRENT_SIZE,FIRE_OF_NOTE_IND,FIRE_URL,GEOGRAPHIC_DESCRIPTION,LATITUDE,LONGITUDE,IGNITION_DATE,OBJECTID',
      returnGeometry: 'false',
      f: 'json',
    }),
    normalize: (raw) => normalizeFires(raw),
  },
  {
    id: 'bc-evacuation',
    label: 'Evacuation Orders and Alerts',
    hazard: 'evacuation',
    // Simplified shapes: about 15 KB instead of 57 KB.
    url: withParams(
      'https://services6.arcgis.com/ubm4tcTYICKBpist/arcgis/rest/services/Evacuation_Orders_and_Alerts/FeatureServer/0/query',
      {
        where: '1=1',
        outFields:
          'EMRG_OAA_SYSID,ORDER_ALERT_NAME,ORDER_ALERT_STATUS,EVENT_NAME,EVENT_TYPE,ISSUING_AGENCY,DATE_MODIFIED,EVENT_START_DATE,MULTI_SOURCED_POPULATION,MULTI_SOURCED_HOMES,OBJECTID',
        f: 'geojson',
        maxAllowableOffset: '0.01',
        geometryPrecision: '3',
      },
    ),
    normalize: (raw, now) => normalizeEvacuations(raw, now),
  },
  {
    id: 'eccc-alerts',
    label: 'Environment Canada: weather alerts',
    hazard: 'weather',
    url: withParams('https://api.weather.gc.ca/collections/weather-alerts/items', {
      f: 'json',
      bbox,
      limit: '500',
      properties:
        'alert_type,alert_name_en,alert_short_name_en,alert_text_en,feature_name_en,feature_id,alert_code,publication_datetime,expiration_datetime,event_end_datetime,risk_colour_en,status_en,province',
    }),
    normalize: (raw) => normalizeWeatherAlerts(raw),
  },
  {
    id: 'eccc-aqhi',
    label: 'Environment Canada: air quality (AQHI)',
    hazard: 'air-quality',
    // Latest reading per station. Forecasts are left out of v1: the API has no "latest per area" filter.
    url: withParams('https://api.weather.gc.ca/collections/aqhi-observations-realtime/items', {
      f: 'json',
      latest: 'true',
      bbox,
      limit: '300',
    }),
    normalize: (raw) => normalizeAqhi(raw),
  },
  {
    id: 'drivebc',
    label: 'DriveBC: road incidents',
    hazard: 'road',
    // Incidents only: of 350 active events, most are construction (1.4 MB). Incidents are about 57 KB.
    url: withParams('https://api.open511.gov.bc.ca/events', {
      status: 'ACTIVE',
      event_type: 'INCIDENT',
      limit: '500',
    }),
    normalize: (raw) => normalizeRoadEvents(raw),
  },
];

export const SOURCE_BY_ID: Record<SourceId, SourceDef> = Object.fromEntries(SOURCES.map((s) => [s.id, s])) as Record<
  SourceId,
  SourceDef
>;
