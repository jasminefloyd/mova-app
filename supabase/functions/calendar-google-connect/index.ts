import { artistClient, corsHeaders, respond, serviceClient } from '../_shared/booking.ts';
import { encryptProviderSecret, sha256Hex } from '../_shared/provider-crypto.ts';
import { accessTokenFor, connectionSummary, googleProvider, loadConnection, randomToken, s256Challenge } from '../_shared/google-connection.ts';
import { GOOGLE_BUSINESS_SCOPE, GOOGLE_CALENDAR_SCOPE, GOOGLE_SCOPES } from '../_shared/providers/google/index.ts';

// One Google connection per stylist (P6). It powers Business Profile and Google Calendar. The function keeps
// its original name so existing clients keep working. Actions: status, begin, disconnect, set-toggles,
// calendars, set-calendar, locations, set-business-location, save-settings, rotate-feed.
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ code: 'METHOD_NOT_ALLOWED' }, 405);
  const actor = await artistClient(request); if (!actor) return respond({ code: 'UNAUTHENTICATED' }, 401);
  const body = await request.json().catch(() => ({})); const db = serviceClient();
  const provider = googleProvider();

  if (body.action === 'status') {
    const [{ data: settings, error }, { data: locations }] = await Promise.all([
      db.from('mova_calendar_sync_settings').select('location_ids,apple_feed_enabled').eq('artist_business_id', actor.businessId).maybeSingle(),
      db.from('mova_locations').select('id,name').eq('artist_business_id', actor.businessId).eq('is_active', true).order('created_at'),
    ]);
    const connection = await loadConnection(db, actor.businessId).catch(() => null);
    if (error) return respond({ code: 'CALENDAR_SETTINGS_FAILED' }, 500);
    const { data: feed } = await db.from('mova_calendar_feed_tokens').select('id,created_at').eq('artist_business_id', actor.businessId).is('revoked_at', null).maybeSingle();
    return respond({ google: connectionSummary(connection), settings: settings ?? { location_ids: [], apple_feed_enabled: true }, locations: locations ?? [], feedConfigured: Boolean(feed), providerConfigured: provider !== null });
  }

  if (body.action === 'save-settings') {
    if (!Array.isArray(body.location_ids) || body.location_ids.some((id: unknown) => typeof id !== 'string')) return respond({ code: 'INVALID_REQUEST' }, 422);
    const { data: locations, error: locationError } = await db.from('mova_locations').select('id').eq('artist_business_id', actor.businessId).eq('is_active', true).in('id', body.location_ids.length ? body.location_ids : ['00000000-0000-0000-0000-000000000000']);
    if (locationError || locations?.length !== body.location_ids.length) return respond({ code: 'INVALID_LOCATION_FILTER' }, 422);
    const { error } = await db.from('mova_calendar_sync_settings').upsert({ artist_business_id: actor.businessId, location_ids: body.location_ids }, { onConflict: 'artist_business_id' });
    return error ? respond({ code: 'CALENDAR_SETTINGS_SAVE_FAILED' }, 500) : respond({ location_ids: body.location_ids });
  }

  if (body.action === 'begin') {
    const redirectUri = Deno.env.get('GOOGLE_OAUTH_REDIRECT_URI');
    if (!provider || !redirectUri || !Deno.env.get('MOVA_PROVIDER_TOKENS_KEK_HEX')) return respond({ code: 'GOOGLE_CALENDAR_NOT_CONFIGURED' }, 503);
    const state = randomToken(32); const verifier = randomToken(48);
    const { error } = await db.from('mova_google_oauth_states').insert({ artist_business_id: actor.businessId, state_hash: await sha256Hex(state), verifier_encrypted: await encryptProviderSecret(verifier), expires_at: new Date(Date.now() + 10 * 60_000).toISOString() });
    if (error) return respond({ code: 'GOOGLE_CONNECT_START_FAILED' }, 500);
    // Both permissions in one sign-in. Google asks the stylist once; nothing is connected until the callback succeeds.
    return respond({ authorizationUrl: provider.authorizationUrl({ redirectUri, state, codeChallenge: await s256Challenge(verifier), scopes: GOOGLE_SCOPES }) });
  }

  if (body.action === 'disconnect') {
    const { error } = await db.from('mova_google_connections').update({ status: 'revoked', refresh_token_encrypted: '\\x', calendar_enabled: false, business_profile_enabled: false }).eq('artist_business_id', actor.businessId);
    await db.from('mova_calendar_sync_settings').upsert({ artist_business_id: actor.businessId, google_enabled: false }, { onConflict: 'artist_business_id' });
    return error ? respond({ code: 'GOOGLE_DISCONNECT_FAILED' }, 500) : respond({ disconnected: true });
  }

  if (body.action === 'set-toggles') {
    const connection = await loadConnection(db, actor.businessId).catch(() => null);
    if (!connection || connection.status !== 'active') return respond({ code: 'GOOGLE_NOT_CONNECTED' }, 409);
    const patch: Record<string, boolean> = {};
    if (body.calendar_enabled !== undefined) { if (typeof body.calendar_enabled !== 'boolean') return respond({ code: 'INVALID_REQUEST' }, 422); patch.calendar_enabled = body.calendar_enabled; }
    if (body.business_profile_enabled !== undefined) { if (typeof body.business_profile_enabled !== 'boolean') return respond({ code: 'INVALID_REQUEST' }, 422); patch.business_profile_enabled = body.business_profile_enabled; }
    if (!Object.keys(patch).length) return respond({ code: 'INVALID_REQUEST' }, 422);
    if (patch.calendar_enabled && !connection.granted_scopes.includes(GOOGLE_CALENDAR_SCOPE)) return respond({ code: 'GOOGLE_PERMISSION_MISSING', permission: 'calendar' }, 409);
    if (patch.business_profile_enabled && !connection.granted_scopes.includes(GOOGLE_BUSINESS_SCOPE)) return respond({ code: 'GOOGLE_PERMISSION_MISSING', permission: 'business_profile' }, 409);
    const { error } = await db.from('mova_google_connections').update(patch).eq('artist_business_id', actor.businessId);
    if (error) return respond({ code: 'GOOGLE_SETTINGS_SAVE_FAILED' }, 500);
    if (patch.calendar_enabled !== undefined) await db.from('mova_calendar_sync_settings').upsert({ artist_business_id: actor.businessId, google_enabled: patch.calendar_enabled }, { onConflict: 'artist_business_id' });
    return respond({ saved: true, ...patch });
  }

  if (body.action === 'calendars' || body.action === 'set-calendar') {
    const connection = await loadConnection(db, actor.businessId).catch(() => null);
    if (!provider || !connection || connection.status !== 'active') return respond({ code: provider ? 'GOOGLE_NOT_CONNECTED' : 'GOOGLE_NOT_CONFIGURED' }, provider ? 409 : 503);
    const calendars = await (async () => { try { return await provider.listCalendars(await accessTokenFor(provider, connection)); } catch { return null; } })();
    if (!calendars) return respond({ code: 'GOOGLE_CALENDARS_FAILED' }, 502);
    if (body.action === 'calendars') return respond({ calendars: calendars.map((calendar) => ({ id: calendar.id, summary: calendar.summary, primary: calendar.primary })) });
    if (typeof body.calendar_id !== 'string' || !calendars.some((calendar) => calendar.id === body.calendar_id)) return respond({ code: 'GOOGLE_CALENDAR_INVALID' }, 422);
    const { error } = await db.from('mova_google_connections').update({ calendar_id: body.calendar_id }).eq('artist_business_id', actor.businessId);
    return error ? respond({ code: 'GOOGLE_SETTINGS_SAVE_FAILED' }, 500) : respond({ calendar_id: body.calendar_id });
  }

  if (body.action === 'locations' || body.action === 'set-business-location') {
    const connection = await loadConnection(db, actor.businessId).catch(() => null);
    if (!provider || !connection || connection.status !== 'active' || !connection.granted_scopes.includes(GOOGLE_BUSINESS_SCOPE)) return respond({ code: provider ? 'GOOGLE_PERMISSION_MISSING' : 'GOOGLE_NOT_CONFIGURED', permission: 'business_profile' }, provider ? 409 : 503);
    const locations = await (async () => { try { return await provider.listLocations(await accessTokenFor(provider, connection)); } catch { return null; } })();
    if (!locations) return respond({ code: 'GOOGLE_LOCATIONS_FAILED' }, 502);
    if (body.action === 'locations') return respond({ locations });
    if (typeof body.location_id !== 'string' || !locations.some((location) => location.id === body.location_id)) return respond({ code: 'GOOGLE_LOCATION_INVALID' }, 422);
    const { error } = await db.from('mova_google_connections').update({ business_location_id: body.location_id }).eq('artist_business_id', actor.businessId);
    return error ? respond({ code: 'GOOGLE_SETTINGS_SAVE_FAILED' }, 500) : respond({ business_location_id: body.location_id });
  }

  if (body.action === 'rotate-feed') {
    const token = randomToken(48);
    const { error } = await db.rpc('mova_rotate_calendar_feed_token', { p_artist_business_id: actor.businessId, p_token_hash: await sha256Hex(token) });
    if (error) return respond({ code: 'FEED_ROTATE_FAILED' }, 500);
    const publicBase = Deno.env.get('PUBLIC_BASE_URL') ?? 'https://mova-beauty.co';
    return respond({ feedUrl: `${publicBase.replace(/^https?:/, 'webcal:').replace(/\/$/, '')}/feed/${token}` });
  }
  return respond({ code: 'INVALID_ACTION' }, 422);
});

