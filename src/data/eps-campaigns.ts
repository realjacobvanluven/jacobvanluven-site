import type { ImageMetadata } from 'astro';
import type { Slide } from '../components/Carousel.astro';

/**
 * EPS social campaigns (summer 2024), shown as swipeable carousels on /comms.
 * Slide images live in src/assets/eps/<campaign>/ (numbered in carousel order) and are optimized by Astro.
 * Animated slides are already-compressed MP4s in public/media/eps/<campaign>/.
 */
const images = import.meta.glob<{ default: ImageMetadata }>('../assets/eps/**/*.{png,jpg,webp}', { eager: true });

function img(path: string, alt: string): Slide {
  const mod = images[`../assets/eps/${path}`];
  if (!mod) throw new Error(`Missing EPS slide: src/assets/eps/${path}`);
  return { type: 'image', src: mod.default, alt };
}

const video = (path: string, alt: string): Slide => ({ type: 'video', src: `/media/eps/${path}`, alt });

export type Campaign = { id: string; title: string; description: string; slides: Slide[] };

export const campaigns: Campaign[] = [
  {
    id: 'evacuation-terms',
    title: 'Evacuation terms',
    description: 'What an Evacuation Alert, Order, Tactical Evacuation and Rescinded notice each mean, and what to do.',
    slides: [
      img('evacuation-terms/01.png', '“Did you know? Evacuation Terms” title slide over a photo of a smoky, burned forest, with a prompt to swipe.'),
      img('evacuation-terms/02.png', 'Evacuation Alert: be prepared to leave on short notice. Steps to prepare a home for wildfire, such as moving patio furniture indoors, filling containers with water and making the house number visible.'),
      img('evacuation-terms/03.png', 'Evacuation Order: you are at risk and should leave immediately. Close doors and windows, turn on interior and exterior lights, and follow the route officials have identified.'),
      img('evacuation-terms/04.png', 'Tactical Evacuation: the RCMP or local police have determined there is an immediate threat to safety in your area. Leave immediately.'),
      img('evacuation-terms/05.png', 'Evacuation Rescinded: the risk to safety has passed and you can gradually begin to plan your return home.'),
      img('evacuation-terms/06.png', 'For more information, visit www.gov.bc.ca, with a link to the province’s evacuee guidance.'),
    ],
  },
  {
    id: 'winter-driving',
    title: 'Winter driving',
    description: 'Tips for unpredictable B.C. winter roads, including two short animated slides.',
    slides: [
      img('winter-driving/01.png', 'Preparing for winter driving: B.C. winters are unpredictable and simple commutes can become dangerous. Photo of a snow-covered road.'),
      img('winter-driving/02.png', 'Winter driving tips before you start your car: tell others your route and arrival time, charge your phone, and clear snow from windows, lights, mirrors, plates, hood and roof.'),
      video('winter-driving/03.mp4', 'Animated slide: check weather and road conditions with Environment Canada, local radio traffic reports, TransLink service updates and DriveBC.'),
      video('winter-driving/04.mp4', 'Animated slide of a car driving through snow: turn off cruise control, because on snow, ice or slush it keeps power on spinning wheels.'),
    ],
  },
  {
    id: 'heat',
    title: 'Heat illness',
    description: 'Telling heat exhaustion from heat stroke, with illustrated symptoms and first aid.',
    slides: [
      img('heat/01-heat-illness-intro.png', 'Heat stroke and heat exhaustion both raise body temperature. Heat stroke is the more severe, with confusion, very high temperature and hot, red skin; heat exhaustion still needs to be taken seriously.'),
      img('heat/02-heat-exhaustion.png', 'Illustrated heat exhaustion symptoms, such as high body temperature, muscle cramps, dizziness and heavy sweating, with advice to move somewhere cool and drink water.'),
      img('heat/03-heat-stroke.png', 'Illustrated heat stroke symptoms and how to cool the person while waiting for help. Heat stroke is a medical emergency: call 9-1-1.'),
    ],
  },
  {
    id: 'flood-evacuation',
    title: 'Flood evacuation',
    description: 'Flood evacuee guidance for an approaching flood, an Evacuation Alert and an Evacuation Order.',
    slides: [
      img('flood-evacuation/01.png', 'Flood evacuee guidance: monitor local radio and television for updates, shut off electricity to at-risk areas and move electronics upstairs.'),
      img('flood-evacuation/02.png', 'If you receive an Evacuation Alert: park vehicles away from streams, remove pesticides from the flood area, sandbag floor drains and toilets, and don’t shut off electricity if water is present.'),
      img('flood-evacuation/03.png', 'If you receive an Evacuation Order, leave immediately: don’t cross rivers or flooded roads, and if your vehicle begins to flood, abandon it and head to higher ground.'),
    ],
  },
  {
    id: 'drought-water',
    title: 'Drought and water saving',
    description: 'What drought means for B.C., plus indoor and outdoor ways to save water.',
    slides: [
      img('drought-water/01-what-is-drought.png', 'What is drought? A prolonged period with a severe lack of precipitation. Around 80% of B.C. regions experienced drought in summer 2023.'),
      img('drought-water/02-water-saving-indoor.png', 'Indoor water-saving tips, such as shorter showers, turning off the tap while brushing, fixing leaky toilets and running full laundry loads, with litres saved for each.'),
      img('drought-water/03-water-saving-outdoor.png', 'Outdoor water-saving tips, such as following local restrictions, watering the lawn once a week, collecting rainwater and planting drought-tolerant gardens.'),
    ],
  },
  {
    id: 'go-bag',
    title: 'Go-bags and 72-hour kits',
    description: 'Checklists for a grab-and-go bag and a 72-hour household kit.',
    slides: [
      img('go-bag/01-go-grab-bag.png', 'Go/grab bag: a small kit that is easy to grab if you need to evacuate immediately, with a checklist including water, food, a radio, flashlight, first-aid kit and important documents.'),
      img('go-bag/02-72-hour-kit.png', '72-hour kit: enough supplies to keep each household member safe for up to three days, with a checklist including non-perishable food, four litres of water per person per day and medications.'),
    ],
  },
  {
    id: 'memes',
    title: 'Memes',
    description: 'Audience-aware meme posts used in the same campaigns to put preparedness in front of a social feed.',
    slides: [
      img('memes/01-go-bag.png', 'Meme of a man laughing hard, captioned “And then they said: you’ll never need a go-bag.”'),
      img('memes/02-emergency-plan.png', 'Meme of a man lowering his sunglasses in surprise, captioned “When you realize your household doesn’t have an emergency plan.”'),
      img('memes/03-rain-in-summer.png', 'Two-panel reaction meme: rejecting “when it rains in the fall/winter” and approving “when it rains in the summer.”'),
    ],
  },
];

/** Poster for the "How to make a 72-hour kit" short video. */
export const shortVideoPoster = images['../assets/eps/go-bag/03-72-hour-kit-video-thumbnail.webp'].default;
