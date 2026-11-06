export type BookingStatus = 'draft'|'pending_payment'|'pending_artist'|'confirmed'|'completed'|'cancelled'|'declined'|'expired'|'no_show';
export type BookingActor = 'artist'|'client'|'guest'|'worker'|'provider';
const transitions: Record<BookingStatus, BookingStatus[]> = {
  draft: ['pending_payment','pending_artist','confirmed','cancelled'],
  pending_payment: ['confirmed','pending_artist','expired','cancelled'],
  pending_artist: ['confirmed','declined','expired','cancelled'],
  confirmed: ['completed','cancelled','no_show'],
  completed: [], cancelled: [], declined: [], expired: [], no_show: [],
};
export function canTransitionBooking(input: { from: BookingStatus; to: BookingStatus; actor: BookingActor; instantInventory: boolean; depositPaid?: boolean }) {
  if (!transitions[input.from].includes(input.to)) return false;
  if (input.to === 'confirmed' && input.from === 'pending_payment' && !input.depositPaid) return false;
  if (input.to === 'confirmed' && input.from === 'pending_artist' && input.actor !== 'artist') return false;
  if (input.to === 'pending_artist' && input.instantInventory) return false;
  if (input.to === 'pending_artist' && input.from === 'pending_payment' && !input.depositPaid) return false;
  return true;
}

export function createManageUrl(origin: string, token: string) { return new URL(`/b/${encodeURIComponent(token)}`, origin).toString(); }
