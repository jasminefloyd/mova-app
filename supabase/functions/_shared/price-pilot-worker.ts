// PricePilot background work, run by job-dispatch every tick (CR-019, PP-D1):
// 1. clear expired Google coordinates, 2. queue weekly discovery runs, 3. find nearby salons for queued
// runs (Google Places), 4. read due salon menus (Firecrawl), one week apart. Weekly refreshes never use the
// stylist's monthly checks. Every step fails soft: an unconfigured provider leaves work queued, never invents data.
import { searchGooglePlaces } from './google-places.ts';
import { addressLine, censusGeocode } from './census-geo.ts';
import { distanceMiles } from './price-pilot-model.ts';
import { firecrawlMap, pickMenuUrl, readMenu, safeMenuUrl } from './price-pilot-menus.ts';
import { writeSystemLog } from './system-log.ts';

// deno-lint-ignore no-explicit-any
type Db = any;
type Env = (name: string) => string | undefined;
const DAY = 24 * 60 * 60 * 1000;
const MILE_METERS = 1609.34;

export type LocationGeo = { lat: number | null; lng: number | null; cbsa: string | null; state_fips: string | null };

/** Census coordinates for a stylist location, cached until the address changes. */
export async function ensureLocationGeo(db: Db, location: { id: string; artist_business_id: string; address: Record<string, unknown> | null }, fetchImpl: typeof fetch = fetch): Promise<LocationGeo | null> {
  const line = addressLine(location.address);
  if (!line) return null;
  const { data: cached } = await db.from('mova_price_pilot_location_geo').select('address_key,latitude,longitude,cbsa_code,state_fips,matched,geocoded_at').eq('location_id', location.id).maybeSingle();
  const stale = cached && !cached.matched && Date.parse(cached.geocoded_at) < Date.now() - 7 * DAY;
  if (cached && cached.address_key === line && !stale) return { lat: cached.latitude, lng: cached.longitude, cbsa: cached.cbsa_code, state_fips: cached.state_fips };
  const place = await censusGeocode(line, fetchImpl);
  await db.from('mova_price_pilot_location_geo').upsert({
    location_id: location.id, artist_business_id: location.artist_business_id, address_key: line,
    latitude: place?.lat ?? null, longitude: place?.lng ?? null, cbsa_code: place?.cbsa ?? null, state_fips: place?.stateFips ?? null,
    matched: Boolean(place), geocoded_at: new Date().toISOString(),
  });
  return place ? { lat: place.lat, lng: place.lng, cbsa: place.cbsa, state_fips: place.stateFips } : null;
}

/** Finds nearby salons for one stylist location and records them as sources to read. */
export async function discoverForRun(db: Db, env: Env, run: { id: string; artist_business_id: string; location_id: string }, fetchImpl: typeof fetch = fetch) {
  const finish = (status: 'done' | 'failed', found: number, error: string | null) =>
    db.from('mova_price_pilot_runs').update({ status, found_count: found, error_code: error, finished_at: new Date().toISOString() }).eq('id', run.id);
  const [{ data: location }, { data: settings }] = await Promise.all([
    db.from('mova_locations').select('id,artist_business_id,address,is_active').eq('id', run.location_id).eq('artist_business_id', run.artist_business_id).maybeSingle(),
    db.from('mova_price_pilot_settings').select('radius_miles,use_nearby_salons,enabled').eq('artist_business_id', run.artist_business_id).maybeSingle(),
  ]);
  if (!location?.is_active || !settings?.enabled) return finish('done', 0, 'SKIPPED');
  if (settings.use_nearby_salons === false) return finish('done', 0, 'NEARBY_OFF');
  const geo = await ensureLocationGeo(db, location, fetchImpl);
  const radius = Number(settings.radius_miles ?? 5);
  const zip = typeof location.address?.postal_code === 'string' ? location.address.postal_code : '';
  let found;
  try {
    found = await searchGooglePlaces(geo?.lat != null ? 'hair salon' : `hair salon near ${zip}`, {
      apiKey: env('MOVA_GOOGLE_PLACES_API_KEY'), maxResults: 20, fetchImpl,
      near: geo?.lat != null && geo.lng != null ? { lat: geo.lat, lng: geo.lng, radiusMeters: radius * MILE_METERS } : undefined,
    });
  } catch {
    return finish('failed', 0, 'PLACES_FAILED');
  }
  if (!found.configured) return finish('failed', 0, 'PLACES_NOT_CONFIGURED');
  let count = 0;
  const geoExpires = new Date(Date.now() + 30 * DAY).toISOString();
  for (const place of found.results) {
    const distance = geo?.lat != null && geo.lng != null && place.lat != null && place.lng != null ? distanceMiles({ lat: geo.lat, lng: geo.lng }, { lat: place.lat, lng: place.lng }) : null;
    if (distance !== null && distance > radius) continue;
    const website = safeMenuUrl(place.website);
    const fallback = safeMenuUrl(place.mapsUrl);
    const anchor = website ?? fallback;
    if (!anchor) continue;
    const { data: existing } = await db.from('mova_price_pilot_sources').select('id,menu_status,status').eq('artist_business_id', run.artist_business_id).eq('google_place_id', place.placeId).maybeSingle();
    const common = { business_name: place.name.slice(0, 160), latitude: place.lat, longitude: place.lng, geo_source: place.lat != null ? 'google' : null, geo_expires_at: place.lat != null ? geoExpires : null, location_id: run.location_id };
    if (existing) {
      if (existing.status === 'removed') continue;
      await db.from('mova_price_pilot_sources').update(common).eq('id', existing.id);
    } else {
      const { error } = await db.from('mova_price_pilot_sources').insert({
        artist_business_id: run.artist_business_id, submitted_url: `${anchor.origin}${anchor.pathname}`, normalized_host: anchor.hostname,
        authorization_confirmed: false, origin: 'auto', status: 'active', google_place_id: place.placeId, website_url: website ? website.toString() : null,
        menu_status: website ? 'pending' : 'no_menu', next_check_at: website ? new Date().toISOString() : null, ...common,
      });
      if (error) continue; // e.g. a chain sharing one website already recorded
    }
    count += 1;
  }
  await writeSystemLog({ level: 'info', source: 'job', eventName: 'price_pilot.discovery.completed', routeOrFunction: 'job-dispatch', artistBusinessId: run.artist_business_id, message: 'PricePilot nearby salons found', context: { outcome: 'completed', result_count: count } }).catch(() => {});
  return finish('done', count, null);
}

