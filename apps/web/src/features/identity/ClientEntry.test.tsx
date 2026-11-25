import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { i18nReady } from '../../i18n';
import { BookingManageRoute } from '../bookings/BookingManageRoute';
import { ScanLandingPage } from './ScanLandingPage';
import { SignInPage } from './SignInPage';

const getSession = vi.hoisted(() => vi.fn());
vi.mock('../../lib/supabase', () => ({ createMovaSupabaseClient: () => ({ auth: { getSession } }) }));
vi.mock('../../lib/env', async (original) => ({
  ...(await original<typeof import('../../lib/env')>()),
  clientProfilesEnabled: true,
  walletClientCardEnabled: false,
}));

let host: HTMLDivElement;
let root: Root;

beforeAll(async () => {
  await i18nReady;
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
beforeEach(() => {
  getSession.mockResolvedValue({ data: { session: null } });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function go(path: string) {
  await act(async () => {
    root.render(<MemoryRouter initialEntries={[path]}><Routes>
      <Route path="/signin" element={<SignInPage />} />
      <Route path="/s/:handle" element={<ScanLandingPage />} />
      <Route path="/b/:token" element={<BookingManageRoute />} />
      <Route path="/a/:handle" element={<h1>Public profile</h1>} />
    </Routes></MemoryRouter>);
    await new Promise(resolve => setTimeout(resolve, 0));
  });
}

it('keeps the customer sign-in sheet free of stylist links and Wallet promises', async () => {
  await go('/signin?artist=nia-flores&returnTo=%2Fa%2Fnia-flores');
  expect(host.querySelector('dialog')?.textContent).toContain('Continue as a guest');
  expect(host.querySelector('a[href^="/login"]')).toBeNull();
  expect(host.textContent).not.toContain('Keep your client card');
});

it('returns an already signed-in customer to the stylist profile', async () => {
  getSession.mockResolvedValue({ data: { session: { access_token: 'client-session' } } });
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: { profile: { display_name: 'Dana' } } })));
  await go('/signin?artist=nia-flores&returnTo=%2Fa%2Fnia-flores');
  expect(host.textContent).toBe('Public profile');
});

it('shows the QR profile layout even if scan tracking fails', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (!url.endsWith('/public-artist')) throw new Error('Tracking unavailable');
    return Response.json({ data: {
      profile: { display_name: 'Nia Flores', handle: 'nia-flores', specialties: ['Color'], photo_urls: {} },
      locations: [{ id: 'studio', name: 'North studio' }],
    } });
  }));
  await go('/s/nia-flores');
  expect(host.querySelector('.mova-scan-landing__hero')?.textContent).toContain('Nia FloresColorNorth studio');
  expect(host.querySelector('.mova-scan-landing__card a')?.textContent).toContain('Add Nia to My stylists');
  expect(host.querySelector('.mova-scan-landing__profile')?.getAttribute('href')).toBe('/a/nia-flores');
  expect(host.textContent).not.toMatch(/Apple Wallet|Google Wallet/);
});

it('shows appointment details without a client card or token request when Wallet is off', async () => {
  const fetcher = vi.fn(async () => Response.json({ data: { booking: {
    id: 'booking', status: 'pending_artist', starts_at: '2026-12-01T15:00:00Z', ends_at: '2026-12-01T16:00:00Z',
    service_name_snapshot: 'Color refresh', deposit_due_minor: 0, cancellation_window_minutes: 0,
    artist: { display_name: 'Nia Flores', handle: 'nia-flores' }, location: { name: 'North studio', time_zone: 'America/New_York' },
  } } }));
  vi.stubGlobal('fetch', fetcher);
  await go('/b/test');
  expect(host.textContent).toContain('Color refresh');
  expect(host.querySelector('.mova-booking__card-section')).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(getSession).not.toHaveBeenCalled();
});
