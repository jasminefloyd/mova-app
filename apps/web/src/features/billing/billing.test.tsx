import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18nReady } from '../../i18n';
import { offerTrialNow } from './trial-offer';
import { HomeBanner } from '../bookings/HomeBanner';
import { PlanGate } from './PlanGate';
import { PlanProvider } from './PlanProvider';
import StartTrialPage from './StartTrialPage';
import { UnlockSheet } from './UnlockSheet';
import { testSummary } from './test-fixtures';
import type { PlanSummary } from './plan-api';

// Free trial WP6: locks (T8/T10), unlock on the card on file (T9), T1, and the Home banner order (T3/T4/T7/T11).
const calls: Array<{ name: string; body: Record<string, unknown> }> = [];
const rpcs: Array<{ name: string; args: Record<string, unknown> }> = [];
let summary: PlanSummary = testSummary('free');
let respond: (name: string, body: Record<string, unknown>) => { data: unknown; error: unknown } | null = () => null;
const invoke = vi.fn(async (name: string, options: { body: Record<string, unknown> }) => {
  calls.push({ name, body: options.body });
  return respond(name, options.body) ?? { data: { data: summary }, error: null };
});
const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => { rpcs.push({ name, args }); return { data: null, error: null }; });
const identity = {
  client: { functions: { invoke }, rpc, auth: { getSession: async () => ({ data: { session: null } }) } },
  businessId: 'BID-1', loading: false,
};
vi.mock('../settings/useArtistBusiness', () => ({ useArtistBusiness: () => identity }));
vi.mock('../../pwa/PwaInstallProvider', () => ({ usePwaInstall: () => ({ ready: false, installed: false, canPrompt: false, promptInstall: async () => false }) }));

