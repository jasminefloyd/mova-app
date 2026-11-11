import { useTranslation } from 'react-i18next';
import { isRouteErrorResponse, Link, useLoaderData, useRouteError } from 'react-router';
import type { LoaderFunctionArgs, MetaFunction } from 'react-router';
import { ButtonLink, JsonLd, useSiteShell } from '../parts';
import { articleLd, breadcrumbLd, shellFromMatches, socialMeta } from '../seo';
import { absoluteUrl, formatGuideDate } from './guide-format';
import { fetchGuide, GuidesRequestError } from './guides-api';
import { GuideBlocks } from './GuideBlocks';

// W5 Guide article. SEO comes from the server's seo fields (with fallbacks already applied there).
export async function loader({ params }: LoaderFunctionArgs) {
  const env = typeof process !== 'undefined' ? process.env : undefined;
  const publicBaseUrl = ((env?.PUBLIC_BASE_URL) || 'https://mova-beauty.co').replace(/\/$/, '');
  const slug = params.slug ?? '';
  try {
    const data = await fetchGuide(slug);
    return { post: data.post, related: data.related, publicBaseUrl };
  } catch (error) {
    if (error instanceof GuidesRequestError && error.status === 404) throw new Response('Not found', { status: 404 });
    throw new Response('Guides are unavailable', { status: 503 });
  }
}

export const meta: MetaFunction<typeof loader> = ({ data, matches }) => {
  if (!data?.post) return [{ title: 'mova' }];
  const { post, publicBaseUrl } = data;
  // The server already applies these fallbacks; repeating them keeps the tags right if a field arrives empty.
  const seo = { ...post.seo, meta_title: post.seo.meta_title || post.title, meta_description: post.seo.meta_description || post.summary };
  const canonical = seo.canonical_url ? absoluteUrl(seo.canonical_url, publicBaseUrl) : `${publicBaseUrl}/guides/${encodeURIComponent(post.slug)}`;
  const image = seo.og_image_url ?? post.cover?.url ?? null;
  return [
    ...socialMeta({
      title: `${seo.meta_title} | mova`,
      description: seo.meta_description,
      canonical,
      base: publicBaseUrl,
      locale: shellFromMatches(matches).locale,
      type: 'article',
      image: image ? absoluteUrl(image, publicBaseUrl) : null,
      ...(post.cover?.alt ? { imageAlt: post.cover.alt } : {}),
    }).map((tag) => tag.property === 'og:title' ? { ...tag, content: seo.og_title ?? seo.meta_title } : tag.property === 'og:description' ? { ...tag, content: seo.og_description ?? seo.meta_description } : tag),
    { property: 'article:published_time', content: post.published_at },
    { property: 'article:modified_time', content: post.updated_at },
    { name: 'author', content: post.author_name },
    ...(seo.noindex ? [{ name: 'robots', content: 'noindex,follow' }] : []),
  ];
};

export default function GuideArticlePage() {
  const { t, i18n } = useTranslation();
  const { post, related, publicBaseUrl } = useLoaderData<typeof loader>();
  const shell = useSiteShell();
  const locale = i18n.language === 'es-US' ? 'es-US' : 'en-US';
  const canonical = post.seo.canonical_url ? absoluteUrl(post.seo.canonical_url, publicBaseUrl) : `${publicBaseUrl}/guides/${encodeURIComponent(post.slug)}`;
  const date = formatGuideDate(post.published_at, locale);

  return <article>
    <div className="mova-site__container">
      <header className="mova-site__article-head">
        <nav aria-label={t('website.guide.breadcrumb')} className="mova-site__crumbs">
          <Link to="/guides">{t('website.guide.guides')}</Link>
          <span aria-hidden="true">/</span>
          <span>{post.category ?? t('website.guide.guides')}</span>
        </nav>
        <h1>{post.title}</h1>
        <p className="mova-site__lead">{post.summary}</p>
        <div className="mova-site__byline">
          <span className="mova-site__avatar" aria-hidden="true">{post.author_name.charAt(0).toUpperCase()}</span>
          <span><strong>{post.author_name}</strong> · {date} · {t('website.guide.readMinutes', { count: post.reading_minutes })}</span>
        </div>
      </header>

      {post.cover && <figure className="mova-site__prose" style={{ maxWidth: 820, marginBottom: 32 }}>
        <img src={post.cover.url} alt={post.cover.alt} />
      </figure>}

      <div className="mova-site__article-layout">
        <div className="mova-site__prose">
          <GuideBlocks blocks={post.body} />
          <div className="mova-site__prose-cta">
            <p style={{ margin: 0 }}>{t('website.guide.asideTitle')}</p>
            <ButtonLink to="/signup">{t('website.guide.startFree')}</ButtonLink>
          </div>
        </div>

        <aside className="mova-site__side" aria-label={t('website.guide.more')}>
          <div className="mova-site__side-card mova-site__side-card--cta">
            <p style={{ fontWeight: 700, color: 'var(--site-ink)', fontSize: 18 }}>{t('website.guide.moreCtaTitle')}</p>
            <p>{t('website.guide.moreCtaBody')}</p>
            <ButtonLink to="/signup">{t('website.guide.startFree')}</ButtonLink>
          </div>
          {related.length > 0 && <nav aria-label={t('website.guide.more')} className="mova-site__side-card">
            <h2>{t('website.guide.more')}</h2>
            {related.map((item) => <Link key={item.slug} to={`/guides/${item.slug}`}>{item.title}</Link>)}
          </nav>}
        </aside>
      </div>
    </div>
    <JsonLd data={articleLd(publicBaseUrl, post, canonical, post.cover ? absoluteUrl(post.cover.url, publicBaseUrl) : null)} />
    <JsonLd data={breadcrumbLd(shell, [[t('website.nav.guides'), '/guides'], [post.title, `/guides/${encodeURIComponent(post.slug)}`]])} />
  </article>;
}

export function ErrorBoundary() {
  const { t } = useTranslation();
  const error = useRouteError();
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  return <div className="mova-site__container" style={{ paddingBlock: 'clamp(48px, 7vw, 96px)', display: 'flex', flexDirection: 'column', gap: 16 }}>
    <h1 className="mova-site__h2">{notFound ? t('website.guide.notFoundTitle') : t('website.guides.loadError')}</h1>
    <p className="mova-site__lead">{notFound ? t('website.guide.notFoundBody') : null}</p>
    <div><Link className="mova-site__button mova-site__button--secondary" to="/guides">{t('website.guide.backToGuides')}</Link></div>
  </div>;
}
