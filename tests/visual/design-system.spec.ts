import { expect, test } from '@playwright/test';
import { openOperatorPage } from '../e2e/operator-session';

test('component gallery visual baselines at 320, 360, 390 and 430 px', async ({ page }) => {
  await openOperatorPage(page, '/components');
  await page.waitForLoadState('networkidle');
  await expect.poll(() => page.evaluate(() => document.fonts.status).catch(() => 'loading')).toBe('loaded');
  await expect(page.getByRole('heading', { name: 'Color palette' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Typography' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Icon 30' })).toBeVisible();
  await expect(page.getByText('--status-pending-border')).toBeVisible();
  await expect(page.getByText('--wallet-button')).toBeVisible();
  for (const width of [320, 360, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page).toHaveScreenshot(`component-gallery-${width}.png`, { fullPage: true, animations: 'disabled' });
  }
});

test('sheet traps focus, closes with Escape, and restores focus to its trigger', async ({ page }) => {
  await openOperatorPage(page, '/components');
  const trigger = page.getByRole('button', { name: 'Open accessible sheet' });
  await trigger.focus();
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Example sheet' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
});

test('form validation, character count and chart table remain accessible', async ({ page }) => {
  await openOperatorPage(page, '/components');
  const area = page.getByRole('textbox', { name: 'Text area' });
  await area.fill('Example');
  await expect(page.getByText('7/1000')).toBeVisible();
  const chartTable = page.getByRole('table', { name: 'Sample chart' });
  const chartTableToggle = page.getByRole('button', { name: 'View data as a table' });
  await expect(chartTable).toBeVisible();
  await chartTableToggle.click();
  await expect(chartTable).not.toBeVisible();
  await chartTableToggle.click();
  await expect(chartTable).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: 'Example options' })).toBeVisible();
});

test('focus ring, touch-sized chart link, unread dot and photo states are represented', async ({ page }) => {
  await openOperatorPage(page, '/components');
  const primary = page.getByRole('button', { name: 'Primary' });
  await primary.focus();
  await expect(primary).toHaveCSS('outline-width', '2px');
  await expect(primary).toHaveCSS('outline-offset', '2px');
  await expect(primary).toHaveCSS('box-shadow', /6px/);
  const chartLink = page.getByRole('button', { name: 'View data as a table' });
  await expect.poll(() => chartLink.evaluate((element) => getComputedStyle(element, '::before').height)).toBe('44px');
  for (const [label, control] of [['chip', page.getByRole('button', { name: 'Filter chip' })], ['segment', page.getByRole('button', { name: 'First', exact: true })], ['compact button', page.getByRole('button', { name: 'Compact' })]] as const) {
    await expect.poll(() => control.evaluate((element) => getComputedStyle(element, '::before').height), { message: `${label} hit area` }).toBe('44px');
  }
  await expect(page.getByRole('img', { name: 'Unread message' })).toBeVisible();
  await expect(page.getByText('Face the light, shoulders up, face centered')).toBeVisible();
  await expect(page.getByText('Small-size preview')).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Disabled option' })).toBeDisabled();
  await expect(page.getByRole('checkbox', { name: 'Disabled example choice' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Disabled', exact: true }).first()).toBeDisabled();
  await expect(page.getByRole('group', { name: 'Disabled example options' }).getByRole('button', { name: 'Unavailable' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '11:00 AM' })).toBeDisabled();
});