const flush = async () => { for (let i = 0; i < 6; i += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
function Where() { const location = useLocation(); return <output data-testid="where">{location.pathname}</output>; }
const mount = (element: React.ReactNode, path = '/BID-1/marketing') => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  act(() => createRoot(host).render(<MemoryRouter initialEntries={[path]}><PlanProvider><Routes><Route path="*" element={<>{element}<Where /></>} /></Routes></PlanProvider></MemoryRouter>));
  return host;
};
const button = (host: ParentNode, label: string) => Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined;
const where = (host: HTMLElement) => host.querySelector('[data-testid="where"]')?.textContent;
const gate = <PlanGate feature="google_calendar_sync" requiredPlan="pro" title="Calendar sync is locked" body="Your connection is saved." featureName="Calendar sync"><button type="button">Connect Google</button></PlanGate>;

describe('free trial screens (WP6)', () => {
  beforeAll(async () => { await i18nReady; HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.setAttribute('open', ''); }; HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) { this.removeAttribute('open'); }; });
  beforeEach(() => { calls.length = 0; rpcs.length = 0; window.sessionStorage.clear(); window.localStorage.clear(); document.body.innerHTML = ''; respond = () => null; summary = testSummary('free'); });

  describe('PlanGate', () => {
    it('shows the screen as-is when the plan includes the feature', async () => {
      summary = testSummary('pro', { state: 'active', eligible: false });
      const host = mount(gate); await flush();
      expect(host.querySelector('.mova-lock-card')).toBeNull();
      expect(button(host, 'Connect Google')).toBeTruthy();
      expect(host.querySelector('.mova-locked')).toBeNull();
    });
    it('locks the screen and keeps it out of reach when the plan lacks the feature', async () => {
      const host = mount(gate); await flush();
      expect(host.querySelector('.mova-lock-card h2')?.textContent).toBe('Calendar sync is locked');
      const locked = host.querySelector('.mova-locked')!;
      expect(locked.getAttribute('aria-hidden')).toBe('true');
      expect(locked.hasAttribute('inert')).toBe(true);
      expect(locked.textContent).toContain('Connect Google');
    });
    it('sends an eligible owner to the trial', async () => {
      const host = mount(gate); await flush();
      await act(async () => { button(host, 'Start your free trial')!.click(); });
      expect(where(host)).toBe('/BID-1/start-trial');
    });
    it('opens the unlock sheet when a card is on file and the trial is used', async () => {
      summary = testSummary('free', { state: 'ended_free', eligible: false, card: { brand: 'visa', last4: '4242' } });
      const host = mount(gate); await flush();
      await act(async () => { button(host, 'Unlock with Pro · $19/mo')!.click(); });
      expect(document.body.textContent).toContain('Unlock Calendar sync');
      expect(where(host)).toBe('/BID-1/marketing');
    });
    it('goes to Plan when there is no card and no trial to start', async () => {
      summary = testSummary('free', { state: 'free', eligible: false });
      const host = mount(gate); await flush();
      await act(async () => { button(host, 'Unlock with Pro · $19/mo')!.click(); });
      expect(where(host)).toBe('/BID-1/settings/plan');
    });
    it('locks nothing before the plan is known', async () => {
      respond = () => ({ data: null, error: { message: 'offline' } });
      const host = mount(gate); await flush();
      expect(host.querySelector('.mova-lock-card')).toBeNull();
    });
  });

  describe('UnlockSheet (T9)', () => {
    it('charges the card on file for the chosen plan', async () => {
      summary = testSummary('free', { state: 'ended_free', eligible: false, card: { brand: 'visa', last4: '4242' } });
      respond = (name, body) => name === 'plan-management' && body.action === 'unlock' ? { data: { data: testSummary('ai_growth', { state: 'active', eligible: false }) }, error: null } : null;
      mount(<UnlockSheet open onClose={() => undefined} initialPlan="pro" featureName="Marketing" />); await flush();
      expect(document.body.textContent).toContain('Visa •• 4242');
      await act(async () => { document.querySelector<HTMLInputElement>('input[name="unlock-plan"][value="ai_growth"]')!.click(); });
      await act(async () => { button(document.body, 'Pay $39 and unlock')!.click(); });
      await flush();
      expect(calls).toContainEqual({ name: 'plan-management', body: { action: 'unlock', plan: 'ai_growth', return_path: '/BID-1/marketing' } });
      expect(document.body.textContent).toContain('AI + Growth is on. Your saved Marketing is back.');
    });
    it('falls back to Checkout when the bank asks for authentication', async () => {
      const assign = vi.fn(); vi.stubGlobal('location', { ...window.location, assign });
      summary = testSummary('free', { state: 'ended_free', eligible: false, card: { brand: 'visa', last4: '4242' } });
      respond = (name, body) => name === 'plan-management' && body.action === 'unlock'
        ? { data: null, error: { message: 'x', context: { json: async () => ({ data: { code: 'PAYMENT_NEEDS_ACTION', checkout_url: 'https://checkout.stripe.com/c/sca' } }) } } } : null;
      mount(<UnlockSheet open onClose={() => undefined} initialPlan="pro" />); await flush();
      await act(async () => { button(document.body, 'Pay $19 and unlock')!.click(); });
      await flush();
      expect(assign).toHaveBeenCalledWith('https://checkout.stripe.com/c/sca');
      vi.unstubAllGlobals();
    });
    it('says so when the card is declined', async () => {
      summary = testSummary('free', { state: 'ended_free', eligible: false, card: { brand: 'visa', last4: '0002' } });
      respond = (name, body) => name === 'plan-management' && body.action === 'unlock' ? { data: null, error: { message: 'declined' } } : null;
      mount(<UnlockSheet open onClose={() => undefined} initialPlan="pro" />); await flush();
      await act(async () => { button(document.body, 'Pay $19 and unlock')!.click(); });
      await flush();
      expect(document.querySelector('[role="alert"]')?.textContent).toContain("We couldn't charge your card.");
    });
  });

  describe('StartTrialPage (T1)', () => {
    it('opens a trial Checkout without texts by default', async () => {
      const assign = vi.fn(); vi.stubGlobal('location', { ...window.location, assign });
      respond = (name) => name === 'trial-start' ? { data: { data: { checkout_url: 'https://checkout.stripe.com/c/trial' } }, error: null } : null;
      const host = mount(<StartTrialPage />, '/BID-1/start-trial'); await flush();
      expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false);
      await act(async () => { host.querySelector<HTMLButtonElement>('.mova-start-trial > button:not(.mova-start-trial__free)')!.click(); });
      await flush();
      expect(calls.find((call) => call.name === 'trial-start')?.body).toEqual({ return_path: '/BID-1/start-trial' });
      expect(assign).toHaveBeenCalledWith('https://checkout.stripe.com/c/trial');
      vi.unstubAllGlobals();
    });
    it('sends the opt-in phone as E.164 and rejects a short number', async () => {
      respond = (name) => name === 'trial-start' ? { data: { data: { checkout_url: 'https://checkout.stripe.com/c/trial' } }, error: null } : null;
      const assign = vi.fn(); vi.stubGlobal('location', { ...window.location, assign });
      const host = mount(<StartTrialPage />, '/BID-1/start-trial'); await flush();
      await act(async () => { host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(); });
      const tel = host.querySelector<HTMLInputElement>('input[type="tel"]')!;
      const setValue = (value: string) => act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(tel, value);
        tel.dispatchEvent(new Event('input', { bubbles: true }));
      });
      const start = () => host.querySelector<HTMLButtonElement>('.mova-start-trial > button.mova-button, .mova-start-trial > button:not(.mova-start-trial__free)')!;
      await setValue('312555');
      await act(async () => { start().click(); });
      expect(host.querySelector('[role="alert"]')).toBeTruthy();
      expect(calls.some((call) => call.name === 'trial-start')).toBe(false);
      await setValue('(312) 555-0148');
      await act(async () => { start().click(); });
      await flush();
      expect(calls.find((call) => call.name === 'trial-start')?.body).toEqual({ return_path: '/BID-1/start-trial', sms: { phone: '+13125550148', consent: true } });
      vi.unstubAllGlobals();
    });
    it('"Continue on Free" records the decline and goes home', async () => {
      const host = mount(<StartTrialPage />, '/BID-1/start-trial'); await flush();
      await act(async () => { host.querySelector<HTMLButtonElement>('.mova-start-trial__free')!.click(); });
      await flush();
      expect(rpcs).toContainEqual({ name: 'mova_record_trial_offer', args: { p_artist_business_id: 'BID-1', p_declined: true } });
      expect(where(host)).toBe('/BID-1/');
    });
    it('confirms a returning Checkout with Stripe, then goes home', async () => {
      const host = mount(<StartTrialPage />, '/BID-1/start-trial?checkout=success&session_id=cs_test_trial'); await flush();
      expect(calls).toContainEqual({ name: 'plan-management', body: { action: 'confirm', session_id: 'cs_test_trial' } });
      expect(where(host)).toBe('/BID-1/');
    });
  });

  describe('T1 redirect', () => {
    it('offers the trial once per session, never over T1 or Plan', () => {
      expect(offerTrialNow(true, '/BID-1', null, 'BID-1')).toBe(true);
      expect(offerTrialNow(false, '/BID-1', null, 'BID-1')).toBe(false);
      expect(offerTrialNow(true, '/BID-1/start-trial', null, 'BID-1')).toBe(false);
      expect(offerTrialNow(true, '/BID-1/settings/plan', null, 'BID-1')).toBe(false);
      expect(offerTrialNow(true, '/BID-1', 'BID-1', 'BID-1')).toBe(false);
      expect(offerTrialNow(true, '/BID-2', 'BID-1', 'BID-2')).toBe(true);
    });
  });

  describe('Home banner order', () => {
    const banner = async (next: PlanSummary) => { summary = next; const host = mount(<HomeBanner client={identity.client as never} businessId="BID-1" />, '/BID-1'); await flush(); return host; };
    it('payment failed comes first and has no close button (T11)', async () => {
      const host = await banner(testSummary('ai_growth', { state: 'past_due', eligible: false, subscription_plan: 'ai_growth', grace_ends_at: '2026-11-29T15:00:00Z' }));
      expect(host.querySelector('[role="alert"]')?.textContent).toContain("Payment didn't go through");
      expect(host.querySelector('.mova-home-banner__close')).toBeNull();
    });
    it('the last 7 days show the ending banner (T4)', async () => {
      const host = await banner(testSummary('ai_growth', { state: 'trialing', eligible: false, days_left: 5, ends_at: '2026-11-27T15:00:00Z', after_trial_plan: 'pro' }));
      expect(host.textContent).toContain('Trial ends');
      expect(host.textContent).toContain('Then $19/month for Pro.');
    });
    it('earlier in the trial, the strip shows instead (T3)', async () => {
      const host = await banner(testSummary('ai_growth', { state: 'trialing', eligible: false, days_left: 20, ends_at: '2026-12-12T15:00:00Z' }));
      expect(host.querySelector('.mova-trial-strip')?.textContent).toContain('AI + Growth free trial · 20 days left');
    });
    it('after the trial on Free, the locked banner shows (T7)', async () => {
      const host = await banner(testSummary('free', { state: 'ended_free', eligible: false }));
      expect(host.textContent).toContain('Your trial has ended');
    });
    it('no upsell during an admin-assigned plan', async () => {
      const host = await banner(testSummary('pro', { state: 'admin', eligible: false, admin_assigned: true }));
      expect(host.querySelector('.mova-home-banner')).toBeNull();
    });
  });
});
