import i18n from '../../i18n';

// SEO helpers for the English-language marketing site.

export type ShellData = { publicBaseUrl: string };
export type SeoPage = 'home' | 'features' | 'pricing' | 'calculator' | 'guides';
type MetaTag = Record<string, string>;

export const DEFAULT_BASE_URL = 'https://mova-beauty.co';
export const OG_IMAGE_PATH = '/media/og-mova.png';
export const LOGO_PATH = '/icons/mova-512.svg';
export const PLAN_PRICES = [
  { key: 'free', price: '0', fee: 'feeFree' },
  { key: 'pro', price: '19', fee: 'feePro' },
  { key: 'growth', price: '39', fee: 'feeGrowth' },
] as const;

export function publicBaseUrl(): string {
  const env = typeof process !== 'undefined' ? process.env : undefined;
  return (env?.PUBLIC_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
}

/** Reads the website shell loader data from a meta function's `matches`. */
export function shellFromMatches(matches: readonly ({ id: string; data?: unknown } | undefined)[]): ShellData {
  const data = matches.find((match) => match?.id === 'website-shell')?.data as Partial<ShellData> | undefined;
  return { publicBaseUrl: data?.publicBaseUrl ?? DEFAULT_BASE_URL };
}

const translate = () => i18n.getFixedT('en-US', 'common');

export function socialMeta(options: { title: string; description: string; canonical: string; base: string; type?: 'website' | 'article'; image?: string | null; imageAlt?: string }): MetaTag[] {
  const { title, description, canonical, base } = options;
  const image = options.image ?? `${base}${OG_IMAGE_PATH}`;
  return [
    { title },
    { name: 'description', content: description },
    { tagName: 'link', rel: 'canonical', href: canonical },
    { property: 'og:site_name', content: 'Mova' },
    { property: 'og:type', content: options.type ?? 'website' },
    { property: 'og:title', content: title },
    { property: 'og:description', content: description },
    { property: 'og:url', content: canonical },
    { property: 'og:locale', content: 'en_US' },
    { property: 'og:image', content: image },
    ...(options.imageAlt ? [{ property: 'og:image:alt', content: options.imageAlt }] : []),
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:title', content: title },
    { name: 'twitter:description', content: description },
    { name: 'twitter:image', content: image },
  ];
}

const PAGE_PATHS: Record<SeoPage, string> = { home: '/', features: '/features', pricing: '/pricing', calculator: '/calculator', guides: '/guides' };

/** Meta tags for one of the fixed website pages. */
export function pageMeta(page: SeoPage, shell: ShellData): MetaTag[] {
  const t = translate();
  const path = PAGE_PATHS[page];
  return socialMeta({
    title: t(`website.seo.${page}.title`),
    description: t(`website.seo.${page}.description`),
    canonical: `${shell.publicBaseUrl}${path}`,
    base: shell.publicBaseUrl,
    imageAlt: t('website.seo.imageAlt'),
  });
}

/** Serializes JSON-LD. "<" is escaped so content can never close the script tag. */
export function jsonLdString(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

const organizationId = (base: string) => `${base}/#organization`;
const websiteId = (base: string) => `${base}/#website`;
const softwareId = (base: string) => `${base}/#software`;

/** Organization + WebSite, emitted on every website page so each page's entities can point at them. */
export function siteGraph({ publicBaseUrl: base }: ShellData) {
  const t = translate();
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': organizationId(base),
        name: 'Mova',
        url: `${base}/`,
        logo: { '@type': 'ImageObject', url: `${base}${LOGO_PATH}` },
        image: `${base}${OG_IMAGE_PATH}`,
        slogan: t('website.seo.slogan'),
        description: t('website.seo.organizationDescription'),
        knowsLanguage: ['en', 'es'],
        areaServed: { '@type': 'Country', name: 'United States' },
        contactPoint: { '@type': 'ContactPoint', contactType: 'customer support', email: 'hello@mova-beauty.co', availableLanguage: ['English', 'Spanish'] },
      },
      {
        '@type': 'WebSite',
        '@id': websiteId(base),
        name: 'Mova',
        url: `${base}/`,
        description: t('website.seo.home.description'),
        inLanguage: 'en-US',
        publisher: { '@id': organizationId(base) },
      },
    ],
  };
}

function planOffers(base: string) {
  const t = translate();
  return PLAN_PRICES.map(({ key, price, fee }) => ({
    '@type': 'Offer',
    name: t(`website.pricing.${key}`),
    price,
    priceCurrency: 'USD',
    description: `${t(`website.pricing.${fee}`)}. ${t('website.pricing.processing')}`,
    url: `${base}/pricing`,
    availability: 'https://schema.org/InStock',
    priceSpecification: { '@type': 'UnitPriceSpecification', price, priceCurrency: 'USD', billingDuration: 'P1M', unitText: 'MONTH' },
  }));
}

