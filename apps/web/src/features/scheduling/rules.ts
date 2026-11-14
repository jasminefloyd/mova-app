// P6 scheduling screens: pure validation and payload rules for New location (19a), the Calendar
// add sheet's New client (08d), New appointment (08c) and Block time (08e). No React, no I/O.

export const LOCATION_KINDS = ['suite', 'booth', 'commission_salon', 'home_studio', 'mobile'] as const;
export type LocationKind = (typeof LOCATION_KINDS)[number];

export const BLOCK_REASONS = ['personal_break', 'holiday', 'time_off', 'other'] as const;
export type BlockReason = (typeof BLOCK_REASONS)[number];

export const BUFFER_MINUTE_OPTIONS = [0, 5, 10, 15, 30] as const;
export const NOTICE_HOUR_OPTIONS = [1, 2, 6, 12, 24, 48] as const;
export const BOOK_AHEAD_WEEK_OPTIONS = [4, 8, 12, 26] as const;

export type FieldErrors<K extends string> = Partial<Record<K, true>>;

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// ---- New location (19a) -------------------------------------------------------------------

export type NewLocationDraft = {
  kind: LocationKind | '';
  name: string;
  address: string;
  timeZone: string;
  mode: 'instant' | 'request';
  collector: 'artist' | 'salon';
  weekdays: number[];
  hoursByWeekday: Record<number, { opens: string; closes: string }>;
  /** Legacy single-range inputs remain accepted for stored callers; the UI uses hoursByWeekday. */
  opens?: string;
  closes?: string;
  bufferMinutes: number;
  noticeHours: number;
  bookAheadWeeks: number;
};

export type NewLocationField = 'kind' | 'name' | 'address' | 'timeZone' | 'weekdays' | 'hours';

// Board 19a starts with Tuesday, Thursday and Friday ticked, 9 to 5, 15 min buffer, 12 h notice, 8 weeks ahead.
export function newLocationDefaults(timeZone: string): NewLocationDraft {
  return {
    kind: '', name: '', address: '', timeZone,
    mode: 'instant', collector: 'artist',
    weekdays: [2, 4, 5], hoursByWeekday: { 2: { opens: '09:00', closes: '17:00' }, 4: { opens: '09:00', closes: '17:00' }, 5: { opens: '09:00', closes: '17:00' } },
    bufferMinutes: 15, noticeHours: 12, bookAheadWeeks: 8,
  };
}

export function validateNewLocation(draft: NewLocationDraft): FieldErrors<NewLocationField> {
  const errors: FieldErrors<NewLocationField> = {};
  const name = draft.name.trim();
  if (!(LOCATION_KINDS as readonly string[]).includes(draft.kind)) errors.kind = true;
  if (name.length < 1 || name.length > 120) errors.name = true;
  if (draft.address.trim().length < 1 || draft.address.trim().length > 300) errors.address = true;
  if (!draft.timeZone) errors.timeZone = true;
  if (draft.weekdays.length < 1 || draft.weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) errors.weekdays = true;
  if (draft.weekdays.some((weekday) => {
    const hours = draft.opens !== undefined || draft.closes !== undefined
      ? { opens: draft.opens ?? '', closes: draft.closes ?? '' }
      : draft.hoursByWeekday[weekday];
    return !hours || !TIME.test(hours.opens) || !TIME.test(hours.closes) || hours.opens >= hours.closes;
  })) errors.hours = true;
  return errors;
}

// Body for the existing location-save function. Request-to-book means the salon keeps its own book,
// which the data model stores as external calendar ownership (the database only allows external with request).
export function locationSavePayload(draft: NewLocationDraft, displayColorIndex: number) {
  if (!draft.kind) throw new Error('LOCATION_KIND_REQUIRED');
  return {
    name: draft.name.trim(),
    location_type: draft.kind,
    booking_mode: draft.mode,
    calendar_ownership: draft.mode === 'request' ? 'external' : 'mova',
    payment_collector: draft.collector,
    time_zone: draft.timeZone,
    address: { street: draft.address.trim() },
    display_color_index: displayColorIndex,
    hours: [...draft.weekdays].sort((a, b) => a - b).map((weekday) => {
      const hours = draft.opens !== undefined || draft.closes !== undefined
        ? { opens: draft.opens ?? '', closes: draft.closes ?? '' }
        : draft.hoursByWeekday[weekday]!;
      return { weekday, opens_at: hours.opens, closes_at: hours.closes };
    }),
    exceptions: [] as Array<{ exception_date: string; is_closed: boolean; hours: Array<{ opens_at: string; closes_at: string }>; reason: string }>,
    policies: {
      lead_time_minutes: draft.noticeHours * 60,
      booking_horizon_days: draft.bookAheadWeeks * 7,
      buffer_after_minutes: draft.bufferMinutes,
      cancellation_window_minutes: 1440,
      request_expiry_hours: 24,
    },
    client_details: {},
    door_code: '',
  };
}

// ---- New client (08d) and consent ----------------------------------------------------------

// Board 08d: both boxes unticked by default. A client is only marked as agreeing when the stylist ticks the box.
export type ConsentChoices = { appointmentUpdates: boolean; rebookingAndOffers: boolean };
export const DEFAULT_CONSENT_CHOICES: ConsentChoices = { appointmentUpdates: false, rebookingAndOffers: false };

export type ConsentPurpose = 'appointment_updates' | 'rebooking_reminders' | 'offers';
export type ConsentWrite = { purpose: ConsentPurpose; channel: 'sms' | 'email' };

