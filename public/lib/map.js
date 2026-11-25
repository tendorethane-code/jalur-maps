// One small map interface with two engines:
// - Google Maps (normal): same map the owner knows, needed anyway because Google Places
//   results shown on a map must be shown on a Google map.
// - Leaflet + OpenStreetMap (fallback): used when Google can't load or rejects the key,
//   so Jalur keeps working (with OSM search) instead of showing a broken map.
//
// Points are always [lat, lon]. HTML markers are anchored with their top-left corner on the
// point inside a 0x0 box, so their own CSS decides the anchor (translate(-50%,-50%) = centred).

const LEAFLET = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min';

// Google Maps listens to touches on the whole document, not just the map. After a long-press
// on the map it cancelled the next touch anywhere (preventDefault on touchstart), so the first
// tap on a search field or button afterwards did nothing. Touches that start outside the map
// are Jalur's own UI: keep them away from Google's page-wide handlers. Registered on window in
// the capture phase before Google loads, so it runs first. Default actions (focus, click) and
// Jalur's own pointer/click handlers are unaffected.
for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
  window.addEventListener(type, (e) => {
    const map = document.getElementById('map');
    if (map && e.target instanceof Node && !map.contains(e.target)) e.stopImmediatePropagation();
  }, { capture: true, passive: true });
}
const NO_GOOGLE_KEY = 'jalur.noGoogleUntil';

/**
 * Long-press straight from pointer events on the map element, the same for both engines.
 * Google's own map events don't report a held finger reliably (tested: never fired on a touch
 * phone). One finger, held 550 ms without moving more than 10 px; a second finger (pinch)
 * cancels. Right-click on desktop counts too. toLatLng(x, y) gets element-relative pixels.
 */
function watchLongPress(el, toLatLng, fn) {
  let timer = null, start = null, last = 0;
  const cancel = () => { clearTimeout(timer); timer = null; start = null; };
  const fire = (x, y) => {
    if (Date.now() - last < 800) return;
    const point = toLatLng(x, y);
    if (!point) return;
    last = Date.now();
    navigator.vibrate?.(15);
    fn(point);
  };
  const local = (e) => { const r = el.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  el.addEventListener('pointerdown', (e) => {
    cancel();
    if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    start = { x: e.clientX, y: e.clientY };
    const [x, y] = local(e);
    timer = setTimeout(() => { timer = null; fire(x, y); }, 550);
  }, true);
  el.addEventListener('pointermove', (e) => {
    if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) cancel();
  }, true);
  for (const ev of ['pointerup', 'pointercancel']) el.addEventListener(ev, cancel, true);
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); cancel(); fire(...local(e)); }, true);
}

/* ---------------- Google ---------------- */

function loadGoogleScript(key) {
  return new Promise((resolve, reject) => {
    window.__jalurGoogleReady = () => resolve(window.google);
    const s = document.createElement('script');
    const p = new URLSearchParams({
      key, v: 'weekly', loading: 'async', libraries: 'places,marker',
      language: 'id', region: 'ID', callback: '__jalurGoogleReady',
    });
    s.src = `https://maps.googleapis.com/maps/api/js?${p}`;
    s.async = true;
    s.onerror = () => reject(new Error('Google Maps gak bisa dimuat'));
    document.head.append(s);
  });
}

function zeroBox(html, onClick) {
  const box = document.createElement('div');
  box.style.cssText = 'position:relative;width:0;height:0;overflow:visible';
  box.innerHTML = html;
  if (onClick) {
    box.firstElementChild?.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  }
  return box;
}

