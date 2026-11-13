import { artistClient, corsHeaders, serviceClient } from '../_shared/booking.ts';
import { planFeatureEnabled } from '../_shared/plan-feature.ts';
import { redactSystemText, withSystemRequestLogging, writeSystemLog } from '../_shared/system-log.ts';

type MenuItem = { name?: unknown; category?: unknown; duration_minutes?: unknown; price_min?: unknown; price_max?: unknown; currency?: unknown; pricing_basis?: unknown; confidence?: unknown };
type DirectoryProvider = 'google_places' | 'yelp' | 'serpapi';
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

async function providerLog(request: Request, businessId: string, userId: string, provider: string, outcome: 'completed' | 'failed', status: number | null, started: number, count?: number) {
  await writeSystemLog({ level: outcome === 'failed' ? 'warning' : 'info', source: 'provider', eventName: 'price_pilot.provider_call', requestId: request.headers.get('x-request-id'), routeOrFunction: 'price-pilot', httpStatus: status, durationMs: Math.round(performance.now() - started), userId, artistBusinessId: businessId, errorCode: outcome === 'failed' ? 'PRICE_PILOT_PROVIDER_FAILED' : null, message: outcome === 'failed' ? 'Price Pilot provider request failed' : 'Price Pilot provider request completed', context: { provider, outcome, result_count: count ?? 0 } });
}

async function directorySearch(request: Request, businessId: string, userId: string, provider: DirectoryProvider, query: string) {
  const config: Record<DirectoryProvider, { key: string; url: string; headers?: Record<string, string> }> = {
    google_places: { key: 'GOOGLE_PLACES_API_KEY', url: 'https://places.googleapis.com/v1/places:searchText' },
    yelp: { key: 'YELP_API_KEY', url: `https://api.yelp.com/v3/businesses/search?${new URLSearchParams({ term: 'hair stylist salon', location: query, limit: '10' })}` },
    serpapi: { key: 'SERPAPI_API_KEY', url: `https://serpapi.com/search.json?${new URLSearchParams({ engine: 'google_maps', q: `hair stylist salon ${query}`, api_key: Deno.env.get('SERPAPI_API_KEY') ?? '' })}` },
  };
  const setup = config[provider]; const key = Deno.env.get(setup.key);
  if (!key) return { configured: false, results: [] };
  const started = performance.now();
  try {
    const response = provider === 'google_places'
      ? await fetch(setup.url, { method: 'POST', headers: { 'content-type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.websiteUri' }, body: JSON.stringify({ textQuery: `hair stylist salon ${query}`, pageSize: 10 }) })
      : await fetch(setup.url, { headers: provider === 'yelp' ? { authorization: `Bearer ${key}` } : {} });
    if (!response.ok) { await providerLog(request, businessId, userId, provider, 'failed', response.status, started); return { configured: true, results: [] }; }
    const data = await response.json();
    const raw = provider === 'google_places' ? data.places ?? [] : provider === 'yelp' ? data.businesses ?? [] : data.local_results ?? [];
    const results = raw.slice(0, 10).map((item: Record<string, unknown>) => ({
      name: text((item.displayName as Record<string, unknown> | undefined)?.text ?? item.name ?? item.title, 120),
      address: text(item.formattedAddress ?? ((item.location as Record<string, unknown> | undefined)?.display_address && Array.isArray((item.location as Record<string, unknown>).display_address) ? ((item.location as Record<string, unknown>).display_address as string[]).join(', ') : item.address), 180),
      website: text(item.websiteUri ?? item.website, 400),
      url: text(item.url ?? item.place_id ?? item.data_id ?? item.id, 500),
      provider,
      attribution: provider === 'google_places' || provider === 'serpapi' ? 'Google' : 'Yelp',
    })).filter((item: { name: string }) => item.name);
    await providerLog(request, businessId, userId, provider, 'completed', response.status, started, results.length);
    return { configured: true, results };
  } catch {
    await providerLog(request, businessId, userId, provider, 'failed', null, started);
    return { configured: true, results: [] };
  }
}

