import { planPriceId, type PlanKey } from './providers/stripe/billing.ts';
import { verifyStripeTestWebhook } from './providers/stripe/client.ts';

// Plan billing state (free trial WP2/WP3). Stripe is the source of truth: every path re-reads the
// subscription from Stripe and hands it to mova_apply_billing_state, the single writer. Pure and
// injectable so the webhook and plan actions can be tested without Stripe or a database.

type Result<T> = Promise<{ data: T | null; error: { message: string } | null }>;
export type BillingDb = { rpc(name: string, args: Record<string, unknown>): Result<unknown> };
export type BillingStripe = {
  mode: 'test' | 'live';
  retrieveSubscriptionWithCard(id: string): Promise<Record<string, unknown>>;
};
type Env = (name: string) => string | undefined;
type Obj = Record<string, unknown>;

const STATUSES = ['active', 'trialing', 'past_due', 'canceled', 'incomplete', 'unpaid', 'incomplete_expired'];
const iso = (seconds: unknown) => (typeof seconds === 'number' && Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : null);
const idOf = (value: unknown) => (typeof value === 'string' ? value : value && typeof value === 'object' && typeof (value as Obj).id === 'string' ? (value as Obj).id as string : null);

export function planFromPrice(priceId: unknown, env: Env): PlanKey | null {
  if (typeof priceId !== 'string') return null;
  if (priceId === planPriceId('pro', env)) return 'pro';
  if (priceId === planPriceId('ai_growth', env)) return 'ai_growth';
  return null;
}

export type ApplyArgs = {
  p_artist_business_id: string; p_customer: string; p_subscription: string; p_status: string; p_price_plan: PlanKey;
  p_trial_end: string | null; p_cancel_at_period_end: boolean; p_current_period_end: string | null; p_livemode: boolean;
  p_card_brand: string | null; p_card_last4: string | null; p_card_fingerprint: string | null; p_event_at: string; p_owner_user_id: string | null;
};

/** What mova_apply_billing_state needs from a Stripe subscription, or null when it isn't one of ours. */
export function subscriptionApplyArgs(subscription: Obj, env: Env, mode: 'test' | 'live', eventAtSeconds?: number, ownerUserId: string | null = null): ApplyArgs | null {
  const metadata = (subscription.metadata ?? {}) as Record<string, string>;
  const businessId = metadata.artist_business_id;
  if (!businessId || !/^[0-9a-f-]{36}$/i.test(businessId)) return null;
  if (subscription.livemode !== (mode === 'live')) return null;
  const subscriptionId = idOf(subscription);
  const customer = idOf(subscription.customer);
  const status = typeof subscription.status === 'string' && STATUSES.includes(subscription.status) ? subscription.status : null;
  const items = ((subscription.items ?? {}) as { data?: Array<Obj> }).data ?? [];
  const item = items[0] ?? {};
  const plan = planFromPrice(idOf(item.price), env);
  if (!subscriptionId || !subscriptionId.startsWith('sub_') || !customer || !status || !plan) return null;
  const method = subscription.default_payment_method && typeof subscription.default_payment_method === 'object' ? subscription.default_payment_method as Obj : null;
  const card = method?.card && typeof method.card === 'object' ? method.card as Obj : null;
  const last4 = typeof card?.last4 === 'string' && /^\d{4}$/.test(card.last4) ? card.last4 : null;
  return {
    p_artist_business_id: businessId,
    p_customer: customer,
    p_subscription: subscriptionId,
    p_status: status,
    p_price_plan: plan,
    p_trial_end: iso(subscription.trial_end),
    p_cancel_at_period_end: subscription.cancel_at_period_end === true,
    p_current_period_end: iso(subscription.current_period_end ?? item.current_period_end),
    p_livemode: mode === 'live',
    p_card_brand: typeof card?.brand === 'string' ? card.brand.slice(0, 40) : null,
    p_card_last4: last4,
    p_card_fingerprint: typeof card?.fingerprint === 'string' ? card.fingerprint.slice(0, 64) : null,
    p_event_at: iso(eventAtSeconds) ?? new Date().toISOString(),
    p_owner_user_id: ownerUserId,
  };
}

export type ApplyOutcome = { ignored?: boolean; trial_started?: boolean; trial_converted?: boolean; trial_ended_free?: boolean; plan_key?: string; status?: string };

/** Re-read a subscription from Stripe and apply it. Returns null when it isn't one of ours. */
export async function syncSubscription(db: BillingDb, stripe: BillingStripe, subscriptionId: string, env: Env, eventAtSeconds?: number, ownerUserId: string | null = null) {
  const subscription = await stripe.retrieveSubscriptionWithCard(subscriptionId);
  const args = subscriptionApplyArgs(subscription, env, stripe.mode, eventAtSeconds, ownerUserId);
  if (!args) return null;
  const { data, error } = await db.rpc('mova_apply_billing_state', args);
  if (error) throw new Error('BILLING_STATE_SAVE_FAILED');
  return { args, outcome: (data ?? {}) as ApplyOutcome, subscription };
}

