import { artistClient, corsHeaders, serviceClient } from '../_shared/booking.ts';
import { planFeatureEnabled } from '../_shared/plan-feature.ts';
import { redactSystemText, withSystemRequestLogging, writeSystemLog } from '../_shared/system-log.ts';

type MenuItem = { name?: unknown; category?: unknown; duration_minutes?: unknown; price_min?: unknown; price_max?: unknown; currency?: unknown; pricing_basis?: unknown; confidence?: unknown };
type MenuLocation = { region?: unknown; postal_code?: unknown; country_code?: unknown; address_excerpt?: unknown };
type SearchProvider = 'anthropic' | 'openai';
type SearchSource = { name: string; address: string; website: string; url: string; provider: SearchProvider; attribution: string };
const allowedOrigins = /^https:\/\/(?:mova-beauty\.co|www\.mova-beauty\.co|[a-z0-9-]+\.vercel\.app)$/;
const cors = { ...corsHeaders, 'access-control-allow-headers': `${corsHeaders['access-control-allow-headers'] ?? 'authorization, x-client-info, apikey, content-type'}, x-mova-artist-business-id, x-request-id` };

function fail(code: string, status: number, headers: HeadersInit = cors) { return Response.json({ data: null, error: { code } }, { status, headers }); }
function normalizeUrl(value: unknown): URL | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !url.hostname.includes('.') || url.hostname === 'localhost' || /^\d+(?:\.\d+){3}$/.test(url.hostname)) return null;
    if (url.hostname === 'mova-beauty.co' || url.hostname.endsWith('.mova-beauty.co') || url.hostname === 'supabase.co' || url.hostname.endsWith('.supabase.co')) return null;
    // Do not persist or send tracking/auth query strings to a crawler.
    url.search = ''; url.hash = '';
    return url;
  } catch { return null; }
}
function text(value: unknown, max: number) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function minor(value: unknown) { const number = Number(value); return Number.isFinite(number) && number >= 0 && number <= 1000000 ? Math.round(number * 100) : null; }
function normalizeGeoPart(value: unknown) { return text(value, 80).normalize('NFKC').toLocaleUpperCase('en-US').replace(/[^A-Z0-9]/g, ''); }
const US_REGION_CODES: Record<string, string> = {
  ALABAMA: 'AL', ALASKA: 'AK', ARIZONA: 'AZ', ARKANSAS: 'AR', CALIFORNIA: 'CA', COLORADO: 'CO', CONNECTICUT: 'CT', DELAWARE: 'DE', FLORIDA: 'FL', GEORGIA: 'GA', HAWAII: 'HI', IDAHO: 'ID', ILLINOIS: 'IL', INDIANA: 'IN', IOWA: 'IA', KANSAS: 'KS', KENTUCKY: 'KY', LOUISIANA: 'LA', MAINE: 'ME', MARYLAND: 'MD', MASSACHUSETTS: 'MA', MICHIGAN: 'MI', MINNESOTA: 'MN', MISSISSIPPI: 'MS', MISSOURI: 'MO', MONTANA: 'MT', NEBRASKA: 'NE', NEVADA: 'NV', 'NEW HAMPSHIRE': 'NH', 'NEW JERSEY': 'NJ', 'NEW MEXICO': 'NM', 'NEW YORK': 'NY', 'NORTH CAROLINA': 'NC', 'NORTH DAKOTA': 'ND', OHIO: 'OH', OKLAHOMA: 'OK', OREGON: 'OR', PENNSYLVANIA: 'PA', 'RHODE ISLAND': 'RI', 'SOUTH CAROLINA': 'SC', 'SOUTH DAKOTA': 'SD', TENNESSEE: 'TN', TEXAS: 'TX', UTAH: 'UT', VERMONT: 'VT', VIRGINIA: 'VA', WASHINGTON: 'WA', 'WEST VIRGINIA': 'WV', WISCONSIN: 'WI', WYOMING: 'WY', 'DISTRICT OF COLUMBIA': 'DC', DC: 'DC', 'D.C.': 'DC'
};
function normalizeRegion(value: unknown) { const raw = text(value, 80).normalize('NFKC').toLocaleUpperCase('en-US').replace(/\./g, '').replace(/\s+/g, ' ').trim(); return US_REGION_CODES[raw] ?? normalizeGeoPart(value); }
function excerptConfirmsAddress(excerpt: unknown, region: unknown, postalCode: unknown) {
  const value = text(excerpt, 240);
  const postal = normalizePostal(postalCode);
  const regionCode = normalizeRegion(region);
  if (!value || !postal || !regionCode) return false;
  const normalizedExcerpt = normalizeGeoPart(value);
  const postalIncluded = normalizedExcerpt.includes(postal);
  const escapedCode = regionCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const abbreviationIncluded = new RegExp(`(?:^|[^A-Z0-9])${escapedCode}(?:$|[^A-Z0-9])`, 'i').test(value);
  const fullRegion = Object.entries(US_REGION_CODES).find(([name, code]) => name.length > 2 && code === regionCode)?.[0];
  const fullNameIncluded = fullRegion ? normalizedExcerpt.includes(normalizeGeoPart(fullRegion)) : false;
  return postalIncluded && (abbreviationIncluded || fullNameIncluded);
}
function normalizePostal(value: unknown) {
  const normalized = normalizeGeoPart(value);
  // ZIP+4 and ZIP+4-without-dash represent the same US postal area.
  return /^\d{9}$/.test(normalized) ? normalized.slice(0, 5) : normalized;
}
function providerFromEnv(name: string, fallback: SearchProvider): SearchProvider {
  const value = Deno.env.get(name);
  return value === 'anthropic' || value === 'openai' ? value : fallback;
}

