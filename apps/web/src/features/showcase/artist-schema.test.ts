import { describe, expect, it } from 'vitest';
import type { PublicArtist } from './PublicArtistPage';
import { artistSchema } from './artist-schema';

const artist = {
  profile: {
    display_name: 'Maya Cole', handle: 'maya-cole', specialties: ['Color', 'Braids'], bio: 'Color and braids in Atlanta.',
    preferred_locale: 'en-US', search_index_enabled: true, photo_urls: { profile: { '512': 'https://cdn.example/p.jpg' } },
    contact_phone: '+1 404 555 0123', contact_email: 'maya@example.com', website_url: 'https://mayacole.example',
    social_links: { instagram: 'https://instagram.com/mayacole' },
  },
  services: [{ id: 's1', name: 'Silk press', category: 'Styling', duration_minutes: 90, base_price_minor: 9500 }],
  locations: [{ id: 'l1', name: 'Studio 9 Suites', booking_mode: 'instant', time_zone: 'America/New_York', address: { street: '1 Main St', city: 'Atlanta', state: 'GA', postal_code: '30309' } }],
  looks: [], bookable: true,
} as unknown as PublicArtist;

describe('artistSchema', () => {
  it('describes the stylist from published profile data', () => {
    const schema = artistSchema({ artist, publicBaseUrl: 'https://mova-beauty.co/', locale: 'en-US' });
    expect(schema['@type']).toBe('HairSalon');
    expect(schema['@id']).toBe('https://mova-beauty.co/a/maya-cole#business');
    expect(schema.telephone).toBe('+1 404 555 0123');
    expect(schema.email).toBe('maya@example.com');
    expect(schema.address).toMatchObject({ '@type': 'PostalAddress', streetAddress: '1 Main St', addressLocality: 'Atlanta', addressRegion: 'GA', postalCode: '30309' });
    expect(schema.sameAs).toEqual(['https://mayacole.example', 'https://instagram.com/mayacole']);
    expect(schema.hasOfferCatalog?.itemListElement[0]).toMatchObject({ price: '95.00', priceCurrency: 'USD', itemOffered: { name: 'Silk press' } });
  });

  it('leaves out optional fields that are empty', () => {
    const bare = { ...artist, profile: { ...artist.profile, website_url: null, social_links: {}, photo_urls: {} }, services: [], locations: [] } as unknown as PublicArtist;
    const schema = artistSchema({ artist: bare, publicBaseUrl: 'https://mova-beauty.co', locale: 'es-US' });
    expect(schema).not.toHaveProperty('sameAs');
    expect(schema).not.toHaveProperty('hasOfferCatalog');
    expect(schema).not.toHaveProperty('address');
    expect(schema).not.toHaveProperty('image');
    expect(schema.founder).toMatchObject({ jobTitle: 'Estilista de cabello' });
  });
});
