// Google Places (New) competitor discovery for PricePilot.
//
// GOOGLE PLACES CONNECTION (pending): the function reads the key from the MOVA_GOOGLE_PLACES_API_KEY
// secret. Enable "Places API (New)" on that key's Google Cloud project. Until the secret is set,
// searchGooglePlaces() returns { configured: false, results: [] } and makes no network call, so
// no competitor is ever invented. Google provides profiles (name, address, website, rating,
// price level), not service prices; prices still come from verified menus.

export type PlaceCandidate = {
  placeId: string;
  name: string;
  address: string;
  website: string;
  mapsUrl: string;
  rating: number | null;
  reviewCount: number | null;
  /** Google's price level mapped to 1 ($) through 4 ($$$$), or null when not provided. */
  priceTier: 1 | 2 | 3 | 4 | null;
  lat: number | null;
  lng: number | null;
};

export type PlacesSearchResult = { configured: boolean; results: PlaceCandidate[] };

const ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';
const FIELD_MASK = [
  'places.id', 'places.displayName', 'places.formattedAddress', 'places.websiteUri', 'places.googleMapsUri',
  'places.rating', 'places.userRatingCount', 'places.priceLevel', 'places.location',
].join(',');

const PRICE_TIERS: Record<string, 1 | 2 | 3 | 4> = {
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

type RawPlace = {
  id?: unknown;
  displayName?: { text?: unknown };
  formattedAddress?: unknown;
  websiteUri?: unknown;
  googleMapsUri?: unknown;
  rating?: unknown;
  userRatingCount?: unknown;
  priceLevel?: unknown;
  location?: { latitude?: unknown; longitude?: unknown };
};

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const finiteOrNull = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** Converts one Places (New) result into the candidate shape. Pure, so it can be tested without a network. */
export function normalizePlace(raw: RawPlace): PlaceCandidate | null {
  const placeId = text(raw.id);
  const name = text(raw.displayName?.text);
  if (!placeId || !name) return null;
  return {
    placeId,
    name,
    address: text(raw.formattedAddress),
    website: text(raw.websiteUri),
    mapsUrl: text(raw.googleMapsUri),
    rating: finiteOrNull(raw.rating),
    reviewCount: finiteOrNull(raw.userRatingCount),
    priceTier: typeof raw.priceLevel === 'string' ? PRICE_TIERS[raw.priceLevel] ?? null : null,
    lat: finiteOrNull(raw.location?.latitude),
    lng: finiteOrNull(raw.location?.longitude),
  };
}

/**
 * Searches Google Places for businesses matching a text query, such as "hair salon in Brooklyn, NY".
 * Pass the key explicitly (the function passes MOVA_GOOGLE_PLACES_API_KEY). Throws on HTTP errors so
 * the caller can log them without failing the whole discovery request.
 */
export async function searchGooglePlaces(
  textQuery: string,
  options: { apiKey: string | undefined; maxResults?: number; fetchImpl?: typeof fetch; near?: { lat: number; lng: number; radiusMeters: number } },
): Promise<PlacesSearchResult> {
  const apiKey = options.apiKey?.trim();
  if (!apiKey) return { configured: false, results: [] };
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey, 'x-goog-fieldmask': FIELD_MASK },
    body: JSON.stringify({
      textQuery, maxResultCount: Math.min(20, Math.max(1, options.maxResults ?? 10)), languageCode: 'en-US',
      ...(options.near ? { locationBias: { circle: { center: { latitude: options.near.lat, longitude: options.near.lng }, radius: Math.min(50000, Math.max(100, options.near.radiusMeters)) } } } : {}),
    }),
  });
  if (!response.ok) throw new Error(`GOOGLE_PLACES_HTTP_${response.status}`);
  const payload = (await response.json()) as { places?: RawPlace[] };
  const results = (payload.places ?? []).map(normalizePlace).filter((item): item is PlaceCandidate => item !== null);
  return { configured: true, results };
}

/**
 * Live ratings for known places (PP2 "Reviews at nearby salons", PP5 stars). Ratings are read when the
 * screen opens and never stored (Google Maps Platform terms); only place IDs are kept. Unknown places are skipped.
 */
export async function placeRatings(
  placeIds: string[],
  options: { apiKey: string | undefined; fetchImpl?: typeof fetch },
): Promise<Map<string, { rating: number | null; reviewCount: number | null }>> {
  const out = new Map<string, { rating: number | null; reviewCount: number | null }>();
  const apiKey = options.apiKey?.trim();
  if (!apiKey) return out;
  const fetchImpl = options.fetchImpl ?? fetch;
  await Promise.all([...new Set(placeIds)].slice(0, 12).map(async (id) => {
    try {
      const response = await fetchImpl(`https://places.googleapis.com/v1/places/${encodeURIComponent(id)}`, {
        headers: { 'x-goog-api-key': apiKey, 'x-goog-fieldmask': 'id,rating,userRatingCount' }, signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) return;
      const raw = (await response.json()) as RawPlace;
      out.set(id, { rating: finiteOrNull(raw.rating), reviewCount: finiteOrNull(raw.userRatingCount) });
    } catch { /* a missing rating only hides the line */ }
  }));
  return out;
}
