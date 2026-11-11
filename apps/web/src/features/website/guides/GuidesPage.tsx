import { useTranslation } from 'react-i18next';
import { Link, useLoaderData } from 'react-router';
import type { LoaderFunctionArgs, MetaFunction } from 'react-router';
import { ButtonLink, Eyebrow, JsonLd, useSiteShell } from '../parts';
import { breadcrumbLd, guidesListLd, pageMeta, shellFromMatches } from '../seo';
import { fetchGuidesList } from './guides-api';
import { formatGuideDate } from './guide-format';
import type { GuidesListResult, PostSummary } from './guide-types';

// Cursors are opaque. "trail" holds the cursors of earlier pages so Previous can step back.
// The first page is stored in the trail as "0" because an empty entry would be lost in the URL.
const FIRST_PAGE = '0';

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const category = url.searchParams.get('category') || undefined;
  const q = url.searchParams.get('q')?.trim().slice(0, 80) || undefined;
  const cursorParam = url.searchParams.get('cursor') || undefined;
  const trail = url.searchParams.get('trail')?.split('|').filter(Boolean) ?? [];
  try {
    const data = await fetchGuidesList({ category, cursor: cursorParam, q });
    return { ok: true as const, data, category: category ?? null, q: q ?? '', cursor: cursorParam ?? null, trail };
  } catch {
    return { ok: false as const, data: null, category: category ?? null, q: q ?? '', cursor: cursorParam ?? null, trail };
  }
}

// Filtered, searched and paged views are the same list in a different order, so only the plain list is indexed.
export const meta: MetaFunction<typeof loader> = ({ matches, data }) => [
  ...pageMeta('guides', shellFromMatches(matches)),
  ...(data && (data.category || data.q || data.cursor) ? [{ name: 'robots', content: 'noindex,follow' }] : []),
];

function listHref(category: string | null, cursor: string | null, trail: string[], q = '') {
  const params = new URLSearchParams();
  if (category) params.set('category', category);
  if (cursor) params.set('cursor', cursor);
  if (trail.length) params.set('trail', trail.join('|'));
  if (q) params.set('q', q);
  const query = params.toString();
  return query ? `/guides?${query}` : '/guides';
}

