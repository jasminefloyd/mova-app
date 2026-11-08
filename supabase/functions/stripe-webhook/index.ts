import { corsHeaders, respond, serviceClient } from '../_shared/booking.ts';
import { handleStripeWebhook, type StripeWebhookDb } from '../_shared/stripe-webhook.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ code: 'METHOD_NOT_ALLOWED' }, 405);
  if (Deno.env.get('MOVA_STRIPE_TEST_MODE') !== 'true') return respond({ code: 'STRIPE_TEST_MODE_DISABLED' }, 503);
  const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!secret?.startsWith('whsec_')) return respond({ code: 'STRIPE_WEBHOOK_NOT_CONFIGURED' }, 503);
  const raw = await request.text();
  const result = await handleStripeWebhook(raw, request.headers.get('stripe-signature') ?? '', secret, serviceClient() as unknown as StripeWebhookDb);
  return respond(result.body, result.status);
});
