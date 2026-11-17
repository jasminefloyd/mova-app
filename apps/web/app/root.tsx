import { isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration, useLocation, useRouteError } from 'react-router';
import { useEffect } from 'react';
import type { LinksFunction } from 'react-router';
import stylesheet from '../src/styles.css?url';
import launchScreens from '../src/pwa/launch-screens.json';
import { AppErrorBoundary } from '../src/app/AppErrorBoundary';
import { PwaInstallProvider } from '../src/pwa/PwaInstallProvider';

export const links: LinksFunction = () => [{ rel: 'stylesheet', href: stylesheet }];

export function Layout({ children }: { children: React.ReactNode }) {
  // Public pages take their language from ?locale=, so the document language matches the content that was rendered.
  const location = useLocation();
  const lang = new URLSearchParams(location.search).get('locale') === 'es-US' ? 'es-US' : 'en-US';
  useEffect(() => { document.title = `Mova Beauty ${pageName(location.pathname)}`; }, [location.pathname]);
  return <html lang={lang}>
    <head><meta charSet="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      <meta name="theme-color" content="#18392F" /><link rel="manifest" href="/manifest.webmanifest" />
      <link rel="icon" href="/icons/favicon-48.png" type="image/png" sizes="48x48" /><link rel="icon" href="/icons/favicon-32.png" type="image/png" sizes="32x32" />
      <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" /><meta name="apple-mobile-web-app-capable" content="yes" /><meta name="mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-title" content="Mova Beauty" /><meta name="apple-mobile-web-app-status-bar-style" content="default" />
      {launchScreens.map((screen) => <link key={screen.href} rel="apple-touch-startup-image" href={screen.href} media={screen.media} />)}<Meta /><Links /></head>
    <body>{children}<ScrollRestoration /><Scripts /></body>
  </html>;
}

function pageName(pathname: string): string {
  const path = pathname.replace(/\/$/, '') || '/';
  const exact: Record<string, string> = {
    '/': 'Home', '/features': 'Features', '/pricing': 'Pricing', '/calculator': 'Calculator', '/guides': 'Guides',
    '/login': 'Login', '/signin': 'Client Sign In', '/signup': 'Create Account', '/auth': 'Sign In', '/auth/confirm': 'Confirm Email',
    '/me': 'Client Profile', '/money': 'Money', '/reports': 'Reports', '/growth': 'AI Revenue', '/admin': 'Admin', '/admin/signin': 'Admin Sign In', '/notifications': 'Notifications',
    '/admin/stylists': 'Admin Stylists', '/admin/inbox': 'Admin Support Inbox', '/admin/fees': 'Admin Fees', '/admin/blog': 'Admin Guides',
    '/admin/flags': 'Admin Feature Flags', '/admin/health': 'Admin System Health', '/admin/logs': 'Admin Logs', '/admin/activity': 'Admin Activity',
  };
  if (exact[path]) return exact[path];
  if (path.startsWith('/onboarding')) return 'Setup';
  if (path.startsWith('/guides/')) return 'Guide';
  if (path.startsWith('/a/')) return path.endsWith('/book') ? 'Booking' : 'Stylist Page';
  if (path.startsWith('/admin/stylists/')) return path.endsWith('/audit') ? 'Admin Audit Log' : 'Admin Stylist';
  if (path.startsWith('/admin/blog/')) return 'Admin Guide Editor';
  if (path.startsWith('/appointments/')) return path.endsWith('/pay') ? 'Payment' : path.endsWith('/notes') ? 'Visit Notes' : 'Appointment';
  if (path.startsWith('/clients/')) return path.endsWith('/new') ? 'New Client' : 'Client Profile';
  if (path.startsWith('/settings/')) {
    if (path === '/settings/profile/preview') return 'Preview Profile';
    if (path === '/settings/locations/new') return 'Add Location';
    const section = path.slice('/settings/'.length).split('/')[0];
    const labels: Record<string, string> = { profile: 'Profile', services: 'Services', portfolio: 'Portfolio', locations: 'Locations', payments: 'Payments', 'calendar-sync': 'Calendar Sync', google: 'Google', notifications: 'Notifications', reviews: 'Reviews', plan: 'Plan', privacy: 'Privacy', qr: 'My QR Code' };
    return labels[section] ?? 'Settings';
  }
  if (path.startsWith('/calendar')) return path.endsWith('/block-time') ? 'Block Time' : path.endsWith('/new-appointment') ? 'New Appointment' : 'Calendar';
  if (path.startsWith('/clients')) return 'Clients';
  if (path.startsWith('/reports/')) return 'Reviews';
  if (path.startsWith('/b/')) return 'Booking Details';
  if (path.startsWith('/c/')) return 'Client Card';
  if (path.startsWith('/s/')) return 'Book with a Stylist';
  if (path.startsWith('/review/')) return 'Write a Review';
  if (path.startsWith('/slot/')) return 'Claim an Opening';
  if (path.startsWith('/pay/')) return 'Payment';
  if (path.startsWith('/growth/marketing')) return 'Marketing';
  if (path.startsWith('/growth/concierge')) return 'AI Concierge';
  if (path.startsWith('/growth/')) return 'AI Revenue';
  if (path.startsWith('/admin/')) return 'Admin';
  if (/^\/[^/]+$/.test(path)) return 'Home';
  return 'Mova';
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
