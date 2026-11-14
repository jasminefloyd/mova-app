import type { PublicArtist } from './PublicArtistPage';

type ArtistSchemaInput = {
  artist: PublicArtist;
  publicBaseUrl: string;
  locale: 'en-US' | 'es-US';
};

type LocationAddress = { street?: string; city?: string; state?: string; postal_code?: string };

const SOCIAL_KEYS = ['instagram', 'facebook', 'linkedin', 'tiktok', 'youtube'] as const;

function postalAddress(address: LocationAddress | undefined) {
  if (!address?.street || !address.city || !address.state || !address.postal_code) return null;
  return {
    '@type': 'PostalAddress',
    streetAddress: address.street,
    addressLocality: address.city,
    addressRegion: address.state,
    postalCode: address.postal_code,
    addressCountry: 'US',
  };
}

/**
 * Structured data for one stylist's public page. Every value comes from the same
 * published profile, services and locations the page renders, so the markup always
 * matches what a visitor sees. Empty optional fields are left out.
 */
export function artistSchema({ artist, publicBaseUrl, locale }: ArtistSchemaInput) {
  const { profile, services, locations } = artist;
  const base = publicBaseUrl.replace(/\/$/, '');
  const pageUrl = `${base}/a/${encodeURIComponent(profile.handle)}`;
  const businessId = `${pageUrl}#business`;
  const photo = profile.photo_urls.profile?.['512'] ?? profile.photo_urls.cover?.['512'];
  const links = SOCIAL_KEYS.map((key) => profile.social_links?.[key]).filter((value): value is string => Boolean(value));
  const sites = locations.flatMap((location) => {
    const address = postalAddress(location.address as LocationAddress);
    return address ? [{ '@type': 'HairSalon', name: location.name, address }] : [];
  });
  const cities = [...new Set(locations.map((location) => (location.address as LocationAddress | undefined)?.city).filter((city): city is string => Boolean(city)))];
  const jobTitle = locale === 'es-US' ? 'Estilista de cabello' : 'Hair stylist';

  return {
    '@context': 'https://schema.org',
    '@type': 'HairSalon',
    '@id': businessId,
    name: profile.display_name,
    url: pageUrl,
    description: profile.bio || profile.specialties.join(', '),
    inLanguage: locale,
    ...(photo ? { image: photo } : {}),
    ...(profile.contact_phone ? { telephone: profile.contact_phone } : {}),
    ...(profile.contact_email ? { email: profile.contact_email } : {}),
    ...(sites[0] ? { address: sites[0].address } : {}),
    ...(sites.length ? { location: sites } : {}),
    ...(cities.length ? { areaServed: cities.map((name) => ({ '@type': 'City', name })) } : {}),
    ...(links.length || profile.website_url ? { sameAs: [...(profile.website_url ? [profile.website_url] : []), ...links] } : {}),
    founder: { '@type': 'Person', name: profile.display_name, jobTitle, ...(photo ? { image: photo } : {}) },
    ...(services.length ? {
      hasOfferCatalog: {
        '@type': 'OfferCatalog',
        name: locale === 'es-US' ? 'Servicios' : 'Services',
        itemListElement: services.map((service) => ({
          '@type': 'Offer',
          price: (service.base_price_minor / 100).toFixed(2),
          priceCurrency: 'USD',
          itemOffered: { '@type': 'Service', name: service.name, ...(service.category ? { serviceType: service.category } : {}) },
        })),
      },
    } : {}),
  };
}
