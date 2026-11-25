import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  groupOf, decodePolyline, analyzeRoute, mainStreets, stretches, dedupe, tagRoutes,
  prosCons, pickWaypoints, googleMapsUrl, shortName, formatKm, junctions, labelPoint, analyzeRoute as analyze, markAccess,
  shapeOverlap, distinctTrips,
} from '../public/lib/route-analysis.js';

// Real Valhalla responses: motorcycle, Tebet -> Kemang (recorded 2026-11-18).
const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
const route = fixture('route-tebet-kemang.json');
const trace = fixture('trace-tebet-kemang.json');

test('groupOf sorts roads into gede / sedang / kecil', () => {
  assert.equal(groupOf({ road_class: 'primary', use: 'road' }), 'gede');
  assert.equal(groupOf({ road_class: 'secondary', use: 'road' }), 'gede');
  assert.equal(groupOf({ road_class: 'tertiary', use: 'road' }), 'sedang');
  assert.equal(groupOf({ road_class: 'residential', use: 'road' }), 'kecil');
  // A living street is small even if tagged with a bigger class.
  assert.equal(groupOf({ road_class: 'service_other', use: 'living_street' }), 'kecil');
  assert.equal(groupOf({ road_class: 'tertiary', use: 'alley' }), 'kecil');
});

test('decodePolyline returns points inside Jakarta', () => {
  const pts = decodePolyline(trace.shape);
  assert.ok(pts.length > 100);
  for (const [lat, lon] of pts) {
    assert.ok(lat > -6.3 && lat < -6.2, `lat ${lat}`);
    assert.ok(lon > 106.8 && lon < 106.87, `lon ${lon}`);
  }
});

test('analyzeRoute on the real Tebet -> Kemang route', () => {
  const a = analyzeRoute(route.trip, trace);
  assert.equal(a.pct.gede + a.pct.sedang + a.pct.kecil, 100);
  assert.ok(a.pct.gede > 50, 'this route is mostly big roads');
  assert.ok(Math.abs(a.km - route.trip.summary.length) < 0.01);
  assert.ok(a.turns >= 3);
  const names = a.streets.map((s) => s.name);
  assert.ok(names.includes('Jl. Tebet Raya'), names.join(' | '));
  assert.ok(names.some((n) => n.includes('Gatot Subroto')), names.join(' | '));
  // Route numbers like "2" must not be shown as street names.
  assert.ok(!names.includes('2'));
});

test('stretches merge neighbours and cover the whole shape', () => {
  const s = stretches(trace.edges);
  for (let i = 1; i < s.length; i++) {
    assert.notEqual(s[i].group, s[i - 1].group);
    assert.equal(s[i].from, s[i - 1].to);
  }
  const km = s.reduce((t, x) => t + x.km, 0);
  const edgeKm = trace.edges.reduce((t, e) => t + e.length, 0);
  assert.ok(Math.abs(km - edgeKm) < 1e-9);
});

test('mainStreets drops short pieces and merges repeats', () => {
  const edges = [
    { names: ['Jalan A'], length: 1, road_class: 'primary' },
    { names: ['Jalan B'], length: 0.1, road_class: 'primary' },
    { names: ['Jalan A'], length: 0.5, road_class: 'primary' },
    { names: [], length: 0.6, road_class: 'residential' },
  ];
  assert.deepEqual(mainStreets(edges).map((s) => s.name), ['Jl. A', '(jalan kecil)']);
});

const fake = (o) => ({ minutes: 30, km: 10, pct: { gede: 50, sedang: 20, kecil: 30 }, midSmallKm: 0.3, accessSmallKm: 0, gangCount: 1, longestGangKm: 0.2, uturns: 0, unpavedKm: 0, wayLengths: new Map(), ...o });

test('dedupe removes routes on the same ways', () => {
  const a = fake({ wayLengths: new Map([[1, 5], [2, 5]]) });
  const b = fake({ wayLengths: new Map([[1, 5], [2, 4.9]]) });
  const c = fake({ wayLengths: new Map([[1, 5], [3, 5]]) });
  assert.deepEqual(dedupe([a, b, c]), [a, c]);
});

