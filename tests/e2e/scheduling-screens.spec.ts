import { expect, test, type Page, type Route } from '@playwright/test';
import { openOperatorPage } from './operator-session';

// P6 screens: Calendar add sheet (board 08b), New client (08d), New appointment (08c), Block time (08e),
// New location (19a), plus the Reports (37) and Teach your concierge (43) boards. Every call is mocked.
// Mocks are registered after openOperatorPage (which sets up the session) and before the screen loads.
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-mova-artist-business-id, idempotency-key', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS' };
const businessId = 'e2500000-0000-4000-8000-000000000001';
const locationId = 'e2500000-0000-4000-8000-000000000050';
const serviceId = 'e2500000-0000-4000-8000-000000000301';
const clientId = 'e2500000-0000-4000-8000-000000000401';

type Recorded = { url: string; method: string; body: unknown; headers: Record<string, string> };

function functionMock(page: Page, name: string, respond: (body: Record<string, unknown>) => unknown, sent: Recorded[]) {
  return page.route(`**/functions/v1/${name}`, async (route: Route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const body = route.request().postDataJSON() as Record<string, unknown>;
    sent.push({ url: route.request().url(), method: route.request().method(), body, headers: route.request().headers() });
    return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ data: respond(body), error: null, request_id: 'playwright' }) });
  });
}

function rows(page: Page, table: string, data: unknown) {
  return page.route(`**/rest/v1/${table}*`, (route) => route.request().method() === 'OPTIONS'
    ? route.fulfill({ status: 204, headers: cors })
    : route.fulfill({ status: 200, contentType: 'application/json', headers: { ...cors, 'Content-Range': '0-0/1' }, body: JSON.stringify(data) }));
}

const services = [{ id: serviceId, name: 'Silk press', duration_minutes: 90, buffer_minutes: 0, base_price_minor: 15000, location_assignment_mode: 'all' }];
const serviceLinks = [{ service_id: serviceId, location_id: locationId, price_minor_override: null, duration_minutes_override: null }];
const clientsList = [{ id: clientId, client_number: 7, display_name: 'Simone A.', email: null, phone: null }];

function slotResult(body: Record<string, unknown>, minutes: number, available = true) {
  return { available, ends_at: new Date(Date.parse(String(body.starts_at)) + minutes * 60_000).toISOString() };
}

