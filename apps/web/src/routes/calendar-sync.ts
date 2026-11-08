import type { LoaderFunctionArgs } from 'react-router';
import { cronAuthorized } from './cron-auth';

export async function loader({ request }: LoaderFunctionArgs) {
  const env = typeof process !== 'undefined' ? process.env : undefined;
  const expected = env?.CRON_SECRET;
  if (!cronAuthorized(request, expected)) return new Response('Unauthorized', { status: 401 });
  const url = env?.SUPABASE_URL;
  const serviceKey = env?.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return Response.json({ error: 'Server configuration missing' }, { status: 503 });
  const response = await fetch(`${url}/functions/v1/calendar-sync-run`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${expected}`, apikey: serviceKey, 'Content-Type': 'application/json' },
    body: '{}',
  });
  const result = await response.json().catch(() => null);
  return Response.json(result ?? { error: 'Calendar sync failed' }, { status: response.ok ? 200 : 503 });
}
