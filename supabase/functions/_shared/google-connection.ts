// The one Google connection per stylist (P6). Shared by the connection, callback, calendar sync, listing
// sync, review import and reply functions, so they all read the same row and the same provider.
import { decryptProviderSecret } from './provider-crypto.ts';
import { googleProviderFromEnv, GOOGLE_BUSINESS_SCOPE, GOOGLE_CALENDAR_SCOPE, type GoogleProvider } from './providers/google/index.ts';

export type GoogleConnectionRow = {
  artist_business_id: string;
  google_account_email: string | null;
  refresh_token_encrypted: string;
  granted_scopes: string[];
  status: 'active' | 'revoked' | 'error';
  calendar_enabled: boolean;
  calendar_id: string;
  business_profile_enabled: boolean;
  business_location_id: string | null;
  connected_at: string;
};

export const CONNECTION_COLUMNS = 'artist_business_id,google_account_email,refresh_token_encrypted,granted_scopes,status,calendar_enabled,calendar_id,business_profile_enabled,business_location_id,connected_at';

/** Public fields only: never the refresh token ciphertext. */
export const connectionSummary = (row: GoogleConnectionRow | null) => row && {
  google_account_email: row.google_account_email, status: row.status, connected_at: row.connected_at,
  calendar_enabled: row.calendar_enabled, calendar_id: row.calendar_id,
  business_profile_enabled: row.business_profile_enabled, business_location_id: row.business_location_id,
  has_business_scope: row.granted_scopes.includes(GOOGLE_BUSINESS_SCOPE), has_calendar_scope: row.granted_scopes.includes(GOOGLE_CALENDAR_SCOPE),
};

export const googleProvider = (fetcher?: typeof fetch): GoogleProvider | null => googleProviderFromEnv((name) => Deno.env.get(name), fetcher);

// Structural type so this works with the Supabase client the callers already create.
// deno-lint-ignore no-explicit-any
type Db = { from: (table: string) => any };

export async function loadConnection(db: Db, businessId: string): Promise<GoogleConnectionRow | null> {
  const { data, error } = await db.from('mova_google_connections').select(CONNECTION_COLUMNS).eq('artist_business_id', businessId).maybeSingle();
  if (error) throw new Error('GOOGLE_CONNECTION_READ_FAILED');
  return data as GoogleConnectionRow | null;
}

/** Trades the stored refresh token for an access token. Throws GOOGLE_REFRESH_FAILED when Google refuses. */
export async function accessTokenFor(provider: GoogleProvider, row: GoogleConnectionRow): Promise<string> {
  const refresh = await decryptProviderSecret(row.refresh_token_encrypted);
  return provider.accessToken(refresh);
}

/** Business Profile actions need an active connection with the Business Profile permission switched on. */
export function businessProfileReady(row: GoogleConnectionRow | null): row is GoogleConnectionRow {
  return Boolean(row && row.status === 'active' && row.business_profile_enabled && row.business_location_id && row.granted_scopes.includes(GOOGLE_BUSINESS_SCOPE));
}

function base64url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

/** PKCE S256 challenge: base64url of the raw SHA-256 digest (Google rejects a hex digest). */
export async function s256Challenge(verifier: string) {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}

export function randomToken(size = 32) {
  return base64url(crypto.getRandomValues(new Uint8Array(size)));
}
