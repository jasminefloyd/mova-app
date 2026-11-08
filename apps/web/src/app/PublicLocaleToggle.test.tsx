import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { BookingRoute } from '../features/bookings/BookingRoute';
import { i18nReady } from '../i18n';
import { GUEST_LOCALE_KEY } from './locale';
import { LocaleProvider } from './LocaleProvider';

const artist = {
  profile: { display_name: 'Nia Flores', handle: 'nia-flores', specialties: ['Color'], bio: 'Color specialist', preferred_locale: 'en-US', search_index_enabled: true, photo_urls: {} },
  services: [{ id: 'svc-color', name: 'Signature color', category: 'Color', duration_minutes: 90, base_price_minor: 12000, deposit_type: 'none' as const, deposit_value: 0, location_deposits: [{ location_id: 'loc-studio', price_minor: 12000, duration_minutes: 90, deposit_amount_minor: 0 }] }],
  locations: [{ id: 'loc-studio', name: 'North studio', booking_mode: 'request' as const, time_zone: 'America/New_York' }],
  looks: [],
  bookable: true,
};

function CurrentSearch() {
  const location = useLocation();
  return <output data-testid="current-search">{location.search}</output>;
}

function renderBooking(search = '?service_id=svc-color&campaign=spring') {
  const host = document.createElement('div');
  document.body.append(host);
  let root: Root;
  act(() => {
    root = createRoot(host);
    root.render(<MemoryRouter initialEntries={[`/a/nia-flores/book${search}`]}>
      <LocaleProvider storageKey={GUEST_LOCALE_KEY}>
        <Routes><Route path="/a/:handle/book" element={<><BookingRoute/><CurrentSearch/></>} /></Routes>
      </LocaleProvider>
    </MemoryRouter>);
  });
  return { host, root: root! };
}

async function waitFor(predicate: () => boolean) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (predicate()) return;
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  }
  throw new Error('Timed out waiting for the booking flow to render');
}

describe('public booking locale switch', () => {
  let mounted: Array<{ host: HTMLDivElement; root: Root }> = [];

  beforeAll(async () => { await i18nReady; });
  afterEach(() => {
    act(() => { mounted.forEach(({ root }) => root.unmount()); });
    mounted.forEach(({ host }) => host.remove());
    mounted = [];
    vi.unstubAllGlobals();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('persists the guest locale and keeps the selected service, day, and time', async () => {
    localStorage.setItem(GUEST_LOCALE_KEY, 'en-US');
    const selectedSlot = { starts_at: '2026-12-01T15:00:00.000Z', ends_at: '2026-12-01T16:30:00.000Z', local_date: '2026-12-01', local_time: '10:00', utc_offset: '-05:00', time_zone: 'America/New_York', booking_mode: 'request' as const };
    const mockFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body ?? '{}')) as { locale?: string };
      if (url.includes('/public-artist')) return new Response(JSON.stringify({ data: { ...artist, requested_locale: body.locale } }), { status: 200 });
      if (url.includes('/availability-search')) return new Response(JSON.stringify({ data: { groups: [{ location_id: 'loc-studio', slots: [selectedSlot] }] } }), { status: 200 });
      return new Response(JSON.stringify({ data: {} }), { status: 200 });
    });
    vi.stubGlobal('fetch', mockFetch);

    const view = renderBooking();
    mounted.push(view);
    await waitFor(() => view.host.querySelector('.mova-time-options button') !== null);

    const service = view.host.querySelector('select') as HTMLSelectElement;
    const dateButton = view.host.querySelector('.mova-day-options button') as HTMLButtonElement;
    const timeButton = view.host.querySelector('.mova-time-options button') as HTMLButtonElement;
    act(() => { timeButton.click(); });
    expect(service.value).toBe('svc-color');
    expect(dateButton.getAttribute('aria-pressed')).toBe('true');
    expect(timeButton.getAttribute('aria-pressed')).toBe('true');

    act(() => { (Array.from(view.host.querySelectorAll('button')).find(button => button.textContent === 'ES') as HTMLButtonElement).click(); });
    await waitFor(() => view.host.querySelector('.mova-booking__summary') !== null);

    expect(localStorage.getItem(GUEST_LOCALE_KEY)).toBe('es-US');
    expect(document.documentElement.lang).toBe('es-US');
    expect(view.host.querySelector('h2')?.textContent).toBe('Elige un servicio');
    const search = view.host.querySelector('[data-testid="current-search"]')?.textContent ?? '';
    const params = new URLSearchParams(search);
    expect(params.get('locale')).toBe('es-US');
    expect(params.get('campaign')).toBe('spring');
    expect(service.value).toBe('svc-color');
    expect(view.host.querySelector('.mova-day-options button')?.getAttribute('aria-pressed')).toBe('true');
    expect(view.host.querySelector('.mova-time-options button')?.getAttribute('aria-pressed')).toBe('true');
    expect(mockFetch.mock.calls.filter(([url]) => String(url).includes('/public-artist')).map(([, init]) => JSON.parse(String(init?.body)).locale)).toContain('es-US');
  });

  it('blocks deposit-required bookings and shows the explanation in the guest locale', async () => {
    localStorage.setItem(GUEST_LOCALE_KEY, 'en-US');
    const selectedSlot = { starts_at: '2026-12-01T15:00:00.000Z', ends_at: '2026-12-01T16:30:00.000Z', local_date: '2026-12-01', local_time: '10:00', utc_offset: '-05:00', time_zone: 'America/New_York', booking_mode: 'request' as const };
    const baseService = artist.services[0]!;
    const basePricing = baseService.location_deposits[0]!;
    const depositArtist = { ...artist, services: [{ ...baseService, deposit_type: 'fixed' as const, deposit_value: 2000, location_deposits: [{ ...basePricing, deposit_amount_minor: 2000 }] }] };
    const mockFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body ?? '{}')) as { locale?: string };
      if (url.includes('/public-artist')) return new Response(JSON.stringify({ data: { ...depositArtist, requested_locale: body.locale } }), { status: 200 });
      if (url.includes('/availability-search')) return new Response(JSON.stringify({ data: { groups: [{ location_id: 'loc-studio', slots: [selectedSlot] }] } }), { status: 200 });
      return new Response(JSON.stringify({ data: {} }), { status: 200 });
    });
    vi.stubGlobal('fetch', mockFetch);

    const view = renderBooking();
    mounted.push(view);
    await waitFor(() => view.host.querySelector('.mova-time-options button') !== null);
    act(() => { (view.host.querySelector('.mova-time-options button') as HTMLButtonElement).click(); });
    expect(view.host.querySelector('[role="alert"]')?.textContent).toContain("Online booking is unavailable for this service");
    expect(view.host.querySelector('input[autocomplete="name"]')).toBeNull();
    expect(mockFetch.mock.calls.some(([url]) => String(url).includes('/booking-create'))).toBe(false);

    act(() => { (Array.from(view.host.querySelectorAll('button')).find(button => button.textContent === 'ES') as HTMLButtonElement).click(); });
    await waitFor(() => view.host.querySelector('[role="alert"]')?.textContent.includes('La reserva en línea') ?? false);
    expect(mockFetch.mock.calls.some(([url]) => String(url).includes('/booking-create'))).toBe(false);
  });
});
