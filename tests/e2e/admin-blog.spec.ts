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
    await page.getByRole('button', { name: '+ Paragraph' }).click();
    await page.getByLabel('Text', { exact: true }).fill('Most stylists count only the booth rent. Supplies, insurance and card fees add up.');

    await page.getByRole('button', { name: 'Save draft' }).first().click();
    await expect(page.getByText('Draft saved.')).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/blog\/b0000000-0000-4000-8000-000000000001$/);
    expect(store.modes).toEqual(['draft']);

    await page.getByRole('button', { name: 'Schedule' }).click();
    await expect(page.getByText(/Scheduled for .* Eastern\./)).toBeVisible();
    expect(store.modes).toEqual(['draft', 'schedule']);
    const scheduled = store.current();
    expect(scheduled?.['live_state']).toBe('scheduled');
    expect(Date.parse(String(scheduled?.['published_at']))).toBeGreaterThan(Date.now());

    await page.getByRole('button', { name: 'Publish now' }).click();
    await expect(page.getByText('Published. The guide is live now.')).toBeVisible();
    expect(store.modes).toEqual(['draft', 'schedule', 'publish']);
    expect(store.current()?.['live_state']).toBe('published');

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
    await page.getByRole('button', { name: '+ Paragraph' }).click();
    await page.getByLabel('Text', { exact: true }).fill('Body text.');
    await page.getByRole('button', { name: 'Publish now' }).click();
    await expect(page.getByText('Choose a category before publishing.')).toBeVisible();
    expect(store.modes).toEqual([]);
  });
});
