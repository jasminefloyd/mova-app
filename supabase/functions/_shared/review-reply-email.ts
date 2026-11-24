import { sendEmail, type EmailDb, type EmailProvider } from './providers/email/index.ts';

export type ReviewReplyEmailDb = EmailDb;
type Context = { skip?: string; to?: string; client_id?: string | null; locale?: string; client_name?: string; business_name?: string; handle?: string | null; service_name?: string | null; rating?: number; review_body?: string; reply?: string };
export type ReviewReplyEmailOutcome = 'sent' | 'off' | 'already_sent' | 'unsubscribed' | 'no_email' | 'suppressed' | 'failed';

const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
const sha256 = async (value: string) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
const randomToken = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');

/**
 * RV-D1: emails the stylist's first reply to a Mova review to the client, once. Edits never email again.
 * The claim is taken before sending and given back if the send fails, so a later save can retry.
 * `provider` null = email is off for review replies (see review-management for the switches).
 */
export async function sendFirstReviewReplyEmail(db: ReviewReplyEmailDb, provider: EmailProvider | null, input: {
  reviewId: string; artistBusinessId: string; publicBaseUrl: string; postalAddress: string | null;
}): Promise<ReviewReplyEmailOutcome> {
  if (!provider) return 'off';
  const { data, error } = await db.rpc('mova_review_reply_email_context', { p_review_id: input.reviewId, p_artist_business_id: input.artistBusinessId });
  if (error) return 'failed';
  const context = data as unknown as Context | null;
  if (!context) return 'already_sent';
  if (context.skip === 'unsubscribed') return 'unsubscribed';
  if (context.skip || !context.to || !context.reply) return 'no_email';
  const { data: claimed } = await db.rpc('mova_review_reply_email_claim', { p_review_id: input.reviewId, p_artist_business_id: input.artistBusinessId });
  if ((claimed as unknown) !== true) return 'already_sent';
  const release = () => db.rpc('mova_review_reply_email_release', { p_review_id: input.reviewId, p_artist_business_id: input.artistBusinessId });
  const locale = context.locale === 'es-US' ? 'es-US' : 'en-US';
  const base = input.publicBaseUrl.replace(/\/$/, '');
  const token = randomToken();
  const { error: tokenError } = await (db.from('mova_email_unsubscribe_tokens') as unknown as { insert(row: Record<string, unknown>): PromiseLike<{ error: { message: string } | null }> }).insert({
    token_hash: await sha256(token), artist_business_id: input.artistBusinessId, client_id: context.client_id ?? null,
    address_hash: await sha256(context.to.trim().toLowerCase()), purpose: 'review_requests', locale,
  });
  if (tokenError) { await release(); return 'failed'; }
  const businessName = context.business_name || 'Mova';
  const outcome = await sendEmail(db, provider, {
    artistBusinessId: input.artistBusinessId, clientId: context.client_id ?? null, to: context.to, templateId: 'review_reply', locale,
    idempotencyKey: `review-reply:${input.reviewId}`,
    vars: {
      clientName: context.client_name ?? '', businessName, serviceName: context.service_name ?? '', startsAt: new Date().toISOString(), timeZone: 'UTC', locationName: '',
      postalAddress: input.postalAddress,
      reviewReply: {
        firstName: (context.client_name ?? '').trim().split(/\s+/)[0] ?? '', businessName, rating: Number(context.rating ?? 5),
        reviewBody: context.review_body ?? '', reply: context.reply, unsubscribeUrl: `${base}/unsubscribe/${token}`,
        bookingUrl: context.handle ? `${base}/a/${context.handle}` : null,
      },
    },
  });
  if (outcome.status === 'sent' || outcome.status === 'duplicate') return 'sent';
  await release();
  return outcome.status === 'suppressed' ? 'suppressed' : 'failed';
}
