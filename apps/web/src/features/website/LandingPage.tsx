import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { MetaFunction } from 'react-router';
import { ButtonLink, Check, Eyebrow, JsonLd, useSiteShell } from './parts';
import { pageMeta, shellFromMatches, softwareLd } from './seo';

export const meta: MetaFunction = ({ matches }) => pageMeta('home', shellFromMatches(matches));

function LandingPhone({ screen, alt, className = '' }: { screen: string; alt: string; className?: string }) {
  return <div className={`mova-site__landing-phone ${className}`}>
    <img src={`/media/landing/${screen}.png`} alt={alt} loading="lazy" />
  </div>;
}

// W1 Landing. Account creation is open; every acquisition action leads to sign-up.
export default function LandingPage() {
  const { t } = useTranslation();
  const shell = useSiteShell();
  const campaignBullets = ['campaign1', 'campaign2', 'campaign3'] as const;
  const problems = [
    ['problem1Title', 'problem1Body'],
    ['problem2Title', 'problem2Body'],
    ['problem3Title', 'problem3Body'],
  ] as const;
  const steps = [['step1Title', 'step1Body'], ['step2Title', 'step2Body'], ['step3Title', 'step3Body']] as const;
  const who = [['who1Title', 'who1Body'], ['who2Title', 'who2Body'], ['who3Title', 'who3Body'], ['who4Title', 'who4Body']] as const;
  const rules = ['rule1', 'rule2', 'rule3', 'rule4', 'rule5', 'rule6'] as const;

  return <div>
    <JsonLd data={softwareLd(shell)} />
    <section className="mova-site__container mova-site__hero mova-site__landing-hero" aria-labelledby="hero-h">
      <div className="mova-site__hero-copy">
        <span className="mova-site__badge">{t('website.landing.freeBadge')}</span>
        <h1 id="hero-h" className="mova-site__h1">{t('website.landing.headlineA')} <span className="mova-site__accent">{t('website.landing.headlineB')}</span></h1>
        <p className="mova-site__lead">{t('website.landing.intro')}</p>
        <div className="mova-site__ctas">
          <ButtonLink to="/signup">{t('website.nav.startFree')}</ButtonLink>
          <Link className="mova-site__button mova-site__button--secondary" to="/features">{t('website.landing.seeHow')}</Link>
        </div>
        <p className="mova-site__muted mova-site__landing-fine">{t('website.landing.fine')}</p>
      </div>
      <div className="mova-site__landing-phones" aria-label={t('website.landing.productScreens')}>
        <LandingPhone screen="showcase" alt={t('website.landing.showcaseScreenAlt')} className="mova-site__landing-phone--back" />
        <LandingPhone screen="home" alt={t('website.landing.homeScreenAlt')} className="mova-site__landing-phone--front" />
      </div>
    </section>

    <section className="mova-site__band mova-site__landing-proof" aria-labelledby="prob-h">
      <div className="mova-site__container mova-site__section">
        <div className="mova-site__landing-proof-head">
          <h2 id="prob-h" className="mova-site__h2">{t('website.landing.problemTitle')}</h2>
          <figure className="mova-site__landing-stat">
            <span className="mova-site__display">{t('website.landing.statValue')}</span>
            <figcaption>{t('website.landing.statCaption')} <span>{t('website.landing.statSource')}</span></figcaption>
          </figure>
        </div>
        <div className="mova-site__grid mova-site__landing-problems">
          {problems.map(([title, body]) => <article className="mova-site__card mova-site__card--white" key={title}>
            <h3 className="mova-site__h3">{t(`website.landing.${title}`)}</h3>
            <p>{t(`website.landing.${body}`)}</p>
          </article>)}
        </div>
      </div>
    </section>

    <section className="mova-site__container mova-site__section" aria-labelledby="how-h">
      <div className="mova-site__stack mova-site__landing-section-head">
        <Eyebrow>{t('website.landing.howEyebrow')}</Eyebrow>
        <h2 id="how-h" className="mova-site__h2">{t('website.landing.howTitle')}</h2>
      </div>
      <ol className="mova-site__steps mova-site__landing-steps">
        {steps.map(([title, body], index) => <li className="mova-site__step" key={title}>
          <span className="mova-site__step-number">{String(index + 1).padStart(2, '0')}</span>
          <h3 className="mova-site__h3">{t(`website.landing.${title}`)}</h3>
          <p>{t(`website.landing.${body}`)}</p>
        </li>)}
      </ol>
    </section>

    <section className="mova-site__band mova-site__band--mist mova-site__landing-features" aria-label={t('website.landing.whatMovaDoes')}>
      <div className="mova-site__container mova-site__section mova-site__landing-feature-list">
        <article className="mova-site__split">
          <div className="mova-site__split-copy">
            <Eyebrow>{t('website.landing.campaignEyebrow')}</Eyebrow>
            <h2 className="mova-site__h2">{t('website.landing.campaignTitleA')} <span className="mova-site__accent">{t('website.landing.campaignTitleB')}</span></h2>
            <p className="mova-site__lead">{t('website.landing.campaignBody')}</p>
            <ul className="mova-site__bullets">{campaignBullets.map((key) => <li key={key}><Check />{t(`website.landing.${key}`)}</li>)}</ul>
          </div>
          <div className="mova-site__split-art"><LandingPhone screen="revenue" alt={t('website.landing.revenueScreenAlt')} /></div>
        </article>
        <article className="mova-site__split mova-site__split--reverse">
          <div className="mova-site__split-art"><LandingPhone screen="concierge" alt={t('website.landing.conciergeScreenAlt')} /></div>
          <div className="mova-site__split-copy">
            <Eyebrow>{t('website.landing.conciergeEyebrow')}</Eyebrow>
            <h2 className="mova-site__h2">{t('website.landing.conciergeTitleA')} <span className="mova-site__accent">{t('website.landing.conciergeTitleB')}</span></h2>
            <p className="mova-site__lead">{t('website.landing.conciergeBody')}</p>
          </div>
        </article>
        <article className="mova-site__split">
          <div className="mova-site__split-copy">
            <Eyebrow>{t('website.landing.notesEyebrow')}</Eyebrow>
            <h2 className="mova-site__h2">{t('website.landing.notesTitleA')} <span className="mova-site__accent">{t('website.landing.notesTitleB')}</span></h2>
            <p className="mova-site__lead">{t('website.landing.notesBody')}</p>
          </div>
          <div className="mova-site__split-art"><LandingPhone screen="clients" alt={t('website.landing.clientsScreenAlt')} /></div>
        </article>
      </div>
    </section>

    <section className="mova-site__container mova-site__section mova-site__landing-who" aria-labelledby="who-h">
      <h2 id="who-h" className="mova-site__h2">{t('website.landing.whoTitle')}</h2>
      <div className="mova-site__grid">
        {who.map(([title, body]) => <article className="mova-site__card mova-site__card--white" key={title}>
          <h3 className="mova-site__h3">{t(`website.landing.${title}`)}</h3>
          <p>{t(`website.landing.${body}`)}</p>
        </article>)}
      </div>
    </section>

    <section className="mova-site__band" aria-labelledby="rules-h">
      <div className="mova-site__container mova-site__section">
        <div className="mova-site__rules-layout">
          <div>
            <Eyebrow>{t('website.landing.rulesEyebrow')}</Eyebrow>
            <h2 id="rules-h" className="mova-site__h2">{t('website.landing.rulesTitle')}</h2>
            <p className="mova-site__lead">{t('website.landing.rulesBody')}</p>
          </div>
          <ul className="mova-site__rules">{rules.map((key) => <li key={key}><Check size={22} />{t(`website.landing.${key}`)}</li>)}</ul>
        </div>
      </div>
    </section>

    <section className="mova-site__container mova-site__section mova-site__landing-resources" aria-labelledby="learn-h">
      <h2 id="learn-h" className="mova-site__h2">{t('website.landing.resourcesTitle')}</h2>
      <div className="mova-site__pair">
        <Link to="/calculator"><span>{t('website.landing.calcTitle')}</span><strong>{t('website.landing.calcBody')}</strong><span>{t('website.landing.calcLink')} →</span></Link>
        <Link to="/guides"><span>{t('website.landing.guideTitle')}</span><strong>{t('website.landing.guideBody')}</strong><span>{t('website.landing.guideLink')} →</span></Link>
      </div>
    </section>

    <section className="mova-site__cta-band mova-site__landing-cta" aria-labelledby="cta-h">
      <div className="mova-site__container mova-site__section">
        <div className="mova-site__cta">
          <div className="mova-site__cta-copy">
            <h2 id="cta-h">{t('website.landing.ctaTitle')}</h2>
            <p>{t('website.landing.ctaBody')}</p>
          </div>
          <ButtonLink to="/signup">{t('website.landing.ctaCreate')}</ButtonLink>
        </div>
      </div>
    </section>
  </div>;
}
