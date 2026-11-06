import { useEffect, useMemo, useState } from 'react';
import { createMovaSupabaseClient } from '../../lib/supabase';
import { displayId } from '../../lib/display-ids';

export function useArtistBusiness() {
  const client = useMemo(() => {
    try { return createMovaSupabaseClient(); } catch { return null; }
  }, []);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [businessDisplayId, setBusinessDisplayId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!client) { setLoading(false); return; }
    let active = true;
    void (async () => {
      const { data: { session } } = await client.auth.getSession();
      if (!session) { if (active) setLoading(false); return; }
      const selectedId = typeof window !== 'undefined' ? window.sessionStorage.getItem('mova_active_artist_business_id') : null;
      let membershipQuery = client.from('mova_artist_memberships').select('artist_business_id')
        .eq('user_id', session.user.id).eq('status', 'active');
      if (selectedId) membershipQuery = membershipQuery.eq('artist_business_id', selectedId);
      const { data } = await membershipQuery.limit(1).maybeSingle();
      if (data?.artist_business_id) {
        const { data: business } = await client.from('mova_artist_businesses').select('business_number').eq('id', data.artist_business_id).maybeSingle();
        if (active) {
          setBusinessId(data.artist_business_id);
          if (business?.business_number) {
            const routeId = displayId('BID', business.business_number);
            setBusinessDisplayId(routeId);
            window.sessionStorage.setItem('mova_active_artist_business_id', data.artist_business_id);
            window.sessionStorage.setItem('mova_active_artist_business_display_id', routeId);
          }
          setLoading(false);
        }
      } else if (active) { setBusinessId(null); setBusinessDisplayId(null); setLoading(false); }
    })();
    return () => { active = false; };
  }, [client]);
  return { client, businessId, businessDisplayId, loading };
}
