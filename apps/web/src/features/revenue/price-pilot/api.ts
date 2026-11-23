import { useCallback, useEffect, useState } from 'react';
import { useArtistBusiness } from '../../settings/useArtistBusiness';

// Shapes returned by the price-pilot function (supabase/functions/price-pilot/index.ts).
export type CheckKey = 'enough_menus' | 'fresh' | 'clear' | 'agree' | 'same_length' | 'own_bookings';
export type PriceRow = {
  service_id: string; location_id: string; service_name: string; category: string | null; location_name: string; duration_minutes: number;
  current_minor: number; own_location_price: boolean; action: 'raise' | 'hold' | 'needs_data'; suggested_minor: number; above_range: boolean; dismissed: boolean;
  evidence: { count: number; min: number; max: number; median: number; range_low: number; range_high: number; below_count: number; checks: Record<CheckKey, boolean>; passed: number; confidence: 'high' | 'medium' | 'low'; latest_checked_at: string | null };
  bookings_90d: number; avg_lead_days: number | null;
  impact: { per_month: number; now_minor: number; then_minor: number; change_minor: number };
};
export type Settings = { enabled: boolean; radius_miles: number; use_nearby_salons: boolean; use_competitor_menus: boolean; show_industry_context: boolean };
export type Overview =
  | { available: false }
  | {
    available: true; settings: Settings; usage: { used: number; limit: number; resets_on: string }; rows: PriceRow[];
    locations: Array<{ id: string; name: string; located: boolean }>;
    summary: { salons: number; updated_at: string | null; suggestions: number; monthly_change_minor: number; searching: boolean; sources_total: number };
    own_website_host: string | null;
  };
export type Detail = {
  row: PriceRow; radius_miles: number;
  menus: Array<{ source_id: string; name: string; distance_miles: number | null; checked_at: string; price_minor: number }>;
  without_menu: Array<{ source_id: string; name: string; distance_miles: number | null; rating: number | null; website_url: string | null }>;
  ratings: { nearby_average: number | null; own_average: number | null };
  bls: { hourly_median: number; area: 'metro' | 'state'; year: number | null } | null;
};

export class PilotError extends Error {
  constructor(public code: string) { super(code); }
}

let cache: { businessId: string; data: Overview } | null = null;
const listeners = new Set<() => void>();

export function usePricePilotCall() {
  const { client, businessId, loading } = useArtistBusiness();
  const call = useCallback(async <T,>(body: Record<string, unknown>): Promise<T> => {
    if (!client || !businessId) throw new PilotError('SIGNED_OUT');
    const result = await client.functions.invoke<{ data?: T; error?: { code?: string } }>('price-pilot', { body, headers: { 'x-mova-artist-business-id': businessId } });
    if (result.error) {
      const context = (result.error as { context?: Response }).context;
      const failed = context ? await context.json().catch(() => null) as { error?: { code?: string } } | null : null;
      throw new PilotError(failed?.error?.code ?? 'PRICE_PILOT_ACTION_FAILED');
    }
    if (result.data?.error) throw new PilotError(result.data.error.code ?? 'PRICE_PILOT_ACTION_FAILED');
    return result.data?.data as T;
  }, [client, businessId]);
  return { call, businessId, identityLoading: loading, signedIn: Boolean(client && businessId) };
}

/** Overview shared by every PricePilot screen, kept between screens and refreshed after changes. */
export function usePricePilotOverview(autoload = true) {
  const { call, businessId, identityLoading, signedIn } = usePricePilotCall();
  const [data, setData] = useState<Overview | null>(cache && cache.businessId === businessId ? cache.data : null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(!data);
  const reload = useCallback(async () => {
    if (!businessId) return;
    setLoading(true); setError(false);
    try {
      const next = await call<Overview>({ action: 'overview' });
      cache = { businessId, data: next };
      listeners.forEach((fn) => fn());
    } catch { setError(true); } finally { setLoading(false); }
  }, [businessId, call]);
  useEffect(() => {
    const sync = () => { if (cache && cache.businessId === businessId) setData(cache.data); };
    listeners.add(sync); sync();
    return () => { listeners.delete(sync); };
  }, [businessId]);
  useEffect(() => { if (businessId && autoload) void reload(); }, [businessId, reload, autoload]);
  return { data, error, loading: identityLoading || (loading && !data), reload, call, businessId, signedIn };
}

export function usePricePilotDetail(serviceId: string | undefined, locationId: string | undefined) {
  const { call, businessId } = usePricePilotCall();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!businessId || !serviceId || !locationId) return;
    setError(null);
    try { setDetail(await call<Detail>({ action: 'detail', service_id: serviceId, location_id: locationId })); }
    catch (failure) { setError(failure instanceof PilotError ? failure.code : 'PRICE_PILOT_ACTION_FAILED'); }
  }, [businessId, serviceId, locationId, call]);
  useEffect(() => { setDetail(null); void load(); }, [load]);
  return { detail, error, reload: load };
}

export const rowKey = (row: { service_id: string; location_id: string }) => `${row.service_id}/${row.location_id}`;
