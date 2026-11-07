import fs from 'node:fs';
import path from 'node:path';
import type { Page, Route } from '@playwright/test';

const businessId = 'e2500000-0000-4000-8000-000000000001';
const userId = 'e2500000-0000-4000-8000-000000000777';

function projectEnv(name: string): string {
  const fromProcess = process.env[name];
  if (fromProcess) return fromProcess;
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return '';
  const line = fs.readFileSync(envPath, 'utf8').split(/\r?\n/).find((value) => value.startsWith(`${name}=`));
  return line?.slice(name.length + 1).trim().replace(/^(["'])(.*)\1$/, '$2') ?? '';
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
  if (!supabaseUrl || !anonKey) throw new Error('Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in the project .env before running operator Playwright checks.');
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
    if (route.request().method() === 'HEAD') return route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Range': '0-0/0' } });
    return fulfillJson(route, accept.includes('vnd.pgrst.object') ? null : []);
  });
  await page.route('**/functions/v1/**', async (route) => {
    if (route.request().method() === 'OPTIONS') return fulfillJson(route, null);
    const name = new URL(route.request().url()).pathname.split('/').pop();
    const data = name === 'revenue-center'
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
