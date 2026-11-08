// O2 (2026-11-08): the early-access invite email. Sent once per approved waitlist signup by the job
// worker. It is a platform email (no stylist), stored in mova_messages with a null business so it
// counts toward the shared $50/month cap (0047) and respects global email suppressions.
import { reserveSpend } from '../spend.ts';
import type { EmailDb, SendEmailOutcome } from './send.ts';
import type { EmailLocale, EmailProvider } from './types.ts';

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function inviteSignupUrl(site: string) {
  const base = /^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(site.replace(/\/+$/, '')) ? site.replace(/\/+$/, '') : 'https://mova-beauty.co';
  return `${base}/auth`;
}

export function renderInviteEmail(locale: EmailLocale, email: string, signupUrl: string) {
  const es = locale === 'es-US';
  const subject = es ? 'Tu invitación al acceso anticipado de Mova' : "You're invited to Mova early access";
  const lines = es ? [
    'Hola,',
    'Te damos un lugar en el primer grupo de estilistas de Mova.',
    `Crea tu cuenta con este correo: ${email}. Si usas otro correo, no podrás registrarte.`,
    'Crear tu cuenta',
    '¿Preguntas? Responde a este correo.',
  ] : [
    'Hi,',
    "You have a place in Mova's first group of stylists.",
    `Create your account with this email address: ${email}. Signing up with a different address won't work.`,
    'Create your account',
    'Questions? Reply to this email.',
  ];
  const [greeting, lead, how, action, help] = lines as [string, string, string, string, string];
  const text = [greeting, '', lead, '', how, '', `${action}: ${signupUrl}`, '', help, '', '— Mova'].join('\n');
  const html = `<!doctype html><html lang="${es ? 'es' : 'en'}"><body style="font-family:Arial,sans-serif;color:#18392F">`
    + `<p>${escapeHtml(greeting)}</p><p>${escapeHtml(lead)}</p><p>${escapeHtml(how)}</p>`
    + `<p><a href="${escapeHtml(signupUrl)}" style="display:inline-block;padding:12px 20px;border-radius:24px;background:#18392F;color:#F7F5EF;text-decoration:none;font-weight:bold">${escapeHtml(action)}</a></p>`
    + `<p>${escapeHtml(help)}</p><p>— Mova</p></body></html>`;
  return { subject, text, html };
}

export type InviteEmailInput = { to: string; locale: EmailLocale; signupUrl: string; idempotencyKey: string; now?: Date };

export async function sendInviteEmail(db: EmailDb, provider: EmailProvider, input: InviteEmailInput): Promise<SendEmailOutcome> {
  const to = input.to.trim().toLowerCase();
  if (!emailPattern.test(to) || to.length > 320) return { status: 'suppressed', reason: 'contact_missing' };
  const { data: gate, error: gateError } = await db.rpc('mova_email_send_gate', { p_artist_business_id: null, p_email: to });
  if (gateError || !gate) return { status: 'failed', messageId: null, error: 'SEND_POLICY_UNAVAILABLE' };
  if (gate.allowed !== true) return { status: 'suppressed', reason: typeof gate.reason === 'string' ? gate.reason : 'suppressed' };
  const rendered = renderInviteEmail(input.locale, to, input.signupUrl);
  const now = input.now ?? new Date();
  const { data: row, error: insertError } = await db.from('mova_messages').insert({
    artist_business_id: null, client_id: null, direction: 'outbound', channel: 'email', purpose: 'early_access_invite',
    origin: 'system', body: `${rendered.subject}\n\n${rendered.text}`, provider: provider.name, status: 'queued', idempotency_key: input.idempotencyKey,
  }).select('id').single();
  if (insertError && /duplicate|23505/i.test(insertError.message)) return { status: 'duplicate' };
  if (insertError || !row) return { status: 'failed', messageId: null, error: 'MESSAGE_SAVE_FAILED' };
  const sendInput = { to, from: 'Mova <bookings@mova-beauty.co>', ...rendered, templateId: 'early_access_invite' as const, locale: input.locale, idempotencyKey: input.idempotencyKey };
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
