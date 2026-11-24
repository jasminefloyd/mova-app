import { expect, test } from '@playwright/test';
import { mockAdminApi } from './admin-session';

type Post = Record<string, unknown>;
const categories = ['Booking', 'Clients', 'Money', 'Going independent'];

/** An in-memory guide store behind the blog functions, so create, schedule and publish can be checked in order. */
function blogStore() {
  let post: Post | null = null;
  const modes: string[] = [];
  const record = (fields: Record<string, unknown>, mode: string, publishAt: string | null): Post => {
    const now = Date.now();
    const publishedAt = mode === 'draft' ? null : mode === 'schedule' ? publishAt : new Date(now).toISOString();
    const live = mode === 'draft' ? 'draft' : publishedAt && Date.parse(publishedAt) > now ? 'scheduled' : 'published';
    return {
      id: 'b0000000-0000-4000-8000-000000000001', slug: fields['slug'], title: fields['title'], summary: fields['summary'],
      status: mode === 'draft' ? 'draft' : 'published', live_state: live, body: fields['body'], category: fields['category'],
      tags: fields['tags'], cover_url: fields['cover_url'], cover_alt: fields['cover_alt'], cover_credit: fields['cover_credit'],
      author_name: fields['author_name'], reading_minutes: 2,
      seo: { meta_title: fields['meta_title'], meta_description: fields['meta_description'], canonical_url: fields['canonical_url'], og_title: fields['og_title'], og_description: fields['og_description'], og_image_url: fields['og_image_url'], noindex: fields['noindex'] },
      published_at: publishedAt, created_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString(),
    };
  };
  return {
    modes,
    current: () => post,
    rpc: {
      mova_admin_blog_save: (body: Record<string, unknown>) => {
        const mode = String(body['p_mode']);
        modes.push(mode);
        post = record(body['p_fields'] as Record<string, unknown>, mode, (body['p_publish_at'] as string | null) ?? null);
        return post;
      },
      mova_admin_blog_get: () => ({ post, categories }),
      mova_admin_blog_list: () => ({
        posts: post ? [{ id: post['id'], slug: post['slug'], title: post['title'], status: post['status'], live_state: post['live_state'], published_at: post['published_at'], updated_at: post['updated_at'], category: post['category'], tags: post['tags'], missing_meta_description: false }] : [],
        filtered_total: post ? 1 : 0,
        counts: { all: post ? 1 : 0, published: 0, scheduled: 0, drafts: post ? 1 : 0 },
        summary: { missing_meta_description: 0, next_scheduled: null },
        categories,
      }),
    },
  };
}

