import type { Page, Route } from '@playwright/test';

// Connections (CN1–CN8) route mocks with sample data; nothing reaches a provider.
const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-mova-artist-business-id', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
type Calls = Array<{ name: string; body: Record<string, unknown> }>;

const google = {
  google_account_email: 'sample.stylist@example.com', status: 'active', connected_at: '2026-11-08T15:00:00.000Z', calendar_enabled: true, calendar_id: 'work',
  business_profile_enabled: true, business_location_id: 'locations/1', has_business_scope: true, has_calendar_scope: true,
};

export async function mockConnections(page: Page, options: { meta?: 'none' | 'connected' | 'off'; stripe?: 'active' | 'none' } = {}) {
  const calls: Calls = [];
  const meta = options.meta ?? 'none';
  await page.route('**/functions/v1/**', async (route: Route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const name = new URL(route.request().url()).pathname.split('/').pop() ?? '';
    const body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
    calls.push({ name, body });
    const ok = (data: unknown) => route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify({ data, error: null }) });
    if (name === 'plan-management') return ok({ current_plan: { plan_key: 'ai_growth' }, plans: [], usage: {}, features: { google_calendar_sync: true, concierge_instagram: true } });
    if (name === 'stripe-connect-onboard' && body.action === 'status') return ok(options.stripe === 'none'
      ? { connected: null, payouts: null, next_payout: null, dashboard_url: null, test_mode: true }
      : { connected: { account_type: 'standard', status: 'active', charges_enabled: true, payouts_enabled: true, details_submitted: true, connected_at: '2026-10-02T15:00:00.000Z' },
        payouts: { bank_last4: '4821', bank_name: 'BANK', interval: 'daily', weekly_anchor: null, monthly_anchor: null, delay_days: 2 },
        next_payout: { amount_minor: 41280, currency: 'USD', arrival_date: '2026-11-25T15:00:00.000Z' }, dashboard_url: 'https://dashboard.stripe.com/test/dashboard', test_mode: true });
    if (name === 'payment-settings') return ok({ cash_enabled: true, other_enabled: true, deposits_enabled: true, pay_links_enabled: true, platform_fee_bps: 150, zelle_available: false, salon_locations: [] });
    if (name === 'calendar-google-connect' && body.action === 'status') return ok({ google, settings: { location_ids: ['l1', 'l2'], apple_feed_enabled: true }, locations: [{ id: 'l1', name: 'Studio 9 Suites' }, { id: 'l2', name: 'Luxe Salon · Midtown' }], feedConfigured: false, providerConfigured: true });
    if (name === 'calendar-google-connect' && body.action === 'calendars') return ok({ calendars: [{ id: 'work', summary: 'Work', primary: false }] });
    if (name === 'calendar-google-connect' && body.action === 'locations') return ok({ locations: [{ id: 'locations/1', title: 'Sample Hair · Studio 9 Suites' }] });
    if (name === 'calendar-google-connect' && body.action === 'rotate-feed') return ok({ feedUrl: 'https://mova-beauty.co/feed/sampletoken' });
    if (name === 'google-business-sync') return ok({ connected: true, business_profile_ready: true, provider_configured: true, auto_send: true, last_synced_at: new Date(Date.now() - 2 * 3600_000).toISOString(), last_sync_status: 'synced', sections: { profile: 'up_to_date', hours: 'up_to_date', booking_link: 'up_to_date', services_waiting: 0 }, changes: [] });
    if (name === 'review-management') return ok({ reviews: [], settings: { ask_after_visit: false, google_review_url: null, google_import_enabled: true, google_synced_at: new Date(Date.now() - 10 * 60_000).toISOString() },
      google_reviews: [{ id: 'g1', rating: 5, reply_body: 'Thank you!' }, { id: 'g2', rating: 4, reply_body: null }], summary: { google_count: 14, google_average: 4.9, awaiting_reply: 1 }, google_import_enabled: true });
    if (name === 'messaging-settings') return ok({ preferences: { in_app: true, email: true, push: false }, events: { new_google_review: { email: true, push: true } }, live: { sms: false, email: false, push: false } });
    if (name === 'meta-connect' && body.action === 'status') return ok({
      connection: meta === 'connected' ? { status: 'active', page_id: '10001', page_name: 'Sample Hair', instagram_user_id: '17840001', instagram_username: 'samplehair', connected_at: '2026-11-20T15:00:00.000Z', last_message_at: new Date(Date.now() - 12 * 60_000).toISOString() } : null,
      channels: { instagram: meta === 'connected', messenger: false }, provider_configured: meta !== 'off', plan_included: true });
    return ok({ saved: true });
  });
  return calls;
}

