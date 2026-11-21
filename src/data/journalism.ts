/**
 * /journalism is an overview of the kinds of work Jacob did, not an archive.
 * Each type gets a one-line description and at most two featured story entries (by id = file name in
 * src/content/stories). Everything else lives in content-archive/, unpublished.
 */
export type WorkType = { id: string; label: string; description: string; featured: string[] };

export const workTypes: WorkType[] = [
  {
    id: 'deadline-news',
    label: 'Deadline news',
    description: 'Crime and court stories written for JRNL 4900 under a three-hour deadline.',
    featured: ['arrest-stabbing-death-japanese-chef', 'trial-delayed-abbotsford-couple'],
  },
  {
    id: 'features',
    label: 'Features',
    description: 'Longer-form stories that dig into a trend or a person.',
    featured: ['run-clubs-vancouver', 'homeless-giving'],
  },
  {
    id: 'audio',
    label: 'Audio',
    description: 'Narrated audio features.',
    featured: ['concussions-in-hockey'],
  },
  {
    id: 'video',
    label: 'Video',
    description: 'Vertical video stories built for Instagram and other social feeds.',
    featured: ['fire-festival-promo', 'lockdown-music-promo'],
  },
  {
    id: 'data-visualization',
    label: 'Data visualization',
    description: 'Turning research and data into graphics people can read at a glance.',
    featured: ['cat-rescue-infographic'],
  },
  {
    id: 'social',
    label: 'Social',
    description: 'Promo graphics that move readers from a social feed to the full story.',
    featured: ['steveston-motor-company-promo', 'boston-qualifier-promo'],
  },
];
