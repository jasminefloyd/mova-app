import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const api = 'http://127.0.0.1:55427';
const web = 'http://127.0.0.1:4177';
const { SUPABASE_ANON_KEY: anon, SUPABASE_SERVICE_ROLE_KEY: service } = process.env;
assert(anon && service, 'Load the isolated local QA credentials before running');
const folder = 'qa-artifacts/evidence/trial-local';
const run = String(Date.now());
const days = 864e5;
const report = [];
await mkdir(folder, { recursive: true });

async function call(path, { method = 'POST', body, token = service, headers = {} } = {}) {
  const response = await fetch(api + path, {
    method,
    headers: { Authorization: 'Bearer ' + token, apikey: token, 'Content-Type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const raw = await response.text();
  const data = raw ? JSON.parse(raw) : null;
  assert(response.ok, `${path.split('?')[0]} returned ${response.status} ${data?.error?.code ?? data?.code ?? ''}`);
  return data;
}

const rest = (path, options) => call('/rest/v1/' + path, options);
const insert = (table, body) => rest(table, { body, headers: { Prefer: 'return=representation' } });
const rpc = (name, body) => rest('rpc/' + name, { body });
const browser = await chromium.launch({ headless: true });
const iso = (time) => new Date(time).toISOString();

async function owner(index) {
  const email = `hello+qatest${run}${index}@mova-beauty.co`;
  const password = randomUUID();
  const user = await call('/auth/v1/admin/users', {
    body: { email, password, email_confirm: true, user_metadata: { first_name: 'QA', last_name: 'Trial' } },
  });
  const [business] = await insert('mova_artist_businesses', { name: 'Local QA trial ' + index, status: 'active' });
  await insert('mova_artist_memberships', { artist_business_id: business.id, user_id: user.id, status: 'active', role: 'owner' });
  await rest('mova_onboarding_progress?on_conflict=artist_business_id', {
    body: { artist_business_id: business.id, current_step: 'complete' },
    headers: { Prefer: 'resolution=merge-duplicates' },
  });
  const session = await call('/auth/v1/token?grant_type=password', {
    token: anon, body: { email, password },
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 950 }, serviceWorkers: 'block' });
  await context.route('**/*', route => [api, web].includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
  await context.addInitScript(value => localStorage.setItem('sb-127-auth-token', JSON.stringify(value)), session);
  return { business, user, page: await context.newPage(), index, session };
}

async function state(fixture, status, { endIn = 30, cancel = false, mark = 0, digits = '4242' } = {}) {
  return rpc('mova_apply_billing_state', {
    p_artist_business_id: fixture.business.id,
    p_customer: 'cus_qa' + run + fixture.index,
    p_subscription: 'sub_qa' + run + fixture.index,
    p_status: status,
    p_price_plan: 'ai_growth',
    p_trial_end: iso(Date.now() + endIn * days),
    p_cancel_at_period_end: cancel,
    p_current_period_end: iso(Date.now() + days * 30),
    p_livemode: false,
    p_card_brand: 'visa',
    p_card_last4: digits,
    p_card_fingerprint: 'localqa' + run + fixture.index,
    p_event_at: iso(Date.now() + mark * 1000),
    p_owner_user_id: fixture.user.id,
  });
}

async function evidence(fixture, name, expected, tail = '') {
  const page = fixture.page;
  await page.goto(`${web}/BID-${fixture.business.business_number}${tail}`);
  await page.getByText(expected, { exact: false }).first().waitFor({ state: 'visible', timeout: 12500 });
  await page.screenshot({ path: `${folder}/${name}.png`, fullPage: true });
}

async function runCase(id, action) {
  try {
    const note = await action();
    report.push({ id, result: 'PASS (local simulation)', note });
  } catch (error) {
    report.push({ id, result: 'NOT VERIFIED', note: String(error.message).split('\n')[0] });
  }
  console.log(report.at(-1));
  await writeFile(`${folder}/results.json`, JSON.stringify(report, null, 2) + '\n');
}

const trialStatus = fixture => rpc('mova_trial_status_internal', { p_artist_business_id: fixture.business.id, p_user: fixture.user.id });
async function reminders(fixture, end, before, type) {
  const simulationTime = iso(Date.parse(end) - before * days + 4 * 3600e3);
  await rpc('mova_enqueue_trial_messages', { p_now: simulationTime });
  await rpc('mova_enqueue_trial_messages', { p_now: simulationTime });
  const rows = await rest(`mova_outbox_events?select=event_type&artist_business_id=eq.${fixture.business.id}&event_type=eq.${type}`, { method: 'GET' });
  assert.deepEqual(rows, [{ event_type: type }]);
}

try {
  const free = await owner(1);
  await runCase('T3', async () => {
    assert.equal((await state(free, 'trialing')).trial_started, true);
    await evidence(free, 't3', /AI \+ Growth free trial · 30 days left/);
    return 'The real Home showed the 30-day trial strip after the local billing RPC wrote trialing.';
  });
  await runCase('T4, day 23', async () => {
    const original = await trialStatus(free);
    await reminders(free, original.ends_at, 7, 'trial.reminder_7d');
    await state(free, 'trialing', { endIn: 6.995, mark: 1 });
    assert.equal((await trialStatus(free)).days_left, 7);
    await evidence(free, 't4-day23', /Trial ends/);
    return 'The simulated scheduler queued exactly one 7-day reminder. The real Home showed the final-week banner.';
  });
  await runCase('T4, day 29', async () => {
    const previous = await trialStatus(free);
    await reminders(free, previous.ends_at, 1, 'trial.reminder_1d');
    await state(free, 'trialing', { endIn: 0.995, mark: 2 });
    assert.equal((await trialStatus(free)).days_left, 1);
    await evidence(free, 't4-day29', /Trial ends/);
    assert.equal(await free.page.locator('.mova-trial-days b').innerText(), '1');
    return 'The simulated scheduler queued exactly one 1-day reminder and the real Home showed one day left.';
  });
  await runCase('T7, end on Free', async () => {
    await rpc('mova_set_after_trial_plan', { p_artist_business_id: free.business.id, p_plan: 'free' });
    assert.equal((await state(free, 'canceled', { endIn: -1, cancel: true, mark: 3 })).trial_ended_free, true);
    assert.equal((await trialStatus(free)).plan_key, 'free');
    await evidence(free, 't7-home', 'Your trial has ended');
    await evidence(free, 't7-lock', 'Calendar sync is locked', '/settings/calendar-sync');
    return 'The real plan record became Free. Home offered Unlock and Calendar Sync displayed its lock.';
  });
  const paid = await owner(2);
  await runCase('Paid conversion', async () => {
    await state(paid, 'trialing');
    const outcome = await state(paid, 'active', { endIn: -1, mark: 1 });
    assert.equal(outcome.trial_converted, true);
    assert.equal((await trialStatus(paid)).plan_key, 'ai_growth');
    await evidence(paid, 'paid-plan', /AI \+ Growth/, '/settings/plan');
    return 'The real billing RPC persisted active AI + Growth and the owner’s Plan screen displayed AI + Growth.';
  });
  const failed = await owner(3);
  await runCase('T11', async () => {
    await state(failed, 'trialing', { digits: '0341' });
    await state(failed, 'past_due', { endIn: -1, digits: '0341', mark: 1 });
    assert.equal((await trialStatus(failed)).state, 'past_due');
    await evidence(failed, 't11', "Payment didn't go through");
    await failed.page.getByRole('button', { name: 'Update card', exact: true }).waitFor();
    return 'The local past-due state produced the real payment-failed Home banner and Update card action.';
  });
} finally {
  await browser.close();
}
if (report.some(entry => entry.result === 'NOT VERIFIED')) process.exitCode = 1;
