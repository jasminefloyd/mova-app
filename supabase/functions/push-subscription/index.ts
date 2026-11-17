import { withSystemRequestLogging } from '../_shared/system-log.ts';
import { artistClient, corsHeaders, respond, serviceClient } from '../_shared/booking.ts';
import { encryptProviderSecret, sha256Hex } from '../_shared/provider-crypto.ts';

/**
 * Push subscriptions for the signed-in stylist's devices.
 * config → the VAPID public key (null when push isn't configured); status → whether this device is subscribed;
 * subscribe / unsubscribe → store or revoke this device. Endpoint and keys are stored encrypted.
 */
const validBase64Url = (value: unknown, min: number, max: number) => typeof value === 'string' && /^[A-Za-z0-9_-]+=*$/.test(value) && value.length >= min && value.length <= max;

Deno.serve(withSystemRequestLogging('push-subscription', async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ code: 'METHOD_NOT_ALLOWED' }, 405);
  const actor = await artistClient(request);
  if (!actor) return respond({ code: 'UNAUTHENTICATED' }, 401);
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const db = serviceClient();
  const publicKey = Deno.env.get('MOVA_VAPID_PUBLIC_KEY') ?? null;

  if (body.action === 'config') return respond({ publicKey: publicKey && Deno.env.get('MOVA_VAPID_PRIVATE_KEY') ? publicKey : null });

  const endpoint = typeof body.endpoint === 'string' ? body.endpoint : '';
  let endpointUrl: URL | null = null;
  try { endpointUrl = new URL(endpoint); } catch { endpointUrl = null; }
  if (!endpointUrl || endpointUrl.protocol !== 'https:' || endpoint.length > 2048) return respond({ code: 'PUSH_ENDPOINT_INVALID' }, 422);
  const endpointHash = await sha256Hex(endpoint);

  if (body.action === 'status') {
    const { data, error } = await db.from('mova_push_subscriptions').select('id').eq('artist_business_id', actor.businessId)
      .eq('user_id', actor.user.id).eq('endpoint_hash', endpointHash).is('revoked_at', null).maybeSingle();
    return error ? respond({ code: 'PUSH_STATUS_FAILED' }, 500) : respond({ subscribed: Boolean(data) });
  }

  if (body.action === 'subscribe') {
    if (!publicKey) return respond({ code: 'PUSH_NOT_CONFIGURED' }, 409);
    if (!validBase64Url(body.p256dh, 80, 100) || !validBase64Url(body.auth, 16, 32)) return respond({ code: 'PUSH_KEYS_INVALID' }, 422);
    const userAgent = typeof body.userAgentFamily === 'string' ? body.userAgentFamily.slice(0, 40) : null;
    const { error } = await db.from('mova_push_subscriptions').upsert({
      artist_business_id: actor.businessId, user_id: actor.user.id, endpoint_hash: endpointHash,
      endpoint_encrypted: await encryptProviderSecret(endpoint),
      key_material_encrypted: await encryptProviderSecret(JSON.stringify({ p256dh: body.p256dh, auth: body.auth })),
      user_agent_family: userAgent, revoked_at: null, failure_count: 0,
    }, { onConflict: 'artist_business_id,user_id,endpoint_hash' });
    return error ? respond({ code: 'PUSH_SUBSCRIBE_FAILED' }, 500) : respond({ subscribed: true });
  }

  if (body.action === 'unsubscribe') {
    const { error } = await db.from('mova_push_subscriptions').update({ revoked_at: new Date().toISOString() })
      .eq('artist_business_id', actor.businessId).eq('user_id', actor.user.id).eq('endpoint_hash', endpointHash);
    return error ? respond({ code: 'PUSH_UNSUBSCRIBE_FAILED' }, 500) : respond({ subscribed: false });
  }
  return respond({ code: 'INVALID_ACTION' }, 422);
}));
