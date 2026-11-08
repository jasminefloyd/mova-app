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
