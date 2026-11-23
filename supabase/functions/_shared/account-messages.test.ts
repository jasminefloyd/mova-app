import { describe, expect, it, vi } from 'vitest';
import { buildAccountMessage, deliverAccountMessage, type AccountContext } from './account-messages';
import { renderEmail } from './providers/email/templates';
import { inQuietHours, nextTenAm, sendAccountSms } from './providers/sms/account';
import { handleInboundSms } from './providers/sms/inbound';

// Free trial WP5: words for each channel (en and es), channel independence, account SMS rules and STOP.
const biz = 'e1060000-0000-4000-8000-00000000000a';
const context = (over: Partial<AccountContext> = {}): AccountContext => ({
  artist_business_id: biz, business_number: 42, locale: 'en-US', time_zone: 'America/New_York',
  owner: { user_id: 'u1', email: 'ari@example.com', first_name: 'Ari Monroe', sms: { phone: '+13125550148' } },
  subscription: { status: 'trialing', plan_key: 'ai_growth', pending_plan_key: 'ai_growth', trial_end: '2026-12-22T15:00:00Z', cancel_at_period_end: false, past_due_since: null, card_brand: 'visa', card_last4: '4242' },
  trial: { id: 't1', started_at: '2026-11-22T15:00:00Z', ends_at: '2026-12-22T15:00:00Z', after_trial_plan: 'ai_growth' },
  plans: { free: { display_name: 'Free', monthly_price_minor: 0 }, pro: { display_name: 'Pro', monthly_price_minor: 1900 }, ai_growth: { display_name: 'AI + Growth', monthly_price_minor: 3900 } },
  ...over,
});

describe('account message copy', () => {
  it('7-day reminder: EM13, push and text match the boards', () => {
    const message = buildAccountMessage('trial.reminder_7d', context())!;
    expect(message.email!.vars.subject).toBe('Your free trial ends Dec 22');
    expect(message.email!.vars.lead).toBe('On Dec 22 your AI + Growth plan starts at $39/month on Visa •• 4242.');
    expect(message.email!.vars.rows.map(([title]) => title)).toEqual(['Stay on AI + Growth · $39/month', 'Switch to Pro · $19/month', 'Go to Free · $0']);
    expect(message.push).toEqual({ title: 'Your free trial ends Dec 22', body: 'Then $39/month for AI + Growth. Tap to choose your plan.' });
    expect(message.sms).toBe('Mova: Your free trial ends Dec 22. Then AI + Growth is $39/mo on your card ending 4242. Keep it, or switch to Pro or Free: mova-beauty.co/plan');
  });
  it('1-day reminder follows the after-trial choice (Free: no charge)', () => {
    const message = buildAccountMessage('trial.reminder_1d', context({ subscription: { ...context().subscription!, cancel_at_period_end: true } }))!;
    expect(message.email!.vars.subject).toBe('Your free trial ends tomorrow');
    expect(message.email!.vars.lead).toBe("On Dec 22 you move to the Free plan. You won't be charged.");
    expect(message.sms).toContain("You move to Free and won't be charged.");
  });
  it('payment failed: deadline is 7 days after the first failure', () => {
    const message = buildAccountMessage('billing.payment_failed', context({ subscription: { ...context().subscription!, status: 'past_due', past_due_since: '2026-12-22T16:00:00Z' } }), { amount_minor: 3900, plan_key: 'ai_growth' })!;
    expect(message.push).toEqual({ title: "Payment didn't go through", body: 'Update your card by Dec 29 to keep AI + Growth.' });
    expect(message.sms).toBe("Mova: Your $39 payment for AI + Growth didn't go through. Update your card by Dec 29 to keep it: mova-beauty.co/plan");
    expect(message.email!.vars.tone).toBe('alert');
  });
  it('converted is push only; started is text only', () => {
    const converted = buildAccountMessage('trial.converted', context(), { amount_minor: 3900, plan_key: 'ai_growth' })!;
    expect(converted).toMatchObject({ email: null, sms: null, push: { title: "You're on AI + Growth", body: 'We charged $39 to Visa •• 4242. Thanks for staying with Mova.' } });
    expect(buildAccountMessage('trial.started', context())).toMatchObject({ email: null, push: null });
  });
  it('writes Spanish for Spanish-speaking stylists', () => {
    const message = buildAccountMessage('trial.ended_free', context({ locale: 'es-US' }))!;
    expect(message.email!.vars.subject).toBe('Tu prueba terminó. Estás en Gratis.');
    expect(message.push!.title).toBe('Tu prueba terminó');
    expect(message.sms!.startsWith('Mova: Estás en Gratis.')).toBe(true);
  });
  it('renders EM13–EM15 in the EM11 shell with the plan link', () => {
    const message = buildAccountMessage('trial.ended_free', context())!;
    const html = renderEmail('stylist_trial_ended', 'en-US', { clientName: '', businessName: 'Mova', serviceName: '', startsAt: '2026-12-22T15:00:00Z', timeZone: 'UTC', locationName: '',
      account: { ...message.email!.vars, url: 'https://mova-beauty.co/BID-42/settings/plan' }, postalAddress: 'Mova, 1 Main St' });
    expect(html.subject).toBe("Your trial has ended. You're on Free.");
    expect(html.html).toContain('https://mova-beauty.co/BID-42/settings/plan');
    expect(html.html).toContain('Unlock a plan');
    expect(html.text).toContain('Locked, and saved');
  });
});

