import { createClient } from '@supabase/supabase-js';
import type { LoaderFunctionArgs } from 'react-router';

export async function loader({ request }: LoaderFunctionArgs) {
  const env = typeof process !== 'undefined' ? process.env : undefined;
  const expected = env?.CRON_SECRET;
  if (!expected || request.headers.get('authorization') !== `Bearer ${expected}`) return new Response('Unauthorized', { status: 401 });
  const url = env?.SUPABASE_URL;
  const serviceKey = env?.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return Response.json({ error: 'Server configuration missing' }, { status: 503 });
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await supabase.rpc('mova_expire_booking_requests');
  if (error) return Response.json({ error: 'Expiry processing failed' }, { status: 503 });
  return Response.json({ expired: data });
}
