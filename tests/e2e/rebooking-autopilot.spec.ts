import { expect, test, type Page, type Route } from '@playwright/test';
import { openOperatorPage } from './operator-session';

// Tasks 5.2 and 5.3: the autopilot switch and rules (34), and manual win-back sends (33), mocked.
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-mova-artist-business-id', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (route: Route, data: unknown) => route.request().method() === 'OPTIONS' ? route.fulfill({ status: 204, headers: cors }) : route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ data, error: null }) });
const state = (outbound: boolean, enabled = false) => ({
  pipeline: [], decisions: [], counts: { due: 0, contacted: 0, rebooked: 0, winback: 1 }, outboundEnabled: outbound,
  settings: { enabled, slot_texts_autopilot: true, rules: { daily_cap: 10, per_client_days: 14 } },
  winback: [{ id: 'opp-1', status: 'due', client: { display_name: 'Lena Moss', preferred_locale: 'en-US' }, last_visit_at: '2026-06-01T15:00:00Z' }],
});
async function mock(page: Page, outbound: boolean) {
  const actions: Array<Record<string, unknown>> = [];
  let enabled = false;
  let rules = { daily_cap: 10, per_client_days: 14 };
  await page.route('**/functions/v1/revenue-center', (route) => {
    if (route.request().method() === 'OPTIONS') return json(route, null);
    const body = route.request().postDataJSON() as Record<string, unknown>;
    if (body.action === 'set-autopilot') { enabled = Boolean(body.enabled); actions.push(body); }
    if (body.action === 'save-rules') { rules = body.rules as typeof rules; actions.push(body); }
    if (body.action === 'send-winback') actions.push(body);
    return json(route, { ...state(outbound, enabled), settings: { ...state(outbound, enabled).settings, rules } });
  });
  return actions;
}

test('TC-D3-AUTOPILOT-UI-01 autopilot starts off and the stylist can enable it', async ({ page }) => {
  await openOperatorPage(page, '/');
  const actions = await mock(page, false);
  await page.goto('/BID-1/growth/autopilot');
  const toggle = page.getByRole('switch', { name: /Rebooking autopilot/ });
  await expect(toggle).toBeVisible();
  await expect(toggle).not.toBeChecked();
  await expect(page.getByText('Texts are off until the messaging provider is live.', { exact: false })).toBeVisible();
  await page.locator('label.mova-toggle', { hasText: 'Rebooking autopilot' }).click();
  await expect(toggle).toBeChecked();
  await expect.poll(() => actions).toContainEqual({ action: 'set-autopilot', enabled: true });
  await page.getByLabel('Daily message cap').fill('8');
  await page.getByRole('button', { name: 'Save rules' }).click();
  await expect.poll(() => actions).toContainEqual(expect.objectContaining({ action: 'save-rules', rules: expect.objectContaining({ daily_cap: 8 }) }));
});

test('TC-D4-WINBACK-01 win-back sends only when the stylist taps, and only when texting is live', async ({ page }) => {
  await openOperatorPage(page, '/');
  await mock(page, false);
  await page.goto('/BID-1/growth/winback');
  // Board 33: Review opens the client's message card; Send stays off until texting is live.
  await page.getByRole('button', { name: 'Review' }).first().click();
  await expect(page.getByRole('button', { name: 'Send message' })).toBeDisabled();
  await page.unroute('**/functions/v1/revenue-center');
  const actions = await mock(page, true);
  await page.reload();
  await page.getByRole('button', { name: 'Review' }).first().click();
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect.poll(() => actions).toContainEqual({ action: 'send-winback', opportunity_id: 'opp-1' });
  await expect(page.getByText('Win-back messages always require your tap.')).toBeVisible();
});
