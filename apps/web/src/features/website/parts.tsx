import { createContext, useContext, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { DEFAULT_BASE_URL, jsonLdString, type ShellData } from './seo';

/** Small line icons from the boards. Decorative unless a label is given. */
export function Check({ size = 20 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="var(--botanical)" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;
}

export function Bullets({ items }: { items: string[] }) {
  return <ul className="mova-site__bullets">
    {items.map((item) => <li key={item}><Check />{item}</li>)}
  </ul>;
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <span className="mova-site__eyebrow">{children}</span>;
}

/**
 * Decorative stand-in for an app screen shown in the boards. The boards embed live screen designs;
 * this keeps the layout with generic shapes. Swap for real screenshots when they exist.
 */
export function PhoneFrame({ variant = 'home' }: { variant?: 'home' | 'booking' | 'client' | 'money' | 'campaign' | 'concierge' | 'reports' }) {
  return <div className="mova-site__phone" aria-hidden="true">
    <div className="mova-site__phone-screen" data-variant={variant}>
      <span className="mova-site__phone-bar mova-site__phone-bar--short" />
      <b>mova</b>
      <div className="mova-site__phone-hero" />
      <div className="mova-site__phone-tiles"><span className="mova-site__phone-tile" /><span className="mova-site__phone-tile" /></div>
      <div className="mova-site__phone-row"><span className="mova-site__phone-dot" /><span style={{ flex: 1, display: 'grid', gap: 6 }}><span className="mova-site__phone-bar" /><span className="mova-site__phone-bar mova-site__phone-bar--short" /></span></div>
      <div className="mova-site__phone-row"><span className="mova-site__phone-dot" /><span style={{ flex: 1, display: 'grid', gap: 6 }}><span className="mova-site__phone-bar" /><span className="mova-site__phone-bar mova-site__phone-bar--short" /></span></div>
      <div className="mova-site__phone-row"><span className="mova-site__phone-dot" /><span style={{ flex: 1, display: 'grid', gap: 6 }}><span className="mova-site__phone-bar mova-site__phone-bar--dark" /></span></div>
    </div>
  </div>;
}

export function ButtonLink({ to, variant, children }: { to: string; variant?: 'secondary' | 'peach' | 'plan' | 'plan-featured' | 'small'; children: ReactNode }) {
  const modifier = variant ? ` mova-site__button--${variant}` : '';
  return <Link className={`mova-site__button${modifier}`} to={to}>{children}</Link>;
}

/** Structured data (schema.org JSON-LD) for search engines and AI assistants. */
export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(data) }} />;
}

/** The website layout puts the request's language and public base URL here for its pages. */
export const SiteShellContext = createContext<ShellData | null>(null);

/** Language and public base URL for the page being rendered. */
export function useSiteShell(): ShellData {
  const { i18n } = useTranslation();
  const data = useContext(SiteShellContext);
  return data ?? { locale: i18n.language === 'es-US' ? 'es-US' : 'en-US', publicBaseUrl: DEFAULT_BASE_URL };
}

/** Keeps a visitor (and a crawler) on the Spanish pages: public links carry ?locale=es-US when the page is Spanish. */
export function useLocalePath(): (path: string) => string {
  const { locale } = useSiteShell();
  return (path) => (locale === 'es-US' ? `${path}?locale=es-US` : path);
}
