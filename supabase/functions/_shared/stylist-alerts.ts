import { decryptProviderSecret } from './provider-crypto.ts';
import { notificationEventFor, resolveEventPreferences, type NotificationEvent } from './notification-preferences.ts';
import { sendWebPush, type VapidKeys } from './web-push.ts';
import { sendEmail, type EmailDb, type EmailProvider } from './providers/email/index.ts';

type Locale = 'en-US' | 'es-US';
export type AlertContext = {
  artist_business_id: string; business_number: number | null; locale: string | null;
  recipients: Array<{ user_id: string; email: string | null; first_name: string | null }>;
  appointment: { id: string; client_name: string | null; service_name: string | null; starts_at: string; time_zone: string | null; location_name: string | null; status: string } | null;
  client: { id: string; name: string } | null;
  message: string | null;
  review: { rating: number; name: string; body: string } | null;
  cancelled_by: string | null;
  needs_count: number | null;
};
export type Alert = { event: NotificationEvent; title: string; body: string; path: string; actionLabel: string; tag: string };

function when(iso: string, timeZone: string | null, locale: Locale, style: 'day' | 'time') {
  const date = new Date(iso);
  const zone = timeZone || 'America/New_York';
  try {
    if (style === 'time') return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone: zone }).format(date);
    return new Intl.DateTimeFormat(locale, { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: zone }).format(date);
  } catch { return date.toISOString(); }
}

const quote = (text: string, locale: Locale) => locale === 'es-US' ? `«${text}»` : `“${text}”`;
const clip = (text: string, max = 120) => text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

/** The copy for each of the five stylist alerts (P9), in the stylist's language. Null when the event should not alert. */
export function buildAlert(eventType: string, context: AlertContext, localeInput?: string | null): Alert | null {
  const event = notificationEventFor(eventType);
  if (!event) return null;
  const locale: Locale = (localeInput ?? context.locale) === 'es-US' ? 'es-US' : 'en-US';
  const es = locale === 'es-US';
  const appointment = context.appointment;
  const client = appointment?.client_name || context.client?.name || (es ? 'Un cliente' : 'A client');
  const service = appointment?.service_name || (es ? 'tu servicio' : 'your service');
  const place = appointment?.location_name ? (es ? ` en ${appointment.location_name}` : ` at ${appointment.location_name}`) : '';
  const open = es ? 'Abrir en Mova' : 'Open in Mova';
  switch (event) {
    case 'booking_request': {
      if (!appointment) return null;
      return { event, tag: `request-${appointment.id}`, path: `appointments/${appointment.id}`, actionLabel: es ? 'Responder' : 'Answer request',
        title: es ? 'Nueva solicitud de reserva' : 'New booking request',
        body: es ? `${client} · ${service} · ${when(appointment.starts_at, appointment.time_zone, locale, 'day')}${place}. Acepta o rechaza.`
          : `${client} · ${service} · ${when(appointment.starts_at, appointment.time_zone, locale, 'day')}${place}. Accept or decline.` };
    }
    case 'cancellation': {
      // Only cancellations by the client: the stylist already knows about the ones they made.
      if (!appointment || !['client', 'guest'].includes(context.cancelled_by ?? '')) return null;
      return { event, tag: `cancel-${appointment.id}`, path: `appointments/${appointment.id}`, actionLabel: open,
        title: es ? 'Cita cancelada' : 'Appointment cancelled',
        body: es ? `${client} canceló ${when(appointment.starts_at, appointment.time_zone, locale, 'day')} · ${service}. El espacio vuelve a estar libre.`
          : `${client} cancelled ${when(appointment.starts_at, appointment.time_zone, locale, 'day')} · ${service}. The slot is open again.` };
    }
    case 'client_message': {
      if (!context.message) return null;
      const name = context.client?.name || (es ? 'un cliente' : 'a client');
      return { event, tag: `message-${context.client?.id ?? 'unknown'}`, path: context.client ? `clients/${context.client.id}` : 'notifications', actionLabel: es ? 'Ver mensaje' : 'View message',
        title: es ? `Mensaje de ${name}` : `Message from ${name}`, body: quote(clip(context.message), locale) };
    }
    case 'appointment_reminder': {
      if (!appointment || appointment.status !== 'confirmed') return null;
      return { event, tag: `reminder-${appointment.id}`, path: `appointments/${appointment.id}`, actionLabel: open,
        title: es ? 'En 1 hora' : 'Coming up in 1 hour',
        body: es ? `${service} con ${client} a las ${when(appointment.starts_at, appointment.time_zone, locale, 'time')}${appointment.location_name ? ` · ${appointment.location_name}` : ''}`
          : `${service} with ${client} at ${when(appointment.starts_at, appointment.time_zone, locale, 'time')}${appointment.location_name ? ` · ${appointment.location_name}` : ''}` };
    }
    case 'new_google_review': {
      if (!context.review) return null;
      const stars = context.review.rating;
      return { event, tag: `google-review-${stars}-${context.review.name}`, path: 'reports/reputation', actionLabel: es ? 'Responder' : 'Reply',
        title: es ? `Nueva reseña de ${stars} estrellas en Google` : `New ${stars}-star Google review`,
        body: context.review.body ? `${context.review.name}: ${quote(clip(context.review.body), locale)}` : context.review.name };
    }
    case 'new_review': {
      if (!context.review) return null;
      const stars = context.review.rating;
      return { event, tag: `review-${stars}-${context.review.name}`, path: 'settings/reviews', actionLabel: es ? 'Ver reseña' : 'See review',
        title: es ? `Nueva reseña de ${stars} estrellas` : `New ${stars}-star review`,
        body: context.review.body ? `${context.review.name}: ${quote(clip(context.review.body), locale)}` : context.review.name };
    }
  }
}

