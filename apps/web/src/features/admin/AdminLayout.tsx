import { useEffect, useRef, useState } from 'react';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AdminNav } from './AdminNav';
import { currentAdminSession, IDLE_LIMIT_MS, signOutAdmin } from './admin-session';
import { Loading } from './AdminPrimitives';

/** Gate for every admin screen. Anyone without a two-step admin session goes to sign-in. */
export default function AdminLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [idle, setIdle] = useState(false);
  const session = useQuery({ queryKey: ['admin', 'session'], queryFn: currentAdminSession, retry: false, staleTime: 5 * 60_000 });
  const timer = useRef<number | undefined>(undefined);
  const signedIn = session.data !== null && session.data !== undefined;

  // Sign out after 30 minutes without input. Any pointer or key input restarts the countdown.
  useEffect(() => {
    if (!signedIn) return;
    const endForIdle = async () => {
      await signOutAdmin();
      queryClient.clear();
      setIdle(true);
      navigate('/admin/signin?reason=idle', { replace: true });
    };
    const restart = () => {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void endForIdle(), IDLE_LIMIT_MS);
    };
    restart();
    window.addEventListener('pointerdown', restart);
    window.addEventListener('keydown', restart);
    return () => {
      window.clearTimeout(timer.current);
      window.removeEventListener('pointerdown', restart);
      window.removeEventListener('keydown', restart);
    };
  }, [signedIn, navigate, queryClient]);

  if (session.isPending) return <div className="adm"><div className="main"><Loading label="Checking your admin session" /></div></div>;
  if (!session.data) {
    const returnTo = encodeURIComponent(`${location.pathname}${location.search}`);
    return <Navigate to={`/admin/signin?returnTo=${returnTo}${idle ? '&reason=idle' : ''}`} replace />;
  }
  return (
    <div className="adm">
      <div className="shell">
        <AdminNav name={session.data.displayName} />
        <main className="main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
