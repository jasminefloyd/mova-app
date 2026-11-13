import { withSystemRequestLogging } from '../_shared/system-log.ts';
import { artistClient, corsHeaders, respond, serviceClient } from '../_shared/booking.ts';
import { accessTokenFor, businessProfileReady, googleProvider, loadConnection, type GoogleConnectionRow } from '../_shared/google-connection.ts';
import { desiredListing, pendingListing, servicesMenu, type GoogleProvider, type HoursRow, type PendingChange, type ProfileRow, type ServiceRow, type Snapshot } from '../_shared/providers/google/index.ts';

// Listing and services sync (P6). Mova is the source: what it sends to the Google Business Profile is
// computed from Mova data, compared with the last snapshot, and only the waiting items are sent.
// Actions (stylist): status, push, set-auto-send. Cron (CRON_SECRET): auto-push-all, sends for every
// connection that has automatic sends on. Nothing is sent when Google is not configured.
const db = () => serviceClient();
const isServiceChange = (change: PendingChange) => change.kind.startsWith('service');
type Db = ReturnType<typeof serviceClient>;

async function desiredFor(client: Db, businessId: string) {
  const [{ data: profile }, { data: locations }, { data: services }] = await Promise.all([
    client.from('mova_artist_profiles').select('display_name,bio,handle').eq('artist_business_id', businessId).maybeSingle(),
    client.from('mova_locations').select('id').eq('artist_business_id', businessId).eq('is_active', true).order('created_at').limit(1),
    client.from('mova_services').select('id,name,status,base_price_minor,duration_minutes').eq('artist_business_id', businessId),
  ]);
  const locationId = locations?.[0]?.id as string | undefined;
  const { data: hours } = locationId ? await client.from('mova_location_hours').select('weekday,opens_at,closes_at').eq('location_id', locationId).order('weekday') : { data: [] };
  const items = desiredListing({
    profile: (profile ?? { display_name: '', bio: '', handle: '' }) as ProfileRow,
    hours: (hours ?? []) as HoursRow[],
    services: (services ?? []) as ServiceRow[],
    publicBaseUrl: Deno.env.get('PUBLIC_BASE_URL') ?? 'https://mova-beauty.co',
  });
  const names = new Map<string, string>((services ?? []).map((row: ServiceRow) => [`service:${row.id}`, row.name]));
  return { items, names };
}

async function snapshotsFor(client: Db, businessId: string): Promise<Snapshot[]> {
  const { data } = await client.from('mova_google_listing_snapshots').select('item_key,payload').eq('artist_business_id', businessId);
  return (data ?? []) as Snapshot[];
}

/** What is waiting for Google, grouped the way the listing screen shows it. */
function summarize(pending: PendingChange[]) {
  const waiting = (key: string) => pending.some((change) => change.key === key);
  const services = pending.filter((change) => isServiceChange(change));
  return {
    profile: waiting('profile') ? 'waiting' : 'up_to_date',
    hours: waiting('hours') ? 'waiting' : 'up_to_date',
    booking_link: waiting('booking_link') ? 'waiting' : 'up_to_date',
    services_waiting: services.length,
  };
}

/** Sends every waiting item to Google, then records the snapshot of what was sent. */
async function pushPending(client: Db, provider: GoogleProvider, connection: GoogleConnectionRow) {
  const businessId = connection.artist_business_id;
  const { items, names } = await desiredFor(client, businessId);
  const snapshots = await snapshotsFor(client, businessId);
  const pending = pendingListing(items, snapshots, names);
  if (!pending.length) return { sent: 0 };
  const locationId = connection.business_location_id!;
  let sent = 0;
  try {
    const accessToken = await accessTokenFor(provider, connection);
    for (const change of pending.filter((item) => !isServiceChange(item))) {
      const item = items.find((candidate) => candidate.key === change.key)!;
      await provider.applyListingItem(accessToken, locationId, item);
      await client.from('mova_google_listing_snapshots').upsert({ artist_business_id: businessId, item_key: item.key, payload: item.payload, synced_at: new Date().toISOString() }, { onConflict: 'artist_business_id,item_key' });
      sent++;
    }
    const menuChanged = pending.some((item) => isServiceChange(item));
    if (menuChanged) {
      await provider.applyListingItem(accessToken, locationId, servicesMenu(items));
      const serviceItems = items.filter((item) => item.key.startsWith('service:'));
      if (serviceItems.length) await client.from('mova_google_listing_snapshots').upsert(serviceItems.map((item) => ({ artist_business_id: businessId, item_key: item.key, payload: item.payload, synced_at: new Date().toISOString() })), { onConflict: 'artist_business_id,item_key' });
      const removed = pending.filter((item) => item.kind === 'service_removed').map((item) => item.key);
      if (removed.length) await client.from('mova_google_listing_snapshots').delete().eq('artist_business_id', businessId).in('item_key', removed);
      sent++;
    }
  } catch {
    await client.from('mova_google_listing_settings').upsert({ artist_business_id: businessId, last_sync_status: 'failed' }, { onConflict: 'artist_business_id' });
    throw Object.assign(new Error('GOOGLE_LISTING_SYNC_FAILED'), { sent });
  }
  await client.from('mova_google_listing_settings').upsert({ artist_business_id: businessId, last_synced_at: new Date().toISOString(), last_sync_status: 'synced' }, { onConflict: 'artist_business_id' });
  return { sent };
}

