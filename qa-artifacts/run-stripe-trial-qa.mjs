import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const api = 'http://127.0.0.1:55427';
const web = 'http://127.0.0.1:4177';
const { SUPABASE_ANON_KEY: anon, SUPABASE_SERVICE_ROLE_KEY: service } = process.env;
assert(anon && service, 'Load the isolated local QA credentials before running');
const useStripeSubscriptionApi = process.env.QA_STRIPE_FLOW === 'api';
const caseSelection = process.argv[2];
assert(!caseSelection || ['free', 'paid-conversion', 'payment-failed'].includes(caseSelection));
const modeFolder = useStripeSubscriptionApi ? 'trial-stripe-api' : 'trial-stripe';
const folder = 'qa-artifacts/evidence/' + modeFolder + (caseSelection && caseSelection !== 'free' ? '/' + caseSelection : '');
const run = String(Date.now());
const days = 864e5;
const report = [];
const key = (await readFile('.env.local','utf8')).match(/^STRIPE_SECRET_KEY\s*=\s*['"]?((?:sk|rk)_test_[A-Za-z0-9_]+)/m)?.[1];
assert(key, 'A test Stripe key is required');
const sandboxPrices = JSON.parse(await readFile(process.env.QA_STRIPE_PRICE_FILE, 'utf8'));
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
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    const stripeHost = /(?:^|\.)(stripe\.com|stripe\.network|stripecdn\.com|link\.com)$/.test(url.hostname);
    return [api, web].includes(url.origin) || (url.protocol === 'https:' && stripeHost) ? route.continue() : route.abort();
  });
  await context.addInitScript(value => localStorage.setItem('sb-127-auth-token', JSON.stringify(value)), session);
  return { business, user, email, page: await context.newPage(), index, session };
}

async function stripe(path, options) {
  const res = await fetch('https://api.stripe.com/v1/' + path, {
    method: options ? 'POST' : 'GET',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: options ? new URLSearchParams(options) : undefined,
  });
  const body = await res.json();
  assert(res.ok, `${path.split('/')[0]} returned ${res.status} ${body.error?.code ?? ''} ${body.error?.param ?? ''}`);
  assert.notEqual(body.livemode, true);
  return body;
}

function operator(fixture, endpoint, body) {
  return call('/functions/v1/' + endpoint, {
    body, token: fixture.session.access_token,
    headers: { apikey: anon, 'x-mova-artist-business-id': fixture.business.id },
  }).then(({ data }) => data);
}
const trialStatus = fixture => rpc('mova_trial_status_internal', { p_artist_business_id: fixture.business.id, p_user: fixture.user.id });
const update = (table, id, body) => rest(`${table}?artist_business_id=eq.${id}`, { method: 'PATCH', body });
const screenshot = (page, name) => page.screenshot({ path: `${folder}/${name}.png`, fullPage: true });
async function observe(name, action) {
  try {
    report.push({ name, status: 'PASS', evidence: await action() });
  } catch (error) {
    report.push({ name, status: 'FAIL OR BLOCKED', evidence: String(error.message).split('\n')[0].replace(/cs_test_[A-Za-z0-9_]+/g, '[checkout session]') });
  }
  console.log(report.at(-1));
  await writeFile(`${folder}/results.json`, JSON.stringify(report, null, 2) + '\n');
}
async function poll(read, match, label, ms = 90000) {
  const end = Date.now() + ms;
  let value;
  while (Date.now() < end) {
    value = await read();
    if (match(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 1300));
  }
  throw Error(`${label} did not reach the expected state${value?.status ? ' (last status: ' + value.status + ')' : ''}`);
}
const start = Math.floor(Date.now() / 1000);
const basePath = fixture => `/BID-${fixture.business.business_number}`;
const home = fixture => fixture.page.goto(web + basePath(fixture));

async function addClock(fixture, label) {
  fixture.clock = await stripe('test_helpers/test_clocks', { name: 'Mova trial QA ' + label, frozen_time: start });
  fixture.customer = await stripe('customers', { email: fixture.email, test_clock: fixture.clock.id });
  assert.equal(fixture.customer.test_clock, fixture.clock.id);
  await insert('mova_billing_subscriptions', {
    artist_business_id: fixture.business.id, stripe_customer_id: fixture.customer.id,
    status: 'incomplete', plan_key: 'ai_growth', livemode: false,
  });
}

