import type { LoaderFunctionArgs } from 'react-router';
import i18n from '../i18n';
import { PLAN_PRICES, publicBaseUrl } from '../features/website/seo';
import { fetchGuidesList } from '../features/website/guides/guides-api';
import type { PostSummary } from '../features/website/guides/guide-types';

// /llms.txt: a short, plain Markdown description of Mova for AI assistants (https://llmstxt.org).
// It is built from the same English copy as the website, so it cannot drift from what the pages say.
// Placeholder copy (text in square brackets) is never included.

const clean = (value: string) => value.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

export function llmsTxt(base: string, guides: readonly Pick<PostSummary, 'slug' | 'title' | 'summary'>[]): string {
  const t = i18n.getFixedT('en-US', 'common');
  const text = (key: string) => clean(t(key));
  const features = ['showcase', 'booking', 'clients', 'money', 'revenue', 'concierge', 'clientCard', 'reports'] as const;
  const faqs = [1, 2, 3, 4].map((index) => [text(`website.pricing.faq${index}Q`), text(`website.pricing.faq${index}A`)] as const).filter(([, answer]) => !answer.startsWith('['));
  const lines = [
    '# Mova',
    '',
    `> ${text('website.seo.softwareDescription')}`,
    '',
    `Mova is for ${text('website.seo.audience').toLowerCase()} in the United States. The app and the client booking pages work in English and Spanish. ${text('website.landing.fine')}`,
    '',
    '## Key facts',
    '',
    `- Tagline: ${text('website.seo.slogan')}`,
    `- What it is: ${text('website.landing.intro')}`,
    ...PLAN_PRICES.map(({ key, price, fee }) => `- ${text(`website.pricing.${key}`)} plan: $${price} a month, ${text(`website.pricing.${fee}`).replace(/^\+\s*/, 'plus ')}.`),
    `- ${text('website.pricing.processing')}`,
    ...[1, 2, 3, 4, 5, 6].map((index) => `- ${text(`website.landing.rule${index}`)}`),
    '',
    '## Who it is for',
    '',
    ...[1, 2, 3, 4].map((index) => `- ${text(`website.landing.who${index}Title`)}: ${text(`website.landing.who${index}Body`)}`),
    '',
    '## Features',
    '',
    ...features.map((key) => `- ${text(`website.features.${key}Eyebrow`)}: ${text(`website.features.${key}Body`)}`),
    '',
    '## Pages',
    '',
    `- [Home](${base}/): ${text('website.seo.home.description')}`,
    `- [Features](${base}/features): ${text('website.seo.features.description')}`,
    `- [Pricing](${base}/pricing): ${text('website.seo.pricing.description')}`,
    `- [Booth rent vs. commission calculator](${base}/calculator): ${text('website.seo.calculator.description')}`,
    `- [Guides](${base}/guides): ${text('website.seo.guides.description')}`,
    `- [Create a free account](${base}/signup)`,
    '',
    ...(faqs.length ? ['## Common questions', '', ...faqs.flatMap(([question, answer]) => [`### ${question}`, '', answer, '']), ] : []),
    ...(guides.length ? ['## Guides', '', ...guides.map((guide) => `- [${clean(guide.title)}](${base}/guides/${encodeURIComponent(guide.slug)}): ${clean(guide.summary)}`), ''] : []),
    '## Optional',
    '',
    `- [Sitemap](${base}/sitemap.xml)`,
    `- [Spanish home page](${base}/?locale=es-US)`,
    '',
  ];
  return lines.join('\n');
}

export async function loader({ request }: LoaderFunctionArgs) {
  // The guide list is a bonus: if it cannot be loaded the file is still served without it.
  const guides = await fetchGuidesList({ limit: 30 }, request.signal).then((result) => result.posts, () => [] as PostSummary[]);
  return new Response(llmsTxt(publicBaseUrl(), guides), {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': 'public, max-age=3600', 'X-Robots-Tag': 'noindex' },
  });
}
