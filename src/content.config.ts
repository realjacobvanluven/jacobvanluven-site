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
      date: z.coerce.date(),
      section: z.enum(['journalism', 'comms']),
      format: z.enum(['written', 'audio', 'video', 'dataviz', 'social']),
      description: z.string(),
      outlet: z.string().optional(),
      /** Where the piece lives if it is hosted elsewhere (Medium, LangaraVoice, ...). */
      externalUrl: z.url().optional(),
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
