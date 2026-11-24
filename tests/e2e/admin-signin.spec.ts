import { expect, test, type Page } from '@playwright/test';
import { mockAdminApi } from './admin-session';


async function verifyEmail(page: Page, email: string) {
  await page.getByLabel('Work email').fill(email);
  await page.getByRole('button', { name: 'Email me a sign-in code' }).click();
  for (const [i, digit] of [...'123456'].entries()) await page.getByLabel(`Email code, digit ${i + 1}`).fill(digit);
  await page.getByRole('button', { name: 'Verify email' }).click();
}

test.describe('admin sign-in gate', () => {
  test('retries a missing admin JavaScript chunk once without clearing site data', async ({ page }) => {
    await mockAdminApi(page, { signedIn: false, isAdmin: false });
    let freshDocument = false;
    let recoveries = 0;
    await page.route('**/admin/signin?**', async route => {
      const url = new URL(route.request().url());
      if (url.searchParams.has('__mova_reload')) {
        freshDocument = true;
        recoveries++;
      }
      await route.continue();
    });
    await page.route('**/assets/entry.client-*.js', async route => {
      if (freshDocument) return route.continue();
      await route.fulfill({ status: 404, headers: { 'Cache-Control': 'no-store' }, body: '' });
    });
    await page.goto('/admin/signin?email=staff%40mova.invalid', { waitUntil: 'commit' }).catch(() => undefined);
    await expect.poll(() => recoveries).toBe(1);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Email me a sign-in code' })).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/signin\?email=staff%40mova.invalid$/);
  });

  test('admin documents request no HTTP caching', async ({ request }) => {
    const response = await request.get('/admin/signin');
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toBe('private, no-store');
  });

  test('sends a signed-out visitor to sign-in and keeps the return address', async ({ page }) => {
    await mockAdminApi(page, { signedIn: false, isAdmin: false });
    await page.goto('/admin/stylists');
    await expect(page).toHaveURL(/\/admin\/signin\?returnTo=%2Fadmin%2Fstylists/);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });

  test('refuses a signed-in account that is not on the admin roster', async ({ page }) => {
    await mockAdminApi(page, { signedIn: false, isAdmin: false });
    await page.goto('/admin/signin');
    await verifyEmail(page, 'owner@example.invalid');
    await expect(page.getByRole('status')).toHaveText('This account does not have System Admin access.');
    await expect(page).toHaveURL(/\/admin\/signin/);
  });

  test('lets a rostered admin through with only the email code and records the sign-in', async ({ page }) => {
    const auditEntries: unknown[] = [];
    const factorRequests: string[] = [];
    page.on('request', request => {
      if (request.url().includes('/auth/v1/factors')) factorRequests.push(request.url());
    });
    await mockAdminApi(page, {
      signedIn: false,
      isAdmin: true,
      rpc: {
        mova_admin_record_sign_in: body => { auditEntries.push(body); return null; },
        mova_admin_stylists: () => ({ stylists: [], total: 0, counts: { all: 0, active: 0, onboarding: 0, quiet: 0, restricted: 0, suspended: 0 } }),
      },
    });
    await page.goto('/admin/signin?returnTo=%2Fadmin%2Fstylists');
    await verifyEmail(page, 'staff@mova.invalid');
    await expect(page).toHaveURL(/\/admin\/stylists$/);
    await expect(page.getByRole('heading', { name: 'Stylists' })).toBeVisible();
    expect(auditEntries).toEqual([{ p_device: expect.any(String) }]);
    expect(factorRequests).toEqual([]);
  });
});
