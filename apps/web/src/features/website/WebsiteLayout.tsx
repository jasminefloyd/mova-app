import { useEffect } from 'react';
import { I18nextProvider } from 'react-i18next';
import { Outlet, redirect, useLoaderData, useLocation, useMatches } from 'react-router';
import type { LoaderFunctionArgs } from 'react-router';
import i18n from '../../i18n';
import { JsonLd, SiteShellContext } from './parts';
import { publicBaseUrl, siteGraph, type ShellData } from './seo';
import { WebsiteFooter } from './WebsiteFooter';
import { WebsiteNav } from './WebsiteNav';
import { installGoogleTagManager } from './google-tag-manager';
import { trackDiscoveryPage, trackDiscoverySignupClick } from './discovery-analytics';
import './website.css';

// Route module for the public website. Google Fonts is the only stylesheet we load from outside.
export const links = () => [
  { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
  { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' as const },
  { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&family=Manrope:wght@600;700;800&display=swap' },
];

// Retire old locale URLs while keeping campaign tags and guide filters.
export function loader({ request }: LoaderFunctionArgs): ShellData | Response {
  const url = new URL(request.url);
  if (url.searchParams.has('locale')) {
    url.searchParams.delete('locale');
    return redirect(url.pathname.replace(/^\/+/, '/') + url.search, 301);
  }
  return { publicBaseUrl: publicBaseUrl() };
}

const websiteI18n = i18n.cloneInstance({ lng: 'en-US', initAsync: false });

export default function WebsiteLayout() {
  const shell = useLoaderData<typeof loader>();
  useEffect(installGoogleTagManager, []);
  const { pathname, key } = useLocation();
  const matches = useMatches();
  const trackable = !pathname.startsWith('/guides/') || matches.some(match => match.id === 'guide-article' && match.data);
  useEffect(() => {
    if (trackable) trackDiscoveryPage(pathname, key);
  }, [pathname, key, trackable]);
  return <I18nextProvider i18n={websiteI18n}>
    <SiteShellContext.Provider value={shell}>
      <div className="mova-site" lang="en-US" onClickCapture={event => {
        const link = event.target instanceof Element ? event.target.closest('a') : null;
        if (trackable && link?.origin === window.location.origin && link.pathname === '/signup') trackDiscoverySignupClick(pathname);
      }}>
        <WebsiteNav />
        <Outlet />
        <WebsiteFooter />
        <JsonLd data={siteGraph(shell)} />
      </div>
    </SiteShellContext.Provider>
  </I18nextProvider>;
}
