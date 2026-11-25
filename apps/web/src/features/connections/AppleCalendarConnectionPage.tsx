import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, ScreenHeader } from '../../components';
import { operatorUrl } from '../../app/operator-url';
import { useArtistBusiness } from '../settings/useArtistBusiness';
import type { CalendarStatus } from '../google/googleApi';
import { appleCalendarPill, invokeFn } from './connections-api';
import { DisconnectSheet, StatusPill } from './ConnectionsUi';
import { ConnectionShell } from './ConnectionsPage';

// CN7: Apple Calendar, under Calendar integrations. A private subscription link (on every plan). Mova keeps
// only a fingerprint of the link, so it is shown once; getting it again makes a new link.

export function AppleCalendarConnectionPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { client, businessId, loading: identityLoading } = useArtistBusiness();
  const [status, setStatus] = useState<CalendarStatus | null>(null);
  const [feed, setFeed] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);

  const load = useCallback(async () => {
    if (!client || !businessId) return;
    setLoading(true); setLoadError(false);
    try { setStatus(await invokeFn<CalendarStatus>(client, businessId, 'calendar-google-connect', { action: 'status' })); } catch { setLoadError(true); } finally { setLoading(false); }
  }, [client, businessId]);
  useEffect(() => { if (!identityLoading) void load(); }, [identityLoading, load]);

  const issue = async (doneKey: string) => {
    if (!client || !businessId) return '';
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await invokeFn<{ feedUrl?: unknown }>(client, businessId, 'calendar-google-connect', { action: 'rotate-feed' });
      if (typeof result.feedUrl !== 'string') throw new Error('FEED_RESPONSE_INVALID');
      setFeed(result.feedUrl);
      setStatus((old) => old ? { ...old, feedConfigured: true } : old);
      setNotice(t(doneKey));
      return result.feedUrl;
    } catch { setError(t('calendarSync.actionError')); return ''; } finally { setBusy(false); }
  };

  const webcal = (url: string) => url.replace(/^https?:/, 'webcal:');
  const add = async () => {
    const url = feed || await issue('connections.apple.linkReady');
    if (url) window.location.assign(webcal(url));
  };
  const copy = async () => {
    const url = feed || await issue('connections.apple.linkReady');
    if (!url) return;
    try { await navigator.clipboard.writeText(url); setNotice(t('calendarSync.linkCopied')); } catch { setError(t('calendarSync.copyError')); }
  };
  const reset = async () => { await issue('calendarSync.linkReset'); setConfirmReset(false); };

  const masked = feed ? webcal(feed).replace(/(feed\/|[?&]token=)[^/&]+/, '$1••••••••') : 'webcal://mova-beauty.co/feed/•••••••••••••••••';

  return <ConnectionShell current="appleCalendar">
    <ScreenHeader onBack={() => navigate(operatorUrl(businessId, 'settings/connections'))} backLabel={t('connections.back')} />
    <div className="mova-conn-detail">
      <div className="mova-conn-head"><h1>{t('connections.names.appleCalendar')}</h1><p className="mova-conn-lead">{t('connections.apple.intro')}</p></div>
      {identityLoading || loading ? <p role="status" aria-busy="true">{t('connections.loading')}</p>
        : loadError ? <div className="mova-conn-message is-error" role="alert"><p>{t('connections.loadError')}</p><Button variant="secondary" onClick={() => void load()}>{t('connections.retry')}</Button></div>
        : <>
          <section className="mova-conn-card" aria-labelledby="conn-apple-link">
            <div className="mova-conn-card__head"><h2 id="conn-apple-link">{t('connections.apple.linkTitle')}</h2><StatusPill pill={appleCalendarPill(status)} /></div>
            <div className="mova-conn-feed" aria-label={t('calendarSync.privateLink')}>{masked}</div>
            <div className="mova-conn-actions">
              <Button disabled={busy} onClick={() => void add()}>{t('connections.apple.add')}</Button>
              <Button variant="secondary" disabled={busy} onClick={() => void copy()}>{t('calendarSync.copyLink')}</Button>
            </div>
            <span className="mova-conn-foot">{status?.feedConfigured && !feed ? t('connections.apple.newLinkNote') : t('connections.apple.private')}</span>
          </section>
          <section className="mova-conn-card" aria-labelledby="conn-apple-help">
            <h2 id="conn-apple-help">{t('connections.apple.otherTitle')}</h2>
            <ol className="mova-conn-steps">
              <li>{t('connections.apple.stepSend')}</li>
              <li>{t('connections.apple.stepIphone')}</li>
              <li>{t('connections.apple.stepMac')}</li>
            </ol>
            <p className="mova-conn-note">{t('connections.apple.refresh')}</p>
          </section>
          {status?.feedConfigured && <>
            <p className="mova-conn-foot">{t('connections.apple.resetNote')}</p>
            <Button variant="secondary" className="mova-conn-danger mova-conn-full" disabled={busy} onClick={() => setConfirmReset(true)}>{t('calendarSync.resetLink')}</Button>
          </>}
        </>}
      {error && <p role="alert" className="mova-conn-message is-error">{error}</p>}
      {notice && <p role="status" className="mova-conn-message">{notice}</p>}
    </div>
    <DisconnectSheet open={confirmReset} title={t('connections.apple.resetTitle')} body={t('connections.apple.resetNote')} confirm={t('calendarSync.resetLink')} busy={busy} onClose={() => setConfirmReset(false)} onConfirm={() => void reset()} />
  </ConnectionShell>;
}

export default AppleCalendarConnectionPage;
