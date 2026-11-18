// Network calls: Valhalla (routing, FOSSGIS public server) and Photon (place search).
// Both are free public services run by volunteers; keep requests few and polite.
import { analyzeRoute, dedupe, tagRoutes, pickWaypoints, labelPoint, MODES } from './route-analysis.js';
import { normalizeQuery, stripAddressDetails, parseCoordinates, rankPlaces } from './search.js';

const VALHALLA = 'https://valhalla1.openstreetmap.de';
const PHOTON = 'https://photon.komoot.io';
const NOMINATIM = 'https://nominatim.openstreetmap.org';
// Jabodetabek, a bit generous: west Tangerang to east Bekasi/Karawang, Bogor to the coast.
const BBOX = '106.35,-6.75,107.35,-5.95';

const TRACE_ATTRS = [
  'shape', 'edge.road_class', 'edge.use', 'edge.length', 'edge.surface',
  'edge.names', 'edge.way_id', 'edge.begin_shape_index', 'edge.end_shape_index',
  'edge.bridge', 'edge.tunnel', 'edge.toll',
];

export class RouteError extends Error {}

const wait = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('aborted', 'AbortError')); }, { once: true });
});

async function post(path, body, signal, attempt = 0) {
  let res;
  try {
    res = await fetch(VALHALLA + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new RouteError('Gak bisa nyambung ke server rute. Cek internet kamu.');
  }
  // The free public server rate-limits bursts (429). Back off and try again a couple of times.
  if (res.status === 429 && attempt < 2) {
    await wait(1500 * (attempt + 1), signal);
    return post(path, body, signal, attempt + 1);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new RouteError(res.status === 429
      ? 'Server rute gratisnya lagi sibuk. Tunggu sebentar terus coba lagi.'
      : data.error || `Server rute error (${res.status})`);
    e.code = data.error_code;
    throw e;
  }
  return data;
}

const loc = ([lat, lon]) => ({ lat, lon });

function traceAttributes(shape, signal, costing = 'motorcycle') {
  return post('/trace_attributes', {
    encoded_polyline: shape,
    shape_match: 'edge_walk',
    costing,
    filters: { attributes: TRACE_ATTRS, action: 'include' },
  }, signal);
}

/**
 * Candidate motorcycle routes from a few different "personalities":
 * the default (+ alternatives), the shortest, and a small-roads one found with the
 * bicycle profile and then re-checked as a motorcycle route (dropped if a bike-only
 * path or one-way makes it invalid for a motorbike).
 */
function motorJobs(base, signal) {
  return [
    post('/route', { ...base, costing: 'motorcycle', alternates: 2 }, signal)
      .then((r) => [r.trip, ...(r.alternates || []).map((a) => a.trip)]),
    post('/route', { ...base, costing: 'motorcycle', costing_options: { motorcycle: { shortest: true } } }, signal)
      .then((r) => [r.trip]),
    post('/route', { ...base, costing: 'bicycle', costing_options: { bicycle: { bicycle_type: 'Hybrid', use_roads: 0 } } }, signal)
      .then((r) => post('/trace_route', {
        encoded_polyline: r.trip.legs[0].shape, shape_match: 'edge_walk', costing: 'motorcycle', units: 'km',
      }, signal))
      .then((r) => [r.trip]),
  ];
}

/**
 * Candidate car routes: with tolls allowed (+ alternatives), without tolls (+ one
 * alternative), and the shortest. No small-roads trick: in a car small roads are a cost.
 */
function carJobs(base, signal) {
  const withAlts = (r) => [r.trip, ...(r.alternates || []).map((a) => a.trip)];
  return [
    post('/route', { ...base, costing: 'auto', alternates: 2 }, signal).then(withAlts),
    post('/route', { ...base, costing: 'auto', alternates: 1, costing_options: { auto: { exclude_tolls: true } } }, signal).then(withAlts),
    post('/route', { ...base, costing: 'auto', costing_options: { auto: { shortest: true } } }, signal).then((r) => [r.trip]),
  ];
}

async function candidateTrips(from, to, signal, mode) {
  const base = { locations: [loc(from), loc(to)], units: 'km' };
  const jobs = mode === 'mobil' ? carJobs(base, signal) : motorJobs(base, signal);
  const results = await Promise.allSettled(jobs);
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
  const groups = results.map((r) => (r.status === 'fulfilled' ? r.value : []));
  // Best of each personality first, alternatives after, so the 4-route cut keeps variety
  // (for a car: at least one toll and one no-toll route when both exist).
  const trips = [...groups.map((g) => g[0]).filter(Boolean), ...groups.flatMap((g) => g.slice(1))];
  if (!trips.length) {
    const first = results[0].reason;
    if (first?.name === 'AbortError') throw first;
    const what = mode === 'mobil' ? 'mobil' : 'motor';
    throw first instanceof RouteError && first.code === 442
      ? new RouteError(`Gak nemu rute ${what} ke sana. Coba geser titiknya ke jalan terdekat.`)
      : first || new RouteError('Gak nemu rute.');
  }
  return trips;
}

/** Analyzed, deduplicated, tagged routes, fastest first. */
export async function findRoutes(from, to, { signal, mode = 'motor' } = {}) {
  const costing = (MODES[mode] || MODES.motor).costing;
  const trips = await candidateTrips(from, to, signal, mode);
  const routes = [];
  // Two at a time so we don't hammer the public server.
  for (let i = 0; i < trips.length; i += 2) {
    const batch = trips.slice(i, i + 2);
    const traced = await Promise.allSettled(batch.map((t) => traceAttributes(t.legs[0].shape, signal, costing)));
    traced.forEach((r, j) => {
      if (r.status !== 'fulfilled') return;
      const a = analyzeRoute(batch[j], r.value);
      a.edges = r.value.edges;
      routes.push(a);
    });
  }
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
  if (!routes.length) throw new RouteError('Gak bisa baca detail jalannya. Coba lagi bentar.');
  const kept = dedupe(routes).slice(0, 4);
  kept.sort((a, b) => a.minutes - b.minutes || a.km - b.km);
  tagRoutes(kept, mode);
  for (const r of kept) {
    r.waypoints = pickWaypoints(r.edges, r.shape, 3);
    r.labelAt = labelPoint(r, kept.filter((o) => o !== r));
  }
  return kept;
}

function placeLabel(p) {
  const main = p.name || [p.street, p.housenumber].filter(Boolean).join(' ') || 'Titik tanpa nama';
  const area = [p.district || p.locality, p.city || p.county].filter((x) => x && x !== main);
  return { main, sub: [...new Set(area)].join(', ') };
}

async function photon(q, near, signal) {
  const p = new URLSearchParams({ q, limit: '15', bbox: BBOX });
  if (near) { p.set('lat', near[0]); p.set('lon', near[1]); }
  const res = await fetch(`${PHOTON}/api/?${p}`, { signal });
  if (!res.ok) throw new Error('Pencarian lagi error');
  const data = await res.json();
  return data.features.map((f) => ({
    ...placeLabel(f.properties),
    point: [f.geometry.coordinates[1], f.geometry.coordinates[0]],
  }));
}

function coordinateResult(point, name) {
  return [{ main: name || 'Titik koordinat', sub: `${point[0].toFixed(5)}, ${point[1].toFixed(5)}`, point, exact: true }];
}

/**
 * Search-as-you-type (Photon). Cleans the query first, retries without house number /
 * RT-RW if that finds too little, puts nearby places first and drops duplicates.
 * Pasted coordinates or Google Maps links with coordinates are used as-is.
 */
export async function searchPlaces(query, near, signal) {
  const point = parseCoordinates(query);
  if (point) return coordinateResult(point);
  const clean = normalizeQuery(query);
  const bare = stripAddressDetails(clean);
  if (bare && bare !== clean) {
    // A full address: OSM rarely has the house number, so the street itself comes first,
    // then anything that matched the full text (shops at that address etc.).
    const [street, full] = await Promise.all([photon(bare, near, signal), photon(clean, near, signal)]);
    return rankPlaces([...street, ...full], near);
  }
  return rankPlaces(await photon(clean, near, signal), near);
}

/**
 * Slower, more thorough search (Nominatim): better with full addresses and house numbers.
 * Only run when the user asks for it: Nominatim's usage policy forbids search-as-you-type.
 */
export async function searchPlacesDeep(query, near, signal) {
  const point = parseCoordinates(query);
  if (point) return coordinateResult(point);
  const clean = normalizeQuery(query);
  const p = new URLSearchParams({
    q: clean, format: 'jsonv2', addressdetails: '1', limit: '10', countrycodes: 'id',
    viewbox: BBOX, bounded: '1', 'accept-language': 'id',
  });
  const res = await fetch(`${NOMINATIM}/search?${p}`, { signal });
  if (!res.ok) throw new Error('Pencarian lagi error');
  const data = await res.json();
  const places = data.map((r) => {
    const a = r.address || {};
    const street = [a.road, a.house_number].filter(Boolean).join(' ');
    const main = r.name || street || r.display_name.split(',')[0];
    const area = [a.suburb || a.village || a.neighbourhood, a.city_district, a.city || a.county || a.town]
      .filter((x) => x && x !== main);
    return { main, sub: [...new Set(area)].slice(0, 2).join(', '), point: [Number(r.lat), Number(r.lon)] };
  });
  return rankPlaces(places, near, { limit: 8 });
}

/** Name of the place at a point (for "Lokasi kamu" and map taps). */
export async function reverse(point, signal) {
  try {
    const res = await fetch(`${PHOTON}/reverse?lat=${point[0]}&lon=${point[1]}&limit=1`, { signal });
    const f = (await res.json()).features[0];
    return f ? placeLabel(f.properties) : null;
  } catch {
    return null;
  }
}
