import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Icon } from '../../components';

const TICK_MS = 850;

function prefersReducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/**
 * Step 7: not a form. The page is already published when this mounts; the checklist animates while the
 * workspace finishes loading, then the stylist gets their live link and the next step (Settings).
 */
export function WelcomeStep({ name, handle, locationName, onSettings, onHome }: {
  name: string; handle: string; locationName: string; onSettings: () => void; onHome: () => void;
}) {
  const { t } = useTranslation();
  const items = [t('onboarding.welcomeStepAccount'), t('onboarding.welcomeStepPage'), t('onboarding.welcomeStepBooking')];
  const [done, setDone] = useState(() => (prefersReducedMotion() ? items.length : 0));
  const ready = done >= items.length;

  useEffect(() => {
    if (ready) return;
    const timer = window.setTimeout(() => setDone((value) => value + 1), TICK_MS);
    return () => window.clearTimeout(timer);
  }, [done, ready]);

  const link = `mova-beauty.co/a/${handle}`;

  return <div className="mova-onboarding-page mova-welcome">
    <header className="mova-onboarding-header">
      <span className="mova-wordmark" aria-label="mova">mova</span>
      <p>{t('onboarding.tagline')}</p>
    </header>
    <main className="mova-page mova-onboarding-content">
      <section className="mova-welcome__setup" aria-labelledby="mova-welcome-h" aria-live="polite">
        <div className={`mova-welcome__mark${ready ? ' is-ready' : ''}`} aria-hidden="true">
          <svg viewBox="0 0 96 96" width="96" height="96">
            <circle className="mova-welcome__ring" cx="48" cy="48" r="42" />
            <path className="mova-welcome__tick" d="M30 49 l12 12 l24 -26" />
          </svg>
        </div>
        <h1 id="mova-welcome-h">{ready ? t('onboarding.welcomeTitle', { name }) : t('onboarding.welcomeSettingUp')}</h1>
        <ol className="mova-welcome__steps">
          {items.map((label, index) => <li key={label} className={index < done ? 'is-done' : index === done ? 'is-active' : ''}>
            <span className="mova-welcome__dot" aria-hidden="true">{index < done ? <Icon name="check" size={14} /> : null}</span>
            <span>{label}</span>
          </li>)}
        </ol>
      </section>

      {ready && <div className="mova-welcome__next">
        <div className="mova-welcome__live">
          <small>{t('onboarding.welcomeLive')}</small>
          <a href={`https://${link}`} target="_blank" rel="noreferrer">{link}</a>
        </div>
        <div className="mova-welcome__card">
          <h2>{t('onboarding.nextTitle')}</h2>
          <p><strong>{t('onboarding.nextSettingsTitle')}</strong></p>
          <p>{locationName ? t('onboarding.nextSettingsBody', { location: locationName }) : t('onboarding.nextSettingsBodyNoLocation')}</p>
          <Button type="button" onClick={onSettings}>{t('onboarding.goToSettings')}</Button>
          <Button type="button" variant="ghost" onClick={onHome}>{t('onboarding.goHome')}</Button>
        </div>
      </div>}
    </main>
  </div>;
}
