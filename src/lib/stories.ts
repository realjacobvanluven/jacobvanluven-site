import { getCollection, type CollectionEntry } from 'astro:content';

export type Story = CollectionEntry<'stories'>;

/** True when the story has its own text on this site (otherwise it only links out). */
export const hasBody = (s: Story) => Boolean(s.body?.trim());

export const storyHref = (s: Story) => (hasBody(s) ? `/${s.data.section}/${s.id}/` : s.data.externalUrl);

/** Published stories for a section: newest first, undated last. */
export async function getStories(section: Story['data']['section']) {
  const stories = await getCollection('stories', (s) => !s.data.draft && s.data.section === section);
  return stories.sort((a, b) => (b.data.date?.valueOf() ?? -Infinity) - (a.data.date?.valueOf() ?? -Infinity));
}
