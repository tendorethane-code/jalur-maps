# Browser checks (manual, not part of `npm test`)

They drive the real app in Playwright Chromium with finger-like taps (touch down, ~110 ms,
touch up) on an emulated Pixel 7. They need network access (Google, Valhalla, Photon) and
the Google key only accepts `http://localhost:5173` and the github.io site.

```bash
npm run dev &                                  # http://localhost:5173
node test/e2e/qa.cjs --osm                     # all main flows on the OSM fallback (no Google quota)
node test/e2e/qa.cjs                           # same on Google: ~10 map loads + Places searches
node test/e2e/qa.cjs https://tendorethane-code.github.io/jalur-maps/   # the live site
node test/e2e/ghost.cjs                        # the "jumped to the fallback map" ghost tap
node test/e2e/share.cjs                        # shareloc short link, paste coordinates (OSM)
node test/e2e/share.cjs --google               # + the traffic toggle (2 Google map loads, no Places)
```

Screenshots go to `$OUT` (default: the OS temp dir). In the agent sandbox, launch Chromium
with the proxy (already done in the scripts).

**Google quota:** every Google run spends the owner's Maps JS and Places daily quota. A day of
repeated runs used it all up once (the live app then fell back to OSM until the reset, about
15:00 WIB). Default to `--osm`; run on Google once at the end to confirm.
