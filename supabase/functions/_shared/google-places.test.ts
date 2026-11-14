import { describe, expect, it, vi } from 'vitest';
import { normalizePlace, searchGooglePlaces } from './google-places.ts';

const place = {
  id: 'ChIJ-test-1',
  displayName: { text: 'Glow Studio' },
  formattedAddress: '1 Main St, Brooklyn, NY 11201, USA',
  websiteUri: 'https://glow.example',
  googleMapsUri: 'https://maps.google.com/?cid=1',
  rating: 4.7,
  userRatingCount: 213,
  priceLevel: 'PRICE_LEVEL_MODERATE',
  location: { latitude: 40.69, longitude: -73.99 },
};

describe('Google Places discovery', () => {
  it('normalizes a Places result and maps price level to a tier', () => {
    expect(normalizePlace(place)).toEqual({
      placeId: 'ChIJ-test-1', name: 'Glow Studio', address: '1 Main St, Brooklyn, NY 11201, USA', website: 'https://glow.example',
      mapsUrl: 'https://maps.google.com/?cid=1', rating: 4.7, reviewCount: 213, priceTier: 2, lat: 40.69, lng: -73.99,
    });
  });

  it('drops results without an id or name and leaves unknown price levels empty', () => {
    expect(normalizePlace({ displayName: { text: 'No id' } })).toBeNull();
    expect(normalizePlace({ id: 'x' })).toBeNull();
    expect(normalizePlace({ id: 'x', displayName: { text: 'Unpriced' }, priceLevel: 'PRICE_LEVEL_UNSPECIFIED' })?.priceTier).toBeNull();
  });

  it('makes no network call and invents nothing when the key is not set', async () => {
    const fetchImpl = vi.fn();
    await expect(searchGooglePlaces('hair salon in Brooklyn', { apiKey: undefined, fetchImpl: fetchImpl as unknown as typeof fetch }))
      .resolves.toEqual({ configured: false, results: [] });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends the key and field mask, then returns normalized candidates', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ places: [place, { id: '' }] }), { status: 200 })));
    const result = await searchGooglePlaces('hair salon in Brooklyn', { apiKey: 'test-key', maxResults: 50, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result.configured).toBe(true);
    expect(result.results.map((item) => item.name)).toEqual(['Glow Studio']);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://places.googleapis.com/v1/places:searchText');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('test-key');
    expect((init.headers as Record<string, string>)['x-goog-fieldmask']).toContain('places.priceLevel');
    expect(JSON.parse(String(init.body))).toMatchObject({ textQuery: 'hair salon in Brooklyn', maxResultCount: 20 });
  });

  it('throws a status-coded error on HTTP failure so the caller can log it', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response('denied', { status: 403 })));
    await expect(searchGooglePlaces('q', { apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toThrow('GOOGLE_PLACES_HTTP_403');
  });
});
