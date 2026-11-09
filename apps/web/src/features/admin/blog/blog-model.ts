// Guides & blog writer model (admin A9-A10). Pure functions only, so the editor rules can be unit tested.
// The limits here mirror the database checks in migrations 0067 and 0068; the database is the final check.

export type InlineRun = { text: string; bold?: boolean; italic?: boolean; href?: string };

export type Block =
  | { type: 'heading'; level: 2 | 3; text: string }
  | { type: 'paragraph'; content: InlineRun[] }
  | { type: 'list'; ordered: boolean; items: InlineRun[][] }
  | { type: 'quote'; content: InlineRun[]; cite?: string }
  | { type: 'image'; url: string; alt: string; caption?: string }
  | { type: 'callout'; tone: 'tip' | 'note'; content: InlineRun[] }
  | { type: 'divider' };

export type BlockType = Block['type'];

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const TAG_PATTERN = /^[a-z0-9][a-z0-9 -]*$/;
export const LIMITS = {
  title: 140, slug: 120, summary: 240, tags: 6, tagLength: 30, metaTitle: 60, metaDescription: 160,
  ogTitle: 95, ogDescription: 200, coverAlt: 240, coverCredit: 200, author: 120, url: 2048, headingText: 200,
  inlineText: 2000, imageCaption: 240, quoteCite: 200,
} as const;
export const CATEGORIES = ['Booking', 'Clients', 'Money', 'Going independent'] as const;

/** A link is http(s) or relative (not protocol-relative), so a stored link can never run script. */
export function isSafeHref(href: string): boolean {
  const value = href.trim();
  if (value.length === 0 || value.length > LIMITS.url) return false;
  return /^https?:\/\//i.test(value) || (value.startsWith('/') && !value.startsWith('//'));
}

export function isHttpsUrl(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= LIMITS.url && trimmed.startsWith('https://');
}

/** Lower-case words joined by hyphens, from a title. Accents are removed. */
export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, LIMITS.slug)
    .replace(/-+$/g, '');
}

export function parseTags(input: string): { tags: string[]; error: boolean } {
  const parts = input.split(',').map((part) => part.trim().toLowerCase()).filter((part) => part.length > 0);
  const unique = [...new Set(parts)].sort();
  const valid = unique.every((tag) => tag.length <= LIMITS.tagLength && TAG_PATTERN.test(tag));
  return { tags: unique, error: !valid || unique.length > LIMITS.tags };
}

export function countWords(text: string): number {
  const words = text.trim().split(/\s+/).filter((word) => word.length > 0);
  return words.length;
}

/** Reading time at about 220 words a minute, never below one minute. */
export function readingMinutes(blocks: Block[]): number {
  const words = blocks.reduce((total, block) => total + countWords(blockText(block)), 0);
  return Math.max(1, Math.ceil(words / 220));
}

export function inlineText(runs: InlineRun[]): string {
  return runs.map((run) => run.text).join('');
}

export function blockText(block: Block): string {
  switch (block.type) {
    case 'heading': return block.text;
    case 'paragraph': return inlineText(block.content);
    case 'list': return block.items.map(inlineText).join(' ');
    case 'quote': return `${inlineText(block.content)} ${block.cite ?? ''}`;
    case 'image': return `${block.alt} ${block.caption ?? ''}`;
    case 'callout': return inlineText(block.content);
    case 'divider': return '';
  }
}

export type BlockProblem = { index: number; message: string };

