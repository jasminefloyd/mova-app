import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Card, ErrorState, ScreenHeader } from '../../components';
import { useArtistBusiness } from '../settings/useArtistBusiness';
import { operatorUrl } from '../../app/operator-url';

type Plan = { plan_key: string; display_name: string; monthly_price_minor: number; mova_fee_basis_points: number; status: string; entitlements: Record<string, unknown> };
type Summary = { current_plan: Plan; plans: Plan[]; usage: Record<string, number>; subscription?: { plan_key: string; status: string } | null; billing_available?: boolean };

export const formatFee = (bps: number, locale?: string) => new Intl.NumberFormat(locale, { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 2 }).format(bps / 10000);

/** Board 22 with O10's confirmed prices. Plan changes go through Stripe Billing in test mode (task 5.8). */
export function PlanPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { client, businessId, loading: identityLoading } = useArtistBusiness();
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<'confirmed' | 'cancelled' | 'failed' | null>(null);
  const confirmed = useRef(false);

  const call = useCallback(async (name: string, body: Record<string, unknown>) => {
    if (!client || !businessId) throw new Error('NO_CLIENT');
    const { data: envelope, error: functionError } = await client.functions.invoke<{ data?: Record<string, unknown> }>(name, { body, headers: { 'x-mova-artist-business-id': businessId } });
    if (functionError || !envelope?.data) throw new Error('FAILED');
    return envelope.data;
  }, [client, businessId]);

  const load = useCallback(async () => {
    setLoading(true); setError(false);
    try { const summary = await call('plan-management', { action: 'get' }) as unknown as Summary; if (!summary.plans) throw new Error(); setData(summary); }
    catch { setError(true); } finally { setLoading(false); }
  }, [call]);

  useEffect(() => {
    if (!client || !businessId) return;
    const params = new URLSearchParams(location.search);
    const sessionId = params.get('session_id');
    if (params.get('checkout') === 'success' && sessionId && !confirmed.current) {
      confirmed.current = true;
      void (async () => {
        try { await call('plan-management', { action: 'confirm', session_id: sessionId }); setNotice('confirmed'); } catch { setNotice('failed'); }
        navigate(location.pathname, { replace: true });
        await load();
      })();
      return;
    }
    if (params.get('checkout') === 'cancelled') { setNotice('cancelled'); navigate(location.pathname, { replace: true }); }
    void load();
  }, [client, businessId, call, load, location.pathname, location.search, navigate]);

  const choose = async (plan: string) => {
    setBusy(plan); setNotice(null);
    try {
      const paid = data?.subscription && ['active', 'trialing', 'past_due'].includes(data.subscription.status);
      const result = paid || plan === 'free'
        ? await call('subscription-portal', { return_path: location.pathname })
        : await call('subscription-checkout', { plan_key: plan, return_path: location.pathname });
      const target = (result.checkout_url ?? result.portal_url) as string | undefined;
      if (!target?.startsWith('https://')) throw new Error('NO_URL');
      window.location.assign(target);
    } catch { setNotice('failed'); setBusy(null); }
  };

  const price = (minor: number) => new Intl.NumberFormat(i18n.resolvedLanguage, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(minor / 100);
  return <main className="mova-page mova-plan-page">
    <ScreenHeader title={t('plan.title')} onBack={() => navigate(operatorUrl(businessId, 'settings'))} backLabel={t('plan.back')} />
    <h1>{t('plan.title')}</h1>
    {notice && <p role={notice === 'failed' ? 'alert' : 'status'} className={`mova-plan-notice is-${notice}`}>{t(`plan.notice.${notice}`)}</p>}
    {identityLoading || loading ? <p role="status" aria-busy="true">{t('plan.loading')}</p>
      : error ? <ErrorState title={t('plan.error')} retryLabel={t('plan.retry')} onRetry={() => void load()} />
      : <>
        <div className="mova-plan-list">{data?.plans.map((plan) => {
          const current = plan.plan_key === data.current_plan.plan_key;
          const name = t(`plan.names.${plan.plan_key}`, { defaultValue: plan.display_name });
          return <Card key={plan.plan_key} className={`mova-plan-card${current ? ' is-current' : ''}${plan.plan_key === 'ai_growth' ? ' mova-plan-card--growth' : ''}`}>
            <header><h2>{name}</h2>{current && <span className="mova-plan-current">{t('plan.current')}</span>}</header>
            <p className="mova-plan-price"><strong>{price(plan.monthly_price_minor)}</strong><span>{t('plan.perMonth')} + {formatFee(plan.mova_fee_basis_points, i18n.resolvedLanguage)} {t('plan.perMovaPayment')}</span></p>
            {!current && <Button disabled={!data.billing_available || busy !== null} loading={busy === plan.plan_key} variant={plan.plan_key === 'ai_growth' ? 'on-dark' : 'primary'} onClick={() => void choose(plan.plan_key)}>{t('plan.choose', { plan: name })}</Button>}
          </Card>;
        })}</div>
        {!data?.billing_available && <p className="mova-plan-footnote">{t('plan.billingUnavailable')}</p>}
        {data?.billing_available && <p className="mova-plan-footnote">{t('plan.testMode')}</p>}
        <p className="mova-plan-footnote">{t('plan.feeNote')}</p>
      </>}
  </main>;
}
export default PlanPage;
