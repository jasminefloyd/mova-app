import { withSystemRequestLogging, loggedProviderFetch } from '../_shared/system-log.ts';
import { corsHeaders, respond, serviceClient } from '../_shared/booking.ts';
import { billingClientFromEnv } from '../_shared/billing-env.ts';
import { handleBillingWebhook, type BillingDb } from '../_shared/billing-state.ts';

// Stripe events for plan billing (subscriptions, invoices, cards). Separate from stripe-webhook,
// which handles client payments in test mode only. No JWT: Stripe's signature is the authentication.
Deno.serve(withSystemRequestLogging('billing-webhook', async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ code: 'METHOD_NOT_ALLOWED' }, 405);
  const secret = Deno.env.get('STRIPE_BILLING_WEBHOOK_SECRET');
  if (!secret?.startsWith('whsec_')) return respond({ code: 'BILLING_WEBHOOK_NOT_CONFIGURED' }, 503);
  const stripe = billingClientFromEnv((name) => Deno.env.get(name), loggedProviderFetch(request, 'stripe'));
  if (!stripe) return respond({ code: 'BILLING_NOT_CONFIGURED' }, 503);
  const raw = await request.text();
  const result = await handleBillingWebhook(raw, request.headers.get('stripe-signature') ?? '', secret, serviceClient() as unknown as BillingDb, stripe, (name) => Deno.env.get(name));
  return respond(result.body, result.status);
}));
