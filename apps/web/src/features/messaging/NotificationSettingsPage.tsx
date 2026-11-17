import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { Locale } from '@mova/contracts';
import { ErrorState, ScreenHeader } from '../../components';
import { operatorUrl } from '../../app/operator-url';
import { useLocale } from '../../app/LocaleProvider';
import { useArtistBusiness } from '../settings/useArtistBusiness';
import { usePushDevice, type PushDeviceState } from '../../pwa/usePushDevice';

export const NOTIFICATION_EVENTS = ['booking_request', 'cancellation', 'client_message', 'appointment_reminder', 'new_review'] as const;
export type NotificationEvent = typeof NOTIFICATION_EVENTS[number];
type Channels = { email: boolean; push: boolean };
export type EventPreferences = Record<NotificationEvent, Channels>;

export const DEFAULT_EVENTS: EventPreferences = Object.fromEntries(NOTIFICATION_EVENTS.map((event) => [event, { email: true, push: true }])) as EventPreferences;

const PhoneIcon = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="7" y="2.5" width="10" height="19" rx="2.2" /><path d="M11 18.5h2" /></svg>;
const BellIcon = ({ size = 18 }: { size?: number }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" /><path d="M10 20a2 2 0 0 0 4 0" /></svg>;
const MailIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3.5 6.5 8.5 6.5 8.5-6.5" /></svg>;
const CheckIcon = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;
const ShareIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 15V3M8 7l4-4 4 4" /><path d="M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8" /></svg>;

function MiniSwitch({ checked, disabled, label, onChange }: { checked: boolean; disabled?: boolean; label: string; onChange: (value: boolean) => void }) {
  return <label className={`mova-mini-switch${disabled ? ' is-disabled' : ''}`}>
    <input type="checkbox" role="switch" aria-label={label} checked={checked} disabled={disabled} onChange={(event) => onChange(event.currentTarget.checked)} />
    <span aria-hidden="true"><span /></span>
  </label>;
}

/** The device banner at the top of the Notifications section (P10–P12). */
function PushDeviceBanner({ state, busy, onAllow }: { state: PushDeviceState; busy: boolean; onAllow: () => void }) {
  const { t } = useTranslation();
  if (state === 'checking') return null;
  if (state === 'on') return <div className="mova-push-device mova-push-device--on" role="status">
    <span className="mova-push-device__icon"><PhoneIcon /></span>
    <span className="mova-push-device__copy"><strong>{t('notificationSettings.pushOnTitle')}</strong><span>{t('notificationSettings.pushOnBody')}</span></span>
    <span className="mova-push-device__check"><CheckIcon /></span>
  </div>;
  if (state === 'install-needed') return <div className="mova-push-device mova-push-device--install" role="region" aria-label={t('notificationSettings.installTitle')}>
    <div className="mova-push-device__row">
      <span className="mova-push-device__icon"><PhoneIcon /></span>
      <span className="mova-push-device__copy"><strong>{t('notificationSettings.installTitle')}</strong></span>
    </div>
    <p className="mova-push-device__help">{t('notificationSettings.iosHelpBefore')} <ShareIcon /> <strong>{t('notificationSettings.share')}</strong>{t('notificationSettings.iosHelpMiddle')}<strong>{t('notificationSettings.addToHomeScreen')}</strong>.</p>
  </div>;
  const copy = state === 'blocked' ? ['blockedTitle', 'blockedBody'] : state === 'unsupported' ? ['unsupportedTitle', 'unsupportedBody'] : state === 'unavailable' ? ['unavailableTitle', 'unavailableBody'] : ['pushOffTitle', 'pushOffBody'];
  return <div className="mova-push-device mova-push-device--off">
    <span className="mova-push-device__icon"><BellIcon /></span>
    <span className="mova-push-device__copy"><strong>{t(`notificationSettings.${copy[0]}`)}</strong><span>{t(`notificationSettings.${copy[1]}`)}</span></span>
    {state === 'off' && <button type="button" className="mova-push-device__action" disabled={busy} onClick={onAllow}>{t('notificationSettings.allow')}</button>}
  </div>;
}

/** Settings › Language & notifications: app language plus Email/Push per event. Everything starts on. */
export function NotificationSettingsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { locale, setLocale } = useLocale();
  const { client, businessId, loading: identityLoading } = useArtistBusiness();
  const push = usePushDevice(client, businessId);
  const [events, setEvents] = useState<EventPreferences>(DEFAULT_EVENTS);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saveError, setSaveError] = useState(false);

  const call = useCallback(async <T,>(payload: Record<string, unknown>): Promise<T> => {
    if (!client || !businessId) throw new Error('SUPABASE_UNAVAILABLE');
    const { data, error } = await client.functions.invoke<{ data: T }>('messaging-settings', { body: payload, headers: { 'x-mova-artist-business-id': businessId } });
    if (error || !data) throw new Error('REQUEST_FAILED');
    return data.data;
  }, [businessId, client]);

  const load = useCallback(async () => {
    if (!client || !businessId) return;
    setLoading(true); setLoadError(false);
    try {
      const data = await call<{ events?: Partial<EventPreferences> }>({ action: 'status' });
      setEvents({ ...DEFAULT_EVENTS, ...(data.events ?? {}) });
    } catch { setLoadError(true); } finally { setLoading(false); }
  }, [businessId, call, client]);

  useEffect(() => { void load(); }, [load]);

  const update = async (event: NotificationEvent, channel: keyof Channels, value: boolean) => {
    const next = { ...events, [event]: { ...events[event], [channel]: value } };
    setEvents(next); setSaveError(false);
    try { await call({ action: 'preferences', preferences: { events: next } }); } catch { setSaveError(true); setEvents(events); }
  };

  const pushOn = push.state === 'on';
  const languages: Array<{ value: Locale; label: string }> = [
    { value: 'en-US', label: t('notificationSettings.english') },
    { value: 'es-US', label: t('notificationSettings.spanish') },
  ];

  return <main className="mova-page mova-notification-settings">
    <ScreenHeader onBack={() => navigate(operatorUrl(businessId, 'settings'))} backLabel={t('notificationSettings.back')} />
    <h1>{t('notificationSettings.title')}</h1>
    <section className="mova-notification-settings__section" aria-labelledby="mova-language-heading">
      <h2 id="mova-language-heading" className="mova-overline">{t('notificationSettings.languageHeading')}</h2>
      <div role="radiogroup" aria-labelledby="mova-language-heading" className="mova-language-toggle">
        {languages.map((option) => <button key={option.value} type="button" role="radio" aria-checked={locale === option.value} className={locale === option.value ? 'is-selected' : ''} onClick={() => setLocale(option.value)}>
          {locale === option.value && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>}
          {option.label}
        </button>)}
      </div>
      <p className="mova-notification-settings__note">{t('notificationSettings.languageNote')}</p>
    </section>
    <section className="mova-notification-settings__section" aria-labelledby="mova-notifications-heading">
      <h2 id="mova-notifications-heading" className="mova-overline">{t('notificationSettings.notificationsHeading')}</h2>
      <PushDeviceBanner state={push.state} busy={push.busy} onAllow={() => void push.enable()} />
      {identityLoading || loading ? <p role="status" aria-busy="true">{t('notificationSettings.loading')}</p>
        : loadError ? <ErrorState title={t('notificationSettings.loadError')} retryLabel={t('notificationSettings.retry')} onRetry={() => void load()} />
        : <div className="mova-event-matrix">
          <div className="mova-event-matrix__head"><span>{t('notificationSettings.sendMe')}</span><span><MailIcon />{t('notificationSettings.email')}</span><span><BellIcon size={14} />{t('notificationSettings.push')}</span></div>
          {NOTIFICATION_EVENTS.map((event) => {
            const title = t(`notificationSettings.events.${event}.title`);
            return <div key={event} className="mova-event-matrix__row">
              <span className="mova-event-matrix__copy"><strong>{title}</strong><small>{t(`notificationSettings.events.${event}.body`)}</small></span>
              <span className="mova-event-matrix__cell"><MiniSwitch label={t('notificationSettings.byEmail', { event: title })} checked={events[event].email} onChange={(value) => void update(event, 'email', value)} /></span>
              <span className="mova-event-matrix__cell"><MiniSwitch label={t('notificationSettings.byPush', { event: title })} checked={pushOn && events[event].push} disabled={!pushOn} onChange={(value) => void update(event, 'push', value)} /></span>
            </div>;
          })}
        </div>}
      {saveError && <p role="alert">{t('notificationSettings.saveError')}</p>}
    </section>
  </main>;
}
