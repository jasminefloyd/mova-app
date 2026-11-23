// PricePilot suggestion model (PP1–PP6). Pure functions only, so the same rules are unit-tested and
// used by the price-pilot function. Decisions: CR-019, PP-D1..PP-D5 (2026-11-23).
//
// - Comparable menus: same kind of service (name/category words), similar length when the menu lists
//   one (within 15 minutes), within the stylist's radius, read with confidence >= 0.7, checked in the
//   last 45 days. One price per salon (the menu's low-end price, so "from" prices compare like for like).
// - At least 5 menus are needed before a price is suggested (PP6 "Needs data").
// - Raise: the stylist's price is below the middle range (25th percentile). Suggested price = the median,
//   rounded to the nearest $5, never below the current price. Otherwise Hold. Mova never suggests lowering.

export const MIN_MENUS = 5;
export const DURATION_TOLERANCE_MINUTES = 15;
export const MAX_AGE_DAYS = 45;
export const FRESH_DAYS = 14;
const DAY = 24 * 60 * 60 * 1000;

export type Observation = {
  source_id: string;
  service_name: string;
  category: string | null;
  duration_minutes: number | null;
  price_min_minor: number;
  price_max_minor: number;
  currency: string;
  extraction_confidence: number;
  observed_at: string;
};
export type SourceInfo = { id: string; name: string; distance_miles: number | null; checked_at: string };
export type Target = { name: string; category: string | null; duration_minutes: number; currency?: string };
export type Comparable = { source_id: string; name: string; distance_miles: number | null; checked_at: string; price_minor: number; duration_minutes: number | null; confidence: number };
export type CheckKey = 'enough_menus' | 'fresh' | 'clear' | 'agree' | 'same_length' | 'own_bookings';
export type Evidence = {
  count: number; q1: number; median: number; q3: number; min: number; max: number;
  range_low: number; range_high: number; below_count: number; checks: Record<CheckKey, boolean>; passed: number;
  confidence: 'high' | 'medium' | 'low'; latest_checked_at: string | null;
};
export type Suggestion = { action: 'raise' | 'hold' | 'needs_data'; suggested_minor: number; above_range: boolean };

const STOP = new Set(['and', 'with', 'w', 'the', 'a', 'an', 'of', 'for', 'plus', 'service', 'services', 'hair', 'style', 'styling', '&']);

/** Lower-case words of a service name, without punctuation, filler words or plural "s". */
export function serviceWords(value: string): string[] {
  return value.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9]+/g, ' ').split(' ').filter((word) => word && !STOP.has(word) && !/^\d+$/.test(word))
    .map((word) => (word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word));
}

/** Two services are the same kind when one name's words all appear in the other, or they share most words. */
export function sameService(a: string, b: string): boolean {
  const wa = new Set(serviceWords(a));
  const wb = new Set(serviceWords(b));
  if (!wa.size || !wb.size) return false;
  const shared = [...wa].filter((word) => wb.has(word)).length;
  if (shared === wa.size || shared === wb.size) return true;
  return shared / new Set([...wa, ...wb]).size >= 0.6;
}

/** Best price per salon for the target service. */
export function findComparables(observations: Observation[], sources: Map<string, SourceInfo>, target: Target, now = Date.now()): Comparable[] {
  const best = new Map<string, Comparable & { exact: boolean }>();
  const targetName = target.name.trim().toLocaleLowerCase('en-US');
  for (const item of observations) {
    const source = sources.get(item.source_id);
    if (!source) continue;
    if ((target.currency ?? 'USD') !== item.currency) continue;
    if (item.extraction_confidence < 0.7) continue;
    const observed = Date.parse(item.observed_at);
    if (!Number.isFinite(observed) || observed > now + DAY || observed < now - MAX_AGE_DAYS * DAY) continue;
    if (item.duration_minutes != null && Math.abs(item.duration_minutes - target.duration_minutes) > DURATION_TOLERANCE_MINUTES) continue;
    const nameMatch = sameService(item.service_name, target.name);
    const categoryMatch = Boolean(target.category && item.category && sameService(item.category, target.name));
    if (!nameMatch && !categoryMatch) continue;
    const exact = item.service_name.trim().toLocaleLowerCase('en-US') === targetName;
    const current = best.get(item.source_id);
    const candidate = { source_id: item.source_id, name: source.name, distance_miles: source.distance_miles, checked_at: source.checked_at,
      price_minor: item.price_min_minor, duration_minutes: item.duration_minutes, confidence: item.extraction_confidence, exact };
    // Prefer an exact name, then a listed length, then the higher-confidence reading.
    const score = (c: typeof candidate) => (c.exact ? 4 : 0) + (c.duration_minutes != null ? 2 : 0) + c.confidence;
    if (!current || score(candidate) > score(current)) best.set(item.source_id, candidate);
  }
  return [...best.values()].map(({ exact: _exact, ...rest }) => rest)
    .sort((a, b) => (a.distance_miles ?? 999) - (b.distance_miles ?? 999) || a.name.localeCompare(b.name));
}

