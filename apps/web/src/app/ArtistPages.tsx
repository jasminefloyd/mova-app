import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Avatar, Button, Card, EmptyState, Icon, ListRow, ScreenHeader } from '../components';
import { HomeAppointments } from '../features/bookings/HomeAppointments';
import { useArtistBusiness } from '../features/settings/useArtistBusiness';
import { clearOfflineData } from '../pwa/offline-data';
import { operatorUrl } from './operator-url';
import { ReportsPage } from '../features/reports/ReportsPage';
import { usePlan } from '../features/billing/PlanProvider';
import '../features/billing/billing.css';
import { FeedbackSheet } from '../features/settings/FeedbackSheet';
import { connectedCount, loadConnectionStatuses } from '../features/connections/connections-api';

const CONNECTION_TOTAL = 5;

type Section = 'home' | 'calendar' | 'clients' | 'growth' | 'reports' | 'money';
type SettingsProfile = { display_name: string; handle: string; is_published: boolean; search_index_enabled: boolean; photoUrl: string | null };

export function ArtistPage({ section }: { section: Section }) {
  const { t } = useTranslation();
  const { businessId } = useArtistBusiness();
  const title = section === 'growth' ? t('navigation.growthTitle') : t(`navigation.${section}`);
  if (section === 'home') return <HomeAppointments onOpenSettings={() => window.location.assign(operatorUrl(businessId, 'settings'))} />;
  if (section === 'reports') return <ReportsPage />;
  return <main className="mova-page">
    <ScreenHeader title={title} />
    <h1>{title}</h1>
    <EmptyState title={t('navigation.sectionComing')} />
  </main>;
}

