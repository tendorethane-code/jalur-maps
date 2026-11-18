// Jalur UI: pick start + destination, compare motorbike routes by road size, preview the
// tricky junctions up close, then open the chosen route in Google Maps.
// All route maths lives in lib/route-analysis.js; network calls in lib/api.js.
import { findRoutes, searchPlaces, searchPlacesDeep, reverse } from './lib/api.js';
import { parseShared, parseCoordinates, formatDistance } from './lib/search.js';
import { prosCons, googleMapsUrl, formatKm } from './lib/route-analysis.js';
import { createMap, useFallbackMap, useGoogleMap } from './lib/map.js';
import { googleSuggest, googleResolve } from './lib/google-places.js';
import { GOOGLE } from './config.js';
const $ = (id) => document.getElementById(id);
const els = {
  search: $('search'), from: $('from'), to: $('to'), locate: $('locate'), swap: $('swap'),
  suggestions: $('suggestions'), sheet: $('sheet'), grab: $('sheet-grab'), body: $('sheet-body'), cta: $('sheet-cta'),
  pickBanner: $('pick-banner'), pickText: $('pick-text'), pickCancel: $('pick-cancel'), preview: $('preview'),
};

const state = {
  from: null, // { point: [lat, lon], main, sub, gps?: true }
  to: null,
  routes: [],
  selected: 0,
  activeField: null, // 'from' | 'to' while typing
  picking: null, // 'from' | 'to' while choosing on the map
  previewAt: null, // junction index while previewing
  gps: null, // last GPS fix, used to rank nearby search results first
  routeAbort: null,
  routeError: null,
  loading: false,
};

/* ---------- helpers ---------- */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const isWide = () => window.matchMedia('(min-width: 900px)').matches;
const store = {
  get(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ } },
};
function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/* ---------- icons ---------- */
const svg = (d, size = 18, extra = '') => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" ${extra}>${d}</svg>`;
const stroke = (d) => `<path d="${d}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`;
const ICON = {
  gps: svg('<circle cx="12" cy="12" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="2.6" fill="currentColor"/>'),
  map: svg(stroke('M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zm0 0v14m6-12v14')),
  search: svg('<circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2.2"/>' + stroke('m16 16 4.5 4.5')),
  recent: svg('<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2"/>' + stroke('M12 7.5V12l3 2')),
  place: svg('<path d="M12 2.5a6.5 6.5 0 0 0-6.5 6.5c0 4.6 6.5 12.5 6.5 12.5S18.5 13.6 18.5 9A6.5 6.5 0 0 0 12 2.5z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="9" r="2.3" fill="currentColor"/>'),
  bolt: svg('<path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12z" fill="currentColor"/>', 13),
  ruler: svg(stroke('M4 15 15 4l5 5L9 20zM8 11l2 2m1-5 2 2m1-5 2 2'), 13),
  road: svg(stroke('M8 3 5 21M16 3l3 18M12 4v3m0 4v3m0 4v2'), 13),
  alley: svg(stroke('M5 21v-6l5-3V7l4-4m-4 9 6 3v6'), 13),
  fork: svg(stroke('M12 21v-7m0 0L6 6m6 8 6-8M6 6V3m0 3h3m9 0V3m0 3h-3'), 13),
  plus: svg(stroke('M12 6v12M6 12h12'), 13),
  minus: svg(stroke('M6 12h12'), 13),
  chevron: svg(stroke('m9 6 6 6-6 6'), 18),
  close: svg(stroke('M6 6l12 12M18 6 6 18'), 16),
  prev: svg(stroke('m15 6-6 6 6 6'), 16),
  next: svg(stroke('m9 6 6 6-6 6'), 16),
  go: svg('<path d="M3 11.5 21 3l-8.5 18-2-7.5z" fill="currentColor"/>', 18),
};
// Junction arrows: one arrow rotated by side, plus special shapes for U-turn and roundabout.
function junctionIcon(side, size = 18) {
  if (side === 'putar') return svg(stroke('M8 20V9a4 4 0 0 1 8 0v4m-3.5-3L16 13.5 19.5 10'), size);
  if (side === 'bundaran') return svg('<circle cx="12" cy="13" r="4.5" fill="none" stroke="currentColor" stroke-width="2.2"/>' + stroke('M12 8.5V3m-3 3 3-3 3 3M12 17.5V22'), size);
  const rot = { kanan: 40, kiri: -40, lurus: 0, gabung: 0 }[side] ?? 0;
  return svg(stroke('M12 21V8m-5 4.5L12 7l5 5.5'), size, `style="transform:rotate(${rot}deg)"`);
}