async function providerLog(request: Request, businessId: string, userId: string, provider: string, outcome: 'completed' | 'failed', status: number | null, started: number, count?: number, searchCalls?: number) {
  await writeSystemLog({ level: outcome === 'failed' ? 'warning' : 'info', source: 'provider', eventName: 'price_pilot.provider_call', requestId: request.headers.get('x-request-id'), routeOrFunction: 'price-pilot', httpStatus: status, durationMs: Math.round(performance.now() - started), userId, artistBusinessId: businessId, errorCode: outcome === 'failed' ? 'PRICE_PILOT_PROVIDER_FAILED' : null, message: outcome === 'failed' ? 'PricePilot provider request failed' : 'PricePilot provider request completed', context: { provider, outcome, result_count: count ?? 0, search_calls: searchCalls ?? 0 } });
}

function getSearchSources(payload: Record<string, unknown>, provider: SearchProvider): SearchSource[] {
  const raw: Record<string, unknown>[] = [];
  if (provider === 'anthropic' && Array.isArray(payload.content)) {
    for (const block of payload.content as Record<string, unknown>[]) {
      if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) raw.push(...block.content as Record<string, unknown>[]);
    }
  }
  if (provider === 'openai' && Array.isArray(payload.output)) {
    for (const item of payload.output as Record<string, unknown>[]) {
      const action = item.action as Record<string, unknown> | undefined;
      if (item.type === 'web_search_call' && Array.isArray(action?.sources)) raw.push(...action.sources as Record<string, unknown>[]);
    }
  }

  const seen = new Set<string>();
  return raw.flatMap((item) => {
    const title = text(item.title, 160);
    const rawUrl = text(item.url, 500);
    try {
      const url = new URL(rawUrl);
      if (!title || url.protocol !== 'https:' || !url.hostname.includes('.') || seen.has(url.hostname)) return [];
      seen.add(url.hostname);
      return [{ name: title, address: '', website: url.toString(), url: url.toString(), provider, attribution: provider === 'anthropic' ? 'Claude web search' : 'OpenAI web search' }];
    } catch { return []; }
  }).slice(0, 10);
}

