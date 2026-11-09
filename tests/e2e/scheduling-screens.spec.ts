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

const services = [{ id: serviceId, name: 'Silk press', duration_minutes: 90, base_price_minor: 15000 }];
const serviceLinks = [{ service_id: serviceId, location_id: locationId, price_minor_override: null, duration_minutes_override: null }];
const clientsList = [{ id: clientId, client_number: 7, display_name: 'Simone A.', email: null, phone: null }];

test('TC-SCR-08B-01 the Calendar + opens the add choice sheet with three choices and Cancel', async ({ page }) => {
  await openOperatorPage(page, '/calendar');
  await page.getByRole('button', { name: 'New appointment' }).click();
  await expect(page).toHaveURL(/\/BID-1\/calendar\/add$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Add to your calendar' })).toBeVisible();
  await expect(page.getByRole('link', { name: /New appointment.*Book a client into a time/ })).toHaveAttribute('href', '/BID-1/calendar/new-appointment');
  await expect(page.getByRole('link', { name: /New client.*Add someone to your client list/ })).toHaveAttribute('href', '/BID-1/clients/new');
  await expect(page.getByRole('link', { name: /Block time.*Personal break, holiday or time off/ })).toHaveAttribute('href', '/BID-1/calendar/block-time');
  await page.getByRole('link', { name: 'Cancel' }).click();
  await expect(page).toHaveURL(/\/BID-1\/calendar$/);
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
  expect(sent.filter((item) => item.url.endsWith('/client-crud')).map((item) => item.body)).toEqual([
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
    if (route.request().url().includes('appointment_number')) return route.fulfill({ status: 200, contentType: 'application/json', headers: { ...cors, 'Content-Range': '0-0/1' }, body: JSON.stringify({ appointment_number: 21 }) });
    return route.fallback();
  });
  await functionMock(page, 'client-crud', () => clientsList, sent);
  await functionMock(page, 'artist-appointment-create', () => ({ appointment_id: 'e2500000-0000-4000-8000-000000000777' }), sent);
  await page.goto(`/BID-1/calendar/new-appointment?client=${clientId}`);

  await expect(page.getByRole('heading', { level: 1, name: 'New appointment' })).toBeVisible();
  await expect(page.getByLabel('Client')).toHaveValue(clientId);
  await page.getByLabel('Service').selectOption({ label: 'Silk press · 90 min · $150' });
  await expect(page.getByRole('status').filter({ hasText: 'is free' })).toBeVisible();
  await page.getByRole('button', { name: 'Book appointment' }).click();

  await expect(page).toHaveURL(/\/BID-1\/appointments\/AID-21$/);
  const booking = sent.find((item) => item.url.endsWith('/artist-appointment-create'));
  expect(booking?.body).toMatchObject({ artist_business_id: businessId, client_id: clientId, location_id: locationId, service_id: serviceId });
  expect(String((booking?.body as { starts_at?: string }).starts_at)).toMatch(/T\d{2}:\d{2}:00\.000Z$/);
  expect(booking?.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
});

test('TC-SCR-08C-02 New appointment says when the time is taken and does not book it', async ({ page }) => {
  await openOperatorPage(page, '/');
  const sent: Recorded[] = [];
  // A booking across the days around now, so the default date and time (10:00 in the location zone) collide.
  const day = 86_400_000;
  await rows(page, 'mova_services', services);
  await rows(page, 'mova_service_locations', serviceLinks);
  await rows(page, 'mova_appointments', [{ location_id: locationId, starts_at: new Date(Date.now() - 2 * day).toISOString(), ends_at: new Date(Date.now() + 2 * day).toISOString() }]);
  await functionMock(page, 'client-crud', () => clientsList, sent);
  await functionMock(page, 'artist-appointment-create', () => ({ appointment_id: 'x' }), sent);
  await page.goto(`/BID-1/calendar/new-appointment?client=${clientId}`);

  await page.getByLabel('Service').selectOption({ label: 'Silk press · 90 min · $150' });
  await expect(page.getByRole('status').filter({ hasText: 'overlaps another booking or block' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Book appointment' })).toBeDisabled();
  expect(sent.filter((item) => item.url.endsWith('/artist-appointment-create'))).toEqual([]);
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

test('TC-SCR-19A-01 New location needs a type of place, then saves with the board defaults', async ({ page }) => {
  await openOperatorPage(page, '/');
  const sent: Recorded[] = [];
  await functionMock(page, 'location-save', () => ({ id: locationId }), sent);
  await page.goto('/BID-1/settings/locations/new');
  await expect(page.getByRole('heading', { level: 1, name: 'Where else do you work?' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tuesday' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Monday' })).toHaveAttribute('aria-pressed', 'false');

  await page.getByLabel('Location name').fill('Studio 9 Suites');
  await page.getByLabel('Address').fill('210 Main St, Suite 4');
  await page.getByRole('button', { name: 'Save location' }).click();
  await expect(page.getByText('Choose a type of place.')).toBeVisible();
  expect(sent).toEqual([]);

  await page.getByRole('radio', { name: 'Suite rental' }).check();
  await page.getByRole('button', { name: 'Save location' }).click();
  await expect(page).toHaveURL(/\/BID-1\/settings\/locations$/);
  const body = sent[0]?.body as Record<string, unknown> | undefined;
  expect(body).toMatchObject({ name: 'Studio 9 Suites', location_type: 'suite', booking_mode: 'instant', calendar_ownership: 'mova', payment_collector: 'artist', address: { street: '210 Main St, Suite 4' } });
  expect((body?.hours as Array<{ weekday: number }>).map((row) => row.weekday)).toEqual([2, 4, 5]);
  expect(body?.policies).toMatchObject({ lead_time_minutes: 720, booking_horizon_days: 56, buffer_after_minutes: 15 });
});

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
    : { settings: { enabled: false, globally_paused: true, channels: {}, permissions: { answer: true, book_instant: false, request_salon: false, reschedule: false } }, conversations: [], handoffs: [], knowledge: [], aiEnabled: false }, sent);
  await page.goto('/BID-1/growth/concierge/setup');
  await expect(page.getByRole('heading', { level: 1, name: 'Teach your concierge' })).toBeVisible();
  await expect(page.getByText("It always says it's your AI assistant.")).toBeVisible();
  await expect(page.getByText('Quotes, exceptions, complaints')).toBeVisible();
  await page.getByRole('switch', { name: 'Reschedule within your policy' }).click();
  await expect.poll(() => sent.filter((item) => (item.body as { action?: string }).action === 'save-settings').length).toBe(1);
  expect(sent.find((item) => (item.body as { action?: string }).action === 'save-settings')?.body).toMatchObject({ action: 'save-settings', permissions: expect.objectContaining({ reschedule: true, answer: true }) });
});
