import { publicBaseUrl } from '../features/website/seo';

// Private areas: sign-in, the stylist app (/BID-…), admin, per-client links and server endpoints.
const PRIVATE_PATHS = ['/admin', '/api/', '/auth', '/login', '/signup', '/reset-password', '/signin', '/me', '/onboarding/', '/BID-', '/b/', '/c/', '/s/', '/slot/', '/review/', '/pay/', '/feed/', '/growth', '/money', '/reports'];
// AI search and assistant crawlers are welcome on the public pages (same rules as everyone else).
// They are named so the choice is explicit and easy to change.
const AI_CRAWLERS = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'Claude-User', 'PerplexityBot', 'Perplexity-User', 'Google-Extended', 'Applebot-Extended', 'Amazonbot', 'CCBot', 'meta-externalagent', 'Bytespider', 'DuckAssistBot', 'MistralAI-User'];

export function robotsTxt(base: string): string {
  const rules = ['Allow: /', ...PRIVATE_PATHS.map((path) => `Disallow: ${path}`)];
  return [
    '# Mova: public pages are open to search engines and AI assistants.',
    `# A plain-text summary for AI assistants is at ${base}/llms.txt`,
    '',
    'User-agent: *',
    ...rules,
    '',
    ...AI_CRAWLERS.map((agent) => `User-agent: ${agent}`),
    ...rules,
    '',
    `Sitemap: ${base}/sitemap.xml`,
    '',
  ].join('\n');
}

export async function loader() {
  return new Response(robotsTxt(publicBaseUrl()), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  });
}
