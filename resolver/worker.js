// Jalur link resolver: a Cloudflare Worker that opens a Google Maps short link
// (maps.app.goo.gl/…) and answers with the full URL it leads to, which carries the coordinates
// (…!3d-6.17…!4d106.71…). Jalur is a web page, and the browser won't let a page read where
// another site redirects to (no CORS on Google's redirect), so it asks this Worker.
//
// It only ever opens Google Maps short links and only follows redirects inside Google, so it
// can't be used as a general proxy. Browsers only let Jalur's own pages read the answer.
//
// Deploy: Cloudflare dashboard -> Workers & Pages -> Create -> Hello World -> Edit code ->
// paste this file -> Deploy. Then put the workers.dev URL in public/config.js (RESOLVER).
// Call: GET https://<worker>/?u=https://maps.app.goo.gl/abc  ->  { "url": "https://www.google.com/maps/place/…" }

const ALLOWED_ORIGINS = ['https://tendorethane-code.github.io', 'http://localhost:5173'];
const SHORT_LINK = /^https:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps)\/[\w-]+/;
const GOOGLE_HOST = /^(www\.)?google\.[a-z.]+$|^maps\.google\.[a-z.]+$|^maps\.app\.goo\.gl$|^goo\.gl$|^consent\.google\.[a-z.]+$/;
const HAS_POINT = /!3d-?\d|@-?\d+\.\d+,|[?&](q|ll|center|query)=-?\d/;

export async function resolve(link, fetchImpl = fetch) {
  let url = link;
  for (let hop = 0; hop < 5; hop++) {
    const res = await fetchImpl(url, {
      redirect: 'manual',
      headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Mobile) JalurResolver', 'Accept-Language': 'id' },
    });
    const next = res.headers.get('Location');
    if (res.status < 300 || res.status >= 400 || !next) break;
    const target = new URL(next, url);
    if (!GOOGLE_HOST.test(target.hostname)) throw new Error('redirect left Google');
    // An EU-style cookie consent page wraps the real target in ?continue=.
    if (target.hostname.startsWith('consent.')) {
      const cont = target.searchParams.get('continue');
      if (cont) url = cont;
      break;
    }
    url = target.href;
    if (HAS_POINT.test(url)) break;
  }
  return url;
}

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Methods': 'GET',
      Vary: 'Origin',
    };
    const json = (status, body, extra = {}) => new Response(JSON.stringify(body), {
      status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors, ...extra },
    });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'GET') return json(405, { error: 'GET only' });
    const link = new URL(request.url).searchParams.get('u') || '';
    if (link.length > 300 || !SHORT_LINK.test(link)) return json(400, { error: 'Bukan link pendek Google Maps' });
    try {
      const url = await resolve(link);
      // A short link always points to the same place: let browsers and Cloudflare keep the answer.
      return json(200, { url }, { 'Cache-Control': 'public, max-age=86400' });
    } catch (err) {
      return json(502, { error: String(err.message || err) });
    }
  },
};
