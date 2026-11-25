import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Card, ErrorState, IconButton, OptionGroup, RadioCard, TextField } from '../../components';
import { useArtistBusiness } from '../settings/useArtistBusiness';
import { usePlan } from '../billing/PlanProvider';
import { operatorUrl } from '../../app/operator-url';
import { parseDisplayId } from '../../lib/display-ids';
import { QrCode } from '../identity/QrCode';

type Method = 'card' | 'cash' | 'other';
type CardMode = 'qr' | 'text';
type Appointment = { id: string; status: string; starts_at: string; service_name_snapshot: string; service_price_minor: number; balance_due_minor: number; client_name: string; client_phone: string | null; client_locale: string | null; location_id: string; artist_business_id: string };
type PayLink = { pay_url: string; expires_at: string; mode: CardMode };
const endpoint = (name: string) => `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`;
const FREE_FEE_BPS = 150;
const linkErrors: Record<string, string> = {
  STRIPE_ACCOUNT_NOT_READY: 'money.stripeNotConnected',
  STRIPE_TEST_MODE_DISABLED: 'money.cardNotLive',
  STRIPE_TEST_CONFIGURATION_MISSING: 'money.cardNotLive',
  ONLINE_PAYMENT_UNAVAILABLE: 'money.salonCollectsCard',
  PAYLINK_NOT_AVAILABLE: 'money.nothingDue',
};