export function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

/** Nearest $5 (500 minor units). */
export const roundTo5 = (minor: number) => Math.round(minor / 500) * 500;

export function buildEvidence(comparables: Comparable[], target: Target, currentMinor: number, ownBookings90d: number, now = Date.now()): Evidence {
  const prices = comparables.map((item) => item.price_minor).sort((a, b) => a - b);
  const q1 = Math.round(quantile(prices, 0.25));
  const median = Math.round(quantile(prices, 0.5));
  const q3 = Math.round(quantile(prices, 0.75));
  const latest = comparables.reduce<number | null>((max, item) => { const t = Date.parse(item.checked_at); return Number.isFinite(t) && (max === null || t > max) ? t : max; }, null);
  const oldest = comparables.reduce<number | null>((min, item) => { const t = Date.parse(item.checked_at); return Number.isFinite(t) && (min === null || t < min) ? t : min; }, null);
  const avgConfidence = comparables.length ? comparables.reduce((sum, item) => sum + item.confidence, 0) / comparables.length : 0;
  const withLength = comparables.filter((item) => item.duration_minutes != null).length;
  const checks: Record<CheckKey, boolean> = {
    enough_menus: comparables.length >= MIN_MENUS,
    fresh: comparables.length > 0 && oldest !== null && oldest >= now - FRESH_DAYS * DAY,
    clear: comparables.length > 0 && avgConfidence >= 0.85,
    agree: median > 0 && (q3 - q1) / median <= 0.35,
    same_length: comparables.length > 0 && withLength * 2 >= comparables.length,
    own_bookings: ownBookings90d >= 3,
  };
  const passed = Object.values(checks).filter(Boolean).length;
  const confidence = !checks.enough_menus ? 'low' : passed >= 5 ? 'high' : passed === 4 ? 'medium' : 'low';
  return {
    count: comparables.length, q1, median, q3, min: prices[0] ?? 0, max: prices[prices.length - 1] ?? 0,
    range_low: roundTo5(q1), range_high: roundTo5(q3), below_count: prices.filter((price) => price > currentMinor).length,
    checks, passed, confidence, latest_checked_at: latest === null ? null : new Date(latest).toISOString(),
  };
}

export function suggest(evidence: Evidence, currentMinor: number): Suggestion {
  if (evidence.count < MIN_MENUS) return { action: 'needs_data', suggested_minor: currentMinor, above_range: false };
  const aboveRange = currentMinor > evidence.q3;
  if (currentMinor < evidence.q1) {
    const target = Math.max(roundTo5(evidence.median), currentMinor + 100);
    return { action: 'raise', suggested_minor: target, above_range: false };
  }
  return { action: 'hold', suggested_minor: currentMinor, above_range: aboveRange };
}

/** Monthly change from the last 90 days of bookings: bookings a month x price change. Whole dollars. */
export function monthlyImpact(bookings90d: number, currentMinor: number, newMinor: number) {
  const perMonth = bookings90d / 3;
  return {
    per_month: Math.round(perMonth * 10) / 10,
    now_minor: Math.round(perMonth * currentMinor / 100) * 100,
    then_minor: Math.round(perMonth * newMinor / 100) * 100,
    change_minor: Math.round(perMonth * (newMinor - currentMinor) / 100) * 100,
  };
}

/** Where a price sits on the PP1/PP2 bar, 0..100, between the lowest and highest comparable price. */
export function barPosition(value: number, min: number, max: number): number {
  if (max <= min) return 50;
  return Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
}

const EARTH_RADIUS_MILES = 3958.8;
export function distanceMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h))) * 10) / 10;
}
