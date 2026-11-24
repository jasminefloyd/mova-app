import { beforeAll, describe, expect, it } from 'vitest';
import { i18nReady } from '../../i18n';
import { robotsTxt } from '../../routes/robots';
import { llmsTxt } from '../../routes/llms';
import { breadcrumbLd, faqLd, jsonLdString, pageMeta, siteGraph, softwareLd } from './seo';

const base = 'https://mova-beauty.co';
const shell = { publicBaseUrl: base };
const tag = (tags: Record<string, string>[], key: string, value: string) => tags.find((item) => item[key] === value);

describe('website SEO', () => {
  beforeAll(async () => { await i18nReady; });

  it('uses one English canonical URL and does not publish alternate-language metadata', () => {
    const tags = pageMeta('pricing', shell);
    expect(tag(tags, 'rel', 'canonical')?.href).toBe('https://mova-beauty.co/pricing');
    expect(tag(tags, 'rel', 'alternate')).toBeUndefined();
    expect(tag(tags, 'property', 'og:locale')?.content).toBe('en_US');
    expect(tag(tags, 'property', 'og:locale:alternate')).toBeUndefined();
    expect(siteGraph(shell)['@graph'][1]?.inLanguage).toBe('en-US');
  });

  it('every page has a title under 60 characters and a description under 160', () => {
    for (const page of ['home', 'features', 'pricing', 'calculator', 'guides'] as const) {
      const tags = pageMeta(page, shell);
      expect(tags[0]?.title?.length, `${page} title`).toBeLessThanOrEqual(60);
      const description = tag(tags, 'name', 'description')?.content ?? '';
      expect(description.length, `${page} description`).toBeGreaterThan(50);
      expect(description.length, `${page} description`).toBeLessThanOrEqual(160);
      expect(tag(tags, 'property', 'og:image')?.content).toBe('https://mova-beauty.co/media/og-mova.png');
    }
  });

  it('describes the product with real prices and no ratings or reviews', () => {
    const software = softwareLd(shell, { withOffers: true });
    expect(software.offers).toHaveLength(3);
    expect((software.offers as { price: string }[]).map((offer) => offer.price)).toEqual(['0', '19', '39']);
    expect(JSON.stringify(software)).not.toMatch(/aggregateRating|"review"/);
    expect(softwareLd(shell).offers).toMatchObject({ '@type': 'AggregateOffer', lowPrice: '0', highPrice: '39' });
    expect(siteGraph(shell)['@graph'].map((node) => node['@type'])).toEqual(['Organization', 'WebSite']);
  });

  it('leaves unfinished placeholder answers out of the FAQ data and strips markup', () => {
    const faq = faqLd();
    expect(faq.mainEntity.length).toBeGreaterThan(0);
    for (const item of faq.mainEntity) {
      expect(item.acceptedAnswer.text).not.toMatch(/^\[|<|>/);
    }
  });

  it('builds breadcrumbs from the home page and escapes "<" in JSON-LD', () => {
    const crumbs = breadcrumbLd(shell, [['Pricing', '/pricing']]);
    expect(crumbs.itemListElement.map((item) => item.name)).toEqual(['Home', 'Pricing']);
    expect(crumbs.itemListElement[1]?.item).toBe('https://mova-beauty.co/pricing');
    expect(jsonLdString({ text: '</script>' })).not.toContain('</script>');
  });

  it('robots.txt opens public pages, closes private ones and names the sitemap', () => {
    const robots = robotsTxt(base);
    expect(robots).toContain('User-agent: *\nAllow: /');
    for (const path of ['/admin', '/api/', '/BID-', '/login', '/b/', '/me']) expect(robots).toContain(`Disallow: ${path}\n`);
    expect(robots).not.toMatch(/Disallow: \/(a\/|guides|pricing|features|calculator)?\n/);
    for (const agent of ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended']) expect(robots).toContain(`User-agent: ${agent}\n`);
    expect(robots).toContain('Sitemap: https://mova-beauty.co/sitemap.xml');
  });

  it('llms.txt summarises the product from the site copy and never includes placeholders', () => {
    const text = llmsTxt(base, [{ slug: 'a-guide', title: 'A guide', summary: 'What it covers.' }]);
    expect(text.startsWith('# Mova\n\n> ')).toBe(true);
    expect(text).toContain('Pro plan: $19 a month');
    expect(text).toContain('[Pricing](https://mova-beauty.co/pricing)');
    expect(text).toContain('[A guide](https://mova-beauty.co/guides/a-guide): What it covers.');
    expect(text).not.toMatch(/TO BE (CONFIRMED|FINALIZED)/);
    expect(llmsTxt(base, [])).not.toContain('## Guides');
    expect(text).not.toContain('?locale=');
    expect(text).not.toContain('website.features.');
  });
});
