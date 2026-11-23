import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import { useArtistBusiness } from '../settings/useArtistBusiness';
import { planCall, type Client, type PlanSummary } from './plan-api';

// usePlan (free trial WP6): the plan, what it locks and the trial state for the active business.
// One fetch per business per session, refreshed on focus and after Stripe returns. Offline, the last
// confirmed summary is used; with nothing cached, nothing is shown as locked.

type PlanContextValue = {
  client: Client | null; businessId: string | null; summary: PlanSummary | null; loading: boolean; error: boolean;
  refresh: () => Promise<PlanSummary | null>; setSummary: (summary: PlanSummary) => void;
};
const PlanContext = createContext<PlanContextValue | null>(null);
const cacheKey = (businessId: string) => `mova_plan_summary_${businessId}`;

function readCache(businessId: string | null): PlanSummary | null {
  if (!businessId || typeof window === 'undefined') return null;
  try { const raw = window.sessionStorage.getItem(cacheKey(businessId)); return raw ? JSON.parse(raw) as PlanSummary : null; } catch { return null; }
}
function writeCache(businessId: string, summary: PlanSummary) {
  try { window.sessionStorage.setItem(cacheKey(businessId), JSON.stringify(summary)); } catch { /* storage unavailable */ }
}

export function PlanProvider({ children }: PropsWithChildren) {
  const { client, businessId } = useArtistBusiness();
  const [summary, setSummaryState] = useState<PlanSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const inFlight = useRef<Promise<PlanSummary | null> | null>(null);

  const setSummary = useCallback((next: PlanSummary) => {
    setSummaryState(next);
    if (businessId) writeCache(businessId, next);
  }, [businessId]);

  const refresh = useCallback(async () => {
    if (!client || !businessId) return null;
    if (inFlight.current) return inFlight.current;
    inFlight.current = (async () => {
      try {
        const next = await planCall(client, businessId, 'plan-management', { action: 'get' }) as unknown as PlanSummary;
        if (!next?.plans) throw new Error('INVALID');
        setSummary(next); setError(false);
        return next;
      } catch {
        setError(true);
        return null;
      } finally {
        setLoading(false);
        inFlight.current = null;
      }
    })();
    return inFlight.current;
  }, [businessId, client, setSummary]);

  useEffect(() => {
    if (!businessId) return;
    const cached = readCache(businessId);
    if (cached) { setSummaryState(cached); setLoading(false); }
    void refresh();
  }, [businessId, refresh]);

  useEffect(() => {
    const onFocus = () => { if (document.visibilityState === 'visible' && navigator.onLine !== false) void refresh(); };
    document.addEventListener('visibilitychange', onFocus);
    return () => document.removeEventListener('visibilitychange', onFocus);
  }, [refresh]);

  const value = useMemo(() => ({ client, businessId, summary, loading, error, refresh, setSummary }), [client, businessId, summary, loading, error, refresh, setSummary]);
  return <PlanContext.Provider value={value}>{children}</PlanContext.Provider>;
}

const EMPTY: PlanContextValue = { client: null, businessId: null, summary: null, loading: false, error: false, refresh: async () => null, setSummary: () => undefined };

/** The plan for the active business. Outside the operator shell it reports nothing (nothing locked). */
export function usePlan(): PlanContextValue {
  return useContext(PlanContext) ?? EMPTY;
}
