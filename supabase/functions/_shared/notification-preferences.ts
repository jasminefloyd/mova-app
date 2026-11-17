export type NotificationPreferences = {
  in_app: boolean;
  email: boolean;
  push: boolean;
};

type PreferencesRow = { preferences?: unknown } | null;

type PreferenceQueryResult = {
  data: PreferencesRow;
  error: unknown | null;
};

type PreferenceDecision =
  | { ok: true; enabled: boolean }
  | { ok: false };

type PreferencesResolution =
  | { ok: true; preferences: NotificationPreferences }
  | { ok: false };

const DEFAULT_PREFERENCES: NotificationPreferences = {
  in_app: true,
  email: true,
  push: false,
};

export function resolveNotificationPreferences(
  result: PreferenceQueryResult,
): PreferencesResolution {
  if (result.error != null) return { ok: false };
  const stored = result.data?.preferences;
  const values = typeof stored === 'object' && stored !== null && !Array.isArray(stored)
    ? stored as Record<string, unknown>
    : {};
  return {
    ok: true,
    preferences: {
      in_app: typeof values.in_app === 'boolean' ? values.in_app : DEFAULT_PREFERENCES.in_app,
      email: typeof values.email === 'boolean' ? values.email : DEFAULT_PREFERENCES.email,
      push: typeof values.push === 'boolean' ? values.push : DEFAULT_PREFERENCES.push,
    },
  };
}

export function resolveInAppNotificationPreference(
  result: PreferenceQueryResult,
): PreferenceDecision {
  const resolved = resolveNotificationPreferences(result);
  return resolved.ok ? { ok: true, enabled: resolved.preferences.in_app } : { ok: false };
}

/** The five stylist alerts on Settings › Language & notifications, each with an email and a push switch. */
export const NOTIFICATION_EVENTS = ['booking_request', 'cancellation', 'client_message', 'appointment_reminder', 'new_review'] as const;
export type NotificationEvent = typeof NOTIFICATION_EVENTS[number];
export type EventChannels = { email: boolean; push: boolean };
export type EventPreferences = Record<NotificationEvent, EventChannels>;

/**
 * Per-event choices. Everything starts on. A legacy account-wide `email: false` keeps email off for every
 * event until the stylist turns an event back on. Push still needs the device's own permission.
 */
export function resolveEventPreferences(stored: unknown): EventPreferences {
  const values = typeof stored === 'object' && stored !== null && !Array.isArray(stored) ? stored as Record<string, unknown> : {};
  const events = typeof values.events === 'object' && values.events !== null && !Array.isArray(values.events) ? values.events as Record<string, unknown> : {};
  const emailDefault = typeof values.email === 'boolean' ? values.email : true;
  const out = {} as EventPreferences;
  for (const event of NOTIFICATION_EVENTS) {
    const row = typeof events[event] === 'object' && events[event] !== null ? events[event] as Record<string, unknown> : {};
    out[event] = {
      email: typeof row.email === 'boolean' ? row.email : emailDefault,
      push: typeof row.push === 'boolean' ? row.push : true,
    };
  }
  return out;
}

export function isEventPreferences(value: unknown): value is EventPreferences {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !(NOTIFICATION_EVENTS as readonly string[]).includes(key))) return false;
  return Object.values(record).every((row) => typeof row === 'object' && row !== null
    && Object.keys(row).every((key) => key === 'email' || key === 'push')
    && Object.values(row as Record<string, unknown>).every((flag) => typeof flag === 'boolean'));
}

/** Maps an outbox event to the stylist alert it represents (if any). */
export function notificationEventFor(eventType: string): NotificationEvent | null {
  if (eventType === 'appointment.pending_artist') return 'booking_request';
  if (eventType === 'appointment.cancelled' || eventType === 'appointment.canceled') return 'cancellation';
  if (eventType === 'message.received') return 'client_message';
  if (eventType === 'appointment.stylist_reminder') return 'appointment_reminder';
  if (eventType === 'review.created') return 'new_review';
  return null;
}