async function startInStripe(fixture, card, suffix) {
  if (!useStripeSubscriptionApi) return checkout(fixture, card, suffix);
  const testMethod = card.endsWith('0341') ? 'pm_card_chargeCustomerFail' : 'pm_card_visa';
  const method = await stripe('payment_methods/' + testMethod + '/attach', { customer: fixture.customer.id });
  assert.equal(method.livemode, false);
  const sub = await stripe('subscriptions', {
    customer: fixture.customer.id,
    'items[0][price]': sandboxPrices.MOVA_STRIPE_PRICE_AI_GROWTH,
    trial_end: start + 30 * 86400,
    default_payment_method: method.id,
    'metadata[artist_business_id]': fixture.business.id,
    'metadata[plan_key]': 'ai_growth',
    'metadata[trial]': 'true',
  });
  assert.equal(sub.test_clock, fixture.clock.id);
  assert.equal(sub.status, 'trialing');
  fixture.subscription = sub.id;
  const events = await webhook(fixture, 'customer.subscription.created', obj => obj.id === sub.id);
  await poll(() => trialStatus(fixture), r => r.state === 'trialing', 'Mova trial start');
  await home(fixture);
  await fixture.page.getByText(/AI \+ Growth free trial · 30 days left/).waitFor({ timeout: 12000 });
  await screenshot(fixture.page, suffix + '-t3');
  return { start: 'Stripe Subscriptions API', clock: fixture.clock.id, subscription: sub.id, card: card.slice(-4), stripeStatus: sub.status, app: 'T3 visible', webhooks: events };
}

