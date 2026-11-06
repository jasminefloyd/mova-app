import { expect, test } from '@playwright/test';

test('artist navigation exposes exactly five labelled tab roots in both locales', async ({ page }) => {
  await page.goto('/app/home');
  const navigation = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(navigation.getByRole('button')).toHaveText(['Home', 'Calendar', 'Clients', 'AI Revenue', 'Reports']);
  const homeTab = navigation.getByRole('button', { name: 'Home' });
  await expect(homeTab).toHaveAttribute('aria-current', 'page');
  await expect(navigation).toHaveCSS('height', '82px');
  await homeTab.focus();
  const tabLabels = ['Home', 'Calendar', 'Clients', 'AI Revenue', 'Reports'];
  for (const label of tabLabels.slice(1)) {
    await page.keyboard.press('Tab');
    await expect(navigation.getByRole('button', { name: label })).toBeFocused();
  }
  for (const label of tabLabels) {
    await navigation.getByRole('button', { name: label }).click();
    await expect(navigation.getByRole('button', { name: label })).toHaveAttribute('aria-current', 'page');
    await expect(navigation.locator('[aria-current="page"]')).toHaveCount(1);
  }

  await page.getByRole('combobox', { name: 'Language' }).selectOption('es-US');
  await expect(page.getByRole('navigation', { name: 'Navegación principal' }).getByRole('button')).toHaveText(['Inicio', 'Calendario', 'Clientes', 'Ingresos IA', 'Informes']);
  await expect(page.locator('html')).toHaveAttribute('lang', 'es-US');
  await page.getByRole('button', { name: 'Ingresos IA' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Centro de ingresos con IA' })).toBeVisible();
});

test('settings opens from the Home avatar and Money is reachable from Reports and Settings', async ({ page }) => {
  await page.goto('/app/home');
  const settingsTrigger = page.getByRole('link', { name: 'Open settings' });
  await settingsTrigger.click();
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
  await page.getByRole('button', { name: 'Close settings' }).click();
  await expect(settingsTrigger).toBeFocused();
  await settingsTrigger.click();
  await page.getByRole('link', { name: 'Open money from Settings' }).click();
  await expect(page).toHaveURL('/app/money');
  await expect(page.getByRole('heading', { level: 1, name: 'Money' })).toBeVisible();
  await page.goto('/app/home');
  await page.getByRole('button', { name: 'Reports' }).click();
  await page.getByRole('link', { name: 'Open money from Reports' }).click();
  await expect(page).toHaveURL('/app/money');
  await expect(page.getByRole('heading', { level: 1, name: 'Money' })).toBeVisible();
});

test('artist tab shell has no horizontal overflow from 320 to 430 px', async ({ page }) => {
  await page.goto('/app/home');
  await page.getByRole('combobox', { name: 'Language' }).selectOption('es-US');
  for (const width of [320, 360, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test('component gallery is not reachable in the production build', async ({ page }) => {
  await page.goto('/app/components');
  await expect(page).toHaveURL('/app/home');
  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Component gallery' })).toHaveCount(0);
});
