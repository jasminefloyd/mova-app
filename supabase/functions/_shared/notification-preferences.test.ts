import { describe, expect, it } from 'vitest';
import { resolveInAppNotificationPreference } from './notification-preferences.ts';

describe('in-app notification preference resolution', () => {
  it('suppresses inbox creation when the user disabled in-app notifications', () => {
    expect(resolveInAppNotificationPreference({
      data: { preferences: { in_app: false } },
      error: null,
    })).toEqual({ ok: true, enabled: false });
  });

  it('defaults missing settings to enabled', () => {
    expect(resolveInAppNotificationPreference({ data: null, error: null })).toEqual({
      ok: true,
      enabled: true,
    });
  });

  it('fails closed when preferences cannot be read', () => {
    expect(resolveInAppNotificationPreference({
      data: { preferences: { in_app: true } },
      error: new Error('database unavailable'),
    })).toEqual({ ok: false });
  });
});
