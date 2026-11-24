import { expect, test } from '@playwright/test';
import { mockAdminApi, fulfillJson } from './admin-session';
import { openOperatorPage } from './operator-session';

const business = 'e2500000-0000-4000-8000-000000000001';
const ends = '2030-06-22T20:00:00Z';
const closureUrl = '**/functions/v1/privacy-management';

for (const paid of [false, true]) {
  test(`stylist confirms ${paid ? 'scheduled paid' : 'immediate free'} account closure`, async ({ page }) => {
    await openOperatorPage(page, '/settings/privacy');
    const calls: string[] = [];
    await page.route(closureUrl, route => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({
        status: 204, headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'authorization, content-type, x-mova-artist-business-id',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
        },
      });
      const { action } = route.request().postDataJSON();
      calls.push(action);
      return route.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, json: {
        data: { state: action === 'preview_delete' ? 'active' : paid ? 'scheduled' : 'archived', ends_at: paid ? ends : null },
      } });
    });
    await page.getByRole('button', { name: 'Request account deletion' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(paid ? 'June 22, 2030' : 'disabled immediately');
    expect(calls).toEqual(['preview_delete']);
    await dialog.getByRole('button', { name: 'Confirm deletion request' }).click();
    if (paid) {
      await expect(page.getByRole('status')).toContainText('Deletion requested. Your access ends on June 22, 2030');
      await expect(page).toHaveURL(/settings\/privacy$/);
    } else {
      await expect(page).toHaveURL(/account-closure\?ended=1$/);
      await expect(page.getByRole('heading', { name: 'Your Mova access has ended' })).toBeVisible();
    }
    expect(calls).toEqual(['preview_delete', 'request_delete']);
  });
}

test('admin sees the request, archives, restores and must give three confirmations to delete', async ({ page }) => {
  let state: 'scheduled' | 'archived' | null = 'scheduled';
  const displayName = "D'Angelo’s Studio";
  const calls: string[] = [];
  await mockAdminApi(page, { signedIn: true, isAdmin: true, rpc: {
    mova_admin_account_closures: () => state ? [{ artist_business_id: business, display_name: displayName, business_number: 1, source: 'stylist', state, ends_at: ends }] : [],
    mova_admin_stylist_detail: () => ({
      business: { id: business, bid: 1, name: 'Demo Studio', status: state === 'archived' ? 'suspended' : 'active' },
      profile: { display_name: displayName, handle: 'demo-studio', is_published: true, preferred_locale: 'en-US' },
      plan: { name: 'Free' }, metrics: {}, fee: {}, overrides: [], feedback: [],
    }),
    mova_admin_stylists: () => ({ stylists: [], total: 0, counts: {} }),
  } });
  await page.route(closureUrl, route => {
    if (route.request().method() === 'OPTIONS') return fulfillJson(route, null);
    const body = route.request().postDataJSON();
    calls.push(body.action);
    if (body.action === 'delete') expect(body).toMatchObject({ display_name: displayName, confirm_delete_forever: true });
    state = body.action === 'archive' ? 'archived' : null;
    return fulfillJson(route, { data: {} });
  });
  await page.goto(`/admin/stylists/${business}`);
  await expect(page.getByRole('heading', { name: 'Stylist deletion requests' })).toBeVisible();
  await page.getByRole('button', { name: 'Archive account', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Archive account' }).click();
  await expect(page.getByText('Account archived.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Restore archived account' }).click();
  await dialog.getByRole('button', { name: 'Restore account' }).click();
  await expect(page.getByText('Account restored.', { exact: true })).toBeVisible();

  async function reachName() {
    await page.getByRole('button', { name: 'Permanently delete account' }).click();
    await expect(dialog.getByRole('heading')).toHaveText('Are you sure?');
    await dialog.getByRole('button', { name: 'Continue' }).click();
  }
  await reachName();
  await dialog.getByLabel('Stylist display name').fill('Wrong name');
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await expect(dialog).toContainText('The name must match');
  await dialog.getByLabel('Stylist display name').fill(displayName);
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await expect(dialog.getByRole('heading')).toHaveText('Delete this account forever?');
  await dialog.getByRole('button', { name: 'Nevermind' }).click();
  expect(calls).toEqual(['archive', 'restore']);
  await reachName();
  await dialog.getByLabel('Stylist display name').fill(displayName);
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await dialog.getByRole('button', { name: 'Delete forever' }).click();
  await expect(page).toHaveURL('/admin/stylists');
  expect(calls).toEqual(['archive', 'restore', 'delete']);
});

test('farewell email links accept optional feedback and require a click to reactivate', async ({ page }) => {
  const actions: string[] = [];
  await page.route(closureUrl, route => {
    if (route.request().method() === 'OPTIONS') return fulfillJson(route, null);
    const body = route.request().postDataJSON();
    expect(body.token).toBe('local-email-test-token');
    actions.push(body.action);
    return fulfillJson(route, { data: { restored: true, saved: true } });
  });
  await page.goto('/account-closure?mode=feedback#local-email-test-token');
  await expect(page.getByRole('button', { name: 'Send feedback' })).toBeDisabled();
  await page.getByLabel('Reason for leaving').selectOption('features');
  await page.getByLabel('Comment').fill('I needed a feature that is not available yet.');
  await page.getByRole('button', { name: 'Send feedback' }).click();
  await expect(page.getByRole('status')).toHaveText('Thanks for telling us about your experience.');

  await page.goto('/account-closure?mode=reactivate#local-email-test-token');
  expect(actions).toEqual(['feedback']);
  await page.getByRole('button', { name: 'Reactivate your account' }).click();
  await expect(page.getByRole('status')).toContainText('Your account was restored.');
  await expect(page.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  expect(actions).toEqual(['feedback', 'reactivate']);
});
