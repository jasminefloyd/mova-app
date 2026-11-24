import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n, { i18nReady } from '../../../i18n';
import { PlanProvider } from '../../billing/PlanProvider';
import { PricePilotOverviewPage } from './PricePilotOverviewPage';
import { PricePilotReviewPage } from './PricePilotReviewPage';
import { duration, money } from './shared';

// PP1, PP4 and PP8 (CR-019). Prices only change through `apply`, on the stylist's tap.
const calls: Array<Record<string, unknown>> = [];
const checks = { enough_menus: true, fresh: true, clear: true, agree: true, same_length: true, own_bookings: true };
const row = (o: Record<string, unknown>) => ({ category: 'Styling', location_id: 'loc-1', location_name: 'Studio 9 Suites', own_location_price: false, above_range: false, dismissed: false, avg_lead_days: 21, bookings_90d: 18,
  impact: { per_month: 6, now_minor: 57000, then_minor: 66000, change_minor: 9000 },
  evidence: { count: 6, min: 8000, max: 14000, median: 11000, range_low: 10500, range_high: 12000, below_count: 5, checks, passed: 6, confidence: 'high', latest_checked_at: new Date().toISOString() }, ...o });
let overview: Record<string, unknown> = {};
const base = (enabled: boolean) => ({ available: true, settings: { enabled, radius_miles: 5, use_nearby_salons: true, use_competitor_menus: true, show_industry_context: true },
  usage: { used: 0, limit: 25, resets_on: '2026-12-01' }, locations: [{ id: 'loc-1', name: 'Studio 9 Suites', located: true }], own_website_host: null,
  summary: { salons: 14, updated_at: new Date(Date.now() - 2 * 86400000).toISOString(), suggestions: 2, monthly_change_minor: 31000, searching: false, sources_total: 14 },
  rows: [
    row({ service_id: 's1', service_name: 'Silk press', duration_minutes: 90, current_minor: 9500, action: 'raise', suggested_minor: 11000 }),
    row({ service_id: 's2', service_name: 'Natural hair trim', duration_minutes: 45, current_minor: 6000, action: 'raise', suggested_minor: 6500, impact: { per_month: 8, now_minor: 48000, then_minor: 52000, change_minor: 4000 }, evidence: { count: 5, min: 3000, max: 9000, median: 6500, range_low: 6500, range_high: 7000, below_count: 4, checks, passed: 3, confidence: 'low', latest_checked_at: null } }),
    row({ service_id: 's3', service_name: 'Loc retwist', duration_minutes: 120, current_minor: 12000, action: 'hold', suggested_minor: 12000 }),
  ] });
const invoke = vi.fn(async (name: string, options: { body: Record<string, unknown> }) => {
  calls.push({ name, ...options.body });
  if (name === 'price-pilot' && options.body.action === 'overview') return { data: { data: overview }, error: null };
  if (name === 'price-pilot' && options.body.action === 'enable') { overview = base(true); return { data: { data: { enabled: true } }, error: null }; }
  if (name === 'price-pilot') return { data: { data: { applied: [] } }, error: null };
  return { data: { data: null }, error: null };
});
const identity = { client: { functions: { invoke } }, businessId: 'biz-1', loading: false };
vi.mock('../../settings/useArtistBusiness', () => ({ useArtistBusiness: () => identity }));
const flush = async () => { for (let i = 0; i < 8; i += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
const mount = (path: string, element: ReactElement) => {
  const host = document.createElement('div');
  act(() => createRoot(host).render(<MemoryRouter initialEntries={[path]}><PlanProvider><Routes><Route path="/BID-1/growth/price-pilot" element={element} /><Route path="/BID-1/growth/price-pilot/review" element={element} /></Routes></PlanProvider></MemoryRouter>));
  return host;
};
const button = (host: HTMLElement, label: string) => Array.from(host.querySelectorAll('button')).find((b) => b.textContent === label) as HTMLButtonElement | undefined;

describe('PricePilot screens', () => {
  beforeAll(async () => { await i18nReady; });
  beforeEach(() => { calls.length = 0; overview = base(true); sessionStorage.setItem('mova_active_artist_business_display_id', 'BID-1'); });

  it('formats prices and lengths like the boards', () => {
    const t = i18n.t.bind(i18n);
    expect([duration(45, t), duration(90, t), duration(120, t), duration(240, t), duration(150, t)]).toEqual(['45 min', '90 min', '2 hr', '4 hr', '2 hr 30 min']);
    expect([money(9500, 'en-US'), money(9550, 'en-US')]).toEqual(['$95', '$95.50']);
  });

  it('PP8: shows the preview until the stylist turns PricePilot on', async () => {
    overview = base(false);
    const host = mount('/BID-1/growth/price-pilot', <PricePilotOverviewPage />); await flush();
    expect(host.textContent).toContain('Every service, checked against nearby salons.');
    expect(host.textContent).toContain('Sample data');
    await act(async () => { button(host, 'Turn on PricePilot')!.click(); }); await flush();
    expect(calls).toContainEqual({ name: 'price-pilot', action: 'enable' });
    expect(host.textContent).toContain('Your prices');
  });

  it('PP1: lists suggestions with the monthly estimate and filters', async () => {
    const host = mount('/BID-1/growth/price-pilot', <PricePilotOverviewPage />); await flush();
    expect(host.textContent).toContain('Checked against 14 nearby salons · updated 2 days ago');
    expect(host.textContent).toContain('2 suggestions');
    expect(host.textContent).toContain('+$310 a month');
    expect(host.textContent).toContain('Mova never changes your prices without your OK.');
    await act(async () => { button(host, 'Hold 1')!.click(); }); await flush();
    expect(host.textContent).toContain('Loc retwist');
    expect(host.textContent).not.toContain('Natural hair trim');
  });

  it('PP4: pre-ticks confident suggestions and applies only the ticked ones', async () => {
    const host = mount('/BID-1/growth/price-pilot/review', <PricePilotReviewPage />); await flush();
    expect(host.textContent).toContain('$60 → $65 · low confidence');
    expect(host.textContent).toContain('+$90 / month');
    await act(async () => { button(host, 'Update 1 price')!.click(); }); await flush();
    const apply = calls.find((c) => c.action === 'apply') as { changes: Array<Record<string, unknown>> };
    expect(apply.changes).toEqual([{ service_id: 's1', location_id: 'loc-1', new_price_minor: 11000, expected_current_minor: 9500, reference_median_minor: 11000, evidence_count: 6 }]);
  });
});