/* ---------- map ---------- */
const JAKARTA = [-6.2, 106.83];
const map = await createMap($('map'), { center: JAKARTA, zoom: 12, apiKey: GOOGLE.apiKey, mapId: GOOGLE.mapId, wide: isWide() });
document.body.dataset.map = map.kind;
// Google search only on the Google map (Google's rules), and only until it fails once.
let googleSearch = map.kind === 'google';

// A blank grey Google map (no tiles after 12 s): offer the OSM map instead of leaving the rider stuck.
map.onNoTiles?.(() => {
  const bar = document.createElement('div');
  bar.className = 'map-notice';
  bar.innerHTML = '<span>Peta Google belum muncul?</span><button type="button">Pakai peta cadangan</button>';
  bar.querySelector('button').addEventListener('click', () => useFallbackMap(6));
  document.body.append(bar);
});

const dark = window.matchMedia('(prefers-color-scheme: dark)');
dark.addEventListener('change', () => { drawMarkers(); drawRoutes(false); });

const routeLayer = map.layer();
const labelLayer = map.layer();
const markerLayer = map.layer();
const previewLayer = map.layer();

function drawMarkers() {
  markerLayer.clear();
  if (state.from) {
    markerLayer.html(state.from.point, `<div class="m-from${state.from.gps ? ' gps' : ''}"></div>`, { zIndex: 50 });
  }
  if (state.to) {
    markerLayer.html(state.to.point, `<div class="m-to"><svg viewBox="0 0 30 36" width="30" height="36"><path d="M15 1C7.3 1 2 6.6 2 13.6 2 23 15 35 15 35s13-12 13-21.4C28 6.6 22.7 1 15 1z" fill="${css('--to')}" stroke="#fff" stroke-width="2"/><rect x="10" y="8.5" width="10" height="10" rx="2.5" fill="#fff"/></svg></div>`, { zIndex: 60 });
  }
}

function drawRoutes(fit = true) {
  routeLayer.clear();
  labelLayer.clear();
  if (!state.routes.length) return;
  const colors = { gede: css('--gede'), sedang: css('--sedang'), kecil: css('--kecil') };
  const casing = css('--casing');
  state.routes.forEach((r, i) => {
    if (i === state.selected) return;
    routeLayer.polyline(r.shape, { color: casing, weight: 9, opacity: 0.9, zIndex: 1 });
    routeLayer.polyline(r.shape, { color: css('--other'), weight: 5, opacity: 0.95, zIndex: 2, onClick: () => select(i) });
  });
  const sel = state.routes[state.selected];
  routeLayer.polyline(sel.shape, { color: casing, weight: 11, zIndex: 3 });
  for (const s of sel.stretches) {
    routeLayer.polyline(sel.shape.slice(s.from, s.to + 1), { color: colors[s.group], weight: 6.5, zIndex: 4 });
  }
  // Junction dots on the selected route: tap one to preview it.
  sel.junctions.forEach((j, k) => {
    labelLayer.html(j.point, `<div class="m-junction" title="${esc(j.text)}"></div>`, { zIndex: 100, onClick: () => openPreview(k) });
  });
  // Time bubbles: one per route, on a stretch only that route uses.
  state.routes.forEach((r, i) => {
    const html = `<div class="bubble${i === state.selected ? ' sel' : ''}">${r.minutes} mnt<i>${formatKm(r.km)}</i></div>`;
    labelLayer.html(r.labelAt, html, { zIndex: i === state.selected ? 1000 : 500, onClick: () => select(i) });
  });
  if (fit) fitRoute(sel);
}

function fitRoute(route) {
  const top = els.search.getBoundingClientRect().bottom + 16;
  const bottom = isWide() ? 24 : els.sheet.getBoundingClientRect().height + 16;
  map.fitPoints(route.shape, {
    top: isWide() ? 24 : top, left: isWide() ? 430 : 28, right: isWide() ? 40 : 28, bottom,
  });
}

