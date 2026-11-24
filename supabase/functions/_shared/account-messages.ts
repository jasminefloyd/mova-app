import { decryptProviderSecret } from './provider-crypto.ts';
import { sendWebPush, type VapidKeys } from './web-push.ts';
import { sendEmail, type EmailDb, type EmailProvider, type EmailTemplateId } from './providers/email/index.ts';
import type { AccountEmailVars } from './providers/email/account.ts';
import { sendAccountSms, type AccountSmsOutcome } from './providers/sms/account.ts';
import type { SmsProvider } from './providers/sms/types.ts';

// Trial and billing messages (free trial WP5, D7). Account messages: they ignore the per-event
// notification choices. Email always sends; push goes to the owner's devices; a text goes only with
// account SMS consent. Each channel is independent: one failing never blocks the others.

export type AccountEventType = 'trial.started' | 'trial.reminder_7d' | 'trial.reminder_1d' | 'trial.converted' | 'billing.payment_failed' | 'trial.ended_free';
export const ACCOUNT_EVENTS: AccountEventType[] = ['trial.started', 'trial.reminder_7d', 'trial.reminder_1d', 'trial.converted', 'billing.payment_failed', 'trial.ended_free'];
export const isAccountEvent = (type: string): type is AccountEventType => (ACCOUNT_EVENTS as string[]).includes(type);

type Locale = 'en-US' | 'es-US';
export type AccountContext = {
  artist_business_id: string; business_number: number | null; locale: string | null; time_zone: string | null;
  owner: { user_id: string; email: string | null; first_name: string | null; sms: { phone: string } | null } | null;
  subscription: { status: string; plan_key: string; pending_plan_key: string | null; trial_end: string | null; cancel_at_period_end: boolean; past_due_since: string | null; card_brand: string | null; card_last4: string | null } | null;
  trial: { id: string; started_at: string | null; ends_at: string | null; after_trial_plan: string | null } | null;
  plans: Record<string, { display_name: string; monthly_price_minor: number }> | null;
};
export type AccountPayload = { amount_minor?: number | null; plan_key?: string | null; ends_at?: string | null };
export type AccountMessage = {
  email: { templateId: EmailTemplateId; vars: Omit<AccountEmailVars, 'postalAddress' | 'url'> } | null;
  push: { title: string; body: string } | null;
  sms: string | null;
};

const money = (minor: number | null | undefined, locale: Locale) => {
  const value = (minor ?? 0) / 100;
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', minimumFractionDigits: value % 1 === 0 ? 0 : 2 }).format(value);
};
const day = (iso: string | null | undefined, timeZone: string, locale: Locale) => {
  if (!iso) return '';
  try { return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone }).format(new Date(iso)).replace('.', ''); } catch { return iso.slice(0, 10); }
};
const brand = (value: string | null | undefined) => {
  const names: Record<string, string> = { visa: 'Visa', mastercard: 'Mastercard', amex: 'Amex', discover: 'Discover', diners: 'Diners', jcb: 'JCB', unionpay: 'UnionPay' };
  return value ? names[value] ?? value.charAt(0).toUpperCase() + value.slice(1) : '';
};

