import { Navigate, useLocation } from 'react-router';

/** P6: /auth is retired. Stylist sign-in lives at /login and keeps any returnTo query. */
export default function AuthRedirect() {
  const { search } = useLocation();
  return <Navigate to={`/login${search}`} replace />;
}
