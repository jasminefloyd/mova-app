// Pure rules used by availability-search. Kept separate so they can be unit tested with Deno.

export type ServiceRule = { id: string; duration_minutes: number; buffer_minutes: number; deposit_type?: string | null; deposit_value?: number | null };
export type LocationServiceOverride = { service_id: string; duration_minutes_override: number | null };

/** Total minutes for an ordered set of services at one location, using each service's per-location duration override when present. */
export function combinedDurationMinutes(serviceIds: string[], services: ServiceRule[], overrides: LocationServiceOverride[]): number {
  return serviceIds.reduce((sum, serviceId) => {
    const service = services.find((entry) => entry.id === serviceId);
    if (!service) throw new Error('SERVICE_NOT_FOUND');
    const serviceOverride = overrides.find((entry) => entry.service_id === serviceId);
    return sum + (serviceOverride?.duration_minutes_override ?? service.duration_minutes) + service.buffer_minutes;
  }, 0);
}

/**
 * True when booking these services at this location would take a card deposit.
 * Mirrors mova_booking_create: deposits apply only where the stylist collects payment.
 */
export function requiresCardDeposit(paymentCollector: string | null | undefined, services: ServiceRule[]): boolean {
  if (paymentCollector !== 'artist') return false;
  return services.some((service) => (service.deposit_type ?? 'none') !== 'none' && Number(service.deposit_value ?? 0) > 0);
}
