// PricePilot (boards PP1–PP8; CR-019, decisions PP-D1..PP-D5 of 2026-11-23).
// Stylist-facing actions. The weekly salon search and menu reading run in job-dispatch
// (_shared/price-pilot-worker.ts). Nothing here changes a price except `apply`, on the stylist's tap.
import { artistClient, corsHeaders, serviceClient } from '../_shared/booking.ts';
import { planFeatureEnabled } from '../_shared/plan-feature.ts';
import { placeRatings } from '../_shared/google-places.ts';
import { areaCodes, fetchBlsHourlyMedians, seriesId } from '../_shared/bls-wage.ts';
import { buildEvidence, distanceMiles, findComparables, monthlyImpact, suggest, type Observation, type SourceInfo } from '../_shared/price-pilot-model.ts';
import { normalizePostal, readMenu, safeMenuUrl } from '../_shared/price-pilot-menus.ts';
import { censusGeocode } from '../_shared/census-geo.ts';
import { ensureLocationGeo, type LocationGeo } from '../_shared/price-pilot-worker.ts';
import { withSystemRequestLogging, writeSystemLog } from '../_shared/system-log.ts';

const allowedOrigins = /^https:\/\/(?:mova-beauty\.co|www\.mova-beauty\.co|[a-z0-9-]+\.vercel\.app)$/;
const cors = { ...corsHeaders, 'access-control-allow-headers': `${corsHeaders['access-control-allow-headers'] ?? 'authorization, x-client-info, apikey, content-type'}, x-mova-artist-business-id, x-request-id` };
const DAY = 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ok = (data: unknown) => Response.json({ data }, { headers: cors });
const fail = (code: string, status: number) => Response.json({ data: null, error: { code } }, { status, headers: cors });
const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const uuid = (value: unknown) => (typeof value === 'string' && UUID.test(value) ? value : null);
const host = (value: unknown) => { try { return new URL(String(value)).hostname.toLowerCase().replace(/^www\./, '') || null; } catch { return null; } };

// deno-lint-ignore no-explicit-any
type Db = any;
type SourceRow = {
  id: string; business_name: string | null; normalized_host: string; origin: string; menu_status: string; status: string;
  latitude: number | null; longitude: number | null; last_checked_at: string; google_place_id: string | null; location_id: string | null;
  market_postal_code: string | null; submitted_url: string; website_url: string | null;
};
type LocationRow = { id: string; name: string; address: Record<string, unknown> | null };

async function settingsFor(db: Db, businessId: string) {
  const { data } = await db.from('mova_price_pilot_settings').select('enabled,radius_miles,use_nearby_salons,use_competitor_menus,show_industry_context').eq('artist_business_id', businessId).maybeSingle();
  return { enabled: data?.enabled === true, radius_miles: Number(data?.radius_miles ?? 5), use_nearby_salons: data?.use_nearby_salons !== false, use_competitor_menus: data?.use_competitor_menus !== false, show_industry_context: data?.show_industry_context !== false };
}

async function usageFor(db: Db, businessId: string) {
  const now = new Date();
  const period = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const resets = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
  const [{ data: row }, { data: limit }] = await Promise.all([
    db.from('mova_price_pilot_usage').select('used').eq('artist_business_id', businessId).eq('period_start', period).maybeSingle(),
    db.rpc('mova_price_pilot_monthly_limit', { p_artist_business_id: businessId }),
  ]);
  return { used: Number(row?.used ?? 0), limit: Number(limit ?? 0), resets_on: resets };
}

/** Which salons count for one stylist location: menu read, inside the radius (or the same ZIP when either side has no coordinates). */
function sourcesNear(sources: SourceRow[], location: LocationRow, geo: LocationGeo | null, radius: number) {
  const out = new Map<string, SourceInfo & { row: SourceRow }>();
  const zip = normalizePostal(location.address?.postal_code);
  for (const source of sources) {
    let distance: number | null = null;
    if (geo?.lat != null && geo.lng != null && source.latitude != null && source.longitude != null) {
      distance = distanceMiles({ lat: geo.lat, lng: geo.lng }, { lat: source.latitude, lng: source.longitude });
      if (distance > radius) continue;
    } else if (!(zip && normalizePostal(source.market_postal_code) === zip) && source.location_id !== location.id) {
      continue;
    }
    out.set(source.id, { id: source.id, name: source.business_name || source.normalized_host, distance_miles: distance, checked_at: source.last_checked_at, row: source });
  }
  return out;
}

