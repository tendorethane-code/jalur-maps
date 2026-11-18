// Pure route analysis: no DOM, no network. Shared by the app and the node tests.
// Input is what Valhalla returns: a /route trip (time, distance, maneuvers) and a
// /trace_attributes result for the same geometry (one entry per road edge).

/** Travel modes: Valhalla costing and Google Maps travelmode. */
export const MODES = {
  motor: { label: 'Motor', costing: 'motorcycle', google: 'two-wheeler' },
  mobil: { label: 'Mobil', costing: 'auto', google: 'driving' },
};

/** Road size groups shown to the rider. */
export const GROUPS = {
  gede: { label: 'Jalan gede', short: 'Gede' },
  sedang: { label: 'Jalan sedang', short: 'Sedang' },
  kecil: { label: 'Jalan kecil / gang', short: 'Kecil' },
};

// Valhalla "use" values that are small no matter how the road class is tagged.
const SMALL_USES = new Set(['living_street', 'alley', 'driveway', 'service_road', 'parking_aisle', 'track', 'drive_through']);
const BIG_CLASSES = new Set(['motorway', 'trunk', 'primary', 'secondary']);
const UNPAVED = new Set(['compacted', 'dirt', 'gravel', 'path', 'impassable']);

/** Which size group an edge belongs to. */
export function groupOf(edge) {
  if (SMALL_USES.has(edge.use)) return 'kecil';
  if (BIG_CLASSES.has(edge.road_class)) return 'gede';
  if (edge.road_class === 'tertiary') return 'sedang';
  return 'kecil'; // unclassified, residential, service_other
}

/** Decode a Valhalla polyline (precision 6) into [lat, lon] pairs. */
export function decodePolyline(str, precision = 6) {
  const factor = 10 ** precision;
  const out = [];
  let index = 0, lat = 0, lon = 0;
  while (index < str.length) {
    for (const axis of [0, 1]) {
      let shift = 0, result = 0, byte;
      do {
        byte = str.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 0) lat += delta; else lon += delta;
    }
    out.push([lat / factor, lon / factor]);
  }
  return out;
}

// A name like "2" or "N1" is a route number, not a street name.
function streetName(names) {
  if (!names) return null;
  return names.find((n) => !/^[A-Z]{0,2}\d+[A-Z]?$/i.test(n.trim())) || null;
}

/** Shorten common Indonesian street prefixes so names fit on a phone. */
export function shortName(name) {
  return name
    .replace(/^Jalan\s+/i, 'Jl. ')
    .replace(/\bGang\b/i, 'Gg.')
    .replace(/\bProfesor\b/g, 'Prof.')
    .replace(/\bDo[k]?ter\b|\bDoktor\b/g, 'Dr.')
    .replace(/\bHajjah\b/g, 'Hj.')
    .replace(/\bJenderal\b/g, 'Jend.')
    .replace(/\bKapten\b/g, 'Kapt.')
    .replace(/\bHaji\b/g, 'H.');
}

/**
 * Consecutive edges merged into stretches of the same size group.
 * Each stretch: { group, km, from, to } where from/to are shape indexes.
 */
export function stretches(edges) {
  const out = [];
  for (const e of edges) {
    const g = groupOf(e);
    const last = out[out.length - 1];
    if (last && last.group === g) {
      last.km += e.length;
      last.to = e.end_shape_index;
    } else {
      out.push({ group: g, km: e.length, from: e.begin_shape_index, to: e.end_shape_index });
    }
  }
  return out;
}

// Maneuver types (Valhalla): 9–16 are turns, 12/13 are U-turns, 26 enters a roundabout.
const TURN_TYPES = new Set([9, 10, 11, 14, 15, 16, 26]);
const UTURN_TYPES = new Set([12, 13]);

/** Main streets in travel order, skipping short bits, with their dominant road size. */
export function mainStreets(edges, minKm = 0.4) {
  const runs = [];
  for (const e of edges) {
    const g = groupOf(e);
    const name = streetName(e.names) || (g === 'kecil' ? '(jalan kecil)' : '(tanpa nama)');
    const last = runs[runs.length - 1];
    if (last && last.name === name) { last.km += e.length; last.byGroup[g] += e.length; }
    else runs.push({ name, km: e.length, byGroup: { gede: 0, sedang: 0, kecil: 0, [g]: e.length } });
  }
  const kept = [];
  for (const r of runs) {
    if (r.km < minKm) continue;
    const last = kept[kept.length - 1];
    if (last && last.name === r.name) {
      last.km += r.km;
      for (const g in r.byGroup) last.byGroup[g] += r.byGroup[g];
    } else kept.push({ ...r, byGroup: { ...r.byGroup } });
  }
  return kept.map((r) => ({
    name: r.name.startsWith('(') ? r.name : shortName(r.name),
    km: r.km,
    group: Object.entries(r.byGroup).sort((a, b) => b[1] - a[1])[0][0],
  }));
}

