import { expect, test, type Page, type Route } from '@playwright/test';
import { openOperatorPage } from './operator-session';

// Tasks 3.1 and 3.2: How you get paid (boards 16a and 16b) with mocked Edge Functions.
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-mova-artist-business-id', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (route: Route, data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify({ data, error: status >= 400 ? data : null }) });
const settings = { cash_enabled: true, other_enabled: false, zelle_available: false, platform_fee_bps: 150, salon_locations: ['Rooted Beauty Salon'] };
const row = (status: string, charges: boolean, payouts: boolean) => ({ account_type: 'standard', status, charges_enabled: charges, payouts_enabled: payouts, details_submitted: true, last_checked_at: null });

async function mock(page: Page, connected: unknown, payouts: unknown = null) {
  const saves: unknown[] = [];
  await page.route('**/functions/v1/payment-settings', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const body = route.request().postDataJSON();
    if (body.action === 'save') { saves.push(body); return json(route, { cash_enabled: body.cash_enabled, other_enabled: body.other_enabled }); }
    return json(route, settings);
  });
  await page.route('**/functions/v1/stripe-connect-onboard', (route) => route.request().method() === 'OPTIONS'
    ? route.fulfill({ status: 204, headers: cors })
    : json(route, { connected, payouts, dashboard_url: 'https://dashboard.stripe.com/test/dashboard', test_mode: true }));
  return saves;
}

const card = (page: Page) => page.locator('.mova-payment-settings__stripe');

test('TC-PAY-16A-01 not set up shows the fee and the Connect button', async ({ page }) => {
  await openOperatorPage(page, '/');
  await mock(page, null);
  await page.goto('/BID-1/settings/payments');
  await expect(page.getByRole('heading', { name: 'How you get paid' })).toBeVisible();
  await expect(card(page).getByTestId('stripe-state')).toHaveText('Not set up');
  await expect(card(page).getByText('Mova fee 1.5% per card payment')).toBeVisible();
  await expect(card(page).getByRole('button', { name: 'Connect with Stripe' })).toBeVisible();
  await expect(page.getByText('Zelle')).toHaveCount(0);
  await expect(page.getByText('Rooted Beauty Salon collects for you.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Change in Locations & hours' })).toHaveAttribute('href', '/BID-1/settings/locations');
});

test('TC-PAY-16A-02 in review explains that card payments are not on yet', async ({ page }) => {
  await openOperatorPage(page, '/');
  await mock(page, row('pending', false, false));
  await page.goto('/BID-1/settings/payments');
  await expect(card(page).getByTestId('stripe-state')).toHaveText('In review');
  await expect(card(page).getByText('Stripe is checking your details.', { exact: false })).toBeVisible();
  await expect(card(page).getByRole('button', { name: 'Continue Stripe setup' })).toBeVisible();
});

test('TC-PAY-16A-03 action needed raises an alert', async ({ page }) => {
  await openOperatorPage(page, '/');
  await mock(page, row('restricted', true, false));
  await page.goto('/BID-1/settings/payments');
  await expect(card(page).getByTestId('stripe-state')).toHaveText('Action needed');
  await expect(card(page).getByRole('alert')).toContainText('Stripe needs one more thing.');
  await expect(card(page).getByRole('button', { name: 'Fix in Stripe' })).toBeVisible();
});

test('TC-PAY-16B-01 active shows card payments, bank, schedule, See payouts and Open Stripe', async ({ page }) => {
  await openOperatorPage(page, '/');
  await mock(page, row('active', true, true), { bank_last4: '4821', bank_name: 'STRIPE TEST BANK', interval: 'weekly', weekly_anchor: 'friday', monthly_anchor: null, delay_days: 2 });
  await page.goto('/BID-1/settings/payments');
  await expect(card(page).getByTestId('stripe-state')).toHaveText('Active');
  await expect(card(page).getByText('Card payments')).toBeVisible();
  await expect(card(page).getByTestId('payout-bank')).toHaveText('Stripe Test Bank •••• 4821');
  await expect(card(page).getByTestId('payout-schedule')).toHaveText('Weekly on Friday');
  await expect(card(page).getByRole('link', { name: 'See payouts' })).toHaveAttribute('href', '/BID-1/money');
  await expect(card(page).getByRole('link', { name: 'Open Stripe' })).toHaveAttribute('href', /^https:\/\/dashboard\.stripe\.com\//);
});

test('TC-PAY-16A-04 Save stays disabled until a switch changes, then writes the settings', async ({ page }) => {
  await openOperatorPage(page, '/');
  const saves = await mock(page, null);
  await page.goto('/BID-1/settings/payments');
  const save = page.getByRole('button', { name: 'Save payment settings' });
  await expect(save).toBeDisabled();
  await page.locator('label.mova-toggle', { hasText: 'Other' }).click();
  await expect(page.getByRole('switch', { name: /Other/ })).toBeChecked();
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByRole('button', { name: 'Saved' })).toBeDisabled();
  expect(saves).toEqual([{ action: 'save', cash_enabled: true, other_enabled: true }]);
});
