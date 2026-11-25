import { Navigate, useLocation, useParams } from 'react-router';

// Old Settings addresses forward to Connections so existing links, emails and bookmarks keep working:
// /settings/google → Connections › Google, /settings/calendar-sync → Connections. Query strings are kept.
export function ConnectionsRedirect({ to }: { to: string }) {
  const { businessId } = useParams();
  const { search } = useLocation();
  // Keep the same workspace segment (BID-n or the business id) the old address used.
  return <Navigate to={`/${encodeURIComponent(businessId ?? '')}/${to}${search}`} replace />;
}

export function GoogleRedirectRoute() { return <ConnectionsRedirect to="settings/connections/google" />; }
export function CalendarSyncRedirectRoute() { return <ConnectionsRedirect to="settings/connections" />; }
