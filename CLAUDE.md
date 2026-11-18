# Jalur (jalur-maps)

Personal motorbike route chooser for Jabodetabek. Compares routes by road size
(gede/sedang/kecil), shows main streets, plus-minus and the junctions where riders take
the wrong branch, then opens the chosen route in Google Maps via 3 waypoints.
Static web app/PWA: no build step, no dependencies, no API keys.

The owner writes in casual Indonesian; reply the same way. They want a sparring partner:
challenge weak assumptions and say plainly when something is unverified.

## Layout
- `public/` is the whole app and is what gets deployed.
  - `lib/route-analysis.js`: pure logic (road groups, stats, plus-minus, junctions, waypoints,
    Google Maps URL). Tested.
  - `lib/api.js`: Valhalla (FOSSGIS public server, `motorcycle` costing) + Photon search.
  - `app.js` UI, `style.css` design tokens at the top, `sw.js` app-shell cache.
- `test/`: `npm test` (node:test) with real recorded Valhalla responses in `test/fixtures`.
- `scripts/serve.js`: `npm run dev` → http://localhost:5173.

## Shipping
- Push to `main` → `.github/workflows/pages.yml` runs tests and deploys `public/` to
  https://tendorethane-code.github.io/jalur-maps/ (Pages source must be "GitHub Actions").
- Bump `CACHE` in `public/sw.js` when changing shell files, or installed copies keep old files.
- After UI changes check phone widths (320–390px), dark mode, and desktop (≥900px panel).
  Playwright needs the agent proxy:
  `chromium.launch({ proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost' } })`.

## Gotchas
- CARTO basemaps now need an API key; use OSM tiles (dark mode = CSS filter on the tile pane).
- The bicycle-profile "small roads" candidate is re-checked with `/trace_route` as a motorcycle;
  a 400 there is expected and the candidate is dropped.
- "Hati-hati di sini" = `junctions()`: Valhalla maneuvers 9/16 (bear), 17–25 (ramp/exit/keep/merge),
  26 roundabout, 12/13 U-turn; flyover/underpass from `edge.bridge`/`edge.tunnel`. Plain turns left out.
- With a GPS start the Maps link omits `origin` so Google uses its live location.
- Search (`lib/search.js` + `searchPlaces`): expand "Jl./Gg./Jend." (Photon finds nothing for "Gg."),
  strip "No. 6"/RT/RW, rerank by distance from the GPS fix, dedupe street pieces. Nominatim
  ("Cari lebih teliti") only on tap: its policy forbids search-as-you-type.
- Android share target (manifest `share_target`): Google Maps → Bagikan → Jalur fills the destination.
- The Maps link sends the destination as coordinates, so Google labels it with the nearest shop
  (picked "Living World", Google showed "Sociolla Living World"). Same spot; a name string would be
  ambiguous ("Indomaret, Tangerang").

## Open questions (verify on a real phone and real routes)
- Verified on the owner's Android: the link opens Google Maps in "Motor" mode with "3 perhentian".
  Still unknown: does Google keep to our roads between the waypoints?
- Is the OSM road-size classification right on the owner's usual routes?
- Search is weaker than Google's: OSM lacks many POIs and house numbers. Owner's report: a full
  address with "No. 6" found nothing. Fixed what's fixable; the share target covers the rest.
- Is the junction list useful, too long, or missing forks?
- No traffic data: minutes are free-flow. Google Routes API / TomTom have traffic but need keys.
