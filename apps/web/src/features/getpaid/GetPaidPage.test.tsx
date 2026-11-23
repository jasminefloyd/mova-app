import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18nReady } from '../../i18n';
import { GetPaidPage } from './GetPaidPage';

// Board 18: card by pay link (texted or QR), cash and other. The fee follows the stylist's plan.
const appointment = { id: 'ap-1', appointment_number: 1, status: 'confirmed', starts_at: '2026-11-24T15:00:00.000Z', service_name_snapshot: 'Silk press', service_price_minor: 9500, balance_due_minor: 7000, client_name: 'Andrea L.', client_phone: '+1 (312) 555-0148', client_locale: 'en-US', location_id: 'L1', artist_business_id: 'biz-1' };
const tables: Record<string, unknown> = {
  mova_appointments: appointment,
  mova_locations: { name: 'Studio 9 Suites', payment_collector: 'artist', time_zone: 'America/New_York' },
  mova_stripe_connections: { status: 'active', charges_enabled: true, account_type: 'express' },
  mova_payment_method_settings: { cash_enabled: true, other_enabled: true },
  mova_appointment_services: [{ position: 0, service_name_snapshot: 'Silk press' }, { position: 1, service_name_snapshot: 'Trim' }],
};
const query = (table: string) => {
  const chain = { select: () => chain, eq: () => chain, order: async () => ({ data: tables[table], error: null }), maybeSingle: async () => ({ data: tables[table], error: null }) };
  return chain;
};
const client = { from: query, auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) } };
const identity = { client, businessId: 'biz-1', loading: false };
vi.mock('../settings/useArtistBusiness', () => ({ useArtistBusiness: () => identity }));
let feeBps = 75;
vi.mock('../billing/PlanProvider', () => ({ usePlan: () => ({ summary: { current_plan: { plan_key: 'ai_growth', mova_fee_basis_points: feeBps } } }) }));
vi.mock('../identity/QrCode', () => ({ QrCode: ({ value }: { value: string }) => <img data-testid="qr" alt="" data-value={value} /> }));

let response: { status: number; body: unknown } = { status: 201, body: { data: { pay_url: 'https://mova-beauty.co/pay/abc', expires_at: '2026-11-25T14:00:00.000Z' } } };
const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
const flush = async () => { for (let i = 0; i < 6; i += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
const mount = () => {
  const host = document.createElement('div');
  act(() => createRoot(host).render(<MemoryRouter initialEntries={['/BID-1/appointments/AID-1/pay']}><Routes><Route path="/BID-1/appointments/:appointmentId/pay" element={<GetPaidPage />} /></Routes></MemoryRouter>));
  return host;
};
const button = (host: HTMLElement, label: string) => Array.from(host.querySelectorAll('button')).find((b) => b.textContent === label) as HTMLButtonElement;

describe('Get paid', () => {
  beforeAll(async () => { await i18nReady; });
  beforeEach(() => {
    requests.length = 0; feeBps = 75;
    response = { status: 201, body: { data: { pay_url: 'https://mova-beauty.co/pay/abc', expires_at: '2026-11-25T14:00:00.000Z' } } };
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => { requests.push({ url, body: JSON.parse(String(init.body)) }); return new Response(JSON.stringify(response.body), { status: response.status }); }));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('shows the plan fee, the dollar sign and one selection mark per option', async () => {
    const host = mount(); await flush();
    expect(host.textContent).toContain('Silk press + Trim · Andrea L. · $70.00 balance');
    expect(host.querySelector('.mova-get-paid__money')?.textContent).toContain('$');
    expect((host.querySelector('.mova-get-paid__money input') as HTMLInputElement).readOnly).toBe(true);
    expect(host.textContent).toContain('Mova fee 0.75% ($0.53) plus Stripe processing.');
    expect(button(host, 'Send $70.00 pay link').disabled).toBe(false);
  });

  it('creates a texted pay link and opens Messages with it', async () => {
    const host = mount(); await flush();
    await act(async () => { button(host, 'Send $70.00 pay link').click(); }); await flush();
    expect(requests[0].url).toContain('/functions/v1/paylink-create');
    expect(requests[0].body).toEqual({ appointment_id: 'ap-1', channel: 'sms' });
    expect(host.textContent).toContain('Pay link ready');
    const text = Array.from(host.querySelectorAll('a')).find((a) => a.textContent === 'Text Andrea the link') as HTMLAnchorElement;
    expect(text.getAttribute('href')).toBe(`sms:+13125550148?&body=${encodeURIComponent('Hi Andrea, here’s your link to pay $70.00: https://mova-beauty.co/pay/abc')}`);
  });

  it('shows a QR code for the chair', async () => {
    const host = mount(); await flush();
    const qr = host.querySelector('input[name="card-delivery"][value="qr"]') as HTMLInputElement;
    await act(async () => { qr.click(); });
    await act(async () => { button(host, 'Show a pay QR code').click(); }); await flush();
    expect(requests[0].body).toEqual({ appointment_id: 'ap-1', channel: 'qr' });
    expect(host.textContent).toContain('Scan to pay $70.00');
    expect(host.querySelector('[data-testid="qr"]')?.getAttribute('data-value')).toBe('https://mova-beauty.co/pay/abc');
  });

  it('explains when card payments are not switched on', async () => {
    response = { status: 503, body: { data: { code: 'STRIPE_TEST_MODE_DISABLED' }, error: { code: 'STRIPE_TEST_MODE_DISABLED' } } };
    const host = mount(); await flush();
    await act(async () => { button(host, 'Send $70.00 pay link').click(); }); await flush();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('Card payments aren’t switched on for Mova yet. Record cash or other for now.');
  });
});
