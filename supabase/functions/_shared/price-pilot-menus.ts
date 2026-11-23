// Reading salon menu pages for PricePilot (Firecrawl). Shared by the price-pilot function (a menu the
// stylist adds) and the weekly worker (salons Mova found). Prices come only from what the page shows;
// nothing is estimated. Pages are scraped with Firecrawl's prompt-injection check on.

export type MenuRow = {
  service_name: string; category: string | null; duration_minutes: number | null; price_min_minor: number; price_max_minor: number;
  currency: string; pricing_basis: 'fixed' | 'range' | 'starting_at'; extraction_confidence: number;
};
export type MenuLocation = { region: string; postal_code: string; country_code: string | null; address_excerpt: string };
export type MenuResult =
  | { status: 'not_configured' }
  | { status: 'failed' }
  | { status: 'ok'; rows: MenuRow[]; location: MenuLocation | null; businessName: string | null };

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const minor = (value: unknown) => { const n = Number(value); return Number.isFinite(n) && n >= 0 && n <= 1000000 ? Math.round(n * 100) : null; };

/** https URL that is safe to hand to a crawler, without query or hash; null otherwise. */
export function safeMenuUrl(value: unknown): URL | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !url.hostname.includes('.') || url.hostname === 'localhost' || /^\d+(?:\.\d+){3}$/.test(url.hostname)) return null;
    const host = url.hostname.toLowerCase();
    if (host === 'mova-beauty.co' || host.endsWith('.mova-beauty.co') || host.endsWith('.supabase.co') || host === 'supabase.co') return null;
    url.search = ''; url.hash = '';
    return url;
  } catch { return null; }
}

/** The page on a salon's site most likely to hold its prices, from a list of links on that site. */
export function pickMenuUrl(links: string[], site: URL): URL | null {
  const host = site.hostname.replace(/^www\./, '');
  let best: { url: URL; score: number } | null = null;
  for (const link of links) {
    const url = safeMenuUrl(link);
    if (!url || url.hostname.replace(/^www\./, '') !== host) continue;
    const path = url.pathname.toLowerCase();
    if (/\.(pdf|jpe?g|png|gif|webp|svg|mp4)$/.test(path) || /(blog|careers|jobs|privacy|terms|cart|login|account)/.test(path)) continue;
    let score = 0;
    if (/(price|pricing|prices)/.test(path)) score += 5;
    if (/(menu|services|service-menu|rates)/.test(path)) score += 4;
    if (/(book|booking)/.test(path)) score += 1;
    score -= path.split('/').filter(Boolean).length * 0.2;
    if (score > 0 && (!best || score > best.score)) best = { url, score };
  }
  return best?.url ?? null;
}

export async function firecrawlMap(site: URL, key: string | undefined, fetchImpl: typeof fetch = fetch): Promise<string[] | null> {
  if (!key) return null;
  try {
    const response = await fetchImpl('https://api.firecrawl.dev/v2/map', {
      method: 'POST', signal: AbortSignal.timeout(30_000), headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ url: site.origin, search: 'services menu prices pricing', limit: 30 }),
    });
    if (!response.ok) return null;
    const payload = await response.json() as { links?: Array<string | { url?: string }> };
    return (payload.links ?? []).map((item) => (typeof item === 'string' ? item : item?.url ?? '')).filter(Boolean);
  } catch { return null; }
}

const US_REGION_CODES: Record<string, string> = {
  ALABAMA: 'AL', ALASKA: 'AK', ARIZONA: 'AZ', ARKANSAS: 'AR', CALIFORNIA: 'CA', COLORADO: 'CO', CONNECTICUT: 'CT', DELAWARE: 'DE', FLORIDA: 'FL', GEORGIA: 'GA', HAWAII: 'HI', IDAHO: 'ID', ILLINOIS: 'IL', INDIANA: 'IN', IOWA: 'IA', KANSAS: 'KS', KENTUCKY: 'KY', LOUISIANA: 'LA', MAINE: 'ME', MARYLAND: 'MD', MASSACHUSETTS: 'MA', MICHIGAN: 'MI', MINNESOTA: 'MN', MISSISSIPPI: 'MS', MISSOURI: 'MO', MONTANA: 'MT', NEBRASKA: 'NE', NEVADA: 'NV', 'NEW HAMPSHIRE': 'NH', 'NEW JERSEY': 'NJ', 'NEW MEXICO': 'NM', 'NEW YORK': 'NY', 'NORTH CAROLINA': 'NC', 'NORTH DAKOTA': 'ND', OHIO: 'OH', OKLAHOMA: 'OK', OREGON: 'OR', PENNSYLVANIA: 'PA', 'RHODE ISLAND': 'RI', 'SOUTH CAROLINA': 'SC', 'SOUTH DAKOTA': 'SD', TENNESSEE: 'TN', TEXAS: 'TX', UTAH: 'UT', VERMONT: 'VT', VIRGINIA: 'VA', WASHINGTON: 'WA', 'WEST VIRGINIA': 'WV', WISCONSIN: 'WI', WYOMING: 'WY', 'DISTRICT OF COLUMBIA': 'DC', DC: 'DC',
};
export const normalizeGeoPart = (value: unknown) => text(value, 80).normalize('NFKC').toLocaleUpperCase('en-US').replace(/[^A-Z0-9]/g, '');
export function normalizeRegion(value: unknown) { const raw = text(value, 80).normalize('NFKC').toLocaleUpperCase('en-US').replace(/\./g, '').replace(/\s+/g, ' ').trim(); return US_REGION_CODES[raw] ?? normalizeGeoPart(value); }
export function normalizePostal(value: unknown) { const n = normalizeGeoPart(value); return /^\d{9}$/.test(n) ? n.slice(0, 5) : n; }

