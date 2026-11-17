import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../components';
import { operatorUrl } from '../../app/operator-url';
import { usePwaInstall } from '../../pwa/PwaInstallProvider';
import { dismissBanner, isBannerDismissed, type HomeBannerKind } from '../../pwa/banner-dismiss';
import { isIOS, isPhone, isStandalone } from '../../pwa/device';
import type { createMovaSupabaseClient } from '../../lib/supabase';

type Client = ReturnType<typeof createMovaSupabaseClient>;

/**
 * One banner slot under the Home greeting (07a–07c, P13):
 * - phones where Mova isn't installed get the install banner;
 * - everyone else (desktop included) gets the AI Growth banner unless they're already on AI Growth;
 * - ✕ hides either one on this device for 15 days.
 * Opening Mova from the Home Screen marks the account installed, so the install banner stops everywhere.
 */
export function HomeBanner({ client, businessId }: { client: Client | null; businessId: string | null | undefined }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { ready, installed: installedHere, canPrompt, promptInstall } = usePwaInstall();
  const [accountInstalled, setAccountInstalled] = useState<boolean | null>(null);
  const [planKey, setPlanKey] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Record<HomeBannerKind, boolean>>({ install: true, upsell: true });
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => { setDismissed({ install: isBannerDismissed('install'), upsell: isBannerDismissed('upsell') }); }, []);

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

  useEffect(() => {
    if (!client || !businessId || wantsInstall || accountInstalled === null) return;
    let active = true;
    void client.functions.invoke<{ data?: { current_plan?: { plan_key?: string } } }>('plan-management', { body: { action: 'get' }, headers: { 'x-mova-artist-business-id': businessId } })
      .then(({ data, error }) => { if (active && !error) setPlanKey(data?.data?.current_plan?.plan_key ?? 'free'); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [accountInstalled, businessId, client, wantsInstall]);

  const close = (kind: HomeBannerKind) => {
    dismissBanner(kind);
    setDismissed((current) => ({ ...current, [kind]: true }));
    setShowHelp(false);
  };

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

  if (planKey && planKey !== 'ai_growth' && !dismissed.upsell) {
    return <div role="region" aria-label={t('homeBanner.upsellRegion')} className="mova-home-banner mova-home-banner--upsell">
      <div className="mova-home-banner__row">
        <span className="mova-home-banner__tile mova-home-banner__tile--growth" aria-hidden="true">
          <svg className="mova-home-banner__leaf" width="40" height="40" viewBox="0 0 40 40" fill="none"><path d="M40 4C26 4 16 14 16 28C30 28 40 18 40 4Z" /></svg>
          <Icon name="sparkle" size={20} />
        </span>
        <span className="mova-home-banner__copy"><strong>{t('homeBanner.upsellTitle')}</strong><span>{t('homeBanner.upsellBody')}</span></span>
        <button type="button" className="mova-home-banner__action" onClick={() => navigate(operatorUrl(businessId, 'settings/plan'))}>{t('homeBanner.upgrade')}</button>
        <button type="button" className="mova-home-banner__close" aria-label={t('homeBanner.dismiss')} onClick={() => close('upsell')}><Icon name="close" size={18} /></button>
      </div>
    </div>;
  }
  return null;
}
