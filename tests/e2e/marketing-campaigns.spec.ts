import { expect, test, type Page, type Route } from '@playwright/test';
import { openOperatorPage } from './operator-session';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-mova-artist-business-id', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const enabledChannels = { email: { plan: true, platform: false, ready: false }, social: { plan: true, platform: false, ready: false }, web_push: { plan: true, platform: false, ready: false }, wallet: { plan: true, platform: false, ready: false } };
const campaign = { id: 'campaign-1', name: 'Rebooking reminder', goal: 'rebooking_reminder', status: 'draft', created_at: '2026-11-14T12:00:00Z', audience: { segment: 'due_rebook' }, mova_marketing_campaign_channels: [{ channel: 'email', content: { subject: 'Time for your next visit', text: 'Hi {first name}, it may be time to book your next visit.' }, status: 'draft' }] };

async function mockMarketing(page: Page, options: { campaigns?: unknown[]; free?: boolean } = {}) {
  const actions: Array<Record<string, unknown>> = [];
  await page.route('**/functions/v1/marketing-campaign', async (route: Route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const body = route.request().postDataJSON() as Record<string, unknown>;
    actions.push(body);
    let data: unknown = {};
    if (body.action === 'status') data = { campaigns: options.campaigns ?? [], channels: options.free ? Object.fromEntries(Object.keys(enabledChannels).map((key) => [key, { plan: false, platform: false, ready: false }])) : enabledChannels, delivery_enabled: false };
    if (body.action === 'preview') {
      const eligible = body.segment === 'lapsed_60' ? 5 : body.segment === 'due_rebook' ? 2 : body.segment === 'booked_service' ? 4 : 12;
      data = { channel: body.channel, segment: body.segment, eligible, considered: 15, ready: false, reason: 'CHANNEL_ROLLOUT_DISABLED', sample_clients: body.include_sample ? [{ id: 'client-1', display_name: 'Simone A.', last_visit_at: '2026-10-01T12:00:00Z' }] : [] };
    }
    if (body.action === 'get') data = { campaign };
    if (body.action === 'save') data = { campaign: { ...campaign, id: body.id ?? 'campaign-2' } };
    if (body.action === 'cancel') data = { campaign: { id: body.id, status: 'cancelled' } };
    return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ data, error: null }) });
  });
  return actions;
}

test('MKT-01 home uses live preview counts and only shows saved drafts and real channel state', async ({ page }) => {
  await openOperatorPage(page, '/');
  await mockMarketing(page);
  await page.goto('/BID-1/growth/marketing');
  await expect(page.getByRole('button', { name: /Win back quiet clients/ })).toContainText('5');
  await expect(page.getByRole('button', { name: /Remind clients to rebook/ })).toContainText('2');
  await expect(page.getByText('Mova has a draft ready.')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Review the draft/ })).toHaveCount(0);
  await page.getByRole('button', { name: /Choose channels/ }).click();
  await expect(page.getByRole('heading', { name: 'Channels' })).toBeVisible();
  await expect(page.getByText('Paused', { exact: true })).toHaveCount(4);
});

test('MKT-01 Free plan channel states reflect entitlements', async ({ page }) => {
  await openOperatorPage(page, '/');
  await mockMarketing(page, { free: true });
  await page.goto('/BID-1/growth/marketing');
  // T8: the screen stays visible but locked, with what unlocks it.
  await expect(page.getByRole('heading', { name: 'Marketing is locked' })).toBeVisible();
  await expect(page.getByText('14', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Compare plans' })).toBeVisible();
  await expect(page.locator('.mova-locked')).toHaveAttribute('aria-hidden', 'true');
});

test('MKT-02 distinct rebooking reminder selects its due-window audience', async ({ page }) => {
  await openOperatorPage(page, '/');
  await mockMarketing(page);
  await page.goto('/BID-1/growth/marketing');
  await page.getByRole('button', { name: /Remind clients to rebook/ }).click();
  await expect(page.getByRole('heading', { name: 'What’s the goal?' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  const selected = page.getByRole('radio', { name: /Due to rebook in the next 7 days/ });
  await expect(selected).toHaveAttribute('aria-checked', 'true');
  await expect(selected).toContainText('Best match for a timely reminder');
});

test('MKT-04 saved campaign draft opens, retains data, and saves edits', async ({ page }) => {
  await openOperatorPage(page, '/');
  const actions = await mockMarketing(page, { campaigns: [{ ...campaign, mova_marketing_campaign_channels: campaign.mova_marketing_campaign_channels.map(({ channel, status }) => ({ channel, status, error_code: null })) }] });
  await page.goto('/BID-1/growth/marketing');
  await page.getByRole('button', { name: 'Edit draft' }).click();
  await expect(page.getByRole('heading', { name: 'What’s the goal?' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('radio', { name: /Due to rebook in the next 7 days/ })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByLabel('Subject')).toHaveValue('Time for your next visit');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('button', { name: 'Send now' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Schedule', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect.poll(() => actions.some((action) => action.action === 'save' && action.id === 'campaign-1')).toBe(true);
});

test('MKT-05 cancelling a draft uses the in-app confirmation sheet', async ({ page }) => {
  await openOperatorPage(page, '/');
  await mockMarketing(page, { campaigns: [{ ...campaign, mova_marketing_campaign_channels: campaign.mova_marketing_campaign_channels.map(({ channel, status }) => ({ channel, status, error_code: null })) }] });
  await page.goto('/BID-1/growth/marketing');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Cancel this draft?' })).toBeVisible();
  await expect(page.getByText("Cancel this draft? It won't be sent.")).toBeVisible();
});
