import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { PublicLocaleToggle } from '../../app/PublicLocaleToggle';

export function WebsiteFooter() {
  const { t } = useTranslation();
  return <footer className="mova-site__footer">
    <div className="mova-site__container mova-site__footer-inner">
      <div className="mova-site__footer-top">
        <div className="mova-site__footer-about">
          <span className="mova-site__footer-brand">mova</span>
          <p>{t('website.footer.tagline')}</p>
        </div>
        <div className="mova-site__footer-cols">
          <nav aria-label={t('website.footer.product')} className="mova-site__footer-col">
            <h2>{t('website.footer.product')}</h2>
            <Link to="/features">{t('website.footer.features')}</Link>
            <Link to="/pricing">{t('website.footer.pricing')}</Link>
            <Link to="/signup">{t('website.footer.createAccount')}</Link>
          </nav>
          <nav aria-label={t('website.footer.learn')} className="mova-site__footer-col">
            <h2>{t('website.footer.learn')}</h2>
            <Link to="/calculator">{t('website.footer.calculatorLink')}</Link>
            <Link to="/guides">{t('website.footer.guides')}</Link>
          </nav>
          <nav aria-label={t('website.footer.account')} className="mova-site__footer-col">
            <h2>{t('website.footer.account')}</h2>
            <Link to="/login">{t('website.footer.signIn')}</Link>
            <span className="mova-site__muted-text">{t('website.footer.privacy')}</span>
            <span className="mova-site__muted-text">{t('website.footer.terms')}</span>
          </nav>
        </div>
      </div>
      <div className="mova-site__footer-bottom">
        <span>{t('website.footer.copyright')}</span>
        <PublicLocaleToggle />
      </div>
    </div>
  </footer>;
}
