export type BookingConsentChoices = {
  rebooking_reminders: { email: boolean; sms: boolean };
  offers: { email: boolean; sms: boolean };
  review_requests: { email: boolean };
};

const defaults = (): BookingConsentChoices => ({
  rebooking_reminders: { email: false, sms: false },
  offers: { email: false, sms: false },
  review_requests: { email: true },
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizeBookingConsentChoices(value: unknown): BookingConsentChoices | null {
  if (value === undefined) return defaults();
  if (!isRecord(value)) return null;
  const choices = defaults();
  for (const [purpose, channels] of Object.entries(value)) {
    if (!['rebooking_reminders', 'offers', 'review_requests'].includes(purpose) || !isRecord(channels)) return null;
    for (const [channel, granted] of Object.entries(channels)) {
      if (typeof granted !== 'boolean') return null;
      if (purpose === 'review_requests') {
        if (channel !== 'email') return null;
        choices.review_requests.email = granted;
      } else {
        if (channel !== 'email' && channel !== 'sms') return null;
        const category = purpose === 'rebooking_reminders' ? choices.rebooking_reminders : choices.offers;
        category[channel] = granted;
      }
    }
  }
  return choices;
}
