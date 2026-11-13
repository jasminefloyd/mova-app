import { describe, expect, it } from 'vitest';
import { FakeSmsProvider, fakeSignature } from './fake.ts';
import { handleInboundSms } from './inbound.ts';
import { isQuietHours, keywordReply, parseKeyword, toE164, underDailyCap } from './policy.ts';
import { sendSms, smsProviderFromEnv, type SmsDb } from './send.ts';
import { TwilioSmsProvider, twilioSignature } from './twilio.ts';
import { smsSegments } from '../spend.ts';
import { vi } from 'vitest';

type Row = Record<string, unknown> & { id: string };
function stubDb(gate: Record<string, unknown> | null, inbound: Record<string, unknown> | null = null, capped = false) {
  const rows: Row[] = [];
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const db: SmsDb = {
    rpc: async (name, args) => { calls.push({ name, args }); if (name === 'mova_messaging_reserve_spend') { if (capped) { const row = rows.find((r) => r.id === args.p_message_id); if (row) Object.assign(row, { status: 'suppressed', error_code: 'spend_cap_reached' }); } return { data: { allowed: !capped }, error: null }; } return name === 'mova_sms_send_gate' ? { data: gate, error: null } : { data: inbound, error: null }; },
    from: () => ({
      insert: (row) => ({ select: () => ({ single: async () => {
        if (rows.some((existing) => existing.idempotency_key === row.idempotency_key && existing.artist_business_id === row.artist_business_id)) return { data: null, error: { message: 'duplicate key value (23505)' } };
        const saved = { ...row, id: `m${rows.length + 1}` }; rows.push(saved); return { data: { id: saved.id }, error: null };
      } }) }),
      update: (fields) => ({ eq: (_column, value) => { const row = rows.find((item) => item.id === value); if (row) Object.assign(row, fields); return Promise.resolve({ error: null }); } }),
    }),
  };
  return { db, rows, calls };
}
const allowed = { allowed: true, reason: 'eligible', to: '+15551230001', from: '+15559990000', locale: 'en-US' };
const input = { artistBusinessId: 'b1', clientId: 'c1', purpose: 'offers' as const, origin: 'seat_filler' as const, body: 'A 3 PM slot opened.', idempotencyKey: 'slot:1:c1' };

describe('SMS keywords (task 4.4)', () => {
  it('recognises carrier keywords in English and Spanish, whole-message only', () => {
    for (const word of ['STOP', 'stop', ' Stop. ', 'unsubscribe', 'Cancel', 'END', 'quit', 'PARAR', 'alto!', 'Baja']) expect(parseKeyword(word)).toBe('stop');
    for (const word of ['START', 'unstop', 'yes']) expect(parseKeyword(word)).toBe('start');
    for (const word of ['HELP', 'info', 'Ayuda', '¿ayuda?']) expect(parseKeyword(word)).toBe('help');
    for (const text of ['please stop texting', 'stopped by', 'Can I book?', '']) expect(parseKeyword(text)).toBeNull();
  });
  it('writes STOP/HELP replies in the client language with the business name', () => {
    expect(keywordReply('stop', 'en-US', 'Rooted Beauty')).toContain('unsubscribed from Rooted Beauty');
    expect(keywordReply('help', 'es-US', 'Rooted Beauty')).toContain('Responde STOP');
  });
});

describe('quiet hours and caps (task 4.4)', () => {
  it('blocks 20:00–09:00 in the client time zone', () => {
    expect(isQuietHours(new Date('2026-11-09T01:30:00Z'), 'America/New_York')).toBe(true);   // 20:30 ET
    expect(isQuietHours(new Date('2026-11-09T13:59:00Z'), 'America/New_York')).toBe(true);   // 08:59 ET
    expect(isQuietHours(new Date('2026-11-09T14:00:00Z'), 'America/New_York')).toBe(false);  // 09:00 ET
    expect(isQuietHours(new Date('2026-11-09T14:00:00Z'), 'America/Los_Angeles')).toBe(true); // 06:00 PT
  });
  it('caps non-transactional texts per client per day', () => {
    expect(underDailyCap(0)).toBe(true);
    expect(underDailyCap(1)).toBe(false);
    expect(underDailyCap(1, 2)).toBe(true);
  });
  it('normalises US numbers to E.164', () => {
    expect(toE164('(555) 123-0001')).toBe('+15551230001');
    expect(toE164('1-555-123-0001')).toBe('+15551230001');
    expect(toE164('123')).toBeNull();
  });
});

