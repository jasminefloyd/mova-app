export async function loader() {
  const base = (typeof process !== 'undefined' && process.env.PUBLIC_BASE_URL) || 'https://mova-beauty.co';
  return new Response(`User-agent: *\nAllow: /a/\nDisallow: /auth\nDisallow: /onboarding/\nDisallow: /b/\nSitemap: ${base.replace(/\/$/, '')}/sitemap.xml\n`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  });
}
