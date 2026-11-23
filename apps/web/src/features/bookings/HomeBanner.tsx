import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../components';
import { operatorUrl } from '../../app/operator-url';
import { usePwaInstall } from '../../pwa/PwaInstallProvider';
import { dismissBanner, isBannerDismissed, type HomeBannerKind } from '../../pwa/banner-dismiss';
import { isIOS, isPhone, isStandalone } from '../../pwa/device';
import type { createMovaSupabaseClient } from '../../lib/supabase';
import { usePlan } from '../billing/PlanProvider';
import { formatDay, formatLongDay, formatMoney, planPrice } from '../billing/plan-api';
import '../billing/billing.css';

type Client = ReturnType<typeof createMovaSupabaseClient>;

/**
 * One banner slot under the Home greeting. Top wins:
 * 1. payment didn't go through (T11, can't be dismissed);
 * 2. free trial ends in 7 days or less (T4);
 * 3. install Mova (07a–07c, phones where it isn't installed);
 * 4. trial ended / AI + Growth upsell (T7 / P13).
 * With no banner, a stylist in the first 23 days of the trial sees the trial strip (T3).
 * ✕ hides a banner on this device for 15 days. Opening Mova from the Home Screen marks the account
 * installed, so the install banner stops everywhere.
 */
export function HomeBanner({ client, businessId }: { client: Client | null; businessId: string | null | undefined }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { ready, installed: installedHere, canPrompt, promptInstall } = usePwaInstall();
  const [accountInstalled, setAccountInstalled] = useState<boolean | null>(null);
  const { summary } = usePlan();
  const [dismissed, setDismissed] = useState<Record<HomeBannerKind, boolean>>({ install: true, upsell: true, trial: true, locked: true });
  const [showHelp, setShowHelp] = useState(false);
  const locale = i18n.resolvedLanguage;

  useEffect(() => { setDismissed({ install: isBannerDismissed('install'), upsell: isBannerDismissed('upsell'), trial: isBannerDismissed('trial'), locked: isBannerDismissed('locked') }); }, []);

  // Installed flag on the account: set when the app runs from the Home Screen, read everywhere else.
  useEffect(() => {
    if (!client) return;
    let active = true;
    void (async () => {
      const { data: { session } } = await client.auth.getSession();
      const userId = session?.user.id;
      if (!userId) { if (active) setAccountInstalled(false); return; }
      if (isStandalone()) {
        await client.from('mova_user_app_state').upsert({ user_id: userId, installed_at: new Date().toISOString() }, { onConflict: 'user_id', ignoreDuplicates: true });
        if (active) setAccountInstalled(true);
        return;
      }
      const { data } = await client.from('mova_user_app_state').select('installed_at').eq('user_id', userId).maybeSingle();
      if (active) setAccountInstalled(Boolean(data?.installed_at));
    })().catch(() => { if (active) setAccountInstalled(false); });
    return () => { active = false; };
  }, [client]);

  const wantsInstall = ready && accountInstalled === false && !installedHere && !isStandalone() && isPhone() && !dismissed.install;
  const trial = summary?.trial ?? null;
  const planKey = summary ? summary.current_plan?.plan_key ?? 'free' : null;
  const plan = (key: string | null | undefined) => t(`plan.names.${key ?? 'ai_growth'}`, { defaultValue: key === 'pro' ? 'Pro' : key === 'free' ? 'Free' : 'AI + Growth' });
  const toPlan = () => navigate(operatorUrl(businessId, 'settings/plan'));

  const close = (kind: HomeBannerKind) => {
    dismissBanner(kind);
    setDismissed((current) => ({ ...current, [kind]: true }));
    setShowHelp(false);
  };

  // 1. Payment didn't go through: stays until the card works (T11).
  if (trial?.state === 'past_due') {
    return <div role="alert" className="mova-home-banner mova-home-banner--alert">
      <div className="mova-home-banner__row">
        <span className="mova-home-banner__tile mova-home-banner__tile--alert" aria-hidden="true"><Icon name="info" size={20} /></span>
        <span className="mova-home-banner__copy"><strong>{t('billingBanner.failedTitle')}</strong><span>{t('billingBanner.failedBody', { date: formatDay(trial.grace_ends_at, locale), plan: plan(trial.subscription_plan) })}</span></span>
        <button type="button" className="mova-home-banner__action mova-home-banner__action--solid" onClick={toPlan}>{t('billingBanner.updateCard')}</button>
      </div>
    </div>;
  }

  // 2. Last 7 days of the trial (T4).
  if (trial?.state === 'trialing' && trial.days_left != null && trial.days_left <= 7 && !dismissed.trial) {
    const after = trial.after_trial_plan ?? 'ai_growth';
    return <div role="region" aria-label={t('billingBanner.trialRegion')} className="mova-home-banner mova-home-banner--trial">
      <div className="mova-home-banner__row">
        <span className="mova-home-banner__tile" aria-hidden="true"><span className="mova-trial-days"><b>{trial.days_left}</b><small>{t('billingBanner.days', { count: trial.days_left })}</small></span></span>
        <span className="mova-home-banner__copy"><strong>{t('billingBanner.endsTitle', { date: formatDay(trial.ends_at, locale) })}</strong>
          <span>{after === 'free' ? t('billingBanner.endsFree') : t('billingBanner.endsBody', { price: formatMoney(planPrice(summary, after === 'pro' ? 'pro' : 'ai_growth'), locale), plan: plan(after) })}</span></span>
        <button type="button" className="mova-home-banner__action mova-home-banner__action--solid" onClick={toPlan}>{t('billingBanner.manage')}</button>
        <button type="button" className="mova-home-banner__close" aria-label={t('homeBanner.dismiss')} onClick={() => close('trial')}><Icon name="close" size={18} /></button>
      </div>
    </div>;
  }

  if (wantsInstall) {
    const install = async () => {
      if (canPrompt) { if (await promptInstall()) close('install'); else setShowHelp(true); return; }
      setShowHelp((shown) => !shown);
    };
    return <div role="region" aria-label={t('homeBanner.installTitle')} className="mova-home-banner mova-home-banner--install">
      <div className="mova-home-banner__row">
        <span className="mova-home-banner__tile" aria-hidden="true">mova</span>
        <span className="mova-home-banner__copy"><strong>{t('homeBanner.installTitle')}</strong><span>{t('homeBanner.installBody')}</span></span>
        <button type="button" className="mova-home-banner__action mova-home-banner__action--solid" aria-expanded={canPrompt ? undefined : showHelp} onClick={() => void install()}>
          {canPrompt ? t('homeBanner.install') : t('homeBanner.how')}
        </button>
        <button type="button" className="mova-home-banner__close" aria-label={t('homeBanner.dismiss')} onClick={() => close('install')}><Icon name="close" size={18} /></button>
      </div>
      {showHelp && <p className="mova-home-banner__help">
        {isIOS() ? <>{t('homeBanner.iosHelpBefore')} <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 15V3M8 7l4-4 4 4" /><path d="M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8" /></svg> <strong>{t('homeBanner.share')}</strong>{t('homeBanner.iosHelpMiddle')}<strong>{t('homeBanner.addToHomeScreen')}</strong>.</>
          : t('homeBanner.browserHelp')}
      </p>}
    </div>;
  }

  // 4a. The trial ended on Free (T7).
  if (trial?.state === 'ended_free' && !dismissed.locked) {
    return <div role="region" aria-label={t('billingBanner.lockedRegion')} className="mova-home-banner mova-home-banner--locked">
      <div className="mova-home-banner__row">
        <span className="mova-home-banner__tile mova-home-banner__tile--growth mova-home-banner__tile--lock" aria-hidden="true">
          <svg className="mova-home-banner__leaf" width="40" height="40" viewBox="0 0 40 40" fill="none"><path d="M40 4C26 4 16 14 16 28C30 28 40 18 40 4Z" /></svg>
          <Icon name="lock" size={18} />
        </span>
        <span className="mova-home-banner__copy"><strong>{t('billingBanner.lockedTitle')}</strong><span>{t('billingBanner.lockedBody')}</span></span>
        <button type="button" className="mova-home-banner__action" onClick={toPlan}>{t('billingBanner.unlock')}</button>
        <button type="button" className="mova-home-banner__close" aria-label={t('homeBanner.dismiss')} onClick={() => close('locked')}><Icon name="close" size={18} /></button>
      </div>
    </div>;
  }

  // T3: the trial strip when no banner is showing (days 1–23).
  if (trial?.state === 'trialing' && trial.days_left != null && trial.days_left > 7) {
    const used = Math.min(100, Math.max(4, Math.round(((trial.trial_days - trial.days_left) / trial.trial_days) * 100)));
    const after = trial.after_trial_plan ?? 'ai_growth';
    return <div role="region" aria-label={t('billingBanner.trialRegion')} className="mova-trial-strip">
      <span className="mova-trial-strip__dot" aria-hidden="true"><Icon name="sparkle" size={16} /></span>
      <span className="mova-trial-strip__copy">
        <strong>{t('billingBanner.stripTitle', { count: trial.days_left })}</strong>
        <span>{after === 'free' ? t('billingBanner.stripFree', { date: formatLongDay(trial.ends_at, locale) }) : t('billingBanner.stripThen', { price: formatMoney(planPrice(summary, after === 'pro' ? 'pro' : 'ai_growth'), locale), date: formatDay(trial.ends_at, locale) })}</span>
        <span className="mova-trial-meter" aria-hidden="true"><i style={{ width: `${used}%` }} /></span>
      </span>
      <a href={operatorUrl(businessId, 'settings/plan')} onClick={(event) => { event.preventDefault(); toPlan(); }}>{t('billingBanner.plan')}</a>
    </div>;
  }

  // 4b. AI + Growth upsell (P13): not during a trial, a failed payment or an admin-assigned plan.
  if (planKey && planKey !== 'ai_growth' && !dismissed.upsell && trial?.state !== 'admin' && trial?.state !== 'trialing') {
    return <div role="region" aria-label={t('homeBanner.upsellRegion')} className="mova-home-banner mova-home-banner--upsell">
      <div className="mova-home-banner__row">
        <span className="mova-home-banner__tile mova-home-banner__tile--growth" aria-hidden="true">
          <svg className="mova-home-banner__leaf" width="40" height="40" viewBox="0 0 40 40" fill="none"><path d="M40 4C26 4 16 14 16 28C30 28 40 18 40 4Z" /></svg>
          <Icon name="sparkle" size={20} />
        </span>
        <span className="mova-home-banner__copy"><strong>{t('homeBanner.upsellTitle')}</strong><span>{t('homeBanner.upsellBody')}</span></span>
        <button type="button" className="mova-home-banner__action" onClick={toPlan}>{trial?.eligible && trial.is_owner ? t('billingBanner.tryFree') : t('homeBanner.upgrade')}</button>
        <button type="button" className="mova-home-banner__close" aria-label={t('homeBanner.dismiss')} onClick={() => close('upsell')}><Icon name="close" size={18} /></button>
      </div>
    </div>;
  }
  return null;
}
