import { describe, expect, it } from 'vitest';
import {
  bodyProblems, draftErrors, draftFromRecord, draftPayload, emptyDraft, hasErrors, isSafeHref, moveBlock, newBlock,
  parseTags, readingMinutes, removeBlock, seoChecks, slugify, zonedWallTimeToInstant, type BlogDraft, type Block,
} from './blog-model';

const now = new Date('2026-11-08T15:00:00.000Z');

function filledDraft(overrides: Partial<BlogDraft> = {}): BlogDraft {
  return {
    ...emptyDraft(),
    title: 'Manage appointments across salons',
    slug: 'manage-appointments-across-salons',
    summary: 'One calendar for a week that spans two suites and a mobile day.',
    body: [{ type: 'heading', level: 2, text: 'Keep the week in one calendar' }, { type: 'paragraph', content: [{ text: 'Most stylists keep two calendars.' }] }],
    category: 'Booking',
    tags: ['calendar'],
    metaTitle: 'Manage appointments across salons | Mova guides',
    metaDescription: 'Keep every suite and mobile day in one calendar.',
    ...overrides,
  };
}

describe('slugify', () => {
  it('turns a title into a lower-case hyphenated slug', () => {
    expect(slugify("AI isn't what's making beauty less personal")).toBe('ai-isn-t-what-s-making-beauty-less-personal');
    expect(slugify('Café & booth rent: how to compare')).toBe('cafe-booth-rent-how-to-compare');
  });

  it('never returns a slug with leading, trailing or doubled hyphens', () => {
    expect(slugify('  --Hello   world--  ')).toBe('hello-world');
  });

  it('caps the slug at 120 characters', () => {
    expect(slugify('a'.repeat(200)).length).toBeLessThanOrEqual(120);
  });
});

describe('parseTags', () => {
  it('lower-cases, trims, removes duplicates and sorts', () => {
    expect(parseTags(' Booking, calendar ,calendar, Money ')).toEqual({ tags: ['booking', 'calendar', 'money'], error: false });
  });

  it('flags more than six tags and tags with symbols', () => {
    expect(parseTags('a,b,c,d,e,f,g').error).toBe(true);
    expect(parseTags('good tag, bad_tag!').error).toBe(true);
  });
});

describe('safe links and images', () => {
  it('accepts http, https and relative links only', () => {
    expect(isSafeHref('https://mova-beauty.co/guides')).toBe(true);
    expect(isSafeHref('/guides/booth-rent')).toBe(true);
    expect(isSafeHref('javascript:alert(1)')).toBe(false);
    expect(isSafeHref('//evil.example.com')).toBe(false);
    expect(isSafeHref('   ')).toBe(false);
  });

  it('requires alt text and https for images', () => {
    const blocks: Block[] = [{ type: 'image', url: 'http://images.example.com/a.jpg', alt: '' }];
    const messages = bodyProblems(blocks).map((problem) => problem.message);
    expect(messages).toContain('Image links must start with https://.');
    expect(messages).toContain('Every image needs alt text that describes it.');
  });

  it('reports the block that is wrong', () => {
    const blocks: Block[] = [{ type: 'divider' }, { type: 'paragraph', content: [{ text: 'x', href: 'javascript:void(0)' }] }];
    expect(bodyProblems(blocks)).toEqual([{ index: 1, message: 'Add text to this paragraph, or remove it.' }]);
  });
});

describe('draftErrors', () => {
  it('passes a complete draft as a draft', () => {
    expect(hasErrors(draftErrors(filledDraft(), 'draft', null, now))).toBe(false);
  });

  it('needs a category, summary and body before publishing', () => {
    const errors = draftErrors(filledDraft({ category: null, summary: '', body: [] }), 'publish', null, now);
    expect(errors.category).toBeDefined();
    expect(errors.summary).toBeDefined();
    expect(errors.body).toBeDefined();
  });

  it('refuses a schedule time that is missing or not later than now', () => {
    expect(draftErrors(filledDraft(), 'schedule', null, now).schedule).toBe('Pick a date and time.');
    expect(draftErrors(filledDraft(), 'schedule', new Date('2026-11-08T14:00:00.000Z'), now).schedule).toBe('Pick a time later than now.');
    expect(hasErrors(draftErrors(filledDraft(), 'schedule', new Date('2026-11-12T14:00:00.000Z'), now))).toBe(false);
  });

  it('enforces the SEO limits', () => {
    const errors = draftErrors(filledDraft({ metaTitle: 'x'.repeat(61), metaDescription: 'y'.repeat(161) }), 'draft', null, now);
    expect(errors.metaTitle).toBeDefined();
    expect(errors.metaDescription).toBeDefined();
  });
});

