import { afterEach, describe, expect, it, vi } from 'vitest';
import { StripeTestClient, verifyStripeTestWebhook } from './client.ts';

afterEach(() => vi.restoreAllMocks());

describe('Stripe test adapter', () => {
  it('TC-F06-AC01-01 refuses live-mode API keys', () => {
    expect(() => new StripeTestClient('sk_live_never-allowed')).toThrow('STRIPE_TEST_KEY_REQUIRED');
  });

  it('TC-F06-AC01-01 builds the Standard Connect OAuth URL with a caller-bound state', () => {
    const client = new StripeTestClient('sk_test_fixture');
    const url = new URL(client.createConnectAuthorizationUrl('ca_fixture123', 'https://project.supabase.invalid/functions/v1/stripe-connect-onboard', 'a'.repeat(43)));
    expect(url.origin + url.pathname).toBe('https://connect.stripe.com/oauth/authorize');
    expect(url.searchParams.get('scope')).toBe('read_write');
    expect(url.searchParams.get('state')).toBe('a'.repeat(43));
  });

  it('TC-F06-AC01-01 exchanges a Connect OAuth code without exposing the secret key in the URL', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ stripe_user_id: 'acct_fixture123', scope: 'read_write' }));
    const client = new StripeTestClient('sk_test_fixture', fetcher);
    const response = await client.exchangeConnectCode('oauth-code-fixture-123', 'ca_fixture123');
    expect(response.stripe_user_id).toBe('acct_fixture123');
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe('https://connect.stripe.com/oauth/token');
    expect(String(url)).not.toContain('sk_test_fixture');
    expect(new URLSearchParams(String(init?.body)).get('client_secret')).toBe('sk_test_fixture');
  });

  it('TC-F06-AC01-01 creates an idempotent direct-charge Checkout Session with the approved fee snapshot', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: 'cs_test_123', url: 'https://checkout.stripe.invalid/session' }));
    const client = new StripeTestClient('sk_test_fixture', fetcher);
    const now = Math.floor(Date.now() / 1000);
    const result = await client.createCheckoutSession({
      accountId: 'acct_fixture123', amountMinor: 10000, applicationFeeMinor: 150,
      currency: 'usd', expiresAt: now + 3600, successUrl: 'https://mova.invalid/b/return',
      cancelUrl: 'https://mova.invalid/b/cancel', clientReferenceId: 'appointment-1',
      metadata: { appointment_id: 'appointment-1' }, productName: 'Hair service deposit',
      customerEmail: 'guest@example.invalid', locale: 'en', idempotencyKey: 'checkout-booking-1',
    });
    expect(result.id).toBe('cs_test_123');
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe('https://api.stripe.com/v1/checkout/sessions');
    expect(new Headers(init?.headers).get('Stripe-Account')).toBe('acct_fixture123');
    expect(new Headers(init?.headers).get('Idempotency-Key')).toBe('checkout-booking-1');
    const body = new URLSearchParams(String(init?.body));
    expect(body.get('mode')).toBe('payment');
    expect(body.get('line_items[0][price_data][unit_amount]')).toBe('10000');
    expect(body.get('payment_intent_data[application_fee_amount]')).toBe('150');
    expect(body.get('metadata[appointment_id]')).toBe('appointment-1');
  });

  it('TC-F06-AC01-01 refuses a Checkout Session expiry shorter than Stripe permits', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = new StripeTestClient('sk_test_fixture', fetcher);
    const now = Math.floor(Date.now() / 1000);
    await expect(client.createCheckoutSession({
      accountId: 'acct_fixture123', amountMinor: 1000, applicationFeeMinor: 15, currency: 'usd', expiresAt: now + 600,
      successUrl: 'https://mova.invalid/success', cancelUrl: 'https://mova.invalid/cancel', clientReferenceId: 'appointment-1',
      metadata: {}, productName: 'Deposit', idempotencyKey: 'checkout-booking-2',
    })).rejects.toThrow('STRIPE_SESSION_EXPIRY_INVALID');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('TC-F06-AC03-01 creates a partial refund on the connected account with an idempotency key', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: 're_test_123' }));
    const client = new StripeTestClient('sk_test_fixture', fetcher);
    const result = await client.createRefund({ paymentIntentId: 'pi_test_123', amountMinor: 2500, idempotencyKey: 'refund-appointment-1', accountId: 'acct_fixture123' });
    expect(result.id).toBe('re_test_123');
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe('https://api.stripe.com/v1/refunds');
    expect(new Headers(init?.headers).get('Stripe-Account')).toBe('acct_fixture123');
    expect(new Headers(init?.headers).get('Idempotency-Key')).toBe('refund-appointment-1');
    expect(new URLSearchParams(String(init?.body)).get('amount')).toBe('2500');
    expect(new URLSearchParams(String(init?.body)).get('refund_application_fee')).toBe('true');
  });

  it('TC-F06-AC01-02 verifies timestamped Stripe webhook signatures and rejects stale or modified bodies', async () => {
    const body = JSON.stringify({ id: 'evt_test_1', livemode: false });
    const timestamp = 1_800_000_000;
    const secret = 'whsec_test_fixture';
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${body}`)));
    const signature = [...digest].map((value) => value.toString(16).padStart(2, '0')).join('');
    const header = `t=${timestamp},v1=${signature}`;
    expect(await verifyStripeTestWebhook(body, header, secret, timestamp)).toBe(true);
    expect(await verifyStripeTestWebhook(`${body} `, header, secret, timestamp)).toBe(false);
    expect(await verifyStripeTestWebhook(body, header, secret, timestamp + 301)).toBe(false);
  });

  it('TC-F06-AC01-02 explicitly expires an open Checkout Session through Stripe', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: 'cs_test_123', status: 'expired' }));
    const client = new StripeTestClient('sk_test_fixture', fetcher);
    await client.expireCheckoutSession('cs_test_123', 'acct_fixture123');
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://api.stripe.com/v1/checkout/sessions/cs_test_123/expire');
  });

  it('TC-F06-AC01-02 retrieves Checkout Session state on the connected account', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: 'cs_test_123', status: 'open' }));
    const client = new StripeTestClient('sk_test_fixture', fetcher);
    const result = await client.retrieveCheckoutSession('cs_test_123', 'acct_fixture123');
    expect(result.status).toBe('open');
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get('Stripe-Account')).toBe('acct_fixture123');
  });
});
