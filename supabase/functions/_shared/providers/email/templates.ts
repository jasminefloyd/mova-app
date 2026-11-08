import type { EmailLocale, EmailTemplateId } from './types.ts';

export const EMAIL_TEMPLATES: EmailTemplateId[] = ['booking_confirmation', 'request_received', 'request_accepted', 'request_declined', 'appointment_reminder'];

export type AppointmentEmailVars = {
  clientName: string;
  businessName: string;
  serviceName: string;
  startsAt: string;      // ISO timestamp
  timeZone: string;      // IANA, the location's
  locationName: string;
  manageUrl?: string | null;
};

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
const firstName = (name: string) => name.trim().split(/\s+/)[0]?.slice(0, 40) || '';

export function formatWhen(startsAt: string, timeZone: string, locale: EmailLocale) {
  return new Intl.DateTimeFormat(locale, { timeZone, weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(startsAt));
}

type Copy = { subject: string; lead: string; footer: string };

function copyFor(id: EmailTemplateId, locale: EmailLocale, v: AppointmentEmailVars, when: string): Copy {
  const b = v.businessName, s = v.serviceName;
  const en: Record<EmailTemplateId, Copy> = {
    booking_confirmation: { subject: `You're booked with ${b}`, lead: `Your ${s} with ${b} is confirmed.`, footer: 'Need to change it? Use the link below.' },
    request_received: { subject: `Request sent to ${b}`, lead: `${b} got your request for ${s}. You'll hear back once they accept or suggest another time.`, footer: 'This is not confirmed yet.' },
    request_accepted: { subject: `${b} accepted your request`, lead: `Good news: ${b} accepted your request. Your ${s} is confirmed.`, footer: 'Need to change it? Use the link below.' },
    request_declined: { subject: `${b} couldn't take this request`, lead: `${b} can't take your ${s} request at this time.`, footer: 'You can pick another time on their booking page.' },
    appointment_reminder: { subject: `Reminder: ${s} with ${b} tomorrow`, lead: `A reminder that your ${s} with ${b} is coming up.`, footer: 'Need to change it? Use the link below.' },
  };
  const es: Record<EmailTemplateId, Copy> = {
    booking_confirmation: { subject: `Tu cita con ${b} está reservada`, lead: `Tu cita de ${s} con ${b} está confirmada.`, footer: '¿Necesitas cambiarla? Usa el enlace de abajo.' },
    request_received: { subject: `Solicitud enviada a ${b}`, lead: `${b} recibió tu solicitud de ${s}. Te avisaremos cuando la acepte o sugiera otro horario.`, footer: 'Todavía no está confirmada.' },
    request_accepted: { subject: `${b} aceptó tu solicitud`, lead: `Buenas noticias: ${b} aceptó tu solicitud. Tu cita de ${s} está confirmada.`, footer: '¿Necesitas cambiarla? Usa el enlace de abajo.' },
    request_declined: { subject: `${b} no pudo aceptar esta solicitud`, lead: `${b} no puede aceptar tu solicitud de ${s} en este momento.`, footer: 'Puedes elegir otro horario en su página de reservas.' },
    appointment_reminder: { subject: `Recordatorio: ${s} con ${b} mañana`, lead: `Te recordamos que tu cita de ${s} con ${b} es pronto.`, footer: '¿Necesitas cambiarla? Usa el enlace de abajo.' },
  };
  void when;
  return (locale === 'es-US' ? es : en)[id];
}

/** Renders one transactional email. Every variable is escaped in the HTML part. */
export function renderEmail(id: EmailTemplateId, locale: EmailLocale, vars: AppointmentEmailVars) {
  const when = formatWhen(vars.startsAt, vars.timeZone, locale);
  const copy = { ...copyFor(id, locale, vars, when) };
  const greeting = locale === 'es-US' ? `Hola ${firstName(vars.clientName)},` : `Hi ${firstName(vars.clientName)},`;
  const whenLabel = locale === 'es-US' ? 'Cuándo' : 'When';
  const whereLabel = locale === 'es-US' ? 'Dónde' : 'Where';
  const manageLabel = locale === 'es-US' ? 'Ver o cambiar tu cita' : 'View or change your appointment';
  const link = vars.manageUrl && /^https:\/\//.test(vars.manageUrl) ? vars.manageUrl : null;
  if (!link && /link below|enlace de abajo/.test(copy.footer)) copy.footer = locale === 'es-US' ? `Para cambiarla, contacta a ${vars.businessName}.` : `To change it, contact ${vars.businessName}.`;
  const text = [greeting, '', copy.lead, '', `${whenLabel}: ${when}`, `${whereLabel}: ${vars.locationName}`, '', copy.footer, link ? `${manageLabel}: ${link}` : '', '', '— Mova']
    .filter((line, index, all) => !(line === '' && all[index - 1] === '')).join('\n').trim();
  const html = `<!doctype html><html lang="${locale === 'es-US' ? 'es' : 'en'}"><body style="font-family:Arial,sans-serif;color:#18392F">`
    + `<p>${escapeHtml(greeting)}</p><p>${escapeHtml(copy.lead)}</p>`
    + `<p><strong>${escapeHtml(whenLabel)}:</strong> ${escapeHtml(when)}<br><strong>${escapeHtml(whereLabel)}:</strong> ${escapeHtml(vars.locationName)}</p>`
    + `<p>${escapeHtml(copy.footer)}</p>${link ? `<p><a href="${escapeHtml(link)}">${escapeHtml(manageLabel)}</a></p>` : ''}<p>— Mova</p></body></html>`;
  return { subject: copy.subject, text, html };
}
