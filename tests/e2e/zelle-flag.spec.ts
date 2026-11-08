import { expect, test } from '@playwright/test';
import { openOperatorPage } from './operator-session';

const businessId = 'e2500000-0000-4000-8000-000000000001';
const appointment = {
  id: 'e2500000-0000-4000-8000-000000000400',
  appointment_number: 1,
  status: 'confirmed',
  starts_at: '2026-12-01T15:00:00.000Z',
  service_name_snapshot: 'Silk Press',
  service_price_minor: 12000,
  balance_due_minor: 8000,
  client_name: 'Alex Rivera',
  location_id: 'e2500000-0000-4000-8000-000000000101',
  artist_business_id: businessId,
};

test('A-16 hides Zelle and maps old records to Other in payment surfaces for EN and ES', async ({ page }) => {
  await openOperatorPage(page, '/settings');
  await page.route('**/rest/v1/mova_appointments?*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'Content-Range': '0-0/1' },
    body: JSON.stringify(appointment),
  }));
  await page.route('**/rest/v1/mova_locations?*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'Content-Range': '0-0/1' },
    body: JSON.stringify({ name: 'Rooted Studio', payment_collector: 'artist', time_zone: 'America/New_York' }),
  }));
  await page.route('**/rest/v1/mova_stripe_connections?*', route => route.fulfill({
    status: 200, contentType: 'application/json', headers: { 'Content-Range': '0-0/0' }, body: 'null',
  }));
  await page.route('**/rest/v1/mova_payment_method_settings?*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'Content-Range': '0-0/1' },
    body: JSON.stringify({ cash_enabled: true, other_enabled: true }),
  }));
  await page.route('**/functions/v1/money-summary', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      data: {
        totals: { service_value_minor: 10000, mova_processed_minor: 0, recorded_by_artist_minor: 10000, collected_by_salon_minor: 0, mova_platform_fee_minor: 0, processor_fee_minor: 0, refunds_minor: 0, estimated_to_artist_minor: 10000 },
        activity: [{ id: 'legacy-zelle-record', category: 'recorded_artist', amount_minor: 10000, created_at: '2026-11-06T12:00:00.000Z', client_name: 'Alex Rivera', service_name: 'Silk Press', payment_method: 'zelle_recorded' }],
      }, error: null, request_id: 'a16-legacy-record-fixture',
    }),
  }));

  const assertNoZelle = async () => expect(page.locator('body')).not.toContainText(/zelle/i);
  await page.goto('/BID-1/settings/payments');
  await assertNoZelle();
  await page.goto('/BID-1/appointments/AID-1/pay');
  await expect(page.getByRole('heading', { level: 1, name: 'Get paid' })).toBeVisible();
  await assertNoZelle();
  await page.goto('/BID-1/money');
  await assertNoZelle();
  await expect(page.getByRole('listitem').filter({ hasText: 'Alex Rivera' })).toContainText('Other');
  await page.goto('/BID-1/reports');
  await assertNoZelle();

  await page.goto('/BID-1/settings');
  await page.getByRole('button', { name: /Language & notifications/ }).click();
  await page.getByRole('combobox', { name: 'Language' }).selectOption('es-US');
  await expect(page.locator('html')).toHaveAttribute('lang', 'es-US');
  await page.goto('/BID-1/settings/payments');
  await assertNoZelle();
  await page.goto('/BID-1/appointments/AID-1/pay');
  await assertNoZelle();
  await page.goto('/BID-1/money');
  await assertNoZelle();
  await expect(page.getByRole('listitem').filter({ hasText: 'Alex Rivera' })).toContainText('Otro');
  await page.goto('/BID-1/reports');
  await assertNoZelle();
});
