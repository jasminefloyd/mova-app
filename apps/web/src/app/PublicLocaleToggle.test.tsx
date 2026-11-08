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

function setInputValue(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
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

  it('TC-F13-V1-02 persists the guest locale and keeps the selected service, day, and time', async () => {
    localStorage.setItem(GUEST_LOCALE_KEY, 'en-US');
    const selectedSlot = { starts_at: '2026-12-01T15:00:00.000Z', ends_at: '2026-12-01T16:30:00.000Z', local_date: '2026-12-01', local_time: '10:00', utc_offset: '-05:00', time_zone: 'America/New_York', booking_mode: 'request' as const };
    const mockFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body ?? '{}')) as { locale?: string };
      if (url.includes('/public-artist')) return new Response(JSON.stringify({ data: { ...artist, requested_locale: body.locale } }), { status: 200 });
      if (url.includes('/availability-search')) return new Response(JSON.stringify({ data: { days: [{ date: selectedSlot.local_date, open_count: 1 }], groups: [{ location_id: 'loc-studio', slots: [selectedSlot] }] } }), { status: 200 });
      return new Response(JSON.stringify({ data: {} }), { status: 200 });
    });
    vi.stubGlobal('fetch', mockFetch);

    const view = renderBooking();
    mounted.push(view);
    await waitFor(() => view.host.querySelector('.mova-time-options button') !== null);

    const service = view.host.querySelector('.mova-booking__service strong') as HTMLElement;
    const dateButton = view.host.querySelector('.mova-day-options button') as HTMLButtonElement;
    const timeButton = view.host.querySelector('.mova-time-options button') as HTMLButtonElement;
    act(() => { timeButton.click(); });
    expect(service.textContent).toBe('Signature color');
    expect(dateButton.getAttribute('aria-pressed')).toBe('true');
    expect(timeButton.getAttribute('aria-pressed')).toBe('true');

    act(() => { (Array.from(view.host.querySelectorAll('button')).find(button => button.textContent === 'ES') as HTMLButtonElement).click(); });
    await waitFor(() => view.host.querySelector('.mova-booking__service') !== null);

    expect(localStorage.getItem(GUEST_LOCALE_KEY)).toBe('es-US');
    expect(document.documentElement.lang).toBe('es-US');
    expect(view.host.querySelector('h2')?.textContent).toBe('Elige una fecha');
    const search = view.host.querySelector('[data-testid="current-search"]')?.textContent ?? '';
    const params = new URLSearchParams(search);
    expect(params.get('locale')).toBe('es-US');
    expect(params.get('campaign')).toBe('spring');
    expect(service.textContent).toBe('Signature color');
    expect(view.host.querySelector('.mova-day-options button')?.getAttribute('aria-pressed')).toBe('true');
    expect(view.host.querySelector('.mova-time-options button')?.getAttribute('aria-pressed')).toBe('true');
    expect(mockFetch.mock.calls.filter(([url]) => String(url).includes('/public-artist')).map(([, init]) => JSON.parse(String(init?.body)).locale)).toContain('es-US');
  });

  it('TC-F04-DEP-02 blocks deposit-required bookings before requesting online availability', async () => {
    localStorage.setItem(GUEST_LOCALE_KEY, 'en-US');
    const selectedSlot = { starts_at: '2026-12-01T15:00:00.000Z', ends_at: '2026-12-01T16:30:00.000Z', local_date: '2026-12-01', local_time: '10:00', utc_offset: '-05:00', time_zone: 'America/New_York', booking_mode: 'request' as const };
    const baseService = artist.services[0]!;
    const basePricing = baseService.location_deposits[0]!;
    const depositArtist = { ...artist, services: [{ ...baseService, deposit_type: 'fixed' as const, deposit_value: 2000, location_deposits: [{ ...basePricing, deposit_amount_minor: 2000 }] }] };
    const mockFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body ?? '{}')) as { locale?: string };
      if (url.includes('/public-artist')) return new Response(JSON.stringify({ data: { ...depositArtist, requested_locale: body.locale } }), { status: 200 });
      if (url.includes('/availability-search')) return new Response(JSON.stringify({ data: { days: [{ date: selectedSlot.local_date, open_count: 1 }], groups: [{ location_id: 'loc-studio', slots: [selectedSlot] }] } }), { status: 200 });
      return new Response(JSON.stringify({ data: {} }), { status: 200 });
    });
    vi.stubGlobal('fetch', mockFetch);

    const view = renderBooking();
    mounted.push(view);
    await waitFor(() => view.host.querySelector('[role="alert"]') !== null);
    expect(view.host.querySelector('[role="alert"]')?.textContent).toContain("Online booking is unavailable for this service");
    expect(view.host.querySelector('input[autocomplete="name"]')).toBeNull();
    expect(view.host.querySelector('.mova-day-options')).toBeNull();
    expect(view.host.querySelector('.mova-time-options')).toBeNull();
    expect(mockFetch.mock.calls.some(([url]) => String(url).includes('/availability-search'))).toBe(false);
    expect(mockFetch.mock.calls.some(([url]) => String(url).includes('/booking-create'))).toBe(false);

    act(() => { (Array.from(view.host.querySelectorAll('button')).find(button => button.textContent === 'ES') as HTMLButtonElement).click(); });
    await waitFor(() => view.host.querySelector('[role="alert"]')?.textContent.includes('La reserva en línea') ?? false);
    expect(mockFetch.mock.calls.some(([url]) => String(url).includes('/availability-search'))).toBe(false);
    expect(mockFetch.mock.calls.some(([url]) => String(url).includes('/booking-create'))).toBe(false);
  });

  it.each([
    { mode: 'instant' as const, submit: 'Book appointment' },
    { mode: 'request' as const, submit: 'Request booking' },
  ])('TC-SCR-25-01 / TC-SCR-26-01 / TC-F04-AC01-01 five-day picker and details step keep $mode booking status honest', async ({ mode, submit }) => {
    const day = '2026-12-01';
    const selectedSlot = { starts_at: '2026-12-01T15:00:00.000Z', ends_at: '2026-12-01T16:30:00.000Z', local_date: day, local_time: '10:00', utc_offset: '-05:00', time_zone: 'America/New_York', booking_mode: mode };
    const bookingArtist = { ...artist, locations: [{ ...artist.locations[0]!, booking_mode: mode }] };
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const mockFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      calls.push({ url, body });
      if (url.includes('/public-artist')) return new Response(JSON.stringify({ data: bookingArtist }), { status: 200 });
      if (url.includes('/availability-search')) return new Response(JSON.stringify({ data: { days: [0,1,2,3,4,5].map((offset) => ({ date: `2026-12-0${offset + 1}`, open_count: offset === 5 ? 0 : 1 })), groups: [{ location_id: 'loc-studio', slots: [selectedSlot] }] } }), { status: 200 });
      if (url.includes('/booking-create')) return new Response(JSON.stringify({ data: { id: 'f7777777-7777-4777-8777-777777777777', manage_url: 'https://mova.invalid/b/synthetic-token' } }), { status: 201 });
      return new Response(JSON.stringify({ data: {} }), { status: 200 });
    });
    vi.stubGlobal('fetch', mockFetch);

    const view = renderBooking();
    mounted.push(view);
    await waitFor(() => view.host.querySelectorAll('.mova-booking__day').length === 5);
    const dayButtons = Array.from(view.host.querySelectorAll('.mova-booking__day')) as HTMLButtonElement[];
    expect(dayButtons.map((button) => button.textContent?.replaceAll(/\s+/g, ' ').trim())).toHaveLength(5);
    expect(dayButtons[0]?.getAttribute('aria-pressed')).toBe('true');
    const nextDays = view.host.querySelector('[aria-label="Next five days"]') as HTMLButtonElement;
    act(() => { nextDays.click(); });
    const lastDay = view.host.querySelector('.mova-booking__day') as HTMLButtonElement;
    expect(lastDay.textContent).toContain('Full');
    expect(lastDay.disabled).toBe(true);
    act(() => { (view.host.querySelector('[aria-label="Previous five days"]') as HTMLButtonElement).click(); });
    const slotButton = view.host.querySelector('.mova-time-options button') as HTMLButtonElement;
    act(() => { slotButton.click(); });
    expect(view.host.querySelector('.mova-booking__mode')?.textContent).toContain(mode === 'instant' ? 'Confirmed instantly' : 'Stylist confirms');
    act(() => { (Array.from(view.host.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Continue') as HTMLButtonElement).click(); });
    expect(view.host.querySelector('input[autocomplete="name"]')).not.toBeNull();
    if (mode === 'request') expect(view.host.textContent).toContain('not confirmed until the stylist accepts it');
    expect(view.host.textContent).not.toContain('confirmed' + ' appointment');

    act(() => {
      setInputValue(view.host.querySelector('input[autocomplete="name"]') as HTMLInputElement, 'Sam Guest');
      setInputValue(view.host.querySelector('input[autocomplete="email"]') as HTMLInputElement, 'sam@example.invalid');
      setInputValue(view.host.querySelector('input[autocomplete="tel"]') as HTMLInputElement, '+12025550141');
    });
    const reviewCheckbox = Array.from(view.host.querySelectorAll('.mova-booking__consents input'))[0] as HTMLInputElement;
    const rebookingEmail = Array.from(view.host.querySelectorAll('.mova-booking__consents input'))[1] as HTMLInputElement;
    expect(reviewCheckbox.checked).toBe(true);
    expect(rebookingEmail.checked).toBe(false);
    act(() => { rebookingEmail.click(); });
    const submitButton = Array.from(view.host.querySelectorAll('button')).find((button) => button.textContent?.trim() === submit) as HTMLButtonElement;
    expect(submitButton.disabled).toBe(false);
    await act(async () => { submitButton.click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
    const bookingRequest = calls.find((call) => call.url.includes('/booking-create'));
    expect(bookingRequest?.body.consents).toEqual({ rebooking_reminders: { email: true, sms: false }, offers: { email: false, sms: false }, review_requests: { email: true } });
  });
});