/* ---------- places ---------- */
// The current trip survives a reload (switching map engine reloads the page).
const session = {
  get() { try { return JSON.parse(sessionStorage.getItem('jalur.trip')) || {}; } catch { return {}; } },
  save() {
    const pick = (p) => p && { point: p.point, main: p.main, sub: p.sub, gps: !!p.gps };
    try { sessionStorage.setItem('jalur.trip', JSON.stringify({ from: pick(state.from), to: pick(state.to) })); } catch { /* ignore */ }
  },
};

function setPlace(field, place) {
  state[field] = place;
  els[field].value = place ? place.main : '';
  session.save();
  drawMarkers();
  if (field === 'to' && place) rememberRecent(place);
  maybeRoute();
}

function rememberRecent(place) {
  const list = store.get('jalur.recent', []).filter((p) => p.main !== place.main);
  list.unshift({ main: place.main, sub: place.sub, point: place.point });
  store.set('jalur.recent', list.slice(0, 6));
}

function locate({ quiet = false } = {}) {
  if (!navigator.geolocation) { if (!quiet) alert('HP ini gak dukung lokasi.'); return; }
  els.locate.classList.add('busy');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      els.locate.classList.remove('busy');
      const point = [pos.coords.latitude, pos.coords.longitude];
      state.gps = point;
      setPlace('from', { point, main: 'Lokasi kamu', sub: '', gps: true });
      if (!state.to) map.setView(point, 15);
    },
    (err) => {
      els.locate.classList.remove('busy');
      if (quiet) return;
      alert(err.code === 1
        ? 'Izin lokasi ditolak. Nyalain izin lokasi buat situs ini di pengaturan browser, atau ketik titik awalnya.'
        : 'Lokasi belum ketemu. Coba lagi di tempat terbuka, atau ketik titik awalnya.');
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
  );
}

/* ---------- suggestions ---------- */
let searchAbort = null;
let suggestionItems = [];

function placeRow(it, attrs) {
  return `<button type="button" ${attrs}>
      <span class="s-icon${it.accent ? ' accent' : ''}">${it.icon || ICON.place}</span>
      <span class="s-text"><span class="s-main">${esc(it.main)}</span>${it.sub || it.km != null ? `<span class="s-sub">${esc([it.sub, formatDistance(it.km)].filter(Boolean).join(' · '))}</span>` : ''}</span>
    </button>`;
}

function showSuggestions(items, note) {
  suggestionItems = items;
  els.suggestions.classList.remove('stale');
  els.suggestions.innerHTML = items.map((it, i) => `<li>${placeRow(it, `role="option" data-i="${i}"`)}</li>`).join('')
    + (note ? `<li class="s-note">${esc(note)}</li>` : '');
  els.suggestions.hidden = !items.length && !note;
}

function baseSuggestions(field) {
  const items = [];
  if (field === 'from') items.push({ icon: ICON.gps, accent: true, main: 'Lokasi kamu', sub: 'Pakai GPS', action: 'gps' });
  items.push({ icon: ICON.map, accent: true, main: 'Pilih di peta', sub: 'Ketuk titiknya di peta', action: 'pick' });
  for (const p of store.get('jalur.recent', [])) items.push({ icon: ICON.recent, ...p });
  return items;
}

// Rows that always sit under the results: a slower thorough search, and pick on map.
function actionRows(q, { deep = true } = {}) {
  const rows = [];
  if (deep && !googleSearch && q.length >= 3) rows.push({ icon: ICON.search, accent: true, main: 'Cari lebih teliti', sub: 'Bagus buat alamat lengkap, agak lama', action: 'deep', query: q });
  rows.push({ icon: ICON.map, accent: true, main: 'Pilih di peta', sub: 'Ketuk titiknya di peta', action: 'pick' });
  return rows;
}

function nearPoint() {
  return state.gps || state.from?.point || state.to?.point || map.getCenter();
}

const runSearch = debounce(async (field, q) => {
  searchAbort?.abort();
  searchAbort = new AbortController();
  try {
    const signal = searchAbort.signal;
    let results;
    if (googleSearch && !parseCoordinates(q)) {
      try {
        results = await googleSuggest(q, nearPoint());
      } catch (err) {
        console.warn('Google search failed, using OpenStreetMap search:', err);
        googleSearch = false; // quota, key or network: stop trying for this visit
      }
    }
    results ||= await searchPlaces(q, nearPoint(), signal);
    if (signal.aborted || state.activeField !== field || els[field].value.trim() !== q) return;
    showSuggestions([...results, ...actionRows(q)], results.length ? '' : 'Gak ketemu di pencarian cepat. Coba "Cari lebih teliti", atau pilih di peta.');
  } catch (err) {
    if (err.name !== 'AbortError' && state.activeField === field) showSuggestions(actionRows(q), 'Pencarian lagi gak bisa. Coba lagi bentar.');
  }
}, 200);

