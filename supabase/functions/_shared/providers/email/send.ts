import { FakeEmailProvider } from './fake.ts';
import { reserveSpend } from '../spend.ts';
import { ResendEmailProvider } from './resend.ts';
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

async function logEmailProvider(db: EmailDb, input: SendEmailInput, provider: string, status: 'sent' | 'failed', reference?: string) {
  try {
    await db.rpc('mova_system_log_append', { p_level: status === 'sent' ? 'info' : 'error', p_source: 'provider',
      p_event_name: status === 'sent' ? 'provider.email.sent' : 'provider.email.failed', p_route_or_function: 'email.send',
      p_artist_business_id: input.artistBusinessId, p_client_id: input.clientId, p_error_code: status === 'failed' ? 'EMAIL_PROVIDER_ERROR' : null,
      p_message: status === 'sent' ? 'Email provider accepted message' : 'Email provider request failed',
      p_context: { provider, provider_reference: reference ?? null } });
  } catch { /* Provider logging is best effort. */ }
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MOVA_EMAIL_DOMAIN = 'mova-beauty.co';

/**
 * Who an email is from. Emails to the stylist (stylist_*) come from Mova at hello@. Client emails come from
 * the stylist's own Mova address, {handle}@mova-beauty.co, with replies going to the stylist's email.
 */
export async function emailSender(db: EmailDb, input: Pick<SendEmailInput, 'artistBusinessId' | 'templateId' | 'vars'>): Promise<{ name: string; address: string; replyTo: string | null }> {
  if (input.templateId.startsWith('stylist_')) return { name: 'Mova', address: `hello@${MOVA_EMAIL_DOMAIN}`, replyTo: null };
  const name = input.vars.businessName || 'Mova';
  try {
    const { data } = await db.rpc('mova_artist_email_sender', { p_artist_business_id: input.artistBusinessId });
    const handle = typeof data?.handle === 'string' && /^[a-z0-9-]{3,30}$/.test(data.handle) ? data.handle : null;
    const replyTo = typeof data?.reply_to === 'string' && emailPattern.test(data.reply_to) ? data.reply_to : null;
    return { name, address: handle ? `${handle}@${MOVA_EMAIL_DOMAIN}` : `bookings@${MOVA_EMAIL_DOMAIN}`, replyTo };
  } catch {
    return { name, address: `bookings@${MOVA_EMAIL_DOMAIN}`, replyTo: null };
  }
}

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
  const sender = await emailSender(db, input);
  const sendInput = { to, from: `${sender.name.replace(/[<>\r\n]/g, '')} <${sender.address}>`, ...(sender.replyTo ? { replyTo: sender.replyTo } : {}), ...rendered, templateId: input.templateId, locale: input.locale, idempotencyKey: input.idempotencyKey };
  const spend = await reserveSpend(db, row.id, provider.estimateCostMicros?.(sendInput) ?? 0, now);
  if (!spend.allowed) {
    if (spend.reason === 'spend_cap_reached') return { status: 'suppressed', reason: 'spend_cap_reached' };
    await db.from('mova_messages').update({ status: 'failed', error_code: 'SPEND_CHECK_UNAVAILABLE' }).eq('id', row.id);
    return { status: 'failed', messageId: row.id, error: 'SPEND_CHECK_UNAVAILABLE' };
  }
  try {
    const sent = await provider.send(sendInput);
    await db.from('mova_messages').update({ status: 'sent', provider_message_id: sent.providerMessageId, sent_at: now.toISOString() }).eq('id', row.id);
    await logEmailProvider(db, input, provider.name, 'sent', sent.providerMessageId);
    return { status: 'sent', messageId: row.id, providerMessageId: sent.providerMessageId };
  } catch {
    await db.from('mova_messages').update({ status: 'failed', error_code: 'PROVIDER_ERROR' }).eq('id', row.id);
    await logEmailProvider(db, input, provider.name, 'failed');
    return { status: 'failed', messageId: row.id, error: 'PROVIDER_ERROR' };
  }
}

/** The fake, or Resend only with an explicit live switch and complete configuration; else null. */
export function emailProviderFromEnv(env: (name: string) => string | undefined, fetcher: typeof fetch = fetch): EmailProvider | null {
  const choice = env('MOVA_EMAIL_PROVIDER');
  if (choice === 'fake') return new FakeEmailProvider();
  if (choice === 'resend' && env('MOVA_MESSAGING_LIVE_EMAIL') === 'true') {
    const apiKey = env('RESEND_API_KEY'), fromAddress = env('MOVA_EMAIL_FROM');
    if (!apiKey || !fromAddress) return null;
    const cost = Number(env('MOVA_EMAIL_COST_MICROS'));
    try {
      return new ResendEmailProvider({ apiKey, fromAddress, costMicros: Number.isSafeInteger(cost) && cost > 0 ? cost : undefined }, fetcher);
    } catch { return null; }
  }
  return null;
}
