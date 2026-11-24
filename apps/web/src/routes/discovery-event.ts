import type { ActionFunctionArgs } from 'react-router';
import { discoveryEvent, PRICEPILOT_CAMPAIGN, PRICEPILOT_CONTENT } from '../features/website/discovery-contract';

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
  const campaign = d.campaign === PRICEPILOT_CAMPAIGN ? d.campaign : '';
  const content = campaign && d.content === PRICEPILOT_CONTENT ? d.content : '';
  const referrer = d.referrer ?? '';
  const { device, browser } = clientDimensions(request.headers.get('user-agent') ?? '');
  const geography = visitorGeography(request.headers);
  try {
    const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/mova_record_website_traffic_event`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_visit: d.visit, p_event: d.event, p_path: d.path, p_landing: d.landing,
        p_channel: d.channel,
        p_source: referrer || (campaign ? 'google' : ['google', 'bing'].includes(d.source) && d.channel === 'paid search' ? d.source : ''),
        p_campaign: campaign, p_content: content, p_signup_click: d.signupClick,
        p_audience: { visitor: d.visitor ?? null, referrer, device, browser, ...geography },
      }),
      signal: AbortSignal.timeout(2500),
    });
    return new Response(null, { status: response.ok ? 204 : 503 });
  } catch {
    return new Response(null, { status: 503 });
  }
}

function visitorGeography(headers: Headers) {
  const country = headers.get('x-vercel-ip-country') ?? '';
  if (!/^[A-Z]{2}$/.test(country)) return { country: '', region: '', city: '' };
  const region = headers.get('x-vercel-ip-country-region') ?? '';
  return {
    country,
    region: /^[A-Z0-9]{1,3}$/.test(region) ? region : '',
    city: decodeCity(headers.get('x-vercel-ip-city') ?? ''),
  };
}

function decodeCity(raw: string): string {
  if (raw.length > 1440) return '';
  try {
    const city = decodeURIComponent(raw).normalize('NFC').trim();
    return city.length <= 120 && /^[\p{L}\p{M}\p{N}\p{Pd} .,'’&()/]+$/u.test(city) ? city : '';
  } catch { return ''; }
}

function parseJson(raw: string): unknown {
  try { return JSON.parse(raw); } catch { return null; }
}

export function loader() {
  return new Response(null, { status: 405 });
}

function clientDimensions(agent: string) {
  if (!agent) return { device: 'Unknown', browser: 'Unknown' };
  const device = /iPad|Tablet|Android(?!.*Mobile)/i.test(agent)
    || (/Macintosh/.test(agent) && /Mobile\//.test(agent)) ? 'Tablet'
    : /Mobi|iPhone|Android/i.test(agent) ? 'Mobile'
      : /Windows|Macintosh|X11|Linux|CrOS/i.test(agent) ? 'Desktop' : 'Unknown';
  const browser = [
    [/SamsungBrowser\//, 'Samsung Internet'],
    [/Edg(?:A|iOS)?\/|Edge\//, 'Edge'],
    [/OPR\/|Opera/, 'Opera'],
    [/Firefox\/|FxiOS\//, 'Firefox'],
    [/Chrome\/|CriOS\/|Chromium\//, 'Chrome'],
    [/Safari\//, 'Safari'],
  ].find(([pattern]) => pattern instanceof RegExp && pattern.test(agent))?.[1] ?? 'Other';
  return { device, browser };
}
