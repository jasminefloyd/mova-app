import { isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration, useRouteError } from 'react-router';
import type { LinksFunction } from 'react-router';
import stylesheet from '../src/styles.css?url';
import { AppErrorBoundary } from '../src/app/AppErrorBoundary';

export const links: LinksFunction = () => [{ rel: 'stylesheet', href: stylesheet }];

export function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="en-US">
    <head><meta charSet="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      <meta name="theme-color" content="#18392F" /><link rel="manifest" href="/manifest.webmanifest" />
      <link rel="icon" href="/icons/mova-192.svg" type="image/svg+xml" /><Meta /><Links /></head>
    <body>{children}<ScrollRestoration /><Scripts /></body>
  </html>;
}

export default function Root() {
  return <AppErrorBoundary><Outlet /></AppErrorBoundary>;
}

export function ErrorBoundary() {
  const error = useRouteError();
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  return <html lang="en-US"><head><meta charSet="utf-8" /><Meta /><Links /></head><body>
    <main className="mova-page" role="alert"><h1>{notFound ? 'Page not found' : 'This page is temporarily unavailable'}</h1>
      <p>{notFound ? 'The page may have moved or is not public.' : 'Please try again in a moment.'}</p>
      <a href="/">Return to mova.</a>
    </main><Scripts />
  </body></html>;
}