test.describe('guides writer', () => {
  test('creates a draft, schedules it, then publishes it', async ({ page }) => {
    const store = blogStore();
    await mockAdminApi(page, { signedIn: true, isAdmin: true, rpc: store.rpc });

    await page.goto('/admin/blog/new');
    await page.getByLabel('Title', { exact: true }).fill('Booth rent is only one line on the bill');
    await page.getByRole('button', { name: 'From title' }).click();
    await page.getByLabel(/^Summary/).fill('What a stylist pays beyond the booth rent, and how to plan for it.');
    await page.getByLabel('Category').selectOption('Money');
    await page.getByRole('textbox', { name: 'Guide body' }).click();
    await page.keyboard.type('Most stylists count only the booth rent. Supplies, insurance and card fees add up.');

    await page.getByRole('button', { name: 'Save draft' }).first().click();
    await expect(page.getByText('Draft saved.')).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/blog\/b0000000-0000-4000-8000-000000000001$/);
    expect(store.modes).toEqual(['draft']);
    await expect(page.getByLabel('Public guide link')).toHaveCount(0);

    await page.getByRole('button', { name: 'Schedule' }).click();
    await expect(page.getByText(/Scheduled for .* Eastern\./)).toBeVisible();
    expect(store.modes).toEqual(['draft', 'schedule']);
    const scheduled = store.current();
    expect(scheduled?.['live_state']).toBe('scheduled');
    await expect(page.getByLabel('Public guide link')).toHaveCount(0);
    expect(Date.parse(String(scheduled?.['published_at']))).toBeGreaterThan(Date.now());

    await page.getByRole('button', { name: 'Publish now' }).click();
    await expect(page.getByText('Published. The guide is live now.')).toBeVisible();
    expect(store.modes).toEqual(['draft', 'schedule', 'publish']);
    expect(store.current()?.['live_state']).toBe('published');
    const trackedUrl = 'https://mova-beauty.co/guides/booth-rent-is-only-one-line-on-the-bill';
    await expect(page.getByLabel('Public guide link')).toHaveValue(trackedUrl);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.getByRole('button', { name: 'Copy guide link' }).click();
    await expect(page.getByText('Link copied.')).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(trackedUrl);
    await page.getByLabel('Web address (slug)').fill('unsaved-change');
    await expect(page.getByLabel('Public guide link')).toHaveValue(trackedUrl);

    await page.goto('/admin/blog');
    await expect(page.getByRole('link', { name: 'Booth rent is only one line on the bill' })).toBeVisible();
  });

  test('blocks publishing without a category and shows the field error', async ({ page }) => {
    const store = blogStore();
    await mockAdminApi(page, { signedIn: true, isAdmin: true, rpc: store.rpc });
    await page.goto('/admin/blog/new');
    await page.getByLabel('Title', { exact: true }).fill('A guide without a category');
    await page.getByRole('button', { name: 'From title' }).click();
    await page.getByLabel(/^Summary/).fill('Summary text.');
    await page.getByRole('textbox', { name: 'Guide body' }).click();
    await page.keyboard.type('Body text.');
    await page.getByRole('button', { name: 'Publish now' }).click();
    await expect(page.getByText('Choose a category before publishing.')).toBeVisible();
    expect(store.modes).toEqual([]);
  });

  test('A13·v2 body editor: markdown, the "/" menu, an FAQ and image alt text are saved as blocks', async ({ page }) => {
    const store = blogStore();
    await mockAdminApi(page, { signedIn: true, isAdmin: true, rpc: store.rpc });
    await page.goto('/admin/blog/new');
    await page.getByLabel('Title', { exact: true }).fill('Pricing a loc retwist');
    await page.getByRole('button', { name: 'From title' }).click();
    const body = page.getByRole('textbox', { name: 'Guide body' });
    await body.click();
    await page.keyboard.type('## Start with your time');
    await page.keyboard.press('Enter');
    await page.keyboard.type('A retwist takes two to three hours.');
    await page.keyboard.press('Enter');
    await page.keyboard.type('/faq');
    const menu = page.getByRole('menu', { name: 'Add a block' });
    await expect(menu.getByRole('menuitem', { name: /FAQ/ })).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(menu).toHaveCount(0);
    await page.keyboard.type('How long does it take?');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Usually two to three hours.');

    // Insert an image from the toolbar; it is flagged until it has alt text.
    await page.getByRole('button', { name: 'Insert' }).click();
    await page.getByRole('menu', { name: 'Insert a block' }).getByRole('menuitem', { name: /^Image/ }).click();
    const bodyCard = page.getByRole('region', { name: 'Body' });
    await bodyCard.getByLabel('Image link (https://)').fill('https://images.example/retwist.jpg');
    await expect(bodyCard.getByText('Add alt text', { exact: true })).toBeVisible();
    await expect(page.getByText('1 image in the body is missing alt text')).toBeVisible();
    await bodyCard.getByLabel('Alt text', { exact: true }).fill('Stylist retwisting locs');
    await expect(page.getByText('Images in the body have alt text')).toBeVisible();

    await page.getByRole('button', { name: 'Save draft' }).first().click();
    await expect(page.getByText('Draft saved.')).toBeVisible();
    const saved = store.current()?.['body'] as Array<Record<string, unknown>>;
    expect(saved.map((block) => block['type'])).toEqual(['heading', 'paragraph', 'faq', 'image']);
    expect(saved[0]).toEqual({ type: 'heading', level: 2, text: 'Start with your time' });
    expect(saved[2]).toEqual({ type: 'faq', items: [{ question: 'How long does it take?', answer: [{ text: 'Usually two to three hours.' }] }] });
    expect(saved[3]).toEqual({ type: 'image', url: 'https://images.example/retwist.jpg', alt: 'Stylist retwisting locs' });
  });
});
