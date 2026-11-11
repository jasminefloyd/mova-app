import { expect, test, type Page } from '@playwright/test';
import { openOperatorPage } from './operator-session';

// Task 3.4: Looks (board 16d). Reorder, link, hide and delete go to the database; the public
// Looks tab only lists published items (public-artist filters is_published = true).
const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, accept-profile, content-profile, prefer', 'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS', 'Content-Range': '0-0/1' };
const id = (n: number) => `e2500000-0000-4000-8000-0000000009${String(n).padStart(2, '0')}`;
const services = [{ id: id(10), name: 'Silk press', status: 'active' }, { id: id(11), name: 'Knotless braids', status: 'active' }];
const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

async function mock(page: Page) {
  const items = [
    { id: id(1), media_path: 'b/1.jpg', alt_text: 'Glossy silk press', sort_order: 0, is_published: true },
    { id: id(2), media_path: 'b/2.jpg', alt_text: 'Mid-back knotless braids', sort_order: 1, is_published: true },
  ];
  const links: Record<string, string[]> = { [id(1)]: [id(10)], [id(2)]: [] };
  const writes: { kind: string; body: unknown; url: string }[] = [];
  const ok = (route: Parameters<Parameters<Page['route']>[1]>[0], body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify(body) });
  await page.route('**/rest/v1/mova_portfolio_items*', async (route) => {
    const method = route.request().method();
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (method === 'GET') return ok(route, items);
    writes.push({ kind: method, body: route.request().postDataJSON(), url: route.request().url() });
    return ok(route, []);
  });
  await page.route('**/rest/v1/mova_services*', (route) => ok(route, services));
  await page.route('**/rest/v1/mova_portfolio_service_links*', (route) => {
    const item = new URL(route.request().url()).searchParams.get('portfolio_item_id')?.replace('eq.', '') ?? '';
    return ok(route, (links[item] ?? []).map((service_id) => ({ service_id })));
  });
  await page.route('**/rest/v1/rpc/*', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    writes.push({ kind: new URL(route.request().url()).pathname.split('/').pop() ?? '', body: route.request().postDataJSON(), url: '' });
    return ok(route, null);
  });
  await page.route('**/storage/v1/object/sign/**', (route) => ok(route, { signedURL: '/object/sign/pixel.png?token=x' }));
  await page.route('**/storage/v1/object/sign/pixel.png*', (route) => route.fulfill({ status: 200, contentType: 'image/png', headers, body: Buffer.from(pixel, 'base64') }));
  await page.route('**/storage/v1/object/mova_portfolio_media', (route) => { writes.push({ kind: 'storage-remove', body: route.request().postDataJSON(), url: '' }); return ok(route, []); });
  return writes;
}

test('TC-LOOKS-16D-01 lists looks with titles, links and status', async ({ page }) => {
  await openOperatorPage(page, '/');
  await mock(page);
  await page.goto('/BID-1/settings/portfolio');
  await expect(page.getByText('2 looks · 2 on your page', { exact: false })).toBeVisible();
  const cards = page.getByTestId('look-card');
  await expect(cards.nth(0)).toContainText('Silk press');
  await expect(cards.nth(0)).toContainText('Book this look → Silk press');
  await expect(cards.nth(1)).toContainText('Not linked to a service');
  await expect(cards.nth(0).getByRole('button', { name: 'Move Silk press up' })).toBeDisabled();
});

test('TC-LOOKS-16D-02 reorder, link, hide and delete persist', async ({ page }) => {
  await openOperatorPage(page, '/');
  const writes = await mock(page);
  await page.goto('/BID-1/settings/portfolio');
  const cards = page.getByTestId('look-card');
  await cards.nth(0).getByRole('button', { name: 'Move Silk press down' }).click();
  await expect.poll(() => writes.find((w) => w.kind === 'mova_reorder_portfolio_items')?.body).toMatchObject({ p_item_ids: [id(2), id(1)] });
  // Wait for React to apply the new list order before using the position-based card locator again.
  await expect(cards.nth(0)).toContainText('Not linked to a service');

  await cards.nth(0).locator('.mova-looks__summary-button').click();
  await expect(cards.nth(0).locator('.mova-looks__summary-button')).toHaveAttribute('aria-expanded', 'true');
  await cards.nth(0).getByRole('button', { name: 'Knotless braids' }).click();
  await expect.poll(() => writes.find((w) => w.kind === 'mova_set_portfolio_service_links')?.body).toMatchObject({ p_portfolio_item_id: id(2), p_service_ids: [id(11)] });
  await expect(cards.nth(0)).toContainText('Book this look → Knotless braids');

  await cards.nth(0).locator('label.mova-toggle').click();
  await expect.poll(() => writes.find((w) => w.kind === 'PATCH')?.body).toEqual({ is_published: false });
  await expect(cards.nth(0)).toContainText('Hidden');

  await cards.nth(0).getByRole('button', { name: 'Delete look' }).click();
  await cards.nth(0).getByRole('button', { name: 'Tap again to delete this look' }).click();
  await expect.poll(() => writes.find((w) => w.kind === 'DELETE')?.url ?? '').toContain(`id=eq.${id(2)}`);
});
