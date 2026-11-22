import { getCollection } from 'astro:content';

/**
 * The homepage scroll tour: one stop per landmark, in camera order (left to right across the skyline).
 * `id` matches a hotspot anchor in src/hero/scene.js. Descriptions use the site's own wording; keep them
 * factual. Science World is "the lab" (Tools) once a tool is published; until then it leads to Comms.
 */
export type HeroStop = { id: string; place: string; label: string; href: string; description: string };

export async function heroStops(): Promise<HeroStop[]> {
  const hasTools = (await getCollection('tools', (t) => !t.data.draft)).length > 0;
  return [
    {
      id: 'tower',
      place: 'Downtown',
      label: 'Journalism',
      href: '/journalism/',
      description: 'Deadline news, features, audio, video, data visualization and social.',
    },
    {
      id: 'bcPlace',
      place: 'BC Place',
      label: 'Experience',
      href: '/experience/',
      description: 'Roles at BCI and the Emergency Planning Secretariat.',
    },
    {
      id: 'harbourCentre',
      place: 'Harbour Centre',
      label: 'About & contact',
      href: '/about/',
      description: 'Background, education, side projects, and how to get in touch.',
    },
    hasTools
      ? {
          id: 'scienceWorld',
          place: 'Science World',
          label: 'Tools',
          href: '/tools/',
          description: 'Interactive tools built with AI-assisted development.',
        }
      : {
          id: 'scienceWorld',
          place: 'Science World',
          label: 'Comms',
          href: '/comms/',
          description: 'Emergency-preparedness campaigns, short videos and the Preparedness Series.',
        },
  ];
}
