# Browser checks (manual, not part of `npm test`)

They drive the real app in Playwright Chromium with finger-like taps (touch down, ~110 ms,
touch up) on an emulated Pixel 7. They need network access (Google, Valhalla, Photon) and
the Google key only accepts `http://localhost:5173` and the github.io site.

```bash
npm run dev &                                  # http://localhost:5173
node test/e2e/qa.cjs                           # all main flows, prints PASS/FAIL per check
node test/e2e/qa.cjs https://tendorethane-code.github.io/jalur-maps/   # the live site
node test/e2e/ghost.cjs                        # the "jumped to the fallback map" ghost tap
```

Screenshots go to `$OUT` (default: the OS temp dir). In the agent sandbox, launch Chromium
with the proxy (already done in the scripts).