export function SettingsPage() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const { client, businessId, businessDisplayId } = useArtistBusiness();
  const [profile, setProfile] = useState<SettingsProfile | null>(null);
  const [serviceCount, setServiceCount] = useState<number|null>(null);
  const [locationCount, setLocationCount] = useState<number|null>(null);
  const [paymentSummary, setPaymentSummary] = useState<string>('—');
  const [connectionsSummary, setConnectionsSummary] = useState<string>('—');
  const [signOutError, setSignOutError] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const { summary: planSummary, loading: planLoading } = usePlan();
  const planName = (key: string) => t(`plan.names.${key}`, { defaultValue: key });
  const currentPlanName = planSummary ? planName(planSummary.current_plan.plan_key) : null;
  // T12: the Plan row says where the stylist stands; locked rows carry the plan that unlocks them.
  const planTrailing = !planSummary ? t(planLoading ? 'plan.loading' : 'plan.error')
    : planSummary.trial?.state === 'trialing' ? t('settingsPlan.trialDays', { plan: planName('ai_growth'), count: planSummary.trial.days_left ?? 0 })
    : planSummary.trial?.state === 'ended_free' && planSummary.current_plan.plan_key === 'free' ? t('settingsPlan.trialEnded')
    : currentPlanName;
  const [publishError, setPublishError] = useState(false);
  useEffect(() => {
    if (!client || !businessId) return;
    let active = true;
    void (async()=>{
      const [{data:profileData},{count:services},{count:locations},{data:paymentMethods},{data:stripe}] = await Promise.all([
        client.from('mova_artist_profiles').select('display_name,handle,is_published,search_index_enabled,profile_photo_path').eq('artist_business_id',businessId).maybeSingle(),
        client.from('mova_services').select('id',{count:'exact',head:true}).eq('artist_business_id',businessId).eq('status','active'),
        client.from('mova_locations').select('id',{count:'exact',head:true}).eq('artist_business_id',businessId).eq('is_active',true),
        client.from('mova_payment_method_settings').select('cash_enabled').eq('artist_business_id',businessId).maybeSingle(),
        client.from('mova_stripe_connections').select('status').eq('artist_business_id',businessId).maybeSingle(),
      ]);
      if (!active) return;
      setProfile(profileData ? { ...profileData, photoUrl: null } : null);
      setServiceCount(services??0);setLocationCount(locations??0);
      const enabled=[stripe?.status==='active'?'Stripe':null,(paymentMethods?.cash_enabled??true)?t('money.methods.cash'):null].filter(Boolean);
      setPaymentSummary(enabled.join(' · ')||t('settings.notConnected'));
      // "3 of 5 on": the same statuses the Connections hub shows.
      void loadConnectionStatuses(client,businessId).then((statuses)=>{ if (active) setConnectionsSummary(t('connections.settingsSummary',{count:connectedCount(statuses),total:CONNECTION_TOTAL})); }).catch(()=>undefined);
      if (profileData?.profile_photo_path) {
        const { data } = await client.storage.from('mova_profile_photos').createSignedUrl(profileData.profile_photo_path, 300);
        if (active && data?.signedUrl) {
          setProfile((current) => current ? { ...current, photoUrl: data.signedUrl } : current);
        }
      }
    })();
    return () => { active = false; };
  }, [client,businessId,t]);
  const signOut = async () => {
    if (!client) return;
    setSigningOut(true); setSignOutError(false);
    try {
      const { error } = await client.auth.signOut();
      if (error) { setSignOutError(true); setSigningOut(false); return; }
      await clearOfflineData();
      window.sessionStorage.removeItem('mova_active_artist_business_id');
      window.sessionStorage.removeItem('mova_active_artist_business_display_id');
      if (window.location.hostname === 'ops.mova-beauty.co') {
        window.location.assign('https://mova-beauty.co/login');
      } else {
        navigate('/login', { replace: true });
      }
    } catch {
      setSignOutError(true);
      setSigningOut(false);
    }
  };
  const publishShowcase = async () => {
    if (!client || !businessId || !profile || profile.is_published) return;
    setPublishing(true); setPublishError(false);
    try {
      const { error } = await client.rpc('mova_publish_artist_profile', {
        p_artist_business_id: businessId,
        p_search_index_enabled: profile.search_index_enabled,
      });
      if (error) throw error;
      setProfile((current) => current ? { ...current, is_published: true } : current);
    } catch {
      setPublishError(true);
    } finally {
      setPublishing(false);
    }
  };
  const initials = (profile?.display_name ?? '').split(/\s+/).map((part)=>part[0]).join('').slice(0,2).toUpperCase();
  const showcaseStatus = profile ? t(profile.is_published ? 'settings.published' : 'settings.unpublished') : null;
  const publicUrl=profile?.handle?`${window.location.hostname==='localhost'?window.location.origin:'https://mova-beauty.co'}/a/${encodeURIComponent(profile.handle)}`:undefined;
  const localeName=i18n.resolvedLanguage==='es-US'?t('onboarding.spanish'):t('onboarding.english');
  return <main className="mova-page mova-settings-page">
    <ScreenHeader title={t('navigation.settings')} leadingIcon="close" backLabel={t('settings.close')} onBack={() => navigate(operatorUrl(businessId,''))} />
    <Card tone="inverse" className="mova-settings-profile">
      <Avatar label={profile?.display_name ?? t('settings.profile')} src={profile?.photoUrl ?? null} {...(initials ? { initials } : { placeholder: true })} size={56} />
      <span>
        <strong>{profile?.display_name ?? t('settings.profile')}</strong>
        {showcaseStatus && <small>{currentPlanName ? t('settings.planAndShowcase', { plan: currentPlanName, status: showcaseStatus }) : showcaseStatus}</small>}
        {businessDisplayId && <small>{businessDisplayId.replace('-', ' ')}</small>}
      </span>
    </Card>
    <div className="mova-settings-actions">{profile?.is_published
      ? <Button variant="secondary" disabled={!publicUrl} onClick={()=>publicUrl&&window.open(publicUrl,'_blank','noopener,noreferrer')}>{t('settings.viewMyPage')}</Button>
      : <Button loading={publishing} disabled={!profile} onClick={()=>void publishShowcase()}>{t('settings.publishShowcase')}</Button>}
      <Button variant="secondary" onClick={()=>navigate(operatorUrl(businessId,'settings/qr'))}>{t('settings.showMyQr')}</Button>
    </div>
    {publishError && <p role="alert">{t('settings.publishShowcaseError')}</p>}
    <Card className="mova-settings-menu">
      <ListRow title={t('settings.profilePortfolio')} trailing={<Icon name="chevron" size={18}/>} href={operatorUrl(businessId,'settings/profile')} />
      <ListRow title={t('settings.servicesPricesDeposits')} trailing={serviceCount===null?'—':String(serviceCount)} href={operatorUrl(businessId,'settings/services')} />
      <ListRow title={t('settings.locationsHours')} trailing={locationCount===null?'—':String(locationCount)} href={operatorUrl(businessId,'settings/locations')} />
      {/* CN1: one Connections row replaces Calendar sync, Reviews & Google profile and Google · profile & calendar. */}
      <ListRow title={t('connections.settingsRow')} trailing={connectionsSummary} href={operatorUrl(businessId,'settings/connections')} />
      <ListRow title={t('settings.paymentsPayouts')} trailing={paymentSummary} href={operatorUrl(businessId,'settings/payments')} />
      <ListRow title={t('settings.plan')} trailing={planTrailing} href={operatorUrl(businessId,'settings/plan')} />
      <ListRow title={t('settings.languageNotifications')} trailing={localeName} href={operatorUrl(businessId,'settings/notifications')} />
      <ListRow title={t('settings.privacyData')} href={operatorUrl(businessId,'settings/privacy')} />
    </Card>
    <button type="button" className="mova-settings-feedback" onClick={()=>setFeedbackOpen(true)}><Icon name="message" size={16}/>{t('feedback.link')} <span>{t('feedback.linkAction')}</span></button>
    <FeedbackSheet open={feedbackOpen} onClose={()=>setFeedbackOpen(false)} />
    {signOutError && <p role="alert">{t('settings.signOutError')}</p>}
    <Button variant="ghost" className="mova-settings-signout" loading={signingOut} onClick={()=>void signOut()}>{t('settings.signOut')}</Button>
  </main>;
}
