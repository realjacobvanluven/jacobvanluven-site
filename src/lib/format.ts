const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2025-12" → "Dec 2025" */
export function formatYearMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return `${months[m - 1]} ${y}`;
}

export function formatRange(start: string, end?: string): string {
  return `${formatYearMonth(start)} – ${end ? formatYearMonth(end) : 'Present'}`;
}

/** Date → "Feb 2021" (UTC, so frontmatter dates don't shift a day by timezone). */
export function formatDate(d: Date): string {
  return `${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Story dates honour their precision: "Feb 5, 2021" or "May 2023". */
export function formatStoryDate(d: Date, precision: 'day' | 'month' | 'year' = 'day'): string {
  if (precision === 'year') return String(d.getUTCFullYear());
  if (precision === 'month') return formatDate(d);
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}
