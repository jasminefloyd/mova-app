import { withSystemRequestLogging, loggedProviderFetch } from '../_shared/system-log.ts';
import { artistClient, corsHeaders, respond, serviceClient } from '../_shared/booking.ts';
import { StripeTestClient } from '../_shared/providers/stripe/client.ts';
import { summarizePayouts } from '../_shared/providers/stripe/payouts.ts';

const hex = (bytes: Uint8Array) => [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
const digest = async (value: string) => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
const disabled = () => Deno.env.get('MOVA_STRIPE_TEST_MODE') !== 'true';

Deno.serve(withSystemRequestLogging('stripe-connect-onboard', async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (disabled()) return respond({ code: 'STRIPE_TEST_MODE_DISABLED' }, 503);
  const secret = Deno.env.get('STRIPE_SECRET_KEY');
  const clientId = Deno.env.get('STRIPE_CONNECT_CLIENT_ID');
  const redirectUri = Deno.env.get('STRIPE_CONNECT_REDIRECT_URI');
  if (!secret?.startsWith('sk_test_') || !clientId || !redirectUri) return respond({ code: 'STRIPE_TEST_CONFIGURATION_MISSING' }, 503);
  const stripe = new StripeTestClient(secret, loggedProviderFetch(request, 'stripe'));
  const db = serviceClient();

  if (request.method === 'GET') {
    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (!code || !state || state.length < 32 || state.length > 256) return respond({ code: 'STRIPE_OAUTH_CALLBACK_INVALID' }, 422);
    const stateHash = await digest(state);
    const { data: stateRow, error: stateError } = await db.from('mova_stripe_oauth_states')
      .select('id,artist_business_id,return_path,expires_at,consumed_at').eq('state_hash', stateHash).maybeSingle();
    if (stateError || !stateRow || stateRow.consumed_at || Date.parse(stateRow.expires_at) <= Date.now()) return respond({ code: 'STRIPE_OAUTH_STATE_INVALID' }, 400);
    const { data: consumed, error: consumeError } = await db.from('mova_stripe_oauth_states')
      .update({ consumed_at: new Date().toISOString() }).eq('id', stateRow.id).is('consumed_at', null).select('id').maybeSingle();
    if (consumeError || !consumed) return respond({ code: 'STRIPE_OAUTH_STATE_INVALID' }, 400);
    try {
      const connected = await stripe.exchangeConnectCode(code, clientId);
      const accountId = String(connected.stripe_user_id);
      if (connected.livemode !== false) return respond({ code: 'STRIPE_LIVE_ACCOUNT_REJECTED' }, 400);
      const account = await stripe.retrieveConnectedAccount(accountId);
      const { error } = await db.from('mova_stripe_connections').upsert({
        artist_business_id: stateRow.artist_business_id,
        stripe_account_id: accountId,
        account_type: 'standard',
        status: account.charges_enabled === true ? 'active' : 'pending',
        charges_enabled: account.charges_enabled === true,
        payouts_enabled: account.payouts_enabled === true,
        details_submitted: account.details_submitted === true,
        last_checked_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }, { onConflict: 'artist_business_id' });
      if (error) return respond({ code: 'STRIPE_CONNECTION_SAVE_FAILED' }, 500);
      const base = (Deno.env.get('PUBLIC_BASE_URL') ?? 'https://mova-beauty.co').replace(/\/$/, '');
      const returnPath = typeof stateRow.return_path === 'string' && stateRow.return_path.startsWith('/') && !stateRow.return_path.startsWith('//') ? stateRow.return_path : '/settings/payments';
      const returnUrl = new URL(returnPath, `${base}/`);
      if (returnUrl.origin !== new URL(base).origin) return respond({ code: 'STRIPE_RETURN_PATH_INVALID' }, 400);
      returnUrl.searchParams.set('stripe', 'connected');
      return Response.redirect(returnUrl.toString(), 303);
    } catch {
      return respond({ code: 'STRIPE_OAUTH_EXCHANGE_FAILED' }, 502);
    }
  }

  if (request.method !== 'POST') return respond({ code: 'METHOD_NOT_ALLOWED' }, 405);
  const actor = await artistClient(request);
  if (!actor) return respond({ code: 'UNAUTHENTICATED' }, 401);
  const body = await request.json().catch(() => ({}));
  if (body.action === 'start') {
    const returnPath = typeof body.return_path === 'string' && body.return_path.startsWith('/') && !body.return_path.startsWith('//') ? body.return_path : '/settings/payments';
    const state = hex(crypto.getRandomValues(new Uint8Array(32)));
    const { error } = await db.from('mova_stripe_oauth_states').insert({
      artist_business_id: actor.businessId, state_hash: await digest(state), return_path: returnPath,
      expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    });
    if (error) return respond({ code: 'STRIPE_CONNECT_START_FAILED' }, 500);
    return respond({ authorization_url: stripe.createConnectAuthorizationUrl(clientId, redirectUri, state) });
  }
  if (body.action === 'status') {
    const { data, error } = await db.from('mova_stripe_connections').select('stripe_account_id,account_type,status,charges_enabled,payouts_enabled,details_submitted,last_checked_at')
      .eq('artist_business_id', actor.businessId).maybeSingle();
    if (error) return respond({ code: 'STRIPE_CONNECTION_READ_FAILED' }, 500);
    if (!data) return respond({ connected: null, payouts: null, dashboard_url: null, test_mode: true });
    const { stripe_account_id: accountId, ...connected } = data;
    let payouts = null;
    let dashboardUrl: string | null = 'https://dashboard.stripe.com/test/dashboard';
    if (data.status === 'active' && accountId) {
      // Task 3.2: payout bank and schedule are read from Stripe, never stored or edited in Mova.
      try { payouts = summarizePayouts(await stripe.retrieveConnectedAccount(accountId)); } catch { payouts = null; }
      if (data.account_type === 'express') {
        try { dashboardUrl = await stripe.createExpressLoginLink(accountId); } catch { dashboardUrl = null; }
      }
    }
    return respond({ connected, payouts, dashboard_url: dashboardUrl, test_mode: true });
  }
  return respond({ code: 'INVALID_ACTION' }, 422);
}));
