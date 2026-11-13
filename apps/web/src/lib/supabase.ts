import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireSupabaseEnv } from './env';

let browserClient: SupabaseClient | null = null;

export function createMovaSupabaseClient() {
  if (typeof window !== 'undefined' && browserClient) return browserClient;
  const { url, anonKey } = requireSupabaseEnv();
  const tracedFetch: typeof fetch = async (input, init) => {
    const inputUrl = input instanceof Request ? input.url : String(input);
    if (!inputUrl.includes('/functions/v1/')) return fetch(input, init);
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    const requestId = headers.get('x-request-id') ?? crypto.randomUUID();
    headers.set('x-request-id', requestId);
    const response = await fetch(input, { ...init, headers });
    if (response.status >= 500 && typeof window !== 'undefined') {
      const reference = response.headers.get('x-request-id') ?? requestId;
      window.dispatchEvent(new CustomEvent('mova:request-error', { detail: { requestId: reference } }));
    }
    return response;
  };
  const client = createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    global: { fetch: tracedFetch },
  });
  if (typeof window !== 'undefined') browserClient = client;
  return client;
}
