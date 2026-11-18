// Network calls: Valhalla (routing, FOSSGIS public server) and Photon (place search).
// Both are free public services run by volunteers; keep requests few and polite.
import { analyzeRoute, dedupe, tagRoutes, pickWaypoints, labelPoint } from './route-analysis.js';

const VALHALLA = 'https://valhalla1.openstreetmap.de';
const PHOTON = 'https://photon.komoot.io';
// Jabodetabek, a bit generous: west Tangerang to east Bekasi/Karawang, Bogor to the coast.
const BBOX = '106.35,-6.75,107.35,-5.95';

const TRACE_ATTRS = [
  'shape', 'edge.road_class', 'edge.use', 'edge.length', 'edge.surface',
  'edge.names', 'edge.way_id', 'edge.begin_shape_index', 'edge.end_shape_index',
  'edge.bridge', 'edge.tunnel',
];

export class RouteError extends Error {}

async function post(path, body, signal) {
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
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new RouteError(data.error || `Server rute error (${res.status})`);
    e.code = data.error_code;
    throw e;
  }
  return data;
}

const loc = ([lat, lon]) => ({ lat, lon });

function traceAttributes(shape, signal) {
  return post('/trace_attributes', {
    encoded_polyline: shape,
    shape_match: 'edge_walk',
    costing: 'motorcycle',
    filters: { attributes: TRACE_ATTRS, action: 'include' },
  }, signal);
}

/**
 * Candidate motorcycle routes from a few different "personalities":
 * the default (+ alternatives), the shortest, and a small-roads one found with the
 * bicycle profile and then re-checked as a motorcycle route (dropped if a bike-only
 * path or one-way makes it invalid for a motorbike).
 */
async function candidateTrips(from, to, signal) {
  const locations = [loc(from), loc(to)];
  const base = { locations, units: 'km' };
  const jobs = [
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
  const results = await Promise.allSettled(jobs);
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
  const trips = results.filter((r) => r.status === 'fulfilled').flatMap((r) => r.value);
  if (!trips.length) {
    const first = results[0].reason;
    if (first?.name === 'AbortError') throw first;
    throw first instanceof RouteError && first.code === 442
      ? new RouteError('Gak nemu rute motor ke sana. Coba geser titiknya ke jalan terdekat.')
      : first || new RouteError('Gak nemu rute.');
  }
  return trips;
}

/** Analyzed, deduplicated, tagged routes, fastest first. */
export async function findRoutes(from, to, { signal } = {}) {
  const trips = await candidateTrips(from, to, signal);
  const routes = [];
  // Two at a time so we don't hammer the public server.
  for (let i = 0; i < trips.length; i += 2) {
    const batch = trips.slice(i, i + 2);
    const traced = await Promise.allSettled(batch.map((t) => traceAttributes(t.legs[0].shape, signal)));
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
  tagRoutes(kept);
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

/** Place search, biased to Jabodetabek and to the given point. */
export async function searchPlaces(query, near, signal) {
  const p = new URLSearchParams({ q: query, limit: '6', bbox: BBOX });
  if (near) { p.set('lat', near[0]); p.set('lon', near[1]); }
  const res = await fetch(`${PHOTON}/api/?${p}`, { signal });
  if (!res.ok) throw new Error('Pencarian lagi error');
  const data = await res.json();
  return data.features.map((f) => ({
    ...placeLabel(f.properties),
    point: [f.geometry.coordinates[1], f.geometry.coordinates[0]],
  }));
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
