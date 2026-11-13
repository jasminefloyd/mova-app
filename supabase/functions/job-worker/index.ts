import { withSystemRequestLogging, loggedProviderFetch } from '../_shared/system-log.ts';
import { corsHeaders, respond, serviceClient } from '../_shared/booking.ts';
import { resolveInAppNotificationPreference } from '../_shared/notification-preferences.ts';
import { eventNotificationPayload, notificationKeys, type OutboxEvent } from '../_shared/jobs.ts';
import { StripeTestClient } from '../_shared/providers/stripe/client.ts';
import { sendAppointmentEmail } from '../_shared/appointment-emails.ts';
import { consumeSlotOpened } from '../_shared/seat-filler.ts';
import { smsProviderFromEnv } from '../_shared/providers/sms/index.ts';
import { emailProviderFromEnv, sendEmail, type AppointmentEmailVars, type EmailDb, type EmailTemplateId } from '../_shared/providers/email/index.ts';

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
  // Task 5.1: a cancelled or no-show slot becomes a seat-filler campaign (sending stays behind its flag).
  if (outboxEvent.event_type === 'slot.opened') {
    const env = (name: string) => Deno.env.get(name);
    await consumeSlotOpened(db, smsProviderFromEnv(env), outboxEvent.id, env);
  }
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
    const templateForEvent: Record<string, EmailTemplateId> = { 'appointment.rescheduled': 'appointment_moved', 'appointment.cancelled': 'appointment_cancelled', 'appointment.review_request': 'review_request' };
    const template = templateForEvent[outboxEvent.event_type];
    const proposedEnabled = Deno.env.get('MOVA_EMAIL_PROPOSED_ENABLED') === 'true';
    const reviewEnabled = proposedEnabled && Deno.env.get('MOVA_EMAIL_REVIEW_REQUESTS_ENABLED') === 'true'
      && Boolean(Deno.env.get('MOVA_EMAIL_POSTAL_ADDRESS'));
    if (template && !proposedEnabled) return;
    if (template === 'review_request' && !reviewEnabled) return;
    const outcome = await sendAppointmentEmail(db as unknown as EmailDb, emailProvider, aggregate.aggregate_id, outboxEvent.event_type, `email:${outboxEvent.id}`, new Date(), outboxEvent.payload, Deno.env.get('MOVA_EMAIL_POSTAL_ADDRESS'));
    if (outcome?.status === 'failed') throw new Error('APPOINTMENT_EMAIL_FAILED');

    if (outboxEvent.event_type === 'appointment.pending_artist' && proposedEnabled) {
      const { data: context, error } = await db.rpc('mova_appointment_stylist_email_context', { p_appointment_id: aggregate.aggregate_id });
      if (error) throw new Error('STYLIST_EMAIL_CONTEXT_FAILED');
      const value = context as { recipients?: Array<{ email: string; name: string }>; vars?: AppointmentEmailVars; artist_business_id?: string; locale?: string } | null;
      for (const recipient of value?.recipients ?? []) {
        const sent = await sendEmail(db as unknown as EmailDb, emailProvider, {
          artistBusinessId: value?.artist_business_id ?? outboxEvent.artist_business_id!, clientId: null,
          to: recipient.email, templateId: 'stylist_new_request', locale: value?.locale === 'es-US' ? 'es-US' : 'en-US',
          vars: { ...(value?.vars as AppointmentEmailVars), stylistName: recipient.name, stylistUrl: `${Deno.env.get('MOVA_EMAIL_PUBLIC_BASE_URL') ?? 'https://mova-beauty.co'}/calendar`, postalAddress: Deno.env.get('MOVA_EMAIL_POSTAL_ADDRESS') },
          idempotencyKey: `email:${outboxEvent.id}:stylist:${recipient.email.toLowerCase()}`,
        });
        if (sent.status === 'failed') throw new Error('APPOINTMENT_EMAIL_FAILED');
      }
    }
  }

  if (emailProvider && outboxEvent.event_type === 'artist.welcome' && Deno.env.get('MOVA_EMAIL_PROPOSED_ENABLED') === 'true') {
    const { data: context, error } = await db.rpc('mova_stylist_welcome_email_context', { p_artist_business_id: outboxEvent.artist_business_id });
    if (error) throw new Error('STYLIST_EMAIL_CONTEXT_FAILED');
    const value = context as { recipients?: Array<{ email: string; name: string }>; vars?: AppointmentEmailVars; artist_business_id?: string; locale?: string } | null;
    for (const recipient of value?.recipients ?? []) {
      const sent = await sendEmail(db as unknown as EmailDb, emailProvider, {
        artistBusinessId: value?.artist_business_id ?? outboxEvent.artist_business_id!, clientId: null,
        to: recipient.email, templateId: 'stylist_welcome', locale: value?.locale === 'es-US' ? 'es-US' : 'en-US',
        vars: { ...(value?.vars as AppointmentEmailVars), clientName: recipient.name, stylistName: recipient.name,
          bookingUrl: `${Deno.env.get('MOVA_EMAIL_PUBLIC_BASE_URL') ?? 'https://mova-beauty.co'}/onboarding/profile`,
          postalAddress: Deno.env.get('MOVA_EMAIL_POSTAL_ADDRESS') },
        idempotencyKey: `email:${outboxEvent.id}:stylist:${recipient.email.toLowerCase()}`,
      });
      if (sent.status === 'failed') throw new Error('APPOINTMENT_EMAIL_FAILED');
    }
  }
}