Deno.serve(withSystemRequestLogging('google-business-sync', async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ code: 'METHOD_NOT_ALLOWED' }, 405);
  const client = db();
  const provider = googleProvider(request);

  const cronSecret = Deno.env.get('CRON_SECRET');
  if (cronSecret && request.headers.get('Authorization') === `Bearer ${cronSecret}`) {
    const body = await request.json().catch(() => ({}));
    if (body.action !== 'auto-push-all') return respond({ code: 'INVALID_ACTION' }, 422);
    if (!provider) return respond({ code: 'GOOGLE_NOT_CONFIGURED', sent: 0 }, 503);
    const { data: rows } = await client.from('mova_google_connections').select('artist_business_id,google_account_email,refresh_token_encrypted,granted_scopes,status,calendar_enabled,calendar_id,business_profile_enabled,business_location_id,connected_at').eq('status', 'active').eq('business_profile_enabled', true).limit(100);
    let sent = 0; let failed = 0;
    for (const row of (rows ?? []) as GoogleConnectionRow[]) {
      if (!businessProfileReady(row)) continue;
      const { data: settings } = await client.from('mova_google_listing_settings').select('auto_send').eq('artist_business_id', row.artist_business_id).maybeSingle();
      if (settings && settings.auto_send === false) continue;
      try { sent += (await pushPending(client, provider, row)).sent; } catch { failed++; }
    }
    return respond({ sent, failed });
  }

  const actor = await artistClient(request);
  if (!actor) return respond({ code: 'UNAUTHENTICATED' }, 401);
  const body = await request.json().catch(() => ({}));
  const connection = await loadConnection(client, actor.businessId).catch(() => null);

  if (body.action === 'status') {
    const { data: settings } = await client.from('mova_google_listing_settings').select('auto_send,last_synced_at,last_sync_status').eq('artist_business_id', actor.businessId).maybeSingle();
    const ready = businessProfileReady(connection);
    let pending: PendingChange[] = [];
    if (ready) {
      const { items, names } = await desiredFor(client, actor.businessId);
      pending = pendingListing(items, await snapshotsFor(client, actor.businessId), names);
    }
    return respond({
      connected: connection?.status === 'active', business_profile_ready: ready, provider_configured: provider !== null,
      auto_send: settings?.auto_send ?? true, last_synced_at: settings?.last_synced_at ?? null, last_sync_status: settings?.last_sync_status ?? 'never',
      sections: summarize(pending), changes: pending.map((change) => ({ key: change.key, kind: change.kind, label: change.label })),
    });
  }

  if (body.action === 'set-auto-send') {
    if (typeof body.auto_send !== 'boolean') return respond({ code: 'INVALID_REQUEST' }, 422);
    const { error } = await client.from('mova_google_listing_settings').upsert({ artist_business_id: actor.businessId, auto_send: body.auto_send }, { onConflict: 'artist_business_id' });
    return error ? respond({ code: 'LISTING_SETTINGS_SAVE_FAILED' }, 500) : respond({ auto_send: body.auto_send });
  }

  if (body.action === 'push') {
    if (!provider) return respond({ code: 'GOOGLE_NOT_CONFIGURED', sent: 0 }, 503);
    if (!businessProfileReady(connection)) return respond({ code: 'GOOGLE_NOT_CONNECTED', sent: 0 }, 409);
    try {
      const result = await pushPending(client, provider, connection);
      return respond({ sent: result.sent, synced: true, provider: provider.name, live: provider.live });
    } catch (error) {
      return respond({ code: 'GOOGLE_LISTING_SYNC_FAILED', sent: (error as { sent?: number }).sent ?? 0 }, 502);
    }
  }
  return respond({ code: 'INVALID_ACTION' }, 422);
}));
