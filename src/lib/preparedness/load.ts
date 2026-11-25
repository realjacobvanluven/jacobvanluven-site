import type {
  Alert,
  Board,
  BoardStatus,
  HazardId,
  Reading,
  Snapshot,
  SnapshotSource,
  SourceStatus,
} from './types.ts';
import { HAZARD_LABELS, SEVERITY_ORDER, SNAPSHOT_URL, STALE_SNAPSHOT_HOURS } from './constants.ts';
import { fetchJson, fetchSource, type FetchOptions } from './fetch.ts';
import { SOURCES } from './sources.ts';

export interface LoadOptions extends FetchOptions {
  snapshotUrl?: string;
  staleAfterHours?: number;
}

function isSnapshot(v: unknown): v is Snapshot {
  return (
    typeof v === 'object' &&
    v !== null &&
    (v as Snapshot).version === 1 &&
    typeof (v as Snapshot).sources === 'object' &&
    (v as Snapshot).sources !== null
  );
}

/** Most serious first; within a level, most recently updated first. */
export function sortAlerts(alerts: Alert[]): Alert[] {
  return [...alerts].sort((a, b) => {
    const s = SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity);
    if (s !== 0) return s;
    const ta = Date.parse(a.updatedAt ?? a.issuedAt ?? '') || 0;
    const tb = Date.parse(b.updatedAt ?? b.issuedAt ?? '') || 0;
    return tb - ta;
  });
}

function emptyCounts(): Record<HazardId, number> {
  return Object.fromEntries(Object.keys(HAZARD_LABELS).map((h) => [h, 0])) as Record<HazardId, number>;
}

/**
 * Load everything the board shows. Live data first, per source; if a source fails, its saved snapshot
 * stands in, with its age. One failing source never blocks the others.
 */
export async function loadBoard(opts: LoadOptions = {}): Promise<Board> {
  const now = (opts.now ?? (() => new Date()))();
  const staleMs = (opts.staleAfterHours ?? STALE_SNAPSHOT_HOURS) * 3_600_000;

  const live = await Promise.all(SOURCES.map((s) => fetchSource(s, opts)));

  // The snapshot is about 200 KB, so only download it when a live source actually failed.
  const snapshot: Snapshot | null = live.every((r) => r.ok)
    ? null
    : await fetchJson(opts.snapshotUrl ?? SNAPSHOT_URL, opts)
        .then((v) => (isSnapshot(v) ? v : null))
        .catch(() => null);

  const alerts: Alert[] = [];
  const readings: Reading[] = [];
  const sources: SourceStatus[] = [];

  for (const source of SOURCES) {
    const result = live.find((r) => r.id === source.id);
    if (result && result.ok) {
      alerts.push(...result.alerts);
      readings.push(...result.readings);
      sources.push({
        id: source.id,
        label: source.label,
        origin: 'live',
        fetchedAt: result.fetchedAt,
        ageMs: 0,
        stale: false,
        error: null,
        alertCount: result.alerts.length,
      });
      continue;
    }
    const error = result && !result.ok ? result.error : 'No response';
    const saved: SnapshotSource | undefined = snapshot?.sources[source.id];
    if (saved && saved.fetchedAt) {
      const ageMs = Math.max(0, now.getTime() - Date.parse(saved.fetchedAt));
      alerts.push(...saved.alerts);
      readings.push(...saved.readings);
      sources.push({
        id: source.id,
        label: source.label,
        origin: 'snapshot',
        fetchedAt: saved.fetchedAt,
        ageMs,
        stale: ageMs > staleMs,
        error,
        alertCount: saved.alerts.length,
      });
    } else {
      sources.push({
        id: source.id,
        label: source.label,
        origin: 'none',
        fetchedAt: null,
        ageMs: null,
        stale: false,
        error,
        alertCount: 0,
      });
    }
  }

  const origins = sources.map((s) => s.origin);
  const status: BoardStatus = origins.every((o) => o === 'live')
    ? 'live'
    : origins.every((o) => o === 'none')
      ? 'unavailable'
      : origins.every((o) => o === 'snapshot' || o === 'none')
        ? 'snapshot'
        : 'partial';

  const counts = emptyCounts();
  for (const a of alerts) counts[a.hazard] += 1;

  return {
    alerts: sortAlerts(alerts),
    readings,
    sources,
    status,
    counts,
    loadedAt: now.toISOString(),
  };
}