describe('sendSms with the fake provider (task 4.4)', () => {
  it('sends through the gate and records the provider id', async () => {
    const { db, rows, calls } = stubDb(allowed);
    const fake = new FakeSmsProvider();
    const outcome = await sendSms(db, fake, input);
    expect(outcome.status).toBe('sent');
    expect(calls[0]).toMatchObject({ name: 'mova_sms_send_gate', args: { p_purpose: 'offers', p_client_id: 'c1' } });
    expect(fake.outbox).toHaveLength(1);
    expect(fake.outbox[0]).toMatchObject({ to: '+15551230001', from: '+15559990000', body: 'A 3 PM slot opened.' });
    expect(rows[0]).toMatchObject({ status: 'sent', provider: 'fake', origin: 'seat_filler', channel: 'sms' });
  });
  it('records suppressed sends with the reason and never calls the provider', async () => {
    for (const reason of ['consent_missing', 'suppressed', 'quiet_hours', 'daily_cap']) {
      const { db, rows } = stubDb({ allowed: false, reason });
      const fake = new FakeSmsProvider();
      expect(await sendSms(db, fake, input)).toMatchObject({ status: 'suppressed', reason });
      expect(fake.outbox).toHaveLength(0);
      expect(rows[0]).toMatchObject({ status: 'suppressed', error_code: reason });
    }
  });
  it('is idempotent on the key and marks provider failures', async () => {
    const { db, rows } = stubDb(allowed);
    const fake = new FakeSmsProvider();
    await sendSms(db, fake, input);
    expect(await sendSms(db, fake, input)).toEqual({ status: 'duplicate' });
    expect(fake.outbox).toHaveLength(1);
    fake.failOnce();
    expect((await sendSms(db, fake, { ...input, idempotencyKey: 'slot:2:c1' })).status).toBe('failed');
    expect(rows[1]).toMatchObject({ status: 'failed', error_code: 'PROVIDER_ERROR' });
  });
  it('only the fake can be configured', () => {
    expect(smsProviderFromEnv((name) => ({ MOVA_SMS_PROVIDER: 'fake' } as Record<string, string>)[name])?.live).toBe(false);
    expect(smsProviderFromEnv((name) => ({ MOVA_SMS_PROVIDER: 'twilio' } as Record<string, string>)[name])).toBeNull();
    expect(smsProviderFromEnv(() => undefined)).toBeNull();
  });
});

describe('inbound texts (task 4.4)', () => {
  it('verifies the fake webhook signature', async () => {
    const fake = new FakeSmsProvider('secret');
    const raw = JSON.stringify({ from: '+15551230001', to: '+15559990000', text: 'STOP', id: 'in_1' });
    const good = new Request('https://x.invalid', { method: 'POST', body: raw, headers: { 'x-mova-fake-sms-signature': await fakeSignature(raw, 'secret') } });
    expect(await fake.parseInbound(good)).toEqual({ from: '+15551230001', to: '+15559990000', text: 'STOP', providerMessageId: 'in_1' });
    const bad = new Request('https://x.invalid', { method: 'POST', body: raw, headers: { 'x-mova-fake-sms-signature': '0'.repeat(64) } });
    expect(await fake.parseInbound(bad)).toBeNull();
  });
  it('STOP records the change and sends one confirmation in the client language', async () => {
    const { db, rows, calls } = stubDb(null, { keyword: 'stop', businesses: [{ artist_business_id: 'b1', client_ids: ['c1'], locale: 'es-US', business_name: 'Rooted Beauty' }] });
    const fake = new FakeSmsProvider();
    const outcome = await handleInboundSms(db, fake, { from: '+15551230001', to: '+15559990000', text: 'parar', providerMessageId: 'in_1' });
    expect(outcome).toEqual({ keyword: 'stop', businesses: 1, replies: 1 });
    expect(calls[0]).toMatchObject({ name: 'mova_sms_handle_inbound', args: { p_keyword: 'stop', p_from: '+15551230001' } });
    expect(fake.outbox[0]!.body).toContain('Cancelaste');
    expect(rows[0]).toMatchObject({ purpose: 'keyword_stop', origin: 'transactional', status: 'sent' });
  });
  it('ordinary texts are logged without a reply', async () => {
    const { db } = stubDb(null, { keyword: null, businesses: [{ artist_business_id: 'b1', client_ids: [], locale: 'en-US', business_name: 'X' }] });
    const fake = new FakeSmsProvider();
    expect(await handleInboundSms(db, fake, { from: '+15551230001', to: '+15559990000', text: 'Running 5 min late', providerMessageId: null })).toEqual({ keyword: null, businesses: 1, replies: 0 });
    expect(fake.outbox).toHaveLength(0);
  });
});

