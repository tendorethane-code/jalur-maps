import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { resolve } from '../resolver/worker.js';

// A fake fetch: a map of URL -> [status, location].
const fakeFetch = (hops) => async (url) => {
  const [status, location] = hops[url] || [200, null];
  return new Response(null, { status, headers: location ? { Location: location } : {} });
};
const PLACE = 'https://www.google.com/maps/place/Jl.+Contoh/data=!4m6!3m5!1s0x1:0x2!8m2!3d-6.1788!4d106.7098?entry=gps';

test('resolve follows a short link to the place URL with coordinates', async () => {
  const url = await resolve('https://maps.app.goo.gl/abc', fakeFetch({ 'https://maps.app.goo.gl/abc': [302, PLACE] }));
  assert.equal(url, PLACE);
});

test('resolve unwraps a cookie consent page', async () => {
  const consent = `https://consent.google.com/ml?continue=${encodeURIComponent(PLACE)}`;
  const url = await resolve('https://maps.app.goo.gl/abc', fakeFetch({ 'https://maps.app.goo.gl/abc': [302, consent] }));
  assert.equal(url, PLACE);
});

test('resolve refuses to follow a redirect away from Google', async () => {
  await assert.rejects(
    resolve('https://maps.app.goo.gl/abc', fakeFetch({ 'https://maps.app.goo.gl/abc': [302, 'https://evil.example/x'] })),
    /left Google/,
  );
});

test('worker only takes Google Maps short links and answers CORS for Jalur only', async () => {
  const call = (u, origin = 'https://tendorethane-code.github.io') =>
    worker.fetch(new Request(`https://w.example/?u=${encodeURIComponent(u)}`, { headers: { Origin: origin } }));
  let res = await call('https://example.com/x');
  assert.equal(res.status, 400);
  res = await call('http://localhost:1/admin');
  assert.equal(res.status, 400);
  res = await call('https://example.com/x', 'https://evil.example');
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://tendorethane-code.github.io');
  res = await worker.fetch(new Request('https://w.example/', { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173' } }));
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'http://localhost:5173');
});
