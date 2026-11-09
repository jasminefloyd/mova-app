import { useRef } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../components';

export default function MarketingHome() {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);

  const playWalkthrough = () => { void videoRef.current?.play(); };

  return <div className="mova-marketing-home">
    <header className="mova-marketing-home__header">
      <div className="mova-marketing-home__header-inner">
        <Link className="mova-marketing-home__wordmark" to="/" aria-label={t('marketing.home')}>mova</Link>
        <nav aria-label={t('marketing.account')}>
          <Link className="mova-marketing-home__signin" to="/login">{t('marketing.signIn')}</Link>
          <Link className="mova-marketing-home__signup" to="/signup">{t('marketing.signUp')}</Link>
        </nav>
      </div>
    </header>

    <main>
      <section className="mova-marketing-home__hero">
        <div className="mova-marketing-home__hero-copy">
          <h1>{t('marketing.headline')}</h1>
          <p className="mova-marketing-home__intro">{t('marketing.intro')}</p>
          <Link className="mova-marketing-home__signup mova-marketing-home__cta" to="/signup">{t('marketing.signUp')}</Link>
        </div>
        <figure className="mova-marketing-home__walkthrough">
          <video ref={videoRef} controls preload="metadata" playsInline poster="/media/Mova_Walkthrough_poster.jpg" aria-label={t('marketing.walkthrough')}>
            <source src="/media/Mova_Loop_40s.mp4" type="video/mp4" />
          </video>
          <button type="button" className="mova-marketing-home__video-link" onClick={playWalkthrough}>
            <span aria-hidden="true" />{t('marketing.watchWalkthrough')}
          </button>
        </figure>
      </section>

      <section className="mova-marketing-home__benefits">
        <div className="mova-marketing-home__benefits-inner">
          <h2>{t('marketing.benefitsTitle')}</h2>
          <div className="mova-marketing-home__benefit-grid">
            <article className="mova-marketing-home__benefit-card">
              <span className="mova-marketing-home__benefit-icon"><Icon name="qr" size={24} /></span>
              <h3>{t('marketing.benefitScanTitle')}</h3><p>{t('marketing.benefitScanBody')}</p>
            </article>
            <article className="mova-marketing-home__benefit-card">
              <span className="mova-marketing-home__benefit-icon"><Icon name="calendar" size={24} /></span>
              <h3>{t('marketing.benefitGapsTitle')}</h3><p>{t('marketing.benefitGapsBody')}</p>
            </article>
            <article className="mova-marketing-home__benefit-card">
              <span className="mova-marketing-home__benefit-icon"><Icon name="user" size={24} /></span>
              <h3>{t('marketing.benefitClientsTitle')}</h3><p>{t('marketing.benefitClientsBody')}</p>
            </article>
          </div>
        </div>
      </section>

      <section className="mova-marketing-home__closing">
        <div className="mova-marketing-home__closing-inner">
          <h2>{t('marketing.closingTitle')}</h2>
          <p>{t('marketing.closingBody')}</p>
          <Link className="mova-marketing-home__signup mova-marketing-home__cta" to="/signup">{t('marketing.signUp')}</Link>
        </div>
      </section>
    </main>

    <footer className="mova-marketing-home__footer">
      <div><span>{t('marketing.copyright', { year: new Date().getFullYear() })}</span><nav aria-label={t('marketing.legal')}><span aria-disabled="true">{t('marketing.privacy')}</span><span aria-disabled="true">{t('marketing.terms')}</span></nav></div>
    </footer>
  </div>;
}

