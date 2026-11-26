import { getCollection, type CollectionEntry } from 'astro:content';
import { lines } from '../content.config';

export type Station = CollectionEntry<'experience'>;
export type Line = (typeof lines)[number];

/** Display names for the transit-map lines (the legend and each card's line chip). */
export const lineNames: Record<Line, string> = {
  bci: 'BCI',
  eps: 'Emergency Planning Secretariat',
  edu: 'Education',
};

export const strandNames = { storytelling: 'Storytelling', business: 'Business', building: 'Building' } as const;

/**
 * All stations, newest first (by start month). Stations without dates (education, until Jacob adds them) go last,
 * in reverse id order, so `edu-kpu` sits above `edu-langara` (Langara came first).
 */
export async function getStations(): Promise<Station[]> {
  const all = await getCollection('experience');
  return all.sort((a, b) => {
    const sa = a.data.start;
    const sb = b.data.start;
    if (sa && sb) return sb.localeCompare(sa);
    if (sa) return -1;
    if (sb) return 1;
    return a.id.localeCompare(b.id);
  });
}

/** Short line names for each card's chip: line identity is always written out, never colour alone. */
export const lineChips: Record<Line, string> = { bci: 'BCI line', eps: 'EPS line', edu: 'Education line' };

/** One line's piece of track in one row of the timeline (desktop draws every line as its own parallel lane). */
export type Segment = {
  line: Line;
  /** The track runs in from the row above / out to the row below. */
  top: boolean;
  bottom: boolean;
  /** This row's station is on this line (or is an interchange with it). */
  station: boolean;
};

const monthKey = (end?: string) => (!end || end === 'present' ? '9999-12' : end);

/**
 * For each row (station, newest first), where each line's track runs. A line is "active" in a row when that row's
 * start month falls inside the line's overall span (so periods that overlap, such as school during co-ops, show
 * as parallel tracks), when the row is one of its stations, or when the row is an interchange with it. Gaps between
 * a line's first and last active rows are filled so each line is one continuous run.
 */
export function buildRail(stations: Station[]): Segment[][] {
  const active = new Map<Line, boolean[]>();
  for (const line of lines) {
    const own = stations.filter((s) => s.data.line === line);
    const dated = own.filter((s) => s.data.start);
    const from = dated.map((s) => s.data.start!).sort()[0];
    const to = dated.map((s) => monthKey(s.data.end)).sort().at(-1);
    const rows = stations.map(
      (s) =>
        s.data.line === line ||
        s.data.interchange === line ||
        Boolean(from && to && s.data.start && s.data.start >= from && s.data.start <= to),
    );
    const first = rows.indexOf(true);
    const last = rows.lastIndexOf(true);
    for (let i = first; i >= 0 && i <= last; i++) rows[i] = true;
    active.set(line, rows);
  }
  return stations.map((s, i) =>
    lines
      .map((line) => {
        const rows = active.get(line)!;
        if (!rows[i]) return null;
        return {
          line,
          top: Boolean(rows[i - 1]),
          bottom: Boolean(rows[i + 1]),
          station: s.data.line === line || s.data.interchange === line,
        };
      })
      .filter((seg): seg is Segment => seg !== null),
  );
}
