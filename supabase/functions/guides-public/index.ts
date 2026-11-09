import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.119.0';
import { corsHeaders } from '../_shared/cors.ts';
import {
  categoriesOf, clampLimit, decodeCursor, encodeCursor, isPubliclyVisible, relatedFor, sortForList, toFull, toSummary, validSlug,
  type GuideRow,
} from './rules.ts';

// Public, read-only guides for the website Guides pages. No JWT. Schema and writes belong to the admin stream
// (GUIDES-CONTRACT.md). Only published rows whose published_at has passed are ever returned.
const TABLE = 'mova_blog_posts';
const LIST_COLUMNS = 'slug,title,summary,category,tags,cover_url,cover_alt,status,published_at,reading_minutes,author_name,body,seo,updated_at';
const publicCorsHeaders = { ...corsHeaders, 'Access-Control-Allow-Methods': 'POST, OPTIONS' };

function respond(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  const error = status >= 400 ? (typeof data === 'object' && data && 'code' in data ? data : { code: 'REQUEST_FAILED' }) : null;
  return Response.json(
    { data: status >= 400 ? null : data, error: status >= 400 ? error : null, request_id: crypto.randomUUID() },
    { status, headers: { ...publicCorsHeaders, ...extraHeaders } },
  );
}

const cacheHeaders = { 'Cache-Control': 'public, max-age=60, s-maxage=300' };

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: publicCorsHeaders });
  if (request.method !== 'POST') return respond({ code: 'METHOD_NOT_ALLOWED' }, 405);

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') return respond({ code: 'INVALID_REQUEST' }, 400);

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return respond({ code: 'SERVER_CONFIGURATION_MISSING' }, 500);
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const now = new Date();
  const nowIso = now.toISOString();

  if (body.action === 'list') {
    const category = body.category === undefined || body.category === null || body.category === '' ? null : body.category;
    if (category !== null && (typeof category !== 'string' || category.length > 60)) return respond({ code: 'INVALID_REQUEST' }, 400);
    const limit = clampLimit(body.limit);
    const offset = decodeCursor(body.cursor);
    if (offset === null) return respond({ code: 'INVALID_CURSOR' }, 400);

    let pageQuery = supabase.from(TABLE).select(LIST_COLUMNS)
      .eq('status', 'published').lte('published_at', nowIso)
      .order('published_at', { ascending: false }).order('slug', { ascending: true })
      .range(offset, offset + limit);
    if (category) pageQuery = pageQuery.eq('category', category);
    const { data: pageRows, error: pageError } = await pageQuery;
    if (pageError) return respond({ code: 'GUIDES_UNAVAILABLE' }, 503);

    const { data: categoryRows, error: categoryError } = await supabase.from(TABLE).select('category,status,published_at,slug')
      .eq('status', 'published').lte('published_at', nowIso).not('category', 'is', null);
    if (categoryError) return respond({ code: 'GUIDES_UNAVAILABLE' }, 503);

    // Re-apply the visibility rule in code so a query mistake can never expose a draft or a future post.
    const visible = sortForList(((pageRows ?? []) as GuideRow[]).filter((row) => isPubliclyVisible(row, now)));
    const hasMore = (pageRows ?? []).length > limit;
    return respond({
      posts: visible.slice(0, limit).map(toSummary),
      categories: categoriesOf((categoryRows ?? []) as GuideRow[], now),
      next_cursor: hasMore ? encodeCursor(offset + limit) : null,
    }, 200, cacheHeaders);
  }

  if (body.action === 'get') {
    if (!validSlug(body.slug)) return respond({ code: 'INVALID_REQUEST' }, 400);
    const { data: row, error: rowError } = await supabase.from(TABLE).select(LIST_COLUMNS)
      .eq('slug', body.slug).eq('status', 'published').lte('published_at', nowIso).maybeSingle();
    if (rowError) return respond({ code: 'GUIDES_UNAVAILABLE' }, 503);
    const guide = row as GuideRow | null;
    if (!guide || !isPubliclyVisible(guide, now)) return respond({ code: 'NOT_FOUND' }, 404);

    const { data: sameCategory, error: relatedError } = guide.category
      ? await supabase.from(TABLE).select(LIST_COLUMNS).eq('status', 'published').lte('published_at', nowIso)
        .eq('category', guide.category).neq('slug', guide.slug).order('published_at', { ascending: false }).limit(10)
      : { data: [], error: null };
    if (relatedError) return respond({ code: 'GUIDES_UNAVAILABLE' }, 503);

    return respond({
      post: toFull(guide),
      related: relatedFor(guide, (sameCategory ?? []) as GuideRow[], now),
    }, 200, cacheHeaders);
  }

  return respond({ code: 'INVALID_ACTION' }, 400);
});