/** Words for one account event, in the stylist's language. Null when the event has nothing to send. */
export function buildAccountMessage(eventType: AccountEventType, context: AccountContext, payload: AccountPayload = {}): AccountMessage | null {
  const locale: Locale = context.locale === 'es-US' ? 'es-US' : 'en-US';
  const es = locale === 'es-US';
  const zone = context.time_zone || 'America/New_York';
  const plans = context.plans ?? {};
  const planName = (key: string | null | undefined) => (key && plans[key]?.display_name) || (key === 'pro' ? 'Pro' : key === 'free' ? (es ? 'Gratis' : 'Free') : 'AI + Growth');
  const planPrice = (key: string | null | undefined) => money(key ? plans[key]?.monthly_price_minor ?? (key === 'pro' ? 1900 : 3900) : 3900, locale);
  const sub = context.subscription;
  const after = (sub?.cancel_at_period_end ? 'free' : sub?.pending_plan_key) || context.trial?.after_trial_plan || 'ai_growth';
  const endsAt = payload.ends_at ?? sub?.trial_end ?? context.trial?.ends_at ?? null;
  const ends = day(endsAt, zone, locale);
  const card = sub?.card_last4 ? `${brand(sub.card_brand)} •• ${sub.card_last4}` : (es ? 'tu tarjeta' : 'your card');
  const last4 = sub?.card_last4 ?? '';
  const first = context.owner?.first_name?.trim().split(/\s+/)[0] || (es ? 'hola' : 'there');
  const link = 'mova-beauty.co/plan';

  switch (eventType) {
    case 'trial.started':
      return { email: null, push: null,
        sms: es ? 'Mova: Tu prueba gratis de 30 días de AI + Growth comenzó. Te enviaremos un mensaje antes de que termine. Responde STOP para cancelar.'
          : "Mova: Your free 30-day AI + Growth trial has started. We'll text you before it ends. Reply STOP to opt out." };

    case 'trial.reminder_7d':
    case 'trial.reminder_1d': {
      const tomorrow = eventType === 'trial.reminder_1d';
      const then = after === 'free'
        ? (es ? 'Después pasas a Gratis y no se te cobra.' : "Then you move to Free and won't be charged.")
        : (es ? `Después ${planName(after)} cuesta ${planPrice(after)} al mes.` : `Then ${planPrice(after)}/month for ${planName(after)}.`);
      const subject = tomorrow ? (es ? 'Tu prueba gratis termina mañana' : 'Your free trial ends tomorrow') : (es ? `Tu prueba gratis termina el ${ends}` : `Your free trial ends ${ends}`);
      const lead = after === 'free'
        ? (es ? `El ${ends} pasas al plan Gratis. No se te cobrará.` : `On ${ends} you move to the Free plan. You won't be charged.`)
        : (es ? `El ${ends} empieza tu plan ${planName(after)} a ${planPrice(after)} al mes con ${card}.` : `On ${ends} your ${planName(after)} plan starts at ${planPrice(after)}/month on ${card}.`);
      const rows: Array<[string, string]> = es ? [
        [`Quedarte en AI + Growth · ${planPrice('ai_growth')}/mes`, 'No tienes que hacer nada. Todo sigue funcionando.'],
        [`Cambiar a Pro · ${planPrice('pro')}/mes`, 'El Centro de ingresos con IA, el relleno de espacios, PricePilot y el reagendado automático se bloquean.'],
        ['Pasar a Gratis · $0', 'Las funciones de pago se bloquean y no se te cobra. No se borra nada.'],
      ] : [
        [`Stay on AI + Growth · ${planPrice('ai_growth')}/month`, 'Nothing to do. Everything keeps working.'],
        [`Switch to Pro · ${planPrice('pro')}/month`, 'AI Revenue Center, Seat Filler, PricePilot and rebooking autopilot lock.'],
        ['Go to Free · $0', "Paid features lock and you're not charged. Nothing is deleted."],
      ];
      return {
        email: { templateId: 'stylist_trial_ending', vars: {
          subject, preview: `${then} ${es ? 'Puedes cambiar a Pro o Gratis antes.' : 'You can switch to Pro or Free before then.'}`,
          headline: tomorrow ? (es ? 'Tu prueba termina mañana.' : 'Your trial ends tomorrow.') : (es ? 'Tu prueba termina en 7 días.' : 'Your trial ends in 7 days.'),
          lead, rows, action: es ? 'Elegir tu plan' : 'Choose your plan',
          after: es ? 'También puedes cambiar tu plan cuando quieras en Configuración › Plan.' : 'You can also change your plan anytime in Settings › Plan.',
          firstName: first } },
        push: tomorrow
          ? { title: es ? 'Tu prueba termina mañana' : 'Your trial ends tomorrow',
              body: after === 'free' ? then : (es ? `${planName(after)} empieza el ${ends} a ${planPrice(after)} al mes. Cambia a Pro o Gratis antes.` : `${planName(after)} starts ${ends} at ${planPrice(after)}/month. Switch to Pro or Free before then.`) }
          : { title: subject, body: `${then} ${es ? 'Toca para elegir tu plan.' : 'Tap to choose your plan.'}` },
        sms: tomorrow
          ? (es ? `Mova: Tu prueba termina mañana. ${after === 'free' ? 'Pasas a Gratis sin cobro.' : `${planName(after)} empieza a ${planPrice(after)}/mes si no cambias.`} ${link}`
            : `Mova: Your trial ends tomorrow. ${after === 'free' ? "You move to Free and won't be charged." : `${planName(after)} starts at ${planPrice(after)}/mo unless you switch:`} ${link}`)
          : (es ? `Mova: Tu prueba gratis termina el ${ends}. ${after === 'free' ? 'Luego pasas a Gratis sin cobro.' : `Luego ${planName(after)} cuesta ${planPrice(after)}/mes con tu tarjeta que termina en ${last4}.`} Quédatelo o cambia a Pro o Gratis: ${link}`
            : `Mova: Your free trial ends ${ends}. ${after === 'free' ? "Then you move to Free and won't be charged." : `Then ${planName(after)} is ${planPrice(after)}/mo on your card ending ${last4}.`} Keep it, or switch to Pro or Free: ${link}`),
      };
    }

    case 'trial.converted': {
      const plan = payload.plan_key ?? sub?.plan_key ?? 'ai_growth';
      const amount = payload.amount_minor != null ? money(payload.amount_minor, locale) : planPrice(plan);
      return { email: null, sms: null,
        push: { title: es ? `Estás en ${planName(plan)}` : `You're on ${planName(plan)}`,
          body: es ? `Cobramos ${amount} a ${card}. Gracias por seguir con Mova.` : `We charged ${amount} to ${card}. Thanks for staying with Mova.` } };
    }

    case 'billing.payment_failed': {
      const plan = payload.plan_key ?? sub?.plan_key ?? 'ai_growth';
      const amount = payload.amount_minor != null ? money(payload.amount_minor, locale) : planPrice(plan);
      const since = sub?.past_due_since ? new Date(sub.past_due_since) : new Date();
      const deadline = day(new Date(since.getTime() + 7 * 86_400_000).toISOString(), zone, locale);
      return {
        email: { templateId: 'stylist_payment_failed', vars: {
          subject: es ? 'Tu pago de Mova no se procesó' : "Your Mova payment didn't go through",
          preview: es ? `Actualiza tu tarjeta antes del ${deadline} para mantener ${planName(plan)}.` : `Update your card by ${deadline} to keep ${planName(plan)}.`,
          headline: es ? 'Tu pago no se procesó.' : "Your payment didn't go through.",
          lead: es ? `No pudimos cobrar ${amount} a ${card} por ${planName(plan)}.` : `We couldn't charge ${amount} to ${card} for ${planName(plan)}.`,
          rows: es ? [[`Actualiza tu tarjeta antes del ${deadline}`, 'Lo intentaremos de nuevo automáticamente. Tu plan sigue funcionando hasta entonces.'], [`Después del ${deadline}`, 'Pasas a Gratis. Las funciones de pago se bloquean y no se borra nada.']]
            : [[`Update your card by ${deadline}`, "We'll try again automatically. Your plan keeps working until then."], [`After ${deadline}`, 'You move to Free. Paid features lock, and nothing is deleted.']],
          action: es ? 'Actualizar tarjeta' : 'Update card',
          after: es ? '¿Preguntas sobre un cobro? Responde a este correo y una persona te contestará.' : 'Questions about a charge? Reply to this email and a person will answer.',
          firstName: first, tone: 'alert' } },
        push: { title: es ? 'Tu pago no se procesó' : "Payment didn't go through",
          body: es ? `Actualiza tu tarjeta antes del ${deadline} para mantener ${planName(plan)}.` : `Update your card by ${deadline} to keep ${planName(plan)}.` },
        sms: es ? `Mova: Tu pago de ${amount} por ${planName(plan)} no se procesó. Actualiza tu tarjeta antes del ${deadline} para mantenerlo: ${link}`
          : `Mova: Your ${amount} payment for ${planName(plan)} didn't go through. Update your card by ${deadline} to keep it: ${link}`,
      };
    }

    case 'trial.ended_free': {
      const ended = day(context.trial?.ends_at ?? endsAt ?? new Date().toISOString(), zone, locale);
      const push = { title: es ? 'Tu prueba terminó' : 'Your trial has ended',
        body: es ? 'Estás en Gratis. Tus campañas y precios están guardados. Toca para desbloquear.' : "You're on Free. Your campaigns and prices are saved. Tap to unlock." };
      return {
        email: { templateId: 'stylist_trial_ended', vars: {
          subject: es ? 'Tu prueba terminó. Estás en Gratis.' : "Your trial has ended. You're on Free.",
          preview: es ? 'Tus campañas, precios y configuración están guardados. Desbloquea cuando quieras.' : 'Your campaigns, prices and settings are saved. Unlock anytime.',
          headline: es ? 'Ahora estás en Gratis.' : "You're on Free now.",
          lead: es ? `Tu prueba de AI + Growth terminó el ${ended}. No se te cobró.` : `Your AI + Growth trial ended ${ended}. You weren't charged.`,
          rows: es ? [['Sigue siendo tuyo en Gratis', 'Página de reservas, calendario, clientes, depósitos y correos de reservas.'], ['Bloqueado, y guardado', 'Marketing, PricePilot, Centro de ingresos con IA, sincronización de calendario, reportes avanzados y reseñas públicas.']]
            : [['Still yours on Free', 'Booking page, calendar, clients, deposits and booking emails.'], ['Locked, and saved', 'Marketing, PricePilot, AI Revenue Center, calendar sync, advanced reports and public reviews.']],
          action: es ? 'Desbloquear un plan' : 'Unlock a plan',
          after: es ? 'Desbloquear cobra la tarjeta que agregaste. Los pagos con Mova usan la tarifa de Gratis de 1.5%.' : 'Unlocking charges the card you added. Payments through Mova use the 1.5% Free rate.',
          firstName: first } },
        push,
        sms: `Mova: ${push.body} ${es ? 'Responde STOP para cancelar.' : 'Reply STOP to opt out.'}`,
      };
    }
  }
}

