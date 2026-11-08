import { describe, expect, it } from 'vitest';
import { FakeEmailProvider } from './fake.ts';
import { emailProviderFromEnv, sendEmail, type EmailDb } from './send.ts';
import { EMAIL_TEMPLATES, renderEmail } from './templates.ts';
import { sendAppointmentEmail } from '../../appointment-emails.ts';

const vars = { clientName: 'Jordan Lee', businessName: 'Rooted Beauty', serviceName: 'Silk press', startsAt: '2026-11-12T20:00:00.000Z', timeZone: 'America/New_York', locationName: 'Rooted Beauty Studio' };

function stubDb(gate: Record<string, unknown> | null, context: Record<string, unknown> | null = null) {
  const rows: (Record<string, unknown> & { id: string })[] = [];
  const db: EmailDb = {
    rpc: async (name) => ({ data: name === 'mova_email_send_gate' ? gate : context, error: null }),
    from: () => ({
      insert: (row) => ({ select: () => ({ single: async () => {
        if (rows.some((r) => r.idempotency_key === row.idempotency_key)) return { data: null, error: { message: '23505 duplicate' } };
        const saved = { ...row, id: `e${rows.length + 1}` }; rows.push(saved); return { data: { id: saved.id }, error: null };
      } }) }),
      update: (fields) => ({ eq: (_c, value) => { Object.assign(rows.find((r) => r.id === value) ?? {}, fields); return Promise.resolve({ error: null }); } }),
    }),
  };
  return { db, rows };
}

describe('appointment email templates (task 4.3)', () => {
  it('renders every template in both languages with the details', () => {
    for (const id of EMAIL_TEMPLATES) for (const locale of ['en-US', 'es-US'] as const) {
      const email = renderEmail(id, locale, vars);
      expect(email.subject).toContain('Rooted Beauty');
      expect(email.text).toContain(locale === 'es-US' ? 'Hola Jordan' : 'Hi Jordan');
      expect(email.text).toContain('Rooted Beauty Studio');
      expect(email.html).toContain(locale === 'es-US' ? 'lang="es"' : 'lang="en"');
    }
  });
  it('shows the time in the location time zone and language', () => {
    expect(renderEmail('booking_confirmation', 'en-US', vars).text).toMatch(/Thursday, November 12.*3:00\s?PM EST/);
    expect(renderEmail('booking_confirmation', 'es-US', vars).text).toMatch(/jueves, 12 de noviembre.*3:00\s?p\.\s?m\./);
  });
  it('escapes variables in HTML and keeps distinct subjects per template', () => {
    const email = renderEmail('request_received', 'en-US', { ...vars, businessName: '<b>Evil</b> & Co' });
    expect(email.html).not.toContain('<b>Evil</b>');
    expect(email.html).toContain('&lt;b&gt;Evil&lt;/b&gt; &amp; Co');
    expect(new Set(EMAIL_TEMPLATES.map((id) => renderEmail(id, 'en-US', vars).subject)).size).toBe(EMAIL_TEMPLATES.length);
  });
  it('without a manage link the footer says to contact the stylist', () => {
    expect(renderEmail('booking_confirmation', 'en-US', vars).text).toContain('To change it, contact Rooted Beauty.');
    expect(renderEmail('booking_confirmation', 'en-US', { ...vars, manageUrl: 'https://mova-beauty.co/m/x' }).text).toContain('View or change your appointment: https://mova-beauty.co/m/x');
  });
});

describe('sendEmail with the fake (task 4.3)', () => {
  const input = { artistBusinessId: 'b1', clientId: 'c1', to: 'Jordan@Example.com ', templateId: 'booking_confirmation' as const, locale: 'en-US' as const, vars, idempotencyKey: 'email:evt-1' };
  it('records the email and never sends twice for the same key', async () => {
    const { db, rows } = stubDb({ allowed: true });
    const fake = new FakeEmailProvider();
    expect((await sendEmail(db, fake, input)).status).toBe('sent');
    expect(await sendEmail(db, fake, input)).toEqual({ status: 'duplicate' });
    expect(fake.outbox).toHaveLength(1);
    expect(fake.outbox[0]).toMatchObject({ to: 'jordan@example.com', templateId: 'booking_confirmation' });
    expect(rows[0]).toMatchObject({ channel: 'email', status: 'sent', provider: 'fake', origin: 'transactional', purpose: 'booking_confirmation' });
  });
  it('skips suppressed and invalid addresses', async () => {
    const { db } = stubDb({ allowed: false, reason: 'suppressed' });
    const fake = new FakeEmailProvider();
    expect(await sendEmail(db, fake, input)).toEqual({ status: 'suppressed', reason: 'suppressed' });
    expect(await sendEmail(db, fake, { ...input, to: 'not-an-email' })).toEqual({ status: 'suppressed', reason: 'contact_missing' });
    expect(fake.outbox).toHaveLength(0);
  });
  it('marks provider failures', async () => {
    const { db, rows } = stubDb({ allowed: true });
    const fake = new FakeEmailProvider(); fake.failOnce();
    expect((await sendEmail(db, fake, input)).status).toBe('failed');
    expect(rows[0]).toMatchObject({ status: 'failed', error_code: 'PROVIDER_ERROR' });
  });
  it('only the fake can be configured', () => {
    expect(emailProviderFromEnv((n) => (n === 'MOVA_EMAIL_PROVIDER' ? 'fake' : undefined))?.live).toBe(false);
    expect(emailProviderFromEnv((n) => (n === 'MOVA_EMAIL_PROVIDER' ? 'sendgrid' : undefined))).toBeNull();
  });
});

describe('appointment emails from events (task 4.3)', () => {
  const context = { template_id: 'request_accepted', artist_business_id: 'b1', client_id: null, to: 'guest@example.com', locale: 'es-US', client_name: 'Ana', business_name: 'Rooted Beauty', service_name: 'Trenzas', starts_at: vars.startsAt, time_zone: vars.timeZone, location_name: 'Studio' };
  it('sends the mapped template in the client language', async () => {
    const { db } = stubDb({ allowed: true }, context);
    const fake = new FakeEmailProvider();
    expect((await sendAppointmentEmail(db, fake, 'a1', 'appointment.confirmed', 'email:evt-2'))?.status).toBe('sent');
    expect(fake.outbox[0]).toMatchObject({ templateId: 'request_accepted', locale: 'es-US', subject: 'Rooted Beauty aceptó tu solicitud' });
  });
  it('does nothing for events without an email or guests without an address', async () => {
    const fake = new FakeEmailProvider();
    expect(await sendAppointmentEmail(stubDb({ allowed: true }, { ...context, template_id: null }).db, fake, 'a1', 'appointment.no_show', 'k1')).toBeNull();
    expect(await sendAppointmentEmail(stubDb({ allowed: true }, { ...context, to: null }).db, fake, 'a1', 'appointment.confirmed', 'k2')).toBeNull();
    expect(fake.outbox).toHaveLength(0);
  });
});
