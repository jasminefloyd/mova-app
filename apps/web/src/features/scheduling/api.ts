import { createMovaSupabaseClient } from '../../lib/supabase';

export type MovaClient = NonNullable<ReturnType<typeof createMovaSupabaseClient>>;

// Calls a Mova Edge Function as the signed-in stylist. Errors carry the server code so the UI can say what went wrong.
export async function callFunction<T>(client: MovaClient | null, businessId: string | null, name: string, body: Record<string, unknown>, headers: Record<string, string> = {}): Promise<T> {
  if (!client || !businessId) throw new Error('IDENTITY_MISSING');
  const { data: { session } } = await client.auth.getSession();
  if (!session) throw new Error('UNAUTHENTICATED');
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}`, 'x-mova-artist-business-id': businessId, ...headers },
    body: JSON.stringify({ artist_business_id: businessId, ...body }),
  });
  const json = await response.json().catch(() => null) as { data?: T; error?: { code?: string } | null } | null;
  if (!response.ok || !json) throw new Error(json?.error?.code ?? 'REQUEST_FAILED');
  return json.data as T;
}

export function errorCode(error: unknown): string {
  return error instanceof Error ? error.message : 'REQUEST_FAILED';
}

export type LocationRow = { id: string; name: string; time_zone: string; display_color_index: number; location_type: string; booking_mode: string };
export type ServiceRow = { id: string; name: string; duration_minutes: number; base_price_minor: number };
export type ServiceLocationRow = { service_id: string; location_id: string; price_minor_override: number | null; duration_minutes_override: number | null };
export type ClientRow = { id: string; client_number: number; display_name: string; email: string | null; phone: string | null };
export type BusyRow = { location_id: string; starts_at: string; ends_at: string };

// Active locations, services and their location overrides for a business. Used by New appointment and Block time.
export async function loadBookingOptions(client: MovaClient, businessId: string) {
  const [locations, services, links] = await Promise.all([
    client.from('mova_locations').select('id,name,time_zone,display_color_index,location_type,booking_mode').eq('artist_business_id', businessId).eq('is_active', true).order('display_color_index').order('name'),
    client.from('mova_services').select('id,name,duration_minutes,base_price_minor').eq('artist_business_id', businessId).eq('status', 'active').order('name'),
    client.from('mova_service_locations').select('service_id,location_id,price_minor_override,duration_minutes_override').eq('artist_business_id', businessId),
  ]);
  if (locations.error || services.error || links.error) throw new Error('OPTIONS_LOAD_FAILED');
  return {
    locations: (locations.data ?? []) as LocationRow[],
    services: (services.data ?? []) as ServiceRow[],
    links: (links.data ?? []) as ServiceLocationRow[],
  };
}

// Appointments and blocks that could collide with a window at the given locations.
export async function loadBusy(client: MovaClient, businessId: string, locationIds: string[], fromIso: string, toIso: string): Promise<BusyRow[]> {
  if (locationIds.length === 0) return [];
  const [appointments, blocks] = await Promise.all([
    client.from('mova_appointments').select('location_id,starts_at,ends_at').eq('artist_business_id', businessId).in('location_id', locationIds)
      .in('status', ['pending_payment', 'pending_artist', 'confirmed']).lt('starts_at', toIso).gt('ends_at', fromIso),
    client.from('mova_availability_blocks').select('location_id,starts_at,ends_at').eq('artist_business_id', businessId).in('location_id', locationIds)
      .lt('starts_at', toIso).gt('ends_at', fromIso),
  ]);
  if (appointments.error || blocks.error) throw new Error('BUSY_LOAD_FAILED');
  return [...(appointments.data ?? []), ...(blocks.data ?? [])] as BusyRow[];
}
