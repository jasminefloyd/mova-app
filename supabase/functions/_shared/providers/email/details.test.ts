import { describe, expect, it } from 'vitest';
import { renderEmail, type AppointmentEmailVars } from './templates.ts';

// Audit EM1–EM8, EM12: street address with directions, the payment row, EM12 client rows, honest reminder copy.
const base: AppointmentEmailVars = {
  clientName: 'Andrea Lopez', businessName: 'Rooted Beauty', serviceName: 'Silk press', startsAt: '2026-12-01T15:00:00Z', timeZone: 'America/Chicago',
  locationName: 'Luxe Salon', locationAddress: '1200 N Milwaukee Ave, Chicago, IL', depositMinor: 2500, balanceMinor: 7000, paymentCollector: 'artist',
};

describe('appointment email details', () => {
  it('confirmation shows the address, directions and what is left to pay', () => {
    const email = renderEmail('booking_confirmation', 'en-US', base);
    expect(email.html).toContain('Luxe Salon · 1200 N Milwaukee Ave, Chicago, IL');
    expect(email.html).toContain('$25 deposit paid · $70 due at your visit');
    expect(email.html).toContain('https://www.google.com/maps/search/?api=1&amp;query=1200%20N%20Milwaukee%20Ave');
    expect(email.text).toContain('Get directions: https://www.google.com/maps/search/');
  });
  it('the reminder no longer points at buttons that are not there', () => {
    const email = renderEmail('appointment_reminder', 'en-US', base);
    expect(email.text).not.toContain('Use the buttons above');
    expect(email.text).toContain('Get directions: https://www.google.com/maps/search/');
  });
  it('salon-collected payments say so, in Spanish too', () => {
    expect(renderEmail('booking_confirmation', 'es-US', { ...base, paymentCollector: 'salon' }).html).toContain('Pagas en el salón');
  });
  it('EM12 lists client, service, where, payment and note, and links to settings', () => {
    const email = renderEmail('stylist_new_request', 'en-US', { ...base, clientNote: 'Running from work', stylistUrl: 'https://mova-beauty.co/BID-1/appointments/AID-9', settingsUrl: 'https://mova-beauty.co/BID-1/settings/notifications' });
    for (const text of ['Client', 'Andrea Lopez', 'Payment', '$25 deposit · $70 at the visit', '“Running from work”', 'Notification settings']) expect(email.html).toContain(text.replace('“', '“'));
    expect(email.html).toContain('https://mova-beauty.co/BID-1/appointments/AID-9');
  });
});
