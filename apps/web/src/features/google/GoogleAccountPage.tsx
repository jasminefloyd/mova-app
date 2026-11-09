import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, ScreenHeader, Toggle } from '../../components';
import { operatorUrl } from '../../app/operator-url';
import { useArtistBusiness } from '../settings/useArtistBusiness';
import { GoogleActionError, invokeGoogle, relativeTime, type CalendarStatus, type GoogleLocation, type ListingStatus } from './googleApi';
import './google.css';

type ReviewSummary = { summary?: { google_count: number; awaiting_reply: number } | null };

// Board 38c: the one Google connection. Business Profile and Calendar switch separately; disconnecting stops both.
export function GoogleAccountPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { client, businessId, loading: identityLoading } = useArtistBusiness();
  const [status, setStatus] = useState<CalendarStatus | null>(null);
  const [listing, setListing] = useState<ListingStatus | null>(null);
  const [reviews, setReviews] = useState<ReviewSummary['summary']>(null);
  const [locations, setLocations] = useState<GoogleLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(() => params.get('google') === 'connected' ? 'connected' : '');
  const [error, setError] = useState(() => params.get('google') === 'connect_error' ? 'connect_error' : '');
  const [needsPermission, setNeedsPermission] = useState(false);

  const load = useCallback(async () => {
    if (!client || !businessId) return;
    setLoading(true);
    setLoadError(false);
    try {
      const next = await invokeGoogle<CalendarStatus>(client, businessId, 'calendar-google-connect', { action: 'status' });
      setStatus(next);
      const [listingNext, reviewsNext] = await Promise.all([
        invokeGoogle<ListingStatus>(client, businessId, 'google-business-sync', { action: 'status' }).catch(() => null),
        invokeGoogle<ReviewSummary>(client, businessId, 'review-management', { action: 'get' }).then((data) => data.summary ?? null).catch(() => null),
      ]);
      setListing(listingNext);
      setReviews(reviewsNext);
      if (next.google?.has_business_scope) {
        setLocations(await invokeGoogle<{ locations: GoogleLocation[] }>(client, businessId, 'calendar-google-connect', { action: 'locations' }).then((data) => data.locations).catch(() => []));
      } else {
        setLocations([]);
      }
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [client, businessId]);

  useEffect(() => { if (!identityLoading) void load(); }, [identityLoading, load]);

  const run = async (name: string, body: Record<string, unknown>, onDone?: () => void) => {
    if (!client || !businessId) return;
    setBusy(true);
    setError('');
    setNotice('');
    setNeedsPermission(false);
    try {
      await invokeGoogle(client, businessId, name, body);
      onDone?.();
      await load();
    } catch (cause) {
      if (cause instanceof GoogleActionError && cause.code === 'GOOGLE_PERMISSION_MISSING') setNeedsPermission(true);
      setError(cause instanceof GoogleActionError ? cause.code : 'ACTION_FAILED');
    } finally {
      setBusy(false);
    }
  };

  const google = status?.google ?? null;
  const connected = google?.status === 'active';
  const email = google?.google_account_email ?? '';
  const initials = email.slice(0, 2).toUpperCase();
  const errorText = error === 'connect_error' ? t('google.account.connectError') : error ? t(`google.errors.${error}`, { defaultValue: t('google.errors.ACTION_FAILED') }) : '';
  const businessWaiting = listing?.sections.services_waiting ?? 0;
  const businessOn = Boolean(google?.business_profile_enabled && google?.has_business_scope);

  return <main className="mova-page mova-google-page mova-google-account">
    <ScreenHeader onBack={() => navigate(operatorUrl(businessId, 'settings'))} backLabel={t('google.back')} />
    <h1>{t('google.account.title')}</h1>
    {identityLoading || loading
      ? <p role="status" aria-busy="true">{t('google.loading')}</p>
      : loadError
        ? <div className="mova-google-message is-error" role="alert"><p>{t('google.loadError')}</p><Button variant="secondary" onClick={() => void load()}>{t('google.retry')}</Button></div>
        : !connected
          ? <section className="mova-google-card" aria-label={t('google.account.notConnected')}>
            <h2>{t('google.account.notConnected')}</h2>
            <p>{t('google.account.notConnectedBody')}</p>
            <Button onClick={() => navigate(operatorUrl(businessId, 'settings/google/connect'))}>{t('google.account.connect')}</Button>
          </section>
          : <>
            <section className="mova-google-account__connected" aria-label={t('google.account.title')}>
              <span className="mova-google-account__avatar" aria-hidden="true">{initials}</span>
              <span className="mova-google-account__who"><strong>{email}</strong><span>{t('google.account.connectedOn', { date: new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: 'medium' }).format(new Date(google!.connected_at)) })}</span></span>
              <span className="mova-google-badge">{t('google.account.on')}</span>
            </section>

            <section className="mova-google-card" aria-labelledby="google-business-heading">
              <div className="mova-google-card__head">
                <span><h2 id="google-business-heading">{t('google.account.businessTitle')}</h2><span>{t('google.account.businessDescription')}</span></span>
                <Toggle label={t('google.account.businessToggle')} checked={businessOn} disabled={busy}
                  onChange={(value) => void run('calendar-google-connect', { action: 'set-toggles', business_profile_enabled: value })} />
              </div>
              {!google?.has_business_scope && <div className="mova-google-message"><p>{t('google.account.permissionNeeded')}</p><Button variant="secondary" onClick={() => navigate(operatorUrl(businessId, 'settings/google/connect'))}>{t('google.account.grantPermission')}</Button></div>}
              {businessOn && <label className="mova-google-field">{t('google.account.profileLabel')}
                <select value={google?.business_location_id ?? ''} disabled={busy || locations.length === 0}
                  onChange={(event) => void run('calendar-google-connect', { action: 'set-business-location', location_id: event.currentTarget.value })}>
                  <option value="" disabled>{locations.length ? t('google.account.profileLabel') : t('google.account.noLocations')}</option>
                  {locations.map((location) => <option key={location.id} value={location.id}>{location.title || location.id}</option>)}
                </select>
              </label>}
              <div className="mova-google-tiles">
                <Link to={operatorUrl(businessId, 'settings/google/listing')} className="mova-google-tile">
                  <span>{t('google.account.listingLink')}</span>
                  <strong>{listing?.last_synced_at ? t('google.account.synced', { time: relativeTime(listing.last_synced_at, i18n.resolvedLanguage) }) : t('google.account.listingNever')}</strong>
                  {businessWaiting > 0 && <span className="mova-google-tile__note">{t('google.listing.waiting', { count: businessWaiting })}</span>}
                </Link>
                <Link to={operatorUrl(businessId, 'reports/reputation')} className="mova-google-tile">
                  <span>{t('google.account.reviewsLink')}</span>
                  <strong>{t('google.account.reviewsSummary', { count: reviews?.google_count ?? 0, waiting: reviews?.awaiting_reply ?? 0 })}</strong>
                </Link>
              </div>
            </section>

            <section className="mova-google-card" aria-labelledby="google-calendar-heading">
              <div className="mova-google-card__head">
                <span><h2 id="google-calendar-heading">{t('google.account.calendarTitle')}</h2><span>{t('google.account.calendarDescription')}</span></span>
                <Toggle label={t('google.account.calendarToggle')} checked={Boolean(google?.calendar_enabled)} disabled={busy}
                  onChange={(value) => void run('calendar-google-connect', { action: 'set-toggles', calendar_enabled: value })} />
              </div>
              <Link to={operatorUrl(businessId, 'settings/calendar-sync')} className="mova-google-link-row">{t('google.account.calendarSettings')} <span aria-hidden="true">›</span></Link>
            </section>

            <p className="mova-google-footnote">{t('google.account.footnote')}</p>
            {needsPermission && <p role="alert" className="mova-google-message is-error">{t('google.account.permissionNeeded')}</p>}
            {errorText && <p role="alert" className="mova-google-message is-error">{errorText}</p>}
            <Button variant="secondary" className="mova-google-disconnect" disabled={busy} onClick={() => void run('calendar-google-connect', { action: 'disconnect' }, () => setNotice('disconnected'))}>{t('google.account.disconnect')}</Button>
          </>}
    {notice === 'connected' && <p role="status" className="mova-google-message">{t('google.account.connected')}</p>}
    {notice === 'disconnected' && <p role="status" className="mova-google-message">{t('google.account.disconnected')}</p>}
  </main>;
}

export default GoogleAccountPage;
