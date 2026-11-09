// Pure rules for the public guides read (GUIDES-CONTRACT.md). No I/O here: index.ts loads rows,
// these functions decide what may be shown and in what shape. Deno tests live in rules.test.ts.

export const DEFAULT_LIMIT = 24;
export const MAX_LIMIT = 50;
export const RELATED_LIMIT = 3;

export type Inline = { text: string; bold?: boolean; italic?: boolean; href?: string };
export type Block =
  | { type: 'heading'; level: 2 | 3; text: string; id?: string }
  | { type: 'paragraph'; content: Inline[] }
  | { type: 'list'; ordered: boolean; items: Inline[][] }
  | { type: 'quote'; content: Inline[]; cite?: string }
  | { type: 'image'; url: string; alt: string; caption?: string }
  | { type: 'callout'; tone: 'tip' | 'note'; content: Inline[] }
  | { type: 'divider' };

export type Seo = {
  meta_title: string;
  meta_description: string;
  canonical_url: string | null;
  og_title: string | null;
  og_description: string | null;
  og_image_url: string | null;
  noindex: boolean;
};

export type PostSummary = {
  slug: string;
  title: string;
  summary: string;
  category: string | null;
  tags: string[];
  cover: { url: string; alt: string } | null;
  published_at: string;
  reading_minutes: number;
  author_name: string;
};
export type PostFull = PostSummary & { body: Block[]; updated_at: string; seo: Seo };

/** One row of the blog table as admin writes it. Column names are the contract's field names. */
export type GuideRow = {
  slug: string;
  title: string;
  summary: string;
  category: string | null;
  tags: unknown;
  cover_url: string | null;
  cover_alt: string | null;
  status: string;
  published_at: string | null;
  reading_minutes: number | null;
  author_name: string;
  body: unknown;
  seo: unknown;
  updated_at: string;
};

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A row is public only when it is published and its time has arrived. Scheduled posts need no job. */
export function isPubliclyVisible(row: Pick<GuideRow, 'status' | 'published_at'>, now: Date): boolean {
  if (row.status !== 'published' || !row.published_at) return false;
  const at = Date.parse(row.published_at);
  return Number.isFinite(at) && at <= now.getTime();
}

/** Newest first; slug breaks ties so pages never shuffle. */
export function sortForList<T extends Pick<GuideRow, 'published_at' | 'slug'>>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const diff = Date.parse(b.published_at ?? '') - Date.parse(a.published_at ?? '');
    if (diff !== 0 && Number.isFinite(diff)) return diff;
    return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
  });
}

export function clampLimit(value: unknown): number {
  if (value === undefined || value === null) return DEFAULT_LIMIT;
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(n)));
}

/** Cursors are opaque to clients. They hold an offset into the newest-first order. */
export function encodeCursor(offset: number): string {
  return btoa(JSON.stringify({ o: offset })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeCursor(cursor: unknown): number | null {
  if (cursor === undefined || cursor === null || cursor === '') return 0;
  if (typeof cursor !== 'string' || cursor.length > 200) return null;
  try {
    const normalized = cursor.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const parsed = JSON.parse(atob(padded)) as { o?: unknown };
    return Number.isSafeInteger(parsed.o) && (parsed.o as number) >= 0 ? (parsed.o as number) : null;
  } catch {
    return null;
  }
}

/** http(s) absolute URLs and relative paths only. Anything else (javascript:, data:, protocol-relative) is dropped. */
export function safeHref(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const href = value.trim();
  if (!href || href.length > 2048) return undefined;
  if (href.startsWith('//')) return undefined;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
    try {
      const parsed = new URL(href);
      return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? href : undefined;
    } catch {
      return undefined;
    }
  }
  return href;
}

function text(value: unknown, max = 5000): string | null {
  return typeof value === 'string' ? value.slice(0, max) : null;
}

function sanitizeInline(value: unknown): Inline | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const body = text(raw.text);
  if (body === null) return null;
  const inline: Inline = { text: body };
  if (raw.bold === true) inline.bold = true;
  if (raw.italic === true) inline.italic = true;
  const href = safeHref(raw.href);
  if (href) inline.href = href;
  return inline;
}

function sanitizeInlines(value: unknown): Inline[] | null {
  if (!Array.isArray(value)) return null;
  return value.map(sanitizeInline).filter((item): item is Inline => item !== null);
}

