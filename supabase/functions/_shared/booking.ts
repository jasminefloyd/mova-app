import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.119.0';
import { corsHeaders } from './cors.ts';

export { corsHeaders } from './cors.ts';
export const respond = (data: unknown, status = 200) => Response.json({ data, error: status >= 400 ? data : null, request_id: crypto.randomUUID() }, { status, headers: corsHeaders });
export const serviceClient = () => {
  const url = Deno.env.get('SUPABASE_URL'); const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('SERVER_CONFIGURATION_MISSING');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
};
export async function artistClient(request: Request) {
  const url = Deno.env.get('SUPABASE_URL'); const key = Deno.env.get('SUPABASE_ANON_KEY');
  const authorization = request.headers.get('Authorization');
  if (!url || !key || !authorization) return null;
  const client = createClient(url, key, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
  const { data: { user } } = await client.auth.getUser();
  if (!user) return null;
  let membershipQuery=client.from('mova_artist_memberships').select('artist_business_id').eq('user_id',user.id).eq('status','active');
  const requestedBusinessId=request.headers.get('x-mova-artist-business-id');
  if(requestedBusinessId)membershipQuery=membershipQuery.eq('artist_business_id',requestedBusinessId);
  const { data: membership } = await membershipQuery.limit(1).maybeSingle();
  return membership ? { client, user, businessId: membership.artist_business_id as string } : null;
}
export async function tokenHash(token: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return `\\x${[...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}
