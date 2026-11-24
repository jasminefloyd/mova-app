import type { LoaderFunctionArgs } from 'react-router';
import { searchDiscovery } from './search-console.server';

const headers = { 'Cache-Control': 'private, no-store' };

export async function loader({ request }: LoaderFunctionArgs) {
  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return new Response(null, { status: 401, headers });
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return new Response(null, { status: 503, headers });

  try {
    const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/mova_admin_whoami`, {
      method: 'POST',
      headers: { Authorization: authorization, apikey: key, 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(4000),
    });
    if (response.status === 401 || response.status === 403) return new Response(null, { status: response.status, headers });
    if (!response.ok) return new Response(null, { status: 503, headers });
    const admin = await response.json() as { is_admin?: boolean };
    if (admin.is_admin !== true) return new Response(null, { status: 403, headers });
    return Response.json(await searchDiscovery(), { headers });
  } catch {
    return new Response(null, { status: 503, headers });
  }
}
