import { z } from 'zod';

const optionalUrl = z.string().url().optional();
const publicEnvSchema = z.object({
  VITE_SUPABASE_URL: optionalUrl,
  VITE_SUPABASE_ANON_KEY: z.string().min(1).optional(),
  VITE_CLIENT_PROFILES_ENABLED: z.enum(['true','false']).optional(),
  VITE_WALLET_CLIENT_CARD_ENABLED: z.enum(['true','false']).optional(),
  VITE_CONCIERGE_WEB_CHAT_ENABLED: z.enum(['true','false']).optional(),
  VITE_WAITLIST_ENABLED: z.enum(['true','false']).optional(),
});

const rawEnv = {
  VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL || undefined,
  VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY || undefined,
  VITE_CLIENT_PROFILES_ENABLED: import.meta.env.VITE_CLIENT_PROFILES_ENABLED || undefined,
  VITE_WALLET_CLIENT_CARD_ENABLED: import.meta.env.VITE_WALLET_CLIENT_CARD_ENABLED || undefined,
  VITE_CONCIERGE_WEB_CHAT_ENABLED: import.meta.env.VITE_CONCIERGE_WEB_CHAT_ENABLED || undefined,
  VITE_WAITLIST_ENABLED: import.meta.env.VITE_WAITLIST_ENABLED || undefined,
};

export const publicEnv = publicEnvSchema.parse(rawEnv);
export const clientProfilesEnabled = publicEnv.VITE_CLIENT_PROFILES_ENABLED === 'true';
export const walletClientCardEnabled = publicEnv.VITE_WALLET_CLIENT_CARD_ENABLED === 'true';
export const waitlistEnabled = publicEnv.VITE_WAITLIST_ENABLED === 'true';

export function requireSupabaseEnv(): { url: string; anonKey: string } {
  if (!publicEnv.VITE_SUPABASE_URL || !publicEnv.VITE_SUPABASE_ANON_KEY) {
    throw new Error('Supabase browser configuration is missing');
  }
  return { url: publicEnv.VITE_SUPABASE_URL, anonKey: publicEnv.VITE_SUPABASE_ANON_KEY };
}
