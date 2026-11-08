import { expect, test, type Page } from '@playwright/test';
import { openOperatorPage } from './operator-session';

// Task 3.3: Edit your profile (board 16c) with mocked tables and RPC.
const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, accept-profile, content-profile, prefer', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Content-Range': '0-0/1' };
const profile = { display_name: 'Rooted Beauty', bio: 'Healthy-hair specialist.', specialties: ['Silk press', 'Braids'], handle: 'rooted-beauty', preferred_locale: 'en-US', profile_photo_path: null, cover_photo_path: null };

async function mock(page: Page, rpcError: string | null = null) {
  const calls: Record<string, unknown>[] = [];
  await page.route('**/rest/v1/mova_artist_profiles?*', (route) => route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify(profile) }));
  await page.route('**/rest/v1/mova_portfolio_items?*', (route) => route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify([{ media_path: 'x/1.jpg', is_published: true, sort_order: 0 }, { media_path: 'x/2.jpg', is_published: false, sort_order: 1 }]) }));
  await page.route('**/storage/v1/object/sign/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify({ signedURL: '/object/sign/fixture.jpg?token=x' }) }));
  await page.route('**/rest/v1/rpc/mova_update_artist_profile', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    calls.push(route.request().postDataJSON());
    return rpcError
      ? route.fulfill({ status: 409, contentType: 'application/json', headers, body: JSON.stringify({ code: '23505', message: rpcError, details: null, hint: null }) })
      : route.fulfill({ status: 200, contentType: 'application/json', headers, body: 'null' });
  });
  return calls;
}

test('TC-PROFILE-16C-01 edits each field and saves once something changes', async ({ page }) => {
  await openOperatorPage(page, '/');
  const calls = await mock(page);
  await page.goto('/BID-1/settings/profile');
  const save = page.getByRole('button', { name: 'Save profile' });
  await expect(save).toBeDisabled();
  await expect(page.getByText("Changing it breaks links and QR codes you've already shared.")).toBeVisible();
  await expect(page.getByRole('link', { name: 'Preview' })).toHaveAttribute('href', '/BID-1/settings/profile/preview');
  await expect(page.getByText('2 looks · 1 on your page')).toBeVisible();
  await page.getByLabel('Name clients see').fill('Rooted Beauty Studio');
  await page.getByLabel('Your link').fill('rooted-studio');
  await expect(page.getByText("Saving this new link breaks links and QR codes you've already shared.")).toBeVisible();
  await page.getByLabel('About you').fill('Silk presses and braids.');
  await expect(page.getByText('24/280')).toBeVisible();
  await page.getByRole('button', { name: 'Locs' }).click();
  await page.getByRole('button', { name: 'Braids' }).click();
  await expect(save).toBeEnabled();
  await save.click();
  await expect.poll(() => calls.length).toBe(1);
  expect(calls[0]).toMatchObject({ p_display_name: 'Rooted Beauty Studio', p_handle: 'rooted-studio', p_bio: 'Silk presses and braids.', p_specialties: ['Silk press', 'Locs'] });
});

test('TC-PROFILE-16C-02 greys out other specialties at five', async ({ page }) => {
  await openOperatorPage(page, '/');
  await mock(page);
  await page.goto('/BID-1/settings/profile');
  for (const name of ['Natural hair', 'Locs', 'Color']) await page.getByRole('button', { name }).click();
  await expect(page.getByText('(5 of 5)')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Kids' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Locs' })).toBeEnabled();
});

for (const [code, en, es] of [
  ['HANDLE_RESERVED', 'That link is reserved. Choose another.', 'Ese enlace está reservado. Elige otro.'],
  ['HANDLE_TAKEN', 'That link is already in use. Choose another.', 'Ese enlace ya está en uso. Elige otro.'],
] as const) {
  for (const [locale, message] of [['en-US', en], ['es-US', es]] as const) {
    test(`TC-PROFILE-16C-03 ${code} shows an error in ${locale}`, async ({ page }) => {
      await page.addInitScript((loc) => { for (const key of ['mova.locale', 'mova_artist_locale', 'i18nextLng']) localStorage.setItem(key, loc); }, locale);
      await openOperatorPage(page, '/');
      await mock(page, code);
      await page.goto('/BID-1/settings/profile');
      const handle = page.locator('.mova-profile-edit__handle input');
      await handle.fill('book');
      await page.locator('.mova-profile-edit__actions button').click();
      await expect(page.getByRole('alert')).toHaveText(message);
      await expect(handle).toHaveAttribute('aria-invalid', 'true');
    });
  }
}
