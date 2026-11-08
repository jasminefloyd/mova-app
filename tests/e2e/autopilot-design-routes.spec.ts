import { expect, test } from '@playwright/test';
import { openOperatorPage } from './operator-session';

test('the approved autopilot messages path redirects to the existing template editor', async ({ page }) => {
  await openOperatorPage(page, '/growth/autopilot/messages');
  await expect(page).toHaveURL(/\/BID-1\/growth\/templates$/);
  await expect(page.getByRole('heading', { name: 'Approved messages' })).toBeVisible();
});

test('the approved autopilot activity path redirects to the existing activity view', async ({ page }) => {
  await openOperatorPage(page, '/growth/autopilot/activity');
  await expect(page).toHaveURL(/\/BID-1\/growth\/activity$/);
  await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible();
});
