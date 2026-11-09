import { createMovaSupabaseClient } from '../../lib/supabase';
import { adminRpc, type WhoAmI } from './admin-api';

export const IDLE_LIMIT_MS = 30 * 60 * 1000;

export type AdminSession = { displayName: string };

/**
 * True only for a signed-in, two-step (aal2) session of an account on the platform admin roster.
 * The database makes the same decision for every admin function; this check just sends the user to sign in.
 */
export async function currentAdminSession(): Promise<AdminSession | null> {
  const supabase = createMovaSupabaseClient();
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return null;
  const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== 'aal2') return null;
  const who = await adminRpc<WhoAmI>('mova_admin_whoami');
  return who.is_admin ? { displayName: who.display_name ?? 'Staff' } : null;
}

export async function signOutAdmin(): Promise<void> {
  const supabase = createMovaSupabaseClient();
  await supabase.auth.signOut();
}

/** A short device label for the sign-in record, e.g. "Chrome · Mac". Derived from the user agent. */
export function deviceLabel(userAgent: string = typeof navigator === 'undefined' ? '' : navigator.userAgent): string {
  const browser = /Edg\//.test(userAgent) ? 'Edge'
    : /Chrome\//.test(userAgent) ? 'Chrome'
      : /Firefox\//.test(userAgent) ? 'Firefox'
        : /Safari\//.test(userAgent) ? 'Safari' : 'Browser';
  const system = /iPhone|iPad/.test(userAgent) ? 'iOS'
    : /Android/.test(userAgent) ? 'Android'
      : /Mac OS X/.test(userAgent) ? 'Mac'
        : /Windows/.test(userAgent) ? 'Windows'
          : /Linux/.test(userAgent) ? 'Linux' : 'Unknown';
  return `${browser} · ${system}`;
}

/** Only in-portal paths may be used after sign-in, so the return address cannot send people elsewhere. */
export function safeReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith('/admin') || value.startsWith('//') || value.includes('://')) return '/admin';
  return value;
}
