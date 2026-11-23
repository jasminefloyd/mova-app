// Listing sync (P6): turns Mova data into what Google should show, and works out which items are waiting.
// Pure functions only, so the Edge Function and the unit tests share one rule. Mova is the source: an item
// is "waiting" when its content differs from the snapshot of what was last sent to Google.
import type { GoogleListingItem } from './types.ts';

export type ServiceRow = { id: string; name: string; status: string; base_price_minor: number; duration_minutes: number };
export type HoursRow = { weekday: number; opens_at: string; closes_at: string };
export type ProfileRow = { display_name: string; bio: string; handle: string };
export type Snapshot = { item_key: string; payload: Record<string, unknown> };
export type PendingChange = { key: string; kind: 'profile' | 'hours' | 'service' | 'service_new' | 'booking_link' | 'service_removed'; label: string; previous_price_minor?: number };

/** Minor units from a Google Money object (the snapshot of what Google shows now). */
function moneyMinor(value: unknown): number | null {
  const money = value as { units?: string | number; nanos?: number } | null;
  if (!money || money.units === undefined) return null;
  const minor = Number(money.units) * 100 + Math.round((money.nanos ?? 0) / 10_000_000);
  return Number.isFinite(minor) ? minor : null;
}

const DAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'] as const;

/** Stable JSON (sorted keys) so two equal payloads always compare equal. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** Google Money for a USD amount in minor units (cents). Mova stores USD only (schema check). */
export function usdMoney(minor: number) {
  return { currencyCode: 'USD', units: String(Math.floor(minor / 100)), nanos: (minor % 100) * 10_000_000 };
}

/** Desired listing items from Mova rows. Services: one item per active service, keyed service:<id>. */
export function desiredListing(input: { profile: ProfileRow; hours: HoursRow[]; services: ServiceRow[]; publicBaseUrl: string }): GoogleListingItem[] {
  const items: GoogleListingItem[] = [
    { key: 'profile', kind: 'profile', payload: { title: input.profile.display_name, description: input.profile.bio } },
    { key: 'hours', kind: 'hours', payload: { regularHours: input.hours.map((row) => ({ openDay: DAYS[row.weekday], closeDay: DAYS[row.weekday], openTime: clock(row.opens_at), closeTime: clock(row.closes_at) })) } },
    { key: 'booking_link', kind: 'booking_link', payload: { websiteUri: `${input.publicBaseUrl.replace(/\/$/, '')}/a/${input.profile.handle}` } },
  ];
  for (const service of input.services.filter((row) => row.status === 'active')) {
    items.push({ key: `service:${service.id}`, kind: 'services', payload: { displayName: service.name, price: usdMoney(service.base_price_minor), durationMinutes: service.duration_minutes } });
  }
  return items;
}

function clock(value: string) {
  const [hours, minutes] = value.split(':').map(Number);
  return { hours, minutes };
}

/** Items whose content differs from the last snapshot, plus services that left the menu. */
export function pendingListing(desired: GoogleListingItem[], snapshots: Snapshot[], names: Map<string, string>): PendingChange[] {
  const sent = new Map(snapshots.map((row) => [row.item_key, row.payload]));
  const changes: PendingChange[] = [];
  for (const item of desired) {
    if (canonicalJson(sent.get(item.key) ?? null) === canonicalJson(item.payload)) continue;
    const kind = item.key.startsWith('service:') ? (sent.has(item.key) ? 'service' : 'service_new') : item.kind;
    const change: PendingChange = { key: item.key, kind: kind as PendingChange['kind'], label: names.get(item.key) ?? item.key };
    // Audit 38d: a price change shows Google's current price struck through.
    if (kind === 'service') {
      const before = moneyMinor((sent.get(item.key) as { price?: unknown } | undefined)?.price);
      const after = moneyMinor((item.payload as { price?: unknown }).price);
      if (before !== null && after !== null && before !== after) change.previous_price_minor = before;
    }
    changes.push(change);
  }
  const desiredKeys = new Set(desired.map((item) => item.key));
  for (const row of snapshots) {
    if (row.item_key.startsWith('service:') && !desiredKeys.has(row.item_key)) {
      changes.push({ key: row.item_key, kind: 'service_removed', label: names.get(row.item_key) ?? row.item_key });
    }
  }
  return changes;
}

/** The services menu is sent as one list, so a change to any service sends all of them. */
export function servicesMenu(desired: GoogleListingItem[]): GoogleListingItem {
  const services = desired.filter((item) => item.key.startsWith('service:')).map((item) => item.payload);
  return { key: 'services', kind: 'services', payload: { services } };
}
