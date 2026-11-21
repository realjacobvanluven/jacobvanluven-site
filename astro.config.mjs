// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://jacobvanluven.pages.dev',
  output: 'static',
  integrations: [
    mdx(),
    // /type-test is a temporary font comparison page; keep it out of the sitemap.
    sitemap({ filter: (page) => !page.includes('/type-test') }),
  ],
});
