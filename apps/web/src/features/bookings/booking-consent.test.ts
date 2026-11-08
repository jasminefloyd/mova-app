import { describe, expect, it } from 'vitest';
import { normalizeBookingConsentChoices } from '../../../../../supabase/functions/_shared/booking-consent.ts';

describe('booking communication consent contract', () => {
  it('TC-F04-AC01-02 defaults promotional purposes off and review requests to the approved email default', () => {
    expect(normalizeBookingConsentChoices(undefined)).toEqual({
      rebooking_reminders: { email: false, sms: false },
      offers: { email: false, sms: false },
      review_requests: { email: true },
    });
  });

  it('TC-F04-AC01-02 preserves independent channel and purpose selections', () => {
    expect(normalizeBookingConsentChoices({
      rebooking_reminders: { email: true, sms: false },
      offers: { email: false, sms: true },
      review_requests: { email: false },
    })).toEqual({
      rebooking_reminders: { email: true, sms: false },
      offers: { email: false, sms: true },
      review_requests: { email: false },
    });
  });

  it('TC-F04-AC01-02 rejects unknown purposes, channels, and non-boolean consent', () => {
    expect(normalizeBookingConsentChoices({ analytics: { email: true } })).toBeNull();
    expect(normalizeBookingConsentChoices({ offers: { push: true } })).toBeNull();
    expect(normalizeBookingConsentChoices({ offers: { email: 'yes' } })).toBeNull();
    expect(normalizeBookingConsentChoices({ review_requests: { sms: true } })).toBeNull();
  });
});
