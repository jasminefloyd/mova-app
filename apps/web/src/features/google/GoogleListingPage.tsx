import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Checkbox, ScreenHeader } from '../../components';
import { operatorUrl } from '../../app/operator-url';
import { useArtistBusiness } from '../settings/useArtistBusiness';
import { GoogleActionError, invokeGoogle, relativeTime, type ListingChange, type ListingStatus } from './googleApi';
import './google.css';

type Service = { id: string; name: string; base_price_minor: number; status: string };

const money = (minor: number, locale?: string) => new Intl.NumberFormat(locale ?? 'en-US', { style: 'currency', currency: 'USD' }).format(minor / 100);

// Board 38d: Mova is the source. The screen shows what is waiting for Google and sends only that.
export function GoogleListingPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { client, businessId, loading: identityLoading } = useArtistBusiness();
  const [listing, setListing] = useState<ListingStatus | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [businessName, setBusinessName] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!client || !businessId) return;
    setLoading(true);
    setLoadError(false);
    try {
      const [status, { data: rows }, { data: profile }] = await Promise.all([
        invokeGoogle<ListingStatus>(client, businessId, 'google-business-sync', { action: 'status' }),
        client.from('mova_services').select('id,name,base_price_minor,status').eq('artist_business_id', businessId).eq('status', 'active').order('name'),
        client.from('mova_artist_profiles').select('display_name').eq('artist_business_id', businessId).maybeSingle(),
      ]);
      setListing(status);
      setServices((rows ?? []) as Service[]);
      setBusinessName(profile?.display_name ?? '');
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [client, businessId]);

  useEffect(() => { if (!identityLoading) void load(); }, [identityLoading, load]);

  const send = async () => {
    if (!client || !businessId) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await invokeGoogle(client, businessId, 'google-business-sync', { action: 'push' });
      setNotice(t('google.listing.sent'));
      await load();
    } catch (cause) {
      setError(cause instanceof GoogleActionError ? t(`google.errors.${cause.code}`, { defaultValue: t('google.listing.sendError') }) : t('google.listing.sendError'));
    } finally {
      setBusy(false);
    }
  };

  const setAutoSend = async (value: boolean) => {
    if (!client || !businessId) return;
    setBusy(true);
    setError('');
    try {
      await invokeGoogle(client, businessId, 'google-business-sync', { action: 'set-auto-send', auto_send: value });
      setListing((current) => current ? { ...current, auto_send: value } : current);
    } catch {
      setError(t('google.saveError'));
    } finally {
      setBusy(false);
    }
  };

  const changeText = (change: ListingChange) => {
    if (change.kind === 'service_new') return t('google.listing.changeNew', { name: change.label });
    if (change.kind === 'service') return t('google.listing.changeUpdated', { name: change.label });
    if (change.kind === 'service_removed') return t('google.listing.changeRemoved', { name: change.label });
    if (change.kind === 'profile') return t('google.listing.changeProfile');
    if (change.kind === 'hours') return t('google.listing.changeHours');
    return t('google.listing.changeLink');
  };

  const ready = Boolean(listing?.business_profile_ready);
  const waiting = listing?.changes ?? [];
  const sectionState = (value: 'waiting' | 'up_to_date' | undefined) => value === 'waiting' ? t('google.listing.waitingItem') : t('google.listing.upToDate');
  const newKeys = new Set(waiting.filter((change) => change.kind === 'service_new').map((change) => change.key));
  const waitingKeys = new Set(waiting.filter((change) => change.kind === 'service' || change.kind === 'service_new').map((change) => change.key));

  return <main className="mova-page mova-google-page mova-google-listing">
    <ScreenHeader onBack={() => navigate(operatorUrl(businessId, 'settings/google'))} backLabel={t('google.back')} />
    <h1>{t('google.listing.title')}</h1>
    {identityLoading || loading
      ? <p role="status" aria-busy="true">{t('google.loading')}</p>
      : loadError
        ? <div className="mova-google-message is-error" role="alert"><p>{t('google.loadError')}</p><Button variant="secondary" onClick={() => void load()}>{t('google.retry')}</Button></div>
        : <>
          <p className="mova-google-listing__intro">{t('google.listing.intro', { name: businessName || t('google.listing.title') })}</p>
          {!ready && <div className="mova-google-message"><p>{t('google.listing.notConnected')}</p><Button variant="secondary" onClick={() => navigate(operatorUrl(businessId, 'settings/google'))}>{t('google.account.title')}</Button></div>}
          {ready && waiting.length > 0 && <div className="mova-google-message is-waiting" role="status">
            <strong>{t('google.listing.waiting', { count: waiting.length })}</strong>
            <ul>{waiting.map((change) => <li key={change.key}>{changeText(change)}</li>)}</ul>
          </div>}

          <section className="mova-google-card" aria-label={t('google.listing.sendsTitle')}>
            <h2>{t('google.listing.sendsTitle')}</h2>
            <dl className="mova-google-rows">
              <div><dt><strong>{t('google.listing.nameAbout')}</strong><span>{t('google.listing.nameAboutDetail')}</span></dt><dd>{sectionState(listing?.sections.profile)}</dd></div>
              <div><dt><strong>{t('google.listing.hours')}</strong><span>{t('google.listing.hoursDetail')}</span></dt><dd>{sectionState(listing?.sections.hours)}</dd></div>
              <div><dt><strong>{t('google.listing.servicesMenu')}</strong><span>{t('google.listing.waitingCount', { count: listing?.sections.services_waiting ?? 0 })}</span></dt><dd>{(listing?.sections.services_waiting ?? 0) > 0 ? t('google.listing.waitingItem') : t('google.listing.upToDate')}</dd></div>
              <div><dt><strong>{t('google.listing.bookingLink')}</strong><span>{t('google.listing.bookingLinkDetail')}</span></dt><dd>{sectionState(listing?.sections.booking_link)}</dd></div>
            </dl>
          </section>

          <section className="mova-google-card" aria-labelledby="google-menu-heading">
            <h2 id="google-menu-heading">{t('google.listing.servicesMenu')}</h2>
            {services.length === 0
              ? <p>{t('google.listing.noServices')}</p>
              : <ul className="mova-google-menu">{services.map((service) => <li key={service.id}>
                <span>{service.name}{newKeys.has(`service:${service.id}`) && <span className="mova-google-badge">{t('google.listing.newBadge')}</span>}{!newKeys.has(`service:${service.id}`) && waitingKeys.has(`service:${service.id}`) && <span className="mova-google-badge is-soft">{t('google.listing.waitingItem')}</span>}</span>
                <strong>{money(service.base_price_minor, i18n.resolvedLanguage)}</strong>
              </li>)}</ul>}
            <Checkbox label={t('google.listing.autoSend')} checked={Boolean(listing?.auto_send)} disabled={busy || !ready} onChange={(event) => void setAutoSend(event.currentTarget.checked)} />
          </section>

          <p className="mova-google-footnote">{t('google.listing.note')}</p>
          {listing?.last_synced_at && <p className="mova-google-footnote">{t('google.account.synced', { time: relativeTime(listing.last_synced_at, i18n.resolvedLanguage) })}</p>}
          {notice && <p role="status" className="mova-google-message">{notice}</p>}
          {error && <p role="alert" className="mova-google-message is-error">{error}</p>}
          <div className="mova-google-listing__send">
            <Button loading={busy} disabled={busy || !ready || waiting.length === 0} onClick={() => void send()}>
              {waiting.length ? t('google.listing.send', { count: waiting.length }) : t('google.listing.nothingToSend')}
            </Button>
          </div>
        </>}
  </main>;
}

export default GoogleListingPage;