describe('O4 spend cap and Twilio (Nov 8)', () => {
  it('pauses sending at the shared monthly cap without calling the provider', async () => {
    const { db, rows, calls } = stubDb(allowed, null, true);
    const fake = new FakeSmsProvider(null, 8300);
    expect(await sendSms(db, fake, input)).toMatchObject({ status: 'suppressed', reason: 'spend_cap_reached' });
    expect(fake.outbox).toHaveLength(0);
    expect(calls.find((c) => c.name === 'mova_messaging_reserve_spend')?.args).toMatchObject({ p_cost_micros: 8300 });
    expect(rows[0]).toMatchObject({ status: 'suppressed', error_code: 'spend_cap_reached' });
  });
  it('reserves the estimated cost before every send', async () => {
    const { db, calls } = stubDb(allowed);
    await sendSms(db, new FakeSmsProvider(null, 8300), input);
    expect(calls.map((c) => c.name)).toEqual(['mova_sms_send_gate', 'mova_messaging_reserve_spend', 'mova_system_log_append']);
  });
  it('counts SMS segments for the estimate', () => {
    expect(smsSegments('a'.repeat(160))).toBe(1);
    expect(smsSegments('a'.repeat(161))).toBe(2);
    expect(smsSegments('ñ'.repeat(70))).toBe(1);
    expect(smsSegments('💇'.repeat(35))).toBe(1);
    expect(smsSegments('💇'.repeat(36))).toBe(2);
  });
  const config = { accountSid: 'AC' + '0'.repeat(32), authToken: 'twilio-test-token-0000', webhookUrl: 'https://project.supabase.invalid/functions/v1/messaging-inbound-sms' };
  it('Twilio sends with basic auth and form fields, through a fake fetcher', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ sid: 'SM' + 'a'.repeat(32), status: 'queued' }, { status: 201 }));
    const twilio = new TwilioSmsProvider(config, fetcher);
    expect(await twilio.send({ to: '+15551230001', from: '+15559990000', body: 'Hi', idempotencyKey: 'k1' })).toEqual({ providerMessageId: 'SM' + 'a'.repeat(32), status: 'queued' });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe(`https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`);
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Basic ${btoa(`${config.accountSid}:${config.authToken}`)}`);
    expect(Object.fromEntries(new URLSearchParams(String(init?.body)))).toEqual({ To: '+15551230001', From: '+15559990000', Body: 'Hi' });
    expect(twilio.estimateCostMicros({ to: '', from: '', body: 'a'.repeat(200), idempotencyKey: '' })).toBe(16600);
  });
  it('Twilio errors and bad numbers throw', async () => {
    const twilio = new TwilioSmsProvider(config, vi.fn<typeof fetch>().mockResolvedValue(Response.json({ code: 21610, message: 'unsubscribed' }, { status: 400 })));
    await expect(twilio.send({ to: '+15551230001', from: '+15559990000', body: 'Hi', idempotencyKey: 'k' })).rejects.toThrow('TWILIO_SEND_FAILED_21610');
    await expect(twilio.send({ to: '555', from: '+15559990000', body: 'Hi', idempotencyKey: 'k' })).rejects.toThrow('TWILIO_NUMBER_INVALID');
  });
  it('Twilio inbound requires a valid X-Twilio-Signature and our account', async () => {
    const twilio = new TwilioSmsProvider(config);
    const params = { AccountSid: config.accountSid, From: '+15551230001', To: '+15559990000', Body: 'STOP', MessageSid: 'SM' + 'b'.repeat(32) };
    const body = new URLSearchParams(params).toString();
    const signature = await twilioSignature(config.authToken, config.webhookUrl, params);
    expect(await twilio.parseInbound(new Request(config.webhookUrl, { method: 'POST', body, headers: { 'x-twilio-signature': signature } })))
      .toEqual({ from: '+15551230001', to: '+15559990000', text: 'STOP', providerMessageId: params.MessageSid });
    expect(await twilio.parseInbound(new Request(config.webhookUrl, { method: 'POST', body: body.replace('STOP', 'START'), headers: { 'x-twilio-signature': signature } }))).toBeNull();
  });
  it('Twilio is wired only with the live switch and complete configuration', () => {
    const env = (values: Record<string, string>) => (name: string) => values[name];
    const full = { MOVA_SMS_PROVIDER: 'twilio', TWILIO_ACCOUNT_SID: config.accountSid, TWILIO_AUTH_TOKEN: config.authToken, MOVA_TWILIO_WEBHOOK_URL: config.webhookUrl };
    expect(smsProviderFromEnv(env(full))).toBeNull();
    expect(smsProviderFromEnv(env({ ...full, MOVA_MESSAGING_LIVE_SMS: 'true' }))?.name).toBe('twilio');
    expect(smsProviderFromEnv(env({ ...full, MOVA_MESSAGING_LIVE_SMS: 'true', TWILIO_AUTH_TOKEN: '' }))).toBeNull();
    expect(smsProviderFromEnv(env({ ...full, MOVA_MESSAGING_LIVE_SMS: 'true', TWILIO_ACCOUNT_SID: 'bad' }))).toBeNull();
  });
});