// Maneuvers where riders pick the wrong lane or branch: forks, ramps, "keep left/right",
// merges, roundabouts, U-turns. Plain 90° turns are obvious and left out.
const SIDE = {
  9: 'kanan', 16: 'kiri', 17: 'lurus', 18: 'kanan', 19: 'kiri', 20: 'kanan', 21: 'kiri',
  22: 'lurus', 23: 'kanan', 24: 'kiri', 25: 'gabung', 26: 'bundaran', 12: 'putar', 13: 'putar',
};

/** Edge index (in trace.edges) that starts at or contains a shape index. */
function edgeAt(edges, shapeIndex) {
  const i = edges.findIndex((e) => e.begin_shape_index <= shapeIndex && shapeIndex < e.end_shape_index);
  return i < 0 ? edges.length - 1 : i;
}

/**
 * The "careful here" list: where the route splits or changes lane, in Indonesian,
 * with the point and the heading to show on the map.
 */
export function junctions(trip, edges, shape) {
  const out = [];
  let km = 0;
  for (const m of trip.legs.flatMap((l) => l.maneuvers)) {
    const side = SIDE[m.type];
    if (side && m.begin_shape_index > 0) {
      const ei = edgeAt(edges, m.begin_shape_index);
      const next = edges[ei], prev = edges[Math.max(0, ei - 1)];
      const name = streetName(m.street_names);
      const stay = /\bstay on\b/i.test(m.instruction || '');
      const prep = side === 'putar' ? 'di' : stay ? 'tetap di' : 'ke';
      const target = name ? `${prep} ${shortName(name)}` : '';
      const verb = {
        kanan: 'Ambil kanan', kiri: 'Ambil kiri', lurus: 'Tetap lurus', gabung: 'Gabung',
        bundaran: 'Masuk bundaran, keluar', putar: 'Putar balik',
      }[side];
      const notes = [];
      if (next?.bridge && !prev?.bridge) notes.push('naik flyover');
      else if (prev?.bridge && !next?.bridge) notes.push('turun dari flyover');
      if (next?.tunnel && !prev?.tunnel) notes.push('masuk underpass');
      if (next?.toll && !prev?.toll) notes.push('masuk tol');
      else if (prev?.toll && !next?.toll) notes.push('keluar tol');
      if (next && groupOf(next) === 'kecil' && prev && groupOf(prev) !== 'kecil') notes.push('masuk jalan kecil');
      out.push({
        side,
        text: side === 'bundaran' && !target ? 'Masuk bundaran' : [verb, target].filter(Boolean).join(' '),
        notes,
        km,
        point: shape[m.begin_shape_index],
        bearing: m.bearing_after ?? 0,
      });
    }
    km += m.length;
  }
  return out;
}

/**
 * Everything the UI shows about one route.
 * @param trip Valhalla trip (from /route or /trace_route)
 * @param trace Valhalla /trace_attributes response for that trip's shape
 */