export default function GuidesPage() {
  const { t, i18n } = useTranslation();
  const shell = useSiteShell();
  const loaded = useLoaderData<typeof loader>();
  const locale = i18n.language === 'es-US' ? 'es-US' : 'en-US';
  const data: GuidesListResult | null = loaded.data;
  const posts: PostSummary[] = data?.posts ?? [];
  const isFirstPage = loaded.cursor === null;
  const featured = isFirstPage ? posts[0] : undefined;
  const listed = isFirstPage ? posts.slice(1) : posts;
  const pageNumber = loaded.trail.length + 1;
  const pageCount = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;
  const previousToken = loaded.trail.at(-1);
  const previousCursor = previousToken && previousToken !== FIRST_PAGE ? previousToken : null;
  const previousHref = listHref(loaded.category, previousCursor, loaded.trail.slice(0, -1), loaded.q);
  const nextHref = data?.next_cursor ? listHref(loaded.category, data.next_cursor, [...loaded.trail, loaded.cursor ?? FIRST_PAGE], loaded.q) : null;

  return <div>
    {data && <JsonLd data={guidesListLd(shell, posts)} />}
    <JsonLd data={breadcrumbLd(shell, [[t('website.nav.guides'), '/guides']])} />
    <section className="mova-site__container" aria-labelledby="guides-h" style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBlock: 'clamp(40px, 6vw, 80px) 24px' }}>
      <Eyebrow>{t('website.guides.eyebrow')}</Eyebrow>
      <h1 id="guides-h" className="mova-site__h1" style={{ maxWidth: 820, fontSize: 'clamp(36px, 4.6vw, 56px)' }}>{t('website.guides.headline')}</h1>
      <p className="mova-site__lead" style={{ maxWidth: 680 }}>{t('website.guides.intro')}</p>
    </section>

    {data && <section className="mova-site__container" aria-label={t('website.guides.topics')} style={{ paddingBottom: 24 }}>
      <form action="/guides" method="get" role="search" style={{ display: 'flex', gap: 8, marginBottom: 16, maxWidth: 620 }}>
        {loaded.category && <input type="hidden" name="category" value={loaded.category} />}
        <label className="mova-visually-hidden" htmlFor="guide-search">{t('website.guides.search')}</label>
        <input className="mova-site__input" id="guide-search" name="q" type="search" maxLength={80} defaultValue={loaded.q} placeholder={t('website.guides.searchPlaceholder')} />
        <button className="mova-site__button" type="submit">{t('website.guides.search')}</button>
      </form>
      <nav aria-label={t('website.guides.topics')} className="mova-site__topics">
        <Link className="mova-site__chip" to={listHref(null, null, [], loaded.q)} aria-current={loaded.category === null ? 'page' : undefined}>{t('website.guides.all')}</Link>
        {data.categories.map((category) => <Link key={category} className="mova-site__chip" to={listHref(category, null, [], loaded.q)} aria-current={loaded.category === category ? 'page' : undefined}>{category}</Link>)}
      </nav>
    </section>}

    <section className="mova-site__container" style={{ display: 'flex', flexDirection: 'column', gap: 40, paddingBottom: 'clamp(48px, 6vw, 80px)' }}>
      {!loaded.ok && <div className="mova-site__empty" role="alert"><p style={{ margin: 0 }}>{t('website.guides.loadError')}</p></div>}

      {loaded.ok && posts.length === 0 && <div className="mova-site__empty"><p style={{ margin: 0 }}>{t('website.guides.empty')}</p></div>}

      {featured && <Link className="mova-site__featured" to={`/guides/${featured.slug}`} aria-label={`${t('website.guides.featured')}: ${featured.title}`}>
        <div className="mova-site__featured-copy">
          <span className="mova-site__eyebrow">{t('website.guides.featured')}{featured.category ? ` · ${featured.category}` : ''}</span>
          <h2>{featured.title}</h2>
          <p>{featured.summary}</p>
          <p className="mova-site__meta">{t('website.guides.by', { author: featured.author_name })} · {formatGuideDate(featured.published_at, locale)} · {t('website.guides.readMinutes', { count: featured.reading_minutes })}</p>
        </div>
        <div className="mova-site__art" aria-hidden="true">
          {featured.cover && <img src={featured.cover.url} alt="" />}
        </div>
      </Link>}

      {listed.length > 0 && <div className="mova-site__stack" style={{ gap: 16 }}>
        <h2 className="mova-site__h2" style={{ fontSize: 'clamp(24px, 2.6vw, 32px)' }}>{t('website.guides.allGuides')}</h2>
        <ul className="mova-site__guide-list">
          {listed.map((post) => <li key={post.slug}>
            <Link className="mova-site__guide-card" to={`/guides/${post.slug}`}>
              <span className="mova-site__meta">{post.category ? `${post.category} · ` : ''}{formatGuideDate(post.published_at, locale)}</span>
              <h3>{post.title}</h3>
              <p>{post.summary}</p>
              <span className="mova-site__meta">{t('website.guides.readMinutes', { count: post.reading_minutes })}</span>
            </Link>
          </li>)}
        </ul>
      </div>}

      {data && (loaded.trail.length > 0 || nextHref) && <nav aria-label={t('website.guides.pagination')} className="mova-site__pager">
        {loaded.trail.length > 0 ? <Link to={previousHref}>{t('website.guides.previous')}</Link> : <span aria-disabled="true">{t('website.guides.previous')}</span>}
        <span className="mova-site__meta">{t('website.guides.pageOf', { page: pageNumber, total: pageCount })}</span>
        {nextHref ? <Link to={nextHref}>{t('website.guides.next')}</Link> : <span aria-disabled="true">{t('website.guides.next')}</span>}
      </nav>}
    </section>

    <section className="mova-site__container" aria-labelledby="guides-cta-h" style={{ paddingBottom: 'clamp(56px, 7vw, 96px)' }}>
      <div className="mova-site__cta">
        <div className="mova-site__cta-copy">
          <h2 id="guides-cta-h">{t('website.guides.ctaTitle')}</h2>
          <p>{t('website.guides.ctaBody')}</p>
        </div>
        <ButtonLink to="/signup">{t('website.guides.startFree')}</ButtonLink>
      </div>
    </section>
  </div>;
}
