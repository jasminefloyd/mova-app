import type { LoaderFunctionArgs } from 'react-router';

export async function loader({ request }: LoaderFunctionArgs) {
  const base = ((typeof process !== 'undefined' && process.env.PUBLIC_BASE_URL) || 'https://mova-beauty.co').replace(/\/$/, '');
  const serviceKey = typeof process !== 'undefined' ? process.env.SUPABASE_SERVICE_ROLE_KEY : undefined;
  const supabaseUrl = typeof process !== 'undefined' ? process.env.SUPABASE_URL : undefined;
  if (!serviceKey || !supabaseUrl) return new Response('Sitemap temporarily unavailable', { status: 503 });
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/mova_public_sitemap`, {
    method: 'POST', headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' }, body: '{}',
    signal: request.signal,
  });
  if (!response.ok) return new Response('Sitemap temporarily unavailable', { status: 503 });
  const rows = await response.json() as { handle: string; updated_at: string }[];
  const guidesResponse = await fetch(`${supabaseUrl}/rest/v1/mova_blog_posts?select=slug,published_at&status=eq.published&published_at=lte.${encodeURIComponent(new Date().toISOString())}&order=published_at.desc&limit=1000`, { headers, signal: request.signal });
  if (!guidesResponse.ok) return new Response('Sitemap temporarily unavailable', { status: 503 });
  const guides = await guidesResponse.json() as { slug: string; published_at: string }[];
  const esc = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!);
  const staticPaths = ['/', '/features', '/pricing', '/calculator', '/guides'];
  const staticUrls = staticPaths.map((path) => {
    const loc = `${base}${path}`;
    return `<url><loc>${esc(loc)}</loc><xhtml:link rel="alternate" hreflang="en-US" href="${esc(`${loc}?locale=en-US`)}"/><xhtml:link rel="alternate" hreflang="es-US" href="${esc(`${loc}?locale=es-US`)}"/></url>`;
  });
  const profileUrls = rows.map(({ handle, updated_at }) => {
    const loc = `${base}/a/${encodeURIComponent(handle)}`;
    return `<url><loc>${esc(loc)}</loc><lastmod>${new Date(updated_at).toISOString()}</lastmod><xhtml:link rel="alternate" hreflang="en-US" href="${esc(`${loc}?locale=en-US`)}"/><xhtml:link rel="alternate" hreflang="es-US" href="${esc(`${loc}?locale=es-US`)}"/></url>`;
  });
  const guideUrls = guides.map(({ slug, published_at }) => `<url><loc>${esc(`${base}/guides/${encodeURIComponent(slug)}`)}</loc><lastmod>${new Date(published_at).toISOString()}</lastmod></url>`);
  const urls = [...staticUrls, ...profileUrls, ...guideUrls].join('');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${urls}</urlset>`, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
  });
}
