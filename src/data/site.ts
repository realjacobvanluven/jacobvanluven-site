export const site = {
  name: 'Jacob Van Luven',
  description:
    'Journalist and communicator who builds: translating between business and tech, and shipping tools with AI-assisted development.',
  email: 'vanluvenjacob@gmail.com',
  linkedin: 'https://www.linkedin.com/in/jacob-van-luven-5a6773203/',
  github: 'https://github.com/realjacobvanluven',
};

export type NavItem = { href: string; label: string };

/** Tools is appended at render time only once a non-draft tool exists. */
export const nav: NavItem[] = [
  { href: '/experience/', label: 'Experience' },
  { href: '/journalism/', label: 'Journalism' },
  { href: '/comms/', label: 'Comms' },
  { href: '/about/', label: 'About' },
  { href: '/contact/', label: 'Contact' },
];

export const toolsNavItem: NavItem = { href: '/tools/', label: 'Tools' };
