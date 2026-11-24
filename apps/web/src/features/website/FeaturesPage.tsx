import { useTranslation } from 'react-i18next';
import type { MetaFunction } from 'react-router';
import { Icon, type IconName } from '../../components';
import { clientProfilesEnabled, conciergeEnabled, rebookingAutopilotEnabled, seatFillerEnabled, trialMarketingEnabled, walletClientCardEnabled } from '../../lib/env';
import { ButtonLink, Bullets, Eyebrow, JsonLd, useSiteShell } from './parts';
import { breadcrumbLd, pageMeta, PLAN_PRICES, shellFromMatches, softwareLd } from './seo';
import './features.css';

export const meta: MetaFunction = ({ matches }) => pageMeta('features', shellFromMatches(matches));

const essentials = [
  { key: 'showcase', id: 'showcase', icon: 'qr' },
  { key: 'booking', id: 'booking', icon: 'calendar' },
  { key: 'clients', id: 'clients', icon: 'user' },
  { key: 'money', id: 'money', icon: 'payment' },
  { key: 'clientCard', id: 'clientcard', icon: 'phone' },
  { key: 'reports', id: 'reports', icon: 'reports' },
] as const;

const growthTools = [
  { key: 'revenue', id: 'revenue', icon: 'trend', available: true },
  { key: 'seatFiller', id: 'seat-filler', icon: 'seat', available: seatFillerEnabled },
  { key: 'rebooking', id: 'rebooking', icon: 'refresh', available: rebookingAutopilotEnabled },
  { key: 'marketing', id: 'marketing', icon: 'megaphone', available: true },
  { key: 'pricePilot', id: 'pricepilot', icon: 'tag', available: true },
  { key: 'concierge', id: 'concierge', icon: 'message', available: conciergeEnabled },
] as const;

const additionalIcons = {
  payment: 'M4 6h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2ZM2 10h20m-15 4h4',
  phone: 'M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm3 17h2',
  trend: 'm3 16 6-6 4 4 7-7m-5 0h5v5',
  seat: 'M6 11V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v6M5 11h14a2 2 0 0 1 2 2v3H3v-3a2 2 0 0 1 2-2Zm0 5v5m14-5v5',
  megaphone: 'M3 9h4l5-4v14l-5-4H3Zm13 0a4 4 0 0 1 0 6m3-9a8 8 0 0 1 0 12',
  tag: 'M3 3h8l10 10a1.5 1.5 0 0 1 0 2l-6 6a1.5 1.5 0 0 1-2 0L3 11Zm4 4h.01',
} as const;
type AdditionalIcon = keyof typeof additionalIcons;

function FeatureIcon({ name }: { name: IconName | AdditionalIcon }) {
  return <span className="features-card__icon" aria-hidden="true">
    {name in additionalIcons
      ? <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={additionalIcons[name as AdditionalIcon]} /></svg>
      : <Icon name={name as IconName} size={20} />}
  </span>;
}

const growthPrice = PLAN_PRICES.find(plan => plan.key === 'growth')?.price;