type Db = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
  from: (table: string) => any;
};
export type AccountChannels = { email: EmailProvider | null; vapid: VapidKeys | null; sms: SmsProvider | null; env: (name: string) => string | undefined; baseUrl: string; postalAddress?: string | null; now?: Date };
export type AccountDelivery = { email: string; push: number; sms: AccountSmsOutcome['status'] | 'none' };

/** Sends one account event by email, push and text. Throws only when the email itself fails, so the job retries. */
export async function deliverAccountMessage(db: Db, channels: AccountChannels, input: { eventType: AccountEventType; artistBusinessId: string; outboxEventId: string; payload?: AccountPayload }): Promise<AccountDelivery> {
  const { data, error } = await db.rpc('mova_account_message_context', { p_artist_business_id: input.artistBusinessId });
  if (error) throw new Error('ACCOUNT_MESSAGE_CONTEXT_FAILED');
  const context = data as AccountContext | null;
  if (!context?.owner) return { email: 'none', push: 0, sms: 'none' };
  const message = buildAccountMessage(input.eventType, context, input.payload ?? {});
  if (!message) return { email: 'none', push: 0, sms: 'none' };
  const base = channels.baseUrl.replace(/\/$/, '');
  const url = context.business_number ? `${base}/BID-${context.business_number}/settings/plan` : `${base}/login`;
  const result: AccountDelivery = { email: 'none', push: 0, sms: 'none' };
  let emailFailed = false;

  if (message.email && channels.email && context.owner.email) {
    const outcome = await sendEmail(db as unknown as EmailDb, channels.email, {
      artistBusinessId: context.artist_business_id, clientId: null, to: context.owner.email, templateId: message.email.templateId,
      locale: context.locale === 'es-US' ? 'es-US' : 'en-US',
      vars: { clientName: context.owner.first_name ?? '', businessName: 'Mova', serviceName: '', startsAt: new Date().toISOString(), timeZone: 'UTC', locationName: '',
        account: { ...message.email.vars, url }, postalAddress: channels.postalAddress ?? null },
      idempotencyKey: `email:${input.outboxEventId}:account`,
    }).catch(() => ({ status: 'failed' as const }));
    result.email = outcome.status;
    emailFailed = outcome.status === 'failed';
  }

  if (message.push && channels.vapid) {
    try {
      const { data: subscriptions } = await db.from('mova_push_subscriptions')
        .select('id,endpoint_encrypted,key_material_encrypted,failure_count').eq('artist_business_id', context.artist_business_id)
        .eq('user_id', context.owner.user_id).is('revoked_at', null);
      for (const row of (subscriptions ?? []) as Array<{ id: string; endpoint_encrypted: string; key_material_encrypted: string; failure_count: number }>) {
        try {
          const endpoint = await decryptProviderSecret(row.endpoint_encrypted);
          const keys = JSON.parse(await decryptProviderSecret(row.key_material_encrypted)) as { p256dh: string; auth: string };
          const sent = await sendWebPush({ endpoint, ...keys }, { title: message.push.title, body: message.push.body, url, tag: `billing-${input.eventType}` }, channels.vapid, { topic: 'billing', urgency: 'normal' });
          if (sent.ok) {
            result.push += 1;
            await db.from('mova_push_subscriptions').update({ last_success_at: new Date().toISOString(), failure_count: 0 }).eq('id', row.id);
          } else {
            const failures = (row.failure_count ?? 0) + 1;
            await db.from('mova_push_subscriptions').update({ failure_count: failures, ...(sent.gone || failures >= 5 ? { revoked_at: new Date().toISOString() } : {}) }).eq('id', row.id);
          }
        } catch {
          await db.from('mova_push_subscriptions').update({ failure_count: (row.failure_count ?? 0) + 1 }).eq('id', row.id);
        }
      }
    } catch { /* push is best effort */ }
  }

  if (message.sms) {
    try {
      const outcome = await sendAccountSms(db, channels.sms, channels.env, {
        userId: context.owner.user_id, artistBusinessId: context.artist_business_id, phone: context.owner.sms?.phone ?? null,
        eventType: input.eventType, body: message.sms, idempotencyKey: `account-sms:${input.outboxEventId}`,
        timeZone: context.time_zone || 'America/New_York', trialStartedAt: context.trial?.started_at ?? null, now: channels.now,
      });
      result.sms = outcome.status;
    } catch { result.sms = 'failed'; }
  }

  if (emailFailed) throw new Error('ACCOUNT_EMAIL_FAILED');
  return result;
}