async function runDeepSearch(field, q) {
  searchAbort?.abort();
  searchAbort = new AbortController();
  showSuggestions([], 'Nyari lebih teliti…');
  try {
    const results = await searchPlacesDeep(q, nearPoint(), searchAbort.signal);
    if (state.activeField !== field) return;
    showSuggestions([...results, ...actionRows(q, { deep: false })],
      results.length ? '' : 'Tetap gak ketemu. Data alamat di OpenStreetMap memang belum lengkap: pilih di peta, atau share lokasinya dari Google Maps ke Jalur.');
  } catch (err) {
    if (err.name !== 'AbortError' && state.activeField === field) showSuggestions(actionRows(q, { deep: false }), 'Pencarian teliti lagi gak bisa. Coba lagi bentar.');
  }
}

function onInput(field) {
  const q = els[field].value.trim();
  if (q.length < 3) { searchAbort?.abort(); showSuggestions(baseSuggestions(field)); return; }
  // Keep showing the previous results while the new ones load, like Google Maps does.
  if (!suggestionItems.some((s) => !s.action)) showSuggestions(actionRows(q), 'Nyari…');
  else els.suggestions.classList.add('stale'); // old results stay visible but faded until new ones land
  runSearch(field, q);
}

function closeSuggestions() {
  state.activeField = null;
  els.suggestions.hidden = true;
  for (const f of ['from', 'to']) els[f].value = state[f]?.main || '';
}

function chooseSuggestion(i) {
  const field = state.activeField;
  const it = suggestionItems[i];
  if (!field || !it) return;
  if (it.action === 'deep') return runDeepSearch(field, it.query);
  closeSuggestions();
  document.activeElement?.blur();
  if (it.action === 'gps') return locate();
  if (it.action === 'pick') return startPicking(field);
  if (it.prediction) return chooseGooglePlace(field, it);
  setPlace(field, { point: it.point, main: it.main, sub: it.sub });
}

async function chooseGooglePlace(field, it) {
  els[field].value = it.main;
  try {
    const point = await googleResolve(it);
    setPlace(field, { point, main: it.main, sub: it.sub });
  } catch (err) {
    console.warn('Google place lookup failed:', err);
    els[field].value = state[field]?.main || '';
    alert('Lokasi tempat itu gak bisa diambil dari Google. Coba lagi, atau pilih di peta.');
  }
}

for (const field of ['from', 'to']) {
  els[field].addEventListener('focus', () => { closePreview(); state.activeField = field; els[field].select(); onInput(field); });
  els[field].addEventListener('input', () => onInput(field));
  els[field].addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && suggestionItems.length) {
      const firstPlace = suggestionItems.findIndex((s) => !s.action);
      chooseSuggestion(firstPlace >= 0 ? firstPlace : 0);
    }
    if (e.key === 'Escape') { closeSuggestions(); els[field].blur(); }
  });
}
// pointerdown (not click) so the input's blur doesn't close the list first.
els.suggestions.addEventListener('pointerdown', (e) => {
  const b = e.target.closest('button[data-i]');
  if (!b) return;
  e.preventDefault();
  // Stop here: choosing can replace the list, and the document handler below would then see
  // a detached target, think the tap was outside the search card, and close everything.
  e.stopPropagation();
  swallowNextClick();
  chooseSuggestion(Number(b.dataset.i));
});

// We act on pointerdown, so the list is gone before the finger lifts. The browser then sends
// the tap's click to whatever moved under the finger. On the owner's phone that was the
// "Pakai peta cadangan" button, which silently switched maps. Eat that one click.
function swallowNextClick() {
  const eat = (ev) => { ev.preventDefault(); ev.stopPropagation(); };
  document.addEventListener('click', eat, { capture: true, once: true });
  setTimeout(() => document.removeEventListener('click', eat, { capture: true }), 700);
}
els.suggestions.addEventListener('keydown', (e) => {
  const b = e.target.closest('button[data-i]');
  if (b && e.key === 'Enter') { e.preventDefault(); chooseSuggestion(Number(b.dataset.i)); }
});
document.addEventListener('pointerdown', (e) => {
  if (state.activeField && e.target.isConnected && !els.search.contains(e.target)) closeSuggestions();
});

