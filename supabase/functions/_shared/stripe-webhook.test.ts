import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { handleStripeWebhook, type StripeWebhookDb } from './stripe-webhook.ts';
import { StripeTestClient } from './providers/stripe/client.ts';

// Task 4.1: the sandbox journey driven by recorded-shape fixtures (see providers/stripe/fixtures/README.md).
const fixture = (name: string) => readFileSync(join(__dirname, 'providers', 'stripe', 'fixtures', name), 'utf8');
const secret = 'whsec_e4600000fixture';
const now = 1762617600;

async function sign(raw: string, timestamp = now) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${raw}`)));
  return `t=${timestamp},v1=${[...mac].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

function db(results: Record<string, Record<string, unknown>>) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const stub: StripeWebhookDb = { rpc: async (name, args) => { calls.push({ name, args }); return { data: results[name] ?? {}, error: null }; } };
  return { stub, calls };
}

describe('Stripe webhook with recorded fixtures (task 4.1)', () => {
  it('a paid deposit Checkout confirms the booking and queues the Stripe-fee job', async () => {
    const raw = fixture('checkout.session.completed.deposit.json');
    const { stub, calls } = db({ mova_stripe_webhook_apply: { processed: true, payment_id: 'e4600000-0000-4000-8000-000000000501', status: 'confirmed' } });
    const result = await handleStripeWebhook(raw, await sign(raw), secret, stub, now);
    expect(result).toEqual({ status: 200, body: { received: true, processed: true, payment_id: 'e4600000-0000-4000-8000-000000000501', status: 'confirmed' } });
    expect(calls[0]).toEqual({ name: 'mova_stripe_webhook_apply', args: {
      p_event_id: 'evt_test_deposit_completed', p_event_type: 'checkout.session.completed', p_account_id: 'acct_e4600000fixture',
      p_session_id: 'cs_test_e4600000_deposit', p_payment_intent_id: 'pi_test_e4600000_deposit', p_payment_status: 'paid', p_amount_total: 2000, p_livemode: false,
    } });
    expect(calls[1]).toEqual({ name: 'mova_stripe_enqueue_processor_fee', args: { p_payment_id: 'e4600000-0000-4000-8000-000000000501', p_payment_intent_id: 'pi_test_e4600000_deposit', p_account_id: 'acct_e4600000fixture' } });
  });

  it('a paid pay link records the balance payment', async () => {
    const raw = fixture('checkout.session.completed.paylink.json');
    const { stub, calls } = db({ mova_stripe_webhook_apply: { processed: true, payment_id: 'p2', checkout_kind: 'paylink' } });
    expect((await handleStripeWebhook(raw, await sign(raw, now + 3600), secret, stub, now + 3600)).status).toBe(200);
    expect(calls.map((c) => c.name)).toEqual(['mova_stripe_webhook_apply', 'mova_stripe_enqueue_processor_fee']);
    expect(calls[0]!.args).toMatchObject({ p_amount_total: 6000, p_session_id: 'cs_test_e4600000_paylink' });
  });

  it('a refund update goes to the refund handler', async () => {
    const raw = fixture('refund.updated.succeeded.json');
    const { stub, calls } = db({ mova_stripe_refund_webhook_apply: { processed: true, status: 'succeeded' } });
    expect((await handleStripeWebhook(raw, await sign(raw), secret, stub, now)).body).toMatchObject({ received: true, status: 'succeeded' });
    expect(calls).toEqual([{ name: 'mova_stripe_refund_webhook_apply', args: { p_event_id: 'evt_test_refund_succeeded', p_refund_id: 're_test_e4600000_refund', p_status: 'succeeded', p_account_id: 'acct_e4600000fixture', p_livemode: false } }]);
  });

  it('an expired Checkout releases the hold and queues no fee job', async () => {
    const raw = fixture('checkout.session.expired.json');
    const { stub, calls } = db({ mova_stripe_webhook_apply: { expired: true } });
    expect((await handleStripeWebhook(raw, await sign(raw), secret, stub, now)).body).toEqual({ received: true, expired: true });
    expect(calls).toHaveLength(1);
  });

  it('refuses bad signatures, replays older than five minutes and live-mode events', async () => {
    const raw = fixture('checkout.session.completed.deposit.json');
    const { stub, calls } = db({});
    expect((await handleStripeWebhook(raw, await sign(`${raw} `), secret, stub, now)).body).toEqual({ code: 'INVALID_WEBHOOK_SIGNATURE' });
    expect((await handleStripeWebhook(raw, await sign(raw, now - 301), secret, stub, now)).body).toEqual({ code: 'INVALID_WEBHOOK_SIGNATURE' });
    const live = raw.replace('"livemode":false,"account"', '"livemode":true,"account"');
    expect((await handleStripeWebhook(live, await sign(live), secret, stub, now)).body).toEqual({ code: 'STRIPE_LIVE_EVENT_REJECTED' });
    expect(calls).toHaveLength(0);
  });

  it('reports a database failure as retryable (503) so Stripe redelivers', async () => {
    const raw = fixture('checkout.session.completed.deposit.json');
    const stub: StripeWebhookDb = { rpc: async () => ({ data: null, error: { message: 'boom' } }) };
    expect((await handleStripeWebhook(raw, await sign(raw), secret, stub, now)).status).toBe(503);
  });
});

describe('Stripe processing fee (task 4.1)', () => {
  it('reads only the stripe_fee part from the charge balance transaction on the connected account', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(fixture('payment_intent.with_fee.json'), { status: 200 }));
    const fee = await new StripeTestClient('sk_test_fixture', fetcher).retrieveProcessorFee('pi_test_e4600000_deposit', 'acct_e4600000fixture');
    expect(fee).toEqual({ feeMinor: 88, balanceTransactionId: 'txn_test_e4600000' });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toContain('expand[]=latest_charge.balance_transaction');
    expect((init?.headers as Record<string, string>)['Stripe-Account']).toBe('acct_e4600000fixture');
  });
  it('returns null until the charge has settled', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: 'pi_x', latest_charge: { id: 'ch_x', balance_transaction: null } }));
    expect(await new StripeTestClient('sk_test_fixture', fetcher).retrieveProcessorFee('pi_x', 'acct_x1')).toBeNull();
  });
});
