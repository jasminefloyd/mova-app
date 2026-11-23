import { expect, test } from '@playwright/test';
import { openOperatorPage } from './operator-session';

const fixtureBusinessId = 'e2500000-0000-4000-8000-000000000001';

test('the Revenue Center exposes read-only Concierge only to the review workspace', async ({ page }) => {
  await openOperatorPage(page, '/growth');
  const link = page.getByRole('link', { name: /Concierge/ });
  if (process.env.VITE_CONCIERGE_REVIEW_BUSINESS_ID === fixtureBusinessId && process.env.VITE_AI_CONCIERGE_ENABLED !== 'true') {
    await page.route('**/functions/v1/concierge-artist', (route) => {
      const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, x-mova-artist-business-id', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      expect(route.request().postDataJSON()).toEqual({ action: 'status' });
      return route.fulfill({ headers, json: { data: {
        settings: { enabled: false, globally_paused: true, channels: {}, permissions: {} },
        conversations: [], handoffs: [], knowledge: [{ id: 'faq-1', kind: 'prep', question: 'How should I prep?', answer_en: 'Only braid on clean hair.', status: 'draft' }],
        aiEnabled: false,
      } } });
    });
    await expect(link).toHaveAttribute('href', '/BID-1/growth/concierge');
    await link.click();
    await expect(page.getByRole('heading', { name: 'AI Concierge', exact: true })).toBeVisible();
    await expect(page.getByText('Read-only review. Automated replies are paused.')).toBeVisible();
    await page.getByRole('link', { name: 'Teach it' }).click();
    await expect(page.getByRole('heading', { name: 'Teach your concierge' })).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Reschedule within your policy' })).toBeDisabled();
    await page.getByRole('button', { name: /FAQs & how to prep/ }).click();
    await expect(page.getByText('Only braid on clean hair.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save information' })).toHaveCount(0);
  } else if (process.env.VITE_AI_CONCIERGE_ENABLED !== 'true') {
    await expect(link).toHaveCount(0);
    await page.goto('/BID-1/growth/concierge/setup');
    await expect(page).toHaveURL(/\/BID-1\/growth$/);
  }
});
