import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Card, EmptyState, ErrorState, Icon } from '../../components';
import { publicEnv, publicReviewsEnabled, stripeTestModeEnabled, webChatEnabled } from '../../lib/env';
import { ErrorFallback } from '../../app/ErrorFallback';
import { PUBLIC_PROFILE_LOCALE as locale } from '../../app/locale';
import { WebChat } from '../concierge/WebChat';
import { trackProfileEvent } from '../reports/track';
import { CoverPhotoCredit } from './CoverPhotoCredit';
import { MAX_PUBLIC_BOOKING_SERVICES, publicBookingLocations } from '../bookings/public-booking-locations';

type Service = { id: string; name: string; category: string; description?: string; duration_minutes: number; buffer_minutes?: number; base_price_minor: number; deposit_type: 'none' | 'fixed' | 'percent'; deposit_value: number; location_deposits: Array<{ location_id: string; price_minor: number; duration_minutes: number; deposit_amount_minor: number }> };
type Look = { id: string; image_url: string; alt_text: string; service_ids: string[] };
type PublicLocation = { id: string; name: string; booking_mode: 'instant' | 'request'; time_zone: string; address?: Record<string, string | undefined> };
export type PublicArtist = {
  profile: { display_name: string; handle: string; specialties: string[]; bio: string; preferred_locale: string; search_index_enabled: boolean; photo_urls: Record<string, Record<string, string>>; rating_average?: number | null; rating_count?: number; cover_source?: 'upload' | 'unsplash'; cover_image_url?: string | null; cover_credit_name?: string | null; cover_credit_url?: string | null; cover_unsplash_url?: string | null; contact_phone?: string | null; contact_email?: string | null; website_url?: string | null; social_links?: Partial<Record<'instagram' | 'facebook' | 'linkedin' | 'tiktok' | 'youtube', string>> | null };
  services: Service[]; looks: Look[]; locations: PublicLocation[]; bookable: boolean;
};

