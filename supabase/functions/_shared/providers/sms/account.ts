import type { SmsProvider } from './types.ts';

/**
 * Trial and billing texts to the stylist (D7). Not sendSms: that path is client-scoped and needs client
 * consent. These go from Mova's platform number (MOVA_ACCOUNT_SMS_FROM, never a stylist's number) to a
 * stylist who opted in (mova_account_sms_consents). Quiet hours 9:00–20:00 business time; at most 5 per
 * trial; skipped and logged until Twilio is live and the platform number covers account notifications.
 */
export type AccountSmsDb = {
  from(table: string): any;
};

export type AccountSmsInput = {
  userId: string; artistBusinessId: string; phone: string | null; eventType: string; body: string;
  idempotencyKey: string; timeZone: string; trialStartedAt?: string | null; now?: Date;
};
export type AccountSmsOutcome = { status: 'sent' | 'skipped' | 'failed' | 'deferred' | 'duplicate'; reason?: string; runAt?: string };

export const ACCOUNT_SMS_CAP = 5;

function localHour(now: Date, timeZone: string) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' }).formatToParts(now);
    return Number(parts.find((part) => part.type === 'hour')?.value ?? '12');
  } catch { return 12; }
}

/** The next 10:00 in the business time zone, as an instant. */
export function nextTenAm(now: Date, timeZone: string): Date {
  for (let hours = 1; hours <= 48; hours += 1) {
    const candidate = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000 + hours * 3_600_000);
    if (localHour(candidate, timeZone) === 10) return candidate;
  }
  return new Date(now.getTime() + 12 * 3_600_000);
}

export function inQuietHours(now: Date, timeZone: string) {
  const hour = localHour(now, timeZone);
  return hour < 9 || hour >= 20;
}

async function log(db: AccountSmsDb, input: AccountSmsInput, status: 'sent' | 'skipped' | 'failed' | 'deferred', reason: string | null, providerMessageId?: string) {
  const { error } = await db.from('mova_account_sms_log').insert({
    user_id: input.userId, artist_business_id: input.artistBusinessId, event_type: input.eventType,
    idempotency_key: status === 'deferred' ? `${input.idempotencyKey}:deferred:${(input.now ?? new Date()).toISOString().slice(0, 13)}` : input.idempotencyKey,
    phone_e164: input.phone, status, reason, provider_message_id: providerMessageId ?? null,
  });
  return error;
}

export async function sendAccountSms(db: AccountSmsDb, provider: SmsProvider | null, env: (name: string) => string | undefined, input: AccountSmsInput): Promise<AccountSmsOutcome> {
  const now = input.now ?? new Date();
  const { data: existing } = await db.from('mova_account_sms_log').select('id').eq('idempotency_key', input.idempotencyKey).maybeSingle();
  if (existing) return { status: 'duplicate' };
  if (!input.phone) return { status: 'skipped', reason: 'no_consent' };
  const from = env('MOVA_ACCOUNT_SMS_FROM');
  if (env('MOVA_MESSAGING_LIVE_SMS') !== 'true' || !provider || !from || !/^\+[1-9]\d{7,14}$/.test(from)) {
    await log(db, input, 'skipped', 'skipped_sms_not_live');
    return { status: 'skipped', reason: 'skipped_sms_not_live' };
  }
  let capQuery = db.from('mova_account_sms_log').select('id', { count: 'exact', head: true }).eq('user_id', input.userId).eq('status', 'sent');
  if (input.trialStartedAt) capQuery = capQuery.gte('created_at', input.trialStartedAt);
  const { count } = await capQuery;
  if ((count ?? 0) >= ACCOUNT_SMS_CAP) {
    await log(db, input, 'skipped', 'cap_reached');
    return { status: 'skipped', reason: 'cap_reached' };
  }
  if (inQuietHours(now, input.timeZone)) {
    const runAt = nextTenAm(now, input.timeZone).toISOString();
    const { error } = await db.from('mova_background_jobs').insert({
      job_type: 'account_sms', artist_business_id: input.artistBusinessId, run_at: runAt, idempotency_key: `account-sms:${input.idempotencyKey}`,
      payload: { user_id: input.userId, artist_business_id: input.artistBusinessId, event_type: input.eventType, body: input.body, idempotency_key: input.idempotencyKey, time_zone: input.timeZone, trial_started_at: input.trialStartedAt ?? null },
    });
    if (error && !/duplicate|23505/i.test(error.message)) return { status: 'failed', reason: 'DEFER_FAILED' };
    await log(db, input, 'deferred', 'quiet_hours');
    return { status: 'deferred', runAt };
  }
  try {
    const sent = await provider.send({ to: input.phone, from, body: input.body, idempotencyKey: input.idempotencyKey });
    await log(db, input, 'sent', null, sent.providerMessageId);
    return { status: 'sent' };
  } catch {
    await log(db, input, 'failed', 'PROVIDER_ERROR');
    return { status: 'failed', reason: 'PROVIDER_ERROR' };
  }
}

/** STOP / START / HELP sent to the platform number: account consent only, with the carrier confirmations. */
export function accountKeywordReply(keyword: 'stop' | 'start' | 'help') {
  return {
    stop: 'Mova: You won\'t get trial or billing texts anymore. Email and app notices continue. Reply START to turn texts back on.',
    start: 'Mova: Trial and billing texts are back on. Up to 5 texts about your trial and billing. Msg & data rates may apply. Reply STOP to opt out.',
    help: 'Mova: Trial and billing texts for stylists. Msg & data rates may apply. Reply STOP to opt out. Help: hello@mova-beauty.co',
  }[keyword];
}
