import { test } from 'vitest';
import { webcrypto } from 'node:crypto';
import { closureBilling, closureSignature, type ClosureDb } from './account-closure.ts';
import { farewellEmail } from './account-closure-mail.ts';
import { renderAccountEmail } from './providers/email/account.ts';

const env = (key: string) => ({ MOVA_STRIPE_BILLING_MODE: 'test', STRIPE_SECRET_KEY: 'sk_test_closure_fixture' })[key];
const fixture = (status: string, livemode = false) => ({
  from: () => ({ select: () => ({ eq: () => ({
    maybeSingle: () => Promise.resolve({ data: { status, livemode, stripe_subscription_id: 'sub_ClosureFixture' }, error: null }),
  }) }) }),
}) as unknown as ClosureDb;

test('paid closure reads Stripe’s item period, then disables renewal with no proration', async () => {
  const requests: string[] = [];
  const end = 1939968000;
  const fetcher = (async (_url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    requests.push(method);
    if (method === 'POST') {
      const body = new URLSearchParams(String(init?.body));
      if (body.get('cancel_at_period_end') !== 'true' || body.get('proration_behavior') !== 'none') throw new Error('Renewal was not safely canceled');
    }
    return Response.json({ status: 'active', livemode: false, cancel_at_period_end: method === 'POST', items: { data: [{ current_period_end: end }] } });
  }) as typeof fetch;
  const preview = await closureBilling(fixture('active'), 'business', 'none', env, fetcher);
  const confirmed = await closureBilling(fixture('active'), 'business', 'stop_renewal', env, fetcher);
  if (preview.endsAt !== new Date(end * 1000).toISOString() || confirmed.endsAt !== preview.endsAt ||
    requests.join(',') !== 'GET,GET,POST') throw new Error('Paid coverage date or Stripe call mismatch');
});

test('trial closes immediately and closure never mixes live and test credentials', async () => {
  const methods: string[] = [];
  const fetcher = (async (_url: string, init?: RequestInit) => {
    methods.push(init?.method ?? 'GET');
    return Response.json({ status: 'trialing', livemode: false });
  }) as typeof fetch;
  const result = await closureBilling(fixture('trialing'), 'business', 'stop_renewal', env, fetcher);
  if (result.endsAt !== null || methods.join(',') !== 'GET,DELETE') throw new Error('Trial could charge after closure');
  try {
    await closureBilling(fixture('active', true), 'business', 'stop_renewal', env, fetcher);
    throw new Error('Expected mode mismatch');
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'BILLING_NOT_CONFIGURED') throw error;
  }
});

test('farewell email retains the account shell and gives feedback the primary action', async () => {
  if (!globalThis.crypto.subtle) Object.defineProperty(globalThis.crypto, "subtle", { value: webcrypto.subtle, configurable: true });
  const token = await closureSignature('closure', 'business', 'unit-test-secret');
  if (token === await closureSignature('closure', 'other-business', 'unit-test-secret')) throw new Error('Token is not tenant-bound');
  for (const locale of ['en-US', 'es-US'] as const) {
    const vars = farewellEmail(locale, '<Artist>', `https://mova-beauty.co/account-closure?mode=feedback#${token}`);
    const result = renderAccountEmail(locale, vars);
    if (!result.html.includes('&lt;Artist&gt;') || !result.html.includes('background:#18392F') ||
      !result.text.includes(`mode=reactivate#${token}`) ||
      result.html.indexOf('mode=feedback') >= result.html.indexOf('mode=reactivate')) throw new Error('Farewell email layout or link mismatch');
  }
});
