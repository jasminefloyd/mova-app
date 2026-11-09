import { artistClient, corsHeaders, respond } from '../_shared/booking.ts';

// P6 New appointment (board 08c). A signed-in stylist books an existing client into a free time.
// Deposits and confirmation texts are not sent here; the RPC creates a confirmed, deposit-free booking.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ code: 'METHOD_NOT_ALLOWED' }, 405);
  const actor = await artistClient(request);
  if (!actor) return respond({ code: 'AUTH_REQUIRED' }, 401);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return respond({ code: 'INVALID_JSON' }, 400);
  if (body.artist_business_id !== actor.businessId) return respond({ code: 'ARTIST_BUSINESS_SCOPE_MISMATCH' }, 403);
  const ids = [body.client_id, body.location_id, body.service_id];
  if (!ids.every((value) => typeof value === 'string' && UUID.test(value))) return respond({ code: 'APPOINTMENT_INPUT_INVALID' }, 422);
  const startsAt = typeof body.starts_at === 'string' ? new Date(body.starts_at) : null;
  if (!startsAt || Number.isNaN(startsAt.getTime())) return respond({ code: 'APPOINTMENT_TIME_INVALID' }, 422);
  const key = String(request.headers.get('Idempotency-Key') ?? body.idempotency_key ?? '').trim();
  if (key.length < 8) return respond({ code: 'IDEMPOTENCY_KEY_REQUIRED' }, 422);
  const { data, error } = await actor.client.rpc('mova_artist_appointment_create', {
    p_artist_business_id: actor.businessId,
    p_client_id: body.client_id,
    p_location_id: body.location_id,
    p_service_id: body.service_id,
    p_starts_at: startsAt.toISOString(),
    p_idempotency_key: key,
  });
  if (error) return respond({ code: error.message || 'APPOINTMENT_CREATE_FAILED' }, 422);
  return respond({ appointment_id: data }, 201);
});
