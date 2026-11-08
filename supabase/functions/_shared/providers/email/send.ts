import { FakeEmailProvider } from './fake.ts';
import { reserveSpend } from '../spend.ts';
import { SendGridEmailProvider } from './sendgrid.ts';
import { renderEmail, type AppointmentEmailVars } from './templates.ts';
import type { EmailLocale, EmailProvider, EmailTemplateId } from './types.ts';

type Result<T> = Promise<{ data: T | null; error: { message: string } | null }>;
export type EmailDb = {
  rpc(name: string, args: Record<string, unknown>): Result<Record<string, unknown>>;
  from(table: string): {
    insert(row: Record<string, unknown>): { select(columns: string): { single(): Result<{ id: string }> } };
    update(fields: Record<string, unknown>): { eq(column: string, value: string): PromiseLike<{ error: { message: string } | null }> };
  };
};

export type SendEmailInput = {
  artistBusinessId: string;
  clientId: string | null;
  to: string;
  templateId: EmailTemplateId;
  locale: EmailLocale;
  vars: AppointmentEmailVars;
  idempotencyKey: string;
  now?: Date;
};

export type SendEmailOutcome =
  | { status: 'sent'; messageId: string; providerMessageId: string }
  | { status: 'suppressed'; reason: string }
  | { status: 'duplicate' }
  | { status: 'failed'; messageId: string | null; error: string };

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The one way to send an email (task 4.3): suppression check (bounce/complaint/manual) via
 * mova_email_send_gate → durable mova_messages row (unique idempotency key) → provider → status.
 * These are transactional appointment emails, so consent does not apply; suppressions do.
 */
export async function sendEmail(db: EmailDb, provider: EmailProvider, input: SendEmailInput): Promise<SendEmailOutcome> {
  const to = input.to.trim().toLowerCase();
  if (!emailPattern.test(to) || to.length > 320) return { status: 'suppressed', reason: 'contact_missing' };
  const { data: gate, error: gateError } = await db.rpc('mova_email_send_gate', { p_artist_business_id: input.artistBusinessId, p_email: to });
  if (gateError || !gate) return { status: 'failed', messageId: null, error: 'SEND_POLICY_UNAVAILABLE' };
  if (gate.allowed !== true) return { status: 'suppressed', reason: typeof gate.reason === 'string' ? gate.reason : 'suppressed' };
  const rendered = renderEmail(input.templateId, input.locale, input.vars);
  const now = input.now ?? new Date();
  const { data: row, error: insertError } = await db.from('mova_messages').insert({
    artist_business_id: input.artistBusinessId, client_id: input.clientId, direction: 'outbound', channel: 'email',
    purpose: input.templateId, origin: 'transactional', body: `${rendered.subject}\n\n${rendered.text}`, provider: provider.name,
    status: 'queued', idempotency_key: input.idempotencyKey,
  }).select('id').single();
  if (insertError && /duplicate|23505/i.test(insertError.message)) return { status: 'duplicate' };
  if (insertError || !row) return { status: 'failed', messageId: null, error: 'MESSAGE_SAVE_FAILED' };
  const sendInput = { to, from: 'Mova <bookings@mova-beauty.co>', ...rendered, templateId: input.templateId, locale: input.locale, idempotencyKey: input.idempotencyKey };
  const spend = await reserveSpend(db, row.id, provider.estimateCostMicros?.(sendInput) ?? 0, now);
  if (!spend.allowed) {
    if (spend.reason === 'spend_cap_reached') return { status: 'suppressed', reason: 'spend_cap_reached' };
    await db.from('mova_messages').update({ status: 'failed', error_code: 'SPEND_CHECK_UNAVAILABLE' }).eq('id', row.id);
    return { status: 'failed', messageId: row.id, error: 'SPEND_CHECK_UNAVAILABLE' };
  }
  try {
    const sent = await provider.send(sendInput);
    await db.from('mova_messages').update({ status: 'sent', provider_message_id: sent.providerMessageId, sent_at: now.toISOString() }).eq('id', row.id);
    return { status: 'sent', messageId: row.id, providerMessageId: sent.providerMessageId };
  } catch {
    await db.from('mova_messages').update({ status: 'failed', error_code: 'PROVIDER_ERROR' }).eq('id', row.id);
    return { status: 'failed', messageId: row.id, error: 'PROVIDER_ERROR' };
  }
}

/** The fake, or SendGrid (O4) only with an explicit live switch and complete configuration; else null. */
export function emailProviderFromEnv(env: (name: string) => string | undefined, fetcher: typeof fetch = fetch): EmailProvider | null {
  const choice = env('MOVA_EMAIL_PROVIDER');
  if (choice === 'fake') return new FakeEmailProvider();
  if (choice === 'sendgrid' && env('MOVA_MESSAGING_LIVE_EMAIL') === 'true') {
    const apiKey = env('SENDGRID_API_KEY'), fromAddress = env('MOVA_EMAIL_FROM');
    if (!apiKey || !fromAddress) return null;
    const cost = Number(env('MOVA_EMAIL_COST_MICROS'));
    try {
      return new SendGridEmailProvider({ apiKey, fromAddress, sandbox: env('MOVA_SENDGRID_SANDBOX') === 'true',
        costMicros: Number.isSafeInteger(cost) && cost > 0 ? cost : undefined }, fetcher);
    } catch { return null; }
  }
  return null;
}
