# Jalur (jalur-maps)

Personal route chooser for Jabodetabek, motorbike and car (Motor/Mobil switch). Compares routes by road size
(gede/sedang/kecil) and, for cars, toll vs no toll; shows main streets, plus-minus and the
junctions where riders take the wrong branch, then opens the chosen route in Google Maps via 3
waypoints. Walking was asked for and deliberately left out: road size, gangs, tolls and forks
don't matter on foot, and Google Maps already walks fine. Add it only if the owner really uses it.
Static web app/PWA: no build step, no dependencies. Google Maps + Places (New) with the owner's
browser key in `public/config.js`; OpenStreetMap fallback when Google fails.

The owner writes in casual Indonesian; reply the same way. They want a sparring partner:
challenge weak assumptions and say plainly when something is unverified.

## Layout
- `public/` is the whole app and is what gets deployed.
  - `lib/route-analysis.js`: pure logic (road groups, stats, plus-minus, junctions, waypoints,
    Google Maps URL). Tested.
  - `lib/api.js`: Valhalla (FOSSGIS public server, `motorcycle` costing) + Photon/Nominatim search.
  - `lib/map.js`: one map interface, two engines: Google (normal) and Leaflet/OSM (fallback,
    lazy-loaded). App code only talks to this interface.
  - `lib/google-places.js`: Google Places autocomplete + `location` lookup (session token).
  - `config.js`: Google browser key + Map ID. Public on purpose; restricted in Google Cloud to
    `https://tendorethane-code.github.io/*` + `http://localhost:5173/*` and to Maps JS + Places (New).
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

## Cek rilis (`/cek-rilis`)
The general protocol is `.claude/skills/cek-rilis/SKILL.md` (same file in every repo). This repo's part:
- Release = push to `main`. Back out = revert + redeploy (minutes), but installed PWAs keep the old
  shell until `CACHE` in `public/sw.js` is bumped.
- Risk is usually LOW: static site, one user, no server data. MEDIUM when a change touches `sw.js`,
  `config.js`/the Google key, trip/mode storage, or taps/long-press/sheet gestures.
- Always: `npm test`; `node test/e2e/qa.cjs --osm` for UI changes (Google run only if the map or
  Google search changed: quota); `CACHE` bumped if shell files changed; 320–390 px, dark, ≥900 px.
- [luar], owner only: taps and long-press on the Android phone; the Maps link opening Google Maps.
- Not relevant here (until the APK ships): DB backup/migration, installers, checksums, signing.
- Deploy uses the Pages actions at checkout@v6, setup-node@v6, configure-pages@v6,
  upload-pages-artifact@v5, deploy-pages@v5. On 2026-11-25 the old set (deploy-pages@v4 with
  upload-pages-artifact@v3) failed every run: "No artifacts named github-pages". Re-running a
  failed run doesn't help either: the old artifact is still there, so it finds 2 and refuses.

## APK (planned, not built yet)
- TWA wrapper of the live site + a `geo:` intent filter (WhatsApp location -> Jalur). Package
  `io.github.tendorethane_code.jalur`. Signing key SHA-256
  `C9:F3:5D:EF:ED:F0:E0:7D:8A:48:75:D5:04:A0:9B:06:09:04:3C:62:BD:70:55:4A:CB:6A:CD:11:BB:F3:25:D3`.
- Key in repo secrets `ANDROID_KEYSTORE_BASE64` + `ANDROID_KEYSTORE_PASSWORD` (alias `jalur`,
  PKCS12, the same password for store and key), backed up offline by the owner. Never commit it
  (`.gitignore`).
- Verification file: `.well-known/assetlinks.json` in the repo `tendorethane-code/tendorethane-code.github.io`
  (user site; its README has the rules and a checklist). The APK goes to this repo's Releases,
  with a SHA-256 checksum. An installed APK can't be withdrawn: the release check is stricter.

## Gotchas
- Google map is forced to `renderingType: RASTER` (vector needs WebGL). Dark mode = `colorScheme`.
- Google Places results may only be shown on a Google map, so Google search runs only in Google
  map mode; the OSM fallback uses Photon/Nominatim.
