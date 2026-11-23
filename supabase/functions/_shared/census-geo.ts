// U.S. Census geocoder (public domain, no key) for PricePilot: coordinates, metro area (CBSA) and state
// of a stylist's location, used for the comparison radius and the BLS pay line. Never throws.
// API: https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html

export type CensusPlace = { lat: number; lng: number; cbsa: string | null; stateFips: string | null };

const ENDPOINT = 'https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress';

/** One-line address from a Mova location address object; null when it has no street or ZIP to geocode. */
export function addressLine(address: Record<string, unknown> | null | undefined): string | null {
  if (!address) return null;
  const part = (key: string) => (typeof address[key] === 'string' ? (address[key] as string).trim() : '');
  const street = [part('line1') || part('street') || part('address_line1'), part('line2') || part('address_line2')].filter(Boolean).join(' ');
  const city = part('city') || part('locality');
  const state = part('state') || part('region');
  const zip = part('postal_code') || part('zip');
  if (!zip && !(street && city && state)) return null;
  return [street, city, [state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ').slice(0, 300);
}

type Geo = Record<string, Array<Record<string, unknown>> | undefined>;

/** Reads the first address match. Metro areas come back under "Metropolitan Statistical Areas" (CBSA or GEOID field). */
export function parseCensus(payload: unknown): CensusPlace | null {
  const result = (payload as { result?: { addressMatches?: Array<Record<string, unknown>> } } | null)?.result;
  const match = result?.addressMatches?.[0];
  const coordinates = match?.coordinates as { x?: unknown; y?: unknown } | undefined;
  const lng = Number(coordinates?.x);
  const lat = Number(coordinates?.y);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const geos = (match?.geographies ?? {}) as Geo;
  const metro = geos['Metropolitan Statistical Areas']?.[0] ?? null;
  const cbsaRaw = String(metro?.CBSA ?? metro?.GEOID ?? '');
  const state = geos['States']?.[0] ?? null;
  const stateRaw = String(state?.STATE ?? state?.GEOID ?? '');
  return { lat, lng, cbsa: /^\d{5}$/.test(cbsaRaw) ? cbsaRaw : null, stateFips: /^\d{2}$/.test(stateRaw) ? stateRaw : null };
}

export async function censusGeocode(line: string, fetchImpl: typeof fetch = fetch): Promise<CensusPlace | null> {
  const params = new URLSearchParams({ address: line, benchmark: 'Public_AR_Current', vintage: 'Current_Current', layers: 'Metropolitan Statistical Areas,States', format: 'json' });
  try {
    const response = await fetchImpl(`${ENDPOINT}?${params}`, { signal: AbortSignal.timeout(12_000) });
    if (!response.ok) return null;
    return parseCensus(await response.json());
  } catch {
    return null;
  }
}