function fakeDb(rows: Record<string, unknown[]> = {}) {
  const inserted: Array<[string, Record<string, unknown>]> = [];
  const builder = (table: string) => {
    const chain: any = {
      select: () => chain, eq: () => chain, is: () => chain, gte: () => chain,
      maybeSingle: async () => ({ data: (rows[table] ?? [])[0] ?? null, error: null }),
      insert: (row: Record<string, unknown>) => { inserted.push([table, row]); const p: any = Promise.resolve({ error: null }); p.select = () => ({ single: async () => ({ data: { id: 'm1' }, error: null }) }); return p; },
      update: () => ({ eq: async () => ({ error: null }) }),
      then: (resolve: (value: unknown) => void) => resolve({ data: rows[table] ?? [], count: (rows[table] ?? []).length, error: null }),
    };
    return chain;
  };
  return { from: builder, inserted, rpc: vi.fn(async () => ({ data: null, error: null })) };
}
const env = (values: Record<string, string>) => (name: string) => values[name];
const live = env({ MOVA_MESSAGING_LIVE_SMS: 'true', MOVA_ACCOUNT_SMS_FROM: '+18885550100' });
const provider = () => ({ name: 'fake', live: false, send: vi.fn(async () => ({ providerMessageId: 'SM1', status: 'sent' as const })), parseInbound: async () => null });
const smsInput = { userId: 'u1', artistBusinessId: biz, phone: '+13125550148', eventType: 'trial.reminder_7d', body: 'hi', idempotencyKey: 'k1', timeZone: 'America/New_York', now: new Date('2026-12-15T15:00:00Z') };

describe('account texts', () => {
  it('are skipped and logged until texting is live', async () => {
    const db = fakeDb();
    expect(await sendAccountSms(db as never, provider(), env({}), smsInput)).toEqual({ status: 'skipped', reason: 'skipped_sms_not_live' });
    expect(db.inserted[0]![1]).toMatchObject({ status: 'skipped', reason: 'skipped_sms_not_live' });
  });
  it('need consent', async () => {
    expect((await sendAccountSms(fakeDb() as never, provider(), live, { ...smsInput, phone: null })).reason).toBe('no_consent');
  });
  it('send from the platform number during the day', async () => {
    const sms = provider();
    expect((await sendAccountSms(fakeDb() as never, sms, live, smsInput)).status).toBe('sent');
    expect(sms.send).toHaveBeenCalledWith(expect.objectContaining({ from: '+18885550100', to: '+13125550148' }));
  });
  it('wait for 10:00 during quiet hours', async () => {
    const db = fakeDb();
    const outcome = await sendAccountSms(db as never, provider(), live, { ...smsInput, now: new Date('2026-12-23T03:00:00Z') });
    expect(outcome).toMatchObject({ status: 'deferred', runAt: '2026-12-23T15:00:00.000Z' });
    expect(db.inserted.find(([table]) => table === 'mova_background_jobs')![1]).toMatchObject({ job_type: 'account_sms' });
  });
  it('stop at 5 per trial', async () => {
    const capped = fakeDb();
    (capped as any).from = () => {
      const chain: any = { select: () => chain, eq: () => chain, gte: () => chain, maybeSingle: async () => ({ data: null, error: null }), insert: async () => ({ error: null }),
        then: (resolve: (value: unknown) => void) => resolve({ count: 5, error: null }) };
      return chain;
    };
    expect((await sendAccountSms(capped as never, provider(), live, smsInput)).reason).toBe('cap_reached');
  });
  it('quiet hours are 9:00–20:00 business time', () => {
    expect(inQuietHours(new Date('2026-12-15T13:59:00Z'), 'America/New_York')).toBe(true);
    expect(inQuietHours(new Date('2026-12-15T14:00:00Z'), 'America/New_York')).toBe(false);
    expect(nextTenAm(new Date('2026-12-15T02:00:00Z'), 'America/Los_Angeles').toISOString()).toBe('2026-12-15T18:00:00.000Z');
  });
  it('STOP to the platform number revokes account consent and confirms', async () => {
    const rpc = vi.fn(async () => ({ data: 1, error: null }));
    const sms = provider();
    const outcome = await handleInboundSms({ rpc } as never, sms as never, { from: '+13125550148', to: '+18885550100', text: 'STOP', providerMessageId: 'SMx' }, new Date(), '+18885550100');
    expect(rpc).toHaveBeenCalledWith('mova_account_sms_keyword', { p_phone: '+13125550148', p_keyword: 'stop' });
    expect(outcome).toEqual({ keyword: 'stop', businesses: 0, replies: 1 });
  });
});

describe('delivering an account message', () => {
  it('still sends the email when push and text fail', async () => {
    const db = fakeDb();
    db.rpc = vi.fn(async (name: string) => name === 'mova_account_message_context' ? { data: context(), error: null } : name === 'mova_email_send_gate' ? { data: { allowed: true }, error: null } : { data: { allowed: true }, error: null }) as never;
    const email = { name: 'fake', live: false, send: vi.fn(async () => ({ providerMessageId: 'em1', status: 'sent' as const })) };
    const broken = { ...provider(), send: vi.fn(async () => { throw new Error('down'); }) };
    const result = await deliverAccountMessage(db as never, { email, vapid: null, sms: broken as never, env: live, baseUrl: 'https://mova-beauty.co', now: new Date('2026-12-15T15:00:00Z') },
      { eventType: 'trial.reminder_7d', artistBusinessId: biz, outboxEventId: 'o1' });
    expect(email.send).toHaveBeenCalledTimes(1);
    expect(result.email).toBe('sent');
    expect(result.sms).toBe('failed');
  });
});
