// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://jacobvanluven.pages.dev',
  output: 'static',
  integrations: [mdx(), sitemap()],
  // Inline the (small) CSS so it doesn't block first paint with an extra request.
  build: { inlineStylesheets: 'always' },
  vite: {
    // The 3D hero chunk (three.js, ~160 KB gzipped) is loaded lazily after the page has loaded;
    // don't warn about its size.
    build: { chunkSizeWarningLimit: 800 },
  },
});
