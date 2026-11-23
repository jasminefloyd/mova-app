import type { ActionFunctionArgs } from 'react-router';

const EVENTS = new Set(['calculator_used', 'start_free_clicked', 'signup_completed']);

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') return new Response(null, { status: 405 });
  if (request.headers.get('origin') !== new URL(request.url).origin) return new Response(null, { status: 403 });

  const event = await request.text();
  if (!EVENTS.has(event)) return new Response(null, { status: 400 });

  const env = typeof process !== 'undefined' ? process.env : undefined;
  const url = env?.SUPABASE_URL;
  const key = env?.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return new Response(null, { status: 503 });

  try {
    const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/mova_record_calculator_event`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_event: event }),
      signal: AbortSignal.timeout(2500),
    });
    return new Response(null, { status: response.ok ? 204 : 503 });
  } catch {
    return new Response(null, { status: 503 });
  }
}

export function loader() {
  return new Response(null, { status: 405 });
}
