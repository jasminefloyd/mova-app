import { describe, expect, it, vi } from 'vitest';
import { FAKE_CODE, FAKE_EMAIL, FAKE_LOCATION_ID, FakeGoogleProvider, GOOGLE_BUSINESS_SCOPE, GOOGLE_CALENDAR_SCOPE, GoogleProviderError, LiveGoogleProvider, canonicalJson, desiredListing, googleProviderFromEnv, listingPatch, pendingListing, servicesMenu, usdMoney, type ServiceRow } from './index.ts';

const env = (values: Record<string, string>) => (name: string) => values[name];
const services: ServiceRow[] = [
  { id: 's1', name: 'Silk press', status: 'active', base_price_minor: 15000, duration_minutes: 120 },
  { id: 's2', name: 'Knotless braids', status: 'active', base_price_minor: 26000, duration_minutes: 300 },
  { id: 's3', name: 'Old cut', status: 'inactive', base_price_minor: 5000, duration_minutes: 30 },
];
const profile = { display_name: 'Ari Monroe Hair', bio: 'Silk presses.', handle: 'ari-monroe' };
const hours = [{ weekday: 1, opens_at: '09:00', closes_at: '17:30' }];

describe('Google listing rules (P6)', () => {
  it('canonical JSON ignores key order', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, 2], c: null } })).toBe(canonicalJson({ a: { c: null, d: [1, 2] }, b: 1 }));
  });
  it('money is USD minor units split into units and nanos', () => {
    expect(usdMoney(14000)).toEqual({ currencyCode: 'USD', units: '140', nanos: 0 });
    expect(usdMoney(6550)).toEqual({ currencyCode: 'USD', units: '65', nanos: 500_000_000 });
  });
  it('desired items carry profile, hours, booking link and only active services', () => {
    const items = desiredListing({ profile, hours, services, publicBaseUrl: 'https://mova-beauty.co/' });
    expect(items.map((item) => item.key)).toEqual(['profile', 'hours', 'booking_link', 'service:s1', 'service:s2']);
    expect(items[2]?.payload).toEqual({ websiteUri: 'https://mova-beauty.co/a/ari-monroe' });
    expect(items[1]?.payload).toEqual({ regularHours: [{ openDay: 'MONDAY', closeDay: 'MONDAY', openTime: { hours: 9, minutes: 0 }, closeTime: { hours: 17, minutes: 30 } }] });
  });
  it('a service with a changed price is the only waiting change; nothing else shows up', () => {
    const before = desiredListing({ profile, hours, services, publicBaseUrl: 'https://mova-beauty.co' });
    const snapshots = before.map((item) => ({ item_key: item.key, payload: item.payload }));
    expect(pendingListing(before, snapshots, new Map())).toEqual([]);
    const changed = desiredListing({ profile, hours, services: [{ ...services[0]!, base_price_minor: 15500 }, services[1]!], publicBaseUrl: 'https://mova-beauty.co' });
    expect(pendingListing(changed, snapshots, new Map([['service:s1', 'Silk press']]))).toEqual([{ key: 'service:s1', kind: 'service', label: 'Silk press' }]);
  });
  it('a new service is waiting, and a service removed from the menu is waiting as removed', () => {
    const snapshots = [{ item_key: 'service:s1', payload: desiredListing({ profile, hours, services: [services[0]!], publicBaseUrl: 'x' })[3]!.payload }, { item_key: 'service:gone', payload: { displayName: 'Gone' } }];
    const desired = desiredListing({ profile, hours, services: [services[0]!, services[1]!], publicBaseUrl: 'https://mova-beauty.co' });
    const pending = pendingListing(desired, snapshots, new Map([['service:s2', 'Knotless braids'], ['service:gone', 'Gone']]));
    expect(pending).toEqual([
      { key: 'profile', kind: 'profile', label: 'profile' }, { key: 'hours', kind: 'hours', label: 'hours' }, { key: 'booking_link', kind: 'booking_link', label: 'booking_link' },
      { key: 'service:s2', kind: 'service_new', label: 'Knotless braids' }, { key: 'service:gone', kind: 'service_removed', label: 'Gone' },
    ]);
  });
  it('the services menu sends every active service as one list', () => {
    const menu = servicesMenu(desiredListing({ profile, hours, services, publicBaseUrl: 'x' }));
    expect(menu.key).toBe('services');
    expect((menu.payload.services as unknown[]).length).toBe(2);
  });
});

describe('Google fake provider (P6)', () => {
  it('authorizes straight back with the fake code and our state', () => {
    const url = new URL(new FakeGoogleProvider().authorizationUrl({ redirectUri: 'https://ops.example.test/api/callback', state: 'st', codeChallenge: 'c', scopes: [GOOGLE_CALENDAR_SCOPE] }));
    expect(url.searchParams.get('code')).toBe(FAKE_CODE);
    expect(url.searchParams.get('state')).toBe('st');
  });
  it('exchanges only the fake code and labels the account as a sample', async () => {
    const provider = new FakeGoogleProvider();
    await expect(provider.exchangeCode({ code: 'real-code', codeVerifier: 'v', redirectUri: 'x' })).rejects.toThrow('GOOGLE_TOKEN_EXCHANGE_FAILED');
    const token = await provider.exchangeCode({ code: FAKE_CODE, codeVerifier: 'v', redirectUri: 'x' });
    expect(token.email).toBe(FAKE_EMAIL);
    expect(token.email).toMatch(/\.invalid$/);
    expect(token.grantedScopes).toEqual([GOOGLE_CALENDAR_SCOPE, GOOGLE_BUSINESS_SCOPE]);
  });
  it('lists the sample calendars and records every write', async () => {
    const provider = new FakeGoogleProvider();
    expect((await provider.listCalendars('t')).map((calendar) => calendar.summary)).toEqual(['Work', 'Personal']);
    await provider.saveCalendarEvent('t', 'fake-work', { eventId: 'e1', summary: 'Silk press', startsAt: '2026-11-10T15:00:00Z', endsAt: '2026-11-10T17:00:00Z', cancelled: false, sequence: 1, exists: false });
    await provider.applyListingItem('t', FAKE_LOCATION_ID, { key: 'profile', kind: 'profile', payload: { title: 'x' } });
    await provider.replyToReview('t', FAKE_LOCATION_ID, 'r1', 'Thanks');
    expect(provider.calls.map((call) => call.op)).toEqual(['calendar_event', 'listing', 'reply']);
  });
  it('refuses real-looking location ids and returns the fixture reviews for sample ones', async () => {
    const provider = new FakeGoogleProvider();
    await expect(provider.listReviews('t', 'accounts/123/locations/456')).rejects.toThrow('GOOGLE_LOCATION_NOT_FOUND');
    expect((await provider.listReviews('t', FAKE_LOCATION_ID)).map((review) => review.rating)).toEqual([5, 4, 5]);
    expect(provider.live).toBe(false);
  });
});

