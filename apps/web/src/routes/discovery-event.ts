import type { ActionFunctionArgs } from 'react-router';
import { discoveryEvent } from '../features/website/discovery-contract';

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') return new Response(null, { status: 405 });
  if (request.headers.get('origin') !== new URL(request.url).origin) return new Response(null, { status: 403 });
  const raw = await request.text();
  if (raw.length > 2048) return new Response(null, { status: 413 });
  const event = discoveryEvent.safeParse(parseJson(raw));
  if (!event.success) return new Response(null, { status: 400 });

  const { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key } = process.env;
  if (!url || !key) return new Response(null, { status: 503 });
  const d = event.data;
  try {
    const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/mova_record_discovery_event`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_visit: d.visit, p_event: d.event, p_path: d.path, p_landing: d.landing,
        p_channel: d.channel, p_source: d.source, p_medium: d.medium, p_campaign: d.campaign, p_content: d.content ?? '', p_signup_click: d.signupClick,
      }),
      signal: AbortSignal.timeout(2500),
    });
    return new Response(null, { status: response.ok ? 204 : 503 });
  } catch {
    return new Response(null, { status: 503 });
  }
}

function parseJson(raw: string): unknown {
  try { return JSON.parse(raw); } catch { return null; }
}

export function loader() {
  return new Response(null, { status: 405 });
}