/** Outbox events for trial and billing messages (WP5). Idempotency keys make retries safe. */
export async function enqueueBillingMessages(db: BillingDb, args: ApplyArgs, outcome: ApplyOutcome, subscription: Obj, invoice?: Obj | null, eventType?: string) {
  const events: Array<[string, string, Obj]> = [];
  const latest = invoice ?? (subscription.latest_invoice && typeof subscription.latest_invoice === 'object' ? subscription.latest_invoice as Obj : null);
  if (outcome.trial_started) events.push(['trial.started', `trial-started:${args.p_subscription}`, {}]);
  if (outcome.trial_converted) {
    events.push(['trial.converted', `trial-converted:${args.p_subscription}`, {
      plan_key: args.p_price_plan, amount_minor: typeof latest?.amount_paid === 'number' ? latest.amount_paid : null,
    }]);
  }
  if (outcome.trial_ended_free) events.push(['trial.ended_free', `trial-ended:${args.p_subscription}`, {}]);
  if ((eventType === 'invoice.payment_failed' || eventType === 'invoice.payment_action_required') && invoice && typeof invoice.id === 'string') {
    events.push(['billing.payment_failed', `payment-failed:${invoice.id}`, {
      plan_key: args.p_price_plan, amount_minor: typeof invoice.amount_due === 'number' ? invoice.amount_due : null, invoice_id: invoice.id,
    }]);
  }
  for (const [type, key, payload] of events) {
    const { error } = await db.rpc('mova_enqueue_account_event', { p_artist_business_id: args.p_artist_business_id, p_event_type: type, p_idempotency_key: key, p_payload: payload });
    if (error) throw new Error('BILLING_MESSAGE_ENQUEUE_FAILED');
  }
  return events.map(([type]) => type);
}

function invoiceSubscriptionId(invoice: Obj): string | null {
  const direct = idOf(invoice.subscription);
  if (direct) return direct;
  const parent = (invoice.parent ?? {}) as Obj;
  const details = (parent.subscription_details ?? {}) as Obj;
  return idOf(details.subscription);
}

export type BillingWebhookResponse = { status: number; body: Record<string, unknown> };

/** The billing-webhook function body. Works in test and live; the event's mode must match billing's. */
export async function handleBillingWebhook(raw: string, signature: string, secret: string, db: BillingDb, stripe: BillingStripe, env: Env, nowSeconds?: number): Promise<BillingWebhookResponse> {
  if (!await verifyStripeTestWebhook(raw, signature, secret, nowSeconds)) return { status: 400, body: { code: 'INVALID_WEBHOOK_SIGNATURE' } };
  let event: Obj;
  try { event = JSON.parse(raw) as Obj; } catch { return { status: 400, body: { code: 'STRIPE_EVENT_INVALID' } }; }
  const eventId = typeof event.id === 'string' && event.id.startsWith('evt_') ? event.id : null;
  const type = String(event.type ?? '');
  if (!eventId) return { status: 400, body: { code: 'STRIPE_EVENT_INVALID' } };
  if (event.livemode !== (stripe.mode === 'live')) return { status: 400, body: { code: 'STRIPE_EVENT_MODE_MISMATCH' } };
  const { data: fresh, error: beginError } = await db.rpc('mova_billing_event_begin', { p_event_id: eventId, p_type: type, p_livemode: stripe.mode === 'live' });
  if (beginError) return { status: 503, body: { code: 'BILLING_EVENT_LOG_FAILED' } };
  if (fresh === false) return { status: 200, body: { received: true, duplicate: true } };
  const object = (event.data && typeof event.data === 'object' ? (event.data as Obj).object : null) as Obj | null ?? {};
  const created = typeof event.created === 'number' ? event.created : undefined;
  const finish = async (error: string | null) => { await db.rpc('mova_billing_event_finish', { p_event_id: eventId, p_error: error }); };
  try {
    let subscriptionId: string | null = null;
    let invoice: Obj | null = null;
    if (type === 'checkout.session.completed') {
      if (object.mode !== 'subscription') { await finish(null); return { status: 200, body: { received: true, ignored: true } }; }
      subscriptionId = idOf(object.subscription);
    } else if (type.startsWith('customer.subscription.')) {
      if (type === 'customer.subscription.trial_will_end') { await finish(null); return { status: 200, body: { received: true, logged: true } }; }
      subscriptionId = idOf(object);
    } else if (type.startsWith('invoice.')) {
      invoice = object; subscriptionId = invoiceSubscriptionId(object);
    } else if (type === 'payment_method.attached' || type === 'customer.updated') {
      const customer = type === 'customer.updated' ? idOf(object) : idOf(object.customer);
      if (customer) {
        const { data } = await db.rpc('mova_billing_business_for_customer', { p_customer: customer });
        const row = Array.isArray(data) ? data[0] as Obj | undefined : null;
        subscriptionId = typeof row?.stripe_subscription_id === 'string' ? row.stripe_subscription_id : null;
      }
    }
    if (!subscriptionId) { await finish(null); return { status: 200, body: { received: true, ignored: true } }; }
    const synced = await syncSubscription(db, stripe, subscriptionId, env, created);
    if (!synced) { await finish(null); return { status: 200, body: { received: true, ignored: true } }; }
    const messages = synced.outcome.ignored ? [] : await enqueueBillingMessages(db, synced.args, synced.outcome, synced.subscription, invoice, type);
    await finish(null);
    return { status: 200, body: { received: true, status: synced.args.p_status, plan_key: synced.outcome.plan_key ?? null, messages } };
  } catch (error) {
    const code = error instanceof Error ? error.message : 'BILLING_WEBHOOK_FAILED';
    await finish(code).catch(() => undefined);
    return { status: 503, body: { code: 'BILLING_WEBHOOK_PROCESSING_FAILED' } };
  }
}
