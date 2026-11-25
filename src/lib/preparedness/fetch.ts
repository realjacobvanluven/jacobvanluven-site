import type { FetchedSource } from './types.ts';
import type { SourceDef } from './sources.ts';
import { FETCH_TIMEOUT_MS } from './constants.ts';

export type FetchLike = (input: string, init?: { signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

export interface FetchOptions {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  now?: () => Date;
}

/** GET a URL as JSON with a timeout. Throws a short, readable message on any failure. */
export async function fetchJson(url: string, opts: FetchOptions = {}): Promise<unknown> {
  const doFetch = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? FETCH_TIMEOUT_MS);
  try {
    // No custom headers: keeps these as simple cross-origin requests with no preflight.
    const res = await doFetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    // ArcGIS answers some failures with HTTP 200 and an error object.
    if (body && typeof body === 'object' && 'error' in body && (body as { error: unknown }).error) {
      throw new Error('The service returned an error');
    }
    return body;
  } catch (err) {
    if (controller.signal.aborted) throw new Error('Timed out');
    throw err instanceof Error ? err : new Error(String(err));
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch and normalize one source. Never throws: failure comes back as `ok: false`. */
export async function fetchSource(source: SourceDef, opts: FetchOptions = {}): Promise<FetchedSource> {
  const now = opts.now ?? (() => new Date());
  try {
    const raw = await fetchJson(source.url, opts);
    const fetchedAt = now();
    const { alerts, readings } = source.normalize(raw, fetchedAt);
    return { id: source.id, ok: true, fetchedAt: fetchedAt.toISOString(), alerts, readings };
  } catch (err) {
    return { id: source.id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
