import { expect, test, type Page } from '@playwright/test';
import { mockAdminApi } from './admin-session';


async function verifyEmail(page: Page, email: string) {
  await page.getByLabel('Work email').fill(email);
  await page.getByRole('button', { name: 'Email me a sign-in code' }).click();
  for (const [i, digit] of [...'123456'].entries()) await page.getByLabel(`Email code, digit ${i + 1}`).fill(digit);
  await page.getByRole('button', { name: 'Verify email' }).click();
}

test.describe('admin sign-in gate', () => {
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

  test('lets a platform admin through after the authenticator code', async ({ page }) => {
    await mockAdminApi(page, {
      signedIn: false,
      isAdmin: true,
      rpc: { mova_admin_stylists: () => ({ stylists: [], total: 0, counts: { all: 0, active: 0, onboarding: 0, quiet: 0, restricted: 0, suspended: 0 } }) },
    });
    await page.goto('/admin/signin?returnTo=%2Fadmin%2Fstylists');
    await verifyEmail(page, 'staff@mova.invalid');
    await expect(page.getByRole('heading', { name: 'Authenticator code' })).toBeVisible();
    for (const [i, digit] of [...'123456'].entries()) await page.getByLabel(`Authenticator code, digit ${i + 1}`).fill(digit);
    await page.getByRole('button', { name: 'Verify and sign in' }).click();
    await expect(page).toHaveURL(/\/admin\/stylists$/);
    await expect(page.getByRole('heading', { name: 'Stylists' })).toBeVisible();
  });
});
