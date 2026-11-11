import { expect, test, type Page } from '@playwright/test';

// Public website (W1 landing, W2 features, W3 pricing, W4 calculator, W5 article, W6 guides list).
// Guide data comes from the mock edge (tests/e2e/support/mock-edge.mjs) for SSR and from the same fixture in the browser.

test.describe('public website', () => {
  test('landing sends every call to action to sign-up and has no waitlist', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: /Your clients follow you/ })).toBeVisible();
    const signUpLinks = page.locator('a[href="/signup"]');
    await expect(signUpLinks.first()).toBeVisible();
    expect(await signUpLinks.count()).toBeGreaterThanOrEqual(3);
    await expect(page.getByText('Start free', { exact: true }).first()).toBeVisible();
    await expect(page.locator('input[type="email"]')).toHaveCount(0);
    await expect(page.getByText(/waitlist|coming soon/i)).toHaveCount(0);
    await expect(page.locator('a[href="/auth"]')).toHaveCount(0);
  });

  test('nav moves between the four public pages and marks the current one', async ({ page }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Website' });
    await nav.getByRole('link', { name: 'Pricing' }).click();
    await expect(page).toHaveURL(/\/pricing$/);
    await expect(nav.locator('[aria-current="page"]')).toHaveText('Pricing');
    await nav.getByRole('link', { name: 'Features' }).click();
    await expect(page).toHaveURL(/\/features$/);
    await expect(page.getByRole('heading', { level: 1, name: /Everything your chair needs/ })).toBeVisible();
    await nav.getByRole('link', { name: 'Calculator' }).click();
    await expect(page).toHaveURL(/\/calculator$/);
    await expect(nav.locator('[aria-current="page"]')).toHaveText('Calculator');
    await expect(page.locator('header').getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  });

  test('pricing shows the three plans at $0, $19 and $39 with no proposed-pricing badge', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page.getByRole('heading', { level: 1, name: /Simple plans/ })).toBeVisible();
    for (const price of ['$0', '$19', '$39']) await expect(page.getByText(price, { exact: true })).toBeVisible();
    await expect(page.getByText(/proposed/i)).toHaveCount(0);
    await expect(page.getByText('Recommended', { exact: true })).toBeVisible();
    await expect(page.locator('.mova-site__plans a[href="/signup"]')).toHaveCount(3);
    await page.getByText('Not sure if renting a booth makes sense?').click();
    await expect(page.getByRole('link', { name: 'booth rent vs. commission calculator' })).toHaveAttribute('href', '/calculator');
  });

  test('calculator computes the weekly comparison and explains bad input', async ({ page }) => {
    await page.goto('/calculator');
    await expect(page.getByRole('heading', { level: 1, name: /Booth rent or commission/ })).toBeVisible();
    await expect(page.getByText('Booth rental: $300 more per week')).toBeVisible();
    await expect(page.getByText('About $15,600 a year, if every week looked like this one.')).toBeVisible();
    await page.getByLabel('Service revenue per week ($)').fill('1000');
    await page.getByLabel('Booth or suite rent per week ($)').fill('600');
    await expect(page.getByText('Commission: $200 more per week')).toBeVisible();
    await page.getByLabel('Salon\'s commission cut (%)').fill('150');
    await expect(page.getByRole('alert')).toHaveText('Commission cut must be between 0 and 100%.');
    await page.getByLabel('Your own expenses per week ($)').fill('');
    await expect(page.getByRole('alert')).toHaveText('Fill in every number to see your results.');
  });

  test('Spanish pricing copy renders from the es-US catalog', async ({ page }) => {
    await page.goto('/pricing?locale=es-US');
    await expect(page.getByRole('heading', { level: 1, name: /Planes sencillos/ })).toBeVisible();
    await expect(page.locator('.mova-site__plans a[href="/signup"]')).toHaveCount(3);
    await expect(page.locator('.mova-site__plans a[href="/signup"]').first()).toHaveText('Empieza gratis');
  });

  test('public pages fit a 320 px screen without sideways scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    for (const path of ['/', '/features', '/pricing', '/calculator', '/guides']) {
      await page.goto(path);
      await expect(page.getByRole('navigation', { name: 'Website' })).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });
});

