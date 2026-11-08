import { corsHeaders, respond, serviceClient } from '../_shared/booking.ts';
import { resolveInAppNotificationPreference } from '../_shared/notification-preferences.ts';
import { eventNotificationPayload, notificationKeys, type OutboxEvent } from '../_shared/jobs.ts';
import { StripeTestClient } from '../_shared/providers/stripe/client.ts';
import { sendAppointmentEmail } from '../_shared/appointment-emails.ts';
import { emailProviderFromEnv, type EmailDb } from '../_shared/providers/email/index.ts';

const equal = (left: string, right: string) => {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return diff === 0;
};

async function processOutboxEvent(db: ReturnType<typeof serviceClient>, eventId: string) {
  const { data: event, error } = await db.from('mova_outbox_events')
    .select('id,artist_business_id,event_type,payload,aggregate_type,aggregate_id').eq('id', eventId).maybeSingle();
  if (error || !event) throw new Error('OUTBOX_EVENT_READ_FAILED');
  const outboxEvent = event as OutboxEvent;
  if (!outboxEvent.artist_business_id) return;

  const { data: members, error: memberError } = await db.from('mova_artist_memberships')
    .select('user_id').eq('artist_business_id', outboxEvent.artist_business_id).eq('status', 'active');
  if (memberError) throw new Error('MEMBERSHIP_READ_FAILED');

  const keys = notificationKeys(outboxEvent.event_type);
  const payload = eventNotificationPayload(outboxEvent);
  for (const member of members ?? []) {
    const { data: preferences, error: preferenceError } = await db.from('mova_notification_preferences')
      .select('preferences').eq('artist_business_id', outboxEvent.artist_business_id).eq('user_id', member.user_id).maybeSingle();
    const preference = resolveInAppNotificationPreference({ data: preferences, error: preferenceError });
    if (!preference.ok) throw new Error('NOTIFICATION_PREFERENCES_READ_FAILED');
    if (!preference.enabled) continue;
    const { error: insertError } = await db.from('mova_notification_inbox').upsert({
      artist_business_id: outboxEvent.artist_business_id,
      user_id: member.user_id,
      event_type: outboxEvent.event_type,
      title_key: keys.title,
      body_key: keys.body,
      payload,
    }, { onConflict: 'artist_business_id,user_id,event_type,payload' });
    if (insertError) throw new Error('INBOX_WRITE_FAILED');
  }
  // Task 4.3: the client's appointment email, only while the email provider is the fake (O4).
  const emailProvider = emailProviderFromEnv((name) => Deno.env.get(name));
  const aggregate = event as { aggregate_type?: string; aggregate_id?: string };
  if (emailProvider && outboxEvent.event_type.startsWith('appointment.') && aggregate.aggregate_type === 'appointment' && aggregate.aggregate_id) {
    const outcome = await sendAppointmentEmail(db as unknown as EmailDb, emailProvider, aggregate.aggregate_id, outboxEvent.event_type, `email:${outboxEvent.id}`);
    if (outcome?.status === 'failed') throw new Error('APPOINTMENT_EMAIL_FAILED');
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ code: 'METHOD_NOT_ALLOWED' }, 405);
  const secret = Deno.env.get('MOVA_JOB_WORKER_SECRET');
  if (!secret || !equal(request.headers.get('x-mova-job-secret') ?? '', secret)) return respond({ code: 'UNAUTHENTICATED' }, 401);
  const body = await request.json().catch(() => ({}));
  const limit = Number.isInteger(body?.limit) ? body.limit as number : 25;
  if (limit < 1 || limit > 100) return respond({ code: 'JOB_LIMIT_INVALID' }, 422);

  const db = serviceClient();
  const workerId = crypto.randomUUID();
  const { data: jobs, error: leaseError } = await db.rpc('mova_lease_background_jobs', {
    p_worker_id: workerId, p_limit: limit, p_lease_seconds: 120,
  });
  if (leaseError) return respond({ code: 'JOB_LEASE_FAILED' }, 503);
  let succeeded = 0;
  let retried = 0;
  let dead = 0;
  for (const job of jobs ?? []) {
    try {
      if (job.job_type === 'outbox_event' && typeof job.payload?.outbox_event_id === 'string') {
        await processOutboxEvent(db, job.payload.outbox_event_id);
      } else if (job.job_type === 'stripe_checkout_expire'
        && typeof job.payload?.payment_id === 'string'
        && typeof job.payload?.session_id === 'string'
        && typeof job.payload?.account_id === 'string') {
        if (Deno.env.get('MOVA_STRIPE_TEST_MODE') !== 'true') throw new Error('STRIPE_TEST_MODE_DISABLED');
        const key = Deno.env.get('STRIPE_SECRET_KEY');
        if (!key?.startsWith('sk_test_')) throw new Error('STRIPE_TEST_CONFIGURATION_MISSING');
        const stripe = new StripeTestClient(key);
        const session = await stripe.retrieveCheckoutSession(job.payload.session_id, job.payload.account_id);
        if (session.status === 'complete') throw new Error('CHECKOUT_COMPLETED_AWAITING_WEBHOOK');
        if (session.status === 'open') {
          const expired = await stripe.expireCheckoutSession(job.payload.session_id, job.payload.account_id);
          if (expired.status !== 'expired') throw new Error('CHECKOUT_EXPIRY_NOT_CONFIRMED');
        } else if (session.status !== 'expired') {
          throw new Error('CHECKOUT_SESSION_STATUS_INVALID');
        }
        const { error: failPaymentError } = await db.rpc('mova_stripe_checkout_fail', { p_payment_id: job.payload.payment_id });
        if (failPaymentError) throw new Error('CHECKOUT_HOLD_RELEASE_FAILED');
      } else if (job.job_type === 'stripe_refund'
        && typeof job.payload?.refund_id === 'string'
        && typeof job.payload?.payment_intent_id === 'string'
        && typeof job.payload?.account_id === 'string'
        && Number.isSafeInteger(job.payload?.amount_minor)) {
        if (Deno.env.get('MOVA_STRIPE_TEST_MODE') !== 'true') throw new Error('STRIPE_TEST_MODE_DISABLED');
        const key = Deno.env.get('STRIPE_SECRET_KEY');
        if (!key?.startsWith('sk_test_')) throw new Error('STRIPE_TEST_CONFIGURATION_MISSING');
        const result = await new StripeTestClient(key).createRefund({
          paymentIntentId: job.payload.payment_intent_id,
          amountMinor: Number(job.payload.amount_minor),
          accountId: job.payload.account_id,
          idempotencyKey: `mova-refund-${job.payload.refund_id}`,
          refundApplicationFee: true,
        });
        if (typeof result.id !== 'string' || !['succeeded', 'pending', 'failed'].includes(String(result.status))) throw new Error('STRIPE_REFUND_RESPONSE_INVALID');
        const { data: saved, error: saveError } = await db.rpc('mova_stripe_refund_finish', {
          p_refund_id: job.payload.refund_id, p_provider_refund_id: result.id, p_status: result.status,
        });
        if (saveError || saved !== true) throw new Error('STRIPE_REFUND_STATUS_SAVE_FAILED');
        if (result.status === 'failed') throw new Error('STRIPE_REFUND_FAILED');
      } else if (job.job_type === 'appointment_reminder' && typeof job.payload?.appointment_id === 'string') {
        const emailProvider = emailProviderFromEnv((name) => Deno.env.get(name));
        if (!emailProvider) throw new Error('EMAIL_PROVIDER_NOT_CONFIGURED');
        const outcome = await sendAppointmentEmail(db as unknown as EmailDb, emailProvider, job.payload.appointment_id, 'appointment.reminder', `email:${job.idempotency_key ?? job.id}`);
        if (outcome?.status === 'failed') throw new Error('APPOINTMENT_EMAIL_FAILED');
      } else {
        throw new Error('JOB_TYPE_UNSUPPORTED');
      }
      const { data: completed, error: completeError } = await db.rpc('mova_complete_background_job', { p_job_id: job.id, p_worker_id: workerId });
      if (completeError || completed !== true) throw new Error('JOB_LEASE_LOST');
      succeeded += 1;
    } catch (error) {
      const code = error instanceof Error && ['JOB_TYPE_UNSUPPORTED','JOB_LEASE_LOST','APPOINTMENT_EMAIL_FAILED','EMAIL_PROVIDER_NOT_CONFIGURED','APPOINTMENT_EMAIL_CONTEXT_FAILED','STRIPE_TEST_MODE_DISABLED','STRIPE_TEST_CONFIGURATION_MISSING','CHECKOUT_COMPLETED_AWAITING_WEBHOOK','CHECKOUT_EXPIRY_NOT_CONFIRMED','CHECKOUT_SESSION_STATUS_INVALID','CHECKOUT_HOLD_RELEASE_FAILED','STRIPE_REFUND_RESPONSE_INVALID','STRIPE_REFUND_STATUS_SAVE_FAILED','STRIPE_REFUND_FAILED'].includes(error.message)
        ? error.message : 'JOB_HANDLER_FAILED';
      const { data: status, error: failError } = await db.rpc('mova_fail_background_job', {
        p_job_id: job.id, p_worker_id: workerId, p_error_code: code,
      });
      if (failError || status === 'lease_lost') continue;
      if (status === 'dead') dead += 1;
      else retried += 1;
    }
  }
  return respond({ leased: jobs?.length ?? 0, succeeded, retried, dead });
});
