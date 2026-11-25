import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeQuery, stripAddressDetails, parseCoordinates, parseShared, hasShortMapsLink, rankPlaces, formatDistance,
} from '../public/lib/search.js';

test('normalizeQuery expands what people type', () => {
  assert.equal(normalizeQuery('Gg. Kelinci'), 'Gang Kelinci'); // "Gg." found 0 results, "Gang" found 5
  assert.equal(normalizeQuery('jl. kemang raya'), 'Jalan kemang raya');
  assert.equal(normalizeQuery('Jln Margonda'), 'Jalan Margonda');
  assert.equal(normalizeQuery('Jl. Jend. Sudirman'), 'Jalan Jenderal Sudirman');
  assert.equal(normalizeQuery('stn tebet'), 'Stasiun tebet');
  // Words that only start like an abbreviation stay as they are.
  assert.equal(normalizeQuery('Jalan Gggarden'), 'Jalan Gggarden');
  assert.equal(normalizeQuery('Kolam renang'), 'Kolam renang');
});

test('stripAddressDetails drops house number, RT/RW and postcode', () => {
  assert.equal(stripAddressDetails('Jalan Permata Indah III No. 6'), 'Jalan Permata Indah III');
  assert.equal(stripAddressDetails('Jalan Mawar No.12A RT 02/RW 05, 15810'), 'Jalan Mawar');
  assert.equal(stripAddressDetails('Jalan Melati nomor 3'), 'Jalan Melati');
  assert.equal(stripAddressDetails('Living World'), 'Living World');
});

test('parseCoordinates reads typed coordinates and Google Maps links', () => {
  assert.deepEqual(parseCoordinates('-6.2265, 106.8556'), [-6.2265, 106.8556]);
  assert.deepEqual(parseCoordinates('-6.2265 106.8556'), [-6.2265, 106.8556]);
  assert.deepEqual(parseCoordinates('-6,301234, 106,652100'), [-6.301234, 106.6521]); // decimal commas
  assert.deepEqual(parseCoordinates('-6.301234,106.652100'), [-6.301234, 106.6521]);
  assert.deepEqual(parseCoordinates('https://www.google.com/maps/place/X/@-6.2401,106.6531,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d-6.2405!4d106.6537'), [-6.2405, 106.6537]);
  assert.deepEqual(parseCoordinates('https://maps.google.com/?q=-6.21,106.82'), [-6.21, 106.82]);
  assert.deepEqual(parseCoordinates('https://www.google.com/maps/@-6.30,106.65,15z'), [-6.3, 106.65]);
  assert.equal(parseCoordinates('https://maps.app.goo.gl/AbCdEf123'), null); // short link: no coordinates
  assert.equal(parseCoordinates('48.8584, 2.2945'), null); // Paris is not Jabodetabek
  assert.equal(parseCoordinates('Jalan Mawar 12'), null);
});

test('parseShared turns a Google Maps share into a search', () => {
  assert.deepEqual(
    parseShared({ text: 'Living World Alam Sutera\nJl. Alam Sutera Boulevard No.Kav. 21, Pakulonan\nhttps://maps.app.goo.gl/AbCd' }),
    { query: 'Living World Alam Sutera', address: 'Jl. Alam Sutera Boulevard No.Kav. 21, Pakulonan' },
  );
  assert.deepEqual(parseShared({ title: 'Stasiun Tebet', url: 'https://maps.app.goo.gl/x' }), { query: 'Stasiun Tebet', address: '' });
  assert.deepEqual(parseShared({ text: 'Dropped pin\nhttps://maps.google.com/?q=-6.25,106.80' }), { point: [-6.25, 106.8], name: '' });
  assert.equal(parseShared({}), null);
});

test('parseShared: a nameless pin as a short link asks for coordinates', () => {
  // A house in a perumahan: no name, and the short link can't be opened from a browser.
  assert.deepEqual(parseShared({ url: 'https://maps.app.goo.gl/x' }), { needsCoords: true, raw: 'https://maps.app.goo.gl/x' });
  assert.equal(parseShared({ text: 'Dropped pin\nhttps://maps.app.goo.gl/x' }).needsCoords, true);
  assert.equal(parseShared({ text: 'Pin yang dilepas\nhttps://maps.app.goo.gl/x' }).needsCoords, true);
  // "Near ..." is a rough hint: search it, but flag it.
  assert.deepEqual(parseShared({ text: 'Dropped pin\nNear Jl. Mawar, Ciputat\nhttps://maps.app.goo.gl/x' }),
    { query: 'Jl. Mawar, Ciputat', address: '', approx: true });
  // Coordinates on their own line win over everything.
  assert.deepEqual(parseShared({ text: 'Dropped pin\n-6.301234, 106.6521\nhttps://maps.app.goo.gl/x' }).point, [-6.301234, 106.6521]);
});

test('hasShortMapsLink', () => {
  assert.ok(hasShortMapsLink('https://maps.app.goo.gl/AbCd'));
  assert.ok(hasShortMapsLink('lihat https://goo.gl/maps/xyz ya'));
  assert.ok(!hasShortMapsLink('https://www.google.com/maps/@-6.2,106.8,17z'));
});

test('rankPlaces puts nearby places first and drops duplicates', () => {
  const tangerang = [-6.18, 106.63];
  const places = [
    { main: 'Jalan Permata Indah III', sub: 'Pasar Rebo, Jakarta', point: [-6.32, 106.86] },
    { main: 'Jalan Permata Indah III', sub: 'Pasar Rebo, Jakarta', point: [-6.321, 106.861] },
    { main: 'Gang Permata Indah III', sub: 'Pasar Rebo, Jakarta', point: [-6.322, 106.862] },
    { main: 'Jalan Permata Indah III', sub: 'Curug, Tangerang', point: [-6.24, 106.56] },
  ];
  const ranked = rankPlaces(places, tangerang);
  assert.equal(ranked[0].sub, 'Curug, Tangerang');
  assert.equal(ranked.length, 3);
  assert.ok(ranked[0].km < 15);
  // Without a location the original order is kept.
  assert.equal(rankPlaces(places, null)[0].sub, 'Pasar Rebo, Jakarta');
});

test('formatDistance', () => {
  assert.equal(formatDistance(0.33), '350 m');
  assert.equal(formatDistance(2.44), '2,4 km');
  assert.equal(formatDistance(23.6), '24 km');
  assert.equal(formatDistance(null), '');
});