// Only granted consents are written. Each purpose is written once per channel the client has an address for.
export function consentWrites(choices: ConsentChoices, contact: { hasPhone: boolean; hasEmail: boolean }): ConsentWrite[] {
  const channels: Array<'sms' | 'email'> = [...(contact.hasPhone ? ['sms' as const] : []), ...(contact.hasEmail ? ['email' as const] : [])];
  const purposes: ConsentPurpose[] = [
    ...(choices.appointmentUpdates ? ['appointment_updates' as const] : []),
    ...(choices.rebookingAndOffers ? ['rebooking_reminders' as const, 'offers' as const] : []),
  ];
  return purposes.flatMap((purpose) => channels.map((channel) => ({ purpose, channel })));
}

export type NewClientDraft = {
  firstName: string;
  lastName: string;
  mobile: string;
  email: string;
  locale: 'en-US' | 'es-US';
  consent: ConsentChoices;
};

export type NewClientField = 'firstName' | 'contact' | 'mobile' | 'email' | 'consentChannel';

export function validateNewClient(draft: NewClientDraft): FieldErrors<NewClientField> {
  const errors: FieldErrors<NewClientField> = {};
  const first = draft.firstName.trim();
  const last = draft.lastName.trim();
  if (first.length < 1 || first.length > 80 || last.length > 80) errors.firstName = true;
  const digits = draft.mobile.replace(/\D/g, '');
  const email = draft.email.trim();
  if (draft.mobile.trim() && !(digits.length === 10 || (digits.length === 11 && digits.startsWith('1')))) errors.mobile = true;
  if (email && (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) errors.email = true;
  if (!digits && !email) errors.contact = true;
  const wantsWrites = draft.consent.appointmentUpdates || draft.consent.rebookingAndOffers;
  if (wantsWrites && !digits && !email) errors.consentChannel = true;
  return errors;
}

// ---- Block time (08e) ----------------------------------------------------------------------

export type BlockDraft = {
  reason: BlockReason | '';
  label: string;
  allDay: boolean;
  date: string;
  from: string;
  to: string;
  locationIds: string[];
};

export type BlockField = 'reason' | 'label' | 'date' | 'hours' | 'locations';

export function blockDefaults(date: string): BlockDraft {
  return { reason: 'personal_break', label: '', allDay: false, date, from: '12:00', to: '13:00', locationIds: [] };
}

export function validateBlockTime(draft: BlockDraft): FieldErrors<BlockField> {
  const errors: FieldErrors<BlockField> = {};
  if (!(BLOCK_REASONS as readonly string[]).includes(draft.reason)) errors.reason = true;
  if (draft.label.trim().length > 120) errors.label = true;
  if (!DATE.test(draft.date)) errors.date = true;
  if (!draft.allDay && (!TIME.test(draft.from) || !TIME.test(draft.to) || draft.from >= draft.to)) errors.hours = true;
  if (draft.locationIds.length < 1) errors.locations = true;
  return errors;
}

// ---- Time zones ----------------------------------------------------------------------------

function zoneOffsetMs(instant: Date, zone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant);
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const wallAsUtc = Date.UTC(read('year'), read('month') - 1, read('day'), read('hour'), read('minute'), read('second'));
  return wallAsUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

// Converts a wall-clock date and time in a named zone to an ISO instant (UTC), across DST changes.
export function zonedWallClockToUtc(date: string, time: string, zone: string): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const [hour, minute] = time.split(':').map(Number) as [number, number];
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  let offset = zoneOffsetMs(new Date(wallAsUtc), zone);
  let instant = wallAsUtc - offset;
  const corrected = zoneOffsetMs(new Date(instant), zone);
  if (corrected !== offset) { offset = corrected; instant = wallAsUtc - offset; }
  return new Date(instant).toISOString();
}

export function addDays(date: string, amount: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

export function blockWindow(draft: BlockDraft, zone: string): { startsAt: string; endsAt: string } {
  if (draft.allDay) {
    return { startsAt: zonedWallClockToUtc(draft.date, '00:00', zone), endsAt: zonedWallClockToUtc(addDays(draft.date, 1), '00:00', zone) };
  }
  return { startsAt: zonedWallClockToUtc(draft.date, draft.from, zone), endsAt: zonedWallClockToUtc(draft.date, draft.to, zone) };
}

export function buildBlockRows(draft: BlockDraft, zoneByLocation: Record<string, string>, artistBusinessId: string) {
  return draft.locationIds.map((locationId) => {
    const window = blockWindow(draft, zoneByLocation[locationId] ?? 'UTC');
    return {
      artist_business_id: artistBusinessId,
      location_id: locationId,
      starts_at: window.startsAt,
      ends_at: window.endsAt,
      reason: draft.reason as BlockReason,
      label: draft.label.trim(),
    };
  });
}

// True when two time ranges overlap. Touching ends do not count.
export function overlaps(a: { startsAt: string; endsAt: string }, b: { startsAt: string; endsAt: string }): boolean {
  return Date.parse(a.startsAt) < Date.parse(b.endsAt) && Date.parse(b.startsAt) < Date.parse(a.endsAt);
}

// ---- New appointment (08c) -----------------------------------------------------------------

export type AppointmentDraft = { clientId: string; serviceId: string; locationId: string; date: string; start: string };
export type AppointmentField = 'client' | 'service' | 'location' | 'date' | 'start';

export function validateNewAppointment(draft: AppointmentDraft): FieldErrors<AppointmentField> {
  const errors: FieldErrors<AppointmentField> = {};
  if (!draft.clientId) errors.client = true;
  if (!draft.serviceId) errors.service = true;
  if (!draft.locationId) errors.location = true;
  if (!DATE.test(draft.date)) errors.date = true;
  if (!TIME.test(draft.start)) errors.start = true;
  return errors;
}
