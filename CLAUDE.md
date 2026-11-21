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
Headline options (let Jacob pick; don't hard-code one without asking):
- "I translate between business and tech — and build the tools to prove it."
- "Journalist by training. Builder by habit. Translator between business and tech."
- "Clear stories. Working tools."
In public copy say "AI-assisted development", not "vibe coding".

## Hard constraints
- **$0 total.** No paid hosting, no paid APIs, no custom domain. Never add anything that needs a credit card.
- **Hosting:** Cloudflare Pages, connected to this GitHub repo. Every push to `main` deploys.
  Target URL: `jacobvanluven.pages.dev` (or the closest available name).
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
- **Terrain:** mountains as layered silhouettes, or from free Canadian elevation data (CDEM) if it stays light.
- **Colour:** buildings near-black; windows glow warm orange; dusk sky gradient into black.
- **Alive:** windows flicker on/off; lights brighten near the cursor (or touch point); sky/lighting follows
  the visitor's local time (dusk / night / dawn); optional subtle rain.
- **Navigation:** landmarks are hotspots for site sections. Starting mapping (adjust if something reads better):
  Science World → Tools (the lab), BC Place → Experience, Harbour Centre → About & Contact (the lookout),
  a prominent downtown tower → Journalism, another → Comms work.
  Hover/tap highlights + labels; click flies the camera in, then routes.
- **Scroll:** scrolling moves the camera through/along the city into the content.
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
- Do not invent facts, metrics, quotes or testimonials. If copy needs something we don't have, leave a clearly marked TODO.

## Content to migrate from Wix (keep ALL of it for now; Jacob will trim later)
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
Text can be pulled from the live pages. Images, audio and video come from Jacob's original files in `/assets-inbox`
(not committed if large). Long videos go on YouTube (unlisted is fine) and are embedded lazily.

## Quality bar
- Accessible: semantic HTML, keyboard navigable (including hotspots), visible focus, alt text, colour contrast AA.
- SEO basics: titles, meta descriptions, Open Graph image (a still of the skyline), sitemap.
- Run `npm run build` with no errors before every commit. Small, descriptive commits.
- When unsure about a design or content choice, ask Jacob rather than guessing.
