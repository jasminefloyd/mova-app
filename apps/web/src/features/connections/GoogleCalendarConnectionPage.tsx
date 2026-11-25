import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Checkbox, ScreenHeader, Toggle } from '../../components';
import { operatorUrl } from '../../app/operator-url';
import { useArtistBusiness } from '../settings/useArtistBusiness';
import { PlanGate } from '../billing/PlanGate';
import { GoogleActionError, type CalendarStatus, type GoogleCalendar } from '../google/googleApi';
import { invokeFn } from './connections-api';
import { AccountCard, UsesCard } from './ConnectionsUi';
import { ConnectionShell } from './ConnectionsPage';

// CN6: Google Calendar, under Calendar integrations. It uses the same Google sign-in as the listing and
// reviews, so it never asks to connect again. Sync is one way: Mova → Google.

export function GoogleCalendarConnectionPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { client, businessId, loading: identityLoading } = useArtistBusiness();
  const [state, setState] = useState<CalendarStatus | null>(null);
  const [calendars, setCalendars] = useState<GoogleCalendar[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    if (!client || !businessId) return;
    setLoading(true); setLoadError(false);
    try {
      const next = await invokeFn<CalendarStatus>(client, businessId, 'calendar-google-connect', { action: 'status' });
      setState(next);
      if (next.google?.status === 'active') setCalendars(await invokeFn<{ calendars: GoogleCalendar[] }>(client, businessId, 'calendar-google-connect', { action: 'calendars' }).then((data) => data.calendars).catch(() => []));
    } catch { setLoadError(true); } finally { setLoading(false); }
  }, [client, businessId]);
  useEffect(() => { if (!identityLoading) void load(); }, [identityLoading, load]);

  const call = async (body: Record<string, unknown>, done: string) => {
    if (!client || !businessId) return false;
    setBusy(true); setError(''); setNotice('');
    try {
      await invokeFn(client, businessId, 'calendar-google-connect', body);
      setNotice(done);
      return true;
    } catch (cause) {
      setError(cause instanceof GoogleActionError ? t(`google.errors.${cause.code}`, { defaultValue: t('connections.saveError') }) : t('connections.saveError'));
      return false;
    } finally { setBusy(false); }
  };

  const toggleSync = async (enabled: boolean) => { if (await call({ action: 'set-toggles', calendar_enabled: enabled }, t(enabled ? 'google.calendar.started' : 'google.calendar.stopped'))) await load(); };
  const chooseCalendar = async (calendarId: string) => { if (await call({ action: 'set-calendar', calendar_id: calendarId }, t('google.calendar.calendarSaved'))) await load(); };
  const toggleLocation = async (locationId: string) => {
    if (!state) return;
    const current = state.settings.location_ids;
    const next = current.includes(locationId) ? current.filter((id) => id !== locationId) : [...current, locationId];
    const previous = state;
    setState({ ...state, settings: { ...state.settings, location_ids: next } });
    if (!await call({ action: 'save-settings', location_ids: next }, t('calendarSync.locationsSaved'))) setState(previous);
  };

  const google = state?.google ?? null;
  const connected = google?.status === 'active';

  return <ConnectionShell current="googleCalendar">
    <ScreenHeader onBack={() => navigate(operatorUrl(businessId, 'settings/connections'))} backLabel={t('connections.back')} />
    <div className="mova-conn-detail">
      <h1>{t('connections.names.googleCalendar')}</h1>
      {identityLoading || loading ? <p role="status" aria-busy="true">{t('connections.loading')}</p>
        : loadError ? <div className="mova-conn-message is-error" role="alert"><p>{t('connections.loadError')}</p><Button variant="secondary" onClick={() => void load()}>{t('connections.retry')}</Button></div>
        : <PlanGate feature="google_calendar_sync" requiredPlan="pro" title={t('planGate.calendarSync.title')} body={t('planGate.calendarSync.body')} featureName={t('planGate.calendarSync.name')}>
          {!connected ? <>
            <UsesCard title={t('connections.usesTitleFuture')} items={[t('connections.googleCalendar.useEvents'), t('connections.googleCalendar.useShared')]} />
            <Button className="mova-conn-full" onClick={() => navigate(operatorUrl(businessId, 'settings/google/connect'))}>{t('calendarSync.connectGoogle')}</Button>
          </> : <>
            <AccountCard name="googleCalendar" label={t('connections.account')} title={google?.google_account_email ?? ''} detail={t('google.calendar.sharedAccount')}
              pill={google?.calendar_enabled ? { tone: 'on', labelKey: 'connections.status.on' } : { tone: 'off', labelKey: 'connections.status.off' }} />
            <p className="mova-conn-note is-outlined">{t('calendarSync.oneWay')}</p>
            <section className="mova-conn-card" aria-labelledby="conn-gcal-settings">
              <h2 id="conn-gcal-settings">{t('connections.settingsTitle')}</h2>
              <Toggle label={t('connections.googleCalendar.sync')} description={t('connections.googleCalendar.syncHint')} checked={Boolean(google?.calendar_enabled)} disabled={busy} onChange={(value) => void toggleSync(value)} />
              <label className="mova-conn-field">{t('google.calendar.calendarLabel')}
                <select value={google?.calendar_id ?? ''} disabled={busy || calendars.length === 0} onChange={(event) => void chooseCalendar(event.currentTarget.value)}>
                  {calendars.length === 0 && <option value={google?.calendar_id ?? ''}>{t('google.calendar.noCalendars')}</option>}
                  {calendars.map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.summary}</option>)}
                </select>
              </label>
              <div className="mova-conn-field">{t('connections.googleCalendar.eventDetails')}
                {/* Client names never go to Google yet: only "Service only" can be chosen. */}
                <div className="mova-conn-seg" role="radiogroup" aria-label={t('connections.googleCalendar.eventDetails')}>
                  <span role="radio" aria-checked="true" className="is-selected">{t('calendarSync.serviceOnly')}</span>
                  <span role="radio" aria-checked="false" aria-disabled="true">{t('connections.googleCalendar.clientName')}</span>
                </div>
              </div>
              {Boolean(state?.locations.length) && <fieldset className="mova-conn-fieldset">
                <legend>{t('connections.googleCalendar.locations')}</legend>
                {state?.locations.map((location) => <Checkbox key={location.id} label={location.name} checked={state.settings.location_ids.includes(location.id)} disabled={busy} onChange={() => void toggleLocation(location.id)} />)}
              </fieldset>}
            </section>
            <p className="mova-conn-foot">{t('connections.googleCalendar.footnoteStart')} <Link to={operatorUrl(businessId, 'settings/connections/google')}>{t('connections.names.google')}</Link>.</p>
            {google?.calendar_enabled
              ? <Button variant="secondary" className="mova-conn-full" disabled={busy} onClick={() => void toggleSync(false)}>{t('google.calendar.stop')}</Button>
              : <Button className="mova-conn-full" disabled={busy} onClick={() => void toggleSync(true)}>{t('google.calendar.turnOn')}</Button>}
          </>}
        </PlanGate>}
      {error && <p role="alert" className="mova-conn-message is-error">{error}</p>}
      {notice && <p role="status" className="mova-conn-message">{notice}</p>}
    </div>
  </ConnectionShell>;
}

export default GoogleCalendarConnectionPage;
