import { withSystemRequestLogging } from '../_shared/system-log.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.119.0';
import { corsHeaders, respond, serviceClient } from '../_shared/booking.ts';
import { deriveClientCardToken, sha256Hex } from '../_shared/provider-crypto.ts';
import { planFeatureEnabled } from '../_shared/plan-feature.ts';

Deno.serve(withSystemRequestLogging('client-card-token', async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ code: 'METHOD_NOT_ALLOWED' }, 405);
  if (Deno.env.get('MOVA_CLIENT_PROFILES_ENABLED') !== 'true') return respond({ code: 'CLIENT_PROFILES_DISABLED' }, 403);
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_ANON_KEY');
  const authorization = request.headers.get('Authorization');
  if (!url || !key || !authorization) return respond({ code: 'UNAUTHENTICATED' }, 401);

  const auth = createClient(url, key, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return respond({ code: 'UNAUTHENTICATED' }, 401);
  const body = await request.json().catch(() => ({}));
  if (typeof body.artist_business_id !== 'string') return respond({ code: 'INVALID_REQUEST' }, 422);

  try {
    const db = serviceClient();
    const { data: account } = await db.from('mova_customer_accounts').select('id').eq('user_id', user.id).eq('status', 'active').maybeSingle();
    if (!account) return respond({ code: 'CLIENT_PROFILE_NOT_FOUND' }, 404);
    if (!await planFeatureEnabled(body.artist_business_id, 'wallet_client_card', account.id)) return respond({ code: 'PLAN_FEATURE_NOT_INCLUDED', feature: 'wallet_client_card' }, 403);
    const { data: link } = await db.from('mova_client_customer_links').select('client_id').eq('artist_business_id', body.artist_business_id).eq('customer_account_id', account.id).is('unlinked_at', null).maybeSingle();
    if (!link) return respond({ code: 'CLIENT_LINK_NOT_FOUND' }, 404);

    const { data: current } = await db.from('mova_client_card_tokens').select('id,token_hash').eq('artist_business_id', body.artist_business_id).eq('client_id', link.client_id).eq('customer_account_id', account.id).is('revoked_at', null).maybeSingle();
    let token = !body.rotate && current?.id ? await deriveClientCardToken(current.id, body.artist_business_id, link.client_id, account.id) : null;
    if (token && current && await sha256Hex(token) !== current.token_hash) token = null;
    if (!token) {
      if (current) await db.from('mova_client_card_tokens').update({ revoked_at: new Date().toISOString() }).eq('id', current.id);
      const id = crypto.randomUUID();
      token = await deriveClientCardToken(id, body.artist_business_id, link.client_id, account.id);
      const { error } = await db.from('mova_client_card_tokens').insert({
        id,
        artist_business_id: body.artist_business_id,
        client_id: link.client_id,
        customer_account_id: account.id,
        token_hash: await sha256Hex(token),
      });
      if (error) {
        const { data: createdByConcurrentRequest } = await db.from('mova_client_card_tokens').select('id')
          .eq('artist_business_id', body.artist_business_id).eq('client_id', link.client_id).eq('customer_account_id', account.id).is('revoked_at', null).maybeSingle();
        if (!createdByConcurrentRequest?.id) return respond({ code: 'CLIENT_CARD_TOKEN_FAILED' }, 500);
        token = await deriveClientCardToken(createdByConcurrentRequest.id, body.artist_business_id, link.client_id, account.id);
      }
    }
    const base = Deno.env.get('PUBLIC_BASE_URL') ?? 'https://mova-beauty.co';
    return respond({ url: `${base.replace(/\/$/, '')}/c/${token}` });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'CLIENT_CARD_TOKEN_FAILED';
    return respond({ code }, code === 'CLIENT_CARD_TOKEN_KEY_UNAVAILABLE' ? 503 : 500);
  }
}));