/** Block-level problems, in the same order the database reports them. An empty list means the body is valid. */
export function bodyProblems(blocks: Block[]): BlockProblem[] {
  const problems: BlockProblem[] = [];
  blocks.forEach((block, index) => {
    const add = (message: string) => problems.push({ index, message });
    const runsOk = (runs: InlineRun[], minimum: number) => runs.length >= minimum && runs.every((run) => run.text.length <= LIMITS.inlineText && (run.href === undefined || isSafeHref(run.href)));
    switch (block.type) {
      case 'heading':
        if (block.text.trim().length === 0 || block.text.length > LIMITS.headingText) add('A heading needs text (up to 200 characters).');
        break;
      case 'paragraph':
        if (!runsOk(block.content, 1) || inlineText(block.content).trim().length === 0) add('Add text to this paragraph, or remove it.');
        break;
      case 'list':
        if (block.items.length === 0 || block.items.length > 50 || block.items.some((item) => !runsOk(item, 1) || inlineText(item).trim().length === 0)) add('Each list item needs text.');
        break;
      case 'quote':
        if (!runsOk(block.content, 1) || inlineText(block.content).trim().length === 0) add('A quote needs text.');
        if (block.cite !== undefined && block.cite.length > LIMITS.quoteCite) add('The quote credit is too long.');
        break;
      case 'image':
        if (!isHttpsUrl(block.url)) add('Image links must start with https://.');
        if (block.alt.trim().length === 0 || block.alt.length > 240) add('Every image needs alt text that describes it.');
        if (block.caption !== undefined && block.caption.length > LIMITS.imageCaption) add('The image caption is too long.');
        break;
      case 'callout':
        if (!runsOk(block.content, 1) || inlineText(block.content).trim().length === 0) add('A callout needs text.');
        break;
      case 'divider':
        break;
    }
  });
  return problems;
}

export type BlogDraft = {
  id: string | null;
  title: string;
  slug: string;
  summary: string;
  body: Block[];
  category: string | null;
  tags: string[];
  coverUrl: string;
  coverAlt: string;
  coverCredit: string;
  authorName: string;
  metaTitle: string;
  metaDescription: string;
  canonicalUrl: string;
  ogTitle: string;
  ogDescription: string;
  ogImageUrl: string;
  noindex: boolean;
  liveState: 'draft' | 'scheduled' | 'published';
  publishedAt: string | null;
};

export function emptyDraft(authorName = 'Mova team'): BlogDraft {
  return {
    id: null, title: '', slug: '', summary: '', body: [], category: null, tags: [],
    coverUrl: '', coverAlt: '', coverCredit: '', authorName,
    metaTitle: '', metaDescription: '', canonicalUrl: '', ogTitle: '', ogDescription: '', ogImageUrl: '', noindex: false,
    liveState: 'draft', publishedAt: null,
  };
}

/** Maps a saved guide from the database (snake_case) to the editor state. */
export function draftFromRecord(post: Record<string, unknown>): BlogDraft {
  const seo = (post['seo'] ?? {}) as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === 'string' ? value : '');
  const tags = Array.isArray(post['tags']) ? post['tags'].filter((tag): tag is string => typeof tag === 'string') : [];
  const liveState = post['live_state'];
  return {
    id: text(post['id']) || null,
    title: text(post['title']),
    slug: text(post['slug']),
    summary: text(post['summary']),
    body: Array.isArray(post['body']) ? (post['body'] as Block[]) : [],
    category: typeof post['category'] === 'string' ? post['category'] : null,
    tags,
    coverUrl: text(post['cover_url']),
    coverAlt: text(post['cover_alt']),
    coverCredit: text(post['cover_credit']),
    authorName: text(post['author_name']) || 'Mova team',
    metaTitle: text(seo['meta_title']),
    metaDescription: text(seo['meta_description']),
    canonicalUrl: text(seo['canonical_url']),
    ogTitle: text(seo['og_title']),
    ogDescription: text(seo['og_description']),
    ogImageUrl: text(seo['og_image_url']),
    noindex: seo['noindex'] === true,
    liveState: liveState === 'scheduled' || liveState === 'published' ? liveState : 'draft',
    publishedAt: typeof post['published_at'] === 'string' ? post['published_at'] : null,
  };
}

export type SaveMode = 'draft' | 'schedule' | 'publish';