test('tagRoutes marks what tells routes apart', () => {
  const big = fake({ minutes: 28, km: 9.6, pct: { gede: 80, sedang: 15, kecil: 5 }, midSmallKm: 0.1 });
  const small = fake({ minutes: 31, km: 8.2, pct: { gede: 30, sedang: 20, kecil: 50 }, midSmallKm: 3.1 });
  tagRoutes([big, small]);
  assert.deepEqual(big.tags, ['tercepat', 'jalan gede']);
  assert.deepEqual(small.tags, ['terpendek', 'banyak gang']);
  const only = fake({});
  tagRoutes([only]);
  assert.deepEqual(only.tags, ['tercepat']);
});

test('prosCons explains the trade-off', () => {
  const big = fake({ minutes: 28, km: 9.6, pct: { gede: 80, sedang: 15, kecil: 5 }, midSmallKm: 0, accessSmallKm: 0.4, gangCount: 0, longestGangKm: 0 });
  const small = fake({ minutes: 33, km: 8.2, pct: { gede: 30, sedang: 20, kecil: 50 }, midSmallKm: 3.1, gangCount: 4, longestGangKm: 0.7, uturns: 1 });
  const all = [big, small];
  const b = prosCons(big, all), s = prosCons(small, all);
  assert.ok(b.plus.some((t) => t.includes('jalan gede')));
  assert.ok(b.minus.some((t) => t.includes('macet')));
  assert.ok(b.plus.includes('Gak ada jalan tikus di tengah rute'));
  assert.ok(b.plus.some((t) => t.includes('cuma pas keluar/masuk lokasi (400 m)')));
  assert.ok(s.minus.some((t) => t.includes('3,1 km jalan tikus di tengah rute')));
  assert.ok(s.minus.some((t) => t.includes('putar balik')));
  assert.ok(s.minus.some((t) => t.includes('+5 menit')));
  assert.ok(s.minus.some((t) => t.includes('Paling panjang 700 m gang nyambung')));
  // One stretch that is all of the jalan tikus: said once, not twice.
  const one = fake({ midSmallKm: 1.6, longestGangKm: 1.6, gangCount: 1 });
  assert.equal(prosCons(one, [one], 'mobil').minus.filter((t) => t.includes('1,6 km')).length, 1);
});

