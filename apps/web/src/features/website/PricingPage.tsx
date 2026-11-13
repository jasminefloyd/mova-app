import { Trans, useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { MetaFunction } from 'react-router';
import { ButtonLink, JsonLd, useSiteShell } from './parts';
import { breadcrumbLd, faqLd, pageMeta, shellFromMatches, softwareLd } from './seo';

export const meta: MetaFunction = ({ matches }) => pageMeta('pricing', shellFromMatches(matches));

// W3 Pricing. Prices are $0 / $19 / $39 and the fee column is per the boards. No "proposed" badge.
const plans = [
  { key: 'free', price: '$0', fee: 'feeFree', featured: false },
  { key: 'pro', price: '$19', fee: 'feePro', featured: true },
  { key: 'growth', price: '$39', fee: 'feeGrowth', featured: false },
] as const;
const includedFeatures = {
  free: ['page', 'calendar', 'unlimited', 'clientNotes', 'guestBooking', 'payments', 'bookingEmail', 'languages', 'basicReports', 'privateReviews'],
  pro: ['publicReviews', 'advancedReports', 'seatFiller', 'textAutopilot', 'textReminders', 'rebookingAssist', 'googleCalendar', 'customCover'],
  growth: ['rebookingAutopilot', 'concierge', 'instagramConcierge', 'walletCard', 'revenueCenter', 'missedCallTextback'],
} as const;

export default function PricingPage() {
  const { t } = useTranslation();
  const shell = useSiteShell();
  const facts = [
    ['always1Label', 'always1Value'],
    ['always2Label', 'always2Value'],
    ['always3Label', 'always3Value'],
  ] as const;
  const faqs = [1, 2, 3, 4] as const;

  return <div>
    <JsonLd data={softwareLd(shell, { withOffers: true })} />
    <JsonLd data={faqLd(shell.locale)} />
    <JsonLd data={breadcrumbLd(shell, [[t('website.nav.pricing'), '/pricing']])} />
    <section className="mova-site__container mova-site__centered" aria-labelledby="price-h" style={{ paddingBlock: 'clamp(40px, 6vw, 80px) 32px' }}>
      <h1 id="price-h" className="mova-site__h1" style={{ maxWidth: 820, fontSize: 'clamp(38px, 5vw, 60px)' }}>{t('website.pricing.headlineA')} <span className="mova-site__accent">{t('website.pricing.headlineB')}</span></h1>
      <p className="mova-site__lead" style={{ maxWidth: 620, fontSize: 'clamp(17px, 1.6vw, 19px)' }}>{t('website.pricing.intro')}</p>
    </section>

    <section className="mova-site__container" aria-label={t('website.pricing.headlineA')} style={{ paddingBottom: 'clamp(48px, 6vw, 80px)' }}>
      <div className="mova-site__plans">
        {plans.map(({ key, price, fee, featured }) => <article key={key} aria-labelledby={`plan-${key}`} className={`mova-site__plan${featured ? ' mova-site__plan--featured' : ''}`}>
          <div className="mova-site__plan-head">
            <h2 id={`plan-${key}`}>{t(`website.pricing.${key}`)}</h2>
            {featured && <span className="mova-site__plan-badge">{t('website.pricing.recommended')}</span>}
          </div>
          <p className="mova-site__price"><strong>{price}</strong><span>{t('website.pricing.perMonth')}</span></p>
          <p><strong>{t(`website.pricing.${fee}`)}</strong></p>
          <div className="mova-site__plan-features">
            <p className="mova-site__feature-heading">{t('website.pricing.includedTitle')}</p>
            <ul>{includedFeatures[key].map((feature) => <li key={feature}>{t(`website.pricing.features.${feature}`)}</li>)}</ul>
            {key === 'growth' && <p className="mova-site__coming-soon"><span>{t('website.pricing.comingSoon')}</span> {t('website.pricing.features.aiPricePilot')}</p>}
          </div>
          <ButtonLink to="/signup" variant={featured ? 'peach' : 'plan'}>{t('website.pricing.startFree')}</ButtonLink>
        </article>)}
      </div>
      <p className="mova-site__fine">{t('website.pricing.processing')}</p>
      <p className="mova-site__fine">{t('website.pricing.rollout')}</p>
    </section>

    <section className="mova-site__band" aria-labelledby="always-h">
      <div className="mova-site__container mova-site__section" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <h2 id="always-h" className="mova-site__h2" style={{ fontSize: 'clamp(26px, 3vw, 36px)' }}>{t('website.pricing.alwaysTitle')}</h2>
        <div className="mova-site__fact-grid">
          {facts.map(([label, value]) => <div className="mova-site__fact" key={label}><span>{t(`website.pricing.${label}`)}</span><strong>{t(`website.pricing.${value}`)}</strong></div>)}
        </div>
      </div>
    </section>

    <section className="mova-site__narrow mova-site__section" aria-labelledby="faq-h" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <h2 id="faq-h" className="mova-site__h2" style={{ fontSize: 'clamp(26px, 3vw, 36px)' }}>{t('website.pricing.faqTitle')}</h2>
      <div className="mova-site__faq">
        {faqs.map((index) => <details key={index} open={index === 1}>
          <summary>{t(`website.pricing.faq${index}Q`)}</summary>
          {index === 4
            ? <p><Trans i18nKey="website.pricing.faq4A" components={{ calc: <Link to="/calculator" /> }} /></p>
            : <p>{t(`website.pricing.faq${index}A`)}</p>}
        </details>)}
      </div>
    </section>
  </div>;
}
