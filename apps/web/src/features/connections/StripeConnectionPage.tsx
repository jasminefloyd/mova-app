import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Icon, ScreenHeader, Toggle } from '../../components';
import { operatorUrl } from '../../app/operator-url';
import { useArtistBusiness } from '../settings/useArtistBusiness';
import { formatFeePercent, scheduleLabel, stripeState } from '../money/PaymentSettingsPage';
import { invokeFn, loadStripeStatus, stripePill, type StripeStatus } from './connections-api';
import { AccountCard, DisconnectSheet, LinkRow, UsesCard } from './ConnectionsUi';
import { ConnectionShell } from './ConnectionsPage';

// CN3: Stripe, under Payment processors. Card payments, deposits and payouts. Bank details and the payout
// schedule stay in Stripe; Mova only reads them.

type Switches = { deposits_enabled: boolean; pay_links_enabled: boolean; platform_fee_bps: number | null };
type Translate = (key: string, options?: Record<string, unknown>) => string;
const titleCase = (value: string) => value.toLocaleLowerCase().replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase());

export function StripeConnectionPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { client, businessId, loading: identityLoading } = useArtistBusiness();
  const [stripe, setStripe] = useState<StripeStatus | null>(null);
  const [switches, setSwitches] = useState<Switches | null>(null);
  const [businessName, setBusinessName] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [notice, setNotice] = useState(() => params.get('stripe') === 'connected' ? t('connections.stripe.connectedNotice') : '');

  const load = useCallback(async () => {
    if (!client || !businessId) return;
    setLoading(true); setLoadError(false);
    try {
      const [status, settings, profile] = await Promise.all([
        loadStripeStatus(client, businessId),
        invokeFn<Switches>(client, businessId, 'payment-settings', { action: 'get' }),
        client.from('mova_artist_profiles').select('display_name').eq('artist_business_id', businessId).maybeSingle(),
      ]);
      setStripe(status);
      setSwitches({ deposits_enabled: settings.deposits_enabled !== false, pay_links_enabled: settings.pay_links_enabled !== false, platform_fee_bps: settings.platform_fee_bps ?? null });
      setBusinessName(profile.data?.display_name ?? '');
    } catch { setLoadError(true); } finally { setLoading(false); }
  }, [client, businessId]);
  useEffect(() => { if (!identityLoading) void load(); }, [identityLoading, load]);

  const startStripe = async () => {
    if (!client || !businessId) return;
    setBusy(true); setError('');
    try {
      const data = await invokeFn<{ authorization_url: string }>(client, businessId, 'stripe-connect-onboard', { action: 'start', return_path: window.location.pathname });
      if (!data.authorization_url.startsWith('https://')) throw new Error('INVALID_URL');
      window.location.assign(data.authorization_url);
    } catch { setError(t('money.stripeConnectError')); setBusy(false); }
  };

  const saveSwitch = async (key: 'deposits_enabled' | 'pay_links_enabled', value: boolean) => {
    if (!client || !businessId || !switches) return;
    const previous = switches;
    setSwitches({ ...switches, [key]: value }); setError('');
    try {
      await invokeFn(client, businessId, 'payment-settings', { action: 'save-card-switches', [key]: value });
    } catch { setSwitches(previous); setError(t('connections.saveError')); }
  };

  const disconnect = async () => {
    if (!client || !businessId) return;
    setBusy(true); setError('');
    try {
      await invokeFn(client, businessId, 'stripe-connect-onboard', { action: 'disconnect' });
      setConfirmOpen(false); setNotice(t('connections.stripe.disconnected'));
      await load();
    } catch { setError(t('connections.stripe.disconnectError')); } finally { setBusy(false); }
  };

  const state = stripeState(stripe?.connected ?? null);
  const connected = stripe?.connected ?? null;
  const fee = switches?.platform_fee_bps != null ? formatFeePercent(switches.platform_fee_bps, i18n.language) : null;
  const dateText = (iso: string | null | undefined) => iso ? new Intl.DateTimeFormat(i18n.resolvedLanguage, { month: 'short', day: 'numeric' }).format(new Date(iso)) : '';
  const payouts = stripe?.payouts ?? null;
  const bank = !connected?.payouts_enabled ? t('money.statusPaused') : payouts?.bank_last4 ? t('money.bankEnding', { bank: payouts.bank_name ? titleCase(payouts.bank_name) : t('money.bankGeneric'), last4: payouts.bank_last4 }) : t('money.managedInStripe');
  const next = stripe?.next_payout;
  const nextText = next ? t('connections.stripe.nextPayoutValue', {
    amount: new Intl.NumberFormat(i18n.resolvedLanguage, { style: 'currency', currency: next.currency || 'USD' }).format(next.amount_minor / 100),
    day: new Intl.DateTimeFormat(i18n.resolvedLanguage, { weekday: 'short' }).format(new Date(next.arrival_date)),
  }) : t('connections.stripe.noPayout');
  const feeNote = (rest: string) => fee && <p className="mova-conn-note"><strong>{t('money.feeNoteStrong', { percent: fee })}</strong>{rest}</p>;

  return <ConnectionShell current="stripe">
    <ScreenHeader onBack={() => navigate(operatorUrl(businessId, 'settings/connections'))} backLabel={t('connections.back')} />
    <div className="mova-conn-detail">
      <h1>{t('connections.names.stripe')}</h1>
      {identityLoading || loading ? <p role="status" aria-busy="true">{t('connections.loading')}</p>
        : loadError ? <div className="mova-conn-message is-error" role="alert"><p>{t('connections.loadError')}</p><Button variant="secondary" onClick={() => void load()}>{t('connections.retry')}</Button></div>
        : !stripe?.available ? <p className="mova-conn-message">{t('money.stripeSetupUnavailable')}</p>
        : state === 'not_connected' ? <>
          <UsesCard title={t('connections.usesTitleFuture')} items={[t('connections.stripe.useDeposits'), t('connections.stripe.usePayLinks'), t('connections.stripe.usePayouts')]}>
            {feeNote(t('money.feeNoteSetup'))}
          </UsesCard>
          <Button className="mova-conn-full" loading={busy} onClick={() => void startStripe()}>{t('money.connectStripe')}</Button>
          <p className="mova-conn-small">{t('money.stripeIdNote')}</p>
        </> : <>
          <AccountCard name="stripe" label={t('connections.account')} title={businessName || t('connections.names.stripe')}
            detail={state === 'active' ? t('connections.stripe.connectedVerified', { date: dateText(connected?.connected_at) }) : t('connections.stripe.connectedChecking', { date: dateText(connected?.connected_at) })}
            pill={stripePill(stripe)} />
          {state === 'pending' && <><p className="mova-conn-message">{t('money.stripePendingNote')}</p><Button className="mova-conn-full" loading={busy} onClick={() => void startStripe()}>{t('money.continueStripe')}</Button></>}
          {state === 'restricted' && <><p className="mova-conn-message is-error" role="alert"><strong>{t('money.restrictedStrong')}</strong> {t('money.restrictedRest')}</p><Button className="mova-conn-full" loading={busy} onClick={() => void startStripe()}>{t('money.fixInStripe')}</Button></>}
          <UsesCard title={t('connections.usesTitle')} items={[t('connections.stripe.useDeposits'), t('connections.stripe.usePayLinks'), t('connections.stripe.usePayouts')]} />
          {state === 'active' && <section className="mova-conn-card" aria-labelledby="conn-stripe-payouts">
            <h2 id="conn-stripe-payouts">{t('connections.stripe.payoutsTitle')}</h2>
            <dl className="mova-conn-dl">
              <dt>{t('money.cardPayments')}</dt><dd>{t('money.statusOn')}</dd>
              <dt>{t('money.payoutsTo')}</dt><dd data-testid="payout-bank">{bank}</dd>
              <dt>{t('connections.stripe.schedule')}</dt><dd data-testid="payout-schedule">{scheduleLabel(payouts, t as unknown as Translate, i18n.language)}</dd>
              <dt>{t('connections.stripe.nextPayout')}</dt><dd>{nextText}</dd>
            </dl>
            {feeNote(t('money.feeNoteActive'))}
            <div className="mova-conn-tiles">
              <a className="mova-conn-tile" href={operatorUrl(businessId, 'money')}><span>{t('connections.stripe.moneyTile')}</span><strong>{t('money.seePayouts')}</strong></a>
              {stripe.dashboard_url && <a className="mova-conn-tile" href={stripe.dashboard_url} target="_blank" rel="noreferrer"><span>{t('connections.stripe.bankTile')}</span><strong>{t('money.openStripe')}<Icon name="send" size={14} /></strong></a>}
            </div>
          </section>}
          <section className="mova-conn-card" aria-labelledby="conn-stripe-settings">
            <h2 id="conn-stripe-settings">{t('connections.settingsTitle')}</h2>
            <Toggle label={t('connections.stripe.deposits')} description={t('connections.stripe.depositsHint')} checked={switches?.deposits_enabled ?? true} disabled={busy || !switches} onChange={(value) => void saveSwitch('deposits_enabled', value)} />
            <Toggle label={t('connections.stripe.payLinks')} description={t('connections.stripe.payLinksHint')} checked={switches?.pay_links_enabled ?? true} disabled={busy || !switches} onChange={(value) => void saveSwitch('pay_links_enabled', value)} />
            <LinkRow title={t('connections.stripe.recorded')} detail={t('connections.stripe.recordedHint')} to={operatorUrl(businessId, 'settings/payments')} />
          </section>
          <p className="mova-conn-foot">{t('connections.stripe.footnote')}</p>
          <Button variant="secondary" className="mova-conn-danger mova-conn-full" disabled={busy} onClick={() => setConfirmOpen(true)}>{t('connections.stripe.disconnect')}</Button>
        </>}
      {error && <p role="alert" className="mova-conn-message is-error">{error}</p>}
      {notice && <p role="status" className="mova-conn-message">{notice}</p>}
    </div>
    <DisconnectSheet open={confirmOpen} title={t('connections.stripe.disconnectTitle')} body={t('connections.stripe.footnote')} confirm={t('connections.stripe.disconnect')} busy={busy} onClose={() => setConfirmOpen(false)} onConfirm={() => void disconnect()} />
  </ConnectionShell>;
}

export default StripeConnectionPage;
