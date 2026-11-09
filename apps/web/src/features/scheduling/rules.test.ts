import { describe, expect, it } from 'vitest';
import {
  addDays, blockDefaults, blockWindow, buildBlockRows, consentWrites, DEFAULT_CONSENT_CHOICES, locationSavePayload, newLocationDefaults,
  overlaps, validateBlockTime, validateNewAppointment, validateNewClient, validateNewLocation, zonedWallClockToUtc,
  type NewClientDraft, type NewLocationDraft,
} from './rules';

const location = (patch: Partial<NewLocationDraft> = {}): NewLocationDraft => ({ ...newLocationDefaults('America/New_York'), kind: 'suite', name: 'Studio 9 Suites', address: '210 Main St, Suite 4', ...patch });

describe('New location validation (board 19a)', () => {
  it('TC-SCR-19A-02 accepts a complete suite with the board defaults', () => {
    expect(validateNewLocation(location())).toEqual({});
  });

  it('TC-SCR-19A-02 requires a type of place, name, address, time zone, a working day and hours', () => {
    expect(validateNewLocation(location({ kind: '' }))).toEqual({ kind: true });
    expect(validateNewLocation(location({ name: '   ' }))).toEqual({ name: true });
    expect(validateNewLocation(location({ name: 'x'.repeat(121) }))).toEqual({ name: true });
    expect(validateNewLocation(location({ address: ' ' }))).toEqual({ address: true });
    expect(validateNewLocation(location({ timeZone: '' }))).toEqual({ timeZone: true });
    expect(validateNewLocation(location({ weekdays: [] }))).toEqual({ weekdays: true });
    expect(validateNewLocation(location({ opens: '17:00', closes: '09:00' }))).toEqual({ hours: true });
    expect(validateNewLocation(location({ opens: '9:00' }))).toEqual({ hours: true });
  });

  it('TC-SCR-19A-03 maps the board choices to the saved location, with request-to-book as external calendar', () => {
    const payload = locationSavePayload(location({ kind: 'home_studio', mode: 'request', collector: 'salon', weekdays: [4, 2] }), 3);
    expect(payload).toMatchObject({ location_type: 'home_studio', booking_mode: 'request', calendar_ownership: 'external', payment_collector: 'salon', display_color_index: 3 });
    expect(payload.hours.map((row) => row.weekday)).toEqual([2, 4]);
    expect(payload.policies).toMatchObject({ lead_time_minutes: 720, booking_horizon_days: 56, buffer_after_minutes: 15 });
    expect(payload.address).toEqual({ street: '210 Main St, Suite 4' });
    expect(locationSavePayload(location(), 0).calendar_ownership).toBe('mova');
  });

  it('TC-SCR-19A-03 refuses to save without a type of place', () => {
    expect(() => locationSavePayload(location({ kind: '' }), 0)).toThrow('LOCATION_KIND_REQUIRED');
  });
});

describe('New client consent (board 08d)', () => {
  const base: NewClientDraft = { firstName: 'Simone', lastName: 'A.', mobile: '(555) 555-0100', email: '', locale: 'en-US', consent: DEFAULT_CONSENT_CHOICES };

  it('TC-SCR-08D-01 both consent boxes start unticked, so nothing is granted by default', () => {
    expect(DEFAULT_CONSENT_CHOICES).toEqual({ appointmentUpdates: false, rebookingAndOffers: false });
    expect(consentWrites(DEFAULT_CONSENT_CHOICES, { hasPhone: true, hasEmail: true })).toEqual([]);
  });

  it('TC-SCR-08D-01 the two choices are separate and write separate purposes', () => {
    expect(consentWrites({ appointmentUpdates: true, rebookingAndOffers: false }, { hasPhone: true, hasEmail: false })).toEqual([{ purpose: 'appointment_updates', channel: 'sms' }]);
    expect(consentWrites({ appointmentUpdates: false, rebookingAndOffers: true }, { hasPhone: true, hasEmail: true })).toEqual([
      { purpose: 'rebooking_reminders', channel: 'sms' }, { purpose: 'rebooking_reminders', channel: 'email' },
      { purpose: 'offers', channel: 'sms' }, { purpose: 'offers', channel: 'email' },
    ]);
  });

  it('TC-SCR-08D-02 a client needs a mobile number or an email, and a granted choice needs one of them', () => {
    expect(validateNewClient(base)).toEqual({});
    expect(validateNewClient({ ...base, mobile: '', email: 'simone@example.invalid' })).toEqual({});
    expect(validateNewClient({ ...base, mobile: '', email: '' })).toEqual({ contact: true });
    expect(validateNewClient({ ...base, mobile: '', email: '', consent: { appointmentUpdates: true, rebookingAndOffers: false } })).toEqual({ contact: true, consentChannel: true });
    expect(validateNewClient({ ...base, firstName: '' })).toEqual({ firstName: true });
    expect(validateNewClient({ ...base, mobile: '555-01' })).toEqual({ mobile: true });
    expect(validateNewClient({ ...base, email: 'not-an-email' })).toEqual({ email: true });
  });
});