/** Everything PP1–PP6 need, computed from stored menus, the stylist's prices and their last 90 days of bookings. */
async function overview(db: Db, businessId: string) {
  const settings = await settingsFor(db, businessId);
  const [services, locations, sources, observations, dismissals, stats, runs, usage, profile] = await Promise.all([
    db.from('mova_services').select('id,name,category,duration_minutes,base_price_minor').eq('artist_business_id', businessId).eq('status', 'active').order('name'),
    db.from('mova_locations').select('id,name,address').eq('artist_business_id', businessId).eq('is_active', true).order('name'),
    db.from('mova_price_pilot_sources').select('id,business_name,normalized_host,origin,menu_status,status,latitude,longitude,last_checked_at,google_place_id,location_id,market_postal_code,submitted_url,website_url').eq('artist_business_id', businessId).eq('status', 'active'),
    db.from('mova_price_pilot_observations').select('source_id,service_name,category,duration_minutes,price_min_minor,price_max_minor,currency,extraction_confidence,observed_at').eq('artist_business_id', businessId).gt('expires_at', new Date().toISOString()).limit(5000),
    db.from('mova_price_pilot_dismissals').select('service_id,location_id,until').eq('artist_business_id', businessId).gt('until', new Date().toISOString()),
    db.rpc('mova_price_pilot_booking_stats', { p_artist_business_id: businessId }),
    db.from('mova_price_pilot_runs').select('id,status,location_id,requested_at,finished_at').eq('artist_business_id', businessId).order('requested_at', { ascending: false }).limit(20),
    usageFor(db, businessId),
    db.from('mova_artist_profiles').select('website_url').eq('artist_business_id', businessId).maybeSingle(),
  ]);
  for (const result of [services, locations, sources, observations, dismissals, stats]) if (result.error) throw new Error('PRICE_PILOT_READ_FAILED');
  const serviceRows = services.data ?? [];
  const { data: serviceLocations } = serviceRows.length
    ? await db.from('mova_service_locations').select('service_id,location_id,price_minor_override,duration_minutes_override').in('service_id', serviceRows.map((s: { id: string }) => s.id))
    : { data: [] };
  const allSources = (sources.data ?? []) as SourceRow[];
  const menuSources = allSources.filter((s) => s.menu_status === 'found');
  const locationRows = (locations.data ?? []) as LocationRow[];
  const geos = new Map<string, LocationGeo | null>();
  await Promise.all(locationRows.map(async (location) => geos.set(location.id, await ensureLocationGeo(db, { ...location, artist_business_id: businessId }))));
  const near = new Map(locationRows.map((l) => [l.id, sourcesNear(menuSources, l, geos.get(l.id) ?? null, settings.radius_miles)]));
  const statMap = new Map(((stats.data ?? []) as Array<{ service_id: string; location_id: string; bookings_90d: number; avg_lead_days: number | null }>).map((r) => [`${r.service_id}:${r.location_id}`, r]));
  const dismissed = new Set(((dismissals.data ?? []) as Array<{ service_id: string; location_id: string }>).map((r) => `${r.service_id}:${r.location_id}`));
  const obs = (observations.data ?? []) as Observation[];
  const now = Date.now();
  const rows = [];
  for (const service of serviceRows) {
    for (const link of (serviceLocations ?? []).filter((r: { service_id: string }) => r.service_id === service.id)) {
      const location = locationRows.find((l) => l.id === link.location_id);
      if (!location) continue;
      const current = link.price_minor_override ?? service.base_price_minor;
      const duration = link.duration_minutes_override ?? service.duration_minutes;
      const target = { name: service.name, category: service.category, duration_minutes: duration };
      const stat = statMap.get(`${service.id}:${location.id}`);
      const bookings = Number(stat?.bookings_90d ?? 0);
      const comparables = findComparables(obs, near.get(location.id) ?? new Map(), target, now);
      const evidence = buildEvidence(comparables, target, current, bookings, now);
      let suggestion = suggest(evidence, current);
      const isDismissed = suggestion.action === 'raise' && dismissed.has(`${service.id}:${location.id}`);
      if (isDismissed) suggestion = { action: 'hold', suggested_minor: current, above_range: false };
      rows.push({
        service_id: service.id, location_id: location.id, service_name: service.name, category: service.category, location_name: location.name,
        duration_minutes: duration, current_minor: current, own_location_price: link.price_minor_override != null,
        action: suggestion.action, suggested_minor: suggestion.suggested_minor, above_range: suggestion.above_range, dismissed: isDismissed,
        evidence: { count: evidence.count, min: evidence.min, max: evidence.max, median: evidence.median, range_low: evidence.range_low, range_high: evidence.range_high, below_count: evidence.below_count, checks: evidence.checks, passed: evidence.passed, confidence: evidence.confidence, latest_checked_at: evidence.latest_checked_at },
        bookings_90d: bookings, avg_lead_days: stat?.avg_lead_days == null ? null : Number(stat.avg_lead_days),
        impact: monthlyImpact(bookings, current, suggestion.suggested_minor),
      });
    }
  }
  const counted = new Set<string>();
  for (const map of near.values()) for (const id of map.keys()) counted.add(id);
  const updated = menuSources.reduce<string | null>((max, s) => (!max || s.last_checked_at > max ? s.last_checked_at : max), null);
  const raises = rows.filter((r) => r.action === 'raise');
  const runRows = (runs.data ?? []) as Array<{ status: string }>;
  return {
    available: true, settings, usage, rows,
    locations: locationRows.map((l) => ({ id: l.id, name: l.name, located: Boolean(geos.get(l.id)?.lat != null) })),
    summary: { salons: counted.size, updated_at: updated, suggestions: raises.length, monthly_change_minor: raises.reduce((sum, r) => sum + r.impact.change_minor, 0), searching: runRows.some((r) => r.status === 'queued' || r.status === 'running'), sources_total: allSources.length },
    own_website_host: host(profile.data?.website_url),
  };
}

