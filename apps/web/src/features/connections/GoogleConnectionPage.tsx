import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, ScreenHeader, Toggle } from '../../components';
import { operatorUrl } from '../../app/operator-url';
import { useArtistBusiness } from '../settings/useArtistBusiness';
import { GoogleActionError, relativeTime, type CalendarStatus, type GoogleLocation, type ListingStatus } from '../google/googleApi';
import { googleCalendarPill, invokeFn, type ConnectionPill } from './connections-api';
import { AccountCard, ConnectionLogo, DisconnectSheet, LinkRow, StatusPill, UsesCard } from './ConnectionsUi';
import { ConnectionShell } from './ConnectionsPage';

// CN4: Google, under Reputation & marketing. One Google sign-in for the Business Profile, Google reviews and
// Google Calendar; each can be switched off on its own. Disconnecting stops all three.

type GoogleReview = { id: string; rating: number; reply_body: string | null };
type Reviews = { summary?: { google_count: number; google_average: number | null } | null; settings?: { google_import_enabled?: boolean; google_synced_at?: string | null }; google_reviews?: GoogleReview[]; google_import_enabled?: boolean };
type Events = Record<string, { email: boolean; push: boolean }>;

export function GoogleConnectionPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { client, businessId, loading: identityLoading } = useArtistBusiness();
  const [status, setStatus] = useState<CalendarStatus | null>(null);
  const [listing, setListing] = useState<ListingStatus | null>(null);
  const [reviews, setReviews] = useState<Reviews | null>(null);
  const [events, setEvents] = useState<Events | null>(null);
  const [locations, setLocations] = useState<GoogleLocation[]>([]);
  const [calendarName, setCalendarName] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(() => params.get('google') === 'connect_error' ? t('google.account.connectError') : '');
  const [notice, setNotice] = useState(() => params.get('google') === 'connected' ? t('google.account.connected') : '');
  const [needsPermission, setNeedsPermission] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const load = useCallback(async () => {
    if (!client || !businessId) return;
    setLoading(true); setLoadError(false);
    try {
      const next = await invokeFn<CalendarStatus>(client, businessId, 'calendar-google-connect', { action: 'status' });
      setStatus(next);
      if (next.google?.status !== 'active') return;
      const [listingNext, reviewsNext, eventsNext, locationsNext, calendarsNext] = await Promise.all([
        invokeFn<ListingStatus>(client, businessId, 'google-business-sync', { action: 'status' }).catch(() => null),
        invokeFn<Reviews>(client, businessId, 'review-management', { action: 'get' }).catch(() => null),
        invokeFn<{ events: Events }>(client, businessId, 'messaging-settings', { action: 'status' }).then((data) => data.events).catch(() => null),
        next.google.has_business_scope ? invokeFn<{ locations: GoogleLocation[] }>(client, businessId, 'calendar-google-connect', { action: 'locations' }).then((data) => data.locations).catch(() => []) : Promise.resolve([]),
        next.google.calendar_enabled ? invokeFn<{ calendars: Array<{ id: string; summary: string }> }>(client, businessId, 'calendar-google-connect', { action: 'calendars' }).then((data) => data.calendars).catch(() => []) : Promise.resolve([]),
      ]);
      setListing(listingNext); setReviews(reviewsNext); setEvents(eventsNext); setLocations(locationsNext);
      setCalendarName(calendarsNext.find((calendar) => calendar.id === next.google?.calendar_id)?.summary ?? '');
    } catch { setLoadError(true); } finally { setLoading(false); }
  }, [client, businessId]);
  useEffect(() => { if (!identityLoading) void load(); }, [identityLoading, load]);

  const run = async (name: string, body: Record<string, unknown>, after?: () => void) => {
    if (!client || !businessId) return;
    setBusy(true); setError(''); setNotice(''); setNeedsPermission(false);
    try {
      await invokeFn(client, businessId, name, body);
      after?.();
      await load();
    } catch (cause) {
      if (cause instanceof GoogleActionError && cause.code === 'GOOGLE_PERMISSION_MISSING') setNeedsPermission(true);
      setError(cause instanceof GoogleActionError ? t(`google.errors.${cause.code}`, { defaultValue: t('connections.saveError') }) : t('connections.saveError'));
    } finally { setBusy(false); }
  };

  const google = status?.google ?? null;
  const connected = google?.status === 'active';
  const businessOn = Boolean(google?.business_profile_enabled && google?.has_business_scope);
  const importOn = reviews?.settings?.google_import_enabled !== false;
  const googleReviews = reviews?.google_reviews ?? [];
  const waiting = googleReviews.filter((review) => !review.reply_body).length;
  const average = reviews?.summary?.google_average;
  const alertsOn = events ? Boolean(events.new_google_review?.email || events.new_google_review?.push) : true;
  const calendarPill: ConnectionPill = googleCalendarPill(status);
  const date = google ? new Intl.DateTimeFormat(i18n.resolvedLanguage, { month: 'short', day: 'numeric' }).format(new Date(google.connected_at)) : '';

  return <ConnectionShell current="google">
    <ScreenHeader onBack={() => navigate(operatorUrl(businessId, 'settings/connections'))} backLabel={t('connections.back')} />
    <div className="mova-conn-detail">
      <h1>{t('connections.names.google')}</h1>
      {identityLoading || loading ? <p role="status" aria-busy="true">{t('connections.loading')}</p>
        : loadError ? <div className="mova-conn-message is-error" role="alert"><p>{t('connections.loadError')}</p><Button variant="secondary" onClick={() => void load()}>{t('connections.retry')}</Button></div>
        : !connected ? <>
          <UsesCard title={t('connections.usesTitleFuture')} items={[t('connections.google.useProfile'), t('connections.google.useReviews'), t('connections.google.useCalendar')]} />
          <Button className="mova-conn-full" onClick={() => navigate(operatorUrl(businessId, 'settings/google/connect'))}>{t('google.account.connect')}</Button>
        </> : <>
          <AccountCard name="google" label={t('connections.account')} title={google?.google_account_email ?? ''} detail={t('connections.google.connectedOn', { date })} pill={{ tone: 'on', labelKey: 'connections.status.on' }} />
          <UsesCard title={t('connections.usesTitle')} items={[t('connections.google.useProfile'), t('connections.google.useReviews'),
            <>{t('connections.google.useCalendarLinked')} <Link to={operatorUrl(businessId, 'settings/connections/google-calendar')}>{t('connections.sections.calendars')}</Link>)</>]} />

          <section className="mova-conn-card" aria-labelledby="conn-google-profile">
            <div className="mova-conn-card__head">
              <span><h2 id="conn-google-profile">{t('google.account.businessTitle')}</h2><span>{t('connections.google.profileHint')}</span></span>
              <Toggle label={t('google.account.businessToggle')} checked={businessOn} disabled={busy} onChange={(value) => void run('calendar-google-connect', { action: 'set-toggles', business_profile_enabled: value })} />
            </div>
            {!google?.has_business_scope && <div className="mova-conn-message"><p>{t('google.account.permissionNeeded')}</p><Button variant="secondary" onClick={() => navigate(operatorUrl(businessId, 'settings/google/connect'))}>{t('google.account.grantPermission')}</Button></div>}
            {businessOn && <>
              <label className="mova-conn-field">{t('google.account.profileLabel')}
                <select value={google?.business_location_id ?? ''} disabled={busy || locations.length === 0} onChange={(event) => void run('calendar-google-connect', { action: 'set-business-location', location_id: event.currentTarget.value })}>
                  <option value="" disabled>{locations.length ? t('google.account.profileLabel') : t('google.account.noLocations')}</option>
                  {locations.map((location) => <option key={location.id} value={location.id}>{location.title || location.id}</option>)}
                </select>
              </label>
              <LinkRow title={t('google.account.listingLink')} detail={listing?.last_synced_at ? t('google.account.synced', { time: relativeTime(listing.last_synced_at, i18n.resolvedLanguage) }) : t('google.account.listingNever')} to={operatorUrl(businessId, 'settings/google/listing')} />
              <Toggle label={t('connections.google.autoSend')} description={t('connections.google.autoSendHint')} checked={Boolean(listing?.auto_send)} disabled={busy || !listing?.business_profile_ready}
                onChange={(value) => void run('google-business-sync', { action: 'set-auto-send', auto_send: value })} />
            </>}
          </section>

          <section className="mova-conn-card" aria-labelledby="conn-google-reviews">
            <div className="mova-conn-card__head">
              <span><h2 id="conn-google-reviews">{t('connections.google.reviewsTitle')}</h2><span>{t('connections.google.reviewsHint')}</span></span>
              <Toggle label={t('connections.google.reviewsToggle')} checked={importOn} disabled={busy || !reviews} onChange={(value) => void run('review-management', { action: 'set_google_import', enabled: value })} />
            </div>
            <dl className="mova-conn-dl">
              <dt>{t('connections.google.reviewsCount')}</dt><dd>{average != null ? t('connections.google.reviewsCountValue', { count: reviews?.summary?.google_count ?? 0, average: new Intl.NumberFormat(i18n.resolvedLanguage, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(average) }) : String(reviews?.summary?.google_count ?? 0)}</dd>
              <dt>{t('connections.google.waiting')}</dt><dd>{waiting}</dd>
              <dt>{t('connections.google.lastChecked')}</dt><dd>{reviews?.settings?.google_synced_at ? relativeTime(reviews.settings.google_synced_at, i18n.resolvedLanguage) : t('connections.google.notYet')}</dd>
            </dl>
            <Toggle label={t('connections.google.alerts')} description={t('connections.google.alertsHint')} checked={alertsOn} disabled={busy || !events}
              onChange={(value) => void run('messaging-settings', { action: 'preferences', preferences: { events: { new_google_review: { email: value, push: value } } } })} />
            <Link to={operatorUrl(businessId, 'reports/reputation')} className="mova-button mova-button--secondary mova-conn-full">{t('connections.google.openReviews')}</Link>
          </section>

          <Link className="mova-conn-card mova-conn-linkcard" to={operatorUrl(businessId, 'settings/connections/google-calendar')}>
            <ConnectionLogo name="googleCalendar" />
            <span><strong>{t('connections.names.googleCalendar')}</strong><span>{calendarName ? t('connections.google.calendarRow', { calendar: calendarName }) : t('connections.google.calendarRowPlain')}</span></span>
            <StatusPill pill={calendarPill} />
          </Link>

          <p className="mova-conn-foot">{t('connections.google.footnote')}</p>
          {needsPermission && <p role="alert" className="mova-conn-message is-error">{t('google.account.permissionNeeded')}</p>}
          <Button variant="secondary" className="mova-conn-danger mova-conn-full" disabled={busy} onClick={() => setConfirmOpen(true)}>{t('google.account.disconnect')}</Button>
        </>}
      {error && <p role="alert" className="mova-conn-message is-error">{error}</p>}
      {notice && <p role="status" className="mova-conn-message">{notice}</p>}
    </div>
    <DisconnectSheet open={confirmOpen} title={t('connections.google.disconnectTitle')} body={t('connections.google.disconnectBody')} confirm={t('google.account.disconnect')} busy={busy}
      onClose={() => setConfirmOpen(false)} onConfirm={() => void run('calendar-google-connect', { action: 'disconnect' }, () => { setConfirmOpen(false); setNotice(t('google.account.disconnected')); })} />
  </ConnectionShell>;
}

export default GoogleConnectionPage;
