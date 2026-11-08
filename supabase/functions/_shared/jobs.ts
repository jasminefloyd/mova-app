export type OutboxEvent = {
  id: string;
  artist_business_id: string | null;
  event_type: string;
  payload: Record<string, unknown>;
};

export function notificationKeys(eventType: string) {
  if (eventType.startsWith('appointment.')) return { title: 'notifications.appointment.title', body: 'notifications.appointment.body' };
  if (eventType === 'slot.opened') return { title: 'notifications.slotOpened.title', body: 'notifications.slotOpened.body' };
  if (eventType.startsWith('payment.')) return { title: 'notifications.payment.title', body: 'notifications.payment.body' };
  return { title: 'notifications.update.title', body: 'notifications.update.body' };
}

export function outboxJobKey(eventId: string) {
  return `outbox:${eventId}`;
}

export function eventNotificationPayload(event: OutboxEvent) {
  return { source_event_id: event.id };
}
