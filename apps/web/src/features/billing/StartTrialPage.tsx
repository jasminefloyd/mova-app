import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Icon } from '../../components';
import { operatorUrl } from '../../app/operator-url';
import { formatDay, formatMoney, planCall, planPrice, PlanCallError, type PlanSummary } from './plan-api';
import { usePlan } from './PlanProvider';
import './billing.css';

const toE164 = (value: string) => {
  const digits = value.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
};

/**
 * T1: the first app entry after onboarding. 30 days of AI + Growth, card added in Stripe Checkout now,
 * charged when the trial ends unless the stylist switches. "Continue on Free" is always there (Q1).
 * The SMS opt-in is unchecked by default: account texts need an affirmative yes.
 */
export default function StartTrialPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { client, businessId, summary, refresh, setSummary } = usePlan();
  const [sms, setSms] = useState(false);
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState(false);
  const [busy, setBusy] = useState<'start' | 'free' | 'confirm' | null>(null);
  const [notice, setNotice] = useState<'cancelled' | 'failed' | 'used' | null>(null);
  const handled = useRef(false);
  const locale = i18n.resolvedLanguage;
  const days = summary?.trial?.trial_days ?? 30;
  const now = Date.now();
  const reminder = formatDay(new Date(now + (days - 7) * 86_400_000).toISOString(), locale);
  const ends = formatDay(new Date(now + days * 86_400_000).toISOString(), locale);
  const growth = formatMoney(planPrice(summary, 'ai_growth'), locale);
  const pro = formatMoney(planPrice(summary, 'pro'), locale);

  useEffect(() => {
    if (handled.current) return;
    const params = new URLSearchParams(location.search);
    const sessionId = params.get('session_id');
    if (params.get('checkout') === 'success' && sessionId && client && businessId) {
      handled.current = true;
      setBusy('confirm');
      void (async () => {
        try {
          const next = await planCall(client, businessId, 'plan-management', { action: 'confirm', session_id: sessionId }) as unknown as PlanSummary;
          setSummary(next);
        } catch { await refresh(); }
        navigate(operatorUrl(businessId, ''), { replace: true });
      })();
    } else if (params.get('checkout') === 'cancelled') {
      handled.current = true;
      setNotice('cancelled');
      navigate(location.pathname, { replace: true });
    }
  }, [businessId, client, location.pathname, location.search, navigate, refresh, setSummary]);

  const start = async () => {
    setNotice(null); setPhoneError(false);
    const e164 = sms ? toE164(phone) : null;
    if (sms && !e164) { setPhoneError(true); return; }
    setBusy('start');
    try {
      const result = await planCall(client, businessId, 'trial-start', { return_path: location.pathname, ...(sms && e164 ? { sms: { phone: e164, consent: true } } : {}) });
      if (typeof result.checkout_url !== 'string' || !result.checkout_url.startsWith('https://')) throw new Error('NO_URL');
      window.location.assign(result.checkout_url);
    } catch (error) {
      if (error instanceof PlanCallError && error.code === 'PHONE_INVALID') setPhoneError(true);
      else setNotice(error instanceof PlanCallError && error.code === 'TRIAL_ALREADY_USED' ? 'used' : 'failed');
      setBusy(null);
    }
  };
  const continueFree = async () => {
    setBusy('free');
    try { await client?.rpc('mova_record_trial_offer', { p_artist_business_id: businessId, p_declined: true }); } catch { /* still go home */ }
    await refresh();
    navigate(operatorUrl(businessId, ''), { replace: true });
  };

  if (busy === 'confirm') return <main className="mova-page" aria-busy="true"><p role="status">{t('trial.confirming')}</p></main>;
  return <main className="mova-start-trial">
    <p className="mova-start-trial__brand" aria-hidden="true">mova</p>
    <section className="mova-start-trial__hero" aria-labelledby="start-trial-title">
      <svg className="mova-start-trial__leaf" width="160" height="160" viewBox="0 0 40 40" aria-hidden="true"><path d="M40 4C26 4 16 14 16 28C30 28 40 18 40 4Z" /></svg>
      <span className="mova-start-trial__overline">{t('trial.start.overline', { days })}</span>
      <h1 id="start-trial-title">{t('trial.start.title')}</h1>
      <p>{t('trial.start.lead')}</p>
    </section>
    {notice && <p role={notice === 'cancelled' ? 'status' : 'alert'} className={`mova-plan-notice is-${notice === 'cancelled' ? 'cancelled' : 'failed'}`}>{t(`trial.start.notice.${notice}`)}</p>}
    <ul className="mova-start-trial__list" aria-label={t('trial.start.includes')}>
      {(['marketing', 'pricePilot', 'revenue', 'calendar'] as const).map((key) => <li key={key}>
        <span className="mova-start-trial__icon" aria-hidden="true"><Icon name={key === 'marketing' ? 'send' : key === 'pricePilot' ? 'search' : key === 'revenue' ? 'growth' : 'calendar'} size={18} /></span>
        <span><strong>{t(`trial.start.features.${key}.title`)}</strong>{t(`trial.start.features.${key}.body`)}</span>
      </li>)}
    </ul>
    <ol className="mova-start-trial__timeline" aria-label={t('trial.start.timeline')}>
      <li><i aria-hidden="true" /><span><strong>{t('trial.start.today')}</strong>{t('trial.start.todayBody')}</span></li>
      <li><i aria-hidden="true" /><span><strong>{t('trial.start.reminder', { date: reminder })}</strong>{t('trial.start.reminderBody')}</span></li>
      <li><i aria-hidden="true" /><span><strong>{t('trial.start.ends', { date: ends, price: growth })}</strong>{t('trial.start.endsBody', { pro })}</span></li>
    </ol>
    <section className="mova-sms-opt">
      <label className="mova-sms-opt__row">
        <input type="checkbox" checked={sms} onChange={(event) => setSms(event.currentTarget.checked)} />
        <span><strong>{t('trial.start.sms.title')}</strong>{t('trial.start.sms.body')}</span>
      </label>
      {sms && <label className="mova-sms-opt__field">
        <span>{t('trial.start.sms.mobile')}</span>
        <input type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(event) => { setPhone(event.currentTarget.value); setPhoneError(false); }} placeholder="(312) 555-0148" aria-invalid={phoneError} />
      </label>}
      {phoneError && <p role="alert" className="mova-field-error">{t('trial.start.sms.invalid')}</p>}
      <small>{t('trial.start.sms.consent')}</small>
    </section>
    <Button loading={busy === 'start'} disabled={busy !== null} onClick={() => void start()}>{t('trial.start.cta')}</Button>
    <p className="mova-start-trial__note">{t('trial.start.note')}</p>
    <button type="button" className="mova-start-trial__free" disabled={busy !== null} onClick={() => void continueFree()}>{t('trial.start.free')}</button>
  </main>;
}