async function blsFor(db: Db, env: (name: string) => string | undefined, geo: LocationGeo | null) {
  const codes = areaCodes(geo?.cbsa ?? null, geo?.state_fips ?? null);
  if (!codes.length) return null;
  const { data: cached } = await db.from('mova_price_pilot_bls_wages').select('area_code,area_type,hourly_median,data_year,fetched_at').in('area_code', codes.map((c) => c.code));
  const fresh = (cached ?? []).filter((row: { fetched_at: string }) => Date.parse(row.fetched_at) > Date.now() - 180 * DAY);
  let rows = fresh as Array<{ area_code: string; area_type: string; hourly_median: number | null; data_year: number | null }>;
  if (rows.length < codes.length) {
    const fetched = await fetchBlsHourlyMedians(codes.map((c) => seriesId(c.type, c.code)), env('MOVA_BLS_API_KEY'));
    const upserts = codes.map((c) => { const hit = fetched.get(seriesId(c.type, c.code)); return { area_code: c.code, area_type: c.type, hourly_median: hit?.value ?? null, data_year: hit?.year ?? null, fetched_at: new Date().toISOString() }; });
    if (fetched.size) await db.from('mova_price_pilot_bls_wages').upsert(upserts);
    rows = upserts;
  }
  for (const code of codes) {
    const row = rows.find((r) => r.area_code === code.code);
    if (row?.hourly_median) return { hourly_median: Number(row.hourly_median), area: code.type === 'M' ? 'metro' : 'state', year: row.data_year };
  }
  return null;
}