async function searchWithProvider(request: Request, businessId: string, userId: string, provider: SearchProvider, query: string, maxSearchCalls: number): Promise<SearchSource[]> {
  const started = performance.now();
  const prompt = `Find real independent hairstylists, salons, or beauty studios near ${query} that publish their own service menu online. Search for business websites and public service-menu pages. Return and cite source pages; do not estimate or invent prices, names, addresses, or URLs. This is candidate discovery only: Mova will verify prices directly from the linked menu pages.`;
  const key = Deno.env.get(provider === 'anthropic' ? 'MOVA_ANTHROPIC_API_KEY' : 'MOVA_OPENAI_API_KEY');
  if (!key) throw new Error('PROVIDER_NOT_CONFIGURED');
  const primaryProvider = providerFromEnv('MOVA_PRICE_PILOT_PRIMARY_PROVIDER', 'anthropic');
  const modelSetting = provider === primaryProvider ? 'MOVA_PRICE_PILOT_PRIMARY_MODEL' : 'MOVA_PRICE_PILOT_FALLBACK_MODEL';
  const defaultModel = provider === 'anthropic' ? 'claude-haiku-5-5' : 'gpt-6-luna';
  const model = Deno.env.get(modelSetting) || defaultModel;

  try {
    const response = provider === 'anthropic'
      ? await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', signal: AbortSignal.timeout(20_000),
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens: 1200, messages: [{ role: 'user', content: prompt }], tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: maxSearchCalls, user_location: { type: 'approximate', country: 'US' } }] }),
      })
      : await fetch('https://api.openai.com/v1/responses', {
        method: 'POST', signal: AbortSignal.timeout(20_000),
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, max_output_tokens: 1200, max_tool_calls: maxSearchCalls, tools: [{ type: 'web_search', search_context_size: 'low', user_location: { type: 'approximate', country: 'US' } }], include: ['web_search_call.action.sources'], input: prompt }),
      });
    if (!response.ok) {
      await providerLog(request, businessId, userId, provider, 'failed', response.status, started);
      throw new Error('PROVIDER_REQUEST_FAILED');
    }
    const payload = await response.json() as Record<string, unknown>;
    const results = getSearchSources(payload, provider);
    if (results.length === 0) {
      await providerLog(request, businessId, userId, provider, 'failed', response.status, started);
      throw new Error('PROVIDER_NO_SOURCES');
    }
    const toolCalls = provider === 'anthropic'
      ? Number((payload.usage as Record<string, unknown> | undefined)?.server_tool_use && ((payload.usage as Record<string, unknown>).server_tool_use as Record<string, unknown>).web_search_requests) || 0
      : Array.isArray(payload.output) ? (payload.output as Record<string, unknown>[]).filter((item) => item.type === 'web_search_call').length : 0;
    await providerLog(request, businessId, userId, provider, 'completed', response.status, started, results.length, toolCalls);
    return results;
  } catch (error) {
    if (!(error instanceof Error && ['PROVIDER_REQUEST_FAILED', 'PROVIDER_NO_SOURCES'].includes(error.message))) {
      await providerLog(request, businessId, userId, provider, 'failed', null, started);
    }
    throw error;
  }
}

async function discoverCompetitors(request: Request, businessId: string, userId: string, query: string) {
  const primaryProvider = providerFromEnv('MOVA_PRICE_PILOT_PRIMARY_PROVIDER', 'anthropic');
  const fallbackProvider = providerFromEnv('MOVA_PRICE_PILOT_FALLBACK_PROVIDER', 'openai');
  const totalSearchCalls = Math.max(2, Math.min(5, Number(Deno.env.get('MOVA_PRICE_PILOT_MAX_SEARCH_CALLS')) || 5));
  const primarySearchCalls = Math.ceil(totalSearchCalls / 2);
  const fallbackSearchCalls = totalSearchCalls - primarySearchCalls;
  try {
    const results = await searchWithProvider(request, businessId, userId, primaryProvider, query, primarySearchCalls);
    return { provider: primaryProvider, results };
  } catch {
    const results = await searchWithProvider(request, businessId, userId, fallbackProvider, query, fallbackSearchCalls);
    return { provider: fallbackProvider, results };
  }
}

