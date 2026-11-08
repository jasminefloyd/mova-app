import { describe, expect, it, vi } from 'vitest';
import { createPaylinkRedirectLoader } from './paylink-redirect';

const request = (path = 'https://mova-beauty.co/pay/Abcdefghijklmnopqrstuvwxyz_0123456789ABCDEFGH') => new Request(path);
const args = (req = request()) => ({ params: { code: new URL(req.url).pathname.split('/').at(-1) }, request: req, context: {}, url: new URL(req.url), pattern: '/pay/:code', unstable_pattern: '/pay/:code' });

describe('paylink redirect loader', () => {
  it('rejects malformed codes without making an upstream request', async () => {
    const fetcher = vi.fn();
    const response = await createPaylinkRedirectLoader({ SUPABASE_URL: 'https://project.supabase.co', SUPABASE_ANON_KEY: 'anon' }, fetcher as typeof fetch)(args(request('https://mova-beauty.co/pay/nope')));
    expect(response.status).toBe(404);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('only redirects to Stripe Checkout', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 303, headers: { Location: 'https://checkout.stripe.com/c/pay/cs_test_abc' } }));
    const response = await createPaylinkRedirectLoader({ SUPABASE_URL: 'https://project.supabase.co', SUPABASE_ANON_KEY: 'anon' }, fetcher as typeof fetch)(args());
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://checkout.stripe.com/c/pay/cs_test_abc');
  });

  it('rejects non Stripe redirect destinations', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 303, headers: { Location: 'https://attacker.example/' } }));
    const response = await createPaylinkRedirectLoader({ SUPABASE_URL: 'https://project.supabase.co', SUPABASE_ANON_KEY: 'anon' }, fetcher as typeof fetch)(args());
    expect(response.status).toBe(503);
  });
});