/** PP2/PP5 extras for one service at one location: the menus used, salons with no menu yet, live ratings, BLS pay. */
async function detail(db: Db, env: (name: string) => string | undefined, businessId: string, serviceId: string, locationId: string) {
  const data = await overview(db, businessId);
  const row = data.rows.find((r) => r.service_id === serviceId && r.location_id === locationId);
  if (!row) return null;
  const { data: locationRow } = await db.from('mova_locations').select('id,name,address').eq('id', locationId).eq('artist_business_id', businessId).maybeSingle();
  if (!locationRow) return null;
  const geo = await ensureLocationGeo(db, { ...locationRow, artist_business_id: businessId });
  const [{ data: sources }, { data: obs }] = await Promise.all([
    db.from('mova_price_pilot_sources').select('id,business_name,normalized_host,origin,menu_status,status,latitude,longitude,last_checked_at,google_place_id,location_id,market_postal_code,submitted_url,website_url').eq('artist_business_id', businessId).eq('status', 'active'),
    db.from('mova_price_pilot_observations').select('source_id,service_name,category,duration_minutes,price_min_minor,price_max_minor,currency,extraction_confidence,observed_at').eq('artist_business_id', businessId).gt('expires_at', new Date().toISOString()).limit(5000),
  ]);
  const all = (sources ?? []) as SourceRow[];
  const nearMenus = sourcesNear(all.filter((s) => s.menu_status === 'found'), locationRow, geo, data.settings.radius_miles);
  const comparables = findComparables((obs ?? []) as Observation[], nearMenus, { name: row.service_name, category: row.category, duration_minutes: row.duration_minutes });
  const withoutMenu = [...sourcesNear(all.filter((s) => s.origin === 'auto' && s.menu_status !== 'found'), locationRow, geo, data.settings.radius_miles).values()]
    .sort((a, b) => (a.distance_miles ?? 99) - (b.distance_miles ?? 99)).slice(0, 8);
  const placeIds = [...comparables.map((c) => nearMenus.get(c.source_id)?.row.google_place_id), ...withoutMenu.map((s) => s.row.google_place_id)].filter((id): id is string => Boolean(id));
  const ratings = await placeRatings(placeIds, { apiKey: env('MOVA_GOOGLE_PLACES_API_KEY') });
  const nearbyRatings = comparables.map((c) => ratings.get(nearMenus.get(c.source_id)?.row.google_place_id ?? '')?.rating).filter((r): r is number => typeof r === 'number');
  const [{ data: mova }, { data: google }] = await Promise.all([
    db.from('mova_reviews').select('rating').eq('artist_business_id', businessId).eq('moderation_status', 'approved').limit(1000),
    db.from('mova_google_reviews').select('rating').eq('artist_business_id', businessId).limit(1000),
  ]);
  const own = [...(mova ?? []), ...(google ?? [])].map((r: { rating: number }) => r.rating);
  return {
    row, radius_miles: data.settings.radius_miles,
    menus: comparables.map((c) => ({ source_id: c.source_id, name: c.name, distance_miles: c.distance_miles, checked_at: c.checked_at, price_minor: c.price_minor })),
    without_menu: withoutMenu.map((s) => ({ source_id: s.id, name: s.name, distance_miles: s.distance_miles, rating: ratings.get(s.row.google_place_id ?? '')?.rating ?? null, website_url: s.row.website_url })),
    ratings: { nearby_average: nearbyRatings.length >= 3 ? Math.round((nearbyRatings.reduce((a, b) => a + b, 0) / nearbyRatings.length) * 10) / 10 : null, own_average: own.length >= 3 ? Math.round((own.reduce((a, b) => a + b, 0) / own.length) * 10) / 10 : null },
    bls: data.settings.show_industry_context ? await blsFor(db, env, geo) : null,
  };
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
  let body: Record<string, unknown>;
  try { body = await request.json(); if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error(); } catch { return fail('INVALID_BODY', 400); }
  const action = text(body.action, 30);
  const db = serviceClient();
  const env = (name: string) => Deno.env.get(name);
  const log = (eventName: string, level: 'info' | 'warning' | 'error', status: number, context: Record<string, unknown>, errorCode: string | null = null) =>
    writeSystemLog({ level, source: 'function', eventName, requestId, routeOrFunction: 'price-pilot', httpStatus: status, userId: user.id, artistBusinessId: businessId, errorCode, message: `PricePilot ${action}`, context: { action, ...context } });
  const failed = async (code: string, status: number) => { await log('price_pilot.action.failed', status >= 500 ? 'error' : 'warning', status, { outcome: 'failed' }, code); return fail(code, status); };

  // Fails closed: a plan without PricePilot sees PP8 with the unlock path, nothing else.
  if (!(await planFeatureEnabled(businessId, 'ai_price_pilot'))) {
    if (action === 'overview') return ok({ available: false });
    return failed('PRICE_PILOT_FEATURE_DISABLED', 403);
  }
  const reserveCheck = async (): Promise<Response | null> => {
    const { error } = await db.rpc('mova_price_pilot_consume', { p_artist_business_id: businessId });
    if (!error) return null;
    return String(error.message).includes('PRICE_PILOT_LIMIT_REACHED') ? failed('PRICE_PILOT_LIMIT_REACHED', 429) : failed('PRICE_PILOT_USAGE_FAILED', 500);
  };

  try {
    if (action === 'overview') return ok(await overview(db, businessId));

    if (action === 'detail') {
      const serviceId = uuid(body.service_id); const locationId = uuid(body.location_id);
      if (!serviceId || !locationId) return failed('TARGET_REQUIRED', 400);
      const result = await detail(db, env, businessId, serviceId, locationId);
      return result ? ok(result) : failed('TARGET_NOT_FOUND', 404);
    }

    if (action === 'enable') {
      const now = new Date().toISOString();
      const { error } = await db.from('mova_price_pilot_settings').upsert({ artist_business_id: businessId, enabled: true, enabled_at: now, updated_at: now });
      if (error) return failed('PRICE_PILOT_SAVE_FAILED', 500);
      const { data: locations } = await db.from('mova_locations').select('id').eq('artist_business_id', businessId).eq('is_active', true);
      if (locations?.length) await db.from('mova_price_pilot_runs').insert(locations.map((l: { id: string }) => ({ artist_business_id: businessId, location_id: l.id, trigger: 'enabled' })));
      await log('price_pilot.enabled', 'info', 200, { outcome: 'completed', locations: locations?.length ?? 0 });
      return ok({ enabled: true });
    }

    if (action === 'find_salons') {
      const locationId = uuid(body.location_id);
      if (!locationId) return failed('LOCATION_REQUIRED', 400);
      const { data: location } = await db.from('mova_locations').select('id').eq('id', locationId).eq('artist_business_id', businessId).eq('is_active', true).maybeSingle();
      if (!location) return failed('LOCATION_NOT_FOUND', 404);
      const { data: pending } = await db.from('mova_price_pilot_runs').select('id').eq('location_id', locationId).in('status', ['queued', 'running']).limit(1);
      if (pending?.length) return ok({ queued: true });
      const limited = await reserveCheck(); if (limited) return limited;
      await db.from('mova_price_pilot_runs').insert({ artist_business_id: businessId, location_id: locationId, trigger: 'stylist' });
      return ok({ queued: true });
    }

    if (action === 'add_menu') {
      const settings = await settingsFor(db, businessId);
      if (!settings.use_competitor_menus) return failed('COMPETITOR_MENUS_OFF', 409);
      if (body.authorized !== true) return failed('AUTHORIZATION_REQUIRED', 400);
      const url = safeMenuUrl(body.url);
      if (!url) return failed('MENU_URL_INVALID', 400);
      const limited = await reserveCheck(); if (limited) return limited;
      const result = await readMenu(url, env('FIRECRAWL_API_KEY'));
      if (result.status === 'not_configured') return failed('FIRECRAWL_NOT_CONFIGURED', 503);
      if (result.status === 'failed') return failed('MENU_READ_FAILED', 502);
      if (!result.rows.length) return failed('NO_MENU_PRICES_FOUND', 422);
      const { data: profile } = await db.from('mova_artist_profiles').select('website_url').eq('artist_business_id', businessId).maybeSingle();
      const own = host(profile?.website_url) === url.hostname.replace(/^www\./, '');
      const now = Date.now();
      const place = result.location?.address_excerpt ? await censusGeocode(result.location.address_excerpt) : null;
      const locationId = uuid(body.location_id);
      const { data: source, error } = await db.from('mova_price_pilot_sources').upsert({
        artist_business_id: businessId, submitted_url: `${url.origin}${url.pathname}`, normalized_host: url.hostname, authorization_confirmed: true,
        origin: own ? 'own_site' : 'stylist', status: 'active', menu_status: 'found', business_name: result.businessName, location_id: locationId,
        last_checked_at: new Date(now).toISOString(), next_check_at: new Date(now + 7 * DAY).toISOString(), fail_count: 0,
        market_region: result.location?.region ?? null, market_postal_code: result.location?.postal_code ?? null, market_country_code: result.location?.country_code ?? null,
        market_location_expires_at: result.location ? new Date(now + 45 * DAY).toISOString() : null,
        latitude: place?.lat ?? null, longitude: place?.lng ?? null, geo_source: place ? 'census' : null, geo_expires_at: null,
      }, { onConflict: 'artist_business_id,submitted_url' }).select('id').single();
      if (error || !source) return failed('PRICE_PILOT_SAVE_FAILED', 500);
      const { error: replaceError } = await db.rpc('mova_price_pilot_replace_observations', { p_artist_business_id: businessId, p_source_id: source.id, p_rows: result.rows });
      if (replaceError) return failed('PRICE_PILOT_SAVE_FAILED', 500);
      await log('price_pilot.menu_added', 'info', 200, { outcome: 'completed', extraction_count: result.rows.length, own_site: own });
      return ok({ imported: result.rows.length, name: result.businessName ?? url.hostname });
    }

    if (action === 'remove_source') {
      const sourceId = uuid(body.source_id);
      const { data: removed, error } = await db.from('mova_price_pilot_sources').update({ status: 'removed', next_check_at: null }).eq('id', sourceId).eq('artist_business_id', businessId).select('id');
      if (error) return failed('PRICE_PILOT_REMOVE_FAILED', 500);
      if (!removed?.length) return failed('SOURCE_NOT_FOUND', 404);
      await db.from('mova_price_pilot_observations').delete().eq('source_id', sourceId).eq('artist_business_id', businessId);
      return ok({ removed: true });
    }

    if (action === 'apply') {
      const changes = Array.isArray(body.changes) ? body.changes.slice(0, 50).map((raw) => {
        const c = (raw ?? {}) as Record<string, unknown>;
        return { service_id: uuid(c.service_id), location_id: uuid(c.location_id), new_price_minor: Number(c.new_price_minor), expected_current_minor: Number(c.expected_current_minor),
          reference_median_minor: Number.isInteger(c.reference_median_minor) ? c.reference_median_minor : null, evidence_count: Number.isInteger(c.evidence_count) ? c.evidence_count : null };
      }) : [];
      if (!changes.length || changes.some((c) => !c.service_id || !c.location_id || !Number.isInteger(c.new_price_minor) || c.new_price_minor < 1 || !Number.isInteger(c.expected_current_minor))) return failed('CHANGES_INVALID', 400);
      const { data, error } = await db.rpc('mova_price_pilot_apply', { p_artist_business_id: businessId, p_user_id: user.id, p_changes: changes });
      if (error) {
        const message = String(error.message);
        if (message.includes('PRICE_CHANGED')) return failed('PRICE_CHANGED', 409);
        if (message.includes('NOT_FOUND') || message.includes('NOT_OFFERED')) return failed('TARGET_NOT_FOUND', 404);
        return failed('PRICE_PILOT_SAVE_FAILED', 500);
      }
      await log('price_pilot.prices_applied', 'info', 200, { outcome: 'completed', count: changes.length });
      return ok({ applied: data });
    }

    if (action === 'dismiss') {
      const serviceId = uuid(body.service_id); const locationId = uuid(body.location_id);
      if (!serviceId || !locationId) return failed('TARGET_REQUIRED', 400);
      const { data: service } = await db.from('mova_services').select('id').eq('id', serviceId).eq('artist_business_id', businessId).maybeSingle();
      if (!service) return failed('TARGET_NOT_FOUND', 404);
      const { error } = await db.from('mova_price_pilot_dismissals').upsert({ artist_business_id: businessId, service_id: serviceId, location_id: locationId, until: new Date(Date.now() + 30 * DAY).toISOString() });
      return error ? failed('PRICE_PILOT_SAVE_FAILED', 500) : ok({ dismissed: true });
    }

    if (action === 'settings_save') {
      const update: Record<string, unknown> = { artist_business_id: businessId, updated_at: new Date().toISOString() };
      if (body.radius_miles !== undefined) {
        const radius = Number(body.radius_miles);
        if (!Number.isInteger(radius) || radius < 1 || radius > 25) return failed('RADIUS_INVALID', 400);
        update.radius_miles = radius;
      }
      for (const key of ['use_nearby_salons', 'use_competitor_menus', 'show_industry_context']) {
        if (body[key] !== undefined) { if (typeof body[key] !== 'boolean') return failed('SETTINGS_INVALID', 400); update[key] = body[key]; }
      }
      const { error } = await db.from('mova_price_pilot_settings').upsert(update);
      if (error) return failed('PRICE_PILOT_SAVE_FAILED', 500);
      return ok(await settingsFor(db, businessId));
    }

    return failed('ACTION_NOT_SUPPORTED', 400);
  } catch {
    return failed('PRICE_PILOT_READ_FAILED', 500);
  }
}

Deno.serve(withSystemRequestLogging('price-pilot', handle));
