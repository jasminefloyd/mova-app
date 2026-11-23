import { useState } from 'react';
import { useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Icon, Sheet } from '../../components';
import { cardLabel, formatMoney, planCall, planPrice, PlanCallError, type PlanSummary } from './plan-api';
import { usePlan } from './PlanProvider';

/** T9: pick Pro or AI + Growth and pay with the card on file. Strong customer authentication falls back to Checkout. */
export function UnlockSheet({ open, onClose, initialPlan, featureName, onUnlocked }: {
  open: boolean; onClose: () => void; initialPlan: 'pro' | 'ai_growth'; featureName?: string; onUnlocked?: (plan: 'pro' | 'ai_growth') => void;
}) {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const { client, businessId, summary, setSummary } = usePlan();
  const [plan, setPlan] = useState<'pro' | 'ai_growth'>(initialPlan);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const price = (key: 'pro' | 'ai_growth') => formatMoney(planPrice(summary, key), i18n.resolvedLanguage);
  const card = cardLabel(summary?.trial?.card ?? null);
  const name = (key: 'pro' | 'ai_growth') => t(`plan.names.${key}`, { defaultValue: key === 'pro' ? 'Pro' : 'AI + Growth' });

  const changeCard = async () => {
    try {
      const result = await planCall(client, businessId, 'subscription-portal', { return_path: location.pathname });
      if (typeof result.portal_url === 'string' && result.portal_url.startsWith('https://')) window.location.assign(result.portal_url);
    } catch { setError(t('unlock.error')); }
  };
  const pay = async () => {
    setBusy(true); setError(null);
    try {
      const next = await planCall(client, businessId, 'plan-management', { action: 'unlock', plan, return_path: location.pathname }) as unknown as PlanSummary;
      setSummary(next);
      setDone(t('unlock.done', { plan: name(plan), feature: featureName ?? t('unlock.yourSetup') }));
      onUnlocked?.(plan);
      window.setTimeout(onClose, 1600);
    } catch (failure) {
      if (failure instanceof PlanCallError && failure.code === 'PAYMENT_NEEDS_ACTION' && typeof failure.body.checkout_url === 'string' && failure.body.checkout_url.startsWith('https://')) {
        window.location.assign(failure.body.checkout_url);
        return;
      }
      setError(t('unlock.error'));
    } finally { setBusy(false); }
  };

  return <Sheet open={open} title={featureName ? t('unlock.titleFeature', { feature: featureName }) : t('unlock.title')} closeLabel={t('unlock.close')} onClose={onClose}>
    <div className="mova-unlock">
      <p>{t('unlock.lead')}</p>
      <div className="mova-pick" role="radiogroup" aria-label={t('unlock.choose')}>
        {(['pro', 'ai_growth'] as const).map((key) => <label key={key} className={`mova-pick__opt${plan === key ? ' is-on' : ''}`}>
          <input type="radio" name="unlock-plan" value={key} checked={plan === key} onChange={() => setPlan(key)} />
          <span className="mova-pick__rad" aria-hidden="true"><i /></span>
          <span className="mova-pick__copy">
            <span className="mova-pick__row"><strong>{name(key)}</strong><span>{t('unlock.perMonth', { price: price(key) })}</span></span>
            <small>{t(key === 'pro' ? 'unlock.proAdds' : 'unlock.growthAdds')}</small>
          </span>
        </label>)}
      </div>
      {card && <p className="mova-card-line"><Icon name="lock" size={16} />{t('unlock.payWith')} <b>{card}</b> · <button type="button" className="mova-link-button" onClick={() => void changeCard()}>{t('unlock.change')}</button></p>}
      {error && <p role="alert" className="mova-plan-notice is-failed">{error}</p>}
      {done && <p role="status" className="mova-plan-notice">{done}</p>}
      <Button loading={busy} disabled={busy || Boolean(done)} onClick={() => void pay()}>{t('unlock.pay', { price: price(plan) })}</Button>
      <p className="mova-unlock__note">{t('unlock.note')}</p>
    </div>
  </Sheet>;
}
