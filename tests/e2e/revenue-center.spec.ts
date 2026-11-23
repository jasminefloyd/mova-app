import { expect, test } from '@playwright/test';
import { openOperatorPage } from './operator-session';

test('Revenue Center lays out tappable tiles and keeps the forecast readable at mobile widths', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 780 });
  await openOperatorPage(page, '/growth');
  await expect(page.getByText('Your usual month appears after three complete months of history.')).toBeVisible();

  await page.route('**/functions/v1/forecast-summary', route => route.fulfill({
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-mova-artist-business-id',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
    json: { data: { forecast: {
      booked_minor: 22500, likely_minor: 68400, usual_minor: 54200,
      inputs: {
        bookedMinor: 22500, remainingHours: [9], fillRates: [0.5], avgTicketPerHourMinor: [10200],
        openLowMinor: 30900, openHighMinor: 55900, dueClients: 0, rebookConversion: 0,
        averageTicketMinor: 0, rebookLowMinor: 0, rebookHighMinor: 0, usualMonthsMinor: [54200, 54200, 54200],
      },
    } } },
  }));
  await page.reload();
  const forecast = page.locator('.mova-revenue-hero');
  await expect(forecast.getByText('$684', { exact: true }).filter({ visible: true })).toHaveCount(1);
  await expect(forecast.getByText('$225 booked')).toBeVisible();
  await expect(forecast.getByText('$542 your usual month')).toBeVisible();

  const method = forecast.locator('summary');
  const methodHeading = forecast.getByRole('heading', { name: 'How Mova estimates this' });
  await expect(method).toHaveText('How Mova estimates this');
  await expect(methodHeading).toBeHidden();
  await method.focus();
  await method.press('Enter');
  await expect(methodHeading).toBeVisible();
  await method.press('Enter');
  await expect(methodHeading).toBeHidden();

  const followUp = page.getByRole('region', { name: 'Client follow-up' });
  const pipeline = followUp.getByRole('link', { name: /Rebooking pipeline.*0 due/ });
  await expect(pipeline).toBeVisible();
  await expect(pipeline).toHaveCSS('text-decoration-line', 'none');
  const winback = followUp.getByRole('link', { name: /Win back.*0 clients overdue/ });
  await expect(winback).toBeVisible();
  const concierge = followUp.getByRole('link', { name: /Concierge/ });
  const tools = page.getByRole('region', { name: 'Tools & activity' }).getByRole('link');
  await expect(tools).toHaveText([/Marketing.*Drafts only/, /Approved messages/, /Activity/, /PricePilot.*Coming soon/]);

  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 780 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const left = (await pipeline.boundingBox())!;
    const right = (await winback.boundingBox())!;
    expect(left.y).toBeCloseTo(right.y, 0);
    expect(left.x + left.width).toBeLessThan(right.x);
    expect(left.width).toBeCloseTo(right.width, 0);
    expect(left.height).toBeGreaterThanOrEqual(44);
    if (await concierge.count()) {
      const full = (await concierge.boundingBox())!;
      expect(full.x).toBeCloseTo(left.x, 0);
      expect(full.x + full.width).toBeCloseTo(right.x + right.width, 0);
      expect(full.y + full.height).toBeLessThan(left.y);
    }
    const toolPositions = await Promise.all((await tools.all()).map(tile => tile.boundingBox()));
    expect(toolPositions.map(box => box?.x)).toEqual([left.x, right.x, left.x, right.x]);
    expect(toolPositions[2]!.y).toBeGreaterThan(toolPositions[0]!.y);
  }
  await pipeline.click();
  await expect(page).toHaveURL('/BID-1/growth/pipeline');
});