async function checkout(fixture, card, suffix) {
  const page = fixture.page;
  await page.goto(web + basePath(fixture) + '/start-trial');
  await page.getByRole('button', { name: 'Add card and start free trial' }).click();
  await page.waitForURL(u => u.hostname === 'checkout.stripe.com', { timeout: 20000, waitUntil: 'domcontentloaded' });
  const sessionId = new URL(page.url()).pathname.split('/').find(part => part.startsWith('cs_test_'));
  assert(sessionId, 'Checkout must be in Stripe sandbox mode');
  const session = await stripe('checkout/sessions/' + sessionId);
  assert.equal(session.customer, fixture.customer.id);
  assert.equal(session.livemode, false);
  const findField = async (selector, ms = 12000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      for (const frame of page.frames()) {
        const field = frame.locator(selector).first();
        if (await field.isVisible().catch(() => false)) return field;
      }
      await page.waitForTimeout(300);
    }
    return null;
  };
  const fill = async (selector, value) => {
    const field = await findField(selector);
    assert(field, 'Checkout did not render ' + selector);
    await field.fill(value);
  };
  const redact = text => text.replace(/[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[redacted]');
  try {
    const email = await findField('#email, input[autocomplete=email]', 5000);
    if (email && await email.isEditable()) {
      await email.fill(fixture.email);
      await email.press('Tab');
    }
    for (const frame of page.frames()) {
      const cardTab = frame.getByRole('button', { name: /^Card$/i }).first();
      if (await cardTab.isVisible().catch(() => false)) await cardTab.click();
    }
    await fill('#cardNumber, input[autocomplete=cc-number], input[name=number]', card);
    await fill('#cardExpiry, input[autocomplete=cc-exp], input[name=expiry]', '1234');
    await fill('#cardCvc, input[autocomplete=cc-csc], input[name=cvc]', '123');
    const name = await findField('#billingName, input[autocomplete=cc-name]', 2000);
    if (name) await name.fill('Mova QA Trial');
    const country = await findField('select[name=country], select[autocomplete*=country], #payment-countryInput', 2000);
    if (country) await country.selectOption('US').catch(() => country.selectOption({label:'United States'}));
    const zip = await findField('#billingPostalCode, input[autocomplete*=postal-code], input[name=postalCode]', 4000);
    if (zip) await zip.fill('10001');
    const remember = await findField('#payment-linkOptInInput, input[name=linkOptIn]', 2000);
    if (remember && await remember.isChecked()) await remember.uncheck();
    let submitted = false;
    for (const frame of page.frames()) {
      const button = frame.getByRole('button', { name: /start (my |your )?(free )?trial|subscribe|confirm/i }).last();
      if (await button.isVisible().catch(() => false)) {
        await button.click();
        submitted = true;
        break;
      }
    }
    assert(submitted, 'Checkout did not render its submission button');
    await page.waitForURL(u => u.origin === web, { timeout: 25000, waitUntil: 'domcontentloaded' });
  } catch (error) {
    const structure = await Promise.all(page.frames().map(async frame => ({
      hostname: new URL(frame.url() || web).hostname,
      fields: await frame.locator('input').evaluateAll(items => items.map(el => ({ id: el.id, name: el.name, type: el.type, autocomplete: el.autocomplete }))).catch(() => []),
      buttons: await frame.getByRole('button').allTextContents().catch(()=>[]),
      alerts: (await frame.getByRole('alert').allTextContents().catch(()=>[])).map(redact),
      copy: redact(await frame.locator('body').innerText({timeout:2000}).catch(()=>'')).slice(0,2500),
    })));
    await writeFile(`${folder}/${suffix}-checkout-diagnostic.json`, JSON.stringify({ structure }, null, 2)+'\n');
    throw error;
  }
  const completed = await poll(() => stripe('checkout/sessions/' + sessionId), r => r.status === 'complete' && r.subscription, 'Checkout completion');
  fixture.subscription = completed.subscription;
  const sub = await stripe('subscriptions/' + fixture.subscription);
  assert.equal(sub.test_clock, fixture.clock.id);
  assert.equal(sub.status, 'trialing');
  assert.equal(sub.items.data[0].price.id, sandboxPrices.MOVA_STRIPE_PRICE_AI_GROWTH);
  await poll(() => trialStatus(fixture), r => r.state === 'trialing', 'Mova trial start');
  await home(fixture);
  await page.getByText(/AI \+ Growth free trial · 30 days left/).waitFor({ timeout: 12000 });
  await screenshot(page, suffix + '-t3');
  return { clock: fixture.clock.id, subscription: fixture.subscription, card: card.slice(-4), stripeStatus: sub.status, app: 'T3 visible' };
}

async function advance(fixture, target) {
  await stripe('test_helpers/test_clocks/' + fixture.clock.id + '/advance', { frozen_time: target });
  return poll(() => stripe('test_helpers/test_clocks/' + fixture.clock.id), c => c.status === 'ready' && c.frozen_time === target, 'Stripe test clock advance');
}

async function timeWindow(fixture, offset, remaining) {
  const clock = await advance(fixture, start + offset * 86400);
  const subscription = await stripe('subscriptions/' + fixture.subscription);
  assert.equal(subscription.status, 'trialing');
  await rpc('mova_enqueue_trial_messages', { p_now: iso(clock.frozen_time * 1000) });
  await rpc('mova_enqueue_trial_messages', { p_now: iso(clock.frozen_time * 1000) });
  const expected = 'trial.reminder_' + remaining + 'd';
  const outbox = await rest(`mova_outbox_events?select=event_type&artist_business_id=eq.${fixture.business.id}&event_type=eq.${expected}`, { method: 'GET' });
  assert.deepEqual(outbox, [{ event_type: expected }]);
  // Stripe advances its clock only. Project remaining days into the local browser read,
  // then restore Stripe's actual timestamp before more billing events are delivered.
  const projected = iso(Date.now() + (remaining - 0.001) * days);
  try {
    await update('mova_billing_subscriptions', fixture.business.id, { trial_end: projected });
    await home(fixture);
    await fixture.page.getByText(/Trial ends/).waitFor({ timeout: 12000 });
    assert.equal(await fixture.page.locator('.mova-trial-days b').innerText(), String(remaining));
    await screenshot(fixture.page, 't4-day' + offset);
  } finally {
    await update('mova_billing_subscriptions', fixture.business.id, { trial_end: iso(subscription.trial_end * 1000) });
  }
  return { clock: fixture.clock.id, daysAdvanced: offset, queued: expected, count: 1, app: 'T4 verified with local clock projection' };
}

async function webhook(fixture, eventType, predicate) {
  const matches = await poll(async () => {
    const feed = await stripe('events?limit=50&type=' + encodeURIComponent(eventType));
    return feed.data.filter(e => predicate(e.data.object));
  }, events => events.length > 0, 'sandbox ' + eventType);
  for (const event of matches) {
    assert.equal(event.livemode, false);
    await poll(() => rest(`mova_billing_events?select=type,processed_at,error&stripe_event_id=eq.${event.id}`, { method: 'GET' }), rows => !!rows[0]?.processed_at && rows[0].error === null, 'local signed ' + eventType);
  }
  return matches.map(event => event.id);
}

try {
  if (!process.argv[2] || process.argv[2] === 'free') {
  const free = await owner(4);
  await observe(useStripeSubscriptionApi ? '4242 trial start from Stripe API' : '4242 Checkout on Stripe test clock', async () => {
    await addClock(free, 'free');
    const evidence = await startInStripe(free, '4242424242424242', 'free');
    if (!useStripeSubscriptionApi) evidence.webhooks = await webhook(free, 'checkout.session.completed', obj => obj.subscription === free.subscription);
    return evidence;
  });
  if (free.subscription) {
    await observe('Day 23 reminder and T4', () => timeWindow(free, 23, 7));
    await observe('Day 29 reminder and T4', () => timeWindow(free, 29, 1));
    await observe('T7 free and lock', async () => {
      await operator(free, 'plan-management', { action: 'after_trial', plan: 'free' });
      assert.equal((await stripe('subscriptions/' + free.subscription)).cancel_at_period_end, true);
      await advance(free, start + 31 * 86400);
      const events = await webhook(free, 'customer.subscription.deleted', obj => obj.id === free.subscription);
      assert.equal((await trialStatus(free)).plan_key, 'free');
      await home(free);
      await free.page.getByText('Your trial has ended').waitFor({ timeout: 12000 });
      await screenshot(free.page, 't7-home');
      await free.page.goto(web + basePath(free) + '/settings/calendar-sync');
      await free.page.getByText('Calendar sync is locked').waitFor({ timeout: 12000 });
      await screenshot(free.page, 't7-lock');
      return { webhooks: events, app: 'Free and Calendar Sync lock visible' };
    });
  }
  }
  for (const [index, label, card, expected, type] of [
    [5, 'paid-conversion', '4242424242424242', 'active', 'invoice.paid'],
    [6, 'payment-failed', '4000000000000341', 'past_due', 'invoice.payment_failed'],
  ]) {
    if (process.argv[2] && process.argv[2] !== label) continue;
    await observe(label, async () => {
      const fixture = await owner(index);
      await addClock(fixture, label);
      const result = await startInStripe(fixture, card, label);
      await advance(fixture, start + 30 * 86400 + 60);
      await advance(fixture, start + 31 * 86400);
      const sub = await poll(() => stripe('subscriptions/' + fixture.subscription), value => value.status === expected, 'Stripe ' + expected);
      const events = await webhook(fixture, type, obj => (obj.subscription ?? obj.parent?.subscription_details?.subscription) === sub.id && (type !== 'invoice.paid' || obj.amount_paid > 0));
      const local = await poll(() => trialStatus(fixture), value => value.state === expected, 'Mova ' + expected);
      assert.equal(local.plan_key, 'ai_growth');
      if (expected === 'active') {
        await fixture.page.goto(web + basePath(fixture) + '/settings/plan');
        await fixture.page.getByText('AI + Growth', { exact: true }).first().waitFor({ timeout: 12000 });
      } else {
        await home(fixture);
        await fixture.page.getByText("Payment didn't go through").waitFor({ timeout: 12000 });
        await fixture.page.getByRole('button', { name: 'Update card' }).first().waitFor();
      }
      await screenshot(fixture.page, label);
      return { ...result, stripeStatus: sub.status, webhooks: events, app: expected === 'active' ? 'AI + Growth visible' : 'T11 and Update card visible' };
    });
  }
} finally {
  await browser.close();
}
if (report.some(item => item.status !== 'PASS')) process.exitCode = 1;
