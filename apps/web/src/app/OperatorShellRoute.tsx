import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { LoaderFunctionArgs } from 'react-router';
import { ErrorState } from '../components';
import { createMovaSupabaseClient } from '../lib/supabase';
import { ArtistShell } from './ArtistShell';
import { displayId, parseDisplayId } from '../lib/display-ids';

export async function loader({ request }: LoaderFunctionArgs) {
  const host = new URL(request.url).hostname;
  if (host !== 'ops.mova-beauty.co' && host !== 'localhost' && host !== '127.0.0.1' && !host.endsWith('.vercel.app')) throw new Response('Not found', { status: 404 });
  return null;
}

export default function OperatorShellRoute() {
  const { businessId = '' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const supabase = useMemo(() => { try { return createMovaSupabaseClient(); } catch { return null; } }, []);
  const [state, setState] = useState<'loading'|'ready'|'denied'>('loading');
  useEffect(() => {
    let active = true;
    void (async () => {
      if (!supabase || !businessId) { if (active) setState('denied'); return; }
      const publicNumber = parseDisplayId('BID', businessId);
      const isLegacyUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(businessId);
      if (!publicNumber && !isLegacyUuid) { if (active) setState('denied'); return; }
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        const returnTo = publicNumber ? location.pathname : `/${encodeURIComponent(businessId)}${location.pathname.slice(`/${businessId}`.length)}`;
        const authPath = `/auth?returnTo=${encodeURIComponent(returnTo)}`;
        if (window.location.hostname === 'ops.mova-beauty.co') window.location.assign(`https://mova-beauty.co${authPath}`);
        else navigate(authPath, { replace: true });
        return;
      }
      const { data: business } = await supabase.from('mova_artist_businesses').select('id,business_number')
        .eq(publicNumber ? 'business_number' : 'id', publicNumber ?? businessId).maybeSingle();
      if (!business) { if (active) setState('denied'); return; }
      const routeId = displayId('BID', business.business_number);
      const { data } = await supabase.from('mova_artist_memberships').select('artist_business_id').eq('artist_business_id', business.id).eq('user_id', session.user.id).eq('status','active').maybeSingle();
      if (!active) return;
      if (!data) { setState('denied'); return; }
      sessionStorage.setItem('mova_active_artist_business_id', business.id);
      sessionStorage.setItem('mova_active_artist_business_display_id', routeId);
      if (isLegacyUuid) {
        const rest = location.pathname.slice(`/${businessId}`.length).replace(/^\//,'');
        navigate(`/${routeId}${rest ? `/${rest}` : '/'}`,{replace:true});
        return;
      }
      setState('ready');
    })();
    return () => { active = false; };
  }, [businessId, location.pathname, navigate, supabase]);
  if (state === 'loading') return <main className="mova-page" aria-busy="true"><p role="status">{t('operator.loading')}</p></main>;
  if (state === 'denied') return <main className="mova-page"><ErrorState title={t('operator.accessError')} retryLabel={t('operator.retry')} onRetry={() => window.location.reload()} /></main>;
  return <ArtistShell />;
}
