import type { SupabaseClient } from '@supabase/supabase-js';

// Client side of the one Google connection (P6). Every call goes through an Edge Function with the
// stylist's session. Failures carry the server's stable code, so screens can show the right message.

export class GoogleActionError extends Error {
  constructor(readonly code: string, readonly permission?: string) { super(code); this.name = 'GoogleActionError'; }
}

export type GoogleConnection = {
  google_account_email: string | null;
  status: 'active' | 'revoked' | 'error';
  connected_at: string;
  calendar_enabled: boolean;
  calendar_id: string;
  business_profile_enabled: boolean;
  business_location_id: string | null;
  has_business_scope: boolean;
  has_calendar_scope: boolean;
};

export type CalendarStatus = {
  google: GoogleConnection | null;
  settings: { location_ids: string[]; apple_feed_enabled: boolean };
  locations: Array<{ id: string; name: string }>;
  feedConfigured: boolean;
  providerConfigured: boolean;
};

export type ListingChange = { key: string; kind: 'profile' | 'hours' | 'booking_link' | 'service' | 'service_new' | 'service_removed'; label: string };
export type ListingStatus = {
  connected: boolean;
  business_profile_ready: boolean;
  provider_configured: boolean;
  auto_send: boolean;
  last_synced_at: string | null;
  last_sync_status: 'never' | 'synced' | 'failed';
  sections: { profile: 'waiting' | 'up_to_date'; hours: 'waiting' | 'up_to_date'; booking_link: 'waiting' | 'up_to_date'; services_waiting: number };
  changes: ListingChange[];
};

export type GoogleLocation = { id: string; title: string };
export type GoogleCalendar = { id: string; summary: string; primary: boolean };

/** Reads the server's stable code (and a missing permission, when given) from a failed function call. */
export async function errorDetailsOf(error: unknown): Promise<{ code: string; permission?: string }> {
  const response = (error as { context?: Response } | null)?.context;
  if (response && typeof response.json === 'function') {
    const body = await response.json().catch(() => null) as { error?: { code?: unknown; permission?: unknown }; data?: { code?: unknown; permission?: unknown } } | null;
    const detail = body?.error ?? body?.data;
    if (typeof detail?.code === 'string') return { code: detail.code, ...(typeof detail.permission === 'string' ? { permission: detail.permission } : {}) };
  }
  return { code: 'ACTION_FAILED' };
}

export async function errorCodeOf(error: unknown): Promise<string> {
  return (await errorDetailsOf(error)).code;
}

export async function invokeGoogle<T>(client: SupabaseClient, businessId: string, name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await client.functions.invoke<{ data?: T }>(name, { body, headers: { 'x-mova-artist-business-id': businessId } });
  if (error) { const details = await errorDetailsOf(error); throw new GoogleActionError(details.code, details.permission); }
  if (data?.data === undefined) throw new GoogleActionError('ACTION_FAILED');
  return data.data;
}

/** A relative time such as "2 hours ago" in the active language. */
export function relativeTime(iso: string | null, locale: string | undefined, now = Date.now()): string {
  if (!iso) return '';
  const minutes = Math.round((new Date(iso).getTime() - now) / 60000);
  const formatter = new Intl.RelativeTimeFormat(locale ?? 'en-US', { numeric: 'auto' });
  if (Math.abs(minutes) < 60) return formatter.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 48) return formatter.format(hours, 'hour');
  return formatter.format(Math.round(hours / 24), 'day');
}
