export const MAX_PUBLIC_BOOKING_SERVICES = 8;

type PublicBookingService = {
  location_deposits: readonly { location_id: string; deposit_amount_minor: number }[];
};

export function publicBookingLocations<T extends { id: string }>(
  locations: readonly T[],
  services: readonly PublicBookingService[],
  allowDeposits: boolean,
): T[] {
  return locations.filter(location => services.every(service =>
    service.location_deposits.some(deposit =>
      deposit.location_id === location.id && (allowDeposits || deposit.deposit_amount_minor === 0)
    )
  ));
}