/** Keeps only the block shapes in the contract. Unknown or malformed blocks are dropped, never passed through. */
export function sanitizeBlocks(value: unknown): Block[] {
  if (!Array.isArray(value)) return [];
  const blocks: Block[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Record<string, unknown>;
    switch (raw.type) {
      case 'heading': {
        const heading = text(raw.text, 300);
        if (heading === null) break;
        const block: Block = { type: 'heading', level: raw.level === 3 ? 3 : 2, text: heading };
        const id = text(raw.id, 120);
        if (id && /^[A-Za-z0-9_-]+$/.test(id)) block.id = id;
        blocks.push(block);
        break;
      }
      case 'paragraph': {
        const content = sanitizeInlines(raw.content);
        if (content) blocks.push({ type: 'paragraph', content });
        break;
      }
      case 'list': {
        if (!Array.isArray(raw.items)) break;
        const items = raw.items.map(sanitizeInlines).filter((entry): entry is Inline[] => entry !== null);
        blocks.push({ type: 'list', ordered: raw.ordered === true, items });
        break;
      }
      case 'quote': {
        const content = sanitizeInlines(raw.content);
        if (!content) break;
        const block: Block = { type: 'quote', content };
        const cite = text(raw.cite, 300);
        if (cite) block.cite = cite;
        blocks.push(block);
        break;
      }
      case 'image': {
        const url = safeHref(raw.url);
        if (!url) break;
        const block: Block = { type: 'image', url, alt: text(raw.alt, 500) ?? '' };
        const caption = text(raw.caption, 500);
        if (caption) block.caption = caption;
        blocks.push(block);
        break;
      }
      case 'callout': {
        const content = sanitizeInlines(raw.content);
        if (content) blocks.push({ type: 'callout', tone: raw.tone === 'tip' ? 'tip' : 'note', content });
        break;
      }
      case 'divider':
        blocks.push({ type: 'divider' });
        break;
      default:
        break;
    }
  }
  return blocks;
}

function readingMinutes(value: unknown): number {
  const n = typeof value === 'number' ? Math.floor(value) : Number.NaN;
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

function tagList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((tag): tag is string => typeof tag === 'string' && tag.trim() !== '').map((tag) => tag.trim()).slice(0, 20) : [];
}

export function toSummary(row: GuideRow): PostSummary {
  const coverUrl = safeHref(row.cover_url);
  return {
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    category: row.category && row.category.trim() ? row.category : null,
    tags: tagList(row.tags),
    cover: coverUrl ? { url: coverUrl, alt: row.cover_alt ?? '' } : null,
    published_at: row.published_at ?? '',
    reading_minutes: readingMinutes(row.reading_minutes),
    author_name: row.author_name,
  };
}

function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function toSeo(row: GuideRow): Seo {
  const raw = row.seo && typeof row.seo === 'object' ? row.seo as Record<string, unknown> : {};
  return {
    meta_title: nonEmpty(raw.meta_title) ?? row.title,
    meta_description: nonEmpty(raw.meta_description) ?? row.summary,
    canonical_url: safeHref(raw.canonical_url) ?? null,
    og_title: nonEmpty(raw.og_title),
    og_description: nonEmpty(raw.og_description),
    og_image_url: safeHref(raw.og_image_url) ?? null,
    noindex: raw.noindex === true,
  };
}

export function toFull(row: GuideRow): PostFull {
  return { ...toSummary(row), body: sanitizeBlocks(row.body), updated_at: row.updated_at, seo: toSeo(row) };
}

export function validSlug(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 120 && SLUG.test(value);
}

/** Related posts: same category, not the post itself, newest first, at most three. */
export function relatedFor(current: GuideRow, rows: GuideRow[], now: Date): PostSummary[] {
  if (!current.category) return [];
  return sortForList(rows.filter((row) => row.slug !== current.slug && row.category === current.category && isPubliclyVisible(row, now)))
    .slice(0, RELATED_LIMIT)
    .map(toSummary);
}

export function categoriesOf(rows: GuideRow[], now: Date): string[] {
  const set = new Set<string>();
  for (const row of rows) {
    if (!isPubliclyVisible(row, now)) continue;
    if (row.category && row.category.trim()) set.add(row.category);
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'en-US'));
}

/** Filters, sorts and pages an in-memory set of rows. The database query applies the same predicates first. */
export function pageForList(rows: GuideRow[], options: { now: Date; category?: string | null; limit: number; offset: number }) {
  const visible = sortForList(rows.filter((row) => isPubliclyVisible(row, options.now) && (!options.category || row.category === options.category)));
  const page = visible.slice(options.offset, options.offset + options.limit);
  const hasMore = visible.length > options.offset + options.limit;
  return {
    posts: page.map(toSummary),
    next_cursor: hasMore ? encodeCursor(options.offset + options.limit) : null,
  };
}
