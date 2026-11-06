import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireSupabaseEnv } from './env';

let browserClient: SupabaseClient | null = null;

export function createMovaSupabaseClient() {
  if (typeof window !== 'undefined' && browserClient) return browserClient;
  const { url, anonKey } = requireSupabaseEnv();
  const client = createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  if (typeof window !== 'undefined') browserClient = client;
  return client;
}
