import { useMemo } from 'react';
import { I18nextProvider } from 'react-i18next';
import { Outlet, useLoaderData } from 'react-router';
import type { LoaderFunctionArgs } from 'react-router';
import i18n from '../../i18n';
import { JsonLd, SiteShellContext } from './parts';
import { localeFromUrl, publicBaseUrl, siteGraph, type ShellData } from './seo';
import { WebsiteFooter } from './WebsiteFooter';
import { WebsiteNav } from './WebsiteNav';
import './website.css';

// Route module for the public website. Google Fonts is the only stylesheet we load from outside.
export const links = () => [
  { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
  { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' as const },
  { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&family=Manrope:wght@600;700;800&display=swap' },
];

// The language comes from ?locale= so each language has its own URL that search engines can index.
export function loader({ request }: LoaderFunctionArgs): ShellData & { explicitLocale: boolean } {
  return { locale: localeFromUrl(request.url), publicBaseUrl: publicBaseUrl(), explicitLocale: new URL(request.url).searchParams.has('locale') };
}

let browserLocaleSynced = false;

export default function WebsiteLayout() {
  const shell = useLoaderData<typeof loader>();
  const onServer = typeof document === 'undefined';
  // On the server each request gets its own i18n copy, so a Spanish request is rendered in Spanish
  // without changing the language for anyone else.
  const serverI18n = useMemo(() => (onServer && shell.locale !== 'en-US' ? i18n.cloneInstance({ lng: shell.locale, initAsync: false }) : null), [onServer, shell.locale]);
  // In the browser the first render must match that HTML, so the shared instance switches before hydration.
  if (!onServer && !browserLocaleSynced) {
    browserLocaleSynced = true;
    if (shell.explicitLocale && i18n.language !== shell.locale) void i18n.changeLanguage(shell.locale);
  }
  const page = <SiteShellContext.Provider value={shell}>
    <div className="mova-site" lang={shell.locale}>
      <WebsiteNav />
      <Outlet />
      <WebsiteFooter />
      <JsonLd data={siteGraph(shell)} />
    </div>
  </SiteShellContext.Provider>;
  return serverI18n ? <I18nextProvider i18n={serverI18n}>{page}</I18nextProvider> : page;
}
