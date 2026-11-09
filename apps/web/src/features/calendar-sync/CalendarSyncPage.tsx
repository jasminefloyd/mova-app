import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Card, Checkbox, HonestyBanner, OptionGroup, RadioCard, ScreenHeader } from '../../components';
import { useArtistBusiness } from '../settings/useArtistBusiness';
import { operatorUrl } from '../../app/operator-url';
import { GoogleActionError, invokeGoogle, type CalendarStatus, type GoogleCalendar } from '../google/googleApi';
import '../google/google.css';

// Board 20 (Calendar sync). The Google account is the one shared connection; choosing a calendar and
// stopping sync act on that connection. Apple Calendar stays on its private feed link.
export function CalendarSyncPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { client, businessId, loading: identityLoading } = useArtistBusiness();
  const [state, setState] = useState<CalendarStatus | null>(null);
  const [calendars, setCalendars] = useState<GoogleCalendar[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [issuedFeed, setIssuedFeed] = useState('');

  const actionError = (cause: unknown) => (cause instanceof GoogleActionError && cause.code !== 'ACTION_FAILED' ? t(`google.errors.${cause.code}`, { defaultValue: t('calendarSync.actionError') }) : t('calendarSync.actionError'));
  const call = useCallback((name: string, body: Record<string, unknown>) => {
    if (!client || !businessId) return Promise.reject(new Error('IDENTITY_REQUIRED'));
    return invokeGoogle<Record<string, unknown>>(client, businessId, name, body);
  }, [client, businessId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const next = await call('calendar-google-connect', { action: 'status' }) as unknown as CalendarStatus;
      setState(next);
      if (next.google?.status === 'active') {
        const list = await call('calendar-google-connect', { action: 'calendars' }).then((data) => data.calendars as GoogleCalendar[]).catch(() => []);
        setCalendars(list);
      }
    } catch {
      setError(t('calendarSync.loadError'));
    } finally {
      setLoading(false);
    }
  }, [call, t]);
  useEffect(() => { if (!identityLoading) void load(); }, [identityLoading, load]);

  const setCalendarSync = async (enabled: boolean) => {
    setBusy(true);
    setError('');
    try {
      await call('calendar-google-connect', { action: 'set-toggles', calendar_enabled: enabled });
      setNotice(t(enabled ? 'google.calendar.started' : 'google.calendar.stopped'));
      await load();
    } catch (cause) {
      setError(actionError(cause));
    } finally {
      setBusy(false);
    }
  };
  const chooseCalendar = async (calendarId: string) => {
    setBusy(true);
    setError('');
    try {
      await call('calendar-google-connect', { action: 'set-calendar', calendar_id: calendarId });
      setNotice(t('google.calendar.calendarSaved'));
      await load();
    } catch (cause) {
      setError(actionError(cause));
    } finally {
      setBusy(false);
    }
  };
  const issueFeed = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await call('calendar-google-connect', { action: 'rotate-feed' });
      if (typeof result.feedUrl !== 'string') throw new Error('FEED_RESPONSE_INVALID');
      setIssuedFeed(result.feedUrl);
      setState((old) => old ? { ...old, feedConfigured: true } : old);
      setNotice(t('calendarSync.linkReset'));
      return result.feedUrl;
    } catch {
      setError(t('calendarSync.actionError'));
      return '';
    } finally {
      setBusy(false);
    }
  };
  const copyFeed = async () => {
    const feed = issuedFeed || await issueFeed();
    if (!feed) return;
    try {
      await navigator.clipboard.writeText(feed);
      setNotice(t('calendarSync.linkCopied'));
    } catch {
      setError(t('calendarSync.copyError'));
    }
  };
  const saveLocations = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!state) return;
    setBusy(true);
    setError('');
    try {
      await call('calendar-google-connect', { action: 'save-settings', location_ids: state.settings.location_ids });
      setNotice(t('calendarSync.locationsSaved'));
    } catch {
      setError(t('calendarSync.actionError'));
    } finally {
      setBusy(false);
    }
  };

  const google = state?.google ?? null;
  const connected = google?.status === 'active';
  const initials = (google?.google_account_email ?? '').slice(0, 2).toUpperCase();
  const feedOrigin = 'https://mova-beauty.co';
  const sourceFeed = issuedFeed || `${feedOrigin}/feed/••••••••`;
  const displayFeed = sourceFeed.replace(/^https?:/, 'webcal:').replace(/([?&]token=|feed\/)[^/&]+/, '$1••••••••');

  return <main className="mova-page mova-calendar-sync">
    <ScreenHeader onBack={() => navigate(operatorUrl(businessId, 'settings'))} backLabel={t('settings.close')} /><h1>{t('calendarSync.title')}</h1>
    <HonestyBanner>{t('calendarSync.oneWay')}</HonestyBanner>
    {identityLoading || loading ? <p role="status" aria-busy="true">{t('calendarSync.loading')}</p> : <>
      <Card className="mova-calendar-sync__card">
        <div className="mova-calendar-sync__heading"><h2>{t('calendarSync.googleTitle')}</h2><span className={connected ? 'mova-calendar-sync__connected' : ''}>{connected ? `✓ ${t('calendarSync.connectedLabel')}` : t('calendarSync.notConnected')}</span></div>
        {connected && google ? <Link className="mova-google-account__connected mova-calendar-sync__account" to={operatorUrl(businessId, 'settings/google')} style={{ textDecoration: 'none' }}>
          <span className="mova-google-account__avatar" aria-hidden="true">{initials}</span>
          <span className="mova-google-account__who"><strong>{google.google_account_email}</strong><span>{t('google.calendar.sharedAccount')}</span></span>
          <span aria-hidden="true">›</span>
        </Link> : <>
          <p>{t('calendarSync.googleDescription')}</p>
          <Button disabled={busy} onClick={() => navigate(operatorUrl(businessId, 'settings/google/connect'))}>{t('calendarSync.connectGoogle')}</Button>
        </>}
        {connected && google && <>
          <label className="mova-google-field">{t('google.calendar.calendarLabel')}
            <select value={google.calendar_id} disabled={busy || calendars.length === 0} onChange={(event) => void chooseCalendar(event.currentTarget.value)}>
              {calendars.length === 0 && <option value={google.calendar_id}>{t('google.calendar.noCalendars')}</option>}
              {calendars.map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.summary}</option>)}
            </select>
          </label>
          <h3>{t('calendarSync.eventDetails')}</h3><OptionGroup label={t('calendarSync.eventDetails')}><div className="mova-calendar-sync__privacy"><RadioCard name="calendar-privacy" value="service" label={t('calendarSync.serviceOnly')} checked disabled /><RadioCard name="calendar-privacy" value="client" label={t('calendarSync.clientName')} disabled /></div></OptionGroup>
          {Boolean(state?.locations.length) && <details className="mova-calendar-sync__location-details"><summary>{t('calendarSync.locations')}</summary><form onSubmit={(event) => void saveLocations(event)}>{state?.locations.map((location) => <Checkbox key={location.id} label={location.name} checked={state.settings.location_ids.includes(location.id)} onChange={() => setState((old) => old ? { ...old, settings: { ...old.settings, location_ids: old.settings.location_ids.includes(location.id) ? old.settings.location_ids.filter((id) => id !== location.id) : [...old.settings.location_ids, location.id] } } : old)} />)}<Button type="submit" variant="secondary" disabled={busy}>{t('calendarSync.saveLocations')}</Button></form></details>}
          {google.calendar_enabled
            ? <>
              <Button variant="secondary" disabled={busy} onClick={() => void setCalendarSync(false)}>{t('google.calendar.stop')}</Button>
              <p className="mova-google-footnote">{t('google.calendar.stopNote')}</p>
            </>
            : <Button disabled={busy} onClick={() => void setCalendarSync(true)}>{t('google.calendar.turnOn')}</Button>}
        </>}
      </Card>
      <Card className="mova-calendar-sync__card">
        <h2>{t('calendarSync.appleTitle')}</h2><p>{t('calendarSync.appleDescription')}</p>
        <div className="mova-calendar-sync__feed" aria-label={t('calendarSync.privateLink')}><span aria-hidden="true">▣</span><code>{displayFeed}</code></div>
        <div className="mova-calendar-sync__actions"><Button onClick={() => void copyFeed()} disabled={busy}>{t('calendarSync.copyLink')}</Button><Button variant="secondary" onClick={() => void issueFeed()} disabled={busy}>{t('calendarSync.resetLink')}</Button></div>
      </Card>
    </>}
    {error && <p role="alert" className="mova-calendar-sync__message">{error}</p>}{notice && <p role="status" className="mova-calendar-sync__message">{notice}</p>}
  </main>;
}
export default CalendarSyncPage;