export function PublicArtistPage({ initialArtist = null, preview = false, handleOverride }: { initialArtist?: PublicArtist | null; preview?: boolean; handleOverride?: string }) {
  const routeParams = useParams();
  const handle = handleOverride ?? routeParams.handle ?? '';
  const [params, setParams] = useSearchParams();
  const { t } = useTranslation('common', { lng: locale });
  const navigate = useNavigate();
  const [artist, setArtist] = useState<PublicArtist | null>(initialArtist);
  const requestedTab = params.get('tab');
  const tab = requestedTab === 'services' || (!requestedTab && artist?.looks.length === 0) ? 'services' : 'looks';
  const [loading, setLoading] = useState(!initialArtist);
  const [shareCopied, setShareCopied] = useState(false);
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

  const shareProfile = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ title: `${artist?.profile.display_name ?? 'mova'} | mova`, url });
      else { await navigator.clipboard.writeText(url); setShareCopied(true); window.setTimeout(() => setShareCopied(false), 2200); }
    } catch {
      try { await navigator.clipboard.writeText(url); setShareCopied(true); window.setTimeout(() => setShareCopied(false), 2200); }
      catch { /* Sharing is optional; keep the profile usable when clipboard access is denied. */ }
    }
  };



  if (loading) return <main className="mova-page" aria-busy="true"><p role="status">{t('showcase.loading')}</p></main>;
  if (error) return <main className="mova-page"><ErrorState title={t('showcase.loadError')} retryLabel={t('showcase.retry')} onRetry={() => void load()} /></main>;
  if (!artist) return <ErrorFallback />;

  const servicesById = new Map(artist.services.map((service) => [service.id, service]));
  const locationsById = new Map(artist.locations.map(location => [location.id, location.name]));
  const bookableServiceIds = new Set(artist.bookable
    ? artist.services.filter(service => publicBookingLocations(artist.locations, [service], stripeTestModeEnabled).length > 0).map(service => service.id)
    : []);
  function bookServices(serviceIds: string[], lookId?: string) {
    const query = new URLSearchParams({ locale });
    query.set(serviceIds.length === 1 ? 'service_id' : 'service_ids', serviceIds.join(','));
    if (lookId) query.set('portfolio_item_id', lookId);
    navigate(`/a/${encodeURIComponent(handle)}/book?${query}`);
  }

  function bookingLabel(label: string, locked: boolean) {
    return locked ? t('showcase.bookLocked', { action: label }) : undefined;
  }
  const coverUrl = artist.profile.cover_source === 'unsplash' ? artist.profile.cover_image_url : artist.profile.photo_urls.cover?.['512'];
  const bookingUrl = `/a/${encodeURIComponent(handle)}/book?${new URLSearchParams({ locale })}`;
  const profilePhoto = artist.profile.photo_urls.profile?.['512'];
  const locationsLabel = artist.locations.map((location) => location.name).join(' · ');
  const reputation = publicReviewsEnabled && artist.profile.rating_average != null && (artist.profile.rating_count ?? 0) > 0
    ? <span className="mova-public-artist__rating"><span aria-hidden="true">★</span> {artist.profile.rating_average.toFixed(1)} ({artist.profile.rating_count})</span>
    : null;
  return <main lang={locale} className="mova-page mova-public-artist">
    <div className="mova-public-artist__hero" style={coverUrl ? { backgroundImage: `url("${coverUrl}")` } : undefined}>
      {!coverUrl && <div className="mova-public-artist__hero-art" aria-hidden="true"><span/><span/></div>}
      <div className="mova-public-artist__topbar">
        <span className="mova-public-artist__brand" role="img" aria-label="Mova">m</span>
        {!preview && <div className="mova-public-artist__actions"><button type="button" className="mova-public-artist__share" aria-label={t('identity.shareLink')} onClick={() => void shareProfile()}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3m0 0L7.5 7.5M12 3l4.5 4.5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg></button></div>}
      </div>
    </div>
    <section className="mova-public-artist__profile">
      <div className="mova-public-artist__cover-details">
        <div className="mova-public-artist__avatar">{profilePhoto ? <img src={profilePhoto} alt="" /> : <span aria-hidden="true"><i/><b/></span>}</div>
        {coverUrl && artist.profile.cover_source === 'unsplash' && artist.profile.cover_credit_name && artist.profile.cover_credit_url && artist.profile.cover_unsplash_url && (
          <CoverPhotoCredit name={artist.profile.cover_credit_name} url={artist.profile.cover_credit_url} unsplashUrl={artist.profile.cover_unsplash_url} locale={locale} />
        )}
      </div>
      <h1>{artist.profile.display_name}</h1>
      <p className="mova-public-artist__specialties">{artist.profile.specialties.join(' · ')}{artist.profile.specialties.length > 0 && reputation && ' · '}{reputation}</p>
      {locationsLabel && <p className="mova-public-artist__location"><Icon name="location" size={24}/><span>{locationsLabel}</span></p>}
      {artist.profile.bio && <p className="mova-public-artist__bio">{artist.profile.bio}</p>}
      <span role="status" className="sr-only">{shareCopied ? t('identity.linkCopied') : ''}</span>
    </section>
    <p className="sr-only" aria-live="polite">{tab === 'looks' ? t('showcase.looks') : t('showcase.services')}</p>
    <div className="mova-public-tabs" role="tablist" aria-label={t('showcase.tabs')}>
      <button id="mova-public-looks-tab" type="button" role="tab" aria-controls="mova-public-looks" aria-selected={tab === 'looks'} onClick={() => switchTab('looks')}>{t('showcase.looks')}</button>
      <button id="mova-public-services-tab" type="button" role="tab" aria-controls="mova-public-services" aria-selected={tab === 'services'} onClick={() => switchTab('services')}>{t('showcase.services')}</button>
    </div>
    <section id="mova-public-looks" role="tabpanel" aria-labelledby="mova-public-looks-tab" tabIndex={0} hidden={tab !== 'looks'}>
      <h2 className="sr-only">{t('showcase.looks')}</h2>
      {artist.looks.length ? <div className="mova-looks-grid">{artist.looks.map(look => {
        const serviceIds = [...new Set(look.service_ids)];
        const services = serviceIds.map(id => servicesById.get(id)).filter((service): service is Service => Boolean(service));
        const locked = !artist.bookable || services.length !== serviceIds.length
          || serviceIds.length > MAX_PUBLIC_BOOKING_SERVICES
          || publicBookingLocations(artist.locations, services, stripeTestModeEnabled).length === 0;
        const label = t('showcase.bookThisLook');
        const caption = look.alt_text || services.map(service => service.name).join(' · ');
        return <Card key={look.id} className="mova-look-card">
          <img src={look.image_url} alt={look.alt_text} loading="lazy" />
          <div className="mova-look-card__body">
            {caption && <p>{caption}</p>}
            {serviceIds.length > 0 && <Button type="button" variant="ghost" disabled={preview || locked}
              {...(locked ? { leadingIcon: 'lock' as const } : {})} aria-label={bookingLabel(label, locked)}
              onClick={() => bookServices(serviceIds, look.id)}>
              {label}
            </Button>}
          </div>
        </Card>;
      })}</div> : <EmptyState title={t('showcase.noLooks')} />}
    </section>
    <section id="mova-public-services" role="tabpanel" aria-labelledby="mova-public-services-tab" tabIndex={0} hidden={tab !== 'services'}>
      <h2 className="sr-only">{t('showcase.services')}</h2>
      {artist.services.length ? <ul className="mova-public-services">{artist.services.map(service => {
        const entries = service.location_deposits.flatMap(item => {
          const name = locationsById.get(item.location_id);
          return name ? [{ ...item, name }] : [];
        });
        const amounts = new Set(entries.map(item => item.deposit_amount_minor));
        const sameDeposit = amounts.size <= 1;
        const depositText = (amount: number) => amount > 0
          ? t('booking.depositSummary', { amount: formatMoney(amount, locale) })
          : t('showcase.noDeposit');
        const label = t('showcase.book');
        const locked = !bookableServiceIds.has(service.id);
        return <li key={service.id}>
          <div className="mova-public-services__head"><strong>{service.name}</strong><span className="mova-public-services__price">{formatMoney(service.base_price_minor, locale)}</span></div>
          {service.description && <p className="mova-public-services__description">{service.description}</p>}
          <div className="mova-public-services__info">
            <div className="mova-public-services__facts">
              <div className="mova-public-services__badges">
                <span><Icon name="clock" size={15} />{formatDuration(service.duration_minutes)}</span>
                {sameDeposit && entries[0] && <span><Icon name="check" size={15} />{depositText(entries[0].deposit_amount_minor)}</span>}
              </div>
              {entries.length > 0 && <div className="mova-public-services__locations">
                <Icon name="location" size={16} />
                {sameDeposit
                  ? <span>{entries.map(item => item.name).join(' · ')}</span>
                  : <div className="mova-public-services__location-deposits">
                    {entries.map(item => <div key={item.location_id}><span>{item.name}</span><span>{depositText(item.deposit_amount_minor)}</span></div>)}
                  </div>}
              </div>}
            </div>
            <Button type="button" variant="secondary" disabled={preview || locked} {...(locked ? { leadingIcon: 'lock' as const } : {})}
              aria-label={bookingLabel(label, locked)} onClick={() => bookServices([service.id])}>{label}</Button>
          </div>
        </li>;
      })}</ul> : <EmptyState title={t('showcase.noServices')} />}
    </section>
    {!preview&&webChatEnabled&&<WebChat artistHandle={handle} stylistName={artist.profile.display_name}/>}
    {!preview && artist.services.length > 0 && <div className="mova-public-artist__book">
      <Button disabled={bookableServiceIds.size === 0} {...(bookableServiceIds.size === 0 ? { leadingIcon: 'lock' as const } : {})}
        aria-label={bookingLabel(t('showcase.bookAppointment'), bookableServiceIds.size === 0)} onClick={() => navigate(bookingUrl)}>
        {t('showcase.bookAppointment')}
      </Button>
    </div>}
  </main>;
}

function formatMoney(amountMinor: number, locale: string) { return new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(amountMinor / 100); }
function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return [hours ? `${hours} h` : '', remainder ? `${remainder} min` : ''].filter(Boolean).join(' ') || '0 min';
}
