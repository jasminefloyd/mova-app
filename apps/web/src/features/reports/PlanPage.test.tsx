import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18nReady } from '../../i18n';
import { PlanProvider } from '../billing/PlanProvider';
import { testSummary } from '../billing/test-fixtures';
import type { PlanSummary } from '../billing/plan-api';
import { formatFee, PlanPage } from './PlanPage';

// Task 5.8, O10 and the free trial (T5, T6): confirmed prices; every plan change goes through Stripe first.
const calls: Array<{ name: string; body: Record<string, unknown> }> = [];
let summary: PlanSummary = testSummary('free', { state: 'free', eligible: false });
let afterTrialFails = false;
const invoke = vi.fn(async (name: string, options: { body: Record<string, unknown> }) => {
  calls.push({ name, body: options.body });
  if (name === 'subscription-checkout') return { data: { data: { checkout_url: 'https://checkout.stripe.com/c/test' } }, error: null };
  if (name === 'plan-management' && options.body.action === 'after_trial') {
    if (afterTrialFails) return { data: null, error: { message: 'failed' } };
    summary = { ...summary, trial: { ...summary.trial!, after_trial_plan: options.body.plan as 'pro' } };
  }
  return { data: { data: summary }, error: null };
});
const identity = { client: { functions: { invoke } }, businessId: 'biz-1', loading: false };
vi.mock('../settings/useArtistBusiness', () => ({ useArtistBusiness: () => identity }));
const flush = async () => { for (let i = 0; i < 6; i += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
const mount = (path: string) => {
  const host = document.createElement('div');
  act(() => createRoot(host).render(<MemoryRouter initialEntries={[path]}><PlanProvider><Routes><Route path="/BID-1/settings/plan" element={<PlanPage />} /></Routes></PlanProvider></MemoryRouter>));
  return host;
};
const button = (host: HTMLElement, label: string) => Array.from(host.querySelectorAll('button')).find((b) => b.textContent === label) as HTMLButtonElement | undefined;

describe('PlanPage (task 5.8, trial T5/T6)', () => {
  beforeAll(async () => { await i18nReady; });
  beforeEach(() => { calls.length = 0; window.sessionStorage.clear(); summary = testSummary('free', { state: 'free', eligible: false }); afterTrialFails = false; });

  it('formats fees as percentages', () => { expect(formatFee(150, 'en-US')).toBe('1.5%'); expect(formatFee(75, 'en-US')).toBe('0.75%'); expect(formatFee(100, 'en-US')).toBe('1.0%'); });
  it('shows the confirmed prices', async () => {
    const host = mount('/BID-1/settings/plan'); await flush();
    const text = host.textContent ?? '';
    expect(text).toContain('$0/month + 1.5% per Mova payment');
    expect(text).toContain('$19/month + 1.0% per Mova payment');
    expect(text).toContain('$39/month + 0.75% per Mova payment');
  });
  it('starts a test-mode checkout for Pro', async () => {
    const assign = vi.fn(); vi.stubGlobal('location', { ...window.location, assign });
    const host = mount('/BID-1/settings/plan'); await flush();
    await act(async () => { button(host, 'Choose Pro')!.click(); });
    await flush();
    expect(calls.find((call) => call.name === 'subscription-checkout')?.body).toEqual({ plan_key: 'pro', return_path: '/BID-1/settings/plan' });
    expect(assign).toHaveBeenCalledWith('https://checkout.stripe.com/c/test');
    vi.unstubAllGlobals();
  });
  it('confirms a returning checkout with Stripe before showing the new plan', async () => {
    const host = mount('/BID-1/settings/plan?checkout=success&session_id=cs_test_abc'); await flush();
    expect(calls).toContainEqual({ name: 'plan-management', body: { action: 'confirm', session_id: 'cs_test_abc' } });
    expect(host.textContent).toContain('Your plan is updated.');
  });
  it('keeps plan buttons off until billing is set up', async () => {
    summary = testSummary('free', { state: 'free', eligible: false }, { billing_available: false });
    const host = mount('/BID-1/settings/plan'); await flush();
    expect(button(host, 'Choose Pro')!.disabled).toBe(true);
    expect(host.textContent).toContain('Plan changes open when billing is set up.');
  });
  it('offers the trial to an eligible owner', async () => {
    summary = testSummary('free', { state: 'eligible', eligible: true });
    const host = mount('/BID-1/settings/plan'); await flush();
    expect(host.textContent).toContain('Try AI + Growth free for 30 days');
    expect(button(host, 'Start free trial')).toBeTruthy();
  });
  it('T5: shows the trial and saves the after-trial choice with Stripe', async () => {
    summary = testSummary('ai_growth', { state: 'trialing', eligible: false, days_left: 12, ends_at: '2026-12-04T15:00:00Z', after_trial_plan: 'ai_growth', card: { brand: 'visa', last4: '4242' } });
    const host = mount('/BID-1/settings/plan'); await flush();
    expect(host.textContent).toContain('12 days left');
    expect(host.textContent).toContain('After your trial');
    expect(button(host, 'Choose Pro')).toBeUndefined();
    const pro = host.querySelector<HTMLInputElement>('input[name="after-trial"][value="pro"]')!;
    await act(async () => { pro.click(); });
    await flush();
    expect(calls).toContainEqual({ name: 'plan-management', body: { action: 'after_trial', plan: 'pro' } });
    expect(host.textContent).toContain("Saved. We'll remind you before your trial ends.");
    expect(host.querySelector<HTMLInputElement>('input[name="after-trial"][value="pro"]')!.checked).toBe(true);
  });
  it('T5: puts the old choice back when Stripe refuses the change', async () => {
    summary = testSummary('ai_growth', { state: 'trialing', eligible: false, days_left: 12, ends_at: '2026-12-04T15:00:00Z', after_trial_plan: 'ai_growth' });
    afterTrialFails = true;
    const host = mount('/BID-1/settings/plan'); await flush();
    await act(async () => { host.querySelector<HTMLInputElement>('input[name="after-trial"][value="free"]')!.click(); });
    await flush();
    expect(host.textContent).toContain("We couldn't change your plan. Try again.");
    expect(host.querySelector<HTMLInputElement>('input[name="after-trial"][value="ai_growth"]')!.checked).toBe(true);
  });
  it('T6: after a trial on Free, unlock buttons use the card on file', async () => {
    summary = testSummary('free', { state: 'ended_free', eligible: false, ends_at: '2026-11-10T15:00:00Z', ended_at: '2026-11-10T15:00:00Z', card: { brand: 'visa', last4: '4242' } });
    const host = mount('/BID-1/settings/plan'); await flush();
    expect(host.textContent).toContain('Your AI + Growth trial ended');
    expect(host.textContent).toContain('Unlocking charges Visa •• 4242 right away.');
    expect(button(host, 'Unlock Pro')).toBeTruthy();
    expect(button(host, 'Unlock AI + Growth')).toBeTruthy();
  });
  it('shows the payment-failed notice while Stripe retries', async () => {
    summary = testSummary('ai_growth', { state: 'past_due', eligible: false, subscription_plan: 'ai_growth', grace_ends_at: '2026-11-29T15:00:00Z' });
    const host = mount('/BID-1/settings/plan'); await flush();
    expect(host.textContent).toContain("Payment didn't go through");
    expect(host.textContent).toContain('to keep AI + Growth');
  });
});
