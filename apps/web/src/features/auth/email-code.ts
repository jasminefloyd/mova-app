import type { createMovaSupabaseClient } from '../../lib/supabase';

type Supabase = ReturnType<typeof createMovaSupabaseClient>;

/**
 * Sends a passwordless email code. New stylists get their private name in sign-up metadata;
 * returning stylists only receive a code if an account exists.
 */
export async function sendStylistEmailCode(supabase: Supabase, options: {
  email: string; create: boolean; firstName?: string; lastName?: string; locale?: string; discoveryVisit?: string;
}): Promise<{ ok: boolean; unknownAccount?: boolean }> {
  const { error } = await supabase.auth.signInWithOtp({
    email: options.email.trim(),
    options: {
      shouldCreateUser: options.create,
      ...(options.create ? { data: { first_name: options.firstName?.trim() ?? '', last_name: options.lastName?.trim() ?? '', preferred_locale: options.locale ?? 'en-US', mova_discovery_visit: options.discoveryVisit } } : {}),
    },
  });
  if (!error) return { ok: true };
  // Sign-in for an email with no account: answer the same way as success so the page never reveals who has an account.
  if (!options.create && (error.code === 'user_banned' || /signups? not allowed|user not found|user is banned/i.test(error.message))) return { ok: true, unknownAccount: true };
  return { ok: false };
}
