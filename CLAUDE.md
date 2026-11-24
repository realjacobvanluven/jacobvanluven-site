# Jacob Van Luven — Portfolio Site

Project brief for Claude Code. Read this before doing anything in this repo.

## What this is
A personal portfolio / resume-enhancer site for Jacob Van Luven, replacing an old Wix site
(https://jacobvanluven.wixsite.com/vanluvenjacob). Audience: prospective employers and recruiters.
Goal: a genuinely impressive, unique, interactive site that still lets a recruiter find the
substance in under 10 seconds, on desktop AND mobile.

## Positioning (what the site says about Jacob)
Jacob is happily employed at BCI and NOT job hunting. This is a standing showcase, not a "hire me" page:
confident, no begging calls-to-action.
His differentiator: **a journalist and communicator who builds.** He translates between business users and
development teams, turns complex technology into clear stories, and ships his own tools with AI-assisted
development. Every page should reinforce that blend of storytelling + business + building.
Headline (decided 2026-11-21): "I translate between business and tech — and build the tools to prove it." with the subheading "Clear stories. Working tools." Original options were:
- "I translate between business and tech — and build the tools to prove it."
- "Journalist by training. Builder by habit. Translator between business and tech."
- "Clear stories. Working tools."
In public copy say "AI-assisted development", not "vibe coding".

## Hard constraints
- **$0 total.** No paid hosting, no paid APIs, no custom domain. Never add anything that needs a credit card.
- **Hosting:** Cloudflare Pages, connected to this GitHub repo. Every push to `main` deploys.
  Live URL: https://jacobvanluven.pages.dev (Cloudflare Pages project `jacobvanluven`). `site` in `astro.config.mjs` must match.
- **Static-first.** Everything ships as static files. Tools must run client-side (in the browser).
  No secrets or API keys in the repo, ever.
- **Mobile is a first-class target**, not an afterthought. Test every feature at 375px wide.

## Stack
- **Astro** (static output) for pages and content.
- **Three.js** (plain, no React) for the cityscape hero, loaded as an Astro island so the rest of
  the site stays lightweight.
- Content as Markdown/MDX collections (stories, experience, tools) so Jacob can add entries without touching layout code.
- Keep dependencies minimal. Explain any new dependency before adding it.

## Design direction
- **Palette:** orange and black. Near-black backgrounds (#0a0a0a range), warm orange accent
  (sodium-streetlight / sunset orange, e.g. #ff7a1a range), off-white text. Orange is the accent, not the background.
- **Feel:** cinematic, night-time Vancouver. Confident, modern typography (not default system fonts; use free fonts via Fontsource).
- **Typography (decided 2026-11-21, pairing A):** Space Grotesk for headings, Inter for body text, JetBrains Mono for
  small labels and dates. All self-hosted via Fontsource variable packages (`@fontsource-variable/*`). Big Shoulders Display
  was tested and rejected; don't reintroduce other display faces without asking.
  Exception (chosen by Jacob 2026-11-21): the homepage name uses **Unbounded** 800 (`@fontsource-variable/unbounded`,
  imported only in `src/components/Hero.astro`).
- **Signature element:** an interactive, realistic Vancouver skyline (see below).

## The cityscape hero (signature feature)
A realistic, interactive 3D Vancouver skyline that also works as navigation.
- **Geometry from real data:** downtown peninsula building footprints + heights from the City of Vancouver
  Open Data Portal (building footprints datasets), patched with OpenStreetMap for towers built after the
  dataset date. Preprocess with a script in `/scripts` into a compact, simplified mesh/JSON checked into
  `/public/data`; do not fetch raw open data at runtime. Include the required attribution in the footer
  (Open Government Licence – Vancouver; © OpenStreetMap contributors, ODbL).
- **The shot:** an urban view looking north across **False Creek** from the south shore (around Olympic Village).
  False Creek water in the foreground with reflections, the downtown skyline in the middle, North Shore mountains
  (Grouse / Crown / the Lions area) silhouetted behind. Iconic landmarks clearly readable:
  **BC Place** (roof can glow orange at night), **Harbour Centre** (tower with its lookout "saucer" top),
  **Science World** (geodesic dome, on the right near the water), Rogers Arena, and the Cambie Bridge.
  Footprint data won't capture domes/roofs/the saucer, so hand-model these landmarks as simple, recognizable
  low-poly meshes positioned with real coordinates.
- **Camera and framing (decided 2026-11-21):** above the Olympic Village seawall at the water's edge
  (49.27175, −123.1078), **100 m up** (raised from 40 m so the downtown core and signature towers show over
  Yaletown), looking slightly down across False Creek. Normal lens framed on downtown
  (BC Place and Harbour Centre); the camera turns toward Science World (far right, ~60° east of north) with the
  cursor, scroll or phone tilt. Keep the full captured area in the data, but at render time draw only what's in view
  and use simpler detail for distant buildings.
- **Data notes:** the City's 2015 footprints have no heights; heights and stepped podium/tower parts come from the
  2009 dataset, with OSM for newer towers (`scripts/build-skyline-data.mjs`, `npm run data:skyline`).
  The City's 2022 LiDAR (for accurate current heights) is LAS zipped in 1 km tiles; its download server blocks
  scripted requests (bot challenge, HTTP 403), so it needs tiles downloaded by hand in a browser (18 tiles cover the
  scene). Not done yet. Signature towers are hand-modelled in `src/hero/signatures.js` (positions from OSM).
- **Look (decided 2026-11-21): realistic, not stylized.** The scene must look like a real photograph of Vancouver, not
  orange-and-black blocks. Orange and black are the site's theme, carried by lighting and UI, never by painting
  buildings orange.
  - *Time:* blue hour, about 20 minutes after sunset. The sky runs from deep navy overhead to a warm orange glow low
    on the western (left) horizon behind the mountains.
  - *Buildings:* varied facades, dark reflective glass curtain walls and lighter concrete. Lit windows are generated
    per floor: mostly warm, some cool white, roughly 30–50% lit, randomized. Red aviation lights blink on the
    tallest towers.
  - *Water:* reflective False Creek with gentle ripples, mirroring city lights. Warm streetlight glow along the seawall.
  - *Mountains:* North Shore from real elevation data (CDEM) if light enough, otherwise layered silhouettes, with
    snow-dusted peaks and atmospheric haze.
  - *Landmarks:* hand-built BC Place (roof with an orange LED ring), Science World geodesic dome, Harbour Centre with
    its lookout. Harbour Centre gets a subtle beacon so its hotspot is findable.
  - *Finish:* soft bloom on lights, distance fog, very subtle film grain.
- **Alive:** windows flicker on/off; lights brighten near the cursor (or touch point); optional subtle rain.
  Blue hour is the only look in v1. Time-of-day changes (night, dawn, following the visitor's clock) are a possible
  later extra, not v1.
- **Navigation:** landmarks are hotspots for site sections. Starting mapping (adjust if something reads better):
  Science World → Tools (the lab), BC Place → Experience, Harbour Centre → About & Contact (the lookout),
  a prominent downtown tower → Journalism, another → Comms work.
  *Built (2026-11-21):* BC Place → /experience/, tallest downtown tower in frame → /journalism/, Harbour Centre →
  /about/, Science World → /comms/ until the first tool is published, then /tools/ (automatic).
- **Implementation (2026-11-21):** `src/components/Hero.astro` (poster `<picture>` + hotspot links + headline) loads
  `src/hero/` lazily: on first scroll/pointer/touch/key or ~4 s after load, so the 3D work stays out of the loading
  window (Lighthouse mobile 99). Posters in `src/assets/hero/` are rendered with `scripts/skyline-lookdev.html`
  (`&w=…&h=…&dpr=…`); re-render them whenever the scene's look changes.
  Hover/tap highlights + labels; click flies the camera in, then routes.
- **Pan (2026-11-21):** drag (desktop), sideways swipe (touch), horizontal trackpad scroll or arrow keys turn the view
  along the waterfront, from the Cambie Bridge to Science World; (left limit widened to 205° on 2026-11-23 so the Olympic Village waterfront comes into view;) limits keep the frame inside the city data.
- **SkyTrain (2026-11-21):** the Expo Line from the east edge through Main Street–Science World to the Dunsmuir tunnel
  portal past Stadium–Chinatown (`src/hero/skytrain.js`, centreline from OSM in the data file): elevated guideway,
  both stations, trains both ways that stop at each station. Heights approximate (deck ~9 m).
- **Rogers Arena and the viaducts (2026-11-22):** `rogersArena()` in `src/hero/landmarks.js` is hand-built: a smooth
  rounded outline (superellipse) of the same area, position and orientation as the mapped footprint (the OSM
  polygon is angular, so it only sets those); dark podium, curtain-glass concourse glazed on some stretches only,
  metal cladding and a low dome roof in the same metal, two small red signs (south side and the side facing BC
  Place). The stepped footprint parts inside it are removed in `skyline-data.js`. Scenery only, no hotspot.
  `src/hero/viaduct.js` draws the Georgia and Dunsmuir Viaducts **as they stood before demolition (2022–25)**:
  elevated decks on piers (~10 m crown, approximate), lamps, one-way traffic; centrelines from OSM, chained by
  `scripts/build-skyline-data.mjs` into `viaducts` in the data file (and kept out of the ground `roads`).
- **Seaplanes (2026-11-22):** `src/hero/seaplanes.js`: Harbour Air-style floatplanes (low-poly, blue stripe, no logo, nav lights
  and strobe) to and from Coal Harbour, one at a time, every ~45-90 s, alternating arrivals (from the east over the inlet) and
  departures (climbing out north-west). The harbour is hidden behind the towers, so planes drop out of sight behind the skyline
  as they land. Hand-placed approximate paths, jittered per flight. Scenery only, no hotspot. `&plane=arrival:0.4` in the lookdev
  page freezes one for a still.
- **Bridges (2026-11-22):** `src/hero/bridge.js` builds the **Cambie, Granville Street and Burrard Street Bridges** from their
  OSM axes (`bridges` in the data file; `scripts/build-skyline-data.mjs`). Each ramps down to street level at both ends and
  carries lamps and per-lane traffic. Burrard has arched steel trusses between stepped Art Deco pylons; Granville has steel
  plate girders on X-braced concrete portal piers, outboard sidewalks, and its raised south approach plus off-/on-ramps
  (`ramps` in the data, chained from OSM ways). Structure and heights are approximate. The building crop now reaches 252°
  (the pan limit) so the west bank around the bridges has buildings. Scenery only, no hotspots.
- **South bank and Granville Island (2026-11-22):** the data now keeps the whole south bank of False Creek (land connected to
  the south edge of the water mask, west of the creek head, found by flood fill in `scripts/build-skyline-data.mjs`; download box
  runs ~900 m south of the camera) with ground elevation added to building heights so the Fairview slopes rise. Pan now reaches
  250° (Granville Island) and tilt down to −30°. `src/hero/granville.js` hand-builds Granville Island (federal land, so OSM only):
  painted industrial sheds with lit shopfronts, market halls with a glazed clerestory, and the eight Ocean Concrete silos, all
  from OSM footprints (own `granville` section of the data file; colours and shapes approximate). `src/hero/southbank.js` adds
  seawall railings and benches, parked cars and street trees along local streets, and walkers and cyclists (cyclists carry a
  front light) on the paths, all sized per device (`SCENE_DETAIL.southBank` in `scene.js`). Scenery only, no hotspots.
  Second pass (2026-11-22): FXAA pass in `post.js` (high and medium tiers; the scene had no anti-aliasing before); paths,
  streets and the seawall deck are drawn as mitered ribbons (`src/hero/ribbon.js`) so they stay continuous through bends, are
  clipped where they would cross water, and the deck slopes down to the ground; open-water sailboats and cruisers plus up to
  four Aquabus-style ferries (`openBoats`, `ferries` in `SCENE_DETAIL`); Granville Island re-lit with muted weathered colours,
  facing-dependent light, stepped multi-bay roofs on the market halls and mostly pale-concrete silos.
  Third pass (2026-11-22): Habitat Island (the small island beside Hinge Park, near the camera) is a natural island, not part of the
  seawall: `src/hero/islands.js` gives closed coastline rings a rocky rim and planted interior, and bridges the gap to the shore
  with a rock-and-paver causeway (found by the data build: `causeways` in the data file); islands are skipped by the seawall,
  railings and people. Trees are shaded round canopies with a leafy edge (camera-facing, `createTrees` in `waterfront.js`) instead
  of faceted meshes. The data build removes duplicate parallel path segments (`DEDUPE_M`).
  Fourth pass (2026-11-22): the south bank now has real terrain (`src/hero/terrain.js`, `southTerrain` in the data file: ground height
  above the 3 m seawall level, feathered at its edges, flat on the north bank, water and Granville Island); streets, paths, lawns,
  lamps, trees, parked cars and people follow it through `heightAt`. Trees come in five kinds (round broadleaf, layered conifer, tall
  columnar, broad spreading, small ornamental) with per-tree tints (some autumn gold and copper), and parks get scattered trees.
  Fifth pass (2026-11-22, the foreground): the data build removes dead-end path stubs; open ground, lawns and paths use smooth noise
  textures (`groundGlsl` in `shaders.js`) instead of square patches, with kerbs, slab joints and wear on paths; paths ride the seawall
  deck and its slope exactly (`deckHeight` in `seawall.js`, `createShoreDistance` in `ribbon.js`); path and seawall lamps stand on posts.
  Sixth pass (2026-11-22): map outlines are angular, so `src/hero/smooth.js` (`roundCorners`) rounds the corners of the shoreline,
  streets and paths when the data is decoded (loops become circles, shoreline stair-steps soften); path ribbons are clipped to land in
  short pieces so none runs into the water; local dead-end streets end in rounded turnarounds with a kerb and planted island
  (`createTurnarounds` in `streets.js`); the seawall slope is 5 m wide (`EMBANKMENT`); the Habitat Island causeway is the shortest
  gap to the shore, with connector paths added by the data build so the park paths lead onto it.
  Seventh pass (2026-11-22): the seawall promenade sits 0.45 m above the water (`TOP` in `seawall.js`, was 1.6) so paths meet it flush
  instead of climbing a step; the Habitat Island causeway follows the mapped footpath over the water (the data build finds it by
  labelling land components) with tapered ends; dead-end paths fade out instead of stopping square; bike paths get painted edge lines
  and wider bends; streets get a kerb and sidewalk layer (`sidewalk` in `streets.js`); street ways that meet at a plain corner are
  chained (`chainRoads` in `skyline-data.js`) so a 90° corner becomes one rounded curve; the promenade has paving texture and a kerb stone.
  Eighth pass (2026-11-22): no traffic or parked cars on closed street loops or stubs under 70 m, and parked cars stay out of
  junctions and the street ends (`nearOtherStreet` in `southbank.js`); open-water boats within 45 m of a bridge axis are dropped;
  car bodies are rounded boxes with a tapered cabin; square-cell noise (the blocky mosaic in paving, rock, asphalt and sidewalks) is
  replaced by smooth noise and cellular stones (`gfbm`, `worley` in `shaders.js`); Granville Island sheds get roof overhangs and
  rooftop vents.
  Ninth pass (2026-11-22, layering): the post-processing render target now has a 24-bit depth texture (the default is 16-bit, which
  cannot separate ground layers a few centimetres apart at a few hundred metres) and the camera's near plane scales with its height
  (10 m at 100 m); the ground decals have one fixed depth-offset order, bottom to top: terrain -1, lawns -3, sidewalks -4, streets -5,
  paths -6, turnarounds -7; lawns are split into ≤10 m triangles that follow the terrain; tiny closed street loops in the map (turning
  circles and traffic islands, under 90 m) are drawn as one round turnaround, not as street ribbons (`loopBulbs` in `streets.js`).
  Olympic Village (2026-11-23): `src/hero/village.js` builds the mapped buildings in `VILLAGE_BOX` (Millennium Water and the blocks
  south of it; deduplicated, taken out of the generic prism pass and the south-shore cull in `scene.js`) as detailed mid-rise
  buildings: five cladding styles (brick, metal panel with coloured accent bays, timber, glass curtain wall, concrete with
  spandrel stripes) with floor-to-ceiling windows fitted to each wall and interior-mapped lit rooms (`roomInteriorGlsl`, shared
  from `buildings.js`), rounded corners, stepped top floors with a glazed terrace, parapets, penthouses, green roofs, solar rows,
  mono-pitch metal roofs on small buildings, stacked balconies (slab plus glass or coloured railing) and shopfront canopies with
  warm lights. Sizes per device in `SCENE_DETAIL.village`. Generated in the spirit of the neighbourhood, not a copy of any one
  building. It is behind and beside the default camera, so it shows when the view pans toward Granville Island or Science World
  and tilts down. Hero download is ~605 KB gzipped.
  Still approximate: Sea Village houseboats and the ferry docks are not hand-modelled; large unmapped patches of the south bank
  (parks/lots with no OSM buildings) are plain dark ground. Hero download is ~594 KB gzipped (budget 700).
- **Name (2026-11-21):** the hero leads with "Jacob Van Luven" as the h1: Unbounded 800, uppercase, an orange
  stacked-shadow extrusion that follows the cursor, plus a slow highlight sweep. A one-line summary sits under it
  (`summary` prop in `src/pages/index.astro`), then the headline and subheading.
- **Scroll (decided 2026-11-21):** one scroll is enough. The first scroll (or Tab / "Skip to work") swaps the headline
  for all four section cards at once; hovering or focusing a card turns the camera to its landmark. No multi-screen tour.
- **Mobile:** device-tilt parallax (with the iOS permission prompt handled gracefully), tap hotspots,
  reduced geometry and capped devicePixelRatio. Must stay smooth on a mid-range phone.
- **Always escapable:** a visible plain nav and a "skip to work" link. `prefers-reduced-motion` → static
  rendered still image. No-JS / WebGL failure → same still image + normal nav.
- **Performance budget:** show a poster image instantly, fade the canvas in when ready. Aim for the hero's
  JS + data under ~700 KB gzipped. Lighthouse performance ≥ 85 on mobile for the homepage.

## Site structure (proposed)
- `/` — cityscape hero, short intro, highlights.
- `/experience` — timeline (see below).
- `/journalism` — written stories, audio/podcasts, videos, data visualizations.
- `/comms` — EPS work: Preparedness Series, short videos, social media designs.
- `/tools` and `/tools/<slug>` — interactive tools Jacob builds later. Scaffold the section and a
  template now; hide from nav until the first tool exists.
- `/about` — bio, interests (fitness, sports, food), resume PDF download.
- `/contact` — email (mailto: vanluvenjacob@gmail.com) + LinkedIn. No form backend.

## About Jacob (source of truth for copy)
- Journalism and Communications, Kwantlen Polytechnic University (Surrey, B.C.); Certificate in Journalism, Langara College.
- Email: vanluvenjacob@gmail.com
- LinkedIn: https://www.linkedin.com/in/jacob-van-luven-5a6773203/
- GitHub: https://github.com/realjacobvanluven (repo: `jacobvanluven-site`, public)
- Experience:
  - **BCI (British Columbia Investment Management Corp.)**, Vancouver — Client Success Specialist (contract, full-time), Dec 2025–present.
  - **BCI** — Technology Governance and Business Continuity Planning Intern, Sep 2025–Dec 2025.
  - **BCI**, Victoria — Technology Research and Communications Co-op, Jan 2025–Apr 2025. Technology research,
    SME interviews, technical white papers, award nominations, intranet articles.
  - **BCI**, Victoria — Internal Stakeholder Engagement Co-op, Sep 2024–Dec 2024. Internal comms strategy,
    news articles, intranet content and management.
  - **Emergency Planning Secretariat**, Abbotsford (hybrid) — Communications Intern, Jun 2024–Aug 2024.
    Supports 31 Mainland Coast Salish communities. Weekly social campaigns, info packets, written web series
    (Preparedness Series: forest fires, extreme heat, drought, evacuations), short-form videos, website content/SEO.
- BCI work is confidential: describe roles and skills, never invent or show deliverables.
- Do not invent facts, metrics, quotes or testimonials. If copy needs something we don't have, leave a clearly marked TODO
  using `src/components/Todo.astro`, which renders only in `npm run dev`. Production builds never show TODO boxes;
  anything still missing is simply left out (e.g. the resume download stays hidden until Jacob provides a PDF).

## Content approach (decided 2026-11-21; supersedes "keep ALL of it" below)
The Wix migration is done (text copied verbatim, 2026-11-21). The site is now **curated, not an archive**:
- **/journalism** is an overview of the *types* of work (deadline news, features, audio, video, data visualization,
  social). Each type has a one-line description and **at most two featured examples**, configured in
  `src/data/journalism.ts` (story ids). Only featured pieces stay in `src/content/stories/`.
- **/comms** leads with the EPS social campaigns as swipeable carousels (touch on mobile, arrows + keyboard on desktop),
  configured in `src/data/eps-campaigns.ts`; then the Short Videos link (72-hour-kit thumbnail as its poster) and the
  Preparedness Series.
- **Everything else is archived, never deleted**, in `content-archive/` (unpublished stories, the old Wix
  Home/About/Contact text, the old Wix media checklist). To publish an archived piece, move it back into
  `src/content/stories/` and feature it.
- **Media: only what Jacob curates into `/assets-inbox`** (see its README). Don't pull media from Wix or elsewhere.
  Images are copied to `src/assets/` and always rendered through Astro's image pipeline (`<Image>` / `getImage`, WebP,
  responsive widths); originals must not ship. Video and audio are pre-compressed and go in `public/media/` as-is.
- **Credit honestly.** When Jacob made the promo for someone else's story, name the reporter shown on the piece and
  state his role, e.g. "Story by reporter Suneet Gill · Social video promo by Jacob Van Luven" (`credit` field).
- **"Just for fun"** (on /about): personal side projects, framed as made for fun (e.g. Fight Night cards designed while
  playing an MMA simulator game). Images go in `src/assets/side-projects/<project>/`; the block hides when empty.
- EPS role is "Communications Intern" everywhere (Wix said "Communications Student").

## Content migrated from Wix (historical; see Content approach above)
- Home: https://jacobvanluven.wixsite.com/vanluvenjacob
- JRNL 3180 Final Story: /jrnl-3180-final-story
- Recent Work (BCI + EPS + JRNL 4900 deadline stories): /recent-work
- EPS: /eps
- Social Media Content: /social-media-content
- Audio Stories/Podcasts: /shoplifting-surge
- Videos: /videos
- Data Visualizations: /data-visualizations (Metro Vancouver commute distances, Oct 2022)
- About Me: /about-me
- Contact: /contact
- External stories: Medium (@jacobvanluven) — homeless-giving story (Feb 2021), Whistler snowboarder (Jan 2021);
  LangaraVoice — Vancouver urban coyotes (Dec 2020).
Text was pulled from the live pages. Images, audio and video come only from Jacob's curated files in `/assets-inbox`
(not committed if large). Long videos go on YouTube (unlisted is fine) and are embedded lazily.

## Quality bar
- Accessible: semantic HTML, keyboard navigable (including hotspots), visible focus, alt text, colour contrast AA.
- SEO basics: titles, meta descriptions, Open Graph image (a still of the skyline), sitemap.
- Run `npm run build` with no errors before every commit. Small, descriptive commits.
- When unsure about a design or content choice, ask Jacob rather than guessing.
