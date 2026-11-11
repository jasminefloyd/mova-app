import {
  categoriesOf, clampLimit, decodeCursor, encodeCursor, isPubliclyVisible, pageForList, relatedFor, safeHref, sanitizeBlocks, toFull, validSlug,
  type GuideRow,
} from './rules.ts';

// Deno test (run by scripts/fn-check.mjs).
const same = (actual: unknown, expected: unknown, message: string) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
};
const now = new Date('2026-11-08T12:00:00Z');

function row(overrides: Partial<GuideRow> & { slug: string }): GuideRow {
  return {
    title: `Title ${overrides.slug}`,
    summary: `Summary ${overrides.slug}`,
    category: 'Clients',
    tags: ['notes'],
    cover_url: null,
    cover_alt: null,
    status: 'published',
    published_at: '2026-10-01T10:00:00Z',
    reading_minutes: 4,
    author_name: 'Jasmine',
    body: [],
    meta_title: '', meta_description: '', canonical_url: null, og_title: '', og_description: '', og_image_url: null, noindex: false,
    updated_at: '2026-10-02T10:00:00Z',
    ...overrides,
  };
}

Deno.test('GUIDES-PUB-01 only published posts whose time has arrived are visible', () => {
  same(isPubliclyVisible({ status: 'published', published_at: '2026-11-08T12:00:00Z' }, now), true, 'exactly now');
  same(isPubliclyVisible({ status: 'published', published_at: '2026-11-08T12:00:01Z' }, now), false, 'scheduled for later');
  same(isPubliclyVisible({ status: 'draft', published_at: '2026-10-01T00:00:00Z' }, now), false, 'draft with a past date');
  same(isPubliclyVisible({ status: 'scheduled', published_at: '2026-10-01T00:00:00Z' }, now), false, 'scheduled status');
  same(isPubliclyVisible({ status: 'published', published_at: null }, now), false, 'no publish time');
  same(isPubliclyVisible({ status: 'published', published_at: 'not a date' }, now), false, 'unparseable time');
});

Deno.test('GUIDES-PUB-02 list hides drafts and future posts and sorts newest first', () => {
  const rows = [
    row({ slug: 'old', published_at: '2026-09-01T00:00:00Z' }),
    row({ slug: 'future', published_at: '2026-12-01T00:00:00Z' }),
    row({ slug: 'draft', status: 'draft', published_at: '2026-10-15T00:00:00Z' }),
    row({ slug: 'new', published_at: '2026-10-20T00:00:00Z' }),
  ];
  const page = pageForList(rows, { now, limit: 24, offset: 0 });
  same(page.posts.map((post) => post.slug), ['new', 'old'], 'visible order');
  same(page.next_cursor, null, 'no next page');
});

Deno.test('GUIDES-PUB-03 category filter, limit and cursor paging', () => {
  const rows = [
    row({ slug: 'a', published_at: '2026-10-05T00:00:00Z' }),
    row({ slug: 'b', published_at: '2026-10-04T00:00:00Z', category: 'Money' }),
    row({ slug: 'c', published_at: '2026-10-03T00:00:00Z' }),
    row({ slug: 'd', published_at: '2026-10-02T00:00:00Z' }),
  ];
  const first = pageForList(rows, { now, limit: 2, offset: 0 });
  same(first.posts.map((post) => post.slug), ['a', 'b'], 'first page');
  const second = pageForList(rows, { now, limit: 2, offset: decodeCursor(first.next_cursor)! });
  same(second.posts.map((post) => post.slug), ['c', 'd'], 'second page');
  same(second.next_cursor, null, 'last page has no cursor');
  const money = pageForList(rows, { now, category: 'Money', limit: 24, offset: 0 });
  same(money.posts.map((post) => post.slug), ['b'], 'category filter');
});

Deno.test('GUIDES-PUB-04 limit is clamped to 1..50 with a default of 24', () => {
  same(clampLimit(undefined), 24, 'default');
  same(clampLimit(0), 1, 'floor');
  same(clampLimit(500), 50, 'ceiling');
  same(clampLimit('7'), 7, 'numeric string');
  same(clampLimit('abc'), 24, 'junk falls back');
});

Deno.test('GUIDES-PUB-05 cursors round-trip and reject tampering', () => {
  same(decodeCursor(encodeCursor(48)), 48, 'round trip');
  same(decodeCursor(undefined), 0, 'missing cursor starts at zero');
  same(decodeCursor('!!!'), null, 'garbage');
  same(decodeCursor(btoa('{"o":-1}')), null, 'negative offset');
  same(decodeCursor(btoa('{"o":1.5}')), null, 'fractional offset');
});

Deno.test('GUIDES-PUB-06 slugs are lowercase words joined by hyphens', () => {
  same(validSlug('ai-isnt-what-is-making'), true, 'valid');
  same(validSlug('Bad Slug'), false, 'spaces and capitals');
  same(validSlug('../etc'), false, 'path traversal');
  same(validSlug(''), false, 'empty');
});

