import { describe, expect, it } from 'vitest';
import {
  resolveInAppNotificationPreference,
  resolveNotificationPreferences,
} from './notification-preferences.ts';

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

  it('returns stored preferences from the settings read', () => {
    expect(resolveNotificationPreferences({
      data: { preferences: { in_app: false, email: false, push: true } },
      error: null,
    })).toEqual({
      ok: true,
      preferences: { in_app: false, email: false, push: true },
    });
  });

  it('normalizes malformed legacy values to their safe defaults', () => {
    expect(resolveNotificationPreferences({
      data: { preferences: { in_app: 'false', email: false, push: null } },
      error: null,
    })).toEqual({
      ok: true,
      preferences: { in_app: true, email: false, push: false },
    });
  });
});

import { isEventPreferences, notificationEventFor, resolveEventPreferences } from './notification-preferences.ts';

describe('per-event notification preferences', () => {
  it('starts every event with email and push on', () => {
    const events = resolveEventPreferences(null);
    expect(Object.values(events).every((row) => row.email && row.push)).toBe(true);
    expect(Object.keys(events)).toEqual(['booking_request', 'cancellation', 'client_message', 'appointment_reminder', 'new_review']);
  });

  it('keeps a legacy account-wide email opt-out until an event is turned back on', () => {
    const events = resolveEventPreferences({ email: false, events: { new_review: { email: true } } });
    expect(events.booking_request.email).toBe(false);
    expect(events.new_review.email).toBe(true);
  });

  it('rejects unknown events or channels', () => {
    expect(isEventPreferences({ booking_request: { email: true, push: false } })).toBe(true);
    expect(isEventPreferences({ marketing: { email: true } })).toBe(false);
    expect(isEventPreferences({ booking_request: { sms: true } })).toBe(false);
  });

  it('maps outbox events to stylist alerts', () => {
    expect(notificationEventFor('appointment.pending_artist')).toBe('booking_request');
    expect(notificationEventFor('review.created')).toBe('new_review');
    expect(notificationEventFor('appointment.confirmed')).toBeNull();
  });
});
