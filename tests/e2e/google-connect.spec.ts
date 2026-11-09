import { expect, test, type Page, type Route } from '@playwright/test';
import { openOperatorPage } from './operator-session';

// P6 board 38b: Connect Google (one sign-in for Business Profile and Calendar). Function calls are route-mocked.
const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-mova-artist-business-id', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };

async function mockBegin(page: Page, response: { status: number; body: unknown }) {
  const actions: string[] = [];
  await page.route('**/functions/v1/calendar-google-connect', async (route: Route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const body = route.request().postDataJSON() as { action: string };
    actions.push(body.action);
    return route.fulfill({ status: response.status, contentType: 'application/json', headers, body: JSON.stringify(response.body) });
  });
  return actions;
}

test('TC-GOOGLE-38B-01 shows what Mova does with Google and opens one sign-in in a new window', async ({ page, context }) => {
  await openOperatorPage(page, '/');
  const actions = await mockBegin(page, { status: 200, body: { data: { authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=fixture' }, error: null } });
  await context.route('https://accounts.google.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<p>Sign-in fixture</p>' }));
  await page.goto('/BID-1/settings/google/connect');

  await expect(page.getByRole('heading', { name: 'Connect Google' })).toBeVisible();
  await expect(page.getByText('Keep your listing up to date')).toBeVisible();
  await expect(page.getByText('See and reply to Google reviews')).toBeVisible();
  await expect(page.getByText('Sync your Google Calendar')).toBeVisible();
  await expect(page.getByText("Opens Google's sign-in in a new window")).toBeVisible();

  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  const popup = await popupPromise;
  await expect.poll(() => popup.url()).toContain('accounts.google.com');
  expect(actions).toEqual(['begin']);
});

test('TC-GOOGLE-38B-02 explains when Google is not set up yet, and never shows a connected state', async ({ page }) => {
  await openOperatorPage(page, '/');
  const actions = await mockBegin(page, { status: 503, body: { data: { code: 'GOOGLE_CALENDAR_NOT_CONFIGURED' }, error: { code: 'GOOGLE_CALENDAR_NOT_CONFIGURED' } } });
  await page.goto('/BID-1/settings/google/connect');
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page.getByRole('alert')).toContainText("Google isn't set up yet");
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
  expect(actions).toEqual(['begin']);
});
