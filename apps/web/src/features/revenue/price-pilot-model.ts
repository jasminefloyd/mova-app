/** Exact ZIP/region match, or a nearby ZIP inside the stylist's chosen radius and the same region. */
export type GeographicMatchScope = 'postal_code_region' | 'nearby_postal_code';

/** Services count as comparable when their durations differ by at most this many minutes. */
export const DURATION_TOLERANCE_MINUTES = 15;

export type PricePilotObservation = {
  id: string;
  source_id: string;
  service_name: string;
  category: string | null;
  duration_minutes: number | null;
  price_min_minor: number;
  price_max_minor: number;
  currency: string;
  extraction_confidence: number;
  observed_at: string;
  geographic_match?: boolean;
  geographic_match_scope?: GeographicMatchScope | null;
  mova_price_pilot_sources: { normalized_host: string; submitted_url: string };
};

export type PriceEvidence = { count: number; low: number; median: number; high: number } | null;
export type PriceEvidenceDetails = {
  count: number;
  low: number;
  median: number;
  high: number;
  marketMin: number;
  marketMax: number;
  currentPercentile: number | null;
  latestAgeDays: number;
  averageExtractionConfidence: number;
  spreadPercent: number;
};

export function findComparableObservations(
  observations: PricePilotObservation[],
  target: { name: string; category: string | null; durationMinutes: number | null; currency: string },
  now = Date.now(),
): PricePilotObservation[] {
  const byHost = new Map<string, PricePilotObservation>();
  const targetCategory = target.category?.trim().toLocaleLowerCase() ?? '';
  const targetName = target.name.trim().toLocaleLowerCase();
  for (const item of observations) {
    if (item.geographic_match !== true || !item.geographic_match_scope) continue;
    const category = item.category?.trim().toLocaleLowerCase() ?? '';
    const name = item.service_name.trim().toLocaleLowerCase();
    const matches = targetCategory ? category === targetCategory : name === targetName;
    const durationMatches = target.durationMinutes === null
      || (item.duration_minutes !== null && Math.abs(item.duration_minutes - target.durationMinutes) <= DURATION_TOLERANCE_MINUTES);
    const observedAt = Date.parse(item.observed_at);
    const isRecent = Number.isFinite(observedAt) && observedAt <= now && observedAt >= now - 45 * 24 * 60 * 60 * 1000;
    if (!matches || !durationMatches || item.currency !== target.currency || item.extraction_confidence < 0.7 || !isRecent) continue;
    const host = item.mova_price_pilot_sources.normalized_host.toLocaleLowerCase();
    const current = byHost.get(host);
    if (!current || Date.parse(item.observed_at) > Date.parse(current.observed_at)) byHost.set(host, item);
  }
  return [...byHost.values()].sort((a, b) => Date.parse(b.observed_at) - Date.parse(a.observed_at));
}

function quantile(values: number[], q: number): number {
  const position = (values.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const lowerValue = values[lower] ?? 0;
  const upperValue = values[upper] ?? lowerValue;
  return lowerValue + (upperValue - lowerValue) * (position - lower);
}

/**
 * Build evidence only from recent, high-confidence, comparable observations,
 * counting at most one current observation per independent source host.
 * Comparison uses each menu's low-end price.
 */
export function buildPriceEvidenceDetails(
  observations: PricePilotObservation[],
  target: { name: string; category: string | null; durationMinutes: number | null; currency: string; currentPriceMinor?: number | null },
  now = Date.now(),
): PriceEvidenceDetails | null {
  const matched = findComparableObservations(observations, target, now);
  if (matched.length < 5) return null;
  // Compare the stylist's price with the low end of each menu, so a "from" price is matched like for like.
  const prices = matched.map((item) => item.price_min_minor).sort((a, b) => a - b);
  const low = Math.round(quantile(prices, 0.25));
  const median = Math.round(quantile(prices, 0.5));
  const high = Math.round(quantile(prices, 0.75));
  const latestAt = Math.max(...matched.map((item) => Date.parse(item.observed_at)));
  const latestAgeDays = Math.max(0, Math.floor((now - latestAt) / (24 * 60 * 60 * 1000)));
  const averageExtractionConfidence = matched.reduce((total, item) => total + item.extraction_confidence, 0) / matched.length;
  const current = target.currentPriceMinor;
  const currentPercentile = current == null ? null : Math.round((prices.filter((price) => price <= current).length / prices.length) * 100);

  return {
    count: matched.length,
    low,
    median,
    high,
    marketMin: Math.min(...matched.map((item) => item.price_min_minor)),
    marketMax: Math.max(...matched.map((item) => item.price_max_minor)),
    currentPercentile,
    latestAgeDays,
    averageExtractionConfidence,
    spreadPercent: median > 0 ? Math.round(((high - low) / median) * 100) : 0,
  };
}

/** Kept as the compact result shape for existing consumers. */
export function buildPriceEvidence(
  observations: PricePilotObservation[],
  target: { name: string; category: string | null; durationMinutes: number | null; currency: string; currentPriceMinor?: number | null },
  now = Date.now(),
): PriceEvidence {
  const details = buildPriceEvidenceDetails(observations, target, now);
  return details ? { count: details.count, low: details.low, median: details.median, high: details.high } : null;
}
