import { describe, expect, it } from 'vitest';
import { canTransitionBooking, createManageUrl } from './booking.js';

describe('booking lifecycle', () => {
  it('does not confirm a request before artist acceptance', () => {
    expect(canTransitionBooking({ from: 'pending_artist', to: 'confirmed', actor: 'client', instantInventory: false })).toBe(false);
    expect(canTransitionBooking({ from: 'pending_artist', to: 'confirmed', actor: 'artist', instantInventory: false })).toBe(true);
  });
  it('requires paid deposit before a held booking confirms', () => {
    expect(canTransitionBooking({ from: 'pending_payment', to: 'confirmed', actor: 'provider', instantInventory: true, depositPaid: false })).toBe(false);
    expect(canTransitionBooking({ from: 'pending_payment', to: 'confirmed', actor: 'provider', instantInventory: true, depositPaid: true })).toBe(true);
  });
  it('builds a scoped manage URL without corrupting a token', () => {
    expect(createManageUrl('https://mova-beauty.co', 'abc+123')).toBe('https://mova-beauty.co/b/abc%2B123');
  });
});
