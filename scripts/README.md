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
