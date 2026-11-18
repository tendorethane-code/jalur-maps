// Reproduce the "picked a place and it jumped to the fallback map" report with real taps.
// Force the "Peta Google belum muncul?" notice by hiding Google's tile load event, then tap a
// suggestion and see whether the page reloads into OSM.
const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } });
  const ctx = await b.newContext({ ...devices['Pixel 7'], geolocation: { latitude: -6.178, longitude: 106.63 }, permissions: ['geolocation'], colorScheme: 'dark' });
  const p = await ctx.newPage();
  await p.route(/maps\.googleapis\.com\/maps\/vt|maps\.gstatic\.com\/.*tile|\/vt\?/, () => {}); // tiles hang forever -> no tilesloaded -> notice after 12 s
  let reloads = 0;
  p.on('framenavigated', (f) => { if (f === p.mainFrame()) reloads++; });
  await p.goto(process.argv[2] || 'http://localhost:5173/');
  await p.waitForSelector('.map-notice', { timeout: 20000 }).catch(() => console.log('notice never shown'));
  const btnAt = await p.$eval('.map-notice button', (e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await p.tap('#from');
  await p.fill('#from', 'scientia square park');
  await p.waitForFunction(() => { const s = document.getElementById('suggestions'); return !s.classList.contains('stale') && /Scientia/i.test(s.innerText); }, null, { timeout: 20000 });
  const box = btnAt; // where the fallback button sits once the list closes
  console.log('under that spot while the list is open:', await p.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); const b = e && e.closest('#suggestions button'); return b ? 'suggestion: ' + b.innerText.split('\n')[0] : e && e.tagName; }, [box.x, box.y]));
  const notice = await p.$eval('.map-notice', (e) => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; }).catch(() => null);
  console.log('tap at y', Math.round(box.y), '| notice before tap', notice);
  // A real finger: down, ~120 ms, up (Playwright's tap() sends both at once).
  await p.evaluate(() => { window.__clicks = []; window.addEventListener('click', (e) => window.__clicks.push((e.target.closest('.map-notice') ? 'notice' : e.target.tagName) + (e.defaultPrevented ? ' (eaten)' : '')), true); });
  const cdp = await ctx.newCDPSession(p);
  const pt = [{ x: box.x, y: box.y }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt });
  await p.waitForTimeout(120);
  const under = await p.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e && (e.closest('.map-notice') ? 'NOTICE BUTTON' : e.tagName + '.' + e.className); }, [box.x, box.y]);
  console.log('element under the finger when it lifts:', under);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await p.waitForTimeout(300);
  console.log('clicks produced by the finger itself:', await p.evaluate(() => window.__clicks));
  // What Android Chrome does next: a click on the element under the lifted finger.
  const fired = process.argv[3] === 'manual' && await p.evaluate(() => { const btn = document.querySelector('.map-notice button'); if (!btn) return 'no notice button'; btn.click(); return 'ghost click sent to notice button'; });
  console.log(fired);
  await p.waitForTimeout(3000);
  console.log('navigations after start:', reloads - 1, '| map engine now:', await p.evaluate(() => document.body.dataset.map), '| from:', await p.inputValue('#from'));
  await b.close();
})();
