import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

/** Month precision, e.g. "2025-12". Avoids inventing exact days we don't have. */
const yearMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');

/**
 * Roles for the /experience timeline. One file per role.
 * BCI work is confidential: describe the role and skills, never deliverables.
 */
const experience = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/experience' }),
  schema: z.object({
    org: z.string(),
    orgShort: z.string().optional(),
    role: z.string(),
    location: z.string().optional(),
    workMode: z.enum(['on-site', 'hybrid', 'remote']).optional(),
    employment: z.enum(['full-time', 'contract', 'co-op', 'internship']),
    start: yearMonth,
    /** Omit for a current role. */
    end: yearMonth.optional(),
    summary: z.string().optional(),
    skills: z.array(z.string()).default([]),
  }),
});

/**
 * Everything Jacob has published or produced: journalism and EPS comms work alike.
 * `section` decides which page lists it; `format` drives how it is presented.
 */
const stories = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/stories' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      /** Omit when the original gives no date (don't invent one); add a TODO comment instead. */
      date: z.coerce.date().optional(),
      /** How much of `date` is real: "May, 2023" is stored as 2023-05-01 with precision "month". */
      datePrecision: z.enum(['day', 'month', 'year']).default('day'),
      section: z.enum(['journalism', 'comms']),
      format: z.enum(['written', 'audio', 'video', 'dataviz', 'social', 'photo', 'project']),
      /** Optional: only where the original has a standfirst/summary. Never invented. */
      description: z.string().optional(),
      /** Groups multi-part projects, e.g. "Tricky Transit". */
      series: z.string().optional(),
      outlet: z.string().optional(),
      /** Where the piece lives if it is hosted elsewhere (Medium, LangaraVoice, Substack, ...). */
      externalUrl: z.url().optional(),
      /** Original Wix page path, kept for provenance during migration. */
      wixPage: z.string().optional(),
      /**
       * Other wordings of the same piece found elsewhere on the Wix site, kept verbatim so nothing is lost.
       * Not rendered. Jacob decides which version to keep.
       */
      alternateText: z.array(z.object({ source: z.string(), text: z.string() })).default([]),
      /** Who did what, when Jacob's role was part of a piece (e.g. "Story by X · Promo by Jacob Van Luven"). */
      credit: z.string().optional(),
      /**
       * Media shown with the piece. Images live in src/assets (optimized by Astro); video and audio are
       * already compressed and live in public/media (reference them as "/media/...").
       */
      media: z
        .array(
          z.discriminatedUnion('type', [
            z.object({ type: z.literal('image'), src: image(), alt: z.string() }),
            z.object({
              type: z.literal('video'),
              src: z.string().startsWith('/media/'),
              /** Accessible description of what the video shows. */
              label: z.string(),
              /** CSS aspect-ratio, e.g. "9 / 16" for vertical reels. */
              aspect: z.string().default('9 / 16'),
            }),
            z.object({ type: z.literal('audio'), src: z.string().startsWith('/media/'), label: z.string() }),
          ]),
        )
        .default([]),
      /** YouTube video ID for lazily embedded videos. */
      youtubeId: z.string().optional(),
      image: image().optional(),
      imageAlt: z.string().optional(),
      tags: z.array(z.string()).default([]),
      draft: z.boolean().default(false),
    })
    .refine((d) => !d.image || d.imageAlt, { message: 'imageAlt is required when image is set', path: ['imageAlt'] }),
});

/** Interactive client-side tools at /tools/<slug>. Hidden from nav until one is not a draft. */
const tools = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/tools' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    status: z.enum(['planned', 'beta', 'live']).default('planned'),
    order: z.number().default(0),
    draft: z.boolean().default(true),
  }),
});

export const collections = { experience, stories, tools };
