import { useState } from 'react';
import { Outlet } from 'react-router';
import type { LoaderFunctionArgs } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './admin.css';

// The admin portal is served from admin.mova-beauty.co (see vercel.json). Anywhere else it does not exist.
export function isAdminHost(hostname: string): boolean {
  return hostname === 'admin.mova-beauty.co' || hostname === 'localhost' || hostname === '127.0.0.1' || hostname.endsWith('.vercel.app');
}

export function loader({ request }: LoaderFunctionArgs) {
  if (!isAdminHost(new URL(request.url).hostname)) {
    throw new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }
  return null;
}

export function meta() {
  return [{ title: 'Mova admin' }, { name: 'robots', content: 'noindex, nofollow' }];
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
  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
    </QueryClientProvider>
  );
}
