// Place search with Google Places (New), the same data as the Google Maps app.
// Billing-wise one search = one "session": the autocomplete calls while typing plus one
// Place Details call with only `location` (Essentials SKU). The session token ties them.

let places = null;
let token = null;

async function lib() {
  places ||= await window.google.maps.importLibrary('places');
  return places;
}

const tidy = (s) => (s || '').replace(/,\s*Indonesia$/, '');

/** Suggestions while typing, nearest first when we know where the rider is. */
export async function googleSuggest(query, near) {
  const { AutocompleteSuggestion, AutocompleteSessionToken } = await lib();
  token ||= new AutocompleteSessionToken();
  const request = { input: query, sessionToken: token, language: 'id', region: 'id', includedRegionCodes: ['id'] };
  if (near) {
    const center = { lat: near[0], lng: near[1] };
    request.locationBias = { center, radius: 50000 };
    request.origin = center;
  }
  const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions(request);
  return suggestions
    .filter((s) => s.placePrediction)
    .slice(0, 6)
    .map(({ placePrediction: p }) => ({
      main: p.mainText?.text || p.text.text,
      sub: tidy(p.secondaryText?.text),
      km: p.distanceMeters != null ? p.distanceMeters / 1000 : null,
      prediction: p,
    }));
}

/** Coordinates of a chosen suggestion. Ends the billing session. */
export async function googleResolve(item) {
  const place = item.prediction.toPlace();
  await place.fetchFields({ fields: ['location'] });
  token = null;
  return [place.location.lat(), place.location.lng()];
}
