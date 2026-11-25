/**
 * Shared types for the BC Preparedness Board data layer.
 * Runs in the browser and in Node (the snapshot script), so this folder uses erasable TypeScript only:
 * no enums, no parameter properties, and `import type` for types.
 */

export type HazardId = 'wildfire' | 'evacuation' | 'weather' | 'air-quality' | 'road';

/**
 * OUR display level, used for sorting and colour. It is not an official rating.
 * The source's own wording is kept in `Alert.sourceLevel` and must be shown next to it.
 */
export type Severity = 'critical' | 'high' | 'moderate' | 'low' | 'info';

export type SourceId = 'bc-wildfire' | 'bc-evacuation' | 'eccc-alerts' | 'eccc-aqhi' | 'drivebc';

export interface GeoJsonGeometry {
  type: string;
  // GeoJSON coordinates are nested arrays of numbers; kept loose on purpose.
  coordinates: unknown;
}

/** One thing to show in the feed and on the map, from any source. */
export interface Alert {
  /** Unique across sources: `<source>:<native id>`. */
  id: string;
  source: SourceId;
  hazard: HazardId;
  severity: Severity;
  /** The source's own level or status, shown to readers (e.g. "warning", "Order", "Being Held"). */
  sourceLevel: string;
  title: string;
  /** Short, plain description built from the source's fields. Never a rewrite of an official alert. */
  summary: string;
  /** Official wording, exactly as published. ECCC's licence forbids altering alerts. */
  officialText: string | null;
  area: string | null;
  issuedAt: string | null;
  updatedAt: string | null;
  expiresAt: string | null;
  /** True when the record has not been touched for a long time and may be out of date. */
  looksOld: boolean;
  /** Where to read the official version. */
  url: string;
  geometry: GeoJsonGeometry | null;
}

/** A measured value that is not an alert (air quality readings at stations). */
export interface Reading {
  id: string;
  source: SourceId;
  hazard: HazardId;
  name: string;
  value: number;
  /** Health Canada AQHI category for the value. */
  category: 'low' | 'moderate' | 'high' | 'very high';
  observedAt: string | null;
  notes: string | null;
  geometry: GeoJsonGeometry | null;
}

export interface SourceResult {
  alerts: Alert[];
  readings: Reading[];
}

export type FetchedSource =
  | { id: SourceId; ok: true; fetchedAt: string; alerts: Alert[]; readings: Reading[] }
  | { id: SourceId; ok: false; error: string };

export interface SnapshotSource {
  status: 'ok' | 'error';
  /** When this source's data was last fetched successfully. */
  fetchedAt: string | null;
  /** Set when the latest attempt failed; the data is then carried over from the last good fetch. */
  error?: string;
  alerts: Alert[];
  readings: Reading[];
}

export interface Snapshot {
  version: 1;
  generatedAt: string;
  sources: Partial<Record<SourceId, SnapshotSource>>;
}

export type Origin = 'live' | 'snapshot' | 'none';

export interface SourceStatus {
  id: SourceId;
  label: string;
  origin: Origin;
  /** When the data shown was fetched. Null when there is none. */
  fetchedAt: string | null;
  ageMs: number | null;
  /** A snapshot older than the stale limit. Live data is never stale. */
  stale: boolean;
  /** Why live data failed, when it did. */
  error: string | null;
  alertCount: number;
}

export type BoardStatus = 'live' | 'partial' | 'snapshot' | 'unavailable';

export interface Board {
  alerts: Alert[];
  readings: Reading[];
  sources: SourceStatus[];
  status: BoardStatus;
  /** Alert counts by hazard, for the summary strip. */
  counts: Record<HazardId, number>;
  loadedAt: string;
}
