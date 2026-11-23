import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.119.0';
import { withSystemRequestLogging, loggedProviderFetch } from '../_shared/system-log.ts';
import { corsHeaders, respond, serviceClient } from '../_shared/booking.ts';
import { billingClientFromEnv } from '../_shared/billing-env.ts';
import { syncSubscription } from '../_shared/billing-state.ts';

// WP8: platform admins extend or end a stylist's free trial. Stripe owns the trial date, so the change
// goes to Stripe (trial_end), the result is applied from Stripe's answer, and the action is logged in
// admin activity with the reason. "Grant a trial again" is the mova_admin_release_trial RPC (no Stripe).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_EXTEND_DAYS = 30;

Deno.serve(withSystemRequestLogging('admin-billing', async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ code: 'METHOD_NOT_ALLOWED' }, 405);
  const url = Deno.env.get('SUPABASE_URL'); const anon = Deno.env.get('SUPABASE_ANON_KEY');
  const authorization = request.headers.get('Authorization');
  if (!url || !anon || !authorization) return respond({ code: 'UNAUTHENTICATED' }, 401);
  const userClient = createClient(url, anon, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return respond({ code: 'UNAUTHENTICATED' }, 401);

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const action = body.action;
  const businessId = typeof body.artist_business_id === 'string' && UUID.test(body.artist_business_id) ? body.artist_business_id : null;
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (action !== 'extend_trial' && action !== 'end_trial') return respond({ code: 'ACTION_INVALID' }, 400);
  if (!businessId) return respond({ code: 'BUSINESS_REQUIRED' }, 400);
  if (reason.length < 5 || reason.length > 500) return respond({ code: 'REASON_REQUIRED' }, 422);
  const days = Number(body.days);
  if (action === 'extend_trial' && (!Number.isInteger(days) || days < 1 || days > MAX_EXTEND_DAYS)) return respond({ code: 'DAYS_INVALID', max: MAX_EXTEND_DAYS }, 422);

  // The admin check runs as the caller: mova_admin_stylist_trial refuses anyone who isn't a platform admin.
  const { data: trial, error: trialError } = await userClient.rpc('mova_admin_stylist_trial', { p_artist_business_id: businessId });
  if (trialError) return respond({ code: trialError.message?.includes('PLATFORM_ADMIN_REQUIRED') ? 'PLATFORM_ADMIN_REQUIRED' : 'TRIAL_STATUS_UNAVAILABLE' }, trialError.message?.includes('PLATFORM_ADMIN_REQUIRED') ? 403 : 500);
  const status = trial as { state?: string; ends_at?: string | null; stripe_subscription_id?: string | null } | null;
  if (status?.state !== 'trialing' || !status.stripe_subscription_id || !status.ends_at) return respond({ code: 'NOT_TRIALING' }, 409);

  const env = (name: string) => Deno.env.get(name);
  const stripe = billingClientFromEnv(env, loggedProviderFetch(request, 'stripe'));
  if (!stripe) return respond({ code: 'BILLING_NOT_CONFIGURED' }, 503);

  const previousEnd = status.ends_at;
  const newEnd = action === 'extend_trial' ? Math.floor(new Date(previousEnd).getTime() / 1000) + days * 86_400 : null;
  const form = new URLSearchParams({ trial_end: newEnd === null ? 'now' : String(newEnd), proration_behavior: 'none' });
  try { await stripe.updateSubscription(status.stripe_subscription_id, form); }
  catch { return respond({ code: 'STRIPE_UPDATE_FAILED' }, 502); }

  const db = serviceClient();
  try { await syncSubscription(db as never, stripe, status.stripe_subscription_id, env); }
  catch { /* the webhook applies it too; the admin log below still records what was asked of Stripe */ }
  const { error: logError } = await db.rpc('mova_admin_log_trial_change', {
    p_admin: user.id, p_artist_business_id: businessId, p_action: action === 'extend_trial' ? 'stylist.trial_extended' : 'stylist.trial_ended', p_reason: reason,
    p_details: { previous_ends_at: previousEnd, new_ends_at: newEnd === null ? new Date().toISOString() : new Date(newEnd * 1000).toISOString(), ...(action === 'extend_trial' ? { days } : {}) },
  });
  if (logError) return respond({ code: 'ADMIN_LOG_FAILED' }, 500);
  const { data: next } = await userClient.rpc('mova_admin_stylist_trial', { p_artist_business_id: businessId });
  return respond(next ?? {});
}));