/** Board 18: take the balance by card (a Stripe pay link, texted or shown as a QR code), or record cash or other. */
export function GetPaidPage() {
  const { appointmentId = '' } = useParams();
  const appointmentNumber = parseDisplayId('AID', appointmentId);
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const { client, businessId, loading: identityLoading } = useArtistBusiness();
  const { summary } = usePlan();
  const amountId = useId();
  const [appointment, setAppointment] = useState<Appointment | null>(null);
  const [serviceNames, setServiceNames] = useState<string[]>([]);
  const [method, setMethod] = useState<Method>('card');
  const [cardMode, setCardMode] = useState<CardMode>('text');
  const [collector, setCollector] = useState<'artist' | 'salon'>('artist');
  const [amount, setAmount] = useState('');
  const [otherLabel, setOtherLabel] = useState('');
  const [settings, setSettings] = useState({ cash_enabled: true, other_enabled: true });
  const [stripeReady, setStripeReady] = useState(false);
  const [payLinksOn, setPayLinksOn] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [linkError, setLinkError] = useState('');
  const [link, setLink] = useState<PayLink | null>(null);
  const [notice, setNotice] = useState('');
  const back = () => navigate(operatorUrl(businessId, `appointments/${appointmentId}`));

  const load = useCallback(async () => {
    if (!client || !businessId) return;
    setLoading(true); setError(false);
    try {
      if (!appointmentNumber) throw new Error();
      const { data: a, error: aError } = await client.from('mova_appointments')
        .select('id,appointment_number,status,starts_at,service_name_snapshot,service_price_minor,balance_due_minor,client_name,client_phone,client_locale,location_id,artist_business_id')
        .eq('appointment_number', appointmentNumber).eq('artist_business_id', businessId).maybeSingle();
      if (aError || !a) throw new Error();
      const [{ data: paymentLocation }, { data: stripe }, { data: methods }, { data: services }] = await Promise.all([
        client.from('mova_locations').select('name,payment_collector,time_zone').eq('id', a.location_id).eq('artist_business_id', businessId).maybeSingle(),
        client.from('mova_stripe_connections').select('status,charges_enabled,account_type').eq('artist_business_id', businessId).maybeSingle(),
        client.from('mova_payment_method_settings').select('cash_enabled,other_enabled,pay_links_enabled').eq('artist_business_id', businessId).maybeSingle(),
        client.from('mova_appointment_services').select('position,service_name_snapshot').eq('appointment_id', a.id).eq('artist_business_id', businessId).order('position'),
      ]);
      setAppointment(a as Appointment);
      setServiceNames(services?.length ? services.map((item) => item.service_name_snapshot) : [a.service_name_snapshot]);
      setCollector(paymentLocation?.payment_collector === 'salon' ? 'salon' : 'artist');
      setAmount(((a.balance_due_minor ?? 0) / 100).toFixed(2));
      setStripeReady(Boolean(stripe?.status === 'active' && stripe.charges_enabled));
      if (methods) { setSettings({ cash_enabled: methods.cash_enabled, other_enabled: methods.other_enabled }); setPayLinksOn(methods.pay_links_enabled !== false); }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [client, businessId, appointmentNumber]);
  useEffect(() => { void load(); }, [load]);

  const balance = appointment?.balance_due_minor ?? 0;
  const amountMinor = useMemo(() => /^\d+(\.\d{1,2})?$/.test(amount) ? Math.round(Number(amount) * 100) : 0, [amount]);
  const currency = (minor: number) => new Intl.NumberFormat(i18n.resolvedLanguage, { style: 'currency', currency: 'USD' }).format(minor / 100);
  const feeBps = summary?.current_plan?.mova_fee_basis_points ?? FREE_FEE_BPS;
  const feeRate = new Intl.NumberFormat(i18n.resolvedLanguage, { style: 'percent', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(feeBps / 10000);
  const availableMethods: Method[] = [...(collector === 'artist' ? ['card' as const] : []), ...(settings.cash_enabled ? ['cash' as const] : []), ...(settings.other_enabled ? ['other' as const] : [])];
  useEffect(() => { if (collector === 'salon' && method === 'card') setMethod(settings.cash_enabled ? 'cash' : settings.other_enabled ? 'other' : 'cash'); }, [collector, method, settings.cash_enabled, settings.other_enabled]);
  // A pay link is always for the whole balance, so the amount follows it while Card is chosen.
  useEffect(() => { if (method === 'card' && appointment) setAmount((balance / 100).toFixed(2)); }, [method, appointment, balance]);

  const authHeaders = async (): Promise<Record<string, string>> => {
    const { data: { session } } = await client!.auth.getSession();
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}`, 'x-mova-artist-business-id': businessId!, 'Idempotency-Key': crypto.randomUUID() };
  };

  const createLink = async () => {
    if (!client || !businessId || !appointment) return;
    setBusy(true); setLinkError('');
    try {
      const response = await fetch(endpoint('paylink-create'), { method: 'POST', headers: await authHeaders(), body: JSON.stringify({ appointment_id: appointment.id, channel: cardMode === 'text' ? 'sms' : 'qr' }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || typeof payload?.data?.pay_url !== 'string') throw new Error(payload?.error?.code ?? payload?.data?.code ?? 'PAYLINK_CREATE_FAILED');
      setLink({ pay_url: payload.data.pay_url, expires_at: payload.data.expires_at, mode: cardMode });
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : '';
      setLinkError(t(linkErrors[code] ?? 'money.payLinkError'));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!client || !businessId || !appointment || amountMinor <= 0) return;
    setBusy(true); setError(false);
    try {
      const response = await fetch(endpoint('manual-payment-record'), { method: 'POST', headers: await authHeaders(), body: JSON.stringify({ appointment_id: appointment.id, method, amount_minor: amountMinor, collector, recorded_method_label: method === 'other' ? otherLabel.trim() : undefined }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.code ?? 'PAYMENT_RECORD_FAILED');
      back();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  const firstName = appointment?.client_name.split(/\s+/)[0] ?? '';
  const expiry = (iso: string) => new Intl.DateTimeFormat(i18n.resolvedLanguage, { weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
  const clientT = i18n.getFixedT(appointment?.client_locale === 'es-US' ? 'es-US' : 'en-US');
  const message = link ? clientT('money.payLinkMessage', { name: firstName, amount: currency(balance), url: link.pay_url }) : '';
  const smsHref = link && appointment?.client_phone ? `sms:${appointment.client_phone.replace(/[^\d+]/g, '')}?&body=${encodeURIComponent(message)}` : '';
  const shareLink = async () => {
    if (!link) return;
    setNotice('');
    try {
      if (navigator.share) await navigator.share({ text: message });
      else { await navigator.clipboard.writeText(link.pay_url); setNotice(t('money.linkCopied')); }
    } catch { /* the stylist closed the share sheet */ }
  };
  const copyLink = async () => {
    if (!link) return;
    try { await navigator.clipboard.writeText(link.pay_url); setNotice(t('money.linkCopied')); } catch { setNotice(t('money.copyFailed')); }
  };

  const header = <header className="mova-get-paid__header"><h1>{t('money.getPaid')}</h1><IconButton label={t('money.close')} icon="close" onClick={back} /></header>;

  if (link && appointment) {
    return <main className="mova-page mova-get-paid">
      {header}
      {link.mode === 'qr'
        ? <section className="mova-get-paid__done">
          <h2>{t('money.scanToPay', { amount: currency(balance) })}</h2>
          <p>{t('money.scanToPayDetail', { name: firstName })}</p>
          <QrCode value={link.pay_url} label={t('money.payQrLabel', { amount: currency(balance) })} size={260} className="mova-get-paid__qr" />
          <p className="mova-get-paid__expires">{t('money.linkExpires', { time: expiry(link.expires_at) })}</p>
        </section>
        : <section className="mova-get-paid__done">
          <span className="mova-get-paid__done-icon" aria-hidden="true">✓</span>
          <h2>{t('money.linkReady')}</h2>
          <p>{t(smsHref ? 'money.linkReadyDetail' : 'money.linkReadyNoPhone', { name: firstName, amount: currency(balance) })}</p>
          <p className="mova-get-paid__link">{link.pay_url}</p>
          <p className="mova-get-paid__expires">{t('money.linkExpires', { time: expiry(link.expires_at) })}</p>
        </section>}
      <p className="mova-get-paid__notice-copy">{t('money.paidShowsInMoney', { name: firstName })}</p>
      {notice && <p role="status">{notice}</p>}
      <footer className="mova-get-paid__actions mova-get-paid__actions--stack">
        {link.mode === 'text' && (smsHref
          ? <a className="mova-button mova-button--primary" href={smsHref}>{t('money.textLink', { name: firstName })}</a>
          : <Button type="button" onClick={() => void shareLink()}>{t('money.shareLink')}</Button>)}
        {link.mode === 'text' && <Button type="button" variant="secondary" onClick={() => void copyLink()}>{t('money.copyLink')}</Button>}
        <Button type="button" variant={link.mode === 'qr' ? 'primary' : 'ghost'} onClick={back}>{t('money.done')}</Button>
      </footer>
    </main>;
  }

  return <main className="mova-page mova-get-paid">
    {header}
    {identityLoading || loading ? <p role="status" aria-busy="true">{t('money.loading')}</p> : error && !appointment ? <ErrorState title={t('money.error')} retryLabel={t('money.retry')} onRetry={() => void load()} /> : appointment && <>
      <p className="mova-get-paid__context">{serviceNames.join(' + ') || appointment.service_name_snapshot} · {appointment.client_name} · {t('money.balance', { amount: currency(balance) })}</p>
      <label className="mova-field mova-get-paid__amount" htmlFor={amountId}>
        <span className="mova-field__label">{t('money.amount')}</span>
        <span className="mova-get-paid__money"><span aria-hidden="true">$</span><input id={amountId} className="mova-input" inputMode="decimal" value={amount} readOnly={method === 'card'} aria-describedby={method === 'card' ? `${amountId}-hint` : undefined} onChange={(event) => setAmount(event.currentTarget.value)} /></span>
        {method === 'card' && <span className="mova-field__hint" id={`${amountId}-hint`}>{t('money.payLinkFullBalance')}</span>}
      </label>
      <fieldset className="mova-get-paid__method-group"><legend className="mova-visually-hidden">{t('money.method')}</legend><OptionGroup label={t('money.method')}>
        {availableMethods.map((value) => <RadioCard key={value} name="payment-method" value={value} label={t(`money.methods.${value}`)} checked={method === value} onChange={() => { setMethod(value); setLinkError(''); }} />)}
      </OptionGroup></fieldset>
      {method === 'card' ? <section className="mova-get-paid__card-flow">
        <p className="mova-get-paid__status">{t('money.processedByStripe')}</p>
        {stripeReady && !payLinksOn ? <Card tone="warm" className="mova-get-paid__notice"><p>{t('connections.stripe.payLinksOffNotice')}</p><Button type="button" variant="secondary" onClick={() => navigate(operatorUrl(businessId, 'settings/connections/stripe'))}>{t('connections.stripe.openStripeConnection')}</Button></Card>
        : stripeReady ? <>
          <OptionGroup label={t('money.cardDelivery')}>
            <RadioCard name="card-delivery" value="text" label={t('money.textPayLink', { name: appointment.client_name })} description={t('money.paysOnPhone')} checked={cardMode === 'text'} onChange={() => setCardMode('text')} />
            <RadioCard name="card-delivery" value="qr" label={t('money.showPayQr')} description={t('money.clientScansAtChair')} checked={cardMode === 'qr'} onChange={() => setCardMode('qr')} />
          </OptionGroup>
          <p>{t('money.cardFeeNotice', { rate: feeRate, fee: currency(Math.round(balance * feeBps / 10000)) })}</p>
        </> : <Card tone="warm" className="mova-get-paid__notice"><p>{t('money.stripeNotConnected')}</p><Button type="button" variant="secondary" onClick={() => navigate(operatorUrl(businessId, 'settings/connections/stripe'))}>{t('connections.stripe.openStripeConnection')}</Button></Card>}
        {linkError && <p className="mova-field__error" role="alert">{linkError}</p>}
      </section> : <>
        <p className="mova-get-paid__recorded-status"><IconStatus />{t('money.recordedOnly')}</p>
        {method === 'cash' && <p className="mova-get-paid__notice-copy">{t('money.cashInstructions')}</p>}
        {method === 'other' && <><TextField label={t('money.otherMethod')} placeholder={t('money.otherPlaceholder')} value={otherLabel} maxLength={80} onChange={(event) => setOtherLabel(event.currentTarget.value)} /><p className="mova-get-paid__notice-copy">{t('money.otherInstructions')}</p></>}
        <fieldset className="mova-get-paid__collector"><legend>{t('money.whoReceived')}</legend><OptionGroup label={t('money.whoReceived')}><RadioCard name="payment-collector" value="artist" label={t('money.iReceived')} checked={collector === 'artist'} onChange={() => setCollector('artist')} /><RadioCard name="payment-collector" value="salon" label={t('money.salonReceived')} checked={collector === 'salon'} onChange={() => setCollector('salon')} /></OptionGroup></fieldset>
      </>}
      {error && <p role="alert">{t('money.recordError')}</p>}
      <footer className="mova-get-paid__actions">
        {method === 'card'
          ? <Button type="button" loading={busy} disabled={!stripeReady || !payLinksOn || balance <= 0} onClick={() => void createLink()}>{cardMode === 'text' ? t('money.sendPayLink', { amount: currency(balance) }) : t('money.showPayQr')}</Button>
          : <Button type="button" loading={busy} disabled={amountMinor <= 0 || amountMinor > balance || (method === 'other' && !otherLabel.trim())} onClick={() => void save()}>{method === 'cash' ? t('money.saveCashPayment') : t('money.savePayment', { amount: currency(amountMinor) })}</Button>}
      </footer>
    </>}
  </main>;
}

function IconStatus() { return <span aria-hidden="true" className="mova-get-paid__status-icon">✓</span>; }
export default GetPaidPage;
