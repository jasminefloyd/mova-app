import { withSystemRequestLogging, loggedProviderFetch } from '../_shared/system-log.ts';
import { artistClient, corsHeaders, respond, serviceClient } from '../_shared/booking.ts';
import { decryptProviderSecret, encryptProviderSecret, sha256Hex } from '../_shared/provider-crypto.ts';
import { metaConnectProviderFromEnv } from '../_shared/providers/meta/live.ts';
import { planFeatureEnabled } from '../_shared/plan-feature.ts';

// Connections › Meta (CN5): one Meta connection per stylist (a Facebook Page and the Instagram professional
// account linked to it) so the Concierge can answer Instagram DMs and Page messages.
// POST actions: status, begin, set-channel, disconnect. GET: the Facebook Login redirect.
// Off unless MOVA_META_CONNECT_ENABLED=true with MOVA_META_PROVIDER=meta (or fake for local runs).

const CHANNELS = ['instagram', 'messenger'] as const;
type Channel = typeof CHANNELS[number];
const randomToken = () => [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('');
const operatorRedirect = (path: string) => Response.redirect(`${Deno.env.get('OPERATOR_BASE_URL') ?? 'https://ops.mova-beauty.co'}${path}`, 303);

Deno.serve(withSystemRequestLogging('meta-connect', async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const env = (name: string) => Deno.env.get(name);
  const provider = metaConnectProviderFromEnv(env, loggedProviderFetch(request, 'meta'));
  const db = serviceClient();

  if (request.method === 'GET') {
    const url = new URL(request.url);
    const code = url.searchParams.get('code'); const state = url.searchParams.get('state');
    if (!state || state.length !== 64) return operatorRedirect('/auth?meta=connect_error');
    const { data: stateRow } = await db.from('mova_meta_oauth_states').select('id,artist_business_id,expires_at,consumed_at').eq('state_hash', await sha256Hex(state)).maybeSingle();
    if (!stateRow || stateRow.consumed_at || Date.parse(stateRow.expires_at) < Date.now()) return operatorRedirect('/auth?meta=connect_error');
    const { data: consumed } = await db.from('mova_meta_oauth_states').update({ consumed_at: new Date().toISOString() }).eq('id', stateRow.id).is('consumed_at', null).select('id').maybeSingle();
    if (!consumed) return operatorRedirect('/auth?meta=connect_error');
    const businessId = stateRow.artist_business_id as string;
    const back = (outcome: string) => operatorRedirect(`/${encodeURIComponent(businessId)}/settings/connections/meta?meta=${outcome}`);
    // Declined in Facebook Login, or switched off since the stylist started.
    if (!code || !provider) return back('cancelled');
    try {
      const { userToken, scopes } = await provider.exchangeCode(code);
      const pages = await provider.listPages(userToken);
      // Instagram DMs need a Page with an Instagram professional account; a Page alone still gets Page messages.
      const page = pages.find((item) => item.instagram) ?? pages[0];
      if (!page) return back('no_page');
      await provider.subscribePage(page);
      const { error } = await db.from('mova_meta_connections').upsert({
        artist_business_id: businessId, status: 'active', page_id: page.id, page_name: page.name,
        instagram_user_id: page.instagram?.id ?? null, instagram_username: page.instagram?.username || null,
        page_token_encrypted: await encryptProviderSecret(page.accessToken), user_token_encrypted: await encryptProviderSecret(userToken),
        granted_scopes: scopes, connected_at: new Date().toISOString(),
      }, { onConflict: 'artist_business_id' });
      if (error) return back(error.code === '23505' ? 'page_taken' : 'connect_error');
      // The webhook finds the stylist from the account a message was sent to.
      const identities = [{ channel: 'messenger', address: page.id }, ...(page.instagram ? [{ channel: 'instagram', address: page.instagram.id }] : [])];
      await db.from('mova_sending_identities').update({ status: 'inactive' }).eq('artist_business_id', businessId).in('channel', ['instagram', 'messenger']);
      await db.from('mova_sending_identities').upsert(identities.map((identity) => ({ artist_business_id: businessId, ...identity, provider: provider.name, registration_status: 'approved', status: 'active' })),
        { onConflict: 'artist_business_id,channel,address' });
      return back(page.instagram ? 'connected' : 'connected_no_instagram');
    } catch {
      return back('connect_error');
    }
  }

  if (request.method !== 'POST') return respond({ code: 'METHOD_NOT_ALLOWED' }, 405);
  const actor = await artistClient(request);
  if (!actor) return respond({ code: 'UNAUTHENTICATED' }, 401);
  const body = await request.json().catch(() => ({}));

  const readChannels = async () => {
    const { data } = await db.from('mova_concierge_settings').select('channels').eq('artist_business_id', actor.businessId).maybeSingle();
    return (data?.channels ?? {}) as Record<string, boolean>;
  };

  if (body.action === 'status') {
    const { data: connection, error } = await db.from('mova_meta_connections')
      .select('status,page_id,page_name,instagram_user_id,instagram_username,connected_at,last_message_at').eq('artist_business_id', actor.businessId).maybeSingle();
    if (error) return respond({ code: 'META_CONNECTION_READ_FAILED' }, 500);
    const channels = await readChannels();
    return respond({
      connection: connection && connection.status === 'active' ? connection : null,
      channels: { instagram: channels.instagram === true, messenger: channels.messenger === true },
      provider_configured: provider !== null,
      plan_included: await planFeatureEnabled(actor.businessId, 'concierge_instagram'),
    });
  }

  if (body.action === 'begin') {
    if (!provider) return respond({ code: 'META_NOT_CONFIGURED' }, 503);
    const state = randomToken();
    const { error } = await db.from('mova_meta_oauth_states').insert({ artist_business_id: actor.businessId, state_hash: await sha256Hex(state), expires_at: new Date(Date.now() + 10 * 60_000).toISOString() });
    if (error) return respond({ code: 'META_CONNECT_START_FAILED' }, 500);
    return respond({ authorization_url: provider.authorizationUrl(state) });
  }

  if (body.action === 'set-channel') {
    if (!CHANNELS.includes(body.channel) || typeof body.enabled !== 'boolean') return respond({ code: 'INVALID_REQUEST' }, 422);
    const channel = body.channel as Channel;
    if (body.enabled) {
      const { data: connection } = await db.from('mova_meta_connections').select('status,instagram_user_id').eq('artist_business_id', actor.businessId).maybeSingle();
      if (connection?.status !== 'active') return respond({ code: 'META_NOT_CONNECTED' }, 409);
      if (channel === 'instagram' && !connection.instagram_user_id) return respond({ code: 'META_INSTAGRAM_MISSING' }, 409);
      if (!await planFeatureEnabled(actor.businessId, 'concierge_instagram')) return respond({ code: 'PLAN_FEATURE_NOT_INCLUDED', feature: 'concierge_instagram' }, 403);
    }
    const channels = { ...(await readChannels()), [channel]: body.enabled };
    const { error } = await db.from('mova_concierge_settings').upsert({ artist_business_id: actor.businessId, channels, updated_at: new Date().toISOString() }, { onConflict: 'artist_business_id' });
    if (error) return respond({ code: 'CONCIERGE_SETTINGS_SAVE_FAILED' }, 500);
    return respond({ channel, enabled: body.enabled });
  }

  if (body.action === 'disconnect') {
    const { data: connection } = await db.from('mova_meta_connections').select('status,page_id,page_token_encrypted,user_token_encrypted').eq('artist_business_id', actor.businessId).maybeSingle();
    if (connection && connection.status === 'active' && provider) {
      // Best effort with Meta; Mova's side is always cleared so nothing more is received or sent.
      try { await provider.unsubscribePage(connection.page_id, await decryptProviderSecret(connection.page_token_encrypted)); } catch { /* already removed in Meta */ }
      try { if (connection.user_token_encrypted) await provider.revoke(await decryptProviderSecret(connection.user_token_encrypted)); } catch { /* already revoked */ }
    }
    const { error } = await db.from('mova_meta_connections').update({ status: 'revoked', page_token_encrypted: '\\x', user_token_encrypted: null }).eq('artist_business_id', actor.businessId);
    if (error) return respond({ code: 'META_DISCONNECT_FAILED' }, 500);
    await db.from('mova_sending_identities').update({ status: 'inactive' }).eq('artist_business_id', actor.businessId).in('channel', ['instagram', 'messenger']);
    const channels = { ...(await readChannels()), instagram: false, messenger: false };
    await db.from('mova_concierge_settings').upsert({ artist_business_id: actor.businessId, channels, updated_at: new Date().toISOString() }, { onConflict: 'artist_business_id' });
    return respond({ disconnected: true });
  }

  return respond({ code: 'INVALID_ACTION' }, 422);
}));