Deno.test('GUIDES-PUB-07 hrefs allow http, https and relative paths only', () => {
  same(safeHref('https://example.com/a'), 'https://example.com/a', 'https');
  same(safeHref('/guides/x'), '/guides/x', 'relative');
  same(safeHref('#notes'), '#notes', 'fragment');
  same(safeHref('javascript:alert(1)'), undefined, 'javascript scheme');
  same(safeHref('data:text/html,hi'), undefined, 'data scheme');
  same(safeHref('//evil.example/x'), undefined, 'protocol relative');
  same(safeHref('ftp://example.com'), undefined, 'ftp');
  same(safeHref(42), undefined, 'not a string');
});

Deno.test('GUIDES-PUB-08 body keeps only contract block shapes and drops anything else', () => {
  const blocks = sanitizeBlocks([
    { type: 'heading', level: 2, text: 'Start', id: 'start' },
    { type: 'heading', level: 9, text: 'Odd level' },
    { type: 'paragraph', content: [{ text: 'Hi', bold: true, href: 'javascript:void(0)' }, { text: 'there', href: 'https://mova.example' }] },
    { type: 'list', ordered: true, items: [[{ text: 'one' }], 'nope'] },
    { type: 'quote', content: [{ text: 'quoted' }], cite: 'Someone' },
    { type: 'image', url: 'data:image/png;base64,AAAA', alt: 'drop me' },
    { type: 'image', url: '/media/a.jpg', alt: 'A photo', caption: 'Caption' },
    { type: 'callout', tone: 'warning', content: [{ text: 'note' }] },
    { type: 'divider' },
    { type: 'html', html: '<script>alert(1)</script>' },
    { type: 'paragraph' },
    null,
  ]);
  same(blocks, [
    { type: 'heading', level: 2, text: 'Start', id: 'start' },
    { type: 'heading', level: 2, text: 'Odd level' },
    { type: 'paragraph', content: [{ text: 'Hi', bold: true }, { text: 'there', href: 'https://mova.example' }] },
    { type: 'list', ordered: true, items: [[{ text: 'one' }]] },
    { type: 'quote', content: [{ text: 'quoted' }], cite: 'Someone' },
    { type: 'image', url: '/media/a.jpg', alt: 'A photo', caption: 'Caption' },
    { type: 'callout', tone: 'note', content: [{ text: 'note' }] },
    { type: 'divider' },
  ], 'sanitized body');
});

Deno.test('GUIDES-PUB-09 SEO fields fall back to title and summary when empty', () => {
  const full = toFull(row({ slug: 'seo', meta_title: '  ', meta_description: '', canonical_url: 'javascript:x', noindex: true, og_image_url: 'https://cdn.example/x.jpg' }));
  same(full.seo, {
    meta_title: 'Title seo', meta_description: 'Summary seo', canonical_url: null, og_title: null, og_description: null,
    og_image_url: 'https://cdn.example/x.jpg', noindex: true,
  }, 'seo');
  same(toFull(row({ slug: 'plain' })).seo.noindex, false, 'noindex defaults off');
});

Deno.test('GUIDES-PUB-10 related posts share the category, exclude the post and cap at three', () => {
  const current = row({ slug: 'current', published_at: '2026-10-10T00:00:00Z' });
  const rows = [
    current,
    row({ slug: 'r1', published_at: '2026-10-09T00:00:00Z' }),
    row({ slug: 'r2', published_at: '2026-10-08T00:00:00Z' }),
    row({ slug: 'r3', published_at: '2026-10-07T00:00:00Z' }),
    row({ slug: 'r4', published_at: '2026-10-06T00:00:00Z' }),
    row({ slug: 'other', category: 'Money', published_at: '2026-10-05T00:00:00Z' }),
    row({ slug: 'future-r', published_at: '2026-12-01T00:00:00Z' }),
  ];
  same(relatedFor(current, rows, now).map((post) => post.slug), ['r1', 'r2', 'r3'], 'related');
  same(relatedFor(row({ slug: 'uncat', category: null }), rows, now), [], 'no category, no related');
});

Deno.test('GUIDES-PUB-11 categories list only visible posts, sorted and unique', () => {
  const rows = [
    row({ slug: 'a', category: 'Money' }),
    row({ slug: 'b', category: 'Clients' }),
    row({ slug: 'c', category: 'Clients' }),
    row({ slug: 'd', category: 'Secret', status: 'draft' }),
    row({ slug: 'e', category: 'Later', published_at: '2027-01-01T00:00:00Z' }),
    row({ slug: 'f', category: null }),
  ];
  same(categoriesOf(rows, now), ['Clients', 'Money'], 'categories');
});

Deno.test('GUIDES-PUB-12 summary shape carries cover only when the URL is safe', () => {
  const withCover = pageForList([row({ slug: 'cover', cover_url: 'https://cdn.example/c.jpg', cover_alt: 'Scissors' })], { now, limit: 5, offset: 0 });
  same(withCover.posts[0]?.cover, { url: 'https://cdn.example/c.jpg', alt: 'Scissors' }, 'cover');
  const unsafe = pageForList([row({ slug: 'bad', cover_url: 'javascript:alert(1)' })], { now, limit: 5, offset: 0 });
  same(unsafe.posts[0]?.cover, null, 'unsafe cover dropped');
});
