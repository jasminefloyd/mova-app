export type WeeklyHours = { weekday: number; opensAt: string; closesAt: string };
export type AvailabilityLocation = {
  id: string;
  timeZone: string;
  bookingMode: 'instant' | 'request';
  active: boolean;
  leadMinutes: number;
  horizonDays: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
};
export type AvailabilityService = { active: boolean; durationMinutes: number; bufferMinutes: number };
export type BusyRange = { startsAt: string; endsAt: string };
export type Slot = { startsAt: string; endsAt: string; localDate: string; localTime: string; timeZone: string; utcOffset: string; bookingMode: 'instant' | 'request' };

const formatter = (timeZone: string) => new Intl.DateTimeFormat('en-CA', {
  timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  second: '2-digit', hourCycle: 'h23', timeZoneName: 'longOffset',
});

function partsAt(instant: Date, timeZone: string) {
  const parts = Object.fromEntries(formatter(timeZone).formatToParts(instant).map(({ type, value }) => [type, value]));
  return { year: parts.year!, month: parts.month!, day: parts.day!, hour: parts.hour!, minute: parts.minute!, second: parts.second!, offset: parts.timeZoneName! };
}

function localInstants(date: string, time: string, timeZone: string): Date[] {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const target = Date.UTC(year!, month! - 1, day!, hour!, minute!);
  const offsets = new Set<number>();
  for (let delta = -36; delta <= 36; delta += 3) {
    const sample = new Date(target + delta * 60 * 60 * 1000);
    const p = partsAt(sample, timeZone);
    offsets.add(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second)) - sample.getTime());
  }
  return [...offsets].map((offset) => new Date(target - offset)).filter((candidate) => {
    const p = partsAt(candidate, timeZone);
    return p.year === String(year).padStart(4, '0') && p.month === String(month).padStart(2, '0') && p.day === String(day).padStart(2, '0') && p.hour === String(hour).padStart(2, '0') && p.minute === String(minute).padStart(2, '0');
  }).sort((a, b) => a.getTime() - b.getTime());
}

function addDays(date: string, count: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + count);
  return value.toISOString().slice(0, 10);
}

function offsetAt(date: Date, timeZone: string) {
  return partsAt(date, timeZone).offset.replace('GMT', 'UTC');
}

export function searchAvailability(input: {
  location: AvailabilityLocation;
  service: AvailabilityService;
  hours: WeeklyHours[];
  closedDates?: string[];
  exceptions?: Record<string, Array<{ opensAt: string; closesAt: string }> | null>;
  busy?: BusyRange[];
  holds?: BusyRange[];
  blocked?: BusyRange[];
  now: string;
  fromDate: string;
  days: number;
  slotIntervalMinutes?: number;
}): Slot[] {
  const { location, service } = input;
  if (!location.active || !service.active || input.days < 1 || input.days > 90) return [];
  const interval = input.slotIntervalMinutes ?? 15;
  if (interval < 5 || interval > 120) throw new RangeError('slotIntervalMinutes must be 5–120');
  const duration = service.durationMinutes + service.bufferMinutes;
  const blocked = [...(input.busy ?? []), ...(input.holds ?? []), ...(input.blocked ?? [])].map((range) => [Date.parse(range.startsAt) - location.bufferBeforeMinutes * 60_000, Date.parse(range.endsAt) + location.bufferAfterMinutes * 60_000] as const);
  const now = Date.parse(input.now);
  const earliest = now + location.leadMinutes * 60_000;
  const latest = now + location.horizonDays * 86_400_000;
  const output: Slot[] = [];
  for (let dayOffset = 0; dayOffset < Math.min(input.days, location.horizonDays + 1); dayOffset++) {
    const date = addDays(input.fromDate, dayOffset);
    if (input.closedDates?.includes(date)) continue;
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    const shifts = input.exceptions && Object.hasOwn(input.exceptions, date)
      ? input.exceptions[date] ?? []
      : input.hours.filter((hours) => hours.weekday === weekday).map(({ opensAt, closesAt }) => ({ opensAt, closesAt }));
    for (const shift of shifts) {
      const [openH, openM] = shift.opensAt.slice(0, 5).split(':').map(Number);
      const [closeH, closeM] = shift.closesAt.slice(0, 5).split(':').map(Number);
      const open = openH! * 60 + openM!;
      let close = closeH! * 60 + closeM!;
      if (close <= open) close += 1440;
      for (let minute = open; minute + duration <= close; minute += interval) {
        const startDate = minute >= 1440 ? addDays(date, 1) : date;
        const minuteOfDay = minute % 1440;
        const time = `${String(Math.floor(minuteOfDay / 60)).padStart(2, '0')}:${String(minuteOfDay % 60).padStart(2, '0')}`;
        for (const start of localInstants(startDate, time, location.timeZone)) {
          const end = new Date(start.getTime() + duration * 60_000);
          if (start.getTime() < earliest || start.getTime() > latest) continue;
          if (blocked.some(([a, b]) => start.getTime() < b && end.getTime() > a)) continue;
          output.push({ startsAt: start.toISOString(), endsAt: end.toISOString(), localDate: startDate, localTime: time, timeZone: location.timeZone, utcOffset: offsetAt(start, location.timeZone), bookingMode: location.bookingMode });
        }
      }
    }
  }
  return output.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}
