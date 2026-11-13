import { withSystemRequestLogging } from '../_shared/system-log.ts';
import { corsHeaders, serviceClient } from '../_shared/booking.ts';
import { decryptProviderSecret, encryptProviderSecret, sha256Hex } from '../_shared/provider-crypto.ts';
import { googleProvider, loadConnection } from '../_shared/google-connection.ts';
import { GOOGLE_BUSINESS_SCOPE, GOOGLE_CALENDAR_SCOPE } from '../_shared/providers/google/index.ts';

// OAuth callback for the one Google connection (P6). Saves or refreshes the single row in
// mova_google_connections. An existing row keeps its chosen calendar and Business Profile location.
const redirect = (path: string) => Response.redirect(`${Deno.env.get('OPERATOR_BASE_URL') ?? 'https://ops.mova-beauty.co'}${path}`, 303);
Deno.serve(withSystemRequestLogging('calendar-google-callback', async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const url = new URL(request.url); const code = url.searchParams.get('code'); const state = url.searchParams.get('state');
  if (!code || !state) return redirect('/auth?google=connect_error');
  const db = serviceClient();
  const { data: stateRow } = await db.from('mova_google_oauth_states').select('id,artist_business_id,verifier_encrypted,expires_at,consumed_at').eq('state_hash', await sha256Hex(state)).maybeSingle();
  if (!stateRow || stateRow.consumed_at || new Date(stateRow.expires_at).getTime() < Date.now()) return redirect('/auth?google=connect_error');
  const { data: consumed } = await db.from('mova_google_oauth_states').update({ consumed_at: new Date().toISOString() }).eq('id', stateRow.id).is('consumed_at', null).select('id').maybeSingle();
  if (!consumed) return redirect('/auth?google=connect_error');
  const businessId = stateRow.artist_business_id as string;
  const failed = () => redirect(`/${encodeURIComponent(businessId)}/settings/google?google=connect_error`);
  try {
    const provider = googleProvider(request);
    const redirectUri = Deno.env.get('GOOGLE_OAUTH_REDIRECT_URI');
    if (!provider || !redirectUri) return failed();
    const token = await provider.exchangeCode({ code, codeVerifier: await decryptProviderSecret(stateRow.verifier_encrypted), redirectUri });
    const existing = await loadConnection(db, businessId).catch(() => null);
    const { error } = await db.from('mova_google_connections').upsert({
      artist_business_id: businessId,
      google_account_email: token.email,
      refresh_token_encrypted: await encryptProviderSecret(token.refreshToken),
      granted_scopes: token.grantedScopes,
      status: 'active',
      calendar_enabled: token.grantedScopes.includes(GOOGLE_CALENDAR_SCOPE),
      business_profile_enabled: token.grantedScopes.includes(GOOGLE_BUSINESS_SCOPE),
      calendar_id: existing?.calendar_id ?? 'primary',
      business_location_id: existing?.business_location_id ?? null,
      connected_at: new Date().toISOString(),
    }, { onConflict: 'artist_business_id' });
    if (error) throw new Error('GOOGLE_CONNECTION_SAVE_FAILED');
    await db.from('mova_calendar_sync_settings').upsert({ artist_business_id: businessId, google_enabled: token.grantedScopes.includes(GOOGLE_CALENDAR_SCOPE) }, { onConflict: 'artist_business_id' });
    return redirect(`/${encodeURIComponent(businessId)}/settings/google?google=connected`);
  } catch {
    return failed();
  }
}));
