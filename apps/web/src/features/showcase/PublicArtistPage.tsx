import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Card, EmptyState, ErrorState, SectionOverline } from '../../components';
import { publicEnv } from '../../lib/env';
import { ErrorFallback } from '../../app/ErrorFallback';
import { PublicLocaleToggle } from '../../app/PublicLocaleToggle';
import { ConciergeWidget } from '../concierge/ConciergePages';
import { trackProfileEvent } from '../reports/track';

type Service = { id: string; name: string; category: string; duration_minutes: number; base_price_minor: number; deposit_type: 'none' | 'fixed' | 'percent'; deposit_value: number; location_deposits: Array<{ location_id: string; price_minor: number; duration_minutes: number; deposit_amount_minor: number }> };
type Look = { id: string; image_url: string; alt_text: string; service_ids: string[] };
type PublicLocation = { id: string; name: string; booking_mode: 'instant' | 'request'; time_zone: string };
export type PublicArtist = {
  profile: { display_name: string; handle: string; specialties: string[]; bio: string; preferred_locale: string; search_index_enabled: boolean; photo_urls: Record<string, Record<string, string>> };
  services: Service[]; looks: Look[]; locations: PublicLocation[]; bookable: boolean;
};

export function PublicArtistPage({ initialArtist = null, preview = false, handleOverride, initialLocale }: { initialArtist?: PublicArtist | null; preview?: boolean; handleOverride?: string; initialLocale?: 'en-US' | 'es-US' }) {
  const routeParams = useParams();
  const handle = handleOverride ?? routeParams.handle ?? '';
  const [params, setParams] = useSearchParams();
  const { i18n } = useTranslation();
  const navigate = useNavigate();
  const locale = params.get('locale') === 'es-US' ? 'es-US' : params.get('locale') === 'en-US' ? 'en-US' : initialLocale ?? (i18n.resolvedLanguage === 'es-US' ? 'es-US' : 'en-US');
  const t = i18n.getFixedT(locale);
  const tab = params.get('tab') === 'services' ? 'services' : 'looks';
  const [artist, setArtist] = useState<PublicArtist | null>(initialArtist);
  const [loading, setLoading] = useState(!initialArtist);
  const scrollPositions = useRef<Record<string, number>>({});
  const trackedHandle = useRef('');
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    if (initialArtist) return;
    setLoading(true); setError(false); setArtist(null);
    if (!publicEnv.VITE_SUPABASE_URL || !publicEnv.VITE_SUPABASE_ANON_KEY) { setError(true); setLoading(false); return; }
    try {
      const response = await fetch(`${publicEnv.VITE_SUPABASE_URL}/functions/v1/public-artist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: publicEnv.VITE_SUPABASE_ANON_KEY },
        body: JSON.stringify({ handle, tab, locale }),
      });
      const envelope = await response.json() as { data?: PublicArtist; error?: { code?: string } | null };
      if (!response.ok || !envelope.data) throw new Error(envelope.error?.code ?? 'PUBLIC_ARTIST_UNAVAILABLE');
      setArtist(envelope.data);
    } catch { setError(true); }
    finally { setLoading(false); }
  }, [handle, locale, tab, initialArtist]);

  useEffect(() => { if (!initialArtist) void load(); }, [load, initialArtist]);
  useEffect(() => {
    if (preview || !artist || trackedHandle.current === artist.profile.handle) return;
    trackedHandle.current = artist.profile.handle;
    trackProfileEvent(artist.profile.handle,'page_view');
  }, [artist, preview]);
  useEffect(() => { window.scrollTo({ top: scrollPositions.current[tab] ?? 0 }); }, [tab]);

  const switchTab = (next: 'looks' | 'services') => {
    scrollPositions.current[tab] = window.scrollY;
    setParams({ locale, tab: next });
  };



  if (loading) return <main className="mova-page" aria-busy="true"><p role="status">{t('showcase.loading')}</p></main>;
  if (error) return <main className="mova-page"><ErrorState title={t('showcase.loadError')} retryLabel={t('showcase.retry')} onRetry={() => void load()} /></main>;
  if (!artist) return <ErrorFallback />;

  const servicesById = new Map(artist.services.map((service) => [service.id, service]));
  const coverUrl = artist.profile.photo_urls.cover?.['512'];
  const bookingUrl = `/a/${encodeURIComponent(handle)}/book?${new URLSearchParams({ locale })}`;
  return <main lang={locale} className="mova-page mova-public-artist">
    {!preview && <PublicLocaleToggle />}
    <header className="mova-public-artist__header" style={coverUrl ? { backgroundImage: `linear-gradient(90deg, var(--forest), color-mix(in srgb, var(--forest) 68%, transparent)), url("${coverUrl}")` } : undefined}>
      {artist.profile.photo_urls.profile?.['512'] && <img className="mova-public-artist__avatar" src={artist.profile.photo_urls.profile['512']} alt="" />}
      <div><p className="mova-wordmark">mova.</p><h1>{artist.profile.display_name}</h1><p>@{artist.profile.handle}</p>{artist.locations[0] && <p className="mova-public-artist__location">{artist.locations[0].name}</p>}</div>
    </header>
    {artist.profile.specialties.length > 0 && <div className="mova-chip-list" aria-label={t('showcase.specialties')}>{artist.profile.specialties.map((specialty) => <span className="mova-chip mova-chip--static" key={specialty}>{specialty}</span>)}</div>}
    {artist.profile.bio && <p className="mova-public-artist__bio">{artist.profile.bio}</p>}
    <p className="sr-only" aria-live="polite">{tab === 'looks' ? t('showcase.looks') : t('showcase.services')}</p>
    <div className="mova-public-tabs" role="tablist" aria-label={t('showcase.tabs')}>
      <button id="mova-public-looks-tab" type="button" role="tab" aria-controls="mova-public-looks" aria-selected={tab === 'looks'} onClick={() => switchTab('looks')}>{t('showcase.looks')}</button>
      <button id="mova-public-services-tab" type="button" role="tab" aria-controls="mova-public-services" aria-selected={tab === 'services'} onClick={() => switchTab('services')}>{t('showcase.services')}</button>
    </div>
    <section id="mova-public-looks" role="tabpanel" aria-labelledby="mova-public-looks-tab" tabIndex={0} hidden={tab !== 'looks'}>
      <SectionOverline>{t('showcase.looks')}</SectionOverline>
      {artist.looks.length ? <div className="mova-looks-grid">{artist.looks.map((look) => <Card key={look.id} className="mova-look-card">
        <img src={look.image_url} alt={look.alt_text} loading="lazy" />
        {look.service_ids.map((id) => servicesById.get(id)).filter((service): service is Service => Boolean(service)).map((service) => {const depositUnavailable=service.location_deposits.some((item)=>item.deposit_amount_minor>0);return <div key={service.id}><p>{service.name}</p>{depositUnavailable?<p className="mova-public-services__deposit-note">{t('booking.depositUnavailable')}</p>:<Button type="button" variant="secondary" disabled={preview} onClick={() => { const query = new URLSearchParams({ service_id: service.id, portfolio_item_id: look.id }); navigate(`/a/${encodeURIComponent(handle)}/book?${query.toString()}`); }}>{t('showcase.bookThisLook')}</Button>}</div>;})}
      </Card>)}</div> : <EmptyState title={t('showcase.noLooks')} />}
    </section>
    <section id="mova-public-services" role="tabpanel" aria-labelledby="mova-public-services-tab" tabIndex={0} hidden={tab !== 'services'}>
      <SectionOverline>{t('showcase.services')}</SectionOverline>
      {artist.services.length ? <ul className="mova-public-services">{artist.services.map((service) => <li key={service.id}>
        <div><strong>{service.name}</strong><small>{service.category} · {service.duration_minutes} {t('showcase.minutes')}</small></div>
        <div><span>{formatMoney(service.base_price_minor, locale)}</span>{service.location_deposits.map((deposit) => { const location = artist.locations.find((entry) => entry.id === deposit.location_id); return <small key={deposit.location_id}>{location?.name}: {formatMoney(deposit.price_minor, locale)} · {deposit.deposit_amount_minor === 0 ? t('showcase.noDeposit') : `${formatMoney(deposit.deposit_amount_minor, locale)} ${t('showcase.deposit')}`}</small>; })}</div>
        {artist.bookable && (service.location_deposits.some((item)=>item.deposit_amount_minor>0)
          ? <p className="mova-public-services__deposit-note">{t('booking.depositUnavailable')}</p>
          : <Button type="button" variant="secondary" disabled={preview} onClick={() => navigate(`/a/${encodeURIComponent(handle)}/book?service_id=${encodeURIComponent(service.id)}&locale=${locale}`)}>{t('showcase.book')}</Button>)}
      </li>)}</ul> : <EmptyState title={t('showcase.noServices')} />}
    </section>
    {!preview&&<ConciergeWidget artistHandle={handle}/>}
    {!preview&&artist.bookable&&<div className="mova-public-artist__book"><Button onClick={()=>navigate(bookingUrl)}>{t('showcase.bookAppointment')}</Button></div>}
  </main>;
}

function formatMoney(amountMinor: number, locale: string) { return new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(amountMinor / 100); }