describe('Block time (board 08e)', () => {
  it('TC-SCR-08E-02 the reason is one of personal break, holiday, time off or other', () => {
    const draft = blockDefaults('2030-03-05');
    expect(validateBlockTime({ ...draft, locationIds: ['a'] })).toEqual({});
    for (const reason of ['personal_break', 'holiday', 'time_off', 'other'] as const) {
      expect(validateBlockTime({ ...draft, reason, locationIds: ['a'] })).toEqual({});
    }
    expect(validateBlockTime({ ...draft, reason: '', locationIds: ['a'] })).toEqual({ reason: true });
    expect(validateBlockTime({ ...draft, reason: 'lunch' as never, locationIds: ['a'] })).toEqual({ reason: true });
  });

  it('TC-SCR-08E-02 checks the label, date, hours and locations', () => {
    const draft = { ...blockDefaults('2030-03-05'), locationIds: ['a'] };
    expect(validateBlockTime({ ...draft, label: 'x'.repeat(121) })).toEqual({ label: true });
    expect(validateBlockTime({ ...draft, date: '03/05/2030' })).toEqual({ date: true });
    expect(validateBlockTime({ ...draft, from: '13:00', to: '12:00' })).toEqual({ hours: true });
    expect(validateBlockTime({ ...draft, allDay: true, from: '', to: '' })).toEqual({});
    expect(validateBlockTime({ ...draft, locationIds: [] })).toEqual({ locations: true });
  });

  it('TC-SCR-08E-03 converts local wall-clock times to UTC for the location zone, across daylight saving', () => {
    expect(zonedWallClockToUtc('2030-03-05', '09:00', 'America/New_York')).toBe('2030-03-05T14:00:00.000Z');
    expect(zonedWallClockToUtc('2030-07-01', '09:00', 'America/New_York')).toBe('2030-07-01T13:00:00.000Z');
    expect(zonedWallClockToUtc('2030-07-01', '09:00', 'UTC')).toBe('2030-07-01T09:00:00.000Z');
  });

  it('TC-SCR-08E-03 an all-day block runs from midnight to midnight in the location zone', () => {
    const window = blockWindow({ ...blockDefaults('2030-03-05'), allDay: true, locationIds: ['a'] }, 'America/New_York');
    expect(window).toEqual({ startsAt: '2030-03-05T05:00:00.000Z', endsAt: '2030-03-06T05:00:00.000Z' });
    expect(addDays('2030-02-28', 1)).toBe('2030-03-01');
  });

  it('TC-SCR-08E-03 writes one row per chosen location with its own zone', () => {
    const rows = buildBlockRows({ ...blockDefaults('2030-03-05'), label: ' Lunch ', from: '12:00', to: '13:00', locationIds: ['a', 'b'] }, { a: 'America/New_York', b: 'UTC' }, 'biz');
    expect(rows).toEqual([
      { artist_business_id: 'biz', location_id: 'a', starts_at: '2030-03-05T17:00:00.000Z', ends_at: '2030-03-05T18:00:00.000Z', reason: 'personal_break', label: 'Lunch' },
      { artist_business_id: 'biz', location_id: 'b', starts_at: '2030-03-05T12:00:00.000Z', ends_at: '2030-03-05T13:00:00.000Z', reason: 'personal_break', label: 'Lunch' },
    ]);
  });

  it('TC-SCR-08E-04 touching ranges do not count as overlapping', () => {
    const a = { startsAt: '2030-03-05T10:00:00Z', endsAt: '2030-03-05T11:00:00Z' };
    expect(overlaps(a, { startsAt: '2030-03-05T11:00:00Z', endsAt: '2030-03-05T12:00:00Z' })).toBe(false);
    expect(overlaps(a, { startsAt: '2030-03-05T10:30:00Z', endsAt: '2030-03-05T12:00:00Z' })).toBe(true);
  });
});

describe('New appointment validation (board 08c)', () => {
  it('TC-SCR-08C-08 needs a client, service, location, date and start time', () => {
    const ok = { clientId: 'c', serviceId: 's', locationId: 'l', date: '2030-03-05', start: '10:15' };
    expect(validateNewAppointment(ok)).toEqual({});
    expect(validateNewAppointment({ ...ok, clientId: '' })).toEqual({ client: true });
    expect(validateNewAppointment({ ...ok, serviceId: '' })).toEqual({ service: true });
    expect(validateNewAppointment({ ...ok, start: '' })).toEqual({ start: true });
  });
});