async function extractMenu(request: Request, businessId: string, userId: string, menuUrl: URL) {
  const key = Deno.env.get('FIRECRAWL_API_KEY');
  if (!key) return { configured: false, items: [] as MenuItem[], location: null as MenuLocation | null };
  const started = performance.now();
  const schema = { type: 'object', properties: {
    business_location: { type: 'object', description: 'The single service location represented by this menu, only when the page explicitly shows its address. If multiple locations are listed or the service address is unclear, use null fields.', properties: {
      region: { type: ['string', 'null'], description: 'Explicit two-letter state or region abbreviation from the service address. Convert a clearly written US state name to its official two-letter abbreviation; do not infer from a city.' },
      postal_code: { type: ['string', 'null'], description: 'Explicit postal or ZIP code from the same service address; do not infer.' },
      country_code: { type: ['string', 'null'], description: 'Two-letter country code only when explicit; otherwise null.' },
      address_excerpt: { type: ['string', 'null'], description: 'A short exact excerpt from the page that shows this same postal code and state/region together; do not paraphrase or invent it.' },
    }, required: ['region', 'postal_code', 'country_code', 'address_excerpt'] },
    items: { type: 'array', items: { type: 'object', properties: {
    name: { type: 'string', description: 'Visible service menu item name, verbatim, or omit if not shown.' },
    category: { type: ['string', 'null'], description: 'Visible service category, or null if not shown.' },
    duration_minutes: { type: ['integer', 'null'], description: 'Duration in minutes only when explicitly listed; otherwise null.' },
    price_min: { type: ['number', 'null'], description: 'Minimum listed price in dollars, or null if absent.' },
    price_max: { type: ['number', 'null'], description: 'Maximum listed price in dollars, or null if absent.' },
    currency: { type: ['string', 'null'], description: 'ISO 4217 currency only if explicitly clear; otherwise null.' },
    pricing_basis: { type: 'string', enum: ['fixed', 'range', 'starting_at'] },
    confidence: { type: 'number', description: 'Confidence that the visible page states this price; do not guess.' },
  }, required: ['name', 'category', 'duration_minutes', 'price_min', 'price_max', 'currency', 'pricing_basis', 'confidence'] } } }, required: ['business_location', 'items'] };
  try {
    const response = await fetch('https://api.firecrawl.dev/v2/scrape', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ url: menuUrl.toString(), formats: [{ type: 'json', schema }], onlyMainContent: true, checkPromptInjection: true, timeout: 45000 }) });
    if (!response.ok) { await providerLog(request, businessId, userId, 'firecrawl', 'failed', response.status, started); return { configured: true, items: [] as MenuItem[], location: null as MenuLocation | null }; }
    const payload = await response.json();
    const items = (payload?.data?.json?.items ?? []).filter((item: MenuItem) => text(item.name, 120) && minor(item.price_min) !== null && minor(item.price_max ?? item.price_min) !== null).slice(0, 100);
    const candidate = payload?.data?.json?.business_location as MenuLocation | null | undefined;
    const location = candidate && normalizeGeoPart(candidate.region) && normalizePostal(candidate.postal_code) && excerptConfirmsAddress(candidate.address_excerpt, candidate.region, candidate.postal_code)
      ? { region: text(candidate.region, 80), postal_code: text(candidate.postal_code, 20), country_code: /^[A-Za-z]{2}$/.test(text(candidate.country_code, 2)) ? text(candidate.country_code, 2).toUpperCase() : null }
      : null;
    await providerLog(request, businessId, userId, 'firecrawl', 'completed', response.status, started, items.length);
    return { configured: true, items: items as MenuItem[], location };
  } catch {
    await providerLog(request, businessId, userId, 'firecrawl', 'failed', null, started);
    return { configured: true, items: [] as MenuItem[], location: null as MenuLocation | null };
  }
}

