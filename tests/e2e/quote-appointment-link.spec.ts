import { expect, test } from '@playwright/test';
import { openOperatorPage } from './operator-session';

test('a booked quote opens its linked appointment', async ({ page }) => {
  await openOperatorPage(page, '/growth/concierge/quotes/e2500000-0000-4000-8000-000000000030');
  const link = page.getByRole('link', { name: 'View linked appointment' });
  await expect(link).toHaveAttribute('href', '/BID-1/appointments/AID-1');
});