/** The product itself. There are no ratings or reviews here on purpose: we only publish what is real. */
export function softwareLd({ publicBaseUrl: base }: ShellData, options: { withOffers?: boolean } = {}) {
  const t = translate();
  const features = ['showcase', 'booking', 'clients', 'money', 'clientCard', 'reports'] as const;
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    '@id': softwareId(base),
    name: 'Mova',
    url: `${base}/`,
    applicationCategory: 'BusinessApplication',
    applicationSubCategory: t('website.seo.category'),
    operatingSystem: 'Web',
    description: t('website.seo.softwareDescription'),
    inLanguage: ['en-US', 'es-US'],
    image: `${base}${OG_IMAGE_PATH}`,
    screenshot: ['home', 'showcase', 'clients', 'revenue', 'concierge'].map((name) => `${base}/media/landing/${name}.png`),
    featureList: [
      ...features.map((key) => `${t(`website.features.${key}Eyebrow`)}: ${t(`website.features.${key}TitleA`)} ${t(`website.features.${key}TitleB`)}`),
      t('website.features.tools.revenue.title'),
    ],
    audience: { '@type': 'BusinessAudience', audienceType: t('website.seo.audience') },
    publisher: { '@id': organizationId(base) },
    offers: options.withOffers
      ? planOffers(base)
      : { '@type': 'AggregateOffer', lowPrice: '0', highPrice: '39', priceCurrency: 'USD', offerCount: PLAN_PRICES.length, url: `${base}/pricing` },
  };
}

/** Pricing questions and answers. Unfinished placeholder answers (in square brackets) are left out. */
export function faqLd() {
  const t = translate();
  const strip = (value: string) => value.replace(/<[^>]+>/g, '').trim();
  const entries = [1, 2, 3, 4]
    .map((index) => ({ question: strip(t(`website.pricing.faq${index}Q`)), answer: strip(t(`website.pricing.faq${index}A`)) }))
    .filter(({ answer }) => answer.length > 0 && !answer.startsWith('['));
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    inLanguage: 'en-US',
    mainEntity: entries.map(({ question, answer }) => ({ '@type': 'Question', name: question, acceptedAnswer: { '@type': 'Answer', text: answer } })),
  };
}

/** The booth rent vs. commission calculator, a free tool. */
export function calculatorLd({ publicBaseUrl: base }: ShellData) {
  const t = translate();
  return {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: t('website.seo.calculator.name'),
    url: `${base}/calculator`,
    applicationCategory: 'FinanceApplication',
    operatingSystem: 'Web',
    browserRequirements: 'Requires JavaScript',
    description: t('website.seo.calculator.description'),
    inLanguage: 'en-US',
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    publisher: { '@id': organizationId(base) },
  };
}

/** Breadcrumb trail. Items are [name, path]; the home crumb is added for you. */
export function breadcrumbLd({ publicBaseUrl: base }: ShellData, items: readonly (readonly [string, string])[]) {
  const t = translate();
  const trail = [[t('website.seo.homeCrumb'), '/'] as const, ...items];
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map(([name, path], index) => ({ '@type': 'ListItem', position: index + 1, name, item: `${base}${path}` })),
  };
}

/** The guides index as a collection of articles. */
export function guidesListLd(shell: ShellData, posts: readonly { slug: string; title: string }[]) {
  const t = translate();
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: t('website.seo.guides.title'),
    description: t('website.seo.guides.description'),
    url: `${shell.publicBaseUrl}/guides`,
    isPartOf: { '@id': websiteId(shell.publicBaseUrl) },
    mainEntity: {
      '@type': 'ItemList',
      itemListElement: posts.map((post, index) => ({ '@type': 'ListItem', position: index + 1, name: post.title, url: `${shell.publicBaseUrl}/guides/${encodeURIComponent(post.slug)}` })),
    },
  };
}

/** A guide article. `image` and `canonical` must be absolute URLs. */
export function articleLd(base: string, post: { title: string; summary: string; published_at: string; updated_at: string; author_name: string; category: string | null; tags: string[]; reading_minutes: number; seo: { meta_description: string } }, canonical: string, image: string | null) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    description: post.seo.meta_description || post.summary,
    datePublished: post.published_at,
    dateModified: post.updated_at,
    author: { '@type': 'Person', name: post.author_name },
    publisher: { '@type': 'Organization', '@id': organizationId(base), name: 'Mova', logo: { '@type': 'ImageObject', url: `${base}${LOGO_PATH}` } },
    mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
    url: canonical,
    isPartOf: { '@id': websiteId(base) },
    image: image ?? `${base}${OG_IMAGE_PATH}`,
    timeRequired: `PT${Math.max(1, Math.round(post.reading_minutes))}M`,
    ...(post.category ? { articleSection: post.category } : {}),
    ...(post.tags.length ? { keywords: post.tags.join(', ') } : {}),
  };
}
