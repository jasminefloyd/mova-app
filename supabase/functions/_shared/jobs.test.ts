import { describe, expect, it } from 'vitest';
import { eventNotificationPayload, notificationKeys, outboxJobKey } from './jobs.ts';

describe('durable outbox jobs', () => {
  it('TC-NFR-JOB-01 derives a stable idempotency key from each outbox event', () => {
    expect(outboxJobKey('event-123')).toBe('outbox:event-123');
    expect(outboxJobKey('event-123')).toBe(outboxJobKey('event-123'));
    expect(outboxJobKey('event-456')).not.toBe(outboxJobKey('event-123'));
  });

  it('TC-NFR-JOB-02 maps event families to stable, non-PII notification keys', () => {
    expect(notificationKeys('appointment.confirmed')).toEqual({ title: 'notifications.appointment.title', body: 'notifications.appointment.body' });
    expect(notificationKeys('slot.opened')).toEqual({ title: 'notifications.slotOpened.title', body: 'notifications.slotOpened.body' });
    expect(notificationKeys('payment.succeeded')).toEqual({ title: 'notifications.payment.title', body: 'notifications.payment.body' });
    expect(notificationKeys('profile.published')).toEqual({ title: 'notifications.update.title', body: 'notifications.update.body' });
  });

  it('TC-NFR-JOB-03 records only the source event id in the inbox dedupe payload', () => {
    expect(eventNotificationPayload({ id: 'event-123', artist_business_id: 'tenant', event_type: 'appointment.created', payload: { email: 'private@example.invalid' } })).toEqual({ source_event_id: 'event-123' });
  });
});
