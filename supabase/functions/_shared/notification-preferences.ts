type PreferencesRow = { preferences?: { in_app?: unknown } | null } | null;

type PreferenceQueryResult = {
  data: PreferencesRow;
  error: unknown | null;
};

type PreferenceDecision =
  | { ok: true; enabled: boolean }
  | { ok: false };

export function resolveInAppNotificationPreference(
  result: PreferenceQueryResult,
): PreferenceDecision {
  if (result.error) return { ok: false };
  return { ok: true, enabled: result.data?.preferences?.in_app !== false };
}
