import { useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { TabBar } from '../components';
import { createArtistQueryClient } from '../lib/query-client';
import { ARTIST_LOCALE_KEY } from './locale';
import { ShellFrame } from './ShellFrame';
import { operatorUrl } from './operator-url';
import { PlanProvider, usePlan } from '../features/billing/PlanProvider';
import { offerTrialNow, TRIAL_OFFER_KEY } from '../features/billing/trial-offer';

export function ArtistShell() {
  const [queryClient] = useState(createArtistQueryClient);
  const location = useLocation();
  const navigate = useNavigate();
  const { businessId = '' } = useParams();
  const { t } = useTranslation();
  const basePath = `/${encodeURIComponent(businessId)}`;
  const homePath = operatorUrl(businessId,'');
  const reviewsPath = operatorUrl(businessId, 'reports/reputation');
  const tabs = [homePath,...['calendar','clients'].map((path) => operatorUrl(businessId,path)),reviewsPath,operatorUrl(businessId,'reports')];
  const isTabRoot = tabs.includes(location.pathname);
  const active = location.pathname === basePath || location.pathname === `${basePath}/` ? homePath : location.pathname;
  return <ShellFrame queryClient={queryClient} localeStorageKey={ARTIST_LOCALE_KEY} showBrandHeader={false}><PlanProvider>
    <TrialOffer businessId={businessId} />
    <div className={isTabRoot ? 'mova-artist-view has-tab-bar' : 'mova-artist-view'}>
      <Outlet />
      {isTabRoot && <TabBar basePath={basePath} homePath={homePath} active={active} onNavigate={(path) => navigate(path)} labels={{
        home: t('navigation.home'), calendar: t('navigation.calendar'), clients: t('navigation.clients'),
        reviews: t('navigation.reviews'), reports: t('navigation.reports'),
      }} ariaLabel={t('navigation.ariaLabel')} />}
    </div>
  </PlanProvider></ShellFrame>;
}

/** T1 comes first on the stylist's first app entry after onboarding (owner only, once). */
function TrialOffer({ businessId }: { businessId: string }) {
  const { summary } = usePlan();
  const location = useLocation();
  const navigate = useNavigate();
  const shouldOffer = summary?.trial?.should_offer === true;
  useEffect(() => {
    let shown: string | null = null;
    try { shown = window.sessionStorage.getItem(TRIAL_OFFER_KEY); } catch { /* storage unavailable */ }
    if (!offerTrialNow(shouldOffer, location.pathname, shown, businessId)) return;
    try { window.sessionStorage.setItem(TRIAL_OFFER_KEY, businessId); } catch { /* storage unavailable */ }
    navigate(operatorUrl(businessId, 'start-trial'), { replace: true });
  }, [businessId, location.pathname, navigate, shouldOffer]);
  return null;
}
