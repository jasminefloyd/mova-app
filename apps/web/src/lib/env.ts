import { z } from 'zod';

const optionalUrl = z.string().url().optional();
const publicEnvSchema = z.object({
  VITE_SUPABASE_URL: optionalUrl,
  VITE_SUPABASE_ANON_KEY: z.string().min(1).optional(),
  VITE_CLIENT_PROFILES_ENABLED: z.enum(['true','false']).optional(),
  VITE_WALLET_CLIENT_CARD_ENABLED: z.enum(['true','false']).optional(),
  VITE_CONCIERGE_WEB_CHAT_ENABLED: z.enum(['true','false']).optional(),
  VITE_STRIPE_TEST_MODE: z.enum(['true','false']).optional(),
  VITE_HCAPTCHA_SITE_KEY: z.string().regex(/^[0-9a-f-]{20,64}$/i).optional(),
});

const rawEnv = {
  VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL || undefined,
  VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY || undefined,
  VITE_CLIENT_PROFILES_ENABLED: import.meta.env.VITE_CLIENT_PROFILES_ENABLED || undefined,
  VITE_WALLET_CLIENT_CARD_ENABLED: import.meta.env.VITE_WALLET_CLIENT_CARD_ENABLED || undefined,
  VITE_CONCIERGE_WEB_CHAT_ENABLED: import.meta.env.VITE_CONCIERGE_WEB_CHAT_ENABLED || undefined,
  VITE_STRIPE_TEST_MODE: import.meta.env.VITE_STRIPE_TEST_MODE || undefined,
  VITE_HCAPTCHA_SITE_KEY: import.meta.env.VITE_HCAPTCHA_SITE_KEY || undefined,
};

export const publicEnv = publicEnvSchema.parse(rawEnv);
export const clientProfilesEnabled = publicEnv.VITE_CLIENT_PROFILES_ENABLED === 'true';
export const walletClientCardEnabled = publicEnv.VITE_WALLET_CLIENT_CARD_ENABLED === 'true';
export const stripeTestModeEnabled = publicEnv.VITE_STRIPE_TEST_MODE === 'true';
export const webChatEnabled = publicEnv.VITE_CONCIERGE_WEB_CHAT_ENABLED === 'true';
/** Shown on feedback so the team knows which build a stylist used. */
export const appVersion = String(import.meta.env.VITE_APP_VERSION || import.meta.env.MODE || 'web').slice(0, 60);

export function requireSupabaseEnv(): { url: string; anonKey: string } {
  if (!publicEnv.VITE_SUPABASE_URL || !publicEnv.VITE_SUPABASE_ANON_KEY) {
    throw new Error('Supabase browser configuration is missing');
  }
  return { url: publicEnv.VITE_SUPABASE_URL, anonKey: publicEnv.VITE_SUPABASE_ANON_KEY };
}

/** O1: hCaptcha on the booking forms. Shown only when a site key is configured. */
export const hcaptchaSiteKey = publicEnv.VITE_HCAPTCHA_SITE_KEY ?? null;