- Fallbacks: script load error or 10 s timeout -> OSM; `gm_authFailure` (key/referrer/quota) -> OSM for
  1 h; no `tilesloaded` after 12 s -> a "Pakai peta cadangan" button (OSM for 6 h, link back in the
  sheet footer). Google search error -> Photon for the rest of the visit.
- Google sets `position: relative` on the element it renders into. Rendered straight into the fixed
  `#map` that made it 0 px tall: blank map, no tile requests, on the owner's phone and in headless
  alike (I first blamed headless; wrong). Both engines now draw into a full-size child
  (`freshCanvas`). If the Google map is blank, check the canvas height before anything else.
- The Google map renders fine in headless Playwright here, so test it here.
- CARTO basemaps now need an API key; the OSM fallback uses OSM tiles (dark mode = CSS filter).
- The bicycle-profile "small roads" candidate is re-checked with `/trace_route` as a motorcycle;
  a 400 there is expected and the candidate is dropped.
- "Hati-hati di sini" = `junctions()`: Valhalla maneuvers 9/16 (bear), 17–25 (ramp/exit/keep/merge),
  26 roundabout, 12/13 U-turn; flyover/underpass from `edge.bridge`/`edge.tunnel`. Plain turns left out.
- Ghost taps: suggestions are chosen on pointerdown, so the list is gone before the finger lifts
  and the browser clicks whatever moved underneath. That silently hit "Pakai peta cadangan" on the
  owner's phone. `swallowNextClick()` eats that click (also after a long-press). Reproduce taps in
  Playwright with CDP touchStart, ~110 ms wait, touchEnd: `page.tap()` sends both at once and hides it.
- Long-press = pointer events on the map element (`watchLongPress` in map.js). Google's map events
  never reported a held finger on touch. Drags >10 px and second fingers cancel it.
- Browser QA: `test/e2e/qa.cjs` (all main flows, finger-like taps) and `test/e2e/ghost.cjs`
  (the ghost tap), see `test/e2e/README.md`. Run them after UI changes. The checklist is: Google engine + full-height canvas, Google search -> routes, bubble/card select,
  junction preview next/prev/close, swap (origin appears in Maps link), long-press, pick on map,
  sheet handle, reload keeps trip, 320 px and desktop without horizontal scroll, OSM fallback.
- Modes (`MODES` in route-analysis.js): motor = Valhalla `motorcycle` (never uses tolls) + the
  bicycle small-roads trick; mobil = `auto` with tolls (+2 alts), `exclude_tolls` (+1 alt) and
  shortest. Best of each first so the 4-route cut keeps a toll and a no-toll option. `edge.toll`
  gives `tollKm`, "Lewat tol"/"Tanpa tol" tags (only when there is a choice), "masuk/keluar tol"
  junction notes. Maps link `travelmode=driving`; Maps URLs can't say "avoid tolls", so a no-toll
  route relies on its waypoints. Mode is kept in localStorage `jalur.mode`.
- Access vs jalan tikus (`markAccess`): small roads from the start until the first non-small stretch
  >= 300 m, and from the last one to the end, are access (leaving the komplek, entering the
  destination): unavoidable, every route has them. Small roads anywhere else = `midSmallKm`, the
  jalan tikus the owner hates. Warnings, tags, card line ("1,0 km jalan tikus" / "Tanpa jalan tikus")
  and the "kecil" stat use the mid-route figure; the bar still shows the total. Example: UI Depok ->
  Pasar Minggu is 22% small roads on every route, all of it campus/destination access.
- Car thresholds are stricter than motor (warn from 0.4 km mid-route vs 1 km). In car mode the
  "terpendek" candidate is the one that repeats Google's mistake (Tebet -> Kemang: 1,9 km jalan tikus
  to save 0,8 km); it stays as a clearly labelled option, never hidden and never the default.
- "Jalan gede"/"Banyak gang" tags only when routes differ by >= 0.5 km of mid-route small road.
- Google Maps puts touch listeners on the whole document; after a long-press on the map it
  preventDefault-ed the next touch anywhere, so the first tap on a field or button did nothing.
  map.js stops touches that start outside `#map` at window capture before Google loads.
- fitRoute fits all routes (+32 px for bubbles): fitting only the selected one left another
  route's bubble under the search card.
