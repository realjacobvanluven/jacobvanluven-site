import type { HazardId } from './types.ts';

/**
 * "What this means / what to do" cards. Every point comes from Jacob's own EPS campaigns (summer 2024, shown on /comms)
 * and is kept close to their wording. Nothing here is new safety advice. A hazard with no EPS campaign gets official links only.
 * TODO(Jacob): confirm EPS is fine with this content being reused beside live data.
 */
export interface Guidance {
  hazard: HazardId;
  heading: string;
  /** Short points, from the campaign. Empty when we have no campaign for this hazard. */
  points: string[];
  /** Id of the matching campaign on /comms (the heading there is `<id>-h`). */
  campaignId: string | null;
  /** Official pages to read for this hazard. */
  links: { label: string; url: string }[];
}

export const GUIDANCE: Guidance[] = [
  {
    hazard: 'evacuation',
    heading: 'Evacuation Alert or Order',
    points: [
      'Evacuation Alert: be prepared to leave on short notice.',
      'Evacuation Order: you are at risk and should leave immediately, following the route officials have given.',
      'Tactical Evacuation: police have found an immediate threat to safety in your area. Leave immediately.',
      'Evacuation Rescinded: the risk has passed and you can start planning your return.',
    ],
    campaignId: 'evacuation-terms',
    links: [{ label: 'EmergencyInfoBC', url: 'https://www.emergencyinfobc.gov.bc.ca/' }],
  },
  {
    hazard: 'wildfire',
    heading: 'Wildfire',
    points: ['If a fire is near you, check whether your area has an Evacuation Alert or Order, and know the terms above.'],
    campaignId: 'evacuation-terms',
    links: [{ label: 'BC Wildfire Service', url: 'https://wildfiresituation.nrs.gov.bc.ca' }],
  },
  {
    hazard: 'weather',
    heading: 'Weather alerts',
    points: [
      'Heat: heat stroke is a medical emergency. Call 9-1-1. For heat exhaustion, move somewhere cool and drink water.',
      'Flood: monitor local radio and television, and shut off electricity to at-risk areas. If you get an Evacuation Order, leave immediately and do not cross flooded roads.',
    ],
    campaignId: 'heat',
    links: [{ label: 'Environment Canada weather', url: 'https://weather.gc.ca/' }],
  },
  {
    hazard: 'air-quality',
    heading: 'Poor air quality',
    // No EPS campaign on this: official link only, nothing written by us.
    points: [],
    campaignId: null,
    links: [{ label: 'Environment Canada Air Quality Health Index', url: 'https://weather.gc.ca/airquality/pages/index_e.html' }],
  },
  {
    hazard: 'road',
    heading: 'Roads and winter driving',
    points: [
      'Before you go: tell others your route and arrival time, charge your phone, and check weather and road conditions, including DriveBC.',
      'Turn off cruise control on snow, ice or slush.',
    ],
    campaignId: 'winter-driving',
    links: [{ label: 'DriveBC', url: 'https://drivebc.ca/' }],
  },
];

/** Applies to any emergency. */
export const GENERAL_GUIDANCE = {
  heading: 'Be ready before it happens',
  points: [
    'A go-bag is a small kit that is easy to grab if you need to leave immediately.',
    'A 72-hour kit has enough supplies to keep each household member safe for up to three days.',
  ],
  campaignId: 'go-bag',
} as const;
