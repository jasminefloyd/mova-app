import type { SupabaseClient } from '@supabase/supabase-js';
import { GoogleActionError, invokeGoogle, type CalendarStatus } from '../google/googleApi';

// Connections (CN1–CN8): the statuses the hub, its five pages and the Settings row share. Every read goes
// through the same Edge Functions the older screens used, so nothing here is a second source of truth.

export type ConnectionKey = 'stripe' | 'google' | 'meta' | 'googleCalendar' | 'appleCalendar';
export type PillTone = 'on' | 'off' | 'warn' | 'wait';
export type ConnectionPill = { tone: PillTone; labelKey: string };

export type StripeStatus = {
  connected: { account_type: string | null; status: string; charges_enabled: boolean; payouts_enabled: boolean; details_submitted: boolean; connected_at?: string | null } | null;
  payouts: { bank_last4: string | null; bank_name: string | null; interval: 'manual' | 'daily' | 'weekly' | 'monthly' | null; weekly_anchor: string | null; monthly_anchor: number | null; delay_days: number | null } | null;
  next_payout: { amount_minor: number; currency: string; arrival_date: string } | null;
  dashboard_url: string | null;
  /** False when card payments are switched off for this environment. */
  available: boolean;
};

export type MetaStatus = {
  connection: { status: string; page_id: string; page_name: string; instagram_user_id: string | null; instagram_username: string | null; connected_at: string; last_message_at: string | null } | null;
  channels: { instagram: boolean; messenger: boolean };
  provider_configured: boolean;
  plan_included: boolean;
};

export type ConnectionStatuses = { stripe: StripeStatus | null; google: CalendarStatus | null; meta: MetaStatus | null };

export const invokeFn = invokeGoogle;
export { GoogleActionError as ConnectionError };

const STRIPE_OFF = ['STRIPE_TEST_MODE_DISABLED', 'STRIPE_TEST_CONFIGURATION_MISSING'];

export async function loadStripeStatus(client: SupabaseClient, businessId: string): Promise<StripeStatus> {
  try {
    const data = await invokeGoogle<Omit<StripeStatus, 'available'>>(client, businessId, 'stripe-connect-onboard', { action: 'status' });
    return { ...data, next_payout: data.next_payout ?? null, dashboard_url: typeof data.dashboard_url === 'string' && data.dashboard_url.startsWith('https://') ? data.dashboard_url : null, available: true };
  } catch (cause) {
    if (cause instanceof GoogleActionError && STRIPE_OFF.includes(cause.code)) return { connected: null, payouts: null, next_payout: null, dashboard_url: null, available: false };
    throw cause;
  }
}

export async function loadMetaStatus(client: SupabaseClient, businessId: string): Promise<MetaStatus> {
  return invokeGoogle<MetaStatus>(client, businessId, 'meta-connect', { action: 'status' });
}

export async function loadGoogleStatus(client: SupabaseClient, businessId: string): Promise<CalendarStatus> {
  return invokeGoogle<CalendarStatus>(client, businessId, 'calendar-google-connect', { action: 'status' });
}

/** Loads all three in parallel; a failed one comes back null so the hub can still show the rest. */
export async function loadConnectionStatuses(client: SupabaseClient, businessId: string): Promise<ConnectionStatuses> {
  const [stripe, google, meta] = await Promise.all([
    loadStripeStatus(client, businessId).catch(() => null),
    loadGoogleStatus(client, businessId).catch(() => null),
    loadMetaStatus(client, businessId).catch(() => null),
  ]);
  return { stripe, google, meta };
}

export function stripePill(stripe: StripeStatus | null): ConnectionPill {
  const status = stripe?.connected?.status;
  if (status === 'active') return { tone: 'on', labelKey: 'connections.status.active' };
  if (status === 'restricted') return { tone: 'warn', labelKey: 'connections.status.actionNeeded' };
  if (status === 'pending') return { tone: 'wait', labelKey: 'connections.status.inReview' };
  return { tone: 'off', labelKey: 'connections.status.notConnected' };
}

export const googleConnected = (google: CalendarStatus | null) => google?.google?.status === 'active';

export function googlePill(google: CalendarStatus | null): ConnectionPill {
  return googleConnected(google) ? { tone: 'on', labelKey: 'connections.status.connected' } : { tone: 'off', labelKey: 'connections.status.notConnected' };
}

export function metaPill(meta: MetaStatus | null): ConnectionPill {
  return meta?.connection ? { tone: 'on', labelKey: 'connections.status.connected' } : { tone: 'off', labelKey: 'connections.status.notConnected' };
}

export function googleCalendarPill(google: CalendarStatus | null): ConnectionPill {
  if (!googleConnected(google)) return { tone: 'off', labelKey: 'connections.status.notConnected' };
  return google?.google?.calendar_enabled ? { tone: 'on', labelKey: 'connections.status.on' } : { tone: 'off', labelKey: 'connections.status.off' };
}

export function appleCalendarPill(google: CalendarStatus | null): ConnectionPill {
  return google?.feedConfigured ? { tone: 'on', labelKey: 'connections.status.linkReady' } : { tone: 'off', labelKey: 'connections.status.notSetUp' };
}

/** "3 of 5 on" for the Settings row: each connection that is connected and switched on counts once. */
export function connectedCount(statuses: ConnectionStatuses): number {
  return [stripePill(statuses.stripe), googlePill(statuses.google), metaPill(statuses.meta), googleCalendarPill(statuses.google), appleCalendarPill(statuses.google)]
    .filter((pill) => pill.tone === 'on').length;
}

export const CONNECTION_LOGOS: Record<ConnectionKey, string> = {
  stripe: '/connections/stripe.svg',
  google: '/connections/google.svg',
  meta: '/connections/meta.svg',
  googleCalendar: '/connections/gcal.svg',
  appleCalendar: '/connections/apple.svg',
};

export const CONNECTION_PATHS: Record<ConnectionKey, string> = {
  stripe: 'settings/connections/stripe',
  google: 'settings/connections/google',
  meta: 'settings/connections/meta',
  googleCalendar: 'settings/connections/google-calendar',
  appleCalendar: 'settings/connections/apple-calendar',
};