test('TC-SCR-08B-01 the Calendar + opens the add choice sheet with three choices and Cancel', async ({ page }) => {
  await openOperatorPage(page, '/calendar');
  await page.getByRole('button', { name: 'New appointment' }).click();
  await expect(page).toHaveURL(/\/BID-1\/calendar\/add\?day=\d{4}-\d{2}-\d{2}$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Add to your calendar' })).toBeVisible();
  await expect(page.getByRole('link', { name: /New appointment.*Book a client into a time/ })).toHaveAttribute('href', /\/BID-1\/calendar\/new-appointment\?day=\d{4}-\d{2}-\d{2}$/);
  await expect(page.getByRole('link', { name: /New client.*Add someone to your client list/ })).toHaveAttribute('href', /\/BID-1\/clients\/new\?return=calendar&day=\d{4}-\d{2}-\d{2}$/);
  await expect(page.getByRole('link', { name: /Block time.*Personal break, holiday or time off/ })).toHaveAttribute('href', /\/BID-1\/calendar\/block-time\?day=\d{4}-\d{2}-\d{2}$/);
  await page.getByRole('link', { name: 'Cancel' }).click();
  await expect(page).toHaveURL(/\/BID-1\/calendar(?:\?day=\d{4}-\d{2}-\d{2})?$/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

test('TC-SCR-08D-01 New client starts with both consent boxes unticked and records only what is ticked', async ({ page }) => {
  await openOperatorPage(page, '/');
  const sent: Recorded[] = [];
  await functionMock(page, 'client-crud', () => ({ id: clientId, client_number: 7, display_name: 'Simone A.' }), sent);
  await functionMock(page, 'client-consents', () => ({ saved: true }), sent);
  await page.goto('/BID-1/clients/new');

  const appointments = page.getByRole('checkbox', { name: 'Appointment texts and emails' });
  const rebooking = page.getByRole('checkbox', { name: 'Rebooking reminders and offers' });
  await expect(appointments).not.toBeChecked();
  await expect(rebooking).not.toBeChecked();

  await page.getByLabel('First name').fill('Simone');
  await page.getByLabel('Last name').fill('A.');
  await page.getByLabel('Mobile').fill('(555) 555-0100');
  await page.getByText('Appointment texts and emails', { exact: true }).click();
  await expect(appointments).toBeChecked();
  await page.getByRole('button', { name: 'Save client' }).click();

  await expect(page).toHaveURL(/\/BID-1\/clients\/CID-7$/);
  expect(sent.filter((item) => item.url.endsWith('/client-crud')).map((item) => item.body).filter((body) => (body as { action?: string }).action === 'create')).toEqual([
    expect.objectContaining({ action: 'create', display_name: 'Simone A.', phone: '(555) 555-0100', email: '' }),
  ]);
  expect(sent.filter((item) => item.url.endsWith('/client-consents')).map((item) => item.body)).toEqual([
    expect.objectContaining({ action: 'set', client_id: clientId, purpose: 'appointment_updates', channel: 'sms', granted: true }),
  ]);
});

test('TC-SCR-08D-02 New client needs a mobile number or an email before it saves', async ({ page }) => {
  await openOperatorPage(page, '/');
  const sent: Recorded[] = [];
  await functionMock(page, 'client-crud', () => ({ id: clientId, client_number: 7 }), sent);
  await page.goto('/BID-1/clients/new');
  await page.getByLabel('First name').fill('Simone');
  await page.getByRole('button', { name: 'Save client' }).click();
  await expect(page.getByText('Add a mobile number or an email.')).toBeVisible();
  expect(sent).toEqual([]);
});

test('TC-SCR-08C-01 New appointment books a known client into a free time', async ({ page }) => {
  await openOperatorPage(page, '/');
  const sent: Recorded[] = [];
  await rows(page, 'mova_services', services);
  await rows(page, 'mova_service_locations', serviceLinks);
  await page.route('**/rest/v1/mova_appointments*', (route) => {
    if (new URL(route.request().url()).searchParams.get('select') === 'appointment_number') return route.fulfill({ status: 200, contentType: 'application/json', headers: { ...cors, 'Content-Range': '0-0/1' }, body: JSON.stringify({ appointment_number: 21 }) });
    return route.fallback();
  });
  await functionMock(page, 'client-crud', () => clientsList, sent);
  await functionMock(page, 'artist-appointment-create', (body) => body.action === 'check'
    ? slotResult(body, 90)
    : { appointment_id: 'e2500000-0000-4000-8000-000000000777' }, sent);
  await page.goto(`/BID-1/calendar/new-appointment?client=${clientId}`);

  await expect(page.getByRole('heading', { level: 1, name: 'New appointment' })).toBeVisible();
  await expect(page.getByText('Simone A.', { exact: true })).toBeVisible();
  await page.getByLabel('Service').selectOption({ label: 'Silk press · 90 min · $150' });
  await expect(page.getByRole('status').filter({ hasText: 'is free' })).toBeVisible();
  await page.getByRole('button', { name: 'Book appointment' }).click();

  await expect(page).toHaveURL(/\/BID-1\/appointments\/AID-21$/);
  const booking = sent.find((item) => item.headers['idempotency-key']);
  expect(booking?.body).toMatchObject({ artist_business_id: businessId, client_id: clientId, location_id: locationId, service_ids: [serviceId] });
  expect(String((booking?.body as { starts_at?: string }).starts_at)).toMatch(/T\d{2}:\d{2}:00\.000Z$/);
  expect(booking?.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
});

test('TC-SCR-08C-02 New appointment says when the time is taken and does not book it', async ({ page }) => {
  await openOperatorPage(page, '/');
  const sent: Recorded[] = [];
  await rows(page, 'mova_services', services);
  await rows(page, 'mova_service_locations', serviceLinks);
  await functionMock(page, 'client-crud', () => clientsList, sent);
  await functionMock(page, 'artist-appointment-create', (body) => slotResult(body, 90, false), sent);
  await page.goto(`/BID-1/calendar/new-appointment?client=${clientId}`);

  await page.getByLabel('Service').selectOption({ label: 'Silk press · 90 min · $150' });
  await expect(page.getByRole('status').filter({ hasText: 'overlaps another booking or block' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Book appointment' })).toBeDisabled();
  expect(sent.filter((item) => item.headers['idempotency-key'])).toEqual([]);
});

test('New appointment allows adding and removing services and checks the full slot at a compatible location', async ({ page }) => {
  const salonId = 'e2500000-0000-4000-8000-000000000051';
  const studioId = 'e2500000-0000-4000-8000-000000000052';
  const trimId = 'e2500000-0000-4000-8000-000000000302';
  await page.setViewportSize({ width: 320, height: 740 });
  await openOperatorPage(page, '/');
  await rows(page, 'mova_locations', [
    { id: locationId, name: 'Luxe Salon', time_zone: 'America/New_York' },
    { id: salonId, name: 'Salon Two', time_zone: 'America/New_York' },
    { id: studioId, name: 'Studio Two', time_zone: 'America/New_York' },
  ]);
  await rows(page, 'mova_services', [...services, {
    id: trimId, name: 'Trim', duration_minutes: 30, buffer_minutes: 10, base_price_minor: 4000, location_assignment_mode: 'selected',
  }]);
  await rows(page, 'mova_service_locations', [...serviceLinks,
    { service_id: trimId, location_id: locationId, price_minor_override: null, duration_minutes_override: 40 },
    { service_id: trimId, location_id: studioId, price_minor_override: null, duration_minutes_override: 25 },
  ]);
  const sent: Recorded[] = [];
  await functionMock(page, 'client-crud', () => clientsList, sent);
  await functionMock(page, 'artist-appointment-create', (body) => {
    if (body.action !== 'check') return { appointment_id: 'e2500000-0000-4000-8000-000000000777' };
    const multi = (body.service_ids as string[]).length > 1;
    const blocked = multi && body.location_id === locationId;
    return slotResult(body, multi ? (blocked ? 140 : 125) : 90, !blocked);
  }, sent);
  await page.goto(`/BID-1/calendar/new-appointment?client=${clientId}&day=2030-03-05`);

  const location = page.getByRole('combobox', { name: 'Location', exact: true });
  const addService = page.getByRole('combobox', { name: 'Add a service' });
  await expect(location).toHaveValue(locationId);
  await addService.selectOption(serviceId);
  await addService.selectOption(trimId);
  await expect(page.getByRole('list', { name: 'Selected services' }).getByRole('listitem')).toHaveCount(2);
  await expect(page.getByText('+ 10 min buffer')).toBeVisible();
  const salonOption = location.locator(`option[value="${salonId}"]`);
  await expect(salonOption).toHaveJSProperty('disabled', true);
  await expect(page.getByRole('status').filter({ hasText: 'overlaps another booking or block' })).toContainText('12:20');
  await expect(page.getByRole('button', { name: 'Book appointment' })).toBeDisabled();

  await page.getByRole('button', { name: 'Remove Trim' }).click();
  await expect(salonOption).toHaveJSProperty('disabled', false);
  await expect(page.getByRole('status').filter({ hasText: 'is free' })).toContainText('11:30');
  await addService.selectOption(trimId);
  await location.selectOption(studioId);
  await expect(page.getByRole('list', { name: 'Selected services' }).getByRole('listitem')).toHaveCount(2);
  await expect(page.getByRole('listitem').filter({ hasText: 'Trim' })).toContainText('25 min');
  await expect(page.getByRole('status').filter({ hasText: 'is free' })).toContainText('12:05');
  const locationArrow = location.locator('..').locator('.mova-icon');
  const bounds = await location.boundingBox();
  const arrow = await locationArrow.boundingBox();
  expect(bounds!.x + bounds!.width - (arrow!.x + arrow!.width)).toBeGreaterThanOrEqual(12);

  await page.getByRole('button', { name: 'Book appointment' }).click();
  await expect(page).toHaveURL(/\/BID-1\/calendar$/);
  expect(sent.find((item) => item.headers['idempotency-key'])?.body).toMatchObject({ location_id: studioId, service_ids: [serviceId, trimId] });
});

test('TC-SCR-08E-01 Block time validates the hours, then saves one block per location', async ({ page }) => {
  await openOperatorPage(page, '/');
  const inserted: unknown[] = [];
  await page.route('**/rest/v1/mova_availability_blocks*', (route) => {
    if (route.request().method() === 'POST') { inserted.push(route.request().postDataJSON()); return route.fulfill({ status: 201, headers: cors, body: '' }); }
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { ...cors, 'Content-Range': '0-0/0' }, body: '[]' });
  });
  await page.goto('/BID-1/calendar/block-time');

  await page.getByLabel('To', { exact: true }).fill('11:00');
  await page.getByRole('button', { name: 'Block this time' }).click();
  await expect(page.getByText('The end time must be after the start time.')).toBeVisible();
  expect(inserted).toEqual([]);

  await page.getByLabel('To', { exact: true }).fill('13:00');
  await page.getByRole('radio', { name: 'Holiday' }).check();
  await page.getByLabel('Label (only you see this)').fill('Lunch');
  await page.getByRole('button', { name: 'Block this time' }).click();
  await expect(page).toHaveURL(/\/BID-1\/calendar$/);
  expect(inserted).toEqual([expect.arrayContaining([expect.objectContaining({ artist_business_id: businessId, location_id: locationId, reason: 'holiday', label: 'Lunch' })])]);
});

test('TC-SCR-19A-01 New location requires a type of place and working hours', async ({ page }) => {
  await openOperatorPage(page, '/');
  const sent: Recorded[] = [];
  await functionMock(page, 'location-save', () => ({ id: locationId }), sent);
  await page.goto('/BID-1/settings/locations/new');
  await expect(page.getByRole('heading', { level: 1, name: 'Where else do you work?' })).toBeVisible();
  const placeType = page.getByRole('combobox', { name: 'Type of place' });
  await expect(placeType).toHaveValue('');
  await expect(placeType.locator('option')).toHaveText(['Choose a type of place', 'Suite rental', 'Booth rental', 'Salon', 'Home studio', 'I travel to clients']);
  await expect(page.getByRole('button', { name: 'Tuesday' })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: 'Monday' })).toHaveAttribute('aria-pressed', 'false');

  await page.getByLabel('Location name').fill('Studio 9 Suites');
  await page.getByLabel('Address').fill('210 Main St, Suite 4');
  await page.getByRole('button', { name: 'Save location' }).click();
  await expect(page.getByText('Choose a type of place.', { exact: true })).toBeVisible();
  expect(sent).toEqual([]);

  await placeType.selectOption({ label: 'Suite rental' });
  await page.getByRole('button', { name: 'Tuesday' }).click();
  await page.getByRole('button', { name: 'Thursday' }).click();
  await page.getByRole('button', { name: 'Friday' }).click();
  await page.getByLabel('Opens').fill('09:00');
  await page.getByLabel('Closes').fill('17:00');
  await page.getByRole('button', { name: 'Save location' }).click();
  await expect(page).toHaveURL(/\/BID-1\/settings\/locations$/);
  const body = sent[0]?.body as Record<string, unknown> | undefined;
  expect(body).toMatchObject({ name: 'Studio 9 Suites', location_type: 'suite', booking_mode: 'instant', calendar_ownership: 'mova', payment_collector: 'artist', address: { street: '210 Main St, Suite 4' } });
  expect((body?.hours as Array<{ weekday: number }>).map((row) => row.weekday)).toEqual([2, 4, 5]);
  expect(body?.policies).toMatchObject({ lead_time_minutes: 720, booking_horizon_days: 56, buffer_after_minutes: 15 });
});

for (const width of [320, 430]) {
  test(`Edit location saves below the form at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 640 });
    await openOperatorPage(page, '/');
    await rows(page, 'mova_locations', [{
      id: locationId, name: 'Studio 9 Suites', location_type: 'suite', booking_mode: 'instant',
      calendar_ownership: 'mova', payment_collector: 'artist', time_zone: 'America/New_York',
      address: { street: '210 Main St, Suite 4' }, display_color_index: 2,
    }]);
    await rows(page, 'mova_location_hours', [{ weekday: 2, opens_at: '09:00:00', closes_at: '17:00:00' }]);
    await rows(page, 'mova_location_policies', [{ lead_time_minutes: 60, booking_horizon_days: 28, buffer_after_minutes: 10 }]);
    await rows(page, 'mova_location_exceptions', []);
    const sent: Recorded[] = [];
    await functionMock(page, 'location-save', () => ({ id: locationId }), sent);
    await page.goto(`/BID-1/settings/locations/new?location_id=${locationId}`);

    const kind = page.getByRole('combobox', { name: 'Type of place' });
    const save = page.getByRole('button', { name: 'Save changes' });
    await expect(kind).toHaveValue('suite');
    await expect(save).not.toBeInViewport();
    await kind.selectOption({ label: 'Home studio' });

    const bookAhead = page.getByRole('combobox', { name: 'Book ahead' });
    await bookAhead.scrollIntoViewIfNeeded();
    await expect(bookAhead).toBeInViewport();
    const rulesBounds = await page.getByRole('region', { name: 'Booking rules' }).boundingBox();
    const saveBounds = await save.boundingBox();
    expect(saveBounds!.y).toBeGreaterThan(rulesBounds!.y + rulesBounds!.height);
    await save.click();
    await expect(page).toHaveURL(/\/BID-1\/settings\/locations$/);
    expect(sent[0]?.body).toMatchObject({
      location_id: locationId, location_type: 'home_studio',
      hours: [{ weekday: 2, opens_at: '09:00', closes_at: '17:00' }],
      policies: { lead_time_minutes: 60, booking_horizon_days: 28, buffer_after_minutes: 10 },
    });
  });
}

test('TC-SCR-37-01 Reports opens Money from the revenue card and links the marketing rows', async ({ page }) => {
  await openOperatorPage(page, '/reports');
  await expect(page.getByRole('heading', { level: 1, name: 'Reports' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open Money' })).toHaveAttribute('href', '/BID-1/money');
  await expect(page.getByRole('link', { name: /Reputation/ })).toHaveAttribute('href', '/BID-1/reports/reputation');
  await expect(page.getByRole('link', { name: /Seat filler/ })).toHaveAttribute('href', '/BID-1/growth/slots');
  await expect(page.getByRole('link', { name: /Rebooking reminders/ })).toHaveAttribute('href', '/BID-1/growth/pipeline');
});

test('TC-SCR-43-01 Teach your concierge saves a permission from its toggle', async ({ page }) => {
  await openOperatorPage(page, '/');
  const sent: Recorded[] = [];
  await functionMock(page, 'concierge-artist', (body) => body.action === 'save-settings'
    ? { settings: {}, enabled: false }
    : body.action === 'save-knowledge'
      ? { knowledge: { id: 'knowledge-1', kind: 'faq', question: 'Do you offer silk press?', answer_en: 'Yes, book a consultation first.', answer_es: null, status: 'draft' } }
      : { settings: { enabled: false, globally_paused: true, channels: {}, permissions: { answer: true, book_instant: false, request_salon: false, reschedule: false } }, conversations: [], handoffs: [], knowledge: [], aiEnabled: false }, sent);
  await page.goto('/BID-1/growth/concierge/setup');
  await expect(page.getByRole('heading', { level: 1, name: 'Teach your concierge' })).toBeVisible();
  await expect(page.getByText("It always says it's your AI assistant.")).toBeVisible();
  await expect(page.getByText('Quotes, exceptions, complaints')).toBeVisible();
  await page.getByRole('switch', { name: 'Reschedule within your policy' }).click();
  await expect.poll(() => sent.filter((item) => (item.body as { action?: string }).action === 'save-settings').length).toBe(1);
  expect(sent.find((item) => (item.body as { action?: string }).action === 'save-settings')?.body).toMatchObject({ action: 'save-settings', permissions: expect.objectContaining({ reschedule: true, answer: true }) });
  await expect(page.getByRole('switch', { name: 'Reschedule within your policy' })).toBeEnabled();
  await page.getByRole('button', { name: /FAQs & how to prep/ }).click();
  const permissionRow = page.locator('label.mova-toggle', { hasText: 'Reschedule within your policy' });
  expect((await permissionRow.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await page.getByRole('textbox', { name: 'Question' }).fill('Do you offer silk press?');
  await page.locator('main.mova-page textarea').nth(0).fill('Yes, book a consultation first.');
  const saveAnswer = page.getByRole('button', { name: 'Save information' });
  expect((await saveAnswer.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await saveAnswer.click();
  await expect.poll(() => sent.filter((item) => (item.body as { action?: string }).action === 'save-knowledge').length).toBe(1);
  expect(sent.find((item) => (item.body as { action?: string }).action === 'save-knowledge')?.body).toMatchObject({ action: 'save-knowledge', question: 'Do you offer silk press?', answer_en: 'Yes, book a consultation first.' });
});

test('TC-AI-09 Concierge labels web chat and open conversations, then pauses every reply', async ({ page }) => {
  await openOperatorPage(page, '/');
  const sent: Recorded[] = [];
  let paused = false;
  await functionMock(page, 'concierge-artist', (body) => {
    if (body.action === 'pause') { paused = true; return { paused: true }; }
    return { settings: { enabled: !paused, globally_paused: paused, channels: {}, permissions: {} }, conversations: [{ id: 'conversation-1', channel: 'web_chat', client_id: clientId, locale: 'en-US', status: 'open', last_message_at: new Date().toISOString(), mova_clients: { display_name: 'Simone A.' } }], handoffs: [], knowledge: [], metrics: {}, aiEnabled: !paused };
  }, sent);
  await page.goto('/BID-1/growth/concierge');
  await expect(page.getByText(/Web chat · Open/)).toBeVisible();
  const pauseButton = page.getByRole('button', { name: 'Pause the concierge' });
  expect((await pauseButton.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await pauseButton.click();
  await expect.poll(() => sent.some((item) => (item.body as { action?: string }).action === 'pause')).toBe(true);
  await expect(page.getByText('Paused · AI replies wait for approval')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Paused · AI replies wait for approval' })).toBeDisabled();
});