/** Reads one salon's menu: find the price page on its site when needed, then replace its prices. */
// deno-lint-ignore no-explicit-any
export async function checkSource(db: Db, env: Env, source: Record<string, any>, fetchImpl: typeof fetch = fetch) {
  const key = env('FIRECRAWL_API_KEY');
  const now = Date.now();
  if (!key) {
    await db.from('mova_price_pilot_sources').update({ next_check_at: new Date(now + DAY).toISOString() }).eq('id', source.id);
    return 'not_configured';
  }
  let menuUrl = safeMenuUrl(source.submitted_url);
  if (source.origin === 'auto' && source.menu_status === 'pending' && source.website_url) {
    const site = safeMenuUrl(source.website_url);
    if (site) {
      const links = await firecrawlMap(site, key, fetchImpl);
      menuUrl = (links && pickMenuUrl(links, site)) || site;
    }
  }
  if (!menuUrl) {
    await db.from('mova_price_pilot_sources').update({ menu_status: 'no_menu', next_check_at: null }).eq('id', source.id);
    return 'no_menu';
  }
  const result = await readMenu(menuUrl, key, fetchImpl);
  if (result.status !== 'ok') {
    const fails = Number(source.fail_count ?? 0) + 1;
    await db.from('mova_price_pilot_sources').update({
      fail_count: Math.min(100, fails), menu_status: fails >= 3 ? (source.origin === 'auto' ? 'no_menu' : 'failed') : source.menu_status,
      next_check_at: new Date(now + (fails >= 3 ? 7 : 1) * DAY).toISOString(),
    }).eq('id', source.id);
    return 'failed';
  }
  if (!result.rows.length) {
    await db.from('mova_price_pilot_sources').update({ menu_status: 'no_menu', last_checked_at: new Date(now).toISOString(), next_check_at: new Date(now + 7 * DAY).toISOString(), fail_count: 0 }).eq('id', source.id);
    return 'no_menu';
  }
  const { error } = await db.rpc('mova_price_pilot_replace_observations', { p_artist_business_id: source.artist_business_id, p_source_id: source.id, p_rows: result.rows });
  if (error) return 'failed';
  const update: Record<string, unknown> = {
    menu_status: 'found', fail_count: 0, last_checked_at: new Date(now).toISOString(), next_check_at: new Date(now + 7 * DAY).toISOString(),
    market_region: result.location?.region ?? null, market_postal_code: result.location?.postal_code ?? null, market_country_code: result.location?.country_code ?? null,
    market_location_expires_at: result.location ? new Date(now + 45 * DAY).toISOString() : null,
  };
  if (!source.business_name && result.businessName) update.business_name = result.businessName;
  const menuPath = `${menuUrl.origin}${menuUrl.pathname}`;
  if (menuPath !== source.submitted_url) update.submitted_url = menuPath;
  // A menu the stylist added has no Google coordinates; place it with the public Census geocoder.
  if (source.latitude == null && result.location?.address_excerpt) {
    const place = await censusGeocode(result.location.address_excerpt, fetchImpl);
    if (place) Object.assign(update, { latitude: place.lat, longitude: place.lng, geo_source: 'census', geo_expires_at: null });
  }
  const { error: updateError } = await db.from('mova_price_pilot_sources').update(update).eq('id', source.id);
  if (updateError && update.submitted_url) { delete update.submitted_url; await db.from('mova_price_pilot_sources').update(update).eq('id', source.id); }
  return 'found';
}

/** One job-dispatch tick. Stops starting new work after the budget so the tick ends on time. */
export async function runPricePilotTick(db: Db, env: Env, budgetMs = 25_000) {
  const started = Date.now();
  const summary = { expired: 0, queued: 0, runs: 0, checks: 0 };
  const { data: expired } = await db.rpc('mova_price_pilot_expire_google_coordinates');
  summary.expired = Number(expired ?? 0);
  const { data: queued } = await db.rpc('mova_price_pilot_enqueue_due_runs');
  summary.queued = Number(queued ?? 0);
  const { data: runs } = await db.rpc('mova_price_pilot_claim_runs', { p_limit: 2 });
  for (const run of runs ?? []) {
    if (Date.now() - started > budgetMs) { await db.from('mova_price_pilot_runs').update({ status: 'queued', started_at: null }).eq('id', run.id); continue; }
    await discoverForRun(db, env, run);
    summary.runs += 1;
  }
  if (Date.now() - started < budgetMs) {
    const { data: sources } = await db.rpc('mova_price_pilot_claim_sources', { p_limit: 3 });
    const results = await Promise.all((sources ?? []).map((source: Record<string, unknown>) => checkSource(db, env, source).catch(() => 'failed')));
    summary.checks = results.length;
  }
  return summary;
}