async function googleMap(el, opts) {
  const { center, zoom, apiKey, mapId, wide } = opts;
  const google = await loadGoogleScript(apiKey);
  const { Map } = await google.maps.importLibrary('maps');
  const { AdvancedMarkerElement } = await google.maps.importLibrary('marker');
  if (opts.gaveUp?.()) throw new Error('too late'); // OSM already took over this element
  const map = new Map(el, {
    center: { lat: center[0], lng: center[1] },
    zoom,
    mapId,
    disableDefaultUI: true,
    zoomControl: wide, // phones pinch-zoom; the control would sit under the bottom sheet
    zoomControlOptions: { position: google.maps.ControlPosition.RIGHT_TOP },
    gestureHandling: 'greedy', // one finger pans, like the Google Maps app
    clickableIcons: false,
    colorScheme: google.maps.ColorScheme?.FOLLOW_SYSTEM,
    // Raster: works on every phone (vector needs WebGL and silently fails without it), and we
    // don't use tilt/rotation anyway. The Map ID was made as Vector; this overrides it.
    renderingType: google.maps.RenderingType?.RASTER,
  });
  const ll = ([lat, lng]) => ({ lat, lng });
  const pt = (latLng) => [latLng.lat(), latLng.lng()];
  let tilesShown = false;
  let traffic = null;
  google.maps.event.addListenerOnce(map, 'tilesloaded', () => { tilesShown = true; });

  return {
    kind: 'google',
    google,
    /** Calls fn if the map still shows no tiles after `ms` (a blank grey map). */
    onNoTiles(fn, ms = 12000) { setTimeout(() => { if (!tilesShown) fn(); }, ms); },
    setView(point, z) { map.setCenter(ll(point)); map.setZoom(z); },
    getCenter() { return pt(map.getCenter()); },
    fitPoints(points, pad, maxZoom = 17) {
      const b = new google.maps.LatLngBounds();
      for (const p of points) b.extend(ll(p));
      map.fitBounds(b, pad);
      google.maps.event.addListenerOnce(map, 'idle', () => { if (map.getZoom() > maxZoom) map.setZoom(maxZoom); });
    },
    flyTo(point, z, [dx, dy] = [0, 0]) {
      map.setZoom(z);
      map.panTo(ll(point));
      if (dx || dy) google.maps.event.addListenerOnce(map, 'idle', () => map.panBy(dx, dy));
    },
    /** Google's live traffic colours on the roads (Google engine only; OSM has no traffic). */
    setTraffic(on) {
      if (on) { traffic ||= new google.maps.TrafficLayer(); traffic.setMap(map); } else traffic?.setMap(null);
    },
    onClick(fn) { map.addListener('click', (e) => e.latLng && fn(pt(e.latLng))); },
    onLongPress(fn) {
      // A blank overlay only to get the projection: screen pixels -> lat/lng.
      const overlay = new google.maps.OverlayView();
      overlay.onAdd = overlay.draw = overlay.onRemove = () => {};
      overlay.setMap(map);
      watchLongPress(el, (x, y) => {
        const proj = overlay.getProjection();
        return proj ? pt(proj.fromContainerPixelToLatLng(new google.maps.Point(x, y))) : null;
      }, fn);
    },
    layer() {
      let items = [];
      return {
        polyline(points, { color, weight, opacity = 1, zIndex = 1, onClick } = {}) {
          const line = new google.maps.Polyline({
            path: points.map(ll), strokeColor: color, strokeWeight: weight, strokeOpacity: opacity,
            zIndex, clickable: !!onClick, map,
          });
          if (onClick) line.addListener('click', onClick);
          items.push(line);
        },
        html(point, html, { zIndex = 1, onClick } = {}) {
          const m = new AdvancedMarkerElement({ map, position: ll(point), content: zeroBox(html, onClick), zIndex });
          items.push(m);
        },
        clear() {
          for (const it of items) { if (it.setMap) it.setMap(null); else it.map = null; }
          items = [];
        },
      };
    },
  };
}

/* ---------------- Leaflet / OpenStreetMap ---------------- */

function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  return new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = `${LEAFLET}.css`;
    document.head.append(css);
    const s = document.createElement('script');
    s.src = `${LEAFLET}.js`;
    s.onload = () => resolve(window.L);
    s.onerror = () => reject(new Error('Peta gak bisa dimuat. Cek internet kamu.'));
    document.head.append(s);
  });
}