test.describe('guides', () => {
  test('list shows the featured guide, cards and topic filters from the guides service', async ({ page }) => {
    await page.goto('/guides');
    await expect(page.getByRole('heading', { level: 1, name: 'Notes for stylists who run their own book.' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Featured: AI isn't what's making beauty less personal/ })).toHaveAttribute('href', '/guides/ai-isnt-what-is-making-beauty-less-personal');
    await expect(page.getByRole('link', { name: 'Keep your clients when you change salons' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Topics' }).getByRole('link', { name: 'Booking' })).toBeVisible();
  });

  test('a topic filter narrows the list and the active topic is marked', async ({ page }) => {
    await page.goto('/guides');
    await page.getByRole('navigation', { name: 'Topics' }).getByRole('link', { name: 'Going independent' }).click();
    await expect(page).toHaveURL(/category=Going\+independent|category=Going%20independent/);
    await expect(page.getByRole('navigation', { name: 'Topics' }).locator('[aria-current="page"]')).toHaveText('Going independent');
    await expect(page.getByRole('link', { name: 'Keep your clients when you change salons' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Manage appointments across salons' })).toHaveCount(0);
  });

  test('pagination moves forward and back through the cursor trail', async ({ page }) => {
    await page.goto('/guides');
    const pager = page.getByRole('navigation', { name: 'Pagination' });
    await expect(pager.getByText('Page 1')).toBeVisible();
    await expect(pager.getByText('Previous')).toHaveAttribute('aria-disabled', 'true');
    await pager.getByRole('link', { name: 'Next' }).click();
    await expect(pager.getByText('Page 2')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Practical note 01' })).toBeVisible();
    await pager.getByRole('link', { name: 'Previous' }).click();
    await expect(pager.getByText('Page 1')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Manage appointments across salons' })).toBeVisible();
  });

  test('Spanish pages are rendered in Spanish on the server, with their own canonical and structured data', async ({ page, request }) => {
    const html = await (await request.get('/pricing?locale=es-US')).text();
    expect(html).toContain('<html lang="es-US"');
    expect(html).toContain('Planes sencillos.');
    expect(html).toMatch(/rel="canonical" href="[^"]+\/pricing\?locale=es-US"/);
    await page.goto('/pricing?locale=es-US');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Planes sencillos.');
    await expect(page.locator('link[rel="alternate"][hreflang="en-US"]')).toHaveAttribute('href', /\/pricing$/);
    const types = (await page.locator('script[type="application/ld+json"]').allTextContents()).map((text) => (JSON.parse(text) as { '@type'?: string })['@type']);
    expect(types).toEqual(expect.arrayContaining(['SoftwareApplication', 'FAQPage', 'BreadcrumbList']));
    await expect(page.getByRole('navigation', { name: 'Sitio web' }).getByRole('link', { name: 'Funciones' })).toHaveAttribute('href', '/features?locale=es-US');
  });

  test('robots.txt and llms.txt describe the public site', async ({ request }) => {
    const robots = await (await request.get('/robots.txt')).text();
    expect(robots).toContain('Allow: /');
    expect(robots).toContain('Disallow: /admin');
    expect(robots).toContain('User-agent: GPTBot');
    expect(robots).toMatch(/Sitemap: https?:\/\/\S+\/sitemap\.xml/);
    const llms = await request.get('/llms.txt');
    expect(llms.headers()['content-type']).toContain('text/markdown');
    const text = await llms.text();
    expect(text.startsWith('# Mova')).toBe(true);
    expect(text).toContain('## Guides');
    expect(text).not.toContain('TO BE');
  });

  test('article renders blocks, SEO tags and related guides, and drops unsafe links', async ({ page }) => {
    await page.goto('/guides/ai-isnt-what-is-making-beauty-less-personal');
    await expect(page).toHaveTitle("AI isn't what's making beauty less personal | mova");
    await expect(page.getByRole('heading', { level: 1, name: "AI isn't what's making beauty less personal" })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'The client remembers. Does the system?' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Read the Phorest survey' })).toHaveAttribute('href', 'https://www.phorest.example/survey');
    await expect(page.getByText("<script>alert('x')</script> stays text.")).toBeVisible();
    await expect(page.getByText('Click me', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Click me' })).toHaveCount(0);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /We've spent years teaching beauty software/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/guides\/ai-isnt-what-is-making-beauty-less-personal$/);
    // Article, breadcrumb trail and the site-wide Organization + WebSite graph.
    const structured = await page.locator('script[type="application/ld+json"]').allTextContents();
    const types = structured.map((text) => JSON.parse(text) as { '@type'?: string; '@graph'?: { '@type': string }[] }).map((value) => value['@type'] ?? value['@graph']?.map((node) => node['@type']).join('+'));
    expect(types.sort()).toEqual(['Article', 'BreadcrumbList', 'Organization+WebSite']);
    await expect(page.locator('meta[property="og:type"]')).toHaveAttribute('content', 'article');
    await expect(page.getByRole('navigation', { name: 'More guides' }).getByRole('link', { name: 'Practical note 01' })).toHaveCount(0);
  });

  test('noindex articles tell search engines not to index them', async ({ page }) => {
    await page.goto('/guides/manage-appointments-across-salons');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex,follow');
  });

  test('an unknown guide shows a not-found message inside the site', async ({ page }) => {
    await page.goto('/guides/no-such-guide');
    await expect(page.getByRole('heading', { level: 1, name: "We couldn't find that guide." })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Website' })).toBeVisible();
    await page.getByRole('link', { name: 'Back to guides' }).click();
    await expect(page).toHaveURL(/\/guides$/);
  });
});

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test('article page fits a phone without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/guides/ai-isnt-what-is-making-beauty-less-personal');
  await expectNoHorizontalScroll(page);
});
