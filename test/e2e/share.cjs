// Shareloc and traffic checks with finger-like taps on an emulated phone.
// Usage: node test/e2e/share.cjs [url] [--google]
// Default runs on the OSM fallback (no Google quota). --google adds one Google map load to
// check the traffic toggle; the destination comes from shared coordinates, so no Places search.
const { chromium, devices } = require('playwright');
const OUT = require('path').join(process.env.OUT || require('os').tmpdir(), 'jalur-share-');
const GOOGLE = process.argv.includes('--google');
const URL = process.argv.slice(2).find((a) => !a.startsWith('--')) || 'http://localhost:5173/';
const results = [];
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

async function finger(p, cdp, x, y, holdMs = 110) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await p.waitForTimeout(holdMs);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
const tapSel = async (p, cdp, sel) => {
  const c = await p.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await finger(p, cdp, c.x, c.y);
};
const suggestText = (p) => p.$eval('#suggestions', (s) => (s.hidden ? '' : s.innerText));
const pasteIndex = (p) => p.$$eval('#suggestions button[data-i]', (bs) => bs.findIndex((b) => /Tempel koordinat/.test(b.innerText)));

async function page(b, { google = false, query = '', width } = {}) {
  const ctx = await b.newContext({
    ...devices['Pixel 7'], ...(width ? { viewport: { width, height: 800 } } : {}),
    geolocation: { latitude: -6.2445, longitude: 106.6283 },
    permissions: ['geolocation', 'clipboard-read', 'clipboard-write'], colorScheme: 'dark',
  });
  if (!google) await ctx.route(/googleapis\.com\/(maps|v1)|maps\.googleapis|places\.googleapis/, (r) => r.abort());
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(e.message));
  const cdp = await ctx.newCDPSession(p);
  await p.goto(URL + query);
  await p.waitForFunction(() => document.body.dataset.map, null, { timeout: 25000 });
  await p.waitForTimeout(1500);
  return { p, cdp, ctx };
}

