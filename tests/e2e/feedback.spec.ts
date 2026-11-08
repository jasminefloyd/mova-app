import { expect, test } from '@playwright/test';
import { openOperatorPage } from './operator-session';

// Task 3.5: Send feedback (board 16e) from Settings, one submission per type.
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-mova-artist-business-id', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };

for (const [type, label, prompt] of [
  ['idea', 'Idea', 'What would make Mova better?'],
  ['broken', "Something's broken", 'What happened?'],
  ['question', 'Question', 'What do you want to know?'],
] as const) {
  test(`TC-FEEDBACK-16E-01 sends ${type} feedback and shows the thank-you state`, async ({ page }) => {
    await openOperatorPage(page, '/settings');
    const sent: Record<string, unknown>[] = [];
    await page.route('**/functions/v1/support-feedback', async (route) => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      sent.push(route.request().postDataJSON());
      return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ data: { id: 'e2500000-0000-4000-8000-000000000990', reply_to: 'playwright@mova.invalid' }, error: null }) });
    });
    await page.goto('/BID-1/clients');
    await page.goto('/BID-1/settings');
    await page.getByRole('button', { name: /Send feedback/ }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByRole('heading', { name: 'Send feedback' })).toBeVisible();
    await expect(sheet.getByText("We won't include client details.", { exact: false })).toBeVisible();
    await sheet.getByRole('radio', { name: label }).click();
    await expect(sheet.getByRole('radio', { name: label })).toHaveAttribute('aria-checked', 'true');
    const send = sheet.getByRole('button', { name: 'Send to Mova' });
    await expect(send).toBeDisabled();
    await sheet.getByLabel(prompt).fill('The week view is hard to read on my phone.');
    await send.click();
    await expect(sheet.getByRole('heading', { name: 'Sent. Thank you' })).toBeVisible();
    await expect(sheet.getByRole('status')).toContainText('playwright@mova.invalid');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ action: 'submit', type, message: 'The week view is hard to read on my phone.', screenshot_path: null, locale: 'en-US' });
    expect(Object.keys(sent[0]!).sort()).toEqual(['action', 'app_version', 'locale', 'message', 'screen', 'screenshot_path', 'type']);
    await sheet.getByRole('button', { name: 'Done' }).click();
    await expect(sheet).toBeHidden();
  });
}

test('TC-FEEDBACK-16E-02 shows an error and keeps the message when sending fails', async ({ page }) => {
  await openOperatorPage(page, '/settings');
  await page.route('**/functions/v1/support-feedback', (route) => route.request().method() === 'OPTIONS'
    ? route.fulfill({ status: 204, headers: cors })
    : route.fulfill({ status: 500, contentType: 'application/json', headers: cors, body: JSON.stringify({ data: { code: 'FEEDBACK_SAVE_FAILED' }, error: {} }) }));
  await page.getByRole('button', { name: /Send feedback/ }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('What happened?').fill('Calendar sync stopped.');
  await sheet.getByRole('button', { name: 'Send to Mova' }).click();
  await expect(sheet.getByRole('alert')).toHaveText("We couldn't send that. Try again.");
  await expect(sheet.getByLabel('What happened?')).toHaveValue('Calendar sync stopped.');
});
