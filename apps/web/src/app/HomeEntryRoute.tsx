import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router';
import type { MetaFunction } from 'react-router';
import LandingPage, { meta as landingMeta } from '../features/website/LandingPage';
import { createMovaSupabaseClient } from '../lib/supabase';
import { clientProfilesEnabled } from '../lib/env';
import { goTo, openWorkspace, resolveWorkspaces } from '../features/auth/stylist-workspace';

export const meta: MetaFunction = landingMeta;

/** Public entry for signed-out visitors; restore signed-in users to their Mova home. */
export default function HomeEntryRoute() {
  const navigate = useNavigate();
  const supabase = useMemo(() => { try { return createMovaSupabaseClient(); } catch { return null; } }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      if (!supabase) return;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        const resolution = await resolveWorkspaces(supabase, session.user.id, '');
        if (resolution.kind !== 'none') {
          const selectedId = window.sessionStorage.getItem('mova_active_artist_business_id');
          const selected = resolution.kind === 'one' ? resolution.businessId
            : resolution.choices.find((choice) => choice.id === selectedId)?.id
              ?? [...resolution.choices].sort((a, b) => a.label.localeCompare(b.label))[0]?.id;
          if (selected) {
            const target = await openWorkspace(supabase, selected);
            if (active) goTo(target, navigate);
            return;
          }
        }

        if (clientProfilesEnabled) {
          const { data } = await supabase.functions.invoke<{ data?: { profile?: unknown } }>('customer-profile', { body: { action: 'profile' } });
          if (data?.data?.profile) {
            if (active) navigate('/me', { replace: true });
            return;
          }
        }
        if (active) navigate('/onboarding/profile', { replace: true });
      } catch {
        // Keep the public page available through temporary membership lookup failures.
      }
    })();
    return () => { active = false; };
  }, [navigate, supabase]);

  return <LandingPage />;
}
