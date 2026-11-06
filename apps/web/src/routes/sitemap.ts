import type { LoaderFunctionArgs } from 'react-router-dom';

export async function loader({ request }: LoaderFunctionArgs) {
  const base = ((typeof process !== 'undefined' && process.env.PUBLIC_BASE_URL) || 'https://mova-beauty.co').replace(/\/$/, '');
  const serviceKey = typeof process !== 'undefined' ? process.env.SUPABASE_SERVICE_ROLE_KEY : undefined;
  const supabaseUrl = typeof process !== 'undefined' ? process.env.SUPABASE_URL : undefined;
  if (!serviceKey || !supabaseUrl) return new Response('Sitemap temporarily unavailable', { status: 503 });
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/mova_public_sitemap`, {
    method: 'POST', headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' }, body: '{}',
    signal: request.signal,
  });
  if (!response.ok) return new Response('Sitemap temporarily unavailable', { status: 503 });
  const rows = await response.json() as { handle: string; updated_at: string }[];
  const urls = rows.map(({ handle, updated_at }) => `<url><loc>${base}/a/${encodeURIComponent(handle)}</loc><lastmod>${new Date(updated_at).toISOString()}</lastmod><xhtml:link rel="alternate" hreflang="en-US" href="${base}/a/${encodeURIComponent(handle)}?locale=en-US"/><xhtml:link rel="alternate" hreflang="es-US" href="${base}/a/${encodeURIComponent(handle)}?locale=es-US"/></url>`).join('');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${urls}</urlset>`, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
  });
}