describe('seoChecks', () => {
  it('has eight checks and counts the ones that need work', () => {
    const checks = seoChecks(filledDraft({ metaDescription: '', ogImageUrl: '', coverUrl: '' }));
    expect(checks).toHaveLength(8);
    expect(checks.filter((check) => !check.ok).map((check) => check.id)).toEqual(['description', 'social']);
  });

  it('falls back to the title when the meta title is empty', () => {
    const check = seoChecks(filledDraft({ metaTitle: '' })).find((item) => item.id === 'title');
    expect(check?.ok).toBe(true);
  });
});

describe('draftPayload', () => {
  it('sends empty optional links as null and trims text', () => {
    const payload = draftPayload(filledDraft({ coverUrl: '  ', canonicalUrl: '', ogImageUrl: '', title: '  Title  ' }));
    expect(payload).toMatchObject({ cover_url: null, canonical_url: null, og_image_url: null, title: 'Title', noindex: false });
  });
});

describe('draftFromRecord', () => {
  it('reads the database shape into the editor state', () => {
    const draft = draftFromRecord({
      id: 'p1', slug: 'booth-rent', title: 'Booth rent', summary: 's', status: 'published', live_state: 'scheduled',
      body: [{ type: 'divider' }], category: 'Money', tags: ['money'], published_at: '2026-11-12T14:00:00.000Z',
      seo: { meta_title: 'Booth rent', meta_description: '', noindex: true },
    });
    expect(draft.liveState).toBe('scheduled');
    expect(draft.noindex).toBe(true);
    expect(draft.metaDescription).toBe('');
    expect(draft.body).toHaveLength(1);
  });
});

describe('block editing', () => {
  it('creates blocks with the fields the database expects', () => {
    expect(newBlock('heading')).toEqual({ type: 'heading', level: 2, text: '' });
    expect(newBlock('divider')).toEqual({ type: 'divider' });
  });

  it('moves and removes blocks without changing the others', () => {
    const blocks: Block[] = [{ type: 'divider' }, { type: 'heading', level: 2, text: 'A' }, { type: 'heading', level: 3, text: 'B' }];
    expect(moveBlock(blocks, 1, -1)[0]).toEqual({ type: 'heading', level: 2, text: 'A' });
    expect(moveBlock(blocks, 0, -1)).toBe(blocks);
    expect(removeBlock(blocks, 1)).toHaveLength(2);
  });

  it('estimates reading time and never returns less than a minute', () => {
    expect(readingMinutes([])).toBe(1);
    expect(readingMinutes([{ type: 'paragraph', content: [{ text: Array.from({ length: 440 }, () => 'word').join(' ') }] }])).toBe(2);
  });
});

describe('zonedWallTimeToInstant', () => {
  it('uses Eastern standard time in November', () => {
    expect(zonedWallTimeToInstant('2026-11-12', '09:00', 'America/New_York')?.toISOString()).toBe('2026-11-12T14:00:00.000Z');
  });

  it('uses Eastern daylight time in July', () => {
    expect(zonedWallTimeToInstant('2026-07-01', '09:00', 'America/New_York')?.toISOString()).toBe('2026-07-01T13:00:00.000Z');
  });

  it('returns null for malformed input', () => {
    expect(zonedWallTimeToInstant('2026-1-2', '09:00', 'America/New_York')).toBeNull();
    expect(zonedWallTimeToInstant('2026-11-12', '9am', 'America/New_York')).toBeNull();
  });
});
