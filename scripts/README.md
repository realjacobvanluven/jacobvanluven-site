# scripts

Build-time preprocessing scripts (run locally, never at runtime).

Planned: the cityscape data pipeline: City of Vancouver building footprints + OpenStreetMap patches
→ simplified mesh/JSON written to `/public/data`.

## Stills
`skyline-lookdev.html` renders the scene as a still; `capture-skyline.mjs` drives headless Chrome to save them
(`python3 -m http.server 8123` in the repo root, then
`node scripts/capture-skyline.mjs <outDir> <name> "<query>" …`; `STATS=1` prints scene stats). Lookdev query options include
`bearing`, `pitch`, `fov`, `height`, and `cx`/`cy` (move the camera, in metres from the seawall, for close-ups elsewhere).
Posters: `preset=desktop&w=1440&h=810&dpr=2` and `preset=phone&w=390&h=844&dpr=2&tier=high`, converted to JPEG.

## BC Preparedness Board data
`src/lib/preparedness/` is the data layer for the preparedness board tool (workplan in the project docs): one fetcher and
normalizer per source (BC Wildfire, Evacuation Orders and Alerts, Environment Canada weather alerts and air quality, DriveBC
incidents), a loader that tries live data first and falls back to a saved snapshot, and the snapshot builder. It runs in the
browser and in Node, so it uses erasable TypeScript only.
- `npm run data:preparedness` runs `build-preparedness-snapshot.mjs`, which writes `public/data/preparedness-snapshot.json`.
  The scheduled workflow `.github/workflows/preparedness-snapshot.yml` does the same every six hours and commits when the data changed.
- `npm test` runs the tests in `scripts/test/` (fixtures match the live services' shapes; no network needed).
- Credit lines required by the licences are in `src/lib/preparedness/constants.ts` (`CREDITS`); the footer must show them.
