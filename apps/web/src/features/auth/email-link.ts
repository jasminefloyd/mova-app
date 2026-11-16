import type { createMovaSupabaseClient } from '../../lib/supabase';

type Supabase = ReturnType<typeof createMovaSupabaseClient>;

/** Where the emailed sign-in link lands. /auth/confirm finishes the sign-in and routes the stylist on. */
export function confirmUrl(returnTo = '') {
  const safe = returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '';
  return `${window.location.origin}/auth/confirm${safe ? `?returnTo=${encodeURIComponent(safe)}` : ''}`;
}

/**
 * Sends a passwordless email link. New stylists (create=true) get an account with their private
 * first and last name in the sign-up metadata; returning stylists only get a link if an account exists.
 */
export async function sendStylistEmailLink(supabase: Supabase, options: {
  email: string; create: boolean; firstName?: string; lastName?: string; locale?: string; returnTo?: string;
}): Promise<{ ok: boolean; unknownAccount?: boolean }> {
  const { error } = await supabase.auth.signInWithOtp({
    email: options.email.trim(),
    options: {
      shouldCreateUser: options.create,
      emailRedirectTo: confirmUrl(options.returnTo),
      ...(options.create ? { data: { first_name: options.firstName?.trim() ?? '', last_name: options.lastName?.trim() ?? '', preferred_locale: options.locale ?? 'en-US' } } : {}),
    },
  });
  if (!error) return { ok: true };
  // Sign-in for an email with no account: answer the same way as success so the page never reveals who has an account.
  if (!options.create && /signups? not allowed|user not found/i.test(error.message)) return { ok: true, unknownAccount: true };
  return { ok: false };
}
