import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { i18nReady } from '../../i18n';
import { formatFee, PlanPage } from './PlanPage';

// Task 5.8 and O10: confirmed prices, and plan changes only through verified test-mode checkout.
const calls: Array<{ name: string; body: Record<string, unknown> }> = [];
const plans = [
  { plan_key: 'free', display_name: 'Free', monthly_price_minor: 0, mova_fee_basis_points: 150, status: 'active', entitlements: {} },
  { plan_key: 'pro', display_name: 'Pro', monthly_price_minor: 1900, mova_fee_basis_points: 100, status: 'active', entitlements: {} },
  { plan_key: 'ai_growth', display_name: 'AI + Growth', monthly_price_minor: 3900, mova_fee_basis_points: 75, status: 'active', entitlements: {} },
];
let billing = true;
const invoke = vi.fn(async (name: string, options: { body: Record<string, unknown> }) => {
  calls.push({ name, body: options.body });
  if (name === 'subscription-checkout') return { data: { data: { checkout_url: 'https://checkout.stripe.com/c/test' } }, error: null };
  return { data: { data: { current_plan: plans[0], plans, usage: {}, subscription: null, billing_available: billing } }, error: null };
});
const identity = { client: { functions: { invoke } }, businessId: 'biz-1', loading: false };
vi.mock('../settings/useArtistBusiness', () => ({ useArtistBusiness: () => identity }));
const flush = async () => { for (let i = 0; i < 6; i += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
const mount = (path: string) => { const host = document.createElement('div'); act(() => createRoot(host).render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/BID-1/settings/plan" element={<PlanPage />} /></Routes></MemoryRouter>)); return host; };

describe('PlanPage (task 5.8)', () => {
  beforeAll(async () => { await i18nReady; });
  it('formats fees as percentages', () => { expect(formatFee(150, 'en-US')).toBe('1.5%'); expect(formatFee(75, 'en-US')).toBe('0.75%'); expect(formatFee(100, 'en-US')).toBe('1.0%'); });
  it('shows the confirmed prices without the placeholder copy', async () => {
    const host = mount('/BID-1/settings/plan'); await flush();
    const text = host.textContent ?? '';
    expect(text).toContain('$0/month + 1.5% per Mova payment');
    expect(text).toContain('$19/month + 1.0% per Mova payment');
    expect(text).toContain('$39/month + 0.75% per Mova payment');
    expect(text).not.toContain('Pricing details coming soon');
    expect(text).not.toContain('Proposed pricing');
  });
  it('starts a test-mode checkout for Pro', async () => {
    const assign = vi.fn(); vi.stubGlobal('location', { ...window.location, assign });
    const host = mount('/BID-1/settings/plan'); await flush();
    await act(async () => { (Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Choose Pro') as HTMLButtonElement).click(); });
    await flush();
    expect(calls.find((call) => call.name === 'subscription-checkout')?.body).toEqual({ plan_key: 'pro', return_path: '/BID-1/settings/plan' });
    expect(assign).toHaveBeenCalledWith('https://checkout.stripe.com/c/test');
    vi.unstubAllGlobals();
  });
  it('confirms a returning checkout with Stripe before showing the new plan', async () => {
    calls.length = 0;
    const host = mount('/BID-1/settings/plan?checkout=success&session_id=cs_test_abc'); await flush();
    expect(calls[0]).toEqual({ name: 'plan-management', body: { action: 'confirm', session_id: 'cs_test_abc' } });
    expect(host.textContent).toContain('Your plan is updated.');
  });
  it('keeps plan buttons off until billing is set up', async () => {
    billing = false;
    const host = mount('/BID-1/settings/plan'); await flush();
    expect((Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Choose Pro') as HTMLButtonElement).disabled).toBe(true);
    expect(host.textContent).toContain('Plan changes open when billing is set up.');
    billing = true;
  });
});