els.locate.addEventListener('click', () => locate());
els.swap.addEventListener('click', () => {
  [state.from, state.to] = [state.to, state.from];
  els.from.value = state.from?.main || '';
  els.to.value = state.to?.main || '';
  drawMarkers();
  maybeRoute();
});

/* ---------- pick on map ---------- */
function startPicking(field) {
  closePreview();
  state.picking = field;
  els.pickText.textContent = field === 'from' ? 'Ketuk peta buat titik awal' : 'Ketuk peta buat tujuan';
  els.pickBanner.hidden = false;
  document.body.classList.add('picking');
}
function stopPicking() {
  state.picking = null;
  els.pickBanner.hidden = true;
  document.body.classList.remove('picking');
}
els.pickCancel.addEventListener('click', stopPicking);

async function placeAt(field, point) {
  setPlace(field, { point, main: 'Titik di peta', sub: '' });
  const name = await reverse(point);
  if (name && state[field]?.point === point) {
    Object.assign(state[field], name);
    els[field].value = name.main;
    session.save();
    if (field === 'to') rememberRecent(state[field]);
    if (state.routes.length) renderDetail();
  }
}

map.onClick((point) => {
  if (!state.picking) return;
  const field = state.picking;
  stopPicking();
  placeAt(field, point);
});
// Long-press (or right-click) anywhere sets the destination.
map.onLongPress((point) => { swallowNextClick(); stopPicking(); closePreview(); placeAt('to', point); });

/* ---------- routing ---------- */
function maybeRoute() {
  state.routeAbort?.abort();
  closePreview();
  state.routes = [];
  state.routeError = null;
  routeLayer.clear();
  labelLayer.clear();
  if (!state.from || !state.to) { state.loading = false; render(); return; }
  computeRoutes();
}

async function computeRoutes() {
  const ctrl = new AbortController();
  state.routeAbort = ctrl;
  state.loading = true;
  state.routeError = null;
  render();
  try {
    const routes = await findRoutes(state.from.point, state.to.point, { signal: ctrl.signal });
    if (ctrl.signal.aborted) return;
    state.routes = routes;
    state.selected = 0;
    state.loading = false;
    if (els.sheet.dataset.size === 'peek') setSheet('half');
    render();
    drawRoutes();
  } catch (err) {
    if (err.name === 'AbortError') return;
    state.loading = false;
    state.routeError = err.message || 'Ada yang error.';
    render();
  }
}

function select(i, { scroll = true } = {}) {
  if (i === state.selected || !state.routes[i]) return;
  state.selected = i;
  closePreview();
  els.body.querySelectorAll('.rcard').forEach((c, k) => {
    c.classList.toggle('sel', k === i);
    c.setAttribute('aria-pressed', String(k === i));
  });
  if (scroll) els.body.querySelectorAll('.rcard')[i]?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  renderDetail();
  drawRoutes(false);
}

/* ---------- sheet content ---------- */
const TAGS = {
  tercepat: ['Tercepat*', '', ICON.bolt],
  terpendek: ['Terpendek', '', ICON.ruler],
  'jalan gede': ['Jalan gede', 'gede', ICON.road],
  'banyak gang': ['Banyak gang', 'gang', ICON.alley],
  alternatif: ['Alternatif', 'plain', ICON.fork],
};

function routeCard(r, i) {
  const t = TAGS[r.tags[0] || 'alternatif'];
  const main = [...r.streets].filter((s) => !s.name.startsWith('(')).sort((a, b) => b.km - a.km)[0];
  const bar = ['gede', 'sedang', 'kecil'].filter((g) => r.pct[g] > 0).map((g) => `<span class="${g}" style="width:${r.pct[g]}%"></span>`).join('');
  return `<button type="button" class="rcard${i === state.selected ? ' sel' : ''}" data-i="${i}" aria-pressed="${i === state.selected}">
    <span class="tag ${t[1]}">${t[2]}${t[0]}</span>
    <span class="rtime">${r.minutes}<small>mnt · ${formatKm(r.km)}</small></span>
    <span class="bar" aria-label="${r.pct.gede}% jalan gede, ${r.pct.sedang}% sedang, ${r.pct.kecil}% kecil">${bar}</span>
    <span class="rvia">${main ? `via <b>${esc(main.name)}</b>` : '&nbsp;'}</span>
  </button>`;
}

