import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ButtonLink, Check, Eyebrow, PhoneFrame } from './parts';

// W1 Landing. Every call to action goes to sign-up. There is no waitlist.
export default function LandingPage() {
  const { t } = useTranslation();
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
    <section className="mova-site__container mova-site__hero" aria-labelledby="hero-h">
      <div className="mova-site__hero-copy">
        <span className="mova-site__badge"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>{t('website.landing.freeBadge')}</span>
        <h1 id="hero-h" className="mova-site__h1">{t('website.landing.headlineA')} <span className="mova-site__accent">{t('website.landing.headlineB')}</span></h1>
        <p className="mova-site__lead" style={{ maxWidth: 540 }}>{t('website.landing.intro')}</p>
        <div className="mova-site__ctas">
          <ButtonLink to="/signup">{t('website.nav.startFree')}</ButtonLink>
          <Link className="mova-site__button mova-site__button--secondary" to="/features">{t('website.landing.seeHow')}</Link>
        </div>
        <p className="mova-site__muted" style={{ margin: 0, fontSize: 14 }}>{t('website.landing.fine')}</p>
      </div>
      <div className="mova-site__hero-art">
        <PhoneFrame variant="booking" />
        <PhoneFrame variant="home" />
      </div>
    </section>

    <section className="mova-site__band" aria-labelledby="prob-h">
      <div className="mova-site__container mova-site__section" style={{ display: 'flex', flexDirection: 'column', gap: 40 }}>
        <div className="mova-site__split" style={{ alignItems: 'flex-end', justifyContent: 'space-between', gap: '32px 64px' }}>
          <h2 id="prob-h" className="mova-site__h2" style={{ flex: '1 1 520px' }}>{t('website.landing.problemTitle')}</h2>
          <figure style={{ flex: '0 1 340px', margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className="mova-site__display" style={{ fontWeight: 800, fontSize: 56, letterSpacing: -1.5, lineHeight: 1 }}>{t('website.landing.statValue')}</span>
            <figcaption style={{ fontSize: 15, lineHeight: 1.45, color: 'var(--site-body)' }}>{t('website.landing.statCaption')} <span className="mova-site__muted" style={{ fontSize: 13 }}>{t('website.landing.statSource')}</span></figcaption>
          </figure>
        </div>
        <div className="mova-site__grid">
          {problems.map(([title, body]) => <div className="mova-site__card" key={title}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#264E3E" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16M4 12h10M4 17h7" /><path d="M17 15l3 3-3 3" /></svg>
            <h3 className="mova-site__h3">{t(`website.landing.${title}`)}</h3>
            <p>{t(`website.landing.${body}`)}</p>
          </div>)}
        </div>
      </div>
    </section>

    <section className="mova-site__container mova-site__section" aria-labelledby="how-h" style={{ display: 'flex', flexDirection: 'column', gap: 40 }}>
      <div className="mova-site__stack" style={{ maxWidth: 680 }}>
        <Eyebrow>{t('website.landing.howEyebrow')}</Eyebrow>
        <h2 id="how-h" className="mova-site__h2">{t('website.landing.howTitle')}</h2>
      </div>
      <ol className="mova-site__steps">
        {steps.map(([title, body], index) => <li className="mova-site__step" key={title}>
          <span className="mova-site__step-number">{String(index + 1).padStart(2, '0')}</span>
          <h3 className="mova-site__h3" style={{ fontSize: 22 }}>{t(`website.landing.${title}`)}</h3>
          <p>{t(`website.landing.${body}`)}</p>
        </li>)}
      </ol>
    </section>

    <section className="mova-site__band--mist mova-site__band" aria-label="What Mova does">
      <div className="mova-site__container mova-site__section" style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(56px, 7vw, 96px)' }}>
        <div className="mova-site__split">
          <div className="mova-site__split-copy">
            <Eyebrow>{t('website.landing.campaignEyebrow')}</Eyebrow>
            <h2 className="mova-site__h2" style={{ fontSize: 'clamp(28px, 3vw, 40px)', letterSpacing: -0.6 }}>{t('website.landing.campaignTitleA')} <span className="mova-site__accent">{t('website.landing.campaignTitleB')}</span></h2>
            <p className="mova-site__lead" style={{ fontSize: 17 }}>{t('website.landing.campaignBody')}</p>
            <ul className="mova-site__bullets">{campaignBullets.map((key) => <li key={key}><Check />{t(`website.landing.${key}`)}</li>)}</ul>
          </div>
          <div className="mova-site__split-art"><PhoneFrame variant="campaign" /></div>
        </div>
        <div className="mova-site__split mova-site__split--reverse">
          <div className="mova-site__split-art"><PhoneFrame variant="concierge" /></div>
          <div className="mova-site__split-copy">
            <Eyebrow>{t('website.landing.conciergeEyebrow')}</Eyebrow>
            <h2 className="mova-site__h2" style={{ fontSize: 'clamp(28px, 3vw, 40px)', letterSpacing: -0.6 }}>{t('website.landing.conciergeTitleA')} <span className="mova-site__accent">{t('website.landing.conciergeTitleB')}</span></h2>
            <p className="mova-site__lead" style={{ fontSize: 17 }}>{t('website.landing.conciergeBody')}</p>
          </div>
        </div>
        <div className="mova-site__split">
          <div className="mova-site__split-copy">
            <Eyebrow>{t('website.landing.notesEyebrow')}</Eyebrow>
            <h2 className="mova-site__h2" style={{ fontSize: 'clamp(28px, 3vw, 40px)', letterSpacing: -0.6 }}>{t('website.landing.notesTitleA')} <span className="mova-site__accent">{t('website.landing.notesTitleB')}</span></h2>
            <p className="mova-site__lead" style={{ fontSize: 17 }}>{t('website.landing.notesBody')}</p>
          </div>
          <div className="mova-site__split-art"><PhoneFrame variant="client" /></div>
        </div>
      </div>
    </section>

    <section className="mova-site__container mova-site__section" aria-labelledby="who-h" style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
      <h2 id="who-h" className="mova-site__h2">{t('website.landing.whoTitle')}</h2>
      <div className="mova-site__grid">
        {who.map(([title, body]) => <div className="mova-site__card mova-site__card--white" key={title}>
          <h3 className="mova-site__h3">{t(`website.landing.${title}`)}</h3>
          <p>{t(`website.landing.${body}`)}</p>
        </div>)}
      </div>
    </section>

    <section className="mova-site__band" aria-labelledby="rules-h">
      <div className="mova-site__container mova-site__section">
        <div className="mova-site__rules-layout">
          <div>
            <Eyebrow>{t('website.landing.rulesEyebrow')}</Eyebrow>
            <h2 id="rules-h" className="mova-site__h2">{t('website.landing.rulesTitle')}</h2>
            <p className="mova-site__lead" style={{ fontSize: 17 }}>{t('website.landing.rulesBody')}</p>
          </div>
          <ul className="mova-site__rules">
            {rules.map((key) => <li key={key}><Check size={22} />{t(`website.landing.${key}`)}</li>)}
          </ul>
        </div>
      </div>
    </section>

    <section className="mova-site__container mova-site__section" aria-labelledby="learn-h" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <h2 id="learn-h" className="mova-site__h2" style={{ fontSize: 'clamp(26px, 3vw, 36px)' }}>{t('website.landing.resourcesTitle')}</h2>
      <div className="mova-site__pair">
        <Link to="/calculator">
          <span>{t('website.landing.calcTitle')}</span>
          <strong>{t('website.landing.calcBody')}</strong>
          <span>{t('website.landing.calcLink')} →</span>
        </Link>
        <Link to="/guides">
          <span>{t('website.landing.guideTitle')}</span>
          <strong>{t('website.landing.guideBody')}</strong>
          <span>{t('website.landing.guideLink')} →</span>
        </Link>
      </div>
    </section>

    <section className="mova-site__container" aria-labelledby="cta-h" style={{ paddingBottom: 'clamp(56px, 7vw, 96px)' }}>
      <div className="mova-site__cta">
        <div className="mova-site__cta-copy">
          <h2 id="cta-h">{t('website.landing.ctaTitle')}</h2>
          <p>{t('website.landing.ctaBody')}</p>
        </div>
        <div className="mova-site__ctas">
          <ButtonLink to="/signup">{t('website.landing.ctaCreate')}</ButtonLink>
          <Link className="mova-site__button mova-site__button--secondary" to="/pricing">{t('website.landing.ctaPlans')}</Link>
        </div>
      </div>
    </section>
  </div>;
}
