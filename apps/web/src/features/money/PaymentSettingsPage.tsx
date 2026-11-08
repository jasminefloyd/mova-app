import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Card, ErrorState, ScreenHeader, Toggle } from '../../components';
import { useArtistBusiness } from '../settings/useArtistBusiness';
import { operatorUrl } from '../../app/operator-url';
import { publicEnv, stripeTestModeEnabled } from '../../lib/env';

type Methods = { cash_enabled: boolean; other_enabled: boolean };
type Settings = Methods & { zelle_available: boolean; platform_fee_bps: number | null; salon_locations: string[] };
type StripeConnection = { account_type: string | null; status: string; charges_enabled: boolean; payouts_enabled: boolean; details_submitted: boolean } | null;
type Payouts = { bank_last4: string | null; bank_name: string | null; interval: 'manual' | 'daily' | 'weekly' | 'monthly' | null; weekly_anchor: string | null; monthly_anchor: number | null } | null;
export type StripeState = 'not_connected' | 'pending' | 'restricted' | 'active';

const defaults: Settings = { cash_enabled: true, other_enabled: true, zelle_available: false, platform_fee_bps: null, salon_locations: [] };

/** Maps a row of mova_stripe_connections to the four states shown on 16a/16b. */
export function stripeState(connection: StripeConnection): StripeState {
  switch (connection?.status) {
    case 'pending': return 'pending';
    case 'restricted': return 'restricted';
    case 'active': return connection.charges_enabled ? 'active' : 'pending';
    default: return 'not_connected';
  }
}

export function formatFeePercent(bps: number, locale: string) {
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 2 }).format(bps / 10000);
}

const titleCase = (value: string) => value.toLocaleLowerCase().replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase());

/** Payout schedule label for board 16b; the schedule is read from Stripe and never edited in Mova. */
type Translate = (key: string, options?: Record<string, unknown>) => string;
export function scheduleLabel(payouts: Payouts, t: Translate, locale: string) {
  switch (payouts?.interval) {
    case 'daily': return t('money.schedule.daily');
    case 'manual': return t('money.schedule.manual');
    case 'monthly': return payouts.monthly_anchor ? t('money.schedule.monthly', { day: payouts.monthly_anchor }) : t('money.managedInStripe');
    case 'weekly': {
      const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const index = days.indexOf(payouts.weekly_anchor ?? '');
      if (index < 0) return t('money.managedInStripe');
      const day = new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2023, 0, 1 + index)));
      return t('money.schedule.weekly', { day });
    }
    default: return t('money.managedInStripe');
  }
}