export type DraftFieldErrors = Partial<Record<'title' | 'slug' | 'summary' | 'body' | 'category' | 'tags' | 'coverUrl' | 'coverAlt' | 'authorName' | 'metaTitle' | 'metaDescription' | 'canonicalUrl' | 'ogTitle' | 'ogDescription' | 'ogImageUrl' | 'schedule', string>>;

/** Editor-side checks for one save. Matches the database, so the user sees problems before a round trip. */
export function draftErrors(draft: BlogDraft, mode: SaveMode, publishAt: Date | null, now: Date): DraftFieldErrors {
  const errors: DraftFieldErrors = {};
  const title = draft.title.trim();
  if (title.length === 0 || title.length > LIMITS.title) errors.title = 'Add a title (up to 140 characters).';
  if (!SLUG_PATTERN.test(draft.slug) || draft.slug.length < 3 || draft.slug.length > LIMITS.slug) errors.slug = 'Use lowercase letters, numbers and hyphens (3 to 120 characters).';
  if (draft.summary.length > LIMITS.summary) errors.summary = 'The summary is longer than 240 characters.';
  const bodyProblem = bodyProblems(draft.body)[0];
  if (bodyProblem) errors.body = `Block ${bodyProblem.index + 1}: ${bodyProblem.message}`;
  if (draft.authorName.trim().length === 0 || draft.authorName.length > LIMITS.author) errors.authorName = 'Add an author name (up to 120 characters).';
  if (draft.coverUrl.trim() && !isHttpsUrl(draft.coverUrl)) errors.coverUrl = 'The cover image link must start with https://.';
  if (draft.coverAlt.length > LIMITS.coverAlt) errors.coverAlt = 'The cover image alt text is too long.';
  if (draft.metaTitle.length > LIMITS.metaTitle) errors.metaTitle = 'The meta title is longer than 60 characters.';
  if (draft.metaDescription.length > LIMITS.metaDescription) errors.metaDescription = 'The meta description is longer than 160 characters.';
  if (draft.canonicalUrl.trim() && !isHttpsUrl(draft.canonicalUrl)) errors.canonicalUrl = 'The canonical link must start with https://.';
  if (draft.ogTitle.length > LIMITS.ogTitle) errors.ogTitle = 'The social title is longer than 95 characters.';
  if (draft.ogDescription.length > LIMITS.ogDescription) errors.ogDescription = 'The social description is longer than 200 characters.';
  if (draft.ogImageUrl.trim() && !isHttpsUrl(draft.ogImageUrl)) errors.ogImageUrl = 'The social image link must start with https://.';
  if (mode !== 'draft') {
    if (draft.summary.trim().length === 0) errors.summary = 'Add a summary before publishing.';
    if (draft.body.length === 0) errors.body = 'Add at least one block before publishing.';
    if (draft.category === null) errors.category = 'Choose a category before publishing.';
  }
  if (mode === 'schedule') {
    if (publishAt === null || Number.isNaN(publishAt.getTime())) errors.schedule = 'Pick a date and time.';
    else if (publishAt.getTime() <= now.getTime()) errors.schedule = 'Pick a time later than now.';
  }
  return errors;
}

export function hasErrors(errors: DraftFieldErrors): boolean {
  return Object.keys(errors).length > 0;
}

export type SeoCheck = { id: string; label: string; ok: boolean };

