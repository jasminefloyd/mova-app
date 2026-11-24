import { useEffect, useState } from 'react';
import { data, Outlet } from 'react-router';
import type { HeadersFunction, LoaderFunctionArgs } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ADMIN_RELOAD_PARAM } from '../../pwa/admin-asset-recovery';
import './admin.css';

// The admin portal is available on the dedicated host and at /admin on the main site.
// Vercel's host redirects are convenience routing only; this route still relies on the
// staff sign-in and server-side platform-admin checks for access control.
export function isAdminHost(hostname: string): boolean {
  return hostname === 'admin.mova-beauty.co'
    || hostname === 'mova-beauty.co'
    || hostname === 'www.mova-beauty.co'
    || hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname.endsWith('.vercel.app');
}

export function loader({ request }: LoaderFunctionArgs) {
  if (!isAdminHost(new URL(request.url).hostname)) {
    throw new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }
  return data(null, { headers: { 'Cache-Control': 'private, no-store' } });
}

export const headers: HeadersFunction = () => ({ 'Cache-Control': 'private, no-store' });

export function meta() {
  return [{ title: 'Mova Beauty Admin' }, { name: 'robots', content: 'noindex, nofollow' }];
}

export function createAdminQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
}

export default function AdminRoot() {
  const [queryClient] = useState(createAdminQueryClient);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(ADMIN_RELOAD_PARAM)) return;
    url.searchParams.delete(ADMIN_RELOAD_PARAM);
    window.history.replaceState(window.history.state, '', url.href);
  }, []);
  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
    </QueryClientProvider>
  );
}