Deno.serve(withSystemRequestLogging('job-worker', async (request) => {
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
        const stripe = new StripeTestClient(key, loggedProviderFetch(request, 'stripe'));
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
        const result = await new StripeTestClient(key, loggedProviderFetch(request, 'stripe')).createRefund({
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
      } else if (job.job_type === 'stripe_processor_fee'
        && typeof job.payload?.payment_id === 'string'
        && typeof job.payload?.payment_intent_id === 'string'
        && typeof job.payload?.account_id === 'string') {
        // Task 4.1: Stripe's processing fee, read from the charge and posted once to the ledger (0045).
        if (Deno.env.get('MOVA_STRIPE_TEST_MODE') !== 'true') throw new Error('STRIPE_TEST_MODE_DISABLED');
        const key = Deno.env.get('STRIPE_SECRET_KEY');
        if (!key?.startsWith('sk_test_')) throw new Error('STRIPE_TEST_CONFIGURATION_MISSING');
        const fee = await new StripeTestClient(key, loggedProviderFetch(request, 'stripe')).retrieveProcessorFee(job.payload.payment_intent_id, job.payload.account_id);
        if (!fee) throw new Error('STRIPE_FEE_NOT_SETTLED');
        const { error: feeError } = await db.rpc('mova_stripe_record_processor_fee', { p_payment_id: job.payload.payment_id, p_fee_minor: fee.feeMinor });
        if (feeError) throw new Error('STRIPE_FEE_SAVE_FAILED');
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
      const code = error instanceof Error && ['JOB_TYPE_UNSUPPORTED','JOB_LEASE_LOST','APPOINTMENT_EMAIL_FAILED','STRIPE_FEE_NOT_SETTLED','STRIPE_FEE_SAVE_FAILED','EMAIL_PROVIDER_NOT_CONFIGURED','APPOINTMENT_EMAIL_CONTEXT_FAILED','STRIPE_TEST_MODE_DISABLED','STRIPE_TEST_CONFIGURATION_MISSING','CHECKOUT_COMPLETED_AWAITING_WEBHOOK','CHECKOUT_EXPIRY_NOT_CONFIRMED','CHECKOUT_SESSION_STATUS_INVALID','CHECKOUT_HOLD_RELEASE_FAILED','STRIPE_REFUND_RESPONSE_INVALID','STRIPE_REFUND_STATUS_SAVE_FAILED','STRIPE_REFUND_FAILED'].includes(error.message)
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
}));
