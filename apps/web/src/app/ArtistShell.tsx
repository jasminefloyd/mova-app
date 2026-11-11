import { useState } from 'react';
import { Outlet, useLocation, useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { TabBar } from '../components';
import { createArtistQueryClient } from '../lib/query-client';
import { ARTIST_LOCALE_KEY } from './locale';
import { ShellFrame } from './ShellFrame';
import { operatorUrl } from './operator-url';

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
  return <ShellFrame queryClient={queryClient} localeStorageKey={ARTIST_LOCALE_KEY} showBrandHeader={false}>
    <div className={isTabRoot ? 'mova-artist-view has-tab-bar' : 'mova-artist-view'}>
      <Outlet />
      {isTabRoot && <TabBar basePath={basePath} homePath={homePath} active={active} onNavigate={(path) => navigate(path)} labels={{
        home: t('navigation.home'), calendar: t('navigation.calendar'), clients: t('navigation.clients'),
        reviews: t('navigation.reviews'), reports: t('navigation.reports'),
      }} ariaLabel={t('navigation.ariaLabel')} />}
    </div>
  </ShellFrame>;
}
