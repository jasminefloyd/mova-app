import type { Page, Route } from '@playwright/test';

const businessId = 'e2500000-0000-4000-8000-000000000001';
const userId = 'e2500000-0000-4000-8000-000000000777';

function projectEnv(name: string): string {
  return process.env[name] ?? '';
}

async function fulfillJson(route: Route, value: unknown, headers: Record<string, string> = {}) {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-mova-artist-business-id', 'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS', 'Content-Range': '0-0/0', ...headers },
    body: JSON.stringify(value),
  });
}

export async function openOperatorPage(page: Page, pathname: string, businessDisplayId = 'BID-1') {
  const supabaseUrl = projectEnv('VITE_SUPABASE_URL');
  const anonKey = projectEnv('VITE_SUPABASE_ANON_KEY');
  if (!supabaseUrl || !anonKey) throw new Error('Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in the process environment before running operator Playwright checks.');
  const projectRef = new URL(supabaseUrl).hostname.split('.')[0];
  const storageKey = `sb-${projectRef}-auth-token`;
  const user = { id: userId, aud: 'authenticated', role: 'authenticated', email: 'playwright@mova.invalid', app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, created_at: '2026-01-01T00:00:00.000Z' };
  await page.addInitScript(({ key, testUser }) => {
    localStorage.setItem(key, JSON.stringify({ access_token: 'playwright-session-token', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'playwright-refresh-token', user: testUser }));
  }, { key: storageKey, testUser: user });

  await page.route('**/auth/v1/**', async (route) => {
    if (route.request().method() === 'OPTIONS') return fulfillJson(route, null);
    return fulfillJson(route, new URL(route.request().url()).pathname.endsWith('/user') ? user : { user, session: null });
  });
  await page.route('**/rest/v1/**', async (route) => {
    if (route.request().method() === 'OPTIONS') return fulfillJson(route, null);
    const url = new URL(route.request().url());
    const table = url.pathname.split('/').pop();
    const accept = route.request().headers()['accept'] ?? '';
    if (table === 'mova_artist_businesses') return fulfillJson(route, accept.includes('vnd.pgrst.object') ? { id: businessId, business_number: 1 } : [{ id: businessId, business_number: 1 }]);
    if (table === 'mova_artist_memberships') return fulfillJson(route, accept.includes('vnd.pgrst.object') ? { artist_business_id: businessId } : [{ artist_business_id: businessId }]);
    if (table === 'mova_appointments') {
      const now = Date.now();
      const current = { id: 'e2500000-0000-4000-8000-000000000061', appointment_number: 1, client_id: null, status: 'confirmed', starts_at: new Date(now + 30 * 60_000).toISOString(), ends_at: new Date(now + 90 * 60_000).toISOString(), service_id: 'e2500000-0000-4000-8000-000000000062', service_name_snapshot: 'Hydration treatment', client_name: 'Jordan Lee', client_locale: 'en-US', deposit_due_minor: 0, service_price_minor: 9500, balance_due_minor: 9500, location_id: 'e2500000-0000-4000-8000-000000000050', booking_mode: 'instant', payment_collector: 'stylist', reschedule_requested_starts_at: null, reschedule_requested_ends_at: null };
      const next = { client_name: 'Taylor Morgan', service_name_snapshot: 'Protective style', starts_at: new Date(now + 150 * 60_000).toISOString(), location_id: 'e2500000-0000-4000-8000-000000000050' };
      const selection = url.searchParams.get('select');
      const request = { id: 'e2500000-0000-4000-8000-000000000065', appointment_number: 16, location_id: 'e2500000-0000-4000-8000-000000000050', service_name_snapshot: 'Silk Press', client_name: 'Jordan Lee', status: 'pending_artist', starts_at: new Date(now + 4 * 60 * 60_000).toISOString(), ends_at: new Date(now + 5 * 60 * 60_000).toISOString(), request_expires_at: new Date(now + 24 * 60 * 60_000).toISOString() };
      const result = selection === '*' ? current : selection === 'client_name,service_name_snapshot,starts_at,location_id' ? next : selection?.includes('request_expires_at') ? [request] : [];
      return fulfillJson(route, result, { 'Content-Range': '0-0/1' });
    }
    if (table === 'mova_locations') {
      const location = { id: 'e2500000-0000-4000-8000-000000000050', name: 'Luxe Salon', time_zone: 'America/New_York', booking_mode: 'instant', payment_collector: 'stylist' };
      return fulfillJson(route, accept.includes('vnd.pgrst.object') ? location : [location], { 'Content-Range': '0-0/1' });
    }
    if (table === 'mova_quote_requests' || table === 'mova_slot_events') return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ code: 'DIRECT_TABLE_READ_FORBIDDEN' }) });
    if (route.request().method() === 'HEAD') return route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Range': '0-0/0' } });
    return fulfillJson(route, accept.includes('vnd.pgrst.object') ? null : []);
  });
  await page.route('**/functions/v1/**', async (route) => {
    if (route.request().method() === 'OPTIONS') return fulfillJson(route, null);
    const name = new URL(route.request().url()).pathname.split('/').pop();
    const body = route.request().postDataJSON() as Record<string, unknown> | null;
    const quote = { id: 'e2500000-0000-4000-8000-000000000030', conversation_id: 'e2500000-0000-4000-8000-000000000031', appointment_id: 'e2500000-0000-4000-8000-000000000061', appointment_number: 1, service_category: 'Protective style', details: { hair_now: 'Natural curls', goal: 'Low-tension protective style', budget: 'Please discuss', availability: 'Weekends' }, media_count: 0, risk_flags: [], quoted_minor: null, status: 'open', created_at: '2026-11-07T12:00:00.000Z', client_name: 'Alex Rivera', channel: 'web_chat', locale: 'en-US' };
    const data = name === 'concierge-artist' && body?.action === 'home-needs'
      ? { quotes: [{ id: 'e2500000-0000-4000-8000-000000000030', conversation_id: 'e2500000-0000-4000-8000-000000000031', service_category: 'Protective style', created_at: '2026-11-07T12:00:00.000Z' }] }
      : name === 'slot-campaign' && body?.action === 'home-needs'
        ? { slots: [{ id: 'e2500000-0000-4000-8000-000000000040', location_id: 'e2500000-0000-4000-8000-000000000050', starts_at: '2026-11-08T15:00:00.000Z' }] }
      : name === 'concierge-artist' && body?.action === 'status'
      ? { settings: { enabled: false, globally_paused: true }, conversations: [{ id: quote.conversation_id, channel: 'web_chat', client_id: userId, locale: 'en-US', status: 'needs_you', ai_enabled: false, pause_until: null, last_message_at: quote.created_at, mova_clients: { display_name: quote.client_name } }], handoffs: [], knowledge: [], aiEnabled: false }
      : name === 'concierge-artist' && body?.action === 'conversation'
        ? { messages: [], handoffs: [], quotes: [{ id: quote.id, appointment_id: quote.appointment_id, appointment_number: quote.appointment_number, service_category: quote.service_category, details: quote.details, status: quote.status, quoted_minor: quote.quoted_minor }] }
        : name === 'concierge-artist' && body?.action === 'quote-detail'
          ? { quote }
          : name === 'concierge-artist' && body?.action === 'save-quote-estimate'
            ? { saved: true, message_sent: false }
      : name === 'revenue-center'
      ? { pipeline: [], winback: [], decisions: [], settings: { enabled: false, slot_texts_autopilot: false, rules: {} }, counts: { due: 0, contacted: 0, rebooked: 0, winback: 0 }, outboundEnabled: false }
      : name === 'forecast-summary'
        ? { forecast: null }
      : name === 'reports-summary'
      ? { current: {}, previous: {}, series: [] }
      : name === 'money-summary'
        ? { totals: { service_value_minor: 0, mova_processed_minor: 0, recorded_by_artist_minor: 0, collected_by_salon_minor: 0, mova_platform_fee_minor: 0, processor_fee_minor: 0, refunds_minor: 0, estimated_to_artist_minor: 0 }, activity: [] }
      : name === 'plan-management'
        ? { current_plan: { plan_key: 'free' }, plans: [], usage: {} }
        : name === 'messaging-settings'
          ? { preferences: { in_app: true, email: true, push: false }, identities: [], templates: [], live: { sms: false, email: false, push: false } }
          : {};
    return fulfillJson(route, { data, error: null, request_id: 'playwright-fixture' });
  });
  await page.goto(`/${businessDisplayId}${pathname}`);
}
