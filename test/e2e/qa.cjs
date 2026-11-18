// QA pass over Jalur's main flows with finger-like taps (down, pause, up) on an emulated phone.
const { chromium, devices } = require('playwright');
const OUT = require('path').join(process.env.OUT || require('os').tmpdir(), 'jalur-qa-');
// Usage: node test/e2e/qa.cjs [url] [--osm]
// --osm blocks Google so the run uses the OpenStreetMap fallback. Each Google run loads the
// Google map ~10 times and runs several Places searches: that is the owner's daily quota
// (one day of heavy testing used it all up). Use --osm by default; run Google only to check it.
const OSM = process.argv.includes('--osm');
const URL = process.argv.slice(2).find((a) => !a.startsWith('--')) || 'http://localhost:5173/';
const noGoogle = async (ctx) => { if (OSM) await ctx.route(/googleapis\.com\/(maps|v1)|maps\.googleapis|places\.googleapis/, (r) => r.abort()); };
const results = [];
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

async function finger(p, cdp, x, y, holdMs = 110) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await p.waitForTimeout(holdMs);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
const center = (p, sel) => p.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
const tapSel = async (p, cdp, sel, hold) => { const c = await center(p, sel); await finger(p, cdp, c.x, c.y, hold); };
const waitResults = (p, re) => p.waitForFunction((src) => { const s = document.getElementById('suggestions'); return !s.classList.contains('stale') && new RegExp(src, 'i').test(s.innerText); }, re, { timeout: 20000 });
const gmaps = (p) => p.$eval('.go', (a) => Object.fromEntries(new URL(a.href).searchParams));