export function analyzeRoute(trip, trace) {
  const edges = trace.edges;
  const km = { gede: 0, sedang: 0, kecil: 0 };
  let unpavedKm = 0, tollKm = 0;
  for (const e of edges) {
    km[groupOf(e)] += e.length;
    if (UNPAVED.has(e.surface)) unpavedKm += e.length;
    if (e.toll) tollKm += e.length;
  }
  const total = km.gede + km.sedang + km.kecil || 1;
  const pct = {
    gede: Math.round((100 * km.gede) / total),
    kecil: Math.round((100 * km.kecil) / total),
  };
  pct.sedang = 100 - pct.gede - pct.kecil;

  const parts = stretches(edges);
  // A "gang" stretch worth warning about: small road for at least 150 m.
  const gangs = parts.filter((s) => s.group === 'kecil' && s.km >= 0.15);
  const maneuvers = trip.legs.flatMap((l) => l.maneuvers);
  const shape = decodePolyline(trace.shape);

  const wayLengths = new Map();
  for (const e of edges) wayLengths.set(e.way_id, (wayLengths.get(e.way_id) || 0) + e.length);

  return {
    minutes: Math.round(trip.summary.time / 60),
    km: trip.summary.length,
    pct,
    groupKm: km,
    gangCount: gangs.length,
    longestGangKm: gangs.reduce((m, s) => Math.max(m, s.km), 0),
    unpavedKm,
    tollKm,
    turns: maneuvers.filter((m) => TURN_TYPES.has(m.type)).length,
    uturns: maneuvers.filter((m) => UTURN_TYPES.has(m.type)).length,
    streets: mainStreets(edges),
    stretches: parts,
    shape,
    junctions: junctions(trip, edges, shape),
    wayLengths,
  };
}

/** Share of route a's length that runs on the same OSM ways as route b (0–1). */
export function overlap(a, b) {
  let shared = 0, total = 0;
  for (const [id, len] of a.wayLengths) {
    total += len;
    if (b.wayLengths.has(id)) shared += Math.min(len, b.wayLengths.get(id));
  }
  return total ? shared / total : 0;
}

/** Drop routes that are basically the same road as one kept earlier. */
export function dedupe(routes, threshold = 0.85) {
  const kept = [];
  for (const r of routes) {
    if (!kept.some((k) => overlap(r, k) >= threshold && overlap(k, r) >= threshold)) kept.push(r);
  }
  return kept;
}

/**
 * Tag routes (mutates): fastest, shortest, most big road, most small road.
 * A tag is only given when it actually tells routes apart.
 */
export function tagRoutes(routes, mode = 'motor') {
  for (const r of routes) r.tags = [];
  if (!routes.length) return routes;
  const by = (fn) => routes.reduce((best, r) => (fn(r) > fn(best) ? r : best));
  by((r) => -r.minutes).tags.push('tercepat');
  if (routes.length > 1) {
    const shortest = by((r) => -r.km);
    if (!shortest.tags.includes('tercepat')) shortest.tags.push('terpendek');
    const big = by((r) => r.pct.gede);
    const small = by((r) => r.pct.kecil);
    // Only when it tells routes apart: 89% vs 88% big road, or 5% small road, is noise.
    if (big !== small && big.pct.gede - small.pct.gede >= 8) {
      big.tags.push('jalan gede');
      if (small.pct.kecil >= 10) small.tags.push('banyak gang');
    }
    // Cars: say which routes use the toll road, but only when there is a choice.
    if (mode === 'mobil') {
      const toll = routes.filter((r) => r.tollKm >= 1);
      if (toll.length && toll.length < routes.length) {
        for (const r of routes) r.tags.push(r.tollKm >= 1 ? 'lewat tol' : 'tanpa tol');
      }
    }
  }
  return routes;
}

/** Plus/minus notes in plain Indonesian, relative to the other routes. */
export function prosCons(route, routes, mode = 'motor') {
  const plus = [], minus = [];
  const car = mode === 'mobil';
  const fastest = Math.min(...routes.map((r) => r.minutes));
  const shortest = Math.min(...routes.map((r) => r.km));
  const extraMin = route.minutes - fastest;
  const extraKm = route.km - shortest;

  if (route.pct.gede >= 70) {
    plus.push('Mayoritas jalan gede, gampang diikutin');
    minus.push('Jalan gede rawan macet di jam sibuk');
  } else if (route.pct.gede >= 45) {
    plus.push('Campuran, tapi lebih banyak jalan gede');
  }
  if (car && route.tollKm >= 1) {
    plus.push(`Lewat tol ${formatKm(route.tollKm)}, biasanya lebih lancar`);
    minus.push('Bayar tol');
  } else if (car && routes.some((r) => r.tollKm >= 1)) {
    plus.push('Gak bayar tol');
  }
  // Small roads hurt more in a car (passing, parking), so the car warns earlier.
  if (route.pct.kecil >= (car ? 20 : 35)) {
    minus.push(car
      ? `Banyak jalan kecil (${route.pct.kecil}%), mobil bisa susah papasan`
      : `Banyak jalan kecil (${route.pct.kecil}%), rawan bingung & papasan`);
    plus.push('Bisa ngehindarin macet jalan raya');
  }
  if (route.gangCount === 0) plus.push(car ? 'Gak ada jalan sempit panjang' : 'Gak ada gang panjang');
  else if (route.longestGangKm >= (car ? 0.3 : 0.5)) {
    minus.push(`Ada ${car ? 'jalan sempit' : 'gang'} sepanjang ${formatKm(route.longestGangKm)}`);
  }
  if (route.uturns) minus.push(`${route.uturns}× putar balik`);
  if (route.unpavedKm >= 0.2) minus.push(`${formatKm(route.unpavedKm)} jalan belum diaspal (menurut peta)`);
  if (extraMin >= 2) minus.push(`+${extraMin} menit dari yang tercepat`);
  if (extraKm >= 0.5) minus.push(`+${formatKm(extraKm)} lebih jauh`);
  if (extraMin < 2 && routes.length > 1) plus.push('Paling cepat atau hampir sama');
  return { plus, minus };
}