function detailHtml(r) {
  const { plus, minus } = prosCons(r, state.routes);
  const extraTags = r.tags.slice(1).map((k) => TAGS[k]).filter(Boolean)
    .map(([label, cls, icon]) => `<span class="tag ${cls}">${icon}${label}</span>`).join(' ');
  const pm = [...plus.map((t) => ['plus', t]), ...minus.map((t) => ['minus', t])]
    .map(([k, t]) => `<li class="${k}"><span class="ic">${ICON[k]}</span><span>${esc(t)}</span></li>`).join('');
  const junctions = r.junctions.length
    ? `<ul class="junctions">${r.junctions.map((j, k) => `<li><button type="button" data-j="${k}">
        <span class="j-ic">${junctionIcon(j.side)}</span>
        <span class="j-text"><b>${esc(j.text)}</b><span>setelah ${formatKm(j.km)}${j.notes.map((n) => `<span class="j-note">${esc(n)}</span>`).join('')}</span></span>
        <span class="j-go">${ICON.chevron}</span></button></li>`).join('')}</ul>`
    : '<p class="j-empty">Gak ada percabangan yang rawan salah ambil. Belokannya jelas semua.</p>';
  const streets = r.streets.filter((s) => !s.name.startsWith('(') || s.km >= 0.4);
  const timeline = `<ul class="timeline">
      <li class="start"><span class="t-name">${esc(state.from.main)}</span></li>
      ${streets.map((s) => `<li style="--c:var(--${s.group})"><span class="t-name">${esc(s.name)}</span><span class="t-km">${formatKm(s.km)}</span></li>`).join('')}
      <li class="end"><span class="t-name">${esc(state.to.main)}</span></li>
    </ul>`;
  return `
    <div class="stats">
      <div class="stat gede"><b>${r.pct.gede}%</b><span>gede</span></div>
      <div class="stat sedang"><b>${r.pct.sedang}%</b><span>sedang</span></div>
      <div class="stat kecil"><b>${r.pct.kecil}%</b><span>kecil</span></div>
    </div>
    ${extraTags ? `<div style="margin-top:10px">${extraTags}</div>` : ''}
    <div class="section-label">Plus-minus</div>
    <ul class="pm">${pm || '<li>Gak ada catatan khusus.</li>'}</ul>
    <div class="section-label">Hati-hati di sini · ${r.junctions.length}</div>
    ${junctions}
    <div class="section-label">Lewat mana</div>
    ${timeline}
    <p class="fine">${r.turns} belokan${r.uturns ? ` · ${r.uturns}× putar balik` : ''} · *waktu belum ngitung macet. Jenis jalan dari OpenStreetMap, bisa aja ada yang salah.</p>`;
}

function renderDetail() {
  const r = state.routes[state.selected];
  const box = els.body.querySelector('.detail');
  if (!r || !box) return;
  box.innerHTML = detailHtml(r);
  const url = googleMapsUrl(state.from.gps ? null : state.from.point, state.to.point, r.waypoints);
  els.cta.innerHTML = `<a class="go" href="${esc(url)}" target="_blank" rel="noopener">${ICON.go}Mulai di Google Maps</a>
    <p class="cta-note">Rute dikirim lewat ${r.waypoints.length} titik singgah · tinggal tekan <b>Mulai</b> di sana</p>`;
  els.cta.hidden = false;
}

function legend() {
  return `<div class="legend"><span><i style="background:var(--gede)"></i>gede</span><span><i style="background:var(--sedang)"></i>sedang</span><span><i style="background:var(--kecil)"></i>kecil</span></div>`;
}