(async () => {
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } });
  const ctx = await b.newContext({ ...devices['Pixel 7'], geolocation: { latitude: -6.2445, longitude: 106.6283 }, permissions: ['geolocation'], colorScheme: 'dark' });
  await noGoogle(ctx);
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => m.type() === 'error' && !/trace_route|400|429|ERR_FAILED|Google Maps unavailable/.test(m.text()) && errors.push(m.text().slice(0, 150)));
  let navs = 0;
  p.on('framenavigated', (f) => { if (f === p.mainFrame()) navs++; });
  const cdp = await ctx.newCDPSession(p);

  await p.goto(URL);
  await p.waitForFunction(() => document.getElementById('from').value === 'Lokasi kamu', null, { timeout: 25000 });
  await p.waitForTimeout(2500);
  check(OSM ? 'OSM fallback engine' : 'Google map engine', (await p.evaluate(() => document.body.dataset.map)) === (OSM ? 'osm' : 'google'));
  check('Map canvas full height', (await p.$eval('.map-canvas', (e) => e.offsetHeight)) > 700);
  if (OSM) errors.length = 0; // the blocked Google script logs a load error by design

  // 1. Destination through Google search with a finger tap
  await tapSel(p, cdp, '#to');
  await p.fill('#to', 'living world alam sutera');
  await waitResults(p, 'Living World');
  check('Google suggestions show distance', /km|m\b/.test(await p.$eval('#suggestions .s-sub', (e) => e.textContent)));
  await tapSel(p, cdp, '#suggestions button[data-i="0"]');
  await p.waitForSelector('.rcard', { timeout: 40000 });
  await p.waitForTimeout(2500);
  check('Routes appear after picking destination', (await p.$$('.rcard')).length >= 2, `${(await p.$$('.rcard')).length} routes`);
  check('Suggestions closed after pick', await p.$eval('#suggestions', (e) => e.hidden));
  await p.screenshot({ path: OUT + '1-routes.png' });
  let g = await gmaps(p);
  check('Maps link: GPS start has no origin', !('origin' in g) && g.travelmode === 'two-wheeler' && g.waypoints.split('|').length === 3, JSON.stringify(g).slice(0, 120));

  // 2. Tap a time bubble on the map
  const before = await p.$eval('.rcard.sel', (c) => c.dataset.i);
  const bubble = await p.$('.bubble:not(.sel)');
  if (bubble) {
    const bb = await bubble.boundingBox();
    await finger(p, cdp, bb.x + bb.width / 2, bb.y + bb.height / 2);
    await p.waitForTimeout(900);
    check('Tapping a bubble switches route', (await p.$eval('.rcard.sel', (c) => c.dataset.i)) !== before);
  } else check('Tapping a bubble switches route', false, 'no other bubble on screen');

  // 3. Tap a route card
  await tapSel(p, cdp, '.rcard[data-i="0"]');
  await p.waitForTimeout(700);
  check('Tapping a card selects it', (await p.$eval('.rcard.sel', (c) => c.dataset.i)) === '0');

  // 4. Junction preview: open, next, prev, close
  const nJ = (await p.$$('.junctions button')).length;
  if (nJ) {
    await p.$eval('.junctions button[data-j="0"]', (e) => e.scrollIntoView({ block: 'center' }));
    await tapSel(p, cdp, '.junctions button[data-j="0"]');
    await p.waitForTimeout(1800);
    check('Preview opens', !(await p.$eval('#preview', (e) => e.hidden)));
    await p.screenshot({ path: OUT + '2-preview.png' });
    if (nJ > 1) {
      await tapSel(p, cdp, '[data-pv="next"]'); await p.waitForTimeout(900);
      check('Preview next', /Titik 2/.test(await p.$eval('.pv-count', (e) => e.textContent)));
      await tapSel(p, cdp, '[data-pv="prev"]'); await p.waitForTimeout(900);
      check('Preview prev', /Titik 1/.test(await p.$eval('.pv-count', (e) => e.textContent)));
    }
    await tapSel(p, cdp, '[data-pv="close"]'); await p.waitForTimeout(1200);
    check('Preview closes and sheet returns', (await p.$eval('#preview', (e) => e.hidden)) && !(await p.evaluate(() => document.body.classList.contains('previewing'))));
  } else check('Junction list present', false, 'no junctions on this route');

  // 5. Swap
  await tapSel(p, cdp, '#swap');
  await p.waitForSelector('.rcard', { timeout: 40000 }); await p.waitForTimeout(1500);
  check('Swap flips start and destination', (await p.inputValue('#from')) === 'Living World Alam Sutera' && (await p.inputValue('#to')) === 'Lokasi kamu');
  g = await gmaps(p);
  check('Maps link after swap has origin', 'origin' in g, JSON.stringify(g).slice(0, 100));
  await tapSel(p, cdp, '#swap');
  await p.waitForSelector('.rcard', { timeout: 40000 }); await p.waitForTimeout(1500);

  // 6. Long-press on the map sets the destination
  const mapPoint = { x: 200, y: 330 };
  const toBefore = await p.inputValue('#to');
  await finger(p, cdp, mapPoint.x, mapPoint.y, 900);
  await p.waitForTimeout(2500);
  const toAfter = await p.inputValue('#to');
  check('Long-press sets destination', toAfter !== toBefore, `${toBefore} -> ${toAfter}`);
  await p.waitForSelector('.rcard', { timeout: 40000 }).catch(() => {});

  // 7. "Pilih di peta" for the start
  await tapSel(p, cdp, '#from');
  await p.waitForTimeout(400);
  const pickIdx = await p.$$eval('#suggestions button[data-i]', (bs) => bs.findIndex((x) => x.innerText.includes('Pilih di peta')));
  await tapSel(p, cdp, `#suggestions button[data-i="${pickIdx}"]`);
  await p.waitForTimeout(500);
  check('Pick mode banner shows', !(await p.$eval('#pick-banner', (e) => e.hidden)));
  await finger(p, cdp, 180, 400);
  await p.waitForTimeout(2500);
  check('Map tap sets the start', (await p.inputValue('#from')) !== 'Lokasi kamu' && (await p.$eval('#pick-banner', (e) => e.hidden)), await p.inputValue('#from'));

  // 8. Sheet handle toggles size
  const h1 = await p.$eval('#sheet', (e) => e.getBoundingClientRect().height);
  await tapSel(p, cdp, '#sheet-grab'); await p.waitForTimeout(500);
  const h2 = await p.$eval('#sheet', (e) => e.getBoundingClientRect().height);
  check('Sheet handle changes size', Math.abs(h1 - h2) > 50, `${Math.round(h1)} -> ${Math.round(h2)}`);
  await tapSel(p, cdp, '#sheet-grab'); await p.waitForTimeout(500);

  // 9. Reload keeps the trip
  const tripBefore = [await p.inputValue('#from'), await p.inputValue('#to')];
  await p.reload();
  await p.waitForSelector('.rcard', { timeout: 40000 }).catch(() => {});
  await p.waitForTimeout(1500);
  const tripAfter = [await p.inputValue('#from'), await p.inputValue('#to')];
  check('Reload keeps start and destination', tripBefore.join('|') === tripAfter.join('|'), tripAfter.join(' -> '));

  check('No unexpected reloads', navs === 2, `${navs - 2} extra`);
  check('No page errors', errors.length === 0, errors.join(' | '));
  await p.screenshot({ path: OUT + '3-end.png' });
  await ctx.close();

  // 10. Car mode: Karawaci -> Kuningan City has a toll and a no-toll option
  {
    const c3 = await b.newContext({ ...devices['Pixel 7'], geolocation: { latitude: -6.2307, longitude: 106.6057 }, permissions: ['geolocation'] });
    await noGoogle(c3);
    const q = await c3.newPage();
    const qcdp = await c3.newCDPSession(q);
    const qerr = [];
    q.on('pageerror', (e) => qerr.push(e.message));
    await q.goto(URL);
    await q.waitForFunction(() => document.getElementById('from').value === 'Lokasi kamu', null, { timeout: 25000 });
    await tapSel(q, qcdp, '#to');
    await q.fill('#to', 'kuningan city');
    await waitResults(q, 'Kuningan City');
    await tapSel(q, qcdp, '#suggestions button[data-i="0"]');
    await q.waitForSelector('.rcard', { timeout: 40000 });
    const motorText = await q.$$eval('.rcard', (cs) => cs.map((c) => c.innerText).join(' '));
    check('Motor: no toll tags', !/tol/i.test(motorText));
    await tapSel(q, qcdp, '#modes [data-mode="mobil"]');
    await q.waitForFunction(() => document.querySelector('#modes [data-mode="mobil"]').getAttribute('aria-checked') === 'true' && document.querySelectorAll('.rcard').length > 0 && !document.querySelector('.skeleton'), null, { timeout: 40000 });
    await q.waitForTimeout(2000);
    const carText = await q.$$eval('.rcard', (cs) => cs.map((c) => c.innerText).join(' | '));
    check('Mobil: toll and no-toll routes offered', /Lewat tol/.test(carText) && /Tanpa tol/.test(carText), carText.replace(/\n/g, ' ').slice(0, 160));
    check('Mobil: Maps link drives', (await gmaps(q)).travelmode === 'driving');
    const tikus = await q.$$eval('.rcard', (cs) => cs.map((c) => c.querySelector('.rtikus')?.textContent || 'MISSING'));
    check('Every card says whether it uses jalan tikus', tikus.every((t) => /jalan tikus/i.test(t)), tikus.join(' | '));
    await q.screenshot({ path: OUT + '5-car.png' });
    const tollIdx = await q.$$eval('.rcard', (cs) => cs.findIndex((c) => /Lewat tol/.test(c.innerText)));
    await tapSel(q, qcdp, `.rcard[data-i="${tollIdx}"]`);
    await q.waitForTimeout(800);
    const pm = await q.$eval('.pm', (e) => e.innerText);
    check('Mobil: toll route lists "Bayar tol"', /Bayar tol/.test(pm));
    const notes = await q.$$eval('.j-note', (ns) => ns.map((n) => n.textContent));
    check('Mobil: junctions mark "masuk tol"', notes.includes('masuk tol'), notes.join(', '));
    await q.reload();
    await q.waitForSelector('.rcard', { timeout: 40000 });
    check('Mobil: mode survives reload', (await q.$eval('#modes [data-mode="mobil"]', (e) => e.getAttribute('aria-checked'))) === 'true');
    await tapSel(q, qcdp, '#modes [data-mode="motor"]');
    await q.waitForFunction(() => document.querySelector('#modes [data-mode="motor"]').getAttribute('aria-checked') === 'true' && document.querySelectorAll('.rcard').length > 0 && !document.querySelector('.skeleton'), null, { timeout: 40000 });
    await q.waitForTimeout(1500);
    check('Back to motor: two-wheeler link', (await gmaps(q)).travelmode === 'two-wheeler');
    check('Car flow: no page errors', qerr.length === 0, qerr.join(' | '));
    await c3.close();
  }

  // 11. Small phone + desktop layouts
  for (const [name, vp] of [['320', { width: 320, height: 640 }], ['desktop', { width: 1280, height: 800 }]]) {
    const c2 = await b.newContext({ viewport: vp, geolocation: { latitude: -6.2445, longitude: 106.6283 }, permissions: ['geolocation'] });
    await noGoogle(c2);
    const q = await c2.newPage();
    await q.goto(URL);
    await q.waitForFunction(() => document.getElementById('from').value === 'Lokasi kamu', null, { timeout: 25000 });
    await q.click('#to'); await q.fill('#to', 'living world alam sutera');
    await waitResults(q, 'Living World');
    await q.dispatchEvent('#suggestions button[data-i="0"]', 'pointerdown');
    await q.waitForSelector('.rcard', { timeout: 40000 }); await q.waitForTimeout(2500);
    check(`${name}: no horizontal scroll`, !(await q.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
    await q.screenshot({ path: OUT + `4-${name}.png` });
    await c2.close();
  }
  await b.close();
  console.log(results.join('\n'));
})().catch((e) => { console.log(results.join('\n')); console.error('CRASH', e.message.split('\n')[0]); process.exit(1); });
