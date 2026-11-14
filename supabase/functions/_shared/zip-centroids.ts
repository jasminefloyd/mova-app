// Distance between US ZIP code areas, used for PricePilot's comparison radius.
//
// CENSUS DATA CONNECTION (pending): centroids come from the U.S. Census ZCTA gazetteer.
// The connected data source must call setZipCentroids() with a Map of 5-digit ZIP -> { lat, lng }
// before the function serves requests. Until it does, zipCentroid() returns null and
// zipDistanceMiles() returns null, so only exact ZIP and state matches count as local evidence.

export type Centroid = { lat: number; lng: number };

let centroids: Map<string, Centroid> | null = null;

export function setZipCentroids(data: Map<string, Centroid>) {
  centroids = data;
}

export function zipCentroid(zip: string): Centroid | null {
  return centroids?.get(zip) ?? null;
}

const EARTH_RADIUS_MILES = 3958.8;

/** Great-circle distance in miles between two ZIP centroids, or null when either ZIP has no centroid. */
export function zipDistanceMiles(fromZip: string, toZip: string): number | null {
  const from = zipCentroid(fromZip);
  const to = zipCentroid(toZip);
  if (!from || !to) return null;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRadians(to.lat - from.lat);
  const dLng = toRadians(to.lng - from.lng);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(from.lat)) * Math.cos(toRadians(to.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(a))) * 10) / 10;
}