(async () => {
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } });

  // 1. Shared short link only (a nameless pin): explain, show what came in, offer paste.
  let { p, cdp, ctx } = await page(b, { query: '?text=' + encodeURIComponent('Dropped pin\nhttps://maps.app.goo.gl/AbCd123') });
  let txt = await suggestText(p);
  check('Short link share explains', /gak bawa koordinat/.test(txt), txt.slice(0, 80));
  check('Short link share shows what came in', /Yang dikirim: [\s\S]*maps\.app\.goo\.gl/.test(txt));
  check('Short link share offers paste', (await pasteIndex(p)) >= 0);
  check('Traffic button absent on OSM', !(await p.$('[data-action="traffic"]')));
  await p.screenshot({ path: OUT + '1-shortlink.png' });

  // 2. Paste coordinates with decimal commas from the clipboard -> destination set.
  await p.evaluate(() => navigator.clipboard.writeText('-6,301234, 106,652100'));
  await tapSel(p, cdp, `#suggestions button[data-i="${await pasteIndex(p)}"]`);
  await p.waitForFunction(() => document.getElementById('to').value, null, { timeout: 15000 }).catch(() => {});
  check('Paste coordinates sets the destination', !!(await p.$eval('#to', (e) => e.value)), await p.$eval('#to', (e) => e.value));
  check('Suggestions closed after paste', await p.$eval('#suggestions', (e) => e.hidden));
  check('Clicks not swallowed: page still on same URL', !/\?/.test(p.url()));

  // 3. Pasting a short link into the field explains instead of searching.
  await tapSel(p, cdp, '#to');
  await p.fill('#to', 'https://maps.app.goo.gl/xyz');
  await p.waitForTimeout(400);
  check('Short link typed in field explains', /gak bawa koordinat/.test(await suggestText(p)));

  // 4. Clipboard holds a short link -> same explanation.
  await p.evaluate(() => navigator.clipboard.writeText('https://maps.app.goo.gl/xyz'));
  await tapSel(p, cdp, `#suggestions button[data-i="${await pasteIndex(p)}"]`);
  await p.waitForTimeout(400);
  check('Pasted short link explains', /gak bawa koordinat/.test(await suggestText(p)));

  // 4b. Share text with a name pasted into the field (the field glues the lines): search the name.
  await p.fill('#to', 'Stasiun Tebethttps://maps.app.goo.gl/x');
  await p.waitForTimeout(300);
  check('Pasted name + short link searches the name', (await p.$eval('#to', (e) => e.value)) === 'Stasiun Tebet');

  // 4c. Clipboard holds a nameless pin "near" a street: search the street, flagged rough.
  await p.evaluate(() => navigator.clipboard.writeText('Dropped pin\nNear Jl. Margonda Raya\nhttps://maps.app.goo.gl/x'));
  await p.fill('#to', '');
  await p.$eval('#to', (e) => e.dispatchEvent(new Event('input')));
  await p.waitForTimeout(200);
  await tapSel(p, cdp, `#suggestions button[data-i="${await pasteIndex(p)}"]`);
  await p.waitForTimeout(300);
  check('Pasted "near" pin searches the street', (await p.$eval('#to', (e) => e.value)) === 'Jl. Margonda Raya' && /kira-kira/.test(await suggestText(p)));

  // 5. Empty field: paste row is in the base list for the destination only.
  await p.fill('#to', '');
  await p.$eval('#to', (e) => e.dispatchEvent(new Event('input')));
  await p.waitForTimeout(200);
  check('Destination base list has paste', (await pasteIndex(p)) >= 0);
  await tapSel(p, cdp, '#from');
  await p.waitForTimeout(200);
  check('Start base list has no paste', (await pasteIndex(p)) < 0);
  check('No page errors (OSM)', !p.errors.length, p.errors.join(' | '));
  await ctx.close();

  // 6. "Near <street>" share: search it but say it's rough, keep paste on top.
  ({ p, cdp, ctx } = await page(b, { query: '?text=' + encodeURIComponent('Dropped pin\nNear Jl. Margonda Raya, Depok\nhttps://maps.app.goo.gl/x') }));
  await p.waitForFunction(() => !document.getElementById('suggestions').classList.contains('stale') && /Margonda/i.test(document.getElementById('suggestions').innerText), null, { timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(1500);
  txt = await suggestText(p);
  check('Near share searches the street', (await p.$eval('#to', (e) => e.value)) === 'Jl. Margonda Raya, Depok');
  check('Near share says it is rough after results', /kira-kira/.test(txt) && (await pasteIndex(p)) === 0, txt.slice(0, 100));
  await p.screenshot({ path: OUT + '2-near.png' });
  await ctx.close();

  // 7. Google: traffic toggle, routes become see-through bands, choice remembered.
  if (GOOGLE) {
    ({ p, cdp, ctx } = await page(b, { google: true, query: '?text=' + encodeURIComponent('-6.2405,106.6537') }));
    check('Google engine', (await p.evaluate(() => document.body.dataset.map)) === 'google');
    await p.waitForSelector('.rcard', { timeout: 40000 });
    await p.waitForTimeout(2000);
    check('Traffic button shown on Google', await p.$eval('[data-action="traffic"]', (e) => e.offsetHeight > 0));
    const trafficTiles = [];
    p.on('request', (r) => { if (/traffic|lyrs=[^&]*traffic|vt\?.*traffic/i.test(r.url())) trafficTiles.push(r.url()); });
    await tapSel(p, cdp, '[data-action="traffic"]');
    await p.waitForTimeout(3500);
    check('Traffic on: pressed + legend', (await p.$eval('[data-action="traffic"]', (e) => e.getAttribute('aria-pressed'))) === 'true' && !!(await p.$('.traffic-legend')));
    check('Routes still listed', (await p.$$('.rcard')).length >= 2);
    check('Traffic tiles requested', trafficTiles.length > 0, `${trafficTiles.length} requests`);
    await p.screenshot({ path: OUT + '3-traffic.png' });
    await p.reload();
    await p.waitForSelector('[data-action="traffic"]', { timeout: 40000 });
    await p.waitForTimeout(2500);
    check('Traffic choice survives reload', (await p.$eval('[data-action="traffic"]', (e) => e.getAttribute('aria-pressed'))) === 'true');
    await tapSel(p, cdp, '[data-action="traffic"]');
    await p.waitForTimeout(500);
    check('Traffic off again', (await p.$eval('[data-action="traffic"]', (e) => e.getAttribute('aria-pressed'))) === 'false' && !(await p.$('.traffic-legend')));
    check('No page errors (Google)', !p.errors.length, p.errors.join(' | '));
    await ctx.close();
  }

  await b.close();
  console.log(results.join('\n'));
  console.log(`screenshots: ${OUT}*.png`);
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})();