- Valhalla's public server answers 429 to bursts (seen after many test runs): `post()` retries
  twice with backoff, then says the server is busy in plain words.
- **Google quota:** a day of repeated Google QA runs used up the owner's Maps JS daily quota; the
  live app fell back to OSM until the reset (~15:00 WIB). Run `qa.cjs --osm` by default.
- With a GPS start the Maps link omits `origin` so Google uses its live location.
- Search (`lib/search.js` + `searchPlaces`): expand "Jl./Gg./Jend." (Photon finds nothing for "Gg."),
  strip "No. 6"/RT/RW, rerank by distance from the GPS fix, dedupe street pieces. Nominatim
  ("Cari lebih teliti") only on tap: its policy forbids search-as-you-type.
- Android share target (manifest `share_target`): Google Maps → Bagikan → Jalur fills the destination.
- Shareloc of a nameless pin (a house in a perumahan) may arrive as only a `maps.app.goo.gl` short
  link: no coordinates, and a browser can't open it (cross-origin redirect). Jalur then says so,
  shows the raw shared text ("Yang dikirim: …") and offers "Tempel koordinat" (clipboard, read on
  click: a touch pointerdown isn't a user activation). "Near/Dekat Jl. X" is searched but flagged
  as rough. Decimal-comma coordinates ("-6,30, 106,65") are read too. UNVERIFIED: what Google Maps
  on the owner's phone really sends for a dropped pin; the raw text on screen will tell. A
  short-link resolver would need a server (e.g. a Cloudflare Worker) or the APK: the link 302s to
  a google.com/maps/place/... URL with `!3d…!4d…` (checked on a real one), but sends no CORS header.
- WhatsApp location bubble -> Android asks which app (Maps, Waze, Grab, Gojek, Maxim): almost
  surely a `geo:` intent with coordinates. A Chrome-installed PWA can't register for `geo:`
  (protocol handlers are desktop-only); a TWA APK with a `geo` intent filter could.
- WhatsApp location bubbles can't be shared to other apps; they open Google Maps, share from there.
- Traffic ("Macet" button in the route list header, Google map only, `jalur.traffic`): Google's
  `TrafficLayer` (live, car speeds; motors filter through). Not a floating map button: on phones
  it covered time bubbles, and padding the fit for it zoomed the short map strip far out. With it on, routes are drawn as see-through bands so the
  traffic colour of the road underneath stays readable; road-size colours return when it's off.
  Gives no minutes. Real traffic minutes would need the Routes API (separate SKU, not enabled).
- The Maps link sends the destination as coordinates, so Google labels it with the nearest shop
  (picked "Living World", Google showed "Sociolla Living World"). Same spot; a name string would be
  ambiguous ("Indomaret, Tangerang").

## Open questions (verify on a real phone and real routes)
- Verified on the owner's Android: the link opens Google Maps in "Motor" mode with "3 perhentian",
  and Google follows our route: Tangerang -> Living World Alam Sutera, Jalur 12,5 km / 16,0 km vs
  Google 13 km / 16 km for the same two routes. Watch for small loops near a waypoint (one showed up
  near stop A); unconfirmed whether it is a detour.
- Jalur's minutes are far too slow there: 40 / 48 min vs Google 24 / 26 min (normal traffic).
  Valhalla motorcycle speeds look pessimistic for Tangerang roads. Don't present minutes as exact.
- Google map + Places search shipped (owner set up Google Cloud, Rp500k prepayment requirement for
  their card). First phone test: map blank (0 px bug above, fixed). Still to confirm on the phone:
  long-press on the real phone. The jump to OSM the owner saw was the ghost tap above (reproduced
  on the old build, fixed). The trip survives a reload (sessionStorage).
  Did the owner set the daily quotas (step 6)?
- Is the OSM road-size classification right on the owner's usual routes?
- Search is weaker than Google's: OSM lacks many POIs and house numbers. Owner's report: a full
  address with "No. 6" found nothing. Fixed what's fixable; the share target covers the rest.
- Is the junction list useful, too long, or missing forks?
- No traffic data: minutes are free-flow. Google Routes API / TomTom have traffic but need keys.