/** The address excerpt must show the same ZIP and state the model reported, or the location is ignored. */
export function excerptConfirmsAddress(excerpt: unknown, region: unknown, postalCode: unknown) {
  const value = text(excerpt, 240);
  const postal = normalizePostal(postalCode);
  const regionCode = normalizeRegion(region);
  if (!value || !postal || !regionCode) return false;
  const normalizedExcerpt = normalizeGeoPart(value);
  const escaped = regionCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const abbreviation = new RegExp(`(?:^|[^A-Z0-9])${escaped}(?:$|[^A-Z0-9])`, 'i').test(value);
  const fullRegion = Object.entries(US_REGION_CODES).find(([name, code]) => name.length > 2 && code === regionCode)?.[0];
  const fullName = fullRegion ? normalizedExcerpt.includes(normalizeGeoPart(fullRegion)) : false;
  return normalizedExcerpt.includes(postal) && (abbreviation || fullName);
}

export function normalizeRows(items: unknown[]): MenuRow[] {
  return items.slice(0, 100).flatMap((raw) => {
    const item = (raw ?? {}) as Record<string, unknown>;
    const name = text(item.name, 120);
    const low = minor(item.price_min);
    const high = minor(item.price_max ?? item.price_min);
    if (!name || low === null || high === null || low < 100) return [];
    const duration = Number(item.duration_minutes);
    const currency = text(item.currency, 3).toUpperCase();
    return [{
      service_name: name, category: text(item.category, 80) || null,
      duration_minutes: Number.isInteger(duration) && duration >= 5 && duration <= 1440 ? duration : null,
      price_min_minor: Math.min(low, high), price_max_minor: Math.max(low, high),
      currency: /^[A-Z]{3}$/.test(currency) ? currency : 'USD',
      pricing_basis: (['fixed', 'range', 'starting_at'].includes(String(item.pricing_basis)) ? item.pricing_basis : 'fixed') as MenuRow['pricing_basis'],
      extraction_confidence: Math.min(1, Math.max(0, Number(item.confidence) || 0)),
    }];
  });
}

const SCHEMA = { type: 'object', properties: {
  business_name: { type: ['string', 'null'], description: 'The salon or stylist business name shown on the page, verbatim, or null.' },
  business_location: { type: 'object', description: 'The single service location this menu is for, only when the page shows its address. If several locations are listed or it is unclear, use null fields.', properties: {
    region: { type: ['string', 'null'], description: 'Explicit two-letter state abbreviation from the service address. Convert a clearly written US state name; do not infer from a city.' },
    postal_code: { type: ['string', 'null'], description: 'Explicit ZIP code from the same address; do not infer.' },
    country_code: { type: ['string', 'null'], description: 'Two-letter country code only when explicit; otherwise null.' },
    address_excerpt: { type: ['string', 'null'], description: 'A short exact excerpt from the page that shows this same ZIP and state together; do not paraphrase.' },
  }, required: ['region', 'postal_code', 'country_code', 'address_excerpt'] },
  items: { type: 'array', items: { type: 'object', properties: {
    name: { type: 'string', description: 'Visible service name, verbatim.' },
    category: { type: ['string', 'null'], description: 'Visible service category, or null.' },
    duration_minutes: { type: ['integer', 'null'], description: 'Duration in minutes only when listed; otherwise null.' },
    price_min: { type: ['number', 'null'], description: 'Lowest listed price in dollars, or null.' },
    price_max: { type: ['number', 'null'], description: 'Highest listed price in dollars, or null.' },
    currency: { type: ['string', 'null'], description: 'ISO 4217 currency only if clear; otherwise null.' },
    pricing_basis: { type: 'string', enum: ['fixed', 'range', 'starting_at'] },
    confidence: { type: 'number', description: 'Confidence that the page states this price; do not guess.' },
  }, required: ['name', 'category', 'duration_minutes', 'price_min', 'price_max', 'currency', 'pricing_basis', 'confidence'] } },
}, required: ['business_name', 'business_location', 'items'] };

export async function readMenu(url: URL, key: string | undefined, fetchImpl: typeof fetch = fetch): Promise<MenuResult> {
  if (!key) return { status: 'not_configured' };
  try {
    const response = await fetchImpl('https://api.firecrawl.dev/v2/scrape', {
      method: 'POST', signal: AbortSignal.timeout(50_000), headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ url: url.toString(), formats: [{ type: 'json', schema: SCHEMA }], onlyMainContent: true, checkPromptInjection: true, timeout: 45000 }),
    });
    if (!response.ok) return { status: 'failed' };
    const json = (await response.json())?.data?.json ?? {};
    const rows = normalizeRows(Array.isArray(json.items) ? json.items : []);
    const candidate = json.business_location as Record<string, unknown> | null | undefined;
    const location = candidate && normalizeGeoPart(candidate.region) && normalizePostal(candidate.postal_code) && excerptConfirmsAddress(candidate.address_excerpt, candidate.region, candidate.postal_code)
      ? { region: text(candidate.region, 80), postal_code: text(candidate.postal_code, 20), country_code: /^[A-Za-z]{2}$/.test(text(candidate.country_code, 2)) ? text(candidate.country_code, 2).toUpperCase() : null, address_excerpt: text(candidate.address_excerpt, 240) }
      : null;
    return { status: 'ok', rows, location, businessName: text(json.business_name, 160) || null };
  } catch { return { status: 'failed' }; }
}
