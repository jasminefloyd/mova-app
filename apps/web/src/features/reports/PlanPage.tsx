import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Card, ErrorState, Icon, ScreenHeader } from '../../components';
import { operatorUrl } from '../../app/operator-url';
import { usePlan } from '../billing/PlanProvider';
import { UnlockSheet } from '../billing/UnlockSheet';
import { cardLabel, formatDay, formatLongDay, formatMoney, planCall, planPrice, PlanCallError, type PlanKey, type PlanSummary } from '../billing/plan-api';
import '../billing/billing.css';

export const formatFee = (bps: number, locale?: string) => new Intl.NumberFormat(locale, { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 2 }).format(bps / 10000);

/**
 * Settings › Plan (board 22 with O10's prices) and the free trial:
 * - trialing: T5, the trial card and "After your trial" (AI + Growth / Pro / Free);
 * - trial ended on Free: T6, what's locked and saved, Unlock Pro / AI + Growth on the card on file;
 * - never trialed: the trial offer on top of the plans;
 * - paid: the plans, plus a payment-failed notice while Stripe retries.
 * Every change goes to Stripe first (plan-management, subscription-checkout, the billing portal).
 */
export function PlanPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { client, businessId, summary: data, loading, error, refresh, setSummary } = usePlan();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<'confirmed' | 'cancelled' | 'failed' | 'saved' | null>(null);
  const [unlock, setUnlock] = useState<'pro' | 'ai_growth' | null>(null);
  const confirmed = useRef(false);
  const locale = i18n.resolvedLanguage;
  const trial = data?.trial ?? null;

  const call = useCallback((name: string, body: Record<string, unknown>) => planCall(client, businessId, name, body), [client, businessId]);

  useEffect(() => {
    if (!client || !businessId) return;
    const params = new URLSearchParams(location.search);
    const sessionId = params.get('session_id');
    if (params.get('billing') === 'return' && !confirmed.current) {
      confirmed.current = true;
      void (async () => {
        try { setSummary(await call('plan-management', { action: 'refresh' }) as unknown as PlanSummary); }
        catch (failure) { if (!(failure instanceof PlanCallError && failure.code === 'NO_SUBSCRIPTION')) setNotice('failed'); await refresh(); }
        navigate(location.pathname, { replace: true });
      })();
      return;
    }
    if (params.get('checkout') === 'success' && sessionId && !confirmed.current) {
      confirmed.current = true;
      void (async () => {
        try { setSummary(await call('plan-management', { action: 'confirm', session_id: sessionId }) as unknown as PlanSummary); setNotice('confirmed'); }
        catch { setNotice('failed'); await refresh(); }
        navigate(location.pathname, { replace: true });
      })();
      return;
    }
    if (params.get('checkout') === 'cancelled') { setNotice('cancelled'); navigate(location.pathname, { replace: true }); }
  }, [client, businessId, call, location.pathname, location.search, navigate, refresh, setSummary]);

  const openPortal = async () => {
    setBusy('portal'); setNotice(null);
    try {
      const result = await call('subscription-portal', { return_path: location.pathname });
      if (typeof result.portal_url !== 'string' || !result.portal_url.startsWith('https://')) throw new Error('NO_URL');
      window.location.assign(result.portal_url);
    } catch { setNotice('failed'); setBusy(null); }
  };
  const startTrial = () => navigate(operatorUrl(businessId, 'start-trial'));
  const choose = async (plan: string) => {
    setBusy(plan); setNotice(null);
    try {
      const paid = data?.subscription && data.subscription.livemode === (data.billing_mode === 'live') && ['active', 'trialing', 'past_due'].includes(data.subscription.status);
      if (paid || plan === 'free') { await openPortal(); return; }
      const result = await call('subscription-checkout', { plan_key: plan, return_path: location.pathname });
      const target = result.checkout_url as string | undefined;
      if (!target?.startsWith('https://')) throw new Error('NO_URL');
      window.location.assign(target);
    } catch { setNotice('failed'); setBusy(null); }
  };
  const afterTrial = async (plan: PlanKey) => {
    if (!data || !trial || trial.after_trial_plan === plan) return;
    const previous = data;
    setSummary({ ...data, trial: { ...trial, after_trial_plan: plan, cancel_at_period_end: plan === 'free' } });
    setBusy(`after-${plan}`); setNotice(null);
    try { setSummary(await call('plan-management', { action: 'after_trial', plan }) as unknown as PlanSummary); setNotice('saved'); }
    catch { setSummary(previous); setNotice('failed'); }
    finally { setBusy(null); }
  };

  const price = (minor: number) => formatMoney(minor, locale);
  const name = (key: string, fallback?: string) => t(`plan.names.${key}`, { defaultValue: fallback ?? key });
  const card = cardLabel(trial?.card ?? null);

  const trialCard = trial?.state === 'trialing' && <>
    <section className="mova-trial-card" aria-labelledby="trial-card-title">
      <div className="mova-trial-card__top"><h2 id="trial-card-title">{t('trial.plan.title')}</h2><span className="mova-trial-card__days">{t('trial.plan.daysLeft', { count: trial.days_left ?? 0 })}</span></div>
      <span className="mova-trial-meter" aria-hidden="true"><i style={{ width: `${Math.min(100, Math.max(4, Math.round(((trial.trial_days - (trial.days_left ?? 0)) / trial.trial_days) * 100)))}%` }} /></span>
      <dl>
        <div><dt>{t('trial.plan.ends')}</dt><dd>{formatLongDay(trial.ends_at, locale)}</dd></div>
        <div><dt>{t('trial.plan.then')}</dt><dd>{trial.after_trial_plan === 'free' ? t('trial.plan.thenFree') : `${t('trial.plan.perMonth', { price: price(planPrice(data, trial.after_trial_plan === 'pro' ? 'pro' : 'ai_growth')) })}${card ? ` · ${card}` : ''}`}</dd></div>
        <div><dt>{t('trial.plan.feeUntil')}</dt><dd>{t('trial.plan.feeFree', { fee: formatFee(data?.plans.find((plan) => plan.plan_key === 'free')?.mova_fee_basis_points ?? 150, locale) })}</dd></div>
      </dl>
      <button type="button" className="mova-link-button" disabled={busy !== null} onClick={() => void openPortal()}>{t('trial.plan.updateCard')}</button>
    </section>
    <h2 className="mova-section-label">{t('trial.plan.afterTitle')}</h2>
    <div className="mova-pick" role="radiogroup" aria-label={t('trial.plan.afterTitle')}>
      {(['ai_growth', 'pro', 'free'] as const).map((key) => {
        const on = (trial.after_trial_plan ?? 'ai_growth') === key;
        const fee = formatFee(data?.plans.find((plan) => plan.plan_key === key)?.mova_fee_basis_points ?? 150, locale);
        return <label key={key} className={`mova-pick__opt${on ? ' is-on' : ''}`}>
          <input type="radio" name="after-trial" value={key} checked={on} disabled={busy !== null} onChange={() => void afterTrial(key)} />
          <span className="mova-pick__rad" aria-hidden="true"><i /></span>
          <span className="mova-pick__copy">
            <span className="mova-pick__row"><strong>{t(`trial.plan.after.${key}.title`)}</strong><span>{key === 'free' ? price(0) : t('trial.plan.perMonthShort', { price: price(planPrice(data, key)) })}</span></span>
            <small>{t(`trial.plan.after.${key}.body`, { fee })}</small>
          </span>
        </label>;
      })}
    </div>
    <p className="mova-plan-footnote">{t('trial.plan.reminders', { date: formatDay(trial.ends_at, locale) })}</p>
  </>;

  const endedCard = trial?.state === 'ended_free' && <section className="mova-trial-card mova-trial-card--ended" aria-labelledby="trial-ended-title">
    <h2 id="trial-ended-title">{t('trial.plan.endedTitle', { date: formatDay(trial.ended_at ?? trial.ends_at, locale) })}</h2>
    <p>{t('trial.plan.endedBody')}</p>
    {card && <p className="mova-card-line"><Icon name="lock" size={16} /><span>{t('trial.plan.unlockCharges', { card })}</span></p>}
  </section>;

  const offerCard = trial && (trial.state === 'eligible' || trial.state === 'declined') && trial.is_owner && <section className="mova-trial-card mova-trial-card--offer" aria-labelledby="trial-offer-title">
    <h2 id="trial-offer-title">{t('trial.plan.offerTitle', { days: trial.trial_days })}</h2>
    <p>{t('trial.plan.offerBody')}</p>
    <Button variant="on-dark" onClick={startTrial}>{t('trial.plan.offerCta')}</Button>
  </section>;

  const pastDue = trial?.state === 'past_due' && <section className="mova-home-banner mova-home-banner--alert" role="alert">
    <div className="mova-home-banner__row">
      <span className="mova-home-banner__tile mova-home-banner__tile--alert" aria-hidden="true"><Icon name="info" size={20} /></span>
      <span className="mova-home-banner__copy"><strong>{t('billingBanner.failedTitle')}</strong><span>{t('billingBanner.failedBody', { date: formatDay(trial.grace_ends_at, locale), plan: name(trial.subscription_plan ?? 'ai_growth') })}</span></span>
      <button type="button" className="mova-home-banner__action mova-home-banner__action--solid" disabled={busy !== null} onClick={() => void openPortal()}>{t('billingBanner.updateCard')}</button>
    </div>
  </section>;

  const endedOnFree = trial?.state === 'ended_free' || (trial?.state === 'free' && Boolean(trial.card));
  return <main className="mova-page mova-plan-page">
    <ScreenHeader title={t('plan.title')} onBack={() => navigate(operatorUrl(businessId, 'settings'))} backLabel={t('plan.back')} />
    <h1>{t('plan.title')}</h1>
    {notice && <p role={notice === 'failed' ? 'alert' : 'status'} className={`mova-plan-notice is-${notice === 'saved' ? 'confirmed' : notice}`}>{t(`plan.notice.${notice}`)}</p>}
    {loading && !data ? <p role="status" aria-busy="true">{t('plan.loading')}</p>
      : error && !data ? <ErrorState title={t('plan.error')} retryLabel={t('plan.retry')} onRetry={() => void refresh()} />
      : data && <>
        {pastDue}{trialCard}{endedCard}{offerCard}
        {trial?.state !== 'trialing' && <div className="mova-plan-list">{data.plans.map((plan) => {
          const current = plan.plan_key === data.current_plan.plan_key;
          const label = name(plan.plan_key, plan.display_name);
          const action = endedOnFree && plan.plan_key !== 'free' && trial?.card
            ? <Button disabled={!data.billing_available || busy !== null} variant={plan.plan_key === 'ai_growth' ? 'on-dark' : 'primary'} onClick={() => setUnlock(plan.plan_key as 'pro' | 'ai_growth')}>{t('trial.plan.unlock', { plan: label })}</Button>
            : !current && trial?.state !== 'admin' && <Button disabled={!data.billing_available || busy !== null} loading={busy === plan.plan_key} variant={plan.plan_key === 'ai_growth' ? 'on-dark' : 'primary'} onClick={() => void choose(plan.plan_key)}>{t('plan.choose', { plan: label })}</Button>;
          return <Card key={plan.plan_key} className={`mova-plan-card${current ? ' is-current' : ''}${plan.plan_key === 'ai_growth' ? ' mova-plan-card--growth' : ''}`}>
            <header><h2>{label}</h2>{current && <span className="mova-plan-current">{t('plan.current')}</span>}</header>
            <p className="mova-plan-price"><strong>{price(plan.monthly_price_minor)}</strong><span>{t('plan.perMonth')} + {formatFee(plan.mova_fee_basis_points, locale)} {t('plan.perMovaPayment')}</span></p>
            {!current && action}
          </Card>;
        })}</div>}
        {!data.billing_available && <p className="mova-plan-footnote">{t('plan.billingUnavailable')}</p>}
        {data.billing_available && <p className="mova-plan-footnote">{t(data.billing_mode === 'live' ? 'plan.liveMode' : 'plan.testMode')}</p>}
        <p className="mova-plan-footnote">{t('plan.feeNote')}</p>
      </>}
    {unlock && <UnlockSheet open onClose={() => setUnlock(null)} initialPlan={unlock} />}
  </main>;
}
export default PlanPage;