function render() {
  els.cta.hidden = true;
  if (state.loading) {
    els.body.innerHTML = `<div class="status"><span class="spinner" aria-hidden="true"></span>Lagi bandingin beberapa rute…</div>
      <div class="skeletons"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>`;
    return;
  }
  if (state.routeError) {
    els.body.innerHTML = `<div class="error-box">${esc(state.routeError)}</div><button class="retry" type="button" data-action="retry">Coba lagi</button>`;
    return;
  }
  if (state.routes.length) {
    els.body.innerHTML = `<div class="results-head"><h2>${state.routes.length} pilihan rute</h2>${legend()}</div>
      <div class="carousel" id="carousel">${state.routes.map(routeCard).join('')}</div>
      <div class="detail"></div>`;
    renderDetail();
    bindCarousel();
    return;
  }
  const recent = store.get('jalur.recent', []);
  els.body.innerHTML = `
    <div class="hello">
      <img class="hello-logo" src="icons/icon.svg" alt="">
      <div><h1>Mau ke mana?</h1><p>${state.from ? 'Isi tujuan, nanti gw bandingin rutenya.' : 'Ketuk ◎ buat pakai lokasi kamu, lalu isi tujuan.'}</p></div>
    </div>
    <div class="how">
      <div><i style="background:var(--gede)"></i><b>Jalan gede</b>Arteri & jalan raya</div>
      <div><i style="background:var(--sedang)"></i><b>Sedang</b>Jalan penghubung</div>
      <div><i style="background:var(--kecil)"></i><b>Kecil</b>Gang & jalan tikus</div>
    </div>
    ${recent.length ? `<div class="section-label">Terakhir dicari</div>
      <ul class="places">${recent.map((p, i) => `<li>${placeRow({ ...p, icon: ICON.recent }, `data-recent="${i}"`)}</li>`).join('')}</ul>` : ''}
    <p class="about">Tekan lama di peta buat pilih tujuan. ${map.kind === 'google'
      ? 'Peta & pencarian: Google. Rute & jenis jalan: Valhalla (FOSSGIS) dari data <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>.'
      : 'Lagi pakai peta cadangan (OpenStreetMap). <a href="#" data-action="google">Coba peta Google lagi</a>. Data peta © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> · rute Valhalla (FOSSGIS) · pencarian Photon.'}</p>`;
}

// Swiping the carousel selects the card that settles at the left edge.
function bindCarousel() {
  const c = $('carousel');
  if (!c) return;
  const settle = debounce(() => {
    if (isWide()) return;
    const cards = [...c.children];
    const left = c.getBoundingClientRect().left + 16;
    let best = 0, gap = Infinity;
    cards.forEach((card, i) => {
      const d = Math.abs(card.getBoundingClientRect().left - left);
      if (d < gap) { gap = d; best = i; }
    });
    // At the far right end, the last card can't reach the left edge: pick it if fully visible.
    if (c.scrollLeft + c.clientWidth >= c.scrollWidth - 4 && state.selected === cards.length - 1) return;
    if (gap < 40) select(best, { scroll: false });
  }, 140);
  c.addEventListener('scroll', settle, { passive: true });
}

els.body.addEventListener('click', (e) => {
  if (e.target.closest('[data-action="retry"]')) return computeRoutes();
  if (e.target.closest('[data-action="google"]')) { e.preventDefault(); return useGoogleMap(); }
  const recent = e.target.closest('[data-recent]');
  if (recent) {
    const p = store.get('jalur.recent', [])[Number(recent.dataset.recent)];
    if (p) setPlace('to', { ...p });
    return;
  }
  const card = e.target.closest('.rcard');
  if (card) return select(Number(card.dataset.i));
  const j = e.target.closest('[data-j]');
  if (j) openPreview(Number(j.dataset.j));
});

/* ---------- junction preview ---------- */
// Shows one tricky junction up close with a heading arrow, so you know before leaving
// whether to keep left or right. The map stays put on that spot (nothing to "lose").
function openPreview(k) {
  const r = state.routes[state.selected];
  const j = r?.junctions[k];
  if (!j) return;
  state.previewAt = k;
  document.body.classList.add('previewing');
  els.preview.hidden = false;
  els.preview.innerHTML = `
    <div class="pv-top"><span class="pv-count">Titik ${k + 1} dari ${r.junctions.length} · setelah ${formatKm(j.km)}</span>
      <button class="pv-close" type="button" data-pv="close" aria-label="Tutup">${ICON.close}</button></div>
    <div class="pv-main"><span class="j-ic">${junctionIcon(j.side, 24)}</span>
      <div><b>${esc(j.text)}</b><span>${j.notes.length ? esc(j.notes.join(' · ')) : 'Perhatiin arah panahnya di peta'}</span></div></div>
    <div class="pv-nav">
      <button type="button" data-pv="prev" ${k === 0 ? 'disabled' : ''}>${ICON.prev}Sebelumnya</button>
      <button type="button" class="primary" data-pv="next">${k === r.junctions.length - 1 ? 'Selesai' : `Berikutnya${ICON.next}`}</button>
    </div>`;
  previewLayer.clear();
  previewLayer.html(j.point, `<div class="m-arrow"><div>${svg('<path d="M12 2.5 19 10h-4.5v11h-5V10H5z" fill="currentColor"/>', 26, `style="transform:rotate(${j.bearing}deg)"`)}</div></div>`, { zIndex: 2000 });
  // Keep the junction above the preview card: the map centre sits below it by half the card.
  const card = els.preview.getBoundingClientRect().height;
  map.flyTo(j.point, 18, isWide() ? [-200, 0] : [0, card / 2]);
}

