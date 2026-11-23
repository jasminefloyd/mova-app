import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Icon } from '../../components';
import { operatorUrl } from '../../app/operator-url';
import { formatMoney, isLocked, planPrice } from './plan-api';
import { usePlan } from './PlanProvider';
import { UnlockSheet } from './UnlockSheet';
import './billing.css';

/**
 * T8/T10: a feature the plan doesn't include stays visible but locked. The lock card says what unlocks it;
 * the real screen follows greyed and inert, so nothing in it can be focused or used. Server functions
 * refuse the feature anyway; this is what the stylist sees. Unlocked (or plan unknown): just the children.
 */
export function PlanGate({ feature, requiredPlan, title, body, featureName, children }: {
  feature: string; requiredPlan: 'pro' | 'ai_growth'; title: string; body: string; featureName?: string; children: ReactNode;
}) {
  const { summary } = usePlan();
  if (!isLocked(summary, feature)) return <>{children}</>;
  return <>
    <LockCard requiredPlan={requiredPlan} title={title} body={body} featureName={featureName ?? title} />
    <div className="mova-locked" aria-hidden="true" inert>{children}</div>
  </>;
}

export function LockCard({ requiredPlan, title, body, featureName }: { requiredPlan: 'pro' | 'ai_growth'; title: string; body: string; featureName: string }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { summary, businessId } = usePlan();
  const [sheet, setSheet] = useState(false);
  const trial = summary?.trial;
  const price = formatMoney(planPrice(summary, requiredPlan), i18n.resolvedLanguage);
  const canTrial = trial?.eligible === true && trial.is_owner;
  const canUnlockHere = !canTrial && trial?.card && trial.state !== 'trialing' && trial.state !== 'past_due' && trial.state !== 'admin' && summary?.billing_available;
  const unlock = () => {
    if (canTrial) navigate(operatorUrl(businessId, 'start-trial'));
    else if (canUnlockHere) setSheet(true);
    else navigate(operatorUrl(businessId, 'settings/plan'));
  };
  return <section className="mova-lock-card" aria-labelledby={`lock-${requiredPlan}-${featureName.replace(/\W+/g, '-')}`}>
    <svg className="mova-lock-card__leaf" width="120" height="120" viewBox="0 0 40 40" aria-hidden="true"><path d="M40 4C26 4 16 14 16 28C30 28 40 18 40 4Z" /></svg>
    <span className="mova-lock-card__tag"><Icon name="lock" size={14} />{t(requiredPlan === 'pro' ? 'planGate.tagPro' : 'planGate.tagGrowth')}</span>
    <h2 id={`lock-${requiredPlan}-${featureName.replace(/\W+/g, '-')}`}>{title}</h2>
    <p>{body}</p>
    <Button variant="on-dark" onClick={unlock}>{canTrial ? t('planGate.startTrial') : t(requiredPlan === 'pro' ? 'planGate.unlockPro' : 'planGate.unlockGrowth', { price })}</Button>
    <Link className="mova-lock-card__more" to={operatorUrl(businessId, 'settings/plan')}>{t('planGate.compare')}</Link>
    {sheet && <UnlockSheet open={sheet} onClose={() => setSheet(false)} initialPlan={requiredPlan} featureName={featureName} />}
  </section>;
}