describe('Google provider selection and the live provider (off by default)', () => {
  it('is off when nothing is set, and when live is requested without the enable switch or secrets', () => {
    expect(googleProviderFromEnv(env({}))).toBeNull();
    expect(googleProviderFromEnv(env({ MOVA_GOOGLE_PROVIDER: 'live' }))).toBeNull();
    expect(googleProviderFromEnv(env({ MOVA_GOOGLE_PROVIDER: 'live', MOVA_GOOGLE_LIVE_ENABLED: 'true' }))).toBeNull();
    expect(googleProviderFromEnv(env({ MOVA_GOOGLE_PROVIDER: 'twilio' }))).toBeNull();
  });
  it('selects the fake and, only when fully switched on, the live provider', () => {
    expect(googleProviderFromEnv(env({ MOVA_GOOGLE_PROVIDER: 'fake' }))?.name).toBe('fake');
    const live = googleProviderFromEnv(env({ MOVA_GOOGLE_PROVIDER: 'live', MOVA_GOOGLE_LIVE_ENABLED: 'true', GOOGLE_OAUTH_CLIENT_ID: 'id', GOOGLE_OAUTH_CLIENT_SECRET: 'secret' }));
    expect(live?.name).toBe('google');
    expect(live?.live).toBe(true);
  });
  it('builds the consent URL with offline access, both scopes and PKCE', () => {
    const provider = new LiveGoogleProvider({ clientId: 'client-id', clientSecret: 'secret' });
    const url = new URL(provider.authorizationUrl({ redirectUri: 'https://ops.example.test/cb', state: 's', codeChallenge: 'ch', scopes: [GOOGLE_CALENDAR_SCOPE, GOOGLE_BUSINESS_SCOPE] }));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toBe(`${GOOGLE_CALENDAR_SCOPE} ${GOOGLE_BUSINESS_SCOPE}`);
  });
  it('refuses a token exchange that returns no refresh token', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ access_token: 'a' }), { status: 200 }));
    await expect(new LiveGoogleProvider({ clientId: 'c', clientSecret: 's', fetcher }).exchangeCode({ code: 'x', codeVerifier: 'v', redirectUri: 'r' })).rejects.toThrow(GoogleProviderError);
  });
  it('treats a 410 on a cancelled event as already gone, and any other failure as an error', async () => {
    const gone = new LiveGoogleProvider({ clientId: 'c', clientSecret: 's', fetcher: async () => new Response('', { status: 410 }) });
    await expect(gone.saveCalendarEvent('t', 'work', { eventId: 'e', summary: '', startsAt: '', endsAt: '', cancelled: true, sequence: 2, exists: true })).resolves.toBeUndefined();
    const broken = new LiveGoogleProvider({ clientId: 'c', clientSecret: 's', fetcher: async () => new Response('', { status: 500 }) });
    await expect(broken.saveCalendarEvent('t', 'work', { eventId: 'e', summary: 'x', startsAt: '', endsAt: '', cancelled: false, sequence: 1, exists: false })).rejects.toThrow('GOOGLE_EVENT_WRITE_FAILED');
  });
  it('never calls out for malformed location or review ids', async () => {
    const fetcher = vi.fn(async () => new Response('{}', { status: 200 }));
    const provider = new LiveGoogleProvider({ clientId: 'c', clientSecret: 's', fetcher });
    await expect(provider.replyToReview('t', '../../evil', 'r1', 'x')).rejects.toThrow('GOOGLE_LOCATION_INVALID');
    await expect(provider.replyToReview('t', 'accounts/1/locations/2', 'r1/../../x', 'x')).rejects.toThrow('GOOGLE_REVIEW_INVALID');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('maps listing items to Business Profile field masks', () => {
    expect(listingPatch({ key: 'profile', kind: 'profile', payload: { title: 'Ari', description: 'Bio' } }).mask).toBe('title,profile.description');
    expect(listingPatch({ key: 'booking_link', kind: 'booking_link', payload: { websiteUri: 'https://x.test/a/y' } }).mask).toBe('websiteUri');
    const menu = listingPatch({ key: 'services', kind: 'services', payload: { services: [{ displayName: 'Silk press', price: usdMoney(14000) }] } });
    expect(menu.mask).toBe('serviceItems');
    expect(menu.body).toEqual({ serviceItems: [{ freeFormServiceItem: { category: 'Hair', displayName: 'Silk press' }, price: { currencyCode: 'USD', units: '140', nanos: 0 } }] });
  });
});
