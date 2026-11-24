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

  test('Features presents the Essentials and AI + Growth grids and reflows on phones', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/features');
    const essentials = page.getByRole('region', { name: 'The everyday tools, in one app.' });
    const growth = page.getByRole('region', { name: 'Fill cancellations. Bring regulars back. Get priced right.' });
    const anchors = page.getByRole('navigation', { name: 'Jump to a feature' });
    await expect(essentials.getByRole('heading', { level: 3 }).first()).toHaveText('One page. One QR code. Every location.');
    await expect(growth.getByRole('heading', { level: 3 })).toHaveText([
      'AI Revenue Center', 'Seat Filler', 'Rebooking autopilot', 'Marketing', 'PricePilot', 'AI Concierge',
    ]);
    await expect(growth.getByText('$39/month')).toBeVisible();
    await expect(growth.getByRole('link', { name: 'Compare plans' })).toHaveAttribute('href', '/pricing');
    await expect(growth.locator('a[href="/signup"]')).toBeVisible();
    await expect(essentials.getByText('A profile photo clients recognize')).toBeVisible();
    const columns = (selector: string) => page.locator(selector).evaluate(grid => getComputedStyle(grid).gridTemplateColumns.split(' ').length);
    expect(await columns('.features-essentials__grid')).toBe(2);
    expect(await columns('.features-growth__grid')).toBe(3);
    await anchors.getByRole('link', { name: 'Reports & reviews' }).click();
    await expect(page).toHaveURL(/#reports$/);
    const growthLink = anchors.getByRole('link', { name: 'AI + Growth' });
    expect(await growthLink.evaluate(link => getComputedStyle(link).color === getComputedStyle(link).backgroundColor)).toBe(false);
    await growthLink.click();
    await expect(page).toHaveURL(/#growth$/);
    await expect(growth.getByRole('heading', { level: 2 })).toBeInViewport();

    await page.setViewportSize({ width: 390, height: 844 });
    expect(await columns('.features-essentials__grid')).toBe(1);
    expect(await columns('.features-growth__grid')).toBe(1);
    await expect(essentials.getByText('A profile photo clients recognize')).toBeHidden();
    await expect(growth.getByText('A monthly revenue forecast')).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
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

  test('calculator compares commission, booth and suite and explains bad input', async ({ page }) => {
    const events: Array<string | null> = [];
    await page.route('**/api/calculator-event', (route) => {
      events.push(route.request().postData());
      return route.fulfill({ status: 204 });
    });
    await page.goto('/calculator');
    await expect(page).toHaveTitle('Booth Rent vs. Commission Calculator for Hairstylists | Mova');
    await expect(page.getByRole('heading', { level: 1, name: 'Commission, booth or suite? See what you really keep.' })).toBeVisible();
    // The board week: booth wins on cash, commission wins once the salon's perks count.
    const results = page.locator('#results');
    await expect(results.getByText('$41,156')).toBeVisible();
    await expect(results.getByText('Close call. It depends on the perks.')).toBeVisible();
    await expect(results.getByText(/Booth rental pays \$1,275 more a year in cash\. .* commission comes out \$1,605 ahead\./)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Where every dollar goes' })).toBeVisible();
    await expect(page.getByText(/Above \$1,386 a week in services, booth pays more than commission/)).toBeVisible();

    await page.getByLabel('Service revenue per week').fill('1000');
    await expect(results.getByText('Commission keeps the most')).toBeVisible();

    await page.getByRole('button', { name: /Commission costs/ }).click();
    await page.getByLabel('Salon’s commission cut').fill('150');
    await expect(page.getByRole('alert')).toHaveText('Percentages must be between 0 and 100.');
    await page.getByLabel('Salon’s commission cut').fill('40');
    await page.getByRole('button', { name: /Your income/ }).click();
    await page.getByLabel('Service revenue per week').fill('');
    await expect(page.getByRole('alert')).toHaveText('Fill in your weekly service revenue and hours to see results.');
    await page.getByLabel('Service revenue per week').fill('1500');

    await page.getByRole('link', { name: 'Start free for 30 days' }).click();
    await expect(page).toHaveURL(/\/signup\?from=calculator$/);
    await expect.poll(() => events).toEqual(['calculator_used', 'start_free_clicked']);
  });

  test('the shared marketing footer links to Jasmine Floyd with campaign tracking and has no language switch', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('mova_guest_locale', 'es-US'));
    await page.goto('/');
    const footer = page.getByRole('contentinfo');
    await expect(footer.getByRole('link', { name: '© 2026 Jasmine Floyd' })).toHaveAttribute('href', 'https://jasmine.floydmethod.com/?utm_campaign=mova-copyright');
    await expect(footer.getByRole('button', { name: /^(EN|ES)$/ })).toHaveCount(0);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en-US');
    await footer.getByRole('link', { name: 'Pricing' }).click();
    await expect(page.getByRole('heading', { level: 1, name: /Simple plans/ })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('mova_guest_locale'))).toBe('es-US');
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

  test('old marketing locale URLs redirect to English and retain campaign and guide filters', async ({ page, request }) => {
    for (const path of ['/', '/pricing', '/guides', '/guides/ai-isnt-what-is-making-beauty-less-personal']) {
      const base = `${path}?utm_campaign=qa&category=Booking`;
      const response = await request.get(`${base}&locale=es-US`, { maxRedirects: 0 });
      expect(response.status()).toBe(301);
      expect(response.headers().location).toBe(base);
    }
    const html = await (await request.get('/pricing?locale=es-US')).text();
    expect(html).toContain('<html lang="en-US"');
    expect(html).toContain('Simple plans.');
    expect(html).toMatch(/rel="canonical" href="[^"]+\/pricing"/);
    expect(html).not.toMatch(/hreflang=|og:locale:alternate/);
    await page.goto('/pricing?locale=es-US');
    await expect(page).toHaveURL(/\/pricing$/);
    await expect(page.getByRole('navigation', { name: 'Website' }).getByRole('link', { name: 'Features' })).toHaveAttribute('href', '/features');
    const types = (await page.locator('script[type="application/ld+json"]').allTextContents()).map((text) => (JSON.parse(text) as { '@type'?: string })['@type']);
    expect(types).toEqual(expect.arrayContaining(['SoftwareApplication', 'FAQPage', 'BreadcrumbList']));
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

  test('the signup ad destination is crawlable and requests exclusion from organic results', async ({ request }) => {
    const robots = await (await request.get('/robots.txt')).text();
    expect(robots).not.toMatch(/^Disallow:\s*\/signup/m);
    expect(robots).toMatch(/^Disallow:\s*\/login$/m);
    for (const path of ['/signup', '/signup?utm_source=google&utm_medium=cpc&utm_campaign=aig_pp_search&utm_content=pricepilot']) {
      const response = await request.get(path);
      expect(response.status()).toBe(200);
      expect(await response.text()).toContain('<meta name="robots" content="noindex,follow"/>');
    }
  });

  test('article renders blocks, SEO tags and related guides, and drops unsafe links', async ({ page }) => {
    await page.goto('/guides/ai-isnt-what-is-making-beauty-less-personal');
    await expect(page).toHaveTitle("AI isn't what's making beauty less personal | Mova Beauty");
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

  test('published guides track landing pages without accepting guide UTMs', async ({ page }) => {
    const visits: Record<string, unknown>[] = [];
    await page.route('**/api/discovery-event', async route => {
      visits.push(route.request().postDataJSON() as Record<string, unknown>);
      await route.fulfill({ status: 204 });
    });
    const slug = 'ai-isnt-what-is-making-beauty-less-personal';
    const params = `?utm_source=mova&utm_medium=guide&utm_campaign=guides&utm_content=${slug}`;
    await page.goto('/guides/no-such-guide' + params);
    await expect(page.getByRole('heading', { name: "We couldn't find that guide." })).toBeVisible();
    await page.goto(`/guides/${slug}${params}`);
    await expect.poll(() => visits.length).toBe(1);
    expect(visits[0]).toMatchObject({ path: `/guides/${slug}`, landing: `/guides/${slug}`, source: '', medium: '', campaign: '', content: '' });
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', new RegExp(`/guides/${slug}$`));
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
