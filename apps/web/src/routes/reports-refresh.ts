import type { LoaderFunctionArgs } from 'react-router';
import { cronAuthorized } from './cron-auth';

// Vercel Cron calls with GET, so the route needs a loader (it only had an action before, so the nightly
// refresh never ran). POST still works for manual runs.
export async function loader({ request }: LoaderFunctionArgs) {
  const env = typeof process !== 'undefined' ? process.env : undefined;
  const expected = env?.CRON_SECRET;
  if (!cronAuthorized(request, expected)) return new Response('Unauthorized', { status: 401 });
  const url = env?.SUPABASE_URL;
  const serviceKey = env?.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return Response.json({ error: 'Server configuration missing' }, { status: 503 });
  const response = await fetch(`${url}/functions/v1/reports-refresh`, { method: 'POST', headers: { Authorization: `Bearer ${expected}`, apikey: serviceKey, 'Content-Type': 'application/json' }, body: '{}' });
  const result = await response.json().catch(() => null);
  return Response.json(result ?? { error: 'Reports refresh failed' }, { status: response.ok ? 200 : 503 });
}

export const action = loader;