test('pickWaypoints puts points on the route, in order', () => {
  const shape = decodePolyline(trace.shape);
  const pts = pickWaypoints(trace.edges, shape, 3);
  assert.equal(pts.length, 3);
  const near = (p) => shape.some((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.0005);
  for (const p of pts) assert.ok(near(p), `waypoint ${p} is off the route`);
  // Order follows travel direction: each point is further along the shape.
  const idx = pts.map((p) => shape.findIndex((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.0005));
  assert.ok(idx[0] < idx[1] && idx[1] < idx[2], idx.join(','));
});

test('googleMapsUrl builds a two-wheeler directions link', () => {
  const url = new URL(googleMapsUrl([-6.2265, 106.8556], [-6.2607, 106.8135], [[-6.24, 106.83], [-6.25, 106.82]]));
  assert.equal(url.origin + url.pathname, 'https://www.google.com/maps/dir/');
  assert.equal(url.searchParams.get('api'), '1');
  assert.equal(url.searchParams.get('travelmode'), 'two-wheeler');
  assert.equal(url.searchParams.get('origin'), '-6.226500,106.855600');
  assert.equal(url.searchParams.get('waypoints'), '-6.240000,106.830000|-6.250000,106.820000');
});

test('shortName and formatKm read naturally', () => {
  assert.equal(shortName('Jalan Profesor Dokter Supomo SH'), 'Jl. Prof. Dr. Supomo SH');
  assert.equal(formatKm(0.34), '340 m');
  assert.equal(formatKm(2.25), '2,3 km');
});

test('junctions lists the forks on the real route, in Indonesian', () => {
  const shape = decodePolyline(trace.shape);
  const j = junctions(route.trip, trace.edges, shape);
  const texts = j.map((x) => x.text);
  // Valhalla: "Keep right to stay on Jalan Kapten Tendean", "Keep left to take Jalan Bangka I".
  assert.ok(texts.includes('Ambil kanan tetap di Jl. Kapt. Tendean'), texts.join(' | '));
  assert.ok(texts.includes('Ambil kiri ke Jl. Bangka I'), texts.join(' | '));
  // Plain 90-degree turns are not "careful here" points.
  assert.ok(!texts.some((t) => t.includes('Tebet Raya')), texts.join(' | '));
  for (let i = 1; i < j.length; i++) assert.ok(j[i].km >= j[i - 1].km);
  for (const x of j) assert.ok(Array.isArray(x.point) && typeof x.bearing === 'number');
  const uturn = junctions({ legs: [{ maneuvers: [{ type: 1, begin_shape_index: 0, length: 1 }, { type: 13, begin_shape_index: 5, length: 1, street_names: ['Jalan Taman Patra Kuningan'], instruction: 'Make a left U-turn to stay on Jalan Taman Patra Kuningan.' }] }] }, trace.edges, shape);
  assert.equal(uturn[0].text, 'Putar balik di Jl. Taman Patra Kuningan');
  const round = junctions({ legs: [{ maneuvers: [{ type: 1, begin_shape_index: 0, length: 1 }, { type: 26, begin_shape_index: 5, length: 1 }] }] }, trace.edges, shape);
  assert.equal(round[0].text, 'Masuk bundaran');
});

test('analyzeRoute gives each main street its road size', () => {
  const a = analyzeRoute(route.trip, trace);
  const gatsu = a.streets.find((s) => s.name.includes('Gatot Subroto'));
  assert.equal(gatsu.group, 'gede');
  assert.ok(a.junctions.length >= 2);
});

test('labelPoint picks a spot away from the other routes', () => {
  const a = { shape: [[0, 0], [0, 0.001], [0, 0.002], [0, 0.003], [0, 0.004]] };
  const b = { shape: [[0, 0], [0, 0.001], [0.01, 0.002], [0, 0.003], [0, 0.004]] };
  assert.deepEqual(labelPoint(b, [a]), [0.01, 0.002]);
});

test('googleMapsUrl leaves out origin when starting from GPS', () => {
  const url = new URL(googleMapsUrl(null, [-6.2607, 106.8135]));
  assert.equal(url.searchParams.has('origin'), false);
  assert.equal(url.searchParams.get('destination'), '-6.260700,106.813500');
});

test('cars: toll routes are tagged only when there is a choice', () => {
  const toll = fake({ minutes: 54, km: 33, tollKm: 26.5, pct: { gede: 88, sedang: 10, kecil: 2 } });
  const free = fake({ minutes: 108, km: 40.4, tollKm: 0, pct: { gede: 89, sedang: 9, kecil: 2 } });
  tagRoutes([toll, free], 'mobil');
  assert.ok(toll.tags.includes('lewat tol'));
  assert.ok(free.tags.includes('tanpa tol'));
  // 88% vs 89% big road is noise: no "jalan gede" / "banyak gang" tags.
  assert.ok(!toll.tags.includes('jalan gede') && !free.tags.includes('jalan gede'));
  assert.ok(!toll.tags.includes('banyak gang') && !free.tags.includes('banyak gang'));
  // All on the toll road: nothing to choose, no toll tags. Motorbikes never get them.
  const a = fake({ tollKm: 20 }), b = fake({ tollKm: 22, minutes: 35 });
  tagRoutes([a, b], 'mobil');
  assert.ok(!a.tags.some((t) => t.includes('tol')) && !b.tags.some((t) => t.includes('tol')));
  tagRoutes([toll, free], 'motor');
  assert.ok(!toll.tags.some((t) => t.includes('tol')));
});

test('cars: pros and cons talk about tolls and narrow roads', () => {
  const toll = fake({ minutes: 54, km: 33, tollKm: 26.5, pct: { gede: 88, sedang: 10, kecil: 2 }, midSmallKm: 0.4, gangCount: 1, longestGangKm: 0.4 });
  const free = fake({ minutes: 108, km: 40.4, tollKm: 0, pct: { gede: 60, sedang: 18, kecil: 22 }, midSmallKm: 2.6, gangCount: 2, longestGangKm: 0.2 });
  const t = prosCons(toll, [toll, free], 'mobil');
  const f = prosCons(free, [toll, free], 'mobil');
  assert.ok(t.plus.some((x) => x.includes('Lewat tol 26,5 km')));
  assert.ok(t.minus.includes('Bayar tol'));
  // 400 m in one piece = all of the 400 m mid-route small road: named once.
  assert.equal(t.minus.filter((x) => x.includes('400 m')).length, 1);
  assert.ok(f.plus.includes('Gak bayar tol'));
  assert.ok(f.minus.some((x) => x.includes('2,6 km jalan kecil di tengah rute, mobil bisa susah papasan')));
  // The motorbike wording is unchanged.
  assert.ok(!prosCons(free, [toll, free], 'motor').minus.some((x) => x.includes('mobil')));
});

test('toll km and "masuk tol" come from edge.toll', () => {
  const trip = { summary: { time: 600, length: 3 }, legs: [{ maneuvers: [
    { type: 1, begin_shape_index: 0, length: 1 },
    { type: 23, begin_shape_index: 2, length: 2, street_names: ['Jalan Tol Jakarta-Tangerang'], instruction: 'Keep right to take the ramp.' },
    { type: 4, begin_shape_index: 4, length: 0 },
  ] }] };
  const edges = [
    { begin_shape_index: 0, end_shape_index: 2, length: 1, road_class: 'primary', use: 'road', way_id: 1 },
    { begin_shape_index: 2, end_shape_index: 4, length: 2, road_class: 'motorway', use: 'road', way_id: 2, toll: true },
  ];
  // shape "_ibE_ibE..." is irrelevant here; build a tiny straight one
  const shape = '_p~iF~ps|U_ulLnnqC_mqNvxq`@_ulLnnqC';
  const a = analyze(trip, { edges, shape });
  assert.equal(a.tollKm, 2);
  assert.deepEqual(a.junctions[0].notes, ['masuk tol']);
});

test('googleMapsUrl uses driving for cars', () => {
  assert.equal(new URL(googleMapsUrl(null, [-6.2, 106.8], [], 'mobil')).searchParams.get('travelmode'), 'driving');
  assert.equal(new URL(googleMapsUrl(null, [-6.2, 106.8])).searchParams.get('travelmode'), 'two-wheeler');
});

test('small roads at the start and end are access, the rest is jalan tikus', () => {
  const S = (group, km) => ({ group, km });
  const parts = markAccess([
    S('kecil', 0.4), S('sedang', 0.1), S('kecil', 0.2), // still getting out: 100 m of sedang is not a main road
    S('gede', 3), S('kecil', 1.2), S('gede', 2), // 1,2 km cut-through in the middle
    S('sedang', 0.5), S('kecil', 0.3), // into the destination
  ]);
  assert.deepEqual(parts.map((p) => p.access), [true, true, true, false, false, false, false, true]);
  // A trip that never leaves small roads is all access: nothing to choose there.
  assert.ok(markAccess([S('kecil', 0.5), S('sedang', 0.2), S('kecil', 0.4)]).every((p) => p.access));
});

test('analyzeRoute on the real route splits access and mid-route small roads', () => {
  const a = analyzeRoute(route.trip, trace);
  const totalSmall = a.groupKm.kecil;
  assert.ok(Math.abs(a.midSmallKm + a.accessSmallKm - totalSmall) < 1e-9);
  // The route starts in a living street in Tebet and ends in Kemang lanes: that is access.
  assert.ok(a.accessSmallKm > 0);
});

test('distinctTrips drops a repeated candidate before tracing, keeps real alternatives', () => {
  const [main, alt1, alt2] = [route.trip, ...route.alternates.map((a) => a.trip)];
  const kept = distinctTrips([main, alt1, { ...main }, alt2]);
  assert.deepEqual(kept, [main, alt1, alt2]); // the copy of main is gone, order kept
  assert.equal(distinctTrips([main, alt1, alt2], { max: 2 }).length, 2);
  const a = decodePolyline(main.legs[0].shape);
  const b = decodePolyline(alt1.legs[0].shape);
  assert.equal(shapeOverlap(a, a), 1);
  assert.ok(shapeOverlap(a, b) < 0.97, `alternative overlaps ${shapeOverlap(a, b)}`);
  // A line ~40 m to the side (a parallel gang) is not "the same road".
  const shifted = a.map(([lat, lon]) => [lat + 0.00036, lon]);
  assert.ok(shapeOverlap(a, shifted) < 0.5);
});
