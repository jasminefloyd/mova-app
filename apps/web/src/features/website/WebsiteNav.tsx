import { Link, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';

type Section = 'features' | 'pricing' | 'calculator' | 'guides';

export function sectionForPath(pathname: string): Section | null {
  const first = pathname.split('/').filter(Boolean)[0];
  return first === 'features' || first === 'pricing' || first === 'calculator' || first === 'guides' ? first : null;
}

export function WebsiteNav() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const current = sectionForPath(pathname);
  const link = (section: Section, to: string) => (
    <Link className="mova-site__link" to={to} aria-current={current === section ? 'page' : undefined}>{t(`website.nav.${section}`)}</Link>
  );
  return <header className="mova-site__nav">
    <div className="mova-site__container mova-site__nav-inner">
      <Link className="mova-site__brand" to="/" aria-label={t('website.nav.home')}>mova</Link>
      <div className="mova-site__nav-end">
        <nav aria-label={t('website.nav.label')} className="mova-site__links">
          {link('features', '/features')}
          {link('pricing', '/pricing')}
          {link('calculator', '/calculator')}
          {link('guides', '/guides')}
        </nav>
        <div className="mova-site__account">
          <Link className="mova-site__signin" to="/login">{t('website.nav.signIn')}</Link>
          <Link className="mova-site__start" to="/signup">{t('website.nav.startFree')}</Link>
        </div>
      </div>
    </div>
  </header>;
}
