import { describe, expect, it } from 'vitest';
import { searchAvailability } from './availability.js';

const base = {
  location: { id: 'loc', timeZone: 'America/New_York', bookingMode: 'instant' as const, active: true, leadMinutes: 0, horizonDays: 365, bufferBeforeMinutes: 0, bufferAfterMinutes: 0 },
  service: { active: true, durationMinutes: 60, bufferMinutes: 0 },
  hours: [{ weekday: 0, opensAt: '01:00', closesAt: '04:00' }], now: '2026-01-01T00:00:00Z', fromDate: '2026-03-08', days: 1,
};

describe('availability', () => {
  it('skips nonexistent local times on spring-forward', () => {
    const slots = searchAvailability({ ...base, slotIntervalMinutes: 30 });
    expect(slots.every((slot) => !slot.localTime.startsWith('02:'))).toBe(true);
    expect(slots.some((slot) => slot.localTime === '01:00' && slot.startsAt.endsWith('06:00:00.000Z'))).toBe(true);
    expect(slots.some((slot) => slot.localTime === '03:00' && slot.startsAt.endsWith('07:00:00.000Z'))).toBe(true);
  });

  it('returns both instants for the repeated fall-back wall time, with distinct offsets', () => {
    const slots = searchAvailability({ ...base, fromDate: '2026-11-01', hours: [{ weekday: 0, opensAt: '01:00', closesAt: '02:00' }], slotIntervalMinutes: 60 });
    expect(slots).toHaveLength(2);
    expect(new Set(slots.map((slot) => slot.utcOffset)).size).toBe(2);
  });

  it('labels request slots and excludes inactive inventory and overlaps', () => {
    const slots = searchAvailability({ ...base, location: { ...base.location, bookingMode: 'request' }, busy: [{ startsAt: '2026-03-08T06:00:00Z', endsAt: '2026-03-08T07:00:00Z' }], slotIntervalMinutes: 30 });
    expect(slots.every((slot) => slot.bookingMode === 'request')).toBe(true);
    expect(slots.some((slot) => slot.startsAt === '2026-03-08T06:00:00.000Z')).toBe(false);
    expect(searchAvailability({ ...base, service: { ...base.service, active: false } })).toEqual([]);
  });
});
