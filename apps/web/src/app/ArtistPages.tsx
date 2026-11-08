import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Avatar, Button, Card, EmptyState, Icon, IconButton, ListRow, ScreenHeader } from '../components';
import { HomeAppointments } from '../features/bookings/HomeAppointments';
import { useArtistBusiness } from '../features/settings/useArtistBusiness';
import { LocaleSwitcher } from './LocaleSwitcher';
import { operatorUrl } from './operator-url';
import { ReportsPage } from '../features/reports/ReportsPage';

type Section = 'home' | 'calendar' | 'clients' | 'growth' | 'reports' | 'money';

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
  const [profile, setProfile] = useState<{display_name:string;handle:string;is_published:boolean}|null>(null);
  const [serviceCount, setServiceCount] = useState<number|null>(null);
  const [locationCount, setLocationCount] = useState<number|null>(null);
  const [paymentSummary, setPaymentSummary] = useState<string>('—');
  const [calendarSummary, setCalendarSummary] = useState<string>('—');
  const [languageExpanded, setLanguageExpanded] = useState(false);
  const [signOutError, setSignOutError] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  useEffect(() => {
    if (!client || !businessId) return;
    void (async()=>{
      const [{data:profileData},{count:services},{count:locations},{data:paymentMethods},{data:stripe},{data:calendar}] = await Promise.all([
        client.from('mova_artist_profiles').select('display_name,handle,is_published').eq('artist_business_id',businessId).maybeSingle(),
        client.from('mova_services').select('id',{count:'exact',head:true}).eq('artist_business_id',businessId).eq('status','active'),
        client.from('mova_locations').select('id',{count:'exact',head:true}).eq('artist_business_id',businessId).eq('is_active',true),
        client.from('mova_payment_method_settings').select('cash_enabled').eq('artist_business_id',businessId).maybeSingle(),
        client.from('mova_stripe_connections').select('status').eq('artist_business_id',businessId).maybeSingle(),
        client.from('mova_google_calendar_connections').select('status').eq('artist_business_id',businessId).maybeSingle(),
      ]);
      setProfile(profileData);setServiceCount(services??0);setLocationCount(locations??0);
      const enabled=[stripe?.status==='active'?'Stripe':null,(paymentMethods?.cash_enabled??true)?t('money.methods.cash'):null].filter(Boolean);
      setPaymentSummary(enabled.join(' · ')||t('settings.notConnected'));
      setCalendarSummary(calendar?.status==='active'?t('settings.connected'):t('settings.notConnected'));
    })();
  }, [client,businessId,t]);
  const signOut = async () => {
    if (!client) return;
    setSigningOut(true); setSignOutError(false);
    try {
      const { error } = await client.auth.signOut();
      if (error) { setSignOutError(true); setSigningOut(false); return; }
      window.sessionStorage.removeItem('mova_active_artist_business_id');
      window.sessionStorage.removeItem('mova_active_artist_business_display_id');
      if (window.location.hostname === 'ops.mova-beauty.co') {
        window.location.assign('https://mova-beauty.co/auth');
      } else {
        navigate('/auth', { replace: true });
      }
    } catch {
      setSignOutError(true);
      setSigningOut(false);
    }
  };
  const initials = (profile?.display_name ?? '').split(/\s+/).map((part)=>part[0]).join('').slice(0,2).toUpperCase();
  const publicUrl=profile?.handle?`${window.location.hostname==='localhost'?window.location.origin:'https://mova-beauty.co'}/a/${encodeURIComponent(profile.handle)}`:undefined;
  const localeName=i18n.resolvedLanguage==='es-US'?t('onboarding.spanish'):t('onboarding.english');
  return <main className="mova-page mova-settings-page">
    <ScreenHeader title={t('navigation.settings')} leadingIcon="close" backLabel={t('settings.close')} onBack={() => navigate(operatorUrl(businessId,''))} />
    <Card tone="inverse" className="mova-settings-profile"><Avatar label={profile?.display_name ?? t('settings.profile')} {...(initials ? { initials } : { placeholder:true })} size={56}/><span><strong>{profile?.display_name ?? t('settings.profile')}</strong><small>{t('settings.planAndShowcase',{plan:t('settings.planNotConfigured'),status:profile?.is_published?t('settings.published'):t('settings.unpublished')})}</small>{businessDisplayId&&<small>{businessDisplayId.replace('-', ' ')}</small>}</span><IconButton className="mova-settings-profile__preview" label={t('settings.previewProfile')} icon="preview" disabled={!profile?.handle} onClick={()=>navigate(operatorUrl(businessId,'settings/profile/preview'))}/></Card>
    <div className="mova-settings-actions"><Button variant="secondary" disabled={!publicUrl} onClick={()=>publicUrl&&window.open(publicUrl,'_blank','noopener,noreferrer')}>{t('settings.viewMyPage')}</Button><Button variant="secondary" onClick={()=>navigate(operatorUrl(businessId,'settings/qr'))}>{t('settings.showMyQr')}</Button></div>
    <Card className="mova-settings-menu">
      <ListRow title={t('settings.profilePortfolio')} trailing={<Icon name="chevron" size={18}/>} href={operatorUrl(businessId,'settings/profile')} />
      <ListRow title={t('settings.servicesPricesDeposits')} trailing={serviceCount===null?'—':String(serviceCount)} href={operatorUrl(businessId,'settings/services')} />
      <ListRow title={t('settings.locationsHours')} trailing={locationCount===null?'—':String(locationCount)} href={operatorUrl(businessId,'settings/locations')} />
      <ListRow title={t('settings.paymentsPayouts')} trailing={paymentSummary} href={operatorUrl(businessId,'settings/payments')} />
      <ListRow title={t('settings.calendarSync')} trailing={calendarSummary} href={operatorUrl(businessId,'settings/calendar-sync')} />
      <ListRow title={t('settings.reviewsGoogle')} trailing={t('settings.notConnected')} href={operatorUrl(businessId,'settings/reviews')} />
      <ListRow title={t('settings.plan')} trailing={t('settings.planNotConfigured')} href={operatorUrl(businessId,'settings/plan')} />
      <button type="button" className="mova-list-row mova-settings-language-row" aria-expanded={languageExpanded} onClick={()=>setLanguageExpanded(value=>!value)}><span className="mova-list-row__copy"><strong>{t('settings.languageNotifications')}</strong></span><span className="mova-list-row__trailing">{localeName}</span></button>
      <ListRow title={t('settings.privacyData')} href={operatorUrl(businessId,'settings/privacy')} />
    </Card>
    {languageExpanded&&<section className="mova-settings-language" id="mova-settings-language" aria-label={t('settings.languageNotifications')}><LocaleSwitcher /></section>}
    {signOutError && <p role="alert">{t('settings.signOutError')}</p>}
    <Button variant="ghost" className="mova-settings-signout" loading={signingOut} onClick={()=>void signOut()}>{t('settings.signOut')}</Button>
  </main>;
}
