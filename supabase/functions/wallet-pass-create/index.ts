import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.119.0';
import { corsHeaders, respond, serviceClient } from '../_shared/booking.ts';
import { deriveClientCardToken, sha256Hex } from '../_shared/provider-crypto.ts';
import { buildClientCardPass, type WalletPlatform } from '../_shared/providers/wallet/pass.ts';
import { walletSignerFromEnv } from '../_shared/providers/wallet/fake.ts';

// Task 5.7: a signed-in client saves their client card for one stylist to Apple or Google Wallet.
// Platform flag MOVA_WALLET_CLIENT_CARD_ENABLED stays off until signing is live (O11); the stylist's
// wallet_card switch (default ON, 0053) must also be on. Only the fake signer exists today.
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ code: 'METHOD_NOT_ALLOWED' }, 405);
  if (Deno.env.get('MOVA_WALLET_CLIENT_CARD_ENABLED') !== 'true') return respond({ code: 'WALLET_NOT_ENABLED' }, 503);
  const signer = walletSignerFromEnv((name) => Deno.env.get(name));
  if (!signer) return respond({ code: 'WALLET_SIGNER_NOT_CONFIGURED' }, 503);
  const url = Deno.env.get('SUPABASE_URL'); const key = Deno.env.get('SUPABASE_ANON_KEY'); const authorization = request.headers.get('Authorization');
  if (!url || !key || !authorization) return respond({ code: 'UNAUTHENTICATED' }, 401);
  const { data: { user } } = await createClient(url, key, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } }).auth.getUser();
  if (!user) return respond({ code: 'UNAUTHENTICATED' }, 401);
  const body = await request.json().catch(() => ({}));
  const platform = body.platform as WalletPlatform;
  if (typeof body.artist_business_id !== 'string' || !['apple', 'google'].includes(platform)) return respond({ code: 'INVALID_REQUEST' }, 422);

  const db = serviceClient();
  const { data: features } = await db.rpc('mova_stylist_features', { p_artist_business_id: body.artist_business_id });
  if (features?.wallet_card !== true) return respond({ code: 'WALLET_NOT_OFFERED' }, 409);
  const { data: account } = await db.from('mova_customer_accounts').select('id,display_name,preferred_locale').eq('user_id', user.id).eq('status', 'active').maybeSingle();
  if (!account) return respond({ code: 'CLIENT_PROFILE_NOT_FOUND' }, 404);
  const { data: link } = await db.from('mova_client_customer_links').select('client_id').eq('artist_business_id', body.artist_business_id).eq('customer_account_id', account.id).is('unlinked_at', null).maybeSingle();
  if (!link) return respond({ code: 'CLIENT_LINK_NOT_FOUND' }, 404);
  // The pass carries the same client card link the profile shows; the profile creates it first.
  const { data: card } = await db.from('mova_client_card_tokens').select('id,token_hash').eq('artist_business_id', body.artist_business_id).eq('client_id', link.client_id).eq('customer_account_id', account.id).is('revoked_at', null).maybeSingle();
  if (!card) return respond({ code: 'CLIENT_CARD_REQUIRED' }, 409);
  let token: string;
  try { token = await deriveClientCardToken(card.id, body.artist_business_id, link.client_id, account.id); } catch { return respond({ code: 'CLIENT_CARD_TOKEN_KEY_UNAVAILABLE' }, 503); }
  if (await sha256Hex(token) !== card.token_hash) return respond({ code: 'CLIENT_CARD_REQUIRED' }, 409);

  const [{ data: profile }, { data: next }] = await Promise.all([
    db.from('mova_artist_profiles').select('display_name').eq('artist_business_id', body.artist_business_id).maybeSingle(),
    db.from('mova_appointments').select('starts_at,service_name_snapshot,mova_locations(time_zone)').eq('artist_business_id', body.artist_business_id).eq('client_id', link.client_id).in('status', ['confirmed', 'pending_artist']).gt('starts_at', new Date().toISOString()).order('starts_at').limit(1).maybeSingle(),
  ]);
  const serial = crypto.randomUUID();
  const authToken = [...crypto.getRandomValues(new Uint8Array(24))].map((value) => value.toString(16).padStart(2, '0')).join('');
  const base = (Deno.env.get('PUBLIC_BASE_URL') ?? 'https://mova-beauty.co').replace(/\/$/, '');
  const nextRow = next as unknown as { starts_at: string; service_name_snapshot: string; mova_locations: { time_zone: string } | null } | null;
  const pass = buildClientCardPass({
    platform, serial, authToken, locale: account.preferred_locale === 'es-US' ? 'es-US' : 'en-US',
    stylistName: profile?.display_name ?? '', clientName: account.display_name || '', cardUrl: `${base}/c/${token}`,
    nextAppointment: nextRow ? { startsAt: nextRow.starts_at, timeZone: nextRow.mova_locations?.time_zone ?? 'America/New_York', service: nextRow.service_name_snapshot } : null,
  });
  const signed = await signer.sign(pass);
  const { error } = await db.from('mova_wallet_passes').insert({
    subject_type: 'client_card', artist_business_id: body.artist_business_id, client_id: link.client_id, customer_account_id: account.id,
    platform, serial, auth_token_hash: await sha256Hex(authToken), status: 'active', last_payload_hash: await sha256Hex(JSON.stringify(pass)), last_pushed_at: new Date().toISOString(),
  });
  if (error) return respond({ code: 'WALLET_PASS_SAVE_FAILED' }, 500);
  return respond({ platform, signer: signer.name, live: signed.live, content_type: signed.contentType, file_name: signed.fileName, pass_base64: signed.base64 });
});
