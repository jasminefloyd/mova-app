import { withSystemRequestLogging } from '../_shared/system-log.ts';
import { artistClient, corsHeaders, respond } from '../_shared/booking.ts';

const endpoint = 'https://places.googleapis.com/v1/places:autocomplete';

Deno.serve(withSystemRequestLogging('location-address-search', async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ code: 'METHOD_NOT_ALLOWED' }, 405);
  const actor = await artistClient(request);
  if (!actor) return respond({ code: 'AUTH_REQUIRED' }, 401);
  const body = await request.json().catch(() => null);
  const input = typeof body?.input === 'string' ? body.input.trim().slice(0, 200) : '';
  if (!input || input.length < 3 || body?.artist_business_id !== actor.businessId) return respond({ code: 'INVALID_REQUEST' }, 422);

  const apiKey = Deno.env.get('MOVA_GOOGLE_PLACES_API_KEY')?.trim();
  if (!apiKey) return respond({ code: 'ADDRESS_AUTOCOMPLETE_UNAVAILABLE' }, 503);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({ input, languageCode: 'en-US', includedRegionCodes: ['us'] }),
    });
    if (!response.ok) return respond({ code: 'ADDRESS_AUTOCOMPLETE_UNAVAILABLE' }, 502);
    const payload = await response.json() as { suggestions?: Array<{ placePrediction?: { placeId?: unknown; text?: { text?: unknown } } }> };
    const suggestions = (payload.suggestions ?? []).flatMap(({ placePrediction }) => {
      const placeId = placePrediction?.placeId;
      const description = placePrediction?.text?.text;
      return typeof placeId === 'string' && typeof description === 'string' ? [{ place_id: placeId, description }] : [];
    }).slice(0, 5);
    return respond({ suggestions });
  } catch {
    return respond({ code: 'ADDRESS_AUTOCOMPLETE_UNAVAILABLE' }, 502);
  }
}));