async function extractMenu(request: Request, businessId: string, userId: string, menuUrl: URL) {
  const key = Deno.env.get('FIRECRAWL_API_KEY');
  if (!key) return { configured: false, items: [] as MenuItem[] };
  const started = performance.now();
  const schema = { type: 'object', properties: { items: { type: 'array', items: { type: 'object', properties: {
    name: { type: 'string', description: 'Visible service menu item name, verbatim, or omit if not shown.' },
    category: { type: ['string', 'null'], description: 'Visible service category, or null if not shown.' },
    duration_minutes: { type: ['integer', 'null'], description: 'Duration in minutes only when explicitly listed; otherwise null.' },
    price_min: { type: ['number', 'null'], description: 'Minimum listed price in dollars, or null if absent.' },
    price_max: { type: ['number', 'null'], description: 'Maximum listed price in dollars, or null if absent.' },
    currency: { type: ['string', 'null'], description: 'ISO 4217 currency only if explicitly clear; otherwise null.' },
    pricing_basis: { type: 'string', enum: ['fixed', 'range', 'starting_at'] },
    confidence: { type: 'number', description: 'Confidence that the visible page states this price; do not guess.' },
  }, required: ['name', 'category', 'duration_minutes', 'price_min', 'price_max', 'currency', 'pricing_basis', 'confidence'] } } }, required: ['items'] };
  try {
    const response = await fetch('https://api.firecrawl.dev/v2/scrape', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ url: menuUrl.toString(), formats: [{ type: 'json', schema }], onlyMainContent: true, checkPromptInjection: true, timeout: 45000 }) });
    if (!response.ok) { await providerLog(request, businessId, userId, 'firecrawl', 'failed', response.status, started); return { configured: true, items: [] as MenuItem[] }; }
    const payload = await response.json();
    const items = (payload?.data?.json?.items ?? []).filter((item: MenuItem) => text(item.name, 120) && minor(item.price_min) !== null && minor(item.price_max ?? item.price_min) !== null).slice(0, 100);
    await providerLog(request, businessId, userId, 'firecrawl', 'completed', response.status, started, items.length);
    return { configured: true, items: items as MenuItem[] };
  } catch {
    await providerLog(request, businessId, userId, 'firecrawl', 'failed', null, started);
    return { configured: true, items: [] as MenuItem[] };
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
    await writeSystemLog({ level: status >= 500 ? 'error' : 'warning', source: 'function', eventName: 'price_pilot.action.failed', requestId, routeOrFunction: 'price-pilot', httpStatus: status, userId: user.id, artistBusinessId: businessId, errorCode: code, message: 'Price Pilot action failed', context: { action: actionName, outcome: 'failed' } });
    return fail(code, status);
  };
  if (!(await planFeatureEnabled(businessId, 'ai_price_pilot'))) {
    await writeSystemLog({ level: 'warning', source: 'function', eventName: 'price_pilot.feature_gate.denied', requestId, routeOrFunction: 'price-pilot', httpStatus: 403, userId: user.id, artistBusinessId: businessId, errorCode: 'PRICE_PILOT_FEATURE_DISABLED', message: 'Price Pilot access was denied by feature gate', context: { action: 'feature_gate', outcome: 'denied' } });
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
    const requested = Array.isArray(body.providers) ? body.providers : ['google_places', 'yelp', 'serpapi'];
    const providers = requested.filter((p): p is DirectoryProvider => ['google_places', 'yelp', 'serpapi'].includes(String(p)));
    const results = await Promise.all(providers.slice(0, 3).map(async (provider) => ({ provider, ...await directorySearch(request, businessId, user.id, provider, query) })));
    await writeSystemLog({ level: 'info', source: 'function', eventName: 'price_pilot.discovery.completed', requestId, routeOrFunction: 'price-pilot', httpStatus: 200, userId: user.id, artistBusinessId: businessId, message: 'Price Pilot competitor discovery completed', context: { action, outcome: 'completed', result_count: results.reduce((n, result) => n + result.results.length, 0) } });
    return Response.json({ data: { results, note: 'Directory results are transient discovery context. They are not stored or used as comparable menu prices.' } }, { headers: cors });
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
    const { data: source, error: sourceError } = await db.from('mova_price_pilot_sources').upsert({ artist_business_id: businessId, submitted_url: `${url.origin}${url.pathname}`, normalized_host: url.hostname, authorization_confirmed: true, status: 'active', last_checked_at: new Date().toISOString() }, { onConflict: 'artist_business_id,submitted_url' }).select('id').single();
    if (sourceError || !source) return actionFailure('import_menu', 'PRICE_PILOT_SAVE_FAILED', 500);
    const { error: deleteError } = await db.from('mova_price_pilot_observations').delete().eq('source_id', source.id).eq('artist_business_id', businessId);
    if (deleteError) return actionFailure('import_menu', 'PRICE_PILOT_SAVE_FAILED', 500);
    const { error: insertError } = await db.from('mova_price_pilot_observations').insert(items.map((item) => ({ ...item, source_id: source.id, artist_business_id: businessId })));
    if (insertError) return actionFailure('import_menu', 'PRICE_PILOT_SAVE_FAILED', 500);
    await writeSystemLog({ level: 'info', source: 'function', eventName: 'price_pilot.menu_import.completed', requestId, routeOrFunction: 'price-pilot', httpStatus: 200, userId: user.id, artistBusinessId: businessId, message: 'Authorized menu import completed', context: { action, outcome: 'completed', extraction_count: items.length } });
    return Response.json({ data: { imported: items.length } }, { headers: cors });
  }
  if (action === 'list') {
    const { data, error } = await db.from('mova_price_pilot_observations').select('id,source_id,service_name,category,duration_minutes,price_min_minor,price_max_minor,currency,pricing_basis,extraction_confidence,observed_at,mova_price_pilot_sources!inner(normalized_host,submitted_url,status)').eq('artist_business_id', businessId).eq('mova_price_pilot_sources.status', 'active').gt('expires_at', new Date().toISOString()).order('observed_at', { ascending: false }).limit(300);
    if (error) return actionFailure('list', 'PRICE_PILOT_READ_FAILED', 500);
    await writeSystemLog({ level: 'info', source: 'function', eventName: 'price_pilot.observations.viewed', requestId, routeOrFunction: 'price-pilot', httpStatus: 200, userId: user.id, artistBusinessId: businessId, message: 'Price Pilot observations loaded', context: { action, outcome: 'completed', result_count: data?.length ?? 0 } });
    return Response.json({ data: { observations: data ?? [] } }, { headers: cors });
  }
  if (action === 'remove_source') {
    const sourceId = text(body.source_id, 50);
    const { error } = await db.from('mova_price_pilot_sources').update({ status: 'removed' }).eq('id', sourceId).eq('artist_business_id', businessId);
    if (error) return actionFailure('remove_source', 'PRICE_PILOT_REMOVE_FAILED', 500);
    await db.from('mova_price_pilot_observations').delete().eq('source_id', sourceId).eq('artist_business_id', businessId);
    await writeSystemLog({ level: 'info', source: 'function', eventName: 'price_pilot.source.removed', requestId, routeOrFunction: 'price-pilot', httpStatus: 200, userId: user.id, artistBusinessId: businessId, message: 'Price Pilot menu source removed', context: { action, outcome: 'completed' } });
    return Response.json({ data: { removed: true } }, { headers: cors });
  }
  return actionFailure(action || 'unknown', 'ACTION_NOT_SUPPORTED', 400);
}

Deno.serve(withSystemRequestLogging('price-pilot', handle));