export function PaymentSettingsPage() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const { client, businessId, loading: identityLoading } = useArtistBusiness();
  const [settings, setSettings] = useState<Settings>(defaults);
  const [savedMethods, setSavedMethods] = useState<Methods>(defaults);
  const [connection, setConnection] = useState<StripeConnection>(null);
  const [payouts, setPayouts] = useState<Payouts>(null);
  const [dashboardUrl, setDashboardUrl] = useState<string | null>(null);
  const [stripeBusy, setStripeBusy] = useState(false);
  const [stripeError, setStripeError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [saved, setSaved] = useState(false);

  const headers = useCallback(async () => {
    if (!client) return null;
    const { data: { session } } = await client.auth.getSession();
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}`, 'x-mova-artist-business-id': businessId ?? '' };
  }, [client, businessId]);

  const load = useCallback(async () => {
    const h = await headers();
    if (!h) return;
    setLoading(true); setLoadError(false);
    try {
      const response = await fetch(`${publicEnv.VITE_SUPABASE_URL}/functions/v1/payment-settings`, { method: 'POST', headers: h, body: JSON.stringify({ action: 'get' }) });
      const body = await response.json();
      if (!response.ok || !body.data) throw new Error();
      const next: Settings = { ...defaults, ...body.data, salon_locations: Array.isArray(body.data.salon_locations) ? body.data.salon_locations : [] };
      setSettings(next);
      setSavedMethods({ cash_enabled: next.cash_enabled, other_enabled: next.other_enabled });
    } catch { setLoadError(true); } finally { setLoading(false); }
  }, [headers]);
  useEffect(() => { void load(); }, [load]);

  const loadStripe = useCallback(async () => {
    const h = await headers();
    if (!h) return;
    try {
      const response = await fetch(`${publicEnv.VITE_SUPABASE_URL}/functions/v1/stripe-connect-onboard`, { method: 'POST', headers: h, body: JSON.stringify({ action: 'status' }) });
      const body = await response.json().catch(() => null);
      // While Stripe is switched off for this environment the card stays "Not set up" without an error.
      if (!response.ok && (body?.data?.code === 'STRIPE_TEST_MODE_DISABLED' || body?.data?.code === 'STRIPE_TEST_CONFIGURATION_MISSING')) return;
      if (!response.ok) throw new Error();
      setConnection(body.data?.connected ?? null);
      setPayouts(body.data?.payouts ?? null);
      setDashboardUrl(typeof body.data?.dashboard_url === 'string' && body.data.dashboard_url.startsWith('https://') ? body.data.dashboard_url : null);
    } catch { setStripeError(true); }
  }, [headers]);
  useEffect(() => { void loadStripe(); }, [loadStripe]);

  const dirty = settings.cash_enabled !== savedMethods.cash_enabled || settings.other_enabled !== savedMethods.other_enabled;
  const setMethod = (key: keyof Methods, value: boolean) => { setSaved(false); setSettings((old) => ({ ...old, [key]: value })); };

  const save = async () => {
    if (!dirty) return;
    const h = await headers();
    if (!h) return;
    setSaving(true); setSaveError(false); setSaved(false);
    try {
      const methods = { cash_enabled: settings.cash_enabled, other_enabled: settings.other_enabled };
      const response = await fetch(`${publicEnv.VITE_SUPABASE_URL}/functions/v1/payment-settings`, { method: 'POST', headers: h, body: JSON.stringify({ action: 'save', ...methods }) });
      if (!response.ok) throw new Error();
      setSavedMethods(methods);
      setSaved(true);
    } catch { setSaveError(true); } finally { setSaving(false); }
  };

  const connectStripe = async () => {
    const h = await headers();
    if (!h) return;
    setStripeBusy(true); setStripeError(false);
    try {
      const response = await fetch(`${publicEnv.VITE_SUPABASE_URL}/functions/v1/stripe-connect-onboard`, { method: 'POST', headers: h, body: JSON.stringify({ action: 'start', return_path: window.location.pathname }) });
      const body = await response.json();
      if (!response.ok || typeof body.data?.authorization_url !== 'string') throw new Error();
      window.location.assign(body.data.authorization_url);
    } catch { setStripeError(true); setStripeBusy(false); }
  };

  const state = stripeState(connection);
  const fee = useMemo(() => settings.platform_fee_bps == null ? null : formatFeePercent(settings.platform_fee_bps, i18n.language), [settings.platform_fee_bps, i18n.language]);
  const feeNote = (rest: string) => fee && <p className="mova-payment-settings__fee"><strong>{t('money.feeNoteStrong', { percent: fee })}</strong>{rest}</p>;
  const salonNames = settings.salon_locations.length
    ? new Intl.ListFormat(i18n.language, { style: 'long', type: 'conjunction' }).format(settings.salon_locations)
    : '';

  const stripeAction = (label: string) => stripeTestModeEnabled
    ? <Button type="button" loading={stripeBusy} onClick={() => void connectStripe()}>{label}</Button>
    : <><Button type="button" disabled>{label}</Button><small>{t('money.stripeSetupUnavailable')}</small></>;

  return <main className="mova-page mova-payment-settings">
    <ScreenHeader title={t('money.paymentSettingsTitle')} onBack={() => navigate(operatorUrl(businessId, 'settings'))} backLabel={t('settings.close')} />
    {identityLoading || loading ? <p role="status" aria-busy="true">{t('money.loading')}</p>
      : loadError ? <ErrorState title={t('money.settingsError')} retryLabel={t('money.retry')} onRetry={() => void load()} />
      : <>
        <div className="mova-payment-settings__head"><h1>{t('money.howYouGetPaid')}</h1><p>{t('money.paymentSettingsIntro')}</p></div>

        <Card className="mova-payment-settings__stripe">
          <div className="mova-payment-settings__card-head">
            <h2 id="payment-online-heading">{t('money.onlinePayments')}</h2>
            <span className={`mova-payment-settings__pill is-${state}`} data-testid="stripe-state">{t(`money.stripeState.${state}`)}</span>
          </div>
          {stripeTestModeEnabled && <p className="mova-payment-settings__test">{t('money.stripeTestModeLabel')}</p>}

          {state === 'not_connected' && <>
            <p>{t('money.stripeDescription')}</p>
            <ul className="mova-payment-settings__benefits">
              <li>{t('money.stripeBenefitDeposit')}</li><li>{t('money.stripeBenefitPayLink')}</li><li>{t('money.stripeBenefitWallets')}</li>
            </ul>
            {feeNote(t('money.feeNoteSetup'))}
            {stripeAction(t('money.connectStripe'))}
            <small>{t('money.stripeIdNote')}</small>
          </>}

          {state === 'pending' && <>
            <p className="mova-payment-settings__notice">{t('money.stripePendingNote')}</p>
            <dl className="mova-payment-settings__facts">
              <dt>{t('money.cardPayments')}</dt><dd>{t('money.notYet')}</dd>
              <dt>{t('money.payoutsToBank')}</dt><dd>{t('money.notYet')}</dd>
            </dl>
            {stripeAction(t('money.continueStripe'))}
          </>}

          {state === 'restricted' && <>
            <p className="mova-payment-settings__notice is-alert" role="alert"><strong>{t('money.restrictedStrong')}</strong> {t('money.restrictedRest')}</p>
            {stripeAction(t('money.fixInStripe'))}
          </>}

          {state === 'active' && <>
            <dl className="mova-payment-settings__facts">
              <dt>{t('money.cardPayments')}</dt><dd>{t('money.statusOn')}</dd>
              <dt>{t('money.payoutsTo')}</dt><dd data-testid="payout-bank">{!connection?.payouts_enabled ? t('money.statusPaused') : payouts?.bank_last4 ? t('money.bankEnding', { bank: payouts.bank_name ? titleCase(payouts.bank_name) : t('money.bankGeneric'), last4: payouts.bank_last4 }) : t('money.managedInStripe')}</dd>
              <dt>{t('money.payoutSchedule')}</dt><dd data-testid="payout-schedule">{scheduleLabel(payouts, t as unknown as Translate, i18n.language)}</dd>
            </dl>
            {feeNote(t('money.feeNoteActive'))}
            <div className="mova-payment-settings__links">
              <a className="mova-button mova-button--secondary" href={operatorUrl(businessId, 'money')}>{t('money.seePayouts')}</a>
              {dashboardUrl && <a className="mova-button mova-button--secondary" href={dashboardUrl} target="_blank" rel="noreferrer">{t('money.openStripe')}</a>}
            </div>
            <small>{t('money.stripeManagedNote')}</small>
          </>}
          {stripeError && <p role="alert">{t('money.stripeConnectError')}</p>}
        </Card>

        <Card className="mova-payment-settings__manual">
          <h2>{t('money.recordedPayments')}</h2>
          <p>{t('money.recordedOnlyDisclaimer')}</p>
          <Toggle label={t('money.methods.cash')} description={t('money.cashHint')} checked={settings.cash_enabled} onChange={(value) => setMethod('cash_enabled', value)} />
          {/* Zelle: hidden until owner decision A-16 (zelle_available is always false today). */}
          <Toggle label={t('money.methods.other')} description={t('money.otherHint')} checked={settings.other_enabled} onChange={(value) => setMethod('other_enabled', value)} />
        </Card>

        {salonNames && <aside className="mova-payment-settings__salon">
          <p><strong>{t('money.salonCollectsFor', { names: salonNames })}</strong> {t('money.salonCollectsRest')}</p>
          <a href={operatorUrl(businessId, 'settings/locations')}>{t('money.changeInLocations')}</a>
        </aside>}

        {saveError && <p role="alert">{t('money.settingsSaveError')}</p>}
        {saved && <p role="status" className="mova-visually-hidden">{t('money.settingsSaved')}</p>}
        <footer className="mova-payment-settings__actions">
          <Button type="button" loading={saving} disabled={!dirty} onClick={() => void save()}>{saved && !dirty ? t('money.savedShort') : t('money.savePaymentSettings')}</Button>
        </footer>
      </>}
  </main>;
}

export default PaymentSettingsPage;