/** The eight search checks shown in the SEO panel. Each one is either done or needs work. */
export function seoChecks(draft: BlogDraft): SeoCheck[] {
  const metaTitle = draft.metaTitle.trim() || draft.title.trim();
  const description = draft.metaDescription.trim();
  const hasHeading = draft.body.some((block) => block.type === 'heading' && block.level === 2);
  return [
    { id: 'slug', label: 'URL uses lowercase words and hyphens', ok: SLUG_PATTERN.test(draft.slug) && draft.slug.length >= 3 },
    { id: 'title', label: 'Meta title is set (up to 60 characters)', ok: metaTitle.length > 0 && metaTitle.length <= LIMITS.metaTitle },
    { id: 'description', label: 'Meta description is set (up to 160 characters)', ok: description.length > 0 && description.length <= LIMITS.metaDescription },
    { id: 'summary', label: 'Summary is written (up to 240 characters)', ok: draft.summary.trim().length > 0 && draft.summary.length <= LIMITS.summary },
    { id: 'social', label: 'Social image is set', ok: isHttpsUrl(draft.ogImageUrl) || isHttpsUrl(draft.coverUrl) },
    { id: 'alt', label: 'Cover image has alt text', ok: draft.coverUrl.trim().length === 0 || draft.coverAlt.trim().length > 0 },
    { id: 'canonical', label: 'Canonical link is https or empty', ok: draft.canonicalUrl.trim().length === 0 || isHttpsUrl(draft.canonicalUrl) },
    { id: 'heading', label: 'Has at least one section heading', ok: hasHeading },
  ];
}

/** Payload for mova_admin_blog_save. Empty optional text becomes null. */
export function draftPayload(draft: BlogDraft): Record<string, unknown> {
  const orNull = (value: string) => (value.trim().length > 0 ? value.trim() : null);
  return {
    slug: draft.slug.trim().toLowerCase(),
    title: draft.title.trim(),
    summary: draft.summary.trim(),
    body: draft.body,
    category: draft.category,
    tags: draft.tags,
    cover_url: orNull(draft.coverUrl),
    cover_alt: draft.coverAlt.trim(),
    cover_credit: orNull(draft.coverCredit),
    author_name: draft.authorName.trim(),
    meta_title: draft.metaTitle.trim(),
    meta_description: draft.metaDescription.trim(),
    canonical_url: orNull(draft.canonicalUrl),
    og_title: draft.ogTitle.trim(),
    og_description: draft.ogDescription.trim(),
    og_image_url: orNull(draft.ogImageUrl),
    noindex: draft.noindex,
  };
}

// Editing helpers for the block list.
export function newBlock(type: BlockType): Block {
  switch (type) {
    case 'heading': return { type, level: 2, text: '' };
    case 'paragraph': return { type, content: [{ text: '' }] };
    case 'list': return { type, ordered: false, items: [[{ text: '' }]] };
    case 'quote': return { type, content: [{ text: '' }] };
    case 'image': return { type, url: '', alt: '' };
    case 'callout': return { type, tone: 'tip', content: [{ text: '' }] };
    case 'divider': return { type };
  }
}

export function moveBlock(blocks: Block[], index: number, direction: -1 | 1): Block[] {
  const target = index + direction;
  if (index < 0 || index >= blocks.length || target < 0 || target >= blocks.length) return blocks;
  const next = [...blocks];
  const [moved] = next.splice(index, 1);
  if (moved === undefined) return blocks;
  next.splice(target, 0, moved);
  return next;
}

export function removeBlock(blocks: Block[], index: number): Block[] {
  return blocks.filter((_, position) => position !== index);
}

/** Converts a date (YYYY-MM-DD) and time (HH:mm) in a time zone to the matching instant. */
export function zonedWallTimeToInstant(date: string, time: string, timeZone: string): Date | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dateMatch || !timeMatch) return null;
  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const firstOffset = zoneOffsetMs(new Date(wall), timeZone);
  let instant = wall - firstOffset;
  const secondOffset = zoneOffsetMs(new Date(instant), timeZone);
  if (secondOffset !== firstOffset) instant = wall - secondOffset;
  return new Date(instant);
}

function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant);
  const part = (type: string) => Number(parts.find((entry) => entry.type === type)?.value ?? 0);
  const asUtc = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'));
  return asUtc - (instant.getTime() - instant.getMilliseconds());
}

/** Scheduling uses Eastern time, the platform's time zone for schedules. */
export const PUBLISH_TIME_ZONE = 'America/New_York';
