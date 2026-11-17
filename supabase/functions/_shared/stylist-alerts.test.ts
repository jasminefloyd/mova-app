import { describe, expect, it } from 'vitest';
import { buildAlert, type AlertContext } from './stylist-alerts.ts';

const base: AlertContext = {
  artist_business_id: 'b', business_number: 7, locale: 'en-US', recipients: [],
  appointment: { id: 'a1', client_name: 'Maya R.', service_name: 'Knotless braids', starts_at: '2026-11-21T15:00:00Z', time_zone: 'America/New_York', location_name: 'Luxe Salon', status: 'pending_artist' },
  client: null, message: null, review: null, cancelled_by: null, needs_count: 2,
};

describe('stylist alerts', () => {
  it('writes the booking request alert from the appointment', () => {
    const alert = buildAlert('appointment.pending_artist', base)!;
    expect(alert.title).toBe('New booking request');
    expect(alert.body).toBe('Maya R. · Knotless braids · Sat 10:00 AM at Luxe Salon. Accept or decline.');
    expect(alert.path).toBe('appointments/a1');
  });

  it('only alerts on cancellations made by the client', () => {
    expect(buildAlert('appointment.cancelled', { ...base, cancelled_by: 'artist' })).toBeNull();
    expect(buildAlert('appointment.cancelled', { ...base, cancelled_by: 'client' })!.body).toContain('cancelled Sat 10:00 AM · Knotless braids. The slot is open again.');
  });

  it('quotes client messages and reviews, in Spanish too', () => {
    const message = buildAlert('message.received', { ...base, appointment: null, client: { id: 'c1', name: 'Andrea L.' }, message: 'Running 10 minutes late, still okay?' })!;
    expect(message.title).toBe('Message from Andrea L.');
    expect(message.body).toBe('“Running 10 minutes late, still okay?”');
    expect(message.path).toBe('clients/c1');
    const review = buildAlert('review.created', { ...base, locale: 'es-US', review: { rating: 5, name: 'Bri K.', body: 'Increíble' } })!;
    expect(review.title).toBe('Nueva reseña de 5 estrellas');
    expect(review.body).toBe('Bri K.: «Increíble»');
  });

  it('reminds only for confirmed appointments', () => {
    expect(buildAlert('appointment.stylist_reminder', base)).toBeNull();
    const alert = buildAlert('appointment.stylist_reminder', { ...base, appointment: { ...base.appointment!, status: 'confirmed' } })!;
    expect(alert.title).toBe('Coming up in 1 hour');
    expect(alert.body).toBe('Knotless braids with Maya R. at 10:00 AM · Luxe Salon');
  });
});