function closePreview() {
  if (state.previewAt === null) return;
  state.previewAt = null;
  els.preview.hidden = true;
  document.body.classList.remove('previewing');
  previewLayer.clear();
  const r = state.routes[state.selected];
  if (r) setTimeout(() => fitRoute(r), 300);
}

els.preview.addEventListener('click', (e) => {
  const b = e.target.closest('[data-pv]');
  if (!b) return;
  const r = state.routes[state.selected];
  if (b.dataset.pv === 'close') return closePreview();
  if (b.dataset.pv === 'prev') return openPreview(state.previewAt - 1);
  if (state.previewAt >= r.junctions.length - 1) return closePreview();
  openPreview(state.previewAt + 1);
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePreview(); });

/* ---------- sheet sizing (tap or drag the handle) ---------- */
const SIZES = ['peek', 'half', 'full'];
function setSheet(size) { els.sheet.dataset.size = size; }
let drag = null;
els.grab.addEventListener('pointerdown', (e) => {
  drag = { y: e.clientY, h: els.sheet.getBoundingClientRect().height, moved: false };
  els.grab.setPointerCapture(e.pointerId);
});
els.grab.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dy = e.clientY - drag.y;
  if (Math.abs(dy) > 4) drag.moved = true;
  if (!drag.moved) return;
  els.sheet.classList.add('dragging');
  els.sheet.style.height = `${Math.max(150, drag.h - dy)}px`;
});
els.grab.addEventListener('pointerup', () => {
  if (!drag) return;
  const { moved } = drag;
  drag = null;
  els.sheet.classList.remove('dragging');
  if (!moved) setSheet(els.sheet.dataset.size === 'half' ? 'peek' : 'half');
  else {
    const h = els.sheet.getBoundingClientRect().height / window.innerHeight;
    setSheet(h < 0.38 ? 'peek' : h < 0.72 ? 'half' : 'full');
  }
  els.sheet.style.height = '';
});
els.grab.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault();
  const i = SIZES.indexOf(els.sheet.dataset.size);
  setSheet(SIZES[(i + 1) % 3]);
});

/* ---------- start ---------- */
const syncSearchHeight = () => document.documentElement.style.setProperty('--search-h', `${els.search.offsetHeight}px`);
new ResizeObserver(syncSearchHeight).observe(els.search);
syncSearchHeight();
render();

// Put back the trip from before a reload. A GPS start is refreshed by locate() below instead.
const resumed = session.get();
if (resumed.to) { state.to = resumed.to; els.to.value = resumed.to.main; }
if (resumed.from && !resumed.from.gps) { state.from = resumed.from; els.from.value = resumed.from.main; }
drawMarkers();
if (state.from && state.to) maybeRoute();

// Opened from another app's Share menu (Android, installed app): use what was shared as the
// destination. Google Maps shares "Name\nAddress\nhttps://maps.app.goo.gl/…".
function handleShare() {
  const params = new URLSearchParams(location.search);
  if (!['title', 'text', 'url'].some((k) => params.get(k))) return;
  history.replaceState(null, '', location.pathname);
  const shared = parseShared({ title: params.get('title') || '', text: params.get('text') || '', url: params.get('url') || '' });
  if (!shared) return;
  if (shared.point) {
    placeAt('to', shared.point);
    return;
  }
  state.activeField = 'to';
  els.to.value = shared.query;
  showSuggestions(actionRows(shared.query), `Nyari "${shared.query}" dari Google Maps…`);
  runSearch('to', shared.query);
}
handleShare();

(async () => {
  // Ask for location right away unless the user already said no.
  try {
    const perm = await navigator.permissions?.query({ name: 'geolocation' });
    if (perm?.state === 'denied') return;
  } catch { /* Safari without the permissions API: just try */ }
  if (state.from) return; // the rider picked a start before the reload: keep it
  locate({ quiet: true });
})();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
