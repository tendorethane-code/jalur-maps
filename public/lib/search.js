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
    /^\s*(-?\d{1,2}\.\d{3,})\s*[, ]\s*(-?\d{2,3}\.\d{3,})\s*$/m,
    // Decimal commas, as an Indonesian phone may write them: "-6,301234, 106,652100".
    /^\s*(-?\d{1,2},\d{3,})\s*[,; ]\s*(-?\d{2,3},\d{3,})\s*$/m,
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m) {
      const lat = Number(m[1].replace(',', '.')), lon = Number(m[2].replace(',', '.'));
      if (inJabodetabek(lat, lon)) return [lat, lon];
    }
  }
  return null;
}

/** A Google Maps short link (maps.app.goo.gl/…, goo.gl/maps/…): no coordinates inside. */
export function hasShortMapsLink(text) {
  return /\b(maps\.app\.goo\.gl|goo\.gl\/maps)\//i.test(String(text || ''));
}

/** The first Google Maps short link in a text, or ''. */
export function shortMapsLink(text) {
  const m = String(text || '').match(/https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps)\/[\w-]+(?:\?[^\s]*)?/i);
  return m ? m[0].replace(/^http:/i, 'https:') : '';
}

/**
 * The place name in a full Google Maps URL (".../maps/place/Jl.+Flamboyan+1,+Duri+Kosambi,+.../data=..."),
 * split like a search result: { main: 'Jl. Flamboyan 1', sub: 'Duri Kosambi, …' }, or null.
 */
export function placeFromMapsUrl(url) {
  const m = String(url || '').match(/\/maps\/place\/([^/?#]+)/);
  if (!m) return null;
  let name;
  try { name = decodeURIComponent(m[1].replace(/\+/g, ' ')).trim(); } catch { return null; }
  if (!name || /^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/.test(name)) return null; // just coordinates
  const parts = name.split(/,\s*/).filter((x) => x && !/^RT\.?\s*\d|^RW\.?\s*\d|^\d{5}$/i.test(x));
  return { main: parts[0], sub: parts.slice(1, 3).join(', ') };
}

// Labels Google Maps puts on a pin that has no name (English and Indonesian, as far as known).
const PIN_LABEL = /^(dropped pin|pin (lokasi|yang dilepas|dilepas|yang dijatuhkan|terpasang)|titik yang diletakkan|lokasi yang ditandai)$/i;

/**
 * What another app (usually Google Maps) shared to Jalur: { title, text, url }.
 * Google Maps sends something like "Living World Alam Sutera\nJl. Alam Sutera Boulevard...\nhttps://maps.app.goo.gl/...".
 * Returns { point } when coordinates are in there, else { query } to search for.
 * A pin without a name (a house in a perumahan) often comes as only a short link, which a
 * browser can't open to read the coordinates: that returns { needsCoords: true, raw }.
 * "Near Jl. X" / "Dekat Jl. X" is only roughly there: { query: 'Jl. X', approx: true }.
 */
export function parseShared({ title = '', text = '', url = '' } = {}) {
  const all = [title, text, url].filter(Boolean).join('\n');
  const point = parseCoordinates(all);
  // Links on their own line: a one-line text field glues "Stasiun Tebet" and the link together.
  const raw = all.replace(/https?:\/\/\S+/g, '\n').split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const lines = raw.filter((l) => !PIN_LABEL.test(l));
  const name = lines[0] || '';
  if (point) return { point, name };
  // A short link, when there is one, points at the exact spot: better than searching the name.
  const link = shortMapsLink(all);
  const withLink = (o) => (link ? { ...o, link } : o);
  // "Near …" only means a nameless pin when Google also said it was a pin, or gave no address
  // line: a real place can be called "Sekitar Kita Coffee".
  const near = name.match(/^(near|dekat|di dekat|sekitar)\s+(.+)/i);
  if (near && (lines.length < raw.length || lines.length === 1)) return withLink({ query: near[2], address: lines[1] || '', approx: true });
  if (name) return withLink({ query: name, address: lines[1] || '' });
  if (link) return { needsCoords: true, raw: all.trim(), link };
  return null;
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