type Db = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
  from: (table: string) => any;
};

/**
 * Sends one alert by push and/or email to every active member of the business, following each member's
 * per-event choices. Push needs VAPID keys; email needs a provider. Gone subscriptions are revoked.
 */
export async function deliverStylistAlert(db: Db, options: {
  eventType: string; aggregateId: string; outboxEventId: string; vapid: VapidKeys | null; email: EmailProvider | null; baseUrl: string; postalAddress?: string | null;
  skipEmail?: boolean;
}): Promise<{ push: number; email: number }> {
  const { data, error } = await db.rpc('mova_stylist_alert_context', { p_event_type: options.eventType, p_aggregate_id: options.aggregateId });
  if (error) throw new Error('STYLIST_ALERT_CONTEXT_FAILED');
  const context = data as AlertContext | null;
  if (!context) return { push: 0, email: 0 };
  const alert = buildAlert(options.eventType, context);
  if (!alert) return { push: 0, email: 0 };
  const base = options.baseUrl.replace(/\/$/, '');
  let pushed = 0; let emailed = 0;
  for (const recipient of context.recipients ?? []) {
    const { data: prefsRow, error: prefsError } = await db.from('mova_notification_preferences').select('preferences')
      .eq('artist_business_id', context.artist_business_id).eq('user_id', recipient.user_id).maybeSingle();
    if (prefsError) throw new Error('NOTIFICATION_PREFERENCES_READ_FAILED');
    const choice = resolveEventPreferences(prefsRow?.preferences)[alert.event];
    const url = context.business_number ? `${base}/BID-${context.business_number}/${alert.path}` : `${base}/login`;

    if (choice.push && options.vapid) {
      const { data: subscriptions, error: subError } = await db.from('mova_push_subscriptions')
        .select('id,endpoint_encrypted,key_material_encrypted,failure_count').eq('artist_business_id', context.artist_business_id)
        .eq('user_id', recipient.user_id).is('revoked_at', null);
      if (subError) throw new Error('PUSH_SUBSCRIPTIONS_READ_FAILED');
      for (const row of (subscriptions ?? []) as Array<{ id: string; endpoint_encrypted: string; key_material_encrypted: string; failure_count: number }>) {
        try {
          const endpoint = await decryptProviderSecret(row.endpoint_encrypted);
          const keys = JSON.parse(await decryptProviderSecret(row.key_material_encrypted)) as { p256dh: string; auth: string };
          const result = await sendWebPush({ endpoint, ...keys }, {
            title: alert.title, body: alert.body, url, tag: alert.tag, badge: context.needs_count ?? undefined,
          }, options.vapid, { topic: alert.tag, urgency: alert.event === 'appointment_reminder' || alert.event === 'booking_request' ? 'high' : 'normal' });
          if (result.ok) {
            pushed += 1;
            await db.from('mova_push_subscriptions').update({ last_success_at: new Date().toISOString(), failure_count: 0 }).eq('id', row.id);
          } else {
            const failures = (row.failure_count ?? 0) + 1;
            await db.from('mova_push_subscriptions').update({ failure_count: failures, ...(result.gone || failures >= 5 ? { revoked_at: new Date().toISOString() } : {}) }).eq('id', row.id);
          }
        } catch {
          await db.from('mova_push_subscriptions').update({ failure_count: (row.failure_count ?? 0) + 1 }).eq('id', row.id);
        }
      }
    }

    // Booking requests already have their own email (EM12, sent by the job worker), so only push here.
    if (choice.email && options.email && !options.skipEmail && alert.event !== 'booking_request' && recipient.email) {
      const outcome = await sendEmail(db as unknown as EmailDb, options.email, {
        artistBusinessId: context.artist_business_id, clientId: null, to: recipient.email, templateId: 'stylist_alert',
        locale: context.locale === 'es-US' ? 'es-US' : 'en-US',
        vars: { clientName: recipient.first_name ?? '', businessName: 'Mova', serviceName: '', startsAt: new Date().toISOString(), timeZone: 'UTC', locationName: '',
          alert: { firstName: recipient.first_name || (context.locale === 'es-US' ? 'hola' : 'there'), title: alert.title, body: alert.body, actionLabel: alert.actionLabel, url },
          postalAddress: options.postalAddress ?? null },
        idempotencyKey: `email:${options.outboxEventId}:alert:${recipient.user_id}`,
      });
      if (outcome.status === 'failed') throw new Error('APPOINTMENT_EMAIL_FAILED');
      if (outcome.status === 'sent') emailed += 1;
    }
  }
  return { push: pushed, email: emailed };
}

/** Whether a member wants email for booking requests (the existing EM12 request email). */
export function wantsEmail(preferences: unknown, event: NotificationEvent) {
  return resolveEventPreferences(preferences)[event].email;
}
