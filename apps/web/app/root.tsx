import { isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration, useLocation, useRouteError } from 'react-router';
import type { LinksFunction } from 'react-router';
import stylesheet from '../src/styles.css?url';
import { AppErrorBoundary } from '../src/app/AppErrorBoundary';
import { PwaInstallProvider } from '../src/pwa/PwaInstallProvider';

export const links: LinksFunction = () => [{ rel: 'stylesheet', href: stylesheet }];

export function Layout({ children }: { children: React.ReactNode }) {
  // Public pages take their language from ?locale=, so the document language matches the content that was rendered.
  const lang = new URLSearchParams(useLocation().search).get('locale') === 'es-US' ? 'es-US' : 'en-US';
  return <html lang={lang}>
    <head><meta charSet="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      <meta name="theme-color" content="#18392F" /><link rel="manifest" href="/manifest.webmanifest" />
      <link rel="icon" href="/icons/mova-192.svg" type="image/svg+xml" /><Meta /><Links /></head>
    <body>{children}<ScrollRestoration /><Scripts /></body>
  </html>;
}

export default function Root() {
  return <PwaInstallProvider><AppErrorBoundary><Outlet /></AppErrorBoundary></PwaInstallProvider>;
}

export function ErrorBoundary() {
  const error = useRouteError();
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  return <main className="mova-page" role="alert">
    <h1>{notFound ? 'Page not found' : 'This page is temporarily unavailable'}</h1>
      <p>{notFound ? 'The page may have moved or is not public.' : 'Please try again in a moment.'}</p>
      <a href="/">Return to mova</a>
  </main>;
}
