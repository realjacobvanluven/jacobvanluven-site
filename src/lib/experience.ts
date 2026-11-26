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
