import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Icon, ScreenHeader, Toggle } from '../../components';
import { operatorUrl } from '../../app/operator-url';
import { useArtistBusiness } from '../settings/useArtistBusiness';
import { GoogleActionError } from '../google/googleApi';
import { invokeFn, loadMetaStatus, type MetaStatus } from './connections-api';
import { AccountCard, DisconnectSheet, LinkRow, StatusPill, UsesCard } from './ConnectionsUi';
import { ConnectionShell } from './ConnectionsPage';

// CN5 / CN5b: Meta, under Reputation & marketing. A Facebook Page and the Instagram professional account
// linked to it, so the Concierge can answer Instagram DMs and Page messages. Mova never posts for the stylist.

const OUTCOMES = ['connected', 'connected_no_instagram', 'cancelled', 'no_page', 'page_taken', 'connect_error'];

export function MetaConnectionPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { client, businessId, loading: identityLoading } = useArtistBusiness();
  const [meta, setMeta] = useState<MetaStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const outcome = params.get('meta');
  const [notice, setNotice] = useState(() => outcome && OUTCOMES.includes(outcome) ? t(`connections.meta.outcome.${outcome}`) : '');
  const outcomeIsError = outcome === 'cancelled' || outcome === 'no_page' || outcome === 'page_taken' || outcome === 'connect_error';

  const load = useCallback(async () => {
    if (!client || !businessId) return;
    setLoading(true); setLoadError(false);
    try { setMeta(await loadMetaStatus(client, businessId)); } catch { setLoadError(true); } finally { setLoading(false); }
  }, [client, businessId]);
  useEffect(() => { if (!identityLoading) void load(); }, [identityLoading, load]);

  const begin = async () => {
    if (!client || !businessId) return;
    setBusy(true); setError('');
    try {
      const data = await invokeFn<{ authorization_url: string }>(client, businessId, 'meta-connect', { action: 'begin' });
      if (!/^https:\/\//.test(data.authorization_url)) throw new Error('INVALID_URL');
      window.location.assign(data.authorization_url);
    } catch { setError(t('connections.meta.connectError')); setBusy(false); }
  };

  const setChannel = async (channel: 'instagram' | 'messenger', enabled: boolean) => {
    if (!client || !businessId || !meta) return;
    const previous = meta;
    setMeta({ ...meta, channels: { ...meta.channels, [channel]: enabled } }); setError('');
    try {
      await invokeFn(client, businessId, 'meta-connect', { action: 'set-channel', channel, enabled });
    } catch (cause) {
      setMeta(previous);
      setError(cause instanceof GoogleActionError && cause.code === 'PLAN_FEATURE_NOT_INCLUDED' ? t('connections.meta.planNeeded') : t('connections.saveError'));
    }
  };

  const disconnect = async () => {
    if (!client || !businessId) return;
    setBusy(true); setError('');
    try {
      await invokeFn(client, businessId, 'meta-connect', { action: 'disconnect' });
      setConfirmOpen(false); setNotice(t('connections.meta.disconnected'));
      await load();
    } catch { setError(t('connections.meta.disconnectError')); } finally { setBusy(false); }
  };

  const connection = meta?.connection ?? null;
  const relative = (iso: string | null) => {
    if (!iso) return t('connections.meta.noMessages');
    const minutes = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
    const format = new Intl.RelativeTimeFormat(i18n.resolvedLanguage, { numeric: 'auto' });
    return Math.abs(minutes) < 60 ? format.format(minutes, 'minute') : Math.abs(minutes) < 2880 ? format.format(Math.round(minutes / 60), 'hour') : format.format(Math.round(minutes / 1440), 'day');
  };

  return <ConnectionShell current="meta">
    <ScreenHeader onBack={() => navigate(operatorUrl(businessId, 'settings/connections'))} backLabel={t('connections.back')} />
    <div className="mova-conn-detail">
      {identityLoading || loading ? <><h1>{t('connections.names.meta')}</h1><p role="status" aria-busy="true">{t('connections.loading')}</p></>
        : loadError ? <><h1>{t('connections.names.meta')}</h1><div className="mova-conn-message is-error" role="alert"><p>{t('connections.loadError')}</p><Button variant="secondary" onClick={() => void load()}>{t('connections.retry')}</Button></div></>
        : !connection ? <>
          <div className="mova-conn-head"><h1>{t('connections.names.meta')}</h1><p className="mova-conn-lead">{t('connections.meta.subtitle')}</p></div>
          <section className="mova-conn-card" aria-labelledby="conn-meta-uses">
            <div className="mova-conn-card__head"><h2 id="conn-meta-uses">{t('connections.usesTitleFuture')}</h2><StatusPill pill={{ tone: 'off', labelKey: 'connections.status.notConnected' }} /></div>
            <ul className="mova-conn-uses">{[t('connections.meta.useDms'), t('connections.meta.useAnswers'), t('connections.meta.useReports')].map((item) => <li key={item}><Icon name="check" size={18} /><span>{item}</span></li>)}</ul>
            <p className="mova-conn-note">{t('connections.meta.aiNote')}</p>
          </section>
          <section className="mova-conn-card" aria-labelledby="conn-meta-before">
            <h2 id="conn-meta-before">{t('connections.meta.beforeTitle')}</h2>
            <ol className="mova-conn-steps">
              <li><strong>{t('connections.meta.stepProfessionalStrong')}</strong> {t('connections.meta.stepProfessional')}</li>
              <li><strong>{t('connections.meta.stepPageStrong')}</strong> {t('connections.meta.stepPage')}</li>
              <li>{t('connections.meta.stepSignIn')}</li>
            </ol>
          </section>
          {meta?.provider_configured
            ? <Button className="mova-conn-full" loading={busy} onClick={() => void begin()}>{t('connections.meta.connect')}</Button>
            : <><Button className="mova-conn-full" disabled>{t('connections.meta.connect')}</Button><p className="mova-conn-message">{t('connections.meta.notAvailable')}</p></>}
          <p className="mova-conn-small">{t('connections.meta.connectNote')}</p>
        </> : <>
          <h1>{t('connections.names.meta')}</h1>
          <AccountCard name="meta" label={t('connections.account')} title={connection.instagram_username ? `@${connection.instagram_username}` : connection.page_name}
            detail={connection.instagram_username ? t('connections.meta.accountLinked', { page: connection.page_name }) : t('connections.meta.accountPageOnly')} pill={{ tone: 'on', labelKey: 'connections.status.on' }} />
          <UsesCard title={t('connections.usesTitle')} items={[t('connections.meta.useReplies'), t('connections.meta.useReports')]} />
          <section className="mova-conn-card" aria-labelledby="conn-meta-accounts">
            <h2 id="conn-meta-accounts">{t('connections.meta.accountsTitle')}</h2>
            <dl className="mova-conn-dl">
              <dt>{t('connections.meta.instagram')}</dt><dd>{connection.instagram_username ? `@${connection.instagram_username}` : t('connections.meta.notLinked')}</dd>
              <dt>{t('connections.meta.page')}</dt><dd>{connection.page_name}</dd>
              <dt>{t('connections.meta.lastMessage')}</dt><dd>{relative(connection.last_message_at)}</dd>
            </dl>
          </section>
          <section className="mova-conn-card" aria-labelledby="conn-meta-concierge">
            <h2 id="conn-meta-concierge">{t('connections.meta.conciergeTitle')}</h2>
            <Toggle label={t('connections.meta.answerInstagram')} description={t('connections.meta.answerInstagramHint')} checked={meta?.channels.instagram ?? false} disabled={busy || !connection.instagram_user_id} onChange={(value) => void setChannel('instagram', value)} />
            <Toggle label={t('connections.meta.answerFacebook')} description={t('connections.meta.answerFacebookHint')} checked={meta?.channels.messenger ?? false} disabled={busy} onChange={(value) => void setChannel('messenger', value)} />
            <LinkRow title={t('connections.meta.whatSay')} detail={t('connections.meta.whatSayHint')} to={operatorUrl(businessId, 'growth/concierge/setup')} />
          </section>
          <p className="mova-conn-foot">{t('connections.meta.footnote')}</p>
          <Button variant="secondary" className="mova-conn-danger mova-conn-full" disabled={busy} onClick={() => setConfirmOpen(true)}>{t('connections.meta.disconnect')}</Button>
        </>}
      {error && <p role="alert" className="mova-conn-message is-error">{error}</p>}
      {notice && <p role={outcomeIsError ? 'alert' : 'status'} className={`mova-conn-message${outcomeIsError ? ' is-error' : ''}`}>{notice}</p>}
    </div>
    <DisconnectSheet open={confirmOpen} title={t('connections.meta.disconnectTitle')} body={t('connections.meta.footnote')} confirm={t('connections.meta.disconnect')} busy={busy} onClose={() => setConfirmOpen(false)} onConfirm={() => void disconnect()} />
  </ConnectionShell>;
}

export default MetaConnectionPage;
