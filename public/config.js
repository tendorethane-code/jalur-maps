// Google Maps Platform settings for Jalur.
// This is a browser key: it is meant to be public and is locked down in Google Cloud to
// - websites: https://tendorethane-code.github.io/* and http://localhost:5173/*
// - APIs: Maps JavaScript API and Places API (New)
// so it does nothing from any other site. Leave apiKey empty to run on OpenStreetMap only.
export const GOOGLE = {
  apiKey: 'AIzaSyAp_cgcehoGgXoF62QqstBcdjsy28jI59E',
  mapId: '8fe3e72cf3d2a732c29a936c',
};

// Jalur's own link resolver (resolver/worker.js, deployed by hand in the owner's Cloudflare account
// as `jalur-resolver`): opens Google Maps short
// links (maps.app.goo.gl/…) that a web page can't open itself. Empty = off: Jalur then asks the
// rider to paste coordinates instead.
export const RESOLVER = 'https://jalur-resolver.tendo-rethane.workers.dev/';
