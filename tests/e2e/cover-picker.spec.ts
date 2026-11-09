import { expect, test, type Page, type Route } from '@playwright/test';
import { openOperatorPage } from './operator-session';
// The sample photos come from the real fake provider, so this spec checks the same data the sandbox returns.
import { sampleSearch } from '../../supabase/functions/_shared/providers/unsplash/fake.ts';
import { UNSPLASH_HOME } from '../../supabase/functions/_shared/providers/unsplash/attribution.ts';

// P6 board 16f: Unsplash cover picker. The profile-cover function is route-mocked with the fake provider's output.
const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-mova-artist-business-id', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };

// Only the fields the browser may see: the server-only download location is left out, as in the function.
function publicPhotos(query: string) {
  return sampleSearch(query).map((photo) => ({ id: photo.id, alt: photo.alt, thumbUrl: photo.thumbUrl, imageUrl: photo.imageUrl, photographerName: photo.photographerName, photographerUrl: photo.photographerUrl, photoUrl: photo.photoUrl }));
}

async function mockCover(page: Page, options: { searchError?: boolean } = {}) {
  const calls: Array<Record<string, unknown>> = [];
  await page.route('**/functions/v1/profile-cover', async (route: Route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const body = route.request().postDataJSON() as Record<string, unknown>;
    calls.push(body);
    if (body.action === 'search') {
      if (options.searchError) return route.fulfill({ status: 502, contentType: 'application/json', headers, body: JSON.stringify({ data: { code: 'UNSPLASH_SEARCH_FAILED' }, error: { code: 'UNSPLASH_SEARCH_FAILED' } }) });
      return route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify({ data: { photos: publicPhotos(String(body.query)), provider: 'fake', live: false }, error: null }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify({ data: { cover: { source: 'unsplash' } }, error: null }) });
  });
  return calls;
}

const savedProfile = {
  display_name: 'Rooted Beauty', bio: 'Healthy-hair specialist.', specialties: ['Silk press'], handle: 'rooted-beauty', preferred_locale: 'en-US',
  profile_photo_path: null, cover_photo_path: null, cover_source: 'unsplash',
  cover_image_url: 'https://images.unsplash.com/photo-mova-sample-botanical-2?w=1200&q=80',
  cover_credit_name: 'Sample photographer 2 (sample)', cover_credit_url: UNSPLASH_HOME, cover_unsplash_url: UNSPLASH_HOME,
};

async function mockProfile(page: Page) {
  await page.route('**/rest/v1/mova_artist_profiles?*', (route) => route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify(savedProfile) }));
  await page.route('**/rest/v1/mova_portfolio_items?*', (route) => route.fulfill({ status: 200, contentType: 'application/json', headers, body: '[]' }));
}

test('TC-COVER-16F-01 searches free photos, shows six with credit, and uses the chosen cover', async ({ page }) => {
  await openOperatorPage(page, '/');
  const calls = await mockCover(page);
  await mockProfile(page);
  await page.goto('/BID-1/settings/profile/cover');

  const photos = page.getByRole('radio');
  await expect(photos).toHaveCount(6);
  await expect(page.getByRole('button', { name: 'Use this cover' })).toBeDisabled();
  await expect(page.getByText('Sample photos from the sandbox. They are not real Unsplash photos.')).toBeVisible();

  await page.getByRole('radio', { name: 'Photo 2: Sample photographer 2 (sample)' }).check({ force: true });
  const credit = page.getByRole('link', { name: 'Sample photographer 2 (sample)' });
  await expect(credit).toHaveAttribute('href', /unsplash\.com.*utm_source=mova&utm_medium=referral/);
  await expect(page.getByRole('link', { name: 'Unsplash' }).first()).toHaveAttribute('href', /utm_medium=referral/);

  await page.getByRole('button', { name: 'Use this cover' }).click();
  await expect(page).toHaveURL(/\/BID-1\/settings\/profile$/);
  expect(calls.filter((call) => call.action === 'use')).toEqual([{ action: 'use', photo_id: 'mova-sample-botanical-2' }]);
  await expect(page.getByText('Photo:').first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sample photographer 2 (sample)' })).toHaveAttribute('target', '_blank');
});

test('TC-COVER-16F-02 idea chips search again, and the page does not scroll sideways at 320 px', async ({ page }) => {
  await openOperatorPage(page, '/');
  const calls = await mockCover(page);
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/BID-1/settings/profile/cover');
  await expect(page.getByRole('radio')).toHaveCount(6);
  await page.getByRole('button', { name: 'Warm neutrals' }).click();
  await expect(page.getByRole('button', { name: 'Warm neutrals' })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => calls.filter((call) => call.action === 'search').at(-1)?.query).toBe('warm neutrals');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('TC-COVER-16F-03 says so when free photos are not set up, and when a search fails it offers a retry', async ({ page }) => {
  await openOperatorPage(page, '/');
  await page.route('**/functions/v1/profile-cover', (route: Route) => route.fulfill({ status: 503, contentType: 'application/json', headers, body: JSON.stringify({ data: { code: 'UNSPLASH_NOT_CONFIGURED' }, error: { code: 'UNSPLASH_NOT_CONFIGURED' } }) }));
  await page.goto('/BID-1/settings/profile/cover');
  await expect(page.getByText("Free photos aren't set up yet. You can still upload your own cover.")).toBeVisible();
  await expect(page.getByRole('radio')).toHaveCount(0);
});