async function handle(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 405);
  const origin = request.headers.get('origin') ?? '';
  if (origin && !allowedOrigins.test(origin)) return fail('ORIGIN_NOT_ALLOWED', 403);
  const identity = await artistClient(request);
  if (!identity) return fail('STYLIST_AUTH_REQUIRED', 401);
  const { user, businessId } = identity;
  const requestId = request.headers.get('x-request-id');
  const actionFailure = async (actionName: string, code: string, status: number) => {
    await writeSystemLog({ level: status >= 500 ? 'error' : 'warning', source: 'function', eventName: 'price_pilot.action.failed', requestId, routeOrFunction: 'price-pilot', httpStatus: status, userId: user.id, artistBusinessId: businessId, errorCode: code, message: 'PricePilot action failed', context: { action: actionName, outcome: 'failed' } });
    return fail(code, status);
  };
  if (!(await planFeatureEnabled(businessId, 'ai_price_pilot'))) {
    await writeSystemLog({ level: 'warning', source: 'function', eventName: 'price_pilot.feature_gate.denied', requestId, routeOrFunction: 'price-pilot', httpStatus: 403, userId: user.id, artistBusinessId: businessId, errorCode: 'PRICE_PILOT_FEATURE_DISABLED', message: 'PricePilot access was denied by feature gate', context: { action: 'feature_gate', outcome: 'denied' } });
    return fail('PRICE_PILOT_FEATURE_DISABLED', 403);
  }
  let body: Record<string, unknown>;
  try { body = await request.json(); if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error(); }
  catch { return fail('INVALID_BODY', 400); }
  const action = text(body.action, 30);
  const db = serviceClient();
  if (action === 'discover') {
    const query = text(body.location, 100);
    if (query.length < 2) return actionFailure('discover', 'LOCATION_REQUIRED', 400);
    try {
      const result = await discoverCompetitors(request, businessId, user.id, query);
      await writeSystemLog({ level: 'info', source: 'function', eventName: 'price_pilot.discovery.completed', requestId, routeOrFunction: 'price-pilot', httpStatus: 200, userId: user.id, artistBusinessId: businessId, message: 'PricePilot competitor discovery completed', context: { action, provider: result.provider, outcome: 'completed', result_count: result.results.length } });
      return Response.json({ data: { results: [{ provider: result.provider, configured: true, results: result.results }], note: 'Web search results are candidate discovery context only. They are not stored or used as comparable menu prices; prices must be extracted and verified from linked menus.' } }, { headers: cors });
    } catch {
      return actionFailure('discover', 'PRICE_PILOT_SEARCH_UNAVAILABLE', 503);
    }
  }
  if (action === 'import_menu') {
    if (body.authorization_confirmed !== true) return actionFailure('import_menu', 'SOURCE_AUTHORIZATION_REQUIRED', 400);
    const url = normalizeUrl(body.url);
    if (!url) return actionFailure('import_menu', 'MENU_URL_INVALID', 400);
    const extracted = await extractMenu(request, businessId, user.id, url);
    if (!extracted.configured) return actionFailure('import_menu', 'FIRECRAWL_NOT_CONFIGURED', 503);
    const items = extracted.items.map((item) => ({
      name: text(item.name, 120), category: text(item.category, 80) || null,
      duration_minutes: Number.isInteger(item.duration_minutes) && Number(item.duration_minutes) >= 5 && Number(item.duration_minutes) <= 1440 ? Number(item.duration_minutes) : null,
      price_min_minor: minor(item.price_min), price_max_minor: minor(item.price_max ?? item.price_min),
      currency: /^[A-Z]{3}$/.test(text(item.currency, 3).toUpperCase()) ? text(item.currency, 3).toUpperCase() : 'USD',
      pricing_basis: ['fixed', 'range', 'starting_at'].includes(String(item.pricing_basis)) ? item.pricing_basis : 'fixed',
      extraction_confidence: Math.min(1, Math.max(0, Number(item.confidence) || 0)),
    })).filter((item) => item.name && item.price_min_minor !== null && item.price_max_minor !== null);
    if (!items.length) {
      await writeSystemLog({ level: 'warning', source: 'function', eventName: 'price_pilot.extraction.no_menu_prices', requestId, routeOrFunction: 'price-pilot', httpStatus: 422, userId: user.id, artistBusinessId: businessId, errorCode: 'NO_MENU_PRICES_FOUND', message: 'No eligible menu prices were extracted', context: { action, outcome: 'empty', extraction_count: 0 } });
      return fail('NO_MENU_PRICES_FOUND', 422);
    }
    const checkedAt = new Date().toISOString();
    const { data: source, error: sourceError } = await db.from('mova_price_pilot_sources').upsert({ artist_business_id: businessId, submitted_url: `${url.origin}${url.pathname}`, normalized_host: url.hostname, authorization_confirmed: true, status: 'active', last_checked_at: checkedAt, market_region: extracted.location?.region ?? null, market_postal_code: extracted.location?.postal_code ?? null, market_country_code: extracted.location?.country_code ?? null, market_location_expires_at: extracted.location ? new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString() : null }, { onConflict: 'artist_business_id,submitted_url' }).select('id').single();
    if (sourceError || !source) return actionFailure('import_menu', 'PRICE_PILOT_SAVE_FAILED', 500);
    const { error: deleteError } = await db.from('mova_price_pilot_observations').delete().eq('source_id', source.id).eq('artist_business_id', businessId);
    if (deleteError) return actionFailure('import_menu', 'PRICE_PILOT_SAVE_FAILED', 500);
    const { error: insertError } = await db.from('mova_price_pilot_observations').insert(items.map((item) => ({ ...item, source_id: source.id, artist_business_id: businessId })));
    if (insertError) return actionFailure('import_menu', 'PRICE_PILOT_SAVE_FAILED', 500);
    await writeSystemLog({ level: 'info', source: 'function', eventName: 'price_pilot.menu_import.completed', requestId, routeOrFunction: 'price-pilot', httpStatus: 200, userId: user.id, artistBusinessId: businessId, message: 'Authorized menu import completed', context: { action, outcome: 'completed', extraction_count: items.length } });
    return Response.json({ data: { imported: items.length } }, { headers: cors });
  }
  if (action === 'list') {
    const locationId = text(body.location_id, 50);
    if (!/^[0-9a-f-]{36}$/i.test(locationId)) return actionFailure('list', 'LOCATION_REQUIRED', 400);
    const { data: locationRow, error: locationError } = await db.from('mova_locations').select('address').eq('id', locationId).eq('artist_business_id', businessId).eq('is_active', true).maybeSingle();
    if (locationError) return actionFailure('list', 'PRICE_PILOT_READ_FAILED', 500);
    if (!locationRow) return actionFailure('list', 'LOCATION_NOT_FOUND', 404);
    const stylistAddress = locationRow.address && typeof locationRow.address === 'object' ? locationRow.address as Record<string, unknown> : {};
    const stylistPostal = normalizePostal(stylistAddress.postal_code);
    const stylistRegion = normalizeRegion(stylistAddress.state);
    const stylistCountry = normalizeGeoPart(stylistAddress.country_code);
    const { data, error } = await db.from('mova_price_pilot_observations').select('id,source_id,service_name,category,duration_minutes,price_min_minor,price_max_minor,currency,pricing_basis,extraction_confidence,observed_at,mova_price_pilot_sources!inner(normalized_host,submitted_url,status,market_region,market_postal_code,market_country_code,market_location_expires_at)').eq('artist_business_id', businessId).eq('mova_price_pilot_sources.status', 'active').gt('expires_at', new Date().toISOString()).order('observed_at', { ascending: false }).limit(300);
    if (error) return actionFailure('list', 'PRICE_PILOT_READ_FAILED', 500);
    const observations = (data ?? []).map((row) => {
      const source = (Array.isArray(row.mova_price_pilot_sources) ? row.mova_price_pilot_sources[0] : row.mova_price_pilot_sources) as Record<string, unknown> | null;
      const sourcePostal = normalizePostal(source?.market_postal_code);
      const sourceRegion = normalizeRegion(source?.market_region);
      const sourceCountry = normalizeGeoPart(source?.market_country_code);
      const countryMatches = !stylistCountry || !sourceCountry || stylistCountry === sourceCountry;
      const geoExpiry = Date.parse(String(source?.market_location_expires_at ?? ''));
      const geographicMatch = Boolean(Number.isFinite(geoExpiry) && geoExpiry > Date.now() && stylistPostal && stylistRegion && sourcePostal && sourceRegion && stylistPostal === sourcePostal && stylistRegion === sourceRegion && countryMatches);
      return {
        ...row,
        geographic_match: geographicMatch,
        geographic_match_scope: geographicMatch ? 'postal_code_region' : null,
        mova_price_pilot_sources: source ? { normalized_host: source.normalized_host, submitted_url: source.submitted_url } : null,
      };
    });
    await writeSystemLog({ level: 'info', source: 'function', eventName: 'price_pilot.observations.viewed', requestId, routeOrFunction: 'price-pilot', httpStatus: 200, userId: user.id, artistBusinessId: businessId, message: 'PricePilot local-market observations loaded', context: { action, outcome: 'completed', result_count: observations.length } });
    return Response.json({ data: { observations } }, { headers: cors });
  }
  if (action === 'remove_source') {
    const sourceId = text(body.source_id, 50);
    const { error } = await db.from('mova_price_pilot_sources').update({ status: 'removed' }).eq('id', sourceId).eq('artist_business_id', businessId);
    if (error) return actionFailure('remove_source', 'PRICE_PILOT_REMOVE_FAILED', 500);
    await db.from('mova_price_pilot_observations').delete().eq('source_id', sourceId).eq('artist_business_id', businessId);
    await writeSystemLog({ level: 'info', source: 'function', eventName: 'price_pilot.source.removed', requestId, routeOrFunction: 'price-pilot', httpStatus: 200, userId: user.id, artistBusinessId: businessId, message: 'PricePilot menu source removed', context: { action, outcome: 'completed' } });
    return Response.json({ data: { removed: true } }, { headers: cors });
  }
  return actionFailure(action || 'unknown', 'ACTION_NOT_SUPPORTED', 400);
}

Deno.serve(withSystemRequestLogging('price-pilot', handle));
