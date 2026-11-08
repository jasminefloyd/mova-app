import { verifyStripeTestWebhook } from './providers/stripe/client.ts';

// Task 4.1: the Stripe webhook as a pure handler, so recorded event fixtures can drive it in tests.
// stripe-webhook/index.ts is a thin wrapper around this.

type Result<T> = Promise<{ data: T | null; error: { message: string } | null }>;
export type StripeWebhookDb = { rpc(name: string, args: Record<string, unknown>): Result<Record<string, unknown>> };
export type StripeWebhookResponse = { status: number; body: Record<string, unknown> };

export async function handleStripeWebhook(raw: string, signature: string, secret: string, db: StripeWebhookDb, nowSeconds?: number): Promise<StripeWebhookResponse> {
  if (!await verifyStripeTestWebhook(raw, signature, secret, nowSeconds)) return { status: 400, body: { code: 'INVALID_WEBHOOK_SIGNATURE' } };
  let event: Record<string, unknown>;
  try { event = JSON.parse(raw) as Record<string, unknown>; } catch { return { status: 400, body: { code: 'STRIPE_EVENT_INVALID' } }; }
  if (event.livemode !== false) return { status: 400, body: { code: 'STRIPE_LIVE_EVENT_REJECTED' } };
  const data = event.data && typeof event.data === 'object' ? (event.data as Record<string, unknown>).object as Record<string, unknown> ?? {} : {};
  const eventType = String(event.type ?? '');
  const accountId = typeof event.account === 'string' ? event.account : '';
  if (eventType.startsWith('refund.') || eventType === 'charge.refund.updated') {
    if (typeof data.id !== 'string' || !/^re_[A-Za-z0-9_]+$/.test(data.id)) return { status: 200, body: { received: true, ignored: true } };
    const refundStatus = data.status === 'succeeded' ? 'succeeded' : data.status === 'failed' ? 'failed' : 'pending';
    const { data: result, error } = await db.rpc('mova_stripe_refund_webhook_apply', { p_event_id: event.id, p_refund_id: data.id, p_status: refundStatus, p_account_id: accountId, p_livemode: false });
    if (error) return { status: 503, body: { code: 'STRIPE_REFUND_WEBHOOK_PROCESSING_FAILED' } };
    return { status: 200, body: { received: true, ...(result ?? {}) } };
  }
  const sessionId = typeof data.id === 'string' && data.id.startsWith('cs_test_') ? data.id : null;
  const paymentIntentId = typeof data.payment_intent === 'string' ? data.payment_intent : null;
  const { data: result, error } = await db.rpc('mova_stripe_webhook_apply', {
    p_event_id: event.id, p_event_type: eventType, p_account_id: accountId, p_session_id: sessionId, p_payment_intent_id: paymentIntentId,
    p_payment_status: String(data.payment_status ?? ''), p_amount_total: Number.isSafeInteger(data.amount_total) ? data.amount_total : null, p_livemode: false,
  });
  if (error) return { status: 503, body: { code: 'STRIPE_WEBHOOK_PROCESSING_FAILED' } };
  // Stripe's processing fee settles on the charge; a job reads it and posts it to the ledger (0045).
  const paymentId = typeof result?.payment_id === 'string' ? result.payment_id : null;
  if (paymentId && paymentIntentId && (result?.processed === true || result?.late_payment_refund_queued === true)) {
    const { error: feeError } = await db.rpc('mova_stripe_enqueue_processor_fee', { p_payment_id: paymentId, p_payment_intent_id: paymentIntentId, p_account_id: accountId });
    if (feeError) return { status: 503, body: { code: 'STRIPE_FEE_JOB_FAILED' } };
  }
  return { status: 200, body: { received: true, ...(result ?? {}) } };
}
