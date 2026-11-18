// Pure helpers for place search: no DOM, no network. Shared by the app and the tests.
// OSM search engines (Photon, Nominatim) choke on the abbreviations people actually type
// in Indonesia ("Gg. Kelinci" finds nothing, "Gang Kelinci" finds five), and on house
// numbers, which OSM rarely has. So we clean the query before sending it.

const ABBREVIATIONS = [
  [/\bjln?\.?(?=\s|$)/gi, 'Jalan'],
  [/\bgg\.?(?=\s|$)/gi, 'Gang'],
  [/\bjend\.?(?=\s|$)/gi, 'Jenderal'],
  [/\bkol\.?(?=\s|$)/gi, 'Kolonel'],
  [/\bletjen\.?(?=\s|$)/gi, 'Letnan Jenderal'],
  [/\bprof\.?(?=\s|$)/gi, 'Profesor'],
  [/\bperum\.?(?=\s|$)/gi, 'Perumahan'],
  [/\bkomp\.?(?=\s|$)/gi, 'Komplek'],
  [/\bstn\.?(?=\s|$)/gi, 'Stasiun'],
  [/\brs\.?(?=\s|$)/gi, 'Rumah Sakit'],
];

/** Expand common abbreviations and tidy spacing. */
export function normalizeQuery(q) {
  let s = ` ${q} `.replace(/\s+/g, ' ');
  for (const [re, full] of ABBREVIATIONS) s = s.replace(re, full);
  return s.replace(/\s+,/g, ',').trim();
}

/** Drop house numbers, RT/RW and postcodes: "Jalan Mawar No. 6 RT 02/RW 05" -> "Jalan Mawar". */
export function stripAddressDetails(q) {
  return q
    .replace(/\b(no|nomor|nmr)\.?\s*\d+[a-z]?(\s*[-/]\s*\d+[a-z]?)?/gi, ' ')
    .replace(/\brt\.?\s*\d+(\s*\/\s*rw\.?\s*\d+)?/gi, ' ')
    .replace(/\brw\.?\s*\d+/gi, ' ')
    .replace(/\b\d{5}\b/g, ' ')
    .replace(/[\s,]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const inJabodetabek = (lat, lon) => lat > -7.2 && lat < -5.5 && lon > 105.8 && lon < 107.8;

/**
 * Coordinates typed or pasted by the user, or inside a Google Maps link:
 * "-6.2265, 106.8556", ".../@-6.22,106.85,17z", "?q=-6.22,106.85", "!3d-6.22!4d106.85".
 * Short links (maps.app.goo.gl) carry no coordinates and return null.
 */
export function parseCoordinates(text) {
  if (!text) return null;
  const s = decodeURIComponent(String(text));
  const patterns = [
    /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/, // place pages: most exact
    /[?&](?:q|query|destination|ll|center)=(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/,
    /@(-?\d+\.\d+),(-?\d+\.\d+)/,
    /^\s*(-?\d{1,2}\.\d{3,})\s*[, ]\s*(-?\d{2,3}\.\d{3,})\s*$/,
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m) {
      const lat = Number(m[1]), lon = Number(m[2]);
      if (inJabodetabek(lat, lon)) return [lat, lon];
    }
  }
  return null;
}

/**
 * What another app (usually Google Maps) shared to Jalur: { title, text, url }.
 * Google Maps sends something like "Living World Alam Sutera\nJl. Alam Sutera Boulevard...\nhttps://maps.app.goo.gl/...".
 * Returns { point } when coordinates are in there, else { query } to search for.
 */
export function parseShared({ title = '', text = '', url = '' } = {}) {
  const all = [title, text, url].filter(Boolean).join('\n');
  const point = parseCoordinates(all);
  const lines = all.split(/\n+/).map((l) => l.trim())
    .filter((l) => l && !/^https?:\/\//i.test(l) && !/^(dropped pin|pin lokasi|titik yang diletakkan)$/i.test(l));
  const name = lines[0] || '';
  if (point) return { point, name };
  return name ? { query: name, address: lines[1] || '' } : null;
}

/** Rough distance in km between two [lat, lon] points (fine at city scale). */
export function distanceKm(a, b) {
  const x = (b[1] - a[1]) * Math.cos(((a[0] + b[0]) / 2) * Math.PI / 180);
  const y = b[0] - a[0];
  return Math.hypot(x, y) * 111.32;
}

/**
 * Re-rank search results so nearby places win over far ones with the same name,
 * then drop duplicates (OSM splits one street into many pieces with the same name).
 * Each 3 km farther costs one place in the ranking.
 */
export function rankPlaces(places, near, { limit = 6, kmPerRank = 3 } = {}) {
  const scored = places.map((p, i) => {
    const km = near ? distanceKm(near, p.point) : null;
    return { ...p, km, score: i + (km ?? 0) / kmPerRank };
  });
  scored.sort((a, b) => a.score - b.score);
  const seen = new Set();
  const out = [];
  for (const p of scored) {
    const key = `${p.main}|${p.sub}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const { score, ...rest } = p;
    out.push(rest);
    if (out.length >= limit) break;
  }
  return out;
}

/** "350 m" / "2,4 km" / "18 km" for suggestion rows. */
export function formatDistance(km) {
  if (km == null) return '';
  if (km < 1) return `${Math.max(50, Math.round(km * 20) * 50)} m`;
  if (km < 10) return `${km.toFixed(1).replace('.', ',')} km`;
  return `${Math.round(km)} km`;
}
