import { expect, test, type Page, type Route } from '@playwright/test';
import { openOperatorPage } from './operator-session';

// Task 5.1: the stylist's campaign views (31, 31b, 31c) and the client's claim page (31d), mocked.
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-mova-artist-business-id', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (route: Route, data: unknown) => route.request().method() === 'OPTIONS' ? route.fulfill({ status: 204, headers: cors }) : route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ data, error: null }) });
const token = 'a'.repeat(48);
const slot = { stylist: 'Ari Monroe', handle: 'ari-monroe', starts_at: '2026-12-04T15:00:00Z', ends_at: '2026-12-04T16:30:00Z', time_zone: 'America/New_York', location: 'Studio 9', booking_mode: 'instant', service: 'Silk press', price_minor: 15000 };
const candidate = (n: number, wave: number, status: string, name: string) => ({ id: `c${n}`, status, wave, rank: n, reasons: ['due'], mova_clients: { display_name: name } });
const campaign = (status: string, current: number, candidates: unknown[]) => ({ id: `slot-${status}`, status, starts_at: slot.starts_at, ends_at: slot.ends_at, expires_at: '2026-12-04T13:00:00Z', current_wave: current, wave_minutes: 20, next_wave_at: '2026-12-02T15:22:00Z', filled_at: status === 'filled' ? '2026-12-02T15:14:00Z' : null, value_minor: 15000,
  mova_locations: { name: 'Studio 9' }, mova_services: { name: 'Silk press', base_price_minor: 15000 }, mova_slot_candidates: candidates,
  mova_slot_campaign_copy: { sms_example: 'A spot just opened Fri, Dec 04 at 10:00 AM at Studio 9 for Silk press. First to book gets it: [claim link]. Reply STOP to opt out. — Ari', taken_message: 'That spot was just taken. Here are other times: [booking link]', social_caption: '', approved_at: null } });

async function mockCampaigns(page: Page, actions: string[]) {
  await page.route('**/functions/v1/slot-campaign', (route) => {
    if (route.request().method() !== 'OPTIONS') { const body = route.request().postDataJSON(); if (body.action !== 'list') actions.push(`${body.action}:${body.slot_event_id}`); }
    return json(route, { outboundEnabled: true, campaigns: [
      campaign('needs_approval', 0, [candidate(1, 1, 'planned', 'Jordan Price'), candidate(2, 1, 'planned', 'Kim Tran'), candidate(3, 2, 'planned', 'Lena Moss')]),
      campaign('live', 1, [candidate(4, 1, 'messaged', 'Ana Ruiz'), candidate(5, 2, 'planned', 'Bea Cole')]),
      campaign('filled', 1, [candidate(6, 1, 'claimed', 'Jordan Price'), candidate(7, 1, 'notified_taken', 'Kim Tran')]),
    ] });
  });
}

test('TC-SLOT-31-01 review, approve, send the next wave and see who booked', async ({ page }) => {
  await openOperatorPage(page, '/');
  const actions: string[] = [];
  await mockCampaigns(page, actions);
  await page.goto('/BID-1/growth/slots');
  await expect(page.getByText('3 clients fit this slot')).toBeVisible();
  await expect(page.getByText('Reply STOP to opt out', { exact: false })).toBeVisible();
  await expect(page.getByText('Live · wave 1 of 2')).toBeVisible();
  await expect(page.getByText('Jordan Price booked it')).toBeVisible();
  await page.getByRole('button', { name: 'Approve text & send wave 1' }).click();
  await page.getByRole('button', { name: 'Send wave 2 now' }).click();
  await expect.poll(() => actions).toEqual(['approve:slot-needs_approval', 'send-next-wave:slot-live']);
});

test('TC-SLOT-31D-01 a client claims an open spot', async ({ page }) => {
  let claimed = false;
  await page.route('**/functions/v1/slot-claim', (route) => {
    if (route.request().method() !== 'OPTIONS' && route.request().postDataJSON().action === 'claim') claimed = true;
    return json(route, claimed ? { status: 'claimed', slot, appointment_status: 'confirmed' } : { status: 'open', slot });
  });
  await page.goto(`/slot/${token}`);
  await expect(page.getByText('Just opened for you')).toBeVisible();
  await expect(page.getByText('Silk press · $150')).toBeVisible();
  await expect(page.getByText('One spot. First to book gets it.')).toBeVisible();
  await page.getByRole('button', { name: 'Claim this spot' }).click();
  await expect(page.getByRole('heading', { name: "It's yours" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

test('TC-SLOT-31D-02 a late claim is told the spot was taken, with other times', async ({ page }) => {
  await page.route('**/functions/v1/slot-claim', (route) => json(route, { status: 'taken', slot }));
  await page.goto(`/slot/${token}`);
  await expect(page.getByRole('heading', { name: 'Someone grabbed that spot' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'See all times' })).toHaveAttribute('href', '/a/ari-monroe/book');
});
