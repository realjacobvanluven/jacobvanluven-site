import type { Snapshot, SnapshotSource, SourceId } from './types.ts';
import { fetchSource, type FetchOptions } from './fetch.ts';
import { SOURCES } from './sources.ts';

/**
 * Build the fallback snapshot. Runs in the scheduled GitHub Action (Node), using the same fetchers and
 * normalizers as the browser. A source that fails keeps its last good data, marked with the error, so
 * one bad run never wipes the fallback.
 */
export async function buildSnapshot(
  previous: Snapshot | null,
  opts: FetchOptions = {},
): Promise<{ snapshot: Snapshot; okCount: number }> {
  const now = (opts.now ?? (() => new Date()))();
  const results = await Promise.all(SOURCES.map((s) => fetchSource(s, opts)));

  const sources: Partial<Record<SourceId, SnapshotSource>> = {};
  let okCount = 0;
  for (const r of results) {
    if (r.ok) {
      okCount += 1;
      sources[r.id] = { status: 'ok', fetchedAt: r.fetchedAt, alerts: r.alerts, readings: r.readings };
    } else {
      const old = previous?.sources[r.id];
      sources[r.id] = {
        status: 'error',
        fetchedAt: old?.fetchedAt ?? null,
        error: r.error,
        alerts: old?.alerts ?? [],
        readings: old?.readings ?? [],
      };
    }
  }
  return { snapshot: { version: 1, generatedAt: now.toISOString(), sources }, okCount };
}

/** The part of a snapshot that matters for deciding whether to commit: everything except timestamps. */
export function contentKey(snapshot: Snapshot | null): string {
  if (!snapshot) return '';
  const parts = SOURCES.map((s) => {
    const src = snapshot.sources[s.id];
    return src ? { id: s.id, status: src.status, alerts: src.alerts, readings: src.readings } : { id: s.id };
  });
  return JSON.stringify(parts);
}
