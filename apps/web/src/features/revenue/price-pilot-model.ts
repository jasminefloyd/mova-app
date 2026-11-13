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
  mova_price_pilot_sources: { normalized_host: string; submitted_url: string };
};

export type PriceEvidence = { count: number; low: number; median: number; high: number } | null;

function quantile(values: number[], q: number): number {
  const position = (values.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const lowerValue = values[lower] ?? 0;
  const upperValue = values[upper] ?? lowerValue;
  return lowerValue + (upperValue - lowerValue) * (position - lower);
}

/** Only compare exact service category/name, duration and currency with a minimum of five recent independent menus. */
export function buildPriceEvidence(
  observations: PricePilotObservation[],
  target: { name: string; category: string; durationMinutes: number | null; currency: string },
  now = Date.now(),
): PriceEvidence {
  const byHost = new Map<string, PricePilotObservation>();
  const targetCategory = target.category.trim().toLocaleLowerCase();
  const targetName = target.name.trim().toLocaleLowerCase();
  for (const item of observations) {
    const category = item.category?.trim().toLocaleLowerCase() ?? '';
    const name = item.service_name.trim().toLocaleLowerCase();
    const matches = targetCategory ? category === targetCategory : name === targetName;
    const durationMatches = target.durationMinutes === null || item.duration_minutes === target.durationMinutes;
    const observedAt = Date.parse(item.observed_at);
    const isRecent = Number.isFinite(observedAt) && observedAt <= now && observedAt >= now - 45 * 24 * 60 * 60 * 1000;
    if (!matches || !durationMatches || item.currency !== target.currency || item.extraction_confidence < 0.7 || !isRecent) continue;
    const host = item.mova_price_pilot_sources.normalized_host.toLocaleLowerCase();
    const current = byHost.get(host);
    if (!current || Date.parse(item.observed_at) > Date.parse(current.observed_at)) byHost.set(host, item);
  }
  const prices = [...byHost.values()].map((item) => (item.price_min_minor + item.price_max_minor) / 2).sort((a, b) => a - b);
  if (prices.length < 5) return null;
  return { count: prices.length, low: Math.round(quantile(prices, 0.25)), median: Math.round(quantile(prices, 0.5)), high: Math.round(quantile(prices, 0.75)) };
}