async function leafletMap(el, { center, zoom }) {
  const L = await loadLeaflet();
  el.classList.add('osm');
  const map = L.map(el, { zoomControl: false, attributionControl: true }).setView(center, zoom);
  L.control.zoom({ position: 'topright' }).addTo(map);
  map.attributionControl.setPrefix(false);
  // Free for light personal use, no key. Dark mode recolours the tiles with a CSS filter.
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  const icon = (html) => L.divIcon({ className: '', html, iconSize: [0, 0], iconAnchor: [0, 0] });

  return {
    kind: 'osm',
    setView(point, z) { map.setView(point, z); },
    getCenter() { const c = map.getCenter(); return [c.lat, c.lng]; },
    fitPoints(points, pad, maxZoom = 17) {
      map.fitBounds(L.latLngBounds(points), {
        paddingTopLeft: [pad.left, pad.top], paddingBottomRight: [pad.right, pad.bottom], maxZoom,
      });
    },
    flyTo(point, z, [dx, dy] = [0, 0]) {
      const target = map.unproject(map.project(point, z).add([dx, dy]), z);
      map.flyTo(target, z, { duration: 0.7 });
    },
    onClick(fn) { map.on('click', (e) => fn([e.latlng.lat, e.latlng.lng])); },
    onLongPress(fn) {
      watchLongPress(el, (x, y) => { const c = map.containerPointToLatLng([x, y]); return [c.lat, c.lng]; }, fn);
    },
    layer() {
      const group = L.layerGroup().addTo(map);
      return {
        polyline(points, { color, weight, opacity = 1, onClick } = {}) {
          const line = L.polyline(points, { color, weight, opacity, lineCap: 'round', lineJoin: 'round', interactive: !!onClick });
          if (onClick) line.on('click', onClick);
          line.addTo(group);
        },
        html(point, html, { zIndex = 1, onClick } = {}) {
          const m = L.marker(point, { icon: icon(html), zIndexOffset: zIndex, keyboard: false, interactive: !!onClick });
          if (onClick) m.on('click', onClick);
          m.addTo(group);
        },
        clear() { group.clearLayers(); },
      };
    },
  };
}

/** Switch to OpenStreetMap for a while (user asked, or Google failed) and reload. */
export function useFallbackMap(hours = 6) {
  try { localStorage.setItem(NO_GOOGLE_KEY, String(Date.now() + hours * 3600 * 1000)); } catch { /* ignore */ }
  location.reload();
}

/** Go back to Google next time (clears a fallback set earlier). */
export function useGoogleMap() {
  try { localStorage.removeItem(NO_GOOGLE_KEY); } catch { /* ignore */ }
  location.reload();
}

/* ---------------- pick an engine ---------------- */

/**
 * Google when configured and not recently rejected, else OSM. If Google rejects the key
 * after loading (wrong referrer, API off, quota), it calls gm_authFailure: remember that for
 * an hour and reload into OSM mode instead of leaving a grey "Oops" map.
 */
// Both engines draw into a fresh child that fills the fixed #map box. Google sets
// `position: relative` on whatever element it gets, which turned the fixed full-screen
// #map into a 0 px tall box: the map existed but was invisible and never asked for tiles.
function freshCanvas(host) {
  host.innerHTML = '';
  const el = document.createElement('div');
  el.className = 'map-canvas';
  el.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
  host.append(el);
  return el;
}

export async function createMap(host, opts) {
  let blockedUntil = 0;
  try { blockedUntil = Number(localStorage.getItem(NO_GOOGLE_KEY) || 0); } catch { /* private mode */ }
  if (opts.apiKey && opts.mapId && Date.now() > blockedUntil) {
    window.gm_authFailure = () => useFallbackMap(1);
    let gaveUp = false;
    try {
      return await Promise.race([
        googleMap(freshCanvas(host), { ...opts, gaveUp: () => gaveUp }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Google Maps kelamaan')), 10000)),
      ]);
    } catch (err) {
      gaveUp = true;
      console.warn('Google Maps unavailable, using OpenStreetMap:', err.message);
    }
  }
  return leafletMap(freshCanvas(host), opts);
}
