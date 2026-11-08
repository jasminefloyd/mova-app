import { sendEmail, type EmailDb, type EmailProvider, type EmailTemplateId, type SendEmailOutcome } from './providers/email/index.ts';

type Context = {
  template_id: EmailTemplateId | null; artist_business_id: string; client_id: string | null; to: string | null; locale: string;
  client_name: string; business_name: string; service_name: string; starts_at: string; time_zone: string; location_name: string;
};

/**
 * Task 4.3: the client email for an appointment outbox event or reminder. Returns null when the event
 * has no email (other event types, no client email). Idempotent on `key`.
 */
export async function sendAppointmentEmail(db: EmailDb, provider: EmailProvider, appointmentId: string, eventType: string, key: string, now = new Date()): Promise<SendEmailOutcome | null> {
  const { data, error } = await db.rpc('mova_appointment_email_context', { p_appointment_id: appointmentId, p_event_type: eventType });
  if (error) throw new Error('APPOINTMENT_EMAIL_CONTEXT_FAILED');
  const context = data as unknown as Context | null;
  if (!context?.template_id || !context.to) return null;
  return sendEmail(db, provider, {
    artistBusinessId: context.artist_business_id, clientId: context.client_id, to: context.to, templateId: context.template_id,
    locale: context.locale === 'es-US' ? 'es-US' : 'en-US', idempotencyKey: key, now,
    vars: { clientName: context.client_name, businessName: context.business_name, serviceName: context.service_name, startsAt: context.starts_at, timeZone: context.time_zone, locationName: context.location_name },
  });
}