export default function FeaturesPage() {
  const { t } = useTranslation();
  const shell = useSiteShell();
  const visibleEssentials = essentials.filter(({ key }) => key !== 'clientCard' || clientProfilesEnabled);
  return <div className="features-page">
    <JsonLd data={softwareLd(shell)} />
    <JsonLd data={breadcrumbLd(shell, [[t('website.nav.features'), '/features']])} />

    <section className="mova-site__container features-hero" aria-labelledby="feat-h">
      <Eyebrow>{t('website.features.eyebrow')}</Eyebrow>
      <h1 id="feat-h" className="mova-site__h1">{t('website.features.headlineA')} <span className="mova-site__accent">{t('website.features.headlineB')}</span></h1>
      <p className="mova-site__lead">{t('website.features.intro')}</p>
      <nav aria-label={t('website.features.jumpLabel')} className="mova-site__feature-anchors">
        {visibleEssentials.map(({ key, id }) => <a className="mova-site__chip" key={id} href={`#${id}`}>{t(`website.features.${key}Eyebrow`)}</a>)}
        <a className="mova-site__chip features-growth-link" href="#growth">{t('website.pricing.growth')}</a>
      </nav>
    </section>

    <section className="features-essentials" aria-labelledby="essentials-h">
      <div className="mova-site__container mova-site__section">
        <Eyebrow>{t('website.features.essentialsLabel')}</Eyebrow>
        <h2 id="essentials-h" className="mova-site__h2">{t('website.features.essentialsTitleA')} <span className="mova-site__accent">{t('website.features.essentialsTitleB')}</span></h2>
        <div className="features-essentials__grid">
          {visibleEssentials.map(({ key, id, icon }) => <article key={id} id={id} className="features-card" aria-labelledby={`${id}-h`}>
            <div className="features-card__top">
              <FeatureIcon name={icon} />
              <Eyebrow>{t(`website.features.${key}Eyebrow`)}</Eyebrow>
            </div>
            <h3 id={`${id}-h`}>{t(`website.features.${key}TitleA`)} <span className="mova-site__accent">{t(`website.features.${key}TitleB`)}</span></h3>
            <p>{t(key === 'clientCard' && !walletClientCardEnabled ? 'website.features.clientCardWebBody' : `website.features.${key}Body`)}</p>
            <Bullets items={[1, 2, 3].map(index => t(`website.features.${key}${index}`))} />
          </article>)}
        </div>
      </div>
    </section>

    <section id="growth" className="features-growth" aria-labelledby="growth-h">
      <div className="mova-site__container mova-site__section">
        <Eyebrow>{t('website.pricing.growth')}</Eyebrow>
        <h2 id="growth-h" className="mova-site__h2">{t('website.features.growthTitleA')} <span className="mova-site__accent">{t('website.features.growthTitleB')}</span></h2>
        <p className="features-growth__intro">{t('website.features.growthIntro')}</p>
        <p className="features-growth__plan"><strong>{t('website.features.growthPrice', { price: growthPrice })}</strong> {t(trialMarketingEnabled ? 'website.features.growthPlanTrial' : 'website.features.growthPlan')}</p>
        <div className="features-growth__grid">
          {growthTools.map(({ key, id, icon, available }) => <article id={id} key={id} className="features-card" aria-labelledby={`${id}-h`}>
            <div className="features-card__top">
              <FeatureIcon name={icon} />
              {!available && <span className="features-card__status">{t('website.pricing.comingSoon')}</span>}
            </div>
            <h3 id={`${id}-h`}>{t(`website.features.tools.${key}.title`)}</h3>
            <p>{t(`website.features.tools.${key}.body`)}</p>
            <Bullets items={[1, 2].map(index => t(`website.features.tools.${key}.point${index}`))} />
          </article>)}
        </div>
        <div className="features-growth__actions">
          <div>
            <p className="features-growth__actions-title">{t('website.features.approvalTitle')}</p>
            <p>{t('website.features.approvalBody')}</p>
          </div>
          <div className="features-growth__buttons">
            <ButtonLink to="/signup" variant="peach">{t(trialMarketingEnabled ? 'website.pricing.startTrial' : 'website.nav.startFree')}</ButtonLink>
            <ButtonLink to="/pricing" variant="secondary">{t('website.features.comparePlans')}</ButtonLink>
          </div>
        </div>
      </div>
    </section>

    <section className="mova-site__container features-signup" aria-labelledby="fcta-h">
      <div className="mova-site__cta">
        <div className="mova-site__cta-copy">
          <h2 id="fcta-h">{t('website.features.ctaTitle')}</h2>
          <p>{t('website.features.ctaBody')}</p>
        </div>
        <ButtonLink to="/signup">{t('website.nav.startFree')}</ButtonLink>
      </div>
    </section>
  </div>;
}