export function formatKm(km) {
  return km < 1 ? `${Math.round(km * 100) * 10} m` : `${km.toFixed(1).replace('.', ',')} km`;
}

/**
 * Points along the route that force Google Maps onto the same roads.
 * Each point is the middle of a long-enough edge near an even split of the route,
 * so it sits on a road, not on a junction where Google could snap elsewhere.
 */
export function pickWaypoints(edges, shape, count = 3, minEdgeKm = 0.08) {
  const total = edges.reduce((s, e) => s + e.length, 0);
  const points = [];
  let used = -1;
  for (let i = 1; i <= count; i++) {
    const target = (total * i) / (count + 1);
    let acc = 0, best = null, bestGap = Infinity;
    edges.forEach((e, idx) => {
      const mid = acc + e.length / 2;
      acc += e.length;
      if (idx <= used || e.length < minEdgeKm) return;
      const gap = Math.abs(mid - target);
      if (gap < bestGap) { bestGap = gap; best = idx; }
    });
    if (best === null) continue;
    used = best;
    const e = edges[best];
    const midIdx = Math.round((e.begin_shape_index + e.end_shape_index) / 2);
    const p = e.end_shape_index - e.begin_shape_index >= 2 ? shape[midIdx] : midpoint(shape[e.begin_shape_index], shape[e.end_shape_index]);
    points.push(p);
  }
  return points;
}

function midpoint(a, b) {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

const fmt = ([lat, lon]) => `${lat.toFixed(6)},${lon.toFixed(6)}`;

/**
 * Google Maps directions link (Maps URLs API) that follows the chosen route.
 * Pass origin = null when starting from the rider's own location: Google then uses
 * its live GPS fix, so "Mulai" starts navigation instead of a preview from a fixed point.
 */
export function googleMapsUrl(origin, destination, waypoints = [], mode = 'motor') {
  const p = new URLSearchParams({ api: '1' });
  if (origin) p.set('origin', fmt(origin));
  p.set('destination', fmt(destination));
  p.set('travelmode', (MODES[mode] || MODES.motor).google);
  if (waypoints.length) p.set('waypoints', waypoints.map(fmt).join('|'));
  return `https://www.google.com/maps/dir/?${p.toString()}`;
}

// Rough metres between two [lat, lon] points (fine at city scale).
function metres(a, b) {
  const x = (b[1] - a[1]) * Math.cos(((a[0] + b[0]) / 2) * Math.PI / 180);
  const y = b[0] - a[0];
  return Math.hypot(x, y) * 111320;
}

/**
 * Where to pin a route's label on the map: the middle of its longest stretch that is
 * at least `gap` metres from every other route. Falls back to the route's midpoint.
 */
export function labelPoint(route, others, gap = 120) {
  const shape = route.shape;
  const step = Math.max(1, Math.floor(shape.length / 300));
  const sampled = others.map((o) => o.shape.filter((_, i) => i % step === 0));
  let best = null, run = null;
  for (let i = 0; i < shape.length; i += step) {
    const free = sampled.every((pts) => pts.every((q) => metres(shape[i], q) > gap));
    if (free) {
      run = run || { from: i, to: i };
      run.to = i;
      if (!best || run.to - run.from > best.to - best.from) best = { ...run };
    } else run = null;
  }
  const idx = best ? Math.round((best.from + best.to) / 2) : Math.floor(shape.length / 2);
  return shape[idx];
}
