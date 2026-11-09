import { expect, test } from '@playwright/test';
import { mockAdminApi } from './admin-session';

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
    await page.getByLabel('Work email').fill('owner@example.invalid');
    await page.getByLabel('Password').fill('not-a-real-password');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'Enter your code' })).toBeVisible();
    await page.getByLabel('6-digit code').fill('123456');
    await page.getByRole('button', { name: 'Verify and sign in' }).click();
    await expect(page.getByRole('alert')).toHaveText('This account does not have admin access.');
    await expect(page).toHaveURL(/\/admin\/signin/);
  });

  test('lets a platform admin through after the authenticator code', async ({ page }) => {
    await mockAdminApi(page, {
      signedIn: false,
      isAdmin: true,
      rpc: { mova_admin_stylists: () => ({ stylists: [], total: 0, counts: { all: 0, active: 0, onboarding: 0, quiet: 0, restricted: 0, suspended: 0 } }) },
    });
    await page.goto('/admin/signin?returnTo=%2Fadmin%2Fstylists');
    await page.getByLabel('Work email').fill('staff@mova.invalid');
    await page.getByLabel('Password').fill('playwright-password');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('6-digit code').fill('123456');
    await page.getByRole('button', { name: 'Verify and sign in' }).click();
    await expect(page).toHaveURL(/\/admin\/stylists$/);
    await expect(page.getByRole('heading', { name: 'Stylists' })).toBeVisible();
  });
});
